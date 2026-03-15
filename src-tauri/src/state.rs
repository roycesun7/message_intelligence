use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, MutexGuard, RwLock};

use crate::error::{AppError, AppResult};

/// Tracks each step of the model loading process for diagnostics.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelLoadStep {
    pub name: String,
    pub status: String,       // "pending" | "running" | "success" | "error"
    pub message: Option<String>,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelLoadStatus {
    pub overall: String,      // "pending" | "loading" | "ready" | "error"
    pub ort_dylib_path: Option<String>,
    pub models_dir: Option<String>,
    pub steps: Vec<ModelLoadStep>,
}

/// Holds database connections, contact map, and optional CLIP model sessions.
///
/// - `chat_db`: read-only connection to Apple's ~/Library/Messages/chat.db (None if FDA not granted)
/// - `analytics_db`: read-write connection to our computed analytics data
/// - `contact_map`: phone/email -> display name, from macOS Address Book
/// - `clip_text` / `clip_vision`: MobileCLIP-S2 ONNX sessions (None if models not found)
/// - `tokenizer`: MobileCLIP-S2 tokenizer (None if tokenizer file not found)
pub struct AppState {
    pub chat_db: Arc<Mutex<Option<Connection>>>,
    pub analytics_db: Arc<Mutex<Connection>>,
    pub contact_map: Arc<Mutex<HashMap<String, String>>>,
    /// MobileCLIP-S2 text encoder ONNX session. None until models are loaded.
    /// Wrapped in RwLock so the background loader can set it after app startup.
    pub clip_text: RwLock<Option<Arc<Mutex<ort::session::Session>>>>,
    /// MobileCLIP-S2 image encoder ONNX session. None until models are loaded.
    pub clip_vision: RwLock<Option<Arc<Mutex<ort::session::Session>>>>,
    /// MobileCLIP-S2 tokenizer. None until tokenizer file is loaded.
    pub tokenizer: RwLock<Option<Arc<tokenizers::Tokenizer>>>,
    /// True while the embedding pipeline is running. Prevents concurrent runs.
    pub pipeline_running: AtomicBool,
    /// Tracks model loading progress for frontend diagnostics.
    pub model_load_status: RwLock<ModelLoadStatus>,
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

    /// Set the CLIP text session (called from background loader).
    pub fn set_clip_text(&self, session: Arc<Mutex<ort::session::Session>>) {
        let mut guard = self.clip_text.write().unwrap_or_else(|p| p.into_inner());
        *guard = Some(session);
    }

    /// Set the CLIP vision session (called from background loader).
    pub fn set_clip_vision(&self, session: Arc<Mutex<ort::session::Session>>) {
        let mut guard = self.clip_vision.write().unwrap_or_else(|p| p.into_inner());
        *guard = Some(session);
    }

    /// Set the tokenizer (called from background loader).
    pub fn set_tokenizer(&self, tokenizer: Arc<tokenizers::Tokenizer>) {
        let mut guard = self.tokenizer.write().unwrap_or_else(|p| p.into_inner());
        *guard = Some(tokenizer);
    }

    pub fn get_model_load_status(&self) -> ModelLoadStatus {
        self.model_load_status.read().unwrap_or_else(|p| p.into_inner()).clone()
    }

    pub fn set_model_load_status(&self, status: ModelLoadStatus) {
        let mut guard = self.model_load_status.write().unwrap_or_else(|p| p.into_inner());
        *guard = status;
    }

    /// Check if CLIP models are loaded.
    pub fn models_loaded(&self) -> bool {
        let text = self.clip_text.read().unwrap_or_else(|p| p.into_inner());
        let vision = self.clip_vision.read().unwrap_or_else(|p| p.into_inner());
        text.is_some() && vision.is_some()
    }
}
