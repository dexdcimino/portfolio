/* DexNote's service worker, the same arrangement as Inko's (inko/sw.js).
   ONE job beyond working offline: never be the reason an update does not
   show.

   CODE IS NETWORK-FIRST, ALWAYS. The page, its modules under /dexnote/,
   /notes/ and /account/, and their stylesheets are fetched from the network
   on every request and revalidated; the cache is only the offline fallback.
   So an edit reaches the next load without this file changing -- there is no
   version string here to remember to bump. WHEN THE APP NOTICES A NEW BUILD
   it reloads itself (dexnote/main.js, "updates"); network-first is what makes
   that reload get the new files.

   Every file the app loads is cached as it is fetched, so the second launch
   works with no network at all -- guest notes completely, account notes up to
   the point of reaching the account. Nothing under /api/ is ever touched:
   the notes themselves are never served from here, so a cached copy can
   never be mistaken for the saved one.

   Fonts, the emoji table and the vendored Firebase SDK do not change under
   the same name, so those are cache-first. Only GET is handled: the update
   check is a HEAD and must reach the network. */
const CACHE = 'dexnote-shell';
const SHELL = ['/dexnote/', '/dexnote/manifest.webmanifest', '/dexnote/main.js', '/dexnote/mobile.js', '/dexnote/mobile.css',
  '/dexnote/dexnote.css', '/dexnote/account.js', '/dexnote/local.js', '/notes/app.js', '/notes/notes.css'];
const ICONS = ['/dexnote/icons/icon-192.png', '/dexnote/icons/icon-512.png', '/dexnote/icons/icon-mono-512.png',
  '/dexnote/icons/icon-maskable-512.png', '/dexnote/icons/apple-touch-icon.png', '/dexnote/icons/logo.svg'];
/* The spelling worker's own files: a worker's loads are not in the page's
   list of what it loaded, so they are named here. */
const WORKER = ['/notes/spell-worker.js', '/notes/vendor/typo.js', '/notes/vendor/en_US.aff', '/notes/vendor/en_US.dic'];
const SCOPES = ['/dexnote/', '/notes/', '/account/'];
const STILL = /^\/(notes\/fonts\/|notes\/emoji\.json|notes\/vendor\/|dexnote\/vendor\/|dexnote\/icons\/)/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll([...SHELL, ...ICONS, ...WORKER].map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/* The page's own list of what it loaded (dexnote/main.js), so a first visit
   leaves everything needed for an offline launch. Same-origin, in scope and
   never /api/ -- the page is trusted, but the rule is the worker's. */
self.addEventListener('message', (event) => {
  const urls = (event.data && Array.isArray(event.data.cache) ? event.data.cache : []).filter((u) => {
    try { const x = new URL(u); return x.origin === location.origin && !x.pathname.startsWith('/api/') && SCOPES.some((p) => x.pathname.startsWith(p)); } catch { return false; }
  });
  if (!urls.length) return;
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(urls.map((u) => cache.match(u).then((hit) => hit || cache.add(u).catch(() => {}))))));
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
      .then((r) => {
        // Navigations are filed under the page's own URL, so an offline launch
        // with ?install=1 or any other query still finds it.
        if (r.ok) put(navigate ? '/dexnote/' : request, r);
        return r;
      })
      .catch(() => caches.match(navigate ? '/dexnote/' : request, { ignoreSearch: true })),
  );
});
