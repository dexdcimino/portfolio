/* YapTap's service worker, the arrangement Inko, DexNote, MindSplit and
   YouVerse use: network-first, so an installed app always picks up the
   newest build on its next launch and the cache is only an offline
   fallback. Icons never change under one name, so those are cache-first. */
const CACHE = 'yaptap-shell-v172';
const SHELL = ['/yaptap/', '/yaptap/index.html', '/yaptap/app.js',
  '/yaptap/style.css', '/yaptap/manifest.webmanifest'];
const ICONS = ['/yaptap/icon-192.png', '/yaptap/icon-512.png',
  '/yaptap/icon-maskable-512.png', '/yaptap/apple-touch-icon.png',
  '/yaptap/mic-white.svg', '/yaptap/mic-lime.svg'];

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
      .then(keys => Promise.all(keys.filter(k => k.startsWith('yaptap') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isShell = url => url.pathname === '/yaptap/' || SHELL.includes(url.pathname);

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin || !url.pathname.startsWith('/yaptap/')) return;

  if (request.mode === 'navigate' || isShell(url)) {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            const key = request.mode === 'navigate' ? '/yaptap/' : request;
            caches.open(CACHE).then(cache => cache.put(key, copy));
          }
          return response;
        })
        .catch(() => caches.match(request.mode === 'navigate' ? '/yaptap/' : request, { ignoreSearch: true }))
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
