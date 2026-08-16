# ARENA1_STEPS — build sequence

Pair document to `ARENA1_BRIEFING.md`. Read the briefing first; it holds the
*why*. This holds the *what, in what order, with what proof*. Execute phases in
order. **Hard stop gates after Phase 1 and Phase 3** — report and wait.

**Target:** `games/arena1/` in the portfolio repo, on a branch named `arena1`.
**Reference:** copy `sunspire_fps_v03.html` to `games/arena1/reference/prototype.html`.
It is a playable spec, not source material to import from. It stays out of any
served nav but must remain openable for side-by-side feel checks.

**Report format per phase:** files created/changed, each acceptance item with
pass/fail, anything deviated from spec and why. Terse.

---

## Global guardrails — enforced by scripts, not discipline

Create `tests/guards.mjs` in Phase 0 and run it at the end of **every** phase:

1. No Babylon in the sim. Fails if `BABYLON`, `babylonjs`, or `@babylonjs`
   appears anywhere under `js/sim/`, `js/core/`, or `js/net/`.
2. No wall clock in the sim. Fails on `Math.random(`, `performance.now(`,
   `Date.now(` under `js/sim/`.
3. `js/sim/**` and `js/core/**` must import cleanly in plain Node
   (`node --input-type=module -e "await import(...)"` per file). This *is* the
   headless proof, run constantly.
4. `.gitignore` audit: `git check-ignore -v games/arena1/index.html` must return
   nothing. (The `games/*/index.html` glob already ate Chomp's index once.)

Two conventions with no exceptions:
- Every dynamic entity (player, enemy, cell, projectile if ever) gets a numeric
  `id` from `sim/entities.js` at spawn. The renderer keys mesh pools by `id`.
- All sim randomness goes through `rngFor(seed, ...salts)` — copy
  `js/core/rng.js` **verbatim from Chomp** (mulberry32 + `hashStr` + `rngFor`).

---

## Wire formats — defined once, used everywhere

### Command (client → sim), one per tick per player
```js
{ tick, playerId,
  move: {x, z},          // wish axes, -1..1, already normalized
  yaw, pitch,            // radians, applied locally to camera same frame
  buttons }              // bitfield
// buttons: JUMP=1, DASH=2, SLIDE=4, FIRE=8, GRAPPLE=16, JET=32
```
The sim keeps `prevButtons` per player; `pressed = buttons & ~prevButtons`.
Jump buffer = 7 ticks, coyote = 6 ticks, computed **in the sim** from edges.

### Snapshot (sim → render/peers), emitted every tick
```js
{ tick, seed, pvp,
  players: [{id, pos, vel, yaw, pitch, hp, fuel, fuelMax, dashCharges, flags}],
  enemies: [{id, kind, pos, hp, aiState, flags}],   // kind: 0 blob, 1 wraith, 2 spike
  cells:   [{id, taken}],
  events:  [],             // cleared each tick, see Phase 5
  acks: {playerId: tick} } // WIRE broadcasts only (MD 8): per-client highest
                           // command tick the host has CONSUMED — never a held
                           // repeat. Drives prediction reconciliation; absent
                           // from the sim's local snapshots (net-agnostic).
```
`flags` bitfields: grounded, sliding, dashing, jetting, grappling, wallsliding.
**Platforms are absent on purpose** — mover/blinker/collapser state is a pure
function of `(seed, tick)` plus collapse triggers, which travel as events. Peers
derive platform positions locally. `pos`/`vel` are plain `{x,y,z}`.

Fixed timestep: `SIM_DT = 1/60`. `main.js` runs an accumulator; render
interpolates entity transforms between the last two snapshots by alpha.

---

## Phase 0 — scaffold

1. Create and switch to a branch named `arena1`.
2. Directory tree per the briefing layout, plus `reference/` and `tests/`.
3. Vendor Babylon **9.21.2** (align with Chomp): `vendor/babylon.js` +
   `vendor/VERSION.txt`. No CDN reference anywhere — the `/games/*` CSP is
   `script-src 'self' 'unsafe-inline' blob:` and a CDN load fails as a silent
   `BABYLON is undefined`.
4. `index.html`: canvas, `#hud` DOM root, module script `js/main.js`,
   no-zoom viewport meta.
5. `js/config.js`: the prototype's `TUNE` object **verbatim, every value**, plus
   `SIM_DT: 1/60`, `PVP_DEFAULT: true`, `SNAPSHOT_RATE_NET: 20`,
   `INTERP_BUFFER_MS: 100`.
6. `js/core/`: `rng.js` (copied from Chomp), `events.js` (tiny pub/sub),
   `pool.js`.
7. `tests/guards.mjs` per the guardrails above.
8. **Add `games/*/reference/` and `games/*/dev/` to `.vercelignore`.** Without
   this the prototype and the feelcheck harness ship to production. Match the
   file's existing convention — pattern on `games/*/`, not on one game's name.

**Accept:** `npx serve .` shows a black canvas + HUD shell; guards pass;
`git check-ignore` clean; the two new `.vercelignore` lines present.

---

## Phase 1 — sim skeleton, fixed step, loopback  ⛔ STOP GATE

1. `js/sim/vec.js`: functions over plain `{x,y,z}` — add/sub/scale/dot/cross/
   len/norm/lerp/clone. No classes (snapshots must JSON-serialize).
2. `js/sim/entities.js`: monotonic id allocator, per-type tables.
3. `js/sim/sim.js`:
   `createSim(seed, {pvp}) → { tick, addPlayer(), step(commandsByPlayer), snapshot() }`.
   For this phase the world is one hardcoded floor AABB; gravity + a capsule
   that falls and rests is enough.
4. `js/net/transport.js`: interface `{ sendCommand(cmd), onSnapshot(cb) }` +
   `LoopbackTransport` that owns the host sim locally. **main.js talks only to
   the transport** — solo play is host-with-zero-peers from day one.
5. `js/main.js`: accumulator loop calling `transport` at 60Hz. No rendering of
   the sim yet.
6. `tests/determinism.mjs`: build two sims, same seed, feed an identical 600-tick
   scripted command stream (walk, jump, idle), `JSON.stringify` both final
   snapshots — must be byte-identical. Then change the seed — must differ.

**Accept:** determinism test passes in Node; guards pass.
**Stop. Report. Wait.**

---

## Phase 2 — world: collision shapes + level data

### Shape types (`js/sim/world.js`)
- `aabb {min, max}`
- `obb  {center, half, axes}` — 3 orthonormal axis vectors (covers ramps and
  ring segments; store axes, don't re-derive from angles per query)
- `vcyl {center, r, halfH}` — vertical cylinder
- Each shape: `{id, kind, active, platformId?}`. Broadphase: brute-force with a
  cheap AABB reject. ~150 shapes; do not build a grid unless profiling demands.

### Queries the sim owns
- `overlapCapsule(pos, r, halfH) → contacts[{n, depth, shape}]`
- `raycast(origin, dir, maxLen, mask) → {point, n, shape} | null`
  (serves grapple, shooting, enemy grounding; the render layer may **read**
  this for blob shadows — one-directional reads are allowed)

### Capsule mover — the moveWithCollisions replacement
Substepped depenetration, not swept:
```
substeps = ceil(|disp| / 0.25)
per substep: pos += disp/substeps
  up to 4 iterations: gather overlaps, push out along deepest MTV,
  remove velocity component into each contact normal (slide)
grounded  = any contact n.y > 0.55       → also records groundPlatformId
wallN     = strongest contact |n.y| < 0.35, probed with capsule inflated +0.15
```
Capsule: r 0.4, halfH 0.9 — matches the prototype ellipsoid.

### Level data (`js/sim/level.js`)
`buildLevel(rng)` ports the prototype's arena constants + Ascent generator +
pads/rings/cells/summit, emitting **shapes**, not meshes. Platform shape →
collision approximation table (render still builds the pretty version):

| archetype   | sim collision                                              |
|-------------|------------------------------------------------------------|
| slab        | aabb                                                       |
| hex/oct pad | vcyl                                                       |
| rock chunk  | vcyl (r = avg xz half-extent, halfH from baked bounds)     |
| cross / L   | 2 aabbs                                                    |
| ring        | 8 obb segments around the annulus; hole stays a real hole  |
| dish        | 8–10 rim obb segments + one lowered floor vcyl (the bowl)  |
| ramps       | obb (pitch axis)                                           |
| walls/spire | aabb                                                       |
| jump pads   | vcyl solid + trigger radius                                |

Movers/blinkers/collapsers live in the sim:
- mover `pos(tick) = base + axis * amp * sin(2π·speed·tick·SIM_DT + phase)`;
  shape center updates each tick; players with `groundPlatformId == mover.id`
  get the frame delta added.
- blinker on/off from `(tick·SIM_DT + phase) % 4.5 < 3.0` → `shape.active`.
- collapser FSM (idle→shaking→falling→gone→idle) triggered by a grounded
  contact; the *trigger tick* is a `platform_trigger` event so late-joining
  peers can replay it.

**Accept (all headless, in `tests/world.mjs`):** capsule walks 10s across the
arena without falling through; walks up rampA; falls off the rim edge; stands on
a mover and translates with it; determinism test re-passes with the full level.

---

## Phase 3 — movement port  ⛔ STOP GATE (the milestone)

`js/sim/movement.js`, ported from the prototype's `update()` with the same
structure and **`TUNE` values from config, unchanged**: ground accel/friction,
air accel with the momentum-ceiling clamp, sustained steerable dash, slide +
slide-hop, jump buffer/coyote, walljump + wall-cling, jetpack + fuel + ground
regen, grapple (world pull with reduced gravity + momentum release; mover
anchors ride via `platformId` + local offset), pads, rings, kill floor, summit.
Grapple/shoot targets in this phase: world only (entities come in Phase 5).
**Decision on record: players are never grapple targets in v1.**
*Superseded post-MD 9 on Dex's instruction: the beam used to pass through
players and anchor on geometry behind them, which read as player-grappling —
now it resolves the target's capsule for real (`mode: 'player'`, world-pull
semantics with a moving anchor; the target is pulled toward, never yanked).
Client prediction mirrors remote players into the predict sim as kinematic
ghosts so host and client resolve the same latch.*

### Feel-check protocol — this gate is manual, by Dex
Build `dev/feelcheck.html`: prototype iframe left, new build right, same seed,
flow meter visible on both. Checklist, each within tolerance of the prototype:
1. flat-ground top speed (±0.1 m/s) and time-to-top-speed
2. slide-hop chain ×3 — flow reading after each hop (±0.3)
3. dash: distance covered and post-dash retained speed
4. walljump height and outward carry in the slab alley
5. grapple: release at pendulum bottom → retained speed (±0.5)
6. ramp walk-up at full speed: no jitter, no launch at the crest
7. wall glide: smooth slide along a wall at a shallow approach angle

Items 6–7 are the depenetration-solver parity checks — if they fail, fix the
solver (contact ordering, iteration count, ground snap), **do not** touch TUNE
to compensate.

**Stop. Dex plays both. Nothing proceeds until he signs off the feel.**

---

## Phase 4 — render layer

- `render/scene.js`: engine, lights, sky dome, fog, quality presets (1/2/3
  hardware scaling), FPS/active-mesh readout.
- `render/level.js`: builds meshes **from level data** — including the CSG
  ring/dish visuals, LOD crystals (3 tiers + `L` debug tint), thin-instance
  pebbles. Mesh positions for movers/blinkers/collapsers read platform state
  derived from tick.
- `render/actors.js`: mesh pools keyed by entity id; create/retire on snapshot
  diff; interpolate pos between last two snapshots by accumulator alpha.
- Camera: yaw/pitch applied **locally every render frame** from raw input —
  never routed through snapshots — then written into the next command. FOV
  kicks, roll, bob, slide cam ported here.
- `render/fx.js`: pooled tracers, debris, jet puffs, damage numbers, blob
  shadows (read-only `world.raycast`). Cosmetic jitter may use `Math.random()`
  — render only.
- HUD port: integrity, tank, flow, pips, altimeter, feed.

**Accept:** plays end-to-end solo through the loopback transport;
`dev/feelcheck.html` still passes; 60fps at MED on the dev machine.

---

## Phase 5 — combat + enemies as sim citizens

- `js/sim/combat.js`: FIRE pressed → sim raycasts against level ∪ enemies ∪
  players (segment vs capsule/sphere). Resolution emits events; **PvE and PvP
  share the one path** with a single branch: hits on players apply damage only
  when `sim.pvp` is true.
- Event vocabulary (in `snapshot.events`):
  `hit {shooter, target, point, dmg}` · `kill {target, by}` ·
  `death {playerId}` · `pickup {cellId, playerId}` · `ring {ringId, playerId}` ·
  `pad {padId, playerId}` · `summit {playerId}` ·
  `platform_trigger {platformId, tick}`
  Renderer maps events → hitmark, tracer endpoint, damage number, feed line,
  sound. The renderer never mutates hp, ever.
- `js/sim/enemies.js`: port blob hop / wraith orbit-swoop-climb / spike patrol.
  All timing from tick math, all randomness from `rngFor(seed, 'enemy', id)`.
  Grapple yank on enemies and cells moves into the sim.
- Respawns sim-side; spawn points from level data.

**Accept:** determinism test extended to include 600 ticks of combat against
enemies — still byte-identical. Two local players in one loopback sim (dev
harness, second keyboard-scripted command stream) can damage each other with
`pvp: true` and cannot with `pvp: false`.

---

## Phase 6 — audio, pause, embed contract, wrapper page

- `js/systems/audio.js`: port every synth recipe verbatim, but all voices route
  through **one master `GainNode`**. Export `setVolume/getVolume/setMuted/
  isMuted`; persist under `arena1-volume` / `arena1-muted`; mute independent of
  volume.
- State machine gains `paused`; the game owns Escape; pause menu binds no keys.
- Pause menu: volume, quality, PvP toggle (writes the sim flag at match start,
  not mid-match), accent picker — `SITE_ACCENTS` copied **byte-identical** from
  `ACCENTS` in the site's `script.js` at build time, writing `dex-accent-name`.
- `window.Arena1 = { pause, resume, setSafeTop }` — exact names.

### Wrapper page at `/arena1` — net-new, not in the original plan

The games-list row currently has `href="#"`; there is no wrapper. Build one from
the **Chomp** counterparts, which are the proven precedent:

```
arena1/index.html   arena1/arena1.css   arena1/arena1.js   arena1/refresh-home.js
```

Carry the comments over — they record measured behaviour that still applies:
root-absolute paths (Vercel serves both `/arena1` and `/arena1/` with no
redirect), external scripts only (root CSP is `script-src 'self'`), focus the
iframe on load (key events do not cross the frame boundary, and without this
Escape navigates away instead of reaching the game), reload bounces home. Exit
chip `.arena1-exit`: 48px, top-right, `z-index:2147483647`, 44px on mobile.

The iframe `src` is `/games/arena1/index.html`. **The games-list row points at
`/arena1` — the wrapper — not at `games/arena1/`.** Repoint the existing row in
place; do not add a second one.

**Accept:** embedded page passes the same manual checks Stickland/Chomp did:
loads styled at both `/arena1` and `/arena1/`, zero CSP violations, WASD works
on a cold load with no click first, Escape reaches the game's pause menu rather
than navigating home, pause/resume from the wrapper, safe-top inset respected,
volume persists across reload, accent picker matches the site.

---

## Phase 7 — Photon transport

`js/net/photon.js` implementing the **same transport interface** as loopback:
- host: runs the authoritative sim, consumes remote commands, broadcasts
  snapshots at `SNAPSHOT_RATE_NET` (20Hz).
- client: sends commands at 60Hz (batched per network tick), keeps an
  `INTERP_BUFFER_MS` (100ms) snapshot buffer, renders remote entities from the
  buffer, renders the local player from immediate prediction-free local echo
  (v1: no reconciliation — accept the input delay on non-host, per the
  briefing's stated ceiling).
- Join flow: room name only. No lobby, no matchmaking, no lag comp.
- Loopback remains the solo path; the switch is a boot flag.

**Accept:** two browser windows, host + client: client sees the host move
smoothly; PvP damage lands both directions; co-op toggle blocks it; host
refresh ends the match cleanly rather than hanging the client.

**Plus, and this one is expected to fail:** the non-host player's *own*
movement feels responsive. Without prediction there is a full round trip of
input delay on dash, slide, and walljump — in a movement FPS that is the
difference between good and unplayable. The other criteria only test how the
*host* looks to the client, which is the easier half. Report the result
honestly rather than passing it on a technicality: if non-host movement feels
bad, that is the finding, and it means client-side prediction is a v1
requirement rather than a later refinement.

---

## Out of scope for this document
Reconciliation/prediction tuning, dedicated Fly.io server, spectators, more
guns, players-as-grapple-targets (v1.1 candidate), mobile input. All sit on top
of the seam this builds.
