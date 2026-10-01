-- KheloVerse — Supabase schema
-- Run this in Supabase dashboard → SQL Editor → New query → Run.
-- Money is stored in integer minor units (poisha); ৳1 = 100.

-- ============ profiles ============
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username        text not null default 'Player',
  avatar          text not null default '🎮',
  player_id       text not null,
  referral_code   text not null,
  available_minor bigint not null default 5000,  -- ৳50 welcome demo balance
  locked_minor    bigint not null default 0,
  wins            int not null default 0,
  losses          int not null default 0,
  draws           int not null default 0,
  created_at      timestamptz not null default now()
);

-- ============ transactions (wallet ledger) ============
create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  amount_minor bigint not null,
  note         text not null default '',
  status       text not null default 'completed'
               check (status in ('pending','completed','failed','refunded')),
  created_at   timestamptz not null default now()
);
create index if not exists transactions_user_idx on public.transactions(user_id, created_at desc);

-- ============ matches (game history) ============
create table if not exists public.matches (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  game        text not null,
  mode        text not null,
  entry_minor bigint not null default 0,
  prize_minor bigint not null default 0,
  outcome     text not null check (outcome in ('win','loss','draw','cancelled')),
  delta_minor bigint not null default 0,
  moves       int,
  created_at  timestamptz not null default now()
);
create index if not exists matches_user_idx on public.matches(user_id, created_at desc);

-- ============ Row Level Security ============
alter table public.profiles     enable row level security;
alter table public.transactions enable row level security;
alter table public.matches      enable row level security;

-- drop-then-create so the whole script is safe to re-run (Postgres has no
-- "create policy if not exists").
drop policy if exists "own profile read"  on public.profiles;
drop policy if exists "own profile write" on public.profiles;
drop policy if exists "leaderboard read"  on public.profiles;
drop policy if exists "own txn read"      on public.transactions;
drop policy if exists "own txn insert"    on public.transactions;
drop policy if exists "own match read"    on public.matches;
drop policy if exists "own match insert"  on public.matches;

-- each user writes only their own rows
create policy "own profile write"  on public.profiles     for update using (auth.uid() = id);
create policy "own txn read"       on public.transactions for select using (auth.uid() = user_id);
create policy "own txn insert"     on public.transactions for insert with check (auth.uid() = user_id);
create policy "own match read"     on public.matches      for select using (auth.uid() = user_id);
create policy "own match insert"   on public.matches      for insert with check (auth.uid() = user_id);

-- leaderboard needs to read everyone's wins/username (public, read-only).
-- one permissive SELECT policy covers both "own profile" and leaderboard reads.
create policy "leaderboard read"   on public.profiles     for select using (true);

-- ============ auto-create a profile row on signup ============
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, player_id, referral_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1), 'Player'),
    'KV' || lpad((floor(random()*900000)+100000)::text, 6, '0'),
    'KV' || upper(substr(md5(new.id::text), 1, 4))
  );
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ realtime: admin panel sees every new sign-up live ============
do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null; end $$;
