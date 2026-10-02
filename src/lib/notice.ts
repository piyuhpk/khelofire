// A tiny event sink so non-React modules (store, sync, wallet) can surface a
// message in the existing toast UI. React context alone cannot reach them:
// the old code swallowed every error with `.then(() => {})`, which is exactly
// how a failed write became a silent failure the user could not see.

export type NoticeKind = 'ok' | 'err' | 'info'

type Sink = (msg: string, kind?: NoticeKind) => void

let sink: Sink | null = null

/** Wired up once by ToastProvider. */
export function setNoticeSink(fn: Sink | null) {
  sink = fn
}

/** Show a toast if the UI is mounted; safe to call from anywhere. */
export function notify(msg: string, kind: NoticeKind = 'info') {
  sink?.(msg, kind)
}

/** Report a caught error without swallowing it. */
export function notifyError(what: string, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  notify(`${what}: ${msg}`, 'err')
  if (import.meta.env.DEV) console.error(what, e)
}