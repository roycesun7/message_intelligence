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

// ── Embedding state ─────────────────────────────────────────────────────

/// Mark a message as having been embedded by a specific model.
pub fn mark_embedded(conn: &Connection, message_rowid: i64, model: &str) -> AppResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO embedding_state (message_rowid, model, embedded_at)
         VALUES (?1, ?2, datetime('now'))",
        params![message_rowid, model],
    )?;
    Ok(())
}

/// Count total embedded messages.
pub fn count_embedded(conn: &Connection) -> AppResult<i64> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM embedding_state",
        [],
        |row| row.get(0),
    )?;
    Ok(count)
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
