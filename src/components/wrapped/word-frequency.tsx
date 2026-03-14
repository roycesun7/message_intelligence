"use client";

import { useState } from "react";
import { useWordFrequency } from "@/hooks/use-analytics";

interface WordFrequencySectionProps {
  year: number;
  chatIds?: number[];
}

function getSizeClass(index: number): string {
  if (index < 2) return "s1";
  if (index < 5) return "s2";
  if (index < 9) return "s3";
  return "s4";
}

export function WordFrequencySection({ year, chatIds }: WordFrequencySectionProps) {
  const [fromMeOnly, setFromMeOnly] = useState(false);
  const { data: words, isLoading } = useWordFrequency(year, chatIds, fromMeOnly);

  if (isLoading) {
    return (
      <div className="card-glass rounded-[20px] p-6">
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-base font-bold text-[#1B2432] dark:text-white">
            Most Used Words
          </h3>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#D1D5DB] dark:border-zinc-600 border-t-[#1B2432] dark:border-t-blue-400" />
        </div>
      </div>
    );
  }

  if (!words || words.length === 0) {
    return (
      <div className="card-glass rounded-[20px] p-6">
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-base font-bold text-[#1B2432] dark:text-white">
            Most Used Words
          </h3>
        </div>
        <p className="text-sm text-[#94A3B3] dark:text-zinc-500">
          No word data available.
        </p>
      </div>
    );
  }

  return (
    <div className="card-glass rounded-[20px] p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🔤</span>
        <h3 className="text-base font-bold text-[#1B2432] dark:text-white">
          Most Used Words
        </h3>
        <div className="ml-auto flex items-center gap-0.5 rounded-lg bg-[#1B2432]/[0.04] dark:bg-white/[0.06] p-0.5">
          <button
            onClick={() => setFromMeOnly(false)}
            className={`rounded-md px-3 py-1 text-[11px] font-semibold whitespace-nowrap transition-colors ${
              !fromMeOnly
                ? "bg-[#1B2432] text-white dark:bg-white/[0.15] dark:text-white"
                : "text-[#4E5D6E] dark:text-zinc-400"
            }`}
          >
            Everyone
          </button>
          <button
            onClick={() => setFromMeOnly(true)}
            className={`rounded-md px-3 py-1 text-[11px] font-semibold whitespace-nowrap transition-colors ${
              fromMeOnly
                ? "bg-[#1B2432] text-white dark:bg-white/[0.15] dark:text-white"
                : "text-[#4E5D6E] dark:text-zinc-400"
            }`}
          >
            My Words
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 justify-center py-3">
        {words.slice(0, 14).map((w, i) => (
          <span
            key={w.word}
            className={`wc-tag ${getSizeClass(i)} text-[#1B2432] dark:text-white`}
          >
            {w.word}
            <span className="text-[10px] text-[#94A3B3] dark:text-zinc-500 ml-1">
              {w.count.toLocaleString()}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
