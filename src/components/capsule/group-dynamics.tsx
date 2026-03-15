"use client";

import { useGroupChatDynamics } from "@/hooks/use-analytics";
import type { ParticipantStats } from "@/types";

function findReplyMagnet(
  participants: ParticipantStats[],
): ParticipantStats | undefined {
  return [...participants].sort(
    (a, b) => b.repliesTriggered - a.repliesTriggered,
  )[0];
}

export function GroupDynamics({ chatId }: { chatId: number }) {
  const { data, isLoading } = useGroupChatDynamics(chatId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#D1D5DB] dark:border-zinc-600 border-t-[#4E5D6E] dark:border-t-blue-500" />
          <p className="text-sm text-[#94A3B3] dark:text-zinc-500">Loading group dynamics...</p>
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
    <div className="space-y-4">
      {/* MVP Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card-glass rounded-2xl p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#4E5D6E] dark:text-zinc-400 mb-2">
            Most Active
          </p>
          <p className="text-base font-bold text-[#1B2432] dark:text-white truncate">
            {data.mostActiveParticipant ?? "Unknown"}
          </p>
          <p className="text-[11px] text-[#94A3B3] dark:text-zinc-500 mt-1">
            {sorted[0]?.messageCount.toLocaleString() ?? 0} messages
          </p>
        </div>
        <div className="card-glass rounded-2xl p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#4E5D6E] dark:text-zinc-400 mb-2">
            Conversation Starter
          </p>
          <p className="text-base font-bold text-[#1B2432] dark:text-white truncate">
            {data.conversationStarter ?? "Unknown"}
          </p>
          <p className="text-[11px] text-[#94A3B3] dark:text-zinc-500 mt-1">
            Initiates the most chats
          </p>
        </div>
        <div className="card-glass rounded-2xl p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#4E5D6E] dark:text-zinc-400 mb-2">
            Reply Magnet
          </p>
          <p className="text-base font-bold text-[#1B2432] dark:text-white truncate">
            {replyMagnet?.displayName ?? "Unknown"}
          </p>
          <p className="text-[11px] text-[#94A3B3] dark:text-zinc-500 mt-1">
            {replyMagnet?.repliesTriggered.toLocaleString() ?? 0} replies triggered
          </p>
        </div>
      </div>

      {/* Participants */}
      <div className="card-glass rounded-[20px] p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">👥</span>
          <h3 className="text-base font-bold text-[#1B2432] dark:text-white">
            Participants ({sorted.length})
          </h3>
        </div>
        <div className="space-y-3">
          {sorted.map((p, idx) => {
            const pct = (p.messageCount / maxMessages) * 100;
            const highIgnored =
              p.ignoredCount > 0 &&
              p.ignoredCount >=
                Math.max(...sorted.map((s) => s.ignoredCount)) * 0.7;

            return (
              <div key={p.handleId}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-5 text-right text-xs font-bold text-[#94A3B3] dark:text-zinc-500">
                      {idx + 1}
                    </span>
                    <span className="text-sm font-medium text-[#1B2432] dark:text-zinc-200 truncate">
                      {p.displayName ?? `Handle ${p.handleId}`}
                    </span>
                  </div>
                  <span className="text-xs text-[#4E5D6E] dark:text-zinc-400">
                    {p.messageCount.toLocaleString()} msgs
                  </span>
                </div>
                <div className="ml-7 h-[5px] rounded-full bg-[#1B2432]/[0.06] dark:bg-white/[0.06] mt-1">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#1B2432]/80 to-[#3B82C4]/80 dark:from-blue-500/80 dark:to-purple-500/80"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="ml-7 flex gap-4 text-[11px] text-[#94A3B3] dark:text-zinc-500 mt-1">
                  <span>
                    Avg length: <span className="text-[#4E5D6E] dark:text-zinc-400">{Math.round(p.avgMessageLength)}</span>
                  </span>
                  <span>
                    Replies triggered: <span className="text-[#4E5D6E] dark:text-zinc-400">{p.repliesTriggered.toLocaleString()}</span>
                  </span>
                  <span>
                    Ignored:{" "}
                    <span className={highIgnored ? "text-red-500 dark:text-red-400" : "text-[#4E5D6E] dark:text-zinc-400"}>
                      {p.ignoredCount.toLocaleString()}
                    </span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
