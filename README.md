# Khelofire — Ludo & Chess Tournament Platform (Prototype)

Bengali (BN) / English (EN) mobile-first gaming tournament web app. Original UI — reference (`ludokhelbo.live` / `index est html.html`) used for structure only, not copied.

> **Tier A prototype.** Frontend + demo store (localStorage). No real backend yet.
> Backend decision: **Supabase** (Auth + Postgres + Realtime + Edge Functions). See `../docs/2-TRD.md §1a`.

## Run

```bash
cd app
npm install      # already done
npm run dev      # http://localhost:5173
npm run build    # production build -> dist/
```

Open on a phone-width viewport (or DevTools device mode) — the app renders in a 460px mobile frame.

## Stack
Vite · React · TypeScript · Tailwind CSS · React Router · Zustand · chess.js

## Implemented (demo)
- Auth: login / signup / OTP / forgot (demo — any valid input logs in)
- Home lobby: auto-carousel hero, quick actions, Ludo + Chess mode cards
- Match lobby cards + confirm-join sheet (entry/prize/slots/rules/refund) + matchmaking
- **Ludo**: rule-correct engine (dice, 6-to-leave, captures, safe stars, home column, extra turn), vs bot, turn timer, voice-mic UI, exit modal, result + wallet settlement
- **Chess (Daba)**: full rules via chess.js, legal-move dots, clocks (5+3), check/mate/draw/resign/timeout, vs bot
- Wallet: available + locked balance, add/withdraw, immutable ledger, transaction history (money stored as integer poisha)
- My Matches, Profile (stats/referral/dark mode), Leaderboard, Notifications
- Admin: modes, users, withdrawals, banners, feature flags (RBAC demo)
- BN/EN toggle across UI, light/dark theme, loading/empty/error states

## NOT implemented (production integrations — quoted separately)
Real auth/DB (→ Supabase), real multiplayer (→ Supabase Realtime + Edge Functions server-authoritative validation), real WebRTC voice (TURN/STUN), payment gateway + KYC, anti-cheat, native Android (→ Capacitor wrap of this codebase).

## Demo notes
- Wallet starts at ৳440 (demo). All payments are mock.
- Bot opponents are local; no server round-trip.
- Swap path: `src/lib/store.ts` and the service interfaces (in TRD) → Supabase client, without changing screens.

## Docs
`../docs/`: 1-PRD · 2-TRD · 3-UI-SPEC · 4-DB-SCHEMA
