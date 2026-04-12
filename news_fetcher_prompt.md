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
HN_ITEMS="[]"
for id in $HN_IDS; do
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
    entry=$(jq -n --arg t "$title" --arg u "$url" --argjson s "$score" \
      '{"title":$t,"url":$u,"score":$s,"source":"hackernews"}')
    HN_ITEMS=$(echo "$HN_ITEMS" | jq --argjson e "$entry" '. += [$e]')
  fi
done
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
    source: $src
  }]' /tmp/raw_reddit_${sub}.json > /tmp/parsed_reddit_${sub}.json 2>/dev/null || echo '[]' > /tmp/parsed_reddit_${sub}.json
  echo "$src: $(jq length /tmp/parsed_reddit_${sub}.json) items"
done
```

### 3-3. Lobsters

```bash
curl -s "https://lobste.rs/hottest.json" > /tmp/raw_lobsters.json
jq '[.[:25][] | {title, url, score, source: "lobsters", summary: ""}]' /tmp/raw_lobsters.json > /tmp/parsed_lobsters.json 2>/dev/null || echo '[]' > /tmp/parsed_lobsters.json
echo "lobsters: $(jq length /tmp/parsed_lobsters.json) items"
```

### 3-4. GitHub Trending

Use WebFetch to read https://github.com/trending and extract the top 20 trending repositories. For each repo extract: the `owner/repo` name, description, and star count. Save to `/tmp/parsed_github.json` with format `[{"title": "owner/repo", "url": "https://github.com/owner/repo", "score": STARS, "source": "github", "summary": "description"}]`. Print `github: N items`.

### 3-5. GeekNews

Use WebFetch to read https://news.hada.io and extract the top 15 stories. Each story has a title, external URL, and point score. Return them as a JSON array and save to `/tmp/parsed_geeknews.json` with format `[{"title": "...", "url": "...", "score": N, "source": "geeknews", "summary": ""}]`. Print `geeknews: N items`.

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
    items.append({'title': title, 'url': url, 'score': 0, 'source': 'openai', 'summary': summary})
    if len(items) >= 15:
        break
json.dump(items, open('/tmp/parsed_openai.json', 'w'))
print(f"openai: {len(items)} items (last 7 days)")
PYEOF
```

### 3-7. Anthropic (Claude Official) News

Use WebFetch to read https://www.anthropic.com/news and extract articles **published within the last 7 days only**. Each article links to a `/news/SLUG` URL and has a visible publication date on the page. Skip anything older than 7 days from today. Return as a JSON array and save to `/tmp/parsed_anthropic.json` with format `[{"title": "...", "url": "https://www.anthropic.com/news/SLUG", "score": 0, "source": "anthropic", "summary": "one-line description if visible"}]`. Print `anthropic: N items (last 7 days)`.

### 3-8. Hugging Face Spaces Trending

```bash
curl -s "https://huggingface.co/api/spaces?sort=trendingScore&limit=15" > /tmp/raw_hf_spaces.json
jq '[.[] | {title: .id, url: ("https://huggingface.co/spaces/" + .id), score: (.trendingScore // 0), source: "hf_spaces", summary: ""}]' /tmp/raw_hf_spaces.json > /tmp/parsed_hf_spaces.json 2>/dev/null || echo '[]' > /tmp/parsed_hf_spaces.json
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

### 4-3. 각 소스 top 10 선택 후 WebFetch (summary 없는 것만)

For each source in the merged file, pick top 10 by score. For items without a summary:
- Skip: i.redd.it / v.redd.it / imgur / reddit.com/gallery/ → summary = ""
- Check url_summaries.json cache first
- WebFetch if not cached → write 1-line summary (max 150 chars, "what can I DO with this?")
- Save to cache: `jq '. += [{"url": URL, "summary": SUMMARY, "ts": NOW_EPOCH}]' "$CACHE_FILE" > tmp && mv tmp "$CACHE_FILE"`

**⚠️ summary 저장 시 URL은 `jq`로 원본 항목에서 읽을 것. URL을 직접 타이핑하지 말 것.**

After updating summaries, write the final items back to file:
```bash
# summary 업데이트는 jq로 원본 파일 수정 (URL 불변)
# 예: jq --arg url "..." --arg s "..." 'map(if .url == $url then .summary = $s else . end)' /tmp/all_items_merged.json > /tmp/news_items.json
```

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
