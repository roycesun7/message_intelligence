"use client";

import dayjs from "dayjs";
import type { Message } from "@/types";
import { AttachmentRenderer } from "./attachment-renderer";

// ── Tapback reactions (associated_message_type 2000-2005) ────────
const TAPBACK_MAP: Record<number, string> = {
  2000: "\u2764\uFE0F", // loved
  2001: "\uD83D\uDC4D", // liked
  2002: "\uD83D\uDE06", // laughed
  2003: "\u2049\uFE0F", // emphasized (!! double-bang)
  2004: "\u2753",       // questioned
  2005: "\uD83D\uDC4E", // disliked
};

function isTapback(msg: Message): boolean {
  return msg.associatedMessageType >= 2000 && msg.associatedMessageType <= 2005;
}

// ── Date separator ───────────────────────────────────────────────
const NINETY_MINUTES_MS = 90 * 60 * 1000;

interface MessageBubbleProps {
  message: Message;
  previousMessage: Message | null;
  showSenderName?: boolean;
  tapbacks?: string[];
}

export function MessageBubble({
  message,
  previousMessage,
  showSenderName,
  tapbacks = [],
}: MessageBubbleProps) {
  // Skip tapback reactions — they are rendered as decorations on the target message.
  if (isTapback(message)) return null;

  const isFromMe = message.isFromMe;
  const isIMessage = message.service === "iMessage";

  // Determine whether to show a date separator
  const showDate =
    !previousMessage ||
    message.date - previousMessage.date > NINETY_MINUTES_MS;

  // Grouping: if the previous message was from the same sender and within
  // the 90-min window, suppress extra spacing.
  const isGrouped =
    previousMessage !== null &&
    !showDate &&
    previousMessage.isFromMe === isFromMe &&
    previousMessage.handleId === message.handleId;

  // Bubble colours — Apple's exact colors
  const bubbleBg = isFromMe
    ? isIMessage
      ? "bg-[#007AFF]"
      : "bg-[#34C759]"
    : "bg-[#E8E6E1] dark:bg-[#3A3A3C]";

  const bubbleText = isFromMe ? "text-white" : "text-[#071739] dark:text-zinc-100";

  return (
    <>
      {/* Date separator — pill-shaped, centered */}
      {showDate && (
        <div className="flex items-center justify-center py-3">
          <span className="rounded-full bg-[#071739]/[0.05] dark:bg-white/[0.05] px-3 py-1 text-[11px] font-medium text-[#4B6382] dark:text-zinc-500 apple-text-xs">
            {dayjs(message.date).format("ddd, MMM D, YYYY h:mm A")}
          </span>
        </div>
      )}

      {/* Message row */}
      <div
        className={`flex ${isFromMe ? "justify-end" : "justify-start"} px-3 ${
          isGrouped ? "mt-0.5" : "mt-2"
        }`}
      >
        <div className={`max-w-[75%] flex flex-col ${isFromMe ? "items-end" : "items-start"}`}>
          {/* Sender name (group chats, received only) */}
          {showSenderName && !isFromMe && !isGrouped && message.sender && (
            <span className="mb-0.5 ml-3 text-[11px] text-[#A4B5C4] dark:text-zinc-500 apple-text-xs">
              {message.senderDisplayName || message.sender}
            </span>
          )}

          {/* Attachments (rendered above text bubble for image messages) */}
          {message.cacheHasAttachments && (
            <AttachmentRenderer messageId={message.rowid} />
          )}

          {/* Bubble — only render if there is real text content (not whitespace-only) */}
          {message.text?.trim() ? (
            <div className="relative">
              <div
                className={`rounded-[20px] px-4 py-2 text-sm leading-relaxed ${bubbleBg} ${bubbleText} ${
                  isFromMe ? "rounded-br-[8px]" : "rounded-bl-[8px]"
                }`}
              >
                {message.text}
              </div>
              {tapbacks.length > 0 && (
                <div
                  className={`absolute -top-3 ${isFromMe ? "left-2" : "right-2"} flex gap-0.5 rounded-full bg-[#FAFAF7] dark:bg-[#2C2C2E] px-1.5 py-0.5 text-xs shadow-[0_1px_3px_rgba(0,0,0,0.1)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)] border border-[#CDD5DB]/40 dark:border-white/[0.06]`}
                >
                  {tapbacks.map((emoji, i) => (
                    <span key={i}>{emoji}</span>
                  ))}
                </div>
              )}
            </div>
          ) : !message.cacheHasAttachments ? (
            <div className="relative">
              <div
                className={`rounded-[20px] px-4 py-2 text-sm leading-relaxed ${bubbleBg} ${bubbleText} ${
                  isFromMe ? "rounded-br-[8px]" : "rounded-bl-[8px]"
                }`}
              >
                <span className={isFromMe ? "italic text-white/60" : "italic text-[#4B6382]/60 dark:text-white/60"}>[No text]</span>
              </div>
              {tapbacks.length > 0 && (
                <div
                  className={`absolute -top-3 ${isFromMe ? "left-2" : "right-2"} flex gap-0.5 rounded-full bg-[#FAFAF7] dark:bg-[#2C2C2E] px-1.5 py-0.5 text-xs shadow-[0_1px_3px_rgba(0,0,0,0.1)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)] border border-[#CDD5DB]/40 dark:border-white/[0.06]`}
                >
                  {tapbacks.map((emoji, i) => (
                    <span key={i}>{emoji}</span>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {/* Timestamp — shown at intervals or on hover via group */}
          {!isGrouped && (
            <span className="mt-1 text-[10px] text-[#A4B5C4] dark:text-zinc-600 px-1 apple-text-xs">
              {dayjs(message.date).format("h:mm A")}
            </span>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Build a map of message GUID -> tapback emoji[] in a single pass.
 * O(n) instead of O(n*m) when called per-message.
 */
export function buildTapbackMap(messages: Message[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const m of messages) {
    if (!isTapback(m) || !m.associatedMessageGuid) continue;
    const emoji = TAPBACK_MAP[m.associatedMessageType];
    if (!emoji) continue;
    // associatedMessageGuid may have a prefix like "p:0/" before the target guid
    const targetGuid = m.associatedMessageGuid.replace(/^.*\//, "");
    const existing = map.get(targetGuid);
    if (existing) {
      existing.push(emoji);
    } else {
      map.set(targetGuid, [emoji]);
    }
  }
  return map;
}
