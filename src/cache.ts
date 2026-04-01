import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { CacheData, NewsItem, NewsSource } from "./types";
import { readCacheFromSupabase, isSupabaseConfigured } from "./supabase";

// Load .env from project root (quiet — env already loaded by index.ts)
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const CACHE_DIR = path.join(__dirname, "..", "cache");

function getCacheFilePath(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  return path.join(CACHE_DIR, `news_${yyyy}-${mm}-${dd}_${hh}.json`);
}

export function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

export function readCache(): CacheData | null {
  const filePath = getCacheFilePath();
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as CacheData;
  } catch (err) {
    console.warn("[cache] Failed to read cache file:", err);
    return null;
  }
}

export function writeCache(items: NewsItem[]): CacheData {
  ensureCacheDir();
  const filePath = getCacheFilePath();

  const source_counts: Partial<Record<NewsSource, number>> = {};
  for (const item of items) {
    source_counts[item.source] = (source_counts[item.source] ?? 0) + 1;
  }

  const data: CacheData = {
    cached_at: new Date().toISOString(),
    items,
    source_counts: source_counts as Record<NewsSource, number>,
  };

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  return data;
}

export function getAgeMinutes(cachedAt: string): number {
  const cached = new Date(cachedAt).getTime();
  const now = Date.now();
  return Math.floor((now - cached) / 60000);
}

/**
 * Read cache — tries Supabase first, falls back to local file cache.
 */
export async function readCachePrimary(): Promise<CacheData | null> {
  const supabaseData = await readCacheFromSupabase();
  if (supabaseData) {
    console.error("[cache] Using Supabase cache");
    return supabaseData;
  }
  // Fall back to local file
  const local = readCache();
  if (local) {
    console.error("[cache] Supabase unavailable — using local file cache");
  }
  return local;
}

export { isSupabaseConfigured };
