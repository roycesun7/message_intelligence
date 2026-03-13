# Message Intelligence

Privacy-first iMessage analytics for macOS. All processing happens locally — no message data ever leaves your device.

## What It Does

Message Intelligence transforms your iMessage history into a rich, searchable, and analytically powerful experience with relationship intelligence, temporal analysis, and fun shareable insights.

## Features

### Phase 1 — Foundation (Complete)

- [x] **Chat viewer** — Browse all conversations sorted by recency, with contact name resolution from macOS Address Book
- [x] **Message rendering** — Display messages with tapback reactions, temporal grouping, date separators, and group/DM differentiation
- [x] **Chat search** — Fuzzy search (Fuse.js) across conversation list by name, identifier, or participant
- [x] **Global Wrapped analytics** — All-time or year-selectable dashboard with:
  - Total/sent/received message counts and active chat count
  - Top 10 conversations with percentage bars
  - Messages by month (bar chart with per-month colors)
  - Messages by day of week
  - Late-night texters (10 PM - 5 AM)
  - Most popular conversation openers
  - Cached results in analytics.db for performance
- [x] **Per-chat Wrapped** — Select any conversation from the sidebar to view Wrapped stats filtered to that chat. Sidebar shows "All Chats" option to return to global view
- [x] **Apple-native UI** — Glassmorphism nav/sidebar, Apple's exact iMessage colors (#007AFF/#34C759/#3A3A3C), SF Pro typography, rounded-[20px] bubbles, pill-shaped date separators, auto-hiding scrollbars

### Phase 2 — Analytics & Relationship Intelligence (Complete)

- [x] **Temporal trends** — Per-conversation area chart showing daily message volume over the full conversation history. Smart time bucketing (daily <6mo, weekly <3yr, monthly beyond). Overlapping sent/received areas.
- [x] **Response time analytics** — Avg, median, and fastest response time for you vs. the other person. Gaps >24h excluded (not "responses").
- [x] **Conversation initiation ratio** — Who starts conversations more (4h+ gap = new conversation). Visual ratio bar.
- [x] **Message length patterns** — Avg/max/total characters and message count per side.
- [x] **Active hours overlap** — 24-hour bar chart showing when you and a contact each text, revealing schedule overlap.
- [x] **Group chat dynamics** — Per-participant stats for group chats: message count, avg length, replies triggered, ignored count. MVP cards for most active, conversation starter, and reply magnet.
- [x] **"On This Day"** — Messages from today's date across all past years, grouped by year, with sender resolution. Works for both global and per-chat views.
- [x] **Texting personality** — Classifies your texting style from 8 traits (Night Owl, Early Bird, Essay Writer, Rapid Fire, Conversation Starter, Slow Burn, Weekend Warrior, Ghost) with scored trait bars. Works global and per-chat.

### Phase 3 — Search & Content (Not Started)

- [ ] **Full-text search** (FTS5) — Fast keyword/phrase search across all conversations (no embeddings needed)
- [ ] **Link extraction & catalog** — Regex URLs from messages, group by domain
- [ ] **Media gallery** — Browse attachments by conversation
- [ ] **Conversation export** (TXT, JSON, CSV)

### Phase 4 — AI & Embeddings (Not Started)

- [ ] **Local embeddings pipeline** — Ollama-powered embedding generation, processed incrementally
- [ ] **Semantic search** — Natural language queries using vector similarity
- [ ] **Sentiment analysis** — Per-message and per-conversation sentiment scoring
- [ ] **Topic modeling** — Automatic identification of recurring conversation themes
- [ ] **AI conversation simulation** — Chat with contacts "in their voice" using local LLM

### Phase 5 — Polish & Distribution (Not Started)

- [ ] **Onboarding flow** — Guide users through Full Disk Access permissions, initial indexing
- [ ] **Settings & preferences** — Configure theme, privacy controls
- [ ] **Performance optimization** — Background processing, lazy loading for large databases
- [ ] **Code signing & notarization** — macOS distribution-ready builds
- [ ] **Auto-updates** — In-app update mechanism

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| Desktop | Tauri v2 (Rust backend, ~15-30MB app size) |
| Frontend | React 19, Next.js 16 (static export), Tailwind CSS, shadcn/ui |
| Data | rusqlite (read-only against Apple's chat.db), analytics.db for caching |
| Charts | Recharts |
| State | Zustand + TanStack React Query |
| AI (planned) | Ollama (local inference, fully offline) |

## Development

```bash
# Install dependencies
npm install

# Full app (Tauri manages both frontend + backend)
npx tauri dev

# Frontend only (backend calls will fail without Tauri)
npm run dev

# Production build
npx tauri build

# Type checking
npx tsc --noEmit            # Frontend
cd src-tauri && cargo check  # Backend

# Lint
npm run lint
```

## Requirements

- macOS (iMessage is Apple-only)
- Full Disk Access permission (to read ~/Library/Messages/chat.db)
- Rust toolchain + Node.js 18+

## Privacy

- chat.db opened read-only — the app cannot modify your messages
- Zero network requests for message data
- No telemetry, analytics, or crash reporting
- Future AI features use only local Ollama (localhost)

## Non-Goals

- Sending messages (read-only analytics tool)
- Cross-platform support
- Cloud processing
- Real-time sync
