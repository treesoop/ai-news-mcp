import { XMLParser } from "fast-xml-parser";
import { NewsItem, NewsSource } from "../types";

const TIMEOUT_MS = 10000;

interface RSSItem {
  title: string | { "#text": string };
  link: string | { "#text": string } | Array<{ "@_href"?: string; "#text"?: string }>;
  description?: string | { "#text": string };
}

interface RSSFeed {
  rss?: {
    channel?: {
      item?: RSSItem | RSSItem[];
    };
  };
  "rdf:RDF"?: {
    item?: RSSItem | RSSItem[];
  };
}

function extractText(val: unknown): string {
  if (typeof val === "string") return val;
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if ("#text" in obj) return String(obj["#text"]);
  }
  return "";
}

function extractLink(val: unknown): string {
  if (typeof val === "string") return val;
  if (Array.isArray(val)) {
    for (const entry of val) {
      if (typeof entry === "object" && entry !== null) {
        const e = entry as Record<string, unknown>;
        if (e["@_href"]) return String(e["@_href"]);
        if (e["#text"]) return String(e["#text"]);
      }
    }
    return "";
  }
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if ("@_href" in obj) return String(obj["@_href"]);
    if ("#text" in obj) return String(obj["#text"]);
  }
  return "";
}

async function fetchArxivFeed(feedUrl: string, source: NewsSource): Promise<NewsItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(feedUrl, {
      signal: controller.signal,
      headers: { Accept: "application/rss+xml, application/xml, text/xml" },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`ArXiv ${source} HTTP ${res.status}`);

  const xml = await res.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    isArray: (name) => name === "item",
  });

  const parsed: RSSFeed = parser.parse(xml);

  let rawItems: RSSItem[] = [];
  if (parsed.rss?.channel?.item) {
    rawItems = Array.isArray(parsed.rss.channel.item)
      ? parsed.rss.channel.item
      : [parsed.rss.channel.item];
  } else if (parsed["rdf:RDF"]?.item) {
    rawItems = Array.isArray(parsed["rdf:RDF"].item)
      ? parsed["rdf:RDF"].item
      : [parsed["rdf:RDF"].item];
  }

  return rawItems.map((item, idx) => {
    const title = extractText(item.title).trim();
    const url = extractLink(item.link).trim();
    const description = extractText(item.description).replace(/<[^>]+>/g, "").trim();

    return {
      title: title || `ArXiv item ${idx + 1}`,
      url,
      source,
      score: 0,
      summary: description ? description.slice(0, 300) : undefined,
    };
  }).filter((item) => item.url);
}

export async function scrapeArxivAI(): Promise<NewsItem[]> {
  return fetchArxivFeed("https://rss.arxiv.org/rss/cs.AI", "arxiv_ai");
}

export async function scrapeArxivML(): Promise<NewsItem[]> {
  return fetchArxivFeed("https://rss.arxiv.org/rss/cs.LG", "arxiv_ml");
}
