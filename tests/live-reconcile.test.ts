import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// A match that finished while the player's app was closed is never settled by
// anybody: settling is a request the client makes, so if no app was awake at the
// moment the server decided the winner, the entry they paid stays debited and
// their history reads as a loss. Nothing else in the app would ever repair it -
// the match is 'finished', so it is not an orphan entry lock to release.
//
// reconcileFinishedMatches() is the repair, and it runs on every sign-in. It is
// only safe because settle_match is idempotent, so these tests pin the two things
// that make running it repeatedly harmless: it only ever asks about matches the
// server already calls 'finished', and it keeps going when one match fails.

// A tiny stand-in for the supabase client: enough surface for the sweep, and a
// record of what it was asked.
const state = {
  seats: [] as { match_id: string }[],
  matches: [] as { id: string; status: string }[],
  settled: [] as string[],
  failOn: null as string | null,
}

vi.mock('../src/lib/supabase', () => ({
  hasSupabase: true,
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'me' } }, error: null }) },
    from(table: string) {
      if (table === 'live_match_seats') {
        return {
          select: () => ({
            eq: (_c: string, v: string) =>
              v === 'me'
                ? { data: state.seats, error: null }
                : { data: null, error: { message: 'not signed in' } },
          }),
        }
      }
      if (table === 'live_matches') {
        return {
          select: () => ({
            in: () => ({ eq: (_c: string, v: string) => ({ data: v === 'finished' ? state.matches : [], error: null }) }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
    rpc: async (fn: string, args: { p_match_id: string }) => {
      if (fn !== 'settle_match') throw new Error(`unexpected rpc ${fn}`)
      if (state.failOn === args.p_match_id) return { error: { message: 'boom' } }
      state.settled.push(args.p_match_id)
      return { error: null }
    },
  },
}))

import { reconcileFinishedMatches } from '../src/lib/live'

beforeEach(() => {
  state.seats = [{ match_id: 'm1' }, { match_id: 'm2' }, { match_id: 'm3' }]
  // only the finished one comes back from the filtered query
  state.matches = [{ id: 'm2', status: 'finished' }]
  state.settled = []
  state.failOn = null
})

describe('reconcileFinishedMatches', () => {
  it('settles a finished match that was never settled', async () => {
    expect(await reconcileFinishedMatches()).toBe(1)
    expect(state.settled).toEqual(['m2'])
  })

  it('asks only about matches the server has already finished', async () => {
    await reconcileFinishedMatches()
    // m1 and m3 are seats of mine but are not finished, so they are never settled -
    // settle_match would refuse them anyway, and asking is how a client ends up
    // trying to settle a match that is still being played.
    expect(state.settled).not.toContain('m1')
    expect(state.settled).not.toContain('m3')
  })

  it('is safe to run again - it re-asks, and the database makes it a no-op', async () => {
    await reconcileFinishedMatches()
    await reconcileFinishedMatches()
    // settle_match claims its idempotency slot first, so the second call reports a
    // duplicate and pays nothing. The sweep is allowed to repeat; that safety lives
    // in the database, which is why this asserts the repeat happens rather than
    // pretending the client tracks it.
    expect(state.settled).toEqual(['m2', 'm2'])
  })

  it('keeps sweeping after one match fails', async () => {
    state.matches = [
      { id: 'm1', status: 'finished' },
      { id: 'm2', status: 'finished' },
      { id: 'm3', status: 'finished' },
    ]
    state.failOn = 'm1'
    const done = await reconcileFinishedMatches()
    // m1 threw and was skipped; m2 and m3 still settled
    expect(state.settled).toEqual(['m2', 'm3'])
    expect(done).toBe(2)
  })

  it('does nothing when the player is seated in no matches', async () => {
    state.seats = []
    expect(await reconcileFinishedMatches()).toBe(0)
    expect(state.settled).toEqual([])
  })

  it('is actually called when the app loads the player', () => {
    // The sweep is worthless if nothing calls it, and that failure is completely
    // silent: no error, no empty state, just an unsettled entry that never gets
    // repaired. There is no cheap way to drive loadUserData() through a real
    // signed-in session here, so this checks the wiring exists at all - enough to
    // catch the call being dropped during a refactor, which is how it would go.
    const src = readFileSync(resolve(process.cwd(), 'src/lib/sync.ts'), 'utf8')
    expect(src).toContain('reconcileFinishedMatches')
    // and it must not be allowed to abort the sign-in it is part of
    expect(src).toMatch(/reconcileFinishedMatches\(\)\.catch/)
  })
})
