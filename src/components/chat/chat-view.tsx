"use client";

import { useEffect, useRef, useMemo, useCallback, useState, useDeferredValue } from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import { Virtuoso } from "react-virtuoso";
import { ChevronDown } from "lucide-react";

import { useMessages, useChatById, getChatDisplayName } from "@/hooks/use-messages";
import { useAppStore } from "@/stores/app-store";
import { MessageBubble, buildTapbackMap } from "./message-bubble";

export function ChatView() {
  const chatId = useAppStore((s) => s.selectedChatId);
  const scrollToMessageDate = useAppStore((s) => s.scrollToMessageDate);
  const scrollToMessageRowid = useAppStore((s) => s.scrollToMessageRowid);
  const setScrollToMessageDate = useAppStore((s) => s.setScrollToMessageDate);
  const highlightedMessageDate = useAppStore((s) => s.highlightedMessageDate);
  const setHighlightedMessageDate = useAppStore((s) => s.setHighlightedMessageDate);
  const chat = useChatById(chatId);
  const { data: messages, isLoading, isError, error } = useMessages(chatId);
  // Defer message data so the heavy render (tapbackMap, Virtuoso) doesn't block the main thread
  const deferredMessages = useDeferredValue(messages);
  const isTransitioning = messages !== deferredMessages;
  const showLoading = isLoading || isTransitioning;

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Use refs (not state) to track pending scroll so we don't cause re-renders
  const pendingScrollRef = useRef<number | null>(null);
  const pendingScrollRowidRef = useRef<number | null>(null);

  const isGroupChat = chat ? chat.style === 43 : false;
  const chatName = getChatDisplayName(chat);

  const tapbackMap = useMemo(() => {
    if (!deferredMessages) return new Map<string, string[]>();
    return buildTapbackMap(deferredMessages);
  }, [deferredMessages]);

  const visibleMessages = useMemo(() => {
    if (!deferredMessages) return [];
    return deferredMessages.filter(
      (m) => m.associatedMessageType < 2000 || m.associatedMessageType > 2005
    );
  }, [deferredMessages]);

  // Capture scroll target from store into ref immediately
  useEffect(() => {
    if (scrollToMessageDate !== null) {
      pendingScrollRef.current = scrollToMessageDate;
      pendingScrollRowidRef.current = scrollToMessageRowid;
      setScrollToMessageDate(null);
    }
  }, [scrollToMessageDate, scrollToMessageRowid, setScrollToMessageDate]);

  // Track chatId changes — when chat switches, we want to scroll to bottom
  // once messages load (unless there's a pending scroll target).
  const prevChatIdRef = useRef<number | null>(null);
  const needsScrollToBottomRef = useRef(false);

  useEffect(() => {
    if (chatId !== prevChatIdRef.current) {
      prevChatIdRef.current = chatId;
      if (pendingScrollRef.current === null) {
        needsScrollToBottomRef.current = true;
      }
    }
  }, [chatId]);

  // Scroll to bottom when messages actually load for the new chat
  useEffect(() => {
    if (!needsScrollToBottomRef.current || visibleMessages.length === 0) return;
    needsScrollToBottomRef.current = false;

    const lastIndex = visibleMessages.length - 1;
    // Immediate jump
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({
        index: lastIndex,
        align: "end",
        behavior: "auto",
      });
    });
    // Correction after Virtuoso settles item measurements
    const t1 = setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({
        index: lastIndex,
        align: "end",
        behavior: "auto",
      });
    }, 200);
    const t2 = setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({
        index: lastIndex,
        align: "end",
        behavior: "auto",
      });
    }, 500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [visibleMessages]); // fires when messages load/change

  // When messages load (or change) and we have a pending scroll, execute it.
  useEffect(() => {
    if (pendingScrollRef.current === null || visibleMessages.length === 0) return;

    const targetDate = pendingScrollRef.current;
    const targetRowid = pendingScrollRowidRef.current;

    // Try exact match by rowid first, fall back to closest date
    let closestIndex = -1;
    if (targetRowid !== null) {
      closestIndex = visibleMessages.findIndex((m) => m.rowid === targetRowid);
    }
    if (closestIndex === -1) {
      closestIndex = 0;
      let closestDiff = Infinity;
      for (let i = 0; i < visibleMessages.length; i++) {
        const diff = Math.abs(visibleMessages[i].date - targetDate);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestIndex = i;
        }
      }
    }

    // Clear the pending scroll immediately so we don't re-fire
    pendingScrollRef.current = null;
    pendingScrollRowidRef.current = null;

    // Highlight the matched message
    const matchedDate = visibleMessages[closestIndex].date;
    setHighlightedMessageDate(matchedDate);

    // Three-stage scroll: instant jump, then two smooth refinements
    // to ensure Virtuoso has fully measured and rendered surrounding items
    const jumpTimer = setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({
        index: closestIndex,
        align: "center",
        behavior: "auto",
      });
    }, 150);

    const smoothTimer = setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({
        index: closestIndex,
        align: "center",
        behavior: "smooth",
      });
    }, 500);

    // Final correction after Virtuoso settles
    const settleTimer = setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({
        index: closestIndex,
        align: "center",
        behavior: "smooth",
      });
    }, 900);

    // Auto-clear highlight after 3 seconds
    const highlightTimer = setTimeout(() => setHighlightedMessageDate(null), 3000);

    return () => {
      clearTimeout(jumpTimer);
      clearTimeout(smoothTimer);
      clearTimeout(settleTimer);
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
      <div className="absolute inset-0 flex items-center justify-center bg-[#ECEEF2] dark:bg-zinc-950 text-[#94A3B3] dark:text-zinc-600">
        <p className="text-lg apple-text-sm">Select a conversation to start</p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-[#ECEEF2] dark:bg-zinc-950">
      {/* Header — floats over messages so content scrolls behind the blur */}
      <div className="absolute top-0 left-0 right-[10px] flex h-14 items-center justify-center backdrop-blur-[1px] bg-[#ECEEF2]/15 dark:bg-zinc-950/15 saturate-[1.2] dark:saturate-[1.8] border-b border-[#D1D5DB]/15 dark:border-white/[0.04] px-5 z-20 pointer-events-none">
        <div className="flex items-center rounded-full bg-[#ECEEF2]/90 dark:bg-zinc-950/90 backdrop-blur-md px-4 py-1 pointer-events-auto">
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
      {showLoading && (
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
              Footer: () => <div className="pb-14" />,
            }}
          />
        </div>
        {showLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#ECEEF2] dark:bg-zinc-950">
            <div className="w-32 h-[3px] rounded-full overflow-hidden bg-[#D1D5DB]/30 dark:bg-white/[0.06]">
              <div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] rounded-full bg-[#3B82C4] dark:bg-[#60A5FA]" />
            </div>
            <p className="text-xs text-[#94A3B3] dark:text-zinc-500 apple-text-xs">Loading messages</p>
          </div>
        )}
        {!showLoading && isError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm bg-[#ECEEF2] dark:bg-zinc-950">
            <p className="text-red-500 dark:text-red-400">Failed to load messages</p>
            <p className="text-[#94A3B3] dark:text-zinc-600 text-xs max-w-md text-center">{String(error)}</p>
          </div>
        )}
        {!showLoading && !isError && visibleMessages.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[#94A3B3] dark:text-zinc-500 bg-[#ECEEF2] dark:bg-zinc-950">
            No messages in this chat.
          </div>
        )}
      </div>

      {/* Fixed iMessage bar at the bottom */}
      <div className="absolute bottom-0 left-0 right-[10px] z-20 px-4 pt-2 pb-3 pointer-events-none">
        <div className="h-[34px] rounded-full border border-[#D1D5DB]/40 dark:border-white/[0.08] bg-[#F7F8FA]/80 dark:bg-[#2C2C2E]/80 backdrop-blur-md flex items-center px-4">
          <span className="text-[13px] text-[#94A3B3]/50 dark:text-zinc-600/50 select-none">iMessage</span>
        </div>
      </div>

      {/* Scroll to bottom button */}
      {!isAtBottom && visibleMessages.length > 0 && !showLoading && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-14 right-4 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-[#F7F8FA]/90 dark:bg-[#2A2A2C]/90 backdrop-blur-md border border-[#D1D5DB]/30 dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.1)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.4)] hover:bg-[#ECEEF2] dark:hover:bg-[#3A3A3C] transition-colors cursor-pointer"
        >
          <ChevronDown className="h-5 w-5 text-[#4E5D6E] dark:text-zinc-300" />
        </button>
      )}

    </div>
  );
}
