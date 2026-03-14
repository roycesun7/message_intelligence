mod commands;
mod db;
pub mod embeddings;
pub mod error;
pub mod ingestion;
pub mod state;

use error::{AppError, AppResult};
use rusqlite::Connection;
use state::AppState;
use std::sync::{Arc, Mutex, RwLock};
use tauri::Manager;
use tokenizers::Tokenizer;

fn chat_db_path() -> AppResult<std::path::PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| AppError::Custom("Cannot determine home directory".into()))?;
    let path = home.join("Library/Messages/chat.db");
    if !path.exists() {
        return Err(AppError::ChatDbNotFound);
    }
    Ok(path)
}

fn open_chat_db() -> AppResult<Connection> {
    let path = chat_db_path()?;
    let conn = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA query_only = true;")?;
    Ok(conn)
}

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

/// Load MobileCLIP-S2 ONNX sessions and tokenizer on a background thread.
fn load_clip_sessions_from_handle(
    app: &tauri::AppHandle,
) -> (
    Option<Arc<Mutex<ort::session::Session>>>,
    Option<Arc<Mutex<ort::session::Session>>>,
    Option<Arc<Tokenizer>>,
) {
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
        log::warn!("One or more CLIP model files missing in {:?}", models_dir);
        return (None, None, None);
    }

    eprintln!("[models] Loading text encoder from {:?}...", text_path);
    let text_session = match load_onnx_session(&text_path) {
        Ok(session) => {
            eprintln!("[models] Text encoder loaded OK");
            Arc::new(Mutex::new(session))
        }
        Err(e) => {
            eprintln!("[models] FAILED to load text encoder: {e}");
            return (None, None, None);
        }
    };

    eprintln!("[models] Loading vision encoder from {:?}...", vision_path);
    let vision_session = match load_onnx_session(&vision_path) {
        Ok(session) => {
            eprintln!("[models] Vision encoder loaded OK");
            Arc::new(Mutex::new(session))
        }
        Err(e) => {
            eprintln!("[models] FAILED to load vision encoder: {e}");
            return (None, None, None);
        }
    };

    eprintln!("[models] Loading tokenizer from {:?}...", tokenizer_path);
    let tokenizer = match Tokenizer::from_file(&tokenizer_path) {
        Ok(tok) => {
            eprintln!("[models] Tokenizer loaded OK");
            Arc::new(tok)
        }
        Err(e) => {
            eprintln!("[models] FAILED to load tokenizer: {e}");
            return (None, None, None);
        }
    };

    (Some(text_session), Some(vision_session), Some(tokenizer))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Ensure ORT_DYLIB_PATH is set for ort's load-dynamic feature.
    // Without this, Session::builder() hangs trying to find libonnxruntime.
    if std::env::var("ORT_DYLIB_PATH").is_err() {
        // Check common Homebrew paths
        let candidates = [
            "/opt/homebrew/lib/libonnxruntime.dylib", // Apple Silicon
            "/usr/local/lib/libonnxruntime.dylib",    // Intel Mac
        ];
        for path in &candidates {
            if std::path::Path::new(path).exists() {
                std::env::set_var("ORT_DYLIB_PATH", path);
                break;
            }
        }
    }

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

            // Initialize state with empty CLIP slots — models loaded on background thread
            app.manage(AppState {
                chat_db: Arc::new(Mutex::new(chat_db)),
                analytics_db: Arc::new(Mutex::new(analytics_db)),
                contact_map: Arc::new(Mutex::new(contact_map)),
                clip_text: RwLock::new(None),
                clip_vision: RwLock::new(None),
                tokenizer: RwLock::new(None),
                pipeline_running: std::sync::atomic::AtomicBool::new(false),
            });

            // Spawn background thread to load CLIP models, then run the pipeline.
            // Loading 380MB of ONNX models is too slow for the setup closure.
            // Models are loaded ONCE and shared between AppState (for search queries)
            // and the pipeline (for indexing). Loading twice deadlocks ort.
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                eprintln!("[pipeline] Loading CLIP models...");
                let (clip_text, clip_vision, tokenizer) = load_clip_sessions_from_handle(&app_handle);
                eprintln!("[pipeline] Model load result: text={} vision={} tokenizer={}",
                    clip_text.is_some(), clip_vision.is_some(), tokenizer.is_some());

                // Update AppState with loaded models (for search queries from the UI)
                let has_models = clip_text.is_some() && clip_vision.is_some() && tokenizer.is_some();
                if let Some(state) = app_handle.try_state::<AppState>() {
                    if let Some(ref ct) = clip_text {
                        state.set_clip_text(ct.clone());
                    }
                    if let Some(ref cv) = clip_vision {
                        state.set_clip_vision(cv.clone());
                    }
                    if let Some(ref tok) = tokenizer {
                        state.set_tokenizer(tok.clone());
                    }
                }

                if !has_models {
                    eprintln!("[pipeline] Models not loaded — skipping pipeline");
                    return;
                }

                // Unwrap the Arc<Mutex<Session>> to get owned sessions for the pipeline.
                // We lock and hold the sessions for the pipeline's duration.
                let text_arc = clip_text.unwrap();
                let vision_arc = clip_vision.unwrap();
                let tok = tokenizer.unwrap();

                // Set the pipeline_running flag
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state.pipeline_running.store(true, std::sync::atomic::Ordering::SeqCst);
                }

                let mut text_session = text_arc.lock().unwrap_or_else(|p| p.into_inner());
                let mut vision_session = vision_arc.lock().unwrap_or_else(|p| p.into_inner());

                if let Err(e) = embeddings::pipeline::run_indexing_pipeline(
                    &app_handle,
                    &mut text_session,
                    &mut vision_session,
                    &tok,
                ) {
                    log::error!("Embedding pipeline failed: {e}");
                    eprintln!("[pipeline] ERROR: {e}");
                }

                // Clear the pipeline_running flag
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state.pipeline_running.store(false, std::sync::atomic::Ordering::SeqCst);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::onboarding::check_fda_status,
            commands::onboarding::retry_chat_db_connection,
            commands::messages::get_chats,
            commands::messages::get_messages,
            commands::messages::get_message_attachments,
            commands::messages::get_message_count,
            commands::attachments::get_attachment_data,
            commands::contacts::get_contact_name,
            commands::contacts::get_contact_map,
            commands::analytics::get_wrapped_stats,
            commands::analytics::invalidate_wrapped_cache,
            commands::analytics::get_temporal_trends,
            commands::analytics::get_response_time_stats,
            commands::analytics::get_initiation_stats,
            commands::analytics::get_message_length_stats,
            commands::analytics::get_active_hours,
            commands::analytics::get_word_frequency,
            commands::fun::get_group_chat_dynamics,
            commands::fun::get_on_this_day,
            commands::fun::get_texting_personality,
            commands::embeddings::check_embedding_status,
            commands::embeddings::semantic_search,
            commands::embeddings::set_index_target,
            commands::embeddings::rebuild_search_index,
            commands::embeddings::open_data_dir,
            commands::embeddings::clear_all_embeddings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
