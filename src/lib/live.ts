/**
 * Live tables.
 *
 * This talks to the real backend in 002_live_matches.sql - create_live_match,
 * join_live_match, start_live_match, cancel_live_match - and the server
 * authoritative ludo-game edge function. It is the only way a match can be real.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * The lobby used to decide a match was "live" by counting how many browsers were
 * sitting on the same mode screen, and then handed the game `{ real: true }` in
 * navigation state. Presence in a lobby is not a seat at a table: nobody was ever
 * seated, no board state was shared, and the game ran on the phone against the
 * local bot. So a solo bot game was presented to the player as a real match, with
 * the entry fee already taken.
 *
 * A real opponent is a row in live_match_seats with a user_id on it. That is the
 * only definition used here, and it is written by the database, not by a
 * client that would like a match to be real.
 *
 * Server authority, not client authority: the dice, the legal moves and the turn
 * are decided by the ludo-game edge function. The client renders what it is told
 * and sends intent ("roll", "move 2", "pass"). That is the whole point - if the
 * client decided rolls, a modified client could roll a six every time, and every
 * balance in the database would be someone else's money.
 */

import { applyDbModes, type GameMode } from './catalog'
import { supabase, hasSupabase } from './supabase'

export interface SeatInfo {
  seat: number
  /** absent until the seat is read back from live_match_seats */
  user_id?: string
  username?: string
}

export interface LiveMatch {
  match_id: string
  code: string
  mode: string
  game: string
  status: 'waiting' | 'live' | 'finished' | 'cancelled'
  seats: SeatInfo[]
  /** engine seat -> user, for rendering who owns which colour */
  seatCount: number
}

/** 5-8 uppercase letters/digits. The database enforces the same shape. */
const CODE_RE = /^[A-Z0-9]{5,8}$/

export const isValidCode = (c: string): boolean => CODE_RE.test(c.trim().toUpperCase())

export class LiveError extends Error {
  // plain field, not a constructor parameter property: this project compiles
  // with erasableSyntaxOnly, which forbids syntax that needs emitting.
  readonly code: string
  constructor(message: string, code = 'live_error') {
    super(message)
    this.code = code
    this.name = 'LiveError'
  }
}

/** A readable code. Not a secret - it is a room number, and it is shown on purpose. */
export function randomCode(): string {
  // no 0/O/1/I: these get read aloud and typed on a phone keyboard
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

/**
 * Open a table and take seat 0. The database debits the entry here, so a failure
 * after this point must be cancelled rather than walked away from.
 */
export async function createMatch(modeId: string, code?: string): Promise<LiveMatch> {
  requireSupabase()
  const room = (code ?? randomCode()).trim().toUpperCase()
  if (!isValidCode(room)) throw new LiveError('Room code must be 5-8 letters or digits', 'bad_code')

  const { data, error } = await supabase!.rpc('create_live_match', { p_mode: modeId, p_code: room })
  if (error) throw new LiveError(error.message, 'create_failed')

  const row = (data ?? {}) as { match_id: string; code: string; seat: number; next_seat: number }
  return {
    match_id: row.match_id,
    code: row.code,
    mode: modeId,
    game: 'ludo',
    status: 'waiting',
    seats: [{ seat: row.seat }],
    seatCount: row.next_seat >= 2 ? 2 : 4,
  }
}

/** Claim a free seat on someone else's table. */
export async function joinMatch(code: string): Promise<LiveMatch> {
  requireSupabase()
  const room = code.trim().toUpperCase()
  if (!isValidCode(room)) throw new LiveError('Room code must be 5-8 letters or digits', 'bad_code')

  const { data, error } = await supabase!.rpc('join_live_match', { p_code: room })
  if (error) throw new LiveError(error.message, 'join_failed')

  // join_live_match only hands back the id and the seat it gave you. Re-read the
  // row for the rest, so what is rendered comes from the table rather than from
  // what the caller hoped to type.
  const row = (data ?? {}) as { match_id: string; seat: number }
  const full = await fetchMatch(row.match_id)
  if (!full) throw new LiveError('joined but the table could not be read', 'fetch_failed')
  return full
}

/** Host only. Refused by the database unless every seat is taken. */
export async function startMatch(matchId: string): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.rpc('start_live_match', { p_match_id: matchId })
  if (error) throw new LiveError(error.message, 'start_failed')
}

/**
 * Close the table. Safe to call twice - it is the cleanup path for "the player
 * left", and it must refund a waiting table rather than leave the entry debited.
 */
export async function cancelMatch(matchId: string, reason = 'left'): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.rpc('cancel_live_match', { p_match_id: matchId, p_reason: reason })
  // deliberately swallowed: the table is already being left, and a failed
  // cancel is something the server's own reaper will clean up
  if (error) return
}

/**
 * Current table state, including who is actually seated.
 *
 * Read straight off the tables: RLS already lets a seated player (or the host)
 * read their own table, and these rows are only ever written by the security
 * definer RPCs. No extra read RPC is needed, and inventing one would only add
 * another function that has to be kept in step with the policies above.
 */
export async function fetchMatch(matchId: string): Promise<LiveMatch | null> {
  requireSupabase()
  const { data: m, error } = await supabase!
    .from('live_matches')
    .select('id, code, mode, game, status, seat_count')
    .eq('id', matchId)
    .maybeSingle()
  if (error) throw new LiveError(error.message, 'fetch_failed')
  if (!m) return null

  const { data: seats } = await supabase!
    .from('live_match_seats')
    .select('player_id, user_id')
    .eq('match_id', matchId)
    .order('player_id', { ascending: true })

  return {
    match_id: m.id as string,
    code: m.code as string,
    mode: m.mode as string,
    game: (m.game as string) ?? 'ludo',
    status: m.status as LiveMatch['status'],
    seats: (seats ?? []).map((s: { player_id: number; user_id: string }) => ({ seat: s.player_id, user_id: s.user_id })),
    seatCount: (m.seat_count as number) ?? 2,
  }
}

/**
 * Subscribe to a table. Realtime is a notification, not the source of truth: on
 * every message the real state is re-read with fetchMatch. That costs one small
 * query per event and means a dropped or reordered message can never leave the
 * board showing a state the database never agreed to.
 */
export function subscribeMatch(matchId: string, onChange: () => void): () => void {
  requireSupabase()
  const ch = supabase!.channel(`live:${matchId}`)
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'live_matches', filter: `id=eq.${matchId}` }, onChange)
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'live_match_seats', filter: `match_id=eq.${matchId}` }, onChange)
  ch.subscribe()
  return () => { void supabase!.removeChannel(ch) }
}

// ---------- server-authoritative actions ----------

export type LiveAction = 'roll' | 'move' | 'pass' | 'state'

/**
 * The board exactly as the server sees it.
 *
 * `state` is the engine's own board, `turn_seat` is whose turn it is, and
 * `your_seat` is this device's colour. The client renders these; it does not
 * compute them.
 */
export interface LiveGameState {
  match_id: string
  status: 'waiting' | 'live' | 'finished' | 'cancelled'
  /** increments on every accepted action; used to drop out-of-order replies */
  version: number
  state: {
    tokens: number[][]
    turn: number
    dice: number | null
    rolled: boolean
    sixes: number
    winner: number | null
    /** Which engine seats are actually in this match: [0,2] for 1v1, [0,1,2,3] for 4p.
     *  Not derived from token count - the board always carries four arrays, so
     *  assuming four players drew three opponents onto a two-player table. */
    players?: number[]
  }
  turn_seat: number
  winner_seat: number | null
  your_seat: number
  seconds_left: number
  turn_seconds: number
}

/**
 * Send intent to the ludo-game edge function and return the state it decided on.
 * The returned state is authoritative - it is what the server rolled, not what
 * this device hoped for.
 */
export async function sendAction(
  matchId: string,
  action: LiveAction,
  token?: number,
): Promise<LiveGameState> {
  requireSupabase()

  // The edge function resolves the caller with auth.getUser(jwt), so this has to
  // be the player's own access token. The anon key would authenticate as nobody
  // and every action would come back 401 - or worse, be attributed to nobody.
  const { data: sess } = await supabase!.auth.getSession()
  const jwt = sess.session?.access_token
  if (!jwt) throw new LiveError('Sign in again to play', 'no_session')

  const res = await fetch(`${supabaseUrl()}/functions/v1/ludo-game`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey(),
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ match_id: matchId, action, token }),
  })
  const body = (await res.json().catch(() => ({}))) as Partial<LiveGameState> & { error?: string }
  if (!res.ok || !body.state || body.turn_seat === undefined) {
    throw new LiveError(body.error ?? `ludo-game ${res.status}`, 'action_failed')
  }
  return body as LiveGameState
}

/** Read the board without touching the turn. Safe to call as often as needed. */
export const readState = (matchId: string): Promise<LiveGameState> => sendAction(matchId, 'state')

/**
 * Credit this player's wallet for a finished match.
 *
 * `p_outcome` is accepted for signature compatibility and then thrown away by the
 * database: it reads winner_seat off the match and decides win or loss itself.
 * That is deliberate - if the outcome were taken from the client, the loser of a
 * real match could simply claim 'win' and take the prize. It also refuses unless
 * the match really is 'finished' with a recorded winner, so this cannot be used
 * to settle a match in progress.
 */
/**
 * Load the mode catalogue from Postgres into the client overlay.
 *
 * Returns the number of modes so a caller can tell "no modes configured" from
 * "Supabase is not configured" - the two need different answers from an admin.
 */
export async function loadDbModes(): Promise<number> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('list_match_modes')
  // Deliberately not thrown. Without the database the built-in catalogue is still
  // correct and the app is fully usable, so a failure here is a warning, not an
  // error - the same reasoning as every other optional-server read in this file.
  if (error) return 0
  const rows = (data ?? []) as Record<string, unknown>[]
  applyDbModes(rows.map((r) => ({
    id: r.id as string,
    game: r.game as GameMode['game'],
    nameBn: (r.name_bn as string) || undefined,
    nameEn: (r.name_en as string) || undefined,
    players: Number(r.max_players) || 2,
    entryMinor: Number(r.entry_minor) || 0,
    prizeMinor: Number(r.prize_minor) || 0,
    clock: (r.clock as string) || undefined,
    desc: { bn: (r.desc_bn as string) || '', en: (r.desc_en as string) || '' },
    theme: (r.theme as GameMode['theme']) ?? 'blue',
    art: (r.art as string) || 'ludo1v1',
    tag: (r.tag as GameMode['tag']) ?? 'instant',
    open: Number(r.open_count) || 0,
  })))
  return rows.length
}

/** Save or edit a mode. Staff-only on the server; the panel never decides that. */
export async function saveMode(m: {
  id: string; game: string; label: string; entryMinor: number; prizeMinor: number
  players: number; nameBn?: string; nameEn?: string; descBn?: string; descEn?: string
  clock?: string; theme?: string; art?: string; tag?: string
}): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.rpc('upsert_match_mode', {
    p_id: m.id, p_game: m.game, p_label: m.label,
    p_entry_minor: m.entryMinor, p_prize_minor: m.prizeMinor, p_max_players: m.players,
    p_name_bn: m.nameBn ?? null, p_name_en: m.nameEn ?? null,
    p_desc_bn: m.descBn ?? null, p_desc_en: m.descEn ?? null,
    p_clock: m.clock ?? null,
    p_theme: m.theme ?? 'blue', p_art: m.art ?? 'ludo1v1', p_tag: m.tag ?? 'instant',
    p_active: true,
  })
  if (error) throw new LiveError(error.message, 'save_failed')
}

export async function settleMatch(matchId: string, outcome: 'win' | 'loss'): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.rpc('settle_match', { p_match_id: matchId, p_outcome: outcome })
  if (error) throw new LiveError(error.message, 'settle_failed')
}

/**
 * Give up a real match.
 *
 * This is two steps and both are required. resign_live_match decides the match in
 * the database - it is the only thing that can turn a live board into a decided one
 * without playing it out. settle_match then records the loss and is what actually
 * refuses to run on an unfinished match. Calling settle_match on its own, as the
 * resign button used to, threw 'match is live, not finished'; calling resign on its
 * own would decide the match but never record the result.
 */
export async function resignLiveMatch(matchId: string): Promise<{ forfeit: boolean; status: string }> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('resign_live_match', { p_match_id: matchId })
  if (error) throw new LiveError(error.message, 'resign_failed')
  const row = (data ?? {}) as { status?: string; forfeit_by?: number | null }
  const status = row.status ?? 'unknown'
  // Only a live match produces a forfeit. Leaving a waiting table frees the seat
  // and there is nothing to settle, because nothing was ever charged.
  const forfeit = status === 'finished'
  if (forfeit) {
    const { error: se } = await supabase!.rpc('settle_match', { p_match_id: matchId, p_outcome: 'loss' })
    // A settle failure here still means the match is decided; the reaper and the
    // settlement conflict rule cover the gap, so report it rather than hiding it.
    if (se) throw new LiveError(se.message, 'settle_failed')
  }
  return { forfeit, status }
}

function requireSupabase() {
  if (!hasSupabase || !supabase) throw new LiveError('Live matches need Supabase configured', 'no_supabase')
}
function supabaseUrl(): string { return import.meta.env.VITE_SUPABASE_URL }
function anonKey(): string { return import.meta.env.VITE_SUPABASE_ANON_KEY }
