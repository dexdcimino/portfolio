// Boot and the single fused loop. Single-player, so there is deliberately no
// sim/render split here — logic touches meshes directly and that is correct
// for this game.

import { createMaterials } from './world/materials.js';
import { Worlds } from './world/world.js';
import { buildRover, buildBoat, buildJet } from './player/meshes.js';
import { Craft } from './player/craft.js';
import { ChaseCam } from './player/camera.js';
import { Trails } from './fx/trails.js';
import { Streaks } from './fx/streaks.js';
import { Hud } from './game/hud.js';
import { Overlay } from './game/overlay.js';
import { Economy } from './game/economy.js';
import { geysersOf } from './world/geysers.js';
import { Sound } from './audio/index.js';
import { on, emit } from './core/events.js';
import { makePlanet } from './world/sphere.js';
import { Surface, findSpawn } from './world/surface.js';
import { neighbours } from './world/discs.js';
import { systemExtent } from './world/space.js';
import { previews } from './world/preview.js';
import { COLORS, ATMO, POST, ROVER, PLANETS, HYPER, DEBUG, ECONOMY } from './tune.js';
import { createPostStack } from './render/post.js';

const canvas = document.getElementById('stage');
const engine = new BABYLON.Engine(canvas, true, {
  preserveDrawingBuffer: false,
  stencil: false,
  antialias: true,
  powerPreference: 'high-performance',
}, true);
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));

const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(COLORS.fog[0], COLORS.fog[1], COLORS.fog[2], 1);
scene.autoClear = true;
scene.fogEnabled = false;
scene.skipPointerMovePicking = true;

/* Which world boots. ?planet=<key> survives from the phase-3a dev warp — the
   KEY is gone now that you can fly there, but the boot parameter stays: it is
   how dev/shots.mjs photographs a world without a twenty-minute flight, and it
   costs one line. Anything unrecognised falls back to home rather than
   crashing, so a stale bookmark or a typo lands you somewhere real. */
const wantPlanet = new URLSearchParams(location.search).get('planet');
const bootKey = PLANETS[wantPlanet] ? wantPlanet : 'home';
const planets = new Map();
const planetOf = (key) => {
  if (!planets.has(key)) planets.set(key, makePlanet(PLANETS[key]));
  return planets.get(key);
};

/* Where a world opens, when nothing flew you there.
   Dry, reasonably flat ground is the whole of what findSpawn used to ask for,
   and it left Vault opening on an empty sky — every spawn landed in the same
   polar cap and Vault is the top of the system, so all five neighbours were
   underfoot. Handing it the neighbour directions makes it pick the point in
   that same height band with the most of them up. The worlds have not moved;
   only which way you are standing when you arrive has.

   This is for the boot spawn and the dev warp ONLY. A real hyper arrival keeps
   the direction it actually came down on, which already faces the world you
   left — the trajectory does this honestly and does not need helping. */
const spawnFacing = (p) =>
  findSpawn(p, p.relief * 0.12, p.relief * 0.75, neighbours(p).map((n) => n.dir));

/* The world previews, baked before anything asks for one.
   Six equirectangular maps of the actual height field, one per planet, so the
   discs in the sky show the places rather than six tinted coins. It is a
   one-off CPU cost paid here — in front of the start card, where there is
   nothing to stall — rather than inside the first world build, where it would
   read as a slow boot with no explanation. See preview.js. */
const previewBake = previews(scene);

const planet = planetOf(bootKey);
const surface = new Surface(planet, spawnFacing(planet));

/* The craft's meshes outlive any one world: they are built against the boot
   world's craft material and re-pointed at the next one on arrival, in
   swapTo(). The material is made here rather than inside World because the
   ordering is forced — meshes need a material, a Craft needs meshes, and the
   World's survey and colonies need a Craft. */
const bootMats = createMaterials(scene, planet);
const forms = {
  rover: buildRover(scene, bootMats.craft),
  boat: buildBoat(scene, bootMats.craft),
  jet: buildJet(scene, bootMats.craft),
};

const craft = new Craft(forms, surface);
/* ...and put it on the ground. The Craft constructor starts it at y = 0, which
   is sea level and not the surface — and every spawn is chosen from a band that
   starts at relief * 0.12 ABOVE sea level, so y = 0 is underground on all six.
   See Craft.settle for why this only became visible when the spawn search
   started choosing by sky rather than by order. */
craft.settle();
const economy = new Economy();
craft.economy = economy;
const worlds = new Worlds(scene, craft);
let world = worlds.enter(planet, null, bootMats);

/* Every world's colonies are registered with the Economy as they are built,
   whether or not they are the one being drawn — that is what makes production
   run on wall time everywhere instead of only where you are standing. */
const registerWorld = (w) => economy.register(w.planet.key, w.colonies);
registerWorld(world);

// Geyser totals, for the progress readout. Fixed per planet, so counted once.
const geyserTotals = {};
for (const key of Object.keys(PLANETS)) {
  geyserTotals[key] = geysersOf(planetOf(key)).length;
}

/* Pick up where the last session left off. Only the record is saved — sites,
   ages, claims and the balance — and the layouts regenerate from their seeds,
   exactly as they do when you drive back into range.

   The time the tab was shut is REPLAYED rather than credited: sites come back
   at the age they were saved at, and then every world runs the away window
   through its ordinary tick, so colonies grow through it and raiders attack
   through it. Crediting only the growth would make closing the tab strictly
   better than playing. The window is capped — an absence of three days costs
   the same hour as an absence of one. */
let awayReport = null;
{
  const saved = economy.load();
  if (saved) {
    economy.hyper = saved.hyper;
    const missed = [];
    for (const [key, data] of Object.entries(saved.worlds || {})) {
      if (!PLANETS[key]) continue;
      const w = worlds.get(planetOf(key));
      registerWorld(w);
      w.colonies.clock = data.clock || 0;
      for (const rec of data.sites || []) w.colonies.restore(rec, 0);
      const report = w.colonies.catchUp(saved.away);
      if (report) missed.push(report);
    }
    /* Held, not fired. This runs before the HUD exists and before anyone has
       pressed Begin — a toast here is one nobody is in the room for. It goes
       out when the session actually starts. */
    if (missed.length) {
      awayReport = {
        seconds: saved.away,
        lost: missed.reduce((a, m) => a + m.lost, 0),
        held: missed.reduce((a, m) => a + m.held, 0),
        raiders: missed.reduce((a, m) => a + m.raiders, 0),
        worlds: missed.filter((m) => m.lost > 0).map((m) => m.world),
      };
    }
  }
}
setInterval(() => economy.save(), 20000);
window.addEventListener('pagehide', () => economy.save());

const cam = new ChaseCam(scene, canvas, planet);
const trails = new Trails(scene, craft, forms);
const streaks = new Streaks(scene);
streaks.setPalette(planet);
const hud = new Hud(craft, world.survey, world.field, world.colonies);
const sound = new Sound();
hud.attachEconomy(economy, geyserTotals, Object.keys(PLANETS));

/* The survey overlay owns its own render pass and its own panel, so it is built
   beside the HUD rather than inside it: one is what is always true, the other is
   what you asked to see. */
const overlay = new Overlay(scene, craft);
overlay.attach(economy, geyserTotals, Object.keys(PLANETS));
overlay.retarget(world);

/**
 * Arrive somewhere. Hyper hands over the world it reached and the direction it
 * reached it from; everything the scene holds for a planet is swapped here, in
 * one frame, and the craft is stood up in flight over the new ground.
 */
function swapTo(key, dir, alt) {
  const next = planetOf(key);
  world = worlds.enter(next, dir);
  registerWorld(world);
  const surf = new Surface(next, dir);
  craft.landOn(surf, alt);
  // The hull takes the new world's light: the craft shader carries that
  // planet's rim, specular and sun colour, and a craft still lit by the world
  // it left is the one thing that would give the swap away.
  for (const form of Object.values(forms)) {
    for (const m of form.root.getChildMeshes()) m.material = world.mats.craft;
  }
  cam.setPlanet(next);
  /* ...and PUT the camera down on it. Without this the chase spring runs
     from wherever it was on the world you left, which on a sphere of another
     radius is inside this one: the arrival came up through the terrain. */
  cam.arrive(craft);
  streaks.setPalette(next);
  /* ...and the particulate layer, which is this world's ash or murk or sea
     spray. Trails read its planet once in its constructor and nothing ever
     wrote it again, so every world's motes were the boot world's. */
  trails.setPlanet(next);
  /* ...and throw away the wingtip ribbon, because landOn just moved the craft
     across the solar system and a TrailMesh draws every metre of that. */
  trails.resetJetTrails();
  // The world's own grade. Neutral on all six at T1, so this is a no-op that
  // proves the wire — and the one line that has to exist before any world can
  // be graded on its own.
  if (post) post.setGrade(next.lut, POST.colorGrading.level);
  hud.retarget(world.survey, world.field, world.colonies);
  overlay.retarget(world);
  economy.save();
  hud.setWorld(key);
  scene.clearColor = new BABYLON.Color4(
    world.mats.fogColor.r, world.mats.fogColor.g, world.mats.fogColor.b, 1);
}

on('hyperarrive', (e) => swapTo(e.key, e.dir, e.alt));

/* TEMPORARY TESTING SCAFFOLDING — what the HUD's warp row calls.
   It is the arrival, and nothing but the arrival: same swapTo, same spawn
   search the boot path uses, same approach altitude hyper hands over. What it
   skips is the journey — the climb, the lock-on, the fuel — so this proves a
   world builds and looks right and proves nothing whatever about travel.
   Gated here as well as in the HUD: the panel is what you can see, this is
   what could be called. */
function devWarp(key) {
  if (!DEBUG.warp || !PLANETS[key] || key === world.planet.key) return;
  const next = planetOf(key);
  swapTo(key, spawnFacing(next), HYPER.approachAlt);
  /* ...and then stand it on the ground, which is the one place this row now
     deliberately differs from the arrival it otherwise mirrors.
     HYPER.approachAlt is 900 METRES, absolute, on worlds whose radii run from
     207m to 2072m — so a warp to Ember dropped you 4.35 planet radii up, with
     the whole world a marble 22 degrees wide below you. That is a fine place to
     begin a descent and a useless place to be put by a button whose entire
     purpose is looking at six worlds in a minute.
     A real hyper arrival is untouched: it keeps the approach altitude, the
     autopilot and the descent, because arriving in flight is the designed
     behaviour there and the number it uses is also the boundary the whole
     travel model is built on. */
  craft.setMode('rover', true);
  craft.settle();
  // settle() moved the craft after swapTo placed the camera against where it
  // was, so the boom is rebuilt against where it actually ended up.
  cam.arrive(craft);
}
hud.attachWarp(Object.keys(PLANETS), world.planet.key, devWarp);

/* THE CRAFT IS NOT A SHADOW-MAP CASTER, deliberately.
   It was, and its map shadow was the worst thing in the frame: a 3m object in
   a 400m box is a handful of texels, and what came out was a streak many
   vehicle lengths long that no bias or filter setting improved, because the
   problem is resolution and not depth. The craft is also the one object always
   on screen, so it is the one that can least afford to be approximate.
   Its shadow is the contact shadow instead — down-projected, footprint-shaped,
   never elongated, and identical on every world including the one with no cast
   shadows at all. That is standard practice for a hero object and it is why
   removing this was a deletion rather than a new system. */

// ---- post ----------------------------------------------------------------
/* Bloom replaced a GlowLayer here two phases ago, for a reason that still
   holds: a glow layer renders its emissive meshes into a separate buffer with
   no depth information, so haloes came through hillsides. Bloom works on the
   finished frame instead — if a hill is in front of a beacon, the beacon isn't
   in the frame, so it can't bloom. Everything that should glow is authored
   above 1.0 in an HDR buffer.

   T1 replaced the hand-rolled pipeline with the transplanted stack from the
   lookdev testbed. What that buys, beyond the same bloom: ACES tonemapping,
   SSAO, and a colour-grading LUT per world. Every number lives in POST.

   `post.pipeline` is Babylon's own DefaultRenderingPipeline, the same object
   this file used to build itself, which is why the hyper FX below needed no
   change at all — they drive chromatic aberration, grain and vignette straight
   onto it, and none of that is the stack's business. */
const post = ATMO.bloom ? createPostStack(scene, cam.camera, { post: POST }) : null;
const pipeline = post ? post.pipeline : null;

/**
 * The post chain under speed.
 *
 * Chromatic split is squared so it stays an effect of the EXTREMES — at half
 * the log-scale it is barely a quarter of its full value, which keeps the
 * instruments readable through most of a trip and only tears the edges apart
 * when the readout has run out of digits. Grain and vignette ride along.
 *
 * Everything is a plain function of hyperT, so there is no state to leave
 * switched on: the number returns to zero on arrival and so does the frame.
 */
if (post) post.setGrade(planet.lut, POST.colorGrading.level);

let hyperWas = -1;
function hyperPost(t) {
  if (!pipeline || t === hyperWas) return;
  hyperWas = t;
  const sq = t * t;
  if (t > 0.001) {
    pipeline.chromaticAberrationEnabled = true;
    pipeline.chromaticAberration.aberrationAmount = ATMO.hyperAberration * sq;
    pipeline.chromaticAberration.radialIntensity = ATMO.hyperAberrationRadial * sq;
  } else if (pipeline.chromaticAberrationEnabled) {
    pipeline.chromaticAberrationEnabled = false;
  }
  if (POST.grain.enabled) {
    pipeline.grain.intensity = POST.grain.intensity + ATMO.hyperGrain * sq;
  }
  pipeline.imageProcessing.vignetteWeight = POST.vignette.weight + ATMO.hyperVignette * sq;
}

// Warm the terrain around the spawn point before the first frame is shown.
// The tree is bounded now, so this genuinely finishes rather than chasing an
// unbounded stream.
world.warm(surface.frame.up);

// ---- feel ----------------------------------------------------------------
// Impacts move the camera, not the vehicle.
on('crash', () => cam.addShake(0.85));
on('landed', () => cam.addShake(0.30));
on('thump', (e) => cam.addShake(Math.min(0.45, 0.05 + e.impact * 0.014)));
on('transform', () => cam.addShake(0.16));
on('drown', () => { cam.addShake(0.55); cam.recenter(); });
for (const e of ['colony', 'colonygrow']) on(e, () => cam.addShake(0.10));

// ---- input --------------------------------------------------------------

const keys = new Set();
const HELD = new Set(['Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);
let pendingMode = null;
let pendingHopPress = false;
let started = false;

window.addEventListener('keydown', (e) => {
  if (HELD.has(e.code)) e.preventDefault();
  if (e.repeat) return;                 // hop is an edge, not a hold
  keys.add(e.code);
  if (!started) return;
  if (e.code === 'Escape') { setPaused(!paused); return; }
  if (paused) return;                     // the menu owns the keyboard while up
  if (e.code === 'Digit1') pendingMode = 'rover';
  if (e.code === 'Digit2') pendingMode = 'boat';
  if (e.code === 'Digit3') pendingMode = 'jet';
  if (e.code === 'KeyR') craft.setMode('rover');
  if (e.code === 'Space') pendingHopPress = true;
  if (e.code === 'KeyC') cam.recenter();
  if (e.code === 'KeyM') setMuted(sound.toggleMute());
  if (e.code === 'KeyF') world.colonies.drop();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

const down = (...codes) => codes.some((c) => keys.has(c)) ? 1 : 0;

function readInput() {
  const fwd = down('KeyW', 'ArrowUp') - down('KeyS', 'ArrowDown');
  const lat = down('KeyD', 'ArrowRight') - down('KeyA', 'ArrowLeft');
  const input = {
    fwd,
    turn: lat,
    pitch: fwd,          // in the air, forward is nose-down
    roll: lat,
    boost: !!down('ShiftLeft', 'ShiftRight'),
    // Held, not toggled: the beam is a thing you are doing, not a mode.
    beam: !!down('KeyE'),
    // Hold to charge a jump; the jet's mid-air pop wants the press edge.
    hopHeld: !!down('Space'),
    hopPress: pendingHopPress,
    mode: pendingMode,
  };
  pendingMode = null;
  pendingHopPress = false;
  return input;
}

// ---- loop ---------------------------------------------------------------

const IDLE = { fwd: 0, turn: 0, pitch: 0, roll: 0, boost: false, beam: false, hopHeld: false, hopPress: false, mode: null };
const deepEl = document.getElementById('deep');
let deepShown = 0;

/* ---- the pause ladder ---------------------------------------------------
   Escape pauses, Escape resumes, and this file owns both — js/pausemenu.js
   binds no key handler at all. That split is what keeps the iframe working:
   the game's own window listener is the only thing that sees the key, and
   /surveyor/surveyor.js hands the frame focus on load so it gets there before
   the wrapper's exit chip does.

   PAUSING ACTUALLY PAUSES. The render loop keeps drawing — the menu sits over
   a live frame rather than a frozen screenshot — but nothing is stepped: no
   craft, no world, no economy, no audio intensity. `dt` is not merely zeroed,
   the update calls are skipped, because a zero-dt tick still runs every
   integrator's book-keeping and some of them are not identities at dt 0.

   The gap is then handed to the SAME path an absence already takes. Colony
   growth, production and raiders all run on wall time, and closing the tab has
   always been replayed rather than credited — so a pause is replayed too, by
   the same colonies.catchUp, capped by the same ECONOMY.offlineCap. Nothing
   here is a special case; a two-hour pause and a two-hour absence come back to
   the same world. */
const pausedEl = document.getElementById('paused');
let paused = false;
let pausedAt = 0;

function setPaused(on) {
  if (!started || paused === on) return;
  paused = on;
  pausedEl.classList.toggle('hidden', !on);
  if (on) {
    pausedAt = performance.now();
    // Before the duck, not after: applyMaster ramps the master to zero over
    // ~50ms, so a note scheduled first is still heard on the way down. After
    // it, this would be silent and the pause would have no sound at all.
    emit('ui', { kind: 'back' });
    sound.setPaused?.(true);
    return;
  }
  sound.setPaused?.(false);
  emit('ui', { kind: 'confirm' });
  /* Replayed, not credited, and capped exactly as an absence is. The report is
     emitted so the HUD says what happened — silence after a long pause would
     leave a razed colony unexplained. */
  const away = Math.min(ECONOMY.offlineCap, (performance.now() - pausedAt) / 1000);
  if (away > 1) {
    const missed = [];
    for (const w of worlds.map.values()) {
      const report = w.colonies.catchUp(away);
      if (report) missed.push(report);
    }
    if (missed.length) {
      emit('away', {
        seconds: away,
        lost: missed.reduce((a, m) => a + m.lost, 0),
        held: missed.reduce((a, m) => a + m.held, 0),
        raiders: missed.reduce((a, m) => a + m.raiders, 0),
        worlds: missed.filter((m) => m.lost > 0).map((m) => m.world),
      });
    }
    economy.save();
  }
  canvas.focus();
}

/* TWO globals, and they are not the same thing.
   `window.Surveyor` is the pause menu's contract — small, stable, and defined
   here rather than at the bottom of the file because js/pausemenu.js reads it
   while it builds. `window.SURVEYOR` at the end of this file is the debug
   surface for the console and the dev harnesses, and it changes whenever those
   need something. Nothing should merge them: one is an interface, the other is
   a window into the machine. */
window.Surveyor = {
  resume: () => setPaused(false),
  get paused() { return paused; },
  get sound() { return sound; },
};

engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  if (paused) { scene.render(); return; }
  const input = started ? readInput() : IDLE;

  craft.update(dt, input);
  // In transit there is no ground to stream and no local frame to stream it
  // around; the sky and the discs are the whole of what is drawn.
  // Growth and production for EVERY visited world, then the scene for this one.
  economy.update(dt);
  if (!craft.hyper) world.update(dt, craft, cam.camera);
  else {
    world.discs.update(cam.camera);
    // The beam is the one thing in survey.js that owns a mesh which has to be
    // put away rather than merely stop being updated: nothing else runs in
    // transit, so left alone it would hang over the world you departed from.
    world.survey.beam(dt);
  }
  trails.update(dt, cam.camera.position);
  cam.update(dt, craft);
  streaks.update(dt, craft, cam.camera);
  // After the camera, because selection is by what is nearest the middle of the
  // screen and that is not known until the camera has moved.
  overlay.setHeld(started && keys.has('KeyQ'));
  overlay.update(dt, cam);
  hyperPost(craft.hyperT);
  const fr = craft.surf.frame;
  /* The CRAFT's altitude, not the camera's. The camera swings out and pulls
     back on a climb, and fog that thinned because the chase cam happened to
     rise would be a world clearing for reasons the player did not cause. */
  world.mats.update(dt, cam.camera.position, craft.boostHeat, fr.up, fr.east, fr.north,
    craft.pos.y);
  hud.update(dt);
  sound.update(dt, craft, started);

  // Going under: the screen floods before the mix does.
  const under = craft.submersion;
  if (Math.abs(under - deepShown) > 0.01) {
    deepShown = under;
    deepEl.style.opacity = under.toFixed(3);
    deepEl.classList.toggle('on', under > 0.02);
  }

  scene.render();
});

window.addEventListener('resize', () => engine.resize());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) keys.clear();
});

/* ---- mute ----------------------------------------------------------------
   The permanent SOUND chip is gone from the HUD. It was a button you press
   once a session, if ever, holding a corner of the screen for the whole of it
   — which is the shape of thing the triage exists to remove. M is bound below,
   the pause menu carries both the binding and the full mixer, and the intro
   card points at the pause menu.
   What is left is the FEEDBACK, and it is a toast rather than a panel: the
   state change is worth a moment on screen, not permanent residence. */
function setMuted(m) {
  hud.say(m ? 'SOUND OFF' : 'SOUND ON', m ? 'warn' : 'good');
}

// ---- start card ---------------------------------------------------------

const startEl = document.getElementById('start');
const beginBtn = document.getElementById('begin');

function begin() {
  if (started) return;
  started = true;
  // A context can only be created inside a gesture, which is exactly what
  // this is.
  // No toast here: starting the session is not a mute state change, and the
  // first thing you see should not be the HUD telling you the sound is on.
  sound.start();
  emit('ui', { kind: 'confirm' });
  startEl.classList.add('gone');
  canvas.focus();
  setTimeout(() => { startEl.style.display = 'none'; }, 500);
  // What happened while the tab was shut, once, now that there is someone to
  // tell. Held since boot — see the load block.
  if (awayReport) { emit('away', awayReport); awayReport = null; }
}

beginBtn.addEventListener('click', begin);
window.addEventListener('keydown', (e) => {
  if (!started && (e.code === 'Enter' || e.code === 'Space')) begin();
});

document.body.classList.add('ready');

// Exposed for tuning from the console — ROVER.sinkDepth and friends are the
// dials most likely to be argued with after a first drive.
window.SURVEYOR = {
  craft, cam, sound, pipeline, post, ROVER, worlds, scene, streaks, economy, trails,
  geyserTotals, overlay, previewBake,
  // The far band's true extent, so dev/disccheck.mjs can report the
  // compression against the distance it is compressing.
  get spaceExtent() { return systemExtent(); },
  get raiders() { return world.colonies.raiders; },
  get world() { return world; },
  get planet() { return world.planet; },
  get field() { return world.field; },
  get survey() { return world.survey; },
  get colonies() { return world.colonies; },
  get discs() { return world.discs; },
  get mats() { return world.mats; },
  /* THE LIVE SURFACE, not the boot one, and this is the third instance of the
     same bug in this project.

     `surface` above is a const built from the boot planet. It has to exist —
     a Craft needs one before a World can be constructed — but it is never
     written again, and swapTo replaces the craft's with `new Surface(next, dir)`
     instead. Exposing the const meant SURVEYOR.surface and SURVEYOR.surfaceHeight
     quietly answered for whichever world the tab opened on, forever.

     Nothing in the game reads it after boot, so it never showed. What reads it
     is dev/frames.mjs, which builds the ALOFT and SHORE cameras out of
     S.surface.frame — so a harness that warped would have framed one world's
     shot with another world's tangent basis and reported it as fine.

     The craft's surface is the authority; there is no second copy now. Same
     pattern as the sky domes and as Trails: an object caching `planet` or a
     frame at construction and nothing re-pointing it. */
  get surface() { return craft.surf; },
  // Kept for the dev harness: local tangent height, the same call craft.js makes.
  surfaceHeight: (x, z) => craft.surf.surfaceHeight(x, z),
  // The dev warp, so dev/spawncheck.mjs can measure the path the HUD row takes
  // rather than a reimplementation of it. Still gated by DEBUG.warp inside.
  warp: devWarp,
};
