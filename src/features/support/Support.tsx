import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, LifeBuoy, MessageCircle, Plus, Send, ChevronDown, Ticket as TicketIcon } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useStore } from '../../lib/store'
import { useToast, Sheet, EmptyState } from '../../ui/components'

const CATS = ['Payment', 'Withdrawal', 'Gameplay', 'Account', 'Other']

export default function Support() {
  const nav = useNavigate()
  const { lang } = useI18n()
  const toast = useToast()
  const tickets = useStore((s) => s.tickets)
  const createTicket = useStore((s) => s.createTicket)
  const replyTicket = useStore((s) => s.replyTicket)
  const L = (bn: string, en: string) => (lang === 'bn' ? bn : en)

  const [openId, setOpenId] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [cat, setCat] = useState(CATS[0])
  const [body, setBody] = useState('')
  const [reply, setReply] = useState('')
  const [faq, setFaq] = useState<number | null>(0)
  const endRef = useRef<HTMLDivElement>(null)

  const active = tickets.find((tk) => tk.id === openId) || null
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [active?.msgs.length, openId])

  const submitNew = () => {
    if (!subject.trim() || !body.trim()) return toast(L('সব ঘর পূরণ করুন', 'Fill all fields'), 'err')
    const id = createTicket(subject.trim(), cat, body.trim())
    setSubject(''); setBody(''); setCat(CATS[0]); setNewOpen(false); setOpenId(id)
    toast(L('টিকিট তৈরি হয়েছে ✓', 'Ticket created ✓'), 'ok')
  }
  const sendReply = () => { if (!reply.trim() || !active) return; replyTicket(active.id, reply.trim()); setReply('') }

  const FAQS = [
    { q: L('টাকা কীভাবে যোগ করব?', 'How do I add money?'), a: L('ওয়ালেট → টাকা যোগ করুন। ডেমোতে তাৎক্ষণিক যোগ হয়।', 'Wallet → Add Money. In demo it credits instantly.') },
    { q: L('উইথড্র কতক্ষণে আসে?', 'How long do withdrawals take?'), a: L('রিকোয়েস্ট পেন্ডিং থাকে; অ্যাডমিন রিভিউ করে অ্যাপ্রুভ করে।', 'Requests go pending; an admin reviews and approves them.') },
    { q: L('ম্যাচ বাতিল হলে ফি ফেরত?', 'Refund if a match is cancelled?'), a: L('হ্যাঁ, বাতিল/ড্র হলে এন্ট্রি ফি ফেরত পাওয়া যায়।', 'Yes — entry fee is refunded on cancel/draw.') },
    { q: L('রেফার বোনাস কীভাবে পাই?', 'How do I get referral bonus?'), a: L('প্রোফাইল → রেফার ও আয়। বন্ধু জয়েন করলে দুজনেই বোনাস পান।', 'Profile → Refer & Earn. When a friend joins you both earn.') },
  ]

  return (
    <div className="p-4 pb-8">
      <div className="mb-4 flex items-center gap-2.5">
        <button onClick={() => nav(-1)} className="grid h-9 w-9 place-items-center rounded-full active:scale-90 transition" style={{ background: 'var(--glass)', border: '1px solid var(--glass-brd)' }}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="font-display text-lg font-extrabold flex items-center gap-2"><LifeBuoy className="h-5 w-5 text-cyan2" strokeWidth={2.2} />{L('সাহায্য ও সাপোর্ট', 'Help & Support')}</h1>
      </div>

      {/* live chat CTA */}
      <button onClick={() => setNewOpen(true)} className="relative w-full overflow-hidden rounded-card p-4 text-left text-white" style={{ backgroundImage: 'var(--grad-cyan)', boxShadow: 'var(--glow-cyan)' }}>
        <MessageCircle className="absolute -right-2 -top-2 h-20 w-20 text-white/15" strokeWidth={1.4} />
        <div className="font-display text-lg font-extrabold">{L('লাইভ চ্যাট সাপোর্ট', 'Live chat support')}</div>
        <p className="mt-0.5 text-sm text-white/85">{L('সমস্যা লিখুন — টিম দ্রুত উত্তর দেবে', 'Describe your issue — our team replies fast')}</p>
        <span className="mt-3 inline-flex items-center gap-1.5 rounded-pill bg-white/20 px-3 py-1.5 text-sm font-bold"><Plus className="h-4 w-4" strokeWidth={2.6} />{L('নতুন টিকিট', 'New ticket')}</span>
      </button>

      {/* FAQ */}
      <h2 className="sect-title mt-5 mb-2">{L('সাধারণ প্রশ্ন', 'FAQ')}</h2>
      <div className="space-y-2">
        {FAQS.map((f, i) => (
          <div key={i} className="card overflow-hidden">
            <button onClick={() => setFaq(faq === i ? null : i)} className="flex w-full items-center gap-2 p-3.5 text-left">
              <span className="flex-1 text-sm font-semibold">{f.q}</span>
              <ChevronDown className={`h-4 w-4 text-muted transition ${faq === i ? 'rotate-180' : ''}`} />
            </button>
            {faq === i && <div className="px-3.5 pb-3.5 text-[13px] text-muted">{f.a}</div>}
          </div>
        ))}
      </div>

      {/* tickets */}
      <div className="mt-5 mb-2 flex items-center justify-between">
        <h2 className="sect-title">{L('আমার টিকিট', 'My tickets')}</h2>
        <button onClick={() => setNewOpen(true)} className="chip text-xs font-bold text-primary-2" style={{ background: 'rgba(139,92,255,.14)' }}><Plus className="h-3.5 w-3.5" strokeWidth={2.6} />{L('নতুন', 'New')}</button>
      </div>
      {tickets.length === 0 ? <EmptyState icon="🎫" title={L('কোনো টিকিট নেই', 'No tickets yet')} /> : (
        <div className="space-y-2">
          {tickets.map((tk) => (
            <button key={tk.id} onClick={() => setOpenId(tk.id)} className="card flex w-full items-center gap-3 p-3 text-left active:scale-[.99] transition">
              <TicketIcon className="h-5 w-5 text-cyan2 shrink-0" strokeWidth={2} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{tk.subject}</div>
                <div className="text-[11px] text-muted">{tk.category} · {tk.id}</div>
              </div>
              <span className="chip text-[10px] font-bold" style={{
                background: tk.status === 'answered' ? 'rgba(31,203,139,.15)' : tk.status === 'closed' ? 'var(--glass)' : 'rgba(255,212,102,.15)',
                color: tk.status === 'answered' ? 'var(--emerald)' : tk.status === 'closed' ? 'var(--muted)' : 'var(--gold)',
              }}>{tk.status}</span>
            </button>
          ))}
        </div>
      )}

      {/* new-ticket form */}
      <Sheet open={newOpen} onClose={() => setNewOpen(false)}>
        <h3 className="mb-3 font-display text-base font-extrabold">{L('নতুন টিকিট', 'New ticket')}</h3>
        <div className="space-y-3">
          <div><label className="label">{L('বিষয়', 'Subject')}</label><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={L('সংক্ষেপে সমস্যা', 'Short summary')} /></div>
          <div><label className="label">{L('বিভাগ', 'Category')}</label><select className="input" value={cat} onChange={(e) => setCat(e.target.value)}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label">{L('বিস্তারিত', 'Message')}</label><textarea className="input min-h-[90px]" value={body} onChange={(e) => setBody(e.target.value)} placeholder={L('আপনার সমস্যা লিখুন…', 'Describe your issue…')} /></div>
          <button onClick={submitNew} className="btn-primary w-full"><Send className="h-4 w-4" strokeWidth={2.2} />{L('জমা দিন', 'Submit')}</button>
        </div>
      </Sheet>

      {/* ticket thread (live chat) */}
      <Sheet open={!!active} onClose={() => setOpenId(null)}>
        {active && (
          <>
            <div className="mb-3 flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-cyan2" strokeWidth={2.2} />
              <div className="min-w-0"><h3 className="truncate font-display text-base font-extrabold">{active.subject}</h3><div className="text-[11px] text-muted">{active.category} · {active.id}</div></div>
            </div>
            <div className="mb-3 flex h-56 flex-col gap-2 overflow-y-auto no-scrollbar rounded-2xl p-3" style={{ background: 'var(--bg)' }}>
              {active.msgs.map((m, i) => (
                <div key={i} className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.me ? 'self-end text-white' : 'self-start'}`}
                  style={m.me ? { backgroundImage: 'var(--grad)' } : { background: 'var(--glass)', border: '1px solid var(--glass-brd)' }}>{m.text}</div>
              ))}
              <div ref={endRef} />
            </div>
            <form onSubmit={(e) => { e.preventDefault(); sendReply() }} className="flex gap-2">
              <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder={L('উত্তর লিখুন…', 'Type a reply…')} className="input flex-1" />
              <button type="submit" className="btn-primary px-4"><Send className="h-4 w-4" strokeWidth={2.2} /></button>
            </form>
          </>
        )}
      </Sheet>
    </div>
  )
}
