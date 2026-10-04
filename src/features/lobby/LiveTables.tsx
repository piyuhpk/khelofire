/**
 * Live tables: create one, or join one with a code.
 *
 * This is the only route into a real match. The lobby's "wait for a player" path
 * used to open a local bot game and label it live; it no longer does that, so a
 * paid match that is real has to start from here.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Hash, Plus, LogIn, Copy, Check, Users, XCircle } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useToast, Spinner } from '../../ui/components'
import {
  createMatch, joinMatch, startMatch, cancelMatch, fetchMatch, subscribeMatch,
  isValidCode, readState, listOpenTables, touchTable, joinOpenTable, LiveError, type LiveMatch, type OpenTable,
} from '../../lib/live'
import { modeById } from '../../lib/catalog'

/** minor units -> the short money string the lobby uses everywhere else */
const fmt = (minor: number): string => (minor / 100).toFixed(0)

export default function LiveTables() {
  const { lang } = useI18n()
  const toast = useToast()
  const nav = useNavigate()

  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'create' | 'join' | null>(null)
  const [copied, setCopied] = useState(false)
  // the table this device is sitting at, if any
  const [table, setTable] = useState<LiveMatch | null>(null)
  const [starting, setStarting] = useState(false)
  const [tables, setTables] = useState<OpenTable[]>([])

  const bn = lang === 'bn'

  // What other people have open, polled while this screen is mounted. A table left
  // alone is hidden by the server after 90 seconds, so this poll is also how the list
  // empties itself instead of filling with rooms nobody is sitting in.
  useEffect(() => {
    let alive = true
    const poll = async () => {
      const rows = await listOpenTables()
      if (alive) setTables(rows)
    }
    void poll()
    const id = setInterval(() => void poll(), 8000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  // While waiting for an opponent, keep saying the table is alive. Without this the
  // host's own table stops appearing in the list after 90 seconds, which reads as
  // "nobody can join me" at exactly the moment somebody could.
  useEffect(() => {
    if (!table || table.status !== 'waiting') return
    const id = setInterval(() => { void touchTable(table.match_id) }, 30000)
    return () => clearInterval(id)
  }, [table?.match_id, table?.status]) // eslint-disable-line

  // Re-read whenever the table changes. Realtime is only a nudge - the state
  // always comes from the database, so a dropped message cannot desync the board.
  useEffect(() => {
    if (!table) return
    let alive = true
    const refresh = async () => {
      try {
        const next = await fetchMatch(table.match_id)
        if (alive && next) setTable(next)
      } catch { /* keep the last known state */ }
    }
    const unsub = subscribeMatch(table.match_id, () => void refresh())
    return () => { alive = false; unsub() }
  }, [table?.match_id]) // eslint-disable-line

  const enter = (m: LiveMatch) => {
    // The match id goes in the URL as well as in the router state. State is lost
    // on a reload, an Android process death/app restore, an in-app refresh or the
    // Capacitor WebView reloading its bundle - and with it, the only thing that
    // told LudoGame this was a real match. Losing it did not return the player to
    // the lobby; it started a local bot game over a board the opponent was still
    // playing, with the entry already debited and no way back.
    nav(`/play/ludo/${m.mode}?m=${m.match_id}`, { state: { matchId: m.match_id, real: true } })
  }

  const doCreate = async () => {
    setBusy('create')
    try {
      const m = await createMatch(pickMode())
      setTable(m)
      setCode(m.code)
      // m.existing means the server handed back the table they already had open rather
      // than making a second one. Say so, because "Table created" would be a lie - they
      // did not create it just now - and silently swallowing it would leave them
      // wondering why the code is one they have seen before.
      toast(
        m.existing
          ? (bn ? 'আপনার আগের টেবিলটিই খোলা আছে' : 'You already have this table open')
          : (bn ? 'টেবিল তৈরি — কোড শেয়ার করুন' : 'Table created — share the code'),
        'ok',
      )
    } catch (e) {
      toast(errText(e, bn), 'err')
    } finally { setBusy(null) }
  }

  const doJoin = async () => {
    const room = code.trim().toUpperCase()
    if (!isValidCode(room)) { toast(bn ? 'কোড ৫-৮ অক্ষর বা সংখ্যার' : 'Code must be 5-8 letters or digits', 'err'); return }
    setBusy('join')
    try {
      const m = await joinMatch(room)
      setTable(m)
      toast(bn ? 'টেবিলে যোগ দিলেন' : 'Joined the table', 'ok')
    } catch (e) {
      toast(errText(e, bn), 'err')
    } finally { setBusy(null) }
  }

  /**
   * Take a seat at a table from the lobby list.
   *
   * The list is a list of match ids, not codes, and that is deliberate: exposing the
   * code would let anyone read a table's address out of the lobby. So the seat is taken
   * through a server call that re-reads the row and does the same checks a code join
   * does. It also means a table that filled up between the poll and the tap fails here
   * with "table is full", rather than quietly landing the player somewhere else.
   */
  const doJoinOpen = async (t: OpenTable) => {
    setBusy('join')
    try {
      const m = await joinOpenTable(t.match_id)
      setTable(m)
      toast(bn ? 'টেবিলে যোগ দিলেন' : 'Joined the table', 'ok')
    } catch (e) {
      toast(errText(e, bn), 'err')
      // the list is a snapshot; drop the row that just failed so it cannot be tapped twice
      setTables((rows) => rows.filter((r) => r.match_id !== t.match_id))
    } finally { setBusy(null) }
  }

  const doStart = async () => {
    if (!table) return
    setStarting(true)
    try {
      // Pre-flight, and deliberately before start_live_match.
      //
      // Creating and seating a table are plain database RPCs and work with no edge
      // function deployed. The board, though, is driven by the ludo-game function -
      // so without it, start_live_match would still charge both entries and the
      // match would sit there with no legal move for either player. That is the one
      // failure a player must never walk into: money gone, game dead.
      //
      // readState is a read-only call, so probing it costs nothing and cannot change
      // the match. If it cannot answer, nothing has been charged yet and we say so.
      try {
        await readState(table.match_id)
      } catch (e) {
        // Only say "server unavailable" when that is actually what happened.
        // sendAction also throws when there is no session, and telling a player
        // who is simply signed out that the server is down would send them to wait
        // for something that is already working.
        if (e instanceof LiveError && e.code === 'no_session') {
          toast(bn ? 'আগে সাইন ইন করুন — কোনো টাকা কাটা হয়নি।' : 'Sign in first — nothing has been charged.', 'err')
        } else {
          toast(bn
            ? 'গেম সার্ভার এখনো চালু নেই — কোনো টাকা কাটা হয়নি। একটু পরে আবার চেষ্টা করুন।'
            : 'The game server is not available yet. Nothing has been charged — try again shortly.', 'err')
        }
        return
      }

      await startMatch(table.match_id)
      const fresh = await fetchMatch(table.match_id)
      if (fresh) setTable(fresh)
      enter(fresh ?? table)
    } catch (e) {
      toast(errText(e, bn), 'err')
    } finally { setStarting(false) }
  }

  const doCancel = async () => {
    if (!table) return
    const id = table.match_id
    setTable(null)
    // cancel first, then leave: the entry has to go back, and it is the server
    // that knows whether it was already debited.
    try { await cancelMatch(id, 'left') } catch { /* the reaper will get it */ }
    toast(bn ? 'টেবিল বাতিল, টাকা ফেরত' : 'Table cancelled, entry refunded', 'ok')
  }

  const copy = async () => {
    if (!table) return
    try {
      await navigator.clipboard.writeText(table.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { toast(bn ? 'কপি ব্যর্থ' : 'Copy failed', 'err') }
  }

  // ---- waiting for the opponent ----
  if (table && table.status === 'waiting') {
    const full = table.seatCount <= table.seats.length
    return (
      <div className="app-frame flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center text-white"
        style={{ background: 'linear-gradient(160deg,#0F1E3D,#16264A)' }}>
        <Users className="h-10 w-10 text-emerald2" />
        <p className="font-semibold">{bn ? 'অপোনেন্টের অপেক্ষা' : 'Waiting for an opponent'}</p>

        <button onClick={copy}
          className="tnum flex items-center gap-3 rounded-2xl px-5 py-3 font-display text-2xl font-extrabold tracking-[.25em]"
          style={{ background: 'rgba(255,255,255,.1)', border: '1px dashed rgba(255,255,255,.4)' }}>
          {table.code}
          {copied ? <Check className="h-5 w-5 text-emerald2" /> : <Copy className="h-5 w-5 opacity-70" />}
        </button>
        <p className="text-xs text-white/70">
          {bn ? 'এই কোড অপোনেন্টকে দিন' : 'Give this code to your opponent'}
        </p>

        <div className="text-xs text-white/60 tnum">
          {table.seats.length}/{table.seatCount} seated
        </div>

        {full && (
          <button onClick={doStart} disabled={starting} className="btn-primary w-full max-w-xs">
            {starting ? <Spinner className="h-4 w-4" /> : null}
            {bn ? 'ম্যাচ শুরু করুন' : 'Start match'}
          </button>
        )}
        <button onClick={doCancel} className="btn-ghost w-full max-w-xs">
          <XCircle className="h-4 w-4" />{bn ? 'বাতিল করুন' : 'Cancel & refund'}
        </button>
      </div>
    )
  }

  // ---- create or join ----
  return (
    <div className="app-frame flex min-h-[100dvh] flex-col justify-end" style={{ background: 'rgba(15,30,61,.5)' }}>
      <div className="rounded-t-sheet p-5 pb-8 animate-slide-up" style={{ background: 'var(--surface)' }}>
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full" style={{ background: 'var(--line)' }} />
        <h2 className="text-lg font-extrabold mb-1">{bn ? 'লাইভ ম্যাচ' : 'Live match'}</h2>
        <p className="text-sm text-muted mb-4">
          {bn
            ? 'সত্যিকারের প্রতিপক্ষের সাথে খেলুন — নিচের টেবিলে যোগ দিন, নতুন টেবিল খুলুন, অথবা কোড দিয়ে যোগ দিন।'
            : 'Play a real person: join a table below, open a new one, or enter a code you were given.'}
        </p>

        {/* Open tables first. This used to be create-a-table and a code box, which
            works only for two people standing together - a player opening the app alone
            had no way to find anyone, so they created a table, waited, and left. */}
        {tables.length > 0 && (
          <>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
              {bn ? `খোলা টেবিল (${tables.length})` : `Open tables (${tables.length})`}
            </p>
            <div className="mb-4 space-y-2">
              {tables.map((t) => (
                <button key={t.match_id} onClick={() => doJoinOpen(t)}
                  disabled={busy !== null}
                  className="flex w-full items-center gap-3 rounded-2xl p-3 text-left active:scale-[.99] transition disabled:opacity-50"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
                    style={{ background: 'var(--grad)' }}>
                    <Users className="h-5 w-5 text-white" strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{t.mode_label}</div>
                    <div className="truncate text-[11px] text-muted">
                      {t.host_name} · {t.seated}/{t.seat_count} seated
                      {/* seconds since the host last touched it: the difference between a
                          table someone is sitting in and one they have walked away from */}
                      {t.refreshed_seconds < 12
                        ? (bn ? ' · এখনই সক্রিয়' : ' · active now')
                        : ` · ${t.refreshed_seconds}s ago`}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-extrabold tnum">{fmt(t.entry_minor)}</div>
                    <div className="text-[10px] text-muted">{bn ? 'এন্ট্রি' : 'entry'}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        <button onClick={doCreate} disabled={busy !== null} className="btn-primary mb-3 w-full">
          {busy === 'create' ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" strokeWidth={2.6} />}
          {bn ? 'নতুন টেবিল খুলুন' : 'Open a new table'}
        </button>

        <div className="flex items-center gap-2 my-3 text-[11px] text-muted uppercase tracking-wider">
          <span className="h-px flex-1" style={{ background: 'var(--line)' }} />
          {bn ? 'অথবা' : 'or join with a code'}
          <span className="h-px flex-1" style={{ background: 'var(--line)' }} />
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Hash className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-40" />
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
              placeholder="ABC123"
              inputMode="text"
              autoCapitalize="characters"
              className="input tnum pl-9 font-display text-lg font-extrabold tracking-[.2em]"
            />
          </div>
          <button onClick={doJoin} disabled={busy !== null || !code.trim()} className="btn-emerald px-5">
            {busy === 'join' ? <Spinner className="h-4 w-4" /> : <LogIn className="h-4 w-4" strokeWidth={2.6} />}
          </button>
        </div>

        <p className="mt-4 text-[11px] leading-snug text-muted">
          {bn
            ? 'টেবিল বন্ধ না করে চলে গেলে টাকা ফেরত আসে যাবে।'
            : 'If you leave before the match starts, your entry is refunded automatically.'}
        </p>
      </div>
    </div>
  )
}

/**
 * Live tables are Ludo only for now - create_live_match refuses every other game,
 * and refuses practice modes and anything that is not 2 or 4 seats. The default
 * is Quick Play because it is the cheapest real table, but the id must match a
 * row in the database's match_modes, or create_live_match answers "unknown mode".
 */
function pickMode(): string {
  const real = ['ludo_quick', 'ludo_classic', 'ludo_4p'].find((id) => modeById(id))
  return real ?? 'ludo_quick'
}

function errText(e: unknown, bn: boolean): string {
  if (e instanceof LiveError) return e.message
  return bn ? 'কিছু গলতি হয়েছে' : 'Something went wrong'
}
