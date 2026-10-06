const CACHE = 'inko-v6';
const APP_VERSION = '6.0.0';

// Files that should always be fresh (network-first)
const NETWORK_FIRST = [
  '/inko/',
  '/inko/index.html',
  '/inko/app.js',
  '/inko/app.css',
  '/inko/manifest.webmanifest'
];

// Files that can be cached aggressively (cache-first)
const CACHE_FIRST = [
  '/inko/icon-192.png',
  '/inko/icon-512.png',
  '/inko/icon-mono-192.png',
  '/inko/icon-mono-512.png',
  '/inko/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll([...NETWORK_FIRST, ...CACHE_FIRST]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      // Notify all clients of the new version
      .then(() => self.clients.matchAll().then(clients => {
        clients.forEach(c => c.postMessage({ type: 'SW_UPDATED', version: APP_VERSION }));
      }))
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (!url.pathname.startsWith('/inko/')) return;
  
  if (e.request.mode === 'navigate') {
    // Network-first for navigations
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return r;
        })
        .catch(() => caches.match('/inko/index.html'))
    );
  } else if (NETWORK_FIRST.some(p => url.pathname === p || url.pathname.endsWith(p.split('/').pop()))) {
    // Network-first for app files
    e.respondWith(
      fetch(e.request)
        .then(r => {
          if (r.ok) {
            const copy = r.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return r;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    // Cache-first for static assets
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(r => {
          if (r.ok) {
            const copy = r.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return r;
        });
      })
    );
  }
});

// Allow the page to trigger an immediate update
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
