# Capsule - Technical Specification

## Architecture Overview

Capsule is a native macOS desktop application built with **Tauri v2**, combining a **Rust backend** for performance-critical data processing with a **React/Next.js frontend** for the user interface. The app reads Apple's iMessage database (chat.db) directly in read-only mode and maintains a separate analytics database for cached computations.

```
+--------------------------------------------------+
|                  Tauri Window                      |
|  +----------------------------------------------+ |
|  |          React / Next.js Frontend             | |
|  |  (Static Export served from ../out)            | |
|  |                                                | |
|  |  Components:  Chat | Wrapped | Search          | |
|  |  State:       Zustand + React Query            | |
|  |  Charts:      Recharts + custom SVG heatmap     | |
|  |  Design:      Apple glassmorphism, SF Pro      | |
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
| Tailwind CSS | 4.x | Styling + Apple glassmorphism utilities |
| shadcn/ui | latest | Component library (Radix-based) |
| Zustand | latest | Global state management |
| TanStack React Query | latest | Async data fetching & caching |
| Recharts | latest | Data visualization (AreaChart, BarChart) |
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

## Directory Structure

```
icapsule/
├── src/                              # Frontend source
│   ├── app/
│   │   ├── page.tsx                  # Main page - nav + view routing (glass nav bar)
│   │   ├── layout.tsx                # Root layout with QueryProvider
│   │   └── globals.css               # Global styles, glassmorphism utilities, Apple scrollbars
│   ├── components/
│   │   ├── chat/
│   │   │   ├── chat-list.tsx         # Sidebar: chat list, search, wrapped chat selector
│   │   │   ├── chat-view.tsx         # Message display with Virtuoso
│   │   │   └── message-bubble.tsx    # Apple-styled message bubbles + tapbacks
│   │   ├── wrapped/
│   │   │   ├── wrapped-view.tsx      # Wrapped dashboard (global + per-chat) with tabbed layout
│   │   │   ├── message-heatmap.tsx   # GitHub-style calendar heatmap (SVG, 5-level color scale)
│   │   │   ├── relationship-timeline.tsx # Week-by-week scrollable bar chart with tooltips
│   │   │   ├── first-message.tsx     # "Where It All Began" — first message as iMessage bubble
│   │   │   ├── emoji-frequency.tsx   # Most used emoji grid with frequency bars
│   │   │   ├── word-frequency.tsx    # Most used words with Everyone / My Words toggle
│   │   │   ├── group-dynamics.tsx    # Group chat dynamics: MVP cards + ranked participant stats
│   │   │   ├── fun-stats.tsx         # Texting personality classification
│   │   │   └── on-this-day.tsx       # "On This Day" interactive section with click-to-navigate
│   │   ├── search/
│   │   │   └── global-search.tsx     # Semantic search UI (placeholder)
│   │   ├── ui/                       # shadcn/ui primitives
│   │   └── providers/
│   │       └── query-provider.tsx    # React Query provider
│   ├── hooks/
│   │   ├── use-messages.ts           # Chat & message data hooks
│   │   └── use-analytics.ts          # Wrapped, temporal trends, and relationship metric hooks
│   ├── lib/
│   │   ├── commands.ts               # Tauri invoke wrappers (all backend commands)
│   │   └── utils.ts                  # Utilities (cn helper)
│   ├── stores/
│   │   └── app-store.ts              # Zustand store (view, selectedChat, wrappedChatId, wrappedYear)
│   └── types/
│       └── index.ts                  # TypeScript domain types
│
├── src-tauri/                        # Backend source
│   ├── src/
│   │   ├── main.rs                   # Entry point
│   │   ├── lib.rs                    # App builder, DB init, command registration
│   │   ├── state.rs                  # AppState (DB connections + contact map)
│   │   ├── error.rs                  # AppError enum with Tauri serialization
│   │   ├── db/
│   │   │   ├── mod.rs
│   │   │   ├── models.rs             # Domain structs (Chat, Message, Handle, etc.)
│   │   │   ├── chat_db.rs            # Read-only queries against Apple's chat.db
│   │   │   ├── contacts_db.rs        # macOS Address Book contact resolution
│   │   │   ├── analytics_db.rs       # Analytics database CRUD + wrapped cache
│   │   │   └── schema.rs             # Analytics DB migration/table definitions
│   │   ├── commands/
│   │   │   ├── mod.rs
│   │   │   ├── messages.rs           # get_chats, get_messages, get_message_count
│   │   │   ├── contacts.rs           # get_contact_name, get_contact_map
│   │   │   ├── analytics.rs          # Wrapped stats, temporal trends, relationship metrics
│   │   │   ├── fun.rs               # Group dynamics, "On This Day", texting personality
│   │   │   └── embeddings.rs         # check_embedding_status, semantic_search (stubs)
│   │   ├── ingestion/
│   │   │   ├── mod.rs
│   │   │   ├── timestamp.rs          # Apple Core Data timestamp -> Unix conversion
│   │   │   └── message_parser.rs     # NSKeyedArchiver attributedBody extraction
│   │   ├── analysis/                 # Placeholder for sentiment/topic modules
│   │   ├── embeddings/               # Placeholder for vector search modules
│   │   └── sidecar/                  # Placeholder for Ollama integration
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── .reference/                       # Legacy/reference code from earlier iteration
├── package.json
├── next.config.ts                    # Static export config
├── tsconfig.json
├── components.json                   # shadcn/ui config
├── README.md                         # Project overview, features, and setup
└── tech_spec.md                      # This file
```

## Tauri Commands (Backend API)

All 20 commands are invoked via `invoke()` from the frontend. Heavy queries run on `tokio::task::spawn_blocking` to keep the UI responsive.

### Message Commands (`commands/messages.rs`)

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `get_chats` | -- | `Chat[]` | All conversations sorted by most-recent message |
| `get_messages` | `chatId, limit?, offset?` | `Message[]` | Messages for a chat |
| `get_message_count` | -- | `number` | Total message count across all chats |

### Analytics Commands (`commands/analytics.rs`)

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `get_wrapped_stats` | `year, chatIds?` | `WrappedStats` | Wrapped analytics. Year 0 = all-time. Optional chat filter. Global results cached in analytics.db. |
| `get_temporal_trends` | `chatId?, year?` | `DailyMessageCount[]` | Daily sent/received counts. Optional chatId for per-chat or global (null). |
| `get_response_time_stats` | `chatId` | `ResponseTimeStats` | Avg/median/fastest response times, you vs. them |
| `get_initiation_stats` | `chatId` | `InitiationStats` | Who starts conversations more (4h gap threshold) |
| `get_message_length_stats` | `chatId` | `MessageLengthStats` | Avg/max/total chars and message count per side |
| `get_active_hours` | `chatId` | `HourlyActivity[]` | Messages by hour (0-23), you vs. them |
| `invalidate_wrapped_cache` | `year?` | -- | Clear cached wrapped results |

### Contact Commands (`commands/contacts.rs`)

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `get_contact_name` | `identifier` | `string?` | Resolve phone/email to contact name |
| `get_contact_map` | -- | `Record<string, string>` | Full contact lookup map |

### Fun & Social Commands (`commands/fun.rs`)

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `get_group_chat_dynamics` | `chatId` | `GroupChatDynamics` | Per-participant stats: message count, avg length, replies triggered, ignored count. MVP cards for most active, conversation starter, reply magnet. |
| `get_on_this_day` | `chatId?` | `OnThisDayResult` | Messages from today's month+day across all past years, grouped by year. Works global (all chats) and per-chat. |
| `get_texting_personality` | `chatId?` | `TextingPersonality` | Classifies texting style from 8 traits (Night Owl, Early Bird, Essay Writer, Rapid Fire, Conversation Starter, Slow Burn, Weekend Warrior, Ghost) with scored trait bars. |
| `get_first_message` | `chatId` | `FirstMessage?` | First message ever exchanged in a conversation (text, sender, date). |
| `get_emoji_frequency` | `chatId?, year?` | `EmojiFrequency[]` | Top 30 most used emoji across messages, with counts. Unicode code point range detection in Rust. |
| `get_color_frequency` | `chatId?, year?` | `ColorFrequency[]` | Most referenced colors in messages with hex values and frequency counts. |

### Embedding Commands (`commands/embeddings.rs`) -- Stubs

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `check_embedding_status` | -- | `EmbeddingStatus` | Check Ollama/embedding readiness |
| `semantic_search` | `query, limit?` | `SemanticSearchResult[]` | Vector similarity search |

## Database Architecture

### Apple's chat.db (Read-Only)

Located at `~/Library/Messages/chat.db`. Requires **Full Disk Access** permission. Opened with `SQLITE_OPEN_READ_ONLY` and `PRAGMA journal_mode=WAL`.

**Key tables used:**

| Table | Purpose |
|-------|---------|
| `chat` | Conversation metadata (guid, style, display_name) |
| `message` | Individual messages (text, date, is_from_me, handle_id, associated_message_type) |
| `handle` | Contact identifiers (phone numbers, emails, service type) |
| `chat_message_join` | Many-to-many: chat <-> message |
| `chat_handle_join` | Many-to-many: chat <-> handle (participants) |
| `attachment` | File attachments metadata |
| `message_attachment_join` | Many-to-many: message <-> attachment |

**Key conventions:**

- `message.date`: Apple Core Data epoch (nanoseconds since 2001-01-01). To Unix seconds: `date / 1_000_000_000 + 978_307_200`
- `message.associated_message_type` != 0: tapback reaction (2000-2005 range for current tapbacks)
- `message.attributedBody`: binary NSKeyedArchiver blob; parsed when `text` is NULL
- `chat.style`: 43 = group chat, 45 = DM

### analytics.db (Read/Write, App-Managed)

Created on first launch. Currently used for wrapped stats caching. Schema includes tables for future features (sentiment, embeddings, topics, relationship metrics, links) but only `wrapped_cache` is actively written to.

**Active table:**

```sql
wrapped_cache (
    year INTEGER PRIMARY KEY,
    stats_json TEXT,         -- Serialized WrappedStats JSON
    computed_at TEXT
)
```

**Schema-only tables (created but not yet populated):** `processing_state`, `message_sentiment`, `embedding_state`, `conversation_windows`, `topics`, `relationship_metrics`, `links`, `attachment_cache`.

## Data Flow

### Startup Sequence

```
1. main.rs           -> Launches Tauri app
2. lib.rs            -> run() called
3.   Open chat.db    -> Read-only, WAL mode, ~/Library/Messages/chat.db
4.   Open analytics.db -> Create if needed, run schema migrations
5.   Load contacts   -> Query macOS Address Book (ABCDRecord SQLite)
6.   Build AppState  -> { chat_db, analytics_db, contact_map }
7.   Register commands -> 20 Tauri IPC handlers
8.   Create window   -> 1200x800, min 900x600
9. Frontend loads    -> React Query fetches initial data
```

### Relationship Metrics (Per-Chat)

```
Frontend                                  Backend
   |                                         |
   |-- invoke("get_response_time_stats") --->|
   |                                         |-- Fetch all messages for chat, ordered by date
   |                                         |-- Walk messages in Rust, detect direction changes
   |                                         |-- Compute avg/median/fastest deltas (<24h only)
   |<-- ResponseTimeStats -------------------|
   |                                         |
   |-- invoke("get_initiation_stats") ------>|
   |                                         |-- Walk messages, flag 4h+ gaps as new conversations
   |                                         |-- Count initiations by is_from_me
   |<-- InitiationStats ---------------------|
   |                                         |
   |-- invoke("get_active_hours") ---------->|
   |                                         |-- SQL: strftime('%H') + conditional SUM by is_from_me
   |<-- HourlyActivity[24] -----------------|
```

## Frontend State (Zustand)

```typescript
interface AppState {
  view: "chat" | "wrapped" | "search";
  selectedChatId: number | null;     // Active chat in chat view
  wrappedChatId: number | null;      // Active chat in wrapped view (null = global)
  wrappedYear: number;               // 0 = all-time (default)
  searchQuery: string;
  chatSearchQuery: string;
}
```

## Design System

Consumer-friendly, conversational UI with Apple-native light/dark theme toggle (localStorage persistence) and glassmorphism. Uses `.card-glass` utility for glassmorphic cards throughout analytics views.

| Element | Style |
|---------|-------|
| Backgrounds | `#1C1C1E` (primary), `#2C2C2E` (secondary), `#3A3A3C` (tertiary) |
| iMessage blue | `#007AFF` |
| SMS green | `#34C759` |
| Received bubble | `#3A3A3C` |
| Borders | `rgba(255, 255, 255, 0.06)` -- barely visible |
| Glass surfaces | `backdrop-blur(20px) saturate(180%)` with `bg-white/5` |
| Font | `-apple-system, BlinkMacSystemFont, SF Pro Display` |
| Bubbles | `rounded-[20px]` with `rounded-br-[8px]` tail corner |
| Scrollbars | 6px, transparent until hovered |

CSS utility classes: `.glass`, `.glass-heavy`, `.glass-border`, `.glass-shadow`, `.apple-text-sm`, `.apple-text-xs`, `.card-glass`, `.stat-glow`, `.section-header`

## Build & Development

```bash
# Full app development (Tauri manages both frontend + backend)
npx tauri dev

# Frontend only (no backend, invoke() calls will fail)
npm run dev

# Production build
npm run build          # Next.js static export -> out/
cargo tauri build      # Bundle macOS .app / .dmg

# Type checking
npx tsc --noEmit       # Frontend
cd src-tauri && cargo check  # Backend
```

## Security & Privacy

- **chat.db**: Opened read-only (`SQLITE_OPEN_READ_ONLY`). The app cannot modify message data.
- **No network calls**: Zero network requests for message data. Future AI uses only localhost Ollama.
- **Full Disk Access**: Required macOS entitlement -- user must explicitly grant in System Preferences.
- **Contact access**: Uses macOS Address Book database directly (SQLite) for name resolution.
- **No telemetry**: No analytics, crash reporting, or usage tracking.

## Performance

- **React Query caching**: 5 minute stale time for chats, messages, and analytics queries
- **Wrapped stats caching**: Global results cached as JSON in analytics.db; per-chat results cached in React Query memory only
- **SQLite WAL mode**: Allows concurrent reads without blocking Apple's Messages.app
- **Virtuoso virtualization**: Chat list and message view use react-virtuoso with memoized rows
- **Tapback optimization**: Single-pass O(n) tapback map instead of per-message O(n) filtering
- **Blocking threads**: All heavy SQL runs on `tokio::task::spawn_blocking` to keep UI responsive
- **Batch operations**: Contact resolution done as batch lookup at startup, stored in HashMap
