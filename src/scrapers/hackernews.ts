import { NewsItem } from "../types";

const HN_TOP_URL = "https://hacker-news.firebaseio.com/v0/topstories.json";
const HN_ITEM_URL = "https://hacker-news.firebaseio.com/v0/item";
const TOP_N = 20;
const TIMEOUT_MS = 10000;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

interface HNItem {
  id: number;
  title?: string;
  url?: string;
  score?: number;
  text?: string;
  type?: string;
}

export async function scrapeHackerNews(): Promise<NewsItem[]> {
  const topRes = await fetchWithTimeout(HN_TOP_URL, TIMEOUT_MS);
  if (!topRes.ok) throw new Error(`HN topstories HTTP ${topRes.status}`);

  const ids = (await topRes.json()) as number[];
  const topIds = ids.slice(0, TOP_N);

  const itemPromises = topIds.map(async (id) => {
    try {
      const res = await fetchWithTimeout(`${HN_ITEM_URL}/${id}.json`, TIMEOUT_MS);
      if (!res.ok) return null;
      return (await res.json() as HNItem);
    } catch {
      return null;
    }
  });

  const items = await Promise.all(itemPromises);
  const results: NewsItem[] = [];

  for (const item of items) {
    if (!item || !item.title || item.type !== "story") continue;
    results.push({
      title: item.title,
      url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
      source: "hackernews",
      score: item.score ?? 0,
      summary: item.text
        ? item.text.replace(/<[^>]+>/g, "").slice(0, 200)
        : undefined,
    });
  }

  return results;
}
