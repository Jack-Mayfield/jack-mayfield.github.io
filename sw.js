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
// Audio assets (sample packs, NAM models, IRs, the coach's voice) live in their own cache that
// SURVIVES version bumps — they are multi-MB and version-bumped by directory
// name (clean-di.v1/), so purging them with the shell would re-download the
// whole pack on every deploy. Never precached: a missing sample must not block
// install, and the pack streams in lazily.
const AUDIO_CACHE = 'fretfm-audio-v1'
// Sample packs each get their own cache, `fretfm-audio-<pack_id>` (the directory
// name minus its .vN). Every banked pack is kept while it ships — an A/B switches
// arms without re-downloading (the first fix after Jack's 2026-10-08 listen: the
// arms were evicting each other, and every visit opened on the KS floor); a pack
// retired from PACKS loses its cache on the next activate, so nothing hoards
// forever. tone/ and voice/ stay in AUDIO_CACHE.
const PACK_CACHE_PREFIX = 'fretfm-audio-'
const PACKS = ['emily-clean', 'emily-deluxe', 'emily-jc']
// Base path (e.g. '/' locally, '/Riffed/' on GitHub Pages), derived from where
// this worker is served so the same file works on both.
const BASE = new URL('.', self.location).pathname
const SHELL = [BASE, BASE + 'manifest.webmanifest', BASE + 'icons/icon-192.png', BASE + 'icons/icon-512.png']
const isAudioAsset = (url) =>
  url.origin === self.location.origin &&
  (url.pathname.startsWith(BASE + 'samples/') ||
    url.pathname.startsWith(BASE + 'tone/') ||
    url.pathname.startsWith(BASE + 'voice/'))
const audioCacheFor = (url) => {
  const m = url.pathname.slice(BASE.length).match(/^samples\/([^/]+?)(?:\.v\d+)?\//)
  return m ? PACK_CACHE_PREFIX + m[1] : AUDIO_CACHE
}

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
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) =>
                k !== VERSION &&
                k !== AUDIO_CACHE &&
                !(k.startsWith(PACK_CACHE_PREFIX) && PACKS.includes(k.slice(PACK_CACHE_PREFIX.length))),
            )
            .map((k) => caches.delete(k)),
        ),
      )
      // One-time migration (2026-10-08): sample files banked in the shared audio
      // cache before packs had their own move out, so the old DI pack does not
      // sit beside the new default forever.
      .then(() => caches.open(AUDIO_CACHE))
      .then((c) =>
        c.keys().then((reqs) =>
          Promise.all(
            reqs
              .filter((r) => new URL(r.url).pathname.startsWith(BASE + 'samples/'))
              .map((r) => c.delete(r)),
          ),
        ),
      )
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

  // Audio assets: pure cache-first into the version-bump-proof audio caches.
  // Directory names carry the version (emily-deluxe.v1/), so a hit is always right.
  if (isAudioAsset(url)) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(audioCacheFor(url)).then((c) => c.put(req, copy))
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
