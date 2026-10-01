import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Gift, Copy, Share2, Users, Coins, UserPlus, Gamepad2, Wallet as WalletIcon } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useStore } from '../../lib/store'
import { fmt } from '../../lib/money'
import { useToast, EmptyState } from '../../ui/components'

const PER_REFERRAL = 2000 // ৳20 in poisha

export default function Refer() {
  const nav = useNavigate()
  const { lang } = useI18n()
  const toast = useToast()
  const code = useStore((s) => s.referralCode)
  const referrals = useStore((s) => s.referrals)
  const earned = useStore((s) => s.referralEarnedMinor)
  const L = (bn: string, en: string) => (lang === 'bn' ? bn : en)

  const share = async () => {
    const text = L(`KheloFire-এ খেলুন আর জিতুন! আমার রেফার কোড: ${code}`, `Play & win on KheloFire! My refer code: ${code}`)
    try {
      if (navigator.share) await navigator.share({ title: 'KheloFire', text })
      else { await navigator.clipboard?.writeText(text); toast(L('কপি হয়েছে ✓', 'Copied ✓'), 'ok') }
    } catch { /* user cancelled share */ }
  }

  const steps = [
    { Icon: Share2, t: L('কোড শেয়ার করুন', 'Share your code'), d: L('বন্ধুদের রেফার কোড পাঠান', 'Send your code to friends') },
    { Icon: UserPlus, t: L('বন্ধু সাইন আপ করে', 'Friend signs up'), d: L('আপনার কোড দিয়ে জয়েন করে', 'They join using your code') },
    { Icon: Gamepad2, t: L('প্রথম ম্যাচ খেলে', 'They play a match'), d: L('দুজনেই বোনাস পান', 'You both get a bonus') },
  ]

  return (
    <div className="p-4 pb-8">
      <div className="mb-4 flex items-center gap-2.5">
        <button onClick={() => nav(-1)} className="grid h-9 w-9 place-items-center rounded-full active:scale-90 transition" style={{ background: 'var(--glass)', border: '1px solid var(--glass-brd)' }}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="font-display text-lg font-extrabold flex items-center gap-2"><Gift className="h-5 w-5 text-gold" strokeWidth={2.2} />{L('রেফার ও আয়', 'Refer & Earn')}</h1>
      </div>

      {/* hero */}
      <div className="relative overflow-hidden rounded-card p-5 text-white" style={{ backgroundImage: 'var(--grad-gold)', boxShadow: 'var(--glow-gold), inset 0 0 0 1px rgba(255,255,255,.2)', color: '#2A1D00' }}>
        <div className="absolute -right-6 -top-8 h-28 w-28 rounded-full bg-white/25 blur-2xl" />
        <Gift className="h-8 w-8" strokeWidth={2} />
        <div className="mt-2 font-display text-2xl font-extrabold leading-tight">{L('প্রতি রেফারে ৳20', 'Earn ৳20 per referral')}</div>
        <p className="mt-1 text-sm font-semibold opacity-80">{L('বন্ধুকে আনুন, দুজনেই জিতুন', 'Invite friends — you both win')}</p>
        <div className="mt-4 flex items-center gap-2 rounded-2xl bg-black/15 p-2 pl-4">
          <span className="tnum flex-1 font-display text-xl font-extrabold tracking-wider">{code}</span>
          <button onClick={() => { navigator.clipboard?.writeText(code); toast(L('কপি হয়েছে ✓', 'Copied ✓'), 'ok') }} className="grid h-9 w-9 place-items-center rounded-xl bg-white/85"><Copy className="h-4 w-4" strokeWidth={2.4} /></button>
          <button onClick={share} className="flex h-9 items-center gap-1.5 rounded-xl bg-[#2A1D00] px-3 text-sm font-bold text-white"><Share2 className="h-4 w-4" strokeWidth={2.4} />{L('শেয়ার', 'Share')}</button>
        </div>
      </div>

      {/* earned + count */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="card p-4">
          <Coins className="h-5 w-5 text-gold" strokeWidth={2.2} />
          <div className="tnum mt-1 font-display text-xl font-extrabold text-emerald2">{fmt(earned)}</div>
          <div className="text-[11px] text-muted">{L('মোট আয়', 'Total earned')}</div>
        </div>
        <div className="card p-4">
          <Users className="h-5 w-5 text-primary-2" strokeWidth={2.2} />
          <div className="tnum mt-1 font-display text-xl font-extrabold">{referrals.length}</div>
          <div className="text-[11px] text-muted">{L('রেফার করা বন্ধু', 'Friends referred')}</div>
        </div>
      </div>

      {/* how it works */}
      <h2 className="sect-title mt-5 mb-2">{L('কীভাবে কাজ করে', 'How it works')}</h2>
      <div className="space-y-2">
        {steps.map(({ Icon, t, d }, i) => (
          <div key={i} className="card flex items-center gap-3 p-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl text-white shadow-glow" style={{ backgroundImage: 'var(--grad)' }}><Icon className="h-4 w-4" strokeWidth={2.2} /></span>
            <div className="flex-1"><div className="text-sm font-bold">{t}</div><div className="text-[11px] text-muted">{d}</div></div>
            <span className="tnum text-lg font-extrabold text-muted/50">{i + 1}</span>
          </div>
        ))}
      </div>

      {/* referred friends */}
      <h2 className="sect-title mt-5 mb-2">{L('আপনার রেফারেল', 'Your referrals')}</h2>
      {referrals.length === 0 ? <EmptyState icon="🎁" title={L('এখনো কেউ নেই', 'No referrals yet')} /> : (
        <div className="space-y-2">
          {referrals.map((r) => (
            <div key={r.id} className="card flex items-center gap-3 p-3">
              <div className="grid h-9 w-9 place-items-center rounded-full text-sm font-bold" style={{ background: 'var(--glass)' }}>{r.name[0]}</div>
              <div className="flex-1">
                <div className="text-sm font-semibold">{r.name}</div>
                <div className="text-[11px] text-muted">{new Date(r.ts).toLocaleDateString()} · {r.status === 'played' ? L('খেলেছে', 'played') : L('জয়েন করেছে', 'joined')}</div>
              </div>
              <div className="flex items-center gap-1 text-emerald2 font-bold tnum"><WalletIcon className="h-3.5 w-3.5" strokeWidth={2.2} />+{fmt(r.rewardMinor)}</div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-center text-[11px] text-muted">{L('রেফার বোনাস ডেমো — আসল ক্রেডিট প্রোডাকশনে।', 'Referral bonus is demo — real credit in production.')} ({fmt(PER_REFERRAL)}/refer)</p>
    </div>
  )
}
