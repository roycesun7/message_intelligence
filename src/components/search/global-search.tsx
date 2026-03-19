"use client";

import { Search, Sparkles } from "lucide-react";

export function GlobalSearch() {
  return (
    <div className="flex flex-1 flex-col bg-[#ECEEF2] dark:bg-zinc-950 items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-[22px] bg-gradient-to-br from-purple-500/10 to-blue-500/10 dark:from-purple-600/20 dark:to-blue-600/20">
          <Search className="h-9 w-9 text-[#4E5D6E] dark:text-purple-400" />
        </div>
        <h2 className="text-xl font-semibold text-[#1B2432] dark:text-zinc-200">
          Search — Coming Soon
        </h2>
        <p className="mt-3 text-sm text-[#4E5D6E] dark:text-zinc-500 leading-relaxed">
          Semantic search will let you find messages by meaning, not just
          keywords. Search across all your conversations with natural language.
        </p>
        <div className="mt-5 flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-500/8 to-blue-500/8 dark:from-purple-500/15 dark:to-blue-500/15 px-4 py-2">
          <Sparkles className="h-4 w-4 text-purple-500 dark:text-purple-400" />
          <span className="text-xs font-medium text-purple-600 dark:text-purple-300">
            Powered by local AI — fully private
          </span>
        </div>
      </div>
    </div>
  );
}
