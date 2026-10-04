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
import { legalTokens } from './engine-for-e2e.mjs'

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
const TRACE = process.env.TRACE !== '0'
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
  if (TRACE) {
    // Both turn fields, on every single call. turn_seat is a column and state.turn
    // is inside the board JSON; the engine authorises on the board, so the two
    // drifting apart is invisible from any one response.
    console.log(
      `   [trace] ${p.tag} ${action}${token !== undefined ? `(${token})` : ''} -> ` +
        `${res.status}  column turn_seat=${body.turn_seat}  board turn=${body.state?.turn}  ` +
        `your_seat=${body.your_seat}  dice=${body.state?.dice}  rolled=${body.state?.rolled}  ` +
        `v=${body.version}`,
    )
  }
  if (!res.ok) {
    // The function returns its whole view alongside a 409, so a refusal carries the
    // board and the asker's seat as the deployed code saw them at that instant.
    // That is worth printing: "it is seat 0" while the caller is seat 0 is
    // impossible from the outside, and this is the only place the inside is visible.
    const seen = body?.your_seat !== undefined
      ? `\n      as the function saw it: your_seat=${body.your_seat} ` +
        `(${typeof body.your_seat})  state.turn=${body.state?.turn} (${typeof body.state?.turn})  ` +
        `turn_seat=${body.turn_seat}  version=${body.version}`
      : ''
    throw new Error(
      `ludo-game ${action} -> HTTP ${res.status}: ${body.error ?? 'no error body'}` +
        (body.code ? ` [code=${body.code}]` : '') +
        (body.timed_out ? ' [timed_out]' : '') +
        seen,
    )
  }
  return body
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

  // Is the board engine even deployed? Ask it something harmless with a
  // deliberately invalid token.
  //
  // The status alone does not answer it: a deployed function rejects a bad JWT
  // with 401, which looks identical to "not there" if you only test for failure.
  // Only Supabase's NOT_FOUND means the function is absent, so that is the only
  // signal treated as a missing deploy - otherwise this reports a deployed
  // project as broken and sends the reader chasing the wrong thing.
  const health = await fetch(`${URL}/functions/v1/ludo-game`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer not-a-real-token' },
    body: JSON.stringify({ action: 'state' }),
  })
  const healthBody = await health.json().catch(() => ({}))
  const notFound = healthBody?.code === 'NOT_FOUND' || health.status === 404
  if (notFound) {
    fail(
      'the ludo-game edge function is not deployed',
      'Run: npx supabase functions deploy ludo-game\n' +
        'Without it a player pays an entry and then cannot make a move.',
    )
  }
  log(
    `   ludo-game: deployed (probe answered ${health.status}` +
      `${health.status === 401 ? ', rejecting our fake token as expected' : ''})`,
  )

  const wanted = process.argv[2]
  const ludo = modes.filter((m) => m.game === 'ludo' && m.active !== false)

  // A practice mode cannot host a live match - create_live_match rejects it, which
  // is the database being correct. So exclude anything priced at zero, and prefer
  // the cheapest real table, because the thing under test is the paid path.
  const real = ludo.filter((m) => Number(m.entry_minor) > 0)
  const mode = wanted
    ? modes.find((m) => m.id === wanted)
    : real.sort((a, b) => Number(a.entry_minor) - Number(b.entry_minor))[0]

  if (!mode) {
    fail(
      `no ludo mode with an entry fee exists${wanted ? ` with id ${wanted}` : ''}`,
      `available: ${ludo.map((m) => `${m.id}(${m.entry_minor})`).join(', ')}`,
    )
  }
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
  // Both, because they are stored separately and can disagree: turn_seat is a
  // column the SQL maintains, state.turn lives inside the board JSON the engine
  // reads. The engine authorises on the board, so a mismatch between the two means
  // the rightful player is told "it is seat N" by a game that is waiting for them.
  log(
    `   started: column turn_seat=${afterStart.turn_seat} (${typeof afterStart.turn_seat})  ` +
      `board state.turn=${afterStart.state?.turn} (${typeof afterStart.state?.turn})  ` +
      `player_id=${afterStart.your_seat} (${typeof afterStart.your_seat})`,
  )
  if (afterStart.your_seat !== afterStart.state?.turn) {
    console.log(
      `\nTYPE MISMATCH: player_id is ${typeof afterStart.your_seat} but the board's turn is ` +
        `${typeof afterStart.state?.turn}.\n` +
        'The engine compares them with !==, so the rightful player is refused every roll.',
    )
  }

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
  // Seat -> player, learned from what the database said rather than assumed.
  // The host is seat 0 and a 2-player joiner is seat 2, not 1: those are opposite
  // corners on the board.
  const seatedAs = new Map([[0, host], [Number(joinRow.seat), guest]])
  const playerFor = (seat) => {
    const p = seatedAs.get(Number(seat))
    if (!p) throw new Error(`nobody is seated at seat ${seat}`)
    return p
  }

  let turns = 0
  let winner = null
  let stale = 0

  // The board is re-read before every action rather than tracked locally.
  //
  // The engine's own response describes the match as it was BEFORE the commit it
  // just made, so a caller that trusts the turn_seat it was handed acts one turn
  // behind - and is then refused with "it is seat N", looking exactly like a server
  // that will not accept a move from the rightful player. Reading first costs one
  // request and removes the entire class of mistake.
  while (turns < 600) {
    turns++

    const before = await act(host, matchId, 'state')
    if (before.state?.winner != null) {
      winner = before.state.winner
      log(`   engine reports winner seat ${winner} after ${turns} turns`)
      break
    }

    const seat = Number(before.turn_seat)
    const p = playerFor(seat)
    let st = before.state

    // Only roll if the fresh read says this seat has not rolled yet.
    //
    // A successful roll answers with the match as it was BEFORE its own commit, so
    // the dice and the `rolled` flag in that response are the previous turn's. Trust
    // it and the next request is a second roll for the same turn, refused as
    // `already_rolled` - a self-inflicted error that reads like a server bug.
    if (!(st?.rolled && st?.dice != null)) {
      try {
        await act(p, matchId, 'roll')
} catch (e) {
      // Three recoverable conditions, all of them the engine moving the board on
      // its own rather than a fault:
      //   not_your_turn - our read raced a pass
      //   already_rolled - the read was a turn behind
      //   timed_out     - this script is slower than the turn clock, and the engine
      //                   has already forfeited and advanced. That is the forfeit
      //                   rule working, not a bug, so the run continues.
      const soft = ['not_your_turn', 'already_rolled', 'timed_out']
      if (soft.some((c) => String(e.message).includes(c)) && stale++ < 40) continue
      throw e
    }
      st = (await act(p, matchId, 'state')).state
    }

    if (st?.winner != null) {
      winner = st.winner
      log(`   engine reports winner seat ${winner} after ${turns} turns`)
      break
    }

    // Move only when the engine is holding the turn open with a dice in hand. When
    // nothing can move it has already ended the turn, and a move would be refused.
    if (st?.rolled && st?.dice != null) {
      const options = legalTokens(st, seat, st.dice)
      if (options.length) await act(p, matchId, 'move', options[0])
    }
  }

  if (winner === null) fail(`the game never finished in ${turns} turns`)

  log('\n== settle ==')
  const winnerIsHost = Number(winner) === 0
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