import { readCache, writeCache, getAgeMinutes } from "../cache";
import { getTrendingNews } from "./get_trending_news";
import { NewsItem, NewsSource, Project, TopicSuggestion, TopicSuggestionsResult } from "../types";

// Which sources to prioritize per project
const PROJECT_SOURCE_PRIORITY: Record<Project, NewsSource[]> = {
  treesoop: ["arxiv_ai", "arxiv_ml", "reddit_ml", "reddit_localllama", "reddit_artificial"],
  potenlab: ["hackernews", "devto", "github", "lobsters"],
  hanguljobs: ["reddit_programming", "hackernews", "devto", "geeknews", "reddit_artificial"],
};

function extractKeywords(title: string): string[] {
  // Split on spaces and common separators, keep tokens ≥4 chars, remove duplicates
  const tokens = title
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4)
    .map((t) => t.toLowerCase());

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      // Keep original casing from title for display
      const original = title
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .find((w) => w.toLowerCase() === t);
      unique.push(original ?? t);
    }
  }
  return unique.slice(0, 5);
}

function isSimilarToUsed(title: string, usedTopics: string[]): boolean {
  const titleLower = title.toLowerCase();
  for (const used of usedTopics) {
    const usedLower = used.toLowerCase();
    // Simple overlap: if any 4-char+ word from used appears in title
    const words = usedLower.split(/\s+/).filter((w) => w.length >= 4);
    const matchCount = words.filter((w) => titleLower.includes(w)).length;
    if (matchCount >= 2 || (words.length > 0 && matchCount / words.length >= 0.5)) {
      return true;
    }
  }
  return false;
}

function buildReason(item: NewsItem): string {
  const sourceLabel: Record<NewsSource, string> = {
    hackernews: "Hacker News",
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

  const label = sourceLabel[item.source] ?? item.source;
  if (item.score > 0) {
    return `Trending on ${label} with ${item.score} points`;
  }
  return `Featured on ${label}`;
}

export async function getTopicSuggestions(
  project: Project,
  slots: number = 3,
  usedTopics: string[] = []
): Promise<TopicSuggestionsResult> {
  // Get fresh or cached news
  let cache = readCache();
  if (!cache) {
    const news = await getTrendingNews("all", false);
    cache = readCache();
  }

  if (!cache) {
    return { suggestions: [] };
  }

  const prioritySources = PROJECT_SOURCE_PRIORITY[project];

  // Score items: priority sources get a boost
  const scored = cache.items
    .filter((item) => !isSimilarToUsed(item.title, usedTopics))
    .map((item) => {
      const priorityIndex = prioritySources.indexOf(item.source);
      const priorityBoost = priorityIndex === -1 ? 0 : (prioritySources.length - priorityIndex) * 100;
      return { item, effectiveScore: item.score + priorityBoost };
    })
    .sort((a, b) => b.effectiveScore - a.effectiveScore);

  // Pick top N slots, deduplicate by source to ensure variety
  const suggestions: TopicSuggestion[] = [];
  const usedSources = new Set<NewsSource>();
  const allCandidates = scored.map((s) => s.item);

  // First pass: one per source for diversity
  for (const item of allCandidates) {
    if (suggestions.length >= slots) break;
    if (!usedSources.has(item.source)) {
      usedSources.add(item.source);
      suggestions.push({
        slot: suggestions.length + 1,
        topic: item.title,
        keywords: extractKeywords(item.title),
        source: item.source,
        source_url: item.url,
        reason: buildReason(item),
      });
    }
  }

  // Second pass: fill remaining slots if first pass didn't reach target
  if (suggestions.length < slots) {
    for (const item of allCandidates) {
      if (suggestions.length >= slots) break;
      const alreadyAdded = suggestions.some((s) => s.source_url === item.url);
      if (!alreadyAdded) {
        suggestions.push({
          slot: suggestions.length + 1,
          topic: item.title,
          keywords: extractKeywords(item.title),
          source: item.source,
          source_url: item.url,
          reason: buildReason(item),
        });
      }
    }
  }

  return { suggestions };
}
