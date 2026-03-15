use serde::Serialize;
use tauri::State;

use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FdaStatus {
    pub has_access: bool,
    pub chat_db_connected: bool,
    pub message: String,
}

/// Check whether Full Disk Access is available (i.e., chat.db is connected).
#[tauri::command]
pub fn check_fda_status(state: State<'_, AppState>) -> AppResult<FdaStatus> {
    let chat_db = state
        .chat_db
        .lock()
        .map_err(|e| AppError::Custom(e.to_string()))?;

    let connected = chat_db.is_some();

    Ok(FdaStatus {
        has_access: connected,
        chat_db_connected: connected,
        message: if connected {
            "Full Disk Access granted. Messages loaded.".to_string()
        } else {
            "Full Disk Access is required to read your iMessage history.".to_string()
        },
    })
}

/// Open macOS System Settings to the Full Disk Access pane.
#[tauri::command]
pub fn open_system_settings() -> AppResult<()> {
    // macOS 13+ (Ventura): System Settings
    let status = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
        .status();

    match status {
        Ok(s) if s.success() => Ok(()),
        _ => {
            // Fallback: open generic Privacy pane
            std::process::Command::new("open")
                .arg("x-apple.systempreferences:com.apple.preference.security?Privacy")
                .status()
                .map_err(|e| AppError::Custom(format!("Failed to open System Settings: {e}")))?;
            Ok(())
        }
    }
}

/// Attempt to (re)connect to chat.db after the user grants Full Disk Access.
/// Also rebuilds the contact map on success.
#[tauri::command]
pub fn retry_chat_db_connection(state: State<'_, AppState>) -> AppResult<FdaStatus> {
    // Try to open chat.db
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::Custom("Cannot determine home directory".into()))?;
    let path = home.join("Library/Messages/chat.db");

    if !path.exists() {
        return Ok(FdaStatus {
            has_access: false,
            chat_db_connected: false,
            message: "chat.db not found. Make sure Full Disk Access is granted in System Settings > Privacy & Security > Full Disk Access, then restart the app.".to_string(),
        });
    }

    let conn = match rusqlite::Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) {
        Ok(c) => c,
        Err(e) => {
            return Ok(FdaStatus {
                has_access: false,
                chat_db_connected: false,
                message: format!("Could not open chat.db: {e}. Ensure Full Disk Access is granted."),
            });
        }
    };

    // Apply pragmas
    if let Err(e) = conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA query_only = true;") {
        return Ok(FdaStatus {
            has_access: false,
            chat_db_connected: false,
            message: format!("Database pragma error: {e}"),
        });
    }

    // Update the state with the new connection
    {
        let mut chat_db = state
            .chat_db
            .lock()
            .map_err(|e| AppError::Custom(e.to_string()))?;
        *chat_db = Some(conn);
    }

    // Rebuild contact map
    {
        let new_contacts = match db::contacts_db::build_contact_map() {
            Ok(map) => map,
            Err(_) => std::collections::HashMap::new(),
        };
        let mut contact_map = state
            .contact_map
            .lock()
            .map_err(|e| AppError::Custom(e.to_string()))?;
        *contact_map = new_contacts;
    }

    Ok(FdaStatus {
        has_access: true,
        chat_db_connected: true,
        message: "Successfully connected to iMessage database!".to_string(),
    })
}
