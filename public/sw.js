// Minimal service worker — enables PWA install + basic offline shell.
// Network-first everywhere (always fresh app), cache fallback when offline.
//
// It used to be cache-first for every same-origin GET, under a fixed cache name.
// That is what makes a released fix look like it "didn't happen": the old bundle
// is already in the cache, so the app keeps booting the build it was installed
// with, and because the name never changed the activate handler - which only
// deletes caches whose name differs - had nothing to purge. Stale-while-
// revalidate keeps the offline shell without ever shadowing a new bundle.
const CACHE = 'khelofire-v2'
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
  e.respondWith(
    // network first: a hit only stands in when the network is gone
    fetch(req)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
        return res
      })
      .catch(() => caches.match(req))
  )
})
