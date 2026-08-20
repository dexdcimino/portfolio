/* ==========================================================================
   games/_shared/reset-progress.js — "Reset All Player Progress".

   One implementation, four configurations. Every game on this site saves
   something and none of them offered a way out: you played Surveyor once and
   kept its colonies forever, with nothing on screen admitting a save existed.
   That is the whole problem this solves, and solving it four separate times is
   how the four menus start disagreeing about what "reset" means.

   PROGRESS, NOT PREFERENCES. The distinction is the entire contract and it is
   the caller's to declare: `keys` lists what a reset destroys, and everything
   not named there survives. Volume, mute, quality tier, keybinds, zoom, accent
   and track choice are preferences — somebody clearing a save has not asked to
   re-set their volume, and a reset that took it would teach people never to
   press the button again.

   THE ARMED STATE IS ESCAPABLE, and that is not a nicety. A destructive button
   that latches is a trap: you arm it, get distracted, come back, click what you
   think is a normal button and lose everything. So it disarms on Escape, on a
   click anywhere else, on the menu closing, on the tab being hidden, and on a
   timeout. Every one of those is a route back to safety, and they are all
   cheap; the failure they prevent is not.

   WHY THE STYLES ARE INJECTED FROM HERE rather than shipped as a .css file next
   to audio-panel.css: a stylesheet needs a <link> in each game's index.html,
   and one of those files is routinely open in another session. A module that
   brings its own styles can be adopted by editing exactly one file per game.

   NOTE FOR STICKLAND: its build (games/stickland/build.mjs) refuses any import
   that escapes src/, on purpose — it emits one self-contained file for itch.io
   and YouTube Playables. So src/reset-progress.js is a deliberate mirror of
   this file and the two must be kept in step, the same arrangement the 7-accent
   palette already lives under.
   ========================================================================== */

const STYLE_ID = 'greset-styles';

/* Long enough to read the count and think, short enough that an armed button
   never survives you walking away from the machine. */
const ARM_TIMEOUT_MS = 6000;

const CSS = `
/* Below everything, and behind a rule, because the buttons above it are all
   safe to press and this one is not. Deliberately smaller than the real
   actions: it should be impossible to hit while reaching for Resume. */
.greset-wrap{
  margin-top:20px;padding-top:16px;
  border-top:1px solid rgba(255,255,255,.10);
  display:flex;justify-content:center;
}
.greset{
  width:30%;min-width:140px;max-width:280px;
  font:inherit;font-size:11px;line-height:1.35;letter-spacing:.05em;
  text-transform:uppercase;padding:9px 10px;border-radius:9px;cursor:pointer;
  background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.14);
  color:rgba(233,235,236,.58);
  transition:background .14s ease,color .14s ease,border-color .14s ease;
}
/* :not(.is-armed) is load-bearing, not tidiness. The hover selector scores
   three classes and .greset.is-armed only two, so without it the resting hover
   colour wins over the armed one and the warning loses its white label at
   exactly the moment the pointer is on it, which is every moment that matters.
   (No backticks in here: this block lives inside a template literal.) */
.greset:hover:not(:disabled):not(.is-armed){background:rgba(255,255,255,.09);color:#e9ebec}
.greset:focus-visible{outline:3px solid #fff;outline-offset:3px}
/* Armed. Red and white, and it says what it is about to destroy. */
.greset.is-armed{
  background:#C4342A;border-color:#E4594C;color:#fff;
  text-transform:none;letter-spacing:.02em;
}
.greset.is-armed:hover{background:#D53B30;color:#fff}
.greset:disabled{opacity:.42;cursor:default}
@media(prefers-reduced-motion:reduce){.greset{transition:none}}
`;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

const REST_LABEL = 'Reset All Player Progress';

/**
 * Build the reset control.
 *
 * @param {object}   opts
 * @param {string[]} opts.keys      localStorage keys a reset destroys. Empty
 *                                  means this game saves no progress, and the
 *                                  button ships disabled and says so rather
 *                                  than pretending to do something.
 * @param {Function} [opts.describe] () => string|null — what is about to go,
 *                                  in the player's terms ("12 colonies across
 *                                  4 worlds"). Read at ARM time, not at build
 *                                  time, so it is never stale. Anything it
 *                                  throws is swallowed: a broken count must not
 *                                  cost someone the button.
 * @param {Function} [opts.onReset] Runs after the keys are gone. Defaults to a
 *                                  full reload, which is the honest option —
 *                                  see the comment on `finish`.
 * @param {string}   [opts.emptyLabel] What the disabled button says.
 * @returns {HTMLElement} the wrapper; `.disarm()` on it forces a return to rest.
 */
export function createResetProgress({ keys, describe, onReset, emptyLabel } = {}) {
  injectStyles();

  const wrap = document.createElement('div');
  wrap.className = 'greset-wrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'greset';
  wrap.appendChild(btn);

  const has = Array.isArray(keys) && keys.length > 0;
  if (!has) {
    /* No save, so no button that appears to work. It stays visible on purpose:
       the menus are ports of one another and should read the same, and this is
       also the honest answer to "is this game keeping anything about me?" */
    btn.disabled = true;
    btn.textContent = emptyLabel || 'No saved progress';
    btn.title = 'This game saves no progress. Volume, accent and other settings are preferences, not progress.';
    wrap.disarm = () => {};
    return wrap;
  }

  btn.textContent = REST_LABEL;

  let armed = false;
  let armedAt = 0;
  let watch = 0;

  function rest() {
    if (!armed) return;
    armed = false;
    clearInterval(watch);
    watch = 0;
    btn.classList.remove('is-armed');
    btn.textContent = REST_LABEL;
    btn.setAttribute('aria-label', REST_LABEL);
  }
  wrap.disarm = rest;

  function arm() {
    armed = true;
    armedAt = Date.now();
    let detail = null;
    try { detail = describe ? describe() : null; } catch { detail = null; }
    const label = detail ? `Are you sure? ${detail}` : 'Are you sure?';
    btn.classList.add('is-armed');
    btn.textContent = label;
    /* The visible label already changed, but a screen reader is not watching
       the colour — say the consequence out loud. */
    btn.setAttribute('aria-label', `${label} This permanently deletes saved progress. Activate again to confirm.`);

    /* One cheap ticker covers both ways an armed button should stand down
       without anyone touching it: time passing, and the menu that owns it
       being closed. `offsetParent` is null the moment an ancestor is hidden,
       whichever of `hidden`, a class or `display` the game happens to use —
       which is exactly why it is tested rather than the menu's own state. */
    watch = setInterval(() => {
      if (!armed) return;
      if (Date.now() - armedAt >= ARM_TIMEOUT_MS || btn.offsetParent === null) rest();
    }, 250);
  }

  function finish() {
    for (const k of keys) {
      try { localStorage.removeItem(k); } catch { /* private mode, nothing to clear */ }
    }
    rest();
    /* Reload rather than trying to talk the running game back to a fresh state.
       A world, its scatter and its spawn were all seeded at boot from a save
       that no longer exists; reconstructing that in place is a second, subtler
       copy of the game's own startup, and the first time it drifts the player
       is looking at a world that does not match the file. */
    if (typeof onReset === 'function') onReset();
    else location.reload();
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();          // ...or the document listener below disarms it again
    if (armed) finish();
    else arm();
  });

  /* Escape and a click elsewhere are the two things a person already does to
     back out of anything, so they are the two that must work. Both listen in
     the CAPTURE phase and neither consumes the event: Escape still closes the
     menu, and the click still does whatever it was going to do. */
  document.addEventListener('keydown', (e) => {
    if (armed && (e.key === 'Escape' || e.key === 'Esc')) rest();
  }, true);
  document.addEventListener('pointerdown', (e) => {
    if (armed && !btn.contains(e.target)) rest();
  }, true);
  // Coming back to a tab and finding a live delete button waiting is the trap
  // with extra steps.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) rest();
  });

  return wrap;
}
