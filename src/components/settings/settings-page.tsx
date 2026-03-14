"use client";

import { useState } from "react";
import { Settings, RotateCcw } from "lucide-react";
import { useEmbeddingStatus } from "@/hooks/use-search";
import { setIndexTarget, rebuildSearchIndex } from "@/lib/commands";
import { useQueryClient } from "@tanstack/react-query";

export function SettingsPage() {
  const { data: status } = useEmbeddingStatus();
  const queryClient = useQueryClient();
  const [sliderValue, setSliderValue] = useState<number | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  const currentTarget = status?.indexTarget ?? 1000;
  const totalMessages = status?.totalMessages ?? 0;
  const totalEmbedded = status?.totalEmbedded ?? 0;
  const displayTarget = sliderValue ?? currentTarget;

  const handleSliderChange = (value: number) => {
    setSliderValue(value);
  };

  const commitSliderValue = async (value: number | null) => {
    if (value === null) return;
    try {
      await setIndexTarget(value);
      queryClient.invalidateQueries({ queryKey: ["embeddingStatus"] });
    } catch (err) {
      console.error("Failed to set index target:", err);
    }
  };

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      await rebuildSearchIndex();
      queryClient.invalidateQueries({ queryKey: ["embeddingStatus"] });
    } catch (err) {
      console.error("Failed to rebuild index:", err);
    } finally {
      setRebuilding(false);
    }
  };

  const isIndexing = totalEmbedded < displayTarget;
  const progress = displayTarget > 0 ? Math.min(100, (totalEmbedded / displayTarget) * 100) : 0;

  return (
    <div className="flex flex-1 flex-col bg-[#F0EDE8] dark:bg-zinc-950 p-6 overflow-y-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-[#071739] dark:text-white">Settings</h1>
        <p className="mt-1 text-sm text-[#4B6382] dark:text-zinc-400">
          Configure search indexing and other preferences
        </p>
      </div>

      <div className="max-w-lg mx-auto w-full space-y-8">
        {/* Search Index Section */}
        <div className="bg-white/80 dark:bg-[#2C2C2E] rounded-2xl p-6 border border-[#CDD5DB]/40 dark:border-transparent">
          <div className="flex items-center gap-3 mb-4">
            <Settings className="h-5 w-5 text-[#4B6382] dark:text-zinc-400" />
            <h2 className="text-lg font-semibold text-[#071739] dark:text-white">Search Index</h2>
          </div>

          {/* Status */}
          <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-[#4B6382] dark:text-zinc-400">
                {status?.modelsLoaded ? (isIndexing ? "Indexing..." : "Ready") : "Models not loaded"}
              </span>
              <span className="text-sm text-[#A4B5C4] dark:text-zinc-500">
                {totalEmbedded.toLocaleString()} / {displayTarget.toLocaleString()} messages
              </span>
            </div>
            <div className="h-2 bg-[#CDD5DB]/40 dark:bg-zinc-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#007AFF] rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Slider */}
          <div className="mb-6">
            <label className="text-sm text-[#4B6382] dark:text-zinc-400 mb-2 block">
              Index Coverage
            </label>
            <input
              type="range"
              min={500}
              max={totalMessages || 10000}
              step={500}
              value={displayTarget}
              onChange={(e) => handleSliderChange(Number(e.target.value))}
              onPointerUp={() => commitSliderValue(sliderValue)}
              className="w-full accent-[#007AFF]"
            />
            <div className="flex justify-between mt-1">
              <span className="text-xs text-[#A4B5C4] dark:text-zinc-600">500</span>
              <span className="text-xs text-[#A4B5C4] dark:text-zinc-600">{totalMessages.toLocaleString()}</span>
            </div>
          </div>

          {/* Rebuild button */}
          <button
            onClick={handleRebuild}
            disabled={rebuilding}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#CDD5DB]/30 dark:bg-zinc-700 text-[#4B6382] dark:text-zinc-300 hover:bg-[#CDD5DB]/50 dark:hover:bg-zinc-600 transition-colors text-sm disabled:opacity-50 cursor-pointer"
          >
            <RotateCcw className={`h-4 w-4 ${rebuilding ? "animate-spin" : ""}`} />
            {rebuilding ? "Rebuilding..." : "Rebuild Index"}
          </button>
        </div>
      </div>
    </div>
  );
}
