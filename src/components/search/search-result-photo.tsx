"use client";

import type { SemanticSearchResult } from "@/types";
import { useAppStore } from "@/stores/app-store";
import { useAttachmentData } from "@/hooks/use-messages";

const DEFAULT_VISIBLE = 9; // 3x3 grid

interface PhotoCellProps {
  result: SemanticSearchResult;
}

function PhotoCell({ result }: PhotoCellProps) {
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const setScrollToMessageDate = useAppStore((s) => s.setScrollToMessageDate);
  const setView = useAppStore((s) => s.setView);

  // Lazy-load attachment data for this message
  const { data: attachments } = useAttachmentData(result.messageRowid);

  const handleClick = () => {
    setSelectedChatId(result.chatId);
    setScrollToMessageDate(result.date, result.messageRowid);
    setView("chat");
  };

  // Find the first image attachment with a data URL
  const imageAttachment = attachments?.find(
    (a) => a.dataUrl && a.mimeType?.startsWith("image/")
  );

  const similarityPct = Math.round(result.score * 100);

  return (
    <button
      onClick={handleClick}
      className="relative aspect-square rounded-xl overflow-hidden bg-[#E8E6E1] dark:bg-zinc-800 cursor-pointer group"
    >
      {imageAttachment?.dataUrl ? (
        <img
          src={imageAttachment.dataUrl}
          alt=""
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <span className="text-[10px] text-[#A4B5C4] dark:text-zinc-500">
            Loading...
          </span>
        </div>
      )}
      {/* Similarity score badge */}
      <span
        className={`absolute top-1.5 right-1.5 text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-full backdrop-blur-sm ${
          similarityPct >= 70
            ? "bg-green-100/80 text-green-700 dark:bg-green-900/60 dark:text-green-400"
            : similarityPct >= 50
              ? "bg-blue-100/80 text-blue-700 dark:bg-blue-900/60 dark:text-blue-400"
              : "bg-zinc-100/80 text-zinc-600 dark:bg-zinc-800/80 dark:text-zinc-400"
        }`}
      >
        {similarityPct}%
      </span>
    </button>
  );
}

interface SearchResultPhotosProps {
  results: SemanticSearchResult[];
  showAll: boolean;
}

export function SearchResultPhotos({
  results,
  showAll,
}: SearchResultPhotosProps) {
  const visibleResults = showAll ? results : results.slice(0, DEFAULT_VISIBLE);
  const overflowCount = showAll ? 0 : Math.max(0, results.length - DEFAULT_VISIBLE);

  return (
    <div className="grid grid-cols-3 gap-2">
      {visibleResults.map((result, i) => {
        const isLast = !showAll && i === visibleResults.length - 1 && overflowCount > 0;

        return (
          <div key={`${result.messageRowid}-${result.sourceId}`} className="relative">
            <PhotoCell result={result} />
            {/* +N overlay on the last visible cell when there's overflow */}
            {isLast && (
              <div className="absolute inset-0 rounded-xl bg-black/50 flex items-center justify-center pointer-events-none">
                <span className="text-lg font-bold text-white">
                  +{overflowCount}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
