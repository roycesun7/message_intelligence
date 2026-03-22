"use client";

import { useMemo, useCallback, memo, useSyncExternalStore } from "react";
import { Virtuoso } from "react-virtuoso";
import { useQueryClient } from "@tanstack/react-query";
import Fuse from "fuse.js";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Search, BarChart3, RefreshCw } from "lucide-react";

import { useChats, getChatDisplayName } from "@/hooks/use-messages";
import { useAppStore } from "@/stores/app-store";
import { Input } from "@/components/ui/input";
import type { Chat } from "@/types";

dayjs.extend(relativeTime);

function useWindowFocused() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("focus", cb);
      window.addEventListener("blur", cb);
      return () => {
        window.removeEventListener("focus", cb);
        window.removeEventListener("blur", cb);
      };
    },
    () => document.hasFocus(),
    () => true
  );
}

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
  const setCapsuleChatId = useAppStore((s) => s.setCapsuleChatId);
  const windowFocused = useWindowFocused();

  const name = getChatDisplayName(chat);
  const isGroup = chat.style === 43;
  const isFocusedActive = isActive && windowFocused;
  const isUnfocusedActive = isActive && !windowFocused;

  const handleClick = useCallback(() => {
    if (view === "capsule") {
      setCapsuleChatId(chat.rowid);
    } else {
      setSelectedChatId(chat.rowid);
      setView("chat");
    }
  }, [chat.rowid, view, setSelectedChatId, setView, setCapsuleChatId]);

  return (
    <div>
      <button
        onClick={handleClick}
        className={`flex w-full cursor-pointer items-start gap-3 mx-2 px-3 py-2.5 text-left transition-colors duration-200 rounded-[10px] ${
          isFocusedActive
            ? "bg-[#007AFF]"
            : isUnfocusedActive
              ? "bg-[#1B2432]/[0.08] dark:bg-white/[0.10]"
              : "hover:bg-[#1B2432]/[0.04] dark:hover:bg-white/[0.06]"
        }`}
        style={{ width: "calc(100% - 16px)" }}
      >
        {/* Avatar circle */}
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
            isFocusedActive
              ? "bg-white/20 text-white shadow-none"
              : isGroup
                ? "bg-purple-100 text-purple-600 dark:bg-purple-600/30 dark:text-purple-300 shadow-[0_1px_3px_rgba(0,0,0,0.1)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]"
                : "bg-[#007AFF]/15 text-[#007AFF] dark:bg-[#007AFF]/30 dark:text-[#64ACFF] shadow-[0_1px_3px_rgba(0,0,0,0.1)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]"
          }`}
        >
          {name.charAt(0).toUpperCase() || "?"}
        </div>

        {/* Text content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className={`truncate text-[13px] font-medium apple-text-sm ${isFocusedActive ? "text-white" : "text-[#1B2432] dark:text-zinc-100"}`}>
              {name}
            </span>
            {chat.lastMessageDate && (
              <span className={`shrink-0 text-[11px] apple-text-xs ${isFocusedActive ? "text-white/70" : "text-[#94A3B3] dark:text-zinc-500"}`}>
                {dayjs(chat.lastMessageDate).fromNow(true)}
              </span>
            )}
          </div>
          {chat.lastMessageText && (
            <p className={`mt-0.5 truncate text-xs apple-text-xs ${isFocusedActive ? "text-white/60" : "text-[#4E5D6E] dark:text-zinc-500"}`}>
              {chat.lastMessageText}
            </p>
          )}
        </div>
      </button>
      {/* Divider — hidden when this entry is active */}
      {!isActive && (
        <div className="mx-auto w-[calc(100%-48px)] h-px bg-[#D1D5DB]/20 dark:bg-white/[0.04]" />
      )}
    </div>
  );
});

// ────────────────────────────────────────────────────────
// Chat list sidebar
// ────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────
// "All Chats" entry shown at top of list in capsule view
// ────────────────────────────────────────────────────────

function AllChatsEntry({ isActive }: { isActive: boolean }) {
  const setCapsuleChatId = useAppStore((s) => s.setCapsuleChatId);

  const handleClick = useCallback(() => {
    setCapsuleChatId(null);
  }, [setCapsuleChatId]);

  return (
    <button
      onClick={handleClick}
      className={`flex w-full cursor-pointer items-start gap-3 mx-2 px-3 py-2.5 text-left transition-colors duration-200 rounded-[10px] ${
        isActive
          ? "bg-[#1B2432]/[0.06] dark:bg-white/[0.08]"
          : "hover:bg-[#1B2432]/[0.04] dark:hover:bg-white/[0.06]"
      }`}
      style={{ width: "calc(100% - 16px)" }}
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#FF3B30]/20 via-[#007AFF]/20 to-[#AF52DE]/20 dark:from-[#FF3B30]/30 dark:via-[#007AFF]/30 dark:to-[#AF52DE]/30 text-sm font-semibold text-[#007AFF] dark:text-[#64ACFF] rainbow-glow">
        <BarChart3 className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-medium text-[#1B2432] dark:text-zinc-100 apple-text-sm">
            All Chats
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-[#4E5D6E] dark:text-zinc-500 apple-text-xs">
          Global insights
        </p>
      </div>
    </button>
  );
}

export function ChatList() {
  const { data: chats, isLoading, isError, isFetching } = useChats();
  const queryClient = useQueryClient();
  const chatSearchQuery = useAppStore((s) => s.chatSearchQuery);
  const setChatSearchQuery = useAppStore((s) => s.setChatSearchQuery);
  const selectedChatId = useAppStore((s) => s.selectedChatId);
  const capsuleChatId = useAppStore((s) => s.capsuleChatId);
  const view = useAppStore((s) => s.view);

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["chats"] });
    queryClient.invalidateQueries({ queryKey: ["messages"] });
  }, [queryClient]);

  const isCapsuleView = view === "capsule";
  const activeChatId = isCapsuleView ? capsuleChatId : selectedChatId;

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
    (index: number) => {
      if (isCapsuleView && index === 0) {
        return <AllChatsEntry isActive={capsuleChatId === null} />;
      }
      const chatIndex = isCapsuleView ? index - 1 : index;
      const chat = filteredChats[chatIndex];
      if (!chat) return null;
      return <ChatEntry chat={chat} isActive={activeChatId === chat.rowid} />;
    },
    [activeChatId, isCapsuleView, capsuleChatId, filteredChats]
  );

  const totalCount = filteredChats.length + (isCapsuleView ? 1 : 0);

  return (
    <div className="relative h-full w-80 min-w-80 overflow-hidden rounded-2xl bg-[#F7F8FA]/80 dark:bg-[#2A2A2C]/60 backdrop-blur-2xl saturate-[1.2] dark:saturate-[1.8] border border-[#D1D5DB]/30 dark:border-white/[0.08] shadow-[0_2px_20px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_24px_rgba(0,0,0,0.4)] mr-2">
      {/* Search bar + refresh — floats over list so content scrolls behind the blur */}
      <div className="absolute top-0 left-0 right-0 pt-3 px-3 pb-1 z-10 backdrop-blur-[1px] bg-[#F7F8FA]/15 dark:bg-[#2A2A2C]/15">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B3] dark:text-zinc-500" />
            <Input
              placeholder="Search"
              value={chatSearchQuery}
              onChange={(e) => setChatSearchQuery(e.target.value)}
              className="h-9 pl-9 rounded-full bg-[#F7F8FA] dark:bg-[#2A2A2C] border-[#D1D5DB]/40 dark:border-white/[0.06] text-[#1B2432] dark:text-zinc-200 placeholder:text-[#94A3B3] dark:placeholder:text-zinc-500 focus-visible:ring-[#4E5D6E]/40 dark:focus-visible:ring-[#007AFF]/40 apple-text-sm"
            />
          </div>
          <button
            onClick={handleRefresh}
            disabled={isFetching}
            title="Refresh messages"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F7F8FA] dark:bg-[#2A2A2C] border border-[#D1D5DB]/40 dark:border-white/[0.06] text-[#94A3B3] dark:text-zinc-500 hover:text-[#4E5D6E] dark:hover:text-zinc-300 hover:bg-[#ECEEF2] dark:hover:bg-[#3A3A3C] transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* List — fills entire area, Virtuoso header provides top spacing */}
      <div className="absolute inset-0">
        {isLoading && (
          <div className="flex items-center justify-center p-8 pt-[72px] text-sm text-[#94A3B3] dark:text-zinc-500">
            Loading conversations...
          </div>
        )}
        {isError && (
          <div className="flex flex-col items-center justify-center gap-2 p-8 pt-[72px] text-center text-sm text-[#94A3B3] dark:text-zinc-500">
            <p className="font-medium text-red-500 dark:text-red-400">Unable to load chats</p>
            <p className="text-xs apple-text-xs">
              Make sure Full Disk Access is granted in System Settings.
            </p>
          </div>
        )}
        {!isLoading && !isError && filteredChats.length === 0 && (
          <div className="flex items-center justify-center p-8 pt-[72px] text-sm text-[#94A3B3] dark:text-zinc-500">
            No conversations found.
          </div>
        )}
        {!isLoading && !isError && filteredChats.length > 0 && (
          <div className="absolute inset-0 overflow-hidden">
            <Virtuoso
              totalCount={totalCount}
              itemContent={itemContent}
              defaultItemHeight={68}
              increaseViewportBy={400}
              overscan={100}
              style={{ height: "100%", width: "100%" }}
              components={{
                Header: () => <div className="pt-[52px]" />,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
