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

/* The card says so while this happens. Without it the button is simply dead for
   a few seconds and the only honest reading of that is that the game is broken —
   which is what a black screen was already saying. */
const btn = document.getElementById('begin');
const card = document.getElementById('start');
if (btn) {
  btn.disabled = true;
  btn.dataset.state = 'loading';
  btn.textContent = 'Loading';
}

await painted();
if (card) card.dataset.state = 'loading';

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
