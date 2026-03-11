/** A handle (phone number or email) */
export interface Handle {
  rowid: number;
  id: string;
  service: string;
  personCentricId: string | null;
}

/** A chat conversation (1:1 or group) */
export interface Chat {
  rowid: number;
  guid: string;
  displayName: string | null;
  chatIdentifier: string;
  serviceName: string | null;
  /** 43 = group, 45 = DM */
  style: number;
  participants: Handle[];
  lastMessageDate: number | null;
  lastMessageText: string | null;
}

/** A single iMessage / SMS message */
export interface Message {
  rowid: number;
  guid: string;
  text: string | null;
  isFromMe: boolean;
  /** Unix milliseconds */
  date: number;
  dateRead: number | null;
  dateDelivered: number | null;
  handleId: number;
  sender: string | null;
  service: string | null;
  associatedMessageType: number;
  associatedMessageGuid: string | null;
  cacheHasAttachments: boolean;
  threadOriginatorGuid: string | null;
  groupTitle: string | null;
  isAudioMessage: boolean;
  chatId: number | null;
}

/** A file attachment linked to a message */
export interface Attachment {
  rowid: number;
  guid: string;
  filename: string | null;
  mimeType: string | null;
  uti: string | null;
  transferName: string | null;
  totalBytes: number;
  isOutgoing: boolean;
  messageId: number;
}

// ── Wrapped / Analytics types (matching Rust backend) ──────────

export interface SentReceived<T> {
  sent: T;
  received: T;
}

export interface ChatStat {
  chatId: number;
  messageCount: number;
}

export interface HandleStat {
  handleId: number;
  messageCount: number;
}

export interface WeekdayStat {
  weekday: string;
  messageCount: number;
}

export interface MonthlyStat {
  month: string;
  messageCount: number;
}

export interface OpenerStat {
  text: string;
  count: number;
}

export interface MessageCount {
  sent: number;
  received: number;
}

export interface WrappedStats {
  messageCount: MessageCount;
  chatInteractions: SentReceived<ChatStat[]>;
  handleInteractions: SentReceived<HandleStat[]> | null;
  weekdayInteractions: SentReceived<WeekdayStat[]>;
  monthlyInteractions: SentReceived<MonthlyStat[]>;
  lateNightInteractions: SentReceived<ChatStat[]>;
  mostPopularOpeners: SentReceived<OpenerStat[]>;
}

/** Embedding / semantic search status */
export interface EmbeddingStatus {
  ollamaRunning: boolean;
  modelAvailable: boolean;
  totalEmbedded: number;
  totalMessages: number;
}

export interface SemanticSearchResult {
  messageRowid: number;
  score: number;
  text: string;
}
