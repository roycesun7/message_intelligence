"use client";

import { useMemo, useCallback, memo } from "react";
import { Virtuoso } from "react-virtuoso";
import Fuse from "fuse.js";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Search, BarChart3 } from "lucide-react";

import { useChats, getChatDisplayName } from "@/hooks/use-messages";
import { useAppStore } from "@/stores/app-store";
import { Input } from "@/components/ui/input";
import type { Chat } from "@/types";

dayjs.extend(relativeTime);

const FUSE_OPTIONS = {
  keys: ["displayName", "chatIdentifier", "participants.id", "participants.displayName"],
  shouldSort: true,
  threshold: 0.3,
};

// ────────────────────────────────────────────────────────
// Chat entry (single row) — memoized to avoid re-renders
// ────────────────────────────────────────────────────────

const ChatEntry = memo(function ChatEntry({
  chat,
  isActive,
}: {
  chat: Chat;
  isActive: boolean;
}) {
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const setView = useAppStore((s) => s.setView);
  const view = useAppStore((s) => s.view);
  const setWrappedChatId = useAppStore((s) => s.setWrappedChatId);

  const name = getChatDisplayName(chat);
  const isGroup = chat.style === 43;

  const handleClick = useCallback(() => {
    if (view === "wrapped") {
      setWrappedChatId(chat.rowid);
    } else {
      setSelectedChatId(chat.rowid);
      setView("chat");
    }
  }, [chat.rowid, view, setSelectedChatId, setView, setWrappedChatId]);

  return (
    <button
      onClick={handleClick}
      className={`flex w-full cursor-pointer items-start gap-3 mx-2 px-3 py-2.5 text-left transition-colors duration-200 rounded-[10px] ${
        isActive
          ? "bg-white/[0.08]"
          : "hover:bg-white/[0.06]"
      }`}
      style={{ width: "calc(100% - 16px)" }}
    >
      {/* Avatar circle */}
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold shadow-[0_1px_4px_rgba(0,0,0,0.3)] ${
          isGroup
            ? "bg-purple-600/30 text-purple-300"
            : "bg-[#007AFF]/30 text-[#64ACFF]"
        }`}
      >
        {name.charAt(0).toUpperCase() || "?"}
      </div>

      {/* Text content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-medium text-zinc-100 apple-text-sm">
            {name}
          </span>
          {chat.lastMessageDate && (
            <span className="shrink-0 text-[11px] text-zinc-500 apple-text-xs">
              {dayjs(chat.lastMessageDate).fromNow(true)}
            </span>
          )}
        </div>
        {chat.lastMessageText && (
          <p className="mt-0.5 truncate text-xs text-zinc-500 apple-text-xs">
            {chat.lastMessageText}
          </p>
        )}
      </div>
    </button>
  );
});

// ────────────────────────────────────────────────────────
// Chat list sidebar
// ────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────
// "All Chats" entry shown at top of list in wrapped view
// ────────────────────────────────────────────────────────

function AllChatsEntry({ isActive }: { isActive: boolean }) {
  const setWrappedChatId = useAppStore((s) => s.setWrappedChatId);

  const handleClick = useCallback(() => {
    setWrappedChatId(null);
  }, [setWrappedChatId]);

  return (
    <button
      onClick={handleClick}
      className={`flex w-full cursor-pointer items-start gap-3 mx-2 px-3 py-2.5 text-left transition-colors duration-200 rounded-[10px] ${
        isActive
          ? "bg-white/[0.08]"
          : "hover:bg-white/[0.06]"
      }`}
      style={{ width: "calc(100% - 16px)" }}
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#007AFF]/30 to-purple-600/30 text-sm font-semibold text-[#64ACFF] shadow-[0_1px_4px_rgba(0,0,0,0.3)]">
        <BarChart3 className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-medium text-zinc-100 apple-text-sm">
            All Chats
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-zinc-500 apple-text-xs">
          Global wrapped stats
        </p>
      </div>
    </button>
  );
}

export function ChatList() {
  const { data: chats, isLoading, isError } = useChats();
  const chatSearchQuery = useAppStore((s) => s.chatSearchQuery);
  const setChatSearchQuery = useAppStore((s) => s.setChatSearchQuery);
  const selectedChatId = useAppStore((s) => s.selectedChatId);
  const wrappedChatId = useAppStore((s) => s.wrappedChatId);
  const view = useAppStore((s) => s.view);

  const isWrappedView = view === "wrapped";
  const activeChatId = isWrappedView ? wrappedChatId : selectedChatId;

  // Memoize Fuse index so it's only rebuilt when chats change
  const fuseIndex = useMemo(() => {
    const list = chats ?? [];
    return new Fuse<Chat>(list, FUSE_OPTIONS);
  }, [chats]);

  const filteredChats = useMemo(() => {
    const list = chats ?? [];
    if (!chatSearchQuery.trim()) return list;
    return fuseIndex.search(chatSearchQuery).map((r) => r.item);
  }, [chats, chatSearchQuery, fuseIndex]);

  const itemContent = useCallback(
    (_index: number, chat: Chat) => (
      <ChatEntry chat={chat} isActive={activeChatId === chat.rowid} />
    ),
    [activeChatId]
  );

  return (
    <div className="flex h-full w-80 min-w-80 flex-col border-r border-white/[0.06] glass-heavy">
      {/* Search bar */}
      <div className="p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            placeholder="Search conversations..."
            value={chatSearchQuery}
            onChange={(e) => setChatSearchQuery(e.target.value)}
            className="h-9 pl-9 rounded-lg bg-white/[0.06] border-white/[0.06] text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-[#007AFF]/40 apple-text-sm"
          />
        </div>
      </div>

      {/* "All Chats" entry when in wrapped view */}
      {isWrappedView && (
        <AllChatsEntry isActive={wrappedChatId === null} />
      )}

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
            <p className="text-xs apple-text-xs">
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
            defaultItemHeight={68}
            increaseViewportBy={400}
            overscan={100}
            style={{ height: "100%" }}
          />
        )}
      </div>
    </div>
  );
}
