"use client";

import { useOnThisDay } from "@/hooks/use-analytics";
import { useAppStore } from "@/stores/app-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, ArrowRight } from "lucide-react";
import type { OnThisDayMessage } from "@/types";
import dayjs from "dayjs";

function formatMonthDay(): string {
  const now = new Date();
  return now.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "...";
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

function OnThisDayMessageItem({ msg }: { msg: OnThisDayMessage }) {
  const setView = useAppStore((s) => s.setView);
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const setScrollToMessageDate = useAppStore((s) => s.setScrollToMessageDate);

  const handleClick = () => {
    setSelectedChatId(msg.chatId);
    setScrollToMessageDate(msg.date);
    setView("chat");
  };

  const timeStr = dayjs(msg.date).format("h:mm A");

  return (
    <button
      onClick={handleClick}
      className={`group w-full text-left rounded-2xl px-4 py-3 transition-all cursor-pointer ${
        msg.isFromMe
          ? "ml-6 bg-[#4E5D6E]/[0.08] hover:bg-[#4E5D6E]/[0.14] dark:bg-blue-500/[0.08] dark:hover:bg-blue-500/[0.14]"
          : "mr-6 bg-[#1B2432]/[0.04] hover:bg-[#1B2432]/[0.08] dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[11px] font-medium ${msg.isFromMe ? "text-[#4E5D6E] dark:text-blue-400" : "text-[#3B82C4] dark:text-purple-400"}`}>
              {msg.isFromMe ? "You" : msg.sender ?? "Unknown"}
            </span>
            {msg.chatDisplayName && (
              <>
                <span className="text-[10px] text-[#94A3B3] dark:text-zinc-600">in</span>
                <span className="text-[11px] text-[#4E5D6E] dark:text-zinc-400 truncate">{msg.chatDisplayName}</span>
              </>
            )}
            <span className="text-[10px] text-[#94A3B3] dark:text-zinc-600 ml-auto shrink-0">{timeStr}</span>
          </div>
          <p className="text-sm text-[#1B2432] dark:text-zinc-300 leading-relaxed">
            {msg.text ? truncate(msg.text, 200) : "(attachment)"}
          </p>
        </div>
        <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1B2432]/[0.06] dark:bg-white/[0.08] opacity-60 transition-opacity group-hover:opacity-100">
          <ArrowRight className="h-3 w-3 text-[#1B2432] dark:text-zinc-300" />
        </div>
      </div>
    </button>
  );
}

export function OnThisDaySection({ chatId }: { chatId: number | null }) {
  const { data, isLoading } = useOnThisDay(chatId);

  if (isLoading) {
    return (
      <div className="mb-8">
        <Card className="card-glass">
          <CardHeader className="flex flex-row items-center gap-2">
            <Calendar className="h-5 w-5 text-[#3B82C4] dark:text-amber-400" />
            <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
              On This Day — {formatMonthDay()}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#D1D5DB] dark:border-zinc-600 border-t-[#3B82C4] dark:border-t-amber-400" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data || data.messages.length === 0) {
    return (
      <div className="mb-8">
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
      </div>
    );
  }

  const grouped = groupByYear(data.messages);
  const sortedYears = Array.from(grouped.keys()).sort((a, b) => b - a);

  return (
    <div className="mb-8">
      <Card className="card-glass">
        <CardHeader className="flex flex-row items-center gap-2">
          <Calendar className="h-5 w-5 text-[#3B82C4] dark:text-amber-400" />
          <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
            On This Day — {formatMonthDay()}
          </CardTitle>
          <span className="ml-auto text-xs text-[#94A3B3] dark:text-zinc-600">
            {data.messages.length} messages across {sortedYears.length} years
          </span>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {sortedYears.map((year) => {
              const msgs = grouped.get(year) ?? [];
              return (
                <div key={year}>
                  <div className="mb-3 flex items-center gap-3">
                    <span className="text-sm font-bold text-[#3B82C4]/90 dark:text-amber-400/90">{year}</span>
                    <div className="h-px flex-1 bg-[#D1D5DB]/30 dark:bg-white/[0.06]" />
                    <span className="text-xs text-[#94A3B3] dark:text-zinc-600">{msgs.length} messages</span>
                  </div>
                  <div className="space-y-2">
                    {msgs.map((msg, i) => (
                      <OnThisDayMessageItem key={`${year}-${i}`} msg={msg} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
