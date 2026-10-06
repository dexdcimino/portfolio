// Portfolio service worker - passive, for PWA installability only.
// Does not intercept requests; just satisfies Chrome's installability check.
self.addEventListener('install', e => {
  e.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});
// No fetch handler - let all requests go to network normally.
