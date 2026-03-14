# Embeddings Pipeline Fix — Design Spec

**Date:** 2026-03-14
**Branch:** `fix/embeddings`

## Problem

1. The `index_target` setting (set via the Settings slider) is purely cosmetic — the indexing pipeline ignores it and always processes hardcoded limits (5000 chunks, 500+500 messages, 500 attachments).
2. The pipeline runs all phases unconditionally on every app launch, re-processing even when embeddings already exist.
3. The `processing_state` table was removed from the schema but is still referenced by pipeline code, causing runtime failures on fresh databases.

## Solution

Modify the existing 3-phase pipeline to respect `index_target` as a hard cap, resume from where it left off, and allow live target increases to trigger additional indexing.

## Design

### 1. Pipeline Cap Logic

**File:** `src-tauri/src/embeddings/pipeline.rs`

- At pipeline start, read `index_target` from `analytics.db` via `get_search_setting("index_target")`, defaulting to 1000.
- Before each phase, query `SELECT COUNT(*) FROM embeddings` to get the current count.
- Compute `remaining = index_target - current_count`. If `remaining <= 0`, skip the phase.
- Pass `remaining` as the limit to each phase instead of hardcoded constants (replacing `CHUNK_LIMIT = 5000`, `limit = 500`, etc.).
- Within each phase, after each batch insert, re-check the count and break early if the target is met.
- Phase order is preserved: chunks → text → attachments (newest first within each).

### 2. Resume on Startup

**File:** `src-tauri/src/embeddings/pipeline.rs`, `src-tauri/src/lib.rs`

- On app launch, before running the pipeline, check `COUNT(*) FROM embeddings` against `index_target`.
- If already at or above target → emit `phase="done"` immediately, skip the pipeline.
- If below target → compute the deficit and run phases with that as the limit.
- Each phase's existing queries use `ORDER BY ROWID DESC` (newest first) and skip messages that already have embeddings via `LEFT JOIN embeddings ... WHERE embeddings.id IS NULL`. This naturally resumes from where it left off.
- The `processing_state` table tracks which messages each phase has already processed, enabling correct resume behavior.

### 3. Live Target Increase

**Files:** `src-tauri/src/commands/embeddings.rs`, `src-tauri/src/state.rs`

- After `set_index_target` saves the new value, check if `current_count < new_target` and if models are loaded.
- If so, spawn a background thread to run `run_indexing_pipeline()` — it will read the new target and process the deficit.
- Add an `AtomicBool` (`pipeline_running`) to `AppState` as a concurrency guard. If a pipeline is already running, skip the re-dispatch. The running pipeline will stop at its original target; the next launch or slider change will catch up.
- For decreasing the target: do nothing. Existing embeddings remain. The pipeline simply won't run until the count falls below the target (which only happens on manual rebuild).

### 4. Progress Reporting Fix

**File:** `src-tauri/src/embeddings/pipeline.rs`

- `emit_progress` reports against the `index_target`, not per-phase totals:
  - `total` = `index_target`
  - `processed` = current `COUNT(*) FROM embeddings` (queried after each batch)
  - `phase` = current phase name (for the UI label)
- The frontend `indexing-status-bar.tsx` already handles this payload shape — no frontend changes needed.
- `check_embedding_status` already returns `index_target` and `total_embedded`, so the settings page progress bar is naturally correct.

### 5. Schema Fix

**File:** `src-tauri/src/db/schema.rs`

Restore the `processing_state` table that was removed:

```sql
CREATE TABLE IF NOT EXISTS processing_state (
    pipeline_name TEXT PRIMARY KEY,
    last_processed_rowid INTEGER NOT NULL,
    updated_at TEXT NOT NULL
);
```

This table is essential for tracking which messages each phase has already processed, enabling resume behavior.

## Files Modified

| File | Change |
|------|--------|
| `src-tauri/src/embeddings/pipeline.rs` | Read target, cap each phase, break early, fix progress emission |
| `src-tauri/src/commands/embeddings.rs` | `set_index_target` triggers pipeline dispatch with concurrency guard |
| `src-tauri/src/db/schema.rs` | Restore `processing_state` table |
| `src-tauri/src/state.rs` | Add `AtomicBool` for pipeline-running guard |
| `src-tauri/src/lib.rs` | Pass target to pipeline on startup |

## Behavior Matrix

| Scenario | Behavior |
|----------|----------|
| Fresh install, target=500 | Pipeline indexes 500 newest messages, then stops |
| App relaunch, 500 already embedded, target=500 | Pipeline skips, emits "done" immediately |
| User increases target 500→1000 | Pipeline dispatches, indexes 500 more newest messages |
| User decreases target 1000→500 | No action — existing 1000 embeddings remain |
| User clicks Rebuild | Clears all embeddings, re-runs pipeline up to current target |
| Pipeline running + user changes target | Change is saved; running pipeline finishes at old target; next trigger picks up new target |
