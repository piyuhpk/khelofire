// Supabase client — activates only when env keys are present.
// Without keys the app keeps running in local/demo mode (Zustand + localStorage),
// so nothing breaks before the project is wired. Paste keys into .env to go live.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * Does this look like a key the browser is allowed to hold?
 *
 * Supabase has shipped two shapes and both are correct in the dashboard:
 *   - the legacy `anon public` key: a JWT, three dot-separated parts starting eyJ
 *   - the newer `publishable` key: sb_publishable_...
 * An earlier version of this check only accepted the JWT form and rejected the
 * publishable one, which is a key the dashboard hands out by default now - so it
 * refused a perfectly good key and sent the user off to re-copy something that
 * was already right.
 *
 * What it must still refuse is the `secret` key. That one is server-side only:
 * shipped to a browser it would hand over the whole database.
 */
function looksLikeBrowserSafeKey(k: string): boolean {
  const v = k.trim()
  if (/^sb_secret_/i.test(v)) return false
  if (/^sb_publishable_/i.test(v)) return true
  return v.split('.').length === 3
}

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
      : /^sb_secret_/i.test(anon.trim())
        ? 'VITE_SUPABASE_ANON_KEY is a SECRET key. Never put it in .env - it ships to every browser and hands over the whole database. Use the anon public key or the publishable key.'
        : !looksLikeBrowserSafeKey(anon)
          ? `VITE_SUPABASE_ANON_KEY does not look like a Supabase key: ${JSON.stringify(anon.slice(0, 12))}... - expected the anon public key or a publishable key`
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
