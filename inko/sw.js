// Inko service worker: makes the app installable and gives offline support.
// Navigations are network-first so updates always reach the app fresh;
// static assets are cached for speed and offline use.
const CACHE = "inko-v1";
const ASSETS = [
  "/inko/",
  "/inko/index.html",
  "/inko/manifest.webmanifest",
  "/inko/icon-192.png",
  "/inko/icon-512.png",
  "/inko/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    // Network first: always get the latest app, fall back to cache offline.
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/inko/index.html"))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
