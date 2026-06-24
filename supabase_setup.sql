-- ─── RUN THIS IN SUPABASE SQL EDITOR ─────────────────────────────────────────
-- Go to: supabase.com → your project → SQL Editor → New Query → paste & run

-- 1. MATCH STATE TABLE (single row, holds entire live match)
create table if not exists match_state (
  id          int primary key default 1,
  state       jsonb not null default '{}',
  updated_at  timestamptz default now()
);

-- Insert the initial empty row
insert into match_state (id, state) values (1, '{}')
on conflict (id) do nothing;

-- 2. BETS TABLE (one row per user per bet)
create table if not exists bets (
  id          text primary key,
  user_id     int not null,
  user_name   text not null,
  market      text not null,
  selection   text not null,
  stake       int not null,
  odds        float not null,
  status      text not null default 'active',
  potential   float,
  updated_at  timestamptz default now()
);

-- 3. LEADERBOARD TABLE
create table if not exists leaderboard (
  user_id     int primary key,
  user_name   text not null,
  balance     int not null default 1000,
  pnl         int not null default 0,
  bets_count  int not null default 0,
  updated_at  timestamptz default now()
);

-- 4. ENABLE REALTIME on match_state
alter publication supabase_realtime add table match_state;

-- 5. ROW LEVEL SECURITY — allow all reads, all writes (open for competition)
alter table match_state  enable row level security;
alter table bets         enable row level security;
alter table leaderboard  enable row level security;

create policy "allow all" on match_state  for all using (true) with check (true);
create policy "allow all" on bets         for all using (true) with check (true);
create policy "allow all" on leaderboard  for all using (true) with check (true);
