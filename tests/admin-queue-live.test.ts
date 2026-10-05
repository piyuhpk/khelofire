import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The admin panel's money queue.
//
// The complaint was that approving a deposit "does not work" and that a change
// made in the admin showed up "sirf image wala and dusre account par nahi".
// Three separate causes, all of them here:
//
// 1. The queue was fetched once, on sign-in, and never again. A payment made on a
//    phone - the normal way money arrives - did not exist in the panel until the
//    app was closed and reopened. Approving a row that is not on screen does
//    nothing, which reads as a broken button.
//
// 2. Nothing re-fetched after a decision either, so a row decided in another tab
//    kept saying "pending" here, and tapping it again did nothing at all.
//
// 3. That "nothing at all" was a bare `return`. No message, no state change. The
//    one moment where the admin needs to be told something - you already did this
//    - was the moment that said nothing.
//
// These read the source rather than mounting the panel: the panel is a thousand
// lines gated behind a staff session, and the behaviour under test is entirely in
// how the queue is fetched and what happens when a row is not pending.

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8')
const admin = read('src/features/admin/Admin.tsx')
const store = read('src/lib/store.ts')

describe('admin request queue', () => {
  it('can re-fetch the queue on demand', () => {
    expect(store).toMatch(/reloadPendingRequests/)
    // and it actually goes to the server rather than only merging what it has
    expect(store).toMatch(/reloadPendingRequests:\s*async\s*\(\)\s*=>/)
    expect(store).toMatch(/fetchPendingRequests\(\)/)
  })

  it('refreshes the queue when a request arrives or changes', () => {
    // realtime on the money tables, so a new payment appears without a reload
    for (const table of ['deposits', 'withdrawals']) {
      expect(admin, `no realtime on ${table}`).toMatch(
        new RegExp(`table: '${table}'`),
      )
    }
    expect(admin).toMatch(/postgres_changes/)
  })

  it('polls as well, because realtime alone is not enough', () => {
    // A phone that was backgrounded loses its socket. Realtime silently stops
    // and the panel then looks frozen on stale rows. A slow poll covers the gap.
    expect(admin).toMatch(/setInterval/)
  })

  it('cleans the poll and the channel up on unmount', () => {
    expect(admin).toMatch(/clearInterval/)
    expect(admin).toMatch(/removeChannel/)
  })

  it('says something when a request is not pending, instead of doing nothing', () => {
    // Both decision paths. The silent return was the reason a rejected-then-
    // re-tapped row looked like the app was broken.
    expect(store).toMatch(/if \(d\.status !== 'pending'\)/)
    expect(store).toMatch(/if \(w\.status !== 'pending'\)/)
    // and each one has to report, not just bail
    const notPendingBlocks = store.match(/status !== 'pending'\)[\s\S]{0,320}?\n\s*\}/g) ?? []
    expect(notPendingBlocks.length).toBeGreaterThanOrEqual(2)
    for (const b of notPendingBlocks) {
      expect(b).toMatch(/notify\(/)
    }
  })

  it('no longer offers a Lock button that only cleared local state', () => {
    // It called adminLogout() and navigated away - it did not sign the account
    // out, so anyone with the phone just reloaded and was back in. It looked like
    // a security control and was not one.
    expect(admin).not.toMatch(/>Lock</)
    expect(admin).not.toMatch(/adminLogout\(\); nav/)
  })
})
