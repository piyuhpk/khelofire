// Tests for the rules that decide which games a player is shown, and what happens
// when they ask for a table they already have open.
//
// Both of these were wrong in ways the app could not fix on screen. A free game that
// is filtered out of the lobby is gone - not reachable, not greyed out, gone - and the
// player is told nothing. And a server that refuses a second table used to answer the
// refusal with an error banner, for the most ordinary action in the app.
//
// These are read from source rather than from a running screen because the filter that
// hides the free games is a single predicate, and that predicate is the whole defect.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8')

const catalog = read('../src/lib/catalog.ts')
const lobby = read('../src/features/lobby/Lobby.tsx')
const live = read('../src/lib/live.ts')

describe('free games are reachable', () => {
  it('lists practice modes for Ludo, with a real entry and a real route', () => {
    // The bot modes have to exist as data, or the lobby fix below has nothing to show.
    expect(catalog).toMatch(/id:\s*'ludo_practice'/)
    expect(catalog).toMatch(/id:\s*'ludo_4p_practice'/)
    // Free means free. A practice mode that charges entry is a paid mode with a
    // misleading name, and the client blocks bots for paid modes, so it would be
    // unplayable as well as dishonest.
    expect(catalog).toMatch(/id:\s*'ludo_practice'[^}]*entryMinor:\s*0/)
  })

  it('does not hide practice modes from the lobby', () => {
    // Match to the closing arrow-body, not to the first ')' - the predicate's own
    // argument list would otherwise end the capture after "(m".
    const filter = lobby.match(/allModes\(\)\.filter\([\s\S]*?\n\s*\)/)?.[0] ?? ''
    expect(filter).not.toMatch(/!m\.practice/)
    // canPlayLive is what admits practice, so its presence matters too.
    expect(filter).toMatch(/canPlayLive\(m\)/)
  })
})

describe('creating a second table does not read as an error', () => {
  it('returns the existing table instead of only a refusal', () => {
    // The recovery has to read the caller's own row, which the read policy permits
    // exactly because it is their own table.
    expect(live).toMatch(/ALREADY_OPEN/)
    expect(live).toMatch(/from\('live_matches'\)/)
    expect(live).toMatch(/findMyOpenTable/)
  })

  it('still refuses a genuinely bad request', () => {
    // Recovery must not swallow real faults into a silent success.
    expect(live).toMatch(/if \(error\) throw new LiveError\(error\.message, 'create_failed'\)/)
  })

  it('marks the recovered table so the lobby can say what happened', () => {
    // Without this the player is told "Table created" for a table they created minutes
    // ago, and sees a code they have already seen with no explanation.
    expect(live).toMatch(/existing:\s*row\.existing === true/)
  })
})

describe('only Ludo takes real money', () => {
  it('keeps the live list to Ludo', () => {
    expect(catalog).toMatch(/LIVE_GAMES:\s*readonly GameKey\[\]\s*=\s*\['ludo'\]/)
  })
})