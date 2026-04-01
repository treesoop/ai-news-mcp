import { readCachePrimary } from "../cache";
import { NewsItem } from "../types";

export interface SearchTodayResult {
  query: string;
  total_found: number;
  items: NewsItem[];
}

export async function searchToday(
  query: string,
  limit: number = 20
): Promise<SearchTodayResult | { error: string }> {
  try {
    const cache = await readCachePrimary();
    if (!cache) {
      return { error: "No cache available. Run get_trending_news first." };
    }

    // Split query into words, filter to meaningful ones (length >= 2)
    const queryWords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 2);

    if (queryWords.length === 0) {
      return { error: "Query must contain at least one word (2+ characters)." };
    }

    // Filter and score items
    const scored = cache.items
      .map((item) => {
        const text = `${item.title} ${item.summary ?? ""}`.toLowerCase();
        const matchCount = queryWords.filter((w) => text.includes(w)).length;
        return { item, matchCount };
      })
      .filter(({ matchCount }) => matchCount > 0)
      .map(({ item, matchCount }) => ({
        item,
        score: matchCount * (item.score || 1),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      query,
      total_found: scored.length,
      items: scored.map(({ item }) => item),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
