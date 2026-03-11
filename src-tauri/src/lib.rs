mod analysis;
mod commands;
mod db;
mod embeddings;
pub mod error;
pub mod ingestion;
mod sidecar;
pub mod state;

use error::{AppError, AppResult};
use rusqlite::Connection;
use state::AppState;
use std::sync::Mutex;
use tauri::Manager;

/// Resolve the path to Apple's chat.db.
fn chat_db_path() -> AppResult<std::path::PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| AppError::Custom("Cannot determine home directory".into()))?;
    let path = home.join("Library/Messages/chat.db");
    if !path.exists() {
        return Err(AppError::ChatDbNotFound);
    }
    Ok(path)
}

/// Open the chat database in read-only mode.
fn open_chat_db() -> AppResult<Connection> {
    let path = chat_db_path()?;
    let conn = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    // Improve read performance
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA query_only = true;")?;
    Ok(conn)
}

/// Open (or create) the analytics database in the app data directory.
fn open_analytics_db(app: &tauri::App) -> AppResult<Connection> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Custom(format!("Cannot resolve app data dir: {e}")))?;
    std::fs::create_dir_all(&data_dir)?;
    let db_path = data_dir.join("analytics.db");
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
    db::schema::run_migrations(&conn)?;
    Ok(conn)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Logging plugin (debug builds only)
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Open databases
            let chat_db = open_chat_db().map_err(|e| {
                log::error!("Failed to open chat.db: {e}");
                Box::new(e) as Box<dyn std::error::Error>
            })?;

            let analytics_db = open_analytics_db(app).map_err(|e| {
                log::error!("Failed to open analytics.db: {e}");
                Box::new(e) as Box<dyn std::error::Error>
            })?;

            // Register app state
            app.manage(AppState {
                chat_db: Mutex::new(chat_db),
                analytics_db: Mutex::new(analytics_db),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Chat / message commands
            commands::messages::get_chats,
            commands::messages::get_messages,
            commands::messages::get_message_attachments,
            commands::messages::get_message_count,
            // Analytics / wrapped commands
            commands::analytics::get_wrapped_stats,
            // Embedding commands (stubs)
            commands::embeddings::check_embedding_status,
            commands::embeddings::semantic_search,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
