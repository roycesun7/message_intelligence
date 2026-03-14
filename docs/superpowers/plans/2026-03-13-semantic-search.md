# Semantic Search with MobileCLIP-S2 — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multimodal semantic search to the iMessage analytics app using MobileCLIP-S2 embeddings via ONNX Runtime, with a three-section search UI (Messages, Links, Photos & Stickers).

**Architecture:** Background indexing pipeline chunks messages by sender, embeds text and images via MobileCLIP-S2 ONNX models, stores 512-dim vectors in analytics.db. Search encodes the query, runs brute-force cosine similarity, and returns grouped results. Priority-based indexing starts with the newest/oldest 500 messages, with user-controlled expansion via a settings slider.

**Tech Stack:** Rust (ort, image, ndarray, tokenizers), SQLite, React/TypeScript, Tauri v2, React Query, Zustand

---

## Implementation Notes (from plan review)

These corrections MUST be applied when implementing the tasks below:

1. **`get_messages_for_embedding` returns NULL chat_id.** The existing function at `chat_db.rs:236` uses `NULL AS chat_id`. Fix this by replacing it with a subquery: `(SELECT cmj.chat_id FROM chat_message_join cmj WHERE cmj.message_id = m.ROWID LIMIT 1) AS chat_id`. Apply this fix in Task 8 alongside the pipeline work.

2. **Store tokenizer in AppState.** Instead of loading the tokenizer from disk on every search call (fragile path resolution), load it once at startup alongside ONNX sessions and store as `pub tokenizer: Option<Arc<tokenizers::Tokenizer>>` in `AppState`. Update Task 4, 5, and 9 accordingly.

3. **Add chunk embedding pass.** The pipeline in Task 8 embeds individual messages but not the chunks themselves. After chunking, add a pass that iterates `message_chunks` rows, embeds their `concatenated_text`, and inserts with `source_type = "chunk"`. This is required for chunk-level semantic search.

4. **Use `tokio::task::spawn_blocking` for pipeline.** The pipeline does blocking I/O and CPU-bound ONNX inference. Wrap the main pipeline body in `spawn_blocking` instead of bare `tokio::spawn` to avoid blocking the async runtime.

5. **Fix `photosExpanded` ternary.** In Task 15, the line `<SearchResultPhotos results={photosExpanded ? photos : photos} />` is a no-op. Change to `<SearchResultPhotos results={photos} showAll={photosExpanded} />` and update `SearchResultPhotos` props to accept `showAll`.

6. **Frontend light mode support.** Tasks 14-16 hardcode dark theme colors. Add `dark:` prefix variants for all color classes so the components work with the existing light/dark toggle. Follow the existing patterns in `page.tsx` (e.g., `bg-[#F0EDE8] dark:bg-zinc-950`).

7. **Task commit ordering.** Tasks 2 (schema) and 3 (analytics_db) should be committed together since dropping `embedding_state` breaks `count_embedded` calls. Similarly, Task 6 (mod.rs) should not declare `pub mod chunker` and `pub mod pipeline` until those files exist — add module declarations in their respective tasks instead.

8. **`ort` v2 API.** Verify the exact `ort` v2 API for session creation. It may be `Session::builder()?.commit_from_file(path)` rather than `Session::builder().and_then(|b| b.with_model_from_file(path))`. Check docs at build time.

9. **`rebuild_search_index` should re-trigger pipeline.** After clearing embeddings, the command should also trigger the indexing pipeline to restart. Accept `AppHandle` as a parameter and call `spawn_indexing_pipeline` again.

10. **HEIC temp file uniqueness.** Use a unique temp filename (e.g., include the attachment rowid) in `convert_heic_to_jpeg` to avoid race conditions.

---

## File Structure

### Rust Backend (new files)

| File | Responsibility |
|------|---------------|
| `src-tauri/src/embeddings/clip.rs` | ONNX session initialization, text encoding, image encoding, cosine similarity |
| `src-tauri/src/embeddings/chunker.rs` | Message chunking logic (same-sender grouping with time-gap detection) |
| `src-tauri/src/embeddings/pipeline.rs` | Background indexing pipeline orchestrator (phases 1-3, bidirectional cursors, progress events) |
| `src-tauri/src/embeddings/mod.rs` | Module declarations |
| `src-tauri/resources/models/` | ONNX model files (mobileclip_s2_text.onnx, mobileclip_s2_vision.onnx, tokenizer.json) |

### Rust Backend (modified files)

| File | Changes |
|------|---------|
| `src-tauri/Cargo.toml` | Add `ort`, `image`, `ndarray`, `tokenizers` dependencies |
| `src-tauri/src/state.rs` | Add `clip_text` and `clip_vision` fields to `AppState` |
| `src-tauri/src/lib.rs` | Initialize ONNX sessions, spawn indexing pipeline, register new commands |
| `src-tauri/src/db/schema.rs` | Add `message_chunks`, `embeddings` tables; drop `embedding_state` |
| `src-tauri/src/db/analytics_db.rs` | Replace old embedding helpers with new chunk/embedding insert/query functions |
| `src-tauri/src/commands/embeddings.rs` | Rewrite `check_embedding_status` and `semantic_search` with real implementations |
| `src-tauri/tauri.conf.json` | Add `resources` entry for model files |

### Frontend (new files)

| File | Responsibility |
|------|---------------|
| `src/components/search/search-result-message.tsx` | Message bubble search result (blue right / gray left) |
| `src/components/search/search-result-link.tsx` | 2-column link card grid |
| `src/components/search/search-result-photo.tsx` | 3-column image grid with lazy thumbnails |
| `src/components/settings/settings-page.tsx` | Settings view with Search Index section (slider, status, rebuild) |
| `src/components/layout/indexing-status-bar.tsx` | Persistent progress indicator during indexing |
| `src/hooks/use-search.ts` | React Query hook for semantic search with debounce |

### Frontend (modified files)

| File | Changes |
|------|---------|
| `src/types/index.ts` | Update `EmbeddingStatus` and `SemanticSearchResult` interfaces |
| `src/lib/commands.ts` | Update embedding/search command wrappers, add new commands |
| `src/stores/app-store.ts` | Add `"settings"` to `AppView` type |
| `src/app/page.tsx` | Add settings nav item and gear icon, render `SettingsPage` |
| `src/components/search/global-search.tsx` | Rewrite from "Coming Soon" to functional search UI |

---

## Chunk 1: Foundation — Dependencies, Schema, and ONNX Setup

### Task 1: Add Rust Dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml:17-33`

- [ ] **Step 1: Add new dependencies to Cargo.toml**

Add these dependencies below the existing ones:

```toml
ort = { version = "2", features = ["load-dynamic"] }
ndarray = "0.16"
image = { version = "0.25", default-features = false, features = ["jpeg", "png", "gif", "webp", "tiff"] }
tokenizers = { version = "0.20", default-features = false }
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles successfully (may take a while to download/build deps the first time)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(deps): add ort, ndarray, image, tokenizers for MobileCLIP-S2"
```

---

### Task 2: Update Database Schema

**Files:**
- Modify: `src-tauri/src/db/schema.rs:1-116`

- [ ] **Step 1: Add new tables and drop old embedding_state**

In `run_migrations()`, after the existing `CREATE TABLE` batch (before the FTS5 section at line 109), add a new `execute_batch` call:

```rust
// Drop legacy Ollama embedding tracking table
conn.execute_batch("DROP TABLE IF EXISTS embedding_state;")?;

// New tables for MobileCLIP-S2 semantic search
conn.execute_batch(
    "
    CREATE TABLE IF NOT EXISTS message_chunks (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id           INTEGER NOT NULL,
        is_from_me        INTEGER NOT NULL,
        handle_id         INTEGER,
        first_rowid       INTEGER NOT NULL,
        last_rowid        INTEGER NOT NULL,
        message_count     INTEGER NOT NULL,
        concatenated_text TEXT NOT NULL,
        started_at        INTEGER NOT NULL,
        ended_at          INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_chat ON message_chunks(chat_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_first_rowid ON message_chunks(first_rowid);

    CREATE TABLE IF NOT EXISTS embeddings (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL,
        source_id   INTEGER NOT NULL,
        chunk_id    INTEGER,
        chat_id     INTEGER NOT NULL,
        model       TEXT NOT NULL,
        vector      BLOB NOT NULL,
        embedded_at TEXT NOT NULL,
        UNIQUE(source_type, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_embeddings_chat ON embeddings(chat_id);

    CREATE TABLE IF NOT EXISTS search_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    ",
)?;
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles successfully

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/db/schema.rs
git commit -m "feat(schema): add message_chunks, embeddings tables; drop embedding_state"
```

---

### Task 3: Update analytics_db Helpers

**Files:**
- Modify: `src-tauri/src/db/analytics_db.rs:57-77`

- [ ] **Step 1: Replace old embedding helpers with new ones**

Replace the `// ── Embedding state` section (lines 57-77) with:

```rust
// ── Embeddings (MobileCLIP-S2) ─────────────────────────────────────────

/// Insert a message chunk.
pub fn insert_chunk(
    conn: &Connection,
    chat_id: i64,
    is_from_me: bool,
    handle_id: Option<i64>,
    first_rowid: i64,
    last_rowid: i64,
    message_count: i64,
    concatenated_text: &str,
    started_at: i64,
    ended_at: i64,
) -> AppResult<i64> {
    conn.execute(
        "INSERT INTO message_chunks
            (chat_id, is_from_me, handle_id, first_rowid, last_rowid, message_count, concatenated_text, started_at, ended_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![chat_id, is_from_me, handle_id, first_rowid, last_rowid, message_count, concatenated_text, started_at, ended_at],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Insert an embedding vector.
pub fn insert_embedding(
    conn: &Connection,
    source_type: &str,
    source_id: i64,
    chunk_id: Option<i64>,
    chat_id: i64,
    model: &str,
    vector: &[u8],
) -> AppResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO embeddings
            (source_type, source_id, chunk_id, chat_id, model, vector, embedded_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))",
        params![source_type, source_id, chunk_id, chat_id, model, vector],
    )?;
    Ok(())
}

/// Count total embeddings.
pub fn count_embeddings(conn: &Connection) -> AppResult<i64> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM embeddings",
        [],
        |row| row.get(0),
    )?;
    Ok(count)
}

/// Load all embedding vectors for brute-force search.
/// Returns (id, source_type, source_id, chunk_id, chat_id, vector_blob).
pub fn load_all_embeddings(conn: &Connection) -> AppResult<Vec<(i64, String, i64, Option<i64>, i64, Vec<u8>)>> {
    let mut stmt = conn.prepare(
        "SELECT id, source_type, source_id, chunk_id, chat_id, vector FROM embeddings"
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
            row.get(5)?,
        ))
    })?
    .filter_map(|r| r.ok())
    .collect();
    Ok(rows)
}

/// Get or set a search setting.
pub fn get_search_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM search_settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    ).ok()
}

pub fn set_search_setting(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO search_settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )?;
    Ok(())
}

/// Clear all embedding data (for rebuild).
pub fn clear_embeddings(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "DELETE FROM embeddings;
         DELETE FROM message_chunks;
         DELETE FROM processing_state WHERE pipeline_name IN ('chunking', 'embedding_recent', 'embedding_oldest');"
    )?;
    Ok(())
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles successfully

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/db/analytics_db.rs
git commit -m "feat(db): replace embedding_state helpers with chunk/embedding functions"
```

---

### Task 4: Add ONNX Session to AppState

**Files:**
- Modify: `src-tauri/src/state.rs:1-49`

- [ ] **Step 1: Add ONNX session fields**

Add the `ort` import and new fields to `AppState`:

```rust
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use crate::error::{AppError, AppResult};

/// Holds database connections, contact map, and ML model sessions.
pub struct AppState {
    pub chat_db: Arc<Mutex<Option<Connection>>>,
    pub analytics_db: Arc<Mutex<Connection>>,
    pub contact_map: Arc<Mutex<HashMap<String, String>>>,
    /// MobileCLIP-S2 text encoder ONNX session. None if models not found.
    pub clip_text: Option<Arc<ort::Session>>,
    /// MobileCLIP-S2 image encoder ONNX session. None if models not found.
    pub clip_vision: Option<Arc<ort::Session>>,
}
```

The rest of the file (ChatDbGuard, impl AppState) stays unchanged.

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: May fail because `lib.rs` constructs `AppState` without the new fields — that's expected, we'll fix it in Task 5.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/state.rs
git commit -m "feat(state): add clip_text and clip_vision ONNX session fields"
```

---

### Task 5: ONNX Session Initialization in lib.rs

**Files:**
- Modify: `src-tauri/src/lib.rs:1-139`

- [ ] **Step 1: Add ONNX initialization function and update setup**

Add a helper function before `run()` to load ONNX sessions:

```rust
use std::sync::Arc;

/// Attempt to load MobileCLIP-S2 ONNX sessions from the app resources.
/// Returns (text_session, vision_session) or (None, None) if models are not found.
fn load_clip_sessions(app: &tauri::App) -> (Option<Arc<ort::Session>>, Option<Arc<ort::Session>>) {
    let resource_dir = match app.path().resource_dir() {
        Ok(dir) => dir,
        Err(e) => {
            log::warn!("Cannot resolve resource dir for ONNX models: {e}");
            return (None, None);
        }
    };

    let text_model_path = resource_dir.join("models/mobileclip_s2_text.onnx");
    let vision_model_path = resource_dir.join("models/mobileclip_s2_vision.onnx");

    if !text_model_path.exists() || !vision_model_path.exists() {
        log::info!("MobileCLIP-S2 model files not found — semantic search disabled");
        return (None, None);
    }

    let build_session = |path: &std::path::Path, name: &str| -> Option<Arc<ort::Session>> {
        match ort::Session::builder()
            .and_then(|b| b.with_model_from_file(path))
        {
            Ok(session) => {
                log::info!("Loaded MobileCLIP-S2 {name} encoder");
                Some(Arc::new(session))
            }
            Err(e) => {
                log::warn!("Failed to load MobileCLIP-S2 {name} encoder: {e}");
                None
            }
        }
    };

    let text_session = build_session(&text_model_path, "text");
    let vision_session = build_session(&vision_model_path, "vision");
    (text_session, vision_session)
}
```

Then update the `setup` closure to load sessions and pass them to `AppState`:

```rust
// After contact_map is built, before app.manage():
let (clip_text, clip_vision) = load_clip_sessions(app);

app.manage(AppState {
    chat_db: Arc::new(Mutex::new(chat_db)),
    analytics_db: Arc::new(Mutex::new(analytics_db)),
    contact_map: Arc::new(Mutex::new(contact_map)),
    clip_text,
    clip_vision,
});
```

- [ ] **Step 2: Add resource bundle config**

In `src-tauri/tauri.conf.json`, add `resources` field inside the `bundle` section (after `"longDescription"`):

```json
"resources": ["resources/models/*"]
```

- [ ] **Step 3: Create model directory placeholder**

```bash
mkdir -p src-tauri/resources/models
echo "Place mobileclip_s2_text.onnx, mobileclip_s2_vision.onnx, and tokenizer.json here." > src-tauri/resources/models/README.md
```

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles successfully. Models aren't present yet so sessions will be None at runtime.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/tauri.conf.json src-tauri/resources/models/README.md
git commit -m "feat: ONNX session initialization and model resource bundling"
```

---

### Task 6: CLIP Encoder Module (clip.rs)

**Files:**
- Create: `src-tauri/src/embeddings/clip.rs`
- Modify: `src-tauri/src/embeddings/mod.rs`

- [ ] **Step 1: Write clip.rs — text encoding, image encoding, cosine similarity**

```rust
use ndarray::{Array1, Array2, Array3, ArrayView1};
use ort::Session;
use std::path::Path;
use std::sync::Arc;

use crate::error::{AppError, AppResult};

const EMBEDDING_DIM: usize = 512;
const IMAGE_SIZE: usize = 256;
const CLIP_MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const CLIP_STD: [f32; 3] = [0.229, 0.224, 0.225];

/// Encode a batch of texts into embedding vectors using the CLIP text encoder.
/// The tokenizer handles truncation at 77 tokens.
pub fn encode_texts(
    session: &Session,
    tokenizer: &tokenizers::Tokenizer,
    texts: &[&str],
) -> AppResult<Vec<[f32; EMBEDDING_DIM]>> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }

    let encodings = tokenizer
        .encode_batch(texts.to_vec(), true)
        .map_err(|e| AppError::Custom(format!("Tokenization failed: {e}")))?;

    let batch_size = encodings.len();
    let seq_len = encodings.iter().map(|e| e.get_ids().len()).max().unwrap_or(0);

    // Build input_ids and attention_mask tensors
    let mut input_ids = vec![0i64; batch_size * seq_len];
    let mut attention_mask = vec![0i64; batch_size * seq_len];

    for (i, enc) in encodings.iter().enumerate() {
        let ids = enc.get_ids();
        let mask = enc.get_attention_mask();
        for (j, (&id, &m)) in ids.iter().zip(mask.iter()).enumerate() {
            input_ids[i * seq_len + j] = id as i64;
            attention_mask[i * seq_len + j] = m as i64;
        }
    }

    let input_ids_array = ndarray::Array2::from_shape_vec((batch_size, seq_len), input_ids)
        .map_err(|e| AppError::Custom(format!("Shape error: {e}")))?;
    let attention_mask_array = ndarray::Array2::from_shape_vec((batch_size, seq_len), attention_mask)
        .map_err(|e| AppError::Custom(format!("Shape error: {e}")))?;

    let outputs = session.run(
        ort::inputs![
            "input_ids" => input_ids_array,
            "attention_mask" => attention_mask_array,
        ]
        .map_err(|e| AppError::Custom(format!("ONNX input error: {e}")))?,
    ).map_err(|e| AppError::Custom(format!("ONNX inference error: {e}")))?;

    // Extract embeddings — output shape is [batch_size, EMBEDDING_DIM]
    let output_tensor = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| AppError::Custom(format!("Output extraction error: {e}")))?;
    let output_view = output_tensor.view();

    let mut results = Vec::with_capacity(batch_size);
    for i in 0..batch_size {
        let mut embedding = [0.0f32; EMBEDDING_DIM];
        for j in 0..EMBEDDING_DIM {
            embedding[j] = output_view[[i, j]];
        }
        // L2 normalize
        let norm: f32 = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            for x in &mut embedding {
                *x /= norm;
            }
        }
        results.push(embedding);
    }

    Ok(results)
}

/// Encode a single image into an embedding vector using the CLIP vision encoder.
/// Image is decoded, resized to 256x256, normalized, and passed to the model.
pub fn encode_image(
    session: &Session,
    image_bytes: &[u8],
) -> AppResult<[f32; EMBEDDING_DIM]> {
    let img = image::load_from_memory(image_bytes)
        .map_err(|e| AppError::Custom(format!("Image decode error: {e}")))?;
    let resized = img.resize_exact(
        IMAGE_SIZE as u32,
        IMAGE_SIZE as u32,
        image::imageops::FilterType::CatmullRom,
    );
    let rgb = resized.to_rgb8();

    // Build [1, 3, 256, 256] f32 tensor with CLIP normalization
    let mut pixel_data = vec![0.0f32; 3 * IMAGE_SIZE * IMAGE_SIZE];
    for y in 0..IMAGE_SIZE {
        for x in 0..IMAGE_SIZE {
            let pixel = rgb.get_pixel(x as u32, y as u32);
            for c in 0..3 {
                let val = pixel[c] as f32 / 255.0;
                let normalized = (val - CLIP_MEAN[c]) / CLIP_STD[c];
                pixel_data[c * IMAGE_SIZE * IMAGE_SIZE + y * IMAGE_SIZE + x] = normalized;
            }
        }
    }

    let input_tensor = ndarray::Array4::from_shape_vec(
        (1, 3, IMAGE_SIZE, IMAGE_SIZE),
        pixel_data,
    ).map_err(|e| AppError::Custom(format!("Shape error: {e}")))?;

    let outputs = session.run(
        ort::inputs![
            "pixel_values" => input_tensor,
        ]
        .map_err(|e| AppError::Custom(format!("ONNX input error: {e}")))?,
    ).map_err(|e| AppError::Custom(format!("ONNX inference error: {e}")))?;

    let output_tensor = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| AppError::Custom(format!("Output extraction error: {e}")))?;
    let output_view = output_tensor.view();

    let mut embedding = [0.0f32; EMBEDDING_DIM];
    for j in 0..EMBEDDING_DIM {
        embedding[j] = output_view[[0, j]];
    }
    // L2 normalize
    let norm: f32 = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for x in &mut embedding {
            *x /= norm;
        }
    }

    Ok(embedding)
}

/// Convert a 512-dim f32 embedding to a byte blob for SQLite storage.
pub fn embedding_to_blob(embedding: &[f32; EMBEDDING_DIM]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(EMBEDDING_DIM * 4);
    for &val in embedding {
        bytes.extend_from_slice(&val.to_le_bytes());
    }
    bytes
}

/// Convert a byte blob back to a 512-dim f32 embedding.
pub fn blob_to_embedding(blob: &[u8]) -> AppResult<[f32; EMBEDDING_DIM]> {
    if blob.len() != EMBEDDING_DIM * 4 {
        return Err(AppError::Custom(format!(
            "Invalid embedding blob size: {} (expected {})",
            blob.len(),
            EMBEDDING_DIM * 4
        )));
    }
    let mut embedding = [0.0f32; EMBEDDING_DIM];
    for i in 0..EMBEDDING_DIM {
        let bytes = [blob[i * 4], blob[i * 4 + 1], blob[i * 4 + 2], blob[i * 4 + 3]];
        embedding[i] = f32::from_le_bytes(bytes);
    }
    Ok(embedding)
}

/// Compute cosine similarity between two L2-normalized vectors.
/// Since vectors are already normalized, this is just the dot product.
pub fn cosine_similarity(a: &[f32; EMBEDDING_DIM], b: &[f32; EMBEDDING_DIM]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}
```

- [ ] **Step 2: Update embeddings/mod.rs**

```rust
pub mod chunker;
pub mod clip;
pub mod pipeline;
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: May have warnings about unused functions — that's fine, they'll be used by pipeline.rs.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/embeddings/
git commit -m "feat(clip): ONNX text/image encoding, vector serialization, cosine similarity"
```

---

### Task 7: Message Chunker (chunker.rs)

**Files:**
- Create: `src-tauri/src/embeddings/chunker.rs`

- [ ] **Step 1: Write the chunker**

```rust
use crate::db::models::Message;

/// A chunk of consecutive messages from a single sender.
pub struct MessageChunk {
    pub chat_id: i64,
    pub is_from_me: bool,
    pub handle_id: Option<i64>,
    pub first_rowid: i64,
    pub last_rowid: i64,
    pub message_count: i64,
    pub concatenated_text: String,
    pub started_at: i64, // unix ms
    pub ended_at: i64,   // unix ms
    /// The individual message rowids in this chunk
    pub message_rowids: Vec<i64>,
}

/// 5-minute gap threshold in milliseconds
const GAP_THRESHOLD_MS: i64 = 5 * 60 * 1000;

/// Group messages into chunks. A new chunk starts when:
/// 1. Sender changes (different is_from_me or handle_id)
/// 2. Time gap > 5 minutes between consecutive same-sender messages
/// 3. Chat changes
///
/// Messages MUST be sorted by date ASC within each chat.
pub fn chunk_messages(messages: &[Message]) -> Vec<MessageChunk> {
    if messages.is_empty() {
        return Vec::new();
    }

    let mut chunks = Vec::new();
    let mut current_texts: Vec<String> = Vec::new();
    let mut current_rowids: Vec<i64> = Vec::new();
    let mut current_chat_id = messages[0].chat_id.unwrap_or(0);
    let mut current_is_from_me = messages[0].is_from_me;
    let mut current_handle_id = messages[0].handle_id;
    let mut current_first_rowid = messages[0].rowid;
    let mut current_started_at = messages[0].date;
    let mut current_ended_at = messages[0].date;

    if let Some(ref text) = messages[0].text {
        if !text.is_empty() {
            current_texts.push(text.clone());
        }
    }
    current_rowids.push(messages[0].rowid);

    for msg in &messages[1..] {
        let msg_chat_id = msg.chat_id.unwrap_or(0);
        let sender_changed = msg.is_from_me != current_is_from_me || msg.handle_id != current_handle_id;
        let chat_changed = msg_chat_id != current_chat_id;
        let time_gap = msg.date - current_ended_at > GAP_THRESHOLD_MS;

        if sender_changed || chat_changed || time_gap {
            // Finish current chunk
            if !current_texts.is_empty() {
                chunks.push(MessageChunk {
                    chat_id: current_chat_id,
                    is_from_me: current_is_from_me,
                    handle_id: if current_is_from_me { None } else { Some(current_handle_id) },
                    first_rowid: current_first_rowid,
                    last_rowid: *current_rowids.last().unwrap(),
                    message_count: current_rowids.len() as i64,
                    concatenated_text: current_texts.join(" "),
                    started_at: current_started_at,
                    ended_at: current_ended_at,
                    message_rowids: current_rowids.clone(),
                });
            }

            // Start new chunk
            current_texts.clear();
            current_rowids.clear();
            current_chat_id = msg_chat_id;
            current_is_from_me = msg.is_from_me;
            current_handle_id = msg.handle_id;
            current_first_rowid = msg.rowid;
            current_started_at = msg.date;
        }

        if let Some(ref text) = msg.text {
            if !text.is_empty() {
                current_texts.push(text.clone());
            }
        }
        current_rowids.push(msg.rowid);
        current_ended_at = msg.date;
    }

    // Don't forget the last chunk
    if !current_texts.is_empty() {
        chunks.push(MessageChunk {
            chat_id: current_chat_id,
            is_from_me: current_is_from_me,
            handle_id: if current_is_from_me { None } else { Some(current_handle_id) },
            first_rowid: current_first_rowid,
            last_rowid: *current_rowids.last().unwrap(),
            message_count: current_rowids.len() as i64,
            concatenated_text: current_texts.join(" "),
            started_at: current_started_at,
            ended_at: current_ended_at,
            message_rowids: current_rowids,
        });
    }

    chunks
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles with possible unused warnings

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/embeddings/chunker.rs
git commit -m "feat(chunker): message grouping by sender with time-gap detection"
```

---

## Chunk 2: Embedding Pipeline and Search Commands

### Task 8: Background Indexing Pipeline (pipeline.rs)

**Files:**
- Create: `src-tauri/src/embeddings/pipeline.rs`

- [ ] **Step 1: Write the pipeline orchestrator**

```rust
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::{analytics_db, chat_db};
use crate::embeddings::{chunker, clip};
use crate::error::AppResult;
use crate::state::AppState;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingProgress {
    pub phase: String,
    pub processed: i64,
    pub total: i64,
}

/// Spawn the background indexing pipeline.
/// Opens its own DB connections to avoid blocking the UI.
pub fn spawn_indexing_pipeline(app_handle: AppHandle) {
    let state = app_handle.state::<AppState>();
    let clip_text = match state.clip_text.clone() {
        Some(s) => s,
        None => {
            log::info!("ONNX models not available — skipping indexing pipeline");
            return;
        }
    };
    let clip_vision = match state.clip_vision.clone() {
        Some(s) => s,
        None => return,
    };

    tokio::spawn(async move {
        if let Err(e) = run_pipeline(app_handle, clip_text, clip_vision).await {
            log::error!("Indexing pipeline error: {e}");
        }
    });
}

async fn run_pipeline(
    app_handle: AppHandle,
    clip_text: Arc<ort::Session>,
    clip_vision: Arc<ort::Session>,
) -> AppResult<()> {
    // Open dedicated DB connections for the pipeline
    let chat_db_path = dirs::home_dir()
        .ok_or_else(|| crate::error::AppError::Custom("Cannot determine home dir".into()))?
        .join("Library/Messages/chat.db");

    let chat_conn = Connection::open_with_flags(
        &chat_db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;

    let data_dir = app_handle.path().app_data_dir()
        .map_err(|e| crate::error::AppError::Custom(format!("Cannot resolve app data dir: {e}")))?;
    let analytics_conn = Connection::open(data_dir.join("analytics.db"))?;
    analytics_conn.execute_batch("PRAGMA journal_mode = WAL;")?;

    // Load tokenizer
    let resource_dir = app_handle.path().resource_dir()
        .map_err(|e| crate::error::AppError::Custom(format!("Cannot resolve resource dir: {e}")))?;
    let tokenizer_path = resource_dir.join("models/tokenizer.json");
    let tokenizer = tokenizers::Tokenizer::from_file(&tokenizer_path)
        .map_err(|e| crate::error::AppError::Custom(format!("Failed to load tokenizer: {e}")))?;

    // Read target from settings (default: 1000)
    let target: i64 = analytics_db::get_search_setting(&analytics_conn, "index_target")
        .and_then(|v| v.parse().ok())
        .unwrap_or(1000);

    let total_messages = chat_db::get_total_message_count(&chat_conn)?;

    // Phase 1: Chunking
    let _ = app_handle.emit("embedding-progress", EmbeddingProgress {
        phase: "chunking".into(),
        processed: 0,
        total: total_messages,
    });

    run_chunking(&chat_conn, &analytics_conn, &app_handle, total_messages)?;

    // Phase 2 & 3: Bidirectional embedding
    run_embedding(
        &chat_conn,
        &analytics_conn,
        &app_handle,
        &clip_text,
        &clip_vision,
        &tokenizer,
        target,
        total_messages,
    )?;

    log::info!("Indexing pipeline completed");
    Ok(())
}

fn run_chunking(
    chat_conn: &Connection,
    analytics_conn: &Connection,
    app_handle: &AppHandle,
    total: i64,
) -> AppResult<()> {
    let last_rowid = analytics_db::get_last_processed_rowid(analytics_conn, "chunking")?;

    // Process in batches of 5000
    let batch_size = 5000i64;
    let mut after_rowid = last_rowid;
    let mut processed = 0i64;
    let contact_map = std::collections::HashMap::new(); // No contact resolution needed for chunking

    loop {
        let messages = chat_db::get_messages_for_embedding(chat_conn, after_rowid, batch_size)?;
        if messages.is_empty() {
            break;
        }

        let last_msg_rowid = messages.last().unwrap().rowid;
        let chunks = chunker::chunk_messages(&messages);

        for chunk in &chunks {
            analytics_db::insert_chunk(
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
        }

        processed += messages.len() as i64;
        after_rowid = last_msg_rowid;
        analytics_db::update_processing_state(analytics_conn, "chunking", after_rowid, processed)?;

        let _ = app_handle.emit("embedding-progress", EmbeddingProgress {
            phase: "chunking".into(),
            processed,
            total,
        });
    }

    Ok(())
}

fn run_embedding(
    chat_conn: &Connection,
    analytics_conn: &Connection,
    app_handle: &AppHandle,
    clip_text: &ort::Session,
    clip_vision: &ort::Session,
    tokenizer: &tokenizers::Tokenizer,
    target: i64,
    total_messages: i64,
) -> AppResult<()> {
    // Get the range of message rowids
    let (min_rowid, max_rowid): (i64, i64) = chat_conn.query_row(
        "SELECT COALESCE(MIN(ROWID), 0), COALESCE(MAX(ROWID), 0) FROM message WHERE associated_message_type = 0",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    if max_rowid == 0 {
        return Ok(());
    }

    // Get current cursors
    let recent_cursor = analytics_db::get_last_processed_rowid(analytics_conn, "embedding_recent")?;
    let oldest_cursor = analytics_db::get_last_processed_rowid(analytics_conn, "embedding_oldest")?;

    // Initialize cursors if first run
    let mut recent_pos = if recent_cursor == 0 { max_rowid + 1 } else { recent_cursor };
    let mut oldest_pos = if oldest_cursor == 0 { min_rowid - 1 } else { oldest_cursor };

    let embedded_count = analytics_db::count_embeddings(analytics_conn)?;
    let remaining = target - embedded_count;
    if remaining <= 0 {
        log::info!("Target of {target} embeddings already reached ({embedded_count} indexed)");
        return Ok(());
    }

    let batch_size = 64;
    let half_target = remaining / 2;
    let mut embedded_from_recent = 0i64;
    let mut embedded_from_oldest = 0i64;

    // Embed from recent end
    while embedded_from_recent < half_target && recent_pos > min_rowid {
        let messages = get_messages_before(chat_conn, recent_pos, batch_size)?;
        if messages.is_empty() {
            break;
        }

        recent_pos = messages.last().unwrap().rowid;
        let count = embed_text_batch(analytics_conn, clip_text, tokenizer, &messages)?;
        embed_attachments_for_messages(chat_conn, analytics_conn, clip_text, clip_vision, tokenizer, &messages)?;
        embedded_from_recent += count;

        analytics_db::update_processing_state(analytics_conn, "embedding_recent", recent_pos, embedded_from_recent)?;
        let _ = app_handle.emit("embedding-progress", EmbeddingProgress {
            phase: "text".into(),
            processed: embedded_from_recent + embedded_from_oldest + embedded_count,
            total: target,
        });
    }

    // Embed from oldest end
    while embedded_from_oldest < remaining - embedded_from_recent && oldest_pos < max_rowid {
        let messages = chat_db::get_messages_for_embedding(chat_conn, oldest_pos, batch_size)?;
        if messages.is_empty() {
            break;
        }

        oldest_pos = messages.last().unwrap().rowid;
        let count = embed_text_batch(analytics_conn, clip_text, tokenizer, &messages)?;
        embed_attachments_for_messages(chat_conn, analytics_conn, clip_text, clip_vision, tokenizer, &messages)?;
        embedded_from_oldest += count;

        analytics_db::update_processing_state(analytics_conn, "embedding_oldest", oldest_pos, embedded_from_oldest)?;
        let _ = app_handle.emit("embedding-progress", EmbeddingProgress {
            phase: "text".into(),
            processed: embedded_from_recent + embedded_from_oldest + embedded_count,
            total: target,
        });
    }

    let _ = app_handle.emit("embedding-progress", EmbeddingProgress {
        phase: "done".into(),
        processed: embedded_from_recent + embedded_from_oldest + embedded_count,
        total: target,
    });

    Ok(())
}

/// Get messages with rowid < before_rowid, ordered by rowid DESC, limited to batch_size.
fn get_messages_before(
    conn: &Connection,
    before_rowid: i64,
    batch_size: i64,
) -> AppResult<Vec<crate::db::models::Message>> {
    let mut stmt = conn.prepare(
        "SELECT
            m.ROWID, m.guid, m.text, m.attributedBody, m.is_from_me, m.date,
            m.date_read, m.date_delivered, m.handle_id, m.service,
            m.associated_message_type, m.associated_message_guid,
            m.cache_has_attachments, m.thread_originator_guid, m.group_title,
            m.is_audio_message,
            (SELECT cmj.chat_id FROM chat_message_join cmj WHERE cmj.message_id = m.ROWID LIMIT 1) AS chat_id
         FROM message AS m
         WHERE m.ROWID < ?1
           AND m.text IS NOT NULL
           AND m.text != ''
           AND m.associated_message_type = 0
         ORDER BY m.ROWID DESC
         LIMIT ?2",
    )?;

    use crate::db::models::RawMessageRow;
    let messages: Vec<crate::db::models::Message> = stmt
        .query_map(rusqlite::params![before_rowid, batch_size], |row| {
            Ok(RawMessageRow {
                rowid: row.get(0)?,
                guid: row.get(1)?,
                text: row.get(2)?,
                attributed_body: row.get(3)?,
                is_from_me: row.get(4)?,
                date: row.get(5)?,
                date_read: row.get(6)?,
                date_delivered: row.get(7)?,
                handle_id: row.get(8)?,
                service: row.get(9)?,
                associated_message_type: row.get(10)?,
                associated_message_guid: row.get(11)?,
                cache_has_attachments: row.get(12)?,
                thread_originator_guid: row.get(13)?,
                group_title: row.get(14)?,
                is_audio_message: row.get(15)?,
                chat_id: row.get(16)?,
            })
        })?
        .filter_map(|r| r.ok())
        .map(|raw| raw.into_message(None, None))
        .collect();

    Ok(messages)
}

/// Embed a batch of messages (individual text embeddings).
/// Returns the number of embeddings created.
fn embed_text_batch(
    analytics_conn: &Connection,
    clip_text: &ort::Session,
    tokenizer: &tokenizers::Tokenizer,
    messages: &[crate::db::models::Message],
) -> AppResult<i64> {
    let texts: Vec<&str> = messages
        .iter()
        .filter_map(|m| m.text.as_deref())
        .collect();

    if texts.is_empty() {
        return Ok(0);
    }

    let embeddings = clip::encode_texts(clip_text, tokenizer, &texts)?;

    let mut count = 0i64;
    let mut text_idx = 0;
    for msg in messages {
        if msg.text.is_some() {
            if text_idx < embeddings.len() {
                let blob = clip::embedding_to_blob(&embeddings[text_idx]);
                analytics_db::insert_embedding(
                    analytics_conn,
                    "message",
                    msg.rowid,
                    None,
                    msg.chat_id.unwrap_or(0),
                    "mobileclip-s2",
                    &blob,
                )?;
                count += 1;
                text_idx += 1;
            }
        }
    }

    Ok(count)
}

/// Embed image attachments for a batch of messages.
fn embed_attachments_for_messages(
    chat_conn: &Connection,
    analytics_conn: &Connection,
    clip_text: &ort::Session,
    clip_vision: &ort::Session,
    tokenizer: &tokenizers::Tokenizer,
    messages: &[crate::db::models::Message],
) -> AppResult<()> {
    for msg in messages {
        if !msg.cache_has_attachments {
            continue;
        }

        let attachments = chat_db::get_attachments_for_message(chat_conn, msg.rowid)?;
        for att in &attachments {
            let mime = att.mime_type.as_deref().unwrap_or("");
            let filename = att.filename.as_deref().unwrap_or("");

            // Skip plugin payload attachments
            if filename.ends_with(".pluginPayloadAttachment") {
                continue;
            }

            if mime.starts_with("image/") {
                // Try to read and embed the image
                let expanded_path = if filename.starts_with('~') {
                    dirs::home_dir()
                        .map(|h| h.join(&filename[2..]))
                        .unwrap_or_else(|| std::path::PathBuf::from(filename))
                } else {
                    std::path::PathBuf::from(filename)
                };

                if let Ok(image_bytes) = std::fs::read(&expanded_path) {
                    // Handle HEIC by converting to JPEG first
                    let bytes_to_encode = if mime == "image/heic" || mime == "image/heif" {
                        convert_heic_to_jpeg(&expanded_path).unwrap_or(image_bytes)
                    } else {
                        image_bytes
                    };

                    match clip::encode_image(clip_vision, &bytes_to_encode) {
                        Ok(embedding) => {
                            let blob = clip::embedding_to_blob(&embedding);
                            analytics_db::insert_embedding(
                                analytics_conn,
                                "attachment",
                                att.rowid,
                                None,
                                msg.chat_id.unwrap_or(0),
                                "mobileclip-s2",
                                &blob,
                            )?;
                        }
                        Err(e) => {
                            log::warn!("Failed to embed image {}: {e}", filename);
                        }
                    }
                }
            } else if mime == "application/pdf" {
                // Extract text from PDF and embed as text
                // For now, skip PDF — can be added as an enhancement
                log::debug!("Skipping PDF attachment: {}", filename);
            }
        }
    }

    Ok(())
}

/// Convert HEIC to JPEG via macOS sips command (matches existing pattern in attachments.rs)
fn convert_heic_to_jpeg(path: &std::path::Path) -> Option<Vec<u8>> {
    let temp_dir = std::env::temp_dir();
    let temp_path = temp_dir.join("clip_temp.jpg");

    let output = std::process::Command::new("/usr/bin/sips")
        .args(["-s", "format", "jpeg", "-s", "formatOptions", "80"])
        .arg(path)
        .arg("--out")
        .arg(&temp_path)
        .output()
        .ok()?;

    if output.status.success() {
        std::fs::read(&temp_path).ok()
    } else {
        None
    }
}
```

- [ ] **Step 2: Make RawMessageRow public for pipeline access**

In `src-tauri/src/db/models.rs`, change line 74 from `pub(crate) struct RawMessageRow` to `pub struct RawMessageRow`.

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles successfully

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/embeddings/pipeline.rs src-tauri/src/db/models.rs
git commit -m "feat(pipeline): background indexing with bidirectional embedding and attachment support"
```

---

### Task 9: Rewrite Embedding Commands

**Files:**
- Modify: `src-tauri/src/commands/embeddings.rs:1-54`

- [ ] **Step 1: Rewrite the entire file**

```rust
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

use crate::db::analytics_db;
use crate::embeddings::clip;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingStatus {
    pub models_loaded: bool,
    pub total_embedded: i64,
    pub total_messages: i64,
    pub index_target: i64,
}

/// Check the current status of the embedding pipeline.
#[tauri::command]
pub fn check_embedding_status(state: State<'_, AppState>) -> AppResult<EmbeddingStatus> {
    let chat_conn = state.lock_chat_db()?;
    let analytics_conn = state.lock_analytics_db()?;

    let total_messages = crate::db::chat_db::get_total_message_count(&chat_conn)?;
    let total_embedded = analytics_db::count_embeddings(&analytics_conn)?;
    let index_target = analytics_db::get_search_setting(&analytics_conn, "index_target")
        .and_then(|v| v.parse().ok())
        .unwrap_or(1000);

    Ok(EmbeddingStatus {
        models_loaded: state.clip_text.is_some() && state.clip_vision.is_some(),
        total_embedded,
        total_messages,
        index_target,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSearchResult {
    pub source_type: String,
    pub source_id: i64,
    pub message_rowid: i64,
    pub chat_id: i64,
    pub score: f64,
    pub text: Option<String>,
    pub is_from_me: bool,
    pub sender_display_name: Option<String>,
    pub date: i64,
    pub mime_type: Option<String>,
    pub attachment_path: Option<String>,
    pub link_url: Option<String>,
    pub link_domain: Option<String>,
    pub link_title: Option<String>,
}

/// Perform semantic search across all indexed messages.
#[tauri::command]
pub fn semantic_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<i64>,
) -> AppResult<Vec<SemanticSearchResult>> {
    let clip_text = state.clip_text.as_ref().ok_or_else(|| {
        AppError::Custom("Semantic search unavailable — models not loaded".into())
    })?;

    let analytics_conn = state.lock_analytics_db()?;
    let chat_conn = state.lock_chat_db()?;

    // Load tokenizer — cached path
    let resource_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.join("../Resources")))
        .unwrap_or_default();
    let tokenizer_path = resource_dir.join("models/tokenizer.json");
    let tokenizer = tokenizers::Tokenizer::from_file(&tokenizer_path)
        .map_err(|e| AppError::Custom(format!("Failed to load tokenizer: {e}")))?;

    // Encode query
    let query_embeddings = clip::encode_texts(clip_text, &tokenizer, &[query.as_str()])?;
    if query_embeddings.is_empty() {
        return Ok(Vec::new());
    }
    let query_vec = &query_embeddings[0];

    // Load all embeddings and compute cosine similarity
    let all_embeddings = analytics_db::load_all_embeddings(&analytics_conn)?;
    let mut scored: Vec<(f64, i64, String, i64, Option<i64>, i64)> = Vec::with_capacity(all_embeddings.len());

    for (id, source_type, source_id, chunk_id, chat_id, blob) in &all_embeddings {
        if let Ok(embedding) = clip::blob_to_embedding(blob) {
            let score = clip::cosine_similarity(query_vec, &embedding) as f64;
            scored.push((score, *id, source_type.clone(), *source_id, *chunk_id, *chat_id));
        }
    }

    // Sort by score descending
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let limit = limit.unwrap_or(50) as usize;
    let top_results = &scored[..scored.len().min(limit)];

    // Deduplicate: if a message appears both individually and via its chunk, keep the higher-scoring one
    let mut seen_rowids = std::collections::HashSet::new();
    let mut results = Vec::new();

    let contact_map = state.contact_map.lock().unwrap_or_else(|p| p.into_inner());

    for &(score, _id, ref source_type, source_id, chunk_id, chat_id) in top_results {
        // Resolve the message rowid for navigation
        let message_rowid = match source_type.as_str() {
            "chunk" => {
                // Get first_rowid from the chunk
                analytics_conn.query_row(
                    "SELECT first_rowid FROM message_chunks WHERE id = ?1",
                    rusqlite::params![source_id],
                    |row| row.get(0),
                ).unwrap_or(0i64)
            }
            "attachment" => {
                // Get message_id from attachment
                chat_conn.query_row(
                    "SELECT message_id FROM message_attachment_join WHERE attachment_id = ?1 LIMIT 1",
                    rusqlite::params![source_id],
                    |row| row.get(0),
                ).unwrap_or(0i64)
            }
            _ => source_id, // "message" — source_id IS the message rowid
        };

        if message_rowid == 0 || !seen_rowids.insert(message_rowid) {
            continue;
        }

        // Fetch message details for the result
        let msg_details: Option<(Option<String>, bool, i64, i64, Option<String>)> = chat_conn.query_row(
            "SELECT m.text, m.is_from_me, m.date, m.handle_id,
                    (SELECT h.id FROM handle h WHERE h.ROWID = m.handle_id)
             FROM message m WHERE m.ROWID = ?1",
            rusqlite::params![message_rowid],
            |row| Ok((row.get(0)?, row.get::<_, i64>(1)? != 0, row.get(2)?, row.get(3)?, row.get(4)?)),
        ).ok();

        let (text, is_from_me, date_raw, _handle_id, sender) = msg_details.unwrap_or((None, false, 0, 0, None));
        let date = crate::ingestion::timestamp::apple_timestamp_to_unix_ms(date_raw);
        let sender_display_name = sender.as_ref().and_then(|s| {
            crate::db::contacts_db::resolve_name(s, &contact_map)
        });

        // For chunks, use the concatenated text
        let display_text = if source_type == "chunk" {
            analytics_conn.query_row(
                "SELECT concatenated_text FROM message_chunks WHERE id = ?1",
                rusqlite::params![source_id],
                |row| row.get(0),
            ).ok()
        } else {
            text
        };

        // Attachment info
        let (mime_type, attachment_path) = if source_type == "attachment" {
            let att_info: Option<(Option<String>, Option<String>)> = chat_conn.query_row(
                "SELECT mime_type, filename FROM attachment WHERE ROWID = ?1",
                rusqlite::params![source_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            ).ok();
            att_info.unwrap_or((None, None))
        } else {
            (None, None)
        };

        // Link info — check if this message has a link in the links table
        let link_info: Option<(String, String, Option<String>)> = analytics_conn.query_row(
            "SELECT url, domain, title FROM links WHERE message_rowid = ?1 LIMIT 1",
            rusqlite::params![message_rowid],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).ok();
        let (link_url, link_domain, link_title) = match link_info {
            Some((u, d, t)) => (Some(u), Some(d), t),
            None => (None, None, None),
        };

        results.push(SemanticSearchResult {
            source_type: source_type.clone(),
            source_id,
            message_rowid,
            chat_id,
            score,
            text: display_text,
            is_from_me,
            sender_display_name,
            date,
            mime_type,
            attachment_path,
            link_url,
            link_domain,
            link_title,
        });
    }

    Ok(results)
}

/// Update the index target and optionally trigger re-indexing.
#[tauri::command]
pub fn set_index_target(state: State<'_, AppState>, target: i64) -> AppResult<()> {
    let analytics_conn = state.lock_analytics_db()?;
    analytics_db::set_search_setting(&analytics_conn, "index_target", &target.to_string())?;
    Ok(())
}

/// Clear all embeddings and trigger a rebuild.
#[tauri::command]
pub fn rebuild_search_index(state: State<'_, AppState>) -> AppResult<()> {
    let analytics_conn = state.lock_analytics_db()?;
    analytics_db::clear_embeddings(&analytics_conn)?;
    Ok(())
}
```

- [ ] **Step 2: Register new commands in lib.rs**

In `src-tauri/src/lib.rs`, update the `generate_handler![]` macro to replace the old stubs and add new commands:

```rust
// Embedding commands
commands::embeddings::check_embedding_status,
commands::embeddings::semantic_search,
commands::embeddings::set_index_target,
commands::embeddings::rebuild_search_index,
```

Also add at the end of the `setup` closure, after `app.manage(...)`:

```rust
// Spawn background indexing pipeline
let app_handle = app.handle().clone();
embeddings::pipeline::spawn_indexing_pipeline(app_handle);
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles successfully

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/embeddings.rs src-tauri/src/lib.rs
git commit -m "feat(search): rewrite embedding commands with real semantic search implementation"
```

---

## Chunk 3: Frontend — Types, Commands, Store, and Search UI

### Task 10: Update TypeScript Types

**Files:**
- Modify: `src/types/index.ts:169-181`

- [ ] **Step 1: Replace EmbeddingStatus and SemanticSearchResult interfaces**

Replace lines 169-181 with:

```typescript
/** Embedding / semantic search status */
export interface EmbeddingStatus {
  modelsLoaded: boolean;
  totalEmbedded: number;
  totalMessages: number;
  indexTarget: number;
}

export interface SemanticSearchResult {
  sourceType: string;
  sourceId: number;
  messageRowid: number;
  chatId: number;
  score: number;
  text: string | null;
  isFromMe: boolean;
  senderDisplayName: string | null;
  date: number;
  mimeType: string | null;
  attachmentPath: string | null;
  linkUrl: string | null;
  linkDomain: string | null;
  linkTitle: string | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): update EmbeddingStatus and SemanticSearchResult for MobileCLIP-S2"
```

---

### Task 11: Update TypeScript Command Wrappers

**Files:**
- Modify: `src/lib/commands.ts:86-97`

- [ ] **Step 1: Replace the embedding commands section**

Replace lines 86-97 with:

```typescript
// ────────────────────────────────────────────────────────
// Embedding / AI commands
// ────────────────────────────────────────────────────────

/** Check if the embedding pipeline is ready. */
export const checkEmbeddingStatus = () =>
  invoke<EmbeddingStatus>("check_embedding_status");

/** Run semantic search. */
export const semanticSearch = (query: string, limit?: number) =>
  invoke<SemanticSearchResult[]>("semantic_search", { query, limit });

/** Set the index target (number of messages to embed). */
export const setIndexTarget = (target: number) =>
  invoke<void>("set_index_target", { target });

/** Clear and rebuild the search index. */
export const rebuildSearchIndex = () =>
  invoke<void>("rebuild_search_index");
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/commands.ts
git commit -m "feat(commands): add setIndexTarget and rebuildSearchIndex wrappers"
```

---

### Task 12: Update Zustand Store

**Files:**
- Modify: `src/stores/app-store.ts:3`

- [ ] **Step 1: Add "settings" to AppView type**

Change line 3 from:

```typescript
export type AppView = "chat" | "wrapped" | "search";
```

to:

```typescript
export type AppView = "chat" | "wrapped" | "search" | "settings";
```

- [ ] **Step 2: Commit**

```bash
git add src/stores/app-store.ts
git commit -m "feat(store): add settings to AppView type"
```

---

### Task 13: Search Hook with Debounce

**Files:**
- Create: `src/hooks/use-search.ts`

- [ ] **Step 1: Write the hook**

```typescript
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { semanticSearch, checkEmbeddingStatus } from "@/lib/commands";
import type { SemanticSearchResult, EmbeddingStatus } from "@/types";

/** Debounce a string value by the given delay in ms. */
function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Semantic search with 300ms debounce. */
export const useSemanticSearch = (query: string) => {
  const debouncedQuery = useDebounce(query.trim(), 300);

  return useQuery<SemanticSearchResult[]>({
    queryKey: ["semanticSearch", debouncedQuery],
    queryFn: () => semanticSearch(debouncedQuery, 50),
    enabled: debouncedQuery.length > 0,
    staleTime: 60_000,
  });
};

/** Embedding pipeline status. */
export const useEmbeddingStatus = () => {
  return useQuery<EmbeddingStatus>({
    queryKey: ["embeddingStatus"],
    queryFn: checkEmbeddingStatus,
    staleTime: 10_000,
    refetchInterval: 15_000, // Poll while indexing
  });
};
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/use-search.ts
git commit -m "feat(hooks): add useSemanticSearch with 300ms debounce and useEmbeddingStatus"
```

---

### Task 14: Search Result Components

**Files:**
- Create: `src/components/search/search-result-message.tsx`
- Create: `src/components/search/search-result-link.tsx`
- Create: `src/components/search/search-result-photo.tsx`

- [ ] **Step 1: Write search-result-message.tsx**

```tsx
"use client";

import type { SemanticSearchResult } from "@/types";
import { useAppStore } from "@/stores/app-store";
import { useChatById, getChatDisplayName } from "@/hooks/use-messages";

interface Props {
  result: SemanticSearchResult;
}

export function SearchResultMessage({ result }: Props) {
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const setView = useAppStore((s) => s.setView);
  const setScrollToMessageDate = useAppStore((s) => s.setScrollToMessageDate);
  const chat = useChatById(result.chatId);

  const handleClick = () => {
    setSelectedChatId(result.chatId);
    setScrollToMessageDate(result.date);
    setView("chat");
  };

  const displayName = result.isFromMe
    ? `To: ${getChatDisplayName(chat)}`
    : result.senderDisplayName ?? getChatDisplayName(chat);

  const dateStr = new Date(result.date).toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  });

  return (
    <button
      onClick={handleClick}
      className="w-full text-left mb-3 group cursor-pointer"
    >
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-sm font-semibold text-white">{displayName}</span>
        <span className="text-xs text-zinc-500">{dateStr}</span>
      </div>
      <div className={`flex ${result.isFromMe ? "justify-end" : "justify-start"}`}>
        <div
          className={`rounded-2xl px-3.5 py-2.5 max-w-[85%] transition-opacity group-hover:opacity-80 ${
            result.isFromMe
              ? "bg-[#007AFF] text-white"
              : "bg-[#3A3A3C] text-white"
          }`}
        >
          <span className="text-[15px] leading-snug">
            {result.text ?? "(attachment)"}
          </span>
        </div>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Write search-result-link.tsx**

```tsx
"use client";

import type { SemanticSearchResult } from "@/types";
import { useAppStore } from "@/stores/app-store";

interface Props {
  results: SemanticSearchResult[];
}

export function SearchResultLinks({ results }: Props) {
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const setView = useAppStore((s) => s.setView);
  const setScrollToMessageDate = useAppStore((s) => s.setScrollToMessageDate);

  const handleClick = (result: SemanticSearchResult) => {
    setSelectedChatId(result.chatId);
    setScrollToMessageDate(result.date);
    setView("chat");
  };

  return (
    <div className="grid grid-cols-2 gap-2.5">
      {results.map((result) => (
        <button
          key={`${result.sourceType}-${result.sourceId}`}
          onClick={() => handleClick(result)}
          className="bg-[#2C2C2E] rounded-xl overflow-hidden text-left group cursor-pointer hover:bg-[#3A3A3C] transition-colors"
        >
          <div className="h-20 bg-gradient-to-br from-blue-600/30 to-purple-600/30 flex items-center justify-center relative">
            <span className="text-2xl">🔗</span>
            {result.senderDisplayName && (
              <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-[#007AFF] flex items-center justify-center">
                <span className="text-white text-[11px] font-bold">
                  {result.senderDisplayName.split(" ").map(n => n[0]).join("").slice(0, 2)}
                </span>
              </div>
            )}
          </div>
          <div className="p-2.5">
            <div className="text-[13px] font-semibold text-white truncate">
              {result.linkTitle ?? result.linkUrl ?? "Link"}
            </div>
            <div className="text-[11px] text-zinc-500">
              {result.linkDomain ?? ""}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Write search-result-photo.tsx**

```tsx
"use client";

import { useState } from "react";
import type { SemanticSearchResult } from "@/types";
import { useAppStore } from "@/stores/app-store";
import { useAttachmentData } from "@/hooks/use-messages";

interface Props {
  results: SemanticSearchResult[];
}

function PhotoThumbnail({ result }: { result: SemanticSearchResult }) {
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const setView = useAppStore((s) => s.setView);
  const setScrollToMessageDate = useAppStore((s) => s.setScrollToMessageDate);
  const { data: attachments } = useAttachmentData(result.messageRowid);

  const handleClick = () => {
    setSelectedChatId(result.chatId);
    setScrollToMessageDate(result.date);
    setView("chat");
  };

  const dataUrl = attachments?.find((a) => a.rowid === result.sourceId)?.dataUrl;

  return (
    <button
      onClick={handleClick}
      className="aspect-square rounded-lg overflow-hidden bg-zinc-800 hover:opacity-80 transition-opacity cursor-pointer"
    >
      {dataUrl ? (
        <img src={dataUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <span className="text-2xl">📷</span>
        </div>
      )}
    </button>
  );
}

export function SearchResultPhotos({ results }: Props) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? results : results.slice(0, 6);
  const remaining = results.length - 6;

  return (
    <div className="grid grid-cols-3 gap-1">
      {visible.map((result, i) => (
        <PhotoThumbnail key={`${result.sourceType}-${result.sourceId}`} result={result} />
      ))}
      {!showAll && remaining > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="aspect-square rounded-lg bg-zinc-800 flex items-center justify-center hover:bg-zinc-700 transition-colors cursor-pointer"
        >
          <span className="text-white text-sm font-bold">+{remaining}</span>
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/search/search-result-message.tsx src/components/search/search-result-link.tsx src/components/search/search-result-photo.tsx
git commit -m "feat(search): add message, link, and photo search result components"
```

---

### Task 15: Rewrite Global Search Page

**Files:**
- Modify: `src/components/search/global-search.tsx:1-49`

- [ ] **Step 1: Rewrite the entire file**

```tsx
"use client";

import { useState } from "react";
import { Search, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/stores/app-store";
import { useSemanticSearch, useEmbeddingStatus } from "@/hooks/use-search";
import { SearchResultMessage } from "@/components/search/search-result-message";
import { SearchResultLinks } from "@/components/search/search-result-link";
import { SearchResultPhotos } from "@/components/search/search-result-photo";

function SectionHeader({
  title,
  count,
  expanded,
  onToggle,
}: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="flex justify-between items-center mb-3">
      <span className="text-white font-bold text-[17px]">{title}</span>
      <button
        onClick={onToggle}
        className="text-[#007AFF] text-sm flex items-center gap-1 cursor-pointer"
      >
        {expanded ? "Show Less" : "Show More"}
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
    </div>
  );
}

export function GlobalSearch() {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const { data: results, isLoading } = useSemanticSearch(searchQuery);
  const { data: status } = useEmbeddingStatus();

  const [messagesExpanded, setMessagesExpanded] = useState(false);
  const [linksExpanded, setLinksExpanded] = useState(false);
  const [photosExpanded, setPhotosExpanded] = useState(false);

  // Group results by type
  const messages = results?.filter(
    (r) => r.sourceType === "message" || r.sourceType === "chunk"
  ) ?? [];
  const links = results?.filter(
    (r) => r.linkUrl != null
  ) ?? [];
  const photos = results?.filter(
    (r) => r.sourceType === "attachment" && r.mimeType?.startsWith("image/")
  ) ?? [];

  const visibleMessages = messagesExpanded ? messages : messages.slice(0, 4);
  const visibleLinks = linksExpanded ? links : links.slice(0, 4);

  const hasQuery = searchQuery.trim().length > 0;
  const hasResults = messages.length > 0 || links.length > 0 || photos.length > 0;
  const isIndexing = status && status.totalEmbedded < status.indexTarget;

  return (
    <div className="flex flex-1 flex-col bg-zinc-950 p-6 overflow-y-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-white">Search</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Find messages by meaning across all your conversations
        </p>
      </div>

      {/* Search bar */}
      <div className="mx-auto w-full max-w-xl mb-8">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" />
          <Input
            placeholder="Search messages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-12 pl-11 pr-24 text-base bg-zinc-900 border-zinc-700 text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-blue-500/40"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs bg-[#3A3A3C] px-2 py-0.5 rounded flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> Semantic
          </span>
        </div>
        {isIndexing && (
          <p className="text-xs text-zinc-500 mt-2 text-center">
            Indexing: {status!.totalEmbedded.toLocaleString()} / {status!.indexTarget.toLocaleString()} messages
          </p>
        )}
      </div>

      {/* Results */}
      {hasQuery && isLoading && (
        <p className="text-center text-zinc-500 text-sm">Searching...</p>
      )}

      {hasQuery && !isLoading && !hasResults && (
        <p className="text-center text-zinc-500 text-sm mt-8">
          No results found for &ldquo;{searchQuery}&rdquo;
        </p>
      )}

      {hasResults && (
        <div className="max-w-xl mx-auto w-full space-y-6">
          {/* Messages section */}
          {messages.length > 0 && (
            <div>
              <SectionHeader
                title="Messages"
                count={messages.length}
                expanded={messagesExpanded}
                onToggle={() => setMessagesExpanded(!messagesExpanded)}
              />
              {visibleMessages.map((r) => (
                <SearchResultMessage
                  key={`${r.sourceType}-${r.sourceId}`}
                  result={r}
                />
              ))}
            </div>
          )}

          {/* Divider */}
          {messages.length > 0 && (links.length > 0 || photos.length > 0) && (
            <div className="h-px bg-[#2C2C2E]" />
          )}

          {/* Links section */}
          {links.length > 0 && (
            <div>
              <SectionHeader
                title="Links"
                count={links.length}
                expanded={linksExpanded}
                onToggle={() => setLinksExpanded(!linksExpanded)}
              />
              <SearchResultLinks results={visibleLinks} />
            </div>
          )}

          {/* Divider */}
          {links.length > 0 && photos.length > 0 && (
            <div className="h-px bg-[#2C2C2E]" />
          )}

          {/* Photos section */}
          {photos.length > 0 && (
            <div>
              <SectionHeader
                title="Photos & Stickers"
                count={photos.length}
                expanded={photosExpanded}
                onToggle={() => setPhotosExpanded(!photosExpanded)}
              />
              <SearchResultPhotos results={photosExpanded ? photos : photos} />
            </div>
          )}
        </div>
      )}

      {/* Empty state when no query */}
      {!hasQuery && (
        <div className="mx-auto mt-12 flex max-w-md flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600/20 to-blue-600/20">
            <Sparkles className="h-8 w-8 text-purple-400" />
          </div>
          <h2 className="text-lg font-semibold text-zinc-300">
            Semantic Search
          </h2>
          <p className="mt-2 text-sm text-zinc-500 leading-relaxed">
            Search your messages by meaning, not just keywords. Try &ldquo;vacation photos&rdquo; or &ldquo;dinner plans&rdquo;.
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/search/global-search.tsx
git commit -m "feat(search): rewrite global search with semantic results UI"
```

---

## Chunk 4: Settings Page, Status Bar, and Navigation

### Task 16: Settings Page

**Files:**
- Create: `src/components/settings/settings-page.tsx`

- [ ] **Step 1: Write the settings page**

```tsx
"use client";

import { useState } from "react";
import { Settings, RotateCcw } from "lucide-react";
import { useEmbeddingStatus } from "@/hooks/use-search";
import { setIndexTarget, rebuildSearchIndex } from "@/lib/commands";
import { useQueryClient } from "@tanstack/react-query";

export function SettingsPage() {
  const { data: status } = useEmbeddingStatus();
  const queryClient = useQueryClient();
  const [sliderValue, setSliderValue] = useState<number | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  const currentTarget = status?.indexTarget ?? 1000;
  const totalMessages = status?.totalMessages ?? 0;
  const totalEmbedded = status?.totalEmbedded ?? 0;
  const displayTarget = sliderValue ?? currentTarget;

  const handleSliderChange = async (value: number) => {
    setSliderValue(value);
    await setIndexTarget(value);
    queryClient.invalidateQueries({ queryKey: ["embeddingStatus"] });
  };

  const handleRebuild = async () => {
    setRebuilding(true);
    await rebuildSearchIndex();
    queryClient.invalidateQueries({ queryKey: ["embeddingStatus"] });
    setRebuilding(false);
  };

  const isIndexing = totalEmbedded < displayTarget;
  const progress = displayTarget > 0 ? Math.min(100, (totalEmbedded / displayTarget) * 100) : 0;

  return (
    <div className="flex flex-1 flex-col bg-zinc-950 p-6 overflow-y-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-white">Settings</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Configure search indexing and other preferences
        </p>
      </div>

      <div className="max-w-lg mx-auto w-full space-y-8">
        {/* Search Index Section */}
        <div className="bg-[#2C2C2E] rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <Settings className="h-5 w-5 text-zinc-400" />
            <h2 className="text-lg font-semibold text-white">Search Index</h2>
          </div>

          {/* Status */}
          <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-zinc-400">
                {status?.modelsLoaded ? (isIndexing ? "Indexing..." : "Ready") : "Models not loaded"}
              </span>
              <span className="text-sm text-zinc-500">
                {totalEmbedded.toLocaleString()} / {displayTarget.toLocaleString()} messages
              </span>
            </div>
            <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#007AFF] rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Slider */}
          <div className="mb-6">
            <label className="text-sm text-zinc-400 mb-2 block">
              Index Coverage
            </label>
            <input
              type="range"
              min={500}
              max={totalMessages || 10000}
              step={500}
              value={displayTarget}
              onChange={(e) => handleSliderChange(Number(e.target.value))}
              className="w-full accent-[#007AFF]"
            />
            <div className="flex justify-between mt-1">
              <span className="text-xs text-zinc-600">500</span>
              <span className="text-xs text-zinc-600">{totalMessages.toLocaleString()}</span>
            </div>
          </div>

          {/* Rebuild button */}
          <button
            onClick={handleRebuild}
            disabled={rebuilding}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition-colors text-sm disabled:opacity-50 cursor-pointer"
          >
            <RotateCcw className={`h-4 w-4 ${rebuilding ? "animate-spin" : ""}`} />
            {rebuilding ? "Rebuilding..." : "Rebuild Index"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/settings/settings-page.tsx
git commit -m "feat(settings): add settings page with search index coverage slider"
```

---

### Task 17: Indexing Status Bar

**Files:**
- Create: `src/components/layout/indexing-status-bar.tsx`

- [ ] **Step 1: Write the status bar component**

```tsx
"use client";

import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Loader2 } from "lucide-react";

interface EmbeddingProgress {
  phase: string;
  processed: number;
  total: number;
}

export function IndexingStatusBar() {
  const [progress, setProgress] = useState<EmbeddingProgress | null>(null);

  useEffect(() => {
    const unlisten = listen<EmbeddingProgress>("embedding-progress", (event) => {
      setProgress(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  if (!progress || progress.phase === "done") return null;

  const pct = progress.total > 0
    ? Math.round((progress.processed / progress.total) * 100)
    : 0;

  const phaseLabel = progress.phase === "chunking" ? "Analyzing" : "Indexing";

  return (
    <div className="flex items-center gap-2 px-3 py-1 text-xs text-zinc-400">
      <Loader2 className="h-3 w-3 animate-spin text-[#007AFF]" />
      <span>
        {phaseLabel}: {progress.processed.toLocaleString()} / {progress.total.toLocaleString()} ({pct}%)
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/indexing-status-bar.tsx
git commit -m "feat(layout): add indexing status bar with Tauri event listener"
```

---

### Task 18: Update Navigation

**Files:**
- Modify: `src/app/page.tsx:1-91`

- [ ] **Step 1: Add settings nav item, gear icon, status bar, and settings view**

Update the imports:

```tsx
import { MessageSquare, BarChart3, Search, Sun, Moon, Settings } from "lucide-react";
```

Add to imports:

```tsx
import { SettingsPage } from "@/components/settings/settings-page";
import { IndexingStatusBar } from "@/components/layout/indexing-status-bar";
```

Add `settings` to `NAV_ITEMS`:

```typescript
const NAV_ITEMS: { id: AppView; label: string; icon: React.ElementType }[] = [
  { id: "chat", label: "Chats", icon: MessageSquare },
  { id: "wrapped", label: "Wrapped", icon: BarChart3 },
  { id: "search", label: "Search", icon: Search },
  { id: "settings", label: "Settings", icon: Settings },
];
```

Add `settings` case to `MainContent`:

```typescript
case "settings":
  return <SettingsPage />;
```

Add the `IndexingStatusBar` in the nav bar, right before the "Message Intelligence" text (inside the `ml-auto` div):

```tsx
<div className="ml-auto flex items-center gap-3">
  <IndexingStatusBar />
  <span className="text-xs font-medium text-[#A4B5C4] dark:text-zinc-600 apple-text-xs">
    Message Intelligence
  </span>
  {/* theme toggle button unchanged */}
</div>
```

- [ ] **Step 2: Verify frontend compiles**

Run: `npm run dev` (check for TypeScript errors in console)
Expected: Compiles, app loads. Search and settings pages render. Semantic search returns empty results since ONNX models aren't bundled yet.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(nav): add settings tab, indexing status bar, and settings view routing"
```

---

### Task 19: Export ONNX Models

**Files:**
- Create: `scripts/export_mobileclip.py`

- [ ] **Step 1: Write the export script**

This script converts MobileCLIP-S2 from PyTorch to ONNX format:

```python
"""
Export MobileCLIP-S2 to ONNX format for the Tauri app.

Usage:
    pip install open_clip_torch torch onnx
    python scripts/export_mobileclip.py

Outputs:
    src-tauri/resources/models/mobileclip_s2_text.onnx
    src-tauri/resources/models/mobileclip_s2_vision.onnx
    src-tauri/resources/models/tokenizer.json
"""

import torch
import open_clip
import os

MODEL_NAME = "MobileCLIP-S2"
PRETRAINED = "datacompdr"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "resources", "models")

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print(f"Loading {MODEL_NAME}...")
    model, _, preprocess = open_clip.create_model_and_transforms(
        MODEL_NAME, pretrained=PRETRAINED
    )
    tokenizer = open_clip.get_tokenizer(MODEL_NAME)
    model.eval()

    # Export text encoder
    print("Exporting text encoder...")
    dummy_text = tokenizer(["a photo of a cat"])
    # dummy_text is a tensor of shape [1, 77]

    class TextEncoder(torch.nn.Module):
        def __init__(self, model):
            super().__init__()
            self.model = model

        def forward(self, input_ids, attention_mask):
            return self.model.encode_text(input_ids)

    text_encoder = TextEncoder(model)
    dummy_mask = torch.ones_like(dummy_text)

    torch.onnx.export(
        text_encoder,
        (dummy_text, dummy_mask),
        os.path.join(OUTPUT_DIR, "mobileclip_s2_text.onnx"),
        input_names=["input_ids", "attention_mask"],
        output_names=["embeddings"],
        dynamic_axes={
            "input_ids": {0: "batch_size"},
            "attention_mask": {0: "batch_size"},
            "embeddings": {0: "batch_size"},
        },
        opset_version=17,
    )
    print("  -> mobileclip_s2_text.onnx")

    # Export vision encoder
    print("Exporting vision encoder...")
    dummy_image = torch.randn(1, 3, 256, 256)

    class VisionEncoder(torch.nn.Module):
        def __init__(self, model):
            super().__init__()
            self.model = model

        def forward(self, pixel_values):
            return self.model.encode_image(pixel_values)

    vision_encoder = VisionEncoder(model)
    torch.onnx.export(
        vision_encoder,
        (dummy_image,),
        os.path.join(OUTPUT_DIR, "mobileclip_s2_vision.onnx"),
        input_names=["pixel_values"],
        output_names=["embeddings"],
        dynamic_axes={
            "pixel_values": {0: "batch_size"},
            "embeddings": {0: "batch_size"},
        },
        opset_version=17,
    )
    print("  -> mobileclip_s2_vision.onnx")

    # Export tokenizer
    print("Exporting tokenizer...")
    # open_clip uses a SimpleTokenizer; we need to save it in HuggingFace format
    # For MobileCLIP, the tokenizer is CLIP-compatible
    from transformers import CLIPTokenizerFast
    hf_tokenizer = CLIPTokenizerFast.from_pretrained("openai/clip-vit-base-patch32")
    hf_tokenizer.model_max_length = 77
    hf_tokenizer.save_pretrained(OUTPUT_DIR)
    print("  -> tokenizer.json")

    print("Done! Models saved to", OUTPUT_DIR)

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the export script**

```bash
pip install open_clip_torch torch onnx transformers
python scripts/export_mobileclip.py
```

Expected: Three files created in `src-tauri/resources/models/`:
- `mobileclip_s2_text.onnx` (~30MB)
- `mobileclip_s2_vision.onnx` (~30MB)
- `tokenizer.json` (~500KB)

- [ ] **Step 3: Add models to .gitignore (too large for git)**

Add to `.gitignore`:

```
src-tauri/resources/models/*.onnx
```

- [ ] **Step 4: Commit**

```bash
git add scripts/export_mobileclip.py src-tauri/resources/models/tokenizer.json .gitignore
git commit -m "feat(models): add MobileCLIP-S2 ONNX export script and tokenizer"
```

---

### Task 20: Integration Test — End to End

- [ ] **Step 1: Verify full Rust backend compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors

- [ ] **Step 2: Verify frontend compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Test the full app**

Run: `npx tauri dev`
Expected:
- App launches, nav bar shows Chats, Wrapped, Search, Settings
- Search page shows semantic search UI with Sparkles badge
- Settings page shows search index slider
- If ONNX models are present, indexing starts in background and status bar shows progress
- If models are missing, search gracefully shows empty results

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: MobileCLIP-S2 semantic search — complete implementation"
```
