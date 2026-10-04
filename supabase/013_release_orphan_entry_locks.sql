-- 013: release entry locks that no match is holding
--
-- Two accounts were found with locked_minor > 0 while public.live_matches was
-- completely empty: 152500 (1,525 BDT) and 2000 (20 BDT). An entry lock is supposed to
-- be released by settle_match or by a refund when a match is cancelled. Neither can
-- happen now - there is no match, so no code path will ever touch those rows again.
--
-- That money is not lost in a ledger sense, it is simply unreachable: available_minor
-- excludes it and nothing will ever add it back. From the player's side it is money
-- that disappeared at the word "Join" and support has no button to return it.
--
-- Where it came from: the old ExternalArena flow. Those entries were debited for
-- tournaments that never existed (see the removal in that file), so the match those
-- locks were waiting on could never start and could never release them.
--
-- Narrow on purpose. Only rows whose locked_minor is not currently held by a seated,
-- unfinished live match are touched, so running this against a live table cannot
-- release a real player's in-progress entry. The whole statement is a no-op when
-- there is nothing stuck, which is the normal case from here on.
--
-- Each release is journalled rather than applied as a bare update, so the balance a
-- player sees can be explained line by line if they ever ask where it came from.

do $$
declare
  r record;
begin
  for r in
    select p.id, p.username, p.locked_minor
      from public.profiles p
     where p.locked_minor > 0
       and not exists (
         select 1
           from public.live_match_seats s
           join public.live_matches m on m.id = s.match_id
          where s.user_id = p.id
            and m.status not in ('finished', 'cancelled')
       )
  loop
    update public.profiles
       set locked_minor = 0,
           available_minor = available_minor + r.locked_minor
     where id = r.id;

    insert into public.transactions (user_id, amount_minor, note, status)
    values (r.id, r.locked_minor,
            'Entry returned · no match was ever created for it', 'completed');

    raise notice 'released % minor to %', r.locked_minor, r.username;
  end loop;
end;
$$;