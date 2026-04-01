# ai-news-mcp 프로젝트 컨텍스트

## 프로젝트 개요
실시간 AI/기술 뉴스를 수집·캐싱해서 누구나 HTTP로 호출할 수 있는 공개 API.
블로그 자동화 에이전트들(treesoop, potenlab, hanguljobs)이 중복 스크래핑 없이 공유해서 사용.

## 아키텍처

```
[Claude / any tool]
       ↓ HTTP GET
[Supabase Edge Function: ai-news-fetcher]
       ↓ cache miss          ↓ cache hit (1시간 TTL)
  [스크래핑 실행]      [news_cache 테이블 반환]
       ↓
  [news_cache 저장]

[로컬 MCP 서버: ai-news-mcp]
  → Edge Function 호출하는 얇은 wrapper
```

## Supabase 프로젝트
- **Project ID**: `iiwkkrvyhktnwolsfndx`
- **URL**: `https://iiwkkrvyhktnwolsfndx.supabase.co`
- **Edge Function**: `ai-news-fetcher`
- **DB Table**: `news_cache`

## 뉴스 소스 (11개)
| 소스 | 형식 | 카테고리 |
|------|------|----------|
| HackerNews | Firebase API | dev-tools, AI |
| Dev.to | REST API | dev-tools, AI |
| Lobsters | JSON | dev-tools |
| Reddit r/MachineLearning | JSON | AI |
| Reddit r/LocalLLaMA | JSON | AI |
| Reddit r/artificial | JSON | AI, community |
| Reddit r/programming | JSON | dev-tools, community |
| ArXiv cs.AI | RSS | AI |
| ArXiv cs.LG | RSS | AI |
| GitHub Trending | HTML 파싱 | dev-tools |
| GeekNews | HTML 파싱 | community |

## API 엔드포인트
```
GET https://iiwkkrvyhktnwolsfndx.supabase.co/functions/v1/ai-news-fetcher
  ?category=all|AI|dev-tools|community   (기본: all)
  &refresh=true                           (캐시 무시하고 재수집)

Response:
{
  "cached_at": "2026-04-01T09:00:00Z",
  "age_minutes": 12,
  "total": 910,
  "items": [{ "title", "url", "source", "score", "summary" }]
}
```

## 파일 구조
```
ai-news-mcp/
├── src/                    # 로컬 MCP 서버 (Node.js)
│   ├── index.ts            # MCP stdio 서버
│   ├── scrapers/           # 각 소스별 스크래퍼
│   └── tools/              # MCP tool 핸들러
├── supabase/
│   └── functions/
│       └── ai-news-fetcher/
│           └── index.ts    # Edge Function (Deno)
├── .env                    # Supabase 환경변수
├── CLAUDE.md               # 이 파일
└── package.json
```

## 환경변수 (.env)
```
SUPABASE_URL=https://iiwkkrvyhktnwolsfndx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

## 로컬 MCP 설정 (~/.claude.json)
```json
{
  "mcpServers": {
    "ai-news-mcp": {
      "command": "node",
      "args": ["/Users/potenlab/potenlab/scheduled_task/ai-news-mcp/dist/index.js"]
    }
  }
}
```

## 주의사항
- Edge Function은 Deno 런타임 (node_modules 없음, ESM URL import)
- 로컬 MCP는 Node.js (npm 패키지)
- 캐시 TTL: 1시간
- 에러 시 해당 소스만 skip, 크래시 금지
- Free plan quota 초과 상태 (grace period Apr 5까지) → 업그레이드 필요
