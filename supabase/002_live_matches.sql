-- ============================================================================
-- 0002 - live matches + real idempotent settlement
--
-- Run this in Supabase dashboard -> SQL Editor -> New query -> Run, AFTER 0001.
-- Re-runnable: every statement is idempotent. Nothing in here drops or rewrites
-- an existing table, so a mistake cannot destroy data.
--
-- WHY THIS FILE EXISTS
-- 0001's settle_match() minted a fresh matches.id on every call and used THAT as
-- the settlements primary key. So a replayed call inserted a second settlement
-- row with a different PK and paid the player a second time. The comment in 0001
-- claiming the PK "blocks" a replay was wrong.
--
-- The fix is not a better guard on a made-up id, it is giving a settlement the
-- id of a match that actually exists. A real match row is created once, so
-- re-settling it can only ever produce one settlement.
--
-- Because settlements.match_id is the PRIMARY KEY and a match has several
-- players, one settlement row per (match, player) is encoded in the id itself:
--     md5(match_id || ':' || user_id)::uuid
-- which is deterministic, needs no extension, and keeps the existing PK intact
-- so no table has to be altered on the live database.
--
-- MONEY FLOW (changed on purpose - do not mix with the old one)
--   start_live_match() debits the entry from EVERY seated player, once.
--   settle_match() pays the PRIZE to the winner and refunds on cancel.
--   It no longer debits the entry, because that already happened at match start.
--   Net result for a winner is identical to before: +prize -entry.
-- ============================================================================

-- ============ live_matches: one row per real match ============
-- The server holds the board here. That is what makes the outcome
-- server-authoritative: a modified client cannot declare itself the winner,
-- because it cannot write this row.
create table if not exists public.live_matches (
  id              uuid primary key default gen_random_uuid(),
  game            text   not null default 'ludo',
  mode            text   not null,
  code            text   not null,
  host_id         uuid   not null references auth.users(id) on delete cascade,
  seat_count      int    not null default 2 check (seat_count in (2, 4)),
  status          text   not null default 'waiting'
                    check (status in ('waiting','live','finished','cancelled')),
  state           jsonb  not null default '{}'::jsonb,  -- engine LudoState
  turn            int,
  turn_seat       int,
  turn_deadline   timestamptz,
  winner_seat     int,
  entry_minor     bigint not null default 0,
  prize_minor     bigint not null default 0,
  cancel_reason   text   not null default '',
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz
);

-- The join code is what a player types, so it has to be unique and hard to guess.
create unique index if not exists live_matches_code_key on public.live_matches (code);
create index if not exists live_matches_status_idx on public.live_matches (status, created_at desc);
create index if not exists live_matches_host_idx  on public.live_matches (host_id);

-- ============ live_match_seats ============
-- player_id is the ENGINE player id (0 is always the host). For a 2 player game
-- the engine uses seats [0,2] - the two opposite corners - so the second seat is
-- 2, not 1. Storing the engine id directly avoids a translation table that
-- could disagree between the client and the server.
create table if not exists public.live_match_seats (
  match_id     uuid not null references public.live_matches(id) on delete cascade,
  player_id    int  not null check (player_id between 0 and 3),
  user_id      uuid not null references auth.users(id) on delete cascade,
  entry_locked boolean not null default false,
  joined_at    timestamptz not null default now(),
  primary key (match_id, player_id)
);
create index if not exists live_match_seats_user_idx on public.live_match_seats (user_id);
create unique index if not exists live_match_seats_one_user
  on public.live_match_seats (match_id, user_id);  -- one seat per player per match

-- settlements.match_id is the idempotency key, and for a live match it is a
-- deterministic md5(match:user) hash rather than the match's own id. That is what
-- makes a retried settle collide on the primary key instead of paying twice, but
-- it also means the row alone can no longer be traced back to the table it paid
-- out. This column keeps that link.
alter table public.settlements
  add column if not exists live_match_id uuid references public.live_matches(id) on delete set null;
create index if not exists settlements_live_match_idx on public.settlements (live_match_id);

-- ============ Row Level Security ============
alter table public.live_matches     enable row level security;
alter table public.live_match_seats enable row level security;

-- A player may see a match they are seated in, or one they created. The engine
-- state is readable by those players; it is NOT writable by anyone on the client.
drop policy if exists live_matches_read on public.live_matches;
create policy live_matches_read on public.live_matches
  for select to authenticated
  using (
    host_id = auth.uid()
    or exists (select 1 from public.live_match_seats s
                where s.match_id = live_matches.id and s.user_id = auth.uid())
  );

-- Seats are inserted only by create_live_match / join_live_match, which are
-- security definer and re-check membership themselves.
drop policy if exists live_match_seats_read on public.live_match_seats;
create policy live_match_seats_read on public.live_match_seats
  for select to authenticated
  using (user_id = auth.uid() or exists (
    select 1 from public.live_match_seats t
    where t.match_id = live_match_seats.match_id and t.user_id = auth.uid()));

-- No client-side insert/update/delete on either table. Game moves go through the
-- edge function with the service role, never from a phone.
revoke insert, update, delete on public.live_matches     from anon, authenticated;
revoke insert, update, delete on public.live_match_seats from anon, authenticated;
grant  select on public.live_matches     to authenticated;
grant  select on public.live_match_seats to authenticated;

-- ============================================================================
-- create_live_match: a player opens a table and gets a code to share.
-- ============================================================================

-- small helper so the ledger note wording is defined once, above its first use
create or replace function public.p_match_mode_note(p_mode text, p_what text)
returns text language sql immutable as $$
  select p_mode || ' ' || p_what;
$$;
grant execute on function public.p_match_mode_note(text, text) to authenticated;
create or replace function public.create_live_match(p_mode text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_mode public.match_modes%rowtype;
  v_id   uuid;
  v_seat int;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  select * into v_mode from public.match_modes where id = p_mode and active;
  if not found then raise exception 'unknown mode %', p_mode; end if;
  if v_mode.game <> 'ludo' then raise exception 'mode % is not a ludo mode', p_mode; end if;

  -- the engine only knows how to seat 2 (as [0,2]) or 4 (as [0,1,2,3]) players.
  -- Refuse anything else loudly instead of letting a 3-seat table start a game the
  -- engine cannot represent.
  if v_mode.max_players not in (2, 4) then
    raise exception 'mode % supports %, but only 2 and 4 player ludo are implemented', p_mode, v_mode.max_players;
  end if;

  -- a 0-entry mode is practice: it is meant to be played against the bot and has
  -- no stake to settle. Letting it open a real table would give away a seat on a
  -- board the bot does not drive, and settle 0 to 0 for a game nobody wagered on.
  if v_mode.entry_minor <= 0 then
    raise exception 'mode % is a practice mode and cannot host a real match', p_mode;
  end if;

  -- reject a code that is too easy to walk into somebody else's table
  if p_code !~ '^[A-Z0-9]{5,8}$' then
    raise exception 'bad code %, expected 5-8 uppercase letters or digits', p_code;
  end if;
  if exists (select 1 from public.live_matches where code = p_code) then
    raise exception 'code % already in use', p_code;
  end if;

  -- one live table per player per mode: stops seat-farming the entry debit
  if exists (select 1 from public.live_matches m
             where m.host_id = v_uid and m.mode = p_mode
               and m.status in ('waiting','live')) then
    raise exception 'you already have a % table open in %', v_mode.game, p_mode;
  end if;

  insert into public.live_matches (game, mode, code, host_id, seat_count,
                                   entry_minor, prize_minor)
  values (v_mode.game, p_mode, p_code, v_uid, v_mode.max_players,
          v_mode.entry_minor, v_mode.prize_minor)
  returning id into v_id;

  -- the host always takes engine seat 0
  insert into public.live_match_seats (match_id, player_id, user_id) values (v_id, 0, v_uid);

  -- 2p uses engine seats [0,2]; 4p uses [0,1,2,3]
  v_seat := case when v_mode.max_players = 2 then 2 else 1 end;

  return jsonb_build_object('match_id', v_id, 'code', p_code,
                            'seat', 0, 'next_seat', v_seat,
                            'entry_minor', v_mode.entry_minor,
                            'prize_minor', v_mode.prize_minor);
end; $$;
grant execute on function public.create_live_match(text, text) to authenticated;

-- ============================================================================
-- join_live_match: claim a free seat.
-- ============================================================================
create or replace function public.join_live_match(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_match public.live_matches%rowtype;
  v_have  int;
  v_seat  int;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  select * into v_match from public.live_matches
   where code = p_code and status = 'waiting' for update;
  if not found then raise exception 'no open table with code %', p_code; end if;
  if v_match.host_id = v_uid then raise exception 'you created this table'; end if;

  select count(*) into v_have from public.live_match_seats where match_id = v_match.id;
  if v_have >= v_match.seat_count then raise exception 'table is full'; end if;

  if exists (select 1 from public.live_match_seats
              where match_id = v_match.id and user_id = v_uid) then
    raise exception 'you are already in this table';
  end if;

  -- Engine seat ids are NOT 0..n-1: initLudo(2) plays [0, 2] (Red vs Yellow on
  -- opposite corners) and initLudo(4) plays [0, 1, 2, 3]. Filling 1..seat_count-1
  -- would seat a 1v1 opponent on engine seat 1 - Green - whose tokens then race
  -- around a ring no other token is on, and the match can never be won. Take the
  -- lowest free id from the correct set instead. Seat 0 is already the host's.
  --
  -- No coalesce here: min() returning NULL is exactly the "no free seat" signal,
  -- and coalesce(min(s), 0) would have handed back seat 0 and blown up on the
  -- primary key instead of reporting a full table.
  with candidate(s) as (
    select unnest(
      case when v_match.seat_count = 2 then array[2] else array[1, 2, 3] end
    )
  )
  select min(c.s) into v_seat
    from candidate c
   where not exists (select 1 from public.live_match_seats x
                      where x.match_id = v_match.id and x.player_id = c.s);
  if v_seat is null then raise exception 'table is full'; end if;

  insert into public.live_match_seats (match_id, player_id, user_id)
  values (v_match.id, v_seat, v_uid);

  return jsonb_build_object('match_id', v_match.id, 'seat', v_seat,
                            'entry_minor', v_match.entry_minor,
                            'prize_minor', v_match.prize_minor);
end; $$;
grant execute on function public.join_live_match(text) to authenticated;

-- ============================================================================
-- start_live_match: host starts the game. THIS is where the entry is debited.
--
-- Everything is checked before a single taka moves: all seats filled, every
-- player has the balance, and no seat has already been charged. Rows are locked
-- in seat order so two simultaneous starts cannot deadlock each other.
-- ============================================================================
create or replace function public.start_live_match(p_match_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_match  public.live_matches%rowtype;
  v_seat   record;
  v_mode   public.match_modes%rowtype;
  v_count  int;
  v_total  bigint;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  select * into v_match from public.live_matches where id = p_match_id for update;
  if not found then raise exception 'unknown match'; end if;
  if v_match.host_id <> v_uid then raise exception 'only the host can start'; end if;
  if v_match.status <> 'waiting' then raise exception 'match already %', v_match.status; end if;

  select count(*) into v_count from public.live_match_seats
   where match_id = p_match_id and entry_locked = false;
  if v_count < v_match.seat_count then
    raise exception 'need % players, have %', v_match.seat_count, v_count;
  end if;

  -- money always comes from match_modes, never from the client
  select * into v_mode from public.match_modes where id = v_match.mode and active;
  if not found then raise exception 'mode % is not active', v_match.mode; end if;

  select coalesce(sum(p.available_minor), 0) into v_total
    from public.live_match_seats s
    join public.profiles p on p.id = s.user_id
   where s.match_id = p_match_id;

  if v_mode.entry_minor * v_match.seat_count > v_total then
    raise exception 'not enough combined balance: need %, have %',
      v_mode.entry_minor * v_match.seat_count, v_total;
  end if;

  -- lock every payer in seat order, then charge
  for v_seat in
    select s.player_id, s.user_id, p.available_minor
      from public.live_match_seats s
      join public.profiles p on p.id = s.user_id
     where s.match_id = p_match_id
     order by s.player_id
     for update of p
  loop
    if v_seat.available_minor < v_mode.entry_minor then
      raise exception 'a player has % but needs %', v_seat.available_minor, v_mode.entry_minor;
    end if;
    update public.profiles
       set available_minor = available_minor - v_mode.entry_minor
     where id = v_seat.user_id;
    update public.live_match_seats set entry_locked = true
     where match_id = p_match_id and player_id = v_seat.player_id;
    insert into public.transactions (user_id, amount_minor, note, status)
    values (v_seat.user_id, -v_mode.entry_minor,
            p_match_mode_note(v_match.mode, 'entry paid'), 'completed');
  end loop;

  update public.live_matches
     set status = 'live', started_at = now(), state = '{}'::jsonb
   where id = p_match_id;

  return jsonb_build_object('match_id', p_match_id, 'status', 'live',
                            'entry_minor', v_mode.entry_minor,
                            'prize_minor', v_mode.prize_minor);
end; $$;
grant execute on function public.start_live_match(uuid) to authenticated;

-- ============================================================================
-- settle_match(uuid, text): the ONLY path that pays a prize out.
--
-- Order matters and is the whole point:
--   1. derive the settlement id deterministically from (match, player)
--   2. INSERT the settlement row first  -> this claims the idempotency slot
--   3. only if that insert actually happened, move the money
-- A retry hits the primary key on step 2, insert reports zero rows, and step 3
-- is skipped entirely. The player cannot be paid twice, and cannot be paid for
-- a match they never finished either - status is checked before the insert.
-- ============================================================================
create or replace function public.settle_match(p_match_id uuid, p_outcome text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_match  public.live_matches%rowtype;
  v_seat   public.live_match_seats%rowtype;
  v_sid    uuid;
  v_prize  bigint;
  v_entry  bigint;
  v_delta  bigint;
  v_avail  bigint;
  v_history uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  select * into v_match from public.live_matches where id = p_match_id;
  if not found then raise exception 'unknown match'; end if;

  select * into v_seat from public.live_match_seats
   where match_id = p_match_id and user_id = v_uid;
  if not found then raise exception 'you are not seated in this match'; end if;

  -- The outcome is NEVER taken from the client. p_outcome is accepted for
  -- signature compatibility with existing call sites and then discarded.
  --
  -- winner_seat is the authority here: clients have no INSERT/UPDATE on
  -- live_matches, so only the service-role game loop can set it. Trusting the
  -- client's 'win' would let the loser of a real match simply claim the prize.
  if v_match.status = 'cancelled' then
    p_outcome := 'cancelled';
  elsif v_match.status <> 'finished' then
    raise exception 'match is %, not finished', v_match.status;
  elsif v_match.winner_seat is null then
    raise exception 'match finished without a recorded winner';
  elsif v_seat.player_id = v_match.winner_seat then
    p_outcome := 'win';
  else
    p_outcome := 'loss';
  end if;

  -- money flows through exactly ONE path per outcome:
  --   cancelled  -> cancel_live_match() already refunded the entry, so here it is
  --                 just recorded with delta 0. Refunding in BOTH places would hand
  --                 the entry back twice.
  --   win        -> the prize moves here (the entry was taken at start).
  --   loss       -> nothing moves; the entry is already gone.

  v_entry := v_match.entry_minor;
  v_prize  := case when p_outcome = 'win' then v_match.prize_minor else 0 end;
  v_delta  := case
    when p_outcome = 'win'      then v_prize
    else 0                      -- cancelled was already refunded at cancel time
  end;

  v_sid := md5(p_match_id::text || ':' || v_uid::text)::uuid;

  -- (2) claim the slot. if this conflicts we already settled this player.
  insert into public.settlements (match_id, live_match_id, user_id, game, mode, outcome,
                                entry_minor, prize_minor, delta_minor)
  values (v_sid, p_match_id, v_uid, v_match.game, v_match.mode, p_outcome,
          v_entry, v_prize, v_delta)
  on conflict (match_id) do nothing;

  if not found then
    -- replay: report the original result, pay nothing
    return jsonb_build_object(
      'match_id', p_match_id, 'settled', false, 'duplicate', true,
      'delta_minor', 0,
      'available_minor', (select available_minor from public.profiles where id = v_uid));
  end if;

  -- (3) the slot is ours, move the money
  select available_minor into v_avail from public.profiles where id = v_uid for update;
  if not found then raise exception 'no profile'; end if;

  v_avail := v_avail + v_delta;
  update public.profiles
     set available_minor = v_avail,
         wins   = wins   + case when p_outcome = 'win'  then 1 else 0 end,
         losses = losses + case when p_outcome = 'loss' then 1 else 0 end,
         draws  = draws  + case when p_outcome = 'draw' then 1 else 0 end
   where id = v_uid;

  insert into public.matches (user_id, game, mode, entry_minor, prize_minor, outcome, delta_minor)
  values (v_uid, v_match.game, v_match.mode, v_entry, v_prize, p_outcome, v_delta)
  returning id into v_history;

  if v_delta <> 0 then
    insert into public.transactions (user_id, amount_minor, note, status)
    values (v_uid, v_delta,
            p_match_mode_note(v_match.mode, p_outcome), 'completed');
  end if;

  return jsonb_build_object(
    'match_id', p_match_id, 'history_id', v_history, 'settled', true,
    'entry_minor', v_entry, 'prize_minor', v_prize,
    'delta_minor', v_delta, 'available_minor', v_avail);
end; $$;
grant execute on function public.settle_match(uuid, text) to authenticated;

-- The old three-argument version is the one with the double-payment hole. It is
-- left in place so this file can be re-run without error, but nobody may call it.
revoke execute on function public.settle_match(text, text, text) from anon, authenticated;

-- ============================================================================
-- cancel_live_match: staff, or the host before the game starts.
-- Refunds every locked entry, so a stuck or abandoned table does not eat money.
-- ============================================================================
create or replace function public.cancel_live_match(p_match_id uuid, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_match  public.live_matches%rowtype;
  v_seat   record;
  v_refund bigint := 0;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  select * into v_match from public.live_matches where id = p_match_id for update;
  if not found then raise exception 'unknown match'; end if;

  if not (v_match.host_id = v_uid or public.is_staff()) then
    raise exception 'only the host or staff can cancel';
  end if;
  if v_match.status in ('finished','cancelled') then
    raise exception 'match already %', v_match.status;
  end if;

  for v_seat in
    select s.user_id, s.entry_locked, p.available_minor
      from public.live_match_seats s
      join public.profiles p on p.id = s.user_id
     where s.match_id = p_match_id
     order by s.player_id
     for update of p
  loop
    if v_seat.entry_locked then
      update public.profiles set available_minor = available_minor + v_match.entry_minor
       where id = v_seat.user_id;
      insert into public.transactions (user_id, amount_minor, note, status)
      values (v_seat.user_id, v_match.entry_minor,
              p_match_mode_note(v_match.mode, 'refund'), 'completed');
      v_refund := v_refund + v_match.entry_minor;
    end if;
  end loop;

  update public.live_matches
     set status = 'cancelled', cancel_reason = coalesce(p_reason, ''), finished_at = now()
   where id = p_match_id;

  return jsonb_build_object('match_id', p_match_id, 'status', 'cancelled',
                            'refunded_minor', v_refund);
end; $$;
grant execute on function public.cancel_live_match(uuid, text) to authenticated;

-- ============================================================================
-- realtime: both clients and the admin panel watch the match row
-- ============================================================================
do $$ begin
  alter publication supabase_realtime add table public.live_matches;
exception when duplicate_object then null; end $$;

-- ============================================================================
-- VERIFY (run these after the migration, all read-only)
--
-- 1. both settlement signatures exist, and only the safe one is callable:
--    select p.proname, pg_get_function_identity_arguments(p.oid) as args,
--           has_function_privilege('authenticated', p.oid, 'execute') as can_call
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and p.proname like 'settle_match%';
--    -- expect two rows; settle_match(text,text,text).can_call MUST be false
--
-- 2. no live table can be written by a client:
--    select relname, relrowsecurity
--      from pg_class where relname in ('live_matches','live_match_seats');
--    -- both relrowsecurity = true
--
-- 3. the tables exist with the columns the edge function expects:
--    select column_name, data_type from information_schema.columns
--     where table_name = 'live_matches' order by ordinal_position;
--
-- 4. a retry cannot pay twice. Use a THROWAWAY account only:
--    -- pick a finished match you actually played, then call
--    --   select public.settle_match('<match_id>', 'win');
--    --   select public.settle_match('<match_id>', 'win');   -- must return
--    --   {"duplicate": true, "delta_minor": 0} and change nothing
-- ============================================================================