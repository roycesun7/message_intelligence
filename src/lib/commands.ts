import { invoke } from "@tauri-apps/api/core";
import type {
  Chat,
  Message,
  Attachment,
  WrappedStats,
  EmbeddingStatus,
  SemanticSearchResult,
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

// ────────────────────────────────────────────────────────
// Analytics / Wrapped commands
// ────────────────────────────────────────────────────────

/** Compute "Wrapped"-style stats for a calendar year. Pass 0 for all-time. */
export const getWrappedStats = (year: number) =>
  invoke<WrappedStats>("get_wrapped_stats", { year });

// ────────────────────────────────────────────────────────
// Embedding / AI commands
// ────────────────────────────────────────────────────────

/** Check if the embedding pipeline is ready. */
export const checkEmbeddingStatus = () =>
  invoke<EmbeddingStatus>("check_embedding_status");

/** Run semantic search. */
export const semanticSearch = (query: string, limit?: number) =>
  invoke<SemanticSearchResult[]>("semantic_search", { query, limit });
