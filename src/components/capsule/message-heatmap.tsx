"use client";

import { useMemo } from "react";
import { useTemporalTrends } from "@/hooks/use-analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DailyMessageCount } from "@/types";

const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const COLORS_LIGHT = ["#e4e4e7", "#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6"];
const COLORS_DARK = ["#27272a", "#1e3a5f", "#1d4ed8", "#2563eb", "#3b82f6"];

function getColor(count: number, max: number, isDark: boolean): string {
  const colors = isDark ? COLORS_DARK : COLORS_LIGHT;
  if (count === 0) return colors[0];
  const ratio = Math.min(count / Math.max(max * 0.6, 1), 1);
  if (ratio < 0.25) return colors[1];
  if (ratio < 0.5) return colors[2];
  if (ratio < 0.75) return colors[3];
  return colors[4];
}

interface HeatmapGridProps {
  data: DailyMessageCount[];
  year: number;
}

function HeatmapGrid({ data, year }: HeatmapGridProps) {
  const { cells, max, monthPositions } = useMemo(() => {
    const dateMap = new Map<string, number>();
    for (const d of data) {
      dateMap.set(d.date, d.sent + d.received);
    }

    const displayYear = year === 0 ? new Date().getFullYear() : year;
    const jan1 = new Date(displayYear, 0, 1);
    const dec31 = new Date(displayYear, 11, 31);

    // Adjust start to previous Sunday of Jan 1
    const adjustedStart = new Date(jan1);
    adjustedStart.setDate(adjustedStart.getDate() - jan1.getDay());

    const cellData: { date: string; count: number; col: number; row: number }[] = [];
    let maxCount = 0;
    const mPositions: { month: string; col: number }[] = [];
    let lastMonth = -1;

    // Iterate day by day from adjustedStart
    const current = new Date(adjustedStart);
    while (current <= dec31) {
      const row = current.getDay(); // 0=Sun, 6=Sat
      const daysSinceStart = Math.round(
        (current.getTime() - adjustedStart.getTime()) / (1000 * 60 * 60 * 24)
      );
      const col = Math.floor(daysSinceStart / 7);

      // Format as YYYY-MM-DD (local timezone)
      const y = current.getFullYear();
      const m = current.getMonth();
      const d = current.getDate();
      const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const count = dateMap.get(dateStr) ?? 0;
      if (count > maxCount) maxCount = count;

      // Track month label positions (first occurrence of each month in the display year)
      if (m !== lastMonth && y === displayYear) {
        mPositions.push({ month: MONTH_LABELS[m], col });
        lastMonth = m;
      }

      cellData.push({ date: dateStr, count, col, row });
      current.setDate(current.getDate() + 1);
    }

    return { cells: cellData, max: maxCount, monthPositions: mPositions };
  }, [data, year]);

  const isDark = typeof window !== "undefined" && document.documentElement.classList.contains("dark");

  const cellSize = 11;
  const cellGap = 2;
  const labelWidth = 28;
  const headerHeight = 16;
  const numCols = cells.length > 0 ? Math.max(...cells.map((c) => c.col)) + 1 : 53;
  const totalWidth = labelWidth + (cellSize + cellGap) * numCols;
  const totalHeight = headerHeight + (cellSize + cellGap) * 7;

  return (
    <svg width="100%" viewBox={`0 0 ${totalWidth} ${totalHeight}`} className="overflow-visible">
      {/* Month labels */}
      {monthPositions.map((m) => (
        <text
          key={m.month + m.col}
          x={labelWidth + m.col * (cellSize + cellGap)}
          y={10}
          className="fill-[#94A3B3] dark:fill-zinc-500"
          fontSize="8"
          fontFamily="system-ui"
        >
          {m.month}
        </text>
      ))}

      {/* Day labels */}
      {DAY_LABELS.map((label, i) =>
        label ? (
          <text
            key={i}
            x={0}
            y={headerHeight + i * (cellSize + cellGap) + cellSize - 1}
            className="fill-[#94A3B3] dark:fill-zinc-500"
            fontSize="8"
            fontFamily="system-ui"
          >
            {label}
          </text>
        ) : null
      )}

      {/* Cells */}
      {cells.map((cell) => (
        <rect
          key={cell.date}
          x={labelWidth + cell.col * (cellSize + cellGap)}
          y={headerHeight + cell.row * (cellSize + cellGap)}
          width={cellSize}
          height={cellSize}
          rx={2}
          fill={getColor(cell.count, max, isDark)}
        >
          <title>{`${cell.date}: ${cell.count} messages`}</title>
        </rect>
      ))}
    </svg>
  );
}

export function MessageHeatmap({
  chatId,
  year,
}: {
  chatId: number | null;
  year: number;
}) {
  const { data, isLoading } = useTemporalTrends(chatId, year === 0 ? undefined : year);

  if (isLoading) {
    return (
      <Card className="card-glass">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
            Message Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#D1D5DB] dark:border-zinc-600 border-t-[#3B82C4] dark:border-t-blue-400" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) return null;

  const isDark = typeof window !== "undefined" && document.documentElement.classList.contains("dark");

  return (
    <Card className="card-glass">
      <CardHeader>
        <CardTitle className="text-lg font-semibold text-[#1B2432] dark:text-white">
          Message Activity
        </CardTitle>
        <span className="ml-auto text-xs text-[#94A3B3] dark:text-zinc-500">
          {data.reduce((sum, d) => sum + d.sent + d.received, 0).toLocaleString()} messages · {year === 0 ? new Date().getFullYear() : year}
        </span>
      </CardHeader>
      <CardContent>
        <HeatmapGrid data={data} year={year} />
        {/* Legend */}
        <div className="flex items-center justify-end gap-1 mt-3">
          <span className="text-[10px] text-[#94A3B3] dark:text-zinc-500 mr-1">Less</span>
          {(isDark ? COLORS_DARK : COLORS_LIGHT).map((color, i) => (
            <div
              key={i}
              className="w-[11px] h-[11px] rounded-[2px]"
              style={{ backgroundColor: color }}
            />
          ))}
          <span className="text-[10px] text-[#94A3B3] dark:text-zinc-500 ml-1">More</span>
        </div>
      </CardContent>
    </Card>
  );
}
