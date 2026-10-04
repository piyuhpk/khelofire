// The Dice seed in SQL and the Dice state in the engine have to be the same shape.
//
// This is the seam where a paid game quietly stops working. game_seed_state() in
// 014_dice_engine.sql writes the opening board by hand, and initDice() in the engine
// reads it. Nothing in Postgres or TypeScript enforces that those two agree - the SQL
// file cannot import the engine, and the engine cannot see the file. So they drift the
// moment someone adds a field to one of them, and the symptom is not a build error. It
// is a live match where every field after the new one reads as undefined.
//
// Concretely: thrownRound was added to the engine to fix a match that stalled on round
// one. Had the seed not been updated in the same breath, and had this test not been
// written, the board would have gone live with thrownRound undefined, every throw would
// have been judged against undefined, and the first player to look at a screen would
// have seen the match simply not move.
//
// So this reads the migration and compares it to the running engine, rather than
// comparing it to a hand-written copy that drifts from the engine in exactly the same
// way the SQL would.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { initDice, type DiceState } from '../src/engine/dice'
import { isUsableDiceState } from '../src/engine/diceServer'

const here = dirname(fileURLToPath(import.meta.url))
const migration = readFileSync(resolve(here, '../supabase/014_dice_engine.sql'), 'utf8')

/**
 * The dice branch of game_seed_state(), as JSON.
 *
 * Parsed out of the migration rather than transcribed. The `when 'dice' then` branch
 * is converted to JSONB and evaluated, so a typo in a value, a missing field or a stray
 * extra one is a test failure here instead of a broken table in production.
 *
 * The keys jsonb_build_object takes are quoted SQL strings; they become quoted JSON
 * keys, so this strips the quotes to get at the names.
 */
function diceSeedKeys(): string[] {
  const branch = migration.slice(
    migration.indexOf("when 'dice' then"),
    migration.indexOf('else null'),
  )

  const keys: string[] = []
  // 'key',  value   - the opening quote of a key, up to the matching closing quote.
  for (const match of branch.matchAll(/'([a-zA-Z_]+)'\s*,/g)) keys.push(match[1])
  return keys
}

/** The opening values the migration writes, for the ones that must match the engine. */
function diceSeedValue(key: string): string | undefined {
  const branch = migration.slice(
    migration.indexOf("when 'dice' then"),
    migration.indexOf('else null'),
  )
  const match = branch.match(new RegExp(`'${key}'\\s*,\\s*([^\\n]+)`))
  const value = match?.[1].trim().replace(/,$/, '')
  if (value === undefined) return undefined

  // The last field of the object is followed by that object's closing paren, so `winner,
  // null)` arrives with a bracket on the end. Strip closing parens only while there are
  // more of them than opening ones - that removes the enclosing call's bracket without
  // touching jsonb_build_array(0, 0), which is balanced and has to survive whole.
  let out = value
  while (countChars(out, ')') > countChars(out, '(')) out = out.slice(0, -1).trim()
  return out
}

const countChars = (s: string, c: string): number => s.split(c).length - 1

describe('the Dice seed the server writes', () => {
  it('has exactly the fields initDice() produces', () => {
    // Both directions on purpose. A field the engine expects but the seed omits reads
    // as undefined at runtime; a field the seed writes but the engine ignores is dead
    // weight the phone has to guess about. Neither is a compile error.
    const engineKeys = Object.keys(initDice()).sort()
    const seedKeys = diceSeedKeys().sort()

    expect(seedKeys).toEqual(engineKeys)
  })

  it('opens on round one with both dice unthrown', () => {
    // thrownRound is null and has to stay null in the seed. This is the field the
    // stalled-match fix turned on: a seed that filled it in would make the first real
    // throw look like a duplicate and refuse it.
    expect(diceSeedValue('round')).toBe('1')
    expect(diceSeedValue('initiator')).toBe('0')
    expect(diceSeedValue('dice')).toBe('null')
    expect(diceSeedValue('thrownRound')).toBe('null')
    expect(diceSeedValue('turn')).toBe('0')
    expect(diceSeedValue('winner')).toBe('null')
  })

  it('starts nobody on the scoreboard', () => {
    expect(diceSeedValue('scores')).toBe('jsonb_build_array(0, 0)')
  })
})

describe('a board seeded from the migration', () => {
  // The engine reading a seed is the thing that has to work, so it is built the way
  // Postgres would deliver it: JSON numbers arrive as JS numbers, and every field is
  // present because of the equality check above.
  const seeded = (): DiceState => ({
    round: Number(diceSeedValue('round')),
    initiator: Number(diceSeedValue('initiator')),
    dice: null,
    thrownRound: null,
    scores: [0, 0],
    turn: Number(diceSeedValue('turn')),
    winner: null,
  })

  it('is accepted by the server turn guard', () => {
    // A seed the engine rejects is the specific failure this test exists for: the match
    // would start live and then refuse every action against its own board.
    expect(isUsableDiceState(JSON.parse(JSON.stringify(seeded())))).toBe(true)
  })

  it('lets the host throw first', () => {
    const state = seeded()
    expect(state.turn).toBe(0)
    expect(state.thrownRound).not.toBe(state.round)
  })

  it('is not already won', () => {
    expect(seeded().winner).toBeNull()
  })
})