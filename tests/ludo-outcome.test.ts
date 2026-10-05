import { describe, it, expect } from 'vitest'
import { wonBySeat, initLudo, applyMove, FINISH, type PlayerId } from '../src/engine/ludo'

// "I won and the app still gave me a loss."
//
// The screen for that used to be one comparison written as `winner === 0`. In a
// local game yourSeat is 0, so it was right on the machine it was written on and
// wrong on every paid match, where join_live_match puts the joiner at engine seat
// 2 (1v1) or 1/2/3 (4p). The wallet was credited by the server from winner_seat
// while the modal said loss, so the two halves of the same result disagreed.
//
// The rule now lives in the engine and is checked for every seat pair, which is
// the only way to catch a comparison that is correct for exactly one seat.

const SEATS: PlayerId[] = [0, 1, 2, 3]

describe('wonBySeat', () => {
  it('is true only for the seat that actually won', () => {
    for (const winner of SEATS) {
      for (const yourSeat of SEATS) {
        expect(
          wonBySeat(winner, yourSeat),
          `winner seat ${winner}, playing seat ${yourSeat}`,
        ).toBe(winner === yourSeat)
      }
    }
  })

  it('is false while nobody has won, so an unfinished match is not a loss', () => {
    for (const yourSeat of SEATS) expect(wonBySeat(null, yourSeat)).toBe(false)
  })

  it('does not treat seat 0 as the human', () => {
    // The exact regression: a seat-2 player finishing first is a win, and the old
    // `winner === 0` reported it as a loss.
    expect(wonBySeat(2, 2)).toBe(true)
    expect(wonBySeat(0, 2)).toBe(false)
    expect(wonBySeat(1, 1)).toBe(true)
    expect(wonBySeat(3, 3)).toBe(true)
  })

  it('matches what the engine records when a seat brings all four home', () => {
    // Drive a real board: seat 2 walks all four of its tokens to the home column
    // and the engine must name seat 2, which wonBySeat then has to agree with.
    let s = initLudo(2)
    for (let token = 0; token < 4; token++) {
      let guard = 0
      while (s.tokens[2][token] < FINISH && guard++ < 500) {
        const r = applyMove(s, 2, token, 6)
        s = r.state
        // any outcome other than this seat finishing ends the match, which would
        // make the test assert about the wrong thing
        if (s.winner !== null && s.winner !== 2) break
      }
    }
    expect(s.winner).toBe(2)
    expect(wonBySeat(s.winner, 2)).toBe(true)
    expect(wonBySeat(s.winner, 0)).toBe(false)
  })
})
