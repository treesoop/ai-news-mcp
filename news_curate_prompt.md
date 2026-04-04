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
echo "$ITEMS" | jq -r '.[] | "[\(.source)] (\(.score)pts) \(.title)"'
```

Review ALL items. Understand what's trending across each community.

## STEP 2: Select top 20

**타겟 독자: 바이브코더 & AI 자동화 빌더.** Cursor/Claude Code로 코딩하고, MCP 서버 만들고, Ollama 로컬 모델 돌리고, n8n/Make로 자동화하는 사람들. 연구자가 아니다. 보안 전문가가 아니다. **만들고, 자동화하고, 돈 버는 사람들이다.**

**20개 구성:**

**커뮤니티 핫토픽 8~10개 (메인):**
- 각 Reddit 서브 점수 top 3를 먼저 본다 — 이게 오늘 사람들이 진짜 흥분하는 것
- r/vibecoding, r/ClaudeAI, r/LocalLLaMA가 핵심 소스
- 프롬프트 hack, 토큰 절약법, 도구 비교, 가격 정책 변화, 바이브코딩 문화
- HN 500pts+ 토픽
- i.redd.it 이미지 URL → Reddit permalink로 대체

**실용 뉴스 6~8개:**
- 새 모델 출시 (Gemma, Qwen, GPT, Claude, Llama, Mistral) — 바로 쓸 수 있는 것
- AI 코딩 도구 (Cursor, Claude Code, Copilot, Codex, Windsurf)
- 로컬 LLM (llama.cpp, Ollama, vLLM, LM Studio)
- 자동화 도구 (MCP 서버, AI 에이전트, n8n, Make)
- 비용 절약, 배포 팁, 워크플로우 개선
- 업계 동향 (가격 변경, API 업데이트, 인수)

**GitHub 트렌딩 1~2개:**
- AI 코딩 도구, 자동화 프레임워크, LLM 관련 레포만

**연구 논문 최대 1개:**
- 바로 실무에 쓸 수 있는 것만

**Hard exclude:**
- show_hn 소스 전부 — 진짜 중요한 건 HN이나 GitHub에서 다시 뜸
- GitHub gists
- 채용, 자기홍보, 월간 토론 쓰레드
- 순수 보안 뉴스 (CVE, 취약점)
- 비AI 뉴스 (정치, 우주, 하드웨어)
- AI 윤리/감정/의식 철학 토론
- 구독 불만, 사용량 제한 rant
- 개인 앱/프로덕트 홍보

**최종 필터 (각 항목마다 자문):**
1. "바이브코더가 이거 보고 뭔가 만들거나 바꾸고 싶어지나?" — NO면 제외
2. "이게 그냥 누군가의 프로덕트 광고 아닌가?" — YES면 제외
3. "커뮤니티가 진짜 이거 때문에 흥분하고 있나?" — 점수만 높고 실질적 반응 없으면 제외

**소스 다양성:** 한 소스에서 max 3개, 최소 5개 다른 소스

For each item: 1-line English summary — **what can I DO with this?** Not what it is.

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

# Safety filter: remove show_hn
jq '[.[] | select(.source != "show_hn")]' /tmp/curated.json > /tmp/curated_filtered.json
mv /tmp/curated_filtered.json /tmp/curated.json

curl -s -X POST "${SUPABASE_URL}/rest/v1/news_curated" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d @/tmp/curated.json
```

Print "Curated: N items saved to news_curated."
