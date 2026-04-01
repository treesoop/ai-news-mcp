/**
 * ai-news-mcp — Supabase Edge Function (Deno)
 * MCP server over HTTP (StreamableHTTP transport)
 * Reads from news_cache table populated by local cron job
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TIMEOUT_MS = 10000;

// ── Types ─────────────────────────────────────────────────────────────────────

type NewsSource = "hackernews"|"devto"|"lobsters"|"reddit_ml"|"reddit_localllama"|
  "reddit_artificial"|"reddit_programming"|"arxiv_ai"|"arxiv_ml"|"github"|"geeknews";
type Category = "AI"|"dev-tools"|"community"|"all";

interface NewsItem {
  title: string; url: string; source: NewsSource; score: number; summary?: string;
}

const SOURCE_CATEGORIES: Record<NewsSource, Category[]> = {
  hackernews: ["dev-tools","AI"], devto: ["dev-tools","AI"], lobsters: ["dev-tools"],
  reddit_ml: ["AI"], reddit_localllama: ["AI"],
  reddit_artificial: ["AI","community"], reddit_programming: ["dev-tools","community"],
  arxiv_ai: ["AI"], arxiv_ml: ["AI"], github: ["dev-tools"], geeknews: ["community","dev-tools"],
};

const SOURCE_SCORES: Record<NewsSource, number> = {
  hackernews: 300, reddit_ml: 250, reddit_localllama: 250, reddit_artificial: 200,
  reddit_programming: 180, devto: 150, lobsters: 150, github: 120,
  arxiv_ai: 100, arxiv_ml: 100, geeknews: 80,
};

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function getLatestCache(): Promise<{ items: NewsItem[]; created_at: string } | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/news_cache?order=created_at.desc&limit=1&select=data,created_at`,
    { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  if (!rows?.length) return null;
  const row = rows[0];
  return { items: row.data?.items ?? [], created_at: row.created_at };
}

async function getCacheSince(since: string): Promise<NewsItem[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/news_cache?created_at=gt.${encodeURIComponent(since)}&select=data,created_at&order=created_at.asc`,
    { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  if (!res.ok) return [];
  const rows = await res.json();
  const seen = new Set<string>();
  const items: NewsItem[] = [];
  for (const row of rows) {
    for (const item of (row.data?.items ?? [])) {
      if (!seen.has(item.url)) { seen.add(item.url); items.push(item); }
    }
  }
  return items.reverse();
}

// ── Tool implementations ──────────────────────────────────────────────────────

async function toolGetTrendingNews(args: Record<string, unknown>) {
  const category = (args.category as Category) ?? "all";
  const cache = await getLatestCache();
  if (!cache) return { error: "No cache available. Cron job may not have run yet." };
  const items = category === "all" ? cache.items
    : cache.items.filter(i => SOURCE_CATEGORIES[i.source]?.includes(category));
  const ageMinutes = Math.floor((Date.now() - new Date(cache.created_at).getTime()) / 60000);
  return { cached_at: cache.created_at, age_minutes: ageMinutes, total: items.length, items };
}

async function toolGetTopPicks(args: Record<string, unknown>) {
  const n = (args.n as number) ?? 10;
  const category = (args.category as Category) ?? "all";
  const cache = await getLatestCache();
  if (!cache) return { error: "No cache available." };

  const items = category === "all" ? cache.items
    : cache.items.filter(i => SOURCE_CATEGORIES[i.source]?.includes(category));

  const scored = items
    .map(item => ({ item, score: item.score + (SOURCE_SCORES[item.source] ?? 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);

  const picks = scored.map(({ item }) => ({
    ...item,
    why: `${item.score > 0 ? `${item.score} points on` : "Featured on"} ${item.source.replace("_", " ")}${item.summary ? ` — ${item.summary.slice(0, 80)}` : ""}`,
    try_url: item.source === "github" ? item.url : undefined,
  }));

  return { total: picks.length, picks };
}

async function toolSearchToday(args: Record<string, unknown>) {
  const query = (args.query as string) ?? "";
  const limit = (args.limit as number) ?? 20;
  const cache = await getLatestCache();
  if (!cache) return { error: "No cache available." };

  const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  const scored = cache.items
    .map(item => {
      const text = `${item.title} ${item.summary ?? ""}`.toLowerCase();
      const matches = words.filter(w => text.includes(w)).length;
      return { item, matches };
    })
    .filter(({ matches }) => matches > 0)
    .sort((a, b) => (b.matches * b.item.score) - (a.matches * a.item.score))
    .slice(0, limit);

  return { query, total_found: scored.length, items: scored.map(s => s.item) };
}

async function toolGetNewSince(args: Record<string, unknown>) {
  const since = args.since as string;
  if (!since) return { error: "Missing required argument: since" };
  const items = await getCacheSince(since);
  return { since, total: items.length, items };
}

async function toolGetRepoQuickstart(args: Record<string, unknown>) {
  const url = args.url as string;
  if (!url) return { error: "Missing required argument: url" };

  const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) return { error: "Not a valid GitHub URL" };
  const repo = match[1].replace(/\.git$/, "");

  const [metaRes, readmeRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${repo}`, { headers: { "User-Agent": "ai-news-mcp" } }),
    fetch(`https://raw.githubusercontent.com/${repo}/main/README.md`)
      .then(r => r.ok ? r : fetch(`https://raw.githubusercontent.com/${repo}/master/README.md`)),
  ]);

  // deno-lint-ignore no-explicit-any
  const meta: any = metaRes.ok ? await metaRes.json() : {};
  const readme = readmeRes.ok ? await readmeRes.text() : "";

  const installPatterns = /^.*?(pip install|npm install|npx|cargo add|go get|brew install|docker pull|curl .* \| sh|wget .* \| sh).+$/gim;
  const install = [...readme.matchAll(installPatterns)].map(m => m[0].trim()).slice(0, 5);

  const quickstartMatch = readme.match(/#{1,3}\s*(quick\s*start|getting\s*started|usage|install)[^\n]*\n([\s\S]*?)(?=\n#{1,3}|\z)/i);
  const codeBlock = quickstartMatch?.[2].match(/```[\s\S]*?```/)?.[0] ?? "";

  return {
    repo, description: meta.description ?? "", stars: meta.stargazers_count ?? 0,
    language: meta.language ?? "", topics: meta.topics ?? [],
    install, quickstart: codeBlock.slice(0, 800),
    readme_url: `https://github.com/${repo}#readme`,
  };
}

async function toolGetPaperBrief(args: Record<string, unknown>) {
  const url = args.url as string;
  if (!url) return { error: "Missing required argument: url" };

  const idMatch = url.match(/arxiv\.org\/(?:abs|pdf)\/([0-9.]+)/);
  if (!idMatch) return { error: "Not a valid ArXiv URL" };
  const id = idMatch[1];

  const res = await fetch(`https://arxiv.org/abs/${id}`, { headers: { "User-Agent": "ai-news-mcp" } });
  if (!res.ok) return { error: `ArXiv fetch failed: ${res.status}` };
  const html = await res.text();

  const title = html.match(/<h1[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h1>/)?.[1]
    ?.replace(/<[^>]+>/g, "").replace(/^Title:\s*/i, "").trim() ?? "";
  const abstract = html.match(/<blockquote[^>]*class="[^"]*abstract[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/)?.[1]
    ?.replace(/<[^>]+>/g, "").replace(/^Abstract:\s*/i, "").trim() ?? "";
  const authors = [...html.matchAll(/<a href="\/search[^"]*">([\s\S]*?)<\/a>/g)]
    .map(m => m[1].trim()).slice(0, 5);

  // Try Papers With Code for code link
  let codeUrl: string | undefined;
  try {
    const pwcRes = await fetch(`https://paperswithcode.com/paper/${id}`);
    if (pwcRes.ok) {
      const pwcHtml = await pwcRes.text();
      const ghMatch = pwcHtml.match(/href="(https:\/\/github\.com\/[^"]+)"/);
      if (ghMatch) codeUrl = ghMatch[1];
    }
  } catch { /* skip */ }

  return { arxiv_id: id, title, authors, abstract: abstract.slice(0, 500), code_url: codeUrl, arxiv_url: url };
}

async function toolCheckCache() {
  const cache = await getLatestCache();
  if (!cache) return { exists: false, cached_at: null, age_minutes: null };
  const ageMinutes = Math.floor((Date.now() - new Date(cache.created_at).getTime()) / 60000);
  const counts: Partial<Record<NewsSource, number>> = {};
  for (const item of cache.items) counts[item.source] = (counts[item.source] ?? 0) + 1;
  return { exists: true, cached_at: cache.created_at, age_minutes: ageMinutes, total: cache.items.length, source_counts: counts };
}

// ── MCP Protocol ──────────────────────────────────────────────────────────────

const TOOLS = [
  { name: "get_trending_news", description: "Get latest AI/tech news from 11 sources (HN, Reddit ML/LocalLLaMA/artificial/programming, ArXiv AI+ML, GitHub Trending, Dev.to, Lobsters). Cached every 30min.", inputSchema: { type: "object", properties: { category: { type: "string", enum: ["AI","dev-tools","community","all"], default: "all" } }, required: [] } },
  { name: "get_top_picks", description: "Top N most relevant items for AI engineers, scored by source reputation + item score. Each item includes a 'why it matters' one-liner.", inputSchema: { type: "object", properties: { n: { type: "number", default: 10 }, category: { type: "string", enum: ["AI","dev-tools","community","all"], default: "all" } }, required: [] } },
  { name: "search_today", description: "Search today's cached news by keyword. Matches title + summary.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number", default: 20 } }, required: ["query"] } },
  { name: "get_new_since", description: "Get news items added since an ISO timestamp (e.g. last 30 minutes).", inputSchema: { type: "object", properties: { since: { type: "string", description: "ISO 8601 timestamp" } }, required: ["since"] } },
  { name: "get_repo_quickstart", description: "Get GitHub repo metadata (stars, description, language) + install commands + quickstart snippet from README.", inputSchema: { type: "object", properties: { url: { type: "string", description: "GitHub URL" } }, required: ["url"] } },
  { name: "get_paper_brief", description: "Get ArXiv paper title, authors, abstract summary, and code repository link if available.", inputSchema: { type: "object", properties: { url: { type: "string", description: "ArXiv URL" } }, required: ["url"] } },
  { name: "check_cache", description: "Check cache status: age, total items, per-source counts.", inputSchema: { type: "object", properties: {}, required: [] } },
];

async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "get_trending_news": return toolGetTrendingNews(args);
    case "get_top_picks": return toolGetTopPicks(args);
    case "search_today": return toolSearchToday(args);
    case "get_new_since": return toolGetNewSince(args);
    case "get_repo_quickstart": return toolGetRepoQuickstart(args);
    case "get_paper_brief": return toolGetPaperBrief(args);
    case "check_cache": return toolCheckCache();
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Request handler ───────────────────────────────────────────────────────────

async function handleMcpRequest(body: Record<string, unknown>): Promise<unknown> {
  const { method, id, params } = body as { method: string; id: unknown; params?: Record<string, unknown> };

  if (method === "initialize") {
    return { jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "ai-news-mcp", version: "1.0.0" } } };
  }
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  }
  if (method === "tools/call") {
    const name = (params?.name as string);
    const args = (params?.arguments as Record<string, unknown>) ?? {};
    try {
      const result = await callTool(name, args);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } };
    } catch (err) {
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ error: String(err) }) }], isError: true } };
    }
  }
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

// ── Entry point ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type, mcp-session-id",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  };

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = new URL(req.url);

  // Health check
  if (url.pathname === "/health" || url.pathname === "/") {
    return new Response(JSON.stringify({ status: "ok", server: "ai-news-mcp", version: "1.0.0" }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // MCP endpoint
  if (req.method === "POST") {
    try {
      const body = await req.json();
      const isArray = Array.isArray(body);
      const requests = isArray ? body : [body];
      const responses = await Promise.all(requests.map(r => handleMcpRequest(r)));
      const result = isArray ? responses : responses[0];
      return new Response(JSON.stringify(result), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: `Parse error: ${err}` } }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405, headers: { ...cors, "Content-Type": "application/json" },
  });
});
