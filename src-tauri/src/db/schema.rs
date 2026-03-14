use rusqlite::Connection;

use crate::error::AppResult;

pub fn run_migrations(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS embedding_state (
            message_rowid INTEGER PRIMARY KEY,
            model         TEXT NOT NULL,
            embedded_at   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS wrapped_cache (
            year        INTEGER PRIMARY KEY,
            result_json TEXT NOT NULL,
            computed_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        ",
    )?;

    conn.execute_batch("DROP TABLE IF EXISTS embedding_state;")?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS message_chunks (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id           INTEGER NOT NULL,
            is_from_me        INTEGER NOT NULL,
            handle_id         INTEGER,
            first_rowid       INTEGER NOT NULL,
            last_rowid        INTEGER NOT NULL,
            message_count     INTEGER NOT NULL,
            concatenated_text TEXT NOT NULL,
            started_at        INTEGER NOT NULL,
            ended_at          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chunks_chat ON message_chunks(chat_id);
        CREATE INDEX IF NOT EXISTS idx_chunks_first_rowid ON message_chunks(first_rowid);

        CREATE TABLE IF NOT EXISTS embeddings (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            source_type TEXT NOT NULL,
            source_id   INTEGER NOT NULL,
            chunk_id    INTEGER,
            chat_id     INTEGER NOT NULL,
            model       TEXT NOT NULL,
            vector      BLOB NOT NULL,
            embedded_at TEXT NOT NULL,
            UNIQUE(source_type, source_id)
        );
        CREATE INDEX IF NOT EXISTS idx_embeddings_chat ON embeddings(chat_id);

        CREATE TABLE IF NOT EXISTS search_settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        ",
    )?;

    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS links_fts USING fts5(
            url, domain, title, category, content=links, content_rowid=id
        );",
    )?;

    Ok(())
}
