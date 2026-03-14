"use client";

import { useOnThisDay } from "@/hooks/use-analytics";
import { useAppStore } from "@/stores/app-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "lucide-react";
import dayjs from "dayjs";
import type { OnThisDayMessage } from "@/types";

function formatMonthDay(): string {
  const now = new Date();
  return now.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "\u2026";
}

function groupByYear(messages: OnThisDayMessage[]): Map<number, OnThisDayMessage[]> {
  const grouped = new Map<number, OnThisDayMessage[]>();
  for (const msg of messages) {
    const existing = grouped.get(msg.year) ?? [];
    existing.push(msg);
    grouped.set(msg.year, existing);
  }
  return grouped;
}

function OtdRow({ msg }: { msg: OnThisDayMessage }) {
  const setView = useAppStore((s) => s.setView);
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const setScrollToMessageDate = useAppStore((s) => s.setScrollToMessageDate);

  const handleClick = () => {
    setSelectedChatId(msg.chatId);
    setScrollToMessageDate(msg.date, msg.messageRowid);
    setView("chat");
  };

  const timeStr = dayjs(msg.date).format("h:mm A");
  const sender = msg.isFromMe ? "You" : msg.sender ?? "Unknown";

  return (
    <button
      onClick={handleClick}
      className="group w-full flex items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-[#1B2432]/[0.04] dark:hover:bg-white/[0.04] cursor-pointer"
    >
      <span className={`shrink-0 text-[11px] font-semibold ${msg.isFromMe ? "text-[#4E5D6E] dark:text-blue-400" : "text-[#3B82C4] dark:text-purple-400"}`}>
        {sender}
      </span>
      <span className="min-w-0 flex-1 text-[13px] text-[#1B2432] dark:text-zinc-300 truncate">
        {truncate(msg.text!, 80)}
      </span>
      {msg.chatDisplayName && (
        <span className="shrink-0 text-[10px] text-[#94A3B3] dark:text-zinc-600 truncate max-w-[120px]">
          {msg.chatDisplayName}
        </span>
      )}
      <span className="shrink-0 text-[10px] text-[#94A3B3] dark:text-zinc-600">
        {timeStr}
      </span>
    </button>
  );
}

export function OnThisDaySection({ chatId }: { chatId: number | null }) {
  const { data, isLoading } = useOnThisDay(chatId);

  if (isLoading) {
    return (
      <Card className="card-glass">
        <CardHeader className="flex flex-row items-center gap-2">
          <Calendar className="h-5 w-5 text-[#3B82C4] dark:text-amber-400" />
          <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
            On This Day — {formatMonthDay()}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#D1D5DB] dark:border-zinc-600 border-t-[#3B82C4] dark:border-t-blue-400" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.messages.length === 0) {
    return (
      <Card className="card-glass">
        <CardHeader className="flex flex-row items-center gap-2">
          <Calendar className="h-5 w-5 text-[#3B82C4] dark:text-amber-400" />
          <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
            On This Day — {formatMonthDay()}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[#94A3B3] dark:text-zinc-500 py-4">
            No messages found on this date in past years.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Filter: only messages with 10+ characters of actual text (no attachments, no "Hi")
  const filtered = data.messages.filter((m) => m.text && m.text.length >= 10);

  if (filtered.length === 0) {
    return (
      <Card className="card-glass">
        <CardHeader className="flex flex-row items-center gap-2">
          <Calendar className="h-5 w-5 text-[#3B82C4] dark:text-amber-400" />
          <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
            On This Day — {formatMonthDay()}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[#94A3B3] dark:text-zinc-500 py-4">
            No notable messages found on this date in past years.
          </p>
        </CardContent>
      </Card>
    );
  }

  const grouped = groupByYear(filtered);
  const sortedYears = Array.from(grouped.keys()).sort((a, b) => b - a);

  return (
    <Card className="card-glass">
      <CardHeader className="flex flex-row items-center gap-2">
        <Calendar className="h-5 w-5 text-[#3B82C4] dark:text-amber-400" />
        <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
          On This Day — {formatMonthDay()}
        </CardTitle>
        <span className="ml-auto text-xs text-[#94A3B3] dark:text-zinc-600">
          {filtered.length} messages across {sortedYears.length} years
        </span>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {sortedYears.map((year) => {
            const msgs = grouped.get(year) ?? [];
            return (
              <div key={year}>
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-xs font-bold text-[#3B82C4] dark:text-blue-400">{year}</span>
                  <div className="h-px flex-1 bg-[#D1D5DB]/40 dark:bg-white/[0.06]" />
                  <span className="text-[10px] text-[#94A3B3] dark:text-zinc-600">{msgs.length}</span>
                </div>
                <div>
                  {msgs.map((msg, i) => (
                    <OtdRow key={`${year}-${msg.messageRowid}-${i}`} msg={msg} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
