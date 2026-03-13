"use client";

import { useState, useEffect } from "react";
import { Search, Sparkles, ChevronDown, ChevronUp, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/stores/app-store";
import { useSemanticSearch, useEmbeddingStatus } from "@/hooks/use-search";
import { SearchResultMessage } from "./search-result-message";
import { SearchResultLinks } from "./search-result-link";
import { SearchResultPhotos } from "./search-result-photo";
import type { SemanticSearchResult, EmbeddingProgress } from "@/types";

// ── Result grouping helpers ────────────────────────────────────────

function isMessageResult(r: SemanticSearchResult): boolean {
  return (
    (r.sourceType === "message" || r.sourceType === "chunk") && !r.linkUrl
  );
}

function isLinkResult(r: SemanticSearchResult): boolean {
  return !!r.linkUrl;
}

function isPhotoResult(r: SemanticSearchResult): boolean {
  return (
    r.sourceType === "attachment" &&
    !!r.mimeType &&
    r.mimeType.startsWith("image/")
  );
}

// ── Collapsible section ────────────────────────────────────────────

const DEFAULT_MESSAGE_COUNT = 5;

interface SectionProps {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function Section({ title, count, expanded, onToggle, children }: SectionProps) {
  if (count === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[#071739] dark:text-zinc-200">
          {title}{" "}
          <span className="text-[#A4B5C4] dark:text-zinc-500 font-normal">
            ({count})
          </span>
        </h3>
        {count > DEFAULT_MESSAGE_COUNT && (
          <button
            onClick={onToggle}
            className="flex items-center gap-1 text-xs text-[#4B6382] dark:text-zinc-400 hover:text-[#071739] dark:hover:text-zinc-200 transition-colors cursor-pointer"
          >
            {expanded ? (
              <>
                Show Less <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                Show More <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Unified index status + progress ───────────────────────────────

function IndexStatusBar() {
  const { data: status } = useEmbeddingStatus();
  const [progress, setProgress] = useState<EmbeddingProgress | null>(null);

  useEffect(() => {
    const unlisten = listen<EmbeddingProgress>("embedding-progress", (event) => {
      setProgress(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  if (!status) return null;

  const { modelsLoaded, totalEmbedded, totalMessages } = status;

  // Models not loaded — warning
  if (!modelsLoaded) {
    return (
      <div className="mt-3 mx-auto w-full max-w-xl flex items-center gap-2 text-[11px] text-amber-600 dark:text-amber-400">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        <span>Search models not loaded. Check Settings for details.</span>
      </div>
    );
  }

  // Active indexing — show progress bar with phase and counts
  const isActivelyIndexing = progress && progress.phase !== "done";
  if (isActivelyIndexing) {
    const pct =
      progress.total > 0
        ? Math.round((progress.processed / progress.total) * 100)
        : 0;
    const phaseLabel =
      progress.phase === "chunking"
        ? "Analyzing messages"
        : progress.phase === "text"
          ? "Embedding text"
          : "Embedding attachments";

    return (
      <div className="mt-3 mx-auto w-full max-w-xl">
        <div className="flex items-center justify-between text-[11px] text-[#4B6382] dark:text-zinc-400 mb-1.5">
          <div className="flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{phaseLabel}</span>
          </div>
          <span>
            {progress.processed.toLocaleString()} / {progress.total.toLocaleString()} ({pct}%)
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-[#CDD5DB]/40 dark:bg-zinc-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        {totalEmbedded > 0 && (
          <div className="mt-1 text-[11px] text-[#A4B5C4] dark:text-zinc-500">
            {totalEmbedded.toLocaleString()} messages searchable so far
          </div>
        )}
      </div>
    );
  }

  // Finished indexing — show count
  if (totalEmbedded > 0) {
    return (
      <div className="mt-3 mx-auto w-full max-w-xl flex items-center gap-2 text-[11px] text-[#A4B5C4] dark:text-zinc-500">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>
          {totalEmbedded.toLocaleString()} of {totalMessages.toLocaleString()} messages indexed
        </span>
      </div>
    );
  }

  // No embeddings yet, no active progress — waiting to start
  return (
    <div className="mt-3 mx-auto w-full max-w-xl flex items-center gap-2 text-[11px] text-[#4B6382] dark:text-zinc-400">
      <Loader2 className="h-3 w-3 animate-spin" />
      <span>Preparing search index...</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────

export function GlobalSearch() {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);

  const { data: status } = useEmbeddingStatus();
  const { data: results, isLoading } = useSemanticSearch(searchQuery);

  const [messagesExpanded, setMessagesExpanded] = useState(false);
  const [linksExpanded, setLinksExpanded] = useState(false);
  const [photosExpanded, setPhotosExpanded] = useState(false);

  // Group results
  const messages = results?.filter(isMessageResult) ?? [];
  const links = results?.filter(isLinkResult) ?? [];
  const photos = results?.filter(isPhotoResult) ?? [];

  const hasQuery = searchQuery.trim().length > 0;
  const hasResults = messages.length + links.length + photos.length > 0;

  const visibleMessages = messagesExpanded
    ? messages
    : messages.slice(0, DEFAULT_MESSAGE_COUNT);

  return (
    <div className="flex flex-1 flex-col bg-[#F0EDE8] dark:bg-zinc-950 p-6 overflow-y-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-[#071739] dark:text-white">
          Search
        </h1>
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
            className="h-12 pl-11 pr-28 text-base bg-white dark:bg-zinc-900 border-[#CDD5DB] dark:border-zinc-700 text-[#071739] dark:text-zinc-200 placeholder:text-[#A4B5C4] dark:placeholder:text-zinc-500 focus-visible:ring-[#4B6382]/40 dark:focus-visible:ring-blue-500/40"
          />
          {/* Semantic badge */}
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 rounded-full bg-gradient-to-r from-purple-500/10 to-blue-500/10 dark:from-purple-500/20 dark:to-blue-500/20 px-2.5 py-1">
            <Sparkles className="h-3.5 w-3.5 text-purple-500 dark:text-purple-400" />
            <span className="text-[11px] font-medium text-purple-600 dark:text-purple-300">
              Semantic
            </span>
          </div>
        </div>
      </div>

      {/* Index status + progress */}
      <IndexStatusBar />

      {/* Content area */}
      <div className="mx-auto mt-8 w-full max-w-xl">
        {/* Loading state */}
        {isLoading && hasQuery && (
          <div className="flex flex-col items-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-[#A4B5C4] dark:text-zinc-500" />
            <p className="mt-3 text-sm text-[#4B6382] dark:text-zinc-400">
              Searching...
            </p>
          </div>
        )}

        {/* Empty state (no query) */}
        {!hasQuery && !isLoading && (
          <div className="flex flex-col items-center text-center pt-8">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#4B6382]/20 to-[#071739]/20 dark:from-purple-600/20 dark:to-blue-600/20">
              <Sparkles className="h-8 w-8 text-[#4B6382] dark:text-purple-400" />
            </div>
            <h2 className="text-lg font-semibold text-[#071739] dark:text-zinc-300">
              Semantic Search
            </h2>
            <p className="mt-2 text-sm text-[#4B6382] dark:text-zinc-500 leading-relaxed max-w-sm">
              Search by meaning, not just keywords. Type a question or
              description to find relevant messages, links, and photos across all
              your conversations.
            </p>
          </div>
        )}

        {/* No results state */}
        {hasQuery && !isLoading && !hasResults && (
          <div className="flex flex-col items-center text-center pt-8">
            <Search className="h-10 w-10 text-[#CDD5DB] dark:text-zinc-700 mb-3" />
            <h2 className="text-base font-semibold text-[#071739] dark:text-zinc-300">
              No results found
            </h2>
            <p className="mt-1 text-sm text-[#4B6382] dark:text-zinc-500">
              {status && !status.modelsLoaded
                ? "Search models are not loaded. Check Settings."
                : status && status.totalEmbedded === 0
                  ? "The search index is still building. Results will appear once indexing completes."
                  : "Try rephrasing your search or using different terms."}
            </p>
          </div>
        )}

        {/* Results */}
        {hasQuery && !isLoading && hasResults && (
          <div>
            {/* Messages section */}
            <Section
              title="Messages"
              count={messages.length}
              expanded={messagesExpanded}
              onToggle={() => setMessagesExpanded((v) => !v)}
            >
              <div className="flex flex-col gap-4">
                {visibleMessages.map((r) => (
                  <SearchResultMessage
                    key={`${r.messageRowid}-${r.sourceId}`}
                    result={r}
                  />
                ))}
              </div>
            </Section>

            {/* Links section */}
            <Section
              title="Links"
              count={links.length}
              expanded={linksExpanded}
              onToggle={() => setLinksExpanded((v) => !v)}
            >
              <SearchResultLinks
                results={
                  linksExpanded ? links : links.slice(0, DEFAULT_MESSAGE_COUNT)
                }
              />
            </Section>

            {/* Photos & Stickers section */}
            <Section
              title="Photos & Stickers"
              count={photos.length}
              expanded={photosExpanded}
              onToggle={() => setPhotosExpanded((v) => !v)}
            >
              <SearchResultPhotos results={photos} showAll={photosExpanded} />
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}
