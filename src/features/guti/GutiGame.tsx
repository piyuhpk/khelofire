import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useT } from '../../i18n'
import { modeById } from '../../lib/catalog'
import { useStore, type Outcome } from '../../lib/store'
import { GameHeader, VoiceButton, ExitModal, ResultModal } from '../game/GameShell'
import { MatchChat } from '../game/MatchChat'
import { initialBoard, legalMoves, applyMove, captureContinuations, count, botTurn, edges, rc, type Move, type Cell } from './gutiEngine'

const NODES = Array.from({ length: 25 }, (_, i) => { const [r, c] = rc(i); return { x: 10 + c * 20, y: 10 + r * 20 } })
const EDGES = edges()

export default function GutiGame() {
  const { modeId } = useParams()
  const m = modeById(modeId!)
  const t = useT()
  const nav = useNavigate()
  const settle = useStore((s) => s.settle)
  const username = useStore((s) => s.username) || t('common.guest')

  const [board, setBoard] = useState<Cell[]>(() => initialBoard())
  const [turn, setTurn] = useState<Cell>(1)
  const [sel, setSel] = useState<number | null>(null)
  const [targets, setTargets] = useState<Move[]>([])
  const [chain, setChain] = useState(false)
  const [result, setResult] = useState<Outcome | null>(null)
  const settled = useRef(false)
  const loc = useLocation()
  const isReal = (loc.state as any)?.real === true
  const oppName = isReal ? 'Live Player' : t('game.bot')
  const delta = result === 'win' ? m!.prizeMinor - m!.entryMinor : result === 'loss' ? -m!.entryMinor : 0

  const finish = (outcome: Outcome) => {
    if (settled.current) return
    settled.current = true
    settle({ game: 'guti', mode: t(m!.nameKey as any), entryMinor: m!.entryMinor, prizeMinor: m!.prizeMinor, outcome, deltaMinor: outcome === 'win' ? m!.prizeMinor - m!.entryMinor : outcome === 'loss' ? -m!.entryMinor : 0 })
    setTimeout(() => setResult(outcome), 700)
  }

  const legal = turn === 1 && !result ? legalMoves(board, 1) : []

  const endPlayerTurn = (nb: Cell[]) => {
    setSel(null); setTargets([]); setChain(false)
    if (count(nb, 2) === 0 || legalMoves(nb, 2).length === 0) return finish('win')
    setTurn(2)
  }
  const doMove = (mv: Move) => {
    const nb = applyMove(board, mv)
    setBoard(nb)
    if (mv.capture !== undefined) {
      const cont = captureContinuations(nb, mv.to)
      if (cont.length) { setSel(mv.to); setTargets(cont); setChain(true); return }
    }
    endPlayerTurn(nb)
  }

  const tap = (i: number) => {
    if (turn !== 1 || result) return
    const hit = targets.find((mv) => mv.to === i)
    if (sel !== null && hit) return doMove(hit)
    if (chain) return
    if (board[i] === 1) {
      const mine = legal.filter((mv) => mv.from === i)
      if (mine.length) { setSel(i); setTargets(mine) } else { setSel(null); setTargets([]) }
    } else { setSel(null); setTargets([]) }
  }

  useEffect(() => {
    if (turn !== 2 || result) return
    const id = setTimeout(() => {
      const nb = botTurn(board, Math.random)
      setBoard(nb)
      if (count(nb, 1) === 0 || legalMoves(nb, 1).length === 0) return finish('loss')
      setTurn(1)
    }, 650)
    return () => clearTimeout(id)
  }, [turn, result]) // eslint-disable-line

  const targetSet = new Set(targets.map((mv) => mv.to))
  const movableSet = new Set(legal.map((mv) => mv.from))
  const mustCapture = legal.some((mv) => mv.capture !== undefined)
  const myLeft = count(board, 1), botLeft = count(board, 2)
  return (
    <div className="app-frame flex min-h-[100dvh] flex-col" style={{ background: 'radial-gradient(120% 80% at 50% -10%,#5B0F2E 0%,#2A0A24 55%,#12061A 100%)' }}>
      <GameHeader title={t('home.guti')} prizeMinor={m!.prizeMinor} extra={<VoiceButton roomId={modeId ?? m!.id} />} gameType="guti" />

      <div className="flex items-center justify-between px-5 py-2.5 text-white">
        <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-full text-base" style={{ background: 'rgba(255,92,105,.2)' }}>{isReal ? '🟢' : '🤖'}</span><span className="text-sm font-bold">{oppName}</span>{isReal && <span className="chip bg-danger text-white text-[10px] font-extrabold">LIVE</span>}</div>
        <span className="chip text-white" style={{ background: turn === 2 && !result ? 'var(--danger)' : 'rgba(255,255,255,.1)' }}>{botLeft} {t('guti.pieces')}</span>
      </div>

      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-[340px] rounded-2xl p-3" style={{ background: 'linear-gradient(150deg,#FFF8E6,#F0DFB8)', border: '5px solid #8B5A2B', boxShadow: '0 18px 44px -18px rgba(0,0,0,.65), inset 0 0 0 2px rgba(255,255,255,.6)' }}>
          <svg viewBox="-4 -4 108 108" className="w-full">
            <defs>
              <radialGradient id="gp" cx="35%" cy="30%" r="75%"><stop offset="0%" stopColor="#FFFFFF" /><stop offset="45%" stopColor="#8B5CFF" /><stop offset="100%" stopColor="#4C1D95" /></radialGradient>
              <radialGradient id="gb" cx="35%" cy="30%" r="75%"><stop offset="0%" stopColor="#FFFFFF" /><stop offset="45%" stopColor="#FF4D6D" /><stop offset="100%" stopColor="#9F1239" /></radialGradient>
            </defs>
            {EDGES.map(([a, b], k) => <line key={k} x1={NODES[a].x} y1={NODES[a].y} x2={NODES[b].x} y2={NODES[b].y} stroke="#8B5A2B" strokeWidth={1.1} strokeLinecap="round" opacity={0.85} />)}
            {NODES.map((p, i) => (
              <g key={i} onClick={() => tap(i)} style={{ cursor: 'pointer' }}>
                <circle cx={p.x} cy={p.y} r={2.6} fill="#8B5A2B" opacity={0.9} />
                {targetSet.has(i) && <circle cx={p.x} cy={p.y} r={5.5} fill="#FFD466" opacity={0.95} className="animate-pulse" stroke="#8B5A2B" strokeWidth={1} />}
                {board[i] !== 0 && <circle cx={p.x} cy={p.y} r={8} fill={board[i] === 1 ? 'url(#gp)' : 'url(#gb)'} stroke={sel === i ? '#FFD466' : '#fff'} strokeWidth={sel === i ? 2.2 : 1.4} style={{ filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.5))' }} />}
                {/* movable-piece hint */}
                {board[i] === 1 && turn === 1 && !chain && movableSet.has(i) && sel !== i && (
                  <circle cx={p.x} cy={p.y} r={10.5} fill="none" stroke="#22D3EE" strokeWidth={1.4} strokeDasharray="3 3" className="animate-pulse" />
                )}
                <circle cx={p.x} cy={p.y} r={10} fill="transparent" />
              </g>
            ))}
          </svg>
        </div>
      </div>

      <div className="flex items-center justify-between px-5 py-2.5 text-white">
        <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-full text-base" style={{ background: 'rgba(139,92,255,.25)' }}>👤</span><span className="text-sm font-bold">{username}</span></div>
        <span className="chip text-white" style={{ background: turn === 1 && !result ? 'var(--emerald)' : 'rgba(255,255,255,.1)' }}>{myLeft} {t('guti.pieces')}</span>
      </div>

      <div className="px-4 pb-1 text-center text-sm font-semibold" style={{ color: turn === 1 ? 'var(--gold)' : 'rgba(255,255,255,.6)' }}>
        {result ? '' : turn === 1 ? (mustCapture && !chain ? `⚔️ ${t('guti.captureRequired')}` : t('guti.yourTurn')) : t('guti.botTurn')}
      </div>

      <div className="px-3 pb-3 pt-2 flex gap-2">
        <button onClick={() => finish('loss')} className="btn-danger flex-1 py-2 text-sm">{t('game.resign')}</button>
        <MatchChat opponentName={oppName} roomId={modeId ?? m!.id} />
      </div>

      <ExitModal onLeave={() => nav('/')} />
      <ResultModal outcome={result} deltaMinor={delta} moves={myLeft} />
    </div>
  )
}
