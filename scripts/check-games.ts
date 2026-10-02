import { initLudo, legalTokens, applyMove, rollDice, botChoose, nextActive, ringAbs, SAFE_ABS, START_OFFSET, FINISH, HOME_END, type LudoState, type PlayerId } from '../src/engine/ludo'
import { cellFor, PATH, HOME_COL, CENTER } from '../src/engine/ludoBoard'
import { initialBoard, legalMoves, applyMove as gApply, captureContinuations, count, botTurn, type Cell } from '../src/features/guti/gutiEngine'

let fails = 0
const bad = (m: string) => { console.log('  FAIL ' + m); fails++ }

console.log('=== LUDO: home column continuity ===')
for (const p of [0, 1, 2, 3] as PlayerId[]) {
  const col = HOME_COL[p]
  console.log(`player ${p}: home col len=${col.length} cells=${JSON.stringify(col)} center=${JSON.stringify(CENTER)}`)
  const last = col[col.length - 1]
  const gap = Math.abs(last[0] - CENTER[0]) + Math.abs(last[1] - CENTER[1])
  if (gap !== 1) bad(`player ${p}: last home cell ${JSON.stringify(last)} is ${gap} steps from centre ${JSON.stringify(CENTER)} (must be 1)`)
  // every home cell must be orthogonally adjacent to the previous one
  for (let i = 1; i < col.length; i++) {
    const d = Math.abs(col[i][0] - col[i - 1][0]) + Math.abs(col[i][1] - col[i - 1][1])
    if (d !== 1) bad(`player ${p}: home cells ${JSON.stringify(col[i - 1])} -> ${JSON.stringify(col[i])} are ${d} apart`)
  }
}

console.log('=== LUDO: exit cell -> first home cell ===')
for (const p of [0, 1, 2, 3] as PlayerId[]) {
  const exitAbs = (START_OFFSET[p] + 50) % 52
  const exit = PATH[exitAbs]
  const first = HOME_COL[p][0]
  const d = Math.abs(exit[0] - first[0]) + Math.abs(exit[1] - first[1])
  if (d !== 1) bad(`player ${p}: ring exit ${JSON.stringify(exit)} -> home[0] ${JSON.stringify(first)} is ${d} apart`)
}

console.log('=== LUDO: entry cell is the start square ===')
for (const p of [0, 1, 2, 3] as PlayerId[]) {
  const entry = PATH[START_OFFSET[p]]
  const got = cellFor(p, 1)
  if (entry[0] !== got[0] || entry[1] !== got[1]) bad(`player ${p}: entry mismatch ${JSON.stringify(entry)} vs ${JSON.stringify(got)}`)
}

console.log('=== LUDO: 2000 self-play games ===')
for (const num of [2, 4]) {
  let stuck = 0, over = 0, maxSteps = 0
  for (let g = 0; g < 2000; g++) {
    let s: LudoState = initLudo(num)
    let steps = 0
    while (s.winner === null && steps < 4000) {
      steps++
      const p = s.turn
      const d = rollDice()
      if (d === 6 && s.sixes >= 2) { s = { ...s, dice: null, rolled: false, sixes: 0, turn: nextActive(s, p) }; continue }
      const legal = legalTokens(s, p, d)
      const choice = legal.length ? (p === 0 ? legal[0] : botChoose(s, p, d)!) : null
      if (choice === null) { s = { ...s, dice: null, rolled: false, sixes: 0, turn: nextActive(s, p) }; continue }
      s = applyMove(s, p, choice, d).state
      for (const pl of s.players) for (const t of s.tokens[pl]) {
        if (t !== 0 && t !== FINISH && !(t >= 1 && t <= HOME_END)) bad(`illegal token pos ${t}`)
      }
    }
    if (s.winner !== null) over++
    if (steps >= 4000) stuck++
    maxSteps = Math.max(maxSteps, steps)
  }
  console.log(`  ${num}p: finished ${over}/2000, stuck ${stuck}, longest ${maxSteps} steps`)
  if (stuck > 0) bad(`${num}p: ${stuck} games never ended within 4000 steps (gameplay deadlock)`)
}

console.log('=== LUDO: capture does not hit safe cells ===')
{
  const s = initLudo(4)
  s.tokens = [[0, 0, 0, 0], [14, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]
  const absTarget = ringAbs(0, 15)
  const victim = (14 - START_OFFSET[1]) % 52 + 1
  s.tokens[1][0] = victim
  const res = applyMove(s, 0, 0, 6)
  console.log(`  moved red onto abs ${absTarget} (safe=${SAFE_ABS.has(absTarget)}), victim pos ${victim} -> ${res.state.tokens[1][0]}`)
  if (SAFE_ABS.has(absTarget) && res.state.tokens[1][0] === 0) bad('capture happened on a safe cell')
}

console.log('=== GUTI: initial board ===')
{
  const b = initialBoard()
  console.log(`  player pieces=${count(b, 1)} bot pieces=${count(b, 2)} centre=${b[12]}`)
  if (b[12] !== 0) bad('centre node is not empty')
  if (count(b, 1) !== 12 || count(b, 2) !== 12) bad(`expected 12 each, got ${count(b, 1)}/${count(b, 2)}`)
}

console.log('=== GUTI: no duplicate / off-board pieces, 3000 games ===')
let gOver = 0, gStuck = 0, gMax = 0, gBad = 0
for (let g = 0; g < 3000; g++) {
  let b: Cell[] = initialBoard()
  let turn: Cell = 1
  let steps = 0
  let over = false
  while (steps < 3000) {
    steps++
    if (turn === 1) {
      const mv = legalMoves(b, 1)
      if (!mv.length) { over = true; break }
      b = gApply(b, mv[Math.floor(Math.random() * mv.length)])
      if (count(b, 2) === 0) { over = true; break }
      turn = 2
    } else {
      b = botTurn(b, Math.random)
      if (count(b, 1) === 0) { over = true; break }
      turn = 1
    }
    const tot = b.reduce((n, x) => n + (x ? 1 : 0), 0)
    if (tot !== count(b, 1) + count(b, 2)) { gBad++; break }
  }
  if (over) gOver++
  if (steps >= 3000) gStuck++
  gMax = Math.max(gMax, steps)
}
console.log(`  finished ${gOver}/3000, stuck ${gStuck}, longest ${gMax} steps, corrupt ${gBad}`)
if (gBad) bad(`${gBad} games produced a corrupt board (pieces lost/duplicated)`)
if (gStuck > 0) bad(`${gStuck} goti games never resolved within 3000 steps`)

console.log('=== GUTI: mandatory capture is actually mandatory ===')
{
  let checked = 0
  for (let g = 0; g < 400 && checked < 40; g++) {
    let b: Cell[] = initialBoard()
    for (let i = 0; i < 60; i++) {
      const all = legalMoves(b, 1)
      const anyCapture = Array.from({ length: 25 }, (_, k) => b[k] === 1).some((_, k) => legalMoves(b, 1).some((m) => m.capture !== undefined))
      if (anyCapture && all.some((m) => m.capture === undefined) && checked < 40) {
        bad(`mandatory capture violated: simple moves offered while a capture exists`)
        checked++
      }
      const mv = all[Math.floor(Math.random() * all.length)]
      if (!mv) break
      b = gApply(b, mv)
    }
    if (checked >= 40) break
  }
  console.log(`  mandatory-capture violations: ${checked}`)
}

console.log('')
console.log(fails === 0 ? 'ALL CHECKS PASSED' : `${fails} CHECK(S) FAILED`)
