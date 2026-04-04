# ai-news-mcp

[![MCP Badge](https://lobehub.com/badge/mcp-full/treesoop-ai-news-mcp?theme=light)](https://lobehub.com/mcp/treesoop-ai-news-mcp)

> Keeping up with AI trends is exhausting.
>
> Claude doesn't know what happened after its training cutoff. Ask it "what's hot in AI right now?" and you get stale answers. Tell it to scrape the web for you and you wait forever.
>
> **We scrape 12 sources every 6 hours, Sonnet summarizes the content, then Opus curates the top 30 items for vibe coders and AI builders. Connect via MCP and Claude pulls fresh, curated data instantly.**

Real-time AI/tech news aggregator MCP server for **vibe coders & AI builders** — runs on Supabase Edge Functions, **free, no auth required**.

Sources: HackerNews · Reddit (ClaudeAI/vibecoding/codex/claudecode/openclaw/artificial/ArtificialInteligence) · GitHub Trending · HuggingFace Spaces Trending · Lobsters · GeekNews

Cache updated every 6 hours. Curated by Opus every 6 hours.

---

## Quick Start — no install, no login

### Claude Code CLI (one command)

```bash
claude mcp add --transport http ai-news https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/mcp
```

Run this once. The tools are available in every Claude Code session from that point on.

### Manual config — Claude Code (`~/.claude.json`)

```json
{
  "mcpServers": {
    "ai-news": {
      "type": "http",
      "url": "https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/mcp"
    }
  }
}
```

### Manual config — Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "ai-news": {
      "type": "http",
      "url": "https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/mcp"
    }
  }
}
```

### Any MCP client (HTTP transport)

```
https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/mcp
```

---

## What problem does this solve?

| Problem | ai-news-mcp |
|---|---|
| Claude has no knowledge of recent AI news | 12 sources scraped every 6h, always current |
| Asking Claude to scrape is slow | Pre-cached in DB, MCP call returns instantly |
| Raw news feeds are noisy | Opus curates top 30 every 6h — only actionable items for builders |
| Hard to know what the AI community is buzzing about | r/ClaudeAI, r/vibecoding, r/codex, GeekNews — real-time community signal |
| Reading repos and pages takes time | Sonnet WebFetches each URL and writes a 1-line summary |

---

## How it works

```
Every 6 hours:
  1. Sonnet scrapes 12 sources → ~150 items
  2. Sonnet picks top 10 per source → WebFetches each URL → writes 1-line summary
  3. Opus curates top 30 from ~100 summarized items (judges by content, not score)
  4. Saves to news_curated table

When you call get_top_picks:
  → Returns Opus-curated items with summaries
  → Falls back to algorithmic selection if curation unavailable
```

---

## Tools

| Tool | Description |
|---|---|
| `get_top_picks` | **Top N Opus-curated items** with content summaries. Pre-curated every 6h for vibe coders & AI builders. |
| `get_trending_news` | All cached news from 12 sources. Filter by `source` name (e.g. `reddit_claudeai`, `reddit_vibecoding`) |
| `search_today` | Keyword search across today's cached titles and summaries |
| `get_new_since` | Items added after a given ISO timestamp — useful for "what's new in the last hour?" |
| `get_repo_quickstart` | GitHub repo metadata (stars, language, topics) + install commands + quickstart from README |
| `get_paper_brief` | ArXiv paper title, authors, abstract, and code repo link if available |
| `check_cache` | Cache status: last updated, total items, per-source breakdown |

### Example calls

```bash
# Top 10 curated items right now
curl -s -X POST "https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_top_picks","arguments":{"n":10}}}'

# Search for agent-related news
curl -s -X POST "https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_today","arguments":{"query":"agent"}}}'

# r/vibecoding only
curl -s -X POST "https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_trending_news","arguments":{"source":"reddit_vibecoding"}}}'
```

---

## Data Sources & Transparency

We only collect publicly available content — no auth, no private data, no personal information.

| Source | URL | Method | Data collected |
|---|---|---|---|
| HackerNews | `https://hacker-news.firebaseio.com/v0/topstories.json` | Public JSON API | Title, URL, score |
| r/ClaudeAI | `https://www.reddit.com/r/ClaudeAI/hot.json` | Public Reddit API | Title, URL, score, selftext summary |
| r/vibecoding | `https://www.reddit.com/r/vibecoding/hot.json` | Public Reddit API | Title, URL, score, selftext summary |
| r/codex | `https://www.reddit.com/r/codex/hot.json` | Public Reddit API | Title, URL, score, selftext summary |
| r/claudecode | `https://www.reddit.com/r/claudecode/hot.json` | Public Reddit API | Title, URL, score, selftext summary |
| r/openclaw | `https://www.reddit.com/r/openclaw/hot.json` | Public Reddit API | Title, URL, score, selftext summary |
| r/artificial | `https://www.reddit.com/r/artificial/hot.json` | Public Reddit API | Title, URL, score, selftext summary |
| r/ArtificialInteligence | `https://www.reddit.com/r/ArtificialInteligence/hot.json` | Public Reddit API | Title, URL, score, selftext summary |
| GitHub Trending | `https://github.com/trending` | HTML scrape | Repo name, description, stars |
| HuggingFace Spaces Trending | `https://huggingface.co/api/spaces?sort=trendingScore` | Public JSON API | Space ID, trending score |
| Lobsters | `https://lobste.rs/hottest.json` | Public JSON API | Title, URL, score |
| GeekNews | `https://news.hada.io` | HTML scrape | Title, URL, score |

### What we store

- Cached snapshots of the above public data, refreshed every 6 hours
- Opus-curated top 30 items with content summaries in `news_curated` table
- Stored in Supabase, auto-deleted after 48 hours
- No user data, no personal information, no private content

### What we don't do

- No paywalled or login-required content
- No full article bodies — title, URL, score, and summary only
- No selling or sharing of data

---

## Self-hosting

```bash
git clone https://github.com/treesoop/ai-news-mcp
cd ai-news-mcp
```

Deploy the Edge Function in `supabase/functions/mcp/` to your own Supabase project. Use `news_fetcher_prompt.md` + `news_curate_prompt.md` as Claude Code cron jobs to populate the cache.
