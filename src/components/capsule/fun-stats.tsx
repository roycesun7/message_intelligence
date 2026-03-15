"use client";

import { useTextingPersonality } from "@/hooks/use-analytics";

const PERSONALITY_EMOJI: Record<string, string> = {
  "Night Owl": "\u{1F989}",
  "Early Bird": "\u{1F426}",
  "Essay Writer": "\u{1F4DD}",
  "Rapid Fire": "\u26A1",
  "Conversation Starter": "\u{1F4AC}",
  "Slow Burn": "\u{1F525}",
  "Weekend Warrior": "\u{1F3D6}\uFE0F",
  Ghost: "\u{1F47B}",
};

function getPersonalityEmoji(type: string): string {
  return PERSONALITY_EMOJI[type] ?? "\u2728";
}

export function FunStats({ chatId }: { chatId: number | null }) {
  const { data, isLoading } = useTextingPersonality(chatId);

  if (isLoading) {
    return (
      <div className="card-glass rounded-[20px] p-6">
        <div className="flex items-center justify-center py-12">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#D1D5DB] dark:border-zinc-600 border-t-[#3B82C4] dark:border-t-blue-400" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card-glass rounded-[20px] p-6">
        <p className="text-sm text-[#94A3B3] dark:text-zinc-500 text-center py-4">
          Not enough data to determine your personality.
        </p>
      </div>
    );
  }

  return (
    <div className="card-glass rounded-[20px] p-6">
      {/* Hero */}
      <div className="pers-hero">
        <p className="text-[56px] mb-3">
          {getPersonalityEmoji(data.primaryType)}
        </p>
        <p className="text-[28px] font-extrabold tracking-tight text-[#1B2432] dark:text-white">
          {data.primaryType}
        </p>
        {data.secondaryType && (
          <p className="mt-2 text-sm text-[#94A3B3] dark:text-zinc-500">
            with a touch of{" "}
            <span className="font-medium text-[#1B2432] dark:text-zinc-300">
              {getPersonalityEmoji(data.secondaryType)} {data.secondaryType}
            </span>
          </p>
        )}
      </div>

      {/* Traits */}
      {data.traits.length > 0 && (
        <div className="mt-5 space-y-3">
          {data.traits.map((trait) => {
            const pct = Math.max(Math.round(trait.score * 100), 2);
            return (
              <div key={trait.name}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[13px] font-medium text-[#1B2432] dark:text-zinc-200">
                    {trait.name}
                  </span>
                  <span className="text-xs text-[#94A3B3] dark:text-zinc-500">
                    {Math.round(trait.score * 100)}%
                  </span>
                </div>
                <div className="h-1 rounded-full bg-[#1B2432]/[0.06] dark:bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#1B2432] to-[#3B82C4] dark:from-blue-400 dark:to-purple-400"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-[11px] text-[#94A3B3] dark:text-zinc-600 mt-1">
                  {trait.description}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
