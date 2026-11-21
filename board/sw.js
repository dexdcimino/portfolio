/* Dex Board service worker, following the dexnote and inko pattern.
   The shell is network first always, with the cache as the offline
   fallback, so an edit reaches the next load with no version string
   to bump. Only GET requests on this origin under /board/ are handled,
   and nothing under /api/ is ever touched. */
const CACHE = "board-shell";
const SHELL = [
  "/board/",
  "/board/index.html",
  "/board/board.css",
  "/board/board.js",
  "/board/store.js",
  "/board/dnd.js",
  "/board/overview.js",
  "/board/schedule.js",
  "/board/notes.js",
  "/board/diet.js",
  "/board/exercise.js",
  "/board/work.js",
  "/board/music.js",
  "/board/manifest.webmanifest",
];
const ICONS = [
  "/board/icon-192.png",
  "/board/icon-512.png",
  "/board/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll([...SHELL, ...ICONS].map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.startsWith("board-")).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const put = (key, response) => {
  const copy = response.clone();
  caches.open(CACHE).then((cache) => cache.put(key, copy));
};

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (!url.pathname.startsWith("/board/")) return;

  const isIcon = ICONS.includes(url.pathname);
  if (isIcon) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((r) => {
        if (r.ok) put(request, r);
        return r;
      }))
    );
    return;
  }

  const navigate = request.mode === "navigate";
  event.respondWith(
    fetch(request, { cache: "no-cache" })
      .then((r) => {
        if (r.ok) put(navigate ? "/board/" : request, r);
        return r;
      })
      .catch(() => caches.match(navigate ? "/board/" : request, { ignoreSearch: true }))
  );
});
