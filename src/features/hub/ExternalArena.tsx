import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Crosshair, Crown, Trophy, Users, Clock, Copy, Upload, ExternalLink, ShieldCheck } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useStore } from '../../lib/store'
import { fmt, toMinor } from '../../lib/money'
import { useToast, Sheet } from '../../ui/components'

type Kind = 'freefire' | 'ludoking'
interface Match { id: string; title: string; sub: string; prizeMinor: number; entryMinor: number; slots: number; joined: number; when: string; room: string; pass: string }

const DATA: Record<Kind, { title: string; Icon: typeof Crosshair; accent: string; bg: string; matches: Match[] }> = {
  freefire: {
    title: 'Free Fire', Icon: Crosshair, accent: '#E5484D', bg: 'linear-gradient(160deg,#8e0e00,#1f1c18)',
    matches: [
      { id: 'ff1', title: 'Squad BR — Night Clash', sub: 'Squad (4P) · Purgatory', prizeMinor: toMinor(5000), entryMinor: toMinor(50), slots: 48, joined: 38, when: 'Today 10:00 PM', room: '', pass: '' },
      { id: 'ff2', title: '৳50,000 Mega Cup', sub: 'Squad (4P) · 3 Maps', prizeMinor: toMinor(50000), entryMinor: toMinor(250), slots: 48, joined: 41, when: 'Sun 9:00 PM', room: '', pass: '' },
      { id: 'ff3', title: 'Clash Squad 4v4', sub: 'Custom arena', prizeMinor: toMinor(1200), entryMinor: toMinor(20), slots: 8, joined: 5, when: 'Today 8:00 PM', room: '', pass: '' },
      { id: 'ff4', title: 'Lone Wolf 1v1', sub: 'Sniper only', prizeMinor: toMinor(300), entryMinor: 0, slots: 2, joined: 1, when: 'Now', room: '', pass: '' },
    ],
  },
  ludoking: {
    title: 'Ludo King', Icon: Crown, accent: '#8B5CFF', bg: 'linear-gradient(160deg,#6d28d9,#2e1065)',
    matches: [
      { id: 'lk1', title: 'Classic 1v1 · ৳36', sub: 'Room code · winner takes all', prizeMinor: toMinor(36), entryMinor: toMinor(20), slots: 2, joined: 1, when: 'Now', room: '', pass: '' },
      { id: 'lk2', title: 'Classic ৳2,000 Event', sub: 'Room code · 2 players', prizeMinor: toMinor(2000), entryMinor: toMinor(1100), slots: 2, joined: 1, when: 'Today 6:00 PM', room: '', pass: '' },
      { id: 'lk3', title: '4-Player Battle · ৳100', sub: 'Room code · last standing', prizeMinor: toMinor(100), entryMinor: toMinor(30), slots: 4, joined: 2, when: 'Now', room: '', pass: '' },
    ],
  },
}

export default function ExternalArena({ kind }: { kind: Kind }) {
  const nav = useNavigate()
  const { lang } = useI18n()
  const toast = useToast()
  const available = useStore((s) => s.availableMinor)
  const lockEntry = useStore((s) => s.lockEntry)
  const L = (bn: string, en: string) => (lang === 'bn' ? bn : en)
  const cfg = DATA[kind]

  const [sel, setSel] = useState<Match | null>(null)
  const [joined, setJoined] = useState(false)
  const [file, setFile] = useState<string | null>(null)

  const open = (m: Match) => { setSel(m); setJoined(false); setFile(null) }
  const doJoin = () => {
    if (!sel) return
    if (available < sel.entryMinor) { toast(L('ব্যালেন্স কম', 'Insufficient balance'), 'err'); return }
    if (sel.entryMinor > 0 && !lockEntry(sel.entryMinor, `Entry · ${cfg.title} ${sel.title}`)) { toast(L('ব্যালেন্স কম', 'Insufficient balance'), 'err'); return }
    setJoined(true)
    toast(L('জয়েন হয়েছে — রুমে যান', 'Joined — open the room'), 'ok')
  }
  const roomCode = sel ? (kind === 'ludoking' ? '77' + sel.id.slice(-1) + '213' : 'FF' + sel.id.slice(-1).toUpperCase() + '9021') : ''
  const roomPass = kind === 'ludoking' ? '' : '4417'

  return (
    <div className="app-frame flex min-h-[100dvh] flex-col" style={{ background: cfg.bg }}>
      <div className="flex items-center gap-2.5 px-4 pt-4 text-white">
        <button onClick={() => nav('/')} className="grid h-9 w-9 place-items-center rounded-full bg-white/12 active:scale-90 transition"><ChevronLeft className="h-5 w-5" /></button>
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/15"><cfg.Icon className="h-5 w-5" strokeWidth={2.2} /></span>
        <div>
          <h1 className="font-display text-lg font-extrabold">{cfg.title}</h1>
          <p className="text-[11px] text-white/70">{L('বাইরে খেলুন · রেজাল্ট আপলোড করুন', 'Play outside · upload result')}</p>
        </div>
      </div>

      <div className="mt-3 flex-1 space-y-3 overflow-y-auto rounded-t-sheet bg-[color:var(--bg)] p-4 pb-8" style={{ boxShadow: '0 -10px 30px rgba(0,0,0,.4)' }}>
        {cfg.matches.map((m) => {
          const full = m.joined >= m.slots
          return (
            <div key={m.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-display font-extrabold flex items-center gap-2">{m.title}
                    <span className="chip tnum text-[11px] font-extrabold" style={{ backgroundImage: 'var(--grad-gold)', color: '#2A1D00' }}><Trophy className="h-3 w-3" strokeWidth={2.6} />{fmt(m.prizeMinor)}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">{m.sub}</div>
                </div>
                <span className="chip shrink-0 text-[11px] text-teal2" style={{ background: 'rgba(45,212,191,.12)' }}><Clock className="h-3 w-3" strokeWidth={2.4} />{m.when}</span>
              </div>
              <div className="my-3 grid grid-cols-3 gap-2 text-center">
                {[
                  { label: L('প্রাইজ', 'Prize'), val: fmt(m.prizeMinor), cls: 'text-emerald2' },
                  { label: L('এন্ট্রি', 'Entry'), val: m.entryMinor ? fmt(m.entryMinor) : L('ফ্রি', 'Free'), cls: 'text-text' },
                  { label: L('স্লট', 'Slots'), val: `${m.joined}/${m.slots}`, cls: 'text-primary-2' },
                ].map((s, k) => (
                  <div key={k} className="rounded-2xl py-2" style={{ background: 'var(--glass)', border: '1px solid var(--glass-brd)' }}>
                    <div className="flex items-center justify-center gap-1 text-[10px] text-muted">{s.label}</div>
                    <div className={`tnum mt-0.5 font-bold ${s.cls}`}>{s.val}</div>
                  </div>
                ))}
              </div>
              <button disabled={full} onClick={() => open(m)} className="btn-primary w-full disabled:opacity-50">
                <Users className="h-4 w-4" strokeWidth={2.2} />{full ? L('ম্যাচ ফুল', 'Match full') : `${m.entryMinor ? fmt(m.entryMinor) + ' · ' : ''}${L('জয়েন করুন', 'Join match')}`}
              </button>
            </div>
          )
        })}
        <p className="pt-1 text-center text-[11px] text-muted">{L('রেজাল্ট স্ক্রিনশট অ্যাডমিন যাচাই করে ক্রেডিট করে (ডেমো)।', 'Results are verified by admin before credit (demo).')}</p>
      </div>

      {/* join → room code → result upload */}
      <Sheet open={!!sel} onClose={() => setSel(null)}>
        {sel && (
          <>
            <h3 className="mb-1 font-display text-base font-extrabold">{sel.title}</h3>
            <p className="mb-3 text-xs text-muted">{cfg.title} · {sel.sub}</p>

            {!joined ? (
              <>
                <div className="mb-3 space-y-2">
                  {[[L('এন্ট্রি', 'Entry'), sel.entryMinor ? fmt(sel.entryMinor) : L('ফ্রি', 'Free')], [L('প্রাইজ', 'Prize'), fmt(sel.prizeMinor)], [L('ব্যালেন্স', 'Balance'), fmt(available)]].map(([k, v]) => (
                    <div key={k} className="flex justify-between text-sm"><span className="text-muted">{k}</span><span className="font-bold">{v}</span></div>
                  ))}
                </div>
                <button onClick={doJoin} className="btn-primary w-full">{sel.entryMinor ? fmt(sel.entryMinor) + ' · ' : ''}{L('জয়েন করুন', 'Confirm & Join')}</button>
              </>
            ) : (
              <>
                <div className="mb-3 rounded-2xl p-3" style={{ background: 'var(--bg)' }}>
                  <div className="flex items-center justify-between">
                    <div><div className="text-[11px] text-muted">{L('রুম কোড', 'Room code')}</div><div className="tnum font-display text-xl font-extrabold tracking-wider">{roomCode}</div></div>
                    <button onClick={() => { navigator.clipboard?.writeText(roomCode); toast(L('কপি ✓', 'Copied ✓'), 'ok') }} className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: 'var(--glass)' }}><Copy className="h-4 w-4" strokeWidth={2.2} /></button>
                  </div>
                  {roomPass && <div className="mt-2 text-[12px]">{L('পাসওয়ার্ড', 'Password')}: <b className="tnum">{roomPass}</b></div>}
                </div>
                <button onClick={() => toast(L(`${cfg.title} অ্যাপ খুলুন`, `Open the ${cfg.title} app`), 'info')} className="btn-ghost mb-3 w-full"><ExternalLink className="h-4 w-4" strokeWidth={2.2} />{L(`${cfg.title} খুলুন`, `Open ${cfg.title}`)}</button>

                <label className="label">{L('রেজাল্ট স্ক্রিনশট', 'Result screenshot')}</label>
                <label className="mb-3 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed py-6 text-center" style={{ borderColor: 'var(--glass-brd)', background: 'var(--glass)' }}>
                  <Upload className="h-6 w-6 text-primary-2" strokeWidth={2} />
                  <span className="text-xs font-semibold">{file || L('স্ক্রিনশট বাছুন', 'Choose screenshot')}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0]?.name || null)} />
                </label>
                <button disabled={!file} onClick={() => { setSel(null); toast(L('রেজাল্ট জমা — যাচাই চলছে', 'Result submitted — under review'), 'ok') }} className="btn-primary w-full disabled:opacity-50">
                  <ShieldCheck className="h-4 w-4" strokeWidth={2.2} />{L('রেজাল্ট জমা দিন', 'Submit result')}
                </button>
              </>
            )}
          </>
        )}
      </Sheet>
    </div>
  )
}
