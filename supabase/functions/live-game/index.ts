// Supabase Edge Function: live-game
//
// Drives the board for any paid match that has a server engine. Right now that is Ludo
// and Dice Duel; Guti and Chess get added by registering a game, not by writing another
// copy of this file.
//
// Why one function instead of one per game.
//
// ludo-game was written for Ludo and is proven in production against real money. The
// temptation was to copy it to dice-game and edit. That is how a payout bug happens: the
// replay guard in the copy is one character different from the original, or the expired
// turn is left out of it, and nothing notices until a player who reloads mid-match wins
// a round they should have forfeited. So this dispatches to a rules module and shares
// every guard. Adding Guti means writing src/engine/gutiServer.ts and registering it
// below.
//
// The rules modules are imported from the same src/engine the phone plays with, so
// there is one implementation of each game rather than a server copy that drifts.
//
// Why the identity work comes first.
//
// settle_match pays out from winner_seat, and winner_seat is only writable through a
// service-role client. Everything here therefore runs on service_role, which means the
// JWT in the Authorization header is the only thing that says who is asking. It is
// resolved before any match row is read, and the resulting uid - never anything from the
// body - is what is passed to ludo_commit as p_user.
//
// Deploy:
//   supabase functions deploy live-game
//
// Call (Authorization must be the player's own Supabase access token):
//   POST <project>/functions/v1/live-game
//   { "match_id": "<uuid>", "action": "state" | "roll" | "move" | "throw" | "pass", "token": 0 }
//
// The action set is the union of what each game needs. An action a game does not have -
// "move" on a Dice match - is refused by the game rather than ignored, so a client bug
// shows up as an error instead of a match that silently never advances.
//
// "state" is read-only and gated on the same seat check as a move, so it reveals
// nothing to a non-participant. It is how a phone learns the opponent's moves and
// resyncs after a dropped realtime message, without forcing it to submit a move just to
// see the board.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  decideMove,
  decidePass as decideLudoPass,
  decideRoll,
  isUsableState,
  nextDeadline as nextLudoDeadline,
  TURN_SECONDS as LUDO_TURN_SECONDS,
  type TurnContext as LudoTurnContext,
} from '../../../src/engine/ludoServer.ts'
import {
  decidePass as decideDicePass,
  decideThrow,
  isUsableDiceState,
  nextDeadline as nextDiceDeadline,
  TURN_SECONDS as DICE_TURN_SECONDS,
  type DiceTurnContext,
} from '../../../src/engine/diceServer.ts'
import type { PlayerId } from '../../../src/engine/ludo.ts'
import type { LudoState } from '../../../src/engine/ludo.ts'
import type { DiceSeat, DiceState } from '../../../src/engine/dice.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Game = 'ludo' | 'dice'
type Action = 'state' | 'roll' | 'move' | 'pass' | 'throw'

const ALL_ACTIONS: Action[] = ['state', 'roll', 'move', 'pass', 'throw']

/**
 * Which actions each game understands.
 *
 * Enforced rather than ignored on purpose. If a Dice match receives "move", silently
 * treating it as something else would advance a board the client did not think it had
 * advanced; a client sending the wrong action is a bug, and this is where it should be
 * visible.
 */
const GAME_ACTIONS: Record<Game, Action[]> = {
  ludo: ['state', 'roll', 'move', 'pass'],
  dice: ['state', 'throw', 'pass'],
}

/** The on-screen clock length, so a phone can draw the same one the server keeps. */
const TURN_SECONDS: Record<Game, number> = {
  ludo: LUDO_TURN_SECONDS,
  dice: DICE_TURN_SECONDS,
}

// The exact columns this function selects. Written out rather than inferred because the
// supabase client is stubbed for typechecking (see deno.d.ts), and an inferred `any` would
// mean a typo in `match.version` compiles fine and then reads undefined in production.
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
  mode: string
}

interface ModeRow {
  game: string
}

/**
 * The exact argument list of public.ludo_commit in supabase/003_ludo_engine.sql, which
 * is also the commit path for Dice - it holds no game rules, only identity and ordering.
 *
 * Typed out on purpose. p_deadline is a string here and not `number | null` because
 * PostgREST casts a bare number to timestamptz as epoch SECONDS: sending the milliseconds
 * we hold in memory would push every deadline ~54000 years into the future and expire
 * each turn the instant it began. Making the field a string turns that mistake into a
 * compile error instead of a broken paid match.
 */
interface CommitArgs {
  p_match_id: string
  p_user: string
  p_version: number
  p_from_seat: number
  p_state: unknown
  p_turn: number
  p_deadline: string | null
  p_winner: number | null
}

/** What every game module has to hand back for a legal action. */
type Outcome = { state: Record<string, unknown>; turn: number; winner: number | null }
type Refusal = { ok: false; code: string; error: string }

/**
 * Narrows the body's action to a real one.
 *
 * A cast would typecheck `action` as an Action and then send `decideMove` a token that
 * was never there. This returns undefined for anything unrecognised so the guard below
 * is the only place a bad action is caught.
 */
const isAction = (v: unknown): v is Action => typeof v === 'string' && ALL_ACTIONS.includes(v as Action)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const callerJwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!callerJwt) return json({ error: 'missing authorization' }, 401)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Who is this? The JWT is the only thing trusted here, and it is resolved before any
    // match data is touched. Everything downstream keys off this id.
    const { data: caller, error: callerErr } = await admin.auth.getUser(callerJwt)
    if (callerErr || !caller.user) return json({ error: 'invalid session' }, 401)
    const uid = caller.user.id

    const body = await req.json().catch(() => null)
    const matchId = body?.match_id as string | undefined
    const action = isAction(body?.action) ? body.action : undefined
    if (!matchId || !action) {
      return json({ error: `expected { match_id, action: ${ALL_ACTIONS.join('|')} }` }, 400)
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
      .select('id, status, version, state, turn_seat, turn_deadline, winner_seat, seat_count, mode')
      .eq('id', matchId)
      .maybeSingle()
    if (matchErr) return json({ error: matchErr.message }, 400)
    const match = matchRaw as MatchRow | null
    if (!match) return json({ error: 'unknown match' }, 404)

    // The game comes from the mode row, never from the request. A client that asked for
    // game: 'dice' on a Ludo match would otherwise have its request run through the wrong
    // rules module against a board shaped like the other game.
    const { data: modeRaw, error: modeErr } = await admin
      .from('match_modes')
      .select('game')
      .eq('id', match.mode)
      .maybeSingle()
    if (modeErr) return json({ error: modeErr.message }, 400)
    const game = (modeRaw as ModeRow | null)?.game as Game | undefined
    if (!game || !(game in GAME_ACTIONS)) {
      return json({ error: `the server has no live engine for ${game ?? 'this game'}` }, 400)
    }

    const view = (extra: Record<string, unknown> = {}) => ({
      match_id: match.id,
      game,
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
      turn_seconds: TURN_SECONDS[game],
      ...extra,
    })

    // `state` is read-only: it reports the board and the clock without touching the turn
    // or the version. A seated client needs it to paint the opponent's moves and to
    // resync after a dropped realtime message, and without it the only way to learn the
    // board would be to make a move - which is exactly the thing a client must never be
    // forced to do just to see the game.
    if (action === 'state') return json(view())

    if (!GAME_ACTIONS[game].includes(action)) {
      return json({ error: `${action} is not an action in ${game}` }, 400)
    }

    if (match.status !== 'live') return json(view())
    if (game === 'dice' ? !isUsableDiceState(match.state) : !isUsableState(match.state)) {
      // a board the engine cannot read is not something to guess at mid-match
      return json({ error: 'stored board is unreadable', state: match.state }, 500)
    }

    const now = Date.now()
    const deadline = match.turn_deadline ? new Date(match.turn_deadline).getTime() : 0
    const write = (o: Outcome) => ({
      matchId,
      uid,
      version: match.version,
      fromSeat: match.turn_seat ?? 0,
      state: o.state,
      turn: o.turn,
      deadline: o.winner === null ? (game === 'dice' ? nextDiceDeadline(now) : nextLudoDeadline(now)) : null,
      winner: o.winner,
    })

    // A board whose clock ran out while both players were away would sit here forever.
    // Any caller may advance it, and the commit that follows is the same one a real pass
    // makes.
    if (now > deadline && action !== 'pass') {
      const forced: Refusal | Outcome =
        game === 'dice'
          ? runDice(decideDicePass, match.state as never, seat.player_id as DiceSeat, now, deadline)
          : runLudo(decideLudoPass, match.state as never, seat.player_id as PlayerId, now, deadline)
      if ('state' in forced) {
        await commit(admin, write(forced))
        return json({ error: 'your turn had already timed out; the board was advanced', timed_out: true }, 409)
      }
    }

    const decided =
      game === 'dice'
        ? runDice(
            action === 'throw' ? decideThrow : decideDicePass,
            match.state as never,
            seat.player_id as DiceSeat,
            now,
            deadline,
            action === 'throw' ? undefined : undefined,
          )
        : runLudo(
            action === 'roll'
              ? decideRoll
              : action === 'move'
                ? (ctx) => decideMove(ctx, body.token as number)
                : decideLudoPass,
            match.state as never,
            seat.player_id as PlayerId,
            now,
            deadline,
          )

    if (!('state' in decided)) {
      // 409 not 400: the client is fine, the board simply moved on without it.
      // Telling the caller to resync is the whole point - the alternative is a phone
      // that keeps showing a board that no longer exists.
      return json({ ...view(), error: decided.error, code: decided.code }, 409)
    }

    const { data: committed, error: commitErr } = await commit(admin, write(decided))
    if (commitErr) {
      // Almost always a lost race: someone committed between our read and here.
      // The version guard in ludo_commit is what stopped it landing.
      return json({ error: commitErr.message, code: 'stale_board', ...view() }, 409)
    }

    return json({
      ...view(),
      version: committed?.version ?? match.version + 1,
      winner_seat: decided.winner ?? match.winner_seat,
    })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})

/**
 * Ludo actions. Dice's decideThrow takes an optional second argument for tests only, so
 * the two signatures do not line up and each game gets its own small adapter. That
 * asymmetry is the price of not handing a production code path a way to choose its own
 * dice.
 */
function runLudo(
  decide: (ctx: LudoTurnContext) => { ok: true; state: LudoState; winner: PlayerId | null } | Refusal,
  state: LudoState,
  seat: PlayerId,
  now: number,
  deadline: number,
): Outcome | Refusal {
  const ctx: LudoTurnContext = { state, seat, now, deadline }
  const d = decide(ctx)
  if (!('ok' in d) || d.ok === false) return { ok: false, code: d.code, error: d.error }
  const s = d.state as { turn: PlayerId }
  return { state: s as Record<string, unknown>, turn: s.turn, winner: d.winner ?? null }
}

function runDice(
  decide: (ctx: DiceTurnContext, diceArg?: [number, number]) => { ok: true; state: DiceState; winner: DiceSeat | null } | Refusal,
  state: DiceState,
  seat: DiceSeat,
  now: number,
  deadline: number,
  diceArg?: [number, number],
): Outcome | Refusal {
  const ctx: DiceTurnContext = { state, seat, now, deadline }
  const d = decide(ctx, diceArg)
  if (!('ok' in d) || d.ok === false) return { ok: false, code: d.code, error: d.error }
  const s = d.state as { turn: DiceSeat }
  return { state: s as Record<string, unknown>, turn: s.turn, winner: d.winner ?? null }
}

/** the one and only board write. every guard lives in ludo_commit. */
async function commit(admin: ReturnType<typeof createClient>, a: {
  matchId: string
  uid: string
  version: number
  fromSeat: number
  state: unknown
  turn: number
  deadline: number | null
  winner: number | null
}) {
  const args: CommitArgs = {
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