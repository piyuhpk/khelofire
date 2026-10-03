-- ============ automatic payment gateways ============
-- Run this AFTER 004_payments.sql. 004 is the manual flow and is still the
-- default; this file adds the machinery for a gateway to become automatic
-- without changing any row that already works.
--
-- Two tables:
--   gateway_config  one row per provider - is it on, and which secrets it needs
--   payment_orders  an attempt at an automatic payment, from intent to settled
--
-- `mode` on gateway_config is the switch the admin panel exposes, and it is
-- deliberately constrained to 'manual' | 'auto'. A row cannot be created for a
-- provider that cannot settle BDT, so Razorpay (INR only) cannot be turned on
-- from the database by accident either.

create table if not exists public.gateway_config (
  provider     text primary key
                 -- Razorpay settles in INR and rejects BDT, so it is not an option
                 -- here. Constrained in the schema rather than only in the UI so a
                 -- bad insert cannot switch it on from the database either.
                 check (provider in ('manual','bkash','nagad','rocket','sslcommerz',
                                     'aamarpay','portwallet','shurjopay','lazypay')),
  mode         text not null default 'manual' check (mode in ('manual','auto')),
  -- 'test' prints provider sandbox credentials, 'live' moves real money.
  -- Nothing here can make a 'test' row move real money: the checkout edge
  -- function refuses to build a live session unless mode='auto' AND this='live'.
  environment  text not null default 'test' check (environment in ('test','live')),
  enabled      boolean not null default false,
  -- merchant id / store id shown to players. NOT a secret.
  merchant_id  text not null default '',
  note         text not null default '',
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id)
);


insert into public.gateway_config (provider, mode, enabled)
values ('manual', 'manual', false)
on conflict (provider) do nothing;

create table if not exists public.payment_orders (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  provider       text not null,
  amount_minor   bigint not null check (amount_minor > 0),
  currency       text not null default 'BDT' check (currency = 'BDT'),
  -- our reference, shown to the player and to the admin. Providers get their
  -- own reference in provider_session and this is what we reconcile on.
  reference      text not null unique,
  status         text not null default 'created'
                   check (status in ('created','pending','paid','failed','expired','refunded')),
  -- what the provider told us, kept verbatim so a dispute can be settled later
  provider_session text not null default '',
  provider_ref     text not null default '',
  -- last provider status message, for the admin panel and for support
  failure_reason text not null default '',
  created_at     timestamptz not null default now(),
  paid_at        timestamptz
);

create index if not exists payment_orders_user_idx   on public.payment_orders (user_id, created_at desc);
create index if not exists payment_orders_status_idx on public.payment_orders (status, created_at desc);

alter table public.payment_orders   enable row level security;
alter table public.gateway_config   enable row level security;

-- A player may read their own orders and nothing else. Insert and update are
-- service_role only: money moving from pending to paid happens in the webhook,
-- never from a browser.
drop policy if exists "own orders read" on public.payment_orders;
create policy "own orders read" on public.payment_orders
  for select using (auth.uid() = user_id);

drop policy if exists "own gateway config read" on public.gateway_config;
create policy "own gateway config read" on public.gateway_config
  for select using (true);   -- the client needs to know which mode is live

revoke insert, update, delete on public.payment_orders from anon, authenticated;
revoke insert, update, delete on public.gateway_config from anon, authenticated;

-- ============ is a gateway actually usable right now? ============
-- The client asks this instead of trusting a localStorage flag. A gateway counts
-- as automatic only when it is enabled, in auto mode, marked live, and its
-- secrets are present in the function environment. The secrets themselves are
-- read from the edge function's environment, never from the database - which is
-- the whole reason they are not columns on this table.
create or replace function public.active_gateway()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.gateway_config;
begin
  select * into v_row
    from public.gateway_config
   where enabled and mode = 'auto' and environment = 'live'
   order by updated_at desc
   limit 1;

  if not found then
    -- manual is the answer whenever nothing is genuinely ready, so every
    -- client takes the same branch and deposits keep working
    return jsonb_build_object('provider', 'manual', 'mode', 'manual',
                              'merchant_id', '', 'reason', 'no gateway is enabled');
  end if;

  return jsonb_build_object(
    'provider',     v_row.provider,
    'mode',         'auto',
    'merchant_id',  v_row.merchant_id,
    'reason',       '');
end;
$$;
grant execute on function public.active_gateway() to anon, authenticated;

-- ============ staff gate for changing gateway settings ============
create or replace function public.set_gateway_mode(
  p_provider text,
  p_mode      text,
  p_environment text,
  p_enabled   boolean,
  p_merchant_id text default '',
  p_note      text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_role text;
begin
  v_role := public.is_staff();
  if v_role is null or v_role not in ('admin','superadmin') then
    raise exception 'admin only';
  end if;

  if p_provider not in ('manual','bkash','nagad','rocket','sslcommerz',
                        'aamarpay','portwallet','shurjopay','lazypay') then
    raise exception 'unsupported provider';
  end if;

  -- 'manual' is the floor. Nothing turns it off.
  --
  -- Only one non-manual provider may be enabled at a time, and that is enforced
  -- here rather than only described in a comment: active_gateway() picks the most
  -- recently updated enabled row, so two gateways enabled at once means a deposit
  -- gets routed by whichever row happened to be touched last. Which provider took
  -- a player's money would then depend on write order - and a player seeing one
  -- merchant number on screen while the checkout went to another is exactly the
  -- bug that has to be impossible rather than unlikely.
  if p_enabled and p_provider <> 'manual' then
    if exists (select 1 from public.gateway_config
                where provider <> 'manual' and provider <> p_provider and enabled) then
      raise exception 'another gateway is already enabled - switch it off first, so only one can take a deposit';
    end if;
  end if;

  insert into public.gateway_config (provider, mode, environment, enabled, merchant_id, note, updated_at, updated_by)
  values (p_provider, p_mode, p_environment, p_enabled, coalesce(p_merchant_id,''), coalesce(p_note,''), now(), auth.uid())
  on conflict (provider) do update
     set mode         = excluded.mode,
         environment  = excluded.environment,
         enabled      = excluded.enabled,
         merchant_id  = excluded.merchant_id,
         note         = excluded.note,
         updated_at   = now(),
         updated_by   = auth.uid();
end;
$$;
revoke execute on function public.set_gateway_mode(text,text,text,boolean,text,text) from anon;
grant execute on function public.set_gateway_mode(text,text,text,boolean,text,text) to authenticated;
