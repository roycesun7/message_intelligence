"use client";

import { useMemo } from "react";
import {
  useWrappedStats,
  useTemporalTrends,
  useResponseTimeStats,
  useInitiationStats,
  useMessageLengthStats,
  useActiveHours,
} from "@/hooks/use-analytics";
import { useChats } from "@/hooks/use-messages";
import { getChatDisplayName } from "@/hooks/use-messages";
import { useAppStore } from "@/stores/app-store";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from "recharts";
import {
  MessageSquare,
  Send,
  Inbox,
  Users,
  TrendingUp,
  Moon,
  Clock,
  MessageCircle,
  AlignLeft,
  Activity,
  CalendarDays,
} from "lucide-react";
import dayjs from "dayjs";
import { GroupDynamics } from "./group-dynamics";
import { FunStats } from "./fun-stats";
import { OnThisDaySection } from "./on-this-day";
import { WordFrequencySection } from "./word-frequency";
import { FirstMessageCard } from "./first-message";
import { MessageHeatmap } from "./message-heatmap";
import { EmojiFrequencySection } from "./emoji-frequency";
import { RelationshipTimeline } from "./relationship-timeline";
import type { Chat, DailyMessageCount } from "@/types";

// ── Constants ───────────────────────────────────────────

const MONTH_ORDER = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DAY_ORDER = [
  "Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday",
];

const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: "rgba(250, 250, 247, 0.97)",
    border: "1px solid rgba(7, 23, 57, 0.08)",
    borderRadius: "12px",
    color: "#071739",
    backdropFilter: "blur(12px)",
    padding: "10px 14px",
    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.12)",
  },
};

const MONTH_COLORS = [
  "#1B2432", "#4E5D6E", "#3B82C4", "#94A3B3",
  "#D1D5DB", "#4E5D6E", "#1B2432", "#3B82C4",
  "#94A3B3", "#4E5D6E", "#1B2432", "#3B82C4",
];

const DAY_COLORS = [
  "#3B82C4", "#1B2432", "#4E5D6E", "#94A3B3",
  "#D1D5DB", "#4E5D6E", "#1B2432",
];

const YEAR_COLORS = [
  "#1B2432", "#4E5D6E", "#3B82C4", "#94A3B3",
  "#D1D5DB", "#4E5D6E", "#1B2432", "#3B82C4",
  "#94A3B3", "#4E5D6E",
];

const GRID_STROKE = "rgba(27, 36, 50, 0.06)";
const AXIS_TICK = { fill: "#94A3B3", fontSize: 11 };

// ── Stat Card ───────────────────────────────────────────

function StatCard({
  title,
  value,
  icon: Icon,
  gradient,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  gradient: string;
}) {
  return (
    <Card className={`border-0 ${gradient} text-white stat-glow rounded-2xl`}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wider opacity-80">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 opacity-50" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tracking-tight">
          {typeof value === "number" ? value.toLocaleString() : value}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Helpers ─────────────────────────────────────────────

/** Combine sent + received arrays by matching on a key, summing messageCount */
function combineByKey<T extends { messageCount: number }>(
  sent: T[],
  received: T[],
  keyFn: (item: T) => string,
): { key: string; sent: number; received: number; total: number }[] {
  const map = new Map<string, { sent: number; received: number }>();
  for (const item of sent) {
    const k = keyFn(item);
    const existing = map.get(k) || { sent: 0, received: 0 };
    existing.sent += item.messageCount;
    map.set(k, existing);
  }
  for (const item of received) {
    const k = keyFn(item);
    const existing = map.get(k) || { sent: 0, received: 0 };
    existing.received += item.messageCount;
    map.set(k, existing);
  }
  return Array.from(map.entries())
    .map(([key, v]) => ({ key, sent: v.sent, received: v.received, total: v.sent + v.received }))
    .sort((a, b) => b.total - a.total);
}

/** Resolve a chat_id to a display name */
function resolveChatName(chatId: number, chatMap: Map<number, Chat>): string {
  const chat = chatMap.get(chatId);
  return getChatDisplayName(chat) || `Chat ${chatId}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return "12a";
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return "12p";
  return `${hour - 12}p`;
}

// ── Temporal data aggregation ───────────────────────────

interface AggregatedPoint {
  label: string;
  sent: number;
  received: number;
  total: number;
}

function aggregateTemporalData(data: DailyMessageCount[]): {
  points: AggregatedPoint[];
  granularity: "daily" | "weekly" | "monthly";
} {
  if (data.length === 0) return { points: [], granularity: "daily" };

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const firstDate = dayjs(sorted[0].date);
  const lastDate = dayjs(sorted[sorted.length - 1].date);
  const spanMonths = lastDate.diff(firstDate, "month");

  if (spanMonths <= 6) {
    return {
      granularity: "daily",
      points: sorted.map((d) => ({
        label: d.date,
        sent: d.sent,
        received: d.received,
        total: d.sent + d.received,
      })),
    };
  }

  if (spanMonths <= 36) {
    const buckets = new Map<string, { sent: number; received: number }>();
    for (const d of sorted) {
      const weekStart = dayjs(d.date).startOf("week").format("YYYY-MM-DD");
      const existing = buckets.get(weekStart) || { sent: 0, received: 0 };
      existing.sent += d.sent;
      existing.received += d.received;
      buckets.set(weekStart, existing);
    }
    const points = Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, v]) => ({
        label,
        sent: v.sent,
        received: v.received,
        total: v.sent + v.received,
      }));
    return { granularity: "weekly", points };
  }

  const buckets = new Map<string, { sent: number; received: number }>();
  for (const d of sorted) {
    const monthKey = d.date.slice(0, 7);
    const existing = buckets.get(monthKey) || { sent: 0, received: 0 };
    existing.sent += d.sent;
    existing.received += d.received;
    buckets.set(monthKey, existing);
  }
  const points = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, v]) => ({
      label,
      sent: v.sent,
      received: v.received,
      total: v.sent + v.received,
    }));
  return { granularity: "monthly", points };
}

function formatTrendDate(label: string, granularity: "daily" | "weekly" | "monthly"): string {
  const d = dayjs(label);
  if (granularity === "monthly") return d.format("MMM YYYY");
  if (granularity === "weekly") return d.format("MMM DD, YYYY");
  return d.format("MMM DD");
}

// ── Year Selector ───────────────────────────────────────

function YearSelector() {
  const year = useAppStore((s) => s.wrappedYear);
  const setYear = useAppStore((s) => s.setWrappedYear);

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 10 }, (_, i) => currentYear - i);

  return (
    <select
      value={year}
      onChange={(e) => setYear(Number(e.target.value))}
      className="h-8 rounded-full border border-[#D1D5DB] dark:border-zinc-600 bg-white dark:bg-zinc-800 px-4 text-[13px] text-[#1B2432] dark:text-zinc-200 outline-none cursor-pointer"
    >
      <option value={0}>All Time</option>
      {years.map((y) => (
        <option key={y} value={y}>{y}</option>
      ))}
    </select>
  );
}

// ── Tab Bar ─────────────────────────────────────────────

function TabBar({
  tabs,
  active,
  onSelect,
}: {
  tabs: { key: string; label: string }[];
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="wrapped-tab-bar">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          className={`wrapped-tab ${active === tab.key ? "active" : ""}`}
          onClick={() => onSelect(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ── Temporal Trends Chart (Recharts AreaChart) ──────────

function TemporalTrendsChart({ chatId, year }: { chatId: number; year: number }) {
  const { data: trends, isLoading } = useTemporalTrends(chatId, year === 0 ? undefined : year);

  const { points, granularity } = useMemo(
    () => aggregateTemporalData(trends ?? []),
    [trends],
  );

  if (isLoading) {
    return (
      <Card className="card-glass">
        <CardHeader className="flex flex-row items-center gap-2">
          <TrendingUp className="h-5 w-5 text-[#4E5D6E] dark:text-blue-400" />
          <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
            Your Conversation Timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="flex h-[300px] items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#D1D5DB] dark:border-zinc-600 border-t-[#4E5D6E] dark:border-t-blue-500" />
        </CardContent>
      </Card>
    );
  }

  if (!trends || points.length === 0) return null;

  return (
    <Card className="card-glass">
      <CardHeader className="flex flex-row items-center gap-2">
        <TrendingUp className="h-5 w-5 text-[#4E5D6E] dark:text-blue-400" />
        <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
          Message Volume Over Time
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradientSent" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1B2432" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#1B2432" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="gradientReceived" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3B82C4" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#3B82C4" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
            <XAxis
              dataKey="label"
              tick={AXIS_TICK}
              tickFormatter={(v: string) => formatTrendDate(v, granularity)}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis tick={AXIS_TICK} width={35} />
            <Tooltip
              {...CHART_TOOLTIP_STYLE}
              labelFormatter={(label) => formatTrendDate(String(label), granularity)}
              formatter={(value, name) => {
                const displayName = name === "sent" ? "Sent" : "Received";
                return [Number(value).toLocaleString(), displayName];
              }}
              itemSorter={() => 0}
            />
            <Area
              type="monotone"
              dataKey="received"
              stroke="#3B82C4"
              fill="url(#gradientReceived)"
              strokeWidth={1.5}
            />
            <Area
              type="monotone"
              dataKey="sent"
              stroke="#1B2432"
              fill="url(#gradientSent)"
              strokeWidth={1.5}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ── Between You Two Tab (per-chat 1:1) ──────────────────

function BetweenYouTwoTab({ chatId }: { chatId: number }) {
  const { data: responseTime } = useResponseTimeStats(chatId);
  const { data: initiation } = useInitiationStats(chatId);
  const { data: msgLength } = useMessageLengthStats(chatId);
  const { data: activeHours } = useActiveHours(chatId);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Response Time */}
        {responseTime && (
          <Card className="card-glass">
            <CardHeader className="flex flex-row items-center gap-2">
              <Clock className="h-5 w-5 text-[#4E5D6E] dark:text-blue-400" />
              <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
                Who Replies Faster
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="mb-2 text-sm font-medium text-[#4E5D6E] dark:text-blue-400">You</p>
                  <p className="text-2xl font-bold text-[#1B2432] dark:text-white">
                    {formatDuration(responseTime.myAvgResponseSecs)}
                  </p>
                  <p className="mt-0.5 text-xs text-[#94A3B3] dark:text-zinc-500">avg response</p>
                  <div className="mt-3 space-y-1">
                    <p className="text-xs text-[#4E5D6E] dark:text-zinc-400">
                      Median: <span className="text-[#1B2432] dark:text-zinc-200">{formatDuration(responseTime.myMedianResponseSecs)}</span>
                    </p>
                    <p className="text-xs text-[#4E5D6E] dark:text-zinc-400">
                      Fastest: <span className="text-[#1B2432] dark:text-zinc-200">{formatDuration(responseTime.myFastestResponseSecs)}</span>
                    </p>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium text-[#3B82C4] dark:text-purple-400">Them</p>
                  <p className="text-2xl font-bold text-[#1B2432] dark:text-white">
                    {formatDuration(responseTime.theirAvgResponseSecs)}
                  </p>
                  <p className="mt-0.5 text-xs text-[#94A3B3] dark:text-zinc-500">avg response</p>
                  <div className="mt-3 space-y-1">
                    <p className="text-xs text-[#4E5D6E] dark:text-zinc-400">
                      Median: <span className="text-[#1B2432] dark:text-zinc-200">{formatDuration(responseTime.theirMedianResponseSecs)}</span>
                    </p>
                    <p className="text-xs text-[#4E5D6E] dark:text-zinc-400">
                      Fastest: <span className="text-[#1B2432] dark:text-zinc-200">{formatDuration(responseTime.theirFastestResponseSecs)}</span>
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-[#D1D5DB]/30 dark:bg-zinc-800">
                  <div
                    className="bg-[#4E5D6E] dark:bg-blue-500 transition-all"
                    style={{
                      width: `${
                        responseTime.myAvgResponseSecs + responseTime.theirAvgResponseSecs > 0
                          ? (responseTime.theirAvgResponseSecs / (responseTime.myAvgResponseSecs + responseTime.theirAvgResponseSecs)) * 100
                          : 50
                      }%`,
                    }}
                  />
                  <div
                    className="bg-[#3B82C4] dark:bg-purple-500 transition-all"
                    style={{
                      width: `${
                        responseTime.myAvgResponseSecs + responseTime.theirAvgResponseSecs > 0
                          ? (responseTime.myAvgResponseSecs / (responseTime.myAvgResponseSecs + responseTime.theirAvgResponseSecs)) * 100
                          : 50
                      }%`,
                    }}
                  />
                </div>
                <p className="mt-1 text-center text-[10px] text-[#94A3B3] dark:text-zinc-600">
                  Faster responder has more bar
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Conversation Initiation */}
        {initiation && (
          <Card className="card-glass">
            <CardHeader className="flex flex-row items-center gap-2">
              <MessageCircle className="h-5 w-5 text-[#3B82C4] dark:text-green-400" />
              <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
                Who Texts First
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-1 text-2xl font-bold text-[#1B2432] dark:text-white">
                You start{" "}
                <span className="text-[#4E5D6E] dark:text-blue-400">
                  {Math.round(initiation.myRatio * 100)}%
                </span>{" "}
                of conversations
              </p>
              <p className="mb-4 text-xs text-[#94A3B3] dark:text-zinc-500">
                {initiation.totalConversations.toLocaleString()} total conversations tracked
              </p>
              <div className="mb-2 flex h-6 w-full overflow-hidden rounded-full bg-[#D1D5DB]/30 dark:bg-zinc-800">
                <div
                  className="flex items-center justify-center bg-[#4E5D6E] dark:bg-blue-500 text-[10px] font-bold text-white transition-all"
                  style={{ width: `${Math.max(initiation.myRatio * 100, 5)}%` }}
                >
                  {initiation.myRatio > 0.15 && `${initiation.myInitiations}`}
                </div>
                <div
                  className="flex items-center justify-center bg-[#94A3B3] dark:bg-zinc-600 text-[10px] font-bold text-white transition-all"
                  style={{ width: `${Math.max((1 - initiation.myRatio) * 100, 5)}%` }}
                >
                  {initiation.myRatio < 0.85 && `${initiation.theirInitiations}`}
                </div>
              </div>
              <div className="flex justify-between text-xs text-[#4E5D6E] dark:text-zinc-400">
                <span>You ({initiation.myInitiations})</span>
                <span>Them ({initiation.theirInitiations})</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Message Length */}
        {msgLength && (
          <Card className="card-glass">
            <CardHeader className="flex flex-row items-center gap-2">
              <AlignLeft className="h-5 w-5 text-[#3B82C4] dark:text-amber-400" />
              <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
                Who Writes More
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-3">
                  <p className="text-sm font-medium text-[#4E5D6E] dark:text-blue-400">You</p>
                  <div>
                    <p className="text-2xl font-bold text-[#1B2432] dark:text-white">
                      {Math.round(msgLength.myAvgLength).toLocaleString()}
                    </p>
                    <p className="text-xs text-[#94A3B3] dark:text-zinc-500">avg chars / message</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#1B2432] dark:text-zinc-200">{msgLength.myTotalChars.toLocaleString()}</p>
                    <p className="text-xs text-[#94A3B3] dark:text-zinc-500">total characters</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#1B2432] dark:text-zinc-200">{msgLength.myTotalMessages.toLocaleString()}</p>
                    <p className="text-xs text-[#94A3B3] dark:text-zinc-500">messages sent</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#1B2432] dark:text-zinc-200">{msgLength.myMaxLength.toLocaleString()}</p>
                    <p className="text-xs text-[#94A3B3] dark:text-zinc-500">longest message</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <p className="text-sm font-medium text-[#3B82C4] dark:text-purple-400">Them</p>
                  <div>
                    <p className="text-2xl font-bold text-[#1B2432] dark:text-white">
                      {Math.round(msgLength.theirAvgLength).toLocaleString()}
                    </p>
                    <p className="text-xs text-[#94A3B3] dark:text-zinc-500">avg chars / message</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#1B2432] dark:text-zinc-200">{msgLength.theirTotalChars.toLocaleString()}</p>
                    <p className="text-xs text-[#94A3B3] dark:text-zinc-500">total characters</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#1B2432] dark:text-zinc-200">{msgLength.theirTotalMessages.toLocaleString()}</p>
                    <p className="text-xs text-[#94A3B3] dark:text-zinc-500">messages sent</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#1B2432] dark:text-zinc-200">{msgLength.theirMaxLength.toLocaleString()}</p>
                    <p className="text-xs text-[#94A3B3] dark:text-zinc-500">longest message</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Active Hours (Recharts) */}
        {activeHours && activeHours.length > 0 && (
          <Card className="card-glass">
            <CardHeader className="flex flex-row items-center gap-2">
              <Activity className="h-5 w-5 text-[#4E5D6E] dark:text-cyan-400" />
              <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
                When You Both Text
              </CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={activeHours}
                  margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                  <XAxis
                    dataKey="hour"
                    tick={AXIS_TICK}
                    tickFormatter={(v: number) => formatHourLabel(v)}
                    interval={2}
                  />
                  <YAxis tick={AXIS_TICK} width={35} />
                  <Tooltip
                    {...CHART_TOOLTIP_STYLE}
                    labelFormatter={(label) => formatHourLabel(Number(label))}
                    formatter={(value, name) => [
                      Number(value).toLocaleString(),
                      name === "myMessages" ? "You" : "Them",
                    ]}
                  />
                  <Legend
                    formatter={(value: string) =>
                      value === "myMessages" ? "You" : "Them"
                    }
                  />
                  <Bar
                    dataKey="myMessages"
                    fill="#1B2432"
                    radius={[6, 6, 0, 0]}
                  />
                  <Bar
                    dataKey="theirMessages"
                    fill="#3B82C4"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ── Main Wrapped View ───────────────────────────────────

export function WrappedView() {
  const year = useAppStore((s) => s.wrappedYear);
  const wrappedChatId = useAppStore((s) => s.wrappedChatId);
  const wrappedTab = useAppStore((s) => s.wrappedTab);
  const setWrappedTab = useAppStore((s) => s.setWrappedTab);

  const chatIds = wrappedChatId !== null ? [wrappedChatId] : undefined;
  const { data: stats, isLoading, isError } = useWrappedStats(year, chatIds);
  const { data: chats } = useChats();

  const isPerChat = wrappedChatId !== null;

  const chatMap = new Map<number, Chat>();
  if (chats) {
    for (const chat of chats) {
      chatMap.set(chat.rowid, chat);
    }
  }

  const selectedChat = wrappedChatId !== null ? chatMap.get(wrappedChatId) : undefined;
  const isGroupChat = selectedChat?.style === 43;

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center bg-[#ECEEF2] dark:bg-zinc-950 text-[#94A3B3] dark:text-zinc-500">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#D1D5DB] dark:border-zinc-600 border-t-[#4E5D6E] dark:border-t-blue-500" />
          <p className="text-sm">Crunching your numbers...</p>
        </div>
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3 bg-[#ECEEF2] dark:bg-zinc-950 text-[#94A3B3] dark:text-zinc-500">
        <p className="text-lg font-medium text-red-500 dark:text-red-400">
          Failed to load stats
        </p>
        <p className="text-sm">
          Make sure Full Disk Access is granted and the backend is running.
        </p>
      </div>
    );
  }

  const totalMessages = stats.messageCount.sent + stats.messageCount.received;

  // Data transformations
  const topChats = combineByKey(
    stats.chatInteractions.sent,
    stats.chatInteractions.received,
    (c) => String(c.chatId),
  ).slice(0, 10);

  const monthlyData = combineByKey(
    stats.monthlyInteractions.sent,
    stats.monthlyInteractions.received,
    (m) => m.month,
  ).sort((a, b) => MONTH_ORDER.indexOf(a.key) - MONTH_ORDER.indexOf(b.key));

  const weekdayData = combineByKey(
    stats.weekdayInteractions.sent,
    stats.weekdayInteractions.received,
    (d) => d.weekday,
  ).sort((a, b) => DAY_ORDER.indexOf(a.key) - DAY_ORDER.indexOf(b.key));

  const yearlyData = combineByKey(
    stats.yearlyInteractions?.sent ?? [],
    stats.yearlyInteractions?.received ?? [],
    (y) => y.year,
  ).sort((a, b) => a.key.localeCompare(b.key));

  const lateNightChats = combineByKey(
    stats.lateNightInteractions.sent,
    stats.lateNightInteractions.received,
    (c) => String(c.chatId),
  ).slice(0, 10);

  const topOpeners = [
    ...stats.mostPopularOpeners.sent,
    ...stats.mostPopularOpeners.received,
  ]
    .reduce((acc, o) => {
      const existing = acc.find((x) => x.text === o.text);
      if (existing) existing.count += o.count;
      else acc.push({ ...o });
      return acc;
    }, [] as { text: string; count: number }[])
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const uniqueChatIds = new Set([
    ...stats.chatInteractions.sent.map((c) => c.chatId),
    ...stats.chatInteractions.received.map((c) => c.chatId),
  ]);

  // Late night totals
  const lnTotal = lateNightChats.reduce((sum, c) => sum + c.total, 0);
  const lnSent = lateNightChats.reduce((sum, c) => sum + c.sent, 0);
  const lnReceived = lateNightChats.reduce((sum, c) => sum + c.received, 0);

  // Tabs
  const tabs = isPerChat
    ? isGroupChat
      ? [
          { key: "overview", label: "Overview" },
          { key: "group", label: "The Group Chat" },
          { key: "patterns", label: "Over Time" },
          { key: "fun", label: "Fun" },
        ]
      : [
          { key: "overview", label: "Overview" },
          { key: "between", label: "Between You Two" },
          { key: "patterns", label: "Over Time" },
          { key: "fun", label: "Fun" },
        ]
    : [
        { key: "overview", label: "Overview" },
        { key: "patterns", label: "Over Time" },
        { key: "people", label: "People" },
        { key: "fun", label: "Fun" },
      ];

  return (
    <div className="bg-[#ECEEF2] dark:bg-zinc-950 p-6 max-w-[800px] mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-[#1B2432] dark:text-white">
            {year === 0 ? "All-Time" : year} Wrapped
            {isPerChat && (
              <>
                {" — "}
                <span className="text-[22px] font-bold text-[#3B82C4]">
                  {resolveChatName(wrappedChatId, chatMap)}
                </span>
              </>
            )}
          </h1>
          <p className="mt-1 text-sm text-[#94A3B3] dark:text-zinc-500">
            {isPerChat ? "Your conversation at a glance" : "Your iMessage story, by the numbers"}
          </p>
        </div>
        <YearSelector />
      </div>

      {/* Big number cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          title="Total Messages"
          value={totalMessages}
          icon={MessageSquare}
          gradient="bg-gradient-to-br from-[#1B2432] to-[#3B82C4]"
        />
        <StatCard
          title="Sent"
          value={stats.messageCount.sent}
          icon={Send}
          gradient="bg-gradient-to-br from-[#4E5D6E] to-[#94A3B3]"
        />
        <StatCard
          title="Received"
          value={stats.messageCount.received}
          icon={Inbox}
          gradient="bg-gradient-to-br from-[#3B82C4] to-[#1B2432]"
        />
        {isPerChat && (
          <StatCard
            title="Active Days"
            value={stats.messageCount.daysActive}
            icon={CalendarDays}
            gradient="bg-gradient-to-br from-[#1B2432] to-[#4E5D6E]"
          />
        )}
        {!isPerChat && (
          <StatCard
            title="Active Chats"
            value={uniqueChatIds.size}
            icon={Users}
            gradient="bg-gradient-to-br from-[#1B2432] to-[#4E5D6E]"
          />
        )}
      </div>

      {/* Tab Bar */}
      <TabBar tabs={tabs} active={wrappedTab} onSelect={setWrappedTab} />

      {/* ═══════ OVERVIEW TAB ═══════ */}
      {wrappedTab === "overview" && (
        <div>
          {/* Per-chat: Temporal trends */}
          {isPerChat && (
            <div className="mb-6">
              <TemporalTrendsChart chatId={wrappedChatId} year={year} />
            </div>
          )}

          {/* Per-chat group: First Message */}
          {isPerChat && isGroupChat && (
            <div className="mb-6">
              <FirstMessageCard chatId={wrappedChatId} />
            </div>
          )}

          {/* On This Day */}
          {year === 0 && (
            <div className="mb-6">
              <OnThisDaySection chatId={wrappedChatId} />
            </div>
          )}

          {/* Year by Year — all-time overview */}
          {!isPerChat && year === 0 && yearlyData.length > 1 && (
            <Card className="mb-6 card-glass">
              <CardHeader>
                <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
                  Your Year by Year
                </CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={yearlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                    <XAxis dataKey="key" tick={AXIS_TICK} />
                    <YAxis tick={AXIS_TICK} width={35} />
                    <Tooltip
                      {...CHART_TOOLTIP_STYLE}
                      formatter={(value, name) => [
                        Number(value).toLocaleString(),
                        name === "sent" ? "Sent" : name === "received" ? "Received" : "Total",
                      ]}
                    />
                    <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                      {yearlyData.map((_entry, index) => (
                        <Cell
                          key={index}
                          fill={YEAR_COLORS[index % YEAR_COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Top People — all-time only */}
          {!isPerChat && (
            <Card className="card-glass">
              <CardHeader>
                <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
                  Your Top People
                </CardTitle>
              </CardHeader>
              <CardContent>
                {topChats.length === 0 ? (
                  <p className="text-sm text-[#94A3B3] dark:text-zinc-500">No data available.</p>
                ) : (
                  <ol className="space-y-2.5">
                    {topChats.map((c, i) => {
                      const pct = (c.total / (topChats[0]?.total || 1)) * 100;
                      const name = resolveChatName(Number(c.key), chatMap);
                      return (
                        <li key={c.key} className="flex items-center gap-3">
                          <span className="w-5 text-right text-xs font-bold text-[#94A3B3] dark:text-zinc-500">
                            {i + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-[#1B2432] dark:text-zinc-200 truncate">
                                {name}
                              </span>
                              <span className="ml-2 text-xs text-[#4E5D6E] dark:text-zinc-400">
                                {c.total.toLocaleString()}
                              </span>
                            </div>
                            <div className="mt-1 h-1 w-full rounded-full bg-[#D1D5DB]/30 dark:bg-white/[0.06]">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-[#1B2432] to-[#3B82C4] dark:from-blue-400 dark:to-purple-400"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ═══════ OVER TIME TAB ═══════ */}
      {wrappedTab === "patterns" && (
        <div>
          {/* Message Heatmap */}
          <div className="mb-6">
            <MessageHeatmap chatId={wrappedChatId} year={year} />
          </div>

          {/* Conversation Timeline */}
          {isPerChat && (
            <div className="mb-6">
              <RelationshipTimeline chatId={wrappedChatId} />
            </div>
          )}

          {/* Two-column: Month + Day charts */}
          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Messages by month */}
            <Card className="card-glass">
              <CardHeader>
                <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
                  Your Busiest Months
                </CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                {monthlyData.length === 0 ? (
                  <p className="text-sm text-[#94A3B3] dark:text-zinc-500">No data available.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                      <XAxis
                        dataKey="key"
                        tick={AXIS_TICK}
                        tickFormatter={(v: string) => v.slice(0, 3)}
                      />
                      <YAxis tick={AXIS_TICK} width={35} />
                      <Tooltip
                        {...CHART_TOOLTIP_STYLE}
                        formatter={(value, name) => [
                          Number(value).toLocaleString(),
                          name === "total" ? "Total" : name === "sent" ? "Sent" : "Received",
                        ]}
                      />
                      <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                        {monthlyData.map((_entry, index) => (
                          <Cell
                            key={index}
                            fill={MONTH_COLORS[index % MONTH_COLORS.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Messages by day of week */}
            <Card className="card-glass">
              <CardHeader>
                <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
                  Your Favorite Days
                </CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                {weekdayData.length === 0 ? (
                  <p className="text-sm text-[#94A3B3] dark:text-zinc-500">No data available.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weekdayData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                      <XAxis
                        dataKey="key"
                        tick={AXIS_TICK}
                        tickFormatter={(v: string) => v.slice(0, 3)}
                      />
                      <YAxis tick={AXIS_TICK} width={35} />
                      <Tooltip
                        {...CHART_TOOLTIP_STYLE}
                      />
                      <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                        {weekdayData.map((_entry, index) => (
                          <Cell
                            key={index}
                            fill={DAY_COLORS[index % DAY_COLORS.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Year by Year — all-time only */}
          {!isPerChat && year === 0 && yearlyData.length > 1 && (
            <Card className="mb-6 card-glass">
              <CardHeader>
                <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
                  Your Year by Year
                </CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={yearlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                    <XAxis dataKey="key" tick={AXIS_TICK} />
                    <YAxis tick={AXIS_TICK} width={35} />
                    <Tooltip
                      {...CHART_TOOLTIP_STYLE}
                      formatter={(value, name) => [
                        Number(value).toLocaleString(),
                        name === "sent" ? "Sent" : name === "received" ? "Received" : "Total",
                      ]}
                    />
                    <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                      {yearlyData.map((_entry, index) => (
                        <Cell
                          key={index}
                          fill={YEAR_COLORS[index % YEAR_COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

        </div>
      )}

      {/* ═══════ PEOPLE TAB (all-time only) ═══════ */}
      {wrappedTab === "people" && !isPerChat && (
        <Card className="card-glass">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
              All Conversations — ranked by total messages
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topChats.length === 0 ? (
              <p className="text-sm text-[#94A3B3] dark:text-zinc-500">No data available.</p>
            ) : (
              <ol className="space-y-2.5">
                {topChats.map((c, i) => {
                  const pct = (c.total / (topChats[0]?.total || 1)) * 100;
                  const name = resolveChatName(Number(c.key), chatMap);
                  return (
                    <li key={c.key} className="flex items-center gap-3">
                      <span className="w-5 text-right text-xs font-bold text-[#94A3B3] dark:text-zinc-500">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-[#1B2432] dark:text-zinc-200 truncate">
                            {name}
                          </span>
                          <span className="ml-2 text-xs text-[#4E5D6E] dark:text-zinc-400">
                            {c.total.toLocaleString()}
                          </span>
                        </div>
                        <div className="mt-1 h-1 w-full rounded-full bg-[#D1D5DB]/30 dark:bg-white/[0.06]">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[#1B2432] to-[#3B82C4] dark:from-blue-400 dark:to-purple-400"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══════ BETWEEN YOU TWO TAB (1:1 per-chat) ═══════ */}
      {wrappedTab === "between" && isPerChat && !isGroupChat && (
        <div>
          <div className="mb-6">
            <FirstMessageCard chatId={wrappedChatId} />
          </div>
          <BetweenYouTwoTab chatId={wrappedChatId} />
        </div>
      )}

      {/* ═══════ THE GROUP CHAT TAB (group per-chat) ═══════ */}
      {wrappedTab === "group" && isPerChat && isGroupChat && (
        <GroupDynamics chatId={wrappedChatId} />
      )}

      {/* ═══════ FUN TAB ═══════ */}
      {wrappedTab === "fun" && (
        <div>
          {/* Personality */}
          <div className="mb-6">
            <FunStats chatId={wrappedChatId} />
          </div>

          {/* Late Night */}
          <div className="mb-6">
            <Card className="card-glass">
              <CardHeader className="flex flex-row items-center gap-2">
                <Moon className="h-5 w-5 text-[#1B2432] dark:text-indigo-400" />
                <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
                  {isPerChat ? "Night Owl Mode" : "Your Late Night Crew"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-xs text-[#94A3B3] dark:text-zinc-500">Messages sent 10 PM – 5 AM</p>

                {lateNightChats.length === 0 ? (
                  <p className="text-sm text-[#94A3B3] dark:text-zinc-500">No late-night activity.</p>
                ) : isPerChat ? (
                  <div>
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-2xl font-bold text-[#1B2432] dark:text-white">
                        {lnTotal.toLocaleString()}
                      </span>
                      <span className="text-sm text-[#4E5D6E] dark:text-zinc-400">
                        late night messages ({totalMessages > 0 ? ((lnTotal / totalMessages) * 100).toFixed(1) : "0"}% of all)
                      </span>
                    </div>
                    <div className="flex gap-4 mt-3 text-sm">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-[#007AFF]" />
                        <span className="font-semibold text-[#1B2432] dark:text-zinc-200">{lnSent.toLocaleString()}</span>
                        <span className="text-[#94A3B3] dark:text-zinc-500">sent</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-[#94A3B3] dark:bg-zinc-500" />
                        <span className="font-semibold text-[#1B2432] dark:text-zinc-200">{lnReceived.toLocaleString()}</span>
                        <span className="text-[#94A3B3] dark:text-zinc-500">received</span>
                      </div>
                    </div>
                    {lnTotal > 0 && (
                      <div className="h-1.5 rounded-full bg-[#1B2432]/[0.06] dark:bg-white/[0.06] mt-3 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#007AFF]"
                          style={{ width: `${(lnSent / lnTotal) * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <ol className="space-y-1.5">
                    {lateNightChats.map((c, i) => {
                      const name = resolveChatName(Number(c.key), chatMap);
                      return (
                        <li key={c.key} className="flex items-center justify-between py-1.5">
                          <span className="flex items-center gap-2">
                            <span className="w-5 text-right text-xs font-bold text-[#94A3B3] dark:text-zinc-500">{i + 1}</span>
                            <span className="text-sm font-medium text-[#1B2432] dark:text-zinc-200 truncate">{name}</span>
                          </span>
                          <span className="text-sm text-[#4E5D6E] dark:text-zinc-400">{c.total.toLocaleString()}</span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Emoji Frequency */}
            <EmojiFrequencySection
              chatId={wrappedChatId}
              year={year}
            />

            {/* Word Cloud */}
            <WordFrequencySection
              year={year}
              chatIds={wrappedChatId !== null ? [wrappedChatId] : undefined}
            />

            {/* Conversation Openers */}
            {topOpeners.length > 0 && (
              <Card className="card-glass">
                <CardHeader>
                  <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
                    How You Start Conversations
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {topOpeners.map((o) => (
                      <span
                        key={o.text}
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#1B2432]/[0.04] dark:bg-white/[0.06] px-3.5 py-2 text-[13px] text-[#1B2432] dark:text-zinc-200"
                      >
                        &ldquo;{o.text}&rdquo;
                        <span className="text-[11px] text-[#94A3B3] dark:text-zinc-500">
                          x{o.count}
                        </span>
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
