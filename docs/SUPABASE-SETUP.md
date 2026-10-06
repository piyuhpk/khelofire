# Supabase setup — new project

Order matters. Steps 1–5 are enough to run the app; 6 is payments; 7 is voice.

---

## 1. Create the project

Supabase dashboard → **New project**. Pick a region near Bangladesh
(Singapore / Mumbai) so latency is lower for players.

Settings → **API**. You need three values:

| Where | What |
|---|---|
| Project URL | `VITE_SUPABASE_URL` |
| `anon` public key | `VITE_SUPABASE_ANON_KEY` |
| `service_role` key | **edge functions only**, never in `.env` for the app |

## 2. Put the keys in the app

Edit `.env` in the project root:

```
VITE_SUPABASE_URL=https://<your-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
VITE_OAUTH_REDIRECT=<your-site>/auth/callback
```

`.env.example` lists every variable the app understands. Only the first two are
required for the app to boot against the database.

> The `service_role` key bypasses row-level security. It belongs in edge-function
> secrets and nowhere else. If it ever lands in `.env`, `.env` is gitignored, but
> treat it as compromised anyway and rotate it.

## 3. Run the SQL, in this order

Open **SQL Editor** and run each file separately, top to bottom. They are
additive-only and idempotent (`if not exists`), so re-running is safe.

| # | File | What it creates |
|---|---|---|
| 1 | `supabase/schema.sql` | profiles, transactions, matches, match_modes, deposits, withdrawals, settlements, **staff**, staff_activity, RLS, `is_staff()` |
| 2 | `supabase/002_live_matches.sql` | live_matches, live_match_seats |
| 3 | `supabase/003_ludo_engine.sql` | ludo columns on live_matches |
| 4 | `supabase/004_payments.sql` | `request_deposit`, `request_withdrawal`, `decide_deposit`, `decide_withdrawal`, `list_pending_requests`, duplicate-ref guard |
| 5 | `supabase/005_payment_gateways.sql` | gateway_config, payment_orders, `active_gateway()`, `set_gateway_mode()` |
| 6 | `supabase/006_make_admin.sql` | `create_first_admin()` — run once, see step 4 |
| 7 | `supabase/007_pending_list_left_join.sql` | `list_pending_requests` left-joins profiles, so a request with no profile row is not hidden |
| 8 | `supabase/008_money_rpc_grants.sql` | grants on the money RPCs — they were revoked from everyone and granted to no one |
| 9 | `supabase/009_resign_live_match.sql` | `resign_live_match` — resigning a live match had no server path at all |
| 10 | `supabase/010_match_modes.sql` | admin-created game modes reach the app (one source of truth for modes) |
| 11 | `supabase/011_no_engine_no_paid_mode.sql` | the server refuses to offer a paid game with no live engine behind it |
| 12 | `supabase/012_pending_requests_ordering.sql` | `list_pending_requests` again — it raised on a GROUP BY error and returned nothing to anyone |
| 13 | `supabase/013_release_orphan_entry_locks.sql` | releases entry locks no match is holding |
| 14 | `supabase/014_dice_engine.sql` | dice game engine |
| 15 | `supabase/015_open_tables.sql` | open tables — a player can find a game instead of knowing a code |
| 16 | `supabase/016_paste_into_supabase_sql_editor.sql` | forward-only rebuild of four functions from 002 and 015 (generated — do not hand-edit) |
| 17 | `supabase/017_deposit_screenshot.sql` | **the payment screenshot**: `deposits.proof`, the four-argument `request_deposit` that requires it, `has_proof` in the admin queue, `get_deposit_proof` |

Run them in that order — later files reference tables created by `schema.sql`.
**16 and 17 are the two that are also pasted by hand** when the schema has already
moved on: both are forward-only (`create or replace`), so they can be run against a
live database without replaying the migrations before them.

Without 17 the app still works: the deposit request falls back to the old
three-argument `request_deposit`, and the player is told their screenshot was not
attached. Everything else about deposits is unchanged.

## 4. Make yourself admin

`staff` is the only thing that grants admin. There is no client-side PIN and no
`is_admin` flag on a profile: the admin panel reads `is_staff()` through RLS, so
without a row in `staff` the account is an ordinary player no matter what the UI
shows.

After running `supabase/006_make_admin.sql` you can create the login in one step:

```sql
select public.create_first_admin('khelofire@app.com', 'choose-a-real-password');
```

That inserts the auth user (password bcrypt'd, never plain text), a profile row,
and the `staff` row. It refuses to run for an account that already exists, and it
refuses to run from a signed-in session or from anything but the database owner —
it is a bootstrap, not an API. It is `revoke`d from `anon` and `authenticated`, so
no browser can reach it.

If the account already exists — you made it in the dashboard, or it came in through
Google sign-in — just grant the role:

```sql
insert into public.staff (user_id, role)
select id, 'superadmin' from auth.users where lower(email) = 'khelofire@app.com'
on conflict (user_id) do update set role = 'superadmin';
```

Then sign out and back in — the session carries the role, not the page.

Once you are in, **Admin → Settings → Your login** changes the email and password
from inside the app. The password change asks for the current one first, so an
unlocked phone cannot lock you out of your own panel.

Roles: `superadmin` / `admin` can move money and change gateway settings,
`support` cannot. Nothing a browser can do inserts into `staff`; only SQL and
the `service_role` key can.

## 5. Deploy the edge functions

Only `admin-wallet` is needed to approve deposits and withdrawals.
`ludo-game` is only for server-authoritative live Ludo.

```bash
supabase login
supabase link --project-ref <your-ref>

# the function secret - this is the only place it should exist
supabase secrets set --name admin-wallet SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>

supabase functions deploy admin-wallet
supabase functions deploy ludo-game
```

Deploying a function without its secrets deployed means the function starts and
then fails on its first real request — deploy secrets **before** the function.

## 6. Payments (optional — manual works without this)

Manual deposits and withdrawals work immediately after steps 1–5. No extra
setup, no gateway account, nothing to approve.

To go automatic you need, per gateway: a merchant account (KYC'd), API
credentials, the provider's checkout signing implemented, and a verified
webhook. `supabase/005_payment_gateways.sql` lists the candidates that can
settle BDT, and `src/lib/payments/providers.ts` lists the exact secret names
each one needs.

```bash
# example: SSLCOMMERZ sandbox
supabase secrets set --name payment-checkout \
  SSLCOMMERZ_STORE_ID=... SSLCOMMERZ_STORE_PASSWORD=... SSLCOMMERZ_SANDBOX=true
supabase secrets set --name payment-webhook \
  SSLCOMMERZ_STORE_ID=... SSLCOMMERZ_STORE_PASSWORD=... SSLCOMMERZ_SANDBOX=true

supabase functions deploy payment-checkout
supabase functions deploy payment-webhook
```

Then, in SQL:

```sql
insert into public.gateway_config (provider, mode, environment, enabled, merchant_id)
values ('sslcommerz', 'auto', 'test', true, '<store id>')
on conflict (provider) do update
  set mode = 'auto', environment = 'test', enabled = true, merchant_id = excluded.merchant_id;
```

Start in `environment = 'test'`. Move to `'live'` only once a test payment has
gone through end to end.

**Note:** Razorpay cannot be used here. It settles in INR only and does not
accept BDT.

## 7. Voice (optional)

Real peer-to-peer voice needs TURN credentials. Without them, voice works only
on networks that allow a direct connection, which is most of the time but not on
mobile data behind symmetric NAT.

Add to `.env`:

```
VITE_TURN_URLS=turn:turn.example.com:3478?transport=udp
VITE_TURN_USERNAME=<user>
VITE_TURN_CREDENTIAL=<password>
```

These are read by the browser (they are in the client bundle), so use TURN
credentials scoped to this app, not an account-wide key.

---

## Verify it worked

1. Sign up, sign out, sign in with **email + password** — that flow is wired.
2. Go to the admin panel. If the tabs load, `staff` accepted you.
3. Wallet → **Re-check gateway**. It should read `Manual`. That is correct.
4. Make a deposit request, then approve it in admin → Withdrawals. The balance
   should change.
5. Ask someone else on a different phone/browser to send a deposit request. It
   should appear in your queue — that is the test for `005`'s
   `list_pending_requests` path.

If step 5 shows nothing, the SQL from step 3 is not all applied.
