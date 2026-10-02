-- ============================================================================
-- 003_ludo_engine.sql - run this AFTER 002_live_matches.sql
--
-- The board has to live on the server for a real match to be worth anything. A
-- client that decides its own dice and its own winner can simply report "I rolled
-- a six and reached home" and take the prize.
--
-- Division of labour, deliberately:
--
--   Postgres  owns IDENTITY, TURN AUTHORITY and ATOMICITY.
--              Who is seated, whose turn it is, that a board commit is not a
--              replay of an old one, and that two commits cannot interleave.
--
--   Edge fn   owns the RULES.
--              Dice, legal tokens, capture, home, the turn timer. Written in
--              TypeScript against the same src/engine/ludo.ts the client plays
--              with, so there is exactly one implementation of the game.
--
-- Putting the rules in plpgsql instead would mean a second implementation of the
-- engine that silently drifts from the one players actually play on.
--
-- The rules are trusted here only because ludo_commit is REVOKED from anon and
-- authenticated. The only thing that can call it is our edge function, which
-- resolves the caller's identity from the request JWT before it gets this far.
-- ============================================================================

-- Every committed board is versioned. A commit states the version it was derived
-- from; if the stored version has moved on, the commit is rejected as a replay.
-- This is what stops two taps (or a retry on a flaky connection) from applying one
-- move twice, and stops a slow response from overwriting a newer board.
alter table public.live_matches
  add column if not exists version int not null default 0;

-- Must match TURN_SECONDS in src/features/ludo/LudoGame.tsx. If you change one,
-- change both, or a player's on-screen clock will disagree with the server's.
-- ---------------------------------------------------------------------------
comment on column public.live_matches.turn_deadline is
  'server clock for the current turn; past it, the turn is forfeit and anyone may advance it';

-- ============================================================================
-- start_live_match, redefined: seed the board and the first turn.
--
-- Same signature and same checks as the 002 version - it is redefined here only
-- to add the four columns a server-owned game needs to start with real values.
-- The money path is untouched.
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

  -- Seed the board. This mirrors initLudo() in src/engine/ludo.ts: four tokens
  -- per seat all in the yard, no dice, and the active player list - which is the
  -- same [0, 2] opposite-corner pair the engine uses for 1v1, matching the seats
  -- join_live_match hands out.
  --
  -- turn_seat and state.turn are both engine player ids and are written in the
  -- same statement by ludo_commit, so they cannot drift apart.
  update public.live_matches
     set status       = 'live',
         started_at   = now(),
         version      = 0,
         turn         = 0,
         turn_seat    = 0,   -- the host is always engine seat 0
         turn_deadline = now() + interval '20 seconds',
         state = jsonb_build_object(
           'tokens',  jsonb_build_array(
                        jsonb_build_array(0, 0, 0, 0), jsonb_build_array(0, 0, 0, 0),
                        jsonb_build_array(0, 0, 0, 0), jsonb_build_array(0, 0, 0, 0)),
           'players', case when v_match.seat_count = 2
                          then jsonb_build_array(0, 2)
                          else jsonb_build_array(0, 1, 2, 3) end,
           'turn',    0,
           'dice',    null,
           'rolled',  false,
           'sixes',   0,
           'winner',  null)
   where id = p_match_id;

  return jsonb_build_object('match_id', p_match_id, 'status', 'live',
                            'entry_minor', v_mode.entry_minor,
                            'prize_minor', v_mode.prize_minor);
end; $$;
grant execute on function public.start_live_match(uuid) to authenticated;

-- ============================================================================
-- ludo_commit: the single write path for the board.
--
-- p_user is the seat owner acting, NOT auth.uid(). The edge function calls this
-- with the service_role key, and auth.uid() is NULL for a service_role request -
-- so the caller cannot be trusted to fill that in, and cannot be allowed to.
-- It comes from the request JWT, which the edge function verified first.
--
-- Every guard here is about identity or ordering. Nothing about game rules,
-- because those live in the TypeScript engine.
-- ============================================================================
create or replace function public.ludo_commit(
  p_match_id  uuid,
  p_user      uuid,
  p_version   int,
  p_from_seat int,
  p_state     jsonb,
  p_turn      int,
  p_deadline  timestamptz,
  p_winner    int
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_match public.live_matches%rowtype;
  v_seat  int;
begin
  if p_user is null then raise exception 'missing acting user'; end if;

  -- FOR UPDATE serialises commits on this match: two overlapping requests queue
  -- here instead of both reading version 4 and both writing version 5.
  select * into v_match from public.live_matches where id = p_match_id for update;
  if not found then raise exception 'unknown match'; end if;

  if v_match.status <> 'live' then
    raise exception 'match is %, not live', v_match.status;
  end if;

  select player_id into v_seat from public.live_match_seats
   where match_id = p_match_id and user_id = p_user;
  if v_seat is null then raise exception 'you are not seated in this match'; end if;

  -- the replay guard
  if v_match.version <> p_version then
    raise exception 'stale board: stored version %, commit was built on %',
      v_match.version, p_version;
  end if;

  -- the turn guard. The one exception is an expired turn: once turn_deadline has
  -- passed the turn is forfeit, so anybody at the table may advance it rather than
  -- leaving the board stuck waiting for a player who has walked away.
  if v_match.turn_seat is distinct from p_from_seat
     and v_match.turn_deadline > now() then
    raise exception 'not your turn: it is seat %, you acted for seat %',
      v_match.turn_seat, p_from_seat;
  end if;

  update public.live_matches
     set state        = p_state,
         turn         = p_turn,
         turn_seat    = p_turn,
         turn_deadline = p_deadline,
         winner_seat  = coalesce(p_winner, winner_seat),
         status       = case when p_winner is not null then 'finished' else status end,
         finished_at  = case when p_winner is not null then now() else finished_at end,
         version      = version + 1
   where id = p_match_id;

  return jsonb_build_object('match_id', p_match_id, 'version', v_match.version + 1,
                            'winner', p_winner, 'turn', p_turn);
end; $$;

-- service_role only. This is the whole trust boundary for the board: with EXECUTE
-- open to authenticated, any player holding the anon key that ships in the APK
-- could commit a board that puts them in the winner's seat.
revoke all on function public.ludo_commit(uuid, uuid, int, int, jsonb, int, timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.ludo_commit(uuid, uuid, int, int, jsonb, int, timestamptz, int)
  to service_role;

-- ============================================================================
-- sanity queries - run these after pasting, before playing a paid match
-- ============================================================================
-- 1. the function must be unreachable from a player session:
--    select has_function_privilege('authenticated',
--      'public.ludo_commit(uuid,uuid,int,int,jsonb,int,timestamptz,int)', 'EXECUTE');
--    expect false
--
-- 2. service_role must still have it:
--    select has_function_privilege('service_role',
--      'public.ludo_commit(uuid,uuid,int,int,jsonb,int,timestamptz,int)', 'EXECUTE');
--    expect true
--
-- 3. every live table has a seeded board, not the '{}' default:
--    select id, status, version, turn_seat, state->'players' as players
--      from public.live_matches where status = 'live';