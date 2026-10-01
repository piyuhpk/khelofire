import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useT, useI18n } from '../../i18n'
import { useStore } from '../../lib/store'
import { EmptyState, ListSkeleton, useReady } from '../../ui/components'

export default function Notifications() {
  const t = useT()
  const nav = useNavigate()
  const { lang } = useI18n()
  const notifs = useStore((s) => s.notifs)
  const markRead = useStore((s) => s.markNotifsRead)
  const ready = useReady(550)
  useEffect(() => { const id = setTimeout(markRead, 800); return () => clearTimeout(id) }, []) // eslint-disable-line
  return (
    <div className="p-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => nav(-1)} className="text-xl">←</button>
        <h1 className="text-lg font-extrabold">🔔 {t('notif.title')}</h1>
      </div>
      {!ready ? <ListSkeleton rows={5} /> : notifs.length === 0 ? <EmptyState icon="🔕" title={t('notif.empty')} /> : (
        <div className="space-y-2">
          {notifs.map((n) => (
            <div key={n.id} className={`card p-3 flex gap-3 ${!n.read ? 'border-l-4 border-gold' : ''}`}>
              <div className="text-xl">{n.type === 'result' ? '🎯' : n.type === 'tournament' ? '🏆' : '👋'}</div>
              <div className="flex-1">
                <div className="text-sm font-semibold">{lang === 'bn' ? n.titleBn : n.titleEn}</div>
                <div className="text-[11px] text-muted">{new Date(n.ts).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
