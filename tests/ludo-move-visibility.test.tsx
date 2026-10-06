import { describe, it, expect } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { LudoBoard } from '../src/features/ludo/LudoBoard'
import { initLudo, applyMove, legalTokens, type LudoState } from '../src/engine/ludo'

// The opponent's move was never on screen. The live board is adopted from the
// server as one snapshot, so a pawn went from its old square to its new one
// between two frames - nothing to watch, only a result to be told about. What
// made that easy to miss is that it never failed: the board always ended up
// correct, which is also what made it feel like "the move doesn't show".

const rerender = (st: LudoState, legal: number[], onToken = () => {}) =>
  render(<LudoBoard state={st} legal={legal} onToken={onToken} />)

const box = (i = 0) =>
  document.querySelector(`button[aria-label="token 0-${i}"]`) as HTMLButtonElement

const at = (el: HTMLButtonElement) => ({ left: el.style.left, top: el.style.top })

const play = (st: LudoState, token: number, dice: number): LudoState =>
  applyMove(st, 0, token, dice).state

describe('a pawn travelling to its new square', () => {
  it('carries a transition, so the travel is visible rather than instant', () => {
    const st = initLudo(4)
    rerender(st, [])
    expect(box().style.transition, 'no transition on a token').toBeTruthy()
    expect(box().style.transition).toContain('left')
    expect(box().style.transition).toContain('top')
    cleanup()
  })

  it('actually changes position across a move, and the new one still travels', () => {
    const st = initLudo(4)
    const legal = legalTokens(st, 0, 6)
    rerender(st, legal)
    const before = at(box())
    cleanup()

    const moved = play(st, legal[0], 6)
    expect(moved.tokens[0][legal[0]], 'the move did not move anything').not.toBe(
      st.tokens[0][legal[0]],
    )

    rerender(moved, [])
    const after = at(box())
    expect(
      after.left !== before.left || after.top !== before.top,
      `token stayed at left:${before.left} top:${before.top}`,
    ).toBe(true)
    expect(box().style.transition, 'the moved pawn stopped animating').toContain('left')
    cleanup()
  })

  it('keeps the transition on the yard square, where a token is when it is not yours', () => {
    // A yard pawn is the one sitting still for most of the match, and the move out
    // of the yard is the jump with the farthest distance to cover - if any square
    // was exempt it would be this one.
    const st = initLudo(4)
    rerender(st, [])
    expect(box(1).style.transition).toContain('left')
    expect(box(1).style.top).toBeTruthy()
    cleanup()
  })
})

