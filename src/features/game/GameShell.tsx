import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, X, Volume2, VolumeX, Mic, MicOff, Trophy, Frown, Handshake, Ban, AlertTriangle, HelpCircle } from 'lucide-react'
import { useT } from '../../i18n'
import { Modal, useToast } from '../../ui/components'
import { fmt } from '../../lib/money'
import { useVoiceRoom } from '../../lib/realtime'
import type { Outcome } from '../../lib/store'

const iconBtn = 'grid h-9 w-9 place-items-center rounded-full text-white/90 active:scale-90 transition'

export function GameHeader({ title, prizeMinor, extra, gameType }: { title: string; prizeMinor: number; extra?: ReactNode; gameType?: string }) {
  const [muted, setMuted] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const t = useT()

  return (
    <div className="flex items-center gap-1.5 px-3 py-2.5 text-white"
      style={{ background: 'rgba(0,0,0,.28)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
      <button onClick={() => window.dispatchEvent(new CustomEvent('game-exit'))} aria-label="back" className={iconBtn} style={{ background: 'rgba(255,255,255,.08)' }}>
        <ChevronLeft className="h-5 w-5" />
      </button>
      <span className="font-display font-bold text-sm">{title}</span>
      <span className="chip tnum ml-1" style={{ backgroundImage: 'var(--grad-gold)', color: '#2A1D00' }}>
        <Trophy className="h-3.5 w-3.5" strokeWidth={2.4} /> {fmt(prizeMinor)}
      </span>
      <div className="flex-1" />
      {extra}
      <button onClick={() => setGuideOpen(true)} aria-label="guide" className={iconBtn} style={{ background: 'rgba(255,255,255,.08)' }}>
        <HelpCircle className="h-[18px] w-[18px]" />
      </button>
      <button onClick={() => setMuted((m) => !m)} aria-label="sound" className={iconBtn} style={{ background: 'rgba(255,255,255,.08)' }}>
        {muted ? <VolumeX className="h-[18px] w-[18px]" /> : <Volume2 className="h-[18px] w-[18px]" />}
      </button>
      {/* The report button used to call toast('Reported') and nothing else - it sent
          nothing anywhere and told the player it had. A control that reports a
          report it never filed is worse than no control, so it is gone until
          there is a real endpoint behind it. */}
      <button onClick={() => window.dispatchEvent(new CustomEvent('game-exit'))} aria-label="exit" className={iconBtn} style={{ background: 'rgba(255,255,255,.08)' }}>
        <X className="h-[18px] w-[18px]" />
      </button>

      {/* Guide Modal */}
      <Modal open={guideOpen} onClose={() => setGuideOpen(false)}>
        <div className="text-left max-w-[360px]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-lg font-extrabold">{gameType === 'ludo' ? t('guide.ludoTitle') : gameType === 'chess' ? t('guide.chessTitle') : gameType === 'guti' ? t('guide.gutiTitle') : gameType === 'dice' ? t('guide.diceTitle') : t('guide.title')}</h3>
            <button onClick={() => setGuideOpen(false)} className="grid h-8 w-8 place-items-center rounded-full text-muted active:scale-90" style={{ background: 'var(--glass)' }}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="prose text-sm text-white/90 leading-relaxed whitespace-pre-line max-h-[60vh] overflow-y-auto pr-2">
            {gameType === 'ludo' ? t('guide.ludo') : gameType === 'chess' ? t('guide.chess') : gameType === 'guti' ? t('guide.guti') : gameType === 'dice' ? t('guide.dice') : t('guide.ludo')}
          </div>
          <div className="mt-4 text-center">
            <button onClick={() => setGuideOpen(false)} className="btn-primary w-full">{t('guide.close')}</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/**
 * Mic + peer-to-peer voice.
 *
 * `roomId` MUST be a per-match id. Passing a mode id here is a privacy bug, and
 * it was one: every player of that mode shared the channel, so turning the mic on
 * in a bot game broadcast you to every stranger playing that mode, and you were
 * connected to all of them rather than to your opponent. With no roomId the mic
 * still works as a local meter and simply finds no peers.
 *
 * Pass the live match id once real matches exist (see supabase/003_ludo_engine.sql).
 */
export function VoiceButton({ roomId }: { roomId?: string }) {
  const t = useT()
  const toast = useToast()
  const { on, level, toggle, peerCount, live } = useVoiceRoom(roomId ?? null)
  const click = async () => {
    const wasOn = on
    const err = await toggle()
    if (wasOn) return
    if (err === 'mic-denied') toast(t('voice.micDenied'), 'err')
    else if (err === 'insecure') toast(t('voice.insecure'), 'err')
    else if (err === 'mic-unsupported') toast(t('voice.micMissing'), 'err')
    // NOT "voice live". At this point only the microphone has opened - no peer
    // has connected yet, and on a restrictive network none ever may. Saying
    // "live" here made a dead mic look like a working call.
    else if (!err) toast(roomId ? 'Mic on — waiting for the other player' : 'Mic on', 'ok')
  }
  // three states, not two: off / mic open but nobody connected / actually connected
  const tint = !on ? 'rgba(255,255,255,.08)' : live ? 'var(--emerald)' : '#B45309'
  return (
    <button onClick={click} aria-label="mic" className={`${iconBtn} relative ${live ? 'animate-pulse-ring' : ''}`}
      title={!on ? 'Voice off' : live ? `Connected (${peerCount})` : 'Mic on — not connected to anyone yet'}
      style={{ background: tint }}>
      {on ? <Mic className="h-[18px] w-[18px]" /> : <MicOff className="h-[18px] w-[18px]" />}
      {on && (
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-1 rounded-full bg-white/90" style={{ width: `${Math.round(8 + level * 24)}px` }} />
      )}
      {/* a mic that is on but connected to nobody must not look like a live call */}
      {on && !live && (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full" style={{ background: '#F59E0B' }} />
      )}
    </button>
  )
}

export function ExitModal({ onLeave }: { onLeave: () => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const h = () => setOpen(true)
    window.addEventListener('game-exit', h)
    // browser back guard
    history.pushState(null, '', location.href)
    const pop = () => { setOpen(true); history.pushState(null, '', location.href) }
    window.addEventListener('popstate', pop)
    return () => { window.removeEventListener('game-exit', h); window.removeEventListener('popstate', pop) }
  }, [])
  return (
    <Modal open={open} onClose={() => setOpen(false)}>
      <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl text-danger" style={{ background: 'rgba(255,92,105,.14)' }}>
        <AlertTriangle className="h-7 w-7" strokeWidth={2} />
      </div>
      <h3 className="font-display text-lg font-extrabold mb-1">{t('exit.title')}</h3>
      <p className="text-sm text-muted mb-4">{t('exit.warn')}</p>
      <div className="flex gap-2">
        <button className="btn-primary flex-1" onClick={() => setOpen(false)}>{t('exit.stay')}</button>
        <button className="btn-navy flex-1" onClick={() => { setOpen(false); onLeave() }}>{t('exit.leave')}</button>
      </div>
    </Modal>
  )
}

const RESULT_META: Record<Outcome, { Icon: typeof Trophy; key: any; grad: string; glow: string }> = {
  win: { Icon: Trophy, key: 'result.win', grad: 'var(--grad-gold)', glow: 'var(--glow-gold)' },
  loss: { Icon: Frown, key: 'result.loss', grad: 'linear-gradient(135deg,#64748B,#475569)', glow: 'none' },
  draw: { Icon: Handshake, key: 'result.draw', grad: 'var(--grad)', glow: 'var(--glow)' },
  cancelled: { Icon: Ban, key: 'result.cancelled', grad: 'linear-gradient(135deg,#64748B,#475569)', glow: 'none' },
}

export function ResultModal({ outcome, deltaMinor, subtitle, moves }: { outcome: Outcome | null; deltaMinor: number; subtitle?: string; moves?: number }) {
  const t = useT()
  const nav = useNavigate()
  if (!outcome) return null
  const meta = RESULT_META[outcome]
  return (
    <Modal open>
      <div className="text-center">
        <div className="mx-auto mb-3 grid h-20 w-20 place-items-center rounded-full text-white" style={{ backgroundImage: meta.grad, boxShadow: meta.glow }}>
          <meta.Icon className="h-10 w-10" strokeWidth={2} />
        </div>
        <h3 className="font-display text-2xl font-extrabold">{t(meta.key)}</h3>
        {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
        {deltaMinor !== 0 && (
          <div className={`mt-3 text-3xl font-extrabold tnum ${deltaMinor > 0 ? 'text-emerald2' : 'text-danger'}`}>
            {deltaMinor > 0 ? '+' : ''}{fmt(deltaMinor)}
          </div>
        )}
        {typeof moves === 'number' && <p className="text-xs text-muted mt-1">{t('result.moves')}: {moves}</p>}
        <div className="flex gap-2 mt-6">
          <button className="btn-ghost flex-1" onClick={() => nav('/matches')}>{t('result.viewMatches')}</button>
          <button className="btn-primary flex-1" onClick={() => nav('/')}>{t('common.home')}</button>
        </div>
      </div>
    </Modal>
  )
}
