# Security setup runbook

These changes close the bugs reported from the client's test APK. **Code alone is
not enough** — steps 1 to 4 are server-side and must be done in the Supabase
dashboard before a rebuilt APK will behave correctly.

Read the whole file once. Step 1 is urgent: the anon key is already public.

---

## 1. Rotate the anon key (do this first, today)

`.env` was committed to the public repository, so `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` have been readable by anyone who cloned it. `.env` is
now gitignored and untracked, but the value is still in git history.

1. Supabase dashboard → Project Settings → API.
2. Click **Rotate** on the anon / publishable key. Do the same for the service
   role key if it was ever in a file that got shared.
3. Put the new values in your local `.env`.
4. Rebuild the APK (step 6). The old key stops working for everyone at once.

Do not skip this. The database is reachable with the leaked key, and before the
RLS fix in step 2 that key could read every player's wallet balance.

Optional but recommended: purge the key from history so it is not in any clone.

---

## 2. Apply the hardened schema

Supabase dashboard → SQL Editor → New query → paste all of
`supabase/schema.sql` → Run. It is idempotent, so re-running is safe.

What changes:

| Before | After |
|---|---|
| Anyone could `UPDATE profiles SET available_minor = 999999999` on their own row | `UPDATE` revoked; only `username` and `avatar` are granted |
| `leaderboard read` policy was `using (true)` — any key could read every profile, including balances | Removed. Leaderboard goes through `get_leaderboard()`, which returns only username/avatar/wins |
| Clients inserted their own `matches` rows, so 10,000 fake wins were one call away | `INSERT` on `matches` revoked; only `settle_match()` writes history |
| Admin PIN in `localStorage`, reachable via `/admin-access?pin=4321` | Roles live in a `staff` table that clients cannot read or write |

New tables: `match_modes` (server-side prize amounts), `deposits`,
`withdrawals`, `settlements` (double-settlement guard), `staff`,
`staff_activity` (audit log the client cannot edit).

---

## 3. Deploy the admin edge function

The admin panel can no longer approve a deposit or withdrawal with the anon key
— `decide_deposit` / `decide_withdrawal` are revoked from `anon` and
`authenticated`. They are reached only through a trusted function:

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase functions deploy admin-wallet
```

The function verifies the caller is a row in `staff` and refuses `support`
role for money movement.

---

## 4. Make yourself a staff account

1. Sign up normally in the app (or Supabase dashboard → Authentication → Users
   → Add user).
2. In the SQL editor:

```sql
insert into public.staff (user_id, role)
select id, 'superadmin' from auth.users where email = 'you@example.com'
on conflict (user_id) do update set role = excluded.role;
```

3. Add the admin screens you need to the Auth → Providers list: **Google**,
   with the client id and secret from Google Cloud Console. Redirect URI:

```
https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback
```

The old `4321` PIN no longer exists anywhere in the app.

---

## 5. Note the money rules now enforced

- `match_modes` holds the real entry and prize amounts and is seeded from
  `supabase/schema.sql`. **If you change a prize in `src/lib/catalog.ts` you must
  update `match_modes` too** — the database value is what gets paid. The catalog
  is now only the display copy.
- A withdrawal debits the balance immediately and is refunded by the server if
  an admin rejects it, so the same money cannot be requested twice.
- A deposit credits nothing until an admin approves it.
- `settle_match()` is idempotent — a replayed call raises instead of paying
  twice.

---

## 6. Rebuild the APK

`@capacitor/app` and `@capacitor/browser` are new dependencies and the manifest
gained a deep-link intent-filter, so a plain Gradle build is not enough:

```bash
npm install
npm run build
npx cap sync android
npx cap open android      # or your usual gradle assembleRelease
```

The AndroidManifest now listens for `khelofire://`. If you use a different
scheme, change it in **both** `AndroidManifest.xml` and `VITE_OAUTH_REDIRECT`.

---

## Residual risk — what is still not solved

**The game runs on the player's own device, so the outcome is still reported by
the client.** A modified APK can call `settle_match('ludo','ludo_classic','win')`
and collect the prize for a match it never played.

What the fixes do close: the trivial attacks. Entry and prize amounts are
server-controlled, a client can no longer write a balance directly, settlement
cannot be replayed, and the leaderboard can no longer be stuffed with invented
wins.

What they do not close: a client that lies about the result. Closing that needs a
server-authoritative match runner — the server holds the board state and the
phone only renders it. That is a real project, not a patch, and it should be
scheduled before real money is held in these accounts.

Also still open, and worth doing next:

- **Payment verification is manual.** An admin approving a deposit trusts that
  money arrived. Automate it with bKash/Nagad webhook confirmation.
- **No 2FA on admin accounts**, even though the Security tab still shows a
  toggle for it. That toggle is cosmetic.
- **Most of the admin panel is still demo data** (banners, categories, seeded
  user rows). Access control is now real; the panel's own data sources are not
  yet server-backed.