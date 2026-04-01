import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ensureCacheDir } from "./cache";
import { getTrendingNews } from "./tools/get_trending_news";
import { getTopicSuggestions } from "./tools/get_topic_suggestions";
import { checkCache } from "./tools/check_cache";
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
          "Aggregates real-time AI/tech news from multiple sources (HackerNews, Dev.to, Reddit, ArXiv, GitHub Trending, GeekNews, Lobsters) with 1-hour caching.",
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
          "Check the current state of the news cache — whether it exists, how old it is, and how many items per source.",
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
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
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
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === "check_cache") {
      const result = checkCache();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: message }),
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[ai-news-mcp] Server running on stdio");
}

main().catch((err) => {
  console.error("[ai-news-mcp] Fatal error:", err);
  process.exit(1);
});
