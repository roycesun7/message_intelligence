export interface Handle {
  rowid: number;
  id: string;
  service: string;
  personCentricId: string | null;
  displayName: string | null;
}

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

export interface Message {
  rowid: number;
  guid: string;
  text: string | null;
  isFromMe: boolean;
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

export interface AttachmentData {
  rowid: number;
  guid: string;
  filename: string | null;
  mimeType: string | null;
  uti: string | null;
  transferName: string | null;
  totalBytes: number;
  isOutgoing: boolean;
  dataUrl: string | null;
}

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
  daysActive: number;
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

export interface DailyMessageCount {
  date: string;
  sent: number;
  received: number;
}

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

export interface EmbeddingStatus {
  modelsLoaded: boolean;
  totalEmbedded: number;
  totalMessages: number;
  indexTarget: number;
  chunkCount: number;
  messageCount: number;
  attachmentCount: number;
}

export interface ChunkMessage {
  rowid: number;
  text: string | null;
  isFromMe: boolean;
  senderDisplayName: string | null;
  date: number;
}

export interface SemanticSearchResult {
  sourceType: string;
  sourceId: number;
  messageRowid: number;
  chatId: number;
  score: number;
  text: string | null;
  isFromMe: boolean;
  senderDisplayName: string | null;
  date: number;
  mimeType: string | null;
  attachmentPath: string | null;
  linkUrl: string | null;
  linkDomain: string | null;
  linkTitle: string | null;
  messages: ChunkMessage[] | null;
}

export interface EmbeddingProgress {
  phase: string;
  processed: number;
  total: number;
}

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

export interface WordFrequency {
  word: string;
  count: number;
}

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

export interface FirstMessage {
  text: string | null;
  isFromMe: boolean;
  date: number;
  senderDisplayName: string | null;
}

export interface EmojiFrequency {
  emoji: string;
  count: number;
}

export interface Milestone {
  milestoneType: string;
  chatId: number;
  chatName: string;
  headline: string;
  detail: string | null;
  value: number;
  recentCount: number | null;
  previousCount: number | null;
}
