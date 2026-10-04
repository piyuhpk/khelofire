import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useT, useI18n } from '../../i18n'
import { signIn, signUp, signInWithGoogle, sendPasswordReset, isNative } from '../../lib/auth'
import { rateLimit, cooldownMs } from '../../lib/ratelimit'
import { useStore } from '../../lib/store'
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
  // Google in the APK leaves for the system browser and comes back as a deep
  // link, so `signInWithGoogle()` resolves BEFORE we are signed in. Navigating
  // right away bounced the player straight back to this screen - that is the
  // "button did nothing" the client recorded.
  const [googlePending, setGooglePending] = useState(false)
  const authed = useStore((s) => s.authed)

  // On a device, in-app Google sign-in is only real when the client id is compiled
  // into the build. On the web it can fall back to a normal OAuth redirect, so the
  // button stays there.
  const googleAvailable = !isNative() || Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID)

  useEffect(() => {
    if (authed && googlePending) {
      setGooglePending(false)
      nav(from, { replace: true })
    }
  }, [authed, googlePending, from, nav])

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

        {/* Google sign-in, only where it can actually complete.
            On a device it needs a native Google client id; without one
            signInWithGoogle() throws 'Google sign-in needs Supabase to be
            configured' and the player is left on the screen with an error. The
            button is removed instead - a login option that always fails is worse
            than no login option, because it costs the player their first attempt
            at signing up. Set VITE_GOOGLE_CLIENT_ID and it returns. */}
        {googleAvailable && (step === 'login' || step === 'signup') && (
          <>
            <div className="flex items-center gap-3 py-0.5">
              <span className="h-px flex-1" style={{ background: 'var(--line)' }} />
              <span className="text-[11px] font-semibold text-muted">{lang === 'bn' ? 'অথবা' : 'or'}</span>
              <span className="h-px flex-1" style={{ background: 'var(--line)' }} />
            </div>
            <button onClick={async () => {
              setErr('')
              if (!rateLimit('oauth', 3, 60000)) { setErr(lang === 'bn' ? 'একটু পরে চেষ্টা করুন' : 'Please wait a moment'); return }
              setGooglePending(true)
              try {
                await signInWithGoogle()
                // Web: the browser is already navigating to Google, the session
                // will be picked up on return. Native: the deep link will fire
                // and the effect above navigates once authed flips.
                if (!isNative()) setGooglePending(false)
              } catch (e) {
                setGooglePending(false)
                setErr(e instanceof Error ? e.message : (lang === 'bn' ? 'Google লগইন ব্যর্থ' : 'Google sign-in failed'))
              }
            }} disabled={busy || googlePending}
              className="flex w-full items-center justify-center gap-2.5 rounded-pill py-3 font-semibold transition active:scale-[.98] disabled:opacity-50"
              style={{ background: '#fff', color: '#1F1F1F', border: '1px solid rgba(0,0,0,.12)' }}>
              <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              {googlePending
                ? (lang === 'bn' ? 'Google খোলা হচ্ছে…' : 'Opening Google…')
                : lang === 'bn' ? 'Google দিয়ে চালিয়ে যান' : 'Continue with Google'}
            </button>
          </>
        )}

        {step === 'login' && <button onClick={() => { setStep('forgot'); setSent(false); setErr('') }} className="w-full text-center text-sm text-muted">{t('auth.forgot')}</button>}
        <p className="text-center text-xs text-muted pt-1">{t('auth.demoNote')}</p>
      </div>
    </div>
  )
}
