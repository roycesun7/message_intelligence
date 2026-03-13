/** A handle (phone number or email) */
export interface Handle {
  rowid: number;
  id: string;
  service: string;
  personCentricId: string | null;
  displayName: string | null;
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
  senderDisplayName: string | null;
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

/** Attachment with optional inline data URL (images are base64-encoded) */
export interface AttachmentData {
  rowid: number;
  guid: string;
  filename: string | null;
  mimeType: string | null;
  uti: string | null;
  transferName: string | null;
  totalBytes: number;
  isOutgoing: boolean;
  /** data:image/...;base64,... for image attachments, null otherwise */
  dataUrl: string | null;
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

export interface YearlyStat {
  year: string;
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
  yearlyInteractions: SentReceived<YearlyStat[]>;
  lateNightInteractions: SentReceived<ChatStat[]>;
  mostPopularOpeners: SentReceived<OpenerStat[]>;
}

/** Daily message count for temporal trend charts */
export interface DailyMessageCount {
  date: string;
  sent: number;
  received: number;
}

// ── Relationship metrics (per-chat Wrapped) ────────────

export interface ResponseTimeStats {
  myAvgResponseSecs: number;
  theirAvgResponseSecs: number;
  myMedianResponseSecs: number;
  theirMedianResponseSecs: number;
  myFastestResponseSecs: number;
  theirFastestResponseSecs: number;
}

export interface InitiationStats {
  myInitiations: number;
  theirInitiations: number;
  myRatio: number;
  totalConversations: number;
}

export interface MessageLengthStats {
  myAvgLength: number;
  theirAvgLength: number;
  myMaxLength: number;
  theirMaxLength: number;
  myTotalChars: number;
  theirTotalChars: number;
  myTotalMessages: number;
  theirTotalMessages: number;
}

export interface HourlyActivity {
  hour: number;
  myMessages: number;
  theirMessages: number;
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

// ── Group Chat Dynamics ────────────────────────────────

export interface ParticipantStats {
  handleId: number;
  displayName: string | null;
  messageCount: number;
  avgMessageLength: number;
  repliesTriggered: number;
  ignoredCount: number;
  firstMessageDate: string;
  lastMessageDate: string;
}

export interface GroupChatDynamics {
  participants: ParticipantStats[];
  totalMessages: number;
  mostActiveParticipant: string | null;
  conversationStarter: string | null;
}

// ── On This Day ────────────────────────────────────────

export interface OnThisDayMessage {
  year: number;
  text: string | null;
  isFromMe: boolean;
  sender: string | null;
  chatDisplayName: string | null;
  date: number;
  chatId: number;
  messageRowid: number;
}

export interface OnThisDayResult {
  messages: OnThisDayMessage[];
  yearsWithMessages: number[];
}

// ── Word Frequency ───────────────────────────────────

export interface WordFrequency {
  word: string;
  count: number;
}

// ── Texting Personality ────────────────────────────────

export interface PersonalityTrait {
  name: string;
  description: string;
  score: number;
}

export interface TextingPersonality {
  primaryType: string;
  secondaryType: string | null;
  traits: PersonalityTrait[];
}
