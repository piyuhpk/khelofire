// 16 Guti / Sholo Guti — playable alquerque-style engine on a 5x5 line board.
// 24 pieces (12 each), center empty. Slide along drawn lines; capture by
// jumping an adjacent enemy to the empty node beyond. Captures are mandatory.
export type Cell = 0 | 1 | 2 // 0 empty · 1 player · 2 bot
export const N = 5
export const idx = (r: number, c: number) => r * N + c
export const rc = (i: number): [number, number] => [Math.floor(i / N), i % N]
const inb = (r: number, c: number) => r >= 0 && r < N && c >= 0 && c < N
// diagonals are drawn only on nodes where (r+c) is even
const hasDiag = (r: number, c: number) => (r + c) % 2 === 0

const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]]
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
export const dirsFor = (r: number, c: number) => (hasDiag(r, c) ? [...ORTH, ...DIAG] : ORTH)

export interface Move { from: number; to: number; capture?: number }

export function initialBoard(): Cell[] {
  const b = Array(N * N).fill(0) as Cell[]
  for (let i = 0; i < N * N; i++) {
    if (i < 12) b[i] = 2       // top half → bot
    else if (i > 12) b[i] = 1  // bottom half → player  (i===12 center stays empty)
  }
  return b
}

export function movesForPiece(b: Cell[], i: number): Move[] {
  const me = b[i]
  if (!me) return []
  const [r, c] = rc(i)
  const res: Move[] = []
  for (const [dr, dc] of dirsFor(r, c)) {
    const nr = r + dr, nc = c + dc
    if (!inb(nr, nc)) continue
    const j = idx(nr, nc)
    if (b[j] === 0) { res.push({ from: i, to: j }); continue }
    if (b[j] !== me) {
      const br = r + 2 * dr, bc = c + 2 * dc
      if (inb(br, bc) && b[idx(br, bc)] === 0) res.push({ from: i, to: idx(br, bc), capture: j })
    }
  }
  return res
}

// Mandatory-capture rule: if any capture exists for the player, only captures are legal.
export function legalMoves(b: Cell[], player: Cell): Move[] {
  const all: Move[] = []
  for (let i = 0; i < N * N; i++) if (b[i] === player) all.push(...movesForPiece(b, i))
  const caps = all.filter((m) => m.capture !== undefined)
  return caps.length ? caps : all
}

export const captureContinuations = (b: Cell[], i: number) =>
  movesForPiece(b, i).filter((m) => m.capture !== undefined)

export function applyMove(b: Cell[], m: Move): Cell[] {
  const nb = b.slice()
  nb[m.to] = nb[m.from]; nb[m.from] = 0
  if (m.capture !== undefined) nb[m.capture] = 0
  return nb
}

export const count = (b: Cell[], player: Cell) => b.reduce((n: number, x) => n + (x === player ? 1 : 0), 0)

// One full bot turn. Smart: longest capture chain > safe advances > center
// control. Falls back to random when all moves are equivalent.
export function botTurn(b: Cell[], rnd: () => number): Cell[] {
  let nb = b
  const moves = legalMoves(nb, 2)
  if (!moves.length) return nb

  // how many pieces player(1) could jump from a node (lower = safer landing)
  const threat = (board: Cell[], node: number): number => {
    const [r, c] = rc(node)
    let n = 0
    for (const [dr, dc] of [...ORTH, ...DIAG]) {
      const pr = r - dr, pc = c - dc, br = r - dr * 2, bc = c - dc * 2
      if (!inb(pr, pc) || !inb(br, bc)) continue
      if (board[idx(pr, pc)] === 1 && board[idx(br, bc)] === 0) n++
    }
    return n
  }
  // length of capture chain starting with m
  const chainLen = (start: Cell[], m: Move): number => {
    let best = 1, cur = applyMove(start, m), last = m
    while (last.capture !== undefined) {
      const cont = captureContinuations(cur, last.to)
      if (!cont.length) break
      // greedy: take the continuation that itself chains the most (depth ≤ 1 look)
      const pick = cont.reduce((a, c) => {
        const after = applyMove(cur, c)
        const depth = captureContinuations(after, c.to).length
        const depthA = captureContinuations(applyMove(cur, a), a.to).length
        return depth > depthA ? c : a
      })
      last = pick; cur = applyMove(cur, pick); best++
    }
    return best
  }

  let m: Move
  const caps = moves.filter((x) => x.capture !== undefined)
  if (caps.length) {
    // mandatory-capture set: take the longest chain, tie-break on value gained
    m = caps.reduce((a, c) => {
      const la = chainLen(nb, a), lc = chainLen(nb, c)
      if (lc !== la) return lc > la ? c : a
      const ta = threat(nb, a.to), tc = threat(nb, c.to)
      return tc < ta ? c : a
    })
  } else {
    // heuristic: prefer safe + forward + center-adjacent nodes
    const score = (mv: Move): number => {
      const [r, c] = rc(mv.to)
      const center = 4 - (Math.abs(r - 2) + Math.abs(c - 2))      // up to 4
      const advance = 4 - rc(mv.from)[0]                          // push forward
      const safe = 3 - Math.min(3, threat(nb, mv.to))             // avoid jumps
      return center + advance * 0.5 + safe * 2
    }
    const ranked = moves.map((mv) => ({ mv, s: score(mv) }))
    const top = ranked.filter((x) => x.s === Math.max(...ranked.map((y) => y.s)))
    m = top[Math.floor(rnd() * top.length)].mv
  }

  nb = applyMove(nb, m)
  while (m.capture !== undefined) {
    const cont = captureContinuations(nb, m.to)
    if (!cont.length) break
    // continue the chain with the longest follow-up
    m = cont.reduce((a, c) => (chainLen(nb, c) > chainLen(nb, a) ? c : a), cont[0])
    nb = applyMove(nb, m)
  }
  return nb
}

// Unique board edges for drawing the line grid.
export function edges(): [number, number][] {
  const seen = new Set<string>()
  const out: [number, number][] = []
  for (let i = 0; i < N * N; i++) {
    const [r, c] = rc(i)
    for (const [dr, dc] of dirsFor(r, c)) {
      const nr = r + dr, nc = c + dc
      if (!inb(nr, nc)) continue
      const j = idx(nr, nc)
      const key = i < j ? `${i}-${j}` : `${j}-${i}`
      if (seen.has(key)) continue
      seen.add(key); out.push([i, j])
    }
  }
  return out
}
