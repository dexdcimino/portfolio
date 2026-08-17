/* ==========================================================================
   /surveyor — wrapper behaviour. Two small things, both about the keyboard.

   The game runs in the iframe and owns its own Escape ladder (inventory ->
   pause menu -> ...). Key events do not cross a frame boundary, so once the
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

const frame = document.querySelector('.surveyor-frame');

function giveGameTheKeyboard() {
  try {
    frame.focus({ preventScroll: true });
  } catch { /* focus can throw in odd embedding contexts; the guard still holds */ }
}

frame.addEventListener('load', giveGameTheKeyboard);
if (frame.contentDocument?.readyState === 'complete') giveGameTheKeyboard();

/* NOTHING ELSE. An earlier version of this file also called
   giveGameTheKeyboard() from a capture-phase `pointerdown` on the window, to
   guarantee focus after any click. That is the classic "first click is eaten to
   hand focus to the frame" bug and it cost a real one: clicking "Begin survey"
   did nothing while Enter and Space started the game fine — the button had
   focus, so the keyboard reached it, but the pointer sequence did not survive
   a focus() landing in the middle of it.
   The load handler above is sufficient and is what /stickland has shipped all
   along; the MD for this integration said to use Stickland's solution, and the
   extra listener was me adding to a pattern that was already correct. */

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  // Only when the wrapper itself holds focus — tabbed out to the exit button,
  // say. While the game has it, this listener is never reached at all.
  if (document.activeElement === frame) return;
  window.location.href = '/';
});
