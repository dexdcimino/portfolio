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
  viewRange: 1200,     // metres before the meshes are released again
  landSlope: 0.55,     // steeper than this and the probe tips over and is lost
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
};
