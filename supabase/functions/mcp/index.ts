/**
 * ai-news-mcp — Supabase Edge Function (Deno)
 * MCP server over HTTP (StreamableHTTP transport)
 * Reads from news_cache table populated by local cron job
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TIMEOUT_MS = 10000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface NewsItem {
  title: string; url: string; source: string; score: number; summary?: string;
}

// Source reputation weights — higher = more signal for AI engineers
const SOURCE_SCORES: Record<string, number> = {
  hackernews:         300,
  show_hn:            280,  // builders sharing what they just made
  reddit_localllama:  260,  // most active AI practitioner community
  reddit_claudeai:    260,  // Claude Code / AI coding tools
  reddit_ml:          240,
  openai:             220,  // official announcements
  huggingface:        200,  // curated AI papers
  hf_spaces:          180,  // trending AI demos
  reddit_artificial:  180,
  reddit_programming: 160,
  arxiv_ai:           150,
  arxiv_ml:           150,
  infoq:              140,
  thenewstack:        130,
  devto:              120,
  lobsters:           120,
  github:             110,
  producthunt:        100,
  geeknews:            80,
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
  const source = args.source as string | undefined;
  const cache = await getLatestCache();
  if (!cache) return { error: "No cache available. Cron job may not have run yet." };
  const items = source ? cache.items.filter(i => i.source === source) : cache.items;
  const ageMinutes = Math.floor((Date.now() - new Date(cache.created_at).getTime()) / 60000);
  return { cached_at: cache.created_at, age_minutes: ageMinutes, total: items.length, items };
}

async function getCuratedItems(): Promise<NewsItem[] | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/news_curated?select=title,url,source,score,summary&order=id.asc`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data : null;
  } catch { return null; }
}

function isJunk(item: NewsItem): boolean {
  const url = item.url.toLowerCase();
  const title = item.title.toLowerCase();
  if (url.includes("i.redd.it") || url.includes("i.imgur.com") || url.includes("reddit.com/gallery/") || url.includes("gist.github.com")) return true;
  if (title.includes("self-promotion") || title.includes("who's hiring") || title.includes("[d] monthly") || title.includes("[d] weekly")) return true;
  return false;
}

async function toolGetTopPicks(args: Record<string, unknown>) {
  const n = (args.n as number) ?? 20;

  // Try curated table first (pre-curated by Claude every 6h)
  const curated = await getCuratedItems();
  if (curated && curated.length > 0) {
    return { total: Math.min(curated.length, n), cached_at: new Date().toISOString(), picks: curated.slice(0, n) };
  }

  // Fallback: source-based diversity + junk filter
  const cache = await getLatestCache();
  if (!cache) return { error: "No cache available." };

  const items = cache.items.filter(item => !isJunk(item));
  const bySource = new Map<string, NewsItem[]>();
  for (const item of items) {
    const group = bySource.get(item.source) || [];
    group.push(item);
    bySource.set(item.source, group);
  }

  const pool: NewsItem[] = [];
  for (const [, group] of bySource) {
    group.sort((a, b) => b.score - a.score);
    pool.push(...group.slice(0, 3));
  }

  return { total: Math.min(pool.length, n), cached_at: cache.created_at, picks: pool.slice(0, n) };
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
  const counts: Record<string, number> = {};
  for (const item of cache.items) counts[item.source] = (counts[item.source] ?? 0) + 1;
  return { exists: true, cached_at: cache.created_at, age_minutes: ageMinutes, total: cache.items.length, source_counts: counts };
}

// ── MCP Prompts ───────────────────────────────────────────────────────────────

const PROMPTS = [
  {
    name: "daily_briefing",
    description: "Generate a morning AI/tech news briefing from today's top stories",
    arguments: [
      { name: "focus", description: "Optional topic focus (e.g. 'LLM', 'agents', 'open source')", required: false }
    ],
  },
  {
    name: "trending_summary",
    description: "Summarize what's trending right now across all sources and explain why it matters",
    arguments: [],
  },
  {
    name: "research_topic",
    description: "Deep dive into a specific AI/tech topic using today's news, papers, and repos",
    arguments: [
      { name: "topic", description: "Topic to research (e.g. 'RAG', 'Claude Code', 'AI agents')", required: true }
    ],
  },
];

function getPromptMessages(name: string, args: Record<string, string>) {
  if (name === "daily_briefing") {
    const focus = args.focus ? ` Focus specifically on: ${args.focus}.` : "";
    return [{ role: "user", content: { type: "text", text: `Use the get_top_picks tool (n=20) to fetch today's top AI/tech news, then write a concise morning briefing. Include: top 5 stories with 1-sentence summaries, 1 standout GitHub repo or paper if present, and a 2-sentence "what to watch" outlook.${focus}` } }];
  }
  if (name === "trending_summary") {
    return [{ role: "user", content: { type: "text", text: "Use check_cache to see what sources are available, then use get_top_picks (n=30) to get today's top stories. Group them into 3-4 themes, explain why each theme is trending, and highlight the single most important story of the day." } }];
  }
  if (name === "research_topic") {
    const topic = args.topic ?? "AI";
    return [{ role: "user", content: { type: "text", text: `Use search_today with query="${topic}" to find all relevant news. Then for any ArXiv papers found, use get_paper_brief to get full abstracts. For any GitHub repos, use get_repo_quickstart. Compile a structured research summary: what's new, key papers, notable repos, and community reaction.` } }];
  }
  throw new Error(`Unknown prompt: ${name}`);
}

// ── MCP Resources ─────────────────────────────────────────────────────────────

const RESOURCES = [
  {
    uri: "news://latest/summary",
    name: "Latest News Summary",
    description: "A structured summary of the current news cache: total items, sources, cache age",
    mimeType: "application/json",
  },
  {
    uri: "news://sources",
    name: "Source Directory",
    description: "All 17 news sources with their reputation scores and what kind of content they provide",
    mimeType: "application/json",
  },
];

async function readResource(uri: string): Promise<string> {
  if (uri === "news://latest/summary") {
    const cache = await getLatestCache();
    if (!cache) return JSON.stringify({ error: "No cache available" });
    const ageMinutes = Math.floor((Date.now() - new Date(cache.created_at).getTime()) / 60000);
    const counts: Record<string, number> = {};
    for (const item of cache.items) counts[item.source] = (counts[item.source] ?? 0) + 1;
    return JSON.stringify({ cached_at: cache.created_at, age_minutes: ageMinutes, total: cache.items.length, source_counts: counts }, null, 2);
  }
  if (uri === "news://sources") {
    const sources = Object.entries(SOURCE_SCORES).map(([id, score]) => ({
      id, score,
      description: {
        hackernews: "Top HN stories — engineers and founders sharing links",
        show_hn: "Show HN posts — developers sharing what they just built",
        reddit_localllama: "r/LocalLLaMA — most active open-source LLM community",
        reddit_claudeai: "r/ClaudeAI — Claude Code, AI coding tools, Anthropic news",
        reddit_ml: "r/MachineLearning — research and ML engineering",
        reddit_artificial: "r/artificial — general AI discussion",
        reddit_programming: "r/programming — general dev community",
        openai: "OpenAI official news — model releases, Codex, agents",
        huggingface: "HuggingFace Daily Papers — curated AI/ML papers",
        hf_spaces: "HuggingFace Spaces Trending — hottest AI demos right now",
        arxiv_ai: "ArXiv cs.AI — AI research papers",
        arxiv_ml: "ArXiv cs.LG — machine learning research",
        infoq: "InfoQ AI/ML — deep technical coverage of agentic patterns",
        thenewstack: "The New Stack — AI infrastructure and cloud engineering",
        devto: "Dev.to — developer tutorials and AI articles",
        lobsters: "Lobsters — curated technical link aggregator",
        github: "GitHub Trending — most starred repos today",
        producthunt: "Product Hunt — new AI tools launching today",
        geeknews: "GeekNews — Korean tech community hot links",
      }[id] ?? "",
    }));
    return JSON.stringify(sources, null, 2);
  }
  throw new Error(`Unknown resource: ${uri}`);
}

// ── MCP Protocol ──────────────────────────────────────────────────────────────

const TOOLS = [
  { name: "get_trending_news", description: "Get all cached news items from 17 sources: HN, Show HN, Reddit (ML/LocalLLaMA/ClaudeAI/artificial/programming), ArXiv AI+ML, GitHub Trending, HuggingFace Papers+Spaces, OpenAI News, InfoQ, The New Stack, Dev.to, Lobsters, GeekNews. Cached every 6h. Optionally filter by source name.", inputSchema: { type: "object", properties: { source: { type: "string", description: "Optional: filter by source name e.g. 'reddit_localllama', 'show_hn', 'hackernews'" } }, required: [] } },
  { name: "get_top_picks", description: "Returns top N Opus-curated items for vibe coders & AI builders. Pre-curated every 6h with content summaries. Falls back to algorithmic selection if curation unavailable.", inputSchema: { type: "object", properties: { n: { type: "number", default: 20 } }, required: [] } },
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
    return { jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {}, prompts: {}, resources: {} }, serverInfo: { name: "ai-news-mcp", version: "1.1.0" } } };
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
  if (method === "prompts/list") {
    return { jsonrpc: "2.0", id, result: { prompts: PROMPTS } };
  }
  if (method === "prompts/get") {
    const name = params?.name as string;
    const args = (params?.arguments as Record<string, string>) ?? {};
    try {
      const messages = getPromptMessages(name, args);
      return { jsonrpc: "2.0", id, result: { description: PROMPTS.find(p => p.name === name)?.description ?? "", messages } };
    } catch (err) {
      return { jsonrpc: "2.0", id, error: { code: -32602, message: String(err) } };
    }
  }
  if (method === "resources/list") {
    return { jsonrpc: "2.0", id, result: { resources: RESOURCES } };
  }
  if (method === "resources/read") {
    const uri = params?.uri as string;
    try {
      const text = await readResource(uri);
      return { jsonrpc: "2.0", id, result: { contents: [{ uri, mimeType: "application/json", text }] } };
    } catch (err) {
      return { jsonrpc: "2.0", id, error: { code: -32602, message: String(err) } };
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
