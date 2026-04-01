create table if not exists news_cache (
  id uuid default gen_random_uuid() primary key,
  cache_key text unique not null,   -- "YYYY-MM-DD_HH" (UTC hour)
  data jsonb not null,              -- { items: NewsItem[], source_counts: {} }
  created_at timestamptz default now()
);

-- auto-delete rows older than 48 hours (keep storage clean)
create index if not exists news_cache_created_at_idx on news_cache (created_at);

-- RLS: public read (anyone can call the API), write via service role only
alter table news_cache enable row level security;

create policy "public read" on news_cache
  for select using (true);

create policy "service role write" on news_cache
  for all using (auth.role() = 'service_role');
