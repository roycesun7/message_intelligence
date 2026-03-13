# Semantic Search with MobileCLIP-S2

**Date:** 2026-03-13
**Status:** Approved

## Overview

Add multimodal semantic search to the iMessage analytics app using Apple's MobileCLIP-S2 model. Users can search by meaning — "vacation photos" finds messages about trips, beach images, and travel links — across text messages, images, stickers, and extracted document text. The model runs locally via ONNX Runtime with CoreML acceleration on Apple Silicon.

## Architecture

```
App startup
  → Background indexing task spawns (tokio::spawn)
  → Reads messages + attachments incrementally from chat.db
  → Groups consecutive same-sender messages into chunks (intent units)
  → Runs chunk/message text through MobileCLIP-S2 text encoder (ONNX)
  → Runs images/stickers through MobileCLIP-S2 image encoder (ONNX)
  → Extracts text from PDFs/docs, embeds via text encoder
  → Stores 512-dim f32 vectors as BLOBs in analytics.db
  → Updates processing_state for incremental resume

User searches
  → Query text → MobileCLIP-S2 text encoder → 512-dim vector
  → Brute-force cosine similarity against all stored embeddings
  → Results grouped into Messages / Links / Photos & Stickers
  → Click result → navigate to chat, scroll to message, highlight
```

### New Rust Dependencies

- `ort` — ONNX Runtime bindings (CoreML execution provider for Apple Silicon)
- `image` — Image decoding/resizing for the vision encoder
- `ndarray` — Vector math for cosine similarity
- `tokenizers` (HuggingFace) — MobileCLIP text tokenization

### Model Files (~60MB total, bundled in app resources)

```
src-tauri/resources/models/
  mobileclip_s2_text.onnx      (~30MB)
  mobileclip_s2_vision.onnx    (~30MB)
  tokenizer.json               (~500KB)
```

Bundled via `tauri.conf.json` `resources` field.

## Data Model

### New Tables in analytics.db

```sql
-- Chunks of consecutive messages from one sender
CREATE TABLE IF NOT EXISTS message_chunks (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id           INTEGER NOT NULL,
    is_from_me        INTEGER NOT NULL,
    handle_id         INTEGER,           -- NULL when is_from_me = 1
    first_rowid       INTEGER NOT NULL,  -- first message in chunk
    last_rowid        INTEGER NOT NULL,  -- last message in chunk
    message_count     INTEGER NOT NULL,
    concatenated_text TEXT NOT NULL,
    started_at        INTEGER NOT NULL,  -- unix ms
    ended_at          INTEGER NOT NULL   -- unix ms
);
CREATE INDEX IF NOT EXISTS idx_chunks_chat ON message_chunks(chat_id);
CREATE INDEX IF NOT EXISTS idx_chunks_first_rowid ON message_chunks(first_rowid);

-- Embeddings for messages, chunks, and attachments
-- Replaces the existing embedding_state table (drop it in the migration)
CREATE TABLE IF NOT EXISTS embeddings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL,      -- 'message' | 'chunk' | 'attachment'
    source_id   INTEGER NOT NULL,   -- message_rowid, chunk_id, or attachment_rowid
    chunk_id    INTEGER,            -- links individual messages to their chunk
    chat_id     INTEGER NOT NULL,
    model       TEXT NOT NULL,      -- 'mobileclip-s2'
    vector      BLOB NOT NULL,      -- 512 x f32 = 2048 bytes
    embedded_at TEXT NOT NULL,
    UNIQUE(source_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_embeddings_chat ON embeddings(chat_id);
```

### Migration Note

The existing `embedding_state` table (which tracked per-message Ollama embedding state) is replaced by the new `embeddings` table. The migration should `DROP TABLE IF EXISTS embedding_state` before creating the new tables. The existing stub commands `check_embedding_status` and `semantic_search` in `commands/embeddings.rs` (which reference Ollama) are rewritten to use the new MobileCLIP-S2 pipeline.

### Vector Storage

Each 512-dim f32 vector is stored as a 2048-byte BLOB. For 200k embeddings (messages + chunks + attachments), ~400MB in the DB. At query time, all vectors are loaded into memory (~400MB resident), cosine similarity computed in Rust, top-K returned. The vector cache is initialized on first search query and held for the app's lifetime.

### Existing Table Reuse

- `processing_state` — tracks incremental position for chunking and embedding pipelines. Uses two pipeline entries for bidirectional indexing: `'embedding_recent'` (newest → middle) and `'embedding_oldest'` (oldest → middle), each with its own `last_rowid` cursor.
- `attachment_metadata` — stores extracted text from PDFs/documents
- `links` — cross-referenced with matched messages to populate the Links search section

## Chunking Rules

Messages are grouped into chunks representing a single sender's train of thought. A new chunk starts when:

1. **Sender changes** — different `is_from_me` value or different `handle_id`
2. **Time gap > 5 minutes** — between consecutive messages from the same sender
3. **Chat changes** — different `chat_id`

Example:
```
Me  (6:01pm): "hey want to grab dinner?"     ─┐
Me  (6:01pm): "thinking sushi"                 ├─ Chunk A (my intent)
Me  (6:02pm): "that new place on main street" ─┘
You (6:02pm): "oh yeah I've been wanting"     ─┐
You (6:02pm): "to try that place"              ├─ Chunk B (their intent)
You (6:03pm): "8pm?"                          ─┘
Me  (6:05pm): "perfect"                       ─── Chunk C (my intent)
```

Each chunk gets one embedding (concatenated text). Each individual message also gets its own embedding and a `chunk_id` foreign key for navigation within the chunk.

## Embedding Pipeline

Runs as a background `tokio::spawn` task on app startup. Chunking runs over the full message range first (it's fast — pure SQL grouping), then embedding proceeds bidirectionally from the ends.

### Phase 1: Chunking (sequential, fast)

- Query chat.db for ALL messages (chunking is cheap — just grouping, no ML inference)
- Walk messages in order, grouping into chunks per the rules above
- Write `message_chunks` rows to analytics.db
- Track position via `processing_state` pipeline name `'chunking'` with a single forward cursor
- On subsequent launches, only processes messages with `rowid > last_processed_rowid`

### Phase 2: Text Embedding (bidirectional, priority-based)

- Operates on chunks and individual messages that already exist in `message_chunks` (from Phase 1) but are missing from the `embeddings` table
- Batch tokenize text (MobileCLIP tokenizer, 77 token max context window). Text exceeding 77 tokens is truncated — this matches CLIP's standard behavior. Chunks with concatenated text longer than 77 tokens are truncated, not split; the first 77 tokens capture the opening intent which is typically the most meaningful.
- Run batches through `mobileclip_s2_text.onnx` (batch size ~64)
- For chunks: embed the concatenated text
- For individual messages: embed each message's text
- Write embedding BLOBs to `embeddings` table
- Emit progress events via Tauri event system

### Phase 3: Attachment Embedding (follows Phase 2's cursor range)

- Processes attachments for messages within the range already covered by Phase 2's cursors
- Images (JPEG, PNG, HEIC, GIF, WebP): decode → resize to 256x256 → normalize → run through `mobileclip_s2_vision.onnx`
- Stickers: same image pipeline
- PDFs/documents: extract text content, store in `attachment_metadata.extracted_text`, then embed via text encoder
- Skip video/audio files
- Write to `embeddings` with `source_type = 'attachment'`

### Priority-Based Indexing (Phases 2 & 3)

Instead of sequential indexing, embedding uses a bidirectional priority strategy:

1. **First batch:** Most recent 500 message rowids (with chunk-boundary snapping — if the 500th message is mid-chunk, include the entire chunk). Search is immediately useful.
2. **Second batch:** Oldest 500 message rowids (same snapping). Covers early conversation history.
3. **User-controlled expansion:** A slider in Settings controls how deep to index. User drags to expand coverage; pipeline indexes from both ends toward the middle.

Progress is tracked via two `processing_state` entries:
- `'embedding_recent'` — cursor starts at the newest message rowid and decrements toward the middle
- `'embedding_oldest'` — cursor starts at the oldest message rowid and increments toward the middle

When the two cursors meet, indexing is complete. The slider target (stored in analytics.db as a setting) determines when the pipeline pauses — it stops when the number of indexed messages reaches the user's chosen target. Phase 3 (attachments) runs inline after each Phase 2 batch completes for that range, so images are indexed alongside their messages.

### Incremental Behavior

On subsequent launches, Phase 1 picks up from `processing_state`. Phases 2 and 3 only process items missing from `embeddings`. A full re-index can be triggered from Settings by clearing the tables.

### Threading

The ONNX session is initialized once and shared via `Arc`. The pipeline holds its own SQLite connections (separate from the Mutex-guarded ones in AppState) to avoid blocking the UI during long indexing runs.

### Progress Reporting

```rust
app_handle.emit("embedding-progress", EmbeddingProgress {
    phase: "text",         // "chunking" | "text" | "attachments"
    processed: 45_231,
    total: 128_000,
});
```

## Search Query & Result Flow

1. **Debounce** — 300ms on keystroke
2. **Encode query** — Run search text through `mobileclip_s2_text.onnx` → 512-dim vector
3. **Vector search** — Cosine similarity against all cached embeddings, return top 50
4. **Group results** — Backend tags by `source_type`, frontend groups into sections:
   - **Messages** — `message` or `chunk` results. For chunks, `message_rowid` points to the first message in the chunk; the frontend displays the chunk's concatenated text with the sender/date of the first message.
   - **Links** — Cross-reference matched messages with the `links` table.
   - **Photos & Stickers** — `attachment` results with image MIME types. Thumbnails lazy-loaded.
5. **Navigate on click** — Set `selectedChatId` + `scrollToMessageDate` in Zustand, switch to chat view, scroll and highlight.

### Search Result Struct

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSearchResult {
    pub source_type: String,              // "message" | "chunk" | "attachment"
    pub source_id: i64,
    pub message_rowid: i64,               // for navigation
    pub chat_id: i64,
    pub score: f64,
    pub text: Option<String>,
    pub is_from_me: bool,
    pub sender_display_name: Option<String>,
    pub date: i64,                        // unix ms
    pub mime_type: Option<String>,        // for attachments
    pub attachment_path: Option<String>,  // for lazy-loading thumbnails
    pub link_url: Option<String>,
    pub link_domain: Option<String>,
    pub link_title: Option<String>,
}
```

## Model Initialization

### Runtime Setup

On app startup, load ONNX sessions with CoreML execution provider (CPU fallback). Two new fields are added to the existing `AppState` struct in `state.rs`:

```rust
// New fields added to AppState (existing fields unchanged)
pub clip_text: Option<Arc<ort::Session>>,     // MobileCLIP-S2 text encoder
pub clip_vision: Option<Arc<ort::Session>>,   // MobileCLIP-S2 image encoder
```

Sessions are `Option` — `None` when model files are missing (dev build without bundled models). Search commands check for `None` and return empty results with a status message. When present, sessions are thread-safe `Arc` and shared between the indexing task and query handler. CoreML is attempted first via `ort::ExecutionProviderDispatch::CoreML()`; if unavailable (e.g., Intel Mac), falls back to the default CPU provider.

### Image Preprocessing

1. Decode image (JPEG/PNG via `image` crate; HEIC via existing `sips` conversion)
2. Resize to 256x256 with bicubic interpolation
3. Normalize pixels to `[0, 1]`, then CLIP normalization: mean `[0.485, 0.456, 0.406]`, std `[0.229, 0.224, 0.225]`
4. Convert to f32 tensor shape `[1, 3, 256, 256]`

## Frontend Components

### New Components

| Component | Purpose |
|-----------|---------|
| `global-search.tsx` (rewrite) | Search input + three collapsible result sections |
| `search-result-message.tsx` | Message bubble (blue right for sent, gray left for received) with sender + date |
| `search-result-link.tsx` | 2-column link card grid with sender avatar badges |
| `search-result-photo.tsx` | 3-column image grid with lazy-loaded thumbnails and "+N more" |
| `settings-page.tsx` | New top-level view with "Search Index" section |
| `indexing-status-bar.tsx` | Persistent sidebar/header indicator during indexing |

### Settings Page — Search Index Section

- Coverage slider: draggable, shows "X / Y messages indexed"
- Current status: "Indexing..." or "Ready"
- "Rebuild Index" button for force re-index

### Navigation

- Update `AppView` type in `app-store.ts` from `"chat" | "wrapped" | "search"` to `"chat" | "wrapped" | "search" | "settings"` and add `setView("settings")` action
- Gear icon in sidebar opens settings
- Click search result → sets `selectedChatId` + `scrollToMessageDate` in Zustand → switches to chat view → scrolls to message with highlight effect

### UI Design

Follows existing Apple-native dark theme. Search results use iMessage bubble styling:
- Sent messages: `#007AFF` blue, right-aligned
- Received messages: `#3A3A3C` gray, left-aligned
- Link cards: `#2C2C2E` background with sender avatar badges
- Photo grid: 3-column with rounded corners
- Each section has "Show More" toggle (default 3-5 results visible)
