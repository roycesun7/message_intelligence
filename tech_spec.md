# Message Intelligence - Technical Specification

## Architecture Overview

Message Intelligence is a native macOS desktop application built with **Tauri v2**, combining a **Rust backend** for performance-critical data processing with a **React/Next.js frontend** for the user interface. The app reads Apple's iMessage database (chat.db) in read-only mode and maintains its own analytics database for computed insights.

```
+--------------------------------------------------+
|                  Tauri Window                      |
|  +----------------------------------------------+ |
|  |          React / Next.js Frontend             | |
|  |  (Static Export served from ../out)            | |
|  |                                                | |
|  |  Components:  Chat | Wrapped | Search          | |
|  |  State:       Zustand + React Query            | |
|  |  Charts:      Recharts                         | |
|  +-------------------+---------------------------+ |
|                      | Tauri invoke() / IPC        |
|  +-------------------v---------------------------+ |
|  |              Rust Backend                      | |
|  |                                                | |
|  |  Commands:   messages | analytics | embeddings | |
|  |  Database:   rusqlite (chat.db + analytics.db) | |
|  |  Ingestion:  timestamp + message_parser        | |
|  |  AI:         Ollama sidecar (planned)          | |
|  +----------------------------------------------+ |
+--------------------------------------------------+
         |                          |
    [chat.db]                [analytics.db]
    (read-only)              (read/write)
    Apple Messages           App-managed
```

## Tech Stack

### Frontend

| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 19.2 | UI framework |
| Next.js | 16.1 | App framework (static export mode) |
| TypeScript | 5.x | Type safety |
| Tailwind CSS | 4.x | Styling |
| shadcn/ui | latest | Component library (Radix-based) |
| Zustand | latest | Global state management |
| TanStack React Query | latest | Async data fetching & caching |
| Recharts | latest | Data visualization |
| Fuse.js | latest | Client-side fuzzy search |
| Day.js | latest | Date formatting |
| @tauri-apps/api | 2.x | Frontend-to-backend IPC |

### Backend

| Technology | Version | Purpose |
|-----------|---------|---------|
| Rust | stable | Backend language |
| Tauri | 2.10 | Desktop app framework |
| rusqlite | latest | SQLite bindings (bundled) |
| tokio | latest | Async runtime |
| serde / serde_json | latest | Serialization |
| chrono | latest | Date/time handling |
| regex | latest | Pattern matching |

### Planned

| Technology | Purpose |
|-----------|---------|
| Ollama | Local LLM inference (embeddings, sentiment, simulation) |
| fastembed-rs or similar | Rust-native embedding generation |

## Directory Structure

```
message_intelligence/
├── src/                              # Frontend source
│   ├── app/
│   │   ├── page.tsx                  # Main page - nav + view routing
│   │   ├── layout.tsx                # Root layout with QueryProvider
│   │   └── globals.css               # Global styles
│   ├── components/
│   │   ├── chat/
│   │   │   ├── chat-list.tsx         # Sidebar conversation list + search
│   │   │   ├── chat-view.tsx         # Message display for selected chat
│   │   │   └── message-bubble.tsx    # Individual message + tapback rendering
│   │   ├── wrapped/
│   │   │   └── wrapped-view.tsx      # Wrapped analytics dashboard
│   │   ├── search/
│   │   │   └── global-search.tsx     # Semantic search UI (placeholder)
│   │   ├── ui/                       # shadcn/ui primitives
│   │   └── providers/
│   │       └── query-provider.tsx    # React Query provider
│   ├── hooks/
│   │   ├── use-messages.ts           # Chat & message data hooks
│   │   └── use-analytics.ts          # Wrapped stats hook
│   ├── lib/
│   │   ├── commands.ts               # Tauri invoke wrappers
│   │   └── utils.ts                  # Utilities (cn helper)
│   ├── stores/
│   │   └── app-store.ts              # Zustand store (view, selectedChat, searchQuery)
│   └── types/
│       └── index.ts                  # TypeScript domain types
│
├── src-tauri/                        # Backend source
│   ├── src/
│   │   ├── main.rs                   # Entry point (prevents console window)
│   │   ├── lib.rs                    # App builder, DB init, command registration
│   │   ├── state.rs                  # AppState (DB connections + contact map)
│   │   ├── error.rs                  # AppError enum with Tauri serialization
│   │   ├── db/
│   │   │   ├── mod.rs                # Module exports
│   │   │   ├── models.rs             # Domain structs (Chat, Message, Handle, etc.)
│   │   │   ├── chat_db.rs            # Read-only queries against Apple's chat.db
│   │   │   ├── contacts_db.rs        # macOS Address Book contact resolution
│   │   │   ├── analytics_db.rs       # Analytics database CRUD operations
│   │   │   └── schema.rs             # Analytics DB migration/table definitions
│   │   ├── commands/
│   │   │   ├── mod.rs                # Module exports
│   │   │   ├── messages.rs           # get_chats, get_messages, get_message_count
│   │   │   ├── contacts.rs           # get_contact_name, get_contact_map
│   │   │   ├── analytics.rs          # get_wrapped_stats (with caching)
│   │   │   └── embeddings.rs         # check_embedding_status, semantic_search (stubs)
│   │   ├── ingestion/
│   │   │   ├── mod.rs
│   │   │   ├── timestamp.rs          # Apple Core Data timestamp -> Unix conversion
│   │   │   └── message_parser.rs     # NSKeyedArchiver attributedBody extraction
│   │   ├── analysis/                 # Placeholder for sentiment/topic modules
│   │   ├── embeddings/               # Placeholder for vector search modules
│   │   └── sidecar/                  # Placeholder for Ollama integration
│   ├── Cargo.toml                    # Rust dependencies
│   └── tauri.conf.json               # Tauri app configuration
│
├── .reference/                       # Legacy/reference code from earlier iteration
├── package.json                      # Node dependencies
├── next.config.ts                    # Next.js config (static export)
├── tsconfig.json                     # TypeScript config
├── components.json                   # shadcn/ui config
├── project_context.md                # Product requirements document
└── tech_spec.md                      # This file
```

## Database Architecture

### Apple's chat.db (Read-Only)

Located at `~/Library/Messages/chat.db`. Requires **Full Disk Access** permission. Opened with `PRAGMA journal_mode=WAL` for safe concurrent reading.

**Key tables used:**

| Table | Purpose |
|-------|---------|
| `chat` | Conversation metadata (guid, style, display_name, last_addressed_handle) |
| `message` | Individual messages (text, date, is_from_me, handle_id, associated_message_type for tapbacks) |
| `handle` | Contact identifiers (phone numbers, emails, service type) |
| `chat_message_join` | Many-to-many: chat <-> message |
| `chat_handle_join` | Many-to-many: chat <-> handle (participants) |
| `attachment` | File attachments metadata |
| `message_attachment_join` | Many-to-many: message <-> attachment |

**Key fields and conventions:**

- `message.date` uses Apple Core Data epoch (seconds since 2001-01-01, stored as nanoseconds / 1e9)
- `message.associated_message_type` != 0 indicates a tapback reaction (1000-5005 range)
- `message.attributedBody` is a binary NSKeyedArchiver blob; parsed when `text` is NULL
- `chat.style`: 43 = group chat, 45 = DM

### analytics.db (Read/Write, App-Managed)

Created at app data directory on first launch. Stores all computed analytics to avoid re-processing.

**Tables:**

```sql
-- Tracks incremental processing progress
processing_state (
    id INTEGER PRIMARY KEY,
    last_processed_rowid INTEGER,    -- Last message rowid processed
    last_run_at TEXT,                 -- ISO timestamp
    total_processed INTEGER,
    status TEXT                       -- 'idle' | 'processing' | 'complete'
)

-- Per-message sentiment scores
message_sentiment (
    message_rowid INTEGER PRIMARY KEY,
    sentiment_score REAL,            -- -1.0 to 1.0
    sentiment_label TEXT,            -- 'positive' | 'negative' | 'neutral'
    confidence REAL,
    analyzed_at TEXT
)

-- Embedding generation progress
embedding_state (
    message_rowid INTEGER PRIMARY KEY,
    embedded_at TEXT,
    model_version TEXT
)

-- Time-windowed conversation groupings
conversation_windows (
    id INTEGER PRIMARY KEY,
    chat_id INTEGER,
    start_date TEXT,
    end_date TEXT,
    message_count INTEGER,
    summary TEXT
)

-- Extracted conversation topics
topics (
    id INTEGER PRIMARY KEY,
    chat_id INTEGER,
    topic TEXT,
    first_seen TEXT,
    last_seen TEXT,
    message_count INTEGER,
    confidence REAL
)

-- Relationship health and pattern metrics
relationship_metrics (
    id INTEGER PRIMARY KEY,
    handle_id INTEGER,
    avg_response_time_seconds REAL,
    initiation_ratio REAL,           -- 0.0 to 1.0 (how often user initiates)
    sentiment_trend REAL,
    last_updated TEXT
)

-- Cataloged shared links
links (
    id INTEGER PRIMARY KEY,
    message_rowid INTEGER,
    url TEXT,
    title TEXT,
    domain TEXT,
    extracted_at TEXT
)

-- Attachment metadata cache
attachment_cache (
    attachment_rowid INTEGER PRIMARY KEY,
    mime_type TEXT,
    file_size INTEGER,
    is_image INTEGER,
    is_video INTEGER,
    thumbnail_path TEXT
)

-- Pre-computed Wrapped stats (JSON blob per year)
wrapped_cache (
    year INTEGER PRIMARY KEY,
    stats_json TEXT,                  -- Serialized WrappedStats
    computed_at TEXT
)
```

## Data Flow

### Startup Sequence

```
1. main.rs           -> Launches Tauri app
2. lib.rs            -> run() called
3.   Open chat.db    -> Read-only, WAL mode, ~/Library/Messages/chat.db
4.   Open analytics.db -> Create if needed, run schema migrations
5.   Load contacts   -> Query macOS Address Book (ABCDRecord SQLite)
6.   Build AppState  -> { chat_db, analytics_db, contact_map }
7.   Register commands -> Tauri IPC handlers
8.   Create window   -> 1200x800, min 900x600
9. Frontend loads    -> React Query fetches initial data
```

### Chat Loading

```
Frontend                          Backend
   |                                 |
   |-- invoke("get_chats") --------->|
   |                                 |-- Query chat table
   |                                 |-- Batch load participants via chat_handle_join
   |                                 |-- Resolve contact names from map
   |                                 |-- Get last message per chat
   |                                 |-- Sort by last_message_date DESC
   |<-- Chat[] ----------------------|
   |                                 |
   |-- invoke("get_messages", id) -->|
   |                                 |-- Query messages for chat_id
   |                                 |-- Filter out tapback reactions
   |                                 |-- Parse attributedBody where text is NULL
   |                                 |-- Resolve sender names
   |<-- Message[] -------------------|
```

### Wrapped Stats

```
Frontend                              Backend
   |                                     |
   |-- invoke("get_wrapped_stats", yr)->|
   |                                     |-- Check wrapped_cache for year
   |                                     |-- If cached: return JSON
   |                                     |-- If not cached:
   |                                     |     Query message counts
   |                                     |     Group by handle, weekday, month
   |                                     |     Compute late-night stats
   |                                     |     Extract conversation openers
   |                                     |     Store in wrapped_cache
   |<-- WrappedStats --------------------|
```

## Domain Types

### TypeScript (Frontend)

```typescript
interface Chat {
  rowid: number;
  guid: string;
  display_name: string | null;
  style: number;              // 43=group, 45=DM
  participants: Handle[];
  last_message_date: number;  // Unix ms
  last_message_text: string | null;
}

interface Message {
  rowid: number;
  guid: string;
  text: string | null;
  is_from_me: boolean;
  date: number;               // Unix ms
  handle_id: number;
  sender: string | null;      // Resolved display name
  service: string;            // "iMessage" | "SMS"
  has_attachments: boolean;
  associated_message_type: number | null;  // Tapback type
}

interface Handle {
  rowid: number;
  id: string;                 // Phone number or email
  service: string;
  display_name: string | null;
}

interface WrappedStats {
  message_count: number;
  sent_count: number;
  received_count: number;
  chat_count: number;
  chat_interactions: ChatInteraction[];
  weekday_distribution: Record<string, number>;
  monthly_distribution: Record<string, number>;
  late_night_chats: LateNightChat[];
  popular_openers: PopularOpener[];
}
```

### Rust (Backend)

Equivalent structs in `src-tauri/src/db/models.rs` with `#[derive(Serialize)]` for Tauri IPC serialization.

## App Configuration

### Tauri (tauri.conf.json)

- **Bundle identifier**: `com.message-intelligence.app`
- **Window**: 1200x800 default, 900x600 minimum
- **Frontend**: Static files from `../out` (Next.js static export)
- **Dev server**: `http://localhost:3000`

### Next.js (next.config.ts)

- **Output mode**: `"export"` (static HTML/JS/CSS, no server)
- **Image optimization**: disabled (static export limitation)

## Planned AI Architecture

### Embedding Pipeline (Phase 2)

```
chat.db messages
    |
    v
[Incremental Processor] -- tracks last_processed_rowid
    |
    v
[Text Extraction] -- message_parser.rs
    |
    v
[Ollama Embedding API] -- local HTTP (localhost:11434)
    |
    v
[Vector Storage] -- analytics.db or separate vectors.db
    |
    v
[Similarity Search] -- cosine similarity on query embedding
```

- Process messages incrementally (only new messages since last run)
- Background processing with progress reporting to frontend
- Model: `nomic-embed-text` or similar via Ollama
- Storage: SQLite with BLOB columns for float32 vectors, or consider sqlite-vss extension

### Sentiment Analysis (Phase 2-3)

- Batch analyze messages using local LLM
- Store per-message scores in `message_sentiment` table
- Aggregate into `relationship_metrics` for trend analysis
- Real-time sentiment overlay on chat view

### AI Conversation Simulation (Phase 4)

- Build conversation context from message history
- Use local LLM (Ollama) with system prompt constructed from contact's writing style
- Temperature and personality parameters derived from actual communication patterns

## Build & Development

```bash
# Frontend development (hot reload)
npm run dev

# Full app development (Tauri + Next.js)
cargo tauri dev

# Production build
npm run build          # Next.js static export -> out/
cargo tauri build      # Bundle macOS .app / .dmg

# Rust checks
cd src-tauri && cargo check
cd src-tauri && cargo clippy
```

## Security & Privacy

- **chat.db**: Opened read-only (`SQLITE_OPEN_READ_ONLY`). The app cannot modify message data.
- **No network calls**: The app makes zero network requests for message data. AI processing uses only localhost Ollama.
- **Full Disk Access**: Required macOS entitlement -- user must explicitly grant in System Preferences.
- **Contact access**: Uses macOS Address Book database directly (SQLite) for name resolution.
- **No telemetry**: No analytics, crash reporting, or usage tracking.

## Performance Considerations

- **React Query caching**: Chat list cached for 30 seconds; messages cached for 60 seconds
- **Wrapped stats caching**: Computed once per year, stored in analytics.db
- **Incremental processing**: Embedding/analysis pipelines track progress and only process new messages
- **SQLite WAL mode**: Allows concurrent reads without blocking Apple's Messages.app
- **Lazy loading**: Messages loaded per-chat, not all at once
- **Batch operations**: Contact resolution done as batch lookup at startup, stored in HashMap
