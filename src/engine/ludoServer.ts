// Server-side turn rules for a real paid Ludo match.
//
// Pure on purpose: no clock, no database, no network. Everything it needs about
// "now" and about the dice is passed in, so the whole state machine can be tested
// by playing thousands of matches in milliseconds - which is the only way to be
// confident about a machine that pays out real money.
//
// This is the authority. The phone renders a board and sends intents; it never
// decides what a dice roll was or which move was legal.

import {
  applyMove,
  legalTokens,
  nextActive,
  rollDice,
  type LudoState,
  type PlayerId,
} from './ludo'

/** Must match TURN_SECONDS in src/features/ludo/LudoGame.tsx and the interval in
 *  supabase/003_ludo_engine.sql. One number, three places, all commented. */
export const TURN_SECONDS = 20

export interface TurnContext {
  /** the board as stored on the server */
  state: LudoState
  /** the engine seat the caller occupies */
  seat: PlayerId
  /** server clock, epoch ms */
  now: number
  /** live_matches.turn_deadline, epoch ms */
  deadline: number
}

export type Decision =
  | { ok: true; state: LudoState; winner: PlayerId | null; turnKept: boolean }
  | { ok: false; code: string; error: string }

/** a fresh clock for the turn being handed to someone */
export function nextDeadline(now: number): number {
  return now + TURN_SECONDS * 1000
}

/** Three sixes in a row forfeits the turn, same as the local game. */
const isForfeitOnSixes = (state: LudoState, dice: number): boolean => dice === 6 && state.sixes >= 2

/** No legal token left after a roll: the turn simply ends. */
const passesTurn = (state: LudoState, seat: PlayerId): LudoState => ({
  ...state,
  dice: null,
  rolled: false,
  sixes: 0,
  turn: nextActive(state, seat),
})

/**
 * Roll. The dice value is chosen here or, in tests, injected - it is never read
 * from the request. `diceArg` exists only so a test can make a match deterministic.
 */
export function decideRoll(ctx: TurnContext, diceArg?: number): Decision {
  const { state, seat, now, deadline } = ctx

  if (state.winner !== null) return { ok: false, code: 'finished', error: 'match is over' }

  // Once the clock has run out the turn is forfeit, whoever is still tapping. A
  // player who waits out their own timer must not then get to move.
  if (now > deadline) {
    return { ok: false, code: 'expired', error: 'your turn timed out' }
  }
  if (seat !== state.turn) return { ok: false, code: 'not_your_turn', error: `it is seat ${state.turn}` }
  if (state.rolled || state.dice !== null) {
    return { ok: false, code: 'already_rolled', error: 'you already rolled this turn' }
  }

  const dice = diceArg ?? rollDice()

  if (isForfeitOnSixes(state, dice)) {
    return { ok: true, state: passesTurn(state, seat), winner: null, turnKept: false }
  }

  const legal = legalTokens(state, seat, dice)
  if (!legal.length) {
    // rolled a 1-5 with nothing movable, or a 6 with a full yard: nothing happens
    return { ok: true, state: passesTurn(state, seat), winner: null, turnKept: false }
  }

  return {
    ok: true,
    // A non-six must RESET the counter, not leave it. This read
// `dice === 6 ? state.sixes + 1 : state.sixes`, which was right only because the
// move that followed used to clear it - and once the move stopped clearing it (so
// that a capture could no longer preserve a six streak), this line had to own the
// reset or `sixes >= 2` would trigger on two sixes with any capture between them.
state: { ...state, dice, rolled: true, sixes: dice === 6 ? state.sixes + 1 : 0 },
    winner: null,
    turnKept: true,
  }
}

/**
 * Move a token. Only the token INDEX is ever taken from the client; the dice that
 * makes it legal is the one already stored on the server.
 */
export function decideMove(ctx: TurnContext, tokenIdx: number): Decision {
  const { state, seat, now, deadline } = ctx

  if (state.winner !== null) return { ok: false, code: 'finished', error: 'match is over' }
  if (now > deadline) return { ok: false, code: 'expired', error: 'your turn timed out' }
  if (seat !== state.turn) return { ok: false, code: 'not_your_turn', error: `it is seat ${state.turn}` }
  if (!state.rolled || state.dice === null) {
    return { ok: false, code: 'roll_first', error: 'roll before moving' }
  }

  const legal = legalTokens(state, seat, state.dice)
  if (!Number.isInteger(tokenIdx) || !legal.includes(tokenIdx)) {
    return { ok: false, code: 'illegal_move', error: `token ${tokenIdx} cannot move on ${state.dice}` }
  }

  const res = applyMove(state, seat, tokenIdx, state.dice)
  return {
    ok: true,
    state: res.state,
    winner: res.state.winner,
    // an extra turn keeps the clock with the same player, and it gets a fresh
    // budget - matching the local game, where rolling restarts the countdown
    turnKept: res.state.turn === seat,
  }
}

/**
 * Give up the turn: a timeout, or a player giving up on it.
 *
 * Anyone may drive this once the deadline has passed. That is the difference
 * between "the board stops" and "the board recovers on its own", and it is why a
 * player who abandons a paid match cannot freeze the opponent forever.
 */
export function decidePass(ctx: TurnContext): Decision {
  const { state, seat, now, deadline } = ctx

  if (state.winner !== null) return { ok: false, code: 'finished', error: 'match is over' }

  const expired = now > deadline
  const mine = seat === state.turn
  if (!expired && !mine) {
    return { ok: false, code: 'not_your_turn', error: `it is seat ${state.turn}` }
  }

  // an expired turn is handed on from whoever currently holds it, not from the
  // caller - the caller may be the other player simply nudging a dead board
  return { ok: true, state: passesTurn(state, state.turn), winner: null, turnKept: false }
}

/** True when nobody has moved and the clock has run out - i.e. a board that needs
 *  a nudge. The client uses this to auto-submit a pass on load. */
export function isStalled(ctx: TurnContext): boolean {
  return ctx.now > ctx.deadline && ctx.state.winner === null && !ctx.state.rolled
}

/** Guard against a board that was stored in a shape the engine cannot use. A
 *  crash here should be a clean error, not an undefined read mid-match. */
export function isUsableState(s: unknown): s is LudoState {
  if (!s || typeof s !== 'object') return false
  const v = s as Record<string, unknown>
  if (!Array.isArray(v.tokens) || v.tokens.length !== 4) return false
  if (!v.tokens.every((row) => Array.isArray(row) && row.length === 4 && row.every((n) => typeof n === 'number')))
    return false
  if (!Array.isArray(v.players) || !v.players.length) return false
  if (!v.players.every((p) => p === 0 || p === 1 || p === 2 || p === 3)) return false
  if (typeof v.turn !== 'number') return false
  if (v.dice !== null && typeof v.dice !== 'number') return false
  if (typeof v.rolled !== 'boolean') return false
  if (typeof v.sixes !== 'number') return false
  return v.winner === null || v.winner === 0 || v.winner === 1 || v.winner === 2 || v.winner === 3
}