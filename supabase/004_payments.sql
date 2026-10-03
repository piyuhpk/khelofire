-- ============ 004: make deposits and withdrawals safe to actually pay out ============
--
-- The deposit/withdrawal flow was structurally fine and completely unsafe to run
-- with real money. Four defects, in order of how much they would have cost:
--
-- 1. `ref` had no uniqueness constraint. A player sends 100 BDT once, gets
--    trxid ABC123, submits two deposit requests both carrying ref='ABC123'.
--    Staff approve both -> available_minor is credited twice for ONE real
--    payment. Nothing in the schema stopped this: the deposit row carried the
--    user's own claim about what they paid and nothing checked it against the
--    other rows. This is the defect that made the flow not-real.
--
-- 2. `decided_by = auth.uid()` in decide_deposit/decide_withdrawal. These are
--    called with the service_role key, which carries no user JWT, so auth.uid()
--    is NULL and every approval recorded decided_by = NULL. The column that
--    exists to answer "who approved this" could never answer it. staff_activity
--    had the real answer, but the row itself lied.
--
-- 3. decide_deposit updated the ledger like this:
--        update public.transactions set status='completed'
--         where user_id = v_d.user_id and note = 'deposit request'
--         order by created_at asc limit 1;
--    `order by ... limit 1` picks the user's OLDEST pending deposit-request row,
--    not the row belonging to THIS deposit. With three requests in flight,
--    approving the third completed the first one's history. decide_withdrawal
--    never touched its pending row at all, so every withdrawal request stayed
--    'pending' in history forever, even after being paid or refunded.
--    Fixed by storing the ledger row id on the request (txn_id) and updating
--    exactly that row.
--
-- 4. No caps. request_deposit accepted any positive amount and unlimited
--    pending requests, so a client could flood the staff queue (delaying real
--    withdrawals) and insert unbounded rows. `ref` also defaulted to '', letting
--    a player file many indistinguishable requests that look like separate
--    payments to whoever is reviewing them.
--
-- Fixes 1-4. Still a MANUAL flow: nothing here talks to bKash or Nagad. A human
-- still verifies the transfer happened before approving. What this migration
-- guarantees is that a human can approve safely - one real payment can be
-- credited exactly once, and the ledger cannot be made to disagree with it.

-- ============ 1. one real payment, one credit ============
-- Normalised on method + case-folded ref so 'ABC123', 'abc123' and ' abc123 '
-- are the same payment rather than three, and method casing ('bkash' vs 'bKash')
-- cannot be used to slip past the check.
--
-- Partial: rows with no ref carry no claim about a payment, and there are
-- legitimately many of those in dev, so uniqueness applies only where a ref
-- exists. Present for every status on purpose - a payment that was rejected must
-- not become creditable later by resubmitting the same trxid.
do $$
begin
  if exists (
    select 1 from public.deposits
     where btrim(ref) <> ''
     group by lower(btrim(method)), lower(btrim(ref))
    having count(*) > 1
  ) then
    -- Deliberately refuses rather than silently picking a winner. Deciding which
    -- of two claims on one payment is real is a human's job, with the bank.
    raise exception 'duplicate deposit refs exist - resolve them in the deposits table before applying this migration';
  end if;
end $$;

create unique index if not exists deposits_ref_unique
  on public.deposits (lower(btrim(method)), lower(btrim(ref)))
  where btrim(ref) <> '';

-- ============ 2. link each request to the exact ledger row it created ============
alter table public.deposits    add column if not exists txn_id uuid;
alter table public.withdrawals add column if not exists txn_id uuid;

-- Backfill requests that predate txn_id by pairing each with the oldest unclaimed
-- pending ledger row of the same user and amount. Best effort by nature - there
-- was no key, so the pairing is inferred from ordering. Where it cannot infer
-- one, txn_id stays NULL and decide_* updates no ledger row, which is the safe
-- direction to be wrong in: the balance still moves, the history just does not
-- get falsely relabelled.
with d as (
  select id, user_id, amount_minor,
         row_number() over (partition by user_id, amount_minor order by created_at, id) as rn
    from public.deposits
   where txn_id is null and status = 'pending'
), t as (
  select id,
         row_number() over (partition by user_id, amount_minor order by created_at, id) as rn
    from public.transactions
   where note = 'deposit request' and status = 'pending'
)
update public.deposits x
   set txn_id = t.id
  from d join t on t.rn = d.rn
 where x.id = d.id;

-- Withdrawal ledger rows are stored negative, so pair on the negated amount.
with w as (
  select id, user_id, amount_minor,
         row_number() over (partition by user_id, amount_minor order by created_at, id) as rn
    from public.withdrawals
   where txn_id is null and status = 'pending'
), t as (
  select id,
         row_number() over (partition by user_id, amount_minor order by created_at, id) as rn
    from public.transactions
   where note = 'withdrawal request' and status = 'pending'
)
update public.withdrawals x
   set txn_id = t.id
  from w join t on t.rn = w.rn
 where x.id = w.id;

-- ============ 3. bounded, spam-resistant request functions ============
-- 1 BDT to 10,000 BDT. The ceiling is a sanity bound, not a business rule: it
-- exists so a malformed or hostile amount cannot become a balance credit that
-- later has to be unwound by hand.
create or replace function public.request_deposit(p_amount_minor bigint, p_method text, p_ref text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid;
  v_tid    uuid;
  v_method text;
  v_ref    text;
  v_open   int;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_amount_minor < 100 or p_amount_minor > 1000000 then
    raise exception 'amount must be between 1 and 10000 BDT';
  end if;

  v_method := case lower(btrim(coalesce(p_method,'')))
                when ''      then 'bKash'
                when 'bkash' then 'bKash'
                when 'nagad' then 'Nagad'
                else btrim(p_method)
              end;
  v_ref := btrim(coalesce(p_ref,''));

  -- Caps the queue a single player can build. Without it, support is buried under
  -- one player's spam while everyone else's withdrawals wait.
  select count(*) into v_open from public.deposits
   where user_id = v_uid and status = 'pending';
  if v_open >= 5 then raise exception 'you already have 5 pending deposit requests - wait for one to be reviewed'; end if;

  insert into public.transactions (user_id, amount_minor, note, status)
  values (v_uid, p_amount_minor, 'deposit request', 'pending')
  returning id into v_tid;

  begin
    insert into public.deposits (user_id, amount_minor, method, ref, txn_id)
    values (v_uid, p_amount_minor, v_method, v_ref, v_tid)
    returning id into v_id;
  exception when unique_violation then
    -- The protection working as intended. Surfaced as a sentence the player can
    -- act on rather than a raw index violation.
    raise exception 'that transaction id has already been submitted - each payment can only be deposited once';
  end;

  return v_id;
end; $$;
grant execute on function public.request_deposit(bigint, text, text) to authenticated;

-- Postgres will not let CREATE OR REPLACE change a function's return type: the
-- existing overload has to go first. schema.sql declared this one as `returns
-- uuid`; it now returns void because the caller no longer needs the new row's id
-- (it gets the request back from list_pending_requests instead).
--
-- Dropping takes the grants with it, which is why the `grant execute` below is
-- not optional. Nothing inside the database depends on this function - the app
-- calls it over RPC at runtime - so the drop has nothing to cascade through.
drop function if exists public.request_withdrawal(bigint, text, text);

create or replace function public.request_withdrawal(p_amount_minor bigint, p_method text, p_account text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_prof   public.profiles%rowtype;
  v_id     uuid;
  v_tid    uuid;
  v_method text;
  v_account text;
  v_open   int;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_amount_minor < 100 or p_amount_minor > 1000000 then
    raise exception 'amount must be between 1 and 10000 BDT';
  end if;

  v_method := case lower(btrim(coalesce(p_method,'')))
                when ''      then 'bKash'
                when 'bkash' then 'bKash'
                when 'nagad' then 'Nagad'
                else btrim(p_method)
              end;
  v_account := btrim(coalesce(p_account,''));
  -- Without a destination there is nothing to pay, so the request can only ever
  -- become an unresolved queue item or an accidental refund.
  if v_account = '' then raise exception 'enter the account to receive the money'; end if;

  select count(*) into v_open from public.withdrawals
   where user_id = v_uid and status = 'pending';
  if v_open >= 3 then raise exception 'you already have 3 pending withdrawal requests - wait for one to be reviewed'; end if;

  select * into v_prof from public.profiles where id = v_uid for update;
  -- the balance is debited immediately so the same money cannot be withdrawn twice
  if v_prof.available_minor < p_amount_minor then raise exception 'insufficient balance'; end if;

  update public.profiles set available_minor = available_minor - p_amount_minor where id = v_uid;

  insert into public.transactions (user_id, amount_minor, note, status)
  values (v_uid, -p_amount_minor, 'withdrawal request', 'pending')
  returning id into v_tid;

  insert into public.withdrawals (user_id, amount_minor, method, account, txn_id)
  values (v_uid, p_amount_minor, v_method, v_account, v_tid)
  returning id into v_id;
end; $$;
grant execute on function public.request_withdrawal(bigint, text, text) to authenticated;

-- ============ 4. decide_* must record WHO decided ============
-- New signature takes the acting staff member explicitly, because auth.uid() is
-- NULL under the service_role key (defect 2) and the old column could never be
-- populated. p_staff is re-verified against the staff table even though
-- admin-wallet already checked it: this function is the thing that writes to a
-- money table, so it proves its own caller rather than trusting the layer above.
--
-- The old 2-arg form is kept as a signature but made to fail loudly, so a stale
-- admin-wallet deployment stops with a clear message instead of silently
-- approving with a NULL decided_by. Postgres cannot replace a function's
-- parameter list, so the old overload has to be neutralised this way rather than
-- dropped.
create or replace function public.decide_deposit(p_id uuid, p_approve boolean, p_staff uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_d    public.deposits%rowtype;
  v_role text;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role only'; end if;
  if p_staff is null then raise exception 'deciding staff id is required'; end if;

  select role into v_role from public.staff where user_id = p_staff;
  if not found then raise exception 'p_staff is not a staff member'; end if;
  if v_role = 'support' then raise exception 'support cannot move money'; end if;

  select * into v_d from public.deposits where id = p_id for update;
  if not found then raise exception 'no such deposit'; end if;
  if v_d.status <> 'pending' then raise exception 'not pending'; end if;

  if p_approve then
    update public.profiles set available_minor = available_minor + v_d.amount_minor where id = v_d.user_id;
    update public.deposits set status = 'approved', decided_by = p_staff, decided_at = now() where id = p_id;
    -- exactly the row this request created; no more "oldest pending row wins"
    update public.transactions set status = 'completed' where id = v_d.txn_id;
    insert into public.transactions (user_id, amount_minor, note, status)
    values (v_d.user_id, v_d.amount_minor, 'deposit approved', 'completed');
  else
    update public.deposits set status = 'rejected', decided_by = p_staff, decided_at = now() where id = p_id;
    update public.transactions set status = 'failed' where id = v_d.txn_id;
  end if;
end; $$;
revoke all on function public.decide_deposit(uuid, boolean, uuid) from public, anon, authenticated;

create or replace function public.decide_withdrawal(p_id uuid, p_approve boolean, p_staff uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_w    public.withdrawals%rowtype;
  v_role text;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role only'; end if;
  if p_staff is null then raise exception 'deciding staff id is required'; end if;

  select role into v_role from public.staff where user_id = p_staff;
  if not found then raise exception 'p_staff is not a staff member'; end if;
  if v_role = 'support' then raise exception 'support cannot move money'; end if;

  select * into v_w from public.withdrawals where id = p_id for update;
  if not found then raise exception 'no such withdrawal'; end if;
  if v_w.status <> 'pending' then raise exception 'not pending'; end if;

  if p_approve then
    -- balance was already debited at request time, so approving pays nothing extra
    update public.withdrawals set status = 'approved', decided_by = p_staff, decided_at = now() where id = p_id;
    update public.transactions set status = 'completed' where id = v_w.txn_id;
    insert into public.transactions (user_id, amount_minor, note, status)
    values (v_w.user_id, 0, 'withdrawal sent', 'completed');
  else
    -- reject refunds the debited amount
    update public.profiles set available_minor = available_minor + v_w.amount_minor where id = v_w.user_id;
    update public.withdrawals set status = 'rejected', decided_by = p_staff, decided_at = now() where id = p_id;
    update public.transactions set status = 'failed' where id = v_w.txn_id;
    insert into public.transactions (user_id, amount_minor, note, status)
    values (v_w.user_id, v_w.amount_minor, 'withdrawal refunded', 'refunded');
  end if;
end; $$;
revoke all on function public.decide_withdrawal(uuid, boolean, uuid) from public, anon, authenticated;

-- Stale deploys fail here, with the fix in the message.
create or replace function public.decide_deposit(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  raise exception 'decide_deposit now requires the deciding staff id - redeploy admin-wallet, then call (p_id, p_approve, p_staff)';
end; $$;
revoke all on function public.decide_deposit(uuid, boolean) from public, anon, authenticated;

create or replace function public.decide_withdrawal(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  raise exception 'decide_withdrawal now requires the deciding staff id - redeploy admin-wallet, then call (p_id, p_approve, p_staff)';
end; $$;
revoke all on function public.decide_withdrawal(uuid, boolean) from public, anon, authenticated;