// 15x15 grid coordinate maps for rendering the classic 4-colour Ludo board.
import type { PlayerId } from './ludo'

export type Cell = [number, number] // [row, col] 0..14

// Main 52-cell ring, abs index 0..51 (0 = Red start), clockwise.
export const PATH: Cell[] = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7],
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14],
  [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7],
  [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0],
  [6, 0],
]

// home column cells (pos 52..57) per player, running into the centre square.
// Six cells each, so the arm is continuous: ring exit -> 6 cells -> CENTRE.
// Yellow and Blue are listed from their own exit toward the middle.
export const HOME_COL: Record<PlayerId, Cell[]> = {
  0: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],   // Red — row 7 from left
  1: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],   // Green — col 7 from top
  2: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]], // Yellow — row 7 from right
  3: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]], // Blue — col 7 from bottom
}
export const CENTER: Cell = [7, 7]

// four token slots inside each 6x6 corner yard.
//
// These are NOT the circle centres - the renderer anchors a token at value+0.5
// (LudoBoard's `top: calc(pct(r) + pct(0.5))`, the same half-cell offset it
// applies to PATH cells to reach a cell's centre). So the value stored here is
// the circle centre minus that offset.
//
// The circle centres themselves were measured off the supplied artwork:
// ludofinalboard2.png has the white plate inset one cell (quad+1 .. quad+5, 4
// cells wide) with a one-cell circle centred on quad+2 and quad+4. Scanning a
// row and a column straight through a yard puts the coloured circle at 1.5..2.45
// and 3.5..4.45 - centres 2.0 and 4.0 - in all four yards. Subtracting the
// renderer's half-cell anchor gives the quad+1.5 / quad+3.5 stored below.
//
// Storing the centres directly instead was tried and is wrong: it moves every
// waiting piece a quarter square down-and-right of its circle, which is the
// error this comment exists to prevent reintroducing.
export const BASE_SLOTS: Record<PlayerId, Cell[]> = {
  0: [[1.5, 1.5], [1.5, 3.5], [3.5, 1.5], [3.5, 3.5]],   // top-left
  1: [[1.5, 10.5], [1.5, 12.5], [3.5, 10.5], [3.5, 12.5]], // top-right
  2: [[10.5, 10.5], [10.5, 12.5], [12.5, 10.5], [12.5, 12.5]], // bottom-right
  3: [[10.5, 1.5], [10.5, 3.5], [12.5, 1.5], [12.5, 3.5]],   // bottom-left
}

// 6x6 corner areas [rowStart, colStart, rowEnd, colEnd]
export const QUAD_AREA: Record<PlayerId, [number, number, number, number]> = {
  0: [0, 0, 6, 6],    // Red top-left
  1: [0, 9, 6, 15],   // Green top-right
  2: [9, 9, 15, 15],  // Yellow bottom-right
  3: [9, 0, 15, 6],   // Blue bottom-left
}

// Given player + logical pos, return the grid cell to render the token in.
export function cellFor(p: PlayerId, pos: number, slot = 0): Cell {
  if (pos === 0) return BASE_SLOTS[p][slot]
  if (pos >= 1 && pos <= 51) {
    const abs = (({ 0: 0, 1: 13, 2: 26, 3: 39 } as Record<PlayerId, number>)[p] + (pos - 1)) % 52
    return PATH[abs]
  }
  if (pos >= 52 && pos <= 57) return HOME_COL[p][pos - 52]
  return CENTER
}
