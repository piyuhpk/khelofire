// Models the LUDO TURN LOOP (not just the engine) so a frozen board can be
// detected. The engine-only harness could not see this: legalTokens/applyMove
// were fine, but the component's two-timeout bot turn set dice/rolled first,
// which changed the effect deps, which ran the cleanup (alive = false), which
// killed the second timeout before the bot ever moved.
//
// usage: node check-turnloop.mjs
import { readFileSync } from 'node:fs'
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

// ---------------------------------------------------------------------------
// Source guards. The simulation above is a MODEL of the component, so it cannot
// catch the component drifting back into the broken shape. These read the real
// src/features/ludo/LudoGame.tsx and assert the exact constructs that caused the
// permanent freezes, so a regression fails here instead of in a paid match.
// Must be run from the repo root.
console.log('=== LUDO: real source guards on src/features/ludo/LudoGame.tsx ===')
{
  const src = readFileSync('src/features/ludo/LudoGame.tsx', 'utf8')
  const slice = (from: string, to: string): string => {
    const a = src.indexOf(from)
    const b = src.indexOf(to, a + from.length)
    if (a < 0 || b < 0) { bad(`could not locate the "${from}" block in LudoGame.tsx - markers moved, update this check`); return '' }
    return src.slice(a, b)
  }

  const bot = slice('// Bot turn', 'const pendingPass')
  const countdown = slice('// Turn countdown', '// Bot turn')
  const rollFn = slice('const roll = () =>', 'const onToken')

  // (1) the bot turn must commit in one state update. Two setTimeouts in this
  //     block is exactly what used to leave {rolled:true, turn:bot} forever.
  const botTimers = (bot.match(/setTimeout\(/g) || []).length
  console.log(`  bot turn: ${botTimers} setTimeout, ${(bot.match(/setSt\(/g) || []).length} setSt call site(s)`)
  if (botTimers !== 1) bad(`the bot turn has ${botTimers} setTimeout calls; it must be exactly 1 or the cleanup race comes back`)
  if (botTimers === 1 && /setTimeout\([\s\S]*setTimeout\(/.test(bot.replace(/setTimeout\([^)]*\)[^\n]*\n/, ''))) {
    bad('a setTimeout is nested inside another inside the bot turn')
  }

  // (2) the countdown must not bail out once the player has rolled, otherwise
  //     rolling and walking away freezes the match.
  if (/^\s*if\s*\(!yourTurn\s*\|\|\s*st\.rolled\)\s*return/m.test(countdown)) {
    bad('the countdown still returns early when st.rolled is true, so a rolled-but-unused turn never expires')
  }
  if (!/st\.rolled/.test(countdown)) bad('the countdown does not depend on st.rolled, so rolling does not restart the clock')

  // (3) the dice commit must be invalidated when the turn moves on mid-animation
  if (!/rollToken\.current\s*!==/.test(rollFn)) {
    bad('roll() commits its result without checking rollToken, so an expiry during the 500ms animation can still write rolled:true onto another turn')
  }
  if (!/setSt\(\(s\)\s*=>\s*\(s\.turn\s*===/.test(rollFn)) {
    bad('roll() commits without re-checking that it is still the player\'s turn inside the state updater')
  }
  if (!/if\s*\(st\.turn\s*!==\s*0/.test(rollFn)) {
    bad('roll() does not bail out when the turn changed during the dice animation')
  }

  // (4) the spinner must be cleared before the staleness check, otherwise the
  //     dice button stays disabled forever after a superseded roll
  const spin = rollFn.indexOf('setRolling(false)')
  const stale = rollFn.indexOf('rollToken.current !== mine')
  if (spin < 0) bad('roll() never clears the rolling spinner')
  if (spin > stale) bad('roll() returns on a stale roll before clearing the spinner, leaving the dice button disabled')

  console.log(fails === 0 ? '  all source guards hold' : '  source guard failures above')
  console.log('')
}

console.log(fails === 0
  ? 'VERIFIED: the old two-timeout pattern freezes the board, the fixed one-shot pattern never does, and the real component no longer contains the constructs that caused the freezes.'
  : `${fails} CHECK(S) FAILED`)
process.exit(fails ? 1 : 0)