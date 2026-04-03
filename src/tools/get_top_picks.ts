import { readCachePrimary } from "../cache";
import { Category, NewsItem, NewsSource } from "../types";

const SOURCE_LABELS: Partial<Record<NewsSource, string>> = {
  hackernews: "HN",
  show_hn: "Show HN",
  devto: "Dev.to",
  lobsters: "Lobsters",
  reddit_ml: "r/MachineLearning",
  reddit_localllama: "r/LocalLLaMA",
  reddit_artificial: "r/artificial",
  reddit_programming: "r/programming",
  reddit_claudeai: "r/ClaudeAI",
  arxiv_ai: "ArXiv cs.AI",
  arxiv_ml: "ArXiv cs.LG",
  github: "GitHub Trending",
  geeknews: "GeekNews",
  huggingface: "HuggingFace Papers",
  hf_spaces: "HF Spaces",
  openai: "OpenAI",
  thenewstack: "TheNewStack",
  infoq: "InfoQ",
};

function buildWhy(item: CuratedItem): string {
  const label = SOURCE_LABELS[item.source as NewsSource] ?? item.source;
  const scoreStr = item.score > 0 ? ` (${item.score}pts)` : "";
  const summaryStr = item.summary ? ` — ${item.summary}` : "";
  return `${label}${scoreStr}${summaryStr}`;
}

function getTryUrl(item: CuratedItem): string | undefined {
  if (item.source === "github" && item.url.includes("github.com")) return item.url;
  if (item.source === "arxiv_ai" || item.source === "arxiv_ml") return item.url;
  return undefined;
}

interface CuratedItem {
  title: string;
  url: string;
  source: string;
  score: number;
  summary?: string;
}

export interface TopPicksResult {
  picks: Array<CuratedItem & { why: string; try_url?: string }>;
  total_available: number;
  cached_at: string;
}

/**
 * Returns AI-curated top picks from news_curated table.
 * Items are pre-curated by Claude every 6 hours during the fetch cycle.
 * Falls back to algorithmic selection from raw cache if curated table is empty.
 */
export async function getTopPicks(
  n: number = 10,
  category?: Category
): Promise<TopPicksResult | { error: string }> {
  try {
    // Try curated table first
    const curated = await readCurated();
    if (curated && curated.length > 0) {
      const picks = curated.slice(0, n).map((item) => ({
        ...item,
        why: buildWhy(item),
        try_url: getTryUrl(item),
      }));
      return {
        picks,
        total_available: curated.length,
        cached_at: new Date().toISOString(),
      };
    }

    // Fallback: algorithmic selection from raw cache
    const cache = await readCachePrimary();
    if (!cache) {
      return { error: "No cache available. Run get_trending_news first." };
    }

    let items = cache.items;

    // Junk filter
    items = items.filter((item) => !isJunk(item));

    // Source-based diversity: top 3 per source
    const bySource = new Map<string, NewsItem[]>();
    for (const item of items) {
      const group = bySource.get(item.source) || [];
      group.push(item);
      bySource.set(item.source, group);
    }

    const pool: NewsItem[] = [];
    for (const [, group] of bySource) {
      group.sort((a, b) => b.score - a.score);
      pool.push(...group.slice(0, 3));
    }

    const picks = pool.slice(0, n).map((item) => ({
      ...item,
      why: buildWhy(item),
      try_url: getTryUrl(item),
    }));

    return {
      picks,
      total_available: items.length,
      cached_at: cache.cached_at,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function isJunk(item: NewsItem): boolean {
  const url = item.url.toLowerCase();
  const title = item.title.toLowerCase();
  if (url.includes("i.redd.it") || url.includes("i.imgur.com")) return true;
  if (url.includes("reddit.com/gallery/")) return true;
  if (url.includes("gist.github.com")) return true;
  if (title.includes("self-promotion") || title.includes("who's hiring")) return true;
  if (title.includes("[d] monthly") || title.includes("[d] weekly")) return true;
  return false;
}

/** Read from news_curated table via Supabase REST */
async function readCurated(): Promise<CuratedItem[] | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  try {
    const res = await fetch(
      `${url}/rest/v1/news_curated?select=title,url,source,score,summary&order=id.asc`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}
