"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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

const MAX_WORDS = 20;
const TARGET_ROWS = 3;

export function WordFrequencySection({ year, chatIds }: WordFrequencySectionProps) {
  const [fromMeOnly, setFromMeOnly] = useState(false);
  const { data: words, isLoading } = useWordFrequency(year, chatIds, fromMeOnly);
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(MAX_WORDS);

  const trimToFullRows = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const children = Array.from(el.children) as HTMLElement[];
    if (children.length === 0) return;

    // Group children by row (same offsetTop)
    const rows: number[][] = [];
    let currentTop = children[0].offsetTop;
    let currentRow: number[] = [];
    for (let i = 0; i < children.length; i++) {
      if (children[i].offsetTop !== currentTop) {
        rows.push(currentRow);
        currentRow = [];
        currentTop = children[i].offsetTop;
      }
      currentRow.push(i);
    }
    rows.push(currentRow);

    // Keep only TARGET_ROWS complete rows
    const keepRows = rows.slice(0, TARGET_ROWS);
    const count = keepRows.reduce((sum, r) => sum + r.length, 0);
    if (count !== visibleCount) {
      setVisibleCount(count);
    }
  }, [visibleCount]);

  // Re-measure after render and on resize
  useEffect(() => {
    // Reset to max so we can measure all items
    setVisibleCount(MAX_WORDS);
  }, [words, fromMeOnly]);

  useEffect(() => {
    // After rendering with all items, trim to full rows
    requestAnimationFrame(trimToFullRows);
  });

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      setVisibleCount(MAX_WORDS);
    });
    if (containerRef.current?.parentElement) {
      observer.observe(containerRef.current.parentElement);
    }
    return () => observer.disconnect();
  }, []);

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
      <div ref={containerRef} className="flex flex-wrap gap-2 py-3">
        {words.slice(0, visibleCount).map((w, i) => (
          <span
            key={w.word}
            className={`wc-tag ${getSizeClass(i)} ${i % 2 === 0 ? "wc-blue" : "wc-gray"} text-[#1B2432] dark:text-white`}
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
