import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useT, useI18n } from '../../i18n'
import { modeById } from '../../lib/catalog'
import { useStore, type Outcome } from '../../lib/store'
import { readState, sendAction, subscribeMatch, settleMatch, resignLiveMatch, LiveError, type LiveGameState } from '../../lib/live'
import { GameHeader, VoiceButton, ExitModal, ResultModal } from '../game/GameShell'
import { MatchChat } from '../game/MatchChat'
import { useToast } from '../../ui/components'
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
import { initLudo, legalTokens, applyMove, rollDice, botChoose, nextActive, wonBySeat, COLORS, COLOR_NAME, FINISH, type LudoState, type PlayerId } from '../../engine/ludo'

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
  const { lang } = useI18n()
  const toast = useToast()
  const nav = useNavigate()
  const settle = useStore((s) => s.settle)
  const username = useStore((s) => s.username) || t('common.guest')
  const avatar = useStore((s) => s.avatar)

  // modeById returns undefined for an unknown id, and /play/ludo/:modeId matches
  // any string - so a bad deep link used to reach the `m!.nameKey` deref below and
  // white-screen. LiveTables also enters a paid table with the mode id read from
  // Postgres, and match_modes is not restricted to the hardcoded MODES array, so
  // a mode row the catalogue does not know about could reach a real board too.
  // Bounce rather than render nothing meaningful.
  useEffect(() => { if (!m) nav('/', { replace: true }) }, [m, nav])
  // The `return null` for an unknown mode used to sit here, immediately above the
  // first useState. React only requires hooks to run in the same order on every
  // render, and returning before them means a mode that resolves on the second
  // render (a deep link, or a mode row arriving from the database after the
  // catalogue loads) shifts every hook by one and React throws. That is a white
  // screen on a real device, from a bad URL. The guard now sits with the other
  // render-time bailouts at the end of the component, after the last hook.

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
  // Resign is a two-round-trip operation that changes a paid match, so it must not
  // be fireable twice from a double tap.
  const [resigning, setResigning] = useState(false)

  /** Leave a real match. Every exit path goes through here, including the one that
   *  happens because the player closed the app on a phone. */
  const giveUp = async () => {
    if (!matchId || resigning) return
    setResigning(true)
    settled.current = true
    try {
      await resignLiveMatch(matchId)
      nav('/', { replace: true })
    } catch (e) {
      // Leaving anyway would strand the opponent on a live board with the entry
      // gone, which is exactly the failure this exists to prevent. Stay put, say
      // why, and let the player try again.
      settled.current = false
      setResigning(false)
      toast(liveErr(e, lang === 'bn'), 'err')
    }
  }

  const loc = useLocation()
  // `isReal` used to come from navigation state, which meant "somebody handed us
  // { real: true }" - and the only thing that ever did was a presence count of
  // browsers on the same lobby screen. That labelled a solo bot game as a live
  // match. A game is real when a real seat exists, and that now arrives as a
  // match id from the room-code flow. Nothing can set it by asking nicely.
  //
  // Read from the query string as well as the router state. State does not survive
  // a reload, an Android process death/app restore, an in-app refresh or the
  // Capacitor WebView reloading its bundle, and losing it was not a neutral
  // fallback: isReal went false, the bot effect started running, and this client
  // began playing a local game on a board the opponent was still playing - entry
  // debited, match stuck live, nothing to go back to.
  const queryMatchId = new URLSearchParams(loc.search).get('m') || undefined
  const matchId = (((loc.state as any)?.matchId as string | undefined) ?? queryMatchId)
  const isReal = !!matchId
  // A paid mode reached without a match id is not a game, it is a free win: settle
  // below credits the mode's real prize with no entry ever debited, and a deep link
  // to /play/ludo/ludo_classic is all it takes. Rather than let that stand, a mode
  // that costs money is only playable through a real table.
  const modeIsPaid = m ? m.entryMinor > 0 && !m.practice : false
  const blockedNoMatch = modeIsPaid && !matchId

  // A paid mode opened without a match id cannot be played. It used to start a bot
  // game that settled with the mode's real entry and prize, so the only thing
  // between a player and a free prize was not opening the URL themselves.
  useEffect(() => {
    if (!blockedNoMatch) return
    toast(t('ludo.noEntry'), 'err')
    nav('/', { replace: true })
  }, [blockedNoMatch, toast, t, nav])

  // which engine seat this device owns. 0 until the server answers, and 0 in a
  // bot game, which is where it has always been.
  const [yourSeat, setYourSeat] = useState<PlayerId>(0)

  const yourTurn = st.turn === yourSeat && st.winner === null && !result
  const nameFor = (p: PlayerId) => (p === yourSeat ? username : isReal ? `Player ${p}` : (BOT_NAMES[p] || `${COLOR_NAME[p]} Bot`))
  const avatarFor = (p: PlayerId) => (p === yourSeat ? avatar : isReal ? '👤' : ['👤', '🤖', '🐯', '🦊'][p])
  const homeCount = (p: PlayerId) => st.tokens[p].filter((x) => x >= FINISH).length

  // single place that hands the turn on, so every exit path (timeout, no legal
  // move, three sixes, forfeit) clears the same transient state
  const passTurn = (from: PlayerId) => {
    // live: the server decides who moves next, and it also handles the three
    // sixes rule and the empty-board pass. Asking it is the only correct way to
    // hand the turn on, and it stops a client from passing out of turn.
    if (matchId) { void liveAct('pass'); return }
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
    // Was `st.winner === 0`, which is only correct if you are seat 0. In a real
    // match join_live_match seats a 1v1 opponent at engine seat 2 and a 4p table
    // uses 1/2/3, so the joiner of every paid match had its own client declare
    // the win a loss - while the result modal a few lines down counted its home
    // pieces from yourSeat and contradicted it. The rule itself is in the engine
    // now (wonBySeat) with every seat pair tested, so it cannot drift back.
    const outcome: Outcome = wonBySeat(st.winner, yourSeat) ? 'win' : 'loss'
    // Settle FIRST, show the modal second. It used to sit inside the 900ms timeout
    // below, which meant the money only moved if this screen was still alive a
    // second and a half after the win - and the ordinary thing a player does after
    // winning is close the app. The delay is there for the modal to land on a board
    // the player can still see the end of; it was never a reason to postpone paying
    // them. reconcileFinishedMatches() in lib/live.ts is the backstop for a settle
    // that is interrupted anyway.
    if (matchId) {
      // A paid match must be settled by the server, which already knows the
      // entry and prize it debited and refuses to pay twice. settle() only
      // added the prize to the local store, so the winner saw a balance the
      // server never granted (gone on next reload) and settle_match was
      // effectively never called by anything except the broken resign button.
      void settleMatch(matchId, outcome)
        .catch((e) => toast(e instanceof Error ? e.message : 'Settlement failed', 'err'))
        .finally(() => setResult(outcome))
      return
    }
    settle({ game: 'ludo', mode: t(m!.nameKey as any), modeId: m!.id, entryMinor: m!.entryMinor, prizeMinor: m!.prizeMinor, outcome, deltaMinor: outcome === 'win' ? m!.prizeMinor - m!.entryMinor : -m!.entryMinor })
    setTimeout(() => setResult(outcome), 900)
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

  // Bot turn, in two phases so the opponent's roll can actually be followed.
  //
  // It used to commit dice+move in one silent update, so the opponent's token
  // just teleported with no spin at all - no tumble on the dice, and no way to
  // see where the piece went. Now the shared dice tumbles first, the rolled
  // value lands and sits for a beat, and only then does the token move.
  //
  // This still commits in ONE state update per phase. It used to be split
  // across two timeouts sharing one alive flag: the first one set dice/rolled,
  // which changed the deps below, so React ran this effect's cleanup (setting
  // alive = false) and then the second timeout saw !alive and returned. The
  // bot showed its die and never moved, leaving state { rolled: true, turn:
  // bot } that nothing could advance - the board froze forever after the
  // player's move. The phase-2 timer therefore lives in botMoveTimer (a ref
  // the cleanup deliberately does not touch) and is guarded by rollToken
  // instead: the phase-1 commit re-runs this effect, the guard sees rolled
  // and returns early without bumping the token, so phase 2 still fires.
  useEffect(() => {
    const p = st.turn
    if (matchId) return // real opponent: the server drives, never the bot
    if (result || st.winner !== null || p === 0 || st.rolled || st.dice !== null) return
    const mine = ++rollToken.current
    // phase 0: tumble the shared dice while the bot "thinks", exactly like a
    // player roll - the frame interval above runs off `rolling`
    setRolling(true)
    setSpinFrame(1)
    const id = setTimeout(() => {
      setRolling(false)
      if (rollToken.current !== mine) return
      const d = rollDice()
      if (d === 6 && st.sixes >= 2) {
        setBotDice(d)
        setSt((s) => ({ ...s, dice: null, rolled: false, sixes: 0, turn: nextActive(s, p) }))
        return
      }
      const cur: LudoState = { ...st, dice: d, rolled: true, sixes: d === 6 ? st.sixes + 1 : 0 }
      const choice = botChoose(cur, p, d)
      setBotDice(d)
      if (choice === null) {
        setSt((s) => ({ ...s, dice: null, rolled: false, sixes: 0, turn: nextActive(s, p) }))
        return
      }
      const moved = applyMove(cur, p, choice, d).state
      // phase 1: land the rolled value on the dice, so the eye registers what
      // was rolled...
      setSt({ ...cur })
      // ...phase 2: move the token a beat later, so the move can be followed
      // instead of landing in the same frame as the dice.
      botMoveTimer.current = window.setTimeout(() => {
        botMoveTimer.current = null
        if (rollToken.current !== mine) return
        setSt(moved)
      }, 650)
    }, 900)
    return () => { clearTimeout(id); setRolling(false) }
  }, [st, result, matchId]) // eslint-disable-line

  // ---- live match --------------------------------------------------------
  //
  // In a real table the board belongs to the server. Every state write below
  // goes through sendAction/readState and replaces the local board with what
  // came back, so the dice, the legal moves and the turn are all decided by the
  // engine - a modified client cannot roll a six or move a token it does not own.
  //
  // The local bot loop is switched off entirely when there is a matchId. That is
  // the whole point: the old bug was a bot playing a solo game wearing a LIVE
  // badge, and the cheapest way to be sure it cannot come back is for there to be
  // no bot code path at all when a real opponent is seated.
  // Started at -1, not 0. start_live_match seeds version = 0, so a ref starting
  // at 0 made the very first readState answer fail the `version <= current` guard
  // and get thrown away - along with the your_seat it carried. Every poll failed
  // the same way until the first action bumped the version, which meant the joiner
  // of a real match never learned which seat it was playing: it believed it was
  // the host's turn, rendered the opponent as "You", and its first roll was
  // rejected as out of turn.
  const liveVersion = useRef(-1)
  const liveBusy = useRef(false)

  /**
   * Adopt a board the server produced.
   *
   * The engine's board is the same shape as the local one, so this is a cast and
   * a copy rather than a translation - but it is done in one place, and the
   * version guard is here: two replies can be in flight at once (the poll and a
   * realtime nudge), and applying an older board on top of a newer one would walk
   * a token backwards.
   */
  const adopt = useCallback((v: LiveGameState) => {
    if (v.version <= liveVersion.current) return
    liveVersion.current = v.version
    if (v.your_seat !== undefined) setYourSeat(v.your_seat as PlayerId)

    const n = v.state.tokens.length
    const board: LudoState = {
      ...initLudo(n),
      tokens: v.state.tokens,
      turn: v.state.turn as PlayerId,
      dice: v.state.dice,
      rolled: v.state.rolled,
      sixes: v.state.sixes,
      winner: v.state.winner as PlayerId | null,
    }
    // The seat list comes from the server. It used to be initLudo(n) with n taken
    // from tokens.length, and tokens is always four arrays, so every 2-player real
    // match rendered three opponent seats - two of them colours nobody was playing -
    // and the "Com" panel then named the wrong one, because opponents[0] was Green
    // while the actual opponent was Yellow at seat 2.
    if (v.state.players?.length) board.players = v.state.players as PlayerId[]
    setSt(board)
    setTimer(v.seconds_left)
    // The opponent's roll, so the die face shows the number the server rolled. In a
    // real match botDice stayed null for ever (only the disabled bot loop set it),
    // so the opponent's turn showed a dice emoji instead of their result.
    if (!board.rolled && board.dice != null) setBotDice(board.dice)

    // Which tokens are tappable is a UI affordance, not a decision - the engine
    // re-checks the move and rejects anything illegal, so showing a stale
    // highlight cannot produce an illegal board.
    setLegal(
      board.rolled && board.dice != null && board.winner === null
        ? legalTokens(board, board.turn, board.dice)
        : [],
    )
  }, [])

  // Pull the board on open, and keep pulling it: realtime messages are a nudge
  // and can be dropped, so the state shown is always one the server confirmed.
  useEffect(() => {
    if (!matchId) return
    let alive = true
    let timerId: number | undefined

    const pull = async () => {
      try {
        const v = await readState(matchId)
        if (alive) adopt(v)
      } catch {
        // transient - retried on the next tick or on the next realtime nudge
      }
    }
    void pull()
    const unsub = subscribeMatch(matchId, () => void pull())
    timerId = window.setInterval(() => void pull(), 4000)
    return () => { alive = false; unsub(); if (timerId) clearInterval(timerId) }
  }, [matchId, adopt])

  const liveAct = useCallback(async (action: 'roll' | 'move' | 'pass', token?: number) => {
    if (!matchId || liveBusy.current) return null
    liveBusy.current = true
    try {
      const v = await sendAction(matchId, action, token)
      adopt(v)
      return v
    } catch (e) {
      toast(liveErr(e, lang === 'bn'), 'err')
      return null
    } finally {
      liveBusy.current = false
    }
  }, [matchId, adopt, toast, lang])
  const pendingPass = useRef<number | null>(null)
  // lives in a ref on purpose: the phase-1 commit re-runs the turn effect
  // below, and if that cleanup cancelled this timer the bot would show its die
  // and freeze - the old two-timeout bug. It is cleared when the match ends
  // and on unmount, and nothing can interleave in between: taps and the
  // countdown are both gated on yourTurn.
  const botMoveTimer = useRef<number | null>(null)
  useEffect(() => () => { if (botMoveTimer.current !== null) clearTimeout(botMoveTimer.current) }, [])
  // the "no legal move, pass the turn" timer must not outlive the match,
  // otherwise it flips the turn after resign or after the result modal
  useEffect(() => {
    if (result) {
      if (pendingPass.current !== null) {
        clearTimeout(pendingPass.current)
        pendingPass.current = null
      }
      if (botMoveTimer.current !== null) {
        clearTimeout(botMoveTimer.current)
        botMoveTimer.current = null
      }
    }
  }, [result])
  useEffect(() => () => { if (pendingPass.current !== null) clearTimeout(pendingPass.current) }, [])

const roll = () => {
    if (!yourTurn || rolling || st.rolled || timer <= 0) return

    // A live roll is not animated from a local dice value, because there is no
    // local dice value: the number comes back from the engine. The tumble still
    // plays, and the revealed face is the one the server actually rolled.
    if (matchId) {
      setRolling(true); setSpinFrame(1)
      void liveAct('roll').then((v) => {
        setRolling(false)
        if (!v) return
        setMsg(v.state.dice != null && v.state.rolled
          ? (legalTokens(st, yourSeat, v.state.dice).length ? t('ludo.selectToken') : t('ludo.noMove'))
          : '')
      })
      return
    }

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
    // live: ask the engine, then render whatever it decided
    if (matchId) {
      setLegal([])
      void liveAct('move', i).then((v) => {
        if (!v) return
        setMsg(v.state.turn === v.your_seat && v.state.winner === null ? t('ludo.rollAgain') : '')
      })
      return
    }
    const res = applyMove(st, 0, i, st.dice)
    setLegal([])
    setSt(res.state)
    setMsg(res.state.turn === 0 && res.state.winner === null ? t('ludo.rollAgain') : '')
  }

  // Filtered on the seat this client actually plays, not on 0. With a hardcoded 0
  // a seat-2 joiner had itself drawn as an opponent and the bar below named the
  // wrong colour "You".
  const opponents = st.players.filter((p) => p !== yourSeat)
  const oppP = opponents[0] ?? 1

  // Nothing renders while the redirect is in flight. The effect above already
  // navigated, but an effect runs after the first paint, so without this the board
  // appeared for a frame and could take a tap.
  if (blockedNoMatch) return null
  // Safe this far down: the only unguarded `m` dereference in the component is
  // `modeIsPaid`, which already tests `m` first.
  if (!m) return null

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
      {isReal && <p className="pt-1 text-center text-[11px] font-extrabold text-emerald2">● LIVE · real player seated</p>}

      <div className="flex flex-1 items-center justify-center px-3 py-2">
        <LudoBoard state={st} legal={legal} onToken={onToken} youSeat={yourSeat} />
      </div>

      {/* You | dice | Com bar (Ludo King style) */}
      <div className="px-3 pb-1">
        <div className="relative flex items-center justify-between gap-2 rounded-2xl px-3 py-2"
          style={{ background: 'linear-gradient(180deg,#1B6FD0 0%,#1257A8 55%,#0D488E 100%)', border: '2.5px solid #FFD466', boxShadow: '0 10px 26px -10px rgba(0,0,0,.75), inset 0 1px 0 rgba(255,255,255,.25)' }}>
          {/* You */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-base text-white" style={{ background: COLORS[yourSeat], border: '2px solid #fff', boxShadow: '0 2px 5px rgba(0,0,0,.4)' }}>{avatar}</div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-extrabold leading-none text-white">{username}</div>
              <div className="mt-1 flex gap-1">{[0, 1, 2, 3].map((k) => <span key={k} className="h-1.5 w-1.5 rounded-full" style={{ background: k < homeCount(yourSeat) ? '#FFD466' : 'rgba(255,255,255,.35)' }} />)}</div>
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
        <button disabled={resigning} onClick={() => {
          if (settled.current || resigning) return
          if (matchId) { void giveUp(); return }
          settled.current = true
          settle({ game: 'ludo', mode: t(m!.nameKey as any), modeId: m!.id, entryMinor: m!.entryMinor, prizeMinor: m!.prizeMinor, outcome: 'loss', deltaMinor: -m!.entryMinor })
          setResult('loss')
        }} className="btn-danger flex-1 py-2 text-sm disabled:opacity-60">{resigning ? t('common.loading') : t('game.resign')}</button>
        <MatchChat opponentName={nameFor(opponents[0] ?? 1)} roomId={matchId ?? modeId ?? m!.id} />
      </div>

      {/* Leaving is a forfeit, not a nav(). ExitModal used to call nav('/') with no
          RPC at all, which left the match live and the entry unsettleable for the
          opponent - a trap that only opened when someone closed the app. */}
      <ExitModal onLeave={() => { if (matchId) { void giveUp(); return } nav('/') }} />
      <ResultModal outcome={result} deltaMinor={result === 'win' ? m!.prizeMinor - m!.entryMinor : -m!.entryMinor} moves={homeCount(yourSeat)} />
    </div>
  )
}

/** A live failure the player can do something about, in their language. */
function liveErr(e: unknown, bn: boolean): string {
  const msg = e instanceof LiveError ? e.message : ''
  if (/not seated/i.test(msg)) return bn ? 'আপনি এই ম্যাচে বসা নেই' : 'You are not seated in this match'
  if (/not signed in|Sign in again/i.test(msg)) return bn ? 'আবার লগইন করুন' : 'Please sign in again'
  if (/deadline|expired|too slow/i.test(msg)) return bn ? 'সময় শেষ — অপোনেন্টের চাল' : 'Out of time — opponent plays on'
  if (/not your turn/i.test(msg)) return bn ? 'এখন আপনার চাল নয়' : 'Not your turn'
  return msg || (bn ? 'কিছু গলতি হয়েছে' : 'Something went wrong')
}
