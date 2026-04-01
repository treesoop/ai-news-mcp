import { readCachePrimary } from "../cache";
import { Category, NewsItem, NewsSource } from "../types";

const SOURCE_BOOST: Partial<Record<NewsSource, number>> = {
  hackernews: 300,
  reddit_ml: 250,
  reddit_localllama: 250,
  reddit_artificial: 200,
  reddit_programming: 150,
  arxiv_ai: 100,
  arxiv_ml: 100,
  github: 80,
  devto: 60,
  lobsters: 60,
  geeknews: 40,
};

const SOURCE_LABELS: Record<NewsSource, string> = {
  hackernews: "HN",
  devto: "Dev.to",
  lobsters: "Lobsters",
  reddit_ml: "r/MachineLearning",
  reddit_localllama: "r/LocalLLaMA",
  reddit_artificial: "r/artificial",
  reddit_programming: "r/programming",
  arxiv_ai: "ArXiv cs.AI",
  arxiv_ml: "ArXiv cs.LG",
  github: "GitHub Trending",
  geeknews: "GeekNews",
};

function buildWhy(item: NewsItem): string {
  const label = SOURCE_LABELS[item.source] ?? item.source;
  const scoreStr = item.score > 0 ? ` with ${item.score} points` : "";
  const summary = item.summary ? ` — ${item.summary.slice(0, 80).trimEnd()}` : "";
  return `Trending on ${label}${scoreStr}${summary}`;
}

function getTryUrl(item: NewsItem): string | undefined {
  // For GitHub repos, the url is the try_url itself
  if (item.source === "github" && item.url.includes("github.com")) {
    return item.url;
  }
  // For ArXiv, link to the paper
  if (item.source === "arxiv_ai" || item.source === "arxiv_ml") {
    return item.url;
  }
  return undefined;
}

export interface TopPicksResult {
  picks: Array<NewsItem & { why: string; try_url?: string }>;
  total_available: number;
  cached_at: string;
}

export async function getTopPicks(
  n: number = 10,
  category?: Category
): Promise<TopPicksResult | { error: string }> {
  try {
    const cache = await readCachePrimary();
    if (!cache) {
      return { error: "No cache available. Run get_trending_news first." };
    }

    let items = cache.items;

    // Filter by category if specified
    if (category && category !== "all") {
      const SOURCE_CATEGORIES: Record<NewsSource, Category[]> = {
        hackernews: ["dev-tools", "AI"],
        devto: ["dev-tools", "AI"],
        lobsters: ["dev-tools"],
        reddit_ml: ["AI"],
        reddit_localllama: ["AI"],
        reddit_artificial: ["AI", "community"],
        reddit_programming: ["dev-tools", "community"],
        arxiv_ai: ["AI"],
        arxiv_ml: ["AI"],
        github: ["dev-tools"],
        geeknews: ["community", "dev-tools"],
      };
      items = items.filter((item) => SOURCE_CATEGORIES[item.source]?.includes(category));
    }

    // Score each item: base score + source boost
    const scored = items
      .map((item) => ({
        item,
        effectiveScore: item.score + (SOURCE_BOOST[item.source] ?? 0),
      }))
      .sort((a, b) => b.effectiveScore - a.effectiveScore)
      .slice(0, n);

    const picks = scored.map(({ item }) => ({
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
