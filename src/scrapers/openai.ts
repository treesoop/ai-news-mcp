import { NewsItem } from "../types";

// openai.com blocks HTML scraping with Cloudflare — use RSS feed instead
const OPENAI_RSS_URL = "https://openai.com/blog/rss.xml";
const TIMEOUT_MS = 12000;

const SKIP_CATEGORIES = new Set([
  "OpenAI Academy", "B2B Story", "Brand Story", "Guides", "Webinar", "Startup",
]);

export async function scrapeOpenAINews(): Promise<NewsItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(OPENAI_RSS_URL, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/rss+xml, text/xml",
      },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`OpenAI RSS HTTP ${res.status}`);

  const xml = await res.text();
  const results: NewsItem[] = [];

  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];

  for (const [, block] of itemBlocks) {
    const titleMatch =
      block.match(/<title><!\[CDATA\[(.*?)\]\]>/) ||
      block.match(/<title>(.*?)<\/title>/);
    const linkMatch = block.match(/<link>(.*?)<\/link>/);
    const descMatch = block.match(/<description><!\[CDATA\[(.*?)\]\]>/);
    const catMatch = block.match(/<category><!\[CDATA\[(.*?)\]\]>/);

    if (!titleMatch || !linkMatch) continue;

    const category = catMatch?.[1] ?? "";
    if (SKIP_CATEGORIES.has(category)) continue;

    const title = titleMatch[1].trim();
    const url = linkMatch[1].trim();
    const summary = descMatch
      ? descMatch[1].replace(/<[^>]+>/g, "").trim().slice(0, 200)
      : undefined;

    results.push({ title, url, source: "openai", score: 0, summary });
    if (results.length >= 15) break;
  }

  return results;
}
