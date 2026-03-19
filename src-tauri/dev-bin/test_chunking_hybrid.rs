//! Chunking strategy: HYBRID
//! Combines conversation window detection (1hr gap) with intelligent subdivision:
//! - Within each conversation window, group into sub-chunks of ~200-280 chars
//! - Include sender labels for conversational context
//! - Subdivide at turn boundaries (sender changes) when possible
//! - Also tests "topic sentence" approach: prepend a summary prefix

use rusqlite::Connection;
use std::collections::HashMap;

const CHAT_ID: i64 = 341;
const MSG_LIMIT: i64 = 5000;
const MAX_CHUNK_CHARS: usize = 280;

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

struct HybridChunk {
    text: String,
    message_count: usize,
    first_rowid: i64,
    last_rowid: i64,
}

/// Hybrid: conversation windows (by gap) subdivided into <=MAX_CHUNK_CHARS pieces
/// at natural turn boundaries, with sender labels
fn chunk_hybrid(
    messages: &[app_lib::db::models::Message],
    gap_ms: i64,
    max_chars: usize,
) -> Vec<HybridChunk> {
    if messages.is_empty() {
        return vec![];
    }

    // Step 1: Detect conversation windows by time gap
    let mut windows: Vec<Vec<usize>> = Vec::new(); // indices into messages
    let mut current_window: Vec<usize> = vec![0];

    for i in 1..messages.len() {
        let time_diff = (messages[i].date - messages[i - 1].date).abs();
        if time_diff > gap_ms {
            windows.push(current_window);
            current_window = vec![i];
        } else {
            current_window.push(i);
        }
    }
    windows.push(current_window);

    // Step 2: Within each window, build turns and subdivide
    let mut chunks: Vec<HybridChunk> = Vec::new();

    for window_indices in &windows {
        // Build labeled message lines
        let mut lines: Vec<(String, usize)> = Vec::new(); // (text, msg_index)
        for &idx in window_indices {
            let msg = &messages[idx];
            if let Some(ref text) = msg.text {
                if !text.trim().is_empty() {
                    let label = if msg.is_from_me { "Me" } else { "Them" };
                    lines.push((format!("{}: {}", label, text), idx));
                }
            }
        }

        if lines.is_empty() {
            continue;
        }

        // Greedily fill chunks up to max_chars, splitting at line boundaries
        let mut current_text = String::new();
        let mut current_first_idx = lines[0].1;
        let mut current_last_idx = lines[0].1;
        let mut current_count = 0;

        for (line_text, msg_idx) in &lines {
            let addition_len = if current_text.is_empty() {
                line_text.len()
            } else {
                3 + line_text.len() // " | " separator
            };

            if current_text.len() + addition_len > max_chars && !current_text.is_empty() {
                chunks.push(HybridChunk {
                    text: current_text,
                    message_count: current_count,
                    first_rowid: messages[current_first_idx].rowid,
                    last_rowid: messages[current_last_idx].rowid,
                });
                current_text = line_text.clone();
                current_first_idx = *msg_idx;
                current_last_idx = *msg_idx;
                current_count = 1;
            } else {
                if !current_text.is_empty() {
                    current_text.push_str(" | ");
                }
                current_text.push_str(line_text);
                current_last_idx = *msg_idx;
                current_count += 1;
            }
        }

        if !current_text.is_empty() {
            chunks.push(HybridChunk {
                text: current_text,
                message_count: current_count,
                first_rowid: messages[current_first_idx].rowid,
                last_rowid: messages[current_last_idx].rowid,
            });
        }
    }

    chunks
}

/// Hybrid variant 2: Same as above but with overlapping context.
/// Each chunk starts with the last message of the previous chunk for continuity.
fn chunk_hybrid_overlap(
    messages: &[app_lib::db::models::Message],
    gap_ms: i64,
    max_chars: usize,
) -> Vec<HybridChunk> {
    if messages.is_empty() {
        return vec![];
    }

    // Step 1: Detect conversation windows by time gap
    let mut windows: Vec<Vec<usize>> = Vec::new();
    let mut current_window: Vec<usize> = vec![0];

    for i in 1..messages.len() {
        let time_diff = (messages[i].date - messages[i - 1].date).abs();
        if time_diff > gap_ms {
            windows.push(current_window);
            current_window = vec![i];
        } else {
            current_window.push(i);
        }
    }
    windows.push(current_window);

    // Step 2: Within each window, build turns and subdivide with 1-message overlap
    let mut chunks: Vec<HybridChunk> = Vec::new();

    for window_indices in &windows {
        let mut lines: Vec<(String, usize)> = Vec::new();
        for &idx in window_indices {
            let msg = &messages[idx];
            if let Some(ref text) = msg.text {
                if !text.trim().is_empty() {
                    let label = if msg.is_from_me { "Me" } else { "Them" };
                    lines.push((format!("{}: {}", label, text), idx));
                }
            }
        }

        if lines.is_empty() {
            continue;
        }

        let mut start_line = 0;

        while start_line < lines.len() {
            let mut current_text = String::new();
            let mut current_count = 0;
            let mut end_line = start_line;

            for j in start_line..lines.len() {
                let (ref line_text, _) = lines[j];
                let addition_len = if current_text.is_empty() {
                    line_text.len()
                } else {
                    3 + line_text.len()
                };

                if current_text.len() + addition_len > max_chars && !current_text.is_empty() {
                    break;
                }
                if !current_text.is_empty() {
                    current_text.push_str(" | ");
                }
                current_text.push_str(line_text);
                current_count += 1;
                end_line = j;
            }

            if !current_text.is_empty() {
                chunks.push(HybridChunk {
                    text: current_text,
                    message_count: current_count,
                    first_rowid: messages[lines[start_line].1].rowid,
                    last_rowid: messages[lines[end_line].1].rowid,
                });
            }

            // Move forward, but overlap by keeping last 1 message
            if end_line == start_line {
                start_line = end_line + 1;
            } else {
                start_line = end_line; // overlap: start next chunk from the last msg of this chunk
            }
        }
    }

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
    eprintln!("[hybrid] Fetched {} messages", messages.len());

    // Load models
    let models_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/models");
    let mut text_session = ort::session::Session::builder()
        .unwrap()
        .commit_from_file(models_dir.join("mobileclip_s2_text.onnx"))
        .expect("Failed to load text encoder");
    let tokenizer = tokenizers::Tokenizer::from_file(models_dir.join("tokenizer.json"))
        .expect("Failed to load tokenizer");

    // Test configurations
    let gap_1hr = 60 * 60 * 1000i64;

    let configs: Vec<(&str, Vec<HybridChunk>)> = vec![
        ("hybrid-1hr-280ch", chunk_hybrid(&messages, gap_1hr, 280)),
        ("hybrid-1hr-200ch", chunk_hybrid(&messages, gap_1hr, 200)),
        ("hybrid-1hr-150ch", chunk_hybrid(&messages, gap_1hr, 150)),
        ("hybrid-overlap-1hr-280ch", chunk_hybrid_overlap(&messages, gap_1hr, 280)),
    ];

    for (label, chunks) in &configs {
        eprintln!("[hybrid] Testing {}...", label);

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
        let avg_len: f64 = chunk_texts.iter().map(|t| t.len() as f64).sum::<f64>() / chunk_texts.len().max(1) as f64;
        let avg_msgs: f64 = chunks.iter().map(|c| c.message_count as f64).sum::<f64>() / chunks.len().max(1) as f64;
        let median_len = {
            let mut lens: Vec<usize> = chunk_texts.iter().map(|t| t.len()).collect();
            lens.sort();
            if lens.is_empty() { 0 } else { lens[lens.len() / 2] }
        };
        let over_280: usize = chunk_texts.iter().filter(|t| t.len() > 280).count();

        println!("=== HYBRID: {} ===", label);
        println!("Messages: {}", messages.len());
        println!("Chunks: {}", chunks.len());
        println!("Embeddings: {}", embeddings.len());
        println!("Avg chars/chunk: {:.0}", avg_len);
        println!("Median chars/chunk: {}", median_len);
        println!("Avg msgs/chunk: {:.1}", avg_msgs);
        println!("Chunks >280ch: {} ({:.1}%)", over_280, over_280 as f64 / chunks.len().max(1) as f64 * 100.0);
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
                println!("  #{}: [{:.4}] {}", rank + 1, score, preview);
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
