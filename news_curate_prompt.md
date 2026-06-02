# Curate top 50 AI news for vibe coders & AI builders

Read all items from the latest news_cache and pick **top 50 that vibe coders and AI automation builders would actually care about**. NOT for researchers. NOT for security experts. For people who BUILD with AI every day.

## Environment Variables
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — service role key

## STEP 1: Fetch all items from cache — save to file

```bash
curl -s "${SUPABASE_URL}/rest/v1/news_cache?order=created_at.desc&limit=1&select=data" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  | jq '.[0].data.items' > /tmp/all_items.json

jq 'length' /tmp/all_items.json

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

Review ALL items. Each item is shown with its **index number** `[N]`.
**Judge by summary content, not by title or score.**
Items with empty summary = content was garbage or inaccessible → skip them.

## STEP 2: Select top 30 — output index numbers ONLY

**타겟 독자: 바이브코더 & AI 자동화 빌더.**

이 사람들한테 중요한 것:
- 새 도구, 새 모델, 새 워크플로우 — 내일 당장 써볼 수 있는 것
- 비용 절약, 생산성 향상 팁
- 업계 변화 (가격, API, 인수) — 내 스택에 영향 주는 것
- 커뮤니티에서 공유하는 실전 노하우

이 사람들한테 중요하지 않은 것:
- "AI가 내 데이터 날렸다" 공포 이야기
- "AI가 무섭다/싫다" 감정 토론
- 구독 불만, 사용량 제한 rant
- 순수 연구 논문
- 개인 프로덕트 광고

**신선도 가중치 (CRITICAL):**

리스트에 각 아이템 옆에 `[age=Nh]` (또는 `[age=?]`) 가 붙어있다. 이게 1차 정렬 신호다.

- `age < 24h` → **부스트**. 동일 카테고리 내 경쟁자보다 우선.
- `24h ≤ age < 72h` → 중립.
- `72h ≤ age < 168h (7일)` → **디스카운트**. 더 신선한 대안이 있으면 그걸 선택.
- `age ≥ 168h (7일)` → **스킵**. 단, 정말 예외적으로 중요한 발표(예: 새 모델/메이저 가격 변동/대형 인수)만 살리고 그 외 제외.
- `age=?` (published_at null) → **중립** 취급. GitHub Trending이 대표적 — "지금 뜨고 있다"는 자체로 신호이므로 패널티 없음. 단, 동점일 때 시각 정보 있는 아이템을 우선.

**왜 중요한가:** 다운스트림 자동화가 며칠 전에 이미 소비한 아이템이 같은 풀에서 반복 등장하면 결과가 빈약해진다. age 기반 weighting이 이 회전을 강제한다.

**핵심 필터: "이걸 읽고 뭘 할 수 있나?"**
- 새 도구를 써볼 수 있다 → ✅
- 워크플로우를 바꿀 수 있다 → ✅
- 비용을 줄일 수 있다 → ✅
- 새 모델을 테스트할 수 있다 → ✅
- 그냥 "와 무섭다/웃기다"로 끝나면 → ❌

**소스 다양성 (풀 50 기준):**
- 한 소스(서브레딧 포함)에서 max 5개
- **reddit_* 전체 합산 max 10개** (서브레딧이 여러 개여도 reddit 총합 10개 넘지 말 것)
- show_hn 소스 전부 제외
- i.redd.it / v.redd.it URL이 있는 항목도 제외 (이미지/동영상만 있는 포스트)
- **최소 할당량 (반드시 포함):**
  - github: 최소 4개 — GitHub Trending 레포는 "오늘 당장 설치해볼 수 있는 도구"라서 바이브코더한테 핵심. 요약이 있는 레포 우선
  - geeknews: 최소 2개
  - hackernews: 최소 3개

선택이 끝나면 선택한 인덱스를 공백으로 구분해서 출력 (정확히 50개):
```
SELECTED_INDICES: 3 7 12 15 21 25 30 42 55 61 ... (총 50개)
```

## STEP 3: Extract by index and add summaries — NO manual URL writing

**⚠️ URL을 직접 타이핑하지 말 것. 반드시 jq로 원본 데이터에서 추출.**

```bash
# STEP 2에서 결정한 인덱스로 원본 데이터에서 추출 (URL 오염 불가)
INDICES="3 7 12 15 21 25 30 42 55 61 ..."  # ← STEP 2 결과 50개로 교체

# 인덱스 배열을 jq 형식으로 변환 후 추출
IDX_ARRAY=$(echo $INDICES | tr ' ' '\n' | jq -R 'tonumber' | jq -s '.')
jq --argjson idx "$IDX_ARRAY" '[.[$idx[]]]' /tmp/all_items.json > /tmp/curated_raw.json

# 확인
jq 'length' /tmp/curated_raw.json
jq -r '.[] | "[\(.source)] \(.url) — \(.title[:60])"' /tmp/curated_raw.json
```

Now update each item's `summary` field with a 1-line English summary ("what can I DO with this?").
Write the updated JSON to `/tmp/curated.json`:

```bash
# summary 업데이트: jq를 사용해서 각 항목의 summary만 교체
# 형식: [인덱스, "새 summary"] 쌍의 배열로 작성
cat > /tmp/summary_updates.json << 'EOF'
[
  [0, "summary for item at index 0 of curated_raw.json"],
  [1, "summary for item at index 1"],
  ...
]
EOF

# summary 적용
jq 'to_entries | map(.value.summary = ($updates[.key][1] // .value.summary)) | map(.value)' \
  --slurpfile updates /tmp/summary_updates.json \
  /tmp/curated_raw.json > /tmp/curated.json

# Safety filter: remove show_hn and image-only reddit posts
jq '[.[] | select(.source != "show_hn")]' /tmp/curated.json > /tmp/curated_filtered.json
mv /tmp/curated_filtered.json /tmp/curated.json
```

## STEP 4: Save to news_curated

```bash
# Clear old curated items
curl -s -X DELETE "${SUPABASE_URL}/rest/v1/news_curated?id=gt.0" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"

curl -s -X POST "${SUPABASE_URL}/rest/v1/news_curated" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d @/tmp/curated.json
```

Print "Curated: N items saved to news_curated." (Expected: 50.)
