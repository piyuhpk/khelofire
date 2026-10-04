// Dice Duel rules, shared by the phone and the server.
//
// Pure for the same reason src/engine/ludo.ts is: a paid match is only worth anything
// if the rules cannot be bent by the player paying into it, and the only way to be
// sure of a rule set is to be able to run it a million times in a test.
//
// One implementation on purpose. The bot game in src/features/dice/DiceGame.tsx and the
// paid live match both read the scoring and the win condition from here, so "the same
// game with a real opponent" is true by construction rather than by two files agreeing.
//
// The match is a best-of: each round both dice are thrown at once and the higher one
// takes the round, ties take nothing, and the first to DICE_ROUNDS_TO_WIN takes the
// match. If five rounds finish 2-2 the match does not end - it goes to sudden death -
// because a paid match that ends level has no winner to pay and the alternative is
// either refunding or awarding a match to whoever the coin happened to favour.

/** Only 0 and 1: Dice Duel is two players, unlike Ludo's four. */
export type DiceSeat = 0 | 1

/** Rounds needed to take the match. */
export const DICE_ROUNDS_TO_WIN = 3

/**
 * Scheduled length. A match that reaches this still has to produce a winner, so this
 * is not a cap on rounds - see resolveRound.
 */
export const DICE_MAX_ROUNDS = 5

/** Must match TURN_SECONDS usage in the client and the interval in the migration. */
export const DICE_TURN_SECONDS = 20

export interface DiceState {
  /** 1-based round being played */
  round: number
  /** who threw first this round; alternates so neither seat always opens */
  initiator: DiceSeat
  /** both throws for this round, or null before it is thrown */
  dice: [number, number] | null
  /** the round the visible throw belongs to, or null before anything is thrown */
  thrownRound: number | null
  /** rounds won, by seat */
  scores: [number, number]
  /** whose turn it is - the initiator of the current round */
  turn: DiceSeat
  winner: DiceSeat | null
}

export const initDice = (): DiceState => ({
  round: 1,
  initiator: 0,
  dice: null,
  thrownRound: null,
  scores: [0, 0],
  turn: 0,
  winner: null,
})

/**
 * Who opens round `round`. Alternating matters once money is involved: if seat 0 always
 * opened, a seat-0 player would see their own throw before the opponent's every single
 * round, and could decline to open a round they were losing.
 */
export const nextInitiator = (round: number): DiceSeat => (round % 2 === 1 ? 0 : 1)

/** One throw of a die, 1-6. Injected in tests so a match can be made deterministic. */
export const rollOneDie = () => 1 + Math.floor(Math.random() * 6)

/** Both throws for a round. Generated together so neither player can influence either. */
export const rollRound = (): [number, number] => [rollOneDie(), rollOneDie()]

/**
 * Score a round that has been thrown and move on.
 *
 * Both throws are decided here rather than by the player who opened the round, so
 * opening a round is not a way to steer it.
 */
export function resolveRound(state: DiceState, dice: [number, number]): DiceState {
  if (state.winner !== null) return state
  // The round already has a throw on it. Scoring it a second time would invent a round
  // nobody played, which is a balance a player did not agree to. Keyed on thrownRound
  // rather than on dice: dice is kept after scoring so the phones can still show it,
  // and testing dice here would freeze the match on its first round forever.
  if (state.thrownRound === state.round) return state

  const scores: [number, number] = [state.scores[0], state.scores[1]]
  if (dice[0] > dice[1]) scores[0] += 1
  else if (dice[1] > dice[0]) scores[1] += 1
  // a tie scores nothing for either, and is still a played round

  const [a, b] = scores
  // Reaching the target always ends it. After the scheduled rounds a lead also ends it.
  // Level at the scheduled length does not: that is sudden death, and it resolves on
  // the next round because somebody has to reach the target.
  if (a >= DICE_ROUNDS_TO_WIN || b >= DICE_ROUNDS_TO_WIN) {
    const winner: DiceSeat = a >= DICE_ROUNDS_TO_WIN ? (a > b ? 0 : 1) : 1
    return { ...state, dice, thrownRound: state.round, scores, winner, turn: winner }
  }
  if (state.round >= DICE_MAX_ROUNDS && a !== b) {
    const winner: DiceSeat = a > b ? 0 : 1
    return { ...state, dice, thrownRound: state.round, scores, winner, turn: winner }
  }

  const round = state.round + 1
  const initiator = nextInitiator(round)
  // dice and thrownRound carry over so both phones can still show the throw that was
  // just scored, while the new round is visibly waiting for its own.
  return { ...state, round, dice, thrownRound: state.round, scores, initiator, turn: initiator, winner: null }
}

/** Rounds still available before sudden death begins, for a progress hint on screen. */
export const roundsLeft = (state: DiceState): number =>
  state.winner !== null ? 0 : Math.max(0, DICE_MAX_ROUNDS - state.round + 1)