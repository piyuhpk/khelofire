import { useEffect, useRef, useState } from 'react'
import { MessageCircle, Send } from 'lucide-react'
import { useT } from '../../i18n'
import { Sheet } from '../../ui/components'
import { useStore } from '../../lib/store'
import { useRoomChat } from '../../lib/realtime'

interface Msg { id: number; me: boolean; text: string }
let seq = 1

// In-match chat: REAL cross-device via Supabase broadcast when roomId is set,
// bot auto-reply fallback otherwise.
export function MatchChat({ opponentName, roomId }: { opponentName: string; roomId?: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const quicks = [t('chat.quick1'), t('chat.quick2'), t('chat.quick3'), t('chat.quick4')]
  const meId = useStore((s) => s.playerId)
  const { msgs: roomMsgs, send: roomSend } = useRoomChat(roomId ?? null, () => {
    setTimeout(() => setLocal((m) => [...m, { id: seq++, me: false, text: quicks[Math.floor(Math.random() * quicks.length)] }]), 900)
  })
  const msgs: Msg[] = [
    ...local,
    ...roomMsgs.map((r, k) => ({ id: 100000 + k, me: r.from === meId, text: (r.from === meId ? '' : `${r.from.slice(-4)}: `) + r.text })),
  ]

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, open])

  const send = (body: string) => {
    const v = body.trim()
    if (!v) return
    if (roomId) { roomSend(v); setText(''); return }
    setLocal((m) => [...m, { id: seq++, me: true, text: v }])
    setText('')
    setTimeout(() => setLocal((m) => [...m, { id: seq++, me: false, text: quicks[Math.floor(Math.random() * quicks.length)] }]), 900)
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-ghost flex-1 py-2 text-sm border-white/30 text-white">
        <MessageCircle className="h-4 w-4" strokeWidth={2.2} /> {t('game.chat')}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)}>
        <div className="mb-3 flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-primary-2" strokeWidth={2.2} />
          <h3 className="font-display text-base font-extrabold">{t('chat.title')}</h3>
          <span className="ml-auto text-xs text-muted">{opponentName}</span>
        </div>

        <div className="mb-3 flex h-56 flex-col gap-2 overflow-y-auto no-scrollbar rounded-2xl p-3" style={{ background: 'var(--bg)' }}>
          {msgs.length === 0 && <p className="m-auto text-xs text-muted">{t('chat.hint')}</p>}
          {msgs.map((m) => (
            <div key={m.id} className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${m.me ? 'self-end text-white' : 'self-start'}`}
              style={m.me ? { backgroundImage: 'var(--grad)' } : { background: 'var(--glass)', border: '1px solid var(--glass-brd)' }}>
              {m.text}
            </div>
          ))}
          <div ref={endRef} />
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          {quicks.map((q) => (
            <button key={q} onClick={() => send(q)} className="chip text-xs font-semibold" style={{ background: 'var(--glass)', border: '1px solid var(--glass-brd)' }}>{q}</button>
          ))}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); send(text) }} className="flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('chat.hint')} className="input flex-1" />
          <button type="submit" className="btn-primary px-4" aria-label={t('chat.send')}><Send className="h-4 w-4" strokeWidth={2.2} /></button>
        </form>
      </Sheet>
    </>
  )
}
