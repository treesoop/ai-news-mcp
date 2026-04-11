import { NewsItem, NewsSource } from "../types";

const USER_AGENT = "ai-news-mcp/1.0 by potenlab";
const TIMEOUT_MS = 10000;

interface RedditPost {
  data: {
    title: string;
    url: string;
    score: number;
    selftext?: string;
    permalink?: string;
    is_self?: boolean;
  };
}

interface RedditResponse {
  data: {
    children: RedditPost[];
  };
}

async function fetchSubreddit(
  subreddit: string,
  limit: number,
  source: NewsSource
): Promise<NewsItem[]> {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`Reddit r/${subreddit} HTTP ${res.status}`);

  const json = (await res.json()) as RedditResponse;
  const posts = json.data.children;

  return posts.map((post) => {
    const d = post.data;
    const postUrl = d.is_self
      ? `https://www.reddit.com${d.permalink}`
      : d.url;
    const summary = d.selftext
      ? d.selftext.slice(0, 200)
      : undefined;

    return {
      title: d.title,
      url: postUrl,
      source,
      score: d.score ?? 0,
      summary,
    };
  });
}

export async function scrapeRedditML(): Promise<NewsItem[]> {
  return fetchSubreddit("MachineLearning", 15, "reddit_ml");
}

export async function scrapeRedditLocalLLaMA(): Promise<NewsItem[]> {
  return fetchSubreddit("LocalLLaMA", 15, "reddit_localllama");
}

export async function scrapeRedditArtificial(): Promise<NewsItem[]> {
  return fetchSubreddit("artificial", 10, "reddit_artificial");
}

export async function scrapeRedditProgramming(): Promise<NewsItem[]> {
  return fetchSubreddit("programming", 10, "reddit_programming");
}

export async function scrapeRedditClaudeAI(): Promise<NewsItem[]> {
  return fetchSubreddit("ClaudeAI", 15, "reddit_claudeai");
}
