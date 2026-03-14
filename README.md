# iCapsule

Privacy-first iMessage analytics for macOS. Your messages, your machine, your insights — no data ever leaves your device.

iCapsule reads your iMessage history directly from Apple's `chat.db` in **read-only mode** and transforms it into a rich, searchable, and analytically powerful experience. Relationship intelligence, temporal analysis, word frequency, texting personality profiling, and fun shareable "Wrapped"-style insights — all computed locally.

## Features

### Chat Viewer
- Browse all conversations sorted by recency with contact name resolution from the macOS Address Book
- Message rendering with tapback reactions, temporal grouping, date separators, and group/DM differentiation
- Inline image attachments (JPEG, PNG, GIF, WebP, HEIC via sips conversion)
- Fuzzy search across conversation list by name, identifier, or participant (Fuse.js)
- Virtualized scrolling for large message histories (react-virtuoso)

### Wrapped Analytics (Global + Per-Chat)
- Total / sent / received message counts and active chat count
- Top conversations with percentage bars
- Messages by month, day of week, and year
- Late-night texters (10 PM - 5 AM)
- Most popular conversation openers
- Most used words with Everyone / My Words toggle
- Cached results in analytics.db for instant reloads

### Relationship Intelligence (Per-Chat)
- **Temporal trends** — Daily message volume area chart with smart time bucketing (daily < 6mo, weekly < 3yr, monthly beyond)
- **Response time analytics** — Avg, median, and fastest response time for you vs. the other person (gaps > 24h excluded)
- **Conversation initiation ratio** — Who starts conversations more (4h+ gap = new conversation) with visual ratio bar
- **Message length patterns** — Avg / max / total characters and message count per side
- **Active hours overlap** — 24-hour bar chart showing when you and a contact each text

### Group Chat Dynamics
- Per-participant stats: message count, avg length, replies triggered, ignored count
- MVP cards for most active participant, conversation starter, and reply magnet

### On This Day
- Messages from today's date across all past years, grouped by year
- Click-to-navigate: jump to the original message in the chat view
- Works for both global and per-chat views

### Texting Personality
- Classifies your texting style across 8 traits: Night Owl, Early Bird, Essay Writer, Rapid Fire, Conversation Starter, Slow Burn, Weekend Warrior, Ghost
- Scored trait bars with primary/secondary type identification
- Works global and per-chat

### Onboarding
- Full Disk Access gate with step-by-step instructions
- Deep-link to System Settings > Privacy & Security > Full Disk Access
- Retry flow with status feedback

### Light & Dark Mode
- Full theme toggle with localStorage persistence
- Apple-native styling in both modes

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Tauri v2 (Rust backend) |
| Frontend | React 19, Next.js 16 (static export), TypeScript |
| Styling | Tailwind CSS 4, shadcn/ui |
| Data | rusqlite (read-only against chat.db), analytics.db for caching |
| Charts | Recharts |
| State | Zustand (UI) + TanStack React Query (data) |
| Search | Fuse.js (fuzzy client-side) |

## Getting Started

### Requirements

- **macOS 12+** (iMessage is Apple-only)
- **Full Disk Access** permission (System Settings > Privacy & Security)
- Rust toolchain (`rustup`)
- Node.js 18+

### Development

```bash
# Install dependencies
npm install

# Full app (Tauri manages frontend + backend together)
npx tauri dev

# Frontend only (Tauri invoke() calls will fail)
npm run dev

# Type checking
npx tsc --noEmit            # Frontend TypeScript
cd src-tauri && cargo check  # Backend Rust

# Lint
npm run lint

# Production build
npm run build && npx tauri build
```

## Architecture

Tauri v2 desktop app with strict separation between two SQLite databases:

```
┌─────────────────────────────────────────────┐
│               Tauri Window                   │
│  ┌─────────────────────────────────────────┐ │
│  │      React / Next.js Frontend           │ │
│  │  Components → Hooks → Commands (IPC)    │ │
│  └──────────────┬──────────────────────────┘ │
│                 │ invoke()                    │
│  ┌──────────────▼──────────────────────────┐ │
│  │           Rust Backend                   │ │
│  │  Commands → DB queries → Serialized JSON │ │
│  └──────┬──────────────────┬───────────────┘ │
└─────────┼──────────────────┼─────────────────┘
     [chat.db]          [analytics.db]
     read-only           read/write
     ~/Library/           app data dir
     Messages/
```

- **chat.db** — Apple's iMessage database, opened `SQLITE_OPEN_READ_ONLY`. Never written to.
- **analytics.db** — App-managed SQLite for cached computations. Read-write.

### Adding a New Feature

```
Rust struct + command → register in lib.rs → TS type in types/index.ts → invoke wrapper in commands.ts → hook in hooks/ → component
```

For full architecture details, database schema, all 18 Tauri commands, data flow diagrams, design system tokens, and performance notes, see **[`tech_spec.md`](tech_spec.md)**.

## For AI Agents & Contributors

If you're an AI agent working on this codebase, start here:

1. **This README** — what the app does, what's built, what's planned
2. **[`tech_spec.md`](tech_spec.md)** — full technical specification: directory structure, all Tauri commands with parameters/return types, database schema, data flow diagrams, design system, and performance details
3. **[`CLAUDE.md`](CLAUDE.md)** — build commands, key conventions (serde rename, error handling, timestamps, contact resolution, message parsing), and frontend patterns

### Key Conventions

- **Rust structs** use `#[serde(rename_all = "camelCase")]` — field names match TypeScript automatically
- **All commands** return `AppResult<T>` (alias for `Result<T, AppError>`) where `AppError` implements `Serialize` for Tauri IPC
- **Timestamps**: Apple stores dates as nanoseconds since 2001-01-01. Conversion: `date / 1_000_000_000 + 978_307_200` = Unix seconds. Threshold `> 1_000_000_000` distinguishes nano vs second format. See `ingestion/timestamp.rs`.
- **Message text**: Modern macOS stores text in `attributedBody` (NSKeyedArchiver blob) instead of `text`. Parsing in `ingestion/message_parser.rs`. Strip `\u{FFFC}` and `\u{FFFD}`.
- **Contact resolution**: `contacts_db::build_contact_map()` runs at startup, builds `HashMap<String, String>` (phone/email → display name). Passed through to query functions.
- **Heavy queries** run on `tokio::task::spawn_blocking` to keep the UI responsive
- **No tests configured yet** — this is a good area for contribution

## Roadmap

### Planned: Search & Content
- [ ] Full-text search (FTS5) — fast keyword/phrase search across all conversations
- [ ] Link extraction & catalog — regex URLs from messages, group by domain
- [ ] Media gallery — browse attachments by conversation
- [ ] Conversation export (TXT, JSON, CSV)

### Planned: AI & Embeddings
- [ ] Local embeddings pipeline — Ollama-powered, processed incrementally
- [ ] Semantic search — natural language queries using vector similarity
- [ ] Sentiment analysis — per-message and per-conversation scoring
- [ ] Topic modeling — automatic identification of recurring themes

### Planned: Polish & Distribution
- [ ] Code signing & notarization for macOS distribution
- [ ] Settings & preferences (theme, privacy controls)
- [ ] Performance optimization for very large databases (500k+ messages)

## Privacy

- **Read-only**: chat.db opened with `SQLITE_OPEN_READ_ONLY` — the app cannot modify your messages
- **Zero network requests** for message data
- **No telemetry**, analytics, or crash reporting
- Future AI features use only local Ollama (localhost)

## Non-Goals

- Sending messages (read-only analytics tool)
- Cross-platform support
- Cloud processing
- Real-time sync

## License

MIT
