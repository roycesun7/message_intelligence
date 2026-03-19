//! Standalone test binary for the embedding pipeline.
//! Usage: cargo run --bin test_pipeline
//!
//! This bypasses Tauri to directly test chunking + embedding on Serb's chat (ID 341).

use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

fn main() {
    // Initialize ort
    let ort_path = "/opt/homebrew/lib/libonnxruntime.dylib";
    eprintln!("[test] Initializing ONNX Runtime from {ort_path}...");
    ort::init_from(ort_path).expect("Failed to init ort").commit();
    eprintln!("[test] ONNX Runtime initialized");

    // Open databases
    let home = dirs::home_dir().expect("No home dir");
    let chat_db_path = home.join("Library/Messages/chat.db");
    let analytics_db_path = home.join("Library/Application Support/com.icapsule.app/analytics.db");

    eprintln!("[test] Opening chat.db...");
    let chat_conn = Connection::open_with_flags(
        &chat_db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ).expect("Failed to open chat.db");
    chat_conn.execute_batch("PRAGMA journal_mode = WAL;").unwrap();

    eprintln!("[test] Opening analytics.db...");
    let analytics_conn = Connection::open(&analytics_db_path).expect("Failed to open analytics.db");
    analytics_conn.execute_batch("PRAGMA journal_mode = WAL;").unwrap();

    // Clear existing data
    eprintln!("[test] Clearing existing embeddings...");
    analytics_conn.execute_batch(
        "DELETE FROM embeddings; DELETE FROM message_chunks; DELETE FROM processing_state;"
    ).unwrap();

    // Build contact map
    eprintln!("[test] Loading contacts...");
    let contact_map = app_lib::db::contacts_db::build_contact_map().unwrap_or_default();
    eprintln!("[test] Loaded {} contacts", contact_map.len());

    // Build handle map
    let handle_map = build_handle_map(&chat_conn);
    eprintln!("[test] Loaded {} handles", handle_map.len());

    // Fetch 500 messages from chat 341 (Serb)
    let chat_id: i64 = 341;
    let limit: i64 = 10000;
    eprintln!("[test] Fetching {limit} messages from chat {chat_id}...");

    let messages = fetch_messages(&chat_conn, chat_id, limit, &handle_map, &contact_map);
    eprintln!("[test] Got {} messages", messages.len());

    if messages.is_empty() {
        eprintln!("[test] No messages found! Exiting.");
        return;
    }

    // Show a few sample messages
    for msg in messages.iter().take(3) {
        let text_preview = msg.text.as_deref().unwrap_or("(no text)");
        let preview = if text_preview.len() > 80 { &text_preview[..80] } else { text_preview };
        eprintln!("  msg {}: from_me={} text={:?}", msg.rowid, msg.is_from_me, preview);
    }

    // Chunk messages
    eprintln!("[test] Chunking messages...");
    let chunks = app_lib::embeddings::chunker::chunk_messages(&messages);
    eprintln!("[test] Created {} chunks from {} messages", chunks.len(), messages.len());

    // Show chunk stats
    let avg_msgs: f64 = chunks.iter().map(|c| c.message_count as f64).sum::<f64>() / chunks.len() as f64;
    let avg_text_len: f64 = chunks.iter().map(|c| c.concatenated_text.len() as f64).sum::<f64>() / chunks.len() as f64;
    eprintln!("[test] Avg messages per chunk: {avg_msgs:.1}");
    eprintln!("[test] Avg text length per chunk: {avg_text_len:.0} chars");

    // Load CLIP models
    let models_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/models");
    eprintln!("[test] Loading text encoder...");
    let text_session = ort::session::Session::builder()
        .unwrap()
        .commit_from_file(models_dir.join("mobileclip_s2_text.onnx"))
        .expect("Failed to load text encoder");
    eprintln!("[test] Text encoder loaded");

    eprintln!("[test] Loading tokenizer...");
    let tokenizer = tokenizers::Tokenizer::from_file(models_dir.join("tokenizer.json"))
        .expect("Failed to load tokenizer");
    eprintln!("[test] Tokenizer loaded");

    // Embed chunks
    eprintln!("[test] Embedding {} chunks...", chunks.len());
    let mut text_session = text_session;
    let mut embedded_count = 0;
    let mut failed_count = 0;
    let start = std::time::Instant::now();

    for (i, chunk) in chunks.iter().enumerate() {
        if chunk.concatenated_text.trim().is_empty() {
            continue;
        }

        // Insert chunk into analytics.db
        let chunk_db_id = analytics_conn.execute(
            "INSERT INTO message_chunks (chat_id, is_from_me, handle_id, first_rowid, last_rowid, message_count, concatenated_text, started_at, ended_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                chunk.chat_id, chunk.is_from_me, chunk.handle_id,
                chunk.first_rowid, chunk.last_rowid, chunk.message_count,
                chunk.concatenated_text, chunk.started_at, chunk.ended_at
            ],
        ).unwrap();
        let chunk_id = analytics_conn.last_insert_rowid();

        // Encode
        let text_ref: &str = &chunk.concatenated_text;
        match app_lib::embeddings::clip::encode_texts(&mut text_session, &tokenizer, &[text_ref]) {
            Ok(embs) if !embs.is_empty() => {
                let blob = app_lib::embeddings::clip::embedding_to_blob(&embs[0]);
                analytics_conn.execute(
                    "INSERT OR REPLACE INTO embeddings (source_type, source_id, chunk_id, chat_id, model, vector, embedded_at)
                     VALUES ('chunk', ?1, ?2, ?3, 'mobileclip-s2', ?4, datetime('now'))",
                    rusqlite::params![chunk_id, chunk_id, chunk.chat_id, blob],
                ).unwrap();
                embedded_count += 1;
            }
            Ok(_) => { failed_count += 1; }
            Err(e) => {
                if failed_count < 3 {
                    eprintln!("  Failed to embed chunk {}: {e}", chunk_id);
                }
                failed_count += 1;
            }
        }

        if (i + 1) % 50 == 0 || i == chunks.len() - 1 {
            let elapsed = start.elapsed();
            let rate = embedded_count as f64 / elapsed.as_secs_f64();
            eprintln!("[test] Progress: {}/{} chunks embedded ({:.1} chunks/sec)", embedded_count, chunks.len(), rate);
        }
    }

    let elapsed = start.elapsed();
    eprintln!("\n[test] ════════════════════════════════════════");
    eprintln!("[test] Pipeline complete!");
    eprintln!("[test] Messages fetched: {}", messages.len());
    eprintln!("[test] Chunks created: {}", chunks.len());
    eprintln!("[test] Embeddings created: {embedded_count}");
    eprintln!("[test] Failed: {failed_count}");
    eprintln!("[test] Time: {:.1}s ({:.1} chunks/sec)", elapsed.as_secs_f64(), embedded_count as f64 / elapsed.as_secs_f64());

    // Test search queries
    eprintln!("\n[test] Testing semantic search...");
    test_search(&analytics_conn, &chat_conn, &mut text_session, &tokenizer, &contact_map, "app idea product");
    test_search(&analytics_conn, &chat_conn, &mut text_session, &tokenizer, &contact_map, "food restaurant");
    test_search(&analytics_conn, &chat_conn, &mut text_session, &tokenizer, &contact_map, "trolling memes funny");
    test_search(&analytics_conn, &chat_conn, &mut text_session, &tokenizer, &contact_map, "instagram link");
    test_search(&analytics_conn, &chat_conn, &mut text_session, &tokenizer, &contact_map, "stats messages analytics");
}

fn test_search(
    analytics_conn: &Connection,
    chat_conn: &Connection,
    text_session: &mut ort::session::Session,
    tokenizer: &tokenizers::Tokenizer,
    contact_map: &HashMap<String, String>,
    query: &str,
) {
    eprintln!("\n  Query: \"{query}\"");

    // Encode query
    let query_emb = match app_lib::embeddings::clip::encode_texts(text_session, tokenizer, &[query]) {
        Ok(embs) if !embs.is_empty() => embs.into_iter().next().unwrap(),
        _ => {
            eprintln!("  Failed to encode query");
            return;
        }
    };

    // Load all embeddings and score
    let mut stmt = analytics_conn.prepare(
        "SELECT e.id, e.source_id, e.vector, mc.concatenated_text, mc.is_from_me
         FROM embeddings e
         INNER JOIN message_chunks mc ON mc.id = e.source_id
         WHERE e.source_type = 'chunk'"
    ).unwrap();

    let mut scored: Vec<(f64, String, bool)> = stmt.query_map([], |row| {
        let blob: Vec<u8> = row.get(2)?;
        let text: String = row.get(3)?;
        let is_from_me: bool = row.get(4)?;
        Ok((blob, text, is_from_me))
    }).unwrap()
    .filter_map(|r| r.ok())
    .filter_map(|(blob, text, is_from_me)| {
        let emb = app_lib::embeddings::clip::blob_to_embedding(&blob).ok()?;
        let score = app_lib::embeddings::clip::cosine_similarity(&query_emb, &emb) as f64;
        Some((score, text, is_from_me))
    })
    .collect();

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());

    for (score, text, is_from_me) in scored.iter().take(3) {
        let who = if *is_from_me { "You" } else { "Serb" };
        let preview = if text.len() > 120 { format!("{}...", &text[..120]) } else { text.clone() };
        eprintln!("  [{:.3}] ({who}) {preview}", score);
    }
}

fn build_handle_map(conn: &Connection) -> HashMap<i64, String> {
    let mut stmt = conn.prepare("SELECT ROWID, id FROM handle").unwrap();
    stmt.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    }).unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

fn fetch_messages(
    conn: &Connection,
    chat_id: i64,
    limit: i64,
    handle_map: &HashMap<i64, String>,
    contact_map: &HashMap<String, String>,
) -> Vec<app_lib::db::models::Message> {
    use app_lib::db::models::RawMessageRow;

    let mut stmt = conn.prepare(
        "SELECT m.ROWID, m.guid, m.text, m.attributedBody, m.is_from_me,
                m.date, m.date_read, m.date_delivered, m.handle_id, m.service,
                m.associated_message_type, m.associated_message_guid,
                m.cache_has_attachments, m.thread_originator_guid,
                m.group_title, m.is_audio_message, cmj.chat_id
         FROM message AS m
         INNER JOIN chat_message_join AS cmj ON cmj.message_id = m.ROWID
         WHERE m.associated_message_type = 0 AND cmj.chat_id = ?2
         ORDER BY m.ROWID DESC
         LIMIT ?1"
    ).unwrap();

    let raw_rows: Vec<RawMessageRow> = stmt.query_map(rusqlite::params![limit, chat_id], |row| {
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
    }).unwrap()
    .filter_map(|r| r.ok())
    .collect();

    let mut messages: Vec<_> = raw_rows.into_iter().map(|raw| {
        let sender = handle_map.get(&raw.handle_id).cloned();
        let sender_display_name = sender
            .as_ref()
            .and_then(|s| app_lib::db::contacts_db::resolve_name(s, contact_map));
        raw.into_message(sender, sender_display_name)
    }).collect();

    // Sort chronologically for chunking
    messages.sort_by_key(|m| m.rowid);
    messages
}
