import { useParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, Dice5, Crown, Grid3x3, Dices, Trophy, Ticket, Users, Clock, Sparkles } from 'lucide-react'
import { useT, useI18n } from '../../i18n'
import { allModes, modeName, GAME_META, canPlayLive } from '../../lib/catalog'
import { useStore, type GameKey } from '../../lib/store'
import { fmt } from '../../lib/money'
import { EmptyState, ListSkeleton, useReady } from '../../ui/components'

const GAME_ICON: Record<GameKey, typeof Dice5> = { ludo: Dice5, chess: Crown, guti: Grid3x3, dice: Dices }

export default function Lobby() {
  const { game } = useParams()
  const t = useT()
  const { lang } = useI18n()
  const nav = useNavigate()
  const ready = useReady(500)
  const gk = game as GameKey
  const chessEnabled = useStore((s) => s.siteConfig.chessEnabled)
  const modes = allModes().filter((m) => m.game === gk && !m.practice && canPlayLive(m) && (m.game !== 'chess' || chessEnabled))
  const Icon = GAME_ICON[gk] ?? Dice5
  const title = GAME_META[gk] ? t(GAME_META[gk].nameKey as any) : game

  return (
    <div className="p-4 pb-8">
      <div className="flex items-center gap-2.5 mb-4">
        <button onClick={() => nav(-1)} className="grid h-9 w-9 place-items-center rounded-full active:scale-90 transition" style={{ background: 'var(--glass)', border: '1px solid var(--glass-brd)' }}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="grid h-9 w-9 place-items-center rounded-xl text-white shadow-glow" style={{ backgroundImage: 'var(--grad)' }}>
          <Icon className="h-5 w-5" strokeWidth={2.2} />
        </span>
        <h1 className="font-display text-lg font-extrabold">{title}</h1>
        {/* Real tables. Only Ludo has a server-authoritative engine behind it, so
            this is offered here and not on the other games' lobbies. */}
        {gk === 'ludo' && (
          <button onClick={() => nav('/live/ludo')} className="btn-emerald ml-auto flex items-center gap-1.5 px-3 py-2 text-xs font-extrabold">
            <Users className="h-4 w-4" strokeWidth={2.6} />
            {lang === 'bn' ? 'লাইভ টেবিল' : 'Live table'}
          </button>
        )}
      </div>

      {!ready ? (
        <ListSkeleton rows={4} avatar={false} />
      ) : modes.length === 0 ? (
        <EmptyState title={t('empty.noTournaments')} />
      ) : (
        <div className="space-y-3 stg">
          {modes.map((m) => {
            const slots = `1/${m.players}`
            return (
              <div key={m.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-display font-extrabold flex items-center gap-2">
                      {modeName(m, t as any, lang === 'bn')}
                      <span className="chip tnum text-[11px] font-extrabold" style={{ backgroundImage: 'var(--grad-gold)', color: '#2A1D00' }}>
                        <Trophy className="h-3 w-3" strokeWidth={2.6} />{fmt(m.prizeMinor)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">{lang === 'bn' ? m.desc.bn : m.desc.en}</div>
                  </div>
                  {m.clock && <span className="chip shrink-0 text-[11px] text-teal2" style={{ background: 'rgba(45,212,191,.12)' }}><Clock className="h-3 w-3" strokeWidth={2.4} />{m.clock}</span>}
                </div>

                <div className="my-3 grid grid-cols-3 gap-2 text-center">
                  {[
                    { Ico: Trophy, label: t('common.prize'), val: fmt(m.prizeMinor), cls: 'text-emerald2' },
                    { Ico: Ticket, label: t('common.entry'), val: fmt(m.entryMinor), cls: 'text-text' },
                    { Ico: Users, label: t('match.slots'), val: slots, cls: 'text-primary-2' },
                  ].map(({ Ico, label, val, cls }, k) => (
                    <div key={k} className="rounded-2xl py-2.5" style={{ background: 'var(--glass)', border: '1px solid var(--glass-brd)' }}>
                      <div className="flex items-center justify-center gap-1 text-[10px] text-muted"><Ico className="h-3 w-3" strokeWidth={2} />{label}</div>
                      <div className={`tnum mt-0.5 font-bold ${cls}`}>{val}</div>
                    </div>
                  ))}
                </div>

                <button onClick={() => nav(`/join/${m.id}`)} className="btn-primary w-full">
                  <Sparkles className="h-4 w-4" strokeWidth={2.2} />{fmt(m.entryMinor)} {t('match.joinWith')}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
