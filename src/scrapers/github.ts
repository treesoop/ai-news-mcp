import { NewsItem } from "../types";

const GITHUB_TRENDING_URL = "https://github.com/trending";
const TIMEOUT_MS = 10000;

function extractText(html: string, start: string, end: string): string {
  const s = html.indexOf(start);
  if (s === -1) return "";
  const from = s + start.length;
  const e = html.indexOf(end, from);
  if (e === -1) return "";
  return html.slice(from, e).trim();
}

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

export async function scrapeGitHubTrending(): Promise<NewsItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(GITHUB_TRENDING_URL, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`GitHub Trending HTTP ${res.status}`);

  const html = await res.text();
  const results: NewsItem[] = [];

  // Split on <article class="Box-row"
  const parts = html.split(/<article[^>]*class="[^"]*Box-row[^"]*"/);
  // First part is before any article, skip it
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];

    // Extract repo name from <h2> → <a href="/owner/repo">
    const hrefMatch = part.match(/href="\/([^/]+\/[^/"]+)"/);
    if (!hrefMatch) continue;
    const repoPath = hrefMatch[1];
    const repoUrl = `https://github.com/${repoPath}`;
    const repoName = repoPath.replace("/", " / ");

    // Extract description from <p> tag
    let description = "";
    const pMatch = part.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    if (pMatch) {
      description = decodeHTMLEntities(stripTags(pMatch[1]));
    }

    // Extract stars — look for "starred" text nearby or aria-label
    let stars = 0;
    const starsMatch = part.match(/([\d,]+)\s*stars/i);
    if (starsMatch) {
      stars = parseInt(starsMatch[1].replace(/,/g, ""), 10);
    } else {
      // Alternative: look for svg octicon-star context
      const starCtxMatch = part.match(/octicon-star[\s\S]{0,200}?([\d,]+)/);
      if (starCtxMatch) {
        stars = parseInt(starCtxMatch[1].replace(/,/g, ""), 10);
      }
    }

    results.push({
      title: repoName,
      url: repoUrl,
      source: "github",
      score: stars,
      summary: description || undefined,
    });
  }

  return results;
}
