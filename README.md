# ai-news-mcp

MCP (Model Context Protocol) server that aggregates real-time AI/tech news from 11 sources with 1-hour file caching.

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

## Setup

```bash
npm install
npm run build
```

## MCP Tools

### `get_trending_news`
Fetch aggregated news with optional category filter.

```json
{ "category": "AI", "refresh": false }
```

### `get_topic_suggestions`
Get blog topic ideas tailored per project, filtered by already-used topics.

```json
{ "project": "potenlab", "slots": 3, "used_topics": ["GPT-4 review"] }
```

Project routing:
- `treesoop`: prioritizes arxiv, reddit_ml, reddit_localllama
- `potenlab`: prioritizes hackernews, devto, github
- `hanguljobs`: prioritizes programming, general tech

### `check_cache`
Inspect current cache state.

```json
{}
```

## Test

```bash
# List tools
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js

# Check cache
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"check_cache","arguments":{}}}' | node dist/index.js
```

## Cache

Files written to `cache/news_YYYY-MM-DD_HH.json` (one per UTC hour). The `cache/` directory is gitignored. All 11 sources are fetched in parallel via `Promise.allSettled()` — a failing source is logged and skipped without blocking others. Each source has a 10-second timeout.

## MCP Config (Claude Desktop / claude_desktop_config.json)

```json
{
  "mcpServers": {
    "ai-news-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/ai-news-mcp/dist/index.js"]
    }
  }
}
```
