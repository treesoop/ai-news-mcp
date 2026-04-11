import { NewsItem } from "../types";

const ANTHROPIC_NEWS_URL = "https://www.anthropic.com/news";
const TIMEOUT_MS = 10000;

export async function scrapeAnthropicNews(): Promise<NewsItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_NEWS_URL, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`Anthropic news HTTP ${res.status}`);

  const html = await res.text();
  const results: NewsItem[] = [];
  const seen = new Set<string>();

  // Each article is wrapped in <a href="/news/SLUG">...</a>
  // Featured articles: <h4 class="...title">TITLE</h4> inside the anchor
  // List articles:     <span class="...title">TITLE</span> inside the anchor
  const anchorPattern = /<a\s[^>]*href="(\/news\/[a-z0-9][a-z0-9A-Z_-]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = anchorPattern.exec(html)) !== null) {
    const url = `https://www.anthropic.com${m[1]}`;
    if (seen.has(url)) continue;
    seen.add(url);

    const block = m[2];

    // h1-h6 with class containing "title" (featured section)
    let titleMatch = block.match(/<h[1-6][^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h[1-6]>/i);
    // span with class containing "title" (list section)
    if (!titleMatch) {
      titleMatch = block.match(/<span[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    }
    if (!titleMatch) continue;

    const title = titleMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!title || title.length < 4) continue;

    const summaryMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const summary = summaryMatch
      ? summaryMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 200)
      : undefined;

    results.push({ title, url, source: "anthropic", score: 0, summary });
  }

  return results.slice(0, 15);
}
