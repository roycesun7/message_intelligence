"use client";

import { useEffect, useRef, useMemo, useCallback } from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import { Virtuoso } from "react-virtuoso";
import { Loader2 } from "lucide-react";

import { useMessages, useChatById, getChatDisplayName } from "@/hooks/use-messages";
import { useAppStore } from "@/stores/app-store";
import { MessageBubble, buildTapbackMap } from "./message-bubble";

export function ChatView() {
  const chatId = useAppStore((s) => s.selectedChatId);
  const scrollToMessageDate = useAppStore((s) => s.scrollToMessageDate);
  const setScrollToMessageDate = useAppStore((s) => s.setScrollToMessageDate);
  const highlightedMessageDate = useAppStore((s) => s.highlightedMessageDate);
  const setHighlightedMessageDate = useAppStore((s) => s.setHighlightedMessageDate);
  const chat = useChatById(chatId);
  const { data: messages, isLoading, isError, error } = useMessages(chatId);
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // Use a ref (not state) to track pending scroll so we don't cause re-renders
  const pendingScrollRef = useRef<number | null>(null);

  const isGroupChat = chat ? chat.style === 43 : false;
  const chatName = getChatDisplayName(chat);

  const tapbackMap = useMemo(() => {
    if (!messages) return new Map<string, string[]>();
    return buildTapbackMap(messages);
  }, [messages]);

  const visibleMessages = useMemo(() => {
    if (!messages) return [];
    return messages.filter(
      (m) => m.associatedMessageType < 2000 || m.associatedMessageType > 2005
    );
  }, [messages]);

  // Capture scroll target from store into ref immediately
  useEffect(() => {
    if (scrollToMessageDate !== null) {
      pendingScrollRef.current = scrollToMessageDate;
      setScrollToMessageDate(null);
    }
  }, [scrollToMessageDate, setScrollToMessageDate]);

  // Scroll to bottom on chat change — but only if no pending scroll target
  useEffect(() => {
    if (pendingScrollRef.current !== null) return;
    if (virtuosoRef.current && visibleMessages.length > 0) {
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({
          index: visibleMessages.length - 1,
          align: "end",
          behavior: "auto",
        });
      });
    }
  }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When messages load (or change) and we have a pending scroll, execute it.
  useEffect(() => {
    if (pendingScrollRef.current === null || visibleMessages.length === 0) return;

    const targetDate = pendingScrollRef.current;

    // Find the message closest to the target date
    let closestIndex = 0;
    let closestDiff = Infinity;
    for (let i = 0; i < visibleMessages.length; i++) {
      const diff = Math.abs(visibleMessages[i].date - targetDate);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIndex = i;
      }
    }

    // Clear the pending scroll immediately so we don't re-fire
    pendingScrollRef.current = null;

    // Highlight the matched message
    const matchedDate = visibleMessages[closestIndex].date;
    setHighlightedMessageDate(matchedDate);

    // Give Virtuoso enough time to fully render the list, then scroll.
    // We use two staggered scrolls: first an instant jump to get close,
    // then a smooth scroll to center precisely.
    const jumpTimer = setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({
        index: closestIndex,
        align: "center",
        behavior: "auto",
      });
    }, 100);

    const smoothTimer = setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({
        index: closestIndex,
        align: "center",
        behavior: "smooth",
      });
    }, 350);

    // Auto-clear highlight after 3 seconds
    const highlightTimer = setTimeout(() => setHighlightedMessageDate(null), 3000);

    return () => {
      clearTimeout(jumpTimer);
      clearTimeout(smoothTimer);
      clearTimeout(highlightTimer);
    };
  }, [visibleMessages, setHighlightedMessageDate]);

  const itemContent = useCallback(
    (index: number) => {
      const msg = visibleMessages[index];
      const prev = index > 0 ? visibleMessages[index - 1] : null;
      const tapbacks = tapbackMap.get(msg.guid) ?? [];
      const isHighlighted = highlightedMessageDate !== null && msg.date === highlightedMessageDate;
      return (
        <MessageBubble
          message={msg}
          previousMessage={prev}
          showSenderName={isGroupChat}
          tapbacks={tapbacks}
          highlighted={isHighlighted}
        />
      );
    },
    [visibleMessages, tapbackMap, isGroupChat, highlightedMessageDate]
  );

  // Empty state — after all hooks
  if (chatId === null) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#ECEEF2] dark:bg-[#1C1C1E] text-[#94A3B3] dark:text-zinc-600">
        <p className="text-lg apple-text-sm">Select a conversation to start</p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-[#ECEEF2] dark:bg-[#1C1C1E]">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center bg-[#F7F8FA] dark:bg-[#1C1C1E]/80 dark:backdrop-blur-xl dark:saturate-[1.8] border-b border-[#D1D5DB]/40 dark:border-white/[0.06] shadow-[0_1px_4px_rgba(0,0,0,0.04)] dark:shadow-[0_1px_6px_rgba(0,0,0,0.2)] px-5 relative z-10">
        <h2 className="truncate text-[15px] font-semibold text-[#1B2432] dark:text-zinc-100 apple-text-sm">
          {chatName}
        </h2>
        {isGroupChat && chat && (
          <span className="ml-2 text-xs text-[#94A3B3] dark:text-zinc-500 apple-text-xs">
            {chat.participants.length} members
          </span>
        )}
      </div>

      {/* Loading bar */}
      {isLoading && (
        <div className="h-[2px] w-full overflow-hidden bg-[#D1D5DB]/30 dark:bg-white/[0.04]">
          <div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] rounded-full bg-[#3B82C4] dark:bg-[#60A5FA]" />
        </div>
      )}

      {/* Messages */}
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 overflow-hidden">
          <Virtuoso
            ref={virtuosoRef}
            totalCount={visibleMessages.length}
            itemContent={itemContent}
            initialTopMostItemIndex={Math.max(0, visibleMessages.length - 1)}
            followOutput="auto"
            defaultItemHeight={44}
            increaseViewportBy={800}
            overscan={200}
            style={{ height: "100%", width: "100%" }}
            components={{
              Header: () => <div className="pt-3" />,
              Footer: () => <div className="pb-16" />,
            }}
          />
        </div>
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#ECEEF2] dark:bg-[#1C1C1E]">
            <Loader2 className="h-6 w-6 animate-spin text-[#94A3B3] dark:text-zinc-500" />
            <p className="text-sm text-[#94A3B3] dark:text-zinc-500 apple-text-sm">Loading messages...</p>
          </div>
        )}
        {!isLoading && isError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm bg-[#ECEEF2] dark:bg-[#1C1C1E]">
            <p className="text-red-500 dark:text-red-400">Failed to load messages</p>
            <p className="text-[#94A3B3] dark:text-zinc-600 text-xs max-w-md text-center">{String(error)}</p>
          </div>
        )}
        {!isLoading && !isError && visibleMessages.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[#94A3B3] dark:text-zinc-500 bg-[#ECEEF2] dark:bg-[#1C1C1E]">
            No messages in this chat.
          </div>
        )}
      </div>

      {/* Fixed iMessage bar at bottom */}
      <div className="shrink-0 flex items-center justify-center px-4 py-2 bg-[#ECEEF2] dark:bg-[#1C1C1E] border-t border-[#D1D5DB]/40 dark:border-white/[0.06]">
        <div className="flex h-10 w-full max-w-2xl items-center rounded-full bg-[#1B2432]/[0.04] dark:bg-white/[0.06] border border-[#D1D5DB]/40 dark:border-white/[0.06] px-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.2)]">
          <span className="text-sm text-[#94A3B3] dark:text-zinc-600 apple-text-sm">iMessage</span>
        </div>
      </div>
    </div>
  );
}
