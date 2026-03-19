//! Chunking strategy: LARGER SENDER CHUNKS
//! Same as baseline (same-sender grouping) but with 15min and 30min gap thresholds.
//! Also tests the effect of truncating to 280 chars vs letting CLIP truncate naturally.

use rusqlite::Connection;
use std::collections::HashMap;

const CHAT_ID: i64 = 341;
const MSG_LIMIT: i64 = 5000;

const QUERIES: &[&str] = &[
    "app idea",
    "food restaurant dinner",
    "plans this weekend",
    "arguing disagreement",
    "instagram meme link",
    "career job work",
    "traveling vacation trip",
    "relationship advice",
    "music concert",
    "stats analytics messages",
];

/// Same-sender chunker with configurable gap threshold
fn chunk_same_sender(
    messages: &[app_lib::db::models::Message],
    gap_ms: i64,
) -> Vec<SenderChunk> {
    if messages.is_empty() {
        return vec![];
    }

    let mut chunks: Vec<SenderChunk> = Vec::new();
    let first = &messages[0];
    let mut current = SenderChunk {
        is_from_me: first.is_from_me,
        first_rowid: first.rowid,
        last_rowid: first.rowid,
        message_count: 1,
        text: first.text.clone().unwrap_or_default(),
    };

    for msg in &messages[1..] {
        let sender_changed = msg.is_from_me != current.is_from_me;
        let time_diff = (msg.date - messages.iter().find(|m| m.rowid == current.last_rowid).map(|m| m.date).unwrap_or(0)).abs();
        let time_gap = time_diff > gap_ms;

        if sender_changed || time_gap {
            chunks.push(current);
            current = SenderChunk {
                is_from_me: msg.is_from_me,
                first_rowid: msg.rowid,
                last_rowid: msg.rowid,
                message_count: 1,
                text: msg.text.clone().unwrap_or_default(),
            };
        } else {
            current.last_rowid = msg.rowid;
            current.message_count += 1;
            if let Some(ref text) = msg.text {
                if !current.text.is_empty() {
                    current.text.push(' ');
                }
                current.text.push_str(text);
            }
        }
    }
    chunks.push(current);
    chunks
}

struct SenderChunk {
    is_from_me: bool,
    first_rowid: i64,
    last_rowid: i64,
    message_count: usize,
    text: String,
}

/// Optimized same-sender chunker that tracks the last date directly
fn chunk_same_sender_fast(
    messages: &[app_lib::db::models::Message],
    gap_ms: i64,
) -> Vec<SenderChunk> {
    if messages.is_empty() {
        return vec![];
    }

    let mut chunks: Vec<SenderChunk> = Vec::new();
    let first = &messages[0];
    let mut current = SenderChunk {
        is_from_me: first.is_from_me,
        first_rowid: first.rowid,
        last_rowid: first.rowid,
        message_count: 1,
        text: first.text.clone().unwrap_or_default(),
    };
    let mut current_end_date = first.date;

    for msg in &messages[1..] {
        let sender_changed = msg.is_from_me != current.is_from_me;
        let time_diff = (msg.date - current_end_date).abs();
        let time_gap = time_diff > gap_ms;

        if sender_changed || time_gap {
            chunks.push(current);
            current = SenderChunk {
                is_from_me: msg.is_from_me,
                first_rowid: msg.rowid,
                last_rowid: msg.rowid,
                message_count: 1,
                text: msg.text.clone().unwrap_or_default(),
            };
            current_end_date = msg.date;
        } else {
            current.last_rowid = msg.rowid;
            current.message_count += 1;
            current_end_date = msg.date;
            if let Some(ref text) = msg.text {
                if !current.text.is_empty() {
                    current.text.push(' ');
                }
                current.text.push_str(text);
            }
        }
    }
    chunks.push(current);
    chunks
}

fn main() {
    ort::init_from("/opt/homebrew/lib/libonnxruntime.dylib")
        .expect("Failed to init ort")
        .commit();

    let home = dirs::home_dir().expect("No home dir");
    let chat_conn = Connection::open_with_flags(
        home.join("Library/Messages/chat.db"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .expect("Failed to open chat.db");
    chat_conn.execute_batch("PRAGMA journal_mode = WAL;").unwrap();

    let contact_map = app_lib::db::contacts_db::build_contact_map().unwrap_or_default();
    let handle_map = build_handle_map(&chat_conn);
    let messages = fetch_messages(&chat_conn, CHAT_ID, MSG_LIMIT, &handle_map, &contact_map);
    eprintln!("[large] Fetched {} messages", messages.len());

    // Load models
    let models_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/models");
    let mut text_session = ort::session::Session::builder()
        .unwrap()
        .commit_from_file(models_dir.join("mobileclip_s2_text.onnx"))
        .expect("Failed to load text encoder");
    let tokenizer = tokenizers::Tokenizer::from_file(models_dir.join("tokenizer.json"))
        .expect("Failed to load tokenizer");

    for (label, gap_ms) in &[
        ("15min", 15 * 60 * 1000i64),
        ("30min", 30 * 60 * 1000i64),
    ] {
        eprintln!("[large] Testing {} gap...", label);
        let chunks = chunk_same_sender_fast(&messages, *gap_ms);

        let chunk_texts: Vec<&str> = chunks.iter().map(|c| c.text.as_str()).collect();

        // Embed
        let start = std::time::Instant::now();
        let mut embeddings: Vec<(usize, [f32; 512])> = Vec::new();
        for (i, text) in chunk_texts.iter().enumerate() {
            if text.trim().is_empty() {
                continue;
            }
            match app_lib::embeddings::clip::encode_texts(&mut text_session, &tokenizer, &[*text]) {
                Ok(embs) if !embs.is_empty() => {
                    embeddings.push((i, embs[0]));
                }
                _ => {}
            }
        }
        let embed_time = start.elapsed();

        // Stats
        let non_empty: Vec<&&str> = chunk_texts.iter().filter(|t| !t.trim().is_empty()).collect();
        let avg_len: f64 = non_empty.iter().map(|t| t.len() as f64).sum::<f64>() / non_empty.len().max(1) as f64;
        let avg_msgs: f64 = chunks.iter().map(|c| c.message_count as f64).sum::<f64>() / chunks.len().max(1) as f64;
        let median_len = {
            let mut lens: Vec<usize> = non_empty.iter().map(|t| t.len()).collect();
            lens.sort();
            if lens.is_empty() { 0 } else { lens[lens.len() / 2] }
        };
        let over_280: usize = non_empty.iter().filter(|t| t.len() > 280).count();
        let over_300: usize = non_empty.iter().filter(|t| t.len() > 300).count();

        println!("=== LARGER SENDER: Same-sender, {} gap ===", label);
        println!("Messages: {}", messages.len());
        println!("Chunks: {} ({} non-empty)", chunks.len(), non_empty.len());
        println!("Embeddings: {}", embeddings.len());
        println!("Avg chars/chunk: {:.0}", avg_len);
        println!("Median chars/chunk: {}", median_len);
        println!("Avg msgs/chunk: {:.1}", avg_msgs);
        println!("Chunks >280ch: {} ({:.1}%)", over_280, over_280 as f64 / non_empty.len().max(1) as f64 * 100.0);
        println!("Chunks >300ch: {} ({:.1}%)", over_300, over_300 as f64 / non_empty.len().max(1) as f64 * 100.0);
        println!("Embed time: {:.1}s ({:.1} chunks/sec)", embed_time.as_secs_f64(), embeddings.len() as f64 / embed_time.as_secs_f64());
        println!();

        // Search
        let mut total_top1 = 0.0f64;
        let mut total_top3_avg = 0.0f64;
        for query in QUERIES {
            println!("Query: \"{}\"", query);
            let query_emb = match app_lib::embeddings::clip::encode_texts(&mut text_session, &tokenizer, &[*query]) {
                Ok(embs) if !embs.is_empty() => embs[0],
                _ => {
                    println!("  (failed to encode query)");
                    continue;
                }
            };

            let mut scored: Vec<(f32, usize)> = embeddings
                .iter()
                .map(|(idx, emb)| {
                    let score = app_lib::embeddings::clip::cosine_similarity(&query_emb, emb);
                    (score, *idx)
                })
                .collect();
            scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());

            let top3: Vec<_> = scored.iter().take(3).collect();
            for (rank, (score, idx)) in top3.iter().enumerate() {
                let text = chunk_texts[*idx];
                let preview = safe_truncate(text, 150);
                let who = if chunks[*idx].is_from_me { "You" } else { "Them" };
                println!("  #{}: [{:.4}] ({}) {}", rank + 1, score, who, preview);
            }

            if !top3.is_empty() {
                total_top1 += top3[0].0 as f64;
                let avg3: f64 = top3.iter().map(|(s, _)| *s as f64).sum::<f64>() / top3.len() as f64;
                total_top3_avg += avg3;
            }
            println!();
        }

        let n = QUERIES.len() as f64;
        println!("--- Summary ({}) ---", label);
        println!("Avg top-1 score: {:.4}", total_top1 / n);
        println!("Avg top-3 mean score: {:.4}", total_top3_avg / n);
        println!();
    }
}

fn safe_truncate(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...", &s[..end])
}

fn build_handle_map(conn: &Connection) -> HashMap<i64, String> {
    let mut stmt = conn.prepare("SELECT ROWID, id FROM handle").unwrap();
    stmt.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })
    .unwrap()
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

    let mut stmt = conn
        .prepare(
            "SELECT m.ROWID, m.guid, m.text, m.attributedBody, m.is_from_me,
                m.date, m.date_read, m.date_delivered, m.handle_id, m.service,
                m.associated_message_type, m.associated_message_guid,
                m.cache_has_attachments, m.thread_originator_guid,
                m.group_title, m.is_audio_message, cmj.chat_id
         FROM message AS m
         INNER JOIN chat_message_join AS cmj ON cmj.message_id = m.ROWID
         WHERE m.associated_message_type = 0 AND cmj.chat_id = ?2
         ORDER BY m.ROWID DESC
         LIMIT ?1",
        )
        .unwrap();

    let raw_rows: Vec<RawMessageRow> = stmt
        .query_map(rusqlite::params![limit, chat_id], |row| {
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
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let mut messages: Vec<_> = raw_rows
        .into_iter()
        .map(|raw| {
            let sender = handle_map.get(&raw.handle_id).cloned();
            let sender_display_name = sender
                .as_ref()
                .and_then(|s| app_lib::db::contacts_db::resolve_name(s, contact_map));
            raw.into_message(sender, sender_display_name)
        })
        .collect();

    messages.sort_by_key(|m| m.rowid);
    messages
}
