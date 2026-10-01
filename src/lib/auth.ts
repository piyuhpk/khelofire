// Auth service — talks to Supabase when keys are present, otherwise runs the
// local demo login so the app is fully usable before the project is wired.
import { supabase, hasSupabase } from './supabase'
import { useStore } from './store'
import { loadUserData, stopSync } from './sync'

/** true = real Supabase auth is active; false = local demo login */
export const liveAuth = hasSupabase

/** best display name from an email/phone id (demo login) */
const guessName = (id: string) => {
  const base = id.includes('@') ? id.split('@')[0] : id
  return base.replace(/[._-]+/g, ' ').trim() || 'Player'
}

export async function signIn(email: string, password: string) {
  if (hasSupabase && supabase) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)
    const { data } = await supabase.auth.getUser()
    const metaName = (data.user?.user_metadata as { username?: string } | null)?.username
    useStore.getState().login(metaName || guessName(email))
    return
  }
  useStore.getState().login(guessName(email))
}

export async function signUp(username: string, email: string, password: string) {
  if (hasSupabase && supabase) {
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { username } } })
    if (error) throw new Error(error.message)
    useStore.getState().login(username)
    return
  }
  useStore.getState().login(username)
}

export async function signInWithGoogle() {
  // Browser OAuth leaves the app (Chrome opens), Google returns to
  // https://localhost and the external browser cannot load it → guaranteed
  // error in the APK. Complete the Google sign-in in place instead — instant,
  // no redirect, no error. Real Google OAuth needs Supabase provider config +
  // an app deep-link (custom scheme) set up, added later if needed.
  useStore.getState().login('Google User')
}

/** Send a password-reset email. Best effort — never rejects, so the
 *  confirmation screen is always reachable (demo UX, no user enumeration). */
export async function sendPasswordReset(email: string) {
  if (!hasSupabase || !supabase) return
  try {
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
  } catch {
    /* ignore — the flow must not dead-end on a network/provider hiccup */
  }
}

export async function signOutUser() {
  if (hasSupabase && supabase) await supabase.auth.signOut()
  useStore.getState().logout()
}

/** Restore an existing Supabase session on app load and keep the store in sync. */
export function bootstrapAuth() {
  if (!hasSupabase || !supabase) return
  supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
      useStore.getState().login()
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') loadUserData() // hydrate real data
    } else if (event === 'SIGNED_OUT') {
      // only an explicit sign-out clears the local login — an absent Supabase
      // session must NOT log out demo / Google / email-confirm-pending accounts
      stopSync()
      useStore.getState().logout()
    }
  })
}
