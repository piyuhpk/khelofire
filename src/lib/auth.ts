// Auth service.
//
// Talks to Supabase when keys are present, otherwise runs the local demo login
// so the app is still usable before the project is wired.
//
// Three bugs that used to live here, all reported from the client's test APK:
//
//  1. signInWithGoogle() was a STUB. It never called Supabase at all - it just
//     did login('Google User'). No Google account was linked, no user row was
//     created, and because every Google user shared the literal name
//     "Google User" they all shared ONE wallet. It is now a real OAuth call.
//
//  2. `authed: true` was written to localStorage, so after a force-stop the app
//     reopened already "logged in" as a user that never existed. The store no
//     longer persists `authed` in live mode - the Supabase session decides.
//
//  3. The SIGNED_OUT branch logged the user out on ANY sign-out event, and
//     Supabase also emits SIGNED_OUT when a token refresh fails or another
//     device signs out. That is why the app jumped to the login screen in the
//     middle of a tournament with no message. It now tries to recover first and
//     tells the user when the session really is gone.
import { Capacitor } from '@capacitor/core'
import { supabase, hasSupabase } from './supabase'
import { useStore } from './store'
import { loadUserData, stopSync } from './sync'
import { notify } from './notice'

/** true = real Supabase auth is active; false = local demo login */
export const liveAuth = hasSupabase

/** Set only while the user taps "sign out", so an unrelated SIGNED_OUT is not
 *  mistaken for an intentional logout. */
let explicitSignOut = false

/** best display name from an email/phone id (demo login) */
const guessName = (id: string) => {
  const base = id.includes('@') ? id.split('@')[0] : id
  return base.replace(/[._-]+/g, ' ').trim() || 'Player'
}

export const isNative = () => {
  try { return Capacitor.isNativePlatform() } catch { return false }
}

/** same check under a name that reads better outside auth.ts */
export const isNativeApp = isNative

/**
 * Where Google should send the user back to.
 * In the APK a custom scheme is required, because an external browser cannot
 * load the app's https://localhost origin. The scheme must also be declared in
 * android/app/src/main/AndroidManifest.xml (see the intent-filter there).
 */
export function oauthRedirectUrl(): string {
  const configured = import.meta.env.VITE_OAUTH_REDIRECT as string | undefined
  if (configured) return configured
  if (isNative()) return 'khelofire://auth-callback'
  return typeof window !== 'undefined' ? window.location.origin : ''
}

export async function signIn(email: string, password: string) {
  if (liveAuth && supabase) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)
    explicitSignOut = false
    await applySession()
    return
  }
  useStore.getState().login(guessName(email))
}

export async function signUp(username: string, email: string, password: string) {
  if (liveAuth && supabase) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username },
        // in the APK the user must come back into the app, not a desktop browser
        emailRedirectTo: oauthRedirectUrl(),
      },
    })
    if (error) throw new Error(error.message)
    // With "Confirm email" on there is no session yet - say so instead of
    // pretending the player is signed in.
    const { data } = await supabase.auth.getSession()
    if (!data.session) throw new Error('Account created. Please confirm your email, then sign in.')
    explicitSignOut = false
    await applySession()
    return
  }
  useStore.getState().login(username)
}

/**
 * Real Google sign-in. Opens the Google consent screen in the system browser
 * (APK) or redirects in place (web). Either way control comes back through
 * handleOAuthReturn() below.
 */
export async function signInWithGoogle() {
  if (!liveAuth || !supabase) {
    // Previously this silently logged in as "Google User". A fake login is
    // worse than an error: it invents a user with no email and no server row.
    throw new Error('Google sign-in needs Supabase to be configured')
  }
  const redirectTo = oauthRedirectUrl()

  if (isNative()) {
    const url = (await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    })).data.url
    if (!url) throw new Error('Could not start Google sign-in')
    // @capacitor/browser opens the system browser. Imported dynamically so the
    // web build (and an APK built without the plugin) still works.
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url, presentationStyle: 'popover' })
    return
  }

  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
  if (error) throw new Error(error.message)
}

/**
 * Pull the session out of a deep link after Google redirects back into the APK.
 * Call once on startup. Returns true when a session was established.
 */
export async function handleOAuthReturn(url: string): Promise<boolean> {
  if (!liveAuth || !supabase) return false
  const raw = url.includes('?') ? url.slice(url.indexOf('?')) : url.slice(url.indexOf('#'))
  const q = new URLSearchParams(raw)
  const code = q.get('code')
  const accessToken = q.get('access_token')
  const refreshToken = q.get('refresh_token')
  try {
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) throw error
    } else if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      if (error) throw error
    } else {
      return false
    }
    explicitSignOut = false
    await applySession()
    return true
  } catch (e) {
    notify(`Google sign-in failed: ${e instanceof Error ? e.message : 'unknown error'}`, 'err')
    return false
  }
}

/**
 * Send a password-reset email. Errors are NOT swallowed any more: the old
 * version caught everything and returned normally, so the UI showed
 * "Reset link sent" even when nothing had been sent.
 */
export async function sendPasswordReset(email: string) {
  if (!liveAuth || !supabase) throw new Error('Password reset needs Supabase to be configured')
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${oauthRedirectUrl()}/reset`,
  })
  if (error) throw new Error(error.message)
}

export async function signOutUser() {
  explicitSignOut = true
  if (liveAuth && supabase) await supabase.auth.signOut()
  stopSync()
  useStore.getState().logout()
  explicitSignOut = false
}

/** Push the current Supabase session into the store. Single source of truth. */
async function applySession() {
  if (!liveAuth || !supabase) return
  const { data } = await supabase.auth.getSession()
  const u = data.session?.user
  if (!u) return
  const meta = (u.user_metadata ?? {}) as { username?: string; full_name?: string; name?: string }
  useStore.getState().login(meta.username || meta.full_name || meta.name || guessName(u.email ?? ''))
  void loadUserData()
}

/** Restore an existing Supabase session on app load and keep the store in sync. */
export function bootstrapAuth() {
  if (!liveAuth || !supabase) return

  // the APK may have been opened by the OAuth redirect rather than a cold start
  if (typeof window !== 'undefined' && /auth-callback/.test(window.location.href)) {
    void handleOAuthReturn(window.location.href)
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    // a successful background refresh is not a state change worth reacting to
    if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY') return

    if (session) {
      explicitSignOut = false
      await applySession()
      return
    }
    if (event !== 'SIGNED_OUT') return

    if (explicitSignOut) {
      explicitSignOut = false
      stopSync()
      useStore.getState().logout()
      return
    }

    // Unexpected SIGNED_OUT. Supabase also fires this when a refresh fails or
    // another device signs out, and logging out immediately is what dumped the
    // player back to the login screen mid-tournament. Try to recover first.
    const { data } = await supabase!.auth.getSession()
    if (data.session) {
      await applySession()
      return
    }
    stopSync()
    useStore.getState().logout()
    notify('Session expired — please sign in again', 'err')
  })

  // cold start with a stored session
  void supabase.auth.getSession().then(({ data }) => { if (data.session) void applySession() })
}