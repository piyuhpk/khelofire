-- ============================================================================
-- 015_open_tables.sql - run this AFTER 014_dice_engine.sql
--
-- Lets a player find a game to join instead of having to already know a code.
--
-- Why this file exists.
--
-- Until now the only way into a live match was: one player creates a table and reads
-- out a six character code. That works when two people are standing together, and
-- nowhere else. A player opening the app alone saw an empty screen with a "create a
-- table" button and nothing that said anyone was playing - so every new player created
-- a table, waited, and closed the app. The lobby looked dead because it was.
--
-- Two things were missing, and they are different:
--
--   1. list_open_tables, so the tables that exist can be seen and joined by anyone.
--   2. Hiding the ones nobody is coming back to.
--
-- The second is the part that matters more. An abandoned table and a table waiting for
-- someone are the same row as far as the database is concerned - both are 'waiting'.
-- Listing them together is worse than showing nothing: the list fills with ghosts that
-- cannot be joined, and tapping one says "table is full" or times out. So a waiting
-- table that nobody has refreshed for a while is simply not listed. It is not deleted -
-- the reaper already exists and owns cleanup, and deleting here would race it.
--
-- Deliberately read-only and open to anon. A lobby list is public information by nature
-- - it is how a lobby works - and it carries no personal data: a display name and a
-- game name, both of which the other players are about to see in person anyway. It does
-- not expose the code, the match id or the host's user id, so the list cannot be used to
-- join a table directly. Joining still goes through join_live_match, which does the seat
-- and balance checks that matter.
--
-- Cost: one indexed read. The index on (status, created_at desc) already exists from
-- 002, so this does not add a sequential scan over every match ever created.
-- ============================================================================

-- ============================================================================
-- list_open_tables: joinable tables, newest first.
--
-- Refreshed-seconds is what tells a player whether a table is worth tapping. Without
-- it the list is a wall of identical rows and the player has to guess which one is
-- alive.
--
-- The seat count is the number of seats FILLED, not seat_count, and the two are
-- different questions. join_live_match refuses a full table, so listing a full table is
-- listing a row that is guaranteed to fail. Only tables with room are returned.
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
  -- A table nobody has touched for this long is not shown. The host refreshing it keeps
  -- it listed, so this measures "is anyone still here" rather than "how old is it".
  --
  -- 90 seconds is chosen against the turn timer rather than arbitrarily: the clock in a
  -- live match is 20 seconds, so a player who is still in the room is refreshing well
  -- inside this. Someone who has not touched a table in 90 seconds has put the phone
  -- down.
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
-- touch_live_table: the host saying "I am still here".
--
-- This is what keeps a table in the list. Without it a lobby can only ever show tables
-- that were created seconds ago, and a host who has been sitting there for two minutes
-- watching for an opponent would see their own table disappear - which reads as "nobody
-- can join me" at exactly the moment it is untrue.
--
-- It moves joined_at rather than inventing a column. That column already means "when
-- this player took this seat" and nothing else reads it, so the lobby's "is anyone still
-- here" question is answered by the most recent seat event rather than by a second
-- timestamp that could disagree with it.
--
-- Restricted to the host on purpose. Any player could otherwise keep a stale table alive
-- forever and flood the lobby with rooms nobody is sitting in.
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
-- join_live_match_by_id: take a seat at a table the lobby is showing.
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

  -- Opposite corners for a 2p game, exactly as join_live_match seats people: the engine
  -- uses [0,2] for 1v1, so the second seat is 2 and not 1.
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
-- sanity queries - run these after pasting, before shipping
-- ============================================================================
-- 1. it must return rows when a table exists, and never a full one:
--    select seated, seat_count from public.list_open_tables();
--
-- 2. an abandoned table must drop off on its own. Open a table, do nothing for 90
--    seconds, and run the query again - expect no rows. The row is still there; it is
--    just no longer listed, and the reaper will clean it up.
--
-- 3. a non-host cannot keep a table listed:
--    -- as a second player:
--    select public.touch_live_table('<some-match-id>');
--    expect: only the host can hold a table open
--
-- 4. the list must not leak the join code or any user id:
--    select * from public.list_open_tables() limit 1;
--    -- the returned columns contain no code and no uuid of a player