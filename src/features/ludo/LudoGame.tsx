import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useT } from '../../i18n'
import { modeById } from '../../lib/catalog'
import { useStore, type Outcome } from '../../lib/store'
import { GameHeader, VoiceButton, ExitModal, ResultModal } from '../game/GameShell'
import { MatchChat } from '../game/MatchChat'
import { LudoBoard } from './LudoBoard'
import { initLudo, legalTokens, applyMove, rollDice, botChoose, nextActive, COLORS, COLOR_NAME, FINISH, type LudoState, type PlayerId } from '../../engine/ludo'

const BOT_NAMES = ['—', 'Rahim', 'Sakib', 'Tanvir']

const DICE_PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]], 5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
}

function LudoDiceFace({ value }: { value: number | null }) {
  if (value == null) return <span className="text-3xl">🎲</span>
  return (
    <span className="grid h-12 w-12 grid-cols-3 grid-rows-3 gap-[3px] rounded-[10px] p-2"
      style={{ background: 'linear-gradient(145deg,#FF3B47 0%,#E11D24 45%,#9F0F16 100%)', border: '2px solid rgba(255,255,255,.85)', boxShadow: 'inset 0 -4px 7px rgba(0,0,0,.45), inset 0 3px 5px rgba(255,255,255,.35), 0 3px 8px rgba(0,0,0,.5)' }}>
      {Array.from({ length: 9 }).map((_, k) => {
        const on = DICE_PIPS[value].some(([r, c]) => r * 3 + c === k)
        return <span key={k} className="place-self-center rounded-full" style={{ height: on ? 9 : 0, width: on ? 9 : 0, background: 'radial-gradient(circle at 35% 30%,#FFFFFF,#E8E8E8)' }} />
      })}
    </span>
  )
}

function Seat({ p, name, avatar, active, home }: { p: PlayerId; name: string; avatar: string; active: boolean; home: number }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-white px-2.5 py-1.5 transition"
      style={{ borderLeft: `6px solid ${COLORS[p]}`, boxShadow: active ? `0 0 0 2px ${COLORS[p]}, 0 6px 14px -6px rgba(0,0,0,.5)` : '0 4px 10px -6px rgba(0,0,0,.4)', opacity: active ? 1 : 0.92 }}>
      <div className="grid h-8 w-8 place-items-center rounded-full text-base text-white" style={{ background: COLORS[p], border: '2px solid #fff', boxShadow: '0 2px 4px rgba(0,0,0,.35)' }}>{avatar}</div>
      <div>
        <div className="text-[12px] font-extrabold leading-none text-slate-800">{name}</div>
        <div className="mt-1 flex gap-1">{[0, 1, 2, 3].map((k) => <span key={k} className="h-2 w-2 rounded-full" style={{ background: k < home ? COLORS[p] : '#E2E8F0', border: '1px solid rgba(0,0,0,.15)' }} />)}</div>
      </div>
      {active && <span className="ml-0.5 h-2.5 w-2.5 rounded-full bg-emerald2 animate-pulse" />}
    </div>
  )
}

export default function LudoGame() {
  const { modeId } = useParams()
  const m = modeById(modeId!)
  const t = useT()
  const nav = useNavigate()
  const settle = useStore((s) => s.settle)
  const username = useStore((s) => s.username) || t('common.guest')
  const avatar = useStore((s) => s.avatar)

  const [st, setSt] = useState<LudoState>(() => initLudo(m?.players ?? 2))
  const [legal, setLegal] = useState<number[]>([])
  const [rolling, setRolling] = useState(false)
  const [botDice, setBotDice] = useState<number | null>(null)
  const [msg, setMsg] = useState('')
  const [timer, setTimer] = useState(20)
  const [result, setResult] = useState<Outcome | null>(null)
  const settled = useRef(false)

  const yourTurn = st.turn === 0 && st.winner === null && !result
  const loc = useLocation()
  const isReal = (loc.state as any)?.real === true
  const nameFor = (p: PlayerId) => (p === 0 ? username : isReal ? `Player ${p}` : (BOT_NAMES[p] || `${COLOR_NAME[p]} Bot`))
  const avatarFor = (p: PlayerId) => (p === 0 ? avatar : isReal ? '👤' : ['👤', '🤖', '🐯', '🦊'][p])
  const homeCount = (p: PlayerId) => st.tokens[p].filter((x) => x >= FINISH).length

  // settle when someone wins
  useEffect(() => {
    if (st.winner === null || settled.current) return
    settled.current = true
    const outcome: Outcome = st.winner === 0 ? 'win' : 'loss'
    setTimeout(() => {
      settle({ game: 'ludo', mode: t(m!.nameKey as any), modeId: m!.id, entryMinor: m!.entryMinor, prizeMinor: m!.prizeMinor, outcome, deltaMinor: outcome === 'win' ? m!.prizeMinor - m!.entryMinor : -m!.entryMinor })
      setResult(outcome)
    }, 900)
  }, [st.winner]) // eslint-disable-line

  // your turn countdown
  useEffect(() => {
    if (!yourTurn || st.rolled) return
    setTimer(20)
    const id = setInterval(() => setTimer((x) => {
      if (x <= 1) { clearInterval(id); setSt((s) => ({ ...s, dice: null, rolled: false, sixes: 0, turn: nextActive(s, 0) })); return 0 }
      return x - 1
    }), 1000)
    return () => clearInterval(id)
  }, [yourTurn, st.rolled]) // eslint-disable-line

  // Bot turn.
  //
  // This must commit in ONE state update. It used to be split across two
  // timeouts: the first one set dice/rolled, which changed the deps below, so
  // React ran this effect's cleanup (setting alive = false) and then the
  // second timeout saw !alive and returned. The bot showed its die and never
  // moved, leaving state { rolled: true, turn: bot } that nothing could advance
  // - the board froze forever after the player's move. One timer, one update.
  useEffect(() => {
    const p = st.turn
    if (result || st.winner !== null || p === 0 || st.rolled || st.dice !== null) return
    let alive = true
    const id = setTimeout(() => {
      if (!alive) return
      const d = rollDice()
      if (d === 6 && st.sixes >= 2) {
        setBotDice(d)
        setSt((s) => ({ ...s, dice: null, rolled: false, sixes: 0, turn: nextActive(s, p) }))
        return
      }
      const cur: LudoState = { ...st, dice: d, rolled: true, sixes: d === 6 ? st.sixes + 1 : st.sixes }
      const choice = botChoose(cur, p, d)
      setBotDice(d)
      if (choice === null) {
        setSt((s) => ({ ...s, dice: null, rolled: false, sixes: 0, turn: nextActive(s, p) }))
        return
      }
      setSt(applyMove(cur, p, choice, d).state)
    }, 900)
    return () => { alive = false; clearTimeout(id) }
  }, [st, result]) // eslint-disable-line

  const pendingPass = useRef<number | null>(null)
  // the "no legal move, pass the turn" timer must not outlive the match,
  // otherwise it flips the turn after resign or after the result modal
  useEffect(() => {
    if (result && pendingPass.current !== null) {
      clearTimeout(pendingPass.current)
      pendingPass.current = null
    }
  }, [result])
  useEffect(() => () => { if (pendingPass.current !== null) clearTimeout(pendingPass.current) }, [])

  const roll = () => {
    if (!yourTurn || rolling || st.rolled) return
    setRolling(true)
    const d = rollDice()
    setTimeout(() => {
      setRolling(false)
      if (d === 6 && st.sixes >= 2) { setMsg(t('ludo.threeSixes')); setSt((s) => ({ ...s, dice: null, rolled: false, sixes: 0, turn: nextActive(s, 0) })); return }
      const lg = legalTokens(st, 0, d)
      setSt((s) => ({ ...s, dice: d, rolled: true, sixes: d === 6 ? s.sixes + 1 : s.sixes }))
      setLegal(lg)
      if (!lg.length) {
        setMsg(t('ludo.noMove'))
        if (pendingPass.current !== null) clearTimeout(pendingPass.current)
        pendingPass.current = window.setTimeout(() => {
          pendingPass.current = null
          setSt((s) => ({ ...s, dice: null, rolled: false, sixes: 0, turn: nextActive(s, 0) }))
        }, 850)
      } else setMsg(t('ludo.selectToken'))
    }, 500)
  }

  const onToken = (i: number) => {
    if (!yourTurn || !st.rolled || st.dice == null) return
    const res = applyMove(st, 0, i, st.dice)
    setLegal([])
    setSt(res.state)
    setMsg(res.state.turn === 0 && res.state.winner === null ? t('ludo.rollAgain') : '')
  }

  const opponents = st.players.filter((p) => p !== 0)
  const oppP = opponents[0] ?? 1

  return (
    <div className="app-frame flex min-h-[100dvh] flex-col" style={{
      background: 'radial-gradient(circle at 20% 12%, rgba(90,170,255,.30), transparent 42%), radial-gradient(circle at 85% 85%, rgba(0,90,190,.35), transparent 45%), linear-gradient(170deg,#1560B4 0%,#0E4A93 45%,#0A3A78 100%)',
    }}>
      <GameHeader title={t(m!.nameKey as any)} prizeMinor={m!.prizeMinor} extra={<VoiceButton roomId={modeId ?? m!.id} />} gameType="ludo" />

      {/* opponents */}
      <div className="flex flex-wrap justify-center gap-2 px-3 pt-2">
        {opponents.map((p) => <Seat key={p} p={p} name={nameFor(p)} avatar={avatarFor(p)} active={st.turn === p && st.winner === null} home={homeCount(p)} />)}
      </div>
      {isReal && <p className="pt-1 text-center text-[11px] font-extrabold text-emerald2">● LIVE · Real Player</p>}

      <div className="flex flex-1 items-center justify-center px-3 py-2">
        <LudoBoard state={st} legal={legal} onToken={onToken} />
      </div>

      {/* You | dice | Com bar (Ludo King style) */}
      <div className="px-3 pb-1">
        <div className="relative flex items-center justify-between gap-2 rounded-2xl px-3 py-2"
          style={{ background: 'linear-gradient(180deg,#1B6FD0 0%,#1257A8 55%,#0D488E 100%)', border: '2.5px solid #FFD466', boxShadow: '0 10px 26px -10px rgba(0,0,0,.75), inset 0 1px 0 rgba(255,255,255,.25)' }}>
          {/* You */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-base text-white" style={{ background: COLORS[0], border: '2px solid #fff', boxShadow: '0 2px 5px rgba(0,0,0,.4)' }}>{avatar}</div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-extrabold leading-none text-white">{username}</div>
              <div className="mt-1 flex gap-1">{[0, 1, 2, 3].map((k) => <span key={k} className="h-1.5 w-1.5 rounded-full" style={{ background: k < homeCount(0) ? '#FFD466' : 'rgba(255,255,255,.35)' }} />)}</div>
            </div>
          </div>

          {/* dice (center, elevated) */}
          <button onClick={roll} disabled={!yourTurn || st.rolled || rolling}
            className={`relative z-10 -my-6 grid h-[68px] w-[68px] shrink-0 place-items-center rounded-full transition disabled:opacity-60 ${rolling ? 'animate-dice-tumble' : 'active:scale-95'}`}
            style={{ background: 'radial-gradient(circle at 50% 35%, #FFF7DF, #F3D98F 70%, #D9A93F 100%)', border: '3px solid #FFE9AE', boxShadow: '0 10px 22px -6px rgba(0,0,0,.75), inset 0 -3px 6px rgba(0,0,0,.18)' }}
            aria-label="roll dice">
            <LudoDiceFace value={st.dice ?? (yourTurn ? null : botDice)} />
          </button>

          {/* Com */}
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <div className="min-w-0 text-right">
              <div className="truncate text-[13px] font-extrabold leading-none text-white">{nameFor(oppP)}</div>
              <div className="mt-1 flex justify-end gap-1">{[0, 1, 2, 3].map((k) => <span key={k} className="h-1.5 w-1.5 rounded-full" style={{ background: k < homeCount(oppP) ? '#FFD466' : 'rgba(255,255,255,.35)' }} />)}</div>
            </div>
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-base text-white" style={{ background: COLORS[oppP], border: '2px solid #fff', boxShadow: '0 2px 5px rgba(0,0,0,.4)' }}>{avatarFor(oppP)}</div>
          </div>
        </div>
      </div>

      <div className="px-3 pb-1 pt-2 text-center">
        <p className="text-sm font-semibold" style={{ color: yourTurn ? 'var(--gold)' : 'rgba(255,255,255,.7)' }}>
          {result ? '' : yourTurn ? (st.rolled ? msg || t('ludo.selectToken') : t('ludo.yourTurn')) : `${nameFor(st.turn)} ${t('ludo.playing')}`}
        </p>
        {yourTurn && !st.rolled && <p className="mt-0.5 text-xs text-white/55 tnum">{timer} {t('ludo.secondsLeft')}</p>}
        {!yourTurn && !result && st.winner === null && botDice !== null && (
          <p className="mt-0.5 text-xs font-bold text-white/70">{nameFor(st.turn)} rolled {botDice}</p>
        )}
      </div>

      <div className="px-3 pb-3 pt-1 flex gap-2">
        <button onClick={() => { if (!settled.current) { settled.current = true; settle({ game: 'ludo', mode: t(m!.nameKey as any), modeId: m!.id, entryMinor: m!.entryMinor, prizeMinor: m!.prizeMinor, outcome: 'loss', deltaMinor: -m!.entryMinor }); setResult('loss') } }} className="btn-danger flex-1 py-2 text-sm">{t('game.resign')}</button>
        <MatchChat opponentName={nameFor(opponents[0] ?? 1)} roomId={modeId ?? m!.id} />
      </div>

      <ExitModal onLeave={() => nav('/')} />
      <ResultModal outcome={result} deltaMinor={result === 'win' ? m!.prizeMinor - m!.entryMinor : -m!.entryMinor} moves={homeCount(0)} />
    </div>
  )
}
