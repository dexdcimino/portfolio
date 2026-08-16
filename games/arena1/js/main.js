// main.js — boot, input, the fixed-step accumulator, and a DEBUG render for
// the Phase 3 feel gate. The debug render draws the sim's collision world
// (flat-shaded primitives straight from level/world data) so movement can be
// felt and compared against the prototype; the real render layer replaces it
// wholesale in Phase 4. Everything sim-authoritative flows through the
// transport; this file reads level/world one-directionally for meshes only.
//
// Camera rule (ARENA1_STEPS Phase 4, honored from day one): yaw/pitch are
// applied LOCALLY every render frame from raw input — never routed through
// snapshots — then written into the next command.
import { TUNE, SIM_DT, PVP_DEFAULT } from './config.js';
import { BTN, FLAG } from './sim/sim.js';
import { createLoopbackTransport } from './net/transport.js';

const canvas = document.getElementById('game');
const engine = new BABYLON.Engine(canvas, true, { stencil: true });
const scene = new BABYLON.Scene(engine);
scene.clearColor = BABYLON.Color4.FromHexString('#2B1B45FF');
scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
scene.fogStart = 90; scene.fogEnd = 260;
scene.fogColor = BABYLON.Color3.FromHexString('#2B1B45');

// ── transport + local player ────────────────────────────────────────────────
const seed = (() => {
  const q = new URLSearchParams(location.search).get('seed');
  return q ? Number(q) >>> 0 : 1;
})();
const transport = createLoopbackTransport(seed, { pvp: PVP_DEFAULT });
const localId = transport.addLocalPlayer();
const level = transport.level;
const world = transport.world;

// ── debug render: the collision world, honestly ─────────────────────────────
new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0.2, 1, 0.1), scene).intensity = 0.85;
const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.4, -1, -0.3), scene);
sun.intensity = 0.5;

const mats = new Map();
function mat(hex, alpha = 1) {
  const key = hex + alpha;
  if (!mats.has(key)) {
    const m = new BABYLON.StandardMaterial('m' + key, scene);
    m.diffuseColor = BABYLON.Color3.FromHexString(hex);
    m.specularColor = BABYLON.Color3.Black();
    if (alpha < 1) m.alpha = alpha;
    mats.set(key, m);
  }
  return mats.get(key);
}

// Static level pieces from level data (named, colored like the prototype).
for (const b of level.blocks) {
  const m = BABYLON.MeshBuilder.CreateBox(b.name, { width: b.w, height: b.h, depth: b.d }, scene);
  m.position.set(b.x, b.y, b.z);
  m.material = mat(b.hex);
  m.freezeWorldMatrix();
}
for (const rp of level.ramps) {
  const m = BABYLON.MeshBuilder.CreateBox(rp.name, { width: rp.w, height: rp.h, depth: rp.d }, scene);
  m.position.set(rp.x, rp.y, rp.z);
  m.rotation.set(rp.rotX, rp.rotY, 0);
  m.material = mat(rp.hex);
  m.freezeWorldMatrix();
}
for (const c of level.crystals) {
  const m = BABYLON.MeshBuilder.CreateIcoSphere('crys', { radius: 1, subdivisions: 1 }, scene);
  m.convertToFlatShadedMesh();
  m.scaling.set(c.s, c.sy, c.s);
  m.position.set(c.x, c.y, c.z);
  m.rotation.y = c.rotY;
  m.material = mat(c.col === 'teal' ? '#3EC5B4' : '#FF6FA5');
  m.freezeWorldMatrix();
}
for (const p of level.pads) {
  const m = BABYLON.MeshBuilder.CreateCylinder('pad', { height: 0.4, diameter: 4.4, tessellation: 10 }, scene);
  m.position.set(p.x, 0.2, p.z);
  m.material = mat('#FF3D81');
  m.freezeWorldMatrix();
}
for (const r of level.rings) {
  const m = BABYLON.MeshBuilder.CreateTorus('ring', { diameter: 4.6, thickness: 0.32, tessellation: 18 }, scene);
  m.position.set(r.pos.x, r.pos.y, r.pos.z);
  m.lookAt(new BABYLON.Vector3(r.pos.x + r.dir.x, r.pos.y + r.dir.y, r.pos.z + r.dir.z));
  m.rotation.x += Math.PI / 2;
  m.material = mat('#FF3D81');
  m.freezeWorldMatrix();
}
{
  const beacon = BABYLON.MeshBuilder.CreateBox('beacon', { width: 0.8, height: 26, depth: 0.8 }, scene);
  beacon.position.set(0, level.summitY + 13, 0);
  beacon.material = mat('#FFE7B0');
  beacon.freezeWorldMatrix();
}

// Platform shapes: one mesh per collision shape, synced to the shape each
// frame (movers/blinkers/collapsers reposition sim-side; render follows).
const platMeshes = [];
for (const pl of level.platforms) {
  for (const s of pl.shapes) {
    let m;
    if (s.kind === 'aabb') {
      m = BABYLON.MeshBuilder.CreateBox('pl' + pl.id, {
        width: s.max.x - s.min.x, height: s.max.y - s.min.y, depth: s.max.z - s.min.z,
      }, scene);
    } else if (s.kind === 'vcyl') {
      m = BABYLON.MeshBuilder.CreateCylinder('pl' + pl.id, {
        diameter: s.r * 2, height: s.halfH * 2, tessellation: 12,
      }, scene);
    } else {
      m = BABYLON.MeshBuilder.CreateBox('pl' + pl.id, {
        width: s.half.x * 2, height: s.half.y * 2, depth: s.half.z * 2,
      }, scene);
      const [a0, a1, a2] = s.axes;
      m.rotationQuaternion = BABYLON.Quaternion.FromRotationMatrix(BABYLON.Matrix.FromValues(
        a0.x, a0.y, a0.z, 0, a1.x, a1.y, a1.z, 0, a2.x, a2.y, a2.z, 0, 0, 0, 0, 1));
    }
    m.material = mat(pl.hex);
    platMeshes.push({ mesh: m, shape: s });
  }
}
function syncPlatformMeshes() {
  for (const { mesh, shape } of platMeshes) {
    mesh.setEnabled(shape.active);
    if (shape.kind === 'aabb') {
      mesh.position.set((shape.min.x + shape.max.x) / 2, (shape.min.y + shape.max.y) / 2, (shape.min.z + shape.max.z) / 2);
    } else {
      mesh.position.set(shape.center.x, shape.center.y, shape.center.z);
    }
  }
}

// Grapple rope: a stretched box from the camera to the anchor while latched.
const rope = BABYLON.MeshBuilder.CreateBox('rope', { width: 0.05, height: 0.05, depth: 1 }, scene);
rope.material = mat('#FF3D81');
rope.isVisible = false;

// ── input ───────────────────────────────────────────────────────────────────
let yaw = Math.PI, pitch = 0;      // local, render-rate; written into commands
let locked = false;
const keys = {};
let firing = false, grappling = false;
let jetLatch = false;              // Space pressed mid-air with no coyote/wall
let jumpEdge = false;              // one-shot: turned into a JUMP bit edge
let dashEdge = false;
let coyoteT = 0;                   // client-side mirror for the Space policy
let lastFlags = 0;

const start = document.getElementById('start');
start.addEventListener('click', () => canvas.requestPointerLock());
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  start.style.display = locked ? 'none' : 'flex';
  if (!locked) { firing = false; grappling = false; jetLatch = false; }
});
document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  yaw += e.movementX * TUNE.SENS;
  pitch = Math.max(-1.5, Math.min(1.5, pitch + e.movementY * TUNE.SENS));
});
document.addEventListener('mousedown', (e) => {
  if (!locked) return;
  if (e.button === 0) firing = true;
  if (e.button === 2) grappling = true;
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) firing = false;
  if (e.button === 2) grappling = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.preventDefault();
  if (e.repeat) { keys[e.code] = true; return; }
  keys[e.code] = true;
  if (!locked) return;
  if (e.code === 'Space') {
    // The prototype's policy: mid-air Space with no coyote and no wall = jet
    // (hold); otherwise it buffers a jump. Grounded/coyote/wall come from the
    // latest snapshot (WALLNEAR flag exists for exactly this decision).
    const grounded = !!(lastFlags & FLAG.GROUNDED);
    if (!grounded && coyoteT <= 0 && !(lastFlags & FLAG.WALLNEAR)) jetLatch = true;
    else jumpEdge = true;
  }
  if (e.code === 'ShiftLeft') dashEdge = true;
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Space') jetLatch = false;
});

function commandForTick(tick) {
  let ix = 0, iz = 0;
  if (keys.KeyW || keys.ArrowUp) iz += 1;
  if (keys.KeyS || keys.ArrowDown) iz -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  const slide = keys.KeyC || keys.ControlLeft;
  const buttons =
    (jumpEdge ? BTN.JUMP : 0)
    | (dashEdge ? BTN.DASH : 0)
    | (slide ? BTN.SLIDE : 0)
    | (firing ? BTN.FIRE : 0)
    | (grappling ? BTN.GRAPPLE : 0)
    | (jetLatch ? BTN.JET : 0);
  jumpEdge = false; dashEdge = false;
  return { tick, playerId: localId, move: { x: ix, z: iz }, yaw, pitch, buttons };
}

// ── snapshots + HUD ─────────────────────────────────────────────────────────
let prevSnap = null, lastSnap = null;
const feedEl = document.getElementById('feed');
function feed(msg) {
  const el = document.createElement('div');
  el.className = 'feedMsg';
  el.textContent = msg;
  feedEl.appendChild(el);
  setTimeout(() => el.remove(), 1150);
}
transport.onSnapshot((s) => {
  prevSnap = lastSnap; lastSnap = s;
  const me = s.players.find((p) => p.id === localId);
  if (me) lastFlags = me.flags;
  for (const ev of s.events) {
    if (ev.playerId !== undefined && ev.playerId !== localId) continue;
    if (ev.type === 'pad') feed('LAUNCH');
    else if (ev.type === 'ring') feed('RING');
    else if (ev.type === 'summit') feed('☀ SUMMIT REACHED ☀');
    else if (ev.type === 'death') feed('REBOOTED');
  }
});

const hud = {
  flowNum: document.getElementById('flowNum'),
  flowFill: document.getElementById('flowFill'),
  fuelFill: document.getElementById('fuelFill'),
  fuelNum: document.getElementById('fuelNum'),
  alt: document.getElementById('alt'),
  pips: [...document.querySelectorAll('.pip')],
};
function paintHud(me) {
  const spd = Math.hypot(me.vel.x, me.vel.z);
  hud.flowNum.textContent = spd.toFixed(1);
  hud.flowFill.style.width = Math.min(100, (spd / 26) * 100) + '%';
  hud.flowFill.style.background = spd > 15 ? '#FF3D81' : '#FF7A59';
  hud.fuelFill.style.width = (me.fuel / me.fuelMax) * 100 + '%';
  hud.fuelNum.textContent = `${Math.floor(me.fuel)}/${me.fuelMax}`;
  hud.alt.textContent = `ALT ${Math.max(0, me.pos.y).toFixed(0)}m · SUMMIT ${level.summitY}m${me.summitDone ? ' ✓' : ''}`;
  hud.pips.forEach((el, i) => { el.className = 'pip' + (i < me.dashCharges ? ' full' : ''); });
}

// ── camera ──────────────────────────────────────────────────────────────────
const cam = new BABYLON.FreeCamera('cam', new BABYLON.Vector3(0, 5, 26), scene);
cam.minZ = 0.05; cam.maxZ = 1200; cam.fov = 1.05; cam.inputs.clear();
let camH = 0.55;

// ── accumulator ─────────────────────────────────────────────────────────────
let acc = 0;
let lastTime = performance.now(); // render-side clock; the sim only sees ticks
engine.runRenderLoop(() => {
  const now = performance.now();
  const frameDt = Math.min(0.25, (now - lastTime) / 1000);
  acc += frameDt;
  lastTime = now;
  while (acc >= SIM_DT) {
    transport.sendCommand(commandForTick(transport.tickCount));
    transport.tick();
    acc -= SIM_DT;
  }
  coyoteT = (lastFlags & FLAG.GROUNDED) ? 0.1 : Math.max(0, coyoteT - frameDt);

  if (lastSnap) {
    const alpha = acc / SIM_DT;
    const me = lastSnap.players.find((p) => p.id === localId);
    const pv = prevSnap?.players.find((p) => p.id === localId) || me;
    const px = pv.pos.x + (me.pos.x - pv.pos.x) * alpha;
    const py = pv.pos.y + (me.pos.y - pv.pos.y) * alpha;
    const pz = pv.pos.z + (me.pos.z - pv.pos.z) * alpha;
    const targetH = (me.flags & FLAG.SLIDING) ? 0.15 : 0.55;
    camH += (targetH - camH) * Math.min(1, 12 * frameDt);
    cam.position.set(px, py + camH, pz);
    cam.rotation.set(pitch, yaw, 0);

    if ((me.flags & FLAG.GRAPPLING) && me.grapple) {
      const a = cam.position.add(new BABYLON.Vector3(0.3, -0.25, 0));
      const t = new BABYLON.Vector3(me.grapple.x, me.grapple.y, me.grapple.z);
      const d = t.subtract(a);
      rope.isVisible = true;
      rope.position = a.add(d.scale(0.5));
      rope.lookAt(t);
      rope.scaling.z = Math.max(0.01, d.length());
    } else {
      rope.isVisible = false;
    }
    paintHud(me);
  }
  syncPlatformMeshes();
  scene.render();
});
window.addEventListener('resize', () => engine.resize());

// Embed hooks (contract #3) — exact shape; wired to the state machine in
// Phase 6. Declared from Phase 0 so the wrapper contract is never retrofitted.
window.Arena1 = {
  pause() { /* state machine lands with the game states */ },
  resume() { /* state machine lands with the game states */ },
  setSafeTop(px) {
    document.documentElement.style.setProperty('--safe-top', `${px}px`);
  },
};

// Dev readout: tick + seed prove the accumulator runs at sim rate.
const boot = document.getElementById('hud-boot');
setInterval(() => {
  if (boot && lastSnap) boot.textContent = `ARENA 1 · seed ${seed} · tick ${lastSnap.tick}`;
}, 250);
