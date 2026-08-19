// SURVEYOR — all tuning lives here. One file, one place to argue with.

export const WORLD = {
  seed: 'surveyor-01',
  // Sea level, in the local tangent frame. The craft's y is metres above sea
  // level on every planet, which is why the whole of craft.js survived the
  // move onto a sphere unchanged.
  waterY: 0,
  buildBudgetPerFrame: 2,
  // A quadtree node subdivides while the player is within this many node-widths
  // of it. Higher = more triangles held at high detail further out.
  lodSplit: 1.7,
  skirt: 14,           // metres the LOD skirt hangs inward
  rockLevels: 2,       // finest N levels carry baked rock geometry
};

/**
 * Planet profiles.
 *
 * Phase 2 ships Home only. Every amplitude below is a fraction of the planet's
 * relief, which is itself ~radius/20 — so a profile can be dropped onto any
 * radius and stays proportionate. Frequencies are in cycles across the sphere,
 * so `fShelf: 2.0` means roughly two continents wide.
 */
/* The dev warp is GONE, as of Phase 3b: you fly there now. Shift+1..6 and the
   DEBUG.warp block it was configured by are both removed, and the `?planet=`
   boot parameter it reloaded through is kept for one reason — dev/shots.mjs
   photographs six worlds and cannot spend half an hour flying between them.
   It is read directly in main.js; there is nothing left to configure. */

/* TEMPORARY TESTING SCAFFOLDING — the HUD planet selector.
   Six labelled buttons that drop you onto any world without the flight. This is
   for looking at six worlds in a minute, nothing else: it skips the trip, the
   fuel and the arrival, so nothing it shows you proves the journey works.
   `warp: false` removes the row from the HUD entirely and takes the warp path
   with it. Turn it off before this ships. */
export const DEBUG = {
  warp: true,
};

export const SKY = {
  zenith: null,          // top of the gradient; null = palette.skyHigh
  horizon: null,         // bottom of it; null = palette.skyLow
  below: null,           // under the skyline; null = palette.fog darkened
  band: 0.10,            // brightness of a band hugging the horizon
  bandWidth: 0.05,       // ...and how far up and down it reaches
  bandColor: null,       // null = palette.fogSun
  clouds: 1.0,           // strength of the three strata. 0 = clear sky
  cloudColor: null,      // null = palette.coast
  ceiling: 1.0,          // <1 pulls the strata DOWN into a low heavy lid
  haze: null,            // null = ATMO.horizonHaze
  underglow: 0,          // ground-lit sky. Above 1.0 in the buffer, so it blooms
  underglowColor: null,  // null = palette.fogSun
  sunDir: [0.42, 0.74, 0.52],   // in PLANET space: the sun is genuinely fixed
  sunColor: null,        // null = palette.fogSun
  /* THE SUN'S ANGULAR DIAMETER IN DEGREES, and the halo's around it.
     These are new only in the sense that they were previously written as
     coefficients in cosine space inside the sky shader — 1.0 - 0.055 * sunSize
     for the halo's outer edge and so on — where nothing said how big that was.
     What it worked out to was a core between 7.4 and 11.2 degrees across and a
     halo between 32 and 48, on a camera whose vertical field of view is 54.4.
     The halo was 88% of the frame height. It did not leave the picture until
     you had turned more than sixty degrees, which is a sun that reads as
     welded to the camera even though the sky shader has always placed it by
     dot(viewDir, sunDir) and nothing about it was ever screen-space.
     For scale: the real sun is 0.53 degrees. 1.4 is a bright object you can
     look away from, and the halo is what bloom then spreads.

     THE HALO WAS 14 AND IT WAS STILL TOO BIG, because sunSize multiplies it
     and two worlds set 1.6: Ember and Shroud were drawing a 22.4-degree halo
     into a 54.4-degree frame, 41% of its height before bloom and about half
     after. The 0.98-2.24 degrees reported when this landed was the CORE only
     — the halo was never in that measurement, and the halo is the thing you
     see. At 5 the worst case on any of the six is 8 degrees, 15% of the frame,
     and the spreading is bloom's job rather than the sky shader's. */
  sunAngle: 1.4,
  haloAngle: 5.0,
  /* A per-world multiplier on both of the above, and on nothing else.
     Read the halo as haloAngle * sunSize before deciding it looks small in
     this table: the two 1.6 worlds are the ones that set the ceiling. */
  sunSize: 1.0,
  glare: 1.0,            // how hard the disc and its halo push past 1.0
  // The particle layer. `null` keeps the system's near-field motes; a block
  // replaces their colour, rate and fall direction.
  motes: null,
};

/**
 * THE LIGHT RIG — transplanted from the lookdev testbed, T2.
 *
 * WHAT DID NOT COME ACROSS, AND WHY. lookdev's `lighting.js`, `environment.js`
 * and `rim.js` are a Babylon DirectionalLight, an IBL cube and a PBRMaterial
 * plugin. All three act on PBRMaterial, and Surveyor has none: six hand-written
 * ShaderMaterials carry the whole look and do their own banded cel lighting off
 * a `uLight` uniform. Dropping those files in would have added a directional
 * light nothing samples, an environment texture nothing reads and a plugin with
 * no injection site. What transplants is the MODEL, and it is this block.
 *
 * THE MODEL, in lookdev's own terms and its own key names:
 *
 *     luminance = ambient + sunIntensity * bandLight(dot(N, sunDirection))
 *
 * `sunIntensity` is the key and `ambient` is the fill — the same two numbers
 * whose RATIO was the single biggest lever over there (4.6 against 1.15, a 4:1
 * key to fill). The absolute values do not travel: they are linear-HDR PBR
 * radiance and this shader multiplies an authored 0..1 albedo. The ratio does.
 *
 * SUN DIRECTION IS NOT HERE. It is `sky.sunDir`, per world, and it already has
 * exactly one home: `skyOf()` resolves it and the ground shaders, the disc
 * shader and the baked disc relief all read it through that one call. Adding a
 * second copy here is how a world ends up lit one way on the ground and another
 * way in the sky — the bug this MD asks to be checked for. There is nothing to
 * check because there is nothing to disagree.
 *
 * THE INVARIANT WORTH HOLDING. bandLight's top step is 1.04, so
 * `ambient + sunIntensity * 1.04` is what a fully lit face comes out at. Keep it
 * near 1.04 and you are changing only how deep the shadows go; move it and you
 * are re-exposing the whole world. Every profile below holds it within a few
 * percent, which is why lifting Ember's fill did not brighten Ember.
 *
 * Defaults are a NO-OP: ambient 0, sunIntensity 1, white sun, sunMask 0
 * reproduce the pre-T2 image exactly. A world opts in by saying so.
 */
export const LIGHT = {
  sunColour: [1.0, 1.0, 1.0],   // tints the key. Not the sun disc — that is sky.sunColor
  sunIntensity: 1.0,            // scales the banded key
  /* The fill, and the reason it exists. lookdev's ambient is an IBL at 1.15
     doing "the sky fill that makes shadows open and blue instead of black".
     There is no IBL to have here, so this is a flat floor under the bands —
     which is the honest cel-shaded equivalent and the only one a five-step
     ramp can express. */
  ambient: 0.0,
  // How hard the unlit bands take the world's `shade` tint. The colour of the
  // fill, where `ambient` is its strength.
  shade: 0.70,

  /* Rim, lifted term for term from lookdev's rim.js:
   *     rim  = pow(1 - saturate(dot(N, V)), power) * intensity
   *     rim *= mix(1, saturate(dot(N, L) * 0.5 + 0.5), sunMask)
   * The second line is the part Surveyor did not have. Without it the rim is an
   * outline: every silhouette edge lights up whether or not anything is
   * shining on it. With it, it is light grazing an edge.
   * sunMask defaults to 0 so the pre-T2 image is unchanged until a world asks. */
  rim: { power: 3.5, intensity: 0.55, sunMask: 0.0 },
  // The craft carries its own, tighter and hotter: it is a small bright object
  // against terrain, not terrain.
  craftRim: { power: 2.6, intensity: 1.4, sunMask: 0.0 },
};

/**
 * TERRAIN MATERIALS — transplanted from the lookdev testbed, T3.
 *
 * WHAT DID NOT COME ACROSS. lookdev's `triplanar.js` is a PBRMaterial plugin,
 * the third file in a row that acts on a material type Surveyor does not have.
 * The technique came across into the terrain shader instead; the file did not.
 * See materials.js.
 *
 * WHAT IT IS FOR, beyond looks. The surface grain this replaces was sampled on
 * `vW.xz` — one planar projection, on a cube-sphere. That is right on the two
 * caps and smears everywhere the surface turns to face sideways, which is most
 * of a planet. Triplanar is the fix. It is also why lookdev's own note calls it
 * mandatory on a sphere, and it is the reason this transplant is worth its cost
 * even before anyone judges whether it looks better.
 *
 * WHAT IT MUST NOT TOUCH. The contour lines, the bands, the waterline stroke —
 * the chart. So it does not: the palette ladder and the whole chart are drawn
 * off the GEOMETRIC normal and the height, exactly as before, and the triplanar
 * result is applied in two places only, both of them after. The detail
 * luminance modulates brightness, and the perturbed normal goes to the LIGHT.
 * Texture changes how the ground catches light. It never moves a line.
 *
 * SCALES ARE RE-DERIVED, NOT TRANSFERRED — the T1/T2 lesson, and this is where
 * it bites hardest. lookdev tiles at 15-26 metres on a 4km plane. Ember is
 * 207m across with 10m of relief: 26 metres there is an eighth of the world and
 * two and a half times its total height range. What is actually constant across
 * these six worlds is `targetCell`, held near 4.5m on purpose so the vehicles
 * handle the same everywhere, so the tile scales below are multiples of THAT
 * and land at 9-16m. Altitude thresholds are fractions of `relief`, like every
 * other breakpoint in this file. Fade distances are fractions of the fog range,
 * because Ember's fog ends at 162m and lookdev's 450-1400m macro relax would
 * never once have engaged.
 *
 * DEFAULT IS OFF. `strength: 0` reproduces the pre-T3 image exactly, which is
 * how the no-op gets proved before any world opts in.
 */
export const TERRAIN = {
  /* THE COASTLINE STROKE, AS A WIDTH ON THE GROUND.
     It was a band in HEIGHT — |h| under relief * 0.022 — which is constant only
     if every shore is equally steep. Measured at 160 samples a cube face, the
     ground width that produced was a median of 31m on Home, 33m on Vault, 39m
     on Shroud and 81m on Anvil, a fifth to a half of it past 100m, and on Tarn
     it covered 56.8% of the land. That is the broad near-white apron that reads
     as neither foam nor shallows: it is the coastline, drawn eighty metres wide.
     `width` is the half-width in metres of ground. `minGrad` is the gradient
     below which there is no shoreline worth drawing at all — flat pans near sea
     level get nothing rather than getting flooded. */
  coast: { width: 5.0, minGrad: 0.10 },
  // The three packed maps, baked by tools/bake_terrain_maps.py. RG hold the
  // normal's XY, B holds the albedo's luminance; the colour is thrown away
  // because six authored palettes already decide colour.
  path: 'assets/textures/',
  layers: ['flat', 'steep', 'high'],

  /* TWO knobs, not one, and the split is the finding of this transplant.
     `strength` bends the surface NORMAL, so texture changes how the ground
     catches light. `detail` draws the scan's own light-and-dark — its crack
     network — which is LINE WORK, and line work is what this game already puts
     on the ground and calls a chart. At a single knob of 0.7 the contours
     survived and Home still read as a different game, because the marble's
     fractures were competing with them. Separated, a world can take all the
     relief it wants and none of the cracks. Both 0 is the pre-T3 image. */
  strength: 0.0,
  detail: 0.0,
  normalStrength: 1.0,    // how hard the packed normal bends the light
  blendSharpness: 6.0,    // higher makes one projection plane dominate, and the
                          // other two branch out of the shader entirely
  steepBias: 0.55,        // holds the high-ground layer off cliff faces

  // Metres per tile, as multiples of targetCell (4.5m). Steep is tightest
  // because a cliff face is what the light actually rakes.
  scale: { flat: 13.5, steep: 9.0, high: 15.75, detail: 2.25 },

  // 1 - dot(N, radial): 0 is flat ground, 1 is a wall. lookdev's own 0.28/0.58
  // survived re-derivation — it is a ratio, not a length.
  slope: { start: 0.28, end: 0.58 },
  // Fractions of the planet's relief, where lookdev had metres off pos.y.
  altitude: { start: 0.45, end: 0.80 },

  /* Fractions of the planet's fog range, and RE-DERIVED against the terrain
     cell rather than converted from lookdev's metres by eye — which is what I
     did first, and it put detail across the whole frame on Home.

     The anchor is `targetCell`, 4.5m, held near-constant across all six worlds
     so the vehicles handle the same everywhere. lookdev fades detail out over
     25-95m, which is 5-21 cells; Surveyor's own procedural grain already fades
     over 40-260m, or 9-58. So detail belongs in the 40-140m band on Home, and
     these fractions put it there — while giving Ember, whose fog ends at 162m,
     a proportionally tighter 8-29m instead of a number that would have covered
     its entire visible world.

     The macro relax is the one that stops the tiling aliasing into a visible
     square lattice from the air. It has to sit well outside the detail fade and
     well inside the fog. */
  detailFade: { start: 0.05, end: 0.18 },
  macroFade: { start: 0.20, end: 0.55 },
};

/**
 * CAST SHADOWS — the pass after T3, and its own commit on purpose.
 *
 * Roadmap call: T3's risk was whether the contour lines survived a texture
 * pass, and shadows landing in the same commit would have made a wrong-looking
 * frame unattributable. One variable at a time.
 *
 * NOT Babylon's ShadowGenerator. See shadows.js — it exists to inject itself
 * into StandardMaterial and PBRMaterial, and this game has neither.
 *
 * WHAT A SHADOW MULTIPLIES. The KEY, and only the key. The fill is sky light
 * and sky light does not care what stands between a pixel and the sun, so a
 * shadowed face falls to that world's ambient floor rather than to black. This
 * is why the T2 light rig had to land first: `ambient` decides, per world,
 * whether a cast shadow reads hard or soft, and nothing here has to say so.
 * Vault's fill is 0 and its shadows are hard. Tarn's is 0.22 and they are not.
 *
 * EMBER HAS NONE, and that is a finding rather than a saving. Its sunDir is
 * declared "low, and barely a sun at all" and its light comes off the ground —
 * the fissures are the source, which is why its key is 0.90 against a 0.10 fill
 * only because the KEY is what carries the warm tint there. A directional sun
 * shadow map on a world lit from underfoot draws shadows cast by a light that
 * is not doing the lighting. Switched off, not tuned down.
 *
 * RANGE IS THE NEAR FIELD, not the world. Shadows stop mattering long before
 * the fog does, and a 2048 map stretched over Anvil's 1906m fog range is a
 * metre a texel — wider than most of the things casting. 400m at 2048 is 20cm.
 */
export const SHADOW = {
  enabled: true,
  mapSize: 2048,
  /* METRES ACROSS THE BOX, and it is much tighter than it was.
     Measured on Home: a 400m box on a 2048 map is 19.5cm a texel, and the
     terrain leaves that cast into it are flat-shaded triangle soup with a skirt
     hanging 14m off every chunk edge. What that produced was a striped band
     running along the light — acne, not projection, and no bias setting fixed
     it because the caster geometry is discontinuous at exactly the scale the
     map is sampling. Tightening to 150-260m takes a texel to 7-13cm and takes
     the striping with it, at the cost of shadows that only exist near the
     craft — which is where a contact-scale shadow belongs anyway, and the term
     already fades out before the box edge. */
  range: 180,
  strength: 0.75,       // how much of the key a full shadow removes
  /* Terrain casts as well as receives. The fallback if tightening the box had
     not been enough: props and the craft are small and well-behaved casters,
     and a heightfield of flat-shaded soup with LOD skirts is not. Left true
     because the tighter box did fix it — verified by A/B on Home, which was the
     worst of the six. */
  castTerrain: true,

  /* NORMAL-OFFSET BIAS, in texels of the shadow map, and it replaced a constant
     depth bias that could not be made to work.
     A constant bias fails at grazing angles by construction: the depth error
     across one texel grows as 1/cos(angle between the normal and the light), so
     any value large enough to stop acne on a slope has detached the shadow on
     the flats before it got there. Both failures at once, which is exactly what
     that looked like. Offsetting the SAMPLE POSITION along the surface normal
     instead moves it in the direction the error actually lies, so one number
     holds across every angle. This is metres at the shader, computed from the
     texel's world size — a 400m box on a 2048 map is 20cm a texel, so 1.4 of
     them is 27cm of offset. */
  normalOffset: 1.4,
  // A little depth slack on top, for the sliver right at a contact edge where
  // the normal offset has nowhere to push.
  depthBias: 0.00025,

  /* PCF, in texels. 4x4 taps: a hard shadow-map edge on a cel-banded surface
     reads as an artifact rather than as a shadow, because everything else in
     the frame has deliberate hard edges and this one is the wrong shape. 16
     taps at 1.6 texels is a ~6 texel penumbra, which at 20cm a texel is a hand's
     width of softness — enough to read as a shadow, not enough to smear the
     contact. */
  softness: 1.6,

  // 0 off, 1 the shadow term alone, 2 the cast term without the contact
  // blob, 3 texels per metre. Read with the post stack off.
  debug: 0,
};

/**
 * The craft's contact shadow.
 *
 * A guaranteed blob under the rover, independent of the sun, the world, and
 * whether that world has cast shadows at all. Ember has none and the rover
 * still has to sit on the ground there; so does anything flying at an angle
 * where its cast shadow has gone somewhere else entirely.
 *
 * Drawn IN THE TERRAIN SHADER rather than as a decal mesh. The terrain already
 * knows its own world position, so a distance test against the craft's ground
 * point costs one subtract and follows every fold of the ground exactly — where
 * a projected disc would clip into slopes and hover over hollows, which is the
 * failure that makes blob shadows look cheap.
 */
export const CONTACT = {
  enabled: true,
  /* SHAPED TO THE VEHICLE, not a generic disc, because this is now the craft's
     only shadow on every world. A superellipse in the ground plane, oriented to
     the heading: exponent 2 is an ellipse and 4 is nearly a rectangle, and 2.6
     is the rounded-rectangle a tracked hull actually occupies. Metres, half
     extents, along the heading and across it. */
  size: {
    rover: { long: 2.45, wide: 1.90 },
    boat:  { long: 2.90, wide: 1.70 },
    jet:   { long: 2.75, wide: 2.75 },
  },
  exponent: 2.6,
  /* HOW FAR PAST THE FOOTPRINT THE FALLOFF REACHES, as a fraction of it, and
     it is most of what stops this reading as a decal. A tight edge is a sticker
     under the vehicle; a wide one is something the ground is in. 0.45 was the
     first pass and it was still drawing an outline — at 0.95 the shape is
     unmistakable at the centre and gone by the time you look for its border,
     which is what a contact shadow does. The footprints above grew with it, so
     the dark middle still covers the hull rather than shrinking into it. */
  edge: 0.95,
  /* Of the key, at the centre. Down from 0.82: it is the only shadow the craft
     has, which argued for dark, but a shape this soft reads as heavier than a
     hard one at the same value, and 0.82 was sitting under the rover like a
     hole rather than like shade. */
  strength: 0.70,
  // Metres of altitude over which it fades out. A jet at fifty metres should
  // not be painting a hard shape on the ground under itself.
  fadeFrom: 2.5,
  fadeTo: 24.0,
  // ...and it stops painting on anything far above or below the contact point,
  // so a cliff face beside the rover does not take its shadow.
  vertical: 3.5,
};

/**
 * FOG AT ALTITUDE.
 *
 * Fog was a per-world constant, authored at the surface and correct there. It
 * is what makes Shroud Shroud. It also made Shroud UNFLYABLE: from the air the
 * world vanished into flat violet with nothing to navigate by.
 *
 * THE MEASUREMENT THAT SETTLED THE SHAPE OF THIS. Fog range as a fraction of
 * the world's own radius:
 *
 *     world    fogFar    far / radius    horizon at 0.1 R
 *     home       808m            0.78                463m
 *     ember      145m            0.70                 93m
 *     tarn       393m            0.95                185m
 *     vault      829m            1.00                371m
 *     shroud     167m            0.12                649m
 *     anvil     1906m            0.92                927m
 *
 * Five worlds fog out at 0.70-1.00 of a radius. Shroud fogs out at 0.12 — an
 * order of magnitude shorter, which is the authored murk and is approved. But
 * the last column is what you can SEE from a jet, and on Shroud that is 649m of
 * world behind a wall at 167m. Nothing is wrong with the number; it is being
 * asked a question it was never authored for.
 *
 * SO THE RULE IS THE HORIZON, and it needs no per-world table at all. Fog far
 * grows toward the distance you can actually see from your altitude,
 * sqrt(2 * R * alt), which is derived from the world's own geometry and is
 * therefore already per-world and per-altitude. Two consequences make it the
 * right rule rather than merely a working one:
 *
 *   - at zero altitude the horizon is zero, so the surface fog is untouched on
 *     every world. Shroud's approved murk is approved murk, exactly.
 *   - it only ever REACHES for worlds whose fog is shorter than their own
 *     horizon, which is Shroud and nothing else until you fly high. The other
 *     five are unchanged until well above anything but a deliberate climb:
 *     the altitude at which each starts to clear is fogFar^2 / 2R, which is
 *     10m on Shroud and 315m, 51m, 187m, 415m, 877m on the others.
 */
export const FOG = {
  enabled: true,
  /* Where the air starts to thin and where it has finished, as fractions of the
     planet's radius. Not metres: the same lesson as everything else here, and
     the radii run 207m to 2072m. The floor keeps the rover out of it — at 0.01R
     Shroud does not start clearing until 15m up, and the rover's roof is 2m. */
  from: 0.010,
  to: 0.060,
  // How much of the horizon distance the fog is allowed to reach. 1.0 puts the
  // fog line at the horizon, which is where the world stops being visible for
  // reasons that have nothing to do with fog.
  horizonK: 1.0,
};

/**
 * WATER.
 *
 * Everything here lands as a NO-OP and every world opts in, which is the habit
 * that caught the four scale errors in T1-T3: a term shipped at its neutral
 * value proves the plumbing in one measurement, and anything you see after that
 * is your authoring rather than a transplant you converted by eye.
 *
 * WHAT THE PASS IS FOR, in one line: the water knows how deep it is at each
 * VERTEX and had to guess everywhere else. Read the shell's mesh - 40 cells
 * across a cube face, which on Home is a depth sample every FORTY METRES. The
 * six bathymetry shelves were being interpolated across that, and so was the
 * shoreline foam, whose whole job is to sit in the first three metres of depth.
 * That is why the foam reads as a wide soft band instead of a line at the
 * water's edge: it is not soft by choice, it is soft because it never had the
 * resolution to be anything else.
 *
 * THE FIX IS A DEPTH PASS, not more vertices. Raising waterFaceRes to 128 costs
 * half a second of height() per world at load (measured: 5.0us a sample, 100k
 * samples) and still would not follow the ground between texels. Rendering the
 * seabed's distance from the camera into a render target costs one depth-only
 * pass over geometry that is already in the frame, and gives the water shader a
 * PER-PIXEL answer to "how much water is between the eye and the ground" - the
 * quantity every one of the terms below actually wants.
 *
 * WHAT MUST SURVIVE, and both are checked rather than hoped for:
 *   - The BATHYMETRY SHELVES. They are computed in the water shader from that
 *     same depth, so they do not merely survive the pass, they are the first
 *     thing it sharpens.
 *   - The BONE WATERLINE STROKE. It is drawn in the TERRAIN shader at |h| near
 *     zero and shows through because the water is translucent. So the invariant
 *     is one number: the water's alpha at the shoreline must not go UP. Every
 *     term here is additive over the existing alpha ramp and none of them
 *     touches its shallow end.
 */
export const WATER = {
  enabled: true,

  /* THE SEABED DEPTH PASS. Terrain only, from the main camera, writing radial
     distance in metres - the same quantity the water shader already computes
     for itself as length(uCam - vW), so thickness is one subtract and no
     projection inverse.
     Terrain ONLY, and that is not an optimisation: the render list is the thing
     that makes the answer mean "the ground under the water" rather than "the
     nearest surface", and a list that included the water shell would report a
     thickness of zero everywhere. */
  depthPass: {
    /* OFF, AND THIS IS A KNOWN DEFECT rather than a decision about the look.
       The pass does not contain the near field. Measured on Home from the
       shoreline camera by picking rays through the frame and comparing the
       terrain they actually hit against the texel the water would read:

           frame point      real terrain      texel in the target
           (0.50, 0.75)            31.9m                   181.1m
           (0.35, 0.55)            49.6m                   227.2m
           (0.50, 0.50)            55.9m                   358.0m
           (0.65, 0.45)            68.4m       60000m (the clear value)

       Not one texel anywhere near the truth, and holes where the ground is
       closest. So every depth the water derived from it was wrong, and the
       shelves were faithfully drawing the silhouette of whatever distant
       geometry the lookup landed on — which is what the hard-edged slabs of
       flat colour ARE. It survived softening the bands, blurring the read,
       halving `sharpen`, forcing the surface opaque and gating the legacy foam
       ring, because none of those change which texel is fetched.
       Switched off, the water falls back to the per-vertex depth it used before
       this pass existed: coarser, and correct. The foam line loses its
       per-pixel edge and the shelves are interpolated across the shell's 40m
       grid again. That is a worse chart than the one the pass was built for and
       a much better one than a wrong chart.
       It is NOT the lookup. Both flip conventions were tested against the same
       rays and neither matched. The fault is in what the target contains, which
       is js/world/seabed.js, and it wants its own pass. */
    enabled: false,
    /* Of the render size, and 1.0 because half res costs the shoreline more
       than it saves: the foam line is a few pixels wide by design.
       WHAT THIS COSTS IS NOT MEASURED, and that is a statement rather than an
       omission. dev/waterstats.mjs times it by splicing the target in and out
       of scene.customRenderTargets across 30 interleaved pairs, and headless
       Chrome falls back to SwiftShader — a software rasteriser. The medians
       came back between +17ms and +330ms a frame for identical structural work,
       against baselines that themselves swung from 94ms to 188ms. That is not a
       number, it is noise, and quoting the middle of it would be worse than
       saying so.
       What CAN be said is structural. It is one extra pass over meshes already
       in the frame, with a position-only vertex shader and a one-line fragment
       shader, no post-processing and no texture fetches — against a main
       terrain pass doing triplanar sampling, contour derivatives, a shadow
       lookup and fog over the same triangles. The geometry is submitted twice;
       almost no fragment work is added. If it ever does show up on real
       hardware, this ratio is the lever, and 0.5 is a quarter of the pixels. */
    ratio: 1.0,
    // Distances past this read as "no ground behind this water" and the shader
    // falls back to the per-vertex depth. Half-float tops out at 65504, so this
    // is the largest round number that survives the fallback texture type.
    far: 60000,
  },

  /* THE SWELL, PER PIXEL. How much of the surface normal is computed from the
     wave function analytically in the fragment shader instead of interpolated
     from the mesh. 0 is the no-op and is what every world starts at.
     THE MESH CANNOT CARRY THE SWELL, and the arithmetic is short. Samples per
     wavelength is 4 * waterFaceRes / waveFreq — the radius cancels — so:

         world    wavelength   mesh cell   samples per wave
         home           72m       40.7m               1.78
         tarn           42m       16.3m               2.58
         shroud         83m       57.0m               1.45
         anvil         100m       81.4m               1.23

     Every one of them is at or below Nyquist. What the vertex shader displaces
     is not the swell, it is an alias of it — while waveAt() on the CPU, which
     the boat's ride height and the whole wave-launch path read, evaluates the
     function exactly. The hull has been riding a swell the sea does not have.
     Raising the mesh is not the fix: eight samples a wavelength wants
     waterFaceRes = 2 * waveFreq, which is 180 on Home. That is 196k vertices
     and a second of height() at load, for one world.
     So the normal is done analytically instead, from the same three sines with
     the same coefficients — three cosines a pixel. The geometry stays coarse,
     and so does the silhouette; everything that reads the surface as a
     DIRECTION reads the true swell. See the guard in dev/run.mjs that pins the
     shader's coefficients to noise.js's. */
  waveNormal: 0,

  /* HOW FAR OUT THE SWELL IS FLATTENED, in metres of depth. 3.0 is the value
     that was hardcoded in the vertex shader and is therefore the no-op.
     It exists to stop waves piercing sand, which it does. What it also does is
     kill the swell before it reaches the beach — and on the boat world that is
     most of what a shore is. It is per world now so Tarn can have surf. */
  shoal: 3.0,

  /* MEASURE THE DEEPEST POINT instead of guessing it from relief, and this is
     a bug fix wearing a feature's clothes.
     uMaxDepth is what the six bathymetry shelves are spread across, and it has
     been max(3, relief * 0.42) since the shell went spherical. That number is
     not close. Sampled at 64x64 over every cube face:

         world    uMaxDepth   actual deepest   shelves ever reached
         home         21.8m           10.9m    3.0 of 6
         tarn          8.7m            6.7m    4.6 of 6
         vault        17.4m            7.9m    2.7 of 6
         shroud       30.5m           14.4m    2.8 of 6
         anvil        43.5m           11.5m    1.6 of 6

     So the chart that says "six shelves" has been drawing three on Home and
     ONE AND A HALF on Anvil, and the deep half of every palette has never been
     on screen. Nothing was wrong with the shelves; they were being asked to
     span a range twice as deep as any water in the game.
     Measured from the shell that was actually built, not from a fresh sampling
     pass: it is the same depth array the mesh already filled at construction,
     it costs nothing, and it cannot drift out of step with what is drawn.
     false is the no-op and every world opts in. */
  measureDepth: false,

  /* SIX SHELVES, NOT SIX SLABS. The bathymetry ladder is drawn with a floor(),
     which is what makes it a chart — and on its own is also what made the water
     read as cut paper: flat regions of solid colour meeting at a hard edge,
     with nothing inside a band to say it is lying on a surface.
     `bandSoft` rounds the step, in units of a band, so the edge reads as a
     contour rather than a seam. `bandTilt` puts some of the continuous depth
     back inside each band so the band has somewhere to go. Both 0 is the bare
     floor() this shipped with, and both are per world because a chart drawn on
     a 6.7m lagoon and one drawn on a 13.8m pool are not the same drawing.
     THEY ARE AUTHORED NEAR THE TOP OF THEIR RANGE, and that took three
     measurements to justify. The slabs were not the seabed showing through
     (forcing the water opaque left every one of them in place) and they were
     not one depth source misbehaving (blurring the read and halving `sharpen`
     moved nothing). They are what quantising ANY piecewise-flat depth field
     into six steps looks like — and both fields here are piecewise flat, the
     shell's own 40m triangles and the flat-shaded seabed behind them. Nothing
     is going to make those boundaries curve. What removes the cut-paper read is
     not finding a smoother source, it is not having a hard step to put on it. */
  bandSoft: 0,
  bandTilt: 0,

  /* THE LEGACY FOAM RING. It predates the depth pass — a shallow ring plus a
     "broken second line further out" built with step(0.72, ...), a HARD binary
     threshold on a sine of depth, mixed 0.7 toward the bone colour.
     A binary threshold on a piecewise-flat depth field does not draw a broken
     line. It fills polygons. That is the broad near-white banding that reads as
     neither foam nor shallows, and it is why three rounds of softening the
     shelves, blurring the depth read and halving `sharpen` moved nothing at
     all: none of them touch this term.
     `ringFoam` is how much of it survives. Per-pixel foam does the shoreline
     properly now, so most worlds want very little. `ringSoft` widens the
     threshold into a gradient and `ringHard` keeps the old step for anyone who
     wants it back — 1.0/0/1.0 is exactly what shipped. */
  ringFoam: 1.0,
  ringSoft: 0.0,
  ringHard: 1.0,

  /* BLUR ON THE DEPTH READ, in pixels, because the thing being read is faceted.
     The seabed is flat-shaded triangle soup — that is the whole look of this
     game's ground — so the distance the depth pass reports is piecewise flat,
     and quantising it into shelves puts the band boundaries on TRIANGLE EDGES.
     That is what made the water read as cut paper: hard-edged polygonal blobs
     of solid colour, several shelves apart across a single facet seam. Proved
     rather than assumed — forcing the water fully opaque left every one of them
     exactly where it was, so they were never the seabed showing through.
     Four taps. 0 is off. */
  depthBlur: 0,

  /* A FINE RIPPLE, so a still sea is still a SURFACE.
     The swell was the only thing perturbing the water's normal, and three of
     the five worlds with water have a swell amplitude at or near zero — Vault's
     is exactly zero. Their water had no variation across it at all.
     Strength is how hard it tilts the normal; scale is in inverse metres, so
     0.11 is a wrinkle about nine metres across. It fades between the two
     distances for the reason every screen-scale detail in this game does:
     past the point where a feature is smaller than a pixel there is nothing
     left to draw but aliasing. */
  ripple: 0,
  rippleScale: 0.11,
  rippleFade: [50, 300],

  /* GLARE, AND THE CEILING ON IT. Three numbers that exist for one rule: the
     chart is never allowed to be fully occluded. The bathymetry shelves, the
     depth ladder and the melt line are information, not decoration, and a term
     that can take all of them off the surface at some viewing angle is a bug
     however physical it is.
     `glint` is the toon specular's amplitude, and it needed a knob because the
     per-pixel analytic swell changed what it does. On the mesh's aliased normal
     it fired on the few crests the geometry could represent; on a true one it
     fires on every crest, which is far more of the surface and reads as glare
     rather than as water.
     `skyCap` is the ceiling on the SUM of everything the sky adds — the glint
     and the sun path today, whatever gets added tomorrow. Additive terms with
     no ceiling do not shade a surface, they erase it. 1.0 is above the sum of
     the two current terms at full strength (0.40 + 0.22) and is therefore the
     no-op. */
  glint: 0.40,
  skyCap: 1.0,

  /* HOW FAR THE ICE DARKENS WITH DEPTH — Vault only, since it is the only world
     with any. This is a hazard read, not a look: on Vault depth IS ice
     thickness IS whether the sheet holds the rover, so a flat white sheet with
     a single stroke on it is a world where the only warning is a line you can
     drive straight past. 0.55 is what it shipped as and is the no-op. */
  iceDepth: 0.55,

  /* SHARPEN: how much of the bathymetry chart is read PER PIXEL rather than
     off the shell's 40m vertex grid. 0 draws the shelves exactly as they have
     always been drawn, which is the neutral this ships at; 1 reads the depth at
     the point the view ray actually lands on the seabed.
     Two things get better at 1 and both are the chart's own argument. The bands
     stop being linearly interpolated across forty metres of ground, which is
     what a contour band is not. And they land at the right depth when you look
     across the water instead of down at it — the shelf you see through a pixel
     becomes the shelf of the seabed you are looking AT, rather than of the
     water directly under your eye. */
  sharpen: 0,

  /* DEPTH COLOUR. Metres of water that halve what comes back through it -
     Beer-Lambert, one number, per world. 0 is off and 0 is what ships until a
     world says otherwise.
     This is a SECOND reading of depth, laid over the shelves rather than
     replacing them: the shelves say which contour band you are over, the
     absorption says how much water is in the way, and the two disagree exactly
     where the difference is interesting - at a grazing angle across shallows,
     where the chart says "one shelf" and the eye correctly sees a long way
     through water. */
  absorb: 0,
  /* How far toward the deep colour the absorption half is allowed to go, and
     it is 0.35 rather than the 0.85 it started at because 0.85 erased the
     chart. Six shelves under a term that takes 85% of the colour away leaves
     15% of a six-step ramp, which is not a chart, it is a tint. At 0.35 the
     absorption reads as a smooth depth gradient UNDER the banded one, which is
     what a second reading of the same quantity should look like.
     Only the colour half is capped by this. The transparency half runs to 1: a
     deep lake hiding its own bottom is not a look to be moderated. */
  absorbMax: 0.35,

  /* FOAM. Both terms are thickness in METRES, per-pixel, and both are 0 here.
     `shore` is the water's edge: thickness falling to nothing because the
     ground is coming up to meet the surface. `edge` is the same test against
     anything else in the frame - a rock, a hull, a colony leg - which is why
     intersection foam is not a separate system. One quantity, one threshold,
     and the second one was free. */
  foam: { shore: 0, edge: 0, strength: 0.85 },

  /* REFRACTION, in metres of lateral offset at the surface.
     Screen-space, off the depth pass: the thickness lookup is displaced along
     the surface normal's screen projection, so the bathymetry shelves, the foam
     line and the transparency all bend where the swell tilts the surface. What
     it does NOT bend is the seabed's own image - that arrives through the alpha
     blend at full resolution and is not resampled here. Bending it too would
     mean a second colour pass over the terrain; the note in dev/perf.mjs has
     what that costs.
     Scaled by thickness inside the shader, because a ray through half a metre
     of water has half a metre to bend in. */
  refract: 0,

  /* OPACITY, and it is the one term here that can DAMAGE something.
     The bone waterline stroke is drawn in the TERRAIN shader at |h| near zero
     and reaches the eye THROUGH this surface. So the invariant this pass has to
     hold is that the water's alpha in the shallows never goes up — and this is
     the only knob that could push it there. It is 0 on every world with a
     readable seabed, and it exists for the one world where water hiding what is
     under it IS the design: Shroud, where a pool whose depth you cannot read is
     the hazard rather than a failure to draw one. */
  opaque: 0,

  /* REFLECTION, AND IT IS NOT PLANAR. The MD asked for a planar reflection
     behind a measured tier gate; the measurement came back against building one
     at all, so this is what shipped instead and here is the number.
     A planar reflection needs a plane. This water is a closed shell around a
     planet, and with the eye at 9.5m where the chase camera sits:

         world     horizon    surface drop from the tangent plane    swell
         tarn          89m                                   9.5m      2.4m
         home         140m                                   9.5m      1.0m
         vault        126m                                   9.5m        0
         shroud       166m                                   9.5m      0.3m
         anvil        198m                                   9.5m      0.6m

     The drop at the horizon is just the eye height, on every world, because
     that is what a horizon is. So a mirror plane is wrong by four times Tarn's
     swell and thirty times Shroud's, and wrong WORST at the skyline, which is
     the one place anybody reads a reflection off water. It would cost a second
     render of the world every frame to be wrong there, which is why there is no
     tier at which it is the right trade rather than a cheaper one.
     What ships instead reflects the ray against the SKY, which is an analytic
     function of direction and therefore exact on a sphere at any range, for
     about ten instructions and no extra pass. It reflects the sky and not the
     terrain — the honest limit, and a small one on worlds whose horizon is a
     hundred metres off and hazed to the fog colour long before it gets there.
     mix is the no-op. fresnel is the exponent: 3 is close to Schlick, higher
     keeps the reflection to the grazing angles.
     maxMix is the CEILING, and it is the important one. Fresnel physically
     reaches 1.0 at grazing incidence, and at 1.0 the reflection is the surface:
     the water's own colour is gone and every band of the chart with it. A real
     sea can afford that because it has nothing to say. This one is a chart, and
     the most grazing view in the game is the one you spend the most time in —
     the deck of a boat. */
  reflect: { mix: 0, fresnel: 3.0, maxMix: 0.55 },

  /* 0 off, 1 thickness in metres as a ramp, 2 the depth pass raw, 3 the foam
     mask alone, 4 a flat magenta water mask. Read with the post stack off —
     ACES and a colour-grading LUT will regrade a debug ramp, and what comes
     back is then a tonemapped version of the number rather than the number.
     Mode 4 exists because the other three cannot be counted without it: terrain
     and sky have red channels too, and the first measurement off mode 3
     reported foam over 99.9% of Home. dev/waterstats.mjs reads it. */
  debug: 0,
};

/**
 * Frozen water — Vault, and nowhere else.
 *
 * Thickness falls off with DEPTH, which is the physical way round (a shallow
 * margin freezes solid; the deep middle of a lake freezes last and thinnest)
 * and also the only way round that produces a hazard: thin ice has to sit over
 * water deep enough to swamp a hull, or breaking through is a non-event.
 *
 * The melt line is the depth contour where thickness crosses `support`. It is
 * readable — the water shader already bands bathymetry into shelves — which is
 * the point: a hazard you read off the ice rather than one you see coming.
 */
export const ICE = {
  support: 0.50,       // metres of ice needed to hold the rover up
};

/**
 * Where the worlds are, in kilometres, in one frame.
 *
 * Separations are hundreds of km. That makes the discs honestly small: Anvil
 * seen from Home is 0.44 degrees across, slightly wider than a full moon, and
 * Ember is a fortieth of that — a bright point rather than a disc. Both are
 * correct, and the smallness is the reason the tint carries the identification.
 */
export const SYSTEM = {
  at: {
    home:   [0, 0, 0],
    ember:  [180, -60, 240],
    tarn:   [-260, 40, 150],
    vault:  [120, 200, -280],
    shroud: [-340, -120, -200],
    anvil:  [420, 90, 320],
  },
  // A disc smaller than a few pixels cannot be drawn as a disc without
  // shimmering, so the quad never goes below this angular radius and the honest
  // disc sits inside it surrounded by glow. That is also what a distant planet
  // looks like to the naked eye, so the cheat and the truth agree here.
  // 0.0095rad is about six pixels of radius at 560p — measured, because at the
  // 0.0022 this started at, four of the five worlds were a single pixel and
  // simply did not survive the frame.
  minAngle: 0.0095,     // radians
  pad: 3.4,             // quad is this many disc-radii wide, for the halo
  glow: 1.9,            // halo brightness, above 1.0 so the cores bloom
  distance: 0.42,       // where the billboards sit, as a fraction of farPlane

  /* THE DRAWN RADIUS, against the honest one.
     `minAngle` above sizes the QUAD, and a quad is not a disc: the disc inside
     it is drawn at `angle / quadAngle` of the way out, so flooring the quad
     left the honest disc exactly as small as it always was. Measured on Home at
     560p, the five discs came out 0.8 / 1.6 / 2.7 / 4.2 / 4.6 pixels ACROSS,
     and the smallest across the whole system — Ember seen from Vault — is 0.4.
     Under a pixel is not a disc, it is a flicker the resolve step averages away.

     So the drawn radius is the honest one COMPRESSED, not clamped:

         r = drawRef * (r_true / drawRef)^drawExp,  never below drawFloor,
                                                    never below r_true

     Compressed rather than clamped because clamping makes three worlds the
     same size and throws away the one cue that is free: at 0.30 the 23x spread
     of honest angles becomes 2.1x, which still reads as an ordering — Anvil is
     visibly the big one, Ember visibly the far one — while the small end lands
     on four pixels instead of one. `drawRef` sits at the system's widest honest
     angle so nothing is ever drawn smaller than the truth. */
  drawRef: 0.148,       // radians
  drawExp: 0.30,        // below it, sizes pull together instead of vanishing
  drawFloor: 0.034,     // and never below this: ~40px across at 560p

  /* WHY drawRef IS TWENTY TIMES THE LARGEST HONEST ANGLE.
     At the honest scale the discs were 0.4 to 8 pixels: correct, and useless.
     A world you cannot read is a light in the sky, and the point of putting
     six worlds up there is that you can tell an ocean from a canyon before you
     spend the fuel. These land at 40-70px across at 560p, which is where a
     disc starts reading as an object with a surface.
     The compression is unchanged and still does the only job it ever did —
     hold the near and far worlds within about 1.7x of each other so the far
     ones stay legible — and `Math.max(angle, ...)` still means nothing is ever
     drawn SMALLER than the truth. What changed is the scale, once, here. */

  /* Limb darkening: the fraction of full brightness left at the rim. This is
     also what makes a pale world legible against a pale sky — the edge goes
     darker than the haze behind it, and edge contrast is what carries a disc
     over a bright horizon. Brightness alone cannot: a lamp on a bright sky is
     the same problem as a lamp on a dark one, from the other side. */
  limb: 0.44,
  /* Core brightness, applied to the baked surface colour. Well under 1: these
     read as distant worlds catching light, and at 40-70px the old 2.2 made
     them lamps that dominated the sky. */
  disc: 0.95,
  night: 0.09,          // the unlit side, so the terminator is a real edge
  emitBoost: 1.6,       // Ember's cracks, added past the terminator so they bloom
};

/**
 * The world previews baked into the discs.
 *
 * One equirectangular map per planet, stacked into an atlas — see preview.js.
 * Resolution is the whole cost: the height field runs 2-4us a sample, so this
 * is width x height x six worlds x that. Measured on this machine:
 *
 *     128 x 64   ~140ms      192 x 96   ~310ms      256 x 128  ~550ms
 *
 * 128 x 64 is where it sits, and the reason is the DISC, not the budget: only
 * half a world faces you, so 64 texels are spread over a disc 40-70px wide.
 * That is about one texel per pixel — magnifying on the near worlds, barely
 * minifying on the far ones — which is the resolution that does not crawl when
 * the camera moves. 160 x 80 was measurably no sharper on screen and cost half
 * again as much, because the extra texels were being averaged away.
 */
export const PREVIEW = {
  width: 128,
  height: 64,

  /* What makes relief read when a palette will not.
     Vault is the world these are set against: its land is three shades of pale
     between 0.74 and 0.94 luminance, so the height ladder alone returns a
     featureless ball. All three terms are lifted from the terrain shader and
     all three use the planet's OWN colours, so a contrasty world like Anvil
     gets them as well and simply leans on them less. */
  basin: 0.34,          // how far the low ground goes toward the world's shade
  relief: 0.85,         // hillshade, from the terrain's departure from a sphere
  contourMinor: 0.30,   // the relief/8.7 lines, as in the shader
  contour: 0.55,        // ...and the relief/1.7 index lines
};

/**
 * Hyper travel.
 *
 * Speed scales with altitude above the nearest surface, automatically — there
 * is no warp button and no mode to switch into. Climb and you go faster:
 *
 *     v(a) = localSpeed x 2^(a / doubleEvery)
 *
 * Integrating that is the whole design. Time to climb away from a world is
 * H·2^(-a0/H) / (v0·ln2) and it CONVERGES: the trip takes the same time whether
 * the destination is forty kilometres away or four thousand, because the middle
 * of the journey is spent at speeds where distance costs nothing. Out and back
 * down the other side is twice that, and since the law reads altitude above the
 * NEAREST surface, the deceleration into the destination is the same curve
 * running backwards. There is no braking input because none is possible.
 *
 * `doubleEvery` is the only knob that changes trip time. Raising `maxSpeed`
 * changes the number on the HUD and almost nothing else — at the cap the craft
 * is crossing the empty middle, which is a fraction of a second either way.
 *
 * H is 1500. It was briefly 1750, chosen to put the boundary-to-boundary LEG on
 * the design's 27s — but the leg is not the trip. Door to door, with the climb
 * out and the descent in, that read 33-39s against a target of 20-30s. The leg
 * is the wrong thing to hold constant; what the player experiences is the
 * whole journey, so H comes back down and the leg gets shorter to pay for the
 * ends. Anvil stays the longest haul in the system, which is correct — it is
 * the one world whose distance should be felt.
 */
export const HYPER = {
  doubleEvery: 1500,     // H, metres of altitude per doubling
  localSpeed: 158,       // v0. Must match JET.boostSpeed — asserted in the suite
  maxSpeed: 1e6,         // the HUD's top number. Does not change trip time
  /* THE BOUNDARY, and there is only one: inside a planet's approach sphere you
     are in normal flight, outside every sphere you are in hyper. Arrival and
     departure are the same surface, which is why hyper can never begin from
     inside a sphere — it is the definition rather than a rule that needed
     enforcing. 900m sits ABOVE the jet's unassisted ceiling (~580m, measured):
     ordinary flight cannot reach it, and neither can a six-second boosted climb
     over a canyon (808m). A sustained boost burn — see JET.escapeThin — crosses
     it at 8.7s. That is the difference between leaving by accident and leaving
     on purpose, and it is the only thing standing between the two until the
     fuel check in Phase 4. */
  approachAlt: 900,
  /* Lock-on. A 600m sphere at 300km is 0.002 radians wide — a target no human
     aims at by hand, so the heading you leave with picks a world and the
     trajectory bends onto it. Bounded, so it reads as a course correction.
     3.0 rather than 0.9: at the slower rate a badly aligned departure spent six
     seconds rotating before it was pointed anywhere, which made Ember — the
     NEAREST world — the slowest trip in the system, and made the outbound half
     of a journey half again as long as the return. The turn is dead time; it
     should read as a correction, not as a manoeuvre. */
  turnRate: 2.0,         // rad/s at full speed...
  turnLow: 0.20,         // ...and this fraction of it at a standing start
  // How far off the heading a world can be and still be chosen as the target.
  lockCone: 1.15,        // radians from the departure heading
};

/**
 * The neutral grade every world ships with, T1.
 *
 * A LUT is the last thing the frame passes through, and the six palettes here
 * are authored and approved, so the transplant lands the plumbing rather than a
 * look: `identity.3dl` is a baked no-op and every profile below points at it.
 * The slot is what matters — a world that wants its own grade replaces one
 * string in its own profile and nothing else in the program changes.
 *
 * Declared above PLANETS on purpose: the profiles read it, and a const read out
 * of the temporal dead zone throws at module load.
 */
export const NEUTRAL_LUT = 'assets/luts/identity.3dl';

/* ...and since the grade pass, each world names its own instead. One file per
   world, baked by tools/bake_lut.py from one parameterised grade and six
   parameter sets — one function, so the cyan protection cannot drift between
   them. NEUTRAL_LUT stays: it is what post.js A/Bs against to prove the
   plumbing is not doing something of its own. */
const LUT = (name) => `assets/luts/${name}.3dl`;

export const PLANETS = {
  home: {
    key: 'home',
    name: 'Home',
    radius: 1036,
    seed: 'surveyor-home',
    lut: LUT('home'),
    /* Diagnosed rather than guessed. Home was the worst of the six and the
       cause was resolution, not depth: a 400m box on a 2048 map is 19.5cm a
       texel, and the terrain casting into it is flat-shaded triangle soup with
       a 14m skirt on every chunk edge — discontinuous at exactly the scale the
       map samples, which is acne no bias can reach. At 180m a texel is 8.8cm
       and the striped band is gone entirely, verified on the isolated shadow
       term. The strength below is only tunable at all because of that. */
    shadows: { range: 180, strength: 0.80 },
    /* T3 — light. Home's ground is soft banded terraces and a chart drawn on
       them, and the scan is FRACTURED STONE: at 0.9 the marble's crack network
       reads as line work and competes with the contours it is supposed to sit
       under. Enough here to give the ground a surface within a hundred metres
       of the rover and no more. */
    terrain: { strength: 0.30, detail: 0.12 },
    /* T2 — clear, high, neutral. The reference the other five are read
       against, so it says nothing and inherits everything. Its numbers ARE the
       defaults in LIGHT; spelling them out here would be five more places to
       forget to change. */
    waterY: 0,
    relief: 1036 / 20,        // ~52m, the cap the MD's radius table gives

    // Terrain terms. Same five as the flat world, re-expressed on the sphere.
    // seaBias/wCarve set the land-water split. At the flat world's 0.30/0.38
    // a sphere comes out 14% water and only 8m deep, which leaves the boat and
    // the flooding hazard with nothing to do — this is 30% water, a quarter of
    // it deep enough to swamp a rover.
    fShelf: 2.0,  wShelf: 1.00, seaBias: 0.36,
    fCarve: 5.5,  wCarve: 0.55,
    fRidge: 6.0,  wRidge: 0.30,
    fRough: 22,   wRough: 0.065,
    fFine: 60,    wFine: 0.016,
    fFissure: 0,  wFissure: 0, fissureNarrow: 1,   // no fissures on Home
    terraceStep: 5.0, terraceAmt: 0.62, terraceFrom: 0.17, terraceTo: 0.73,

    // Swell. Amplitude in metres, frequency in cycles across the sphere.
    waveAmp: 1.0, waveFreq: 90,

    /* WATER — the reference the other four are read against, so it takes the
       whole pass and says nothing else with it.
       measureDepth is not taste: Home's shelves were spread across 21.8m of
       guessed depth over water that is 9.9m deep, so the chart drew 2.7 of its
       six bands and the deep half of the palette had never been on screen.
       absorb 3.4m is read off that same 9.9m — the deepest water reaches about
       two halvings, so the deepest shelf is where the seabed goes, not a colour
       you have to swim to. */
    water: {
      measureDepth: true, sharpen: 1, waveNormal: 1,
      absorb: 3.4,
      foam: { shore: 0.65, edge: 0.30 },
      refract: 0.30,
      // Measured across five viewing angles, the depth gap runs 66-121 levels
      // and only softens looking straight down. A modest trim.
      glint: 0.30, skyCap: 0.45,
      // The reference: enough softening that the ladder reads as contours on a
      // surface, not so much that it stops being a ladder.
      bandSoft: 0.50, bandTilt: 0.38, ripple: 0.35, depthBlur: 5.0,
      ringFoam: 0.22, ringSoft: 0.26, ringHard: 0,
    },

    // Mesh. targetCell is held near-constant across worlds so the vehicles
    // handle the same everywhere; the quadtree depth changes instead.
    leafRes: 16, targetCell: 4.5,
    waterFaceRes: 40,

    // Fog and draw distance as fractions of the radius. The close horizon is
    // the point — each world should read as an object you can hold in your
    // head, not as scenery receding into haze.
    fogNear: 0.18, fogFar: 0.78,

    /* Clear, high, neutral — the reference the other five are read against, so
       it says as little as possible and inherits the rest. */
    sky: { band: 0.12, clouds: 1.0 },

    // The boulders and spires as authored: a mixed field, moderate everything.
    scatter: { density: 1.0, forms: [0.58, 0.17, 0.25], scale: 1.0 },

    // The richest field in the system, and the reason Home is home.
    geysers: { count: 12, yield: 1.0 },

    /* Raiders, per world, so each one's threat is as distinct as its terrain.
       Home is the reference: everything is RAIDER's default and the numbers on
       the other five are read against these. */
    raiders: {},
  },

  /* ------------------------------------------------------------------------
     The other five. Every one is a REDISTRIBUTION of Home's weight budget, not
     an escalation of it. Measured, not assumed: `relief` scales every term and
     relief is radius/20, so a bigger world already gets proportionally bigger
     landforms from identical weights. Anvil at twice Home's radius yields
     twice the absolute span with Home's numbers untouched; raising weights on
     top of that exceeds the cap and reads as spikes rather than landscape.
     So each profile moves weight BETWEEN terms to change what the world is
     made of, and leaves the total near where Home has it.
     ------------------------------------------------------------------------ */

  ember: {
    key: 'ember',
    name: 'Ember',
    radius: 207,
    seed: 'surveyor-ember',
    lut: LUT('ember'),
    /* Shadows OFF. Ember's light comes off the ground — the fissures are the
       source — so a directional sun shadow map here would draw shadows cast by
       a light that is not doing the lighting. See SHADOW above. */
    shadows: { enabled: false },
    /* T3 — medium. Basalt genuinely is fractured, so this is the one world
       where the scan's crack network is the right material rather than a
       borrowed one. Detail stays under the strength because the fissure
       emission is the brightest thing on this world and nothing may compete
       with it; it is applied after the light in any case, so it cannot be
       buried, only crowded. */
    terrain: { strength: 0.55, detail: 0.30 },
    /* T2 — THE FIRE IS THE LIGHT SOURCE, and the fill is NOT how you say that.
       First attempt put the fill at 0.46 on the reasoning that a world lit from
       underfoot has open shadows. It does, and it was still wrong: `ambient` is
       a flat lift across every surface, which is sky light — an overcast day,
       not a fire. It took the palette note above ("near-black basalt, every
       band dark so the fissure emission stands out") and undid it, and the
       cracks stood out LESS against ground that had come up to meet them.
       Ember's emission is localised and it is already the brightest thing in
       the frame; what it needs from the light rig is a DARK warm surround, not
       a bright one.
       So the fill stays low and the key carries a warm tint instead: a lit face
       is where it was, the shadow side lifts barely at all, and everything the
       sun touches is the colour of the fire that is actually lighting it. */
    light: {
      sunIntensity: 0.90, ambient: 0.10, shade: 0.88,
      sunColour: [1.00, 0.90, 0.80],
      rim: { power: 3.0, intensity: 0.70, sunMask: 0.15 },
      craftRim: { power: 2.6, intensity: 1.5, sunMask: 0.15 },
    },
    /* No water at all, said as a flag rather than as a waterline a kilometre
       underground. The -1000 this used to carry did express "dry", but it also
       moved the whole datum: with sea level applied properly Ember's ground
       would sit 1000m up, where the jet's ceiling, the hyper altitude law and
       the audio's altitude mix all stop meaning anything. `dry` costs one
       branch in the flooding path and nothing anywhere else. */
    waterY: 0,
    dry: true,
    relief: 207 / 20,          // 10.35m for the entire world

    /* Near-flat basalt. wShelf is a third of Home's and seaBias is pushed up
       so `land` saturates everywhere — there is no coast to shape, so the
       shelf term's only job is to stop the plain being dead level.
       Carve and ridge are OFF: at 10m of range they make bumps you cannot see,
       and spending the budget there is exactly what would turn Ember into a
       recolour of Home. */
    fShelf: 2.6,  wShelf: 0.34, seaBias: 0.10,
    fCarve: 5.5,  wCarve: 0.00,
    fRidge: 6.0,  wRidge: 0.00,
    fRough: 26,   wRough: 0.10,
    fFine: 70,    wFine: 0.030,
    // The feature. Narrow, so most of the surface is intact plain and a crack
    // is an event; deep relative to a 10m world.
    fFissure: 7.5, wFissure: 0.62, fissureNarrow: 3.2,
    terraceStep: 5.0, terraceAmt: 0,   // OFF — 5m steps in a 10.35m world
    waveAmp: 0, waveFreq: 90,
    leafRes: 16, targetCell: 4.5,
    waterFaceRes: 40,
    /* Near-black basalt. Every band is dark so the fissure emission (3a2, HDR)
       has somewhere to bloom against; `peak` and `coast` stay hot rather than
       pale because on Ember the bright end of the ramp is fire, not snow. */
    palette: {
      fog:      [0.129, 0.075, 0.063],
      fogSun:   [0.549, 0.220, 0.086],
      skyLow:   [0.353, 0.129, 0.055],
      skyHigh:  [0.055, 0.031, 0.035],
      deep:     [0.031, 0.020, 0.020],
      shallow:  [0.078, 0.043, 0.035],
      silt:     [0.086, 0.055, 0.047],
      shore:    [0.216, 0.110, 0.071],
      flats:    [0.114, 0.075, 0.067],
      stone:    [0.157, 0.114, 0.106],
      peak:     [0.706, 0.302, 0.098],
      coast:    [0.545, 0.208, 0.075],
      contour:  [0.243, 0.098, 0.043],
      phosphor: [1.000, 0.549, 0.220],
      // Warm shade rather than the system's cool one: on a world lit from the
      // ground up, the dark side of a rock is still orange.
      shade:    [1.000, 0.780, 0.620],
      rim:      [0.420, 0.130, 0.040],
      spec:     0.0,
      // Fissure emission. Authored ABOVE 1.0 so the bloom pass turns it into
      // glare — see `emit` in the sky block for how hot, and chunks.js for the
      // baked mask that decides where.
      emit:     [1.000, 0.360, 0.070],
      emitHot:  [1.000, 0.900, 0.720],
    },
    fogNear: 0.20, fogFar: 0.70,

    /* The fire is the light source. A low dark lid (ceiling 0.42 drags the
       strata down to just above the skyline), an orange underglow pushed well
       past 1.0 so it blooms, and ash falling constantly. Both optional layers
       are on here and nowhere else but Shroud. */
    sky: {
      below: [0.055, 0.024, 0.020],
      band: 0.55, bandWidth: 0.10, bandColor: [0.900, 0.330, 0.090],
      clouds: 1.4, cloudColor: [0.145, 0.075, 0.067], ceiling: 0.55,
      haze: 0.92,
      underglow: 1.5, underglowColor: [1.150, 0.420, 0.110],
      sunDir: [0.30, 0.24, 0.92],      // low, and barely a sun at all
      sunColor: [0.900, 0.400, 0.160], sunSize: 1.6, glare: 0.35,
      // Ash. Dense, dark, and falling — the only mote layer with real weight.
      motes: { color: [0.320, 0.180, 0.140], density: 3.2, fall: -1.5, size: 1.5 },
      /* How hard the fissures burn, and from what depth into the crack. 0 on
         every other world.
         emitFrom is measured, not guessed: the mask puts 21% of Ember's
         surface above 0.30 and 4% above 0.55, and a fifth of the world alight
         is a lava planet rather than a cracked plain. */
      emit: 2.8, emitFrom: 0.55,
    },

    // Shattered volcanic plates: wide, flat, sharp-edged, nothing tall. No
    // spires at all — vertical geometry is exactly what this world does not have.
    scatter: { density: 1.3, forms: [0.14, 0.86, 0.00], scale: 1.15, tall: 0.30, thin: 2.3, tilt: 0.55 },

    // Volcanic rather than gas: the vents are in the fissures, which are the
    // only hot thing here. Rare, but they pay like the world is dangerous.
    geysers: { count: 5, kind: 'fissure', yield: 1.6 },

    // Aggressive and fast. Half the approach of anywhere else, so the warning
    // you get on Ember is the shortest in the system — and thin armour, so the
    // answer is equally quick if you are pointed the right way.
    raiders: { approach: 13, spawnScale: 1.3, hpScale: 0.85, orbitRate: 0.95 },
  },

  tarn: {
    key: 'tarn',
    name: 'Tarn',
    radius: 414,
    seed: 'surveyor-tarn',
    lut: LUT('tarn'),
    // Low islands on a shallow sea: little to cast, and a humid 0.22 fill to
    // catch what does.
    shadows: { range: 160, strength: 0.70 },
    // T3 — light, and mostly moot: 89% of this world is water, and the
    // bathymetry shelves and the waterline stroke do the visual work on it.
    terrain: { strength: 0.30, detail: 0.10 },
    /* T2 — bright, humid, low contrast. Water is 89% of this world and haze is
       most of the rest, so the fill is high and the shade tint is weak: humid
       air scatters light back into the shadows and takes the colour out of them
       at the same time. The rim is half masked — enough to read as light on an
       edge, not enough to draw an outline through the haze. */
    light: {
      sunIntensity: 0.79, ambient: 0.22, shade: 0.55,
      sunColour: [1.00, 0.99, 0.96],
      rim: { power: 3.5, intensity: 0.48, sunMask: 0.50 },
    },
    /* The whole identity in one number. Home's mean surface sits near +5.9m,
       so a waterline above that drowns everything except the peaks and leaves
       an archipelago. Raising water is cheaper and truer than lowering land:
       the bathymetry banding already in the shader then does the work. */
    // Raised 6.5 -> 7.8 on review: 6.5 gave 73% ocean, which is roughly
    // Earth's ratio and reads as a normal world with a lot of sea. 7.8 gives
    // 86% — distinct islands in open water, which is what "almost entirely
    // ocean" has to mean for the boat to be the point. Terrain untouched: the
    // waterline is the only lever moved, so the span stays 75% of cap.
    waterY: 7.8,
    relief: 414 / 20,          // 20.7m

    // Shelf-dominant and smooth, so what breaks the surface is broad and low.
    // Ridge nearly off — islands, not sea mountains.
    fShelf: 1.7,  wShelf: 1.05, seaBias: 0.30,
    fCarve: 4.4,  wCarve: 0.34,
    fRidge: 7.5,  wRidge: 0.10,
    fRough: 20,   wRough: 0.055,
    fFine: 64,    wFine: 0.014,
    fFissure: 0,  wFissure: 0, fissureNarrow: 1,
    terraceStep: 2.2, terraceAmt: 0.30, terraceFrom: 0.30, terraceTo: 0.85,
    waveAmp: 2.4, waveFreq: 62,       // real swell — the boat world

    /* WATER — and this is the world the pass exists for. 85% ocean, 6.7m at its
       deepest, mean depth 2.6m: almost all of Tarn is shallow water seen at a
       grazing angle from a boat, which is the exact case every term here was
       built for.
       SHOAL 1.0, down from 3.0, and it is the one number here that changes the
       shape of the sea rather than its colour. The vertex shader flattens the
       swell over the last `shoal` metres of depth so waves cannot pierce sand —
       correct, and on the boat world it also meant the surf died three metres
       out and every beach was glass. At 1.0 the swell runs in to the sand.
       Nothing about the boat changes: the hull's ride height, its planing
       threshold and the whole wave-launch path read waveAt() on the CPU, which
       has never had a shoal term at all.
       absorb 2.4m over 6.7m of water: the deepest point is under two halvings,
       so Tarn stays a world you can see the bottom of. That is the point of it.
       foam is the widest of the five and the strongest, because on a world this
       shallow the shoreline IS the terrain feature. */
    water: {
      measureDepth: true, sharpen: 1, waveNormal: 1,
      shoal: 1.0,
      absorb: 2.4,
      /* 0.12, from 0.90 and then 0.28, and both intermediate values were still
         wrong for the same reason. A foam band stated in METRES OF DEPTH covers
         an area that depends on the SLOPE it is lying on, and Tarn is one long
         flat shelf: at 0.28m it still came back as 63% of every water pixel in
         the frame. Measured, not guessed — half of Tarn's visible water is
         under eight centimetres deep. On a shelf this flat the band has to be
         narrow and, more to the point, it has to be WEAK: at 0.85 the shallows
         went opaque white and the lagoon read as a snowfield. At 0.55 they read
         as pale water with sand under it, which is what they are. */
      foam: { shore: 0.12, edge: 0.30, strength: 0.55 },
      refract: 0.55,
      /* THE GLINT IS RELATIVE TO THE WATER IT LANDS ON, and Tarn's is the
         palest of the five — shallow sits at 0.35/0.69/0.72 before anything is
         added to it. A 0.40 white specular on top of that is most of the way to
         clipping, so the crests blow out and take the shelves with them: the
         depth gap measured 24 levels at six degrees against 82 at twenty-two.
         The cap matters more than the amplitude here, because it is the thing
         that holds when the swell puts a crest normal straight at the sun. */
      glint: 0.22, skyCap: 0.32,
      // The most surface life of the five: it is the boat world, it is 85%
      // ocean, and it is the one you spend the most time looking across.
      bandSoft: 0.50, bandTilt: 0.42, ripple: 0.48, depthBlur: 5.0,
      ringFoam: 0.20, ringSoft: 0.28, ringHard: 0,
    },
    leafRes: 16, targetCell: 4.5,
    waterFaceRes: 40,
    /* Pale, washed, high key. `coast` is pushed to near-white because on Tarn
       the waterline stroke is the dominant line on the world, not the
       contours — so the contour colour is deliberately weak. */
    palette: {
      fog:      [0.769, 0.816, 0.827],
      fogSun:   [0.929, 0.929, 0.882],
      skyLow:   [0.878, 0.918, 0.925],
      skyHigh:  [0.475, 0.663, 0.706],
      deep:     [0.161, 0.404, 0.451],
      shallow:  [0.353, 0.694, 0.718],
      silt:     [0.549, 0.694, 0.694],
      shore:    [0.937, 0.941, 0.886],
      // Pushed pale on review: at [0.61,0.67,0.62] Tarn's land was the same
      // green as Home's, and the two read as one world at thumbnail size. What
      // breaks above this waterline is bleached shell and bone, not meadow.
      flats:    [0.831, 0.843, 0.784],
      stone:    [0.784, 0.804, 0.792],
      peak:     [0.949, 0.957, 0.929],
      coast:    [1.000, 1.000, 0.973],
      contour:  [0.435, 0.529, 0.557],
      shade:    [0.870, 0.930, 0.960],   // barely any shadow: high-key, humid
      rim:      [0.560, 0.720, 0.720],
      spec:     0.10,
    },
    fogNear: 0.26, fogFar: 0.95,      // sea haze: far, not thick

    /* Bright, humid, low contrast. The wide soft horizon band IS the sea haze —
       it is what makes water and sky meet in a blur instead of a line. */
    sky: {
      below: [0.620, 0.706, 0.714],
      band: 0.62, bandWidth: 0.20,
      clouds: 0.55, ceiling: 1.25,
      haze: 0.95,
      sunDir: [-0.28, 0.66, 0.70],
      sunSize: 1.4, glare: 0.75,
    },

    // Sea stacks: eroded pillars, stout at the base and blunt-topped, standing
    // out of shallow water. Tall, but nothing like Shroud's needles.
    scatter: { density: 0.85, forms: [0.12, 0.10, 0.78], scale: 1.0, tall: 1.5, thin: 1.35, taper: 0.40, sides: 7 },

    // Vent from shallow water, so the plume is a landmark across open sea and
    // finding them is a boat problem rather than a driving one.
    geysers: { count: 8, kind: 'shallow', yield: 1.1 },

    // They come in across the water. `fromWater` picks the approach bearing by
    // sampling the ground around a site and taking the lowest — on a world that
    // is 86% ocean that is the sea, without anyone having to say where it is.
    raiders: { fromWater: true, approach: 32, spawnDist: 1.3 },
  },

  vault: {
    key: 'vault',
    name: 'Vault',
    radius: 829,
    seed: 'surveyor-vault',
    lut: LUT('vault'),
    // Hard shadows, and they come for free: this world's fill is 0, so a
    // shadowed face falls all the way to nothing. Long ones, too — the sun is
    // the lowest of the five that have shadows.
    shadows: { range: 180, strength: 0.95 },
    /* T3 — light, and deliberately not zero. A fracture network is what
       crevassed ice looks like, so the scan's relief suits this world; what
       does NOT suit it is a matte rock grain over a surface whose whole
       identity is the hard specular glint. Normal up, detail down. */
    terrain: { strength: 0.35, detail: 0.10 },
    /* T2 — cold, clear, hard light, long shadows. The only world with the fill
       at zero: nothing is scattering, so a shadow is the absence of the sun and
       nothing else. shade at 0.92 drives the palette's deep blue — the note on
       that colour says "on ice the shadow IS the colour information" — and the
       rim goes tight and almost fully sun-masked, which is what hard light
       looks like: a bright edge where the sun catches, nothing where it does
       not. This is the world where `spec: 0.85` finally has a light rig worth
       glinting off. */
    light: {
      sunIntensity: 1.02, ambient: 0.0, shade: 0.92,
      sunColour: [0.94, 0.97, 1.00],
      rim: { power: 4.5, intensity: 0.50, sunMask: 0.90 },
      craftRim: { power: 3.0, intensity: 1.5, sunMask: 0.75 },
    },
    // Ice sits where Home's water does; what differs is the SURFACE RULE, and
    // that is not a terrain weight — see NEEDS DEX, it is still to be wired.
    waterY: 0,
    relief: 829 / 20,          // 41.45m

    /* Glacial: broad smooth sheets. Roughness and fine grain are cut hard,
       because a glacier is the smoothest thing in the system; the budget those
       give up goes into carve, which is what makes crevasses. */
    fShelf: 1.8,  wShelf: 1.00, seaBias: 0.34,
    fCarve: 7.0,  wCarve: 0.62,       // crevasse cuts, sharp and narrow
    fRidge: 4.5,  wRidge: 0.16,
    fRough: 16,   wRough: 0.018,      // a quarter of Home's
    fFine: 48,    wFine: 0.006,
    fFissure: 0,  wFissure: 0, fissureNarrow: 1,
    // Wide and shallow against Home's tight 5m: 9m steps read as ice shelves.
    terraceStep: 9.0, terraceAmt: 0.72, terraceFrom: 0.10, terraceTo: 0.80,
    waveAmp: 0, waveFreq: 90,         // frozen: no swell

    /* WATER — two terms, and neither of them is about water.
       Vault's surface is ice: the frozen branch ends with mix(col, ice, uFrozen)
       and uFrozen is 1, so absorption, foam and refraction are all computed and
       then painted over. Verified rather than assumed — lifting uFrozen for one
       frame in dev/noop.mjs shows 8.1% of the frame responding, so the pass is
       live here and the ice is simply on top of it. No swell either, so
       waveNormal has nothing to do.
       What DOES matter is the two that reach the ice. measureDepth takes
       uMaxDepth from 17.4m to the 8.0m the world actually has, which halves the
       width of the melt-line stroke and tightens the darkening ramp behind it.
       sharpen reads that depth per pixel instead of interpolating it across a
       32m mesh cell. Between them the melt line stops being a soft 30m band and
       becomes a line — and the melt line is the hazard: past it the ice does not
       hold the rover. The physics is untouched (iceHolds reads surfaceHeight on
       the CPU), so this is the drawn line moving TOWARD the real one. */
    /* iceDepth 0.80, from 0.55. The glare terms do not reach this world at all
       — the frozen branch replaces the colour after they are added — so the
       only thing that carries depth on Vault is the ice's own ramp, and at 0.55
       it was a flat white sheet with a single stroke across it. Depth here is
       ice thickness is whether the sheet holds you, so this is the hazard read
       and not a look. */
    /* NO ripple and NO band terms on Vault, and that is not an oversight.
       The frozen branch replaces the colour outright after all of them are
       computed, so neither the shelves nor anything that perturbs the normal
       reaches the eye here — the ice draws its own ramp off the same depth.
       Verified rather than assumed: lifting uFrozen for one frame in
       dev/noop.mjs shows 8.1% of the frame responding underneath it. */
    water: { measureDepth: true, sharpen: 1, iceDepth: 0.80 },
    leafRes: 16, targetCell: 4.5,
    waterFaceRes: 40,
    /* White, pale blue, deep shadow. The widest gap in the system between
       `deep` and `peak`: on ice the shadow is the colour information, so the
       low end goes properly dark rather than merely grey. */
    palette: {
      fog:      [0.780, 0.847, 0.902],
      fogSun:   [0.949, 0.965, 1.000],
      skyLow:   [0.831, 0.898, 0.949],
      skyHigh:  [0.239, 0.412, 0.573],
      deep:     [0.075, 0.153, 0.259],
      shallow:  [0.427, 0.635, 0.769],
      silt:     [0.545, 0.671, 0.761],
      shore:    [0.906, 0.949, 0.980],
      flats:    [0.800, 0.867, 0.906],
      stone:    [0.694, 0.749, 0.796],
      peak:     [1.000, 1.000, 1.000],
      coast:    [0.878, 0.949, 1.000],
      contour:  [0.310, 0.427, 0.541],
      shade:    [0.420, 0.600, 0.900],   // the deepest, bluest shadow in the system
      rim:      [0.560, 0.780, 1.000],
      // The one world with real specular. Ice glints on the flats and the hull
      // catches a hard highlight here where it catches nothing anywhere else.
      spec:     0.85,
    },
    fogNear: 0.30, fogFar: 1.00,      // cold clear air, the longest view here

    /* Cold, clear, hard. Almost no cloud and the least haze in the system, so
       the shadow side of everything stays dark instead of filling with air. */
    sky: {
      below: [0.620, 0.729, 0.820],
      band: 0.06, bandWidth: 0.03,
      clouds: 0.12,
      haze: 0.40,
      sunDir: [0.62, 0.70, -0.35],
      sunColor: [1.000, 1.000, 1.000], sunSize: 0.7, glare: 1.3,
    },

    // Crystalline shards: few sides, near-linear taper to a point, leaning.
    // Faceted rather than eroded — the silhouette is angular where Tarn's is
    // rounded and Shroud's is a needle.
    scatter: { density: 1.25, forms: [0.22, 0.18, 0.60], scale: 0.8, tall: 0.55, thin: 0.75, taper: 0.95, sides: 4, tilt: 0.42 },

    // Steam through the ice, out where the sheet still holds a rover.
    geysers: { count: 7, kind: 'ice', yield: 1.0 },

    // Slow and armoured. Twice the hit points and the longest approach in the
    // system, which is a long warning and a long answer: the beam takes 3.5s on
    // one of these against 1.9 anywhere else, and ramming is the fast way.
    raiders: { approach: 46, hpScale: 1.9, spawnScale: 0.7, orbitRate: 0.30 },

    /* THE MECHANIC. Ice this thick at zero depth, thinning to nothing as the
       water deepens; ICE.support decides where it stops holding. With these
       numbers the melt line lands near 6m of depth — comfortably past
       ROVER.sinkDepth, so going through genuinely floods you. */
    iceThickness: 1.5, iceMeltFrom: 4.0, iceMeltTo: 7.5,
  },

  shroud: {
    key: 'shroud',
    name: 'Shroud',
    radius: 1451,
    seed: 'surveyor-shroud',
    lut: LUT('shroud'),
    // Short range and weak: the fog closes in at 232m here, so anything past
    // that is spent, and dense particulate is exactly what fills a shadow in.
    shadows: { range: 150, strength: 0.62 },
    // T3 — the least of the six. Most of this world is behind its own fog, and
    // detail spent past the fog line is detail nobody sees.
    terrain: { strength: 0.25, detail: 0.08 },
    /* T2 — dense particulate; the fog is the antagonist. Fill is high because
       everything in the air is scattering the key back down, and the key is
       correspondingly weak. The shade tint is pulled back to 0.50 for the same
       reason: scattered light arrives from everywhere, so it does not carry a
       direction or a colour the way a clear sky's does. Cool violet key. */
    light: {
      /* Fill at 0.18, not the 0.34 the physics argued for. Scattering really
         does open these shadows, but Shroud's deeper violet is an approved
         look and 0.34 lifted the ground about a tenth and took the depth out
         of it. The shade tint comes back up to 0.62 for the same reason: the
         violet is the world, and the fog is allowed to be the antagonist
         without also being the thing that washes it out. */
      sunIntensity: 0.84, ambient: 0.18, shade: 0.62,
      sunColour: [0.92, 0.90, 1.00],
      rim: { power: 3.0, intensity: 0.52, sunMask: 0.20 },
    },
    /* Pools in the valley floors, which at -2 was 43% of the world — a sea. -12
       leaves 19%: standing water only where the valleys actually bottom out,
       which is what makes the flooding hazard here a thing you drive into
       rather than a thing you drive around. */
    waterY: -12.0,
    relief: 1451 / 20,                // 72.55m

    /* Genuinely good topography that you cannot see. The terrain is the reward
       for using the overlay, so the weights are deliberately dramatic — deep
       carve for valleys, real ridge for walls — and the FOG does the hiding
       rather than the terrain being flat. */
    fShelf: 2.2,  wShelf: 0.92, seaBias: 0.40,
    // Trimmed with the waterline: dropping the sea exposes terrain the lake-floor
    // clamp used to flatten, which pushed the span from 80% of cap to 87%.
    fCarve: 6.2,  wCarve: 0.62,       // deep valleys
    fRidge: 5.2,  wRidge: 0.30,
    fRough: 24,   wRough: 0.060,
    fFine: 58,    wFine: 0.015,
    fFissure: 0,  wFissure: 0, fissureNarrow: 1,
    terraceStep: 4.0, terraceAmt: 0.40, terraceFrom: 0.20, terraceTo: 0.78,
    waveAmp: 0.3, waveFreq: 110,      // still, dark pools

    /* WATER — the only world where the water is supposed to LIE to you.
       A Shroud pool whose depth you can read is not a hazard, it is a puddle
       with a label. So this is the one profile that turns opacity up: absorb at
       1.6m is four halvings before the deepest point, and opaque 0.45 lifts the
       alpha the rest of the way, so what you get back off a pool is the surface
       and not the bottom.
       The bathymetry shelves still draw — they are computed ON the surface, not
       seen through it — and Shroud's own palette already sets deep and shallow
       two shades apart in the same violet, so the chart is present and nearly
       unreadable, which is exactly the reading this world wants.
       Foam is the narrowest and weakest of the five: a bright edge would put a
       high-contrast line around every pool and hand back the outline the rest of
       this is hiding. It is here at all so the water's edge is not a hard seam
       against the rock. */
    water: {
      measureDepth: true, sharpen: 1, waveNormal: 1,
      // absorb does most of the hiding now that its transparency half runs off
       // path length, so `opaque` only has to close the shallow margin where the
       // path is short and the bottom would otherwise show through at the rim.
      absorb: 1.6, opaque: 0.30,
      // Same correction as Tarn's and for the same reason: 0.25m came back as
      // 40% of the pool, which is a rim drawn as a fill. On the one world whose
      // water is supposed to hide things, that is the wrong direction twice.
      foam: { shore: 0.12, edge: 0.20, strength: 0.45 },
      refract: 0.10,
      /* The tightest cap of the five, and Shroud earns it by having the darkest
         water: deep is 0.055/0.047/0.086, so a 0.40 white specular is not a
         highlight on this surface, it is five times the surface. The depth gap
         went flat looking down — five levels, and briefly inverted — which is
         a pool reading as a mirror rather than as a hazard you cannot see the
         bottom of. */
      glint: 0.12, skyCap: 0.16,
      /* A ripple, but barely a ladder. Shroud's pools are supposed to be
         depth-unreadable, so the softening is here to stop the rim reading as
         cut paper and not to open the chart up. */
      bandSoft: 0.45, bandTilt: 0.30, ripple: 0.30, depthBlur: 5.0,
      ringFoam: 0.12, ringSoft: 0.30, ringHard: 0,
    },
    leafRes: 16, targetCell: 4.5,
    waterFaceRes: 40,
    // The antagonist. Pulled in hard — a fraction of what the radius allows.
    /* Violet and deep grey, and low contrast on purpose — the murk is the
       antagonist, so the ramp is compressed and the contour is only just
       readable. The overlay is what you are meant to navigate by. */
    palette: {
      fog:      [0.243, 0.216, 0.302],
      fogSun:   [0.416, 0.361, 0.478],
      skyLow:   [0.298, 0.259, 0.361],
      skyHigh:  [0.110, 0.094, 0.153],
      deep:     [0.055, 0.047, 0.086],
      shallow:  [0.129, 0.114, 0.180],
      silt:     [0.157, 0.141, 0.204],
      shore:    [0.361, 0.325, 0.416],
      flats:    [0.216, 0.196, 0.267],
      stone:    [0.278, 0.259, 0.325],
      peak:     [0.510, 0.475, 0.573],
      coast:    [0.451, 0.412, 0.518],
      contour:  [0.180, 0.161, 0.235],
      phosphor: [0.694, 0.478, 0.945],
      shade:    [0.620, 0.580, 0.780],
      rim:      [0.300, 0.240, 0.420],
      spec:     0.0,
    },
    fogNear: 0.020, fogFar: 0.115,

    /* Denial of vision. Full haze, a low violet lid, no horizon band at all —
       there is no horizon to band, the murk closes before it. The sun is a
       stain rather than a disc. */
    sky: {
      below: [0.180, 0.161, 0.235],
      band: 0, bandWidth: 0.02,
      clouds: 1.5, cloudColor: [0.280, 0.247, 0.353], ceiling: 0.55,
      haze: 1.0,
      sunDir: [-0.50, 0.62, -0.60],
      sunColor: [0.470, 0.400, 0.560], sunSize: 1.6, glare: 0.20,
      // The particulate itself. Densest layer in the system, drifting rather
      // than falling — this is what you are looking through.
      motes: { color: [0.420, 0.380, 0.520], density: 5.0, fall: -0.35, size: 1.8 },
    },

    // Needles. Very tall, very thin, sparse — they loom out of the fog one at a
    // time at close range, which is the whole effect.
    scatter: { density: 0.72, forms: [0.14, 0.06, 0.80], scale: 0.9, tall: 2.4, thin: 0.42, taper: 0.80, sides: 6 },

    // You will not see these until you are on top of them, which is what makes
    // the overlay in 4b the way you work here.
    geysers: { count: 8, yield: 1.2 },

    /* Ambush. `ambush` holds the mesh back until a raider is inside this range,
       so on Shroud there is no visual warning at all and the overlay is the only
       thing that sees them coming — which is the same statement the fog already
       makes about the terrain, said about the threat. */
    raiders: { ambush: 70, approach: 22, spawnDist: 0.45 },
  },

  anvil: {
    key: 'anvil',
    name: 'Anvil',
    radius: 2072,
    seed: 'surveyor-anvil',
    lut: LUT('anvil'),
    // The longest box in the system. 104m of relief and real canyon walls, so
    // the casters are big and the shadows are the point.
    shadows: { range: 260, strength: 0.88 },
    /* T3 — the most of the six, and the world this transplant is for. 104m of
       relief, real canyons, rust and ochre: fractured stone is what Anvil
       actually is, and it is the only world where the scan is not standing in
       for something else. Its contours are 60m apart at the index interval, so
       there is room between them for a surface. */
    terrain: { strength: 0.85, detail: 0.40 },
    /* T2 — thin, high, washed out. A little fill from a thin sky, a weak shade
       tint because there is not much sky to tint it, and the most strongly
       sun-masked rim after Vault: thin air means edges are lit or they are not.
       This is the largest world in the system and the one whose relief does the
       most work, so the rim is kept low enough not to outline every ridge. */
    light: {
      sunIntensity: 0.79, ambient: 0.22, shade: 0.50,
      sunColour: [1.00, 0.98, 0.94],
      rim: { power: 3.8, intensity: 0.45, sunMask: 0.60 },
    },
    /* Sparse, and now actually sparse. At -14 the corrected waterline put 22%
       of Anvil under water, which is a coastline, not "a few canyon-floor
       rivers". -24 leaves 10%: the water is only in the deepest cuts, which is
       what makes reaching it worth doing. */
    waterY: -24.0,
    relief: 2072 / 20,                // 103.6m

    /* Extreme by REDISTRIBUTION, not escalation — the measured finding that
       matters most. At 2072m radius relief is already double Home's, so Home's
       own weights would give about 96m of span here; pushing them up on top
       blows the cap.
       So shelf comes DOWN to make room and that budget moves into ridge and
       carve, which is what turns "twice as big as Home" into canyons and mesas
       rather than a scaled-up Home. */
    fShelf: 1.5,  wShelf: 0.72, seaBias: 0.42,
    // Raised on review from 0.66/0.46, which left Anvil at 69% of cap with
    // 34m unused — underspending the one world whose whole identity is
    // topography. 0.86/0.66 measures at 85% of cap (88.2m), still inside the
    // budget and now genuinely the deepest relief in the system by a margin
    // rather than a hair. Shelf stays down at 0.72 so this is still a
    // redistribution toward canyon and ridge, not a uniform scale-up.
    /* Trimmed 0.86/0.66 -> 0.70/0.54 on review. Those weights measured 85% of
       cap against the old broken datum and 92% against the corrected one, which
       left the assertion almost no headroom and started reading as spikes
       rather than landscape. This is 85% again, honestly this time. */
    fCarve: 4.0,  wCarve: 0.70,       // canyon systems
    fRidge: 3.2,  wRidge: 0.54,       // still the highest ridge weight in the system
    fRough: 18,   wRough: 0.050,
    fFine: 52,    wFine: 0.012,
    fFissure: 0,  wFissure: 0, fissureNarrow: 1,
    // Tall steps: mesas. 14m against Home's 5m, affordable because the budget
    // is twice the size.
    terraceStep: 14.0, terraceAmt: 0.70, terraceFrom: 0.22, terraceTo: 0.86,
    waveAmp: 0.6, waveFreq: 130,

    /* WATER — sparse, and the profile says so by understating everything.
       9.6% of Anvil is water, in scattered pans rather than a sea, and its
       shelves were the worst-served of the six: 43.5m of guessed depth over
       11.5m of actual water, so the chart drew ONE AND A HALF of its six bands
       and five-sixths of the palette was unreachable. measureDepth is most of
       what this world gets.
       absorb 4.5m is the longest of the five on purpose. Anvil's water is a
       thing you find, and finding it should mean being able to see into it —
       a pan you can read the bottom of reads as a landmark, and one you cannot
       reads as more ground. */
    water: {
      measureDepth: true, sharpen: 1, waveNormal: 1,
      /* 7.0m to halve, not 4.5. At 4.5 the pans came back as flat dark holes:
         the transparency half of absorption runs off PATH length, and a long
         slant across eleven metres of water is four halvings whatever the
         colour half is capped at. A pan you cannot see into reads as more
         ground, which is the opposite of the landmark it is supposed to be. */
      // Anvil reads well at every angle already (74-93 levels); the cap is here
      // so a crest at the wrong moment cannot undo that, not to change it.
      glint: 0.34, skyCap: 0.50,
      bandSoft: 0.50, bandTilt: 0.38, ripple: 0.34, depthBlur: 5.0,
      ringFoam: 0.20, ringSoft: 0.26, ringHard: 0,
      absorb: 7.0,
      // 1.2m of depth, the widest of the five, because Anvil's pans have the
      // steepest edges of the six worlds — at 0.60 the band was under a tenth
      // of a percent of the frame, which is a line too thin to be a shore.
      foam: { shore: 1.20, edge: 0.35, strength: 0.85 },
      refract: 0.25,
    },
    leafRes: 16, targetCell: 4.5,
    waterFaceRes: 40,
    /* Rust, ochre, dark iron. The one world with the vertical range for
       contours to read as a chart, so `contour` is the strongest in the
       system rather than the faintest. */
    palette: {
      fog:      [0.635, 0.549, 0.475],
      fogSun:   [0.898, 0.804, 0.667],
      skyLow:   [0.804, 0.741, 0.667],
      skyHigh:  [0.400, 0.427, 0.463],
      deep:     [0.110, 0.086, 0.075],
      shallow:  [0.275, 0.204, 0.153],
      silt:     [0.353, 0.259, 0.192],
      shore:    [0.706, 0.573, 0.416],
      flats:    [0.475, 0.353, 0.243],
      stone:    [0.396, 0.325, 0.286],
      peak:     [0.851, 0.780, 0.686],
      coast:    [0.776, 0.647, 0.482],
      contour:  [0.161, 0.098, 0.071],
      shade:    [0.760, 0.680, 0.700],   // dark iron, not blue
      rim:      [0.420, 0.300, 0.200],
      spec:     0.0,
    },
    fogNear: 0.22, fogFar: 0.92,      // thin, high, empty

    /* Thin, high, washed out. Almost no cloud because there is almost no air:
       the gradient runs a long way from a pale dusty horizon up to slate. */
    sky: {
      below: [0.400, 0.325, 0.263],
      band: 0.32, bandWidth: 0.09,
      clouds: 0.22, ceiling: 1.6,
      haze: 0.60,
      sunDir: [0.20, 0.86, 0.47],
      sunSize: 0.85, glare: 1.15,
    },

    // Home's field scaled up and coarsened: enormous boulders and fallen slabs,
    // no spires. Scale is against a relief cap twice Home's, so these are the
    // biggest rocks in the system by a wide margin.
    scatter: { density: 0.9, forms: [0.66, 0.34, 0.00], scale: 1.9, tall: 0.85, thin: 1.5, tilt: 0.62 },

    // Scattered thinly across the biggest surface in the system. The longest
    // survey, and the one the jet earns its keep on.
    geysers: { count: 6, yield: 1.3 },

    // Numerous, individually weak, and a long way apart — the same thing the
    // topography does to everything else on this world.
    raiders: { spawnScale: 1.7, maxPerDome: 0.5, hpScale: 0.8, dpsScale: 0.75 },
  },
};

export const ROVER = {
  accel: 42,
  boostAccel: 88,
  maxSpeed: 34,
  boostSpeed: 44,      // was 62, which was about a third too quick on the ground
  turn: 1.85,          // rad/s at speed
  drag: 1.5,
  waterDrag: 6.5,      // wallowing when you drive into a lake
  waterMaxSpeed: 9,
  // Height of the chassis ROOT above the surface on flat ground. The wheels
  // hang WHEEL.radius below their mount, and meshes.js derives that mount from
  // this number, so the two can never drift apart again.
  rideHeight: 0.55,
  tiltLerp: 6,
  harvest: 0.8,        // fuel/sec while moving on land
  // Water is now a real hazard rather than just slow. Shallow you can ford;
  // past sinkDepth the hull floods and the survey has to fish you out.
  fordDepth: 1.7,      // metres of water you can drive through unbothered
  sinkDepth: 3.3,      // deeper than this and you start going under
  sinkRate: 1.25,      // metres/sec the flooded hull settles, accelerating
  drownDepth: 4.6,     // metres below the ride line before you're recovered
  drownTime: 3.2,      // ...or this long fully swamped, whichever comes first
  bedClearance: 0.45,  // the hull rests on the lake bed, it doesn't pass through
};

export const BOAT = {
  accel: 34,
  boostAccel: 74,
  maxSpeed: 38,
  boostSpeed: 66,
  turn: 1.35,
  landDrag: 9,         // beached
  landMaxSpeed: 5,
  harvest: 0.5,

  // Planing. Below planeSpeed the hull is pushing water uphill — heavy drag,
  // bow up. Above it the hull comes up and rides on top. The crossing is a
  // felt event, not a silent constant swap, so it has hysteresis and fires an
  // audible/visible transition either way.
  drag: 0.85,          // planing drag
  ploughDrag: 2.7,     // ...and the drag of shoving water instead
  planeSpeed: 16,      // m/s at which the hull comes up
  planeWidth: 6,       // width of the transition band
  planeOn: 0.75,       // it takes more to get up than to stay up
  planeOff: 0.25,
  bowUp: 0.26,         // radians of bow rise while ploughing

  // Carving. Lateral velocity bleeds off faster the harder you're banked, so
  // a committed turn holds its line and a lazy one washes out sideways.
  bleedLazy: 1.9,      // sideways bleed with the hull flat
  bleedCarve: 8.5,     // ...and fully banked while planing
  bankMax: 0.62,       // radians of lean at a full committed turn
  drift: 0.55,         // how much velocity keeps its old heading

  // Waves. Hitting a rising swell with the hull planing launches you. The
  // swell is only ~0.76m peak to peak, so even flat out the surface under the
  // bow rises at ~2.3 m/s — the threshold has to live under that or nothing
  // ever launches, and the multiplier is what turns it into real air.
  waveLaunch: 3.6,     // rising surface velocity converted to air
  waveMinRise: 0.9,    // m/s of surface rise before it throws you
  waveCooldown: 0.35,  // so one crest is one launch, not forty
  slamKeep: 0.55,      // fraction of speed kept on the worst landing
  slamFrom: 5,         // impact below this is free

  // Boost is a surge, not just a higher ceiling.
  surgeTime: 0.40,
  surgeAccel: 120,
};

export const JET = {
  thrust: 62,
  boostThrust: 138,
  maxSpeed: 92,
  boostSpeed: 158,
  pitchRate: 1.5,
  rollRate: 2.9,
  yawFromRoll: 0.9,    // banked turns
  levelAssist: 0.9,    // auto roll-level when no input
  lift: 9.4,
  gravity: 15.5,
  minFuelToLaunch: 8,
  // TESTING: flight is effectively unlimited while the handling is being
  // tuned. Put these back to 3.2 / 7.0 to restore the fuel economy.
  burn: 0.30,          // fuel/sec airborne
  boostBurn: 0.85,
  launchImpulse: 26,
  launchSpeed: 54,     // you are handed flying speed rather than asked to find
                       // it — launching below stall was why 3 just face-planted
  stallSpeed: 40,      // below this the wings stop working
  crashSpeed: 78,      // above this, terrain contact = crash, not a landing
  minSpeed: 30,        // powered flight never decays below this
  glideMinSpeed: 20,
  ceiling: 300,        // thrust starts falling off here (metres above sea)
  ceilingFade: 170,    // and is gone this far above it
  /* ...unless you are boosting. Above the ceiling a held boost keeps this much
     of its thrust, and that is the ONLY way off a planet.
     Without it the jet tops out at ~580m whether you climb for four seconds or
     twenty-five — the fade is a wall, not a slope — so there was no altitude at
     which "pulled up over a canyon" and "deliberately leaving" could be told
     apart, and the boundary could only be set to make departure impossible or
     to make it an accident. Boost is a held key that costs fuel, which makes
     leaving an act rather than a drift. Let go above the ceiling and you sink
     back, which is the same statement read backwards. */
  escapeThin: 0.50,

  // Autopilot. Every launch begins hands-off, holding a safe height over the
  // terrain, and hands over the moment you give a pitch or roll input. It is
  // the difference between "I flew" and "I crashed before I saw anything".
  assistTime: 9,       // seconds of hands-off flight after a launch
  assistAlt: 75,       // metres above ground it settles at
  assistRate: 2.2,     // how firmly it corrects toward that
  assistFade: 1.4,     // seconds to hand over once you touch the controls
  // Ground proximity warning, and it does something about it. Always on, even
  // in manual — it softens a dive into a hillside instead of ending it.
  avoidRange: 42,
  avoidLift: 26,
};

// Six big lugged tyres on independent gas struts. Each wheel samples the ground
// underneath itself, so the rover crawls over a terrace instead of sliding up
// it as one rigid block.
export const WHEEL = {
  radius: 0.95,
  halfWidth: 0.40,
  lugs: 13,            // tread blocks around the circumference
  lugDepth: 0.16,
  lugWidth: 0.30,      // as a fraction of the tread width, per row
  track: 1.62,         // centreline to wheel centre
  axles: [-1.80, 0.0, 1.80],
};

export const SUSP = {
  up: 0.46,            // metres of compression before it bottoms out
  down: 0.58,          // metres of droop before the strut is topped out
  rate: 17,            // how fast a wheel chases the ground under it
  // How much the chassis lifts when the wheels find rougher ground than the
  // point under its belly. Push this up and the rover starts hovering again.
  bodyShare: 0.25,
  attitude: 0.9,       // fraction of body pitch/roll taken from wheel contacts
  rollSign: 1,         // validated against the terrain normal in dev/run.mjs
  strutMin: 0.42,      // piston never fully retracts into the sleeve
};

// SPACE. The rover squats, extends, and leaves the ground; the wheels trail
// behind the body because they're hanging off suspension, not bolted to it.
export const HOP = {
  impulse: 8.6,        // m/s of vertical kick at the top of the extension
  crouch: 0.085,       // minimum squat, so even a tap reads as a crouch
  cooldown: 0.24,      // after the launch, before you may charge again

  // Hold SPACE to wind up, release to leap. A full charge is 10x the height of
  // a tap — but height goes as v²/2g, so the IMPULSE multiplier is sqrt(10).
  // Multiplying the impulse by 10 would give 100x the height and put the rover
  // in orbit. The curve is linear in height, hence sqrt(1 + t·9) in craft.js.
  chargeTime: 1.10,    // seconds of hold to reach full
  chargeMax: 3.162,    // impulse multiplier at full charge = sqrt(10)
  chargeDip: -0.42,    // how far the chassis squats when fully wound up
  gravity: 27,         // hop arc only — nothing else uses this
  bodyDip: -0.34,      // metres the body compresses during the crouch
  bodyRise: 0.20,      // and overshoots on the way up
  wheelDroop: 0.30,    // how far the wheels hang once the load comes off
  bodyLerp: 18,        // body spring rate
  wheelLerp: 8.5,      // wheels chase the body slower — that IS the lag
  chainWindow: 0.30,   // hop this soon after landing and you keep momentum
  chainBonus: 0.055,   // and gain a little
  chainCap: 1.18,      // ceiling on chained speed, as a multiple of maxSpeed
  // Automatic air when the ground drops away. OFF: this world is terraced in
  // 5m steps, so virtually every terrace edge tripped it and the rover spent
  // its life skipping and bouncing. Space is how you leave the ground.
  ledgeAir: false,
  ledgeDrop: 2.6,      // ground falling away faster than this counts as air
  boatImpulse: 6.6,    // the boat leaps off a swell instead
  jetImpulse: 11.0,    // in the air it's a pop, not a jump
  jetDecay: 4.2,
  jetCost: 1.4,        // and it costs charge
};

/**
 * Air, canopy and skid — the three things that happen between forms.
 *
 * These sit after HOP because they are all read against it: HOP.gravity is the
 * fall PARACHUTE.descent is holding you against, and HOP owns the airborne
 * state AIR decides you are in. Nothing here is per-planet — the parachute
 * ceiling is derived from `planet.relief`, so the six PLANETS entries above
 * carry no key for it and cannot fall out of step with it.
 */
export const AIR = {
  // What separates "transformed in the air" from "transformed on the deck".
  // The jet's own landing sets you down at floor + 1.3 and then calls setMode,
  // so this has to sit above that: touching down must not read as a mid-air
  // transform, or every landing would leave you falling.
  minClearance: 3.0,
  // Height over the waterline past which a rover is falling TOWARD water rather
  // than wading in it. A hop tops out well under this; a drop out of a jet is
  // far above it.
  wadeCeiling: 6.0,
};

export const PARACHUTE = {
  /* IT DEPLOYS ON PREDICTED TIME TO IMPACT, NOT ON HEIGHT, and that swap is the
     whole character of the thing. The old ceiling was the planet's relief times
     2.2 — Ember 23m, Home 114m, Anvil 228m — and because it fired the moment
     you were ABOVE the line rather than below it, any real fall opened the
     canopy at the top. From 800m you rode the entire 800m down. That is a
     glide, and it answered the question the system exists to ask before the
     fall had started.
     Seconds fix all three complaints at once. They need no per-world number,
     because a second is a second on a 207m world and on a 2072m one, and the
     six ceilings simply stop existing. They account for how fast you are
     actually falling, which the height never asked. And they put the deploy a
     couple of seconds off the deck, where it is a moment rather than a state.
     Measured, at 2.5: an 800m drop free-falls 425m before the canopy goes out,
     a 200m drop free-falls 60m, and everything from 30m up lands at about
     20 m/s — under what a fully wound hop already returns to the ground at.
     SECONDS AT THE CURRENT RATE, which is height over descent speed and is what
     the brief for this asked for. It ignores the acceleration still to come, so
     it reads LONG — the true time left at deploy is around 1.5 to 2 seconds
     across the whole range above. That is the correct direction to be wrong in
     for something whose job is to already be open when you arrive. */
  warn: 2.5,         // seconds of predicted fall left when the canopy goes out
  /* ...and the qualifier that keeps it off a hop, which time alone cannot do.
     The top of a full-charge leap is a slow descent a few metres up, and h/v
     there is comfortably under any threshold worth having — so a pure time test
     pops the canopy at the apex of every big jump.
     So it also asks whether the landing would be harder than one you chose. For
     a ballistic arc, predicted impact speed under full gravity comes out equal
     to the launch speed, so a full-charge hop reads exactly 27.2 m/s no matter
     how high it went, and one number cleanly separates "I jumped" from "I fell".
     40 is what a 30m free fall arrives at, comfortably clear of the hop, and
     below it the landing is yours to take. Global, like `warn` — a fall is a
     fall on every world, and neither term is read off the planet. */
  hardLanding: 40,   // m/s of predicted impact below which you are on your own
  minFall: 2.5,      // m/s of descent before a fall counts as one
  /* m/s the canopy settles you at, fully open.
     Not lower, and the reason is pacing rather than physics. At 11 a fall from
     300m took 24 seconds — that stops being a descent you are flying and turns
     into one you are watching, and it quietly answers the question the whole
     system exists to ask. At 20 the same fall takes 15.5s and riding it down
     against taking the jet back stays a live choice rather than a formality.
     Still a firm arrival: a hard hop lands at about this.
     The steady rate is exactly this number, so 300m is 15s of descent; the
     extra half second is the canopy filling and the fall reaching terminal,
     which no value here removes. Raising it to 21 would buy that back. */
  descent: 20,
  open: 2.4,         // how fast the canopy takes hold once it is out
  stow: 9,           // ...and how fast it collapses when it is cut
  /* Horizontal bleed under canopy. Low on purpose: the rover and the boat
     already carry their own air drag, and at 0.55 the canopy was stacking on
     top of that hard enough to erase three quarters of a 90 m/s entry inside a
     second and a half — which took the "momentum carries" out of the drop it is
     supposed to be saving. The canopy's job is the VERTICAL. */
  drag: 0.30,
};

export const SKID = {
  /* An impact is a distance, not a frame. Both numbers are the DISTANCE, in
     metres, over which carried overspeed is burned off — and it is burned
     LINEARLY in distance travelled, so the skid is that long whether you
     arrived at 20 m/s or at 60.
     Linearly, and not on an exponential, because an exponential in distance
     stalls exactly where you least want it to: as the hull slows, the metres
     stop arriving, so the last of the carry takes longer to burn than all the
     rest of it put together. A boat beaching at 66 m/s sat in its own skid for
     fifteen seconds that way. Linear burn has a real end, at a known length. */
  waterLength: 26,   // rover carrying into water
  beachLength: 17,   // boat running up a beach, a bit over two hull lengths
  minEntry: 6,       // slower than this and an entry is an arrival, not a skid
};

export const FUEL = {
  max: 100,
  start: 42,
  cellValue: 20,
  beaconValue: 45,
  drownPenalty: 12,    // cost of being fished out of a lake
};

// Colonisation. Drop a probe from the jet, it lands, and a habitat grows out of
// it on its own clock — domes inflating one at a time and linking up with
// pressure tubes. They keep growing whether you're watching or not, and a
// mature site trickles charge back to you.
export const COLONY = {
  cost: 22,            // charge to launch a probe
  minAlt: 14,          // you have to actually be flying to drop one
  dropCooldown: 1.2,
  probeGravity: 22,
  probeDrag: 0.55,
  domeEvery: 24,       // seconds between one dome finishing and the next
  growTime: 13,        // seconds a dome takes to inflate
  maxDomes: 6,
  baseRadius: 3.6,
  radiusStep: 0.55,    // later domes are bigger
  spread: 10.5,        // metres between dome centres
  tubeRadius: 0.62,
  income: 0.14,        // charge/sec from each fully inflated dome
  /* How far a neighbouring colony still counts as "nearby", as a fraction of
     the planet's radius. Per-planet by construction: a fixed metre count would
     make the whole of Ember one cluster and put Anvil's sites permanently out
     of each other's reach. */
  densityRadius: 0.11,
  // Workers. Decoration and a readout — a dense site looks busy from a ridge
  // away — and they touch nothing that produces.
  workersPerDensity: 1.1,
  maxWorkers: 9,
  viewRange: 1200,     // metres before the meshes are released again
  landSlope: 0.55,     // steeper than this and the probe tips over and is lost
};

/**
 * Gas geysers, and the economy that hangs off them.
 *
 * A coloniser on a vent makes HYPER fuel; anywhere else it makes flight fuel,
 * exactly as before. So the field below is the map's only real objective, and
 * "geysers claimed / total" is the progress metric because it is finite and
 * countable — surface coverage would be neither.
 *
 * Every world has some. That is the anti-soft-lock rule in geological form: an
 * empty hyper tank on a distant world is a detour, never a dead end.
 */
export const GEYSER = {
  count: 7,             // per world unless the profile says otherwise
  kind: 'dry',          // dry | shallow | ice | fissure — see geysers.js
  yield: 1.0,           // multiplier on hyper output from vents here
  maxHeight: 0.45,      // 'dry' vents sit below this fraction of relief
  candidates: 9000,     // Fibonacci samples the field is chosen from
  maxSlope: 0.30,       // a vent has to be somewhere you can land a probe
  minSpacing: 0.10,     // fraction of the radius between two vents
  claimRadius: 0.030,   // ...and how near a probe must land to claim one
  /* THE PLUME, and it is a landmark rather than a decoration.
     A vent is the exploration objective, so one you cannot see across a valley
     turns finding them into a grid search. These numbers are what "spottable at
     the fog boundary" costs on Home, where the fog closes at 808m: a 64m column
     subtends 4.5 degrees there, against 1.6 at the 22m it started at. The glow
     is authored above 1.0 so the bloom pass carries it the rest of the way —
     that is the same trick the beacons use, and it is what makes the plume read
     against six very different skies. */
  plumeHeight: 64,      // metres, scaled by the planet's relief
  plumePuffs: 12,
  plumeRise: 11.0,      // metres/sec
  plumeWidth: 9.0,      // how far a puff swells by the top of the column
  plumeSpread: 4.2,     // lateral drift as it rises
  plumeAlpha: 0.50,
  plumeGlow: [0.55, 1.35, 1.85],   // above 1.0: this is meant to bloom
  viewRange: 1400,      // metres before the meshes are released
};

/**
 * The colonisation economy.
 *
 * Hyper fuel is a SECOND resource: made only by colonies sitting on geysers,
 * spent only on travel between worlds. Flight charge is unchanged and still
 * comes from every colony, so the two never compete for the same tank.
 */
export const ECONOMY = {
  startHyper: 40,       // enough for one trip out of Home and back
  maxHyper: 200,
  // Production. hyperBase x density^densityPower x the vent's own yield.
  hyperBase: 0.013,     // hyper/sec per unit of density^power, on a vent
  /* THE EXPONENT, and the whole clustering mechanic.
     Note that clustering already pays at 1.0: a site's density counts its
     neighbours, so four colonies in one basin each read ~18 domes of density
     against a lone site's 6, and that ratio alone is worth 3x. The exponent is
     what turns "worth doing" into "worth planning" — measured, 1.3 makes a
     tight cluster of four about 4.4x the same four scattered. 1.7 was the first
     cut and gave 5.8x, at which point a scattered colony is not a choice, it is
     a mistake. */
  densityPower: 1.3,
  // Travel. Distance costs fuel even though it costs almost no time, which is
  // what stops hyper being a free teleport once you own one geyser.
  tripBase: 6,
  tripPerKm: 0.055,     // ~23 hyper for Home->Anvil at 536km
  saveKey: 'surveyor.economy.v1',
  /* THE AWAY WINDOW, and it is one number for both halves of what happens in
     it. Growth is credited for the time the tab was shut and so is raiding —
     crediting only the first would make closing the tab strictly better than
     playing, which is a perverse incentive and the kind that quietly teaches
     people not to play. The cap is what stops a three-day absence from being a
     massacre: at most an hour of either ever happens in one go. */
  offlineCap: 3600,     // seconds of away-time ever credited in one go
  /* The step the away window is replayed at. Not a shortcut — the model has
     nothing finer in it than the 13 seconds a dome takes to inflate, and damage
     and repair are both linear in dt, so a two-second step resolves everything
     there is to resolve and costs a few hundred thousand operations at boot
     rather than a few million. */
  offlineStep: 2,
};

/**
 * Raiders. The other half of wall time.
 *
 * They act on the `sites` record and never on a mesh, exactly as growth and
 * production already do — a world left undefended twenty minutes ago has been
 * under attack for twenty minutes. A raider's whole state is its age, its
 * target and its hit points, and its POSITION is derived from those, so a world
 * nobody is rendering costs six numbers a raider and no integration at all.
 *
 * THE LOOP THIS CLOSES: pressure is drawn to density, and density is what pays.
 * The brightest blob on the survey overlay is simultaneously your biggest
 * producer and your biggest problem, which is what turns 4a's clustering
 * decision from a free lunch into a bet.
 *
 * Deliberately tuned soft. A threat that is trivial is boring for one session;
 * a threat that makes expanding a mistake is a broken game, because the goal of
 * the whole economy is that you want to colonise. Every number here errs
 * toward the player and Dex tunes up after playing, not down.
 */
export const RAIDER = {
  // Pressure. A baseline so a lone young site is genuinely at risk, plus a term
  // in domes so a cluster draws the weather. Per second, per world.
  spawnBase: 0.0060,    // ~one every 2.8 min on a world with anything at all
  spawnPerDome: 0.0015, // ...and one every 24s at a four-site mature basin
  maxLive: 2,           // live raiders per world: this...
  maxPerDome: 0.30,     // ...plus this many per grown dome
  /* Target choice is weighted by (density + 1)^pull. Above 1 the biggest
     cluster takes most of the traffic; at 1 it is proportional and the mechanic
     is only a tax on having colonies at all. */
  densityPull: 1.6,
  grace: 45,            // seconds a fresh site is ignored for. A probe you just
                        // dropped is not an invitation
  approach: 26,         // seconds from spawn to contact, before any damage
  spawnDist: 0.9,       // where it appears, as a fraction of viewRange
  orbitDist: 26,        // ...closing to this many metres, where it attacks
  orbitRate: 0.55,      // rad/s around the site once it is there
  hover: 9,             // metres above the ground it sits at
  hp: 26,               // raider hit points
  /* THE DIFFICULTY CURVE, and it is one number. A dome is worth 22 hit points
     and arrives every 24 seconds, so anything under 0.92 means a GROWING site
     gains integrity faster than a single raider removes it — building is the
     first defence, and one attacker on a young site is a scare rather than a
     death. Two are not: a fresh site with two on it is gone about two minutes
     after landing. That is the whole curve, and it is deliberately the soft
     side of it. */
  dps: 0.85,            // damage per second to the site it reached
  // Site integrity. A dome is structure: a growing site is genuinely tougher
  // than a lander alone, which is why growth itself is the first defence.
  siteHp: 55,
  hpPerDome: 22,
  repair: 3.5,          // hp/sec back, but only while nothing is attacking
  viewRange: 900,       // metres before a raider's mesh is released
};

/**
 * Defence — three layers, and not one of them is a weapon.
 *
 * 1. The scanner beam. `survey.js` already owns scanning as a verb; this is the
 *    same verb held down. It costs charge and it requires holding the aim, so it
 *    is a surveyor's instrument used in anger rather than a gun.
 * 2. Turrets, on wall time. Past a density threshold a cluster grows its own
 *    defence and holds the ground without you. This is what makes the away game
 *    work: without it every world you leave decays and the game is a chore.
 * 3. Momentum. No ammunition and no cooldown — a rover at boost speed, a boat
 *    off a wave, a jet on a strafing line. Always available, never reloaded.
 */
export const DEFENCE = {
  // ---- the beam ----
  beamRange: 110,       // metres
  beamCone: 0.30,       // radians off the nose that counts as aimed
  beamDps: 14,          // 1.9s on a standard raider, 3.5s on Vault's armour
  beamCost: 5.0,        // charge/sec while held
  beamMinFuel: 2,       // ...and it cuts out rather than stranding you dry
  // ---- turrets ----
  /* THE THRESHOLD. Six domes is a mature site, so this lands one dome short of
     maturity: a site that finishes building defends itself, and the window in
     which you can lose one is the ~110 seconds it spends growing. Erring toward
     easy is deliberate — a lone mature colony that decays while you are away is
     exactly the chore this phase is at risk of becoming. */
  turretFrom: 5,        // domes of density before a site grows a turret
  turretDps: 0.60,      // ...at this rate, scaled by density/turretFrom
  turretRange: 140,     // metres. It defends its own ground, not the world
  // ---- momentum ----
  ramSpeed: 16,         // m/s of closing speed that kills on contact
  ramRadius: 7,         // metres
};

/**
 * The survey overlay. Hold a key and the planet goes transparent.
 *
 * This is not a convenience. Horizon distance at a 2m eye is 29m on Ember and
 * 91m on Anvil — you physically cannot see your own colonies past the curve, so
 * some instrument is mandatory, and an x-ray chart is native to a game whose art
 * direction is a topographic map you are driving around inside.
 *
 * THERE IS NO RANGE LIMIT, and adding one would be a mistake. Markers are drawn
 * at world scale, so a colony on the far side of Ember is 414m away and plainly
 * readable while the same colony on Anvil is 4.1km away and a speck. Survey
 * difficulty scales with planet radius for free, out of the geometry.
 */
export const OVERLAY = {
  blobBase: 9,          // metres of radius at zero density...
  blobPerDensity: 1.5,  // ...and this much more per dome of it
  blobMax: 46,
  ventSize: 7,          // radius of a vent marker
  ventHeight: 130,      // and the height of its column, so it reads as a plume
  raiderSize: 10,
  wireframe: true,      // terrain and water go to wireframe while it is held
  fade: 0.16,           // seconds the x-ray tint takes to come up and go down
  selectCone: 0.40,     // radians from screen centre that can be selected
  refresh: 0.18,        // seconds between system-view refreshes. It is a panel
};

export const CAM = {
  dist: { rover: 15, boat: 17, jet: 26 },
  height: { rover: 5.2, boat: 5.8, jet: 7.4 },
  fov: { rover: 0.95, boat: 0.95, jet: 1.05 },
  fovBoost: 0.22,
  posLerp: 7.5,
  aimLerp: 9,

  // ---- orientation control ----
  sensitivity: 0.0040,      // radians of orbit per pixel dragged
  pitchSensitivity: 0.0030,
  invertY: false,
  minPitch: -0.62,          // looking up at the craft from below
  maxPitch: 1.15,           // looking down on it
  orbitHold: 0.75,          // seconds the camera stays where you left it
  orbitReturn: 1.5,         // then how fast it swings back behind
  orbitLerp: 16,            // smoothing on the drag itself — kills jitter
  recenterRate: 9,          // C key snap-back speed
  zoomMin: 0.55,
  zoomMax: 2.40,
  zoomStep: 0.13,
  zoomLerp: 9,
  frameLerp: 5,             // how fast dist/height settle after a form change
  boomSamples: 6,           // terrain probes along the arm, not just its tip
  boomClearance: 2.6,
  /* METRES ABOVE THE SETTLED BOOM THAT AN ARRIVAL IS PLACED, straight up the
     local radial. See ChaseCam.arrive: the camera is written rather than
     sprung on arrival, and a bare write is a cut. This gives posLerp a few
     metres to eat, which reads as dropping into the shot — and it is ABOVE
     the boom rather than behind it on purpose, because the failure being
     fixed was arriving underground. 26m decays to a metre in about 0.43s at
     posLerp 7.5, so it is a beat and not a descent. 0 cuts straight in. */
  arriveLift: 26,
  rollTilt: { rover: 0.16, boat: 0.20, jet: 0.55 },  // camera banks with you
  // Hyper. The lens opens up with the log-scaled speed, which is what makes the
  // acceleration visible when there is nothing outside to measure it against.
  hyperFov: 0.62,           // radians added at the cap, on top of the jet's
  hyperDist: 1.9,           // ...and the boom stretches back by this much
  hyperLerp: 1.6,           // slow: the widening should be felt, not noticed
  shakeDecay: 3.4,
  shakeScale: 0.85,
};

// Post pass and everything else that sells "there is air between you and that
// mountain". Bloom replaces the old GlowLayer, which had no depth test and so
// leaked haloes straight through hillsides.
/**
 * THE POST STACK — transplanted from the lookdev testbed, T1.
 *
 * `js/render/post.js` reads this and nothing else, under the key `post`. The
 * shape is lookdev's; the numbers are Surveyor's, because the two projects are
 * lit differently and every value here was already argued about once in ATMO
 * below. What is NEW is ACES, SSAO and the LUT slot.
 *
 * WHAT THE PALETTES ARE AND ARE NOT. Six worlds ship authored, approved
 * palettes, and lookdev's golden-hour grade would break five of them at once.
 * So the LUT plumbing lands live but NEUTRAL: `identity.3dl` on all six, per
 * world, in each profile's `lut`. That proves the pipe end to end and changes
 * nothing about the colour, which is the point — grading per world is a later
 * pass, and it wants T2's lighting under it before there is anything worth
 * grading.
 *
 * lookdev's numbers came off ONE 880M iGPU at low tier. They are not portable
 * and none of them is treated as such here.
 */
export const POST = {
  enabled: true,
  hdr: true,                   // float pipeline, so bloom can threshold above 1
  /* ACES, where Surveyor had NO tonemapping at all: the old comment said "the
     palette is hand-picked; leave it", which was right when nothing else in the
     frame went above 1.0 except the emissives. It is the single biggest change
     in this transplant, and contrast is the number that had to move to pay for
     it: ACES applies its own S-curve, so the old 1.22 was being charged twice.

     EXPOSURE STAYS AT 0.97, and that was measured rather than assumed. The
     first cut raised it to 1.28 on the reasoning that ACES pulls the top end
     down and the midtones needed putting back — which is true of a scene lit in
     linear HDR and false of this one. Six palettes are authored to land just
     under 1.0, so 1.28 pushed every sky into the part of the ACES curve where
     it desaturates hardest: Ember's sunset went from saturated orange to pale
     peach, which is exactly the failure this transplant was told not to cause.
     At 0.97 the curve holds the sky gradient that used to clip instead. */
  toneMapping: 'aces',         // 'aces' | 'standard' | 'neutral' | 'none'
  exposure: 0.97,
  contrast: 1.05,

  // Antialiasing: MSAA where affordable, FXAA where not. Never both.
  fxaa: true,
  msaaSamples: 1,

  bloom: {
    enabled: true,
    /* Surveyor's own, unchanged from ATMO and not lookdev's 1.25. Terrain peaks
       land just under 1.0 and emissive parts are authored well above it, so 1.0
       is the clean dividing line between "lit object" and "bright rock". Drop
       it and the mountains start glowing.
       This is the threshold Ember's fissures were authored against two phases
       ago, for a stack that did not exist yet. */
    threshold: 1.0,
    weight: 0.45,
    kernel: 40,                // wider than this and the haloes swallow the craft
    scale: 0.5,
  },

  /* SSAO — new, and the reason it is worth having on a cel-shaded world is the
     same reason lookdev kept it: banded light makes form read, but it says
     nothing about CONTACT. Where a rock meets the ground, where a canyon wall
     meets its floor, the bands are identical on both surfaces and the join
     disappears. This is the only thing in the frame that draws it. */
  ssao: {
    enabled: true,
    // 'half-float' | 'float' | 'byte'. Never 'byte': Babylon's default 8-bit AO
    // buffer bands smooth occlusion gradients into concentric rings.
    textureType: 'half-float',
    // Measured in lookdev at 19.9ms vs 16.0ms against the prepass. Left false
    // with the numbers recorded so this does not get retried.
    forceGeometryBuffer: false,
    ssaoRatio: 0.75,
    blurRatio: 0.5,
    samples: 16,
    /* Metres, and NOT lookdev's 6.0: that was authored for a 4km flat world
       where the eye is metres above a dune. Surveyor's craft sits 5-7m up on
       worlds whose whole relief is 10m (Ember) to 104m (Anvil), and 6m of
       radius there occludes entire hillsides rather than the foot of a rock.
       2.2 is about the height of the rover, which is the scale of the contact
       this is for. */
    radius: 2.2,
    totalStrength: 1.0,
    base: 0.0,                 // 0 = AO allowed to reach black
    /* Metres; no AO past this. The old 900 was longer than half the worlds in
       this system are wide. Ember's whole fog range ends at 162m. */
    maxZ: 260,
    minZAspect: 0.2,
    epsilon: 0.04,             // depth-comparison slack; too low bands
    expensiveBlur: true,
    bilateralSamples: 12,
    bilateralSoften: 0.2,
    bilateralTolerance: 0.5,
  },

  /* The grade. `url` here is only the fallback — the world being drawn sets it
     through post.setGrade() from its own profile's `lut`, on arrival. */
  colorGrading: {
    enabled: true,
    url: 'assets/luts/identity.3dl',
    identityUrl: 'assets/luts/identity.3dl',
    level: 1.0,
  },

  vignette: {
    enabled: true,
    weight: 1.10,
    stretch: 0.4,
    // Surveyor's, not lookdev's black: a very slightly blue corner sits with
    // the fog instead of punching a hole in it.
    colour: [0.02, 0.05, 0.07, 0],
    blend: 'multiply',
    // Pinned. Babylon otherwise computes this from the camera, and Surveyor's
    // FOV changes per craft and again all the way up the hyper ramp.
    cameraFov: 1.0,
  },

  /* Grain is load-bearing, not taste: it dithers dark gradients and is what
     stops the fog and the sky banding. lookdev settled at 5 after its re-grade.
     Surveyor's own was 2.4 against an untonemapped frame; ACES compresses the
     top end and spreads the darks over more codes, which is exactly the
     condition that needs more dither, so it meets lookdev at 5.0. */
  grain: {
    enabled: true,
    intensity: 5.0,
    animated: true,
  },

  // No depth of field. It fights a game where you look at terrain at all
  // distances — lookdev's reason, and it holds here for the same reason.
  depthOfField: false,

  viewer: {
    exposureMin: 0.35,
    exposureMax: 3.0,
    exposureStep: 0.05,
  },
};

export const ATMO = {
  /* Bloom, exposure, contrast, vignette, grain and fxaa MOVED to POST above in
     T1 — they are the post stack's, and the post stack is now one transplanted
     file that reads one block. What is left here is the atmosphere the SHADERS
     read, plus the hyper FX, which main.js drives against the pipeline frame by
     frame and which are Surveyor's alone. */
  bloom: true,              // still the master switch: false builds no pipeline
  horizonHaze: 0.78,        // how hard the sky sits down into the fog
  sunScatter: 0.85,         // warm fog when you're looking into the sun
  distanceWash: 0.18,       // how much saturation range takes out
  terrainDetail: 1.0,       // grain, strata and gravel on the ground. 0 = the
                            // old flat cel look, 1.5 = gritty
  motes: true,
  /* Hyper FX. All of these are driven by craft.hyperT — one log-scaled number
     that rises and falls symmetrically because the speed law does — so nothing
     here needs its own ramp, and nothing can be left switched on at arrival. */
  hyperAberration: 34,      // chromatic split at the cap. Radial, so it is an
  hyperAberrationRadial: 22,//   edge effect and the centre stays readable
  // Halved on review: at 5.2/2.4 the corners closed in hard enough on a small
  // window to read as a fault rather than as speed.
  hyperGrain: 2.6,          // film grain climbs with it
  hyperVignette: 1.2,       // and the corners close in
  streaks: true,            // velocity lines. False strips them entirely
  streakCount: 220,         // one draw call regardless
  streakBox: 260,           // metres of the box they live in around the camera
  streakLen: 0.55,          // length as a fraction of the box, at the cap
  streakFrom: 0.16,         // hyperT below which nothing is drawn at all
};

export const SOUND = {
  master: 0.62,
  music: 0.50,
  sfx: 0.68,
  bpm: 124,
  root: 55,                 // A1, in Hz. Everything is written in A minor.
  reverb: 0.22,
  duck: 0.42,               // how far the music ducks under each kick
  // Per-vehicle engine trim. Reach for these first if something is sitting too
  // loud in the mix — they scale that engine's whole layer stack.
  engineRover: 0.40,
  engineBoat: 0.40,
  engineJet: 0.90,
  ambience: 0.75,           // wind and water lapping
};

export const COLORS = {
  // instrument palette — phosphor teal on wet slate, bone highlights
  fog:       [0.541, 0.639, 0.663],
  fogSun:    [0.788, 0.796, 0.714],
  skyLow:    [0.694, 0.769, 0.769],
  skyHigh:   [0.114, 0.235, 0.298],
  deep:      [0.043, 0.129, 0.176],
  shallow:   [0.090, 0.400, 0.435],
  silt:      [0.153, 0.278, 0.298],
  shore:     [0.784, 0.784, 0.706],
  flats:     [0.259, 0.361, 0.325],
  stone:     [0.400, 0.427, 0.443],
  peak:      [0.867, 0.886, 0.855],
  coast:     [0.949, 0.965, 0.902],
  contour:   [0.055, 0.106, 0.125],
  phosphor:  [0.169, 0.878, 0.784],
  beacon:    [1.000, 0.373, 0.635],
  // Where the light ISN'T. The shade tint multiplies the unlit bands and the
  // rim colour separates a silhouette from the fog — both were hardcoded in the
  // shaders, and both turn out to carry as much world identity as the bands do.
  shade:     [0.720, 0.860, 1.000],
  rim:       [0.100, 0.240, 0.260],
  spec:      0.0,      // hard toon highlight on ground and hull. Vault only
  emit:      [1.000, 0.360, 0.070],
  emitHot:   [1.000, 0.900, 0.720],
};

/**
 * Rock geometry per world, because colour alone makes six recolours.
 *
 * `forms` are the relative weights of boulder / slab / spire, and the rest are
 * shape multipliers on top of the relief-derived size caps in scatter.js — so a
 * profile stays proportionate on any radius. A world that says nothing gets
 * Home's field.
 */
export const SCATTER = {
  density: 1.0,        // multiplier on how many rocks are attempted per leaf
  forms: [0.58, 0.17, 0.25],
  scale: 1.0,          // overall size, against the per-planet cap
  tall: 1.0,           // spire height and slab height
  thin: 1.0,           // spire radius and slab depth. >1 is stubby, <1 is needle
  taper: 0.62,         // spire profile exponent. 0.95 is a near-linear cone
  sides: 6,            // spire facet count
  tilt: 0.34,          // how far slabs lean
};
