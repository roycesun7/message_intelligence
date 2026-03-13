"use client";

import { useState } from "react";
import { useWordFrequency } from "@/hooks/use-analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Type } from "lucide-react";

interface WordFrequencySectionProps {
  year: number;
  chatIds?: number[];
}

export function WordFrequencySection({ year, chatIds }: WordFrequencySectionProps) {
  const [fromMeOnly, setFromMeOnly] = useState(false);
  const { data: words, isLoading } = useWordFrequency(year, chatIds, fromMeOnly);

  if (isLoading) {
    return (
      <Card className="card-glass">
        <CardHeader className="flex flex-row items-center gap-2">
          <Type className="h-5 w-5 text-[#071739] dark:text-blue-400" />
          <CardTitle className="text-lg font-semibold text-[#071739] dark:text-white">
            Most Used Words
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#CDD5DB] dark:border-zinc-600 border-t-[#071739] dark:border-t-blue-400" />
        </CardContent>
      </Card>
    );
  }

  if (!words || words.length === 0) {
    return (
      <Card className="card-glass">
        <CardHeader className="flex flex-row items-center gap-2">
          <Type className="h-5 w-5 text-[#071739] dark:text-blue-400" />
          <CardTitle className="text-lg font-semibold text-[#071739] dark:text-white">
            Most Used Words
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[#A4B5C4] dark:text-zinc-500 py-4">
            No word data available.
          </p>
        </CardContent>
      </Card>
    );
  }

  const maxCount = words[0].count;

  return (
    <Card className="card-glass">
      <CardHeader className="flex flex-row items-center gap-2">
        <Type className="h-5 w-5 text-[#071739] dark:text-blue-400" />
        <CardTitle className="text-lg font-semibold text-[#071739] dark:text-white">
          Most Used Words
        </CardTitle>
        <div className="ml-auto flex items-center gap-1 rounded-full bg-[#071739]/[0.04] dark:bg-white/[0.06] p-0.5">
          <button
            onClick={() => setFromMeOnly(false)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              !fromMeOnly
                ? "bg-[#071739] text-white dark:bg-[#007AFF] dark:text-white"
                : "text-[#4B6382] dark:text-zinc-400 hover:text-[#071739] dark:hover:text-zinc-200"
            }`}
          >
            Everyone
          </button>
          <button
            onClick={() => setFromMeOnly(true)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              fromMeOnly
                ? "bg-[#071739] text-white dark:bg-[#007AFF] dark:text-white"
                : "text-[#4B6382] dark:text-zinc-400 hover:text-[#071739] dark:hover:text-zinc-200"
            }`}
          >
            My Words
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          {words.slice(0, 20).map((w, i) => (
            <div key={w.word} className="flex items-center gap-3">
              <span className="w-5 text-right text-xs font-bold text-[#A4B5C4] dark:text-zinc-500">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[#071739] dark:text-zinc-200 truncate">
                    {w.word}
                  </span>
                  <span className="shrink-0 text-xs text-[#A4B5C4] dark:text-zinc-500">
                    {w.count.toLocaleString()}
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 w-full rounded-full bg-[#CDD5DB]/30 dark:bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#071739] to-[#4B6382] dark:from-[#007AFF] dark:to-[#64ACFF]"
                    style={{ width: `${(w.count / maxCount) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
