// A tiny event sink so non-React modules (store, sync, wallet) can surface a
// message in the existing toast UI. React context alone cannot reach them:
// the old code swallowed every error with `.then(() => {})`, which is exactly
// how a failed write became a silent failure the user could not see.

import { useI18n } from '../i18n'
import { serverErrMsg } from './serverErrors'

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
  // The server's own sentence, translated, not appended raw.
  //
  // This was `${what}: ${msg}` where msg was whatever the database said, so every
  // failure in the store, the sync layer and the wallet reached the user as a raw
  // exception - "Could not update the deposit: not pending", or on a server whose
  // SQL had never been pasted, "Could not load the pending requests queue: Could not
  // find the function public.list_pending_requests() in the schema cache". One of
  // those is the database talking to its administrator; neither is an answer to the
  // person who tapped the button, who reported it as the same error everywhere.
  //
  // The sentence is what gets through. The raw error is still printed in dev, where
  // it belongs.
  const msg = serverErrMsg(e, useI18n.getState().lang)
  notify(`${what}: ${msg}`, 'err')
  if (import.meta.env.DEV) console.error(what, e)
}
