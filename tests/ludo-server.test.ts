// Tests for the server-side turn rules in src/engine/ludoServer.ts.
//
// This is the machine that decides whether a player wins real money, so the tests
// are not about coverage - they are about the specific ways it could be lied to,
// and about it never getting stuck.
//
// Every dice value is injected, so a match plays out identically every run.

import { describe, expect, it } from 'vitest'
import {
  TURN_SECONDS,
  decideMove,
  decidePass,
  decideRoll,
  isStalled,
  isUsableState,
  nextDeadline,
  type TurnContext,
} from '../src/engine/ludoServer'
import { initLudo, legalTokens, type LudoState } from '../src/engine/ludo'

const NOW = 1_700_000_000_000
const ctx = (over: Partial<TurnContext> = {}): TurnContext => {
  const state = over.state ?? initLudo(2)
  return {
    state,
    seat: state.turn,
    now: NOW,
    deadline: NOW + TURN_SECONDS * 1000,
    ...over,
  }
}

const ok = (d: ReturnType<typeof decideRoll>) => {
  if (!d.ok) throw new Error(`expected a legal decision, got ${d.code}: ${d.error}`)
  return d
}

describe('server turn rules', () => {
  it('rolls a server-chosen dice and never a client one', () => {
    // a 6, because with every token in the yard nothing else is movable
    const d = ok(decideRoll(ctx(), 6))
    expect(d.state.dice).toBe(6)
    expect(d.state.rolled).toBe(true)
    expect(d.turnKept).toBe(true)
  })

  it('refuses a move before the dice are rolled', () => {
    const d = decideMove(ctx(), 0)
    expect(d.ok).toBe(false)
    expect(d.ok === false && d.code).toBe('roll_first')
  })

  it('refuses a token that cannot legally move on the stored dice', () => {
    // already rolled, but every token is parked on the centre so none can move
    let state = initLudo(2)
    state.tokens[0] = [58, 58, 58, 58]
    state.dice = 6
    state.rolled = true
    const d = decideMove(ctx({ state }), 0)
    expect(d.ok).toBe(false)
    expect(d.ok === false && d.code).toBe('illegal_move')
  })

  it('refuses a negative or non-integer token index instead of trusting it', () => {
    const rolled = ok(decideRoll(ctx(), 6)).state
    for (const bad of [-1, 1.5, Number.NaN, 99]) {
      const d = decideMove(ctx({ state: rolled }), bad)
      expect(d.ok, `token ${bad} should be rejected`).toBe(false)
      expect(d.ok === false && d.code).toBe('illegal_move')
    }
  })

  it('leaves the yard on a six but keeps the same player rolling', () => {
    const rolled = ok(decideRoll(ctx(), 6)).state
    const d = ok(decideMove(ctx({ state: rolled }), 0))
    expect(d.state.tokens[0][0]).toBe(1)
    expect(d.state.turn).toBe(0) // a six is an extra turn, not a handover
    expect(d.state.sixes).toBe(1)
  })

  it('hands the turn to the opponent on an ordinary move', () => {
    // token already out on the ring, and a dice that captures nothing
    let state = initLudo(2)
    state.tokens[0] = [10, 58, 58, 58]
    state.dice = 3
    state.rolled = true
    const d = ok(decideMove(ctx({ state }), 0))
    expect(d.state.tokens[0][0]).toBe(13)
    expect(d.state.turn).toBe(2) // 1v1 plays [0, 2]
    expect(d.state.dice).toBeNull()
  })

  it('forfeits the turn on a third six', () => {
    let state: LudoState = { ...initLudo(2), sixes: 2 }
    const d = ok(decideRoll(ctx({ state }), 6))
    expect(d.state.turn).toBe(2)
    expect(d.state.dice).toBeNull()
    expect(d.state.sixes).toBe(0)
  })

  it('passes the turn when the dice leave nothing movable', () => {
    // all four tokens already home, so no dice can move anything
    let state = initLudo(2)
    state.tokens[0] = [58, 58, 58, 58]
    const d = ok(decideRoll(ctx({ state }), 5))
    expect(d.state.turn).toBe(2)
    expect(d.state.rolled).toBe(false)
  })

  it('ends the match when the last token reaches home', () => {
    let state = initLudo(2)
    state.tokens[0] = [58, 58, 58, 57]
    state.dice = 1
    state.rolled = true
    const d = ok(decideMove(ctx({ state }), 3)) // 57 + 1 = 58, finished
    expect(d.winner).toBe(0)
    expect(d.state.winner).toBe(0)
  })

  it('reports the winner as the seat that actually finished, not the caller', () => {
    // seat 0 is already home, so seat 2 must be the one credited
    let state = initLudo(2)
    state.turn = 2
    state.tokens[0] = [58, 58, 58, 58]
    state.tokens[2] = [58, 58, 58, 57]
    state.dice = 1
    state.rolled = true
    const d = ok(decideMove(ctx({ state, seat: 2 }), 3))
    expect(d.winner).toBe(2)
  })
})

describe('turn ownership', () => {
  it('refuses a roll from a player whose turn it is not', () => {
    // seat 0 holds the turn; seat 2 tries to roll anyway
    const d = decideRoll(ctx({ seat: 2 }))
    expect(d.ok).toBe(false)
    expect(d.ok === false && d.code).toBe('not_your_turn')
  })

  it('refuses a move from a player whose turn it is not', () => {
    let state = initLudo(2)
    state.tokens[0] = [10, 58, 58, 58]
    state.dice = 3
    state.rolled = true
    const d = decideMove(ctx({ state, seat: 2 }), 0)
    expect(d.ok).toBe(false)
    expect(d.ok === false && d.code).toBe('not_your_turn')
  })

  it('refuses a move after the turn has already been handed on', () => {
    // the classic race: both phones tap "move" for the same turn
    const rolled = ok(decideRoll(ctx(), 6)).state // a six, so the turn stays with seat 0
    const d = decideMove(ctx({ state: rolled, seat: 2 }), 0)
    expect(d.ok).toBe(false)
    expect(d.ok === false && d.code).toBe('not_your_turn')
  })

  it('still lets the right player move while a bystander is refused', () => {
    const rolled = ok(decideRoll(ctx(), 6)).state
    expect(decideMove(ctx({ state: rolled, seat: 2 }), 0).ok).toBe(false)
    expect(decideMove(ctx({ state: rolled, seat: 0 }), 0).ok).toBe(true)
  })
})

describe('the turn clock', () => {
  it('refuses a roll once the deadline has passed', () => {
    const d = decideRoll(ctx({ now: NOW, deadline: NOW - 1 }), 6)
    expect(d.ok).toBe(false)
    expect(d.ok === false && d.code).toBe('expired')
  })

  it('refuses a move once the deadline has passed, even for the right player', () => {
    const rolled = ok(decideRoll(ctx(), 6)).state
    const d = decideMove(ctx({ state: rolled, now: NOW, deadline: NOW - 1 }), 0)
    expect(d.ok).toBe(false)
    expect(d.ok === false && d.code).toBe('expired')
  })

  it('lets ANYONE advance a turn that has timed out, so the board cannot deadlock', () => {
    // the loser pokes at a board the winner walked away from
    const d = decidePass(ctx({ seat: 2, now: NOW, deadline: NOW - 1 }))
    expect(d.ok).toBe(true)
    expect(d.state.turn).toBe(2)
    expect(d.state.dice).toBeNull()
  })

  it('will not let a bystander pass a turn that is still running', () => {
    const d = decidePass(ctx({ seat: 2 }))
    expect(d.ok).toBe(false)
    expect(d.ok === false && d.code).toBe('not_your_turn')
  })

  it('flags a stalled board only once the clock is out and nobody has rolled', () => {
    const running = ctx()
    expect(isStalled(running)).toBe(false)
    expect(isStalled(ctx({ now: NOW, deadline: NOW - 1 }))).toBe(true)
    const rolled = ok(decideRoll(ctx(), 6)).state
    expect(isStalled(ctx({ state: rolled, now: NOW, deadline: NOW - 1 }))).toBe(false)
  })

  it('hands the next turn a full fresh budget', () => {
    expect(nextDeadline(NOW) - NOW).toBe(TURN_SECONDS * 1000)
  })
})

describe('storing a board safely', () => {
  it('rejects a board the engine could not read', () => {
    expect(isUsableState(null)).toBe(false)
    expect(isUsableState({})).toBe(false)
    expect(isUsableState({ ...initLudo(2), tokens: [[0, 0, 0]] })).toBe(false)
    expect(isUsableState({ ...initLudo(2), tokens: [[0, 0, 0, 'x'], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] })).toBe(false)
    expect(isUsableState({ ...initLudo(2), players: [0, 7] })).toBe(false)
    expect(isUsableState({ ...initLudo(2), turn: 'zero' })).toBe(false)
  })

  it('accepts the board start_live_match seeds', () => {
    const seeded = {
      tokens: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
      players: [0, 2],
      turn: 0,
      dice: null,
      rolled: false,
      sixes: 0,
      winner: null,
    }
    expect(isUsableState(seeded)).toBe(true)
  })
})

describe('a whole match on the server', () => {
  it('always reaches a winner, and never hands the turn to nobody', () => {
    for (const seatCount of [2, 4] as const) {
      for (let run = 0; run < 200; run++) {
        let state = initLudo(seatCount)
        let deadline = nextDeadline(NOW)
        let now = NOW
        let guard = 0

        while (state.winner === null) {
          if (++guard > 5000) throw new Error('server turn loop failed to terminate')
          // everyone plays sensibly, so this exercises real games not random walks
          const c: TurnContext = { state, seat: state.turn, now, deadline }
          const rolled = decideRoll(c)
          if (!rolled.ok) {
            // an expired turn is recoverable by anyone; anything else is a bug
            expect(rolled.code).toBe('expired')
            const passed = decidePass(c)
            expect(passed.ok).toBe(true)
            state = passed.state
            deadline = nextDeadline(now)
            continue
          }
          state = rolled.state
          if (!rolled.turnKept) {
            deadline = nextDeadline(now)
            continue
          }

          now += 1000
          const seat = state.turn
          const legal = legalTokens(state, seat, state.dice!)
          expect(legal.length).toBeGreaterThan(0)
          const pick = legal[Math.floor(Math.random() * legal.length)]
          const moved = decideMove({ state, seat, now, deadline }, pick)
          expect(moved.ok).toBe(true)
          state = moved.state
          deadline = nextDeadline(now)
        }

        // the turn always belongs to a real seated player
        expect(state.players).toContain(state.winner)
        expect(state.tokens[state.winner!].every((t) => t >= 58)).toBe(true)
      }
    }
  })
})