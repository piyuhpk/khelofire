import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Wrench, Megaphone, Send, Users, Search, Ban, CheckCircle2, Trash2, Plus, Minus, Image, Gift, CreditCard, LifeBuoy, SlidersHorizontal, Gamepad2, LayoutDashboard, ImageIcon, Upload, X, Shield, Activity, Key, UserPlus, UserCheck, LogOut, Bell, FileText, Banknote } from 'lucide-react'
import { MODES } from '../../lib/catalog'
import { fmt, toMinor } from '../../lib/money'
import { GATEWAYS, isUsable } from '../../lib/payments/providers'
import { useStore, type AdminUser, type CategoryImageConfig, type AdminRole, type AdminActivity, type AdminSettings, fileToBase64, validateImageFile } from '../../lib/store'
import { supabase, hasSupabase } from '../../lib/supabase'
import { useToast, Sheet } from '../../ui/components'
import { changePassword, changeEmail, currentEmail } from '../../lib/auth'

const TABS = [
  { id: 'Dashboard', Icon: LayoutDashboard }, { id: 'Users', Icon: Users }, { id: 'Roles', Icon: Shield },
  { id: 'Activity', Icon: Activity }, { id: 'Security', Icon: Key }, { id: 'Games', Icon: Gamepad2 },
  { id: 'Announce', Icon: Megaphone }, { id: 'Banners', Icon: Image }, { id: 'Images', Icon: ImageIcon },
  { id: 'Bonus', Icon: Gift }, { id: 'Payments', Icon: CreditCard }, { id: 'Withdrawals', Icon: Banknote }, { id: 'Support', Icon: LifeBuoy }, { id: 'Settings', Icon: SlidersHorizontal },
] as const

// ---------- staff sign-in ----------
// This used to be a single "PIN" field compared against a value stored in the
// phone's own localStorage, and /admin-access?pin=4321 was a public URL that
// logged anyone straight in. Now it is a real Supabase account, and the panel
// only opens if the server says that account has a row in `staff`.
function Gate({ onOk }: { onOk: () => void }) {
  const nav = useNavigate()
  const adminSignIn = useStore((s) => s.adminSignIn)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setErr('')
    if (!email || pw.length < 6) { setErr('Enter your admin email and password'); return }
    setBusy(true)
    const r = await adminSignIn(email.trim(), pw)
    setBusy(false)
    if (r.ok) { setPw(''); onOk() }
    else { setErr(r.error || 'Sign-in failed'); setPw('') }
  }

  return (
    <div className="p-4 pb-8 flex min-h-[70vh] flex-col items-center justify-center">
      <div className="card-solid w-full max-w-[320px] p-6 text-center">
        <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl text-white shadow-glow" style={{ backgroundImage: 'var(--grad-cyan)' }}><Wrench className="h-6 w-6" strokeWidth={2.2} /></span>
        <h1 className="font-display text-lg font-extrabold">Admin Panel</h1>
        <p className="mt-1 text-xs text-muted">Staff accounts only</p>
        <label className="label mt-4 block text-left">Email</label>
        <input autoFocus autoCapitalize="none" autoCorrect="off" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErr('') }}
          className="input" placeholder="admin@khelofire.app" />
        <label className="label mt-3 block text-left">Password</label>
        <input type="password" value={pw} onChange={(e) => { setPw(e.target.value); setErr('') }} onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="input" placeholder="••••••••" />
        {err && <p className="mt-2 text-xs font-semibold text-danger">{err}</p>}
        <button onClick={submit} disabled={busy} className="btn-primary mt-4 w-full disabled:opacity-50">{busy ? 'Checking…' : 'Unlock'}</button>
        <button onClick={() => nav('/')} className="mt-2 w-full text-center text-sm text-muted">Cancel</button>
      </div>
    </div>
  )
}

export default function Admin() {
  const nav = useNavigate()
  const toast = useToast()
  const isAdmin = useStore((s) => s.isAdmin)
  const [unlocked, setUnlocked] = useState(isAdmin)
  const [tab, setTab] = useState<typeof TABS[number]['id']>('Dashboard')

  // own-credential state (settings tab). The current password is asked for and
  // verified, never stored, and never sent anywhere but Supabase's own auth.
  const [myEmail, setMyEmail] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [credBusy, setCredBusy] = useState(false)

  // Load the signed-in admin's own address once. There is no password to read -
  // it never reaches the client, and that is the point.
  useEffect(() => {
    if (!hasSupabase) return
    let alive = true
    void currentEmail().then((e) => { if (alive && e) setMyEmail(e) })
    return () => { alive = false }
  }, [])

  const doPw = async () => {
    setCredBusy(true)
    try {
      await changePassword(curPw, newPw)
      setCurPw(''); setNewPw('')
      toast('Password updated', 'ok')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update the password', 'err')
    } finally { setCredBusy(false) }
  }

  const doEmail = async () => {
    setCredBusy(true)
    try {
      await changeEmail(newEmail)
      toast('Confirmation sent - check the new inbox', 'ok')
      setNewEmail('')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change the email', 'err')
    } finally { setCredBusy(false) }
  }

  // store data
  const users = useStore((s) => s.adminUsers)
  const roles = useStore((s) => s.adminRoles)
  const activity = useStore((s) => s.adminActivity)
  const adminSettings = useStore((s) => s.adminSettings)
  const banners = useStore((s) => s.banners)
  const announcements = useStore((s) => s.announcements)
  const tickets = useStore((s) => s.tickets)
  const bonus = useStore((s) => s.bonusConfig)
  const pay = useStore((s) => s.paymentConfig)
  const liveGw = useStore((s) => s.liveGateway)
  const refreshLiveGateway = useStore((s) => s.refreshLiveGateway)
  const site = useStore((s) => s.siteConfig)
  const categoryImages = useStore((s) => s.categoryImages)
  const gameModeImages = useStore((s) => s.gameModeImages)
  // actions
  const withdrawals = useStore((s) => s.withdrawals)
  const deposits = useStore((s) => s.deposits)
  const { setUserStatus, deleteUser, adjustUserBalance, postAnnouncement, addBanner, removeBanner, toggleBanner, setBonusConfig, setPaymentConfig, setSiteConfig, setAdminSettings,
    addAdminUser, updateAdminRole, createAdminRole, adminReplyTicket, setTicketStatus, logAdminActivity, setWithdrawalStatus, setDepositStatus, setCategoryImage, removeCategoryImage, setGameModeImage, removeGameModeImage, adminLogout } = useStore.getState()

  // live sign-ups: hydrate existing profiles + listen for INSERTs in realtime
  // (works after supabase/schema.sql is run in the dashboard)
  useEffect(() => {
    if (!hasSupabase || !supabase) return
    const sb = supabase
    const upsert = (row: { username?: string; available_minor?: number }) => {
      const st = useStore.getState()
      const name = (row.username || 'Player').trim()
      const email = name.includes('@') ? name : name.toLowerCase().replace(/\s+/g, '.') + '@khelofire.app'
      if (st.adminUsers.some((u) => u.email === email || u.name === name)) return
      st.addAdminUser({ name, email, loginMethod: 'email', balanceMinor: row.available_minor ?? 0, status: 'active', role: 'user', lastLogin: Date.now() })
    }
    sb.from('profiles').select('id, username, available_minor').limit(100)
      .then(({ data }) => { (data || []).forEach((r) => upsert(r as any)) })
    const ch = sb.channel('admin-users-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profiles' }, (p) => upsert(p.new as any))
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [])

  // local ui state
  const [q, setQ] = useState('')
  const [selUser, setSelUser] = useState<AdminUser | null>(null)
  const [balAmt, setBalAmt] = useState('')
  const [annTitle, setAnnTitle] = useState('')
  const [annBody, setAnnBody] = useState('')
  const [annTarget, setAnnTarget] = useState('all')
  const [bnTitle, setBnTitle] = useState('')
  const [bnUrl, setBnUrl] = useState('')  // images tab state

  const [modeImgId, setModeImgId] = useState('')
  const [modeBgUrl, setModeBgUrl] = useState('')
  const [modeThumbUrl, setModeThumbUrl] = useState('')
  // roles tab state
  const [roleName, setRoleName] = useState('')
  const [tkId, setTkId] = useState('')
  const [tkReply, setTkReply] = useState('')
  const [roleDesc, setRoleDesc] = useState('')
  const [selRole, setSelRole] = useState<AdminRole | null>(null)
  // add user tab state
  const [newUserName, setNewUserName] = useState('')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserRole, setNewUserRole] = useState<'user' | 'admin' | 'support'>('user')

  if (!unlocked && !isAdmin) return <Gate onOk={() => setUnlocked(true)} />

  const filtered = users.filter((u) => u.status !== 'deleted' && `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()))
  const totalBal = users.reduce((n, u) => n + u.balanceMinor, 0)

  const sendAnn = () => {
    if (!annTitle.trim() || !annBody.trim()) return toast('Fill title and message', 'err')
    const target = annTarget === 'all' ? {} : { targetUserId: annTarget, targetName: users.find((u) => u.id === annTarget)?.name }
    postAnnouncement({ titleBn: annTitle, titleEn: annTitle, bodyBn: annBody, bodyEn: annBody, ...target })
    // real-time push to ALL devices (Supabase broadcast; local post above covers this device)
    import('../../lib/realtime').then((m) => m.broadcastAnnouncement({ titleBn: annTitle, titleEn: annTitle, bodyBn: annBody, bodyEn: annBody })).catch(() => {})
    logAdminActivity('announce', 'notifications', annTarget === 'all' ? `broadcast: ${annTitle}` : `to ${target.targetName}`)
    setAnnTitle(''); setAnnBody(''); setAnnTarget('all')
    toast(
      annTarget === 'all'
        ? (hasSupabase ? 'Broadcast sent ✓ (all devices)' : 'Announcement saved (this device only)')
        : 'Sent to user ✓',
      hasSupabase ? 'ok' : 'info',
    )
  }
  const applyBal = (sign: 1 | -1) => {
    const n = Number(balAmt)
    if (!n) return toast('Enter an amount first', 'err')
    if (!selUser) return
    adjustUserBalance(selUser.id, sign * toMinor(n))
    setSelUser((u) => u ? { ...u, balanceMinor: Math.max(0, u.balanceMinor + sign * toMinor(n)) } : u)
    setBalAmt(''); toast('Balance updated ✓', 'ok')
  }

  return (
    <div className="p-4 pb-8" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 32px)' }}>
      <div className="mb-3 flex items-center gap-2.5">
        <button onClick={() => nav(-1)} className="grid h-9 w-9 place-items-center rounded-full active:scale-90 transition" style={{ background: 'var(--glass)', border: '1px solid var(--glass-brd)' }}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="grid h-9 w-9 place-items-center rounded-xl text-white shadow-glow" style={{ backgroundImage: 'var(--grad-cyan)' }}><Wrench className="h-4 w-4" strokeWidth={2.2} /></span>
        <h1 className="font-display text-lg font-extrabold">Admin</h1>
        <button onClick={() => { adminLogout(); nav('/') }} className="chip ml-auto text-[11px] font-bold text-danger" style={{ background: 'rgba(255,92,105,.12)' }}>Lock</button>
      </div>

      {/* tabs */}
      <div className="mb-4 flex gap-1.5 overflow-x-auto no-scrollbar">
        {TABS.map(({ id, Icon }) => (
          <button key={id} onClick={() => setTab(id)} className="chip shrink-0 whitespace-nowrap text-xs font-bold transition"
            style={tab === id ? { backgroundImage: 'var(--grad)', color: '#fff', boxShadow: 'var(--glow)' } : { background: 'var(--glass)', border: '1px solid var(--glass-brd)', color: 'var(--muted)' }}>
            <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />{id}
          </button>
        ))}
      </div>

      {/* ---- Dashboard ---- */}
      {tab === 'Dashboard' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Total users', val: users.length, cls: 'text-primary-2' },
              { label: 'Active', val: users.filter((u) => u.status === 'active').length, cls: 'text-emerald2' },
              { label: 'Suspended', val: users.filter((u) => u.status === 'suspended').length, cls: 'text-danger' },
              { label: 'User balances', val: fmt(totalBal), cls: 'text-gold' },
              { label: 'Open tickets', val: tickets.filter((t) => t.status !== 'closed').length, cls: 'text-cyan2' },
              { label: 'Announcements', val: announcements.length, cls: 'text-teal2' },
              { label: 'Admins', val: users.filter((u) => u.role === 'admin' || u.role === 'superadmin').length, cls: 'text-primary-2' },
              { label: 'Roles', val: roles.length, cls: 'text-teal2' },
              { label: 'Activities', val: activity.length, cls: 'text-cyan2' },
              { label: 'Session (min)', val: Math.round(adminSettings.sessionTimeout / 60000), cls: 'text-gold' },
            ].map((c) => (
              <div key={c.label} className="card p-4"><div className={`tnum font-display text-2xl font-extrabold ${c.cls}`}>{c.val}</div><div className="text-[11px] text-muted">{c.label}</div></div>
            ))}
          </div>
          <div className="card p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-bold"><FileText className="h-4 w-4 text-cyan2" strokeWidth={2.2} />Recent activity</div>
            {(activity as AdminActivity[]).length === 0 ? (
              <p className="py-2 text-center text-xs text-muted flex items-center justify-center gap-2"><Bell className="h-4 w-4" />No admin actions yet</p>
            ) : (
              (activity as AdminActivity[]).slice(0, 5).map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-xs border-b last:border-0 py-1.5" style={{ borderColor: 'var(--line)' }}>
                  <span className="font-bold">{a.action}</span>
                  <span className="text-muted truncate flex-1">{a.resource}{a.details ? ` · ${a.details}` : ''}</span>
                  <span className="text-muted tnum">{new Date(a.ts).toLocaleTimeString()}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ---- Roles ---- */}
      {tab === 'Roles' && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold"><Shield className="h-4 w-4 text-primary-2" strokeWidth={2.2} />Roles ({roles.length})</div>
            {roles.map((r) => (
              <button key={r.id} onClick={() => { setSelRole(r); logAdminActivity('role_view', 'roles', r.name) }} className="card w-full p-3 text-left">
                <div className="text-sm font-bold flex items-center gap-2"><UserCheck className="h-4 w-4 text-emerald2" />{r.name}</div>
                <div className="text-[11px] text-muted">{r.description}</div>
                <div className="text-[11px] text-muted mt-1">{r.permissions.map((p) => `${p.resource}:${p.actions.join(',')}`).join(' | ')}</div>
              </button>
            ))}
            {selRole && (
              <div className="card p-3 text-xs" style={{ background: 'var(--bg)' }}>
                <div className="font-bold mb-1">Selected: {selRole.name}</div>
                <div className="text-muted">{selRole.description}</div>
                <button onClick={() => setSelRole(null)} className="btn-ghost mt-2 text-xs">Clear selection</button>
              </div>
            )}
            <div className="card p-3 space-y-2">
              <div className="text-xs font-bold">Custom role note</div>
              <input className="input" placeholder="Role name" value={roleName} onChange={(e) => setRoleName(e.target.value)} />
              <input className="input" placeholder="Role description" value={roleDesc} onChange={(e) => setRoleDesc(e.target.value)} />
              <button onClick={() => { if (!roleName.trim()) return toast('Enter role name', 'err'); createAdminRole(roleName.trim(), roleDesc.trim()); toast('Role created ✓', 'ok'); setRoleName(''); setRoleDesc('') }} className="btn-primary w-full text-xs">Save role</button>
            </div>
          </div>
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold"><UserPlus className="h-4 w-4 text-emerald2" strokeWidth={2.2} />Add admin / support user</div>
            <input className="input" placeholder="Name" value={newUserName} onChange={(e) => setNewUserName(e.target.value)} />
            <input className="input" placeholder="Email" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} />
            <select className="input" value={newUserRole} onChange={(e) => setNewUserRole(e.target.value as 'user' | 'admin' | 'support')}>
              <option value="user">user</option>
              <option value="admin">admin</option>
              <option value="support">support</option>
            </select>
            <button onClick={() => { if (!newUserName.trim() || !newUserEmail.trim()) return toast('Fill name and email', 'err'); addAdminUser({ name: newUserName.trim(), email: newUserEmail.trim(), loginMethod: 'email', balanceMinor: 0, status: 'active', role: newUserRole }); logAdminActivity('user_create', 'users', `${newUserName} (${newUserRole})`); setNewUserName(''); setNewUserEmail(''); setNewUserRole('user'); toast('User added ✓', 'ok') }} className="btn-primary w-full text-xs"><UserPlus className="h-3.5 w-3.5 mr-1" />Add user</button>
          </div>
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className="card flex items-center gap-2 p-3">
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{u.name}</div><div className="truncate text-[11px] text-muted">{u.email} · {u.role}</div></div>
                <select className="input !w-[130px]" value={u.role} onChange={(e) => { updateAdminRole(u.id, e.target.value as AdminUser['role']); logAdminActivity('role_change', 'users', `${u.email} -> ${e.target.value}`); toast('Role updated ✓', 'ok') }}>
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                  <option value="superadmin">superadmin</option>
                  <option value="support">support</option>
                </select>
                {(u.role === 'admin' || u.role === 'superadmin') && (
                  <button onClick={() => { updateAdminRole(u.id, 'user'); logAdminActivity('role_revoke', 'users', u.email); toast('Admin access revoked', 'ok') }} className="btn-ghost text-xs" aria-label="revoke"><LogOut className="h-4 w-4" /></button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- Activity ---- */}
      {tab === 'Activity' && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold"><Activity className="h-4 w-4 text-teal2" strokeWidth={2.2} />Admin activity log ({(activity as AdminActivity[]).length})</div>
          <p className="text-[11px] text-muted">Every login, PIN change, role change and image update is logged. Hack-proof audit trail.</p>
          <button onClick={() => { logAdminActivity('activity_view', 'audit', 'Viewed activity log'); toast('Logged ✓', 'ok') }} className="btn-ghost w-full text-xs"><FileText className="h-3.5 w-3.5 mr-1" />Log this view</button>
          {(activity as AdminActivity[]).length === 0 ? (
            <p className="py-6 text-center text-xs text-muted flex items-center justify-center gap-2"><Bell className="h-4 w-4" />No activity yet</p>
          ) : (
            (activity as AdminActivity[]).map((a) => (
              <div key={a.id} className="card p-2.5 text-xs">
                <div className="font-bold">{a.action} <span className="text-muted font-normal">· {a.resource}</span></div>
                {a.details && <div className="text-muted truncate">{a.details}</div>}
                <div className="text-muted tnum mt-0.5">{new Date(a.ts).toLocaleString()} · {a.ip}</div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ---- Security ---- */}
      {tab === 'Security' && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold"><Key className="h-4 w-4 text-gold" strokeWidth={2.2} />Change admin password</div>
            <p className="text-xs text-muted leading-relaxed">
              Admin accounts live in Supabase Auth, so the password cannot be changed from inside the app.
              Use{' '}
              <span className="font-mono text-[11px]">supabase auth</span> / the Auth dashboard, or reset it from
              your email. Roles are rows in the <span className="font-mono text-[11px]">staff</span> table —
              a phone-side change would not be trusted anyway.
            </p>
          </div>
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold"><Shield className="h-4 w-4 text-cyan2" strokeWidth={2.2} />Security settings</div>
            <div><label className="label">Session timeout (minutes)</label><input type="number" className="input tnum" value={Math.round((adminSettings as AdminSettings).sessionTimeout / 60000)} onChange={(e) => setAdminSettings({ sessionTimeout: Math.max(5, Number(e.target.value) || 30) * 60000 })} /></div>
            <div><label className="label">Max login attempts</label><input type="number" className="input tnum" value={(adminSettings as AdminSettings).maxLoginAttempts} onChange={(e) => setAdminSettings({ maxLoginAttempts: Math.max(3, Number(e.target.value) || 5) })} /></div>
            <div><label className="label">Lockout (minutes)</label><input type="number" className="input tnum" value={Math.round((adminSettings as AdminSettings).lockoutDuration / 60000)} onChange={(e) => setAdminSettings({ lockoutDuration: Math.max(5, Number(e.target.value) || 15) * 60000 })} /></div>
            <div><label className="label">Audit retention (days)</label><input type="number" className="input tnum" value={(adminSettings as AdminSettings).auditLogRetentionDays} onChange={(e) => setAdminSettings({ auditLogRetentionDays: Math.max(7, Number(e.target.value) || 90) })} /></div>
            <div className="flex items-center justify-between"><span className="text-sm font-semibold">Require 2FA (future)</span>
              <button onClick={() => setAdminSettings({ require2FA: !(adminSettings as AdminSettings).require2FA })} className="h-6 w-11 rounded-full p-0.5 transition" style={{ background: (adminSettings as AdminSettings).require2FA ? 'var(--grad)' : 'var(--line)' }}><span className={`block h-5 w-5 rounded-full bg-white transition ${(adminSettings as AdminSettings).require2FA ? 'translate-x-5' : ''}`} /></button>
            </div>
            <p className="text-[11px] text-muted">PIN brute-force protection + activity audit + persistent session. All admin actions are logged with timestamp.</p>
          </div>
        </div>
      )}

      {/* ---- Users ---- */}
      {tab === 'Users' && (
        <div className="space-y-2">
          <div className="relative mb-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / email" className="input pl-9" />
          </div>
          {filtered.map((u) => (
            <button key={u.id} onClick={() => setSelUser(u)} className="card flex w-full items-center gap-3 p-3 text-left active:scale-[.99] transition">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold" style={{ background: 'var(--glass)' }}>{u.name[0]}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{u.name}</div>
                <div className="truncate text-[11px] text-muted">{u.email} · {u.loginMethod === 'google' ? '🔵 Google' : '✉️ Email'}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="tnum text-sm font-bold text-emerald2">{fmt(u.balanceMinor)}</div>
                <span className="chip text-[10px] font-bold" style={u.status === 'active' ? { background: 'rgba(31,203,139,.15)', color: 'var(--emerald)' } : { background: 'rgba(255,92,105,.15)', color: 'var(--danger)' }}>{u.status}</span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && <p className="py-8 text-center text-sm text-muted">No users found</p>}
        </div>
      )}

      {/* ---- Games ---- */}
      {tab === 'Games' && (
        <div className="space-y-2">
          {MODES.map((m) => (
            <div key={m.id} className="card flex items-center justify-between p-3">
              <div><div className="text-sm font-bold">{m.game} · {m.id}</div><div className="text-[11px] text-muted">{m.players}P · entry {fmt(m.entryMinor)} · prize {fmt(m.prizeMinor)}{m.clock ? ` · ${m.clock}` : ''}</div></div>
              <button onClick={() => { setTab('Images'); setModeImgId(m.id); const img = gameModeImages[m.id]; setModeBgUrl(img?.backgroundImage || ''); setModeThumbUrl(img?.thumbnailImage || '') }} className="chip text-xs font-bold text-gold" style={{ background: 'rgba(255,212,102,.12)' }}>Edit</button>
            </div>
          ))}
          <button onClick={() => toast('Custom mode creation needs a backend — planned next', 'info')} className="btn-primary mt-1 w-full"><Plus className="h-4 w-4" strokeWidth={2.6} />Create game mode</button>
        </div>
      )}

      {/* ---- Announce ---- */}
      {tab === 'Announce' && (
        <div className="space-y-3">
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold"><Megaphone className="h-4 w-4 text-cyan2" strokeWidth={2.2} />New announcement</div>
            <div><label className="label">Send to</label>
              <select className="input" value={annTarget} onChange={(e) => setAnnTarget(e.target.value)}>
                <option value="all">📢 All users (broadcast)</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
              </select>
            </div>
            <input className="input" placeholder="Title" value={annTitle} onChange={(e) => setAnnTitle(e.target.value)} />
            <textarea className="input min-h-[70px]" placeholder="Message" value={annBody} onChange={(e) => setAnnBody(e.target.value)} />
            <button onClick={sendAnn} className="btn-primary w-full"><Send className="h-4 w-4" strokeWidth={2.2} />{annTarget === 'all' ? 'Broadcast to all' : 'Send to user'}</button>
          </div>
          {announcements.map((a) => (
            <div key={a.id} className="card p-3">
              <div className="flex items-center gap-2"><div className="flex-1 text-sm font-bold">{a.titleEn}</div>{a.targetName && <span className="chip text-[10px] text-primary-2" style={{ background: 'rgba(139,92,255,.12)' }}>→ {a.targetName}</span>}</div>
              <div className="text-[11px] text-muted">{a.bodyEn}</div>
            </div>
          ))}
        </div>
      )}

      {/* ---- Banners ---- */}
      {tab === 'Banners' && (
        <div className="space-y-3">
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold"><Image className="h-4 w-4 text-teal2" strokeWidth={2.2} />New banner</div>
            <input className="input" placeholder="Banner title" value={bnTitle} onChange={(e) => setBnTitle(e.target.value)} />
            <div><label className="label">Link URL (optional — banner opens it on tap)</label><input className="input" placeholder="https://…" value={bnUrl} onChange={(e) => setBnUrl(e.target.value)} /></div>
            <button onClick={() => { if (!bnTitle.trim()) return toast('Enter a title', 'err'); addBanner({ titleEn: bnTitle, titleBn: bnTitle, url: bnUrl.trim(), active: true }); setBnTitle(''); setBnUrl(''); toast('Banner added ✓', 'ok') }} className="btn-primary w-full"><Plus className="h-4 w-4" strokeWidth={2.6} />Add banner</button>
          </div>
          {banners.map((b) => (
            <div key={b.id} className="card flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{b.titleEn}</div><div className="truncate text-[11px] text-muted">{b.url || 'no link'}</div></div>
              <button onClick={() => toggleBanner(b.id)} className="h-6 w-11 shrink-0 rounded-full p-0.5 transition" style={{ background: b.active ? 'var(--grad)' : 'var(--line)' }}><span className={`block h-5 w-5 rounded-full bg-white transition ${b.active ? 'translate-x-5' : ''}`} /></button>
              <button onClick={() => removeBanner(b.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-danger" style={{ background: 'rgba(255,92,105,.12)' }}><Trash2 className="h-4 w-4" strokeWidth={2} /></button>
            </div>
          ))}
        </div>
      )}

      {/* ---- Bonus ---- */}
      {tab === 'Bonus' && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold"><Gift className="h-4 w-4 text-gold" strokeWidth={2.2} />Bonus configuration</div>
          {([
            ['Welcome bonus (৳)', 'welcomeMinor'], ['Referral bonus (৳)', 'referralMinor'], ['Daily login (৳)', 'dailyMinor'],
          ] as const).map(([label, key]) => (
            <div key={key}><label className="label">{label}</label>
              <input type="number" className="input tnum" defaultValue={Math.round(bonus[key] / 100)} onBlur={(e) => setBonusConfig({ [key]: toMinor(Number(e.target.value) || 0) })} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
            </div>
          ))}
          <div><label className="label">Deposit bonus (%)</label><input type="number" className="input tnum" defaultValue={bonus.depositPct} onBlur={(e) => setBonusConfig({ depositPct: Number(e.target.value) || 0 })} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} /></div>
          <p className="text-[11px] text-muted">Applied automatically on the matching event.</p>
        </div>
      )}

      {/* ---- Payments ---- */}
      {tab === 'Payments' && (
        <div className="space-y-3">
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold">
              <CreditCard className="h-4 w-4 text-primary-2" strokeWidth={2.2} />
              Live gateway
            </div>

            {/*
              Manual is the default and the floor, not an oversight. A gateway can
              only be switched on after it has a merchant account, credentials set
              as Supabase function secrets, and a signed checkout + verified
              webhook written against that provider's docs. The list below is the
              full set of candidates that can settle BDT; a row stays Manual until
              all of that is true, so a deposit is never routed to a gateway that
              cannot take the money.

              Razorpay is shown greyed out on purpose: it settles in INR only and
              will not accept a taka transaction, so it is listed to stop it being
              added back as if it were an option.
            */}
            <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold">Currently: {liveGw.provider === 'manual' ? 'Manual' : liveGw.provider}</div>
                  <div className="text-[11px] text-muted">
                    {liveGw.mode === 'auto'
                      ? 'Deposits go to the gateway and are credited by its webhook.'
                      : liveGw.reason || 'Player sends the transfer, an admin approves it.'}
                  </div>
                </div>
                <span className="chip shrink-0 text-[11px] font-bold"
                  style={liveGw.mode === 'auto'
                    ? { background: 'rgba(16,185,129,.16)', color: 'var(--emerald2)' }
                    : { background: 'rgba(234,179,8,.16)', color: 'var(--gold)' }}>
                  {liveGw.mode === 'auto' ? 'Automatic' : 'Manual'}
                </span>
              </div>
              <button onClick={() => void refreshLiveGateway()} className="btn-ghost mt-2 w-full py-1.5 text-xs">Re-check</button>
            </div>

            <div>
              <label className="label">Gateway candidates (BDT)</label>
              <div className="space-y-1.5">
                {GATEWAYS.map((g) => {
                  const usable = isUsable(g)
                  return (
                    <div key={g.id} className="rounded-xl border border-line px-3 py-2"
                      style={{ opacity: usable ? 1 : 0.55 }}>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold">{g.label}</span>
                        {g.id === liveGw.provider && liveGw.mode === 'auto' && (
                          <span className="chip text-[10px] font-bold" style={{ background: 'rgba(16,185,129,.16)', color: 'var(--emerald2)' }}>LIVE</span>
                        )}
                        {!usable && <span className="chip text-[10px]">not for BDT</span>}
                      </div>
                      {g.note && <p className="mt-1 text-[11px] leading-snug text-muted">{g.note}</p>}
                      {usable && g.secrets.length > 0 && (
                        <p className="mt-1 text-[11px] leading-snug text-muted">
                          Needs these Supabase function secrets: <span className="tnum">{g.secrets.join(', ')}</span>
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <p className="text-[11px] leading-snug text-muted">
              ⚠️ Adding a row here does not enable it. To go automatic: get the merchant account,
              set the secrets above with <span className="tnum">supabase secrets set</span>, finish
              <span className="tnum"> buildSession()</span> in <span className="tnum">payment-checkout</span> and
              <span className="tnum"> verify()</span> in <span className="tnum">payment-webhook</span>, then flip
              mode to Automatic in the database. Until every step is done, deposits stay manual.
            </p>
          </div>

          <div className="card p-4 space-y-3">
            <div className="text-sm font-bold">Manual payment numbers</div>
            <div><label className="label">Provider shown to players</label>
              <select className="input" value={pay.provider} onChange={(e) => setPaymentConfig({ provider: e.target.value })}>
                {['bKash', 'Nagad', 'Rocket'].map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{pay.provider} merchant number</label>
              <input className="input" value={pay.merchantId} onChange={(e) => setPaymentConfig({ merchantId: e.target.value })} placeholder="e.g. 01712-345678" />
              <p className="mt-1 text-[11px] text-muted">The number players are told to send money to, used on the manual path. Leave blank for the built-in placeholder.</p>
            </div>
          </div>
        </div>
      )}

      {/* ---- Withdrawals ---- */}
      {tab === 'Withdrawals' && (
        <div className="space-y-2">
          {/* deposit approvals — balance is credited ONLY here */}
          <div className="card p-4 flex items-center gap-2">
            <Banknote className="h-4 w-4 text-emerald2" strokeWidth={2.2} />
            <div className="text-sm font-bold">Deposit approvals</div>
            <span className="ml-auto chip text-[11px]">{deposits.filter((d) => d.status === 'pending').length} pending</span>
          </div>
          {deposits.length === 0 && <p className="py-4 text-center text-sm text-muted">No deposit requests</p>}
          {deposits.map((d) => (
            <div key={d.id} className="card p-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{d.user}</div><div className="truncate text-[11px] text-muted">{d.method} · {new Date(d.ts).toLocaleString()} · {d.id.slice(-6)}</div>
                  {/*
                    The transaction id is the whole point of a manual deposit: it
                    is how the admin tells this payment apart in a bank/mobile
                    statement, and deposits_ref_unique uses it to stop one payment
                    being credited twice. It used to be collected nowhere, stored
                    nowhere and shown nowhere, so approving a deposit meant taking
                    the admin's word for it.
                  */}
                  {d.ref && <div className="mt-0.5 truncate text-[11px] font-bold tnum">TxID {d.ref}</div>}
                </div>
                <div className="tnum text-sm font-extrabold text-emerald2">{fmt(d.amountMinor)}</div>
                <span className="chip text-[10px] font-bold" style={d.status === 'pending' ? { background: 'rgba(255,212,102,.15)', color: 'var(--gold)' } : d.status === 'approved' ? { background: 'rgba(31,203,139,.15)', color: 'var(--emerald)' } : { background: 'rgba(255,92,105,.15)', color: 'var(--danger)' }}>{d.status}</span>
              </div>
              {d.status === 'pending' && (
                <div className="mt-2 flex gap-2">
                  <button onClick={() => { setDepositStatus(d.id, 'approved'); toast('Deposited ✓', 'ok') }} className="btn-emerald flex-1 py-2 text-xs"><CheckCircle2 className="h-4 w-4" />Payment received · Credit</button>
                  <button onClick={() => { setDepositStatus(d.id, 'rejected'); toast('Rejected', 'info') }} className="btn-danger flex-1 py-2 text-xs"><Ban className="h-4 w-4" />Reject</button>
                </div>
              )}
            </div>
          ))}
          <div className="card p-4 flex items-center gap-2">
            <Banknote className="h-4 w-4 text-gold" strokeWidth={2.2} />
            <div className="text-sm font-bold">Payout queue</div>
            <span className="ml-auto chip text-[11px]">{withdrawals.filter((w) => w.status === 'pending').length} pending</span>
          </div>
          {withdrawals.length === 0 && <p className="py-8 text-center text-sm text-muted">No withdrawal requests</p>}
          {withdrawals.map((w) => (
            <div key={w.id} className="card p-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{w.user}</div><div className="truncate text-[11px] text-muted">{w.method} · {new Date(w.ts).toLocaleString()}</div>
                  {w.account && <div className="mt-0.5 truncate text-[11px] font-bold tnum">Pay to {w.account}</div>}
                </div>
                <div className="tnum text-sm font-extrabold text-gold">{fmt(w.amountMinor)}</div>
                <span className="chip text-[10px] font-bold" style={w.status === 'pending' ? { background: 'rgba(255,212,102,.15)', color: 'var(--gold)' } : w.status === 'approved' ? { background: 'rgba(31,203,139,.15)', color: 'var(--emerald)' } : { background: 'rgba(255,92,105,.15)', color: 'var(--danger)' }}>{w.status}</span>
              </div>
              {w.status === 'pending' && (
                <div className="mt-2 flex gap-2">
                  <button onClick={() => { setWithdrawalStatus(w.id, 'approved'); toast('Paid ✓', 'ok') }} className="btn-emerald flex-1 py-2 text-xs"><CheckCircle2 className="h-4 w-4" />Approve / Paid</button>
                  <button onClick={() => { setWithdrawalStatus(w.id, 'rejected'); toast('Rejected + refunded', 'info') }} className="btn-danger flex-1 py-2 text-xs"><Ban className="h-4 w-4" />Reject + Refund</button>
                </div>
              )}
            </div>
          ))}
          <p className="text-[11px] text-muted px-1">Approve = mark paid via bank/mobile transfer. Reject = auto-refund to user wallet. Live auto-gateway needs provider keys (bKash/Nagad/Stripe).</p>
        </div>
      )}

      {/* ---- Support ---- */}
      {tab === 'Support' && (
        <div className="space-y-2">
          {tickets.length === 0 ? <p className="py-8 text-center text-sm text-muted">No support tickets</p> : tickets.map((tk) => (
            <div key={tk.id} className="card p-3">
              <div className="flex items-center gap-2"><div className="flex-1 text-sm font-bold">{tk.subject}</div><span className="chip text-[10px] font-bold" style={{ background: tk.status === 'closed' ? 'rgba(120,120,130,.2)' : tk.status === 'answered' ? 'rgba(31,203,139,.15)' : 'rgba(255,196,54,.15)', color: tk.status === 'closed' ? 'var(--muted)' : tk.status === 'answered' ? 'var(--emerald2)' : 'var(--gold)' }}>{tk.status}</span></div>
              <div className="text-[11px] text-muted">{tk.category} · {tk.id}</div>
              <div className="mt-1.5 max-h-28 space-y-1 overflow-y-auto rounded-xl bg-black/5 p-2">
                {tk.msgs.map((m, i) => (
                  <p key={i} className={`text-[12px] leading-snug ${m.me ? 'text-right text-muted' : 'font-semibold text-emerald2'}`}>{m.me ? 'User' : 'Support'}: {m.text}</p>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <input className="input flex-1 !py-1.5 text-xs" placeholder="Reply to user…" value={tkId === tk.id ? tkReply : ''}
                  onFocus={() => setTkId(tk.id)} onChange={(e) => setTkReply(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && tkReply.trim()) { adminReplyTicket(tk.id, tkReply.trim()); setTkReply(''); toast('Reply sent ✓', 'ok') } }} />
                <button onClick={() => { if (!tkReply.trim()) return toast('Type a reply', 'err'); adminReplyTicket(tk.id, tkReply.trim()); setTkReply(''); toast('Reply sent ✓', 'ok') }} className="btn-primary px-3 text-xs">Reply</button>
                {tk.status !== 'closed' && (
                  <button onClick={() => { setTicketStatus(tk.id, 'closed'); toast('Ticket closed ✓', 'ok') }} className="btn-ghost px-3 text-xs">Close</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---- Images ---- */}
      {tab === 'Images' && (
        <div className="space-y-4">
          {/* Category Card Images */}
          <div className="card p-4 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold"><ImageIcon className="h-4 w-4 text-teal2" strokeWidth={2.2} />Category Card Backgrounds</div>
            <p className="text-[11px] text-muted">Upload custom background images for the 3 main category cards on Home screen. Max 5MB, JPG/PNG/WebP/GIF.</p>
            <div className="grid grid-cols-3 gap-3">
              {(['freefire', 'ingame', 'ludoking'] as const).map((key) => (
                <CategoryImageUpload key={key} keyName={key} currentImage={categoryImages[key]} onSave={(url) => setCategoryImage(key, url)} onRemove={() => removeCategoryImage(key)} />
              ))}
            </div>
          </div>

          {/* Game Mode Images */}
          <div className="card p-4 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold"><ImageIcon className="h-4 w-4 text-primary-2" strokeWidth={2.2} />Game Mode Card Images</div>
            <p className="text-[11px] text-muted">Upload background and thumbnail/logo images for individual game mode cards. Max 5MB each.</p>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="card p-3 space-y-2">
                  <label className="label">Game Mode ID</label>
                  <select className="input" value={modeImgId} onChange={(e) => { setModeImgId(e.target.value); const img = gameModeImages[e.target.value]; setModeBgUrl(img?.backgroundImage || ''); setModeThumbUrl(img?.thumbnailImage || '') }}>
                    <option value="">Select a mode</option>
                    {MODES.map((m) => <option key={m.id} value={m.id}>{m.game} · {m.id}</option>)}
                  </select>
                </div>
                <div className="col-span-2 card p-3 space-y-2">
                  <label className="label">Background Image</label>
                  <GameModeImageUpload 
                    currentImage={modeBgUrl} 
                    onSave={(url) => { setModeBgUrl(url); if (modeImgId) setGameModeImage(modeImgId, { backgroundImage: url }) }} 
                    onRemove={() => { setModeBgUrl(''); if (modeImgId) setGameModeImage(modeImgId, { backgroundImage: undefined }) }}
                    label="Background"
                  />
                </div>
                <div className="col-span-2 card p-3 space-y-2">
                  <label className="label">Thumbnail/Logo Image</label>
                  <GameModeImageUpload 
                    currentImage={modeThumbUrl} 
                    onSave={(url) => { setModeThumbUrl(url); if (modeImgId) setGameModeImage(modeImgId, { thumbnailImage: url }) }} 
                    onRemove={() => { setModeThumbUrl(''); if (modeImgId) setGameModeImage(modeImgId, { thumbnailImage: undefined }) }}
                    label="Thumbnail"
                  />
                </div>
                <div className="col-span-3 flex gap-2">
                  {modeImgId && (
                    <>
                      <button onClick={() => { setGameModeImage(modeImgId, { backgroundImage: modeBgUrl || undefined, thumbnailImage: modeThumbUrl || undefined }); setModeImgId(''); setModeBgUrl(''); setModeThumbUrl(''); toast('Game mode images updated ✓', 'ok') }} className="btn-primary"><Upload className="h-3.5 w-3.5 mr-1" />Save Images</button>
                      {(gameModeImages[modeImgId]?.backgroundImage || gameModeImages[modeImgId]?.thumbnailImage) && (
                        <button onClick={() => { removeGameModeImage(modeImgId); setModeImgId(''); setModeBgUrl(''); setModeThumbUrl(''); toast('Game mode images removed', 'ok') }} className="btn-danger"><Trash2 className="h-3.5 w-3.5 mr-1" />Remove All</button>
                      )}
                    </>
                  )}
                </div>
              </div>
              
{/* Preview of configured game mode images */}
              {Object.keys(gameModeImages).length > 0 && (
                <div className="pt-2 border-t">
                  <div className="text-sm font-semibold mb-2">Configured Modes:</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {Object.entries(gameModeImages).map(([id, img]) => (
                      <div key={id} className="card p-2 space-y-1">
                        <div className="text-xs font-bold text-muted">{id}</div>
                        <div className="relative h-16 rounded overflow-hidden border" style={{ backgroundImage: `url(${img.backgroundImage || 'none'})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
                          {!img.backgroundImage && <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted">No BG</span>}
                        </div>
                        {img.thumbnailImage && (
                          <div className="relative h-12 rounded overflow-hidden border" style={{ backgroundImage: `url(${img.thumbnailImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
                            <span className="absolute bottom-1 left-1 text-[9px] bg-black/50 px-1 py-0.5 rounded">Thumb</span>
                          </div>
                        )}
                        <div className="flex gap-1">
                          <button onClick={() => { setModeImgId(id); setModeBgUrl(img.backgroundImage || ''); setModeThumbUrl(img.thumbnailImage || '') }} className="btn-ghost flex-1 text-[10px]">Edit</button>
                          <button onClick={() => { removeGameModeImage(id); toast('Removed', 'ok') }} className="btn-danger flex-1 text-[10px]"><Trash2 className="h-3 w-3" strokeWidth={2} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---- Settings ---- */}
      {tab === 'Settings' && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold"><SlidersHorizontal className="h-4 w-4 text-cyan2" strokeWidth={2.2} />Site settings</div>
          {([
            ['Maintenance mode', 'maintenance'], ['In-match voice fee', 'voiceFee'], ['Chess enabled', 'chessEnabled'],
          ] as const).map(([label, key]) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-sm font-semibold">{label}</span>
              <button onClick={() => setSiteConfig({ [key]: !site[key] })} className="h-6 w-11 rounded-full p-0.5 transition" style={{ background: site[key] ? 'var(--grad)' : 'var(--line)' }}><span className={`block h-5 w-5 rounded-full bg-white transition ${site[key] ? 'translate-x-5' : ''}`} /></button>
            </div>
          ))}
          <div><label className="label">Min withdrawal (৳)</label><input type="number" className="input tnum" defaultValue={Math.round(site.minWithdrawMinor / 100)} onBlur={(e) => setSiteConfig({ minWithdrawMinor: toMinor(Number(e.target.value) || 0) })} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} /></div>

          {/* Your own sign-in details. These belong to the Supabase auth user,
              not to anything in this app's own state - which is why they are not
              editable as a "user record" like the ones in the Users tab. */}
          <div className="space-y-3 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
            <div className="flex items-center gap-2 text-sm font-bold"><Shield className="h-4 w-4 text-emerald2" strokeWidth={2.2} />Your login</div>
            {!hasSupabase ? (
              <p className="text-xs text-muted">Supabase is not configured, so there is no account to change yet.</p>
            ) : (
              <>
                <div><label className="label">Current email</label><input className="input" value={myEmail} readOnly /></div>

                <div>
                  <label className="label">Change email</label>
                  <div className="flex gap-2">
                    <input className="input" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="new@example.com" autoCapitalize="none" />
                    <button onClick={doEmail} disabled={credBusy || !newEmail.trim() || newEmail.trim() === myEmail} className="btn-primary shrink-0 px-4">Save</button>
                  </div>
                  <p className="mt-1 text-[11px] text-muted">Supabase emails a confirmation link. Keep signing in with the old address until you click it.</p>
                </div>

                <div>
                  <label className="label">Change password</label>
                  <input type="password" className="input" value={curPw} onChange={(e) => setCurPw(e.target.value)} placeholder="Current password" autoComplete="current-password" />
                  <input type="password" className="input mt-2" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="New password (min 8)" autoComplete="new-password" />
                  <button onClick={doPw} disabled={credBusy || !curPw || newPw.length < 8} className="btn-primary mt-2 w-full">
                    {credBusy ? 'Working…' : 'Update password'}
                  </button>
                  <p className="mt-1 text-[11px] text-muted">Your current password is checked first, so an unlocked phone cannot lock you out.</p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ---- user detail sheet ---- */}
      <Sheet open={!!selUser} onClose={() => setSelUser(null)}>
        {selUser && (
          <>
            <div className="mb-3 flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-full text-lg font-bold" style={{ background: 'var(--glass)' }}>{selUser.name[0]}</div>
              <div className="min-w-0"><div className="truncate font-display font-extrabold">{selUser.name}</div><div className="truncate text-[11px] text-muted">{selUser.email} · {selUser.loginMethod === 'google' ? '🔵 Google' : '✉️ Email'}</div></div>
            </div>
            <div className="mb-3 flex items-center justify-between rounded-2xl p-3" style={{ background: 'var(--bg)' }}>
              <span className="text-sm text-muted">Balance</span><span className="tnum font-display text-lg font-extrabold text-emerald2">{fmt(selUser.balanceMinor)}</span>
            </div>
            <label className="label">Adjust balance (৳)</label>
            <div className="mb-3 flex gap-2">
              <input type="number" className="input tnum flex-1" placeholder="amount" value={balAmt} onChange={(e) => setBalAmt(e.target.value)} />
              <button onClick={() => applyBal(1)} className="btn-emerald px-4"><Plus className="h-4 w-4" strokeWidth={2.6} /></button>
              <button onClick={() => applyBal(-1)} className="btn-danger px-4"><Minus className="h-4 w-4" strokeWidth={2.6} /></button>
            </div>
            <div className="flex gap-2">
              {selUser.status === 'active' ? (
                <button onClick={() => { setUserStatus(selUser.id, 'suspended'); setSelUser({ ...selUser, status: 'suspended' }); toast('User suspended', 'info') }} className="btn-ghost flex-1"><Ban className="h-4 w-4" strokeWidth={2.2} />Suspend</button>
              ) : (
                <button onClick={() => { setUserStatus(selUser.id, 'active'); setSelUser({ ...selUser, status: 'active' }); toast('User activated ✓', 'ok') }} className="btn-emerald flex-1"><CheckCircle2 className="h-4 w-4" strokeWidth={2.2} />Activate</button>
              )}
              <button onClick={() => { deleteUser(selUser.id); setSelUser(null); toast('User deleted', 'err') }} className="btn-danger flex-1"><Trash2 className="h-4 w-4" strokeWidth={2.2} />Delete</button>
            </div>
          </>
        )}
      </Sheet>
    </div>
  )
}

// --- Upload Components ---
function CategoryImageUpload({ keyName, currentImage, onSave, onRemove }: { keyName?: keyof CategoryImageConfig; currentImage?: string; onSave?: (url: string) => void; onRemove?: () => void }) {
  const toast = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const validation = validateImageFile(f)
    if (!validation.valid) { toast(validation.error!, 'err'); return }
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  const handleSave = async () => {
    if (!file || !onSave) return
    setUploading(true)
    try {
      const base64 = await fileToBase64(file)
      onSave(base64)
      setFile(null)
      setPreview(null)
      toast(`${keyName} background uploaded ✓`, 'ok')
    } catch { toast('Upload failed', 'err') }
    setUploading(false)
  }

  const handleRemove = () => {
    onRemove?.()
    setFile(null)
    setPreview(null)
    toast('Removed', 'ok')
  }

  if (!keyName) return null

  return (
    <div className="card p-3 space-y-2">
      <label className="label capitalize">{keyName}</label>
      <div className="relative h-28 rounded-lg overflow-hidden border bg-black/20 flex items-center justify-center">
        {(preview || currentImage) && (
          <img src={preview || currentImage!} alt={keyName} className="w-full h-full object-cover" />
        )}
        {!preview && !currentImage && <span className="text-[11px] text-muted">No image</span>}
        {uploading && <div className="absolute inset-0 bg-black/50 flex items-center justify-center"><div className="h-6 w-6 animate-spin border-2 border-white border-t-transparent rounded-full" /></div>}
      </div>
      <div className="flex gap-2">
        <label className="btn-ghost flex-1 text-xs">
          <Upload className="h-3.5 w-3.5 mr-1" />
          {currentImage ? 'Change' : 'Upload'}
          <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
        </label>
        {(preview || currentImage) && (
          <button onClick={handleRemove} className="btn-danger flex-1 text-xs"><X className="h-3.5 w-3.5 mr-1" />Remove</button>
        )}
        {preview && !uploading && <button onClick={handleSave} className="btn-primary flex-1 text-xs" disabled={uploading}>Save</button>}
      </div>
    </div>
  )
}

function GameModeImageUpload({ currentImage, onSave, onRemove, label }: { currentImage?: string; onSave?: (url: string) => void; onRemove?: () => void; label: string }) {
  const toast = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const validation = validateImageFile(f)
    if (!validation.valid) { toast(validation.error!, 'err'); return }
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  const handleSave = async () => {
    if (!file || !onSave) return
    setUploading(true)
    try {
      const base64 = await fileToBase64(file)
      onSave(base64)
      setFile(null)
      setPreview(null)
      toast(`${label} uploaded ✓`, 'ok')
    } catch { toast('Upload failed', 'err') }
    setUploading(false)
  }

  const handleRemove = () => {
    onRemove?.()
    setFile(null)
    setPreview(null)
    toast('Removed', 'ok')
  }

  return (
    <div className="space-y-2">
      <div className="relative h-24 rounded-lg overflow-hidden border bg-black/20 flex items-center justify-center">
        {(preview || currentImage) && (
          <img src={preview || currentImage!} alt={label} className="w-full h-full object-cover" />
        )}
        {!preview && !currentImage && <span className="text-[11px] text-muted">No image</span>}
        {uploading && <div className="absolute inset-0 bg-black/50 flex items-center justify-center"><div className="h-6 w-6 animate-spin border-2 border-white border-t-transparent rounded-full" /></div>}
      </div>
      <div className="flex gap-2">
        <label className="btn-ghost flex-1 text-xs">
          <Upload className="h-3.5 w-3.5 mr-1" />
          {currentImage ? 'Change' : 'Upload'}
          <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
        </label>
        {(preview || currentImage) && (
          <button onClick={handleRemove} className="btn-danger flex-1 text-xs"><X className="h-3.5 w-3.5 mr-1" />Remove</button>
        )}
        {preview && !uploading && <button onClick={handleSave} className="btn-primary flex-1 text-xs" disabled={uploading}>Save</button>}
      </div>
    </div>
  )
}
