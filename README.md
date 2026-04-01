# ai-news-mcp

Real-time AI/tech news aggregator MCP server — deployed on Supabase Edge Functions, **free to use, no auth required**.

Sources: HackerNews, Reddit (ML/LocalLLaMA/artificial/programming), ArXiv (cs.AI + cs.LG), GitHub Trending, Dev.to, Lobsters, GeekNews. Cache updated every 6 hours.

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

## Sources

| Source | Type | Category |
|---|---|---|
| HackerNews | JSON API | dev-tools, AI |
| Dev.to | JSON API | dev-tools, AI |
| Lobsters | JSON API | dev-tools |
| r/MachineLearning | Reddit API | AI |
| r/LocalLLaMA | Reddit API | AI |
| r/artificial | Reddit API | AI, community |
| r/programming | Reddit API | dev-tools, community |
| ArXiv cs.AI | RSS | AI |
| ArXiv cs.LG | RSS | AI |
| GitHub Trending | HTML scrape | dev-tools |
| GeekNews | HTML scrape | community, dev-tools |

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
