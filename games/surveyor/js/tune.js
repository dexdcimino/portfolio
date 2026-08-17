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
  sunSize: 1.0,
  glare: 1.0,            // how hard the disc and its halo push past 1.0
  // The particle layer. `null` keeps the system's near-field motes; a block
  // replaces their colour, rate and fall direction.
  motes: null,
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

export const PLANETS = {
  home: {
    key: 'home',
    name: 'Home',
    radius: 1036,
    seed: 'surveyor-home',
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
export const ATMO = {
  bloom: true,
  // Terrain peaks land just under 1.0 and emissive parts are authored well
  // above it, so the threshold is the clean dividing line between "lit object"
  // and "bright rock". Drop it and the mountains start glowing.
  bloomThreshold: 1.0,
  bloomWeight: 0.45,
  bloomKernel: 40,          // wider than this and the haloes swallow the craft
  bloomScale: 0.5,
  fxaa: true,
  contrast: 1.22,
  exposure: 0.97,
  vignette: 1.10,
  grain: 2.4,               // 0 to switch the film grain off
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
