/**
 * End-to-end proof that a paid live match actually works.
 *
 * Why this exists
 * ---------------
 * Everything before this was unit tests plus reading code, and that is exactly how
 * a build reaches a client with a feature that does not run. The question this
 * script answers is the only one that matters to a player who has paid an entry:
 *
 *   Two real accounts. Real network. Real database. Real engine.
 *   Does the money leave, does the board move, does the prize land?
 *
 * It talks to the deployed project over HTTP - the same endpoints the APK calls,
 * with the same JWTs, so nothing here can pass by mocking the part that breaks.
 *
 * What it needs from you: the SQL migrations applied and both edge functions
 * deployed. If they are not, it says so in one line instead of failing somewhere
 * confusing.
 *
 *   npx supabase functions deploy admin-wallet
 *   npx supabase functions deploy ludo-game
 *
 *   node scripts/live-e2e.mjs
 *
 * Modes: pass a mode id to test a paid table, e.g. `node scripts/live-e2e.mjs
 * ludo_classic`. With no argument it picks the cheapest ludo mode, because the
 * point is the paid path.
 *
 * Two throwaway accounts are created per run (random emails). They hold real money
 * only if you have funded them; this script never tops a wallet up, because it
 * has no business minting money and a publishable key cannot do it anyway.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trimStart().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)

const URL = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY
if (!URL || !KEY) {
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing from .env')
  process.exit(2)
}

const stamp = Date.now().toString(36)
const log = (...a) => console.log(...a)
const fail = (msg, detail) => {
  console.error(`\nFAIL: ${msg}`)
  if (detail) console.error(detail)
  process.exit(1)
}

/** A signed-in test player: its own client, its own JWT. */
async function player(tag) {
  const email = `e2e-${tag}-${stamp}@khelofire.test`
  const password = `T-${stamp}-Aa1!`
  const sb = createClient(URL, KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await sb.auth.signUp({ email, password })
  if (error) fail(`could not create the ${tag} account: ${error.message}`)

  // Sign-up may need email confirmation on. Without a session this whole script
  // is untestable, so say so plainly instead of failing 40 lines later.
  if (!data.session) {
    fail(
      `the ${tag} account has no session - email confirmation is required`,
      'Enable automatic sign-in (Supabase dashboard > Authentication > Providers), ' +
        'or confirm these addresses by hand and re-run.',
    )
  }

  const { data: prof } = await sb
    .from('profiles')
    .select('username, available_minor')
    .eq('id', data.user.id)
    .maybeSingle()

  return {
    tag,
    email,
    id: data.user.id,
    jwt: data.session.access_token,
    sb,
    username: prof?.username ?? email,
    balance: Number(prof?.available_minor ?? 0),
  }
}

const rpc = async (sb, name, args) => {
  const { data, error } = await sb.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data
}

/** One call to the engine, exactly as the APK makes it. */
async function act(p, matchId, action, token) {
  const res = await fetch(`${URL}/functions/v1/ludo-game`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: KEY,
      Authorization: `Bearer ${p.jwt}`,
    },
    body: JSON.stringify({ match_id: matchId, action, token }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`ludo-game ${action} -> HTTP ${res.status}: ${body.error ?? 'no error body'}`)
  }
  return body
}

/**
 * Which of my tokens can this dice move?
 *
 * Reimplemented here rather than imported so the test cannot inherit a bug from the
 * code it is meant to check. The engine rejects an illegal move; if this computes
 * the wrong token the test fails loudly instead of silently passing.
 */
function legalTokens(state, seat, dice) {
  const { tokens, positions } = state
  const mine = tokens[seat]
  const out = []
  for (let lane = 0; lane < mine.length; lane++) {
    const rel = mine[lane]
    if (rel <= 0) continue
    const abs = rel - 1 + dice
    if (abs >= 57) {
      out.push(lane)
      continue
    }
    // A blockade stops movement only when the path is full, and only in a
    // non-home stretch; the home stretch is owned by the token itself.
    const target = positions[lane][abs]
    const onHomeRun = abs >= 51
    if (onHomeRun) {
      out.push(lane)
      continue
    }
    const path = positions[lane].slice(rel, abs + 1)
    const blocked = path.some(
      (sq, k) => sq.occupied && sq.seat !== seat && k < path.length - 1,
    )
    if (!blocked) out.push(lane)
  }
  return out
}

const run = async () => {
  log('== preflight ==')
  const probe = createClient(URL, KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: modes, error: modesErr } = await probe.rpc('list_match_modes')
  if (modesErr) {
    fail(
      'list_match_modes failed',
      `${modesErr.message}\n\nDid you apply supabase/010_match_modes.sql?`,
    )
  }
  log(`   match modes: ${modes.length}`)

  // Is the board engine even deployed? Ask it something harmless.
  const health = await fetch(`${URL}/functions/v1/ludo-game`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer x' },
    body: JSON.stringify({ action: 'state' }),
  })
  if (health.status === 404 || health.status === 401) {
    fail(
      'the ludo-game edge function is not deployed',
      'Run: npx supabase functions deploy ludo-game\n' +
        'Without it a player pays an entry and then cannot make a move.',
    )
  }
  log('   ludo-game: reachable')

  const wanted = process.argv[2]
  const ludo = modes.filter((m) => m.game === 'ludo' && m.active !== false)
  const mode = wanted
    ? modes.find((m) => m.id === wanted)
    : ludo.sort((a, b) => Number(a.entry_minor) - Number(b.entry_minor))[0]

  if (!mode) fail(`no ludo mode available${wanted ? ` with id ${wanted}` : ''}`)
  const entry = Number(mode.entry_minor ?? 0)
  const prize = Number(mode.prize_minor ?? 0)
  log(`   mode: ${mode.id}  entry=${entry}  prize=${prize}`)

  log('\n== two players ==')
  const host = await player('host')
  const guest = await player('guest')
  log(`   ${host.tag}: ${host.email}  balance=${host.balance}`)
  log(`   ${guest.tag}: ${guest.email}  balance=${guest.balance}`)

  if (entry > 0 && (host.balance < entry || guest.balance < entry)) {
    fail(
      `the test accounts cannot cover the entry (need ${entry} each)`,
      `host=${host.balance} guest=${guest.balance}\n\n` +
        'Fund these from the admin panel, or pass a free mode id:\n' +
        '  node scripts/live-e2e.mjs ludo_4p_practice',
    )
  }

  log('\n== create -> join -> start ==')
  const code = `E2E${stamp}`.toUpperCase().slice(0, 8)
  const made = await rpc(host.sb, 'create_live_match', { p_mode: mode.id, p_code: code })
  const matchId = Array.isArray(made) ? made[0]?.match_id : made?.match_id
  if (!matchId) fail('create_live_match returned no match_id', JSON.stringify(made))
  log(`   created ${matchId}  code=${code}`)

  const joined = await rpc(guest.sb, 'join_live_match', { p_code: code })
  const joinRow = Array.isArray(joined) ? joined[0] : joined
  log(`   guest seated: ${joinRow?.your_seat ?? 'seat returned as ' + JSON.stringify(joinRow)}`)

  await rpc(host.sb, 'start_live_match', { p_match_id: matchId })

  const afterStart = await act(host, matchId, 'state')
  log(`   started: turn_seat=${afterStart.turn_seat}  host_seat=${afterStart.your_seat}`)

  const bal = async (p) => {
    const { data } = await p.sb
      .from('profiles')
      .select('available_minor')
      .eq('id', p.id)
      .single()
    return Number(data?.available_minor ?? 0)
  }
  const hostAfterEntry = await bal(host)
  const guestAfterEntry = await bal(guest)
  log(`   balances after entry: host=${hostAfterEntry} guest=${guestAfterEntry}`)
  if (entry > 0) {
    if (hostAfterEntry !== host.balance - entry) {
      fail(`host was not charged the entry`, `expected ${host.balance - entry}, got ${hostAfterEntry}`)
    }
    if (guestAfterEntry !== guest.balance - entry) {
      fail(`guest was not charged the entry`, `expected ${guest.balance - entry}, got ${guestAfterEntry}`)
    }
    log('   both entries debited correctly')
  }

  log('\n== play to a finish ==')
  let turns = 0
  let winner = null
  while (turns < 400) {
    turns++
    const seat = afterStart.turn_seat
    const p = seat === afterStart.your_seat ? host : guest
    const rolled = await act(p, matchId, 'roll')
    const st = rolled.state

    if (st.winner !== null && st.winner !== undefined) {
      winner = st.winner
      log(`   engine reports winner seat ${winner} after ${turns} turns`)
      break
    }

    const options = legalTokens(st, seat, st.dice)
    if (!options.length) {
      // The engine already passed the turn when nothing was playable.
      const next = await act(p, matchId, 'state')
      if (next.turn_seat === seat) {
        fail(`seat ${seat} has no legal move but the turn did not pass`, JSON.stringify(st))
      }
      Object.assign(afterStart, next)
      continue
    }
    const moved = await act(p, matchId, 'move', options[0])
    Object.assign(afterStart, moved)
  }

  if (winner === null) fail(`the game never finished in ${turns} turns`)

  log('\n== settle ==')
  const winnerIsHost = winner === afterStart.your_seat
  const winnerP = winnerIsHost ? host : guest
  const loserP = winnerIsHost ? guest : host
  const winBefore = await bal(winnerP)

  await rpc(winnerP.sb, 'settle_match', { p_match_id: matchId, p_outcome: 'win' })

  const winAfter = await bal(winnerP)
  const loseAfter = await bal(loserP)
  const paid = winAfter - winBefore

  log(`   winner  ${winnerP.tag}: ${winBefore} -> ${winAfter}  (+${paid})`)
  log(`   loser   ${loserP.tag}: ${loseAfter}`)

  if (prize > 0 && paid !== prize) {
    fail(
      `the winner was credited ${paid} but the mode's prize is ${prize}`,
      'Settlement is not paying what the mode advertises. Do not ship this build.',
    )
  }

  log(`\nPASS: ${entry}-entry live match played to a finish and paid ${paid}.`)
  log(`      ${turns} turns, ${mode.id}`)
  log(`      accounts left behind: ${host.email}, ${guest.email}`)
}

run().catch((e) => fail(e.message, e.stack))