"use client";

import { useEffect, useRef, useMemo } from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import { Virtuoso } from "react-virtuoso";

import { useMessages, useChatById, getChatDisplayName } from "@/hooks/use-messages";
import { useAppStore } from "@/stores/app-store";
import { MessageBubble, collectTapbacks } from "./message-bubble";
import type { Message } from "@/types";

export function ChatView() {
  const chatId = useAppStore((s) => s.selectedChatId);
  const chat = useChatById(chatId);
  const { data: messages, isLoading } = useMessages(chatId);
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  const isGroupChat = chat ? chat.style === 43 : false;

  // Filter out tapback reactions from the visible list;
  // they are rendered as decorations inside MessageBubble.
  const visibleMessages = useMemo(() => {
    if (!messages) return [];
    return messages.filter(
      (m) => m.associatedMessageType < 2000 || m.associatedMessageType > 2005
    );
  }, [messages]);

  // Scroll to bottom when chat changes or messages arrive
  useEffect(() => {
    if (virtuosoRef.current && visibleMessages.length > 0) {
      virtuosoRef.current.scrollToIndex({
        index: visibleMessages.length - 1,
        align: "end",
      });
    }
  }, [chatId, visibleMessages.length]);

  // Empty state
  if (chatId === null) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-950 text-zinc-600">
        <p className="text-lg">Select a conversation to start</p>
      </div>
    );
  }

  const chatName = getChatDisplayName(chat);

  const itemContent = (index: number) => {
    const msg = visibleMessages[index];
    const prev = index > 0 ? visibleMessages[index - 1] : null;
    // Gather tapbacks for this message from the full list
    const tapbacks =
      messages && msg ? collectTapbacks(msg.guid, messages) : [];
    return (
      <div className="relative">
        <MessageBubble
          message={msg}
          previousMessage={prev}
          showSenderName={isGroupChat}
        />
        {tapbacks.length > 0 && (
          <div
            className={`absolute -bottom-2 flex gap-0.5 rounded-full bg-zinc-800 px-1.5 py-0.5 text-xs shadow ${
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
  };

  return (
    <div className="flex flex-1 flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center border-b border-white/10 px-5">
        <h2 className="truncate text-base font-semibold text-zinc-100">
          {chatName}
        </h2>
        {isGroupChat && chat && (
          <span className="ml-2 text-xs text-zinc-500">
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
        {!isLoading && visibleMessages.length === 0 && (
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
            increaseViewportBy={2000}
            overscan={100}
            style={{ height: "100%" }}
          />
        )}
      </div>
    </div>
  );
}
