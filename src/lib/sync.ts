// Supabase data sync — makes wallet, stats, profile, matches & transactions
// REAL (server-stored per account) when the project is wired. In demo mode
// (no keys) everything stays local. Store never imports this file (no cycle);
// auth.ts starts it after a session is available.
import { supabase, hasSupabase } from './supabase'
import { useStore, type Ledger, type MatchRecord, type LedgerType, type TxnStatus, type Outcome } from './store'

let uid: string | null = null
let started = false
let hydrating = false
let lastLedger = 0
let lastMatches = 0
let debTimer: ReturnType<typeof setTimeout> | null = null

async function currentUserId(): Promise<string | null> {
  if (!hasSupabase || !supabase) return null
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

/** Load the signed-in user's profile + history from Supabase into the store. */
export async function loadUserData() {
  if (!hasSupabase || !supabase) return
  uid = await currentUserId()
  if (!uid) return
  hydrating = true
  try {
    const { data: prof } = await supabase.from('profiles').select('*').eq('id', uid).single()
    if (prof) {
      useStore.setState({
        username: prof.username, avatar: prof.avatar, playerId: prof.player_id,
        referralCode: prof.referral_code, availableMinor: prof.available_minor,
        lockedMinor: prof.locked_minor, wins: prof.wins, losses: prof.losses, draws: prof.draws,
      })
    }
    const { data: txns } = await supabase.from('transactions').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(60)
    if (txns) {
      const ledger: Ledger[] = txns.map((r: any) => ({
        id: r.id, type: (r.note?.split(' ')[0]?.toLowerCase() as LedgerType) || 'deposit',
        amountMinor: r.amount_minor, balanceAfter: 0, status: r.status as TxnStatus,
        ts: new Date(r.created_at).getTime(), note: r.note,
      }))
      useStore.setState({ ledger })
      lastLedger = useStore.getState().ledger.length
    }
    const { data: ms } = await supabase.from('matches').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(60)
    if (ms) {
      const matches: MatchRecord[] = ms.map((r: any) => ({
        id: r.id, game: r.game, mode: r.mode, entryMinor: r.entry_minor, prizeMinor: r.prize_minor,
        outcome: r.outcome as Outcome, deltaMinor: r.delta_minor, ts: new Date(r.created_at).getTime(), moves: r.moves ?? undefined,
      }))
      useStore.setState({ matches })
      lastMatches = useStore.getState().matches.length
    }
  } catch { /* offline / not set up — keep local */ }
  finally { hydrating = false; startSync() }
}

/** Push local changes back to Supabase (profile scalars debounced; new rows inserted). */
export function startSync() {
  if (started || !hasSupabase || !supabase) return
  started = true
  lastLedger = useStore.getState().ledger.length
  lastMatches = useStore.getState().matches.length

  useStore.subscribe((s, prev) => {
    if (hydrating || !uid || !supabase) return

    // profile scalars → debounced update
    const scalarChanged = s.username !== prev.username || s.avatar !== prev.avatar ||
      s.availableMinor !== prev.availableMinor || s.lockedMinor !== prev.lockedMinor ||
      s.wins !== prev.wins || s.losses !== prev.losses || s.draws !== prev.draws
    if (scalarChanged) {
      if (debTimer) clearTimeout(debTimer)
      debTimer = setTimeout(() => {
        supabase!.from('profiles').update({
          username: s.username, avatar: s.avatar, available_minor: s.availableMinor,
          locked_minor: s.lockedMinor, wins: s.wins, losses: s.losses, draws: s.draws,
        }).eq('id', uid!).then(() => {})
      }, 600)
    }

    // new ledger rows (store prepends) → insert
    if (s.ledger.length > lastLedger) {
      const fresh = s.ledger.slice(0, s.ledger.length - lastLedger)
      lastLedger = s.ledger.length
      supabase!.from('transactions').insert(fresh.map((l) => ({
        user_id: uid, amount_minor: l.amountMinor, note: l.note, status: l.status,
      }))).then(() => {})
    }

    // new match rows → insert
    if (s.matches.length > lastMatches) {
      const fresh = s.matches.slice(0, s.matches.length - lastMatches)
      lastMatches = s.matches.length
      supabase!.from('matches').insert(fresh.map((mt) => ({
        user_id: uid, game: mt.game, mode: mt.mode, entry_minor: mt.entryMinor,
        prize_minor: mt.prizeMinor, outcome: mt.outcome, delta_minor: mt.deltaMinor, moves: mt.moves ?? null,
      }))).then(() => {})
    }
  })
}

export function stopSync() { uid = null }
