use rusqlite::{params, Connection};

use crate::error::AppResult;

pub fn get_last_processed_rowid(conn: &Connection, pipeline: &str) -> AppResult<i64> {
    let result: Result<i64, _> = conn.query_row(
        "SELECT last_rowid FROM processing_state WHERE pipeline_name = ?1",
        params![pipeline],
        |row| row.get(0),
    );
    Ok(result.unwrap_or(0))
}

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

pub fn count_embeddings(conn: &Connection) -> AppResult<i64> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM embeddings",
        [],
        |row| row.get(0),
    )?;
    Ok(count)
}

pub fn count_embeddings_by_type(conn: &Connection, source_type: &str) -> AppResult<i64> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM embeddings WHERE source_type = ?1",
        params![source_type],
        |row| row.get(0),
    )?;
    Ok(count)
}

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

pub fn clear_embeddings(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "DELETE FROM embeddings;
         DELETE FROM message_chunks;
         DELETE FROM processing_state WHERE pipeline_name IN ('chunking', 'embedding_recent', 'embedding_oldest', 'embedding_attachments');"
    )?;
    Ok(())
}

pub fn get_cached_wrapped(conn: &Connection, year: i64) -> Option<String> {
    conn.query_row(
        "SELECT result_json FROM wrapped_cache WHERE year = ?1",
        params![year],
        |row| row.get(0),
    )
    .ok()
}

pub fn set_cached_wrapped(conn: &Connection, year: i64, json: &str) -> AppResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO wrapped_cache (year, result_json, computed_at)
         VALUES (?1, ?2, datetime('now'))",
        params![year, json],
    )?;
    Ok(())
}

pub fn invalidate_wrapped_cache(conn: &Connection, year: Option<i64>) -> AppResult<()> {
    if let Some(y) = year {
        conn.execute("DELETE FROM wrapped_cache WHERE year = ?1", params![y])?;
    } else {
        conn.execute("DELETE FROM wrapped_cache", [])?;
    }
    Ok(())
}
