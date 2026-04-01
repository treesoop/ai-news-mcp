import { NewsItem } from "../types";

const LOBSTERS_URL = "https://lobste.rs/hottest.json";
const TIMEOUT_MS = 10000;

interface LobstersItem {
  title: string;
  url: string;
  score: number;
  description?: string;
  short_id_url?: string;
}

export async function scrapeLobsters(): Promise<NewsItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(LOBSTERS_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`Lobsters HTTP ${res.status}`);

  const items = (await res.json()) as LobstersItem[];
  return items.map((item) => ({
    title: item.title,
    url: item.url || item.short_id_url || "",
    source: "lobsters" as const,
    score: item.score ?? 0,
    summary: item.description
      ? item.description.replace(/<[^>]+>/g, "").slice(0, 200)
      : undefined,
  }));
}
