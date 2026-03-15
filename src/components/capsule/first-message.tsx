"use client";

import { useFirstMessage } from "@/hooks/use-analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageCircle } from "lucide-react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

export function FirstMessageCard({ chatId }: { chatId: number | null }) {
  const { data: firstMsg, isLoading } = useFirstMessage(chatId);

  if (isLoading) {
    return (
      <Card className="card-glass">
        <CardHeader className="flex flex-row items-center gap-2">
          <MessageCircle className="h-5 w-5 text-[#3B82C4] dark:text-blue-400" />
          <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
            Where It All Began
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#D1D5DB] dark:border-zinc-600 border-t-[#3B82C4] dark:border-t-blue-400" />
        </CardContent>
      </Card>
    );
  }

  if (!firstMsg) return null;

  const dateObj = dayjs(firstMsg.date);
  const timeAgo = dateObj.fromNow();
  const formattedDate = dateObj.format("MMMM D, YYYY · h:mm A");

  const bubbleBg = firstMsg.isFromMe
    ? "bg-[#007AFF]"
    : "bg-[#E8E6E1] dark:bg-[#3A3A3C]";
  const bubbleText = firstMsg.isFromMe
    ? "text-white"
    : "text-[#071739] dark:text-zinc-100";

  return (
    <Card className="card-glass">
      <CardHeader className="flex flex-row items-center gap-2">
        <MessageCircle className="h-5 w-5 text-[#3B82C4] dark:text-blue-400" />
        <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
          Where It All Began
        </CardTitle>
        <span className="ml-auto text-xs text-[#94A3B3] dark:text-zinc-500">
          {timeAgo}
        </span>
      </CardHeader>
      <CardContent>
        <p className="text-[11px] text-[#94A3B3] dark:text-zinc-500 mb-3">
          {formattedDate}
        </p>
        {firstMsg.senderDisplayName && !firstMsg.isFromMe && (
          <p className="text-[11px] font-semibold text-[#3B82C4] dark:text-purple-400 mb-1.5 ml-1">
            {firstMsg.senderDisplayName}
          </p>
        )}
        <div className={`flex ${firstMsg.isFromMe ? "justify-end" : "justify-start"}`}>
          <div
            className={`max-w-[85%] rounded-[20px] px-4 py-2.5 text-sm leading-relaxed ${bubbleBg} ${bubbleText} ${
              firstMsg.isFromMe ? "rounded-br-[8px]" : "rounded-bl-[8px]"
            }`}
          >
            {firstMsg.text || (
              <span className={firstMsg.isFromMe ? "italic text-white/60" : "italic text-[#4B6382]/60 dark:text-white/60"}>
                [No text]
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
