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

-- Embeddings for messages, chunks, and attachments
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
```

### Vector Storage

Each 512-dim f32 vector is stored as a 2048-byte BLOB. For 200k embeddings (messages + chunks + attachments), ~400MB in the DB. At query time, all vectors are loaded into memory (cached), cosine similarity computed in Rust, top-K returned.

### Existing Table Reuse

- `processing_state` — tracks incremental position for chunking and embedding pipelines
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

Runs as a background `tokio::spawn` task on app startup. Three phases:

### Phase 1: Chunking

- Query chat.db for messages with `rowid > last_processed_rowid` (pipeline name `'chunking'`)
- Walk messages in order, grouping into chunks per the rules above
- Write `message_chunks` rows to analytics.db
- Update `processing_state`

### Phase 2: Text Embedding

- Query for chunks and individual messages missing from `embeddings` table
- Batch tokenize text (MobileCLIP tokenizer, 77 token max context)
- Run batches through `mobileclip_s2_text.onnx` (batch size ~64)
- For chunks: embed the concatenated text
- For individual messages: embed each message's text
- Write embedding BLOBs to `embeddings` table
- Emit progress events via Tauri event system

### Phase 3: Attachment Embedding

- Query chat.db for attachments on processed messages
- Images (JPEG, PNG, HEIC, GIF, WebP): decode → resize to 256x256 → normalize → run through `mobileclip_s2_vision.onnx`
- Stickers: same image pipeline
- PDFs/documents: extract text content → run through text encoder
- Skip video/audio files
- Write to `embeddings` with `source_type = 'attachment'`

### Priority-Based Indexing

Instead of sequential indexing, the pipeline uses a priority strategy:

1. **First batch:** Most recent 500 messages — search is immediately useful
2. **Second batch:** Oldest 500 messages — covers early conversation history
3. **User-controlled expansion:** A slider in Settings controls how deep to index. User drags to expand coverage; pipeline indexes from both ends toward the middle.

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
   - **Messages** — `message` or `chunk` results. For chunks, display the most relevant individual message.
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

On app startup, load ONNX sessions with CoreML execution provider (CPU fallback):

```rust
pub struct AppState {
    pub chat_db: Arc<Mutex<Connection>>,
    pub analytics_db: Arc<Mutex<Connection>>,
    pub contact_map: HashMap<String, String>,
    pub clip_text: Arc<ort::Session>,     // MobileCLIP-S2 text encoder
    pub clip_vision: Arc<ort::Session>,   // MobileCLIP-S2 image encoder
}
```

Sessions are thread-safe and shared between the indexing task and query handler. If model files are missing (dev build), search gracefully degrades with empty results and a status message.

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

- New view type: `"chat" | "wrapped" | "search" | "settings"`
- Gear icon in sidebar opens settings
- Click search result → sets `selectedChatId` + `scrollToMessageDate` in Zustand → switches to chat view → scrolls to message with highlight effect

### UI Design

Follows existing Apple-native dark theme. Search results use iMessage bubble styling:
- Sent messages: `#007AFF` blue, right-aligned
- Received messages: `#3A3A3C` gray, left-aligned
- Link cards: `#2C2C2E` background with sender avatar badges
- Photo grid: 3-column with rounded corners
- Each section has "Show More" toggle (default 3-5 results visible)
