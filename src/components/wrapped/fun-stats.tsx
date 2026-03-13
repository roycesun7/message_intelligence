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
    <Card className="border-zinc-800 bg-zinc-900">
      <CardHeader className="flex flex-row items-center gap-2">
        <Sparkles className="h-5 w-5 text-yellow-400" />
        <CardTitle className="text-lg font-semibold text-white">
          Your Texting Personality
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-600 border-t-yellow-400" />
          </div>
        )}

        {!isLoading && !data && (
          <p className="text-sm text-zinc-500">
            Not enough data to determine your personality.
          </p>
        )}

        {!isLoading && data && (
          <div className="space-y-6">
            {/* Primary type */}
            <div className="text-center">
              <p className="text-4xl">
                {getPersonalityEmoji(data.primaryType)}
              </p>
              <p className="mt-2 text-2xl font-bold text-white">
                {data.primaryType}
              </p>
              {data.secondaryType && (
                <p className="mt-1 text-sm text-zinc-400">
                  with a touch of{" "}
                  <span className="font-medium text-zinc-300">
                    {getPersonalityEmoji(data.secondaryType)}{" "}
                    {data.secondaryType}
                  </span>
                </p>
              )}
            </div>

            {/* Traits */}
            {data.traits.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                  Traits
                </p>
                {data.traits.map((trait) => (
                  <div key={trait.name} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-zinc-200">
                        {trait.name}
                      </span>
                      <span className="text-xs tabular-nums text-zinc-500">
                        {Math.round(trait.score * 100)}%
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      {trait.description}
                    </p>
                    <div className="h-1.5 w-full rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-yellow-500 to-orange-500 transition-all"
                        style={{ width: `${Math.round(trait.score * 100)}%` }}
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
