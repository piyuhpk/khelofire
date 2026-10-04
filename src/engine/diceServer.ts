// Server-side turn authority for a paid Dice Duel match.
//
// Same shape as src/engine/ludoServer.ts and for the same reason: this module decides
// what actually happened, and the phone only sends an intent. Nothing here reads a
// clock, touches a database or knows what "now" means - that is all passed in - so the
// whole state machine can be exercised by throwing matches at it in a test.
//
// Dice Duel needed one decision the Ludo rules did not have: who throws first in a
// round. Because both dice are generated together and scored by resolveRound, opening
// a round must not carry any information - see nextInitiator.

import {
  DICE_TURN_SECONDS,
  initDice,
  nextInitiator,
  resolveRound,
  rollRound,
  type DiceSeat,
  type DiceState,
} from './dice.ts'

export { DICE_TURN_SECONDS as TURN_SECONDS }

export interface DiceTurnContext {
  /** the match as stored on the server */
  state: DiceState
  /** the seat the caller occupies */
  seat: DiceSeat
  /** server clock, epoch ms */
  now: number
  /** live_matches.turn_deadline, epoch ms */
  deadline: number
}

export type DiceDecision =
  | { ok: true; state: DiceState; winner: DiceSeat | null; turnKept: boolean }
  | { ok: false; code: string; error: string }

/** A fresh clock for the turn being handed to someone. */
export const nextDeadline = (now: number): number => now + DICE_TURN_SECONDS * 1000

/**
 * Throw the round.
 *
 * `diceArg` exists only so a test can pin a match down. In production both throws come
 * from rollRound() and nothing in the request body can influence them - a client that
 * sent its own numbers would simply be ignored, because the body has no field for it.
 */
export function decideThrow(ctx: DiceTurnContext, diceArg?: [number, number]): DiceDecision {
  const { state, seat, now, deadline } = ctx

  if (state.winner !== null) return { ok: false, code: 'finished', error: 'match is over' }

  // Waiting out your own clock forfeits the round even if you never touched the screen.
  if (now > deadline) return { ok: false, code: 'expired', error: 'your turn timed out' }
  if (seat !== state.turn) return { ok: false, code: 'not_your_turn', error: `it is seat ${state.turn}` }
  // Guarded on thrownRound, not on dice: dice is kept after scoring so the phones can
  // still show it, and testing that here would make every round after the first
  // unopenable - the match would sit on round one until the clock ran it out.
  if (state.thrownRound === state.round) return { ok: false, code: 'already_threw', error: 'this round was already thrown' }

  const dice = diceArg ?? rollRound()
  const next = resolveRound(state, dice)

  return { ok: true, state: next, winner: next.winner, turnKept: false }
}

/**
 * Give the round up: a timeout, or the player deciding not to throw.
 *
 * Whoever holds the expired turn forfeits it and it passes to the other seat. Any caller
 * may drive this once the deadline has passed, which is what stops an abandoned player
 * freezing a paid match for the opponent forever.
 */
export function decidePass(ctx: DiceTurnContext): DiceDecision {
  const { state, seat, now, deadline } = ctx

  if (state.winner !== null) return { ok: false, code: 'finished', error: 'match is over' }

  const expired = now > deadline
  const mine = seat === state.turn
  if (!expired && !mine) {
    return { ok: false, code: 'not_your_turn', error: `it is seat ${state.turn}` }
  }

  const next: DiceState = { ...state, turn: nextInitiator(state.round + 1) }
  return { ok: true, state: next, winner: null, turnKept: false }
}

/** True when the clock has run out on a round nobody threw - i.e. a board that needs a
 *  nudge. The client auto-submits a pass on load when this is true. */
export const isStalled = (ctx: DiceTurnContext): boolean =>
  ctx.now > ctx.deadline && ctx.state.winner === null && ctx.state.thrownRound !== ctx.state.round

/** Guard against a stored state the engine cannot use. A crash here should be a clean
 *  error at the edge, not an undefined read in the middle of a paid match. */
export function isUsableDiceState(s: unknown): s is DiceState {
  if (!s || typeof s !== 'object') return false
  const v = s as Record<string, unknown>
  if (typeof v.round !== 'number' || !Number.isInteger(v.round) || v.round < 1) return false
  if (v.initiator !== 0 && v.initiator !== 1) return false
  if (v.turn !== 0 && v.turn !== 1) return false
  if (v.winner !== null && v.winner !== 0 && v.winner !== 1) return false
  if (!Array.isArray(v.scores) || v.scores.length !== 2) return false
  if (!v.scores.every((n) => typeof n === 'number' && n >= 0)) return false
  if (v.thrownRound !== null && (!Number.isInteger(v.thrownRound) || (v.thrownRound as number) < 1)) return false
  if (v.dice !== null) {
    if (!Array.isArray(v.dice) || v.dice.length !== 2) return false
    const ok = v.dice.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 6)
    if (!ok) return false
  }
  return true
}

/** Re-exported so the edge function can seed a board with the same rules module. */
export { initDice }