import * as path from "path";
import * as dotenv from "dotenv";
import { CacheData, NewsItem } from "./types";

// Load .env from project root
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function isSupabaseConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

interface SupabaseCacheRow {
  data: {
    items: NewsItem[];
    source_counts: Record<string, number>;
    total: number;
    fetched_at: string;
  };
  created_at: string;
  cache_key: string;
}

/**
 * Fetch the latest cache row from Supabase news_cache table.
 * Returns null if Supabase is not configured or fetch fails.
 */
export async function readCacheFromSupabase(): Promise<CacheData | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const url = `${SUPABASE_URL}/rest/v1/news_cache?order=created_at.desc&limit=1&select=data,created_at,cache_key`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY!}`,
        "Content-Type": "application/json",
      },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[supabase] Failed to fetch cache: ${res.status} ${res.statusText}`);
      return null;
    }

    const rows = await res.json() as SupabaseCacheRow[];
    if (!rows || rows.length === 0) {
      return null;
    }

    const row = rows[0];
    const { data, created_at } = row;

    if (!data || !data.items) {
      console.warn("[supabase] Cache row missing data.items");
      return null;
    }

    return {
      cached_at: data.fetched_at || created_at,
      items: data.items,
      source_counts: data.source_counts as CacheData["source_counts"],
    };
  } catch (err) {
    console.warn("[supabase] Error reading cache:", err);
    return null;
  }
}

/**
 * Query Supabase for cache rows created after `since` ISO timestamp.
 * Returns all items from those rows, deduplicated by URL.
 */
export async function readCacheSince(since: string): Promise<NewsItem[] | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const encoded = encodeURIComponent(since);
    const url = `${SUPABASE_URL}/rest/v1/news_cache?created_at=gt.${encoded}&order=created_at.desc&select=data,created_at`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY!}`,
        "Content-Type": "application/json",
      },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[supabase] Failed to fetch since rows: ${res.status} ${res.statusText}`);
      return null;
    }

    const rows = await res.json() as SupabaseCacheRow[];
    if (!rows || rows.length === 0) {
      return [];
    }

    const seenUrls = new Set<string>();
    const allItems: NewsItem[] = [];

    for (const row of rows) {
      if (!row.data?.items) continue;
      for (const item of row.data.items) {
        if (!seenUrls.has(item.url)) {
          seenUrls.add(item.url);
          allItems.push(item);
        }
      }
    }

    return allItems;
  } catch (err) {
    console.warn("[supabase] Error reading since cache:", err);
    return null;
  }
}
