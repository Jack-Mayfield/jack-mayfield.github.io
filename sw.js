/**
 * FRETfm service worker — offline shell.
 *
 * Strategy:
 *  - navigations: network-first (fresh index when online), cached shell offline
 *  - same-origin assets (hashed by Vite, immutable): cache-first
 *  - Google Fonts: stale-while-revalidate (opaque responses cached as-is)
 *
 * Bump VERSION on deploys that must invalidate old caches; hashed asset
 * URLs make stale JS/CSS harmless, so this mostly prunes dead entries.
 */

const VERSION = 'fretfm-v1'
// Audio assets (sample packs, NAM models, IRs) live in their own cache that
// SURVIVES version bumps — they are multi-MB and version-bumped by directory
// name (clean-di.v1/), so purging them with the shell would re-download the
// whole pack on every deploy. Never precached: a missing sample must not block
// install, and the pack streams in lazily.
const AUDIO_CACHE = 'fretfm-audio-v1'
// Base path (e.g. '/' locally, '/Riffed/' on GitHub Pages), derived from where
// this worker is served so the same file works on both.
const BASE = new URL('.', self.location).pathname
const SHELL = [BASE, BASE + 'manifest.webmanifest', BASE + 'icons/icon-192.png', BASE + 'icons/icon-512.png']
const isAudioAsset = (url) =>
  url.origin === self.location.origin &&
  (url.pathname.startsWith(BASE + 'samples/') || url.pathname.startsWith(BASE + 'tone/'))

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== AUDIO_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // Navigations: try the network, fall back to the cached shell.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(VERSION).then((c) => c.put(BASE, copy))
          return res
        })
        .catch(() => caches.match(BASE)),
    )
    return
  }

  // Audio assets: pure cache-first into the version-bump-proof audio cache.
  // Directory names carry the version (clean-di.v1/), so a hit is always right.
  if (isAudioAsset(url)) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(AUDIO_CACHE).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
    return
  }

  // Fonts (googleapis css + gstatic woff2): stale-while-revalidate.
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'
  if (isFont || url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const refetch = fetch(req)
          .then((res) => {
            if (res.ok || res.type === 'opaque') {
              const copy = res.clone()
              caches.open(VERSION).then((c) => c.put(req, copy))
            }
            return res
          })
          .catch(() => hit)
        return hit ?? refetch
      }),
    )
  }
})
