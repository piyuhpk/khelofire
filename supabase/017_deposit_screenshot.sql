-- 017: the payment screenshot, attached to the deposit request
--
-- What was asked for: a player cannot send a deposit request without attaching
-- the screenshot of the payment they say they made. Today the request carries an
-- amount, a method and a transaction id, and nothing that lets an admin actually
-- look at the payment - so approval is a guess against a bank statement the
-- admin cannot see, and "that transaction id has already been submitted" is the
-- only protection against paying the same payment twice.
--
-- Why the picture travels as text rather than through Supabase Storage: this
-- project has no storage bucket, and a bucket is a separate thing to create, to
-- policy and to keep from being read by anyone with the anon key. One column and
-- one function keep the whole feature inside the SQL file that is already the
-- deployment path. The client compresses the image before it gets here (see
-- src/lib/proofImage.ts), so a row is a couple of hundred kilobytes at most and
-- the limit below rejects anything that skipped that step.
--
-- HOW THE TWO OVERLOADS DIVIDE THE WORK, AND WHY BOTH EXIST:
--
--   request_deposit(bigint, text, text, text)  - current app. Requires a
--       screenshot, stores it with the request. This is the mandatory path.
--   request_deposit(bigint, text, text)         - left alone on purpose. An APK
--       already in a player's hand calls this one, and dropping it would turn
--       every older build's deposit button into "function does not exist" - a
--       broken money flow for a player who has done nothing wrong. It keeps
--       working until that player updates, which is why mandatory is enforced by
--       the overload the current app calls, not by removing the old one.
--
--   If you would rather force every build onto the screenshot, drop the three
--   argument overload at the bottom of this file - it is commented out.
--
-- Nothing here is reversible in the sense of losing data: `proof` is a nullable
-- column, and requests created before this file ran simply have none.

-- ---------------------------------------------------------------- table ----
alter table public.deposits add column if not exists proof text;

comment on column public.deposits.proof is
  'The payment screenshot as a data URL (data:image/...;base64,...), attached by the player when the request is created. Empty/NULL for requests made before 017 or from an older build.';

-- ------------------------------------------------- the path the app takes ----
create or replace function public.request_deposit(p_amount_minor bigint, p_method text, p_ref text, p_proof text)
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

  -- Mandatory, and checked here rather than only in the UI. A UI that refuses to
  -- submit without a picture is a courtesy; the function is the rule. The shape
  -- check is on the prefix because everything downstream - the admin panel, the
  -- <img> it renders - assumes a data URL, and a bare base64 string or a remote
  -- URL would either not render or would make the admin's phone fetch a page of
  -- the player's choosing.
  if coalesce(p_proof, '') = '' or p_proof not like 'data:image/%' then
    raise exception 'attach the payment screenshot';
  end if;
  if p_proof not like 'data:image/%;base64,%' then
    raise exception 'attach the payment screenshot';
  end if;
  -- 700,000 characters of text, which is a ~500KB picture. The client compresses
  -- well under this; the limit exists so a client that sends a 12MP camera roll
  -- is told so instead of writing it to the table first.
  if octet_length(p_proof) > 700000 then
    raise exception 'that screenshot is too large - attach an image under 500 KB';
  end if;

  v_method := case lower(btrim(coalesce(p_method,'')))
                when ''      then 'bKash'
                when 'bkash' then 'bKash'
                when 'nagad' then 'Nagad'
                else btrim(p_method)
              end;
  v_ref := btrim(coalesce(p_ref,''));

  -- Caps the queue a single player can build. Without it, support is buried under
  -- one player's spam while everyone else's requests wait.
  select count(*) into v_open from public.deposits
   where user_id = v_uid and status = 'pending';
  if v_open >= 5 then raise exception 'you already have 5 pending deposit requests - wait for one to be reviewed'; end if;

  insert into public.transactions (user_id, amount_minor, note, status)
  values (v_uid, p_amount_minor, 'deposit request', 'pending')
  returning id into v_tid;

  begin
    insert into public.deposits (user_id, amount_minor, method, ref, txn_id, proof)
    values (v_uid, p_amount_minor, v_method, v_ref, v_tid, p_proof)
    returning id into v_id;
  exception when unique_violation then
    -- The protection working as intended. Surfaced as a sentence the player can
    -- act on rather than a raw index violation.
    raise exception 'that transaction id has already been submitted - each payment can only be deposited once';
  end;

  return v_id;
end; $$;
grant execute on function public.request_deposit(bigint, text, text, text) to authenticated;

-- --------------------------------------------- what the admin's list shows ----
-- The picture itself is deliberately NOT in this payload. The queue is read on
-- every admin tab change, and it is a list: folding a couple of hundred kilobytes
-- per row into it would make an already slow call slower for a picture nobody has
-- asked for yet. `has_proof` is one boolean, and get_deposit_proof fetches the
-- image only when the admin opens it.
--
-- create or replace cannot change a return type, and this returns jsonb in 012,
-- so this is a plain replace of the same signature.
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
        'has_proof', s.has_proof,
        'ts', s.created_at))
      from (
        select d.id, d.user_id, d.amount_minor, d.method, d.ref, d.created_at,
               (d.proof is not null) as has_proof,
               p.username
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

-- ----------------------------------------------------- the image on demand ----
create or replace function public.get_deposit_proof(p_deposit_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := public.is_staff();
  v_proof text;
begin
  if v_role is null then raise exception 'not authorised - your account has no staff role'; end if;
  select proof into v_proof from public.deposits where id = p_deposit_id;
  return v_proof;
end; $$;
grant execute on function public.get_deposit_proof(uuid) to authenticated;

-- ------------------------------------------------------------- optional ----
-- Uncomment to make the screenshot non-negotiable for EVERY build, including an
-- APK already installed on a player's phone. Their deposit button will then say
-- "update the app - this version cannot attach your payment screenshot" until
-- they install the new one.
--
-- drop function if exists public.request_deposit(bigint, text, text);
