"use client";

import { Search, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/stores/app-store";

export function GlobalSearch() {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);

  return (
    <div className="flex flex-1 flex-col bg-[#F0EDE8] dark:bg-zinc-950 p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-[#071739] dark:text-white">Search</h1>
        <p className="mt-1 text-sm text-[#4B6382] dark:text-zinc-400">
          Find messages across all your conversations
        </p>
      </div>

      {/* Search bar */}
      <div className="mx-auto w-full max-w-xl">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#A4B5C4] dark:text-zinc-500" />
          <Input
            placeholder="Search messages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-12 pl-11 text-base bg-white dark:bg-zinc-900 border-[#CDD5DB] dark:border-zinc-700 text-[#071739] dark:text-zinc-200 placeholder:text-[#A4B5C4] dark:placeholder:text-zinc-500 focus-visible:ring-[#4B6382]/40 dark:focus-visible:ring-blue-500/40"
          />
        </div>
      </div>

      {/* Coming soon teaser */}
      <div className="mx-auto mt-16 flex max-w-md flex-col items-center text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#4B6382]/20 to-[#071739]/20 dark:from-purple-600/20 dark:to-blue-600/20">
          <Sparkles className="h-8 w-8 text-[#4B6382] dark:text-purple-400" />
        </div>
        <h2 className="text-lg font-semibold text-[#071739] dark:text-zinc-300">
          Semantic Search Coming Soon
        </h2>
        <p className="mt-2 text-sm text-[#4B6382] dark:text-zinc-500 leading-relaxed">
          AI-powered semantic search will let you find messages by meaning, not
          just keywords. Powered by local embeddings for complete privacy.
        </p>
      </div>
    </div>
  );
}
