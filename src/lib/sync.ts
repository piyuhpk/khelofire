// Supabase data sync.
//
// Money is server-authoritative. This file therefore:
//   * READS the profile, ledger and match history for the signed-in user
//   * WRITES only `username` and `avatar` - the two columns the database
//     still grants UPDATE on
// Balances, win counters, ledger rows and match rows are written by the
// SECURITY DEFINER functions in supabase/schema.sql (settle_match,
// request_deposit, request_withdrawal), never by the client.
//
// The previous version pushed available_minor / locked_minor / wins / losses
// straight from the browser and swallowed every error with `.then(() => {})`,
// which is what made RLS rejections invisible: the screen showed money that the
// server had never accepted.
import { supabase, hasSupabase } from './supabase'
import { useStore, type Ledger, type MatchRecord, type LedgerType, type TxnStatus, type Outcome } from './store'
import { notifyError } from './notice'

let uid: string | null = null
let started = false
let hydrating = false
let debTimer: ReturnType<typeof setTimeout> | null = null
let unsub: (() => void) | null = null

async function currentUserId(): Promise<string | null> {
  if (!hasSupabase || !supabase) return null
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

/** Map a server ledger note onto a LedgerType. Server notes look like
 *  "ludo_classic win", "deposit approved", "withdrawal refunded". */
function ledgerTypeOf(note: string): LedgerType {
  const n = (note || '').toLowerCase()
  if (n.includes('refund')) return 'refund_credit'
  if (n.includes('prize') || n.includes('win')) return 'prize_credit'
  if (n.includes('withdraw')) return 'withdrawal'
  if (n.includes('deposit')) return 'deposit'
  if (n.includes('cancelled')) return 'refund_credit'
  if (n.includes('draw') || n.includes('loss')) return 'entry_debit'
  return 'entry_debit'
}

/** Load the signed-in user's profile + history from Supabase into the store. */
export async function loadUserData() {
  if (!hasSupabase || !supabase) return
  try {
    uid = await currentUserId()
  } catch (e) {
    notifyError('Session check failed', e)
    return
  }
  if (!uid) return
  const me = uid
  hydrating = true
  try {
    const { data: prof, error: profErr } = await supabase
      .from('profiles').select('*').eq('id', me).maybeSingle()
    if (profErr) throw new Error(profErr.message)
    if (prof) {
      useStore.setState({
        username: prof.username, avatar: prof.avatar, playerId: prof.player_id,
        referralCode: prof.referral_code, availableMinor: prof.available_minor,
        lockedMinor: prof.locked_minor, wins: prof.wins, losses: prof.losses, draws: prof.draws,
      })
    }

    const { data: txns, error: txnErr } = await supabase
      .from('transactions').select('*').eq('user_id', me)
      .order('created_at', { ascending: false }).limit(60)
    if (txnErr) throw new Error(txnErr.message)
    if (txns) {
      // balance_after is reconstructed by walking the newest-first rows
      const rows = [...txns].sort((a, b) => a.created_at.localeCompare(b.created_at))
      let running = useStore.getState().availableMinor
      const byId = new Map<string, Ledger>()
      for (const r of rows) {
        running -= r.amount_minor
        byId.set(r.id, {
          id: r.id, type: ledgerTypeOf(r.note), amountMinor: r.amount_minor,
          balanceAfter: running, status: r.status as TxnStatus,
          ts: new Date(r.created_at).getTime(), note: r.note,
        })
      }
      useStore.setState({ ledger: txns.map((r: any) => byId.get(r.id)!).filter(Boolean) })
    }

    const { data: ms, error: matchErr } = await supabase
      .from('matches').select('*').eq('user_id', me)
      .order('created_at', { ascending: false }).limit(60)
    if (matchErr) throw new Error(matchErr.message)
    if (ms) {
      const matches: MatchRecord[] = ms.map((r: any) => ({
        id: r.id, game: r.game, mode: r.mode, modeId: r.mode,
        entryMinor: r.entry_minor, prizeMinor: r.prize_minor,
        outcome: r.outcome as Outcome, deltaMinor: r.delta_minor,
        ts: new Date(r.created_at).getTime(), moves: r.moves ?? undefined,
      }))
      useStore.setState({ matches })
    }
  } catch (e) {
    notifyError('Could not load your data', e)
  } finally {
    hydrating = false
    startSync()
  }
}

/** Push the only client-writable fields back to Supabase (debounced). */
export function startSync() {
  if (started || !hasSupabase || !supabase) return
  started = true

  unsub = useStore.subscribe((s, prev) => {
    if (hydrating || !uid || !supabase) return

    // username / avatar are the ONLY columns still granted to the client.
    // Sending available_minor here would fail against the column grants and the
    // wallet would silently drift away from the server balance.
    if (s.username !== prev.username || s.avatar !== prev.avatar) {
      if (debTimer) clearTimeout(debTimer)
      const patch = { username: s.username, avatar: s.avatar }
      debTimer = setTimeout(() => {
        supabase!.from('profiles').update(patch).eq('id', uid!).then(({ error }) => {
          if (error) notifyError('Profile not saved', error)
        })
      }, 600)
    }
  })
}

export function stopSync() {
  uid = null
  started = false
  hydrating = false
  if (debTimer) { clearTimeout(debTimer); debTimer = null }
  unsub?.()
  unsub = null
}