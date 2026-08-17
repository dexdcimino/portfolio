# SURVEYOR

A finite spherical world you can drive all the way round. One craft, three
forms — six-wheeled rover, hydrofoil boat, delta jet. Drop colonisers and watch
habitats build themselves. Babylon.js 9.21.2, vendored. Single-player, no
external assets, no CDN, no build step.

## Run it

ES modules need a server — `file://` will not work.

```bash
cd surveyor
python3 -m http.server 8080
# http://localhost:8080
```

## The idea

You're a surveyor. Beacons are the job; flight is the reward. Cells and beacons
buy flight time, flying burns it, and driving or boating slowly earns it back so
you can never be hard-stuck. Momentum carries across every transform, so the
loop is: build speed on the ground, hit **3** off a ridge, cover distance from
the air, glide down when it runs dry.

## Controls

| | |
|---|---|
| `W A S D` | drive and steer — in the air, pitch and roll |
| `1` `2` `3` | rover · boat · jet |
| `Shift` | sustained boost |
| `Space` | hold to charge a jump, release to leap (full charge = 10x height) |
| drag · wheel | swing the camera · pull the boom in and out |
| `C` | recentre the camera behind you |
| `F` | from the jet, drop a coloniser |
| `R` | drop back to rover |
| `M` | mute |

Boat on land wallows. Rover in shallow water wallows — and in deep water it
floods, goes under, and the survey fishes it out for 12 charge. Hitting `2`
while the hull is filling is the escape hatch. That's the teaching mechanism.

## Layout

```
index.html            no inline script or style — CSP-clean
css/hud.css
vendor/babylon.js     9.21.2, UMD, from npm
js/
  tune.js             every tuning number, one file
  core/               rng (mulberry32 + hashStr + rngFor), events, pool
  world/
    sphere.js         cube-sphere charts, tangent frame, planet profiles
    noise.js          height(dir, planet) — the single source of truth
    surface.js        the flat-world adapter + the leaf cache
    materials.js      four shaders: terrain, water, sky, craft
    chunks.js         cube-face quadtree + skirts
    scatter.js        rock geometry, baked into leaf meshes
    water.js          static sphere shell with a CPU-fed depth attribute
    sky.js
  player/
    meshes.js         procedural geometry for all three forms
    craft.js          state machine + three physics models
    camera.js
  audio/
    engine.js         graph: buses, generated reverb IR, ping-pong delay, limiter
    music.js          step sequencer + the score. Adaptive, sidechained to the kick
    sfx.js            held engine voices, ambience, one-shot per game event
    index.js          turns craft state into one intensity number
  fx/trails.js        dust, spray, wake rings, wingtip ribbons, shockwaves, motes
  game/
    survey.js         cells, beacons, scanning
    colony.js         probes, habitat domes, pressure tubes, growth on wall time
    hud.js
  main.js
dev/run.mjs           headless harness — stubs Babylon, runs in Node
```

## Decisions worth knowing

**The world is a pure function of a DIRECTION.** `height(dir, planet)` in
`noise.js` is the only authority. Terrain mesh, vehicle physics, rock placement
and water depth all read it, which is why a boulder sits *on* the ground rather
than in it.

The noise is 3D, sampled straight from the direction vector. That is what makes
it seamless: a 2D chart per cube face would have to reconcile six
parametrisations along twelve edges, and lat/long smears everything within a few
degrees of the poles. Because `height(dir)` is continuous everywhere by
construction, cracks *cannot* open at a face boundary.

Every amplitude is a fraction of `planet.relief` (~radius/20), and so are the
palette breakpoints and the contour intervals. The flat world's fixed 180m of
shelf and fixed 6m/30m contours put a 207m-radius moon under a spike taller than
half the planet, and made a 52m world come out uniformly pale because everything
landed in one colour band.

**The craft never carries world coordinates.** It sits at the origin of a
tangent frame whose +Y is the local up, and every frame the frame walks along
the surface by however far the craft moved and rotates with it (parallel
transport, so `craft.yaw` stays meaningful). In that frame y IS up, so the six
struts, the hop arc, the boat and the autopilot all survived the move to a
sphere untouched. Only the conversion at the edges is new.

That is deliberately not the "correct" architecture — a global-coordinates
rewrite with an orientation quaternion per vehicle against a world-space gravity
vector — because that would invalidate every tuned constant in `tune.js` at
once.

**The leaf cache is load-bearing.** `surfaceHeight` costs four `height()` calls
and has to know which quadtree leaf covers a direction to reproduce the drawn
lattice. The six-wheel suspension calls it ~18 times a frame. Caching the leaf
*resolution* (not the height samples — those are at different positions and
would never hit) takes that from ~18 descents a frame to 1.2, measured.

**Rocks are baked into terrain chunks.** No instancing, no second material, no
extra draw calls, and they stream in and out with the ground for free. Cost is
~1100 triangles per land chunk.

**Water knows where the shallows are.** A per-vertex `depth` attribute filled
from `height()` drives the banded bathymetry and the foam line with no depth
pre-pass. On a *finite* world that field is a property of the planet rather than
of where you are standing, so the old snapped plane and its 1.2ms-every-60m
refill collapse into one fill at construction. The shell is closed, so it needs
backface culling — with culling off the far side draws through the sky above the
horizon as a hard grey quad.

**Contour lines are the art direction.** Minor contours every 6m, index
contours every 30m, plus a bone stroke exactly where terrain crosses the
waterline. Widths scale with camera distance so they never alias, and fade out
past 300m. It reads as a topographic chart you're driving around inside.

**Nothing glows through a hillside.** There is no GlowLayer. A glow layer
renders its emissive meshes into a separate buffer with no depth information,
so haloes came straight through terrain. Bloom runs on the finished frame
instead — if a hill is in front of a beacon, the beacon is not in the frame, so
it cannot bloom. Everything meant to glow is authored above 1.0 into an HDR
buffer, and `ATMO.bloomThreshold` is the line between "lit object" and "bright
rock".

**Ground contact runs on `surfaceHeight`, not `height`.** `height(x,z)` is a
smooth analytic curve; the near chunk mesh samples it every 5m and puts flat
triangles in between. Anything that has to *touch* the ground reads
`surfaceHeight`, which reproduces that interpolation — otherwise vehicles float
over every convex cell, worst of all over the 5m terrace steps you spend the
most time driving across. Rock placement and water depth still use the analytic
form, because they are not in contact with anything.

**Six independent struts, not one sliding block.** Each wheel samples the ground
under its own contact patch and drives its own gas strut; the body's pitch and
roll are then read back off where the wheels ended up, blended with the terrain
normal (which stays smooth where six discrete points get noisy). The patch is
*averaged* fore and aft rather than maxed — a big tyre bridges a step instead of
following it, but taking the high point biases every wheel upward against the
chassis' single centre sample and leaves the struts permanently compressed.

The struts sit at their stops around a third of the time. That is not a bug to
tune out: the terraces are 5m tall and the wheelbase is 3.6m, so the ground
routinely varies by more than any suspension could absorb, and a wheel hanging
in the air over a terrace edge is what a rock crawler actually does. Raising
`SUSP.up`/`SUSP.down` barely moves that number, and only makes it look rubbery.

`SUSP.rollSign` exists because the sign was not derivable without a screen. It
is pinned by a check in `dev/run.mjs` that correlates the wheel-derived attitude
against the terrain normal — it was wrong on the first attempt and the test is
what caught it.

**Colonies grow on wall time, and only the meshes stream.** `colony.js` keeps
two lists that are deliberately not the same thing: `sites` is the record —
small, permanent, never disposed — and `node` is the meshes, built on approach
and thrown away on departure. Layout is derived from the site's seed, so a
colony rebuilds identically every time you come back, and a site you planted
twenty minutes ago will have finished building whether or not anything was
rendering it. Domes are wound clockwise for the same reason everything else is,
and there is a check for it, because a dome built the natural way round comes
out inside-out and nothing else in the suite would notice.

**The rover hugs, it does not fall.** The ride line is followed with an
asymmetric spring — soft going up (`follow`), stiff coming down
(`followDown`). Letting it fall under gravity instead turns every terrace edge
into a ski jump at boost speed, and a symmetric spring leaves it hanging metres
off the deck. `HOP.ledgeAir` is the switch for automatic air off ridges; it is
off, because on terrain this terraced it fires constantly.

**Winding is clockwise, normals are negated.** Babylon treats clockwise as
front-facing — its own `CreateSphere` has a *negative* signed volume — and for
that winding the raw cross product points into the solid. Every hand-built mesh
here follows that rule. `scatter.js` did not, which is why boulders and spires
rendered inside-out, and the terrain was lit from underneath.

**The jet launches on autopilot.** `setMode('jet')` hands you `JET.launchSpeed`
and nine seconds of hands-off altitude hold, and the first pitch or roll input
takes it away over `JET.assistFade`. A ground-proximity term stays on in manual
and softens a dive into a hillside rather than ending it.

## Tuning

Everything lives in `js/tune.js`. Some starting points:

- flying too short / too long → `JET.burn`, `FUEL.cellValue`, `JET.ceiling`
  (`JET.burn` is turned right down at the moment — flight is near-unlimited
  while the handling is being tuned. Put it back to 3.2 to restore the economy)
- too much hand-holding in the air → `JET.assistTime`, `JET.assistAlt`
- suspension too soft / too jittery → `SUSP.rate`, `SUSP.up`/`down`, `SUSP.bodyShare`
- tyres too big / too small → `WHEEL.radius` (the wheel mount is derived from it
  and `ROVER.rideHeight`, so they cannot drift apart)
- colonies too slow / too fast → `COLONY.domeEvery`, `growTime`, `maxDomes`, `income`
- hop too floaty / too stiff → `HOP.impulse`, `HOP.gravity`, `HOP.wheelLerp`
- rover floating or skating → `ROVER.rideHeight` (it is the height of the
  chassis ROOT, and the wheels hang 0.065 below it, so it belongs near zero),
  then the `follow`/`followDown` pair in `craft.js:updateRover`
- water too punishing → `ROVER.fordDepth`, `ROVER.sinkDepth`, `ROVER.drownTime`
- anything too loud → `SOUND.engineRover`, `SOUND.engineBoat`, `SOUND.sfx`
- too glowy / too flat → `ATMO.bloomThreshold`, `ATMO.terrainDetail`
- rover feels floaty → `ROVER.tiltLerp`, `ROVER.drag`
- boat won't carve → the lateral bleed constant in `craft.js:updateBoat`
- world too wet / too dry → `noise.js`, the `0.30` offset in the shelf term
- draw distance → `PLANETS.home.fogNear/fogFar` (fractions of radius) and
  `WORLD.lodSplit`
- world size → `PLANETS.home.radius`. Relief, LOD depth, fog, far plane, water
  shell resolution and contour spacing are all derived from it
- land/water split → `seaBias` and `wCarve`

One sign convention still picked without a screen in front of me: jet pitch,
where `W` is nose-down. Negate `input.pitch` in `main.js` to swap it. The
rover's roll used to be on this list; it is now pinned by `SUSP.rollSign` and a
correlation check in the harness.

## Tests

```bash
node dev/run.mjs
```

Stubs Babylon and executes the real gameplay modules — geometry integrity,
chunk streaming and recycling, 3060 frames of physics across all three forms
checking for NaN and terrain penetration, fuel bounds, prop streaming, the hop
arc and its suspension travel, flooding and recovery, a standstill jet launch
and the autopilot's altitude hold, colonies growing and streaming, and that the
audio degrades to silence when there is no context. 84 checks. Run it after
touching `noise.js`, `sphere.js`, `craft.js`, `chunks.js` or `colony.js`.

The winding checks earn their keep. Three separate meshes here have now been
built inside-out — boulders, then habitat domes, then tubes — and the
signed-volume assertion is the only thing that catches it without a screenshot.
The same goes for `SUSP.rollSign`, which was inverted on the first attempt.

`dev/` still has no browser harness, and that is the real gap: an inside-out
boulder field, a rover riding 1.5m in the air and a jet that could not take off
were all invisible to these tests and obvious in a single screenshot.

## Portfolio integration

Same iframe-wrapper pattern as Stickland, mounted at `/surveyor`.

- No inline `<script>` or `<style>`, so `script-src 'self'` and
  `style-src 'self'` are enough. No `unsafe-inline`, no `unsafe-eval`.
- `vendor/babylon.js` is 7.9MB uncompressed and ~2MB gzipped — make sure your
  host is compressing it, and check it isn't caught by a `.gitignore` glob on
  `vendor/`. That one has bitten this repo before.
- The canvas takes keyboard focus on start. In an iframe, the wrapper needs to
  hand focus to the frame on click or `1/2/3` won't register.
- Runtime perf: 225 draw calls, ~215k triangles at full ring extent.
  `WORLD.lodRings` is the dial if a mid-range GPU struggles.

## Not done

Audio is fully synthesised — there is no sample in the folder, because there is
no asset in the folder. It is properly produced rather than three oscillators
(sequenced score, send reverb, tempo-synced delay, sidechain under the kick,
adaptive layer gating), but synthesis has a ceiling. If a ~1-2MB `.ogg` in
`assets/` is acceptable, the music bus is one `decodeAudioData` away from
playing a real track and the SFX would stay as they are.
