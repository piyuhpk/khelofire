// Auth service.
//
// Talks to Supabase when keys are present, otherwise runs the local demo login
// so the app is still usable before the project is wired.
//
// Two bugs that used to live here, both reported from the client's test APK:
//
//  1. `authed: true` was written to localStorage, so after a force-stop the app
//     reopened already "logged in" as a user that never existed. The store no
//     longer persists `authed` in live mode - the Supabase session decides.
//
//  2. The SIGNED_OUT branch logged the user out on ANY sign-out event, and
//     Supabase also emits SIGNED_OUT when a token refresh fails or another
//     device signs out. That is why the app jumped to the login screen in the
//     middle of a tournament with no message. It now tries to recover first and
//     tells the user when the session really is gone.
import { Capacitor } from '@capacitor/core'
import { supabase, hasSupabase, envProblem } from './supabase'
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
 * The address confirmation and password-reset mails point back to.
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
  // A malformed URL or a pasted key belonging to another project makes Supabase
  // answer 401 "Invalid login credentials" - a message about the account, when
  // the actual fault is the .env. Say which one it is, because chasing the wrong
  // one costs an evening.
  if (envProblem) throw new Error(`Supabase is not configured: ${envProblem}`)

  if (liveAuth && supabase) {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) {
      if (/invalid login credentials/i.test(error.message)) {
        throw new Error(
          `Wrong email or password (or this account does not exist in the project at ${supabaseUrlForError()})`,
        )
      }
      throw new Error(error.message)
    }
    explicitSignOut = false
    await applySession()
    return
  }
  useStore.getState().login(guessName(email))
}

function supabaseUrlForError(): string {
  const u = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? 'unknown'
  return u.replace(/^https?:\/\//, '')
}

/**
 * Change the signed-in user's password.
 *
 * The current password is checked first, and that check is the point: without
 * it, anyone who walks up to an unlocked admin phone - or anyone who gets hold
 * of a session token - could lock the owner out permanently. The re-check is a
 * real password verification (signInWithPassword), not a "are you still logged
 * in" test.
 *
 * The session is intentionally NOT reused for the re-check, because signing in
 * again would replace the session and silently sign out every other tab.
 */
export async function changePassword(currentPassword: string, newPassword: string) {
  if (!liveAuth || !supabase) throw new Error('Password changes need Supabase configured')

  if (newPassword.length < 8) throw new Error('Use at least 8 characters')

  const { data: sess } = await supabase.auth.getSession()
  const email = sess.session?.user.email
  if (!email) throw new Error('Sign in again to change your password')

  const { error: recheck } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
  if (recheck) throw new Error('Current password is wrong')

  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw new Error(error.message)
}

/**
 * Change the signed-in user's email.
 *
 * Supabase only moves the address once the new one is confirmed, so this is a
 * two-step thing: it asks for the confirmation and reports that plainly instead
 * of pretending the account moved. The player keeps signing in with the old
 * address until they click the link.
 */
export async function changeEmail(newEmail: string) {
  if (!liveAuth || !supabase) throw new Error('Email changes need Supabase configured')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail.trim())) throw new Error('That does not look like an email address')

  const { error } = await supabase.auth.updateUser({ email: newEmail.trim() })
  if (error) throw new Error(error.message)
}

/** The display name on the signed-in account, if there is one. */
export async function currentEmail(): Promise<string | null> {
  if (!liveAuth || !supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user.email ?? null
}

export async function signUp(username: string, email: string, password: string) {  if (liveAuth && supabase) {
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

  // No OAuth deep-link handling here any more. There is no third-party sign-in to
  // redirect back from - email confirmation and password reset arrive by mail, and
  // both open the app on a plain launch, which onAuthStateChange already covers.
  // The redirect URL helper below is still used, but only as the address those mails
  // point at.

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
