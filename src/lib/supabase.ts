// Supabase client — activates only when env keys are present.
// Without keys the app keeps running in local/demo mode (Zustand + localStorage),
// so nothing breaks before the project is wired. Paste keys into .env to go live.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * What is actually wrong with the .env, if anything.
 *
 * This used to be `Boolean(url && anon)` - a presence check and nothing else. So
 * a URL with a typo, a missing https://, or a copied anon key that belonged to
 * some other project all counted as "configured", and the app went on to ask
 * Supabase, which answered 401 "Invalid login credentials". That message is
 * about the account, not about the project, so it sent the diagnosis in exactly
 * the wrong direction: the real cause was the .env.
 *
 * Surfacing the specific reason costs nothing and turns a confusing auth error
 * into an obvious fix.
 */
export const envProblem: string | null = !url
  ? 'VITE_SUPABASE_URL is missing from .env'
  : !anon
    ? 'VITE_SUPABASE_ANON_KEY is missing from .env'
    : !/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url.trim())
      ? `VITE_SUPABASE_URL does not look like a Supabase URL: ${JSON.stringify(url)}`
      // Supabase's publishable key is a JWT; the legacy anon key is too. A value
      // that is neither is a paste mistake, not a key.
      : anon.trim().split('.').length !== 3
        ? 'VITE_SUPABASE_ANON_KEY does not look like a Supabase key (expected 3 dot-separated parts)'
        : null

/** true once VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set AND look right */
export const hasSupabase = envProblem === null

export const supabase: SupabaseClient | null = hasSupabase
  ? createClient(url!.trim(), anon!.trim(), { auth: { persistSession: true, autoRefreshToken: true } })
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
