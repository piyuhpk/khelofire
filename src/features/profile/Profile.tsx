import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, Sun, Moon, Trophy, LogOut, Crown, Swords, Gamepad2, ChevronRight, Wallet as WalletIcon, Pencil, Check, Bell, Percent, Gift, LifeBuoy, Settings } from 'lucide-react'
import { useT, useI18n } from '../../i18n'
import { useStore } from '../../lib/store'
import { signOutUser } from '../../lib/auth'
import { fmt } from '../../lib/money'
import { useToast, Sheet } from '../../ui/components'

const AVATARS = ['🦁', '🐯', '🦊', '🐼', '🐺', '🦉', '🐨', '🐵', '🦅', '🐸', '🐲', '👑']

export default function Profile() {
  const t = useT()
  const nav = useNavigate()
  const toast = useToast()
  const { theme, toggleTheme } = useI18n()
  const s = useStore()
  const total = s.wins + s.losses + s.draws
  const winRate = total ? Math.round((s.wins / total) * 100) : 0

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(s.username)
  const [pickAvatar, setPickAvatar] = useState(false)
  const [notif, setNotif] = useState(true)

  const saveName = () => { const v = name.trim(); if (v) { s.updateProfile({ username: v }); toast('Saved ✓', 'ok') } else setName(s.username); setEditing(false) }

  const stats = [
    { Icon: Trophy, label: t('profile.wins'), val: s.wins, cls: 'text-emerald2' },
    { Icon: Swords, label: t('profile.losses'), val: s.losses, cls: 'text-danger' },
    { Icon: Gamepad2, label: t('profile.matches'), val: total, cls: 'text-primary-2' },
    { Icon: Percent, label: t('profile.winRate'), val: `${winRate}%`, cls: 'text-gold' },
  ]

  return (
    <div className="p-4 pb-8 space-y-4">
      {/* identity */}
      <div className="relative overflow-hidden card p-5 flex items-center gap-4">
        <div className="absolute -right-8 -top-10 h-32 w-32 rounded-full" style={{ background: 'radial-gradient(circle,rgba(139,92,255,.35),transparent 70%)' }} />
        <button onClick={() => setPickAvatar(true)} className="relative grid h-16 w-16 place-items-center rounded-full text-3xl active:scale-95 transition" style={{ backgroundImage: 'var(--grad)', boxShadow: 'var(--glow)', border: '2px solid rgba(255,255,255,.18)' }}>
          {s.avatar}
          <span className="absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full text-white" style={{ background: 'var(--primary)', border: '2px solid var(--surface)' }}><Pencil className="h-3 w-3" strokeWidth={2.4} /></span>
        </button>
        <div className="relative z-10 min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-2">
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveName()} className="input py-1.5 text-sm font-bold" />
              <button onClick={saveName} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white" style={{ background: 'var(--emerald)' }}><Check className="h-4 w-4" strokeWidth={2.6} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="font-display text-lg font-extrabold truncate">{s.username}</div>
              <button onClick={() => { setName(s.username); setEditing(true) }} className="text-muted"><Pencil className="h-3.5 w-3.5" strokeWidth={2.2} /></button>
            </div>
          )}
          <div className="text-xs text-muted">{t('profile.playerId')}: {s.playerId}</div>
          <span className="chip mt-1.5 text-[11px] font-bold text-gold" style={{ background: 'rgba(255,212,102,.12)', border: '1px solid rgba(255,212,102,.25)' }}>
            <Crown className="h-3 w-3" strokeWidth={2.4} fill="#FFD466" />Lvl {Math.floor(total / 5) + 1}
          </span>
        </div>
      </div>

      {/* wallet quick row */}
      <button onClick={() => nav('/wallet')} className="card flex w-full items-center gap-3 p-4 active:scale-[.98] transition">
        <span className="grid h-10 w-10 place-items-center rounded-xl text-white shadow-glow" style={{ backgroundImage: 'var(--grad-gold)', color: '#2A1D00' }}><WalletIcon className="h-5 w-5" strokeWidth={2.2} /></span>
        <div className="flex-1 text-left">
          <div className="text-[11px] text-muted">{t('wallet.available')}</div>
          <div className="tnum font-display text-lg font-extrabold">{fmt(s.availableMinor)}</div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted" />
      </button>

      {/* stats */}
      <div className="grid grid-cols-4 gap-2">
        {stats.map(({ Icon, label, val, cls }) => (
          <div key={label} className="card p-3 text-center">
            <Icon className={`mx-auto mb-1 h-4 w-4 ${cls}`} strokeWidth={2.2} />
            <div className={`tnum font-display text-xl font-extrabold ${cls}`}>{val}</div>
            <div className="text-[10px] text-muted leading-tight">{label}</div>
          </div>
        ))}
      </div>

      {/* settings */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-muted">{t('profile.referralCode')}</span>
          <button onClick={() => { navigator.clipboard?.writeText(s.referralCode); toast('Copied ✓', 'ok') }}
            className="chip text-xs font-bold text-primary-2" style={{ background: 'rgba(139,92,255,.14)', border: '1px solid var(--glass-brd)' }}>
            {s.referralCode} <Copy className="h-3 w-3" strokeWidth={2.2} />
          </button>
        </div>
        <div className="divider" />
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold"><Bell className="h-4 w-4 text-cyan2" strokeWidth={2.2} />{t('profile.notifs')}</span>
          <button onClick={() => setNotif((v) => !v)} className="h-6 w-11 rounded-full p-0.5 transition" style={{ background: notif ? 'var(--grad)' : 'var(--line)' }}>
            <span className={`block h-5 w-5 rounded-full bg-white shadow transition ${notif ? 'translate-x-5' : ''}`} />
          </button>
        </div>
        <div className="divider" />
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            {theme === 'dark' ? <Moon className="h-4 w-4 text-primary-2" strokeWidth={2.2} /> : <Sun className="h-4 w-4 text-gold" strokeWidth={2.2} />}
            {theme === 'dark' ? 'Dark mode' : 'Light mode'}
          </span>
          <button onClick={toggleTheme} className="h-6 w-11 rounded-full p-0.5 transition" style={{ background: theme === 'dark' ? 'var(--grad)' : 'var(--line)' }}>
            <span className={`block h-5 w-5 rounded-full bg-white shadow transition ${theme === 'dark' ? 'translate-x-5' : ''}`} />
          </button>
        </div>
      </div>

      {/* links */}
      <div className="card overflow-hidden">
        {[
          { Icon: Gift, label: t('home.refer'), go: () => nav('/refer'), cls: 'text-gold' },
          { Icon: LifeBuoy, label: t('profile.support'), go: () => nav('/support'), cls: 'text-teal2' },
          { Icon: Settings, label: t('profile.settings'), go: () => nav('/settings'), cls: 'text-primary-2' },
          { Icon: Trophy, label: t('leaderboard.title'), go: () => nav('/leaderboard'), cls: 'text-gold' },
        ].map(({ Icon, label, go, cls }, i) => (
          <button key={label} onClick={go} className="flex w-full items-center gap-3 p-4 active:scale-[.98] transition" style={i ? { borderTop: '1px solid var(--line)' } : undefined}>
            <Icon className={`h-5 w-5 ${cls}`} strokeWidth={2.2} />
            <span className="flex-1 text-left text-sm font-semibold">{label}</span>
            <ChevronRight className="h-4 w-4 text-muted" />
          </button>
        ))}
      </div>

      <button onClick={async () => { await signOutUser(); nav('/login') }} className="btn-danger w-full">
        <LogOut className="h-4 w-4" strokeWidth={2.4} />{t('profile.logout')}
      </button>

      {/* avatar picker */}
      <Sheet open={pickAvatar} onClose={() => setPickAvatar(false)}>
        <h3 className="mb-3 font-display text-base font-extrabold">{t('profile.chooseAvatar')}</h3>
        <div className="grid grid-cols-6 gap-2">
          {AVATARS.map((a) => (
            <button key={a} onClick={() => { s.updateProfile({ avatar: a }); setPickAvatar(false); toast('Avatar updated ✓', 'ok') }}
              className={`grid aspect-square place-items-center rounded-2xl text-2xl transition active:scale-90 ${a === s.avatar ? 'ring-2 ring-gold' : ''}`}
              style={{ background: 'var(--glass)', border: '1px solid var(--glass-brd)' }}>{a}</button>
          ))}
        </div>
      </Sheet>
    </div>
  )
}
