"use client";

import { useEffect, useRef, useMemo, useCallback } from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import { Virtuoso } from "react-virtuoso";

import { useMessages, useChatById, getChatDisplayName } from "@/hooks/use-messages";
import { useAppStore } from "@/stores/app-store";
import { MessageBubble, buildTapbackMap } from "./message-bubble";

export function ChatView() {
  const chatId = useAppStore((s) => s.selectedChatId);
  const scrollToMessageDate = useAppStore((s) => s.scrollToMessageDate);
  const setScrollToMessageDate = useAppStore((s) => s.setScrollToMessageDate);
  const chat = useChatById(chatId);
  const { data: messages, isLoading, isError, error } = useMessages(chatId);
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  const isGroupChat = chat ? chat.style === 43 : false;
  const chatName = getChatDisplayName(chat);

  // Pre-compute tapback map once instead of O(n) per visible message
  const tapbackMap = useMemo(() => {
    if (!messages) return new Map<string, string[]>();
    return buildTapbackMap(messages);
  }, [messages]);

  // Filter out tapback reactions from the visible list
  const visibleMessages = useMemo(() => {
    if (!messages) return [];
    return messages.filter(
      (m) => m.associatedMessageType < 2000 || m.associatedMessageType > 2005
    );
  }, [messages]);

  // Scroll to bottom when chat changes
  useEffect(() => {
    if (virtuosoRef.current && visibleMessages.length > 0) {
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({
          index: visibleMessages.length - 1,
          align: "end",
          behavior: "auto",
        });
      });
    }
  }, [chatId]); // Only on chat change, not message count

  // Scroll to a specific message date (from "On This Day" navigation)
  useEffect(() => {
    if (scrollToMessageDate === null || !visibleMessages.length || !virtuosoRef.current) return;

    // Find the message closest to the target date
    let closestIndex = 0;
    let closestDiff = Infinity;
    for (let i = 0; i < visibleMessages.length; i++) {
      const diff = Math.abs(visibleMessages[i].date - scrollToMessageDate);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIndex = i;
      }
    }

    // Wait a tick for Virtuoso to be ready, then scroll
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({
        index: closestIndex,
        align: "center",
        behavior: "smooth",
      });
    });

    // Clear the scroll target after navigating
    setScrollToMessageDate(null);
  }, [scrollToMessageDate, visibleMessages, setScrollToMessageDate]);

  const itemContent = useCallback(
    (index: number) => {
      const msg = visibleMessages[index];
      const prev = index > 0 ? visibleMessages[index - 1] : null;
      const tapbacks = tapbackMap.get(msg.guid) ?? [];
      return (
        <div className="relative">
          <MessageBubble
            message={msg}
            previousMessage={prev}
            showSenderName={isGroupChat}
          />
          {tapbacks.length > 0 && (
            <div
              className={`absolute -bottom-2 flex gap-0.5 rounded-full bg-[#2C2C2E] px-1.5 py-0.5 text-xs shadow-[0_1px_4px_rgba(0,0,0,0.3)] border border-white/[0.06] ${
                msg.isFromMe ? "right-5" : "left-5"
              }`}
            >
              {tapbacks.map((emoji, i) => (
                <span key={i}>{emoji}</span>
              ))}
            </div>
          )}
        </div>
      );
    },
    [visibleMessages, tapbackMap, isGroupChat]
  );

  // Empty state — after all hooks
  if (chatId === null) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#1C1C1E] text-zinc-600">
        <p className="text-lg apple-text-sm">Select a conversation to start</p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-[#1C1C1E]">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center glass glass-border shadow-[0_1px_6px_rgba(0,0,0,0.2)] px-5 relative z-10">
        <h2 className="truncate text-[15px] font-semibold text-zinc-100 apple-text-sm">
          {chatName}
        </h2>
        {isGroupChat && chat && (
          <span className="ml-2 text-xs text-zinc-500 apple-text-xs">
            {chat.participants.length} members
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-hidden">
        {isLoading && (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            Loading messages...
          </div>
        )}
        {!isLoading && isError && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm">
            <p className="text-red-400">Failed to load messages</p>
            <p className="text-zinc-600 text-xs max-w-md text-center">{String(error)}</p>
          </div>
        )}
        {!isLoading && !isError && visibleMessages.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            No messages in this chat.
          </div>
        )}
        {!isLoading && visibleMessages.length > 0 && (
          <Virtuoso
            ref={virtuosoRef}
            totalCount={visibleMessages.length}
            itemContent={itemContent}
            initialTopMostItemIndex={visibleMessages.length - 1}
            followOutput="auto"
            defaultItemHeight={44}
            increaseViewportBy={800}
            overscan={200}
            style={{ height: "100%" }}
            components={{
              Footer: () => (
                <div className="flex items-center justify-center px-4 py-4">
                  <div className="flex h-10 w-full max-w-2xl items-center rounded-full bg-white/[0.06] border border-white/[0.06] px-4 shadow-[0_1px_4px_rgba(0,0,0,0.2)]">
                    <span className="text-sm text-zinc-600 apple-text-sm">iMessage</span>
                  </div>
                </div>
              ),
              Header: () => <div className="pt-3" />,
            }}
          />
        )}
      </div>
    </div>
  );
}
