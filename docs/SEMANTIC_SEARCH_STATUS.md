# Semantic Search - Status & Known Issues

**Branch:** `feat/semantic-search`
**Date:** 2026-03-13
**Status:** Code complete, not yet producing embeddings at runtime

---

## What's been built

- MobileCLIP-S2 ONNX models exported (text: 242MB, vision: 137MB)
- Rust embedding pipeline: chunking, text embedding, attachment embedding
- Search UI with progress bars, index status, collapsible result sections
- Settings page with index target slider
- Nav bar indexing indicator

## What works

- App starts and opens immediately (model loading moved to background thread)
- CLIP models load successfully (~43s in debug mode)
- Pipeline starts after model loading
- Search UI renders correctly with all states (loading, empty, no results)

## What doesn't work yet

### Primary issue: Zero embeddings created

The pipeline starts but produces zero embeddings. Logs show:
```
Background: loading CLIP models...
Embedding pipeline starting...
```
Then the app exits or stalls with no further output. No chunks or embeddings appear in the DB.

### Root causes to investigate (in order)

1. **Pipeline loads ONNX models TWICE** - once for AppState (search queries) and once for the pipeline's own sessions in `load_pipeline_sessions()`. That's 380MB x 2 in debug mode. The pipeline's second load may be timing out or the app may be exiting before it completes.

2. **Debug mode is extremely slow for ONNX inference** - `cargo run` without `--release` runs unoptimized code. ONNX model loading takes ~43s per set. Inference on 233k messages could be prohibitively slow in debug mode. **Try a release build** (`cargo run --release`) or at minimum use `opt-level = 1` in `[profile.dev]`.

3. **Phase 1 (chunking) processes ALL 233k messages before any embeddings exist** - The chunking phase fetches 5000 messages at a time and tries to embed each chunk. If text encoding fails silently (e.g., ONNX inference error swallowed by `log::debug!`), you get chunks but zero embeddings.

4. **Text encoder input format** - Fixed to only send `input_ids` (no `attention_mask`). This fix is in the code but hasn't been verified working at runtime yet.

### Previous bugs fixed (in code, unverified at runtime)

| Bug | Fix | File |
|-----|-----|------|
| `attention_mask` sent to model that only accepts `input_ids` | Removed attention_mask from encode_texts | `clip.rs` |
| Tokenizer output not padded to 77 tokens | Fixed to constant SEQ_LEN = 77 | `clip.rs` |
| Integer overflow in chunker date comparison | Use i128 arithmetic | `chunker.rs` |
| Pipeline marks phases "done" even on total failure | Only set cursor when embeddings_created > 0 | `pipeline.rs` |
| ONNX models loaded on main thread blocking app startup | Moved to background thread with RwLock | `lib.rs`, `state.rs` |
| Model path resolution fails during `tauri dev` | Fallback to CARGO_MANIFEST_DIR | `lib.rs`, `pipeline.rs` |

## Next steps to get it working

### Step 1: Add a release profile for dev iteration
Add to `src-tauri/Cargo.toml`:
```toml
[profile.dev]
opt-level = 1

[profile.dev.package.ort]
opt-level = 3
```
This keeps compile times reasonable but makes ONNX inference much faster.

### Step 2: Add more logging to see where the pipeline stalls
In `pipeline.rs`, the Phase 1 chunking loop at line ~310 should log at the start of each batch:
```rust
log::info!("Phase 1: processing batch starting at rowid {}", last_rowid);
```
And each text encoding attempt should log at info level (currently debug):
```rust
log::info!("Embedded chunk {} successfully", chunk_db_id);
```

### Step 3: Verify ONNX text encoding works in isolation
Write a small test that loads the model and encodes a single string:
```rust
#[test]
fn test_text_encoding_e2e() {
    let session = Session::builder().unwrap().commit_from_file("resources/models/mobileclip_s2_text.onnx").unwrap();
    let tokenizer = Tokenizer::from_file("resources/models/tokenizer.json").unwrap();
    let result = clip::encode_texts(&mut session, &tokenizer, &["hello world"]);
    assert!(result.is_ok());
    assert_eq!(result.unwrap().len(), 1);
}
```

### Step 4: Clear stale state and restart
```bash
sqlite3 ~/Library/Application\ Support/com.placeholder.messageintelligence/analytics.db \
  "DELETE FROM embeddings; DELETE FROM message_chunks; DELETE FROM processing_state;"
```

### Step 5: Consider eliminating double model loading
The pipeline in `pipeline.rs` loads its own ONNX sessions via `load_pipeline_sessions()`. This is redundant with the AppState sessions. Consider passing the AppState sessions to the pipeline instead, or sharing them via Arc.

## Key files

| File | Purpose |
|------|---------|
| `src-tauri/src/embeddings/clip.rs` | CLIP encode_texts, encode_image, similarity |
| `src-tauri/src/embeddings/pipeline.rs` | Background indexing pipeline (3 phases) |
| `src-tauri/src/embeddings/chunker.rs` | Message grouping into chunks |
| `src-tauri/src/commands/embeddings.rs` | Tauri commands: search, status, rebuild |
| `src-tauri/src/state.rs` | AppState with RwLock CLIP fields |
| `src-tauri/src/lib.rs` | App init, background model loading |
| `src/components/search/global-search.tsx` | Search UI with progress |
| `src/components/settings/settings-page.tsx` | Settings with index slider |
| `scripts/export_mobileclip.py` | Python script to export ONNX models |

## Model files (not in git)

The `.onnx` files are gitignored. To regenerate:
```bash
cd scripts
python -m venv ../.venv
source ../.venv/bin/activate
pip install torch open_clip_torch onnx
python export_mobileclip.py
```
Output goes to `src-tauri/resources/models/`.
