"use client";

import { useEffect, useRef, useMemo, useCallback, useState } from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import { Virtuoso } from "react-virtuoso";
import { Loader2, ChevronDown } from "lucide-react";

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
  const [isAtBottom, setIsAtBottom] = useState(true);

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

  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    setIsAtBottom(atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    // Instant jump first to get close, then smooth to land precisely
    virtuosoRef.current?.scrollToIndex({
      index: visibleMessages.length - 1,
      align: "end",
      behavior: "auto",
    });
    setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({
        index: visibleMessages.length - 1,
        align: "end",
        behavior: "smooth",
      });
    }, 100);
  }, [visibleMessages.length]);

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
    <div className="absolute inset-0 bg-[#ECEEF2] dark:bg-[#1C1C1E]">
      {/* Header — floats over messages so content scrolls behind the blur */}
      <div className="absolute top-0 left-0 right-[10px] flex h-14 items-center justify-center backdrop-blur-[1px] bg-[#ECEEF2]/15 dark:bg-[#1C1C1E]/15 saturate-[1.2] dark:saturate-[1.8] border-b border-[#D1D5DB]/15 dark:border-white/[0.04] px-5 z-20 pointer-events-none">
        <div className="flex items-center rounded-full bg-[#ECEEF2]/90 dark:bg-[#1C1C1E]/90 backdrop-blur-md px-4 py-1 pointer-events-auto">
          <h2 className="truncate text-[15px] font-semibold text-[#1B2432] dark:text-zinc-100 apple-text-sm">
            {chatName}
          </h2>
          {isGroupChat && chat && (
            <span className="ml-2 text-xs text-[#94A3B3] dark:text-zinc-500 apple-text-xs">
              {chat.participants.length} members
            </span>
          )}
        </div>
      </div>

      {/* Loading bar */}
      {isLoading && (
        <div className="absolute top-14 left-0 right-0 h-[2px] overflow-hidden bg-[#D1D5DB]/30 dark:bg-white/[0.04] z-20">
          <div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] rounded-full bg-[#3B82C4] dark:bg-[#60A5FA]" />
        </div>
      )}

      {/* Messages — full height, top padding so first messages clear the header */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 overflow-hidden">
          <Virtuoso
            ref={virtuosoRef}
            totalCount={visibleMessages.length}
            itemContent={itemContent}
            initialTopMostItemIndex={Math.max(0, visibleMessages.length - 1)}
            followOutput="auto"
            atBottomStateChange={handleAtBottomChange}
            atBottomThreshold={100}
            defaultItemHeight={44}
            increaseViewportBy={800}
            overscan={200}
            className="chat-scrollbar"
            style={{ height: "100%", width: "100%" }}
            components={{
              Header: () => <div className="pt-16" />,
              Footer: () => <div className="pb-4" />,
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

      {/* Scroll to bottom button */}
      {!isAtBottom && visibleMessages.length > 0 && !isLoading && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-[#F7F8FA]/90 dark:bg-[#2A2A2C]/90 backdrop-blur-md border border-[#D1D5DB]/30 dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.1)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.4)] hover:bg-[#ECEEF2] dark:hover:bg-[#3A3A3C] transition-colors cursor-pointer"
        >
          <ChevronDown className="h-5 w-5 text-[#4E5D6E] dark:text-zinc-300" />
        </button>
      )}

    </div>
  );
}
