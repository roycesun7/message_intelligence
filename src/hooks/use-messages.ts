import { useQuery } from "@tanstack/react-query";
import { getChats, getMessages, getAttachmentData } from "@/lib/commands";
import type { Chat, AttachmentData } from "@/types";

export const useChats = () => {
  return useQuery<Chat[]>({
    queryKey: ["chats"],
    queryFn: getChats,
    staleTime: 5 * 60_000,
  });
};

export const useChatById = (chatId: number | null): Chat | undefined => {
  const { data: chats } = useChats();
  if (chatId === null || !chats) return undefined;
  return chats.find((c) => c.rowid === chatId);
};

export const useMessages = (chatId: number | null) => {
  return useQuery({
    queryKey: ["messages", chatId],
    queryFn: async () => {
      if (chatId === null) return [];
      return getMessages(chatId);
    },
    enabled: chatId !== null,
    staleTime: 5 * 60_000,
  });
};

export const useAttachmentData = (messageId: number | null) => {
  return useQuery<AttachmentData[]>({
    queryKey: ["attachmentData", messageId],
    queryFn: () => getAttachmentData(messageId!),
    enabled: messageId !== null,
    staleTime: 30 * 60_000,
  });
};

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
