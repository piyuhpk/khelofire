-- One-off: remove the throwaway accounts the e2e runs created
--
-- scripts/live-e2e.mjs signs up two real accounts per run and leaves them behind, and
-- it says so on every run. Each one was credited the signup bonus, so after a few
-- runs production held dozens of test accounts with real balances in them. They
-- would show up in any leaderboard or admin list, and every one of them is an
-- account a real person could be asked about.
--
-- scripts/deposit-e2e.mjs does the same, and cleans up after itself when it passes.
-- The rows it leaves behind are the ones from the runs that failed before it had a
-- working admin queue to call - which, until 012, was every run. Those are the
-- pending deposits and accounts here.
--
-- Deleted through the same path as any other removal of this kind: a temp table of
-- the ids, then children before parents. There are no foreign keys on profiles in
-- this schema, so the order here is for tidiness rather than to satisfy a
-- constraint - an orphaned settlement row would still be a lie about money that
-- moved, so they go too.
--
-- Scoped to the two prefixes the scripts write, plus the E2E- reference prefix on
-- deposits. It cannot reach a real account or a real bKash reference.

create temporary table e2e_ids on commit drop as
select id from public.profiles
 where username ilike 'e2e-%'
    or username ilike 'deposit-e2e-%';

select count(*) as test_accounts from e2e_ids;

-- live_match_seats has both a player_id (the seat number, an integer) and a user_id
-- (the account, a uuid). Joining on player_id is the obvious mistake and it is a type
-- error as well as a logic one: integer = uuid has no operator.
delete from public.live_match_seats where user_id     in (select id from e2e_ids);
delete from public.live_matches     where host_id     in (select id from e2e_ids);
delete from public.settlements      where user_id     in (select id from e2e_ids);
delete from public.matches          where user_id     in (select id from e2e_ids);
delete from public.transactions     where user_id     in (select id from e2e_ids);
delete from public.deposits         where user_id     in (select id from e2e_ids);
delete from public.withdrawals      where user_id     in (select id from e2e_ids);
delete from public.payment_orders   where user_id     in (select id from e2e_ids);
delete from public.staff            where user_id     in (select id from e2e_ids);
delete from public.profiles         where id          in (select id from e2e_ids);

-- a failed run can leave the request behind with the payer already gone
delete from public.deposits where ref ilike 'E2E-%';

select count(*) as left_over from public.profiles
 where username ilike 'e2e-%' or username ilike 'deposit-e2e-%';
select count(*) as deposits_left from public.deposits where ref ilike 'E2E-%';
select count(*) as pending_left from public.deposits where status = 'pending';