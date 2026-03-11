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
