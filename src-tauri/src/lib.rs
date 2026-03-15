mod commands;
pub mod db;
pub mod embeddings;
pub mod error;
pub mod ingestion;
pub mod state;
pub mod telemetry;

use error::{AppError, AppResult};
use rusqlite::Connection;
use state::{AppState, ModelLoadStatus, ModelLoadStep};
use std::sync::{Arc, Mutex, RwLock};
use tauri::{Emitter, Manager};
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

/// Load MobileCLIP-S2 ONNX sessions and tokenizer on a background thread,
/// emitting diagnostic progress events so the frontend can display real-time status.
fn load_clip_sessions_with_diagnostics(
    app: &tauri::AppHandle,
) -> (
    Option<Arc<Mutex<ort::session::Session>>>,
    Option<Arc<Mutex<ort::session::Session>>>,
    Option<Arc<Tokenizer>>,
) {
    let mut status = ModelLoadStatus {
        overall: "loading".into(),
        ort_dylib_path: std::env::var("ORT_DYLIB_PATH").ok(),
        models_dir: None,
        steps: vec![],
    };
    if let Some(state) = app.try_state::<AppState>() {
        state.set_model_load_status(status.clone());
    }
    let _ = app.emit("model-load-progress", &status);

    // --- Step 1: ort_runtime ---
    {
        let ort_path = std::env::var("ORT_DYLIB_PATH").ok();
        let (step_status, message) = if let Some(ref p) = ort_path {
            eprintln!("[models] ORT_DYLIB_PATH = {p}");
            ("success".into(), Some(format!("ORT_DYLIB_PATH={p}")))
        } else {
            eprintln!("[models] ORT_DYLIB_PATH is not set");
            ("error".into(), Some("ORT_DYLIB_PATH environment variable is not set".into()))
        };
        status.steps.push(ModelLoadStep {
            name: "ort_runtime".into(),
            status: step_status,
            message,
            duration_ms: None,
        });
        if let Some(state) = app.try_state::<AppState>() {
            state.set_model_load_status(status.clone());
        }
        let _ = app.emit("model-load-progress", &status);
    }

    // --- Step 2: find_models ---
    let from_resource = app
        .path()
        .resource_dir()
        .ok()
        .map(|d| d.join("resources/models"));
    let from_source = {
        let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest.join("resources/models")
    };

    let models_dir = if from_resource
        .as_ref()
        .is_some_and(|d| d.join("mobileclip_s2_text.onnx").exists())
    {
        Some(from_resource.clone().unwrap())
    } else if from_source.join("mobileclip_s2_text.onnx").exists() {
        Some(from_source.clone())
    } else {
        None
    };

    {
        let (step_status, message) = if let Some(ref dir) = models_dir {
            (
                "success".into(),
                Some(format!(
                    "Checked resource={:?}, source={:?}; selected {:?}",
                    from_resource, from_source, dir
                )),
            )
        } else {
            (
                "error".into(),
                Some(format!(
                    "Models not found. Checked resource={:?}, source={:?}",
                    from_resource, from_source
                )),
            )
        };
        status.steps.push(ModelLoadStep {
            name: "find_models".into(),
            status: step_status,
            message,
            duration_ms: None,
        });
        if let Some(state) = app.try_state::<AppState>() {
            state.set_model_load_status(status.clone());
        }
        let _ = app.emit("model-load-progress", &status);
    }

    let models_dir = match models_dir {
        Some(dir) => dir,
        None => {
            log::warn!(
                "CLIP model files not found — semantic search disabled. \
                 Checked {:?} and {:?}",
                from_resource,
                from_source
            );
            status.overall = "error".into();
            if let Some(state) = app.try_state::<AppState>() {
                state.set_model_load_status(status.clone());
            }
            let _ = app.emit("model-load-progress", &status);
            return (None, None, None);
        }
    };

    status.models_dir = Some(models_dir.display().to_string());

    // --- Step 3: check_files ---
    let text_path = models_dir.join("mobileclip_s2_text.onnx");
    let vision_path = models_dir.join("mobileclip_s2_vision.onnx");
    let tokenizer_path = models_dir.join("tokenizer.json");

    let text_exists = text_path.exists();
    let vision_exists = vision_path.exists();
    let tokenizer_exists = tokenizer_path.exists();
    let all_exist = text_exists && vision_exists && tokenizer_exists;

    {
        let mut found = vec![];
        let mut missing = vec![];
        if text_exists { found.push("text.onnx"); } else { missing.push("text.onnx"); }
        if vision_exists { found.push("vision.onnx"); } else { missing.push("vision.onnx"); }
        if tokenizer_exists { found.push("tokenizer.json"); } else { missing.push("tokenizer.json"); }

        let message = format!("Found: [{}]; Missing: [{}]", found.join(", "), missing.join(", "));
        status.steps.push(ModelLoadStep {
            name: "check_files".into(),
            status: if all_exist { "success".into() } else { "error".into() },
            message: Some(message),
            duration_ms: None,
        });
        if let Some(state) = app.try_state::<AppState>() {
            state.set_model_load_status(status.clone());
        }
        let _ = app.emit("model-load-progress", &status);
    }

    if !all_exist {
        log::warn!("One or more CLIP model files missing in {:?}", models_dir);
        status.overall = "error".into();
        if let Some(state) = app.try_state::<AppState>() {
            state.set_model_load_status(status.clone());
        }
        let _ = app.emit("model-load-progress", &status);
        return (None, None, None);
    }

    // --- Step 4: load_text_encoder ---
    eprintln!("[models] Loading text encoder from {:?}...", text_path);
    let text_session = {
        let start = std::time::Instant::now();
        let result = load_onnx_session(&text_path);
        let duration_ms = Some(start.elapsed().as_millis() as u64);
        match result {
            Ok(session) => {
                eprintln!("[models] Text encoder loaded OK");
                status.steps.push(ModelLoadStep {
                    name: "load_text_encoder".into(),
                    status: "success".into(),
                    message: Some(format!("Loaded {:?}", text_path)),
                    duration_ms,
                });
                if let Some(state) = app.try_state::<AppState>() {
                    state.set_model_load_status(status.clone());
                }
                let _ = app.emit("model-load-progress", &status);
                Arc::new(Mutex::new(session))
            }
            Err(e) => {
                eprintln!("[models] FAILED to load text encoder: {e}");
                status.steps.push(ModelLoadStep {
                    name: "load_text_encoder".into(),
                    status: "error".into(),
                    message: Some(format!("Failed: {e}")),
                    duration_ms,
                });
                status.overall = "error".into();
                if let Some(state) = app.try_state::<AppState>() {
                    state.set_model_load_status(status.clone());
                }
                let _ = app.emit("model-load-progress", &status);
                return (None, None, None);
            }
        }
    };

    // --- Step 5: load_vision_encoder ---
    eprintln!("[models] Loading vision encoder from {:?}...", vision_path);
    let vision_session = {
        let start = std::time::Instant::now();
        let result = load_onnx_session(&vision_path);
        let duration_ms = Some(start.elapsed().as_millis() as u64);
        match result {
            Ok(session) => {
                eprintln!("[models] Vision encoder loaded OK");
                status.steps.push(ModelLoadStep {
                    name: "load_vision_encoder".into(),
                    status: "success".into(),
                    message: Some(format!("Loaded {:?}", vision_path)),
                    duration_ms,
                });
                if let Some(state) = app.try_state::<AppState>() {
                    state.set_model_load_status(status.clone());
                }
                let _ = app.emit("model-load-progress", &status);
                Arc::new(Mutex::new(session))
            }
            Err(e) => {
                eprintln!("[models] FAILED to load vision encoder: {e}");
                status.steps.push(ModelLoadStep {
                    name: "load_vision_encoder".into(),
                    status: "error".into(),
                    message: Some(format!("Failed: {e}")),
                    duration_ms,
                });
                status.overall = "error".into();
                if let Some(state) = app.try_state::<AppState>() {
                    state.set_model_load_status(status.clone());
                }
                let _ = app.emit("model-load-progress", &status);
                return (None, None, None);
            }
        }
    };

    // --- Step 6: load_tokenizer ---
    eprintln!("[models] Loading tokenizer from {:?}...", tokenizer_path);
    let tokenizer = {
        let start = std::time::Instant::now();
        let result = Tokenizer::from_file(&tokenizer_path);
        let duration_ms = Some(start.elapsed().as_millis() as u64);
        match result {
            Ok(tok) => {
                eprintln!("[models] Tokenizer loaded OK");
                status.steps.push(ModelLoadStep {
                    name: "load_tokenizer".into(),
                    status: "success".into(),
                    message: Some(format!("Loaded {:?}", tokenizer_path)),
                    duration_ms,
                });
                if let Some(state) = app.try_state::<AppState>() {
                    state.set_model_load_status(status.clone());
                }
                let _ = app.emit("model-load-progress", &status);
                Arc::new(tok)
            }
            Err(e) => {
                eprintln!("[models] FAILED to load tokenizer: {e}");
                status.steps.push(ModelLoadStep {
                    name: "load_tokenizer".into(),
                    status: "error".into(),
                    message: Some(format!("Failed: {e}")),
                    duration_ms,
                });
                status.overall = "error".into();
                if let Some(state) = app.try_state::<AppState>() {
                    state.set_model_load_status(status.clone());
                }
                let _ = app.emit("model-load-progress", &status);
                return (None, None, None);
            }
        }
    };

    // All steps succeeded
    status.overall = "ready".into();
    if let Some(state) = app.try_state::<AppState>() {
        state.set_model_load_status(status.clone());
    }
    let _ = app.emit("model-load-progress", &status);

    (Some(text_session), Some(vision_session), Some(tokenizer))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize ONNX Runtime via ort's load-dynamic feature.
    // Must call init_from().commit() before any other ort API to avoid deadlock.
    // The bundled dylib lives at <app>/Contents/Resources/resources/libonnxruntime.dylib
    let bundled = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
        .map(|bin_dir| bin_dir.join("../Resources/resources/libonnxruntime.dylib"));

    let ort_candidates: Vec<std::path::PathBuf> = [
        bundled,
        Some(std::path::PathBuf::from("/opt/homebrew/lib/libonnxruntime.dylib")), // Apple Silicon
        Some(std::path::PathBuf::from("/usr/local/lib/libonnxruntime.dylib")),    // Intel Mac
    ]
    .into_iter()
    .flatten()
    .collect();

    let mut ort_ok = false;
    for path in &ort_candidates {
        if path.exists() {
            eprintln!("[ort] Loading ONNX Runtime from {}...", path.display());
            match ort::init_from(path) {
                Ok(builder) => {
                    builder.commit();
                    eprintln!("[ort] ONNX Runtime initialized successfully");
                    ort_ok = true;
                    break;
                }
                Err(e) => {
                    eprintln!("[ort] Failed to load from {}: {e}", path.display());
                }
            }
        }
    }
    if !ort_ok {
        eprintln!("[ort] ONNX Runtime not found — semantic search will be disabled");
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
                model_load_status: RwLock::new(ModelLoadStatus {
                    overall: "pending".into(),
                    ort_dylib_path: std::env::var("ORT_DYLIB_PATH").ok(),
                    models_dir: None,
                    steps: vec![],
                }),
            });

            // Anonymous launch ping
            if let Ok(data_dir) = app.path().app_data_dir() {
                telemetry::send_launch_ping(&data_dir);
            }

            // Spawn background thread to load CLIP models, then run the pipeline.
            // Loading 380MB of ONNX models is too slow for the setup closure.
            // Models are loaded ONCE and shared between AppState (for search queries)
            // and the pipeline (for indexing). Loading twice deadlocks ort.
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                eprintln!("[pipeline] Loading CLIP models...");
                let (clip_text, clip_vision, tokenizer) = load_clip_sessions_with_diagnostics(&app_handle);
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

                // Models loaded — pipeline is now available via run_pipeline / run_pipeline_for_chat.
                // Auto-pipeline disabled: indexing is triggered manually from the UI.
                eprintln!("[pipeline] Models ready. Pipeline available for manual trigger.");
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::onboarding::check_fda_status,
            commands::onboarding::retry_chat_db_connection,
            commands::onboarding::open_system_settings,
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
            commands::fun::get_first_message,
            commands::fun::get_emoji_frequency,
            commands::fun::get_milestones,
            commands::embeddings::check_embedding_status,
            commands::embeddings::get_model_diagnostics,
            commands::embeddings::semantic_search,
            commands::embeddings::set_index_target,
            commands::embeddings::run_pipeline,
            commands::embeddings::run_pipeline_for_chat,
            commands::embeddings::rebuild_search_index,
            commands::embeddings::get_data_dir,
            commands::embeddings::clear_all_embeddings,
            commands::embeddings::get_debug_embeddings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
