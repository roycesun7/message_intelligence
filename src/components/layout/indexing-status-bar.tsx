"use client";

import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Loader2 } from "lucide-react";
import type { EmbeddingProgress } from "@/types";

export function IndexingStatusBar() {
  const [progress, setProgress] = useState<EmbeddingProgress | null>(null);

  useEffect(() => {
    const unlisten = listen<EmbeddingProgress>("embedding-progress", (event) => {
      setProgress(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  if (!progress || progress.phase === "done") return null;

  const pct = progress.total > 0
    ? Math.round((progress.processed / progress.total) * 100)
    : 0;

  const phaseLabel = progress.phase === "chunking" ? "Analyzing" : "Indexing";

  return (
    <div className="flex items-center gap-2 px-3 py-1 text-xs text-[#4B6382] dark:text-zinc-400">
      <Loader2 className="h-3 w-3 animate-spin text-[#007AFF]" />
      <span>
        {phaseLabel}: {progress.processed.toLocaleString()} / {progress.total.toLocaleString()} ({pct}%)
      </span>
    </div>
  );
}
