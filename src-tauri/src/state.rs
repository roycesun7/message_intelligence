use rusqlite::Connection;
use std::sync::Mutex;

/// Holds two database connections:
/// - `chat_db`: read-only connection to Apple's ~/Library/Messages/chat.db
/// - `analytics_db`: read-write connection to our computed analytics data
pub struct AppState {
    pub chat_db: Mutex<Connection>,
    pub analytics_db: Mutex<Connection>,
}
