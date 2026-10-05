import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The "You" panel at the bottom of the Ludo board used to read seat 0 rather
// than the seat this device actually owns: `COLORS[0]` for the avatar and
// `homeCount(0)` for the four progress dots.
//
// In a local game yourSeat IS 0, so nothing looks wrong - which is why it
// shipped. But join_live_match seats a 1v1 opponent at engine seat 2, and a 4p
// table at 1/2/3. A joiner on seat 2 was shown a RED avatar and RED's progress
// dots under their own name, next to a board where their tokens were yellow.
//
// The opponents above it were already fixed to filter on yourSeat (see the
// `opponents` array and the comment above it); this file exists so the "You"
// side cannot drift back the same way. It reads the source because the component
// only ever mounts at seat 0 in tests - a seat-2 joiner needs a live match and a
// second device, neither of which a unit test has.

const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8')

const src = read('../src/features/ludo/LudoGame.tsx')

/** the JSX block for the "You" half of the bottom bar */
function youPanel(): string {
  const start = src.indexOf('{/* You */}')
  expect(start, 'the {/* You */} marker moved').toBeGreaterThan(-1)
  const end = src.indexOf('{/* dice', start)
  expect(end, 'the {/* dice ... */} marker moved').toBeGreaterThan(start)
  return src.slice(start, end)
}

describe('LudoGame bottom bar', () => {
  it('draws your own colour on your own avatar', () => {
    expect(youPanel()).toContain('COLORS[yourSeat]')
    expect(youPanel()).not.toMatch(/COLORS\[0\]/)
  })

  it('counts your own home tokens, not seat 0s', () => {
    expect(youPanel()).toContain('homeCount(yourSeat)')
    expect(youPanel()).not.toMatch(/homeCount\(0\)/)
  })

  it('still counts the opponent on the seat it actually holds', () => {
    // the other half of the same bar
    expect(src).toContain('homeCount(oppP)')
    expect(src).toContain('COLORS[oppP]')
  })
})
