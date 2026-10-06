import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serverErrMsg } from '../src/lib/serverErrors'
import { LiveError } from '../src/lib/live'
import { translations } from '../src/i18n/translations'

// The live-match flow could not be tested on a phone at all:
//
//   "dusre phone me sirf live table par tap karo to aa jata hai, lekin kabhi kabhi
//    bahut der se, aur bina table full hue error aa jata hai"
//
// plus a red error on tapping a listed table. The four functions that make that
// flow work - list_open_tables, touch_live_table, join_live_match_by_id and
// create_live_match - live in 016_paste_into_supabase_sql_editor.sql, which a human
// pastes into the Supabase SQL editor by hand. Nothing in the app checks whether
// that happened, so the failure mode is: the list loads, the player taps, and the
// only feedback is a raw database error.
//
// So this cannot be a unit test of the SQL. What it can be is a check that the app
// degrades with an explanation when a function is missing, and that the SQL file
// the operator pastes still contains everything the client calls.
//
// The error text matters: "Could not load the open tables" is something to act on.
// A raw PGRST202 is not.

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('open-table SQL must be applied by hand', () => {
  const sql = read('supabase/016_paste_into_supabase_sql_editor.sql')

  it('defines every function the client calls', () => {
    for (const fn of [
      'create_live_match',
      'list_open_tables',
      'touch_live_table',
      'join_live_match_by_id',
    ]) {
      expect(sql, `${fn} is missing from the SQL the operator pastes`)
        .toContain(`function public.${fn}`)
    }
  })

  it('is not duplicated - a pasted file with two copies is a corrupted paste', () => {
    // This happened once: the file grew from 213 to 426 lines with all four
    // functions repeated, and nothing noticed, because `create or replace` means a
    // duplicate still runs. It only showed up as an odd diff.
    const each = (fn: string) => (sql.match(new RegExp(`create or replace function public\\.${fn}`, 'g')) ?? []).length
    for (const fn of ['create_live_match', 'list_open_tables', 'touch_live_table', 'join_live_match_by_id']) {
      expect(each(fn), `${fn} appears ${each(fn)} times`).toBe(1)
    }
  })
})

describe('no raw database sentence may reach the player', () => {
  // The report was a red box on tapping a table, and the same class of error was
  // reported from the wallet, the refer screen and the admin queue: one sentence,
  // everywhere, that the person holding the phone could not act on.
  //
  // Every string below is one that supabase/*.sql actually raises, plus
  // PostgREST's own text for a function that does not exist. serverErrMsg has to
  // turn all of them into a sentence, in both languages.
  const RAW = [
    'table is full',
    'no such table',
    'that table has already started',
    'you are already at this table',
    'you are already in this table',
    'you are not seated in this match',
    'not signed in',
    'only the host can start',
    'only the host or staff can cancel',
    'match already waiting',
    'unknown mode xyz',
    'mode xyz is not a ludo mode',
    'mode xyz is a practice mode and cannot host a real match',
    'bad code ABCDE, expected 5-8 uppercase letters or digits',
    'code ABCDE already in use',
    'no open table with code ABCDE',
    'you created this table',
    'need 4 players, have 2',
    'not enough combined balance: need 100, have 20',
    'insufficient balance',
    'amount must be between 1 and 10000 BDT',
    'enter the account to receive the money',
    'that transaction id has already been submitted - each payment can only be deposited once',
    'you already have 5 pending deposit requests - wait for one to be reviewed',
    'you already have 3 pending withdrawal requests - wait for one to be reviewed',
    'not pending',
    'no such deposit',
    'no such withdrawal',
    'Could not find the function public.list_pending_requests() in the schema cache',
    'Could not find the function public.join_live_match_by_id(p_match_id) in the schema cache',
    'new row violates row-level security policy for table "live_matches"',
    'permission denied for table live_match_seats',
    'decide_deposit now requires the deciding staff id - redeploy admin-wallet, then call (p_id, p_approve, p_staff)',
  ]

  for (const raw of RAW) {
    it(`translates "${raw.slice(0, 46)}${raw.length > 46 ? '…' : ''}"`, () => {
      for (const lang of ['bn', 'en'] as const) {
        const said = serverErrMsg(new LiveError(raw, 'join_failed'), lang)
        // a sentence, not the server's own words handed back
        expect(said, `${lang}: ${raw}`).not.toBe(raw)
        expect(said.length, `${lang}: ${raw}`).toBeGreaterThan(3)
        // no database vocabulary left in it
        expect(said, `${lang}: ${raw}`).not.toMatch(/PGRST|schema cache|function public|row-level security|permission denied/i)
      }
    })
  }

  it('says the setup is missing rather than printing PostgREST', () => {
    const missing = 'Could not find the function public.join_live_match_by_id(p_match_id) in the schema cache'
    expect(serverErrMsg(new LiveError(missing), 'en')).toMatch(/set up|setup/i)
    expect(serverErrMsg(new LiveError(missing), 'bn')).not.toMatch(/PGRST|function/)
  })

  it('distinguishes a full table from a missing one - they need different next steps', () => {
    const full = serverErrMsg(new LiveError('table is full'), 'en')
    const gone = serverErrMsg(new LiveError('no such table'), 'en')
    expect(full).not.toBe(gone)
  })

  it('does not mistake "already in use" for "already started"', () => {
    const started = serverErrMsg(new LiveError('match already waiting'), 'en')
    const codeTaken = serverErrMsg(new LiveError('code ABCDE already in use'), 'en')
    expect(started).not.toBe(codeTaken)
  })

  it('reports no connection as no connection, not as a generic failure', () => {
    const net = serverErrMsg(new TypeError('Failed to fetch'), 'en')
    expect(net).toMatch(/connection/i)
    expect(net).not.toBe(serverErrMsg(new Error('something else'), 'en'))
  })

  it('falls back to a sentence for an error nobody has seen', () => {
    // The default used to be the raw message. An unknown one must still be a
    // sentence: a player who cannot act on the words has not been told anything.
    const unknown = serverErrMsg(new LiveError('a completely new failure', 'x'), 'en')
    expect(unknown).not.toBe('a completely new failure')
    expect(unknown).toMatch(/[a-z]/i)
  })

  it('never leaks the raw message through notifyError', () => {
    // notifyError was `${what}: ${msg}` with msg straight from the database, which
    // is how the same error reached the wallet, the refer screen and the admin
    // queue at once.
    const notice = read('src/lib/notice.ts')
    expect(notice).toContain('serverErrMsg(')
    expect(notice).not.toMatch(/e instanceof Error \? e\.message/)
  })

  it('every key serverErrMsg can ask for exists in both languages', () => {
    const src = read('src/lib/serverErrors.ts')
    const keys = [...src.matchAll(/pick\('([^']+)'\)/g)].map((m) => m[1])
    expect(keys.length).toBeGreaterThan(15)
    for (const k of new Set(keys)) {
      expect(translations.bn, `${k} missing from bn`).toHaveProperty(k)
      expect(translations.en, `${k} missing from en`).toHaveProperty(k)
    }
  })
})
