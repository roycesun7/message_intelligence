import { useQuery } from "@tanstack/react-query";
import { getWrappedStats } from "@/lib/commands";
import type { WrappedStats } from "@/types";

/**
 * Fetch "Wrapped"-style analytics for a given year.
 * Pass 0 for all-time stats.
 */
export const useWrappedStats = (year: number) => {
  return useQuery<WrappedStats>({
    queryKey: ["wrappedStats", year],
    queryFn: () => getWrappedStats(year),
    staleTime: 60_000,
  });
};
