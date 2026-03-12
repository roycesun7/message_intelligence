import { useQuery } from "@tanstack/react-query";
import {
  getWrappedStats,
  getTemporalTrends,
  getResponseTimeStats,
  getInitiationStats,
  getMessageLengthStats,
  getActiveHours,
} from "@/lib/commands";
import type {
  WrappedStats,
  DailyMessageCount,
  ResponseTimeStats,
  InitiationStats,
  MessageLengthStats,
  HourlyActivity,
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
    queryFn: () => getTemporalTrends(chatId!, year),
    enabled: chatId !== null,
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
