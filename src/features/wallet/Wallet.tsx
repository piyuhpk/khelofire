import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Wallet as WalletIcon, Plus, Landmark, ReceiptText, ShieldCheck, Copy, X, Check } from 'lucide-react'
import { useT } from '../../i18n'
import { useStore, type TxnStatus } from '../../lib/store'
import { fmt } from '../../lib/money'
import { useToast, EmptyState, ListSkeleton, useReady, Modal } from '../../ui/components'

// demo merchant numbers — replace with real ones from Admin → Payments
const PAY_NUMBERS: Record<string, string> = { bKash: '01712-345678', Nagad: '01812-345678', Rocket: '01912-345678' }
const METHOD_STYLE: Record<string, string> = { bKash: '#E2136E', Nagad: '#EE7623', Rocket: '#8C3494' }

const statusColor: Record<TxnStatus, string> = {
  pending: 'bg-gold/15 text-gold', completed: 'bg-emerald2/15 text-emerald2',
  failed: 'bg-danger/15 text-danger', refunded: 'text-muted',
}
const TABS = [
  { id: 'add', key: 'home.addMoney', Icon: Plus },
  { id: 'withdraw', key: 'home.withdraw', Icon: Landmark },
  { id: 'history', key: 'home.transactions', Icon: ReceiptText },
] as const

export default function Wallet() {
  const t = useT()
  const [params] = useSearchParams()
  const [tab, setTab] = useState<'add' | 'withdraw' | 'history'>((params.get('tab') as any) || 'add')
  const [amt, setAmt] = useState('')
  const [method, setMethod] = useState('bKash')
  const toast = useToast()
  const ready = useReady(500)
  const availableMinor = useStore((s) => s.availableMinor)
  const lockedMinor = useStore((s) => s.lockedMinor)
  const ledger = useStore((s) => s.ledger)
  const addMoney = useStore((s) => s.addMoney)
  const withdraw = useStore((s) => s.withdraw)
  const merchantId = useStore((s) => s.paymentConfig.merchantId)
  const minWithdrawMinor = useStore((s) => s.siteConfig.minWithdrawMinor)
  const payNumber = (merchantId && method === 'bKash' ? merchantId : '') || PAY_NUMBERS[method] || PAY_NUMBERS.bKash
  const valid = Number(amt) > 0
  const [checkout, setCheckout] = useState(false)
  const [payStep, setPayStep] = useState<'pay' | 'done'>('pay')
  const mStyle = METHOD_STYLE[method] || METHOD_STYLE.bKash

  const submit = async () => {
    const n = Number(amt)
    if (!n || n <= 0) return toast(t('wallet.amount') + ' ' + t('error.generic'), 'err')
    if (tab === 'add') { setPayStep('pay'); setCheckout(true); return }
    if (n * 100 < minWithdrawMinor) return toast(`${t('wallet.minWithdraw')} ৳${Math.round(minWithdrawMinor / 100)}`, 'err')
    // async now: the server validates and debits, so the result is not known yet
    if (await withdraw(n, method)) toast(`${t('wallet.pending')} · ${method}`, 'ok')
    else toast(t('match.insufficient'), 'err')
    setAmt('')
  }
  // Pay Now → deposit REQUEST (pending) — admin panel approves, then credited
  const payNow = async () => {
    if (!(await addMoney(Number(amt), method))) { setCheckout(false); return toast(t('error.generic'), 'err') }
    setPayStep('done')
    setTimeout(() => { setCheckout(false); setAmt('') }, 1600)
  }
  const copyPay = () => {
    navigator.clipboard?.writeText(payNumber.replace(/-/g, ''))
    toast(`${payNumber} ${t('wallet.copied')}`, 'ok')
  }

  return (
    <div className="p-4 pb-8">
      <div className="flex items-center justify-between mb-3">
        <h1 className="font-display text-lg font-extrabold flex items-center gap-2">
          <WalletIcon className="h-5 w-5 text-primary-2" strokeWidth={2.2} />{t('nav.wallet')}
        </h1>
        <span className="chip text-[11px] font-bold text-emerald2" style={{ background: 'rgba(31,203,139,.12)', border: '1px solid rgba(31,203,139,.25)' }}>✓ {t('wallet.demo')}</span>
      </div>

      {/* balance card — signature purple gradient with cyan bloom */}
      <div className="relative overflow-hidden rounded-card p-5 mb-4 text-white"
        style={{ backgroundImage: 'var(--grad)', boxShadow: 'var(--glow), inset 0 0 0 1px rgba(255,255,255,.14)' }}>
        <div className="absolute -right-8 -top-10 h-36 w-36 rounded-full" style={{ background: 'radial-gradient(circle,rgba(34,211,238,.55),transparent 70%)' }} />
        <div className="relative z-10 flex items-center gap-2 text-[13px] font-semibold text-white/85">
          <WalletIcon className="h-4 w-4" strokeWidth={2.2} />{t('wallet.available')}
        </div>
        <div className="relative z-10 tnum mt-1 font-display text-[34px] font-extrabold leading-none drop-shadow-sm">{fmt(availableMinor)}</div>
        {lockedMinor > 0 && (
          <div className="relative z-10 mt-2 inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-[11px] font-semibold text-white/90" style={{ background: 'rgba(0,0,0,.22)' }}>
            🔒 {t('wallet.locked')}: <span className="tnum">{fmt(lockedMinor)}</span>
          </div>
        )}
      </div>

      {/* segmented tabs — glass pills */}
      <div className="flex gap-1.5 mb-4 p-1 rounded-pill" style={{ background: 'var(--glass)', border: '1px solid var(--glass-brd)' }}>
        {TABS.map(({ id, key, Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-pill py-2 text-[13px] font-bold transition"
            style={tab === id
              ? { backgroundImage: 'var(--grad)', color: '#fff', boxShadow: 'var(--glow)' }
              : { color: 'var(--muted)' }}>
            <Icon className="h-4 w-4" strokeWidth={2.2} />{t(key as any)}
          </button>
        ))}
      </div>

      {tab !== 'history' ? (
        <div className="space-y-3">
          <div>
            <label className="label">{t('wallet.amount')} (৳)</label>
            <input inputMode="numeric" placeholder="0" className="input tnum text-lg font-bold" value={amt} onChange={(e) => setAmt(e.target.value)} />
          </div>
          <div className="flex gap-2">
            {[50, 100, 500].map((v) => (
              <button key={v} onClick={() => setAmt(String(v))} className="btn-ghost tnum flex-1 py-2 text-sm">৳{v}</button>
            ))}
          </div>
          <div>
            <label className="label">{t('wallet.method')}</label>
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}><option>bKash</option><option>Nagad</option><option>Rocket</option></select>
          </div>
          {tab === 'add' && (
            <div className="card p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-extrabold"><Landmark className="h-3.5 w-3.5 text-emerald2" strokeWidth={2.4} />{t('wallet.howToPay')} · {method}</div>
              <button onClick={copyPay} className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 active:scale-[.99] transition"
                style={{ background: 'rgba(31,203,139,.1)', border: '1px dashed rgba(31,203,139,.5)' }}>
                <span className="tnum font-display text-[17px] font-extrabold text-emerald2">{payNumber}</span>
                <Copy className="h-4 w-4 text-emerald2" strokeWidth={2.4} />
              </button>
              <p className="text-[11px] leading-snug text-muted">{t('wallet.payNote')}</p>
            </div>
          )}
          <button onClick={submit} disabled={!valid} className={tab === 'add' ? 'btn-primary w-full' : 'btn-emerald w-full'}>
            {tab === 'add' ? <Plus className="h-4 w-4" strokeWidth={2.6} /> : <Landmark className="h-4 w-4" strokeWidth={2.4} />}
            {tab === 'add' ? t('wallet.requestDeposit') : t('home.withdraw')}
          </button>
          <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald2" strokeWidth={2} />
            {tab === 'add' ? t('wallet.depositNote') : t('wallet.demo') + ' — 100% secure & instant.'}
          </p>
        </div>
      ) : !ready ? (
        <ListSkeleton rows={5} avatar={false} />
      ) : ledger.length === 0 ? (
        <EmptyState title={t('matches.empty')} />
      ) : (
        <div className="space-y-2">
          {ledger.map((l) => (
            <div key={l.id} className="card flex items-center justify-between p-3">
              <div className="min-w-0 flex-1 pr-2">
                <div className="truncate text-sm font-semibold">{l.note}</div>
                <div className="tnum text-[11px] text-muted">{new Date(l.ts).toLocaleString()} · {l.id.slice(0, 12)}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className={`tnum font-bold ${l.amountMinor >= 0 ? 'text-emerald2' : 'text-danger'}`}>{l.amountMinor >= 0 ? '+' : ''}{fmt(l.amountMinor)}</div>
                <span className={`chip text-[10px] font-bold ${statusColor[l.status]}`}>{t(`wallet.${l.status}` as any)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal open={checkout} onClose={() => setCheckout(false)}>
        <div className="w-full max-w-[340px] overflow-hidden rounded-card bg-white text-[#15151C]" style={{ border: `3px solid ${mStyle}`, boxShadow: '0 24px 60px rgba(0,0,0,.35)' }}>
          <div className="flex items-center justify-between px-4 py-3 text-white" style={{ background: mStyle }}>
            <span className="font-display text-base font-extrabold">{method}</span>
            <button onClick={() => setCheckout(false)} aria-label="close" className="rounded-full p-1 hover:bg-white/20"><X className="h-4 w-4" /></button>
          </div>

          {payStep === 'pay' && (
            <div className="space-y-3 p-4 text-center">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted">{t('wallet.payNow')}</p>
              <div className="tnum font-display text-3xl font-extrabold">৳{amt}</div>
              <div className="space-y-1.5 rounded-xl bg-black/5 p-3 text-left text-[12px]">
                <div className="flex justify-between"><span className="text-muted">Merchant</span><span className="tnum font-bold">{payNumber}</span></div>
                <div className="flex justify-between"><span className="text-muted">Type</span><span className="font-bold">Send Money</span></div>
                <div className="flex justify-between"><span className="text-muted">Reference</span><span className="tnum font-bold">KV-{String(Date.now()).slice(-6)}</span></div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setCheckout(false)} className="btn-ghost flex-1 py-2.5 text-sm">{t('common.cancel')}</button>
                <button onClick={payNow} className="flex-1 rounded-pill py-2.5 text-sm font-extrabold text-white" style={{ background: mStyle }}>{t('wallet.payNow')} ৳{amt}</button>
              </div>
              <p className="text-[10px] leading-snug text-muted">{t('wallet.depositNote')}</p>
            </div>
          )}

          {payStep === 'done' && (
            <div className="space-y-2 p-6 text-center">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full text-white" style={{ background: '#1FCB8B' }}><Check className="h-8 w-8" strokeWidth={3} /></span>
              <div className="font-display text-lg font-extrabold">{t('wallet.paySuccess')}</div>
              <p className="text-xs text-muted">{t('wallet.paySuccessSub')}</p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
