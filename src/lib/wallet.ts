// Server-authoritative wallet layer.
//
// Why this file exists: the anon key ships inside the APK, so it is public.
// Anything reachable with it must not be able to move money. Every money
// operation therefore goes through a Postgres function that re-derives the
// amount server-side (see supabase/schema.sql). The UI never decides how much
// money is involved - it only says what happened.
//
// When Supabase is not configured (no keys in .env) each call resolves to
// `null` and the caller keeps the previous local-only demo behaviour.

import { supabase, hasSupabase } from './supabase'

export type Outcome = 'win' | 'loss' | 'draw' | 'cancelled'

export interface SettleResult {
  match_id: string
  entry_minor: number
  prize_minor: number
  delta_minor: number
  available_minor: number
}

export interface LeaderRow {
  username: string
  avatar: string
  wins: number
}

/** Settle a finished match. Entry + prize come from match_modes, not the client. */
export async function settleMatch(
  game: string,
  modeId: string,
  outcome: Outcome,
): Promise<SettleResult | null> {
  if (!hasSupabase || !supabase) return null
  const { data, error } = await supabase.rpc('settle_match', {
    p_game: game,
    p_mode: modeId,
    p_outcome: outcome,
  })
  if (error) throw new Error(error.message)
  return (data as SettleResult) ?? null
}

/** Ask to withdraw. The balance is debited server-side straight away. */
export async function requestWithdrawal(
  amountMinor: number,
  method: string,
  account: string,
): Promise<string | null> {
  if (!hasSupabase || !supabase) return null
  const { data, error } = await supabase.rpc('request_withdrawal', {
    p_amount_minor: amountMinor,
    p_method: method,
    p_account: account,
  })
  if (error) throw new Error(error.message)
  return (data as string) ?? null
}

/** Ask to deposit. Nothing is credited until an admin approves it. */
export async function requestDeposit(
  amountMinor: number,
  method: string,
  ref: string,
): Promise<string | null> {
  if (!hasSupabase || !supabase) return null
  const { data, error } = await supabase.rpc('request_deposit', {
    p_amount_minor: amountMinor,
    p_method: method,
    p_ref: ref,
  })
  if (error) throw new Error(error.message)
  return (data as string) ?? null
}

/**
 * Staff-only: approve or reject a money request. Goes through the edge
 * function because decide_deposit/decide_withdrawal are revoked from the
 * anon key. Throws when the caller is not staff.
 */
export async function decideMoneyRequest(
  kind: 'deposit' | 'withdrawal',
  id: string,
  approve: boolean,
): Promise<void> {
  if (!hasSupabase || !supabase) return
  const url = `${(import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, '')}/functions/v1/admin-wallet`
  const { data: sess } = await supabase.auth.getSession()
  const token = sess.session?.access_token
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ kind, id, approve }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
}

/** Server-side role for the signed-in user: 'admin' | 'superadmin' | 'support' | null. */
export async function fetchStaffRole(): Promise<string | null> {
  if (!hasSupabase || !supabase) return null
  const { data, error } = await supabase.rpc('is_staff')
  if (error) return null
  return (data as string) ?? null
}

/** Real leaderboard. Returns only name/avatar/wins - never a balance. */
export async function fetchLeaderboard(limit = 50): Promise<LeaderRow[]> {
  if (!hasSupabase || !supabase) return []
  const { data, error } = await supabase.rpc('get_leaderboard', { p_limit: limit })
  if (error) throw new Error(error.message)
  return (data as LeaderRow[]) ?? []
}

export interface PendingRow {
  id: string
  user: string
  amount_minor: number
  method: string
  ts: string
  ref?: string
  account?: string
}

/**
 * Pending deposits + withdrawals for the admin screen. RLS deliberately stops
 * a normal client from reading other users' rows, so this goes through the
 * staff-checked RPC. Returns empty arrays when the caller is not staff.
 */
export async function fetchPendingRequests(): Promise<{
  deposits: PendingRow[]
  withdrawals: PendingRow[]
}> {
  const empty = { deposits: [] as PendingRow[], withdrawals: [] as PendingRow[] }
  if (!hasSupabase || !supabase) return empty
  const { data, error } = await supabase.rpc('list_pending_requests')
  if (error) return empty
  const body = (data ?? {}) as { deposits?: PendingRow[]; withdrawals?: PendingRow[] }
  return { deposits: body.deposits ?? [], withdrawals: body.withdrawals ?? [] }
}