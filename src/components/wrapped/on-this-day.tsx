"use client";

import { useOnThisDay } from "@/hooks/use-analytics";
import { useAppStore } from "@/stores/app-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, ExternalLink } from "lucide-react";
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
      className={`group w-full text-left rounded-2xl px-4 py-3 transition-colors cursor-pointer ${
        msg.isFromMe
          ? "ml-6 bg-blue-500/[0.08] hover:bg-blue-500/[0.12]"
          : "mr-6 bg-white/[0.04] hover:bg-white/[0.07]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[11px] font-medium ${msg.isFromMe ? "text-blue-400" : "text-purple-400"}`}>
              {msg.isFromMe ? "You" : msg.sender ?? "Unknown"}
            </span>
            {msg.chatDisplayName && (
              <>
                <span className="text-[10px] text-zinc-600">in</span>
                <span className="text-[11px] text-zinc-400 truncate">{msg.chatDisplayName}</span>
              </>
            )}
            <span className="text-[10px] text-zinc-600 ml-auto shrink-0">{timeStr}</span>
          </div>
          <p className="text-sm text-zinc-300">
            {msg.text ? truncate(msg.text, 150) : "(attachment)"}
          </p>
        </div>
        <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100" />
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
            <Calendar className="h-5 w-5 text-amber-400" />
            <CardTitle className="text-lg font-semibold text-white">
              On This Day — {formatMonthDay()}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-amber-400" />
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
            <Calendar className="h-5 w-5 text-amber-400" />
            <CardTitle className="text-lg font-semibold text-white">
              On This Day — {formatMonthDay()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-zinc-500 py-4">
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
          <Calendar className="h-5 w-5 text-amber-400" />
          <CardTitle className="text-lg font-semibold text-white">
            On This Day — {formatMonthDay()}
          </CardTitle>
          <span className="ml-auto text-xs text-zinc-600">
            {data.messages.length} messages across {sortedYears.length} years
          </span>
        </CardHeader>
        <CardContent>
          <p className="mb-6 text-sm text-zinc-400">
            Click any message to jump to that conversation.
          </p>
          <div className="space-y-6">
            {sortedYears.map((year) => {
              const msgs = grouped.get(year) ?? [];
              return (
                <div key={year}>
                  <div className="mb-3 flex items-center gap-3">
                    <span className="text-sm font-bold text-amber-400/90">{year}</span>
                    <div className="h-px flex-1 bg-white/[0.06]" />
                    <span className="text-xs text-zinc-600">{msgs.length} messages</span>
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
