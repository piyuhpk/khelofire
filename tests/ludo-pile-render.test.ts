import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// pileLayout clamps its fan so a token cannot leave its own square, and that
// clamp is tested in ludo-pile.test.ts. But the clamp only bites if the *renderer*
// passes a spread through the function at all.
//
// LudoBoard passes 2.4 for the finished-centre square. That is not a cosmetic
// number: it is the one value that decides how far the four finished pieces of
// every player sit from the centre they are parked in, and it was 4.6 for a long
// time - which put each piece most of a cell off its square. Nothing failed at the
// time, because the engine test only asked pileLayout about spreads the test chose
// itself; the renderer was free to pass any number at all and no test looked.
//
// So this checks the wiring, the way ludo-seat-panel.test.ts does: the renderer
// must go through pileLayout, and the spread it asks for must be one the engine
// considers meaningful rather than something clamped into the same result as the
// default - which would make the centre pile identical to a track pile.

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('LudoBoard pile rendering', () => {
  const src = read('src/features/ludo/LudoBoard.tsx')

  it('positions tokens through pileLayout rather than its own arithmetic', () => {
    expect(src).toMatch(/pileLayout\(/)
    // A hand-rolled offset here would not be bounded by MAX_PILE_OFFSET.
    expect(src).not.toMatch(/const\s+dr\s*=/)
    expect(src).not.toMatch(/const\s+dc\s*=/)
  })

  it('fans the finished-centre square wider than a track square, by a real amount', () => {
    const m = /pileLayout\(n,\s*si,\s*onCentre\s*\?\s*([\d.]+)\s*:\s*([\d.]+)\)/.exec(src)
    expect(m, `could not find the pileLayout call in LudoBoard.tsx:\n${src.slice(0, 200)}`).toBeTruthy()
    const centre = Number(m![1])
    const track = Number(m![2])
    expect(track).toBe(1)
    expect(centre).toBeGreaterThan(track)
    // Not clamped into uselessness: 4.6 was past the limit and silently became
    // the same fan as every other square, which is the bug in another form.
    expect(centre).toBeLessThanOrEqual(2.4)
  })
})
