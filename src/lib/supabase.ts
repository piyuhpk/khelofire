// Supabase client — activates only when env keys are present.
// Without keys the app keeps running in local/demo mode (Zustand + localStorage),
// so nothing breaks before the project is wired. Paste keys into .env to go live.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** true once VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set in .env */
export const hasSupabase = Boolean(url && anon)

export const supabase: SupabaseClient | null = hasSupabase
  ? createClient(url!, anon!, { auth: { persistSession: true, autoRefreshToken: true } })
  : null

// ---- typed row shapes (mirror supabase/schema.sql) ----
export interface ProfileRow {
  id: string
  username: string
  avatar: string
  player_id: string
  referral_code: string
  available_minor: number
  locked_minor: number
  wins: number
  losses: number
  draws: number
  created_at: string
}
export interface TxnRow {
  id: string
  user_id: string
  amount_minor: number
  note: string
  status: 'pending' | 'completed' | 'failed' | 'refunded'
  created_at: string
}
export interface MatchRow {
  id: string
  user_id: string
  game: string
  mode: string
  entry_minor: number
  prize_minor: number
  outcome: 'win' | 'loss' | 'draw' | 'cancelled'
  delta_minor: number
  moves: number | null
  created_at: string
}
