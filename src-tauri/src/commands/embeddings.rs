use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, State};

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
    let models_loaded = state.clip_text.is_some() && state.clip_vision.is_some();
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
}

/// Semantic search across all embeddings using CLIP text encoder.
#[tauri::command]
pub fn semantic_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<i64>,
) -> AppResult<Vec<SemanticSearchResult>> {
    let limit = limit.unwrap_or(20);

    // Get text session
    let text_session_arc = state
        .clip_text
        .as_ref()
        .ok_or_else(|| AppError::Custom("CLIP text model not loaded".into()))?;
    let tokenizer_arc = state
        .tokenizer
        .as_ref()
        .ok_or_else(|| AppError::Custom("Tokenizer not loaded".into()))?;

    // Encode query
    let query_embedding = {
        let mut session = text_session_arc
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        let embeddings = clip::encode_texts(&mut session, tokenizer_arc, &[query.as_str()])?;
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
    let deduped: Vec<_> = scored
        .into_iter()
        .filter(|(_, _, st, sid, _, _)| seen.insert((st.clone(), *sid)))
        .take(limit as usize)
        .collect();

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
                &analytics_conn,
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
#[tauri::command]
pub fn set_index_target(
    state: State<'_, AppState>,
    target: i64,
) -> AppResult<()> {
    let analytics_conn = state.lock_analytics_db()?;
    analytics_db::set_search_setting(&analytics_conn, "index_target", &target.to_string())?;
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

    // Spawn pipeline again in the background
    tokio::task::spawn_blocking(move || {
        if let Err(e) = crate::embeddings::pipeline::run_indexing_pipeline(&app_handle) {
            log::error!("Rebuild pipeline failed: {e}");
        }
    });

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
    })
}

fn enrich_chunk_result(
    analytics_conn: &rusqlite::Connection,
    chunk_id: i64,
    chat_id: i64,
    score: f64,
) -> Option<SemanticSearchResult> {
    let row = analytics_conn
        .query_row(
            "SELECT concatenated_text, is_from_me, first_rowid, started_at FROM message_chunks WHERE id = ?1",
            rusqlite::params![chunk_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, bool>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .ok()?;

    let (text, is_from_me, first_rowid, started_at) = row;

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
    })
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
    })
}
