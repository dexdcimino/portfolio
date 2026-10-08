/* Inko's service worker. ONE job beyond working offline: never be the reason
   an update does not show.

   THE APP SHELL IS NETWORK-FIRST, ALWAYS. index.html, app.js, app.css and the
   manifest are fetched from the network on every request, revalidated against
   the server, and the cache is only the offline fallback. So an edit reaches
   the next load without this file changing at all -- there is no version
   string here to remember to bump, which is what the previous one depended
   on (it said 6.0.0 while the app said 5.0.0).

   WHEN THE APP ITSELF NOTICES A NEW BUILD, it reloads (see the update section
   of app.js). This file only has to make sure that reload gets the new files,
   which network-first does.

   Only GET requests are handled. The update check is a HEAD request and must
   reach the network, not a cache. */
const CACHE = 'inko-shell';
const SHELL = ['/inko/', '/inko/index.html', '/inko/app.js', '/inko/app.css', '/inko/social.js', '/inko/social.css', '/inko/manifest.webmanifest'];
const ICONS = ['/inko/icon-192.png', '/inko/icon-512.png', '/inko/icon-mono-192.png', '/inko/icon-mono-512.png', '/inko/apple-touch-icon.png'];

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
      // Every older cache -- 'inko-v6' and before -- goes.
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isShell = url => url.pathname === '/inko/' || SHELL.includes(url.pathname);

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin || !url.pathname.startsWith('/inko/')) return;

  if (request.mode === 'navigate' || isShell(url)) {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            // Navigations are filed under the shell's own URL, so an offline
            // launch with ?embed=1 or a stale query still finds the page.
            const key = request.mode === 'navigate' ? '/inko/' : request;
            caches.open(CACHE).then(cache => cache.put(key, copy));
          }
          return response;
        })
        .catch(() => caches.match(request.mode === 'navigate' ? '/inko/' : request, { ignoreSearch: true }))
    );
    return;
  }

  // Icons and anything else under /inko/: the cache first, the network to fill it.
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
