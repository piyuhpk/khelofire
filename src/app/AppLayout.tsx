import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { Gamepad2, ClipboardList, Wallet as WalletIcon, User, Bell, Plus, Sun, Moon } from 'lucide-react'
import { useT, useI18n } from '../i18n'
import { useStore } from '../lib/store'
import { fmt } from '../lib/money'

const tabs = [
  { to: '/', key: 'nav.home', Icon: Gamepad2 },
  { to: '/matches', key: 'nav.matches', Icon: ClipboardList },
  { to: '/wallet', key: 'nav.wallet', Icon: WalletIcon },
  { to: '/profile', key: 'nav.profile', Icon: User },
] as const

const hbtn = 'grid h-9 w-9 shrink-0 place-items-center rounded-full active:scale-90 transition'

export function AppHeader() {
  const nav = useNavigate()
  const { lang, theme, toggleLang, toggleTheme } = useI18n()
  const available = useStore((s) => s.availableMinor)
  const authed = useStore((s) => s.authed)
  const unread = useStore((s) => s.notifs.filter((n) => !n.read).length)

  // Hidden admin access: long press on logo (800ms) — only opens the PIN gate;
  // isAdmin can NEVER be granted here (only adminLogin() can).
  const [pressTimer, setPressTimer] = useState<number | null>(null)
  const handleLogoMouseDown = () => {
    const timer = window.setTimeout(() => {
      nav('/admin')
    }, 800)
    setPressTimer(timer)
  }
  const handleLogoMouseUp = () => {
    if (pressTimer) clearTimeout(pressTimer)
    setPressTimer(null)
  }
  const handleLogoMouseLeave = () => {
    if (pressTimer) clearTimeout(pressTimer)
    setPressTimer(null)
  }

  return (
    <header className="sticky top-0 z-30 flex items-center gap-1.5 px-3 py-2.5"
      style={{ background: 'color-mix(in srgb, var(--bg) 70%, transparent)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderBottom: '1px solid var(--line)', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}>
      <button 
        onClick={() => nav('/')} 
        onMouseDown={handleLogoMouseDown}
        onMouseUp={handleLogoMouseUp}
        onMouseLeave={handleLogoMouseLeave}
        onTouchStart={handleLogoMouseDown}
        onTouchEnd={handleLogoMouseUp}
        className="flex items-center gap-2 active:scale-95 transition" 
        aria-label="home">
        <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl shadow-glow" style={{ border: '1px solid var(--glass-brd)' }}>
          <img src="/logo.jpg" alt="KheloFire" className="h-full w-full object-cover" />
        </span>
        <span className="font-display text-[17px] font-extrabold leading-none">Khelo<span className="text-grad">Fire</span></span>
      </button>
      <div className="flex-1" />
      <button onClick={toggleLang} className="pill !px-2.5 !py-1.5" aria-label="language">{lang === 'bn' ? 'বাং' : 'EN'}</button>
      <button onClick={toggleTheme} className={hbtn} aria-label="theme" style={{ background: 'var(--glass)', border: '1px solid var(--glass-brd)' }}>
        {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" strokeWidth={2} /> : <Moon className="h-[18px] w-[18px]" strokeWidth={2} />}
      </button>
      <button className={`relative ${hbtn}`} aria-label="notifications" onClick={() => nav('/notifications')}
        style={{ background: 'var(--glass)', border: '1px solid var(--glass-brd)' }}>
        <Bell className="h-[18px] w-[18px]" strokeWidth={2} />
        {unread > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white" style={{ background: 'var(--danger)' }}>{unread}</span>}
      </button>
      {authed ? (
        <>
          <button onClick={() => nav('/wallet')} className="pill tnum !px-2.5" style={{ backgroundImage: 'var(--grad-gold)', color: '#2A1D00', border: 'none' }} aria-label="wallet">
            {fmt(available)}
          </button>
          <button onClick={() => nav('/wallet')} className={`${hbtn} text-white`} aria-label="add money" style={{ backgroundImage: 'var(--grad)', boxShadow: 'var(--glow)' }}>
            <Plus className="h-5 w-5" strokeWidth={2.6} />
          </button>
        </>
      ) : (
        <button onClick={() => nav('/login')} className="pill !px-3.5 font-bold" style={{ backgroundImage: 'var(--grad)', color: '#fff', boxShadow: 'var(--glow)' }} aria-label="login">
          Login
        </button>
      )}
    </header>
  )
}

export function BottomNav() {
  const t = useT()
  const nav = useNavigate()
  const { pathname } = useLocation()
  return (
    <nav className="sticky bottom-0 z-30 grid grid-cols-4"
      style={{ background: 'color-mix(in srgb, var(--bg) 78%, transparent)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderTop: '1px solid var(--line)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {tabs.map(({ to, key, Icon }) => {
        const active = pathname === to
        return (
          <button key={to} onClick={() => nav(to)} className="relative flex flex-col items-center gap-1 py-2.5">
            {active && <span className="absolute top-0 h-[3px] w-9 rounded-full" style={{ backgroundImage: 'var(--grad)' }} />}
            <Icon className="h-[22px] w-[22px] transition" strokeWidth={active ? 2.4 : 1.9} style={{ color: active ? 'var(--primary-2)' : 'var(--muted)' }} />
            <span className="text-[11px] font-semibold" style={{ color: active ? 'var(--text)' : 'var(--muted)' }}>{t(key as any)}</span>
          </button>
        )
      })}
    </nav>
  )
}

export function AppLayout() {
  const maintenance = useStore((s) => s.siteConfig.maintenance)
  const isAdmin = useStore((s) => s.isAdmin)
  // Maintenance mode (Admin → Settings): users see a holding screen, admins pass
  if (maintenance && !isAdmin) {
    return (
      <div className="app-frame flex flex-col">
        <AppHeader />
        <main className="flex-1 grid place-items-center px-6 text-center">
          <div>
            <span className="text-5xl">🛠️</span>
            <h1 className="mt-3 font-display text-xl font-extrabold">Under maintenance</h1>
            <p className="mt-1 text-sm text-muted">We'll be back very soon. / শীঘ্রই ফিরে আসছি।</p>
          </div>
        </main>
      </div>
    )
  }
  return (
    <div className="app-frame flex flex-col">
      <AppHeader />
      {/* pb-[env(safe-area-inset-bottom)] rather than pb-2: the scrolling <main>
          runs to the very bottom of the viewport, so on a phone with a gesture bar
          or a home row the last row of content sat underneath it. The nav has its
          own inset padding, but a nav that is pushed partly off-screen cannot show
          its own padding.
          pb-24 keeps a full row of content clear of the nav on every page, which
          is also why the nav stopped disappearing on Wallet: that page is a tall
          scroll, so it was the one that could scroll its own footer out of reach. */}
      <main className="flex-1 overflow-y-auto no-scrollbar pb-24 pb-[env(safe-area-inset-bottom)]">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
