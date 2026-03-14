use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, Manager, State};

use crate::db::{analytics_db, chat_db, contacts_db};
use crate::embeddings::clip;
use crate::error::{AppError, AppResult};
use crate::ingestion::timestamp::apple_timestamp_to_unix_ms;
use crate::state::AppState;

// ── Status ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingStatus {
    pub models_loaded: bool,
    pub total_embedded: i64,
    pub total_messages: i64,
    pub index_target: i64,
}

/// Check the current status of the embedding pipeline.
#[tauri::command]
pub fn check_embedding_status(state: State<'_, AppState>) -> AppResult<EmbeddingStatus> {
    let chat_conn = state.lock_chat_db()?;
    let analytics_conn = state.lock_analytics_db()?;

    let total_messages = chat_db::get_total_message_count(&chat_conn)?;
    let total_embedded = analytics_db::count_embeddings(&analytics_conn)?;
    let models_loaded = state.models_loaded();
    let index_target = analytics_db::get_search_setting(&analytics_conn, "index_target")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(1000);

    Ok(EmbeddingStatus {
        models_loaded,
        total_embedded,
        total_messages,
        index_target,
    })
}

// ── Search ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkMessage {
    pub rowid: i64,
    pub text: Option<String>,
    pub is_from_me: bool,
    pub sender_display_name: Option<String>,
    pub date: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSearchResult {
    pub source_type: String,
    pub source_id: i64,
    pub message_rowid: i64,
    pub chat_id: i64,
    pub score: f64,
    pub text: Option<String>,
    pub is_from_me: bool,
    pub sender_display_name: Option<String>,
    pub date: i64,
    pub mime_type: Option<String>,
    pub attachment_path: Option<String>,
    pub link_url: Option<String>,
    pub link_domain: Option<String>,
    pub link_title: Option<String>,
    /// Individual messages within a chunk (only for source_type = "chunk")
    pub messages: Option<Vec<ChunkMessage>>,
}

/// Semantic search across all embeddings using CLIP text encoder.
#[tauri::command]
pub fn semantic_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<i64>,
) -> AppResult<Vec<SemanticSearchResult>> {
    let limit = limit.unwrap_or(20);

    // Get text session (behind RwLock)
    let clip_text_guard = state.clip_text.read().unwrap_or_else(|p| p.into_inner());
    let text_session_arc = clip_text_guard
        .as_ref()
        .ok_or_else(|| AppError::Custom("CLIP text model not loaded".into()))?
        .clone();
    drop(clip_text_guard);

    let tokenizer_guard = state.tokenizer.read().unwrap_or_else(|p| p.into_inner());
    let tokenizer_arc = tokenizer_guard
        .as_ref()
        .ok_or_else(|| AppError::Custom("Tokenizer not loaded".into()))?
        .clone();
    drop(tokenizer_guard);

    // Encode query
    let query_embedding = {
        let mut session = text_session_arc
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        let embeddings = clip::encode_texts(&mut session, &tokenizer_arc, &[query.as_str()])?;
        if embeddings.is_empty() {
            return Err(AppError::Custom("Failed to encode query".into()));
        }
        embeddings.into_iter().next().unwrap()
    };

    // Load all embeddings and compute cosine similarity
    let analytics_conn = state.lock_analytics_db()?;
    let all_embeddings = analytics_db::load_all_embeddings(&analytics_conn)?;

    let mut scored: Vec<(f64, i64, String, i64, Option<i64>, i64)> = all_embeddings
        .iter()
        .filter_map(|(id, source_type, source_id, chunk_id, chat_id, blob)| {
            let emb = clip::blob_to_embedding(blob).ok()?;
            let score = clip::cosine_similarity(&query_embedding, &emb) as f64;
            Some((score, *id, source_type.clone(), *source_id, *chunk_id, *chat_id))
        })
        .collect();

    // Sort descending by score
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    // Deduplicate: keep best score per (source_type, source_id)
    let mut seen: std::collections::HashSet<(String, i64)> = std::collections::HashSet::new();
    let all_deduped: Vec<_> = scored
        .into_iter()
        .filter(|(_, _, st, sid, _, _)| seen.insert((st.clone(), *sid)))
        .collect();

    // Ensure a mix of result types: text-to-image cross-modal scores are
    // inherently lower than text-to-text, so guarantee some attachment results.
    let text_limit = (limit * 3 / 4) as usize; // ~75% for messages/chunks
    let attachment_limit = (limit / 4).max(5) as usize; // ~25% for attachments, min 5

    let mut text_results: Vec<_> = Vec::new();
    let mut attachment_results: Vec<_> = Vec::new();

    for item in &all_deduped {
        match item.2.as_str() {
            "attachment" => {
                if attachment_results.len() < attachment_limit {
                    attachment_results.push(item.clone());
                }
            }
            _ => {
                if text_results.len() < text_limit {
                    text_results.push(item.clone());
                }
            }
        }
    }

    // Merge and sort by score
    let mut deduped = text_results;
    deduped.extend(attachment_results);
    deduped.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    deduped.truncate(limit as usize);

    // Now enrich each result with message data from chat.db
    let chat_conn = state.lock_chat_db()?;
    let contact_map = state
        .contact_map
        .lock()
        .unwrap_or_else(|p| p.into_inner());

    let handle_map = build_handle_map_from_conn(&chat_conn)?;

    let mut results: Vec<SemanticSearchResult> = Vec::with_capacity(deduped.len());

    for (score, _id, source_type, source_id, _chunk_id, chat_id) in deduped {
        let result = match source_type.as_str() {
            "message" => enrich_message_result(
                &chat_conn,
                &contact_map,
                &handle_map,
                source_id,
                chat_id,
                score,
            ),
            "chunk" => enrich_chunk_result(
                &chat_conn,
                &analytics_conn,
                &contact_map,
                &handle_map,
                source_id,
                chat_id,
                score,
            ),
            "attachment" => enrich_attachment_result(
                &chat_conn,
                &contact_map,
                &handle_map,
                source_id,
                chat_id,
                score,
            ),
            _ => None,
        };

        if let Some(r) = result {
            results.push(r);
        }
    }

    Ok(results)
}

// ── Index target ───────────────────────────────────────────────────────

/// Set the index target (number of messages to embed).
/// If the new target is higher than current embeddings and no pipeline is running,
/// spawn a background pipeline run to index more.
#[tauri::command]
pub fn set_index_target(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    target: i64,
) -> AppResult<()> {
    let analytics_conn = state.lock_analytics_db()?;
    analytics_db::set_search_setting(&analytics_conn, "index_target", &target.to_string())?;

    // Check if we need to run the pipeline
    let current_count = analytics_db::count_embeddings(&analytics_conn)?;
    drop(analytics_conn);

    if current_count < target && state.models_loaded() {
        // Only dispatch if not already running
        if !state.pipeline_running.load(std::sync::atomic::Ordering::SeqCst) {
            let text_arc = {
                let guard = state.clip_text.read().unwrap_or_else(|p| p.into_inner());
                guard.clone()
            };
            let vision_arc = {
                let guard = state.clip_vision.read().unwrap_or_else(|p| p.into_inner());
                guard.clone()
            };
            let tok_arc = {
                let guard = state.tokenizer.read().unwrap_or_else(|p| p.into_inner());
                guard.clone()
            };

            if let (Some(text), Some(vision), Some(tok)) = (text_arc, vision_arc, tok_arc) {
                let app_handle_clone = app_handle.clone();
                let state_ref = app_handle.state::<AppState>();
                state_ref.pipeline_running.store(true, std::sync::atomic::Ordering::SeqCst);

                std::thread::spawn(move || {
                    let mut text_session = text.lock().unwrap_or_else(|p| p.into_inner());
                    let mut vision_session = vision.lock().unwrap_or_else(|p| p.into_inner());
                    if let Err(e) = crate::embeddings::pipeline::run_indexing_pipeline(
                        &app_handle_clone,
                        &mut text_session,
                        &mut vision_session,
                        &tok,
                    ) {
                        log::error!("Pipeline (from set_index_target) failed: {e}");
                    }
                    // Clear the flag
                    if let Some(state) = app_handle_clone.try_state::<AppState>() {
                        state.pipeline_running.store(false, std::sync::atomic::Ordering::SeqCst);
                    }
                });
            }
        }
    }

    Ok(())
}

/// Clear all embeddings and re-trigger the background pipeline.
#[tauri::command]
pub fn rebuild_search_index(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> AppResult<()> {
    // Clear all embeddings
    let analytics_conn = state.lock_analytics_db()?;
    analytics_db::clear_embeddings(&analytics_conn)?;
    drop(analytics_conn);

    // Get sessions from AppState
    let text_arc = {
        let guard = state.clip_text.read().unwrap_or_else(|p| p.into_inner());
        guard.clone()
    };
    let vision_arc = {
        let guard = state.clip_vision.read().unwrap_or_else(|p| p.into_inner());
        guard.clone()
    };
    let tok_arc = {
        let guard = state.tokenizer.read().unwrap_or_else(|p| p.into_inner());
        guard.clone()
    };

    match (text_arc, vision_arc, tok_arc) {
        (Some(text), Some(vision), Some(tok)) => {
            let state_ref = app_handle.state::<AppState>();
            state_ref.pipeline_running.store(true, std::sync::atomic::Ordering::SeqCst);

            std::thread::spawn(move || {
                let mut text_session = text.lock().unwrap_or_else(|p| p.into_inner());
                let mut vision_session = vision.lock().unwrap_or_else(|p| p.into_inner());
                if let Err(e) = crate::embeddings::pipeline::run_indexing_pipeline(
                    &app_handle,
                    &mut text_session,
                    &mut vision_session,
                    &tok,
                ) {
                    log::error!("Rebuild pipeline failed: {e}");
                }
                // Clear the flag
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state.pipeline_running.store(false, std::sync::atomic::Ordering::SeqCst);
                }
            });
        }
        _ => {
            return Err(AppError::Custom("CLIP models not loaded yet".into()));
        }
    }

    Ok(())
}

// ── Enrichment helpers ─────────────────────────────────────────────────

fn build_handle_map_from_conn(
    conn: &rusqlite::Connection,
) -> AppResult<HashMap<i64, String>> {
    let mut stmt = conn.prepare("SELECT ROWID, id FROM handle")?;
    let map: HashMap<i64, String> = stmt
        .query_map([], |row| {
            let rowid: i64 = row.get(0)?;
            let id: String = row.get(1)?;
            Ok((rowid, id))
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(map)
}

fn enrich_message_result(
    chat_conn: &rusqlite::Connection,
    contact_map: &HashMap<String, String>,
    handle_map: &HashMap<i64, String>,
    message_rowid: i64,
    chat_id: i64,
    score: f64,
) -> Option<SemanticSearchResult> {
    let row = chat_conn
        .query_row(
            "SELECT m.text, m.attributedBody, m.is_from_me, m.date, m.handle_id
             FROM message AS m WHERE m.ROWID = ?1",
            rusqlite::params![message_rowid],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<Vec<u8>>>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            },
        )
        .ok()?;

    let (text, attributed_body, is_from_me_i64, date_raw, handle_id) = row;

    let resolved_text = text.or_else(|| {
        attributed_body
            .as_ref()
            .and_then(|blob| {
                crate::ingestion::message_parser::extract_text_from_attributed_body(blob)
            })
    });

    let sender = handle_map.get(&handle_id).cloned();
    let sender_display_name = sender
        .as_ref()
        .and_then(|s| contacts_db::resolve_name(s, contact_map));

    Some(SemanticSearchResult {
        source_type: "message".into(),
        source_id: message_rowid,
        message_rowid,
        chat_id,
        score,
        text: resolved_text,
        is_from_me: is_from_me_i64 != 0,
        sender_display_name,
        date: apple_timestamp_to_unix_ms(date_raw),
        mime_type: None,
        attachment_path: None,
        link_url: None,
        link_domain: None,
        link_title: None,
        messages: None,
    })
}

fn enrich_chunk_result(
    chat_conn: &rusqlite::Connection,
    analytics_conn: &rusqlite::Connection,
    contact_map: &HashMap<String, String>,
    handle_map: &HashMap<i64, String>,
    chunk_id: i64,
    chat_id: i64,
    score: f64,
) -> Option<SemanticSearchResult> {
    let row = analytics_conn
        .query_row(
            "SELECT concatenated_text, is_from_me, first_rowid, last_rowid, started_at FROM message_chunks WHERE id = ?1",
            rusqlite::params![chunk_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, bool>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            },
        )
        .ok()?;

    let (text, is_from_me, first_rowid, last_rowid, started_at) = row;

    // Fetch individual messages within this chunk from chat.db
    let chunk_messages = fetch_chunk_messages(
        chat_conn, contact_map, handle_map, first_rowid, last_rowid, chat_id,
    );

    Some(SemanticSearchResult {
        source_type: "chunk".into(),
        source_id: chunk_id,
        message_rowid: first_rowid,
        chat_id,
        score,
        text: Some(text),
        is_from_me,
        sender_display_name: None,
        date: started_at, // already in unix ms from chunker
        mime_type: None,
        attachment_path: None,
        link_url: None,
        link_domain: None,
        link_title: None,
        messages: if chunk_messages.is_empty() { None } else { Some(chunk_messages) },
    })
}

/// Fetch individual messages from chat.db that belong to a chunk (by rowid range + chat_id).
fn fetch_chunk_messages(
    chat_conn: &rusqlite::Connection,
    contact_map: &HashMap<String, String>,
    handle_map: &HashMap<i64, String>,
    first_rowid: i64,
    last_rowid: i64,
    chat_id: i64,
) -> Vec<ChunkMessage> {
    let mut stmt = match chat_conn.prepare(
        "SELECT m.ROWID, m.text, m.attributedBody, m.is_from_me, m.date, m.handle_id
         FROM message AS m
         LEFT JOIN chat_message_join AS cmj ON cmj.message_id = m.ROWID
         WHERE m.ROWID >= ?1 AND m.ROWID <= ?2
           AND (cmj.chat_id = ?3 OR cmj.chat_id IS NULL)
           AND m.associated_message_type = 0
         ORDER BY m.ROWID ASC",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let rows: Vec<_> = stmt
        .query_map(rusqlite::params![first_rowid, last_rowid, chat_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<Vec<u8>>>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })
        .ok()
        .map(|r| r.filter_map(|v| v.ok()).collect())
        .unwrap_or_default();

    rows.into_iter()
        .map(|(rowid, text, attributed_body, is_from_me_i64, date_raw, handle_id)| {
            let resolved_text = text.or_else(|| {
                attributed_body
                    .as_ref()
                    .and_then(|blob| {
                        crate::ingestion::message_parser::extract_text_from_attributed_body(blob)
                    })
            });

            let sender = handle_map.get(&handle_id).cloned();
            let sender_display_name = sender
                .as_ref()
                .and_then(|s| contacts_db::resolve_name(s, contact_map));

            ChunkMessage {
                rowid,
                text: resolved_text,
                is_from_me: is_from_me_i64 != 0,
                sender_display_name,
                date: apple_timestamp_to_unix_ms(date_raw),
            }
        })
        .collect()
}

fn enrich_attachment_result(
    chat_conn: &rusqlite::Connection,
    contact_map: &HashMap<String, String>,
    handle_map: &HashMap<i64, String>,
    attachment_rowid: i64,
    chat_id: i64,
    score: f64,
) -> Option<SemanticSearchResult> {
    // Get attachment info
    let att_row = chat_conn
        .query_row(
            "SELECT a.filename, a.mime_type, a.transfer_name, maj.message_id
             FROM attachment AS a
             INNER JOIN message_attachment_join AS maj ON maj.attachment_id = a.ROWID
             WHERE a.ROWID = ?1
             LIMIT 1",
            rusqlite::params![attachment_rowid],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .ok()?;

    let (filename, mime_type, transfer_name, message_id) = att_row;

    // Get message info for date / sender
    let msg_row = chat_conn
        .query_row(
            "SELECT m.is_from_me, m.date, m.handle_id FROM message AS m WHERE m.ROWID = ?1",
            rusqlite::params![message_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .ok()?;

    let (is_from_me_i64, date_raw, handle_id) = msg_row;

    let sender = handle_map.get(&handle_id).cloned();
    let sender_display_name = sender
        .as_ref()
        .and_then(|s| contacts_db::resolve_name(s, contact_map));

    Some(SemanticSearchResult {
        source_type: "attachment".into(),
        source_id: attachment_rowid,
        message_rowid: message_id,
        chat_id,
        score,
        text: transfer_name,
        is_from_me: is_from_me_i64 != 0,
        sender_display_name,
        date: apple_timestamp_to_unix_ms(date_raw),
        mime_type,
        attachment_path: filename,
        link_url: None,
        link_domain: None,
        link_title: None,
        messages: None,
    })
}
