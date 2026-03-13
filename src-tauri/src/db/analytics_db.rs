use rusqlite::{params, Connection};

use crate::error::AppResult;

// ── Processing state (incremental pipeline tracking) ────────────────────

/// Get the last processed message ROWID for a given pipeline name.
pub fn get_last_processed_rowid(conn: &Connection, pipeline: &str) -> AppResult<i64> {
    let result: Result<i64, _> = conn.query_row(
        "SELECT last_rowid FROM processing_state WHERE pipeline_name = ?1",
        params![pipeline],
        |row| row.get(0),
    );
    Ok(result.unwrap_or(0))
}

/// Update (upsert) the processing state for a pipeline.
pub fn update_processing_state(
    conn: &Connection,
    pipeline: &str,
    last_rowid: i64,
    processed_count: i64,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO processing_state (pipeline_name, last_rowid, processed_count, updated_at)
         VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(pipeline_name) DO UPDATE SET
             last_rowid = excluded.last_rowid,
             processed_count = excluded.processed_count,
             updated_at = excluded.updated_at",
        params![pipeline, last_rowid, processed_count],
    )?;
    Ok(())
}

// ── Sentiment storage ───────────────────────────────────────────────────

/// Store a sentiment analysis result for a message.
pub fn store_sentiment(
    conn: &Connection,
    message_rowid: i64,
    compound: f64,
    positive: f64,
    negative: f64,
    neutral: f64,
    emoji_conflict: bool,
) -> AppResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO message_sentiment
            (message_rowid, compound, positive, negative, neutral, emoji_conflict, analyzed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))",
        params![message_rowid, compound, positive, negative, neutral, emoji_conflict],
    )?;
    Ok(())
}

// ── Embeddings (MobileCLIP-S2) ─────────────────────────────────────────

/// Insert a message chunk.
pub fn insert_chunk(
    conn: &Connection,
    chat_id: i64,
    is_from_me: bool,
    handle_id: Option<i64>,
    first_rowid: i64,
    last_rowid: i64,
    message_count: i64,
    concatenated_text: &str,
    started_at: i64,
    ended_at: i64,
) -> AppResult<i64> {
    conn.execute(
        "INSERT INTO message_chunks
            (chat_id, is_from_me, handle_id, first_rowid, last_rowid, message_count, concatenated_text, started_at, ended_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![chat_id, is_from_me, handle_id, first_rowid, last_rowid, message_count, concatenated_text, started_at, ended_at],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Insert an embedding vector.
pub fn insert_embedding(
    conn: &Connection,
    source_type: &str,
    source_id: i64,
    chunk_id: Option<i64>,
    chat_id: i64,
    model: &str,
    vector: &[u8],
) -> AppResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO embeddings
            (source_type, source_id, chunk_id, chat_id, model, vector, embedded_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))",
        params![source_type, source_id, chunk_id, chat_id, model, vector],
    )?;
    Ok(())
}

/// Count total embeddings.
pub fn count_embeddings(conn: &Connection) -> AppResult<i64> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM embeddings",
        [],
        |row| row.get(0),
    )?;
    Ok(count)
}

/// Load all embedding vectors for brute-force search.
/// Returns (id, source_type, source_id, chunk_id, chat_id, vector_blob).
pub fn load_all_embeddings(conn: &Connection) -> AppResult<Vec<(i64, String, i64, Option<i64>, i64, Vec<u8>)>> {
    let mut stmt = conn.prepare(
        "SELECT id, source_type, source_id, chunk_id, chat_id, vector FROM embeddings"
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
            row.get(5)?,
        ))
    })?
    .filter_map(|r| r.ok())
    .collect();
    Ok(rows)
}

/// Get or set a search setting.
pub fn get_search_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM search_settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    ).ok()
}

pub fn set_search_setting(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO search_settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )?;
    Ok(())
}

/// Clear all embedding data (for rebuild).
pub fn clear_embeddings(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "DELETE FROM embeddings;
         DELETE FROM message_chunks;
         DELETE FROM processing_state WHERE pipeline_name IN ('chunking', 'embedding_recent', 'embedding_oldest');"
    )?;
    Ok(())
}

// ── Wrapped cache ──────────────────────────────────────────────────────

/// Retrieve cached wrapped stats for a given year (0 = all time).
/// Returns the JSON string if a cached entry exists, otherwise None.
pub fn get_cached_wrapped(conn: &Connection, year: i64) -> Option<String> {
    conn.query_row(
        "SELECT result_json FROM wrapped_cache WHERE year = ?1",
        params![year],
        |row| row.get(0),
    )
    .ok()
}

/// Store computed wrapped stats JSON for a given year.
pub fn set_cached_wrapped(conn: &Connection, year: i64, json: &str) -> AppResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO wrapped_cache (year, result_json, computed_at)
         VALUES (?1, ?2, datetime('now'))",
        params![year, json],
    )?;
    Ok(())
}

/// Delete cached wrapped stats for a specific year, or all if year is None.
pub fn invalidate_wrapped_cache(conn: &Connection, year: Option<i64>) -> AppResult<()> {
    if let Some(y) = year {
        conn.execute("DELETE FROM wrapped_cache WHERE year = ?1", params![y])?;
    } else {
        conn.execute("DELETE FROM wrapped_cache", [])?;
    }
    Ok(())
}

// ── Link storage ────────────────────────────────────────────────────────

/// Store a discovered link extracted from a message.
pub fn store_link(
    conn: &Connection,
    url: &str,
    domain: &str,
    title: Option<&str>,
    category: Option<&str>,
    message_rowid: i64,
    chat_id: i64,
    sender: Option<&str>,
    shared_at: i64,
) -> AppResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO links
            (url, domain, title, category, message_rowid, chat_id, sender, shared_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![url, domain, title, category, message_rowid, chat_id, sender, shared_at],
    )?;
    Ok(())
}
