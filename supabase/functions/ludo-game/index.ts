// Supabase Edge Function: ludo-game
//
// Owns the board for a real paid Ludo match. The phone renders and taps; every
// decision about dice, legal moves and who won is made here.
//
// Why this exists: settle_match pays out from winner_seat, and winner_seat is only
// writable through this function's service-role client. A client that decided its
// own rolls could steer the board to a win, so the rules have to sit on a machine
// the player does not control.
//
// The rules are imported from the same src/engine the client plays with, so there
// is one implementation of Ludo, not a server copy that drifts from it.
//
// Deploy:
//   supabase functions deploy ludo-game
//
// Call (Authorization must be the player's own Supabase access token):
//   POST <project>/functions/v1/ludo-game
//   { "match_id": "<uuid>", "action": "roll" | "move" | "pass" | "state", "token": 0 }
//
//   "state" is read-only and reports the board, the clock and your seat. It is
//   gated on the same seat check as a move, so it reveals nothing to a
//   non-participant, and it is how a client learns the opponent's moves without
//   having to submit one.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  decideMove,
  decidePass,
  decideRoll,
  isUsableState,
  nextDeadline,
  TURN_SECONDS,
  type TurnContext,
} from '../../../src/engine/ludoServer.ts'
import type { PlayerId } from '../../../src/engine/ludo.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Action = 'roll' | 'move' | 'pass' | 'state'

// The exact columns this function selects. Written out rather than inferred
// because the supabase client is stubbed for typechecking (see deno.d.ts), and an
// inferred `any` would mean a typo in `match.version` compiles fine and then reads
// undefined in production.
interface SeatRow {
  player_id: number
}

interface MatchRow {
  id: string
  status: 'waiting' | 'live' | 'finished' | 'cancelled'
  version: number
  state: unknown
  turn_seat: number | null
  turn_deadline: string | null
  winner_seat: number | null
  seat_count: number
}

/**
 * The exact argument list of public.ludo_commit in supabase/003_ludo_engine.sql.
 *
 * Typed out on purpose. p_deadline is a string here and not `number | null`
 * because PostgREST casts a bare number to timestamptz as epoch SECONDS: sending
 * the milliseconds we hold in memory would push every deadline ~54000 years into
 * the future and expire each turn the instant it began. Making the field a string
 * turns that mistake into a compile error instead of a broken paid match.
 */
interface LudoCommitArgs {
  p_match_id: string
  p_user: string
  p_version: number
  p_from_seat: number
  p_state: unknown
  p_turn: number
  p_deadline: string | null
  p_winner: number | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const callerJwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!callerJwt) return json({ error: 'missing authorization' }, 401)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Who is this? The JWT is the only thing trusted here, and it is resolved
    // before any match data is touched. Everything downstream keys off this id.
    const { data: caller, error: callerErr } = await admin.auth.getUser(callerJwt)
    if (callerErr || !caller.user) return json({ error: 'invalid session' }, 401)
    const uid = caller.user.id

    const body = await req.json().catch(() => null)
    const matchId = body?.match_id as string | undefined
    const action = body?.action as Action | undefined
    if (!matchId || !['roll', 'move', 'pass', 'state'].includes(action ?? '')) {
      return json({ error: 'expected { match_id, action: roll|move|pass|state, token? }' }, 400)
    }
    if (action === 'move' && !Number.isInteger(body?.token)) {
      return json({ error: 'move needs an integer token' }, 400)
    }

    const { data: seatRaw, error: seatErr } = await admin
      .from('live_match_seats')
      .select('player_id')
      .eq('match_id', matchId)
      .eq('user_id', uid)
      .maybeSingle()
    if (seatErr) return json({ error: seatErr.message }, 400)
    const seat = seatRaw as SeatRow | null
    if (!seat) return json({ error: 'you are not seated in this match' }, 403)

    const { data: matchRaw, error: matchErr } = await admin
      .from('live_matches')
      .select('id, status, version, state, turn_seat, turn_deadline, winner_seat, seat_count')
      .eq('id', matchId)
      .maybeSingle()
    if (matchErr) return json({ error: matchErr.message }, 400)
    const match = matchRaw as MatchRow | null
    if (!match) return json({ error: 'unknown match' }, 404)

    // the board every client is shown, plus who is asking and what is left of
    // their clock. A finished match still returns, so both phones see the result.
    const view = (extra: Record<string, unknown> = {}) => ({
      match_id: match.id,
      status: match.status,
      version: match.version,
      state: match.state,
      turn_seat: match.turn_seat,
      winner_seat: match.winner_seat,
      your_seat: seat.player_id,
      deadline: match.turn_deadline,
      seconds_left: match.turn_deadline
        ? Math.max(0, Math.round((new Date(match.turn_deadline).getTime() - Date.now()) / 1000))
        : 0,
      turn_seconds: TURN_SECONDS,
      ...extra,
    })

    // `state` is read-only: it reports the board and the clock without touching
    // the turn or the version. A seated client needs it to paint the opponent's
    // moves and to resync after a dropped realtime message, and without it the
    // only way to learn the board would be to make a move - which is exactly the
    // thing a client must never be forced to do just to see the game.
    if (action === 'state') return json(view())

    if (match.status !== 'live') return json(view())
    if (!isUsableState(match.state)) {
      // a board the engine cannot read is not something to guess at mid-match
      return json({ error: 'stored board is unreadable', state: match.state }, 500)
    }

    const ctx: TurnContext = {
      state: match.state,
      seat: seat.player_id as PlayerId,
      now: Date.now(),
      deadline: match.turn_deadline ? new Date(match.turn_deadline).getTime() : 0,
    }

    // A board whose clock ran out while both players were away would sit here
    // forever. Any caller may advance it, and the commit that follows is the same
    // one a real pass makes.
    //
    // Deliberately not isStalled(): that also requires `rolled` to be false, which
    // misses the commonest stuck board of all - the player rolled, never picked a
    // token, and walked away. Once the deadline is gone the turn is forfeit
    // whatever they had done, so that is the only thing worth testing here.
    if (ctx.now > ctx.deadline && action !== 'pass') {
      const forced = decidePass(ctx)
      if (forced.ok) {
        await commit(admin, {
          matchId,
          uid,
          version: match.version,
          fromSeat: match.turn_seat ?? 0,
          state: forced.state,
          turn: forced.state.turn,
          deadline: nextDeadline(ctx.now),
          winner: null,
        })
        return json({ error: 'your turn had already timed out; the board was advanced', timed_out: true }, 409)
      }
    }

    const decision =
      action === 'roll'
        ? decideRoll(ctx)
        : action === 'move'
          ? decideMove(ctx, body.token as number)
          : decidePass(ctx)

    if (!decision.ok) {
      // 409 not 400: the client is fine, the board simply moved on without it.
      // Telling the caller to resync is the whole point - the alternative is a
      // phone that keeps showing a board that no longer exists.
      return json({ ...view(), error: decision.error, code: decision.code }, 409)
    }

    const winner = decision.winner
    const { data: committed, error: commitErr } = await commit(admin, {
      matchId,
      uid,
      version: match.version,
      fromSeat: match.turn_seat ?? 0,
      state: decision.state,
      turn: decision.state.turn,
      // a finished match has nobody left on the clock
      deadline: winner === null ? nextDeadline(ctx.now) : null,
      winner,
    })
    if (commitErr) {
      // Almost always a lost race: someone committed between our read and here.
      // The version guard in ludo_commit is what stopped it landing.
      return json({ error: commitErr.message, code: 'stale_board', ...view() }, 409)
    }

    return json({
      ...view(),
      version: committed?.version ?? match.version + 1,
      winner_seat: winner ?? match.winner_seat,
    })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})

/** the one and only board write. every guard lives in ludo_commit. */
async function commit(
  admin: ReturnType<typeof createClient>,
  a: {
    matchId: string
    uid: string
    version: number
    fromSeat: number
    state: unknown
    turn: number
    deadline: number | null
    winner: number | null
  },
) {
  const args: LudoCommitArgs = {
    p_match_id: a.matchId,
    // the id comes from the verified JWT above, never from the request body
    p_user: a.uid,
    p_version: a.version,
    p_from_seat: a.fromSeat,
    p_state: a.state,
    p_turn: a.turn,
    p_deadline: a.deadline === null ? null : new Date(a.deadline).toISOString(),
    p_winner: a.winner,
  }
  return admin.rpc('ludo_commit', args)
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}