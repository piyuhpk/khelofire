import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useT } from '../../i18n'
import { modeById } from '../../lib/catalog'
import { useStore, type Outcome } from '../../lib/store'
import { GameHeader, VoiceButton, ExitModal, ResultModal } from '../game/GameShell'
import { MatchChat } from '../game/MatchChat'
import { LudoBoard } from './LudoBoard'
import dice1 from '../../assets/ludoking/dice1.png'
import dice2 from '../../assets/ludoking/dice2.png'
import dice3 from '../../assets/ludoking/dice3.png'
import dice4 from '../../assets/ludoking/dice4.png'
import dice5 from '../../assets/ludoking/dice5.png'
import dice6 from '../../assets/ludoking/dice6.png'
import spin1 from '../../assets/ludoking/dice0001.png'
import spin2 from '../../assets/ludoking/dice0002.png'
import spin3 from '../../assets/ludoking/dice0003.png'
import spin4 from '../../assets/ludoking/dice0004.png'
import spin5 from '../../assets/ludoking/dice0005.png'
import spin6 from '../../assets/ludoking/dice0006.png'
import spin7 from '../../assets/ludoking/dice0007.png'
import spin8 from '../../assets/ludoking/dice0008.png'
import gameBg from '../../assets/ludoking/backgroundmaze.jpeg'
import { initLudo, legalTokens, applyMove, rollDice, botChoose, nextActive, COLORS, COLOR_NAME, FINISH, type LudoState, type PlayerId } from '../../engine/ludo'

const BOT_NAMES = ['—', 'Rahim', 'Sakib', 'Tanvir']

/** seconds allowed to roll, and again to pick the token once rolled */
const TURN_SECONDS = 20

const DICE_ART: Record<number, string> = {
  1: dice1, 2: dice2, 3: dice3, 4: dice4, 5: dice5, 6: dice6,
}

/**
 * The roll animation: eight frames of one die tumbling, all the same size
 * (104x120) and all distinct, so this is a real frame-by-frame animation
 * rather than a rotation someone tacked on with CSS.
 */
const SPIN_ART: Record<number, string> = {
  1: spin1, 2: spin2, 3: spin3, 4: spin4, 5: spin5, 6: spin6, 7: spin7, 8: spin8,
}

/** how long one spin frame stays on screen. 8 x 60ms = 480ms, inside the
 *  500ms window the roll uses to commit, so the last frame is visible when
 *  the result lands instead of cutting off mid-tumble. */
const SPIN_FRAME_MS = 60

/**
 * The real die faces from the supplied Ludo King assets.
 *
 * One image per value, so there is nothing to render wrong: the pip layout is
 * the artwork's. The earlier hand-drawn face was a red rounded square, which is
 * neither the right colour nor the right shape for the genre.
 *
 * While rolling it shows the eight-frame tumble instead of any face - that is
 * the moment the player is watching, and it needs to look like the die is
 * actually moving.
 */
function LudoDiceFace({ value, spinning = false, frame = 1 }: { value: number | null; spinning?: boolean; frame?: number }) {
  if (spinning) {
    return (
      <span
        className="relative grid h-14 w-14 place-items-center"
        style={{
          transform: 'perspective(220px) rotateX(14deg) rotateY(-12deg)',
          filter: 'drop-shadow(0 5px 6px rgba(0,0,0,.5))',
        }}
      >
        <img src={SPIN_ART[frame]} alt="" draggable={false} className="h-full w-full object-contain" />
      </span>
    )
  }
  if (value == null) {
    return (
      <span
        className="grid h-14 w-14 place-items-center rounded-[14px] text-[26px]"
        style={{
          background: 'linear-gradient(155deg,#FFFDF6 0%,#F3E7CE 55%,#DCC79C 100%)',
          border: '2px solid rgba(255,255,255,.9)',
          boxShadow: 'inset 0 -4px 8px rgba(120,90,30,.3), inset 0 3px 6px rgba(255,255,255,.95), 0 4px 10px rgba(0,0,0,.45)',
        }}
      >
        🎲
      </span>
    )
  }
  return (
    <span
      className="relative grid h-14 w-14 place-items-center"
      style={{
        transform: 'perspective(220px) rotateX(14deg) rotateY(-12deg)',
        filter: 'drop-shadow(0 5px 6px rgba(0,0,0,.5))',
      }}
    >
      <img src={DICE_ART[value]} alt={`dice ${value}`} draggable={false} className="h-full w-full object-contain" />
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
  const [spinFrame, setSpinFrame] = useState(1)
  const [botDice, setBotDice] = useState<number | null>(null)
  const [msg, setMsg] = useState('')
  const [timer, setTimer] = useState(20)
  const [result, setResult] = useState<Outcome | null>(null)
  const settled = useRef(false)
  // bumped whenever the turn moves on, so an in-flight dice animation knows its
  // result is stale instead of writing rolled:true onto somebody else's turn
  const rollToken = useRef(0)

  const yourTurn = st.turn === 0 && st.winner === null && !result
  const loc = useLocation()
  const isReal = (loc.state as any)?.real === true
  const nameFor = (p: PlayerId) => (p === 0 ? username : isReal ? `Player ${p}` : (BOT_NAMES[p] || `${COLOR_NAME[p]} Bot`))
  const avatarFor = (p: PlayerId) => (p === 0 ? avatar : isReal ? '👤' : ['👤', '🤖', '🐯', '🦊'][p])
  const homeCount = (p: PlayerId) => st.tokens[p].filter((x) => x >= FINISH).length

  // single place that hands the turn on, so every exit path (timeout, no legal
  // move, three sixes, forfeit) clears the same transient state
  const passTurn = (from: PlayerId) => {
    rollToken.current++
    setLegal([])
    setMsg('')
    setSt((s) => ({ ...s, dice: null, rolled: false, sixes: 0, turn: nextActive(s, from) }))
  }

  // advance the tumble for as long as the roll is in flight. 8 frames x 60ms
  // = 480ms, landing just inside the 500ms commit window, so the last frame is
  // on screen when the result appears instead of the animation cutting off
  // mid-tumble. The frame counter starts fresh in roll(), not here - setting
  // state on this effect's own pass is what the set-state-in-effect rule is
  // there to catch.
  useEffect(() => {
    if (!rolling) return
    let f = 1
    const id = setInterval(() => { f = f % 8 + 1; setSpinFrame(f) }, SPIN_FRAME_MS)
    return () => clearInterval(id)
  }, [rolling])

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

  // Turn countdown. It has to cover the WHOLE turn, not just the pre-roll
  // phase: it used to return early once st.rolled was true, so rolling a die and
  // then walking away froze the board for good in a paid match - the dice button
  // is disabled, onToken refuses, and no effect was left to advance the state.
  // Rolling flips st.rolled, which restarts the clock and grants a fresh budget
  // to pick a token.
  useEffect(() => {
    if (!yourTurn) return
    setTimer(TURN_SECONDS)
    const id = setInterval(() => setTimer((x) => {
      if (x <= 1) {
        clearInterval(id)
        passTurn(0)
        return 0
      }
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
    if (!yourTurn || rolling || st.rolled || timer <= 0) return
    const mine = ++rollToken.current
    const d = rollDice()
    setRolling(true)
    // restart the tumble from frame 1 here rather than in the effect, so the
    // effect never has to set state on its own render pass
    setSpinFrame(1)
    setTimeout(() => {
      // always clear the spinner first: if this roll is stale the button must
      // not stay disabled forever
      setRolling(false)
      if (rollToken.current !== mine) return
      if (d === 6 && st.sixes >= 2) { setMsg(t('ludo.threeSixes')); passTurn(0); return }
      const lg = legalTokens(st, 0, d)
      // The countdown can expire inside this 500ms animation. Committing blindly
      // used to land { turn: <opponent>, rolled: true } - the bot effect skips it
      // because rolled is true, and the countdown effect skips it because it is
      // no longer your turn, so the board froze permanently and only resign or
      // leave could get you out. Bail out if the turn already moved on.
      if (st.turn !== 0 || st.winner !== null || result !== null) return
      setSt((s) => (s.turn === 0 && !s.rolled ? { ...s, dice: d, rolled: true, sixes: d === 6 ? s.sixes + 1 : s.sixes } : s))
      setLegal(lg)
      if (!lg.length) {
        setMsg(t('ludo.noMove'))
        if (pendingPass.current !== null) clearTimeout(pendingPass.current)
        pendingPass.current = window.setTimeout(() => { pendingPass.current = null; passTurn(0) }, 850)
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
      // The in-game background from the supplied assets (the blue diamond-tiled
      // surface). Kept a flat gradient underneath: the pattern is dark, and this
      // same surface is what the header text and seat panels sit on, so a light
      // scrim keeps them legible without hiding the artwork.
      backgroundImage: `linear-gradient(rgba(6,30,70,.38), rgba(6,30,70,.38)), url(${gameBg})`,
      backgroundSize: 'cover, cover',
      backgroundPosition: 'center, center',
      backgroundRepeat: 'no-repeat, no-repeat',
      backgroundColor: '#0A3A78',
    }}>
      <GameHeader title={t(m!.nameKey as any)} prizeMinor={m!.prizeMinor} extra={<VoiceButton />} gameType="ludo" />

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
          <button onClick={roll} disabled={!yourTurn || st.rolled || rolling || timer <= 0}
            // During a roll the frame sequence below IS the animation, so the CSS
            // tumble is off - rotating the whole thing fights the artwork's own
            // spin and the two never line up.
            className={`relative z-10 -my-6 grid h-[68px] w-[68px] shrink-0 place-items-center rounded-full transition disabled:opacity-60 ${rolling ? 'scale-105' : 'active:scale-95'}`}
            style={{ background: 'radial-gradient(circle at 50% 35%, #FFF7DF, #F3D98F 70%, #D9A93F 100%)', border: '3px solid #FFE9AE', boxShadow: '0 10px 22px -6px rgba(0,0,0,.75), inset 0 -3px 6px rgba(0,0,0,.18)' }}
            aria-label="roll dice">
            <LudoDiceFace value={st.dice ?? (yourTurn ? null : botDice)} spinning={rolling} frame={spinFrame} />
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
        {yourTurn && (
          <p className="mt-0.5 text-xs tnum" style={{ color: timer <= 5 ? '#FF6B6B' : 'rgba(255,255,255,.55)', fontWeight: timer <= 5 ? 800 : 500 }}>
            {timer} {t('ludo.secondsLeft')}
          </p>
        )}
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
