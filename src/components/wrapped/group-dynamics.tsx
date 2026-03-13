"use client";

import { useGroupChatDynamics } from "@/hooks/use-analytics";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Users } from "lucide-react";
import type { ParticipantStats } from "@/types";

// ── Helpers ──────────────────────────────────────────────

function findReplyMagnet(
  participants: ParticipantStats[],
): ParticipantStats | undefined {
  return [...participants].sort(
    (a, b) => b.repliesTriggered - a.repliesTriggered,
  )[0];
}

// ── Component ────────────────────────────────────────────

export function GroupDynamics({ chatId }: { chatId: number }) {
  const { data, isLoading } = useGroupChatDynamics(chatId);

  if (isLoading) {
    return (
      <div className="mb-8 flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#CDD5DB] dark:border-zinc-600 border-t-[#4B6382] dark:border-t-blue-500" />
          <p className="text-sm text-[#A4B5C4] dark:text-zinc-500">Loading group dynamics...</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const sorted = [...data.participants].sort(
    (a, b) => b.messageCount - a.messageCount,
  );
  const maxMessages = sorted[0]?.messageCount ?? 1;
  const replyMagnet = findReplyMagnet(data.participants);

  return (
    <div className="mb-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Users className="h-6 w-6 text-[#4B6382] dark:text-blue-400" />
        <p className="text-lg font-semibold text-[#071739] dark:text-white">The Group Chat</p>
      </div>

      {/* MVP Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Most Active */}
        <Card className="card-glass">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-[#4B6382] dark:text-zinc-400">
              Most Active
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="truncate text-lg font-bold text-[#071739] dark:text-white">
              {data.mostActiveParticipant ?? "Unknown"}
            </p>
            <p className="text-xs text-[#A4B5C4] dark:text-zinc-500">
              {sorted[0]?.messageCount.toLocaleString() ?? 0} messages
            </p>
          </CardContent>
        </Card>

        {/* Conversation Starter */}
        <Card className="card-glass">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-[#4B6382] dark:text-zinc-400">
              Conversation Starter
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="truncate text-lg font-bold text-[#071739] dark:text-white">
              {data.conversationStarter ?? "Unknown"}
            </p>
            <p className="text-xs text-[#A4B5C4] dark:text-zinc-500">Initiates the most chats</p>
          </CardContent>
        </Card>

        {/* Reply Magnet */}
        <Card className="card-glass">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-[#4B6382] dark:text-zinc-400">
              Reply Magnet
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="truncate text-lg font-bold text-[#071739] dark:text-white">
              {replyMagnet?.displayName ?? "Unknown"}
            </p>
            <p className="text-xs text-[#A4B5C4] dark:text-zinc-500">
              {replyMagnet?.repliesTriggered.toLocaleString() ?? 0} replies
              triggered
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Participant Table */}
      <Card className="card-glass">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-[#071739] dark:text-white">
            Participants ({sorted.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {sorted.map((p, idx) => {
              const pct = (p.messageCount / maxMessages) * 100;
              const highIgnored =
                p.ignoredCount > 0 &&
                p.ignoredCount >=
                  Math.max(
                    ...sorted.map((s) => s.ignoredCount),
                  ) *
                    0.7;

              return (
                <div key={p.handleId} className="space-y-1">
                  {/* Name row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-5 text-right text-xs font-bold text-[#A4B5C4] dark:text-zinc-500">
                        {idx + 1}
                      </span>
                      <span className="truncate text-sm font-medium text-[#071739] dark:text-zinc-200">
                        {p.displayName ?? `Handle ${p.handleId}`}
                      </span>
                    </div>
                    <span className="text-xs tabular-nums text-[#4B6382] dark:text-zinc-400">
                      {p.messageCount.toLocaleString()} msgs
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="ml-7 h-1.5 w-full rounded-full bg-[#CDD5DB]/30 dark:bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#071739]/80 to-[#A68868]/80 dark:from-blue-500/80 dark:to-purple-500/80 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  {/* Stats row */}
                  <div className="ml-7 flex gap-4 text-[11px] text-[#A4B5C4] dark:text-zinc-500">
                    <span>
                      Avg length:{" "}
                      <span className="text-[#4B6382] dark:text-zinc-400">
                        {Math.round(p.avgMessageLength)}
                      </span>
                    </span>
                    <span>
                      Replies triggered:{" "}
                      <span className="text-[#4B6382] dark:text-zinc-400">
                        {p.repliesTriggered.toLocaleString()}
                      </span>
                    </span>
                    <span>
                      Ignored:{" "}
                      <span
                        className={
                          highIgnored ? "text-red-500 dark:text-red-400" : "text-[#4B6382] dark:text-zinc-400"
                        }
                      >
                        {p.ignoredCount.toLocaleString()}
                      </span>
                    </span>
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
