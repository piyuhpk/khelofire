-- 007: a pending payment request must never be invisible to staff
--
-- Symptom: 21 rows existed in public.deposits, but the admin Payments and
-- Withdrawals tabs showed an empty queue with no error.
--
-- Cause: list_pending_requests() joined public.deposits to public.profiles with an
-- inner join. Any deposit whose user had no profiles row was filtered out before
-- the aggregate ever saw it. That is the worst possible failure for this table:
-- the row still held the player's money and still awaited a decision, but no one
-- reviewing the queue could find it to approve or reject it, and nothing reported
-- a problem. An account can be missing its profile (a signup whose trigger did not
-- fire, an auth row inserted directly, a profile delete cascading the wrong way),
-- and none of that should hide a payment.
--
-- Fix: left join. The username is decoration for the reviewer; it must not decide
-- whether the row appears at all. COALESCE keeps the label readable when there is
-- no profile, so the reviewer can still identify whose request this is by email or
-- id rather than by a blank cell.
--
-- 'not authorised' is also separated from 'no rows': the function still raises on a
-- non-staff caller, but that is an error the panel must show rather than swallow.

create or replace function public.list_pending_requests()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := public.is_staff();
begin
  if v_role is null then raise exception 'not authorised - your account has no staff role'; end if;

  return jsonb_build_object(
    'deposits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'user', coalesce(p.username, split_part(d.user_id::text, '-', 1)),
        'amount_minor', d.amount_minor,
        'method', d.method,
        'ref', d.ref,
        'ts', d.created_at))
      from public.deposits d left join public.profiles p on p.id = d.user_id
      where d.status = 'pending' order by d.created_at desc limit 100), '[]'::jsonb),
    'withdrawals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id,
        'user', coalesce(p.username, split_part(w.user_id::text, '-', 1)),
        'amount_minor', w.amount_minor,
        'method', w.method,
        'account', w.account,
        'ts', w.created_at))
      from public.withdrawals w left join public.profiles p on p.id = w.user_id
      where w.status = 'pending' order by w.created_at desc limit 100), '[]'::jsonb)
  );
end; $$;
grant execute on function public.list_pending_requests() to authenticated;
