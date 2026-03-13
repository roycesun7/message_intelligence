use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use crate::error::{AppError, AppResult};

/// Holds two database connections:
/// - `chat_db`: read-only connection to Apple's ~/Library/Messages/chat.db (None if FDA not granted)
/// - `analytics_db`: read-write connection to our computed analytics data
/// - `contact_map`: phone/email -> display name, from macOS Address Book
pub struct AppState {
    pub chat_db: Arc<Mutex<Option<Connection>>>,
    pub analytics_db: Arc<Mutex<Connection>>,
    pub contact_map: Arc<Mutex<HashMap<String, String>>>,
}

/// A guard that holds the MutexGuard and provides access to the inner Connection.
pub struct ChatDbGuard<'a>(MutexGuard<'a, Option<Connection>>);

impl<'a> std::ops::Deref for ChatDbGuard<'a> {
    type Target = Connection;
    fn deref(&self) -> &Connection {
        self.0.as_ref().unwrap()
    }
}

impl AppState {
    /// Lock chat_db, recovering from poison (safe for read-only connections).
    /// Returns an error if Full Disk Access has not been granted (Option is None).
    pub fn lock_chat_db(&self) -> AppResult<ChatDbGuard<'_>> {
        let guard = self
            .chat_db
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.is_none() {
            return Err(AppError::FullDiskAccessRequired);
        }
        Ok(ChatDbGuard(guard))
    }

    /// Lock analytics_db, recovering from poison.
    pub fn lock_analytics_db(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.analytics_db
            .lock()
            .or_else(|poisoned| Ok(poisoned.into_inner()))
            .map_err(|_: ()| AppError::Custom("Failed to lock analytics_db".into()))
    }
}
