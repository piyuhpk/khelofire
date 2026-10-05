import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Outcome } from '../src/lib/store'

// The component reaches for supabase-backed realtime chat/voice and the wallet
// store. Stub the edges so we are testing the turn machinery, not the network.
const settle = vi.fn<(r: { game: string; modeId: string; outcome: Outcome }) => void>()
// How many times settle() has run. Sampled from the play loop, not from inside the
// mock: the question is whether the modal has caught up by the time control returns
// to the loop, not what the DOM happened to look like mid-callback.
let settleCount = 0
vi.mock('../src/lib/store', () => ({
  useStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      settle: (...a: Parameters<typeof settle>) => { settleCount++; settle(...a) },
      username: 'Tester', avatar: 'ðŸ˜€',
    }),
}))
vi.mock('../src/i18n', () => ({
  useT: () => (k: string) => k,
  useI18n: () => ({ lang: 'en' }),
}))
vi.mock('../src/features/game/MatchChat', () => ({ MatchChat: () => null }))
vi.mock('../src/features/game/GameShell', () => ({
  GameHeader: () => null,
  VoiceButton: () => null,
  ExitModal: () => null,
  ResultModal: ({ outcome }: { outcome: Outcome | null }) =>
    outcome ? <div data-testid="result">{`RESULT:${outcome}`}</div> : null,
}))

import LudoGame from '../src/features/ludo/LudoGame'

const DONE = () => screen.queryByTestId('result') !== null

function mount(modeId: string) {
  return render(
    <MemoryRouter initialEntries={[`/play/ludo/${modeId}`]}>
      <Routes>
        <Route path="/play/ludo/:modeId" element={<LudoGame />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
  })
}

/** the player's own tokens are the only ones that can be clicked */
function legalTokens(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-label^="token 0-"]:not([disabled])'))
}

/** roll, then take the first legal token. returns false if it was not our turn */
async function playTurn(): Promise<boolean> {
  const dice = screen.getByLabelText('roll dice') as HTMLButtonElement
  if (dice.disabled) return false
  await act(async () => { dice.click(); await Promise.resolve() })
  await tick(600) // dice animation commits after 500ms
  const tokens = legalTokens()
  if (tokens.length) {
    await act(async () => { tokens[0].click(); await Promise.resolve() })
  }
  await tick(100)
  return true
}

/** let both sides play until the match resolves */
async function playToResult(modeId: string, budgetMs = 1_200_000) {
  // A bot turn needs ~2 loop iterations now: the turn effect spins the dice
  // for 900ms, lands the value, and only then moves the token 650ms later, so
  // the opponent's move can be followed. Ticking 1000ms per loop means the
  // move lands on the second tick. The old single-commit bot fitted in one.
  mount(modeId)
  let spent = 0
  while (!DONE() && spent < budgetMs) {
    await tick(1000)
    spent += 1000
    await playTurn()
  }
  return spent
}

/**
 * Same game, but on 50ms ticks, recording for every settle whether the modal was
 * already up by the time that tick finished.
 *
 * The step size is the whole point. The result modal is held back ~900ms, so a
 * 1000ms tick cannot tell "the payout did not wait for the animation" from "both
 * fired inside one tick, 900ms late" - it only sees that a modal exists by the
 * end. 50ms resolves the window.
 */
async function playToResultWatchingSettle(modeId: string, maxIterations = 4000) {
  mount(modeId)
  const modalUpWhenSettled: boolean[] = []
  let seen = 0
  for (let i = 0; i < maxIterations && !DONE(); i++) {
    await tick(50)
    if (settleCount > seen) {
      // settle fired during this tick; the modal has not been given its 900ms yet
      modalUpWhenSettled.push(DONE())
      seen = settleCount
    }
    if (DONE()) break
    await playTurn()
  }
  return modalUpWhenSettled
}

beforeEach(() => {
  settle.mockClear()
  settleCount = 0
  // reset first, then re-arm: setSystemTime is only legal while the clock is
  // mocked. a test that dies mid-loop leaves pending timers and a skewed clock
  // behind, which then breaks the next test's very first assertion.
  vi.useRealTimers()
  vi.useFakeTimers()
  vi.clearAllTimers()
  vi.setSystemTime(0)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Ludo turn machinery', () => {
  // The core regression. The bot's move used to be cancelled by the effect's own
  // cleanup, so the board stopped dead right after the player's first move and no
  // result could ever appear. Playing a whole match to completion exercises the
  // entire loop - human roll, human move, bot roll, bot move, extra turns on a
  // six, captures, and finishes - and proves it never stalls.
  it('plays a full match to a result without stalling', async () => {
    const spent = await playToResult('ludo_practice')

    expect(DONE()).toBe(true)
    // A bot turn is 900ms of spin plus a 650ms beat before the token moves, so
    // each one eats ~2 of this loop's 1000ms ticks; the old silent commit fitted
    // in one. Same game, roughly twice the fake clock.
    expect(spent).toBeLessThan(350_000)
    expect(settle).toHaveBeenCalledTimes(1)
    const arg = settle.mock.calls[0][0] as unknown as { game: string; modeId: string; outcome: Outcome }
    expect(arg.game).toBe('ludo')
    expect(arg.modeId).toBe('ludo_practice')
    expect(['win', 'loss']).toContain(arg.outcome)
  })

  it('settles a four player match exactly once too', async () => {
    await playToResult('ludo_4p_practice')
    expect(DONE()).toBe(true)
    expect(settle).toHaveBeenCalledTimes(1)
  })

  it('pays out before it shows the result modal', async () => {
    const modalUpWhenSettled = await playToResultWatchingSettle('ludo_practice')
    expect(DONE()).toBe(true)
    expect(settle).toHaveBeenCalledTimes(1)
    // Settling must not be what waits on the animation. The modal is held back so
    // the player sees the end of the board; the settle used to be held back by that
    // same timeout, so the money only moved if the app was still alive a second and
    // a half after the win - and closing the app after winning is the ordinary
    // thing to do. On a real match the server was not told to settle until then
    // either, so the entry stays debited with nothing to show for it and the win
    // reads as a loss.
    //
    // true here means the modal was already up in the same tick the payout fired,
    // i.e. both had been waiting on the one timeout.
    expect(modalUpWhenSettled).toEqual([false])
  })


  // The clock used to cover only the pre-roll phase, so rolling and then walking
  // away left the turn waiting on a token pick that nothing would ever force.
  it('hands the turn on when the player rolls and never picks a token', async () => {
    mount('ludo_practice')

    // Off the yard only a six moves anything, so this test cannot run at all
    // without one. It used to hope for one: 15 rolls of a fair die is only ~93%,
    // and far fewer than 15 of those iterations are actually the player's turn,
    // because the bot needs time to move in between. Measured at 2-3 failures in
    // 4 runs, which is a coin flip rather than a test - and it fails on the code
    // it is meant to protect just as readily as on a real regression. Force the
    // six rather than gambling on it.
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.999)
    try {
      let picks = 0
      for (let i = 0; i < 15 && picks === 0; i++) {
        await tick(1000)
        const dice = screen.getByLabelText('roll dice') as HTMLButtonElement
        if (dice.disabled) continue
        await act(async () => { dice.click(); await Promise.resolve() })
        await tick(600)
        picks = legalTokens().length
      }
      expect(picks).toBeGreaterThan(0)

      // Only the player's roll needed forcing. Leaving the die rigged for the
      // rest of the test meant the bot also rolled sixes forever, never hit the
      // three-sixes limit in time to hand the turn back, and the final assertion
      // failed on the dice still being disabled - a failure caused by the fix
      // rather than by the bug.
      random.mockRestore()

      // Deliberately never click a token, then wait for the hand-back rather than
      // guessing how long it takes. Once the die is fair again the bot's turn
      // length depends on a real roll, so any fixed tick is a race that fails
      // whenever the bot happens to still be mid-turn when the clock stops - a
      // failure that says nothing about the countdown actually working.
      let handedBack = false
      for (let i = 0; i < 40 && !handedBack; i++) {
        await tick(1000)
        handedBack = (screen.getByLabelText('roll dice') as HTMLButtonElement).disabled === false
      }
      expect(handedBack).toBe(true)
    } finally {
      random.mockRestore()
    }
  })

  // The countdown can fire inside the 500ms dice animation. Committing blindly
  // then wrote rolled:true onto the opponent's turn, which both the bot effect
  // and the countdown effect skip, so the board froze for good.
  it('survives the countdown expiring during the dice animation', async () => {
    mount('ludo_practice')
    // the turn clock is 20s; stop just short of it
    await tick(19_600)

    const dice = screen.getByLabelText('roll dice') as HTMLButtonElement
    await act(async () => { dice.click(); await Promise.resolve() })

    // the expiry (20_000) lands before the roll commit (20_100)
    await tick(1_000)

    // the stale roll must not have wedged the board: play on to a result
const spent = await continueToResult(20_000)
expect(DONE()).toBe(true)
expect(spent).toBeLessThan(600_000)
  })

  // Every token's position is built as a CSS length at the render site, and that
  // is where it went wrong once: a stray second '%' produced "3.33%%", which is
  // not a length, so jsdom dropped the declaration and left every token at its
  // default position - the whole pile collapsed into one corner of the board. The
  // geometry helper was provably correct and the board was still broken, so this
  // asserts on the rendered element rather than on the helper.
  //
  // A pile and four separate tokens go through the same line, so checking that
  // every token lands somewhere real and distinct covers both; pileLayout's own
  // fan is covered in tests/ludo-pile.test.ts.
  it('gives every token a real, distinct position on the board', async () => {
    mount('ludo_practice')

    const tokens = screen.getAllByRole('button', { name: /^token \d-/ })
    expect(tokens.length).toBeGreaterThanOrEqual(4)

    const cells = new Set<string>()
    for (const t of tokens) {
      const label = t.getAttribute('aria-label')
      const s = (t as HTMLElement).style
      // A length jsdom could not parse is discarded, leaving these empty.
      expect(s.left, `${label} has no left`).not.toBe('')
      expect(s.top, `${label} has no top`).not.toBe('')
      expect(s.left, `${label} left is not a length`).not.toMatch(/%%|undefined|NaN/)
      expect(s.top, `${label} top is not a length`).not.toMatch(/%%|undefined|NaN/)
      cells.add(`${s.left}|${s.top}`)
    }
    // four waiting reds sit in four separate yard slots, so nothing may share a
    // position - a collapsed pile shows up here as a size of one
    expect(cells.size).toBe(tokens.length)
  })

  // "The opponent moved and I never saw it - by the time I looked it was my turn
  // again." The status line under the board already named the player on turn, but
  // it is small, sits below the fold on a short phone, and the eye during a turn is
  // on the board. A bot's move went past as a flicker.
  //
  // The board now rings the active player's own squares. That has to follow the
  // turn exactly: the wrong seat marked is worse than none, because it would say
  // the turn is yours when it is not.
  it('marks the active player on the board itself', async () => {
    mount('ludo_practice')

    // seat 0 opens, so only seat 0 is ringed
    expect(screen.queryAllByTestId('turn-ring-0').length).toBe(4)
    expect(screen.queryAllByTestId('turn-ring-2').length).toBe(0)

    await tick(1000)
    await playTurn() // roll and move, handing the turn on

    // after the move it must have followed the turn, not stayed behind
    const zero = screen.queryAllByTestId('turn-ring-0').length
    const two = screen.queryAllByTestId('turn-ring-2').length
    expect(zero + two).toBeGreaterThan(0)
    // exactly one seat is ringed at a time
    const ringed = [0, 1, 2, 3].filter((p) => screen.queryAllByTestId(`turn-ring-${p}`).length > 0)
    expect(ringed).toHaveLength(1)
  })

  it('stops marking anyone once the match is won', async () => {
    await playToResult('ludo_practice')
    expect(DONE()).toBe(true)
    // a ring left burning over a finished board points at a game that is over
    for (const p of [0, 1, 2, 3]) {
      expect(screen.queryAllByTestId(`turn-ring-${p}`).length, `seat ${p} still ringed`).toBe(0)
    }
  })
})

async function continueToResult(spent: number) {
  while (!DONE() && spent < 600_000) {
    await tick(1000)
    spent += 1000
    await playTurn()
  }
  return spent
}