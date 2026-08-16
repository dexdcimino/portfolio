// main.js — boot, input, the fixed-step accumulator, and session management.
// The sim is authoritative for everything that matters; this file renders
// snapshots, plays cosmetics, and writes input into commands. Camera
// yaw/pitch are applied locally every render frame from raw input — never
// routed through snapshots — then written into the next command.
//
// MD 9 structure: the world is a SESSION (transport + render + loop) that can
// be torn down and rebuilt. Boot starts a loopback session instantly — a
// network problem must never produce a blank game — while a Photon attempt
// runs in parallel (public auto-join by default, named room for ?room= and
// private codes). When the match is ready the session hands off in place;
// if the host later leaves, survivors bounce to solo and rejoin a fresh
// public room automatically.
import { TUNE, SIM_DT, PVP_DEFAULT } from './config.js';
import { BTN, FLAG } from './sim/sim.js';
import { createLoopbackTransport } from './net/transport.js';
import { createRenderScene } from './render/scene.js';
import { buildLevelMeshes } from './render/level.js';
import { createActors } from './render/actors.js';
import { createFx } from './render/fx.js';
import { AudioFX } from './systems/audio.js';

const canvas = document.getElementById('game');
const params = new URLSearchParams(location.search);
const seed = (() => {
  const q = params.get('seed');
  return q ? Number(q) >>> 0 : 1;
})();
// PvP is a MATCH-START flag (spec): the pause menu writes arena1-pvp, and the
// next createSim reads it. Never toggled mid-match. In a Photon room the
// HOST's flag decides; clients adopt it with the welcome.
const pvp = (() => {
  try {
    const v = localStorage.getItem('arena1-pvp');
    return v === null ? PVP_DEFAULT : v === '1';
  } catch { return PVP_DEFAULT; }
})();
const roomParam = params.get('room');
// Test isolation: ?photonver=x partitions the matchmaking pool so harness
// windows never seat into (or fill up) the live public rooms.
const verSuffix = params.get('photonver') || '';

// ── global UI state ─────────────────────────────────────────────────────────
const pausedEl = document.getElementById('paused');
const hintEl = document.getElementById('lockHint');
const feedEl = document.getElementById('feed');
let state = 'playing'; // playing ⇄ paused; no title screen
let S = null;          // the active session (see startSession)

function feed(msg) {
  const el = document.createElement('div');
  el.className = 'feedMsg';
  el.textContent = msg;
  feedEl.appendChild(el);
  setTimeout(() => el.remove(), 1150);
}
function updateHint() {
  hintEl.classList.toggle('on', state === 'playing' && document.pointerLockElement !== canvas);
}
function setState(s) {
  state = s;
  pausedEl.classList.toggle('hidden', s !== 'paused');
  updateHint();
  if (s !== 'playing') AudioFX.jetStop();
  if (S) { S.acc = 0; S.lastTime = performance.now(); } // no catch-up burst
}
updateHint();

// ── global input state ──────────────────────────────────────────────────────
let yaw = Math.PI, pitch = 0;      // local, render-rate; persists across sessions
let locked = false;
const keys = {};
let firing = false, grappling = false;
let jetLatch = false;              // Space pressed mid-air with no coyote/wall
let jumpEdge = false, dashEdge = false;
let coyoteT = 0;                   // client-side mirror for the Space policy
let lastFlags = 0;
let ixNow = 0;                     // strafe input, for camera roll

// requestPointerLock returns a Promise in current Chrome and rejects without
// a user gesture and during the ~1.25s cooldown after an Escape-triggered
// exit. Resume paths pass retries: the request is re-attempted every 300ms
// until it lands, the chain caps out, or the state changes — so resuming
// puts you straight back in first-person control instead of leaving a
// cursor. (Chrome permits gesture-less relock after a prior successful lock
// once the cooldown expires; the first-ever lock still needs the click.)
let lockRetry = null;
function requestLock(retries = 0) {
  clearTimeout(lockRetry);
  const attempt = (left) => {
    if (locked || state !== 'playing') return;
    let p = null;
    try { p = canvas.requestPointerLock(); } catch { /* older engines throw sync */ }
    const again = () => {
      if (left > 0 && !locked && state === 'playing') {
        lockRetry = setTimeout(() => attempt(left - 1), 300);
      }
    };
    if (p && typeof p.catch === 'function') p.catch(again);
    else again(); // no promise: the `locked` guard stops the chain on success
  };
  attempt(retries);
}
canvas.addEventListener('click', () => {
  AudioFX.ensure(); // first gesture also unlocks the AudioContext
  if (state === 'playing' && !locked) requestLock(2);
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) {
    if (state !== 'playing') setState('playing');
  } else {
    firing = false; grappling = false; jetLatch = false;
    if (state === 'playing') setState('paused'); // Escape (or focus loss) pauses
  }
  updateHint();
});
document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  yaw += e.movementX * TUNE.SENS;
  pitch = Math.max(-1.5, Math.min(1.5, pitch + e.movementY * TUNE.SENS));
});
document.addEventListener('mousedown', (e) => {
  if (!locked) return;
  if (e.button === 0) firing = true;
  if (e.button === 2) { grappling = true; AudioFX.thwip(); }
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
  // Escape while paused resumes (keydown is a user gesture, so the pointer
  // lock request is allowed to succeed here).
  if (e.code === 'Escape' && state === 'paused') { window.Arena1.resume(); return; }
  if (!locked) return;
  if (e.code === 'Space') {
    // The prototype's policy: mid-air Space with no coyote and no wall = jet
    // (hold); otherwise it buffers a jump (WALLNEAR exists for this call).
    const grounded = !!(lastFlags & FLAG.GROUNDED);
    if (!grounded && coyoteT <= 0 && !(lastFlags & FLAG.WALLNEAR)) jetLatch = true;
    else jumpEdge = true;
  }
  if (e.code === 'ShiftLeft') dashEdge = true;
  if (e.code === 'KeyL') S?.levelView.setLodDebug(!S.levelView.lodDebug);
  if (e.code === 'Digit1') applyQuality(0);
  if (e.code === 'Digit2') applyQuality(1);
  if (e.code === 'Digit3') applyQuality(2);
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Space') jetLatch = false;
});

// Quality: persisted; the menu hands changes over by event, the 1/2/3 keys
// write the same key and sync the menu back. Re-applied per session build.
function applyQuality(i) {
  S?.R.setQuality(i);
  try { localStorage.setItem('arena1-quality', String(i)); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent('arena1-quality-sync'));
}
window.addEventListener('arena1-quality', (e) => S?.R.setQuality(e.detail));

// ── background pump heartbeat ───────────────────────────────────────────────
// Chrome suspends rAF in hidden tabs, which froze a HOST's sim — and the
// whole match — the moment the host alt-tabbed. Worker timers are exempt.
const pumpWorker = new Worker(URL.createObjectURL(new Blob(
  ['setInterval(() => postMessage(0), 16);'], { type: 'text/javascript' })));
pumpWorker.onmessage = () => { if (document.hidden) S?.pump(); };
window.addEventListener('resize', () => S?.R.engine.resize());

const ENEMY_HEX = { blob: '#7BE3B0', wraith: '#8E5BD6', spike: '#E05548' };

// ── session ─────────────────────────────────────────────────────────────────
// Everything owned by one world: transport, render scene, snapshot handler,
// loop. startSession disposes the previous session (engine AND transport)
// and builds the next one in place — the handoff path for solo → match,
// match → rejoin, and menu-driven room switches.
function startSession(transport) {
  const old = S;
  S = null; // heartbeat idles during the swap
  if (old) {
    try { old.R.engine.dispose(); } catch { /* already gone */ }
    try { old.transport.dispose?.(); } catch { /* already closed */ }
  }

  transport.addLocalPlayer();
  const localId = transport.localId;
  const level = transport.level;
  const world = transport.world;

  const R = createRenderScene(canvas);
  const { engine, scene, cam } = R;
  try {
    const q = localStorage.getItem('arena1-quality');
    if (q !== null) R.setQuality(Number(q));
  } catch { /* default MED stands */ }
  // Pebble scatter uses the level's true seed — for a net client that is the
  // HOST's seed (adopted at welcome), not this URL's.
  const levelView = buildLevelMeshes(R, level, transport.seed ?? seed);
  const actors = createActors(R);
  const fx = createFx(R, world);

  const sess = {
    transport, localId, level, world, R, levelView, actors, fx,
    prevSnap: null, lastSnap: null,
    acc: 0, lastTime: performance.now(),
    camH: 0.55, roll: 0, bob: 0, fovT: 1.05, fireCd: 0, jetPuffT: 0,
    pump, dispose: null,
  };

  function buildCommand(tick) {
    // While paused in a NET session the sim must keep running for everyone
    // else — send honest idle instead of freezing or leaking menu keystrokes.
    if (state === 'paused') {
      return { tick, playerId: localId, move: { x: 0, z: 0 }, yaw, pitch, buttons: 0 };
    }
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

  function pump() {
    const nowMs = performance.now();
    const dt = Math.min(0.25, (nowMs - sess.lastTime) / 1000);
    sess.lastTime = nowMs;
    // Solo pause freezes the world (classic). A NET session keeps ticking
    // while paused — a paused HOST must not freeze the match for everyone.
    const frozen = state === 'paused' && !transport.netInfo;
    if (!frozen) {
      sess.acc += dt;
      while (sess.acc >= SIM_DT) {
        transport.sendCommand(buildCommand(transport.tickCount));
        transport.tick();
        sess.acc -= SIM_DT;
      }
    }
    return dt;
  }

  transport.onSnapshot((s) => {
    sess.prevSnap = sess.lastSnap; sess.lastSnap = s;
    const me = s.players.find((p) => p.id === localId);
    const prevMe = sess.prevSnap?.players.find((p) => p.id === localId);
    if (me) {
      // hp drop → hurt vignette + sound (renderer never mutates hp)
      if (prevMe && me.hp < prevMe.hp) { fx.hurtFlash(); AudioFX.hurt(); }
      if (prevMe && !(prevMe.flags & FLAG.DASHING) && (me.flags & FLAG.DASHING)) {
        sess.fovT = 1.24; feed('DASH'); AudioFX.dash();
      }
      if (prevMe && !(prevMe.flags & FLAG.SLIDING) && (me.flags & FLAG.SLIDING)) AudioFX.slide();
      // jump: airborne with vy at JUMP minus one gravity tick (≈11.0)
      if (prevMe && !(me.flags & FLAG.GROUNDED)
        && prevMe.vel.y < 10.7 && me.vel.y >= 10.7 && me.vel.y <= TUNE.JUMP + 0.01) {
        AudioFX.jump();
      }
      // walljump: airborne vy snapped to ≈WALLJUMP_UP while a wall was near
      if (prevMe && !(me.flags & FLAG.GROUNDED) && (prevMe.flags & FLAG.WALLNEAR)
        && prevMe.vel.y < 9 && me.vel.y >= 9.4 && me.vel.y <= TUNE.WALLJUMP_UP + 0.01) {
        sess.fovT = 1.16; feed('WALLKICK'); AudioFX.wall();
      }
      if (prevMe) {
        const was = prevMe.flags, is = me.flags;
        if (!(was & FLAG.JETTING) && (is & FLAG.JETTING)) AudioFX.jetStart();
        if ((was & FLAG.JETTING) && !(is & FLAG.JETTING)) AudioFX.jetStop();
        if (!(was & FLAG.GRAPPLING) && (is & FLAG.GRAPPLING)) AudioFX.latch();
        if ((was & FLAG.GRAPPLING) && !(is & FLAG.GRAPPLING)) AudioFX.snap();
      }
      lastFlags = me.flags;
    }
    for (const ev of s.events) {
      const mine = ev.playerId === undefined || ev.playerId === localId;
      if (ev.type === 'pad' && mine) { sess.fovT = 1.20; feed('LAUNCH'); AudioFX.pad(); }
      else if (ev.type === 'ring' && mine) { sess.fovT = 1.26; feed('RING'); AudioFX.ring(); }
      else if (ev.type === 'summit' && mine) { feed('☀ SUMMIT REACHED ☀'); AudioFX.cell(); setTimeout(AudioFX.ring, 200); }
      else if (ev.type === 'death' && mine) { feed('REBOOTED'); AudioFX.hurt(); }
      else if (ev.type === 'pickup' && mine) {
        feed('CELL · TANK +20'); AudioFX.cell();
        if (ev.point) fx.burst(ev.point, '#FFB13D', 8, 4);
      } else if (ev.type === 'hit') {
        if (ev.shooter === localId) { fx.hitmarkFlash(); fx.dmgNum(ev.point, String(ev.dmg), '#FF3D81'); AudioFX.hit(); }
        actors.flash(ev.target);
      } else if (ev.type === 'kill') {
        const pos = actors.positionOf(ev.target) || null;
        if (pos) fx.burst(pos, ENEMY_HEX[ev.kind] || '#7BE3B0', 10, 7);
        if (ev.by === localId) feed('POP!');
        AudioFX.pop();
      } else if (ev.type === 'platform_trigger') {
        AudioFX.crack();
      }
    }
  });

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

  let fpsAcc = 0;
  engine.runRenderLoop(() => {
    if (S !== sess) return; // superseded mid-frame during a handoff
    const dt = pump();
    const now = performance.now() / 1000;
    coyoteT = (lastFlags & FLAG.GROUNDED) ? 0.1 : Math.max(0, coyoteT - dt);
    const alpha = sess.acc / SIM_DT;
    levelView.update(now, dt);

    if (sess.lastSnap) {
      const me = sess.lastSnap.players.find((p) => p.id === localId);
      if (me) {
        const pv = sess.prevSnap?.players.find((p) => p.id === localId) || me;
        const px = pv.pos.x + (me.pos.x - pv.pos.x) * alpha;
        const py = pv.pos.y + (me.pos.y - pv.pos.y) * alpha;
        const pz = pv.pos.z + (me.pos.z - pv.pos.z) * alpha;
        const grounded = !!(me.flags & FLAG.GROUNDED);
        const sliding = !!(me.flags & FLAG.SLIDING);
        const jetting = !!(me.flags & FLAG.JETTING);
        const hSpeed = Math.hypot(me.vel.x, me.vel.z);

        // camera block, ported (prototype 1213–1225)
        if (pv && pv.vel.y < -14 && grounded && !(pv.flags & FLAG.GROUNDED)) { sess.camH = 0.40; AudioFX.land(); }
        const targetH = sliding ? 0.15 : 0.55;
        sess.camH += (targetH - sess.camH) * Math.min(1, 12 * dt);
        const targetRoll = ((me.flags & FLAG.WALLNEAR) && !grounded) ? 0.06 : (-ixNow * 0.018);
        sess.roll += (targetRoll - sess.roll) * Math.min(1, 10 * dt);
        if (grounded && hSpeed > 1 && !sliding) sess.bob += dt * hSpeed * 1.4;
        const bobY = grounded && !sliding ? Math.sin(sess.bob) * 0.03 * Math.min(1, hSpeed / 9) : 0;
        const shake = jetting ? (Math.random() - 0.5) * 0.012 : 0;
        cam.position.set(px + shake, py + sess.camH + bobY + shake, pz);
        cam.rotation.set(pitch, yaw, sess.roll);
        const fovTarget = sliding ? 1.12 : 1.05;
        sess.fovT += (fovTarget - sess.fovT) * Math.min(1, 4 * dt);
        cam.fov += (sess.fovT - cam.fov) * Math.min(1, 10 * dt);

        // fire cosmetics: kick/muzzle/recoil/tracer — damage is the sim's
        sess.fireCd -= dt;
        if (firing && locked && state === 'playing' && sess.fireCd <= 0) {
          sess.fireCd = 0.11;
          fx.fire();
          AudioFX.fire();
          pitch -= 0.004;
          const dir = new BABYLON.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
          const origin = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
          const hit = world.raycast(origin, { x: dir.x, y: dir.y, z: dir.z }, 250);
          const end = hit
            ? new BABYLON.Vector3(hit.point.x, hit.point.y, hit.point.z)
            : cam.position.add(dir.scale(250));
          fx.spawnTracer(fx.muzzleWorld(), end);
          if (hit && !sess.lastSnap.enemies.length) fx.burst(hit.point, '#FFE7B0', 4, 3);
        }

        fx.vig.jet.style.opacity = jetting ? 1 : 0;
        if (jetting) {
          sess.jetPuffT -= dt;
          if (sess.jetPuffT <= 0) { sess.jetPuffT = 0.05; fx.jetPuff({ x: px, y: py, z: pz }); }
        }

        if ((me.flags & FLAG.GRAPPLING) && me.grapple) fx.ropeTo(me.grapple);
        else fx.ropeOff();

        fx.placeShadow('me', { x: px, y: py, z: pz }, 1);
        for (const e of sess.lastSnap.enemies) {
          const p = actors.positionOf(e.id);
          if (p) fx.placeShadow('e' + e.id, { x: p.x, y: p.y, z: p.z }, 0.8);
        }

        actors.sync(sess.prevSnap, sess.lastSnap, alpha, localId, { x: px, y: py, z: pz }, now, dt);
        fx.update(dt, grounded, sess.bob);
        paintHud(me);
      }
    }

    scene.render();
    fpsAcc += dt;
    if (fpsAcc > 0.5) {
      fpsAcc = 0;
      hud.fps.textContent = engine.getFps().toFixed(0);
      hud.meshes.textContent = scene.getActiveMeshes().length;
    }
  });

  S = sess;
  return sess;
}

// ── network orchestration (MD 9) ────────────────────────────────────────────
let pendingNet = null;
let netState = 'connecting'; // connecting | online | offline
let netStatusMsg = '';

async function netAttempt(mode, { joinedNotice } = {}) {
  pendingNet?.dispose();
  netState = 'connecting';
  const { createPhotonTransport } = await import('./net/photon.js');
  const t = createPhotonTransport({
    mode, seedWanted: seed, pvp, verSuffix,
    onStatus: (msg) => { netStatusMsg = msg; },
    onEnded: () => endedFor(t),
  });
  pendingNet = t;
  t.ready.then(() => {
    if (pendingNet !== t) { t.dispose(); return; } // superseded by a newer attempt
    pendingNet = null;
    netState = 'online';
    startSession(t);
    const ni = t.netInfo;
    feed(joinedNotice || (ni?.isHost ? `HOSTING ${ni.room}` : `JOINED ${ni.room}`));
  }).catch(() => {
    if (pendingNet === t) {
      pendingNet = null;
      // Solo keeps playing — a network problem never blanks the game. Small
      // OFFLINE marker in the readout; no modal, no blocking retry.
      if (netState !== 'online') netState = 'offline';
    }
  });
}

// The active match's transport died (host left, or the connection dropped):
// bounce to a fresh solo world INSTANTLY, tell the player, and rejoin a new
// public room in the background. Not host migration — v1 behaviour on record.
function endedFor(t) {
  if (!S || S.transport !== t) return; // stale callback from a replaced session
  feed('HOST LEFT — REJOINING');
  startSession(createLoopbackTransport(seed, { pvp }));
  netAttempt({ kind: 'public' }, { joinedNotice: 'REJOINED — NEW MATCH' });
}

// Menu-driven room moves (pause menu dispatches these).
window.addEventListener('arena1-join-room', (e) => {
  const code = String(e.detail || '').trim();
  if (!code) return;
  feed(`JOINING ${code}…`);
  netAttempt({ kind: 'named', room: code }, { joinedNotice: `JOINED ${code}` });
});
window.addEventListener('arena1-new-private', async () => {
  const { genRoomCode } = await import('./net/photon.js');
  const code = genRoomCode();
  feed(`PRIVATE ROOM ${code}…`);
  netAttempt({ kind: 'named', room: code }, { joinedNotice: `PRIVATE ROOM ${code}` });
});

// ── boot ────────────────────────────────────────────────────────────────────
// Loopback world immediately — playable before the first network packet —
// then hand off to the match when it is ready. ?room= keeps its meaning
// (same mechanism as private codes); default is the public pool.
startSession(createLoopbackTransport(seed, { pvp }));
netAttempt(roomParam ? { kind: 'named', room: roomParam } : { kind: 'public' });

// Embed hooks (contract #3) — exact names, wired to the state machine.
window.Arena1 = {
  pause() {
    if (state !== 'playing') return;
    try { document.exitPointerLock?.(); } catch { /* not locked */ }
    setState('paused');
  },
  resume() {
    if (state !== 'paused') return;
    AudioFX.ensure();
    setState('playing');
    requestLock(8);
  },
  setSafeTop(px) {
    document.documentElement.style.setProperty('--safe-top', `${px}px`);
  },
  // Pause-menu surface (MD 9): the current room, headcount, and net state.
  room() {
    const ni = S?.transport.netInfo || null;
    return {
      code: ni?.room ?? null,
      players: ni?.players ?? 1,
      isHost: ni ? ni.isHost : true,
      netState,
    };
  },
};

// Dev readout: tick + seed prove the accumulator runs at sim rate; the net
// suffix shows room/role/headcount (the unobtrusive player count), and the
// solo fallback marks itself OFFLINE without ever blocking play.
const boot = document.getElementById('hud-boot');
setInterval(() => {
  if (!boot || !S?.lastSnap) return;
  const ni = S.transport.netInfo;
  const pr = S.transport.prediction; // MD 8 correction telemetry, client only
  boot.textContent = `ARENA 1 · seed ${S.lastSnap.seed} · tick ${S.lastSnap.tick}`
    + (ni ? ` · ${ni.room} · ${ni.isHost ? 'HOST' : 'CLIENT'} · ${ni.players}P` : '')
    + (!ni && netState === 'connecting' ? ` · ${netStatusMsg || 'finding match…'}` : '')
    + (!ni && netState === 'offline' ? ' · OFFLINE' : '')
    + (pr ? ` · corr ${pr.corrections} (max ${pr.maxCorrection.toFixed(2)}m)` : '');
}, 250);
