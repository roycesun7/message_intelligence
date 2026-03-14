"use client";

import { useOnThisDay } from "@/hooks/use-analytics";
import { useAppStore } from "@/stores/app-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "lucide-react";
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

function OnThisDayBubble({
  msg,
  showSender,
}: {
  msg: OnThisDayMessage;
  showSender: boolean;
}) {
  const setView = useAppStore((s) => s.setView);
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const setScrollToMessageDate = useAppStore((s) => s.setScrollToMessageDate);

  const handleClick = () => {
    setSelectedChatId(msg.chatId);
    setScrollToMessageDate(msg.date);
    setView("chat");
  };

  const bubbleBg = msg.isFromMe
    ? "bg-[#007AFF]"
    : "bg-[#E2E4EA] dark:bg-[#3A3A3C]";
  const bubbleText = msg.isFromMe
    ? "text-white"
    : "text-[#1B2432] dark:text-zinc-100";

  return (
    <div
      className={`flex ${msg.isFromMe ? "justify-end" : "justify-start"} ${showSender ? "mt-1.5" : "mt-0.5"}`}
    >
      <div className={`max-w-[75%] flex flex-col ${msg.isFromMe ? "items-end" : "items-start"}`}>
        {showSender && !msg.isFromMe && (
          <span className="mb-0.5 ml-3 text-[11px] text-[#94A3B3] dark:text-zinc-500">
            {msg.sender ?? "Unknown"}
          </span>
        )}
        <button
          onClick={handleClick}
          className={`cursor-pointer rounded-[18px] px-3 py-1.5 text-[13px] leading-snug ${bubbleBg} ${bubbleText} ${
            msg.isFromMe ? "rounded-br-[6px]" : "rounded-bl-[6px]"
          } hover:opacity-80 transition-opacity`}
        >
          {msg.text ? truncate(msg.text, 200) : "(attachment)"}
        </button>
        {showSender && (
          <span className="mt-0.5 text-[10px] text-[#94A3B3] dark:text-zinc-600 px-1">
            {dayjs(msg.date).format("h:mm A")}
          </span>
        )}
      </div>
    </div>
  );
}

export function OnThisDaySection({ chatId }: { chatId: number | null }) {
  const { data, isLoading } = useOnThisDay(chatId);

  if (isLoading) {
    return (
      <div>
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
      <div>
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
    <div>
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
                  <div className="px-2">
                    {msgs.map((msg, i) => {
                      const prev = i > 0 ? msgs[i - 1] : null;
                      const showSender = !prev || prev.isFromMe !== msg.isFromMe || prev.sender !== msg.sender;
                      return (
                        <OnThisDayBubble key={`${year}-${i}`} msg={msg} showSender={showSender} />
                      );
                    })}
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
