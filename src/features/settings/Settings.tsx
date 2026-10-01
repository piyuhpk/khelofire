import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, User, Globe, Sun, Moon, Bell, Volume2, ShieldCheck, LifeBuoy, Gift, FileText, Trash2, LogOut, Lock } from 'lucide-react'
import { useI18n } from '../../i18n'
import { signOutUser } from '../../lib/auth'
import { useToast, Sheet } from '../../ui/components'

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="h-6 w-11 shrink-0 rounded-full p-0.5 transition" style={{ background: on ? 'var(--grad)' : 'var(--line)' }}>
      <span className={`block h-5 w-5 rounded-full bg-white shadow transition ${on ? 'translate-x-5' : ''}`} />
    </button>
  )
}

export default function Settings() {
  const nav = useNavigate()
  const { lang, theme, toggleLang, toggleTheme } = useI18n()
  const toast = useToast()
  const L = (bn: string, en: string) => (lang === 'bn' ? bn : en)

  const [prefs, setPrefs] = useState({ match: true, tournament: true, wallet: true, promo: false, sound: true })
  const [pwOpen, setPwOpen] = useState(false)
  const [delOpen, setDelOpen] = useState(false)
  const set = (k: keyof typeof prefs) => setPrefs((p) => ({ ...p, [k]: !p[k] }))

  return (
    <div className="p-4 pb-8">
      <div className="mb-4 flex items-center gap-2.5">
        <button onClick={() => nav(-1)} className="grid h-9 w-9 place-items-center rounded-full active:scale-90 transition" style={{ background: 'var(--glass)', border: '1px solid var(--glass-brd)' }}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="font-display text-lg font-extrabold">{L('সেটিংস', 'Settings')}</h1>
      </div>

      {/* account */}
      <h2 className="sect-title mb-2">{L('অ্যাকাউন্ট', 'Account')}</h2>
      <div className="card overflow-hidden mb-4">
        <Row Icon={User} label={L('প্রোফাইল সম্পাদনা', 'Edit profile')} onClick={() => nav('/profile')} />
        <Row Icon={Lock} label={L('পাসওয়ার্ড পরিবর্তন', 'Change password')} onClick={() => setPwOpen(true)} border />
        <Row Icon={Gift} label={L('রেফার ও আয়', 'Refer & Earn')} onClick={() => nav('/refer')} border />
      </div>

      {/* preferences */}
      <h2 className="sect-title mb-2">{L('পছন্দ', 'Preferences')}</h2>
      <div className="card p-4 space-y-3 mb-4">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2.5 text-sm font-semibold"><Globe className="h-4 w-4 text-teal2" strokeWidth={2.2} />{L('ভাষা', 'Language')}</span>
          <button onClick={toggleLang} className="chip text-xs font-bold" style={{ background: 'var(--glass)', border: '1px solid var(--glass-brd)' }}>{lang === 'bn' ? 'বাংলা' : 'English'}</button>
        </div>
        <div className="divider" />
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2.5 text-sm font-semibold">{theme === 'dark' ? <Moon className="h-4 w-4 text-primary-2" strokeWidth={2.2} /> : <Sun className="h-4 w-4 text-gold" strokeWidth={2.2} />}{L('থিম', 'Theme')}</span>
          <Toggle on={theme === 'dark'} onClick={toggleTheme} />
        </div>
        <div className="divider" />
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2.5 text-sm font-semibold"><Volume2 className="h-4 w-4 text-cyan2" strokeWidth={2.2} />{L('সাউন্ড', 'Sound effects')}</span>
          <Toggle on={prefs.sound} onClick={() => set('sound')} />
        </div>
      </div>

      {/* notifications */}
      <h2 className="sect-title mb-2">{L('নোটিফিকেশন', 'Notifications')}</h2>
      <div className="card p-4 space-y-3 mb-4">
        {([
          ['match', L('ম্যাচ আপডেট', 'Match updates')],
          ['tournament', L('টুর্নামেন্ট', 'Tournaments')],
          ['wallet', L('ওয়ালেট', 'Wallet & payments')],
          ['promo', L('অফার ও প্রোমো', 'Offers & promos')],
        ] as const).map(([k, label], i) => (
          <div key={k}>
            {i > 0 && <div className="divider mb-3" />}
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2.5 text-sm font-semibold"><Bell className="h-4 w-4 text-gold" strokeWidth={2.2} />{label}</span>
              <Toggle on={prefs[k]} onClick={() => set(k)} />
            </div>
          </div>
        ))}
      </div>

      {/* about / support */}
      <h2 className="sect-title mb-2">{L('অন্যান্য', 'More')}</h2>
      <div className="card overflow-hidden mb-4">
        <Row Icon={LifeBuoy} label={L('সাহায্য ও সাপোর্ট', 'Help & Support')} onClick={() => nav('/support')} />
        <Row Icon={ShieldCheck} label={L('গোপনীয়তা নীতি', 'Privacy policy')} onClick={() => toast(L('ডেমো', 'Demo'), 'info')} border />
        <Row Icon={FileText} label={L('শর্তাবলী', 'Terms of service')} onClick={() => toast(L('ডেমো', 'Demo'), 'info')} border />
      </div>

      <div className="card overflow-hidden mb-4">
        <Row Icon={Trash2} label={L('অ্যাকাউন্ট ডিলিট', 'Delete account')} onClick={() => setDelOpen(true)} danger />
      </div>

      <button onClick={async () => { await signOutUser(); nav('/login') }} className="btn-danger w-full">
        <LogOut className="h-4 w-4" strokeWidth={2.4} />{L('লগআউট', 'Logout')}
      </button>
      <p className="mt-4 text-center text-[11px] text-muted">KheloFire · v1.0</p>

      {/* change password */}
      <Sheet open={pwOpen} onClose={() => setPwOpen(false)}>
        <h3 className="mb-3 font-display text-base font-extrabold">{L('পাসওয়ার্ড পরিবর্তন', 'Change password')}</h3>
        <div className="space-y-3">
          <input type="password" className="input" placeholder={L('বর্তমান পাসওয়ার্ড', 'Current password')} />
          <input type="password" className="input" placeholder={L('নতুন পাসওয়ার্ড', 'New password')} />
          <button onClick={() => { setPwOpen(false); toast(L('আপডেট হয়েছে ✓', 'Updated ✓'), 'ok') }} className="btn-primary w-full">{L('সংরক্ষণ', 'Save')}</button>
        </div>
      </Sheet>

      {/* delete account */}
      <Sheet open={delOpen} onClose={() => setDelOpen(false)}>
        <h3 className="mb-2 font-display text-base font-extrabold text-danger">{L('অ্যাকাউন্ট ডিলিট?', 'Delete account?')}</h3>
        <p className="mb-4 text-sm text-muted">{L('এটি স্থায়ী — সব ডেটা মুছে যাবে (ডেমো)।', 'This is permanent — all data will be erased (demo).')}</p>
        <div className="flex gap-2">
          <button onClick={() => setDelOpen(false)} className="btn-ghost flex-1">{L('বাতিল', 'Cancel')}</button>
          <button onClick={async () => { setDelOpen(false); await signOutUser(); nav('/login') }} className="btn-danger flex-1">{L('ডিলিট', 'Delete')}</button>
        </div>
      </Sheet>
    </div>
  )
}

function Row({ Icon, label, onClick, border, danger }: { Icon: typeof User; label: string; onClick: () => void; border?: boolean; danger?: boolean }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 p-4 active:scale-[.99] transition" style={border ? { borderTop: '1px solid var(--line)' } : undefined}>
      <Icon className={`h-5 w-5 ${danger ? 'text-danger' : 'text-primary-2'}`} strokeWidth={2.2} />
      <span className={`flex-1 text-left text-sm font-semibold ${danger ? 'text-danger' : ''}`}>{label}</span>
      {!danger && <ChevronRight className="h-4 w-4 text-muted" />}
    </button>
  )
}
