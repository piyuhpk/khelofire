-- 009: resigning a live match, which previously had no server path at all
--
-- Symptom: pressing Resign on a real board threw, the promise was voided with no
-- catch, and the client navigated home regardless. settle_match refuses to settle
-- anything that is not finished, and nothing could make a live match finished
-- except playing it out - so resigning left status='live' with both entries
-- debited for ever. Neither player could ever settle, and the opponent kept
-- playing a board whose owner had vanished. ExitModal did the same with no RPC.
--
-- The fix is deliberately NOT a way to hand the prize to whoever asks. The board is
-- decided for the OTHER seated player and the caller is recorded as the forfeiter,
-- so the only money path is settle_match paying the winner what the winner's own
-- forfeit entitlement is: the entry. Nothing here moves money.
--
-- winner_seat is derived from the seats table rather than accepted from the caller.
-- A client able to name the winner would be exactly the money bug this closes.
--
-- The board lives on live_matches.state (a jsonb column seeded by
-- start_live_match), so the same winner is written into state.winner as well -
-- otherwise the other player's client would keep polling a board that says someone
-- is still playing after the match had already been decided.

create or replace function public.resign_live_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_match public.live_matches%rowtype;
  v_seat  int;
  v_other int;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  select * into v_match from public.live_matches where id = p_match_id for update;
  if not found then raise exception 'unknown match'; end if;

  select player_id into v_seat
    from public.live_match_seats
   where match_id = p_match_id and user_id = v_uid;
  if v_seat is null then raise exception 'you are not seated in this match'; end if;

  -- Already decided by playing it out: report the truth rather than overwriting it.
  if v_match.status = 'finished' then
    return jsonb_build_object('match_id', p_match_id, 'status', 'finished',
                              'winner_seat', v_match.winner_seat, 'already_settled', true);
  end if;

  -- Nothing has been debited yet, so there is nothing to refund and no forfeit to
  -- decide. Leaving a waiting table frees the seat; the table only closes if the
  -- host was the one who left.
  if v_match.status = 'waiting' then
    delete from public.live_match_seats where match_id = p_match_id and user_id = v_uid;
    if v_match.host_id = v_uid and
       not exists (select 1 from public.live_match_seats where match_id = p_match_id) then
      update public.live_matches
         set status = 'cancelled', finished_at = now()
       where id = p_match_id and status = 'waiting';
    end if;
    return jsonb_build_object('match_id', p_match_id, 'status', 'waiting', 'left', true);
  end if;

  if v_match.status <> 'live' then
    return jsonb_build_object('match_id', p_match_id, 'status', v_match.status, 'left', true);
  end if;

  -- A forfeit has exactly one winner: another seated player. Refuse rather than
  -- invent one on an empty table.
  select player_id into v_other
    from public.live_match_seats
   where match_id = p_match_id and player_id <> v_seat
   order by player_id
   limit 1;
  if v_other is null then raise exception 'no opponent is seated - the table is empty'; end if;

  update public.live_matches
     set status       = 'finished',
         winner_seat  = v_other,
         finished_at  = now(),
         forfeit_by   = v_seat,
         state        = jsonb_set(state, '{winner}', to_jsonb(v_other))
   where id = p_match_id and status = 'live';

  if not found then
    -- Somebody else decided it a moment ago. Their answer stands; a second forfeit
    -- must not be able to change who won.
    select * into v_match from public.live_matches where id = p_match_id;
    return jsonb_build_object('match_id', p_match_id, 'status', v_match.status,
                              'winner_seat', v_match.winner_seat, 'already_settled', true);
  end if;

  return jsonb_build_object('match_id', p_match_id, 'status', 'finished',
                            'winner_seat', v_other, 'forfeit_by', v_seat);
end; $$;

grant execute on function public.resign_live_match(uuid) to authenticated;

-- forfeit_by records WHICH seat walked away, so "I did not resign" has something to
-- check against instead of nothing at all. It is also how an abandoned match is
-- distinguished from a completed one after the fact.
do $$ begin
  alter table public.live_matches add column if not exists forfeit_by int;
exception when duplicate_object then null; end $$;

-- ============================================================================
-- reaper: a live match must not stay live for ever
--
-- With no resign path and nothing sweeping abandoned tables, a client that closed
-- the app mid-match left the opponent polling a board nobody would ever move, and
-- left both entries debited and unsettleable. Comments in src/lib/live.ts and
-- LiveTables.tsx referred to "the reaper" as if it existed; it did not.
--
-- Deliberately a plain idempotent state fix, not a money function: a live match
-- whose turn deadline passed more than p_older_than ago is abandoned, and the
-- forfeit goes to a seat that is still there. The entry still only moves through
-- settle_match. Safe to call repeatedly, and safe to call with nobody seated - it
-- cancels rather than finishing a match with no winner.

create or replace function public.reap_abandoned_live_matches(p_older_than interval default interval '15 minutes')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m     public.live_matches%rowtype;
  v_seat  int;
  v_other int;
  v_n     int := 0;
begin
  for v_m in
    select * from public.live_matches
     where status = 'live' and turn_deadline is not null
       and turn_deadline < now() - p_older_than
     for update skip locked
  loop
    select player_id into v_other
      from public.live_match_seats
     where match_id = v_m.id
     order by player_id
     limit 1;

    if v_other is null then
      -- Nobody left to award it to. Cancelled, not finished: there is no winner.
      update public.live_matches
         set status = 'cancelled', finished_at = now()
       where id = v_m.id and status = 'live';
    else
      -- forfeit_by is left null on purpose: nobody chose this, and claiming one
      -- did would put a false accusation against a seat that may have been the
      -- victim of a dropped connection.
      update public.live_matches
         set status      = 'finished',
             winner_seat = v_other,
             finished_at = now(),
             state       = jsonb_set(state, '{winner}', to_jsonb(v_other))
       where id = v_m.id and status = 'live';
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;

revoke execute on function public.reap_abandoned_live_matches(interval) from public, anon, authenticated;
grant execute on function public.reap_abandoned_live_matches(interval) to service_role;