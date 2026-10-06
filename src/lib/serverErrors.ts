/**
 * Every refusal the database can give, said in a language the player reads.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The server answers in its own voice. `join_live_match_by_id` raises the sentence
 * "table is full", `decide_deposit` raises "not pending", and PostgREST raises
 * "Could not find the function public.list_pending_requests() in the schema cache"
 * when a migration was never pasted. All of that arrived verbatim at the phone.
 *
 * The leak was `notifyError`, which built `${what}: ${msg}` for every failure in the
 * store, the sync layer and the wallet - so a rejection read "Could not update the
 * deposit: not pending", and a server missing its SQL read "Could not load the
 * pending requests queue: Could not find the function public.list_pending_requests()
 * in the schema cache". That last one is an instruction to whoever administers the
 * database. The person holding the phone cannot act on it, was given no other
 * explanation, and reported it as "the same error everywhere".
 *
 * The lobby and LudoGame each had their own partial copy of this mapping, which is
 * why some errors were phrased and the rest were not. This is the one table, keyed
 * off the exact strings raised in supabase/*.sql, and it covers a message nobody
 * wrote before too: an unknown one still becomes a sentence rather than the raw
 * text, because a player who cannot act on the words has not been told anything.
 */

import { translations, type Lang, type TKey } from '../i18n/translations'

/** PostgREST's answer when the function does not exist - i.e. the SQL was never pasted. */
const MISSING_FN = /could not find the function|PGRST202|schema cache/i
/** An RLS policy or grant that was never set up, usually from the same cause. */
const PERMISSION = /permission denied|row-level security|PGRST301|PGRST116/i

export function serverErrMsg(e: unknown, lang: Lang): string {
  const pick = (k: TKey): string => translations[lang][k] ?? translations.en[k]

  const msg = e instanceof Error ? e.message : ''
  if (!msg) {
    const text = String(e)
    if (/fetch|network|load failed|abort/i.test(text)) return pick('live.err.network')
    return pick('live.err.generic')
  }

  // Order matters: the server's sentences overlap, so the narrow ones are matched
  // first and the catch-all last. "already" alone appears in "already started",
  // "already in use", "already at this table" and "already have 5 pending requests",
  // and those four need four different answers.
  if (MISSING_FN.test(msg) || PERMISSION.test(msg)) return pick('live.err.setup')
  if (/not signed in|not authenticated|sign in again|JWT|PGRST300/i.test(msg)) return pick('live.err.signedOut')

  // seated - the match already belongs to this player, so show it to them
  if (/already (at|in) this table/i.test(msg)) return pick('live.err.seated')
  if (/not seated/i.test(msg)) return pick('live.err.notSeated')

  // capacity and age of a table
  if (/table is full/i.test(msg)) return pick('live.err.full')
  if (/no open table with code/i.test(msg)) return pick('live.err.noCodeTable')
  if (/no such table|unknown match|could not be read back|joined but/i.test(msg)) return pick('live.err.closed')
  if (/you created this table/i.test(msg)) return pick('live.err.ownTable')
  if (/already started|match already/i.test(msg)) return pick('live.err.started')
  if (/need \d+ players|not enough players/i.test(msg)) return pick('live.err.needPlayers')
  if (/only the host|only the host or staff/i.test(msg)) return pick('live.err.hostOnly')

  // money, and the deposit/withdrawal queue
  if (/already have \d+ pending deposit/i.test(msg)) return pick('live.err.tooManyDeposits')
  if (/already have \d+ pending withdrawal/i.test(msg)) return pick('live.err.tooManyWithdrawals')
  if (/not pending/i.test(msg)) return pick('live.err.alreadyDecided')
  if (/already been submitted|each payment can only/i.test(msg)) return pick('live.err.refUsed')
  if (/insufficient balance|not enough combined balance|but needs/i.test(msg)) return pick('live.err.insufficient')
  if (/amount must be between/i.test(msg)) return pick('live.err.amountRange')
  if (/enter the account to receive/i.test(msg)) return pick('live.err.needAccount')
  if (/no such deposit|no such withdrawal|no profile/i.test(msg)) return pick('live.err.notFound')
  if (/already in use/i.test(msg)) return pick('live.err.codeTaken')
  if (/bad code|5-8/i.test(msg)) return pick('live.err.badCode')

  // turns and timing, inside a match
  if (/not your turn/i.test(msg)) return pick('live.err.notYourTurn')
  if (/deadline|expired|too slow|too late/i.test(msg)) return pick('live.err.timeUp')

  // the operator will have to fix these; the player only needs to know the mode
  if (/requires the deciding staff id|deciding staff id is required|p_staff is not a staff/i.test(msg)) return pick('live.err.setup')
  if (/admin only|service_role only|support cannot move money/i.test(msg)) return pick('live.err.setup')
  if (/unknown mode|is not a ludo mode|practice mode|only 2 and 4|is not active/i.test(msg)) return pick('live.err.modeUnavailable')

  if (/fetch|network|load failed/i.test(msg)) return pick('live.err.network')
  return pick('live.err.generic')
}
