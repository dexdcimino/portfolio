# BUILD.md — Standalone Stick Figure Game

You are converting a game that was embedded inside a note-taking app ("DexNote")
into a standalone game for a portfolio site. The source files in `src/` are
**verbatim copies** from that app. They still contain notes-app coupling.
Your job is to cut that coupling without losing a single game feature.

**You do not have access to the original app. Everything you need is here.**

---

## Ground rules

1. **Lose nothing.** Every weapon, every cosmetic, the hoverboard, the tank,
   creatures, the world, chat, every keybind. If you can't cleanly port
   something, keep it working the ugly way rather than deleting it.
2. **The game is procedural.** Zero images, zero sprites, zero audio. World is
   Canvas 2D; character and all weapons are inline SVG strings. Don't go
   looking for asset files — there are none.
3. **`character.js` owns the render loop.** `playmode.js` has no RAF of its own;
   `character.js`'s `_frame()` calls `tickPlayMode(vx, vy, dt)`. Physics is tuned
   to a 240Hz reference (`REFERENCE_FPS = 240`) with `_dt` scaling. Do not
   restructure the loop or retune constants.
4. Work in small commits. After each phase, load the page and confirm it still runs.

---

## Files

| File | Lines | Notes |
|---|---|---|
| `src/character.js` | 7572 | Physics, character rendering, weapons, inventory, hoverboard, creatures, DXAV cosmetics customizer, presence. **~40% is notes-app code to delete.** |
| `src/playmode.js` | 5967 | World, camera, buildings, tank, creature AI, chat, death screen, Photon glue |
| `src/photon-client.js` | 254 | Multiplayer transport. Already standalone — **do not modify.** |
| `src/game.css` | 514 | Was `playmode.css`. Lines 265–357 are notes-app UI — delete. |
| `public/photon-realtime-module.js` | vendor | Photon SDK, sets `window.Photon` |
| `index.html` | — | Already written. Game DOM only. |
| `_reference/emoji.js` | 521 | Chat `:` emoji autocomplete — port whole (Phase 4) |
| `_reference/infochips.js` | 3999 | **Only lines 2835–2950** = the `/` command picker. Everything else is notes-app — ignore it. |

`_reference/` is source-to-port-from, not source-to-ship. Nothing there gets
imported directly; you lift the pieces you need into `src/chat-picker.js`.

New files you create: `src/main.js` (entry), `src/config.js`, `src/accent.js`,
`src/shims.js`, `src/storage.js`, `src/chat-picker.js`.

---

## Phase 0 — The world (nothing to do)

The original loaded world objects from a Firestore doc. **Don't reimplement that.**
`generateWorld()` (`playmode.js:182`) is fully deterministic — `seededRand(42)`,
fixed counts (80 grass / 40 rock / 60 shrub / 20 tree), buildings at fixed offsets
from `WORLD_W/2`. Firestore only ever held that function's output plus the
auto-migrations at `playmode.js:5062-5110`, which this code still runs. There was
no world editor.

So: delete `_loadOrGenerateWorld()`'s Firestore branch and call `generateWorld()`
directly, then persist to localStorage so in-game changes survive reload.

World is **7200 × 4500** (`WORLD_W` / `WORLD_H`, `playmode.js:161-162`).

---

## Phase 1 — Cut the imports (start here, it's the smallest)

`playmode.js` lines 5-7 and `character.js` lines 6-9 are the only static edges.

**Delete these imports and replace with local stubs:**

| Import | Where | Replace with |
|---|---|---|
| `isGuest` from `./auth.js` | playmode.js:5 (used at 5046), character.js:6 (used at 7315) | `const isGuest = () => false` |
| `_activeSessionId`, `_sessions` from `./state.js` | playmode.js:6 (used 5154/5157/5181) | Constant room id from `config.js`. Only used to name a Photon room. |
| `getApps` from `firebase/app` | character.js:7 | Delete |
| all of `firebase/firestore` | character.js:8-9 | Delete |
| `initPhoton`… from `./photon-client.js` | playmode.js:7 | **Keep.** Gate the calls, not the import. |

**Dynamic imports to remove:**
- `playmode.js:5035-5036` — firebase, for `worlds/default`. Replace with `world.json` + localStorage (Phase 3).
- `character.js:1541` — firebase `getDoc` for cosmetics. Replace with localStorage.
- `character.js:1604` — `./sessions.js` → `onSessionDropdownOpen`. **Delete, pure notes UI.**
- `character.js:7319` — `firebase/auth` → `getAuth`. Delete.
- `character.js:5677, 5793, 7546` and `playmode.js:5216` — these import each other. **Keep them**, they're internal.

When done, `grep -i firebase src/` must return nothing.

---

## Phase 2 — Delete the notes-app body

### `character.js` — the character used to walk around the notes UI

It treats sidebar elements as collidable platforms. None exist now. Delete every
branch touching these ids (47 references total):

- `#sb-wrap` — collision — lines ~217, 2512, 3303, 4863, 6019, 6037, 6120, 7055
- `#sb-foot` — platform — lines ~237, 338, 3750, 6004-6007, 6744-6774
- `#sb-archive-hdr` / `#sb-archive-body` — platforms — ~244, 7073
- `#rail-add-btn` — ~226
- `#community-feed` — visibility gate — ~6249
- `#hdr`, `#sb-tab`, `#rail-sess-btn`, `#sess-grid-popup`, `#acct-name`,
  `#acct-name-short`, `#acct-char-toggle`, `#cv-add-btn`, `.fmt-btn`, `#emoji-pick`

**Careful:** the character must still collide with the *world* ground and
buildings (that logic lives in `playmode.js` via `getBuildingPolygons()` /
`getHomeScreenBounds()`). Only strip the DOM-element collision.

Also delete:
- **Firestore presence, `character.js:6987-7116`** — `sessions/{id}/presence/{uid}`
  setDoc/onSnapshot/deleteDoc. Fully redundant; Photon already does presence.
- `window._dexHathoraSendAppearance` — dead, defined nowhere.

### `src/game.css`
- Delete lines **265–287** (`.icon-btn[data-action="theme"]` arc animation)
- Delete lines **288–357** (`.hdr-collapse-wrap` / `.hdr-collapse-drop`)
- **Keep lines 228–264** (`#ic-cmd-pick`) — that's the in-game chat command picker.
- Add: `@media (max-width:768px){ #play-btn-stack{display:none !important} }`

### `src/game.css` — accent
Replace every hardcoded accent hex with `var(--accent)`. The host page defines it.

---

## Phase 3 — `src/storage.js` (replaces all Firestore)

Three things persisted remotely; all become localStorage:

```js
// world objects — seed from generateWorld() on first run
'sfg-world'      // was worlds/default            (playmode.js:5034-5127)
'sfg-cosmetics'  // was users/{uid}.cosmetics     (character.js:1541, 1553)
'dexnote-hotbar' // already localStorage          (character.js:2138) — keep key
'dexnote-keybinds' // already localStorage        (playmode.js:5214)  — keep key
```

Export `loadWorld()` / `saveWorld(obj)` / `loadCosmetics()` / `saveCosmetics(obj)`.
`loadWorld()` falls back to `generateWorld()` (see Phase 0).

---

## Phase 4 — `src/shims.js` (the `window._dex*` bridge)

Both game files talk to the notes app through ~60 `window._dex*` globals.
**Most are internal** (both ends inside the game) — leave those alone.

Only these were defined *outside* the game and need shimming. Define them in
`shims.js`, imported first in `main.js`:

```js
window._dexUnlockAch     = () => {};      // achievements — no-op (6 call sites)
window._dexUserLevel     = 99;            // gates weapon unlockLevel — all unlocked
window._dexAvatarEnabled = true;
window._dexBloodEnabled  = true;
window._dexUpdateRailSessionBtn = () => {};   // notes UI
window._dexRefreshPlayPopupRow  = () => {};   // notes UI
```

**Delete outright:** `window._dexOnSessionSwitchInPlayMode` (consumed only by the
notes app's sessions.js).

**Chat pickers** — port both into `src/chat-picker.js` from `_reference/`. Nothing is lost.
- `_dexOpenChatCommandPicker`, `_dexCloseChatCommandPicker`,
  `_dexHandleCmdPickerNav`, `_dexGetActiveCmdItem`
  → Lift from `_reference/infochips.js` **lines 2835–2950**. A `/`-command dropdown
    driven by `#ic-cmd-pick` (already in index.html; CSS in `game.css:228-264`).
    Cross-check the command list against `_dexExecuteChatCommand` in `playmode.js`.
- `_dexOpenChatEmoji`, `_dexCloseChatEmoji`, `_dexHandleEmojiNav`,
  `_dexSelectActiveEmoji`, `_dexBumpEmojiFreq`
  → Port `_reference/emoji.js` (521 lines) whole. Drives `#emoji-pick` (already in
    index.html). Strip only the note-editor insertion path; keep the chat path.

---

## Phase 5 — `src/accent.js` (the color system)

The host portfolio site owns the accent color. Single source of truth:

```js
export function getAccent() {
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim() || '#68d121';
}
```

- Route every game accent read through `getAccent()`.
- Replace `window._dexUpdatePlayModeColor` with a `MutationObserver` /
  `requestAnimationFrame` check that re-reads `--accent` and repaints.
- The character's own body color comes from DXAV cosmetics — that stays
  independently choosable. Accent drives HUD, bars, chips, UI chrome, nametag.

---

## Phase 6 — `src/config.js` + `src/main.js`

```js
// config.js
export const MULTIPLAYER = false;   // flip to true to enable Photon
export const ROOM_ID = 'portfolio-freeplay';
```

Guard every `photon*()` call in `playmode.js` with `if (MULTIPLAYER)`.
Leave `photon-client.js` untouched. With the flag off: zero network calls,
`#play-connection-hud` stays hidden.

```js
// main.js
import './shims.js';
import { initCharacter } from './character.js';
import { initPlayMode, enterPlayMode } from './playmode.js';

initCharacter();
initPlayMode();
requestAnimationFrame(() => enterPlayMode());   // boot straight into the game
```

The original launched play mode from a sessions-popup button (`sessions.js:2825`).
Here it boots directly. `#char-overlay` is created at runtime by
`character.js:7312` — index.html already reserves the z-index for it.

---

## Phase 7 — Re-home the cosmetics customizer

**Do not lose this. Clothes, hats, colors, the whole DXAV customizer.**

The rendering logic is entirely in `character.js` (`_dxavState`, `_dxavRender`,
`_dxavHotbarMigratedV2`, wired at ~1607-1611, 2046, 5371). Only its *host
container* was the notes-app account dropdown.

`index.html` already provides `#dxav-panel` with the same child ids
(`#dxav-title`, `#dxav-tabs`, `#dxav-content`, `#acct-backpack-slots`), so the
existing wiring works unchanged. You need to:

1. Delete the `#acct-char-toggle` / `#acct-char-panel` open/close handlers.
2. Add an in-game open/close: **C key**, plus a small gear button in the HUD.
3. Style `#dxav-panel` as a centered floating modal (it was a dropdown body).
4. Pause game input while it's open — reuse `window._dexPausePlayInput`.
5. Persist selections via `saveCosmetics()` from Phase 3.

---

## Do not touch

- `REFERENCE_FPS`, `_dt` scaling, or any physics constant
- `GUN_TYPES` (`character.js:2073`) and `INVENTORY_ITEMS` (~2114-2125) — pistol,
  shotgun, sniper, rocket, SMG, hammer, gamma laser, puffer launcher, spellbook,
  bow. Set `unlockLevel` reachable, change nothing else.
- Laser constants ~2189-2191, bow ~2505-2509
- Hoverboard: `HOVER_SPEED_MULT`, `HOVER_BOOST_MULT`, `HOVER_FLOAT`, mount/dismount
  durations (~2196-2201)
- Creature caps `MAX_BIRDS=7`, `MAX_YAKS=5` (~4296-4300)
- `photon-client.js`
- Keybinds: WASD/arrows, Space, Shift, E, 1-5, B/I, T/Enter, ESC, Y (rebindable,
  `_keybinds` at `playmode.js:104`)

---

## Creative pass (only after everything above works and is committed)

Allowed, in this order of safety: HUD polish, better death/respawn feel, a
minimap, particle/juice on hits, a title screen. **Nothing that changes physics
feel, weapon balance, or world layout.** Commit the faithful port first.

---

## Verify

```
npx serve .
```

- [ ] Boots straight into the world, no console errors
- [ ] `grep -ri firebase src/` → empty
- [ ] Network tab: zero requests beyond the local files + the font
- [ ] Walk, run, jump, double-jump; hoverboard mounts and boosts
- [ ] All 10 weapons cycle and fire; bow charges; rocket + gamma laser render
- [ ] Inventory (5/B/I) opens, inv2 columns page with chevrons
- [ ] Cosmetics panel opens, hat + clothes change, survives reload
- [ ] Change `--accent` in devtools → HUD/bars recolor live
- [ ] Tank enter/exit (E), fires
- [ ] Creatures spawn, can be hit and carried
- [ ] Chat (T/Enter), `/` command picker works
- [ ] Death screen → respawn
- [ ] World renders: grass/rock/shrub/tree scatter, home + treehouse + castle + shop + jail in a row, tank left of home
- [ ] Emoji `:` autocomplete works in chat
