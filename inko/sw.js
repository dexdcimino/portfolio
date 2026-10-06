const CACHE = 'inko-v4';
const ASSETS = [
  '/inko/',
  '/inko/index.html',
  '/inko/app.css',
  '/inko/app.js',
  '/inko/manifest.webmanifest',
  '/inko/icon-192.png',
  '/inko/icon-512.png',
  '/inko/apple-touch-icon.png'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/inko/')) {
    if (e.request.mode === 'navigate') {
      e.respondWith(fetch(e.request).catch(() => caches.match('/inko/index.html')));
    } else if (url.pathname.endsWith('/app.js') || url.pathname.endsWith('/app.css')) {
      // Network-first for JS/CSS so updates apply immediately
      e.respondWith(
        fetch(e.request).then(r => {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return r;
        }).catch(() => caches.match(e.request))
      );
    } else {
      e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
    }
  }
});
