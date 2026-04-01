const INSTALL_PATTERNS = [
  /pip\s+install\s+\S+/,
  /npm\s+install\s+.+/,
  /npx\s+\S+/,
  /cargo\s+add\s+\S+/,
  /go\s+get\s+\S+/,
  /brew\s+install\s+\S+/,
  /docker\s+pull\s+\S+/,
  /curl\s+.*\|\s*sh/,
  /wget\s+.*\|\s*sh/,
  /yarn\s+add\s+\S+/,
  /pnpm\s+add\s+\S+/,
];

function extractInstallCommands(readme: string): string[] {
  const lines = readme.split("\n");
  const commands: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim().replace(/^[$>]\s+/, ""); // strip leading $ or >
    for (const pattern of INSTALL_PATTERNS) {
      if (pattern.test(trimmed)) {
        if (!seen.has(trimmed)) {
          seen.add(trimmed);
          commands.push(trimmed);
        }
        break;
      }
    }
  }

  return commands;
}

function extractQuickstart(readme: string): string {
  const lines = readme.split("\n");
  const headerPattern = /^#+\s*(quick\s*start|usage|getting\s+started)/i;

  let inSection = false;
  let codeBlock = "";
  let inCodeBlock = false;
  let codeLines: string[] = [];

  for (const line of lines) {
    if (headerPattern.test(line)) {
      inSection = true;
      continue;
    }

    if (inSection) {
      // If we hit another top-level header, stop
      if (/^#/.test(line) && !headerPattern.test(line)) {
        break;
      }

      if (line.startsWith("```")) {
        if (inCodeBlock) {
          // End of code block
          codeBlock = codeLines.join("\n");
          break;
        } else {
          inCodeBlock = true;
          codeLines = [];
        }
      } else if (inCodeBlock) {
        codeLines.push(line);
      }
    }
  }

  return codeBlock || "";
}

export interface RepoQuickstartResult {
  repo: string;
  description: string;
  stars: number;
  language: string;
  topics: string[];
  install: string[];
  quickstart: string;
  readme_url: string;
}

export async function getRepoQuickstart(
  url: string
): Promise<RepoQuickstartResult | { error: string }> {
  try {
    // Parse owner/repo from GitHub URL
    const match = url.match(/github\.com\/([^/]+)\/([^/?\s#]+)/);
    if (!match) {
      return { error: "Invalid GitHub URL. Expected format: https://github.com/owner/repo" };
    }

    const owner = match[1];
    const repo = match[2].replace(/\.git$/, "");

    // Fetch repo metadata
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const apiRes = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "ai-news-mcp/1.0",
        Accept: "application/vnd.github.v3+json",
      },
    });
    clearTimeout(timeout);

    if (!apiRes.ok) {
      return { error: `GitHub API error: ${apiRes.status} ${apiRes.statusText}` };
    }

    const repoData = await apiRes.json() as {
      description?: string;
      stargazers_count?: number;
      language?: string;
      topics?: string[];
    };

    // Fetch README (try main, then master)
    let readmeContent = "";
    for (const branch of ["main", "master"]) {
      const readmeUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`;
      const readmeController = new AbortController();
      const readmeTimeout = setTimeout(() => readmeController.abort(), 10000);

      try {
        const readmeRes = await fetch(readmeUrl, {
          signal: readmeController.signal,
          headers: { "User-Agent": "ai-news-mcp/1.0" },
        });
        clearTimeout(readmeTimeout);

        if (readmeRes.ok) {
          readmeContent = await readmeRes.text();
          break;
        }
      } catch {
        clearTimeout(readmeTimeout);
      }
    }

    const install = extractInstallCommands(readmeContent);
    const quickstart = extractQuickstart(readmeContent);

    return {
      repo: `${owner}/${repo}`,
      description: repoData.description ?? "",
      stars: repoData.stargazers_count ?? 0,
      language: repoData.language ?? "",
      topics: repoData.topics ?? [],
      install,
      quickstart,
      readme_url: `https://github.com/${owner}/${repo}#readme`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
