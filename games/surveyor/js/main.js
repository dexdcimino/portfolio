// Boot and the single fused loop. Single-player, so there is deliberately no
// sim/render split here — logic touches meshes directly and that is correct
// for this game.

import { createMaterials } from './world/materials.js';
import { ChunkField } from './world/chunks.js';
import { Water } from './world/water.js';
import { createSky } from './world/sky.js';
import { buildRover, buildBoat, buildJet } from './player/meshes.js';
import { Craft } from './player/craft.js';
import { ChaseCam } from './player/camera.js';
import { Trails } from './fx/trails.js';
import { Survey } from './game/survey.js';
import { Colonies } from './game/colony.js';
import { Hud } from './game/hud.js';
import { Sound } from './audio/index.js';
import { on } from './core/events.js';
import { makePlanet } from './world/sphere.js';
import { Surface, findSpawn } from './world/surface.js';
import { COLORS, ATMO, ROVER, PLANETS } from './tune.js';

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

// Phase 2 ships one world. The planet object is the single place radius,
// relief, LOD depth, fog and draw distance all come from — nothing downstream
// carries a hardcoded world size any more.
const planet = makePlanet(PLANETS.home);
const surface = new Surface(planet, findSpawn(planet, planet.relief * 0.12, planet.relief * 0.75));

const mats = createMaterials(scene, planet);
createSky(scene, mats.sky, planet);

const field = new ChunkField(scene, mats.terrain, planet);
const water = new Water(scene, mats.water, planet);

const forms = {
  rover: buildRover(scene, mats.craft),
  boat: buildBoat(scene, mats.craft),
  jet: buildJet(scene, mats.craft),
};

const craft = new Craft(forms, surface);
const cam = new ChaseCam(scene, canvas, planet);
const trails = new Trails(scene, craft, forms);
const survey = new Survey(scene, craft, planet);
const colonies = new Colonies(scene, craft, mats.craft, planet);
const hud = new Hud(craft, survey, field, colonies);
const sound = new Sound();

// ---- post ----------------------------------------------------------------
// This replaces the old GlowLayer. A glow layer renders its emissive meshes
// into a separate buffer with no depth information, so haloes came through
// hillsides. Bloom works on the finished frame instead: if a hill is in front
// of a beacon, the beacon isn't in the frame, so it can't bloom. Everything
// that should glow is simply authored above 1.0 in an HDR buffer.
let pipeline = null;
if (ATMO.bloom) {
  pipeline = new BABYLON.DefaultRenderingPipeline('post', true, scene, [cam.camera]);
  pipeline.fxaaEnabled = ATMO.fxaa;
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = ATMO.bloomThreshold;
  pipeline.bloomWeight = ATMO.bloomWeight;
  pipeline.bloomKernel = ATMO.bloomKernel;
  pipeline.bloomScale = ATMO.bloomScale;

  const ip = pipeline.imageProcessing;
  ip.toneMappingEnabled = false;        // the palette is hand-picked; leave it
  ip.contrast = ATMO.contrast;
  ip.exposure = ATMO.exposure;
  ip.vignetteEnabled = true;
  ip.vignetteWeight = ATMO.vignette;
  ip.vignetteColor = new BABYLON.Color4(0.02, 0.05, 0.07, 0);
  ip.vignetteCameraFov = 1.0;

  if (ATMO.grain > 0) {
    pipeline.grainEnabled = true;
    pipeline.grain.intensity = ATMO.grain;
    pipeline.grain.animated = true;
  }
}

// Warm the terrain around the spawn point before the first frame is shown.
// The tree is bounded now, so this genuinely finishes rather than chasing an
// unbounded stream.
field.update(surface.frame.up);
for (let i = 0; i < 600 && field.queue.length; i++) field.update(surface.frame.up);
survey.update(0.016);

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
  if (e.code === 'Digit1') pendingMode = 'rover';
  if (e.code === 'Digit2') pendingMode = 'boat';
  if (e.code === 'Digit3') pendingMode = 'jet';
  if (e.code === 'KeyR') craft.setMode('rover');
  if (e.code === 'Space') pendingHopPress = true;
  if (e.code === 'KeyC') cam.recenter();
  if (e.code === 'KeyM') setMuted(sound.toggleMute());
  if (e.code === 'KeyF') colonies.drop();
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

const IDLE = { fwd: 0, turn: 0, pitch: 0, roll: 0, boost: false, hopHeld: false, hopPress: false, mode: null };
const deepEl = document.getElementById('deep');
let deepShown = 0;

engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  const input = started ? readInput() : IDLE;

  craft.update(dt, input);
  field.update(surface.frame.up);
  water.update();
  survey.update(dt);
  colonies.update(dt);
  trails.update(dt, cam.camera.position);
  cam.update(dt, craft);
  mats.update(dt, cam.camera.position, craft.boostHeat,
    surface.frame.up, surface.frame.east, surface.frame.north);
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

// ---- sound toggle -------------------------------------------------------

const soundBtn = document.getElementById('sound');

function setMuted(m) {
  soundBtn.classList.toggle('off', m);
  soundBtn.setAttribute('aria-pressed', m ? 'false' : 'true');
  soundBtn.textContent = m ? 'SOUND OFF' : 'SOUND ON';
}

soundBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  sound.start();
  setMuted(sound.toggleMute());
  canvas.focus();
});

// ---- start card ---------------------------------------------------------

const startEl = document.getElementById('start');
const beginBtn = document.getElementById('begin');

function begin() {
  if (started) return;
  started = true;
  // A context can only be created inside a gesture, which is exactly what
  // this is.
  if (sound.start()) setMuted(false);
  startEl.classList.add('gone');
  canvas.focus();
  setTimeout(() => { startEl.style.display = 'none'; }, 500);
}

beginBtn.addEventListener('click', begin);
window.addEventListener('keydown', (e) => {
  if (!started && (e.code === 'Enter' || e.code === 'Space')) begin();
});

document.body.classList.add('ready');

// Exposed for tuning from the console — ROVER.sinkDepth and friends are the
// dials most likely to be argued with after a first drive.
window.SURVEYOR = {
  craft, cam, sound, field, survey, colonies, pipeline, ROVER,
  planet, surface,
  // Kept for the dev harness: local tangent height, the same call craft.js makes.
  surfaceHeight: (x, z) => surface.surfaceHeight(x, z),
};
