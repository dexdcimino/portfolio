// main.js — boot, input, the fixed-step accumulator, and the Phase 4 render
// layer wiring (scene/level/actors/fx modules). The sim is authoritative for
// everything that matters; this file renders snapshots, plays cosmetics, and
// writes input into commands. Camera yaw/pitch are applied locally every
// render frame from raw input — never routed through snapshots — then written
// into the next command (ARENA1_STEPS Phase 4).
import { TUNE, SIM_DT, PVP_DEFAULT } from './config.js';
import { BTN, FLAG } from './sim/sim.js';
import { createLoopbackTransport } from './net/transport.js';
import { createRenderScene } from './render/scene.js';
import { buildLevelMeshes } from './render/level.js';
import { createActors } from './render/actors.js';
import { createFx } from './render/fx.js';

const canvas = document.getElementById('game');
const seed = (() => {
  const q = new URLSearchParams(location.search).get('seed');
  return q ? Number(q) >>> 0 : 1;
})();
const transport = createLoopbackTransport(seed, { pvp: PVP_DEFAULT });
const localId = transport.addLocalPlayer();
const level = transport.level;
const world = transport.world;

const R = createRenderScene(canvas);
const { engine, scene, cam } = R;
const levelView = buildLevelMeshes(R, level, seed);
const actors = createActors(R);
const fx = createFx(R, world);

// ── input ───────────────────────────────────────────────────────────────────
let yaw = Math.PI, pitch = 0;      // local, render-rate; written into commands
let locked = false;
const keys = {};
let firing = false, grappling = false;
let jetLatch = false;              // Space pressed mid-air with no coyote/wall
let jumpEdge = false, dashEdge = false;
let coyoteT = 0;                   // client-side mirror for the Space policy
let lastFlags = 0;
let ixNow = 0;                     // strafe input, for camera roll

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
    // (hold); otherwise it buffers a jump (WALLNEAR exists for this call).
    const grounded = !!(lastFlags & FLAG.GROUNDED);
    if (!grounded && coyoteT <= 0 && !(lastFlags & FLAG.WALLNEAR)) jetLatch = true;
    else jumpEdge = true;
  }
  if (e.code === 'ShiftLeft') dashEdge = true;
  if (e.code === 'KeyL') levelView.setLodDebug(!levelView.lodDebug);
  if (e.code === 'Digit1') R.setQuality(0);
  if (e.code === 'Digit2') R.setQuality(1);
  if (e.code === 'Digit3') R.setQuality(2);
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
  ixNow = ix;
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

// ── snapshots, events → cosmetics ───────────────────────────────────────────
let prevSnap = null, lastSnap = null;
const feedEl = document.getElementById('feed');
function feed(msg) {
  const el = document.createElement('div');
  el.className = 'feedMsg';
  el.textContent = msg;
  feedEl.appendChild(el);
  setTimeout(() => el.remove(), 1150);
}
let fovT = 1.05;
const ENEMY_HEX = { blob: '#7BE3B0', wraith: '#8E5BD6', spike: '#E05548' };

transport.onSnapshot((s) => {
  prevSnap = lastSnap; lastSnap = s;
  const me = s.players.find((p) => p.id === localId);
  const prevMe = prevSnap?.players.find((p) => p.id === localId);
  if (me) {
    // hp drop → hurt vignette (renderer never mutates hp — it just watches it)
    if (prevMe && me.hp < prevMe.hp) fx.hurtFlash();
    // dash kick on the DASHING rising edge
    if (prevMe && !(prevMe.flags & FLAG.DASHING) && (me.flags & FLAG.DASHING)) { fovT = 1.24; feed('DASH'); }
    // walljump: airborne vy snapped up to ≈WALLJUMP_UP while a wall was near
    if (prevMe && !(me.flags & FLAG.GROUNDED) && (prevMe.flags & FLAG.WALLNEAR)
      && prevMe.vel.y < 9 && me.vel.y >= 9.4 && me.vel.y <= TUNE.WALLJUMP_UP + 0.01) {
      fovT = 1.16; feed('WALLKICK');
    }
    lastFlags = me.flags;
  }
  for (const ev of s.events) {
    const mine = ev.playerId === undefined || ev.playerId === localId;
    if (ev.type === 'pad' && mine) { fovT = 1.20; feed('LAUNCH'); }
    else if (ev.type === 'ring' && mine) { fovT = 1.26; feed('RING'); }
    else if (ev.type === 'summit' && mine) feed('☀ SUMMIT REACHED ☀');
    else if (ev.type === 'death' && mine) feed('REBOOTED');
    else if (ev.type === 'pickup' && mine) {
      feed('CELL · TANK +20');
      if (ev.point) fx.burst(ev.point, '#FFB13D', 8, 4);
    } else if (ev.type === 'hit') {
      if (ev.shooter === localId) { fx.hitmarkFlash(); fx.dmgNum(ev.point, String(ev.dmg), '#FF3D81'); }
      actors.flash(ev.target);
    } else if (ev.type === 'kill') {
      const pos = actors.positionOf(ev.target) || null;
      if (pos) fx.burst(pos, ENEMY_HEX[ev.kind] || '#7BE3B0', 10, 7);
      if (ev.by === localId) feed('POP!');
    }
  }
});

// ── HUD ─────────────────────────────────────────────────────────────────────
const hud = {
  hpFill: document.getElementById('hpFill'), hpNum: document.getElementById('hpNum'),
  fuelFill: document.getElementById('fuelFill'), fuelNum: document.getElementById('fuelNum'),
  flowNum: document.getElementById('flowNum'), flowFill: document.getElementById('flowFill'),
  alt: document.getElementById('alt'), pips: [...document.querySelectorAll('.pip')],
  kills: document.getElementById('kills'), cells: document.getElementById('cells'),
  deaths: document.getElementById('deaths'),
  fps: document.getElementById('fps'), meshes: document.getElementById('meshes'),
};
function paintHud(me) {
  hud.hpFill.style.width = me.hp + '%';
  hud.hpFill.style.background = me.hp > 40 ? 'var(--teal)' : 'var(--pink)';
  hud.hpNum.textContent = Math.ceil(me.hp);
  hud.fuelFill.style.width = (me.fuel / me.fuelMax * 100) + '%';
  hud.fuelNum.textContent = `${Math.floor(me.fuel)}/${me.fuelMax}`;
  const spd = Math.hypot(me.vel.x, me.vel.z);
  hud.flowNum.innerHTML = '<b>' + spd.toFixed(1) + '</b>';
  hud.flowFill.style.width = Math.min(100, spd / 26 * 100) + '%';
  hud.flowFill.style.background = spd > 15 ? 'var(--pink)' : 'var(--coral)';
  fx.vig.speed.style.opacity = spd > 14 ? Math.min(1, (spd - 14) / 8) : 0;
  hud.alt.textContent = `ALT ${Math.max(0, me.pos.y).toFixed(0)}m · SUMMIT ${level.summitY}m${me.summitDone ? ' ✓' : ''}`;
  hud.pips.forEach((el, i) => { el.className = 'pip' + (i < me.dashCharges ? ' full' : ''); });
  hud.kills.textContent = me.kills ?? 0;
  hud.cells.textContent = me.cellsGot ?? 0;
  hud.deaths.textContent = me.deaths ?? 0;
}

// ── camera dynamics + client-side fire cosmetics ────────────────────────────
let camH = 0.55, roll = 0, bob = 0;
let fireCd = 0, jetPuffT = 0;

// ── accumulator + render loop ───────────────────────────────────────────────
let acc = 0;
let lastTime = performance.now(); // render-side clock; the sim only sees ticks
let fpsAcc = 0;
engine.runRenderLoop(() => {
  const nowMs = performance.now();
  const dt = Math.min(0.25, (nowMs - lastTime) / 1000);
  const now = nowMs / 1000;
  acc += dt;
  lastTime = nowMs;
  while (acc >= SIM_DT) {
    transport.sendCommand(commandForTick(transport.tickCount));
    transport.tick();
    acc -= SIM_DT;
  }
  coyoteT = (lastFlags & FLAG.GROUNDED) ? 0.1 : Math.max(0, coyoteT - dt);

  const alpha = acc / SIM_DT;
  levelView.update(now, dt);

  if (lastSnap) {
    const me = lastSnap.players.find((p) => p.id === localId);
    const pv = prevSnap?.players.find((p) => p.id === localId) || me;
    const px = pv.pos.x + (me.pos.x - pv.pos.x) * alpha;
    const py = pv.pos.y + (me.pos.y - pv.pos.y) * alpha;
    const pz = pv.pos.z + (me.pos.z - pv.pos.z) * alpha;
    const grounded = !!(me.flags & FLAG.GROUNDED);
    const sliding = !!(me.flags & FLAG.SLIDING);
    const jetting = !!(me.flags & FLAG.JETTING);
    const hSpeed = Math.hypot(me.vel.x, me.vel.z);

    // camera block, ported (prototype 1213–1225)
    if (pv && pv.vel.y < -14 && grounded && !(pv.flags & FLAG.GROUNDED)) camH = 0.40; // hard-landing dip
    const targetH = sliding ? 0.15 : 0.55;
    camH += (targetH - camH) * Math.min(1, 12 * dt);
    const targetRoll = ((me.flags & FLAG.WALLNEAR) && !grounded) ? 0.06 : (-ixNow * 0.018);
    roll += (targetRoll - roll) * Math.min(1, 10 * dt);
    if (grounded && hSpeed > 1 && !sliding) bob += dt * hSpeed * 1.4;
    const bobY = grounded && !sliding ? Math.sin(bob) * 0.03 * Math.min(1, hSpeed / 9) : 0;
    const shake = jetting ? (Math.random() - 0.5) * 0.012 : 0;
    cam.position.set(px + shake, py + camH + bobY + shake, pz);
    cam.rotation.set(pitch, yaw, roll);
    const fovTarget = sliding ? 1.12 : 1.05;
    fovT += (fovTarget - fovT) * Math.min(1, 4 * dt);
    cam.fov += (fovT - cam.fov) * Math.min(1, 10 * dt);

    // fire cosmetics: kick/muzzle/recoil/tracer — damage is Phase 5's sim
    fireCd -= dt;
    if (firing && locked && fireCd <= 0) {
      fireCd = 0.11;
      fx.fire();
      pitch -= 0.004;
      const dir = new BABYLON.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      const origin = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
      const hit = world.raycast(origin, { x: dir.x, y: dir.y, z: dir.z }, 250);
      const end = hit
        ? new BABYLON.Vector3(hit.point.x, hit.point.y, hit.point.z)
        : cam.position.add(dir.scale(250));
      fx.spawnTracer(fx.muzzleWorld(), end);
      if (hit && !lastSnap.enemies.length) fx.burst(hit.point, '#FFE7B0', 4, 3);
    }

    // jet vignette + puffs
    fx.vig.jet.style.opacity = jetting ? 1 : 0;
    if (jetting) {
      jetPuffT -= dt;
      if (jetPuffT <= 0) { jetPuffT = 0.05; fx.jetPuff({ x: px, y: py, z: pz }); }
    }

    // grapple rope
    if ((me.flags & FLAG.GRAPPLING) && me.grapple) fx.ropeTo(me.grapple);
    else fx.ropeOff();

    // shadows: local player + live enemies
    fx.placeShadow('me', { x: px, y: py, z: pz }, 1);
    for (const e of lastSnap.enemies) {
      const p = actors.positionOf(e.id);
      if (p) fx.placeShadow('e' + e.id, { x: p.x, y: p.y, z: p.z }, 0.8);
    }

    actors.sync(prevSnap, lastSnap, alpha, localId, { x: px, y: py, z: pz }, now, dt);
    fx.update(dt, grounded, bob);
    paintHud(me);
  }

  scene.render();
  fpsAcc += dt;
  if (fpsAcc > 0.5) {
    fpsAcc = 0;
    hud.fps.textContent = engine.getFps().toFixed(0);
    hud.meshes.textContent = scene.getActiveMeshes().length;
  }
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
