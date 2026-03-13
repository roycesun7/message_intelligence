use std::collections::HashMap;
use tauri::State;

use crate::db::contacts_db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Resolve a single phone number or email to a contact name.
#[tauri::command]
pub fn get_contact_name(
    state: State<'_, AppState>,
    identifier: String,
) -> AppResult<Option<String>> {
    let contact_map = state
        .contact_map
        .lock()
        .map_err(|e| AppError::Custom(e.to_string()))?;
    Ok(contacts_db::resolve_name(&identifier, &contact_map))
}

/// Return the full contact map to the frontend.
#[tauri::command]
pub fn get_contact_map(
    state: State<'_, AppState>,
) -> AppResult<HashMap<String, String>> {
    let contact_map = state
        .contact_map
        .lock()
        .map_err(|e| AppError::Custom(e.to_string()))?;
    Ok(contact_map.clone())
}
