-- ============================================================================
-- PASTE THIS WHOLE FILE INTO THE SUPABASE SQL EDITOR AND RUN IT ONCE.
--
--   Dashboard -> your project (khelpfore) -> SQL Editor -> New query
--   -> paste everything below -> Run
--
-- No token needed, and none should be created for this. The build machine cannot run
-- this file through the Management API because that token is not on it, so the shortest
-- path is to run the SQL by hand.
--
-- Forward-only on purpose. It carries ONLY what changed since these functions were
-- first written, so it can be run against the live database without replaying the
-- older migrations - which would recreate tables that players' money has already moved
-- through. It does not touch any table, only four functions.
--
-- 002_live_matches.sql and 015_open_tables.sql stay the source of truth. This file is a
-- convenience copy of the delta between what production has and what it needs. If they
-- ever disagree with it, those two are right and this is stale.
--
-- Safe to run more than once - every statement is create or replace.
-- ============================================================================


-- ============================================================================
-- 1. create_live_match - hands back your existing table instead of refusing.
--
-- Unchanged behaviour, one exception. The guard against a second table per player per
-- mode is untouched: it still returns exactly one table, so there is still nothing to
-- farm. What changed is what the player is told.
--
-- It used to raise "you already have a ludo table open in ludo_quick". Nothing had gone
-- wrong - the player opened a table, walked off the Create button and came back to it,
-- the most ordinary thing in the app - and they were told they had made a mistake. A
-- refusal carries no table, so there was nothing to tap to get back to the one they were
-- trying to reach, and they needed the join code, which is the one thing the open-table
-- work exists to stop requiring.
--
-- The client's createMatch() also recovers from the old raise on its own, so this
-- function is the belt to that pair of braces. Both work; neither depends on the other.
-- ============================================================================
create or replace function public.create_live_match(p_mode text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_match public.live_matches%rowtype;
  v_mode  public.match_modes%rowtype;
  v_id    uuid;
  v_seat  int;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  -- the mode has to exist before anything else, so a typo is reported as a typo
  select * into v_mode from public.match_modes
   where id = p_mode and enabled;
  if not found then raise exception 'unknown mode %', p_mode; end if;

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

  -- One live table per player per mode: stops seat-farming the entry debit.
  --
  -- This returns the table they already have instead of refusing. The guard itself is
  -- the point and is unchanged - the player still ends up with exactly one table, so
  -- there is still nothing to farm. What changed is what the player is told.
  if exists (select 1 from public.live_matches m
             where m.host_id = v_uid and m.mode = p_mode
               and m.status in ('waiting','live')) then
    select * into v_match from public.live_matches m
     where m.host_id = v_uid and m.mode = p_mode
       and m.status in ('waiting','live')
     order by created_at desc limit 1;

    select coalesce(max(player_id) + 1, 1) into v_seat
      from public.live_match_seats where match_id = v_match.id;

    return jsonb_build_object('match_id', v_match.id, 'code', v_match.code,
                              'seat', 0, 'next_seat', v_seat,
                              'existing', true,
                              'entry_minor', v_mode.entry_minor,
                              'prize_minor', v_mode.prize_minor);
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
-- 2. list_open_tables - joinable tables, so a game can be found without a code.
--
-- Until now the only way into a live match was: one player creates a table and reads
-- out a six character code. That works when two people are standing together, and
-- nowhere else. A player opening the app alone saw an empty screen with a "create a
-- table" button and nothing that said anyone was playing - so every new player created a
-- table, waited, and closed the app. The lobby looked dead because it was.
--
-- The stale-table rule is the part that matters more than the listing. An abandoned
-- table and a table waiting for someone are the same row as far as the database is
-- concerned - both are 'waiting'. Listing them together is worse than showing nothing:
-- the list fills with ghosts that cannot be joined, and tapping one says "table is
-- full". So a waiting table nobody has refreshed for a while is simply not listed. It
-- is not deleted - the reaper already owns cleanup, and deleting here would race it.
--
-- 90 seconds is chosen against the turn timer rather than arbitrarily: the clock in a
-- live match is 20 seconds, so a player still in the room refreshes well inside that.
--
-- Deliberately read-only and open to anon. A lobby list is public information by nature
-- - it is how a lobby works - and it carries no personal data: a display name and a game
-- name, both of which the other players are about to see in person anyway. It exposes
-- no code and no user id, so the list cannot be used to walk into a table directly.
--
-- Cost: one indexed read. The index on (status, created_at desc) already exists from
-- 002, so this does not add a sequential scan over every match ever created.
-- ============================================================================
create or replace function public.list_open_tables(p_game text default null)
returns table (
  match_id   uuid,
  game       text,
  mode       text,
  mode_label text,
  seated     int,
  seat_count int,
  entry_minor bigint,
  prize_minor bigint,
  host_name  text,
  refreshed_seconds int,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with open as (
    select m.id, m.game, m.mode, m.seat_count, m.entry_minor, m.prize_minor,
           m.created_at,
           coalesce(max(s.joined_at), m.created_at) as last_seen,
           count(s.player_id)::int as seated,
           (select p.username from public.profiles p
             where p.id = m.host_id) as host_name
      from public.live_matches m
      left join public.live_match_seats s on s.match_id = m.id
     where m.status = 'waiting'
       and (p_game is null or m.game = p_game)
     group by m.id
    having count(s.player_id) < m.seat_count
       and coalesce(max(s.joined_at), m.created_at) > now() - interval '90 seconds'
  )
  select o.id,
         o.game,
         o.mode,
         -- from the modes table rather than live_matches, so a renamed mode shows its
         -- new name in the lobby instead of an id the player cannot read
         coalesce((select mm.label from public.match_modes mm where mm.id = o.mode), o.mode),
         o.seated,
         o.seat_count,
         o.entry_minor,
         o.prize_minor,
         coalesce(o.host_name, 'Player'),
         greatest(0, floor(extract(epoch from (now() - o.last_seen)))::int),
         o.created_at
    from open o
   order by o.last_seen desc
   limit 30;
$$;

-- Readable by a signed-in player, which is the only state this is used from. Granted to
-- anon as well because a lobby should render before login rather than showing an empty
-- screen and asking for a password first; it reveals nothing that identifies anyone.
grant execute on function public.list_open_tables(text) to anon, authenticated;


-- ============================================================================
-- 3. touch_live_table - the host saying "I am still here".
--
-- This is what keeps a table in the list. Without it a lobby can only ever show tables
-- created seconds ago, and a host who has been sitting there for two minutes watching
-- for an opponent would see their own table disappear - which reads as "nobody can join
-- me" at exactly the moment it is untrue.
--
-- It moves joined_at rather than inventing a column. That column already means "when
-- this player took this seat" and nothing else reads it, so the lobby's "is anyone still
-- here" question is answered by the most recent seat event rather than by a second
-- timestamp that could disagree with it.
--
-- Restricted to the host on purpose. Any player could otherwise keep a stale table
-- alive forever and flood the lobby with rooms nobody is sitting in.
-- ============================================================================
create or replace function public.touch_live_table(p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_match public.live_matches%rowtype;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;

  select * into v_match from public.live_matches where id = p_match_id for update;
  if not found then raise exception 'unknown match'; end if;
  if v_match.host_id <> auth.uid() then raise exception 'only the host can hold a table open'; end if;
  if v_match.status <> 'waiting' then raise exception 'match already %', v_match.status; end if;

  update public.live_match_seats set joined_at = now()
   where match_id = p_match_id and user_id = auth.uid();
end; $$;
grant execute on function public.touch_live_table(uuid) to authenticated;


-- ============================================================================
-- 4. join_live_match_by_id - take a seat at a table the lobby is showing.
--
-- Why this exists instead of the client calling join_live_match with a code.
--
-- list_open_tables deliberately does not hand out the join code - otherwise anybody
-- could read every open table's address straight out of the lobby and walk into
-- whoever's game they liked. Listing by match id and joining by match id keeps that
-- promise: the id is not a secret anyone can act on without passing the checks below.
--
-- Every check is a copy of join_live_match's, deliberately rather than by delegation.
-- The alternative was calling join_live_match from here with the code read back out of
-- the row, which is correct but reads as though the code was the thing being passed
-- around, and the next reader would not know which half of it was the real boundary.
-- ============================================================================
create or replace function public.join_live_match_by_id(p_match_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_match public.live_matches%rowtype;
  v_have  int;
  v_taken int;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  -- FOR UPDATE so two players tapping the same row at the same moment cannot both be
  -- told there is a seat. Without it the count is read, both pass the check, and the
  -- second insert fails on the primary key as an error the player cannot act on.
  select * into v_match from public.live_matches where id = p_match_id for update;
  if not found then raise exception 'no such table'; end if;
  if v_match.status <> 'waiting' then raise exception 'that table has already started'; end if;

  -- one seat per player per match, same as the code path
  if exists (select 1 from public.live_match_seats
              where match_id = p_match_id and user_id = v_uid) then
    raise exception 'you are already at this table';
  end if;

  select count(*) into v_have from public.live_match_seats where match_id = p_match_id;
  if v_have >= v_match.seat_count then raise exception 'table is full'; end if;

  -- Opposite corners for a 2p game, exactly as join_live_match seats people: the
  -- engine uses [0,2] for 1v1, so the second seat is 2 and not 1.
  v_taken := case when v_match.seat_count = 2 then 2 else v_have + 1 end;

  insert into public.live_match_seats (match_id, player_id, user_id)
  values (p_match_id, v_taken, v_uid);

  -- The code is disclosed here and only here: to somebody already seated in the match,
  -- who needs it to identify the table to their opponent. The lobby itself never
  -- carries it.
  return jsonb_build_object('match_id', p_match_id, 'code', v_match.code, 'seat', v_taken);
end; $$;
grant execute on function public.join_live_match_by_id(uuid) to authenticated;


-- ============================================================================
-- VERIFY - run this after the four above, before shipping.
--
-- Four rows are expected. If any name is missing, that statement did not apply.
-- ============================================================================
select proname, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and proname in ('create_live_match','list_open_tables','touch_live_table','join_live_match_by_id')
 order by proname;
-- expect:
--   create_live_match      | p_mode text, p_code text
--   join_live_match_by_id  | p_match_id uuid
--   list_open_tables       | p_game text
--   touch_live_table       | p_match_id uuid


-- ============================================================================
-- CHECKS - these need a real table, so they cannot run in the same click.
--
-- 1. The list must not leak the join code or any player id. This is the check that
--    matters most, because the whole join design rests on it:
--      select * from public.list_open_tables() limit 1;
--    -- no `code` column and no user id in the output
--
-- 2. A full table must never be listed. join_live_match refuses a full table, so
--    listing one is listing a row guaranteed to fail:
--      select seated, seat_count from public.list_open_tables();
--    -- every row must satisfy seated < seat_count
--
-- 3. An abandoned table must drop off on its own. Open a table, touch nothing for 90
--    seconds, run query 1 again - expect no rows. The row is still there, just no longer
--    listed; the reaper cleans it up.
--
-- 4. A non-host must not be able to keep a table listed:
--      select public.touch_live_table('<some-match-id>');
--    -- expect: only the host can hold a table open
--
-- 5. create_live_match must still refuse a second real table, only without the error:
--    create a table, then press Create again in the app.
--    -- expect: the same table and the same code come back, not an error banner
-- ============================================================================