# STICKLAND — Architecture

Stick-figure open world extracted from a note-taking app ("DexNote") into a
self-contained single-file build. Canvas 2D, no engine. Its own `CLAUDE.md`
here carries the non-negotiables (lose zero features, no Firebase, physics
untouched, multiplayer gated off); `BUILD.md` documents the original port —
it is history, not current state.

## The build story (the part every session trips on)

`node build.mjs` reads `src/index.template.html`, inlines `src/game.css`, and
embeds every module verbatim (JSON-quoted) plus a bootstrap that recreates
real ES-module semantics at runtime via per-module `blob:` URLs in
topological order — because browsers refuse module *files* over `file://`.
No bundler, no transpile. Circular `character.js ↔ playmode.js` dynamic
imports go through the `window.__DEXMODS` registry.

- **`games/stickland/index.html` is generated and gitignored.** The shipped
  copy is `v1/index.html` — copy it there after building or the site keeps
  serving the old build. **Never hand-edit either.**
- Output is ~1.06 MB, one file; assets (`v1/music/`, `v1/sfx/`) live beside
  it. Served at `/games/stickland/v1/`, wrapped by `/stickland`.

## Modules (`src/`)

- `main.js` (38 lines) — the whole boot: shims → chat-picker → audio →
  platformer (side effects), `startAccentWatch()`, `initCharacter()`,
  `initPlayMode()`, then rAF **and** a 300 ms timeout race into `_boot`
  (rAF alone starves in occluded windows — found under headless testing)
- `character.js` (~8k lines) — physics, stick-figure + weapon SVG rendering,
  inventory, hotbar, hoverboard, creatures, cosmetics. **Owns the only RAF
  loop**; everything else is ticked from it
- `playmode.js` (~7k lines) — open world: world gen, camera, buildings, tank,
  creature AI, chat, Photon glue, keybinds. `tickPlayMode()` called from
  character.js's frame
- `platformer.js` — platformer mode; deterministic *and stateless* (ground,
  platforms, movers are pure functions of position/cell/clock)
- `pausemenu.js` — the origin of every other game's pause menu; never binds
  Escape itself (playmode's Escape ladder drives it)
- `audio.js` — the only module touching AudioContext; synth core + sampled
  overlay; its own sfx/ui/amb buses (predates `games/_shared`)
- `music.js` — deliberately temporary audition player (12 CC0 tracks)
- `accent.js`, `shims.js`, `storage.js`, `config.js` (`MULTIPLAYER = false`),
  `chat-picker.js` + `emoji-data.js`, `photon-client.js` (vendor-ish, do not
  modify; Photon APP_ID lives here)
- `_reference/` — source-to-port-from, never shipped: `emoji.js` and lines
  2835–2950 of `infochips.js` are the only parts that matter

## Shapes and rules

- World objects `{id, type, x, y, seed, …}` persisted whole under
  `localStorage['sfg-world']` with `WORLD_GEN_VERSION` (currently 8) — bump
  it on ANY change to `generateWorld()` output or returning players keep the
  stale world
- Physics state is screen-space; play mode shifts the *world* past the
  camera deadzone instead of moving the character
- Multiplayer packet: `{x, y, animState, phase, flipX, vy, chargeT, stunSev,
  hoverboard, weapon, username, hex}`
- Determinism: `seededRand(42)` LCG consumed in fixed pass order; placement
  rejection **skips, never rerolls**

## Key numbers

World 7200×4500, spawn (3600, 2250); village row at y=2130. Tuned at
`REFERENCE_FPS = 240` — all motion dt-scaled from that. `GRAVITY = 0.18`.
Camera deadzone 0.20. Caps: 7 birds, 5 yaks. 10 weapons.

## Known-outstanding

Multiplayer wired but dark (`MULTIPLAYER = false`). `music.js` is an audition
rack awaiting a final pick. BUILD.md's file table is stale against src/
(audio/music/platformer/pausemenu landed after the port).
