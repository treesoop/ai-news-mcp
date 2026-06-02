You are a real-time tech news aggregator. Your job: fetch trending AI/tech news from multiple sources and save to Supabase.

## Environment Variables
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — service role key

## STEP 1: Get current 30-min window cache key

```bash
DATE=$(date -u +%Y-%m-%d)
HOUR=$(date -u +%H)
MINUTE=$(date -u +%M)
# Round down to nearest 30: 00~29 → "00", 30~59 → "30"
if [ "$MINUTE" -lt 30 ]; then
  SLOT="00"
else
  SLOT="30"
fi
CACHE_KEY="${DATE}_${HOUR}${SLOT}"
echo "Cache key: $CACHE_KEY"
```

## STEP 2: Check if cache already exists

```bash
curl -s "${SUPABASE_URL}/rest/v1/news_cache?cache_key=eq.${CACHE_KEY}&select=cache_key,created_at" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

If the response contains data (not `[]`), cache already exists for this hour. Print "Cache hit, skipping fetch." and **skip to STEP 6** (curation must always run).

## STEP 3: Fetch news from all sources

Use WebFetch to fetch from each source. Collect as many items as possible.

### 3-1. HackerNews (top 20)

Use Bash (NOT WebFetch) to fetch and parse HackerNews. This avoids hallucinating IDs.

```bash
# Get top 20 story IDs
HN_IDS=$(curl -s "https://hacker-news.firebaseio.com/v0/topstories.json" | jq -r '.[:20][]')

# Fetch each item and filter: only type=="story", must have title
# NOTE: use `while read` + here-string, NOT `for id in $HN_IDS`.
# This script runs under zsh, which does NOT word-split unquoted variables,
# so `for id in $HN_IDS` would loop once with all 20 IDs as a single string.
# Here-string keeps the loop in the current shell so $HN_ITEMS accumulates.
HN_ITEMS="[]"
while IFS= read -r id; do
  [ -z "$id" ] && continue
  item=$(curl -s "https://hacker-news.firebaseio.com/v0/item/${id}.json")
  type=$(echo "$item" | jq -r '.type // "unknown"')
  title=$(echo "$item" | jq -r '.title // ""')
  if [ "$type" = "story" ] && [ -n "$title" ] && [ "$title" != "null" ]; then
    url=$(echo "$item" | jq -r '.url // ""')
    score=$(echo "$item" | jq -r '.score // 0')
    # If no external URL, use HN permalink (with ACTUAL id from JSON, not loop variable)
    actual_id=$(echo "$item" | jq -r '.id')
    if [ -z "$url" ] || [ "$url" = "null" ]; then
      url="https://news.ycombinator.com/item?id=${actual_id}"
    fi
    hn_time=$(echo "$item" | jq -r '.time // empty')
    entry=$(jq -n --arg t "$title" --arg u "$url" --argjson s "$score" \
      --argjson pa "${hn_time:-null}" \
      '{"title":$t,"url":$u,"score":$s,"source":"hackernews","published_at":$pa}')
    HN_ITEMS=$(echo "$HN_ITEMS" | jq --argjson e "$entry" '. += [$e]')
  fi
done <<< "$HN_IDS"
echo "HN items: $(echo "$HN_ITEMS" | jq length)"
echo "$HN_ITEMS" | jq -r '.[] | "  [\(.score)] \(.title)"'
```

Save `$HN_ITEMS` for the final JSON assembly in STEP 5.

### 3-2. Reddit (use Bash curl — WebFetch is blocked by Reddit)

**⚠️ 반드시 jq로 파싱해서 즉시 파일로 저장. URL을 기억해서 나중에 타이핑하지 말 것.**

```bash
REDDIT_UA="ai-news-mcp/1.0 (public news aggregator; contact: official@treesoop.com)"

# 각 subreddit 원본 저장
curl -s "https://www.reddit.com/r/artificial/hot.json?limit=10"  -H "User-Agent: $REDDIT_UA" > /tmp/raw_reddit_artificial.json
curl -s "https://www.reddit.com/r/ClaudeAI/hot.json?limit=15"   -H "User-Agent: $REDDIT_UA" > /tmp/raw_reddit_claudeai.json
curl -s "https://www.reddit.com/r/vibecoding/hot.json?limit=10" -H "User-Agent: $REDDIT_UA" > /tmp/raw_reddit_vibecoding.json
curl -s "https://www.reddit.com/r/codex/hot.json?limit=10"      -H "User-Agent: $REDDIT_UA" > /tmp/raw_reddit_codex.json
curl -s "https://www.reddit.com/r/claudecode/hot.json?limit=10" -H "User-Agent: $REDDIT_UA" > /tmp/raw_reddit_claudecode.json
curl -s "https://www.reddit.com/r/openclaw/hot.json?limit=10"   -H "User-Agent: $REDDIT_UA" > /tmp/raw_reddit_openclaw.json

# jq로 파싱 → 즉시 parsed 파일 저장 (URL은 원본 JSON에서 추출)
for sub in artificial claudeai vibecoding codex claudecode openclaw; do
  src="reddit_${sub}"
  jq --arg src "$src" '[.data.children[].data | {
    title,
    score,
    url: (if .is_self then ("https://reddit.com" + .permalink) else .url end),
    summary: (.selftext[:200] // ""),
    source: $src,
    published_at: (.created_utc // null | if . then (. | floor) else null end)
  }]' /tmp/raw_reddit_${sub}.json > /tmp/parsed_reddit_${sub}.json 2>/dev/null || echo '[]' > /tmp/parsed_reddit_${sub}.json
  echo "$src: $(jq length /tmp/parsed_reddit_${sub}.json) items"
done
```

### 3-3. Lobsters

```bash
curl -s "https://lobste.rs/hottest.json" > /tmp/raw_lobsters.json
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
echo "lobsters: $(jq length /tmp/parsed_lobsters.json) items"
```

### 3-4. GitHub Trending

Use WebFetch to read https://github.com/trending and extract the top 20 trending repositories. For each repo extract: the `owner/repo` name, description, and star count. Save to `/tmp/parsed_github.json` with format `[{"title": "owner/repo", "url": "https://github.com/owner/repo", "score": STARS, "source": "github", "summary": "description", "published_at": null}]`. Note: GitHub Trending exposes no per-repo publication time; always set `published_at` to `null`. The curate prompt treats `null` as moderate freshness, which matches the semantics of "trending right now". Print `github: N items`.

### 3-5. GeekNews

Use WebFetch to read https://news.hada.io and extract the top 15 stories. Each story has a title, external URL, a point score, and a relative submission time (e.g. "5분전", "2시간전", "1일전"). Convert the relative time to a Unix epoch (e.g. "2시간전" → `now - 7200`, "1일전" → `now - 86400`). Return them as a JSON array and save to `/tmp/parsed_geeknews.json` with format `[{"title": "...", "url": "...", "score": N, "source": "geeknews", "summary": "", "published_at": <epoch>}]`. If you cannot determine the relative time for an item, set `published_at` to `null`. Print `geeknews: N items`.

### 3-6. OpenAI News (RSS)

```bash
# OpenAI blocks HTML scraping with Cloudflare — use RSS feed instead
curl -sL "https://openai.com/blog/rss.xml" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  -H "Accept: application/rss+xml, text/xml" > /tmp/raw_openai_rss.xml
python3 - << 'PYEOF'
import re, json
from datetime import datetime, timezone, timedelta
xml = open('/tmp/raw_openai_rss.xml').read()
SKIP_CATS = {'OpenAI Academy', 'B2B Story', 'Brand Story', 'Guides', 'Webinar', 'Startup'}
cutoff = datetime.now(timezone.utc) - timedelta(days=7)
items_raw = re.findall(r'<item>([\s\S]*?)</item>', xml)
items = []
for item in items_raw:
    title_m = re.search(r'<title><!\[CDATA\[(.*?)\]\]>', item) or re.search(r'<title>(.*?)</title>', item)
    link_m = re.search(r'<link>(.*?)</link>', item)
    desc_m = re.search(r'<description><!\[CDATA\[(.*?)\]\]>', item)
    cat_m = re.search(r'<category><!\[CDATA\[(.*?)\]\]>', item)
    pub_m = re.search(r'<pubDate>(.*?)</pubDate>', item)
    if not title_m or not link_m:
        continue
    cat = cat_m.group(1) if cat_m else ''
    if cat in SKIP_CATS:
        continue
    # Date filter: skip items older than 7 days
    if pub_m:
        try:
            from email.utils import parsedate_to_datetime
            pub_date = parsedate_to_datetime(pub_m.group(1).strip())
            if pub_date < cutoff:
                continue
        except Exception:
            pass
    title = title_m.group(1).strip()
    url = link_m.group(1).strip()
    summary = re.sub(r'<[^>]+>', '', desc_m.group(1)).strip()[:200] if desc_m else ''
    published_at = None
    if pub_m:
        try:
            from email.utils import parsedate_to_datetime
            pd = parsedate_to_datetime(pub_m.group(1).strip())
            published_at = int(pd.timestamp())
        except Exception:
            pass
    items.append({'title': title, 'url': url, 'score': 0, 'source': 'openai', 'summary': summary, 'published_at': published_at})
    if len(items) >= 15:
        break
json.dump(items, open('/tmp/parsed_openai.json', 'w'))
print(f"openai: {len(items)} items (last 7 days)")
PYEOF
```

### 3-7. Anthropic (Claude Official) News

Use WebFetch to read https://www.anthropic.com/news and extract articles **published within the last 7 days only**. Each article links to a `/news/SLUG` URL and has a visible publication date on the page (e.g. "May 28, 2026"). Skip anything older than 7 days from today. Convert the visible publication date to a Unix epoch (seconds, UTC midnight is fine if only the date is shown). Return as a JSON array and save to `/tmp/parsed_anthropic.json` with format `[{"title": "...", "url": "https://www.anthropic.com/news/SLUG", "score": 0, "source": "anthropic", "summary": "one-line description if visible", "published_at": <epoch>}]`. If you cannot determine the date for a given item, set `published_at` to `null` (do not guess). Print `anthropic: N items (last 7 days)`.

### 3-8. Hugging Face Spaces Trending

```bash
curl -s "https://huggingface.co/api/spaces?sort=trendingScore&limit=15&full=true" > /tmp/raw_hf_spaces.json
jq '[.[] | {
  title: .id,
  url: ("https://huggingface.co/spaces/" + .id),
  score: (.trendingScore // 0),
  source: "hf_spaces",
  summary: "",
  published_at: (.lastModified // null | if . then ((. | gsub("\\.[0-9]+Z$"; "Z") | fromdateiso8601?) // null) else null end)
}]' /tmp/raw_hf_spaces.json > /tmp/parsed_hf_spaces.json 2>/dev/null || echo '[]' > /tmp/parsed_hf_spaces.json
echo "hf_spaces: $(jq length /tmp/parsed_hf_spaces.json) items"
```

If any source fails, skip it and continue.

## STEP 4: Merge all sources + add summaries

### 4-1. 모든 parsed 파일을 하나로 합치기

**⚠️ URL을 직접 타이핑하지 말 것. jq로 파일에서 읽어서 합칠 것.**

```bash
# 존재하는 parsed 파일만 합치기
jq -s 'add // []' \
  /tmp/parsed_hn.json \
  /tmp/parsed_reddit_artificial.json \
  /tmp/parsed_reddit_claudeai.json \
  /tmp/parsed_reddit_vibecoding.json \
  /tmp/parsed_reddit_codex.json \
  /tmp/parsed_reddit_claudecode.json \
  /tmp/parsed_reddit_openclaw.json \
  /tmp/parsed_lobsters.json \
  /tmp/parsed_github.json \
  /tmp/parsed_geeknews.json \
  /tmp/parsed_hf_spaces.json \
  /tmp/parsed_openai.json \
  /tmp/parsed_anthropic.json \
  2>/dev/null > /tmp/all_items_merged.json

echo "Total merged: $(jq length /tmp/all_items_merged.json) items"
jq -r 'group_by(.source)[] | "  \(.[0].source): \(length)"' /tmp/all_items_merged.json
```

**Note**: HN items were saved to `$HN_ITEMS` variable. Save to file first:
```bash
echo "$HN_ITEMS" > /tmp/parsed_hn.json
```
Run the merge command above after saving.

### 4-2. URL summary cache 로드

```bash
CACHE_FILE="/Users/potenlab/potenlab/scheduled_task/ai-news-mcp/cache/url_summaries.json"
if [ -f "$CACHE_FILE" ]; then
  CUTOFF=$(date -v-3d +%s 2>/dev/null || date -d '3 days ago' +%s)
  jq --arg cutoff "$CUTOFF" '[.[] | select((.ts // 0) > ($cutoff | tonumber))]' "$CACHE_FILE" > "${CACHE_FILE}.tmp" && mv "${CACHE_FILE}.tmp" "$CACHE_FILE"
  echo "캐시 로드: $(jq length "$CACHE_FILE")개"
else
  echo '[]' > "$CACHE_FILE"
fi
```

### 4-3. Summary 채우기 (MANDATORY — 스킵 금지)

**⚠️ 이 단계는 절대 스킵하지 말 것. hackernews/lobsters/hf_spaces는 이 단계 없으면 summary가 빈 채로 저장돼서 curate에서 전부 버려짐.**

#### 4-3-1. Summary 필요한 URL 리스트 만들기 (deterministic)

```bash
# 캐시에 있는 URL 집합
jq -r '.[].url' "$CACHE_FILE" | sort -u > /tmp/cached_urls.txt

# top 10 per source, summary 비어있고, 캐시에도 없고, 미디어 URL 아닌 것
jq -r '
  group_by(.source)
  | map(sort_by(-(.score // 0))[:10])
  | flatten
  | .[]
  | select((.summary // "") == "")
  | select((.url | test("i\\.redd\\.it|v\\.redd\\.it|imgur|reddit\\.com/gallery|\\.(jpg|jpeg|png|gif|mp4|webm)$")) | not)
  | .url
' /tmp/all_items_merged.json | sort -u > /tmp/needs_fetch_raw.txt

# 캐시 히트 먼저 적용 (WebFetch 하기 전에)
comm -23 /tmp/needs_fetch_raw.txt /tmp/cached_urls.txt > /tmp/needs_webfetch.txt

# 캐시 히트 URL은 바로 summary 복사
comm -12 /tmp/needs_fetch_raw.txt /tmp/cached_urls.txt > /tmp/cache_hits.txt
while IFS= read -r url; do
  [ -z "$url" ] && continue
  summary=$(jq -r --arg u "$url" '.[] | select(.url == $u) | .summary' "$CACHE_FILE" | head -1)
  [ -z "$summary" ] && continue
  jq --arg u "$url" --arg s "$summary" \
    'map(if .url == $u then .summary = $s else . end)' \
    /tmp/all_items_merged.json > /tmp/merged.tmp && mv /tmp/merged.tmp /tmp/all_items_merged.json
done < /tmp/cache_hits.txt

echo "=== Summary fetch plan ==="
echo "Cache hits applied: $(wc -l < /tmp/cache_hits.txt | tr -d ' ')"
echo "Need WebFetch: $(wc -l < /tmp/needs_webfetch.txt | tr -d ' ')"
echo ""
echo "=== URLs to WebFetch (MANDATORY — do ALL of them) ==="
cat /tmp/needs_webfetch.txt
```

#### 4-3-2. Helper 함수 정의

```bash
add_summary() {
  local url="$1"
  local summary="$2"
  local ts=$(date +%s)
  jq --arg u "$url" --arg s "$summary" \
    'map(if .url == $u then .summary = $s else . end)' \
    /tmp/all_items_merged.json > /tmp/merged.tmp && mv /tmp/merged.tmp /tmp/all_items_merged.json
  jq --arg u "$url" --arg s "$summary" --argjson ts "$ts" \
    '. += [{url: $u, summary: $s, ts: $ts}]' \
    "$CACHE_FILE" > "${CACHE_FILE}.tmp" && mv "${CACHE_FILE}.tmp" "$CACHE_FILE"
}
```

#### 4-3-3. 각 URL에 대해 WebFetch 실행

**`/tmp/needs_webfetch.txt`에 있는 URL을 전부 WebFetch 해. 예외 없음.**

각 URL마다:
1. WebFetch로 페이지 내용 읽기 (prompt: `"Extract the main content. What is this article/repo/tool about? Be concrete."`)
2. 그 내용으로 1줄 요약 작성 (최대 150자, 영어, "what can I DO with this?" 관점)
3. `add_summary "<url>" "<summary>"` 실행

**⚠️ URL을 직접 타이핑하지 말 것 — `/tmp/needs_webfetch.txt`에서 복사해서 사용.**
**⚠️ WebFetch가 404/block/timeout이면 summary = "" 로 두고 다음 URL로 넘어가. 에러 시 `add_summary "<url>" ""` 호출해서 캐시에 빈 값 저장(반복 fetch 방지).**

#### 4-3-4. 검증

```bash
# top 10 per source 중에서 여전히 summary 비어있는 non-media 아이템 개수
jq '
  group_by(.source)
  | map(sort_by(-(.score // 0))[:10])
  | flatten
  | map(select(
      (.summary // "") == ""
      and ((.url | test("i\\.redd\\.it|v\\.redd\\.it|imgur|reddit\\.com/gallery|\\.(jpg|jpeg|png|gif|mp4|webm)$")) | not)
    ))
  | group_by(.source)
  | map({source: .[0].source, missing: length})
' /tmp/all_items_merged.json
```

위 출력에서 `missing` 수가 많으면 (>3) WebFetch를 더 돌려. hackernews/lobsters/hf_spaces가 특히 중요.

## STEP 5: Build and save to Supabase

```bash
# all_items_merged.json이 최종본 (summary 업데이트 완료)
cp /tmp/all_items_merged.json /tmp/news_items.json

# Build payload with jq
PAYLOAD=$(jq -n \
  --arg key "$CACHE_KEY" \
  --slurpfile items /tmp/news_items.json \
  '{
    cache_key: $key,
    data: {
      items: $items[0],
      fetched_at: (now | todate),
      total: ($items[0] | length)
    }
  }')

# Upsert to Supabase
curl -s -X POST "${SUPABASE_URL}/rest/v1/news_cache" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=representation" \
  -d "$PAYLOAD"
```

Verify the response contains `cache_key`. Print "Saved: N items from X sources."

## STEP 6: Clean up old cache (keep last 48 hours only)

```bash
CUTOFF=$(date -u -v-48H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '48 hours ago' +%Y-%m-%dT%H:%M:%SZ)

curl -s -X DELETE "${SUPABASE_URL}/rest/v1/news_cache?created_at=lt.${CUTOFF}" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

## IMPORTANT
- If a source fails to fetch, skip it (don't crash)
- Always check cache before fetching (step 2)
- Today's UTC time: use `date -u` command
- Curation (STEP 6) is handled by a separate process — do NOT curate here.
