import { useQuery } from "@tanstack/react-query";
import { getChats, getMessages, getMessageCount } from "@/lib/commands";
import type { Chat } from "@/types";

/**
 * Fetch and cache the chat list.
 * Sorted by most-recent message first (backend does this).
 */
export const useChats = () => {
  return useQuery<Chat[]>({
    queryKey: ["chats"],
    queryFn: getChats,
    staleTime: 5 * 60_000, // 5 min — chat.db is read-only, no need to refetch often
  });
};

/**
 * Build a lookup map: chatId -> Chat
 */
export const useChatMap = () => {
  const { data: chats } = useChats();
  const map = new Map<number, Chat>();
  if (chats) {
    for (const chat of chats) {
      map.set(chat.rowid, chat);
    }
  }
  return map;
};

/**
 * Return a single chat by id (from the cached list).
 */
export const useChatById = (chatId: number | null): Chat | undefined => {
  const map = useChatMap();
  if (chatId === null) return undefined;
  return map.get(chatId);
};

/**
 * Fetch messages for a specific chat.
 */
export const useMessages = (chatId: number | null) => {
  return useQuery({
    queryKey: ["messages", chatId],
    queryFn: async () => {
      if (chatId === null) return [];
      return getMessages(chatId);
    },
    enabled: chatId !== null,
    staleTime: 5 * 60_000, // 5 min — messages don't change underneath us
  });
};

/**
 * Total message count across all chats.
 */
export const useMessageCount = () => {
  return useQuery<number>({
    queryKey: ["messageCount"],
    queryFn: getMessageCount,
    staleTime: 60_000,
  });
};

/**
 * Resolve a display name for a chat.
 * Uses contact display names when available, falls back to raw identifiers.
 */
export const getChatDisplayName = (chat: Chat | undefined | null): string => {
  if (!chat) return "";
  if (chat.displayName) return chat.displayName;
  if (chat.participants.length > 0) {
    return chat.participants
      .map((p) => p.displayName || p.id)
      .join(", ");
  }
  return chat.chatIdentifier || "";
};
