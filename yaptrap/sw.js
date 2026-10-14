/* YapTrap's service worker, the arrangement Inko, DexNote, MindSplit and
   YouVerse use: network-first, so an installed app always picks up the
   newest build on its next launch and the cache is only an offline
   fallback. Icons never change under one name, so those are cache-first. */
const CACHE = 'yaptrap-shell';
const SHELL = ['/yaptrap/', '/yaptrap/index.html', '/yaptrap/app.js',
  '/yaptrap/style.css', '/yaptrap/manifest.webmanifest'];
const ICONS = ['/yaptrap/icon-192.png', '/yaptrap/icon-512.png',
  '/yaptrap/icon-maskable-512.png', '/yaptrap/apple-touch-icon.png'];

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
      .then(keys => Promise.all(keys.filter(k => k.startsWith('yaptrap') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isShell = url => url.pathname === '/yaptrap/' || SHELL.includes(url.pathname);

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin || !url.pathname.startsWith('/yaptrap/')) return;

  if (request.mode === 'navigate' || isShell(url)) {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            const key = request.mode === 'navigate' ? '/yaptrap/' : request;
            caches.open(CACHE).then(cache => cache.put(key, copy));
          }
          return response;
        })
        .catch(() => caches.match(request.mode === 'navigate' ? '/yaptrap/' : request, { ignoreSearch: true }))
    );
    return;
  }

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
