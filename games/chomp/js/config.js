// config.js — EVERY tunable lives here. Single source of truth; no magic numbers
// anywhere else, ever. Values reference GDD.md sections. Rename the game = change
// GAME_NAME (+ folder name), nothing else.

export const GAME_NAME = 'CHOMP!';

export const CONFIG = {
  // ── Main loop ─────────────────────────────────────────────────────────────
  loop: {
    dtMax: 0.1, // clamp delta time (the tab-switch lesson, TECH.md perf)
  },

  // ── Player movement (GDD "Controls", speeds are stage-1 baseline) ─────────
  player: {
    maxSpeed: 6,      // units/s at full input
    accel: 30,        // units/s² toward input dir
    friction: 8,      // 1/s velocity damping with no input
    hoverHeight: 0.6, // units above floor (it hovers — ART_BIBLE origin note)
    startMass: 5,     // spawn mass (stage 1; mass is fixed until MD-05 eating)
    stageSpeedMult: [1, 1.25, 1.55, 1.95, 2.4], // tracks camera zoom-out — same PERCEIVED speed at every stage
  },

  // ── Squeeze (soft body!): ooze through gaps smaller than you ──────────────
  // Hysteresis design: engages ONLY when hard-blocked and a min-radius probe
  // proves the opening is a gap (not a flat wall); relaxes only once the full
  // body has clearance again. Never triggers on ordinary wall slides.
  squeeze: {
    minMult: 0.5,       // effective radius shrinks to radius × this at full squeeze
    minSpeedMult: 0.45, // speed multiplier at full squeeze
    visualNarrow: 0.35, // pose: sides pull in by squeeze × this
    visualTall: 0.4,    // pose: body rises by squeeze × this
    smooth: 6,          // 1/s — squeeze factor easing
    unstickSpeed: 4,    // units/s escape push when grown into walls
  },

  // ── Post FX — REVERTED to off (glow+bloom hazed the whole frame).
  // Opt-in with ?fx=1 for tuning experiments; ?nofx=1 always wins.
  postfx: {
    enabled: false,
    glowIntensity: 0.65,
    bloomThreshold: 0.6,
    bloomWeight: 0.3,
    bloomKernel: 48,
    bloomScale: 0.5,
    fxaa: true,
    exposure: 1.15,
    contrast: 1.2,
    vignetteWeight: 1.8,
    lightFlicker: 0.08, // player-light torch flicker (independent of the pipeline)
  },

  // ── Mass → radius (GDD: radius = f(mass), sqrt curve) ─────────────────────
  massRadius: {
    base: 0.35, // radius at mass 0 (wisp)
    k: 0.088,   // calibrated so mass 350 ≈ maw radius 2.0; refine in MD-05
  },

  // ── Morph feel (TECH §Morph, MD-04 §2) ────────────────────────────────────
  morph: {
    stretchIn: 0.12,    // s — critically-damped spring rise toward stretch
    stretchOut: 0.25,   // s — spring release
    mouthIn: 0.035,     // s — mouth SNAPS open (exaggerated chomp)
    mouthOut: 0.12,     // s — closes quick but softer
    bonkPulseSec: 0.3,  // squash pulse 1→peak→1 duration on wall bonk
    bonkSquashAmp: 1.2, // pulse peak (≈ pancake at applyGenericPose mapping)
    breatheAmp: 0.04,   // idle breathing: 1 + amp·sin(ω t)
    breatheOmega: 2.2,  // rad/s
    bobAmp: 0.15,       // hover bob (visual only, never position)
    bobOmega: 1.7,      // rad/s
    bankScale: 0.35,    // bank target = angularVel × this
    bankMax: 0.5,       // radians — lean cap
    bankSmooth: 0.1,    // s — bank spring
    gulpSec: 0.25,      // auto-eat gulp: quick full mouth pulse duration
    gulpSquash: 0.4,    // squash pulse amplitude during the gulp
  },

  // ── Sprint (Shift) — short burst; duration extendable via food later ──────
  sprint: {
    speedMult: 1.65,   // maxSpeed × this while sprinting
    drainSec: 1.4,     // full stamina drains in this many seconds
    regenSec: 2.2,     // empty → full recharge time
    regenDelaySec: 0.7, // pause after sprinting before regen starts
  },

  // ── Hunger (GDD: mass drains slowly → forward pressure) ───────────────────
  hunger: {
    rate: 0.4, // mass/s drained; never below stage floor at Stage 1
  },

  // ── Passive eating (GDD "Eating rules") ───────────────────────────────────
  mouth: {
    coneRadiusMult: 1.2, // mouth cone radius = 1.2× body radius, front hemisphere
  },

  // ── CHOMP (GDD "Eating rules") ────────────────────────────────────────────
  chomp: {
    duration: 0.35,     // s — lunge length
    speedMult: 2.6,     // lunge speed multiplier
    eatRadiusMult: 1.8, // eat radius multiplier while chomping
    cooldown: 0.9,      // s between chomps
    wallBonkStun: 0.3,  // s stun after chomping into a wall
  },

  // ── Combat (GDD "Eating rules": contact with bigger thing) ────────────────
  combat: {
    maxHpByStage: [1, 1, 2, 2, 3], // hits to kill per stage — spike plants etc.
    hpRegenDelaySec: 6,   // no damage for this long ⇒ regen starts
    hpRegenIntervalSec: 4, // +1 hp per interval while regenerating
    iFramesSec: 0.8,  // invulnerability after taking damage
    hitstopSec: 0.04, // 40ms hitstop on chomp (GDD juice checklist)
  },

  // ── Combos (GDD: eats within 2.0s chain, ×5 = bonus burst) ────────────────
  combo: {
    windowSec: 2.0, // max gap between eats to keep the chain
    burstAt: 5,     // chain length that triggers bonus mass burst + fur poof
  },

  // ── Evolution (GDD "Mass, growth, evolution"; thresholds in data/stages.js)
  evolve: {
    flashSec: 0.6,           // hitstop-flash on evolving
    deEvolveHysteresis: 0.15, // drop 15% under threshold to de-evolve
  },

  // ── Camera (GDD "Camera") ─────────────────────────────────────────────────
  camera: {
    pitchDeg: 58,                       // tilted top-down
    posLerp: 6,                         // 1/s — exponential follow rate (MD-04)
    lookAhead: 2,                       // units ahead in movement dir
    lookAheadLerp: 4,                   // 1/s — look-ahead point smoothing
    camDistByStage: [5.5, 7, 9, 12, 15], // per stage 1–5 (MD-04b retune: s1 ≈1/14 screen height, s5 ≈1/6)
    zoomSmoothSec: 1.0,                 // smooth time for per-stage zoom change
    fovPunchScale: 0.9,                 // FOV ×0.9 → 1.0 on chomp…
    fovPunchSec: 0.1,                   // …over 100ms
  },

  // ── Camera occlusion (MD-04b: player never hidden behind walls) ───────────
  occlusion: {
    fadeAlpha: 0.25,  // occluding chunk walls fade to this alpha
    fadeInSec: 0.15,  // fade down time
    fadeOutSec: 0.25, // restore time
    sampleStep: 0.4,  // units between segment samples (cell grid walk)
  },

  // ── World / chunks (TECH.md "World gen") ──────────────────────────────────
  world: {
    chunkSize: 32,    // cells per chunk side
    cellSize: 1,      // 1 cell = 1 unit
    loadRadius: 2,    // chunks kept generated around player
    disposeRadius: 3, // chunks disposed beyond this (loadRadius + 1)
    wallHeight: 3,    // units, dark ceiling implied by vignette

    // Triangulated floor terrain: noise-displaced heights, seamless across
    // chunks. Heights live in [-amp, 0] so nothing pokes above the walk plane
    // (entities hover at y=0; the ground rolls away beneath them).
    floor: {
      amp: 2.6,        // DRASTIC height span — real climbs and descents
      bias: 0.5,       // heights = (noise − bias) × amp ⇒ [−1.3, +1.3]
      lattice: 9,      // broader hills so slopes stay gentle
      contrast: 1.9,   // stretches the noise curve — pushes heights to the extremes
      latticeB: 4.5,   // octave 2 spacing — broad, no local chop
      weightB: 0.15,   // octave 2 contribution (small — hills stay smooth)
      subdivisions: 16, // ground grid per chunk (17×17 verts)
      shadeDepth: 0.35, // vertex shade per unit of elevation (span is big now)
    },

    // Rivers: winding channels from an iso-band of large-scale noise. They
    // depress the terrain into valleys; water sits at `level`. Water NEVER
    // blocks passage — everything wades through at slowMult speed.
    water: {
      lattice: 26,    // river noise scale — bigger = broader meanders
      width: 0.045,   // iso-band half-width (noise units) — river breadth
      depth: 0.8,     // extra terrain depression at the centreline
      levelBelow: 0.18, // water surface sits this far below the local bank line
      gameplayBand: 0.3, // riverAt ≥ this counts as water (wading slow)
      slowMult: 0.55,    // speed multiplier while wading
    },

    // Hex walls: per-cell 6-sided prisms with varied height/width/rotation
    hexWall: {
      heightMin: 1.6,   // stumpy…
      heightMax: 5.5,   // …to towering — DRASTIC variance
      diaMin: 0.95,     // × cell — skinny columns…
      diaMax: 1.7,      // …to fat ones
    },

    // Cave carve (world/carve.js — MD-02)
    carve: {
      latticeA: 8,          // value-noise octave 1 lattice spacing (units)
      latticeB: 4,          // octave 2 lattice spacing
      octaveBWeight: 0.35,  // octave 2 contribution (octave 1 gets the rest)
      wormRadius: 1,        // tunnel half-width in cells near origin (~3 wide)
      wormWidenPer: 90,     // +1 tunnel radius per this many units from origin
      wormRadiusMax: 3,     // caps at ~7-wide tunnels deep out (stage 4/5 room)
      wormJitter: 0.35,     // chance per step a worm wanders sideways
      edgeMargin: 4,        // edge openings stay this many cells from corners
      centerJitter: 6,      // worm hub offset from chunk centre, ± cells
      originClearRadius: 5, // cells forced open around world (0,0)
    },
  },

  // ── Fog / darkness (GDD: biome sets fog color; real light radius MD-06) ───
  fog: {
    lerpRate: 2, // 1/s — how fast fog color/density chases the probe's biome
  },

  // ── Visual pose mapping (MD-03: sprite skew + generic proc/GLB root pose) ─
  visuals: {
    stretchGrow: 0.35,      // stretch → scale along motion ×(1 + s·this)
    stretchShrink: 0.2,     // stretch → shrink other axes ×(1 − s·this)
    squashFlatten: 0.35,    // squash → flatten vertical ×(1 − s·this)
    squashWiden: 0.2,       // squash → widen horizontal ×(1 + s·this)
    eatMouthThreshold: 0.5, // mouthOpen ≥ this + anims.eat ⇒ play eat range
    spriteSize: 1,          // default billboard world size (units)
    jawOpenAngle: 1.25,     // radians (≈72°) — past ~90° the jaw swings INTO the body
    jawDropMult: 0.18,      // jaw pivot drops this ×radius at full open…
    jawJutMult: 0.45,       // …and juts forward this ×radius — scoop, not backflip
    skullTilt: 1.0,         // radians (≈57°) — head rears back hard on chomp
    headSwell: 0.45,        // head group scales ×(1 + this) at full mouthOpen
    chompBodyPitch: 0.5,    // whole body tips back so the gape faces the camera
    throatSwell: 0.15,      // throat stays INSIDE the mouth — subtle swell only
    shadowAlpha: 0.35,      // blob shadow disc opacity
    shadowRadiusMult: 1.1,  // shadow radius = entity radius × this
  },

  // ── Eating / growth (GDD "Eating rules" + "Mass, growth, evolution") ──────
  eat: {
    activeRadius: 40,        // foods/enemies mount visuals within this range
    deactivateSlack: 6,      // unmount beyond activeRadius + this (hysteresis)
    mouthProximityMult: 2.5, // mouth starts opening within radius × this, front
    minEatSpeed: 0.5,        // passive eat requires moving (or chomping)
    deathMass: 1.5,          // stage-1 mass at/below this = eaten alive → dead
  },

  // ── Death cinematics (two flavours; world runs slow-mo during either) ─────
  death: {
    slowmo: 0.45,   // world time scale while dying (GDD: slow-mo on death)
    eatenSec: 1.6,  // pulled into the killer's mouth, shrinking away
    eatenPull: 5,   // 1/s — how hard the mouth drags you in
    poppedSec: 1.5, // burst → deflate → slime puddle
    popSwell: 0.5,  // quick inflate before the burst, ×(1 + this)
    puddleMult: 3.0, // final puddle radius = player radius × this — one BIG pool
    debris: {
      large: 2,    // big slime balls
      medium: 5,
      small: 10,
      gravity: 14, // units/s²
      speedMin: 2.5,
      speedMax: 8,
      upMin: 2.5,
      upMax: 6,
    },
  },

  // ── Spawning (world/spawner.js) ───────────────────────────────────────────
  spawn: {
    glowClustersPerChunk: [2, 4], // min/max clusters
    clusterSize: [3, 6],          // motes per cluster
    premiumChance: 0.5,           // chance of one premium food per chunk
    urchinsPerChunk: [0, 2],
    nibblersPerChunk: [1, 3],     // small gnats, everywhere past the clearing
    voidShardRange: 80,           // voidShards only spawn beyond this distance
    voidShardsPerChunk: [0, 2],
    lancerRange: 50,              // charging bone darts beyond this distance
    lancersPerChunk: [0, 2],
    gulperRange: 100,             // rival mawlings prowl beyond this distance
    gulpersPerChunk: [0, 1],
    safeRadius: 30,               // predators never spawn this close to origin
    maxActiveEnemies: 18, // nibbler swarms were starving predators of mount slots
  },

  // ── Lighting (GDD: your light radius grows with stage) ────────────────────
  light: {
    hemiIntensity: 0.22,                  // dim ambient — the cave is DARK
    playerIntensity: 1.15,
    playerColor: '#FFE2B8',               // warm lantern glow
    playerRangeByStage: [11, 13, 16, 20, 26],
    playerHeight: 3,                      // light bobs above the mawling
  },

  // ── Environment decor (chunks: variety, plants, rocks) ────────────────────
  decor: {
    rocksPerChunk: [3, 7],          // clustered squashed boulders
    mushroomClustersPerChunk: [2, 5], // 1–3 mushrooms per cluster, glow caps
    grassTuftsPerChunk: [45, 70],   // a LOT of grass — 5–8 fat blades per tuft
    crystalSpotsPerChunk: [0, 2],   // glowing shards; rarer in Fungal
    wallShadeJitter: 0.3,           // per-run wall color variance (±half)
    wallHeightJitter: 0.3,          // per-run wall box height variance
  },

  // ── Debug-only tunables (?debug=1) ────────────────────────────────────────
  debug: {
    probeSpeed: 24,    // units/s — WASD probe movement (MD-02 stand-in for player)
    freeCamSpeed: 1.2, // Babylon FreeCamera speed for the fly cam
    lineupSpacing: 2,  // units between mounts in the [L] visual lineup
    scatterCount: 500, // thin-instanced motes in the [G] perf scatter
    scatterRadius: 30, // scatter spread around origin (units)
    slowmo: 0.25,      // [T] slow-motion time scale
  },

  // ── Colors used by boot code (full palette in ART_BIBLE / data/biomes.js) ─
  colors: {
    background: '#0A0E14', // cave near-black blue
  },
};

// Radius from mass, sqrt curve (GDD "Mass, growth, evolution").
export function radiusForMass(mass) {
  return CONFIG.massRadius.base + CONFIG.massRadius.k * Math.sqrt(Math.max(0, mass));
}
