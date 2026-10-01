import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Landmark, Gift, ReceiptText, ChevronRight, Trophy, Sparkles, Megaphone, X, Crosshair, Dices, Crown } from 'lucide-react'
import { useT, useI18n } from '../../i18n'
import { BANNERS } from '../../lib/catalog'
import { useStore } from '../../lib/store'
import { useToast, HomeSkeleton, useReady } from '../../ui/components'
import { Pin, Die, VsCoin, Disc } from './GameArt'

function BannerArt({ art }: { art: string }) {
  if (art === 'refer')
    return (
      <div className="relative flex items-center justify-center">
        <Pin color="green" size={40} style={{ transform: 'rotate(-12deg)' }} />
        <Gift className="mx-0.5 h-12 w-12 -translate-y-1" strokeWidth={1.6} fill="#4ADE80" style={{ color: '#16A34A', filter: 'drop-shadow(0 6px 8px rgba(0,0,0,.4))' }} />
        <Pin color="yellow" size={40} style={{ transform: 'rotate(12deg)' }} />
      </div>
    )
  if (art === 'chess')
    return (
      <div className="relative flex items-end justify-center gap-1">
        <span style={{ fontSize: 54, lineHeight: 1, filter: 'drop-shadow(0 6px 7px rgba(0,0,0,.5))' }}>♚</span>
        <VsCoin size={30} className="-translate-y-3" />
        <Disc color="red" size={40} />
      </div>
    )
  return (
    <div className="relative flex items-center justify-center">
      <Pin color="red" size={40} style={{ transform: 'rotate(-12deg)' }} />
      <Trophy className="mx-0.5 h-12 w-12 -translate-y-1" strokeWidth={1.6} fill="#FFCB4D" style={{ color: '#FFD873', filter: 'drop-shadow(0 6px 8px rgba(245,166,35,.55))' }} />
      <Pin color="blue" size={40} style={{ transform: 'rotate(12deg)' }} />
      <Die size={30} className="absolute -bottom-1 right-6" style={{ transform: 'rotate(12deg)' }} />
    </div>
  )
}

function Hero() {
  const { lang } = useI18n()
  const t = useT()
  const nav = useNavigate()
  const toast = useToast()
  const referralCode = useStore((s) => s.referralCode)
  const [i, setI] = useState(0)
  // admin-managed banners (Admin → Banners) show FIRST, then the built-in ones
  const adminBanners = useStore((s) => s.banners.filter((b) => b.active))
  const slides: any[] = adminBanners.length
    ? [
        ...adminBanners.map((b) => ({
          id: b.id, titleBn: b.titleBn, titleEn: b.titleEn,
          subBn: '', subEn: '', ctaKey: 'common.playNow', art: '',
          bg: 'linear-gradient(135deg,#7C3AED 0%,#0E7490 100%)', glow: 'rgba(124,58,237,.5)',
          go: '/', url: b.url, backgroundImage: '',
        })),
        ...BANNERS,
      ]
    : BANNERS
  useEffect(() => { const id = setInterval(() => setI((x) => (x + 1) % slides.length), 4500); return () => clearInterval(id) }, [slides.length])
  const b = slides[Math.min(i, slides.length - 1)]
  const cta = () => {
    if (b.url) { window.open(b.url, '_blank'); return }
    if (b.id === 'b2') { navigator.clipboard?.writeText(referralCode); toast(t('home.refer') + ' ✓ ' + referralCode, 'ok') } else nav(b.go)
  }
  const bgStyle = b.backgroundImage ? { backgroundImage: `url(${b.backgroundImage})`, backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: `0 18px 44px -18px ${b.glow}, inset 0 0 0 1px rgba(255,255,255,.14)` } : { backgroundImage: b.bg, boxShadow: `0 18px 44px -18px ${b.glow}, inset 0 0 0 1px rgba(255,255,255,.14)` }
  return (
    <div className="px-4 pt-3">
      <div key={b.id} className="relative overflow-hidden rounded-card p-5 min-h-[150px] flex text-white animate-fade-in"
        style={bgStyle}>
        <div className="absolute -right-6 -top-10 h-36 w-36 rounded-full bg-white/15 blur-2xl" />
        <Sparkles className="absolute right-3 top-3 h-5 w-5 text-white/40 animate-float" strokeWidth={1.6} />
        <div className="relative z-10 flex-1 pr-2">
          <h2 className="font-display text-[26px] font-extrabold leading-[1.08] whitespace-pre-line text-grad-gold drop-shadow-sm">{lang === 'bn' ? b.titleBn : b.titleEn}</h2>
          <p className="text-white/85 text-[11px] mt-2 leading-tight">{lang === 'bn' ? b.subBn : b.subEn}</p>
          <button onClick={cta} className="btn-gold mt-3 w-fit py-2 px-4 text-sm">{t(b.ctaKey as any)}</button>
        </div>
        <div className="relative z-10 w-[120px] shrink-0 self-center"><BannerArt art={b.art} /></div>
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
          {slides.map((_, k) => <span key={k} className={`h-1.5 rounded-full transition-all ${k === i ? 'w-5 bg-white' : 'w-1.5 bg-white/40'}`} />)}
        </div>
      </div>
    </div>
  )
}

function AnnouncementBar() {
  const { lang } = useI18n()
  const nav = useNavigate()
  const list = useStore((s) => s.announcements)
  const dismissed = useStore((s) => s.dismissedAnnId)
  const dismiss = useStore((s) => s.dismissAnnouncement)
  // targeted announcements only show for the chosen user
  const myAdminId = useStore((s) => s.adminUsers.find((u) => u.name === s.username && u.status !== 'deleted')?.id)
  const a = list.find((x) => !x.targetUserId || x.targetUserId === myAdminId)
  if (!a || dismissed === a.id) return null
  return (
    <div className="mx-4 mt-3 flex items-center gap-2.5 rounded-2xl px-3 py-2.5 animate-fade-in" style={{ background: 'rgba(34,211,238,.1)', border: '1px solid rgba(34,211,238,.28)' }}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white" style={{ backgroundImage: 'var(--grad-cyan)' }}><Megaphone className="h-4 w-4" strokeWidth={2.2} /></span>
      <button onClick={() => nav('/notifications')} className="min-w-0 flex-1 text-left">
        <div className="truncate text-[13px] font-bold">{lang === 'bn' ? a.titleBn : a.titleEn}</div>
        <div className="truncate text-[11px] text-muted">{lang === 'bn' ? a.bodyBn : a.bodyEn}</div>
      </button>
      <button onClick={() => dismiss(a.id)} className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted" aria-label="dismiss"><X className="h-4 w-4" /></button>
    </div>
  )
}

function QuickActions() {
  const t = useT()
  const nav = useNavigate()
  const actions = [
    { Icon: Plus, key: 'home.addMoney', grad: 'var(--grad)', go: () => nav('/wallet') },
    { Icon: Landmark, key: 'home.withdraw', grad: 'var(--grad-emerald)', go: () => nav('/wallet?tab=withdraw') },
    { Icon: Gift, key: 'home.refer', grad: 'var(--grad-gold)', go: () => nav('/refer') },
    { Icon: ReceiptText, key: 'home.transactions', grad: 'var(--grad-cyan)', go: () => nav('/wallet?tab=history') },
  ] as const
  return (
    <div className="grid grid-cols-4 gap-2.5 px-4 pt-4 stg">
      {actions.map((a) => (
        <button key={a.key} onClick={a.go} className="card flex flex-col items-center gap-1.5 py-3 active:scale-95 transition">
          <span className="grid h-10 w-10 place-items-center rounded-xl text-white shadow-glow" style={{ backgroundImage: a.grad }}><a.Icon className="h-5 w-5" strokeWidth={2.2} /></span>
          <span className="text-[11px] font-semibold text-center leading-tight">{t(a.key as any)}</span>
        </button>
      ))}
    </div>
  )
}

// Boss's structure: three top-level category cards. Free Fire & Ludo King are
// played OUTSIDE the app (room code + result screenshot); In Game holds the
// instant in-app games (Ludo/Chess/16 Guti/Dice).
function Categories() {
  const t = useT()
  const nav = useNavigate()
  const categoryImages = useStore((s) => s.categoryImages)
  const cats = [
    { to: '/freefire', title: t('cat.freefire'), sub: t('cat.freefireSub'), Icon: Crosshair, bg: 'linear-gradient(135deg,#8e0e00 0%,#1f1c18 100%)', live: t('cat.ffLive'), glow: 'rgba(226,59,73,.5)', imageKey: 'freefire' },
    { to: '/ingame', title: t('cat.ingame'), sub: t('cat.ingameSub'), Icon: Dices, bg: 'linear-gradient(135deg,#0e7490 0%,#083344 100%)', live: t('cat.igLive'), glow: 'rgba(34,211,238,.5)', imageKey: 'ingame' },
    { to: '/lobby/ludo', title: t('cat.ludoking'), sub: t('cat.ludokingSub'), Icon: Crown, bg: 'linear-gradient(135deg,#6d28d9 0%,#2e1065 100%)', live: t('cat.lkLive'), glow: 'rgba(139,92,255,.55)', imageKey: 'ludoking' },
  ]
  return (
    <div className="px-4 pt-5 stg">
      <div className="mb-3 flex items-center justify-between px-1">
        <h3 className="sect-title">{t('cat.title')}</h3>
        <span className="text-[11px] font-semibold text-muted">{t('cat.pick')}</span>
      </div>
      <div className="space-y-3.5">
        {cats.map((c) => {
          const customImage = categoryImages[c.imageKey as keyof typeof categoryImages]
          const bgStyle = customImage ? { backgroundImage: `url(${customImage})`, backgroundSize: 'cover', backgroundPosition: 'center', minHeight: 116, boxShadow: `0 20px 40px -20px ${c.glow}, inset 0 0 0 1px rgba(255,255,255,.16)` } : { backgroundImage: c.bg, minHeight: 116, boxShadow: `0 20px 40px -20px ${c.glow}, inset 0 0 0 1px rgba(255,255,255,.16)` }
          return (
            <button key={c.to} onClick={() => nav(c.to)}
              className="group relative flex w-full items-center gap-4 overflow-hidden rounded-card p-4 text-left text-white active:scale-[.98] transition"
              style={bgStyle}>
              {/* top gloss */}
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ background: 'linear-gradient(180deg,rgba(0,0,0,.3),transparent)' }} />
              {/* corner watermark + rays */}
              <c.Icon className="pointer-events-none absolute -right-4 -bottom-5 h-28 w-28 text-white/10" strokeWidth={1.3} />
              <span className="pointer-events-none absolute right-6 top-3 h-14 w-14 rounded-full bg-white/15 blur-2xl" />
              {/* medallion */}
              <span className="relative grid h-16 w-16 shrink-0 place-items-center rounded-2xl"
                style={{ background: 'rgba(0,0,0,.4)', border: '1px solid rgba(255,255,255,.35)', boxShadow: 'inset 0 2px 6px rgba(255,255,255,.3), inset 0 -3px 8px rgba(0,0,0,.5)' }}>
                <c.Icon className="h-8 w-8 drop-shadow" strokeWidth={2} />
              </span>
              <div className="relative z-10 min-w-0 flex-1">
                <div className="font-display text-xl font-extrabold leading-tight drop-shadow-sm">{c.title}</div>
                <div className="mt-0.5 text-[12px] text-white/85 leading-tight">{c.sub}</div>
                <span className="mt-2 inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[10px] font-bold" style={{ background: 'rgba(0,0,0,.5)', border: '1px solid rgba(255,255,255,.15)' }}>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald2 animate-pulse" />{c.live}
                </span>
              </div>
              <span className="relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/18 transition group-active:translate-x-0.5" style={{ border: '1px solid rgba(255,255,255,.28)' }}>
                <ChevronRight className="h-5 w-5" strokeWidth={2.6} />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function Home() {
  const { lang } = useI18n()
  const nav = useNavigate()
  const username = useStore((s) => s.username)
  const authed = useStore((s) => s.authed)
  const ready = useReady(600)
  if (!ready) return <HomeSkeleton />
  return (
    <div className="pb-8">
      <div className="flex items-center justify-between px-4 pt-4">
        <div>
          <div className="text-xs text-muted">{lang === 'bn' ? 'স্বাগতম' : 'Welcome'}</div>
          <div className="font-display text-lg font-extrabold leading-tight">{authed ? `${username} 👋` : lang === 'bn' ? 'গেস্ট হিসেবে খেলছেন' : 'Playing as Guest'}</div>
        </div>
        {!authed && (
          <button onClick={() => nav('/login')} className="btn-primary py-2 px-4 text-sm">
            {lang === 'bn' ? 'লগইন / সাইনআপ' : 'Login / Sign up'}
          </button>
        )}
      </div>
      <AnnouncementBar />
      <Hero />
      <QuickActions />
      <Categories />
    </div>
  )
}
