import { invoke } from "@tauri-apps/api/core";
import type {
  Chat,
  Message,
  WrappedStats,
  DailyMessageCount,
  ResponseTimeStats,
  InitiationStats,
  MessageLengthStats,
  HourlyActivity,
  GroupChatDynamics,
  OnThisDayResult,
  TextingPersonality,
  AttachmentData,
  WordFrequency,
  EmbeddingStatus,
  SemanticSearchResult,
} from "@/types";

export const getChats = () => invoke<Chat[]>("get_chats");

export const getMessages = (chatId: number, limit?: number, offset?: number) =>
  invoke<Message[]>("get_messages", { chatId, limit, offset });

export const getAttachmentData = (messageId: number) =>
  invoke<AttachmentData[]>("get_attachment_data", { messageId });

export const getWrappedStats = (year: number, chatIds?: number[]) =>
  invoke<WrappedStats>("get_wrapped_stats", { year, chatIds: chatIds ?? null });

export const getTemporalTrends = (chatId: number, year?: number) =>
  invoke<DailyMessageCount[]>("get_temporal_trends", { chatId, year: year ?? null });

export const getResponseTimeStats = (chatId: number) =>
  invoke<ResponseTimeStats>("get_response_time_stats", { chatId });

export const getInitiationStats = (chatId: number) =>
  invoke<InitiationStats>("get_initiation_stats", { chatId });

export const getMessageLengthStats = (chatId: number) =>
  invoke<MessageLengthStats>("get_message_length_stats", { chatId });

export const getActiveHours = (chatId: number) =>
  invoke<HourlyActivity[]>("get_active_hours", { chatId });

export const checkEmbeddingStatus = () =>
  invoke<EmbeddingStatus>("check_embedding_status");

export const semanticSearch = (query: string, limit?: number) =>
  invoke<SemanticSearchResult[]>("semantic_search", { query, limit });

export const setIndexTarget = (target: number) =>
  invoke<void>("set_index_target", { target });

export const runPipeline = () =>
  invoke<void>("run_pipeline");

export const rebuildSearchIndex = () =>
  invoke<void>("rebuild_search_index");

export const getDataDir = () =>
  invoke<string>("get_data_dir");

export const clearAllEmbeddings = () =>
  invoke<void>("clear_all_embeddings");

export interface DebugEmbeddingItem {
  sourceType: string;
  sourceId: number;
  chatId: number;
  text: string | null;
  embeddedAt: string;
}

export const getDebugEmbeddings = (sourceType: string, limit?: number) =>
  invoke<DebugEmbeddingItem[]>("get_debug_embeddings", { sourceType, limit });

export const getGroupChatDynamics = (chatId: number) =>
  invoke<GroupChatDynamics>("get_group_chat_dynamics", { chatId });

export const getOnThisDay = (chatId?: number, month?: number, day?: number) =>
  invoke<OnThisDayResult>("get_on_this_day", {
    chatId: chatId ?? null,
    month: month ?? new Date().getMonth() + 1,
    day: day ?? new Date().getDate(),
  });

export const getTextingPersonality = (chatId?: number) =>
  invoke<TextingPersonality>("get_texting_personality", {
    chatId: chatId ?? null,
  });

export const getWordFrequency = (year: number, chatIds?: number[], fromMeOnly?: boolean) =>
  invoke<WordFrequency[]>("get_word_frequency", {
    year,
    chatIds: chatIds ?? null,
    fromMeOnly: fromMeOnly ?? false,
  });
