import { readCache, getAgeMinutes, isSupabaseConfigured } from "../cache";
import { readCacheFromSupabase } from "../supabase";
import { CacheCheckResult } from "../types";

export interface ExtendedCacheCheckResult extends CacheCheckResult {
  supabase_configured: boolean;
  supabase_cache?: {
    exists: boolean;
    cached_at: string;
    age_minutes: number;
    total_items: number;
  };
  local_cache?: {
    exists: boolean;
    cached_at?: string;
    age_minutes?: number;
  };
}

export async function checkCache(): Promise<ExtendedCacheCheckResult> {
  const supabaseConfigured = isSupabaseConfigured();

  // Check local cache
  const local = readCache();

  // Check Supabase cache
  let supabaseResult: ExtendedCacheCheckResult["supabase_cache"] | undefined;
  if (supabaseConfigured) {
    const sbCache = await readCacheFromSupabase();
    if (sbCache) {
      supabaseResult = {
        exists: true,
        cached_at: sbCache.cached_at,
        age_minutes: getAgeMinutes(sbCache.cached_at),
        total_items: sbCache.items.length,
      };
    } else {
      supabaseResult = {
        exists: false,
        cached_at: "",
        age_minutes: -1,
        total_items: 0,
      };
    }
  }

  // Primary cache for the standard result fields
  const primary = supabaseResult?.exists
    ? { cached_at: supabaseResult.cached_at, age_minutes: supabaseResult.age_minutes }
    : local
    ? { cached_at: local.cached_at, age_minutes: getAgeMinutes(local.cached_at) }
    : null;

  return {
    exists: !!(supabaseResult?.exists || local),
    cached_at: primary?.cached_at ?? "",
    age_minutes: primary?.age_minutes ?? -1,
    source_counts: local?.source_counts ?? (supabaseResult?.exists ? {} : {}),
    supabase_configured: supabaseConfigured,
    supabase_cache: supabaseResult,
    local_cache: {
      exists: !!local,
      cached_at: local?.cached_at,
      age_minutes: local ? getAgeMinutes(local.cached_at) : undefined,
    },
  };
}
