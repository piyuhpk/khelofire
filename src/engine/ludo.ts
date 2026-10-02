// Ludo King–style engine. Supports 2 players (You vs Bot, opposite corners) or
// 4 players (You + 3 bots). Client-side, rule-correct, single-device.
//
// Token position model (per token):
//   0        = in base (yard)
//   1..51    = steps along the shared 52-cell ring (relative to that player's start)
//   52..57   = the 6-cell home column (runs into the centre square)
//   58       = finished (parked on the centre)
//
// The home column is SIX cells, not five. Each corner arm of the 15x15 board
// runs from the ring exit to the centre: exit, 6 arm cells, centre. With only
// five, the last arm cell sat two squares away from the centre and every
// finished token visibly teleported the last step - the glitch players saw.
export type PlayerId = 0 | 1 | 2 | 3

/** first position that sits on the coloured home column */
export const HOME_START = 52
/** last home-column cell, directly adjacent to the centre */
export const HOME_END = HOME_START + 5
/** parked on the centre square */
export const FINISH = HOME_END + 1

// Ludo King layout: Red top-left, Green top-right, Yellow bottom-right, Blue bottom-left.
// Exact Ludo King palette.
export const COLORS: Record<PlayerId, string> = { 0: '#ED1C24', 1: '#00A651', 2: '#FFC91F', 3: '#00AEEF' }
export const COLOR_NAME: Record<PlayerId, string> = { 0: 'Red', 1: 'Green', 2: 'Yellow', 3: 'Blue' }

// each player's entry point on the 52-ring (clockwise, 13 apart)
export const START_OFFSET: Record<PlayerId, number> = { 0: 0, 1: 13, 2: 26, 3: 39 }
// safe cells: the four coloured start squares + the four star squares
export const SAFE_ABS = new Set([0, 8, 13, 21, 26, 34, 39, 47])

export interface LudoState {
  tokens: number[][]     // [4][4] positions (only `players` are in play)
  players: PlayerId[]    // active players this match
  turn: PlayerId
  dice: number | null
  rolled: boolean
  sixes: number          // consecutive sixes in the current turn (3 = forfeit)
  winner: PlayerId | null
}

export const initLudo = (num = 2): LudoState => ({
  tokens: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
  players: num >= 4 ? [0, 1, 2, 3] : [0, 2], // 1v1 = opposite corners (Red vs Yellow)
  turn: 0, dice: null, rolled: false, sixes: 0, winner: null,
})

export const ringAbs = (p: PlayerId, pos: number): number | null =>
  pos < 1 || pos > 51 ? null : (START_OFFSET[p] + (pos - 1)) % 52

export const rollDice = () => 1 + Math.floor(Math.random() * 6)

/** next active player after `p`, following the fixed seating order */
export function nextActive(s: LudoState, p: PlayerId): PlayerId {
  const order = s.players
  const idx = order.indexOf(p)
  return order[(idx + 1) % order.length]
}

/** tokens `p` may legally move with this dice value */
export function legalTokens(s: LudoState, p: PlayerId, dice: number): number[] {
  const out: number[] = []
  s.tokens[p].forEach((pos, i) => {
    if (pos === 0) { if (dice === 6) out.push(i) }
    else if (pos >= FINISH) { /* already home */ }
    else if (pos + dice <= FINISH) out.push(i)
  })
  return out
}

export interface MoveResult { state: LudoState; captured: boolean; reachedHome: boolean; extraTurn: boolean }

export function applyMove(s: LudoState, p: PlayerId, tokenIdx: number, dice: number): MoveResult {
  const tokens = s.tokens.map((a) => [...a])
  let pos = tokens[p][tokenIdx]
  pos = pos === 0 ? 1 : pos + dice
  tokens[p][tokenIdx] = pos

  // capture: any opponent token sharing this ring cell (unless it's a safe cell) goes home
  let captured = false
  const abs = ringAbs(p, pos)
  if (abs !== null && !SAFE_ABS.has(abs)) {
    for (const opp of s.players) {
      if (opp === p) continue
      tokens[opp].forEach((oPos, oi) => {
        if (ringAbs(opp, oPos) === abs) { tokens[opp][oi] = 0; captured = true }
      })
    }
  }

  const reachedHome = pos === FINISH
  const playerDone = tokens[p].every((t) => t >= FINISH)
  const extraTurn = dice === 6 || captured || reachedHome
  const winner = playerDone ? p : null // first player to bring all four home wins the match
  return {
    state: {
      ...s,
      tokens,
      dice: null,
      rolled: false,
      sixes: extraTurn ? s.sixes : 0,
      winner,
      turn: winner ? p : extraTurn ? p : nextActive(s, p),
    },
    captured, reachedHome, extraTurn,
  }
}

/** how many enemy tokens sit on ring cell `pos` (i.e. p could capture them) */
function capturesAt(s: LudoState, p: PlayerId, pos: number): number {
  const abs = ringAbs(p, pos)
  if (abs === null || SAFE_ABS.has(abs)) return 0
  let n = 0
  for (const o of s.players) {
    if (o === p) continue
    for (const t of s.tokens[o]) if (ringAbs(o, t) === abs) n++
  }
  return n
}

/** how many enemy tokens can reach ring cell `pos` with a single roll of 1..6 */
function threatsAt(s: LudoState, p: PlayerId, pos: number): number {
  const abs = ringAbs(p, pos)
  if (abs === null || SAFE_ABS.has(abs)) return 0 // safe squares cannot be captured
  let n = 0
  for (const o of s.players) {
    if (o === p) continue
    for (const t of s.tokens[o]) {
      const oa = ringAbs(o, t)
      if (oa === null) continue
      const d = (abs - oa + 52) % 52
      if (d >= 1 && d <= 6) n++
    }
  }
  return n
}

/**
 * Bot policy.
 *
 * The old policy was capture > finish > open on a 6 > "advance whichever token
 * is furthest". It never counted how many enemy dice could punish the square it
 * stopped on, so it fed tokens to the nearest opponent and ignored the safe
 * squares entirely. This scores every legal move instead: take free captures,
 * race home, refuse to idle in reach of a counter, and only leave the yard when
 * the start square is genuinely safe.
 */
export function botChoose(s: LudoState, p: PlayerId, dice: number): number | null {
  const legal = legalTokens(s, p, dice)
  if (!legal.length) return null

  const landing = (i: number) => (s.tokens[p][i] === 0 ? 1 : s.tokens[p][i] + dice)

  let bestScore = -Infinity
  let best: number[] = []
  for (const i of legal) {
    const pos = landing(i)
    const cap = capturesAt(s, p, pos)
    const risk = threatsAt(s, p, pos)

    let sc = 0
    if (cap > 0) sc += 120 + cap * 25 // sending an enemy home is the whole game
    if (pos === FINISH) sc += 90
    else if (pos >= HOME_START) sc += 35 // the home column is untouchable
    sc -= risk * 34 // do not park where a 1..6 can undo the move
    sc += Math.min(pos, FINISH) * 0.6 // keep the leader moving

    if (s.tokens[p][i] === 0) {
      sc += risk > 0 ? -8 : 14 // leaving the yard is only worth it if the start is safe
    } else if (risk > 0) {
      sc -= 12 // a threatened token is worth less than an equally safe one
    }

    if (sc > bestScore) { bestScore = sc; best = [i] }
    else if (sc === bestScore) best.push(i)
  }

  return best[Math.floor(Math.random() * best.length)] // tie-break so games differ
}
