use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Holds two database connections:
/// - `chat_db`: read-only connection to Apple's ~/Library/Messages/chat.db
/// - `analytics_db`: read-write connection to our computed analytics data
/// - `contact_map`: phone/email -> display name, from macOS Address Book
pub struct AppState {
    pub chat_db: Arc<Mutex<Connection>>,
    pub analytics_db: Arc<Mutex<Connection>>,
    pub contact_map: HashMap<String, String>,
}
