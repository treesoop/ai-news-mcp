import { readCache, readCachePrimary, writeCache, getAgeMinutes } from "../cache";
import { scrapeHackerNews } from "../scrapers/hackernews";
import { scrapeDevTo } from "../scrapers/devto";
import { scrapeLobsters } from "../scrapers/lobsters";
import {
  scrapeRedditML,
  scrapeRedditLocalLLaMA,
  scrapeRedditArtificial,
  scrapeRedditProgramming,
  scrapeRedditClaudeAI,
} from "../scrapers/reddit";
import { scrapeArxivAI, scrapeArxivML } from "../scrapers/arxiv";
import { scrapeGitHubTrending } from "../scrapers/github";
import { scrapeGeekNews } from "../scrapers/geeknews";
import { scrapeOpenAINews } from "../scrapers/openai";
import { scrapeAnthropicNews } from "../scrapers/anthropic";
import { Category, NewsItem, NewsSource, TrendingNewsResult } from "../types";

const SOURCE_CATEGORIES: Partial<Record<NewsSource, Category[]>> = {
  hackernews: ["dev-tools", "AI"],
  show_hn: ["dev-tools", "AI"],
  devto: ["dev-tools", "AI"],
  lobsters: ["dev-tools"],
  reddit_ml: ["AI"],
  reddit_localllama: ["AI"],
  reddit_artificial: ["AI", "community"],
  reddit_programming: ["dev-tools", "community"],
  reddit_claudeai: ["AI", "community"],
  arxiv_ai: ["AI"],
  arxiv_ml: ["AI"],
  github: ["dev-tools"],
  geeknews: ["community", "dev-tools"],
  huggingface: ["AI"],
  hf_spaces: ["AI"],
  openai: ["AI"],
  anthropic: ["AI"],
  thenewstack: ["AI", "dev-tools"],
  infoq: ["AI", "dev-tools"],
};

function filterByCategory(items: NewsItem[], category: Category): NewsItem[] {
  if (category === "all") return items;
  return items.filter((item) => {
    const cats = SOURCE_CATEGORIES[item.source];
    return cats ? cats.includes(category) : false;
  });
}

async function fetchAllSources(): Promise<NewsItem[]> {
  const scrapers: Array<() => Promise<NewsItem[]>> = [
    scrapeHackerNews,
    scrapeDevTo,
    scrapeLobsters,
    scrapeRedditML,
    scrapeRedditLocalLLaMA,
    scrapeRedditArtificial,
    scrapeRedditProgramming,
    scrapeRedditClaudeAI,
    scrapeArxivAI,
    scrapeArxivML,
    scrapeGitHubTrending,
    scrapeGeekNews,
    scrapeOpenAINews,
    scrapeAnthropicNews,
  ];

  const results = await Promise.allSettled(scrapers.map((fn) => fn()));
  const allItems: NewsItem[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      allItems.push(...result.value);
    } else {
      console.warn("[scraper] Source failed:", result.reason);
    }
  }

  return allItems;
}

export async function getTrendingNews(
  category: Category = "all",
  refresh = false
): Promise<TrendingNewsResult> {
  let cache = refresh ? null : await readCachePrimary();

  if (!cache) {
    const items = await fetchAllSources();
    cache = writeCache(items);
  }

  const filtered = filterByCategory(cache.items, category);

  return {
    cached_at: cache.cached_at,
    age_minutes: getAgeMinutes(cache.cached_at),
    total: filtered.length,
    items: filtered,
  };
}
