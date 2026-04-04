# Curate top 20 AI news for vibe coders & AI builders

Read all items from the latest news_cache and pick **top 20 that vibe coders and AI automation builders would actually care about**. NOT for researchers. NOT for security experts. For people who BUILD with AI every day.

## Environment Variables
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — service role key

## STEP 1: Fetch all items from cache

```bash
ITEMS=$(curl -s "${SUPABASE_URL}/rest/v1/news_cache?order=created_at.desc&limit=1&select=data" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" | jq -r '.[0].data.items')
echo "$ITEMS" | jq 'length'
echo "$ITEMS" | jq -r 'group_by(.source) | .[] | "--- \(.[0].source) ---", (.[] | "  \(.title)" + (if .summary and .summary != "" then "\n    > \(.summary[:150])" else "" end)), ""'
```

Review ALL items grouped by source. Each item has a `summary` field with actual content description from WebFetch. **Judge by summary content, not by title or score.** A GeekNews post with a rich summary about Claude Code features is MORE valuable than a high-score Reddit post with an empty summary.

Items with empty summary = content was garbage or inaccessible → skip them.

## STEP 2: Select top 20

**타겟 독자: 바이브코더 & AI 자동화 빌더.**

이 사람들한테 중요한 것:
- 새 도구, 새 모델, 새 워크플로우 — 내일 당장 써볼 수 있는 것
- 비용 절약, 생산성 향상 팁
- 업계 변화 (가격, API, 인수) — 내 스택에 영향 주는 것
- 커뮤니티에서 공유하는 실전 노하우

이 사람들한테 중요하지 않은 것:
- "AI가 내 데이터 날렸다" 공포 이야기 — 드라마지 뉴스가 아님
- "AI가 무섭다/싫다" 감정 토론
- 구독 불만, 사용량 제한 rant
- 순수 연구 논문
- 개인 프로덕트 광고

**핵심 필터: "이걸 읽고 뭘 할 수 있나?"**
- 새 도구를 써볼 수 있다 → ✅
- 워크플로우를 바꿀 수 있다 → ✅
- 비용을 줄일 수 있다 → ✅
- 새 모델을 테스트할 수 있다 → ✅
- 그냥 "와 무섭다/웃기다"로 끝나면 → ❌

**소스 다양성:** 한 소스에서 max 3개. 모든 소스에서 최소 1개씩 포함 시도. i.redd.it 이미지 URL → Reddit permalink로 대체.

**show_hn 소스는 전부 제외.**

For each item: 1-line English summary — **what can I DO with this?**

## STEP 3: Save to news_curated

```bash
# Clear old curated items
curl -s -X DELETE "${SUPABASE_URL}/rest/v1/news_curated?id=gt.0" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"

# Build JSON array and save to file
cat > /tmp/curated.json << 'CURATED_EOF'
[
  {"title": "...", "url": "...", "source": "...", "score": 123, "summary": "Why it matters..."},
  ...
]
CURATED_EOF

# Safety filter: remove excluded sources
jq '[.[] | select(.source != "show_hn" and .source != "openai")]' /tmp/curated.json > /tmp/curated_filtered.json
mv /tmp/curated_filtered.json /tmp/curated.json

curl -s -X POST "${SUPABASE_URL}/rest/v1/news_curated" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d @/tmp/curated.json
```

Print "Curated: N items saved to news_curated."
