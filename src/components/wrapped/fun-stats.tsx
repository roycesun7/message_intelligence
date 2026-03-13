"use client";

import { useTextingPersonality } from "@/hooks/use-analytics";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Sparkles } from "lucide-react";

// ── Personality type emoji map ───────────────────────────

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

// ── Texting Personality Card ─────────────────────────────

function TextingPersonalityCard({ chatId }: { chatId: number | null }) {
  const { data, isLoading } = useTextingPersonality(chatId);

  return (
    <Card className="card-glass">
      <CardHeader className="flex flex-row items-center gap-2">
        <Sparkles className="h-5 w-5 text-[#A68868] dark:text-yellow-400" />
        <CardTitle className="text-lg font-semibold text-[#071739] dark:text-white">
          Your Texting Personality
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#CDD5DB] dark:border-zinc-600 border-t-[#A68868] dark:border-t-yellow-400" />
          </div>
        )}

        {!isLoading && !data && (
          <p className="text-sm text-[#A4B5C4] dark:text-zinc-500">
            Not enough data to determine your personality.
          </p>
        )}

        {!isLoading && data && (
          <div className="space-y-6">
            {/* Primary type */}
            <div className="text-center py-2">
              <p className="text-5xl mb-3">
                {getPersonalityEmoji(data.primaryType)}
              </p>
              <p className="text-2xl font-bold tracking-tight text-[#071739] dark:text-white">
                {data.primaryType}
              </p>
              {data.secondaryType && (
                <p className="mt-2 text-sm text-[#A4B5C4] dark:text-zinc-500">
                  with a touch of{" "}
                  <span className="font-medium text-[#071739] dark:text-zinc-300">
                    {getPersonalityEmoji(data.secondaryType)}{" "}
                    {data.secondaryType}
                  </span>
                </p>
              )}
            </div>

            {/* Traits */}
            {data.traits.length > 0 && (
              <div className="space-y-3">
                <p className="section-header">Traits</p>
                {data.traits.map((trait) => (
                  <div key={trait.name} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[#071739] dark:text-zinc-200">
                        {trait.name}
                      </span>
                      <span className="text-xs tabular-nums text-[#A4B5C4] dark:text-zinc-500">
                        {Math.round(trait.score * 100)}%
                      </span>
                    </div>
                    <p className="text-[11px] text-[#A4B5C4] dark:text-zinc-600">
                      {trait.description}
                    </p>
                    <div className="h-1 w-full rounded-full bg-[#CDD5DB]/30 dark:bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#A68868] to-[#E3C39D] dark:from-amber-400 dark:to-orange-400 transition-all"
                        style={{ width: `${Math.max(Math.round(trait.score * 100), 2)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main export ──────────────────────────────────────────

export function FunStats({ chatId }: { chatId: number | null }) {
  return (
    <div className="mt-8">
      <TextingPersonalityCard chatId={chatId} />
    </div>
  );
}
