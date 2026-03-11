use tauri::State;

use crate::db::chat_db;
use crate::db::models::{Attachment, Chat, Message};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Return every chat with its most-recent message, sorted by date DESC.
#[tauri::command]
pub fn get_chats(state: State<'_, AppState>) -> AppResult<Vec<Chat>> {
    let conn = state
        .chat_db
        .lock()
        .map_err(|e| AppError::Custom(e.to_string()))?;
    chat_db::get_chat_list(&conn)
}

/// Return messages for a specific chat, with pagination.
#[tauri::command]
pub fn get_messages(
    state: State<'_, AppState>,
    chat_id: i64,
    limit: Option<i64>,
    offset: Option<i64>,
) -> AppResult<Vec<Message>> {
    let conn = state
        .chat_db
        .lock()
        .map_err(|e| AppError::Custom(e.to_string()))?;
    let lim = limit.unwrap_or(1000);
    let off = offset.unwrap_or(0);
    chat_db::get_messages_for_chat(&conn, chat_id, lim, off)
}

/// Return attachments for a given message ROWID.
#[tauri::command]
pub fn get_message_attachments(
    state: State<'_, AppState>,
    message_id: i64,
) -> AppResult<Vec<Attachment>> {
    let conn = state
        .chat_db
        .lock()
        .map_err(|e| AppError::Custom(e.to_string()))?;
    chat_db::get_attachments_for_message(&conn, message_id)
}

/// Return the total count of non-reaction messages.
#[tauri::command]
pub fn get_message_count(state: State<'_, AppState>) -> AppResult<i64> {
    let conn = state
        .chat_db
        .lock()
        .map_err(|e| AppError::Custom(e.to_string()))?;
    chat_db::get_total_message_count(&conn)
}
