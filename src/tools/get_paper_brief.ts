function extractArxivId(url: string): string | null {
  // Supports:
  // https://arxiv.org/abs/2401.12345
  // https://arxiv.org/abs/2401.12345v2
  // https://arxiv.org/pdf/2401.12345
  const match = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/);
  return match ? match[1].replace(/v\d+$/, "") : null;
}

function parseHtmlText(html: string): string {
  // Very simple: strip HTML tags and decode common entities
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "ai-news-mcp/1.0" },
    });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

export interface PaperBriefResult {
  title: string;
  authors: string[];
  abstract: string;
  submitted: string;
  code_url?: string;
  arxiv_url: string;
}

export async function getPaperBrief(
  url: string
): Promise<PaperBriefResult | { error: string }> {
  try {
    const arxivId = extractArxivId(url);
    if (!arxivId) {
      return { error: "Invalid ArXiv URL. Expected format: https://arxiv.org/abs/2401.12345" };
    }

    const absUrl = `https://arxiv.org/abs/${arxivId}`;
    const res = await fetchWithTimeout(absUrl);

    if (!res.ok) {
      return { error: `Failed to fetch ArXiv page: ${res.status} ${res.statusText}` };
    }

    const html = await res.text();

    // Parse title
    const titleMatch = html.match(/<h1[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)
      || html.match(/<title>([\s\S]*?)<\/title>/i);
    let title = titleMatch ? parseHtmlText(titleMatch[1]) : "";
    // Clean "Title:" prefix from arxiv pages
    title = title.replace(/^Title:\s*/i, "").replace(/^\[\d+\.\d+\]\s*/, "").trim();

    // Parse authors
    const authorsMatch = html.match(/<div[^>]*class="[^"]*authors[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    let authors: string[] = [];
    if (authorsMatch) {
      const authorsHtml = authorsMatch[1];
      // Extract individual author links or text
      const aMatches = authorsHtml.match(/<a[^>]*>([\s\S]*?)<\/a>/g) ?? [];
      if (aMatches.length > 0) {
        authors = aMatches
          .map((a) => parseHtmlText(a))
          .filter((a) => a.length > 0);
      } else {
        authors = parseHtmlText(authorsHtml)
          .split(",")
          .map((a) => a.trim())
          .filter((a) => a.length > 0);
      }
    }

    // Parse abstract
    const abstractMatch = html.match(
      /<blockquote[^>]*class="[^"]*abstract[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/i
    );
    let abstract = abstractMatch ? parseHtmlText(abstractMatch[1]) : "";
    abstract = abstract.replace(/^Abstract:\s*/i, "").trim();

    // Parse submission date
    const dateMatch = html.match(
      /(?:Submitted|Submission history)[^:]*:\s*(?:\[v1\]\s*)?([A-Z][a-z]+,?\s+\d+\s+[A-Z][a-z]+\s+\d{4})/i
    );
    const submitted = dateMatch ? dateMatch[1].trim() : "";

    // Try Papers With Code for code links
    let codeUrl: string | undefined;

    try {
      const pwcUrl = `https://paperswithcode.com/paper/${arxivId}`;
      const pwcRes = await fetchWithTimeout(pwcUrl, 8000);

      if (pwcRes.ok) {
        const pwcHtml = await pwcRes.text();
        // Look for GitHub links in the page
        const githubMatch = pwcHtml.match(/href="(https:\/\/github\.com\/[^"]+)"/);
        if (githubMatch) {
          codeUrl = githubMatch[1];
        }
      }
    } catch {
      // Papers With Code failed — try GitHub search API as fallback
      try {
        const searchUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(arxivId)}&sort=stars&order=desc&per_page=1`;
        const ghRes = await fetchWithTimeout(searchUrl, 8000);
        if (ghRes.ok) {
          const ghData = await ghRes.json() as { items?: Array<{ html_url: string }> };
          if (ghData.items && ghData.items.length > 0) {
            codeUrl = ghData.items[0].html_url;
          }
        }
      } catch {
        // Ignore — codeUrl stays undefined
      }
    }

    return {
      title,
      authors,
      abstract,
      submitted,
      code_url: codeUrl,
      arxiv_url: absUrl,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
