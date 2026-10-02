import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useT, useI18n } from '../../i18n'
import { modeById } from '../../lib/catalog'
import { fmt } from '../../lib/money'
import { useStore } from '../../lib/store'
import { rateLimit } from '../../lib/ratelimit'
import { Spinner, useToast } from '../../ui/components'
import { useQueueCount, pingQueueReady } from '../../lib/realtime'

export default function ConfirmJoin() {
  const { modeId } = useParams()
  const m = modeById(modeId!)
  const t = useT()
  const { lang } = useI18n()
  const nav = useNavigate()
  const toast = useToast()
  const available = useStore((s) => s.availableMinor)
  const lockEntry = useStore((s) => s.lockEntry)
  const unlockEntry = useStore((s) => s.unlockEntry)
  const [phase, setPhase] = useState<'confirm' | 'matching'>('confirm')
  const [waited, setWaited] = useState(false)
  const online = useQueueCount(modeId ?? '')

  const insufficient = !m || available < m.entryMinor
  const isFree = !m || m.entryMinor === 0
  const realFound = online >= 2

  const go = (real: boolean) => { if (m) nav(`/play/${m.game}/${m.id}`, { replace: true, state: { real } }) }

  const join = () => {
    if (!m) return
    // anti-spam guard: block rapid repeat joins (double-charge / abuse protection)
    if (!rateLimit('join', 6, 60000)) { toast(lang === 'bn' ? 'একটু ধীরে — আবার চেষ্টা করুন' : 'Slow down — try again shortly', 'err'); return }
    if (insufficient) { toast(t('match.insufficient'), 'err'); return }
    if (m.entryMinor > 0 && !lockEntry(m.entryMinor, `Entry · ${t(m.nameKey as any)}`)) { toast(t('match.insufficient'), 'err'); return }
    setPhase('matching')
    setWaited(false)
    pingQueueReady(m.id)
    // free practice = instant bot game; paid = wait for real player, else choice
    if (isFree) setTimeout(() => go(false), 1200)
  }

  // Paid: wait for a real player, and if nobody comes, refund.
  //
  // There used to be a "Play vs Bot" button here for paid modes. It was a trap:
  // the entry was already locked, the game ran entirely on the phone, and the
  // server was never told the match existed - so the entry stayed locked and,
  // before settle_match was revoked, could even be claimed as a prize. Paid means
  // a real opponent or your money back. The bot stays on free modes.
  useEffect(() => {
    if (phase !== 'matching' || isFree) return
    if (realFound) { const id = setTimeout(() => go(true), 1200); return () => clearTimeout(id) }
    const id = setTimeout(() => setWaited(true), 10000)
    return () => clearTimeout(id)
  }, [phase, isFree, realFound]) // eslint-disable-line

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
        <p className="font-semibold">{t('match.findingOpponent')}</p>
        <p className="text-xs text-white/70 tnum">{online} online · {isFree ? (lang === 'bn' ? 'ফ্রি ম্যাচ — বটের সাথে' : 'Free match — vs bot') : realFound ? (lang === 'bn' ? 'আসল প্লেয়ার মিলেছে ✓' : 'Real player found ✓') : (lang === 'bn' ? 'আসল প্লেয়ারের অপেক্ষা…' : 'Waiting for real player…')}</p>
        {!isFree && waited && !realFound && (
          <div className="w-full space-y-2 rounded-2xl p-4" style={{ background: 'rgba(0,0,0,.3)' }}>
            <p className="text-xs text-white/80">{lang === 'bn' ? 'কেউ আসেনি। আপনার টাকা ফেরত নিন।' : 'No one joined. Take your entry back.'}</p>
            <button onClick={cancelRefund} className="btn-primary w-full">{lang === 'bn' ? 'রিফান্ড নিন' : 'Refund & Back'}</button>
          </div>
        )}
        <div className="flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />)}</div>
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
