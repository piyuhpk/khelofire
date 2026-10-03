# TODO

Ordered by what actually blocks a working app. "Blocked on you" means no amount
of code work helps until that input exists.

---

## 1. Supabase project (blocked on you)

- [ ] Create a new Supabase project
- [ ] Put `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` in `.env`
- [ ] Run the SQL in order: `schema.sql`, `002`, `003`, `004`, `005`
- [ ] Insert yourself into `staff` as `superadmin`
- [ ] Deploy `admin-wallet` (and `ludo-game` if you want server-authoritative live Ludo)
- [ ] Follow `docs/SUPABASE-SETUP.md`

Until this is done the app runs in demo mode: money is fake, there is no real
login, and nothing persists.

## 2. Payments

Manual is complete and works today — deposit request, admin approval, balance
credit, withdrawal with auto-refund on rejection. No credentials needed.

- [ ] Decide which gateway to actually apply to (see `src/lib/payments/providers.ts`)
- [ ] Get that merchant account approved (KYC; takes days, start now)
- [ ] Add its credentials as function secrets
- [ ] Implement `buildSession()` in `supabase/functions/payment-checkout/index.ts`
- [ ] Implement `verify()` in `supabase/functions/payment-webhook/index.ts`
- [ ] Register the webhook URL with the provider
- [ ] Test in `environment = 'test'`, then flip to `'live'`

Each gateway is independent — doing one does not help the others.

Razorpay is ruled out: INR only, no BDT.

## 3. Admin

Email + password sign-in is wired (`signInWithPassword`) and admin rights come
from the `staff` table, not a client flag.

- [ ] Test admin sign-in against the new project
- [ ] Confirm the panel rejects a non-staff account

## 4. Voice

Real-time voice needs TURN credentials; without them it fails on mobile data
behind NAT.

- [ ] Create a TURN service (Cloudflare's free tier is enough)
- [ ] Add `VITE_TURN_URLS` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL`
- [ ] Wire `VoiceButton` to the live-match room (it currently only shows a local
      meter — it does not connect to the opponent)
- [ ] Test on two phones on mobile data, not Wi-Fi

## 5. Login

- [ ] `VITE_GOOGLE_CLIENT_ID` from Google Cloud Console
- [ ] Enable the Google provider in Supabase Auth with the same client id
- [ ] Rebuild the APK — the native Google plugin reads it at build time

## 6. Ludo (code is pushed, needs eyes on it)

- [ ] Confirm the opponent's dice now spins (`512674f`)
- [ ] Confirm tokens sit centred in their circle and inside their track cell
- [ ] Confirm a post-spin move lands where it should

Verified by tests (a full match plays to a result, the board never stalls), but
pixel placement has not been checked against a real screen.

## 7. Housekeeping

- [ ] `src/assets/ludoking/blue_bg.png` is untracked and unused — delete or commit
- [ ] 29 lint warnings, 0 errors — mostly `set-state-in-effect` and unused vars
- [ ] `npm audit` has not been run in this session
