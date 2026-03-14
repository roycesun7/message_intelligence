"use client";

import { useEmojiFrequency } from "@/hooks/use-analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function EmojiFrequencySection({
  chatId,
  year,
}: {
  chatId?: number | null;
  year: number;
}) {
  const { data: emojis, isLoading } = useEmojiFrequency(chatId, year);

  if (isLoading) {
    return (
      <Card className="card-glass">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
            Most Used Emoji
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#D1D5DB] dark:border-zinc-600 border-t-[#3B82C4] dark:border-t-blue-400" />
        </CardContent>
      </Card>
    );
  }

  if (!emojis || emojis.length === 0) {
    return (
      <Card className="card-glass">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
            Most Used Emoji
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[#94A3B3] dark:text-zinc-500 py-4">
            No emoji found in messages.
          </p>
        </CardContent>
      </Card>
    );
  }

  const maxCount = emojis[0]?.count ?? 1;

  return (
    <Card className="card-glass">
      <CardHeader>
        <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
          Most Used Emoji
        </CardTitle>
        <span className="ml-auto text-xs text-[#94A3B3] dark:text-zinc-500">
          {emojis.reduce((sum, e) => sum + e.count, 0).toLocaleString()} total
        </span>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-5 gap-3">
          {emojis.slice(0, 15).map((e, i) => {
            const sizeClass = i < 3
              ? "text-4xl"
              : i < 6
                ? "text-3xl"
                : i < 10
                  ? "text-2xl"
                  : "text-xl";

            const barWidth = (e.count / maxCount) * 100;

            return (
              <div
                key={e.emoji}
                className="flex flex-col items-center gap-1 p-2 rounded-xl bg-[#1B2432]/[0.02] dark:bg-white/[0.03] hover:bg-[#1B2432]/[0.05] dark:hover:bg-white/[0.06] transition-colors"
              >
                <span className={sizeClass}>{e.emoji}</span>
                <span className="text-[10px] font-medium text-[#4E5D6E] dark:text-zinc-400">
                  {e.count.toLocaleString()}
                </span>
                <div className="w-full h-1 rounded-full bg-[#D1D5DB]/30 dark:bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-[#3B82C4] dark:bg-blue-400"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
