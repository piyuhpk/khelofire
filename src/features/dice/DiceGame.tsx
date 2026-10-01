import { useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useT } from '../../i18n'
import { modeById } from '../../lib/catalog'
import { useStore, type Outcome } from '../../lib/store'
import { GameHeader, VoiceButton, ExitModal, ResultModal } from '../game/GameShell'
import { MatchChat } from '../game/MatchChat'

const ROUNDS = 5
// pip layout on a 3x3 grid [row,col]
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
}

function Die({ face, spinning, mine }: { face: number; spinning?: boolean; mine?: boolean }) {
  return (
    <div className={`relative grid h-[84px] w-[84px] place-items-center rounded-2xl ${spinning ? 'animate-dice-tumble' : ''}`}
      style={{
        background: mine
          ? 'linear-gradient(145deg,#FF3B47 0%,#E11D24 45%,#9F0F16 100%)'
          : 'linear-gradient(145deg,#2B3A55 0%,#1B2437 55%,#0E1524 100%)',
        border: '3px solid rgba(255,255,255,.9)',
        boxShadow: `0 12px 26px -8px ${mine ? 'rgba(225,29,36,.75)' : 'rgba(10,20,40,.8)'}, inset 0 -5px 9px rgba(0,0,0,.4), inset 0 4px 7px rgba(255,255,255,.32)`,
      }}>
      <div className="grid h-[60px] w-[60px] grid-cols-3 grid-rows-3 gap-1">
        {Array.from({ length: 9 }).map((_, k) => {
          const on = PIPS[face].some(([r, c]) => r * 3 + c === k)
          return <span key={k} className="place-self-center rounded-full" style={{ height: on ? 13 : 0, width: on ? 13 : 0, background: 'radial-gradient(circle at 35% 30%,#FFFFFF,#E4E4E4)', boxShadow: '0 1px 2px rgba(0,0,0,.5)' }} />
        })}
      </div>
    </div>
  )
}

export default function DiceGame() {
  const { modeId } = useParams()
  const m = modeById(modeId!)
  const t = useT()
  const nav = useNavigate()
  const settle = useStore((s) => s.settle)
  const username = useStore((s) => s.username) || t('common.guest')

  const [round, setRound] = useState(1)
  const [myScore, setMyScore] = useState(0)
  const [botScore, setBotScore] = useState(0)
  const [myFace, setMyFace] = useState(1)
  const [botFace, setBotFace] = useState(1)
  const [stage, setStage] = useState<'ready' | 'me' | 'bot' | 'reveal'>('ready')
  const [roundMsg, setRoundMsg] = useState<string>('')
  const [result, setResult] = useState<Outcome | null>(null)
  const settled = useRef(false)
  const loc = useLocation()
  const isReal = (loc.state as any)?.real === true
  const oppName = isReal ? 'Live Player' : t('game.bot')
  const delta = result === 'win' ? m!.prizeMinor - m!.entryMinor : result === 'loss' ? -m!.entryMinor : 0

  const finish = (outcome: Outcome, ms: number, bs: number) => {
    if (settled.current) return
    settled.current = true
    settle({ game: 'dice', mode: t(m!.nameKey as any), entryMinor: m!.entryMinor, prizeMinor: m!.prizeMinor, outcome, deltaMinor: outcome === 'win' ? m!.prizeMinor - m!.entryMinor : outcome === 'loss' ? -m!.entryMinor : 0, moves: ms + bs })
    setTimeout(() => setResult(outcome), 800)
  }

  const spin = (setFace: (n: number) => void, done: (n: number) => void) => {
    let n = 0
    const id = setInterval(() => {
      setFace(1 + Math.floor(Math.random() * 6))
      if (++n >= 9) { clearInterval(id); const f = 1 + Math.floor(Math.random() * 6); setFace(f); done(f) }
    }, 65)
  }

  const resolve = (mine: number, bot: number) => {
    const ms = myScore + (mine > bot ? 1 : 0)
    const bs = botScore + (bot > mine ? 1 : 0)
    setMyScore(ms); setBotScore(bs)
    setRoundMsg(mine > bot ? t('result.win') : bot > mine ? t('result.loss') : t('result.draw'))
    setStage('reveal')
    const clinch = ms > ROUNDS / 2 || bs > ROUNDS / 2 || round >= ROUNDS
    if (clinch) setTimeout(() => finish(ms > bs ? 'win' : bs > ms ? 'loss' : 'draw', ms, bs), 1100)
    else setTimeout(() => { setRound((r) => r + 1); setRoundMsg(''); setStage('ready') }, 1300)
  }

  const roll = () => {
    if (stage !== 'ready' || result) return
    setStage('me')
    spin(setMyFace, (mine) => {
      setStage('bot')
      setTimeout(() => spin(setBotFace, (bot) => setTimeout(() => resolve(mine, bot), 450)), 350)
    })
  }

  return (
    <div className="app-frame flex min-h-[100dvh] flex-col" style={{ background: 'radial-gradient(120% 80% at 50% -10%,#3A1D6E 0%,#1A0E3A 55%,#0A0620 100%)' }}>
      <GameHeader title="Dice Duel" prizeMinor={m!.prizeMinor} extra={<VoiceButton roomId={modeId ?? m!.id} />} gameType="dice" />

      <div className="flex items-center justify-between px-5 py-3 text-white">
        <div className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-full text-lg" style={{ background: 'rgba(255,92,105,.2)' }}>{isReal ? '🟢' : '🤖'}</span><div><div className="text-sm font-bold leading-tight">{oppName}{isReal && ' · LIVE'}</div><div className="text-[11px] text-white/60">{t('dice.score')}: {botScore}</div></div></div>
        <span className="chip tnum text-white" style={{ background: stage === 'bot' ? 'var(--danger)' : 'rgba(255,255,255,.1)' }}>{botScore}</span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-4">
        <div className="chip text-white" style={{ background: 'rgba(255,255,255,.1)' }}>{t('dice.round')} {round}/{ROUNDS}</div>
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-center gap-2"><Die face={botFace} spinning={stage === 'bot'} /><span className="text-[11px] font-semibold text-white/60">{t('game.bot')}</span></div>
          <span className="font-display text-2xl font-extrabold text-grad-gold">VS</span>
          <div className="flex flex-col items-center gap-2"><Die face={myFace} spinning={stage === 'me'} mine /><span className="text-[11px] font-semibold text-white/60">{t('game.you')}</span></div>
        </div>
        <div className="h-6 font-display text-lg font-extrabold text-white">{roundMsg}</div>
        <button onClick={roll} disabled={stage !== 'ready' || !!result} className="btn-gold px-10 py-3 text-base disabled:opacity-50">
          {stage === 'ready' ? t('dice.roll') : t('dice.rolling')}
        </button>
      </div>

      <div className="flex items-center justify-between px-5 py-3 text-white">
        <div className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-full text-lg" style={{ background: 'rgba(139,92,255,.25)' }}>👤</span><div><div className="text-sm font-bold leading-tight">{username}</div><div className="text-[11px] text-white/60">{t('dice.score')}: {myScore}</div></div></div>
        <span className="chip tnum text-white" style={{ background: stage === 'me' ? 'var(--emerald)' : 'rgba(255,255,255,.1)' }}>{myScore}</span>
      </div>

      <div className="px-3 pb-3 flex gap-2">
        <button onClick={() => finish('loss', myScore, botScore)} className="btn-danger flex-1 py-2 text-sm">{t('game.resign')}</button>
        <MatchChat opponentName={oppName} roomId={modeId ?? m!.id} />
      </div>

      <ExitModal onLeave={() => nav('/')} />
      <ResultModal outcome={result} subtitle={`${myScore} — ${botScore}`} deltaMinor={delta} moves={myScore + botScore} />
    </div>
  )
}
