import { describe, it, expect } from 'vitest'
import { pileLayout, PILE_OFFSETS, CENTER } from '../src/engine/ludoBoard'
// A pile of tokens on one square used to be laid out by shrinking every token to
// 1/(1+(n-1)*0.22) and sliding them along one axis. At n=4 that is four pins at
// 60% size in a row, overlapping each other and spilling into the neighbouring
// cells, so the pile read as one smudge. These tests pin the replacement: a
// two-dimensional fan, at a size a player can still recognise and tap.

/** the offsets a pile of n uses, in board coordinates */
function offsets(n: number, spread = 1) {
  return Array.from({ length: n }, (_, i) => pileLayout(n, i, spread))
}

describe('pileLayout', () => {
  it('centres a lone token at full size', () => {
    const { dr, dc, scale } = pileLayout(1, 0)
    expect(dr).toBe(0)
    expect(dc).toBe(0)
    expect(scale).toBe(1)
  })

  it('never lets a pile shrink a token below a readable size', () => {
    // The old formula reached 0.60 at four. A pile that small cannot be told
    // apart from its neighbours, which is the whole point of a fan.
    for (const n of [1, 2, 3, 4, 5, 8]) {
      for (let i = 0; i < n; i++) {
        expect(pileLayout(n, i).scale).toBeGreaterThanOrEqual(0.66)
      }
    }
  })

  it('gives every token in a pile its own position', () => {
    for (const n of [2, 3, 4]) {
      const seen = new Set(offsets(n).map((o) => `${o.dr},${o.dc}`))
      expect(seen.size).toBe(n)
    }
  })

  it('fans in both axes, not just one', () => {
    // The old layout varied `left` only, so every token in a pile sat on the same
    // row. A pile that only spreads sideways is a row, and a row of four at 60%
    // size is exactly the smudge this replaced.
    for (const n of [3, 4]) {
      const rows = new Set(offsets(n).map((o) => o.dr))
      const cols = new Set(offsets(n).map((o) => o.dc))
      expect(rows.size).toBeGreaterThan(1)
      expect(cols.size).toBeGreaterThan(1)
    }
  })

  it('keeps a whole pile inside the square it sits on', () => {
    // Offsets are in grid cells from the square's centre, so half a cell is the
    // edge. A pile that reaches past that is sitting on its neighbour, which on a
    // track cell means it reads as being on the wrong square.
    for (const n of [2, 3, 4]) {
      for (const o of offsets(n)) {
        expect(Math.abs(o.dr)).toBeLessThanOrEqual(0.5)
        expect(Math.abs(o.dc)).toBeLessThanOrEqual(0.5)
      }
    }
    // and tight enough that the cluster, plus the ~0.9-cell piece drawn on each
    // centre, still covers about one square rather than two
    for (const n of [2, 3, 4]) {
      const spreadCells = Math.max(...offsets(n).map((o) => Math.max(Math.abs(o.dr), Math.abs(o.dc))))
      expect(spreadCells * 2 + 0.89).toBeLessThanOrEqual(1.6)
    }
  })

  it('clamps a pile to four, since a player only has four tokens', () => {
    const four = offsets(4).map((o) => `${o.dr},${o.dc}`)
    const eight = offsets(8).map((o) => `${o.dr},${o.dc}`)
    expect(new Set(eight)).toEqual(new Set(four))
  })

  it('clamps an out-of-range index instead of returning undefined', () => {
    expect(pileLayout(4, 9)).toEqual(pileLayout(4, 3))
    expect(pileLayout(4, -2)).toEqual(pileLayout(4, 0))
  })

  it('spreads the centre square wider, so finished tokens read as four counters', () => {
    // Every finished token of every player lands on CENTER. Packed tight they are
    // one clump in the middle of the four-colour centre, so the centre is fanned
    // further than a track cell.
    const tight = Math.max(...offsets(4).map((o) => Math.abs(o.dr)))
    const wide = Math.max(...offsets(4, 2.4).map((o) => Math.abs(o.dr)))
    expect(wide).toBeGreaterThan(tight)
    for (const o of offsets(4, 2.4)) {
      expect(CENTER[0] + o.dr).toBeGreaterThanOrEqual(0)
      expect(CENTER[0] + o.dr).toBeLessThanOrEqual(14)
      expect(CENTER[1] + o.dc).toBeGreaterThanOrEqual(0)
      expect(CENTER[1] + o.dc).toBeLessThanOrEqual(14)
    }
  })

  // The comment above PILE_OFFSETS claimed the cluster "stays inside one cell's
  // worth of room". It did not, and nobody noticed, because the only test of it
  // checked the token *centre* rather than the token's edge. A token is ~0.89 of
  // a cell across, so a centre offset of 0.2 already puts the outer edge at 0.55 -
  // half a cell is all the room there is - and a finished piece on the centre was
  // pushed 0.92 out, a full cell clear of its own square.
  //
  // That is the "the pawn is standing between two boxes and you cannot tell which
  // square it is in" complaint, including the finish row where a token that came
  // home appeared on the seam with its neighbour.
  const TOKEN_CELLS = 0.89 // a track token, as a fraction of one cell

  it('keeps the whole token - not just its centre - inside its own square', () => {
    for (const spread of [1, 2.4, 4.6]) {
      for (const n of [2, 3, 4]) {
        for (const o of offsets(n, spread)) {
          const reach = Math.max(Math.abs(o.dr), Math.abs(o.dc)) + TOKEN_CELLS / 2
          expect(reach, `n=${n} spread=${spread} dr=${o.dr} dc=${o.dc}`).toBeLessThanOrEqual(0.5)
        }
      }
    }
  })

  it('cannot be flung off its square by a large spread', () => {
    // pileLayout clamps rather than trusting the caller: whatever spread is asked
    // for, the result is the same bounded fan.
    expect(offsets(4, 99)).toEqual(offsets(4, 4.6))
    expect(offsets(4, 4.6)).toEqual(offsets(4, 2.4))
  })

  it('exposes an offset set for every pile size it can be asked for', () => {
    for (const n of [1, 2, 3, 4]) expect(PILE_OFFSETS[n]).toHaveLength(n)
  })
})
