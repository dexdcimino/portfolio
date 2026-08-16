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
     defaulting to **2.0 — full zoom-out — per Dex**, listens for the
     `chomp-zoom` window event the pause menu dispatches, and calls
     `retarget()` + snaps `cam.radius` at creation — without that the boot
     multiplier never reached the camera (retarget only ran on stage change).
     The pause menu overlay also sets `pointer-events:auto` on `#paused`
     (the game's `#hud` is `pointer-events:none`, which was letting menu
     clicks fall through to the canvas and resume the game).

4. `js/visuals/proc/chomp.js`
   - `CHOMP_PALETTES`: the player's body/eyes/horns/tufts colours are keyed by
     the site accent (`dex-accent-name`), resolved at every build, plus a
     `chomp-accent` window listener that retints the live materials (fur is
     vertex-baked, so mid-game it tints by channel ratio and becomes exact on
     the next stage rebuild).

5. `js/visuals/factory.js`
   - `flushPlayerPools()` added and exported: `dispose()` releases visuals to
     a pool and `mount()` recycles them, so an accent change must destroy the
     pooled player records or the old colours come straight back.

6. `js/main.js` (beyond the embed MD's edits)
   - `chomp-accent` listener: `playerVisual.dispose()` -> `flushPlayerPools()`
     -> `mountPlayerVisual()` — order matters, the live visual must be pooled
     BEFORE the flush or mount pops it back out — then places and scales the
     fresh visual immediately: the update loop is not running while paused,
     so an unplaced mount sits at the world origin until resume.

7. `js/systems/camera.js` (beyond note 3)
   - Scroll-wheel zoom (persists `chomp-zoom`, emits `chomp-zoom-sync` for the
     menu slider), instant radius set on menu scrub (the update loop is not
     running while paused), and a spawn-framing guard: for the first 0.6s,
     raycast camera->player against `wall_*`/`rocks_*` and yaw to a clear
     angle — the occlusion fader only dims `wall_*` chunks, so tall rock
     formations could block the spawn view.

8. `js/visuals/proc/chomp.js` (beyond note 4)
   - Palette v2: per-accent body/eyes/horns/tuftBase/tuftTip, two-tone fur
     (tip cones wear tuftTip), resolved at every build so every stage wears
     the accent. Live change is handled by rebuild (note 6), not retinting.

Nothing else under `js/` or `css/` is modified. `docs/` and `CLAUDE.md`
were deleted (authoring docs, not servable content).
