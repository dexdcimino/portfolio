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
    materials.js      the shaders: terrain, water, sky, disc, craft, and the two
                      depth passes
    chunks.js         cube-face quadtree + skirts + the baked fissure mask
    scatter.js        rock geometry, baked into leaf meshes. One profile per world
    water.js          static sphere shell, CPU-fed depth attribute, the ice rule
    seabed.js         the water's depth pass. Renders the terrain's distance
                      from the camera so the water can ask how much of itself is
                      between the eye and the ground, per pixel, instead of
                      interpolating a 40m vertex grid
    sky.js            one parameterised dome; the numbers live in tune.js
    discs.js          the other five worlds, camera-relative billboards
    shadows.js        the cast-shadow depth pass. Own render target, own ortho
                      camera, own depth material — not Babylon's ShadowGenerator
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
dev/glslcheck.mjs     imported FIRST by run.mjs, because it is the one check that
                      has to run before the import chain reaches materials.js: a
                      backtick inside a shader template closes the literal, and
                      the SyntaxError names a GLSL identifier
dev/shots.mjs         six-way screenshot harness — drives real Chrome over CDP
dev/frames.mjs        camera set-ups shared by the harnesses, so they cannot
                      drift onto different pictures. The shoreline finder lives
                      here
dev/noop.mjs          proves a new term is neutral by flipping it inside one
                      frozen frame. shots.mjs cannot: two runs over identical
                      code differ in 85% of their pixels
dev/waterstats.mjs    reads the water debug modes back as distributions, and
                      what the depth pass costs
dev/waterangles.mjs   whether brightness still tracks depth at five viewing
                      angles on every world — the one acceptance criterion that
                      cannot be checked from a frame shot at one angle
dev/spawncheck.mjs    where the craft starts and what it does in the first
                      second, by boot and by dev warp
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

## Cast shadows are hand-rolled, and Ember has none

Its own pass after T3, on the roadmap's reasoning: T3's risk was whether the
contours survived a texture pass, and shadows in the same commit would have made
a wrong-looking frame unattributable.

**Not Babylon's ShadowGenerator.** It exists to inject itself into
StandardMaterial and PBRMaterial — the same reason the last three transplants
left their files behind. Using it would have meant decoding a map whose format
Babylon picks at runtime from device capabilities: standard or exponential,
packed RGBA or float R. That is a decode that works on the machine you tested
and fails elsewhere as either no shadows or black ones. `shadows.js` owns the
lot instead: a render target, an ortho camera on the sun's axis, a depth
material writing `gl_FragCoord.z`, and one compare in the terrain shader.

**A shadow multiplies the key, never the fill.** That is the physical reading
and it is what stops this wrecking the cel look: a shadowed face falls to that
world's ambient floor, not to black. It also means T2 already decided, per
world, whether shadows read hard or soft — Vault's fill is 0 and its shadows are
hard; Tarn's is 0.22 and they are not. Nothing here had to say so.

**Ember has none, and that is a finding.** Its sun is declared "low, and barely
a sun at all" and its light comes off the ground. A directional sun shadow map
there draws shadows cast by a light that is not doing the lighting. Off, not
tuned down.

**The craft is not a shadow-map caster.** It was, and its map shadow was the
worst thing in the frame. Its shadow is the contact shadow instead — a
superellipse in the ground plane, oriented to the heading and sized to the form
you are driving — which is down-projected, never elongated, and identical on
every world including Ember, which has no cast shadows at all. Standard practice
for the one object always on screen, and it made this a deletion rather than a
new system.

**Home was the worst of the six and the cause was resolution, not depth.** A
400m box on a 2048 map is 19.5cm a texel, and the terrain casting into it is
flat-shaded triangle soup with a 14m LOD skirt on every chunk edge —
discontinuous at exactly the scale the map samples, which is acne no bias can
reach. It showed as a striped band running along the light. At 180m a texel is
8.8cm and the isolated shadow term comes back clean white. `SHADOW.debug` is
what showed that; it is worth reaching for before tuning a number.

Terrain still casts. The fallback was to make it receive-only if a tighter box
was not enough, and it was enough.

**Normal-offset bias, not a constant depth bias**, and the first cut had the
constant one. It cannot be made to work: the depth error across a texel grows as
1/cos of the angle between the normal and the light, so any value large enough
to stop acne on a slope has already detached the shadow on the flats. Both
failures at once, which is exactly what it looked like. Offsetting the sample
position along the surface normal moves it in the direction the error actually
lies, and one number then holds at every angle.

**The sun elevations here are 38-59 degrees**, not lookdev's 5.8. A 2m rover
casts 1.2-2.5m on the five worlds that have shadows. Ember is the only low one
at 13.9 and its shadows are off. Worth knowing before anyone reaches for the
sun angle to fix a shadow problem — on this project it is not the cause.

Two things cost a while to find and are worth not rediscovering. Babylon's
Camera constructor registers every camera in `scene.cameras` whatever you pass
it, and T1's SSAO2 runs off the prepass — which follows every entry in
`scene.customRenderTargets`, including this one, and then throws inside its own
post-process with nothing of ours in the stack. `noPrePassRenderer = true` is
the fix. And the shadow box is snapped to a texel grid before it is centred, or
the shadows swim as you drive.

## The art pass: six atmospheres, and vegetation with a silhouette

### Atmospheric thickness is the axis, and stars are how you read it

The six skies were variations of one sky. They are two families now, split on
whether there is any air:

| | world | reads as |
|---|---|---|
| **thick** | home | blue, a real broken cloud deck, a proper daytime sky |
| | tarn | bright, humid, low contrast, a nearly solid low deck over open water |
| **thin** | vault | cold and clear, deep blue overhead, **stars through the daylight** |
| | anvil | high and washed out, pale at the skyline, faint stars in the dark top |
| | ember | near-black sky; the orange is the GROUND lighting the deck from beneath |
| **neither** | shroud | no sky at all. Flat violet murk, and you cannot see up |

**THERE WAS NO STAR FIELD TO TURN BACK ON.** The brief had it as already built
and switched off in the re-grade. `svStreak` is the hyperspace velocity lines
and its own comment says why — *"star streaking, without stars. There is nothing
out there to streak."* So this is new, and analytic rather than a texture: the
view direction is quantised onto a grid, each cell hashed, most left empty. No
asset, no fetch, no atlas to keep in step.

Two things about it are worth keeping:

- **The units are the trap.** The grid is 190 cells across a unit direction, so
  a cell is about 0.3 degrees — roughly three pixels here. The first cut set the
  star radius to 0.055 *of a cell*, which is a fifth of a pixel, and the sheet
  came back with no stars at all on either world that had asked for them.
- **Above 1.0 is the useful range.** A star has to compete with a sky already at
  half brightness. At amount 1.0 they were technically present and invisible;
  authored past 1.0 the bloom pass finds them, which is how a bright point is
  meant to read and is what the sun and Ember's fissures already do.

Cloud gained a **broken deck** term: one extra octave at a much larger scale,
swinging the coverage threshold across the sky. At 0 the deck is even
everywhere, which is what all six shipped with and is most of why they read as
the same weather.

### The ALOFT cyan band was a hyper-arrival bug

Recorded last pass as a pre-existing sky defect. It is not a sky defect. It is
the **jet's wingtip TrailMesh**, three metres from the lens.

A TrailMesh accumulates points from its emitter's world position — right while
the craft flies, and wrong the moment it does not. `swapTo` moves the craft
across the solar system in one frame and the ribbon dutifully draws a segment
spanning the jump: a hard-edged phosphor band over the new world, backface
culling off. `dev/frames.mjs` teleports to altitude the same way, so the
reference frame was showing a **real bug rather than an artefact of the
harness**, which is exactly backwards from how it had been read.

`Trails.resetJetTrails()` throws the ribbon away and starts a new one, and
`swapTo` calls it. `stopJetTrails` alone does not hold, because `update()`
correctly rebuilds the ribbon on the next frame whenever the craft is in jet
mode and the list is empty.

**How it was found matters more than the fix.** Two rounds of
toggle-a-mesh-and-difference gave *every mesh in the scene the same delta*,
which is not what a culprit looks like — first with the post stack on, then with
it off and warm-up frames added. What answered it in one shot was
`scene.multiPick` through the pixel: ask the scene what is there, instead of
asking the framebuffer what changed. Reach for a pick ray before a diff.

### The third instance of the constructor-caching bug

Swept the whole family as asked. Everything that caches a `planet` is either
constructed inside `World` — rebuilt per planet — or explicitly re-pointed in
`swapTo`. There was one more.

`main.js` holds a module-level `const surface`, built from the boot planet. It
has to exist, because a `Craft` needs a surface before a `World` can be built,
but nothing ever writes it again: `swapTo` replaces the *craft's*. Exposing it
as `SURVEYOR.surface` meant that handle, and `SURVEYOR.surfaceHeight`, quietly
answered for whichever world the tab opened on, forever.

Nothing in the game reads it after boot, so it never showed. What reads it is
`dev/frames.mjs`, which builds the ALOFT and SHORE cameras out of
`S.surface.frame` — so a harness that warped would have framed one world's shot
with another world's tangent basis and reported it as fine. It is a getter onto
`craft.surf` now; there is no second copy.

### Vegetation: four layers, and the tree is the one that mattered

Placement was never the problem. The silhouette was. One form repeated is why a
field reads as texture, so there are four:

| layer | tris | what it does |
|---|---|---|
| cover | 3 | the ground layer |
| shrub | 12 | a splayed rosette. Breaks up the ground plane |
| tree | 20 | trunk and a tiered canopy. **What reads from a distance** |
| hero | 32 | rare, larger, worth driving toward |

The trunk does not sway — a tree that bends at the root reads as rubber — and
the canopy tiers sway increasingly with height, so the crown drifts while the
trunk holds. Distribution is stated per layer rather than per world: trees take
a low band and a gentle slope, which is a valley near water; cover takes a wide
band and a steeper limit, which is a flat or a hillside; nothing takes a cliff.

**Scale was the whole of the second attempt.** Trees at 5-9.5m put a plant
beside the chase camera that filled the frame on its own. The camera sits 5.2m
up and 15m back and the rover is three metres long; 2.8-5.2m is a tree.

| world | stack | why |
|---|---|---|
| home | all four | the lush one, and the first world anyone sees |
| tarn | cover, shrub, tree | coastal, everything inside the first fifth of relief |
| shroud | cover, hero | rare and large. NO tree layer, deliberately |
| anvil | cover, tree | a few tufts and stunted trees in the canyon floors |
| ember, vault | none | and paying nothing |

**Shroud has no tree layer, and that is the point.** A tree layer is a canopy —
enough of them at enough density that a world reads as wooded, which is Home's
job. A mid-density stand of thin trees was quietly turning the murk into a
forest with poor visibility rather than into a place you cannot see. The hero
layer carries Shroud alone, at nearly twice the density it has anywhere else and
still under one plant per leaf.

Tier drops **layers, not quality**, and it drops `shrub` and only `shrub`. The
first cut dropped hero too, assuming the biggest form must be the expensive one.
It is the opposite: hero is two attempts per leaf against cover's 260, so it is
the cheapest layer in the stack by two orders of magnitude and the highest value
per triangle — it is a landmark. And dropping it is not a uniform loss, because
Shroud now carries its whole character there: a low tier would have been ground
cover in fog with no reason to look up.

### Why there are no downloaded models, in numbers

The brief asked for CC0 models from Quaternius or Kenney. Both are reachable
from here and the glTF loader bundle is 578KB, so it was possible. It is still
the wrong call, and the arithmetic is the argument:

- a max-detail leaf is about **2100 triangles**, rocks included
- a stylised CC0 tree is **400 to 2000 triangles**
- fifty of them in one leaf is **20k to 100k** — seven to thirty-five times the
  entire leaf

Real models are affordable only as **instances**, and instancing is precisely
what this design does not do: the ground is a stream, and a baked plant needs no
draw call, no separate culling, no separate LOD and no lifetime of its own. The
brief also says to keep that machinery. Both cannot be true at once, and this is
the half that was chosen.

What is here instead is generated geometry at 3 to 32 triangles a plant — the
same technique that produced the rock spires nobody calls procedural. If real
models are wanted, the path is instancing plus the vendored loader, and that is
a different architecture from the one this pass was told to keep. `blade()`,
`shrub()` and `tree()` in `flora.js` are the only structural things that change.

### What the cost measurement is actually worth

Exact and reliable: **11974 plants on Home across 174786 triangles, and the draw
call count does not move on any world.** CPU leaf build, timed in Node against
the 6ms budget asserted in `dev/run.mjs`: **2.8ms**, stable run to run.

Not reliable: the render-side frame delta — and `dev/floracheck.mjs` now says so
itself rather than printing a number. Ember and Vault emit zero plants, so their
"with" and "without" frames are the same picture and any difference between them
is the rig: **a 49.9ms floor on a roughly 300ms software-rasterised frame.**
Every vegetated world lands inside it, and one run had Shroud rendering *faster*
with vegetation than without, which is the clearest available statement that the
instrument does not resolve this.

Three things had to be fixed before even that was true, and each produced a
confident wrong number first: a mean over a block of frames (the same world at
+4.3% and +25.3% on consecutive runs), a comparison that straddled a field
rebuild, and — once `ChunkField` began caching its resolved stack — a control
that mutated `planet.flora` and therefore changed nothing, reporting Tarn at
**+9527%** because it was comparing a full world against a nearly empty one. The
harness now refuses to compare two scenes that are not the same scene minus the
vegetation.

## Vegetation is part of the ground, and five worlds do not have it

**NOT INSTANCED, DELIBERATELY.** The brief asked for instanced geometry with
vertex-shader wind, and instancing is the right answer in an engine where the
ground is a static mesh you scatter onto. This ground is a stream: chunks are
built, dropped and rebuilt as you drive, at five LOD levels, and every one is a
fresh mesh. An instance buffer would need its own lifetime tied to a mesh that
is already being thrown away, its own culling, its own LOD and its own draw call
per chunk. Rocks solved that years ago by being part of the ground they sit on,
and vegetation does the same: same buffer, same material, **no extra draw
calls**, streams and culls with the terrain because it *is* the terrain.

**THE WIND IS ONE VERTEX ATTRIBUTE.** `sway` is -1 for terrain, skirts and
rocks, 0 at a blade's base and 1 at its tip. The sign is the flag, the magnitude
is the bend weight, and it is squared in the shader so the tip travels while the
base stays planted — weighting it linearly shears the whole blade sideways and
reads as a sliding decal. The oscillation phase is **hashed from world position**
rather than stored, which costs nothing and means neighbouring blades are never
in step; hashing the world position rather than the leaf-local one is what keeps
a clump moving together across a chunk boundary, where the local origin jumps.

**THE TINT IS AN ALBEDO AND GOES WHERE ALBEDOS GO.** The first cut mixed the
vegetation colour in after the cel light bands, which made every blade a flat
unlit colour on a lit hillside: it read as bright paint and did not turn with
the sun.

### Who gets it

| world | density | band (of relief) | why |
|---|---|---|---|
| home | 1.0 | 0.02–0.55 | the reference. The point of five bare worlds is that this one feels alive |
| tarn | 1.25 | 0.03–0.18 | coastal only. 86% ocean, so the composition is a green shoreline against a bare hinterland |
| shroud | 0.10 | 0.02–0.22 | sparse, tall, violet. Something growing, not a lawn |
| anvil | 0.04 | 0.01–0.10 | a few tufts in the low ground of the biggest world in the system |
| ember | 0 | — | basalt and fissures |
| vault | 0 | — | glacier |

`density: 0` costs **nothing**: `appendFlora` returns before it seeds an rng, no
vertex carries a sway other than -1, and the shader branch is never taken.

### What it costs, and what the measurement is worth

`dev/floracheck.mjs`, SwiftShader, 900x560, chase camera on the spawn:

| world | blades | triangles | draw calls | frame cost | wind moves |
|---|---|---|---|---|---|
| home | 26957 | 203411 | 234, unchanged | +6.3% | 0.12% of frame, peak 99 |
| tarn | 4235 | 80397 | 196, unchanged | -0.9% | 0.23% of frame, peak 149 |
| shroud | 1403 | 119921 | 270, unchanged | +0.9% | 0.04% of frame, peak 50 |
| anvil | 195 | 154185 | 254, unchanged | +2.1% | nothing measurable |
| ember | 0 | 52384 | 161, unchanged | -27.1% | — |
| vault | 0 | 123312 | 224, unchanged | -2.7% | — |

**Read the last two rows before the first four.** Ember and Vault have ZERO
blades, and the same measurement reports -27.1% and -2.7% for them. That is the
noise floor, and it is wider than most of the costs above it. Every figure in
that column except Home's is inside it.

So what the run establishes is the SHAPE of the cost, not four significant
figures of frame time: blade counts, triangle counts, and draw calls that do not
move on any world. Ember's -27% is the honest reminder of why — its frame is
2.4ms, so a fraction of a millisecond of scheduling noise is a quarter of it.
The two bare worlds are the control and they came for free with the design.

**THE WIND READS, and that is measured too** rather than judged from a still,
because a still cannot show it. Two renders at different `uTime` with the loop
stopped and the particle systems off, differenced: Home moves 0.65% of the frame
with a peak channel delta of 99, Tarn 0.23% at 149, Shroud 0.04% at 50. Anvil's
195 blades move nothing measurable, which is the honest result of asking for
almost none.

### The cost that nearly landed was on the CPU, not the GPU

`dev/run.mjs` failed on **"a max-detail leaf builds inside the frame budget"** at
16.77ms against 16, and nothing on screen looked wrong. Placement was testing
height AND slope per blade — three `height()` evaluations each, times the attempt
count, is thousands of noise lookups per chunk, paid every time a leaf streams
in while you are driving.

A clump is a couple of metres across and the ground under it does not change
slope within that, so the slope is measured **once at the clump's centre** and
the whole clump lives or dies by it. Blades still take their own `height()`,
because one floating above the ground or buried in it is visible immediately.
Leaf build went 16.77ms → 5.23ms.

Worth stating plainly: the render cost was inside the noise floor the whole time
and the build cost was over budget. The frame-cost risk in a streaming world is
not always where a "frame cost" measurement looks.

### Where it is not finished

The geometry, the streaming, the wind and the per-world gating all work. **The
art does not read yet.** At the chase camera's 15m and the worlds' scale, an
individual blade is a small triangular spike hard to tell from a small rock, and
three tuning passes — taller, wider, denser, patchier, hue pulled toward each
palette — improved the distribution without solving that. It needs either a form
that reads as a clump at 15-40m rather than as a blade, or a camera that gets
closer to the ground than this one ever does. The numbers above are the budget
that form has to fit inside, and there is room in it.

## The sky pass: a real gradient, a cloud deck, and the skyline it belongs to

**THE HORIZON BAND NOW SITS ON THE HORIZON.** The band, the haze and the
underglow were all drawn at zero elevation in the local frame. That is the
visual horizon at ground level and nowhere else: at altitude h on a planet of
radius R the skyline sits below local level by `acos(R / (R + h))`. These are
small worlds, so that angle is not small — 11.4 degrees at 2% of any world's
radius, 29.6 at 15% — and the band floated that far above the skyline it was
supposed to be drawn on. `mats.update` feeds the sky the elevation of the true
horizon per frame and every horizon-referenced term measures from it.

It is a **no-op at zero altitude by construction**, because the dip is exactly
zero there. That is what let it ship without re-approving six surface skies, and
it is the same guarantee the fog altitude rule carries. `dev/run.mjs` asserts the
exact zero; `dev/skyline.mjs` measures the band's actual position on screen.

`dev/skyline.mjs` is worth reading before writing another one of these, because
it was wrong three times and each wrong answer looked plausible:

| what it did | what it reported | why |
|---|---|---|
| aimed at local level | band off-frame above 6% radius | the dip exceeds the half-FOV almost immediately |
| centroid of the whole difference | 12% of the dip, every altitude | the band is mixed over a base that darkens below the skyline |
| summed whole rows | a constant degree of error | a line of constant elevation is a CONE, and projects as a curve that rises at both edges — only the centre column is flat |

With the ground hidden, the sky flattened to one colour, and a narrow centre
column, the band lands on the true skyline within 0.05° at every altitude on all
six worlds. The same run reports where it *used* to be drawn: up to 30° higher.

**THE GRADIENT RUNS THE WHOLE SKY.** The old ramp was
`clamp(el * 1.25 + 0.06, 0, 1)`, which reaches the zenith colour at an elevation
of 0.75 — the top forty-one degrees of every sky was one flat field. It is three
stops with a per-world curve now, and the ten-step cel quantisation that was
hardcoded is `SKY.bands`/`SKY.bandMix`.

**THE CLOUD IS A DECK SEEN IN PERSPECTIVE.** Dividing the horizontal view
direction by its elevation projects the ray onto a plane at fixed height, so
shapes compress toward the skyline the way a real layer does. The field is
value-noise fbm; the octave count is a uniform, tier-gated, and the loop breaks
early because GLSL ES 1.0 wants a constant bound.

That also **killed Ember's slab**, which was never cloud-shaped: `sin(a)*sin(b)`
through a smoothstep is a level set of a product of sines, a rounded
quadrilateral with a boundary 0.16 wide in a quantity that swings over 2. Over a
near-black cloud colour and a 1.5 orange underglow that boundary was a
hard-edged bright slab.

The first cloud numbers shipped **no cloud at all on all six worlds**, and the
reason is worth keeping: cover 0.52 with soft 0.34 runs the smoothstep from 0.52
to 0.86 across a field whose measured standard deviation is 0.139. The top of
the ramp was two and a half sigma out. `soft` has to be the same order as the
field's own spread or only the threshold matters.

**SCATTERING** replaces a smoothstep that cut off hard at fourteen degrees —
that corner is the seam the horizon met the sky at from the air. `gain` is the
one genuinely new term, added rather than mixed so it can push past 1.0 and
bloom, and it shipped at zero on every world before being authored. It is the
bright band behind Anvil's mesas.

**THE PARTICULATE LAYER EXISTED AND WAS UNREACHABLE.** `Trails` read
`craft.surf.planet` once in its constructor and nothing ever wrote it again, so
Ember's ash and Shroud's murk were authored, resolved correctly by `skyOf`, and
then only ever built against whichever world the tab opened on. Flying to Ember
got you Home's pale drift in an ash storm. Same class as the sky domes: a
per-world thing built once at boot and never re-pointed. Tarn's sea spray is new.

### Still there: a cyan band in the ALOFT reference frame

`dev/shots/*-aloft.png` has a hard horizontal teal band above the horizon on
Home, Vault, Shroud and Anvil. It is **not** new — it is in the sheets committed
before this pass, on the same four worlds — and it is not one of the two defects
this pass was for, so it is recorded rather than fixed.

What is known: it is not the clear colour (repainting the background magenta
leaves it teal), and it survives removing the jet's wingtip ribbons. It is the
same teal on four worlds whose palettes are nothing alike, which points at
something drawn from `COLORS` rather than from the world's own palette. A patch
bisection over every enabled mesh was inconclusive because the post stack's grain
moves the patch as much as the candidates do — anyone picking this up should turn
post off first, which is the lesson `dev/disccheck.mjs` already learned the hard
way.

Separately and confirmed: `dev/frames.mjs` entered jet mode and *then* teleported
the craft, so the wingtip TrailMesh drew a ribbon from the old position to the
new one. That is a teleport artefact no player can produce and it no longer
appears in the reference frames.

## The giant disc was six sky domes, and it hid behind an empty profile

**It was never the sun and never a planet disc.** The thing dominating the sky
on a cold load — hard-edged, faceted, dead centre, in a colour belonging to
another world, with terrain drawing over it — is another world's SKY DOME.
Several of them, in fact.

`Worlds.get()` constructs a whole `World`: sky dome, water shell, disc set.
`Worlds.enter()` is the only thing that has ever called `setActive(false)`, and
it only calls it on the world you are LEAVING. Babylon enables a new mesh by
default, so a World that is built but never entered is fully visible while its
own `active` flag says false. Nothing entered those worlds, so nothing ever
turned them off.

What builds a world you are not standing on is **the restore loop in
`main.js`**: for every world in the save file it calls `worlds.get()` to hang
the saved colonies off. So a cold load with a save drew **six sky domes, five
water shells and six disc sets at once**. The domes are spheres sized off each
world's own far plane, centred on the planet centre — which all six worlds
share — so they are concentric shells from 2295m to 22968m across with the
camera sitting 1052m out. You are inside some and outside others. The ones you
are outside hang in the sky as faceted balls painted in that world's sky
gradient; the ones you are inside wash the frame with it. They do not move off
centre because they are centred on the planet, not on you, and terrain draws
over them because the dome is `renderingGroupId` 0 with depth writes off.

Both of the things that made this look impossible fall out of that one fact.

**Why every measurement said everything was fine.** Every harness in
`dev/` launches Chrome on a throwaway `--user-data-dir`. localStorage is empty,
`economy.load()` returns null, and the restore loop never runs. One world, one
dome, clean numbers — and a real bug on any browser that has ever played the
game. The sun's `uSunCos` genuinely was identical cold and warped. The planet
discs genuinely do draw at 3.9-6.8 degrees on all thirty world pairs. Both
measurements were correct and both were measuring the wrong object.

**Why warping appeared to cure it permanently.** Warping into a world and out
again is the only path that runs `setActive(false)` on it. Once you had been
somewhere, its dome was off for the rest of the session, and no reload meant no
restore loop meant nobody noticed until the next cold start.

The fix is the invariant, stated once in the constructor: a world is visible
only while it is the current one. `showMeshes()` is shared by the constructor
and `setActive` so the two cannot drift apart. It is asserted in TWO places, on purpose.
`dev/run.mjs` builds six real Worlds against the headless stub and checks that
entering one draws exactly one — five assertions, in the fast suite, because
"only one of these is visible" is silent when it breaks and nothing else looks
at it. `dev/savedworlds.mjs` then proves the other half in a browser: that the
restore loop in `main.js` is what calls `get()` in the first place, which is
wiring the stub does not run.

Extending the stub to construct a whole World — textures, render targets,
cameras, `Vector4` — was the price of the first of those, and it is worth
paying: world-level behaviour is now testable in a suite that runs in seconds.

## The halo was the sun, the camera never landed, and the pointer vanished

**The cold-load sun was not a different sun.** The report this came in on said
the oversized disc appeared on a fresh load and went away for good the moment
you changed worlds — so the boot path was supposed to be missing something the
swap path applied. It is not, and that is worth writing down because the fix
that follows from a wrong diagnosis is usually worse than the bug. Both paths
run the same `createMaterials`, and reading the sky material's `uSunCos` out of
the live page on a cold load and again after a warp gives the same four
cosines on all six worlds, to the last digit. Rendered and measured the same
way, cold and warped-to frames agree to within 0.01% of the frame's bright
pixels. There was never a boot/swap divergence to find.

**What was true is that the halo was still half the frame — because `sunSize`
multiplies it.** The previous pass stated the sun's size in degrees and reported
0.98 to 2.24 across. That is the CORE. The number you actually see is
`haloAngle * sunSize`, and `haloAngle` was 14 with two worlds setting `sunSize`
1.6: Ember and Shroud were drawing a **22.4 degree halo into a 54.4 degree
frame**, 41% of its height before bloom and about half after. The core was never
the thing anyone was complaining about. `SKY.haloAngle` is 5 now, so the worst
case on any of the six is 8 degrees — 15% of the frame — and the spreading is
bloom's job, which is where it belongs. Isolated by rendering each world twice,
once with `uGlare` at its authored value and once at zero, and differencing: the
sun's own footprint is now **under 0.8% of the frame's pixels** on every world.

**The camera arrived inside the planet, and it was a frame-of-reference bug.**
The chase camera computes its framing in the craft's tangent frame and then
springs toward it in WORLD space. Both halves are right while you stay on one
planet. The instant you are on another, `camera.position` is still a point on
the world you left — and on a sphere of a different radius that point is usually
inside this one. Nothing threw; the camera simply interpolated up out of the
rock, every arrival, on every world. `ChaseCam.arrive` is the fix: build the
settled boom exactly as `update` does with the orbit at rest, run the same
terrain probe along its whole length, and WRITE position and aim instead of
lerping toward them. It is then lifted by `CAM.arriveLift` (26m) so the ordinary
spring still has a job, which is what makes an arrival read as a drop-in rather
than a cut. Called from `swapTo` for a real hyper arrival, and again at the end
of the dev warp because `craft.settle()` moves the craft after `swapTo` ran.

Measured by `dev/arrivecheck.mjs`, which samples the camera's height above the
ground under it for 120 frames after a warp. The metric matters: the first
version of that check measured height above SEA LEVEL, and a camera 7m over a
20m hill passes that and is still inside the hill. All six now start 28-34m up
and fall to the boom without a single frame below the terrain. The craft itself
was already fine — it settles 0.55m above ground, which is its ride height.

**And the pointer.** The system arrow is a dark glyph with a thin light keyline,
and on Vault's ice and Tarn's shallows that keyline is the only thing separating
it from the ground; over a bright shoreline it is simply gone, which is exactly
where you are aiming when you drop a beacon. It is drawn in `css/hud.css` now,
as a survey reticle in a `data:` URI — chart line-work, phosphor cyan, centred
on its own hotspot rather than hanging below and right of it. **Every stroke is
drawn twice**: a 3.6px casing in `--ink` first, then the 1.5px cyan line over
it, which leaves about a pixel of near-black either side of every cyan stroke.
That is what makes it legible on both a white glacier and a black basalt field,
and it is a property of the construction rather than of a lucky colour choice —
a single flat colour cannot do it in both directions. A second variant, ring
closed and filled, marks anything you can press, so the HUD never falls back to
a system hand. Every declaration ends in a keyword (`crosshair` / `pointer`), so
a browser that refuses the data URI gets a real cursor rather than none.

No file, no request, and it passes the deployed CSP: a CSS cursor image is
checked against `img-src`, and `/games/(.*)` allows `data:`. Verified under the
real `vercel.json` headers, on all six worlds and inside the `/surveyor`
wrapper's iframe, with no console errors and no refusals.

## The sun had a size, and the depth pass has a hole

**The sun was never screen-space.** It is drawn in the sky dome as a function of
`dot(viewDir, sunDir)` and nothing about it has ever been attached to the camera
— confirmed by enumerating every mesh Babylon draws and projecting each one's
centre through the camera at three headings, which found nothing that held its
screen position. What it was, was **enormous**. The two smoothsteps that draw it
were written as coefficients in cosine space, `1.0 - 0.055 * sunSize` and
friends, where nothing says how big that is. It worked out to a core between
7.4 and 11.2 degrees and a halo between 32 and 48, on a camera whose vertical
field of view is 54.4. The halo was 88% of the frame height and did not clear
the view until you had turned more than sixty degrees, which is a sun that reads
as welded to the camera. It is stated in degrees now — `SKY.sunAngle` — and
comes out at 0.98 to 2.24 across, against a real sun's 0.53.

**The coastline stroke was a fill.** It was a band in HEIGHT, `|h| < relief *
0.022`, which is a constant width only if every shore is equally steep.
Measured at 160 samples a cube face, the ground width that produced was a median
of 31m on Home, 33m on Vault, 39m on Shroud and 81m on Anvil, a fifth to a half
of it past 100m, and on Tarn it covered **56.8% of the land**. That is the broad
near-white apron that reads as neither foam nor shallows. It is a width on the
ground now — height band = width times the local gradient, the same trick the
contour engine three lines above it already used.

**And the depth pass does not contain the near field.** Picking rays through the
shoreline frame on Home and comparing the terrain they hit against the texel the
water reads:

| frame point | real terrain | texel in the target |
|---|---|---|
| (0.50, 0.75) | 31.9m | 181.1m |
| (0.35, 0.55) | 49.6m | 227.2m |
| (0.50, 0.50) | 55.9m | 358.0m |
| (0.65, 0.45) | 68.4m | 60000m (the clear value) |

Not one texel near the truth, and holes where the ground is closest. Every depth
the water derived from it was wrong, and the shelves were faithfully drawing the
silhouette of whatever distant geometry the lookup landed on — which is what the
hard-edged slabs of flat colour ARE. It is not the lookup: both flip conventions
were tested against the same rays and neither matched. `WATER.depthPass` is off
until `seabed.js` is fixed, and the water falls back to the per-vertex depth it
used before — coarser, and correct.

**What it cost to find that.** Five changes that all did nothing, each of which
looked like the obvious cause at the time: softening the shelf steps, adding a
gradient inside each band, blurring the depth read, halving `sharpen`, and
gating the legacy hard-`step` foam ring. Forcing the water fully opaque left the
slabs exactly in place — which I read as proof they were not the seabed showing
through, and which proved nothing at all, since a term that is not water is not
affected by the water's opacity either. The magenta water mask settled that they
were water pixels; rendering the depth field itself settled that the depth was
saturated over half the lake and zero over the rest; and the ray comparison
above settled where the fault is.

## Fog answers to altitude, and the rule is the horizon

Fog was a per-world constant, authored at the surface and right there. It is
most of what makes Shroud Shroud. It also made Shroud **unflyable**: from a jet
the world went to flat violet with nothing to navigate by.

The measurement that settled the shape of the fix, fog range against the world's
own radius:

| world | fogFar | far / radius | horizon at 0.1 R |
|---|---|---|---|
| home | 808m | 0.78 | 463m |
| ember | 145m | 0.70 | 93m |
| tarn | 393m | 0.95 | 185m |
| vault | 829m | 1.00 | 371m |
| shroud | **167m** | **0.12** | 649m |
| anvil | 1906m | 0.92 | 927m |

Five worlds fog out between 0.70 and 1.00 of a radius. Shroud fogs out at 0.12 —
an order of magnitude shorter, which is the authored murk and is approved. The
last column is what you can actually *see* from that altitude, and on Shroud that
is 649m of world behind a wall at 167m. Nothing was wrong with the number; it was
being asked a question it was never authored for.

**So the rule is the horizon, and it needs no per-world table.** Fog far grows
toward `sqrt(2 * R * alt)`, which is derived from the world's own geometry and is
therefore already per-world and per-altitude. Two properties make it the right
rule rather than merely a working one: at zero altitude the horizon is zero, so
every world's surface fog is untouched to the metre — Shroud's approved murk is
exactly its approved murk — and it only ever reaches for worlds whose fog is
shorter than their own horizon. The altitude at which each starts to clear is
`fogFar² / 2R`: **10m on Shroud**, and 315m, 51m, 187m, 415m and 877m on the
others. Anvil's canyons still read from the jet through Anvil's own fog.

**Near lifts too, and that was the half that actually mattered.** At height `a`
nothing in frame is nearer than `a` — the ground straight below you is exactly
`a` away. Leaving fog to start at its surface value put every pixel of the world
inside the gradient before it began: from 193m over Tarn the whole frame, land
and water alike, came back as one sheet of pale grey with the coastline barely
legible through it. Pushing the near plane out to the altitude puts the start of
the fog at the closest thing there is to fog.

One thing this uncovered rather than caused: with the air clear at altitude, the
sky's horizon band is visibly separated from the actual skyline on four worlds.
It is drawn at zero elevation in the local up frame, which is the visual horizon
only when you are standing on the ground — at 103m over Home the true horizon has
dipped 8 degrees below it. The murk was hiding that.

## Spawn is two absolute heights on worlds that are not the same size

Two defects, one symptom. `findSpawn` returns a **direction** and has never
returned a height; the vertical placement is a separate line in each of the three
paths that enter a world, and both of the ones that were wrong were wrong by
using a number in metres across radii that run 207m to 2072m.

**Boot put the craft at y = 0, which is sea level and not the ground.** Every
spawn is chosen from a band that starts at `relief * 0.12` *above* sea level, so
y = 0 is underground on all six worlds — by 1.2m on Ember and by up to 78m on
Anvil, measured at 33.7m on the direction it actually picks. It only stopped
being invisible when the spawn search changed: it used to stop at the first point
in its height band, which on a Fibonacci spiral from the pole meant something
near the bottom of that band. Scoring the whole spiral for how many neighbour
worlds sit in the sky picks by a criterion with no relation to height at all, so
the chosen point can now sit anywhere in the band. `Craft.settle()` puts it on
the ground and clears every field that could carry the throw forward.

**The dev warp arrived at `HYPER.approachAlt`, which is 900 metres, absolute.**
That is 0.43 radii over Anvil and **4.35 radii over Ember** — the whole world a
marble 22 degrees wide below you. A fine place to begin a descent and a useless
place to be put by a button whose entire purpose is looking at six worlds in a
minute, so the warp now settles on the surface.

A real hyper arrival is untouched. Arriving in flight with the autopilot holding
altitude is the designed behaviour there, and that same 900m is `approachR` in
`hyper.js` — the boundary the whole travel model is built on, and the altitude
you must climb through to leave. Re-deriving it per radius would make Ember's
departure a 21m hop. **It is still an absolute length on worlds that differ
tenfold, and it is still the class of error that has bitten this project five
times.** It wants its own pass, with departure and arrival separated.

## The water knows how deep it is now, per pixel

Authored here rather than transplanted — lookdev has no water. The whole pass
turns on one measurement. The water shell carries a `depth` attribute per
VERTEX and the shell is 40 cells across a cube face, which on Home is **one
depth sample every forty metres**. Everything the water drew off depth was being
interpolated across that: the six bathymetry shelves, and the shoreline foam,
whose entire job is to live in the first three metres of depth. The foam read as
a wide soft band because it had never had the resolution to be anything else.

So `js/world/seabed.js` renders the terrain's distance from the camera into a
render target and the water shader subtracts. Same quantity the shader already
computes for itself as `length(uCam - vW)`, so thickness is one subtract with no
projection inverse. Raising the mesh instead was measured and rejected:
`waterFaceRes` 128 is 100k `height()` calls at 5.0us each, half a second of load
per world, and it still samples the ground on a grid rather than following it.

**Path length is not depth, and keeping them apart is the pass.** `thick` is how
far a ray travels through water; `pdepth` is how far the seabed it lands on sits
below the surface. Identical looking straight down, nothing alike at a graze —
on Tarn, mean depth 2.6m, a ray ten degrees above the horizon crosses fifteen
metres of water. Shoreline foam written against the path measured **zero moving
pixels** on three worlds with the term turned up past any depth in the game.
Absorption wants the path. Anything that has to be a fixed width on the ground —
the foam line, the shelves — wants the depth.

The same split runs through absorption: **colour off depth, transparency off
path**. Colour has to be view-independent or the chart changes as you turn your
head; transparency genuinely is a path property, because a long slant through
water really does hide the bottom.

**The chart was being drawn at a quarter scale and nobody had measured it.**
`uMaxDepth`, the range the six shelves spread across, was `max(3, relief*0.42)`:

| world | guessed | actually | shelves ever drawn |
|---|---|---|---|
| home | 21.8m | 9.9m | 2.7 of 6 |
| tarn | 8.7m | 6.7m | 4.6 of 6 |
| vault | 17.4m | 8.0m | 2.7 of 6 |
| shroud | 30.5m | 13.8m | 2.7 of 6 |
| anvil | 43.5m | 11.5m | **1.6 of 6** |

Nothing was wrong with the shelves. They were being asked to span twice the
depth of any water in the game, so the deep half of every palette had never been
on screen. `WATER.measureDepth` takes the number off the shell that was actually
built, and two assertions now hold it there.

**The swell is sampled below Nyquist on every world, and the boat rides the real
one.** Samples per wavelength is `4 * waterFaceRes / waveFreq` — the radius
cancels — giving 1.78 on Home, 1.45 on Shroud, 1.23 on Anvil, 2.58 on Tarn. What
the vertex shader displaces is an alias of the swell, while `waveAt()` on the CPU,
which the hull's ride height and the whole wave-launch path read, evaluates the
function exactly. Eight samples a wavelength would want `waterFaceRes = 2 *
waveFreq`, which is 180 on Home: 196k vertices and a second of load. So the
NORMAL is computed analytically in the fragment shader instead, from the same
three sines, for three cosines a pixel. Geometry stays coarse and so does the
silhouette; everything that reads the surface as a direction reads the true
swell. A check in `dev/run.mjs` pins the shader's coefficients to `noise.js`'s,
because that agreement is now written down in three places.

**No planar reflection, and the measurement is the reason.** A planar reflection
needs a plane; this water is a closed shell around a planet. With the eye at
9.5m the horizon is 89m away on Tarn and 198m on Anvil, and on every world the
surface falls away from its own tangent plane by 9.5m at the horizon — the drop
just IS the eye height. That is four times Tarn's swell and thirty times
Shroud's, wrong worst at the skyline, which is the one place anybody reads a
reflection off water, and it would cost a second render of the world per frame
to be wrong there. There is no tier at which that is the right trade rather than
a cheaper one. The reflected ray is traced against the sky instead, which is an
analytic function of direction and therefore exact on a sphere at any range.

**Screen-space refraction bends what the water does to the seabed, not the
seabed.** The thickness lookup is displaced along the surface tilt, so the
shelves, the foam line and the transparency all bend where the swell tips the
surface. The seabed's own image arrives through the alpha blend at full
resolution and is not resampled. Bending that too would mean a second colour
pass over the terrain; this pass does not spend it.

### What it cost to find

Three bugs, all of them found by reading numbers rather than pictures, and the
first two looked exactly like bad tuning:

- **`scene.overrideMaterial` does not survive a second render target.**
  `shadows.js` swaps its depth material in that way and says so in a comment:
  two lines instead of a per-mesh registration. With two such targets the
  second one's swap does not take. The seabed pass came back holding terrain
  COLOUR — 0.1 to 0.9 on Home, 0.3 to 1.3 on Tarn, the red channel of the
  palette — which the water read as a seabed less than a metre away everywhere,
  and Home's lake rendered as solid foam over 99.3% of its surface. It looked
  like a foam term four times too wide. Fixed with
  `RenderTargetTexture.setMaterialForRendering`, which is per-target and touches
  no global state.
- **A divide-by-zero floor applied to a multiply.** The cosine between the view
  ray and the local up is a divisor one way and a multiplier the other. Floored
  at 0.08 for both, it reported the seabed nine times deeper than it is at
  1000m, saturating every shelf on the far half of every lake. Same symptom
  again: one flat plate of blue, the chart gone.
- **A semicolon inside a comment on a `uniform` line.** Babylon's shader
  processor splits those lines on `;` before it strips comments, so the prose
  came back as a statement and the compile failed with `'z' : syntax error`.

### The instruments this pass had to build

`dev/shots.mjs` could not see any of it. Its six frames are shot from the chase
camera, and there is **no water in Tarn's** — Tarn is 85% ocean and spawns you
on a dry ridge. So:

- **`dev/frames.mjs`** finds a shoreline: a golden-angle spiral out from the
  spawn for a point that crosses sea level with real depth behind it and real
  land in front. Shared by two harnesses so they cannot drift onto different
  pictures. `shots.mjs` gained a fourth frame from it.
- **`dev/noop.mjs`** proves a new term neutral by flipping it inside one frozen
  frame. `shots.mjs` cannot: two runs over identical code differ in 85% of their
  pixels, up to 83 levels, because the grain is per-frame noise and the swell is
  a function of wall-clock time. This stops the render loop, kills the grain and
  the particle systems, and reads the framebuffer with `gl.readPixels` — a
  screenshot goes through Chrome's compositor and came back different three
  times in a row on a scene where nothing had moved. It renders on/off/on so the
  control proves the rig would have noticed, and it turns one term up hard on
  the way out, because "zero pixels changed" also describes a uniform that never
  reached the shader.
- **`dev/waterstats.mjs`** reads the debug modes back as distributions, and it
  needed a magenta water mask (`WATER.debug = 4`) before any of it meant
  anything: terrain and sky have red channels too, and the first measurement
  reported foam over 99.9% of Home by counting them.

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
three forms and charges for it, and that closing the tab does not protect a
colony — plus, since the water pass, that no shader body quotes with a backtick,
that the swell is the same eight coefficients on the CPU and in both shaders,
that every world reaches all six of its bathymetry shelves, and that no world
calls a fifth of its water column the shoreline. 185 checks. Run it after
touching `noise.js`, `sphere.js`, `craft.js`, `chunks.js`, `scatter.js`,
`hyper.js`, `colony.js`, `raiders.js`, `water.js` or `materials.js`.

The last four are all guards against a specific thing that already happened.
The backtick check exists because a code-quote inside a shader comment closed
the template literal six times across five passes, and the error it produces
names a GLSL identifier at a line of English prose. The swell check exists
because the wave function is now written down in three places — `waveAt()`, the
vertex displacement and the per-pixel normal — and the boat rides the first one.
The two chart checks exist because the bathymetry shelves were being spread over
twice the depth of any water in the game, and because Tarn's first shoreline was
a third of its entire water column wide.

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

Four frames per world now, and the fourth was added because the other three
could not see the water. All of them look at the craft, and there is **no water
in Tarn's** — a world that is 85% ocean, which spawns you on a dry ridge. So
`dev/frames.mjs` goes and finds a shoreline: a golden-angle spiral out from the
spawn for a point that crosses sea level with real depth behind it and real land
in front, nearest first. It looks down across the shallows at about thirty
degrees rather than reproducing the chase camera, and that is deliberate — the
first cut stood at a rover's roof height and photographed Home as one flat plate
of blue three times running while the bathymetry underneath it was working
perfectly. A test frame's job is to show the thing under test.

```bash
node dev/noop.mjs             # is a new term neutral?
node dev/waterstats.mjs       # what the water shader computes, and what it costs
node dev/sundisc.mjs          # is the bright thing at the sun, or at the camera?
node dev/arrivecheck.mjs      # does a warp put the camera under the ground?
node dev/disccheck.mjs        # how big is each planet disc, honestly and as drawn?
node dev/savedworlds.mjs      # cold load WITH A SAVE — is more than one world drawn?
node dev/skyline.mjs          # does the horizon band sit on the horizon, at altitude?
node dev/floracheck.mjs       # what does vegetation cost, and does the wind move it?
```

### The harness had never met a returning player

Every browser harness here launches Chrome on a throwaway `--user-data-dir`.
That is correct for determinism and it has a consequence nobody had costed:
`localStorage` is always empty, so `economy.load()` always returns null, so
**every code path that exists only for someone coming back to the game had
never once been exercised** — no restore loop, no colonies on a world you are
not standing on, no claimed vents, no away-window catch-up. A whole class of
bug this repo was structurally unable to see, and it hid a real one for as long
as it existed (below).

`dev/savefile.mjs` closes it as a standing option rather than a one-off. It
builds the same blob `economy.save()` writes, with records in the shape
`Colonies.record()` produces and REAL geyser ids, so vents come back claimed —
which is the state a returning player actually has, and not the same test as a
world with an empty site list.

```bash
node dev/shots.mjs --save         # photograph six worlds as a returning player
node dev/shots.mjs --save=4       # ...with four colonies per world
node dev/arrivecheck.mjs --save   # arrive somewhere you have already built on
node dev/disccheck.mjs --save --away=3600   # and with the tab shut an hour
```

`--save` is off by default everywhere, because the reference sheets are compared
against each other and a first-time world is the stable subject. `saveFromArgv`
is the one place the flag is parsed, so every harness spells it the same.

One trap worth knowing before you write your own: `economy.load()` gates on
`v: 1` and drops a blob without it **in silence**. A malformed save reproduces
as a perfectly clean run, which is how the first attempt at the reproduction
below came back green.

`savedworlds.mjs` also asserts the seeded save actually restored something. A
harness that seeds a save the game quietly ignores is measuring the no-save case
twice and reporting a pass.

`arrivecheck.mjs` exits non-zero, so it is the one in this list you can put in
front of a commit. It measures height above the GROUND UNDER THE CAMERA rather
than above sea level, because the version that measured sea level passed while
the camera was inside a hill.

`noop.mjs` is the instrument behind the house habit — ship a term at its neutral
value, prove it changes nothing, then author. `shots.mjs` cannot do that: two of
its runs over identical code differ in 85% of their pixels, up to 83 levels,
because the grain is per-frame noise and the swell is a function of wall-clock
time. So this compares inside ONE run instead: boot, stop the render loop, kill
the grain and the particle systems, then render, read the framebuffer, flip the
term, render, read again. It renders on/off/on so the control proves the rig
would have noticed a difference, and it turns one term up hard on the way out,
because "zero pixels changed" is also what a uniform that never reached the
shader looks like. That last check earned its place on the first run.

Read the framebuffer with `gl.readPixels`, not a screenshot. The first version
used `Page.captureScreenshot` and reported every world unstable — three renders
of a frozen scene coming back as three different images, with the term under
test not even flipped between two of them. The engine runs
`preserveDrawingBuffer:false`, so a screenshot is whatever Chrome's compositor
has when it gets round to it. This is very likely the same root cause as the
known wrong-sky capture noted in `shots.mjs`.

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

**Ember's sky has a slab in it, and it belongs to the sky pass.** Look toward
Ember's sun and there is a large pale lozenge across the lower sky with a hard
enough edge to read as geometry — visible in `dev/shots/sun-ember-cold.jpg`. It
is NOT the sun, and it is not new: the same wash is in the frames taken before
the halo was reduced, and differencing a frame against the same frame with
`uGlare` at zero leaves the lozenge untouched. It is the CLOUD STRATA, and the
bright part is the gap between them.

The mechanism, so the sky pass does not have to re-derive it. Each stratum is
`smoothstep(0.40, 0.56, sin(cu * k) * sin(cv * k'))` — a level set of a product
of two sines, which on a sphere is a rounded quadrilateral with a boundary only
0.16 wide in a quantity that swings over 2. Ember then makes that boundary
maximally visible: `cloudColor` is [0.145, 0.075, 0.067], nearly black, against
an `underglow` of 1.5 in orange authored past 1.0, at `clouds: 1.4` — so the mix
factor reaches 0.42 * 1.4 = 0.59 and the cloud reads as a hole punched in a
glowing sky rather than as cloud.

Three worlds draw a cloud darker than the sky under it, by luminance against
their own `skyLow` — Ember 0.089 vs 0.171, Shroud 0.262 vs 0.275, Anvil 0.663 vs
0.749 — but only Ember pairs that with both a high `clouds` and an underglow.
Shroud has the dark cloud at 1.5 strength and no underglow at all; Anvil's cloud
is barely darker and runs at 0.22. So the slab is an Ember artefact
specifically, and any rework should be checked against Shroud second.

Left alone deliberately: the strata are being reworked in the sky pass, and
softening the smoothstep here would be tuning a term that is about to be
replaced. Fixing it twice is the thing to avoid, not the slab.

Audio is fully synthesised — there is no sample in the folder, because there is
no asset in the folder. It is properly produced rather than three oscillators
(sequenced score, send reverb, tempo-synced delay, sidechain under the kick,
adaptive layer gating), but synthesis has a ceiling. If a ~1-2MB `.ogg` in
`assets/` is acceptable, the music bus is one `decodeAudioData` away from
playing a real track and the SFX would stay as they are.
