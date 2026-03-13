# Message Intelligence - Project Context & PRD

## Vision

Message Intelligence is a privacy-first desktop application for macOS that transforms your iMessage history into a rich, searchable, and analytically powerful experience. It builds on the foundation laid by [mimessage](https://github.com/jonluca/mimessage) -- a read-only iMessage viewer with search, export, and "Wrapped" statistics -- and extends it with relationship intelligence, temporal analysis, and (planned) AI-driven features.

All processing happens locally on the user's machine. No message data ever leaves the device.

## Inspiration: mimessage

MiMessage (by JonLuca DeCaro) is an Electron + Next.js desktop app that provides:

- **Conversation viewer** -- Browse and read iMessage/SMS conversations with contact name resolution
- **Full-text & semantic search** -- FTS5-based keyword search plus OpenAI embedding-powered semantic search
- **Filters** -- Refine results by date range, participant, and chat
- **"iMessage Wrapped"** -- Spotify Wrapped-style analytics: message counts by year/month/weekday, top conversations, late-night texting patterns, popular openers (global and per-person)
- **Media & conversation export** -- Bulk export images/videos/attachments; export conversations as TXT, JSON, or CSV
- **AI conversation simulation** -- Chat with historical contacts "in their voice" using OpenAI

### Where Message Intelligence Diverges

| Aspect | mimessage | Message Intelligence |
|--------|-----------|---------------------|
| **Framework** | Electron (JS/TS everywhere) | Tauri v2 (Rust backend, React frontend) |
| **Performance** | Node.js SQLite bindings | Native Rust with rusqlite -- significantly faster for large databases |
| **AI provider** | OpenAI API (cloud) | Ollama (local, planned) -- fully offline, zero data exfiltration |
| **Privacy model** | Messages sent to OpenAI for embeddings | All processing on-device |
| **App size** | ~200MB+ (Electron) | ~15-30MB (Tauri) |
| **Design language** | Material UI | Apple-native (glassmorphism, SF Pro, Apple color palette) |
| **Scope** | Viewer + search + export + stats | Full analytical platform with relationship intelligence, temporal trends, and more |

## Target User

- macOS users who are curious about their messaging patterns
- People who want to search their message history intelligently (by meaning, not just keywords)
- Users who value privacy and want AI features without cloud dependencies
- Anyone interested in relationship analytics and communication insights

## Development Approach

Features are being built incrementally, prioritizing non-embedding features first. Embedding/AI features are a separate, later workstream due to their complexity (Ollama integration, vector storage, incremental processing).

## Core Features

### Phase 1 - Foundation (Complete)

- [x] **Chat viewer** -- Browse all conversations sorted by recency, with contact name resolution from macOS Address Book
- [x] **Message rendering** -- Display messages with tapback reactions, temporal grouping, date separators, and group/DM differentiation
- [x] **Chat search** -- Fuzzy search (Fuse.js) across conversation list by name, identifier, or participant
- [x] **Global Wrapped analytics** -- All-time or year-selectable dashboard with:
  - Total/sent/received message counts and active chat count
  - Top 10 conversations with percentage bars
  - Messages by month (bar chart with per-month colors)
  - Messages by day of week
  - Late-night texters (10 PM - 5 AM)
  - Most popular conversation openers
  - Cached results in analytics.db for performance
- [x] **Per-chat Wrapped** -- Select any conversation from the sidebar to view Wrapped stats filtered to that chat. Sidebar shows "All Chats" option to return to global view
- [x] **Apple-native UI** -- Glassmorphism nav/sidebar, Apple's exact iMessage colors (#007AFF/#34C759/#3A3A3C), SF Pro typography, rounded-[20px] bubbles, pill-shaped date separators, auto-hiding scrollbars

### Phase 2 - Analytics & Relationship Intelligence (Complete)

- [x] **Temporal trends** -- Per-conversation area chart showing daily message volume over the full conversation history. Smart time bucketing (daily <6mo, weekly <3yr, monthly beyond). Overlapping sent/received areas.
- [x] **Response time analytics** -- Avg, median, and fastest response time for you vs. the other person. Gaps >24h excluded (not "responses").
- [x] **Conversation initiation ratio** -- Who starts conversations more (4h+ gap = new conversation). Visual ratio bar.
- [x] **Message length patterns** -- Avg/max/total characters and message count per side.
- [x] **Active hours overlap** -- 24-hour bar chart showing when you and a contact each text, revealing schedule overlap.
- [x] **Group chat dynamics** -- Per-participant stats for group chats: message count, avg length, replies triggered, ignored count. MVP cards for most active, conversation starter, and reply magnet.
- [x] **"On This Day"** -- Messages from today's date across all past years, grouped by year, with sender resolution. Works for both global and per-chat views.
- [x] **Texting personality** -- Classifies your texting style from 8 traits (Night Owl, Early Bird, Essay Writer, Rapid Fire, Conversation Starter, Slow Burn, Weekend Warrior, Ghost) with scored trait bars. Works global and per-chat.

### Phase 3 - Search & Content (Not Started)

- [ ] **Full-text search** (FTS5) -- Fast keyword/phrase search across all conversations (no embeddings needed)
- [ ] **Link extraction & catalog** -- Regex URLs from messages, group by domain
- [ ] **Media gallery** -- Browse attachments by conversation
- [ ] **Conversation export** (TXT, JSON, CSV)

### Phase 4 - AI & Embeddings (Not Started -- Separate Workstream)

- [ ] **Local embeddings pipeline** -- Ollama-powered embedding generation, processed incrementally
- [ ] **Semantic search** -- Natural language queries using vector similarity
- [ ] **Sentiment analysis** -- Per-message and per-conversation sentiment scoring
- [ ] **Topic modeling** -- Automatic identification of recurring conversation themes
- [ ] **AI conversation simulation** -- Chat with contacts "in their voice" using local LLM

### Phase 5 - Polish & Distribution (Not Started)

- [ ] **Onboarding flow** -- Guide users through Full Disk Access permissions, initial indexing
- [ ] **Settings & preferences** -- Configure theme, privacy controls
- [ ] **Performance optimization** -- Background processing, lazy loading for large databases
- [ ] **Code signing & notarization** -- macOS distribution-ready builds
- [ ] **Auto-updates** -- In-app update mechanism

### Additional Feature Ideas (Unscheduled)

- Hourly heatmap (hour x day-of-week grid)
- Streak tracking (longest consecutive days texting someone)
- Emoji analytics (most used, per contact)
- First/last message milestones per contact
- Year-over-year Wrapped comparison
- Word clouds per conversation
- Keyboard navigation (arrow keys in chat list, shortcuts)
- Smart notifications/milestones

## Non-Goals

- **Sending messages** -- This is a read-only analytics tool. It will never write to Apple's chat.db.
- **Cross-platform** -- macOS only (iMessage is an Apple ecosystem product)
- **Cloud processing** -- All AI/ML runs locally. No message data leaves the device, ever.
- **Real-time sync** -- The app reads a snapshot of the database; it is not a live messaging client.

## Success Metrics

- App launches and reads chat.db within 3 seconds
- Wrapped stats compute in under 10 seconds for all-time queries on large databases
- Relationship metrics compute in under 5 seconds per chat
- App binary size under 50MB (excluding Ollama)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| macOS permission changes break chat.db access | Monitor Apple developer docs; abstract DB access layer for adaptability |
| Large databases (1M+ messages) cause memory issues | Streaming queries, pagination, incremental processing |
| Ollama not installed or models not downloaded | Clear onboarding flow, fallback to non-AI features |
| Apple's attributedBody format changes | Binary parser is isolated; can be updated independently |
| Users concerned about "spyware" perception | Open source, clear privacy documentation, no network calls for data |
