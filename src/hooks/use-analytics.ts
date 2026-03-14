import { useQuery } from "@tanstack/react-query";
import {
  getWrappedStats,
  getTemporalTrends,
  getResponseTimeStats,
  getInitiationStats,
  getMessageLengthStats,
  getActiveHours,
  getGroupChatDynamics,
  getOnThisDay,
  getTextingPersonality,
  getWordFrequency,
  getFirstMessage,
  getEmojiFrequency,
} from "@/lib/commands";
import type {
  WrappedStats,
  DailyMessageCount,
  ResponseTimeStats,
  InitiationStats,
  MessageLengthStats,
  HourlyActivity,
  GroupChatDynamics,
  OnThisDayResult,
  TextingPersonality,
  WordFrequency,
  FirstMessage,
  EmojiFrequency,
} from "@/types";

/**
 * Fetch "Wrapped"-style analytics for a given year.
 * Pass 0 for all-time stats.
 */
export const useWrappedStats = (year: number, chatIds?: number[]) => {
  return useQuery<WrappedStats>({
    queryKey: ["wrappedStats", year, chatIds ?? null],
    queryFn: () => getWrappedStats(year, chatIds),
    staleTime: 60_000,
  });
};

/**
 * Fetch daily message volume for a single conversation.
 * Used for the temporal trends area chart in per-chat Wrapped.
 */
export const useTemporalTrends = (chatId: number | null, year?: number) => {
  return useQuery<DailyMessageCount[]>({
    queryKey: ["temporalTrends", chatId, year ?? null],
    queryFn: () => getTemporalTrends(chatId ?? undefined, year),
    staleTime: 5 * 60_000,
  });
};

// ── Relationship metrics hooks (per-chat) ─────────────────

/** Fetch response time stats for a conversation. */
export const useResponseTimeStats = (chatId: number | null) => {
  return useQuery<ResponseTimeStats>({
    queryKey: ["responseTimeStats", chatId],
    queryFn: () => getResponseTimeStats(chatId!),
    enabled: chatId !== null,
    staleTime: 5 * 60_000,
  });
};

/** Fetch conversation initiation stats. */
export const useInitiationStats = (chatId: number | null) => {
  return useQuery<InitiationStats>({
    queryKey: ["initiationStats", chatId],
    queryFn: () => getInitiationStats(chatId!),
    enabled: chatId !== null,
    staleTime: 5 * 60_000,
  });
};

/** Fetch message length stats. */
export const useMessageLengthStats = (chatId: number | null) => {
  return useQuery<MessageLengthStats>({
    queryKey: ["messageLengthStats", chatId],
    queryFn: () => getMessageLengthStats(chatId!),
    enabled: chatId !== null,
    staleTime: 5 * 60_000,
  });
};

/** Fetch hourly activity breakdown. */
export const useActiveHours = (chatId: number | null) => {
  return useQuery<HourlyActivity[]>({
    queryKey: ["activeHours", chatId],
    queryFn: () => getActiveHours(chatId!),
    enabled: chatId !== null,
    staleTime: 5 * 60_000,
  });
};

// ── Group chat dynamics & fun/shareable hooks ─────────────

/** Fetch group chat dynamics for a conversation. */
export const useGroupChatDynamics = (chatId: number | null) => {
  return useQuery<GroupChatDynamics>({
    queryKey: ["groupChatDynamics", chatId],
    queryFn: () => getGroupChatDynamics(chatId!),
    enabled: chatId !== null,
    staleTime: 5 * 60_000,
  });
};

/** Fetch "On This Day" messages for the current date. */
export const useOnThisDay = (chatId?: number | null) => {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  return useQuery<OnThisDayResult>({
    queryKey: ["onThisDay", chatId ?? null, month, day],
    queryFn: () =>
      getOnThisDay(chatId ?? undefined, month, day),
    staleTime: 5 * 60_000,
  });
};

/** Fetch your texting personality profile. */
export const useTextingPersonality = (chatId?: number | null) => {
  return useQuery<TextingPersonality>({
    queryKey: ["textingPersonality", chatId ?? null],
    queryFn: () => getTextingPersonality(chatId ?? undefined),
    staleTime: 5 * 60_000,
  });
};

/** Fetch the first message ever sent in a conversation. */
export const useFirstMessage = (chatId: number | null) => {
  return useQuery<FirstMessage | null>({
    queryKey: ["firstMessage", chatId],
    queryFn: () => getFirstMessage(chatId!),
    enabled: chatId !== null,
    staleTime: 60 * 60_000,
  });
};

/** Fetch most common emoji. */
export const useEmojiFrequency = (chatId?: number | null, year?: number) => {
  return useQuery<EmojiFrequency[]>({
    queryKey: ["emojiFrequency", chatId ?? null, year ?? null],
    queryFn: () => getEmojiFrequency(chatId ?? undefined, year),
    staleTime: 5 * 60_000,
  });
};

/** Fetch most frequently used words. */
export const useWordFrequency = (
  year: number,
  chatIds?: number[],
  fromMeOnly?: boolean,
) => {
  return useQuery<WordFrequency[]>({
    queryKey: ["wordFrequency", year, chatIds ?? null, fromMeOnly ?? false],
    queryFn: () => getWordFrequency(year, chatIds, fromMeOnly),
    staleTime: 5 * 60_000,
  });
};
