import { createContext, useContext, useEffect, useState, type ReactNode, type CSSProperties } from 'react'
import { CheckCircle2, AlertTriangle, Info, Inbox } from 'lucide-react'
import { useT } from '../i18n'

// ---- Skeleton loaders ----
// `.skel` (shimmer sweep) is defined in index.css. `useReady` fakes a short
// fetch so the shimmer is actually seen before real (synchronous) data renders.
export function useReady(ms = 600) {
  const [ready, setReady] = useState(false)
  useEffect(() => { const id = setTimeout(() => setReady(true), ms); return () => clearTimeout(id) }, [ms])
  return ready
}

export function Skeleton({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <div className={`skel ${className}`} style={style} />
}

// row placeholder for list screens (matches / notifications / wallet history)
export function ListSkeleton({ rows = 5, avatar = true }: { rows?: number; avatar?: boolean }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card flex items-center gap-3 p-3">
          {avatar && <Skeleton className="h-10 w-10 shrink-0 rounded-full" />}
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-2.5 w-3/5" />
          </div>
          <Skeleton className="h-6 w-14 rounded-pill" />
        </div>
      ))}
    </div>
  )
}

// full-screen placeholder mirroring the Home layout (hero → quick actions → tiles)
export function HomeSkeleton() {
  return (
    <div className="pb-8">
      <div className="flex items-center justify-between px-4 pt-4">
        <div className="space-y-2"><Skeleton className="h-3 w-16" /><Skeleton className="h-5 w-28" /></div>
      </div>
      <div className="px-4 pt-3"><Skeleton className="min-h-[150px] w-full rounded-card" /></div>
      <div className="grid grid-cols-4 gap-2.5 px-4 pt-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[76px] rounded-card" />)}
      </div>
      {Array.from({ length: 2 }).map((_, s) => (
        <div key={s} className="px-4 pt-6">
          <div className="mb-3 flex items-center justify-between px-1"><Skeleton className="h-6 w-32" /><Skeleton className="h-4 w-10" /></div>
          <div className="grid grid-cols-2 gap-3 px-1">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="min-h-[172px] rounded-card" />)}
          </div>
        </div>
      ))}
    </div>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/25 border-t-white ${className}`} />
  )
}

export function Modal({ open, onClose, children }: { open: boolean; onClose?: () => void; children: ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ background: 'rgba(4,6,14,.72)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div className="w-full max-w-[420px] card-solid p-5 animate-slide-up shadow-elevated" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

export function Sheet({ open, onClose, children }: { open: boolean; onClose?: () => void; children: ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center animate-fade-in"
      style={{ background: 'rgba(4,6,14,.72)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div className="w-full max-w-[460px] rounded-t-sheet p-5 pb-8 animate-sheet-up shadow-elevated"
        style={{ background: 'var(--surface)', borderTop: '1px solid var(--glass-brd)' }} onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full" style={{ background: 'var(--line)' }} />
        {children}
      </div>
    </div>
  )
}

export function EmptyState({ icon, title }: { icon?: ReactNode; title: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 grid h-16 w-16 place-items-center rounded-2xl text-muted" style={{ background: 'var(--glass)', border: '1px solid var(--glass-brd)' }}>
        {icon ?? <Inbox className="h-7 w-7" strokeWidth={1.6} />}
      </div>
      <p className="text-muted font-medium">{title}</p>
    </div>
  )
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  const t = useT()
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 grid h-16 w-16 place-items-center rounded-2xl text-danger" style={{ background: 'rgba(255,92,105,.12)' }}>
        <AlertTriangle className="h-7 w-7" strokeWidth={1.8} />
      </div>
      <p className="text-muted font-medium mb-4">{t('error.generic')}</p>
      {onRetry && <button className="btn-ghost" onClick={onRetry}>{t('common.retry')}</button>}
    </div>
  )
}

// ---- Toast ----
interface Toast { id: number; msg: string; kind: 'ok' | 'err' | 'info' }
const ToastCtx = createContext<(msg: string, kind?: Toast['kind']) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

const TOAST_ICON = { ok: CheckCircle2, err: AlertTriangle, info: Info }
const TOAST_ACCENT = { ok: 'var(--emerald)', err: 'var(--danger)', info: 'var(--primary)' }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = (msg: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, msg, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600)
  }
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed left-1/2 top-4 z-[60] flex -translate-x-1/2 flex-col gap-2 w-[90%] max-w-[420px]">
        {toasts.map((t) => {
          const Icon = TOAST_ICON[t.kind]
          return (
            <div key={t.id} className="card-solid flex items-center gap-2.5 px-4 py-3 text-sm font-semibold animate-slide-up shadow-elevated"
              style={{ borderLeft: `3px solid ${TOAST_ACCENT[t.kind]}` }}>
              <Icon className="h-5 w-5 shrink-0" style={{ color: TOAST_ACCENT[t.kind] }} strokeWidth={2} />
              <span className="text-text">{t.msg}</span>
            </div>
          )
        })}
      </div>
    </ToastCtx.Provider>
  )
}

export function useCountdown(seconds: number, active: boolean, onZero?: () => void) {
  const [left, setLeft] = useState(seconds)
  useEffect(() => { setLeft(seconds) }, [seconds])
  useEffect(() => {
    if (!active) return
    if (left <= 0) { onZero?.(); return }
    const id = setTimeout(() => setLeft((l) => l - 1), 1000)
    return () => clearTimeout(id)
  }, [left, active]) // eslint-disable-line
  return left
}
