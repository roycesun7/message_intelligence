"use client";

import type { SemanticSearchResult } from "@/types";
import { useAppStore } from "@/stores/app-store";

// Gradient palette for link cards
const GRADIENTS = [
  "from-blue-500 to-indigo-600",
  "from-purple-500 to-pink-500",
  "from-emerald-500 to-teal-600",
  "from-orange-400 to-red-500",
  "from-cyan-500 to-blue-600",
  "from-rose-400 to-purple-500",
  "from-amber-400 to-orange-500",
  "from-fuchsia-500 to-purple-600",
];

function getInitials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function getDomain(url: string | null, domain: string | null): string {
  if (domain) return domain;
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface SearchResultLinksProps {
  results: SemanticSearchResult[];
}

export function SearchResultLinks({ results }: SearchResultLinksProps) {
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const setScrollToMessageDate = useAppStore((s) => s.setScrollToMessageDate);
  const setView = useAppStore((s) => s.setView);

  const handleClick = (result: SemanticSearchResult) => {
    setSelectedChatId(result.chatId);
    setScrollToMessageDate(result.date, result.messageRowid);
    setView("chat");
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      {results.map((result) => {
        const gradientIndex =
          Math.abs(
            (result.linkUrl || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0)
          ) % GRADIENTS.length;
        const gradient = GRADIENTS[gradientIndex];
        const senderName = result.isFromMe ? "You" : result.senderDisplayName;
        const initials = getInitials(senderName);
        const domain = getDomain(result.linkUrl, result.linkDomain);
        const title = result.linkTitle || result.linkUrl || "Link";

        return (
          <button
            key={`${result.messageRowid}-${result.sourceId}`}
            onClick={() => handleClick(result)}
            className="flex flex-col overflow-hidden rounded-xl border border-[#CDD5DB]/60 dark:border-white/[0.08] bg-white dark:bg-zinc-900 transition-transform hover:scale-[1.02] cursor-pointer text-left"
          >
            {/* Gradient header with initials badge */}
            <div
              className={`relative h-20 bg-gradient-to-br ${gradient} flex items-center justify-center`}
            >
              <div className="h-10 w-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <span className="text-sm font-bold text-white">{initials}</span>
              </div>
            </div>

            {/* Footer with title + domain */}
            <div className="px-3 py-2.5 min-h-[52px] flex flex-col justify-center">
              <p className="text-xs font-medium text-[#071739] dark:text-zinc-200 truncate">
                {title}
              </p>
              <p className="text-[10px] text-[#A4B5C4] dark:text-zinc-500 mt-0.5 truncate">
                {domain}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
