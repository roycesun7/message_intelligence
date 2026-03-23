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

# Release (creates signed, notarized DMG via GitHub Actions)
git tag v0.x.0 && git push origin v0.x.0
```

There are no tests configured in this project yet.

## Architecture

Tauri v2 desktop app: Rust backend reads the macOS iMessage database, React/Next.js frontend renders the UI. Next.js is configured for static export (`output: "export"` in `next.config.ts`) — Tauri serves the built files from `out/`.

### Two databases, strict separation

- **chat.db** (`~/Library/Messages/chat.db`) — Apple's iMessage database, opened **read-only** with `SQLITE_OPEN_READ_ONLY`. Never write to this.
- **analytics.db** (app data dir) — App-managed SQLite for cached computed results (wrapped stats, embeddings). Read-write.

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
- **Design system**: Apple-native light/dark theme with full theme toggle. Analytics color palette: `#1B2432` (dark navy), `#3B82C4` (blue), `#4E5D6E` (slate), `#94A3B3` (muted), `#D1D5DB` (light border). Glassmorphism classes (`.glass`, `.glass-heavy`, `.card-glass`) defined in `globals.css`.
- **Tapbacks**: Built as a pre-computed map in a single O(n) pass (`buildTapbackMap` in `message-bubble.tsx`), not per-message filtering.
- **Capsule tabs**: The analytics dashboard ("Capsule") is organized into tabs — Overview, Between You Two (per-chat), Patterns, Fun. Components live in `src/components/capsule/`.

### Attachment handling

Attachments are lazy-loaded per-message. The `get_attachment_data` command reads files from `~/Library/Messages/Attachments/`, expanding `~` to the home dir, and base64-encodes images (JPEG, PNG, GIF, WebP). HEIC files are converted to JPEG on-the-fly using macOS `sips` (no external dependencies). Files ending in `.pluginPayloadAttachment` are Apple's URL preview metadata and are filtered out in the frontend.

## Telemetry & Analytics

Anonymous usage tracking via PostHog (project key in `src-tauri/src/telemetry.rs` and `src/components/providers/posthog-provider.tsx`). No message content is ever sent.

### What's tracked

**From Rust backend** (`src-tauri/src/telemetry.rs`):
- `app_launched` — once per launch, includes app_version, os_version. Gated behind `cfg!(debug_assertions)` so dev builds don't fire.

**From frontend** (`src/hooks/use-analytics-tracking.ts`):
- `tab_switched` — with `from_tab`, `to_tab`, `time_spent_seconds`
- `capsule_tab_viewed` — which analytics sub-tab was viewed
- `tutorial_completed` / `tutorial_skipped`
- All gated behind `process.env.NODE_ENV === "development"` check

**All in-app events** have `source: "app"` property (set via `posthog.register()` in PostHogProvider). Landing page events use `source: "landing"`. This allows filtering dashboards by source.

**Debug gates**: Currently commented out for testing (search for `TODO: re-enable before release` in `telemetry.rs`, `posthog-provider.tsx`, and `use-analytics-tracking.ts`). **Must be re-enabled before any production release.**

## Release & Distribution

### GitHub Actions workflow (`.github/workflows/release.yml`)
- Triggers on tag push (`v*`)
- Builds on macOS, signs with Developer ID Application certificate, notarizes with Apple
- Creates GitHub Release with `.dmg` and `latest.json` (for auto-updater)

### Auto-updater
- `tauri-plugin-updater` checks `latest.json` from GitHub Releases on app launch
- `src/components/layout/update-checker.tsx` shows a toast when a new version is available
- Users click "Update" → downloads, installs, restarts automatically
- Signing keypair: private key in GitHub Secrets (`TAURI_SIGNING_PRIVATE_KEY`), public key in `tauri.conf.json`

### GitHub Secrets required for releases
- `TAURI_SIGNING_PRIVATE_KEY` — Tauri updater signing key (`~/.tauri/capsule.key`)
- `APPLE_CERTIFICATE` — Developer ID Application cert as base64
- `APPLE_CERTIFICATE_PASSWORD` — cert export password
- `APPLE_ID` — Apple ID email for notarization
- `APPLE_PASSWORD` — app-specific password for notarization

### Landing page
- `landing/index.html` — standalone HTML page with animated ocean scene (jellyfish + angler fish)
- Also lives in separate repo for Vercel deployment
- Download button links to GitHub Releases DMG
- PostHog tracking for pageviews and download clicks (source: "landing")

## Requirements

- macOS only (iMessage is Apple-only)
- Full Disk Access permission (System Settings → Privacy & Security) to read chat.db
- Rust toolchain + Node.js 18+

## Current Status (v0.1.0)

- **Shipped**: Chat viewer, Capsule analytics dashboard (4 tabs), onboarding, tutorial, light/dark mode, auto-updater
- **Coming soon**: Semantic search (search tab shows "Coming Soon" placeholder, embeddings infrastructure exists but is hidden behind collapsed Settings dropdown)
- **Search tab**: `src/components/search/global-search.tsx` is a placeholder. Full search with CLIP embeddings exists in code but is not user-facing yet.
