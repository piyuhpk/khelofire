import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// The screenshot is the whole point of the deposit request: an admin approving
// money needs to see the payment, not a transaction id the player typed. So it
// has to be impossible to send a request without one, and the picture has to
// still be there when the admin opens the queue.
//
// Two ways it was easy to lose:
//   - the button only warned after the server rejected the request, which is a
//     rule the player discovers after filling everything in;
//   - the pending queue replaces local rows with the server's copy, and the
//     server's copy at that point has no picture in it.

const DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

const h = vi.hoisted(() => ({
  readError: null as string | null,
  reads: 0,
}))

vi.mock('../src/lib/proofImage', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/lib/proofImage')>()
  return {
    ...mod,
    readProofDataUrl: vi.fn(async () => {
      h.reads++
      if (h.readError) throw new Error(h.readError)
      return DATA_URL
    }),
  }
})

vi.mock('../src/lib/supabase', () => ({ hasSupabase: false, supabase: null, envProblem: null }))
vi.mock('../src/lib/notice', () => ({
  notify: () => {},
  notifyError: () => {},
  setNoticeSink: () => {},
}))

import Wallet from '../src/features/wallet/Wallet'
import { useStore } from '../src/lib/store'
import { useI18n } from '../src/i18n'
import { PROOF_NOT_IMAGE } from '../src/lib/proofImage'

const openCheckout = () => {
  fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '50' } })
  fireEvent.click(screen.getByText('Request Deposit'))
}

const attach = (name = 'proof.png', type = 'image/png') =>
  fireEvent.change(screen.getByTestId('proof-file'), { target: { files: [new File(['x'], name, { type })] } })

/** open the checkout, attach a picture, send it - what the player actually does */
const sendWithProof = async () => {
  openCheckout()
  attach()
  await screen.findByTestId('proof-preview')
  fireEvent.click(screen.getByTestId('pay-now'))
}

beforeEach(() => {
  cleanup()
  h.readError = null
  h.reads = 0
  useI18n.setState({ lang: 'en' })
  useStore.setState({ deposits: [], ledger: [], availableMinor: 44000 })
  render(<MemoryRouter><Wallet /></MemoryRouter>)
})

describe('sending a deposit request', () => {
  it('will not submit until a screenshot has been attached', () => {
    openCheckout()
    const pay = screen.getByTestId('pay-now') as HTMLButtonElement
    expect(pay.disabled, 'the button went without a picture').toBe(true)
    expect(useStore.getState().deposits, 'a request was created anyway').toHaveLength(0)
  })

  it('takes the picture and opens the button', async () => {
    openCheckout()
    attach()
    await screen.findByTestId('proof-preview')
    expect((screen.getByTestId('pay-now') as HTMLButtonElement).disabled).toBe(false)
  })

  it('carries the picture into the request it creates', async () => {
    openCheckout()
    attach()
    await screen.findByTestId('proof-preview')
    fireEvent.click(screen.getByTestId('pay-now'))
    const rows = useStore.getState().deposits
    expect(rows).toHaveLength(1)
    expect(rows[0].proof).toBe(DATA_URL)
  })

  it('shows why a file was refused, and still will not go without one', async () => {
    h.readError = PROOF_NOT_IMAGE
    openCheckout()
    attach()
    // the handler is async, so the message lands on a later frame
    await screen.findByText('That is not an image — attach a screenshot of the payment')
    expect((screen.getByTestId('pay-now') as HTMLButtonElement).disabled).toBe(true)
    expect(useStore.getState().deposits).toHaveLength(0)
  })

  it('reads the picture only when one is chosen', () => {
    openCheckout()
    expect(h.reads).toBe(0)
    attach()
    expect(h.reads).toBe(1)
  })
})

describe('the queue handing the request to the admin', () => {
  const serverRow = (id: string, extra: Record<string, unknown> = {}) => ({
    id, user: 'piyush', amount_minor: 5000, method: 'bKash', ts: '2026-10-06T10:00:00Z', ...extra,
  })

  it('does not throw away the local picture when the server row arrives', async () => {
    await sendWithProof()
    const id = useStore.getState().deposits[0].id

    // 017 not applied: the server has no has_proof at all, and its row is the
    // same request without the image
    useStore.getState().setPendingRequests({ deposits: [serverRow(id, { ref: 'TX-9' })], withdrawals: [] })

    const row = useStore.getState().deposits.find((d) => d.id === id)!
    expect(row.proof, 'the only copy of the picture was in this browser').toBe(DATA_URL)
    expect(row.ref).toBe('TX-9')
  })

  it('marks a request whose picture the server does have', () => {
    useStore.getState().setPendingRequests({
      deposits: [serverRow('srv-1', { has_proof: true })],
      withdrawals: [],
    })
    expect(useStore.getState().deposits[0].hasProof).toBe(true)
  })

  it('leaves hasProof off a request the server has no picture for', () => {
    useStore.getState().setPendingRequests({ deposits: [serverRow('srv-2')], withdrawals: [] })
    expect(useStore.getState().deposits[0].hasProof).toBeUndefined()
  })

  it('opens the local picture without asking the server for it', async () => {
    await sendWithProof()
    const id = useStore.getState().deposits[0].id
    expect(await useStore.getState().getDepositProof(id)).toBe(DATA_URL)
  })
})
