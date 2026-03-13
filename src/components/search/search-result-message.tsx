"use client";

import dayjs from "dayjs";
import type { SemanticSearchResult } from "@/types";
import { useAppStore } from "@/stores/app-store";
import { useChatById, getChatDisplayName } from "@/hooks/use-messages";

interface SearchResultMessageProps {
  result: SemanticSearchResult;
}

export function SearchResultMessage({ result }: SearchResultMessageProps) {
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

  // Sender label: for sent messages show "To: [chat name]", for received show sender name
  const senderLabel = isFromMe
    ? `To: ${chatName}`
    : result.senderDisplayName || "Unknown";

  const bubbleBg = isFromMe
    ? "bg-[#007AFF]"
    : "bg-[#E8E6E1] dark:bg-[#3A3A3C]";

  const bubbleText = isFromMe
    ? "text-white"
    : "text-[#071739] dark:text-zinc-100";

  return (
    <button
      onClick={handleClick}
      className={`w-full text-left flex ${
        isFromMe ? "justify-end" : "justify-start"
      } group cursor-pointer`}
    >
      <div
        className={`max-w-[85%] flex flex-col ${
          isFromMe ? "items-end" : "items-start"
        }`}
      >
        {/* Header: sender + date */}
        <div
          className={`flex w-full items-center gap-2 mb-1 px-1 ${
            isFromMe ? "justify-end" : "justify-start"
          }`}
        >
          <span className="text-[11px] font-medium text-[#4B6382] dark:text-zinc-400 truncate">
            {senderLabel}
          </span>
          <span className="text-[10px] text-[#A4B5C4] dark:text-zinc-500 shrink-0">
            {dayjs(result.date).format("MMM D, YYYY")}
          </span>
        </div>

        {/* Bubble */}
        <div
          className={`rounded-[20px] px-4 py-2.5 text-sm leading-relaxed ${bubbleBg} ${bubbleText} ${
            isFromMe ? "rounded-br-[8px]" : "rounded-bl-[8px]"
          } transition-opacity group-hover:opacity-85`}
        >
          {result.text?.trim() || (
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

        {/* Timestamp */}
        <span className="mt-1 text-[10px] text-[#A4B5C4] dark:text-zinc-600 px-1">
          {dayjs(result.date).format("h:mm A")}
        </span>
      </div>
    </button>
  );
}
