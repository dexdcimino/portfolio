/* YouVerse's service worker, the arrangement Inko, DexNote and MindSplit
   use: it exists so the installed app opens with no network, and it must
   never be the reason an update does not show.

   THE APP IS NETWORK-FIRST. The page and its files are fetched fresh on
   every launch and the cache is only the offline fallback, so a new build
   reaches the next launch without this file changing. Icons never change
   under one name, so those are cache-first. Only GET is handled; the
   Wikipedia lookups are another origin and are never touched. */
const CACHE = 'youverse-shell-v11';
const SHELL = ['/youverse/', '/youverse/index.html', '/youverse/app.js', '/youverse/data.js',
  '/youverse/style.css', '/youverse/manifest.webmanifest'];
const ICONS = ['/youverse/icon-192.png', '/youverse/icon-512.png',
  '/youverse/icon-maskable-512.png', '/youverse/apple-touch-icon.png', '/youverse/icon-circle.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll([...SHELL, ...ICONS].map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('youverse') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isShell = url => url.pathname === '/youverse/' || SHELL.includes(url.pathname);

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin || !url.pathname.startsWith('/youverse/')) return;

  if (request.mode === 'navigate' || isShell(url)) {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            const key = request.mode === 'navigate' ? '/youverse/' : request;
            caches.open(CACHE).then(cache => cache.put(key, copy));
          }
          return response;
        })
        .catch(() => caches.match(request.mode === 'navigate' ? '/youverse/' : request, { ignoreSearch: true }))
    );
    return;
  }

  // Icons and anything else under /youverse/: cache first, network to fill.
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    }))
  );
});
