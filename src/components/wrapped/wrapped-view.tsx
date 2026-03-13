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
import { GroupDynamics } from "./group-dynamics";
import { FunStats } from "./fun-stats";
import { OnThisDaySection } from "./on-this-day";
import {
  MessageSquare,
  Send,
  Inbox,
  Users,
  Calendar,
  TrendingUp,
  Moon,
  Clock,
  MessageCircle,
  AlignLeft,
  Activity,
} from "lucide-react";
import dayjs from "dayjs";
import type {
  Chat,
  WrappedStats,
  DailyMessageCount,
  ResponseTimeStats,
  InitiationStats,
  MessageLengthStats,
  HourlyActivity,
} from "@/types";

// ── Year selector ────────────────────────────────────────
function YearSelector() {
  const year = useAppStore((s) => s.wrappedYear);
  const setYear = useAppStore((s) => s.setWrappedYear);

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 10 }, (_, i) => currentYear - i);

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-zinc-400">Year:</label>
      <select
        value={year}
        onChange={(e) => setYear(Number(e.target.value))}
        className="h-8 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-200 outline-none focus:ring-2 focus:ring-blue-500/40"
      >
        <option value={0}>All Time</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────
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
    <Card className={`border-0 ${gradient} text-white`}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium opacity-90">
          {title}
        </CardTitle>
        <Icon className="h-5 w-5 opacity-70" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">
          {typeof value === "number" ? value.toLocaleString() : value}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Bar chart colours ────────────────────────────────────
const MONTH_COLORS = [
  "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7",
  "#d946ef", "#ec4899", "#f43f5e", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#14b8a6",
];

const DAY_COLORS = [
  "#f97316", "#3b82f6", "#6366f1", "#8b5cf6",
  "#ec4899", "#22c55e", "#eab308",
];

const YEAR_COLORS = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#f97316",
  "#22c55e", "#eab308", "#14b8a6", "#6366f1",
  "#f43f5e", "#a855f7",
];

// ── Helpers ──────────────────────────────────────────────

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

const MONTH_ORDER = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_ORDER = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

// ── Temporal trends helpers ───────────────────────────────

interface AggregatedPoint {
  label: string;
  sent: number;
  received: number;
  total: number;
}

/**
 * Aggregate daily data into appropriate buckets based on date span:
 *   <= 6 months  -> daily (no aggregation)
 *   <= 3 years   -> weekly buckets
 *   > 3 years    -> monthly buckets
 */
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
    // Daily — no aggregation
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
    // Weekly buckets
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

  // Monthly buckets
  const buckets = new Map<string, { sent: number; received: number }>();
  for (const d of sorted) {
    const monthKey = d.date.slice(0, 7); // "YYYY-MM"
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
  // daily
  return d.format("MMM DD");
}

// ── Temporal Trends Chart ────────────────────────────────
function TemporalTrendsChart({ chatId, year }: { chatId: number; year: number }) {
  const { data: trends, isLoading } = useTemporalTrends(chatId, year === 0 ? undefined : year);

  const { points, granularity } = useMemo(
    () => aggregateTemporalData(trends ?? []),
    [trends],
  );

  if (isLoading) {
    return (
      <Card className="border-zinc-800 bg-zinc-900">
        <CardHeader className="flex flex-row items-center gap-2">
          <TrendingUp className="h-5 w-5 text-blue-400" />
          <CardTitle className="text-lg font-semibold text-white">
            Message Volume Over Time
          </CardTitle>
        </CardHeader>
        <CardContent className="flex h-[300px] items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-blue-500" />
        </CardContent>
      </Card>
    );
  }

  if (!trends || points.length === 0) return null;

  return (
    <Card className="border-zinc-800 bg-zinc-900">
      <CardHeader className="flex flex-row items-center gap-2">
        <TrendingUp className="h-5 w-5 text-blue-400" />
        <CardTitle className="text-lg font-semibold text-white">
          Message Volume Over Time
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradientSent" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="gradientReceived" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis
              dataKey="label"
              tick={{ fill: "#999", fontSize: 11 }}
              tickFormatter={(v: string) => formatTrendDate(v, granularity)}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis tick={{ fill: "#999", fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1e1e1e",
                border: "1px solid #333",
                borderRadius: "8px",
                color: "#eee",
              }}
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
              stroke="#8b5cf6"
              fill="url(#gradientReceived)"
              strokeWidth={1.5}
            />
            <Area
              type="monotone"
              dataKey="sent"
              stroke="#3b82f6"
              fill="url(#gradientSent)"
              strokeWidth={1.5}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ── Duration formatting ──────────────────────────────────
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return "12am";
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return "12pm";
  return `${hour - 12}pm`;
}

// ── Relationship Metrics (per-chat only) ─────────────────
function RelationshipMetrics({ chatId }: { chatId: number }) {
  const { data: responseTime, isLoading: rtLoading } =
    useResponseTimeStats(chatId);
  const { data: initiation, isLoading: initLoading } =
    useInitiationStats(chatId);
  const { data: msgLength, isLoading: mlLoading } =
    useMessageLengthStats(chatId);
  const { data: activeHours, isLoading: ahLoading } = useActiveHours(chatId);

  const isLoading = rtLoading || initLoading || mlLoading || ahLoading;

  if (isLoading) {
    return (
      <div className="mb-8 flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-blue-500" />
          <p className="text-sm text-zinc-500">Loading relationship metrics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8 space-y-6">
      <h2 className="text-xl font-bold text-white">Relationship Metrics</h2>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* A. Response Time Card */}
        {responseTime && (
          <Card className="border-zinc-800 bg-zinc-900">
            <CardHeader className="flex flex-row items-center gap-2">
              <Clock className="h-5 w-5 text-blue-400" />
              <CardTitle className="text-lg font-semibold text-white">
                Response Time
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-6">
                {/* You column */}
                <div>
                  <p className="mb-2 text-sm font-medium text-blue-400">You</p>
                  <p className="text-2xl font-bold text-white">
                    {formatDuration(responseTime.myAvgResponseSecs)}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">avg response</p>
                  <div className="mt-3 space-y-1">
                    <p className="text-xs text-zinc-400">
                      Median:{" "}
                      <span className="text-zinc-200">
                        {formatDuration(responseTime.myMedianResponseSecs)}
                      </span>
                    </p>
                    <p className="text-xs text-zinc-400">
                      Fastest:{" "}
                      <span className="text-zinc-200">
                        {formatDuration(responseTime.myFastestResponseSecs)}
                      </span>
                    </p>
                  </div>
                </div>
                {/* Them column */}
                <div>
                  <p className="mb-2 text-sm font-medium text-purple-400">
                    Them
                  </p>
                  <p className="text-2xl font-bold text-white">
                    {formatDuration(responseTime.theirAvgResponseSecs)}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">avg response</p>
                  <div className="mt-3 space-y-1">
                    <p className="text-xs text-zinc-400">
                      Median:{" "}
                      <span className="text-zinc-200">
                        {formatDuration(responseTime.theirMedianResponseSecs)}
                      </span>
                    </p>
                    <p className="text-xs text-zinc-400">
                      Fastest:{" "}
                      <span className="text-zinc-200">
                        {formatDuration(responseTime.theirFastestResponseSecs)}
                      </span>
                    </p>
                  </div>
                </div>
              </div>
              {/* Visual comparison bar */}
              <div className="mt-4">
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="bg-blue-500 transition-all"
                    style={{
                      width: `${
                        responseTime.myAvgResponseSecs +
                          responseTime.theirAvgResponseSecs >
                        0
                          ? (responseTime.theirAvgResponseSecs /
                              (responseTime.myAvgResponseSecs +
                                responseTime.theirAvgResponseSecs)) *
                            100
                          : 50
                      }%`,
                    }}
                  />
                  <div
                    className="bg-purple-500 transition-all"
                    style={{
                      width: `${
                        responseTime.myAvgResponseSecs +
                          responseTime.theirAvgResponseSecs >
                        0
                          ? (responseTime.myAvgResponseSecs /
                              (responseTime.myAvgResponseSecs +
                                responseTime.theirAvgResponseSecs)) *
                            100
                          : 50
                      }%`,
                    }}
                  />
                </div>
                <p className="mt-1 text-center text-[10px] text-zinc-600">
                  Faster responder has more bar
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* B. Conversation Initiation Card */}
        {initiation && (
          <Card className="border-zinc-800 bg-zinc-900">
            <CardHeader className="flex flex-row items-center gap-2">
              <MessageCircle className="h-5 w-5 text-green-400" />
              <CardTitle className="text-lg font-semibold text-white">
                Conversation Initiation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-1 text-2xl font-bold text-white">
                You start{" "}
                <span className="text-blue-400">
                  {Math.round(initiation.myRatio * 100)}%
                </span>{" "}
                of conversations
              </p>
              <p className="mb-4 text-xs text-zinc-500">
                {initiation.totalConversations.toLocaleString()} total
                conversations tracked
              </p>
              {/* Ratio bar */}
              <div className="mb-2 flex h-6 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="flex items-center justify-center bg-blue-500 text-[10px] font-bold text-white transition-all"
                  style={{
                    width: `${Math.max(initiation.myRatio * 100, 5)}%`,
                  }}
                >
                  {initiation.myRatio > 0.15 &&
                    `${initiation.myInitiations}`}
                </div>
                <div
                  className="flex items-center justify-center bg-zinc-600 text-[10px] font-bold text-white transition-all"
                  style={{
                    width: `${Math.max(
                      (1 - initiation.myRatio) * 100,
                      5,
                    )}%`,
                  }}
                >
                  {initiation.myRatio < 0.85 &&
                    `${initiation.theirInitiations}`}
                </div>
              </div>
              <div className="flex justify-between text-xs text-zinc-400">
                <span>You ({initiation.myInitiations})</span>
                <span>Them ({initiation.theirInitiations})</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* C. Message Length Card */}
        {msgLength && (
          <Card className="border-zinc-800 bg-zinc-900">
            <CardHeader className="flex flex-row items-center gap-2">
              <AlignLeft className="h-5 w-5 text-amber-400" />
              <CardTitle className="text-lg font-semibold text-white">
                Message Length
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-6">
                {/* You column */}
                <div className="space-y-3">
                  <p className="text-sm font-medium text-blue-400">You</p>
                  <div>
                    <p className="text-2xl font-bold text-white">
                      {Math.round(msgLength.myAvgLength).toLocaleString()}
                    </p>
                    <p className="text-xs text-zinc-500">avg chars / message</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-200">
                      {msgLength.myTotalChars.toLocaleString()}
                    </p>
                    <p className="text-xs text-zinc-500">total characters</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-200">
                      {msgLength.myTotalMessages.toLocaleString()}
                    </p>
                    <p className="text-xs text-zinc-500">messages sent</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-200">
                      {msgLength.myMaxLength.toLocaleString()}
                    </p>
                    <p className="text-xs text-zinc-500">longest message</p>
                  </div>
                </div>
                {/* Them column */}
                <div className="space-y-3">
                  <p className="text-sm font-medium text-purple-400">Them</p>
                  <div>
                    <p className="text-2xl font-bold text-white">
                      {Math.round(msgLength.theirAvgLength).toLocaleString()}
                    </p>
                    <p className="text-xs text-zinc-500">avg chars / message</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-200">
                      {msgLength.theirTotalChars.toLocaleString()}
                    </p>
                    <p className="text-xs text-zinc-500">total characters</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-200">
                      {msgLength.theirTotalMessages.toLocaleString()}
                    </p>
                    <p className="text-xs text-zinc-500">messages sent</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-200">
                      {msgLength.theirMaxLength.toLocaleString()}
                    </p>
                    <p className="text-xs text-zinc-500">longest message</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* D. Active Hours Card */}
        {activeHours && activeHours.length > 0 && (
          <Card className="border-zinc-800 bg-zinc-900">
            <CardHeader className="flex flex-row items-center gap-2">
              <Activity className="h-5 w-5 text-cyan-400" />
              <CardTitle className="text-lg font-semibold text-white">
                Active Hours
              </CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={activeHours}
                  margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis
                    dataKey="hour"
                    tick={{ fill: "#999", fontSize: 10 }}
                    tickFormatter={(v: number) => formatHourLabel(v)}
                    interval={2}
                  />
                  <YAxis tick={{ fill: "#999", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1e1e1e",
                      border: "1px solid #333",
                      borderRadius: "8px",
                      color: "#eee",
                    }}
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
                    fill="#3b82f6"
                    radius={[2, 2, 0, 0]}
                  />
                  <Bar
                    dataKey="theirMessages"
                    fill="#6366f1"
                    radius={[2, 2, 0, 0]}
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

// ── Main wrapped view ────────────────────────────────────
export function WrappedView() {
  const year = useAppStore((s) => s.wrappedYear);
  const wrappedChatId = useAppStore((s) => s.wrappedChatId);

  const chatIds = wrappedChatId !== null ? [wrappedChatId] : undefined;
  const { data: stats, isLoading, isError } = useWrappedStats(year, chatIds);
  const { data: chats } = useChats();

  const isPerChat = wrappedChatId !== null;

  // Build chatId -> Chat map for name resolution
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
      <div className="flex h-96 items-center justify-center bg-zinc-950 text-zinc-500">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-blue-500" />
          <p className="text-sm">Crunching your numbers...</p>
        </div>
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3 bg-zinc-950 text-zinc-500">
        <p className="text-lg font-medium text-red-400">
          Failed to load stats
        </p>
        <p className="text-sm">
          Make sure Full Disk Access is granted and the backend is running.
        </p>
      </div>
    );
  }

  const totalMessages = stats.messageCount.sent + stats.messageCount.received;

  // Combine chat interactions for top contacts
  const topChats = combineByKey(
    stats.chatInteractions.sent,
    stats.chatInteractions.received,
    (c) => String(c.chatId),
  ).slice(0, 10);

  // Monthly data — sort by calendar order
  const monthlyData = combineByKey(
    stats.monthlyInteractions.sent,
    stats.monthlyInteractions.received,
    (m) => m.month,
  ).sort((a, b) => MONTH_ORDER.indexOf(a.key) - MONTH_ORDER.indexOf(b.key));

  // Day of week data — sort by calendar order
  const weekdayData = combineByKey(
    stats.weekdayInteractions.sent,
    stats.weekdayInteractions.received,
    (d) => d.weekday,
  ).sort((a, b) => DAY_ORDER.indexOf(a.key) - DAY_ORDER.indexOf(b.key));

  // Yearly data — sort chronologically
  const yearlyData = combineByKey(
    stats.yearlyInteractions?.sent ?? [],
    stats.yearlyInteractions?.received ?? [],
    (y) => y.year,
  ).sort((a, b) => a.key.localeCompare(b.key));

  // Late night top chats
  const lateNightChats = combineByKey(
    stats.lateNightInteractions.sent,
    stats.lateNightInteractions.received,
    (c) => String(c.chatId),
  ).slice(0, 5);

  // Top openers
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

  // Unique chats
  const uniqueChatIds = new Set([
    ...stats.chatInteractions.sent.map((c) => c.chatId),
    ...stats.chatInteractions.received.map((c) => c.chatId),
  ]);

  return (
    <div className="bg-zinc-950 p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-white">
            {year === 0 ? "All-Time" : year} Wrapped
            {isPerChat && (
              <span className="ml-2 text-2xl font-bold text-blue-400">
                — {resolveChatName(wrappedChatId, chatMap)}
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            {isPerChat
              ? `Stats for this conversation`
              : "Your iMessage year in review"}
          </p>
        </div>
        <YearSelector />
      </div>

      {/* Big number cards */}
      <div className={`mb-8 grid grid-cols-2 gap-4 ${isPerChat ? "xl:grid-cols-3" : "xl:grid-cols-4"}`}>
        <StatCard
          title="Total Messages"
          value={totalMessages}
          icon={MessageSquare}
          gradient="bg-gradient-to-br from-blue-600 to-blue-800"
        />
        <StatCard
          title="Sent"
          value={stats.messageCount.sent}
          icon={Send}
          gradient="bg-gradient-to-br from-green-600 to-green-800"
        />
        <StatCard
          title="Received"
          value={stats.messageCount.received}
          icon={Inbox}
          gradient="bg-gradient-to-br from-purple-600 to-purple-800"
        />
        {!isPerChat && (
          <StatCard
            title="Active Chats"
            value={uniqueChatIds.size}
            icon={Users}
            gradient="bg-gradient-to-br from-pink-600 to-pink-800"
          />
        )}
      </div>

      {/* Temporal trends — per-chat only */}
      {isPerChat && (
        <div className="mb-8">
          <TemporalTrendsChart chatId={wrappedChatId} year={year} />
        </div>
      )}

      {/* Relationship metrics — per-chat only */}
      {isPerChat && <RelationshipMetrics chatId={wrappedChatId} />}

      {/* Group dynamics — per-chat + group chats only */}
      {isPerChat && isGroupChat && <GroupDynamics chatId={wrappedChatId} />}

      {/* Two-column: Top contacts + Messages by month (or just month if per-chat) */}
      <div className={`mb-8 grid grid-cols-1 gap-6 ${isPerChat ? "" : "lg:grid-cols-2"}`}>
        {/* Top contacts — hidden in per-chat mode */}
        {!isPerChat && (
          <Card className="border-zinc-800 bg-zinc-900">
            <CardHeader>
              <CardTitle className="text-lg font-semibold text-white">
                Top 10 Conversations
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topChats.length === 0 ? (
                <p className="text-sm text-zinc-500">No data available.</p>
              ) : (
                <ol className="space-y-2">
                  {topChats.map((c, i) => {
                    const pct = (c.total / (topChats[0]?.total || 1)) * 100;
                    const name = resolveChatName(Number(c.key), chatMap);
                    return (
                      <li key={c.key} className="flex items-center gap-3">
                        <span className="w-5 text-right text-xs font-bold text-zinc-500">
                          {i + 1}
                        </span>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="truncate text-sm text-zinc-200">
                              {name}
                            </span>
                            <span className="ml-2 text-xs text-zinc-400">
                              {c.total.toLocaleString()}
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 w-full rounded-full bg-zinc-800">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500"
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

        {/* Messages by month */}
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-white">
              Messages by Month
            </CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {monthlyData.length === 0 ? (
              <p className="text-sm text-zinc-500">No data available.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis
                    dataKey="key"
                    tick={{ fill: "#999", fontSize: 11 }}
                    tickFormatter={(v: string) => v.slice(0, 3)}
                  />
                  <YAxis tick={{ fill: "#999", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1e1e1e",
                      border: "1px solid #333",
                      borderRadius: "8px",
                      color: "#eee",
                    }}
                    formatter={(value, name) => [
                      Number(value).toLocaleString(),
                      name === "total" ? "Total" : name === "sent" ? "Sent" : "Received",
                    ]}
                  />
                  <Bar dataKey="total" radius={[4, 4, 0, 0]}>
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
      </div>

      {/* Messages by Year — only show for all-time view with multi-year data */}
      {year === 0 && yearlyData.length > 1 && (
        <Card className="mb-8 border-zinc-800 bg-zinc-900">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-white">
              Messages by Year
            </CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={yearlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis
                  dataKey="key"
                  tick={{ fill: "#999", fontSize: 11 }}
                />
                <YAxis tick={{ fill: "#999", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1e1e1e",
                    border: "1px solid #333",
                    borderRadius: "8px",
                    color: "#eee",
                  }}
                  formatter={(value, name) => [
                    Number(value).toLocaleString(),
                    name === "sent" ? "Sent" : name === "received" ? "Received" : "Total",
                  ]}
                />
                <Bar dataKey="total" radius={[4, 4, 0, 0]}>
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

      {/* Two-column: Day of week + Late night */}
      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Messages by day of week */}
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-white">
              Messages by Day of Week
            </CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {weekdayData.length === 0 ? (
              <p className="text-sm text-zinc-500">No data available.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekdayData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis
                    dataKey="key"
                    tick={{ fill: "#999", fontSize: 11 }}
                    tickFormatter={(v: string) => v.slice(0, 3)}
                  />
                  <YAxis tick={{ fill: "#999", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1e1e1e",
                      border: "1px solid #333",
                      borderRadius: "8px",
                      color: "#eee",
                    }}
                  />
                  <Bar dataKey="total" radius={[4, 4, 0, 0]}>
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

        {/* Late night chats */}
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="flex flex-row items-center gap-2">
            <Moon className="h-5 w-5 text-indigo-400" />
            <CardTitle className="text-lg font-semibold text-white">
              {isPerChat ? "Late Night Messages" : "Late Night Texters"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-zinc-500">Messages sent 10 PM - 5 AM</p>
            {lateNightChats.length === 0 ? (
              <p className="text-sm text-zinc-500">No late-night activity.</p>
            ) : isPerChat ? (
              <div className="flex items-center gap-3">
                <span className="text-3xl font-bold text-indigo-400">
                  {lateNightChats.reduce((sum, c) => sum + c.total, 0).toLocaleString()}
                </span>
                <span className="text-sm text-zinc-400">late night messages</span>
              </div>
            ) : (
              <ol className="space-y-2">
                {lateNightChats.map((c, i) => {
                  const name = resolveChatName(Number(c.key), chatMap);
                  return (
                    <li key={c.key} className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className="text-xs font-bold text-zinc-500">{i + 1}</span>
                        <span className="truncate text-sm text-zinc-200">{name}</span>
                      </span>
                      <span className="text-xs text-zinc-400">{c.total.toLocaleString()}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Popular openers */}
      {topOpeners.length > 0 && (
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-white">
              Most Popular Conversation Openers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {topOpeners.map((o) => (
                <span
                  key={o.text}
                  className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200"
                >
                  &ldquo;{o.text}&rdquo;
                  <span className="text-xs text-zinc-500">x{o.count}</span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Texting Personality */}
      <FunStats chatId={wrappedChatId} />

      {/* On This Day — only for all-time view */}
      {year === 0 && <OnThisDaySection chatId={wrappedChatId} />}
    </div>
  );
}
