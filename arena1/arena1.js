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

// Forward the wrapper's query string into the game — ?seed=123 reproduces a
// world, and it is typed against /arena1, not against the internal tree path.
// Done before anything else so the first load is the right one (reassigning
// src just replaces the in-flight request).
if (window.location.search) {
  frame.src = '/games/arena1/index.html' + window.location.search;
}

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
