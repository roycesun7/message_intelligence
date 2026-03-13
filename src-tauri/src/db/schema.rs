use rusqlite::Connection;

use crate::error::AppResult;

/// Run all migrations on the analytics database.
/// Creates tables if they do not already exist.
pub fn run_migrations(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "
        -- Tracks incremental processing position for each pipeline
        CREATE TABLE IF NOT EXISTS processing_state (
            pipeline_name TEXT PRIMARY KEY,
            last_rowid    INTEGER NOT NULL DEFAULT 0,
            processed_count INTEGER NOT NULL DEFAULT 0,
            updated_at    TEXT NOT NULL
        );

        -- Per-message sentiment scores
        CREATE TABLE IF NOT EXISTS message_sentiment (
            message_rowid  INTEGER PRIMARY KEY,
            compound       REAL NOT NULL,
            positive       REAL NOT NULL,
            negative       REAL NOT NULL,
            neutral        REAL NOT NULL,
            emoji_conflict INTEGER NOT NULL DEFAULT 0,
            analyzed_at    TEXT NOT NULL
        );

        -- Tracks which messages have been embedded and by which model
        CREATE TABLE IF NOT EXISTS embedding_state (
            message_rowid INTEGER PRIMARY KEY,
            model         TEXT NOT NULL,
            embedded_at   TEXT NOT NULL
        );

        -- Conversation windows for time-series analysis
        CREATE TABLE IF NOT EXISTS conversation_windows (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id       INTEGER NOT NULL,
            window_start  INTEGER NOT NULL,
            window_end    INTEGER NOT NULL,
            message_count INTEGER NOT NULL,
            participants  TEXT,
            summary       TEXT
        );

        -- Per-message topic assignments
        CREATE TABLE IF NOT EXISTS message_topics (
            message_rowid INTEGER NOT NULL,
            topic_id      INTEGER NOT NULL,
            confidence    REAL NOT NULL DEFAULT 1.0,
            PRIMARY KEY (message_rowid, topic_id)
        );

        -- Topic definitions
        CREATE TABLE IF NOT EXISTS topics (
            id    INTEGER PRIMARY KEY AUTOINCREMENT,
            label TEXT NOT NULL UNIQUE,
            count INTEGER NOT NULL DEFAULT 0
        );

        -- Aggregated relationship metrics per chat
        CREATE TABLE IF NOT EXISTS relationship_metrics (
            chat_id            INTEGER PRIMARY KEY,
            total_messages     INTEGER NOT NULL DEFAULT 0,
            sent_count         INTEGER NOT NULL DEFAULT 0,
            received_count     INTEGER NOT NULL DEFAULT 0,
            avg_response_time  REAL,
            sentiment_avg      REAL,
            last_computed      TEXT NOT NULL
        );

        -- Links shared in conversations
        CREATE TABLE IF NOT EXISTS links (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            url           TEXT NOT NULL,
            domain        TEXT NOT NULL,
            title         TEXT,
            category      TEXT,
            message_rowid INTEGER NOT NULL,
            chat_id       INTEGER NOT NULL,
            sender        TEXT,
            shared_at     INTEGER NOT NULL,
            UNIQUE(url, message_rowid)
        );

        -- Attachment metadata cache
        CREATE TABLE IF NOT EXISTS attachment_metadata (
            attachment_rowid INTEGER PRIMARY KEY,
            message_rowid    INTEGER NOT NULL,
            file_type        TEXT,
            file_size        INTEGER,
            extracted_text   TEXT,
            analyzed_at      TEXT
        );

        -- Cache for expensive wrapped/analytics computations
        CREATE TABLE IF NOT EXISTS wrapped_cache (
            year        INTEGER PRIMARY KEY,
            result_json TEXT NOT NULL,
            computed_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        ",
    )?;

    // Drop legacy Ollama embedding tracking table
    conn.execute_batch("DROP TABLE IF EXISTS embedding_state;")?;

    // New tables for MobileCLIP-S2 semantic search
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

    // FTS5 virtual table for full-text search on links (separate statement
    // because CREATE VIRTUAL TABLE cannot be inside execute_batch on some
    // SQLite builds).
    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS links_fts USING fts5(
            url, domain, title, category, content=links, content_rowid=id
        );",
    )?;

    Ok(())
}
