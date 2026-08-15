// ══════════════════════════════════════════════════════
//  dexnote — PLAY MODE / OPEN WORLD MODULE
// ══════════════════════════════════════════════════════

import { initPhoton, destroyPhoton, photonSendState, photonSendDamage, photonSendTankState, photonSendProjectile, photonIsConnected, photonGetMyId, photonGetPlayerCount, photonChangeRoom, setPhotonStatus } from './photon-client.js';
import { MULTIPLAYER, ROOM_ID } from './config.js';
import { getAccent } from './accent.js';
import { loadWorld, saveWorld, safeStorage } from './storage.js';
import { sfx, sfxHold, sfxSetListener } from './audio.js';
import { initPauseMenu, openPauseMenu, closePauseMenu, isPauseMenuOpen } from './pausemenu.js';

// Photon SDK loader
const PHOTON_CDN = './public/photon-realtime-module.js';
function _loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}
async function _ensurePhoton() {
  if (window.Photon) return;
  console.log('[mp] loading Photon SDK from', PHOTON_CDN);
  try {
    await _loadScript(PHOTON_CDN);
    if (!window.Photon) throw new Error('window.Photon undefined after script load');
    console.log('[mp] Photon SDK loaded OK');
  } catch (err) {
    console.error('[mp] FATAL: Photon SDK failed to load:', err.message);
    throw err;
  }
}

let _active = false;
let _entering = false;
let _exiting = false;
let _dt = 1; // delta-time multiplier, set each frame from character.js
// The accent is no longer frozen on entry — accent.js keeps --clr/--clr-adj
// live from the host page's --accent, and the world re-reads it every frame.

// Carry creature bridge — find and prepare a yak for carrying
window._dexFindNearbyLootable = function(range) {
  for (const c of _liveCreatures) {
    if (!c.dead || c._looted) continue;
    if (c.kind !== 'bird' && c.kind !== 'yak' && c.kind !== 'deer') continue;
    const dist = Math.hypot(_charWorldX - c.x, _charWorldY - c.y);
    if (dist < range * 2) return c;
  }
  return null;
};
window._dexCarryCreature = function(screenRange) {
  // Find nearest yak within range (use actual character world position)
  const range = screenRange * 3;
  let best = null, bestDist = Infinity;
  for (const c of _liveCreatures) {
    if (c.dead || c._carried) continue;
    if (c.kind !== 'yak' && c.kind !== 'deer') continue;
    const d = Math.hypot(_charWorldX - c.x, _charWorldY - c.y);
    if (d < range && d < bestDist) { best = c; bestDist = d; }
  }
  if (!best) return null;
  // Mark as carried so it's not drawn on canvas
  best._carried = true;
  // Create a temporary DOM element with yak SVG for the carry system
  const ns = 'http://www.w3.org/2000/svg';
  const el = document.createElement('div');
  el.style.display = 'none';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 32 24');
  svg.setAttribute('width', '32'); svg.setAttribute('height', '24');
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('stroke', 'var(--clr-adj,#7B8A9C)');
  g.setAttribute('stroke-width', '1.8');
  g.setAttribute('stroke-linecap', 'round');
  g.setAttribute('fill', 'none');
  g.innerHTML = '<ellipse cx="16" cy="10" rx="11" ry="5" fill="var(--bg)"/><circle cx="28" cy="7" r="3.5" fill="var(--bg)"/><path d="M28,4 Q32,0 30,-2" stroke-width="1.5"/><path d="M29,5 Q34,2 33,0" stroke-width="1.5"/><line x1="8" y1="14" x2="8" y2="22" stroke-width="1.8"/><line x1="13" y1="14" x2="13" y2="22" stroke-width="1.8"/><line x1="19" y1="14" x2="19" y2="22" stroke-width="1.8"/><line x1="24" y1="14" x2="24" y2="22" stroke-width="1.8"/>';
  svg.appendChild(g);
  el.appendChild(svg);
  document.body.appendChild(el);
  best.el = el;
  best.g = g;
  best._pmCreature = true; // flag so drop knows to clean up
  return best;
};
// Allow session color changes to propagate into play mode
window._dexEnterPlayMode = function() {
  if (_active || _entering || _exiting) return;
  enterPlayMode();
};
// window._dexUpdatePlayModeColor is gone — accent.js watches --accent and
// repaints on its own. See onAccentChange() there.
window._dexGetChatCursorPos = function() {
  if (!_chatOpen&&!_chatTyping) return null;
  return { x: _chatCursorScreenX, y: _chatCursorScreenY };
};
let _playCameraMode = 'follow'; // 'deadzone' | 'follow'
export function setPlayCameraMode(mode) {
  _playCameraMode = (mode === 'follow') ? 'follow' : 'deadzone';
  _showCameraToast(_playCameraMode);
}
let _keybinds = { 'lock-camera': 'Y' };
export function setKeybind(action, key) { _keybinds[action] = key.toUpperCase(); }

function _showCameraToast(mode) {
  document.getElementById('camera-mode-toast')?.remove();
  const toast = document.createElement('div');
  toast.id = 'camera-mode-toast';
  toast.textContent = mode === 'follow' ? '📷 Camera Lock On' : '📷 Camera Lock Off';
  toast.style.cssText = 'position:fixed;bottom:20%;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;font-family:var(--fn);font-size:12px;font-weight:600;padding:6px 14px;border-radius:20px;pointer-events:none;z-index:300;opacity:1;transition:opacity 0.4s ease;';
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; }, 1400);
  setTimeout(() => toast.remove(), 1900);
}
let _worldCanvas = null;
let _worldCtx = null;
let _worldFrontCanvas = null;
let _worldFrontCtx = null;
let _camera = { x: 3600, y: 2250 };
let _cameraTarget = { x: 3600, y: 2250 };

// ── Screen shake (MD 04) ──
// A decaying amplitude drives a per-frame random offset applied in
// worldToScreen at draw time — _camera itself is never touched, so the
// follow/deadzone logic can't drift. screenToWorld deliberately ignores
// the offset: mouse aim stays stable while the view rattles.
let _shakeAmp = 0, _shakeOX = 0, _shakeOY = 0;
const SHAKE_MAX = 12;
function _addShake(amp) {
  _shakeAmp = Math.min(Math.max(_shakeAmp, amp), SHAKE_MAX);
}
function _tickShake() {
  const scale = (typeof window._dexShakeScale === 'number') ? window._dexShakeScale : 1;
  if (_shakeAmp > 0.05 && scale > 0) {
    _shakeOX = (Math.random() * 2 - 1) * _shakeAmp * scale;
    _shakeOY = (Math.random() * 2 - 1) * _shakeAmp * scale;
  } else {
    _shakeOX = 0; _shakeOY = 0;
  }
  _shakeAmp = _shakeAmp > 0.05 ? _shakeAmp * Math.pow(0.88, _dt) : 0;
}

// Zoom — 1.0 = default (fully zoomed out), 1.5 = max zoom in (50% closer)
let _zoom = 1.0;
const _ZOOM_MIN = 1.0;
const _ZOOM_MAX = 1.5;
const _ZOOM_STEP = 0.05;
const _ZOOM_LERP = 0.12;   // smoothing speed
let _zoomTarget = 1.0;
let _worldObjects = [];
let _rafId = null;
let _charWorldX = 3600;
let _charWorldY = 2250;
let _worldLoaded = false;

// Photon state bridge — read by the send loop in photon-client.js
window._dexGetPlayState = function() {
  if (!_active) return null;
  const username = 'Player';
  const hex = getComputedStyle(document.documentElement).getPropertyValue('--clr').trim() || '#7B8A9C';
  const cs = window._dexGetCharState?.() || {};
  return {
    x: _charWorldX, y: _charWorldY,
    animState: cs.animState || 'idle', phase: cs.phase || 0, flipX: cs.flipX || false,
    vy: cs.vy || 0, chargeT: cs.chargeT || 0, stunSev: cs.stunSev || 0, hoverboard: cs.hoverboard || false,
    weapon: cs.equip || 'none', username, hex,
  };
};

window._dexBroadcastProjectile = function(wx, wy, vx, vy, type) {
  if (!MULTIPLAYER) return;
  photonSendProjectile(wx, wy, vx, vy, type);
};
window._dexGetTankState = function() {
  if (!_active) return null;
  const tankObj = _worldObjects.find(o => o.type === 'tank');
  return { inTank: _inTank, tankX: tankObj?.x || 0, tankY: tankObj?.y || 0, tankAngle: tankObj?.turretAngle || 0 };
};

const WORLD_W = 7200;
const WORLD_H = 4500;
const DEADZONE_X = 0.20;
const DEADZONE_Y = 0.20;

// ═══════════════════════════════════
//  SEEDED RANDOM
// ═══════════════════════════════════

function seededRand(seed) {
  let s = seed;
  return function() {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// ═══════════════════════════════════
//  WORLD GENERATION
// ═══════════════════════════════════

// Stamped into the sfg-world payload (storage.js). Bump on ANY change to
// generateWorld()'s output — the persisted world is a cache of this
// function, and without a version bump every existing player keeps the old
// cached world while fresh profiles get the new one.
// v8 (MD 15): dead-zone fix — best-candidate cluster centers + a coverage
// floor pass, after the player found screen-sized areas with nothing at all.
const WORLD_GEN_VERSION = 8;

// ── MD 08 (cleaned up in MD 08b): the world is a place ──
// One seeded stream (42), consumed in a fixed pass order, so the same world
// comes back every boot. Layout:
//   · The village: the five buildings arranged around a plaza instead of a
//     660px programmer-row. Home KEEPS its exact old position — spawn,
//     respawn, the platformer transition and the chimney all hang off it.
//   · Destinations at the compass points: stone circle W, campsite and the
//     ancient tree E, pond N, reed pond S.
//   · Regions: rocky north band, meadow west, deep forest southeast, light
//     forest northeast, open plain south — done purely with distribution,
//     clustering and scale, no bespoke biome machinery.
//   · A low-density background lattice keeps every direction from being
//     truly featureless — but open ground is content too, and the dense
//     areas read as dense because it exists.
// MD 08b removed the road network: the trails were the only filled shapes
// in a world of thin strokes and read as pasted in from another game. The
// layout they connected stands on its own. If wayfinding ever proves to be
// genuinely missing, that is a deliberate later decision — do NOT reintroduce
// paths as filled bands, and think hard before doing it with strokes.
// Placement rejection (footprints, clearings) SKIPS rather than rerolls, so
// the stream stays one straight line through the code.

function generateWorld() {
  const rand = seededRand(42);
  const objects = [];
  let oid = 0;
  const push = (type, x, y, extra) => {
    const o = { id: type + '_' + (oid++), type, x, y, seed: Math.floor(rand() * 100000) };
    if (extra) Object.assign(o, extra);
    objects.push(o);
    return o;
  };

  // ── The village ─────────────────────────────────────
  // Owner's call (post-MD 09): the classic row is the look — home,
  // treehouse, castle, shop, jail evenly spaced on one line, exactly the
  // pre-MD 08 arrangement. Home keeps its anchor position; spawn
  // (3600, 2250) lands just south of the row.
  objects.push({ id:'home_0', type:'home', x:3270, y:2130, seed:0 });
  objects.push({ id:'treehouse_0', type:'treehouse', x:3435, y:2130, seed:4 });
  objects.push({ id:'castle_0', type:'castle', x:3600, y:2130, seed:1 });
  objects.push({ id:'shop_0', type:'shop', x:3765, y:2130, seed:2 });
  objects.push({ id:'jail_0', type:'jail', x:3930, y:2130, seed:3 });
  objects.push({ id:'tank_0', type:'tank', x:3150, y:2170, seed:0,
    angle:0, speed:0, turretAngle:0, occupied:false, fireTimer:0, _trackOffset:0 });

  // ── Landmark anchor points ──
  const STONE_CIRCLE = { x: 1740, y: 1600 };
  const CAMPSITE     = { x: 4700, y: 2495 };
  const ANCIENT_TREE = { x: 5600, y: 2900 };
  const POND_N       = { x: 4320, y: 1230, r: 150 };
  const POND_S       = { x: 3200, y: 3620, r: 95 };

  // ── Placement rules ─────────────────────────────────
  // Scatter never lands in buildings, on the spawn pad, or inside a
  // landmark's breathing room. Rejection skips (no reroll) — the rand
  // stream stays a single deterministic line.
  const clearings = [
    { x: 3600, y: 2250, r: 70 },                           // spawn drop pad
    { x: STONE_CIRCLE.x, y: STONE_CIRCLE.y, r: 180 },
    { x: CAMPSITE.x, y: CAMPSITE.y, r: 95 },
    { x: ANCIENT_TREE.x, y: ANCIENT_TREE.y, r: 130 },
    { x: POND_N.x, y: POND_N.y, r: POND_N.r + 60 },
    { x: POND_S.x, y: POND_S.y, r: POND_S.r + 45 },
  ];
  const footprints = [
    { x: 3270, y: 2130, hw: 34+30, top: 2130-26-30, bot: 2130+30 },
    { x: 3435, y: 2130, hw: 30+30, top: 2130-30-30, bot: 2130+30 },
    { x: 3600, y: 2130, hw: 47+30, top: 2130-30-30, bot: 2130+30 },
    { x: 3765, y: 2130, hw: 31+30, top: 2130-20-30, bot: 2130+30 },
    { x: 3930, y: 2130, hw: 30+30, top: 2130-22-30, bot: 2130+30 },
    { x: 3150, y: 2170, hw: 60,    top: 2170-50,    bot: 2170+50 },  // tank pad
  ];
  function canPlace(x, y) {
    if (x < 60 || x > WORLD_W - 60 || y < 60 || y > WORLD_H - 60) return false;
    for (const f of footprints) {
      if (x > f.x - f.hw && x < f.x + f.hw && y > f.top && y < f.bot) return false;
    }
    for (const c of clearings) {
      if (Math.hypot(x - c.x, y - c.y) < c.r) return false;
    }
    return true;
  }

  // ── Landmarks ───────────────────────────────────────
  // Stone circle: a ring of standing stones on the west meadow.
  {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.35;
      push('menhir', STONE_CIRCLE.x + Math.cos(a) * 125, STONE_CIRCLE.y + Math.sin(a) * 75, { big: 1.35 });
    }
    push('rock', STONE_CIRCLE.x + 40, STONE_CIRCLE.y + 10, {});      // toppled one
    for (let i = 0; i < 2; i++) {
      push('flower', STONE_CIRCLE.x + (rand() - 0.5) * 150, STONE_CIRCLE.y + (rand() - 0.5) * 90, {});
    }
  }
  // Campsite east of the village: fire ring, seat logs, a supply rock.
  push('campfire', CAMPSITE.x, CAMPSITE.y, {});
  push('log', CAMPSITE.x - 30, CAMPSITE.y + 16, {});
  push('log', CAMPSITE.x + 28, CAMPSITE.y + 12, {});
  push('rock', CAMPSITE.x - 12, CAMPSITE.y - 26, {});
  // Ancient tree: one huge tree, deadfall and a shrub ring at distance.
  push('tree', ANCIENT_TREE.x, ANCIENT_TREE.y, { big: 2.6, seed: 777 });
  push('log', ANCIENT_TREE.x - 70, ANCIENT_TREE.y + 40, { big: 1.4 });
  push('log', ANCIENT_TREE.x + 85, ANCIENT_TREE.y + 20, {});
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 1.1;
    push('shrub', ANCIENT_TREE.x + Math.cos(a) * 150, ANCIENT_TREE.y + Math.sin(a) * 95, {});
  }
  // Ponds, reeds (grass at the shore) and shore flowers.
  push('pond', POND_N.x, POND_N.y, { r: POND_N.r, _ext: POND_N.r + 30 });
  for (let i = 0; i < 5; i++) {
    const a = rand() * Math.PI * 2;
    push('grass', POND_N.x + Math.cos(a) * POND_N.r * 1.12, POND_N.y + Math.sin(a) * POND_N.r * 0.62, {});
  }
  for (let i = 0; i < 2; i++) {
    const a = rand() * Math.PI * 2;
    push('flower', POND_N.x + Math.cos(a) * POND_N.r * 1.3, POND_N.y + Math.sin(a) * POND_N.r * 0.75, {});
  }
  push('pond', POND_S.x, POND_S.y, { r: POND_S.r, _ext: POND_S.r + 30 });
  for (let i = 0; i < 3; i++) {
    const a = rand() * Math.PI * 2;
    push('grass', POND_S.x + Math.cos(a) * POND_S.r * 1.15, POND_S.y + Math.sin(a) * POND_S.r * 0.65, {});
  }
  // Boulder field, rocky north.
  for (let i = 0; i < 7; i++) {
    const x = 2500 + (rand() - 0.5) * 560, y = 850 + (rand() - 0.5) * 320;
    if (canPlace(x, y)) push('rock', x, y, { big: 1.5 + rand() * 0.8 });
  }
  push('menhir', 2530, 870, { big: 1.2 });

  // ── Regions ─────────────────────────────────────────
  function region(x, y) {
    if (y < 1100) return 'rocky';
    if (x > 4300 && y > 2150) return 'forest';
    if (x > 4300) return 'lightforest';
    if (x < 2700 && y > 1300 && y < 3400) return 'meadow';
    if (y > 3000) return 'plain';
    return 'heart';
  }
  // Weighted type pick per region; r2 already drawn from the stream.
  // MD 08b: small scatter (grass tufts, flowers) cut hardest — it costs the
  // most visual noise per object. Regions keep their character through the
  // structural types.
  function pickType(reg, r2) {
    const table = {
      rocky:       [['rock',.5],['grass',.12],['tree',.12],['shrub',.12],['menhir',.08],['flower',.06]],
      forest:      [['tree',.52],['shrub',.3],['log',.1],['grass',.04],['rock',.04]],
      lightforest: [['tree',.38],['shrub',.28],['grass',.12],['flower',.06],['rock',.1],['log',.06]],
      meadow:      [['grass',.4],['flower',.2],['shrub',.14],['tree',.12],['rock',.14]],
      plain:       [['grass',.32],['shrub',.22],['flower',.1],['tree',.16],['rock',.14],['log',.06]],
      heart:       [['grass',.28],['shrub',.26],['tree',.18],['flower',.06],['rock',.22]],
    }[reg];
    let acc = 0;
    for (const [t, w] of table) { acc += w; if (r2 <= acc) return t; }
    return table[0][0];
  }

  // ── Clusters: thickets, drifts, rock fields ─────────
  // Each region gets cluster centers with region-typical sizes; members
  // scatter around the center so the world reads as having places.
  // MD 08b: minimum separation inside a clump — overlap is good, stacking
  // isn't. Every member must still read as an individual thing. Trees also
  // keep a GLOBAL minimum from each other so two overlapping clusters can't
  // recreate the mound-of-circles blob.
  const SEP = { tree: 64, shrub: 46, rock: 50, menhir: 80, log: 52, grass: 36, flower: 36 };
  const treePts = [];
  function treeCrowded(x, y) {
    for (const p of treePts) { if (Math.hypot(p[0] - x, p[1] - y) < 58) return true; }
    return false;
  }
  // MD 09: cut to ~250 total. Owner looked at 562 and asked for less —
  // parkland IS the wanted look, sparse regions are the intended result.
  // Trees and landmarks keep region identity; small scatter goes first.
  const clusterPlans = [
    { reg:'forest',      n: 14, min: 5, max: 8, spread: 260, x0: 4300, x1: 7100, y0: 2150, y1: 4400 },
    { reg:'lightforest', n:  8, min: 3, max: 6, spread: 240, x0: 4300, x1: 7100, y0: 1150, y1: 2100 },
    { reg:'meadow',      n:  8, min: 4, max: 6, spread: 240, x0:  150, x1: 2700, y0: 1300, y1: 3400 },
    { reg:'rocky',       n:  7, min: 3, max: 5, spread: 210, x0:  150, x1: 7050, y0:  150, y1: 1050 },
    { reg:'plain',       n:  5, min: 3, max: 5, spread: 250, x0: 2700, x1: 4250, y0: 3050, y1: 4400 },
    { reg:'heart',       n:  6, min: 2, max: 4, spread: 210, x0: 2750, x1: 4250, y0: 1200, y1: 2950 },
  ];
  for (const plan of clusterPlans) {
    // MD 15: best-candidate center placement. Uniform-random centers clump,
    // which starves the rest of the region — the source of the map's dead
    // zones. Each center now draws 3 candidates and keeps the one farthest
    // from centers already chosen for this plan, spreading clusters across
    // the whole region box while staying fully deterministic.
    const centers = [];
    for (let c = 0; c < plan.n; c++) {
      let cx = 0, cy = 0, bestD = -1;
      for (let k = 0; k < 3; k++) {
        const x = plan.x0 + rand() * (plan.x1 - plan.x0);
        const y = plan.y0 + rand() * (plan.y1 - plan.y0);
        let dMin = Infinity;
        for (const q of centers) dMin = Math.min(dMin, Math.hypot(q[0] - x, q[1] - y));
        if (dMin > bestD) { bestD = dMin; cx = x; cy = y; }
      }
      centers.push([cx, cy]);
      const members = plan.min + Math.floor(rand() * (plan.max - plan.min + 1));
      const placed = [];
      for (let m = 0; m < members; m++) {
        const a = rand() * Math.PI * 2;
        const d = Math.sqrt(rand()) * plan.spread;
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.7;
        const t = pickType(plan.reg, rand());
        const bigRoll = rand();
        if (!canPlace(x, y)) continue;
        if (region(x, y) !== plan.reg) continue;   // clusters stay in their biome
        const sep = SEP[t] || 40;
        let crowded = t === 'tree' && treeCrowded(x, y);
        if (!crowded) {
          for (const p of placed) {
            if (Math.hypot(p[0] - x, p[1] - y) < Math.max(sep, SEP[p[2]] || 40)) { crowded = true; break; }
          }
        }
        if (crowded) continue;
        const extra = {};
        if (t === 'rock' && plan.reg === 'rocky' && bigRoll > 0.8) extra.big = 1.4 + bigRoll;
        if (t === 'tree' && plan.reg === 'forest' && bigRoll > 0.92) extra.big = 1.5;
        push(t, x, y, extra);
        placed.push([x, y, t]);
        if (t === 'tree') treePts.push([x, y]);
      }
    }
  }

  // ── Background lattice ──────────────────────────────
  // A sparse jittered grid pass over the whole map — walking keeps finding
  // things, but open ground stays genuinely open. (MD 08b: thinned; empty
  // space is what makes the dense areas read as dense.)
  const STEP = 480;
  for (let gx = STEP / 2; gx < WORLD_W; gx += STEP) {
    for (let gy = STEP / 2; gy < WORLD_H; gy += STEP) {
      if (rand() > 0.26) continue;
      const x = gx + (rand() - 0.5) * STEP * 0.9;
      const y = gy + (rand() - 0.5) * STEP * 0.9;
      const t = pickType(region(x, y), rand());
      if (!canPlace(x, y)) continue;
      if (t === 'tree' && treeCrowded(x, y)) continue;
      push(t, x, y, {});
      if (t === 'tree') treePts.push([x, y]);
    }
  }

  // ── Coverage floor (MD 15) ──────────────────────────
  // Pure chance leaves real dead zones: at 26% per 480px lattice cell,
  // several adjacent cells all rolling empty is common, and the player hit
  // screen-sized areas with nothing in them at all. Guarantee a floor:
  // check every 600px cell; any cell that ended up with zero objects gets
  // one region-typical object (a few jittered tries, skip-on-reject like
  // everything else), and sometimes a small companion so the fill doesn't
  // read as one accidental lonely dot. This adds only as many objects as
  // there are holes, so the parkland look and the deliberately sparse
  // regions survive — "sparse" now means a few things, never nothing.
  {
    const CELL = 600;
    const cols = Math.ceil(WORLD_W / CELL), rows = Math.ceil(WORLD_H / CELL);
    const occupied = new Uint8Array(cols * rows);
    for (const o of objects) {
      if (o.type === 'pond') continue;   // a pond is deliberate open water
      const ci = Math.min(cols - 1, Math.floor(o.x / CELL));
      const cj = Math.min(rows - 1, Math.floor(o.y / CELL));
      occupied[cj * cols + ci] = 1;
    }
    for (let cj = 0; cj < rows; cj++) {
      for (let ci = 0; ci < cols; ci++) {
        if (occupied[cj * cols + ci]) continue;
        for (let attempt = 0; attempt < 4; attempt++) {
          // Clamped into the world margin — edge cells (the map height is
          // 7.5 cells, so the bottom row is a 300px sliver) would otherwise
          // jitter out of bounds and stay empty.
          const x = Math.min(WORLD_W - 70, Math.max(70, ci * CELL + (0.15 + rand() * 0.7) * CELL));
          const y = Math.min(WORLD_H - 70, Math.max(70, cj * CELL + (0.15 + rand() * 0.7) * CELL));
          const t = pickType(region(x, y), rand());
          if (!canPlace(x, y)) continue;
          if (t === 'tree' && treeCrowded(x, y)) continue;
          push(t, x, y, {});
          if (t === 'tree') treePts.push([x, y]);
          if (rand() < 0.35) {
            const a = rand() * Math.PI * 2, d = 40 + rand() * 50;
            const x2 = x + Math.cos(a) * d, y2 = y + Math.sin(a) * d;
            const t2 = pickType(region(x2, y2), rand());
            if (canPlace(x2, y2) && !(t2 === 'tree' && treeCrowded(x2, y2))) {
              push(t2, x2, y2, {});
              if (t2 === 'tree') treePts.push([x2, y2]);
            }
          }
          break;
        }
      }
    }
  }

  return objects;
}

function _preventScroll(e) {
  // The pause menu is an overlay like the rest: let the wheel scroll it, and
  // never let a wheel event reach the zoom while the game is paused.
  if (isPauseMenuOpen()) {
    if (e.target && e.target.closest('#pmenu')) return;   // scroll the panel
    e.preventDefault();                                    // and nothing else
    return;
  }
  // Allow scrolling inside UI overlays (profile menu, settings, community feed, etc.)
  if (e.target && e.target.closest('#acct-menu, #community-feed, #help-panel, #settings-panel, #inventory-grid')) {
    // Shift+wheel converts to horizontal scroll in browsers — force vertical for scrollable panels
    if (e.shiftKey && e.type === 'wheel') {
      e.preventDefault();
      const scroller = e.target.closest('#acct-menu-scroll, #community-feed, #help-panel, #settings-panel, #inventory-grid');
      if (scroller) scroller.scrollTop += e.deltaY || e.deltaX;
    }
    return;
  }
  e.preventDefault();
  // Scroll wheel controls camera zoom
  if (e.type === 'wheel') {
    if (e.deltaY < 0) _zoomTarget = Math.min(_ZOOM_MAX, _zoomTarget + _ZOOM_STEP);
    else              _zoomTarget = Math.max(_ZOOM_MIN, _zoomTarget - _ZOOM_STEP);
  }
}

function _darkenHex(hex, amount) {
  // Darken a hex color by mixing with black. amount 0-1 (0=no change, 1=black)
  const h = hex.replace('#','');
  if (h.length !== 6) return hex;
  const r = Math.round(parseInt(h.slice(0,2),16) * (1 - amount));
  const g = Math.round(parseInt(h.slice(2,4),16) * (1 - amount));
  const b = Math.round(parseInt(h.slice(4,6),16) * (1 - amount));
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

// Canvas background lerp for smooth theme transitions
let _bgLerpFrom = null, _bgLerpTo = null, _bgLerpStart = 0;
const _bgLerpDuration = 500;
let _currentBg = '#13141a';

function _lerpColor(hex1, hex2, t) {
  t = Math.max(0, Math.min(1, t));
  const r1 = parseInt(hex1.slice(1,3),16), g1 = parseInt(hex1.slice(3,5),16), b1 = parseInt(hex1.slice(5,7),16);
  const r2 = parseInt(hex2.slice(1,3),16), g2 = parseInt(hex2.slice(3,5),16), b2 = parseInt(hex2.slice(5,7),16);
  return '#' + [
    Math.round(r1 + (r2 - r1) * t),
    Math.round(g1 + (g2 - g1) * t),
    Math.round(b1 + (b2 - b1) * t)
  ].map(v => v.toString(16).padStart(2, '0')).join('');
}

// ═══════════════════════════════════
//  COORDINATE CONVERSION & CAMERA
// ═══════════════════════════════════

export function worldToScreen(wx, wy) {
  return {
    sx: wx - _camera.x + _shakeOX + window.innerWidth / 2,
    sy: wy - _camera.y + _shakeOY + window.innerHeight / 2,
  };
}
// Zoom-aware version for DOM-positioned elements (remote players, overlays)
function worldToScreenZoomed(wx, wy) {
  return {
    sx: (wx - _camera.x + _shakeOX) * _zoom + window.innerWidth / 2,
    sy: (wy - _camera.y + _shakeOY) * _zoom + window.innerHeight / 2,
  };
}

export function screenToWorld(sx, sy) {
  // Account for zoom: screen coords → un-zoom from center → world coords
  const hw = window.innerWidth / 2, hh = window.innerHeight / 2;
  return {
    wx: (sx - hw) / _zoom + _camera.x,
    wy: (sy - hh) / _zoom + _camera.y,
  };
}

let _cameraSmoothT = 1; // 0 = just switched, ramps to 1 for full speed

function updateCamera(charWorldX, charWorldY) {
  const sw = window.innerWidth, sh = window.innerHeight;

  // Smooth zoom lerp
  if (Math.abs(_zoom - _zoomTarget) > 0.001) {
    _zoom += (_zoomTarget - _zoom) * _ZOOM_LERP * _dt;
  } else {
    _zoom = _zoomTarget;
  }


  // Smooth ramp-up after camera mode switch
  if (_cameraSmoothT < 1) _cameraSmoothT = Math.min(1, _cameraSmoothT + 0.008 * _dt);
  const lerpRate = 0.08 + _cameraSmoothT * 0.17; // ramps from 0.08 to 0.25 (was 0.03–0.12)

  if (_playCameraMode === 'follow') {
    _cameraTarget.x = charWorldX;
    _cameraTarget.y = charWorldY;
    _camera.x += (_cameraTarget.x - _camera.x) * lerpRate * _dt;
    _camera.y += (_cameraTarget.y - _camera.y) * lerpRate * _dt;
  } else {
    // Deadzone: camera only kicks in at screen edges (zoom-adjusted)
    const csx = (charWorldX - _camera.x) * _zoom + sw / 2;
    const csy = (charWorldY - _camera.y) * _zoom + sh / 2;
    if (csx < sw * DEADZONE_X)       _cameraTarget.x = charWorldX - (sw * DEADZONE_X - sw / 2) / _zoom;
    if (csx > sw * (1 - DEADZONE_X)) _cameraTarget.x = charWorldX - (sw * (1 - DEADZONE_X) - sw / 2) / _zoom;
    if (csy < sh * DEADZONE_Y)       _cameraTarget.y = charWorldY - (sh * DEADZONE_Y - sh / 2) / _zoom;
    if (csy > sh * (1 - DEADZONE_Y)) _cameraTarget.y = charWorldY - (sh * (1 - DEADZONE_Y) - sh / 2) / _zoom;
    const dzLerp = 0.05 + _cameraSmoothT * 0.10; // ramps from 0.05 to 0.15 (was 0.02–0.08)
    _camera.x += (_cameraTarget.x - _camera.x) * dzLerp * _dt;
    _camera.y += (_cameraTarget.y - _camera.y) * dzLerp * _dt;
  }

  // World bounds clamp (account for zoom — visible area is sw/_zoom)
  const halfVW = sw / (2 * _zoom), halfVH = sh / (2 * _zoom);
  _camera.x = Math.max(halfVW, Math.min(WORLD_W - halfVW, _camera.x));
  _camera.y = Math.max(halfVH, Math.min(WORLD_H - halfVH, _camera.y));

  // Shake offset for this frame (draw-time only, see worldToScreen)
  _tickShake();
}

// ═══════════════════════════════════
//  RENDERING
// ═══════════════════════════════════

// ── Spatial index (MD 08) ──
// generateWorld now emits thousands of objects; a linear scan per frame was
// fine at 200 and isn't at that scale. Static objects bucket into a coarse
// grid rebuilt only when the world array changes (_rebuildWorldIndex).
// Objects that move (tank) or that are far bigger than the 200px cull buffer
// (ponds — anything with an _ext extent radius) live in a small
// always-checked list instead, so a wide object can't vanish just because
// its anchor point left the viewport.
const WORLD_GRID_CELL = 512;
let _worldGrid = new Map();
let _worldAlwaysCheck = [];
function _rebuildWorldIndex() {
  _worldGrid = new Map();
  _worldAlwaysCheck = [];
  for (const o of _worldObjects) {
    if (o.type === 'tank' || (o._ext || 0) > 150) { _worldAlwaysCheck.push(o); continue; }
    const k = Math.floor(o.x / WORLD_GRID_CELL) * 100000 + Math.floor(o.y / WORLD_GRID_CELL);
    const arr = _worldGrid.get(k);
    if (arr) arr.push(o); else _worldGrid.set(k, [o]);
  }
  _footprintCache = null;
}

function getVisibleObjects() {
  const sw = window.innerWidth, sh = window.innerHeight, buf = 200;
  // Same semantics as the old worldToScreen filter (shake offset ≤12px is
  // absorbed by the buffer): world-space viewport rect around the camera.
  const x0 = _camera.x - sw / 2 - buf, x1 = _camera.x + sw / 2 + buf;
  const y0 = _camera.y - sh / 2 - buf, y1 = _camera.y + sh / 2 + buf;
  const out = [];
  const cx0 = Math.floor(x0 / WORLD_GRID_CELL), cx1 = Math.floor(x1 / WORLD_GRID_CELL);
  const cy0 = Math.floor(y0 / WORLD_GRID_CELL), cy1 = Math.floor(y1 / WORLD_GRID_CELL);
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      const arr = _worldGrid.get(cx * 100000 + cy);
      if (!arr) continue;
      for (const o of arr) {
        if (o.x > x0 && o.x < x1 && o.y > y0 && o.y < y1) out.push(o);
      }
    }
  }
  for (const o of _worldAlwaysCheck) {
    const ext = o._ext || 0;
    if (o.x > x0 - ext && o.x < x1 + ext && o.y > y0 - ext && o.y < y1 + ext) out.push(o);
  }
  return out;
}

function drawGrid() {
  const ctx = _worldCtx, sw = window.innerWidth, sh = window.innerHeight;
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.04)';
  ctx.lineWidth = 1;
  const gs = 200;
  const sx0 = Math.floor((_camera.x - sw/2) / gs) * gs;
  const sy0 = Math.floor((_camera.y - sh/2) / gs) * gs;
  for (let wx = sx0; wx < _camera.x + sw/2 + gs; wx += gs) { const {sx}=worldToScreen(wx,0); ctx.beginPath(); ctx.moveTo(sx,0); ctx.lineTo(sx,sh); ctx.stroke(); }
  for (let wy = sy0; wy < _camera.y + sh/2 + gs; wy += gs) { const {sy}=worldToScreen(0,wy); ctx.beginPath(); ctx.moveTo(0,sy); ctx.lineTo(sw,sy); ctx.stroke(); }
}

// ── Building helpers ──
function _drawBuildingLabel(ctx, sx, sy, text) {
  const fs = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--fs')) || 16;
  ctx.font = `bold ${fs}px ${getComputedStyle(document.documentElement).getPropertyValue('--fn').trim() || 'sans-serif'}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillStyle = _cachedClr; ctx.globalAlpha = 0.85;
  ctx.fillText(text, sx, sy);
  ctx.globalAlpha = 1; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

// ── Home drawing ──
// layer: 'behind' = bg fill + outlines (drawn before character), 'front' = drawn after character, 'full' = both
function _drawHome(ctx, sx, sy, layer) {
  const w = 64, h = 48;
  const bgColor = _currentBg || '#13141a';

  if (layer === 'behind' || layer === 'full') {
    // Solid background fill — covers every part of the house silhouette
    ctx.fillStyle = bgColor;
    ctx.beginPath(); ctx.moveTo(sx-w/2-8,sy-h); ctx.lineTo(sx,sy-h-30); ctx.lineTo(sx+w/2+8,sy-h); ctx.closePath(); ctx.fill();
    ctx.fillRect(sx - w/2, sy - h, w, h);
    // Chimney fill — clipped to roof line
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(sx+14, sy-h-26);
    ctx.lineTo(sx+23, sy-h-26);
    ctx.lineTo(sx+23, sy-h-12.75);
    ctx.lineTo(sx+14, sy-h-19.5);
    ctx.closePath();
    ctx.clip();
    ctx.fillRect(sx+14, sy-h-26, 9, 18);
    ctx.restore();
    ctx.fillStyle = bgColor;
    // Door area fill
    ctx.beginPath(); ctx.moveTo(sx-9,sy); ctx.lineTo(sx-9,sy-20); ctx.quadraticCurveTo(sx-9,sy-26,sx,sy-26); ctx.quadraticCurveTo(sx+9,sy-26,sx+9,sy-20); ctx.lineTo(sx+9,sy); ctx.closePath(); ctx.fill();
    // Window fills
    ctx.fillRect(sx-w/2+10, sy-h+10, 12, 10);
    ctx.fillRect(sx+w/2-22, sy-h+10, 12, 10);
  }

  if (layer === 'front' || layer === 'full') {
    // Full house outline + details — always drawn as one complete piece
    ctx.strokeStyle = _cachedClr;
    ctx.lineWidth = 1.8;
    ctx.strokeRect(sx - w/2, sy - h, w, h);
    // Roof
    ctx.beginPath(); ctx.moveTo(sx-w/2-8,sy-h); ctx.lineTo(sx,sy-h-30); ctx.lineTo(sx+w/2+8,sy-h); ctx.stroke();
    ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(sx-4,sy-h-28); ctx.lineTo(sx+4,sy-h-28); ctx.stroke();
    // Door
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(sx-9,sy); ctx.lineTo(sx-9,sy-20); ctx.quadraticCurveTo(sx-9,sy-26,sx,sy-26); ctx.quadraticCurveTo(sx+9,sy-26,sx+9,sy-20); ctx.lineTo(sx+9,sy); ctx.stroke();
    ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(sx+6,sy-13,1.5,0,Math.PI*2); ctx.stroke();
    // Windows
    ctx.lineWidth = 1.4;
    [sx-w/2+10, sx+w/2-22].forEach(wx => {
      ctx.strokeRect(wx,sy-h+10,12,10);
      ctx.beginPath(); ctx.moveTo(wx+6,sy-h+10); ctx.lineTo(wx+6,sy-h+20); ctx.moveTo(wx,sy-h+15); ctx.lineTo(wx+12,sy-h+15); ctx.stroke();
    });
    // Chimney — only the portion above the roof line
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(sx+14, sy-h-19.5);
    ctx.lineTo(sx+14, sy-h-26);
    ctx.lineTo(sx+23, sy-h-26);
    ctx.lineTo(sx+23, sy-h-12.75);
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx+14, sy-h-26); ctx.lineTo(sx+23, sy-h-26); ctx.stroke();
    if (!_homePromptVisible) _drawBuildingLabel(ctx, sx, sy - h - 30 - 18, 'Home');
  }
}

// ── Castle drawing ──
function _drawCastle(ctx, sx, sy, layer) {
  const w = 90, h = 70, towerW = 18, towerH = h + 14;
  const bgColor = _currentBg || '#13141a';
  const ltx = sx - w/2, rtx = sx + w/2 - towerW;
  const mW = 5, mH = 6, mG = 4;
  if (layer === 'behind' || layer === 'full') {
    ctx.fillStyle = bgColor;
    ctx.fillRect(sx - w/2, sy - h, w, h);
    ctx.fillRect(ltx, sy - towerH, towerW, towerH);
    ctx.fillRect(rtx, sy - towerH, towerW, towerH);
    for (const tx of [ltx, rtx]) {
      for (let mx = tx + 1; mx < tx + towerW - 1; mx += mW + mG) {
        ctx.fillRect(mx, sy - towerH - mH, mW, mH);
      }
    }
    ctx.beginPath(); ctx.moveTo(sx-11,sy); ctx.lineTo(sx-11,sy-22); ctx.quadraticCurveTo(sx-11,sy-30,sx,sy-30); ctx.quadraticCurveTo(sx+11,sy-30,sx+11,sy-22); ctx.lineTo(sx+11,sy); ctx.closePath(); ctx.fill();
    [-12, 12].forEach(ox => { ctx.fillRect(sx + ox - 5, sy - h + 16, 10, 9); });
  }
  if (layer === 'front' || layer === 'full') {
    ctx.strokeStyle = _cachedClr; ctx.lineWidth = 1.8;
    ctx.strokeRect(sx - w/2, sy - h, w, h);
    ctx.strokeRect(ltx, sy - towerH, towerW, towerH);
    ctx.strokeRect(rtx, sy - towerH, towerW, towerH);
    ctx.lineWidth = 1.4;
    for (const tx of [ltx, rtx]) {
      for (let mx = tx + 1; mx < tx + towerW - 1; mx += mW + mG) {
        ctx.strokeRect(mx, sy - towerH - mH, mW, mH);
      }
    }
    ctx.lineWidth = 1.0;
    for (const slitX of [ltx + towerW/2 - 1, rtx + towerW/2 - 1]) {
      const slitY = sy - towerH + 10;
      ctx.strokeRect(slitX, slitY, 2, 8);
      ctx.strokeRect(slitX - 3, slitY + 3, 8, 2);
    }
    ctx.lineWidth = 1.3;
    [-12, 12].forEach(ox => {
      ctx.strokeRect(sx + ox - 5, sy - h + 16, 10, 9);
      ctx.beginPath(); ctx.moveTo(sx+ox, sy-h+16); ctx.lineTo(sx+ox, sy-h+25); ctx.moveTo(sx+ox-5, sy-h+20); ctx.lineTo(sx+ox+5, sy-h+20); ctx.stroke();
    });
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(sx-11,sy); ctx.lineTo(sx-11,sy-22); ctx.quadraticCurveTo(sx-11,sy-30,sx,sy-30); ctx.quadraticCurveTo(sx+11,sy-30,sx+11,sy-22); ctx.lineTo(sx+11,sy); ctx.stroke();
    ctx.lineWidth = 0.8; ctx.globalAlpha = 0.5;
    for (let gx = sx-9; gx <= sx+9; gx += 6) { ctx.beginPath(); ctx.moveTo(gx,sy); ctx.lineTo(gx,sy-22); ctx.stroke(); }
    for (let gy = sy-6; gy >= sy-22; gy -= 6) { ctx.beginPath(); ctx.moveTo(sx-11,gy); ctx.lineTo(sx+11,gy); ctx.stroke(); }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.2;
    const flagX = rtx + towerW/2, flagY = sy - towerH - mH;
    ctx.beginPath(); ctx.moveTo(flagX, flagY); ctx.lineTo(flagX, flagY-12); ctx.stroke();
    ctx.fillStyle = _cachedClr; ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.moveTo(flagX,flagY-12); ctx.lineTo(flagX+9,flagY-9); ctx.lineTo(flagX,flagY-6); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    _drawBuildingLabel(ctx, sx, sy - towerH - mH - 20, 'PvP');
  }
}

// ── Shop drawing ──
function _drawShop(ctx, sx, sy, layer) {
  const w = 70, h = 50;
  const bgColor = _currentBg || '#13141a';
  if (layer === 'behind' || layer === 'full') {
    ctx.fillStyle = bgColor;
    ctx.fillRect(sx - w/2, sy - h, w, h * 0.6);
    ctx.beginPath(); ctx.moveTo(sx-w/2-6,sy-h+4); ctx.lineTo(sx+w/2+6,sy-h+4); ctx.lineTo(sx+w/2+2,sy-h+16); ctx.lineTo(sx-w/2-2,sy-h+16); ctx.closePath(); ctx.fill();
  }
  if (layer === 'front' || layer === 'full') {
    ctx.strokeStyle = _cachedClr;
    ctx.lineWidth = 2.0; ctx.strokeRect(sx-w/2+4, sy-10, w-8, 10);
    ctx.lineWidth = 1.4; ctx.strokeRect(sx-w/2, sy-h, w, h*0.55);
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(sx-w/2+4,sy-h+4); ctx.lineTo(sx-w/2+4,sy); ctx.moveTo(sx+w/2-4,sy-h+4); ctx.lineTo(sx+w/2-4,sy); ctx.stroke();
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(sx-w/2-6,sy-h+4); ctx.lineTo(sx+w/2+6,sy-h+4); ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(sx-w/2-6,sy-h+4); ctx.lineTo(sx-w/2-2,sy-h+16); ctx.moveTo(sx+w/2+6,sy-h+4); ctx.lineTo(sx+w/2+2,sy-h+16); ctx.stroke();
    ctx.lineWidth = 1.0; ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(sx-w/2-2,sy-h+16); ctx.lineTo(sx+w/2+2,sy-h+16); ctx.stroke();
    ctx.setLineDash([]);
    const vx = sx - 8, vy = sy - 10;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(vx, vy-14, 4, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(vx, vy-10); ctx.lineTo(vx, vy-2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(vx, vy-8); ctx.lineTo(vx-7, vy-4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(vx, vy-8); ctx.lineTo(vx+7, vy-4); ctx.stroke();
    ctx.fillStyle = _cachedClr; ctx.globalAlpha = 0.6;
    [-12,0,12].forEach(ox => { ctx.beginPath(); ctx.arc(sx+ox, sy-6, 2.5, 0, Math.PI*2); ctx.fill(); });
    ctx.globalAlpha = 1;
    _drawBuildingLabel(ctx, sx, sy - h - 14, 'Shop');
  }
}

function _drawJail(ctx, sx, sy, layer) {
  const w = 56, h = 44;
  const bgColor = _currentBg || '#13141a';
  if (layer === 'behind' || layer === 'full') {
    ctx.fillStyle = bgColor;
    ctx.fillRect(sx - w/2, sy - h, w, h);
  }
  if (layer === 'front' || layer === 'full') {
    ctx.strokeStyle = _cachedClr; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = 1.8;
    ctx.strokeRect(sx - w/2, sy - h, w, h);
    ctx.lineWidth = 1.4; ctx.globalAlpha = 0.7;
    for (let i = 0; i < 5; i++) {
      const bx = sx - w/2 + 8 + i * 10;
      ctx.beginPath(); ctx.moveTo(bx, sy - h + 8); ctx.lineTo(bx, sy - 4); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(sx - w/2 + 6, sy - h/2); ctx.lineTo(sx + w/2 - 6, sy - h/2); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx - w/2 - 4, sy - h); ctx.lineTo(sx + w/2 + 4, sy - h); ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(sx, sy - 12, 3, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx, sy - 9); ctx.lineTo(sx, sy - 6); ctx.stroke();
    _drawBuildingLabel(ctx, sx, sy - h - 14, 'Jail');
  }
}

// ═══════════════════════════════════
//  TANK DRAWING
// ═══════════════════════════════════

const _remoteCharEls = new Map();
const _remotePlayersMap = new Map();

function _tickRemoteInterpolation() {
  const renderTime = Date.now() - 80;
  _remotePlayersMap.forEach(p => {
    const buf = p.posBuffer;
    if (!buf.length) return;
    const latest = buf[buf.length - 1];
    // Idle or single sample: lerp toward latest (smooth stop)
    if (p.animState === 'idle' || buf.length === 1) {
      p.renderX += (latest.x - p.renderX) * 0.15;
      p.renderY += (latest.y - p.renderY) * 0.15;
      if (Math.abs(latest.x - p.renderX) < 0.5) p.renderX = latest.x;
      if (Math.abs(latest.y - p.renderY) < 0.5) p.renderY = latest.y;
      return;
    }
    // Past all samples: lerp to latest
    if (renderTime >= latest.time) {
      p.renderX += (latest.x - p.renderX) * 0.2;
      p.renderY += (latest.y - p.renderY) * 0.2;
      return;
    }
    if (renderTime <= buf[0].time) { p.renderX = buf[0].x; p.renderY = buf[0].y; return; }
    // Interpolate between bracketing samples
    for (let i = 0; i < buf.length - 1; i++) {
      if (renderTime >= buf[i].time && renderTime <= buf[i + 1].time) {
        const t = (renderTime - buf[i].time) / (buf[i + 1].time - buf[i].time);
        p.renderX = buf[i].x + (buf[i + 1].x - buf[i].x) * t;
        p.renderY = buf[i].y + (buf[i + 1].y - buf[i].y) * t;
        return;
      }
    }
    p.renderX = latest.x; p.renderY = latest.y;
  });
}

function _drawRemotePlayers(ctx) {
  const rp=_remotePlayersMap;
  const now2=Date.now();
  rp.forEach((p,id)=>{if(now2-p.lastUpdate>3000){rp.delete(id);}});
  const overlay=document.getElementById('char-overlay');
  if(!overlay)return;
  // Remove elements for players who left
  _remoteCharEls.forEach((entry,id)=>{if(!rp.has(id)){entry.wrapper.remove();_remoteCharEls.delete(id);}});
  const now=Date.now();
  rp.forEach((p,id)=>{
    const {sx,sy}=worldToScreenZoomed(p.renderX??p.x,p.renderY??p.y);
    // Create SVG element if it doesn't exist yet
    if(!_remoteCharEls.has(id)){
      const remoteId='r-'+id;
      const wrapper=window._dexBuildRemoteChar?.(remoteId);
      if(!wrapper)return;
      overlay.appendChild(wrapper);
      _remoteCharEls.set(id,{wrapper,remoteId,lastApp:null,localPhase:0,lastFrameTime:now,dropInT:0,dropInActive:true});
      if(p.appearance) window._dexApplyRemoteCosmetics?.(remoteId,p.appearance);
    }
    const entry=_remoteCharEls.get(id);
    if(!entry)return;
    // Hide if off-screen
    if(sx<-100||sx>window.innerWidth+100||sy<-100||sy>window.innerHeight+100){entry.wrapper.style.display='none';return;}
    // Tank state: hide character when in tank, restore on exit
    if(p.inTank){entry.wrapper.style.display='none';entry._wasInTank=true;return;}
    if(entry._wasInTank){entry.wrapper.style.display='';entry._wasInTank=false;}
    entry.wrapper.style.display='';
    if(p.dead){entry.wrapper.style.opacity='0.3';entry.wrapper.style.filter='grayscale(1)';}
    else{entry.wrapper.style.opacity='';entry.wrapper.style.filter='';}
    // Advance local animation phase (smooth 60fps, not network-synced)
    const frameDt=(now-entry.lastFrameTime)/(1000/240);
    entry.lastFrameTime=now;
    const anim=entry.dropInActive?'jump-air':(p.animState||'idle');
    if(anim==='jog') entry.localPhase+=0.025*frameDt;
    else if(anim==='walk') entry.localPhase+=0.015*frameDt;
    // Drop-in animation
    let dropOffset=0;
    if(entry.dropInActive){
      entry.dropInT+=1;
      if(entry.dropInT<30){const t=entry.dropInT/30;dropOffset=-(1-t*t)*400;}
      else if(entry.dropInT<40){dropOffset=Math.sin((entry.dropInT-30)/10*Math.PI)*-8;}
      else{entry.dropInActive=false;}
    }
    entry.wrapper.style.left=sx+'px';
    entry.wrapper.style.top=(sy-55*_zoom+dropOffset)+'px';
    const flipScale=p.flipX?-_zoom:_zoom;
    entry.wrapper.style.transform=`scaleX(${flipScale}) scaleY(${_zoom})`;
    entry.wrapper.style.transformOrigin='bottom center';
    // Color
    const clr=p.hex||'#7B8A9C';
    entry.wrapper.style.setProperty('--char-clr',clr);
    // Pose using LOCAL phase (smooth animation)
    window._dexPoseRemote?.(entry.remoteId,anim,entry.localPhase,{vy:p.vy||0,chargeT:p.chargeT||0,stunSev:p.stunSev||0});
    // Update cosmetics if changed
    const appStr=JSON.stringify(p.appearance||{});
    if(appStr!==entry.lastApp){entry.lastApp=appStr;window._dexApplyRemoteCosmetics?.(entry.remoteId,p.appearance);}
    // Health bar
    let hpBar = entry.wrapper.querySelector('.remote-hp-bar');
    let hpFill = entry.wrapper.querySelector('.remote-hp-fill');
    if (!hpBar) {
      hpBar = document.createElement('div');
      hpBar.className = 'remote-hp-bar';
      hpBar.style.cssText = 'position:absolute;top:-18px;left:50%;transform:translateX(-50%);width:28px;height:3px;background:rgba(0,0,0,0.35);border-radius:2px;pointer-events:none;';
      hpFill = document.createElement('div');
      hpFill.className = 'remote-hp-fill';
      hpFill.style.cssText = 'height:100%;border-radius:2px;transition:width 0.15s;';
      hpBar.appendChild(hpFill);
      entry.wrapper.appendChild(hpBar);
    }
    if (!hpFill) hpFill = entry.wrapper.querySelector('.remote-hp-fill');
    if (hpFill) {
      const hpPct = Math.max(0, Math.min(1, (p.hp ?? 100) / (p.maxHp ?? 100)));
      hpFill.style.width = (hpPct * 100) + '%';
      // Color: green → yellow → red
      if (hpPct > 0.6) hpFill.style.background = '#4cca6a';
      else if (hpPct > 0.3) hpFill.style.background = '#e6c840';
      else hpFill.style.background = '#e04444';
      // Hide bar at full health to reduce clutter
      hpBar.style.opacity = hpPct >= 1 ? '0' : '1';
    }
    // Nametag
    const tag=entry.wrapper.querySelector('.char-nametag');
    if(tag){tag.textContent=p.username||'Player';tag.style.color=clr;tag.style.transform=`translateX(-50%) scaleX(${p.flipX?-1:1}) scale(${1/_zoom})`;}
    // Hoverboard indicator
    let hoverEl=entry.wrapper.querySelector('.remote-hoverboard');
    if(p.hoverboard){
      if(!hoverEl){hoverEl=document.createElement('div');hoverEl.className='remote-hoverboard';hoverEl.style.cssText='position:absolute;bottom:-4px;left:50%;transform:translateX(-50%);width:28px;height:6px;border-radius:3px;background:var(--char-clr,#7B8A9C);opacity:0.7;box-shadow:0 2px 6px rgba(0,0,0,0.3);';entry.wrapper.appendChild(hoverEl);}
      hoverEl.style.display='';hoverEl.style.bottom=(- 4+Math.sin(Date.now()/300)*1.5)+'px';
    } else if(hoverEl){hoverEl.style.display='none';}
    // Weapon visual
    const wt=p.weapon||'none';
    let wEl=entry.wrapper.querySelector('.remote-weapon');
    if(wt!=='none'&&wt!==entry._lastWeapon){
      if(wEl)wEl.remove();
      wEl=document.createElement('div');wEl.className='remote-weapon';
      wEl.style.cssText='position:absolute;bottom:12px;pointer-events:none;';
      if(wt==='bow'){wEl.innerHTML=`<svg width="14" height="20" viewBox="0 0 14 20"><path d="M4,2 Q1,10 4,18" fill="none" stroke="${clr}" stroke-width="1.5"/><line x1="4" y1="2" x2="4" y2="18" stroke="${clr}" stroke-width="0.8"/></svg>`;wEl.style.right=p.flipX?'auto':'-8px';wEl.style.left=p.flipX?'-8px':'auto';}
      else if(wt==='gun'||wt==='pistol'){wEl.innerHTML=`<svg width="16" height="10" viewBox="0 0 16 10"><rect x="0" y="2" width="12" height="4" rx="1" fill="${clr}"/><rect x="8" y="4" width="4" height="6" rx="1" fill="${clr}"/></svg>`;wEl.style.right=p.flipX?'auto':'-10px';wEl.style.left=p.flipX?'-10px':'auto';}
      else if(wt==='rocket'){wEl.innerHTML=`<svg width="20" height="8" viewBox="0 0 20 8"><rect x="0" y="1" width="16" height="5" rx="2" fill="${clr}"/><rect x="14" y="0" width="6" height="7" rx="1" fill="${clr}" opacity="0.6"/></svg>`;wEl.style.right=p.flipX?'auto':'-12px';wEl.style.left=p.flipX?'-12px':'auto';}
      else if(wt==='sword'){wEl.innerHTML=`<svg width="7" height="30" viewBox="0 0 7 30"><polygon points="3.5,0 5,4 4.6,22 2.4,22 2,4" fill="${clr}"/><rect x="0" y="22" width="7" height="2" rx="1" fill="${clr}"/><rect x="2.3" y="24" width="2.4" height="5" rx="1" fill="${clr}" opacity="0.7"/></svg>`;wEl.style.right=p.flipX?'auto':'-4px';wEl.style.left=p.flipX?'-4px':'auto';}
      if(wEl.innerHTML)entry.wrapper.appendChild(wEl);
      entry._lastWeapon=wt;
    } else if(wt==='none'&&wEl){wEl.remove();entry._lastWeapon='none';}
  });
}

// Remote projectiles — stored as world-space objects, ticked in the main loop
const _remoteProjectiles = [];

function _spawnRemoteProjectile(wx, wy, vx, vy, type) {
  const isArrow = type === 'arrow' || !type;
  const isRocket = type === 'rocket';
  // vx/vy are per-frame (matches local p.wx += p.vx * _dt with _dt≈1 at 60fps),
  // so no conversion needed here.
  _remoteProjectiles.push({
    wx, wy,
    vx, vy,
    type: type || 'arrow',
    life: isArrow ? 180 : isRocket ? 120 : 90,
    grav: isArrow ? 0.012 : isRocket ? 0 : 0.008,
  });
}

function _tickRemoteProjectiles() {
  const canvas = document.getElementById('world-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  for (let i = _remoteProjectiles.length - 1; i >= 0; i--) {
    const p = _remoteProjectiles[i];
    p.vy += p.grav;
    p.wx += p.vx;
    p.wy += p.vy;
    p.life--;
    if (p.life <= 0) { _remoteProjectiles.splice(i, 1); continue; }
  }
}

function _drawRemoteProjectiles(ctx) {
  for (const p of _remoteProjectiles) {
    const { sx, sy } = worldToScreen(p.wx, p.wy);
    ctx.save();
    if (p.type === 'arrow') {
      // Draw as a short line in direction of travel
      const angle = Math.atan2(p.vy, p.vx);
      ctx.translate(sx, sy);
      ctx.rotate(angle);
      ctx.strokeStyle = '#c8a96e';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(8, 0);
      ctx.stroke();
      // Arrowhead
      ctx.fillStyle = '#c8a96e';
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(4, -2);
      ctx.lineTo(4, 2);
      ctx.closePath();
      ctx.fill();
    } else {
      // Bullet / rocket — glowing orb
      const r = p.type === 'rocket' ? 5 : 3;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = p.type === 'rocket' ? '#ff7733' : '#E8413A';
      ctx.fill();
      // Glow
      ctx.beginPath();
      ctx.arc(sx, sy, r + 3, 0, Math.PI * 2);
      ctx.fillStyle = p.type === 'rocket' ? 'rgba(255,120,50,0.3)' : 'rgba(232,65,58,0.3)';
      ctx.fill();
    }
    ctx.restore();
  }
}

function _handlePhotonPlayerUpdate(id, x, y, animState, phase, flipX, weapon, username, hex, appearance, extra) {
  let p = _remotePlayersMap.get(id);
  if (!p) {
    console.log('[mp] 👤 New remote player seen — actor:', id, 'username:', username, 'at', Math.round(x), Math.round(y));
    p = { x, y, renderX: x, renderY: y, animState: 'idle', phase: 0, flipX: false, weapon: null, username: 'Player', hex: '#7B8A9C', appearance: null, posBuffer: [], lastUpdate: 0, vy: 0, chargeT: 0, stunSev: 0, hoverboard: false, hp: 100, maxHp: 100, dead: false };
    _remotePlayersMap.set(id, p);
  }
  p.posBuffer.push({ time: Date.now(), x, y });
  if (p.posBuffer.length > 20) p.posBuffer.shift();
  const cutoff = Date.now() - 500;
  while (p.posBuffer.length > 1 && p.posBuffer[0].time < cutoff) p.posBuffer.shift();
  p.animState = animState || 'idle'; p.phase = phase || 0; p.flipX = flipX || false;
  // If player was dead but is now sending position updates again, they've respawned
  if (p.dead && animState && animState !== 'dead') {
    p.dead = false;
    p.hp = p.maxHp || 100;
  }
  p.weapon = weapon || null; p.username = username || 'Player'; p.hex = hex || '#7B8A9C';
  p.vy = extra?.vy || 0; p.chargeT = extra?.chargeT || 0; p.stunSev = extra?.stunSev || 0; p.hoverboard = extra?.hoverboard || false;
  if (appearance) p.appearance = appearance;
  p.lastUpdate = Date.now();
}

function _handlePhotonPlayerLeave(id) {
  _remotePlayersMap.delete(id);
  const entry = _remoteCharEls.get(id);
  if (entry) { entry.wrapper.remove(); _remoteCharEls.delete(id); }
}

function _handlePhotonDamage(targetId, damage, attackerName) {
  if (targetId === window._dexMyPhotonId) {
    // Local player took damage
    _playerHP = Math.max(0, _playerHP - damage);
    _playerDamageFlash = 15; _playerHPBarTimer = 180;
    _syncHudHealthBar();
    if (_playerHP <= 0 && !_playerDead) { _playerDead = true; _playerDeadTimer = 0; sfx('player.death'); }
    else if (_playerHP > 0) sfx('player.hurt');
  } else {
    // Remote player took damage — update their local HP state
    const p = _remotePlayersMap.get(targetId);
    if (p && !p.dead) {
      p.hp = Math.max(0, p.hp - damage);
      if (p.hp <= 0) p.dead = true;
    }
  }
}

function _clearRemotePlayers() {
  _remotePlayersMap.clear();
  _remoteCharEls.forEach(entry => entry.wrapper.remove());
  _remoteCharEls.clear();
}


function _drawTreehouse(ctx, sx, sy, layer) {
  const bgColor=_currentBg||'#13141a';
  const clr=_cachedClr;
  if(layer==='behind'||layer==='full'){
    // L1: Trunk fill+stroke
    ctx.fillStyle=bgColor;ctx.fillRect(sx-6,sy-60,12,60);
    ctx.strokeStyle=clr;ctx.lineWidth=1.8;ctx.strokeRect(sx-6,sy-60,12,60);
    ctx.lineWidth=1.2;ctx.globalAlpha=0.5;
    ctx.beginPath();ctx.moveTo(sx-6,sy);ctx.quadraticCurveTo(sx-14,sy-2,sx-18,sy);ctx.stroke();
    ctx.beginPath();ctx.moveTo(sx+6,sy);ctx.quadraticCurveTo(sx+14,sy-2,sx+18,sy);ctx.stroke();
    ctx.globalAlpha=1;
    // L2: Ground ladder (behind canopy)
    ctx.strokeStyle=clr;ctx.lineWidth=1.2;ctx.globalAlpha=0.6;
    ctx.beginPath();ctx.moveTo(sx+20,sy-30);ctx.lineTo(sx+20,sy);ctx.stroke();
    ctx.beginPath();ctx.moveTo(sx+26,sy-30);ctx.lineTo(sx+26,sy);ctx.stroke();
    ctx.globalAlpha=0.5;
    for(let ry=sy-4;ry>=sy-28;ry-=7){ctx.beginPath();ctx.moveTo(sx+20,ry);ctx.lineTo(sx+26,ry);ctx.stroke();}
    ctx.globalAlpha=1;
    // L3: Big canopy (fill covers trunk strokes)
    ctx.fillStyle=bgColor;ctx.beginPath();ctx.ellipse(sx,sy-78,48,36,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=clr;ctx.lineWidth=1.6;ctx.beginPath();ctx.ellipse(sx,sy-78,48,36,0,0,Math.PI*2);ctx.stroke();
    // L4: Small canopy circles (each fill covers big ellipse stroke)
    ctx.lineWidth=1.4;
    for(const[cx,cy,cr] of [[-38,-62,14],[40,-64,13],[-22,-102,12],[24,-100,11]]){
      ctx.fillStyle=bgColor;ctx.beginPath();ctx.arc(sx+cx,sy+cy,cr,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle=clr;ctx.beginPath();ctx.arc(sx+cx,sy+cy,cr,0,Math.PI*2);ctx.stroke();
    }
    // L5: Upper ladder (behind both platforms)
    ctx.strokeStyle=clr;ctx.lineWidth=1.2;ctx.globalAlpha=0.6;
    ctx.beginPath();ctx.moveTo(sx-30,sy-58);ctx.lineTo(sx-30,sy-74);ctx.stroke();
    ctx.beginPath();ctx.moveTo(sx-24,sy-58);ctx.lineTo(sx-24,sy-74);ctx.stroke();
    ctx.globalAlpha=0.5;
    ctx.beginPath();ctx.moveTo(sx-30,sy-62);ctx.lineTo(sx-24,sy-62);ctx.stroke();
    ctx.beginPath();ctx.moveTo(sx-30,sy-68);ctx.lineTo(sx-24,sy-68);ctx.stroke();
    ctx.globalAlpha=1;
    // L6: Lower hut (fill covers canopy strokes)
    ctx.fillStyle=bgColor;
    ctx.beginPath();ctx.moveTo(sx-32,sy-58);ctx.lineTo(sx,sy-72);ctx.lineTo(sx+32,sy-58);ctx.closePath();ctx.fill();
    ctx.fillRect(sx-28,sy-58,56,28);
    ctx.fillRect(sx+6,sy-48,12,18);
    ctx.strokeStyle=clr;ctx.lineWidth=1.8;ctx.strokeRect(sx-28,sy-58,56,28);
    ctx.beginPath();ctx.moveTo(sx-32,sy-58);ctx.lineTo(sx,sy-72);ctx.lineTo(sx+32,sy-58);ctx.stroke();
    ctx.lineWidth=1.3;ctx.strokeRect(sx-18,sy-52,10,8);
    ctx.lineWidth=0.8;ctx.globalAlpha=0.4;
    ctx.beginPath();ctx.moveTo(sx-13,sy-52);ctx.lineTo(sx-13,sy-44);ctx.stroke();
    ctx.beginPath();ctx.moveTo(sx-18,sy-48);ctx.lineTo(sx-8,sy-48);ctx.stroke();
    ctx.globalAlpha=1;
    ctx.lineWidth=1.3;ctx.strokeRect(sx+6,sy-48,12,18);
    ctx.beginPath();ctx.arc(sx+15,sy-40,1.2,0,Math.PI*2);ctx.fillStyle=clr;ctx.globalAlpha=0.5;ctx.fill();ctx.globalAlpha=1;
    // L7: Upper lookout (fill covers canopy strokes)
    ctx.fillStyle=bgColor;ctx.fillRect(sx-40,sy-92,36,18);
    ctx.strokeStyle=clr;ctx.lineWidth=1.6;ctx.strokeRect(sx-40,sy-92,36,18);
    ctx.lineWidth=1.2;ctx.globalAlpha=0.6;
    ctx.beginPath();ctx.moveTo(sx-40,sy-92);ctx.lineTo(sx-40,sy-100);ctx.stroke();
    ctx.beginPath();ctx.moveTo(sx-22,sy-92);ctx.lineTo(sx-22,sy-100);ctx.stroke();
    ctx.beginPath();ctx.moveTo(sx-40,sy-98);ctx.lineTo(sx-22,sy-98);ctx.stroke();
    ctx.globalAlpha=1;
    ctx.lineWidth=1.0;ctx.globalAlpha=0.7;ctx.strokeRect(sx-36,sy-88,8,6);ctx.globalAlpha=1;
    // L8: Flag
    ctx.strokeStyle=clr;ctx.lineWidth=1.2;
    ctx.beginPath();ctx.moveTo(sx,sy-110);ctx.lineTo(sx,sy-122);ctx.stroke();
    ctx.fillStyle=clr;ctx.globalAlpha=0.7;
    ctx.beginPath();ctx.moveTo(sx,sy-122);ctx.lineTo(sx+10,sy-119);ctx.lineTo(sx,sy-116);ctx.closePath();ctx.fill();
    ctx.globalAlpha=1;
    _drawBuildingLabel(ctx,sx,sy-132,'Co-op');
  }
  // front layer: re-draw everything (internal layering handles z-order)
  if(layer==='front') _drawTreehouse(ctx,sx,sy,'behind');
}

function _drawTank(ctx, sx, sy, tank) {
  const clr = _cachedClr;

  // Hull (rotated to tank.angle)
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(tank.angle);

  // Tracks
  ctx.strokeStyle = clr; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.strokeRect(-25, -18, 50, 8);   // left track
  ctx.strokeRect(-25, 10, 50, 8);    // right track
  // Track tread animation (dashed lines that scroll)
  if (Math.abs(tank.speed) > 0.01) {
    ctx.setLineDash([3, 3]);
    ctx.lineDashOffset = -(tank._trackOffset || 0);
    ctx.beginPath();
    ctx.moveTo(-25, -14); ctx.lineTo(25, -14);
    ctx.moveTo(-25, 14); ctx.lineTo(25, 14);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Hull body fill
  ctx.fillStyle = clr; ctx.globalAlpha = 0.12;
  _roundRect(ctx, -22, -14, 44, 28, 6); ctx.fill();
  ctx.globalAlpha = 1;
  // Hull body outline
  ctx.lineWidth = 1.5;
  _roundRect(ctx, -22, -14, 44, 28, 6); ctx.stroke();
  // Front indicator — visible arrow pointing forward
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(20, -6); ctx.lineTo(27, 0); ctx.lineTo(20, 6); ctx.stroke();
  // Filled arrowhead for extra visibility
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = clr;
  ctx.beginPath(); ctx.moveTo(20, -6); ctx.lineTo(27, 0); ctx.lineTo(20, 6); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;

  ctx.restore();

  // Turret (rotated to tank.turretAngle — independent of hull)
  ctx.save();
  ctx.translate(sx, sy);

  // Turret dome
  ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fillStyle = clr; ctx.globalAlpha = 0.15; ctx.fill();
  ctx.globalAlpha = 1; ctx.lineWidth = 1.5; ctx.strokeStyle = clr; ctx.stroke();

  // Barrel
  ctx.rotate(tank.turretAngle);
  ctx.fillStyle = clr; ctx.globalAlpha = 0.2;
  ctx.fillRect(8, -3, TANK_BARREL_LEN, 6);
  ctx.globalAlpha = 1; ctx.lineWidth = 1.5; ctx.strokeStyle = clr;
  ctx.strokeRect(8, -3, TANK_BARREL_LEN, 6);
  // Muzzle brake
  ctx.strokeRect(8 + TANK_BARREL_LEN - 2, -4.5, 8, 9);

  ctx.restore();

  // Character head (only when occupied)
  if (tank.occupied) {
    ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.strokeStyle = clr; ctx.lineWidth = 1.5; ctx.stroke();
    // Eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(sx - 1.5, sy - 1, 1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx + 1.5, sy - 1, 1, 0, Math.PI * 2); ctx.fill();
  }
}

// Universal interact prompt — used for tank, home, flag, and any future interactions
function _drawInteractPrompt(ctx, sx, sy, label, progress, yOffset) {
  const py = sy - (yOffset || 48);
  const bgColor = _currentBg || '#13141a';
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const fs = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--fs')) || 16;

  ctx.font = `bold ${fs}px var(--fn, sans-serif)`;
  const labelW = ctx.measureText(label).width;
  const btnSize = 35, btnR = 8, gap = 10;
  const totalW = btnSize + gap + labelW;
  const groupX = sx - totalW / 2;
  const bx = groupX, by = py - btnSize / 2;

  // Button background fill
  ctx.fillStyle = bgColor;
  _roundRect(ctx, bx - 2, by - 2, btnSize + 4, btnSize + 4, btnR + 2); ctx.fill();

  // Button border
  ctx.strokeStyle = _cachedClr; ctx.globalAlpha = 0.3; ctx.lineWidth = 2.5;
  _roundRect(ctx, bx, by, btnSize, btnSize, btnR); ctx.stroke();
  ctx.globalAlpha = 1;

  // Progress stroke — follows rounded rect path
  if (progress > 0) {
    const pw = btnSize, ph = btnSize, pr = btnR;
    // Perimeter: 4 straight sides + 4 quarter-circle corners
    const straightH = ph - 2 * pr, straightW = pw - 2 * pr;
    const perim = 2 * straightW + 2 * straightH + 2 * Math.PI * pr;
    const dashLen = progress * perim;
    ctx.strokeStyle = _cachedClr; ctx.lineWidth = 3.5;
    ctx.setLineDash([dashLen, perim]);
    // Offset so dash starts from top-center
    ctx.lineDashOffset = -(straightW / 2);
    _roundRect(ctx, bx, by, pw, ph, pr);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  // E letter — large, white for visibility
  ctx.fillStyle = isLight ? '#1C1F24' : '#ffffff';
  ctx.globalAlpha = progress > 0 ? 1 : 0.9;
  ctx.font = `bold ${Math.round(fs * 1.3)}px var(--fn, sans-serif)`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('E', bx + btnSize / 2, py + 1);
  ctx.globalAlpha = 1;

  // Label text — uses session font size
  ctx.fillStyle = _cachedClr;
  ctx.font = `bold ${fs}px var(--fn, sans-serif)`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(label, bx + btnSize + gap, py);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

function _drawTankPrompt(ctx, sx, sy, tank) {
  if (!_tankPromptVisible || tank.occupied) return;
  const progress = _tankEHeld ? Math.min(1, _tankEHoldT / TANK_E_HOLD_FRAMES) : 0;
  _drawInteractPrompt(ctx, sx, sy, 'Drive', progress, 52);
}

// ── Home interaction state ──
let _homePromptVisible = false;
let _homeEHeld = false;    // E key held down
let _homeEHoldT = 0;       // frames E has been held
const HOME_E_HOLD_FRAMES = 120; // ~2 seconds to activate
const HOME_INTERACT_RADIUS = 80;
// House solid footprint: character cannot walk into this rectangle
const HOME_FOOT_W = 68;  // slightly wider than house walls (w=64 + 4px buffer)
const HOME_FOOT_H = 26;  // from base up to door top
const CASTLE_FOOT_W = 94;
const CASTLE_FOOT_H = 30;
const SHOP_FOOT_W = 62;
const SHOP_FOOT_H = 20;
const JAIL_FOOT_W = 60;
const JAIL_FOOT_H = 22;
const TREEHOUSE_FOOT_W = 60;
const TREEHOUSE_FOOT_H = 30;

// Buildings never move after generation, but this used to rescan the whole
// object array on every call — and it's called several times per frame
// (character collision, creature tick, tank collision, depth sort). MD 08:
// computed once per world load (_rebuildWorldIndex clears the cache).
let _footprintCache = null;
function _getBuildingFootprints() {
  if (_footprintCache) return _footprintCache;
  const fps = [];
  _worldObjects.forEach(obj => {
    let fw, fh;
    if (obj.type === 'home') { fw = HOME_FOOT_W; fh = HOME_FOOT_H; }
    else if (obj.type === 'castle') { fw = CASTLE_FOOT_W; fh = CASTLE_FOOT_H; }
    else if (obj.type === 'shop') { fw = SHOP_FOOT_W; fh = SHOP_FOOT_H; }
    else if (obj.type === 'jail') { fw = JAIL_FOOT_W; fh = JAIL_FOOT_H; }
    else if (obj.type === 'treehouse') { fw = TREEHOUSE_FOOT_W; fh = TREEHOUSE_FOOT_H; }
    else return;
    fps.push({ x: obj.x, y: obj.y, hw: fw / 2, fh, top: obj.y - fh });
  });
  _footprintCache = fps;
  return fps;
}

// ── Tank state ──
let _inTank = false;
let _tankEHeld = false;
let _tankEHoldT = 0;
let _tankBoostFuel = 720;
let _tankBoostCooldown = 0;
let _tankBoosting = false;
let _tankBoostDepleted = false;
const TANK_BOOST_MAX = 2.4;
const TANK_BOOST_ACCEL = 0.06;
const TANK_BOOST_DURATION = 720;  // ~3 seconds at 240Hz
const TANK_BOOST_COOLDOWN = 120;  // short cooldown after depletion
const TANK_E_HOLD_FRAMES = 60;   // ~1 second to enter
const TANK_INTERACT_RADIUS = 75;
const TANK_FORWARD_MAX = 1.2;
const TANK_REVERSE_MAX = 0.6;
const TANK_ACCEL = 0.025;
const TANK_ROT_SPEED = 0.018;
const TANK_FIRE_COOLDOWN = 90;   // ~1.5 seconds
const TANK_HULL_W = 50;
const TANK_HULL_H = 30;
const TANK_BARREL_LEN = 28;
let _tankPromptVisible = false;
let _tankMouseWX = 0, _tankMouseWY = 0; // cached mouse world position
let _tankFireTimer = 0;

function _getTankObj() {
  return _worldObjects.find(o => o.type === 'tank');
}

function _getHomeObj() {
  return _worldObjects.find(o => o.type === 'home');
}

function _drawHomePrompt(ctx, sx, sy) {
  if (!_homePromptVisible) return;
  const progress = _homeEHeld ? Math.min(1, _homeEHoldT / HOME_E_HOLD_FRAMES) : 0;
  _drawInteractPrompt(ctx, sx, sy, 'Go Home', progress, 110);
}

// MD 06b issue 5: the platformer draws the SAME prompt through this bridge
// (its own ctx, our renderer), so the two modes can't drift apart again.
// Outside play mode _cachedClr can be stale — refresh it from the live
// accent before drawing.
window._dexDrawInteractPrompt = function (ctx, sx, sy, label, progress, yOffset) {
  if (!_active) _cachedClr = getAccent();
  _drawInteractPrompt(ctx, sx, sy, label, progress, yOffset);
};

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

function drawObject(obj) {
  const { sx, sy } = worldToScreen(obj.x, obj.y);
  const rand = seededRand(obj.seed);
  const clr = _cachedClr;
  const ctx = _worldCtx;
  ctx.strokeStyle = clr; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.setLineDash([]);

  if (obj.type === 'grass') {
    // MD 04: ambient sway (per-tuft phase from world x) plus a bend away
    // from the player brushing past. Stateless — recomputed from distance
    // each frame, so it costs one sin and one hypot per tuft, no storage.
    let bend = Math.sin(_fxTime * 0.011 + obj.x * 0.13) * 1.4;
    const pdx = obj.x - _charWorldX, pdy = obj.y - _charWorldY;
    const d2 = pdx * pdx + pdy * pdy;
    if (d2 < 4225) {   // within 65 world px
      const d = Math.sqrt(d2) || 1;
      bend += (pdx < 0 ? -1 : 1) * (1 - d / 65) * 5.5;
    }
    const blades = 5 + Math.floor(rand() * 5);
    const spread = 8 + rand() * 10;
    ctx.lineWidth = 1.0;
    for (let i = 0; i < blades; i++) {
      const bx = sx + (rand() - 0.5) * spread * 2;
      const h = 5 + rand() * 8;
      const lean = (rand() - 0.5) * 6;
      const tip = lean + (rand() - 0.5) * 3;
      // Taller blades catch more of the sway.
      const bladeBend = bend * (0.5 + h / 13 * 0.5);
      ctx.beginPath();
      ctx.moveTo(bx, sy);
      ctx.quadraticCurveTo(bx + lean * 0.5 + bladeBend * 0.45, sy - h * 0.5, bx + tip + bladeBend, sy - h);
      ctx.stroke();
    }
  }

  else if (obj.type === 'rock') {
    const r = (10 + rand() * 18) * (obj.big || 1);
    const points = 6 + Math.floor(rand() * 3);
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * Math.PI * 2 - Math.PI / 2;
      const pr = r * (0.65 + rand() * 0.55);
      const px = sx + Math.cos(angle) * pr;
      const py = sy + Math.sin(angle) * pr * 0.6;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = isDark ? 'rgba(130,130,140,0.28)' : 'rgba(40,42,48,0.45)';
    ctx.fill();
    if (rand() > 0.5) {
      const r2 = r * (0.3 + rand() * 0.3);
      // Offset the small rock to the SIDE, not on top
      const offX = (rand() > 0.5 ? 1 : -1) * (r + r2 * 0.5 + rand() * 4);
      const offY = rand() * 0.5 * r * 0.5;
      const pts2 = 5 + Math.floor(rand() * 2);
      ctx.beginPath();
      for (let i = 0; i < pts2; i++) {
        const a = (i / pts2) * Math.PI * 2;
        const pr = r2 * (0.7 + rand() * 0.4);
        ctx.lineTo(sx + offX + Math.cos(a) * pr, sy + offY + Math.sin(a) * pr * 0.6);
      }
      ctx.closePath();
      ctx.fillStyle = isDark ? 'rgba(120,120,130,0.22)' : 'rgba(38,40,46,0.38)';
      ctx.fill();
    }
  }

  else if (obj.type === 'shrub') {
    // MD 04: gentle foliage wobble — much subtler than grass.
    const shrubSway = Math.sin(_fxTime * 0.007 + obj.x * 0.07) * 0.8;
    const baseR = 8 + rand() * 10;
    const clusters = 4 + Math.floor(rand() * 3);
    ctx.lineWidth = 1.3;
    for (let i = 0; i < clusters; i++) {
      const angle = (i / clusters) * Math.PI;
      const dist = baseR * 0.55;
      const cx2 = sx + shrubSway * (0.5 + i / clusters) + Math.cos(angle) * dist * (rand() * 0.4 + 0.8);
      const cy2 = sy - baseR * 0.3 + Math.sin(angle) * dist * 0.5 * (rand() * 0.4 + 0.6);
      const r2 = baseR * (0.5 + rand() * 0.5);
      ctx.beginPath(); ctx.arc(cx2, cy2, r2, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(sx, sy - baseR * 0.25, baseR * 0.7, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy + baseR * 0.5); ctx.stroke();
    ctx.lineWidth = 1.0; ctx.beginPath(); ctx.moveTo(sx - baseR * 0.6, sy + baseR * 0.4); ctx.lineTo(sx + baseR * 0.6, sy + baseR * 0.4); ctx.stroke();
  }

  else if (obj.type === 'tree') {
    // obj.big (MD 08): landmark scale factor — the ancient tree reads from
    // half a screen away because everything scales, not just the canopy.
    const big = obj.big || 1;
    const trunkH = (22 + rand() * 18) * big;
    const trunkW = (2.5 + rand() * 1.5) * Math.sqrt(big);
    const canopyR = (14 + rand() * 12) * big;
    const canopyY = sy - trunkH;
    ctx.lineWidth = trunkW;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, canopyY + canopyR * 0.4); ctx.stroke();
    ctx.lineWidth = 1.4;
    [{x:0,y:0,r:canopyR},{x:-canopyR*0.5,y:canopyR*0.3,r:canopyR*0.75},{x:canopyR*0.5,y:canopyR*0.3,r:canopyR*0.75},{x:0,y:canopyR*0.5,r:canopyR*0.6}]
      .forEach(o => { ctx.beginPath(); ctx.arc(sx+o.x, canopyY+o.y, o.r, 0, Math.PI*2); ctx.stroke(); });
    if (rand() > 0.4) {
      const bY = sy - trunkH * (0.35 + rand() * 0.2);
      const bDir = rand() > 0.5 ? 1 : -1;
      ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(sx, bY); ctx.lineTo(sx + bDir * (8 + rand() * 6), bY - (4 + rand() * 4)); ctx.stroke();
    }
  }

  // ── MD 08 types ──
  // Same language as everything above: thin strokes in the live accent,
  // neutral low-alpha fills keyed to theme (the rock precedent), geometry
  // from the object's seed so it never flickers frame to frame.

  else if (obj.type === 'pond') {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const r = obj.r || 90;
    // Seeded wobbly shoreline (plan view, squashed like rock bases).
    const pts = 12 + Math.floor(rand() * 4);
    ctx.beginPath();
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const pr = r * (0.82 + rand() * 0.3);
      const px = sx + Math.cos(a) * pr, py = sy + Math.sin(a) * pr * 0.55;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = isDark ? 'rgba(170,195,225,0.09)' : 'rgba(35,55,85,0.09)';
    ctx.fill();
    ctx.strokeStyle = clr; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.55;
    ctx.stroke();
    // Drifting ripple arcs — phase from world x, same trick as grass sway.
    ctx.lineWidth = 1; ctx.globalAlpha = 0.3;
    for (let i = 0; i < 3; i++) {
      const ph = _fxTime * 0.006 + obj.x * 0.05 + i * 2.1;
      const rr = r * (0.25 + 0.16 * i) + Math.sin(ph) * 3;
      const ox = (rand() - 0.5) * r * 0.5, oy = (rand() - 0.5) * r * 0.25;
      ctx.beginPath(); ctx.arc(sx + ox, sy + oy, rr * 0.4, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  else if (obj.type === 'flower') {
    // Small meadow bloom cluster — the one place the accent gets to be loud.
    const blooms = 1 + Math.floor(rand() * 3);
    const sway = Math.sin(_fxTime * 0.009 + obj.x * 0.11) * 1.1;
    ctx.lineWidth = 1;
    for (let i = 0; i < blooms; i++) {
      const bx = sx + (rand() - 0.5) * 16;
      const h = 7 + rand() * 6;
      const hx = bx + sway * (0.6 + h / 13 * 0.4), hy = sy - h;
      ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.moveTo(bx, sy); ctx.quadraticCurveTo(bx + sway * 0.4, sy - h * 0.6, hx, hy); ctx.stroke();
      const petals = 4 + Math.floor(rand() * 2), pr = 1.4 + rand() * 0.9;
      for (let p = 0; p < petals; p++) {
        const pa = (p / petals) * Math.PI * 2 + rand() * 0.5;
        ctx.beginPath(); ctx.arc(hx + Math.cos(pa) * pr * 1.5, hy + Math.sin(pa) * pr * 1.5, pr, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(hx, hy, 0.9, 0, Math.PI * 2); ctx.fillStyle = clr; ctx.fill();
    }
  }

  else if (obj.type === 'log') {
    const len = (26 + rand() * 20) * (obj.big || 1);
    const ang = (rand() - 0.5) * 0.9;
    const th = 5 + rand() * 3;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const x0 = sx - ca * len / 2, y0 = sy - sa * len / 2;
    const x1 = sx + ca * len / 2, y1 = sy + sa * len / 2;
    const nx = -sa * th / 2, ny = ca * th / 2;
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(x0 + nx, y0 + ny); ctx.lineTo(x1 + nx, y1 + ny); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0 - nx, y0 - ny); ctx.lineTo(x1 - nx, y1 - ny); ctx.stroke();
    // Cut end: ellipse + one growth ring.
    ctx.beginPath(); ctx.ellipse(x1, y1, th * 0.35, th * 0.62, ang, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.ellipse(x1, y1, th * 0.16, th * 0.3, ang, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.ellipse(x0, y0, th * 0.35, th * 0.62, ang, 0, Math.PI * 2); ctx.stroke();
    if (rand() > 0.5) {  // branch stub
      const t = 0.3 + rand() * 0.4;
      const bx2 = x0 + (x1 - x0) * t, by2 = y0 + (y1 - y0) * t;
      ctx.beginPath(); ctx.moveTo(bx2, by2 - th / 2); ctx.lineTo(bx2 + (rand() - 0.5) * 8, by2 - th / 2 - 5 - rand() * 4); ctx.stroke();
    }
  }

  else if (obj.type === 'menhir') {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const h = (26 + rand() * 16) * (obj.big || 1);
    const w = h * (0.3 + rand() * 0.14);
    const lean = (rand() - 0.5) * 0.16;
    // Irregular tapered slab, drawn base-up.
    const topX = sx + lean * h;
    ctx.beginPath();
    ctx.moveTo(sx - w / 2, sy);
    ctx.lineTo(sx - w / 2 - 2 + rand() * 3, sy - h * (0.45 + rand() * 0.15));
    ctx.lineTo(topX - w * (0.22 + rand() * 0.12), sy - h);
    ctx.lineTo(topX + w * (0.2 + rand() * 0.12), sy - h * (0.92 + rand() * 0.06));
    ctx.lineTo(sx + w / 2 + 1 + rand() * 3, sy - h * (0.4 + rand() * 0.2));
    ctx.lineTo(sx + w / 2, sy);
    ctx.closePath();
    ctx.fillStyle = isDark ? 'rgba(130,130,140,0.24)' : 'rgba(40,42,48,0.35)';
    ctx.fill();
    ctx.strokeStyle = clr; ctx.lineWidth = 1.4;
    ctx.stroke();
    // Weathering crack.
    ctx.globalAlpha = 0.45; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx + (rand() - 0.5) * w * 0.5, sy - h * (0.55 + rand() * 0.2));
    ctx.lineTo(sx + (rand() - 0.5) * w * 0.6, sy - h * (0.2 + rand() * 0.2));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  else if (obj.type === 'campfire') {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    // Stone ring.
    const stones = 7;
    ctx.fillStyle = isDark ? 'rgba(140,140,150,0.32)' : 'rgba(40,42,48,0.4)';
    for (let i = 0; i < stones; i++) {
      const a = (i / stones) * Math.PI * 2 + rand() * 0.4;
      const rr = 11 + rand() * 3;
      ctx.beginPath();
      ctx.ellipse(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr * 0.55, 2.4 + rand() * 1.2, 1.8 + rand(), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Charred sticks.
    ctx.strokeStyle = clr; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.8;
    for (let i = 0; i < 3; i++) {
      const a = rand() * Math.PI;
      ctx.beginPath();
      ctx.moveTo(sx - Math.cos(a) * 7, sy - 3 - Math.sin(a) * 3);
      ctx.lineTo(sx + Math.cos(a) * 7, sy - 3 + Math.sin(a) * 3);
      ctx.stroke();
    }
    // Ember glow — flickers on _fxTime, the only animated part.
    const flick = 0.5 + 0.3 * Math.sin(_fxTime * 0.05 + obj.x);
    ctx.globalAlpha = flick;
    ctx.fillStyle = clr;
    ctx.beginPath(); ctx.arc(sx, sy - 3, 1.6 + flick, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  else if (obj.type === 'home') {
    _drawHome(ctx, sx, sy, obj._layer || 'full');
  }
  else if (obj.type === 'castle') { _drawCastle(ctx, sx, sy); }
  else if (obj.type === 'shop') { _drawShop(ctx, sx, sy); }

}


let _cachedClr = '#5AAA72';

// ═══════════════════════════════════
//  PLAYER HP SYSTEM
// ═══════════════════════════════════

const PLAYER_MAX_HP = 100;
let _playerHP = PLAYER_MAX_HP;
let _playerDamageFlash = 0;    // visual flash timer (frames)
let _playerStunTimer = 0;      // stun duration (frames) — blocks movement
let _playerKnockVX = 0;        // knockback velocity
let _playerKnockVY = 0;
let _playerDead = false;
let _playerDeadTimer = 0;
let _playerHPBarTimer = 0;     // show HP bar for N frames after taking damage

function _syncHudHealthBar() {
  const bar = document.getElementById('hud-health-bar');
  if (!bar) return;
  const ratio = Math.max(0, _playerHP / PLAYER_MAX_HP);
  bar.style.width = (ratio * 100) + '%';
  // Color: green > yellow > red
  bar.style.background = ratio > 0.5 ? '#4ade80' : ratio > 0.25 ? '#e0a030' : '#e05c5c';
}

function _damagePlayer(amount, fromWX, fromWY) {
  if (_playerDead || _playerStunTimer > 0 || _invulnTimer > 0) return;
  // Tank armor — 50% damage reduction
  if (_inTank) amount = Math.ceil(amount * 0.5);
  _playerHP = Math.max(0, _playerHP - amount);
  _playerDamageFlash = 20;
  _playerStunTimer = 40;
  _playerHPBarTimer = 300; // show bar for 5 seconds
  _syncHudHealthBar();
  // Knockback away from damage source
  const dx = _charWorldX - (fromWX || _charWorldX);
  const dy = _charWorldY - (fromWY || _charWorldY);
  const dist = Math.hypot(dx, dy) || 1;
  _playerKnockVX = (dx / dist) * 3;
  _playerKnockVY = (dy / dist) * 3;
  // Non-fatal hit; the fatal path sounds via _dexSetCharDead below.
  if (_playerHP > 0) sfx('player.hurt');
  if (_playerHP <= 0) {
    _playerDead = true;
    _playerDeadTimer = 90; // 1.5 seconds before death screen
    _deathFadeAlpha = 0;
    _playerDamageFlash = 0;
    // Death FX (MD 04): the moment lands in slow motion — long hit-stop,
    // hard shake, and an accent burst where the player stood.
    window._dexHitStop?.(22, 0.25);
    _addShake(8);
    {
      const clrHex = (_cachedClr || '#7B8A9C').replace('#', '');
      const cr = parseInt(clrHex.slice(0, 2), 16), cg = parseInt(clrHex.slice(2, 4), 16), cb = parseInt(clrHex.slice(4, 6), 16);
      const lr = Math.min(255, cr + 110), lg = Math.min(255, cg + 110), lb = Math.min(255, cb + 110);
      _pPush({ wx: _charWorldX, wy: _charWorldY, vx: 0, vy: 0, life: 16, maxLife: 16, r: lr, g: lg, b: lb, size: 0, type: 'hitring' });
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
        const s = 0.7 + Math.random() * 1.5;
        _pAddParticle(_charWorldX, _charWorldY, Math.cos(a) * s, Math.sin(a) * s * 0.7 - 0.2,
          20 + Math.floor(Math.random() * 14), lr, lg, lb, 1 + Math.random() * 1.4, 'spark');
      }
    }
    if (window._dexSetCharDead) window._dexSetCharDead();
    // Deactivate hoverboard on death
    if (window._dexDeactivateHoverboard) window._dexDeactivateHoverboard();
  }
}

function _tickPlayerDamage() {
  if (_playerDamageFlash > 0) _playerDamageFlash -= _dt;
  if (_playerHPBarTimer > 0) _playerHPBarTimer -= _dt;
  if (_playerStunTimer > 0) {
    _playerStunTimer -= _dt;
    // Apply knockback with friction
    _charWorldX += _playerKnockVX * _dt;
    _charWorldY += _playerKnockVY * _dt;
    _charWorldX = Math.max(50, Math.min(WORLD_W - 50, _charWorldX));
    _charWorldY = Math.max(50, Math.min(WORLD_H - 50, _charWorldY));
    _playerKnockVX *= Math.pow(0.88, _dt);
    _playerKnockVY *= Math.pow(0.88, _dt);
  }
  if (_playerDead) {
    _playerDeadTimer -= _dt;
    if (_playerDeadTimer <= 0 && !_deathScreenVisible) {
      _showDeathScreen();
    }
  }
}

function _drawPlayerHP(ctx, sx, sy) {
  // Damage flash — red overlay on character
  if (_playerDamageFlash > 0) {
    const flashAlpha = (_playerDamageFlash / 20) * 0.35;
    ctx.globalAlpha = flashAlpha;
    ctx.fillStyle = '#e05c5c';
    ctx.beginPath(); ctx.arc(sx, sy - 30, 28, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // HP bar above character (shows when damaged)
  if (_playerHPBarTimer > 0 && _playerHP < PLAYER_MAX_HP) {
    const barW = 36, barH = 3;
    const barX = sx - barW / 2, barY = sy - 72;
    const fade = _playerHPBarTimer < 60 ? _playerHPBarTimer / 60 : 1;
    ctx.globalAlpha = fade;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(barX, barY, barW, barH);
    const ratio = _playerHP / PLAYER_MAX_HP;
    ctx.fillStyle = ratio > 0.5 ? '#5AAA72' : ratio > 0.25 ? '#e0a030' : '#e05c5c';
    ctx.fillRect(barX, barY, barW * ratio, barH);
    ctx.globalAlpha = 1;
  }
  // Dead dim overlay — handled by DOM death screen element (z:9200)
}

export function isPlayerStunned() { return _playerStunTimer > 0 || _playerDead || _deathScreenVisible; }

// Bridge for character.js arrow death to trigger play mode death screen
window._dexShowDeathScreen = function() { _showDeathScreen(); };

// ═══════════════════════════════════
//  DEATH SCREEN
// ═══════════════════════════════════

let _deathScreenVisible = false;
let _deathScreenEl = null;
let _invulnTimer = 0;
let _deathFadeAlpha = 0; // gradual overlay fade-in

function _createDeathScreen() {
  if (_deathScreenEl) return;
  _deathScreenEl = document.createElement('div');
  _deathScreenEl.id = 'pm-death-screen';
  _deathScreenEl.style.cssText = 'display:none;position:fixed;inset:0;z-index:9200;align-items:center;justify-content:flex-start;flex-direction:column;gap:16px;padding-top:35vh;pointer-events:auto;background:rgba(0,0,0,0.55);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);';
  _deathScreenEl.innerHTML = `
    <div style="font-size:28px;font-weight:700;font-family:var(--fn);color:var(--clr-adj);">You Died</div>
    <button id="pm-death-ok" style="padding:10px 32px;border-radius:8px;border:2px solid var(--clr-adj);background:none;color:var(--clr-adj);font-family:var(--fn);font-size:16px;font-weight:600;cursor:pointer;transition:background 0.15s;">OK</button>`;
  document.body.appendChild(_deathScreenEl);
  document.getElementById('pm-death-ok').addEventListener('click', _respawnPlayer);
}

function _showDeathScreen() {
  _deathScreenVisible = true;
  _createDeathScreen();
  _deathScreenEl.style.opacity = '0';
  _deathScreenEl.style.display = 'flex';
  _deathScreenEl.style.transition = 'opacity 0.8s ease';
  requestAnimationFrame(() => { requestAnimationFrame(() => { _deathScreenEl.style.opacity = '1'; }); });
}

function _respawnPlayer() {
  sfx('player.respawn');
  _deathScreenVisible = false;
  _deathFadeAlpha = 0;
  if (_deathScreenEl) {
    _deathScreenEl.style.transition = 'opacity 0.3s ease';
    _deathScreenEl.style.opacity = '0';
    setTimeout(() => { if (_deathScreenEl) _deathScreenEl.style.display = 'none'; }, 300);
  }
  _playerDead = false;
  _playerHP = PLAYER_MAX_HP;
  _playerStunTimer = 0;
  _playerDamageFlash = 0;
  _playerKnockVX = 0; _playerKnockVY = 0;
  _invulnTimer = 120; // 2 seconds invulnerability
  _syncHudHealthBar();

  // Determine spawn point: flag > home
  if (_flagPlanted) {
    _charWorldX = _flagWX;
    _charWorldY = _flagWY;
  } else {
    const home = _getHomeObj();
    if (home) { _charWorldX = home.x; _charWorldY = home.y + 30; }
  }
  // Snap camera
  _camera.x = _charWorldX; _cameraTarget.x = _charWorldX;
  _camera.y = _charWorldY; _cameraTarget.y = _charWorldY;

  // Respawn FX (MD 04): an expanding accent ring and a rising sparkle
  // column at the spawn point — arrival should feel like an event.
  {
    const clrHex = (_cachedClr || '#7B8A9C').replace('#', '');
    const cr = parseInt(clrHex.slice(0, 2), 16), cg = parseInt(clrHex.slice(2, 4), 16), cb = parseInt(clrHex.slice(4, 6), 16);
    const lr = Math.min(255, cr + 110), lg = Math.min(255, cg + 110), lb = Math.min(255, cb + 110);
    _pPush({ wx: _charWorldX, wy: _charWorldY, vx: 0, vy: 0, life: 22, maxLife: 22, r: lr, g: lg, b: lb, size: 0, type: 'hitring' });
    for (let i = 0; i < 10; i++) {
      _pAddParticle(_charWorldX + (Math.random() - 0.5) * 24, _charWorldY + (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 0.2, -0.5 - Math.random() * 0.7,
        26 + Math.floor(Math.random() * 16), lr, lg, lb, 0.8 + Math.random() * 1.2, 'spark');
    }
  }

  // Notify character.js to reset death state
  if (window._dexResetCharDeath) window._dexResetCharDeath();
}

// ═══════════════════════════════════
//  CHECKPOINT FLAG
// ═══════════════════════════════════

let _flagPlanted = false;
let _flagWX = 0, _flagWY = 0;
let _flagHP = 2;
let _flagRespawnTimer = 0;          // frames until flag returns to inventory after destruction
const FLAG_RESPAWN_DELAY = 600;     // 10 seconds
let _flagPromptVisible = false;
let _flagEHeld = false;
let _flagEHoldT = 0;
const FLAG_PICKUP_HOLD = 30;        // 0.5 seconds
const FLAG_PICKUP_RANGE = 40;

function _drawFlag(ctx, sx, sy) {
  const clr = _cachedClr;
  const t = Date.now() * 0.001;

  // Pole — taller
  const poleH = 34;
  ctx.strokeStyle = clr; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - poleH); ctx.stroke();

  // Flag fabric — waving with multiple wave harmonics
  const topY = sy - poleH;
  const botY = sy - poleH + 14; // flag height
  const flagW = 18;
  // Wave offsets at different points along the flag
  const w1 = Math.sin(t * 3.5) * 3;                    // near pole
  const w2 = Math.sin(t * 3.5 + 1.2) * 4.5;            // mid flag
  const w3 = Math.sin(t * 3.5 + 2.4) * 5.5;            // tip of flag
  // Top edge (curves from pole to tip)
  ctx.fillStyle = clr; ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(sx, topY);
  ctx.quadraticCurveTo(sx + flagW * 0.4 + w1, topY - 1 + w1 * 0.3, sx + flagW * 0.7 + w2, topY + 1 + w2 * 0.2);
  ctx.lineTo(sx + flagW + w3, topY + 7 + w3 * 0.15); // tip
  ctx.quadraticCurveTo(sx + flagW * 0.7 + w2, botY - 1 + w2 * 0.2, sx + flagW * 0.4 + w1, botY + w1 * 0.3);
  ctx.lineTo(sx, botY);
  ctx.closePath();
  ctx.fill();
  // Outline
  ctx.globalAlpha = 0.8; ctx.lineWidth = 1;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Base mound
  ctx.fillStyle = clr; ctx.globalAlpha = 0.25;
  ctx.beginPath(); ctx.ellipse(sx, sy, 5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  // Subtle glow pulse
  const pulse = 0.1 + Math.sin(t * 2) * 0.05;
  ctx.fillStyle = clr; ctx.globalAlpha = pulse;
  ctx.beginPath(); ctx.arc(sx, sy - poleH * 0.5, 14, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}

function _drawFlagPrompt(ctx, sx, sy) {
  if (!_flagPromptVisible) return;
  const progress = _flagEHeld ? Math.min(1, _flagEHoldT / FLAG_PICKUP_HOLD) : 0;
  _drawInteractPrompt(ctx, sx, sy, 'Pick up', progress, 50);
}

// Place flag at player position (called from character.js)
window._dexPlantFlag = function() {
  if (!_active) return;
  // Remove old flag
  _flagPlanted = true;
  _flagWX = _charWorldX;
  _flagWY = _charWorldY;
  _flagHP = 2;
  _flagRespawnTimer = 0;
};

function _destroyFlag() {
  if (!_flagPlanted) return;
  _flagPlanted = false;
  // Destruction particles
  const clrHex = (_cachedClr || '#7B8A9C').replace('#', '');
  const r = parseInt(clrHex.slice(0, 2), 16), g = parseInt(clrHex.slice(2, 4), 16), b = parseInt(clrHex.slice(4, 6), 16);
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 0.3 + Math.random() * 0.8;
    _pAddParticle(_flagWX, _flagWY, Math.cos(a) * spd, Math.sin(a) * spd * 0.4 - 0.2,
      25 + Math.floor(Math.random() * 15), r, g, b, 1 + Math.random() * 2, 'smoke');
  }
  // Start respawn timer
  _flagRespawnTimer = FLAG_RESPAWN_DELAY;
  // Toast notification
  _showFlagToast('Your flag was destroyed!');
}

function _showFlagToast(msg) {
  const existing = document.getElementById('flag-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'flag-toast';
  toast.textContent = msg;
  toast.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:var(--clr-adj,#e05c5c);font-family:var(--fn);font-size:13px;font-weight:600;padding:8px 18px;border-radius:20px;pointer-events:none;z-index:300;opacity:1;transition:opacity 0.4s ease;';
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; }, 2500);
  setTimeout(() => toast.remove(), 3000);
}

function _tickFlag() {
  // Invulnerability timer
  if (_invulnTimer > 0) _invulnTimer -= _dt;

  // Flag respawn timer (flag destroyed → returns to inventory)
  if (_flagRespawnTimer > 0) {
    _flagRespawnTimer -= _dt;
    if (_flagRespawnTimer <= 0) {
      _flagRespawnTimer = 0;
      if (window._dexFlagRespawned) window._dexFlagRespawned();
      _showFlagToast('Flag returned to inventory');
    }
  }

  if (!_flagPlanted) return;

  // Enemy damage to flag
  for (const c of _liveCreatures) {
    if (c.dead) continue;
    const dx = c.x - _flagWX, dy = c.y - _flagWY;
    const dist = Math.hypot(dx, dy);
    // Mammoth charge contact
    if (c.kind === 'mammoth' && c.charging && dist < 30) {
      _flagHP--;
      if (_flagHP <= 0) { _destroyFlag(); return; }
    }
    // Any creature overlap (close contact)
    if (dist < 15) {
      _flagHP--;
      if (_flagHP <= 0) { _destroyFlag(); return; }
    }
  }
}

// Flag pickup via E key
function _tryFlagPickup(pressed) {
  if (!_flagPlanted || !_flagPromptVisible) { _flagEHeld = false; _flagEHoldT = 0; return false; }
  _flagEHeld = !!pressed;
  if (!pressed) { _flagEHoldT = 0; return true; }
  return true;
}

function _tickFlagPickupHold() {
  if (!_flagEHeld || !_flagPromptVisible) { _flagEHoldT = 0; return; }
  _flagEHoldT += _dt;
  if (_flagEHoldT >= FLAG_PICKUP_HOLD) {
    _flagEHeld = false; _flagEHoldT = 0;
    _flagPlanted = false;
    if (window._dexFlagRespawned) window._dexFlagRespawned(); // add back to inventory
    _showFlagToast('Flag picked up');
  }
}

export function getFlagSpawn() {
  if (_flagPlanted) return { x: _flagWX, y: _flagWY };
  return null;
}

// ═══════════════════════════════════
//  PUFFER BUG CONSTANTS
// ═══════════════════════════════════

const PUFFER_FUSE = 900;          // 15 seconds at 60fps (dt-scaled)
const PUFFER_AGGRO_RANGE = 200;
const PUFFER_LEASH_RANGE = 500;
const PUFFER_BASE_SPEED = 0.3;
const PUFFER_MAX_SPEED = 1.5;
const PUFFER_MAX_SCALE = 2.2;
const PUFFER_IDLE_SPEED = 0.15;
const PUFFER_DAMAGE = 50;        // 50% of PLAYER_MAX_HP
const MAX_PUFFERS = 8;
const PUFFER_IDLE_RADIUS = 14;   // base body radius
const PUFFER_SPIKE_COUNT = 8;
const PUFFER_SPIKE_BASE_LEN = 12;
const PUFFER_SPIKE_MAX_LEN = 30;
const PUFFER_EXPLOSION_RADIUS = 60;

// ═══════════════════════════════════
//  LIVE CREATURES — yaks, birds, deer, mammoths, puffers
// ═══════════════════════════════════

const _liveCreatures = [];
const _bloodSplats = []; // persistent blood puddles on the ground
const _worldParticles = []; // canvas-drawn particles in world coords
const _goreParticles = []; // canvas gore: blood, feathers, body parts

function _bloodColor() {
  return (window._dexBloodEnabled === false) ? (_cachedClr || '#7B8A9C') : '#e05c5c';
}

function _spawnLiveCreatures() {
  _liveCreatures.length = 0;
  _bloodSplats.length = 0;
  // All initial state uses seeded rand so every client spawns creatures at the same
  // positions moving in the same direction. They diverge as players interact with them.
  const rand = seededRand(99);
  function ms(v, min) { return Math.abs(v) < min ? (v < 0 ? -min : min) : v; }
  const fps = _getBuildingFootprints();
  function _safePos(x, y) {
    for (const fp of fps) {
      if (x > fp.x - fp.hw && x < fp.x + fp.hw && y > fp.top && y < fp.y) {
        x = x < fp.x ? fp.x - fp.hw - 10 : fp.x + fp.hw + 10;
      }
    }
    return { x, y };
  }
  // MD#6: stricter spawn rule for hostile creatures (mammoths, puffers).
  // Forbid spawn within HOSTILE_SPAWN_RADIUS of the player spawn (home)
  // and of each structure footprint center. If the seeded position lands
  // inside, push it radially outward to the radius boundary so the random
  // sequence is preserved (no rerolling — keeps multiplayer determinism).
  const HOSTILE_SPAWN_RADIUS = 320; // ~3.5 building widths — outside aggro range
  const home = _worldObjects.find(o => o.type === 'home');
  const _spawnSafeZones = [];
  if (home) _spawnSafeZones.push({ x: home.x, y: home.y + 30 }); // player spawn
  _worldObjects.forEach(o => {
    if (['home','treehouse','castle','shop','jail','tank'].includes(o.type)) {
      _spawnSafeZones.push({ x: o.x, y: o.y });
    }
  });
  function _safeHostilePos(x, y) {
    // First apply the normal building-footprint nudge.
    let pos = _safePos(x, y);
    // Then enforce min-distance from each safe zone.
    for (const z of _spawnSafeZones) {
      const dx = pos.x - z.x, dy = pos.y - z.y;
      const d = Math.sqrt(dx*dx + dy*dy);
      if (d < HOSTILE_SPAWN_RADIUS) {
        // Push outward along the same vector. Edge case: exact center —
        // pick a deterministic direction (right) so seeded clients agree.
        if (d < 0.01) {
          pos.x = z.x + HOSTILE_SPAWN_RADIUS;
          pos.y = z.y;
        } else {
          const k = HOSTILE_SPAWN_RADIUS / d;
          pos.x = z.x + dx * k;
          pos.y = z.y + dy * k;
        }
      }
    }
    // Clamp inside world bounds so we don't push off-map.
    pos.x = Math.max(40, Math.min(WORLD_W - 40, pos.x));
    pos.y = Math.max(40, Math.min(WORLD_H - 40, pos.y));
    // Re-apply building nudge in case the radial push landed on a structure.
    return _safePos(pos.x, pos.y);
  }
  for (let i = 0; i < 8; i++) {
    const _yx = 400+rand()*6400, _yy = 400+rand()*3700;
    rand(); rand(); // consume seeded velocity slots to keep sequence stable
    const hpRoll = rand();
    const hp = hpRoll < 0.25 ? 4 : hpRoll < 0.65 ? 5 : hpRoll < 0.90 ? 6 : 7;
    const {x,y} = _safePos(_yx, _yy);
    _liveCreatures.push({ kind:'yak', x, y,
      vx:ms((rand()-0.5)*0.4, 0.12), vy:ms((rand()-0.5)*0.2, 0.08),
      hp, maxHp:hp, dead:false, deadT:0, scale:0.9+rand()*0.6, dirTimer:Math.floor(rand()*200)+40 });
  }
  for (let i = 0; i < 28; i++) {
    const x = rand()*WORLD_W, y = 200+rand()*4000;
    rand(); rand();
    _liveCreatures.push({ kind:'bird', x, y,
      vx:ms((rand()-0.5)*0.6, 0.18), vy:ms((rand()-0.5)*0.3, 0.10),
      hp:1, dead:false, deadT:0, flapT:rand()*Math.PI*2, dirTimer:Math.floor(rand()*300)+60 });
  }
  for (let i = 0; i < 4; i++) {
    const _dx = 600+rand()*6000, _dy = 600+rand()*3300;
    rand(); rand();
    const hpRoll2 = rand();
    const hp2 = hpRoll2 < 0.25 ? 4 : hpRoll2 < 0.65 ? 5 : hpRoll2 < 0.90 ? 6 : 7;
    const {x,y} = _safePos(_dx, _dy);
    _liveCreatures.push({ kind:'deer', x, y,
      vx:ms((rand()-0.5)*0.35, 0.10), vy:ms((rand()-0.5)*0.15, 0.07),
      hp:hp2, maxHp:hp2, dead:false, deadT:0, scale:0.9+rand()*0.4, dirTimer:Math.floor(rand()*250)+40 });
  }
  for (let i = 0; i < 2; i++) {
    const _mx = 1200+rand()*4800, _my = 800+rand()*2800;
    rand(); rand();
    const {x,y} = _safeHostilePos(_mx, _my); // MD#6: keep mammoths off spawn
    _liveCreatures.push({ kind:'mammoth', x, y,
      vx:ms((rand()-0.5)*0.18, 0.08), vy:ms((rand()-0.5)*0.12, 0.06),
      hp:12, maxHp:12, dead:false, deadT:0, scale:1.0+rand()*0.3,
      dirTimer:Math.floor(rand()*300)+60,
      charging:false, chargeTimer:0, chargeVx:0, chargeVy:0, aggroRange:180,
      _woundCount:0, _bloodTrail:[], _trailTimer:0 });
  }
  // Puffer bugs — floating mines with size variation
  for (let i = 0; i < MAX_PUFFERS; i++) {
    const _px = 300+rand()*6600, _py = 300+rand()*3900;
    rand(); rand();
    const baseScale = 0.6 + rand() * 0.8;
    const {x,y} = _safeHostilePos(_px, _py); // MD#6: keep pufferes off spawn
    _liveCreatures.push({ kind:'puffer', x, y,
      vx:(rand()-0.5)*PUFFER_IDLE_SPEED*2, vy:(rand()-0.5)*PUFFER_IDLE_SPEED*2,
      hp:3, maxHp:3, dead:false, deadT:0, scale:baseScale, baseScale,
      dirTimer:120+Math.floor(rand()*180),
      aggro:false, aggroTimer:0, aggroSpeed:PUFFER_BASE_SPEED,
      bobT:rand()*Math.PI*2, breatheT:rand()*Math.PI*2,
      _woundCount:0, _bloodTrail:null, _trailTimer:0 });
  }
}

function _tickLiveCreatures() {
  const _buildingFootprints = _getBuildingFootprints();
  for (const c of _liveCreatures) {
    if (c.dead) { c.deadT += _dt; continue; }
    if (c._carried) {
      // Drip blood while being carried
      if (c._woundCount > 0) {
        c._trailTimer = (c._trailTimer || 0) + _dt;
        const interval = Math.max(25, Math.floor(80 / c._woundCount));
        if (c._trailTimer >= interval) {
          c._trailTimer = 0;
          if (!c._bloodTrail) c._bloodTrail = [];
          const noiseX = (Math.random()-0.5)*24 + (Math.random()-0.5)*12;
          const noiseY = (Math.random()-0.5)*18 + (Math.random()-0.5)*8;
          const sizeRoll = Math.random();
          const rx = sizeRoll < 0.5 ? 1.0+Math.random()*1.5 : sizeRoll < 0.85 ? 2.0+Math.random()*2.5 : 4.0+Math.random()*3.0;
          const ry = rx * (0.35+Math.random()*0.3);
          c._bloodTrail.push({ wx: c.x + noiseX, wy: c.y + noiseY, age: 0, rx, ry });
          if (c._bloodTrail.length > 35) c._bloodTrail.shift();
        }
      }
      if (c._bloodTrail) {
        for (const drop of c._bloodTrail) drop.age += _dt;
        c._bloodTrail = c._bloodTrail.filter(d => d.age < 600);
      }
      continue;
    }
    // Play mode stun — creature lies still
    if (c._pmStunTimer > 0) {
      c._pmStunTimer -= _dt;
      c.vx = 0; c.vy = 0;
      continue;
    }
    // Thrown creature — arc trajectory with friction
    if (c._thrown) {
      c.x += (c.vx || 0) * _dt;
      c.y += (c.vy || 0) * _dt;
      // Friction + slight curve for arc (perpendicular drift)
      const spd2 = Math.hypot(c.vx || 0, c.vy || 0);
      if (spd2 > 0.3) {
        // Add tiny perpendicular force for arc (always curves same direction)
        if (!c._arcDir) c._arcDir = Math.random() < 0.5 ? 1 : -1;
        const perpX = -(c.vy || 0) * 0.008 * c._arcDir * _dt;
        const perpY = (c.vx || 0) * 0.008 * c._arcDir * _dt;
        c.vx += perpX;
        c.vy += perpY;
      }
      c.vx *= Math.pow(0.992, _dt);
      c.vy *= Math.pow(0.992, _dt);
      c._thrownTimer = (c._thrownTimer || 0) - _dt;
      const spd = Math.hypot(c.vx, c.vy);
      if (c._thrownTimer <= 0 || spd < 0.05) {
        c._thrown = false;
        c._arcDir = undefined;
        // Stun only on charged throws
        if (c._throwPower > 0.3) {
          c.vx = 0; c.vy = 0;
          c._pmStunTimer = 80;
        } else {
          // Land on feet, resume wandering
          c.vx = (Math.random() - 0.5) * 0.3;
          c.vy = (Math.random() - 0.5) * 0.15;
        }
        c._throwPower = undefined;
        c.dirTimer = 60;
      }
      continue;
    }
    c.dirTimer -= _dt;
    if (c.dirTimer <= 0 && c.kind !== 'puffer') {
      const bvx = (Math.random()-0.5) * (c.kind==='bird'?0.6:0.4);
      const bvy = (Math.random()-0.5) * (c.kind==='bird'?0.4:0.2);
      const mvx = c.kind==='bird' ? 0.18 : 0.10;
      const mvy = c.kind==='bird' ? 0.10 : 0.07;
      c.vx = Math.abs(bvx) < mvx ? (bvx < 0 ? -mvx : mvx) : bvx;
      c.vy = Math.abs(bvy) < mvy ? (bvy < 0 ? -mvy : mvy) : bvy;
      c.dirTimer = 120 + Math.floor(Math.random()*200);
    }
    c.x += c.vx * _dt; c.y += c.vy * _dt;
    // Boundary bounce
    if (c.x < 50) { c.x = 50; c.vx = Math.abs(c.vx); }
    if (c.x > WORLD_W-50) { c.x = WORLD_W-50; c.vx = -Math.abs(c.vx); }
    if (c.y < 50) { c.y = 50; c.vy = Math.abs(c.vy); }
    if (c.y > WORLD_H-50) { c.y = WORLD_H-50; c.vy = -Math.abs(c.vy); }
    // Building collision — push creatures out of footprints (skip birds)
    if (c.kind !== 'bird') {
      for (const fp of _buildingFootprints) {
        if (c.x > fp.x - fp.hw && c.x < fp.x + fp.hw && c.y > fp.top && c.y < fp.y) {
          const pushL = c.x - (fp.x - fp.hw);
          const pushR = (fp.x + fp.hw) - c.x;
          const pushT = c.y - fp.top;
          const pushB = fp.y - c.y;
          const min = Math.min(pushL, pushR, pushT, pushB);
          if (min === pushL) { c.x = fp.x - fp.hw; c.vx = -Math.abs(c.vx); }
          else if (min === pushR) { c.x = fp.x + fp.hw; c.vx = Math.abs(c.vx); }
          else if (min === pushT) { c.y = fp.top; c.vy = -Math.abs(c.vy); }
          else { c.y = fp.y; c.vy = Math.abs(c.vy); }
        }
      }
    }
    if (c.kind === 'bird') c.flapT += 0.06 * _dt;
    // Mammoth charge AI
    if (c.kind === 'mammoth' && !c.dead) {
      if (c.charging) {
        c.x += c.chargeVx * _dt; c.y += c.chargeVy * _dt;
        c.chargeTimer -= _dt;
        if (c.chargeTimer <= 0) { c.charging = false; c.vx = (Math.random()-0.5)*0.18; c.vy = (Math.random()-0.5)*0.12; c.dirTimer = 180+Math.floor(Math.random()*120); }
        c.x = Math.max(50, Math.min(WORLD_W-50, c.x)); c.y = Math.max(50, Math.min(WORLD_H-50, c.y));
        for (const fp of _buildingFootprints) {
          if (c.x > fp.x - fp.hw && c.x < fp.x + fp.hw && c.y > fp.top && c.y < fp.y) {
            c.charging = false; c.vx = -c.chargeVx * 0.3; c.vy = -c.chargeVy * 0.3;
            c.dirTimer = 60; break;
          }
        }
        // Mammoth charge hits player — big damage + knockback
        const pDist = Math.hypot(_charWorldX - c.x, _charWorldY - c.y);
        if (pDist < 35 && !c._hitPlayer) {
          c._hitPlayer = true; // only hit once per charge
          _damagePlayer(40, c.x, c.y); // 40% HP
        }
      } else {
        c._hitPlayer = false; // reset for next charge
        const dx = _charWorldX - c.x, dy = _charWorldY - c.y, dist = Math.hypot(dx, dy);
        if (dist < c.aggroRange) {
          c.charging = true; c.chargeTimer = 80+Math.floor(Math.random()*40);
          c._hitPlayer = false;
          const spd = 1.2+Math.random()*0.6;
          c.chargeVx = (dx/dist)*spd; c.chargeVy = (dy/dist)*spd;
        }
      }
    }
    // Puffer bug AI
    if (c.kind === 'puffer' && !c.dead) {
      c.bobT += (c.aggro ? 0.08 : 0.04) * _dt;
      c.breatheT += 0.03 * _dt;
      const dx = _charWorldX - c.x, dy = _charWorldY - c.y, dist = Math.hypot(dx, dy);
      if (!c.aggro) {
        // Check proximity aggro
        if (dist < PUFFER_AGGRO_RANGE) {
          c.aggro = true; c.aggroTimer = 0;
        }
      }
      if (c.aggro) {
        c.aggroTimer += _dt;
        const progress = Math.min(1, c.aggroTimer / PUFFER_FUSE);
        c.scale = c.baseScale * (1.0 + progress * (PUFFER_MAX_SCALE - 1.0));
        c.aggroSpeed = PUFFER_BASE_SPEED + progress * (PUFFER_MAX_SPEED - PUFFER_BASE_SPEED);
        // Chase player
        if (dist > 1) {
          c.vx = (dx / dist) * c.aggroSpeed;
          c.vy = (dy / dist) * c.aggroSpeed;
        }
        // Leash check — de-aggro if player too far
        if (dist > PUFFER_LEASH_RANGE) {
          c.aggro = false; c.aggroTimer = 0; c.aggroSpeed = PUFFER_BASE_SPEED;
          // Smoothly deflate — reset scale to base
          c.scale = c.baseScale;
          c.vx = (Math.random() - 0.5) * PUFFER_IDLE_SPEED * 2;
          c.vy = (Math.random() - 0.5) * PUFFER_IDLE_SPEED * 2;
          c.dirTimer = 120 + Math.floor(Math.random() * 180);
        }
        // Spike contact check — if close enough, explode immediately
        const spikeLen = PUFFER_SPIKE_BASE_LEN + progress * (PUFFER_SPIKE_MAX_LEN - PUFFER_SPIKE_BASE_LEN);
        const contactDist = (PUFFER_IDLE_RADIUS * c.scale) + spikeLen * c.scale;
        if (dist < contactDist) {
          _explodePuffer(c, true);
          continue;
        }
        // Timer expired — self-destruct
        if (c.aggroTimer >= PUFFER_FUSE) {
          _explodePuffer(c, dist < PUFFER_EXPLOSION_RADIUS);
          continue;
        }
      } else {
        // Idle wander — override default dir change with slower puffer wander
        if (c.dirTimer <= 0) {
          c.vx = (Math.random() - 0.5) * PUFFER_IDLE_SPEED * 2;
          c.vy = (Math.random() - 0.5) * PUFFER_IDLE_SPEED * 2;
          c.dirTimer = 120 + Math.floor(Math.random() * 180);
        }
      }
    }
    // Wound trail — drip blood while injured and moving
    if (c._woundCount > 0) {
      c._trailTimer = (c._trailTimer || 0) + _dt;
      const interval = Math.max(25, Math.floor(80 / c._woundCount));
      if (c._trailTimer >= interval) {
        c._trailTimer = 0;
        const moving = Math.abs(c.vx) > 0.05 || Math.abs(c.vy) > 0.05;
        if (moving) {
          if (!c._bloodTrail) c._bloodTrail = [];
          const noiseX = (Math.random()-0.5)*16 + (Math.random()-0.5)*8;
          const noiseY = (Math.random()-0.5)*12 + (Math.random()-0.5)*5;
          // Varied sizes: small (60%), medium (30%), large (10%)
          const sizeRoll = Math.random();
          const rx = sizeRoll < 0.6 ? 0.6+Math.random()*1.2 : sizeRoll < 0.9 ? 1.8+Math.random()*2 : 3.5+Math.random()*2.5;
          const ry = rx * (0.4 + Math.random()*0.2);
          c._bloodTrail.push({ wx: c.x + noiseX, wy: c.y + noiseY, age: 0, rx, ry });
          if (c._bloodTrail.length > 20) c._bloodTrail.shift();
        }
      }
    }
    if (c._bloodTrail) {
      for (const drop of c._bloodTrail) drop.age += _dt;
      c._bloodTrail = c._bloodTrail.filter(d => d.age < 600);
    }
  }
}

function _drawBloodPuddle(ctx, sx, sy, c, instant) {
  const seed = c._bloodSeed || 0.5;
  const sc = c.scale || 1;
  // Rocket kills: instant full splat. Others: grow over ~4 seconds
  const growT = instant ? 1 : Math.min(1, (c.deadT || 0) / 240);
  const grow = instant ? 1 : 1 - (1 - growT) * (1 - growT);
  const rx = (12 + seed * 10) * sc * grow, ry = (3.5 + seed * 2.5) * sc * grow;
  if (rx < 0.5) return; // too small to render
  ctx.fillStyle = _bloodColor();
  ctx.beginPath(); ctx.ellipse(sx, sy + 2, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  // Splatter dots appear after puddle is ~40% grown
  if (grow < 0.4) return;
  const splatGrow = (grow - 0.4) / 0.6; // 0 to 1 over remaining growth
  const splatSeeds = c._splatSeeds || [];
  const splatCount = 3 + Math.floor(seed * 3);
  for (let i = 0; i < splatCount; i++) {
    const ss = splatSeeds[i] || 0.5;
    const angle = (i / splatCount) * Math.PI * 2 + ss * 1.2;
    const dist = (rx * 0.7 + ss * rx * 0.6) * splatGrow;
    const dotRx = (1.5 + ss * 3.5) * sc * splatGrow, dotRy = dotRx * (0.4 + ss * 0.3);
    if (dotRx < 0.3) continue;
    ctx.beginPath();
    ctx.ellipse(sx + Math.cos(angle) * dist, sy + 2 + Math.sin(angle) * dist * 0.35, dotRx, dotRy, angle * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Canvas gore particle system ──
function _goreAdd(wx, wy, vx, vy, life, type, size, extra) {
  // Blood off means gore silent too; the retrigger cooldown in audio.js
  // collapses each multi-particle burst into one quiet splat.
  if (window._dexBloodEnabled !== false) sfx('gore', { at: { x: wx, y: wy } });
  const p = { wx, wy, vx, vy, life, maxLife: life, type, size, landed: false };
  if (extra) Object.assign(p, extra);
  if (_goreParticles.length >= MAX_GORE_PARTICLES) return p;   // drop, don't queue
  _goreParticles.push(p);
  return p;
}

function _spawnHitBlood(wx, wy, creature) {
  const count = 3 + Math.floor(Math.random() * 4);
  const isBird = creature && creature.kind === 'bird';
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 0.2 + Math.random() * 0.5;
    const pt = _goreAdd(wx, wy, Math.cos(a)*spd, Math.sin(a)*spd*0.4,
      50 + Math.floor(Math.random()*30), 'blood', 1.5 + Math.random()*2);
    if (isBird) {
      pt.fallTargetWY = (creature._fallTargetWorldY || creature.y + 80) + Math.random() * 6;
      pt.falling = true;
      pt.vy = Math.abs(pt.vy) + 0.5 + Math.random() * 0.6;
    } else {
      pt.fallTargetWY = wy + 2 + Math.random() * 5;
      pt.falling = true;
    }
  }
}

function _drawLiveCreature(c, ctx) {
  const { sx, sy } = worldToScreen(c.x, c.y);
  const clr = _cachedClr;
  // Blood trail drops (world-space)
  if (c._bloodTrail && c._bloodTrail.length > 0) {
    ctx.fillStyle = _bloodColor();
    for (const drop of c._bloodTrail) {
      const fade = drop.age > 480 ? 1 - (drop.age - 480) / 120 : 1;
      if (fade <= 0) continue;
      ctx.globalAlpha = fade * 0.75;
      const { sx: dsx, sy: dsy } = worldToScreen(drop.wx, drop.wy);
      if (dsx < -10 || dsx > window.innerWidth + 10 || dsy < -10 || dsy > window.innerHeight + 10) continue;
      ctx.beginPath(); ctx.ellipse(dsx, dsy, drop.rx, drop.ry, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = clr; ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  if (c.dead) {
    // Puffer exploded — no corpse, gore particles handle visuals
    if (c._pufferExploded) return;
    // Rocket death — body exploded, just show blood puddle fading
    if (c._rocketDeath) {
      if (c.kind === 'bird') return; // bird puddle would be stuck in sky — gore particles handle it
      if (c.deadT < 1800) {
        const fade = c.deadT > 1200 ? 1 - (c.deadT - 1200) / 600 : 1;
        ctx.globalAlpha = fade;
        _drawBloodPuddle(ctx, sx, sy, c, true);
        ctx.globalAlpha = 1;
      }
      return;
    }
    if (c.kind === 'bird') {
      // Bird: falling phase — world-space Y so it doesn't drift with camera
      if (c._falling) {
        c._fallVY = (c._fallVY || 0) + 0.075 * _dt;
        c._fallVY = Math.min(c._fallVY, 3.25);
        c._fallWorldY += c._fallVY * _dt;
        if (c._fallWorldY >= c._fallTargetWorldY) {
          c._fallWorldY = c._fallTargetWorldY;
          c._falling = false;
        }
        const { sx: fsx, sy: fsy } = worldToScreen(c.x, c._fallWorldY);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fsx-7, fsy-3); ctx.quadraticCurveTo(fsx, fsy+3, fsx+7, fsy-3);
        ctx.stroke();
        return;
      }
      // Landed — use stored world landing position
      const { sx: landSx, sy: landSy } = worldToScreen(c.x, c._fallWorldY || c._fallTargetWorldY || c.y);
      if (c.deadT < 3600) {
        // Blood puddle — fades after 30 seconds (1800 frames)
        const bloodFade = c.deadT > 1800 ? Math.max(0, 1 - (c.deadT-1800)/600) : 1;
        if (bloodFade > 0) {
          ctx.globalAlpha = bloodFade;
          ctx.fillStyle = _bloodColor();
          ctx.beginPath(); ctx.ellipse(landSx, landSy, 7, 3, 0, 0, Math.PI*2); ctx.fill();
          ctx.beginPath(); ctx.ellipse(landSx-4, landSy-1, 3, 1.5, 0.2, 0, Math.PI*2); ctx.fill();
          ctx.globalAlpha = 1;
        }
        // Bird body on top — stays 60 seconds, fades last 5s
        const bodyFade = c.deadT > 3300 ? 1 - (c.deadT-3300)/300 : 1;
        ctx.globalAlpha = bodyFade;
        ctx.strokeStyle = clr; ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(landSx-6, landSy-1); ctx.quadraticCurveTo(landSx, landSy+1, landSx+6, landSy-1);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      return;
    }
    // Yak/deer: collapsed body on ground + blood pool — 45 seconds
    if (c.deadT < 2700) {
      const fade = c.deadT > 2160 ? 1 - (c.deadT-2160)/540 : 1;
      ctx.globalAlpha = fade;
      // Blood puddle underneath
      _drawBloodPuddle(ctx, sx, sy, c);
      // Collapsed body — filled + stroked so it's visible on top of blood
      const bgFill = _currentBg || '#13141a';
      ctx.fillStyle = bgFill;
      ctx.strokeStyle = clr; ctx.lineWidth = 1.4;
      const sc = c.scale || 1;
      const bw = (c.kind === 'deer' ? 18 : 22) * sc;
      // Flattened body ellipse — same width as living, slight vertical squish (lying down)
      ctx.beginPath(); ctx.ellipse(sx, sy - 2, bw/2, (c.kind === 'deer' ? 3.5 : 4)*sc, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      // Head flopped to one side — same radius as living
      const hx = sx + bw/2 + 2*sc;
      ctx.beginPath(); ctx.arc(hx, sy - 1, (c.kind === 'deer' ? 3 : 3.5)*sc, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      // Legs splayed out flat
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(sx-bw*0.3, sy); ctx.lineTo(sx-bw*0.3-4*sc, sy+3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx+bw*0.3, sy); ctx.lineTo(sx+bw*0.3+4*sc, sy+3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx-bw*0.15, sy); ctx.lineTo(sx-bw*0.15-3*sc, sy+4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx+bw*0.15, sy); ctx.lineTo(sx+bw*0.15+3*sc, sy+4); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Mammoth death
    if (c.kind === 'mammoth' && c.deadT < 3600) {
      const fade = c.deadT > 2700 ? 1-(c.deadT-2700)/900 : 1;
      const sc = c.scale || 1;
      ctx.globalAlpha = fade;
      // Blood puddle (uses shared slow-grow function)
      _drawBloodPuddle(ctx, sx, sy, c);
      // Body outline (collapsed on side) — filled
      const bgFill = _currentBg || '#13141a';
      ctx.fillStyle = bgFill;
      ctx.strokeStyle = clr; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.ellipse(sx, sy-4*sc, 28*sc, 5*sc, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      // Head (right side, fallen) — filled
      const hx = sx + 30*sc, hy = sy - 2*sc;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(hx, hy, 8*sc, 5*sc, 0.2, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      // Trunk (drooping down from head)
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(hx+6*sc, hy+3*sc);
      ctx.quadraticCurveTo(hx+10*sc, hy+10*sc, hx+6*sc, hy+14*sc); ctx.stroke();
      // Tusks (limp, pointing forward/down)
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(hx+4*sc, hy+3*sc);
      ctx.quadraticCurveTo(hx+16*sc, hy+4*sc, hx+18*sc, hy-2*sc); ctx.stroke();
      // Hump
      ctx.beginPath(); ctx.arc(sx-4*sc, sy-9*sc, 7*sc, Math.PI, 2*Math.PI); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    return;
  }

  const facingR = c.vx >= 0 ? 1 : -1;

  if (c.kind === 'yak') {
    const sc = c.scale, w = 22*sc, bH = 10*sc, hR = 3.5*sc;
    const bgFill = _currentBg || '#13141a';
    ctx.lineWidth = 1.6;
    // Body — filled with canvas bg
    ctx.fillStyle = bgFill;
    ctx.beginPath(); ctx.ellipse(sx, sy-bH, w/2, bH/2, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    // Head on facing side — filled with canvas bg
    const hx = sx + facingR*(w/2+hR);
    ctx.beginPath(); ctx.arc(hx, sy-bH*1.4, hR, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    // Horns
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(hx, sy-bH*1.4-hR);
    ctx.quadraticCurveTo(hx+facingR*4*sc, sy-bH*2, hx+facingR*2*sc, sy-bH*2.4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hx, sy-bH*1.4-hR);
    ctx.quadraticCurveTo(hx+facingR*5*sc, sy-bH*1.8, hx+facingR*4*sc, sy-bH*2.2); ctx.stroke();
    // Legs with walk animation
    ctx.lineWidth = 1.6;
    const legSwing = Math.sin(Date.now()*0.003 + c.x)*3;
    for (let i=0;i<4;i++) {
      const lx = sx-w/2+(i+0.5)*(w/4);
      const swing = (i%2===0?1:-1)*legSwing;
      ctx.beginPath(); ctx.moveTo(lx, sy-bH/2); ctx.lineTo(lx+swing, sy-bH/2+8*sc); ctx.stroke();
    }
  }

  else if (c.kind === 'bird') {
    const flap = Math.sin(c.flapT) * 4;
    const curl = Math.sin(c.flapT * 1.3) * 2;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(sx-10, sy+flap+curl);
    ctx.quadraticCurveTo(sx-5, sy+flap*0.3, sx, sy);
    ctx.quadraticCurveTo(sx+5, sy+flap*0.3, sx+10, sy+flap+curl);
    ctx.stroke();
  }

  else if (c.kind === 'deer') {
    const sc = c.scale;
    const bgFill = _currentBg || '#13141a';
    ctx.lineWidth = 1.6;
    // Body — filled with canvas bg
    const bw = 18*sc, bh = 8*sc;
    ctx.fillStyle = bgFill;
    ctx.beginPath(); ctx.ellipse(sx, sy-bh, bw/2, bh/2, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    // Head — smaller, further forward, on a neck
    const hx = sx + facingR*(bw/2+4*sc);
    const hy = sy - bh*1.8;
    ctx.lineWidth = 1.4;
    // Neck line
    ctx.beginPath(); ctx.moveTo(sx+facingR*bw*0.3, sy-bh*1.2); ctx.lineTo(hx, hy); ctx.stroke();
    // Head circle — filled with canvas bg
    ctx.fillStyle = bgFill;
    ctx.beginPath(); ctx.arc(hx, hy, 3*sc, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    // Antlers — branching lines
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(hx, hy-3*sc);
    ctx.lineTo(hx+facingR*3*sc, hy-8*sc); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hx+facingR*2*sc, hy-6*sc);
    ctx.lineTo(hx+facingR*5*sc, hy-7*sc); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hx, hy-3*sc);
    ctx.lineTo(hx-facingR*1*sc, hy-7*sc); ctx.stroke();
    // Legs — thinner, longer
    ctx.lineWidth = 1.4;
    const legSwing = Math.sin(Date.now()*0.004 + c.x)*3;
    for (let i=0;i<4;i++) {
      const lx = sx-bw/2+(i+0.5)*(bw/4);
      const swing = (i%2===0?1:-1)*legSwing;
      ctx.beginPath(); ctx.moveTo(lx, sy-bh/2); ctx.lineTo(lx+swing, sy-bh/2+10*sc); ctx.stroke();
    }
    // Short tail
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(sx-facingR*bw/2, sy-bh);
    ctx.lineTo(sx-facingR*(bw/2+4*sc), sy-bh-2*sc); ctx.stroke();
  }

  else if (c.kind === 'mammoth') {
    const sc = c.scale;
    const bw = 32*sc, bh = 18*sc, legLen = 13*sc;
    const isChg = c.charging;
    const legSwing = isChg ? Math.sin(Date.now()*0.012+c.x)*5 : Math.sin(Date.now()*0.004+c.x)*3;
    const tremble = isChg ? Math.sin(Date.now()*0.08)*1.2 : 0;
    ctx.lineWidth = 2.0;
    // Body
    ctx.beginPath(); ctx.ellipse(sx+tremble, sy-bh, bw/2, bh/2, 0, 0, Math.PI*2); ctx.stroke();
    // Hump
    ctx.beginPath(); ctx.arc(sx-facingR*bw*0.1, sy-bh*2+2*sc, bw*0.22, Math.PI, 2*Math.PI); ctx.stroke();
    // Head
    const hx = sx+facingR*(bw/2+2*sc)+tremble, hy = sy-bh*0.9;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.ellipse(hx+facingR*4*sc, hy, 8*sc, 6*sc, 0, 0, Math.PI*2); ctx.stroke();
    // Trunk
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(hx+facingR*(8*sc+2), hy+2*sc);
    ctx.quadraticCurveTo(hx+facingR*12*sc, hy+12*sc, hx+facingR*8*sc, hy+18*sc); ctx.stroke();
    // Tusks
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(hx+facingR*6*sc, hy+3*sc);
    ctx.quadraticCurveTo(hx+facingR*18*sc, hy+6*sc, hx+facingR*22*sc, hy-4*sc); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hx+facingR*6*sc, hy+7*sc);
    ctx.quadraticCurveTo(hx+facingR*15*sc, hy+10*sc, hx+facingR*18*sc, hy+2*sc); ctx.stroke();
    // Ear
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.ellipse(sx-facingR*bw*0.3, sy-bh*1.7, 5*sc, 4*sc, 0, 0, Math.PI*2); ctx.stroke();
    // Fur
    ctx.lineWidth = 1.0; ctx.globalAlpha = 0.5;
    for (let fi=0; fi<7; fi++) { const fx=sx-bw/2+(fi/6)*bw; ctx.beginPath(); ctx.moveTo(fx, sy-bh/3); ctx.lineTo(fx, sy-bh/3+5*sc); ctx.stroke(); }
    ctx.globalAlpha = 1;
    // Legs
    ctx.lineWidth = 1.8;
    for (let i=0; i<4; i++) { const lx=sx-bw/2+(i+0.5)*(bw/4), sw2=(i%2===0?1:-1)*legSwing;
      ctx.beginPath(); ctx.moveTo(lx, sy-bh/3); ctx.lineTo(lx+sw2, sy-bh/3+legLen); ctx.stroke();
      ctx.fillStyle = _cachedClr; ctx.beginPath(); ctx.arc(lx+sw2, sy-bh/3+legLen, 2*sc, 0, Math.PI*2); ctx.fill();
    }
    // Tail
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(sx-facingR*bw/2, sy-bh); ctx.lineTo(sx-facingR*(bw/2+5*sc), sy-bh+4*sc); ctx.stroke();
    // HP bar
    if (c.hp < c.maxHp) {
      const barW=36*sc, barH=3, barX=sx-barW/2, barY=sy-bh*2.2-8;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = c.hp>c.maxHp*0.5?'#e0a030':'#e05c5c'; ctx.fillRect(barX, barY, barW*(c.hp/c.maxHp), barH);
    }
    // Charge glow
    if (isChg) {
      ctx.globalAlpha = 0.15+Math.sin(Date.now()*0.015)*0.1;
      ctx.fillStyle = '#e05c5c';
      ctx.beginPath(); ctx.ellipse(sx, sy-bh, bw*0.6, bh*0.55, 0, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  else if (c.kind === 'puffer') {
    const sc = c.scale;
    const bob = Math.sin(c.bobT) * 2 * (c.aggro ? 1.5 : 1);
    const breathe = 1 + Math.sin(c.breatheT) * 0.03;
    const progress = c.aggro ? Math.min(1, c.aggroTimer / PUFFER_FUSE) : 0;
    const r = PUFFER_IDLE_RADIUS * sc * breathe;
    const drawY = sy + bob;

    // Body: 3 layered ellipses (outer glow → mid → core)
    ctx.globalAlpha = 0.12 + progress * 0.08;
    ctx.fillStyle = clr;
    ctx.beginPath(); ctx.ellipse(sx, drawY, r * 1.5, r * 1.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.25 + progress * 0.1;
    ctx.beginPath(); ctx.ellipse(sx, drawY, r * 1.15, r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.5 + progress * 0.2;
    ctx.beginPath(); ctx.ellipse(sx, drawY, r * 0.8, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // Body outline
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(sx, drawY, r, r * 0.85, 0, 0, Math.PI * 2); ctx.stroke();

    // Spikes: 8 radiating lines with ball tips
    const spikeLen = (PUFFER_SPIKE_BASE_LEN + progress * (PUFFER_SPIKE_MAX_LEN - PUFFER_SPIKE_BASE_LEN)) * sc;
    const spikeAlpha = c.aggro ? 0.5 + progress * 0.5 : 0.45;
    const spikeWidth = 1.2 + progress * 0.8;
    const tipR = (1.5 + progress * 1.5) * sc;
    ctx.globalAlpha = spikeAlpha;
    ctx.lineWidth = spikeWidth;
    for (let i = 0; i < PUFFER_SPIKE_COUNT; i++) {
      const angle = (i / PUFFER_SPIKE_COUNT) * Math.PI * 2;
      const baseX = sx + Math.cos(angle) * r;
      const baseY = drawY + Math.sin(angle) * r * 0.85;
      const tipX = sx + Math.cos(angle) * (r + spikeLen);
      const tipY = drawY + Math.sin(angle) * (r * 0.85 + spikeLen * 0.85);
      ctx.beginPath(); ctx.moveTo(baseX, baseY); ctx.lineTo(tipX, tipY); ctx.stroke();
      // Ball tip
      ctx.beginPath(); ctx.arc(tipX, tipY, tipR, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Eyes
    const eyeSpread = 4 * sc;
    const eyeY = drawY - 2 * sc;
    const eyeR = 2.2 * sc;
    const pupilR = 1.2 * sc;
    // White sclera
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(sx - eyeSpread, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx + eyeSpread, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
    // Pupils — squint when aggro (scaleY compress)
    ctx.fillStyle = c.aggro ? clr : '#1a1a2e';
    const pupilSY = c.aggro ? pupilR * (0.4 + (1 - progress) * 0.3) : pupilR;
    ctx.beginPath(); ctx.ellipse(sx - eyeSpread, eyeY, pupilR, pupilSY, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(sx + eyeSpread, eyeY, pupilR, pupilSY, 0, 0, Math.PI * 2); ctx.fill();

    // HP bar (when damaged)
    if (c.hp < c.maxHp) {
      const barW = 30 * sc, barH = 3;
      const barX = sx - barW / 2, barY = drawY - r * 1.5 - spikeLen - 10;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = c.hp > c.maxHp * 0.5 ? '#e0a030' : '#e05c5c';
      ctx.fillRect(barX, barY, barW * (c.hp / c.maxHp), barH);
    }

    // Countdown timer bar (when aggro)
    if (c.aggro) {
      const barW = 30 * sc, barH = 3;
      const barX = sx - barW / 2, barY = drawY - r * 1.5 - spikeLen - (c.hp < c.maxHp ? 18 : 10);
      const remaining = 1 - progress;
      // Background
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(barX, barY, barW, barH);
      // Fill — accent color shifting toward warning as it depletes
      const warnR = Math.floor(224 * progress + parseInt(clr.slice(1, 3), 16) * (1 - progress));
      const warnG = Math.floor(92 * progress + parseInt(clr.slice(3, 5), 16) * (1 - progress));
      const warnB = Math.floor(92 * progress + parseInt(clr.slice(5, 7), 16) * (1 - progress));
      ctx.fillStyle = `rgb(${warnR},${warnG},${warnB})`;
      ctx.fillRect(barX, barY, barW * remaining, barH);
    }
  }
}

// ═══════════════════════════════════
//  CANVAS PARTICLE SYSTEM (world-space, no camera drift)
// ═══════════════════════════════════

// MD 04: hard caps — drop, don't queue. Heavy combat squeezes rather than
// growing the arrays unbounded (GC pauses at 240fps are visible).
const MAX_WORLD_PARTICLES = 350;
const MAX_GORE_PARTICLES = 300;
function _pPush(p) {
  if (_worldParticles.length >= MAX_WORLD_PARTICLES) return;
  _worldParticles.push(p);
}

function _pAddParticle(wx, wy, vx, vy, life, r, g, b, size, type) {
  _pPush({ wx, wy, vx, vy, life, maxLife: life, r, g, b, size, type });
}

// ── Hit feedback (MD 04) ────────────────────────────────
// One call per connected hit: a snap ring at the impact point, sparks
// biased along the projectile's travel, and hit-stop on the solid ones
// (kill / headshot) so sustained SMG fire doesn't stutter the game.
function _hitFX(wx, wy, pvx, pvy, kind) {
  const clrHex = (_cachedClr || '#7B8A9C').replace('#', '');
  const cr = parseInt(clrHex.slice(0, 2), 16), cg = parseInt(clrHex.slice(2, 4), 16), cb = parseInt(clrHex.slice(4, 6), 16);
  const lr = Math.min(255, cr + 110), lg = Math.min(255, cg + 110), lb = Math.min(255, cb + 110);
  // Impact ring — small, fast, bright
  _pPush({ wx, wy, vx: 0, vy: 0, life: 12, maxLife: 12, r: lr, g: lg, b: lb, size: 0, type: 'hitring' });
  // Directional sparks — carry the projectile's momentum through the target
  const spd = Math.hypot(pvx || 0, pvy || 0);
  const nx = spd > 0.1 ? pvx / spd : Math.random() - 0.5;
  const ny = spd > 0.1 ? pvy / spd : Math.random() - 0.5;
  const n = kind === 'kill' ? 6 : 3;
  for (let i = 0; i < n; i++) {
    const a = Math.atan2(ny, nx) + (Math.random() - 0.5) * 1.1;
    const s = 0.8 + Math.random() * 1.4;
    _pAddParticle(wx, wy, Math.cos(a) * s, Math.sin(a) * s,
      12 + Math.floor(Math.random() * 10), lr, lg, lb, 0.8 + Math.random() * 1.2, 'spark');
  }
  if (kind === 'kill') window._dexHitStop?.(9, 0.15);
  else if (kind === 'headshot') window._dexHitStop?.(6, 0.2);
}

// ── Weapon muzzle FX (MD 04) ────────────────────────────
// Called from character.js's _shootGun with the muzzle in world coords.
// Each GUN_TYPES personality gets its own signature; everything derives
// from the accent so it reads on any theme.
let _fxTime = 0;
window._dexMuzzleFX = function (wx, wy, angle, gunType) {
  if (!_active) return;
  const clrHex = (_cachedClr || '#7B8A9C').replace('#', '');
  const cr = parseInt(clrHex.slice(0, 2), 16), cg = parseInt(clrHex.slice(2, 4), 16), cb = parseInt(clrHex.slice(4, 6), 16);
  const lr = Math.min(255, cr + 120), lg = Math.min(255, cg + 120), lb = Math.min(255, cb + 120);
  const cos = Math.cos(angle), sin = Math.sin(angle);

  const sparks = (n, spread, speed, life) => {
    for (let i = 0; i < n; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const s = speed * (0.7 + Math.random() * 0.6);
      _pAddParticle(wx, wy, Math.cos(a) * s, Math.sin(a) * s,
        life + Math.floor(Math.random() * 6), lr, lg, lb, 0.7 + Math.random() * 1.1, 'spark');
    }
  };
  const smoke = (n, back) => {
    for (let i = 0; i < n; i++) {
      const dir = back ? angle + Math.PI : angle;
      const a = dir + (Math.random() - 0.5) * 0.8;
      const s = 0.3 + Math.random() * 0.5;
      _pAddParticle(wx, wy, Math.cos(a) * s, Math.sin(a) * s - 0.15,
        26 + Math.floor(Math.random() * 14), cr, cg, cb, 1.2 + Math.random() * 1.6, 'smoke');
    }
  };
  const shells = (n) => {
    for (let i = 0; i < n; i++) {
      _pPush({
        wx, wy,
        vx: -cos * 0.4 + (Math.random() - 0.5) * 0.7,
        vy: -1.0 - Math.random() * 0.7,
        life: 34 + Math.floor(Math.random() * 12), maxLife: 46,
        r: lr, g: lg, b: lb, size: 0, type: 'shell',
        rot: angle, rotV: (Math.random() - 0.5) * 0.5,
      });
    }
  };
  const flash = (size) => {
    _pPush({ wx: wx + cos * 4, wy: wy + sin * 4, vx: 0, vy: 0,
      life: 6 + size, maxLife: 6 + size, r: lr, g: lg, b: lb, size, type: 'muzzle' });
  };

  switch (gunType) {
    case 'sword':    sparks(6, 1.6, 2.4, 10); break;               // swipe — wide glint fan, no flash/shell
    case 'swordJab': flash(3); sparks(4, 0.28, 3.2, 8); break;     // jab — tight forward snap
    case 'swordPower': flash(5); sparks(12, 2.6, 3.2, 13); smoke(2, true); _addShake(2.6); break; // charged swipe
    case 'pistol':  flash(3); sparks(3, 0.5, 1.6, 10); shells(1); break;
    case 'smg':     flash(2); sparks(2, 0.7, 1.4, 8);  shells(1); break;
    case 'shotgun': flash(6); sparks(9, 1.0, 2.0, 12); smoke(3); shells(2); _addShake(1.3); break;
    case 'rifle':   flash(3); sparks(4, 0.12, 3.4, 14); smoke(1); shells(1); break;
    case 'rocket':  flash(5); smoke(6, true); _addShake(1.6); break;   // backblast
    case 'pufferLauncher': smoke(3); sparks(2, 0.8, 0.8, 12); break;   // soft pop
    default: flash(2); sparks(2, 0.6, 1.4, 9); break;
  }
};

// ── Movement FX (MD 04) ─────────────────────────────────
window._dexLandFX = function (power, onBoard) {
  if (!_active) return;
  const p = Math.min(1, Math.max(0, power || 0));
  // Dust is neutral, theme-aware — not accent — so it reads as ground, not UI.
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const g = isDark ? 145 : 70;
  const n = Math.round(3 + p * 7);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 0.35 + p * 0.75 * Math.random();
    _pAddParticle(_charWorldX + (Math.random() - 0.5) * 8, _charWorldY,
      Math.cos(a) * s, Math.sin(a) * s * 0.3 - 0.08,
      16 + Math.floor(p * 18 + Math.random() * 8), g, g, g + 6, 1 + p * 1.6, 'smoke');
  }
  if (!onBoard && p > 0.78) _addShake(1.5 + p * 2);
};

window._dexJumpFX = function (power, visualYOff) {
  if (!_active) return;
  const p = Math.min(1, Math.max(0, power || 0));
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const g = isDark ? 135 : 75;
  const wy = _charWorldY + (visualYOff || 0);
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (Math.random() - 0.5) * 1.6;   // downward fan
    const s = 0.3 + p * 0.5;
    _pAddParticle(_charWorldX + (Math.random() - 0.5) * 6, wy,
      Math.cos(a) * s * 0.6, Math.sin(a) * s * 0.35,
      12 + Math.floor(Math.random() * 8), g, g, g + 6, 0.9 + p * 1.1, 'smoke');
  }
};

// Hoverboard exhaust — fed per frame from character.js while riding;
// throttled here so ride cost stays a couple of particles every few frames.
// MD 18: back to the ORIGINAL single on-axis wake (the MD 13 two-sided
// braid read as two weird lines — owner's call). Boost is where the show
// happens now: long bright speed streaks ripping backward off-axis plus
// thrust-pulse flashes at the tail.
let _boardFxCd = 0;
window._dexBoardFX = function (vx, vy, boosting) {
  if (!_active) return;
  _boardFxCd -= _dt;
  if (_boardFxCd > 0) return;
  const speed = Math.hypot(vx || 0, vy || 0);
  if (speed < 0.15 && !boosting) return;
  _boardFxCd = boosting ? 2.5 : 6;
  const clrHex = (_cachedClr || '#7B8A9C').replace('#', '');
  const cr = parseInt(clrHex.slice(0, 2), 16), cg = parseInt(clrHex.slice(2, 4), 16), cb = parseInt(clrHex.slice(4, 6), 16);
  const inv = speed > 0.01 ? 1 / speed : 0;
  const bx = -(vx || 0) * inv, by = -(vy || 0) * inv;   // behind the board
  _pAddParticle(
    _charWorldX + bx * 10 + (Math.random() - 0.5) * 4,
    _charWorldY + by * 10 + 2,
    bx * (0.3 + (boosting ? 0.5 : 0.15)) + (Math.random() - 0.5) * 0.2,
    by * (0.3 + (boosting ? 0.5 : 0.15)) + (Math.random() - 0.5) * 0.2 - 0.05,
    boosting ? 16 : 14, cr, cg, cb, boosting ? 1.5 : 1.1, 'smoke');
  if (boosting) {
    const br = Math.min(255, cr + 110), bg = Math.min(255, cg + 110), bb = Math.min(255, cb + 110);
    const px = -by, py = bx;                            // perpendicular to travel
    for (let i = 0; i < 2; i++) {
      const off = (Math.random() - 0.5) * 9;
      _pAddParticle(
        _charWorldX + bx * (6 + Math.random() * 8) + px * off,
        _charWorldY + by * (6 + Math.random() * 8) + py * off + 2,
        bx * (2.2 + Math.random() * 1.6), by * (2.2 + Math.random() * 1.6),
        7 + Math.floor(Math.random() * 5), br, bg, bb, 0.6 + Math.random() * 0.5, 'spark');
    }
    if (Math.random() < 0.25) {
      _pPush({ wx: _charWorldX + bx * 12, wy: _charWorldY + by * 12 + 2, vx: 0, vy: 0,
        life: 5, maxLife: 5, r: br, g: bg, b: bb, size: 2.5, type: 'muzzle' });
    }
  }
};

// Jetpack FX bridge (MD 10, issue 8) — thruster plume, ground downwash,
// takeoff burst. With the free-roam hover being a visual offset, these are
// doing much of the work of selling flight. Everything routes through
// _pPush's cap and derives from the live accent like every other emitter.
window._dexJetFX = function (kind, opt) {
  if (!_active) return;
  const clrHex = (_cachedClr || '#7B8A9C').replace('#', '');
  const r = parseInt(clrHex.slice(0, 2), 16), g = parseInt(clrHex.slice(2, 4), 16), b = parseInt(clrHex.slice(4, 6), 16);
  const br = Math.min(255, r + 90), bg = Math.min(255, g + 90), bb = Math.min(255, b + 90);
  const wx = _charWorldX, wy = _charWorldY;
  const lift = (opt && opt.lift) || 0;   // visual height above ground, positive px
  if (kind === 'plume') {
    // Bright exhaust from the pack nozzle, falling toward the ground.
    for (let i = 0; i < 2; i++) {
      _pAddParticle(wx + (Math.random() - 0.5) * 6, wy - lift - 18,
        (Math.random() - 0.5) * 0.25, 0.9 + Math.random() * 0.7,
        10 + Math.floor(Math.random() * 8), br, bg, bb, 1.2 + Math.random() * 1.2, 'spark');
    }
    if (Math.random() < 0.35) {
      _pAddParticle(wx + (Math.random() - 0.5) * 8, wy - lift - 12,
        (Math.random() - 0.5) * 0.2, 0.4 + Math.random() * 0.3,
        24 + Math.floor(Math.random() * 12), r, g, b, 2.4 + Math.random() * 2, 'smoke');
    }
  } else if (kind === 'wash') {
    // Downwash where the plume meets the ground — dust pushed outward.
    for (let i = 0; i < 2; i++) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      _pAddParticle(wx + dir * (4 + Math.random() * 6), wy + (Math.random() - 0.5) * 3,
        dir * (0.5 + Math.random() * 0.7), -(0.05 + Math.random() * 0.12),
        14 + Math.floor(Math.random() * 10), r, g, b, 1.4 + Math.random() * 1.4, 'smoke');
    }
  } else if (kind === 'burst') {
    // Takeoff — spark ring + lifted dust.
    for (let i = 0; i < 10; i++) {
      const a2 = (i / 10) * Math.PI * 2;
      _pAddParticle(wx + Math.cos(a2) * 5, wy + Math.sin(a2) * 2.5,
        Math.cos(a2) * (0.7 + Math.random() * 0.5), Math.sin(a2) * 0.35 - 0.1,
        14 + Math.floor(Math.random() * 8), br, bg, bb, 1.3 + Math.random(), 'spark');
    }
    for (let i = 0; i < 4; i++) {
      _pAddParticle(wx + (Math.random() - 0.5) * 14, wy - Math.random() * 4,
        (Math.random() - 0.5) * 0.5, -(0.1 + Math.random() * 0.2),
        22 + Math.floor(Math.random() * 12), r, g, b, 2.4 + Math.random() * 2, 'smoke');
    }
  }
};

function _pSpawnExplosion(wx, wy) {
  // Bullet impact — small, fast, user-colored smoke (no gravity)
  const clrHex = (_cachedClr||'#7B8A9C').replace('#','');
  const cr=parseInt(clrHex.slice(0,2),16), cg=parseInt(clrHex.slice(2,4),16), cb=parseInt(clrHex.slice(4,6),16);
  const lr=Math.min(255,cr+70), lg=Math.min(255,cg+70), lb=Math.min(255,cb+70);
  const dr=Math.floor(cr*0.5), dg=Math.floor(cg*0.5), db=Math.floor(cb*0.5);
  const colors = [[cr,cg,cb],[lr,lg,lb],[dr,dg,db]];
  for (let i = 0; i < 8; i++) {
    const a = (i/8)*Math.PI*2 + Math.random()*0.7;
    const spd = 0.6 + Math.random() * 1.0;
    const [r,g,b] = colors[Math.floor(Math.random()*colors.length)];
    _pAddParticle(wx, wy, Math.cos(a)*spd, Math.sin(a)*spd,
      20+Math.floor(Math.random()*15), r, g, b, 1.5+Math.random()*2.5, 'smoke');
  }
  _pAddParticle(wx, wy, 0, 0, 10, lr, lg, lb, 0, 'flash');
}

let _chimneySmokeCd = 0;
function _spawnChimneySmoke() {
  const home = _getHomeObj();
  if (!home) return;
  const cx = home.x + 18.5;
  const cy = home.y - 74;
  const clrHex = (_cachedClr || '#7B8A9C').replace('#', '');
  const cr = parseInt(clrHex.slice(0,2), 16);
  const cg = parseInt(clrHex.slice(2,4), 16);
  const cb = parseInt(clrHex.slice(4,6), 16);
  const count = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < count; i++) {
    const size = 0.8 + Math.random() * 1.4;
    const life = 350 + Math.floor(Math.random() * 200);
    const vy = -(0.06 + Math.random() * 0.04);
    const vx = 0.04 + Math.random() * 0.04;
    _pPush({ wx: cx + (Math.random() - 0.5) * 3, wy: cy, vx, vy, life, maxLife: life,
      r: cr, g: cg, b: cb, size, type: 'chimney',
      _sineAmp: 0.3 + Math.random() * 0.4,
      _sineFreq: 0.008 + Math.random() * 0.006,
      _sinePhase: Math.random() * Math.PI * 2,
      _baseOpacity: 0.12 + Math.random() * 0.18
    });
  }
}

function _pSpawnRocketExplosion(wx, wy) {
  const clrHex = (_cachedClr||'#7B8A9C').replace('#','');
  const cr=parseInt(clrHex.slice(0,2),16), cg=parseInt(clrHex.slice(2,4),16), cb=parseInt(clrHex.slice(4,6),16);
  const lr=Math.min(255,cr+90), lg=Math.min(255,cg+90), lb=Math.min(255,cb+90);
  const dr=Math.floor(cr*0.5), dg=Math.floor(cg*0.5), db=Math.floor(cb*0.5);
  const hr=Math.min(255,cr+140), hg=Math.min(255,cg+140), hb=Math.min(255,cb+140);
  const colors = [[cr,cg,cb],[lr,lg,lb],[dr,dg,db],[hr,hg,hb]];

  // AOE ring
  _pAddParticle(wx, wy, 0, 0, 30, cr, cg, cb, 0, 'aoe_ring');
  // Central flash (bigger, longer than bullet)
  _pAddParticle(wx, wy, 0, 0, 18, hr, hg, hb, 0, 'flash');

  // Inner dense smoke — big, slow
  for (let i = 0; i < 10; i++) {
    const a = Math.random()*Math.PI*2;
    const spd = 0.3 + Math.random() * 0.8;
    const [r,g,b] = colors[Math.floor(Math.random()*colors.length)];
    _pAddParticle(wx, wy, Math.cos(a)*spd, Math.sin(a)*spd,
      55+Math.floor(Math.random()*30), r, g, b, 3+Math.random()*5, 'smoke');
  }
  // Mid ring — medium speed, medium size
  for (let i = 0; i < 14; i++) {
    const a = (i/14)*Math.PI*2 + Math.random()*0.5;
    const spd = 0.8 + Math.random() * 1.5;
    const [r,g,b] = colors[Math.floor(Math.random()*colors.length)];
    _pAddParticle(wx, wy, Math.cos(a)*spd, Math.sin(a)*spd,
      45+Math.floor(Math.random()*25), r, g, b, 2+Math.random()*3.5, 'smoke');
  }
  // Outer fast debris — small, fast, short-lived
  for (let i = 0; i < 10; i++) {
    const a = Math.random()*Math.PI*2;
    const spd = 1.8 + Math.random() * 2.5;
    const [r,g,b] = colors[Math.floor(Math.random()*colors.length)];
    _pAddParticle(wx, wy, Math.cos(a)*spd, Math.sin(a)*spd,
      25+Math.floor(Math.random()*15), r, g, b, 1+Math.random()*2, 'smoke');
  }

  // AOE damage + knockback
  const AOE_RADIUS = 70;
  for (const c of _liveCreatures) {
    if (c.dead) continue;
    const dx = c.x - wx, dy = c.y - wy;
    const dist = Math.hypot(dx, dy);
    if (dist < AOE_RADIUS) {
      const proximity = 1 - (dist / AOE_RADIUS);
      // Puffer: AOE triggers aggro or kills → puffer explosion
      if (c.kind === 'puffer') {
        const dmg = Math.ceil(proximity * c.hp);
        c.hp -= dmg;
        if (c.hp <= 0) { _explodePuffer(c, false); }
        else if (!c.aggro) { c.aggro = true; c.aggroTimer = 0; }
        continue;
      }
      const dmg = c.kind === 'mammoth' ? Math.ceil(proximity * 3) : Math.ceil(proximity * c.hp);
      c.hp -= dmg;
      // AOE gore handled by _spawnRocketGore — skip hit blood to avoid static clumps
      const kbStrength = proximity * 0.8;
      const kbDir = dist > 0.1 ? { x: dx/dist, y: dy/dist } : { x: Math.random()-0.5, y: Math.random()-0.5 };
      const kbMult = c.kind === 'mammoth' ? 0.15 : c.kind === 'bird' ? 0 : 1.0;
      c.vx += kbDir.x * kbStrength * kbMult;
      c.vy += kbDir.y * kbStrength * kbMult;
      if (c.hp <= 0 && !c.dead) {
        c.dead = true; c.deadT = 0;
        c.vx = kbDir.x * kbStrength * kbMult;
        c.vy = kbDir.y * kbStrength * kbMult;
        if (c.kind === 'bird') {
          c._falling = true;
          c._fallWorldY = c.y;
          const _fallRoll = Math.random();
          c._fallTargetWorldY = c.y + (_fallRoll < 0.25 ? 150 + Math.random()*100 : 250 + Math.random()*200);
          c._fallVY = 0;
          _spawnWorldFeathers(c.x, c.y, c._fallTargetWorldY);
        } else {
          c._bloodSeed = Math.random();
          c._splatSeeds = Array.from({length: 5}, () => Math.random());
        }
        c._rocketDeath = true;
        const isBird = c.kind === 'bird';
        const fallTWY = isBird ? c._fallTargetWorldY : undefined;
        _spawnRocketGore(c.x, c.y, c.scale || 1, isBird, fallTWY, kbDir.x * 3, kbDir.y * 3);
      }
    }
  }
}

// Check if a projectile hits a live creature (called from character.js projectile tick)
// dmgOverride (optional) replaces the base body-hit damage — used by the
// sword's charged power swipe. Rocket and headshot damage keep priority.
export function hitTestCreatures(px, py, isRocket, pvx, pvy, isArrow, dmgOverride) {
  // Convert screen to world
  const { wx, wy } = screenToWorld(px, py);
  for (const c of _liveCreatures) {
    if (c.dead) continue;
    // Body hitbox — generous size for better feel
    const sc = c.scale || 1;
    // Puffer uses circular hitbox scaled by its current inflation
    if (c.kind === 'puffer') {
      const pufferR = PUFFER_IDLE_RADIUS * sc + 8; // generous
      if (Math.hypot(wx - c.x, wy - c.y) < pufferR) {
        const dmg = isRocket ? c.hp : dmgOverride != null ? dmgOverride : isArrow ? 2 : 1;
        c.hp -= dmg;
        _hitFX(wx, wy, pvx, pvy, c.hp <= 0 ? 'kill' : 'hit');
        if (!isRocket) _spawnHitBlood(wx, wy, c);
        // Any hit triggers aggro
        if (!c.aggro && c.hp > 0) { c.aggro = true; c.aggroTimer = 0; }
        if (c.hp <= 0) {
          // Killed by player — explode without player damage
          _explodePuffer(c, false);
        }
        return c;
      }
      continue;
    }
    const hitW = c.kind === 'bird' ? 30 : c.kind === 'mammoth' ? 40 : 28;
    const bodyY = c.kind === 'bird' ? c.y : c.y - sc * (c.kind === 'mammoth' ? 14 : 8);
    const hitH = c.kind === 'bird' ? 22 : c.kind === 'mammoth' ? 24 : 18;
    if (Math.abs(wx - c.x) < hitW && Math.abs(wy - bodyY) < hitH) {
      // Headshot detection (yak/deer only)
      let headshot = false;
      if (c.kind === 'yak' || c.kind === 'deer') {
        const facingR = c.vx >= 0 ? 1 : -1;
        let headWX, headWY, headR;
        if (c.kind === 'yak') {
          const w = 22*sc, bH = 10*sc, hR = 3.5*sc;
          headWX = c.x + facingR*(w/2+hR); headWY = c.y - bH*1.4; headR = hR+2;
        } else {
          const bw = 18*sc, bh = 8*sc;
          headWX = c.x + facingR*(bw/2+4*sc); headWY = c.y - bh*1.8; headR = 3*sc+2;
        }
        if (Math.hypot(wx-headWX, wy-headWY) < headR) headshot = true;
      }
      // Damage: rocket > arrow headshot > bullet headshot > arrow body > bullet body
      let dmg;
      if (isRocket) { dmg = c.kind === 'mammoth' ? 4 : c.hp; }
      else if (headshot) { dmg = isArrow ? c.hp : 4; }
      else { dmg = dmgOverride != null ? dmgOverride : isArrow ? 2 : 1; }
      c.hp -= dmg;
      _hitFX(wx, wy, pvx, pvy, c.hp <= 0 ? 'kill' : headshot ? 'headshot' : 'hit');
      // Hit blood burst at impact point (canvas — world coords)
      // Skip for rockets — _spawnRocketGore handles all the blood
      if (!isRocket) _spawnHitBlood(wx, wy, c);
      // Wound tracking for blood trail
      if (c.hp > 0) {
        c._woundCount = (c._woundCount || 0) + dmg;
        c._trailTimer = 0;
      }
      if (c.hp <= 0) {
        c.dead = true; c.deadT = 0;
        c.vx = 0; c.vy = 0;
        if (c.kind === 'bird') {
          c._falling = true;
          c._fallWorldY = c.y;
          const _fallRoll = Math.random();
          c._fallTargetWorldY = c.y + (_fallRoll < 0.25 ? 150 + Math.random()*100 : 250 + Math.random()*200);
          c._fallVY = 0;
          _spawnWorldFeathers(c.x, c.y, c._fallTargetWorldY);
        } else {
          c._bloodSeed = Math.random();
          c._splatSeeds = Array.from({length: 5}, () => Math.random());
        }
        // Rocket kill — explosion with body parts and massive blood splatter
        if (isRocket) {
          c._rocketDeath = true;
          const isBird = c.kind === 'bird';
          const fallTargetWY = isBird ? c._fallTargetWorldY : undefined;
          _spawnRocketGore(c.x, c.y, c.scale || 1, isBird, fallTargetWY, pvx || 0, pvy || 0);
        }
      }
      return c;
    }
  }
  return false;
}

// ── Gamma laser support (MD 12) ─────────────────────────
// The laser needs to know what its beam touches every frame WITHOUT
// damaging it (hitTestCreatures damages on contact — calling it per frame
// made the laser an accidental insta-kill). Same hitboxes, no side effects.
window._dexProbeCreature = function (px, py) {
  const { wx, wy } = screenToWorld(px, py);
  for (const c of _liveCreatures) {
    if (c.dead) continue;
    const sc = c.scale || 1;
    if (c.kind === 'puffer') {
      if (Math.hypot(wx - c.x, wy - c.y) < PUFFER_IDLE_RADIUS * sc + 8) return c;
      continue;
    }
    const hitW = c.kind === 'bird' ? 30 : c.kind === 'mammoth' ? 40 : 28;
    const bodyY = c.kind === 'bird' ? c.y : c.y - sc * (c.kind === 'mammoth' ? 14 : 8);
    const hitH = c.kind === 'bird' ? 22 : c.kind === 'mammoth' ? 24 : 18;
    if (Math.abs(wx - c.x) < hitW && Math.abs(wy - bodyY) < hitH) return c;
  }
  return null;
};

// MD 17b: the gamma is a CHARGE weapon now — no hp ticks at all. Every
// frame the beam touches a creature it inflates a little more; that
// inflation is the kill progress. Lose the beam and the size HOLDS for a
// grace window (sweep back on and it continues where it left off), then
// deflates back to normal. Full charge = the pop. Mammoths take twice
// the contact time; puffers pop their own way at full charge.
const GAMMA_POP_T = 300;      // frames of beam contact to pop (~1.25s at 240Hz ref)
const GAMMA_HOLD_T = 320;     // grace after losing the beam (~1.3s) before deflating
const GAMMA_DECAY = 1.6;      // deflate speed relative to inflate
const BOOM_WORDS = ['POP!', 'BOOM!', 'SPLAT!', 'KABLAM!', 'BLORP!'];
window._dexLaserCharge = function (c) {
  if (!c || c.dead) return;
  if (c._gammaT == null) {
    c._gammaT = 0;
    c._gammaBase = c.scale || 1;
    c._gammaPopT = GAMMA_POP_T * (c.kind === 'mammoth' ? 2 : 1);
    if (!c.aggro) { c.aggro = true; c.aggroTimer = 0; }
  }
  c._gammaT = Math.min(c._gammaT + _dt, c._gammaPopT);
  c._gammaHold = GAMMA_HOLD_T;
};

function _tickLaserOverloads() {
  for (const c of _liveCreatures) {
    if (c._gammaT == null) continue;
    if (c.dead) { c._gammaT = null; continue; }
    const popT = c._gammaPopT || GAMMA_POP_T;
    // Off the beam: hold the size through the grace window, then deflate.
    if ((c._gammaHold = (c._gammaHold || 0) - _dt) <= 0) {
      c._gammaT -= GAMMA_DECAY * _dt;
      if (c._gammaT <= 0) {
        c.scale = c._gammaBase;
        c._gammaT = null;
        continue;
      }
    }
    const p = Math.min(c._gammaT / popT, 1);
    // Balloon physics: quadratic swell to ~2.1×, wobble that speeds up as
    // it tightens, fizz + rising squeak once it's meaningfully swollen.
    c._gammaWob = (c._gammaWob || 0) + _dt * (0.15 + p * 0.9);
    const wob = p > 0.3 ? Math.sin(c._gammaWob) * 0.09 * p : 0;
    c.scale = c._gammaBase * (1 + 1.1 * p * p + wob);
    if (p > 0.35) {
      if ((c._overloadFizz = (c._overloadFizz || 0) - _dt) <= 0) {
        c._overloadFizz = 22 - p * 14;   // fizzes faster the tighter it gets
        const a = Math.random() * Math.PI * 2;
        _pAddParticle(c.x + Math.cos(a) * 16 * c.scale, c.y - 8 + Math.sin(a) * 10 * c.scale,
          Math.cos(a) * 0.7, Math.sin(a) * 0.7 - 0.35, 10, 255, 255, 255, 0.8, 'spark');
      }
      if ((c._overloadSq = (c._overloadSq || 0) - _dt) <= 0) {
        c._overloadSq = 40 - p * 18;
        sfx('laser.swell', { p, at: { x: c.x, y: c.y } });
      }
    }
    // Staggering under the pressure — frozen only near the end.
    if (p >= 0.85) { c.vx = 0; c.vy = 0; }
    if (p < 1) continue;

    // ── THE POP (MD 17) — deliberately ridiculous ──
    const sc = c._gammaBase;
    c.scale = sc;
    c._gammaT = null;
    if (c.kind === 'puffer') {
      // Puffers explode their own way — just add the comedy on top.
      _explodePuffer(c, false);
      const puffHex = (_cachedClr || '#7B8A9C').replace('#', '');
      const plr = Math.min(255, parseInt(puffHex.slice(0, 2), 16) + 120);
      const plg = Math.min(255, parseInt(puffHex.slice(2, 4), 16) + 120);
      const plb = Math.min(255, parseInt(puffHex.slice(4, 6), 16) + 120);
      _pPush({ wx: c.x, wy: c.y - 34, vx: 0, vy: -0.22, life: 55, maxLife: 55,
        r: plr, g: plg, b: plb, size: 0, type: 'boomtext',
        text: BOOM_WORDS[Math.floor(Math.random() * BOOM_WORDS.length)],
        rot: (Math.random() - 0.5) * 0.45 });
      _addShake(7);
      sfx('laser.pop', { at: { x: c.x, y: c.y } });
      continue;
    }
    c.dead = true; c.deadT = 0; c.hp = 0;
    // No beam angle recorded any more — the pop is omnidirectional anyway;
    // give the base gore layer a random bias.
    const ang = Math.random() * Math.PI * 2;
    const groundWY = c.kind === 'bird' ? c.y + 150 + Math.random() * 250 : c.y;
    if (c.kind === 'bird') {
      c._falling = true; c._fallWorldY = c.y;
      c._fallTargetWorldY = groundWY;
      c._fallVY = 0;
      _spawnWorldFeathers(c.x, c.y, c._fallTargetWorldY);
    } else {
      c._bloodSeed = Math.random();
      c._splatSeeds = Array.from({ length: 5 }, () => Math.random());
    }
    c._rocketDeath = true;
    // Base gore layer (bigger than a rocket kill)...
    _spawnRocketGore(c.x, c.y, sc * 1.6, c.kind === 'bird',
      c.kind === 'bird' ? c._fallTargetWorldY : undefined, Math.cos(ang) * 5, Math.sin(ang) * 5);
    // ...plus the debris cannon: the stock gore pools right under the
    // corpse (its landing spots hug the origin), so launch extra blobs
    // and body parts with real hang time and landing points scattered
    // across half a screen — stuff flies EVERYWHERE and rains down.
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 1 + Math.random() * 3.2;
      const pt = _goreAdd(c.x, c.y - 10, Math.cos(a) * spd, -(1.5 + Math.random() * 3.5),
        1400 + Math.floor(Math.random() * 400), 'blood', (2 + Math.random() * 5) * sc);
      pt.fallTargetWY = groundWY + (Math.random() - 0.35) * 110;
      pt.falling = true;
    }
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 1.2 + Math.random() * 2.6;
      const pt = _goreAdd(c.x, c.y - 12, Math.cos(a) * spd, -(2 + Math.random() * 3.2),
        1500 + Math.floor(Math.random() * 300), 'part', 0, {
          partW: (2 + Math.random() * 9) * sc, partH: (3 + Math.random() * 6) * sc,
          partRound: Math.random() < 0.3,
          partRot: Math.random() * Math.PI * 2, partRotV: (Math.random() - 0.5) * 0.5,
        });
      pt.fallTargetWY = groundWY + (Math.random() - 0.35) * 120;
      pt.falling = true;
    }
    const clrHex = (_cachedClr || '#7B8A9C').replace('#', '');
    const cr = parseInt(clrHex.slice(0, 2), 16), cg = parseInt(clrHex.slice(2, 4), 16), cb = parseInt(clrHex.slice(4, 6), 16);
    const lr = Math.min(255, cr + 120), lg = Math.min(255, cg + 120), lb = Math.min(255, cb + 120);
    // Triple shockwave + flash + spark storm + confetti + mushroom puff.
    _pPush({ wx: c.x, wy: c.y, vx: 0, vy: 0, life: 24, maxLife: 24, r: lr, g: lg, b: lb, size: 0, type: 'aoe_ring' });
    _pPush({ wx: c.x, wy: c.y, vx: 0, vy: 0, life: 32, maxLife: 32, r: cr, g: cg, b: cb, size: 0, type: 'aoe_ring' });
    _pPush({ wx: c.x, wy: c.y, vx: 0, vy: 0, life: 40, maxLife: 40, r: lr, g: lg, b: lb, size: 0, type: 'aoe_ring' });
    _pPush({ wx: c.x, wy: c.y - 6, vx: 0, vy: 0, life: 14, maxLife: 14, r: 255, g: 255, b: 255, size: 8, type: 'flash' });
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1.2 + Math.random() * 3.4;
      _pAddParticle(c.x, c.y - 8, Math.cos(a) * s, Math.sin(a) * s - 0.4,
        14 + Math.floor(Math.random() * 14), lr, lg, lb, 0.8 + Math.random() * 1.3, 'spark');
    }
    for (let i = 0; i < 8; i++) {
      _pPush({ wx: c.x, wy: c.y - 10,
        vx: (Math.random() - 0.5) * 2.4, vy: -1.4 - Math.random() * 1.6,
        life: 40 + Math.floor(Math.random() * 20), maxLife: 60,
        r: lr, g: lg, b: lb, size: 0, type: 'shell',
        rot: Math.random() * Math.PI, rotV: (Math.random() - 0.5) * 0.6 });
    }
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
      const s = 0.4 + Math.random() * 0.7;
      _pAddParticle(c.x + (Math.random() - 0.5) * 14, c.y - 10,
        Math.cos(a) * s, Math.sin(a) * s,
        30 + Math.floor(Math.random() * 20), cr, cg, cb, 1.6 + Math.random() * 2, 'smoke');
    }
    // The comic word. Of course there's a comic word.
    _pPush({ wx: c.x, wy: c.y - 34, vx: 0, vy: -0.22, life: 55, maxLife: 55,
      r: lr, g: lg, b: lb, size: 0, type: 'boomtext',
      text: BOOM_WORDS[Math.floor(Math.random() * BOOM_WORDS.length)],
      rot: (Math.random() - 0.5) * 0.45 });
    _addShake(9);
    sfx('laser.pop', { at: { x: c.x, y: c.y } });
    window._dexHitStop?.(14, 0.12);
  }
}

function _spawnWorldFeathers(wx, wy, fallTargetWY) {
  // DOM feather poof — instant burst like sessions mode
  const { sx, sy } = worldToScreen(wx, wy);
  const clr = _cachedClr || getComputedStyle(document.documentElement).getPropertyValue('--clr-adj').trim() || '#7B8A9C';
  for (let i = 0; i < 12; i++) {
    const f = document.createElement('div');
    const angle = Math.random() * Math.PI * 2;
    const dist = 15 + Math.random() * 25;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist - 15;
    const rot = Math.random() * 720;
    const dur = 0.8 + Math.random() * 0.8;
    f.style.cssText = `position:fixed;left:${sx}px;top:${sy}px;width:6px;height:3px;background:${clr};border-radius:50%;pointer-events:none;z-index:149;opacity:0.9;transition:all ${dur}s cubic-bezier(0.2,0.8,0.3,1);transform:translate(0,0) rotate(0deg);`;
    document.body.appendChild(f);
    requestAnimationFrame(() => {
      f.style.transform = `translate(${tx}px,${ty}px) rotate(${rot}deg)`;
      f.style.opacity = '0';
    });
    setTimeout(() => f.remove(), dur * 1000 + 200);
  }
}

// ═══════════════════════════════════
//  PUFFER BUG EXPLOSION
// ═══════════════════════════════════

function _explodePuffer(c, damagePlayer) {
  c.dead = true; c.deadT = 0;
  c.vx = 0; c.vy = 0;
  c._pufferExploded = true; // flag to skip normal death rendering

  const wx = c.x, wy = c.y;
  const sc = c.scale;

  // Parse accent color for particles
  const clrHex = (_cachedClr || '#7B8A9C').replace('#', '');
  const cr = parseInt(clrHex.slice(0, 2), 16);
  const cg = parseInt(clrHex.slice(2, 4), 16);
  const cb = parseInt(clrHex.slice(4, 6), 16);

  // Explosion ring (AOE shockwave) — world particle
  _pAddParticle(wx, wy, 0, 0, 30, cr, cg, cb, 0, 'aoe_ring');
  // Central flash
  _pAddParticle(wx, wy, 0, 0, 15, Math.min(255, cr + 100), Math.min(255, cg + 100), Math.min(255, cb + 100), 0, 'flash');

  // Body chunk particles (6-10 pieces)
  const chunkCount = 6 + Math.floor(Math.random() * 5);
  for (let i = 0; i < chunkCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 0.5 + Math.random() * 1.5;
    const pt = _goreAdd(wx, wy, Math.cos(a) * spd, Math.sin(a) * spd * 0.5 - 0.3,
      600 + Math.floor(Math.random() * 300), 'blood', (2 + Math.random() * 3) * sc);
    pt.fallTargetWY = wy + 5 + Math.random() * 20;
    pt.falling = true;
  }

  // Spike shrapnel — 8 spikes fly outward spinning
  for (let i = 0; i < PUFFER_SPIKE_COUNT; i++) {
    const angle = (i / PUFFER_SPIKE_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const spd = 1.0 + Math.random() * 1.2;
    const spikeW = 1.5 * sc;
    const spikeH = (6 + (sc - 1) * 4) * sc;
    const pt = _goreAdd(wx, wy, Math.cos(angle) * spd, Math.sin(angle) * spd * 0.5 - 0.4,
      500 + Math.floor(Math.random() * 200), 'part', 0, {
        partW: spikeW, partH: spikeH, partRound: false,
        partRot: angle,
        partRotV: (Math.random() - 0.5) * 0.2,
      });
    pt.fallTargetWY = wy + 8 + Math.random() * 25;
    pt.falling = true;
  }

  // Dust poof — accent-colored low-opacity smoke
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 0.3 + Math.random() * 0.8;
    _pAddParticle(wx, wy, Math.cos(a) * spd, Math.sin(a) * spd * 0.5,
      40 + Math.floor(Math.random() * 25), cr, cg, cb, 2 + Math.random() * 3, 'smoke');
  }

  // Damage player if in range
  if (damagePlayer) {
    const dist = Math.hypot(_charWorldX - wx, _charWorldY - wy);
    if (dist < PUFFER_EXPLOSION_RADIUS) {
      _damagePlayer(PUFFER_DAMAGE, wx, wy);
    }
  }
}

// ═══════════════════════════════════
//  PUFFER LAUNCHER PROJECTILES
// ═══════════════════════════════════

const _pufferProjectiles = [];
const PUFFER_PROJ_SEEK_RANGE = 250;
const PUFFER_PROJ_PLAYER_AGGRO_RANGE = 120; // closer range to turn on the player
const PUFFER_PROJ_FUSE = 240;       // 4 seconds seek fuse (dt-scaled)
const PUFFER_PROJ_DIRECT_DMG = 4;
const PUFFER_PROJ_SPLASH_DMG = 2;
const PUFFER_PROJ_AOE = 60;
const PUFFER_PROJ_KB = 4;           // knockback base force
const PUFFER_PROJ_LIFESPAN = 1200;  // 20 seconds (dt-scaled)
const PUFFER_PROJ_WANDER_SPEED = 0.08; // slow idle mosey
const PUFFER_PROJ_DEATH_INFLATE = 300; // 5 seconds death inflation (dt-scaled)

window._dexSpawnPufferProjectile = function(startWX, startWY, targetWX, targetWY) {
  const dist = Math.hypot(targetWX - startWX, targetWY - startWY);
  const arcDuration = Math.max(30, Math.min(80, dist * 0.06));
  _pufferProjectiles.push({
    startWX, startWY, targetWX, targetWY,
    wx: startWX, wy: startWY,
    arcT: 0, arcDuration,
    phase: 'flight',       // 'flight' | 'wander' | 'seeking' | 'dying'
    target: null,
    seekTimer: 0,
    seekSpeed: 0.3,
    scale: 0.65,
    aggroPlayer: false, // true when locked onto the player
    spinAngle: 0,
    bobT: Math.random() * Math.PI * 2,
    wiggleT: Math.random() * Math.PI * 2,
    life: PUFFER_PROJ_LIFESPAN,
    trailTimer: 0,
    squishT: 0,
    // Wander state
    wanderVX: 0, wanderVY: 0,
    wanderDirTimer: 0,
    // Dying state (no-target death inflate)
    dyingTimer: 0,
  });
};

function _tickPufferProjectiles() {
  for (let i = _pufferProjectiles.length - 1; i >= 0; i--) {
    const p = _pufferProjectiles[i];
    p.life -= _dt;
    p.wiggleT += 0.05 * _dt;

    // Lifespan expired — trigger death inflate if not already dying
    if (p.life <= 0) {
      if (p.phase !== 'dying') {
        p.phase = 'dying'; p.dyingTimer = 0; p.target = null;
      }
    }

    // ── Flight: arc to target ──
    if (p.phase === 'flight') {
      p.arcT += (1 / p.arcDuration) * _dt;
      p.spinAngle += 0.08 * _dt;
      const t = Math.min(1, p.arcT);
      p.wx = p.startWX + (p.targetWX - p.startWX) * t;
      p.wy = p.startWY + (p.targetWY - p.startWY) * t;
      const arcHeight = Math.hypot(p.targetWX - p.startWX, p.targetWY - p.startWY) * 0.3;
      p.wy -= arcHeight * 4 * t * (1 - t);
      // Trail particles
      p.trailTimer += _dt;
      if (p.trailTimer >= 2) {
        p.trailTimer = 0;
        const clrHex = (_cachedClr || '#7B8A9C').replace('#', '');
        const r = parseInt(clrHex.slice(0, 2), 16), g = parseInt(clrHex.slice(2, 4), 16), b = parseInt(clrHex.slice(4, 6), 16);
        _pAddParticle(p.wx, p.wy, (Math.random() - 0.5) * 0.15, 0.05 + Math.random() * 0.1,
          18 + Math.floor(Math.random() * 8), r, g, b, 1 + Math.random() * 1.5, 'spark');
      }
      if (p.arcT >= 1) {
        p.phase = 'wander';
        p.wx = p.targetWX; p.wy = p.targetWY;
        p.squishT = 12;
        const clrHex = (_cachedClr || '#7B8A9C').replace('#', '');
        const r = parseInt(clrHex.slice(0, 2), 16), g = parseInt(clrHex.slice(2, 4), 16), b = parseInt(clrHex.slice(4, 6), 16);
        for (let j = 0; j < 5; j++) {
          const a = Math.random() * Math.PI * 2;
          _pAddParticle(p.wx, p.wy, Math.cos(a) * 0.3, Math.sin(a) * 0.2,
            20 + Math.floor(Math.random() * 10), r, g, b, 1 + Math.random() * 1.5, 'smoke');
        }
      }
    }

    // ── Wander: mosey around, scan for targets ──
    else if (p.phase === 'wander') {
      p.bobT += 0.05 * _dt;
      p.spinAngle += 0.02 * _dt;
      if (p.squishT > 0) p.squishT -= _dt;

      // Random direction changes
      p.wanderDirTimer -= _dt;
      if (p.wanderDirTimer <= 0) {
        p.wanderDirTimer = 60 + Math.random() * 120;
        const a = Math.random() * Math.PI * 2;
        p.wanderVX = Math.cos(a) * PUFFER_PROJ_WANDER_SPEED;
        p.wanderVY = Math.sin(a) * PUFFER_PROJ_WANDER_SPEED;
      }
      p.wx += p.wanderVX * _dt;
      p.wy += p.wanderVY * _dt;
      // Boundary bounce
      if (p.wx < 50 || p.wx > WORLD_W - 50) p.wanderVX *= -1;
      if (p.wy < 50 || p.wy > WORLD_H - 50) p.wanderVY *= -1;

      // Scan for targets — creatures first, then player at closer range
      let bestDist = PUFFER_PROJ_SEEK_RANGE;
      p.aggroPlayer = false;
      for (const c of _liveCreatures) {
        if (c.dead) continue;
        const d = Math.hypot(c.x - p.wx, c.y - p.wy);
        if (d < bestDist) { bestDist = d; p.target = c; p.aggroPlayer = false; }
      }
      // Player aggro — closer range, only if no creature is closer
      const playerDist = Math.hypot(_charWorldX - p.wx, _charWorldY - p.wy);
      if (playerDist < PUFFER_PROJ_PLAYER_AGGRO_RANGE && playerDist < bestDist) {
        p.target = null; // no creature target — chasing player
        p.aggroPlayer = true;
      }
      if (p.target || p.aggroPlayer) {
        p.phase = 'seeking';
        p.seekTimer = 0;
      }
    }

    // ── Seeking: locked on, chasing creature or player ──
    else if (p.phase === 'seeking') {
      p.bobT += 0.06 * _dt;
      p.spinAngle += 0.04 * _dt;
      if (p.squishT > 0) p.squishT -= _dt;

      // Determine chase target position
      let targetX, targetY, targetLost = false;
      if (p.aggroPlayer) {
        targetX = _charWorldX; targetY = _charWorldY;
        // Player left range — return to wander
        if (Math.hypot(_charWorldX - p.wx, _charWorldY - p.wy) > PUFFER_PROJ_SEEK_RANGE) {
          targetLost = true;
        }
      } else if (p.target && !p.target.dead) {
        targetX = p.target.x; targetY = p.target.y;
      } else {
        targetLost = true;
      }
      if (targetLost) {
        p.target = null; p.aggroPlayer = false;
        p.phase = 'wander'; p.wanderDirTimer = 0;
        continue;
      }

      p.seekTimer += _dt;
      const progress = Math.min(1, p.seekTimer / PUFFER_PROJ_FUSE);
      p.scale = 0.65 + progress * 0.55; // inflate from 0.65 to 1.2
      p.seekSpeed = 0.3 + progress * 1.5;

      const dx = targetX - p.wx, dy = targetY - p.wy;
      const dist = Math.hypot(dx, dy);
      if (dist > 1) {
        p.wx += (dx / dist) * p.seekSpeed * _dt;
        p.wy += (dy / dist) * p.seekSpeed * _dt;
      }
      // Contact
      const contactR = 8 * p.scale + 10;
      if (dist < contactR) {
        // Explode — damages player if aggroed to them
        _explodePufferProjectile(p);
        if (p.aggroPlayer) _damagePlayer(PUFFER_PROJ_DIRECT_DMG, p.wx, p.wy);
        _pufferProjectiles.splice(i, 1);
        continue;
      }
      // Fuse expired
      if (p.seekTimer >= PUFFER_PROJ_FUSE) {
        _explodePufferProjectile(p);
        if (p.aggroPlayer && Math.hypot(_charWorldX - p.wx, _charWorldY - p.wy) < PUFFER_PROJ_AOE) {
          _damagePlayer(PUFFER_PROJ_SPLASH_DMG, p.wx, p.wy);
        }
        _pufferProjectiles.splice(i, 1);
        continue;
      }
    }

    // ── Dying: inflate and explode (no target, lifespan expired) ──
    else if (p.phase === 'dying') {
      p.dyingTimer += _dt;
      p.bobT += 0.04 * _dt;
      const progress = Math.min(1, p.dyingTimer / PUFFER_PROJ_DEATH_INFLATE);
      p.scale = 0.65 + progress * 0.45; // inflate from base to ~1.1
      // Slow to a stop
      p.wanderVX *= Math.pow(0.95, _dt);
      p.wanderVY *= Math.pow(0.95, _dt);
      p.wx += p.wanderVX * _dt;
      p.wy += p.wanderVY * _dt;
      // Explode at end of death inflate
      if (p.dyingTimer >= PUFFER_PROJ_DEATH_INFLATE) {
        _explodePufferProjectile(p);
        _pufferProjectiles.splice(i, 1);
        continue;
      }
    }
  }
}

function _drawPufferProjectile(p, ctx) {
  const { sx, sy } = worldToScreen(p.wx, p.wy);
  const clr = _cachedClr;
  const sc = p.scale;
  const bob = Math.sin(p.bobT) * 1.5;
  const drawY = sy + bob;

  // Wiggle: two blob layers shift back and forth
  const wiggle = Math.sin(p.wiggleT) * 1.5 * sc;
  const wiggle2 = Math.sin(p.wiggleT * 1.3 + 1) * 1.2 * sc;

  // Squish animation on landing
  let scaleX = 1, scaleY = 1;
  if (p.squishT > 0) {
    const t = p.squishT / 12;
    scaleX = 1 + t * 0.4;
    scaleY = 1 - t * 0.3;
  }

  const r = 7 * sc;

  // Body: two overlapping blob layers that shift for a living wobble
  ctx.fillStyle = clr;
  ctx.globalAlpha = 0.15;
  ctx.beginPath(); ctx.ellipse(sx + wiggle, drawY, r * 1.2 * scaleX, r * scaleY, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.15;
  ctx.beginPath(); ctx.ellipse(sx + wiggle2, drawY + 0.5, r * 1.15 * scaleX, r * 0.95 * scaleY, 0, 0, Math.PI * 2); ctx.fill();
  // Core blob
  ctx.globalAlpha = 0.45;
  ctx.beginPath(); ctx.ellipse(sx, drawY, r * 0.85 * scaleX, r * 0.75 * scaleY, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  // Outline
  ctx.strokeStyle = clr; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.ellipse(sx, drawY, r * scaleX, r * 0.85 * scaleY, 0, 0, Math.PI * 2); ctx.stroke();

  // Antennae: two small curved stubs on top
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.7;
  const antBaseY = drawY - r * 0.75 * scaleY;
  const antWave = Math.sin(p.wiggleT * 1.5) * 2;
  // Left antenna
  ctx.beginPath();
  ctx.moveTo(sx - 2.5 * sc, antBaseY);
  ctx.quadraticCurveTo(sx - 4 * sc + antWave, antBaseY - 5 * sc, sx - 2 * sc + antWave * 0.5, antBaseY - 7 * sc);
  ctx.stroke();
  // Right antenna
  ctx.beginPath();
  ctx.moveTo(sx + 2.5 * sc, antBaseY);
  ctx.quadraticCurveTo(sx + 4 * sc - antWave, antBaseY - 5 * sc, sx + 2 * sc - antWave * 0.5, antBaseY - 7 * sc);
  ctx.stroke();
  // Antenna tips (small dots)
  ctx.fillStyle = clr;
  ctx.beginPath(); ctx.arc(sx - 2 * sc + antWave * 0.5, antBaseY - 7 * sc, 0.8 * sc, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(sx + 2 * sc - antWave * 0.5, antBaseY - 7 * sc, 0.8 * sc, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  // Spikes (only during seeking or dying — grow as they inflate)
  const isSeeking = p.phase === 'seeking' && p.target;
  const isDying = p.phase === 'dying';
  const seekProgress = isSeeking ? Math.min(1, p.seekTimer / PUFFER_PROJ_FUSE) : 0;
  const dyingProgress = isDying ? Math.min(1, p.dyingTimer / PUFFER_PROJ_DEATH_INFLATE) : 0;
  const inflateProgress = Math.max(seekProgress, dyingProgress * 0.5); // dying = 50% intensity

  if (inflateProgress > 0.05) {
    const spikeCount = 6;
    const spikeLen = (2 + inflateProgress * 14) * sc;
    const tipR = (0.5 + inflateProgress * 1.5) * sc;
    ctx.globalAlpha = 0.3 + inflateProgress * 0.7;
    ctx.lineWidth = 1 + inflateProgress * 0.5;
    for (let j = 0; j < spikeCount; j++) {
      const angle = (j / spikeCount) * Math.PI * 2 + p.spinAngle;
      const bx = sx + Math.cos(angle) * r * scaleX;
      const by = drawY + Math.sin(angle) * r * 0.85 * scaleY;
      const tx = sx + Math.cos(angle) * (r + spikeLen) * scaleX;
      const ty = drawY + Math.sin(angle) * (r * 0.85 + spikeLen * 0.85) * scaleY;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.beginPath(); ctx.arc(tx, ty, tipR, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Eyes
  const eyeSpread = 2.5 * sc;
  const eyeY = drawY - 1 * sc;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(sx - eyeSpread, eyeY, 1.3 * sc, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(sx + eyeSpread, eyeY, 1.3 * sc, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = (isSeeking || isDying) ? clr : '#1a1a2e';
  ctx.beginPath(); ctx.arc(sx - eyeSpread, eyeY, 0.8 * sc, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(sx + eyeSpread, eyeY, 0.8 * sc, 0, Math.PI * 2); ctx.fill();

  // Countdown bar (seeking or dying)
  if (isSeeking || isDying) {
    const barW = 20 * sc, barH = 2;
    const spikeLen2 = inflateProgress > 0.05 ? (2 + inflateProgress * 14) * sc : 0;
    const barX = sx - barW / 2, barY = drawY - r - spikeLen2 - 10;
    const remaining = isSeeking ? (1 - seekProgress) : (1 - dyingProgress);
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = clr; ctx.fillRect(barX, barY, barW * remaining, barH);
  }
}

function _explodePufferProjectile(p) {
  const wx = p.wx, wy = p.wy;
  const sc = p.scale;
  const clrHex = (_cachedClr || '#7B8A9C').replace('#', '');
  const cr = parseInt(clrHex.slice(0, 2), 16);
  const cg = parseInt(clrHex.slice(2, 4), 16);
  const cb = parseInt(clrHex.slice(4, 6), 16);

  // Shockwave ring
  _pAddParticle(wx, wy, 0, 0, 25, cr, cg, cb, 0, 'aoe_ring');
  // Flash
  _pAddParticle(wx, wy, 0, 0, 12, Math.min(255, cr + 100), Math.min(255, cg + 100), Math.min(255, cb + 100), 0, 'flash');

  // Body chunks
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 0.4 + Math.random() * 1.2;
    const pt = _goreAdd(wx, wy, Math.cos(a) * spd, Math.sin(a) * spd * 0.5 - 0.2,
      400 + Math.floor(Math.random() * 200), 'blood', (1.5 + Math.random() * 2) * sc);
    pt.fallTargetWY = wy + 3 + Math.random() * 15; pt.falling = true;
  }
  // Spike shrapnel
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const spd = 0.8 + Math.random() * 1.0;
    const pt = _goreAdd(wx, wy, Math.cos(angle) * spd, Math.sin(angle) * spd * 0.5 - 0.3,
      350 + Math.floor(Math.random() * 150), 'part', 0, {
        partW: 1.2 * sc, partH: 5 * sc, partRound: false,
        partRot: angle, partRotV: (Math.random() - 0.5) * 0.2,
      });
    pt.fallTargetWY = wy + 5 + Math.random() * 18; pt.falling = true;
  }
  // Dust poof
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 0.2 + Math.random() * 0.6;
    _pAddParticle(wx, wy, Math.cos(a) * spd, Math.sin(a) * spd * 0.4,
      30 + Math.floor(Math.random() * 20), cr, cg, cb, 1.5 + Math.random() * 2, 'smoke');
  }

  // AOE damage + knockback to creatures (player immune to own puffer launcher)
  const directTarget = p.target;
  for (const c of _liveCreatures) {
    if (c.dead) continue;
    const dx = c.x - wx, dy = c.y - wy;
    const dist = Math.hypot(dx, dy);
    if (dist < PUFFER_PROJ_AOE) {
      const dmg = (c === directTarget) ? PUFFER_PROJ_DIRECT_DMG : PUFFER_PROJ_SPLASH_DMG;
      // Puffer creatures: trigger their own explosion
      if (c.kind === 'puffer') {
        c.hp -= dmg;
        if (c.hp <= 0) { _explodePuffer(c, false); }
        else if (!c.aggro) { c.aggro = true; c.aggroTimer = 0; }
        continue;
      }
      c.hp -= dmg;
      _spawnHitBlood(wx, wy, c);
      // Knockback
      const proximity = 1 - (dist / PUFFER_PROJ_AOE);
      const kbForce = PUFFER_PROJ_KB * proximity;
      const kbDir = dist > 0.1 ? { x: dx / dist, y: dy / dist } : { x: Math.random() - 0.5, y: Math.random() - 0.5 };
      const kbMult = c.kind === 'mammoth' ? 0.2 : c.kind === 'bird' ? 0 : 1.0;
      c.vx += kbDir.x * kbForce * kbMult;
      c.vy += kbDir.y * kbForce * kbMult;
      if (c.hp <= 0 && !c.dead) {
        c.dead = true; c.deadT = 0;
        c.vx = kbDir.x * kbForce * kbMult;
        c.vy = kbDir.y * kbForce * kbMult;
        if (c.kind === 'bird') {
          c._falling = true; c._fallWorldY = c.y;
          c._fallTargetWorldY = c.y + 150 + Math.random() * 250;
          c._fallVY = 0;
          _spawnWorldFeathers(c.x, c.y, c._fallTargetWorldY);
        } else {
          c._bloodSeed = Math.random();
          c._splatSeeds = Array.from({ length: 5 }, () => Math.random());
        }
        c._rocketDeath = true;
        _spawnRocketGore(c.x, c.y, c.scale || 1, c.kind === 'bird',
          c.kind === 'bird' ? c._fallTargetWorldY : undefined, kbDir.x * 3, kbDir.y * 3);
      } else if (c.hp > 0) {
        c._woundCount = (c._woundCount || 0) + dmg;
        c._trailTimer = 0;
      }
    }
  }
}

// ═══════════════════════════════════
//  SPELLBOOK — PORTAL + WRAITH SUMMON
// ═══════════════════════════════════

const _summonPortals = [];
// MD 12: wraiths are a pack now — up to WRAITH_MAX at once, each with its
// own portal/lifetime. Summoning past the cap fades the oldest one out.
const _activeWraiths = [];
const WRAITH_MAX = 4;
const WRAITH_MAX_AGE = 2880;       // ~12 seconds at the 240Hz reference
const WRAITH_SEEK_RANGE = 300;
const WRAITH_ATTACK_RANGE = 30;
const WRAITH_ATTACK_COOLDOWN = 90; // 1.5 seconds
const WRAITH_SPEED = 0.8;
const WRAITH_DMG = 2;
const WRAITH_RISE_DUR = 30;        // 0.5 seconds rise from portal
const PORTAL_SUMMON_DELAY = 60;    // 1 second before wraith rises
const PORTAL_FADE_DUR = 30;

window._dexSpawnWraith = function(wx, wy) {
  // Over the cap (counting portals about to produce one) — retire the oldest.
  const pending = _summonPortals.filter(p => p.phase === 'opening').length;
  if (_activeWraiths.length + pending >= WRAITH_MAX) {
    const oldest = _activeWraiths.find(w => w.phase !== 'fading');
    if (oldest) { oldest.phase = 'fading'; oldest.opacity = Math.min(oldest.opacity, 0.5); }
  }
  _summonPortals.push({ wx, wy, age: 0, phase: 'opening', spinAngle: 0 });
};

function _tickSummonPortals() {
  for (let i = _summonPortals.length - 1; i >= 0; i--) {
    const p = _summonPortals[i];
    p.age += _dt;
    p.spinAngle += 0.04 * _dt;

    if (p.phase === 'opening' && p.age >= PORTAL_SUMMON_DELAY) {
      p.phase = 'summoning';
      // Spawn the wraith
      _activeWraiths.push({
        wx: p.wx, wy: p.wy,
        target: null,
        age: 0, maxAge: WRAITH_MAX_AGE,
        phase: 'rising',
        riseT: 0,
        attackTimer: 0,
        bobT: Math.random() * Math.PI * 2,
        armSwayL: Math.random() * Math.PI * 2,
        armSwayR: Math.random() * Math.PI * 2,
        flickerTimer: 120 + Math.random() * 180,
        eyeFlicker: false,
        facingLeft: false,
        opacity: 1,
      });
    }
    if (p.phase === 'summoning' && p.age >= PORTAL_SUMMON_DELAY + WRAITH_RISE_DUR + PORTAL_FADE_DUR) {
      p.phase = 'fading';
    }
    if (p.phase === 'fading') {
      if (p.age >= PORTAL_SUMMON_DELAY + WRAITH_RISE_DUR + PORTAL_FADE_DUR * 2) {
        _summonPortals.splice(i, 1);
      }
    }
  }
}

function _drawSummonPortal(ctx, sx, sy, p) {
  const clr = _cachedClr;
  const openProgress = Math.min(1, p.age / 30); // first 0.5s opens
  const fadeStart = PORTAL_SUMMON_DELAY + WRAITH_RISE_DUR + PORTAL_FADE_DUR;
  const fadeAlpha = p.age > fadeStart ? Math.max(0, 1 - (p.age - fadeStart) / PORTAL_FADE_DUR) : 1;
  const pulse = 0.6 + Math.sin(p.age * 0.08) * 0.2;

  ctx.save();
  ctx.globalAlpha = fadeAlpha;

  // Outer glow
  ctx.fillStyle = clr; ctx.globalAlpha = fadeAlpha * 0.08 * openProgress;
  ctx.beginPath(); ctx.ellipse(sx, sy, 30 * openProgress, 10 * openProgress, 0, 0, Math.PI * 2); ctx.fill();
  // Mid ring
  ctx.strokeStyle = clr; ctx.lineWidth = 1.5; ctx.globalAlpha = fadeAlpha * 0.3 * pulse;
  ctx.beginPath(); ctx.ellipse(sx, sy, 20 * openProgress, 7 * openProgress, 0, 0, Math.PI * 2); ctx.stroke();
  // Inner core
  ctx.fillStyle = clr; ctx.globalAlpha = fadeAlpha * 0.2 * pulse;
  ctx.beginPath(); ctx.ellipse(sx, sy, 12 * openProgress, 4 * openProgress, 0, 0, Math.PI * 2); ctx.fill();

  // Spinning rune dots
  ctx.globalAlpha = fadeAlpha * 0.5;
  ctx.fillStyle = clr;
  for (let j = 0; j < 5; j++) {
    const angle = (j / 5) * Math.PI * 2 + p.spinAngle;
    const rx = 18 * openProgress, ry = 6 * openProgress;
    const dx = Math.cos(angle) * rx;
    const dy = Math.sin(angle) * ry;
    ctx.beginPath(); ctx.arc(sx + dx, sy + dy, 1.5, 0, Math.PI * 2); ctx.fill();
  }

  ctx.restore();
}

function _tickWraith() {
  for (let wi = _activeWraiths.length - 1; wi >= 0; wi--) {
    const w = _activeWraiths[wi];
    _tickOneWraith(w, wi);
  }
}

function _tickOneWraith(w, wi) {
  w.age += _dt;
  w.bobT += 0.03 * _dt;
  w.armSwayL += 0.025 * _dt;
  w.armSwayR += 0.02 * _dt;

  // Eye flicker
  w.flickerTimer -= _dt;
  if (w.flickerTimer <= 0) {
    w.eyeFlicker = !w.eyeFlicker;
    w.flickerTimer = w.eyeFlicker ? (5 + Math.random() * 8) : (120 + Math.random() * 240);
  }

  // Lifetime
  if (w.age >= w.maxAge && w.phase !== 'fading') {
    w.phase = 'fading';
  }

  if (w.phase === 'rising') {
    w.riseT += _dt;
    if (w.riseT >= WRAITH_RISE_DUR) w.phase = 'seeking';
  }

  else if (w.phase === 'seeking' || w.phase === 'orbiting') {
    // Find target — prefer creatures no packmate is already on, so a pack
    // of wraiths spreads out instead of dogpiling one yak.
    if (!w.target || w.target.dead || (w.target._gammaT != null && w.target._gammaT >= (w.target._gammaPopT || 1) * 0.85)) {
      w.target = null;
      const taken = new Set();
      for (const o of _activeWraiths) { if (o !== w && o.target) taken.add(o.target); }
      let bestDist = WRAITH_SEEK_RANGE, bestTakenDist = WRAITH_SEEK_RANGE;
      let bestTaken = null;
      for (const c of _liveCreatures) {
        if (c.dead || (c._gammaT != null && c._gammaT >= (c._gammaPopT || 1) * 0.85)) continue;
        const d = Math.hypot(c.x - w.wx, c.y - w.wy);
        if (taken.has(c)) {
          if (d < bestTakenDist) { bestTakenDist = d; bestTaken = c; }
        } else if (d < bestDist) { bestDist = d; w.target = c; }
      }
      if (!w.target) w.target = bestTaken;   // everyone's taken — pile on
    }
    if (w.target && !w.target.dead) {
      w.phase = 'seeking';
      const dx = w.target.x - w.wx, dy = w.target.y - w.wy;
      const dist = Math.hypot(dx, dy);
      w.facingLeft = dx < 0;
      if (dist > WRAITH_ATTACK_RANGE) {
        // Float toward target with sinusoidal wobble
        const wobbleX = Math.sin(w.bobT * 3) * 0.3;
        w.wx += ((dx / dist) * WRAITH_SPEED + wobbleX) * _dt;
        w.wy += (dy / dist) * WRAITH_SPEED * _dt;
      } else {
        // In range — attack
        w.attackTimer += _dt;
        if (w.attackTimer >= WRAITH_ATTACK_COOLDOWN) {
          w.attackTimer = 0;
          w.target.hp -= WRAITH_DMG;
          _spawnHitBlood(w.target.x, w.target.y, w.target);
          if (w.target.kind === 'mammoth') w.target._woundCount = (w.target._woundCount || 0) + WRAITH_DMG;
          if (w.target.hp <= 0 && !w.target.dead) {
            w.target.dead = true; w.target.deadT = 0;
            w.target.vx = 0; w.target.vy = 0;
            if (w.target.kind === 'bird') {
              w.target._falling = true; w.target._fallWorldY = w.target.y;
              w.target._fallTargetWorldY = w.target.y + 150 + Math.random() * 200;
              w.target._fallVY = 0;
              _spawnWorldFeathers(w.target.x, w.target.y, w.target._fallTargetWorldY);
            } else if (w.target.kind === 'puffer') {
              _explodePuffer(w.target, false);
            } else {
              w.target._bloodSeed = Math.random();
              w.target._splatSeeds = Array.from({ length: 5 }, () => Math.random());
            }
            w.target = null;
          }
        }
      }
    } else {
      // No target — orbit player
      w.phase = 'orbiting';
      const dx = _charWorldX - w.wx, dy = _charWorldY - w.wy;
      const dist = Math.hypot(dx, dy);
      w.facingLeft = dx < 0;
      if (dist > 60) {
        w.wx += (dx / dist) * WRAITH_SPEED * 0.6 * _dt;
        w.wy += (dy / dist) * WRAITH_SPEED * 0.6 * _dt;
      } else {
        // Gentle orbit
        const orbitAngle = w.bobT * 0.5;
        w.wx += Math.cos(orbitAngle) * 0.2 * _dt;
        w.wy += Math.sin(orbitAngle) * 0.15 * _dt;
      }
    }
  }

  else if (w.phase === 'fading') {
    w.opacity -= 0.015 * _dt;
    if (w.opacity <= 0) { _activeWraiths.splice(wi, 1); }
  }
}

function _drawWraith(ctx, sx, sy, w) {
  const clr = _cachedClr;
  const bob = Math.sin(w.bobT) * 4;
  // Rise offset: during rising phase, wraith is below portal
  const riseOff = w.phase === 'rising' ? (1 - Math.min(1, w.riseT / WRAITH_RISE_DUR)) * 30 : 0;
  const drawY = sy + bob - riseOff;
  const flip = w.facingLeft ? -1 : 1;

  ctx.save();
  ctx.globalAlpha = w.opacity;

  // Ambient glow behind body
  ctx.fillStyle = clr; ctx.globalAlpha = w.opacity * 0.06;
  ctx.beginPath(); ctx.arc(sx, drawY - 10, 22, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = w.opacity;

  // Torso: translucent layered ellipses below head
  ctx.fillStyle = clr;
  ctx.globalAlpha = w.opacity * 0.08;
  ctx.beginPath(); ctx.ellipse(sx, drawY + 4, 9, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = w.opacity * 0.15;
  ctx.beginPath(); ctx.ellipse(sx, drawY + 3, 6, 9, 0, 0, Math.PI * 2); ctx.fill();

  // Wispy tatter strands below torso
  ctx.strokeStyle = clr; ctx.lineWidth = 1; ctx.globalAlpha = w.opacity * 0.2;
  for (let i = 0; i < 3; i++) {
    const strandX = sx + (i - 1) * 5;
    const sway = Math.sin(w.armSwayL + i * 1.5) * 3;
    ctx.beginPath();
    ctx.moveTo(strandX, drawY + 12);
    ctx.quadraticCurveTo(strandX + sway, drawY + 20, strandX + sway * 0.5, drawY + 26);
    ctx.stroke();
  }

  // Head: layered ellipses (elongated vertically)
  ctx.fillStyle = clr;
  ctx.globalAlpha = w.opacity * 0.1;
  ctx.beginPath(); ctx.ellipse(sx, drawY - 12, 13, 15, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = w.opacity * 0.2;
  ctx.beginPath(); ctx.ellipse(sx, drawY - 12, 9, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = w.opacity * 0.35;
  ctx.beginPath(); ctx.ellipse(sx, drawY - 12, 6, 8, 0, 0, Math.PI * 2); ctx.fill();
  // Head outline
  ctx.globalAlpha = w.opacity * 0.5;
  ctx.strokeStyle = clr; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.ellipse(sx, drawY - 12, 8, 10, 0, 0, Math.PI * 2); ctx.stroke();

  // Eyes: white sclera with accent slit pupils
  const eyeAlpha = w.eyeFlicker ? 0.2 : 0.85;
  ctx.globalAlpha = w.opacity * eyeAlpha;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(sx - 3 * flip, drawY - 14, 2.2, 1.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(sx + 3 * flip, drawY - 14, 2.2, 1.6, 0, 0, Math.PI * 2); ctx.fill();
  // Slit pupils
  ctx.fillStyle = clr;
  ctx.beginPath(); ctx.ellipse(sx - 3 * flip, drawY - 14, 0.8, 1.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(sx + 3 * flip, drawY - 14, 0.8, 1.4, 0, 0, Math.PI * 2); ctx.fill();

  // Mouth — jagged line
  ctx.globalAlpha = w.opacity * 0.3; ctx.strokeStyle = clr; ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(sx - 3, drawY - 8);
  ctx.lineTo(sx - 1, drawY - 7); ctx.lineTo(sx + 1, drawY - 8.5); ctx.lineTo(sx + 3, drawY - 7.5);
  ctx.stroke();

  // Arms: long, dangling, swaying
  ctx.globalAlpha = w.opacity * 0.4; ctx.strokeStyle = clr; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  const armSwayL = Math.sin(w.armSwayL) * 8;
  const armSwayR = Math.sin(w.armSwayR) * 8;
  // Attack lunge: if attacking and timer just reset, swing front arm forward
  const attacking = w.target && w.attackTimer < 15;
  const lungeFwd = attacking ? 12 : 0;

  // Left arm
  const laX = sx - 8, laY = drawY - 2;
  const laElbowX = laX - 4 + armSwayL * 0.5, laElbowY = laY + 18 + Math.sin(w.armSwayL * 1.3) * 3;
  const laTipX = laElbowX - 2 + armSwayL - (w.facingLeft ? lungeFwd : 0);
  const laTipY = laElbowY + 22 + Math.sin(w.armSwayL * 0.7) * 4;
  ctx.beginPath(); ctx.moveTo(laX, laY);
  ctx.quadraticCurveTo(laElbowX, laElbowY, laTipX, laTipY); ctx.stroke();
  // Fingers
  ctx.lineWidth = 0.8;
  for (let f = 0; f < 3; f++) {
    const fa = (f - 1) * 0.4;
    ctx.beginPath(); ctx.moveTo(laTipX, laTipY);
    ctx.lineTo(laTipX + Math.cos(fa - 0.5) * 5, laTipY + Math.sin(fa + 1) * 5); ctx.stroke();
  }

  // Right arm
  ctx.lineWidth = 1.5;
  const raX = sx + 8, raY = drawY - 2;
  const raElbowX = raX + 4 + armSwayR * 0.5, raElbowY = raY + 18 + Math.sin(w.armSwayR * 1.3) * 3;
  const raTipX = raElbowX + 2 + armSwayR + (!w.facingLeft ? lungeFwd : 0);
  const raTipY = raElbowY + 22 + Math.sin(w.armSwayR * 0.7) * 4;
  ctx.beginPath(); ctx.moveTo(raX, raY);
  ctx.quadraticCurveTo(raElbowX, raElbowY, raTipX, raTipY); ctx.stroke();
  ctx.lineWidth = 0.8;
  for (let f = 0; f < 3; f++) {
    const fa = (f - 1) * 0.4;
    ctx.beginPath(); ctx.moveTo(raTipX, raTipY);
    ctx.lineTo(raTipX + Math.cos(fa + 0.5) * 5, raTipY + Math.sin(fa + 1) * 5); ctx.stroke();
  }

  ctx.restore();
}

function _spawnRocketGore(wx, wy, scale, isBird, fallTargetWY, pvx, pvy) {
  const pLen = Math.hypot(pvx || 0, pvy || 0) || 1;
  const dirX = (pvx || 0) / pLen, dirY = (pvy || 0) / pLen;
  const bias = 0.35;

  if (isBird && fallTargetWY !== undefined) {
    // ── BIRD: droplets that fall to the ground ──
    const dropCount = 8 + Math.floor(Math.random() * 3);
    for (let i = 0; i < dropCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 0.3 + Math.random() * 2.0;
      let vx = Math.cos(a) * spd, vy = Math.sin(a) * spd * 0.3;
      vx += dirX * spd * bias; vy += dirY * spd * bias * 0.3;
      const sz = 0.8 + Math.random() * 2.2;
      const pt = _goreAdd(wx, wy, vx, vy,
        600 + Math.floor(Math.random() * 300), 'blood', sz);
      pt.fallTargetWY = fallTargetWY + Math.random() * 40;
      pt.falling = true;
      pt.vy = Math.abs(pt.vy) + 1.0 + Math.random() * 2.5;
    }
    // Feathers also fall to the ground
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 0.3 + Math.random() * 0.6;
      const pt = _goreAdd(wx, wy, Math.cos(a)*spd, Math.sin(a)*spd*0.4,
        80 + Math.floor(Math.random()*50), 'feather', 1.5 + Math.random()*1.5);
      pt.fallTargetWY = fallTargetWY + Math.random() * 30;
      pt.falling = true;
      pt.vy = Math.abs(pt.vy) + 0.2 + Math.random() * 0.5;
    }
    _goreAdd(wx, wy, 0, 0, 10, 'flash', 0);
    return;
  }

  // ── NON-BIRD: heavy gore explosion ──

  // Ring 1: dense center — large blobs, slow
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 0.15 + Math.random() * 0.6;
    let vx = Math.cos(a)*spd + dirX*spd*bias;
    let vy = Math.sin(a)*spd*0.3 + dirY*spd*bias*0.3;
    const pt = _goreAdd(wx, wy, vx, vy, 1200+Math.floor(Math.random()*400), 'blood', (4+Math.random()*6)*scale);
    pt.fallTargetWY = wy + 1 + Math.random() * 6;
    pt.falling = true;
  }
  // Ring 2: medium scatter — wider spread
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 0.6 + Math.random() * 1.4;
    let vx = Math.cos(a)*spd + dirX*spd*bias;
    let vy = Math.sin(a)*spd*0.35 + dirY*spd*bias*0.35;
    const pt = _goreAdd(wx, wy, vx, vy, 1200+Math.floor(Math.random()*400), 'blood', (2.5+Math.random()*4)*scale);
    pt.fallTargetWY = wy + 2 + Math.random() * 10;
    pt.falling = true;
  }
  // Ring 3: far-flung drops — fast, wide dispersal
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 1.5 + Math.random() * 2.0;
    let vx = Math.cos(a)*spd + dirX*spd*bias;
    let vy = Math.sin(a)*spd*0.3 + dirY*spd*bias*0.3;
    const pt = _goreAdd(wx, wy, vx, vy, 1200+Math.floor(Math.random()*400), 'blood', (1.5+Math.random()*2.5)*scale);
    pt.fallTargetWY = wy + 4 + Math.random() * 16;
    pt.falling = true;
  }

  // Flash — bigger
  _goreAdd(wx, wy, 0, 0, 18, 'flash', 0);

  // Body parts — more pieces, faster spin
  const partDefs = [
    { w:1.5*scale, h:8*scale }, { w:1.5*scale, h:8*scale },
    { w:1.5*scale, h:7*scale }, { w:1.5*scale, h:7*scale },
    { w:1.5*scale, h:6*scale }, { w:1.5*scale, h:6*scale },
    { w:12*scale, h:5*scale }, { w:8*scale, h:3*scale },
    { w:5*scale, h:5*scale, round:true }, { w:4*scale, h:4*scale, round:true },
  ];
  for (const def of partDefs) {
    const a = Math.random() * Math.PI * 2;
    const spd = 0.8 + Math.random() * 1.5;
    let vx = Math.cos(a)*spd + dirX*spd*bias;
    let vy = Math.sin(a)*spd*0.4 - 0.3 + dirY*spd*bias*0.4;
    const pt = _goreAdd(wx, wy, vx, vy, 1200+Math.floor(Math.random()*400), 'part', 0, {
      partW: def.w, partH: def.h, partRound: def.round || false,
      partRot: Math.random() * Math.PI * 2,
      partRotV: (Math.random() - 0.5) * 0.2,
    });
    pt.fallTargetWY = wy + 5 + Math.random() * 22;
    pt.falling = true;
  }
}

// Called from character.js _frame() — NOT a separate RAF loop
// This ensures single-threaded: input → physics → world update → canvas render
export function tickPlayMode(vx, vy, dt) {
  if (!_active || !_worldCanvas || !_worldCtx) return;
  _dt = dt || 1;
  _fxTime += _dt;   // MD 04: drives ambient sway (grass, shrubs)
  const sw = _worldCanvas.width, sh = _worldCanvas.height;

  // Drop-in animation: same gravity as note-mode platformer
  if (_playModeDropping) {
    _playModeDropFrames += _dt;
    _playModeDropVel = Math.min(_playModeDropVel + 0.18 * _dt, 8);
    _playModeDropY += _playModeDropVel * _dt;
    if (_playModeDropY >= _playModeDropTargetY) {
      _playModeDropY = _playModeDropTargetY;
      _playModeDropping = false;
      _playModeDropVel = 0;
      // Trigger collapse on landing
      if (_charModule && _charModule.triggerPlayModeLanding) {
        _charModule.triggerPlayModeLanding();
      }
    }
    vx = 0; vy = 0;
  }

  // Player damage system — tick knockback, stun, respawn
  _tickPlayerDamage();
  // Block movement when stunned, dead, or in tank
  if (_playerStunTimer > 0 || _playerDead || _inTank) { vx = 0; vy = 0; }

  // Accumulate world position from character velocity
  _charWorldX += vx;
  _charWorldY += vy;
  // ── Solid footprint collision: push character out of building bases ──
  _getBuildingFootprints().forEach(fp => {
    const cr = 6;
    if (_charWorldX + cr > fp.x - fp.hw && _charWorldX - cr < fp.x + fp.hw &&
        _charWorldY > fp.top && _charWorldY - cr < fp.y) {
      const pushL = (_charWorldX + cr) - (fp.x - fp.hw);
      const pushR = (fp.x + fp.hw) - (_charWorldX - cr);
      const pushT = _charWorldY - fp.top;
      const pushB = fp.y - (_charWorldY - cr);
      const minPush = Math.min(pushL, pushR, pushT, pushB);
      if (minPush === pushT) _charWorldY = fp.top;
      else if (minPush === pushB) _charWorldY = fp.y + cr;
      else if (minPush === pushL) _charWorldX = fp.x - fp.hw - cr;
      else _charWorldX = fp.x + fp.hw + cr;
    }
  });
  _charWorldX = Math.max(0, Math.min(WORLD_W, _charWorldX));
  _charWorldY = Math.max(0, Math.min(WORLD_H, _charWorldY));
  updateCamera(_charWorldX, _charWorldY);
  let { sx, sy } = worldToScreen(_charWorldX, _charWorldY);
  // Clamp screen position to screen edges (no sidebar in game mode)
  if (sx < 18) { sx = 18; _charWorldX = _camera.x - window.innerWidth/2 + 18; }
  if (sx > window.innerWidth - 18) { sx = window.innerWidth - 18; }
  if (sy < 18) { sy = 18; }
  if (sy > window.innerHeight - 18) { sy = window.innerHeight - 18; }

  // Live accent — change --accent on the host page and the world recolors.
  let rawClr = getAccent();
  _cachedClr = rawClr;

  // Smooth background color transition (lerp for canvas, matches CSS theme-transition)
  const targetBg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#13141a';
  if (_bgLerpTo !== targetBg) {
    _bgLerpFrom = _bgLerpTo || targetBg;
    _bgLerpTo = targetBg;
    _bgLerpStart = performance.now();
  }
  const bgElapsed = performance.now() - _bgLerpStart;
  const bgColor = (bgElapsed < _bgLerpDuration && _bgLerpFrom)
    ? _lerpColor(_bgLerpFrom, _bgLerpTo, bgElapsed / _bgLerpDuration)
    : _bgLerpTo;
  _currentBg = bgColor;
  _worldCtx.fillStyle = bgColor;
  _worldCtx.fillRect(0, 0, sw, sh);
  if (_worldFrontCtx) _worldFrontCtx.clearRect(0, 0, _worldFrontCanvas.width, _worldFrontCanvas.height);

  // Apply zoom — scale canvas from center so all world content scales uniformly
  _worldCtx.save();
  _worldCtx.translate(sw / 2, sh / 2);
  _worldCtx.scale(_zoom, _zoom);
  _worldCtx.translate(-sw / 2, -sh / 2);

  // MD 08 types slot under the scatter: ponds sit on the ground, everything
  // else y-sorts within its band like the originals.
  const renderOrder = { pond:-1, grass:0, flower:0, shrub:1, log:1, campfire:1, rock:2, menhir:2, tree:3, yak:4, tank:4, home:5, treehouse:5, castle:5, shop:5, jail:5 };
  const visible = getVisibleObjects();
  visible.sort((a, b) => (renderOrder[a.type]||0) - (renderOrder[b.type]||0) || a.y - b.y);

  // ── Depth sorting: character behind buildings when feet above footprint ──
  const homeObj = _getHomeObj();
  const charBehindHome = homeObj && _charWorldY <= homeObj.y - HOME_FOOT_H;
  const castleObj = _worldObjects.find(o => o.type === 'castle');
  const charBehindCastle = castleObj && _charWorldY <= castleObj.y - CASTLE_FOOT_H;
  const jailObj = _worldObjects.find(o => o.type === 'jail');
  const charBehindJail = jailObj && _charWorldY <= jailObj.y - JAIL_FOOT_H;
  const shopObj = _worldObjects.find(o => o.type === 'shop');
  const charBehindShop = shopObj && _charWorldY <= shopObj.y - SHOP_FOOT_H;
  // Tank depth sorting
  const tankObj = _worldObjects.find(o => o.type === 'tank');
  const tankBehindHome = tankObj && homeObj && tankObj.y <= homeObj.y - HOME_FOOT_H;
  const tankBehindCastle = tankObj && castleObj && tankObj.y <= castleObj.y - CASTLE_FOOT_H;
  const tankBehindJail = tankObj && jailObj && tankObj.y <= jailObj.y - JAIL_FOOT_H;
  const tankBehindShop = tankObj && shopObj && tankObj.y <= shopObj.y - SHOP_FOOT_H;
  // Treehouse depth sorting
  const treehouseObj = _worldObjects.find(o => o.type === 'treehouse');
  const charBehindTreehouse = treehouseObj && _charWorldY <= treehouseObj.y - TREEHOUSE_FOOT_H;
  const tankBehindTreehouse = tankObj && treehouseObj && tankObj.y <= treehouseObj.y - TREEHOUSE_FOOT_H;

  // ── Render: all non-home/building objects ──
  visible.forEach(obj => {
    if (obj.type === 'home' || obj.type === 'castle' || obj.type === 'shop' || obj.type === 'jail' || obj.type === 'treehouse') return;
    if (obj.type === 'tank') return; // drawn later with depth sorting
    drawObject(obj);
  });
  // Draw tank on world canvas (will be covered by front-canvas buildings when behind)
  if (tankObj) { const ts=worldToScreen(tankObj.x,tankObj.y); _drawTank(_worldCtx,ts.sx,ts.sy,tankObj); }

  // ── Multiplayer: projectiles draw on the world canvas (zoomed); remote player
  // DOM elements are updated after _worldCtx.restore() so they don't drift with camera lerp.
  // Photon send loop runs on its own 50ms timer (in photon-client.js)
  _tickRemoteProjectiles();
  _drawRemoteProjectiles(_worldCtx);

  // ── Chimney smoke puffs ──
  _chimneySmokeCd -= _dt;
  if (_chimneySmokeCd <= 0) { _spawnChimneySmoke(); _chimneySmokeCd = 12; }

  // ── Tick creatures + classify for depth sorting ──
  _tickLiveCreatures();
  _tickPufferProjectiles();
  const ctx = _worldCtx;
  const visBuf = 200;
  const _bldgFPs = _getBuildingFootprints();
  const creaturesForBehind = [];
  const creaturesForFront = [];
  _liveCreatures.forEach(c => {
    if (c._carried || c.kind === 'bird') { creaturesForFront.push(c); return; }
    let isBehind = false;
    for (const fp of _bldgFPs) {
      if (c.y < fp.top && c.x > fp.x - fp.hw - 20 && c.x < fp.x + fp.hw + 20) { isBehind = true; break; }
    }
    (isBehind ? creaturesForBehind : creaturesForFront).push(c);
  });

  // Draw creatures behind buildings (will be covered by building fills)
  creaturesForBehind.forEach(c => {
    const { sx: csx, sy: csy } = worldToScreen(c.x, c.y);
    if (csx > -visBuf && csx < sw+visBuf && csy > -visBuf && csy < sh+visBuf) {
      _drawLiveCreature(c, ctx);
    }
  });

  // ── Buildings: draw bg fills ──
  if (homeObj) {
    const hs = worldToScreen(homeObj.x, homeObj.y);
    _drawHome(_worldCtx, hs.sx, hs.sy, 'behind');
  }
  if (castleObj) { const cs = worldToScreen(castleObj.x, castleObj.y); _drawCastle(_worldCtx, cs.sx, cs.sy, 'behind'); }
  if (shopObj) { const ss = worldToScreen(shopObj.x, shopObj.y); _drawShop(_worldCtx, ss.sx, ss.sy, 'behind'); }
  if (jailObj) { const js2 = worldToScreen(jailObj.x, jailObj.y); _drawJail(_worldCtx, js2.sx, js2.sy, 'behind'); }
  if (treehouseObj) { const ts2 = worldToScreen(treehouseObj.x, treehouseObj.y); _drawTreehouse(_worldCtx, ts2.sx, ts2.sy, 'behind'); }

  // ── If character is behind buildings: draw on FRONT canvas (z-200, above char overlay) ──
  if (homeObj && (charBehindHome||tankBehindHome) && _worldFrontCtx) {
    _worldFrontCtx.save();
    _worldFrontCtx.translate(sw / 2, sh / 2);
    _worldFrontCtx.scale(_zoom, _zoom);
    _worldFrontCtx.translate(-sw / 2, -sh / 2);
    const hs = worldToScreen(homeObj.x, homeObj.y);
    _drawHome(_worldFrontCtx, hs.sx, hs.sy, 'full');
    _worldFrontCtx.restore();
  }
  if (castleObj && (charBehindCastle||tankBehindCastle) && _worldFrontCtx) {
    _worldFrontCtx.save();
    _worldFrontCtx.translate(sw / 2, sh / 2);
    _worldFrontCtx.scale(_zoom, _zoom);
    _worldFrontCtx.translate(-sw / 2, -sh / 2);
    const cs = worldToScreen(castleObj.x, castleObj.y);
    _drawCastle(_worldFrontCtx, cs.sx, cs.sy, 'full');
    _worldFrontCtx.restore();
  }
  if (jailObj && (charBehindJail||tankBehindJail) && _worldFrontCtx) {
    _worldFrontCtx.save();
    _worldFrontCtx.translate(sw / 2, sh / 2);
    _worldFrontCtx.scale(_zoom, _zoom);
    _worldFrontCtx.translate(-sw / 2, -sh / 2);
    const js2 = worldToScreen(jailObj.x, jailObj.y);
    _drawJail(_worldFrontCtx, js2.sx, js2.sy, 'full');
    _worldFrontCtx.restore();
  }
  if (shopObj && (charBehindShop||tankBehindShop) && _worldFrontCtx) {
    _worldFrontCtx.save();
    _worldFrontCtx.translate(sw / 2, sh / 2);
    _worldFrontCtx.scale(_zoom, _zoom);
    _worldFrontCtx.translate(-sw / 2, -sh / 2);
    const ss = worldToScreen(shopObj.x, shopObj.y);
    _drawShop(_worldFrontCtx, ss.sx, ss.sy, 'full');
    _worldFrontCtx.restore();
  }
  if (treehouseObj && (charBehindTreehouse||tankBehindTreehouse) && _worldFrontCtx) {
    _worldFrontCtx.save();
    _worldFrontCtx.translate(sw/2,sh/2);_worldFrontCtx.scale(_zoom,_zoom);_worldFrontCtx.translate(-sw/2,-sh/2);
    const ts2=worldToScreen(treehouseObj.x,treehouseObj.y);
    _drawTreehouse(_worldFrontCtx,ts2.sx,ts2.sy,'full');
    _worldFrontCtx.restore();
  }

  // Draw creatures in front of buildings
  creaturesForFront.forEach(c => {
    if (c._carried) {
      if (c._bloodTrail && c._bloodTrail.length > 0) {
        ctx.fillStyle = _bloodColor();
        for (const drop of c._bloodTrail) {
          const fade = drop.age > 480 ? 1 - (drop.age - 480) / 120 : 1;
          if (fade <= 0) continue;
          ctx.globalAlpha = fade * 0.75;
          const { sx: dsx, sy: dsy } = worldToScreen(drop.wx, drop.wy);
          if (dsx < -10 || dsx > sw + 10 || dsy < -10 || dsy > sh + 10) continue;
          ctx.beginPath(); ctx.ellipse(dsx, dsy, drop.rx, drop.ry, 0, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      return;
    }
    const { sx: csx, sy: csy } = worldToScreen(c.x, c.y);
    if (csx > -visBuf && csx < sw+visBuf && csy > -visBuf && csy < sh+visBuf) {
      _drawLiveCreature(c, ctx);
    }
  });
  // Draw puffer launcher projectiles
  _pufferProjectiles.forEach(p => {
    const { sx: psx, sy: psy } = worldToScreen(p.wx, p.wy);
    if (psx > -visBuf && psx < sw+visBuf && psy > -visBuf && psy < sh+visBuf) {
      _drawPufferProjectile(p, ctx);
    }
  });

  // ── Summon portals + wraith ──
  _tickSummonPortals();
  _tickWraith();
  _tickLaserOverloads();
  _summonPortals.forEach(p => {
    const { sx: psx, sy: psy } = worldToScreen(p.wx, p.wy);
    if (psx > -visBuf && psx < sw + visBuf && psy > -visBuf && psy < sh + visBuf) {
      _drawSummonPortal(ctx, psx, psy, p);
    }
  });
  for (const w of _activeWraiths) {
    const { sx: wsx, sy: wsy } = worldToScreen(w.wx, w.wy);
    if (wsx > -visBuf && wsx < sw + visBuf && wsy > -visBuf && wsy < sh + visBuf) {
      _drawWraith(ctx, wsx, wsy, w);
    }
  }

  // ── Checkpoint flag ──
  _tickFlag();
  if (_flagPlanted) {
    const fs = worldToScreen(_flagWX, _flagWY);
    if (fs.sx > -visBuf && fs.sx < sw + visBuf && fs.sy > -visBuf && fs.sy < sh + visBuf) {
      _drawFlag(ctx, fs.sx, fs.sy);
    }
    // Flag pickup prompt
    _flagPromptVisible = false;
    if (!_inTank) {
      const fdist = Math.hypot(_charWorldX - _flagWX, _charWorldY - _flagWY);
      if (fdist < FLAG_PICKUP_RANGE) {
        _flagPromptVisible = true;
        _tickFlagPickupHold();
        _drawFlagPrompt(ctx, fs.sx, fs.sy);
      } else {
        _flagEHeld = false; _flagEHoldT = 0;
      }
    }
  }

  // ── If character is in front of house: draw full outlines BEFORE character overlay ──
  // Character overlay (HTML element) sits on top of the canvas, so drawing outlines
  // here means they appear behind the character — correct for "in front" z-order
  if (homeObj && !charBehindHome) {
    const hs = worldToScreen(homeObj.x, homeObj.y);
    _drawHome(_worldCtx, hs.sx, hs.sy, 'front');
  }
  if (castleObj && !charBehindCastle) {
    const cs = worldToScreen(castleObj.x, castleObj.y);
    _drawCastle(_worldCtx, cs.sx, cs.sy, 'front');
  }
  if (jailObj && !charBehindJail) {
    const js2 = worldToScreen(jailObj.x, jailObj.y);
    _drawJail(_worldCtx, js2.sx, js2.sy, 'front');
  }
  if (shopObj && !charBehindShop) {
    const ss = worldToScreen(shopObj.x, shopObj.y);
    _drawShop(_worldCtx, ss.sx, ss.sy, 'front');
  }
  if (treehouseObj && !charBehindTreehouse) {
    const ts2 = worldToScreen(treehouseObj.x, treehouseObj.y);
    _drawTreehouse(_worldCtx, ts2.sx, ts2.sy, 'front');
  }

  // ── Home proximity prompt ──
  _homePromptVisible = false;
  if (homeObj) {
    const dist = Math.hypot(_charWorldX - homeObj.x, _charWorldY - homeObj.y);
    if (dist < HOME_INTERACT_RADIUS) {
      _homePromptVisible = true;
      const hs = worldToScreen(homeObj.x, homeObj.y);
      _tickHomeHold();
      _drawHomePrompt(ctx, hs.sx, hs.sy);
    } else {
      _homeEHeld = false; _homeEHoldT = 0;
    }
  }

  // ── Tank proximity prompt + tick ──
  _tankPromptVisible = false;
  if (tankObj) {
    if (_inTank) {
      // Tank is being driven — tick movement with current key state
      _tickTank(window._dexTankKeys || { w: false, s: false, a: false, d: false });
    } else {
      // Check proximity for entry prompt
      const tdist = Math.hypot(_charWorldX - tankObj.x, _charWorldY - tankObj.y);
      if (tdist < TANK_INTERACT_RADIUS) {
        _tankPromptVisible = true;
        _tickTankHold();
        const ts = worldToScreen(tankObj.x, tankObj.y);
        _drawTankPrompt(ctx, ts.sx, ts.sy, tankObj);
      } else {
        _tankEHeld = false; _tankEHoldT = 0;
      }
    }
  }

  // ── World particles (canvas-drawn, camera-stable) ──
  for (let i = _worldParticles.length - 1; i >= 0; i--) {
    const pt = _worldParticles[i];
    pt.life -= _dt;
    if (pt.life <= 0) { _worldParticles.splice(i, 1); continue; }
    if (pt.type === 'flash') {
      const { sx: fsx, sy: fsy } = worldToScreen(pt.wx, pt.wy);
      const prog = 1 - pt.life / pt.maxLife;
      ctx.globalAlpha = (pt.life / pt.maxLife) * 0.5;
      ctx.fillStyle = `rgb(${pt.r},${pt.g},${pt.b})`;
      ctx.beginPath(); ctx.arc(fsx, fsy, prog * 28, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      continue;
    }
    if (pt.type === 'shell') {
      // Ejected casing — arcs with gravity, spins, fades.
      pt.vy += 0.045 * _dt;
      pt.vx *= Math.pow(0.985, _dt); pt.vy *= Math.pow(0.985, _dt);
      pt.wx += pt.vx * _dt; pt.wy += pt.vy * _dt;
      pt.rot = (pt.rot || 0) + (pt.rotV || 0.2) * _dt;
      const { sx: ssx, sy: ssy } = worldToScreen(pt.wx, pt.wy);
      if (ssx < -20 || ssx > sw + 20 || ssy < -20 || ssy > sh + 20) continue;
      ctx.globalAlpha = Math.min(1, (pt.life / pt.maxLife) * 2.5) * 0.9;
      ctx.fillStyle = `rgb(${pt.r},${pt.g},${pt.b})`;
      ctx.save();
      ctx.translate(ssx, ssy);
      ctx.rotate(pt.rot);
      ctx.fillRect(-2, -0.8, 4, 1.6);
      ctx.restore();
      ctx.globalAlpha = 1;
      continue;
    }
    if (pt.type === 'muzzle') {
      // Muzzle flash — a fast bright star that collapses in a few frames.
      const { sx: msx, sy: msy } = worldToScreen(pt.wx, pt.wy);
      const frac = pt.life / pt.maxLife;
      ctx.globalAlpha = frac * 0.85;
      ctx.strokeStyle = `rgb(${pt.r},${pt.g},${pt.b})`;
      ctx.lineWidth = 1.4;
      const rad = pt.size * (0.6 + (1 - frac) * 0.8);
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + 0.4;
        ctx.moveTo(msx, msy);
        ctx.lineTo(msx + Math.cos(a) * rad, msy + Math.sin(a) * rad);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      continue;
    }
    if (pt.type === 'hitring') {
      const { sx: hsx, sy: hsy } = worldToScreen(pt.wx, pt.wy);
      const prog = 1 - pt.life / pt.maxLife;
      ctx.globalAlpha = (pt.life / pt.maxLife) * 0.8;
      ctx.strokeStyle = `rgb(${pt.r},${pt.g},${pt.b})`;
      ctx.lineWidth = Math.max(0.5, 2 * (1 - prog));
      ctx.beginPath(); ctx.arc(hsx, hsy, 3 + prog * 13, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      continue;
    }
    if (pt.type === 'boomtext') {
      // Comic burst word (MD 17) — pops in with overshoot, drifts up,
      // fades out. Dark outline under an accent fill so it reads on
      // anything.
      pt.wy += (pt.vy || 0) * _dt;
      const { sx: bx, sy: by } = worldToScreen(pt.wx, pt.wy);
      const prog = 1 - pt.life / pt.maxLife;
      const grow = Math.min(1, prog * 3.2);
      const overshoot = 1 + 0.35 * Math.sin(grow * Math.PI);
      const px = Math.max(6, 30 * grow * overshoot);
      const frac = pt.life / pt.maxLife;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(pt.rot || 0);
      ctx.globalAlpha = frac < 0.4 ? frac / 0.4 : 1;
      ctx.font = '900 ' + px.toFixed(0) + 'px system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, px * 0.16);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(pt.text || 'POP!', 0, 0);
      ctx.fillStyle = `rgb(${pt.r},${pt.g},${pt.b})`;
      ctx.fillText(pt.text || 'POP!', 0, 0);
      ctx.restore();
      ctx.globalAlpha = 1;
      continue;
    }
    if (pt.type === 'aoe_ring') {
      const { sx: rsx, sy: rsy } = worldToScreen(pt.wx, pt.wy);
      const prog = 1 - pt.life / pt.maxLife;
      const radius = prog * 120;
      const fade = pt.life / pt.maxLife;
      ctx.globalAlpha = fade * 0.35;
      ctx.strokeStyle = `rgb(${pt.r},${pt.g},${pt.b})`;
      ctx.lineWidth = Math.max(0.5, (1 - prog) * 3);
      ctx.beginPath(); ctx.arc(rsx, rsy, radius, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = fade * fade * 0.12;
      ctx.fillStyle = `rgb(${pt.r},${pt.g},${pt.b})`;
      ctx.beginPath(); ctx.arc(rsx, rsy, radius * 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      continue;
    }
    // Chimney smoke: custom movement + drawing
    if (pt.type === 'chimney') {
      const age = pt.maxLife - pt.life;
      const sineOffset = Math.sin(age * (pt._sineFreq || 0.01) + (pt._sinePhase || 0)) * (pt._sineAmp || 0.3);
      pt.wx += (pt.vx + sineOffset * 0.08) * _dt;
      pt.wy += pt.vy * _dt;
      pt.vx *= Math.pow(0.9995, _dt); pt.vy *= Math.pow(0.9995, _dt);
      const { sx: psx, sy: psy } = worldToScreen(pt.wx, pt.wy);
      if (psx < -20 || psx > sw+20 || psy < -20 || psy > sh+20) continue;
      const lifeFrac = pt.life / pt.maxLife;
      const fadeIn = Math.min(1, age / 30);
      const fadeOut = lifeFrac < 0.3 ? lifeFrac / 0.3 : 1;
      ctx.globalAlpha = fadeIn * fadeOut * (pt._baseOpacity || 0.4);
      ctx.fillStyle = `rgb(${pt.r},${pt.g},${pt.b})`;
      const growFactor = 1 + (1 - lifeFrac) * 0.8;
      ctx.beginPath(); ctx.arc(psx, psy, Math.max(0.5, pt.size * growFactor), 0, Math.PI * 2); ctx.fill();
      continue;
    }
    // MD 04: _dt-scaled integration. This branch used to step per *frame*
    // (gore already stepped per reference-time unit), so at 60Hz these
    // particles lived the right duration but travelled a quarter of the
    // distance. At 240Hz (_dt = 1) nothing changes.
    if (pt.type !== 'smoke') {
      pt.vy += (pt.type === 'feather' ? 0.015 : 0.06) * _dt;
    }
    const damp = pt.type === 'smoke' ? 0.96 : pt.type === 'feather' ? 0.97 : 0.93;
    pt.vx *= Math.pow(damp, _dt);
    pt.vy *= Math.pow(damp, _dt);
    pt.wx += pt.vx * _dt; pt.wy += pt.vy * _dt;
    const { sx: psx, sy: psy } = worldToScreen(pt.wx, pt.wy);
    if (psx < -20 || psx > sw+20 || psy < -20 || psy > sh+20) continue;
    const alpha = Math.min(1, (pt.life / pt.maxLife) * 2.5);
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle = `rgb(${pt.r},${pt.g},${pt.b})`;
    const drawSize = pt.type === 'smoke'
      ? Math.max(0.5, pt.size * (0.6 + alpha * 0.4))
      : Math.max(0.5, pt.size * (pt.type === 'spark' ? 1 : alpha));
    ctx.beginPath();
    ctx.arc(psx, psy, drawSize, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ── Gore particles (blood, feathers, body parts) ──
  if (_goreParticles.length > 0) {
    const clrHex = (_cachedClr || '#7B8A9C').replace('#','');
    const cr = parseInt(clrHex.slice(0,2),16);
    const cg = parseInt(clrHex.slice(2,4),16);
    const cb = parseInt(clrHex.slice(4,6),16);

    // Tick ALL particles (physics, lifetime)
    for (let i = _goreParticles.length - 1; i >= 0; i--) {
      const pt = _goreParticles[i];
      pt.life -= _dt;
      if (pt.life <= 0) { _goreParticles.splice(i, 1); continue; }
      if (pt.type !== 'flash' && !pt.landed) {
        pt.vy += (pt.type === 'feather' ? 0.012 : 0.055) * _dt;
        pt.vx *= Math.pow(pt.type === 'feather' ? 0.975 : 0.94, _dt);
        pt.vy *= Math.pow(pt.type === 'feather' ? 0.975 : 0.94, _dt);
        pt.wx += pt.vx * _dt; pt.wy += pt.vy * _dt;
        if (pt.falling && pt.fallTargetWY !== undefined && pt.wy >= pt.fallTargetWY) {
          pt.wy = pt.fallTargetWY; pt.vx = 0; pt.vy = 0; pt.landed = true;
          if (pt.partRotV) pt.partRotV = 0;
        }
        if (!pt.falling && Math.abs(pt.vy) < 0.02 && pt.life < pt.maxLife * 0.85) {
          pt.vx = 0; pt.vy = 0; pt.landed = true;
          if (pt.partRotV) pt.partRotV = 0;
        }
      }
      if (pt.partRotV) pt.partRot = (pt.partRot || 0) + pt.partRotV * _dt;
    }

    // PASS 1: flash, blood, feathers (underneath)
    for (let i = 0; i < _goreParticles.length; i++) {
      const pt = _goreParticles[i];
      if (pt.type === 'part') continue;
      if (pt.type === 'flash') {
        const { sx: fsx, sy: fsy } = worldToScreen(pt.wx, pt.wy);
        const prog = 1 - pt.life / pt.maxLife;
        ctx.globalAlpha = (pt.life / pt.maxLife) * 0.55;
        ctx.fillStyle = _bloodColor();
        ctx.beginPath(); ctx.arc(fsx, fsy, prog * 32, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }
      const { sx: psx, sy: psy } = worldToScreen(pt.wx, pt.wy);
      if (psx < -60 || psx > sw+60 || psy < -60 || psy > sh+60) continue;
      const fadeStart = pt.maxLife * 0.15;
      const alpha = pt.life < fadeStart ? pt.life / fadeStart : 1.0;
      ctx.globalAlpha = alpha * 0.92;
      if (pt.type === 'blood') {
        ctx.fillStyle = _bloodColor();
        const rx = pt.landed ? pt.size * 1.3 : pt.size;
        const ry = pt.landed ? pt.size * 0.35 : pt.size * 0.55;
        ctx.beginPath(); ctx.ellipse(psx, psy, Math.max(0.5, rx), Math.max(0.3, ry), 0, 0, Math.PI*2); ctx.fill();
      } else if (pt.type === 'feather') {
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
        ctx.beginPath(); ctx.ellipse(psx, psy, Math.max(0.5, pt.size*1.5), Math.max(0.3, pt.size*0.6), 0, 0, Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // PASS 2: parts ON TOP of blood
    for (let i = 0; i < _goreParticles.length; i++) {
      const pt = _goreParticles[i];
      if (pt.type !== 'part') continue;
      const { sx: psx, sy: psy } = worldToScreen(pt.wx, pt.wy);
      if (psx < -60 || psx > sw+60 || psy < -60 || psy > sh+60) continue;
      const fadeStart = pt.maxLife * 0.15;
      const alpha = pt.life < fadeStart ? pt.life / fadeStart : 1.0;
      ctx.globalAlpha = alpha * 0.92;
      ctx.strokeStyle = `rgb(${cr},${cg},${cb})`;
      ctx.lineWidth = 1.5;
      ctx.save(); ctx.translate(psx, psy); ctx.rotate(pt.partRot || 0);
      const pw = pt.landed ? pt.partW * 1.4 : pt.partW;
      const ph = pt.landed ? Math.max(1, pt.partH * 0.3) : pt.partH;
      if (pt.partRound) { ctx.beginPath(); ctx.arc(0, 0, pw/2, 0, Math.PI*2); ctx.stroke(); }
      else { ctx.strokeRect(-pw/2, -ph/2, pw, ph); }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  // ── Draw chat bubble above character ──
  if (_chatBubbleText && Date.now() < _chatBubbleExpiry) {
    const _chatFont = _getChatFont();
    const _chatFs = _getChatFontSize();
    const _jOff = window._dexCharJumpOffset || 0;
    const _hOff = window._dexCharHoverOffset || 0;
    const bx = sx, by = sy - 70 + (_jOff - _hOff) / _zoom;
    ctx.font = `${_chatFs}px ${_chatFont}`;
    const lines = _wrapBubbleText(_chatBubbleText, 24, 5);
    const lineH = _chatFs + 4, padX = 10, padY = 6;
    const measuredW = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
    const bw = measuredW + padX * 2;
    const bh = lines.length * lineH + padY * 2;
    // Bubble background
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    _roundRect(ctx, bx - bw/2, by - bh, bw, bh, 6);
    ctx.fill();
    // Bubble tail
    ctx.beginPath(); ctx.moveTo(bx - 5, by); ctx.lineTo(bx, by + 6); ctx.lineTo(bx + 5, by); ctx.closePath(); ctx.fill();
    // Text
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
      ctx.fillText(line, bx - bw/2 + padX, by - bh + padY + i * lineH);
    });
    ctx.textAlign = 'left';
    if (Date.now() >= _chatBubbleExpiry) _chatBubbleText = '';
  }

  // Restore canvas zoom before drawing screen-space UI
  _worldCtx.restore();

  // ── Remote players — update DOM positions after camera is finalized ──
  _tickRemoteInterpolation();
  _drawRemotePlayers(_worldCtx);

  // ── Draw chat log ──
  if (_chatOpen) {
    _drawChatLog(ctx, sw, sh);
  }

  // ── Player HP overlay (damage flash, HP bar, death screen) ──
  // HP bar is screen-space UI (drawn after ctx.restore), needs zoom-adjusted coords
  _drawPlayerHP(ctx, (sx - sw/2) * _zoom + sw/2, (sy - sh/2) * _zoom + sh/2);

  // Apply drop-in offset to screen position
  if (_playModeDropping) {
    sy = sy + _playModeDropY;
  }

  // Convert to zoomed screen coords for DOM character overlay
  const domSx = (sx - sw/2) * _zoom + sw/2;
  const domSy = (sy - sh/2) * _zoom + sh/2;

  return { sx: domSx, sy: domSy, zoom: _zoom };
}

// ═══════════════════════════════════
//  PLAY MODE CHAT
// ═══════════════════════════════════
let _chatOpen = false;    // chat log visible
let _chatTyping = false;  // actively typing (movement blocked)
let _chatInput = '';
let _chatHiddenInput = null;
let _chatEmojiColonIdx = -1;
let _chatLog = [];        // [{name, text, time, channel}]
let _chatBubbleText = '';
let _chatBubbleExpiry = 0;
let _chatSelectAll = false;
let _chatCursorIdx = -1; // -1 = end of input
let _chatSelStart = -1, _chatSelEnd = -1, _chatSelecting = false;
let _chatInputRect = null;
let _chatCopyFlash = -1;
let _chatCopyFlashTimer = 0;
let _logSelecting = false;
let _logSelStartPos = null, _logSelEndPos = null, _logSelText = '';
let _lastAllMsgLines = [], _lastMsgStartY = 0, _lastMsgLineH = 0, _lastMsgLogX = 0;
let _chatHideTimer = null;
let _chatChannel = 'public'; // 'public' | 'team' | 'dms'
// Chat window position + scale
let _chatPosX = 52, _chatPosY = null; // null = auto-position at bottom
let _chatScale = 1.0; // 1.0 = normal, up to 1.5
let _playModeDropping = false; // true during drop-in animation — blocks player input
let _playModeDropY = 0;       // screen-space Y offset during drop
let _playModeDropTargetY = 0;
let _playModeDropVel = 0;     // current fall velocity (simulates gravity)
let _playModeDropFrames = 0;  // frames since drop started — char hidden until > 0
let _chatDragging = false;
let _chatDragOX = 0, _chatDragOY = 0;
let _chatResizing = null; // 'right'|'bottom'|null
let _chatBaseW = 495, _chatBaseH = 240;
let _chatCursorScreenX = 0, _chatCursorScreenY = 0;
const CHAT_BUBBLE_DURATION = 5000;
const CHAT_MAX_CHARS = 500;
// Chat undo/redo
const _chatUndoStack=[];const _chatRedoStack=[];let _chatUndoTimer=null;
const CHAT_UNDO_MAX=50;const CHAT_UNDO_PAUSE=300;
function _chatUndoSnap(){
  clearTimeout(_chatUndoTimer);
  const cur=_chatInput;
  if(_chatUndoStack.length&&_chatUndoStack[_chatUndoStack.length-1]===cur)return;
  _chatUndoStack.push(cur);
  if(_chatUndoStack.length>CHAT_UNDO_MAX)_chatUndoStack.shift();
  _chatRedoStack.length=0;
}
function _chatUndoSchedule(){clearTimeout(_chatUndoTimer);_chatUndoTimer=setTimeout(()=>_chatUndoSnap(),CHAT_UNDO_PAUSE);}
function _chatUndo(){
  _chatUndoSnap();
  if(_chatUndoStack.length<=1)return;
  _chatRedoStack.push(_chatUndoStack.pop());
  _chatInput=_chatUndoStack[_chatUndoStack.length-1];
  _chatCursorIdx=_chatInput.length;
}
function _chatRedo(){
  if(!_chatRedoStack.length)return;
  const state=_chatRedoStack.pop();
  _chatUndoStack.push(state);
  _chatInput=state;
  _chatCursorIdx=_chatInput.length;
}
const CHAT_AUTO_HIDE_MS = 60000;

function _resetChatHideTimer() {
  clearTimeout(_chatHideTimer);
  _chatHideTimer = setTimeout(() => {
    if (!_chatTyping) { _chatOpen = false; }
  }, CHAT_AUTO_HIDE_MS);
}

function _wrapBubbleText(text, maxChars, maxLines) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if (lines.length >= maxLines) break;
    if (word.length > maxChars) {
      if (current) { lines.push(current); current = ''; }
      if (lines.length >= maxLines) break;
      for (let i = 0; i < word.length; i += maxChars) {
        if (lines.length >= maxLines) break;
        lines.push(word.slice(i, i + maxChars));
      }
      continue;
    }
    if (current.length + word.length + (current ? 1 : 0) > maxChars) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = current ? current + ' ' + word : word;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length > maxLines) lines.length = maxLines;
  return lines.length ? lines : [text.slice(0, maxChars)];
}

function _getChatFont() {
  return getComputedStyle(document.documentElement).getPropertyValue('--fn').trim() || 'outfit, sans-serif';
}
function _getChatFontSize() {
  const fs = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--fs'));
  return isNaN(fs) ? 16 : fs;
}

function _wrapChatText(ctx, text, maxWidth, maxLines) {
  maxLines = maxLines || 4;
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  for (const word of words) {
    if (lines.length >= maxLines) break;
    if (ctx.measureText(word).width > maxWidth) {
      if (currentLine) { lines.push(currentLine); currentLine = ''; if (lines.length >= maxLines) break; }
      let chunk = '';
      for (let i = 0; i < word.length; i++) {
        const test = chunk + word[i];
        if (ctx.measureText(test).width > maxWidth && chunk.length > 0) {
          lines.push(chunk); chunk = word[i]; if (lines.length >= maxLines) break;
        } else { chunk = test; }
      }
      if (lines.length < maxLines && chunk) currentLine = chunk;
      continue;
    }
    const testLine = currentLine ? currentLine + ' ' + word : word;
    if (ctx.measureText(testLine).width > maxWidth) {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
      if (lines.length >= maxLines) break;
    } else { currentLine = testLine; }
  }
  if (lines.length < maxLines && currentLine) lines.push(currentLine);
  if (lines.length > maxLines) lines.length = maxLines;
  return lines.length ? lines : [''];
}

function _drawChatLog(ctx, sw, sh) {
  const _chatFont = _getChatFont();
  const _chatFs = _getChatFontSize();
  const logW = _chatBaseW * _chatScale;
  let inputH = 0;
  if (_chatTyping) {
    ctx.font = `${_chatFs}px ${_chatFont}`;
    const _inputMaxW = logW - 28;
    const _inputLines = _chatInput ? _wrapChatText(ctx, _chatInput, _inputMaxW) : [''];
    const _lineH2 = _chatFs + 4;
    inputH = (_lineH2 * Math.max(1, _inputLines.length)) + 12;
  }
  const tabH = 28;
  const lineH = _chatFs + 6;
  const maxVisible = 10;
  const chatBoxH = (_chatBaseH * _chatScale) + inputH;
  const logX = _chatPosX;
  const logY = _chatPosY !== null ? _chatPosY : ((sh - 8) - chatBoxH - tabH);

  // ── Tabs — Public / Team / DMs ──
  const channels = ['public', 'team', 'dms'];
  const channelLabels = { public: 'Public', team: 'Team', dms: 'DMs' };
  const tabW = logW / channels.length;
  const tabY = logY;
  _chatTabRects = {};
  channels.forEach((ch, i) => {
    _chatTabRects[ch] = { x: logX + i * tabW, y: tabY, w: tabW, h: tabH };
    const tx = logX + i * tabW;
    const active = _chatChannel === ch;
    ctx.fillStyle = active ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.25)';
    _roundRect(ctx, tx, tabY, tabW, tabH, 8);
    ctx.fill();
    if (active) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      _roundRect(ctx, tx, tabY, tabW, tabH, 8);
      ctx.stroke();
    }
    ctx.fillStyle = active ? '#ffffff' : 'rgba(255,255,255,0.4)';
    ctx.font = `bold 15px ${_chatFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(channelLabels[ch], tx + tabW / 2, tabY + tabH / 2);
  });

  // ── Chat body — below tabs ──
  const bodyY = tabY + tabH;
  const bodyH = chatBoxH - tabH;

  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  _roundRect(ctx, logX, bodyY, logW, bodyH, 0); // no top radius (tabs cover it)
  ctx.fill();
  // Bottom corners
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  _roundRect(ctx, logX, bodyY + bodyH - 10, logW, 10, 10);
  ctx.fill();
  // Border
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 2;
  ctx.strokeRect(logX, bodyY, logW, bodyH);

  // ── Messages — filtered by channel ──
  const filtered = _chatLog.filter(m => !m.channel || m.channel === _chatChannel || m.name === 'System');
  const visibleLog = filtered.slice(-maxVisible);
  const msgAreaH = bodyH - inputH - 8;

  ctx.save();
  ctx.beginPath();
  ctx.rect(logX, bodyY, logW, msgAreaH);
  ctx.clip();

  ctx.font = `${_chatFs}px ${_chatFont}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const maxTextW = logW - 24;

  // Pre-calculate all message lines with word wrapping
  const allMsgLines = [];
  visibleLog.forEach((msg, mi) => {
    const nameStr = msg.name + ': ';
    const nameW = ctx.measureText(nameStr).width;
    const firstMaxW = maxTextW - nameW;
    let remaining = msg.text;
    let isFirst = true;
    while (remaining.length > 0 && allMsgLines.length < 60) {
      const maxW = isFirst ? firstMaxW : maxTextW;
      let fitLen = remaining.length;
      while (fitLen > 1 && ctx.measureText(remaining.slice(0, fitLen)).width > maxW) fitLen--;
      allMsgLines.push({ text: remaining.slice(0, fitLen), isFirst, name: nameStr, msg, msgIdx: mi });
      remaining = remaining.slice(fitLen);
      isFirst = false;
    }
  });

  const totalH = allMsgLines.length * lineH;
  const startY = bodyY + msgAreaH - totalH;
  // Clear expired flash
  if (_chatCopyFlash >= 0 && Date.now() >= _chatCopyFlashTimer) _chatCopyFlash = -1;
  allMsgLines.forEach((line, i) => {
    const y = startY + i * lineH;
    if (y < bodyY - lineH || y > bodyY + msgAreaH) return;
    // Copy flash highlight
    if (_chatCopyFlash >= 0 && line.msgIdx === _chatCopyFlash) {
      ctx.fillStyle = 'rgba(50,120,220,0.2)';
      ctx.fillRect(logX + 4, y - 1, logW - 8, lineH);
    }
    if (line.isFirst) {
      ctx.fillStyle = line.msg.name === 'System' ? '#888' : (_cachedClr || '#5AAA72');
      ctx.fillText(line.name, logX + 10, y);
      const nw = ctx.measureText(line.name).width;
      ctx.fillStyle = '#dfe0e6';
      ctx.fillText(line.text, logX + 10 + nw, y);
    } else {
      ctx.fillStyle = '#dfe0e6';
      ctx.fillText(line.text, logX + 10, y);
    }
  });
  // Log selection highlight
  if (_logSelStartPos && _logSelEndPos &&
      (_logSelStartPos.lineIdx !== _logSelEndPos.lineIdx || _logSelStartPos.charIdx !== _logSelEndPos.charIdx)) {
    let sL = _logSelStartPos.lineIdx, sC = _logSelStartPos.charIdx;
    let eL = _logSelEndPos.lineIdx, eC = _logSelEndPos.charIdx;
    if (sL > eL || (sL === eL && sC > eC)) { [sL, eL] = [eL, sL]; [sC, eC] = [eC, sC]; }
    ctx.fillStyle = 'rgba(50,120,220,0.3)';
    for (let li = sL; li <= eL && li < allMsgLines.length; li++) {
      const y = startY + li * lineH;
      if (y < bodyY - lineH || y > bodyY + msgAreaH) continue;
      const ln = allMsgLines[li];
      let textX = logX + 10;
      if (ln.isFirst) textX += ctx.measureText(ln.name).width;
      const from = li === sL ? sC : 0;
      const to = li === eL ? eC : ln.text.length;
      const x1 = textX + ctx.measureText(ln.text.slice(0, from)).width;
      const x2 = textX + ctx.measureText(ln.text.slice(0, to)).width;
      ctx.fillRect(x1, y - 1, x2 - x1, lineH);
    }
  }
  _lastAllMsgLines = allMsgLines; _lastMsgStartY = startY; _lastMsgLineH = lineH; _lastMsgLogX = logX;
  ctx.restore();

  // ── Input field — only shown when typing ──
  if (_chatTyping) {
    const inputMaxW = logW - 28;
    ctx.font = `${_chatFs}px ${_chatFont}`;
    const lines = _chatInput ? _wrapChatText(ctx, _chatInput, inputMaxW) : [''];
    const numLines = Math.max(1, lines.length);
    const lineH2 = _chatFs + 4;
    const iH = (lineH2 * numLines) + 12;
    const iBottom = bodyY + bodyH - 4;
    const iY = iBottom - iH;

    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    _roundRect(ctx, logX + 6, iY, logW - 12, iH, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    _roundRect(ctx, logX + 6, iY, logW - 12, iH, 6);
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const textStartY = iY + 6 + lineH2 / 2; // center of first line
    if (!_chatInput) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText('Type a message...', logX + 14, textStartY);
    } else {
      // Select-all highlight (clipped to input box)
      if (_chatSelectAll) {
        ctx.save();
        ctx.beginPath(); ctx.rect(logX + 6, iY, logW - 12, iH); ctx.clip();
        ctx.fillStyle = 'rgba(50,120,220,0.3)';
        lines.forEach((ln, i) => {
          const w = ctx.measureText(ln).width;
          ctx.fillRect(logX + 13, iY + 5 + i * lineH2, w + 2, lineH2);
        });
        ctx.restore();
      }
      ctx.fillStyle = '#ffffff';
      lines.forEach((ln, i) => { ctx.fillText(ln, logX + 14, textStartY + i * lineH2); });
    }
    // Drag selection highlight (per-line, clipped to input box)
    if (_chatSelStart >= 0 && _chatSelEnd >= 0 && _chatSelStart !== _chatSelEnd) {
      ctx.save();
      ctx.beginPath(); ctx.rect(logX + 6, iY, logW - 12, iH); ctx.clip();
      const s = Math.min(_chatSelStart, _chatSelEnd), e2 = Math.max(_chatSelStart, _chatSelEnd);
      ctx.fillStyle = 'rgba(50,120,220,0.3)';
      let charOff = 0;
      for (let li = 0; li < lines.length; li++) {
        const lineLen = lines[li].length;
        const lineStart = charOff, lineEnd = charOff + lineLen;
        if (s < lineEnd && e2 > lineStart) {
          const selS = Math.max(0, s - lineStart);
          const selE = Math.min(lineLen, e2 - lineStart);
          const hx1 = logX + 14 + ctx.measureText(lines[li].slice(0, selS)).width;
          const hx2 = logX + 14 + ctx.measureText(lines[li].slice(0, selE)).width;
          ctx.fillRect(hx1, iY + 5 + li * lineH2, hx2 - hx1, lineH2);
        }
        charOff += lineLen;
      }
      ctx.restore();
    }
    // Cursor at _chatCursorIdx
    const cursorIdx = _chatCursorIdx < 0 ? _chatInput.length : Math.min(_chatCursorIdx, _chatInput.length);
    // Find which line the cursor is on
    let charsConsumed = 0, cursorLine = 0, cursorInLine = 0;
    for (let li = 0; li < lines.length; li++) {
      if (cursorIdx <= charsConsumed + lines[li].length) { cursorLine = li; cursorInLine = cursorIdx - charsConsumed; break; }
      charsConsumed += lines[li].length;
      cursorLine = li;
      cursorInLine = lines[li].length;
    }
    const cursorX = logX + 14 + ctx.measureText(lines[cursorLine]?.slice(0, cursorInLine) || '').width;
    const cursorY = iY + 6 + cursorLine * lineH2 + (lineH2 - _chatFs) / 2;
    _chatCursorScreenX = cursorX; _chatCursorScreenY = cursorY;
    if (Math.floor(Date.now() / 530) % 2 === 0) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cursorX, cursorY, 1.5, _chatFs);
    }
    // Store input box rect for click handling
    _chatInputRect = { x: logX + 6, y: iY, w: logW - 12, h: iH };
  }

  // Store layout for click handling
  _chatLayoutRect = { x: logX, y: logY, w: logW, h: chatBoxH + tabH };
}

let _chatTabRects = null;
let _chatLayoutRect = null;

// The old notes-app exit-confirm dialog ("Return to your last session?")
// lived here — replaced wholesale by the ESC pause menu (src/pausemenu.js).
// Its exitPlayMode() action survives as the menu's "Return to hub" button.

function _copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => _copyFallback(text));
  } else { _copyFallback(text); }
}
function _copyFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch(e) {}
  ta.remove();
}

function _hitTestChatLog(mx, my) {
  if (!_lastAllMsgLines.length) return null;
  const lineIdx = Math.floor((my - _lastMsgStartY) / _lastMsgLineH);
  if (lineIdx < 0 || lineIdx >= _lastAllMsgLines.length) return null;
  const line = _lastAllMsgLines[lineIdx];
  const canvas = _worldCanvas || document.getElementById('world-canvas');
  const ctx2 = canvas?.getContext('2d');
  if (!ctx2) return null;
  ctx2.font = `${_getChatFontSize()}px ${_getChatFont()}`;
  let textStartX = _lastMsgLogX + 10;
  if (line.isFirst) textStartX += ctx2.measureText(line.name).width;
  const relX = mx - textStartX;
  let charIdx = line.text.length;
  for (let i = 0; i <= line.text.length; i++) {
    const w = ctx2.measureText(line.text.slice(0, i)).width;
    if (w > relX) { const prevW = i > 0 ? ctx2.measureText(line.text.slice(0, i-1)).width : 0; charIdx = (relX - prevW < w - relX) ? Math.max(0, i-1) : i; break; }
  }
  return { lineIdx, charIdx };
}
function _getLogSelectedText() {
  if (!_logSelStartPos || !_logSelEndPos) return '';
  let sL = _logSelStartPos.lineIdx, sC = _logSelStartPos.charIdx;
  let eL = _logSelEndPos.lineIdx, eC = _logSelEndPos.charIdx;
  if (sL > eL || (sL === eL && sC > eC)) { [sL, eL] = [eL, sL]; [sC, eC] = [eC, sC]; }
  let result = '';
  for (let li = sL; li <= eL && li < _lastAllMsgLines.length; li++) {
    const text = _lastAllMsgLines[li].text;
    const from = li === sL ? sC : 0;
    const to = li === eL ? eC : text.length;
    result += text.slice(from, to);
  }
  return result;
}

function _handleChatClick(e) {
  // Prevent native selection in play mode (unless clicking a real input/button)
  if (_active && !e.target.closest('input, textarea, button, [contenteditable], .settings-switch')) {
    e.preventDefault();
  }
  if (!_active || !_chatOpen || isPauseMenuOpen()) return;
  const mx = e.clientX, my = e.clientY;

  // Tab clicks
  if (_chatTabRects) {
    for (const [ch, r] of Object.entries(_chatTabRects)) {
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
        e.preventDefault(); e.stopPropagation();
        _chatChannel = ch;
        return;
      }
    }
  }

  // Click inside input box → position cursor (multi-line aware)
  if (_chatTyping && _chatInputRect) {
    const ir = _chatInputRect;
    if (mx >= ir.x && mx <= ir.x + ir.w && my >= ir.y && my <= ir.y + ir.h) {
      e.preventDefault(); e.stopPropagation();
      const canvas = _worldCanvas || document.getElementById('world-canvas');
      const ctx2 = canvas?.getContext('2d');
      if (ctx2) {
        const fs = _getChatFontSize();
        ctx2.font = `${fs}px ${_getChatFont()}`;
        const inputMaxW = ir.w - 16;
        const lines = _chatInput ? _wrapChatText(ctx2, _chatInput, inputMaxW) : [''];
        const lineH2 = fs + 4;
        // Which line?
        let clickedLine = Math.floor((my - ir.y - 6) / lineH2);
        clickedLine = Math.max(0, Math.min(clickedLine, lines.length - 1));
        // Which character on that line?
        const relX = mx - (ir.x + 8);
        const line = lines[clickedLine];
        let charIdx = line.length;
        for (let i = 0; i <= line.length; i++) {
          const w = ctx2.measureText(line.slice(0, i)).width;
          if (w > relX) {
            const prevW = i > 0 ? ctx2.measureText(line.slice(0, i - 1)).width : 0;
            charIdx = (relX - prevW < w - relX) ? Math.max(0, i - 1) : i;
            break;
          }
        }
        // Convert to index into full string
        let totalIdx = 0;
        for (let l = 0; l < clickedLine; l++) totalIdx += lines[l].length;
        totalIdx += charIdx;
        _chatCursorIdx = totalIdx;
        _chatSelectAll = false;
        _chatSelStart = totalIdx; _chatSelEnd = totalIdx;
        _chatSelecting = true;
      }
      return;
    }
  }

  // Click on chat log → start text selection
  if (_chatOpen && _lastAllMsgLines.length) {
    const hit = _hitTestChatLog(mx, my);
    if (hit) {
      e.preventDefault(); e.stopPropagation();
      _logSelStartPos = { ...hit }; _logSelEndPos = { ...hit };
      _logSelecting = true; _logSelText = '';
      _chatSelStart = -1; _chatSelEnd = -1; _chatSelectAll = false;
      return;
    }
  }

  // Chat window drag — anywhere in the layout header area (tabs)
  if (_chatLayoutRect) {
    const r = _chatLayoutRect;
    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + 24) {
      e.preventDefault(); e.stopPropagation();
      _chatDragging = true;
      _chatDragOX = mx - _chatPosX;
      _chatDragOY = my - (_chatPosY !== null ? _chatPosY : (window.innerHeight - _chatBaseH * _chatScale - 24 - 12));
    }
  }
}

function _handleChatMouseMove(e) {
  // Text cursor when hovering over input box or chat log
  if (_active && _chatOpen) {
    let wantText = false;
    if (_chatTyping && _chatInputRect) {
      const ir = _chatInputRect;
      if (e.clientX >= ir.x && e.clientX <= ir.x + ir.w && e.clientY >= ir.y && e.clientY <= ir.y + ir.h) wantText = true;
    }
    if (!wantText && _lastAllMsgLines.length && _hitTestChatLog(e.clientX, e.clientY)) wantText = true;
    document.body.style.cursor = wantText ? 'text' : '';
  }
  // Log drag selection
  if (_logSelecting && _lastAllMsgLines.length) {
    const hit = _hitTestChatLog(e.clientX, e.clientY);
    if (hit) { _logSelEndPos = hit; _logSelText = _getLogSelectedText(); }
  }
  // Drag-to-select in input
  if (_chatSelecting && _chatInputRect) {
    const canvas = _worldCanvas || document.getElementById('world-canvas');
    const ctx2 = canvas?.getContext('2d');
    if (ctx2) {
      const fs = _getChatFontSize();
      ctx2.font = `${fs}px ${_getChatFont()}`;
      const ir = _chatInputRect;
      const inputMaxW = ir.w - 16;
      const lines = _chatInput ? _wrapChatText(ctx2, _chatInput, inputMaxW) : [''];
      const lineH2 = fs + 4;
      let clickedLine = Math.floor((e.clientY - ir.y - 6) / lineH2);
      clickedLine = Math.max(0, Math.min(clickedLine, lines.length - 1));
      const relX = e.clientX - (ir.x + 8);
      const line = lines[clickedLine];
      let charIdx = line.length;
      for (let i = 0; i <= line.length; i++) {
        const w = ctx2.measureText(line.slice(0, i)).width;
        if (w > relX) { const prevW = i > 0 ? ctx2.measureText(line.slice(0, i-1)).width : 0; charIdx = (relX - prevW < w - relX) ? Math.max(0, i-1) : i; break; }
      }
      let idx = 0;
      for (let l = 0; l < clickedLine; l++) idx += lines[l].length;
      idx += charIdx;
      _chatSelEnd = idx;
      _chatCursorIdx = idx;
    }
  }
  if (!_chatDragging) return;
  _chatPosX = e.clientX - _chatDragOX;
  _chatPosY = e.clientY - _chatDragOY;
  // Clamp
  _chatPosX = Math.max(0, Math.min(window.innerWidth - _chatBaseW * _chatScale, _chatPosX));
  _chatPosY = Math.max(0, Math.min(window.innerHeight - 100, _chatPosY));
}

function _handleChatMouseUp() {
  if (_logSelecting) { _logSelecting = false; }
  if (_chatSelecting) {
    _chatSelecting = false;
    if (_chatSelStart === _chatSelEnd) { _chatSelStart = -1; _chatSelEnd = -1; }
  }
  _chatDragging = false;
}

function _ensureChatInput() {
  if (_chatHiddenInput) return _chatHiddenInput;
  _chatHiddenInput = document.createElement('input');
  _chatHiddenInput.type = 'text';
  _chatHiddenInput.setAttribute('autocomplete', 'off');
  _chatHiddenInput.setAttribute('autocorrect', 'off');
  _chatHiddenInput.setAttribute('autocapitalize', 'off');
  _chatHiddenInput.setAttribute('spellcheck', 'false');
  _chatHiddenInput.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none;z-index:-1;border:none;outline:none;padding:0;margin:0;overflow:hidden;user-select:none;-webkit-user-select:none;caret-color:transparent;';
  document.body.appendChild(_chatHiddenInput);
  _chatHiddenInput.addEventListener('input', () => {
    if (!_chatTyping) return;
    const val = _chatHiddenInput.value;
    if (val) {
      const idx = _chatCursorIdx < 0 ? _chatInput.length : _chatCursorIdx;
      const avail = CHAT_MAX_CHARS - _chatInput.length;
      const ins = val.slice(0, avail);
      _chatInput = _chatInput.slice(0, idx) + ins + _chatInput.slice(idx);
      _chatCursorIdx = idx + ins.length;
    }
    _chatHiddenInput.value = '';
    _chatUndoSchedule();
  });
  return _chatHiddenInput;
}

function _checkChatEmoji() {
  const colonIdx = _chatInput.lastIndexOf(':');
  if (colonIdx === -1) { _closeChatEmoji(); return; }
  const query = _chatInput.slice(colonIdx + 1);
  if (!/^[a-zA-Z]{0,20}$/.test(query)) { _closeChatEmoji(); return; }
  _chatEmojiColonIdx = colonIdx;
  if (window._dexOpenChatEmoji) window._dexOpenChatEmoji(query, colonIdx);
}
window._dexExecuteChatCommand=function(type){
  // Remove >/ command text from chat input
  const idx=_chatInput.lastIndexOf('>/');
  if(idx>=0) _chatInput=_chatInput.slice(0,idx);
  _chatCursorIdx=_chatInput.length;
  if(type==='home'){exitPlayMode();return;}
  if(type==='respawn'){
    if(_flagPlanted){_charWorldX=_flagWX;_charWorldY=_flagWY+20;}
    _chatLog.push({name:'System',text:'Respawned!',time:Date.now()});
    return;
  }
  if(type==='play'){
    _chatLog.push({name:'System',text:'Already in play mode.',time:Date.now()});
    return;
  }
};
function _checkChatCommand() {
  const idx=_chatInput.lastIndexOf('>/');
  if(idx===-1){_closeChatCommand();return;}
  const query=_chatInput.slice(idx+2);
  if(!/^[a-zA-Z]{0,10}$/.test(query)){_closeChatCommand();return;}
  if(window._dexOpenChatCommandPicker) window._dexOpenChatCommandPicker(query);
}
function _closeChatCommand() {
  if(window._dexCloseChatCommandPicker) window._dexCloseChatCommandPicker();
}
function _closeChatEmoji() {
  _chatEmojiColonIdx = -1;
  if (window._dexCloseChatEmoji) window._dexCloseChatEmoji();
}
window._dexCloseChatForGrid = function() {
  _chatOpen = false;
  _chatTyping = false;
  _chatInput = '';
  clearTimeout(_chatHideTimer);
};
window._dexInsertChatEmoji = function(emoji) {
  if (_chatEmojiColonIdx >= 0) {
    _chatInput = _chatInput.slice(0, _chatEmojiColonIdx) + emoji;
    _chatEmojiColonIdx = -1;
  } else {
    _chatInput += emoji;
  }
  if (window._dexBumpEmojiFreq) window._dexBumpEmojiFreq(emoji);
  if (window._dexCloseChatEmoji) window._dexCloseChatEmoji();
};

function _handleChatKey(e) {
  if (!_active) return;

  // ── Escape: close the topmost thing first, then the pause menu ──
  if (e.key === 'Escape') {
    // Exit fullscreen first — top priority. Two cases:
    //   1. JS Fullscreen API (requestFullscreen) — document.fullscreenElement is set.
    //   2. Browser F11 fullscreen — fullscreenElement is null, but the window
    //      fills the entire screen. Detect by comparing inner dims to screen dims.
    // MD#5: in either case, swallow this Escape — the browser will exit F11
    // on its own; we just need to not pop the exit-confirm dialog over it.
    if (document.fullscreenElement) {
      document.exitFullscreen();
      e.preventDefault(); e.stopPropagation();
      return;
    }
    // F11 detection: window inner dims should match screen dims (within a
    // small tolerance for OS scrollbar / DPI rounding). innerHeight is the
    // most reliable axis since browser chrome eats vertical space when not
    // fullscreen. 4px tolerance handles fractional DPI.
    const _screenH = (window.screen && window.screen.height) || 0;
    const _isF11 = _screenH > 0 && window.innerHeight >= _screenH - 4;
    if (_isF11) {
      // MD#13: do NOT preventDefault/stopPropagation here. The browser's
      // keyboard shortcut layer needs to receive this ESC keydown to exit
      // F11 fullscreen. Calling preventDefault would kill the browser's
      // exit-fullscreen behavior — that was the MD#5 bug. Just return so
      // our own pause menu doesn't open. F11 exits cleanly, second ESC
      // (now out of F11) hits the normal pause-menu path below.
      return;
    }
    // Cosmetics panel takes Escape next — character.js's bubble handler
    // closes it (this handler runs at capture, so return untouched to let
    // that one receive the event).
    if (_charModule && _charModule.isCosmeticsPanelOpen && _charModule.isCosmeticsPanelOpen()) return;
    // Inventory closes before anything opens — inv2 is the live panel, the
    // legacy #inventory-grid check is kept for safe rollback.
    const inv2 = document.getElementById('inv2');
    if (inv2 && inv2.classList.contains('is-open')) {
      if (_charModule && _charModule.toggleInventory) _charModule.toggleInventory();
      e.preventDefault(); e.stopPropagation();
      return;
    }
    const inv = document.getElementById('inventory-grid');
    if (inv && inv.style.display === 'grid') {
      inv.style.display = 'none';
      e.preventDefault();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (_chatTyping) {
      _chatTyping = false;
      _chatInput = '';
      _closeChatEmoji();
      if (_chatHiddenInput) _chatHiddenInput.blur();
      document.body.style.cursor = '';
      _resetChatHideTimer();
      return;
    }
    if (isPauseMenuOpen()) {
      closePauseMenu();
      return;
    }
    // First: close chat window if open
    if (_chatOpen) {
      _chatOpen = false;
      clearTimeout(_chatHideTimer);
      return;
    }
    // Nothing else open — the pause menu replaces the old exit-confirm here.
    openPauseMenu();
    return;
  }

  // While the menu is open its own capture handler swallows game keys; this
  // guard is the second line of defense for anything bound below (chat
  // toggle, camera lock).
  if (isPauseMenuOpen()) return;

  // ── Camera lock toggle key ──
  if (!_chatTyping) {
    const lockKey = (_keybinds['lock-camera'] || 'Y').toUpperCase();
    if (e.key.toUpperCase() === lockKey) {
      e.preventDefault(); e.stopPropagation();
      _playCameraMode = _playCameraMode === 'follow' ? 'deadzone' : 'follow';
      _cameraSmoothT = 0; // reset smooth ramp for gentle transition
      try { safeStorage.setItem('dexnote-play-camera', _playCameraMode); } catch(e2) {}
      _showCameraToast(_playCameraMode);
      return;
    }
  }

  // ── Picker keys, while typing ──
  // These must run BEFORE the Enter handler below: Enter returns
  // unconditionally, so with the picker checks left further down (where they
  // originally sat) Enter and Tab never reached them and selecting a command
  // or emoji with the keyboard silently sent the message instead.
  if (_chatTyping) {
    const _cmdOpen = document.getElementById('ic-cmd-pick')?.classList.contains('open');
    if (_cmdOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        window._dexHandleCmdPickerNav?.(e);
        e.preventDefault(); e.stopPropagation(); return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const item = window._dexGetActiveCmdItem?.();
        if (item) { window._dexCloseChatCommandPicker?.(); window._dexExecuteChatCommand?.(item); }
        e.preventDefault(); e.stopPropagation(); return;
      }
      if (e.key === 'Escape') {
        window._dexCloseChatCommandPicker?.();
        e.preventDefault(); e.stopPropagation(); return;
      }
    }
    const _emojiOpen = document.getElementById('emoji-pick')?.classList.contains('open');
    if (_emojiOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        window._dexHandleEmojiNav?.(e);
        e.preventDefault(); e.stopPropagation(); return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        window._dexSelectActiveEmoji?.();
        e.preventDefault(); e.stopPropagation(); return;
      }
      if (e.key === 'Escape') {
        _closeChatEmoji();
        e.preventDefault(); e.stopPropagation(); return;
      }
    }
  }

  // ── T: open chat (alongside Enter) ──
  if (!_chatTyping && (e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    e.stopPropagation();
    _chatOpen = true;
    _chatTyping = true;
    _chatCursorIdx = -1;
    _chatSelStart = -1; _chatSelEnd = -1; _chatSelectAll = false;
    _logSelStartPos = null; _logSelEndPos = null; _logSelText = '';
    _resetChatHideTimer();
    if (window._dexClearKeys) window._dexClearKeys();
    _ensureChatInput().value = '';
    _ensureChatInput().focus();
    return;
  }

  // ── Enter: toggle typing mode / send message ──
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    if (!_chatTyping) {
      // Enter typing mode — open chat log + start typing
      _chatOpen = true;
      _chatTyping = true;
      _chatCursorIdx = -1;
      _chatSelStart = -1; _chatSelEnd = -1; _chatSelectAll = false;
      _logSelStartPos = null; _logSelEndPos = null; _logSelText = '';
      _resetChatHideTimer();
      if (window._dexClearKeys) window._dexClearKeys();
      _ensureChatInput().value = '';
      _ensureChatInput().focus();
      return;
    }
    // Send message and exit typing mode
    if (_chatInput.trim()) {
      const text = _chatInput.trim().slice(0, CHAT_MAX_CHARS);
      if (text.startsWith('/') || text.startsWith('>/')) {
        _handleChatCommand(text);
      } else {
        const username = 'You';
        sfx('ui.chat');
        _chatLog.push({ name: username, text, time: Date.now(), channel: _chatChannel });
        if (_chatLog.length > 50) _chatLog.shift();
        _chatBubbleText = text;
        _chatBubbleExpiry = Date.now() + CHAT_BUBBLE_DURATION;
      }
    }
    _chatInput = '';
    _chatTyping = false;
    _closeChatEmoji();
    if (_chatHiddenInput) _chatHiddenInput.blur();
    document.body.style.cursor = '';
    _resetChatHideTimer();
    return;
  }

  // Ctrl+C for log selection when not typing
  if (!_chatTyping && (e.ctrlKey || e.metaKey) && e.key === 'c' && _logSelText) {
    e.preventDefault(); _copyToClipboard(_logSelText); return;
  }
  // ── Only process typing keys when in typing mode ──
  if (!_chatTyping) return;
  if (_chatHiddenInput && document.activeElement !== _chatHiddenInput) _chatHiddenInput.focus();

  e.stopPropagation();

  // (Picker navigation moved above the Enter handler — see the top of this
  // function. Left here it was unreachable.)

  // Helper: delete selected text (select-all or drag selection)
  function _deleteSelection() {
    if (_chatSelectAll) {
      _chatInput = ''; _chatCursorIdx = 0; _chatSelectAll = false;
      _chatSelStart = -1; _chatSelEnd = -1; return true;
    }
    if (_chatSelStart >= 0 && _chatSelEnd >= 0 && _chatSelStart !== _chatSelEnd) {
      const s = Math.min(_chatSelStart, _chatSelEnd), e2 = Math.max(_chatSelStart, _chatSelEnd);
      _chatInput = _chatInput.slice(0, s) + _chatInput.slice(e2);
      _chatCursorIdx = s; _chatSelStart = -1; _chatSelEnd = -1; _chatSelectAll = false; return true;
    }
    return false;
  }
  function _getSelectedText() {
    if (_chatSelectAll) return _chatInput;
    if (_chatSelStart >= 0 && _chatSelEnd >= 0 && _chatSelStart !== _chatSelEnd) {
      const s = Math.min(_chatSelStart, _chatSelEnd), e2 = Math.max(_chatSelStart, _chatSelEnd);
      return _chatInput.slice(s, e2);
    }
    return '';
  }

  // Arrow keys: move cursor (skip if emoji picker open)
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    const idx = _chatCursorIdx < 0 ? _chatInput.length : _chatCursorIdx;
    _chatCursorIdx = Math.max(0, idx - 1);
    _chatSelectAll = false; _chatSelStart = -1; _chatSelEnd = -1; return;
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    const idx = _chatCursorIdx < 0 ? _chatInput.length : _chatCursorIdx;
    _chatCursorIdx = Math.min(_chatInput.length, idx + 1);
    _chatSelectAll = false; _chatSelStart = -1; _chatSelEnd = -1; return;
  }

  if (e.key === 'Backspace') {
    e.preventDefault();
    if (_deleteSelection()) { _checkChatEmoji(); return; }
    const idx = _chatCursorIdx < 0 ? _chatInput.length : _chatCursorIdx;
    if (idx > 0) {
      _chatInput = _chatInput.slice(0, idx - 1) + _chatInput.slice(idx);
      _chatCursorIdx = idx - 1;
    }
    _checkChatEmoji();_checkChatCommand(); return;
  }
  if (e.key === 'Delete') {
    e.preventDefault();
    if (_deleteSelection()) return;
    const idx = _chatCursorIdx < 0 ? _chatInput.length : _chatCursorIdx;
    if (idx < _chatInput.length) {
      _chatInput = _chatInput.slice(0, idx) + _chatInput.slice(idx + 1);
    }
    return;
  }

  // Ctrl+Z: undo
  if ((e.ctrlKey||e.metaKey)&&e.key==='z'&&!e.shiftKey) { e.preventDefault();_chatUndo();return; }
  // Ctrl+Y / Ctrl+Shift+Z: redo
  if ((e.ctrlKey||e.metaKey)&&(e.key==='y'||(e.key==='z'&&e.shiftKey)||e.key==='Z')) { e.preventDefault();_chatRedo();return; }
  // Ctrl+A: select all
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
    e.preventDefault(); _chatSelectAll = true; _chatSelStart = -1; _chatSelEnd = -1; return;
  }
  // Ctrl+C: copy
  if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
    e.preventDefault();
    const sel = _getSelectedText() || _logSelText || _chatInput;
    if (sel) _copyToClipboard(sel); return;
  }
  // Ctrl+X: cut
  if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
    e.preventDefault();
    const sel = _getSelectedText() || _chatInput;
    if (sel) { _copyToClipboard(sel); _deleteSelection() || (_chatInput = '', _chatCursorIdx = 0); }
    return;
  }
  // Ctrl+V: paste — let browser paste into hidden input natively
  if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
    _deleteSelection();
    _ensureChatInput().focus();
    return; // don't preventDefault — browser handles paste into hidden input
  }
  // Home/End
  if (e.key === 'Home') { e.preventDefault(); _chatCursorIdx = 0; _chatSelectAll = false; _chatSelStart = -1; _chatSelEnd = -1; return; }
  if (e.key === 'End') { e.preventDefault(); _chatCursorIdx = _chatInput.length; _chatSelectAll = false; _chatSelStart = -1; _chatSelEnd = -1; return; }

  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    _deleteSelection();
    if (_chatInput.length < CHAT_MAX_CHARS) {
      const idx = _chatCursorIdx < 0 ? _chatInput.length : _chatCursorIdx;
      _chatInput = _chatInput.slice(0, idx) + e.key + _chatInput.slice(idx);
      _chatCursorIdx = idx + 1;
    }
    _checkChatEmoji();_checkChatCommand();
  }
}

function _handleChatCommand(text) {
  let cmd = text;
  if (cmd.startsWith('>/')) cmd = cmd.slice(2);
  else if (cmd.startsWith('/')) cmd = cmd.slice(1);
  cmd = cmd.trim().toLowerCase();

  if (cmd === 'home') {
    _chatInput = '';
    _chatTyping = false;
    if (_chatHiddenInput) _chatHiddenInput.blur();
    exitPlayMode();
    return;
  }
  if (cmd === 'respawn') {
    _chatInput = '';
    _chatTyping = false;
    if (_chatHiddenInput) _chatHiddenInput.blur();
    const home = _getHomeObj();
    if (_flagPlanted) { _charWorldX = _flagWX; _charWorldY = _flagWY + 20; }
    else if (home) { _charWorldX = home.x; _charWorldY = home.y + 30; }
    _chatLog.push({ name: 'System', text: 'Respawned!', time: Date.now() });
    return;
  }
  if (cmd === 'play') {
    _chatLog.push({ name: 'System', text: 'Already in play mode.', time: Date.now() });
    return;
  }
  _chatLog.push({ name: 'System', text: `Unknown command: ${text}`, time: Date.now() });
}

// Export for key interception
export function isChatOpen() { return _chatTyping || _playModeDropping; }
export function getHomeScreenBounds() {
  if (!_active) return null;
  const homeObj = _getHomeObj();
  if (!homeObj) return null;
  const { sx, sy } = worldToScreen(homeObj.x, homeObj.y);
  return { left: sx - 32, right: sx + 32, top: sy - 48, bottom: sy };
}

// ── Building polygon outlines for projectile collision ──
function _getHomePoly(sx, sy) {
  return [
    [sx-32, sy, sx-32, sy-48],
    [sx-40, sy-48, sx, sy-78],
    [sx, sy-78, sx+40, sy-48],
    [sx+32, sy-48, sx+32, sy],
    [sx-32, sy, sx+32, sy],
    [sx+14, sy-48, sx+14, sy-74],
    [sx+14, sy-74, sx+23, sy-74],
    [sx+23, sy-74, sx+23, sy-48],
  ];
}
function _getCastlePoly(sx, sy) {
  const w=90, h=70, tw=18, th=h+14;
  return [
    [sx-w/2, sy, sx-w/2, sy-th],
    [sx-w/2, sy-th, sx-w/2+tw, sy-th],
    [sx-w/2+tw, sy-th, sx-w/2+tw, sy-h],
    [sx-w/2+tw, sy-h, sx+w/2-tw, sy-h],
    [sx+w/2-tw, sy-h, sx+w/2-tw, sy-th],
    [sx+w/2-tw, sy-th, sx+w/2, sy-th],
    [sx+w/2, sy-th, sx+w/2, sy],
    [sx-w/2, sy, sx+w/2, sy],
  ];
}
function _getShopPoly(sx, sy) {
  const w=70, h=50;
  return [
    [sx-w/2+4, sy, sx-w/2+4, sy-h+4],
    [sx-w/2-6, sy-h+4, sx+w/2+6, sy-h+4],
    [sx+w/2-4, sy-h+4, sx+w/2-4, sy],
    [sx-w/2+4, sy, sx+w/2-4, sy],
  ];
}
function _getJailPoly(sx, sy) {
  const w=56, h=44;
  return [
    [sx-w/2, sy, sx-w/2, sy-h],
    [sx-w/2-4, sy-h, sx+w/2+4, sy-h],
    [sx+w/2, sy-h, sx+w/2, sy],
    [sx-w/2, sy, sx+w/2, sy],
  ];
}
function _getTreehousePoly(sx, sy) {
  const w=60,h=50;
  return [
    [sx-w/2,sy,sx-w/2,sy-h],
    [sx-w/2,sy-h,sx+w/2,sy-h],
    [sx+w/2,sy-h,sx+w/2,sy],
    [sx-w/2,sy,sx+w/2,sy],
  ];
}
export function getBuildingPolygons() {
  if (!_active) return [];
  const polys = [];
  _worldObjects.forEach(obj => {
    if (obj.type !== 'home' && obj.type !== 'castle' && obj.type !== 'shop' && obj.type !== 'jail' && obj.type !== 'treehouse') return;
    const { sx, sy } = worldToScreen(obj.x, obj.y);
    let segs;
    if (obj.type === 'home') segs = _getHomePoly(sx, sy);
    else if (obj.type === 'castle') segs = _getCastlePoly(sx, sy);
    else if (obj.type === 'shop') segs = _getShopPoly(sx, sy);
    else if (obj.type === 'jail') segs = _getJailPoly(sx, sy);
    else if (obj.type === 'treehouse') segs = _getTreehousePoly(sx, sy);
    if (segs) polys.push({ type: obj.type, segments: segs });
  });
  return polys;
}
// Name kept for the character.js bridge (_isExitConfirmFn gates firing);
// the pause menu is what "exit confirm open" means now.
export function isExitConfirmOpen() { return isPauseMenuOpen(); }
export function addWorldExplosion(wx, wy, isRocket) {
  // Positional: a rocket across the map is a distant thump, not a blast.
  sfx('explosion', { big: !!isRocket, at: { x: wx, y: wy } });
  // Shake falls off with distance the same way the sound does.
  const dist = Math.hypot(wx - _charWorldX, wy - _charWorldY);
  const falloff = dist <= 320 ? 1 : Math.max(0, 1 - (dist - 320) / 1200);
  if (falloff > 0) _addShake((isRocket ? 7 : 2.5) * falloff);
  if (isRocket) _pSpawnRocketExplosion(wx, wy);
  else _pSpawnExplosion(wx, wy);
}

// Window bridge for rocket trail particles from character.js
window._dexAddTrailParticle = function(wx, wy) {
  if (!_active) return;
  const clrHex = (_cachedClr||'#7B8A9C').replace('#','');
  const r=parseInt(clrHex.slice(0,2),16), g=parseInt(clrHex.slice(2,4),16), b=parseInt(clrHex.slice(4,6),16);
  _pAddParticle(wx, wy, (Math.random()-0.5)*0.15, 0.05+Math.random()*0.1,
    14+Math.floor(Math.random()*8), r, g, b, 1+Math.random()*1.5, 'spark');
};

// ═══════════════════════════════════
//  WORLD PERSISTENCE
// ═══════════════════════════════════
//  Was a Firestore doc (worlds/default). That doc only ever held
//  generateWorld()'s deterministic output plus the migrations below — there
//  was no world editor — so localStorage is a faithful replacement.

function _loadOrGenerateWorld() {
  _worldLoaded = true;

  // loadWorld() seeds from generateWorld() on first run, regenerates when
  // the saved payload's version stamp doesn't match WORLD_GEN_VERSION, and
  // rejects a stale save (no grass / no castle) the same way the Firestore
  // path did. The piecemeal migrations that used to live here (add tank,
  // add jail, re-align building rows...) are retired: they only ever
  // reconstructed missing pieces of the deterministic generator output,
  // which the version gate now handles wholesale.
  _worldObjects = loadWorld(generateWorld, WORLD_GEN_VERSION);
  _rebuildWorldIndex();
}

// ═══════════════════════════════════
//  ENTER / EXIT
// ═══════════════════════════════════

let _charModule = null;

export async function enterPlayMode() {
  if (_active || _entering || _exiting) return;
  _entering = true;
  window._dexPlayModeActive = true;
  // MD#8: refresh the sessions-popup play button so it shows the pause
  // icon right away (no-op if popup isn't open).
  if (typeof window._dexRefreshPlayPopupRow === 'function') window._dexRefreshPlayPopupRow();
  if (window._dexUnlockAch) window._dexUnlockAch('enter_play_mode');
  // Load Photon SDK and connect. The original derived the room from the
  // active notes session so players in different sessions stayed isolated;
  // standalone there is one shared room. Gated on MULTIPLAYER — with the flag
  // off nothing here runs and no network request is made.
  if (MULTIPLAYER) {
    try {
      await _ensurePhoton();
      const roomName = ROOM_ID.slice(0, 20);  // Photon room names have length limits
      console.log('[mp] Photon room:', roomName);
      initPhoton({
        roomName,
        onConnected: (myId) => {
          console.log('[mp] ✅ Photon connected — actor:', myId, '| room:', roomName);
        },
        onPlayerUpdate: _handlePhotonPlayerUpdate,
        onPlayerLeave: _handlePhotonPlayerLeave,
        onPlayerDamage: _handlePhotonDamage,
        onTankUpdate: (id, inTank, tankX, tankY, tankAngle) => {
          const p = _remotePlayersMap.get(id);
          if (p) { p.inTank = inTank; p.tankX = tankX; p.tankY = tankY; p.tankAngle = tankAngle; }
        },
        onProjectileFired: (id, x, y, vx, vy, type) => { _spawnRemoteProjectile(x, y, vx, vy, type); },
      });
    } catch (e) {
      console.warn('[play] Photon init failed:', e.message);
      // Keep HUD hidden on failure for solo — _updatePlayerCount only surfaces
      // the HUD when other players are present, so there's nothing to show here.
    }
  }
  // HUD stays hidden on enter; setPhotonStatus in photon-client.js reveals it
  // only when others are in the room.
  _chatOpen = false;
  _chatTyping = false;

  // Reset player HP
  _playerHP = PLAYER_MAX_HP;
  _playerDead = false; _playerDeadTimer = 0;
  _playerStunTimer = 0; _playerDamageFlash = 0; _playerHPBarTimer = 0;
  // Sync HUD after a short delay (HUD element may not be visible yet during enter transition)
  setTimeout(_syncHudHealthBar, 600);
  _playerKnockVX = 0; _playerKnockVY = 0;


  // Read camera mode + keybind preferences
  try { _playCameraMode = safeStorage.getItem('dexnote-play-camera') || 'follow'; } catch(e) { _playCameraMode = 'follow'; }
  try { const sk = JSON.parse(safeStorage.getItem('dexnote-keybinds') || '{}'); if (sk['lock-camera']) _keybinds['lock-camera'] = sk['lock-camera'].toUpperCase(); } catch(e) {}

  if (!_charModule) _charModule = await import('./character.js');
  if(window._dexUnequipAll)window._dexUnequipAll();

  // Clean up session-mode blood/effects and creatures from the canvas
  document.querySelectorAll('.dex-blood, .impact-ring').forEach(el => el.remove());
  if (_charModule && _charModule.resetCreatures) _charModule.resetCreatures();

  // Floating button stack (bottom-left). The notes app's sessions button used
  // to live here too; only the chat toggle remains.
  let btnStack = document.getElementById('play-btn-stack');
  if (!btnStack) {
    btnStack = document.createElement('div');
    btnStack.id = 'play-btn-stack';
    btnStack.style.cssText = 'position:fixed;bottom:8px;left:4px;z-index:9100;display:flex;flex-direction:column;gap:6px;align-items:center;transform:translateY(120%);opacity:0;transition:transform 0.4s cubic-bezier(0.16,1,0.3,1),opacity 0.3s ease;';
    document.body.appendChild(btnStack);
  }
  // Chat toggle button
  let chatBtn = document.getElementById('play-chat-btn');
  if (!chatBtn) {
    chatBtn = document.createElement('button');
    chatBtn.id = 'play-chat-btn';
    chatBtn.dataset.tip = 'Chat';
    chatBtn.style.cssText = 'width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:var(--bg);border:2px solid var(--accent);color:var(--accent);cursor:pointer;padding:0;box-sizing:border-box;transition:opacity .15s ease;outline:none;';
    chatBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    chatBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _chatOpen = !_chatOpen;
      if (_chatOpen) _resetChatHideTimer();
    });
    btnStack.appendChild(chatBtn);
  }

  // Push history state so browser back button exits play mode
  history.pushState({ dexPlayMode: true }, '', '');

  // Ensure avatar is visible in play mode (override sessions-mode toggle)
  document.body.classList.remove('avatar-disabled');
  const _charOverlay = document.querySelector('.char-local');
  if (_charOverlay) _charOverlay.style.display = '';

  // Reset zoom to default (fully zoomed out)
  _zoom = _ZOOM_MIN;
  _zoomTarget = _ZOOM_MIN;

  // Disable page scroll, enable zoom via wheel
  document.body.classList.add('playroom-active');
  document.addEventListener('wheel', _preventScroll, { passive: false });
  document.addEventListener('touchmove', _preventScroll, { passive: false });

  // Prepare game HUD — visible but positioned below screen
  const gameHud = document.getElementById('game-hud');
  if (gameHud) {
    gameHud.style.display = 'flex';
    gameHud.classList.remove('hud-visible', 'hud-exiting');
    gameHud.classList.add('hud-entering');
  }
  document.querySelectorAll('.item-slot').forEach(s => { s.classList.remove('active', 'holstered'); });
  document.querySelector('.item-slot[data-slot="1"]')?.classList.add('active');
  if (_charModule) { _charModule.unholsterBow(); _charModule.renderAllHotbarSlots(); }
  // Wire slot 5 inventory click
  const slot5 = document.querySelector('.item-slot[data-slot="5"]');
  if (slot5 && !slot5._invWired) {
    slot5._invWired = true;
    slot5.addEventListener('click', () => {
      if (_charModule) _charModule.toggleInventory();
    });
  }
  // MD#9: clicking weapon slots 1–4 also opens/closes the inventory (acts
  // like slot 5). Number keys (Digit1–4) still switch weapons; drag still
  // reorders — a real drag suppresses its trailing synthetic click, so this
  // click handler only fires on genuine taps. Guard `_invWired` so re-entry
  // into play mode doesn't stack duplicate listeners.
  for (let s = 1; s <= 4; s++) {
    const slotEl = document.querySelector(`.item-slot[data-slot="${s}"]`);
    if (slotEl && !slotEl._invWired) {
      slotEl._invWired = true;
      slotEl.addEventListener('click', () => {
        if (_charModule) _charModule.toggleInventory();
      });
    }
  }

  // Trigger character jump-out animation synced with canvas slide
  if (_charModule && _charModule.triggerJumpOut) {
    _charModule.triggerJumpOut();
  }

  // Slide canvas up
  const canvas = document.getElementById('canvas');
  if (canvas) {
    canvas.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
    canvas.style.transform = 'translateY(-100vh)';
  }

  // Hide extra UI + gun pickups + prompts
  document.querySelectorAll('.gun-pickup, .gun-prompt').forEach(el => el.classList.add('play-mode-hidden'));

  // Show play mode UI
  const pmUI = document.getElementById('play-mode-ui');
  if (pmUI) pmUI.classList.add('visible');

  // After transition
  setTimeout(async () => {
    if (canvas) canvas.style.display = 'none';

    _worldCanvas = document.getElementById('world-canvas');
    if (_worldCanvas) {
      _worldCanvas.width = window.innerWidth;
      _worldCanvas.height = window.innerHeight;
      _worldCanvas.style.display = 'block';
      _worldCtx = _worldCanvas.getContext('2d');
    }
    _worldFrontCanvas = document.getElementById('world-front-canvas');
    if (_worldFrontCanvas) {
      _worldFrontCanvas.width = window.innerWidth;
      _worldFrontCanvas.height = window.innerHeight;
      _worldFrontCanvas.style.display = 'block';
      _worldFrontCtx = _worldFrontCanvas.getContext('2d');
    }

    // Load or generate world
    if (!_worldLoaded) await _loadOrGenerateWorld();
    if (_liveCreatures.length === 0) _spawnLiveCreatures();

    // Set world position — flag spawn or world center
    if (_flagPlanted) {
      _charWorldX = _flagWX; _charWorldY = _flagWY;
    } else {
      _charWorldX = WORLD_W / 2; _charWorldY = WORLD_H / 2;
    }
    _camera.x = _charWorldX; _cameraTarget.x = _charWorldX;
    _camera.y = _charWorldY; _cameraTarget.y = _charWorldY;

    // Slide HUD up from bottom, synced with avatar drop-in
    const gameHud2 = document.getElementById('game-hud');
    if (gameHud2) {
      requestAnimationFrame(() => { requestAnimationFrame(() => {
        gameHud2.classList.remove('hud-entering');
        gameHud2.classList.add('hud-visible');
      }); });
    }
    const btnStack2 = document.getElementById('play-btn-stack');
    if (btnStack2) {
      requestAnimationFrame(() => { requestAnimationFrame(() => {
        btnStack2.style.transform = 'translateY(0)';
        btnStack2.style.opacity = '1';
      }); });
    }

    // Now activate play mode — character switches to play-mode physics
    _active = true;
    _entering = false;
    window._dexResetAvatarExiting?.();

    // Ensure nothing is equipped after all initialization
    if (window._dexUnequipAll) window._dexUnequipAll();

    // Start drop-in — character enters from above
    _playModeDropping = true;
    _playModeDropY = -window.innerHeight * 0.5;
    _playModeDropTargetY = 0;
    _playModeDropVel = 0;
    _playModeDropFrames = 0;
    // Cancel any pending triggerJumpOut deferred cleanup
    if (_charModule && _charModule.cancelJumpOut) _charModule.cancelJumpOut();
    // Character will be positioned off-screen by _playModeDropY offset — make visible immediately
    const charEl = document.querySelector('.char-local');
    if (charEl) {
      charEl.style.transition = 'none';
      charEl.style.transform = '';
      charEl.style.transformOrigin = '';
      // MD#CHAR-TRANSITION-FLASH: keep hidden for one paint cycle so the
      // play-mode drop math (_playModeDropping/_playModeDropY) repositions
      // the character off-screen BEFORE it becomes visible. Without this
      // defer, the character flashes at the bottom of the page (its old
      // DOM y) for one frame between opacity:1 and the first world tick.
      charEl.style.opacity = '0';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (charEl) charEl.style.opacity = '1';
        });
      });
    }

  }, 520);

  // Chat key handler — must be added with capture to intercept before character input
  document.addEventListener('keydown', _handleChatKey, true);
  // Click handler for exit confirm buttons + click-outside-to-dismiss
  // Chat UI click handler (tabs, session btn, drag)
  document.addEventListener('mousedown', _handleChatClick, true);
  document.addEventListener('mousemove', _handleChatMouseMove);
  document.addEventListener('mouseup', _handleChatMouseUp);
  document.addEventListener('dblclick', _handleChatDblClick);
}

function _handleChatDblClick() {
  if (_active && _chatTyping && _chatInput) _chatSelectAll = true;
}

// Called from character.js when E is pressed/released in play mode
export function tryHomeInteract(pressed) {
  if (!_active) { _homeEHeld = false; _homeEHoldT = 0; _tankEHeld = false; _tankEHoldT = 0; return false; }

  // Block E during death screen
  if (_deathScreenVisible) return true;

  // E tap while in tank → exit (must release E first after entering)
  if (_inTank) {
    if (!pressed) { _tankExitLock = false; return true; } // E released — unlock exit
    if (pressed && !_tankExitLock) { _exitTank(); return true; } // E pressed after release — exit
    return true; // E still held from entry — block
  }

  // Flag pickup (hold E near flag)
  if (_flagPromptVisible) {
    return _tryFlagPickup(pressed);
  }

  // Tank entry (hold E near tank)
  if (_tankPromptVisible && !_inTank) {
    _tankEHeld = !!pressed;
    if (!pressed) _tankEHoldT = 0;
    return true;
  }

  // Home interaction
  if (_homePromptVisible) {
    _homeEHeld = !!pressed;
    if (!pressed) _homeEHoldT = 0;
    return true;
  }

  _homeEHeld = false; _homeEHoldT = 0;
  _tankEHeld = false; _tankEHoldT = 0;
  return false;
}

// Tick the hold-to-activate in the main render loop
function _tickHomeHold() {
  if (!_homeEHeld || !_homePromptVisible) { _homeEHoldT = 0; return; }
  _homeEHoldT += _dt;
  // MD 07b: the mode transition is silent by request — the progress ring
  // carries the feedback. (The tank's E-hold keeps its tone; that's an
  // in-world interaction, not a mode change.)
  if (_homeEHoldT >= HOME_E_HOLD_FRAMES) {
    _homeEHeld = false;
    _homeEHoldT = 0;
    exitPlayMode();
  }
}

// ── Tank entry/exit/tick ──
function _tickTankHold() {
  if (!_tankEHeld || !_tankPromptVisible) { _tankEHoldT = 0; return; }
  _tankEHoldT += _dt;
  // Same rising hold as the home ring; _enterTank's clunk is the resolution.
  sfxHold('hold', { t: _tankEHoldT / TANK_E_HOLD_FRAMES });
  if (_tankEHoldT >= TANK_E_HOLD_FRAMES) {
    _tankEHeld = false; _tankEHoldT = 0;
    _enterTank();
  }
}

let _tankExitLock = false; // prevents immediate exit after entry (E key still held)

function _enterTank() {
  const tank = _getTankObj();
  if (!tank) return;
  // Dismount hoverboard (and jetpack — MD 07) before entering tank
  if (window._dexDismountHoverboard) window._dexDismountHoverboard();
  if (window._dexDismountJetpack) window._dexDismountJetpack();
  sfx('tank.enter');
  _inTank = true;
  _tankExitLock = true; // must release E before exit is allowed
  tank.occupied = true;
  tank.speed = 0;
  // Show stamina bar
  const staminaWrap = document.getElementById('hud-stamina-wrap');
  if (staminaWrap) staminaWrap.style.display = 'block';
  _tankFireTimer = 0;
  const charEl = document.querySelector('.char-local');
  if (charEl) charEl.style.display = 'none';
}

function _exitTank() {
  const tank = _getTankObj();
  if (!tank) return;
  sfx('tank.exit');
  _inTank = false;
  tank.occupied = false;
  tank.speed = 0;
  _tankBoostFuel = TANK_BOOST_DURATION;
  _tankBoostCooldown = 0;
  _tankBoosting = false;
  _tankBoostDepleted = false;
  // Hide stamina bar
  const staminaWrap = document.getElementById('hud-stamina-wrap');
  if (staminaWrap) staminaWrap.style.display = 'none';
  // Place character next to tank
  const exitAngle = tank.angle + Math.PI / 2; // exit to the side
  _charWorldX = tank.x + Math.cos(exitAngle) * 40;
  _charWorldY = tank.y + Math.sin(exitAngle) * 40;
  _charWorldX = Math.max(50, Math.min(WORLD_W - 50, _charWorldX));
  _charWorldY = Math.max(50, Math.min(WORLD_H - 50, _charWorldY));
  // Show character overlay
  const charEl = document.querySelector('.char-local');
  if (charEl) charEl.style.display = '';
}

function _tickTank(keys) {
  const tank = _getTankObj();
  if (!tank || !tank.occupied) return;

  // Read movement keys (passed from character.js via window bridge)
  const wU = keys.w, wD = keys.s, wL = keys.a, wR = keys.d;

  // Rotation — slower at high speed
  const rotMult = 1 - Math.min(0.6, Math.abs(tank.speed) / TANK_FORWARD_MAX * 0.6);
  if (wL) tank.angle -= TANK_ROT_SPEED * rotMult * _dt;
  if (wR) tank.angle += TANK_ROT_SPEED * rotMult * _dt;

  // Acceleration + boost
  const shiftHeld = window._dexTankKeys?.shift || false;
  if (shiftHeld && wU && _tankBoostFuel > 0 && _tankBoostCooldown <= 0 && !_tankBoostDepleted) {
    // MD 18: afterburner audio — ignition kick on engage, spooling hold
    // voice while burning (pitch rises as the fuel drains; the hold
    // auto-releases when the calls stop).
    if (!_tankBoosting) sfx('tank.boost', { at: { x: tank.x, y: tank.y } });
    _tankBoosting = true;
    sfxHold('tankboost', { t: 1 - _tankBoostFuel / TANK_BOOST_DURATION });
    _tankBoostFuel = Math.max(0, _tankBoostFuel - _dt);
    tank.speed = Math.min(TANK_BOOST_MAX, tank.speed + TANK_BOOST_ACCEL * _dt);
    // Auto-deactivate when fuel runs out
    if (_tankBoostFuel <= 0) {
      _tankBoosting = false;
      _tankBoostCooldown = TANK_BOOST_COOLDOWN;
      _tankBoostDepleted = true;
    }
  } else {
    if (_tankBoosting) {
      _tankBoosting = false;
      if (_tankBoostFuel <= 0) _tankBoostCooldown = TANK_BOOST_COOLDOWN;
    }
    if (wU) tank.speed = Math.min(TANK_FORWARD_MAX, tank.speed + TANK_ACCEL * _dt);
    else if (wD) tank.speed = Math.max(-TANK_REVERSE_MAX, tank.speed - TANK_ACCEL * 0.7 * _dt);
    else tank.speed *= Math.pow(0.95, _dt); // friction
    // Regen fuel when not boosting and cooldown expired
    if (_tankBoostCooldown > 0) _tankBoostCooldown -= _dt;
    else _tankBoostFuel = Math.min(TANK_BOOST_DURATION, _tankBoostFuel + _dt * 2); // 2x recharge
    // Reset depleted flag when shift is released
    if (!shiftHeld) _tankBoostDepleted = false;
  }
  // Gradual slowdown from boost speed to normal max
  if (!_tankBoosting && tank.speed > TANK_FORWARD_MAX) {
    tank.speed = Math.max(TANK_FORWARD_MAX, tank.speed - 0.02 * _dt);
  }

  // Kill tiny residual speed
  if (Math.abs(tank.speed) < 0.005) tank.speed = 0;

  // Boost exhaust particles
  if (_tankBoosting && Math.random() < 0.3) {
    const exhaustX = tank.x - Math.cos(tank.angle) * (TANK_HULL_W / 2 + 5);
    const exhaustY = tank.y - Math.sin(tank.angle) * (TANK_HULL_W / 2 + 5);
    const clrHex = (_cachedClr || '#7B8A9C').replace('#', '');
    const r = parseInt(clrHex.slice(0,2),16), g = parseInt(clrHex.slice(2,4),16), b = parseInt(clrHex.slice(4,6),16);
    for (let i = 0; i < 2; i++) {
      _pAddParticle(
        exhaustX + (Math.random()-0.5) * 8, exhaustY + (Math.random()-0.5) * 8,
        -Math.cos(tank.angle) * (0.3 + Math.random() * 0.2) + (Math.random()-0.5) * 0.1,
        -Math.sin(tank.angle) * (0.3 + Math.random() * 0.2) + (Math.random()-0.5) * 0.1,
        12 + Math.floor(Math.random() * 8), r, g, b, 1.5 + Math.random() * 1.5, 'spark'
      );
    }
  }

  // Update HUD stamina bar
  const staminaBar = document.getElementById('hud-stamina-bar');
  if (staminaBar) {
    const pct = (_tankBoostFuel / TANK_BOOST_DURATION) * 100;
    staminaBar.style.width = pct + '%';
    staminaBar.style.opacity = _tankBoostCooldown > 0 ? '0.3' : '';
  }

  // Position update
  tank.x += Math.cos(tank.angle) * tank.speed * _dt;
  tank.y += Math.sin(tank.angle) * tank.speed * _dt;

  // Building collision — push tank out of building footprints
  const tankR=TANK_HULL_W/2+4;
  _getBuildingFootprints().forEach(fp=>{
    if(tank.x+tankR>fp.x-fp.hw&&tank.x-tankR<fp.x+fp.hw&&tank.y+tankR>fp.top&&tank.y-tankR<fp.y){
      const pushL=(tank.x+tankR)-(fp.x-fp.hw),pushR=(fp.x+fp.hw)-(tank.x-tankR);
      const pushT=(tank.y+tankR)-fp.top,pushB=fp.y-(tank.y-tankR);
      const min=Math.min(pushL,pushR,pushT,pushB);
      if(min===pushT){tank.y=fp.top-tankR;}
      else if(min===pushB){tank.y=fp.y+tankR;}
      else if(min===pushL){tank.x=fp.x-fp.hw-tankR;}
      else{tank.x=fp.x+fp.hw+tankR;}
      tank.speed*=0.3;
    }
  });

  // World bounds
  tank.x = Math.max(50, Math.min(WORLD_W - 50, tank.x));
  tank.y = Math.max(50, Math.min(WORLD_H - 50, tank.y));

  // Track animation
  tank._trackOffset = (tank._trackOffset || 0) + tank.speed * _dt * 3;

  // Turret aim — smooth lerp toward mouse world position
  const targetAngle = Math.atan2(_tankMouseWY - tank.y, _tankMouseWX - tank.x);
  let diff = targetAngle - tank.turretAngle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  tank.turretAngle += diff * 0.08 * _dt;

  // Fire cooldown
  if (_tankFireTimer > 0) _tankFireTimer -= _dt;

  // Camera follows tank
  _charWorldX = tank.x;
  _charWorldY = tank.y;

  // Creature stomp — kill anything under the hull
  const cosA = Math.cos(tank.angle), sinA = Math.sin(tank.angle);
  const halfW = TANK_HULL_W / 2 + 6, halfH = TANK_HULL_H / 2 + 4;
  for (const c of _liveCreatures) {
    if (c.dead) continue;
    if (c.kind === 'bird') continue; // birds fly above the tank
    // Transform creature pos into tank-local coords
    const dx = c.x - tank.x, dy = c.y - tank.y;
    const localX = dx * cosA + dy * sinA;
    const localY = -dx * sinA + dy * cosA;
    if (Math.abs(localX) < halfW && Math.abs(localY) < halfH) {
      c.hp = 0; c.dead = true; c.deadT = 0; c.vx = 0; c.vy = 0;
      if (c.kind === 'puffer') { _explodePuffer(c, false); continue; }
      if (c.kind === 'bird') {
        c._falling = true; c._fallWorldY = c.y;
        c._fallTargetWorldY = c.y + 150 + Math.random() * 200; c._fallVY = 0;
        _spawnWorldFeathers(c.x, c.y, c._fallTargetWorldY);
      } else {
        c._bloodSeed = Math.random();
        c._splatSeeds = Array.from({ length: 5 }, () => Math.random());
        c._rocketDeath = true;
        _spawnRocketGore(c.x, c.y, c.scale || 1, false, undefined,
          cosA * tank.speed * 2, sinA * tank.speed * 2);
      }
    }
  }
}

// Tank fire — called from character.js mousedown via window bridge
window._dexTankFire = function() {
  if (!_inTank) return;
  const tank = _getTankObj();
  if (!tank || _tankFireTimer > 0) return;
  _tankFireTimer = TANK_FIRE_COOLDOWN;
  sfx('tank.fire', { at: { x: tank.x, y: tank.y } });
  _addShake(4);

  // Muzzle position in world coords
  const muzzleDist = 10 + TANK_BARREL_LEN + 6; // turret radius + barrel + muzzle brake
  const mwx = tank.x + Math.cos(tank.turretAngle) * muzzleDist;
  const mwy = tank.y + Math.sin(tank.turretAngle) * muzzleDist;

  // Spawn rocket projectile via the existing projectile system in character.js
  if (window._dexSpawnTankRocket) {
    window._dexSpawnTankRocket(mwx, mwy, tank.turretAngle);
  }

  // Muzzle flash particle
  const clrHex = (_cachedClr || '#7B8A9C').replace('#', '');
  const r = parseInt(clrHex.slice(0, 2), 16), g = parseInt(clrHex.slice(2, 4), 16), b = parseInt(clrHex.slice(4, 6), 16);
  _pAddParticle(mwx, mwy, 0, 0, 10, Math.min(255, r + 120), Math.min(255, g + 120), Math.min(255, b + 120), 0, 'flash');
  for (let i = 0; i < 5; i++) {
    const a = tank.turretAngle + (Math.random() - 0.5) * 0.6;
    const spd = 0.5 + Math.random() * 0.8;
    _pAddParticle(mwx, mwy, Math.cos(a) * spd, Math.sin(a) * spd,
      15 + Math.floor(Math.random() * 10), r, g, b, 1.5 + Math.random() * 2, 'smoke');
  }
};

// Update tank mouse world position (called from character.js mousemove)
window._dexUpdateTankMouse = function(sx, sy) {
  if (!_inTank) return;
  const w = screenToWorld(sx, sy);
  _tankMouseWX = w.wx; _tankMouseWY = w.wy;
};

export function isInTank() { return _inTank; }

export function exitPlayMode() {
  if (!_active || _exiting) return;
  _exiting = true;
  if(window._dexUnequipAll)window._dexUnequipAll();
  if (MULTIPLAYER) destroyPhoton();
  _clearRemotePlayers();
  const _connHud = document.getElementById('play-connection-hud');
  if (_connHud) _connHud.style.display = 'none';
  _liveCreatures.length = 0; // force respawn on next enter
  _worldParticles.length = 0;
  _goreParticles.length = 0;
  _pufferProjectiles.length = 0;
  _summonPortals.length = 0;
  _activeWraiths.length = 0;
  // Exit tank if in one
  if (_inTank) { _inTank = false; const t = _getTankObj(); if (t) t.occupied = false; }
  // Hide death screen
  _deathScreenVisible = false;
  if (_deathScreenEl) _deathScreenEl.style.display = 'none';
  // Reset session-mode creatures so birds/yaks don't persist after returning
  if (_charModule && _charModule.resetCreatures) _charModule.resetCreatures();
  // Release color lock — let the current session's color take effect
  // Accent is owned by accent.js; nothing to restore here.
  // color is already applied and we don't want to overwrite it with the old one.

  // Restore avatar-disabled state if toggle was off
  if (window._dexAvatarEnabled === false) {
    document.body.classList.add('avatar-disabled');
    const _co = document.querySelector('.char-local');
    if (_co) _co.style.display = 'none';
  }
  // Remove all play mode handlers
  document.removeEventListener('keydown', _handleChatKey, true);
  document.removeEventListener('mousedown', _handleChatClick, true);
  document.removeEventListener('mousemove', _handleChatMouseMove);
  document.removeEventListener('mouseup', _handleChatMouseUp);
  document.removeEventListener('dblclick', _handleChatDblClick);
  _chatOpen = false;
  _chatTyping = false;
  _chatInput = '';
  if (_chatHiddenInput) _chatHiddenInput.blur();
  document.body.style.cursor = '';
  _chatBubbleText = '';
  _chatBubbleExpiry = 0;
  closePauseMenu();
  clearTimeout(_chatHideTimer);

  // Slide game HUD and button stack down before hiding
  const gameHud = document.getElementById('game-hud');
  if (gameHud) {
    gameHud.classList.remove('hud-visible', 'hud-entering');
    gameHud.classList.add('hud-exiting');
    setTimeout(() => { if (gameHud) { gameHud.style.display = 'none'; gameHud.classList.remove('hud-exiting'); } }, 400);
  }
  const _exitBtnStack = document.getElementById('play-btn-stack');
  if (_exitBtnStack) {
    _exitBtnStack.style.transition = 'transform 0.3s cubic-bezier(0.4,0,1,1),opacity 0.2s ease';
    _exitBtnStack.style.transform = 'translateY(120%)';
    _exitBtnStack.style.opacity = '0';
  }
  const invGrid = document.getElementById('inventory-grid');
  if (invGrid) invGrid.style.display = 'none';
  const pmUI = document.getElementById('play-mode-ui');
  if (pmUI) pmUI.classList.remove('visible');

  // Character jump-out using pose system
  const charEl = document.querySelector('.char-local');
  if (_charModule && _charModule.triggerJumpOut) {
    _charModule.triggerJumpOut();
  }

  // After jump-out completes (~520ms), hide world and restore UI
  setTimeout(() => {
  _active = false;
  _exiting = false;
  window._dexPlayModeActive = false;
  // MD#8: refresh the sessions-popup play button so it returns to the
  // play icon (no-op if popup isn't open).
  if (typeof window._dexRefreshPlayPopupRow === 'function') window._dexRefreshPlayPopupRow();
  if (_charModule && _charModule.cancelJumpOut) _charModule.cancelJumpOut();
  if (charEl) { charEl.style.transition = 'none'; charEl.style.transform = ''; charEl.style.transformOrigin = ''; charEl.style.opacity = '0'; }
  if (_worldCanvas) _worldCanvas.style.display = 'none';
  if (_worldFrontCanvas) _worldFrontCanvas.style.display = 'none';

  const canvas = document.getElementById('canvas');
  if (canvas) {
    canvas.style.display = '';
    canvas.style.transition = 'none';
    canvas.style.transform = '';
    requestAnimationFrame(() => { canvas.style.transition = ''; });
  }

  document.querySelectorAll('.play-mode-hidden').forEach(el => el.classList.remove('play-mode-hidden'));

  // Remove chat button and button stack
  const btnStack = document.getElementById('play-btn-stack');
  if (btnStack) btnStack.remove();

  requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));

  // Reset zoom
  _zoom = _ZOOM_MIN;
  _zoomTarget = _ZOOM_MIN;

  // Restore scroll
  document.body.classList.remove('playroom-active');
  document.removeEventListener('wheel', _preventScroll);
  document.removeEventListener('touchmove', _preventScroll);

  // (game HUD + inventory already hidden at top of exitPlayMode)

  // After UI restores, drop character in from above at note-mode spawn
  setTimeout(() => {
    window._dexResetAvatarExiting?.();
    const spawnX = 88;
    if (_charModule && _charModule.setDropIn) {
      _charModule.setDropIn(spawnX, -80);
    } else if (_charModule && _charModule.setScreenPos) {
      _charModule.setScreenPos(spawnX, -80);
    }
    // Re-query character element fresh (original ref may be stale)
    const charNow = document.querySelector('.char-local');
    if (charNow) {
      charNow.style.transition = 'none';
      charNow.style.display = '';
      charNow.style.transform = '';
      // MD#CHAR-TRANSITION-FLASH: defer opacity to next-next-frame so the
      // character only becomes visible AFTER its drop position is applied
      // by the render loop. Mirrors the enterPlayMode fix.
      charNow.style.opacity = '0';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (charNow) charNow.style.opacity = '1';
        });
      });
    }
  }, 300);

  }, 680); // wait for crouch (280ms) + launch (350ms) + buffer

}

export function isPlayMode() { return _active || _entering || _exiting; }
export function isPlayModePhysics() { return _active; }

export function initPlayMode() {
  // Positional audio: world events attenuate/pan by distance from the player.
  sfxSetListener(() => ({ x: _charWorldX, y: _charWorldY }));
  // Pause menu gets its playmode-owned actions via hooks (it must not import
  // this module — that static cycle would break the build). setKeybind here
  // only updates the live map; the menu persists to dexnote-keybinds itself,
  // the same blob enterPlayMode already reads.
  initPauseMenu({
    exitWorld: exitPlayMode,
    getKeybind: (action) => _keybinds[action],
    setKeybind,
    // Camera lock is a switch in the menu now as well as a key.
    getCameraLock: () => _playCameraMode === 'follow',
    setCameraLock: (on) => {
      _playCameraMode = on ? 'follow' : 'deadzone';
      _cameraSmoothT = 0;
      try { safeStorage.setItem('dexnote-play-camera', _playCameraMode); } catch (e) {}
    },
  });
  window.addEventListener('resize', () => {
    if (!_active || !_worldCanvas) return;
    _worldCanvas.width = window.innerWidth;
    _worldCanvas.height = window.innerHeight;
    if (_worldFrontCanvas) {
      _worldFrontCanvas.width = window.innerWidth;
      _worldFrontCanvas.height = window.innerHeight;
    }
  });

  // Browser back button exits play mode instead of navigating away
  window.addEventListener('popstate', (e) => {
    if (_active) {
      e.preventDefault();
      exitPlayMode();
    }
  });
}
