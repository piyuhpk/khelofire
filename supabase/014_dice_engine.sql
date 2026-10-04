-- ============================================================================
-- 014_dice_engine.sql - run this AFTER 003_ludo_engine.sql
--
-- Makes the money path game-aware, so a match is seeded by the game it is actually
-- playing rather than always by Ludo.
--
-- Why this file exists.
--
-- 011 deactivated dice_1v1 because a paid mode with no engine behind it is the most
-- expensive kind of bug in this app: the player is charged for a match that cannot be
-- delivered. src/engine/dice.ts is now the rules, but rules alone change nothing while
-- start_live_match still seeds a Ludo board for every match. A Dice table would have
-- handed the player four tokens and a six to move, which is a Ludo board labelled
-- "Dice Duel" - it would start, and it would be nonsense.
--
-- So this file does the one job that is actually missing: it seeds each match from its
-- own game's initial state, and it refuses to start a paid match for a game that has
-- no engine. Both halves are deliberate.
--
-- The refusal is the part worth arguing for. game_seed_state covers ludo and dice, so
-- without it a future guti_1v1 could be switched on in the admin panel and start a live
-- match that seeded... nothing, because guti is not in the table. The engine check makes
-- that a failed start rather than a corrupted board, which is the same failure 011 was
-- written to prevent. Adding a game now means adding its seed and nothing else.
--
-- Deliberately NOT reactivated here: match_modes. dice_1v1 stays inactive until the
-- edge function can drive a Dice match and a phone can render one. Flipping `active`
-- in this file would re-open the exact hole 011 closed, one game earlier than the
-- product is ready for. The final line of this file states that plainly so nobody
-- "finishes" it by accident.
--
-- What is deliberately NOT duplicated:
--   - ludo_commit is not forked into dice_commit. Its guards are identity and ordering
--     (which seat, which version, is it your turn) and contain no game rules at all, so
--     it is already correct for Dice and a second copy could only drift out of step.
--   - the rules are not reimplemented in plpgsql. They live in src/engine/dice.ts and
--     are driven by the edge function, which is why this file seeds a board and stops.
-- ============================================================================

-- ============================================================================
-- game_seed_state: the opening board for a game, in one place.
--
-- This mirrors initLudo() and initDice() in src/engine. Each returned object must match
-- its engine's shape exactly - a field the engine expects but the seed omits reads as
-- undefined, and a field it does not expect is dead weight the phone has to guess about.
-- tests/dice-seed.test.ts checks the dice seed against initDice() so the two cannot
-- drift apart silently, which is the failure this table is most exposed to.
--
-- seat_count is passed in because Ludo plays 2p or 4p off the same engine. Dice is 2p
-- only and says so by ignoring it.
-- ============================================================================
create or replace function public.game_seed_state(p_game text, p_seat_count int)
returns jsonb language sql immutable as $$
  select case p_game
    -- Ludo: four tokens per seat all in the yard, no dice, and the active player list -
    -- the [0, 2] opposite-corner pair the engine uses for 1v1, matching the seats
    -- join_live_match hands out.
    when 'ludo' then jsonb_build_object(
      'tokens',  jsonb_build_array(
                   jsonb_build_array(0, 0, 0, 0), jsonb_build_array(0, 0, 0, 0),
                   jsonb_build_array(0, 0, 0, 0), jsonb_build_array(0, 0, 0, 0)),
      'players', case when p_seat_count = 2
                     then jsonb_build_array(0, 2)
                     else jsonb_build_array(0, 1, 2, 3) end,
      'turn',    0,
      'dice',    null,
      'rolled',  false,
      'sixes',   0,
      'winner',  null)

    -- Dice Duel: mirrors initDice() in src/engine/dice.ts.
    --
    -- thrownRound is null and must stay null here. It is the field that says which round
    -- the visible dice belong to; if the seed filled it in, the first throw would be
    -- refused as a duplicate of the seeded round and the match would sit on round one
    -- until the clock forfeited it.
    --
    -- The host opens every match (initiator 0). Same as Ludo's seat 0, and it is a fair
    -- default rather than a lasting advantage: nextInitiator alternates by round, so an
    -- even match is not one where seat 0 always sees its own throw first.
    when 'dice' then jsonb_build_object(
      'round',       1,
      'initiator',   0,
      'dice',        null,
      'thrownRound', null,
      'scores',      jsonb_build_array(0, 0),
      'turn',        0,
      'winner',      null)

    else null
  end;
$$;
grant execute on function public.game_seed_state(text, int) to anon, authenticated, service_role;

-- ============================================================================
-- start_live_match, redefined: seed the board and the first turn, per game.
--
-- Same signature and same checks as the 003 version, and the money path is untouched.
-- The only change is where the board comes from: game_seed_state(v_mode.game, ...) in
-- place of a hardcoded Ludo board.
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
  v_seed   jsonb;
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

  -- The engine check. Reached before anyone is charged, so a mode that promises a game
  -- the server cannot play fails as a refusal with both wallets untouched, rather than
  -- taking money and then failing to produce a match. A practice mode is exempt: entry
  -- 0 buys nothing, so it cannot strand a payment and it is a local game anyway.
  if v_mode.entry_minor > 0 and public.game_seed_state(v_mode.game, v_match.seat_count) is null then
    raise exception 'mode % is a paid % match and the server has no % engine for it',
      v_match.mode, v_mode.game, v_mode.game;
  end if;

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

  v_seed := public.game_seed_state(v_mode.game, v_match.seat_count);

  -- Seed the board. turn_seat and state.turn are both engine player ids and are written
  -- in the same statement by ludo_commit, so they cannot drift apart.
  --
  -- The 20-second clock must stay in step with DICE_TURN_SECONDS in src/engine/dice.ts
  -- and with the Ludo constant. If one moves without the others, a player's on-screen
  -- clock disagrees with the server's, and one of them is wrong about whose turn it is.
  update public.live_matches
     set status       = 'live',
         started_at   = now(),
         version      = 0,
         turn         = 0,
         turn_seat    = 0,   -- the host is always engine seat 0
         turn_deadline = now() + interval '20 seconds',
         state = v_seed
   where id = p_match_id;

  return jsonb_build_object('match_id', p_match_id, 'status', 'live',
                            'game', v_mode.game,
                            'entry_minor', v_mode.entry_minor,
                            'prize_minor', v_mode.prize_minor);
end; $$;
grant execute on function public.start_live_match(uuid) to authenticated;

-- ============================================================================
-- NOT reactivated on purpose: match_modes.
--
-- dice_1v1 stays inactive until all three of these exist:
--   1. the edge function can commit a Dice match end to end,
--   2. a phone can render a live Dice match and reconnect to one,
--   3. a full entry-to-prize run has been verified against production money.
--
-- Flip it in a later migration, once, and only after that run. Reactivating it here
-- would take a player's money for a game the server cannot yet deliver - which is the
-- exact failure 011 exists to prevent.
-- ============================================================================
-- select count(*) as paid_modes_without_an_engine
--   from public.match_modes m
--  where m.active and m.entry_minor > 0
--    and public.game_seed_state(m.game, coalesce(m.max_players, 2)) is null;
-- expect 0

-- ============================================================================
-- sanity queries - run these after pasting, before playing a paid match
-- ============================================================================
-- 1. ludo seeds are byte-identical to the ones 003 used, so this migration cannot have
--    changed any existing paid Ludo match:
--    select p_game, p_seat_count, game_seed_state('ludo', p_seat_count)->'players' as players
--      from (values (2),(4)) as v(p_seat_count);
--    expect [0,2] and [0,1,2,3]
--
-- 2. the dice seed has every field initDice() produces, and no others:
--    select array(select jsonb_object_keys(game_seed_state('dice', 2)));
--    expect {dice,initiator,round,scores,thrownRound,turn,winner}
--
-- 3. an unknown game seeds to null, which is what makes the refusal in start_live_match
--    possible:
--    select game_seed_state('chess', 2) is null, game_seed_state('guti', 2) is null;
--    expect true, true
--
-- 4. the seed is exposed read-only and reveals nothing private - it is a fixed table of
--    positions, and a client asking what the opening board is gains no advantage:
--    select has_function_privilege('anon', 'public.game_seed_state(text,int)', 'EXECUTE');
--    expect true