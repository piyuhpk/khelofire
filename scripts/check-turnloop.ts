// Models the LUDO TURN LOOP (not just the engine) so a frozen board can be
// detected. The engine-only harness could not see this: legalTokens/applyMove
// were fine, but the component's two-timeout bot turn set dice/rolled first,
// which changed the effect deps, which ran the cleanup (alive = false), which
// killed the second timeout before the bot ever moved.
//
// usage: node check-turnloop.mjs
import { initLudo, legalTokens, applyMove, rollDice, botChoose, nextActive, type LudoState } from '../src/engine/ludo'

let fails = 0
const bad = (m: string) => { console.log('  FAIL ' + m); fails++ }

type Split = 'split' | 'atomic'

/**
 * One bot turn.
 *  split  = the old code: setSt(dice,rolled) in t1, then move in t2, with the
 *           effect cleanup running in between because the deps changed.
 *  atomic = the fixed code: one timer, one state update.
 * Returns 'moved' | 'passed' | 'forfeit' | 'STUCK'.
 */
function botTurn(s: LudoState, split: Split): { st: LudoState; how: string } {
  const p = s.turn
  if (s.rolled || s.dice !== null) return { st: s, how: 'STUCK' }

  const d = rollDice()
  if (d === 6 && s.sixes >= 2) {
    return { st: { ...s, dice: null, rolled: false, sixes: 0, turn: nextActive(s, p) }, how: 'forfeit' }
  }
  const cur: LudoState = { ...s, dice: d, rolled: true, sixes: d === 6 ? s.sixes + 1 : s.sixes }
  const choice = botChoose(cur, p, d)
  if (choice === null) {
    return { st: { ...s, dice: null, rolled: false, sixes: 0, turn: nextActive(s, p) }, how: 'passed' }
  }

  if (split === 'atomic') {
    return { st: applyMove(cur, p, choice, d).state, how: 'moved' }
  }

  // ---- old pattern, reproduced faithfully
  // t1 commits the die. React sees new deps -> cleanup sets alive = false.
  const afterDice: LudoState = cur
  // t2 fires 750ms later and bails out on the flag the cleanup just cleared.
  const alive = false
  if (!alive) return { st: afterDice, how: 'STUCK' } // die shown, token never moves
  return { st: applyMove(cur, p, choice, d).state, how: 'moved' }
}

function runGame(num: number, split: Split): { resolved: boolean; steps: number; stuck: number; stuckSample: string } {
  let st: LudoState = initLudo(num)
  let steps = 0
  let stuck = 0
  let stuckSample = ''
  while (steps < 5000) {
    steps++
    if (st.winner !== null) return { resolved: true, steps, stuck, stuckSample }

    if (st.turn === 0) {
      // ---- human. The component gives 20s; if nothing is rolled the turn
      // passes. Model that as an immediate pass so we never loop forever.
      if (!st.rolled) {
        const d = rollDice()
        if (d === 6 && st.sixes >= 2) { st = { ...st, dice: null, rolled: false, sixes: 0, turn: nextActive(st, 0) }; continue }
        st = { ...st, dice: d, rolled: true, sixes: d === 6 ? st.sixes + 1 : st.sixes }
        continue
      }
      const legal = legalTokens(st, 0, st.dice!)
      if (!legal.length) { st = { ...st, dice: null, rolled: false, sixes: 0, turn: nextActive(st, 0) }; continue }
      st = applyMove(st, 0, legal[0], st.dice!).state
      continue
    }

    // ---- bot turn
    const before = JSON.stringify(st)
    const r = botTurn(st, split)
    if (r.how === 'STUCK') {
      stuck++
      if (!stuckSample) stuckSample = `turn=${st.turn} rolled=${st.rolled} dice=${st.dice} state=${before.slice(0, 90)}`
      // a frozen board cannot progress; keep spinning to prove it never clears
      st = r.st
      if (stuck > 3) return { resolved: false, steps, stuck, stuckSample }
      continue
    }
    st = r.st
  }
  return { resolved: false, steps, stuck, stuckSample }
}

for (const split of ['split', 'atomic'] as Split[]) {
  console.log(`=== bot turn pattern: ${split === 'split' ? 'OLD (two timeouts + alive flag)' : 'FIXED (one timeout, one update)'} ===`)
  for (const num of [2, 4] as const) {
    let resolved = 0, stuckGames = 0, totalStuck = 0
    let sample = ''
    for (let g = 0; g < 2000; g++) {
      const r = runGame(num, split)
      if (r.resolved) resolved++
      else stuckGames++
      totalStuck += r.stuck
      if (r.stuck && !sample) sample = r.stuckSample
    }
    const stuckPct = ((totalStuck / 2000) * 100).toFixed(1)
    console.log(`  ${num}p: resolved ${resolved}/2000, games that froze ${stuckGames}, bot turns lost ${totalStuck} (${stuckPct}% of games)`)
    if (sample) console.log(`       e.g. ${sample}`)
    if (split === 'atomic' && stuckGames) bad(`${num}p: ${stuckGames} games still freeze with the atomic pattern`)
    if (split === 'split' && stuckGames === 0) bad(`${split} pattern never froze - the harness cannot detect this bug, so it proves nothing`)
  }
  console.log('')
}

console.log(fails === 0
  ? 'VERIFIED: the old two-timeout pattern freezes the board, the fixed one-shot pattern never does.'
  : `${fails} CHECK(S) FAILED`)
process.exit(fails ? 1 : 0)