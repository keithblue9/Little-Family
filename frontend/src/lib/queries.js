import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";

/**
 * Shared, cached server state. Several screens read the same things (family
 * settings, labels); with one query key they share one request and one cache
 * instead of each fetching on mount.
 */
export const qk = {
  configLite: ["config", "lite"],
  familyMission: ["family-mission"],
  memories: (childId, month) => ["memories", childId || "all", month],
  suggestions: ["schedule-suggestions"],
};

export function useConfigLite(enabled = true) {
  return useQuery({
    queryKey: qk.configLite,
    queryFn: async () => (await api.get("/config", { params: { lite: true } })).data,
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (key) => qc.invalidateQueries({ queryKey: key });
}
