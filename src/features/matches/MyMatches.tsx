import { useT } from '../../i18n'
import { useStore, type Outcome } from '../../lib/store'
import { fmt } from '../../lib/money'
import { EmptyState, ListSkeleton, useReady } from '../../ui/components'

const badge: Record<Outcome, string> = {
  win: 'bg-emerald2/15 text-emerald2', loss: 'bg-danger/15 text-danger',
  draw: 'bg-gold/15 text-navy dark:text-gold', cancelled: 'bg-navy/10 text-muted',
}

export default function MyMatches() {
  const t = useT()
  const matches = useStore((s) => s.matches)
  const ready = useReady(550)
  return (
    <div className="p-4">
      <h1 className="text-lg font-extrabold mb-3">{t('matches.title')}</h1>
      {!ready ? <ListSkeleton rows={5} /> : matches.length === 0 ? <EmptyState icon="🎯" title={t('matches.empty')} /> : (
        <div className="space-y-2">
          {matches.map((mt) => (
            <div key={mt.id} className="card p-3 flex items-center gap-3">
              <div className="text-2xl">{({ ludo: '🎲', chess: '♟️', guti: '⚫', dice: '🎲' } as Record<string, string>)[mt.game] ?? '🎮'}</div>
              <div className="flex-1">
                <div className="text-sm font-bold">{mt.mode}</div>
                <div className="text-[11px] text-muted">{new Date(mt.ts).toLocaleString()}{mt.moves ? ` · ${mt.moves} ${t('result.moves')}` : ''}</div>
              </div>
              <div className="text-right">
                <span className={`chip text-xs font-bold ${badge[mt.outcome]}`}>{t(`result.${mt.outcome === 'loss' ? 'loss' : mt.outcome === 'win' ? 'win' : mt.outcome === 'draw' ? 'draw' : 'cancelled'}` as any)}</span>
                <div className={`text-sm font-bold mt-1 ${mt.deltaMinor >= 0 ? 'text-emerald2' : 'text-danger'}`}>{mt.deltaMinor >= 0 ? '+' : ''}{fmt(mt.deltaMinor)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
