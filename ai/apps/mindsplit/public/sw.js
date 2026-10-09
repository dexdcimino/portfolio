/* MindSplit's service worker, the arrangement Inko and DexNote use
   (inko/sw.js, dexnote/sw.js): it exists so the installed app opens with no
   network, and it must never be the reason an update does not show.

   THE APP IS NETWORK-FIRST. The page and its files are fetched fresh on
   every launch and the cache is only the offline fallback, so a new build
   reaches the next launch without this file changing. Vite's hashed files
   under assets/ and the vendored Firebase SDK never change under one name,
   so those are cache-first. Votes and polls are never here: Firestore is
   another origin and /api/ is never touched. Only GET is handled. */
const CACHE = 'mindsplit-shell';
const SHELL = ['/mindsplit/', '/mindsplit/manifest.webmanifest', '/mindsplit/cloud.js',
  '/mindsplit/icons/icon-192.png', '/mindsplit/icons/icon-512.png', '/mindsplit/icons/apple-touch-icon.png'];
const SCOPES = ['/mindsplit/', '/account/', '/dexnote/vendor/firebase/'];
const STILL = /^\/(mindsplit\/assets\/|mindsplit\/icons\/|dexnote\/vendor\/firebase\/)/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mindsplit') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const put = (key, response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(key, copy)); };

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (!SCOPES.some((p) => url.pathname.startsWith(p))) return;

  if (STILL.test(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((r) => { if (r.ok) put(request, r); return r; })));
    return;
  }
  const navigate = request.mode === 'navigate';
  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then((r) => { if (r.ok) put(navigate ? '/mindsplit/' : request, r); return r; })
      .catch(() => caches.match(navigate ? '/mindsplit/' : request).then((hit) => hit || Response.error())),
  );
});
