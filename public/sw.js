// Minimal service worker — enables PWA install + basic offline shell.
// Network-first for navigations (always fresh app), cache fallback when offline.
const CACHE = 'khelofire-v1'
const SHELL = ['/', '/index.html', '/logo.jpg', '/manifest.webmanifest']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // never cache Supabase / cross-origin API calls
  if (url.origin !== self.location.origin) return
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')))
    return
  }
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone()
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
      return res
    }).catch(() => hit))
  )
})
