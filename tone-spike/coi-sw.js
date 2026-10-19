/**
 * Scoped cross-origin-isolation service worker — tone-spike ONLY.
 *
 * The TONE3000 NAM WASM build allocates WebAssembly.Memory({shared:true}),
 * which needs SharedArrayBuffer, which needs crossOriginIsolated, which needs
 * COOP/COEP response headers — headers GitHub Pages cannot set. This worker
 * synthesizes them client-side for pages under its scope (/tone-spike/) and
 * nothing else; the app's own sw.js scope is untouched. Whether Safari honors
 * SW-synthesized isolation headers is exactly what the spike measures.
 */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.status === 0) return res
      const headers = new Headers(res.headers)
      headers.set('Cross-Origin-Opener-Policy', 'same-origin')
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
      headers.set('Cross-Origin-Resource-Policy', 'same-origin')
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
    }),
  )
})
