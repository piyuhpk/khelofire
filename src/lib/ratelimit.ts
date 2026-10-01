// Lightweight CLIENT-side rate limiter — a sliding-window guard that stops
// rapid repeat actions (spam clicks, brute-force login attempts) in this tab.
//
// NOTE: client-side limits are a UX guard only; they can be bypassed by anyone
// hitting the API directly. REAL rate limiting must live server-side — configure
// it in the Supabase dashboard (Auth rate limits) and in edge functions.
const hits = new Map<string, number[]>()

/** returns true if allowed; false if the limit for `key` is exceeded */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs)
  if (arr.length >= max) { hits.set(key, arr); return false }
  arr.push(now)
  hits.set(key, arr)
  return true
}

/** ms until the next attempt for `key` is allowed (0 if allowed now) */
export function cooldownMs(key: string, max: number, windowMs: number): number {
  const now = Date.now()
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs)
  if (arr.length < max) return 0
  return windowMs - (now - arr[0])
}
