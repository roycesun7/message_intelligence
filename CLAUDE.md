# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Run full app (Tauri manages Next.js frontend + Rust backend together)
npx tauri dev

# Frontend only (Tauri invoke() calls will fail without the backend)
npm run dev

# Type checking
npx tsc --noEmit          # Frontend TypeScript
cd src-tauri && cargo check  # Backend Rust

# Lint
npm run lint              # ESLint (Next.js + TypeScript rules)

# Production build
npm run build && npx tauri build
```

There are no tests configured in this project yet.

## Architecture

Tauri v2 desktop app: Rust backend reads the macOS iMessage database, React/Next.js frontend renders the UI. Next.js is configured for static export (`output: "export"` in `next.config.ts`) — Tauri serves the built files from `out/`.

### Two databases, strict separation

- **chat.db** (`~/Library/Messages/chat.db`) — Apple's iMessage database, opened **read-only** with `SQLITE_OPEN_READ_ONLY`. Never write to this.
- **analytics.db** (app data dir) — App-managed SQLite for cached computed results (wrapped stats, future embeddings). Read-write.

Both connections live in `AppState` (`src-tauri/src/state.rs`) as `Arc<Mutex<Connection>>`, accessed via Tauri's managed state.

### Data flow: SQLite → Rust command → React Query → Component

1. **Rust commands** (`src-tauri/src/commands/`) are `#[tauri::command]` functions that query SQLite and return serialized structs
2. **TypeScript wrappers** (`src/lib/commands.ts`) call `invoke<T>("command_name", { args })`
3. **React Query hooks** (`src/hooks/`) cache results with configurable stale times
4. **Components** consume hooks and render

When adding a new feature: define the Rust struct + command → register in `lib.rs` `generate_handler![]` → add TS type in `types/index.ts` → add invoke wrapper in `commands.ts` → add hook in `hooks/` → use in component.

### Key conventions

- **Rust structs** use `#[serde(rename_all = "camelCase")]` so field names match TypeScript automatically
- **Error handling**: All commands return `AppResult<T>` (alias for `Result<T, AppError>`). `AppError` implements `Serialize` for Tauri IPC.
- **Timestamps**: Apple stores dates as nanoseconds (or seconds, legacy) since 2001-01-01. Conversion to Unix milliseconds happens in `src-tauri/src/ingestion/timestamp.rs`. The threshold `> 1_000_000_000` distinguishes nanosecond vs second format.
- **Contact resolution**: At startup, `contacts_db::build_contact_map()` reads the macOS Address Book into a `HashMap<String, String>` (phone/email → display name). This map is passed through to query functions, not queried per-message.
- **Message text extraction**: Modern macOS (Ventura+) stores message text in `attributedBody` (NSKeyedArchiver binary blob) instead of `text`. Parsing logic is in `ingestion/message_parser.rs`. Object replacement characters (`\u{FFFC}`, `\u{FFFD}`) must be stripped.

### Frontend patterns

- **State**: Zustand store (`stores/app-store.ts`) for UI state (selected chat, view, year filter). Data fetching is React Query only — no data in Zustand.
- **Virtualization**: `react-virtuoso` for chat list and message list. Only visible messages trigger attachment data loading.
- **Design system**: Apple-native dark theme. iMessage blue `#007AFF`, SMS green `#34C759`, received bubble `#3A3A3C`, background `#1C1C1E`. Glassmorphism classes (`.glass`, `.glass-heavy`) defined in `globals.css`.
- **Tapbacks**: Built as a pre-computed map in a single O(n) pass (`buildTapbackMap` in `message-bubble.tsx`), not per-message filtering.

### Attachment handling

Attachments are lazy-loaded per-message. The `get_attachment_data` command reads files from `~/Library/Messages/Attachments/`, expanding `~` to the home dir, and base64-encodes images (JPEG, PNG, GIF, WebP). HEIC is excluded (base64 data URLs don't render reliably in WebKit). Files ending in `.pluginPayloadAttachment` are Apple's URL preview metadata and are filtered out in the frontend.

## Requirements

- macOS only (iMessage is Apple-only)
- Full Disk Access permission (System Settings → Privacy & Security) to read chat.db
- Rust toolchain + Node.js 18+
