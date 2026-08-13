// ══════════════════════════════════════════════════════
//  Accent color — single source of truth
// ══════════════════════════════════════════════════════
//  The host portfolio site owns the accent. The game never stores its own
//  copy; it reads --accent off the document element. The character's body
//  color is separate (DXAV cosmetics) and stays independently choosable.
//  Accent drives HUD, bars, chips, UI chrome and the nametag.

const FALLBACK = '#68d121';

export function getAccent() {
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim() || FALLBACK;
}

// ── The --clr / --clr-adj bridge ──
// The game was written against the notes app's two accent variables: --clr
// (the session color) and --clr-adj (the same color contrast-adjusted for the
// current theme). Between them they are read by ~40 JS sites and ~25 CSS
// rules. Rather than rewrite every one, we publish --accent into both. Any
// existing `var(--clr-adj)` or `getPropertyValue('--clr-adj')` then resolves
// correctly and untouched.

let _applying = false;

function _publish(accent) {
  // Writing to documentElement.style re-fires our own MutationObserver, so
  // flag the write and ignore the echo.
  _applying = true;
  const root = document.documentElement.style;
  root.setProperty('--clr', accent);
  root.setProperty('--clr-adj', accent);
  _applying = false;
}

// ── Live repaint ──
// The original froze the accent on play-mode entry (_entryColor) because the
// notes app could change it mid-session. Here we watch instead: any
// style/class mutation on <html> re-reads the var, and a low-frequency poll
// catches changes that mutate no attribute (a stylesheet swap, a devtools
// edit).

const _subs = new Set();
let _last = null;
let _watching = false;

/** Register fn to be called with the new accent whenever it changes.
 *  Fires immediately with the current value. Returns an unsubscribe fn. */
export function onAccentChange(fn) {
  _subs.add(fn);
  startAccentWatch();
  try { fn(getAccent()); } catch (e) {}
  return () => _subs.delete(fn);
}

function _check() {
  if (_applying) return;
  const cur = getAccent();
  if (cur === _last) return;
  _last = cur;
  _publish(cur);
  _subs.forEach(fn => { try { fn(cur); } catch (e) {} });
}

/** Start bridging --accent into --clr/--clr-adj and watching for changes.
 *  Idempotent; main.js calls it once at boot. */
export function startAccentWatch() {
  if (_watching) return;
  _watching = true;
  _last = getAccent();
  _publish(_last);

  new MutationObserver(_check).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class', 'data-theme'],
  });

  // Safety net — 4x/sec is far below frame budget and catches changes that
  // mutate no observable attribute on <html>.
  let t = 0;
  const poll = (now) => {
    if (now - t > 250) { t = now; _check(); }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}
