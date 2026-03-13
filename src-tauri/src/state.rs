use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use crate::error::{AppError, AppResult};

/// Holds two database connections:
/// - `chat_db`: read-only connection to Apple's ~/Library/Messages/chat.db
/// - `analytics_db`: read-write connection to our computed analytics data
/// - `contact_map`: phone/email -> display name, from macOS Address Book
pub struct AppState {
    pub chat_db: Arc<Mutex<Connection>>,
    pub analytics_db: Arc<Mutex<Connection>>,
    pub contact_map: HashMap<String, String>,
}

impl AppState {
    /// Lock chat_db, recovering from poison (safe for read-only connections).
    pub fn lock_chat_db(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.chat_db
            .lock()
            .or_else(|poisoned| Ok(poisoned.into_inner()))
            .map_err(|_: ()| AppError::Custom("Failed to lock chat_db".into()))
    }

    /// Lock analytics_db, recovering from poison.
    pub fn lock_analytics_db(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.analytics_db
            .lock()
            .or_else(|poisoned| Ok(poisoned.into_inner()))
            .map_err(|_: ()| AppError::Custom("Failed to lock analytics_db".into()))
    }
}
