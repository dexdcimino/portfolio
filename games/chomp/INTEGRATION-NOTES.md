# Integration notes — edits made inside games/chomp/

The next game drop-in must re-apply everything below by hand. Keep this list
current; keep it short by keeping the edits few.

1. `index.html`
   - The placeholder `#paused` overlay content (`PAUSED / Esc / P to resume`)
     is emptied; `js/pausemenu.js` fills it at boot. The element, its id and
     its `overlay hidden` classes are unchanged — `setState`/`syncHud` still
     own show/hide.
   - One added tag after the main module:
     `<script type="module" src="js/pausemenu.js"></script>`

2. `js/pausemenu.js` — NEW file, self-contained (injects its own styles).
   Copy it into the next drop verbatim. It imports
   `./systems/audio.js` (`setVolume/getVolume/setMuted/isMuted`) and calls
   `window.Chomp.resume()`; if either contract changes, this file is the
   only consumer to update.

3. `js/systems/camera.js`
   - `zoomMult` boots from localStorage `chomp-zoom` (clamped 0.5–2),
     defaulting to **2.0 — full zoom-out — per Dex**, and listens for the
     `chomp-zoom` window event the pause menu dispatches.

4. `js/visuals/proc/chomp.js`
   - `CHOMP_PALETTES`: the player's body/eyes/horns/tufts colours are keyed by
     the site accent (`dex-accent-name`), resolved at every build, plus a
     `chomp-accent` window listener that retints the live materials (fur is
     vertex-baked, so mid-game it tints by channel ratio and becomes exact on
     the next stage rebuild).

Nothing else under `js/` or `css/` is modified. `docs/` and `CLAUDE.md`
were deleted (authoring docs, not servable content).
