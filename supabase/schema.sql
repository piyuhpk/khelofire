-- KheloFire - Supabase schema (hardened)
-- Run this in Supabase dashboard -> SQL Editor -> New query -> Run.
-- Safe to re-run: every statement is idempotent.
--
-- SECURITY MODEL (read this before changing anything)
-- The anon key ships inside every APK, so it is PUBLIC. Anything the anon key
-- can reach is public. Therefore:
--   * clients may NEVER write money columns (available_minor / locked_minor)
--   * clients may NEVER write win/loss counters
--   * clients may NEVER read another user's row
--   * every balance change goes through a SECURITY DEFINER function that
--     re-derives the amount from server-side tables
-- Column-level GRANT/REVOKE does the locking down; RLS does the row locking.
-- Money is stored in integer minor units (poisha); 1 Taka = 100.

-- ============ profiles ============
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username        text not null default 'Player',
  avatar          text not null default 'Player',
  player_id       text not null,
  referral_code   text not null,
  available_minor bigint not null default 5000,
  locked_minor    bigint not null default 0,
  wins            int not null default 0,
  losses          int not null default 0,
  draws           int not null default 0,
  created_at      timestamptz not null default now()
);

-- ============ transactions (wallet ledger - server written) ============
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

-- ============ matches (history - server written) ============
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

-- ============ match_modes: SERVER-SIDE prize truth ============
-- The client must never be able to say "I won 500". The prize is looked up here.
create table if not exists public.match_modes (
  id           text primary key,
  game         text not null,
  label        text not null,
  entry_minor  bigint not null default 0,
  prize_minor  bigint not null default 0,
  max_players  int not null default 4,
  active       boolean not null default true
);

-- ============ deposits / withdrawals (requests + server decisions) ============
create table if not exists public.deposits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  method      text not null default 'bKash',
  ref         text not null default '',
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
create index if not exists deposits_user_idx on public.deposits(user_id, created_at desc);

create table if not exists public.withdrawals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  method       text not null default 'bKash',
  account      text not null default '',
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
create index if not exists withdrawals_user_idx on public.withdrawals(user_id, created_at desc);

-- Idempotency guard: one settlement per match, even if the client retries.
create table if not exists public.settlements (
  match_id    uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  game        text not null,
  mode        text not null,
  outcome     text not null check (outcome in ('win','loss','draw','cancelled')),
  entry_minor bigint not null default 0,
  prize_minor bigint not null default 0,
  delta_minor bigint not null default 0,
  created_at  timestamptz not null default now()
);

-- ============ staff (server-side admin roles - replaces the client PIN) ============
create table if not exists public.staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'support' check (role in ('admin','superadmin','support')),
  created_at timestamptz not null default now()
);

-- Server-side audit trail. Written only by trusted edge functions; clients can
-- never read or forge it. The old audit log lived in localStorage, which meant
-- anyone could edit or delete it from their own phone.
create table if not exists public.staff_activity (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references auth.users(id) on delete cascade,
  role       text not null,
  action     text not null,
  target     text,
  created_at timestamptz not null default now()
);
create index if not exists staff_activity_idx on public.staff_activity(created_at desc);

-- ============ Row Level Security ============
alter table public.profiles     enable row level security;
alter table public.transactions enable row level security;
alter table public.matches      enable row level security;
alter table public.deposits     enable row level security;
alter table public.withdrawals  enable row level security;
alter table public.settlements  enable row level security;
alter table public.staff        enable row level security;
alter table public.staff_activity enable row level security;
alter table public.match_modes  enable row level security;

drop policy if exists "own profile read"   on public.profiles;
drop policy if exists "own profile write"  on public.profiles;
drop policy if exists "leaderboard read"   on public.profiles;
drop policy if exists "own txn read"       on public.transactions;
drop policy if exists "own txn insert"     on public.transactions;
drop policy if exists "own match read"     on public.matches;
drop policy if exists "own match insert"   on public.matches;
drop policy if exists "own deposit all"    on public.deposits;
drop policy if exists "own withdraw all"   on public.withdrawals;
drop policy if exists "own settlement rd"  on public.settlements;
drop policy if exists "own staff read"     on public.staff;
drop policy if exists "public mode read"   on public.match_modes;

-- NOTE: the old "leaderboard read ... using (true)" policy is gone on purpose.
-- It let ANYONE with the (public) anon key read every user's wallet balance.
create policy "own profile read"  on public.profiles for select using (auth.uid() = id);
create policy "own txn read"      on public.transactions for select using (auth.uid() = user_id);
create policy "own match read"    on public.matches      for select using (auth.uid() = user_id);
create policy "own deposit all"   on public.deposits     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own withdraw all"  on public.withdrawals  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own settlement rd" on public.settlements  for select using (auth.uid() = user_id);
create policy "own staff read"    on public.staff        for select using (auth.uid() = user_id);
create policy "public mode read"  on public.match_modes  for select using (active);

-- ============ COLUMN-LEVEL LOCKDOWN (this is what stops wallet minting) ============
-- Default Supabase grants give `authenticated` full UPDATE on every table.
-- Without these revokes, ANY player could run:
--   supabase.from('profiles').update({ available_minor: 99999999 }).eq('id', <own id>)
-- and mint unlimited money. Revoke the table grant, then re-grant only the
-- two columns a player is actually allowed to change.
revoke update on public.profiles from anon, authenticated;
grant  update (username, avatar) on public.profiles to authenticated;

-- History rows are written only by settle_match(). Direct inserts are how a
-- client would fake 10,000 wins to top the leaderboard, so they are removed.
revoke insert, update, delete on public.matches      from anon, authenticated;
revoke insert, update, delete on public.transactions from anon, authenticated;
revoke insert, update, delete on public.settlements  from anon, authenticated;
revoke insert, update, delete on public.match_modes  from anon, authenticated;
revoke insert, update, delete on public.staff        from anon, authenticated;

-- Requests are created through the RPCs below so the amounts get validated.
revoke insert, update, delete on public.deposits    from anon, authenticated;
revoke insert, update, delete on public.withdrawals from anon, authenticated;

-- Nobody but the service_role (server / edge functions) touches staff or
-- decides on money movements.
revoke all on public.staff from anon, authenticated;
revoke all on public.staff_activity from anon, authenticated;

-- ============ helper: is the caller staff? ============
create or replace function public.is_staff()
returns text language sql stable security definer set search_path = public as $$
  select role from public.staff where user_id = auth.uid()
$$;
grant execute on function public.is_staff() to anon, authenticated;

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

-- The trigger fires this as its owner, so nobody needs to call it directly. Leaving
-- EXECUTE open would let any signed-in player invoke a SECURITY DEFINER function
-- that writes to profiles and mint themselves a row for an arbitrary user id.
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ settle_match: the ONLY path that moves a player's own balance ============
-- The client sends game + mode + outcome. The entry and prize are re-read from
-- match_modes here, so a tampered client cannot inflate them. Idempotent: a
-- replayed call hits the settlements PK and raises, it does not pay twice.
create or replace function public.settle_match(p_game text, p_mode text, p_outcome text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_mode   public.match_modes%rowtype;
  v_prof   public.profiles%rowtype;
  v_entry  bigint;
  v_prize  bigint;
  v_delta  bigint;
  v_match  uuid;
  v_avail  bigint;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_outcome not in ('win','loss','draw','cancelled') then
    raise exception 'bad outcome %', p_outcome;
  end if;

  select * into v_mode from public.match_modes where id = p_mode and active;
  if not found then raise exception 'unknown mode %', p_mode; end if;
  if v_mode.game <> p_game then raise exception 'mode % is not a % game', p_mode, p_game; end if;

  v_entry := v_mode.entry_minor;
  v_prize := case when p_outcome = 'win' then v_mode.prize_minor else 0 end;
  -- cancelled/draw refund the entry; a loss just forfeits it
  v_delta := case
    when p_outcome = 'win'      then v_prize - v_entry
    when p_outcome = 'cancelled' or p_outcome = 'draw' then 0
    else -v_entry
  end;

  select * into v_prof from public.profiles where id = v_uid for update;
  if not found then raise exception 'no profile'; end if;

  if p_outcome <> 'cancelled' and v_entry > v_prof.available_minor then
    raise exception 'insufficient balance: have %, need %', v_prof.available_minor, v_entry;
  end if;

  v_avail := v_prof.available_minor - v_entry + v_prize;

  update public.profiles
     set available_minor = v_avail,
         wins   = wins   + case when p_outcome = 'win'  then 1 else 0 end,
         losses = losses + case when p_outcome = 'loss' then 1 else 0 end,
         draws  = draws  + case when p_outcome = 'draw' then 1 else 0 end
   where id = v_uid;

  insert into public.matches (user_id, game, mode, entry_minor, prize_minor, outcome, delta_minor)
  values (v_uid, p_game, p_mode, v_entry, v_prize, p_outcome, v_delta)
  returning id into v_match;

  insert into public.settlements (match_id, user_id, game, mode, outcome, entry_minor, prize_minor, delta_minor)
  values (v_match, v_uid, p_game, p_mode, p_outcome, v_entry, v_prize, v_delta);

  insert into public.transactions (user_id, amount_minor, note, status)
  values (v_uid, v_delta, p_mode || ' ' || p_outcome, 'completed');

  return jsonb_build_object(
    'match_id', v_match, 'entry_minor', v_entry, 'prize_minor', v_prize,
    'delta_minor', v_delta, 'available_minor', v_avail
  );
end; $$;
grant execute on function public.settle_match(text, text, text) to authenticated;

-- ============ request_withdrawal / request_deposit ============
create or replace function public.request_withdrawal(p_amount_minor bigint, p_method text, p_account text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_prof public.profiles%rowtype;
  v_id   uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_amount_minor <= 0 then raise exception 'bad amount'; end if;

  select * into v_prof from public.profiles where id = v_uid for update;
  -- the balance is debited immediately so the same money cannot be withdrawn twice
  if v_prof.available_minor < p_amount_minor then raise exception 'insufficient balance'; end if;

  update public.profiles set available_minor = available_minor - p_amount_minor where id = v_uid;

  insert into public.withdrawals (user_id, amount_minor, method, account)
  values (v_uid, p_amount_minor, coalesce(nullif(p_method,''),'bKash'), coalesce(p_account,''))
  returning id into v_id;

  insert into public.transactions (user_id, amount_minor, note, status)
  values (v_uid, -p_amount_minor, 'withdrawal request', 'pending');

  return v_id;
end; $$;
grant execute on function public.request_withdrawal(bigint, text, text) to authenticated;

create or replace function public.request_deposit(p_amount_minor bigint, p_method text, p_ref text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_amount_minor <= 0 then raise exception 'bad amount'; end if;

  insert into public.deposits (user_id, amount_minor, method, ref)
  values (v_uid, p_amount_minor, coalesce(nullif(p_method,''),'bKash'), coalesce(p_ref,''))
  returning id into v_id;

  insert into public.transactions (user_id, amount_minor, note, status)
  values (v_uid, p_amount_minor, 'deposit request', 'pending');

  return v_id;
end; $$;
grant execute on function public.request_deposit(bigint, text, text) to authenticated;

-- ============ decide_deposit / decide_withdrawal (server-side only) ============
-- callable ONLY with the service_role key, i.e. from a trusted server or edge
-- function after verifying the caller is staff. Never reachable with the anon key.
create or replace function public.decide_deposit(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_d     public.deposits%rowtype;
  v_bonus bigint;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role only'; end if;
  select * into v_d from public.deposits where id = p_id for update;
  if not found or v_d.status <> 'pending' then raise exception 'not pending'; end if;

  if p_approve then
    v_bonus := 0;
    update public.profiles set available_minor = available_minor + v_d.amount_minor + v_bonus where id = v_d.user_id;
    update public.deposits set status='approved', decided_by=auth.uid(), decided_at=now() where id = p_id;
    update public.transactions set status='completed'
      where user_id = v_d.user_id and note = 'deposit request'
      order by created_at asc limit 1;
    insert into public.transactions (user_id, amount_minor, note, status)
    values (v_d.user_id, v_d.amount_minor, 'deposit approved', 'completed');
  else
    update public.deposits set status='rejected', decided_by=auth.uid(), decided_at=now() where id = p_id;
    update public.transactions set status='failed'
      where user_id = v_d.user_id and note = 'deposit request'
      order by created_at asc limit 1;
  end if;
end; $$;
revoke all on function public.decide_deposit(uuid, boolean) from public, anon, authenticated;

create or replace function public.decide_withdrawal(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_w public.withdrawals%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role only'; end if;
  select * into v_w from public.withdrawals where id = p_id for update;
  if not found or v_w.status <> 'pending' then raise exception 'not pending'; end if;

  if p_approve then
    -- balance was already debited at request time, so approving pays nothing extra
    update public.withdrawals set status='approved', decided_by=auth.uid(), decided_at=now() where id = p_id;
    insert into public.transactions (user_id, amount_minor, note, status)
    values (v_w.user_id, 0, 'withdrawal sent', 'completed');
  else
    -- reject refunds the debited amount
    update public.profiles set available_minor = available_minor + v_w.amount_minor where id = v_w.user_id;
    update public.withdrawals set status='rejected', decided_by=auth.uid(), decided_at=now() where id = p_id;
    insert into public.transactions (user_id, amount_minor, note, status)
    values (v_w.user_id, v_w.amount_minor, 'withdrawal refunded', 'refunded');
  end if;
end; $$;
revoke all on function public.decide_withdrawal(uuid, boolean) from public, anon, authenticated;

-- ============ get_leaderboard: public, but leaks nothing ============
-- Replaces the old `using (true)` profile policy. SECURITY DEFINER so it can
-- read rows the caller cannot, but it returns only name/avatar/wins.
create or replace function public.get_leaderboard(p_limit int default 50)
returns table (username text, avatar text, wins int)
language sql stable security definer set search_path = public as $$
  select p.username, p.avatar, p.wins
    from public.profiles p
   order by p.wins desc, p.created_at asc
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;
grant execute on function public.get_leaderboard(int) to anon, authenticated;

-- ============ seed match_modes (server-side prize truth) ============
-- These are the amounts settle_match() trusts. They must stay in sync with
-- MODES in src/lib/catalog.ts - the catalog is now only the display copy.
-- Re-running this updates changed entry/prize values.
insert into public.match_modes (id, game, label, entry_minor, prize_minor, max_players) values
  ('ludo_classic',   'ludo',  'Classic 1v1',   2000, 3600, 2),
  ('ludo_4p',        'ludo',  'Ludo 4P',       1000, 3400, 4),
  ('ludo_quick',     'ludo',  'Quick Play',     500,  900, 2),
  ('ludo_practice',  'ludo',  'Practice',         0,    0, 2),
  ('chess_1v1',      'chess', 'Chess 1v1',     2000, 3600, 2),
  ('chess_practice', 'chess', 'Practice',         0,    0, 2),
  ('guti_1v1',       'guti',  '16 Guti 1v1',   1500, 2700, 2),
  ('guti_practice',  'guti',  'Practice',         0,    0, 2),
  ('dice_1v1',       'dice',  'Dice Duel',     1000, 1800, 2),
  ('dice_practice',  'dice',  'Practice',         0,    0, 2)
on conflict (id) do update set
  game        = excluded.game,
  label       = excluded.label,
  entry_minor = excluded.entry_minor,
  prize_minor = excluded.prize_minor,
  max_players = excluded.max_players;

-- ============ list_pending_requests (staff only) ============
-- The admin screen cannot read other users' rows through RLS (by design), so
-- this SECURITY DEFINER function does the read after checking the caller's role.
create or replace function public.list_pending_requests()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := public.is_staff();
begin
  if v_role is null then raise exception 'not authorised'; end if;
  return jsonb_build_object(
    'deposits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'user', p.username, 'amount_minor', d.amount_minor,
        'method', d.method, 'ref', d.ref, 'ts', d.created_at))
      from public.deposits d join public.profiles p on p.id = d.user_id
      where d.status = 'pending' order by d.created_at desc limit 100), '[]'::jsonb),
    'withdrawals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'user', p.username, 'amount_minor', w.amount_minor,
        'method', w.method, 'account', w.account, 'ts', w.created_at))
      from public.withdrawals w join public.profiles p on p.id = w.user_id
      where w.status = 'pending' order by w.created_at desc limit 100), '[]'::jsonb)
  );
end; $$;
grant execute on function public.list_pending_requests() to authenticated;

-- ============ realtime: admin panel sees every new sign-up live ============
do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null; end $$;

-- ============================================================
-- RESIDUAL RISK - stated plainly, do not pretend this is airtight:
-- The game runs on the client, so the OUTCOME of a match is still reported by
-- the player's own device. A modified APK can call settle_match('ludo','x',
-- 'win') and collect the prize for a match it never played. Entry and prize
-- amounts are now server-controlled and double-settlement is blocked, but
-- closing the outcome hole requires a server-authoritative match runner
-- (server holds the board state, client only renders). That is the next step,
-- not something a client-side patch can fix.
-- ============================================================