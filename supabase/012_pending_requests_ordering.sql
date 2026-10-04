-- 012: make list_pending_requests actually return
--
-- Found by scripts/deposit-e2e.mjs, which is the first thing to call this function
-- through the admin's own session. It has never returned anything to anyone:
--
--   ERROR: column "d.created_at" must appear in the GROUP BY clause
--          or be used in an aggregate function
--
-- Why it has never worked, and why nothing noticed.
--
-- jsonb_agg(...) is an aggregate. Written as it is, the `order by d.created_at desc
-- limit 100` after the where clause does not order and trim the rows being
-- aggregated - it orders and trims the single aggregated value. Postgres notices
-- that a column of the grouped rows is referenced outside an aggregate and refuses
-- to guess, so the function raises before returning anything.
--
-- The failure is invisible from the app. sync.ts calls
-- wallet.fetchPendingRequests().catch(...) on purpose, so a staff account with a
-- broken queue does not fail to load its own profile and match history - the catch
-- turns this exception into an empty queue. An admin opening the Payments tab saw
-- an empty list and no error, which is indistinguishable from a day with nothing to
-- review. Deposits kept arriving, held the player's money, and could never be
-- approved from the app. 007 fixed the row being hidden; this is why there was
-- nothing to see in the first place.
--
-- The ordering and limit move inside a subquery, so they apply to rows before they
-- reach the aggregate. jsonb_agg then folds those rows in the order it is given
-- them, which is what "newest first, at most 100" was always meant to mean.

create or replace function public.list_pending_requests()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := public.is_staff();
begin
  if v_role is null then raise exception 'not authorised - your account has no staff role'; end if;

  return jsonb_build_object(
    'deposits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'user', coalesce(s.username, split_part(s.user_id::text, '-', 1)),
        'amount_minor', s.amount_minor,
        'method', s.method,
        'ref', s.ref,
        'ts', s.created_at))
      from (
        select d.id, d.user_id, d.amount_minor, d.method, d.ref, d.created_at, p.username
          from public.deposits d
          left join public.profiles p on p.id = d.user_id
         where d.status = 'pending'
         order by d.created_at desc
         limit 100
      ) s
    ), '[]'::jsonb),
    'withdrawals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'user', coalesce(s.username, split_part(s.user_id::text, '-', 1)),
        'amount_minor', s.amount_minor,
        'method', s.method,
        'account', s.account,
        'ts', s.created_at))
      from (
        select w.id, w.user_id, w.amount_minor, w.method, w.account, w.created_at, p.username
          from public.withdrawals w
          left join public.profiles p on p.id = w.user_id
         where w.status = 'pending'
         order by w.created_at desc
         limit 100
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.list_pending_requests() to authenticated;