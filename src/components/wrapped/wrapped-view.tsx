"use client";

import { useWrappedStats } from "@/hooks/use-analytics";
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
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  MessageSquare,
  Send,
  Inbox,
  Users,
  Calendar,
  TrendingUp,
  Moon,
} from "lucide-react";
import type { Chat, WrappedStats } from "@/types";

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

// ── Main wrapped view ────────────────────────────────────
export function WrappedView() {
  const year = useAppStore((s) => s.wrappedYear);
  const { data: stats, isLoading, isError } = useWrappedStats(year);
  const { data: chats } = useChats();

  // Build chatId -> Chat map for name resolution
  const chatMap = new Map<number, Chat>();
  if (chats) {
    for (const chat of chats) {
      chatMap.set(chat.rowid, chat);
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-950 text-zinc-500">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-blue-500" />
          <p className="text-sm">Crunching your numbers...</p>
        </div>
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-zinc-950 text-zinc-500">
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
    <div className="flex flex-1 flex-col overflow-auto bg-zinc-950 p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-white">
            {year === 0 ? "All-Time" : year} Wrapped
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Your iMessage year in review
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
        <StatCard
          title="Active Chats"
          value={uniqueChatIds.size}
          icon={Users}
          gradient="bg-gradient-to-br from-pink-600 to-pink-800"
        />
      </div>

      {/* Two-column: Top contacts + Messages by month */}
      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top contacts */}
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
              Late Night Texters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-zinc-500">Messages sent 10 PM – 5 AM</p>
            {lateNightChats.length === 0 ? (
              <p className="text-sm text-zinc-500">No late-night activity.</p>
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
    </div>
  );
}
