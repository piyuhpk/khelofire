import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { toMinor } from './money'
import { hasSupabase, supabase } from './supabase'
import * as wallet from './wallet'
import type { PendingRow } from './wallet'
import { notify, notifyError } from './notice'

/** true once Supabase keys exist — then money is decided by the server, not here */
const liveMode = hasSupabase

// sync.ts imports this file, so importing it back statically would be a cycle.
// Load it on demand instead.
const refreshFromServer = () =>
  import('./sync').then((m) => m.loadUserData()).catch((e) => notifyError('Refresh failed', e))

// Helper to convert file to base64 — auto-downscaled so big uploads can never
// blow the ~5MB localStorage quota (which would silently break ALL saves)
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const src = reader.result as string
      if (file.type === 'image/gif' || file.size <= 400 * 1024) return resolve(src)
      const img = new Image()
      img.onload = () => {
        const max = 900
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const cv = document.createElement('canvas')
        cv.width = Math.max(1, Math.round(img.width * scale))
        cv.height = Math.max(1, Math.round(img.height * scale))
        const ctx = cv.getContext('2d')
        if (!ctx) return resolve(src)
        ctx.drawImage(img, 0, 0, cv.width, cv.height)
        try { resolve(cv.toDataURL('image/jpeg', 0.75)) } catch { resolve(src) }
      }
      img.onerror = () => resolve(src)
      img.src = src
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Validate image file
export const validateImageFile = (file: File): { valid: boolean; error?: string } => {
  const maxSize = 5 * 1024 * 1024 // 5MB
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  if (!allowedTypes.includes(file.type)) return { valid: false, error: 'Only JPG, PNG, WebP, GIF allowed' }
  if (file.size > maxSize) return { valid: false, error: 'Max 5MB per image' }
  return { valid: true }
}

export type GameKey = 'ludo' | 'chess' | 'guti' | 'dice'
export type LedgerType = 'deposit' | 'withdrawal' | 'entry_debit' | 'prize_credit' | 'refund_credit' | 'lock' | 'unlock' | 'welcome'
export type TxnStatus = 'pending' | 'completed' | 'failed' | 'refunded'
export type Outcome = 'win' | 'loss' | 'draw' | 'cancelled'

export interface Ledger {
  id: string; type: LedgerType; amountMinor: number; balanceAfter: number
  status: TxnStatus; ts: number; note: string
}
export interface MatchRecord {
  id: string; game: GameKey; mode: string; modeId: string; entryMinor: number; prizeMinor: number
  outcome: Outcome; deltaMinor: number; ts: number; moves?: number
  /** set only for a real match: the live_matches row the server settled.
   *  Its absence means a local/bot game, which has no stake to settle. */
  liveMatchId?: string
}
export interface Notif { id: string; type: string; titleBn: string; titleEn: string; ts: number; read: boolean }
export type TicketStatus = 'open' | 'answered' | 'closed'
export interface TicketMsg { me: boolean; text: string; ts: number }
export interface Ticket { id: string; subject: string; category: string; status: TicketStatus; msgs: TicketMsg[]; ts: number }
export interface Referral { id: string; name: string; ts: number; rewardMinor: number; status: 'joined' | 'played' }
export interface Announcement { id: string; titleBn: string; titleEn: string; bodyBn: string; bodyEn: string; ts: number; targetUserId?: string; targetName?: string }
// ---- admin-managed data ----
export interface AdminUser { 
  id: string; 
  name: string; 
  email: string; 
  loginMethod: 'email' | 'google'; 
  balanceMinor: number; 
  status: 'active' | 'suspended' | 'deleted'; 
  role: 'user' | 'admin' | 'superadmin' | 'support'; 
  joined: number 
  lastLogin?: number
  permissions?: AdminPermission[]
}
export interface AdminPermission { 
  resource: string; 
  actions: ('read' | 'write' | 'delete' | 'manage')[]
}
export interface AdminRole { 
  id: string; 
  name: string; 
  description: string; 
  permissions: AdminPermission[]
}
export interface AdminActivity { 
  id: string; 
  adminId: string; 
  action: string; 
  resource: string; 
  details?: string; 
  ip?: string; 
  ts: number 
}
// `account` and `ref` are not decoration. request_withdrawal raises
// 'enter the account to receive the money' on a blank account, so a withdrawal
// sent without one can never be created; and deposits_ref_unique only protects
// against double-crediting a payment when the player gives the transaction id,
// which the admin then needs in order to actually verify it.
export interface Withdrawal { id: string; user: string; amountMinor: number; method: string; account: string; status: 'pending' | 'approved' | 'rejected'; ts: number }
export interface Deposit { id: string; user: string; amountMinor: number; method: string; ref: string; status: 'pending' | 'approved' | 'rejected'; ts: number }
export interface AdminBanner { id: string; titleEn: string; titleBn: string; url: string; active: boolean }
export interface BonusConfig { welcomeMinor: number; referralMinor: number; dailyMinor: number; depositPct: number }
// Manual only, and there is deliberately no `enabled` flag and no `apiKey`.
// Both existed and neither was ever read by any payment code path, so the admin
// toggle looked like it was taking live money while changing nothing - and the
// key was persisted to localStorage in plaintext. A provider key belongs in a
// server-side secret store, not in a Zustand object that ships to the browser,
// and there is no gateway integration for a key to unlock.
export interface PaymentConfig { provider: string; merchantId: string }

/**
 * Which gateway the server says is live. Read from active_gateway() rather than
 * trusted from the client, because "a gateway is on" is a security claim: if the
 * browser can decide it, so can anyone who edits a request.
 */
export interface LiveGateway {
  provider: string
  mode: 'manual' | 'auto'
  merchant_id: string
  reason: string
}
export interface SiteConfig { maintenance: boolean; minWithdrawMinor: number; voiceFee: boolean; chessEnabled: boolean }
// NOTE: no adminPin. The old settings object carried the admin password in
// plain localStorage, so anyone could read it from their own phone (and
// /admin-access?pin=4321 was a public URL). Admin access is now decided by the
// server from the `staff` table - see src/lib/auth.ts adminSignIn.
export interface AdminSettings { sessionTimeout: number; maxLoginAttempts: number; lockoutDuration: number; require2FA: boolean; auditLogRetentionDays: number }
export interface CategoryImageConfig { freefire?: string; ingame?: string; ludoking?: string }
export interface GameModeImageConfig { [modeId: string]: { backgroundImage?: string; thumbnailImage?: string } }

interface DemoState {
  authed: boolean
  username: string
  playerId: string
  avatar: string
  referralCode: string
  availableMinor: number
  lockedMinor: number
  wins: number; losses: number; draws: number
  ledger: Ledger[]
  matches: MatchRecord[]
  notifs: Notif[]
  tickets: Ticket[]
  referrals: Referral[]
  referralEarnedMinor: number
  announcements: Announcement[]
  dismissedAnnId: string | null
  // admin
  isAdmin: boolean
  staffRole: string | null
  adminSession: boolean
  adminUsers: AdminUser[]
  adminRoles: AdminRole[]
  adminActivity: AdminActivity[]
  adminSettings: AdminSettings
  banners: AdminBanner[]
  bonusConfig: BonusConfig
  paymentConfig: PaymentConfig
  liveGateway: LiveGateway
  siteConfig: SiteConfig
  categoryImages: CategoryImageConfig
  gameModeImages: GameModeImageConfig
  withdrawals: Withdrawal[]
  deposits: Deposit[]
  // actions
  login: (username?: string) => void
  logout: () => void
  updateProfile: (patch: Partial<Pick<DemoState, 'username' | 'avatar'>>) => void
  createTicket: (subject: string, category: string, message: string) => string
  replyTicket: (id: string, text: string) => void
  postAnnouncement: (a: Omit<Announcement, 'id' | 'ts'>) => void
  dismissAnnouncement: (id: string) => void
  // admin actions
  adminSignIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>
  adminLogout: () => void
  setStaffRole: (role: string | null) => void
  setUserStatus: (id: string, status: AdminUser['status']) => void
  deleteUser: (id: string) => void
  adjustUserBalance: (id: string, deltaMinor: number) => void
  addBanner: (b: Omit<AdminBanner, 'id'>) => void
  removeBanner: (id: string) => void
  toggleBanner: (id: string) => void
  setBonusConfig: (patch: Partial<BonusConfig>) => void
  setPaymentConfig: (patch: Partial<PaymentConfig>) => void
  refreshLiveGateway: () => Promise<void>
  setSiteConfig: (patch: Partial<SiteConfig>) => void
  setAdminSettings: (patch: Partial<AdminSettings>) => void
  addAdminUser: (u: Omit<AdminUser, 'id' | 'joined'>) => void
  updateAdminRole: (userId: string, role: AdminUser['role']) => void
  createAdminRole: (name: string, description: string) => void
  adminReplyTicket: (id: string, text: string) => void
  setTicketStatus: (id: string, status: TicketStatus) => void
  logAdminActivity: (action: string, resource: string, details?: string) => void
  getAdminActivity: (adminId?: string) => AdminActivity[]
  setCategoryImage: (key: keyof CategoryImageConfig, url: string) => void
  removeCategoryImage: (key: keyof CategoryImageConfig) => void
  setGameModeImage: (modeId: string, patch: { backgroundImage?: string; thumbnailImage?: string }) => void
  removeGameModeImage: (modeId: string) => void
  addMoney: (taka: number, method?: string, ref?: string) => Promise<boolean>
  setDepositStatus: (id: string, status: Deposit['status']) => Promise<void>
  /** staff queue refresh: merge the server's pending rows into the local mirror */
  setPendingRequests: (rows: { deposits: PendingRow[]; withdrawals: PendingRow[] }) => void
  unlockEntry: (minor: number, note: string) => void
  withdraw: (taka: number, method?: string, account?: string) => Promise<boolean>
  setWithdrawalStatus: (id: string, status: Withdrawal['status']) => Promise<void>
  settle: (rec: Omit<MatchRecord, 'id' | 'ts'>) => void
  markNotifsRead: () => void
  reset: () => void
}

const uid = () => Math.random().toString(36).slice(2, 10)
const txn = () => 'TXN' + Date.now().toString(36).toUpperCase() + uid().slice(0, 4).toUpperCase()

const seedNotifs: Notif[] = [
  { id: uid(), type: 'welcome', titleBn: 'স্বাগতম! খেলা শুরু করুন', titleEn: 'Welcome! Start playing', ts: Date.now(), read: false },
  { id: uid(), type: 'tournament', titleBn: 'নতুন লুডু টুর্নামেন্ট লাইভ', titleEn: 'New Ludo tournament live', ts: Date.now() - 3600e3, read: false },
]

const initial = {
  authed: false, // open app browses freely; login is required only to play/join a match
  username: '',
  playerId: 'KV' + Math.floor(100000 + Math.random() * 899999),
  avatar: '🦁',
  referralCode: 'KV' + uid().slice(0, 6).toUpperCase(),
  availableMinor: toMinor(440),
  lockedMinor: 0,
  wins: 12, losses: 7, draws: 3,
  ledger: [] as Ledger[],
  matches: [] as MatchRecord[],
  notifs: seedNotifs,
  tickets: [] as Ticket[],
  referrals: [
    { id: uid(), name: 'Sakib H.', ts: Date.now() - 2 * 864e5, rewardMinor: toMinor(20), status: 'played' as const },
    { id: uid(), name: 'Nusrat J.', ts: Date.now() - 5 * 864e5, rewardMinor: toMinor(20), status: 'joined' as const },
  ] as Referral[],
  referralEarnedMinor: toMinor(40),
  announcements: [
    { id: uid(), titleBn: 'সাপ্তাহিক মেগা টুর্নামেন্ট!', titleEn: 'Weekly Mega Tournament!', bodyBn: 'শুক্রবার রাত ৯টায় — ৳5000 প্রাইজ পুল।', bodyEn: 'Friday 9PM — ৳5000 prize pool.', ts: Date.now() - 6 * 36e5 },
  ] as Announcement[],
  dismissedAnnId: null as string | null,
  isAdmin: false,
  staffRole: null as string | null,
  adminSession: false,
  adminUsers: [
    { id: 'u1', name: 'Adnan Khan', email: 'adnan@demo.com', loginMethod: 'email' as const, balanceMinor: toMinor(440), status: 'active' as const, role: 'superadmin' as const, joined: Date.now() - 20 * 864e5, lastLogin: Date.now() },
    { id: 'u2', name: 'Rahim Uddin', email: 'rahim@gmail.com', loginMethod: 'google' as const, balanceMinor: toMinor(120), status: 'active' as const, role: 'user' as const, joined: Date.now() - 12 * 864e5, lastLogin: Date.now() - 3600e3 },
    { id: 'u3', name: 'Karim Sheikh', email: 'karim@demo.com', loginMethod: 'email' as const, balanceMinor: toMinor(60), status: 'suspended' as const, role: 'user' as const, joined: Date.now() - 8 * 864e5, lastLogin: Date.now() - 864e5 },
    { id: 'u4', name: 'Sakib Hasan', email: 'sakib@gmail.com', loginMethod: 'google' as const, balanceMinor: toMinor(300), status: 'active' as const, role: 'admin' as const, joined: Date.now() - 5 * 864e5, lastLogin: Date.now() - 7200e3 },
    { id: 'u5', name: 'Nusrat Jahan', email: 'nusrat@demo.com', loginMethod: 'email' as const, balanceMinor: 0, status: 'active' as const, role: 'user' as const, joined: Date.now() - 2 * 864e5, lastLogin: Date.now() - 1800e3 },
  ] as AdminUser[],
  adminRoles: [
    { id: 'r1', name: 'Super Admin', description: 'Full access to all features', permissions: [{ resource: '*', actions: ['read', 'write', 'delete', 'manage'] }] },
    { id: 'r2', name: 'Admin', description: 'Manage users, games, payouts', permissions: [{ resource: 'users', actions: ['read', 'write'] }, { resource: 'games', actions: ['read', 'write'] }, { resource: 'withdrawals', actions: ['read', 'write'] }, { resource: 'banners', actions: ['read', 'write'] }] },
    { id: 'r3', name: 'Support', description: 'View and respond to tickets', permissions: [{ resource: 'tickets', actions: ['read', 'write'] }, { resource: 'users', actions: ['read'] }] },
  ] as AdminRole[],
  adminActivity: [] as AdminActivity[],
  adminSettings: { 
    sessionTimeout: 30 * 60 * 1000, 
    maxLoginAttempts: 5, 
    lockoutDuration: 15 * 60 * 1000, 
    require2FA: false, 
    auditLogRetentionDays: 90 
  } as AdminSettings,
  banners: [
    { id: uid(), titleEn: 'Play Ludo, Win Money!', titleBn: 'লুডু খেলুন, টাকা জিতুন!', url: '', active: true },
    { id: uid(), titleEn: 'Refer a friend, get a bonus!', titleBn: 'বন্ধুকে আনুন, বোনাস নিন!', url: '', active: true },
  ] as AdminBanner[],
  bonusConfig: { welcomeMinor: toMinor(50), referralMinor: toMinor(20), dailyMinor: toMinor(5), depositPct: 5 } as BonusConfig,
  paymentConfig: { provider: 'bKash', merchantId: '' } as PaymentConfig,
  // Starts manual on purpose. Until active_gateway() says otherwise, deposits go
  // down the manual path - which works - rather than assuming a gateway exists.
  liveGateway: { provider: 'manual', mode: 'manual', merchant_id: '', reason: 'not checked yet' } as LiveGateway,
  siteConfig: { maintenance: false, minWithdrawMinor: toMinor(100), voiceFee: false, chessEnabled: true } as SiteConfig,
  categoryImages: {} as CategoryImageConfig,
  gameModeImages: {} as GameModeImageConfig,
  withdrawals: [] as Withdrawal[],
  deposits: [] as Deposit[],
}

export const useStore = create<DemoState>()(
  persist(
    (set, get) => ({
      ...initial,

      // login/signup → also upsert into adminUsers so the Admin panel shows
      // every new sign-up instantly (real-time user list)
      login: (username) => set((s) => {
        const name = (username || s.username || '').trim() || 'Player'
        const me = s.adminUsers.find((u) => (u.name === name || u.email === name) && u.status !== 'deleted')
        // suspended / deleted accounts cannot sign in
        if (me && me.status !== 'active') return { ...s, authed: false }
        const isNew = !me
        const bonus = isNew ? s.bonusConfig.welcomeMinor : 0
        const availableMinor = s.availableMinor + bonus
        const ledger = bonus > 0
          ? [{ id: txn(), type: 'welcome' as LedgerType, amountMinor: bonus, balanceAfter: availableMinor, status: 'completed' as TxnStatus, ts: Date.now(), note: 'Welcome bonus' } as Ledger, ...s.ledger]
          : s.ledger
        const adminUsers = me
          ? s.adminUsers.map((u) => u.id === me.id ? { ...u, name, lastLogin: Date.now() } : u)
          : [{
              id: 'u' + uid(), name,
              email: name.includes('@') ? name : name.toLowerCase().replace(/\s+/g, '.') + '@khelofire.app',
              loginMethod: 'email' as const, balanceMinor: availableMinor,
              status: 'active' as const, role: 'user' as const, joined: Date.now(), lastLogin: Date.now(),
            }, ...s.adminUsers]
        return { authed: true, username: name, adminUsers, availableMinor, ledger }
      }),
      logout: () => set({ authed: false }),
      updateProfile: (patch) => set(patch),

      createTicket: (subject, category, message) => {
        const id = 'TK' + Date.now().toString(36).toUpperCase().slice(-6)
        const ticket: Ticket = { id, subject, category, status: 'open', ts: Date.now(), msgs: [{ me: true, text: message, ts: Date.now() }] }
        set((s) => ({ tickets: [ticket, ...s.tickets] }))
        // simulated support auto-reply
        setTimeout(() => set((s) => ({
          tickets: s.tickets.map((tk) => tk.id === id ? { ...tk, status: 'answered', msgs: [...tk.msgs, { me: false, text: 'ধন্যবাদ! আমাদের সাপোর্ট টিম শীঘ্রই দেখছে। / Thanks! Our support team is on it and will reply shortly.', ts: Date.now() }] } : tk),
        })), 1500)
        return id
      },
      replyTicket: (id, text) => set((s) => ({
        tickets: s.tickets.map((tk) => tk.id === id ? { ...tk, status: 'open', msgs: [...tk.msgs, { me: true, text, ts: Date.now() }] } : tk),
      })),
      adminReplyTicket: (id, text) => set((s) => ({
        tickets: s.tickets.map((tk) => tk.id === id ? { ...tk, status: 'answered', msgs: [...tk.msgs, { me: false, text, ts: Date.now() }] } : tk),
      })),
      setTicketStatus: (id, status) => set((s) => ({
        tickets: s.tickets.map((tk) => tk.id === id ? { ...tk, status } : tk),
      })),

      postAnnouncement: (a) => {
        const id = uid()
        const ann: Announcement = { ...a, id, ts: Date.now() }
        const notif: Notif = { id: uid(), type: 'announcement', titleBn: a.titleBn, titleEn: a.titleEn, ts: Date.now(), read: false }
        set((s) => ({ announcements: [ann, ...s.announcements], notifs: [notif, ...s.notifs], dismissedAnnId: null }))
      },
      dismissAnnouncement: (id) => set({ dismissedAnnId: id }),

      // ---- admin ----
      // Admin access is granted by the SERVER (the `staff` table), never by a
      // password typed into the phone. The old adminLogin(pin) compared against
      // a PIN stored in this same localStorage, so the "admin password" was
      // readable by anyone holding the device and /admin-access?pin=4321 was a
      // public URL that logged anyone in.
      adminSignIn: async (email, password) => {
        const { signIn } = await import('./auth')
        const { fetchStaffRole } = await import('./wallet')
        try {
          await signIn(email, password)
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Sign-in failed'
          return { ok: false, error: msg }
        }
        const role = await fetchStaffRole()
        if (!role) {
          // signed in fine, but not staff - make sure we are not left in a
          // half-authenticated admin state
          const { signOutUser } = await import('./auth')
          await signOutUser()
          return { ok: false, error: 'This account is not an admin' }
        }
        set({ isAdmin: true, adminSession: true, staffRole: role })
        get().logAdminActivity('admin_login', 'auth', `Signed in as ${role}`)
        return { ok: true }
      },
      adminLogout: () => {
        set({ isAdmin: false, adminSession: false, staffRole: null })
      },
      setStaffRole: (role) => set({ staffRole: role, isAdmin: !!role, adminSession: !!role }),
      setUserStatus: (id, status) => set((s) => ({ adminUsers: s.adminUsers.map((u) => u.id === id ? { ...u, status } : u) })),
      deleteUser: (id) => set((s) => ({ adminUsers: s.adminUsers.map((u) => u.id === id ? { ...u, status: 'deleted' as const } : u) })),
      // Demo-mode only. When Supabase is live the database refuses client writes to
      // available_minor, so a local edit here would just desync the screen from
      // the real wallet - the admin must approve a deposit/withdrawal instead.
      adjustUserBalance: (id, deltaMinor) => {
        if (liveMode) {
          notify('Balance changes must go through a deposit or withdrawal approval', 'err')
          return
        }
        set((s) => {
          const target = s.adminUsers.find((u) => u.id === id)
          const adminUsers = s.adminUsers.map((u) => u.id === id ? { ...u, balanceMinor: Math.max(0, u.balanceMinor + deltaMinor) } : u)
          if (target && target.name === s.username && deltaMinor !== 0) {
            const available = Math.max(0, s.availableMinor + deltaMinor)
            return {
              adminUsers, availableMinor: available,
              ledger: [{ id: txn(), type: (deltaMinor > 0 ? 'deposit' : 'withdrawal') as LedgerType, amountMinor: deltaMinor, balanceAfter: available, status: 'completed' as TxnStatus, ts: Date.now(), note: 'Admin balance adjustment' } as Ledger, ...s.ledger],
            }
          }
          return { adminUsers }
        })
      },
      addBanner: (b) => set((s) => ({ banners: [{ ...b, id: uid() }, ...s.banners] })),
      removeBanner: (id) => set((s) => ({ banners: s.banners.filter((b) => b.id !== id) })),
      toggleBanner: (id) => set((s) => ({ banners: s.banners.map((b) => b.id === id ? { ...b, active: !b.active } : b) })),
      setBonusConfig: (patch) => set((s) => ({ bonusConfig: { ...s.bonusConfig, ...patch } })),
      setPaymentConfig: (patch) => set((s) => ({ paymentConfig: { ...s.paymentConfig, ...patch } })),

      // Ask the server which gateway is genuinely live. Any failure resolves to
      // manual: an unreachable RPC must never be the reason a player's deposit
      // is sent somewhere that cannot take money.
      refreshLiveGateway: async () => {
        if (!liveMode || !supabase) return
        try {
          const { data } = await supabase.rpc('active_gateway')
          const row = (data ?? {}) as Partial<LiveGateway>
          set(() => ({ liveGateway: {
            provider: row.provider ?? 'manual',
            mode: row.mode === 'auto' ? 'auto' : 'manual',
            merchant_id: row.merchant_id ?? '',
            reason: row.reason ?? '',
          } }))
        } catch {
          set(() => ({ liveGateway: { provider: 'manual', mode: 'manual', merchant_id: '', reason: 'could not reach the server' } }))
        }
      },
      setSiteConfig: (patch) => set((s) => ({ siteConfig: { ...s.siteConfig, ...patch } })),
      setAdminSettings: (patch) => set((s) => ({ adminSettings: { ...s.adminSettings, ...patch } })),
      // changeAdminPin is gone on purpose: the admin password now lives in
      // Supabase Auth and the role in the `staff` table. Neither can be changed
      // from the phone - that is the point.
      addAdminUser: (user) => set((s) => ({ adminUsers: [{ ...user, id: uid(), joined: Date.now(), lastLogin: Date.now() }, ...s.adminUsers] })),
      updateAdminRole: (userId, role) => set((s) => ({ adminUsers: s.adminUsers.map((u) => u.id === userId ? { ...u, role } : u) })),
      createAdminRole: (name, description) => {
        set((s) => ({ adminRoles: [...s.adminRoles, { id: 'r' + uid(), name, description, permissions: [] }] }))
        get().logAdminActivity('role_create', 'roles', name)
      },
      logAdminActivity: (action, resource, details) => set((s) => ({ 
        adminActivity: [{ 
          id: uid(), 
          adminId: 'current', // would be actual admin ID in production
          action, 
          resource, 
          details, 
          ip: 'local', 
          ts: Date.now() 
        }, ...s.adminActivity.slice(0, 299)] 
      })),
      getAdminActivity: (adminId) => {
        const activity = get().adminActivity
        return adminId ? activity.filter((a) => a.adminId === adminId) : activity
      },
      setCategoryImage: (key, url) => set((s) => ({ categoryImages: { ...s.categoryImages, [key]: url } })),
      removeCategoryImage: (key) => set((s) => { const n = { ...s.categoryImages }; delete n[key]; return { categoryImages: n } }),
      setGameModeImage: (modeId, patch) => set((s) => ({ gameModeImages: { ...s.gameModeImages, [modeId]: { ...s.gameModeImages[modeId], ...patch } } })),
      removeGameModeImage: (modeId) => set((s) => { const n = { ...s.gameModeImages }; delete n[modeId]; return { gameModeImages: n } }),

      // Add money = deposit REQUEST. Nothing is credited until an admin approves it.
      // In live mode the row is created by request_deposit() so the amount is
      // validated server-side; the local list is only a mirror for the UI.
      addMoney: async (taka, method = 'bKash', ref = '') => {
        const amt = toMinor(taka)
        if (amt <= 0) return false
        const txnRef = ref.trim()
        if (!liveMode) {
          const id = txn()
          const user = get().username
          set((s) => ({
            deposits: [{ id, user, amountMinor: amt, method, ref: txnRef, status: 'pending', ts: Date.now() }, ...s.deposits],
            ledger: [{ id, type: 'deposit', amountMinor: amt, balanceAfter: get().availableMinor, status: 'pending', ts: Date.now(), note: `Deposit request · ${method}` }, ...s.ledger],
          }))
          get().logAdminActivity('deposit_request', 'payments', `${user} · ${method} · ${taka}`)
          return true
        }
        try {
          const id = await wallet.requestDeposit(amt, method, txnRef)
          if (!id) return false
          const user = get().username
          set((s) => ({
            deposits: [{ id, user, amountMinor: amt, method, ref: txnRef, status: 'pending', ts: Date.now() }, ...s.deposits],
            ledger: [{ id, type: 'deposit', amountMinor: amt, balanceAfter: s.availableMinor, status: 'pending', ts: Date.now(), note: 'deposit request' } as Ledger, ...s.ledger],
          }))
          notify('Deposit request sent', 'ok')
          return true
        } catch (e) {
          notifyError('Deposit request failed', e)
          return false
        }
      },
      // The admin queue used to read the local mirror only, so it could approve
      // requests this browser had created and nothing else - every deposit made
      // on a player's own phone was invisible to the admin, and to approve it
      // the request had to be recreated by hand on the admin's device. The rows
      // live in Postgres behind RLS, so they arrive via the staff-checked
      // list_pending_requests RPC and are merged over the mirror by id.
      setPendingRequests: ({ deposits, withdrawals }) => {
        const ts = (s: string) => new Date(s).getTime()
        const merge = <T extends { id: string }>(local: T[], rows: PendingRow[], extra: (r: PendingRow) => T): T[] => {
          const byId = new Map<string, T>(rows.map((r) => [r.id, extra(r)]))
          // keep anything the server did not send, so an offline request the
          // player just made does not blink out of their own history
          for (const l of local) if (!byId.has(l.id)) byId.set(l.id, l)
          return [...byId.values()]
        }
        set((s) => ({
          deposits: merge(s.deposits, deposits, (r) => ({
            id: r.id, user: r.user, amountMinor: r.amount_minor, method: r.method,
            ref: r.ref ?? '', status: 'pending' as const, ts: ts(r.ts),
          })),
          withdrawals: merge(s.withdrawals, withdrawals, (r) => ({
            id: r.id, user: r.user, amountMinor: r.amount_minor, method: r.method,
            account: r.account ?? '', status: 'pending' as const, ts: ts(r.ts),
          })),
        }))
      },
      setDepositStatus: async (id, status) => {
        const d = get().deposits.find((x) => x.id === id)
        if (!d || d.status !== 'pending') return
        if (!liveMode) {
          if (status === 'approved') {
            const bonusPct = get().bonusConfig.depositPct || 0
            const bonus = Math.round(d.amountMinor * bonusPct / 100)
            const available = get().availableMinor + d.amountMinor + bonus
            set((s) => ({
              availableMinor: available,
              deposits: s.deposits.map((x) => x.id === id ? { ...x, status } : x),
              ledger: s.ledger.map((l) => l.id === id ? { ...l, balanceAfter: available, status: 'completed' as const } : l),
            }))
          } else {
            set((s) => ({
              deposits: s.deposits.map((x) => x.id === id ? { ...x, status } : x),
              ledger: s.ledger.map((l) => l.id === id ? { ...l, status: 'failed' as const } : l),
            }))
          }
          return
        }
        try {
          await wallet.decideMoneyRequest('deposit', id, status === 'approved')
          set((s) => ({
            deposits: s.deposits.map((x) => x.id === id ? { ...x, status } : x),
            ledger: s.ledger.map((l) => l.id === id ? { ...l, status: status === 'approved' ? 'completed' as const : 'failed' as const } : l),
          }))
          if (status === 'approved') void refreshFromServer() // pick up the new balance
          notify(status === 'approved' ? 'Deposit approved' : 'Deposit rejected', 'ok')
        } catch (e) {
          notifyError('Could not update the deposit', e)
        }
      },

      withdraw: async (taka, method = 'bKash', account = '') => {
        const amt = toMinor(taka)
        if (amt <= 0 || amt > get().availableMinor) return false
        if (amt < get().siteConfig.minWithdrawMinor) return false
        // request_withdrawal rejects a blank account outright, so asking for the
        // number here is the difference between a withdrawal that can be created
        // and one that always throws.
        const acct = account.trim()
        if (!acct) { notify('Enter the account to receive the money', 'err'); return false }
        if (!liveMode) {
          const balanceAfter = get().availableMinor - amt
          const id = txn()
          const user = get().username
          set((s) => ({
            availableMinor: balanceAfter,
            ledger: [{ id, type: 'withdrawal', amountMinor: -amt, balanceAfter, status: 'pending', ts: Date.now(), note: `Withdrawal · ${method}` }, ...s.ledger],
            withdrawals: [{ id, user, amountMinor: amt, method, account: acct, status: 'pending', ts: Date.now() }, ...s.withdrawals],
          }))
          return true
        }
        try {
          // the server debits the balance immediately so the same money cannot
          // be requested twice, and refunds on rejection
          const id = await wallet.requestWithdrawal(amt, method, acct)
          if (!id) return false
          const user = get().username
          const balanceAfter = get().availableMinor - amt
          set((s) => ({
            availableMinor: balanceAfter,
            ledger: [{ id, type: 'withdrawal', amountMinor: -amt, balanceAfter, status: 'pending', ts: Date.now(), note: 'withdrawal request' } as Ledger, ...s.ledger],
            withdrawals: [{ id, user, amountMinor: amt, method, account: acct, status: 'pending', ts: Date.now() }, ...s.withdrawals],
          }))
          notify('Withdrawal requested', 'ok')
          return true
        } catch (e) {
          notifyError('Withdrawal request failed', e)
          return false
        }
      },
      setWithdrawalStatus: async (id, status) => {
        const w = get().withdrawals.find((x) => x.id === id)
        if (!w || w.status !== 'pending') return
        if (!liveMode) {
          if (status === 'approved') {
            set((s) => ({
              withdrawals: s.withdrawals.map((x) => x.id === id ? { ...x, status } : x),
              ledger: s.ledger.map((l) => l.id === id ? { ...l, status: 'completed' as const } : l),
            }))
          } else if (status === 'rejected') {
            const available = get().availableMinor + w.amountMinor
            set((s) => ({
              availableMinor: available,
              withdrawals: s.withdrawals.map((x) => x.id === id ? { ...x, status } : x),
              ledger: [
                { id: txn(), type: 'refund_credit', amountMinor: w.amountMinor, balanceAfter: available, status: 'refunded' as const, ts: Date.now(), note: `Refund · withdrawal ${id.slice(-4)}` },
                ...s.ledger.map((l) => l.id === id ? { ...l, status: 'failed' as const } : l),
              ],
            }))
          }
          return
        }
        try {
          await wallet.decideMoneyRequest('withdrawal', id, status === 'approved')
          set((s) => ({
            withdrawals: s.withdrawals.map((x) => x.id === id ? { ...x, status } : x),
            ledger: s.ledger.map((l) => l.id === id ? { ...l, status: status === 'approved' ? 'completed' as const : 'refunded' as const } : l),
          }))
          if (status === 'rejected') void refreshFromServer() // server refunded it
          notify(status === 'approved' ? 'Withdrawal approved' : 'Withdrawal rejected + refunded', 'ok')
        } catch (e) {
          notifyError('Could not update the withdrawal', e)
        }
      },

      // Release a locked entry back to available (match cancelled before start)
      unlockEntry: (minor, note) => {
        set((s) => {
          const locked = Math.max(0, s.lockedMinor - minor)
          const available = s.availableMinor + Math.min(minor, s.lockedMinor)
          return {
            availableMinor: available,
            lockedMinor: locked,
            ledger: [{ id: txn(), type: 'unlock', amountMinor: minor, balanceAfter: available, status: 'refunded', ts: Date.now(), note }, ...s.ledger],
          }
        })
      },

      // Settle a finished match: unlock entry, apply prize/refund, record history + stats.
      // Live mode: the numbers shown immediately are optimistic, then
      // settle_match() re-derives entry/prize from match_modes and returns the
      // authoritative balance. If the server disagrees, the local edit is rolled
      // back so the screen never shows money the server did not grant.
      settle: (rec) => {
        const before = { availableMinor: get().availableMinor, lockedMinor: get().lockedMinor }
        set((s) => {
          const locked = Math.max(0, s.lockedMinor - rec.entryMinor)
          let available = s.availableMinor
          const entries: Ledger[] = []
          if (rec.outcome === 'win') {
            available += rec.prizeMinor
            entries.push({ id: txn(), type: 'prize_credit', amountMinor: rec.prizeMinor, balanceAfter: available, status: 'completed', ts: Date.now(), note: `Prize · ${rec.mode}` })
          } else if (rec.outcome === 'cancelled' || rec.outcome === 'draw') {
            available += rec.entryMinor // refund entry
            entries.push({ id: txn(), type: 'refund_credit', amountMinor: rec.entryMinor, balanceAfter: available, status: 'refunded', ts: Date.now(), note: `Refund · ${rec.mode}` })
          }
          const match: MatchRecord = { ...rec, id: uid(), ts: Date.now() }
          const notif: Notif = {
            id: uid(), type: 'result',
            titleBn: rec.outcome === 'win' ? 'অভিনন্দন! আপনি জিতেছেন' : rec.outcome === 'draw' ? 'ম্যাচ ড্র হয়েছে' : rec.outcome === 'cancelled' ? 'ম্যাচ বাতিল — ফেরত দেওয়া হয়েছে' : 'ম্যাচ শেষ',
            titleEn: rec.outcome === 'win' ? 'Congrats! You won' : rec.outcome === 'draw' ? 'Match drawn' : rec.outcome === 'cancelled' ? 'Match cancelled — refunded' : 'Match finished',
            ts: Date.now(), read: false,
          }
          return {
            availableMinor: available,
            lockedMinor: locked,
            wins: s.wins + (rec.outcome === 'win' ? 1 : 0),
            losses: s.losses + (rec.outcome === 'loss' ? 1 : 0),
            draws: s.draws + (rec.outcome === 'draw' ? 1 : 0),
            ledger: [...entries, ...s.ledger],
            matches: [match, ...s.matches],
            notifs: [notif, ...s.notifs],
          }
        })

        if (!liveMode) return
        // A bot/practice game has entry 0 and prize 0, so there is nothing to pay
        // and nothing to reconcile. The old settle_match(game, mode, outcome) took
        // a client-declared outcome and is revoked from authenticated, so calling
        // it here would throw on every practice game and would have been a way to
        // claim a payout for a match the server never saw.
        //
        // Captured in a const because narrowing on rec does not survive into the
        // async closure below.
        const liveMatchId = rec.liveMatchId
        if (!liveMatchId) return
        void (async () => {
          try {
            const r = await wallet.settleLiveMatch(liveMatchId)
            if (!r) return
            // adopt the server's numbers
            set((s) => ({
              availableMinor: r.available_minor,
              matches: s.matches.map((m) => m.id.startsWith('local-') || s.matches[0]?.id === m.id
                ? { ...m, entryMinor: r.entry_minor, prizeMinor: r.prize_minor, deltaMinor: r.delta_minor }
                : m),
            }))
          } catch (e) {
            // server said no - undo the optimistic payout rather than showing
            // a balance that does not exist server-side
            set({ availableMinor: before.availableMinor, lockedMinor: before.lockedMinor })
            notifyError('Match could not be settled', e)
          }
        })()
      },

      markNotifsRead: () => set((s) => ({ notifs: s.notifs.map((n) => ({ ...n, read: true })) })),
      reset: () => set({ ...initial, authed: true }),
    }),
    {
      name: 'kv-demo-store',
      version: 2,
      // In live mode `authed` is NOT persisted. It used to be, which meant a
      // force-stop reopened the app already "signed in" as whoever the last
      // session was - the client saw a logged-in "Google User" they had never
      // logged in as. The Supabase session is the only thing allowed to say
      // "logged in" now. Demo mode (no Supabase keys) still persists, because
      // there is no session to restore from.
      partialize: (s) => {
        if (!liveMode) return s
        const { authed, ...rest } = s
        return rest
      },
      // drop the stale identity that the old version left behind
      migrate: (s: any) => ({
        ...s,
        authed: liveMode ? false : s?.authed,
        username: liveMode ? '' : s?.authed ? s.username : '',
        staffRole: null,
        isAdmin: false,
        adminSession: false,
      }),
    }
  )
)
