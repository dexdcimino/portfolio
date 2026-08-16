# BRIEFING — Arena 1: prototype → shippable, multiplayer-ready

Read this before touching `sunspire_fps_v03.html`. It is an assessment plus the
target architecture. Steps come after, in a separate MD.

**Name:** ships as **Arena 1** — the site already lists it, so the games-list row
gets repointed in place, not added. "Sunspire" stays a working title inside the
prototype only.

**Modes:** co-op **and** PvP, PvP toggled on by default.

---

## What exists

One file, 1420 lines. Babylon 8.20.0 from cdnjs. Movement is genuinely good —
walk/air accel, dash with cooldown, slide, wall-jump, jetpack with fuel, grapple.
Plus enemies, moving platforms, jump pads, boost rings, a vertical "Ascent"
section, procedural WebAudio, LOD crystals, blob shadows, and a flow/combo HUD.
`TUNE` centralises ~25 movement constants.

**The feel is the asset.** `TUNE`'s values and the FX/audio timings are
hard-won — they carry across verbatim. Nothing below is a criticism of the
prototype as a prototype.

v03 added content (audio, the Ascent, boost rings), not structure. The
architecture is identical to v02: 6 `pickWithRay` sites, 27 `Math.random()`
calls, one variable-dt loop.

---

## The verdict: rebuild the sim, keep the prototype as reference

This cannot be incrementally refactored into a multiplayer-ready shape — not
because the code is bad, but because of one decision that runs through
everything.

### The blocker: the scene graph *is* the physics engine

`scene.pickWithRay` currently resolves ground checks, wall checks for wall-jump,
grapple attachment, shooting, and enemy ground-snapping. Every one asks *the
renderer* where the world is. There is no world model independent of meshes:
`player.position` is a mesh transform, enemies are `e.root.position`.

That makes the foundational multiplayer rule impossible: **the sim must run
headless, with no scene attached.** A sim that needs a WebGL context to know
whether you are standing on the floor can never be authoritative, can never
validate a client's claim, and can never lift onto a server.

### Why co-op + PvP removes every shortcut

A staged port — move movement behind the seam, leave `pickWithRay` for combat
temporarily — was the fallback option. **Both modes together kill it.**

- **PvP means the sim owns player-vs-player damage.** Client-reported hits are
  not acceptable once players shoot each other. Combat must be sim-resolved from
  the first commit, not migrated later.
- **Co-op means enemy AI is sim-owned too**, not throwaway. Enemy position,
  targeting, and damage all have to be authoritative and identical on every
  client.

Together: everything in the world lives in the headless sim. There is no subset
that can stay coupled to the renderer.

### Three smaller problems, same root

1. **No fixed timestep.** `runRenderLoop` calls `update(dt)` with a clamped frame
   delta, so 60fps and 144fps clients produce different physics. Also `if
   (locked) update(dt)` — the sim stops when the pointer unlocks. Fine solo,
   wrong the moment another player is in the match.
2. **`Math.random()` in 27 places**, several gameplay-relevant: enemy spawn
   position and timing, pad placement, enemy hop cadence. All must go through
   seeded RNG or clients disagree about the world.
3. **`performance.now()` read inside `update()`** for platform motion. Platform
   positions must derive from the sim's tick count, not wall clock.

---

## Target architecture

### Three layers, strictly one-directional

```
input  →  SIM (headless, deterministic, fixed-step)  →  state snapshot
                                                             ↓
                                                      RENDER (Babylon)
```

- **Sim never imports Babylon.** Not for `Vector3`, not for anything. Own the
  math or use plain `{x,y,z}`. The moment Babylon appears in a sim file the
  headless property is gone and nobody notices for months.
- **Render never writes sim state.** It reads snapshots and draws them.
- **Collision is the sim's own broadphase + shapes**, not `pickWithRay`. Level
  geometry becomes data — AABBs, planes, capsules — that both the sim and the
  mesh builder consume. Meshes are built *from* the collision data, not the
  reverse.

### Fixed timestep

Sim at a fixed 60Hz with an accumulator; render interpolates between the last two
sim states. Do this on day one, single-player, before any networking exists. It
is what makes remote players look smooth later, and adding it after the renderer
is written means rewriting the renderer.

### Input as commands

A frame's input becomes serialisable: `{tick, move:{x,z}, yaw, pitch,
buttons:bitfield}`. The sim consumes commands. Solo play is the host case with
one local command stream and zero remote peers.

**Do not let solo mode bypass the seam.** If single-player mutates state directly
and networking is bolted on later, every desync assumption surfaces at once.

### Shooting — the FPS-specific one, and now PvP-critical

Currently: click → raycast → mutate enemy → show hitmark. Instant, fused.

Target: click → fire command → sim resolves against its own collision → sim emits
a `hit` event → renderer plays hitmark, impact FX, damage number.

Identical to play solo. Correct for PvP without modification. Reversed, combat
gets rewritten the moment players can damage each other.

### Entity IDs

Every networked entity gets a stable numeric ID from the sim at spawn — not mesh
creation order, not a mesh name. The renderer keys its mesh pool by that ID.

### Determinism

All randomness through seeded RNG — steal Chomp's `js/core/rng.js`, it is written
and proven. Never `Math.random()` in sim code. Purely cosmetic FX jitter may use
it, but only inside render code the sim never reads back.

---

## Transport: Photon Realtime, host-authoritative

**Not being built now — but the seam is.**

Photon because it is a managed relay with no server to run or pay for, the site
is static on Vercel and cannot host a game server, and Stickland already shipped
on it.

One client is host and runs the authoritative sim; others send commands and
receive snapshots. Because the sim is headless by construction, the same sim
files lift onto a Fly.io process later as a dedicated server with no rewrite.

**Known ceiling, decide with eyes open:** host-authoritative on a relay gives the
host zero latency and the technical ability to cheat. For a portfolio game among
friends this is the right trade. For anything competitive, PvP needs a dedicated
server — which this architecture supports later, but the upgrade is a deployment
job, not a code rewrite. Do not promise competitive integrity on the relay build.

**Build now:** one transport interface the sim talks through, with a local
loopback implementation. **Do not build:** lobbies, matchmaking, lag
compensation, reconciliation, interpolation tuning. Those sit on top of a correct
seam and are cheap once it exists.

### PvP toggle

PvP on by default, co-op when off. Make it a **sim-level flag**, not a render or
UI concern — it changes whether player-vs-player hits resolve to damage. Both
modes must run through the same combat path with one branch, not two code paths.

---

## Site embed contract — non-negotiable, proven twice

Stickland and Chomp both meet this. Build to it from the start; Chomp cost a full
round trip by adding the volume API late.

1. **Vendor Babylon. No CDN.** `/games/*` CSP is `script-src 'self'
   'unsafe-inline' blob:`. A CDN load fails silently — `BABYLON` is simply
   undefined. Pin the version, commit to `vendor/`, write `vendor/VERSION.txt`.
   Chomp vendored 9.21.2; align unless there is a reason not to.
2. **ES module tree, served as-is.** No build step. Stickland's `build.mjs`
   exists only to solve `file://` module loading — do not copy it.
3. **Embed hooks, exact shape:** `window.Arena1.pause()`, `.resume()`,
   `.setSafeTop(px)`.
4. **The game owns the Escape ladder.** The pause menu binds no keys; the state
   machine calls `setState('paused')`.
5. **Audio exports `setVolume` / `getVolume` / `setMuted` / `isMuted`**,
   persisted under an `arena1-` prefixed localStorage key, mute independent of
   volume. The current `AudioFX` IIFE connects every voice straight to
   `ctx.destination` — route them through a single master `GainNode` instead and
   the whole API is four small functions over that node.
6. **Pause menu** carries the accent picker writing `dex-accent-name`, with
   `SITE_ACCENTS` byte-identical to `ACCENTS` in the site's `script.js`.
7. **Watch `.gitignore`.** `games/*/index.html` silently ate Chomp's index on
   live. It is scoped to Stickland now — confirm `games/arena1/index.html` is not
   caught by a glob.
8. **All tunables in one config module.** `TUNE` is already most of the way
   there — carry every value across unchanged.

---

## Suggested layout

Mirrors Chomp, which works and is already understood:

```
arena1/
  index.html
  css/game.css
  vendor/                 babylon + VERSION.txt
  js/
    config.js             TUNE verbatim + PVP default
    main.js               boot, fixed-step accumulator, state machine
    core/                 rng · events · pool
    sim/                  ← no Babylon import, ever
      world.js            collision shapes, broadphase
      movement.js         walk/air/dash/slide/walljump/jet/grapple
      combat.js           fire commands → hit events (PvP + PvE, one path)
      enemies.js          authoritative AI
      entities.js         stable IDs
    net/
      transport.js        interface + local loopback
    render/               Babylon: meshes, FX, camera, HUD
    systems/audio.js      master gain + volume API
```

---

## Build order

1. **Sim skeleton + fixed timestep + loopback transport.** No rendering. Prove a
   player capsule moves under commands, headless, in a test harness.
2. **Collision from level data.** Port the Ascent and arena geometry as shapes
   the sim owns; build meshes from that data.
3. **Movement.** Port `TUNE` values verbatim and tune against the prototype
   side-by-side until the feel matches. This is the milestone that matters most —
   if the feel is lost here, nothing after it is worth shipping.
4. **Render layer + interpolation.** Snapshots → meshes.
5. **Combat as commands + events.** PvE and PvP through one path.
6. **Audio with master gain, HUD, pause menu, embed hooks.**
7. **Photon transport** swapped in behind the same interface.

Steps 1–3 are the whole risk. If movement does not feel identical after step 3,
stop and reassess rather than building on it.
