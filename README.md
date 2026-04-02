# ai-news-mcp

Real-time AI/tech news aggregator MCP server — deployed on Supabase Edge Functions, **free to use, no auth required**.

Sources: HackerNews, Reddit (ML/LocalLLaMA/artificial/programming/ClaudeAI), ArXiv (cs.AI + cs.LG), GitHub Trending, Dev.to, Lobsters, GeekNews, HuggingFace Daily Papers, The New Stack AI, Harness Engineering. Cache updated every 6 hours.

## Quick Start (No install, no login)

**No Smithery account needed.** Just use the URL directly — no API key, no auth.

### Claude Code CLI (one command)

```bash
claude mcp add --transport http ai-news https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/mcp
```

That's it. Run this once and the tools are available in any Claude Code session.

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

### Any MCP client (HTTP/Streamable HTTP transport)

```
https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/mcp
```

---

## Tools

| Tool | Description |
|---|---|
| `get_trending_news` | Latest AI/tech news from all sources. Filter by category: `AI` or `dev-tools` |
| `get_top_picks` | Top N most relevant items for AI engineers |
| `search_today` | Search today's news by keyword |
| `get_new_since` | Items added after a given timestamp |
| `get_repo_quickstart` | Install commands & quickstart from any GitHub repo URL |
| `get_paper_brief` | Abstract + code link for any ArXiv paper URL |
| `get_topic_suggestions` | Blog topic ideas based on trending news |
| `check_cache` | Cache status and last update time |

### Example calls

```bash
# Get top AI news
curl -s -X POST "https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_top_picks","arguments":{"n":5}}}'

# Search for RAG-related news
curl -s -X POST "https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_today","arguments":{"keyword":"RAG"}}}'
```

---

## Data Sources & Transparency

We aggregate **publicly available** content from the following sources. No authentication, no private data — only public feeds, APIs, and pages.

| Source | URL | Method | Data collected |
|---|---|---|---|
| HackerNews | `https://hacker-news.firebaseio.com/v0/topstories.json` | Public JSON API | Title, URL, score, author, comment count |
| Dev.to | `https://dev.to/api/articles?tag=ai` | Public JSON API | Title, URL, tags, reactions, reading time |
| Lobsters | `https://lobste.rs/hottest.json` | Public JSON API | Title, URL, score, tags |
| r/MachineLearning | `https://www.reddit.com/r/MachineLearning/hot.json` | Public Reddit API | Title, URL, score, flair (no user data) |
| r/LocalLLaMA | `https://www.reddit.com/r/LocalLLaMA/hot.json` | Public Reddit API | Title, URL, score, flair (no user data) |
| r/artificial | `https://www.reddit.com/r/artificial/hot.json` | Public Reddit API | Title, URL, score, flair (no user data) |
| r/programming | `https://www.reddit.com/r/programming/hot.json` | Public Reddit API | Title, URL, score, flair (no user data) |
| ArXiv cs.AI | `https://rss.arxiv.org/rss/cs.AI` | Public RSS feed | Title, abstract, authors, paper URL |
| ArXiv cs.LG | `https://rss.arxiv.org/rss/cs.LG` | Public RSS feed | Title, abstract, authors, paper URL |
| GitHub Trending | `https://github.com/trending` | HTML scrape | Repo name, description, stars, language |
| GeekNews | `https://news.hada.io` | HTML scrape | Title, URL, score |
| r/ClaudeAI | `https://www.reddit.com/r/ClaudeAI/hot.json` | Public Reddit API | Title, URL, score (no user data) |
| HuggingFace Daily Papers | `https://huggingface.co/api/daily_papers` | Public JSON API | Title, paper URL, upvotes |
| The New Stack AI | `https://thenewstack.io/category/ai/feed/` | Public RSS feed | Title, URL |
| Harness Engineering | `https://www.harness.io/blog/rss.xml` | Public RSS feed | Title, URL |

### What we store

- Cached snapshots of the above public data, refreshed every 6 hours
- Stored in Supabase (`news_cache` table), retained for 48 hours then purged
- No user data, no personal information, no private content collected

### What we don't do

- We do not scrape paywalled or login-required content
- We do not store full article bodies — only titles, URLs, scores, and summaries
- We do not sell or share this data; it's purely for AI assistant context

---

## Self-hosting

If you want to run your own instance:

```bash
git clone https://github.com/treesoop/ai-news-mcp
cd ai-news-mcp
npm install && npm run build
```

Deploy the Supabase Edge Function in `supabase/functions/mcp/` to your own Supabase project.

Or run locally as stdio MCP:
```json
{
  "mcpServers": {
    "ai-news": {
      "command": "node",
      "args": ["/path/to/ai-news-mcp/dist/index.js"]
    }
  }
}
```
