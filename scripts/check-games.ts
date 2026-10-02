import { initLudo, legalTokens, applyMove, rollDice, botChoose, nextActive, ringAbs, SAFE_ABS, START_OFFSET, FINISH, HOME_END, type LudoState, type PlayerId } from '../src/engine/ludo'
import { cellFor, PATH, HOME_COL, CENTER, QUAD_AREA, BASE_SLOTS } from '../src/engine/ludoBoard'
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

console.log('=== LUDO: capture on an unsafe cell sends the victim home ===')
{
  // The previous version of this check computed absTarget from a position the
  // mover never visited and then guarded on SAFE_ABS.has(...), so it asserted
  // nothing at all. Drive it from where applyMove actually lands.
  const s = initLudo(4)
  s.tokens = [[1, 0, 0, 0], [46, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] // abs 6 and abs 6
  const landed = ringAbs(0, 7)
  const victimCell = ringAbs(1, 46)
  if (landed === null || victimCell !== landed) bad(`test setup wrong: mover lands on abs ${landed}, victim sits on abs ${victimCell}`)
  if (SAFE_ABS.has(landed!)) bad(`test setup wrong: abs ${landed} is a safe cell, cannot test capture there`)
  const res = applyMove(s, 0, 0, 6) // pos 1 + 6 = pos 7
  const ok = res.captured && res.state.tokens[0][0] === 7 && res.state.tokens[1][0] === 0
  console.log(`  abs ${landed} (safe=${SAFE_ABS.has(landed!)}): mover -> pos ${res.state.tokens[0][0]}, victim pos 46 -> ${res.state.tokens[1][0]}, captured=${res.captured}`)
  if (!ok) bad(`capture did not send the victim home on unsafe abs ${landed}`)
  if (!res.extraTurn) bad('a capture must grant an extra turn')
}

console.log('=== LUDO: a token on a safe cell is NOT captured ===')
{
  const s = initLudo(4)
  s.tokens = [[1, 0, 0, 0], [48, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] // mover to abs 8, victim on abs 8
  const landed = ringAbs(0, 9)
  if (landed === null || !SAFE_ABS.has(landed)) bad(`test setup wrong: abs ${landed} is not a safe cell`)
  const res = applyMove(s, 0, 0, 8) // pos 1 + 8 = pos 9
  const ok = !res.captured && res.state.tokens[1][0] === 48
  console.log(`  abs ${landed} (safe=${SAFE_ABS.has(landed!)}): mover -> pos ${res.state.tokens[0][0]}, victim pos 48 -> ${res.state.tokens[1][0]}, captured=${res.captured}`)
  if (!ok) bad(`a token sitting on safe abs ${landed} was captured, which is illegal`)
}

console.log('=== LUDO: every token renders inside the board, centred on a cell ===')
{
  // mirrors LudoBoard.tsx: token anchor = cell centre, finished tokens fanned
  const FINISHED_SLOT: Record<number, [number, number]> = { 0: [-0.95, -0.95], 1: [0.95, -0.95], 2: [-0.95, 0.95], 3: [0.95, 0.95] }
  let checked = 0
  for (const num of [2, 4]) {
    for (let g = 0; g < 400; g++) {
      let s: LudoState = initLudo(num)
      for (let step = 0; step < 300 && s.winner === null; step++) {
        const p = s.turn
        const d = rollDice()
        const legal = legalTokens(s, p, d)
        const choice = legal.length ? (p === 0 ? legal[Math.floor(Math.random() * legal.length)] : botChoose(s, p, d)!) : null
        if (choice === null) { s = { ...s, dice: null, rolled: false, sixes: 0, turn: nextActive(s, p) }; continue }
        s = applyMove(s, p, choice, d).state
        for (const pl of s.players) {
          s.tokens[pl].forEach((pos, i) => {
            let [r, c] = cellFor(pl, pos, i)
            if (pos >= FINISH) { r += FINISHED_SLOT[i][0]; c += FINISHED_SLOT[i][1] }
            checked++
            // half a token is the widest overhang allowed before it looks cut off
            if (r < -0.6 || r > 15.6 || c < -0.6 || c > 15.6) bad(`token ${pl}-${i} at pos ${pos} renders off-board at (${r.toFixed(2)},${c.toFixed(2)})`)
          })
        }
      }
    }
  }
  console.log(`  ${checked} token placements checked, all within bounds`)
}

console.log('=== LUDO: yard slots sit on the centre of the drawn circle ===')
for (const p of [0, 1, 2, 3] as PlayerId[]) {
  const [r0, c0, r1, c1] = QUAD_AREA[p]
  // the white plate is inset one cell and 4 cells wide inside the quad
  const rows = [r0 + 1 + 1, r0 + 1 + 3] // quadrant centres, half-cell values
  const cols = [c0 + 1 + 1, c0 + 1 + 3]
  const got = BASE_SLOTS[p]
  for (let k = 0; k < 4; k++) {
    const [r, c] = got[k]
    const dr = Math.min(Math.abs(r - rows[0]), Math.abs(r - rows[1]))
    const dc = Math.min(Math.abs(c - cols[0]), Math.abs(c - cols[1]))
    if (Math.abs(dr) > 1.01 || Math.abs(dc) > 1.01) bad(`player ${p} yard slot ${k} at (${r},${c}) is not on a drawn circle (expect r~${rows} c~${cols})`)
  }
  console.log(`  player ${p}: quad [${r0},${c0},${r1},${c1}] slots ${JSON.stringify(got)}`)
}

console.log('=== LUDO: bot must not park tokens in enemy dice range ===')
{
  let risky = 0, total = 0
  for (let g = 0; g < 600; g++) {
    let s: LudoState = initLudo(4)
    for (let step = 0; step < 200 && s.winner === null; step++) {
      const p = s.turn
      if (p !== 0) {
        const d = rollDice()
        const legal = legalTokens(s, p, d)
        const pick = legal.length ? botChoose(s, p, d)! : null
        if (pick !== null) {
          const pos = s.tokens[p][pick] === 0 ? 1 : s.tokens[p][pick] + d
          const abs = ringAbs(p, pos)
          if (abs !== null && !SAFE_ABS.has(abs)) {
            let th = 0
            for (const o of s.players) if (o !== p) for (const tk of s.tokens[o]) {
              const oa = ringAbs(o, tk)
              if (oa === null) continue
              const dd = (abs - oa + 52) % 52
              if (dd >= 1 && dd <= 6) th++
            }
            total++
            if (th > 0) risky++
          }
        }
        if (pick === null) { s = { ...s, dice: null, rolled: false, sixes: 0, turn: nextActive(s, p) }; continue }
        s = applyMove(s, p, pick, d).state
      } else {
        const d = rollDice()
        const legal = legalTokens(s, 0, d)
        const pick = legal.length ? legal[Math.floor(Math.random() * legal.length)] : null
        if (pick === null) { s = { ...s, dice: null, rolled: false, sixes: 0, turn: nextActive(s, 0) }; continue }
        s = applyMove(s, 0, pick, d).state
      }
    }
  }
  const pct = total ? ((risky / total) * 100).toFixed(1) : '0'
  console.log(`  bot left a token in enemy dice range on ${risky}/${total} moves (${pct}%)`)
  if (total && risky / total > 0.35) bad(`bot is reckless: ${pct}% of moves land in enemy dice range`)
}

console.log('=== LUDO: bot beats a random mover (was the "weak AI" complaint) ===')
{
  let botWins = 0, rndWins = 0, draws = 0
  for (let g = 0; g < 1500; g++) {
    let s: LudoState = initLudo(2)
    let steps = 0
    while (s.winner === null && steps++ < 4000) {
      const p = s.turn
      const d = rollDice()
      if (d === 6 && s.sixes >= 2) { s = { ...s, dice: null, rolled: false, sixes: 0, turn: nextActive(s, p) }; continue }
      const legal = legalTokens(s, p, d)
      const pick = legal.length ? (p === 2 ? botChoose(s, p, d)! : legal[Math.floor(Math.random() * legal.length)]) : null
      if (pick === null) { s = { ...s, dice: null, rolled: false, sixes: 0, turn: nextActive(s, p) }; continue }
      s = applyMove(s, p, pick, d).state
    }
    if (s.winner === 2) botWins++
    else if (s.winner === 0) rndWins++
    else draws++
  }
  const wr = ((botWins / 1500) * 100).toFixed(1)
  console.log(`  bot (yellow) win rate vs random player: ${wr}%  [bot ${botWins} / random ${rndWins} / timeout ${draws}]`)
  if (botWins <= rndWins) bad(`bot is not stronger than a random mover (${botWins} vs ${rndWins})`)
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
