# ai-news-mcp

> AI 트렌드 따라가기 힘드셨죠?
>
> Claude는 학습 시점 이후의 뉴스를 모릅니다. "요즘 핫한 AI 툴 뭐야?" 물어봐도 오래된 얘기만 하고, 직접 스크래핑 시키면 또 한참 기다려야 하죠.
>
> **저희가 6시간마다 17개 소스를 긁어서 DB에 넣어두고 있습니다. MCP로 연결하면 Claude가 바로 꺼내 씁니다.**

실시간 AI/기술 뉴스 집계 MCP 서버 — Supabase Edge Function 위에서 동작, **무료, 인증 불필요**.

Sources: HackerNews · **Show HN** · Reddit (ML/LocalLLaMA/ClaudeAI/artificial/programming) · ArXiv (cs.AI + cs.LG) · GitHub Trending · **HuggingFace Spaces Trending** · HuggingFace Daily Papers · Dev.to · Lobsters · GeekNews · Product Hunt · OpenAI News · InfoQ AI · The New Stack AI

캐시는 6시간마다 갱신됩니다.

---

## Quick Start (설치 없음, 로그인 없음)

### Claude Code CLI — 명령어 한 줄

```bash
claude mcp add --transport http ai-news https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/mcp
```

한 번만 실행하면 이후 모든 Claude Code 세션에서 바로 사용 가능합니다.

### 수동 설정 — Claude Code (`~/.claude.json`)

```json
{
  "mcpServers": {
    "ai-news": {
      "type": "http",
      "url": "https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/mcp"
    }
  }
}
```

### 수동 설정 — Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "ai-news": {
      "type": "http",
      "url": "https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/mcp"
    }
  }
}
```

### 다른 MCP 클라이언트 (HTTP transport)

```
https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/mcp
```

---

## 어떤 문제를 해결하나요?

| 문제 | ai-news-mcp |
|---|---|
| Claude가 최신 AI 뉴스를 모른다 | 6시간마다 17개 소스 수집, 항상 최신 |
| 스크래핑을 직접 시키면 느리다 | 미리 DB에 저장, MCP 호출 즉시 응답 |
| 어느 커뮤니티가 지금 핫한지 모른다 | Show HN, r/LocalLLaMA, HF Spaces 등 실시간 커뮤니티 반응 포함 |
| 논문/레포 파악에 시간이 걸린다 | ArXiv 초록 요약, GitHub README 퀵스타트 원클릭 |

---

## Tools

| Tool | 설명 |
|---|---|
| `get_trending_news` | 17개 소스 전체 뉴스. `source` 파라미터로 특정 소스 필터링 가능 |
| `get_top_picks` | 소스 신뢰도 + 커뮤니티 점수로 랭킹한 상위 N개. 관련성은 에이전트가 판단 |
| `search_today` | 오늘 수집된 뉴스에서 키워드 검색 |
| `get_new_since` | 특정 시각 이후에 추가된 뉴스 (ISO 타임스탬프) |
| `get_repo_quickstart` | GitHub 레포 메타데이터 + 설치 명령어 + README 퀵스타트 |
| `get_paper_brief` | ArXiv 논문 제목/저자/초록 + 코드 레포 링크 |
| `check_cache` | 캐시 상태 확인: 마지막 업데이트 시각, 소스별 아이템 수 |

### 예제 호출

```bash
# 상위 뉴스 5개
curl -s -X POST "https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_top_picks","arguments":{"n":5}}}'

# RAG 관련 뉴스 검색
curl -s -X POST "https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_today","arguments":{"query":"RAG"}}}'

# Show HN 최신 빌드만 보기
curl -s -X POST "https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_trending_news","arguments":{"source":"show_hn"}}}'
```

---

## 데이터 출처 & 투명성

공개된 피드/API/페이지만 수집합니다. 인증 불필요, 개인정보 없음.

| 소스 | URL | 방식 | 수집 항목 |
|---|---|---|---|
| HackerNews | `https://hacker-news.firebaseio.com/v0/topstories.json` | Public JSON API | 제목, URL, 점수 |
| Show HN (24h) | `https://hn.algolia.com/api/v1/search?tags=show_hn` | Algolia API | 제목, URL, 점수 — 개발자들이 방금 만든 것 |
| r/MachineLearning | `https://www.reddit.com/r/MachineLearning/hot.json` | Public Reddit API | 제목, URL, 점수 (유저 정보 없음) |
| r/LocalLLaMA | `https://www.reddit.com/r/LocalLLaMA/hot.json` | Public Reddit API | 제목, URL, 점수 |
| r/ClaudeAI | `https://www.reddit.com/r/ClaudeAI/hot.json` | Public Reddit API | 제목, URL, 점수 |
| r/artificial | `https://www.reddit.com/r/artificial/hot.json` | Public Reddit API | 제목, URL, 점수 |
| r/programming | `https://www.reddit.com/r/programming/hot.json` | Public Reddit API | 제목, URL, 점수 |
| ArXiv cs.AI | `https://rss.arxiv.org/rss/cs.AI` | Public RSS | 제목, 초록, 저자, URL |
| ArXiv cs.LG | `https://rss.arxiv.org/rss/cs.LG` | Public RSS | 제목, 초록, 저자, URL |
| GitHub Trending | `https://github.com/trending` | HTML 스크래핑 | 레포명, 설명, 스타 수 |
| HuggingFace Daily Papers | `https://huggingface.co/api/daily_papers` | Public JSON API | 제목, URL, 업보트 수 |
| HuggingFace Spaces Trending | `https://huggingface.co/api/spaces?sort=trendingScore` | Public JSON API | Space ID, 트렌딩 점수 |
| Dev.to | `https://dev.to/api/articles?tag=ai` | Public JSON API | 제목, URL, 반응 수 |
| Lobsters | `https://lobste.rs/hottest.json` | Public JSON API | 제목, URL, 점수 |
| GeekNews | `https://news.hada.io` | HTML 스크래핑 | 제목, URL, 점수 |
| OpenAI News | `https://openai.com/news/rss.xml` | Public RSS | 제목, URL |
| InfoQ AI & ML | `https://feed.infoq.com/ai-ml-data-eng` | Public RSS | 제목, URL |
| The New Stack AI | `https://thenewstack.io/category/ai/feed/` | Public RSS | 제목, URL |

### 저장하는 것

- 위 공개 데이터의 캐시 스냅샷 (6시간마다 갱신)
- Supabase `news_cache` 테이블에 저장, 48시간 후 자동 삭제
- 유저 데이터, 개인정보, 비공개 콘텐츠 없음

### 저장하지 않는 것

- 유료/로그인 필요 콘텐츠 없음
- 기사 본문 없음 — 제목, URL, 점수, 요약만
- 데이터 판매 또는 공유 없음

---

## 셀프 호스팅

직접 운영하고 싶다면:

```bash
git clone https://github.com/treesoop/ai-news-mcp
cd ai-news-mcp
```

`supabase/functions/mcp/` 의 Edge Function을 본인 Supabase 프로젝트에 배포하고, `news_fetcher_prompt.md` 를 Claude Code 크론잡으로 연결하면 됩니다.
