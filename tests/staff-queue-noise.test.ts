import { describe, it, expect, vi, beforeEach } from 'vitest'

// The banner every ordinary player saw on sign-in, on reopening the app, and on
// every new account:
//
//   Could not load the pending requests queue:
//   not authorised - your account has no staff role
//
// loadUserData() fetched the admin's deposit/withdrawal queue for everyone,
// because the comment above it claimed the RPC "returns empty arrays for anyone
// who is not staff". It raises instead. The catch turned that into a global error
// banner on a page the player has no control over.
//
// The contract worth pinning: a non-staff account never asks, so it can never see
// this. A staff account still asks, and a staff account that genuinely fails still
// reports - that is a real fault and the admin is the one who can act on it.

const h = vi.hoisted(() => ({
  isAdmin: false,
  rpcCalls: [] as string[],
  queueError: null as string | null,
  notices: [] as string[],
}))

vi.mock('../src/lib/wallet', () => ({
  fetchPendingRequests: async () => {
    h.rpcCalls.push('list_pending_requests')
    if (h.queueError) throw new Error(h.queueError)
    return { deposits: [], withdrawals: [] }
  },
  fetchStaffRole: async () => null,
  fetchLeaderboard: async () => [],
}))

vi.mock('../src/lib/notice', () => ({
  notify: () => {},
  notifyError: (what: string) => { h.notices.push(what) },
  setNoticeSink: () => {},
}))

vi.mock('../src/lib/supabase', () => ({
  hasSupabase: true,
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: 'me' } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          order: () => ({ limit: async () => ({ data: [], error: null }) }),
        }),
      }),
    }),
  },
}))

// Only isAdmin and setPendingRequests matter here; the store is stubbed to the
// surface loadUserData() actually uses.
vi.mock('../src/lib/store', () => ({
  useStore: {
    getState: () => ({ isAdmin: h.isAdmin, setPendingRequests: () => {} }),
    setState: () => {},
    subscribe: () => () => {},
  },
}))

import { loadUserData } from '../src/lib/sync'

beforeEach(() => {
  h.isAdmin = false
  h.rpcCalls = []
  h.queueError = null
  h.notices.length = 0
})

describe('loadUserData and the staff queue', () => {
  it('never asks for the queue on a player account', async () => {
    await loadUserData()
    expect(h.rpcCalls).not.toContain('list_pending_requests')
  })

  it('shows the player nothing when the RPC would raise "no staff role"', async () => {
    h.queueError = 'not authorised - your account has no staff role'
    await loadUserData()
    expect(h.rpcCalls).not.toContain('list_pending_requests')
    expect(h.notices.some((t) => /pending requests queue/i.test(t))).toBe(false)
  })

  it('never shows the "no staff role" banner on a player account', async () => {
    h.queueError = 'not authorised - your account has no staff role'
    await loadUserData()
    expect(h.notices.some((t) => /no staff role/i.test(String(t)))).toBe(false)
  })

  it('still asks for the queue when the account is staff', async () => {
    h.isAdmin = true
    await loadUserData()
    expect(h.rpcCalls).toContain('list_pending_requests')
  })

  it('still reports a genuine queue failure to staff', async () => {
    h.isAdmin = true
    h.queueError = 'connection reset'
    await loadUserData()
    expect(h.notices.some((t) => /pending requests queue/i.test(t))).toBe(true)
  })
})
