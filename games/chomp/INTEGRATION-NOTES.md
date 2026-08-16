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

Nothing else under `js/` or `css/` is modified. `docs/` and `CLAUDE.md`
were deleted (authoring docs, not servable content).
