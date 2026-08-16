// main.js — boot, render loop, state machine (title|playing|paused|dead).
// MD-04: the player mawling roams the cave — logic in entities/player.js,
// feel in systems/morph.js, visual mounted via the factory (sprite-swappable),
// tilted follow rig in systems/camera.js. Debug free-cam (F) still overrides.

import { GAME_NAME, CONFIG } from './config.js';
import { rngFor } from './core/rng.js';
import { on } from './core/events.js';
import { ChunkManager } from './world/chunks.js';
import { biomeAt } from './data/biomes.js';
import { STAGES, STAGE_RADII } from './data/stages.js';
import { createFactory } from './visuals/factory.js';
import { MANIFEST } from './visuals/manifest.js';
import { createPlayer, updatePlayer, growthScale, playerRadius } from './entities/player.js';
import { createFoodSystem } from './entities/food.js';
import { createEnemySystem } from './entities/enemy.js';
import { createMorph, updateMorph, morphOnBonk, morphOnGulp } from './systems/morph.js';
import { updateCombat } from './systems/combat.js';
import { createCameraRig } from './systems/camera.js';
import { createHud } from './systems/hud.js';

// ── URL params ──────────────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const seed = params.get('seed') ?? String(Date.now() % 1e6);
window.MW_DEBUG = params.get('debug') === '1';

// RNG determinism proof (MD-01 accept): same ?seed= ⇒ same 5 numbers on refresh.
{
  const rng = rngFor(seed, 'test');
  console.log(
    `[${GAME_NAME}] seed=${seed} rngFor(seed,'test') ×5:`,
    Array.from({ length: 5 }, () => rng())
  );
}

// ── Engine + scene ──────────────────────────────────────────────────────────
const canvas = document.getElementById('game');
const engine = new BABYLON.Engine(canvas, true, { adaptToDeviceRatio: false });
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.25)); // cap render res — big heat saver on HiDPI laptops
const scene = new BABYLON.Scene(engine);
scene.skipPointerMovePicking = true; // no per-move raycasts — we never pick
scene.clearColor = BABYLON.Color4.FromHexString(CONFIG.colors.background + 'FF');

scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
scene.fogColor = BABYLON.Color3.FromHexString(biomeAt(0).fogColor);
scene.fogDensity = biomeAt(0).fogDensity;

// Dim ambient + a warm point light hovering over the mawling: your light
// radius grows with your stage (GDD "Cave dweller").
const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
hemi.intensity = CONFIG.light.hemiIntensity;
hemi.groundColor = BABYLON.Color3.FromHexString('#0A0E14');
const playerLight = new BABYLON.PointLight('playerLight', new BABYLON.Vector3(0, CONFIG.light.playerHeight, 0), scene);
playerLight.diffuse = BABYLON.Color3.FromHexString(CONFIG.light.playerColor);
playerLight.intensity = CONFIG.light.playerIntensity;
playerLight.range = CONFIG.light.playerRangeByStage[0];

// ── World, player, visuals, camera ──────────────────────────────────────────
const world = new ChunkManager(scene, seed);
const factory = createFactory(scene);
const player = createPlayer(); // spawns at origin clearing (0,0)
const morph = createMorph();
const rig = createCameraRig(scene);
const foods = createFoodSystem(world, factory);
const enemies = createEnemySystem(world, factory);
const hud = createHud(document.getElementById('hud'));
let morphState = null; // last computed, for the debug readout

// ── Post FX: the pro Babylon stack — GlowLayer for emissives + HDR
// DefaultRenderingPipeline (bloom, FXAA, ACES tone mapping, GPU vignette).
// ?nofx=1 disables everything for weak devices.
let postPipeline = null;
if ((CONFIG.postfx.enabled || params.get('fx') === '1') && params.get('nofx') !== '1') {
  const P = CONFIG.postfx;
  const glow = new BABYLON.GlowLayer('glow', scene, { mainTextureSamples: 2 });
  glow.intensity = P.glowIntensity;

  postPipeline = new BABYLON.DefaultRenderingPipeline('postfx', true /* HDR */, scene, [rig.cam]);
  postPipeline.fxaaEnabled = P.fxaa;
  postPipeline.bloomEnabled = true;
  postPipeline.bloomThreshold = P.bloomThreshold;
  postPipeline.bloomWeight = P.bloomWeight;
  postPipeline.bloomKernel = P.bloomKernel;
  postPipeline.bloomScale = P.bloomScale;
  postPipeline.imageProcessingEnabled = true;
  postPipeline.imageProcessing.toneMappingEnabled = true;
  postPipeline.imageProcessing.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
  postPipeline.imageProcessing.exposure = P.exposure;
  postPipeline.imageProcessing.contrast = P.contrast;
  postPipeline.imageProcessing.vignetteEnabled = true;
  postPipeline.imageProcessing.vignetteWeight = P.vignetteWeight;
  postPipeline.imageProcessing.vignetteColor = new BABYLON.Color4(0.02, 0.03, 0.06, 1);
  // GPU vignette replaces the DOM placeholder
  document.getElementById('vignette').classList.add('hidden');
}

let playerVisual = null;
function mountPlayerVisual() {
  playerVisual?.dispose();
  playerVisual = factory.mount('player.s' + player.stage, {
    shadow: STAGE_RADII[player.stage - 1] * CONFIG.visuals.shadowRadiusMult,
  });
}
mountPlayerVisual();

// Accent changed in the pause menu: rebuild the visual at the current stage.
// The palette is resolved inside the build, so this is exact — body, jaw,
// horns, eyes and the vertex-baked two-tone fur — at any stage.
window.addEventListener('chomp-accent', () => {
  // Order matters: release the LIVE visual into the pool first, THEN flush —
  // flushing first let mountPlayerVisual() re-pool the live record and mount
  // would pop the same old-coloured visual straight back out. dispose() has a
  // released-guard, so mountPlayerVisual's own dispose call stays a no-op.
  playerVisual?.dispose();
  factory.flushPlayerPools();
  mountPlayerVisual();
  // The accent change happens from the PAUSE menu, and the update loop that
  // normally places the visual every frame is not running while paused — so
  // the fresh mount sat at the world origin (reading as "shot off to the
  // corner") until resume snapped it back. Place and scale it here, now.
  playerVisual.root.position.set(player.x, world.floorHeight(player.x, player.z), player.z);
  playerVisual.root.scaling.setAll(growthScale(player));
});

on('player:bonk', () => morphOnBonk(morph));
on('player:damage', () => morphOnBonk(morph)); // hit = same pancake feedback for now
on('player:eat', () => morphOnGulp(morph)); // every eat gets a visible gulp
on('player:evolve', () => {
  player.maxHp = CONFIG.combat.maxHpByStage[player.stage - 1];
  player.hp = player.maxHp; // evolving heals you up
  mountPlayerVisual();
  rig.setStage(player.stage);
  playerLight.range = CONFIG.light.playerRangeByStage[player.stage - 1];
  window.MW_syncStageButtons?.();
});
on('player:devolve', () => {
  player.maxHp = CONFIG.combat.maxHpByStage[player.stage - 1];
  player.hp = Math.min(player.hp, player.maxHp);
  mountPlayerVisual();
  rig.setStage(player.stage);
  playerLight.range = CONFIG.light.playerRangeByStage[player.stage - 1];
  window.MW_syncStageButtons?.();
});
// ── Death cinematics: eaten (dragged into the killer's maw) or popped
// (burst → deflate into a slime puddle). World runs slow-mo; the game-over
// overlay only shows once the animation has played out.
let dying = null; // { type, enemy, t, puddle }
on('player:death', (info) => {
  if (dying) return;
  player.iframes = 1e9; // no more bites while we die with dignity
  dying = { type: info?.deathType ?? 'popped', enemy: info?.enemy ?? null, by: info?.key ?? null, t: 0, puddle: null, debris: null };
  if (dying.type === 'popped') {
    const puddle = BABYLON.MeshBuilder.CreateDisc('slimePuddle', { radius: 1, tessellation: 20 }, scene);
    puddle.rotation.x = Math.PI / 2;
    puddle.position.set(player.x, world.floorHeight(player.x, player.z) + 0.03, player.z);
    const mat = new BABYLON.StandardMaterial('puddleMat', scene);
    mat.diffuseColor = BABYLON.Color3.FromHexString('#6B3FA0');
    mat.emissiveColor = BABYLON.Color3.FromHexString('#9A5FD0').scale(0.45);
    mat.specularColor = BABYLON.Color3.Black();
    puddle.material = mat;
    puddle.scaling.setAll(0.01);
    dying.puddle = puddle;
    dying.debris = spawnPopDebris();
  }
});

// The POP: slime balls and blood chunks blast outward ballistically, arc
// down, and flatten into splats where they land. 2 large + 5 medium + 10
// small, in fur-teal / slime-purple / blood-red. All wiped by the reload.
function spawnPopDebris() {
  const D = CONFIG.death.debris;
  const base = playerRadius(player);
  const mats = ['#4DA89A', '#9A5FD0', '#C43A2E'].map((hex) => {
    const m = new BABYLON.StandardMaterial('debrisMat', scene);
    m.diffuseColor = BABYLON.Color3.FromHexString(hex);
    m.emissiveColor = m.diffuseColor.scale(0.3);
    m.specularColor = BABYLON.Color3.Black();
    return m;
  });
  const rng = rngFor(seed, 'pop', Math.round(player.x), Math.round(player.z));
  const debris = [];
  const spawn = (sizeMult, matIdx) => {
    const r = base * sizeMult * (0.85 + rng() * 0.3);
    const ball = BABYLON.MeshBuilder.CreateSphere('popDebris', { diameter: r * 2, segments: 5 }, scene);
    ball.material = mats[matIdx];
    ball.position.set(player.x, world.floorHeight(player.x, player.z) + base, player.z);
    const a = rng() * Math.PI * 2;
    const sp = D.speedMin + rng() * (D.speedMax - D.speedMin);
    debris.push({
      mesh: ball, r,
      vx: Math.sin(a) * sp,
      vy: D.upMin + rng() * (D.upMax - D.upMin),
      vz: Math.cos(a) * sp,
      landed: false,
    });
  };
  for (let i = 0; i < D.large; i++) spawn(0.5, 1); // big slime balls
  for (let i = 0; i < D.medium; i++) spawn(0.24, i % 2 === 0 ? 0 : 1); // fur + slime
  for (let i = 0; i < D.small; i++) spawn(0.12, i % 3 === 0 ? 0 : 2); // mostly blood
  return debris;
}

function updatePopDebris(rawDt) {
  const D = CONFIG.death.debris;
  for (const d of dying.debris) {
    if (d.landed) continue;
    d.vy -= D.gravity * rawDt;
    const m = d.mesh;
    m.position.x += d.vx * rawDt;
    m.position.y += d.vy * rawDt;
    m.position.z += d.vz * rawDt;
    const ground = world.floorHeight(m.position.x, m.position.z);
    if (d.vy < 0 && m.position.y <= ground + d.r * 0.3) {
      // SPLAT: flatten into a blob on the floor
      d.landed = true;
      m.position.y = ground + d.r * 0.12;
      m.scaling.set(1.5 + Math.abs(d.vx) * 0.06, 0.22, 1.5 + Math.abs(d.vz) * 0.06);
    }
  }
}

function updateDeathAnim(rawDt) {
  const D = CONFIG.death;
  dying.t += rawDt; // anim clock runs in REAL time; the world is slow-mo'd
  const g = growthScale(player);
  if (dying.type === 'eaten' && dying.enemy) {
    const e = dying.enemy;
    const u = Math.min(1, dying.t / D.eatenSec);
    // dragged into the mouth, shrinking away
    const k = 1 - Math.exp(-D.eatenPull * rawDt);
    player.x += (e.x - player.x) * k;
    player.z += (e.z - player.z) * k;
    playerVisual.root.position.set(player.x, world.floorHeight(player.x, player.z), player.z);
    playerVisual.root.scaling.setAll(Math.max(0.02, g * (1 - u) ** 1.5));
    // the killer CHOMPS — its own jaw animates (gulper is a mawling)
    e.handle?.setPose({
      facing: Math.atan2(player.x - e.x, player.z - e.z),
      mouthOpen: Math.abs(Math.sin(dying.t * 9)),
      scale: (e.radius ?? 1.3) / 1.3,
      threat: true,
    });
    if (dying.t >= D.eatenSec) finishDeath('YOU WERE EATEN');
  } else {
    if (dying.debris) updatePopDebris(rawDt);
    const u = Math.min(1, dying.t / D.poppedSec);
    if (u < 0.18) {
      // swell before the burst
      playerVisual.root.scaling.setAll(g * (1 + (u / 0.18) * D.popSwell));
    } else {
      // deflate: flatten wide + sink — melting into the puddle
      const v = (u - 0.18) / 0.82;
      const flat = Math.max(0.03, 1 - v);
      playerVisual.root.scaling.set(g * (1 + v * 0.9), g * flat * flat, g * (1 + v * 0.9));
      dying.puddle?.scaling.setAll(0.01 + v * playerRadius(player) * CONFIG.death.puddleMult);
    }
    if (dying.t >= D.poppedSec) finishDeath('YOU POPPED');
  }
}

function finishDeath(title) {
  if (state === 'dead') return;
  document.getElementById('dead-title').textContent = title;
  document.getElementById('dead-cause').textContent = dying?.by ? 'killed by: ' + dying.by : '';
  setState('dead');
}

// Debug/console hook: jump to a stage (mass follows so bar/scale agree;
// kept safely above the stage-1 death threshold, hp refilled).
function setStage(n) {
  player.stage = Math.min(Math.max(n, 1), 5);
  player.mass = STAGES[player.stage - 1].mass + 2;
  player.maxHp = CONFIG.combat.maxHpByStage[player.stage - 1];
  player.hp = player.maxHp;
  player.deathEmitted = false;
  mountPlayerVisual();
  rig.setStage(player.stage);
  playerLight.range = CONFIG.light.playerRangeByStage[player.stage - 1];
  window.MW_syncStageButtons?.(); // keep debug panel highlight in sync
}

// ── Debug free-cam (?debug=1, toggle F) ─────────────────────────────────────
let freeCam = null;
let freeCamActive = false;

function toggleFreeCam() {
  if (!freeCamActive) {
    if (!freeCam) {
      freeCam = new BABYLON.UniversalCamera('freeCam', BABYLON.Vector3.Zero(), scene);
      freeCam.keysUp = [87, 38];
      freeCam.keysDown = [83, 40];
      freeCam.keysLeft = [65, 37];
      freeCam.keysRight = [68, 39];
      freeCam.keysUpward = [69];
      freeCam.keysDownward = [81];
      freeCam.speed = CONFIG.debug.freeCamSpeed;
      freeCam.minZ = 0.1;
    }
    freeCam.position.set(player.x, 24, player.z - 12);
    freeCam.setTarget(new BABYLON.Vector3(player.x, 0, player.z));
    if (postPipeline && !postPipeline.cameras.includes(freeCam)) postPipeline.addCamera(freeCam);
    scene.activeCamera = freeCam;
    freeCam.attachControl(canvas, true);
    freeCamActive = true;
  } else {
    freeCam.detachControl();
    scene.activeCamera = rig.cam;
    freeCamActive = false;
  }
}

// ── Debug visual lineup [L] + instanced scatter [G] (?debug=1) ──────────────
let lineup = null;
let scatter = null;
let slowmo = false;

function toggleLineup() {
  if (lineup) {
    for (const { handle } of lineup) handle.dispose();
    lineup = null;
    return;
  }
  const keys = Object.keys(MANIFEST);
  const spacing = CONFIG.debug.lineupSpacing;
  lineup = keys.map((key, i) => {
    const handle = factory.mount(key);
    handle.root.position.set((i - (keys.length - 1) / 2) * spacing, 0, 6);
    return { key, handle };
  });
}

function animateLineup(t) {
  const pose = {
    facing: t * 0.6,
    mouthOpen: (Math.sin(t * 2) + 1) / 2,
    stretch: Math.max(0, Math.sin(t * 1.3)) * 0.6,
    squash: 0,
    bob: Math.sin(t * 3) * 0.08,
    alpha: 1,
  };
  for (const { handle } of lineup) handle.setPose(pose);
}

function toggleScatter() {
  if (scatter) {
    scatter.dispose();
    scatter = null;
    return;
  }
  const rng = rngFor(seed, 'scatter');
  const positions = [];
  for (let i = 0; i < CONFIG.debug.scatterCount; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * CONFIG.debug.scatterRadius;
    positions.push({ x: Math.cos(a) * d, y: 0.2 + rng() * 0.6, z: Math.sin(a) * d });
  }
  scatter = factory.mountInstanced('food.glowmote', positions);
}

// ── State machine ───────────────────────────────────────────────────────────
const STATES = ['title', 'playing', 'paused', 'dead'];
let state = 'playing'; // no splash — straight into the cave

const hudOverlays = {
  paused: document.getElementById('paused'),
  dead: document.getElementById('dead'),
};
const debugEl = document.getElementById('debug');

function setState(next) {
  if (!STATES.includes(next) || next === state) return;
  state = next;
  syncHud();
}

function syncHud() {
  for (const [name, el] of Object.entries(hudOverlays)) {
    el.classList.toggle('hidden', name !== state);
  }
}

// ── Input (keyboard + LMB chomp; touch is a later MD) ───────────────────────
const held = new Set();
let mouseChomp = false;
let chompHeld = false; // armed ONLY by a fresh Space press during play

window.addEventListener('keydown', (e) => {
  held.add(e.code);
  const isPauseKey = e.key === 'Escape' || e.key.toLowerCase() === 'p';
  if (state === 'playing' && isPauseKey) { setState('paused'); return; }
  if (state === 'paused' && (isPauseKey || e.code === 'Space')) { setState('playing'); return; } // consumed by UI — no dash
  if (state === 'dead') { location.reload(); return; } // acknowledge ⇒ instantly back in
  // fresh, non-repeat Space during play = chomp (held-from-respawn repeats don't)
  if (state === 'playing' && e.code === 'Space' && !e.repeat) chompHeld = true;

  if (window.MW_DEBUG) {
    if (e.code === 'KeyF') toggleFreeCam();
    if (e.code === 'KeyC') world.setDebugCells(!world.debugCells);
    if (e.code === 'KeyL') toggleLineup();
    if (e.code === 'KeyG') toggleScatter();
    if (e.code === 'KeyT') slowmo = !slowmo;
  }
});

window.addEventListener('keyup', (e) => {
  held.delete(e.code);
  if (e.code === 'Space') chompHeld = false;
});
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  if (state === 'dead') { location.reload(); return; } // click respawns
  if (state === 'paused') { setState('playing'); return; } // click unpauses — no dash
  if (e.pointerType === 'mouse') mouseChomp = true;
});
window.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse' && e.button === 0) mouseChomp = false;
});

window.addEventListener('blur', () => {
  held.clear();
  mouseChomp = false;
  chompHeld = false;
  if (state === 'playing') setState('paused');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') setState('paused');
});

// ── Site embed hooks (same contract as Cupcake Gobbler) ─────────────────────
window.Chomp = {
  pause() {
    if (state === 'playing') setState('paused');
  },
  resume() {
    if (state === 'paused') setState('playing');
  },
  setSafeTop(px) {
    document.documentElement.style.setProperty('--safe-top', `${px}px`);
  },
};

// ── Loop ────────────────────────────────────────────────────────────────────
function axis(neg, pos) {
  return (held.has(pos[0]) || held.has(pos[1]) ? 1 : 0) - (held.has(neg[0]) || held.has(neg[1]) ? 1 : 0);
}

function gatherInput() {
  let ix = axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
  let iz = axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
  const len = Math.hypot(ix, iz);
  if (len > 1) {
    ix /= len;
    iz /= len;
  }
  return {
    x: ix,
    z: iz,
    chomp: chompHeld || mouseChomp,
    sprint: held.has('ShiftLeft') || held.has('ShiftRight'),
  };
}

function update(dt, rawDt) {
  if (freeCamActive) {
    // Fly cam drives streaming; the player is frozen while inspecting.
    world.ensureAround(freeCam.position.x, freeCam.position.z);
    return;
  }

  if (dying) {
    // Player input/logic frozen; the world keeps breathing in slow-mo
    updateDeathAnim(rawDt);
    foods.update(player, dt);
    if (dying.type !== 'eaten') enemies.update(player, dt); // eaten: we pose the killer ourselves
    rig.update(player, dt);
    world.updateOcclusion(rig.cam.position, { x: player.x, y: 0.5, z: player.z }, dt);
    return;
  }

  updatePlayer(player, gatherInput(), world, dt);
  const { mouthTarget } = updateCombat(player, foods, enemies, dt);
  morphState = updateMorph(morph, player, dt, { mouthTarget });
  playerVisual.root.position.set(player.x, world.floorHeight(player.x, player.z), player.z);
  playerVisual.root.scaling.setAll(growthScale(player)); // grows as it eats, within the stage
  playerVisual.setPose(morphState);

  foods.update(player, dt);
  enemies.update(player, dt);
  hud.update(player);
  playerLight.position.set(player.x, CONFIG.light.playerHeight, player.z);
  // subtle torch flicker — two incommensurate sines, never repeats visibly
  const ft = performance.now() / 1000;
  playerLight.intensity =
    CONFIG.light.playerIntensity * (1 + CONFIG.postfx.lightFlicker * (Math.sin(ft * 13) * 0.6 + Math.sin(ft * 7.3) * 0.4));

  rig.update(player, dt, world.floorHeight(player.x, player.z));
  world.ensureAround(player.x, player.z);
  // Player must never hide behind cave walls (MD-04b): fade occluding chunks.
  world.updateOcclusion(rig.cam.position, { x: player.x, y: 0.5, z: player.z }, dt);

  // Fog chases the player's biome (lerp on ring cross).
  const biome = biomeAt(Math.hypot(player.x, player.z));
  const k = Math.min(1, CONFIG.fog.lerpRate * dt);
  scene.fogColor = BABYLON.Color3.Lerp(scene.fogColor, BABYLON.Color3.FromHexString(biome.fogColor), k);
  scene.fogDensity += (biome.fogDensity - scene.fogDensity) * k;
}

engine.runRenderLoop(() => {
  const raw = Math.min(engine.getDeltaTime() / 1000, CONFIG.loop.dtMax);
  let dt = slowmo ? raw * CONFIG.debug.slowmo : raw;
  if (dying) dt = raw * CONFIG.death.slowmo; // death drama runs the world slow
  if (state === 'playing') update(dt, raw);
  if (lineup) animateLineup(performance.now() / 1000);
  scene.render();

  if (window.MW_DEBUG) {
    debugEl.classList.remove('hidden');
    const S = CONFIG.world.chunkSize * CONFIG.world.cellSize;
    const biome = biomeAt(Math.hypot(player.x, player.z));
    const m = morphState;
    debugEl.textContent =
      `${engine.getFps().toFixed(0)} fps  state=${state}  seed=${seed}${slowmo ? '  SLOWMO' : ''}\n` +
      `player ${player.x.toFixed(1)}, ${player.z.toFixed(1)}  spd ${player.speed.toFixed(1)}  stage ${player.stage}\n` +
      `chunk  ${Math.floor(player.x / S)}, ${Math.floor(player.z / S)}  biome ${biome.key}  chunks ${world.loadedCount}\n` +
      (m
        ? `morph  str ${m.stretch.toFixed(2)}  sq ${m.squash.toFixed(2)}  mouth ${m.mouthOpen.toFixed(2)}  bank ${m.bank.toFixed(2)}\n`
        : '') +
      `[F] free-cam ${freeCamActive ? 'ON' : 'off'}  [C] cells ${world.debugCells ? 'ON' : 'off'}  ` +
      `[L] lineup ${lineup ? 'ON' : 'off'}  [G] scatter ${scatter ? 'ON' : 'off'}  [T] slowmo ${slowmo ? 'ON' : 'off'}`;
  }
});

// ── Debug GUI panel (?debug=1): stage buttons + cam zoom slider (MD-04b) ────
function buildDebugPanel() {
  const stages = document.createElement('div');
  stages.id = 'debug-stages';
  stages.className = 'debug-panel';
  const buttons = [];
  for (let n = 1; n <= 5; n++) {
    const b = document.createElement('button');
    b.textContent = 'S' + n;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      setStage(n);
      b.blur(); // keep Space/arrows flowing to the game, not the button
    });
    buttons.push(b);
    stages.appendChild(b);
  }
  const syncButtons = () => buttons.forEach((b, i) => b.classList.toggle('active', player.stage === i + 1));
  syncButtons();
  window.MW_syncStageButtons = syncButtons;


  const zoom = document.createElement('div');
  zoom.id = 'debug-zoom';
  zoom.className = 'debug-panel';
  const label = document.createElement('label');
  label.textContent = 'cam zoom';
  const value = document.createElement('span');
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0.5';
  slider.max = '2';
  slider.step = '0.05';
  const stored = parseFloat(localStorage.getItem('mw_debugzoom'));
  const initial = Number.isFinite(stored) ? Math.min(2, Math.max(0.5, stored)) : 1;
  slider.value = String(initial);
  value.textContent = initial.toFixed(2);
  rig.setZoomMult(initial);
  slider.addEventListener('input', (e) => {
    e.stopPropagation();
    const m = parseFloat(slider.value);
    value.textContent = m.toFixed(2);
    rig.setZoomMult(m);
    localStorage.setItem('mw_debugzoom', String(m));
  });
  slider.addEventListener('change', () => slider.blur()); // release keyboard focus after drag
  zoom.append(label, slider, value);

  // No pointer/key leakage into gameplay input
  for (const panel of [stages, zoom]) {
    for (const evt of ['pointerdown', 'pointerup', 'keydown', 'keyup']) {
      panel.addEventListener(evt, (e) => e.stopPropagation());
    }
  }
  document.getElementById('hud').append(stages, zoom);
}

if (window.MW_DEBUG) {
  // chunk border grid lines retired — [C] cell overlay still available
  buildDebugPanel();
  window.setStage = setStage; // console hook
  window.MW = {
    engine, scene, world, factory, MANIFEST, player, rig,
    morph: () => morphState,
    playerVisual: () => playerVisual,
    lineup: () => lineup,
    scatter: () => scatter,
    toggleLineup, toggleScatter, setStage,
  };
}

window.addEventListener('resize', () => engine.resize());

syncHud();
