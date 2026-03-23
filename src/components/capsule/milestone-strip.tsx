"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useMilestones } from "@/hooks/use-analytics";
import { Calendar, Flame, MessageSquare, TrendingUp, TrendingDown, ChevronUp } from "lucide-react";
import type { Milestone } from "@/types";

const ACCENT: Record<string, { border: string; iconClass: string; Icon: typeof Calendar }> = {
  anniversary: { border: "border-l-[#3B82C4]", iconClass: "text-[#3B82C4] dark:text-blue-400", Icon: Calendar },
  streak: { border: "border-l-amber-500", iconClass: "text-amber-500 dark:text-amber-400", Icon: Flame },
  volume: { border: "border-l-emerald-500", iconClass: "text-emerald-500 dark:text-emerald-400", Icon: MessageSquare },
  trend_up: { border: "border-l-[#3B82C4]", iconClass: "text-[#3B82C4] dark:text-blue-400", Icon: TrendingUp },
  trend_down: { border: "border-l-[#94A3B3]", iconClass: "text-[#94A3B3] dark:text-zinc-400", Icon: TrendingDown },
};

function getAccent(m: { milestoneType: string; value: number }) {
  if (m.milestoneType === "trend") {
    return m.value >= 0 ? ACCENT.trend_up : ACCENT.trend_down;
  }
  return ACCENT[m.milestoneType] ?? ACCENT.volume;
}

function TrendPopover({ m, anchorRef, onClose }: { m: Milestone; anchorRef: React.RefObject<HTMLDivElement | null>; onClose: () => void }) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const recent = m.recentCount ?? 0;
  const previous = m.previousCount ?? 0;
  const max = Math.max(recent, previous, 1);
  const isUp = m.value >= 0;

  // Position below the card
  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 8, left: rect.left });
  }, [anchorRef]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, anchorRef]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-50 w-[260px] rounded-2xl bg-white/95 dark:bg-[#2A2A2C]/95 backdrop-blur-xl border border-[#D1D5DB]/40 dark:border-white/[0.1] shadow-[0_8px_32px_rgba(0,0,0,0.15)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-4"
      style={{ top: pos.top, left: pos.left }}
    >
      <p className="text-[10px] text-[#94A3B3] dark:text-zinc-500 mb-2 uppercase tracking-wider font-semibold">
        Last 30 days vs prior 30
      </p>

      <div className="space-y-2">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-[#4E5D6E] dark:text-zinc-400">Recent</span>
            <span className="text-[12px] font-semibold tabular-nums text-[#1B2432] dark:text-zinc-200">
              {recent.toLocaleString()}
            </span>
          </div>
          <div className="h-[6px] rounded-full bg-[#1B2432]/[0.04] dark:bg-white/[0.04] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#3B82C4] dark:bg-blue-400"
              style={{ width: `${(recent / max) * 100}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-[#4E5D6E] dark:text-zinc-400">Prior</span>
            <span className="text-[12px] font-semibold tabular-nums text-[#1B2432] dark:text-zinc-200">
              {previous.toLocaleString()}
            </span>
          </div>
          <div className="h-[6px] rounded-full bg-[#1B2432]/[0.04] dark:bg-white/[0.04] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#94A3B3] dark:bg-zinc-500"
              style={{ width: `${(previous / max) * 100}%` }}
            />
          </div>
        </div>
      </div>

      <p className="text-[11px] text-[#4E5D6E] dark:text-zinc-400 mt-2">
        {isUp ? "+" : ""}{Math.round(m.value)}% &middot; {Math.abs(recent - previous).toLocaleString()} {isUp ? "more" : "fewer"} messages
      </p>
    </div>,
    document.body,
  );
}

function MilestoneCard({ m, isExpanded, onToggle }: { m: Milestone; isExpanded: boolean; onToggle: () => void }) {
  const accent = getAccent(m);
  const Icon = accent.Icon;
  const isTrend = m.milestoneType === "trend";
  const cardRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={cardRef} className="flex-shrink-0">
      <div
        className={`rounded-2xl border-l-[3px] ${accent.border} card-glass w-[220px] ${isTrend ? "cursor-pointer" : ""}`}
        onClick={isTrend ? onToggle : undefined}
      >
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Icon className={`h-3.5 w-3.5 ${accent.iconClass}`} />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#94A3B3] dark:text-zinc-500">
              {isTrend ? (m.value >= 0 ? "Trending Up" : "Trending Down") : m.milestoneType}
            </span>
            {isTrend && (
              <ChevronUp className={`h-3 w-3 text-[#94A3B3] dark:text-zinc-500 ml-auto transition-transform ${isExpanded ? "" : "rotate-180"}`} />
            )}
          </div>
          <p className="text-[13px] font-semibold text-[#1B2432] dark:text-zinc-100 leading-tight">
            {m.chatName}
          </p>
          <p className="text-[12px] text-[#4E5D6E] dark:text-zinc-400 mt-0.5 leading-snug">
            {m.headline}
          </p>
          {m.detail && (
            <p className="text-[11px] text-[#94A3B3] dark:text-zinc-500 mt-1 truncate">
              {m.detail}
            </p>
          )}
        </div>
      </div>

      {isExpanded && isTrend && (
        <TrendPopover m={m} anchorRef={cardRef} onClose={onToggle} />
      )}
    </div>
  );
}

export function MilestoneStrip({ chatId }: { chatId?: number | null }) {
  const { data: milestones } = useMilestones(chatId);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (!milestones || milestones.length === 0) return null;

  return (
    <div className="mb-6">
      <div
        className="flex gap-3 overflow-x-auto pb-2"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {milestones.map((m) => {
          const key = `${m.milestoneType}-${m.chatId}`;
          return (
            <MilestoneCard
              key={key}
              m={m}
              isExpanded={expandedKey === key}
              onToggle={() => setExpandedKey(expandedKey === key ? null : key)}
            />
          );
        })}
      </div>
    </div>
  );
}
