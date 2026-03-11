"use client";

import dayjs from "dayjs";
import type { Message } from "@/types";

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
}

export function MessageBubble({
  message,
  previousMessage,
  showSenderName,
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

  // Bubble colours
  const bubbleBg = isFromMe
    ? isIMessage
      ? "bg-blue-500"
      : "bg-green-600"
    : "bg-zinc-700";

  const bubbleText = isFromMe ? "text-white" : "text-zinc-100";

  return (
    <>
      {/* Date separator */}
      {showDate && (
        <div className="flex items-center justify-center py-3">
          <span className="text-[11px] font-medium text-zinc-500">
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
            <span className="mb-0.5 ml-3 text-[11px] text-zinc-500">
              {message.sender}
            </span>
          )}

          {/* Bubble */}
          <div
            className={`relative rounded-2xl px-3 py-1.5 text-sm leading-relaxed ${bubbleBg} ${bubbleText} ${
              isFromMe
                ? isGrouped
                  ? "rounded-br-md"
                  : "rounded-br-md"
                : isGrouped
                ? "rounded-bl-md"
                : "rounded-bl-md"
            }`}
          >
            {message.text ?? (
              <span className="italic text-zinc-400">
                {message.cacheHasAttachments ? "[Attachment]" : "[No text]"}
              </span>
            )}
          </div>

          {/* Timestamp — shown at intervals or on hover via group */}
          {!isGrouped && (
            <span className="mt-0.5 text-[10px] text-zinc-600 px-1">
              {dayjs(message.date).format("h:mm A")}
            </span>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Collect tapback reactions for a given message from the surrounding messages.
 * (Utility — can be used by the parent to decorate bubbles.)
 */
export function collectTapbacks(
  targetGuid: string,
  messages: Message[]
): string[] {
  return messages
    .filter(
      (m) =>
        isTapback(m) &&
        m.associatedMessageGuid?.includes(targetGuid)
    )
    .map((m) => TAPBACK_MAP[m.associatedMessageType] ?? "")
    .filter(Boolean);
}
