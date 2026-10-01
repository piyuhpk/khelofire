import { useNavigate } from 'react-router-dom'
import { Crown, Trophy, ChevronLeft } from 'lucide-react'
import { useT } from '../../i18n'
import { useStore } from '../../lib/store'
import { Skeleton, useReady } from '../../ui/components'

const NAMES = ['Rahim', 'Karim', 'Sakib', 'Tanvir', 'Nusrat', 'Fahim', 'Jhankar', 'Mahi']
const AV = ['🐯', '🦊', '🐼', '🦁', '🐺', '🦉', '🐨', '🐵']

export default function Leaderboard() {
  const t = useT()
  const nav = useNavigate()
  const ready = useReady(650)
  // primitive selectors only — an object selector re-creates each render and loops React 19
  const username = useStore((s) => s.username)
  const wins = useStore((s) => s.wins)
  const avatar = useStore((s) => s.avatar)

  const rows = NAMES.map((n, i) => ({ name: n, wins: 44 - i * 5, avatar: AV[i], me: false }))
  rows.push({ name: username, wins, avatar, me: true })
  rows.sort((a, b) => b.wins - a.wins)
  const [p1, p2, p3, ...rest] = rows
  const podium = [
    { r: p2, place: 2, h: 'h-20', grad: 'linear-gradient(135deg,#C0C7D4,#8A93A6)' },
    { r: p1, place: 1, h: 'h-28', grad: 'var(--grad-gold)' },
    { r: p3, place: 3, h: 'h-16', grad: 'linear-gradient(135deg,#E8A87C,#B9704A)' },
  ]

  return (
    <div className="pb-8">
      <div className="flex items-center gap-2 px-4 pt-4">
        <button onClick={() => nav(-1)} className="grid h-9 w-9 place-items-center rounded-full" style={{ background: 'var(--glass)', border: '1px solid var(--glass-brd)' }}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="font-display text-lg font-extrabold flex items-center gap-2"><Trophy className="h-5 w-5 text-gold" strokeWidth={2.2} />{t('leaderboard.title')}</h1>
      </div>

      {!ready ? (
        <>
          <div className="mx-4 mt-4 flex items-end justify-center gap-3 rounded-card p-4" style={{ background: 'var(--glass)', border: '1px solid var(--glass-brd)' }}>
            {['h-20', 'h-28', 'h-16'].map((h, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-2">
                <Skeleton className="h-12 w-12 rounded-full" />
                <Skeleton className="h-3 w-12" />
                <Skeleton className={`mt-1 w-full ${h} rounded-t-xl`} />
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-2 px-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="card flex items-center gap-3 p-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-6 w-6 rounded-lg" />
                <Skeleton className="h-3.5 flex-1" />
                <Skeleton className="h-4 w-10" />
              </div>
            ))}
          </div>
        </>
      ) : (
      <>
      {/* podium */}
      <div className="mx-4 mt-4 flex items-end justify-center gap-3 rounded-card p-4"
        style={{ background: 'linear-gradient(160deg,rgba(139,92,255,.14),rgba(34,211,238,.06))', border: '1px solid var(--glass-brd)' }}>
        {podium.map(({ r, place, h, grad }) => (
          <div key={place} className="flex flex-1 flex-col items-center">
            <div className="relative mb-2">
              {place === 1 && <Crown className="absolute -top-5 left-1/2 h-5 w-5 -translate-x-1/2 text-gold" fill="#FFD466" strokeWidth={1.6} />}
              <div className="grid h-12 w-12 place-items-center rounded-full text-2xl" style={{ background: 'var(--surface-2)', border: `2px solid ${place === 1 ? '#FFD466' : 'var(--glass-brd)'}`, boxShadow: r.me ? 'var(--glow)' : 'none' }}>{r.avatar}</div>
            </div>
            <div className="max-w-full truncate text-[12px] font-bold">{r.me ? t('game.you') : r.name}</div>
            <div className="tnum text-[11px] font-semibold text-emerald2">{r.wins} W</div>
            <div className={`mt-2 w-full ${h} rounded-t-xl`} style={{ backgroundImage: grad, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.3)' }}>
              <div className="pt-1 text-center font-display text-lg font-extrabold" style={{ color: '#2A1D00' }}>{place}</div>
            </div>
          </div>
        ))}
      </div>

      {/* rest */}
      <div className="mt-4 space-y-2 px-4">
        {rest.map((r, i) => (
          <div key={i} className={`card flex items-center gap-3 p-3 ${r.me ? 'ring-2 ring-gold' : ''}`}>
            <div className="grid h-8 w-8 place-items-center rounded-full text-sm font-bold" style={{ background: 'var(--glass)' }}>{i + 4}</div>
            <div className="text-xl">{r.avatar}</div>
            <div className="flex-1 truncate text-sm font-semibold">{r.name}{r.me && ` (${t('game.you')})`}</div>
            <div className="tnum font-bold text-emerald2">{r.wins} W</div>
          </div>
        ))}
      </div>
      </>
      )}
    </div>
  )
}
