import { NewsItem } from "../types";

const GEEKNEWS_URL = "https://news.hada.io";
const TIMEOUT_MS = 10000;

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export async function scrapeGeekNews(): Promise<NewsItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(GEEKNEWS_URL, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`GeekNews HTTP ${res.status}`);

  const html = await res.text();
  const results: NewsItem[] = [];

  // GeekNews uses <li class="item"> structure
  // Try multiple patterns for resilience
  const itemPattern = /<li[^>]*class="[^"]*item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemPattern.exec(html)) !== null) {
    const itemHtml = match[1];

    // Extract title and URL from <a class="title-link"> or similar anchor
    const linkMatch = itemHtml.match(
      /<a[^>]*href="([^"]+)"[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/a>/i
    ) || itemHtml.match(
      /<a[^>]*class="[^"]*title[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
    );

    if (!linkMatch) continue;

    let url = linkMatch[1].trim();
    const titleRaw = decodeHTMLEntities(stripTags(linkMatch[2]));

    if (!titleRaw) continue;

    // Make relative URLs absolute
    if (url.startsWith("/")) {
      url = `${GEEKNEWS_URL}${url}`;
    }

    // Extract points/score
    let score = 0;
    const pointsMatch = itemHtml.match(/(\d+)\s*(?:points?|포인트|pt)/i);
    if (pointsMatch) {
      score = parseInt(pointsMatch[1], 10);
    }

    results.push({
      title: titleRaw,
      url,
      source: "geeknews",
      score,
    });
  }

  // Fallback: if the li.item pattern yields nothing, try a simpler anchor scan
  if (results.length === 0) {
    const anchorPattern =
      /<a[^>]*href="([^"#][^"]*)"[^>]*class="[^"]*storylink[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = anchorPattern.exec(html)) !== null) {
      let url = match[1].trim();
      const title = decodeHTMLEntities(stripTags(match[2]));
      if (!title) continue;
      if (url.startsWith("/")) url = `${GEEKNEWS_URL}${url}`;
      results.push({ title, url, source: "geeknews", score: 0 });
    }
  }

  return results;
}
