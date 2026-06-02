# Recency-Weighted Curation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop stale items from dominating curation by giving every scraped item a publication timestamp, making the curate LLM weight recency, and enlarging the curated pool from 30 → 50 so downstream consumers don't starve.

**Architecture:** The pipeline is prompt-driven — `news_fetcher_prompt.md` defines per-source scrapers (bash + jq + WebFetch) and `news_curate_prompt.md` defines the LLM curation rubric. We're adding a single new field `published_at` (Unix epoch seconds, `null` if unknown) to every parsed item, exposing it to the curate LLM in its review listing, and adding an explicit recency rubric. Pool size bumps to 50.

**Tech Stack:** bash, jq, Python (for OpenAI RSS pubDate parsing — already in place), curl, Supabase REST (read/write), Claude Code headless `claude -p`.

---

## Field Contract

**`published_at`**: Unix epoch seconds (integer) or `null`.
- `null` when the source genuinely doesn't expose a publication time per item (e.g. GitHub Trending — "trended today" ≠ "published today").
- Never fake-fill with `now()` — that would silently rank unknowns as freshest.
- The curate prompt treats `null` as "moderate" (no boost, no discount).

**Why epoch seconds?** Cross-source uniform, sorts naturally, timezone-unambiguous, easy to diff against `now`.

## File Structure

**Modify:**
- `news_fetcher_prompt.md` — 8 source sections (3-1 through 3-8) gain `published_at` extraction.
- `news_curate_prompt.md` — STEP 1 display includes published_at, STEP 2 gains recency rubric, "top 30" → "top 50" in title + STEP 2 + STEP 4 reference.

**No new files.** No schema changes required (the `data` column in `news_cache` is `jsonb`, so adding fields is automatic). Optional follow-up `ALTER TABLE news_curated ADD COLUMN published_at bigint` is deferred to a separate task at the end and may be skipped.

## Source-by-source timestamp availability

| # | Source | Raw field | Extraction difficulty | Fallback |
|---|---|---|---|---|
| 3-1 | HackerNews | `time` (epoch) | trivial — jq | n/a |
| 3-2 | Reddit | `created_utc` (epoch float) | trivial — jq | n/a |
| 3-3 | Lobsters | `created_at` (ISO 8601) | easy — jq + date parse | n/a |
| 3-4 | GitHub Trending | none in HTML | impossible cheaply | `null` |
| 3-5 | GeekNews | "N분 전" / "N시간 전" relative text | best-effort — prompt parsing | `null` |
| 3-6 | OpenAI RSS | `<pubDate>` RFC 2822 | trivial — already parsed, just persist | n/a |
| 3-7 | Anthropic | visible date on `/news` page | best-effort — WebFetch prompt | `null` |
| 3-8 | HF Spaces API | `lastModified` (ISO 8601) | easy — jq + date parse | n/a |

---

## Task 1: HackerNews — capture `time` field

**Files:**
- Modify: `news_fetcher_prompt.md` STEP 3-1 (lines ~37-66)

- [ ] **Step 1: Confirm HN API field shape**

Run:
```bash
ID=$(curl -s "https://hacker-news.firebaseio.com/v0/topstories.json" | jq -r '.[0]')
curl -s "https://hacker-news.firebaseio.com/v0/item/${ID}.json" | jq '{type,title,time,score}'
```
Expected output: `time` is a 10-digit Unix epoch integer (e.g. `1717293812`). Confirm before editing.

- [ ] **Step 2: Edit prompt to capture `time` into `published_at`**

In `news_fetcher_prompt.md` STEP 3-1, change the `entry=$(jq -n ...)` block:

```bash
# BEFORE (lines ~59-60):
entry=$(jq -n --arg t "$title" --arg u "$url" --argjson s "$score" \
  '{"title":$t,"url":$u,"score":$s,"source":"hackernews"}')

# AFTER:
hn_time=$(echo "$item" | jq -r '.time // empty')
entry=$(jq -n --arg t "$title" --arg u "$url" --argjson s "$score" \
  --argjson pa "${hn_time:-null}" \
  '{"title":$t,"url":$u,"score":$s,"source":"hackernews","published_at":$pa}')
```

Note: `${hn_time:-null}` falls back to literal `null` when the field is missing — `--argjson` then parses it as JSON null, not the string "null".

- [ ] **Step 3: Verify with a live mini-run**

Run the STEP 3-1 bash block locally (just the loop, top 3 IDs to save time):
```bash
HN_IDS=$(curl -s "https://hacker-news.firebaseio.com/v0/topstories.json" | jq -r '.[:3][]')
HN_ITEMS="[]"
while IFS= read -r id; do
  [ -z "$id" ] && continue
  item=$(curl -s "https://hacker-news.firebaseio.com/v0/item/${id}.json")
  type=$(echo "$item" | jq -r '.type // "unknown"')
  title=$(echo "$item" | jq -r '.title // ""')
  if [ "$type" = "story" ] && [ -n "$title" ] && [ "$title" != "null" ]; then
    url=$(echo "$item" | jq -r '.url // ""')
    score=$(echo "$item" | jq -r '.score // 0')
    actual_id=$(echo "$item" | jq -r '.id')
    [ -z "$url" ] || [ "$url" = "null" ] && url="https://news.ycombinator.com/item?id=${actual_id}"
    hn_time=$(echo "$item" | jq -r '.time // empty')
    entry=$(jq -n --arg t "$title" --arg u "$url" --argjson s "$score" \
      --argjson pa "${hn_time:-null}" \
      '{"title":$t,"url":$u,"score":$s,"source":"hackernews","published_at":$pa}')
    HN_ITEMS=$(echo "$HN_ITEMS" | jq --argjson e "$entry" '. += [$e]')
  fi
done <<< "$HN_IDS"
echo "$HN_ITEMS" | jq '.[] | {title, published_at, age_hours: ((now - .published_at) / 3600 | floor)}'
```
Expected: every item has a 10-digit `published_at` and a sane `age_hours` (typically 0-72 for top stories).

- [ ] **Step 4: Commit**

```bash
git add news_fetcher_prompt.md
git commit -m "feat(fetcher): capture published_at for HackerNews items

Use HN API's time field (Unix epoch seconds). Falls back to null if missing.
First piece of recency-weighting work (A in A+B+C plan)."
```

---

## Task 2: Reddit — capture `created_utc` field

**Files:**
- Modify: `news_fetcher_prompt.md` STEP 3-2 (lines ~75-102)

- [ ] **Step 1: Confirm Reddit API field shape**

```bash
curl -s "https://www.reddit.com/r/artificial/hot.json?limit=1" \
  -H "User-Agent: ai-news-mcp/1.0 (testing)" \
  | jq '.data.children[0].data | {title, created_utc, score}'
```
Expected: `created_utc` is a float (e.g. `1717293812.0`). We'll cast to integer.

- [ ] **Step 2: Edit prompt jq parse to include `published_at`**

In `news_fetcher_prompt.md` STEP 3-2, change the jq map:

```bash
# BEFORE (lines ~93-99):
jq --arg src "$src" '[.data.children[].data | {
  title,
  score,
  url: (if .is_self then ("https://reddit.com" + .permalink) else .url end),
  summary: (.selftext[:200] // ""),
  source: $src
}]' /tmp/raw_reddit_${sub}.json > /tmp/parsed_reddit_${sub}.json 2>/dev/null || echo '[]' > /tmp/parsed_reddit_${sub}.json

# AFTER:
jq --arg src "$src" '[.data.children[].data | {
  title,
  score,
  url: (if .is_self then ("https://reddit.com" + .permalink) else .url end),
  summary: (.selftext[:200] // ""),
  source: $src,
  published_at: (.created_utc // null | if . then (. | floor) else null end)
}]' /tmp/raw_reddit_${sub}.json > /tmp/parsed_reddit_${sub}.json 2>/dev/null || echo '[]' > /tmp/parsed_reddit_${sub}.json
```

- [ ] **Step 3: Verify with a live mini-run**

```bash
REDDIT_UA="ai-news-mcp/1.0 (public news aggregator; contact: official@treesoop.com)"
curl -s "https://www.reddit.com/r/artificial/hot.json?limit=5" -H "User-Agent: $REDDIT_UA" > /tmp/raw_test.json
jq '[.data.children[].data | {
  title,
  source: "reddit_artificial",
  published_at: (.created_utc // null | if . then (. | floor) else null end)
}] | .[] | {title: (.title[:50]), published_at, age_hours: (if .published_at then ((now - .published_at) / 3600 | floor) else null end)}' /tmp/raw_test.json
```
Expected: each item has 10-digit `published_at` and `age_hours` typically 0-48 (Reddit "hot" tends to be recent).

- [ ] **Step 4: Commit**

```bash
git add news_fetcher_prompt.md
git commit -m "feat(fetcher): capture published_at for Reddit items

Use created_utc (cast to integer). Applies to all six subreddits."
```

---

## Task 3: Lobsters — parse `created_at` ISO string

**Files:**
- Modify: `news_fetcher_prompt.md` STEP 3-3 (lines ~104-110)

- [ ] **Step 1: Confirm Lobsters API field shape**

```bash
curl -s "https://lobste.rs/hottest.json" | jq '.[0] | {title, created_at, score}'
```
Expected: `created_at` is ISO 8601 (e.g. `"2026-06-01T14:23:00.000-07:00"`).

- [ ] **Step 2: Edit prompt to parse ISO → epoch**

**Important:** jq 1.7.1's `fromdateiso8601` only accepts `YYYY-MM-DDTHH:MM:SSZ` — it rejects fractional seconds AND offsets. Lobsters returns `2026-06-01T14:23:00.000-07:00` (both). We use `capture()` to extract the bare datetime + signed offset, parse the bare part as UTC, then subtract the offset.

In `news_fetcher_prompt.md` STEP 3-3, change the jq block:

```bash
# BEFORE (line ~108):
jq '[.[:25][] | {title, url, score, source: "lobsters", summary: ""}]' /tmp/raw_lobsters.json > /tmp/parsed_lobsters.json 2>/dev/null || echo '[]' > /tmp/parsed_lobsters.json

# AFTER:
jq '[.[:25][] | {
  title, url, score,
  source: "lobsters",
  summary: "",
  published_at: (.created_at // null | if . then (
    capture("^(?<dt>[^.]+)\\.(?<frac>[0-9]+)(?<sign>[+-])(?<hh>[0-9]{2}):(?<mm>[0-9]{2})$") |
    (.dt + "Z" | fromdateiso8601) -
    ((.sign + "1" | tonumber) * ((.hh | tonumber) * 3600 + (.mm | tonumber) * 60))
  ) // null else null end)
}]' /tmp/raw_lobsters.json > /tmp/parsed_lobsters.json 2>/dev/null || echo '[]' > /tmp/parsed_lobsters.json
```

How the math works for input `2026-06-01T14:23:00.000-07:00`:
- `capture` extracts `dt=2026-06-01T14:23:00`, `sign=-`, `hh=07`, `mm=00`.
- `(.dt + "Z" | fromdateiso8601)` parses `2026-06-01T14:23:00Z` as a naive UTC epoch.
- Subtract `((sign + "1") | tonumber) * (7*3600 + 0*60)` = `-1 * 25200` = `-25200`.
- Result: naive_utc_epoch - (-25200) = naive_utc_epoch + 25200 = correctly shifts wall-clock −07:00 to UTC.

Outer `capture(...) // null` returns `null` if regex doesn't match (defensive — Lobsters always returns this format, but the fallback prevents a crash if format ever changes).

- [ ] **Step 3: Verify with a live mini-run**

```bash
curl -s "https://lobste.rs/hottest.json" > /tmp/raw_lob.json
jq '[.[:5][] | {
  title, published_at: (.created_at // null | if . then (fromdateiso8601? // null) else null end)
}] | .[] | {title: (.title[:50]), published_at, age_hours: (if .published_at then ((now - .published_at) / 3600 | floor) else null end)}' /tmp/raw_lob.json
```
Expected: `published_at` populated for most items, `age_hours` typically 0-72.

- [ ] **Step 4: Commit**

```bash
git add news_fetcher_prompt.md
git commit -m "feat(fetcher): capture published_at for Lobsters items

Parse created_at ISO 8601 to epoch via jq fromdateiso8601."
```

---

## Task 4: OpenAI RSS — persist already-parsed `pubDate`

**Files:**
- Modify: `news_fetcher_prompt.md` STEP 3-6 (lines ~120-164)

- [ ] **Step 1: Note current behavior**

`pubDate` is already parsed by the existing Python block to enforce a 7-day cutoff, but the parsed timestamp is discarded after the filter check. We just need to persist it.

- [ ] **Step 2: Edit Python block to save `published_at`**

In `news_fetcher_prompt.md` STEP 3-6, find the `items.append(...)` call (~line 158) and change:

```python
# BEFORE:
    items.append({'title': title, 'url': url, 'score': 0, 'source': 'openai', 'summary': summary})

# AFTER:
    published_at = None
    if pub_m:
        try:
            from email.utils import parsedate_to_datetime
            pd = parsedate_to_datetime(pub_m.group(1).strip())
            published_at = int(pd.timestamp())
        except Exception:
            pass
    items.append({'title': title, 'url': url, 'score': 0, 'source': 'openai', 'summary': summary, 'published_at': published_at})
```

Note: we re-parse `pub_m` inside the try block rather than reusing the `pub_date` variable defined inside the earlier `if pub_m:` cutoff block — it's local-scoped within that branch. A small DRY refactor would lift it, but keeping it minimal here.

- [ ] **Step 3: Verify with a live mini-run**

Save the modified Python block to a scratch file and run it on the live RSS, then print published_at + age:
```bash
cd /tmp && curl -sL "https://openai.com/blog/rss.xml" \
  -H "User-Agent: Mozilla/5.0" -H "Accept: application/rss+xml" > /tmp/openai_rss.xml
python3 - << 'PYEOF'
import re, json
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone
xml = open('/tmp/openai_rss.xml').read()
items_raw = re.findall(r'<item>([\s\S]*?)</item>', xml)[:5]
now = datetime.now(timezone.utc).timestamp()
for item in items_raw:
    title_m = re.search(r'<title><!\[CDATA\[(.*?)\]\]>', item) or re.search(r'<title>(.*?)</title>', item)
    pub_m = re.search(r'<pubDate>(.*?)</pubDate>', item)
    if not title_m or not pub_m: continue
    pd = parsedate_to_datetime(pub_m.group(1).strip())
    ts = int(pd.timestamp())
    age_h = int((now - ts) / 3600)
    print(f"  ts={ts} age={age_h}h title={title_m.group(1)[:50]}")
PYEOF
```
Expected: each item shows `ts=<10-digit>` and a positive `age` in hours.

- [ ] **Step 4: Commit**

```bash
git add news_fetcher_prompt.md
git commit -m "feat(fetcher): persist published_at for OpenAI RSS items

pubDate was parsed for 7-day cutoff but discarded — now save the epoch
on each item."
```

---

## Task 5: HF Spaces — capture `lastModified`

**Files:**
- Modify: `news_fetcher_prompt.md` STEP 3-8 (lines ~170-176)

- [ ] **Step 1: Confirm HF API field shape**

```bash
# Default API call does NOT include lastModified. Must use full=true.
curl -s "https://huggingface.co/api/spaces?sort=trendingScore&limit=1&full=true" \
  | jq '.[0] | {id, lastModified, createdAt, trendingScore}'
```
Expected: `lastModified` is ISO 8601 with format `YYYY-MM-DDTHH:MM:SS.NNNZ` (fractional milliseconds + Z, no offset). `createdAt` same format. We use `lastModified` (more meaningful for "trending now").

**Critical:** jq 1.7.1's `fromdateiso8601` rejects fractional seconds, so we must strip `.NNN` before parsing. Use `gsub` to drop fractional milliseconds from the Z-suffixed timestamp.

- [ ] **Step 2: Edit prompt — add `full=true` AND parse `lastModified`**

In `news_fetcher_prompt.md` STEP 3-8, change both the curl URL and the jq block:

```bash
# BEFORE (lines ~173-174):
curl -s "https://huggingface.co/api/spaces?sort=trendingScore&limit=15" > /tmp/raw_hf_spaces.json
jq '[.[] | {title: .id, url: ("https://huggingface.co/spaces/" + .id), score: (.trendingScore // 0), source: "hf_spaces", summary: ""}]' /tmp/raw_hf_spaces.json > /tmp/parsed_hf_spaces.json 2>/dev/null || echo '[]' > /tmp/parsed_hf_spaces.json

# AFTER:
curl -s "https://huggingface.co/api/spaces?sort=trendingScore&limit=15&full=true" > /tmp/raw_hf_spaces.json
jq '[.[] | {
  title: .id,
  url: ("https://huggingface.co/spaces/" + .id),
  score: (.trendingScore // 0),
  source: "hf_spaces",
  summary: "",
  published_at: (.lastModified // null | if . then ((. | gsub("\\.[0-9]+Z$"; "Z") | fromdateiso8601?) // null) else null end)
}]' /tmp/raw_hf_spaces.json > /tmp/parsed_hf_spaces.json 2>/dev/null || echo '[]' > /tmp/parsed_hf_spaces.json
```

How the `gsub` works: `"2026-05-29T02:57:22.000Z"` → strip `.000Z` and replace with `Z` → `"2026-05-29T02:57:22Z"` → `fromdateiso8601?` parses to epoch. If the format is ever different (no fractional part), `gsub` is a no-op and parsing still works.

- [ ] **Step 3: Verify with a live mini-run**

```bash
curl -s "https://huggingface.co/api/spaces?sort=trendingScore&limit=5&full=true" > /tmp/raw_hf.json
jq '[.[] | {
  id, published_at: (.lastModified // null | if . then ((. | gsub("\\.[0-9]+Z$"; "Z") | fromdateiso8601?) // null) else null end)
}] | .[] | {id, published_at, age_hours: (if .published_at then ((now - .published_at) / 3600 | floor) else null end)}' /tmp/raw_hf.json
```
Expected: most items populated; `age_hours` typically 0-168 (some trending Spaces are older but recently updated).

- [ ] **Step 4: Commit**

```bash
git add news_fetcher_prompt.md
git commit -m "feat(fetcher): capture published_at for HF Spaces items

Use lastModified ISO timestamp (most meaningful for trending Spaces)."
```

---

## Task 6: Anthropic + GeekNews + GitHub — best-effort or null

**Files:**
- Modify: `news_fetcher_prompt.md` STEPs 3-4, 3-5, 3-7

- [ ] **Step 1: Edit Anthropic instruction (best-effort via WebFetch)**

In `news_fetcher_prompt.md` STEP 3-7 (line ~168). The actual paragraph in the file begins with a "Use WebFetch to read..." preamble (which sets the URL and 7-day filter — must be preserved). Only the latter half changes:

```markdown
# BEFORE (full paragraph as it exists in the file):
Use WebFetch to read https://www.anthropic.com/news and extract articles **published within the last 7 days only**. Each article links to a `/news/SLUG` URL and has a visible publication date on the page. Skip anything older than 7 days from today. Return as a JSON array and save to `/tmp/parsed_anthropic.json` with format `[{"title": "...", "url": "https://www.anthropic.com/news/SLUG", "score": 0, "source": "anthropic", "summary": "one-line description if visible"}]`. Print `anthropic: N items (last 7 days)`.

# AFTER (preamble preserved, latter half updated):
Use WebFetch to read https://www.anthropic.com/news and extract articles **published within the last 7 days only**. Each article links to a `/news/SLUG` URL and has a visible publication date on the page (e.g. "May 28, 2026"). Skip anything older than 7 days from today. Convert the visible publication date to a Unix epoch (seconds; use 00:00:00 UTC for the time component if only a date is shown). Return as a JSON array and save to `/tmp/parsed_anthropic.json` with format `[{"title": "...", "url": "https://www.anthropic.com/news/SLUG", "score": 0, "source": "anthropic", "summary": "one-line description if visible", "published_at": <epoch>}]`. If you cannot determine the date for a given item, set `published_at` to `null` (do not guess). Print `anthropic: N items (last 7 days)`.
```

- [ ] **Step 2: Edit GeekNews instruction (best-effort)**

In `news_fetcher_prompt.md` STEP 3-5 (line ~118):

```markdown
# BEFORE:
Use WebFetch to read https://news.hada.io and extract the top 15 stories. Each story has a title, external URL, and point score. Return them as a JSON array and save to `/tmp/parsed_geeknews.json` with format `[{"title": "...", "url": "...", "score": N, "source": "geeknews", "summary": ""}]`. Print `geeknews: N items`.

# AFTER:
Use WebFetch to read https://news.hada.io and extract the top 15 stories. Each story has a title, external URL, a point score, and a relative submission time (e.g. "5분전", "2시간전", "1일전"). Convert the relative time to a Unix epoch (e.g. "5분전" → `now - 300`, "2시간전" → `now - 7200`, "1일전" → `now - 86400`). If the unit is 주 (weeks) or 개월/달 (months), set `published_at` to `null` instead of computing — the recency rubric will treat these as moderately old, but anything that GeekNews surfaces as "weeks/months ago" is outside our 7-day fresh window anyway. Return them as a JSON array and save to `/tmp/parsed_geeknews.json` with format `[{"title": "...", "url": "...", "score": N, "source": "geeknews", "summary": "", "published_at": <epoch>}]`. If you cannot determine the relative time for an item, set `published_at` to `null`. Print `geeknews: N items`.
```

- [ ] **Step 3: Edit GitHub Trending instruction (always null)**

In `news_fetcher_prompt.md` STEP 3-4 (line ~114):

```markdown
# BEFORE:
Use WebFetch to read https://github.com/trending and extract the top 20 trending repositories. For each repo extract: the `owner/repo` name, description, and star count. Save to `/tmp/parsed_github.json` with format `[{"title": "owner/repo", "url": "https://github.com/owner/repo", "score": STARS, "source": "github", "summary": "description"}]`. Print `github: N items`.

# AFTER:
Use WebFetch to read https://github.com/trending and extract the top 20 trending repositories. For each repo extract: the `owner/repo` name, description, and star count. Save to `/tmp/parsed_github.json` with format `[{"title": "owner/repo", "url": "https://github.com/owner/repo", "score": STARS, "source": "github", "summary": "description", "published_at": null}]`. Note: GitHub Trending exposes no per-repo publication time; always set `published_at` to `null`. The curate prompt treats `null` as moderate freshness, which matches the semantics of "trending right now". Print `github: N items`.
```

- [ ] **Step 4: Verify these are best-effort — no live run needed**

These three are LLM-instructed (WebFetch + interpretation). We don't run them in isolation — the end-to-end run in Task 8 will exercise them. No verification step here beyond visual inspection of the diff.

Run:
```bash
git diff news_fetcher_prompt.md
```
Expected: three sections updated, GitHub always `null`, GeekNews/Anthropic gain epoch parsing instructions.

- [ ] **Step 5: Commit**

```bash
git add news_fetcher_prompt.md
git commit -m "feat(fetcher): add published_at instructions for Anthropic/GeekNews/GitHub

- Anthropic: parse visible publication date to epoch (best-effort, null on miss)
- GeekNews: parse relative time (\"2시간전\") to epoch (best-effort)
- GitHub Trending: always null (no per-item publish time available)"
```

---

## Task 7: Curate prompt — recency rubric + pool 30→50

**Files:**
- Modify: `news_curate_prompt.md` (lines 1, 17-20, 27-66, 125)

- [ ] **Step 1: Bump pool size in title**

Change line 1:
```markdown
# BEFORE:
# Curate top 30 AI news for vibe coders & AI builders

# AFTER:
# Curate top 50 AI news for vibe coders & AI builders
```

And line 3:
```markdown
# BEFORE:
Read all items from the latest news_cache and pick **top 30 that vibe coders and AI automation builders would actually care about**.

# AFTER:
Read all items from the latest news_cache and pick **top 50 that vibe coders and AI automation builders would actually care about**.
```

- [ ] **Step 2: Expose `published_at` and age in STEP 1 listing**

Change STEP 1 (lines 19-20):
```bash
# BEFORE:
# 인덱스 번호와 함께 출력 (선택 시 인덱스를 사용하기 위해)
jq -r 'to_entries[] | "[\(.key)] (\(.value.source)) \(.value.title)" + (if .value.summary and .value.summary != "" then "\n     > \(.value.summary[:150])" else "" end)' /tmp/all_items.json

# AFTER:
# 인덱스 번호와 함께 출력 (선택 시 인덱스를 사용하기 위해)
# age_h: 신선도(시간). published_at이 null이면 "?" 표시 → 큐레이트가 중립으로 취급.
NOW_EPOCH=$(date +%s)
jq -r --argjson now "$NOW_EPOCH" '
  to_entries[]
  | .key as $i
  | .value as $v
  | ($v.published_at // null) as $pa
  | (if $pa then (($now - $pa) / 3600 | floor | tostring + "h") else "?" end) as $age
  | "[\($i)] (\($v.source)) [age=\($age)] \($v.title)"
    + (if $v.summary and $v.summary != "" then "\n     > \($v.summary[:150])" else "" end)
' /tmp/all_items.json
```

- [ ] **Step 3: Add recency rubric to STEP 2**

In STEP 2, after the "신선도:" line (line 44), replace the existing 1-week cutoff line and expand. Find:

```markdown
**신선도:** 오래된 발표(1주일 이상 지난 것)는 제외. 제목이나 요약에서 출시/발표 날짜가 명확히 오래됐으면 스킵.
```

Replace with:

```markdown
**신선도 가중치 (CRITICAL):**

리스트에 각 아이템 옆에 `[age=Nh]` (또는 `[age=?]`) 가 붙어있다. 이게 1차 정렬 신호다.

- `age < 24h` → **부스트**. 동일 카테고리 내 경쟁자보다 우선.
- `24h ≤ age < 72h` → 중립.
- `72h ≤ age < 168h (7일)` → **디스카운트**. 더 신선한 대안이 있으면 그걸 선택.
- `age ≥ 168h (7일)` → **스킵**. 단, 정말 예외적으로 중요한 발표(예: 새 모델/메이저 가격 변동/대형 인수)만 살리고 그 외 제외.
- `age=?` (published_at null) → **중립** 취급. GitHub Trending이 대표적 — "지금 뜨고 있다"는 자체로 신호이므로 패널티 없음. 단, 동점일 때 시각 정보 있는 아이템을 우선.

**왜 중요한가:** 다운스트림 자동화가 며칠 전에 이미 소비한 아이템이 같은 풀에서 반복 등장하면 결과가 빈약해진다. age 기반 weighting이 이 회전을 강제한다.
```

- [ ] **Step 4: Update STEP 2 quotas to reflect pool size 50**

In STEP 2, the "소스 다양성" section (lines 53-62), change per-source caps and minimums proportionally (50/30 = 1.67x):

```markdown
# BEFORE:
**소스 다양성:**
- 한 소스(서브레딧 포함)에서 max 3개
- **reddit_* 전체 합산 max 6개** (서브레딧이 여러 개여도 reddit 총합 6개 넘지 말 것)
- show_hn 소스 전부 제외
- i.redd.it / v.redd.it URL이 있는 항목도 제외 (이미지/동영상만 있는 포스트)
- **최소 할당량 (반드시 포함):**
  - github: 최소 2개 — GitHub Trending 레포는 "오늘 당장 설치해볼 수 있는 도구"라서 바이브코더한테 핵심. 요약이 있는 레포 우선
  - geeknews: 최소 1개
  - hackernews: 최소 2개

# AFTER:
**소스 다양성 (풀 50 기준):**
- 한 소스(서브레딧 포함)에서 max 5개
- **reddit_* 전체 합산 max 10개** (서브레딧이 여러 개여도 reddit 총합 10개 넘지 말 것)
- show_hn 소스 전부 제외
- i.redd.it / v.redd.it URL이 있는 항목도 제외 (이미지/동영상만 있는 포스트)
- **최소 할당량 (반드시 포함):**
  - github: 최소 4개 — GitHub Trending 레포는 "오늘 당장 설치해볼 수 있는 도구"라서 바이브코더한테 핵심. 요약이 있는 레포 우선
  - geeknews: 최소 2개
  - hackernews: 최소 3개
```

- [ ] **Step 5: Update the example index count in STEP 2 and STEP 3**

STEP 2 (line 64-66) — the placeholder example currently shows ~10 indices; bump to look like 50:

```markdown
# BEFORE:
선택이 끝나면 선택한 인덱스를 공백으로 구분해서 출력:
```
SELECTED_INDICES: 3 7 12 15 21 25 30 42 55 61 ...
```

# AFTER:
선택이 끝나면 선택한 인덱스를 공백으로 구분해서 출력 (정확히 50개):
```
SELECTED_INDICES: 3 7 12 15 21 25 30 42 55 61 ... (총 50개)
```
```

STEP 3 (line 74) — same placeholder issue:

```bash
# BEFORE:
INDICES="3 7 12 15 21 25 30 42 55 61"  # ← STEP 2 결과로 교체

# AFTER:
INDICES="3 7 12 15 21 25 30 42 55 61 ..."  # ← STEP 2 결과 50개로 교체
```

- [ ] **Step 6: Update final print message**

Line 125:
```python
# BEFORE:
Print "Curated: N items saved to news_curated."

# AFTER:
Print "Curated: N items saved to news_curated." (Expected: 50.)
```

- [ ] **Step 7: Diff review**

Run:
```bash
git diff news_curate_prompt.md
```
Expected changes confined to: title, intro, STEP 1 display, STEP 2 freshness + quotas + index placeholder, STEP 3 placeholder, final print line.

- [ ] **Step 8: Commit**

```bash
git add news_curate_prompt.md
git commit -m "feat(curate): recency weighting + pool 30→50

- Display each item with [age=Nh] (computed from published_at).
- Add explicit rubric: <24h boost, 24-72h neutral, 72-168h discount,
  >168h skip-unless-exceptional, age=? neutral.
- Bump pool 30→50 to absorb downstream consumption.
- Scale per-source caps and minimums by ~1.67x.

B+C in the A+B+C plan."
```

---

## Task 8: End-to-end verification run

**Files:** none (live pipeline run)

- [ ] **Step 1: Sanity check — diff summary**

Run:
```bash
git log --oneline main..HEAD
git diff main --stat
```
Expected: ~7 commits, two files modified (`news_fetcher_prompt.md`, `news_curate_prompt.md`).

- [ ] **Step 2: Run the full pipeline once**

```bash
cd /Users/potenlab/potenlab/scheduled_task/ai-news-mcp
nohup bash run_news_fetcher.sh >/dev/null 2>&1 &
echo "started pid $!"
```

Wait for both stages. Monitor:
```bash
tail -f news_fetcher.log
```
Expected: scrape completes with item counts per source; curate logs `Curated: 50 items saved to news_curated.`

- [ ] **Step 3: Verify `published_at` populated in `news_cache`**

```bash
export $(grep -v '^#' .env | xargs) 2>/dev/null
curl -s "${SUPABASE_URL}/rest/v1/news_cache?select=data&order=created_at.desc&limit=1" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  | jq -r '
    .[0].data
    | (if type=="object" then (.items // []) else . end)
    | group_by(.source)
    | map({
        source: .[0].source,
        total: length,
        with_ts: ([.[] | select(.published_at != null)] | length)
      })
  '
```
Expected: HN, Reddit (all 6), Lobsters, OpenAI, HF Spaces show `total == with_ts` (or very close). GitHub Trending shows `with_ts: 0` (by design). Anthropic and GeekNews best-effort (mostly populated).

- [ ] **Step 4: Verify `news_curated` has 50 items**

```bash
curl -s -I "${SUPABASE_URL}/rest/v1/news_curated?select=id" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Prefer: count=exact" 2>/dev/null | grep -i content-range
```
Expected: `content-range: 0-49/50`.

- [ ] **Step 5: Sanity check — recency ranking actually applied**

```bash
curl -s "${SUPABASE_URL}/rest/v1/news_curated?select=source,title,url&order=id.asc&limit=50" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  | jq -r 'to_entries[] | "\(.key+1). [\(.value.source)] \(.value.title)"' | head -20
```
Expected: visually inspect — no 7+ day old Anthropic/OpenAI announcements should dominate the top. If something obviously stale (e.g. "Anthropic acquires Stainless" from 5/22) shows up high, the curate LLM ignored the rubric — go back and strengthen the prompt wording.

- [ ] **Step 6: If verification fails, debug, don't commit forward**

If Step 3 shows missing timestamps for sources that should have them (HN/Reddit/Lobsters/OpenAI/HF), the prompt edit didn't take — re-read the relevant section and re-fix. If Step 5 shows stale items dominating, sharpen the freshness rubric in Task 7 Step 3 (e.g., add explicit examples: "Anthropic 'Stainless acquisition' from 11 days ago must NOT be picked").

- [ ] **Step 7: If verification passes, push**

```bash
git push origin main
```

(No PR — solo project on main, per existing commit pattern.)

---

## Optional Task 9: Persist `published_at` to `news_curated` (deferred)

**Skip unless downstream consumers (blog automations) want to display "1h ago" timestamps.**

**Files:**
- Schema: `news_curated` table — `ALTER TABLE news_curated ADD COLUMN published_at bigint`
- Modify: `news_curate_prompt.md` STEP 3 jq extraction

- [ ] **Step 1: Add column via Supabase SQL editor**

```sql
ALTER TABLE news_curated ADD COLUMN published_at bigint;
```

- [ ] **Step 2: Update STEP 3 to carry `published_at` through**

The jq slice on line 78 already copies the entire item by index, so `published_at` is preserved automatically. The summary-update jq on line 100 only touches `.summary`, so other fields including `published_at` survive. **No edit needed.** Verify by re-running pipeline and checking:

```bash
curl -s "${SUPABASE_URL}/rest/v1/news_curated?select=published_at&order=id.asc&limit=5" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```
Expected: 5 rows, most with epoch ints (some null for GitHub).

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "feat(curated): expose published_at to downstream

Schema change applied directly via Supabase SQL editor (see plan).
news_curate_prompt.md needed no edits — the jq pipeline already
carries the field through."
```

---

## Self-Review Notes

**Spec coverage check:**
- A (timestamps on items): Tasks 1-6 cover all 8 sources.
- B (recency weighting in curate): Task 7 Steps 2-3.
- C (pool 30→50): Task 7 Steps 1, 4, 5, 6.
- E2E verification: Task 8.
- Downstream persistence: Task 9 (optional).

**Placeholder scan:** No "TBD", "implement later", or "similar to Task N" patterns. Every code/text change is shown in full.

**Type consistency:** Field is uniformly `published_at` (snake_case) and uniformly Unix epoch seconds (integer) or `null` across all sources, curate display, and downstream persistence.

**Known limitations documented inline:**
- GitHub Trending will always have `null` — by design.
- GeekNews/Anthropic depend on LLM-interpreting WebFetch output — accepted as best-effort.
- OpenAI Python block has minor non-DRY (re-parses pubDate inside try block) — kept minimal, called out.
