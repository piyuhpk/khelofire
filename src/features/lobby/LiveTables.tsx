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
  isValidCode, readState, LiveError, type LiveMatch,
} from '../../lib/live'
import { modeById } from '../../lib/catalog'

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

  const bn = lang === 'bn'

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
      toast(bn ? 'টেবিল তৈরি — কোড শেয়ার করুন' : 'Table created — share the code', 'ok')
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
            ? 'সত্যিকারের প্রতিপক্ষের সাথে খেলতে টেবিল খুলুন বা কোড দিয়ে যোগ দিন।'
            : 'Play a real person: open a table and share the code, or enter a code you were given.'}
        </p>

        <button onClick={doCreate} disabled={busy !== null} className="btn-primary mb-3 w-full">
          {busy === 'create' ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" strokeWidth={2.6} />}
          {bn ? 'টেবিল খুলুন' : 'Create a table'}
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
