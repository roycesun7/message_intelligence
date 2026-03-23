# Capsule

Privacy-first iMessage analytics for macOS. Your messages, your machine, your insights — no data ever leaves your device.

Capsule reads your iMessage history directly from Apple's `chat.db` in **read-only mode** and surfaces insights across all your conversations. Everything is computed locally — no servers, no accounts, no data collection.

## Features

- **Chat viewer** — browse conversations with contact resolution, tapback reactions, inline image attachments, and fuzzy search
- **Analytics dashboard** — message counts, activity heatmaps, top conversations, temporal trends, word frequency, emoji usage, and texting personality profiling (global and per-chat)
- **Relationship intelligence** — response times, initiation ratios, message length patterns, active hours overlap, and week-by-week timelines
- **Group chat dynamics** — per-participant stats, MVP cards, and contribution breakdowns
- **On This Day** — revisit messages from today's date across past years
- **Light & dark mode** — full Apple-native theming

## Getting Started

### Requirements

- **macOS 12+**
- **Full Disk Access** permission (System Settings > Privacy & Security)
- Rust toolchain (`rustup`)
- Node.js 18+

### Development

```bash
npm install
npx tauri dev
```

## Privacy

- **Read-only** — chat.db opened with `SQLITE_OPEN_READ_ONLY`; the app cannot modify your messages
- **Fully local** — no servers, no accounts, no network requests for message data
- **No telemetry** — no analytics, crash reporting, or data collection of any kind

## License

MIT
