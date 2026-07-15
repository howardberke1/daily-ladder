-- Daily Ladder — Supabase schema
-- Run this once in Supabase: Project → SQL Editor → New query → paste all → Run.
-- Safe to re-run: uses "if not exists" / "or replace" where possible, but if you
-- need a clean slate, drop the three tables first (see bottom of file, commented).

-- ============================================================
-- PROFILES
-- One row per account. Created on first sign-in once the player
-- picks a username. Username is public (needed for leaderboards
-- and friend search) but that's the only public identity info.
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  helmet_color text not null default 'default',
  pack_color text not null default 'default',
  accessory text not null default 'none',
  created_at timestamptz not null default now()
);

alter table public.profiles
  add constraint username_format
  check (username ~ '^[a-zA-Z0-9_]{3,20}$');

alter table public.profiles enable row level security;

create policy "profiles are viewable by everyone"
  on public.profiles for select
  using (true);

create policy "users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- ============================================================
-- FRIENDSHIPS
-- Simple request/accept model. A row is created by the requester
-- as 'pending'; either side can flip it to 'accepted'; either side
-- can delete it (unfriend, or reject a request).
-- ============================================================
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  constraint no_self_friend check (requester_id <> addressee_id),
  unique (requester_id, addressee_id)
);

alter table public.friendships enable row level security;

create policy "users can view friendships they're part of"
  on public.friendships for select
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "users can send friend requests"
  on public.friendships for insert
  with check (auth.uid() = requester_id);

create policy "users can respond to friendships they're part of"
  on public.friendships for update
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "users can remove friendships they're part of"
  on public.friendships for delete
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- ============================================================
-- RESULTS
-- One row per player per calendar day (daily mode only — archive
-- and practice never sync here). Scores are public by nature of
-- a leaderboard existing at all.
-- ============================================================
create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  date_key text not null,
  puzzle_number int not null,
  score int not null check (score >= 0 and score <= 18),
  time_ms int,
  theme_correct boolean not null default false,
  rungs jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, date_key)
);

alter table public.results enable row level security;

create policy "results are viewable by everyone"
  on public.results for select
  using (true);

create policy "users can insert their own results"
  on public.results for insert
  with check (auth.uid() = user_id);

create policy "users can update their own results"
  on public.results for update
  using (auth.uid() = user_id);

-- ============================================================
-- ALL-TIME LEADERBOARD VIEW
-- Lifetime aggregate per player. security_invoker means it runs
-- with the querying user's own permissions (which is fine here
-- since results/profiles are both public-select anyway).
-- ============================================================
create or replace view public.leaderboard_alltime
  with (security_invoker = true) as
select
  user_id,
  count(*) as games_played,
  sum(score) as total_score,
  round(avg(score), 1) as avg_score,
  sum((score = 18)::int) as perfect_climbs,
  min(time_ms) filter (where score = 18) as fastest_perfect_ms
from public.results
group by user_id;

-- ============================================================
-- Helpful indexes
-- ============================================================
create index if not exists results_date_score_idx
  on public.results (date_key, score desc, time_ms asc);

create index if not exists friendships_addressee_idx
  on public.friendships (addressee_id, status);

create index if not exists friendships_requester_idx
  on public.friendships (requester_id, status);

-- ============================================================
-- To start over from scratch, uncomment and run just this block:
-- ============================================================
-- drop view if exists public.leaderboard_alltime;
-- drop table if exists public.results;
-- drop table if exists public.friendships;
-- drop table if exists public.profiles;

-- ============================================================
-- GRANTS
-- The project was created with "Automatically expose new tables"
-- disabled (good practice), so API roles need explicit table access.
-- RLS policies above still control which rows each user can touch.
-- ============================================================
grant usage on schema public to anon, authenticated;

grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;

grant select, insert, update, delete on public.friendships to authenticated;

grant select on public.results to anon, authenticated;
grant insert, update on public.results to authenticated;

grant select on public.leaderboard_alltime to anon, authenticated;
