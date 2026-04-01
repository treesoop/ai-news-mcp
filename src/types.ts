export type NewsSource =
  | "hackernews"
  | "devto"
  | "lobsters"
  | "reddit_ml"
  | "reddit_localllama"
  | "reddit_artificial"
  | "reddit_programming"
  | "arxiv_ai"
  | "arxiv_ml"
  | "github"
  | "geeknews";

export type Category = "AI" | "dev-tools" | "community" | "all";

export type Project = "potenlab" | "treesoop" | "hanguljobs";

export interface NewsItem {
  title: string;
  url: string;
  source: NewsSource;
  score: number;
  summary?: string;
}

export interface CacheData {
  cached_at: string;
  items: NewsItem[];
  source_counts: Record<NewsSource, number>;
}

export interface TrendingNewsResult {
  cached_at: string;
  age_minutes: number;
  total: number;
  items: NewsItem[];
}

export interface TopicSuggestion {
  slot: number;
  topic: string;
  keywords: string[];
  source: NewsSource;
  source_url: string;
  reason: string;
}

export interface TopicSuggestionsResult {
  suggestions: TopicSuggestion[];
}

export interface CacheCheckResult {
  exists: boolean;
  cached_at: string;
  age_minutes: number;
  source_counts: Partial<Record<NewsSource, number>>;
}
