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
  **And consider whether metres is the unit at all.** `HYPER.tripFirst` and
  `tripRepeat` are the length of a crossing and they are authored in SECONDS,
  with `doublingFor()` solving back to the metres of altitude per doubling that
  produce them. The constant behind them is absolute — 1612m and 1013m — and it
  is allowed to be, because `legSeconds` has no radius in it: the middle of a
  journey is flown at the cap and costs nothing, so a trip costs the climb out
  and the fall in, which are the same climb on every world. Measured, all five
  destinations land within 0.5s of the asked time under both laws. Where a
  number has a scale-free unit, author it in that unit and derive the metres;
  then nobody has to divide anything by 207.
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
- **Anything placed relative to the camera runs AFTER the camera has moved.**
  `World.update` does the frame's world; `World.updateCamera` does the half that
  is pinned to the eye — the far band and the seabed — and main.js calls it
  after `cam.update`. The far band puts every disc and promoted body at a drawn
  distance K along its direction FROM THE CAMERA, so a stale camera is a
  placement error of exactly however far the camera travelled that frame. On the
  ground that is a part in ten thousand; in hyper flight K collapses to ~15m
  while the camera covers hundreds of metres a frame, which put the destination
  behind the eye and made a world "drawn at 13.7 degrees" invisible. Add
  anything else that is positioned from `camera.position` and it goes in
  `updateCamera`, not in `update`.
- **The ground has no night, and anything drawing a terminator must know it.**
  `bandLight` is the cel ladder and its floor is `BANDS.floor` at 0.47: a face
  pointing directly away from the sun still gets 47% of key, so form reads on
  the unlit side. The darkest the terrain gets anywhere, at any hour, is about
  half its lit value. `svFarBody` draws a real sphere with a real terminator, so
  its `uNight` is derived from that ladder by `nightFloorOf` and NOT from the
  authored ambient — which is zero on two worlds and gave a night side darker
  than any ground the game can show. Every arrival from Home lands on the
  destination's night side (all five, dot(arrival, sun) from -0.52 to -0.86), so
  this is the term the handoff is made of.
- **The cel ladder is written down once.** `BANDS` in materials.js is the table;
  the GLSL `bandLight` is generated from it. Two readers that must agree, one
  number. Retune the ladder and the far bodies follow.
- **A harness that drives the dev warp is testing a path nobody takes.**
  `dev/arrivecheck.mjs` did, for most of its life — `devWarp` passes
  `approachAlt` explicitly and settles to the deck — which is how an absolute
  900m arrival survived long enough to frame nothing on the small worlds. It
  emits `hyperarrive` now, the same event the game fires. Before trusting a
  harness, check that the path it drives is the one a player gets.
- **The arrival altitude and the departure boundary are different numbers.**
  They shared `HYPER.approachAlt` and only ever shared a value. Departure must
  sit above the jet's ceiling, which is metres for an absolute reason; where
  the craft is put down answers to how big the world looks, which is radii —
  `ARRIVE.alt`, 0.35R, always at or below where the sphere was crossed. A
  world's limb enters the chase view at 0.41-0.42 radii on all six, so 900m
  absolute framed Anvil and missed Ember by a factor of ten.
- **Measure who is looking before measuring what changed.** The far-body to
  quadtree handoff was taken apart across most of a session — size, luminance,
  silhouette, three shader terms — and then the arrival was photographed from
  the seat: the destination fills **0% of the frame on Ember and Tarn, 1% on
  Anvil**. At 880m nose-down the world is below and behind the chase boom on
  every world. The step is real and invisible, and those are two different
  facts. `dev/shots/seat.jpg`.
- **Three instances now, and the third overturned a plan.** The far-body to
  quadtree handoff was scoped as a geometry problem — 642 sampled directions
  against a 5m quadtree, a 6x to 46x jump. Measured at the approach sphere it
  is continuous to 3% in both size and silhouette, and the luminance step is
  +928%, −59% and +1132% on three pairs. The remaining work is a lighting
  match, not an LOD chain. `dev/handoff.mjs`, and read its list of what it
  cannot see before trusting a number from it.
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
| `docs/seamless-space.md` | phases 1-4 shipped; phase 5 bullets 1-2 done, bullet 3 (speed FX) left |
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
  `geysers.js`, `hyper.js` (travel maths, no Babylon, no game state; also
  owns the trip length — `legSeconds`/`doublingFor` convert between seconds of
  crossing and metres per doubling, and `doublingAfter(crossings)` picks which
  law a departure flies),
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
  `hyper` (null or transit state, carrying the `H` this crossing flies under —
  chosen at departure from `economy.crossings` and never re-read), `hyperT`
  (0..1 — every FX reads only this, and it is a function of SPEED, so it still
  spans the full range on a short trip; only the dwell shortens).
- **`Surface`**: `{planet, frame, cache}`; `height()` is analytic,
  `surfaceHeight()` is the **drawn** lattice — anything touching the ground
  uses the latter. In `TangentFrame`, `north = east × up`; the sign is
  load-bearing (the other order gives determinant −1 and Babylon folds the
  non-unit quaternion into scale).
- **Planet profiles** live in `PLANETS` (tune.js); `makePlanet()` derives
  `maxLevel`, `horizon`, `fogNear/Far`, `farPlane = R·4` etc.
- **Save blob**: `{v: 1, hyper, at, crossings, worlds: {key: {clock, sites:
  [{id, dir, age, geyser, hp}]}}}` at `localStorage['surveyor.economy.v1']`.
  `crossings` is completed trips and decides how long the next one takes
  (`HYPER.tripFirst` against `tripRepeat`), so it persists for the same reason
  a colony does. Added WITHOUT bumping `v` — a blob that lacks it reads as
  zero, which costs a returning player one more long trip and nothing else;
  bumping the version would have dropped every save on disk.
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

**A checker must report what it examined.** `process.exitCode = bad ? 1 : 0` is
0 when nothing was looked at, and the summary line above it usually states a
positive — so a harness that measured nothing prints "Every arrival stayed above
ground" and exits clean, which is worse than no check because it buys confidence
it has not earned. `arrivecheck`, `disccheck` and `lodcheck` all had this shape;
each now counts what it examined against what it was asked for and prints both.
The same applies inside `run.mjs`: a loop over a discovered set does not fail
when the set is empty, it deletes its checks, so assert the subject count before
the loop — as `the system has six worlds` already did.

**And a count guard must be pinned, not loose.** The backtick check read
`bodies.length > 10` and passed on seventeen while three bodies went unscanned.
`glslcheck` now counts declarations a second, independent way and compares the
two, naming any shader it declared but never parsed.

**`lodcheck`'s sweep must bracket the crossing in DRAWN angle, not true
distance.** The far band compresses distance, so a 10x change in range is under
2x in drawn angle; the fade band is `promoteAngle*(1 ± fadeBand)` and the sweep
has to start below its low edge. It did not for most of this file's life — every
sample came out `sphere` and the pop check evaluated nothing. If `promoteAngle`
or `fadeBand` move, re-solve for the crossing step and move the tight pair with
it; the harness now fails loudly when it observes no crossing.

**A gate that stops a check reporting a false zero can make it report a false
FAILURE, and the trigger is the window moving rather than the code changing.**
`cross()` in `run.mjs` measures the bank every frame and throws away the frames
where the local up lies along the nose, because a craft diving straight down a
radial has no bank to be right or wrong about — without that gate the check
reported a perfect zero off a sample of nothing. Its `finalBank` is then named
for arrival but MEASURED at the last frame the gate lets through. On a 25s
crossing the gate shuts at 87% and the bank had settled at 73%, so the two
coincided and the name was never tested. Halving the trip shut the gate at 82%
with 35 degrees still to unwind, and the check reported "arrives 35 degrees
off" about a number from 2.4 seconds before the end. Nothing was wrong with the
craft: the bank unwinds at a bounded rate with 2.4s to spend 0.68s of it, and
`landOn` sets roll to zero regardless. The fix is not a wider gate but a
scale-free quantity — the SHORTFALL, seconds of bank still standing minus
seconds left to unwind it — which says the same thing about a 37-second
crossing and an 11-second one. Before trusting a number, check whether its NAME
and its MEASUREMENT point at the same moment; they may only coincide at the
scale it was written at.

**`glslcheck` must be able to see every shader body.** A backtick inside one
closes the template literal and silently eats the GLSL after it, which is the
whole reason that check exists. For most of its life it matched `\w+Shader = `
with an optional literal `COMMON + ` prefix, and so never scanned `COMMON` or
`HAZE` (GLSL chunks, not named `...Shader`) or `svFarBodyFragmentShader`
(declared `PRECISION + HAZE + `) — three bodies, one of them the entire far
band. A pair of backticks went into `COMMON` on 2026-08-20 and it reported
clean. Declare a shader with a new prefix shape and you must widen `DECLARES`
and both regexes in `shaderBodies` together, then prove it by injecting a
backtick pair and watching it fail.


All launch Chrome on a throwaway profile via `dev/cdp.mjs` (no npm deps).
`run.mjs` — headless suite over a Babylon stub, 227 assertions, imports
`glslcheck.mjs` first (backtick-count scan of materials.js; that failure cost
six debugging cycles). `shots.mjs` — six PNGs per world + contact sheets,
fails on any console error. NOTE: it rebuilds the sheets from whatever subset
of worlds you pass, so `shots.mjs home ember` overwrites the committed six-way
sheets with a two-way one. Pass no worlds when the sheets matter. `savedworlds.mjs` — cold load **with** a save,
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
`handoff.mjs` (the far body against the world it becomes, at the approach
sphere, isolated by show/hide differencing on each side — size, luminance and
silhouette, because the first two handoffs both hid in the channel nobody
measured), and
`crosscheck.mjs` (one real crossing in the live engine: samples the drawn
`rotationQuaternion` every animation frame and reports the step across each
boundary, plus a filmstrip. `--repeat` flies the SHORT crossing — a throwaway
profile has never flown, so the default is the long first trip, which is the
one nobody makes twice; the two write separate sheets. The maths version lives in `run.mjs`; this is the
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

- ~~**Fog gets worse as you climb, above two radii.**~~ FIXED, and it was two
  faults meeting: an altitude clamp of `2R` that was a model rather than the
  overflow guard it was written as (`64R` now), and `sqrt(2Ra)` for the
  horizon, which is the small-angle form and under-reads by 31% at the arrival
  altitude on Tarn. The exact `sqrt((R+a)² - R²)` is one term longer and grows
  with `a` instead of stalling. The two differ by `sqrt(1 + a/2R)` — zero on
  the ground, 22% at one radius up, 78% at Ember's arrival — so it is a fix
  everywhere the old one was right and a correction only where it was not.
  A constant that is correct for the average world is wrong for the small ones;
  that is the same lesson as the far plane and as the far body's air gate.
- **The sky is observed from the craft, not from the planet.** `neighbours()`
  fixes every disc's direction and distance from the owning world's CENTRE at
  construction. Nothing rewrote it, so a destination was drawn at a constant
  4.16 degrees "as if 302.8km away" for a whole crossing while the craft closed
  to 8.9km — it never grew, which is the one thing a crossing is for.
  `Discs.observe(at)` re-derives both per frame; `main.js` passes
  `centreOf(current) + craft.world`, which is the system position on a surface
  and in transit alike. Same family as the caching invariant, one level down:
  not a stale planet, a stale POSITION.
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
