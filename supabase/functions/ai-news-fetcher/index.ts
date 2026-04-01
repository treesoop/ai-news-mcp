import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CACHE_TTL_MINUTES = 60;
const TIMEOUT_MS = 10000;
const USER_AGENT = "ai-news-mcp/1.0 by potenlab";

type NewsSource =
  | "hackernews" | "devto" | "lobsters"
  | "reddit_ml" | "reddit_localllama" | "reddit_artificial" | "reddit_programming"
  | "arxiv_ai" | "arxiv_ml" | "github" | "geeknews";

type Category = "AI" | "dev-tools" | "community" | "all";

interface NewsItem {
  title: string;
  url: string;
  source: NewsSource;
  score: number;
  summary?: string;
}

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

// ── helpers ──────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── scrapers ─────────────────────────────────────────────────────────────────

async function scrapeHackerNews(): Promise<NewsItem[]> {
  const res = await fetchWithTimeout("https://hacker-news.firebaseio.com/v0/topstories.json");
  if (!res.ok) throw new Error(`HN ${res.status}`);
  const ids: number[] = await res.json();
  const top20 = ids.slice(0, 20);

  const items = await Promise.all(
    top20.map(async (id) => {
      try {
        const r = await fetchWithTimeout(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        if (!r.ok) return null;
        // deno-lint-ignore no-explicit-any
        const item: any = await r.json();
        if (!item?.title || item.type !== "story") return null;
        return {
          title: item.title,
          url: item.url ?? `https://news.ycombinator.com/item?id=${id}`,
          source: "hackernews" as NewsSource,
          score: item.score ?? 0,
          summary: item.text ? String(item.text).replace(/<[^>]+>/g, "").slice(0, 200) : undefined,
        };
      } catch { return null; }
    })
  );
  return items.filter(Boolean) as NewsItem[];
}

async function scrapeDevTo(): Promise<NewsItem[]> {
  const res = await fetchWithTimeout(
    "https://dev.to/api/articles?top=1&per_page=20&tag=ai",
    { headers: { "User-Agent": USER_AGENT } }
  );
  if (!res.ok) throw new Error(`DevTo ${res.status}`);
  // deno-lint-ignore no-explicit-any
  const articles: any[] = await res.json();
  return articles.map((a) => ({
    title: a.title,
    url: a.url,
    source: "devto" as NewsSource,
    score: (a.positive_reactions_count ?? 0) + (a.comments_count ?? 0),
    summary: a.description ?? undefined,
  }));
}

async function scrapeLobsters(): Promise<NewsItem[]> {
  const res = await fetchWithTimeout("https://lobste.rs/hottest.json");
  if (!res.ok) throw new Error(`Lobsters ${res.status}`);
  // deno-lint-ignore no-explicit-any
  const posts: any[] = await res.json();
  return posts.slice(0, 25).map((p) => ({
    title: p.title,
    url: p.url || `https://lobste.rs${p.short_id_url}`,
    source: "lobsters" as NewsSource,
    score: p.score ?? 0,
    summary: p.description ?? undefined,
  }));
}

async function scrapeReddit(subreddit: string, limit: number, source: NewsSource): Promise<NewsItem[]> {
  const res = await fetchWithTimeout(
    `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`,
    { headers: { "User-Agent": USER_AGENT, "Accept": "application/json" } }
  );
  if (!res.ok) throw new Error(`Reddit r/${subreddit} ${res.status}`);
  // deno-lint-ignore no-explicit-any
  const json: any = await res.json();
  // deno-lint-ignore no-explicit-any
  return json.data.children.map((child: any) => {
    const d = child.data;
    return {
      title: d.title,
      url: d.is_self ? `https://www.reddit.com${d.permalink}` : d.url,
      source,
      score: d.score ?? 0,
      summary: d.selftext ? String(d.selftext).slice(0, 200) : undefined,
    };
  });
}

async function scrapeArxiv(feedUrl: string, source: NewsSource): Promise<NewsItem[]> {
  const res = await fetchWithTimeout(feedUrl, {
    headers: { "Accept": "application/rss+xml, text/xml" }
  });
  if (!res.ok) throw new Error(`ArXiv ${source} ${res.status}`);
  const xml = await res.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    isArray: (name: string) => name === "item",
  });
  // deno-lint-ignore no-explicit-any
  const parsed: any = parser.parse(xml);
  // deno-lint-ignore no-explicit-any
  let rawItems: any[] = [];
  if (parsed?.rss?.channel?.item) rawItems = parsed.rss.channel.item;
  else if (parsed?.["rdf:RDF"]?.item) rawItems = parsed["rdf:RDF"].item;

  if (!Array.isArray(rawItems)) rawItems = [rawItems].filter(Boolean);

  // deno-lint-ignore no-explicit-any
  return rawItems.map((item: any) => {
    const title = typeof item.title === "string" ? item.title : item.title?.["#text"] ?? "";
    let url = "";
    if (typeof item.link === "string") url = item.link;
    else if (Array.isArray(item.link)) url = item.link[0]?.["@_href"] ?? item.link[0]?.["#text"] ?? "";
    else if (item.link) url = item.link["@_href"] ?? item.link["#text"] ?? "";
    const desc = typeof item.description === "string"
      ? item.description
      : item.description?.["#text"] ?? "";
    return {
      title: title.trim(),
      url: url.trim(),
      source,
      score: 0,
      summary: desc.replace(/<[^>]+>/g, "").trim().slice(0, 300) || undefined,
    };
  }).filter((i: NewsItem) => i.url && i.title);
}

async function scrapeGitHub(): Promise<NewsItem[]> {
  const res = await fetchWithTimeout("https://github.com/trending", {
    headers: { "User-Agent": USER_AGENT, "Accept": "text/html" }
  });
  if (!res.ok) throw new Error(`GitHub trending ${res.status}`);
  const html = await res.text();

  const items: NewsItem[] = [];
  const articleBlocks = html.split('<article class="Box-row">').slice(1);
  for (const block of articleBlocks.slice(0, 20)) {
    const repoMatch = block.match(/href="\/([^"]+)"\s*>/);
    const descMatch = block.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const starsMatch = block.match(/aria-label="(\d[\d,]*) stars"/);
    if (!repoMatch) continue;
    const repo = repoMatch[1].trim();
    const desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, "").trim() : "";
    const stars = starsMatch ? parseInt(starsMatch[1].replace(/,/g, ""), 10) : 0;
    items.push({
      title: repo,
      url: `https://github.com/${repo}`,
      source: "github",
      score: stars,
      summary: desc || undefined,
    });
  }
  return items;
}

async function scrapeGeekNews(): Promise<NewsItem[]> {
  const res = await fetchWithTimeout("https://news.hada.io", {
    headers: { "User-Agent": USER_AGENT, "Accept": "text/html" }
  });
  if (!res.ok) throw new Error(`GeekNews ${res.status}`);
  const html = await res.text();
  const items: NewsItem[] = [];

  const liBlocks = html.split('<li class="item').slice(1);
  for (const block of liBlocks.slice(0, 30)) {
    const titleMatch = block.match(/class="[^"]*title[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const pointsMatch = block.match(/(\d+)\s*point/);
    if (!titleMatch) continue;
    const url = titleMatch[1];
    const title = titleMatch[2].replace(/<[^>]+>/g, "").trim();
    items.push({
      title,
      url: url.startsWith("http") ? url : `https://news.hada.io${url}`,
      source: "geeknews",
      score: pointsMatch ? parseInt(pointsMatch[1], 10) : 0,
    });
  }
  return items;
}

// ── main fetch ────────────────────────────────────────────────────────────────

async function fetchAllSources(): Promise<NewsItem[]> {
  const tasks: Array<() => Promise<NewsItem[]>> = [
    scrapeHackerNews,
    scrapeDevTo,
    scrapeLobsters,
    () => scrapeReddit("MachineLearning", 15, "reddit_ml"),
    () => scrapeReddit("LocalLLaMA", 15, "reddit_localllama"),
    () => scrapeReddit("artificial", 10, "reddit_artificial"),
    () => scrapeReddit("programming", 10, "reddit_programming"),
    () => scrapeArxiv("https://rss.arxiv.org/rss/cs.AI", "arxiv_ai"),
    () => scrapeArxiv("https://rss.arxiv.org/rss/cs.LG", "arxiv_ml"),
    scrapeGitHub,
    scrapeGeekNews,
  ];

  const results = await Promise.allSettled(tasks.map((fn) => fn()));
  const all: NewsItem[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value);
    else console.warn("[scraper] failed:", r.reason?.message ?? r.reason);
  }
  return all;
}

// ── cache (Supabase DB) ───────────────────────────────────────────────────────

function getCacheKey(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}_${hh}`;
}

async function getCache(supabase: ReturnType<typeof createClient>) {
  const key = getCacheKey();
  const { data } = await supabase
    .from("news_cache")
    .select("data, created_at")
    .eq("cache_key", key)
    .single();
  return data ?? null;
}

async function setCache(supabase: ReturnType<typeof createClient>, items: NewsItem[]) {
  const key = getCacheKey();
  const sourceCounts: Partial<Record<NewsSource, number>> = {};
  for (const item of items) {
    sourceCounts[item.source] = (sourceCounts[item.source] ?? 0) + 1;
  }
  await supabase.from("news_cache").upsert({
    cache_key: key,
    data: { items, source_counts: sourceCounts },
    created_at: new Date().toISOString(),
  });
  return { items, source_counts: sourceCounts };
}

// ── handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const category = (url.searchParams.get("category") ?? "all") as Category;
    const refresh = url.searchParams.get("refresh") === "true";

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let cached = refresh ? null : await getCache(supabase);
    let fromCache = !!cached;

    if (!cached) {
      const items = await fetchAllSources();
      cached = await setCache(supabase, items);
      fromCache = false;
    }

    const { items, source_counts } = cached.data
      ? { items: cached.data.items as NewsItem[], source_counts: cached.data.source_counts }
      : { items: cached.items as NewsItem[], source_counts: cached.source_counts };

    const filtered = category === "all"
      ? items
      : items.filter((item: NewsItem) => SOURCE_CATEGORIES[item.source]?.includes(category));

    const cachedAt = cached.created_at ?? new Date().toISOString();
    const ageMs = Date.now() - new Date(cachedAt).getTime();
    const ageMinutes = Math.floor(ageMs / 60000);

    return new Response(
      JSON.stringify({
        cached_at: cachedAt,
        age_minutes: ageMinutes,
        from_cache: fromCache,
        total: filtered.length,
        source_counts,
        items: filtered,
      }),
      { headers: corsHeaders }
    );
  } catch (err) {
    console.error("[ai-news-fetcher] error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: corsHeaders }
    );
  }
});
