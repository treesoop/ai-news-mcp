import * as path from "path";
import * as dotenv from "dotenv";

// Load .env before anything else
dotenv.config({ path: path.join(__dirname, "..", ".env") });

import * as http from "http";
import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ensureCacheDir } from "./cache";
import { getTrendingNews } from "./tools/get_trending_news";
import { getTopicSuggestions } from "./tools/get_topic_suggestions";
import { checkCache } from "./tools/check_cache";
import { getTopPicks } from "./tools/get_top_picks";
import { getRepoQuickstart } from "./tools/get_repo_quickstart";
import { getPaperBrief } from "./tools/get_paper_brief";
import { searchToday } from "./tools/search_today";
import { getNewSince } from "./tools/get_new_since";
import { Category, Project } from "./types";

ensureCacheDir();

const server = new Server(
  {
    name: "ai-news-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_trending_news",
        description:
          "Aggregates real-time AI/tech news from multiple sources (HackerNews, Dev.to, Reddit, ArXiv, GitHub Trending, GeekNews, Lobsters) with 1-hour caching. Reads from Supabase cache when available, falls back to local file cache.",
        inputSchema: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: ["AI", "dev-tools", "community", "all"],
              description: "Filter news by category. Default: all",
              default: "all",
            },
            refresh: {
              type: "boolean",
              description: "Force refresh cache even if current hour cache exists. Default: false",
              default: false,
            },
          },
          required: [],
        },
      },
      {
        name: "get_top_picks",
        description:
          "Returns top N most relevant items for AI engineers, scored by source reputation (HN/Reddit > ArXiv > others) plus item score. Each item includes a one-liner 'why it matters' and optional try_url.",
        inputSchema: {
          type: "object",
          properties: {
            n: {
              type: "number",
              description: "Number of top picks to return. Default: 10",
              default: 10,
            },
            category: {
              type: "string",
              enum: ["AI", "dev-tools", "community", "all"],
              description: "Filter by category before picking. Default: all",
              default: "all",
            },
          },
          required: [],
        },
      },
      {
        name: "get_repo_quickstart",
        description:
          "Fetches a GitHub repo's metadata (stars, description, language, topics) and extracts install commands and a quickstart code block from its README.",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "GitHub repository URL, e.g. https://github.com/owner/repo",
            },
          },
          required: ["url"],
        },
      },
      {
        name: "get_paper_brief",
        description:
          "Fetches an ArXiv paper's title, authors, abstract, and submission date. Searches Papers With Code and GitHub for associated code repositories.",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "ArXiv paper URL, e.g. https://arxiv.org/abs/2401.12345",
            },
          },
          required: ["url"],
        },
      },
      {
        name: "search_today",
        description:
          "Search today's cached news by keyword query. Matches against title and summary, scores by word match count × item score. Returns top results.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query string (space-separated keywords)",
            },
            limit: {
              type: "number",
              description: "Maximum number of results to return. Default: 20",
              default: 20,
            },
          },
          required: ["query"],
        },
      },
      {
        name: "get_new_since",
        description:
          "Queries Supabase for all cache rows created after a given ISO timestamp. Returns deduplicated news items sorted newest first. Requires Supabase connection.",
        inputSchema: {
          type: "object",
          properties: {
            since: {
              type: "string",
              description: "ISO 8601 timestamp, e.g. 2026-04-01T00:00:00Z",
            },
          },
          required: ["since"],
        },
      },
      {
        name: "get_topic_suggestions",
        description:
          "Suggests blog topic ideas based on trending news, tailored per project (potenlab, treesoop, hanguljobs) and filtered against already-used topics.",
        inputSchema: {
          type: "object",
          properties: {
            project: {
              type: "string",
              enum: ["potenlab", "treesoop", "hanguljobs"],
              description: "The project requesting topic suggestions",
            },
            slots: {
              type: "number",
              description: "Number of topic suggestions to return. Default: 3",
              default: 3,
            },
            used_topics: {
              type: "array",
              items: { type: "string" },
              description: "List of already-used topics to avoid duplicates",
              default: [],
            },
          },
          required: ["project"],
        },
      },
      {
        name: "check_cache",
        description:
          "Check the current state of the news cache — Supabase connection status, whether local/Supabase cache exists, how old it is, and how many items per source.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "get_trending_news") {
      const category = ((args?.category as string) ?? "all") as Category;
      const refresh = (args?.refresh as boolean) ?? false;
      const result = await getTrendingNews(category, refresh);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (name === "get_top_picks") {
      const n = (args?.n as number) ?? 10;
      const category = ((args?.category as string) ?? "all") as Category;
      const result = await getTopPicks(n, category);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (name === "get_repo_quickstart") {
      if (!args?.url) {
        throw new Error("Missing required argument: url");
      }
      const result = await getRepoQuickstart(args.url as string);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (name === "get_paper_brief") {
      if (!args?.url) {
        throw new Error("Missing required argument: url");
      }
      const result = await getPaperBrief(args.url as string);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (name === "search_today") {
      if (!args?.query) {
        throw new Error("Missing required argument: query");
      }
      const query = args.query as string;
      const limit = (args?.limit as number) ?? 20;
      const result = await searchToday(query, limit);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (name === "get_new_since") {
      if (!args?.since) {
        throw new Error("Missing required argument: since");
      }
      const result = await getNewSince(args.since as string);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (name === "get_topic_suggestions") {
      if (!args?.project) {
        throw new Error("Missing required argument: project");
      }
      const project = args.project as Project;
      const slots = (args?.slots as number) ?? 3;
      const usedTopics = (args?.used_topics as string[]) ?? [];
      const result = await getTopicSuggestions(project, slots, usedTopics);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (name === "check_cache") {
      const result = await checkCache();
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: JSON.stringify({ error: message }) }],
      isError: true,
    };
  }
});

function buildServer(): Server {
  const srv = new Server(
    { name: "ai-news-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  srv.setRequestHandler(ListToolsRequestSchema, server["_requestHandlers"].get(ListToolsRequestSchema.shape.method.value) as never);
  srv.setRequestHandler(CallToolRequestSchema, server["_requestHandlers"].get(CallToolRequestSchema.shape.method.value) as never);
  return srv;
}

async function startHttp() {
  const PORT = parseInt(process.env.PORT ?? "3000", 10);
  const app = express();
  app.use(express.json());

  async function handleMcp(req: express.Request, res: express.Response) {
    const srv = new Server(
      { name: "ai-news-mcp", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );
    attachHandlers(srv);

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => transport.close());
    await srv.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  app.post("/mcp", handleMcp);
  app.get("/mcp", handleMcp);
  app.delete("/mcp", (_req, res) => res.status(405).json({ error: "Method not allowed" }));
  app.get("/health", (_req, res) => res.json({ status: "ok", server: "ai-news-mcp", version: "1.0.0" }));

  app.listen(PORT, () => console.error(`[ai-news-mcp] HTTP server on port ${PORT}`));
}

function attachHandlers(srv: Server) {
  srv.setRequestHandler(ListToolsRequestSchema, async () => {
    return server.request({ method: "tools/list" } as never, ListToolsRequestSchema as never);
  });
  srv.setRequestHandler(CallToolRequestSchema, async (req) => {
    return server.request(req as never, CallToolRequestSchema as never);
  });
}

async function startStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[ai-news-mcp] Server running on stdio");
}

async function main() {
  if (process.env.PORT || process.env.HTTP_MODE === "1") {
    await startHttp();
  } else {
    await startStdio();
  }
}

main().catch((err) => {
  console.error("[ai-news-mcp] Fatal error:", err);
  process.exit(1);
});
