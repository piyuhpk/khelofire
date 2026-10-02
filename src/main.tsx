import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import './index.css'
import { ToastProvider } from './ui/components'
import { AppLayout } from './app/AppLayout'
import { RequireAuth } from './app/RequireAuth'
import { bootstrapAuth, handleOAuthReturn, isNativeApp } from './lib/auth'
import Auth from './features/auth/Auth'
import Home from './features/home/Home'
import Lobby from './features/lobby/Lobby'
import ConfirmJoin from './features/lobby/ConfirmJoin'
import LudoGame from './features/ludo/LudoGame'
import ChessGame from './features/chess/ChessGame'
import GutiGame from './features/guti/GutiGame'
import DiceGame from './features/dice/DiceGame'
import Wallet from './features/wallet/Wallet'
import MyMatches from './features/matches/MyMatches'
import Profile from './features/profile/Profile'
import Leaderboard from './features/misc/Leaderboard'
import Notifications from './features/misc/Notifications'
import Admin from './features/admin/Admin'
import Refer from './features/refer/Refer'
import Support from './features/support/Support'
import Settings from './features/settings/Settings'
import InGame from './features/hub/InGame'
import ExternalArena from './features/hub/ExternalArena'

// The app opens straight to Home — browsing is free. Login is required only to
// join a paid match (RequireAuth on /join). Free/practice games open directly.
// Admin APK (built with VITE_ADMIN_BUILD=true) opens straight into /admin;
// the regular user APK keeps the hidden long-press entry.
if (import.meta.env.VITE_ADMIN_BUILD === 'true' && !window.location.pathname.startsWith('/admin')) {
  window.history.replaceState({}, '', '/admin')
}

const router = createBrowserRouter([
  { path: '/login', element: <Auth /> },
  // Login is required only to JOIN a paid match. Free/practice games open directly.
  { path: '/join/:modeId', element: <RequireAuth><ConfirmJoin /></RequireAuth> },
  { path: '/wallet', element: <RequireAuth><Wallet /></RequireAuth> },
  { path: '/profile', element: <RequireAuth><Profile /></RequireAuth> },
  { path: '/matches', element: <RequireAuth><MyMatches /></RequireAuth> },
  { path: '/play/ludo/:modeId', element: <LudoGame /> },
  { path: '/play/chess/:modeId', element: <ChessGame /> },
  { path: '/play/guti/:modeId', element: <GutiGame /> },
  { path: '/play/dice/:modeId', element: <DiceGame /> },
  { path: '/freefire', element: <ExternalArena kind="freefire" /> },
  { path: '/ludoking', element: <ExternalArena kind="ludoking" /> },
  // Admin console - gated by a real staff account (see features/admin Gate)
  { path: '/admin', element: <Admin /> },
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/ingame', element: <InGame /> },
      { path: '/lobby/:game', element: <Lobby /> },
      { path: '/leaderboard', element: <Leaderboard /> },
      { path: '/notifications', element: <Notifications /> },
      { path: '/refer', element: <Refer /> },
      { path: '/support', element: <Support /> },
      { path: '/settings', element: <Settings /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

// apply persisted theme (default dark)
const theme = (JSON.parse(localStorage.getItem('kv-i18n') || '{}')?.state?.theme) || 'dark'
document.documentElement.setAttribute('data-theme', theme)

// restore a live Supabase session if the project is wired (no-op in demo mode)
bootstrapAuth()

// Google OAuth comes back into the APK as a deep link (khelofire://auth-callback).
// Without this listener the app opens, finds no session, and looks like the
// button did nothing. Imported dynamically so the web build is unaffected.
if (import.meta.env.PROD) {
  void import('@capacitor/app')
    .then(async ({ App }) => {
      // a cold start triggered by the redirect
      const launched = await App.getLaunchUrl()
      if (launched?.url?.includes('auth-callback')) void handleOAuthReturn(launched.url)
      // and a warm start while the app is already open
      App.addListener('appUrlOpen', ({ url }) => {
        if (url.includes('auth-callback')) void handleOAuthReturn(url)
      })
    })
    .catch(() => { /* not a native build */ })
}

// live cross-device announcements (Supabase Realtime broadcast; no-op without keys)
import('./lib/realtime').then((m) => m.initRealtimeAnnouncements()).catch(() => {})

// Register the PWA service worker (web only). Inside the APK the page is loaded
// from the packaged assets, so a service worker can only ever serve a STALE
// bundle after an app update - players would keep hitting the bugs that were
// just fixed. Skipped for native builds.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !isNativeApp()) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  </StrictMode>
)
