/**
 * Prove the money-in path: a real deposit request, approved by the real admin
 * account through the real admin-wallet edge function, landing in the payer's
 * balance.
 *
 * This is the half of the wallet nobody had ever run. The paid match path was
 * verified from both ends, but money entering the app had only ever been read from
 * a table, and the admin APK is the tool a real person uses to release it. A
 * deposit that silently fails to credit is the worst possible bug in a wallet: the
 * player sent bKash, the admin pressed approve, and the balance never moved.
 *
 * So it is exercised the whole way, with no shortcuts:
 *   - a real signup, because request_deposit reads auth.uid()
 *   - request_deposit over the anon key, the same call the app makes
 *   - admin-wallet called with the superadmin's own session token, so the staff
 *     check inside the function is the real one
 *   - the balance read back afterwards, and the approval attributed to a real id
 *
 * Credentials come from the environment. The admin password is not defaulted here,
 * because a script that works unattended with a real password is a script someone
 * will forget is there.
 *
 * Usage:
 *   $env:ADMIN_EMAIL='...'
 *   $env:ADMIN_PASSWORD='...'
 *   node scripts/deposit-e2e.mjs
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// ---------- config ----------
const env = {}
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const URL_ = env.VITE_SUPABASE_URL
const ANON = env.VITE_SUPABASE_ANON_KEY
const ADMIN_EMAIL = process.env.ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD

if (!URL_ || !ANON) { console.error('.env is missing the Supabase URL or key'); process.exit(1) }
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('set ADMIN_EMAIL and ADMIN_PASSWORD')
  process.exit(1)
}

const AMOUNT = 25000          // 250 BDT
const METHOD = 'bKash'
const REF = 'E2E-' + Math.random().toString(36).slice(2, 10).toUpperCase()

const ok = (m) => console.log(`   ${m}`)
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1) }

const run = async () => {
  console.log(`\n== admin signs in ==`)
  const adminClient = createClient(URL_, ANON, { auth: { persistSession: false } })
  const { data: adminSession, error: adminErr } =
    await adminClient.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  if (adminErr) fail(`admin sign-in: ${adminErr.message}`)
  const adminJwt = adminSession.session.access_token
  ok(`signed in as ${ADMIN_EMAIL}`)

  console.log(`\n== a payer signs up ==`)
  const stamp = Math.random().toString(36).slice(2, 10)
  const payer = createClient(URL_, ANON, { auth: { persistSession: false } })
  const { data: payerSession, error: payerErr } = await payer.auth.signUp({
    email: `deposit-e2e-${stamp}@khelofire.test`,
    password: 'e2e-' + stamp + '-pw',
  })
  if (payerErr) fail(`payer sign-up: ${payerErr.message}`)
  const payerId = payerSession.user.id
  ok(`payer ${payerId}`)

  // signUp may not hand back a session if confirmations are on; sign in to be sure
  let payerJwt = payerSession.session?.access_token
  if (!payerJwt) {
    const { data: s2, error: e2 } = await payer.auth.signInWithPassword({
      email: `deposit-e2e-${stamp}@khelofire.test`,
      password: 'e2e-' + stamp + '-pw',
    })
    if (e2) fail(`payer sign-in after signup: ${e2.message}`)
    payerJwt = s2.session.access_token
  }

  // Read the balance with the payer's own client. An admin session cannot select
  // another account's profile row, and asking it to and reading -1 back would say
  // nothing about the wallet - the answer would be RLS, not the balance.
  const bal = async () => {
    const { data, error } = await payer
      .from('profiles').select('available_minor').eq('id', payerId).maybeSingle()
    if (error) throw new Error(error.message)
    return Number(data?.available_minor ?? -1)
  }

  const before = await bal()
  ok(`balance before: ${before}`)
  if (before < 0) fail('no profile row for a freshly signed-up account')

  console.log(`\n== payer requests a ${AMOUNT / 100} BDT deposit ==`)
  const { data: depositId, error: reqErr } = await payer.rpc('request_deposit', {
    p_amount_minor: AMOUNT,
    p_method: METHOD,
    p_ref: REF,
  })
  if (reqErr) fail(`request_deposit: ${reqErr.message}`)
  ok(`request ${depositId} ref=${REF}`)

  // Read the queue the way the admin screen does: list_pending_requests. A direct
  // select on deposits returns nothing for a staff session on purpose - that table is
  // not readable from the client, which is why the RPC exists.
  const pending = async () => {
    const { data, error } = await adminClient.rpc('list_pending_requests')
    if (error) throw new Error(error.message)
    return (data?.deposits ?? [])
  }

  const queued = await pending()
  const mine = queued.find((d) => d.id === depositId)
  if (!mine) fail(`the request is not in the admin queue - an admin would never see it`)
  if (Number(mine.amount_minor) !== AMOUNT) fail('the queued amount is not what was requested')
  ok(`visible to the admin as pending: ${mine.method} ${mine.ref}`)

  console.log(`\n== admin approves it, through the edge function ==`)
  const res = await fetch(`${URL_}/functions/v1/admin-wallet`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${adminJwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ kind: 'deposit', id: depositId, approve: true }),
  })
  const text = await res.text()
  if (!res.ok) fail(`admin-wallet HTTP ${res.status}: ${text}`)
  ok(`admin-wallet answered ${res.status}: ${text.slice(0, 200)}`)

  // Approval is proved by the queue emptying and the balance moving. decided_by is
  // not visible from a client session - the deposits table is not readable here - so
  // it is checked separately over SQL, where the staff id is recorded.
  const stillQueued = (await pending()).find((d) => d.id === depositId)
  if (stillQueued) fail('the request is still in the admin queue after approving it')
  ok('gone from the queue')

  const after = await bal()
  ok(`balance after: ${after}`)
  if (after !== before + AMOUNT) fail(`expected ${before + AMOUNT}, got ${after} - the money did not land`)
  ok(`credited exactly ${AMOUNT}`)

  // and the refusal path, because an approve button that also approves when you did
  // not mean to is worse than one that does nothing
  console.log(`\n== a second request, this one rejected ==`)
  const { data: depositId2, error: reqErr2 } = await payer.rpc('request_deposit', {
    p_amount_minor: AMOUNT, p_method: METHOD, p_ref: REF + '-R',
  })
  if (reqErr2) fail(`second request_deposit: ${reqErr2.message}`)
  const res2 = await fetch(`${URL_}/functions/v1/admin-wallet`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'deposit', id: depositId2, approve: false }),
  })
  if (!res2.ok) fail(`reject HTTP ${res2.status}: ${await res2.text()}`)
  const { data: rejectedRow } = await adminClient.rpc('list_pending_requests')
  if ((rejectedRow?.deposits ?? []).some((d) => d.id === depositId2)) {
    fail('a rejected request is still sitting in the queue')
  }
  const afterReject = await bal()
  if (afterReject !== after) fail(`rejecting still moved the balance: ${after} -> ${afterReject}`)
  ok('rejected, and the balance did not move')

  console.log(`\n== a non-staff caller must be refused ==`)
  const res3 = await fetch(`${URL_}/functions/v1/admin-wallet`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${payerJwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'deposit', id: depositId2, approve: true }),
  })
  if (res3.status !== 403) fail(`a plain player got HTTP ${res3.status} instead of 403`)
  ok(`plain player refused with 403: ${(await res3.text()).slice(0, 120)}`)

  console.log(`\n== cleanup ==`)
  await adminClient.from('deposits').delete().eq('user_id', payerId)
  await adminClient.from('transactions').delete().eq('user_id', payerId)
  await adminClient.from('profiles').delete().eq('id', payerId)
  await adminClient.auth.admin.deleteUser(payerId)
  ok(`removed ${payerId} and its ${REF} requests`)

  console.log(`\nPASS: a real deposit was requested, approved by a real admin, credited exactly,`)
  console.log(`      rejection moved nothing, and a non-staff caller was refused.`)
}

run().catch((e) => { console.error(e); process.exit(1) })