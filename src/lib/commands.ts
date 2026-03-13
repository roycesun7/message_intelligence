import { invoke } from "@tauri-apps/api/core";
import type {
  Chat,
  Message,
  Attachment,
  WrappedStats,
  EmbeddingStatus,
  SemanticSearchResult,
  DailyMessageCount,
  ResponseTimeStats,
  InitiationStats,
  MessageLengthStats,
  HourlyActivity,
  GroupChatDynamics,
  OnThisDayResult,
  TextingPersonality,
  AttachmentData,
} from "@/types";

// ────────────────────────────────────────────────────────
// Chat commands
// ────────────────────────────────────────────────────────

/** Fetch all chats, sorted by most-recent message first. */
export const getChats = () => invoke<Chat[]>("get_chats");

/** Fetch messages for a given chat. */
export const getMessages = (chatId: number, limit?: number, offset?: number) =>
  invoke<Message[]>("get_messages", { chatId, limit, offset });

/** Total message count across all chats. */
export const getMessageCount = () => invoke<number>("get_message_count");

/** Fetch attachments for a given message. */
export const getMessageAttachments = (messageId: number) =>
  invoke<Attachment[]>("get_message_attachments", { messageId });

/** Fetch attachment data (with base64 image data) for a given message. */
export const getAttachmentData = (messageId: number) =>
  invoke<AttachmentData[]>("get_attachment_data", { messageId });

// ────────────────────────────────────────────────────────
// Contact commands
// ────────────────────────────────────────────────────────

/** Resolve a single phone/email to a contact name. */
export const getContactName = (identifier: string) =>
  invoke<string | null>("get_contact_name", { identifier });

/** Get the full contact map (phone/email -> display name). */
export const getContactMap = () =>
  invoke<Record<string, string>>("get_contact_map");

// ────────────────────────────────────────────────────────
// Analytics / Wrapped commands
// ────────────────────────────────────────────────────────

/** Compute "Wrapped"-style stats for a calendar year. Pass 0 for all-time. */
export const getWrappedStats = (year: number, chatIds?: number[]) =>
  invoke<WrappedStats>("get_wrapped_stats", { year, chatIds: chatIds ?? null });

/** Fetch daily message counts for a conversation's temporal trend chart. */
export const getTemporalTrends = (chatId: number, year?: number) =>
  invoke<DailyMessageCount[]>("get_temporal_trends", { chatId, year: year ?? null });

// ────────────────────────────────────────────────────────
// Relationship metrics commands (per-chat)
// ────────────────────────────────────────────────────────

/** Fetch response time stats for a conversation. */
export const getResponseTimeStats = (chatId: number) =>
  invoke<ResponseTimeStats>("get_response_time_stats", { chatId });

/** Fetch conversation initiation stats. */
export const getInitiationStats = (chatId: number) =>
  invoke<InitiationStats>("get_initiation_stats", { chatId });

/** Fetch message length stats. */
export const getMessageLengthStats = (chatId: number) =>
  invoke<MessageLengthStats>("get_message_length_stats", { chatId });

/** Fetch hourly activity breakdown. */
export const getActiveHours = (chatId: number) =>
  invoke<HourlyActivity[]>("get_active_hours", { chatId });

// ────────────────────────────────────────────────────────
// Embedding / AI commands
// ────────────────────────────────────────────────────────

/** Check if the embedding pipeline is ready. */
export const checkEmbeddingStatus = () =>
  invoke<EmbeddingStatus>("check_embedding_status");

/** Run semantic search. */
export const semanticSearch = (query: string, limit?: number) =>
  invoke<SemanticSearchResult[]>("semantic_search", { query, limit });

// ────────────────────────────────────────────────────────
// Group chat dynamics & fun/shareable commands
// ────────────────────────────────────────────────────────

/** Fetch group chat dynamics for a conversation. */
export const getGroupChatDynamics = (chatId: number) =>
  invoke<GroupChatDynamics>("get_group_chat_dynamics", { chatId });

/** Fetch "On This Day" messages for a given date. */
export const getOnThisDay = (chatId?: number, month?: number, day?: number) =>
  invoke<OnThisDayResult>("get_on_this_day", {
    chatId: chatId ?? null,
    month: month ?? new Date().getMonth() + 1,
    day: day ?? new Date().getDate(),
  });

/** Fetch your texting personality profile. */
export const getTextingPersonality = (chatId?: number) =>
  invoke<TextingPersonality>("get_texting_personality", {
    chatId: chatId ?? null,
  });
