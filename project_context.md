# Message Intelligence - Project Context & PRD

## Vision

Message Intelligence is a privacy-first, AI-powered desktop application for macOS that transforms your iMessage history into a rich, searchable, and analytically powerful experience. It builds on the foundation laid by [mimessage](https://github.com/jonluca/mimessage) -- a read-only iMessage viewer with search, export, and "Wrapped" statistics -- and extends it with deep AI-driven analysis, semantic search, relationship insights, and interactive exploration capabilities.

All processing happens locally on the user's machine. No message data ever leaves the device.

## Inspiration: mimessage

MiMessage (by JonLuca DeCaro) is an Electron + Next.js desktop app that provides:

- **Conversation viewer** -- Browse and read iMessage/SMS conversations with contact name resolution
- **Full-text & semantic search** -- FTS5-based keyword search plus OpenAI embedding-powered semantic search (e.g., "that restaurant recommendation from last summer")
- **Filters** -- Refine results by date range, participant, and chat
- **"iMessage Wrapped"** -- Spotify Wrapped-style analytics: message counts by year/month/weekday, top conversations, late-night texting patterns, popular openers
- **Media & conversation export** -- Bulk export images/videos/attachments; export conversations as TXT, JSON, or CSV
- **AI conversation simulation** -- Chat with historical contacts "in their voice" using OpenAI

### Where Message Intelligence Diverges

| Aspect | mimessage | Message Intelligence |
|--------|-----------|---------------------|
| **Framework** | Electron (JS/TS everywhere) | Tauri v2 (Rust backend, React frontend) |
| **Performance** | Node.js SQLite bindings | Native Rust with rusqlite -- significantly faster for large databases |
| **AI provider** | OpenAI API (cloud) | Ollama (local) -- fully offline, zero data exfiltration |
| **Privacy model** | Messages sent to OpenAI for embeddings | All AI processing on-device |
| **App size** | ~200MB+ (Electron) | ~15-30MB (Tauri) |
| **Scope** | Viewer + search + export + stats | Full analytical platform with relationship intelligence, sentiment tracking, topic modeling, and more |

## Target User

- macOS users who are curious about their messaging patterns
- People who want to search their message history intelligently (by meaning, not just keywords)
- Users who value privacy and want AI features without cloud dependencies
- Anyone interested in relationship analytics and communication insights

## Core Features

### Phase 1 - Foundation (Implemented)

- [x] **Chat viewer** -- Browse all conversations sorted by recency, with contact name resolution from macOS Address Book
- [x] **Message rendering** -- Display messages with tapback reactions, temporal grouping, date separators, and group/DM differentiation
- [x] **Chat search** -- Filter conversation list by name, identifier, or participant
- [x] **Wrapped analytics** -- Year-selectable dashboard with:
  - Total/sent/received message counts
  - Top 10 conversations with percentage bars
  - Messages by month (bar chart)
  - Messages by day of week
  - Late-night texters (10 PM - 5 AM)
  - Most popular conversation openers
  - Cached results for performance

### Phase 2 - AI & Search

- [ ] **Local embeddings pipeline** -- Ollama-powered embedding generation for all messages, processed incrementally in background
- [ ] **Semantic search** -- "Find messages about..." natural language queries using vector similarity
- [ ] **Full-text search** -- Fast keyword/phrase search across all conversations
- [ ] **Sentiment analysis** -- Per-message and per-conversation sentiment scoring, tracked over time
- [ ] **Topic modeling** -- Automatic identification of recurring conversation themes

### Phase 3 - Relationship Intelligence

- [ ] **Relationship metrics** -- Response time patterns, conversation initiation ratios, messaging frequency trends
- [ ] **Communication style analysis** -- Vocabulary richness, emoji usage, message length patterns per contact
- [ ] **Conversation health indicators** -- Sentiment trends, engagement levels, reciprocity scores
- [ ] **Contact profiles** -- Aggregated analytics page per contact/conversation

### Phase 4 - Enhanced Experience

- [ ] **Media gallery** -- Browse and search photos/videos/attachments shared in conversations
- [ ] **Link extraction & preview** -- Catalog of all shared links with metadata
- [ ] **Export capabilities** -- Conversation export in TXT, JSON, CSV formats
- [ ] **Advanced Wrapped** -- More detailed and interactive annual/all-time statistics
- [ ] **AI conversation simulation** -- Chat with contacts "in their voice" using local LLM
- [ ] **Smart notifications** -- Surface interesting patterns and milestones (e.g., "You and Alex have been texting for 5 years today")

### Phase 5 - Polish & Distribution

- [ ] **Onboarding flow** -- Guide users through Full Disk Access permissions, initial database indexing
- [ ] **Settings & preferences** -- Configure AI model, theme, privacy controls
- [ ] **Performance optimization** -- Background processing, lazy loading for large databases (100K+ messages)
- [ ] **Code signing & notarization** -- macOS distribution-ready builds
- [ ] **Auto-updates** -- In-app update mechanism

## Non-Goals

- **Sending messages** -- This is a read-only analytics tool. It will never write to Apple's chat.db.
- **Cross-platform** -- macOS only (iMessage is an Apple ecosystem product)
- **Cloud processing** -- All AI/ML runs locally. No message data leaves the device, ever.
- **Real-time sync** -- The app reads a snapshot of the database; it is not a live messaging client.

## Success Metrics

- App launches and reads chat.db within 3 seconds
- Semantic search returns relevant results in under 2 seconds
- Wrapped stats compute in under 5 seconds for databases with 500K+ messages
- Embedding pipeline processes 10K messages/minute on Apple Silicon
- App binary size under 50MB (excluding Ollama)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| macOS permission changes break chat.db access | Monitor Apple developer docs; abstract DB access layer for adaptability |
| Large databases (1M+ messages) cause memory issues | Streaming queries, pagination, incremental processing |
| Ollama not installed or models not downloaded | Clear onboarding flow, fallback to non-AI features |
| Apple's attributedBody format changes | Binary parser is isolated; can be updated independently |
| Users concerned about "spyware" perception | Open source, clear privacy documentation, no network calls for data |
