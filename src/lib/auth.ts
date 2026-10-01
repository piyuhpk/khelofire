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
  if (hasSupabase && supabase) {
    // Google client ID + SECRET are configured in the Supabase dashboard
    // (Auth → Providers → Google), never in this frontend bundle.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) throw new Error(error.message)
    return // browser redirects to Google; onAuthStateChange logs us in on return
  }
  // demo fallback
  useStore.getState().login('Google User')
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
    } else {
      stopSync()
      useStore.getState().logout()
    }
  })
}
