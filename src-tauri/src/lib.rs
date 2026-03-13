mod analysis;
mod commands;
mod db;
mod embeddings;
pub mod error;
pub mod ingestion;
mod sidecar;
pub mod state;

use error::{AppError, AppResult};
use rusqlite::Connection;
use state::AppState;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tokenizers::Tokenizer;

/// Resolve the path to Apple's chat.db.
fn chat_db_path() -> AppResult<std::path::PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| AppError::Custom("Cannot determine home directory".into()))?;
    let path = home.join("Library/Messages/chat.db");
    if !path.exists() {
        return Err(AppError::ChatDbNotFound);
    }
    Ok(path)
}

/// Open the chat database in read-only mode.
fn open_chat_db() -> AppResult<Connection> {
    let path = chat_db_path()?;
    let conn = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA query_only = true;")?;
    Ok(conn)
}

/// Open (or create) the analytics database in the app data directory.
fn open_analytics_db(app: &tauri::App) -> AppResult<Connection> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Custom(format!("Cannot resolve app data dir: {e}")))?;
    std::fs::create_dir_all(&data_dir)?;
    let db_path = data_dir.join("analytics.db");
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
    db::schema::run_migrations(&conn)?;
    Ok(conn)
}

/// Load a single ONNX model file into a Session.
fn load_onnx_session(path: &std::path::Path) -> ort::error::Result<ort::session::Session> {
    let mut builder = ort::session::Session::builder()?;
    builder.commit_from_file(path)
}

/// Attempt to load MobileCLIP-S2 ONNX sessions and tokenizer from the app's resource directory.
///
/// Returns (clip_text, clip_vision, tokenizer). If any file is missing or fails to load,
/// logs a warning and returns (None, None, None).
fn load_clip_sessions(
    app: &tauri::App,
) -> (
    Option<Arc<Mutex<ort::session::Session>>>,
    Option<Arc<Mutex<ort::session::Session>>>,
    Option<Arc<Tokenizer>>,
) {
    // Try resource_dir first (production builds), then fall back to the source
    // resources directory (during `tauri dev`, resource_dir points to target/debug/).
    let models_dir = {
        let from_resource = app
            .path()
            .resource_dir()
            .ok()
            .map(|d| d.join("models"));
        let from_source = {
            let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            manifest.join("resources/models")
        };
        if from_resource
            .as_ref()
            .is_some_and(|d| d.join("mobileclip_s2_text.onnx").exists())
        {
            from_resource.unwrap()
        } else if from_source.join("mobileclip_s2_text.onnx").exists() {
            from_source
        } else {
            log::warn!(
                "CLIP model files not found — semantic search disabled. \
                 Checked {:?} and {:?}",
                from_resource,
                from_source
            );
            return (None, None, None);
        }
    };

    let text_path = models_dir.join("mobileclip_s2_text.onnx");
    let vision_path = models_dir.join("mobileclip_s2_vision.onnx");
    let tokenizer_path = models_dir.join("tokenizer.json");

    if !text_path.exists() || !vision_path.exists() || !tokenizer_path.exists() {
        log::warn!(
            "One or more CLIP model files not found in {:?} — semantic search disabled. \
             Expected: mobileclip_s2_text.onnx, mobileclip_s2_vision.onnx, tokenizer.json",
            models_dir
        );
        return (None, None, None);
    }

    // Load text encoder
    let text_session = match load_onnx_session(&text_path) {
        Ok(session) => {
            log::info!("Loaded CLIP text encoder from {:?}", text_path);
            Arc::new(Mutex::new(session))
        }
        Err(e) => {
            log::warn!("Failed to load CLIP text encoder: {e}");
            return (None, None, None);
        }
    };

    // Load vision encoder
    let vision_session = match load_onnx_session(&vision_path) {
        Ok(session) => {
            log::info!("Loaded CLIP vision encoder from {:?}", vision_path);
            Arc::new(Mutex::new(session))
        }
        Err(e) => {
            log::warn!("Failed to load CLIP vision encoder: {e}");
            return (None, None, None);
        }
    };

    // Load tokenizer
    let tokenizer = match Tokenizer::from_file(&tokenizer_path) {
        Ok(tok) => {
            log::info!("Loaded CLIP tokenizer from {:?}", tokenizer_path);
            Arc::new(tok)
        }
        Err(e) => {
            log::warn!("Failed to load CLIP tokenizer: {e}");
            return (None, None, None);
        }
    };

    (Some(text_session), Some(vision_session), Some(tokenizer))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Try to open chat.db — but don't crash if it fails
            let chat_db = match open_chat_db() {
                Ok(conn) => {
                    log::info!("Successfully opened chat.db");
                    Some(conn)
                }
                Err(e) => {
                    log::warn!("Could not open chat.db (FDA may not be granted): {e}");
                    None
                }
            };

            let analytics_db = open_analytics_db(app).map_err(|e| {
                log::error!("Failed to open analytics.db: {e}");
                Box::new(e) as Box<dyn std::error::Error>
            })?;

            // Build contact map only if chat.db is available
            let contact_map = if chat_db.is_some() {
                match db::contacts_db::build_contact_map() {
                    Ok(map) => {
                        log::info!("Loaded {} contact entries", map.len());
                        map
                    }
                    Err(e) => {
                        log::warn!("Could not load contacts: {e}");
                        std::collections::HashMap::new()
                    }
                }
            } else {
                std::collections::HashMap::new()
            };

            // Load CLIP ONNX sessions and tokenizer (gracefully handles missing models)
            let (clip_text, clip_vision, tokenizer) = load_clip_sessions(app);

            app.manage(AppState {
                chat_db: Arc::new(Mutex::new(chat_db)),
                analytics_db: Arc::new(Mutex::new(analytics_db)),
                contact_map: Arc::new(Mutex::new(contact_map)),
                clip_text,
                clip_vision,
                tokenizer,
            });

            // Spawn background embedding pipeline on a dedicated thread
            // (setup runs before the Tokio runtime is available, so we use std::thread)
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(e) = embeddings::pipeline::run_indexing_pipeline(&app_handle) {
                    log::error!("Embedding pipeline failed: {e}");
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // FDA / onboarding commands
            commands::onboarding::check_fda_status,
            commands::onboarding::retry_chat_db_connection,
            // Chat / message commands
            commands::messages::get_chats,
            commands::messages::get_messages,
            commands::messages::get_message_attachments,
            commands::messages::get_message_count,
            // Attachment commands
            commands::attachments::get_attachment_data,
            // Contact commands
            commands::contacts::get_contact_name,
            commands::contacts::get_contact_map,
            // Analytics / wrapped commands
            commands::analytics::get_wrapped_stats,
            commands::analytics::invalidate_wrapped_cache,
            commands::analytics::get_temporal_trends,
            commands::analytics::get_response_time_stats,
            commands::analytics::get_initiation_stats,
            commands::analytics::get_message_length_stats,
            commands::analytics::get_active_hours,
            // Fun / shareable commands
            commands::fun::get_group_chat_dynamics,
            commands::fun::get_on_this_day,
            commands::fun::get_texting_personality,
            // Embedding / search commands
            commands::embeddings::check_embedding_status,
            commands::embeddings::semantic_search,
            commands::embeddings::set_index_target,
            commands::embeddings::rebuild_search_index,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
