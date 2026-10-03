import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Outcome } from '../src/lib/store'

// The component reaches for supabase-backed realtime chat/voice and the wallet
// store. Stub the edges so we are testing the turn machinery, not the network.
const settle = vi.fn<(r: { game: string; modeId: string; outcome: Outcome }) => void>()
vi.mock('../src/lib/store', () => ({
  useStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ settle: (...a: Parameters<typeof settle>) => settle(...a), username: 'Tester', avatar: '😀' }),
}))
vi.mock('../src/i18n', () => ({
  useT: () => (k: string) => k,
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
async function playToResult(modeId: string, budgetMs = 600_000) {
  mount(modeId)
  let spent = 0
  while (!DONE() && spent < budgetMs) {
    await tick(1000)
    spent += 1000
    await playTurn()
  }
  return spent
}

beforeEach(() => {
  settle.mockClear()
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
    expect(spent).toBeLessThan(200_000)
    expect(settle).toHaveBeenCalledTimes(1)
    const arg = settle.mock.calls[0][0] as unknown as { game: string; modeId: string; outcome: Outcome }
    expect(arg.game).toBe('ludo')
    expect(arg.modeId).toBe('ludo_practice')
    expect(['win', 'loss']).toContain(arg.outcome)
  })

  it('settles a four player match exactly once too', async () => {
    await playToResult('ludo_4p')
    expect(DONE()).toBe(true)
    expect(settle).toHaveBeenCalledTimes(1)
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
})

async function continueToResult(spent: number) {
  while (!DONE() && spent < 600_000) {
    await tick(1000)
    spent += 1000
    await playTurn()
  }
  return spent
}