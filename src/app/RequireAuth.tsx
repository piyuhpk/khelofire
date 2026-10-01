import { type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useStore } from '../lib/store'

// Gate for paid-match routes: unauthenticated users are sent to /login and
// returned to where they were headed after signing in. Kept in its own module
// so main.tsx stays free of component definitions (React Fast Refresh boundary).
export function RequireAuth({ children }: { children: ReactNode }) {
  const authed = useStore((s) => s.authed)
  // suspended / deleted accounts are kicked out even if they were logged in
  const status = useStore((s) => s.adminUsers.find((u) => u.name === s.username && u.status !== 'deleted')?.status)
  const loc = useLocation()
  if (!authed) return <Navigate to="/login" state={{ from: loc.pathname }} replace />
  if (status && status !== 'active') return <Navigate to="/login" replace />
  return <>{children}</>
}
