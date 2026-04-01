import { readCache, getAgeMinutes } from "../cache";
import { CacheCheckResult } from "../types";

export function checkCache(): CacheCheckResult {
  const cache = readCache();

  if (!cache) {
    return {
      exists: false,
      cached_at: "",
      age_minutes: -1,
      source_counts: {},
    };
  }

  return {
    exists: true,
    cached_at: cache.cached_at,
    age_minutes: getAgeMinutes(cache.cached_at),
    source_counts: cache.source_counts,
  };
}
