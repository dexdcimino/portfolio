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
import { createSerpentView } from './render/serpent.js';
// segAt for the death FX: the blast chain uses the SAME closed form the
// renderer draws with, so explosions land on the segments, not near them.
import { segAt } from './sim/serpent.js';
import { AudioFX } from './systems/audio.js';
// One accent table for the whole client (MD 14 note in render/actors.js) — the
// leaderboard dots must be the same colours the pills wear, not a second copy.
import { SITE_ACCENTS } from './pausemenu.js';

const canvas = document.getElementById('game');
const params = new URLSearchParams(location.search);
// ?serpent=low — debug: drop all three serpent tiers into one low band so
// they can be inspected from the floor. Nothing else changes.
const serpentLow = params.get('serpent') === 'low';
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

// Embedded in the /arena1 wrapper: its exit chip owns the top-right corner
// (48px at 14px insets — a 62px square). The HUD lays out clear of it via
// --safe-right; standalone tabs keep the full corner.
if (window.self !== window.top) {
  document.documentElement.style.setProperty('--safe-right', '64px');
}

// ── global UI state ─────────────────────────────────────────────────────────
const pausedEl = document.getElementById('paused');
const hintEl = document.getElementById('lockHint');
const feedEl = document.getElementById('feed');
let state = 'playing'; // playing ⇄ paused; no title screen

/* MD 23 — CONTROLS MODAL. This supersedes MD 22 item 8 (a pulled-back camera
   that eased into the player's eyes) and, with it, the last of MD 20's orbit
   flyover. Both are gone rather than left dormant.
   Pointer lock requires a user gesture and no browser will give it up. Two
   earlier passes treated that as a barrier to disguise. This one spends it:
   the gesture buys the five controls a player needs in their first ten
   seconds, and the SAME action that reads them enters the game.
   Consequences that shape the code below:
     · the camera NEVER moves for the boot. The view behind the modal is the
       player's own spawn view, so dismissing is a fade, not a transition —
       and something that does not move cannot be a cut;
     · dismissal has to happen INSIDE the gesture handler. requestPointerLock
       is only honoured from a live user gesture, so hiding the modal and
       asking for lock are one call, not a hide that schedules a lock;
     · a movement key that dismisses must still MOVE. keydown fills keys[]
       before any modal or lock guard, so W dismisses and walks in one press;
     · it is page-load only. Respawning keeps lock, so there is no gesture to
       recover and no reason to interrupt play. `booted` is module scope and a
       session swap never resets it. */
let booted = false;          // the modal has been dismissed
/* Work that must not happen behind the modal (MD 25 item 4). A match handoff
   swaps the world and the spawn; doing that while the player is reading the
   controls looks exactly like the game resetting itself. Only the newest is
   kept — two matches cannot both be joined, and replaying a stale one would
   put the player somewhere they already left. */
let deferredBoot = null;
function deferToBoot(fn) { deferredBoot = fn; }
const controlsX = document.getElementById('controlsX');

let S = null;          // the active session (see startSession)

function feed(msg) {
  const el = document.createElement('div');
  el.className = 'feedMsg';
  el.textContent = msg;
  feedEl.appendChild(el);
  setTimeout(() => el.remove(), 1150);
}
/* ── MD 25 item 2: leaderboard ──────────────────────────────────────────────
   Painted from the SNAPSHOT, which is the only place that knows who is really
   in the lobby right now — so joins, leaves and renames need no bookkeeping
   here at all, they simply appear on the next frame the board is up.
   Held rather than toggled: a board you hold cannot be left up by accident,
   and with the game still live underneath (Tab does not pause) an accidental
   overlay is a genuine hazard, not just clutter.
   Repainted only while visible: this runs at frame rate and there is no point
   rebuilding rows nobody is looking at. */
const boardEl = document.getElementById('board');
const boardRowsEl = document.getElementById('boardRows');
const BOARD_HEX = new Map(SITE_ACCENTS.map((a) => [a.name, a.hex]));
let boardOn = false;
function setBoard(on) {
  if (boardOn === on) return;          // keydown repeats while held
  boardOn = on;
  document.body.classList.toggle('board', on);
  boardEl?.setAttribute('aria-hidden', on ? 'false' : 'true');
  if (on) paintBoard();
}
function paintBoard() {
  if (!boardOn || !boardRowsEl) return;
  const snap = S?.lastSnap;
  const me = S?.localId;
  const players = [...(snap?.players ?? [])]
    // Kills first, then fewest deaths — the ordering a scoreboard implies.
    .sort((a, b) => (b.kills ?? 0) - (a.kills ?? 0) || (a.deaths ?? 0) - (b.deaths ?? 0));
  if (!players.length) {
    // Solo before the first snapshot: a row-less board still beats a key that
    // appears to do nothing (MD 25 item 2).
    boardRowsEl.innerHTML = '<div id="boardEmpty">CONNECTING…</div>';
    return;
  }
  boardRowsEl.textContent = '';
  for (const p of players) {
    const row = document.createElement('div');
    row.className = 'boardRow' + (p.id === me ? ' is-me' : '');
    const name = document.createElement('span');
    name.className = 'boardName';
    const dot = document.createElement('span');
    dot.className = 'boardDot';
    dot.style.background = BOARD_HEX.get(p.accent) || '#FF7A59';
    const tag = document.createElement('span');
    tag.className = 'boardTag';
    // Tag can be absent for a player who has not announced yet — show the id
    // rather than an empty row, so somebody mid-join is still visibly present.
    tag.textContent = p.tag || `P${p.id}`;
    name.append(dot, tag);
    const cell = (v) => { const e = document.createElement('span'); e.textContent = String(v ?? 0); return e; };
    row.append(name, cell(p.kills), cell(p.deaths), cell(p.cellsGot));
    boardRowsEl.appendChild(row);
  }
}

function updateHint() {
  // The in-match "you lost lock" line. Never while the modal is up: the modal
  // already owns the screen, and two prompts at once is one too many.
  hintEl.classList.toggle('on', booted && state === 'playing' && document.pointerLockElement !== canvas);
}
function updateBootChrome() {
  // `booting` dims the HUD behind the modal and hides the cursor.
  document.body.classList.toggle('booting', !booted);
}

/* The one place the modal is dismissed. MUST be called synchronously from a
   real user gesture — requestPointerLock is rejected otherwise, and then the
   modal is gone with no lock to show for it, which is the worst outcome of
   the three. Idempotent: several handlers can race to call it. */
function dismissControls() {
  if (booted) return false;
  booted = true;
  updateBootChrome();
  updateHint();
  AudioFX.ensure();            // the same gesture unlocks the AudioContext
  if (deferredBoot) { const fn = deferredBoot; deferredBoot = null; fn(); }
  if (state === 'playing' && !locked) requestLock(2);
  return true;
}
function setState(s) {
  state = s;
  pausedEl.classList.toggle('hidden', s !== 'paused');
  updateHint();
  if (s !== 'playing') AudioFX.jetStop();
  if (S) { S.acc = 0; S.lastTime = performance.now(); } // no catch-up burst
}
updateHint();
updateBootChrome();

// ── global input state ──────────────────────────────────────────────────────
let yaw = Math.PI, pitch = 0;      // local, render-rate; persists across sessions
let locked = false;
const keys = {};
let firing = false, grappling = false;
let jetLatch = false;              // Space pressed mid-air with no coyote/wall
let jumpEdge = false, dashEdge = false, respawnEdge = false;
let coyoteT = 0;                   // client-side mirror for the Space policy
let lastFlags = 0;
let ixNow = 0;                     // strafe input, for camera roll
let weaponSel = 0;                 // MD 11: 0 zap, 1 rocket — rides every command

// requestPointerLock returns a Promise in current Chrome and rejects without
// a user gesture and during the ~1.25s cooldown after an Escape-triggered
// exit. Resume paths pass retries: the request is re-attempted every 300ms
// until it lands, the chain caps out, or the state changes — so resuming
// puts you straight back in first-person control instead of leaving a
// cursor. (Chrome permits gesture-less relock after a prior successful lock
// once the cooldown expires; the first-ever lock still needs the click.)
/* Reverted to the cadence that stood unchanged from the commit that
   introduced it through MD 8, 9, 10, 11, 20, 22 and 23. I retuned it to 40ms
   on the strength of a "1304ms -> 1124ms" reading that turned out to be
   scheduling noise: headless Chrome enforces NO post-Escape cooldown at all
   (measured — 0ms, one try, at every cadence tried), so that harness could
   never have been measuring the thing I claimed. With no evidence of benefit
   and a real downside — 50 refused requests in two seconds, each one a console
   error — the unjustified change goes. The actual fix for resume latency is
   Escape is a browser rule; MD 25 keeps it as the only pause and gives Tab
   to the leaderboard instead, which needs no lock change at all. */
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
/* "Any click" means any click, including one that lands on the modal itself —
   which sits above the canvas and would otherwise swallow it. Capture phase on
   the window, so it runs before anything can stop propagation. */
window.addEventListener('pointerdown', () => { dismissControls(); }, true);
// The X is an affordance for anyone who goes looking for one. It does exactly
// what every other input does, including taking the lock — closing the modal
// without it would leave a cursor on a live game.
controlsX?.addEventListener('click', (e) => { e.stopPropagation(); dismissControls(); });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) {
    // Locking no longer ends the boot — the boot ends itself. An early click
    // just captures the mouse; the pull-in carries on underneath, and if the
    // player was already holding a key they were already moving.
    if (state !== 'playing') setState('playing');
  } else {
    firing = false; grappling = false; jetLatch = false;
    if (state === 'playing') setState('paused'); // Escape (or focus loss) pauses
  }
  updateHint();
});
/* Every mouse handler now checks `state` as well as `locked`. It did not have
   to before, because pausing always dropped the lock and `locked` alone was
   enough. They stay because they state the invariant directly: nothing the
   mouse does may reach the game unless the game is actually running. */
/* The `state` checks stay even though pausing always drops the lock again —
   they are the invariant, not a workaround, and they cost one comparison. The
   mouse-travel lock release that used to live here is GONE: it existed only to
   hand the cursor back during a Tab pause, and with Tab no longer pausing
   there is nothing for it to do. */
document.addEventListener('mousemove', (e) => {
  if (!locked || state !== 'playing') return;
  yaw += e.movementX * TUNE.SENS;
  pitch = Math.max(-1.5, Math.min(1.5, pitch + e.movementY * TUNE.SENS));
});
document.addEventListener('mousedown', (e) => {
  if (!locked || state !== 'playing') return;
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
  /* keys[] is filled BEFORE the modal is dismissed and before the lock guard
     below, which is the whole reason pressing W both closes the modal and
     starts you walking: movement reads keys[] every frame and does not care
     whether the mouse is captured. Swallowing the key here would make the
     first press of the game do nothing. */
  keys[e.code] = true;
  // Any keypress dismisses — Escape included, since with no lock to release it
  // would otherwise be the one key that leaves a player stuck on the modal.
  dismissControls();
  // Escape while paused resumes (keydown is a user gesture, so the pointer
  // lock request is allowed to succeed here).
  if (e.code === 'Escape' && state === 'paused') { window.Arena1.resume(); return; }
  /* MD 25 item 2 — TAB IS THE LEADERBOARD. It briefly paused the game (MD's
     predecessor) because Tab is the one key that never touches pointer lock;
     that property is still why it is the right key, but a second way to pause
     was worse than one obvious way, so Escape is the only pause again.
     Held, not toggled: a scoreboard you hold is one you cannot leave up by
     accident, and it costs no second press to put away — which matters when
     the game is still running underneath and something is shooting at you.
     preventDefault because Tab is focus navigation; unhandled it walks focus
     out of the canvas and into the wrapper.
     Deliberately does NOT touch pointer lock, pause, or the sim. */
  if (e.code === 'Tab') {
    e.preventDefault();
    setBoard(true);
    return;
  }
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
  // MD 11: 1/2 select weapons. The quality hotkeys they displace retire —
  // quality lives in the pause menu (still synced both ways there).
  if (e.code === 'Digit1') weaponSel = 0;
  if (e.code === 'Digit2') weaponSel = 1;
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') { e.preventDefault(); setBoard(false); }
  if (e.code === 'Space') jetLatch = false;
});

// Quality: persisted; the pause menu owns it now (MD 11 gave the 1/2 keys to
// weapon selection). The menu hands changes over by event; re-applied per
// session build.
window.addEventListener('arena1-quality', (e) => S?.R.setQuality(e.detail));
// Accent swatch clicked mid-match → the grapple rope retints live (MD 13).
// detail is {name, hex} since MD 14 — the transport's listener takes the name.
window.addEventListener('arena1-accent', (e) => S?.fx.setRopeColor(e.detail.hex));

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

  weaponSel = 0; // a new match starts on zap (MD 11)
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
  const serpents = createSerpentView(R);
  /* Visible BEHIND the modal too. The earlier boots hid it because the camera
     was somewhere else and a floating gun would have looked wrong; this one is
     already the player's own view, so hiding it would mean the gun pops into
     existence on dismissal — a change in the world at the exact moment the
     MD asks for none. The only thing that changes is the modal fading. */
  fx.setViewmodelVisible(true);

  const sess = {
    transport, localId, level, world, R, levelView, actors, fx,
    prevSnap: null, lastSnap: null,
    acc: 0, lastTime: performance.now(),
    camH: 0.55, roll: 0, bob: 0, fovT: 1.05, fireCd: 0, jetPuffT: 0, trailT: 0,
    pump, dispose: null,
  };

  // Rope accent (MD 13): local presentation only — the accent never rides the
  // wire from here (the remote-visuals MD owns that transport). The CSS var is
  // set by pausemenu at boot and on every swatch click; the arena1-accent
  // event covers mid-match changes.
  {
    const hex = getComputedStyle(document.documentElement)
      .getPropertyValue('--cmenu-accent').trim();
    if (hex) fx.setRopeColor(hex);
  }

  function buildCommand(tick) {
    // While paused in a NET session the sim must keep running for everyone
    // else — send honest idle instead of freezing or leaking menu keystrokes.
    if (state === 'paused') {
      return { tick, playerId: localId, move: { x: 0, z: 0 }, yaw, pitch, buttons: 0, weapon: weaponSel };
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
      | (jetLatch ? BTN.JET : 0)
      | (respawnEdge ? BTN.RESPAWN : 0)
      /* MD 25 item 5. Told to the host every tick a menu is open, so its
         enemies stop treating this player as a target. Only meaningful in a
         net session — solo already freezes the whole sim — but it is sent
         unconditionally because the same command builder feeds both, and a
         branch here would be one more thing to get wrong on the path that
         matters. */
      | (state === 'paused' ? BTN.PAUSED : 0);
    jumpEdge = false; dashEdge = false; respawnEdge = false;
    return { tick, playerId: localId, move: { x: ix, z: iz }, yaw, pitch, buttons, weapon: weaponSel };
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
      else if (ev.type === 'death' && mine) {
        // MD 11: a self-kill reads as one — never as an enemy kill
        feed(ev.by === localId ? 'SELF-DESTRUCT' : 'REBOOTED');
        AudioFX.hurt();
      }
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
      } else if (ev.type === 'fire') {
        // MD 14: every shot travels, hit or miss — this is what makes remote
        // weapons flash when they MISS. Own shots are skipped: the local
        // viewmodel already flashed on the press, ahead of authority.
        if (ev.playerId !== localId && ev.origin) {
          const dist = me ? Math.hypot(ev.origin.x - me.pos.x, ev.origin.y - me.pos.y, ev.origin.z - me.pos.z) : 30;
          if (ev.weapon === 1) {
            // launcher: launch flash + thump — the rocket entity itself is
            // already in the snapshot, so no tracer
            fx.puff(ev.origin, 0.4, 1.2, 0.16, 0.9, 0, '#FFB13D');
            AudioFX.launchAt(dist);
          } else {
            fx.puff(ev.origin, 0.22, 0.55, 0.1, 0.9, 0, '#FFE7B0');
            const o = new BABYLON.Vector3(ev.origin.x, ev.origin.y, ev.origin.z);
            const d = new BABYLON.Vector3(ev.dir.x, ev.dir.y, ev.dir.z);
            const hit = world.raycast(ev.origin, ev.dir, 250);
            const end = hit ? new BABYLON.Vector3(hit.point.x, hit.point.y, hit.point.z) : o.add(d.scale(250));
            fx.spawnTracer(o.add(d.scale(0.7)), end);
            AudioFX.fireAt(dist);
          }
        }
      } else if (ev.type === 'explode') {
        if (ev.point) {
          // MD 13 two-layer explosion: bright core bounded at the true splash
          // radius + big transparent falloff; debris bursts ride on top.
          fx.explosion(ev.point);
          fx.burst(ev.point, '#FF7A59', 14, 14);
          fx.burst(ev.point, '#FFE7B0', 8, 9);
        }
        AudioFX.boom();
      } else if (ev.type === 'serpent_sever') {
        /* MD 24. These two events have been on the wire since MD 18 with
           NOTHING drawing them — spheres popped off in silence and a serpent
           died by quietly ceasing to be rendered. Killing the giant is a 25s
           fight and it had no payoff at all.
           Scale comes from the serpent's own tier, so a giant's destruction is
           physically bigger rather than merely louder. */
        if (ev.point) {
          const sv = sess.lastSnap?.serpents?.find((q) => q.id === ev.serpentId);
          /* MD 26: a double-pop reads at 1.7x and gets its own bright crack on
             top of the boom. The tell rides the FIRST sever of the pair only —
             `pair` marks the second, which blows up normally at its own
             position so the two spheres visibly go together rather than one
             oversized blast landing between them. */
          fx.serpentPop(ev.point, (sv?.scale ?? 1) * (ev.double ? 1.7 : 1));
          AudioFX.boom();
          if (ev.double) AudioFX.crit();
        }
      } else if (ev.type === 'serpent_death') {
        if (ev.point) {
          /* The blasts walk down the BODY, not just the head — a serpent dies
             along its whole length. Positions come from the same closed form
             the renderer draws with, so the chain of explosions lands exactly
             where the segments were rather than approximately near them. */
          const sv = sess.lastSnap?.serpents?.find((q) => q.id === ev.serpentId);
          const body = [];
          if (sv?.path) {
            for (let i = 0; i < (sv.len ?? 1); i++) body.push(segAt(sv.path, sess.lastSnap.tick, i));
          }
          fx.serpentDeath(ev.point, sv?.scale ?? 1, body);
          AudioFX.boom();
        }
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
    wSlot0: document.getElementById('wSlot0'), wSlot1: document.getElementById('wSlot1'),
    wGrap: document.getElementById('wGrap'),
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
    // MD 13 weapon HUD — me is the PREDICTED snapshot entry, so this flips on
    // the same frame as the 1/2 press for host and net client alike (the
    // command applies to the local predicted sim inside this frame's pump).
    const w = me.weapon ?? 0;
    hud.wSlot0.classList.toggle('on', w === 0);
    hud.wSlot1.classList.toggle('on', w === 1);
    hud.wGrap.classList.toggle('on', !!(me.flags & FLAG.GRAPPLING));
  }

  let fpsAcc = 0;

  engine.runRenderLoop(() => {
    if (S !== sess) return; // superseded mid-frame during a handoff
    const dt = pump();
    if (boardOn) paintBoard();     // only while it is actually on screen
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
        const camX = px + shake, camY = py + sess.camH + bobY + shake, camZ = pz;
        /* One camera, always the player's. MD 20's orbit and MD 22's pull-in
           both lived here; MD 23 retires them, because a boot the player
           dismisses instantly must not be mid-move when they do. Nothing to
           blend out of means nothing that can be interrupted badly. */
        cam.position.set(camX, camY, camZ);
        cam.rotation.set(pitch, yaw, sess.roll);
        const fovTarget = sliding ? 1.12 : 1.05;
        sess.fovT += (fovTarget - sess.fovT) * Math.min(1, 4 * dt);
        cam.fov += (sess.fovT - cam.fov) * Math.min(1, 10 * dt);

        // fire cosmetics: kick/muzzle/recoil — damage is the sim's. The
        // viewmodel and cadence follow the PREDICTED weapon (same-frame).
        fx.setWeapon(me.weapon ?? 0);
        sess.fireCd -= dt;
        if (firing && locked && state === 'playing' && sess.fireCd <= 0) {
          if ((me.weapon ?? 0) === 1) {
            // the rocket itself is authoritative — it appears via snapshots
            sess.fireCd = 0.8;
            fx.fire();
            AudioFX.launch();
            pitch -= 0.008;
          } else {
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
        }

        fx.vig.jet.style.opacity = jetting ? 1 : 0;
        if (jetting) {
          sess.jetPuffT -= dt;
          if (sess.jetPuffT <= 0) { sess.jetPuffT = 0.05; fx.jetPuff({ x: px, y: py, z: pz }); }
        }

        // Rocket exhaust trails (MD 13): a dotted smoke line behind every live
        // rocket — local and remote read the same snapshot list, so both see
        // where a rocket came from. Spawned behind the nose so the model stays
        // clear of its own smoke.
        sess.trailT -= dt;
        if (sess.trailT <= 0 && sess.lastSnap.rockets?.length) {
          sess.trailT = 0.035;
          for (const r of sess.lastSnap.rockets) {
            const sp = Math.max(1e-6, Math.hypot(r.vel.x, r.vel.y, r.vel.z));
            fx.trailPuff({
              x: r.pos.x - r.vel.x / sp * 0.4,
              y: r.pos.y - r.vel.y / sp * 0.4,
              z: r.pos.z - r.vel.z / sp * 0.4,
            });
          }
        }

        if ((me.flags & FLAG.GRAPPLING) && me.grapple) fx.ropeTo(me.grapple);
        else fx.ropeOff();

        fx.placeShadow('me', { x: px, y: py, z: pz }, 1);
        for (const e of sess.lastSnap.enemies) {
          const p = actors.positionOf(e.id);
          if (p) fx.placeShadow('e' + e.id, { x: p.x, y: p.y, z: p.z }, 0.8);
        }

        actors.sync(sess.prevSnap, sess.lastSnap, alpha, localId, { x: px, y: py, z: pz }, now, dt);
        // Serpent bodies are rebuilt locally from the snapshot's path
        // parameters — no segment positions come over the wire.
        serpents.sync(sess.lastSnap?.serpents, sess.lastSnap?.tick ?? 0, sess.lastSnap?.bolts);
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
    /* MD 25 item 4 — THE BOOT RESET, diagnosed.
       Nothing was spawning the player twice and the level was not rebuilding.
       The sequence at the bottom of this file is:
           startSession(createLoopbackTransport(...))   // solo world, spawn A
           netAttempt({ kind: 'public' })               // ...connects...
           startSession(photonTransport)                // match world, spawn B
       That second startSession is a whole new sim with the HOST's seed, so a
       different level and a different spawn. It is correct — it is how joining
       a match works — but it lands whenever Photon happens to answer, which on
       a first load is squarely while the controls modal is still up. The
       player reads the modal, the world silently swaps underneath them, and it
       looks like the game reset itself.
       The fix is ordering, not suppression: hold the swap until the modal is
       dismissed. Before dismissal the player is placed exactly once and stays
       there; after it, the handoff is something they can see happen, with its
       own JOINED line. Nothing is dropped — the transport is already connected
       and buffering, it is only the visible swap that waits. */
    const land = () => {
      if (S === null && pendingNet !== t) return;   // superseded while waiting
      startSession(t);
      const ni = t.netInfo;
      feed(joinedNotice || (ni?.isHost ? `HOSTING ${ni.room}` : `JOINED ${ni.room}`));
      publishRoomToShell(ni);
    };
    if (booted) land();
    else deferToBoot(land);
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
  startSession(createLoopbackTransport(seed, { pvp, serpentLow }));
  netAttempt({ kind: 'public' }, { joinedNotice: 'REJOINED — NEW MATCH' });
}

/* Tell the /arena1 wrapper which room we are in so it can put it in the
   address bar. The game is in an iframe, so it cannot move the address bar
   itself — the wrapper listens for this and replaceState's.

   PRIVATE ROOMS ONLY, deliberately. A public room is a matchmaking slot, not a
   destination: the code changes as rooms fill and rotate, so a public URL is a
   link to a lobby that is very likely full or gone by the time anyone opens
   it, and refreshing would pin you to one specific public room instead of
   matchmaking you into a live one — strictly worse than the default. The right
   share for a public game is /arena1 with no room at all, which is what you
   get by not touching the URL. */
function publishRoomToShell(ni) {
  if (!ni?.room || ni.isPublic) return;
  if (window.parent === window) return;         // opened directly, no shell
  try {
    window.parent.postMessage({ type: 'arena1-room', room: ni.room }, window.location.origin);
  } catch { /* no shell to tell */ }
}

// Menu-driven room moves (pause menu dispatches these).
window.addEventListener('arena1-join-room', (e) => {
  const code = String(e.detail || '').trim();
  if (!code) return;
  feed(`JOINING ${code}…`);
  netAttempt({ kind: 'named', room: code }, { joinedNotice: `JOINED ${code}` });
});
window.addEventListener('arena1-new-private', () => {
  // The transport picks the lobby word (and rerolls on collision) — the
  // joined notice carries whatever word it landed on.
  feed('NEW PRIVATE LOBBY…');
  netAttempt({ kind: 'create' });
});
window.addEventListener('arena1-go-public', () => {
  feed('JOINING PUBLIC LOBBY…');
  netAttempt({ kind: 'public' });
});

// ── boot ────────────────────────────────────────────────────────────────────
// Loopback world immediately — playable before the first network packet —
// then hand off to the match when it is ready. ?room= keeps its meaning
// (same mechanism as private codes); default is the public pool.
startSession(createLoopbackTransport(seed, { pvp, serpentLow }));
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
  // Pause-menu respawn. Latches an input edge rather than moving the player:
  // the sim applies BTN.RESPAWN on a tick every peer agrees about, so this can
  // never desync a match. Consumed by the next command, then cleared.
  respawn() {
    if (state !== 'playing' && state !== 'paused') return;
    respawnEdge = true;
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
      isPublic: ni?.isPublic ?? null, // null = not in a Photon room (solo)
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
