import { NewsItem } from "../types";

const DEVTO_URL = "https://dev.to/api/articles?top=1&per_page=20&tag=ai";
const TIMEOUT_MS = 10000;

interface DevToArticle {
  id: number;
  title: string;
  url: string;
  positive_reactions_count: number;
  description?: string;
}

export async function scrapeDevTo(): Promise<NewsItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(DEVTO_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`Dev.to HTTP ${res.status}`);

  const articles = (await res.json()) as DevToArticle[];
  return articles.map((a) => ({
    title: a.title,
    url: a.url,
    source: "devto" as const,
    score: a.positive_reactions_count ?? 0,
    summary: a.description ?? undefined,
  }));
}
