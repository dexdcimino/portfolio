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
| `F` | drop a coloniser |
| `Q` | **hold** for the survey overlay — see through the planet, and the system |
| `E` | **hold** for the scanner beam. Costs charge, disrupts raiders |
| `R` | drop back to rover |
| `M` | mute |

Boat on land wallows. Rover in shallow water wallows — and in deep water it
floods, goes under, and the survey fishes it out for 12 charge. Hitting `2`
while the hull is filling is the escape hatch. That's the teaching mechanism.

## Layout

```
index.html            no inline script or style — CSP-clean
css/hud.css
package.json          "type": "module", and nothing else. The portfolio repo
                      this lives in declares "commonjs" at its root, which made
                      dev/*.mjs unable to import a .js game module at all
vendor/babylon.js     9.21.2, UMD, from npm
assets/luts/          the colour-grading LUT. identity.3dl only — see CREDITS.md
assets/textures/      three packed triplanar maps, 512^2 lossless WebP, 1.4MB
tools/bake_lut.py     writes the LUT. Authoring-time only; the .3dl is derived
tools/bake_terrain_maps.py  writes the three maps, from lookdev's scan family
js/
  babylon.js          the transplanted stack's one point of contact with the
                      BABYLON global. Nothing Surveyor wrote itself uses it
  render/post.js      TRANSPLANTED (T1) from the lookdev testbed: ACES, bloom,
                      SSAO, the LUT, vignette, grain, FXAA. Imports only ./ and
                      ../babylon.js and takes all config as an argument
  tune.js             every tuning number, one file
  core/               rng (mulberry32 + hashStr + rngFor), events, pool
  world/
    sphere.js         cube-sphere charts, tangent frame, planet profiles
    noise.js          height(dir, planet) — the single source of truth
    surface.js        the flat-world adapter + the leaf cache
    materials.js      five shaders: terrain, water, sky, disc, craft
    chunks.js         cube-face quadtree + skirts + the baked fissure mask
    scatter.js        rock geometry, baked into leaf meshes. One profile per world
    water.js          static sphere shell, CPU-fed depth attribute, the ice rule
    sky.js            one parameterised dome; the numbers live in tune.js
    discs.js          the other five worlds, camera-relative billboards
    preview.js        one equirectangular map per planet, baked at boot from
                      height() and the real palette, atlased so the discs above
                      show the actual places and still cost one draw call
    hyper.js          travel: the speed law, the analytic step, the sweep
    world.js          everything the scene holds for one planet, swappable
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
    survey.js         cells, beacons, scanning — and the scanner beam
    colony.js         probes, habitat domes, pressure tubes, growth on wall time
    economy.js        density, hyper output, the trip check, the save
    raiders.js        attackers and turrets, on wall time. Positions are derived
    overlay.js        the x-ray survey pass and the system view
    hud.js
  main.js
dev/run.mjs           headless harness — stubs Babylon, runs in Node
dev/shots.mjs         six-way screenshot harness — drives real Chrome over CDP
dev/perf.mjs          what the overlay costs, measured on real frames
dev/cdp.mjs           the ~150-line DevTools client it runs on. No dependencies
dev/history/          the standalone repo this game was built in, as a git
                      bundle. Read-only archive; see its README
```

## The post stack is transplanted, and the boundary is the point

`js/render/` came out of the lookdev testbed (T1) and holds to one rule: it
imports only from itself and `js/babylon.js`, and every module takes its
configuration as an argument. That is what let the post stack land here with no
adapter layer, and it is what the next transplants — lighting, materials, sky —
depend on. Do not reach into `js/tune.js` from anything under `js/render/`.

What T1 added over the pipeline this file used to build by hand: ACES
tonemapping, SSAO, and a per-world colour-grading LUT. What it did NOT add is a
look. Six worlds ship authored palettes, so all six point at a baked neutral
LUT: the plumbing is live and proven — an identity grade moves the frame's mean
by 0.6/255, a real one by 10 — and the colour is unchanged. Grading per world
comes after T2's lighting, when there is something worth grading.

Two numbers moved to pay for ACES, and both are argued in `POST` in `tune.js`:
contrast came down (ACES applies its own S-curve, so 1.22 was charging twice),
and exposure did NOT go up. Raising it to 1.28 pushed every authored sky into
the part of the curve where ACES desaturates hardest and turned Ember's sunset
pale. Measured, on all six.

## T3 put a surface on the ground without touching the chart

Third transplant, third PBRMaterial plugin that had nothing to attach to, so
again the technique came across and the file did not: triplanar sampling now
lives in the terrain shader itself. It is not decoration. The surface grain it
replaces was sampled on `vW.xz` — a single planar projection, on a cube-sphere,
correct on two caps and smearing across most of a planet. That is why lookdev's
note calls triplanar mandatory on a sphere, and it is why this was worth doing
before anyone judged whether it looked better.

**The chart survives by ordering, not by luck.** The palette ladder, the contour
lines, the waterline stroke and the bathymetry shelves are all drawn off the
GEOMETRIC normal and the height, exactly as before. The triplanar result is
applied in two places, both after: the detail luminance modulates brightness,
and the perturbed normal is handed to the LIGHT. Texture changes how the ground
catches light. It never moves a line.

**Two knobs, not one, and that is the finding.** `strength` bends the normal;
`detail` draws the scan's own light and dark. The scan is fractured stone, so
its detail channel is a crack network — which is line work, competing directly
with the line work this game calls a chart. At a single knob of 0.7 the contours
survived and Home still read as a different game. Separated, a world takes all
the relief it wants and none of the cracks: Anvil runs 0.85/0.40 because
fractured stone is what Anvil actually is, Shroud runs 0.25/0.08 because most of
it is behind fog.

**One map per layer, not two.** lookdev ships albedo sRGB plus a linear map
holding normal XY and roughness — six samplers for three layers, already an
optimisation. Here the albedo's colour is thrown away (six authored palettes
already decide colour) and its luminance is packed into B alongside the normal's
XY in RG. Three samplers, nine fetches worst case, nearer two on flat ground
where one plane and one layer dominate and the rest branch out. 1.4 MB against
6.4 MB of source.

Scales are re-derived against `targetCell`, not converted from lookdev's metres.
See TERRAIN in `tune.js` — the fade distances were the number I got wrong first,
for the third transplant running.

## T2 brought the light rig, and left three files behind

lookdev's `lighting.js`, `environment.js` and `rim.js` are a Babylon
DirectionalLight, an IBL cube and a PBRMaterial plugin. All three act on
PBRMaterial and **Surveyor has none** — six hand-written ShaderMaterials carry
the whole look and do their own banded cel lighting off a `uLight` uniform.
Copying those files in would have added a directional light nothing samples, an
environment texture nothing reads, and a material plugin with no injection site,
plus a skybox fighting the one `sky.js` already draws and a shadow map costing
GPU for no pixels. So what transplanted is the MODEL, and it lives in `LIGHT` in
`tune.js`:

    luminance = ambient + sunIntensity * bandLight(dot(N, sunDirection))

`sunIntensity` is the key and `ambient` is the fill — lookdev's own two numbers,
whose 4:1 ratio was the biggest lever over there. The absolute values do not
travel (they are linear-HDR PBR radiance; this shader multiplies an authored
0..1 albedo) and the ratio does. The rim came across term for term, including
the sun mask Surveyor did not have: without it a rim is an outline on every
silhouette, with it it is light grazing a lit edge.

Defaults are a **no-op** — ambient 0, sunIntensity 1, white sun, sunMask 0
reproduce the pre-T2 image to within 0.01/255, verified against the previous
commit. A world opts in by saying so, and five of the six do.

The invariant worth holding when authoring: `ambient + sunIntensity * 1.04` is
what a lit face comes out at, because 1.04 is bandLight's top step. Hold it near
1.04 and you are changing only how deep the shadows go. Ember is the cautionary
tale — the first attempt lifted its fill to 0.46 on the reasoning that a world
lit from underfoot has open shadows, which is true and was still wrong: a flat
lift is *sky* light, and it undid the near-black basalt the fissure emission is
authored to stand out against.

**Shadows did not come across.** See the T2 report: the terrain shader has no
shadow term, and adding one is a materials change.

TEMPORARY: the HUD carries a **dev warp** row — six buttons, one per world,
current one lit, click to arrive there. It calls the same `swapTo` a hyper
arrival does and skips only the journey, so it proves a world builds and proves
nothing about travel. `DEBUG.warp` in `tune.js` removes it from the document.
It replaced `Shift+1..6`, which never worked in an iframe.

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

### The six worlds, as measured

Regenerate with `node dev/run.mjs` — these are the numbers it prints, not
numbers anyone typed. Water is the fraction of the surface below sea level,
which since the Phase 3b `waterY` fix is the same line the shell is drawn at.

| world  | radius | relief span | % of cap | water | carried by |
|--------|-------:|------------:|---------:|------:|------------|
| Home   |  1036m |       48.2m |      93% |   31% | balance |
| Ember  |   207m |        5.5m |      53% |   dry | light and emission |
| Tarn   |   414m |       11.6m |      56% |   86% | water |
| Vault  |   829m |       30.0m |      72% |   33% | material and a mechanic |
| Shroud |  1451m |       61.0m |      84% |   19% | atmosphere |
| Anvil  |  2072m |       87.6m |      85% |   10% | topography |

Anvil and Shroud were retuned in Phase 3c: the `waterY` fix made their drawn
waterlines real for the first time and exposed 22% and 43% coverage against
profiles that call for canyon-floor rivers and valley-floor pools. Anvil's
carve and ridge weights came down with it — 92% of cap left the assertion no
headroom and read as spikes rather than landscape.

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
- raiders too harsh → `RAIDER.dps` first (under 0.92 a growing site out-heals one
  attacker, over it does not — that one number is the difficulty curve), then
  `RAIDER.spawnBase` and `spawnPerDome`
- colonies decaying while you are away → `DEFENCE.turretFrom` down, `turretDps` up
- the beam too strong / too cheap → `DEFENCE.beamDps`, `beamCost`, `beamRange`
- the overlay too cluttered or too dim → `OVERLAY.blobBase`, `blobPerDensity`,
  and `OVERLAY.wireframe` (false keeps the markers and drops the x-ray look —
  which is also the whole of its GPU cost, see below)
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

## Travel

Speed scales with altitude above the nearest surface. There is no warp button
and no mode to switch into: climb, and you go faster.

```
v(a) = 158 x 2^(a / 1750)     capped at 1,000,000 m/s
```

Integrating that is the whole design. Time to climb away from a world is
`H·2^(-a0/H) / (v0·ln2)`, which **converges** — the trip costs the same whether
the destination is 300km away or 850km, because the middle of the journey is
spent where distance is free. Out and down the other side is twice that, and
because the law reads altitude above the NEAREST surface, deceleration into the
destination is the same curve backwards. There is no braking input because none
is possible, and no way to arrive fast.

`HYPER.doubleEvery` is the only knob that moves trip time. Raising the cap
changes the number on the HUD and about a third of a second of the journey.

**Leaving has to be deliberate.** The jet's thin-air ceiling is a wall at ~580m
whether you climb for four seconds or twenty-five, so altitude alone cannot tell
"pulled up hard over a canyon" from "going somewhere". Boost is what separates
them: above the ceiling a held boost keeps a floor of thrust (`JET.escapeThin`),
and that is the only way past the 900m boundary. Let go and you sink back.
Measured: hands-off cruise tops out at 125-199m, a six-second boosted climb at
808m, a sustained burn crosses at 8.7s.

**The FX are one number.** `craft.hyperT` is the log of the speed over its range,
so it rises and falls symmetrically with altitude for free — FOV, boom length,
velocity lines, chromatic split, grain, vignette, the engine mix and the readout
all read it and nothing else. There is no state to leave switched on.

**The 400m boundary is one surface used for both directions.** Inside a planet's
approach sphere flight is local; outside every sphere it is hyper. That is why
travel cannot begin from inside one — it is the definition, not a rule someone
had to enforce. Departure additionally requires *climbing* through it, or an
arrival (which is handed back at exactly that altitude) would depart again on
the frame it landed.

**Tunnelling is the whole reason `hyper.js` exists.** At the cap a frame is 33km
long and Ember is 414m across, so a per-frame `pos += v·dt` misses every world in
the system — measured, in the suite: 1 starting range in 40 registers the hit.
The position step is solved in closed form and the resulting segment is swept
against six spheres, which makes arrival a property of the geometry rather than
of the frame rate. The suite fires a craft at Ember from 1000km at 20, 30, 60 and
144fps and the trip time varies by 33ms.

Arriving swaps the world: terrain, water, sky, discs and materials are rebuilt
around the new profile, while the survey log and the colonies you left behind
keep their records and release only their meshes. Fly back and the habitats are
still growing.

## The colonisation economy

**Density is the single axis.** A site's density is its own dome count plus its
neighbours', falling off over a radius that scales with the planet, and hyper
output is `density^1.3`. Clustering already pays at an exponent of 1.0 — a site
counts its neighbours — so the exponent is what turns "worth doing" into "worth
planning": measured, four colonies in one basin produce **3.8x** what the same
four scattered do.

**Geysers are the only place a coloniser makes hyper fuel.** Anywhere else it
builds a habitat that pays flight charge, exactly as before. So the map has an
objective, and progress is `claimed / total` per world — finite and countable,
which surface coverage would not be. Every world has a field, sized and placed
to suit it: Tarn's vent through shallow water, Vault's through the ice, Ember's
out of the fissures. That is also the anti-soft-lock rule in geological form —
stranded anywhere with an empty tank, the worst drive to a vent is 1.3 minutes.

Two resources, and they never compete: **charge** flies the jet and comes from
every colony; **hyper** crosses between worlds and comes only from vents. A trip
is priced by distance and checked *before* the craft commits — the escape burn
stops you leaving by accident, the trip check stops you leaving by mistake.

Production reads the permanent `sites` record and never a mesh, so every visited
world earns while you are somewhere else, and the record survives a reload:
directions, ages and claims are saved, and the dome layouts regenerate from
their seeds exactly as they do when you drive back into range.

## The survey overlay

Hold `Q` and the planet goes transparent. Colonies are glowing volumes sized and
lit by density, vents are blue columns with claimed distinct from open, raiders
are red and brighten as they close, and whatever is nearest the middle of the
screen gets a heading, a range and a line of detail. The same key carries the
**system view** — six worlds with progress, production, threat and what the trip
costs — so where to go next is a decision you can make without going there.

**It is not a convenience.** Horizon distance at a 2m eye is 29m on Ember and
91m on Anvil: you cannot see your own colonies past the curve of the world you
are standing on, so some instrument is mandatory. An x-ray chart is the one that
belongs in a game whose art direction is a topographic map you drive around
inside.

**How it draws through terrain.** Everything the overlay makes goes into
rendering group 2 and the depth buffer is cleared before that group runs;
terrain and every gameplay mesh are group 1. That is the exact behaviour the
GlowLayer was thrown out for in phase 1 — there it happened by accident and was
wrong; here it is the feature, and it is off unless a key is held.

**There is no range limit, and adding one would be a mistake.** Markers are
drawn at world scale, so difficulty scales with radius out of the geometry:
measured at a nine-pixel marker, the legible fraction of a world is Ember 100%,
Home 100%, Vault 100%, Shroud 66%, **Anvil 32%**. Nobody wrote those numbers;
they are what a 2.4km legible range does to spheres of six different sizes.

Blobs are additive and do not write depth, so two colonies in a line read as one
brighter mark. The brightest blob is the biggest cluster, which is the most fuel,
which is also the most raider pressure — the same number arrived at three ways.

### What it costs

`node dev/perf.mjs` plants a save-game's worth of world, then alternates between
key-up and key-held frames and takes the median of the per-pair differences.
Alternating is not fussiness: a first version timed one state and then the other
and reported +102ms on one run and +0.9ms on the next from the same build, which
is drift, not measurement.

The CPU side of the pass is 20µs a frame for 16 markers — a 60fps frame is
16,700µs — and that is measured in the suite. The GPU side, in headless Chrome
on **SwiftShader**, a software rasteriser where the base frame is already ~150ms
and 33 markers are up:

| held, with | cost |
|---|---|
| markers + tint + terrain wireframe | **+74.5ms, 53%** |
| markers + tint, `OVERLAY.wireframe = false` | **+11.7ms, 7%** |

So **85% of what the overlay costs is the wireframe**, and the instrument itself
— 33 additive markers over a finished frame — is 7% of a software frame. The
wireframe turns 215k triangles into 645k lines for a rasteriser with no hardware
to do it with, which is the worst case that exists; one flag drops it and keeps
every marker. Read the absolutes as the pessimistic bound they are, and the
ratio as the real finding.

The x-ray tint deliberately carries no `backdrop-filter`. It is held for as long
as you are reading a chart, and a full-viewport filter is a frame readback per
frame — the flat tint says the same thing for nothing.

## Raiders, and three defences that are not weapons

Colonies are attacked on wall time, by the same rule production already follows:
a raider's whole state is an age, a target and a hit-point count, and its
position is *derived* from those rather than integrated. A world left alone for
twenty minutes has been under attack for twenty minutes, and simulating it costs
six numbers per raider.

**Raiders are drawn to density**, weighted by `(density + 1)^1.6`. Measured over
40 minutes: a four-site basin takes 96% of the contacts against a lone site of
the same maturity taking 4% — 23x the traffic for 4x the domes. That is the bill
for the 3.8x that clustering pays, and it is what makes where you drop a probe a
bet rather than an optimisation.

There is **no projectile system**, deliberately: bolting a shooter onto this
game is a genre mismatch and a large build. Three layers instead, all of them
systems that already existed.

1. **The scanner beam.** `survey.js` already owned scanning as a verb — park,
   hold still, get paid. Held down and pointed at something moving, the same
   instrument disrupts a raider in 1.9s for 5 charge a second. Available from all
   three forms, because a form that cannot defend itself makes the transform a
   trap. It cuts out above zero rather than stranding you.
2. **Turrets, on wall time.** At 5 domes of density a site grows one, and it
   answers anything within 140m — including over the young site you just dropped
   beside it. This is what makes the away game work. Without it every world you
   leave decays, the correct strategy becomes not colonising, and the economy the
   last phase built is a chore with extra steps.
3. **Momentum.** Contact above 16 m/s kills. No ammunition, no cooldown, no
   upgrade: it is always the desperate option and never the plan.

Each world's threat is its own — Ember 13s of warning, Vault twice the armour and
46s, Shroud no mesh at all past 70m so the overlay is the only warning it gives,
Anvil numerous and thin, Tarn approaching from whichever bearing the ground falls
away toward, which on an 86% ocean is the sea.

### The balance, in numbers

Erring toward too easy is deliberate: a threat that is trivial is boring for one
session, and a threat that makes expanding a mistake is a broken game.

- A dome is 22 hit points and arrives every 24s; a raider does 0.85/s. **A
  growing site gains integrity faster than one attacker removes it** — building
  is the first defence. Two attackers raze a fresh site 123s after landing.
- An undefended site has 65s of integrity per attacker.
- A site is self-sufficient at 5 domes of density, ~120s after landing. One
  mature site alone survived an hour and killed 53 raiders.
- A four-site mature basin, left for an hour with nobody watching: **4 of 4
  alive, worst integrity 99%, 149 raiders destroyed.**

### The away window

Time the tab was shut is **replayed**, not credited. Sites come back at the age
they were saved at and then every world runs the window through its ordinary
`tick`, so colonies grow through it and raiders attack through it, out of one
mechanism. Crediting only the growth — which is what this shipped as first —
makes closing the tab strictly better than playing, and that is a perverse
incentive whichever way you look at it.

Both halves share one cap, so three days away costs the same hour as one. The
replay is silent and pays nothing: no dome announcements, no raider toasts, no
charge income for an hour nobody was holding the controls — one summary line
when you press Begin, and that is all. It runs at a 2s step, which is measured
to give the same outcomes as 1s (a 4s step does not) for 59ms at boot across six
worlds and thirty sites.

What an hour away actually costs, measured: **a basin of five loses nothing on
any of the six worlds**; five isolated singles come back 28 of 30. A site planted
ten seconds before closing, alone, comes back mature at 98%.

That last number is why the **armour term on turret damage** exists. Turret
damage scales with the local raider's hit points, so a turret takes the same
36.3s to kill on Vault as on Home. Without it Vault's 1.9x armour silently meant
"turrets here are half as good" and cost four of five mature colonies in an hour
away while every other world lost none. Armour is meant to change what *you* do
about a raider — 3.5s of beam instead of 1.9 — and the away game is a promise
that should not vary by world.

## Tests

```bash
node dev/run.mjs
```

Stubs Babylon and executes the real gameplay modules — geometry integrity,
chunk streaming and recycling, 3060 frames of physics across all three forms
checking for NaN and terrain penetration, fuel bounds, prop streaming, the hop
arc and its suspension travel, flooding and recovery, a standstill jet launch
and the autopilot's altitude hold, colonies growing and streaming, and that the
audio degrades to silence when there is no context — plus, since Phase 3a2, that
every world resolves a complete sky and palette, that the ice rule is confined to
Vault at every depth the other five reach, and that Ember's baked emission mask
is bit-for-bit the field `height()` cuts with, and — since Phase 3b — that a
craft at a million metres per second does not fly through a 414m planet, and
that four colonies clustered out-produce four scattered — plus, since Phase 4b,
that the overlay's markers all land in the depth-cleared rendering group, that a
world nobody is rendering takes exactly the damage a closed form says it takes,
that raiders concentrate on the densest ground, that a mature cluster survives an
hour alone while a young isolated site does not, and that the beam works from all
three forms and charges for it, and that closing the tab does not protect a colony. 178 checks. Run it after touching `noise.js`,
`sphere.js`, `craft.js`, `chunks.js`, `scatter.js`, `hyper.js`, `colony.js` or
`raiders.js`.

The winding checks earn their keep. Three separate meshes here have now been
built inside-out — boulders, then habitat domes, then tubes — and the
signed-volume assertion is the only thing that catches it without a screenshot.
The same goes for `SUSP.rollSign`, which was inverted on the first attempt.

```bash
node dev/shots.mjs            # all six worlds, ground and sky, plus contact sheets
node dev/shots.mjs ember      # just one
node dev/shots.mjs --tag before --size 1280x800
```

Boots the real game once per world in headless Chrome, waits for the chunk queue
to drain rather than sleeping, and writes `dev/shots/sixup.jpg` — six worlds side
by side, which is the only way to ask whether two of them are interchangeable. It
also fails on any console error, page exception or CSP refusal, so a world that
renders but throws does not pass on the strength of a pretty picture. No npm: it
speaks the DevTools protocol over node's built-in WebSocket.

This closed the gap the tests could never cover. An inside-out boulder field, a
rover riding 1.5m in the air and a jet that could not take off were all invisible
to `run.mjs` and obvious in a single screenshot — and the first six-way sheet
immediately showed two spires next to Home's spawn that no assertion objected
to.

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
