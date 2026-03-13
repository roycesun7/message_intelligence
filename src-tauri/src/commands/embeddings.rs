use serde::Serialize;
use tauri::State;

use crate::db::{analytics_db, chat_db};
use crate::error::AppResult;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingStatus {
    pub total_embedded: i64,
    pub total_messages: i64,
}

/// Check the current status of the embedding pipeline.
/// Returns embedding progress counts.
#[tauri::command]
pub fn check_embedding_status(state: State<'_, AppState>) -> AppResult<EmbeddingStatus> {
    let chat_conn = state
        .lock_chat_db()?;
    let analytics_conn = state
        .lock_analytics_db()?;

    let total_messages = chat_db::get_total_message_count(&chat_conn)?;
    let total_embedded = analytics_db::count_embeddings(&analytics_conn)?;

    Ok(EmbeddingStatus {
        total_embedded,
        total_messages,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSearchResult {
    pub message_rowid: i64,
    pub score: f64,
    pub text: String,
}

/// Semantic search across messages (stub — returns empty results for now).
#[tauri::command]
pub fn semantic_search(
    _state: State<'_, AppState>,
    _query: String,
    _limit: Option<i64>,
) -> AppResult<Vec<SemanticSearchResult>> {
    // TODO: implement once embedding pipeline is connected
    Ok(Vec::new())
}
