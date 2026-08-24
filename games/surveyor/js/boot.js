// The smallest file in the game, and the one that decides how long it takes.
//
// THE PROBLEM IS NOT DOWNLOAD, IT IS A BLOCKED MAIN THREAD. Babylon is 8.2MB of
// minified UMD; fetching it over a warm connection is nothing, and COMPILING it
// is close to a second on a fast machine and several on a slow one. main.js
// then builds a planet on top of that. All of it runs on the one thread that
// also paints, so the browser has the start card parsed and ready and no
// opportunity to put it on screen — measured at 6.3 seconds of black before the
// first contentful paint, which is the whole boot spent on nothing.
//
// `defer` does not fix it and made it worse: deferred scripts run at the end of
// parsing, immediately, and a rendering opportunity is not guaranteed between
// the two. The only thing that works is to not start until a frame has actually
// been painted — which is what this file is.
//
//   parse the document        ~60ms   the card exists
//   ONE PAINTED FRAME                 the card is on screen
//   load and compile Babylon          behind the card
//   import main.js                    behind the card
//
// So the engine is fetched from here rather than from a <script> tag in the
// document, because a tag in the document is exactly the thing that cannot
// wait. No inline script — the repo rule holds, and this is a real file.
//
// AND, INSIDE THE SITE'S WRAPPER, NOT UNTIL "BEGIN SURVEY" IS PRESSED (Dex,
// 2026-08-23). /surveyor frames this page same-origin, so the frame shares the
// wrapper's main thread — and the wrapper's exit chip is a link on that thread.
// Booting the moment the card painted meant a visitor who took one look and
// reached for the X found it dead for the whole compile: 676ms blocked and a
// 404ms single task on the dev box, several seconds on a slow laptop. Framed,
// the card now comes up with a LIVE button and the engine is only prefetched
// into the HTTP cache; the compile starts on the click, i.e. once the visitor
// has chosen to stay, and the same click still starts the session — main.js
// reads `__surveyorAutoBegin` and calls begin() as soon as it has wired the
// button. Top-level (a direct URL, every dev harness) nothing shares the
// thread, and the harnesses only press Begin AFTER window.SURVEYOR exists, so
// the eager order above stands there.

/**
 * Resolve after the browser has actually put a frame on the screen.
 *
 * TWO frames, not one. A single rAF callback runs BEFORE that frame's paint, so
 * work started there still lands in front of it; the second callback is the
 * first moment the pixels are guaranteed to be up. This is the whole trick and
 * it is one line, so it is worth stating why it is not one frame.
 */
const painted = () => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
});

/** The engine, as a same-origin script element. `script-src 'self'` allows it. */
const engine = () => new Promise((resolve, reject) => {
  const el = document.createElement('script');
  el.src = 'vendor/babylon.js';
  el.onload = () => resolve();
  el.onerror = () => reject(new Error('vendor/babylon.js failed to load'));
  document.head.appendChild(el);
});

/* Inside an <iframe>, or the page itself. A cross-origin parent makes the
   comparison throw; treat that as framed too — a parent is a parent. */
const framed = (() => { try { return window.top !== window; } catch { return true; } })();

/* The card says so while this happens. Without it the button is simply dead for
   a few seconds and the only honest reading of that is that the game is broken —
   which is what a black screen was already saying. */
const btn = document.getElementById('begin');
const card = document.getElementById('start');
const loading = () => {
  if (btn) {
    btn.disabled = true;
    btn.dataset.state = 'loading';
    btn.textContent = 'Loading';
  }
  if (card) card.dataset.state = 'loading';
};

if (!framed) loading();

await painted();

if (framed) {
  // The bytes now, the compile later. A prefetch is the browser's own idea of
  // "you will want this": it lands in the HTTP cache and costs this thread
  // nothing, so the wait after the click is the compile alone.
  const hint = document.createElement('link');
  hint.rel = 'prefetch';
  hint.as = 'script';
  hint.href = 'vendor/babylon.js';
  document.head.appendChild(hint);

  if (btn) {
    btn.disabled = false;
    btn.dataset.state = 'ready';
    btn.textContent = 'Begin survey';
  }
  if (card) card.dataset.state = 'ready';

  // Click, or Enter / Space — the same two keys main.js listens for once it
  // is up, so the card answers the same way before and after the engine.
  await new Promise((resolve) => {
    const go = () => {
      btn?.removeEventListener('click', go);
      window.removeEventListener('keydown', onKey);
      loading();   // in the handler itself, so the button answers the press in the same task
      resolve();
    };
    const onKey = (e) => { if (e.code === 'Enter' || e.code === 'Space') go(); };
    btn?.addEventListener('click', go);
    window.addEventListener('keydown', onKey);
  });
  window.__surveyorAutoBegin = true;
}

try {
  await engine();
  await import('./main.js');
} catch (err) {
  if (btn) {
    btn.dataset.state = 'failed';
    btn.textContent = 'Failed to load';
  }
  throw err;
}
