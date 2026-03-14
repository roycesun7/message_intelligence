# Embeddings Pipeline Fix Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the indexing pipeline respect the `index_target` setting as a hard cap, resume from existing embeddings on startup, and allow live target increases to trigger additional indexing.

**Architecture:** Modify the existing 3-phase pipeline (`chunks → text → attachments`) to read `index_target` from `analytics.db` and use it as a budget. Before each phase, compute `remaining = target - current_count` and pass it as the phase limit. Add an `AtomicBool` concurrency guard to `AppState` so `set_index_target` can safely re-dispatch the pipeline when the target increases.

**Tech Stack:** Rust (Tauri v2), SQLite (rusqlite), ONNX Runtime (ort)

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `src-tauri/src/db/schema.rs` | Table definitions | Add `processing_state` table |
| `src-tauri/src/db/analytics_db.rs` | DB helper functions | Fix `update_processing_state` column name |
| `src-tauri/src/state.rs` | AppState struct | Add `pipeline_running: AtomicBool` |
| `src-tauri/src/embeddings/pipeline.rs` | 3-phase pipeline | Read target, cap phases, fix progress |
| `src-tauri/src/commands/embeddings.rs` | Tauri commands | `set_index_target` triggers pipeline |
| `src-tauri/src/lib.rs` | App startup | Use concurrency guard on startup pipeline |

---

### Task 1: Restore `processing_state` table in schema

**Files:**
- Modify: `src-tauri/src/db/schema.rs:54-58`

The pipeline code calls `get_last_processed_rowid` and `update_processing_state` which query a `processing_state` table, but it was removed from the schema. Without it, the pipeline crashes on fresh databases.

- [ ] **Step 1: Add `processing_state` table to schema**

In `src-tauri/src/db/schema.rs`, add the table creation after the `search_settings` table (after line 57):

```rust
        CREATE TABLE IF NOT EXISTS processing_state (
            pipeline_name    TEXT PRIMARY KEY,
            last_rowid       INTEGER NOT NULL,
            processed_count  INTEGER NOT NULL DEFAULT 0,
            updated_at       TEXT NOT NULL
        );
```

- [ ] **Step 2: Fix `update_processing_state` column reference**

In `src-tauri/src/db/analytics_db.rs:14-30`, the function references `last_rowid` column but the old schema had `last_processed_rowid`. Verify the INSERT statement column names match the new schema above. The current code uses `last_rowid` which matches our new schema, so this should be correct. Just verify it compiles.

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: No errors related to `processing_state`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/schema.rs
git commit -m "fix: restore processing_state table in schema"
```

---

### Task 2: Add `pipeline_running` guard to `AppState`

**Files:**
- Modify: `src-tauri/src/state.rs:1-4` (imports), `src-tauri/src/state.rs:14-25` (struct)

- [ ] **Step 1: Add `AtomicBool` import and field**

In `src-tauri/src/state.rs`, add to imports (line 3):

```rust
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::sync::atomic::AtomicBool;
```

Add field to `AppState` struct (after line 24, before the closing `}`):

```rust
    /// True while the embedding pipeline is running. Prevents concurrent runs.
    pub pipeline_running: AtomicBool,
```

- [ ] **Step 2: Initialize in `lib.rs`**

In `src-tauri/src/lib.rs:200-207`, add `pipeline_running` to the `AppState` initialization:

```rust
            app.manage(AppState {
                chat_db: Arc::new(Mutex::new(chat_db)),
                analytics_db: Arc::new(Mutex::new(analytics_db)),
                contact_map: Arc::new(Mutex::new(contact_map)),
                clip_text: RwLock::new(None),
                clip_vision: RwLock::new(None),
                tokenizer: RwLock::new(None),
                pipeline_running: AtomicBool::new(false),
            });
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "feat: add pipeline_running AtomicBool guard to AppState"
```

---

### Task 3: Make pipeline respect `index_target`

**Files:**
- Modify: `src-tauri/src/embeddings/pipeline.rs:98-159` (main entry), `src-tauri/src/embeddings/pipeline.rs:236-335` (phase 1), `src-tauri/src/embeddings/pipeline.rs:339-552` (phase 2), `src-tauri/src/embeddings/pipeline.rs:556-675` (phase 3)

This is the core change. The pipeline reads `index_target`, computes the remaining budget before each phase, and passes it as the limit. Each phase stops early once the budget is exhausted.

- [ ] **Step 1: Modify `run_indexing_pipeline` signature and entry point**

In `src-tauri/src/embeddings/pipeline.rs`, update the function to read the target and check remaining budget before each phase. Replace lines 98-159:

```rust
/// Run the full indexing pipeline. This is called from a background thread
/// and opens its own DB connections. ONNX sessions are passed in to avoid
/// loading 380MB of models a second time (which deadlocks ort).
pub fn run_indexing_pipeline(
    app_handle: &AppHandle,
    text_session: &mut ort::session::Session,
    vision_session: &mut ort::session::Session,
    tokenizer: &Tokenizer,
) -> AppResult<()> {
    log::info!("Embedding pipeline starting...");

    // Open our own connections
    let chat_conn = match open_chat_db_readonly() {
        Ok(c) => c,
        Err(e) => {
            log::warn!("Pipeline: cannot open chat.db (FDA not granted?): {e}");
            return Ok(());
        }
    };
    let analytics_conn = open_analytics_db_rw(app_handle)?;

    // Read index target
    let index_target = analytics_db::get_search_setting(&analytics_conn, "index_target")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(1000);

    // Check if already at target
    let current_count = analytics_db::count_embeddings(&analytics_conn)?;
    if current_count >= index_target {
        log::info!("Pipeline: already at target ({current_count} >= {index_target}), skipping.");
        emit_progress(app_handle, "done", 0, 0);
        return Ok(());
    }

    log::info!("Pipeline: target={index_target}, current={current_count}, deficit={}", index_target - current_count);

    // Build contact map and handle map for sender resolution
    let contact_map = contacts_db::build_contact_map().unwrap_or_default();
    let handle_map = build_handle_map(&chat_conn)?;

    // Phase 1: Chunk recent messages into conversation segments
    let remaining = index_target - analytics_db::count_embeddings(&analytics_conn)?;
    if remaining > 0 {
        run_phase_chunking(
            app_handle,
            &chat_conn,
            &analytics_conn,
            text_session,
            tokenizer,
            &handle_map,
            &contact_map,
            remaining,
            index_target,
        )?;
    }

    // Phase 2: Embed individual messages (newest first)
    let remaining = index_target - analytics_db::count_embeddings(&analytics_conn)?;
    if remaining > 0 {
        run_phase_text_embedding(
            app_handle,
            &chat_conn,
            &analytics_conn,
            text_session,
            tokenizer,
            &handle_map,
            &contact_map,
            remaining,
            index_target,
        )?;
    }

    // Phase 3: Embed image attachments
    let remaining = index_target - analytics_db::count_embeddings(&analytics_conn)?;
    if remaining > 0 {
        run_phase_attachment_embedding(
            app_handle,
            &chat_conn,
            &analytics_conn,
            vision_session,
            remaining,
            index_target,
        )?;
    }

    emit_progress(app_handle, "done", 0, 0);
    log::info!("Embedding pipeline complete.");

    Ok(())
}
```

- [ ] **Step 2: Update Phase 1 (`run_phase_chunking`) to accept and respect the budget**

Replace the `run_phase_chunking` function signature and body. Key changes:
- Accept `budget: i64` and `index_target: i64` parameters
- Use `budget` instead of `CHUNK_LIMIT` for the message fetch limit
- After each chunk embedding, check if budget is exhausted and break early
- Emit progress relative to `index_target`

```rust
fn run_phase_chunking(
    app_handle: &AppHandle,
    chat_conn: &Connection,
    analytics_conn: &Connection,
    text_session: &mut ort::session::Session,
    tokenizer: &Tokenizer,
    handle_map: &HashMap<i64, String>,
    contact_map: &HashMap<String, String>,
    budget: i64,
    index_target: i64,
) -> AppResult<()> {
    let already_done = analytics_db::get_last_processed_rowid(analytics_conn, "chunking")?;
    if already_done > 0 {
        log::info!("Phase 1: already processed, skipping.");
        return Ok(());
    }

    // Fetch more messages than budget since chunking groups them (fewer embeddings than messages)
    let fetch_limit = (budget * 5).min(10000);
    log::info!("Phase 1: Chunking (budget={budget}, fetching up to {fetch_limit} messages)...");

    let mut messages = get_recent_messages_with_chat_id(
        chat_conn,
        fetch_limit,
        handle_map,
        contact_map,
    )?;
    messages.sort_by_key(|m| m.rowid);

    if messages.is_empty() {
        log::info!("Phase 1: no messages to chunk.");
        return Ok(());
    }

    let max_rowid = messages.last().unwrap().rowid;
    let chunks = chunker::chunk_messages(&messages);
    let mut chunks_created: i64 = 0;
    let mut embeddings_created: i64 = 0;

    for chunk in &chunks {
        // Check budget before each embedding
        if embeddings_created >= budget {
            log::info!("Phase 1: budget reached ({embeddings_created} embeddings).");
            break;
        }

        let chunk_db_id = analytics_db::insert_chunk(
            analytics_conn,
            chunk.chat_id,
            chunk.is_from_me,
            chunk.handle_id,
            chunk.first_rowid,
            chunk.last_rowid,
            chunk.message_count,
            &chunk.concatenated_text,
            chunk.started_at,
            chunk.ended_at,
        )?;

        if !chunk.concatenated_text.trim().is_empty() {
            let text_ref: &str = &chunk.concatenated_text;
            match clip::encode_texts(text_session, tokenizer, &[text_ref]) {
                Ok(embs) if !embs.is_empty() => {
                    let blob = clip::embedding_to_blob(&embs[0]);
                    analytics_db::insert_embedding(
                        analytics_conn,
                        "chunk",
                        chunk_db_id,
                        Some(chunk_db_id),
                        chunk.chat_id,
                        "mobileclip-s2",
                        &blob,
                    )?;
                    embeddings_created += 1;
                }
                Ok(_) => {}
                Err(e) => {
                    log::debug!("Failed to embed chunk {}: {e}", chunk_db_id);
                }
            }
        }

        chunks_created += 1;
        if chunks_created % 100 == 0 {
            let current_total = analytics_db::count_embeddings(analytics_conn)?;
            emit_progress(app_handle, "chunking", current_total, index_target);
        }
    }

    if embeddings_created > 0 {
        analytics_db::update_processing_state(
            analytics_conn,
            "chunking",
            max_rowid,
            chunks_created,
        )?;
    }

    let current_total = analytics_db::count_embeddings(analytics_conn)?;
    emit_progress(app_handle, "chunking", current_total, index_target);
    log::info!(
        "Phase 1 complete: {} chunks created, {} embedded",
        chunks_created, embeddings_created
    );
    Ok(())
}
```

- [ ] **Step 3: Update Phase 2 (`run_phase_text_embedding`) to accept and respect the budget**

Replace the function. Key changes:
- Accept `budget: i64` and `index_target: i64`
- Only run "recent" direction (newest first) — remove "oldest" direction since we want newest first
- Pass budget to `embed_messages_by_direction`

```rust
fn run_phase_text_embedding(
    app_handle: &AppHandle,
    chat_conn: &Connection,
    analytics_conn: &Connection,
    text_session: &mut ort::session::Session,
    tokenizer: &Tokenizer,
    handle_map: &HashMap<i64, String>,
    contact_map: &HashMap<String, String>,
    budget: i64,
    index_target: i64,
) -> AppResult<()> {
    log::info!("Phase 2: Text embedding (budget={budget})...");

    embed_messages_by_direction(
        app_handle,
        chat_conn,
        analytics_conn,
        text_session,
        tokenizer,
        handle_map,
        contact_map,
        "recent",
        budget,
        index_target,
    )?;

    log::info!("Phase 2 complete.");
    Ok(())
}
```

- [ ] **Step 4: Update `embed_messages_by_direction` to respect the budget**

Update the function signature and add early break logic. Key changes:
- Accept `index_target: i64` parameter
- After each batch, check the current embedding count against the budget and break early
- Emit progress relative to `index_target`

In the function signature (line 380), add `index_target: i64` parameter. Then after the batch processing loop body (after line 533 `processed += batch.len() as i64;`), add:

```rust
        // Check if we've hit the global target
        let current_total = analytics_db::count_embeddings(analytics_conn)?;
        emit_progress(app_handle, "text", current_total, index_target);
        if current_total >= index_target {
            log::info!("Phase 2 ({direction}): global target reached.");
            break;
        }
```

Also update the `emit_progress` call on line 534 to use `index_target` instead of per-phase `total`.

- [ ] **Step 5: Update Phase 3 (`run_phase_attachment_embedding`) to accept and respect the budget**

Update the function signature to accept `budget: i64` and `index_target: i64`. Replace the hardcoded `LIMIT 500` in the SQL query with a parameter using `budget`. Add early break after each embedding insert:

In the SQL query (line 572-579), change `LIMIT 500` to `LIMIT ?1` and pass `budget` as the parameter.

After each successful embedding insert (after line 638 `embeddings_created += 1;`), add a budget check:

```rust
                        // Check if global target reached
                        let current_total = analytics_db::count_embeddings(analytics_conn)?;
                        if current_total >= index_target {
                            log::info!("Phase 3: global target reached.");
                            emit_progress(app_handle, "attachments", current_total, index_target);
                            // Mark progress and return early
                            if embeddings_created > 0 {
                                let max_rowid = msg_rows.iter().map(|(r, _)| *r).max().unwrap_or(0);
                                analytics_db::update_processing_state(
                                    analytics_conn,
                                    "embedding_attachments",
                                    max_rowid,
                                    processed,
                                )?;
                            }
                            return Ok(());
                        }
```

Update progress emissions to use `index_target` as the total.

- [ ] **Step 6: Remove the `CHUNK_LIMIT` constant**

Delete line 164: `const CHUNK_LIMIT: i64 = 5000;` — it's no longer used.

- [ ] **Step 7: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/embeddings/pipeline.rs
git commit -m "feat: pipeline respects index_target as hard cap with early exit"
```

---

### Task 4: Wire concurrency guard into startup and `set_index_target`

**Files:**
- Modify: `src-tauri/src/lib.rs:214-257` (startup thread)
- Modify: `src-tauri/src/commands/embeddings.rs:216-224` (`set_index_target`)

- [ ] **Step 1: Use `pipeline_running` guard on startup**

In `src-tauri/src/lib.rs`, wrap the pipeline call (lines 248-256) with the AtomicBool guard. After the model loading and AppState updates, before running the pipeline:

```rust
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
```

- [ ] **Step 2: Make `set_index_target` trigger pipeline when target increases**

Replace `set_index_target` in `src-tauri/src/commands/embeddings.rs:216-224`:

```rust
/// Set the index target (number of messages to embed).
/// If the new target is higher than current embeddings and no pipeline is running,
/// spawn a background pipeline run to index more.
#[tauri::command]
pub fn set_index_target(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    target: i64,
) -> AppResult<()> {
    let analytics_conn = state.lock_analytics_db()?;
    analytics_db::set_search_setting(&analytics_conn, "index_target", &target.to_string())?;

    // Check if we need to run the pipeline
    let current_count = analytics_db::count_embeddings(&analytics_conn)?;
    drop(analytics_conn);

    if current_count < target && state.models_loaded() {
        // Only dispatch if not already running
        if !state.pipeline_running.load(std::sync::atomic::Ordering::SeqCst) {
            let text_arc = {
                let guard = state.clip_text.read().unwrap_or_else(|p| p.into_inner());
                guard.clone()
            };
            let vision_arc = {
                let guard = state.clip_vision.read().unwrap_or_else(|p| p.into_inner());
                guard.clone()
            };
            let tok_arc = {
                let guard = state.tokenizer.read().unwrap_or_else(|p| p.into_inner());
                guard.clone()
            };

            if let (Some(text), Some(vision), Some(tok)) = (text_arc, vision_arc, tok_arc) {
                let app_handle_clone = app_handle.clone();
                // Get a reference to state for the guard
                let state_ref = app_handle.state::<AppState>();
                state_ref.pipeline_running.store(true, std::sync::atomic::Ordering::SeqCst);

                std::thread::spawn(move || {
                    let mut text_session = text.lock().unwrap_or_else(|p| p.into_inner());
                    let mut vision_session = vision.lock().unwrap_or_else(|p| p.into_inner());
                    if let Err(e) = crate::embeddings::pipeline::run_indexing_pipeline(
                        &app_handle_clone,
                        &mut text_session,
                        &mut vision_session,
                        &tok,
                    ) {
                        log::error!("Pipeline (from set_index_target) failed: {e}");
                    }
                    // Clear the flag
                    if let Some(state) = app_handle_clone.try_state::<AppState>() {
                        state.pipeline_running.store(false, std::sync::atomic::Ordering::SeqCst);
                    }
                });
            }
        }
    }

    Ok(())
}
```

- [ ] **Step 3: Update `rebuild_search_index` to also use the guard**

In `src-tauri/src/commands/embeddings.rs`, in the `rebuild_search_index` function (lines 228-272), add the same `pipeline_running` guard pattern around the thread spawn. Set it to `true` before spawning, `false` when the pipeline finishes inside the thread.

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/commands/embeddings.rs
git commit -m "feat: concurrency guard + live pipeline dispatch on target increase"
```

---

### Task 5: End-to-end manual test

**Files:** None (manual testing)

- [ ] **Step 1: Clean slate test**

1. Delete `~/Library/Application Support/iCapsule/analytics.db` (forces fresh DB)
2. Run: `npx tauri dev`
3. Go to Settings, set slider to 500
4. Observe the indexing status bar — it should count up to 500 and stop
5. Verify in the status bar that it shows `500 / 500` (or close to it)

- [ ] **Step 2: Resume test**

1. Quit and relaunch the app
2. Observe: pipeline should skip immediately (already at target)
3. No indexing activity in the status bar

- [ ] **Step 3: Live increase test**

1. Move slider from 500 to 1000
2. Observe: pipeline should kick off and index 500 more
3. Status bar should count from ~500 up to ~1000

- [ ] **Step 4: Rebuild test**

1. Click "Rebuild Index"
2. Observe: all embeddings cleared, pipeline re-runs up to the current target

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "fix: any adjustments from manual testing"
```
