"use client";

import { useMemo, useRef, useEffect } from "react";
import { useTemporalTrends } from "@/hooks/use-analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import type { DailyMessageCount } from "@/types";

dayjs.extend(isoWeek);

interface WeekEntry {
  key: string;
  weekStart: dayjs.Dayjs;
  total: number;
  sent: number;
  received: number;
  year: number;
}

function buildWeeks(data: DailyMessageCount[]): WeekEntry[] {
  if (data.length === 0) return [];

  const weekMap = new Map<string, WeekEntry>();

  for (const d of data) {
    const dt = dayjs(d.date);
    const wy = dt.isoWeekYear();
    const wn = dt.isoWeek();
    const key = `${wy}-W${String(wn).padStart(2, "0")}`;
    const total = d.sent + d.received;

    const existing = weekMap.get(key);
    if (existing) {
      existing.total += total;
      existing.sent += d.sent;
      existing.received += d.received;
    } else {
      weekMap.set(key, {
        key,
        weekStart: dt.startOf("isoWeek" as dayjs.OpUnitType),
        total,
        sent: d.sent,
        received: d.received,
        year: wy,
      });
    }
  }

  // Sort newest first, filter out empty weeks
  return Array.from(weekMap.values())
    .filter((w) => w.total > 0)
    .sort((a, b) => b.key.localeCompare(a.key));
}

export function RelationshipTimeline({ chatId }: { chatId: number | null }) {
  const { data, isLoading } = useTemporalTrends(chatId);
  const scrollRef = useRef<HTMLDivElement>(null);

  const weeks = useMemo(() => {
    if (!data) return [];
    return buildWeeks(data);
  }, [data]);

  const maxTotal = useMemo(
    () => Math.max(...weeks.map((w) => w.total), 1),
    [weeks]
  );

  // Scroll to top (most recent) on load
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [weeks.length]);

  if (isLoading) {
    return (
      <Card className="card-glass">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
            Conversation Timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#D1D5DB] dark:border-zinc-600 border-t-[#3B82C4] dark:border-t-blue-400" />
        </CardContent>
      </Card>
    );
  }

  if (weeks.length === 0) return null;

  // Group by year for dividers
  let lastYear: number | null = null;

  return (
    <Card className="card-glass">
      <CardHeader>
        <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
          Conversation Timeline
        </CardTitle>
        <span className="ml-auto text-xs text-[#94A3B3] dark:text-zinc-500">
          {weeks.length} active weeks
        </span>
      </CardHeader>
      <CardContent>
        <div
          ref={scrollRef}
          className="max-h-[210px] overflow-y-auto pr-1"
          style={{ scrollbarWidth: "thin" }}
        >
          <div className="relative pl-6">
            {/* The vertical timeline line */}
            <div className="absolute left-[7px] top-2 bottom-2 w-[2px] bg-[#D1D5DB]/40 dark:bg-white/[0.08]" />

            {weeks.map((week) => {
              const showYear = week.year !== lastYear;
              lastYear = week.year;

              const barPct = (week.total / maxTotal) * 100;
              const sentPct = week.total > 0 ? (week.sent / week.total) * 100 : 0;
              const weekEnd = week.weekStart.add(6, "day");
              const dateLabel =
                week.weekStart.month() === weekEnd.month()
                  ? `${week.weekStart.format("MMM D")}–${weekEnd.format("D")}`
                  : `${week.weekStart.format("MMM D")}–${weekEnd.format("MMM D")}`;

              return (
                <div key={week.key}>
                  {/* Year divider */}
                  {showYear && (
                    <div className="relative flex items-center mb-2 mt-1 first:mt-0">
                      <div className="absolute left-[-19px] w-4 h-4 rounded-full bg-[#3B82C4] dark:bg-blue-400 flex items-center justify-center z-10">
                        <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      </div>
                      <span className="text-xs font-bold text-[#3B82C4] dark:text-blue-400 tracking-wide">
                        {week.year}
                      </span>
                    </div>
                  )}

                  {/* Week entry */}
                  <div className="relative group flex items-start gap-3 py-1.5">
                    {/* Timeline dot */}
                    <div className="absolute left-[-20px] top-[9px] w-[10px] h-[10px] rounded-full border-2 border-[#D1D5DB] dark:border-zinc-600 bg-[#F7F8FA] dark:bg-zinc-900 group-hover:border-[#3B82C4] dark:group-hover:border-blue-400 transition-colors z-10" />

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[12px] font-medium text-[#1B2432] dark:text-zinc-200">
                          {dateLabel}
                        </span>
                        <span className="text-[11px] tabular-nums text-[#4E5D6E] dark:text-zinc-400 whitespace-nowrap">
                          {week.total.toLocaleString()} msgs
                        </span>
                      </div>

                      {/* Volume bar */}
                      <div className="mt-1 h-[6px] w-full rounded-full bg-[#1B2432]/[0.04] dark:bg-white/[0.04] overflow-hidden">
                        <div
                          className="h-full rounded-full flex overflow-hidden transition-all"
                          style={{ width: `${barPct}%` }}
                        >
                          <div
                            className="h-full bg-[#3B82C4] dark:bg-blue-400"
                            style={{ width: `${sentPct}%` }}
                          />
                          <div
                            className="h-full bg-[#93c5fd] dark:bg-blue-700"
                            style={{ width: `${100 - sentPct}%` }}
                          />
                        </div>
                      </div>

                      {/* Hover detail */}
                      <div className="h-0 overflow-hidden group-hover:h-auto group-hover:mt-1 transition-all">
                        <div className="flex gap-3 text-[10px] text-[#94A3B3] dark:text-zinc-500">
                          <span>{week.sent.toLocaleString()} sent</span>
                          <span>{week.received.toLocaleString()} received</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-end gap-3 mt-3 pt-2 border-t border-[#D1D5DB]/20 dark:border-white/[0.06]">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-[1px] bg-[#3B82C4] dark:bg-blue-400" />
            <span className="text-[10px] text-[#94A3B3] dark:text-zinc-500">Sent</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-[1px] bg-[#93c5fd] dark:bg-blue-700" />
            <span className="text-[10px] text-[#94A3B3] dark:text-zinc-500">Received</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
