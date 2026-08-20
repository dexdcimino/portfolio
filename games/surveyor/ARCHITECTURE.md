# SURVEYOR — Architecture

Six tiny cube-sphere planets you drive, sail and fly across in one morphing
craft, surveying, founding colonies and hyper-jumping between worlds. All
terrain is analytic 3D noise sampled from a direction — no heightmaps, no
seams. The whole look is carried by six hand-written `ShaderMaterial`s with
banded cel lighting; there is **no PBRMaterial anywhere**.

## Invariants — each one has already cost real time

- **Nothing may cache a per-world object.** Three separate bugs came from a
  constructor reading `craft.surf.planet` once and never again: six sky domes
  drawn at once on a cold load with a save (read as a sun bug for three
  sessions), `Trails` drawing the boot world's motes on every world, and
  `SURVEYOR.surface` handing dev harnesses the boot planet after any warp.
  Anything per-world is constructed inside `World` or re-pointed in
  `swapTo()` — there is no third option. `SURVEYOR.surface` is now a getter
  onto `craft.surf`; a getter cannot go stale. Before adding a class that
  takes a `planet`/`surface`/palette, grep `this.planet =` and `this.surf =`.
- **Only the active set is visible.** The current world's sky dome, water
  shell, disc set — and any far body its disc set has promoted. `Worlds.enter()`
  is the only path that hides the world you left; `World`s are **born hidden**.
  Six assertions at the end of `dev/run.mjs` hold this. It was "one world" until
  the far band added a promoted body: a fourth thing with its own mesh and its
  own lifetime, which `World.setActive()` did not know about, so a world you flew
  away from would have left its bodies in the next world's sky. `Discs`
  owns the whole set through `setEnabled()`; `World.showMeshes()` goes through
  it rather than reaching past it to the billboard mesh.
- **No PBRMaterial.** Six hand-written shaders (`svTerrain`, `svWater`,
  `svSky`, `svCraft`, `svDisc`, `svStreak`; plus two depth-only passes
  `svSeabed`, `svDepth`). Five passes have confirmed it: anything found as a
  PBR plugin (lookdev transplants) comes across as a *technique*, never code.
- **Anything that moves the craft without flying it must say so.** A hyper
  arrival teleports across the solar system in one frame; objects that
  integrate position will draw the jump — the wingtip `TrailMesh` drew a line
  between worlds on four contact sheets. `Trails.resetJetTrails()` exists for
  this: called in `swapTo()` and at the end of `dev/frames.mjs` ALOFT.
- **Every length and luminance needs re-deriving.** Worlds are 207–2072 m in
  radius with ~10–104 m of relief. Values authored elsewhere do not carry:
  this bit exposure (0.97, not lookdev's 1.28 — measured on all six skies),
  SSAO radius (2.2 m, not lookdev's 6.0 for a 4 km flat world), SSAO maxZ
  (260, not 900 — longer than half the worlds are wide), ambient fill, and
  texture scale.
- **A blur costs whatever is coming up behind it.** `backdrop-filter:
  blur(3px)` on the intro card put **1.3 seconds** on the WebGL context
  creation: the compositor has to keep a readback of a full-screen backdrop
  layer, and that contends with the engine coming up underneath. Measured warm,
  card on screen 210ms against 70ms and `Begin` live 2.4s against 1.0s — a
  cosmetic property costing more than everything it was decorating.
  **This is not only about the start card.** `backdrop-filter`, large-area
  `filter`, and full-screen transparency all force the compositor to keep and
  re-read a layer it would otherwise skip, and the cost lands on whatever is
  drawing behind them — the pause overlay over a live scene, the survey overlay,
  the deep-water and x-ray veils, any future modal over the canvas. The rule is
  the same in all of them: if it sits over something that is still rendering,
  measure that something before and after. A shadow is free; a blur is not.
- **An absolute length is a bug on six worlds of different sizes.** Almost
  every constant here is expressed in radii for exactly this reason; the one
  that is not — `HYPER.approachAlt`, 900m flat — is 0.43 radii up on Anvil and
  **4.35 radii up on Ember**. The far plane was `R * 4`, so on Ember a hyper
  arrival put the entire world outside `maxZ`: measured at that altitude, all
  51 live leaves clipped, nearest at 848m against 828m. Not a clipped horizon —
  no world at all, for eighty metres of descent. `makePlanet` floors the far
  plane at the horizon distance from the arrival altitude now, and an assertion
  holds it; the absolute altitude itself is phase 4's to fix. Before adding a
  constant in metres, divide it by 207 and by 2072 and look at both answers.
- **Measure at the resolution AND the scaling a player actually uses.**
  `devicePixelRatio` and the OS display scale MULTIPLY, and neither exists
  headless. Every frame number this project quoted for a year came off 900x560
  or 1280x760 headless, which is a ninth to a quarter of the pixels anyone
  plays at — and on the reference machine's 125%-scaled desktop the engine was
  rendering at dpr, so a 2560x1440 window drew a **3183x1577** backbuffer,
  1.56x the pixels it displayed. Both facts were invisible to every
  measurement that had ever been taken. The consequence is not a scaled-down
  answer, it is the WRONG answer: a CPU spike costs the same at any resolution,
  but the frame it lands in grows with every pixel, so a headless run says
  "CPU-bound, cut the leaf build" about a frame that is in fact GPU-bound with
  half its over-budget time outside our JavaScript entirely. `flycheck.mjs`
  takes `--size WxH` and `--window` for exactly this; it reports the backbuffer
  it actually got rather than the one it asked for, because those differ.
- **Harnesses run on a throwaway `--user-data-dir`** — no save, no restore
  loop, no returning player. A bug hidden by this survived three sessions of
  clean measurements. `dev/savedworlds.mjs` and `--save` in `dev/savefile.mjs`
  close the gap; use them whenever the returning-player path matters.
- **If a measurement disagrees with what is visibly on screen, the
  measurement is aimed wrong.** Three times now. (Also: render-cost numbers
  measured on SwiftShader are noise — `dev/budget.mjs` refuses to run there.)
- **A continuity check that measures one channel is measuring one channel.**
  `dev/lodcheck.mjs` walked a body through the billboard-to-sphere handoff,
  measured angular SIZE, found it continuous to 1.1%, and would have shipped
  the LOD as "no pop". Adding the body's mean luminance to the same run showed
  the sphere arriving at **0.42 of the billboard's brightness** — a 55% cliff.
  Size and brightness are independent, and a dark sphere and a bright quad of
  equal area pass a size test and pop violently. Before declaring any transition
  seamless, name the channels it could jump in — size, brightness, hue,
  position, silhouette — and measure each. The fix that follows is also worth
  keeping: neutralise the shader's terms **one at a time on both sides** rather
  than guessing which one differs (terminator off took the ratio to 0.82, limb
  off to 0.43, both to 0.93 — so it was the terminator).
- **`economy.load()` silently drops a blob without `v: 1`** — a malformed
  save reproduces as a perfectly clean run. The first attempt at reproducing
  the save bug came back green because of exactly this.
- **Line endings are per file** — preserve each file's own. **Stage explicit
  paths only** — a `git add -A` from another session once reverted 544 lines
  of this game; the repo's commit-msg hook now enforces scope.

## Plans (`docs/`)

The build plans live with the project rather than in someone's downloads. Each
one carries its own phases, risks and verification list, and the two that have
started carry a phase log of what actually shipped and where the plan was wrong.

| plan | status |
|---|---|
| `docs/seamless-space.md` | phases 1-3 shipped; phase 4 started, arrival cut |
| `docs/day-and-night.md` | parked. After Seamless Space — it changes lighting |
| `docs/colony-architecture.md` | parked. Does not conflict with Seamless Space |

## Modules

`js/boot.js` the entry point, and the only script `index.html` names: it
waits for a PAINTED frame before creating the `<script>` for Babylon and
importing main.js, because an 8.2MB parser-blocking engine means the start card
cannot go on screen until the whole game has booted (measured at 6296ms to
first contentful paint before this existed, ~70ms after on a warm load).
`js/main.js` boot + the single render loop; `js/tune.js` every number in the
game (40 exported blocks incl. `PLANETS`, `POST`, `ECONOMY`, `HYPER`);
`js/babylon.js` re-export used only by the transplanted `js/render/post.js`
(T1 post stack: ACES/bloom/SSAO/LUT/vignette/grain/FXAA); `js/pausemenu.js`
(binds no keys — main.js owns the pause ladder). The pause menu ends with
Reset All Player Progress (`games/_shared/reset-progress.js`): two-stage, and it
clears **only** `ECONOMY.saveKey` — `surveyor-audio` and `dex-accent-name` are
preferences and survive. The armed label counts the real save ("5 colonies
across 2 worlds"), read at arm time, then reloads.

- `js/core/` — events, pool, seeded rng (same shape as Chomp/Arena1)
- `js/world/` — `sphere.js` (cube-sphere charts, `TangentFrame`,
  `makePlanet`; imports no Babylon), `noise.js` (the single source of terrain
  truth), `surface.js` (flat-world adapter `Surface`), `chunks.js`
  (`ChunkField` quadtree, per-frame build budget), `scatter.js` + `flora.js`
  (rocks/vegetation baked into leaf vertex buffers — no extra draw calls),
  `water.js`, `seabed.js` (RTT depth pass), `shadows.js` (hand-rolled ortho
  depth pass — deliberately not Babylon's ShadowGenerator), `sky.js`,
  `discs.js` (other five worlds as billboards, one draw call), `preview.js`,
  `geysers.js`, `hyper.js` (travel maths, no Babylon, no game state),
  `gravity.js` (the summed field, well dominance and the craft's transit
  basis — same rule as hyper.js: no Babylon, no game state; `dominant()` also
  gates phase 4's prebuilding, which must not run against an unconverged
  arrival prediction), `space.js` (the
  far band's uniform scale about the camera), `farbody.js` (displaced
  icosphere + `svFarBody`, the LOD a billboard promotes to),
  `materials.js` (every shader as template literals + `createMaterials`),
  `world.js` (**`World`** — everything the scene holds for one planet — and
  **`Worlds`** — the visited set: `get()` builds hidden, `enter()` swaps)
- `js/player/` — `meshes.js` (rover/boat/jet/drone geometry), `craft.js` (one
  vehicle, four physics models + hyper transit — the drone is a hover on key
  `4`: holds height with no input, moves by tilting, thruster pods swivel in
  `applyTransform`. VERTICAL IS TWO KEYS ON THE HOVER LINE, not two forces on
  the spring — T raises `droneLift`, G lowers it into `DRONE.minLift`, and
  releasing both holds the new height because the target moved rather than
  being pushed against. T/G because the Q/A/Z column is full (Q is the survey
  overlay, globally, so it is live in the drone too) and a stacked pair is
  worth more than two keys picked separately. Entry floors that offset at 0, not at `minLift`, or the
  drone cannot take off from the ground), `camera.js`
  (`ChaseCam`). NOTE: the camera keys FOUR maps by mode — `CAM.dist/height/
  fov/rollTilt` plus `REF_SPEED` — and a mode missing from any one of them is
  a NaN camera and a grey frame with no error anywhere.
- `js/game/` — `survey.js` (cells/beacons + scanner beam), `colony.js`
  (colonies grow on wall time; `sites` permanent, `node` meshes),
  `raiders.js` (positions **derived** from age/target/hp so unrendered worlds
  are attacked identically), `economy.js` (balance + save/load), `hud.js`,
  `overlay.js` (hold-Q x-ray + system view)
- `js/audio/` — fully synthesised (engine/music/sfx/index); zero audio assets
- `js/fx/` — `trails.js` (dust/spray/wakes/wingtips), `streaks.js` (hyper
  lines placed entirely in the vertex shader)

## Data shapes

- **`World`** owns per-planet: mats, sky, water, discs, shadows, seabed,
  `field`, plus session-owned `survey` and `colonies` (only their meshes are
  released on leave). Both `shadows` and `seabed` hang off **one pair** of
  `field.onBuild/onDrop` hooks — assigning one over the other silently
  empties the shadow caster list.
- **`craft`**: `surf` (a `Surface`), `world` (planet-centred position),
  `pos/vel` in local tangent space (y = metres above sea level), `mode`,
  `hyper` (null or transit state), `hyperT` (0..1 — every FX reads only this).
- **`Surface`**: `{planet, frame, cache}`; `height()` is analytic,
  `surfaceHeight()` is the **drawn** lattice — anything touching the ground
  uses the latter. In `TangentFrame`, `north = east × up`; the sign is
  load-bearing (the other order gives determinant −1 and Babylon folds the
  non-unit quaternion into scale).
- **Planet profiles** live in `PLANETS` (tune.js); `makePlanet()` derives
  `maxLevel`, `horizon`, `fogNear/Far`, `farPlane = R·4` etc.
- **Save blob**: `{v: 1, hyper, at, worlds: {key: {clock, sites: [{id, dir,
  age, geyser, hp}]}}}` at `localStorage['surveyor.economy.v1']`.
- **`window.SURVEYOR`** = debug surface (live getters, incl. `surface` →
  `craft.surf`); **`window.Surveyor`** = the stable interface
  (`resume/paused/sound`). Never merge them (main.js says why).

## Call flow

Boot (main.js, order forced): previews baked before the start card → planet →
`Surface` → `createMaterials` → forms → `Craft` + `settle()` → `Economy` →
`Worlds.enter(boot)` → restore block (`economy.load()`; saved worlds are
`get()`-built hidden, colonies restored + `catchUp(away)`) → cam/trails/
streaks/hud/sound/overlay → post stack + `setGrade(planet.lut)` →
`world.warm()` before the first frame.

Per frame: `craft.update` → `economy.update` (**every registered world, not
just the visible one**) → `world.update` (or discs+beam only during hyper) →
trails → cam → streaks → overlay (after the camera — selection is by screen
centre) → `mats.update(..., craft.pos.y)` (the **craft's** altitude, not the
camera's) → hud → sound → `scene.render()`. Paused = render only, nothing
stepped.

Wall time: `economy.save()` every 20 s, on `pagehide`, in `swapTo`, after a
pause replay. Away/paused time is **replayed** through `colonies.catchUp()`
(cap `ECONOMY.offlineCap` = 3600 s), never credited.

World swap: `swapTo()` → `worlds.enter` → new `Surface` → `craft.landOn` →
re-point craft meshes at the new world's `mats.craft` → `cam.setPlanet` +
`cam.arrive` → `streaks.setPalette` → `trails.setPlanet` +
`resetJetTrails()` → `post.setGrade` → hud/overlay retarget → save. Hyper
arrival reaches this via `emit('hyperarrive')`. `devWarp()` (gated on
`DEBUG.warp`) uses the same `swapTo`, then settles to rover deliberately.

## The numbers

| key | radius m | relief m | water | fog ×R | notes |
|---|---|---|---|---|---|
| home | 1036 | 86.3 | 0 | .18/.78 | the tuned reference, 12 geysers; radius/12 relief (the revamp), escarpments/mesas/gullies via weight-gated terms in noise.js |
| ember | 207 | 10.35 | dry | .20/.70 | no shadows, no flora, fissure vents |
| tarn | 414 | 20.7 | +7.8 | .26/.95 | wettest; flora authored 1.25, off |
| vault | 829 | 41.45 | 0 | .30/1.0 | ice (`iceDepth` rules), ambient 0 |
| shroud | 1451 | 72.55 | −12 | **.020/.115** | fog wall; hero flora authored, off |
| anvil | 2072 | 103.6 | −24 | .22/.92 | biggest, triplanar 0.85 |

**VEGETATION IS OFF ON ALL SIX** (Dex, 2026-08-19) — it looked wrong
everywhere. One value per world does it: `PLANETS.<key>.flora.density: 0`, with
the authored value in the comment beside it (Home 1.0, Tarn 1.25, Shroud 1.0,
Anvil 1.0; Ember and Vault were always 0). `floraOf()` returns null on a zero
master, so `chunks.js` never calls `appendFlora`, no rng stream is drawn and no
vertex carries a sway — the layer code below is dormant, not deleted, and
restoring a world is that one number.

**FRAME BUDGET IS SET BY PIXELS, NOT BY CPU** (measured 2026-08-19, real
window, boosted Home flight, Radeon 880M). Every previous number came off
900x560 or 1280x760 headless, where the GPU is nearly free and a CPU spike
hides under it. At 2560x1440 the game loop's CPU is a 6ms median while the
frame is 13.4ms, and **half of all over-budget time is outside our JavaScript
entirely** — the GPU, the compositor, the collector. Three cuts, in the order
they paid:

- `MAX_BACKBUFFER_SCALE 1` in `main.js`. It rendered at devicePixelRatio, so
  a 125%-scaled desktop drew **1.56x the pixels it showed**, on every post
  pass. This is the single biggest lever and it is one number.
- Survey props are queued and drained at `PROP_SPAWN_PER_FRAME 2`, and the
  beacon's three meshes are cloned from protos rather than built with
  `MeshBuilder` per beacon. `survey.update`'s worst frame: 21.7ms -> 8.5ms.
- `buildBudgetPerFrame` 2 -> 1. Two leaf builds could land in one frame
  whenever the first was quick; one build a frame is still 4x what a 158m/s
  boost demands.

Together at 2560x1440: median 13.4 -> 9.5-12ms, p99 30.9 -> ~20.5, frames
missing 60Hz 12.2% -> 2.2-5%, visible hitches (>34ms) 12 -> 2. At 1920x1080:
median 8ms, p99 16ms, 0.5% of frames missing 60Hz. What is left is dominated
by the GPU and the collector, not by anything the loop does.

All worlds: `leafRes 16`, `targetCell 4.5` (held constant so handling is
identical; quadtree depth varies instead). POST: exposure **0.97**, contrast
1.05, SSAO half-float / radius 2.2 / maxZ 260 / ratio 0.75, grain 5.0
(dithers ACES darks), per-world LUT via `post.setGrade`. LUTs: six per-world
`.3dl` + identity in `assets/luts/`.

## Harnesses (`dev/`)

All launch Chrome on a throwaway profile via `dev/cdp.mjs` (no npm deps).
`run.mjs` — headless suite over a Babylon stub, 227 assertions, imports
`glslcheck.mjs` first (backtick-count scan of materials.js; that failure cost
six debugging cycles). `shots.mjs` — six PNGs per world + contact sheets,
fails on any console error. `savedworlds.mjs` — cold load **with** a save,
asserts one sky/disc set/water. `arrivecheck.mjs` — exits non-zero, the one
you can gate a commit on. `savefile.mjs` — seeded saves (`--save`,
`--away=N`). Plus frames/spawncheck/noop/waterstats/waterangles/disccheck/
sundisc/skyline/floracheck/perf/whatisthat, `budget.mjs` (real-GPU frame
budget; refuses SwiftShader), `colonycost.mjs` (what a mature basin costs),
`flycheck.mjs` (frame pacing while the jet boosts across a world — worst
frame, not average; the smoothness gate every Home-revamp phase reports.
`--size WxH`, `--window` for a real window on a real compositor, and
`--scale N` / `--off ssao,bloom,grain,fxaa` to A/B one lever at a time; it
attributes every frame to streaming / leaf build / render / the rest of the
loop / outside our JavaScript, and prints the worst ten with the breakdown),
`lodcheck.mjs` (walks a body through the billboard-to-sphere handoff and
measures BOTH size and luminance — see the continuity invariant), and
`crosscheck.mjs` (one real crossing in the live engine: samples the drawn
`rotationQuaternion` every animation frame and reports the step across each
boundary, plus a filmstrip. The maths version lives in `run.mjs`; this is the
one that can catch the game drawing something other than what the maths says).
`dev/history/` is the pre-import repo bundle.

Terrain note: `height()` in noise.js carries three weight-gated terms beyond
the flat-world five — `wCliff` (escarpment step along a shelf-field contour,
`cliffWander` breaks it into ramps), `wMesa` (flat-topped buttes), `wGully`
(driving-scale drainage). Zero-weight worlds skip the blocks entirely, which
is what keeps the other five bit-identical; Home is the only user. Leaf
builds are budgeted by time as well as count (`buildBudgetPerFrame 1`,
`buildBudgetMs 3`), and
Home's flora places on the leaf's own height lattice (`flora.onGrid`) so
plants sit on the drawn ground. Hero formations (`scatter.monuments: N`, Home
only): a seeded world-space list from `monumentsOf()`, baked into leaves at
EVERY LOD level with identical geometry so a landmark never pops; own rng
streams, so the per-leaf rock roll is untouched everywhere. Rocks can opt
onto the lattice too (`scatter.onGrid`). Flora layers carry a per-layer LOD
reach (`levels`; Home's trees/heroes run 3, so the treeline outranges the
grass), and the shadow pass culls its caster list to the box each frame —
measured at ~0 GPU and ~1.4ms CPU before, ~0.7ms after; the cost was draw
submission, never resolution, so no coarse-geometry caster LOD was built.

## Known-outstanding — do not re-report

- **A subsystem's total is not a diagnosis.** `colonies.stream` measured 60ms
  on the arrival frame, so the fix built colony sites ahead of time — and made
  it 106ms. Measured properly, that frame built **zero sites**: all of it was
  `streamGeysers`, which is called from the same function. Two rounds lost to
  reading a timer's NAME as a cause. Time the line, not the module, before
  changing anything.
- **A World can be built and invisible, and that is load-bearing.** Terrain
  leaves, colony sites and geyser vents hang off `World.ground`; `showMeshes`
  switches it. Until phase 4 the only thing keeping an inactive world's ground
  off screen was that its field had been DISPOSED. Two assertions hold it,
  because this is the six-sky-domes shape — something that exists, is correct,
  and is drawn when it should not be. Note the headless stub's `isEnabled()`
  walks ancestors for the same reason.
- **A check that fails on a healthy build teaches people to ignore the suite.**
  `dev/disccheck.mjs` gated discs at 5 degrees — the right number the morning it
  was written and wrong by that afternoon, because the sky pass raised the disc
  compression's reference twentyfold on purpose. The design produces 3.90 to
  6.80 degrees across all thirty ordered pairs, so the bar sat INSIDE the
  authored range and two worlds failed from a perfectly good build. It is 8 now,
  above the widest by a fifth. A bar has to clear what the design produces; if
  it does not, it is not measuring the design, it is measuring the bar.
  The same check also gated a MEASURED footprint against a COMPUTED body
  diameter, which are not the same quantity — see the note in the file.
- ~~**`dev/cdp.mjs` launches Chrome on a fixed debug port (9222).**~~ FIXED.
  `launch()` asks for port 0 and reads back the one Chrome bound from
  `DevToolsActivePort` in its own throwaway profile. It mattered because a
  second Chrome told to use a busy port does not fail: it starts, loses the
  debugging socket, and the harness then talks to the FIRST browser or to
  nothing — both sessions hanging with empty output and no error. Six sessions
  work in this repo. Verified by running two harnesses at once, which is the
  case that used to hang; an explicit `port` still wins, for attaching a
  browser of your own to watch a run.
- **The arrival seam is 84 degrees and is deliberate.** `landOn` stands the
  craft up out of a radial dive — pitch to 0.10, autopilot on — in one frame.
  Phase 3 owns only that it is a pitch about the craft's own wings and nothing
  else, which is asserted; phase 4 deletes the swap and the seam with it. Do
  not "fix" it in isolation: changing that pitch changes the feel of every
  arrival in the game.
- `DEBUG.warp: true` — the HUD warp row. Off before shipping.
- Ember's pale sky slab = the cloud strata (diagnosed, left for the strata
  rework; check Shroud second).
- Audio is fully synthesised on purpose; a small `.ogg` is the known upgrade.
- ~~Duplicate keys in three `sky` blocks of tune.js~~ — FIXED in the Home
  revamp's Phase 2: the dead first occurrences were deleted (a comment marks
  each spot); every value that was actually winning is unchanged, so no world
  looks different. The old note, for the record:
  - Vault: `clouds: 0.12` dead, `clouds: 0.05` wins
  - Shroud: `clouds: 1.5`, a `cloudColor`, and `ceiling: 0.55` dead;
    `clouds: 1.8, cloudCover: 0.30, cloudSoft: 0.30, ceiling: 0.45` win
  - Anvil: `clouds: 0.22` and `ceiling: 1.6` dead;
    `clouds: 0.16, cloudCover: 0.66, cloudScale: 1.5` win

  Home, Ember and Tarn are clean. Pattern says the sky pass appended a new
  block instead of editing the old one — check for a third copy before
  merging.
- Stale prose: README still says identity-LUT-only (per-world LUTs shipped),
  "four frames per world" (now six), and `photon`-era comments in discs.js/
  tune.js say travel is "not wired".
