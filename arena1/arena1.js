/* ==========================================================================
   /arena1 — wrapper behaviour. Two small things, both about the keyboard.

   The game runs in the iframe and owns its own Escape ladder (pointer lock →
   pause menu → resume). Key events do not cross a frame boundary, so once the
   game holds focus the listener below can never fire — which is the intent:
   "Esc closes" is the standing rule for every overlay on this site, and this
   shell should not be the one exception that traps you, but it also must not
   steal Escape from the game.

   The catch: nothing focuses the iframe on its own. Measured in Chrome, the
   parent document keeps focus (activeElement stays BODY) even after a click
   lands inside the frame, so Escape mid-session went to the wrapper and
   navigated away — hijacking the game's pause menu. Handing focus to the frame
   as soon as it loads makes the guard true by construction instead of relying
   on the browser to do it, and has the happy side effect that WASD works
   immediately on a cold load without clicking first.
   ========================================================================== */

const frame = document.querySelector('.arena1-frame');

/* Forward the wrapper's query string into the game — ?seed=123 reproduces a
   world, and it is typed against /arena1, not against the internal tree path.
   Done before anything else so the first load is the right one (reassigning
   src just replaces the in-flight request).

   PATH-BASED ROOMS. /arena1/ROOMNAME is the shareable form of ?room=ROOMNAME.
   It works because vercel.json rewrites /arena1/:room([A-Za-z0-9_-]+) to this
   page — a single segment of exactly the characters the pause menu's join
   field accepts, which is narrow enough that it cannot swallow a real file
   under /arena1/: every one of them (arena1.css, arena1.js, refresh-home.js,
   index.html) has a dot, and the pattern has no dot in it. Every asset on this
   page is referenced absolutely, so the deeper URL changes nothing about how
   it loads.
   ?room= is untouched and WINS if both are present: links already shared are
   explicit, and an explicit parameter should never lose to a path the server
   may have rewritten. Uppercased to match the join field, which does
   `.toUpperCase().replace(/[^A-Z0-9-]/g, '')` on whatever is typed. */
const pathRoom = (window.location.pathname.match(/^\/arena1\/([A-Za-z0-9_-]+)\/?$/)?.[1] || '')
  .toUpperCase().replace(/[^A-Z0-9-]/g, '');
const params = new URLSearchParams(window.location.search);
if (pathRoom && !params.has('room')) params.set('room', pathRoom);
const qs = params.toString();
if (qs) {
  frame.src = '/games/arena1/index.html?' + qs;
}

/* The address bar belongs to the wrapper, not the iframe: changing the frame's
   own URL would not move it. The game posts the room it actually landed in and
   this reflects it, so copy-paste from the address bar works and a refresh
   rejoins the same room.
   PRIVATE ROOMS ONLY, by design — see the note in games/arena1/js/main.js. */
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;   // same-origin only
  const msg = event.data;
  if (!msg || msg.type !== 'arena1-room' || typeof msg.room !== 'string') return;
  const code = msg.room.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!code) return;
  const next = '/arena1/' + code + window.location.search;
  if (next !== window.location.pathname + window.location.search) {
    try { window.history.replaceState(null, '', next); } catch { /* file:// etc. */ }
  }
});

function giveGameTheKeyboard() {
  try {
    frame.focus({ preventScroll: true });
  } catch { /* focus can throw in odd embedding contexts; the guard still holds */ }
}

frame.addEventListener('load', giveGameTheKeyboard);
if (frame.contentDocument?.readyState === 'complete') giveGameTheKeyboard();

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  // Only when the wrapper itself holds focus — tabbed out to the exit button,
  // say. While the game has it, this listener is never reached at all.
  if (document.activeElement === frame) return;
  window.location.href = '/';
});
