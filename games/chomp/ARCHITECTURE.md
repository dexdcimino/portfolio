# CHOMP — Architecture

Top-down cave eater: grow through five evolution stages by eating food and
smaller enemies in an endless deterministic cave. Babylon.js 9.21.2 vendored
(site CSP has no CDN). Logic and visuals are strictly split: entities and
systems are plain objects with zero Babylon; `visuals/factory.js` is the only
path from logic to meshes.

## Modules (`js/`)

- `config.js` — every tunable; "no magic numbers anywhere else, ever"
- `main.js` — boot, render loop, state machine (`title|playing|paused|dead`),
  input, death cinematics, `window.Chomp` embed hooks
- `pausemenu.js` — self-contained pause menu (ported from Stickland; see
  `INTEGRATION-NOTES.md` — the list of local edits a fresh game drop must
  re-apply by hand)
- `core/` — `events.js` pub/sub, `pool.js`, `rng.js` (`rngFor(seed, tag, …)`
  — FNV-1a → mulberry32, fully deterministic)
- `data/` — stages (5), foods (9), enemies (+ the THREAT RULE: predator only
  while its radius > player's), biomes (rings by distance from origin)
- `entities/player.js` — pure logic: movement, chomp lunge, squeeze, growth
- `entities/food.js`, `entities/enemy.js` — instances live in chunk records;
  visuals mount only within `eat.activeRadius`
- `systems/` — `combat.js` (eat/evolve/death), `morph.js` (produces
  `morphState`, "THE feel"), `camera.js` (tilted follow rig + zoom persist +
  spawn-framing guard), `hud.js`, `audio.js` (shared bus graph + samples),
  `abilities.js` + `fx.js` (**stubs, deliberate TODO**)
- `visuals/` — `factory.js` (MANIFEST key → `{root, setPose, dispose}`,
  pooled; `flushPlayerPools()` for accent swaps), `manifest.js` ("THE SWAP
  FILE" — the only file to touch to swap art), `loaders/glb.js` (GLB with
  instant procedural fallback), `proc/*` (procedural placeholders;
  `CHOMP_PALETTES` keyed by site accent)
- `world/` — `carve.js` (pure noise carve: `carveChunk(seed,cx,cz) →
  Uint8Array(N*N)`, 0 open / 1 wall), `chunks.js` (`ChunkManager` — one
  merged wall mesh + ground + water + decor per chunk, occlusion fading),
  `spawner.js` (per-chunk population, deterministic)

## Shapes that cross boundaries

- Chunk record `{cx, cz, grid, wall, ground, water, decor, border, overlay,
  foods, enemies}` keyed `'cx,cz'`
- Player: plain object (`x, z, vx, vz, mass, stage, hp, chomp, stamina, …`);
  `playerRadius(p) = STAGE_RADII[stage-1] * growthScale(p)`
- `morphState` `{stretch, squash, mouthOpen, bank, bob, breathe, facing,
  tint, alpha}` — consumed by every visual's `setPose`
- Visual handle `{root, setPose(morphState), dispose()}` — the factory
  contract
- Embed hooks: `window.Chomp = {pause, resume, setSafeTop}` (same contract as
  the other games' wrappers expect)

## Call flow

Boot: `?seed=` (default `Date.now()%1e6`), engine + fog from `biomeAt(0)`,
then ChunkManager → factory → player → morph → camera → food/enemy systems →
HUD → audio (subscribes to events only — the AudioContext is not built until
first user gesture, or everything played into it is lost). Per frame:
`update(dt)` (player → combat → morph → visuals → systems → chunk ensure/
occlusion → fog lerp) then `scene.render()`; `dt` clamped at 0.1 s, slow-mo
0.25×, death 0.45×.

## Key numbers (all in `config.js`)

Chunks 32×32 cells of 1 unit, load radius 2 / dispose 3. Stages at mass
0/20/60/150/350, radii 0.35→2.0, speed mult 1→2.4. Chomp: 0.35 s, ×2.6
speed, 0.9 s cd. Hunger 0.4 mass/s. Biome rings: Fungal 0–80, Ember 80–200,
Frost 200–350, Void 350+ (blend width 40). Enemy activation radius 40, max
active 18. Camera pitch 58°, distance by stage 5.5→15, zoom clamp 1.0–2.0
(floor raised deliberately). Audio mix boots at 0.80/0.50/0.70 — NOT the
shared module's defaults, which multiply out to silence here.

## Known-outstanding

`systems/abilities.js` and `systems/fx.js` are stubs on purpose. Player and
enemy art are procedural placeholders behind the GLB loader; swapping art
touches `visuals/manifest.js` only. Every hand edit made to this drop is
logged in `INTEGRATION-NOTES.md` — keep it current if you touch the drop.
