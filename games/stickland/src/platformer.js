// ══════════════════════════════════════════════════════
//  Platformer mode — camera, world space, platforms, home (MD 06)
// ══════════════════════════════════════════════════════
//  The mode the character lands in when leaving the open world (E-hold at
//  the home). Until now it was a stub: a figure walking the bottom of an
//  empty page. This module gives it a world.
//
//  Coordinate model — the crucial design decision:
//  character.js physics runs in SCREEN space and always has. Rather than
//  converting the entire input/weapon/creature stack to a second space, the
//  camera works by SHIFTING: when the character drifts past the deadzone,
//  the camera absorbs the drift (_camX/_camY move) and everything
//  screen-anchored-but-world-owned — the character, projectiles, arrows,
//  creatures — shifts back by the same delta through one bridge
//  (window._dexPlatShiftWorld). Physics, mouse aim, weapon muzzles, hit
//  tests and the existing DOM FX all keep working untouched because the
//  visible frame stays a plain screen. worldToScreen/screenToWorld follow
//  playmode.js's exact conventions (camera = world coords of screen
//  center), so there is one camera model in this codebase, not two.
//
//  World is deterministic and stateless: ground height is a pure function
//  of world X; platforms are pure functions of their grid cell (mulberry32
//  keyed on cell coords); movers are pure functions of a mode-local clock.
//  Walking away and back reproduces the identical world, and nothing
//  accumulates — there is no chunk store to leak.
//
//  character.js owns the RAF loop; this module is ticked from the
//  notes-mode branch via window._dexPlatTick(dt). No playmode import —
//  the return trip uses a dynamic import, same as the character↔playmode
//  cycle. Everything _dt-scaled.

import { sfx } from './audio.js';
import { safeStorage } from './storage.js';
import { getAccent } from './accent.js';
import { openPauseMenu, closePauseMenu, isPauseMenuOpen } from './pausemenu.js';
// Acyclic static edge: character.js never imports this module (it reaches us
// through window bridges), so pulling its HUD helpers in directly is safe.
import { renderAllHotbarSlots, unholsterBow, toggleInventory } from './character.js';

// ── Tunables ────────────────────────────────────────────
// Deadzone edges as viewport fractions. Vertical is asymmetric and slower
// upward: climbing shouldn't yank the view, falling should never lose the
// character. Catch-up rates are per-frame lerp factors at the 240Hz
// reference (scaled by _dt like everything else).
const DZ_LEFT = 0.42, DZ_RIGHT = 0.58;
const DZ_TOP = 0.30, DZ_BOTTOM = 0.78;   // MD 07-0b: floor rides lower — headroom for the climb
const CATCH_X = 0.05, CATCH_UP = 0.022, CATCH_DOWN = 0.06;

// Platform grid. Cell height is tuned against MD 03's jump arc: a charged
// jump in this mode reaches -9 vy → ~300px rise (GRAVITY 0.18 × RISE_MULT
// 0.75), tap+air-jump ~130px. Vertical neighbours sit 120-230px apart, so
// every rung is reachable with at most a mid charge. Re-check if MD 03's
// numbers ever change.
const CELL_W = 440, CELL_H = 170;
const PLAT_MIN_W = 80, PLAT_MAX_W = 150;
const HOME_X = -420;                 // world X of home n=0 (near spawn)
const HOME_SPACING = 2400;           // MD 06b issue 6: a home every ~2 screens, both directions
const HOME_HOLD_FRAMES = 120;        // ~2s, mirrors HOME_E_HOLD_FRAMES
const HOME_RANGE = 80;               // world px — HOME_INTERACT_RADIUS parity (MD 06b)

// ── State ───────────────────────────────────────────────
let _active = false;
let _camX = 0, _camY = 0;            // world coords of the screen center
let _dt = 1;
let _platTime = 0;                   // deterministic clock for movers
let _canvas = null, _ctx = null;
let _eHeld = false, _eHoldT = 0;
let _returning = false;
let _fx = [];                        // small world-space particle pool
const FX_CAP = 120;
let _visPlats = [];                  // platforms near the viewport, this frame
let _standPlat = null;               // mover the character stands on
let _hasEnteredBefore = false;       // MD 07-0b: free fall on the FIRST entry only
let _firstFall = false;

// ── Score / height (MD 07) ──
// The world stays stateless; the RUN carries the state. _collected is a
// session-scoped set of cell ids (survives round trips to the forest,
// deliberately not persisted — sparks respawn next session). The height
// record is the one persisted number.
const _collected = new Set();
let _score = 0;
let _runMaxH = 0;
let _bestH = 0;
try {
  const st = JSON.parse(safeStorage.getItem('sfg-plat') || 'null');
  if (st && typeof st.bestH === 'number' && st.bestH >= 0) _bestH = st.bestH;
} catch (e) {}
function _saveBest() {
  try { safeStorage.setItem('sfg-plat', JSON.stringify({ bestH: _bestH })); } catch (e) {}
}
let _statsEl = null, _statsCd = 0;
function _updateStats(charW) {
  // Height in "m": ground baseline is zero, 10 world px per metre.
  const h = Math.max(0, Math.round((GROUND_BASE - 40 - charW.wy) / 10));
  if (h > _runMaxH) _runMaxH = h;
  if (_runMaxH > _bestH) { _bestH = _runMaxH; _saveBest(); }
  _statsCd -= _dt;
  if (_statsCd > 0) return;
  _statsCd = 12;
  if (!_statsEl) _statsEl = document.getElementById('plat-stats');
  if (_statsEl) _statsEl.textContent = '\u25b2 ' + h + 'm \u00b7 best ' + _bestH + 'm \u00b7 \u2726 ' + _score;
}

export function isPlatformerActive() { return _active; }

// ── Deterministic randomness ────────────────────────────
function _mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function _cellSeed(i, j) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) ^ 0x5f356495;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// ── World geometry (pure functions — no storage, no leaks) ──────────────
// Ground: gently rolling around world y=GROUND_BASE (MD 07-0b lowered the
// baseline). Same answer for the same X, forever.
const GROUND_BASE = 150;
function groundY(wx) {
  return GROUND_BASE + Math.sin(wx * 0.0016) * 34 + Math.sin(wx * 0.00063 + 1.7) * 52 + Math.sin(wx * 0.0041 + 0.4) * 7;
}

// One platform per grid cell (some cells empty near the ground, none
// below it). Returns {wx, wy, w, mover, amp, spd, phase} or null.
function cellPlatform(i, j) {
  if (j >= 0) return null;                      // nothing below the ground band
  const rand = _mulberry(_cellSeed(i, j));
  if (j === -1) {
    if (rand() < 0.35) return null;             // first band is a little sparse
  } else {
    // MD11: density thins with altitude — the higher the band, the more
    // likely this cell is empty. Capped well short of 1 so there's always
    // a viable (if sparser) line up; the jetpack star-fuel bonus (Phase 4)
    // is what makes the thin bands survivable rather than a hard wall.
    // Reuses the stream-alignment rand() that was previously discarded, so
    // every surviving platform is bit-identical to before. altDepth 0 at
    // j=-2, growing by 1 per band above that.
    const altDepth = Math.max(0, -j - 2);
    const skipP = Math.min(0.5, altDepth * 0.02);
    if (rand() < skipP) return null;
  }
  let w = PLAT_MIN_W + rand() * (PLAT_MAX_W - PLAT_MIN_W);
  // Rest ledges (MD 07c): every sixth band is a wide breather — a place to
  // stand, refuel the jetpack, and read the climb. Reuses the width rand.
  const rest = (j % 6 === 0);
  if (rest) w = 205 + (w - PLAT_MIN_W) * 0.8;
  const wx = i * CELL_W + 20 + rand() * (CELL_W - w - 40);
  // MD 07-0b: bands anchor to the ground under their column, so the
  // lowered baseline carries every band with it. Inter-band gaps stay
  // 110-230px (charged rise ≈300, tap+air ≈130), and band -1 sits
  // 110-230px over the local ground ±≤60px of terrain drift — always
  // reachable with at most a mid charge.
  const colG = groundY((i + 0.5) * CELL_W);
  const wy = colG + j * CELL_H - 60 - rand() * 60;
  // Movers get denser with depth (MD 07c) — the climb sharpens as it
  // rises. Rest ledges never move.
  const depth = Math.max(0, -j - 2);
  const mover = !rest && rand() < Math.min(0.4, 0.22 + depth * 0.012);
  const amp = mover ? 45 + rand() * 45 : 0;
  const spd = mover ? 0.004 + rand() * 0.004 : 0;
  const phase = rand() * Math.PI * 2;
  // MD 07: collectible sparks — derived after every existing rand() call,
  // so the platform layout is bit-identical to before. Sparks sit off the
  // easy line: above one end of the platform, higher when the cell is
  // deep, so grabbing one is a decision rather than a tax.
  let spark = null;
  if (j <= -2 && rand() < 0.3) {
    const end = rand() < 0.5 ? 0.15 : 0.85;
    spark = { ox: w * end, oy: -(30 + rand() * 34) };
  }
  // Blink platforms (MD 07c): timed phases, pure functions of the clock —
  // visible ~68% of a ~4-5s cycle, ghosted while off so the wait is a
  // plan, not a surprise. Deep bands only; never a mover or a rest ledge.
  let blink = null;
  if (j <= -4 && !rest && !mover && rand() < 0.16) {
    blink = { period: 900 + rand() * 360, on: 0.68, phase: rand() };
  }
  return {
    wx, wy, w,
    mover, amp, spd, phase,
    spark, rest, blink,
    id: i + ':' + j,
  };
}

// Phase of a blink platform in [0,1); solid while < on-fraction.
function blinkPhase(p, t) {
  return ((t / p.blink.period) + p.blink.phase) % 1;
}
function blinkSolid(p, t) {
  return !p.blink || blinkPhase(p, t) < p.blink.on;
}
function moverOffset(p, t) {
  return p.mover ? Math.sin(t * p.spd + p.phase) * p.amp : 0;
}

// ── Coordinates (playmode conventions) ──────────────────
function worldToScreen(wx, wy) {
  return {
    sx: wx - _camX + window.innerWidth / 2,
    sy: wy - _camY + window.innerHeight / 2,
  };
}
function screenToWorld(sx, sy) {
  return {
    wx: sx + _camX - window.innerWidth / 2,
    wy: sy + _camY - window.innerHeight / 2,
  };
}

// ── Bridges the character module reads ──────────────────
// MD11: read by character.js's jetpack to size the star-fuel bonus.
window._dexPlatStars = () => _score;
// Floor under the character (screen Y) — resolveFloor's base floor.
window._dexPlatFloorY = function () {
  if (!_active) return null;
  const charX = window._dexPlatCharX != null ? window._dexPlatCharX : window.innerWidth / 2;
  const { wx } = screenToWorld(charX, 0);
  return worldToScreen(0, groundY(wx)).sy;
};

// Ground height under an arbitrary screen X (MD 06b issue 3) — corpses and
// anything else that must fall past platforms to the actual ground.
window._dexPlatGroundYAt = function (sx) {
  if (!_active) return null;
  const { wx } = screenToWorld(sx, 0);
  return worldToScreen(0, groundY(wx)).sy;
};

// FX from character.js (land dust / jump puffs / muzzle flashes) — screen
// coords in, world-space particles out, so they stay put under the camera.
window._dexPlatFX = function (kind, sx, sy, a, b) {
  if (!_active || _fx.length >= FX_CAP) return;
  const { wx, wy } = screenToWorld(sx, sy);
  if (kind === 'land') {
    const p = Math.min(1, Math.max(0, a || 0));
    const n = Math.round(3 + p * 6);
    for (let i = 0; i < n && _fx.length < FX_CAP; i++) {
      const ang = Math.random() * Math.PI * 2;
      const s = 0.35 + p * 0.7 * Math.random();
      _fx.push({ wx: wx + (Math.random() - 0.5) * 8, wy, vx: Math.cos(ang) * s, vy: -Math.abs(Math.sin(ang)) * s * 0.4 - 0.06, life: 16 + p * 16, maxLife: 32, size: 1 + p * 1.4, kind: 'dust' });
    }
  } else if (kind === 'jump') {
    for (let i = 0; i < 3 && _fx.length < FX_CAP; i++) {
      _fx.push({ wx: wx + (Math.random() - 0.5) * 6, wy, vx: (Math.random() - 0.5) * 0.3, vy: 0.15 + Math.random() * 0.2, life: 12 + Math.random() * 8, maxLife: 20, size: 1, kind: 'dust' });
    }
  } else if (kind === 'jet') {
    // Jetpack exhaust — a downward accent spark, throttled by the caller.
    _fx.push({ wx: wx + (Math.random() - 0.5) * 4, wy, vx: (Math.random() - 0.5) * 0.25, vy: 0.9 + Math.random() * 0.6, life: 12 + Math.random() * 8, maxLife: 20, size: 1 + Math.random() * 0.8, kind: 'spark' });
  } else if (kind === 'muzzle') {
    const ang = a || 0;
    _fx.push({ wx, wy, vx: 0, vy: 0, life: 7, maxLife: 7, size: b === 'shotgun' ? 6 : 3.5, kind: 'flash', ang });
    const n = b === 'shotgun' ? 6 : 2;
    for (let i = 0; i < n && _fx.length < FX_CAP; i++) {
      const sp = ang + (Math.random() - 0.5) * 0.8;
      const s = 1 + Math.random() * 1.2;
      _fx.push({ wx, wy, vx: Math.cos(sp) * s, vy: Math.sin(sp) * s, life: 9 + Math.random() * 6, maxLife: 15, size: 0.9, kind: 'spark' });
    }
  }
};

// ── Enter / exit ────────────────────────────────────────
function _enter() {
  _active = true;
  window._dexPlatActive = true;
  _returning = false;
  _eHeld = false; _eHoldT = 0;
  // First entry this session: the spawn drop falls through every platform
  // to the ground. Returns from the forest and later re-entries don't.
  if (!_hasEnteredBefore) { _hasEnteredBefore = true; _firstFall = true; }
  // Camera: character drops in at screen x=88 (exitPlayMode's spawn); put
  // world x=0 under that column with the ground sitting low in the frame.
  const sw = window.innerWidth, sh = window.innerHeight;
  _camX = 0 - (88 - sw / 2);
  _camY = groundY(0) - (sh * DZ_BOTTOM - sh / 2);
  _canvas = document.getElementById('world-canvas');
  if (_canvas) {
    _canvas.width = sw; _canvas.height = sh;
    _canvas.style.display = '';
    _ctx = _canvas.getContext('2d');
  }
  document.addEventListener('keydown', _onKey, true);
  document.addEventListener('keyup', _onKey, true);
  window.addEventListener('resize', _onResize);

  // HUD lifecycle (MD 07): same reveal enterPlayMode drives — hotbar,
  // backpack, cosmetics button, and #inv2 all anchor to it and follow.
  const hud = document.getElementById('game-hud');
  if (hud) {
    hud.style.display = 'flex';
    hud.classList.remove('hud-visible', 'hud-exiting');
    hud.classList.add('hud-entering');
    requestAnimationFrame(() => { requestAnimationFrame(() => {
      hud.classList.remove('hud-entering');
      hud.classList.add('hud-visible');
    }); });
  }
  try { unholsterBow(); renderAllHotbarSlots(); } catch (e) {}
  const stats = document.getElementById('plat-stats');
  if (stats) stats.style.display = '';
}

// Homes recur every HOME_SPACING along the floor in both directions — the
// player is never stranded far from a way back. Pure function of position,
// like everything else here: walking away and back finds the same home in
// the same place. Fixed spacing means two homes can never crowd the
// prompt-radius logic.
function _homeAt(n) {
  const x = n * HOME_SPACING + HOME_X;
  return { x, gy: groundY(x + 40), n };
}
function _nearestHome(wx) {
  return _homeAt(Math.round((wx - 40 - HOME_X) / HOME_SPACING));
}

function _exit() {
  if (!_active) return;
  _active = false;
  window._dexPlatActive = false;
  _fx.length = 0;
  _standPlat = null;
  _eHeld = false; _eHoldT = 0;
  // Teardown completeness (MD 06b): leave the character in a state a fresh
  // entry can build on — no stuck movement keys from held inputs, no death
  // pose carried across the mode boundary. Mirrors exitPlayMode's
  // discipline in the other direction.
  window._dexClearKeys?.();
  window._dexResetCharDeath?.();
  // The world canvas is shared with play mode — only hide it if play mode
  // isn't the one about to draw on it. Same rule for the HUD: on the return
  // trip enterPlayMode owns the transition; only drive hud-exiting when the
  // mode is genuinely closing without a handoff.
  if (_canvas && !window._dexPlayModeActive) {
    _ctx && _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
    _canvas.style.display = 'none';
  }
  const statsEl = document.getElementById('plat-stats');
  if (statsEl) statsEl.style.display = 'none';
  if (!window._dexPlayModeActive) {
    const hud = document.getElementById('game-hud');
    if (hud) {
      hud.classList.remove('hud-visible', 'hud-entering');
      hud.classList.add('hud-exiting');
      setTimeout(() => {
        if (!_active && !window._dexPlayModeActive && hud) {
          hud.style.display = 'none';
          hud.classList.remove('hud-exiting');
        }
      }, 400);
    }
  }
  document.removeEventListener('keydown', _onKey, true);
  document.removeEventListener('keyup', _onKey, true);
  window.removeEventListener('resize', _onResize);
  // Hand the collider array back empty.
  if (window._dexSetChipFloors) window._dexSetChipFloors([]);
}

// Play mode's branch calls this each frame so entering the world always
// tears the platformer down, even though our tick stops being called.
window._dexPlatDeactivate = function () { if (_active) _exit(); };

function _onResize() {
  if (_canvas && _active) { _canvas.width = window.innerWidth; _canvas.height = window.innerHeight; }
}

function _onKey(e) {
  if (!_active) return;
  if (document.activeElement && document.activeElement.matches && document.activeElement.matches('input,textarea')) return;
  // Escape → pause menu, since playmode's ladder is unbound in this mode.
  // Same precedence rules: fullscreen and the F11 heuristic go first (no
  // preventDefault — the browser needs the keydown to exit F11), then the
  // cosmetics panel (character.js's bubble handler closes it).
  if (e.type === 'keydown' && e.key === 'Escape') {
    if (document.fullscreenElement) { document.exitFullscreen(); e.preventDefault(); e.stopPropagation(); return; }
    const _screenH = (window.screen && window.screen.height) || 0;
    if (_screenH > 0 && window.innerHeight >= _screenH - 4) return;
    if (window._dexIsCosmeticsOpen && window._dexIsCosmeticsOpen()) return;
    // MD11: inventory closes before the pause menu opens — same precedence
    // as playmode.js's Escape ladder. inv2 is the live panel; the legacy
    // #inventory-grid check is kept for parity/rollback safety.
    const inv2 = document.getElementById('inv2');
    if (inv2 && inv2.classList.contains('is-open')) {
      toggleInventory();
      e.preventDefault(); e.stopPropagation();
      return;
    }
    const inv = document.getElementById('inventory-grid');
    if (inv && inv.style.display === 'grid') {
      inv.style.display = 'none';
      e.preventDefault();
      return;
    }
    e.preventDefault(); e.stopPropagation();
    if (isPauseMenuOpen()) closePauseMenu();
    else openPauseMenu();
    return;
  }
  if (e.key !== 'e' && e.key !== 'E') return;
  _eHeld = e.type === 'keydown';
  if (!_eHeld) _eHoldT = 0;
}

// ── The return trip ─────────────────────────────────────
// MD 06b issue 1: the original _returning flag was a one-way latch — if
// enterPlayMode() guard-returned (mid-transition race) or anything in the
// chain threw, the latch stayed set, every later E-hold silently no-oped,
// and the player was stranded in the platformer with the game reading as
// broken. The return now verifies the handoff actually happened and
// re-arms on any failure: the worst case is "hold E again", never a dead
// mode.
function _tickHomeHold(charW) {
  const home = _nearestHome(charW.wx);
  const near = Math.abs(charW.wx - (home.x + 40)) < HOME_RANGE && Math.abs(charW.wy - home.gy) < 140;
  if (!near || _returning) { if (!_eHeld) _eHoldT = 0; return near ? home : null; }
  if (_eHeld) {
    _eHoldT += _dt;
    // MD 07b: silent transition — the shared progress ring is the feedback.
    if (_eHoldT >= HOME_HOLD_FRAMES) {
      _eHoldT = 0; _eHeld = false;
      _returning = true;
      // Dynamic import — the same lazy edge character↔playmode use; the
      // static graph stays acyclic.
      import('./playmode.js').then(m => {
        _exit();
        m.enterPlayMode();
        setTimeout(() => {
          _returning = false;
          if (!window._dexPlayModeActive) {
            console.warn('[plat] return to world did not take — E-hold re-armed');
          }
        }, 900);
      }).catch((e) => {
        console.warn('[plat] return to world failed:', e);
        _returning = false;
      });
    }
  } else {
    _eHoldT = 0;
  }
  return near ? home : null;
}

// ── Main tick — called from character.js's notes-mode branch ─────────────
let _notesFrames = 0;   // debounce so the pre-enterPlayMode boot frames don't flash the world
window._dexPlatTick = function (dt) {
  // Self-activating: the platformer IS notes mode now. The first ticks after
  // play mode releases the frame bring the world up; play mode taking the
  // frame back tears it down via _dexPlatDeactivate.
  if (window._dexPlayModeActive) { _notesFrames = 0; if (_active) _exit(); return; }
  if (!_active) {
    _notesFrames += dt || 1;
    if (_notesFrames < 60) return;   // ~0.25s of continuous notes mode before activating
    _enter();
  }
  _dt = dt || 1;
  _platTime += _dt;

  const sw = window.innerWidth, sh = window.innerHeight;
  const P = window._dexPlatCharPos ? window._dexPlatCharPos() : null;
  if (!P) return;
  window._dexPlatCharX = P.x;

  // First-spawn free fall: keep the drop-through window fed until the drop
  // lands; duration derives from the actual fall, not a guess. Suppression
  // only applies while falling, so a jump right after touchdown is clean.
  if (_firstFall) {
    if (!P.grounded) window._dexPlatDropThrough?.();
    else _firstFall = false;
  }

  // ── Moving-platform carry ──
  // Movers are pure functions of the clock; the delta this frame is applied
  // to the character if they're standing on one, so it never slides out
  // from under them.
  if (_standPlat) {
    const dx = moverOffset(_standPlat, _platTime) - moverOffset(_standPlat, _platTime - _dt);
    if (window._dexPlatShiftChar) window._dexPlatShiftChar(dx);
  }

  // ── Camera: absorb drift past the deadzone, shift the world back ──
  let shiftX = 0, shiftY = 0;
  const L = sw * DZ_LEFT, R = sw * DZ_RIGHT, T = sh * DZ_TOP, B = sh * DZ_BOTTOM;
  if (P.x > R) shiftX = (P.x - R) * Math.min(1, CATCH_X * _dt);
  else if (P.x < L) shiftX = (P.x - L) * Math.min(1, CATCH_X * _dt);
  if (P.y > B) shiftY = (P.y - B) * Math.min(1, CATCH_DOWN * _dt);
  else if (P.y < T) shiftY = (P.y - T) * Math.min(1, CATCH_UP * _dt);
  if (shiftX || shiftY) {
    _camX += shiftX; _camY += shiftY;
    // One bridge moves everything world-owned: character, projectiles,
    // arrows, creatures. MD 04's shake stays purely visual (draw offset).
    if (window._dexPlatShiftWorld) window._dexPlatShiftWorld(shiftX, shiftY);
  }

  // ── Collect platforms near the viewport; publish colliders ──
  const charW = screenToWorld(P.x - shiftX, P.y - shiftY);
  _visPlats.length = 0;
  const i0 = Math.floor((_camX - sw / 2 - CELL_W) / CELL_W), i1 = Math.floor((_camX + sw / 2 + CELL_W) / CELL_W);
  const j0 = Math.floor((_camY - sh / 2 - CELL_H) / CELL_H) - 1, j1 = Math.floor((_camY + sh / 2 + CELL_H) / CELL_H) + 1;
  const floors = [];
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const p = cellPlatform(i, j);
      if (!p) continue;
      const ox = moverOffset(p, _platTime);
      _visPlats.push(p);
      if (!blinkSolid(p, _platTime)) continue;   // blinked out — no collider
      const s = worldToScreen(p.wx + ox, p.wy);
      // bottom included: arrow-platform collision and the drag-drop floor
      // picker both read chip.bottom (MD 06b issue 3 audit).
      floors.push({ left: s.sx, right: s.sx + p.w, top: s.sy, bottom: s.sy + 8, _plat: p });
    }
  }
  if (window._dexSetChipFloors) window._dexSetChipFloors(floors);

  // ── Which mover (if any) is under the feet, for next frame's carry ──
  _standPlat = null;
  if (P.grounded && P.floorType === 'chip') {
    for (const f of floors) {
      if (f._plat.mover && P.x >= f.left - 4 && P.x <= f.right + 4 && Math.abs(P.y - f.top) < 4) {
        _standPlat = f._plat;
        break;
      }
    }
  }

  // ── Collectibles (MD 07) ──
  // Proximity against the character's torso midpoint; movers carry their
  // spark with them. Collected ids live in the run-scoped set only.
  {
    const cxm = charW.wx, cym = charW.wy - 22;
    for (const p of _visPlats) {
      if (!p.spark || _collected.has(p.id)) continue;
      const sx = p.wx + moverOffset(p, _platTime) + p.spark.ox;
      const sy = p.wy + p.spark.oy;
      const dx = sx - cxm, dy = sy - cym;
      if (dx * dx + dy * dy < 30 * 30) {
        _collected.add(p.id);
        _score++;
        if (window._dexJetStarBonus) window._dexJetStarBonus();
        sfx('collect');
        if (_fx.length < FX_CAP) _fx.push({ wx: sx, wy: sy, vx: 0, vy: 0, life: 14, maxLife: 14, size: 0, kind: 'ring' });
        // MD11: particle burst — radiating sparks, same _fx pool as land/jump dust.
        const n = Math.min(10, FX_CAP - _fx.length);
        for (let k = 0; k < n; k++) {
          const ang = (k / n) * Math.PI * 2 + Math.random() * 0.4;
          const spd = 1.2 + Math.random() * 1.6;
          _fx.push({
            wx: sx, wy: sy,
            vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
            life: 20 + Math.random() * 10, maxLife: 30,
            size: 1.4 + Math.random() * 1.4,
            // 'burst', not 'spark' — the jet exhaust and muzzle FX already
            // use kind:'spark' and must keep their plain (glow-free) render.
            kind: 'burst',
          });
        }
      }
    }
  }
  _updateStats(charW);

  // ── Home interaction ──
  const nearHome = _tickHomeHold(charW);

  _draw(sw, sh, nearHome);
};

// ── Drawing ─────────────────────────────────────────────
function _draw(sw, sh, nearHome) {
  if (!_ctx) return;
  const ctx = _ctx;
  ctx.clearRect(0, 0, sw, sh);
  const clr = getAccent();

  // Parallax depth dots — deterministic from world coords, half camera speed.
  ctx.fillStyle = clr;
  ctx.globalAlpha = 0.10;
  const px0 = Math.floor((_camX * 0.5 - sw / 2) / 160) * 160;
  const py0 = Math.floor((_camY * 0.5 - sh / 2) / 160) * 160;
  for (let x = px0; x < _camX * 0.5 + sw / 2 + 160; x += 160) {
    for (let y = py0; y < _camY * 0.5 + sh / 2 + 160; y += 160) {
      const r = _mulberry(_cellSeed(x / 160, y / 160))();
      ctx.beginPath();
      ctx.arc(x - _camX * 0.5 + sw / 2 + r * 90, y - _camY * 0.5 + sh / 2 + r * 130, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // Altitude visuals (MD 07c) — height gets legible without reading a
  // number: wispy clouds drift through the mid climb, stars take over
  // higher. Deterministic per grid cell, drawn at parallax so they read
  // as depth. Cheap: a couple dozen strokes at most.
  {
    const PAR = 0.7;
    const cx0 = Math.floor((_camX * PAR - sw / 2) / 340) * 340;
    const cy0 = Math.floor((_camY * PAR - sh / 2) / 240) * 240;
    ctx.strokeStyle = clr;
    ctx.lineWidth = 1.2;
    for (let x = cx0; x < _camX * PAR + sw / 2 + 340; x += 340) {
      for (let y = cy0; y < _camY * PAR + sh / 2 + 240; y += 240) {
        const wyApprox = y / PAR;
        const r = _mulberry(_cellSeed(x / 340, y / 240 + 7777));
        const roll = r();
        const sxp = x - _camX * PAR + sw / 2 + r() * 220;
        const syp = y - _camY * PAR + sh / 2 + r() * 160;
        if (wyApprox < GROUND_BASE - 500 && wyApprox > GROUND_BASE - 2600 && roll < 0.55) {
          // cloud — two soft offset arcs
          ctx.globalAlpha = 0.13;
          ctx.beginPath();
          ctx.moveTo(sxp - 26, syp);
          ctx.quadraticCurveTo(sxp - 8, syp - 9, sxp + 12, syp - 2);
          ctx.moveTo(sxp - 14, syp + 4);
          ctx.quadraticCurveTo(sxp + 6, syp - 4, sxp + 26, syp + 3);
          ctx.stroke();
        } else if (wyApprox <= GROUND_BASE - 2200 && roll < 0.7) {
          // star — small cross with a slow twinkle
          const tw = 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(_platTime * 0.006 + sxp * 0.3));
          ctx.globalAlpha = tw;
          const rr = 2 + r() * 1.6;
          ctx.beginPath();
          ctx.moveTo(sxp - rr, syp); ctx.lineTo(sxp + rr, syp);
          ctx.moveTo(sxp, syp - rr); ctx.lineTo(sxp, syp + rr);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // Ground — continuous polyline, faint fill below.
  ctx.strokeStyle = clr;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  const step = 26;
  const wxStart = _camX - sw / 2 - step;
  let first = true;
  for (let wx = wxStart; wx <= _camX + sw / 2 + step; wx += step) {
    const s = worldToScreen(wx, groundY(wx));
    if (first) { ctx.moveTo(s.sx, s.sy); first = false; }
    else ctx.lineTo(s.sx, s.sy);
  }
  ctx.stroke();
  ctx.globalAlpha = 0.06;
  ctx.lineTo(sw + step, sh + 40);
  ctx.lineTo(-step, sh + 40);
  ctx.closePath();
  ctx.fillStyle = clr;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Grass ticks on the ground — deterministic per world X.
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.55;
  const g0 = Math.floor((_camX - sw / 2) / 64) * 64;
  for (let wx = g0; wx < _camX + sw / 2 + 64; wx += 64) {
    const r = _mulberry(_cellSeed(wx, 9999))();
    if (r < 0.4) continue;
    const bx = wx + r * 40;
    const s = worldToScreen(bx, groundY(bx));
    const sway = Math.sin(_platTime * 0.01 + bx * 0.2) * 1.4;
    ctx.beginPath();
    ctx.moveTo(s.sx, s.sy);
    ctx.quadraticCurveTo(s.sx + sway * 0.5, s.sy - 4, s.sx + sway, s.sy - 7 - r * 4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Platforms (MD 13) — each type wears its own quiet identity so they can
  // be told apart at a glance without adding visual mass:
  //  · solid — deck line + a dimmer inset "front face" line just below
  //            (reads as a slab, faintly 3D) + the two support ticks
  //  · mover — deck riding a travel rail with end-stops, two carriage dots
  //            under the deck sitting on the rail; no slab (it floats)
  //  · blink — deck drawn as segments with hairline gaps (reads fragile /
  //            breakable), flicker before vanishing, dashed ghost while out
  ctx.lineWidth = 2;
  for (const p of _visPlats) {
    const ox = moverOffset(p, _platTime);
    const s = worldToScreen(p.wx + ox, p.wy);
    if (s.sx + p.w < -40 || s.sx > sw + 40 || s.sy < -40 || s.sy > sh + 40) continue;
    if (p.mover) {
      // Travel rail with end-stops — the range reads at a glance.
      const rail = worldToScreen(p.wx - p.amp, p.wy);
      const railW = p.w + p.amp * 2;
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.moveTo(rail.sx, rail.sy + 3);
      ctx.lineTo(rail.sx + railW, rail.sy + 3);
      ctx.stroke();
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(rail.sx, rail.sy); ctx.lineTo(rail.sx, rail.sy + 6);
      ctx.moveTo(rail.sx + railW, rail.sy); ctx.lineTo(rail.sx + railW, rail.sy + 6);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.globalAlpha = 1;
    }
    // Blink platforms: flicker in the last stretch before vanishing, ghost
    // (dashed, faint) while out so the return is plannable.
    let blinkAlpha = 1, ghost = false;
    if (p.blink) {
      const ph = blinkPhase(p, _platTime);
      if (ph >= p.blink.on) { ghost = true; blinkAlpha = 0.14; }
      else if (ph > p.blink.on - 0.12) blinkAlpha = 0.35 + 0.5 * Math.abs(Math.sin(_platTime * 0.12));
    }
    ctx.globalAlpha = blinkAlpha;
    if (p.rest) ctx.lineWidth = 3;
    if (ghost) {
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.moveTo(s.sx, s.sy); ctx.lineTo(s.sx + p.w, s.sy);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (p.blink) {
      // Segmented deck — visible gaps make it read breakable while solid.
      const segs = Math.max(3, Math.round(p.w / 26));
      const gap = 5, segW = (p.w - gap * (segs - 1)) / segs;
      ctx.beginPath();
      for (let k = 0; k < segs; k++) {
        const x0 = s.sx + k * (segW + gap);
        ctx.moveTo(x0, s.sy); ctx.lineTo(x0 + segW, s.sy);
      }
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(s.sx, s.sy); ctx.lineTo(s.sx + p.w, s.sy);
      ctx.stroke();
    }
    if (p.rest) ctx.lineWidth = 2;
    if (ghost) { ctx.globalAlpha = 1; continue; }   // nothing else while out
    if (p.mover) {
      // Carriage dots — the deck visibly rides its rail. (MD 16b: sized
      // to survive gameplay camera distance, like everything below —
      // the hairline pass looked identical to the old flat lines.)
      ctx.globalAlpha = blinkAlpha * 0.85;
      ctx.fillStyle = clr;
      ctx.beginPath();
      ctx.arc(s.sx + 8, s.sy + 3.5, 2.6, 0, Math.PI * 2);
      ctx.arc(s.sx + p.w - 8, s.sy + 3.5, 2.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (!p.blink) {
      // Solid slab — an actual translucent body under the deck, not a
      // hairline: reads as a physical block at any zoom. Blink platforms
      // deliberately get NO body (hollow + segmented = fragile).
      const depth = p.rest ? 7 : 5;
      ctx.globalAlpha = blinkAlpha * 0.18;
      ctx.fillStyle = clr;
      ctx.fillRect(s.sx + 1, s.sy + 1, p.w - 2, depth);
      ctx.globalAlpha = blinkAlpha * 0.55;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(s.sx + 1, s.sy + 1 + depth); ctx.lineTo(s.sx + p.w - 1, s.sy + 1 + depth);
      ctx.stroke();
      ctx.lineWidth = 1.1;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(s.sx + 7, s.sy + depth); ctx.lineTo(s.sx + 11, s.sy + depth + 6);
      ctx.moveTo(s.sx + p.w - 7, s.sy + depth); ctx.lineTo(s.sx + p.w - 11, s.sy + depth + 6);
      ctx.stroke();
      ctx.lineWidth = 2;
    }
    ctx.globalAlpha = 1;
  }

  // Collectible sparks — four-point twinkles, phase from the cell id.
  ctx.lineWidth = 1.3;
  for (const p of _visPlats) {
    if (!p.spark || _collected.has(p.id)) continue;
    const s = worldToScreen(p.wx + moverOffset(p, _platTime) + p.spark.ox, p.wy + p.spark.oy);
    if (s.sx < -20 || s.sx > sw + 20 || s.sy < -20 || s.sy > sh + 20) continue;
    const tw = 0.7 + Math.sin(_platTime * 0.02 + (p.wx % 97)) * 0.3;
    // MD11: bigger base size, plus a soft pulsing glow halo behind the
    // twinkle. save/restore scoped so shadowBlur never leaks into the
    // homes/FX drawing below.
    const r = 7 * tw + 2.5;
    ctx.save();
    ctx.shadowColor = clr;
    ctx.shadowBlur = 6 + tw * 10;
    ctx.globalAlpha = 0.55 + tw * 0.45;
    ctx.strokeStyle = clr;
    ctx.beginPath();
    ctx.moveTo(s.sx - r, s.sy); ctx.lineTo(s.sx + r, s.sy);
    ctx.moveTo(s.sx, s.sy - r); ctx.lineTo(s.sx, s.sy + r);
    ctx.moveTo(s.sx - r * 0.45, s.sy - r * 0.45); ctx.lineTo(s.sx + r * 0.45, s.sy + r * 0.45);
    ctx.moveTo(s.sx - r * 0.45, s.sy + r * 0.45); ctx.lineTo(s.sx + r * 0.45, s.sy - r * 0.45);
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // Homes — every visible one; matches the open-world silhouette.
  {
    const n0 = Math.floor((_camX - sw / 2 - 160 - HOME_X) / HOME_SPACING);
    const n1 = Math.ceil((_camX + sw / 2 + 160 - HOME_X) / HOME_SPACING);
    for (let n = n0; n <= n1; n++) {
      const h = _homeAt(n);
      _drawHome(ctx, clr, h, nearHome && nearHome.n === n ? nearHome : null);
    }
  }

  // FX particles.
  for (let i = _fx.length - 1; i >= 0; i--) {
    const f = _fx[i];
    f.life -= _dt;
    if (f.life <= 0) { _fx.splice(i, 1); continue; }
    f.wx += f.vx * _dt; f.wy += f.vy * _dt;
    f.vx *= Math.pow(0.94, _dt); f.vy *= Math.pow(0.94, _dt);
    const s = worldToScreen(f.wx, f.wy);
    const alpha = Math.min(1, (f.life / f.maxLife) * 2);
    if (f.kind === 'ring') {
      const prog = 1 - f.life / f.maxLife;
      ctx.globalAlpha = (f.life / f.maxLife) * 0.9;
      ctx.strokeStyle = clr;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(s.sx, s.sy, 3 + prog * 15, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      continue;
    }
    if (f.kind === 'flash') {
      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = clr;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + 0.4;
        ctx.moveTo(s.sx, s.sy);
        ctx.lineTo(s.sx + Math.cos(a) * f.size, s.sy + Math.sin(a) * f.size);
      }
      ctx.stroke();
    } else if (f.kind === 'burst') {
      // MD11: star-collect burst — small glowing dots radiating out.
      ctx.save();
      ctx.shadowColor = clr;
      ctx.shadowBlur = 8;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = clr;
      ctx.beginPath();
      ctx.arc(s.sx, s.sy, Math.max(0.4, f.size * alpha), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.globalAlpha = alpha * (f.kind === 'dust' ? 0.5 : 0.9);
      ctx.fillStyle = clr;
      ctx.beginPath();
      ctx.arc(s.sx, s.sy, Math.max(0.4, f.size * alpha), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function _drawHome(ctx, clr, home, nearHome) {
  const gy = home.gy;
  const s = worldToScreen(home.x, gy);
  if (s.sx < -160 || s.sx > ctx.canvas.width + 160) return;
  const x = s.sx, y = s.sy;
  ctx.strokeStyle = clr;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  // Body
  ctx.strokeRect(x, y - 52, 80, 52);
  // Roof
  ctx.beginPath();
  ctx.moveTo(x - 10, y - 52); ctx.lineTo(x + 40, y - 82); ctx.lineTo(x + 90, y - 52);
  ctx.stroke();
  // Door
  ctx.strokeRect(x + 33, y - 26, 16, 26);
  ctx.beginPath(); ctx.arc(x + 45, y - 13, 1.2, 0, Math.PI * 2); ctx.fill();
  // Windows
  ctx.strokeRect(x + 9, y - 40, 13, 11);
  ctx.strokeRect(x + 58, y - 40, 13, 11);
  ctx.beginPath();
  ctx.moveTo(x + 15.5, y - 40); ctx.lineTo(x + 15.5, y - 29);
  ctx.moveTo(x + 9, y - 34.5); ctx.lineTo(x + 22, y - 34.5);
  ctx.moveTo(x + 64.5, y - 40); ctx.lineTo(x + 64.5, y - 29);
  ctx.moveTo(x + 58, y - 34.5); ctx.lineTo(x + 71, y - 34.5);
  ctx.stroke();

  // Interaction prompt — the open world's renderer, via the playmode
  // bridge, so the prompt is pixel-identical in both modes (MD 06b issue 5).
  if (nearHome && window._dexDrawInteractPrompt) {
    const prog = Math.min(1, _eHoldT / HOME_HOLD_FRAMES);
    window._dexDrawInteractPrompt(ctx, x + 40, y, 'Go Home', prog, 110);
  }
}
