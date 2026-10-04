import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Chess, type Square } from 'chess.js'
import { useT, useI18n } from '../../i18n'
import { useToast } from '../../ui/components'
import { modeById, hasLiveOpponent } from '../../lib/catalog'
import { useStore, type Outcome } from '../../lib/store'
import { GameHeader, VoiceButton, ExitModal, ResultModal } from '../game/GameShell'
import { MatchChat } from '../game/MatchChat'

// filled glyphs for BOTH colors — outline glyphs render hollow/ugly in browsers
const PIECE: Record<string, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚', P: '♟', N: '♞', B: '♝', R: '♜', Q: '♛', K: '♚' }
const PIECE_FONT = '"Segoe UI Symbol","Noto Sans Symbols 2","DejaVu Sans","Arial Unicode MS",sans-serif'
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const fmtClock = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

export default function ChessGame() {
  const { modeId } = useParams()
  const m = modeById(modeId!)
  const t = useT()

  const { lang } = useI18n()
  const nav = useNavigate()
  const settle = useStore((s) => s.settle)
  const toast = useToast()
  // A paid mode reached without a real match id is not a game, it is a free win:
  // the local settle() below credits this mode's real prize with no entry ever
  // debited, and a deep link is all it takes. LudoGame got this guard when the same
  // hole was found there; chess, guti and dice were left behind and reachable the
  // same way. Only ludo has a live engine, so only ludo has anywhere to go.
  const blockedNoMatch = !!m && m.entryMinor > 0 && !m.practice && !hasLiveOpponent(m.game)
  useEffect(() => {
    if (!blockedNoMatch) return
    toast(lang === 'bn' ? 'এই গেমটা এখনো লাইভ নেই' : 'This game is not live yet', 'err')
    nav('/', { replace: true })
  }, [blockedNoMatch, toast, nav])

  const username = useStore((s) => s.username) || t('common.guest')

  const game = useRef(new Chess())
  const [fen, setFen] = useState(game.current.fen())
  const [sel, setSel] = useState<Square | null>(null)
  const [targets, setTargets] = useState<Square[]>([])
  const [wClock, setWClock] = useState(5 * 60000)
  const [bClock, setBClock] = useState(5 * 60000)
  const [result, setResult] = useState<Outcome | null>(null)
  const [subtitle, setSubtitle] = useState<string>()
  const [lastSq, setLastSq] = useState<Square[]>([])
  const oppName = t('game.bot')
  const settled = useRef(false)
  const inc = 3000

  const board = useMemo(() => game.current.board(), [fen])
  const myTurn = game.current.turn() === 'w' && !result

  const finish = (outcome: Outcome, sub?: string) => {
    if (settled.current) return
    settled.current = true
    setSubtitle(sub)
    settle({ game: 'chess', mode: t(m!.nameKey as any), modeId: m!.id, entryMinor: m!.entryMinor, prizeMinor: m!.prizeMinor, outcome, deltaMinor: outcome === 'win' ? m!.prizeMinor - m!.entryMinor : outcome === 'loss' ? -m!.entryMinor : 0, moves: Math.ceil(game.current.history().length / 2) })
    setTimeout(() => setResult(outcome), 700)
  }

  const checkEnd = () => {
    const g = game.current
    if (g.isCheckmate()) return finish(g.turn() === 'w' ? 'loss' : 'win', g.turn() === 'w' ? 'Checkmate' : 'Checkmate!')
    if (g.isDraw() || g.isStalemate() || g.isThreefoldRepetition()) return finish('draw', t('result.drawConsent'))
  }

  // clocks
  useEffect(() => {
    if (result) return
    const id = setInterval(() => {
      if (game.current.turn() === 'w') setWClock((c) => { if (c <= 100) { finish('loss', t('result.timeout')); return 0 } return c - 100 })
      else setBClock((c) => { if (c <= 100) { finish('win', t('result.timeout')); return 0 } return c - 100 })
    }, 100)
    return () => clearInterval(id)
  }, [result]) // eslint-disable-line

  // bot move (random legal)
  useEffect(() => {
    if (game.current.turn() !== 'b' || result) return
    const id = setTimeout(() => {
      const moves = game.current.moves({ verbose: true })
      if (!moves.length) { checkEnd(); return }
      const mv = moves[Math.floor(Math.random() * moves.length)]
      game.current.move(mv)
      setBClock((c) => c + inc)
      setLastSq([mv.from, mv.to])
      setFen(game.current.fen())
      checkEnd()
    }, 800)
    return () => clearTimeout(id)
  }, [fen, result]) // eslint-disable-line

  const tap = (sq: Square, piece: { type: string; color: string } | null) => {
    if (!myTurn) return
    if (sel && targets.includes(sq)) {
      game.current.move({ from: sel, to: sq, promotion: 'q' })
      setWClock((c) => c + inc)
      setLastSq([sel, sq])
      setSel(null); setTargets([]); setFen(game.current.fen()); checkEnd()
      return
    }
    if (piece && piece.color === 'w') {
      setSel(sq)
      setTargets(game.current.moves({ square: sq, verbose: true }).map((mv: any) => mv.to))
    } else { setSel(null); setTargets([]) }
  }

  return (
    <div className="app-frame flex min-h-[100dvh] flex-col" style={{ background: 'linear-gradient(160deg,#0A6B41,#083D26)' }}>
      <GameHeader title={`Daba · ${m!.clock}`} prizeMinor={m!.prizeMinor}
        extra={<><button onClick={() => { if (confirm('Offer draw?')) finish('draw', t('result.drawConsent')) }} className="text-lg" aria-label="draw">🤝</button><VoiceButton /></>} gameType="chess" />

      <div className="flex items-center justify-between px-4 py-2 text-white">
        <div className="flex items-center gap-2"><span className="text-lg">{'\u{1F916}'}</span><span className="text-sm font-bold">{oppName}</span></div>
        <span className={`chip font-mono ${game.current.turn() === 'b' && !result ? 'bg-danger' : 'bg-black/30'} text-white`}>{fmtClock(bClock)}</span>
      </div>

      <div className="flex-1 flex items-center justify-center px-3">
        <div className="w-full max-w-[360px] rounded-[16px] p-[7px]" style={{ background: 'linear-gradient(160deg,#7A5230,#4A2E14)', border: '2px solid #33200C', boxShadow: '0 18px 44px -16px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.25)' }}>
          <div className="grid w-full aspect-square grid-cols-8 overflow-hidden rounded-[6px]" style={{ gridTemplateRows: 'repeat(8, minmax(0,1fr))', border: '1px solid #2A1A0A' }}>
            {board.map((row, r) =>
              row.map((cell, c) => {
                const sq = (FILES[c] + (8 - r)) as Square
                const dark = (r + c) % 2 === 1
                const isSel = sel === sq
                const isTarget = targets.includes(sq)
                const isLast = lastSq.includes(sq)
                const isWhite = cell?.color === 'w'
                return (
                  <button key={sq} onClick={() => tap(sq, cell)} className="relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden leading-none"
                    style={{ background: isSel ? '#F5B301' : isLast ? (dark ? '#C9A227' : '#F0D060') : dark ? '#7A4E2D' : '#EDD6A8', fontSize: 'clamp(22px, 8vw, 33px)' }}>
                    {cell && <span style={isWhite
                      ? { color: '#FFFFFF', WebkitTextStroke: '1.7px #20202A', textShadow: '0 2px 3px rgba(0,0,0,.6)', paintOrder: 'stroke fill' as any, fontFamily: PIECE_FONT }
                      : { color: '#16161C', WebkitTextStroke: '1.1px rgba(255,255,255,.72)', textShadow: '0 2px 3px rgba(0,0,0,.5)', paintOrder: 'stroke fill' as any, fontFamily: PIECE_FONT }}>{PIECE[isWhite ? cell.type.toUpperCase() : cell.type]}</span>}
                    {isTarget && !cell && <span className="absolute h-3.5 w-3.5 rounded-full" style={{ background: 'rgba(18,183,106,.9)', boxShadow: '0 0 0 2px rgba(255,255,255,.7)' }} />}
                    {isTarget && cell && <span className="absolute inset-[6%] rounded-full" style={{ border: '3px solid rgba(226,59,73,.9)' }} />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-2 text-white">
        <div className="flex items-center gap-2"><span className="text-lg">👤</span><span className="text-sm font-bold">{username}</span>{game.current.inCheck() && myTurn && <span className="chip bg-danger text-white text-xs">Check!</span>}</div>
        <span className={`chip font-mono ${myTurn ? 'bg-emerald2' : 'bg-black/30'} text-white`}>{fmtClock(wClock)}</span>
      </div>

      <div className="px-3 pb-3 flex gap-2">
        <button onClick={() => finish('loss', 'Resigned')} className="btn-danger flex-1 py-2 text-sm">Resign</button>
        <MatchChat opponentName={oppName} roomId={modeId ?? m!.id} />
      </div>

      <ExitModal onLeave={() => nav('/')} />
      <ResultModal outcome={result} subtitle={subtitle} deltaMinor={result === 'win' ? m!.prizeMinor - m!.entryMinor : result === 'loss' ? -m!.entryMinor : 0} moves={Math.ceil(game.current.history().length / 2)} />
    </div>
  )
}
