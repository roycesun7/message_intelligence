use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager};
use tokenizers::Tokenizer;

use crate::db::{analytics_db, chat_db, contacts_db};
use crate::embeddings::chunker;
use crate::embeddings::clip;
use crate::error::{AppError, AppResult};

/// Progress event emitted via Tauri during the embedding pipeline.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingProgress {
    pub phase: String,
    pub processed: i64,
    pub total: i64,
}

/// Number of texts to encode in a single ONNX batch.
const EMBED_BATCH_SIZE: usize = 32;

/// Maximum image file size (10 MB).
const MAX_IMAGE_SIZE: u64 = 10 * 1024 * 1024;

// ── Connection helpers (pipeline opens its own connections) ─────────────

fn open_chat_db_readonly() -> AppResult<Connection> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::Custom("Cannot determine home directory".into()))?;
    let path = home.join("Library/Messages/chat.db");
    if !path.exists() {
        return Err(AppError::ChatDbNotFound);
    }
    let conn = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA query_only = true;")?;
    Ok(conn)
}

fn open_analytics_db_rw(app_handle: &AppHandle) -> AppResult<Connection> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Custom(format!("Cannot resolve app data dir: {e}")))?;
    std::fs::create_dir_all(&data_dir)?;
    let db_path = data_dir.join("analytics.db");
    let conn = Connection::open(&db_path)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
    Ok(conn)
}


// ── Query helpers that join through chat_message_join ───────────────────

/// Build handle_id -> identifier map.
fn build_handle_map(conn: &Connection) -> AppResult<HashMap<i64, String>> {
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

// ── Emit helper ────────────────────────────────────────────────────────

fn emit_progress(app_handle: &AppHandle, phase: &str, processed: i64, total: i64) {
    let _ = app_handle.emit(
        "embedding-progress",
        EmbeddingProgress {
            phase: phase.to_string(),
            processed,
            total,
        },
    );
}

// ── Expand tilde helper ────────────────────────────────────────────────

fn expand_tilde(path: &str) -> Option<std::path::PathBuf> {
    if let Some(rest) = path.strip_prefix("~/") {
        dirs::home_dir().map(|home| home.join(rest))
    } else if path == "~" {
        dirs::home_dir()
    } else {
        Some(std::path::PathBuf::from(path))
    }
}

// ── Main pipeline entry point ──────────────────────────────────────────

/// Run the full indexing pipeline. This is called from a background thread
/// and opens its own DB connections. ONNX sessions are passed in to avoid
/// loading 380MB of models a second time (which deadlocks ort).
pub fn run_indexing_pipeline(
    app_handle: &AppHandle,
    text_session: &mut ort::session::Session,
    vision_session: &mut ort::session::Session,
    tokenizer: &Tokenizer,
) -> AppResult<()> {
    log::info!("Embedding pipeline starting...");

    // Open our own connections
    let chat_conn = match open_chat_db_readonly() {
        Ok(c) => c,
        Err(e) => {
            log::warn!("Pipeline: cannot open chat.db (FDA not granted?): {e}");
            return Ok(());
        }
    };
    let analytics_conn = open_analytics_db_rw(app_handle)?;

    // Build contact map and handle map for sender resolution
    let contact_map = contacts_db::build_contact_map().unwrap_or_default();
    let handle_map = build_handle_map(&chat_conn)?;

    // Phase 1: Chunk recent messages into conversation segments
    run_phase_chunking(
        app_handle,
        &chat_conn,
        &analytics_conn,
        text_session,
        tokenizer,
        &handle_map,
        &contact_map,
    )?;

    // Phase 2: Embed individual messages (recent 500 + oldest 500)
    run_phase_text_embedding(
        app_handle,
        &chat_conn,
        &analytics_conn,
        text_session,
        tokenizer,
        &handle_map,
        &contact_map,
    )?;

    // Phase 3: Embed image attachments
    run_phase_attachment_embedding(
        app_handle,
        &chat_conn,
        &analytics_conn,
        vision_session,
    )?;

    emit_progress(app_handle, "done", 0, 0);
    log::info!("Embedding pipeline complete.");

    Ok(())
}

// ── Phase 1: Chunking ──────────────────────────────────────────────────

/// Maximum number of recent messages to chunk (keeps Phase 1 fast).
const CHUNK_LIMIT: i64 = 5000;

/// Fetch the most recent `limit` messages with chat_id, ordered by ROWID DESC.
fn get_recent_messages_with_chat_id(
    conn: &Connection,
    limit: i64,
    handle_map: &HashMap<i64, String>,
    contact_map: &HashMap<String, String>,
) -> AppResult<Vec<crate::db::models::Message>> {
    use crate::db::models::RawMessageRow;

    let mut stmt = conn.prepare(
        "SELECT
            m.ROWID,
            m.guid,
            m.text,
            m.attributedBody,
            m.is_from_me,
            m.date,
            m.date_read,
            m.date_delivered,
            m.handle_id,
            m.service,
            m.associated_message_type,
            m.associated_message_guid,
            m.cache_has_attachments,
            m.thread_originator_guid,
            m.group_title,
            m.is_audio_message,
            cmj.chat_id
         FROM message AS m
         LEFT JOIN chat_message_join AS cmj ON cmj.message_id = m.ROWID
         WHERE m.associated_message_type = 0
         ORDER BY m.ROWID DESC
         LIMIT ?1",
    )?;

    let messages: Vec<crate::db::models::Message> = stmt
        .query_map(rusqlite::params![limit], |row| {
            Ok(RawMessageRow {
                rowid: row.get(0)?,
                guid: row.get(1)?,
                text: row.get(2)?,
                attributed_body: row.get(3)?,
                is_from_me: row.get(4)?,
                date: row.get(5)?,
                date_read: row.get(6)?,
                date_delivered: row.get(7)?,
                handle_id: row.get(8)?,
                service: row.get(9)?,
                associated_message_type: row.get(10)?,
                associated_message_guid: row.get(11)?,
                cache_has_attachments: row.get(12)?,
                thread_originator_guid: row.get(13)?,
                group_title: row.get(14)?,
                is_audio_message: row.get(15)?,
                chat_id: row.get(16)?,
            })
        })?
        .filter_map(|r| r.ok())
        .map(|raw| {
            let sender = handle_map.get(&raw.handle_id).cloned();
            let sender_display_name = sender
                .as_ref()
                .and_then(|s| contacts_db::resolve_name(s, contact_map));
            raw.into_message(sender, sender_display_name)
        })
        .collect();

    Ok(messages)
}

fn run_phase_chunking(
    app_handle: &AppHandle,
    chat_conn: &Connection,
    analytics_conn: &Connection,
    text_session: &mut ort::session::Session,
    tokenizer: &Tokenizer,
    handle_map: &HashMap<i64, String>,
    contact_map: &HashMap<String, String>,
) -> AppResult<()> {
    let already_done = analytics_db::get_last_processed_rowid(analytics_conn, "chunking")?;
    if already_done > 0 {
        log::info!("Phase 1: already processed, skipping.");
        return Ok(());
    }

    log::info!("Phase 1: Chunking recent {CHUNK_LIMIT} messages...");

    // Fetch the most recent CHUNK_LIMIT messages (DESC then reverse to get ASC order)
    let mut messages = get_recent_messages_with_chat_id(
        chat_conn,
        CHUNK_LIMIT,
        handle_map,
        contact_map,
    )?;
    messages.sort_by_key(|m| m.rowid); // sort ASC for chunking

    if messages.is_empty() {
        log::info!("Phase 1: no messages to chunk.");
        return Ok(());
    }

    let total = messages.len() as i64;
    let max_rowid = messages.last().unwrap().rowid;

    // Chunk the messages
    let chunks = chunker::chunk_messages(&messages);
    let mut chunks_created: i64 = 0;
    let mut embeddings_created: i64 = 0;

    for chunk in &chunks {
        // Insert the chunk
        let chunk_db_id = analytics_db::insert_chunk(
            analytics_conn,
            chunk.chat_id,
            chunk.is_from_me,
            chunk.handle_id,
            chunk.first_rowid,
            chunk.last_rowid,
            chunk.message_count,
            &chunk.concatenated_text,
            chunk.started_at,
            chunk.ended_at,
        )?;

        // Embed the chunk's concatenated text (if non-empty)
        if !chunk.concatenated_text.trim().is_empty() {
            let text_ref: &str = &chunk.concatenated_text;
            match clip::encode_texts(text_session, tokenizer, &[text_ref]) {
                Ok(embs) if !embs.is_empty() => {
                    let blob = clip::embedding_to_blob(&embs[0]);
                    analytics_db::insert_embedding(
                        analytics_conn,
                        "chunk",
                        chunk_db_id,
                        Some(chunk_db_id),
                        chunk.chat_id,
                        "mobileclip-s2",
                        &blob,
                    )?;
                    embeddings_created += 1;
                }
                Ok(_) => {}
                Err(e) => {
                    log::debug!("Failed to embed chunk {}: {e}", chunk_db_id);
                }
            }
        }

        chunks_created += 1;
        if chunks_created % 100 == 0 {
            emit_progress(app_handle, "chunking", chunks_created, total);
        }
    }

    if embeddings_created > 0 {
        analytics_db::update_processing_state(
            analytics_conn,
            "chunking",
            max_rowid,
            chunks_created,
        )?;
    }

    emit_progress(app_handle, "chunking", chunks_created, total);
    log::info!(
        "Phase 1 complete: {} chunks created, {} embedded",
        chunks_created, embeddings_created
    );
    Ok(())
}

// ── Phase 2: Text Embedding ────────────────────────────────────────────

fn run_phase_text_embedding(
    app_handle: &AppHandle,
    chat_conn: &Connection,
    analytics_conn: &Connection,
    text_session: &mut ort::session::Session,
    tokenizer: &Tokenizer,
    handle_map: &HashMap<i64, String>,
    contact_map: &HashMap<String, String>,
) -> AppResult<()> {
    log::info!("Phase 2: Text embedding...");

    // Embed most recent 500 messages first
    embed_messages_by_direction(
        app_handle,
        chat_conn,
        analytics_conn,
        text_session,
        tokenizer,
        handle_map,
        contact_map,
        "recent",
        500,
    )?;

    // Then oldest 500
    embed_messages_by_direction(
        app_handle,
        chat_conn,
        analytics_conn,
        text_session,
        tokenizer,
        handle_map,
        contact_map,
        "oldest",
        500,
    )?;

    log::info!("Phase 2 complete.");
    Ok(())
}

fn embed_messages_by_direction(
    app_handle: &AppHandle,
    chat_conn: &Connection,
    analytics_conn: &Connection,
    text_session: &mut ort::session::Session,
    tokenizer: &Tokenizer,
    handle_map: &HashMap<i64, String>,
    contact_map: &HashMap<String, String>,
    direction: &str, // "recent" or "oldest"
    limit: i64,
) -> AppResult<()> {
    let pipeline_name = format!("embedding_{direction}");
    let already_done = analytics_db::get_last_processed_rowid(analytics_conn, &pipeline_name)?;
    if already_done > 0 {
        log::info!("Phase 2 ({direction}): already processed, skipping.");
        return Ok(());
    }

    let order = if direction == "recent" {
        "DESC"
    } else {
        "ASC"
    };

    let query = format!(
        "SELECT
            m.ROWID,
            m.guid,
            m.text,
            m.attributedBody,
            m.is_from_me,
            m.date,
            m.date_read,
            m.date_delivered,
            m.handle_id,
            m.service,
            m.associated_message_type,
            m.associated_message_guid,
            m.cache_has_attachments,
            m.thread_originator_guid,
            m.group_title,
            m.is_audio_message,
            cmj.chat_id
         FROM message AS m
         LEFT JOIN chat_message_join AS cmj ON cmj.message_id = m.ROWID
         WHERE m.associated_message_type = 0
           AND m.text IS NOT NULL
           AND m.text != ''
         ORDER BY m.ROWID {order}
         LIMIT ?1"
    );

    let mut stmt = chat_conn.prepare(&query)?;

    let messages: Vec<crate::db::models::Message> = stmt
        .query_map(rusqlite::params![limit], |row| {
            Ok(crate::db::models::RawMessageRow {
                rowid: row.get(0)?,
                guid: row.get(1)?,
                text: row.get(2)?,
                attributed_body: row.get(3)?,
                is_from_me: row.get(4)?,
                date: row.get(5)?,
                date_read: row.get(6)?,
                date_delivered: row.get(7)?,
                handle_id: row.get(8)?,
                service: row.get(9)?,
                associated_message_type: row.get(10)?,
                associated_message_guid: row.get(11)?,
                cache_has_attachments: row.get(12)?,
                thread_originator_guid: row.get(13)?,
                group_title: row.get(14)?,
                is_audio_message: row.get(15)?,
                chat_id: row.get(16)?,
            })
        })?
        .filter_map(|r| r.ok())
        .map(|raw| {
            let sender = handle_map.get(&raw.handle_id).cloned();
            let sender_display_name = sender
                .as_ref()
                .and_then(|s| contacts_db::resolve_name(s, contact_map));
            raw.into_message(sender, sender_display_name)
        })
        .collect();

    let total = messages.len() as i64;
    log::info!("Phase 2 ({direction}): embedding {total} messages");

    // Process in batches
    let mut processed: i64 = 0;
    let mut embeddings_created: i64 = 0;
    for batch in messages.chunks(EMBED_BATCH_SIZE) {
        let texts: Vec<&str> = batch
            .iter()
            .filter_map(|m| m.text.as_deref())
            .filter(|t| !t.trim().is_empty())
            .collect();

        if texts.is_empty() {
            processed += batch.len() as i64;
            continue;
        }

        match clip::encode_texts(text_session, tokenizer, &texts) {
            Ok(embeddings) => {
                // Map embeddings back to messages that had text
                let msgs_with_text: Vec<&crate::db::models::Message> = batch
                    .iter()
                    .filter(|m| {
                        m.text
                            .as_deref()
                            .map(|t| !t.trim().is_empty())
                            .unwrap_or(false)
                    })
                    .collect();

                for (i, msg) in msgs_with_text.iter().enumerate() {
                    if i >= embeddings.len() {
                        break;
                    }
                    let blob = clip::embedding_to_blob(&embeddings[i]);
                    let chat_id = msg.chat_id.unwrap_or(0);

                    // Find the chunk this message belongs to
                    let chunk_id: Option<i64> = analytics_conn
                        .query_row(
                            "SELECT id FROM message_chunks WHERE first_rowid <= ?1 AND last_rowid >= ?1 LIMIT 1",
                            rusqlite::params![msg.rowid],
                            |row| row.get(0),
                        )
                        .ok();

                    if let Err(e) = analytics_db::insert_embedding(
                        analytics_conn,
                        "message",
                        msg.rowid,
                        chunk_id,
                        chat_id,
                        "mobileclip-s2",
                        &blob,
                    ) {
                        log::debug!("Failed to insert embedding for message {}: {e}", msg.rowid);
                    } else {
                        embeddings_created += 1;
                    }
                }
            }
            Err(e) => {
                log::warn!("Phase 2 ({direction}): batch encoding failed: {e}");
            }
        }

        processed += batch.len() as i64;
        emit_progress(app_handle, "text", processed, total);
    }

    // Only mark as done if at least one embedding was created
    if embeddings_created > 0 {
        let max_rowid = messages.iter().map(|m| m.rowid).max().unwrap_or(0);
        analytics_db::update_processing_state(
            analytics_conn,
            &pipeline_name,
            max_rowid,
            processed,
        )?;
        log::info!("Phase 2 ({direction}): created {embeddings_created} embeddings from {processed} messages");
    } else {
        log::warn!("Phase 2 ({direction}): no embeddings created from {processed} messages — NOT marking as done");
    }

    Ok(())
}

// ── Phase 3: Attachment Embedding ──────────────────────────────────────

fn run_phase_attachment_embedding(
    app_handle: &AppHandle,
    chat_conn: &Connection,
    analytics_conn: &Connection,
    vision_session: &mut ort::session::Session,
) -> AppResult<()> {
    log::info!("Phase 3: Attachment embedding...");

    let already_done =
        analytics_db::get_last_processed_rowid(analytics_conn, "embedding_attachments")?;
    if already_done > 0 {
        log::info!("Phase 3: already processed, skipping.");
        return Ok(());
    }

    // Find messages with attachments
    let mut stmt = chat_conn.prepare(
        "SELECT m.ROWID, cmj.chat_id
         FROM message AS m
         LEFT JOIN chat_message_join AS cmj ON cmj.message_id = m.ROWID
         WHERE m.cache_has_attachments = 1
           AND m.associated_message_type = 0
         ORDER BY m.ROWID DESC
         LIMIT 500",
    )?;

    let msg_rows: Vec<(i64, i64)> = stmt
        .query_map([], |row| {
            let rowid: i64 = row.get(0)?;
            let chat_id: Option<i64> = row.get(1)?;
            Ok((rowid, chat_id.unwrap_or(0)))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let total = msg_rows.len() as i64;
    let mut processed: i64 = 0;
    let mut embeddings_created: i64 = 0;

    for (message_rowid, chat_id) in &msg_rows {
        let attachments = chat_db::get_attachments_for_message(chat_conn, *message_rowid)?;

        for attachment in &attachments {
            let mime = match &attachment.mime_type {
                Some(m) => m.as_str(),
                None => continue,
            };

            let filename = match &attachment.filename {
                Some(f) => f.as_str(),
                None => continue,
            };

            // Skip pluginPayloadAttachment files
            if filename.ends_with(".pluginPayloadAttachment") {
                continue;
            }

            // Handle image types
            if is_embeddable_image(mime) {
                let image_bytes = match read_attachment_bytes(filename, attachment.rowid) {
                    Some(bytes) => bytes,
                    None => continue,
                };

                match clip::encode_image(vision_session, &image_bytes) {
                    Ok(embedding) => {
                        let blob = clip::embedding_to_blob(&embedding);
                        if let Err(e) = analytics_db::insert_embedding(
                            analytics_conn,
                            "attachment",
                            attachment.rowid,
                            None,
                            *chat_id,
                            "mobileclip-s2",
                            &blob,
                        ) {
                            log::debug!(
                                "Failed to insert attachment embedding {}: {e}",
                                attachment.rowid
                            );
                        } else {
                            embeddings_created += 1;
                        }
                    }
                    Err(e) => {
                        log::debug!(
                            "Failed to encode attachment {}: {e}",
                            attachment.rowid
                        );
                    }
                }
            } else if mime == "application/pdf" {
                log::debug!(
                    "Skipping PDF attachment {} (not yet supported)",
                    attachment.rowid
                );
            }
        }

        processed += 1;
        if processed % 50 == 0 {
            emit_progress(app_handle, "attachments", processed, total);
        }
    }

    if embeddings_created > 0 {
        let max_rowid = msg_rows.iter().map(|(r, _)| *r).max().unwrap_or(0);
        analytics_db::update_processing_state(
            analytics_conn,
            "embedding_attachments",
            max_rowid,
            processed,
        )?;
    }

    emit_progress(app_handle, "attachments", processed, total);
    log::info!("Phase 3 complete: {embeddings_created} attachment embeddings from {processed} messages");
    Ok(())
}

// ── Attachment helpers ─────────────────────────────────────────────────

fn is_embeddable_image(mime: &str) -> bool {
    matches!(
        mime,
        "image/jpeg"
            | "image/png"
            | "image/gif"
            | "image/webp"
            | "image/tiff"
            | "image/bmp"
            | "image/heic"
            | "image/heif"
    )
}

/// Read an attachment file, handling HEIC conversion via sips.
fn read_attachment_bytes(filename: &str, attachment_rowid: i64) -> Option<Vec<u8>> {
    let path = expand_tilde(filename)?;
    if !path.exists() {
        return None;
    }

    let meta = std::fs::metadata(&path).ok()?;
    if meta.len() > MAX_IMAGE_SIZE {
        return None;
    }

    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if extension == "heic" || extension == "heif" {
        // Convert via sips to JPEG
        let temp_dir = std::env::temp_dir();
        let temp_path = temp_dir.join(format!("mi_pipeline_{attachment_rowid}.jpg"));

        let status = std::process::Command::new("sips")
            .args(["-s", "format", "jpeg", "-s", "formatOptions", "80"])
            .arg(&path)
            .arg("--out")
            .arg(&temp_path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .ok()?;

        if !status.success() {
            log::debug!("sips conversion failed for: {}", path.display());
            return None;
        }

        let bytes = std::fs::read(&temp_path).ok()?;
        let _ = std::fs::remove_file(&temp_path);
        Some(bytes)
    } else {
        std::fs::read(&path).ok()
    }
}
