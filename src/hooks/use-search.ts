import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { semanticSearch, checkEmbeddingStatus } from "@/lib/commands";
import type { SemanticSearchResult, EmbeddingStatus } from "@/types";

function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export const useSemanticSearch = (query: string) => {
  const debouncedQuery = useDebounce(query.trim(), 300);
  return useQuery<SemanticSearchResult[]>({
    queryKey: ["semanticSearch", debouncedQuery],
    queryFn: () => semanticSearch(debouncedQuery, 50),
    enabled: debouncedQuery.length > 0,
    staleTime: 60_000,
  });
};

export const useEmbeddingStatus = () => {
  return useQuery<EmbeddingStatus>({
    queryKey: ["embeddingStatus"],
    queryFn: checkEmbeddingStatus,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
};
