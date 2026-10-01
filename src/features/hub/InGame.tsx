import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Trophy, Dice5, Crown, Grid3x3, Dices } from 'lucide-react'
import { useT, useI18n } from '../../i18n'
import { MODES, GAME_ORDER, GAME_META, type GameMode } from '../../lib/catalog'
import type { GameKey } from '../../lib/store'
import { fmt } from '../../lib/money'
import { GameEmblem, TILE_THEME } from '../home/GameArt'
import { useReady, HomeSkeleton } from '../../ui/components'
import { useStore } from '../../lib/store'

const GAME_ICON: Record<GameKey, typeof Dice5> = { ludo: Dice5, chess: Crown, guti: Grid3x3, dice: Dices }

function GameTile({ m }: { m: GameMode }) {
  const t = useT()
  const { lang } = useI18n()
  const nav = useNavigate()
  const theme = TILE_THEME[m.theme]
  const cash = m.entryMinor > 0
  const go = () => nav(m.practice ? `/play/${m.game}/${m.id}` : `/join/${m.id}`)
  
  // Get custom images from store
  const gameModeImages = useStore((s) => s.gameModeImages)
  const customImages = gameModeImages[m.id]
  const hasBackgroundImage = customImages?.backgroundImage
  const bgStyle = hasBackgroundImage 
    ? { backgroundImage: `url(${customImages.backgroundImage})`, backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: `0 14px 32px -16px ${theme.glow}, inset 0 0 0 1px rgba(255,255,255,.14)` }
    : { boxShadow: `0 14px 32px -16px ${theme.glow}, inset 0 0 0 1px rgba(255,255,255,.14)` }
  
  return (
    <button onClick={go} className="relative overflow-hidden rounded-card text-left min-h-[172px] active:scale-[.98] transition"
      style={bgStyle}>
      {!hasBackgroundImage && <div className="absolute inset-0" style={{ background: theme.bg }} />}
      {!hasBackgroundImage && theme.rays && <div className="rays absolute inset-0" />}
      <div className="absolute inset-x-3 top-3 z-10 flex items-start justify-between">
        <span className="rounded-pill px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white" style={{ background: 'rgba(0,0,0,.34)', border: '1px solid rgba(255,255,255,.2)', backdropFilter: 'blur(4px)' }}>
          {t(`tag.${m.tag}` as any)}
        </span>
        {cash && <span className="chip tnum text-[11px] font-extrabold" style={{ backgroundImage: 'var(--grad-gold)', color: '#2A1D00' }}><Trophy className="h-3 w-3" strokeWidth={2.6} />{fmt(m.prizeMinor)}</span>}
      </div>
      <div className="relative z-[1] px-3 pt-9"><GameEmblem art={m.art} /></div>
      <div className="absolute inset-x-0 bottom-0 z-10 p-3 pt-8" style={{ background: 'linear-gradient(to top, rgba(0,0,0,.72), rgba(0,0,0,.28) 55%, transparent)' }}>
        <div className="flex items-end justify-between gap-1">
          <div className="min-w-0">
            <div className="font-display text-[15px] font-extrabold leading-tight text-white">{t(m.nameKey as any)}</div>
            <div className="text-[11px] text-white/75 leading-tight truncate">{lang === 'bn' ? m.desc.bn : m.desc.en}</div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-white/70" strokeWidth={2.5} />
        </div>
        {cash ? (
          <div className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-white/70">
            <span>{t('common.entry')}</span><span className="tnum text-white/95">{fmt(m.entryMinor)}</span>
            {m.open ? <span className="ml-auto flex items-center gap-1 rounded-pill px-1.5 py-0.5 text-emerald2" style={{ background: 'rgba(31,203,139,.16)' }}><span className="h-1.5 w-1.5 rounded-full bg-emerald2 animate-pulse" />{m.open} {t('home.openMatches')}</span> : null}
          </div>
        ) : <div className="mt-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald2">{t('common.free')}</div>}
      </div>
    </button>
  )
}

function GameSection({ game }: { game: GameKey }) {
  const t = useT()
  const nav = useNavigate()
  const chessEnabled = useStore((s) => s.siteConfig.chessEnabled)
  const modes = MODES.filter((m) => m.game === game && (m.game !== 'chess' || chessEnabled))
  const Icon = GAME_ICON[game]
  return (
    <div className="px-4 pt-6">
      <div className="mb-3 flex items-center justify-between px-1">
        <h3 className="sect-title flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg text-white shadow-glow" style={{ backgroundImage: 'var(--grad)' }}><Icon className="h-4 w-4" strokeWidth={2.2} /></span>
          {t(GAME_META[game].nameKey as any)}
        </h3>
        <button onClick={() => nav(`/lobby/${game}`)} className="flex items-center text-xs font-semibold text-muted active:scale-95">{t('home.all')}<ChevronRight className="h-3.5 w-3.5" /></button>
      </div>
      <div className="grid grid-cols-2 gap-3 px-1 stg">{modes.map((m) => <GameTile key={m.id} m={m} />)}</div>
    </div>
  )
}

export default function InGame() {
  const t = useT()
  const nav = useNavigate()
  const ready = useReady(500)
  if (!ready) return <HomeSkeleton />
  return (
    <div className="pb-8">
      <div className="flex items-center gap-2.5 px-4 pt-4">
        <button onClick={() => nav('/')} className="grid h-9 w-9 place-items-center rounded-full active:scale-90 transition" style={{ background: 'var(--glass)', border: '1px solid var(--glass-brd)' }}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="font-display text-lg font-extrabold flex items-center gap-2"><Dices className="h-5 w-5 text-cyan2" strokeWidth={2.2} />{t('cat.ingame')}</h1>
          <p className="text-[11px] text-muted">{t('cat.ingameSub')}</p>
        </div>
      </div>
      {GAME_ORDER.map((g) => <GameSection key={g} game={g} />)}
    </div>
  )
}
