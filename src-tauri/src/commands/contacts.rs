use std::collections::HashMap;
use tauri::State;

use crate::db::contacts_db;
use crate::error::AppResult;
use crate::state::AppState;

/// Resolve a single phone number or email to a contact name.
#[tauri::command]
pub fn get_contact_name(
    state: State<'_, AppState>,
    identifier: String,
) -> AppResult<Option<String>> {
    Ok(contacts_db::resolve_name(&identifier, &state.contact_map))
}

/// Return the full contact map to the frontend.
#[tauri::command]
pub fn get_contact_map(
    state: State<'_, AppState>,
) -> AppResult<HashMap<String, String>> {
    Ok(state.contact_map.clone())
}
