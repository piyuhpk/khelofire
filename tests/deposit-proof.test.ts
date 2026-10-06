import { describe, it, expect, vi, beforeEach } from 'vitest'

// The screenshot rides along with the deposit request, and the whole feature
// lives or dies on one detail: supabase/017_deposit_screenshot.sql has to be
// pasted before the four-argument request_deposit exists. Until it is, calling
// that overload would fail with "could not find a function named
// request_deposit" - and every deposit button in the shipped APK would stop
// working over a picture. So the four-argument call is attempted first and the
// three-argument one is the safety net, which is the behaviour pinned here.
//
// The distinction that matters is between "this function does not exist yet" and
// "the server refuses this request". Only the first may fall back: the second
// includes request_deposit's own 'attach the payment screenshot', and falling
// back there would let a request through with no picture at all - the exact
// thing the rule exists to stop.

const h = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  deposit4: { data: null as unknown, error: null as { message: string; code?: string } | null },
  deposit3: { data: null as unknown, error: null as { message: string; code?: string } | null },
  proof: null as { data: unknown; error: { message: string } | null },
}))

vi.mock('../src/lib/supabase', () => ({
  hasSupabase: true,
  supabase: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.calls.push({ name, args })
      if (name === 'request_deposit' && 'p_proof' in args) return h.deposit4
      if (name === 'request_deposit') return h.deposit3
      if (name === 'get_deposit_proof') return h.proof ?? { data: null, error: null }
      return { data: null, error: null }
    },
  },
}))

import { requestDeposit, fetchDepositProof } from '../src/lib/wallet'
import { looksLikeProof, proofProblem, PROOF_NOT_IMAGE, PROOF_TOO_LARGE, PROOF_MAX_CHARS } from '../src/lib/proofImage'

const PROOF = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

beforeEach(() => {
  h.calls.length = 0
  h.deposit4 = { data: 'dep-4', error: null }
  h.deposit3 = { data: 'dep-3', error: null }
  h.proof = { data: PROOF, error: null }
})

describe('request_deposit with a screenshot', () => {
  it('sends the picture and reports it attached', async () => {
    const r = await requestDeposit(5000, 'bKash', 'TX-1', PROOF)
    expect(r).toEqual({ id: 'dep-4', proofAttached: true })
    expect(h.calls.map((c) => c.name)).toEqual(['request_deposit'])
    expect(h.calls[0].args).toMatchObject({ p_amount_minor: 5000, p_ref: 'TX-1', p_proof: PROOF })
  })

  it('falls back when the four-argument function has not been created yet', async () => {
    h.deposit4 = { data: null, error: { message: 'Could not find the function public.request_deposit in the schema cache', code: 'PGRST202' } }
    const r = await requestDeposit(5000, 'bKash', 'TX-1', PROOF)
    expect(r, 'the deposit itself must still be created').toEqual({ id: 'dep-3', proofAttached: false })
    expect(h.calls.map((c) => c.name)).toEqual(['request_deposit', 'request_deposit'])
    expect('p_proof' in h.calls[1].args).toBe(false)
  })

  it('matches the missing-function error by its wording as well as its code', async () => {
    h.deposit4 = { data: null, error: { message: 'function public.request_deposit(bigint, text, text, text) does not exist' } }
    const r = await requestDeposit(5000, 'bKash', 'TX-1', PROOF)
    expect(r?.proofAttached).toBe(false)
  })

  it('never falls back on the server refusing the request', async () => {
    // This is request_deposit itself saying the picture is missing or malformed.
    // Falling back would turn that into a successful deposit with no proof.
    h.deposit4 = { data: null, error: { message: 'attach the payment screenshot' } }
    await expect(requestDeposit(5000, 'bKash', 'TX-1', PROOF)).rejects.toThrow('attach the payment screenshot')
    expect(h.calls, 'must not have retried without the picture').toHaveLength(1)
  })

  it('does not fall back on a duplicate transaction id either', async () => {
    h.deposit4 = {
      data: null,
      error: { message: 'that transaction id has already been submitted - each payment can only be deposited once' },
    }
    await expect(requestDeposit(5000, 'bKash', 'TX-1', PROOF)).rejects.toThrow(/already been submitted/)
    expect(h.calls).toHaveLength(1)
  })

  it('goes straight to the old signature when there is no picture to send', async () => {
    const r = await requestDeposit(5000, 'bKash', 'TX-1')
    expect(r).toEqual({ id: 'dep-3', proofAttached: false })
    expect('p_proof' in h.calls[0].args).toBe(false)
    expect(h.calls).toHaveLength(1)
  })
})

describe('get_deposit_proof', () => {
  it('returns the data URL the admin renders', async () => {
    expect(await fetchDepositProof('dep-1')).toBe(PROOF)
    expect(h.calls[0]).toEqual({ name: 'get_deposit_proof', args: { p_deposit_id: 'dep-1' } })
  })

  it('returns null rather than throwing when the column has nothing in it', async () => {
    h.proof = { data: null, error: null }
    expect(await fetchDepositProof('dep-1')).toBeNull()
  })
})

// The server's own acceptance rule, restated on the client so the player is told
// while they can still pick a different picture. If these two ever disagree, the
// player passes the app and is rejected by the server - so the shape is pinned.
describe('what counts as a payment screenshot', () => {
  it('accepts a normal image data URL', () => {
    expect(looksLikeProof(PROOF)).toBe(true)
    expect(proofProblem(PROOF)).toBeNull()
    expect(looksLikeProof('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
    expect(looksLikeProof('data:image/webp;base64,UklGRg==')).toBe(true)
  })

  it('rejects anything that is not an image data URL', () => {
    for (const bad of ['', 'https://example.com/proof.jpg', 'data:text/html,<b>x</b>', 'data:image/png,raw', null, undefined]) {
      expect(looksLikeProof(bad as never), String(bad)).toBe(false)
    }
    expect(proofProblem('')).toBe(PROOF_NOT_IMAGE)
    expect(proofProblem('https://example.com/proof.jpg')).toBe(PROOF_NOT_IMAGE)
    expect(proofProblem(null)).toBe(PROOF_NOT_IMAGE)
  })

  it('rejects a picture bigger than the column will take', () => {
    const huge = 'data:image/jpeg;base64,' + 'A'.repeat(PROOF_MAX_CHARS)
    expect(looksLikeProof(huge)).toBe(false)
    expect(proofProblem(huge)).toBe(PROOF_TOO_LARGE)
  })
})
