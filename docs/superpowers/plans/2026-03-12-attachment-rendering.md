# Attachment Rendering Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display images, stickers, and file attachments inline in the chat view instead of the `[Attachment]` placeholder.

**Architecture:** A new Rust command reads attachment files from `~/Library/Messages/Attachments/`, base64-encodes image data, and returns it alongside metadata. The frontend lazy-loads attachment data only for visible messages (via Virtuoso virtualization + React Query), rendering images inline and showing file cards for non-image types. Image-only messages render without a bubble background; messages with both text and images show the image above the text.

**Tech Stack:** Rust (Tauri commands, rusqlite, base64), React (components, hooks), React Query (caching), TypeScript

---

## File Structure


| Action | Path                                            | Responsibility                                                                   |
| ------ | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| Create | `src-tauri/src/commands/attachments.rs`         | Rust command to read attachment files, base64-encode, and return data + metadata |
| Modify | `src-tauri/src/commands/mod.rs`                 | Add `pub mod attachments;`                                                       |
| Modify | `src-tauri/src/lib.rs:97-121`                   | Register new `get_attachment_data` command                                       |
| Modify | `src-tauri/Cargo.toml`                          | Add `base64` crate dependency                                                    |
| Modify | `src/types/index.ts:47-58`                      | Add `AttachmentData` type                                                        |
| Modify | `src/lib/commands.ts`                           | Add `getAttachmentData` wrapper                                                  |
| Modify | `src/hooks/use-messages.ts`                     | Add `useAttachmentData` hook                                                     |
| Create | `src/components/chat/attachment-renderer.tsx`   | Component to render images/stickers/file cards                                   |
| Modify | `src/components/chat/message-bubble.tsx:98-103` | Replace `[Attachment]` with `AttachmentRenderer`                                 |


---

## Chunk 1: Backend — Rust attachment data command

### Task 1: Add base64 dependency

**Files:**

- Modify: `src-tauri/Cargo.toml`
- **Step 1: Add base64 crate to Cargo.toml**

Add `base64` under `[dependencies]` in `src-tauri/Cargo.toml`:

```toml
base64 = "0.22"
```

Add it after the existing `url = "2"` line.

- **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: `Finished` with no errors (warnings OK)

- **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: add base64 crate for attachment encoding"
```

---

### Task 2: Create the attachment data command

**Files:**

- Create: `src-tauri/src/commands/attachments.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Context:** The iMessage database stores attachment file paths in the `attachment.filename` column using `~` as the home dir placeholder (e.g., `~/Library/Messages/Attachments/ab/12/GUID/photo.jpg`). The command must expand `~`, read the file, and base64-encode it for image types. Non-image attachments return metadata only.

- **Step 1: Create `src-tauri/src/commands/attachments.rs`**

```rust
use base64::Engine;
use serde::Serialize;
use tauri::State;

use crate::db::chat_db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Attachment data returned to the frontend.
/// For image types, `data_url` contains a base64-encoded data URL.
/// For other types, `data_url` is None — only metadata is returned.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentData {
    pub rowid: i64,
    pub guid: String,
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub uti: Option<String>,
    pub transfer_name: Option<String>,
    pub total_bytes: i64,
    pub is_outgoing: bool,
    /// base64-encoded data URL (e.g. "data:image/jpeg;base64,...") for image attachments.
    /// None for non-image types or if the file cannot be read.
    pub data_url: Option<String>,
}

/// Maximum file size we'll base64-encode (10 MB).
const MAX_IMAGE_SIZE: u64 = 10 * 1024 * 1024;

/// MIME types we treat as inline-renderable images.
/// Note: HEIC/HEIF excluded — base64 data URLs for these formats are not
/// reliably rendered by WebKit's <img> element. They'll show as file cards.
fn is_image_mime(mime: &str) -> bool {
    matches!(
        mime,
        "image/jpeg"
            | "image/png"
            | "image/gif"
            | "image/webp"
            | "image/tiff"
            | "image/bmp"
    )
}

/// Expand `~` at the start of a path to the user's home directory.
fn expand_tilde(path: &str) -> Option<std::path::PathBuf> {
    if let Some(rest) = path.strip_prefix("~/") {
        dirs::home_dir().map(|home| home.join(rest))
    } else if path == "~" {
        dirs::home_dir()
    } else {
        Some(std::path::PathBuf::from(path))
    }
}

/// Read an attachment file and base64-encode it as a data URL.
fn read_image_as_data_url(filename: &str, mime_type: &str) -> Option<String> {
    let path = expand_tilde(filename)?;

    if !path.exists() {
        log::debug!("Attachment file not found: {}", path.display());
        return None;
    }

    let metadata = std::fs::metadata(&path).ok()?;
    if metadata.len() > MAX_IMAGE_SIZE {
        log::debug!(
            "Attachment too large to inline ({} bytes): {}",
            metadata.len(),
            path.display()
        );
        return None;
    }

    let bytes = std::fs::read(&path).ok()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{};base64,{}", mime_type, b64))
}

/// Fetch attachment data for a given message.
/// Images are base64-encoded and returned as data URLs.
/// Non-image attachments return metadata only.
#[tauri::command]
pub fn get_attachment_data(
    state: State<'_, AppState>,
    message_id: i64,
) -> AppResult<Vec<AttachmentData>> {
    let conn = state
        .chat_db
        .lock()
        .map_err(|e| AppError::Custom(e.to_string()))?;

    let attachments = chat_db::get_attachments_for_message(&conn, message_id)?;

    let results: Vec<AttachmentData> = attachments
        .into_iter()
        .map(|a| {
            let data_url = match (&a.filename, &a.mime_type) {
                (Some(fname), Some(mime)) if is_image_mime(mime) => {
                    read_image_as_data_url(fname, mime)
                }
                _ => None,
            };

            AttachmentData {
                rowid: a.rowid,
                guid: a.guid,
                filename: a.filename,
                mime_type: a.mime_type,
                uti: a.uti,
                transfer_name: a.transfer_name,
                total_bytes: a.total_bytes,
                is_outgoing: a.is_outgoing,
                data_url,
            }
        })
        .collect();

    Ok(results)
}
```

- **Step 2: Add module declaration to `src-tauri/src/commands/mod.rs`**

Add this line alongside the existing module declarations:

```rust
pub mod attachments;
```

- **Step 3: Register the command in `src-tauri/src/lib.rs`**

In the `invoke_handler(tauri::generate_handler![...])` block (around line 97), add after `commands::messages::get_message_count,`:

```rust
            commands::attachments::get_attachment_data,
```

- **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: `Finished` with no errors

- **Step 5: Commit**

```bash
git add src-tauri/src/commands/attachments.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add get_attachment_data command for reading attachment files"
```

---

## Chunk 2: Frontend — Types, hooks, and rendering

### Task 3: Add frontend types and command wrapper

**Files:**

- Modify: `src/types/index.ts`
- Modify: `src/lib/commands.ts`
- **Step 1: Add `AttachmentData` type to `src/types/index.ts`**

Add after the existing `Attachment` interface (after line 58):

```typescript
/** Attachment with optional inline data URL (images are base64-encoded) */
export interface AttachmentData {
  rowid: number;
  guid: string;
  filename: string | null;
  mimeType: string | null;
  uti: string | null;
  transferName: string | null;
  totalBytes: number;
  isOutgoing: boolean;
  /** data:image/...;base64,... for image attachments, null otherwise */
  dataUrl: string | null;
}
```

- **Step 2: Add command wrapper to `src/lib/commands.ts`**

Add the import of `AttachmentData` to the existing import block:

```typescript
import type {
  // ... existing imports ...
  AttachmentData,
} from "@/types";
```

Add the command wrapper after the existing `getMessageAttachments` function (after line 35):

```typescript
/** Fetch attachment data (with base64 image data) for a given message. */
export const getAttachmentData = (messageId: number) =>
  invoke<AttachmentData[]>("get_attachment_data", { messageId });
```

- **Step 3: Commit**

```bash
git add src/types/index.ts src/lib/commands.ts
git commit -m "feat: add AttachmentData type and command wrapper"
```

---

### Task 4: Add useAttachmentData hook

**Files:**

- Modify: `src/hooks/use-messages.ts`
- **Step 1: Add `useAttachmentData` hook to `src/hooks/use-messages.ts`**

Add the import of `getAttachmentData` to the existing imports from `@/lib/commands`:

```typescript
import { getChats, getMessages, getMessageCount, getAttachmentData } from "@/lib/commands";
```

Add the import of `AttachmentData` to imports from `@/types` (add to existing import if present, or add new):

```typescript
import type { Chat, AttachmentData } from "@/types";
```

Add the hook after the existing `useMessages` hook:

```typescript
/** Fetch attachment data for a message. Only runs when messageId is provided. */
export const useAttachmentData = (messageId: number | null) => {
  return useQuery<AttachmentData[]>({
    queryKey: ["attachmentData", messageId],
    queryFn: () => getAttachmentData(messageId!),
    enabled: messageId !== null,
    staleTime: 30 * 60_000, // 30-minute cache — attachment files don't change
  });
};
```

- **Step 2: Commit**

```bash
git add src/hooks/use-messages.ts
git commit -m "feat: add useAttachmentData hook"
```

---

### Task 5: Create AttachmentRenderer component

**Files:**

- Create: `src/components/chat/attachment-renderer.tsx`

**Context:** This component receives a message ID and renders its attachments. Images/stickers are shown as `<img>` tags. Non-image files show a card with filename and size. The component manages its own data fetching via the `useAttachmentData` hook.

- **Step 1: Create `src/components/chat/attachment-renderer.tsx`**

```tsx
"use client";

import { useAttachmentData } from "@/hooks/use-messages";
import type { AttachmentData } from "@/types";

interface AttachmentRendererProps {
  messageId: number;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ImageAttachment({ attachment }: { attachment: AttachmentData }) {
  if (!attachment.dataUrl) return null;

  return (
    <img
      src={attachment.dataUrl}
      alt={attachment.transferName ?? "Image"}
      className="max-w-full rounded-[16px] object-contain"
      style={{ maxHeight: 300 }}
      loading="lazy"
    />
  );
}

function FileAttachment({ attachment }: { attachment: AttachmentData }) {
  const name = attachment.transferName ?? attachment.filename?.split("/").pop() ?? "File";
  const size = attachment.totalBytes > 0 ? formatFileSize(attachment.totalBytes) : "";
  const ext = name.split(".").pop()?.toUpperCase() ?? "";

  return (
    <div className="flex items-center gap-2.5 rounded-[14px] bg-white/[0.08] px-3 py-2.5 min-w-[180px]">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.1] text-[11px] font-semibold text-zinc-400">
        {ext}
      </div>
      <div className="flex flex-col overflow-hidden">
        <span className="truncate text-[13px] text-zinc-200">{name}</span>
        {size && <span className="text-[11px] text-zinc-500">{size}</span>}
      </div>
    </div>
  );
}

export function AttachmentRenderer({ messageId }: AttachmentRendererProps) {
  const { data: attachments, isLoading } = useAttachmentData(messageId);

  if (isLoading || !attachments || attachments.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {attachments.map((att) => {
        if (att.dataUrl) {
          return <ImageAttachment key={att.rowid} attachment={att} />;
        }
        // Skip attachments where mime_type starts with "image/" but data_url is null
        // (file not found or too large) — show file card instead
        return <FileAttachment key={att.rowid} attachment={att} />;
      })}
    </div>
  );
}
```

- **Step 2: Commit**

```bash
git add src/components/chat/attachment-renderer.tsx
git commit -m "feat: add AttachmentRenderer component for inline images and file cards"
```

---

### Task 6: Integrate attachments into MessageBubble

**Files:**

- Modify: `src/components/chat/message-bubble.tsx`

**Context:** Replace the `[Attachment]` placeholder text with the `AttachmentRenderer` component. For image-only messages (no text, only attachment), render the image WITHOUT the bubble background. For messages with both text and attachments, render the image above the text bubble.

- **Step 1: Add AttachmentRenderer import**

Add to the top of `src/components/chat/message-bubble.tsx`:

```typescript
import { AttachmentRenderer } from "./attachment-renderer";
```

- **Step 2: Replace the bubble content section**

Replace lines 87-104 (the `{/* Bubble */}` section) with:

```tsx
          {/* Attachments (rendered above text bubble for image messages) */}
          {message.cacheHasAttachments && (
            <AttachmentRenderer messageId={message.rowid} />
          )}

          {/* Bubble — only render if there is text content */}
          {message.text ? (
            <div
              className={`relative rounded-[20px] px-4 py-2 text-sm leading-relaxed ${bubbleBg} ${bubbleText} ${
                isFromMe ? "rounded-br-[8px]" : "rounded-bl-[8px]"
              }`}
            >
              {message.text}
            </div>
          ) : !message.cacheHasAttachments ? (
            <div
              className={`relative rounded-[20px] px-4 py-2 text-sm leading-relaxed ${bubbleBg} ${bubbleText} ${
                isFromMe ? "rounded-br-[8px]" : "rounded-bl-[8px]"
              }`}
            >
              <span className="italic text-white/60">[No text]</span>
            </div>
          ) : null}
```

This replaces the old bubble block that included the `[Attachment]` fallback. Now:

- If a message has attachments → renders the `AttachmentRenderer` (images/file cards)
- If a message has text → renders the text bubble below the attachments
- If a message has neither text nor attachments → renders `[No text]` fallback
- If a message has only attachments (no text) → renders just the attachment, no empty bubble
- **Step 3: Verify the app runs**

Run: `npx tauri dev`
Expected: App launches, navigate to a conversation with images/stickers. Attachments should render as inline images instead of `[Attachment]`.

- **Step 4: Commit**

```bash
git add src/components/chat/message-bubble.tsx
git commit -m "feat: render inline images and file attachments in message bubbles"
```

---

## Post-implementation notes

**Performance considerations:**

- Attachments are lazy-loaded per-message only when visible (Virtuoso handles this)
- React Query caches attachment data for 30 minutes — scrolling back won't re-fetch
- Files larger than 10MB are skipped (metadata-only, shown as file card)
- Base64 encoding adds ~33% memory overhead; for a future optimization, consider Tauri's asset protocol (`convertFileSrc`) which avoids encoding entirely

**Known limitations:**

- HEIC/HEIF images are shown as file cards because base64 data URLs for these formats are not reliably rendered by WebKit's `<img>` element. A future optimization using Tauri's asset protocol (`convertFileSrc`) would enable native HEIC rendering.
- Video attachments (`video/quicktime`, `video/mp4`) are shown as file cards — inline video playback is a separate feature
- Audio messages are shown as file cards — inline audio playback is a separate feature
- iCloud-only attachments (not downloaded locally) will show as file cards

