"use client";

import { useMemo, useCallback } from "react";
import { Virtuoso } from "react-virtuoso";
import Fuse from "fuse.js";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Search } from "lucide-react";

import { useChats, getChatDisplayName } from "@/hooks/use-messages";
import { useAppStore } from "@/stores/app-store";
import { Input } from "@/components/ui/input";
import type { Chat } from "@/types";

dayjs.extend(relativeTime);

// ────────────────────────────────────────────────────────
// Chat entry (single row)
// ────────────────────────────────────────────────────────

function ChatEntry({ chat }: { chat: Chat }) {
  const selectedChatId = useAppStore((s) => s.selectedChatId);
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const setView = useAppStore((s) => s.setView);

  const isActive = selectedChatId === chat.rowid;
  const name = getChatDisplayName(chat);
  const isGroup = chat.style === 43;

  const handleClick = useCallback(() => {
    setSelectedChatId(chat.rowid);
    setView("chat");
  }, [chat.rowid, setSelectedChatId, setView]);

  return (
    <button
      onClick={handleClick}
      className={`flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors ${
        isActive
          ? "bg-blue-600/20 border-l-2 border-blue-500"
          : "hover:bg-white/5 border-l-2 border-transparent"
      }`}
    >
      {/* Avatar circle */}
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
          isGroup
            ? "bg-purple-600/30 text-purple-300"
            : "bg-blue-600/30 text-blue-300"
        }`}
      >
        {name.charAt(0).toUpperCase() || "?"}
      </div>

      {/* Text content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-zinc-100">
            {name}
          </span>
          {chat.lastMessageDate && (
            <span className="shrink-0 text-[11px] text-zinc-500">
              {dayjs(chat.lastMessageDate).fromNow(true)}
            </span>
          )}
        </div>
        {chat.lastMessageText && (
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {chat.lastMessageText}
          </p>
        )}
      </div>
    </button>
  );
}

// ────────────────────────────────────────────────────────
// Chat list sidebar
// ────────────────────────────────────────────────────────

export function ChatList() {
  const { data: chats, isLoading, isError } = useChats();
  const chatSearchQuery = useAppStore((s) => s.chatSearchQuery);
  const setChatSearchQuery = useAppStore((s) => s.setChatSearchQuery);

  const filteredChats = useMemo(() => {
    const list = chats ?? [];
    if (!chatSearchQuery.trim()) return list;

    const fuse = new Fuse<Chat>(list, {
      keys: ["displayName", "chatIdentifier", "participants.id", "participants.displayName"],
      shouldSort: true,
      threshold: 0.3,
    });
    return fuse.search(chatSearchQuery).map((r) => r.item);
  }, [chats, chatSearchQuery]);

  const itemContent = useCallback(
    (_index: number, chat: Chat) => <ChatEntry chat={chat} />,
    []
  );

  return (
    <div className="flex h-full w-80 min-w-80 flex-col border-r border-white/10 bg-zinc-900">
      {/* Search bar */}
      <div className="p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            placeholder="Search conversations..."
            value={chatSearchQuery}
            onChange={(e) => setChatSearchQuery(e.target.value)}
            className="h-9 pl-9 bg-zinc-800 border-zinc-700 text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-blue-500/40"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-hidden">
        {isLoading && (
          <div className="flex items-center justify-center p-8 text-sm text-zinc-500">
            Loading conversations...
          </div>
        )}
        {isError && (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-zinc-500">
            <p className="font-medium text-red-400">Unable to load chats</p>
            <p className="text-xs">
              Make sure Full Disk Access is granted in System Settings.
            </p>
          </div>
        )}
        {!isLoading && !isError && filteredChats.length === 0 && (
          <div className="flex items-center justify-center p-8 text-sm text-zinc-500">
            No conversations found.
          </div>
        )}
        {!isLoading && !isError && filteredChats.length > 0 && (
          <Virtuoso
            data={filteredChats}
            itemContent={itemContent}
            increaseViewportBy={1000}
            overscan={50}
            style={{ height: "100%" }}
          />
        )}
      </div>
    </div>
  );
}
