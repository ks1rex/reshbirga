-- Tracks individual reputation awards so we can compute "gained this week"
-- for the home page leaderboard, without changing how profiles.reputation
-- itself is maintained (still a running total, updated in reputation.js).
create table if not exists reputation_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  amount integer not null,
  created_at timestamptz not null default now()
);

create index if not exists reputation_log_user_created_idx on reputation_log(user_id, created_at);

alter table reputation_log enable row level security;

create policy "reputation_log_select_own" on reputation_log
  for select using (auth.uid() = user_id);
