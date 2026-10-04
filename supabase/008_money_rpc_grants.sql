-- 008: the money RPCs were revoked from everyone and granted to no one
--
-- Symptom: the admin Payments/Withdrawals tabs could not approve or reject a
-- single request, and no live match could ever be settled.
--
-- Cause: 004 revokes decide_deposit/decide_withdrawal from
-- 'public, anon, authenticated' and then never grants them to service_role.
-- That revoke is correct - a player's browser must not be able to mark their own
-- deposit paid - but the admin-wallet Edge Function runs as service_role, so the
-- only thing that was left able to call them was nobody. Every approve and every
-- reject failed with a permission error.
--
-- service_role is granted explicitly, rather than relying on it inheriting the
-- default PUBLIC execute, because relying on PUBLIC is exactly how the old
-- settle_match(text,text,text) overload stayed callable at all.
--
-- The decision path stays staff-checked inside the function (p_staff is verified
-- against the staff table), so granting service_role does not make it a free pass
-- for anything: it is only the network identity the Edge Function already has.

grant execute on function public.decide_deposit(uuid, boolean, uuid) to service_role;
grant execute on function public.decide_withdrawal(uuid, boolean, uuid) to service_role;

-- settle_match is called by authenticated players from the client, and by the
-- Edge Function in the server-authoritative path. Grant service_role for the same
-- reason; the function itself refuses to settle a match the caller is not seated
-- in, or one that is not finished.

grant execute on function public.settle_match(uuid, text) to service_role;
-- The legacy overload is not granted to anything. It took a client-supplied entry,
-- prize and outcome, so it must not be reachable by any role; 002 revoked it only
-- from anon and authenticated, which left it on PUBLIC - the default grant every
-- function is created with - and therefore still callable by service_role through
-- the admin-wallet client.

revoke execute on function public.settle_match(text, text, text) from public;
revoke execute on function public.settle_match(text, text, text) from anon, authenticated, service_role;