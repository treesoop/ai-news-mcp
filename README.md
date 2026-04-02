# ai-news-mcp

[![MCP Badge](https://lobehub.com/badge/mcp-full/treesoop-ai-news-mcp?theme=light)](https://lobehub.com/mcp/treesoop-ai-news-mcp)

> Keeping up with AI trends is exhausting.
>
> Claude doesn't know what happened after its training cutoff. Ask it "what's hot in AI right now?" and you get stale answers. Tell it to scrape the web for you and you wait forever.
>
> **We scrape 17 sources every 6 hours and store everything in a database. Connect via MCP and Claude pulls fresh data instantly.**

Real-time AI/tech news aggregator MCP server — runs on Supabase Edge Functions, **free, no auth required**.

Sources: HackerNews · **Show HN** · Reddit (ML/LocalLLaMA/ClaudeAI/artificial/programming) · ArXiv (cs.AI + cs.LG) · GitHub Trending · **HuggingFace Spaces Trending** · HuggingFace Daily Papers · Dev.to · Lobsters · GeekNews · Product Hunt · OpenAI News · InfoQ AI · The New Stack AI

Cache updated every 6 hours.

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
| Claude has no knowledge of recent AI news | 17 sources scraped every 6h, always current |
| Asking Claude to scrape is slow | Pre-cached in DB, MCP call returns instantly |
| Hard to know which community is blowing up right now | Show HN, r/LocalLLaMA, HF Spaces — real-time community signal included |
| Reading papers and repos takes time | ArXiv abstracts and GitHub README quickstarts on demand |

---

## Tools

| Tool | Description |
|---|---|
| `get_trending_news` | All cached news from 17 sources. Filter by `source` name (e.g. `show_hn`, `reddit_localllama`) |
| `get_top_picks` | Top N items ranked by source reputation + community score. The calling agent decides what's relevant |
| `search_today` | Keyword search across today's cached titles and summaries |
| `get_new_since` | Items added after a given ISO timestamp — useful for "what's new in the last hour?" |
| `get_repo_quickstart` | GitHub repo metadata (stars, language, topics) + install commands + quickstart from README |
| `get_paper_brief` | ArXiv paper title, authors, abstract, and code repo link if available |
| `check_cache` | Cache status: last updated, total items, per-source breakdown |

### Example calls

```bash
# Top 5 items right now
curl -s -X POST "https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_top_picks","arguments":{"n":5}}}'

# Search for agent-related news
curl -s -X POST "https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_today","arguments":{"query":"agent"}}}'

# Show HN only — what devs just shipped
curl -s -X POST "https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_trending_news","arguments":{"source":"show_hn"}}}'
```

---

## Data Sources & Transparency

We only collect publicly available content — no auth, no private data, no personal information.

| Source | URL | Method | Data collected |
|---|---|---|---|
| HackerNews | `https://hacker-news.firebaseio.com/v0/topstories.json` | Public JSON API | Title, URL, score |
| Show HN (24h) | `https://hn.algolia.com/api/v1/search?tags=show_hn` | Algolia API | Title, URL, score — what devs just built |
| r/MachineLearning | `https://www.reddit.com/r/MachineLearning/hot.json` | Public Reddit API | Title, URL, score (no user data) |
| r/LocalLLaMA | `https://www.reddit.com/r/LocalLLaMA/hot.json` | Public Reddit API | Title, URL, score |
| r/ClaudeAI | `https://www.reddit.com/r/ClaudeAI/hot.json` | Public Reddit API | Title, URL, score |
| r/artificial | `https://www.reddit.com/r/artificial/hot.json` | Public Reddit API | Title, URL, score |
| r/programming | `https://www.reddit.com/r/programming/hot.json` | Public Reddit API | Title, URL, score |
| ArXiv cs.AI | `https://rss.arxiv.org/rss/cs.AI` | Public RSS | Title, abstract, authors, URL |
| ArXiv cs.LG | `https://rss.arxiv.org/rss/cs.LG` | Public RSS | Title, abstract, authors, URL |
| GitHub Trending | `https://github.com/trending` | HTML scrape | Repo name, description, stars |
| HuggingFace Daily Papers | `https://huggingface.co/api/daily_papers` | Public JSON API | Title, URL, upvotes |
| HuggingFace Spaces Trending | `https://huggingface.co/api/spaces?sort=trendingScore` | Public JSON API | Space ID, trending score |
| Dev.to | `https://dev.to/api/articles?tag=ai` | Public JSON API | Title, URL, reactions |
| Lobsters | `https://lobste.rs/hottest.json` | Public JSON API | Title, URL, score |
| GeekNews | `https://news.hada.io` | HTML scrape | Title, URL, score |
| OpenAI News | `https://openai.com/news/rss.xml` | Public RSS | Title, URL |
| InfoQ AI & ML | `https://feed.infoq.com/ai-ml-data-eng` | Public RSS | Title, URL |
| The New Stack AI | `https://thenewstack.io/category/ai/feed/` | Public RSS | Title, URL |

### What we store

- Cached snapshots of the above public data, refreshed every 6 hours
- Stored in Supabase (`news_cache` table), auto-deleted after 48 hours
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

Deploy the Edge Function in `supabase/functions/mcp/` to your own Supabase project. Use `news_fetcher_prompt.md` as a Claude Code cron job to populate the cache.
