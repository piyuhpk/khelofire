import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useT, useI18n } from '../../i18n'
import { modeById } from '../../lib/catalog'
import { fmt } from '../../lib/money'
import { useStore } from '../../lib/store'
import { rateLimit } from '../../lib/ratelimit'
import { Spinner, useToast } from '../../ui/components'

export default function ConfirmJoin() {
  const { modeId } = useParams()
  const m = modeById(modeId!)
  const t = useT()
  const { lang } = useI18n()
  const nav = useNavigate()
  const toast = useToast()
  const available = useStore((s) => s.availableMinor)
  const unlockEntry = useStore((s) => s.unlockEntry)
  const [phase, setPhase] = useState<'confirm' | 'matching'>('confirm')
  const [waited, setWaited] = useState(false)

  const insufficient = !m || available < m.entryMinor
  const isFree = !m || m.entryMinor === 0

  const goBot = () => { if (m) nav(`/play/${m.game}/${m.id}`, { replace: true }) }

  // Structural guard: a paid mode is bounced the moment this screen mounts, so the
  // code below has no way to hold an entry even if a route change lands here
  // before the button is ever pressed.
  useEffect(() => {
    if (isFree || !m) return
    nav(`/live/${m.game}`, { replace: true })
  }, [m, isFree, nav])

  const join = () => {
    // Free modes play the bot. A paid mode cannot be started from this screen at
    // all, so it is forwarded instead of pretending: the live tables are the only
    // place a real opponent is possible.
    if (!isFree) { nav(`/live/${m.game}`, { replace: true }); return }
    if (!m) return
    // anti-spam guard: block rapid repeat joins (double-charge / abuse protection)
    if (!rateLimit('join', 6, 60000)) { toast(lang === 'bn' ? 'একটু ধীরে — আবার চেষ্টা করুন' : 'Slow down — try again shortly', 'err'); return }
    if (insufficient) { toast(t('match.insufficient'), 'err'); return }
    setPhase('matching')
    setWaited(false)
    // Free practice = instant bot game. Paid = a real table, reached by room
    // code from the Live tab, never from here. See below.
    setTimeout(goBot, 1200)
  }

// A paid mode is forwarded straight to the live tables, where a real opponent is
// actually possible, and no money is touched on the way. The reasoning for the
// arrangement this replaced is kept in docs/live-match-honesty.md, because the
// short version is easy to undo by accident: this screen once started games that
// were played entirely against a local bot while being labelled LIVE - Real Player.
  // Paid: wait briefly, then refund if no table was joined.
  //
  // There is deliberately NO way for this screen to start a live match, and the
  // reason is worth keeping in the code.
  //
  // It used to do `realFound = online >= 2` and navigate with `state: { real: true }`.
  // `online` came from useQueueCount, which counts PRESENCE on a queue channel -
  // i.e. how many browsers are sitting on this mode's screen. It says nothing
  // about being in the same match. Nothing was ever seated, no state was shared,
  // and the game itself ran entirely on the phone against the local bot. So two
  // people who happened to open the same mode at the same time each paid an
  // entry, each played a solo bot game, and each was shown "LIVE - Real Player".
  //
  // A real live match is create_live_match(code) -> join_live_match(code) ->
  // start_live_match, with the board driven by the ludo-game edge function. It
  // needs an actual seat, so it is entered from the Live tab with a room code and
  // not from here. Until that flow is wired up, the honest answer for a paid mode
  // is: no opponent, refund.

  const cancelRefund = () => {
    if (!m) return
    unlockEntry(m.entryMinor, `Refund · ${t(m.nameKey as any)} (no opponent)`)
    toast(lang === 'bn' ? 'রিফান্ড হয়ে গেছে ✓' : 'Refunded ✓', 'ok')
    nav(-1)
  }

  if (!m) { nav('/'); return null }
  if (phase === 'matching') {
    return (
      <div className="app-frame flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-8 text-center text-white"
        style={{ background: m.game === 'chess' ? 'linear-gradient(160deg,#0A6B41,#083D26)' : 'linear-gradient(160deg,#0F1E3D,#16264A)' }}>
        <div className="text-7xl animate-pulse">{m.game === 'chess' ? '♘' : '🎲'}</div>
        <Spinner className="h-8 w-8" />
        <p className="font-semibold">{isFree ? t('match.findingOpponent') : (lang === 'bn' ? 'Live টেবিল দরকার' : 'A Live table is required')}</p>
        <p className="text-xs text-white/70 tnum">{isFree ? (lang === 'bn' ? 'ফ্রি ম্যাচ — বটের সাথে' : 'Free match — vs bot') : (lang === 'bn' ? 'রিয়েল ম্যাচের জন্য Live ট্যাবে রুম কোড দিন' : 'For a real opponent, join a table in the Live tab with a room code')}</p>
        {!isFree && (
          <div className="w-full space-y-2 rounded-2xl p-4" style={{ background: 'rgba(0,0,0,.3)' }}>
            <p className="text-xs text-white/80">
              {waited
                ? (lang === 'bn' ? 'এই মোডে রিয়েল-প্লেয়ার ম্যাচ এখানে শুরু হয় না। আপনার টাকা ফেরত নিন।' : 'Real-player matches for this mode are not started from here. Take your entry back.')
                : (lang === 'bn' ? 'খুঁজছি…' : 'Checking…')}
            </p>
            {waited && (
              <>
                <button onClick={cancelRefund} className="btn-primary w-full">{lang === 'bn' ? 'রিফান্ড নিন' : 'Refund & Back'}</button>
                <button onClick={() => nav('/live')} className="btn-ghost w-full">{lang === 'bn' ? 'Live টেবিল খুলুন' : 'Open a Live table'}</button>
              </>
            )}
          </div>
        )}
        {isFree && <div className="flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />)}</div>}
      </div>
    )
  }

  return (
    <div className="app-frame flex min-h-[100dvh] flex-col justify-end" style={{ background: 'rgba(15,30,61,.5)' }}>
      <div className="rounded-t-sheet p-5 pb-8 animate-slide-up" style={{ background: 'var(--surface)' }}>
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full" style={{ background: 'var(--line)' }} />
        <h2 className="text-lg font-extrabold mb-1">{t('match.confirmJoin')}</h2>
        <p className="text-sm text-muted mb-4">{t(m.nameKey as any)} · {lang === 'bn' ? m.desc.bn : m.desc.en}</p>

        <div className="space-y-2 mb-4">
          {[
            [t('common.entry'), fmt(m.entryMinor)],
            [t('common.prize'), fmt(m.prizeMinor)],
            [t('wallet.available'), fmt(available)],
            [t('match.slots'), `1/${m.players}`],
            ...(m.clock ? [['Clock', m.clock] as [string, string]] : []),
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm"><span className="text-muted">{k}</span><span className="font-bold">{v}</span></div>
          ))}
        </div>

        <div className="rounded-lg p-3 mb-4 text-xs text-muted" style={{ background: 'var(--bg)' }}>
          <b>{t('common.rules')}:</b> {t('match.refundNote')}
        </div>

        {insufficient ? (
          <button onClick={() => nav('/wallet')} className="btn-success w-full">{t('home.addMoney')} · {t('match.insufficient')}</button>
        ) : (
          <button onClick={join} className="btn-primary w-full">{fmt(m.entryMinor)} {t('match.joinWith')}</button>
        )}
        <button onClick={() => nav(-1)} className="btn-ghost w-full mt-2">{t('common.cancel')}</button>
      </div>
    </div>
  )
}
