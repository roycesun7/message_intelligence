"use client";

import dayjs from "dayjs";
import type { SemanticSearchResult } from "@/types";
import { useAppStore } from "@/stores/app-store";
import { useChatById, getChatDisplayName } from "@/hooks/use-messages";

interface SearchResultMessageProps {
  result: SemanticSearchResult;
}

// ── Similarity badge ──────────────────────────────────────────────────

function SimilarityBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  return (
    <span
      className={`text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-full shrink-0 ml-2 ${
        pct >= 70
          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          : pct >= 50
            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
      }`}
    >
      {pct}%
    </span>
  );
}

// ── Single message bubble ─────────────────────────────────────────────

function MessageBubble({
  text,
  isFromMe,
}: {
  text: string | null;
  isFromMe: boolean;
}) {
  const bubbleBg = isFromMe
    ? "bg-[#007AFF]"
    : "bg-[#E8E6E1] dark:bg-[#3A3A3C]";

  const bubbleText = isFromMe
    ? "text-white"
    : "text-[#071739] dark:text-zinc-100";

  return (
    <div className={`flex ${isFromMe ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-[20px] px-4 py-2.5 text-sm leading-relaxed ${bubbleBg} ${bubbleText} ${
          isFromMe ? "rounded-br-[8px]" : "rounded-bl-[8px]"
        }`}
      >
        {text?.trim() || (
          <span
            className={
              isFromMe
                ? "italic text-white/60"
                : "italic text-[#4B6382]/60 dark:text-white/60"
            }
          >
            [No text]
          </span>
        )}
      </div>
    </div>
  );
}

// ── Chunk result: grouped conversation thread ─────────────────────────

function ChunkResultCard({ result }: SearchResultMessageProps) {
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const setScrollToMessageDate = useAppStore((s) => s.setScrollToMessageDate);
  const setView = useAppStore((s) => s.setView);

  const chat = useChatById(result.chatId);
  const chatName = getChatDisplayName(chat);

  const handleClick = () => {
    setSelectedChatId(result.chatId);
    setScrollToMessageDate(result.date);
    setView("chat");
  };

  const messages = result.messages ?? [];

  return (
    <button
      onClick={handleClick}
      className="w-full text-left rounded-xl bg-white/60 dark:bg-zinc-900/60 border border-[#CDD5DB]/50 dark:border-zinc-800 p-3 group cursor-pointer hover:bg-white/90 dark:hover:bg-zinc-900/90 transition-colors"
    >
      {/* Header: chat name, date range, score */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold text-[#4B6382] dark:text-zinc-400 truncate">
            {chatName}
          </span>
          <span className="text-[10px] text-[#A4B5C4] dark:text-zinc-500 shrink-0">
            {dayjs(result.date).format("MMM D, YYYY · h:mm A")}
          </span>
          <span className="text-[9px] text-purple-500/60 dark:text-purple-400/50 font-medium shrink-0">
            {messages.length} msgs
          </span>
        </div>
        <SimilarityBadge score={result.score} />
      </div>

      {/* Conversation thread */}
      <div className="flex flex-col gap-1.5">
        {messages.map((msg) => (
          <MessageBubble
            key={msg.rowid}
            text={msg.text}
            isFromMe={msg.isFromMe}
          />
        ))}
      </div>
    </button>
  );
}

// ── Single message result card ────────────────────────────────────────

function SingleResultCard({ result }: SearchResultMessageProps) {
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const setScrollToMessageDate = useAppStore((s) => s.setScrollToMessageDate);
  const setView = useAppStore((s) => s.setView);

  const chat = useChatById(result.chatId);
  const chatName = getChatDisplayName(chat);

  const handleClick = () => {
    setSelectedChatId(result.chatId);
    setScrollToMessageDate(result.date);
    setView("chat");
  };

  const isFromMe = result.isFromMe;

  const senderLabel = isFromMe
    ? `To: ${chatName}`
    : result.senderDisplayName || "Unknown";

  return (
    <button
      onClick={handleClick}
      className="w-full text-left rounded-xl bg-white/60 dark:bg-zinc-900/60 border border-[#CDD5DB]/50 dark:border-zinc-800 p-3 group cursor-pointer hover:bg-white/90 dark:hover:bg-zinc-900/90 transition-colors"
    >
      {/* Top row: sender, date, score */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold text-[#4B6382] dark:text-zinc-400 truncate">
            {senderLabel}
          </span>
          <span className="text-[10px] text-[#A4B5C4] dark:text-zinc-500 shrink-0">
            {dayjs(result.date).format("MMM D, YYYY · h:mm A")}
          </span>
        </div>
        <SimilarityBadge score={result.score} />
      </div>

      {/* Message bubble */}
      <MessageBubble text={result.text} isFromMe={isFromMe} />
    </button>
  );
}

// ── Main export ───────────────────────────────────────────────────────

export function SearchResultMessage({ result }: SearchResultMessageProps) {
  // Chunk results with individual messages → show grouped thread
  if (result.sourceType === "chunk" && result.messages && result.messages.length > 0) {
    return <ChunkResultCard result={result} />;
  }

  // Single message or chunk without individual messages → show single bubble
  return <SingleResultCard result={result} />;
}
