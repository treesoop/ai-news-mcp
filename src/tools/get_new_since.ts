import { isSupabaseConfigured } from "../cache";
import { readCacheSince } from "../supabase";
import { NewsItem } from "../types";

export interface GetNewSinceResult {
  since: string;
  total: number;
  items: NewsItem[];
}

export async function getNewSince(
  since: string
): Promise<GetNewSinceResult | { error: string }> {
  try {
    if (!isSupabaseConfigured()) {
      return { error: "requires Supabase connection" };
    }

    // Validate the ISO timestamp
    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) {
      return { error: `Invalid timestamp: "${since}". Expected ISO 8601 format (e.g., 2026-04-01T00:00:00Z).` };
    }

    const items = await readCacheSince(since);

    if (items === null) {
      return { error: "Failed to query Supabase. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." };
    }

    // Items are already sorted newest-first and deduplicated in readCacheSince
    return {
      since,
      total: items.length,
      items,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
