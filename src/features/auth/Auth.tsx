import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useT, useI18n } from '../../i18n'
import { signIn, signUp, sendPasswordReset } from '../../lib/auth'
import { rateLimit, cooldownMs } from '../../lib/ratelimit'
import { Spinner } from '../../ui/components'

type Step = 'login' | 'signup' | 'forgot'

export default function Auth() {
  const t = useT()
  const nav = useNavigate()
  const loc = useLocation()
  const from = (loc.state as { from?: string } | null)?.from || '/'
  const { lang, toggleLang } = useI18n()
  const [step, setStep] = useState<Step>('login')
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sent, setSent] = useState(false)

  // run an async auth action with a busy spinner + error surface
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed') }
    finally { setBusy(false) }
  }

  const submit = () => {
    setErr('')
    // client-side brute-force guard (5 attempts / 30s); real limits live in Supabase
    if ((step === 'login' || step === 'signup') && !rateLimit('auth', 5, 30000)) {
      const secs = Math.ceil(cooldownMs('auth', 5, 30000) / 1000)
      return setErr(lang === 'bn' ? `অনেক চেষ্টা — ${secs}s অপেক্ষা করুন` : `Too many attempts — wait ${secs}s`)
    }
    if (step === 'login') {
      if (!id || pw.length < 4) return setErr(lang === 'bn' ? 'সঠিক তথ্য দিন' : 'Enter valid details')
      run(async () => { await signIn(id, pw); nav(from, { replace: true }) })
    } else if (step === 'signup') {
      if (!name || !id || pw.length < 4) return setErr(lang === 'bn' ? 'সব ঘর পূরণ করুন' : 'Fill all fields')
      run(async () => { await signUp(name, id, pw); nav(from, { replace: true }) })
    } else {
      // forgot password — send a reset link, no OTP step
      if (!/^\S+@\S+\.\S+$/.test(id.trim())) return setErr(lang === 'bn' ? 'সঠিক ইমেইল দিন' : 'Enter a valid email')
      run(async () => { await sendPasswordReset(id.trim()); setSent(true) })
    }
  }

  return (
    <div className="app-frame flex min-h-[100dvh] flex-col justify-center px-6 py-10"
      style={{ background: 'radial-gradient(120% 70% at 50% -10%,#3A1D6E 0%,#1A0E3A 55%,#08060F 100%)' }}>
      <button onClick={toggleLang} className="absolute right-4 top-4 chip text-white" style={{ background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.18)', top: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>{lang === 'bn' ? 'বাং' : 'EN'}</button>
      <div className="mb-8 text-center text-white">
        <span className="mx-auto mb-3 grid h-16 w-16 place-items-center overflow-hidden rounded-2xl" style={{ border: '1px solid rgba(255,255,255,.2)', boxShadow: 'var(--glow)' }}>
          <img src="/logo.jpg" alt="KheloFire" className="h-full w-full object-cover" />
        </span>
        <h1 className="font-display text-2xl font-extrabold">Khelo<span className="text-grad-cyan">Fire</span></h1>
        <p className="mt-1 text-sm text-white/70">{t('home.heroSub')}</p>
      </div>

      <div className="card-solid p-5 space-y-3">
        <div className="flex gap-1.5 mb-2 p-1 rounded-pill" style={{ background: 'var(--glass)', border: '1px solid var(--glass-brd)' }}>
          {(['login', 'signup'] as Step[]).map((s) => {
            const on = step === s
            return (
              <button key={s} onClick={() => { setStep(s); setErr(''); setSent(false) }} className="flex-1 rounded-pill py-2 text-sm font-bold transition"
                style={on ? { backgroundImage: 'var(--grad)', color: '#fff', boxShadow: 'var(--glow)' } : { color: 'var(--muted)' }}>
                {t(s === 'login' ? 'auth.login' : 'auth.signup')}
              </button>
            )
          })}
        </div>

        {step === 'signup' && (
          <div><label className="label">{t('auth.name')}</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        )}

        {(step === 'login' || step === 'signup' || (step === 'forgot' && !sent)) && (
          <div><label className="label">{t('auth.phoneEmail')}</label><input className="input" value={id} onChange={(e) => setId(e.target.value)} /></div>
        )}

        {(step === 'login' || step === 'signup') && (
          <div><label className="label">{t('auth.password')}</label><input type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        )}

        {step === 'signup' && (
          <div><label className="label">{t('auth.referral')}</label><input className="input" placeholder="KVXXXX" /></div>
        )}

        {err && <p className="text-danger text-sm font-medium">{err}</p>}

        {step === 'forgot' && sent && (
          <div className="space-y-3 py-1 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full text-white" style={{ background: '#1FCB8B' }}>✓</span>
            <p className="text-sm font-bold">{lang === 'bn' ? 'রিসেট লিংক পাঠানো হয়েছে' : 'Reset link sent'}</p>
            <p className="text-xs text-muted">{lang === 'bn' ? `${id} এ চেক করুন (ইনবক্স বা স্প্যাম)` : `Check ${id} (inbox or spam)`}</p>
            <button onClick={() => { setStep('login'); setSent(false); setErr('') }} className="btn-primary w-full">{t('auth.login')}</button>
          </div>
        )}

        {!(step === 'forgot' && sent) && (
          <button className="btn-primary w-full" onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : step === 'login' ? t('auth.login') : step === 'signup' ? t('auth.signup') : lang === 'bn' ? 'রিসেট লিংক পাঠান' : 'Send reset link'}
          </button>
        )}


        {step === 'login' && <button onClick={() => { setStep('forgot'); setSent(false); setErr('') }} className="w-full text-center text-sm text-muted">{t('auth.forgot')}</button>}
        <p className="text-center text-xs text-muted pt-1">{t('auth.demoNote')}</p>
      </div>
    </div>
  )
}
