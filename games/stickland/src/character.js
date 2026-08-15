// ══════════════════════════════════════════════════════
//  dexnote — CHARACTER AVATAR MODULE
//  Animated stick figure with simplified physics
// ══════════════════════════════════════════════════════

import { loadCosmetics, saveCosmetics, safeStorage } from './storage.js';
import { ROOM_ID } from './config.js';
import { getAccent } from './accent.js';
import { sfx, sfxHold, sfxHoldStop, footstep } from './audio.js';

// ── Physics constants ──
const GRAVITY        = 0.18;   // gentle gravity — floatier feel
const RISE_MULT      = 0.75;   // even lighter gravity while rising for hang-time
const AIR_RESIST     = 0.98;
const FRICTION       = 0.82;
const MAX_FALL       = 8;      // lower terminal velocity
const WALK_SPEED     = 1.0;
const ACCEL          = 0.18;
const DECEL          = 0.78;
const MAX_CHARGE     = 120;
const PM_MAX_CHARGE  = 60;    // play mode: half the charge time
const CHARGE_DELAY   = 12;     // frames before charge starts (~200ms at 60fps)
const TAP_JUMP_VY    = -4.5;   // quick hop velocity

// ── Input forgiveness (MD 03) ──
// Windows are 240Hz-reference frames and tick with _dt like every other
// timer, so the grace feels identical at 60/120/240Hz.
const COYOTE_FRAMES     = 22;   // ~90ms — jump still fires just after walking off a ledge
const JUMP_BUFFER_FRAMES = 34;  // ~140ms — a tap just before touchdown fires on landing
const AIR_JUMP_MULT     = 0.85; // the one mid-air jump is a touch weaker than a ground hop

const CHAR_W = 36, CHAR_H = 55;

// ── Delta-time scaling ──
let _lastFrameTime = 0;
let _dt = 1; // delta-time multiplier (1.0 = reference frame rate)
const REFERENCE_FPS = 240; // game was tuned at 240fps (Razer 240Hz panel)
const REFERENCE_DT = 1000 / REFERENCE_FPS; // ~8.33ms

// ── Hit-stop (MD 04) ──
// A solid hit briefly scales _dt down for everything (character physics,
// playmode tick, particles), then releases. Because it scales each frame's
// _dt rather than skipping frames, the delta-time math never sees a gap —
// no teleport on resume. The countdown runs on the RAW (unscaled) dt so a
// slow-mo window can't extend itself.
let _hitStopLeft = 0;    // remaining raw 240Hz-reference frames
let _hitStopScale = 1;   // time scale while active
window._dexHitStop = (frames, scale) => {
  const f = Math.min(frames || 6, 24);
  if (f > _hitStopLeft) {
    _hitStopLeft = f;
    _hitStopScale = Math.max(0.05, Math.min(scale || 0.2, 1));
  }
};

// ── Physics state ──
const P = {
  x: 200, y: 400,
  vx: 0, vy: 0,
  grounded: true,
  floorType: 'canvas', // 'canvas'|'chip'|'sbfoot'
  stunned: false,
  stunTimer: 0,
  stunSeverity: 0,
  activeChip: null,
  fallTimer: 0,
};
let _forcedStunSeverity = null;
let _dragDropStun = false;
let _playerDead = false;
let _deathArrowEl = null;
let _deathRespawnTimer = 0;
const DEATH_DISPLAY_FRAMES = 150;

// ── Character state ──
let _overlay = null, _charEl = null, _svgEl = null, _shadowEl = null;
let _uid = 'guest', _userName = 'Guest', _sessionId = null, _db = null;
let _accentColor = '#7B8A9C';
let flipX = false;
let currentState = 'idle';
let chargeFrames = 0, isCharging = false, spaceHeld = false;
let landImpact = 0;
let landAbsorbT = 0, landRecoverT = 0, absorbDur = 12;
let crouchFrame = 0, crouchDur = 0;
let _jumpVYTarget = 0;
let getUpStage = 0, getUpT = 0;
let launchBlendT = 0, knockbackT = 0;
let runPhase = 0, idleT = 0;
let lastActivity = Date.now();
let _rafId = null;
let _topDownDir = 'idle'; // for play mode: 'idle'|'right'|'left'|'up'|'down'|'up-right'|'up-left'|'down-right'|'down-left'
let _playZoom = 1; // camera zoom in play mode (1 = default, up to 1.5)

// ── Carry animals ──
let _carriedCreature = null;
let _carryAnimT = 0;
let _carryKickPhase = 'kick';
let _carryKickTimer = 0;
let _carryThrowCharge = 0;
let _carryThrowCharging = false;
let _carryPickupYOffset = 0; // Y distance from player to creature at pickup
let _isPlayModeFn = null;
let _isPlayModePhysicsFn = null;
let _isChatOpenFn = null;
let _isExitConfirmFn = null;
let _getHomeScreenBoundsFn = null;
let _getBuildingPolysFn = null;
let _tickPlayModeFn = null;
// When true (e.g. community hub open over play mode) the player stays put but
// the world loop keeps ticking — enemies/physics/remote players keep running
// so state is preserved exactly. Toggled from init.js via window bridge below.
let _inputPaused = false;
window._dexPausePlayInput = (pause) => { _inputPaused = !!pause; };
let _hitPlayCreaturesFn = null;
let _screenToWorldFn = null;
let _worldToScreenFn = null;
let _addWorldExplosionFn = null;
let _isPlayerStunnedFn = null;
let _isInTankFn = null;

// ── Cosmetics ──
const _cosmetics = { torso: 'default', hat: 'none', hair: 'none' };
const _hairFlow = { offset: 0, target: 0, waveT: 0, bunX: 13 };

// ── Input ──
const _keys = {};
const _MOVE_KEYS = ['ArrowLeft','ArrowRight','a','d','Shift',' '];
window._dexClearKeys = () => { for (const k in _keys) _keys[k] = false; };
window._dexDismountHoverboard = () => {
  if (_hoverboard.active) {
    _hoverboard.active = false;
    _hoverboard.transition = '';
    _hoverboard.boosting = false;
    if (_hoverboard.el) _hoverboard.el.style.display = 'none';
    sfx('board.dismount');
  }
};
window._dexUnequipAll = () => {
  if (window._dexDismountJetpack) window._dexDismountJetpack();
  if (_hoverboard.active) { _hoverboard.active=false; _hoverboard.transition=''; _hoverboard.boosting=false; if(_hoverboard.el)_hoverboard.el.style.display='none'; }
  if (_gun.held) _dropGun();
  _bow.holstered=true; _bow.drawing=false;
  const invPanel=document.getElementById('play-inventory'); if(invPanel)invPanel.style.display='none';
};

// ── Tickle state ──
let _tickleActive = false;
let _tickleDecay = 0;
let _tickleHeartTimer = 0;
let _ticklePhase = 0;
let _tickleWarmup = 0;
const TICKLE_WARMUP_THRESHOLD = 30;
let _lastMouseX = 0, _lastMouseY = 0;

// ── Auto-fire state ──
let _mouseHeld = false;
let _fireTimer = 0;
const FIRE_INTERVAL = 12; // frames between shots (~5/sec at 60fps)

// ── Drag state ──
const _drag = {
  active: false,
  mouseX: 0, mouseY: 0,    // current mouse position
  bodyX: 0, bodyY: 0,       // body center (hangs from hand)
  bodyVX: 0, bodyVY: 0,     // body swing velocity
  swingAngle: 0,            // radians — body swings from grab point
};

// ── Remote ──
// Firestore presence (sessions/{id}/presence/{uid}) is gone — Photon in
// playmode.js already does presence, with its own _remotePlayersMap.

// ═══════════════════════════════════
//  SVG CHARACTER BUILDER
// ═══════════════════════════════════

function _buildCharSvg(id) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 36 55');
  svg.setAttribute('width', CHAR_W);
  svg.setAttribute('height', CHAR_H);
  svg.style.overflow = 'visible';
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('stroke', 'var(--char-clr,var(--clr-adj,#7B8A9C))');
  g.setAttribute('stroke-width', '2.2');
  g.setAttribute('stroke-linecap', 'round');
  g.setAttribute('fill', 'none');

  const mk = (tag, attrs) => { const el = document.createElementNS(ns, tag); for (const [k,v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
  const fillClr = 'var(--char-clr,var(--clr-adj,#7B8A9C))';

  // Hair group (renders behind head)
  g.appendChild(mk('g', { id: id+'-hair' }));
  // Head
  g.appendChild(mk('circle', { id: id+'-head', cx:18, cy:8, r:6, fill:'var(--bg)' }));
  // Hat group (renders on top of head)
  g.appendChild(mk('g', { id: id+'-hat' }));
  // Torso (default line) — a touch heavier than the limbs (MD 09): the
  // core-to-extremity taper is what makes the silhouette read as a body
  // instead of five equal wires, especially against the stroke-drawn world.
  g.appendChild(mk('line', { id: id+'-torso', x1:18, y1:14, x2:18, y2:30, 'stroke-width':'2.5' }));
  // Legs (drawn before skirt so skirt covers upper leg portions)
  g.appendChild(mk('path', { id: id+'-leg-left', d:'M18,30 Q12,40 12,48' }));
  g.appendChild(mk('circle', { id: id+'-foot-left', cx:12, cy:48, r:1.5, fill: fillClr }));
  g.appendChild(mk('path', { id: id+'-leg-right', d:'M18,30 Q24,40 24,48' }));
  g.appendChild(mk('circle', { id: id+'-foot-right', cx:24, cy:48, r:1.5, fill: fillClr }));
  // Skirt triangle (drawn on top of legs — filled with bg color to hide leg portions behind it)
  const tri = mk('polygon', { id: id+'-torso-tri', points:'18,14 6,40 30,40', 'stroke-linejoin':'round', fill:'var(--bg)' });
  tri.style.display = 'none';
  // Inverted triangle (V-torso) — wide at shoulders, narrow at waist
  const vtri = mk('polygon', { id: id+'-torso-vtri', points:'6,14 30,14 18,30', 'stroke-linejoin':'round', fill:'var(--bg)' });
  vtri.style.display = 'none';
  // Robe — long flowing garment covering legs
  const robe = mk('path', { id: id+'-torso-robe', d:'M12,14 L8,46 Q13,48 18,46 Q23,48 28,46 L24,14 Z', 'stroke-linejoin':'round', fill:'var(--bg)' });
  robe.style.display = 'none';
  // Open coat (MD 05) — two hanging panels; the spine stays visible between
  // them. Re-anchored to the live shoulder line by _syncSkirt.
  const coat = mk('path', { id: id+'-torso-coat', d:'M13,14 L10.5,38 Q13,39 15.5,38 L16.5,16 Z M23,14 L25.5,38 Q23,39 20.5,38 L19.5,16 Z', 'stroke-linejoin':'round', fill:'var(--bg)' });
  coat.style.display = 'none';
  g.appendChild(tri);
  g.appendChild(vtri);
  g.appendChild(robe);
  g.appendChild(coat);
  // Arms (drawn on top of everything). Forearms slightly lighter than the
  // upper arms (inherited 2.2) — same taper logic as the torso, reversed.
  // Hand dots terminate the forearms the way the foot dots terminate the
  // legs; _setLine keeps them glued to the forearm ends every frame, so
  // every pose, gun aim and bow draw carries them for free.
  g.appendChild(mk('line', { id: id+'-upper-arm-left', x1:18, y1:17, x2:10, y2:23 }));
  g.appendChild(mk('line', { id: id+'-lower-arm-left', x1:10, y1:23, x2:8, y2:30, 'stroke-width':'1.9' }));
  g.appendChild(mk('circle', { id: id+'-hand-left', cx:8, cy:30, r:1.2, fill: fillClr }));
  g.appendChild(mk('line', { id: id+'-upper-arm-right', x1:18, y1:17, x2:26, y2:23 }));
  g.appendChild(mk('line', { id: id+'-lower-arm-right', x1:26, y1:23, x2:28, y2:30, 'stroke-width':'1.9' }));
  g.appendChild(mk('circle', { id: id+'-hand-right', cx:28, cy:30, r:1.2, fill: fillClr }));
  // Jetpack (MD 07) — worn on the back (local left; scaleX mirrors it
  // with the facing). Hidden unless the pack is mounted. The flame is
  // re-pathed by poseJetFly while thrusting.
  const jetG = mk('g', { id: id+'-jetpack' });
  jetG.style.display = 'none';
  const jt1 = mk('rect', { x:8.2, y:15.5, width:4.6, height:11, rx:2.2, 'stroke-width':'1.5', fill:'var(--bg)' });
  const jt2 = mk('rect', { x:12.2, y:16.5, width:3.6, height:9, rx:1.8, 'stroke-width':'1.3', fill:'var(--bg)' });
  const jstrap = mk('line', { x1:13, y1:17.5, x2:18, y2:16.5, 'stroke-width':'1.2', opacity:'0.8' });
  const jflame = mk('path', { id: id+'-jet-flame', d:'', 'stroke-width':'1.2', fill:'currentColor', 'fill-opacity':'0.5' });
  jflame.style.display = 'none';
  jetG.appendChild(jflame); jetG.appendChild(jt1); jetG.appendChild(jt2); jetG.appendChild(jstrap);
  g.appendChild(jetG);
  // Bow elements (hidden when not drawing)
  const bowP = mk('path', { id:id+'-bow', d:'M0,0', 'stroke-width':'1.8', 'stroke-linecap':'round', fill:'none' });
  bowP.style.display = 'none'; g.appendChild(bowP);
  const bsL = mk('line', { id:id+'-bow-str-l', 'stroke-width':'0.8', opacity:'0.7' });
  const bsR = mk('line', { id:id+'-bow-str-r', 'stroke-width':'0.8', opacity:'0.7' });
  bsL.style.display = 'none'; bsR.style.display = 'none';
  g.appendChild(bsL); g.appendChild(bsR);

  svg.appendChild(g);
  return svg;
}

// ═══════════════════════════════════
//  FLOOR DETECTION
// ═══════════════════════════════════

function getCanvasFloorY() {
  // Platformer mode (MD 06): the base floor is the procedural ground under
  // the character, supplied by platformer.js in screen space.
  if (window._dexPlatActive && window._dexPlatFloorY) {
    const y = window._dexPlatFloorY();
    if (y != null) return y;
  }
  return window.innerHeight - 20;
}

// ── Notes-app DOM colliders: removed ──
// The character used to treat the host app's sidebar as level geometry — the
// sidebar foot was a platform, the archive header a ledge, the session-grid
// popup a solid roof, infochips in the note body were stepping stones. None of
// those elements exist in the standalone build, so every collider is
// permanently empty. These stubs keep the shape of the old API so the physics
// call sites stay untouched; world ground and building collision are
// unaffected — those come from playmode.js via getHomeScreenBounds() and
// getBuildingPolygons().
function getSbFootRect() { return null; }
function getArchiveHdrRect() { return null; }
function getSessGridRect() { return null; }

let _chipFloors = [];

// ── Platformer bridges (MD 06) ──
// platformer.js publishes its platform colliders through the existing
// priority-5 chip-floor array — the one-way / drop-through semantics
// resolveFloor already implements apply to them unchanged.
window._dexSetChipFloors = (floors) => { _chipFloors = floors || []; };
// Camera-by-shifting: when the platformer camera absorbs drift, everything
// world-owned but screen-positioned moves back by the same delta in one
// place — the character, projectiles in flight, arrows (including stuck
// ones), and session creatures. Mouse aim, muzzle math, and hit tests all
// keep working because the visible frame stays plain screen space.
window._dexPlatShiftWorld = (dx, dy) => {
  P.x -= dx; P.y -= dy;
  for (const p of _projectiles) { p.x -= dx; p.y -= dy; }
  for (const a of _arrows) {
    a.x -= dx; a.y -= dy;
    if (a._originX != null) { a._originX -= dx; a._originY -= dy; }
    // Stuck non-creature arrows stop ticking their element (same failure
    // class as the MD 06b corpse fix above) — reposition it here so they
    // hold their world spot. Creature-stuck arrows follow c.x in their tick.
    if (a.stuck && !a.stuckCreature && a.el) { a.el.style.left = a.x + 'px'; a.el.style.top = (a.y - 1) + 'px'; }
  }
  for (const c of _creatures) {
    c.x -= dx; c.y -= dy;
    if (c._fallWorldY != null) c._fallWorldY -= dy;
    // Dead/landed corpses stop ticking their element — move it here so
    // corpses stay where they died in world space (MD 06b issue 2).
    if ((c.dead || c.landed) && c.el) { c.el.style.left = c.x + 'px'; c.el.style.top = c.y + 'px'; }
  }
  // Anchored FX elements (blood puddles, gore, feathers) — see _anchorFxEl.
  for (let i = _worldFxEls.length - 1; i >= 0; i--) {
    const el = _worldFxEls[i];
    if (!el.isConnected) { _worldFxEls.splice(i, 1); continue; }
    el._wfx.x -= dx; el._wfx.y -= dy;
    el.style.left = el._wfx.x + 'px';
    el.style.top = el._wfx.y + 'px';
  }
};
// MD 06b issue 2 — the single registration point for world-anchored FX.
// The platformer camera works by shifting screen-space entities; any
// fixed-position DOM element that should live in WORLD space must pass
// through here or it will silently glue itself to the screen. All the
// blood/gore/feather emitters register; new emitters must too.
const _worldFxEls = [];
function _anchorFxEl(el, x, y) {
  el._wfx = { x, y };
  _worldFxEls.push(el);
}
// Moving-platform carry: the platform's per-frame delta applied directly.
window._dexPlatShiftChar = (dx) => { P.x += dx; };
// First-spawn free fall (MD 07-0b): the platformer keeps this fed while the
// initial drop is falling, reusing the exact drop-through mechanism crouch
// uses — one-way floors stay suppressed until touchdown, then the last
// short window expires on its own. No parallel flag.
window._dexPlatDropThrough = () => { _dropThroughUntil = Date.now() + 150; };
window._dexPlatCharPos = () => ({ x: P.x, y: P.y, grounded: P.grounded, floorType: P._resolvedFloor });

const _cachedArchR = null, _cachedFootR = null, _cachedSessR = null, _cachedAddBtnR = null;

function _updateFloorRects(frame) { /* no DOM colliders to refresh */ }

function resolveFloor() {
  const dropping = Date.now() < _dropThroughUntil;
  _updateFloorRects(_frameCount || 0);

  // Swept collision: check if character crossed through any floor since last frame
  // prevY is where feet were last frame, P.y is where they are now
  const prevY = P.y - (P.vy * _dt);
  const falling = P.vy >= 0;

  // Helper: did feet sweep through this floor's top edge?
  function swept(floorTop, tolerance) {
    // Character is at or below the floor, AND was above it last frame (or within tolerance)
    return P.y >= floorTop - tolerance && (prevY < floorTop + tolerance || P.y <= floorTop + tolerance);
  }

  // Priority 1: archive header — skipped during drop-through
  if (falling && !dropping) {
    const archR = _cachedArchR;
    if (archR) {
      const withinX = P.x >= archR.left - 4 && P.x <= archR.right + 4;
      if (withinX && swept(archR.top, 6)) {
        P.activeChip = null;
        P._resolvedFloor = 'archive';
        return archR.top;
      }
    }
  }

  // Priority 2: session grid popup — ALWAYS solid, never droppable
  if (falling) {
    const sessR = _cachedSessR;
    if (sessR) {
      const withinX = P.x >= sessR.left - 4 && P.x <= sessR.right + 4;
      if (withinX && swept(sessR.top, 10)) {
        P.activeChip = null;
        P._resolvedFloor = 'sessgrid';
        return sessR.top;
      }
    }
  }

  // Priority 3: sb-foot platform — skipped during drop-through (S/Down key)
  if (falling && !dropping) {
    const footR = _cachedFootR;
    if (footR && footR.height > 0) {
      const withinX = P.x >= footR.left - 4 && P.x <= footR.right + 4;
      if (withinX && swept(footR.top, 10)) {
        P.activeChip = null;
        P._resolvedFloor = 'sbfoot';
        return footR.top;
      }
    }
  }

  // Priority 4: New Category button — solid platform + wall
  if (falling && !dropping) {
    const addR = _cachedAddBtnR;
    if (addR) {
      const withinX = P.x >= addR.left - 4 && P.x <= addR.right + 4;
      if (withinX && swept(addR.top, 6)) {
        P.activeChip = null;
        P._resolvedFloor = 'addbtn';
        return addR.top;
      }
    }
  }

  // Priority 5: infochip tops — skipped during drop-through
  if (falling && !dropping) {
    for (const chip of _chipFloors) {
      const withinX = P.x >= chip.left - 4 && P.x <= chip.right + 4;
      if (withinX && swept(chip.top, 6)) {
        P.activeChip = chip;
        P._resolvedFloor = 'chip';
        return chip.top;
      }
    }
  }
  P.activeChip = null;
  P._resolvedFloor = 'canvas';
  return getCanvasFloorY();
}

// ═══════════════════════════════════
//  SVG HELPERS
// ═══════════════════════════════════

function _el(id) { return document.getElementById(_uid+'-'+id); }
function _setLine(id, x1,y1,x2,y2) {
  const e=_el(id); if(e){e.setAttribute('x1',x1);e.setAttribute('y1',y1);e.setAttribute('x2',x2);e.setAttribute('y2',y2);}
  // Hand dots ride the forearm ends (MD 09). Doing it here — not in the
  // poses — means gun aim and bow draw (which re-point the arms AFTER the
  // pose pass) carry the hands too, with no call-order dependence.
  if (id === 'lower-arm-left') _setCircle('hand-left', x2, y2);
  else if (id === 'lower-arm-right') _setCircle('hand-right', x2, y2);
}
function _setCircle(id, cx,cy) { const e=_el(id); if(e){e.setAttribute('cx',cx);e.setAttribute('cy',cy);} }
function _setPath(id, d) { const e=_el(id); if(e) e.setAttribute('d',d); }

// Update skirt triangle to follow body — reads current torso line position
function _syncSkirt() {
  const torso = _el('torso');
  if (!torso) return;
  const sY = parseFloat(torso.getAttribute('y1'));
  const hipY = parseFloat(torso.getAttribute('y2'));
  // Shoulder lean (MD 09): walk/jog shift the torso top in +X. Garments
  // anchor to the live shoulder line, so their tops follow the lean while
  // hems lag behind it — cloth hangs, it doesn't bolt on.
  const sX = (parseFloat(torso.getAttribute('x1')) || 18) - 18;

  // Skirt/dress triangle
  if (_cosmetics.torso === 'triangle') {
    const tri = _el('torso-tri');
    if (!tri) return;
    let hemY = Math.min(hipY + 10, 44);
    if (!P.grounded) {
      const airLift = Math.min(Math.abs(P.vy) / MAX_FALL, 1) * 6;
      hemY = Math.min(hipY + 4 - airLift, 42);
      hemY = Math.max(hemY, hipY + 2);
    }
    if (currentState === 'jump-charge' || currentState === 'charge-walk' || currentState === 'crouch-release') {
      hemY = Math.min(hemY, 42);
    }
    const isMoving = currentState === 'walk' || currentState === 'charge-walk';
    const crouchSpread = _crouchIntensity * 8; // expand outward when crouching
    const hemHalf = (isMoving ? 9.5 : (!P.grounded ? 10 : 12)) + crouchSpread;
    tri.setAttribute('points', `${18+sX},${sY} ${18-hemHalf+sX*0.3},${hemY} ${18+hemHalf+sX*0.3},${hemY}`);
  }

  // Inverted V-torso — wide at shoulders, narrows to waist
  if (_cosmetics.torso === 'vtorso') {
    const vtri = _el('torso-vtri');
    if (!vtri) return;
    const shoulderHalf = 12;
    vtri.setAttribute('points', `${18-shoulderHalf+sX},${sY} ${18+shoulderHalf+sX},${sY} 18,${hipY}`);
  }

  // Open coat (MD 05) — panels hang from the live shoulder line; hem lifts
  // slightly in the air like the other garments.
  if (_cosmetics.torso === 'coat') {
    const coat = _el('torso-coat');
    if (!coat) return;
    let hemY = 38;
    if (!P.grounded) hemY -= Math.min(Math.abs(P.vy) / MAX_FALL, 1) * 5;
    const cX = sX, hX = sX * 0.4;   // hem lags the shoulder lean
    coat.setAttribute('d',
      `M${13+cX},${sY} L${10.5+hX},${hemY} Q${13+hX},${hemY + 1} ${15.5+hX},${hemY} L${16.5+cX},${sY + 2} Z ` +
      `M${23+cX},${sY} L${25.5+hX},${hemY} Q${23+hX},${hemY + 1} ${20.5+hX},${hemY} L${19.5+cX},${sY + 2} Z`);
  }

  // Robe — tapered at shoulders, knee bulges follow leg movement
  if (_cosmetics.torso === 'robe') {
    const robe = _el('torso-robe');
    if (!robe) return;
    const isMoving = currentState === 'walk' || currentState === 'charge-walk' || currentState === 'jog';
    let hemY = 42;
    if (!P.grounded) {
      // Robe lifts substantially in air — velocity-based lag effect
      const velFactor = P.vy < 0
        ? Math.min(-P.vy / 8, 1) * 0.4   // rising: moderate lift (robe trails)
        : Math.min(P.vy / 6, 1) * 0.8 + 0.4; // falling/peak: strong lift
      const nearPeak = 1 - Math.min(Math.abs(P.vy) / 4, 1);
      const lift = Math.max(velFactor, nearPeak) * 16;
      hemY = Math.max(26, hemY - lift);
    }

    // Leg phase drives knee bulges
    const phase = runPhase || 0;
    const legSin = isMoving ? Math.sin(phase * Math.PI * 2) : 0;

    // Tapered top: narrow at shoulders, widens at hem — expands on crouch
    const crouchSpreadR = _crouchIntensity * 6;
    const topHW = 5 + crouchSpreadR * 0.3;  // shoulders widen slightly
    const botHW = 9 + crouchSpreadR;         // hem widens more

    // Knee bulge: one side pushes out where the leg is stepping forward
    const kneeY = 36; // knee height
    const kneeBulgeL = legSin > 0 ? legSin * 3 : 0;  // left knee forward
    const kneeBulgeR = legSin < 0 ? -legSin * 3 : 0;  // right knee forward
    // Hem lifts on the side where knee is pushing
    const hemLiftL = kneeBulgeL * 0.8;
    const hemLiftR = kneeBulgeR * 0.8;

    // Build path: top-left → left knee → bottom-left → bottom-right → right knee → top-right
    const lTop = 18 - topHW + sX;
    const rTop = 18 + topHW + sX;
    const lBot = 18 - botHW;
    const rBot = 18 + botHW;
    const lKneeX = lBot - kneeBulgeL * 1.2;
    const rKneeX = rBot + kneeBulgeR * 1.2;
    const hemLY = hemY - hemLiftL;
    const hemRY = hemY - hemLiftR;

    robe.setAttribute('d',
      `M${lTop},${sY}` +                                    // top-left (shoulder)
      ` Q${lTop - 1},${(sY + kneeY) / 2} ${lKneeX},${kneeY}` + // curve to left knee
      ` Q${lBot - 1},${(kneeY + hemLY) / 2} ${lBot},${hemLY}` + // curve to left hem
      ` Q${18},${Math.max(hemLY, hemRY) + 1.5} ${rBot},${hemRY}` + // bottom curve across
      ` Q${rBot + 1},${(kneeY + hemRY) / 2} ${rKneeX},${kneeY}` + // curve to right knee
      ` Q${rTop + 1},${(sY + kneeY) / 2} ${rTop},${sY}` +   // curve to top-right (shoulder)
      ` Z`
    );
  }

  // Hide the back arm behind torso ONLY when walking/jogging sideways with a volumed costume
  const hasVolume = _cosmetics.torso === 'triangle' || _cosmetics.torso === 'vtorso' || _cosmetics.torso === 'robe';
  const isWalkingSideways = (currentState === 'walk' || currentState === 'jog') && Math.abs(P.vx) > 0.1;
  const hideBackArm = hasVolume && isWalkingSideways && !_hoverboard.active;
  const ual = _el('upper-arm-left');
  const lal = _el('lower-arm-left');
  const uar = _el('upper-arm-right');
  const lar = _el('lower-arm-right');
  const hnl = _el('hand-left');
  const hnr = _el('hand-right');
  if (hideBackArm) {
    // flipX=false (facing right): SVG left arm is the back arm
    // flipX=true (facing left): SVG right arm is the back arm
    if (ual) ual.style.display = !flipX ? 'none' : '';
    if (lal) lal.style.display = !flipX ? 'none' : '';
    if (hnl) hnl.style.display = !flipX ? 'none' : '';
    if (uar) uar.style.display = flipX ? 'none' : '';
    if (lar) lar.style.display = flipX ? 'none' : '';
    if (hnr) hnr.style.display = flipX ? 'none' : '';
  } else {
    // Show both arms: idle, jumping, crouching, charging, stick figure
    if (ual) ual.style.display = '';
    if (lal) lal.style.display = '';
    if (hnl) hnl.style.display = '';
    if (uar) uar.style.display = '';
    if (lar) lar.style.display = '';
    if (hnr) hnr.style.display = '';
  }
}

// Move hat and hair groups to follow head position
// Default head position is (18, 8) — translate groups by the delta
function _syncCosmeticsToHead() {
  const head = _el('head');
  if (!head) return;
  const cx = parseFloat(head.getAttribute('cx'));
  const cy = parseFloat(head.getAttribute('cy'));
  const dx = cx - 18;
  const dy = cy - 8;
  const hat = _el('hat');
  const hair = _el('hair');
  if (hat) hat.setAttribute('transform', `translate(${dx},${dy})`);
  if (hair) hair.setAttribute('transform', `translate(${dx},${dy})`);

  // Shift bun to back of head based on facing direction
  // Bun position — works for 'long' or legacy 'bun'
  const hasBun = _cosmetics.hair === 'long' || _cosmetics.hair === 'bun';
  if (hasBun) {
    const bun = _el('bun');
    const stem = _el('bun-stem');
    if (bun) {
      // Bun on the BACK of the head — always cx=13 (left of center in SVG space).
      // scaleX(-1) handles mirroring automatically, keeping it on the back.
      const bunX = 13;
      const bunY = 3;
      bun.setAttribute('cx', bunX);
      bun.setAttribute('cy', bunY);
      if (stem) {
        stem.setAttribute('x1', bunX);
        stem.setAttribute('y1', bunY + 1);
        stem.setAttribute('x2', 18);
        stem.setAttribute('y2', 6);
      }
    }
  }

  // Cap brim visibility — hide when moving purely up/down in play mode
  const brim = _el('cap-brim');
  if (brim) {
    const isVertical = _topDownDir === 'up' || _topDownDir === 'down';
    brim.style.display = isVertical ? 'none' : '';
  }
}

// ═══════════════════════════════════
//  POSES
// ═══════════════════════════════════

function poseIdle(t) {
  // Breathing with follow-through (MD 09): the head trails the chest by a
  // beat, and the whole figure shifts weight on a slow half-rate sway —
  // feet stay planted, so it reads as standing, not drifting.
  const bob = Math.sin(t * 2.24) * 2;
  const hBob = Math.sin(t * 2.24 - 0.35) * 2;
  const sway = Math.sin(t * 1.12) * 0.5;
  const shX = 18 + sway * 0.35, hipX = 18 - sway * 0.3;
  const hY=8+hBob, sY=14+bob, hipY=30+bob*0.3;
  _setCircle('head',18+sway*0.6,hY); _setLine('torso',shX,sY,hipX,hipY);
  // Arms hang close to body, slightly bent at elbow — resting on/near skirt
  const ab=bob*0.3;
  _setLine('upper-arm-left',shX,sY,15,22+ab); _setLine('lower-arm-left',15,22+ab,14,30+ab);
  _setLine('upper-arm-right',shX,sY,21,22+ab); _setLine('lower-arm-right',21,22+ab,22,30+ab);
  const kb=Math.max(0,bob*0.6);
  _setPath('leg-left',`M${hipX},${hipY} Q${13-kb},${39+bob*0.15} 13,48`); _setCircle('foot-left',13,48);
  _setPath('leg-right',`M${hipX},${hipY} Q${23+kb},${39+bob*0.15} 23,48`); _setCircle('foot-right',23,48);
}

function poseWalk(phase) {
  // MD 09: a small forward lean (jog's 3.5 scaled down) plus a head bob
  // that trails the step by a beat — the stroll now telegraphs direction
  // and the head stops being bolted to the shoulders.
  const s=Math.sin(phase*Math.PI*2), c=Math.cos(phase*Math.PI*2), bob=Math.abs(s)*1.5;
  const lean = 1.2;
  const bobH = Math.abs(Math.sin(phase*Math.PI*2 - 0.45)) * 1.35;
  const hY=8-bobH, sY=14-bob, hipY=30-bob*0.3;
  const shX = 18 + lean;
  _setCircle('head',18+lean*1.4,hY); _setLine('torso',shX,sY,18,hipY);
  // Arms swing with elbow bend — upper arm swings from shoulder, forearm bends back
  const swing = c * 4; // shoulder swing amplitude
  // Left arm: swings forward/back, elbow bends when arm is back
  const lBend = Math.max(0, -c) * 5; // elbow bends when arm swings back
  _setLine('upper-arm-left',shX,sY, 14+swing+lean*0.4, sY+8);
  _setLine('lower-arm-left', 14+swing+lean*0.4, sY+8, 13+swing-lBend+lean*0.3, sY+15);
  // Right arm: opposite phase
  const rBend = Math.max(0, c) * 5;
  _setLine('upper-arm-right',shX,sY, 22-swing+lean*0.4, sY+8);
  _setLine('lower-arm-right', 22-swing+lean*0.4, sY+8, 23-swing+rBend+lean*0.3, sY+15);
  // Legs
  const st=s*6, lL=Math.max(0,-s)*3, lR=Math.max(0,s)*3;
  _setPath('leg-left',`M18,${hipY} Q${13+st*0.4},${38-bob*0.2} ${13+st},${48-lL}`); _setCircle('foot-left',13+st,48-lL);
  _setPath('leg-right',`M18,${hipY} Q${23-st*0.4},${38-bob*0.2} ${23-st},${48-lR}`); _setCircle('foot-right',23-st,48-lR);
}

function _hoverTiltFeet(footSpread) {
  const tiltRad = (_hoverboard.tilt || 0) * Math.PI / 180;
  return {
    tiltL: -Math.sin(tiltRad) * footSpread,
    tiltR:  Math.sin(tiltRad) * footSpread,
  };
}

function poseHoverLandAbsorb(t) {
  // t: 0→1. Hoverboard landing — deep compression, knees out, arms float up.
  const intensity = Math.min(landImpact / 9, 1);
  let crouch;
  if (t < 0.2) {
    const st = t / 0.2;
    crouch = 1 - (1 - st) * (1 - st);
  } else if (t < 0.35) {
    crouch = 1;
  } else {
    const st = (t - 0.35) / 0.65;
    const ease = st < 0.5 ? 2*st*st : 1 - (-2*st+2)*(-2*st+2)/2;
    crouch = 1 - ease;
  }
  crouch *= intensity * 0.7 + 0.3;

  const { tiltL, tiltR } = _hoverTiltFeet(7);
  const headDrop = crouch * 20;    // head drops dramatically
  const torsoDrop = crouch * 14;   // torso compresses deep
  const hipDrop = crouch * 7;

  const hY = 8 + headDrop;
  const sY = 14 + torsoDrop;
  const hipY = 30 + hipDrop;
  _setCircle('head', 18 + crouch * 1, hY); // head comes forward slightly
  _setLine('torso', 18, sY, 18, hipY);

  // Arms — float up and out as body drops (follow-through)
  const elbowOut = crouch * 8;
  const armLift = crouch * 6;
  const elbowY = sY - armLift + 2;
  const handY = elbowY - 3 - armLift * 0.3;
  _setLine('upper-arm-left', 18, sY, 8 - elbowOut, elbowY);
  _setLine('lower-arm-left', 8 - elbowOut, elbowY, 5 - elbowOut * 0.6, handY);
  _setLine('upper-arm-right', 18, sY, 28 + elbowOut, elbowY);
  _setLine('lower-arm-right', 28 + elbowOut, elbowY, 31 + elbowOut * 0.6, handY);

  // Legs — deep knee bend outward, feet planted on board
  const fLY = 48 + tiltL, fRY = 48 + tiltR;
  const kneeDrop = crouch * 12;
  const kneeOut = crouch * 5;
  const kneeY = 36 + hipDrop * 0.5 + kneeDrop;
  _setPath('leg-left', `M18,${hipY} Q${8 - kneeOut},${kneeY + tiltL * 0.3} 14,${fLY}`);
  _setCircle('foot-left', 14, fLY);
  _setPath('leg-right', `M18,${hipY} Q${28 + kneeOut},${kneeY + tiltR * 0.3} 22,${fRY}`);
  _setCircle('foot-right', 22, fRY);
}

function poseHoverCrouch(t, intensity) {
  // Crouching on hoverboard — deep body compression, head forward, arms out and down
  const kb = _hoverboard.bob * 0.3;
  const breathe = Math.sin(t * 2.24) * 0.5;
  const { tiltL, tiltR } = _hoverTiltFeet(7);
  const cr = Math.min(intensity, 0.5) * 2; // 0-1 from _crouchIntensity 0-0.5
  const drop = cr * 14;        // much deeper body drop
  const fwd = cr * 2;          // head comes forward
  const hY = 8 + drop + breathe, sY = 14 + drop * 0.85 + breathe, hipY = 32 + drop * 0.5;
  _setCircle('head', 18 + fwd, hY); _setLine('torso', 18 + fwd * 0.4, sY, 18, hipY);
  // Arms extend out and slightly down/forward
  const armOut = cr * 7;
  const armFwd = cr * 3;
  _setLine('upper-arm-left', 18, sY, 10 - armOut, sY + 3 + armFwd);
  _setLine('lower-arm-left', 10 - armOut, sY + 3 + armFwd, 6 - armOut * 0.8, sY + 8 + armFwd);
  _setLine('upper-arm-right', 18, sY, 26 + armOut, sY + 3 + armFwd);
  _setLine('lower-arm-right', 26 + armOut, sY + 3 + armFwd, 30 + armOut * 0.8, sY + 8 + armFwd);
  // Deep knee bend outward, feet on board
  const fLY = 48 + tiltL, fRY = 48 + tiltR;
  const kneeY = 37 + kb + drop * 0.4;
  const kneeOut = cr * 4;
  _setPath('leg-left', `M18,${hipY} Q${9 - kneeOut},${kneeY + tiltL * 0.3} 14,${fLY}`); _setCircle('foot-left', 14, fLY);
  _setPath('leg-right', `M18,${hipY} Q${27 + kneeOut},${kneeY + tiltR * 0.3} 22,${fRY}`); _setCircle('foot-right', 22, fRY);
}

function _poseHoverMountAir() {
  // Mid-air during hoverboard mount/dismount — arms out to sides, slightly angled down
  const hY = 6, sY = 12, hipY = 30;
  _setCircle('head', 18, hY); _setLine('torso', 18, sY, 18, hipY);
  // Arms spread out to sides, slightly below shoulder level
  _setLine('upper-arm-left', 18, sY, 6, sY + 2);
  _setLine('lower-arm-left', 6, sY + 2, 0, sY + 5);
  _setLine('upper-arm-right', 18, sY, 30, sY + 2);
  _setLine('lower-arm-right', 30, sY + 2, 36, sY + 5);
  // Legs together, slightly bent — compact airborne pose
  _setPath('leg-left', 'M18,30 Q14,38 15,46'); _setCircle('foot-left', 15, 46);
  _setPath('leg-right', 'M18,30 Q22,38 21,46'); _setCircle('foot-right', 21, 46);
}

function poseHoverIdle(t) {
  // Relaxed upright stance, gentle bob, arms at sides
  const kb = _hoverboard.bob * 0.4;
  const breathe = Math.sin(t * 2.24) * 1;
  const { tiltL, tiltR } = _hoverTiltFeet(6);
  const hY=8+breathe, sY=14+breathe, hipY=30+breathe*0.2;
  _setCircle('head',18,hY); _setLine('torso',18,sY,18,hipY);
  const ab=breathe*0.2;
  _setLine('upper-arm-left',18,sY,14,21+ab); _setLine('lower-arm-left',14,21+ab,13,29+ab);
  _setLine('upper-arm-right',18,sY,22,21+ab); _setLine('lower-arm-right',22,21+ab,23,29+ab);
  const fLY = 48 + tiltL, fRY = 48 + tiltR;
  _setPath('leg-left',`M18,${hipY} Q14,${39+kb+tiltL*0.4} 15,${fLY}`); _setCircle('foot-left',15,fLY);
  _setPath('leg-right',`M18,${hipY} Q22,${39+kb+tiltR*0.4} 21,${fRY}`); _setCircle('foot-right',21,fRY);
}

function poseHoverRide(t) {
  // Moving: moderate crouch, arms out to sides for balance, slight forward lean
  const kb = _hoverboard.bob * 0.3;
  const { tiltL, tiltR } = _hoverTiltFeet(7);
  const crouch = 4; // body drops this many px
  const lean = 2;
  const hY=8+crouch-1, sY=14+crouch, hipY=32;
  _setCircle('head',18+lean,hY); _setLine('torso',18+lean*0.4,sY,18,hipY);
  // Arms out to sides — balancing
  _setLine('upper-arm-left',18,sY,10,sY+2); _setLine('lower-arm-left',10,sY+2,5,sY+5);
  _setLine('upper-arm-right',18,sY,26,sY+2); _setLine('lower-arm-right',26,sY+2,31,sY+5);
  const fLY = 48 + tiltL, fRY = 48 + tiltR;
  const kneeL = 37 + kb + tiltL*0.4, kneeR = 37 + kb + tiltR*0.4;
  _setPath('leg-left',`M18,${hipY} Q13,${kneeL} 14,${fLY}`); _setCircle('foot-left',14,fLY);
  _setPath('leg-right',`M18,${hipY} Q23,${kneeR} 22,${fRY}`); _setCircle('foot-right',22,fRY);
}

function poseHoverBoost(t) {
  // Boost: deep crouch, very compact, arms straight out, head tucked, no bob
  const { tiltL, tiltR } = _hoverTiltFeet(7);
  const crouch = 10; // deep drop
  const lean = 4;
  const hY=8+crouch, sY=14+crouch+1, hipY=34;
  _setCircle('head', 18+lean, sY-6); _setLine('torso',18+lean*0.3,sY,18,hipY);
  // Arms straight out to sides, slightly back — wind resistance pose
  _setLine('upper-arm-left',18,sY,8,sY-1); _setLine('lower-arm-left',8,sY-1,2,sY+2);
  _setLine('upper-arm-right',18,sY,28,sY-1); _setLine('lower-arm-right',28,sY-1,34,sY+2);
  const fLY = 48 + tiltL, fRY = 48 + tiltR;
  // Deep knee bend — knees much closer to feet
  const kneeL = 40 + tiltL*0.4, kneeR = 40 + tiltR*0.4;
  _setPath('leg-left',`M18,${hipY} Q12,${kneeL} 14,${fLY}`); _setCircle('foot-left',14,fLY);
  _setPath('leg-right',`M18,${hipY} Q24,${kneeR} 22,${fRY}`); _setCircle('foot-right',22,fRY);
}

function poseHoverCharge(t, chargeRatio) {
  // Charging jump on board: body crouches down progressively, arms tense
  const { tiltL, tiltR } = _hoverTiltFeet(7);
  const crouch = 3 + chargeRatio * 10; // deeper crouch as charge builds
  const shake = chargeRatio > 0.7 ? Math.sin(t * 40) * 1.5 * chargeRatio : 0;
  const hY = 8 + crouch + shake, sY = 14 + crouch, hipY = 32 + crouch * 0.3;
  _setCircle('head', 18 + shake * 0.5, hY - 1);
  _setLine('torso', 18 + shake * 0.3, sY, 18, hipY);
  // Arms tense, pulled in tight
  _setLine('upper-arm-left', 18, sY, 12, sY + 3); _setLine('lower-arm-left', 12, sY + 3, 10, sY + 8);
  _setLine('upper-arm-right', 18, sY, 24, sY + 3); _setLine('lower-arm-right', 24, sY + 3, 26, sY + 8);
  // Deep knee bend that increases with charge
  const fLY = 48 + tiltL, fRY = 48 + tiltR;
  const kneeL = 40 + chargeRatio * 3 + tiltL * 0.4;
  const kneeR = 40 + chargeRatio * 3 + tiltR * 0.4;
  _setPath('leg-left', `M18,${hipY} Q12,${kneeL} 14,${fLY}`); _setCircle('foot-left', 14, fLY);
  _setPath('leg-right', `M18,${hipY} Q24,${kneeR} 22,${fRY}`); _setCircle('foot-right', 22, fRY);
}

function poseJog(phase) {
  const s=Math.sin(phase*Math.PI*2), c=Math.cos(phase*Math.PI*2);
  const bob=Math.abs(s)*5;
  const lean = 3.5; // forward lean in +X (SVG space = facing direction)
  const hY=8-bob, sY=14-bob, hipY=30-bob*0.5;
  // Head leans forward, hip stays planted
  _setCircle('head', 18+lean, hY-1);
  _setLine('torso', 18+lean*0.6, sY, 18, hipY);
  // Arms swing with shoulder shifted by lean
  const swing = c * 7;
  const lBend = Math.max(0, -c) * 4;
  const rBend = Math.max(0, c) * 4;
  _setLine('upper-arm-left',18+lean*0.6,sY,14+swing+lean*0.3,sY+10);
  _setLine('lower-arm-left',14+swing+lean*0.3,sY+10,13+swing-lBend+lean*0.2,sY+18);
  _setLine('upper-arm-right',18+lean*0.6,sY,22-swing+lean*0.3,sY+10);
  _setLine('lower-arm-right',22-swing+lean*0.3,sY+10,23-swing+rBend+lean*0.2,sY+18);
  // Legs — high knee lift, big stride
  const st=s*9, lL=Math.max(0,-s)*6, lR=Math.max(0,s)*6;
  _setPath('leg-left',`M18,${hipY} Q${12+st*0.5},${34-bob*0.4} ${13+st},${48-lL}`); _setCircle('foot-left',13+st,48-lL);
  _setPath('leg-right',`M18,${hipY} Q${24-st*0.5},${34-bob*0.4} ${23-st},${48-lR}`); _setCircle('foot-right',23-st,48-lR);
}

function poseChargeWalk(phase, ct) {
  const s=Math.sin(phase*Math.PI*2), c=Math.cos(phase*Math.PI*2);
  const ease=ct<0.5?2*ct*ct:1-(-2*ct+2)*(-2*ct+2)/2;
  const sink=ease*18, bob=Math.abs(s)*1.2;  // deeper sink while walking
  const trm=ct>0.9?Math.sin(Date.now()*0.08)*0.8:0;
  const hY=8-bob+sink+trm, sY=14-bob+sink*0.9+trm, hipY=30+sink*0.45;
  _setCircle('head',18,hY); _setLine('torso',18,sY,18,hipY);
  const as=c*2, spread=ease*5;
  const cwHandY = Math.min(hipY + 6 + ease * 10, 47);
  const cwMidY = sY + (cwHandY - sY) * 0.5;
  _setLine('upper-arm-left',18,sY,10+as-spread,cwMidY);
  _setLine('lower-arm-left',10+as-spread,cwMidY,8+as-spread*1.2,cwHandY);
  _setLine('upper-arm-right',18,sY,26-as+spread,cwMidY);
  _setLine('lower-arm-right',26-as+spread,cwMidY,28-as+spread*1.2,cwHandY);
  const st=s*4, bw=ease*5, lL=Math.max(0,-s)*2, lR=Math.max(0,s)*2;
  const kneeY=36+sink*0.25;
  _setPath('leg-left',`M18,${hipY} Q${11-bw+st*0.3},${kneeY} ${13+st},${48-lL}`); _setCircle('foot-left',13+st,48-lL);
  _setPath('leg-right',`M18,${hipY} Q${25+bw-st*0.3},${kneeY} ${23-st},${48-lR}`); _setCircle('foot-right',23-st,48-lR);
}

function poseJumpCharge(t) {
  const ease=t<0.5?2*t*t:1-(-2*t+2)*(-2*t+2)/2;
  const sink=ease*22;   // head drops 22 units — down near knee level at full charge
  const trm=t>0.9?Math.sin(Date.now()*0.08)*1.2:0;
  const hY=8+sink+trm, sY=14+sink*0.9+trm, hipY=30+sink*0.5;
  _setCircle('head',18,hY); _setLine('torso',18,sY,18,hipY);
  // Arms angle down with bent elbows — shorter reach, more compact
  const spread = ease * 5;
  const handY = Math.min(hipY + 4 + ease * 6, 42); // cap well above feet
  const elbowY = sY + (handY - sY) * 0.45; // elbow higher up
  const elbowOut = spread * 1.3; // elbows bow outward
  _setLine('upper-arm-left',18,sY,10-elbowOut,elbowY);
  _setLine('lower-arm-left',10-elbowOut,elbowY,12-spread,handY);
  _setLine('upper-arm-right',18,sY,26+elbowOut,elbowY);
  _setLine('lower-arm-right',26+elbowOut,elbowY,24+spread,handY);
  const bw=ease*6;
  const kneeY=36+sink*0.3;
  _setPath('leg-left',`M18,${hipY} Q${10-bw},${kneeY} 13,48`); _setCircle('foot-left',13,48);
  _setPath('leg-right',`M18,${hipY} Q${26+bw},${kneeY} 23,48`); _setCircle('foot-right',23,48);
}

function poseJumpAir(vy) {
  const peak=Math.max(0,1-Math.abs(vy)/6), rising=vy<0;
  // Elongate body when rising — head pulls up, hips drop down
  const stretch = rising ? Math.min(-vy * 0.6, 5) : 0;
  const hY=6-peak*2-stretch*0.8, sY=12-peak*2-stretch*0.4, hipY=31+stretch*0.5;
  _setCircle('head',18,hY); _setLine('torso',18,sY,18,hipY);

  if (rising) {
    // Rising — arms straight up above head, slightly apart
    const lift = Math.min(-vy * 1.2, 7);
    const upY1 = sY - 5 - lift * 0.8;
    const upY2 = sY - 10 - lift * 1.2;
    _setLine('upper-arm-left',18,sY,14,upY1); _setLine('lower-arm-left',14,upY1,12,upY2);
    _setLine('upper-arm-right',18,sY,22,upY1); _setLine('lower-arm-right',22,upY1,24,upY2);
  } else {
    // Falling — arms spread out to sides while still above head
    const fall = Math.min(vy * 1.2, 7);
    const spread = fall * 1.5;
    const upY1 = sY - 3 - fall * 0.5;
    const upY2 = sY - 6 - fall * 0.8;
    _setLine('upper-arm-left',18,sY,13-spread,upY1); _setLine('lower-arm-left',13-spread,upY1,10-spread*1.3,upY2);
    _setLine('upper-arm-right',18,sY,23+spread,upY1); _setLine('lower-arm-right',23+spread,upY1,26+spread*1.3,upY2);
  }

  // Legs extend downward when rising for elongated look
  const tk=peak*6;
  const legExt = stretch * 1.2;
  _setPath('leg-left',`M18,${hipY} Q13,${36+tk*0.5+legExt*0.3} ${14-tk*0.3},${46-tk+legExt}`); _setCircle('foot-left',14-tk*0.3,46-tk+legExt);
  _setPath('leg-right',`M18,${hipY} Q23,${36+tk*0.5+legExt*0.3} ${22+tk*0.3},${46-tk+legExt}`); _setCircle('foot-right',22+tk*0.3,46-tk+legExt);
}

function poseLandAbsorb(t) {
  // t: 0→1. First 25%: slam into deep crouch. Hold 15%. Last 60%: spring back up.
  // Impact intensity scales with landImpact (0-9)
  const intensity = Math.min(landImpact / 9, 1); // 0-1 how hard the landing
  let crouch; // 0 = standing, 1 = max crouch
  if (t < 0.25) {
    // Slam down fast (ease-out into crouch)
    const st = t / 0.25;
    crouch = 1 - (1 - st) * (1 - st);
  } else if (t < 0.4) {
    // Hold at max crouch — let the player see the squish
    crouch = 1;
  } else {
    // Spring back up slowly (ease-in-out back to standing)
    const st = (t - 0.4) / 0.6;
    const ease = st < 0.5 ? 2*st*st : 1 - (-2*st+2)*(-2*st+2)/2;
    crouch = 1 - ease;
  }
  crouch *= intensity * 0.7 + 0.3; // even light landings show noticeable crouch

  // Head drops way down — 30% more than before, nearly to hip level
  const headDrop = crouch * 20;       // was 14 — much more dramatic
  const torsoCrunch = crouch * 14;    // was 10 — more compression
  const hipDrop = crouch * 6;         // was 4 — hips sink more
  const kneeBend = crouch * 16;       // was 12 — deeper knee bend
  const armSpread = crouch * 18;      // was 14 — arms flung wider

  const hY = 8 + headDrop;
  const sY = 14 + torsoCrunch;
  const hipY = 30 + hipDrop;
  _setCircle('head', 18, hY);
  _setLine('torso', 18, sY, 18, hipY);

  // Arms swing down toward feet — elbows bow out, hands reach toward ground
  // Follow-through from arms-up (falling) to arms-down (impact)
  const elbowOut = crouch * 8;   // elbows push outward
  const handDrop = crouch * 20;  // hands swing down toward feet
  const elbowY = sY + 6 + handDrop * 0.4;  // elbows at mid-torso level, dropping
  const handY = sY + 12 + handDrop * 0.6;  // hands reach toward feet
  _setLine('upper-arm-left', 18, sY, 8 - elbowOut, elbowY);
  _setLine('lower-arm-left', 8 - elbowOut, elbowY, 12 - elbowOut * 0.3, handY);
  _setLine('upper-arm-right', 18, sY, 28 + elbowOut, elbowY);
  _setLine('lower-arm-right', 28 + elbowOut, elbowY, 24 + elbowOut * 0.3, handY);

  // Knees bend outward deeply, feet stay planted wide
  const kneeOut = kneeBend;
  const kneeY = 34 + hipDrop * 0.6 + crouch * 6;
  _setPath('leg-left', `M18,${hipY} Q${8 - kneeOut * 0.5},${kneeY} 11,48`);
  _setCircle('foot-left', 11, 48);
  _setPath('leg-right', `M18,${hipY} Q${28 + kneeOut * 0.5},${kneeY} 25,48`);
  _setCircle('foot-right', 25, 48);
}


// ── Impact poses (only used for forced stun from archive/outliner events) ──

function poseSplat(sev) {
  // Flat on the ground at feet level (y≈46-48) — body completely flattened
  const s = Math.min(sev, 3);
  const spread = 4 + s * 4;
  const groundY = 47; // at feet level
  _setCircle('head', 8, groundY - 1); // head to the left, flat on ground
  _setLine('torso', 10, groundY, 22, groundY); // torso horizontal
  // Arms splayed out flat
  _setLine('upper-arm-left', 10, groundY, 4 - spread, groundY - 1);
  _setLine('lower-arm-left', 4 - spread, groundY - 1, -2 - spread, groundY);
  _setLine('upper-arm-right', 22, groundY, 28 + spread * 0.5, groundY - 1);
  _setLine('lower-arm-right', 28 + spread * 0.5, groundY - 1, 34 + spread * 0.6, groundY);
  // Legs splayed flat
  _setPath('leg-left', `M22,${groundY} Q${26},${groundY} ${30 + spread * 0.4},${groundY}`);
  _setCircle('foot-left', 30 + spread * 0.4, groundY);
  _setPath('leg-right', `M22,${groundY} Q${28},${groundY + 1} ${32 + spread * 0.3},${groundY + 1}`);
  _setCircle('foot-right', 32 + spread * 0.3, groundY + 1);
}

function poseLaunch(t) {
  const inv = 1 - t;
  const hY = 6 * inv + 8 * t;
  _setCircle('head', 18, hY);
  _setLine('torso', 18, 12*inv+14*t, 18, 28*inv+30*t);
  const armUp = 12 * inv;
  _setLine('upper-arm-left', 18, 14, 10, 12-armUp); _setLine('lower-arm-left', 10, 12-armUp, 7, 8-armUp);
  _setLine('upper-arm-right', 18, 14, 26, 12-armUp); _setLine('lower-arm-right', 26, 12-armUp, 29, 8-armUp);
  const legTrail = 6 * inv;
  _setPath('leg-left', `M18,${28*inv+30*t} Q14,${38+legTrail} 13,${46+legTrail}`); _setCircle('foot-left', 13, 46+legTrail);
  _setPath('leg-right', `M18,${28*inv+30*t} Q22,${38+legTrail} 23,${46+legTrail}`); _setCircle('foot-right', 23, 46+legTrail);
}

function poseKnockback(t) {
  const lean = (1-t) * 8;
  _setCircle('head', 18+lean*0.5, 7); _setLine('torso', 18, 14, 18+lean*0.3, 30);
  _setLine('upper-arm-left', 18, 14, 10-lean, 20); _setLine('lower-arm-left', 10-lean, 20, 6-lean*1.3, 26);
  _setLine('upper-arm-right', 18, 14, 24-lean*0.5, 22); _setLine('lower-arm-right', 24-lean*0.5, 22, 22-lean*0.3, 28);
  _setPath('leg-left', `M18,30 Q14,39 13,48`); _setCircle('foot-left', 13, 48);
  _setPath('leg-right', `M18,30 Q22,36 24,${44+lean*0.3}`); _setCircle('foot-right', 24, 44+lean*0.3);
}

function poseGetUp(stage, t) {
  const ease = 1-(1-t)*(1-t);
  if (stage === 1) {
    const pull = ease;
    _setCircle('head', 14+pull*4, 32-pull*4);
    _setLine('torso', 16+pull*2, 30-pull*2, 20, 32-pull*1);
    _setLine('upper-arm-left',16+pull*2,30-pull*2,10,28-pull*2); _setLine('lower-arm-left',10,28-pull*2,8,32-pull*3);
    _setLine('upper-arm-right',20,32-pull*1,26,30-pull*2); _setLine('lower-arm-right',26,30-pull*2,28,34-pull*3);
    _setPath('leg-left',`M20,${32-pull} Q${16},${38-pull*4} ${14},${44-pull*6}`); _setCircle('foot-left',14,44-pull*6);
    _setPath('leg-right',`M20,${32-pull} Q${24},${36-pull*3} ${24},${42-pull*5}`); _setCircle('foot-right',24,42-pull*5);
  } else if (stage === 2) {
    const rise = ease;
    _setCircle('head', 18, 28-rise*14);
    _setLine('torso', 18, 28-rise*12, 18, 31-rise*2);
    _setLine('upper-arm-left',18,28-rise*12,12,26-rise*6); _setLine('lower-arm-left',12,26-rise*6,10,30-rise*4);
    _setLine('upper-arm-right',18,28-rise*12,24,26-rise*6); _setLine('lower-arm-right',24,26-rise*6,26,30-rise*4);
    _setPath('leg-left',`M18,${31-rise*2} Q14,${34} 13,${38+rise*10}`); _setCircle('foot-left',13,38+rise*10);
    _setPath('leg-right',`M18,${31-rise*2} Q22,${34} 23,${38+rise*10}`); _setCircle('foot-right',23,38+rise*10);
  } else {
    const rise = ease;
    const shake = Math.sin(t*Math.PI*4) * (1-t) * 2;
    _setCircle('head', 18+shake, 14-rise*6);
    _setLine('torso', 18, 16-rise*2, 18, 30);
    _setLine('upper-arm-left',18,16-rise*2,11,22); _setLine('lower-arm-left',11,22,9,29);
    _setLine('upper-arm-right',18,16-rise*2,25,22); _setLine('lower-arm-right',25,22,27,29);
    _setPath('leg-left',`M18,30 Q13,39 13,48`); _setCircle('foot-left',13,48);
    _setPath('leg-right',`M18,30 Q23,39 23,48`); _setCircle('foot-right',23,48);
  }
}

function _applyTickleOverlay() {
  if (!_tickleActive) return;
  const sway = Math.sin(_ticklePhase * 0.2) * 5;
  const headBob = Math.abs(Math.sin(_ticklePhase * 0.25)) * 3;
  const head = _el('head');
  if (head) {
    head.setAttribute('cx', parseFloat(head.getAttribute('cx')) + sway * 0.5);
    head.setAttribute('cy', parseFloat(head.getAttribute('cy')) - headBob);
  }
  const torso = _el('torso');
  if (torso) torso.setAttribute('x1', parseFloat(torso.getAttribute('x1')) + sway * 0.4);
  const ual = _el('upper-arm-left'), lal = _el('lower-arm-left');
  const uar = _el('upper-arm-right'), lar = _el('lower-arm-right');
  if (ual && lal && uar && lar && torso) {
    const sY = parseFloat(torso.getAttribute('y1') || '14');
    const hipY = parseFloat(torso.getAttribute('y2') || '30');
    const bellyY = sY + (hipY - sY) * 0.6;
    ual.setAttribute('x1', String(18 + sway * 0.4)); ual.setAttribute('y1', String(sY));
    ual.setAttribute('x2', String(8 + sway * 0.2)); ual.setAttribute('y2', String(bellyY - 2));
    lal.setAttribute('x1', String(8 + sway * 0.2)); lal.setAttribute('y1', String(bellyY - 2));
    lal.setAttribute('x2', String(14 + sway * 0.3)); lal.setAttribute('y2', String(bellyY + 2));
    uar.setAttribute('x1', String(18 + sway * 0.4)); uar.setAttribute('y1', String(sY));
    uar.setAttribute('x2', String(28 - sway * 0.2)); uar.setAttribute('y2', String(bellyY - 2));
    lar.setAttribute('x1', String(28 - sway * 0.2)); lar.setAttribute('y1', String(bellyY - 2));
    lar.setAttribute('x2', String(22 + sway * 0.3)); lar.setAttribute('y2', String(bellyY + 2));
  }
}

function poseDrag(swingAngle) {
  // swingAngle: radians from vertical, negative = left, positive = right
  const angle = Math.max(-0.8, Math.min(0.8, swingAngle));
  const sway  = angle * 14;
  const pull  = Math.abs(angle) * 3;

  // ── Raised arm — reaches straight up to grab point at SVG (18, 0) ──
  const shoulderY = 14;
  _setLine('upper-arm-right', 18, shoulderY, 18 + sway * 0.1, 6);
  _setLine('lower-arm-right', 18 + sway * 0.1, 6, 18, 0); // hand at grab point

  // ── Head hangs below grab arm ──
  const headX = 18 + sway * 0.5;
  const headY = 16 + pull;
  _setCircle('head', headX, headY);

  // ── Torso hangs below head ──
  const torsoTopY = headY + 8;
  const torsoTopX = 18 + sway * 0.4;
  const torsoBottomY = torsoTopY + 14;
  const torsoBottomX = 18 + sway * 0.2;
  _setLine('torso', torsoTopX, torsoTopY, torsoBottomX, torsoBottomY);

  // ── Free arm dangles — hangs with gravity, lags behind sway ──
  const freeElbowX = torsoTopX - 6 + sway * 0.6;
  const freeElbowY = torsoTopY + 7 + pull * 0.5;
  const freeHandX  = freeElbowX - 2 + sway * 0.8;
  const freeHandY  = freeElbowY + 8;
  _setLine('upper-arm-left', torsoTopX, torsoTopY, freeElbowX, freeElbowY);
  _setLine('lower-arm-left', freeElbowX, freeElbowY, freeHandX, freeHandY);

  // ── Legs hang down, trail behind swing direction ──
  const hipX = torsoBottomX;
  const hipY = torsoBottomY;
  const legTrail = -sway * 0.3;
  const legSpread = 4 + Math.abs(angle) * 3;

  const lKneeX = hipX - legSpread * 0.6 + legTrail;
  const lKneeY = hipY + 10;
  const lFootX = hipX - legSpread + legTrail * 1.2;
  const lFootY = hipY + 22;
  _setPath('leg-left', `M${hipX},${hipY} Q${lKneeX},${lKneeY} ${lFootX},${lFootY}`);
  _setCircle('foot-left', lFootX, lFootY);

  const rKneeX = hipX + legSpread * 0.6 + legTrail;
  const rKneeY = hipY + 11;
  const rFootX = hipX + legSpread + legTrail * 1.2;
  const rFootY = hipY + 20;
  _setPath('leg-right', `M${hipX},${hipY} Q${rKneeX},${rKneeY} ${rFootX},${rFootY}`);
  _setCircle('foot-right', rFootX, rFootY);
}

// ═══════════════════════════════════
//  TICKLE & DRAG SYSTEMS
// ═══════════════════════════════════

function _spawnCollapseEmoji() {
  if (!_charEl) return;
  const emoji = document.createElement('div');
  emoji.textContent = '😢';
  const size = 20 + Math.floor(Math.random() * 12);
  emoji.style.cssText = `position:absolute;top:-5px;left:${40 + (Math.random()-0.5)*20}%;transform:translateX(-50%) scale(0.2);font-size:${size}px;pointer-events:none;opacity:0;z-index:9999;transition:all 1.4s cubic-bezier(0.15,0.6,0.3,1);`;
  _charEl.appendChild(emoji);
  requestAnimationFrame(() => {
    emoji.style.opacity = '0.9';
    emoji.style.transform = `translateX(${(Math.random()-0.5)*30}px) scale(1)`;
    emoji.style.top = '-50px';
  });
  setTimeout(() => { emoji.style.opacity = '0'; emoji.style.top = '-80px'; }, 800);
  setTimeout(() => emoji.remove(), 2200);
}

function _spawnTickleHeart() {
  if (!_charEl) return;
  const heart = document.createElement('div');
  heart.textContent = '❤️';
  const startX = 30 + (Math.random() - 0.5) * 24;
  const size = 16 + Math.floor(Math.random() * 24);
  heart.style.cssText = `position:absolute;top:-5px;left:${startX}%;transform:translateX(-50%) scale(0.2);font-size:${size}px;pointer-events:none;opacity:0;z-index:9999;transition:all 1.4s cubic-bezier(0.15,0.6,0.3,1);`;
  _charEl.appendChild(heart);
  requestAnimationFrame(() => {
    heart.style.opacity = '0.9';
    heart.style.transform = `translateX(${(Math.random()-0.5)*40}px) scale(1)`;
    heart.style.top = '-50px';
  });
  setTimeout(() => { heart.style.opacity = '0'; heart.style.top = '-80px'; }, 800);
  setTimeout(() => heart.remove(), 2200);
}

function _tickTickle() {
  if (_drag.active) { _tickleActive = false; _tickleWarmup = 0; return; }
  if (!_tickleActive) {
    if (_tickleDecay > 0) {
      _tickleDecay -= _dt;
      if (_tickleDecay <= 0) _tickleWarmup = 0;
    }
    return;
  }
  _tickleDecay -= _dt;
  if (_tickleDecay <= 0) { _tickleActive = false; _tickleWarmup = 0; return; }
  _ticklePhase += _dt;
  _tickleHeartTimer -= _dt;
  if (_tickleHeartTimer <= 0) {
    _spawnTickleHeart();
    _tickleHeartTimer = 60;
  }
}

function _startDrag(e) {
  if (_drag.active) return;
  if (_isPlayModeFn && _isPlayModeFn()) return;
  _drag.active = true;
  window._dexCharDragging = true;
  _drag.mouseX = e.clientX;
  _drag.mouseY = e.clientY;
  _drag.bodyVX = P.vx * 0.3;
  _drag.bodyVY = Math.max(0, P.vy * 0.3);
  _drag.swingAngle = 0;
  _drag._prevMX = e.clientX;
  _drag._prevMY = e.clientY;
  _drag._smoothVX = 0;
  _drag._smoothVY = 0;
  // Body starts directly below grab point
  P.x = e.clientX;
  P.y = e.clientY + 50;
  P.grounded = false;
  P.vx = 0;
  P.vy = 0;
  currentState = 'dragged';
  if (_overlay) _overlay.style.zIndex = '99999';
  document.body.style.cursor = 'grabbing';
}

function _onDragMove(e) {
  if (!_drag.active) return;
  _drag.mouseX = e.clientX;
  _drag.mouseY = e.clientY;
}

function _endDrag() {
  if (!_drag.active) return;
  document.body.style.cursor = '';
  _drag.active = false;
  setTimeout(() => { window._dexCharDragging = false; }, 50);
  _drag._dropY = P.y;
  // Combine body swing velocity with mouse throw velocity for a natural fling
  const mouseVX=_drag._smoothVX||0;
  const mouseVY=_drag._smoothVY||0;
  const throwVX=_drag.bodyVX*0.5+mouseVX*1.2;
  const throwVY=_drag.bodyVY*0.5+mouseVY*1.2;
  P.vx=Math.max(-18,Math.min(18,throwVX));
  P.vy=Math.max(-14,Math.min(8,throwVY));
  P.grounded = false;
  P.fallTimer = 0;
  const floorY = getCanvasFloorY();
  const dropDist = floorY - P.y;
  if (dropDist > window.innerHeight * 0.3) {
    _forcedStunSeverity = 2;
    _dragDropStun = true;
  }
  currentState = 'jump-air';
  if (_overlay) _overlay.style.zIndex = '150';

  // Only snap to a floor if dropped very close to it (within 12px).
  // Otherwise let the character fall naturally — resolveFloor() swept collision will catch them.
  _updateFloorRects(_frameCount || 0);
  const _snapToFloor = _findFloorBelow(P.x, P.y);
  if (_snapToFloor && Math.abs(P.y - _snapToFloor.y) < 12) {
    P.y = _snapToFloor.y;
    P.vy = 0;
    P.grounded = true;
    P.floorType = _snapToFloor.type;
    P.activeChip = _snapToFloor.chip || null;
  }
}

// Find the first solid floor at or below a given position (used after drag release)
function _findFloorBelow(px, py) {
  const candidates = [];
  // Archive header
  const archR = _cachedArchR;
  if (archR) {
    const withinX = px >= archR.left - 4 && px <= archR.right + 4;
    // Accept any drop position above or on the header (within its vertical extent)
    if (withinX && py <= archR.bottom + 4) {
      candidates.push({ y: archR.top, type: 'archive', floorY: archR.top });
    }
  }
  // Session grid
  const sessR = _cachedSessR;
  if (sessR) {
    const withinX = px >= sessR.left - 4 && px <= sessR.right + 4;
    if (withinX && py <= sessR.bottom + 4) {
      candidates.push({ y: sessR.top, type: 'sessgrid', floorY: sessR.top });
    }
  }
  // Sb-foot
  const footR = _cachedFootR;
  if (footR && footR.height > 0) {
    const withinX = px >= footR.left - 4 && px <= footR.right + 4;
    if (withinX && py <= footR.bottom + 4) {
      candidates.push({ y: footR.top, type: 'sbfoot', floorY: footR.top });
    }
  }
  // Infochips
  for (const chip of _chipFloors) {
    const withinX = px >= chip.left - 4 && px <= chip.right + 4;
    if (withinX && py <= chip.bottom + 4) {
      candidates.push({ y: chip.top, type: 'chip', chip, floorY: chip.top });
    }
  }
  if (candidates.length === 0) return null;
  // Pick the first floor BELOW the drop point (closest floor the character would land on)
  // Filter to floors at or below the drop position, then pick the highest one (first hit)
  const below = candidates.filter(c => c.floorY >= py - 8);
  if (below.length > 0) {
    below.sort((a, b) => a.floorY - b.floorY); // highest (closest to drop) first
    return below[0];
  }
  // All floors are above the drop point — pick the closest one above
  candidates.sort((a, b) => b.floorY - a.floorY);
  return candidates[0];
}

function _tickDrag() {
  if (!_drag.active) return;
  const grabX = _drag.mouseX;
  const grabY = _drag.mouseY;
  const ROPE_LEN = 50;

  // Smooth mouse velocity for whip effect
  const rawDX = grabX - (_drag._prevMX || grabX);
  const rawDY = grabY - (_drag._prevMY || grabY);
  _drag._prevMX = grabX;
  _drag._prevMY = grabY;
  _drag._smoothVX = (_drag._smoothVX || 0) * 0.6 + rawDX * 0.4;
  _drag._smoothVY = (_drag._smoothVY || 0) * 0.6 + rawDY * 0.4;

  // Pendulum: body swings around grab point
  const dx = P.x - grabX;

  // Gravity
  _drag.bodyVY += 0.5 * _dt;
  // Restore force (pendulum)
  _drag.bodyVX += -dx * 0.05 * _dt;
  // Mouse whip effect (smoothed)
  _drag.bodyVX += _drag._smoothVX * 0.18 * _dt;
  _drag.bodyVY += _drag._smoothVY * 0.06 * _dt;
  // Air damping
  _drag.bodyVX *= Math.pow(0.92, _dt);
  _drag.bodyVY *= Math.pow(0.92, _dt);

  P.x += _drag.bodyVX * _dt;
  P.y += _drag.bodyVY * _dt;

  // Constrain to rope length
  const ddx = P.x - grabX;
  const ddy = P.y - grabY;
  const dist = Math.sqrt(ddx * ddx + ddy * ddy);
  if (dist > ROPE_LEN) {
    const nx = ddx / dist, ny = ddy / dist;
    P.x = grabX + nx * ROPE_LEN;
    P.y = grabY + ny * ROPE_LEN;
    // Cancel outward velocity (inelastic rope)
    const dotV = _drag.bodyVX * nx + _drag.bodyVY * ny;
    if (dotV > 0) {
      _drag.bodyVX -= dotV * nx * 0.8;
      _drag.bodyVY -= dotV * ny * 0.8;
    }
  }
  // Body can't go above grab point
  if (P.y < grabY + 8) {
    P.y = grabY + 8;
    if (_drag.bodyVY < 0) _drag.bodyVY *= -0.3;
  }

  // Swing angle from vertical
  _drag.swingAngle = Math.atan2(P.x - grabX, P.y - grabY);
}

// ═══════════════════════════════════
//  TOP-DOWN POSES (play mode)
// ═══════════════════════════════════

function _getTopDownDir(wU, wD, wL, wR) {
  if (!wU && !wD && !wL && !wR) return 'idle';
  if (wU && wR) return 'up-right';
  if (wU && wL) return 'up-left';
  if (wD && wR) return 'down-right';
  if (wD && wL) return 'down-left';
  if (wU) return 'up';
  if (wD) return 'down';
  if (wR) return 'right';
  if (wL) return 'left';
  return 'idle';
}

function _getTopDownScale(dir) {
  if (dir === 'up' || dir === 'up-right' || dir === 'up-left') return 0.975;
  if (dir === 'down' || dir === 'down-right' || dir === 'down-left') return 1.025;
  return 1.0;
}

function poseWalkAway(phase) {
  const s = Math.sin(phase * Math.PI * 2), c = Math.cos(phase * Math.PI * 2);
  const bob = Math.abs(s) * 2.5;
  const headY = 8 - bob;
  _setCircle('head', 18, headY);

  const sY = 14 - bob, hipY = 30 - bob * 0.3;
  _setLine('torso', 18, sY, 18, hipY);
  // Arms swing
  const armZ = s * 3;
  _setLine('upper-arm-left',18,sY,12,sY+7-armZ*0.5); _setLine('lower-arm-left',12,sY+7-armZ*0.5,11,sY+14-armZ);
  _setLine('upper-arm-right',18,sY,24,sY+7+armZ*0.5); _setLine('lower-arm-right',24,sY+7+armZ*0.5,25,sY+14+armZ);
  // Legs — knees pop out to sides, feet lift on each step
  const lKneeOut = Math.max(0, -s) * 6; // left knee pops out when left leg steps
  const rKneeOut = Math.max(0, s) * 6;  // right knee pops out when right leg steps
  const lLift = Math.max(0, -s) * 5;    // left foot lifts
  const rLift = Math.max(0, s) * 5;     // right foot lifts
  const lFx = 14 - lKneeOut * 0.3, lFy = 48 - lLift;
  const rFx = 22 + rKneeOut * 0.3, rFy = 48 - rLift;
  const lKx = 14 - lKneeOut, lKy = hipY + 8 - lLift * 0.3;
  const rKx = 22 + rKneeOut, rKy = hipY + 8 - rLift * 0.3;
  _setPath('leg-left', `M18,${hipY} Q${lKx},${lKy} ${lFx},${lFy}`); _setCircle('foot-left', lFx, lFy);
  _setPath('leg-right', `M18,${hipY} Q${rKx},${rKy} ${rFx},${rFy}`); _setCircle('foot-right', rFx, rFy);
}

function poseWalkToward(phase) {
  const s = Math.sin(phase * Math.PI * 2), c = Math.cos(phase * Math.PI * 2);
  const bob = Math.abs(s) * 2.5;
  const headY = 8 - bob;
  _setCircle('head', 18, headY);
   const sY = 14 - bob, hipY = 30 - bob * 0.3;
  _setLine('torso', 18, sY, 18, hipY);
  const armZ = s * 3.5;
  _setLine('upper-arm-left',18,sY,12,sY+7-armZ*0.5); _setLine('lower-arm-left',12,sY+7-armZ*0.5,11,sY+14-armZ);
  _setLine('upper-arm-right',18,sY,24,sY+7+armZ*0.5); _setLine('lower-arm-right',24,sY+7+armZ*0.5,25,sY+14+armZ);
  // Legs — knees pop out wider, feet lift higher on each step
  const lKneeOut = Math.max(0, -s) * 7;
  const rKneeOut = Math.max(0, s) * 7;
  const lLift = Math.max(0, -s) * 6;
  const rLift = Math.max(0, s) * 6;
  const lFx = 14 - lKneeOut * 0.3, lFy = 48 - lLift;
  const rFx = 22 + rKneeOut * 0.3, rFy = 48 - rLift;
  const lKx = 14 - lKneeOut, lKy = hipY + 8 - lLift * 0.4;
  const rKx = 22 + rKneeOut, rKy = hipY + 8 - rLift * 0.4;
  _setPath('leg-left', `M18,${hipY} Q${lKx},${lKy} ${lFx},${lFy}`); _setCircle('foot-left', lFx, lFy);
  _setPath('leg-right', `M18,${hipY} Q${rKx},${rKy} ${rFx},${rFy}`); _setCircle('foot-right', rFx, rFy);
}

// ═══════════════════════════════════
//  COSMETICS — hat, hair, torso
// ═══════════════════════════════════

const ns = 'http://www.w3.org/2000/svg';
function _mkSvg(tag, attrs) { const el = document.createElementNS(ns, tag); for (const [k,v] of Object.entries(attrs)) el.setAttribute(k, v); return el; }

function applyCosmetics(uid, cos) {
  applyTorso(uid, cos.torso);
  applyHat(uid, cos.hat);
  applyHair(uid, cos.hair);
}

function applyTorso(uid, torso) {
  const spine = document.getElementById(`${uid}-torso`);
  const tri = document.getElementById(`${uid}-torso-tri`);
  const vtri = document.getElementById(`${uid}-torso-vtri`);
  const robe = document.getElementById(`${uid}-torso-robe`);
  const coat = document.getElementById(`${uid}-torso-coat`);
  // Hide all first
  if (spine) spine.style.display = 'none';
  if (tri) tri.style.display = 'none';
  if (vtri) vtri.style.display = 'none';
  if (robe) robe.style.display = 'none';
  if (coat) coat.style.display = 'none';
  // Show the selected one
  if (torso === 'triangle') { if (tri) tri.style.display = ''; }
  else if (torso === 'vtorso') { if (vtri) vtri.style.display = ''; }
  else if (torso === 'robe') { if (robe) robe.style.display = ''; }
  else if (torso === 'coat') {
    // Open coat — the spine stays visible between the panels.
    if (coat) coat.style.display = '';
    if (spine) spine.style.display = '';
  }
  else { if (spine) spine.style.display = ''; }
}

function applyHat(uid, hat) {
  const g = document.getElementById(`${uid}-hat`);
  if (!g) return;
  g.innerHTML = '';
  if (hat === 'none') return;
  const clr = 'inherit'; // inherits from parent <g> which has correct color
  if (hat === 'cap_forward') {
    g.appendChild(_mkSvg('path', { d:'M12,6 Q18,2 24,6', stroke:clr, 'stroke-width':'1.6', fill:'none' }));
    g.appendChild(_mkSvg('line', { id:`${uid}-cap-brim`, x1:24, y1:6, x2:30, y2:7, stroke:clr, 'stroke-width':'1.6', 'stroke-linecap':'round' }));
  } else if (hat === 'cap_back') {
    g.appendChild(_mkSvg('path', { d:'M12,6 Q18,2 24,6', stroke:clr, 'stroke-width':'1.6', fill:'none' }));
    g.appendChild(_mkSvg('line', { id:`${uid}-cap-brim`, x1:12, y1:6, x2:6, y2:7, stroke:clr, 'stroke-width':'1.6', 'stroke-linecap':'round' }));
  } else if (hat === 'cowboy' || hat === 'basic') {
    // MD#HAT-OVERHAUL: 'basic' is now the cowboy hat shape (label "Basic").
    // Legacy 'cowboy' continues to render correctly for any users with it saved.
    g.appendChild(_mkSvg('rect', { x:14, y:1, width:8, height:4, rx:1.5, stroke:clr, 'stroke-width':'1.4', fill:'none' }));
    g.appendChild(_mkSvg('path', { d:'M6,6 Q8,4.5 14,5 L22,5 Q28,4.5 30,6', stroke:clr, 'stroke-width':'1.6', fill:'none', 'stroke-linecap':'round' }));
  } else if (hat === 'tophat') {
    // Tall rectangular crown + wide brim
    g.appendChild(_mkSvg('rect', { x:12, y:-6, width:12, height:12, rx:1, stroke:clr, 'stroke-width':'1.6', fill:'var(--bg)' }));
    g.appendChild(_mkSvg('line', { x1:8, y1:6, x2:28, y2:6, stroke:clr, 'stroke-width':'2', 'stroke-linecap':'round' }));
  } else if (hat === 'knight' || hat === 'viking') {
    // Helmet dome covering the head
    g.appendChild(_mkSvg('path', { d:'M10,6 L10,1 Q18,-3 26,1 L26,6', stroke:clr, 'stroke-width':'1.6', fill:'var(--bg)' }));
    // Visor slit
    g.appendChild(_mkSvg('line', { x1:14, y1:6, x2:22, y2:6, stroke:clr, 'stroke-width':'1' }));
    // Left horn — proper S-curve: emerges from helmet base, sweeps outward+down, then curves back up to a tip
    // Filled with solid color for weight. Drawn as a closed shape (outer arc + inner arc).
    g.appendChild(_mkSvg('path', {
      id: `${uid}-horn-left`,
      d: 'M10,2 C6,3 2,2 0,-2 C-1,-5 1,-7 4,-6 C2,-5 1,-3 2,-1 C4,1 7,1 10,0 Z',
      stroke: clr, 'stroke-width': '1.4', fill: 'currentColor', 'fill-opacity': '0.85', 'stroke-linejoin': 'round'
    }));
    // Right horn — mirror of left
    g.appendChild(_mkSvg('path', {
      id: `${uid}-horn-right`,
      d: 'M26,2 C30,3 34,2 36,-2 C37,-5 35,-7 32,-6 C34,-5 35,-3 34,-1 C32,1 29,1 26,0 Z',
      stroke: clr, 'stroke-width': '1.4', fill: 'currentColor', 'fill-opacity': '0.85', 'stroke-linejoin': 'round'
    }));
  } else if (hat === 'beanie') {
    // MD#HAT-OVERHAUL: beanie now arches across the head instead of a flat
    // line at the bottom. Replaces the bottom line with a Q-curve that
    // dips slightly upward at the temples and follows the top of the head.
    g.appendChild(_mkSvg('path', { d:'M10,6 Q10,-1 18,-1 Q26,-1 26,6', stroke:clr, 'stroke-width':'1.6', fill:'var(--bg)', 'stroke-linejoin':'round' }));
    g.appendChild(_mkSvg('path', { d:'M9,6 Q18,9 27,6', stroke:clr, 'stroke-width':'1.4', fill:'none', 'stroke-linejoin':'round' }));
    g.appendChild(_mkSvg('circle', { cx:18, cy:-2, r:1.5, stroke:clr, 'stroke-width':'1.2', fill:'none' }));
  } else if (hat === 'wizard') {
    // Tall pointed cone with brim and star tip
    g.appendChild(_mkSvg('path', { d:'M10,6 L18,-8 L26,6', stroke:clr, 'stroke-width':'1.6', fill:'var(--bg)', 'stroke-linejoin':'round' }));
    // Wide brim
    g.appendChild(_mkSvg('line', { x1:6, y1:6, x2:30, y2:6, stroke:clr, 'stroke-width':'2', 'stroke-linecap':'round' }));
    // Star at tip
    g.appendChild(_mkSvg('circle', { cx:18, cy:-8, r:1.5, stroke:clr, 'stroke-width':'1', fill:'none' }));
    // Slight bend in the cone (droopy tip)
    g.appendChild(_mkSvg('path', { d:'M18,-8 Q22,-10 24,-7', stroke:clr, 'stroke-width':'1.2', fill:'none', 'stroke-linecap':'round' }));
  } else if (hat === 'crown') {
    // MD 05: three-point crown, filled for weight like the viking horns
    g.appendChild(_mkSvg('path', { d:'M12,5 L12,-1 L15,2 L18,-2.5 L21,2 L24,-1 L24,5 Z', stroke:clr, 'stroke-width':'1.4', fill:'var(--char-clr,var(--clr-adj,#7B8A9C))', 'fill-opacity':'0.85', 'stroke-linejoin':'round' }));
  } else if (hat === 'halo') {
    // MD 05: a ring floating above the head — bobbed gently by _syncCosmeticsToHead's
    // existing head tracking (it rides the hat group, no extra animation needed).
    g.appendChild(_mkSvg('ellipse', { cx:18, cy:-4.5, rx:6, ry:1.8, stroke:clr, 'stroke-width':'1.6', fill:'none', opacity:'0.9' }));
  } else if (hat === 'headphones') {
    // MD 05: band over the crown + two filled ear cups
    g.appendChild(_mkSvg('path', { d:'M10,7 Q18,-4 26,7', stroke:clr, 'stroke-width':'1.6', fill:'none' }));
    g.appendChild(_mkSvg('rect', { x:8.6, y:5, width:3.2, height:6.5, rx:1.6, stroke:clr, 'stroke-width':'1.3', fill:'var(--char-clr,var(--clr-adj,#7B8A9C))', 'fill-opacity':'0.85' }));
    g.appendChild(_mkSvg('rect', { x:24.2, y:5, width:3.2, height:6.5, rx:1.6, stroke:clr, 'stroke-width':'1.3', fill:'var(--char-clr,var(--clr-adj,#7B8A9C))', 'fill-opacity':'0.85' }));
  }
}

function applyHair(uid, hair) {
  const g = document.getElementById(`${uid}-hair`);
  if (!g) return;
  g.innerHTML = '';
  const clr = 'inherit';
  if (hair === 'none') return;
  // Legacy migrations
  if (hair === 'bun') { hair = 'long'; }
  if (hair === 'spiky') { hair = 'short'; }
  if (hair === 'short') {
    // Real short male hairstyle — covers crown, drops slightly over forehead, squared at sides
    g.appendChild(_mkSvg('path', { d:'M11,8 Q11,2 18,2 Q25,2 25,8 L25,11 L23,11 L23,9 Q23,5 18,5 Q13,5 13,9 L13,11 L11,11 Z', stroke:clr, 'stroke-width':'1.4', fill:'currentColor', 'fill-opacity':'0.18', 'stroke-linejoin':'round' }));
    // Texture lines suggesting strands
    g.appendChild(_mkSvg('path', { d:'M14,4.5 L14.5,7', stroke:clr, 'stroke-width':'1', 'stroke-linecap':'round', opacity:'0.7' }));
    g.appendChild(_mkSvg('path', { d:'M18,3.5 L18,6', stroke:clr, 'stroke-width':'1', 'stroke-linecap':'round', opacity:'0.7' }));
    g.appendChild(_mkSvg('path', { d:'M22,4.5 L21.5,7', stroke:clr, 'stroke-width':'1', 'stroke-linecap':'round', opacity:'0.7' }));
    return;
  }
  if (hair === 'ponytail') {
    // MD 05: cap arc, a tie at the back (left in local space — scaleX
    // mirrors it with the facing), and a tail strand animated by
    // updateLongHairFlow like the long-hair strands.
    g.appendChild(_mkSvg('path', { d:'M12,8 Q18,2 24,8', stroke:clr, 'stroke-width':'1.6', fill:'none', 'stroke-linecap':'round' }));
    g.appendChild(_mkSvg('circle', { cx:12, cy:8.5, r:1.3, stroke:clr, 'stroke-width':'1.2', fill:'currentColor', 'fill-opacity':'0.6' }));
    g.appendChild(_mkSvg('path', { id:`${uid}-hair-tail`, d:'M12,9 C8,14 7,20 9,27', stroke:clr, 'stroke-width':'1.5', fill:'none', 'stroke-linecap':'round' }));
    return;
  }
  if (hair === 'curly') {
    // MD 05: a cloud of curls hugging the crown — arcs only, faint fill.
    const curls = [[11, 5, 2.4], [14.5, 2.2, 2.6], [18, 1.2, 2.7], [21.5, 2.2, 2.6], [25, 5, 2.4], [9.8, 8, 2.0], [26.2, 8, 2.0]];
    for (const [cx, cy, r] of curls) {
      g.appendChild(_mkSvg('circle', { cx, cy, r, stroke:clr, 'stroke-width':'1.3', fill:'currentColor', 'fill-opacity':'0.12' }));
    }
    return;
  }
  if (hair === 'medium' || hair === 'long') {
    // Bun-style top knot only on long
    if (hair === 'long') {
      g.appendChild(_mkSvg('circle', { id:`${uid}-bun`, cx:18, cy:1, r:3, stroke:clr, 'stroke-width':'1.4', fill:'none' }));
      g.appendChild(_mkSvg('line', { id:`${uid}-bun-stem`, x1:18, y1:2, x2:18, y2:4, stroke:clr, 'stroke-width':'1.2', 'stroke-linecap':'round' }));
    } else {
      // Medium: just the cap-of-hair arc on top
      g.appendChild(_mkSvg('path', { d:'M12,8 Q18,2 24,8', stroke:clr, 'stroke-width':'1.6', fill:'none', 'stroke-linecap':'round' }));
    }
    // Outer flowing strands (animated by updateLongHairFlow)
    g.appendChild(_mkSvg('path', { id:`${uid}-hair-left`, d:'M13,10 C10,18 10,22 12,30', stroke:clr, 'stroke-width':'1.4', fill:'none', 'stroke-linecap':'round' }));
    g.appendChild(_mkSvg('path', { id:`${uid}-hair-right`, d:'M23,10 C26,18 26,22 24,30', stroke:clr, 'stroke-width':'1.4', fill:'none', 'stroke-linecap':'round' }));
    // Long gets EXTRA strands for fuller feel
    if (hair === 'long') {
      g.appendChild(_mkSvg('path', { id:`${uid}-hair-left2`, d:'M15,10 C13,18 13,22 14,30', stroke:clr, 'stroke-width':'1.2', fill:'none', 'stroke-linecap':'round' }));
      g.appendChild(_mkSvg('path', { id:`${uid}-hair-right2`, d:'M21,10 C23,18 23,22 22,30', stroke:clr, 'stroke-width':'1.2', fill:'none', 'stroke-linecap':'round' }));
    }
  }
}

function updateLongHairFlow(uid) {
  const h = _cosmetics.hair;
  // MD 05: the ponytail's single tail rides the same flow state as the
  // long-hair strands — wind trail, wave, fall lift.
  if (h === 'ponytail') {
    const tail = document.getElementById(`${uid}-hair-tail`);
    if (!tail) return;
    const speed = Math.abs(P.vx);
    _hairFlow.target = Math.min(speed / WALK_SPEED, 1) * 14 * -1;
    _hairFlow.offset += (_hairFlow.target - _hairFlow.offset) * 0.10 * _dt;
    const f = _hairFlow.offset;
    const waveSpeed = 0.08 + speed * 0.06;
    const waveAmp = speed > 0.3 ? 2.5 + speed * 1.5 : 0.8;
    _hairFlow.waveT += waveSpeed * _dt;
    const wt = _hairFlow.waveT;
    const wMid = Math.sin(wt - 0.6) * waveAmp * 0.7;
    const wTip = Math.sin(wt - 1.2) * waveAmp;
    const fallLift = !P.grounded && P.vy > 0 ? Math.min(P.vy / MAX_FALL, 1) : 0;
    const liftY = fallLift * -14, liftCP = fallLift * -7;
    tail.setAttribute('d', `M12,9 C${8 + f * 0.5 + wMid * 0.5},${14 + liftCP} ${7 + f * 0.8 + wMid},${20 + liftCP} ${9 + f + wTip},${27 + liftY}`);
    return;
  }
  if (h !== 'long' && h !== 'medium' && h !== 'bun') return;
  const leftS = document.getElementById(`${uid}-hair-left`);
  const rightS = document.getElementById(`${uid}-hair-right`);
  if (!leftS || !rightS) return;
  const isLong = (h === 'long' || h === 'bun');
  const leftS2 = isLong ? document.getElementById(`${uid}-hair-left2`) : null;
  const rightS2 = isLong ? document.getElementById(`${uid}-hair-right2`) : null;
  // Medium drops shorter than long
  const dropY = isLong ? 30 : 22;

  // Wind trail — hair streams behind the character
  const speed = Math.abs(P.vx);
  const maxTrail = 14;
  const trail = Math.min(speed / WALK_SPEED, 1) * maxTrail;
  _hairFlow.target = trail * -1; // always trails left in SVG local space (scaleX handles flip)
  _hairFlow.offset += (_hairFlow.target - _hairFlow.offset) * 0.10 * _dt;
  const f = _hairFlow.offset;

  // Sine wave down the strand — faster/bigger when moving
  const waveSpeed = 0.08 + speed * 0.06;
  const waveAmp = speed > 0.3 ? 2.5 + speed * 1.5 : 0.8;
  _hairFlow.waveT += waveSpeed * _dt;
  const wt = _hairFlow.waveT;
  const wTop = Math.sin(wt) * waveAmp * 0.3;
  const wMid = Math.sin(wt - 0.6) * waveAmp * 0.7;
  const wTip = Math.sin(wt - 1.2) * waveAmp;

  // Fall lift
  const fallLift = !P.grounded && P.vy > 0 ? Math.min(P.vy / MAX_FALL, 1) : 0;
  const liftY = fallLift * -16;
  const liftCP = fallLift * -8;

  // Outer strands
  leftS.setAttribute('d', `M13,10 C${13+f*0.5+wTop},${18+liftCP} ${13+f*0.8+wMid},${24+liftCP*1.2} ${13+f+wTip},${dropY+liftY}`);
  rightS.setAttribute('d', `M23,10 C${23+f*0.5-wTop},${18+liftCP} ${23+f*0.8-wMid},${24+liftCP*1.2} ${23+f-wTip},${dropY+liftY}`);
  // Inner strands (long only) — slightly less amplitude so they don't overlap exactly
  if (leftS2 && rightS2) {
    const wTop2 = wTop * 0.7, wMid2 = wMid * 0.7, wTip2 = wTip * 0.7;
    leftS2.setAttribute('d', `M15,10 C${15+f*0.4+wTop2},${18+liftCP} ${15+f*0.7+wMid2},${24+liftCP*1.2} ${15+f*0.85+wTip2},${dropY+liftY}`);
    rightS2.setAttribute('d', `M21,10 C${21+f*0.4-wTop2},${18+liftCP} ${21+f*0.7-wMid2},${24+liftCP*1.2} ${21+f*0.85-wTip2},${dropY+liftY}`);
  }
}

function updateVikingHornSideView(uid) {
  if (_cosmetics.hat !== 'viking' && _cosmetics.hat !== 'knight') return;
  const leftH = document.getElementById(`${uid}-horn-left`);
  const rightH = document.getElementById(`${uid}-horn-right`);
  if (!leftH || !rightH) return;
  // When moving L/R, both horns translate toward center to overlap as a side-view profile.
  // When stationary or vertical-only, horns return to default outward position.
  const speed = Math.abs(P.vx);
  const blend = Math.min(speed / WALK_SPEED, 1); // 0 = forward view, 1 = side view
  // Each horn's default x-center: left ~5, right ~31. Center ~18. Translate toward 18.
  const leftShift = blend * 13;   // 0 → +13 (5 → 18)
  const rightShift = blend * -13; // 0 → -13 (31 → 18)
  leftH.setAttribute('transform', `translate(${leftShift}, 0)`);
  rightH.setAttribute('transform', `translate(${rightShift}, 0)`);
}

async function _loadCosmetics() {
  const saved = loadCosmetics();
  if (saved) Object.assign(_cosmetics, saved);
}

async function _saveCosmetics() {
  saveCosmetics(_cosmetics);
}

function _initCosmeticsUI() {
  // The notes-app account dropdown (session / people / avatar / suggestions
  // rows) that used to host this is gone, along with its collapse/expand
  // machinery. The DXAV customizer below is re-homed into #dxav-panel and
  // opened in-game with C or the HUD gear button — see _initDxavPanel().

  // ─────────── DXAV (Avatar Redesign) renderer ───────────
  // State for the dxav UI. _cosmetics + _hotbar remain authoritative; this is presentation only.
  const PAGE_SIZE = 4;
  if (!window._dxavState) {
    // MD 10 (issue 7): the panel is cosmetics-only — no tab field, no eq
    // page state. Inventory lives in the backpack (5), where it belongs.
    window._dxavState = {
      focus: 'body',
      activeSlot: 1,
      pages: { body: 0, hat: 0, hair: 0 }
    };
  }
  const _dxav = window._dxavState;

  // Reuse existing INVENTORY_ITEMS for equip data; prepend a synthetic "none" entry.
  const _dxavNoneItem = { id: 'none', label: 'None', noneIcon: true, functional: true };
  const _dxavEquipItems = [_dxavNoneItem].concat(INVENTORY_ITEMS);
  // Per-slot allowlist (display order). Items not listed never appear in that slot.
  // MD#SPELLBOOK-SLOT-4: spellbook moved from slot 3 to slot 4 per user
  // request. Slot 4 now holds mobility/utility items (hoverboard, spellbook,
  // flag).
  const _dxavSlotItems = {
    1: ['none', 'bow', 'sword'],
    2: ['none', 'pistol', 'shotgun', 'smg', 'rifle'],
    3: ['none', 'rocket', 'pufferLauncher', 'laser'],
    4: ['none', 'hoverboard', 'jetpack', 'spellbook', 'checkpointFlag']
  };
  function _dxavGetSlotItems(slot) {
    const ids = _dxavSlotItems[slot] || ['none'];
    return ids.map(id => id === 'none' ? _dxavNoneItem : INVENTORY_ITEMS.find(it => it.id === id)).filter(Boolean);
  }
  // One-time migration: wipe any illegal items currently in slots.
  // MD#SPELLBOOK-SLOT-4: bumped the migration version key to 'v2' so the
  // migration re-runs once for users who already migrated under v1 — they
  // may have spellbook stuck in slot 3 (its old location).
  (function _dxavMigrateHotbar(){
    if (window._dxavHotbarMigratedV2) return;
    window._dxavHotbarMigratedV2 = true;
    let changed = false;
    for (let s = 1; s <= 4; s++) {
      const cur = _hotbar[s];
      if (cur && !_dxavSlotItems[s].includes(cur)) {
        _hotbar[s] = null;
        changed = true;
      }
    }
    if (changed && typeof _saveHotbar === 'function') {
      _saveHotbar();
      if (typeof _renderAllHotbarSlots === 'function') _renderAllHotbarSlots();
    }
  })();

  // ─────────────────────────────────────────────────────────────
  // MD#10: Inventory v2 — chip rendering + paging per column.
  // Uses the same _dxavSlotItems map as the avatar Equip tab so
  // both UIs stay in sync about what's equipable per slot. PAGE_SIZE
  // and _dxavPageCount are reused (see lines ~1616 and ~1711).
  // ─────────────────────────────────────────────────────────────
  const _inv2 = {
    pages: { 1: 0, 2: 0, 3: 0, 4: 0 }
  };
  function _inv2RenderColumn(slotNum) {
    const colEl = document.querySelector(`#inv2 .inv2-col[data-slot="${slotNum}"]`);
    if (!colEl) return;
    const chipsEl = colEl.querySelector('.inv2-chips');
    const upBtn = colEl.querySelector('.inv2-chev-up');
    const dnBtn = colEl.querySelector('.inv2-chev-down');
    const pgFill = colEl.querySelector('.inv2-pgbar-fill');

    const slotItems = _dxavGetSlotItems(slotNum); // includes synthetic "none"
    const numPages = _dxavPageCount(slotItems.length);
    // Clamp page index in case the user trimmed an item set.
    if (_inv2.pages[slotNum] >= numPages) _inv2.pages[slotNum] = numPages - 1;
    if (_inv2.pages[slotNum] < 0) _inv2.pages[slotNum] = 0;
    const curPage = _inv2.pages[slotNum];

    const start = curPage * PAGE_SIZE;
    const slice = slotItems.slice(start, start + PAGE_SIZE);
    const equippedId = _hotbar[slotNum] || 'none';
    const userLvl = (window._dexUserLevel && window._dexUserLevel()) || 1;

    let html = '';
    for (let i = 0; i < PAGE_SIZE; i++) {
      const it = slice[i];
      if (!it) {
        html += `<div class="inv2-chip-empty"></div>`;
        continue;
      }
      const byFunctional = (it.functional === false);
      const byLevel = !byFunctional && (it.unlockLevel || 1) > userLvl;
      const locked = byFunctional || byLevel;
      const isEquipped = (equippedId === it.id);
      const tip = it.label
        + (byFunctional ? ' (Coming Soon)'
           : byLevel ? ' (Unlocks at Level ' + it.unlockLevel + ')'
           : '');
      const cls = 'inv2-chip'
        + (isEquipped ? ' inv2-chip-equipped' : '')
        + (locked ? ' inv2-chip-locked' : '');
      html += `<div class="${cls}" data-slot="${slotNum}" data-val="${it.id}" data-tip="${tip}">${_dxavEquipSvg(it)}</div>`;
    }
    chipsEl.innerHTML = html;

    // Chevron disabled state
    upBtn.classList.toggle('inv2-chev-disabled', curPage <= 0);
    dnBtn.classList.toggle('inv2-chev-disabled', curPage >= numPages - 1);

    // Page progress bar
    if (pgFill) {
      const pct = numPages <= 1 ? 100 : Math.round(((curPage + 1) / numPages) * 100);
      pgFill.style.width = pct + '%';
    }

    // Single-page mode: hide chevrons + bar via class
    colEl.classList.toggle('inv2-col-single', numPages <= 1);
  }
  function _inv2RenderAll() {
    for (let s = 1; s <= 4; s++) _inv2RenderColumn(s);
  }
  function _inv2PageStep(slotNum, dir) {
    const slotItems = _dxavGetSlotItems(slotNum);
    const numPages = _dxavPageCount(slotItems.length);
    let next = (_inv2.pages[slotNum] || 0) + dir;
    if (next < 0) next = 0;
    if (next > numPages - 1) next = numPages - 1;
    if (next === _inv2.pages[slotNum]) return false;
    _inv2.pages[slotNum] = next;
    _inv2RenderColumn(slotNum);
    return true;
  }
  // Expose for MD#12 wiring + dev console testing.
  window._inv2Render = _inv2RenderAll;
  window._inv2RenderColumn = _inv2RenderColumn;
  window._inv2PageStep = _inv2PageStep;

  // Body chip SVGs — full character mini (head + torso). Mirrors the four torso configs from old code.
  const _dxavBodies = [
    { id:'default',  label:'Slim',    svg:`<circle cx="12" cy="5" r="3.5" stroke="currentColor" stroke-width="1.8" fill="none"/><line x1="12" y1="8.5" x2="12" y2="20" stroke="currentColor" stroke-width="1.8"/><line x1="12" y1="12" x2="7" y2="17" stroke="currentColor" stroke-width="1.8"/><line x1="12" y1="12" x2="17" y2="17" stroke="currentColor" stroke-width="1.8"/><line x1="12" y1="20" x2="8" y2="28" stroke="currentColor" stroke-width="1.8"/><line x1="12" y1="20" x2="16" y2="28" stroke="currentColor" stroke-width="1.8"/>`, vb:'0 0 24 30' },
    { id:'triangle', label:'Dress', svg:`<circle cx="12" cy="5" r="3.5" stroke="currentColor" stroke-width="1.8" fill="none"/><polygon points="12,8.5 5,24 19,24" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/><line x1="12" y1="12" x2="7" y2="17" stroke="currentColor" stroke-width="1.8"/><line x1="12" y1="12" x2="17" y2="17" stroke="currentColor" stroke-width="1.8"/><line x1="8" y1="24" x2="7" y2="28" stroke="currentColor" stroke-width="1.8"/><line x1="16" y1="24" x2="17" y2="28" stroke="currentColor" stroke-width="1.8"/>`, vb:'0 0 24 30' },
    { id:'vtorso',   label:'Armor',   svg:`<circle cx="12" cy="5" r="3.5" stroke="currentColor" stroke-width="1.8" fill="none"/><polygon points="5,8.5 19,8.5 12,20" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/><line x1="12" y1="12" x2="7" y2="17" stroke="currentColor" stroke-width="1.8"/><line x1="12" y1="12" x2="17" y2="17" stroke="currentColor" stroke-width="1.8"/><line x1="12" y1="20" x2="8" y2="28" stroke="currentColor" stroke-width="1.8"/><line x1="12" y1="20" x2="16" y2="28" stroke="currentColor" stroke-width="1.8"/>`, vb:'0 0 24 30' },
    { id:'robe',     label:'Robe',     svg:`<circle cx="12" cy="5" r="3.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M9.5,8.5 Q8,12 6,22 Q9,23 12,22 Q15,23 18,22 Q16,12 14.5,8.5 Z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/><line x1="12" y1="12" x2="7" y2="17" stroke="currentColor" stroke-width="1.8"/><line x1="12" y1="12" x2="17" y2="17" stroke="currentColor" stroke-width="1.8"/><line x1="10" y1="22" x2="9" y2="28" stroke="currentColor" stroke-width="1.8"/><line x1="14" y1="22" x2="15" y2="28" stroke="currentColor" stroke-width="1.8"/>`, vb:'0 0 24 30' },
    // MD 05 addition — open coat, spine visible between the panels
    { id:'coat',     label:'Coat',     svg:`<circle cx="12" cy="5" r="3.5" stroke="currentColor" stroke-width="1.8" fill="none"/><line x1="12" y1="8.5" x2="12" y2="20" stroke="currentColor" stroke-width="1.8"/><path d="M9.5,8.5 L8,21 Q9,21.7 10.3,21 L11,10 Z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/><path d="M14.5,8.5 L16,21 Q15,21.7 13.7,21 L13,10 Z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/><line x1="12" y1="12" x2="7" y2="17" stroke="currentColor" stroke-width="1.8"/><line x1="12" y1="12" x2="17" y2="17" stroke="currentColor" stroke-width="1.8"/><line x1="12" y1="20" x2="8" y2="28" stroke="currentColor" stroke-width="1.8"/><line x1="12" y1="20" x2="16" y2="28" stroke="currentColor" stroke-width="1.8"/>`, vb:'0 0 24 30' }
  ];

  // Hat chip SVGs — head circle + topper. "none" = bare head.
  // MD#HAT-ORDER-V4: corrected order per user spec.
  // Page 1: None, Basic, Top Hat, Viking
  // Page 2: Cap Front, Cap Back, Beanie, Wizard
  const _dxavHats = [
    { id:'none',         label:'None',      svg:`<circle cx="12" cy="10" r="5" stroke="currentColor" stroke-width="1.8" fill="none"/>`, vb:'0 0 24 18' },
    { id:'basic',        label:'Basic',     svg:`<circle cx="12" cy="10" r="5" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="9" y="2" width="6" height="3" rx="1" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M3,7 Q5,5.5 9,6 L15,6 Q19,5.5 21,7" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>`, vb:'0 0 24 18' },
    { id:'tophat',       label:'Top Hat',   svg:`<circle cx="12" cy="10" r="5" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="8" y="0" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.4" fill="none"/><line x1="5" y1="8" x2="19" y2="8" stroke="currentColor" stroke-width="1.8"/>`, vb:'0 0 24 18' },
    { id:'viking',       label:'Viking',    svg:`<circle cx="12" cy="11" r="5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M6,9 L6,5 Q12,1 18,5 L18,9" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M6,5 C2,4 -1,2 -2,-2 C-2,-5 0,-6 2,-5 C0,-4 -1,-2 0,0 C2,2 4,2 6,1 Z" stroke="currentColor" stroke-width="1.2" fill="currentColor" fill-opacity="0.85" stroke-linejoin="round"/><path d="M18,5 C22,4 25,2 26,-2 C26,-5 24,-6 22,-5 C24,-4 25,-2 24,0 C22,2 20,2 18,1 Z" stroke="currentColor" stroke-width="1.2" fill="currentColor" fill-opacity="0.85" stroke-linejoin="round"/>`, vb:'-3 -6 30 24' },
    { id:'cap_forward',  label:'Cap Front', svg:`<circle cx="12" cy="10" r="5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M7,8 Q12,4 17,8" stroke="currentColor" stroke-width="1.8" fill="none"/><line x1="17" y1="8" x2="22" y2="9" stroke="currentColor" stroke-width="1.8"/>`, vb:'0 0 24 18' },
    { id:'cap_back',     label:'Cap Back',  svg:`<circle cx="12" cy="10" r="5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M7,8 Q12,4 17,8" stroke="currentColor" stroke-width="1.8" fill="none"/><line x1="7" y1="8" x2="2" y2="9" stroke="currentColor" stroke-width="1.8"/>`, vb:'0 0 24 18' },
    { id:'beanie',       label:'Beanie',    svg:`<circle cx="12" cy="10" r="5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M7,7 Q7,2 12,2 Q17,2 17,7" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M7,7 Q12,9 17,7" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/><circle cx="12" cy="2" r="0.9" stroke="currentColor" stroke-width="1.2" fill="none"/>`, vb:'0 0 24 18' },
    { id:'wizard',       label:'Wizard',    svg:`<circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M6,8 L12,-3 L18,8" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/><line x1="4" y1="8" x2="20" y2="8" stroke="currentColor" stroke-width="1.8"/>`, vb:'0 -4 24 22' },
    // MD 05 additions — page 3
    { id:'crown',        label:'Crown',     svg:`<circle cx="12" cy="11" r="5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M8,7 L8,2 L10,4 L12,1 L14,4 L16,2 L16,7 Z" stroke="currentColor" stroke-width="1.2" fill="currentColor" fill-opacity="0.85" stroke-linejoin="round"/>`, vb:'0 -1 24 19' },
    { id:'halo',         label:'Halo',      svg:`<circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="1.8" fill="none"/><ellipse cx="12" cy="3" rx="5" ry="1.5" stroke="currentColor" stroke-width="1.4" fill="none" opacity="0.9"/>`, vb:'0 -1 24 20' },
    { id:'headphones',   label:'Phones',    svg:`<circle cx="12" cy="11" r="5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M6,10 Q12,2 18,10" stroke="currentColor" stroke-width="1.4" fill="none"/><rect x="4.8" y="9" width="2.6" height="5" rx="1.3" stroke="currentColor" stroke-width="1.1" fill="currentColor" fill-opacity="0.85"/><rect x="16.6" y="9" width="2.6" height="5" rx="1.3" stroke="currentColor" stroke-width="1.1" fill="currentColor" fill-opacity="0.85"/>`, vb:'0 0 24 19' }
  ];

  // Hair chip SVGs — head circle + hair. "none" = bare head.
  const _dxavHairs = [
    { id:'none',   label:'None',   svg:`<circle cx="12" cy="10" r="5" stroke="currentColor" stroke-width="1.8" fill="none"/>`, vb:'0 0 24 18' },
    { id:'short',  label:'Short',  svg:`<circle cx="12" cy="10" r="5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M7,9 Q7,4 12,4 Q17,4 17,9 L17,11 L16,11 L16,9.5 Q16,6 12,6 Q8,6 8,9.5 L8,11 L7,11 Z" stroke="currentColor" stroke-width="1.4" fill="currentColor" fill-opacity="0.15"/><path d="M9,6 L9.5,8" stroke="currentColor" stroke-width="1" fill="none" opacity="0.6"/><path d="M12,5.5 L12,7.5" stroke="currentColor" stroke-width="1" fill="none" opacity="0.6"/>`, vb:'0 0 24 18' },
    { id:'medium', label:'Medium', svg:`<circle cx="12" cy="10" r="5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M7,8 Q12,4 17,8" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M8,11 C7,15 7,18 8,20" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M16,11 C17,15 17,18 16,20" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M10,11 C9.5,14 9.5,16 10,18" stroke="currentColor" stroke-width="1.1" fill="none"/><path d="M14,11 C14.5,14 14.5,16 14,18" stroke="currentColor" stroke-width="1.1" fill="none"/>`, vb:'0 0 24 22' },
    { id:'long',   label:'Long',   svg:`<circle cx="12" cy="3" r="2.5" stroke="currentColor" stroke-width="1.4" fill="none"/><circle cx="12" cy="10" r="5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M7,12 C5,18 5,24 7,30" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M9,12 C7.5,18 7.5,24 9,29" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M17,12 C19,18 19,24 17,30" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M15,12 C16.5,18 16.5,24 15,29" stroke="currentColor" stroke-width="1.2" fill="none"/>`, vb:'0 0 24 32' },
    // MD 05 additions — page 2
    { id:'ponytail', label:'Ponytail', svg:`<circle cx="12" cy="10" r="5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M8,8 Q12,4 16,8" stroke="currentColor" stroke-width="1.4" fill="none"/><circle cx="8" cy="9" r="1.1" stroke="currentColor" stroke-width="1" fill="currentColor" fill-opacity="0.6"/><path d="M8,10 C5,14 4.5,19 6,25" stroke="currentColor" stroke-width="1.3" fill="none"/>`, vb:'0 0 24 27' },
    { id:'curly',    label:'Curly',    svg:`<circle cx="12" cy="11" r="5" stroke="currentColor" stroke-width="1.8" fill="none"/><circle cx="7.5" cy="8" r="2" stroke="currentColor" stroke-width="1.2" fill="currentColor" fill-opacity="0.12"/><circle cx="10" cy="5.5" r="2.2" stroke="currentColor" stroke-width="1.2" fill="currentColor" fill-opacity="0.12"/><circle cx="13" cy="4.8" r="2.2" stroke="currentColor" stroke-width="1.2" fill="currentColor" fill-opacity="0.12"/><circle cx="16" cy="6" r="2" stroke="currentColor" stroke-width="1.2" fill="currentColor" fill-opacity="0.12"/><circle cx="17.5" cy="8.5" r="1.8" stroke="currentColor" stroke-width="1.2" fill="currentColor" fill-opacity="0.12"/>`, vb:'0 0 24 19' }
  ];

  // Helpers
  const _dxavNoneSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" preserveAspectRatio="xMidYMid meet" style="opacity:0.7"><circle cx="12" cy="12" r="9"/><line x1="6" y1="18" x2="18" y2="6"/></svg>`;
  function _dxavChev(dir) {
    const pts = (dir === 'left') ? '13,4 5,12 13,20' : '5,4 13,12 5,20';
    return `<svg width="11" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="${pts}"/></svg>`;
  }
  function _dxavCellSvg(cfg) {
    return `<svg viewBox="${cfg.vb || '0 0 24 24'}" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${cfg.svg}</svg>`;
  }
  function _dxavEquipSvg(item) {
    if (item.noneIcon) return _dxavNoneSvg;
    // MD#ICON-OVERHAUL: prefer chipVB (tight content) over viewBox (in-world layout).
    const vb = item.chipVB || item.viewBox || '0 0 24 24';
    return `<svg viewBox="${vb}" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${item.svg}</svg>`;
  }
  function _dxavPageCount(n) { return Math.max(1, Math.ceil(n / PAGE_SIZE)); }

  // Which list and which cosmetic slot each row drives. The "selection" is
  // simply the equipped item — the chip already renders it as dxav-chip-active.
  const _DXAV_ROWS = {
    body: { list: () => _dxavBodies, prop: 'torso' },
    hair: { list: () => _dxavHairs,  prop: 'hair'  },
    hat:  { list: () => _dxavHats,   prop: 'hat'   },
  };
  function _dxavIndex(key) {
    const row = _DXAV_ROWS[key];
    if (!row) return -1;
    return Math.max(0, row.list().findIndex(o => o.id === _cosmetics[row.prop]));
  }
  /* Move the selection one item. Landing on the far-left cell of the next page
     is not special-cased: stepping off the end of a page lands on the next
     index, and that index IS the first cell of the following page. */
  function _dxavStep(key, dir) {
    const row = _DXAV_ROWS[key];
    if (!row) return false;
    const list = row.list();
    const next = _dxavIndex(key) + dir;
    if (next < 0 || next >= list.length) return false;
    _cosmetics[row.prop] = list[next].id;
    _dxav.focus = key;
    _dxav.pages[key] = Math.floor(next / PAGE_SIZE);
    applyCosmetics(_uid, _cosmetics);
    _saveCosmetics();
    if (window._dexHathoraSendAppearance) window._dexHathoraSendAppearance(window._dexGetAppearance());
    return true;
  }

  function _dxavRenderRow(items, focusKey, renderCell) {
    const numPages = _dxavPageCount(items.length);
    const curPage = Math.min(_dxav.pages[focusKey], numPages - 1);
    const start = curPage * PAGE_SIZE;
    const slice = items.slice(start, start + PAGE_SIZE);
    let cellsHtml = '';
    for (let i = 0; i < PAGE_SIZE; i++) cellsHtml += slice[i] ? renderCell(slice[i]) : `<div class="dxav-chip-empty"></div>`;
    const sel = _dxavIndex(focusKey);
    return `<div class="dxav-row dxav-row-cosmetic" data-focus="${focusKey}">`
      + `<div class="dxav-arrow ${sel <= 0 ? 'dxav-arrow-disabled' : ''}" data-page="${focusKey}" data-dir="-1" data-pages="${numPages}">${_dxavChev('left')}</div>`
      + `<div class="dxav-grid">${cellsHtml}</div>`
      + `<div class="dxav-arrow ${sel >= items.length - 1 ? 'dxav-arrow-disabled' : ''}" data-page="${focusKey}" data-dir="1" data-pages="${numPages}">${_dxavChev('right')}</div>`
      + `</div>`;
  }

  function _dxavRenderPills(focusKey, total) {
    const numPages = _dxavPageCount(total);
    const curPage = Math.min(_dxav.pages[focusKey], numPages - 1);
    let html = '<div class="dxav-bars">';
    for (let p = 0; p < numPages; p++) {
      html += `<div class="dxav-bar ${p === curPage ? 'dxav-bar-active' : ''}" data-go-page="${focusKey}" data-target="${p}"><span class="dxav-bar-pill"></span></div>`;
    }
    return html + '</div>';
  }

  function _dxavGetTitle() {
    if (_dxav.focus === 'hat') {
      const h = _dxavHats.find(x => x.id === _cosmetics.hat);
      return `Hat <span class="dxav-name">${h ? h.label : 'None'}</span>`;
    }
    if (_dxav.focus === 'hair') {
      const h = _dxavHairs.find(x => x.id === _cosmetics.hair);
      return `Hair <span class="dxav-name">${h ? h.label : 'None'}</span>`;
    }
    const b = _dxavBodies.find(x => x.id === _cosmetics.torso);
    return `Body <span class="dxav-name">${b ? b.label : 'Basic'}</span>`;
  }

  // === MD #4: full render + wiring ===
  let _dxavHoldTimer = null, _dxavHoldInterval = null;
  function _dxavStartHold(key, dir, numPages) {
    _dxavHoldTimer = setTimeout(() => {
      _dxavHoldInterval = setInterval(() => {
        if (!_dxavStep(key, dir)) { _dxavStopHold(); return; }
        window._dxavRender();
      }, 200);
    }, 350);
  }
  function _dxavStopHold() {
    if (_dxavHoldTimer) { clearTimeout(_dxavHoldTimer); _dxavHoldTimer = null; }
    if (_dxavHoldInterval) { clearInterval(_dxavHoldInterval); _dxavHoldInterval = null; }
  }

  window._dxavRender = function _dxavRender() {
    const titleEl = document.getElementById('dxav-title');
    const contentEl = document.getElementById('dxav-content');
    if (!titleEl || !contentEl) return;

    titleEl.innerHTML = _dxavGetTitle();

    let html = '';
    html += _dxavRenderRow(_dxavBodies, 'body', o =>
      `<div class="dxav-chip ${_cosmetics.torso === o.id ? 'dxav-chip-active' : ''}" data-set="torso" data-val="${o.id}" data-tip="${o.label}">${_dxavCellSvg(o)}</div>`
    );
    html += _dxavRenderRow(_dxavHairs, 'hair', o =>
      `<div class="dxav-chip ${_cosmetics.hair === o.id ? 'dxav-chip-active' : ''}" data-set="hair" data-val="${o.id}" data-tip="${o.label}">${_dxavCellSvg(o)}</div>`
    );
    html += _dxavRenderRow(_dxavHats, 'hat', o =>
      `<div class="dxav-chip ${_cosmetics.hat === o.id ? 'dxav-chip-active' : ''}" data-set="hat" data-val="${o.id}" data-tip="${o.label}">${_dxavCellSvg(o)}</div>`
    );
    const focusItems = _dxav.focus === 'body' ? _dxavBodies : (_dxav.focus === 'hat' ? _dxavHats : _dxavHairs);
    html += _dxavRenderPills(_dxav.focus, focusItems.length);
    contentEl.innerHTML = html;

    // Track which row was clicked into (for cosmetic focus + equip activeSlot)
    contentEl.querySelectorAll('[data-focus]').forEach(rowEl => {
      rowEl.addEventListener('mousedown', () => {
        const f = rowEl.dataset.focus;
        if (f.indexOf('eq') === 0) _dxav.activeSlot = parseInt(f.substring(2), 10);
        else if (_dxav.focus !== f) _dxav.focus = f;
      }, true);
    });

    // Cosmetic chip click → write to _cosmetics, persist, broadcast
    contentEl.querySelectorAll('[data-set]').forEach(b => {
      b.onclick = () => {
        const key = b.dataset.set;
        _cosmetics[key] = b.dataset.val;
        _dxav.focus = (key === 'torso') ? 'body' : key;
        applyCosmetics(_uid, _cosmetics);
        _saveCosmetics();
        if (window._dexHathoraSendAppearance) window._dexHathoraSendAppearance(window._dexGetAppearance());
        _dxavRender();
      };
    });

    // (Equip chips lived here until MD 10 — inventory now belongs solely to
    // the backpack. The inv2 chip click path in the inventory panel handles
    // all hotbar swaps.)

    // Chevron click + press-and-hold
    contentEl.querySelectorAll('[data-page]').forEach(a => {
      const key = a.dataset.page;
      const dir = parseInt(a.dataset.dir, 10);
      const numPages = parseInt(a.dataset.pages, 10);
      a.onclick = e => {
        e.stopPropagation();
        if (_dxavHoldInterval) return; // suppress click after a hold
        if (_dxavStep(key, dir)) _dxavRender();
      };
      a.addEventListener('mousedown', e => { e.stopPropagation(); _dxavStartHold(key, dir, numPages); });
      a.addEventListener('mouseup', _dxavStopHold);
      a.addEventListener('mouseleave', _dxavStopHold);
      a.addEventListener('touchstart', () => _dxavStartHold(key, dir, numPages), { passive: true });
      a.addEventListener('touchend', _dxavStopHold);
    });

    // Pill click — jump to page directly
    contentEl.querySelectorAll('[data-go-page]').forEach(d => {
      d.onclick = () => {
        const key = d.dataset.goPage;
        _dxav.pages[key] = parseInt(d.dataset.target, 10);
        _dxavRender();
      };
    });

  };
  _dxavRender();
}

// ═══════════════════════════════════
//  COSMETICS PANEL (re-homed)
// ═══════════════════════════════════
//  The DXAV renderer above used to draw into the notes app's account
//  dropdown. index.html now provides #dxav-panel with the same child ids, so
//  the renderer is untouched — all that's needed is a way to open it in-game
//  and to stop the player walking around underneath it.

let _cosmeticsOpen = false;

export function isCosmeticsPanelOpen() { return _cosmeticsOpen; }
// Bridge for platformer.js's Escape precedence (MD 06).
window._dexIsCosmeticsOpen = () => _cosmeticsOpen;

export function toggleCosmeticsPanel(force) {
  const panel = document.getElementById('dxav-panel');
  if (!panel) return;
  const open = (force === undefined) ? !_cosmeticsOpen : !!force;
  if (open === _cosmeticsOpen) return;
  _cosmeticsOpen = open;
  sfx(open ? 'ui.open' : 'ui.close');

  if (open) {
    // The panel and #inv2 both expand up from the hotbar — never both.
    const inv2El = document.getElementById('inv2');
    if (inv2El && inv2El.classList.contains('is-open')) _toggleInventory();
    // Re-render so the panel reflects any hotbar/cosmetic change made since
    // it was last opened.
    if (window._dxavRender) window._dxavRender();
    _renderBackpackSlots();
    _positionCosmeticsPanel(panel);
    panel.style.display = '';
    // Next frame so the transition has a starting state to animate from.
    requestAnimationFrame(() => panel.classList.add('open'));
    _wireCosmeticsOutsideClose();
  } else {
    panel.classList.remove('open');
    setTimeout(() => { if (!_cosmeticsOpen) panel.style.display = 'none'; }, 180);
  }

  // Freeze the player while the panel is up. The world keeps ticking.
  window._dexPausePlayInput?.(open);
  // Drop any held movement keys so the character doesn't keep walking after
  // the panel steals focus.
  if (open && window._dexClearKeys) window._dexClearKeys();

  _syncCosmeticsGearBtn();
}

// Panel placement: horizontally centered, floated a bit above the hotbar.
// It used to anchor to the slot-6 button's right edge, which read as glued
// to the screen corner. Width matches the CSS min(400px, 100vw-16px), so
// the center is computable before the panel is displayed.
function _positionCosmeticsPanel(panel) {
  panel = panel || document.getElementById('dxav-panel');
  if (!panel || !_cosmeticsOpen && panel.style.display === 'none') return;
  const btn = document.getElementById('cosmetics-btn');
  const vw = window.innerWidth, vh = window.innerHeight;
  const panelW = Math.min(400, vw - 16);
  panel.style.right = 'auto';
  panel.style.left = Math.max(8, Math.round((vw - panelW) / 2)) + 'px';
  const btnTop = btn ? btn.getBoundingClientRect().top : vh - 70;
  panel.style.bottom = Math.max(150, Math.min(vh - 80, vh - btnTop + 42)) + 'px';
}
window.addEventListener('resize', () => { if (_cosmeticsOpen) _positionCosmeticsPanel(); });

// Click anywhere outside the panel (and off its button) closes it — the
// same feel as #inv2, replacing the old full-screen modal backdrop.
let _cosmeticsOutsideWired = false;
function _wireCosmeticsOutsideClose() {
  if (_cosmeticsOutsideWired) return;
  _cosmeticsOutsideWired = true;
  document.addEventListener('mousedown', (e) => {
    if (!_cosmeticsOpen) return;
    const panel = document.getElementById('dxav-panel');
    if (panel && panel.contains(e.target)) return;
    if (e.target.closest('#cosmetics-btn')) return;   // the toggle handles itself
    toggleCosmeticsPanel(false);
  }, true);
}

function _syncCosmeticsGearBtn() {
  const btn = document.getElementById('cosmetics-btn');
  if (btn) btn.classList.toggle('active', _cosmeticsOpen);
}

// The cosmetics button lives in #item-bar next to the backpack (MD 05) —
// static markup in index.html; this just binds the toggle. The old gear
// button in #play-btn-stack is gone; G remains the keybind either way.
function _initCosmeticsButton() {
  const btn = document.getElementById('cosmetics-btn');
  if (!btn || btn._dxavWired) return;
  btn._dxavWired = true;
  btn.addEventListener('mousedown', e => e.stopPropagation());
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggleCosmeticsPanel(); });
}

export function mountCosmeticsButton() {
  _initCosmeticsButton();
}

// ═══════════════════════════════════
//  SHOTGUN SYSTEM
// ═══════════════════════════════════

const GUN_TYPES = {
  // gripUp: how far above hip the grip is (higher = arms more extended out)
  pistol:   { label:'Pistol',   fireRate: 60, speed: 12, spread: 0, pellets: 1, barrelLen: 12, autoFire: false, gripUp: 12,
              bulletW: 8, bulletH: 5, trailLen: 18,
              // MD#12: reworked icon — centered filled silhouette (slide + grip
              // + muzzle notch), no trigger guard. fill="currentColor" is set
              // explicitly because the icon wrapper forces fill="none". This
              // string is the ICON only; the in-hand gun is drawn procedurally
              // from barrelLen/gripUp and is unaffected. Authored in a 0 0 28 18
              // box (see chipVB/viewBox below) so it sits centered.
              svg:'<path d="M4,6 L20,6 L20,10 L12,10 L10,16 L7,16 L8,10 L4,10 Z" fill="currentColor" stroke="currentColor" stroke-width="0.6" stroke-linejoin="round"/><rect x="20" y="6.6" width="3" height="2.6" fill="currentColor" stroke="currentColor" stroke-width="0.3"/>' },
  // MD 14 shotgun pass: fireRate 60→48 (1000ms → 800ms — pump-gun cadence,
  // less sluggish), kick 14 (heavier recoil than the default 8), and a
  // pump-rack animation on the in-hand gun (see _updateGunAim). Icon redrawn
  // as a filled silhouette (stock, receiver+barrel, pump grip, muzzle notch)
  // in the pistol's MD#12 style.
  shotgun:  { label:'Shotgun',  fireRate: 48, speed: 10, spread: 8, pellets: 6, barrelLen: 20, autoFire: false, gripUp: 4, kick: 14,
              svg:'<path d="M0,9.5 L2.6,4 L6,4 L6,9 L1.8,9.5 Z" fill="currentColor" stroke="currentColor" stroke-width="0.6" stroke-linejoin="round"/><path d="M5,4 L26.5,4 L26.5,6.1 L5,6.8 Z" fill="currentColor" stroke="currentColor" stroke-width="0.5" stroke-linejoin="round"/><rect x="12" y="6.7" width="6" height="2.6" rx="1.2" fill="currentColor" stroke="none"/><rect x="26.5" y="3.6" width="1.4" height="2" fill="currentColor" stroke="none"/>' },
  smg:      { label:'SMG',      fireRate: 20, speed: 14, spread: 3, pellets: 1, barrelLen: 16, autoFire: true, gripUp: 8,
              bulletW: 6, bulletH: 4, trailLen: 14,
              svg:'<line x1="0" y1="5" x2="18" y2="5" stroke-width="2"/><rect x="4" y="3" width="8" height="5" rx="1" fill="none" stroke-width="1.5"/><line x1="8" y1="8" x2="8" y2="13" stroke-width="1.8"/>' },
  rifle:    { label:'Rifle',    fireRate: 30, speed: 20, spread: 0, pellets: 1, barrelLen: 22, autoFire: false, gripUp: 6,
              bulletW: 5, bulletH: 3, trailLen: 30,
              svg:'<line x1="0" y1="5" x2="26" y2="5" stroke-width="2"/><line x1="18" y1="5" x2="18" y2="10" stroke-width="1.8"/><circle cx="3" cy="3" r="2" fill="none" stroke-width="1.2"/>' },
  // Sword (replaces the never-shipped hammer): melee, aims at the cursor.
  // MD 11 rework: longer blade (barrelLen is the visual reach — hit tests
  // sample along it so range matches look), random jab/swipe per click
  // with a short wind-up, and a fireRate quick enough to spam (14 ≈ 233ms
  // between clicks; both swings finish inside that).
  sword:    { label:'Sword',  fireRate: 14, speed: 0, spread: 0, pellets: 0, barrelLen: 34, autoFire: false, gripUp: 6, melee: true, isSword: true,
              svg:'<circle cx="1.4" cy="7" r="1.2" fill="currentColor" stroke="none"/><line x1="2.4" y1="7" x2="5.2" y2="7" stroke-width="2.4"/><path d="M6.2,3.6 Q8.2,7 6.2,10.4" stroke-width="1.6" fill="none"/><path d="M7,5.4 L20,6.1 L27.5,7 L20,7.9 L7,8.6 Z" fill="currentColor" fill-opacity="0.3" stroke-width="1"/><line x1="8.5" y1="7" x2="22" y2="7" stroke-width="0.7" opacity="0.45"/>' },
  rocket:   { label:'Rocket',  fireRate: 90, speed: 8, spread: 0, pellets: 1, barrelLen: 20, autoFire: false, gripUp: 6, isRocket: true,
              svg:'<line x1="0" y1="6" x2="18" y2="6" stroke-width="3"/><path d="M18,3 L24,6 L18,9 Z" stroke-width="1.2" fill="none"/><line x1="6" y1="6" x2="6" y2="12" stroke-width="2"/>' },
  laser:    { label:'Gamma Laser', fireRate: 0, speed: 0, spread: 0, pellets: 0, barrelLen: 18, autoFire: false, gripUp: 8, isLaser: true,
              svg:'<line x1="0" y1="6" x2="20" y2="6" stroke-width="2.5"/><circle cx="22" cy="6" r="2.5" fill="currentColor" stroke="none"/><line x1="22" y1="6" x2="28" y2="6" stroke-width="1.2" stroke-dasharray="2,2" opacity="0.7"/>' },
  pufferLauncher: { label:'Puffer Launcher', fireRate: 60, speed: 0, spread: 0, pellets: 0, barrelLen: 20, autoFire: false, gripUp: 6, isPufferLauncher: true,
              svg:'<line x1="0" y1="6" x2="16" y2="6" stroke-width="3"/><circle cx="19" cy="6" r="3.5" stroke-width="1.5" fill="none"/><line x1="6" y1="6" x2="6" y2="12" stroke-width="2"/><line x1="19" y1="2.5" x2="19" y2="9.5" stroke-width="0.8" opacity="0.5"/><line x1="15.5" y1="6" x2="22.5" y2="6" stroke-width="0.8" opacity="0.5"/>' },
  spellbook: { label:'Spellbook', fireRate: 120, speed: 0, spread: 0, pellets: 0, barrelLen: 0, autoFire: false, gripUp: 8, isSpellbook: true,
              // MD 12: closed tome drawn at a 3/4 orthographic angle — front
              // cover leaning back as a parallelogram, visible page block on
              // the right with page-edge lines, top pages face, thick spine
              // on the left edge, spiral sigil on the cover. fireRate 120
              // (was 180) so stacking the 4-wraith pack is practical.
              svg:'<path d="M4,5 L16,2.5 L18.5,3.7 L6.5,6.2 Z" fill="currentColor" fill-opacity="0.25" stroke-width="1" stroke-linejoin="round"/><path d="M16,2.5 L18.5,3.7 L18.5,13.7 L16,12.5 Z" fill="currentColor" fill-opacity="0.12" stroke-width="1" stroke-linejoin="round"/><line x1="16.8" y1="3.6" x2="16.8" y2="12.9" stroke-width="0.45" opacity="0.55"/><line x1="17.6" y1="4" x2="17.6" y2="13.3" stroke-width="0.45" opacity="0.55"/><path d="M4,5 L16,2.5 L16,12.5 L4,15 Z" fill="currentColor" fill-opacity="0.1" stroke-width="1.4" stroke-linejoin="round"/><line x1="4" y1="5" x2="4" y2="15" stroke-width="2.4" stroke-linecap="round"/><path d="M10,7.5 C12,7.5 12.5,9 12,10 C11.5,11 9,11 8.5,10 C8,8.5 9.5,7 11,7.5 C12.5,8 13,10.5 11.5,11.5 C10,12.5 8,11.5 8,10" stroke-width="0.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' },
};
// MD#ICON-OVERHAUL: chipVB = tight viewBox enclosing only visible content.
// Used by chip render paths (avatar dropdown rows, bottom hotbar slots, play
// mode hotbar) so the icon fills the square cell instead of shrinking
// inside whitespace. The wider `viewBox` is still used for in-world
// rendering (held weapons need the extra padding for tilt/grip math).
const INVENTORY_ITEMS = [
  // MD 05: bow icon redrawn — recurve limb, string, nocked arrow with head
  // and fletching. Chip-only art (the in-hand bow is rig-drawn), so the
  // coordinate box is unchanged and viewBox stays untouched.
  { id:'bow',      label:'Bow',      functional:true,  unlockLevel:1,  tilt:0,   svg:'<path d="M5,1 Q12,7 5,13" stroke-width="1.7" fill="none"/><line x1="5" y1="1" x2="5" y2="13" stroke-width="0.8" opacity="0.7"/><line x1="2.5" y1="7" x2="14.5" y2="7" stroke-width="1.3"/><path d="M14.5,7 L11.8,5.4 M14.5,7 L11.8,8.6" stroke-width="1.2" fill="none"/><path d="M4,7 L2.5,5.8 M4,7 L2.5,8.2" stroke-width="1" fill="none" opacity="0.8"/>', viewBox:'0 0 18 14', chipVB:'0.5 0 16 14' },
  { id:'pistol',   label:'Pistol',   functional:true,  unlockLevel:2,  tilt:-35, svg:GUN_TYPES.pistol.svg,   viewBox:'0 0 28 18', chipVB:'0 0 28 18' },
  { id:'shotgun',  label:'Shotgun',  functional:true,  unlockLevel:5,  tilt:-35, svg:GUN_TYPES.shotgun.svg,  viewBox:'-1 2 30 10', chipVB:'-1.5 2.5 31 9' },
  { id:'rifle',    label:'Sniper',   functional:true,  unlockLevel:7,  tilt:-35, svg:GUN_TYPES.rifle.svg,    viewBox:'-1 0 29 12', chipVB:'-1 0 28 12' },
  { id:'rocket',   label:'Rocket',   functional:true,  unlockLevel:8,  tilt:-35, svg:GUN_TYPES.rocket.svg,   viewBox:'-1 2 27 12', chipVB:'-2 1 28 12' },
  { id:'smg',      label:'SMG',      functional:true,  unlockLevel:6,  tilt:-35, svg:GUN_TYPES.smg.svg,      viewBox:'-1 2 21 13', chipVB:'-2 1 22 13' },
  // Hammer removed (owner's call) — its inventory cell simply stays blank.
  // MD 11: sword icon redrawn to match the reworked in-hand blade — longer
  // tapered blade with a belly, fuller down the middle, swept crossguard,
  // grip, pommel. Melee jab/swipe (see GUN_TYPES.sword).
  { id:'sword',    label:'Sword',    functional:true,  unlockLevel:1,  tilt:0,   svg:'<path d="M14,-2.5 L15.4,1.5 L15.1,10.5 L12.9,10.5 L12.6,1.5 Z" fill="currentColor" fill-opacity="0.28" stroke-width="1.1" stroke-linejoin="round"/><line x1="14" y1="0.5" x2="14" y2="9.5" stroke-width="0.6" opacity="0.5"/><path d="M10.6,10.5 Q14,12.4 17.4,10.5" stroke-width="1.5" fill="none"/><line x1="14" y1="11.6" x2="14" y2="15" stroke-width="1.7"/><circle cx="14" cy="15.9" r="1.1" fill="currentColor" stroke="none"/>', viewBox:'7.5 -3.5 13 21.5', chipVB:'8.5 -3.5 11 21.5' },
  { id:'laser',    label:'Gamma Laser', functional:true, unlockLevel:9, tilt:-35, svg:GUN_TYPES.laser.svg, viewBox:'-1 2 32 8', chipVB:'-2 3 32 6' },
  { id:'pufferLauncher', label:'Puffer Launcher', functional:true, unlockLevel:8, tilt:-35, svg:GUN_TYPES.pufferLauncher.svg, viewBox:'-1 1 26 13', chipVB:'-2 1 26 12' },
  { id:'spellbook', label:'Spellbook', functional:true, unlockLevel:7, tilt:-30, svg:GUN_TYPES.spellbook.svg, viewBox:'2 0.5 19 16', chipVB:'3 1.5 16.5 14.5' },
  { id:'checkpointFlag', label:'Flag', functional:true, unlockLevel:4, isFlag:true, tilt:0, svg:'<line x1="10" y1="4" x2="10" y2="22" stroke-width="2" stroke-linecap="round"/><polygon points="10,4 22,9 10,14" fill="currentColor" fill-opacity="0.5" stroke="currentColor" stroke-width="1"/><ellipse cx="10" cy="22" rx="4" ry="2" fill="currentColor" fill-opacity="0.3" stroke="none"/>', viewBox:'4 0 22 24', chipVB:'5 2 18 22' },
  { id:'hoverboard', label:'Hoverboard', functional:true, unlockLevel:10, isMountSlot:true, tilt:0, svg:'<rect x="2" y="5" width="20" height="3" rx="1.5" stroke-width="1.8"/><line x1="6" y1="9" x2="8" y2="11" stroke-width="1.2" opacity="0.5"/><line x1="16" y1="9" x2="14" y2="11" stroke-width="1.2" opacity="0.5"/><ellipse cx="12" cy="12" rx="4" ry="1" fill="currentColor" opacity="0.15" stroke="none"/>', viewBox:'0 2 24 12', chipVB:'0 3 24 10' },
  // MD 07: jetpack — the other slot-4 mount. Two tanks, strap, nozzle
  // flames. Chip-only art; the worn pack is rig-drawn.
  { id:'jetpack', label:'Jetpack', functional:true, unlockLevel:10, isMountSlot:true, tilt:0, svg:'<rect x="4" y="2" width="6.5" height="12" rx="3" stroke-width="1.6" fill="none"/><rect x="13.5" y="2" width="6.5" height="12" rx="3" stroke-width="1.6" fill="none"/><line x1="10.5" y1="6" x2="13.5" y2="6" stroke-width="1.2"/><path d="M6,14 L5.5,16.5 M8.5,14 L8.5,17.5 M16,14 L15.5,16.5 M18,14 L18,17.5" stroke-width="1.1" opacity="0.6"/>', viewBox:'0 0 24 20', chipVB:'2 0 20 19' },
];
window._dexGetItemUnlocksAtLevel = function(level) {
  const results = [];
  INVENTORY_ITEMS.forEach(it => {
    if ((it.unlockLevel || 1) === level && it.functional) {
      results.push({ id: it.id, label: it.label, svg: it.svg, viewBox: it.viewBox });
    }
  });
  return results;
};
const HOTBAR_LS_KEY = 'dexnote-hotbar';
// MD#2: default loadout for brand-new users + guests (no localStorage entry).
// Existing users with a saved hotbar are unaffected — they load below.
// smg = "machine gun", rocket = "rocket launcher". Rocket/hoverboard are
// level-locked by default; MD#3 lifts that so these are equippable in-world.
let _hotbar = { 1:'bow', 2:'smg', 3:'rocket', 4:'hoverboard' };
let _activeHotbarSlot = 1;
let _dragFromSlot = null;
let _dragLanded = false;

// Load saved hotbar from localStorage (guarded — see storage.js safeStorage)
try {
  const saved = JSON.parse(safeStorage.getItem(HOTBAR_LS_KEY));
  if (saved && typeof saved === 'object') {
    _hotbar = { 1: saved[1] || null, 2: saved[2] || null, 3: saved[3] || null, 4: saved[4] || null };
    // Validate all IDs exist in INVENTORY_ITEMS and are functional
    for (const k of [1,2,3,4]) {
      const it = _hotbar[k] && INVENTORY_ITEMS.find(it => it.id === _hotbar[k]);
      if (!it || !it.functional) _hotbar[k] = null;
    }
    // Ensure bow is somewhere if nothing is set
    if (!Object.values(_hotbar).includes('bow') && !Object.values(_hotbar).some(v => v)) _hotbar[1] = 'bow';
  }
} catch(e) {}

function _saveHotbar() {
  try { safeStorage.setItem(HOTBAR_LS_KEY, JSON.stringify(_hotbar)); } catch(e) {}
  _renderBackpackSlots();
}

const _gun = {
  held: false,
  type: null,              // 'pistol'|'shotgun'|'smg'|'rifle'
  angle: 0,
  svgLine: null,
  _gripSvgX: 18, _gripSvgY: 20, _muzzleSvgX: 36, _muzzleSvgY: 20,
  _dirX: 1, _dirY: 0,
  _kickback: 0,
  _swordAnim: null,         // { kind:'jab'|'swipe', t, windup, dur, struck, a0, a1, power } while swinging
  _swordLast: null,         // last attack kind — clicks pick randomly, biased to switch
  _swordEl: null,           // full sword art <g>, created lazily on first sword frame
  _swordTrail: null,        // swipe motion-trail <path>, created lazily
  _swordTrailT: 0,          // trail fade countdown after a swipe ends
  _swordTrailMax: 0,        // fade duration of the current trail (power trails linger)
  _swordTrailPeak: 0.5,     // peak opacity of the current trail
  _swordChargeT: 0,         // frames the click has been held past the swing — power charge
  _swordChargeCued: false,  // full-charge audio cue fired for this hold
};
const _pickups = [];       // array of { type, x, y, el, promptEl }
const _projectiles = [];

// ── Laser beam state ──
const _laser = {
  active: false,       // beam currently firing
  retracting: false,   // beam animating back into the muzzle after release (MD 12)
  beamEl: null,        // DOM element for the beam line
  glowEl: null,        // DOM element for the beam glow
  hitX: 0, hitY: 0,    // where the beam terminates
  dmgTimer: 0,         // damage tick accumulator
  lastMX: 0, lastMY: 0, lastCos: 1, lastSin: 0, lastDist: 0,  // last geometry, for retraction after the gun is gone
};
const LASER_RANGE = 600;       // max beam length in px
// MD 12: 66 ≈ 0.28s between ticks — a yak (5-7hp) burns down in ~1.5-2s,
// and the finisher is always the overload burst, never an instant kill
// (play-mode damage goes through window._dexLaserDamage in playmode.js).
const LASER_DMG_INTERVAL = 66;
const LASER_DPS = 1;            // sessions-mode damage per tick

// ── Hoverboard ──
const _hoverboard = { active: false, el: null, bobT: 0, bob: 0, boosting: false, tilt: 0, jumpLag: 0, transition: '', transT: 0 };
// transition: '' = none, 'mount' = jumping onto board, 'dismount' = jumping off board
const HOVER_SPEED_MULT = 1.25;
const HOVER_BOOST_MULT = 2.0;
const HOVER_FLOAT = 11;
let _sessFloorY = 0; // tracks last known floor Y for hoverboard jump lag in sessions mode
const HOVER_MOUNT_DUR = 72;   // frames for mount/dismount (~300ms at 240Hz)
const HOVER_DISMOUNT_DUR = 60; // dismount — crouch + jump off

function _ensureBoardEl() {
  if (_hoverboard.el) return;
  _hoverboard.el = document.createElement('div');
  _hoverboard.el.style.cssText = 'position:fixed;pointer-events:none;z-index:149;display:none;';
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '40'); svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 40 14');
  svg.style.cssText = 'overflow:visible;display:block;';
  const board = document.createElementNS(ns, 'rect');
  board.setAttribute('x', '2'); board.setAttribute('y', '2');
  board.setAttribute('width', '36'); board.setAttribute('height', '5');
  board.setAttribute('rx', '2.5');
  board.setAttribute('stroke', 'var(--clr-adj,#7B8A9C)');
  board.setAttribute('stroke-width', '1.5');
  board.style.fill = 'var(--bg,#13141a)';
  svg.appendChild(board);
  const glow1 = document.createElementNS(ns, 'line');
  glow1.setAttribute('x1', '8'); glow1.setAttribute('y1', '9');
  glow1.setAttribute('x2', '14'); glow1.setAttribute('y2', '13');
  glow1.setAttribute('stroke', 'var(--clr-adj,#7B8A9C)');
  glow1.setAttribute('stroke-width', '1'); glow1.setAttribute('opacity', '0.4');
  glow1.setAttribute('stroke-linecap', 'round');
  svg.appendChild(glow1);
  const glow2 = document.createElementNS(ns, 'line');
  glow2.setAttribute('x1', '32'); glow2.setAttribute('y1', '9');
  glow2.setAttribute('x2', '26'); glow2.setAttribute('y2', '13');
  glow2.setAttribute('stroke', 'var(--clr-adj,#7B8A9C)');
  glow2.setAttribute('stroke-width', '1'); glow2.setAttribute('opacity', '0.4');
  glow2.setAttribute('stroke-linecap', 'round');
  svg.appendChild(glow2);
  const shadow = document.createElementNS(ns, 'ellipse');
  shadow.setAttribute('cx', '20'); shadow.setAttribute('cy', '13');
  shadow.setAttribute('rx', '12'); shadow.setAttribute('ry', '2');
  shadow.setAttribute('fill', 'var(--clr-adj,#7B8A9C)');
  shadow.setAttribute('opacity', '0.1');
  svg.appendChild(shadow);
  _hoverboard.el.appendChild(svg);
  document.body.appendChild(_hoverboard.el);
}

function _activateHoverboard() {
  if (_hoverboard.active || _hoverboard.transition) return;
  _ensureBoardEl();
  _hoverboard.el.style.display = '';
  _hoverboard.transition = 'mount';
  _hoverboard.transT = 0;
  _hoverboard.bobT = 0;
  _hoverboard.bob = 0;
  _hoverboard.tilt = 0;
}

function _deactivateHoverboard() {
  if (!_hoverboard.active || _hoverboard.transition) return;
  _hoverboard.transition = 'dismount';
  _hoverboard.transT = 0;
}

function _toggleHoverboard() {
  if (_hoverboard.transition) return; // ignore during transition
  if (_hoverboard.active) _deactivateHoverboard();
  else {
    // Slot-4 mounts are mutually exclusive (MD 07).
    _deactivateJetpack();
    _activateHoverboard();
  }
}

// Jetpack flight pose (MD 07) — a continuous function of live state like
// every other pose: legs trail against vertical speed, arms grip the
// straps, the flame flickers only while thrusting. Reads as hanging from
// the pack, distinct from the hoverboard's surf stance.
function poseJetFly(vy, thrusting, t) {
  _setLine('torso', 18, 14, 17.2, 30);
  const trail = Math.max(-4, Math.min(5, vy * 1.2));   // rising: tucked back; falling: dangling
  _setPath('leg-left', `M18,30 Q14,36 ${13 - trail * 0.6},${42 + trail}`);
  _setCircle('foot-left', 13 - trail * 0.6, 42 + trail);
  _setPath('leg-right', `M18,30 Q22,37 ${20 - trail * 0.4},${44 + trail * 0.8}`);
  _setCircle('foot-right', 20 - trail * 0.4, 44 + trail * 0.8);
  _setLine('upper-arm-left', 18, 17, 13.5, 20);
  _setLine('lower-arm-left', 13.5, 20, 14.5, 24);
  _setLine('upper-arm-right', 18, 17, 23, 21);
  _setLine('lower-arm-right', 23, 21, 21.5, 25);
  const fl = _el('jet-flame');
  if (fl) {
    if (thrusting) {
      fl.style.display = '';
      const len = 6 + Math.sin(t * 55) * 2.2;
      fl.setAttribute('d', `M8.6,26.5 L10,${29 + len} L11.2,27 L12.6,${28.5 + len * 0.7} L13.8,26.5 Z`);
    } else {
      fl.style.display = 'none';
    }
  }
}

// ══ Jetpack (MD 07) ══
// The other slot-4 mount. Hold Space to thrust — platformer physics only;
// play mode's jump is a visual offset, so there the pack is worn but
// dormant. Fuel drains in flight, refills on the ground; the stamina bar
// doubles as the gauge in this mode (the tank only uses it in play mode).
// Mount/dismount are instant — no transition to strand mid-air on a swap.
const JET_FUEL_MAX = 300;      // ~1.9s of thrust in 240Hz-reference frames
// MD11: star-fuel bonus — platformer-only, additive on top of the base
// tank. Capped so the climb stays a climb (roughly +1 extra thrust-second
// per 5 stars, capping around +2s at 15 stars).
const JET_FUEL_PER_STAR = 20;
const JET_FUEL_STAR_CAP = 15;
function _jetFuelMax() {
  if (!(window._dexPlatActive && window._dexPlatStars)) return JET_FUEL_MAX;
  const stars = Math.min(JET_FUEL_STAR_CAP, window._dexPlatStars() || 0);
  return JET_FUEL_MAX + stars * JET_FUEL_PER_STAR;
}
// MD11: called by platformer.js on spark pickup — tops off current fuel
// so the star-fuel bonus is felt immediately, not just on next landing.
window._dexJetStarBonus = () => {
  _jetpack.fuel = Math.min(_jetFuelMax(), _jetpack.fuel + JET_FUEL_PER_STAR);
};
const JET_THRUST = 0.145;      // vy per frame against GRAVITY 0.18 x RISE 0.75
const JET_MAX_RISE = -3.2;     // rise cap - slower than a charged jump
const JET_REFILL = 2.2;        // per frame while grounded
// Free roam (MD 10): the pack is a movement mode, not real flight — a
// visual hover on P._jumpVisualY plus a cruise-speed multiplier. Hover
// height ~2.5 body heights; drain slower than the platformer climb (a
// cruise doesn't fight gravity), refill on the ground as always.
const JET_PM_HOVER_Y = -(CHAR_H * 2.5);
const JET_PM_SPEED_MULT = 1.6;
const JET_PM_DRAIN = 0.35;
const JET_PM_SETTLE = 2.0;     // descent per reference frame when throttle off
const _jetpack = { active: false, fuel: JET_FUEL_MAX, thrusting: false, _pmVY: 0 };

function _toggleJetpack() {
  if (_jetpack.active) { _deactivateJetpack(); sfx('board.dismount'); }
  else {
    if (_hoverboard.active || _hoverboard.transition) window._dexDismountHoverboard();
    _jetpack.active = true;
    // Space belongs to the throttle now — drop any half-armed jump state
    // (charge, buffer, coyote) so nothing fires mid-flight or on landing.
    // The assist windows re-arm from live grounded state on dismount.
    isCharging = false; chargeFrames = 0;
    _jumpBufferTimer = 0; _coyoteTimer = 0;
    _syncJetpackVisual();
    sfx('board.mount');
  }
}
function _deactivateJetpack() {
  if (!_jetpack.active) return;
  _jetpack.active = false;
  _jetpack.thrusting = false;
  sfxHoldStop('jet');
  // MD 10: dismounting mid-hover in free roam hands the height to the
  // visual-jump machinery — the character falls and lands with the normal
  // absorb instead of freezing in the air.
  if (_isPlayModeFn && _isPlayModeFn() && (P._jumpVisualY || 0) < -1) {
    currentState = 'jump-air';
    P._jumpVY = 0;
  }
  _syncJetpackVisual();
  _syncJetFuelHud();
}
window._dexDismountJetpack = () => { if (_jetpack.active) { _deactivateJetpack(); sfx('board.dismount'); } };

function _syncJetpackVisual() {
  const g = _el('jetpack');
  if (g) g.style.display = _jetpack.active ? '' : 'none';
}
function _syncJetFuelHud() {
  const wrap = document.getElementById('hud-stamina-wrap');
  const bar = document.getElementById('hud-stamina-bar');
  if (!wrap || !bar) return;
  // MD 10: the pack works in both modes now. The tank still owns the bar
  // while driving — tank entry always dismounts the jetpack, so ownership
  // never overlaps; we just keep our hands off while _inTank.
  if (_isInTankFn && _isInTankFn()) return;
  if (_jetpack.active) {
    wrap.style.display = 'block';
    bar.style.width = ((_jetpack.fuel / _jetFuelMax()) * 100).toFixed(1) + '%';
  } else {
    wrap.style.display = 'none';
  }
}

// Returns the character's vertical offset for mount/dismount hop animation
function _tickHoverTransition() {
  if (!_hoverboard.transition) return 0;
  _hoverboard.transT += _dt;

  if (_hoverboard.transition === 'mount') {
    const t = Math.min(_hoverboard.transT / HOVER_MOUNT_DUR, 1);
    // Phase 1 (0-0.2): crouch buildup — character dips down
    // Phase 2 (0.2-0.7): big jump upward
    // Phase 3 (0.7-1.0): land on board
    let hop;
    if (t < 0.2) {
      // Crouch: dip down (positive = downward)
      const ct = t / 0.2;
      hop = ct * ct * 6; // ease-in crouch, max 6px down
    } else {
      // Jump: parabolic arc from crouch to peak to landing
      const jt = (t - 0.2) / 0.8; // 0-1 over jump phase
      hop = -Math.sin(jt * Math.PI) * 32 + (1 - jt) * 6 * (1 - jt); // 32px peak, starts from 6px crouch
    }
    if (t >= 1) {
      _hoverboard.transition = '';
      _hoverboard.active = true;
      sfx('board.mount');
    }
    return hop;
  } else if (_hoverboard.transition === 'dismount') {
    const t = Math.min(_hoverboard.transT / HOVER_DISMOUNT_DUR, 1);
    // Phase 1 (0-0.15): crouch on board — dip down to coil
    // Phase 2 (0.15-0.65): jump off the board upward
    // Phase 3 (0.65-1.0): descend and land
    let hop;
    if (t < 0.15) {
      const ct = t / 0.15;
      hop = ct * ct * 5; // crouch dip, max 5px down
    } else {
      const jt = (t - 0.15) / 0.85;
      hop = -Math.sin(jt * Math.PI) * 28 + (1 - jt) * 5 * (1 - jt); // 28px peak
    }
    if (t >= 1) {
      _hoverboard.transition = '';
      _hoverboard.active = false;
      sfx('board.dismount');
      if (_hoverboard.el) _hoverboard.el.style.display = 'none';
    }
    return hop;
  }
  return 0;
}

function _renderHoverboard(jumpOffset) {
  // Render during active OR during mount/dismount transition
  if (!_hoverboard.el) return;
  if (!_hoverboard.active && !_hoverboard.transition) return;

  // During mount: board hidden during crouch (0-20%), appears at jump peak, drops fast into position
  if (_hoverboard.transition === 'mount') {
    const t = Math.min(_hoverboard.transT / HOVER_MOUNT_DUR, 1);
    if (t < 0.3) {
      // Crouch + early jump phase — board hidden
      _hoverboard.el.style.opacity = '0';
      _hoverboard.el.style.left = (P.x - 20) + 'px';
      _hoverboard.el.style.top = (P.y - CHAR_H * 0.5) + 'px';
      return;
    }
    // Board appears at ~30% (near jump peak) and drops to feet by 85%
    const boardT = (t - 0.3) / 0.55; // 0-1 over the board drop phase (0.3 to 0.85)
    const bt = Math.min(1, boardT);
    const startY = P.y - CHAR_H * 0.7; // near upper torso at jump peak
    const endY = P.y - HOVER_FLOAT - 7;
    // Fast ease-out: board drops quickly then settles
    const dropEase = 1 - (1 - bt) * (1 - bt) * (1 - bt); // cubic ease-out
    const boardY = startY + (endY - startY) * dropEase;
    // Rotation: 90° → 0° with overshoot bounce
    const rotProgress = Math.min(1, bt * 1.4); // finishes rotation early
    const overshoot = bt > 0.7 ? Math.sin((bt - 0.7) / 0.3 * Math.PI) * -6 : 0;
    const rot = 90 * (1 - rotProgress) + overshoot;
    _hoverboard.el.style.left = (P.x - 20) + 'px';
    _hoverboard.el.style.top = boardY + 'px';
    _hoverboard.el.style.transform = `rotate(${rot.toFixed(1)}deg)` + (_playZoom !== 1 ? ` scale(${_playZoom})` : '');
    _hoverboard.el.style.transformOrigin = 'center center';
    _hoverboard.el.style.opacity = String(Math.min(1, boardT * 3)); // snap visible fast
    return;
  }
  // During dismount: board stays at feet during crouch, then flips up to torso and fades
  if (_hoverboard.transition === 'dismount') {
    const t = Math.min(_hoverboard.transT / HOVER_DISMOUNT_DUR, 1);
    if (t < 0.2) {
      // Crouch phase — board stays flat at feet, slight squish
      const ct = t / 0.2;
      _hoverboard.el.style.left = (P.x - 20) + 'px';
      _hoverboard.el.style.top = (P.y - HOVER_FLOAT - 7 + ct * 2) + 'px'; // slight dip with crouch
      _hoverboard.el.style.transform = 'rotate(0deg)' + (_playZoom !== 1 ? ` scale(${_playZoom})` : '');
      _hoverboard.el.style.transformOrigin = 'center center';
      _hoverboard.el.style.opacity = '1';
      return;
    }
    // Jump phase — board flips up from feet to torso, fades out
    const bt = (t - 0.2) / 0.8; // 0-1 over flip phase
    const startY = P.y - HOVER_FLOAT - 7;
    const endY = P.y - CHAR_H * 0.7;
    // Fast ease-in: board lifts slowly at first, then snaps up
    const flipEase = bt * bt;
    const boardY = startY + (endY - startY) * flipEase;
    const rot = 90 * flipEase;
    _hoverboard.el.style.left = (P.x - 20) + 'px';
    _hoverboard.el.style.top = boardY + 'px';
    _hoverboard.el.style.transform = `rotate(${rot.toFixed(1)}deg)` + (_playZoom !== 1 ? ` scale(${_playZoom})` : '');
    _hoverboard.el.style.transformOrigin = 'center center';
    _hoverboard.el.style.opacity = String(Math.max(0, 1 - bt * 1.3));
    return;
  }
  _hoverboard.el.style.opacity = '1';

  // Boost = Shift held, no cooldown (not while in tank — tank has its own boost)
  const _inTankNow = _isInTankFn && _isInTankFn();
  _hoverboard.boosting = !_inTankNow && _keys['Shift'] && (Math.abs(P.vx) > 0.2 || Math.abs(P.vy) > 0.2);
  // Board hum — fed per frame while riding; brightens on boost.
  if (_hoverboard.active) {
    sfxHold('board', { boost: _hoverboard.boosting });
    // Exhaust trail (MD 04) — throttled inside playmode.
    window._dexBoardFX?.(P.vx, P.vy, _hoverboard.boosting);
  }

  // Bob: very slow during boost, slow idle, moderate moving
  const moving = Math.abs(P.vx) > 0.2 || Math.abs(P.vy) > 0.2;
  const bobSpeed = _hoverboard.boosting ? 0.01 : moving ? 0.02 : 0.01;
  _hoverboard.bobT += bobSpeed * _dt;
  _hoverboard.bob = Math.sin(_hoverboard.bobT * 3) * (_hoverboard.boosting ? 1.5 : 2.5);

  // Tilt — reduced when not boosting
  const tiltScale = _hoverboard.boosting ? -12 : -7;
  const tiltTarget = P.vx * tiltScale;
  const maxTilt = _hoverboard.boosting ? 18 : 11;
  _hoverboard.tilt += (Math.max(-maxTilt, Math.min(maxTilt, tiltTarget)) - _hoverboard.tilt) * 0.12 * _dt;

  // Jump lag: board separates when character rises, reconnects at apex/descent
  // In play mode: jumpOffset is the visual-only Y offset (negative = up)
  // In sessions mode: jumpOffset is 0, lag is computed purely from P.vy
  const jOff = jumpOffset || 0;
  const inPM = _isPlayModeFn && _isPlayModeFn();
  if (inPM) {
    // Play mode: lag based on visual offset
    const rising = jOff < -2;
    const falling = jOff > 0 || P.grounded;
    if (rising) {
      const lagTarget = jOff * 0.35;
      _hoverboard.jumpLag += (lagTarget - _hoverboard.jumpLag) * 0.06 * _dt;
    } else if (falling) {
      _hoverboard.jumpLag += (0 - _hoverboard.jumpLag) * 0.15 * _dt;
      if (Math.abs(_hoverboard.jumpLag) < 0.3) _hoverboard.jumpLag = 0;
    }
  } else {
    // Sessions mode: lag based on vertical velocity — positive = board drops below character
    if (P.vy < -0.5 && !P.grounded) {
      // Rising — board lags behind (stays lower), proportional to jump speed
      // Bigger jumps = more separation (charge jumps can hit vy of -9)
      const lagTarget = Math.abs(P.vy) * 5;
      _hoverboard.jumpLag += (lagTarget - _hoverboard.jumpLag) * 0.05 * _dt;
      _hoverboard.jumpLag = Math.min(_hoverboard.jumpLag, 35); // allow substantial gap
    } else if (P.vy > 1) {
      // Falling fast — board starts catching up but slowly
      _hoverboard.jumpLag += (0 - _hoverboard.jumpLag) * 0.06 * _dt;
    } else if (P.grounded) {
      // Grounded — board reconnects more quickly
      _hoverboard.jumpLag += (0 - _hoverboard.jumpLag) * 0.12 * _dt;
      if (Math.abs(_hoverboard.jumpLag) < 0.3) _hoverboard.jumpLag = 0;
    }
  }
  // Play mode: offset from visual jump position; Sessions mode: small downward offset
  const boardJOff = inPM ? (jOff - _hoverboard.jumpLag) : _hoverboard.jumpLag;

  const boardScreenX = P.x;
  const boardScreenY = P.y - HOVER_FLOAT - 7 + _hoverboard.bob + boardJOff;
  _hoverboard.el.style.left = (boardScreenX - 20) + 'px';
  _hoverboard.el.style.top = boardScreenY + 'px';
  _hoverboard.el.style.transform = `rotate(${_hoverboard.tilt.toFixed(1)}deg)` + (_playZoom !== 1 ? ` scale(${_playZoom})` : '');
  _hoverboard.el.style.transformOrigin = 'center top';

  // Thruster effect — subtle pulse particles beneath the board
  const thrusterY = boardScreenY + 10; // just below the board SVG
  const thrusterInterval = _hoverboard.boosting ? 4 : 8;
  if (_frameCount % thrusterInterval === 0) {
    const clr = getAccent();
    // 1-2 small particles drifting down and slightly back
    const pCount = _hoverboard.boosting ? 2 : 1;
    for (let ti = 0; ti < pCount; ti++) {
      const tp = document.createElement('div');
      const tiltRad = (_hoverboard.tilt || 0) * Math.PI / 180;
      const ox = (Math.random() - 0.5) * 20; // spread across board width
      const tx = ox * 0.3 + Math.sin(tiltRad) * -6 + (P.vx > 0 ? -3 : P.vx < 0 ? 3 : 0);
      const ty = 6 + Math.random() * 8;
      const dur = 0.3 + Math.random() * 0.25;
      const sz = 1 + Math.random() * 1.5;
      // Mostly accent color, occasional brighter pulse
      const pulse = Math.random() < 0.15;
      const bg = pulse
        ? `color-mix(in hsl, ${clr} 60%, white 40%)`
        : `color-mix(in hsl, ${clr} 85%, white 15%)`;
      tp.style.cssText = `position:fixed;left:${boardScreenX + ox}px;top:${thrusterY}px;width:${sz}px;height:${sz}px;border-radius:50%;background:${bg};pointer-events:none;z-index:149;opacity:${pulse ? 0.5 : 0.3};transition:transform ${dur}s ease-out,opacity ${dur}s ease-out;`;
      document.body.appendChild(tp);
      requestAnimationFrame(() => { tp.style.transform = `translate(${tx}px,${ty}px)`; tp.style.opacity = '0'; });
      setTimeout(() => tp.remove(), dur * 1000 + 50);
    }
    // Pulse ring every ~30 frames — subtle expanding ring
    if (_frameCount % 30 === 0) {
      const ring = document.createElement('div');
      const ringSize = 8;
      ring.style.cssText = `position:fixed;left:${boardScreenX - ringSize / 2}px;top:${thrusterY}px;width:${ringSize}px;height:${ringSize * 0.4}px;border-radius:50%;border:1px solid ${clr};pointer-events:none;z-index:149;opacity:0.25;transition:transform 0.5s ease-out,opacity 0.5s ease-out;`;
      document.body.appendChild(ring);
      requestAnimationFrame(() => { ring.style.transform = 'scaleX(2.5) scaleY(1.8) translateY(6px)'; ring.style.opacity = '0'; });
      setTimeout(() => ring.remove(), 550);
    }
  }

  // Streamline trail particles — spawn from head to hip area, trail behind
  if (moving && _frameCount % (_hoverboard.boosting ? 10 : 10) === 0) {
    const dir = P.vx > 0 ? -1 : P.vx < 0 ? 1 : 0;
    if (dir !== 0) {
      const clr = getAccent();
      const count = 1;
      // Use the actual visual top of character (accounts for jumpOffset + hover float)
      const visualTop = P.y - CHAR_H - (HOVER_FLOAT - _hoverboard.bob) + (jOff || 0);
      for (let i = 0; i < count; i++) {
        const spark = document.createElement('div');
        // Spawn from head to hip only — skip legs/board area
        const spawnY = visualTop + Math.random() * (CHAR_H * 0.6);
        const sz = 1.5 + Math.random() * 2;
        const tx = dir * (25 + Math.random() * 40);
        const ty = (Math.random() - 0.5) * 4;
        const dur = _hoverboard.boosting ? (0.5 + Math.random() * 0.4) : (0.35 + Math.random() * 0.25);
        // Color: mostly primary, rare lighter accent (never full white)
        const roll = Math.random();
        const bright = roll < 0.85 ? Math.floor(Math.random() * 15) : (20 + Math.floor(Math.random() * 25));
        const w = _hoverboard.boosting ? (8 + Math.random() * 10) : (3 + Math.random() * 4);
        spark.style.cssText = `position:fixed;left:${P.x}px;top:${spawnY}px;width:${w}px;height:${sz}px;border-radius:${w}px;background:color-mix(in hsl,${clr} ${100-bright}%,white ${bright}%);pointer-events:none;z-index:147;opacity:${_hoverboard.boosting ? 0.5 : 0.35};transition:transform ${dur}s ease-out,opacity ${dur}s ease-out;`;
        document.body.appendChild(spark);
        requestAnimationFrame(() => { spark.style.transform = `translate(${tx}px,${ty}px)`; spark.style.opacity = '0'; });
        setTimeout(() => spark.remove(), dur * 1000 + 50);
      }
    }
  }
}

// ── Bow & Arrow ──
const _bow = { drawing: false, chargeT: 0, angle: 0, shaking: false, holstered: false };
const MAX_BOW_CHARGE = 90;
const BOW_MIN_SPEED = 8, BOW_MAX_SPEED = 22;
const BOW_MIN_GRAV = 0.25, BOW_MAX_GRAV = 0.06;
const _arrows = [];
const GUN_RANGE = 40;

function _spawnGunPickup() {
  const baseX = 140;
  const floorY = getCanvasFloorY();
  const types = ['pistol', 'shotgun', 'smg', 'rifle', 'sword', 'rocket', 'pufferLauncher', 'spellbook'];
  types.forEach((type, i) => {
    const x = baseX + i * 55;
    const cfg = GUN_TYPES[type];
    const el = document.createElement('div');
    el.className = 'gun-pickup';
    el.innerHTML = `<svg width="28" height="14" viewBox="0 0 28 14" style="display:block" stroke="var(--clr-adj,#7B8A9C)" stroke-linecap="round" fill="none">
      ${cfg.svg}
    </svg>`;
    el.style.cssText = `position:fixed;left:${x}px;top:${floorY - 12}px;pointer-events:none;z-index:149;`;
    document.body.appendChild(el);
    const prompt = document.createElement('div');
    prompt.textContent = 'E';
    prompt.className = 'gun-prompt';
    prompt.style.cssText = `position:fixed;left:${x+4}px;top:${floorY - 30}px;font-size:11px;font-family:var(--fn);color:var(--clr-adj,#7B8A9C);opacity:0;transition:opacity 0.2s;pointer-events:none;z-index:149;background:var(--bg2,#16171b);border:1px solid var(--bdr,#28292f);border-radius:4px;padding:1px 5px;`;
    document.body.appendChild(prompt);
    _pickups.push({ type, x, y: floorY, el, promptEl: prompt });
  });
}

function _pickupGun(pickup) {
  _gun.held = true;
  _gun.type = pickup.type;
  _gun._pickup = pickup;
  pickup.el.style.display = 'none';
  pickup.promptEl.style.opacity = '0';
  const ns = 'http://www.w3.org/2000/svg';
  _gun.svgLine = document.createElementNS(ns, 'line');
  _gun.svgLine.setAttribute('id', _uid + '-gun');
  _gun.svgLine.setAttribute('stroke', 'var(--char-clr,var(--clr-adj,#7B8A9C))');
  _gun.svgLine.setAttribute('stroke-width', '2.5');
  _gun.svgLine.setAttribute('stroke-linecap', 'round');
  _gun.svgLine.setAttribute('x1', '18'); _gun.svgLine.setAttribute('y1', '20');
  _gun.svgLine.setAttribute('x2', '36'); _gun.svgLine.setAttribute('y2', '20');
  const svgG = _svgEl?.querySelector('g');
  if (svgG) svgG.appendChild(_gun.svgLine);
}

function _dropGun() {
  if (!_gun.held) return;
  _stopLaser();
  _gun.held = false;
  if (_gun._swordEl) { _gun._swordEl.remove(); _gun._swordEl = null; }
  if (_gun._swordTrail) { _gun._swordTrail.remove(); _gun._swordTrail = null; }
  if (_gun._pumpEl) { _gun._pumpEl.remove(); _gun._pumpEl = null; }
  _gun._pumpT = 0;
  _gun._swordAnim = null;
  _gun._swordTrailT = 0;
  _gun._swordChargeT = 0;
  _gun._swordChargeCued = false;
  if (_gun.svgLine) { _gun.svgLine.remove(); _gun.svgLine = null; }
  // Weapon returns to inventory (no visible drop on canvas)
  _gun.type = null;
  _gun._pickup = null;
}

// `advance` is true only from the frame loops — mousemove also calls this
// to re-aim, and must not advance swing animation time (pre-MD 11 the
// sword clock ticked on every mousemove, so waving the cursor fast-
// forwarded the swing).
function _updateGunAim(mouseX, mouseY, advance) {
  if (!_gun.held || !_gun.svgLine) return;
  const torso = _el('torso');
  const sY = torso ? parseFloat(torso.getAttribute('y1')) : 14;
  const hipY = torso ? parseFloat(torso.getAttribute('y2')) : 30;
  const cfg = _gun.type ? GUN_TYPES[_gun.type] : null;
  const gripUp = cfg ? cfg.gripUp : 4;
  const gripY = hipY - gripUp;

  // Aim at cursor — melee and ranged alike (the sword tracks the mouse the
  // way a gun does; only the attack differs).
  const charScreenX = P.x;
  const charScreenY = P.y - CHAR_H + gripY;
  const dx = mouseX - charScreenX;
  const dy = mouseY - charScreenY;
  _gun.angle = Math.atan2(dy, dx);

  if (cfg && cfg.melee) {
    _updateSword(cfg, gripY, advance);
    return;
  }

  // RANGED WEAPONS
  const cosA = Math.cos(_gun.angle);
  const sinA = Math.sin(_gun.angle);
  const dirX = flipX ? -cosA : cosA;
  const dirY = sinA;

  const gunLen = cfg ? cfg.barrelLen : 18;
  const kick = _gun._kickback > 0 ? Math.min(_gun._kickback / 4, 1) * 4 : 0;
  const x1 = 18 - dirX * kick, y1 = gripY - dirY * kick;
  const x2 = x1 + dirX * gunLen;
  const y2 = y1 + dirY * gunLen;
  _gun.svgLine.setAttribute('x1', x1); _gun.svgLine.setAttribute('y1', y1);
  _gun.svgLine.setAttribute('x2', x2); _gun.svgLine.setAttribute('y2', y2);
  if (_gun._kickback > 0) _gun._kickback -= _dt;

  // SHOTGUN pump-rack (MD 14) — a foregrip tick riding under the barrel
  // that racks back and returns after each shot, with the chk-chk at the
  // turnaround. Purely visual; created lazily like the sword's extras.
  if (_gun.type === 'shotgun') {
    let pump = _gun._pumpEl;
    if (!pump) {
      pump = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      pump.setAttribute('stroke', 'var(--char-clr,var(--clr-adj,#7B8A9C))');
      pump.setAttribute('stroke-width', '2.6');
      pump.setAttribute('stroke-linecap', 'round');
      _gun.svgLine.parentNode?.appendChild(pump);
      _gun._pumpEl = pump;
    }
    let slide = 0;
    if (_gun._pumpT > 0) {
      const t = 1 - _gun._pumpT / 36;
      slide = Math.sin(t * Math.PI) * 5;            // back, then forward
      if (!_gun._pumpSfx && t >= 0.5) { _gun._pumpSfx = true; sfx('shotgun.pump'); }
      _gun._pumpT -= _dt;
    }
    const pd = 12 - slide, off = 2.6;               // along-barrel position, below-barrel offset
    pump.setAttribute('x1', (x1 + dirX * pd - dirY * off).toFixed(1));
    pump.setAttribute('y1', (y1 + dirY * pd + dirX * off).toFixed(1));
    pump.setAttribute('x2', (x1 + dirX * (pd + 4.5) - dirY * off).toFixed(1));
    pump.setAttribute('y2', (y1 + dirY * (pd + 4.5) + dirX * off).toFixed(1));
  }

  // Store grip and muzzle positions for arm override
  _gun._gripSvgX = x1; _gun._gripSvgY = y1;
  _gun._muzzleSvgX = x2; _gun._muzzleSvgY = y2;
  _gun._dirX = dirX; _gun._dirY = dirY;
}

// ── SWORD (MD 11 rework) ─────────────────────────────────
// The sword is a small SVG group (tapered blade, fuller, swept guard,
// grip, pommel) authored along +x with the hand at the origin and the
// tip at x = barrelLen; each frame only its transform changes. Attacks
// are a tiny state machine on _gun._swordAnim: a wind-up (anticipation —
// the blade pulls back / cocks past the arc start), a strike frame where
// the hit test fires, then follow-through. Both attacks aim at the live
// cursor angle; a swipe leaves an accent-colored arc trail.
const SWORD_JAB_WINDUP = 8,    SWORD_JAB_DUR = 30;   // 240Hz-reference frames
const SWORD_SWIPE_WINDUP = 11, SWORD_SWIPE_DUR = 46;
const SWORD_SWIPE_ARC = 1.15;  // swipe sweeps ±this around the aim (rad)
const SWORD_JAB_LUNGE = 14;    // px the blade thrusts past rest reach
const SWORD_TRAIL_FADE = 12;   // frames the swipe trail lingers
// Charged power swipe: hold the click and the blade slowly winds backwards,
// opposite the cursor; release sweeps it through a wider, longer-reaching
// arc with extra damage and knockback. The delay keeps spam clicks from
// ever showing a charge.
const SWORD_CHARGE_DELAY = 30;  // held frames (~125ms) before charging begins
const SWORD_CHARGE_DUR = 130;   // frames from charge start to full power (~0.55s)
const SWORD_CHARGE_MIN = 0.22;  // release below this fraction → no power swipe
const SWORD_POWER_BACK = 2.2;   // full-charge wind-back angle (rad)
const SWORD_POWER_DUR = 54;     // power swipe swing duration

function _ensureSwordEls() {
  if (_gun._swordEl) return;
  const ns = 'http://www.w3.org/2000/svg';
  const clr = 'var(--char-clr,var(--clr-adj,#7B8A9C))';
  // Trail is appended first so the blade draws over it.
  const trail = document.createElementNS(ns, 'path');
  trail.setAttribute('stroke', 'var(--accent, #68d121)');
  trail.setAttribute('stroke-width', '4.5');
  trail.setAttribute('stroke-linecap', 'round');
  trail.setAttribute('fill', 'none');
  trail.setAttribute('opacity', '0');
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('stroke', clr);
  g.setAttribute('stroke-linecap', 'round');
  g.setAttribute('stroke-linejoin', 'round');
  g.setAttribute('fill', 'none');
  g.innerHTML =
    `<circle cx="-4.6" cy="0" r="1.6" fill="${clr}" stroke="none"/>` +
    `<line x1="-3.2" y1="0" x2="0.6" y2="0" stroke-width="3"/>` +
    `<path d="M1.6,-4.6 Q4.2,0 1.6,4.6" stroke-width="2"/>` +
    `<path d="M3,-2.4 L23,-1.6 L34,0 L23,1.6 L3,2.4 Z" stroke-width="1.1" fill="${clr}" fill-opacity="0.3"/>` +
    `<line x1="5" y1="0" x2="26" y2="0" stroke-width="0.8" opacity="0.45"/>`;
  const parent = _gun.svgLine?.parentNode;
  if (parent) { parent.appendChild(trail); parent.appendChild(g); }
  _gun._swordEl = g;
  _gun._swordTrail = trail;
  // The generic gun line stays as the drop-cleanup anchor but never shows.
  _gun.svgLine?.setAttribute('display', 'none');
}

function _swordArcPath(cx, cy, r, a0, a1) {
  const n = 12; let d = '';
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    d += (i ? 'L' : 'M') + (cx + Math.cos(a) * r).toFixed(1) + ' ' + (cy + Math.sin(a) * r).toFixed(1);
  }
  return d;
}

function _updateSword(cfg, gripY, advance) {
  _ensureSwordEls();
  const bladeLen = cfg.barrelLen || 34;
  let effAngle = _gun.angle, ext = 0;
  const anim = _gun._swordAnim;
  if (anim) {
    if (anim.kind === 'jab') {
      if (anim.t < anim.windup) {
        // Anticipation: pull the blade back before the thrust.
        ext = -4 * Math.sin((anim.t / anim.windup) * Math.PI / 2);
      } else {
        const t = Math.min((anim.t - anim.windup) / (anim.dur - anim.windup), 1);
        ext = Math.sin(t * Math.PI) * SWORD_JAB_LUNGE;
      }
    } else {
      // Swipe sweeps from aim+a0 to aim+a1 (a normal swipe cocks back to
      // a0 during the wind-up; a power swipe starts already wound back).
      if (anim.t < anim.windup) {
        const w = anim.t / anim.windup;
        effAngle = _gun.angle + anim.a0 * w * (2 - w);
      } else {
        const t = Math.min((anim.t - anim.windup) / (anim.dur - anim.windup), 1);
        const e = 1 - Math.pow(1 - t, 3);          // fast strike, slow follow-through
        effAngle = _gun.angle + anim.a0 + (anim.a1 - anim.a0) * e;
        ext = Math.sin(t * Math.PI) * (anim.power ? 6 : 4);
      }
    }
  } else if (_mouseHeld && _gun._swordChargeT > SWORD_CHARGE_DELAY) {
    // CHARGING — the click is being held: the blade slowly winds backwards,
    // opposite the cursor. Release fires the power swipe (mouseup handler →
    // _swordPowerRelease). Trembles once fully charged.
    const cf = Math.min((_gun._swordChargeT - SWORD_CHARGE_DELAY) / SWORD_CHARGE_DUR, 1);
    effAngle = _gun.angle - SWORD_POWER_BACK * cf * (2 - cf);
    ext = -3 * cf;
    if (cf >= 1) {
      effAngle += Math.sin(_gun._swordChargeT * 0.45) * 0.045;
      if (!_gun._swordChargeCued) { _gun._swordChargeCued = true; sfx('melee.swordReady'); }
    }
  }
  const cosS = Math.cos(effAngle), sinS = Math.sin(effAngle);
  const sdirX = flipX ? -cosS : cosS;
  const sdirY = sinS;
  const gx = 18 + sdirX * ext, gy = gripY + sdirY * ext;   // a lunge moves the whole sword
  const deg = Math.atan2(sdirY, sdirX) * 180 / Math.PI;
  _gun._swordEl.setAttribute('transform', `translate(${gx.toFixed(2)},${gy.toFixed(2)}) rotate(${deg.toFixed(2)})`);
  _gun._gripSvgX = gx; _gun._gripSvgY = gy;
  _gun._muzzleSvgX = gx + sdirX * bladeLen; _gun._muzzleSvgY = gy + sdirY * bladeLen;
  _gun._dirX = sdirX; _gun._dirY = sdirY;

  // Swipe trail — an arc at blade-tip radius from the strike's start
  // angle to the blade's current angle, fading once the swing ends.
  const trail = _gun._swordTrail;
  const striking = anim && anim.kind === 'swipe' && anim.t >= anim.windup;
  if (striking) {
    const locA = Math.atan2(sdirY, sdirX);
    if (anim._a0 == null) anim._a0 = locA;
    // A power swipe cuts a thicker, brighter, longer-lingering trail.
    trail.setAttribute('stroke-width', anim.power ? '7' : '4.5');
    trail.setAttribute('d', _swordArcPath(18, gripY, bladeLen * (anim.power ? 1.05 : 0.94), anim._a0, locA));
    _gun._swordTrailPeak = anim.power ? 0.65 : 0.5;
    _gun._swordTrailMax = SWORD_TRAIL_FADE + (anim.power ? 8 : 0);
    _gun._swordTrailT = _gun._swordTrailMax;
    trail.setAttribute('opacity', String(_gun._swordTrailPeak));
  } else if (_gun._swordTrailT > 0) {
    const fmax = _gun._swordTrailMax || SWORD_TRAIL_FADE;
    trail.setAttribute('opacity', (_gun._swordTrailPeak * _gun._swordTrailT / fmax).toFixed(3));
    if (advance) _gun._swordTrailT = Math.max(0, _gun._swordTrailT - _dt);
    if (_gun._swordTrailT <= 0) trail.setAttribute('opacity', '0');
  }

  if (advance) {
    if (anim) {
      anim.t += _dt;
      // The strike lands when the wind-up ends — hit test + FX fire once.
      if (!anim.struck && anim.t >= anim.windup) { anim.struck = true; _swordStrike(anim.kind, anim.power); }
      if (anim.t >= anim.dur) _gun._swordAnim = null;
    } else if (_mouseHeld) {
      // Held past the swing — accumulate power charge.
      _gun._swordChargeT += _dt;
    }
  }
}

// Power swipe — fired from the mouseup handler when a held charge is
// released. The blade is already wound back (the charge pose), so the
// wind-up is token; the sweep runs from the wound-back angle through a
// wider-than-normal arc. Everything scales with charge fraction.
function _swordPowerRelease() {
  const cfg = _gun.type && GUN_TYPES[_gun.type];
  const chargeT = _gun._swordChargeT;
  _gun._swordChargeT = 0;
  _gun._swordChargeCued = false;
  if (!_gun.held || !cfg || !cfg.melee || _gun._swordAnim) return;
  const cf = Math.min((chargeT - SWORD_CHARGE_DELAY) / SWORD_CHARGE_DUR, 1);
  if (cf < SWORD_CHARGE_MIN) return;   // just a long-ish click — the mousedown swing already happened
  if (_isPlayerStunnedFn && _isPlayerStunnedFn()) return;
  if (_isChatOpenFn && _isChatOpenFn()) return;
  _trackAction();
  _gun._swordLast = 'swipe';
  _gun._swordAnim = { kind: 'swipe', t: 0, windup: 2, dur: SWORD_POWER_DUR, struck: false,
                      power: cf, a0: -SWORD_POWER_BACK * cf * (2 - cf), a1: 1.35 + 0.45 * cf, _a0: null };
  sfx('melee.sword', { jab: false, power: cf });
}

// One sword strike — fired from the animation at the end of the wind-up,
// so damage lands when the blade visually arrives, not on mousedown. Aim
// is read live (_gun.angle), so the strike tracks the cursor through the
// wind-up. hitTestCreatures / _hitCreature apply their own impact FX; a
// connect adds a small hit-stop on top.
function _swordStrike(kind, power) {
  const cfg = GUN_TYPES[_gun.type] || GUN_TYPES.sword;
  const bladeLen = cfg.barrelLen || 34;
  const gripScreenY = P.y - CHAR_H + (_gun._gripSvgY || 26);
  const baseAngle = _gun.angle;
  const reach = bladeLen + (kind === 'jab' ? SWORD_JAB_LUNGE + 4 : 6 + (power ? 18 * power : 0));
  // Sample points along the attack: the jab tests three depths on the aim
  // line, the swipe fans across its arc (outer sweep + an inner ring so
  // point-blank targets aren't stepped over; the power swipe fans wider to
  // match its bigger arc). First hit wins so one swing can't multi-hit a
  // creature.
  const pts = [];
  if (kind === 'jab') {
    for (const d of [1, 0.62, 0.3]) {
      pts.push([P.x + Math.cos(baseAngle) * reach * d, gripScreenY + Math.sin(baseAngle) * reach * d]);
    }
  } else {
    const outer = power ? [-1.35, -0.9, -0.5, -0.15, 0.15, 0.5, 0.9, 1.35] : [-0.95, -0.55, -0.18, 0.18, 0.55, 0.95];
    const inner = power ? [-0.7, 0, 0.7] : [-0.5, 0, 0.5];
    for (const off of outer) {
      pts.push([P.x + Math.cos(baseAngle + off) * reach, gripScreenY + Math.sin(baseAngle + off) * reach]);
    }
    for (const off of inner) {
      pts.push([P.x + Math.cos(baseAngle + off) * reach * 0.55, gripScreenY + Math.sin(baseAngle + off) * reach * 0.55]);
    }
  }
  const inPM = _isPlayModeFn && _isPlayModeFn();
  // Power swipes hit harder: 2 (normal sword/arrow damage) up to 5 at full
  // charge, via hitTestCreatures' damage override.
  const dmgOv = power ? Math.round(2 + 3 * power) : undefined;
  let hit = null;
  for (const [hx, hy] of pts) {
    if (inPM && _hitPlayCreaturesFn) {
      hit = _hitPlayCreaturesFn(hx, hy, false, Math.cos(baseAngle) * 2, Math.sin(baseAngle) * 2, true, dmgOv);
    } else {
      hit = _hitCreature(hx, hy, true, false);
    }
    if (hit) break;
  }
  // Power swipe knockback — same per-kind multipliers as the puffer AOE
  // (mammoths barely budge, birds/puffers are exempt), carried along the
  // swing direction with a touch of pop-up.
  if (hit && power && inPM && typeof hit === 'object' && !hit.dead) {
    const kbMult = hit.kind === 'mammoth' ? 0.2 : (hit.kind === 'bird' || hit.kind === 'puffer') ? 0 : 1;
    const kb = (3 + 5 * power) * kbMult;
    hit.vx += Math.cos(baseAngle) * kb;
    hit.vy += Math.sin(baseAngle) * kb * 0.5 - kb * 0.35;
  }
  // Feel: hit-stop on connect scaled to the attack (kills/headshots add a
  // bigger one in the hit FX — _dexHitStop keeps whichever is larger).
  if (hit) window._dexHitStop?.(power ? 9 : kind === 'jab' ? 5 : 4, power ? 0.22 : 0.3);
  // Strike FX along the swing — jab gets a tight forward snap, swipe a
  // wide glint fan, power swipe a bigger fan plus screen shake (cases in
  // playmode's _dexMuzzleFX).
  const fxX = P.x + Math.cos(baseAngle) * reach * 0.7;
  const fxY = gripScreenY + Math.sin(baseAngle) * reach * 0.7;
  if (window._dexMuzzleFX && inPM && _screenToWorldFn) {
    const w = _screenToWorldFn(fxX, fxY);
    window._dexMuzzleFX(w.wx, w.wy, baseAngle, power ? 'swordPower' : kind === 'jab' ? 'swordJab' : 'sword');
  } else if (window._dexPlatFX) {
    window._dexPlatFX('muzzle', fxX, fxY, baseAngle, 'sword');
  }
}

// Override arms to hold the gun — called after pose each frame
function _syncArmsToGun() {
  if (!_gun.held) return;
  const gx = _gun._gripSvgX || 18;
  const gy = _gun._gripSvgY || 20;
  const mx = _gun._muzzleSvgX || 36;
  const my = _gun._muzzleSvgY || 20;
  const dirX = _gun._dirX || 1;
  const dirY = _gun._dirY || 0;

  // Read current shoulder from torso
  const torso = _el('torso');
  const sY = torso ? parseFloat(torso.getAttribute('y1')) : 14;

  // Both arms reach toward the gun grip/barrel
  // Back hand at grip, front hand further along barrel
  const backHandX = gx + dirX * 2;
  const backHandY = gy + dirY * 2;
  const frontHandX = gx + dirX * 10;
  const frontHandY = gy + dirY * 10;

  // Left arm: upper from shoulder to midpoint, lower to back hand
  const lMidX = 18 + (backHandX - 18) * 0.5 - 2;
  const lMidY = sY + (backHandY - sY) * 0.5;
  _setLine('upper-arm-left', 18, sY, lMidX, lMidY);
  _setLine('lower-arm-left', lMidX, lMidY, backHandX, backHandY);

  // Right arm: upper from shoulder to midpoint, lower to front hand
  const rMidX = 18 + (frontHandX - 18) * 0.5 + 2;
  const rMidY = sY + (frontHandY - sY) * 0.5;
  _setLine('upper-arm-right', 18, sY, rMidX, rMidY);
  _setLine('lower-arm-right', rMidX, rMidY, frontHandX, frontHandY);
}

// ── Laser beam functions ──
let _laserPhase = 0;     // sine wave phase
let _laserExtend = 0;    // grow-out progress (0 to 1)

function _startLaser() {
  if (_laser.active) return;
  _laser.active = true;
  _laser.dmgTimer = 0;
  // Re-engaging mid-retract resumes from the current length — feels like
  // catching the beam on its way back in. Otherwise grow from zero.
  if (!_laser.retracting) { _laserExtend = 0; _laserPhase = 0; }
  _laser.retracting = false;
  // Create SVG beam element
  if (!_laser.beamEl) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:148;overflow:visible;';
    const defs = document.createElementNS(ns, 'defs');
    const filter = document.createElementNS(ns, 'filter');
    filter.id = 'laser-glow';
    filter.innerHTML = '<feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>';
    defs.appendChild(filter);
    svg.appendChild(defs);
    // Core beam path
    const path = document.createElementNS(ns, 'path');
    path.id = 'laser-core';
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('filter', 'url(#laser-glow)');
    svg.appendChild(path);
    // Outer glow path (wider, more transparent)
    const outer = document.createElementNS(ns, 'path');
    outer.id = 'laser-outer';
    outer.setAttribute('fill', 'none');
    outer.setAttribute('stroke-linecap', 'round');
    outer.setAttribute('opacity', '0.22');
    svg.appendChild(outer);
    // Helix partner strand (MD 12) — same wave mirrored, so the two cores
    // cross over each other down the beam.
    const helix = document.createElementNS(ns, 'path');
    helix.id = 'laser-helix';
    helix.setAttribute('fill', 'none');
    helix.setAttribute('stroke-linecap', 'round');
    helix.setAttribute('opacity', '0.55');
    svg.appendChild(helix);
    _laser.beamEl = svg;
    document.body.appendChild(svg);
  }
  // Impact glow
  if (!_laser.glowEl) {
    _laser.glowEl = document.createElement('div');
    document.body.appendChild(_laser.glowEl);
  }
  _laser.beamEl.style.display = '';
  _laser.glowEl.style.display = '';
}

function _stopLaser() {
  if (!_laser.active) return;
  _laser.active = false;
  sfxHoldStop('laser');
  // MD 12: the beam retracts back into the muzzle instead of vanishing —
  // _tickLaser keeps animating while `retracting` is set. The impact glow
  // dies immediately (nothing is being hit any more).
  _laser.retracting = _laserExtend > 0;
  if (_laser.glowEl) _laser.glowEl.style.display = 'none';
  if (!_laser.retracting && _laser.beamEl) _laser.beamEl.style.display = 'none';
}

// The beam geometry drawn as three strands: two sine cores that mirror
// each other (crossing over like a helix) and a wide soft outer glow
// following the centerline. Shared by the live beam and the retract
// animation.
function _drawLaserBeam(muzzleX, muzzleY, cosA, sinA, dist) {
  if (!_laser.beamEl) return;
  const core = _laser.beamEl.querySelector('#laser-core');
  const helix = _laser.beamEl.querySelector('#laser-helix');
  const outer = _laser.beamEl.querySelector('#laser-outer');
  if (!core || !outer) return;
  const clr = getAccent();
  const perpX = -sinA, perpY = cosA;
  const segs = Math.max(10, Math.round(dist / 10));
  let d1 = `M${muzzleX.toFixed(1)},${muzzleY.toFixed(1)}`;
  let d2 = d1, d0 = d1;
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const baseX = muzzleX + cosA * dist * t;
    const baseY = muzzleY + sinA * dist * t;
    // Amplitude swells from ~2px at the muzzle to ~9px downrange, and
    // breathes with the phase; the wave itself crawls along the beam.
    const amp = (2 + t * 7) * (0.75 + Math.sin(_laserPhase * 2 + t * 4) * 0.25);
    const wave = Math.sin(_laserPhase * 7 + t * 16) * amp;
    d1 += ` L${(baseX + perpX * wave).toFixed(1)},${(baseY + perpY * wave).toFixed(1)}`;
    d2 += ` L${(baseX - perpX * wave).toFixed(1)},${(baseY - perpY * wave).toFixed(1)}`;
    d0 += ` L${baseX.toFixed(1)},${baseY.toFixed(1)}`;
  }
  const flicker = 0.75 + Math.random() * 0.25;
  core.setAttribute('d', d1);
  core.setAttribute('stroke', clr);
  core.setAttribute('stroke-width', String(2.2 + Math.sin(_laserPhase * 3) * 0.5));
  core.setAttribute('opacity', String(flicker));
  if (helix) {
    helix.setAttribute('d', d2);
    helix.setAttribute('stroke', clr);
    helix.setAttribute('stroke-width', '1.6');
  }
  outer.setAttribute('d', d0);
  outer.setAttribute('stroke', clr);
  outer.setAttribute('stroke-width', '10');
}

function _tickLaser() {
  if (_laser.active && (!_gun.held || !GUN_TYPES[_gun.type]?.isLaser)) _stopLaser();
  if (!_laser.active) {
    // Retract animation — the beam pulls back into the muzzle (from the
    // live muzzle while the gun is still out, else from where it last was).
    if (_laser.retracting) {
      _laserExtend = Math.max(_laserExtend - 0.035 * _dt, 0);
      _laserPhase += 0.12 * _dt;
      if (_laserExtend <= 0) {
        _laser.retracting = false;
        if (_laser.beamEl) _laser.beamEl.style.display = 'none';
      } else {
        let mx = _laser.lastMX, my = _laser.lastMY, cA = _laser.lastCos, sA = _laser.lastSin;
        if (_gun.held && GUN_TYPES[_gun.type]?.isLaser) {
          cA = Math.cos(_gun.angle); sA = Math.sin(_gun.angle);
          mx = P.x + cA * 22;
          my = (P.y - CHAR_H + (GUN_TYPES[_gun.type].gripUp || 8) + 14) + sA * 22;
        }
        _drawLaserBeam(mx, my, cA, sA, _laser.lastDist * _laserExtend);
      }
    }
    return;
  }

  // Sustained hum with attack/release — fed every frame; audio.js releases
  // it when the calls stop (or _stopLaser cuts it explicitly).
  sfxHold('laser');

  // Grow-out: the beam extends deliberately, not instantly (MD 12: ~0.35s
  // to full range at the 240Hz reference).
  _laserExtend = Math.min(_laserExtend + 0.012 * _dt, 1);
  _laserPhase += 0.14 * _dt;

  const gripSvgY = GUN_TYPES[_gun.type].gripUp || 8;
  const baseAngle = _gun.angle;
  const cosA = Math.cos(baseAngle), sinA = Math.sin(baseAngle);
  const muzzleX = P.x + cosA * 22;
  const muzzleY = (P.y - CHAR_H + gripSvgY + 14) + sinA * 22;

  // Raycast: check creatures along the beam path
  let hitDist = LASER_RANGE;
  let hitCreature = null;
  const _inPM = _isPlayModeFn && _isPlayModeFn();

  const steps = 30;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const checkX = muzzleX + cosA * LASER_RANGE * t;
    const checkY = muzzleY + sinA * LASER_RANGE * t;

    if (!_inPM) {
      for (const c of _creatures) {
        if (c.dead) continue;
        const cx = c.kind === 'bird' ? c.x + 10 : c.x + 14;
        const cy = c.kind === 'bird' ? c.y + 6 : c.y + 10;
        const hw = c.kind === 'bird' ? 15 : 12;
        const hh = c.kind === 'bird' ? 11 : 7;
        if (Math.abs(checkX - cx) < hw && Math.abs(checkY - cy) < hh) {
          hitDist = LASER_RANGE * t;
          hitCreature = c;
          break;
        }
      }
    }
    if (_inPM && window._dexProbeCreature) {
      // Side-effect-free probe (MD 12) — the old code called the damaging
      // hit test here every frame, which made the laser an insta-kill.
      const c = window._dexProbeCreature(checkX, checkY);
      if (c) {
        hitDist = LASER_RANGE * t;
        hitCreature = c;
        break;
      }
    }
    if (hitCreature) break;
    if (checkX < 0 || checkX > window.innerWidth || checkY < 0 || checkY > window.innerHeight) { hitDist = LASER_RANGE * t; break; }
  }

  // Apply grow-out — beam only extends as far as _laserExtend allows
  const effectiveDist = hitDist * _laserExtend;
  const endX = muzzleX + cosA * effectiveDist;
  const endY = muzzleY + sinA * effectiveDist;
  _laser.hitX = endX; _laser.hitY = endY;
  // Remember geometry so the retract animation can play after release.
  _laser.lastMX = muzzleX; _laser.lastMY = muzzleY;
  _laser.lastCos = cosA; _laser.lastSin = sinA;
  _laser.lastDist = hitDist;

  const clr = getAccent();
  _drawLaserBeam(muzzleX, muzzleY, cosA, sinA, effectiveDist);

  // Impact glow — big bright circle at hit point
  if (_laser.glowEl && _laserExtend > 0.3) {
    const glowSz = 28 + Math.sin(_laserPhase * 4) * 6;
    _laser.glowEl.style.cssText = `position:fixed;left:${endX - glowSz/2}px;top:${endY - glowSz/2}px;width:${glowSz}px;height:${glowSz}px;border-radius:50%;pointer-events:none;z-index:148;background:radial-gradient(circle,color-mix(in hsl,${clr} 30%,white 70%) 0%,color-mix(in hsl,${clr} 60%,white 40%) 30%,transparent 70%);box-shadow:0 0 12px ${clr},0 0 24px ${clr};opacity:${0.7 + Math.random()*0.3};`;
  } else if (_laser.glowEl) {
    _laser.glowEl.style.display = 'none';
  }

  // Ambient particles drifting along the beam
  if (_frameCount % 3 === 0 && effectiveDist > 20) {
    const t = Math.random();
    const bx = muzzleX + cosA * effectiveDist * t;
    const by = muzzleY + sinA * effectiveDist * t;
    const spark = document.createElement('div');
    const sz = 2 + Math.random() * 3;
    const driftX = (-sinA + (Math.random()-0.5)*0.8) * (4 + Math.random()*6);
    const driftY = (cosA + (Math.random()-0.5)*0.8) * (4 + Math.random()*6);
    const dur = 0.25 + Math.random() * 0.25;
    spark.style.cssText = `position:fixed;left:${bx-sz/2}px;top:${by-sz/2}px;width:${sz}px;height:${sz}px;border-radius:50%;background:color-mix(in hsl,${clr} 40%,white 60%);pointer-events:none;z-index:147;opacity:0.8;transition:transform ${dur}s ease-out,opacity ${dur}s ease-out;`;
    document.body.appendChild(spark);
    requestAnimationFrame(() => { spark.style.transform = `translate(${driftX}px,${driftY}px)`; spark.style.opacity = '0'; });
    setTimeout(() => spark.remove(), dur * 1000 + 50);
  }

  // Damage tick — only when the beam has fully reached the target. Play
  // mode routes through _dexLaserDamage (playmode.js): hp whittles down to
  // 1, then the creature bloats and bursts — never an instant kill.
  // Sessions mode keeps its fire-and-kill flow.
  if (hitCreature && _laserExtend >= 0.95) {
    _laser.dmgTimer += _dt;
    if (_laser.dmgTimer >= LASER_DMG_INTERVAL) {
      _laser.dmgTimer = 0;
      _spawnFireEffect(endX, endY);
      if (_inPM) {
        window._dexLaserDamage?.(hitCreature, endX, endY, baseAngle);
      } else {
        hitCreature.hp -= LASER_DPS;
        // Set creature on fire immediately on first hit
        if (!hitCreature._onFire) {
          hitCreature._onFire = true;
          hitCreature._fireTimer = 0;
          hitCreature._fireTotalTime = 0;
        }
        if (hitCreature.hp <= 0 && !hitCreature.dead) {
          hitCreature.dead = true;
          hitCreature._onFire = false;
          if (hitCreature.kind === 'bird') {
            _spawnFeathers(hitCreature.x + 10, hitCreature.y + 6, 8);
            hitCreature.falling = true; hitCreature.vy = 0;
            hitCreature.fallVx = hitCreature.vx * 0.3; hitCreature.vx = 0;
          } else {
            _killSessionCreature(hitCreature, 28, 20, false);
          }
        }
      }
    }
  } else if (!hitCreature) {
    _laser.dmgTimer = 0;
  }
}

function _spawnFireEffect(x, y) {
  // Use primary accent color but brighter/lighter for flame effect
  const baseClr = getAccent();
  for (let i = 0; i < 5; i++) {
    const p = document.createElement('div');
    // Mix of sizes: tiny sparks, medium flames, occasional large bursts
    const roll = Math.random();
    const sz = roll < 0.4 ? (1.5 + Math.random() * 2) : roll < 0.8 ? (4 + Math.random() * 4) : (7 + Math.random() * 5);
    // Scattered movement: some rise fast, some drift sideways, some swirl
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 12;
    const tx = Math.cos(angle) * speed * (0.3 + Math.random() * 0.7);
    const ty = -(3 + Math.random() * 14) + Math.sin(angle) * speed * 0.3;
    const dur = 0.2 + Math.random() * 0.4;
    // Brighten the primary color: mix with white at varying amounts
    const bright = 30 + Math.floor(Math.random() * 50); // 30-80% white mix
    const clr = `color-mix(in hsl, ${baseClr} ${100 - bright}%, white ${bright}%)`;
    const rot = Math.floor(Math.random() * 360);
    // Some particles are round, some are elongated flame shapes
    const isElongated = Math.random() > 0.5;
    const w = isElongated ? sz * 0.5 : sz;
    const h = isElongated ? sz * 1.8 : sz;
    p.style.cssText = `position:fixed;left:${x - w/2}px;top:${y - h/2}px;width:${w}px;height:${h}px;border-radius:${isElongated ? '40% 40% 60% 60%' : '50%'};background:${clr};pointer-events:none;z-index:149;opacity:0.95;transform:translate(0,0) scale(1) rotate(${rot}deg);transition:transform ${dur}s cubic-bezier(0.1,0.6,0.3,1),opacity ${dur}s ease-out;`;
    document.body.appendChild(p);
    requestAnimationFrame(() => {
      p.style.transform = `translate(${tx}px,${ty}px) scale(${0.1 + Math.random() * 0.3}) rotate(${rot + (Math.random()-0.5)*180}deg)`;
      p.style.opacity = '0';
    });
    setTimeout(() => p.remove(), dur * 1000 + 50);
  }
}

function _tickCreatureFire() {
  for (const c of _creatures) {
    if (!c._onFire || c.dead) { c._onFire = false; continue; }
    c._fireTimer = (c._fireTimer || 0) + _dt;
    // Fire visual only — laser handles actual damage
    if (c._fireTimer >= 30) {
      c._fireTimer = 0;
      _spawnFireEffect(c.x + (c.kind === 'bird' ? 10 : 14), c.y + (c.kind === 'bird' ? 6 : 10));
    }
    // Visual fire particles on the creature while burning
    if (_frameCount % 4 === 0) {
      _spawnFireEffect(c.x + (c.kind === 'bird' ? 10 : 14) + (Math.random()-0.5)*8, c.y + (c.kind === 'bird' ? 6 : 10));
    }
    // Fire burns out after ~3 seconds (720 frames at 240Hz)
    if ((c._fireTotalTime = (c._fireTotalTime || 0) + _dt) > 720) {
      c._onFire = false;
      c._fireTotalTime = 0;
    }
  }
}

function _shootGun() {
  if (!_gun.held || !_gun.type) return;
  const cfg = GUN_TYPES[_gun.type];
  if (cfg.isLaser) return; // laser is handled by _tickLaser, not projectiles

  // SPELLBOOK — summon wraith at click point, delegated to playmode.js
  if (cfg.isSpellbook) {
    const inPM = _isPlayModeFn && _isPlayModeFn();
    if (!inPM || !_screenToWorldFn || !window._dexSpawnWraith) return;
    _trackAction();
    const targetW = _screenToWorldFn(_lastMouseX, _lastMouseY);
    window._dexSpawnWraith(targetW.wx, targetW.wy);
    sfx('shoot.spellbook');
    return;
  }

  // PUFFER LAUNCHER — custom arc projectile, delegated to playmode.js
  if (cfg.isPufferLauncher) {
    const inPM = _isPlayModeFn && _isPlayModeFn();
    if (!inPM || !_screenToWorldFn || !window._dexSpawnPufferProjectile) return;
    _trackAction();
    _gun._kickback = 8;
    const muzzleX = P.x + Math.cos(_gun.angle) * 22;
    const muzzleY = (P.y - CHAR_H + (_gun._gripSvgY || 26)) + Math.sin(_gun.angle) * 22;
    const startW = _screenToWorldFn(muzzleX, muzzleY);
    const targetW = _screenToWorldFn(_lastMouseX, _lastMouseY);
    window._dexSpawnPufferProjectile(startW.wx, startW.wy, targetW.wx, targetW.wy);
    sfx('shoot.puffer');
    if (window._dexMuzzleFX) {
      const _pa = Math.atan2(targetW.wy - startW.wy, targetW.wx - startW.wx);
      window._dexMuzzleFX(startW.wx, startW.wy, _pa, 'pufferLauncher');
    }
    return;
  }

  const gripSvgY = _gun._gripSvgY || 26;

  _trackAction();

  // SWORD (MD 11) — each click randomly picks jab or swipe, biased 60/40
  // toward switching so repeats happen but neither attack dominates. The
  // whoosh plays on click; the hit test fires when the wind-up ends (see
  // _updateSword → _swordStrike), so damage lands with the blade.
  if (cfg.melee) {
    if (_gun._swordAnim) return;   // still mid-swing
    const last = _gun._swordLast;
    const kind = (!last || Math.random() < 0.6) ? (last === 'jab' ? 'swipe' : 'jab') : last;
    _gun._swordLast = kind;
    _gun._swordAnim = kind === 'jab'
      ? { kind, t: 0, windup: SWORD_JAB_WINDUP, dur: SWORD_JAB_DUR, struck: false }
      : { kind, t: 0, windup: SWORD_SWIPE_WINDUP, dur: SWORD_SWIPE_DUR, struck: false,
          a0: -SWORD_SWIPE_ARC * 1.2, a1: SWORD_SWIPE_ARC, _a0: null };
    _gun._swordChargeT = 0; _gun._swordChargeCued = false;
    sfx('melee.sword', { jab: kind === 'jab' });
    return;
  }

  const baseAngle = _gun.angle;

  // Kickback recoil — per-gun weight (MD 14: shotgun kicks harder).
  _gun._kickback = cfg.kick || 8;
  // Shotgun pump-rack: foregrip slides back and returns after the blast
  // (animated in _updateGunAim, chk-chk sound at the turnaround).
  if (_gun.type === 'shotgun') { _gun._pumpT = 36; _gun._pumpSfx = false; }

  // One blast per trigger pull — the pellet loop below is a single event.
  // Per-sound retrigger cooldowns in audio.js keep autofire from stacking.
  sfx('shoot.' + _gun.type);

  // Muzzle FX (MD 04) — one call per trigger pull, world coords. The
  // platformer branch (MD 06) takes screen coords and anchors them itself.
  {
    const _mx = P.x + Math.cos(baseAngle) * 22;
    const _my = (P.y - CHAR_H + gripSvgY) + Math.sin(baseAngle) * 22;
    if (window._dexMuzzleFX && _isPlayModeFn && _isPlayModeFn() && _screenToWorldFn) {
      const _mw = _screenToWorldFn(_mx, _my);
      window._dexMuzzleFX(_mw.wx, _mw.wy, baseAngle, _gun.type);
    } else if (window._dexPlatFX) {
      window._dexPlatFX('muzzle', _mx, _my, baseAngle, _gun.type);
    }
  }

  for (let i = 0; i < cfg.pellets; i++) {
    // Spread: randomized scatter within spread cone (not a perfect fan)
    let spreadAngle;
    if (cfg.pellets > 1) {
      // Random angle within the spread cone
      const maxSpread = cfg.spread * Math.PI / 180;
      spreadAngle = baseAngle + (Math.random() - 0.5) * 2 * maxSpread;
    } else if (cfg.spread > 0) {
      // Single pellet with slight random inaccuracy (SMG)
      spreadAngle = baseAngle + (Math.random() - 0.5) * cfg.spread * Math.PI / 180;
    } else {
      spreadAngle = baseAngle;
    }
    const cosA = Math.cos(spreadAngle);
    const sinA = Math.sin(spreadAngle);
    const muzzleX = P.x + Math.cos(baseAngle) * 22;
    const muzzleY = (P.y - CHAR_H + gripSvgY) + Math.sin(baseAngle) * 22;
    // Randomize pellet speed slightly for shotgun
    const speedVar = cfg.pellets > 1 ? cfg.speed * (0.8 + Math.random() * 0.4) : cfg.speed;
    const isRocket = !!cfg.isRocket;
    const inPM = _isPlayModeFn && _isPlayModeFn();
    // In play mode, store world coordinates so projectile doesn't drift with camera
    let wx = muzzleX, wy = muzzleY;
    if (inPM && _screenToWorldFn) {
      const w = _screenToWorldFn(muzzleX, muzzleY);
      wx = w.wx; wy = w.wy;
    }
    const proj = {
      x: muzzleX, y: muzzleY,
      wx, wy, _isWorldCoord: inPM,
      vx: cosA * speedVar,
      vy: sinA * speedVar,
      life: 600,
      el: null,
      isRocket,
      gunType: _gun.type,
    };
    proj.el = document.createElement('div');
    const projClr = _getAccentColor();
    if (isRocket) {
      // Missile shape: elongated with pointed nose
      proj.el.style.cssText = `position:fixed;width:14px;height:5px;border-radius:1px 6px 6px 1px;background:${projClr};pointer-events:none;z-index:149;box-shadow:0 0 10px ${projClr};transform-origin:center;`;
    } else if (cfg.pellets > 1) {
      proj.el.style.cssText = `position:fixed;width:4px;height:4px;border-radius:50%;background:${projClr};pointer-events:none;z-index:149;box-shadow:0 0 4px ${projClr};`;
    } else {
      const bw = cfg.bulletW || 8, bh = cfg.bulletH || 5, tLen = cfg.trailLen || 0;
      proj.el.style.cssText = `position:fixed;width:${bw}px;height:${bh}px;border-radius:1px ${bh}px ${bh}px 1px;background:${projClr};pointer-events:none;z-index:149;box-shadow:0 0 8px ${projClr};transform-origin:center center;`;
      if (tLen > 0) {
        const trail = document.createElement('div');
        trail.className = 'proj-trail';
        trail.style.cssText = `position:absolute;right:${bw-1}px;top:50%;transform:translateY(-50%);width:${tLen}px;height:${Math.max(2,bh*0.7)}px;border-radius:${bh*0.35}px 0 0 ${bh*0.35}px;background:linear-gradient(to left,${projClr} 0%,rgba(255,255,255,0.15) 40%,transparent 100%);opacity:0.6;pointer-events:none;`;
        proj.el.appendChild(trail);
      }
    }
    document.body.appendChild(proj.el);
    _projectiles.push(proj);
    if (window._dexBroadcastProjectile) window._dexBroadcastProjectile(proj.wx, proj.wy, proj.vx, proj.vy, isRocket ? 'rocket' : 'arrow');
  }
}

// Tank fires rockets via playmode.js → window bridge
window._dexGetCharState = function() {
  return { animState: currentState||'idle', phase: runPhase||0, flipX: flipX||false,
    vy: P.vy||0, chargeT: _crouchIntensity||0, stunSev: P.stunSeverity||0, grounded: P.grounded||false, hoverboard: _hoverboard?.active||false,
    equip: _cosmetics.equip||'none', gunHeld: _gun?.held||false, bowDrawing: _bow?.drawing||false };
};
window._dexGetAppearance = function() { return { torso: _cosmetics.torso, hat: _cosmetics.hat, hair: _cosmetics.hair }; };
// Remote player support
window._dexBuildRemoteChar = function(id) {
  const svg = _buildCharSvg(id);
  const w = document.createElement('div');
  w.className = 'char-remote';
  w.style.cssText = 'position:absolute;pointer-events:none;z-index:49;';
  w.appendChild(svg);
  const tag = document.createElement('div');
  tag.className = 'char-nametag';
  w.appendChild(tag);
  return w;
};
window._dexPoseRemote = function(id, animState, phase, extra) {
  const el=(s)=>document.getElementById(id+'-'+s);
  const sL=(s,x1,y1,x2,y2)=>{const e=el(s);if(e){e.setAttribute('x1',x1);e.setAttribute('y1',y1);e.setAttribute('x2',x2);e.setAttribute('y2',y2);}};
  const sC=(s,cx,cy)=>{const e=el(s);if(e){e.setAttribute('cx',cx);e.setAttribute('cy',cy);}};
  const sP=(s,d)=>{const e=el(s);if(e)e.setAttribute('d',d);};
  const vy=extra?.vy||0,chargeT=extra?.chargeT||0,stunSev=extra?.stunSev||0;
  if(animState==='walk'){
    const s=Math.sin(phase*Math.PI*2),c=Math.cos(phase*Math.PI*2),bob=Math.abs(s)*1.5;
    const hY=8-bob,sY=14-bob,hipY=30-bob*0.3;
    sC('head',18,hY);sL('torso',18,sY,18,hipY);
    const sw=c*4,lB=Math.max(0,-c)*5,rB=Math.max(0,c)*5;
    sL('upper-arm-left',18,sY,14+sw,sY+8);sL('lower-arm-left',14+sw,sY+8,13+sw-lB,sY+15);
    sL('upper-arm-right',18,sY,22-sw,sY+8);sL('lower-arm-right',22-sw,sY+8,23-sw+rB,sY+15);
    const st=s*6,lL=Math.max(0,-s)*3,lR=Math.max(0,s)*3;
    sP('leg-left',`M18,${hipY} Q${13+st*0.4},${38-bob*0.2} ${13+st},${48-lL}`);sC('foot-left',13+st,48-lL);
    sP('leg-right',`M18,${hipY} Q${23-st*0.4},${38-bob*0.2} ${23-st},${48-lR}`);sC('foot-right',23-st,48-lR);
  } else if(animState==='jog'){
    const s=Math.sin(phase*Math.PI*2),c=Math.cos(phase*Math.PI*2),bob=Math.abs(s)*5;
    const hY=8-bob,sY=14-bob,hipY=30-bob*0.5;
    sC('head',18,hY);sL('torso',18,sY,18,hipY);
    const sw=c*7,lB=Math.max(0,-c)*4,rB=Math.max(0,c)*4;
    sL('upper-arm-left',18,sY,14+sw,sY+10);sL('lower-arm-left',14+sw,sY+10,13+sw-lB,sY+18);
    sL('upper-arm-right',18,sY,22-sw,sY+10);sL('lower-arm-right',22-sw,sY+10,23-sw+rB,sY+18);
    const st=s*9,lL=Math.max(0,-s)*6,lR=Math.max(0,s)*6;
    sP('leg-left',`M18,${hipY} Q${12+st*0.5},${36-bob*0.2} ${12+st},${48-lL}`);sC('foot-left',12+st,48-lL);
    sP('leg-right',`M18,${hipY} Q${24-st*0.5},${36-bob*0.2} ${24-st},${48-lR}`);sC('foot-right',24-st,48-lR);
  } else if(animState==='jump-charge'||animState==='crouch-release'){
    const ct=Math.min(chargeT,1),crouch=ct*8;
    const hY=8+crouch*0.6,sY=14+crouch*0.5,hipY=30+crouch*0.3;
    sC('head',18,hY);sL('torso',18,sY,18,hipY);
    sL('upper-arm-left',18,sY,14,sY+8);sL('lower-arm-left',14,sY+8,12,sY+14);
    sL('upper-arm-right',18,sY,22,sY+8);sL('lower-arm-right',22,sY+8,24,sY+14);
    const sp=2+ct*4;
    sP('leg-left',`M18,${hipY} Q${14-sp*0.3},${38+crouch*0.3} ${13-sp},48`);sC('foot-left',13-sp,48);
    sP('leg-right',`M18,${hipY} Q${22+sp*0.3},${38+crouch*0.3} ${23+sp},48`);sC('foot-right',23+sp,48);
  } else if(animState==='charge-walk'){
    const s=Math.sin(phase*Math.PI*2),bob=Math.abs(s)*1,crouch=Math.min(chargeT,1)*6;
    const hY=8+crouch*0.6-bob,sY=14+crouch*0.5-bob,hipY=30+crouch*0.3-bob*0.3;
    sC('head',18,hY);sL('torso',18,sY,18,hipY);
    const sw=Math.cos(phase*Math.PI*2)*3;
    sL('upper-arm-left',18,sY,14+sw,sY+7);sL('lower-arm-left',14+sw,sY+7,13+sw,sY+13);
    sL('upper-arm-right',18,sY,22-sw,sY+7);sL('lower-arm-right',22-sw,sY+7,23-sw,sY+13);
    const st=s*5;
    sP('leg-left',`M18,${hipY} Q${13+st*0.4},39 ${13+st},48`);sC('foot-left',13+st,48);
    sP('leg-right',`M18,${hipY} Q${23-st*0.4},39 ${23-st},48`);sC('foot-right',23-st,48);
  } else if(animState==='jump-air'||animState==='launched'){
    const spread=Math.min(Math.abs(vy)/8,1)*6,armUp=vy<-1?4:0;
    sC('head',18,8);sL('torso',18,14,18,30);
    sL('upper-arm-left',18,14,12,18-armUp);sL('lower-arm-left',12,18-armUp,10,24-armUp);
    sL('upper-arm-right',18,14,24,18-armUp);sL('lower-arm-right',24,18-armUp,26,24-armUp);
    sP('leg-left',`M18,30 Q12,36 ${10-spread},46`);sC('foot-left',10-spread,46);
    sP('leg-right',`M18,30 Q24,36 ${26+spread},46`);sC('foot-right',26+spread,46);
  } else if(animState==='land-absorb'){
    sC('head',18,14);sL('torso',18,18,18,34);
    sL('upper-arm-left',18,18,12,24);sL('lower-arm-left',12,24,10,30);
    sL('upper-arm-right',18,18,24,24);sL('lower-arm-right',24,24,26,30);
    sP('leg-left','M18,34 Q10,40 8,48');sC('foot-left',8,48);
    sP('leg-right','M18,34 Q26,40 28,48');sC('foot-right',28,48);
  } else if(animState==='splat'){
    const fY=44;
    sC('head',stunSev>2?8:12,fY);sL('torso',stunSev>2?8:12,fY,24,fY);
    sL('upper-arm-left',12,fY,8,fY-3);sL('lower-arm-left',8,fY-3,5,fY-1);
    sL('upper-arm-right',24,fY,28,fY-3);sL('lower-arm-right',28,fY-3,31,fY-1);
    sP('leg-left',`M24,${fY} Q28,${fY+1} 30,${fY+2}`);sC('foot-left',30,fY+2);
    sP('leg-right',`M24,${fY} Q28,${fY+3} 32,${fY+3}`);sC('foot-right',32,fY+3);
  } else if(animState==='knockback'){
    sC('head',18,10);sL('torso',18,16,18,32);
    sL('upper-arm-left',18,16,8,12);sL('lower-arm-left',8,12,4,16);
    sL('upper-arm-right',18,16,28,12);sL('lower-arm-right',28,12,32,16);
    sP('leg-left','M18,32 Q10,38 6,44');sC('foot-left',6,44);
    sP('leg-right','M18,32 Q26,38 30,44');sC('foot-right',30,44);
  } else if(animState==='get-up'){
    sC('head',18,12);sL('torso',18,16,18,32);
    sL('upper-arm-left',18,16,12,22);sL('lower-arm-left',12,22,10,26);
    sL('upper-arm-right',18,16,24,22);sL('lower-arm-right',24,22,26,26);
    sP('leg-left','M18,32 Q12,40 10,48');sC('foot-left',10,48);
    sP('leg-right','M18,32 Q24,40 26,48');sC('foot-right',26,48);
  } else {
    const ab=Math.sin(Date.now()/800)*0.8;
    sC('head',18,8);sL('torso',18,14,18,30);
    sL('upper-arm-left',18,14,15,22+ab);sL('lower-arm-left',15,22+ab,14,30+ab);
    sL('upper-arm-right',18,14,21,22+ab);sL('lower-arm-right',21,22+ab,22,30+ab);
    const kb=Math.sin(Date.now()/1200)*0.5;
    sP('leg-left',`M18,30 Q${13-kb},39 13,48`);sC('foot-left',13,48);
    sP('leg-right',`M18,30 Q${23+kb},39 23,48`);sC('foot-right',23,48);
  }
};
window._dexApplyRemoteCosmetics = function(id, app) {
  if(!app)return;
  applyTorso(id,app.torso||'default');applyHat(id,app.hat||'none');applyHair(id,app.hair||'none');
};
window._dexSpawnTankRocket = function(wx, wy, angle) {
  const speed = 8; // same as rocket launcher
  const projClr = _getAccentColor();
  // Initialize screen position from world coords so _prevX/_prevY isn't (0,0)
  // on the first frame (prevents false building collision from screen origin)
  let sx=0,sy=0;
  if(_worldToScreenFn){const s=_worldToScreenFn(wx,wy);sx=s.sx;sy=s.sy;}
  const proj = {
    x: sx, y: sy, wx, wy, _isWorldCoord: true,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    life: 600, el: null, isRocket: true,
  };
  proj.el = document.createElement('div');
  proj.el.style.cssText = `position:fixed;width:16px;height:6px;border-radius:1px 7px 7px 1px;background:${projClr};pointer-events:none;z-index:149;box-shadow:0 0 12px ${projClr};transform-origin:center;`;
  document.body.appendChild(proj.el);
  _projectiles.push(proj);
};

// Death screen calls this to reset character death state
window._dexResetCharDeath = function() {
  // MD#CHAR-CENTER-FLASH: only teleport to viewport center if character
  // was actually dead. Previously this fired unconditionally on every
  // session switch (called from _switchToSession), which caused the
  // character to flash at screen center for the full duration of the
  // play-mode → session transition (~680ms) — between the jump-out
  // animation and the post-jump opacity:0 cleanup. If alive, just clear
  // any stun state and leave position alone; the exitPlayMode/drop-in
  // flow will reposition the character correctly.
  const wasDead = _playerDead;
  _playerDead = false;
  _deathRespawnTimer = 0;
  if (_deathArrowEl) { _deathArrowEl.remove(); _deathArrowEl = null; }
  P.stunned = false;
  if (wasDead) {
    currentState = 'idle'; P.vx = 0; P.vy = 0;
    P.x = window.innerWidth / 2; P.y = window.innerHeight / 2;
  }
  // Restore bow visibility
  const bp = _el('bow'), sl = _el('bow-str-l'), sr = _el('bow-str-r');
  if (bp) bp.style.display = '';
  if (sl) sl.style.display = '';
  if (sr) sr.style.display = '';
};

// window._dexPushCharAbove (knock the character clear of the session-grid
// popup) was called by the notes app only — removed with the popup.

// Bridge: playmode.js creature death → character.js death state
window._dexSetCharDead = function() {
  sfx('player.death');
  _playerDead = true;
  currentState = 'splat';
  P.stunSeverity = 3;
  P.vx = 0; P.vy = 0;
  _bow.holstered = true; _bow.drawing = false; _bow.chargeT = 0; _bow.shaking = false;
  if (_gun.held) _dropGun();
};

// Flag respawns to inventory after destruction
window._dexFlagRespawned = function() {
  // Find an empty hotbar slot, or just add to first available
  for (let s = 1; s <= 4; s++) {
    if (!_hotbar[s]) {
      _hotbar[s] = 'checkpointFlag';
      _saveHotbar();
      _renderHotbarSlot(s);
      return;
    }
  }
  // All slots full — replace the active one
  _hotbar[_activeHotbarSlot] = 'checkpointFlag';
  _saveHotbar();
  _renderHotbarSlot(_activeHotbarSlot);
};

function _tickProjectiles() {
  for (let i = _projectiles.length - 1; i >= 0; i--) {
    const p = _projectiles[i];
    p._prevX = p.x; p._prevY = p.y;
    if (p._isWorldCoord) {
      // Play mode: update world coords, convert to screen for rendering
      p.wx += p.vx * _dt;
      p.wy += p.vy * _dt;
      if (p.isRocket) p.vy += 0.02 * _dt;
      if (_worldToScreenFn) {
        const s = _worldToScreenFn(p.wx, p.wy);
        p.x = s.sx; p.y = s.sy;
      }
    } else {
      p.x += p.vx * _dt;
      p.y += p.vy * _dt;
      if (p.isRocket) p.vy += 0.02 * _dt;
    }
    p.life -= _dt;
    const _isTrailed = p.gunType === 'pistol' || p.gunType === 'smg' || p.gunType === 'rifle';
    const _gcfg = _isTrailed ? GUN_TYPES[p.gunType] : null;
    const _hw = p.isRocket ? 7 : (_gcfg ? _gcfg.bulletW / 2 : 3);
    const _hh = p.isRocket ? 3 : (_gcfg ? _gcfg.bulletH / 2 : 3);
    p.el.style.left = (p.x - _hw) + 'px';
    p.el.style.top = (p.y - _hh) + 'px';
    // Rotate bullets with trails to face travel direction
    if (p.isRocket || _isTrailed) {
      const rAngle = Math.atan2(p.vy, p.vx) * 180 / Math.PI;
      p.el.style.transform = `rotate(${rAngle}deg)`;
    }

    // Rocket trail particles
    if (p.isRocket && _frameCount % 2 === 0) {
      if (p._isWorldCoord && window._dexAddTrailParticle) {
        window._dexAddTrailParticle(p.wx, p.wy);
      } else {
        const t = document.createElement('div');
        const sz = 2 + Math.random() * 3;
        t.style.cssText = `position:fixed;left:${p.x}px;top:${p.y}px;width:${sz}px;height:${sz}px;border-radius:50%;background:var(--clr-adj,#7B8A9C);pointer-events:none;z-index:148;opacity:0.7;transition:all ${0.3+Math.random()*0.3}s ease-out;`;
        document.body.appendChild(t);
        requestAnimationFrame(() => { t.style.opacity = '0'; t.style.transform = `translate(${(Math.random()-0.5)*8}px,${4+Math.random()*6}px)`; });
        setTimeout(() => t.remove(), 600);
      }
    }

    let hit = false;

    // Projectiles used to be stopped by the notes-app header, sidebar and
    // infochips. Nothing but creatures and the world blocks them now.
    const _inPlayMode = _isPlayModeFn && _isPlayModeFn();

    // Check creatures — sweep along travel path to prevent fast bullets skipping hitboxes
    if (!hit && !_inPlayMode) {
      const _sdx = p.x - p._prevX, _sdy = p.y - p._prevY;
      const _sdist = Math.hypot(_sdx, _sdy);
      const _steps = Math.max(1, Math.ceil(_sdist / 12));
      for (let _s = 0; _s <= _steps; _s++) {
        const _t = _s / _steps;
        if (_hitCreature(p._prevX + _sdx * _t, p._prevY + _sdy * _t, false, p.isRocket)) { hit = true; break; }
      }
    }
    if (!hit && _isPlayModeFn && _isPlayModeFn() && _hitPlayCreaturesFn) {
      const _sdx = p.x - p._prevX, _sdy = p.y - p._prevY;
      const _sdist = Math.hypot(_sdx, _sdy);
      const _steps = Math.max(1, Math.ceil(_sdist / 12));
      for (let _s = 0; _s <= _steps; _s++) {
        const _t = _s / _steps;
        if (_hitPlayCreaturesFn(p._prevX + _sdx * _t, p._prevY + _sdy * _t, p.isRocket, p.vx, p.vy)) { hit = true; break; }
      }
    }

    // Hit buildings (play mode only) — polygon outline collision
    if (!hit && _inPlayMode && _getBuildingPolysFn) {
      const polys = _getBuildingPolysFn();
      for (const poly of polys) {
        for (const seg of poly.segments) {
          if (_segIntersect(p._prevX, p._prevY, p.x, p.y, seg[0], seg[1], seg[2], seg[3])) {
            if (p._isWorldCoord && _screenToWorldFn) {
              const w = _screenToWorldFn(p.x, p.y);
              p.wx = w.wx; p.wy = w.wy;
            }
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
    }

    // Off screen
    if (p.x < 0 || p.x > window.innerWidth || p.y < 0 || p.y > window.innerHeight) hit = true;

    if (hit || p.life <= 0) {
      if (hit && p.life > 0) {
        if (p._isWorldCoord && _addWorldExplosionFn) {
          // World path: addWorldExplosion() in playmode.js plays the
          // positional boom — no sound here or it doubles.
          _addWorldExplosionFn(p.wx, p.wy, p.isRocket);
        } else {
          sfx('explosion', { big: !!p.isRocket });
          if (p.isRocket) _spawnRocketExplosion(p.x, p.y);
          else _spawnExplosion(p.x, p.y);
        }
      }
      p.el.remove();
      _projectiles.splice(i, 1);
    }
  }
}

function _hexToHue(hex) {
  hex = hex.replace('#','');
  const r = parseInt(hex.slice(0,2),16)/255;
  const g = parseInt(hex.slice(2,4),16)/255;
  const b = parseInt(hex.slice(4,6),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g-b)/d) % 6;
  else if (max === g) h = (b-r)/d + 2;
  else h = (r-g)/d + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return h;
}

function _spawnExplosion(x, y) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;left:${x}px;top:${y}px;transform:translate(-50%,-50%);pointer-events:none;z-index:149;`;
  const clr = getAccent();
  const hue = _hexToHue(clr);
  const count = 3 + Math.floor(Math.random() * 2);
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('div');
    const angle = Math.random() * Math.PI * 2;
    const dist = 10 + Math.random() * 12;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist;
    const sz = 1.5 + Math.random() * 1.5;
    const sat = 50 + Math.random() * 30;
    const lit = 45 + Math.random() * 35;
    const dur = 0.15 + Math.random() * 0.12;
    dot.style.cssText = `position:absolute;width:${sz}px;height:${sz}px;border-radius:50%;background:hsl(${hue},${sat}%,${lit}%);opacity:0.9;transition:all ${dur}s ease-out;transform:translate(0,0);`;
    el.appendChild(dot);
    requestAnimationFrame(() => { dot.style.transform = `translate(${tx}px,${ty}px)`; dot.style.opacity = '0'; });
  }
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 300);
}

function _spawnRocketExplosion(x, y) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;left:${x}px;top:${y}px;transform:translate(-50%,-50%);pointer-events:none;z-index:149;`;
  const clr = getAccent();
  const hue = _hexToHue(clr);
  for (let i = 0; i < 12; i++) {
    const dot = document.createElement('div');
    const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.5;
    const dist = 12 + Math.random() * 22;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist;
    const sz = 2 + Math.random() * 3.5;
    const dur = 0.25 + Math.random() * 0.3;
    const sat = 40 + Math.random() * 40;
    const lit = 35 + Math.random() * 50;
    dot.style.cssText = `position:absolute;width:${sz}px;height:${sz}px;border-radius:50%;background:hsl(${hue},${sat}%,${lit}%);opacity:1;transition:all ${dur}s ease-out;transform:translate(0,0);`;
    el.appendChild(dot);
    requestAnimationFrame(() => { dot.style.transform = `translate(${tx}px,${ty}px)`; dot.style.opacity = '0'; });
  }
  const flash = document.createElement('div');
  flash.style.cssText = `position:absolute;width:22px;height:22px;border-radius:50%;background:hsl(${hue},60%,75%);opacity:0.5;transform:translate(-11px,-11px);transition:all 0.2s ease-out;`;
  el.appendChild(flash);
  requestAnimationFrame(() => { flash.style.transform = 'translate(-11px,-11px) scale(2.5)'; flash.style.opacity = '0'; });
  document.body.appendChild(el);
  // Kill nearby creatures
  for (const c of _creatures) {
    if (c.dead) continue;
    const cx = c.kind === 'bird' ? c.x + 10 : c.x + 16;
    const cy = c.kind === 'bird' ? c.y + 6 : c.y + 10;
    if (Math.sqrt((cx-x)**2 + (cy-y)**2) < 50) {
      c.dead = true;
      if (c.kind === 'bird') { c.falling = true; c.vy = 0; c.fallVx = (cx-x)*0.1; c.vx = 0; _spawnFeathers(c.x+10,c.y+6,12); }
      else { _killSessionCreature(c, c.kind === 'deer' ? 28 : 32, c.kind === 'deer' ? 20 : 24, false); }
    }
  }
  setTimeout(() => el.remove(), 800);
}

function _tickGunPickupProximity() {
  for (const pickup of _pickups) {
    if (pickup.el.style.display === 'none') { pickup.promptEl.style.opacity = '0'; continue; }
    const dx = P.x - pickup.x;
    const dy = P.y - pickup.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < GUN_RANGE && !_gun.held) {
      pickup.promptEl.style.left = (pickup.x + 4) + 'px';
      pickup.promptEl.style.top = (pickup.y - 30) + 'px';
      pickup.promptEl.style.opacity = '1';
    } else {
      pickup.promptEl.style.opacity = '0';
    }
  }
}

function _findNearestPickup() {
  let best = null, bestDist = GUN_RANGE;
  for (const pickup of _pickups) {
    if (pickup.el.style.display === 'none') continue;
    const dx = P.x - pickup.x;
    const dy = P.y - pickup.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) { best = pickup; bestDist = dist; }
  }
  return best;
}

// ═══════════════════════════════════
//  CREATURES — birds and yaks
// ═══════════════════════════════════

const _creatures = [];

// Ground under an arbitrary x (MD 07b issue 1): creatures stand on THEIR
// OWN column of terrain. In the platformer that's the procedural ground at
// that x; in the forest/notes mode it falls back to the flat canvas floor,
// so forest behaviour is bit-identical. getCanvasFloorY() itself remains
// character-relative and is untouched.
function _creatureGroundY(x) {
  if (window._dexPlatActive && window._dexPlatGroundYAt) {
    const y = window._dexPlatGroundYAt(x);
    if (y != null) return y;
  }
  return getCanvasFloorY();
}

function _spawnBird(x, y, vx) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;pointer-events:none;z-index:1;`;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const scale = 0.75 + Math.random() * 0.5; // 0.75x to 1.25x
  svg.setAttribute('width', Math.round(20 * scale)); svg.setAttribute('height', Math.round(12 * scale));
  svg.setAttribute('viewBox', '0 0 20 12');
  svg.style.overflow = 'visible';
  const wing = document.createElementNS(ns, 'path');
  wing.setAttribute('stroke', 'var(--clr-adj,#7B8A9C)');
  wing.setAttribute('stroke-width', '1.8');
  wing.setAttribute('stroke-linecap', 'round');
  wing.setAttribute('fill', 'none');
  svg.appendChild(wing);
  el.appendChild(svg);
  document.body.appendChild(el);
  _creatures.push({
    kind: 'bird', el, wing, x, y, vx, hp: 1, dead: false, falling: false,
    flapT: Math.random() * Math.PI * 2, scale,
  });
}

function _spawnYak(x, vx) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;pointer-events:none;z-index:1;`;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '32'); svg.setAttribute('height', '24');
  svg.setAttribute('viewBox', '0 0 32 24');
  svg.style.overflow = 'visible';
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('stroke', 'var(--clr-adj,#7B8A9C)');
  g.setAttribute('stroke-width', '1.8');
  g.setAttribute('stroke-linecap', 'round');
  g.setAttribute('fill', 'none');
  // Body oval — filled with canvas bg so it's opaque
  g.appendChild(_mkSvg('ellipse', { cx:'16', cy:'10', rx:'11', ry:'5', fill:'var(--bg)' }));
  // Head — always drawn on right side, g transform flips for direction
  g.appendChild(_mkSvg('circle', { cx:'28', cy:'7', r:'3.5', fill:'var(--bg)' }));
  // Bigger horns — two curved lines
  g.appendChild(_mkSvg('path', { d:'M28,4 Q32,0 30,-2', 'stroke-width':'1.5' }));
  g.appendChild(_mkSvg('path', { d:'M29,5 Q34,2 33,0', 'stroke-width':'1.5' }));
  // Legs — individual lines we can animate
  const legs = [];
  for (const lx of [8, 13, 19, 24]) {
    const leg = _mkSvg('line', { x1:lx, y1:'14', x2:lx, y2:'22', 'stroke-width':'1.8' });
    g.appendChild(leg);
    legs.push(leg);
  }
  svg.appendChild(g);
  el.appendChild(svg);
  const floorY = _creatureGroundY(x);
  document.body.appendChild(el);
  const hpRoll = Math.random();
  const yakHp = hpRoll < 0.25 ? 4 : hpRoll < 0.65 ? 5 : hpRoll < 0.90 ? 6 : 7;
  _creatures.push({
    kind: 'yak', el, x, y: floorY - 22, vx, hp: yakHp, maxHp: yakHp, dead: false,
    walkT: 0, svg, g, legs, _woundCount: 0, _bloodTrailTimer: 0,
    boundLeft: 100, boundRight: window.innerWidth - 100,
  });
}

function _spawnDeer(x, vx) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;pointer-events:none;z-index:1;`;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '28'); svg.setAttribute('height', '22');
  svg.setAttribute('viewBox', '0 0 28 22');
  svg.style.overflow = 'visible';
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('stroke', 'var(--clr-adj,#7B8A9C)');
  g.setAttribute('stroke-width', '1.6');
  g.setAttribute('stroke-linecap', 'round');
  g.setAttribute('fill', 'none');
  g.appendChild(_mkSvg('ellipse', { cx:'14', cy:'10', rx:'9', ry:'4', fill:'var(--bg)' }));
  g.appendChild(_mkSvg('circle', { cx:'24', cy:'5', r:'2.8', fill:'var(--bg)' }));
  g.appendChild(_mkSvg('line', { x1:'20', y1:'7', x2:'24', y2:'5', 'stroke-width':'1.4' }));
  g.appendChild(_mkSvg('path', { d:'M24,3 L26,0 L27,1', 'stroke-width':'1.2' }));
  g.appendChild(_mkSvg('path', { d:'M24,3 L22,0 L21,1', 'stroke-width':'1.2' }));
  const legs = [];
  for (const lx of [7, 11, 17, 21]) {
    const leg = _mkSvg('line', { x1:String(lx), y1:'13', x2:String(lx), y2:'20', 'stroke-width':'1.5' });
    g.appendChild(leg);
    legs.push(leg);
  }
  svg.appendChild(g);
  el.appendChild(svg);
  const floorY = getCanvasFloorY();
  document.body.appendChild(el);
  const hp = 2 + Math.floor(Math.random() * 2);
  _creatures.push({
    kind: 'deer', el, x, y: floorY - 20, vx, hp, maxHp: hp, dead: false,
    walkT: 0, svg, g, legs, _woundCount: 0, _bloodTrailTimer: 0,
    boundLeft: 80, boundRight: window.innerWidth - 80,
  });
}

function _tickCreatures() {
  if (_isPlayModeFn && _isPlayModeFn()) return; // session creatures don't tick in play mode
  for (let i = _creatures.length - 1; i >= 0; i--) {
    const c = _creatures[i];

    // Carried creature: only drip blood at player feet, skip all other logic
    if (c === _carriedCreature) {
      if (c._woundCount > 0) {
        c._bloodTrailTimer = (c._bloodTrailTimer || 0) + _dt;
        const baseInterval = Math.max(20, Math.floor(70 / c._woundCount));
        const interval = baseInterval + Math.floor(Math.random() * baseInterval * 0.8);
        if (c._bloodTrailTimer >= interval) {
          c._bloodTrailTimer = 0;
          const dropX = P.x + (Math.random() - 0.5) * 22;
          const floorY = P.grounded
            ? P.y + Math.random() * 5
            : getCanvasFloorY() - 2 + Math.random() * 4;
          const clusterCount = Math.random() < 0.28 ? 2 + Math.floor(Math.random() * 2) : 1;
          for (let di = 0; di < clusterCount; di++) {
            const dot = document.createElement('div');
            const roll = Math.random();
            const sz = roll < 0.4 ? (1 + Math.random() * 2) : roll < 0.75 ? (3 + Math.random() * 3) : (5 + Math.random() * 4);
            const szH = sz * (0.3 + Math.random() * 0.4);
            const clusterOX = di > 0 ? (Math.random() - 0.5) * 10 : 0;
            const clusterOY = di > 0 ? Math.random() * 4 : 0;
            dot.className = 'dex-blood';
            dot.style.cssText = `position:fixed;left:${dropX + clusterOX - sz/2}px;top:${floorY + clusterOY}px;width:${sz}px;height:${szH}px;border-radius:50%;background:${_bloodClr()};opacity:${0.4 + Math.random() * 0.4};pointer-events:none;z-index:0;`;
            document.body.appendChild(dot);
            _anchorFxEl(dot, dropX + clusterOX - sz / 2, floorY + clusterOY);
            setTimeout(() => { dot.style.transition = 'opacity 4s'; dot.style.opacity = '0'; }, 36000);
            setTimeout(() => dot.remove(), 40100);
          }
        }
      }
      continue;
    }

    if (c.kind === 'bird') {
      if (c.falling) {
        // Dead bird falling — tight V, very slow drift down
        c.vy = (c.vy || 0) + 0.03 * _dt;
        c.y += c.vy * _dt;
        c.x += (c.fallVx || 0) * _dt;
        // Tight folded V while falling
        c.wing.setAttribute('d', 'M3,2 Q5,5 10,6 Q15,5 17,2');
        c.el.style.left = c.x + 'px';
        c.el.style.top = c.y + 'px';

        // Find landing surface — the GROUND, never platform colliders.
        // _chipFloors used to hold notes-app infochips (fine to land on);
        // MD 06 filled it with platformer level geometry, and a corpse
        // resting mid-air on a platform reads wrong — it falls past to the
        // procedural ground under its own X (MD 06b issue 3).
        let landY;
        if (window._dexPlatActive && window._dexPlatGroundYAt) {
          const gy = window._dexPlatGroundYAt(c.x + 10);
          landY = (gy != null ? gy : getCanvasFloorY()) - 6;
        } else {
          landY = getCanvasFloorY() - 6;
        }
        if (c.y >= landY) {
          c.y = landY;
          c.falling = false;
          c.landed = true;
          c.landTime = Date.now();
          c.wing.setAttribute('d', 'M2,6 Q5,4 10,6 Q15,4 18,6');
          _spawnBloodPuddle(c.x + 10, c.y + 12);
        }
        continue;
      }
      if (c.landed) {
        c.el.style.left = c.x + 'px';
        c.el.style.top = c.y + 'px';
        // Fade out after 5 seconds
        const elapsed = Date.now() - c.landTime;
        if (elapsed > 7000) {
          c.el.style.opacity = Math.max(0, 1 - (elapsed - 7000) / 1500);
        }
        if (elapsed > 8500) {
          c.el.remove();
          _creatures.splice(i, 1);
        }
        continue;
      }
      if (c.dead) continue;
      c.x += c.vx * _dt;
      c.flapT += 0.06 * _dt;
      const flap = Math.sin(c.flapT) * 4;
      const curl = Math.sin(c.flapT * 1.3) * 2;
      c.wing.setAttribute('d',
        `M0,${6+flap+curl} Q5,${6+flap*0.3} 10,6 Q15,${6+flap*0.3} 20,${6+flap+curl}`);
      c.el.style.left = c.x + 'px';
      c.el.style.top = c.y + 'px';
      // Platformer (MD 07b): birds keep flying — the one kind where free
      // y is right — but inside a sane band over the LOCAL terrain: never
      // below ~46px over the ground (no flying through hills), eased back
      // down when far above it. And no screen-edge wrap teleports in an
      // endless world — offscreen birds despawn and the spawner replaces
      // them.
      if (window._dexPlatActive && window._dexPlatGroundYAt) {
        const gAt = window._dexPlatGroundYAt(c.x + 10);
        if (gAt != null) {
          const floorLine = gAt - 46, ceilLine = gAt - 260;
          if (c.y > floorLine) c.y = floorLine;
          else if (c.y < ceilLine) c.y += 0.35 * _dt;
        }
        if (c.x < -60 || c.x > window.innerWidth + 60) {
          c.el.remove(); _creatures.splice(i, 1); continue;
        }
      } else if (c._exiting) {
        if (c.x < -40 || c.x > window.innerWidth + 40) {
          c.el.remove(); _creatures.splice(i, 1); continue;
        }
      } else {
        if (c.vx > 0 && c.x > window.innerWidth + 30) c.x = -30;
        if (c.vx < 0 && c.x < -30) c.x = window.innerWidth + 30;
      }
    }

    if (c.kind === 'yak' || c.kind === 'deer') {
      if (c.dead) {
        c.deadT = (c.deadT || 0) + _dt;
        continue;
      }
      // Thrown yak — gravity arc, land on platforms or canvas floor
      if (c._thrown) {
        c.vy = (c.vy || 0) + 0.3 * _dt;
        c.x += (c.vx || 0) * _dt;
        c.y += c.vy * _dt;
        c.el.style.left = c.x + 'px';
        c.el.style.top = c.y + 'px';
        c.el.style.zIndex = '11'; // visible above outliner during flight
        // Keep legs neutral (straight down) during flight — prevents frozen mid-swing legs
        if (c.legs && c.legs.length === 4) {
          c.legs[0].setAttribute('x2', c.legs[0].getAttribute('x1'));
          c.legs[1].setAttribute('x2', c.legs[1].getAttribute('x1'));
          c.legs[2].setAttribute('x2', c.legs[2].getAttribute('x1'));
          c.legs[3].setAttribute('x2', c.legs[3].getAttribute('x1'));
        }
        // Update flip transform so horns/antlers stay on the head during flight
        _flipYak(c);
        c._thrownTimer -= _dt;
        // Find landing surface — only land on platforms the yak is falling past
        const yakCX = c.x + 16, yakBot = c.y + 22;
        const prevBot = yakBot - c.vy * _dt; // where feet were last frame
        let landY = _creatureGroundY(yakCX) - 22;
        let landOnOutliner = false;
        const footR = _cachedFootR;
        if (footR && yakCX > footR.left && yakCX < footR.right && c.vy > 0 && prevBot <= footR.top && yakBot >= footR.top - 4) {
          landY = footR.top - 22; landOnOutliner = true;
        }
        const archR = _cachedArchR;
        if (archR && yakCX > archR.left && yakCX < archR.right && c.vy > 0 && prevBot <= archR.top && yakBot >= archR.top - 4) {
          if (archR.top - 22 < landY) { landY = archR.top - 22; landOnOutliner = true; }
        }
        for (const chip of _chipFloors) {
          if (yakCX > chip.left && yakCX < chip.right && c.vy > 0 && prevBot <= chip.top && yakBot >= chip.top - 4) {
            if (chip.top - 22 < landY) { landY = chip.top - 22; landOnOutliner = false; }
          }
        }
        if (c._thrownTimer <= 0 || c.y >= landY) {
          c._thrown = false;
          c.y = Math.min(c.y, landY);
          c.vy = 0;
          c.el.style.zIndex = landOnOutliner ? '11' : '1';
          // Stun only on charged throws, otherwise land on feet
          if (c._throwPower > 0.3) {
            c.vx = 0;
            c._stunTimer = 60; c._stunTotal = 60;
          } else {
            c.vx = (Math.random() < 0.5 ? -1 : 1) * (0.12 + Math.random() * 0.15);
          }
          c._throwPower = undefined;
        }
        continue;
      }
      c.x += c.vx * _dt;

      // ── Gravity + platform detection ──
      const yakW = 32, yakH = 22;
      const yakCX = c.x + yakW / 2;
      const yakBot = c.y + yakH;
      // Side-view model (MD 07b): the floor is the terrain under the
      // creature's own feet — walking follows the wave, downhill becomes a
      // short fall, uphill steps up. Forest: same flat floor as always.
      const canvasFloor = _creatureGroundY(yakCX);
      let onPlatform = false;
      let platformY = canvasFloor;
      let onOutlinerPlatform = false;

      // Skip platform detection when launched upward — let it fly
      // Creatures used to stand on the sidebar foot, the archive header and
      // infochips. Only the canvas floor remains.

      // Apply gravity or land on surface
      if (!onPlatform && yakBot < canvasFloor) {
        // Walked off platform edge — start falling with horizontal momentum
        if (!c._falling && c._wasOnOutliner) {
          c._falling = true;
          c._fallStartY = c.y; // track where fall started for z-index delay
        }
        c.vy = (c.vy || 0) + 0.15 * _dt;
        c.x += (c.vx || 0) * _dt * 0.5; // horizontal drift during fall
        c.y += c.vy * _dt;
        if (c.y + yakH >= canvasFloor) {
          c.y = canvasFloor - yakH;
          c.vy = 0;
        }
        // Update DOM during fall
        c.el.style.left = c.x + 'px';
        c.el.style.top = c.y + 'px';
      } else if (onPlatform) {
        c.y = platformY - yakH;
        c.vy = 0;
      } else {
        c.y = canvasFloor - yakH;
        c.vy = 0;
      }

      // Z-index: stay in front during fall until 75% of the way down
      if (c._falling && c._fallStartY !== undefined) {
        const fallProgress = (c.y - c._fallStartY) / (canvasFloor - yakH - c._fallStartY);
        c.el.style.zIndex = fallProgress < 0.75 ? '11' : '1';
      } else {
        c.el.style.zIndex = onOutlinerPlatform ? '11' : '1';
      }
      c._wasOnOutliner = onOutlinerPlatform;

      // ── Creature stun/collapse ──
      // Falling stun: launched or fell off platform → stun on landing
      if (c._falling && c.vy >= 0 && (onPlatform || c.y + yakH >= canvasFloor)) {
        c._falling = false;
        c._fallStartY = undefined;
        c._stunTimer = 80; c._stunTotal = 80;
        c.vx = 0;
      }

      // Session grid push: if session popup overlaps yak, knock it back and stun
      const sessR = _cachedSessR;
      if (sessR && !c._stunTimer) {
        const yakRight = c.x + yakW, yakLeft = c.x;
        if (yakRight > sessR.left && yakLeft < sessR.right && c.y + yakH > sessR.top && c.y < sessR.bottom) {
          // Knock back away from grid — teleport out, then stun in place
          const gridCX = (sessR.left + sessR.right) / 2;
          c.x = yakCX < gridCX ? sessR.left - yakW - 2 : sessR.right + 2;
          c.vx = 0;
          c._stunTimer = 70; c._stunTotal = 70;
        }
      }

      // Stunned: animated collapse — body flattens, head drops, legs splay
      if (c._stunTimer > 0) {
        const stunTotal = c._stunTotal || 80;
        const elapsed = stunTotal - c._stunTimer;
        c._stunTimer -= _dt;
        c.vx = 0;
        c.el.style.left = c.x + 'px';
        c.el.style.top = c.y + 'px';
        if (c.g) {
          // Collapse progress: quick slam down (first 15%), hold flat, get up (last 25%)
          let t; // 0 = standing, 1 = fully collapsed
          if (elapsed < stunTotal * 0.15) {
            t = (elapsed / (stunTotal * 0.15)); // ease into collapse
            t = t * t; // ease-in (accelerate into ground)
          } else if (elapsed > stunTotal * 0.75) {
            t = 1 - ((elapsed - stunTotal * 0.75) / (stunTotal * 0.25));
            t = t * t; // ease-out (slow rise)
          } else {
            t = 1; // fully collapsed
          }
          c.g.setAttribute('transform', ''); // clear any rotation
          // Squish body: ry shrinks, body drops
          const bodyEl = c.g.querySelector('ellipse');
          if (bodyEl) {
            bodyEl.setAttribute('ry', String(5 - t * 2.5)); // 5 → 2.5
            bodyEl.setAttribute('cy', String(10 + t * 4)); // drop down
          }
          // Head drops and comes forward
          const headEl = c.g.querySelector('circle');
          if (headEl) {
            headEl.setAttribute('cy', String(7 + t * 7)); // 7 → 14
          }
          // Legs splay outward and flatten
          const legs = c.g.querySelectorAll('line');
          const legXs = [8, 13, 19, 24];
          legs.forEach((leg, i) => {
            const lx = legXs[i] || 16;
            const splay = (i < 2 ? -1 : 1) * t * 5; // outer legs splay more
            leg.setAttribute('x1', String(lx + splay * 0.3));
            leg.setAttribute('y1', String(14 + t * 2));
            leg.setAttribute('x2', String(lx + splay));
            leg.setAttribute('y2', String(22 - t * 4)); // legs flatten up
          });
        }
        continue;
      } else if (c.g && c._stunTimer !== undefined && c._stunTimer <= 0) {
        // Fully recovered — restore normal shape
        c._stunTimer = undefined;
        c._stunTotal = undefined;
        const bodyEl = c.g.querySelector('ellipse');
        if (bodyEl) { bodyEl.setAttribute('ry', '5'); bodyEl.setAttribute('cy', '10'); }
        const headEl = c.g.querySelector('circle');
        if (headEl) { headEl.setAttribute('cy', '7'); }
        const legs = c.g.querySelectorAll('line');
        const legXs = [8, 13, 19, 24];
        legs.forEach((leg, i) => {
          leg.setAttribute('x1', String(legXs[i]));
          leg.setAttribute('y1', '14');
          leg.setAttribute('x2', String(legXs[i]));
          leg.setAttribute('y2', '22');
        });
        c.vx = (Math.random() < 0.5 ? -1 : 1) * (0.12 + Math.random() * 0.15);
        _flipYak(c);
      }

      c.walkT += 0.025 * _dt;
      const bob = Math.sin(c.walkT * 3) * 1;
      c._bob = bob;
      c.el.style.left = c.x + 'px';
      c.el.style.top = (c.y + bob) + 'px';
      // Animate legs
      if (c.legs && c.legs.length === 4) {
        const swing = Math.sin(c.walkT * 3) * 4;
        c.legs[0].setAttribute('x2', parseFloat(c.legs[0].getAttribute('x1')) + swing);
        c.legs[3].setAttribute('x2', parseFloat(c.legs[3].getAttribute('x1')) + swing);
        c.legs[1].setAttribute('x2', parseFloat(c.legs[1].getAttribute('x1')) - swing);
        c.legs[2].setAttribute('x2', parseFloat(c.legs[2].getAttribute('x1')) - swing);
      }
      // Flip direction — head always faces forward
      _flipYak(c);
      if (c._exiting) {
        if (c.x < -40 || c.x > window.innerWidth + 40) {
          c.el.remove(); _creatures.splice(i, 1); continue;
        }
      } else {
        if (onOutlinerPlatform) {
          // On outliner platforms, wall = the platform's own left edge (not screen x=0)
          const platLeft = (_cachedFootR?.left ?? _cachedArchR?.left ?? 0);
          if (c.x <= platLeft) { c.x = platLeft; c.vx = Math.abs(c.vx); }
          if (c.x >= c.boundRight) { c.vx = -Math.abs(c.vx); }
        } else {
          // Canvas floor — left screen edge is always a wall
          if (c.x <= 0) { c.x = 0; c.vx = Math.abs(c.vx); }
          if (c.x <= c.boundLeft && c.boundLeft > 0) { c.vx = Math.abs(c.vx); }
          if (c.x >= c.boundRight) { c.vx = -Math.abs(c.vx); }
        }
      }
      // Blood trail while wounded — natural scatter like play mode
      if (c._woundCount > 0) {
        c._bloodTrailTimer = (c._bloodTrailTimer || 0) + _dt;
        // More wounds = slightly faster drip, but more irregular spacing
        const baseInterval = Math.max(20, Math.floor(70 / c._woundCount));
        const interval = baseInterval + Math.floor(Math.random() * baseInterval * 0.6); // ±30% jitter
        if (c._bloodTrailTimer >= interval) {
          c._bloodTrailTimer = 0;
          // Scatter: wider horizontal spread, some drops fall further behind
          const dropX = c.x + 16 + (Math.random() - 0.5) * 20 + (c.vx < 0 ? 3 : -3);
          const dropY = c.y + 18 + Math.random() * 8;
          // Sometimes spawn a cluster of 1-3 drops together (splotch effect)
          const clusterCount = Math.random() < 0.25 ? 2 + Math.floor(Math.random() * 2) : 1;
          for (let di = 0; di < clusterCount; di++) {
            const dot = document.createElement('div');
            const roll = Math.random();
            // Much more varied sizes: drips (40%), medium splotch (35%), large splotch (25%)
            const sz = roll < 0.4 ? (1 + Math.random() * 2) : roll < 0.75 ? (3 + Math.random() * 3) : (5 + Math.random() * 4);
            const szH = sz * (0.3 + Math.random() * 0.4); // less flat, more round variety
            const clusterOX = di > 0 ? (Math.random() - 0.5) * 8 : 0;
            const clusterOY = di > 0 ? Math.random() * 4 : 0;
            dot.className = 'dex-blood';
            dot.style.cssText = `position:fixed;left:${dropX + clusterOX - sz/2}px;top:${dropY + clusterOY}px;width:${sz}px;height:${szH}px;border-radius:50%;background:${_bloodClr()};opacity:${0.4 + Math.random()*0.4};pointer-events:none;z-index:0;`;
            document.body.appendChild(dot);
            _anchorFxEl(dot, dropX + clusterOX - sz / 2, dropY + clusterOY);
            setTimeout(() => { dot.style.transition = 'opacity 4s'; dot.style.opacity = '0'; }, 36000);
            setTimeout(() => dot.remove(), 40100);
          }
        }
      }
    }
  }
}

function _flipYak(c) {
  if (!c.g) return;
  // Head is drawn on right side — flip entire group when moving left
  const w = c.kind === 'deer' ? 28 : 32;
  c.g.setAttribute('transform', c.vx < 0 ? `translate(${w},0) scale(-1,1)` : '');
}

function _hitCreature(px, py, isArrow, isRocket, prevPx, prevPy) {
  for (const c of _creatures) {
    if (c.dead) continue;
    const birdScale = c.scale || 1;
    const cx = c.kind === 'bird' ? c.x + 10 * birdScale : c.x + 16;
    const cy = c.kind === 'bird' ? c.y + 6 * birdScale : c.y + 14;
    const hitW = c.kind === 'bird' ? Math.round(14 * birdScale) + 6 : 22;
    const hitH = c.kind === 'bird' ? Math.round(10 * birdScale) + 6 : 18;
    // Point-in-box check at current position
    let hit = Math.abs(px - cx) < hitW && Math.abs(py - cy) < hitH;
    // Swept check: if arrow moved fast, test along its path this frame
    if (!hit && prevPx !== undefined && prevPy !== undefined) {
      const dx = px - prevPx, dy = py - prevPy;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 10)); // check every 10px
      for (let s = 1; s <= steps && !hit; s++) {
        const t = s / steps;
        const mx = prevPx + dx * t, my = prevPy + dy * t;
        if (Math.abs(mx - cx) < hitW && Math.abs(my - cy) < hitH) hit = true;
      }
    }
    if (hit) {
      // Headshot detection (yaks only — birds are 1hp)
      let headshot = false;
      if (c.kind === 'yak') {
        // Head is at x+28, y+7 (right side), radius ~4px. Flip if moving left.
        const headX = c.vx < 0 ? c.x + 4 : c.x + 28;
        const headY = c.y + 7;
        if (Math.hypot(px - headX, py - headY) < 6) headshot = true;
      }
      // Damage: rocket > arrow headshot > bullet headshot > arrow body > bullet body
      let dmg;
      if (isRocket) { dmg = c.hp; }
      else if (headshot) { dmg = isArrow ? c.hp : 4; }
      else { dmg = isArrow ? 2 : 1; }
      c.hp -= dmg;
      // Blood splatter at hit point (no flash — matches play mode)
      _spawnHitBloodSession(px, py, 4 + Math.floor(Math.random() * 3), c.kind === 'bird');
      // Wound tracking for blood trail
      if (c.hp > 0 && c.kind === 'yak') {
        c._woundCount = (c._woundCount || 0) + 1;
      }
      if (c.hp <= 0) {
        c.dead = true;
        if (c.kind === 'bird') {
          _spawnFeathers(c.x + 10, c.y + 6, 12);
          c.falling = true; c.vy = 0;
          c.fallVx = c.vx * 0.3; c.vx = 0;
        } else {
          _killSessionCreature(c, 32, 24, isRocket);
        }
      }
      return c; // return creature for arrow embedding
    }
  }
  return false;
}

function _checkYakStomp(px, py) {
  for (const c of _creatures) {
    if ((c.kind !== 'yak' && c.kind !== 'deer') || c.dead) continue;
    // Check if character feet landed on the yak
    if (px >= c.x - 4 && px <= c.x + 32 && Math.abs(py - c.y) < 10) {
      c.dead = true;
      _killSessionCreature(c, 32, 24, false);
      return;
    }
  }
}

function _killSessionCreature(c, w, h, isRocket) {
  const cx = c.x + w/2;
  const cy = c.y + h/2;
  c.vx = 0;
  c.deadT = 0;

  if (isRocket) {
    // ── ROCKET DEATH: instant removal + explosion gore ──
    if (c.el) { c.el.remove(); c.el = null; }
    _spawnRocketGoreSession(cx, cy, w, h);
    return;
  }

  // ── NORMAL DEATH: tip over to the side (no squish) ──
  _spawnHitBloodSession(cx, cy, 6);
  if (c.el) {
    // Fall to the side — rotate 90° and drop to ground level
    const fallDir = c.vx >= 0 ? 1 : -1; // tip in the direction it was moving
    c.el.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.8, 1)';
    c.el.style.transformOrigin = `${fallDir > 0 ? 'right' : 'left'} bottom`;
    c.el.style.transform = `rotate(${fallDir * 90}deg)`;
    setTimeout(() => {
      if (!c.el) return;
      c.el.style.transition = 'none';
    }, 280);
    // Fade out after 30 seconds
    setTimeout(() => { if (c.el) { c.el.style.transition = 'opacity 3s'; c.el.style.opacity = '0'; } }, 30000);
    setTimeout(() => { if (c.el) { c.el.remove(); c.el = null; } }, 33000);
  }
  // Blood puddle grows smoothly. Coordinates are re-derived from the
  // creature at each step — the world may have camera-shifted since death
  // (MD 06b issue 2), and c.x/c.y are kept live by the shift bridge.
  const _puddleOffX = cx - c.x, _puddleOffY = (c.y + h - 2) - c.y;
  const _puddleSteps = [
    { delay: 100, scale: 0.2 },
    { delay: 400, scale: 0.45 },
    { delay: 900, scale: 0.7 },
    { delay: 1800, scale: 0.9 },
    { delay: 3000, scale: 1.0 },
  ];
  _puddleSteps.forEach(step => {
    setTimeout(() => _spawnBloodPuddleSession(c.x + _puddleOffX, c.y + _puddleOffY, step.scale), step.delay);
  });
  // Fade and remove after 45s
  setTimeout(() => { if (!c.el) return; c.el.style.transition = 'opacity 6s ease-out'; c.el.style.opacity = '0'; }, 36000);
  setTimeout(() => { if (c.el) { c.el.remove(); c.el = null; } }, 42500);
}

function _spawnRocketGoreSession(cx, cy, w, h) {
  const clr = _bloodClr();
  const accentClr = getAccent();

  // Flash — brief expanding circle
  const flash = document.createElement('div');
  const flashSz = 40;
  flash.style.cssText = `position:fixed;left:${cx-flashSz/2}px;top:${cy-flashSz/2}px;width:${flashSz}px;height:${flashSz}px;border-radius:50%;background:${clr};opacity:0.5;pointer-events:none;z-index:3;transform:scale(0.3);transition:transform 0.15s ease-out,opacity 0.15s ease-out;`;
  document.body.appendChild(flash);
  requestAnimationFrame(() => { flash.style.transform = 'scale(1.2)'; flash.style.opacity = '0'; });
  setTimeout(() => flash.remove(), 200);

  // Ring 1: dense center — large slow blobs
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 4 + Math.random() * 10;
    const tx = Math.cos(a) * spd;
    const ty = Math.abs(Math.sin(a)) * spd * 0.15 + Math.random() * 2;
    const sz = 4 + Math.random() * 5;
    _spawnGoreParticle(cx, cy, tx, ty, sz, clr, 0.2 + Math.random() * 0.15);
  }
  // Ring 2: medium scatter
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 14 + Math.random() * 22;
    const tx = Math.cos(a) * spd;
    const ty = Math.abs(Math.sin(a)) * spd * 0.12 + Math.random() * 3;
    const sz = 2.5 + Math.random() * 3;
    _spawnGoreParticle(cx, cy, tx, ty, sz, clr, 0.18 + Math.random() * 0.15);
  }
  // Ring 3: sparse far drops
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 28 + Math.random() * 30;
    const tx = Math.cos(a) * spd;
    const ty = Math.abs(Math.sin(a)) * spd * 0.1 + Math.random() * 3;
    const sz = 1.2 + Math.random() * 2;
    _spawnGoreParticle(cx, cy, tx, ty, sz, clr, 0.15 + Math.random() * 0.12);
  }
  // Body parts — accent-colored lines and shapes that fly outward
  const partDefs = [
    { w:2, h:8 }, { w:2, h:8 }, { w:2, h:7 }, { w:2, h:7 },
    { w:10, h:4 }, { w:5, h:5, round:true },
  ];
  for (const def of partDefs) {
    const a = Math.random() * Math.PI * 2;
    const spd = 18 + Math.random() * 25;
    const tx = Math.cos(a) * spd;
    const ty = Math.abs(Math.sin(a)) * spd * 0.12 + Math.random() * 3;
    const rot = Math.random() * 360;
    const rotEnd = rot + (Math.random() - 0.5) * 300;
    const dur = 0.2 + Math.random() * 0.15;
    const pw = def.w, ph = def.h;
    const part = document.createElement('div');
    part.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;width:${pw}px;height:${ph}px;${def.round?'border-radius:50%;':'border-radius:1px;'}border:1.5px solid ${accentClr};background:none;pointer-events:none;z-index:3;transform:translate(0,0) rotate(${rot}deg);transition:transform ${dur}s cubic-bezier(0.15,0.7,0.3,1);`;
    document.body.appendChild(part);
    _anchorFxEl(part, cx, cy);
    requestAnimationFrame(() => { part.style.transform = `translate(${tx}px,${ty}px) rotate(${rotEnd}deg)`; });
    // Parts land and persist, squished flat
    setTimeout(() => {
      part.style.transition = 'none';
      part.style.width = (pw * 1.4) + 'px';
      part.style.height = Math.max(1, ph * 0.3) + 'px';
    }, dur * 1000 + 20);
    setTimeout(() => { part.style.transition = 'opacity 4s'; part.style.opacity = '0'; }, 30000);
    setTimeout(() => part.remove(), 34100);
  }
  // Blood puddle at center
  setTimeout(() => _spawnBloodPuddleSession(cx, cy + h/2 - 2, 0.8), 100);
  setTimeout(() => _spawnBloodPuddleSession(cx, cy + h/2 - 2, 1.2), 600);
}

function _spawnGoreParticle(cx, cy, tx, ty, sz, clr, dur) {
  const dot = document.createElement('div');
  dot.className = 'dex-blood';
  dot.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;width:${sz}px;height:${sz*0.3}px;border-radius:50%;background:${clr};opacity:0.85;pointer-events:none;z-index:3;transform:translate(0,0);transition:transform ${dur}s cubic-bezier(0.15,0.7,0.3,1);`;
  document.body.appendChild(dot);
  _anchorFxEl(dot, cx, cy);
  requestAnimationFrame(() => { dot.style.transform = `translate(${tx}px,${ty}px)`; });
  // Land and persist, squish flat
  setTimeout(() => {
    dot.style.transition = 'none';
    dot.style.width = (sz * 1.3) + 'px';
    dot.style.height = (sz * 0.2) + 'px';
  }, dur * 1000 + 20);
  setTimeout(() => { dot.style.transition = 'opacity 4s'; dot.style.opacity = '0'; }, 30000);
  setTimeout(() => dot.remove(), 34100);
}

function _bloodClr() {
  const clr = getAccent();
  if (window._dexBloodEnabled === false) return clr;
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  return isLight ? '#a83232' : '#e05c5c';
}

function _spawnHitBloodSession(x, y, count, isBird) {
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('div');
    const angle = Math.random() * Math.PI * 2;
    const speed = 6 + Math.random() * 14;
    // Birds: small radial burst that fades fast. Ground creatures: horizontal spread, bias downward, stays as stain.
    const tx = Math.cos(angle) * speed * (isBird ? 0.5 : 1);
    const ty = isBird ? Math.abs(Math.sin(angle)) * speed * 0.3 + Math.random() * 3 : Math.abs(Math.sin(angle)) * speed * 0.12 + Math.random() * 2;
    const r = Math.random();
    const size = isBird ? (1 + Math.random() * 2) : r < 0.5 ? (1.5 + Math.random() * 2) : r < 0.85 ? (3 + Math.random() * 3) : (5 + Math.random() * 3);
    const dur = isBird ? 0.12 + Math.random() * 0.1 : 0.15 + Math.random() * 0.2;
    dot.className = 'dex-blood';
    dot.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${size}px;height:${size*0.3}px;border-radius:50%;background:${_bloodClr()};opacity:0.8;pointer-events:none;z-index:2;transform:translate(0,0);transition:transform ${dur}s cubic-bezier(0.15,0.7,0.3,1);`;
    document.body.appendChild(dot);
    _anchorFxEl(dot, x, y);
    requestAnimationFrame(() => { dot.style.transform = `translate(${tx}px,${ty}px)`; });
    const fadeDelay = isBird ? 400 : 30000;
    const fadeDur = isBird ? 0.6 : 4;
    setTimeout(() => { dot.style.transition = `opacity ${fadeDur}s`; dot.style.opacity = '0'; }, fadeDelay);
    setTimeout(() => dot.remove(), fadeDelay + fadeDur * 1000 + 100);
  }
}

function _spawnBloodPuddleSession(x, y, scale) {
  scale = scale || 1;
  const container = document.createElement('div');
  container.style.cssText = `position:fixed;left:${x}px;top:${y}px;pointer-events:none;z-index:0;`;
  document.body.appendChild(container);
  _anchorFxEl(container, x, y);
  const ns = 'http://www.w3.org/2000/svg';
  const pw = (22 + Math.random() * 12) * scale, ph = (5 + Math.random() * 3) * scale;
  const mainSvg = document.createElementNS(ns, 'svg');
  mainSvg.setAttribute('width', pw); mainSvg.setAttribute('height', ph + 6);
  mainSvg.setAttribute('viewBox', `0 0 ${pw} ${ph + 6}`);
  mainSvg.style.cssText = `position:absolute;left:${-pw/2}px;top:${-ph/2}px;overflow:visible;`;
  const puddle = document.createElementNS(ns, 'ellipse');
  puddle.setAttribute('cx', pw/2); puddle.setAttribute('cy', ph/2+2);
  puddle.setAttribute('rx', pw/2); puddle.setAttribute('ry', ph/2);
  puddle.classList.add('dex-blood');
  puddle.setAttribute('fill', _bloodClr()); puddle.setAttribute('opacity', '0.72');
  mainSvg.appendChild(puddle); container.appendChild(mainSvg);
  const splatCount = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < splatCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = pw * 0.5 + Math.random() * pw * 0.55;
    // 2D platformer: splatter stays near ground, mostly horizontal
    const tx = Math.cos(angle) * dist, ty = Math.abs(Math.sin(angle)) * dist * 0.1;
    const dotR = (1.5 + Math.random() * 3) * scale;
    const dot = document.createElement('div');
    dot.className = 'dex-blood';
    const dotDur = 0.15 + Math.random() * 0.2;
    dot.style.cssText = `position:absolute;width:${dotR*2}px;height:${dotR*0.45}px;border-radius:50%;background:${_bloodClr()};opacity:0.68;left:${-dotR}px;top:${-dotR*0.2}px;transform:translate(0,0);transition:transform ${dotDur}s cubic-bezier(0.2,0.8,0.4,1);pointer-events:none;`;
    container.appendChild(dot);
    requestAnimationFrame(() => { dot.style.transform = `translate(${tx}px,${ty}px)`; });
  }
  setTimeout(() => { container.style.transition = 'opacity 6s'; container.style.opacity = '0'; }, 36000);
  setTimeout(() => container.remove(), 42100);
}

function _spawnBloodPuddle(x, y) {
  const container = document.createElement('div');
  container.style.cssText = `position:fixed;left:${x}px;top:${y}px;pointer-events:none;z-index:0;`;
  document.body.appendChild(container);
  _anchorFxEl(container, x, y);
  const ns = 'http://www.w3.org/2000/svg';
  // Main puddle
  const pw = 24 + Math.random() * 12, ph = 5 + Math.random() * 3;
  const mainSvg = document.createElementNS(ns, 'svg');
  mainSvg.setAttribute('width', pw); mainSvg.setAttribute('height', ph + 4);
  mainSvg.setAttribute('viewBox', `0 0 ${pw} ${ph + 4}`);
  mainSvg.style.cssText = `position:absolute;left:${-pw/2}px;top:${-ph/2}px;overflow:visible;`;
  const puddle = document.createElementNS(ns, 'ellipse');
  puddle.setAttribute('cx', pw/2); puddle.setAttribute('cy', ph/2 + 2);
  puddle.setAttribute('rx', pw/2); puddle.setAttribute('ry', ph/2);
  puddle.classList.add('dex-blood');
  puddle.setAttribute('fill', _bloodClr()); puddle.setAttribute('opacity', '0.75');
  mainSvg.appendChild(puddle); container.appendChild(mainSvg);
  // Splatter dots
  const splatCount = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < splatCount; i++) {
    const dot = document.createElement('div');
    dot.className = 'dex-blood';
    const dotR = 2 + Math.random() * 4;
    const angle = Math.random() * Math.PI * 2;
    const dist = 12 + Math.random() * 22;
    const tx = Math.cos(angle) * dist, ty = Math.sin(angle) * dist * 0.4;
    const dur = 0.15 + Math.random() * 0.2;
    dot.style.cssText = `position:absolute;width:${dotR*2}px;height:${dotR}px;border-radius:50%;background:${_bloodClr()};opacity:0.7;left:${-dotR}px;top:${-dotR/2}px;transform:translate(0,0);transition:transform ${dur}s cubic-bezier(0.2,0.8,0.4,1);pointer-events:none;`;
    container.appendChild(dot);
    requestAnimationFrame(() => { dot.style.transform = `translate(${tx}px,${ty}px)`; });
  }
  setTimeout(() => { container.style.transition = 'opacity 1.5s'; container.style.opacity = '0'; }, 6000);
  setTimeout(() => container.remove(), 7600);
}

function _spawnFeathers(x, y, count) {
  for (let i = 0; i < count; i++) {
    const f = document.createElement('div');
    const angle = Math.random() * Math.PI * 2;
    const dist = 15 + Math.random() * 25; // larger spread
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist - 15; // strong upward bias
    const rot = Math.random() * 720;
    const dur = 1.0 + Math.random() * 1.0; // 1-2 second float
    f.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:6px;height:3px;background:var(--clr-adj,#7B8A9C);border-radius:50%;pointer-events:none;z-index:149;opacity:0.9;transition:all ${dur}s cubic-bezier(0.2,0.8,0.3,1);transform:translate(0,0) rotate(0deg);`;
    document.body.appendChild(f);
    _anchorFxEl(f, x, y);
    requestAnimationFrame(() => {
      f.style.transform = `translate(${tx}px,${ty}px) rotate(${rot}deg)`;
      f.style.opacity = '0';
    });
    setTimeout(() => f.remove(), dur * 1000 + 200);
  }
}

// Activity-based creature spawning — creatures appear/disappear based on decaying activity
let _activityScore = 0;       // decaying activity level (0 = AFK, higher = active)
let _lastSpawnCheck = 0;
let _lastDecayTick = 0;
const MAX_BIRDS = 7;
const MAX_YAKS = 5;
const ACTIVITY_DECAY_RATE = 0.4;  // points lost per second when idle
const ACTIVITY_MAX = 60;          // cap so it doesn't accumulate infinitely
const ACTION_BOOST = 2;           // points gained per action

function _trackAction() {
  _activityScore = Math.min(ACTIVITY_MAX, _activityScore + ACTION_BOOST);
}

function _tickCreatureSpawner() {
  if (window._dexAvatarEnabled === false) return;
  if (_isPlayModeFn && _isPlayModeFn()) return; // no session creatures in play mode
  const now = Date.now();

  // Decay activity score over time
  if (_lastDecayTick) {
    const dtSec = (now - _lastDecayTick) / 1000;
    _activityScore = Math.max(0, _activityScore - ACTIVITY_DECAY_RATE * dtSec);
  }
  _lastDecayTick = now;

  // Check spawns/despawns every 1.5 seconds
  if (now - _lastSpawnCheck < 1500) return;
  _lastSpawnCheck = now;

  const liveBirds = _creatures.filter(c => c.kind === 'bird' && !c.dead && !c.falling && !c.landed).length;
  const liveYaks = _creatures.filter(c => (c.kind === 'yak' || c.kind === 'deer') && !c.dead).length;

  const hdrBot = 60; // former notes-app header bottom — now a plain top margin

  // How many creatures the current activity level supports
  const maxBirdsNow = Math.min(MAX_BIRDS, Math.floor(_activityScore / 6));
  const maxYaksNow = Math.min(MAX_YAKS, Math.floor(Math.max(0, _activityScore - 8) / 10));

  // --- SPAWN if under quota ---
  if (liveBirds < maxBirdsNow && Math.random() < 0.7) {
    const x = Math.random() < 0.5 ? -20 : window.innerWidth + 20;
    const vx = x < 0 ? (0.2 + Math.random() * 0.2) : -(0.2 + Math.random() * 0.2);
    const y = hdrBot + 5 + Math.random() * 30;
    _spawnBird(x, y, vx);
  }

  if (_activityScore > 8 && liveYaks < maxYaksNow && Math.random() < 0.45) {
    const x = 150 + Math.random() * (window.innerWidth - 300);
    const vx = (Math.random() < 0.5 ? 1 : -1) * (0.12 + Math.random() * 0.15);
    if (Math.random() < 0.5) _spawnDeer(x, vx);
    else _spawnYak(x, vx);
  }

  // --- DESPAWN if over quota (activity dropped) ---
  if (liveBirds > maxBirdsNow) {
    const exitBird = _creatures.find(c => c.kind === 'bird' && !c.dead && !c.falling && !c.landed && !c._exiting);
    if (exitBird) {
      exitBird._exiting = true;
      exitBird.vx = exitBird.x < window.innerWidth / 2 ? -0.4 : 0.4;
    }
  }

  if (liveYaks > maxYaksNow) {
    const exitYak = _creatures.find(c => (c.kind === 'yak' || c.kind === 'deer') && !c.dead && !c._exiting);
    if (exitYak) {
      exitYak._exiting = true;
      exitYak.vx = exitYak.x < window.innerWidth / 2 ? -0.2 : 0.2;
    }
  }
}

// ═══════════════════════════════════
//  CARRY ANIMALS
// ═══════════════════════════════════

function _findNearbyCarryable() {
  const range = 50;
  const inPM = _isPlayModeFn && _isPlayModeFn();
  if (inPM) {
    // Play mode — find nearby yak via bridge, then hide from canvas and create SVG
    if (window._dexCarryCreature) return window._dexCarryCreature(range);
    return null;
  }
  // Sessions mode — check DOM creatures
  for (const c of _creatures) {
    if (c.dead || c._exiting || c._thrown) continue;
    if (c.kind !== 'yak' && c.kind !== 'deer') continue;
    if (Math.abs(P.x - c.x - 16) < range && Math.abs(P.y - c.y - 10) < range) return c;
  }
  return null;
}


function _pickUpCreature(c) {
  _carriedCreature = c;
  _carryAnimT = 0;
  _carryKickPhase = 'kick';
  _carryKickTimer = 0;
  _carryThrowCharge = 0;
  _carryThrowCharging = false;
  // Store Y offset so we drop at the same relative height
  _carryPickupYOffset = (c.y || 0) - P.y;

  // Unequip current weapon (keep hoverboard)
  if (_gun.held) _dropGun();
  _bow.holstered = true;
  _bow.drawing = false;

  // Remove arrows stuck in this creature
  for (let i = _arrows.length - 1; i >= 0; i--) {
    if (_arrows[i].stuckCreature === c) {
      if (_arrows[i].el) _arrows[i].el.remove();
      _arrows.splice(i, 1);
    }
  }

  // Hide the creature's normal DOM element
  if (c.el) c.el.style.display = 'none';

  // Create carried version as SVG group inside character SVG
  const charG = _svgEl?.querySelector('g');
  if (!charG) return;

  const carryG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  carryG.id = _uid + '-carried';
  // Clone the creature's SVG content
  const creatureSvg = c.g || (c.el ? c.el.querySelector('svg g') : null);
  if (creatureSvg) {
    const clone = creatureSvg.cloneNode(true);
    clone.removeAttribute('transform'); // strip facing transform — always head-right
    carryG.appendChild(clone);
  }
  // Insert before torso (renders between head and body)
  const torsoEl = _el('torso');
  if (torsoEl) charG.insertBefore(carryG, torsoEl);
  else charG.appendChild(carryG);

  // Create forearm overlay group (always on top of carried animal)
  const forearmG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  forearmG.id = _uid + '-carry-forearms';
  charG.appendChild(forearmG);
}

function _dropCarriedCreature() {
  if (!_carriedCreature) return;
  const c = _carriedCreature;

  // Remove carried SVG from character
  const carryG = document.getElementById(_uid + '-carried');
  if (carryG) carryG.remove();
  const forearmG = document.getElementById(_uid + '-carry-forearms');
  if (forearmG) forearmG.remove();

  // Restore creature
  c._carried = false;
  if (c._pmCreature) {
    // Play mode creature — remove temp DOM, restore world position
    if (c.el) { c.el.remove(); c.el = null; c.g = null; }
    if (_screenToWorldFn) {
      const w = _screenToWorldFn(P.x, P.y);
      c.x = w.wx; c.y = w.wy;
    }
    // Gentle toss toward mouse cursor side, 30-50px arc
    const tossDir = _lastMouseX < P.x ? -1 : 1;
    c.vx = tossDir * (0.6 + Math.random() * 0.3);
    c.vy = (Math.random() - 0.5) * 0.3;
    c._thrown = true;
    c._thrownTimer = 50;
    c._throwPower = 0; // low power = no stun on landing
  } else {
    // Sessions mode — gentle drop, lands on feet and walks
    if (c.el) {
      c.x = P.x + (flipX ? -20 : 20);
      c.y = P.y - 22;
      c.vy = 0;
      c.vx = (flipX ? -1 : 1) * (0.12 + Math.random() * 0.15);
      const onOutliner = P.floorType === 'sbfoot' || P.floorType === 'archive';
      c.el.style.zIndex = onOutliner ? '11' : '1';
      c.el.style.display = '';
      c.el.style.left = c.x + 'px';
      c.el.style.top = c.y + 'px';
    }
  }

  _carriedCreature = null;
  _carryThrowCharge = 0;
  _carryThrowCharging = false;
}

function _throwCarriedCreature() {
  if (!_carriedCreature) return;
  const c = _carriedCreature;
  const power = Math.min(_carryThrowCharge / 60, 1);

  // Remove carried SVG
  const carryG = document.getElementById(_uid + '-carried');
  if (carryG) carryG.remove();
  const forearmG = document.getElementById(_uid + '-carry-forearms');
  if (forearmG) forearmG.remove();

  // Launch creature in aimed direction
  c._throwPower = power; // store for landing stun check
  const angle = Math.atan2(_lastMouseY - P.y, _lastMouseX - P.x);
  const speed = 3 + power * 8;
  c._carried = false;

  if (c._pmCreature) {
    // Play mode — remove temp DOM, restore to world with velocity
    if (c.el) { c.el.remove(); c.el = null; c.g = null; }
    if (_screenToWorldFn) {
      const w = _screenToWorldFn(P.x, P.y);
      c.x = w.wx; c.y = w.wy;
    }
    if (power < 0.15) {
      // Quick click = gentle toss toward cursor side (same as E-key drop)
      const tossDir = _lastMouseX < P.x ? -1 : 1;
      c.vx = tossDir * (0.6 + Math.random() * 0.3);
      c.vy = (Math.random() - 0.5) * 0.3;
      c._thrown = true;
      c._thrownTimer = 50;
      c._throwPower = 0;
    } else {
      // Charged throw — arc toward cursor
      const pmSpeed = 2 + power * 4;
      c.vx = Math.cos(angle) * pmSpeed;
      c.vy = Math.sin(angle) * pmSpeed;
      c._thrown = true;
      c._thrownTimer = 80 + Math.floor(power * 60);
    }
  } else {
    // Sessions mode — launch from player feet position (30% reduced)
    const sessSpeed = speed * 0.7;
    c.x = P.x - 16;
    c.y = P.y - 22;
    c.vx = Math.cos(angle) * sessSpeed;
    c.vy = Math.sin(angle) * sessSpeed - 1.5; // upward arc bias
    if (c.el) {
      const onOutliner = P.floorType === 'sbfoot' || P.floorType === 'archive';
      c.el.style.zIndex = onOutliner ? '11' : '1';
      c.el.style.display = '';
    }
    c._thrown = true;
    c._thrownTimer = 120;
  }

  _carriedCreature = null;
  _carryThrowCharge = 0;
  _carryThrowCharging = false;
}

function _tickCarry() {
  if (!_carriedCreature) return;
  const c = _carriedCreature;

  // Block weapon use while carrying
  if (_gun.held) _dropGun();
  _bow.holstered = true;

  const inPM = _isPlayModeFn && _isPlayModeFn();

  // Sync creature position to player (world coords in play mode, screen in sessions)
  if (inPM && _screenToWorldFn) {
    const w = _screenToWorldFn(P.x, P.y);
    c.x = w.wx;
    c.y = w.wy;
  } else {
    c.x = P.x - 16;
    c.y = P.y - 22;
  }

  // Animate kicking phases — slower, more natural
  _carryKickTimer += _dt;
  if (_carryKickPhase === 'kick' && _carryKickTimer > 50) {
    _carryKickPhase = 'slack';
    _carryKickTimer = 0;
  } else if (_carryKickPhase === 'slack' && _carryKickTimer > 80) {
    _carryKickPhase = 'kick';
    _carryKickTimer = 0;
  }

  const carryG = document.getElementById(_uid + '-carried');
  if (!carryG) return;

  const charG = _svgEl?.querySelector('g');
  if (!charG) return;

  // ── Directional layering ──
  const movingUp = inPM && P.vy < -0.5;
  const movingDown = inPM && P.vy > 0.5;
  const forearmG = document.getElementById(_uid + '-carry-forearms');

  if (inPM && movingUp) {
    // Behind everything
    if (charG.firstChild !== carryG) charG.insertBefore(carryG, charG.firstChild);
  } else {
    // In front of torso, head, everything except forearm overlay
    if (forearmG && carryG.nextSibling !== forearmG) charG.insertBefore(carryG, forearmG);
    else if (!forearmG && charG.lastChild !== carryG) charG.appendChild(carryG);
  }
  // Forearm always on top
  if (forearmG && charG.lastChild !== forearmG) charG.appendChild(forearmG);

  // Position carried animal at waist level, tilted head-up
  const facingR = !flipX;
  const bobY = Math.sin(_carryAnimT * 0.04) * 0.8; // slower, subtler bob
  _carryAnimT += _dt;

  // Read current torso position to follow body movement
  const torsoEl = _el('torso');
  const torsoY = torsoEl ? parseFloat(torsoEl.getAttribute('y1')) || 14 : 14;
  const torsoX = torsoEl ? parseFloat(torsoEl.getAttribute('x1')) || 18 : 18;
  // Lower on torso (waist area) + tilt ~30° head-up
  const cx = torsoX - 16;
  const cy = torsoY + 2 + bobY; // lower than before (+2 instead of -6)
  const tiltDeg = -30; // head up, tail down (scaleX(-1) handles flip)
  carryG.setAttribute('transform', `translate(${cx}, ${cy}) rotate(${tiltDeg}, 16, 10)`);

  // Animate legs kicking — slower, gentler
  const legs = carryG.querySelectorAll('line');
  if (_carryKickPhase === 'kick') {
    const kickT = (_carryKickTimer / 30) * Math.PI * 1.5; // 1.5 kicks per phase (was 3)
    legs.forEach((leg, i) => {
      const offset = i * Math.PI * 0.5;
      const swing = Math.sin(kickT + offset) * 2.5; // smaller swing (was 4)
      const x1 = parseFloat(leg.getAttribute('x1'));
      leg.setAttribute('x2', String(x1 + swing));
    });
  } else {
    legs.forEach(leg => {
      const x1 = parseFloat(leg.getAttribute('x1'));
      leg.setAttribute('x2', String(x1));
    });
  }

  // ── Forearm overlay — wraps around animal belly ──
  if (forearmG) {
    forearmG.innerHTML = '';
    const ns = 'http://www.w3.org/2000/svg';
    const clr = 'var(--char-clr,var(--clr-adj,#7B8A9C))';
    // Arm wraps from shoulder area down to animal belly
    const animalCY = cy + 10; // center of animal body in SVG coords
    const shoulderY = torsoY + 2;

    if (inPM && (movingUp || movingDown)) {
      // Both forearms visible wrapping around animal
      for (const side of [-1, 1]) {
        const armX = torsoX + side * 6;
        const handX = torsoX + side * 8;
        const fa = document.createElementNS(ns, 'line');
        fa.setAttribute('x1', String(armX)); fa.setAttribute('y1', String(shoulderY));
        fa.setAttribute('x2', String(handX)); fa.setAttribute('y2', String(animalCY));
        fa.setAttribute('stroke', clr); fa.setAttribute('stroke-width', '2.2');
        fa.setAttribute('stroke-linecap', 'round');
        forearmG.appendChild(fa);
      }
    } else {
      // Side view — one arm in front wrapping around belly
      const side = facingR ? 1 : -1;
      const armX = torsoX + side * 4;
      const handX = torsoX + side * 2;
      const fa = document.createElementNS(ns, 'line');
      fa.setAttribute('x1', String(armX)); fa.setAttribute('y1', String(shoulderY));
      fa.setAttribute('x2', String(handX)); fa.setAttribute('y2', String(animalCY));
      fa.setAttribute('stroke', clr); fa.setAttribute('stroke-width', '2.2');
      fa.setAttribute('stroke-linecap', 'round');
      forearmG.appendChild(fa);
    }
  }

  // ── Lock arms around animal (override walk/idle arm swing) ──
  const animalCY2 = cy + 10;
  const shoulderY2 = torsoY + 2;
  // Back arm (behind animal)
  const backArm = facingR ? 'left' : 'right';
  const backSide = facingR ? -1 : 1;
  _setLine('upper-arm-' + backArm, torsoX, shoulderY2, torsoX + backSide * 3, shoulderY2 + 4);
  _setLine('lower-arm-' + backArm, torsoX + backSide * 3, shoulderY2 + 4, torsoX + backSide * 1, animalCY2);
  // Front arm (in front of animal)
  const frontArm = facingR ? 'right' : 'left';
  const frontSide = facingR ? 1 : -1;
  _setLine('upper-arm-' + frontArm, torsoX, shoulderY2, torsoX + frontSide * 3, shoulderY2 + 4);
  _setLine('lower-arm-' + frontArm, torsoX + frontSide * 3, shoulderY2 + 4, torsoX + frontSide * 1, animalCY2);

  // Throw charging
  if (_carryThrowCharging) {
    _carryThrowCharge = Math.min(_carryThrowCharge + _dt, 60);
  }
}

// ═══════════════════════════════════
//  BOW & ARROW
// ═══════════════════════════════════

function _getAccentColor() { return getAccent(); }
function _getArrowFlightColor() {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  return isDark ? (_getAccentColor()) : '#1a1a1a';
}

function _fireBowArrow() {
  if (_bow.chargeT < 4) return;
  const power = _bow.chargeT / MAX_BOW_CHARGE;
  sfx('shoot.bow', { power });
  const speed = BOW_MIN_SPEED + power * (BOW_MAX_SPEED - BOW_MIN_SPEED);
  const grav = BOW_MIN_GRAV - power * (BOW_MIN_GRAV - BOW_MAX_GRAV);
  const cosA = Math.cos(_bow.angle), sinA = Math.sin(_bow.angle);
  const originX = P.x + cosA * 14;
  const originY = (P.y - CHAR_H * 0.55) + sinA * 14;
  const flightLife = Math.round(400 + power * 800);
  const arrow = { x:originX, y:originY, vx:cosA*speed, vy:sinA*speed, grav, life:flightLife, el:null, stuck:false, stuckTimer:0, fromSelf:true, _originX:originX, _originY:originY };
  arrow.el = document.createElement('div');
  const arrowClr = _getArrowFlightColor();
  arrow.el.style.cssText = `position:fixed;width:18px;height:1.5px;background:${arrowClr};border-radius:1px;pointer-events:none;z-index:149;transform-origin:left center;`;
  document.body.appendChild(arrow.el);
  _arrows.push(arrow);
}

// Line segment intersection: returns {x,y,t} or null
function _segIntersect(p1x,p1y,p2x,p2y,p3x,p3y,p4x,p4y) {
  const d = (p4y-p3y)*(p2x-p1x) - (p4x-p3x)*(p2y-p1y);
  if (Math.abs(d) < 0.0001) return null;
  const ua = ((p4x-p3x)*(p1y-p3y) - (p4y-p3y)*(p1x-p3x)) / d;
  const ub = ((p2x-p1x)*(p1y-p3y) - (p2y-p1y)*(p1x-p3x)) / d;
  if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;
  return { x: p1x + ua*(p2x-p1x), y: p1y + ua*(p2y-p1y), t: ua };
}

function _stickArrow(a, x, y, creature, surface) {
  a.stuck = true; a.vx = 0; a.vy = 0;
  // Snap data coords to the stick point — the platformer shift bridge
  // repositions the element from a.x/a.y, so they must match exactly.
  a.x = x; a.y = y;
  a.stuckTimer = surface === 'creature' ? 1800 : 600; // 30s on animals, 10s on surfaces
  a.stuckCreature = creature || null;
  const inPM = _isPlayModeFn && _isPlayModeFn();
  if (creature && inPM && _screenToWorldFn) {
    const w = _screenToWorldFn(x, y);
    a._creatureOffX = w.wx - creature.x;
    a._creatureOffY = w.wy - creature.y;
  } else if (creature) {
    // Sessions mode: offset from creature's DOM position
    a._creatureOffX = x - creature.x;
    a._creatureOffY = y - creature.y;
  } else if (inPM && _screenToWorldFn) {
    // Store world position for non-creature stuck arrows
    const w = _screenToWorldFn(x, y);
    a._worldX = w.wx;
    a._worldY = w.wy;
  }
  a.el.style.left = x + 'px'; a.el.style.top = (y - 1) + 'px';
  // Switch to accent color when stuck (visible against surfaces)
  const stuckClr = _getAccentColor();
  a.el.style.background = stuckClr;
  a.el.style.boxShadow = 'none';
  if (!creature) a.el.style.zIndex = '201';
}

function _getArrowEmbedPoint(creature, arrowAngle) {
  // Place arrow tip just inside the body edge (shallow penetration from surface)
  const inPM = _isPlayModeFn && _isPlayModeFn();
  let cx, cy, bodyR;
  if (inPM) {
    const sc = creature.scale || 1;
    if (creature.kind === 'bird') { cx = creature.x; cy = creature.y; bodyR = 6; }
    else if (creature.kind === 'yak') { cx = creature.x; cy = creature.y - sc * 8; bodyR = 11 * sc; }
    else if (creature.kind === 'deer') { cx = creature.x; cy = creature.y - sc * 6; bodyR = 9 * sc; }
    else if (creature.kind === 'mammoth') { cx = creature.x; cy = creature.y - sc * 14; bodyR = 16 * sc; }
    else { cx = creature.x; cy = creature.y; bodyR = 6; }
  } else {
    if (creature.kind === 'bird') { cx = creature.x + 10; cy = creature.y + 6; bodyR = 6; }
    else if (creature.kind === 'yak') { cx = creature.x + 16; cy = creature.y + 10; bodyR = 11; }
    else { cx = creature.x + 16; cy = creature.y + 10; bodyR = 9; }
  }
  // Arrow tip at body edge minus small penetration (2-4px inside surface)
  const jitterAngle = arrowAngle + (Math.random() - 0.5) * 0.5;
  const penetration = 2 + Math.random() * 2; // 2-4px into the body from the surface
  const tipDist = bodyR - penetration; // distance from center to tip
  return {
    x: cx - Math.cos(jitterAngle) * tipDist,
    y: cy - Math.sin(jitterAngle) * tipDist,
  };
}

function _tickArrows() {
  for (let i = _arrows.length - 1; i >= 0; i--) {
    const a = _arrows[i];
    if (a.stuck) {
      a.stuckTimer -= _dt;
      if (a.stuckTimer <= 0) { a.el.remove(); _arrows.splice(i,1); continue; }
      const inPM = _isPlayModeFn && _isPlayModeFn();
      if (a.stuckCreature) {
        // Arrow embedded in creature — follow creature position
        const c = a.stuckCreature;
        // Remove arrow if creature dead long enough (play mode creatures have no .el)
        if (c.dead && (c.deadT || 0) > 2400) { a.el.remove(); _arrows.splice(i,1); continue; }
        // Session mode: remove if DOM element gone
        if (c.el === null) { a.el.remove(); _arrows.splice(i,1); continue; }
        const sx = c.x + (a._creatureOffX || 0);
        const sy = c.y + (a._creatureOffY || 0);
        if (inPM && _worldToScreenFn) {
          const s = _worldToScreenFn(sx, sy);
          a.el.style.left = s.sx + 'px'; a.el.style.top = (s.sy - 1) + 'px';
        } else {
          // Session mode — c.x/c.y are screen coords, include bob animation
          const creatureBob = c._bob || 0;
          if (c.dead && c.kind !== 'bird') {
            // Dead: drop arrow to ground level
            a.el.style.left = sx + 'px'; a.el.style.top = (c.y + 18) + 'px';
          } else {
            a.el.style.left = sx + 'px'; a.el.style.top = (sy + creatureBob - 1) + 'px';
          }
        }
      } else if (inPM && _worldToScreenFn && a._worldX !== undefined) {
        // Non-creature stuck arrow — convert world pos to screen each frame
        const s = _worldToScreenFn(a._worldX, a._worldY);
        a.el.style.left = s.sx + 'px'; a.el.style.top = (s.sy - 1) + 'px';
      }
      continue;
    }
    a._prevX = a.x; a._prevY = a.y;
    a.vy += a.grav * _dt; a.x += a.vx * _dt; a.y += a.vy * _dt; a.life -= _dt;
    a.travelAngle = Math.atan2(a.vy, a.vx);
    const angle = a.travelAngle * 180 / Math.PI;
    a.el.style.left = a.x + 'px'; a.el.style.top = (a.y-1) + 'px';
    a.el.style.transform = `rotate(${angle}deg)`;
    // Arrow trail particle — every 3rd frame
    if (_frameCount % 3 === 0) {
      const t = document.createElement('div');
      const tclr = _getArrowFlightColor();
      t.style.cssText = `position:fixed;left:${a.x}px;top:${a.y}px;width:3px;height:2px;border-radius:50%;background:${tclr};pointer-events:none;z-index:148;opacity:0.5;transition:opacity 0.25s ease-out;`;
      document.body.appendChild(t);
      requestAnimationFrame(() => { t.style.opacity = '0'; });
      setTimeout(() => t.remove(), 280);
    }
    // Clear self-immunity once arrow has traveled 60px from origin
    if (a.fromSelf) {
      const td = Math.hypot(a.x - (a._originX||a.x), a.y - (a._originY||a.y));
      if (td > 60) a.fromSelf = false;
    }
    // Self-hit: arrow passes through own head
    if (!a.fromSelf && !_playerDead) {
      const headX = P.x, headY = P.y - CHAR_H + 8;
      if (Math.abs(a.x - headX) < 8 && Math.abs(a.y - headY) < 8) {
        _triggerArrowDeath(a);
        _arrows.splice(i, 1);
        continue;
      }
    }
    const _pmActive = _isPlayModeFn && _isPlayModeFn();
    // Hit header/outliner/floor — only in normal mode (not play mode)
    if (!_pmActive) {
      // Arrows used to stick into the notes-app header and sidebar edge.
      // Only the floor stops them now.
      if (a.y >= getCanvasFloorY()) { _stickArrow(a, a.x, getCanvasFloorY() - 2); continue; }
    }
    // Hit creatures (session mode only — play mode has its own creature system)
    const hitSC = _pmActive ? null : _hitCreature(a.x, a.y, true, false, a._prevX, a._prevY);
    if (hitSC) {
      if (hitSC.kind === 'bird') { _spawnFeathers(a.x, a.y, 4); a.el.remove(); _arrows.splice(i,1); }
      else {
        // Embed arrow inside the creature body (not at raw arrow position)
        const embed = _getArrowEmbedPoint(hitSC, a.travelAngle || Math.atan2(a.vy, a.vx));
        _stickArrow(a, embed.x, embed.y, hitSC, 'creature');
        a._creatureOffX = embed.x - hitSC.x;
        a._creatureOffY = embed.y - hitSC.y;
      }
      continue;
    }
    // Hit playmode creatures
    if (_pmActive && _hitPlayCreaturesFn) {
      const hitC = _hitPlayCreaturesFn(a.x, a.y, false, a.vx, a.vy, true);
      if (hitC) {
        if (hitC.kind === 'bird') {
          a.el.remove(); _arrows.splice(i,1);
        } else {
          // hitC.x/y are WORLD coords — convert to screen for embed calculation
          let csx = hitC.x, csy = hitC.y;
          if (_worldToScreenFn) { const s = _worldToScreenFn(hitC.x, hitC.y); csx = s.sx; csy = s.sy; }
          const screenProxy = { kind: hitC.kind, x: csx, y: csy, scale: hitC.scale || 1 };
          const embed = _getArrowEmbedPoint(screenProxy, a.travelAngle || 0);
          _stickArrow(a, embed.x, embed.y, hitC, 'creature');
        }
        continue;
      }
    }
    // Hit buildings (play mode only) — polygon outline collision
    if (_pmActive && _getBuildingPolysFn) {
      const polys = _getBuildingPolysFn();
      let hitBuilding = false;
      const prevX = a._prevX !== undefined ? a._prevX : a.x;
      const prevY = a._prevY !== undefined ? a._prevY : a.y;
      for (const poly of polys) {
        let closest = null;
        for (const seg of poly.segments) {
          const hit = _segIntersect(prevX, prevY, a.x, a.y, seg[0], seg[1], seg[2], seg[3]);
          if (hit && (!closest || hit.t < closest.t)) closest = hit;
        }
        if (closest) {
          const angle = Math.atan2(a.vy, a.vx);
          const pullback = 8;
          _stickArrow(a, closest.x - Math.cos(angle) * pullback, closest.y - Math.sin(angle) * pullback);
          hitBuilding = true;
          break;
        }
      }
      if (hitBuilding) continue;
    }
    // Hit chips + hex chips — stick at border edge (shallow penetration)
    let hitChip = false;
    // Collect all chip rects: infochips + hex chips + link chips + note editors
    const allChipRects = [..._chipFloors];
    document.querySelectorAll('.note-hex-chip, .note-link-chip, .note-profile-chip, .infochip').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) allChipRects.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    });
    for (const chip of allChipRects) {
      if (a.x >= chip.left && a.x <= chip.right && a.y >= chip.top && a.y <= chip.bottom) {
        // Determine entry edge from travel direction (_prevX/_prevY → a.x/a.y).
        // a._prevX/_prevY are set every in-flight tick; the bare prevX/prevY
        // consts only exist inside the play-mode building block above (the
        // notes app leaked a global that masked this).
        const dx = a.x - a._prevX, dy = a.y - a._prevY;
        let stickX = a.x, stickY = a.y;
        if (Math.abs(dx) >= Math.abs(dy)) {
          if (dx > 0) { stickX = chip.left - 4; }
          else        { stickX = chip.right + 4; }
        } else {
          if (dy > 0) { stickY = chip.top - 4; }
          else        { stickY = chip.bottom + 4; }
        }
        _stickArrow(a, stickX, stickY);
        hitChip = true; break;
      }
    }
    if (hitChip) continue;
    // Off screen/expired
    const tooFar = a.x < -100 || a.x > window.innerWidth + 100 || a.y > window.innerHeight + 100 || a.y < -(window.innerHeight * 5);
    if (a.life <= 0 || tooFar) { a.el.remove(); _arrows.splice(i,1); }
  }
}

function _isBowVisible() {
  return !_gun.held && !_bow.holstered;
}

function _syncArmsToBow() {
  if (_gun.held || _bow.holstered) return;
  const isDrawing = _bow.drawing;
  const power = isDrawing ? _bow.chargeT / MAX_BOW_CHARGE : 0;
  const shake = _bow.shaking ? Math.sin(Date.now() * 0.3) * 1.5 : 0;
  const torso = _el('torso');
  const sY = torso ? parseFloat(torso.getAttribute('y1')) : 14;
  // Always follow mouse — _bow.angle updated every mousemove when equipped
  // When flipX is true, SVG is mirrored — negate X component of angle
  let aimAngle = _bow.angle;
  if (flipX) aimAngle = Math.PI - aimAngle;
  const cosA = Math.cos(aimAngle), sinA = Math.sin(aimAngle);
  const bowDist = 10, drawPull = power * 8;
  // Bow hand (left) — holds bow out
  _setLine('upper-arm-left', 18, sY, 18+cosA*bowDist*0.5, sY+4+sinA*bowDist*0.5);
  _setLine('lower-arm-left', 18+cosA*bowDist*0.5, sY+4+sinA*bowDist*0.5, 18+cosA*bowDist+shake, sY+4+sinA*bowDist+shake);
  // Draw hand (right) — pulls string back when drawing, rests near bow when idle
  if (isDrawing) {
    _setLine('upper-arm-right', 18, sY, 18-cosA*4-drawPull*0.5+shake*0.5, sY+4+sinA*2+shake*0.5);
    _setLine('lower-arm-right', 18-cosA*4-drawPull*0.5+shake*0.5, sY+4+sinA*2+shake*0.5, 18-drawPull+shake, sY+6+shake);
  } else {
    // Idle: right hand rests near the bow grip
    _setLine('upper-arm-right', 18, sY, 18+cosA*bowDist*0.3, sY+5+sinA*bowDist*0.3);
    _setLine('lower-arm-right', 18+cosA*bowDist*0.3, sY+5+sinA*bowDist*0.3, 18+cosA*bowDist*0.5, sY+8+sinA*bowDist*0.3);
  }
  // Bow SVG — always visible when equipped
  const bp = _el('bow'), sl = _el('bow-str-l'), sr = _el('bow-str-r');
  if (!bp) return;
  const perpX = -sinA, perpY = cosA, bowLen = 10, bowBend = 4 + power * 3;
  const holdX = 18+cosA*bowDist+shake, holdY = sY+4+sinA*bowDist+shake;
  const ttX = holdX+perpX*bowLen, ttY = holdY+perpY*bowLen;
  const tbX = holdX-perpX*bowLen, tbY = holdY-perpY*bowLen;
  const bowClr = _getAccentColor();
  bp.style.display = ''; bp.setAttribute('d', `M${ttX},${ttY} Q${holdX+cosA*bowBend},${holdY+sinA*bowBend} ${tbX},${tbY}`);
  bp.setAttribute('stroke', bowClr);
  // String: when drawing, pulled back to draw hand; when idle, straight between tips
  const strX = isDrawing ? 18 - drawPull + shake : holdX;
  const strY = isDrawing ? sY + 6 + shake : holdY;
  if (sl) { sl.style.display = ''; sl.setAttribute('x1',ttX); sl.setAttribute('y1',ttY); sl.setAttribute('x2',strX); sl.setAttribute('y2',strY); sl.setAttribute('stroke',bowClr); }
  if (sr) { sr.style.display = ''; sr.setAttribute('x1',tbX); sr.setAttribute('y1',tbY); sr.setAttribute('x2',strX); sr.setAttribute('y2',strY); sr.setAttribute('stroke',bowClr); }
}

function _updateBowChargeBar() {
  if (_gun.held) return;
  // Update both the character's charge bar AND the HUD charge bar
  const wrap = _charEl?.querySelector('.char-charge-bar-wrap');
  const bar = _charEl?.querySelector('.char-charge-bar');
  const hudWrap = document.getElementById('hud-charge-wrap');
  const hudBar = document.getElementById('hud-charge-bar');
  const pct = (_bow.chargeT / MAX_BOW_CHARGE * 100) + '%';
  const r = Math.round(255 * _bow.chargeT / MAX_BOW_CHARGE);
  const g2 = Math.round(255 * (1 - _bow.chargeT / MAX_BOW_CHARGE * 0.5));
  const clr = `rgb(${r},${g2},30)`;
  if (_bow.drawing) {
    if (wrap) wrap.classList.add('visible');
    if (bar) { bar.style.width = pct; bar.style.background = clr; }
    if (hudWrap) hudWrap.classList.add('visible');
    if (hudBar) { hudBar.style.width = pct; hudBar.style.background = clr; }
  } else {
    if (wrap) wrap.classList.remove('visible');
    if (bar) { bar.style.width = '0%'; bar.style.background = ''; }
    if (hudWrap) hudWrap.classList.remove('visible');
    if (hudBar) { hudBar.style.width = '0%'; hudBar.style.background = ''; }
  }
}

function _toggleInventory() {
  // MD#12: route to inventory v2 (#inv2). Legacy #inventory-grid stays
  // in the DOM for safe rollback but is no longer used by this toggle.
  const inv2El = document.getElementById('inv2');
  if (!inv2El) return; // scaffold (MD#9) missing — abort safely.
  const wasOpen = inv2El.classList.contains('is-open');
  if (!wasOpen) {
    // Cosmetics and inv2 both expand up from the hotbar — never both (MD 05).
    if (_cosmeticsOpen) toggleCosmeticsPanel(false);
    // Render fresh chips for current hotbar state, then open.
    if (typeof window._inv2Render === 'function') window._inv2Render();
    inv2El.classList.add('is-open');
    inv2El.setAttribute('aria-hidden', 'false');
    _inv2WireOnce(); // bind delegated handlers (idempotent — see helper below)
    sfx('ui.open');
  } else {
    inv2El.classList.remove('is-open');
    inv2El.setAttribute('aria-hidden', 'true');
    sfx('ui.close');
  }
  // Slot 5 toggle button mirrors the open state (kept from legacy behavior).
  const slot5El = document.querySelector('.item-slot[data-slot="5"]');
  if (slot5El) slot5El.classList.toggle('active', !wasOpen);
}

// MD#12: delegated event wiring for #inv2. Bound once on first open and
// re-used forever — no repeat bind on subsequent opens. Handles chip
// click (equip into the chip's slot column), chevron click (page step),
// and click-outside (close).
let _inv2Wired = false;
function _inv2WireOnce() {
  if (_inv2Wired) return;
  const inv2El = document.getElementById('inv2');
  if (!inv2El) return;

  // Chip click → equip the item into the chip's column slot.
  inv2El.addEventListener('click', e => {
    const chip = e.target.closest('.inv2-chip');
    const chev = e.target.closest('.inv2-chev');
    if (chev) {
      if (chev.classList.contains('inv2-chev-disabled')) return;
      const col = chev.closest('.inv2-col');
      const slotNum = parseInt(col?.dataset.slot, 10);
      const dir = parseInt(chev.dataset.dir, 10);
      if (slotNum && dir && typeof window._inv2PageStep === 'function') {
        window._inv2PageStep(slotNum, dir);
      }
      return;
    }
    if (!chip) return;
    if (chip.classList.contains('inv2-chip-locked')) return;
    const slotNum = parseInt(chip.dataset.slot, 10);
    const itemId = chip.dataset.val;
    if (!slotNum || !itemId) return;
    _inv2EquipToSlot(slotNum, itemId);
  });

  // Click outside #inv2 closes the panel. Slot 5 (toggle) and any
  // .item-slot are excluded so the user can switch slots without
  // closing — matches the legacy feel.
  document.addEventListener('mousedown', e => {
    const el = inv2El;
    if (!el.classList.contains('is-open')) return;
    if (el.contains(e.target)) return;
    // Don't close when clicking the hotbar (number keys + click-to-equip
    // both go through #item-bar — let those operate without dismissing).
    if (e.target.closest('#item-bar')) return;
    _toggleInventory();
  }, true);

  _inv2Wired = true;
}

// MD#12: equip an item into a SPECIFIC slot column (not the active slot).
// Mirrors the legacy click-to-equip in _populateInventoryGrid but parameterized
// by slot, since each chip belongs to its own column.
function _inv2EquipToSlot(slotNum, itemId) {
  sfx('ui.equip');
  const item = INVENTORY_ITEMS.find(it => it.id === itemId);
  // 'none' is the synthetic empty option — clear the slot.
  if (itemId === 'none' || !item) {
    if (_hotbar[slotNum]) _unequipSlot(slotNum);
    _hotbar[slotNum] = null;
    _saveHotbar();
    _renderHotbarSlot(slotNum);
    if (typeof window._inv2RenderColumn === 'function') window._inv2RenderColumn(slotNum);
    return;
  }
  // Live equip ONLY when this column matches the active hotbar slot;
  // otherwise just assign + persist + re-render (same pattern the
  // avatar dropdown's Equip tab uses to swap items into non-active slots).
  if (slotNum === _activeHotbarSlot) {
    if (item.isMountSlot) {
      // Mount items (hoverboard): just assign; toggle on slot-key press.
    } else if (item.id === 'bow') {
      _bow.holstered = false;
      if (_gun.held) _dropGun();
    } else if (item.functional) {
      const pickup = _pickups.find(p => p.type === item.id);
      if (pickup) {
        if (_gun.held) _dropGun();
        pickup.x = P.x; pickup.y = P.y;
        _pickupGun(pickup);
      }
    }
  }
  _hotbar[slotNum] = item.id;
  _saveHotbar();
  _renderHotbarSlot(slotNum);
  if (typeof window._inv2RenderColumn === 'function') window._inv2RenderColumn(slotNum);
  if (window._dexUnlockAch) window._dexUnlockAch('hotbar_equip');
}

function _populateInventoryGrid(inv) {
  inv.innerHTML = '';
  // Header: item name (center) + close button (right)
  const header = document.createElement('div');
  header.id = 'inv-header';
  header.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;padding:0 4px 6px;position:relative;grid-column:1/-1;min-height:20px;';
  const nameEl = document.createElement('span');
  nameEl.id = 'inv-hover-name';
  nameEl.style.cssText = 'font-size:13px;font-weight:600;color:var(--tx);font-family:var(--fn);text-align:center;flex:1;opacity:0;transition:opacity 0.15s;';
  const closeBtn = document.createElement('button');
  closeBtn.style.cssText = 'position:absolute;right:0;top:0;background:none;border:none;color:var(--tx3);cursor:pointer;padding:2px;display:flex;transition:color 0.15s;';
  closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  closeBtn.addEventListener('click', () => _toggleInventory());
  closeBtn.addEventListener('mouseenter', () => closeBtn.style.color = 'var(--tx)');
  closeBtn.addEventListener('mouseleave', () => closeBtn.style.color = 'var(--tx3)');
  header.appendChild(nameEl);
  header.appendChild(closeBtn);
  inv.appendChild(header);
  const _userLvl = window._dexUserLevel?.() || 1;
  INVENTORY_ITEMS.forEach((item, idx) => {
    const slot = document.createElement('div');
    const byFunctional = !item.functional;
    const byLevel = !byFunctional && (item.unlockLevel || 1) > _userLvl;
    const anyLock = byFunctional || byLevel;
    slot.className = 'inv-slot' + (anyLock ? ' inv-slot-locked' : '') + (byLevel ? ' inv-slot-level-locked' : '');
    slot.dataset.itemId = item.id;
    slot.dataset.idx = idx;
    slot.dataset.unlockLevel = item.unlockLevel || 1;
    slot.dataset.tip = byFunctional ? item.label + ' (Coming Soon)'
                    : byLevel      ? item.label + ' (Unlocks at Level ' + item.unlockLevel + ')'
                    :                 item.label;
    // No tilt — icons sit upright in all chip surfaces.
    const iconWrap = document.createElement('div');
    iconWrap.className = 'inv-slot-icon';
    iconWrap.innerHTML = `<svg viewBox="${item.viewBox}" preserveAspectRatio="xMidYMid meet" width="36" height="36" style="display:block;overflow:visible" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none">${item.svg}</svg>`;
    if (anyLock) {
      const lock = document.createElement('div');
      lock.className = 'inv-slot-lock';
      lock.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
      slot.appendChild(lock);
    }
    slot.appendChild(iconWrap);
    if (item.functional && !byLevel) {
      // Click to equip into active hotbar slot
      slot.addEventListener('click', () => {
        if (item.isMountSlot) {
          // Mount items: just assign to slot, toggle via slot key later
        } else if (item.id === 'bow') {
          _bow.holstered = false; if (_gun.held) _dropGun();
        } else {
          const pickup = _pickups.find(p => p.type === item.id);
          if (pickup) { if (_gun.held) _dropGun(); pickup.x = P.x; pickup.y = P.y; _pickupGun(pickup); }
        }
        _hotbar[_activeHotbarSlot] = item.id;
        _saveHotbar();
        _renderHotbarSlot(_activeHotbarSlot);
        _toggleInventory();
        if (window._dexUnlockAch) window._dexUnlockAch('hotbar_equip');
      });
      // Drag from inventory
      slot.draggable = true;
      slot.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', item.id);
        e.dataTransfer.setData('application/x-inv-idx', String(idx));
        slot.classList.add('inv-slot-dragging');
      });
      slot.addEventListener('dragend', () => slot.classList.remove('inv-slot-dragging'));
      // Drop target for reordering within inventory
      slot.addEventListener('dragover', e => { e.preventDefault(); slot.classList.add('item-slot-drag-over'); });
      slot.addEventListener('dragleave', () => slot.classList.remove('item-slot-drag-over'));
      slot.addEventListener('drop', e => {
        e.preventDefault(); slot.classList.remove('item-slot-drag-over');
        const draggedId = e.dataTransfer.getData('text/plain');
        if (!draggedId) return;
        const fromHotbar = e.dataTransfer.getData('application/x-hotbar-slot');
        if (fromHotbar) {
          // Dragged from hotbar onto an inventory tile → true swap.
          // If the inventory item was ALREADY in another hotbar slot, that
          // slot inherits the dragged item so we don't leave a duplicate.
          // Otherwise the dragged item simply becomes unequipped (removed
          // from hotbar) while the inventory item takes its hotbar slot.
          _dragLanded = true;
          const hSlot = parseInt(fromHotbar);
          const displaced = item.id; // inventory item user dropped onto
          const existingKey = Object.keys(_hotbar).find(k => parseInt(k) !== hSlot && _hotbar[k] === displaced);
          if (existingKey) _hotbar[parseInt(existingKey)] = draggedId;
          _hotbar[hSlot] = displaced;
          _saveHotbar();
          _renderAllHotbarSlots();
          _populateInventoryGrid(inv);
          return;
        }
        // Reorder within inventory
        const fromIdx = parseInt(e.dataTransfer.getData('application/x-inv-idx'));
        if (isNaN(fromIdx) || fromIdx === idx) return;
        const fromItem = INVENTORY_ITEMS[fromIdx];
        if (!fromItem || !fromItem.functional) return;
        // Swap positions in array
        INVENTORY_ITEMS[fromIdx] = item;
        INVENTORY_ITEMS[idx] = fromItem;
        _populateInventoryGrid(inv);
      });
    }
    // Hover: show item name in header
    slot.addEventListener('mouseenter', () => {
      const nameEl = document.getElementById('inv-hover-name');
      if (nameEl) { nameEl.textContent = item.label; nameEl.style.opacity = '1'; }
    });
    slot.addEventListener('mouseleave', () => {
      const nameEl = document.getElementById('inv-hover-name');
      if (nameEl) nameEl.style.opacity = '0';
    });
    inv.appendChild(slot);
  });
  // Wire hotbar drop targets (into hotbar slots)
  document.querySelectorAll('.item-slot[data-slot]').forEach(hotbarEl => {
    const slotNum = parseInt(hotbarEl.dataset.slot);
    if (slotNum < 1 || slotNum > 4) return;
    // Remove old listeners by cloning
    const fresh = hotbarEl.cloneNode(true);
    hotbarEl.parentNode.replaceChild(fresh, hotbarEl);
    fresh.draggable = true;
    fresh.addEventListener('dragstart', e => {
      const itemId = _hotbar[slotNum];
      if (!itemId) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/plain', itemId);
      e.dataTransfer.setData('application/x-hotbar-slot', String(slotNum));
      fresh.classList.add('inv-slot-dragging');
      _dragFromSlot = slotNum;
      _dragLanded = false;
    });
    fresh.addEventListener('dragend', () => {
      fresh.classList.remove('inv-slot-dragging');
      if (_dragFromSlot === slotNum && !_dragLanded) {
        // Dropped outside any valid target → unequip
        _hotbar[slotNum] = null;
        _saveHotbar();
        _renderHotbarSlot(slotNum);
        const curInv = document.getElementById('inventory-grid');
        if (curInv && curInv.style.display === 'grid') _populateInventoryGrid(curInv);
      }
      _dragFromSlot = null;
    });
    fresh.addEventListener('dragover', e => { e.preventDefault(); fresh.classList.add('item-slot-drag-over'); });
    fresh.addEventListener('dragleave', () => fresh.classList.remove('item-slot-drag-over'));
    fresh.addEventListener('drop', e => {
      e.preventDefault(); fresh.classList.remove('item-slot-drag-over');
      _dragLanded = true;
      const draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId) return;
      // From backpack slot — swap
      if (draggedId.startsWith('bp-slot-')) {
        const fromSlot = parseInt(draggedId.replace('bp-slot-', ''));
        if (fromSlot !== slotNum) {
          const temp = _hotbar[slotNum];
          _hotbar[slotNum] = _hotbar[fromSlot];
          _hotbar[fromSlot] = temp;
          _saveHotbar();
          _renderAllHotbarSlots();
          _renderBackpackSlots();
        }
        return;
      }
      const fromHotbar = e.dataTransfer.getData('application/x-hotbar-slot');
      if (fromHotbar) {
        // Hotbar-to-hotbar swap
        const fromSlot = parseInt(fromHotbar);
        if (fromSlot === slotNum) return;
        const temp = _hotbar[slotNum];
        _hotbar[slotNum] = _hotbar[fromSlot];
        _hotbar[fromSlot] = temp;
      } else {
        // Inventory-to-hotbar — remove from any other slot first (no duplicates)
        for (const k of [1,2,3,4]) {
          if (_hotbar[k] === draggedId) _hotbar[k] = null;
        }
        _hotbar[slotNum] = draggedId;
      }
      _saveHotbar();
      _renderAllHotbarSlots();
      const curInv = document.getElementById('inventory-grid');
      if (curInv && curInv.style.display === 'grid') _populateInventoryGrid(curInv);
    });
  });
}
window._dexPopulateInv = _populateInventoryGrid;

function _renderHotbarSlot(slotNum) {
  const slotEl = document.querySelector(`.item-slot[data-slot="${slotNum}"]`);
  if (!slotEl) return;
  const iconEl = slotEl.querySelector('.item-slot-icon');
  if (!iconEl) return;
  const itemId = _hotbar[slotNum];
  const item = itemId ? INVENTORY_ITEMS.find(it => it.id === itemId) : null;
  slotEl.classList.remove('has-bow');
  if (item) {
    // MD#ICON-OVERHAUL: chipVB tight viewBox so icon fills the square cell.
    const vb = item.chipVB || item.viewBox;
    iconEl.innerHTML = `<svg viewBox="${vb}" preserveAspectRatio="xMidYMid meet" width="32" height="32" style="display:block;overflow:visible" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none">${item.svg}</svg>`;
    slotEl.dataset.tip = `${item.label} (${slotNum})`;
  } else {
    iconEl.innerHTML = '';
    slotEl.dataset.tip = `Slot ${slotNum}`;
  }
}
function _renderAllHotbarSlots() { [1,2,3,4].forEach(_renderHotbarSlot); }

// ── Hotbar visual state (MD 10, issues 2+3) ──
// 'active' and 'holstered' used to be set at interaction time and drifted
// from reality (holster kept the highlight; the jetpack slot highlighted on
// selection, not on mount). This re-derives every slot's classes from the
// ACTUAL equipment state and runs once per frame from _frame(), so no code
// path — holster, mount, dismount, drop, death, unequip-all — can leave the
// UI lying:
//   active    = this slot's item is out in the world right now (gun in
//               hand, bow drawn, mount actually on)
//   holstered = the slot has an item but it's put away
let _hotbarSlotEls = null;
function _syncHotbarVisuals() {
  if (!_hotbarSlotEls) {
    _hotbarSlotEls = [1, 2, 3, 4].map(s => document.querySelector(`.item-slot[data-slot="${s}"]`));
    if (_hotbarSlotEls.some(el => !el)) { _hotbarSlotEls = null; return; }
  }
  for (let s = 1; s <= 4; s++) {
    const el = _hotbarSlotEls[s - 1];
    const itemId = _hotbar[s];
    let isOn = false;
    if (itemId === 'hoverboard') isOn = _hoverboard.active || !!_hoverboard.transition;
    else if (itemId === 'jetpack') isOn = _jetpack.active;
    else if (itemId === 'bow') isOn = s === _activeHotbarSlot && !_bow.holstered && !_gun.held;
    else if (itemId) isOn = _gun.held && _gun.type === itemId;
    el.classList.toggle('active', isOn);
    el.classList.toggle('holstered', !!itemId && !isOn);
  }
}

function _unequipSlot(s) {
  const wasActive = (_activeHotbarSlot === s);
  const wasItemId = _hotbar[s];
  _hotbar[s] = null;
  _saveHotbar();
  _renderHotbarSlot(s);
  _renderBackpackSlots();
  if (wasActive && wasItemId) {
    if (_gun.held && _gun.type === wasItemId) _dropGun();
    if (wasItemId === 'bow') { _bow.holstered = true; _bow.drawing = false; }
    if (wasItemId === 'hoverboard' && _hoverboard.active) {
      _hoverboard.active = false; _hoverboard.transition = '';
      if (_hoverboard.el) _hoverboard.el.style.display = 'none';
    }
  }
}

function _renderBackpackSlots() {
  const container = document.getElementById('acct-backpack-slots');
  if (!container) return;
  container.innerHTML = '';
  for (let s = 1; s <= 4; s++) {
    const slot = document.createElement('div');
    slot.className = 'acct-bp-slot';
    slot.dataset.slot = s;
    const itemId = _hotbar[s];
    const item = itemId ? INVENTORY_ITEMS.find(it => it.id === itemId) : null;

    const num = document.createElement('span');
    num.className = 'bp-slot-num';
    num.textContent = s;
    slot.appendChild(num);

    if (item) {
      slot.classList.add('has-item');
      const iconWrap = document.createElement('span');
      iconWrap.className = 'bp-slot-icon';
      // MD#ICON-OVERHAUL: chipVB tight viewBox for snug fit in the square cell.
      const vb = item.chipVB || item.viewBox || '0 0 24 24';
      iconWrap.innerHTML = `<svg viewBox="${vb}" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${item.svg}</svg>`;
      slot.appendChild(iconWrap);

      // Drag out to unequip
      slot.draggable = true;
      slot.addEventListener('dragstart', e => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'bp-slot-' + s);
        slot.classList.add('dragging');
      });
      slot.addEventListener('dragend', e => {
        slot.classList.remove('dragging');
        if (e.dataTransfer.dropEffect === 'none') {
          _unequipSlot(s);
        }
      });
    }

    // Drop target — accept from other backpack slots, equip row, or inventory grid
    slot.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      slot.classList.add('drag-over');
    });
    slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
    slot.addEventListener('drop', e => {
      e.preventDefault();
      slot.classList.remove('drag-over');
      const data = e.dataTransfer.getData('text/plain');

      // From another backpack slot — swap
      if (data.startsWith('bp-slot-')) {
        const fromSlot = parseInt(data.replace('bp-slot-', ''));
        if (fromSlot !== s) {
          const temp = _hotbar[s];
          _hotbar[s] = _hotbar[fromSlot];
          _hotbar[fromSlot] = temp;
          _saveHotbar();
          _renderAllHotbarSlots();
          _renderBackpackSlots();
        }
        return;
      }

      // From inventory grid (data is INVENTORY_ITEMS index)
      const idx = parseInt(data);
      if (!isNaN(idx) && INVENTORY_ITEMS[idx]) {
        const droppedItem = INVENTORY_ITEMS[idx];
        if (droppedItem.functional) {
          _hotbar[s] = droppedItem.id;
          _saveHotbar();
          _renderHotbarSlot(s);
          _renderBackpackSlots();
        }
      }
    });

    // Click to unequip
    slot.addEventListener('click', () => {
      if (_hotbar[s]) _unequipSlot(s);
    });

    container.appendChild(slot);
  }
}
window._dexRenderBackpackSlots = _renderBackpackSlots;

// ═══════════════════════════════════
//  IMPACT EFFECTS
// ═══════════════════════════════════

function _triggerArrowDeath(arrow) {
  if (_playerDead) return;
  sfx('player.death');
  _playerDead = true;
  _deathRespawnTimer = DEATH_DISPLAY_FRAMES;
  P.vx = 0; P.vy = 0; P.grounded = true;
  currentState = 'splat'; P.stunSeverity = 3;
  // Drop equipment
  if (_gun.held) _dropGun();
  _deactivateHoverboard();
  _bow.holstered = true; _bow.drawing = false; _bow.chargeT = 0; _bow.shaking = false;
  if (arrow.el) arrow.el.remove();
  // Stuck arrow in head
  const ns = 'http://www.w3.org/2000/svg';
  const arrowEl = document.createElementNS(ns, 'svg');
  arrowEl.setAttribute('width', '4'); arrowEl.setAttribute('height', '22');
  arrowEl.setAttribute('viewBox', '0 0 4 22');
  arrowEl.style.cssText = 'position:absolute;pointer-events:none;left:50%;top:-18px;transform:translateX(-50%);overflow:visible;';
  const shaft = document.createElementNS(ns, 'line');
  shaft.setAttribute('x1','2');shaft.setAttribute('y1','22');shaft.setAttribute('x2','2');shaft.setAttribute('y2','4');
  shaft.setAttribute('stroke','var(--clr-adj,#7B8A9C)');shaft.setAttribute('stroke-width','1.5');shaft.setAttribute('stroke-linecap','round');
  const head = document.createElementNS(ns, 'polygon');
  head.setAttribute('points','2,0 0,5 4,5');head.setAttribute('fill','var(--clr-adj,#7B8A9C)');
  arrowEl.appendChild(shaft); arrowEl.appendChild(head);
  _charEl.appendChild(arrowEl);
  _deathArrowEl = arrowEl;
  _spawnBloodPuddle(P.x, P.y);
}

function spawnImpactRing(x, y, sev) {
  const ring = document.createElement('div');
  ring.className = `impact-ring severity-${sev}`;
  ring.style.cssText = `position:fixed;left:${x}px;top:${y}px;transform:translate(-50%,-50%);pointer-events:none;z-index:149`;
  document.body.appendChild(ring);
  setTimeout(() => ring.remove(), 600);
}

// ═══════════════════════════════════
//  STUN / LANDING
// ═══════════════════════════════════

function triggerStun(sev) {
  P.stunned = true;
  P.stunSeverity = sev;
  P.stunTimer = sev === 1 ? 60 : sev === 2 ? 120 : 240; // ~1s, ~2s, ~4s
  currentState = 'splat';
  if (_dragDropStun) { _spawnCollapseEmoji(); _dragDropStun = false; }
  // Drop carried animal on collapse — stun it too
  if (_carriedCreature) {
    const dropped = _carriedCreature;
    _dropCarriedCreature();
    if (dropped && !dropped._pmCreature) {
      dropped._stunTimer = 80; dropped._stunTotal = 80;
      if (dropped.el) dropped.el.style.zIndex = '11';
    }
  }
  // Dismount hoverboard on collapse
  if (_hoverboard.active) {
    _hoverboard.active = false;
    _hoverboard.transition = '';
    if (_hoverboard.el) _hoverboard.el.style.display = 'none';
  }
}

function triggerLanding(impactVY) {
  P.fallTimer = 0;

  // Forced stun from archive/outliner events only
  if (_forcedStunSeverity) {
    const sev = _forcedStunSeverity;
    _forcedStunSeverity = null;
    landImpact = impactVY;
    sfx('land', { power: Math.min(impactVY / 5, 1) });
    window._dexLandFX?.(Math.min(impactVY / 5, 1), false);
    window._dexPlatFX?.('land', P.x, P.y, Math.min(impactVY / 5, 1));
    triggerStun(sev);
    spawnImpactRing(P.x, P.y, sev);
    const bf = sev === 1 ? 0.2 : sev === 2 ? 0.1 : 0.05;
    P.vy = -impactVY * bf; P.grounded = false;
    return;
  }

  // Hoverboard: bounce landing with compressed pose
  if (_hoverboard.active) {
    P.vy = 0;
    landImpact = Math.min(impactVY / 5, 1) * 9;
    sfx('land.board', { power: landImpact / 9 });
    window._dexLandFX?.(landImpact / 9, true);
    window._dexPlatFX?.('land', P.x, P.y, landImpact / 9);
    absorbDur = Math.round(10 + Math.min(impactVY, 6) * 2); // 10-22 — board stays springy
    currentState = 'land-absorb';
    landAbsorbT = 0;
    return;
  }

  // Normal landing — always absorb, never stun
  // MD 03: steeper impact scaling — a light hop recovers fast (12 frames,
  // was 18) while a hard fall keeps nearly its old weight (40, was 42), so
  // the timing difference reads, not just the pose depth.
  landImpact = Math.min(impactVY / 5, 1) * 9;
  // landImpact is already a 0-9 severity — a hard fall reads heavier than a hop.
  sfx('land', { power: landImpact / 9 });
  window._dexLandFX?.(landImpact / 9, false);
  window._dexPlatFX?.('land', P.x, P.y, landImpact / 9);
  absorbDur = Math.round(12 + Math.min(impactVY, 8) * 3.5); // 12-40 frames
  currentState = 'land-absorb';
  landAbsorbT = 0;
}

function startGetUp() {
  currentState = 'get-up';
  getUpStage = 1;
  getUpT = 0;
}

function tickStun() {
  if (!P.stunned) return;
  P.stunTimer -= _dt;
  if (P.stunTimer <= 0) {
    P.stunned = false;
    P.stunSeverity = 0;
    startGetUp();
  }
}

// ═══════════════════════════════════
//  CHARGE BAR
// ═══════════════════════════════════

function _updateChargeBar() {
  const wrap = _charEl?.querySelector('.char-charge-bar-wrap');
  const bar = _charEl?.querySelector('.char-charge-bar');
  if (!wrap || !bar) return;
  // Only show bar when actually charging (past CHARGE_DELAY)
  const mc = (_isPlayModeFn && _isPlayModeFn()) ? PM_MAX_CHARGE : MAX_CHARGE;
  if (isCharging && chargeFrames > 0) { wrap.classList.add('visible'); bar.style.width = `${(chargeFrames/mc)*100}%`; }
  else { wrap.classList.remove('visible'); bar.style.width = '0%'; }
}

// ═══════════════════════════════════
//  INPUT
// ═══════════════════════════════════

// Normalize movement keys to lowercase — Shift changes 'a' to 'A' on keyup
function _normalizeKey(key) {
  if ('ASDWCE'.includes(key) && key.length === 1) return key.toLowerCase();
  return key;
}

function _onKeyDown(e) {
  if (e.key === 'Escape') {
    // Cosmetics panel takes Escape first — it's the topmost thing on screen.
    if (_cosmeticsOpen) {
      e.preventDefault();
      e.stopPropagation();
      toggleCosmeticsPanel(false);
      return;
    }
    // Close inventory if open
    const inv = document.getElementById('inventory-grid');
    if (inv && inv.style.display === 'grid') {
      inv.style.display = 'none';
      return;
    }
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    window.getSelection()?.removeAllRanges();
    return;
  }
  if (document.activeElement?.matches('input,textarea,[contenteditable="true"],[contenteditable=""]')) return;
  const nk = _normalizeKey(e.key);
  _keys[nk] = true;
  if (nk !== e.key) _keys[e.key] = true; // set both cases
  if (e.key === ' ') {
    e.preventDefault();
    if (!spaceHeld) {
      spaceHeld = true;
      _spaceDownFrame = 0;
    }
  }
  // Block browser shortcuts in play mode (Ctrl+D bookmark, Ctrl+B bar)
  if (_isPlayModeFn && _isPlayModeFn()) {
    if (e.ctrlKey && (nk === 'd' || nk === 'b')) e.preventDefault();
  }
  // W/ArrowUp = jump (note-taking mode only, not play mode)
  if ((nk === 'w' || nk === 'ArrowUp') && !(_isPlayModeFn && _isPlayModeFn())) {
    if (!_wHeld) {
      _wHeld = true;
      _wDownFrame = 0;
    }
  }
  // S/ArrowDown = crouch + drop-through (sessions mode only)
  if ((nk === 's' || nk === 'ArrowDown') && !(_isPlayModeFn && _isPlayModeFn())) {
    if (P.grounded && !_hoverboard.active && (P.floorType === 'chip' || P.floorType === 'archive')) {
      _crouching = true;
      _dropThroughPending = true;
      _dropThroughDelay = 0;
    } else if (P.grounded) {
      _crouching = true;
      if (_hoverboard.active) {
        _hoverboard.active = false;
        _hoverboard.transition = '';
        if (_hoverboard.el) _hoverboard.el.style.display = 'none';
      }
    }
  }
  // C = toggle crouch (both sessions and play mode, no drop-through)
  if (nk === 'c') {
    e.preventDefault();
    const inPM = _isPlayModeFn && _isPlayModeFn();
    if (_crouching) {
      _crouching = false;
      _crouchIntensity = 0;
    } else if (P.grounded || inPM) {
      _crouching = true;
      // Dismount hoverboard when crouching
      if (_hoverboard.active) {
        _hoverboard.active = false;
        _hoverboard.transition = '';
        if (_hoverboard.el) _hoverboard.el.style.display = 'none';
      }
    }
    return;
  }
  if (nk === 'e') {
    // Carry: drop if already carrying
    if (_carriedCreature) { _dropCarriedCreature(); return; }
    // Carry: pick up nearby animal (don't let errors block E key)
    try {
      const nearbyAnimal = _findNearbyCarryable();
      if (nearbyAnimal) { _pickUpCreature(nearbyAnimal); return; }
    } catch(err) { console.warn('carry pickup error:', err); }
    if (_isPlayModeFn && _isPlayModeFn()) {
      import('./playmode.js').then(m => { if (m.tryHomeInteract) m.tryHomeInteract(true); });
    }
    // Don't drop gun when interacting with tank/home
    if (_gun.held && !(_isInTankFn && _isInTankFn())) _dropGun();
  }
  // Inventory toggle (Tab, I, B, 5) — play mode only
  if (_isPlayModeFn && _isPlayModeFn()) {
    if (e.key === 'Tab' || nk.toLowerCase() === 'i' || nk.toLowerCase() === 'b' || e.code === 'Digit5') {
      e.preventDefault();
      _toggleInventory();
    }
  }
  // G — cosmetics customizer (gear). The brief called for C, but C is already
  // crouch (see above) and crouch is a movement feature we're not giving up.
  // G was free and matches the gear button in the HUD. MD 10: 6 toggles it
  // too, matching the slot-6 badge (the way 5 toggles the inventory).
  if ((nk.toLowerCase() === 'g' || e.code === 'Digit6') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const _chatBlock = _isChatOpenFn && _isChatOpenFn();
    if (!_chatBlock && _isPlayModeFn && _isPlayModeFn()) {
      e.preventDefault();
      toggleCosmeticsPanel();
    }
  }
  // H key — holster/unholster current item (both sessions + play mode)
  if (nk.toLowerCase() === 'h') {
    const _chatBlock = _isChatOpenFn && _isChatOpenFn();
    if (!_chatBlock) {
      if (_gun.held) {
        _dropGun();
      } else if (!_bow.holstered) {
        _bow.holstered = true; _bow.drawing = false; _bow.chargeT = 0; _bow.shaking = false;
      } else {
        _bow.holstered = false;
      }
      _syncHotbarVisuals();   // classes re-derive from state (MD 10)
    }
  }
  // Item bar slot keys (playroom)
  // Use e.code for slot keys so Shift (sprint) doesn't block weapon switching
  const _slotCode = e.code;
  const _slotMatch = _slotCode === 'Digit1' ? '1' : _slotCode === 'Digit2' ? '2' : _slotCode === 'Digit3' ? '3' : _slotCode === 'Digit4' ? '4' : null;
  if (_slotMatch) {
    // MD 10 (issues 2+3): this handler only mutates STATE — the 'active' /
    // 'holstered' classes are re-derived from that state by
    // _syncHotbarVisuals() every frame, so the highlight always tells the
    // truth (mounts glow while mounted, holstered weapons don't glow).
    const slotNum = parseInt(_slotMatch);
    const itemId = _hotbar[slotNum];
    const item = itemId ? INVENTORY_ITEMS.find(it => it.id === itemId) : null;
    sfx('ui.slot');
    if (!item || !item.functional) {
      // Non-functional or empty — only clear weapon if not hoverboard
      if (!(item && item.isMountSlot)) { if (_gun.held) _dropGun(); _bow.holstered = true; }
      _activeHotbarSlot = slotNum;
      _syncHotbarVisuals();
      return;
    }
    if (itemId === 'hoverboard' || itemId === 'jetpack') {
      // Mounts: toggle on/off, don't change active weapon (MD 07: jetpack
      // follows the hoverboard's slot behaviour exactly).
      if (itemId === 'hoverboard') _toggleHoverboard();
      else _toggleJetpack();
      _syncHotbarVisuals();
      return; // don't change _activeHotbarSlot — keep current weapon selected
    }
    if (itemId === 'bow') {
      if (slotNum === _activeHotbarSlot) { _bow.holstered = !_bow.holstered; if (_bow.holstered && _bow.drawing) { _bow.drawing = false; _bow.chargeT = 0; _bow.shaking = false; } }
      else { _bow.holstered = false; if (_gun.held) _dropGun(); }
    } else {
      _bow.holstered = true;
      if (_gun.held && _gun.type === itemId && slotNum === _activeHotbarSlot) {
        // Same slot pressed again — holster (drop) the gun
        _dropGun();
      } else if (!(_gun.held && _gun.type === itemId)) {
        // Different slot or no gun — equip this weapon
        if (_gun.held) _dropGun();
        const pickup = _pickups.find(p => p.type === itemId);
        if (pickup) { pickup.x = P.x; pickup.y = P.y; _pickupGun(pickup); }
      }
    }
    _activeHotbarSlot = slotNum;
    _syncHotbarVisuals();
  }
}
function _onKeyUp(e) {
  const nk = _normalizeKey(e.key);
  _keys[nk] = false;
  _keys[e.key] = false;
  // Clear both cases for movement keys
  if ('asdwASDW'.includes(e.key)) {
    _keys[e.key.toLowerCase()] = false;
    _keys[e.key.toUpperCase()] = false;
  }
  if (e.key === ' ') {
    if (spaceHeld) {
      spaceHeld = false;
      _onSpaceRelease();
    }
  }
  // W/ArrowUp release = jump (note-taking mode only)
  if ((nk === 'w' || nk === 'ArrowUp') && !(_isPlayModeFn && _isPlayModeFn())) {
    if (_wHeld) {
      _wHeld = false;
      _onWRelease();
    }
  }
  // S/ArrowDown release = stop crouching + cancel pending drop-through
  if ((nk === 's' || nk === 'ArrowDown') && !(_isPlayModeFn && _isPlayModeFn())) {
    _crouching = false;
    _dropThroughPending = false;
    _dropThroughDelay = 0;
  }
  // E release = stop home hold
  if (nk === 'e' && _isPlayModeFn && _isPlayModeFn()) {
    import('./playmode.js').then(m => { if (m.tryHomeInteract) m.tryHomeInteract(false); });
  }
}

let _spaceDownFrame = 0;
let _wHeld = false, _wDownFrame = 0;

// ── Jump assist state (MD 03) ──
let _coyoteTimer = 0;        // > 0 while a walked-off-a-ledge jump is still honored
let _jumpBufferTimer = 0;    // > 0 while an airborne tap waits for touchdown
let _airJumpUsed = false;    // the single mid-air jump, spent until touchdown
let _jumpedThisAir = false;  // airborne because of a jump — coyote must not re-arm
let _wasGroundedJA = true;   // previous frame's grounded, for edge detection

// Runs once per frame in both modes (before the mode branches). Detects
// ground↔air transitions, ticks the grace windows, and fires a buffered
// tap on touchdown. A *held* jump key deliberately does not consume the
// buffer — the existing spaceHeld && grounded charge logic picks it up, so
// holding through a landing begins a charge instead of wasting a hop.
function _jumpAssistTick() {
  if (P.grounded) {
    if (!_wasGroundedJA) {
      // Touchdown: air jump re-arms, coyote bookkeeping resets.
      _airJumpUsed = false;
      _jumpedThisAir = false;
      const jumpable = !(P.stunned || currentState === 'splat' || currentState === 'get-up' || _drag.active);
      if (_jumpBufferTimer > 0 && !spaceHeld && !_wHeld && jumpable) {
        _jumpBufferTimer = 0;
        _doTapJump();
      }
    }
    _coyoteTimer = COYOTE_FRAMES;
  } else if (_coyoteTimer > 0) {
    _coyoteTimer -= _dt;
  }
  if (_jumpBufferTimer > 0) _jumpBufferTimer -= _dt;
  _wasGroundedJA = P.grounded;
}

let _crouching = false;
let _crouchIntensity = 0;
let _dropThroughUntil = 0; // timestamp — ignore current platform until this time
let _dropThroughPending = false;
let _dropThroughDelay = 0;

function _onSpaceRelease() { _onJumpRelease(); }

function _onWRelease() { _onJumpRelease(); }

// Shared release path for Space and W. Grounded releases behave exactly as
// before (charged launch or tap hop). Airborne releases, in priority order:
// coyote (a jump the player *meant* to make from the ledge — never granted
// after an actual jump), then the single mid-air jump, then the touchdown
// buffer. Airborne paths clear any stale charge so it can't fire later.
function _onJumpRelease() {
  if (P.stunned || currentState === 'splat' || currentState === 'get-up') return;
  if (_drag.active) return;
  // Jetpack throttle owns Space while the pack is worn — releasing the
  // throttle is not a jump, and none of the assist windows apply. MD 13:
  // this used to exempt play mode, where the release fell through to
  // _doTapJump — the "lands, then hops into the air again" glitch after
  // every flight.
  if (_jetpack.active) return;

  if (!P.grounded) {
    if (_coyoteTimer > 0 && !_jumpedThisAir) {
      _coyoteTimer = 0;
      _launchFromInput();
      return;
    }
    if (!_airJumpUsed) {
      _airJumpUsed = true;
      _jumpedThisAir = true;
      isCharging = false;
      chargeFrames = 0;
      _doAirJump();
      return;
    }
    isCharging = false;
    chargeFrames = 0;
    _jumpBufferTimer = JUMP_BUFFER_FRAMES;
    return;
  }

  _launchFromInput();
}

// The original grounded-release body: charged launch if a charge is armed,
// tap hop otherwise. Also the coyote path — forceAirborne lets the tap
// fire while technically airborne.
function _launchFromInput() {
  if (isCharging) {
    isCharging = false;
    const inPM = _isPlayModeFn && _isPlayModeFn();
    const mc = inPM ? PM_MAX_CHARGE : MAX_CHARGE;
    crouchDur = inPM ? 5 : 6;
    crouchFrame = 0;
    const power = Math.min(chargeFrames, mc) / mc;
    _jumpVYTarget = inPM ? -5.0 - power * 3.5 : -5.0 - power * 4.0;
    currentState = 'crouch-release';
    chargeFrames = 0;
    lastActivity = Date.now();
  } else {
    _doTapJump(true);
  }
}

function _doTapJump(forceAirborne) {
  if (!P.grounded && !forceAirborne) return;
  const inPM = _isPlayModePhysicsFn && _isPlayModePhysicsFn();
  _jumpVYTarget = inPM ? -5.0 : TAP_JUMP_VY;
  crouchDur = inPM ? 6 : 4;
  crouchFrame = 0;
  currentState = 'crouch-release';
  lastActivity = Date.now(); _trackAction();
}

// The mid-air jump. Immediate — there is no ground to crouch against, so it
// skips the crouch-release wind-up and writes velocity directly. Weaker
// than a ground hop (AIR_JUMP_MULT); the poses read vy and follow.
function _doAirJump() {
  const inPM = _isPlayModePhysicsFn && _isPlayModePhysicsFn();
  const vy = (inPM ? -5.0 : TAP_JUMP_VY) * AIR_JUMP_MULT;
  if (inPM) {
    // Play mode's jump is a visual offset — boost it back upward.
    P._jumpVY = vy;
    P._jumpVisualY = P._jumpVisualY || 0;
  } else {
    P.vy = vy;
    P.fallTimer = 0;
  }
  currentState = 'jump-air';
  window._dexJumpFX?.(0.35, P._jumpVisualY || 0);
  window._dexPlatFX?.('jump', P.x, P.y, 0.35);
  lastActivity = Date.now(); _trackAction();
}

function _executeLaunch() {
  const power = Math.min(Math.abs(_jumpVYTarget), 9) / 9;
  // MD 06b: jump audio removed by request — the visual puff stays.
  window._dexJumpFX?.(power, 0);
  window._dexPlatFX?.('jump', P.x, P.y, power);
  // A deliberate jump never earns coyote grace (that would be a free extra
  // jump); the mid-air jump stays available.
  _jumpedThisAir = true;
  _coyoteTimer = 0;
  const inPM = _isPlayModePhysicsFn && _isPlayModePhysicsFn();
  if (inPM) {
    // Play mode: visual-only jump
    P._jumpVY = _jumpVYTarget;
    P._jumpVisualY = 0;
  } else {
    P.vy = _jumpVYTarget;
  }
  P.grounded = false;
  P.fallTimer = 0;
  currentState = 'jump-air';
  chargeFrames = 0;
  _crouching = false; _crouchIntensity = 0; // cancel crouch on jump
}

// Sidebar-animation reactions (archive collapse/expand launches, outliner
// knockback, session-grid knockback) lived here — all notes-app chrome.

// ═══════════════════════════════════
//  MAIN LOOP
// ═══════════════════════════════════

let _frameCount = 0;
function _frame() {
  _rafId = requestAnimationFrame(_frame);
  _frameCount++;
  // Hotbar visuals re-derive from real equipment state every frame — the
  // classes cannot drift no matter which code path changed the state.
  _syncHotbarVisuals();

  // ── Delta-time computation ──
  const now = performance.now();
  if (_lastFrameTime === 0) _lastFrameTime = now - REFERENCE_DT;
  _dt = (now - _lastFrameTime) / REFERENCE_DT;
  _dt = Math.min(_dt, 3); // clamp to prevent physics explosion if tab was hidden
  _lastFrameTime = now;
  // Hit-stop: countdown on raw dt, then scale this frame's dt for everyone.
  if (_hitStopLeft > 0) {
    _hitStopLeft -= _dt;
    _dt *= _hitStopScale;
    if (_hitStopLeft <= 0) { _hitStopLeft = 0; _hitStopScale = 1; }
  }

  // ── Avatar disabled in sessions mode — skip everything, clean up game assets ──
  const _inPM = _isPlayModeFn && _isPlayModeFn();
  if (!_inPM && window._dexAvatarEnabled === false) {
    if (_overlay) _overlay.style.display = 'none';
    if (_shadowEl) _shadowEl.style.display = 'none';
    // Deactivate hoverboard fully
    if (_hoverboard.active) { _hoverboard.active = false; _hoverboard.transition = ''; }
    if (_hoverboard.el) _hoverboard.el.style.display = 'none';
    // Remove all session mode creatures and arrows
    for (const c of _creatures) { if (c.el) c.el.remove(); }
    _creatures.length = 0;
    for (const a of _arrows) { if (a.el) a.el.remove(); }
    _arrows.length = 0;
    for (const p of _projectiles) { if (p.el) p.el.remove(); }
    _projectiles.length = 0;
    _activityScore = 0; _lastDecayTick = 0; // reset so creatures don't respawn immediately
    document.querySelectorAll('.dex-blood, .impact-ring').forEach(el => el.remove());
    return;
  }
  // Ensure character visible (recover from any prior hide)
  if (_overlay && _overlay.style.display === 'none') _overlay.style.display = '';
  if (_shadowEl && _shadowEl.style.display === 'none') _shadowEl.style.display = '';

  // ── Death respawn tick ──
  if (_playerDead) {
    _deathRespawnTimer -= _dt;
    if (_deathRespawnTimer <= 0) {
      const inPM = _isPlayModeFn && _isPlayModeFn();
      if (inPM) {
        // In play mode: let playmode.js death screen handle respawn
        // Keep _playerDead true — _dexResetCharDeath will clear it
        _deathRespawnTimer = 99999; // prevent re-triggering each frame
        if (window._dexShowDeathScreen) window._dexShowDeathScreen();
      } else {
        _playerDead = false;
        if (_deathArrowEl) { _deathArrowEl.remove(); _deathArrowEl = null; }
        P.x = 40; P.y = -80; P.vy = 2; P.grounded = false;
        currentState = 'idle'; P.stunned = false; P.vx = 0;
        // Restore bow after death
        _bow.holstered = true; _bow.drawing = false; _bow.chargeT = 0; _bow.shaking = false;
        const _rbp = _el('bow'), _rsl = _el('bow-str-l'), _rsr = _el('bow-str-r');
        if (_rbp) _rbp.style.display = '';
        if (_rsl) _rsl.style.display = '';
        if (_rsr) _rsr.style.display = '';
      }
    }
    poseSplat(P.stunSeverity);
    _syncCosmeticsToHead();
    _syncSkirt();
    // Hide bow during death (gun already dropped in _triggerArrowDeath)
    const bp = _el('bow'), sl = _el('bow-str-l'), sr = _el('bow-str-r');
    if (bp) bp.style.display = 'none';
    if (sl) sl.style.display = 'none';
    if (sr) sr.style.display = 'none';
    // Position death arrow at head location (fallen on ground)
    if (_deathArrowEl) {
      const head = _el('head');
      if (head) {
        const hx = parseFloat(head.getAttribute('cx'));
        const hy = parseFloat(head.getAttribute('cy'));
        _deathArrowEl.style.left = hx + 'px';
        _deathArrowEl.style.top = (hy - 20) + 'px';
        _deathArrowEl.style.transform = 'translateX(-50%)';
      }
    }
    if (_charEl) { _charEl.style.left = P.x + 'px'; _charEl.style.top = (P.y - CHAR_H) + 'px'; }
    _tickArrows(); // keep arrows moving while dead
    return;
  }

  // Chip-scroll platform riding lived here — the character rode infochips as
  // the note body scrolled, got crushed against the header, and was caught or
  // bonked by chips moving past. All of it was notes-app geometry.

  // ── Stale key check: if window lost focus, keys might be stuck ──
  // The blur handler clears all keys; this is a safety net for edge cases
  if (!document.hasFocus()) {
    for (const k of _MOVE_KEYS) _keys[k] = false;
    if (spaceHeld) { spaceHeld = false; }
  }

  // ── Input ──
  // Block all movement input when play mode chat is open or player is stunned/dead
  const _playerStunned = _isPlayerStunnedFn && _isPlayerStunnedFn();
  const _chatBlocked = (_isChatOpenFn && _isChatOpenFn()) || _playerStunned;
  const wL = _chatBlocked ? false : (_keys['ArrowLeft'] || _keys['a']);
  const wR = _chatBlocked ? false : (_keys['ArrowRight'] || _keys['d']);
  const wU = _chatBlocked ? false : (_keys['ArrowUp'] || _keys['w']);
  const wD = _chatBlocked ? false : (_keys['ArrowDown'] || _keys['s']);
  const wantsWalk = wL || wR;
  const wantsAnyMove = wL || wR || wU || wD;

  // ── Tank key forwarding ──
  const _inTankNow = _isInTankFn && _isInTankFn();
  if (_inTankNow) {
    window._dexTankKeys = {
      w: !_chatBlocked && (_keys['ArrowUp'] || _keys['w']),
      s: !_chatBlocked && (_keys['ArrowDown'] || _keys['s']),
      a: !_chatBlocked && (_keys['ArrowLeft'] || _keys['a']),
      d: !_chatBlocked && (_keys['ArrowRight'] || _keys['d']),
      shift: !_chatBlocked && _keys['Shift'],
    };
    if (window._dexUpdateTankMouse) window._dexUpdateTankMouse(_lastMouseX, _lastMouseY);
  }

  // ── PLAY MODE: top-down 8-directional movement ──
  const _inPlayMode = _isPlayModeFn && _isPlayModeFn();
  if (!_inPlayMode) _playZoom = 1;
  // Entering the world tears the platformer down (its own tick only runs
  // in notes mode, so it can't see the transition itself).
  if (_inPlayMode && window._dexPlatActive && window._dexPlatDeactivate) window._dexPlatDeactivate();
  // Jump-assist bookkeeping (coyote / buffer / air-jump reset) — both modes,
  // frozen while input is paused (pause menu, hub) or the player is dead.
  if (!_inputPaused && !_playerDead) _jumpAssistTick();
  if (_inPlayMode) {
    // Input paused (community hub open) — freeze player, keep world ticking
    if (_inputPaused) {
      _syncCosmeticsToHead();
      _syncSkirt();
      if (_charEl) { _charEl.style.left = P.x + 'px'; _charEl.style.top = (P.y - CHAR_H) + 'px'; }
      if (_tickPlayModeFn) _tickPlayModeFn(0, 0, _dt);
      return;
    }
    // Death in play mode — show splat pose, skip all movement/input
    if (_playerDead) {
      _deathRespawnTimer -= _dt;
      if (_deathRespawnTimer <= 0) {
        _deathRespawnTimer = 99999;
        if (window._dexShowDeathScreen) window._dexShowDeathScreen();
      }
      poseSplat(P.stunSeverity);
      _syncCosmeticsToHead();
      _syncSkirt();
      if (_charEl) { _charEl.style.left = P.x + 'px'; _charEl.style.top = (P.y - CHAR_H) + 'px'; }
      if (_tickPlayModeFn) _tickPlayModeFn(0, 0, _dt); // keep world rendering
      return;
    }
    const wantsMove = wL || wR || wU || wD;
    _topDownDir = _getTopDownDir(wU, wD, wL, wR);
    const sprinting = _keys['Shift'];
    let speed;
    if (_hoverboard.active) speed = WALK_SPEED * (_hoverboard.boosting ? HOVER_BOOST_MULT : HOVER_SPEED_MULT);
    else if (_jetpack.active && (P._jumpVisualY || 0) < -8) speed = WALK_SPEED * JET_PM_SPEED_MULT;
    else if (sprinting) speed = WALK_SPEED * 1.5;
    else speed = WALK_SPEED;

    const tgtVX = wR ? speed : wL ? -speed : 0;
    const tgtVY = wD ? speed : wU ? -speed : 0;
    const diagonal = (wR || wL) && (wU || wD);
    const norm = diagonal ? 1 / Math.SQRT2 : 1;

    // Immediate stop when no keys held — no sliding
    if (!wR && !wL) P.vx = 0;
    else P.vx += (tgtVX * norm - P.vx) * ACCEL * _dt;
    if (!wU && !wD) P.vy = 0;
    else P.vy += (tgtVY * norm - P.vy) * ACCEL * _dt;

    // ── Jetpack in free roam (MD 10) ──
    // Space throttles up toward JET_PM_HOVER_Y on the same visual lever
    // the jump uses; releasing settles gently back to the ground. The
    // world position keeps moving in 2D (faster, see speed above) — this
    // is a movement mode, not a physics change.
    if (_jetpack.active && currentState !== 'jump-air' && currentState !== 'crouch-release') {
      const prevLift = P._jumpVisualY || 0;
      if (spaceHeld && _jetpack.fuel > 0) {
        if (!_jetpack.thrusting && prevLift > -2 && window._dexJetFX) window._dexJetFX('burst');
        _jetpack.thrusting = true;
        sfxHold('jet');
        P._jumpVisualY = prevLift + (JET_PM_HOVER_Y - prevLift) * 0.045 * _dt;
        _jetpack.fuel = Math.max(0, _jetpack.fuel - JET_PM_DRAIN * _dt);
      } else {
        if (_jetpack.thrusting) sfxHoldStop('jet');
        _jetpack.thrusting = false;
        if (prevLift < 0) {
          P._jumpVisualY = Math.min(0, prevLift + JET_PM_SETTLE * _dt);
          // Touchdown from a real hover: dust puff plus a soft squash
          // (MD 13) — absorb the landing, no bounce.
          if (P._jumpVisualY >= -0.5 && prevLift < -25) {
            window._dexLandFX?.(0.35, false);
            landImpact = 3;
            absorbDur = 10;
            currentState = 'land-absorb';
            landAbsorbT = 0;
          }
        }
      }
      _jetpack._pmVY = ((P._jumpVisualY || 0) - prevLift) / (_dt || 1);
      // Exhaust: plume from the nozzle while thrusting, downwash on the
      // ground once there's real height under the character. Throttled;
      // playmode's particle cap bounds sustained flight.
      const liftNow = -(P._jumpVisualY || 0);
      if (window._dexJetFX) {
        if (_jetpack.thrusting && _frameCount % 2 === 0) window._dexJetFX('plume', { lift: liftNow });
        if (liftNow > 35 && _frameCount % 4 === 0) window._dexJetFX('wash');
      }
      if ((P._jumpVisualY || 0) >= -0.5 && !_jetpack.thrusting) {
        _jetpack.fuel = Math.min(JET_FUEL_MAX, _jetpack.fuel + JET_REFILL * _dt);
      }
      _syncJetFuelHud();
    }

    // Space charge in play mode — no slowdown, half max charge
    // (suppressed while the jetpack is on: Space is its throttle)
    if (spaceHeld && P.grounded && currentState !== 'jump-air' && !_jetpack.active) {
      _spaceDownFrame += _dt;
      if (_spaceDownFrame > CHARGE_DELAY && !isCharging) {
        isCharging = true;
        chargeFrames = 0;
      }
      if (isCharging && currentState !== 'crouch-release') {
        chargeFrames = Math.min(chargeFrames + _dt, PM_MAX_CHARGE);
        currentState = wantsMove ? 'charge-walk' : 'jump-charge';
      }
    }

    // Jump in play mode — visual jump (shadow stays, character bounces up)
    if (currentState === 'crouch-release') {
      crouchFrame += _dt;
      if (crouchFrame >= crouchDur) _executeLaunch();
    }
    if (currentState === 'jump-air') {
      // Visual-only jump: apply gravity to a visual offset, no world position change
      P._jumpVisualY = (P._jumpVisualY || 0);
      P._jumpVY = (P._jumpVY || P.vy);
      P._jumpVY += GRAVITY * _dt;
      P._jumpVisualY += P._jumpVY * _dt;
      if (P._jumpVisualY >= 0) {
        const _impactVY = Math.abs(P._jumpVY || 0);
        P._jumpVisualY = 0; P._jumpVY = 0;
        if (_hoverboard.active) {
          if (_impactVY > 1.0) {
            landImpact = Math.min(_impactVY / 4, 1) * 9;
            sfx('land.board', { power: landImpact / 9 });
            window._dexLandFX?.(landImpact / 9, true);
            absorbDur = Math.round(8 + Math.min(_impactVY, 5) * 2); // MD 03: 8-18, was 10-20
            currentState = 'land-absorb'; landAbsorbT = 0;
          } else {
            currentState = 'idle';
            if (wantsMove) currentState = sprinting ? 'jog' : 'walk';
          }
        } else if (_impactVY > 1.0) {
          landImpact = Math.min(_impactVY / 4, 1) * 9;
          sfx('land', { power: landImpact / 9 });
          window._dexLandFX?.(landImpact / 9, false);
          absorbDur = Math.round(8 + Math.min(_impactVY, 5) * 2.4); // MD 03: 8-20, was 12-22
          currentState = 'land-absorb';
          landAbsorbT = 0;
        } else {
          currentState = 'idle';
          if (wantsMove) currentState = sprinting ? 'jog' : 'walk';
        }
      }
      P.grounded = false;
    } else {
      // MD 10: the jetpack hover owns the visual lever while lifted —
      // don't zero it out from under the pack.
      if (!(_jetpack.active && (P._jumpVisualY || 0) < 0)) P._jumpVisualY = 0;
      P.grounded = true;
    }

    if (wantsMove) {
      lastActivity = Date.now(); _trackAction();
      if (_topDownDir === 'left' || _topDownDir === 'up-left' || _topDownDir === 'down-left') flipX = true;
      else if (_topDownDir === 'right' || _topDownDir === 'up-right' || _topDownDir === 'down-right') flipX = false;
    }

    // Pose dispatch for top-down
    idleT += 0.016 * _dt;
    const isMoving = _topDownDir !== 'idle';
    if (isMoving) {
      runPhase += (sprinting ? 0.025 : 0.015) * _dt;
      // Footfalls ride the phase crossings — speed-accurate for free.
      // The hoverboard glides; no steps while riding.
      if (!_hoverboard.active && P.grounded) footstep(runPhase, sprinting);
    }

    // Set currentState for cosmetic sync (robe, skirt, arm hiding)
    if (currentState !== 'jump-charge' && currentState !== 'charge-walk' && currentState !== 'jump-air' && currentState !== 'crouch-release' && currentState !== 'land-absorb' && currentState !== 'crouch') {
      currentState = isMoving ? (sprinting ? 'jog' : 'walk') : 'idle';
    }

    // Tick land-absorb in play mode (note-mode block skipped via !_inPlayMode guard)
    if (currentState === 'land-absorb') {
      landAbsorbT += _dt;
      // MD 03: movement cancels the tail of the absorb earlier (0.45, was
      // 0.6) — recovery reads without ever feeling like a control lockout.
      if (landAbsorbT > absorbDur * 0.45 && wantsMove) currentState = isMoving ? (sprinting ? 'jog' : 'walk') : 'idle';
      else if (landAbsorbT >= absorbDur) currentState = 'idle';
    }

    // Sprint cancels crouch toggle
    if (sprinting && _crouching) { _crouching = false; _crouchIntensity = 0; }

    // Crouch in play mode (C key toggle) — always allow, no gravity in top-down
    if (_crouching) {
      if (currentState === 'walk' || currentState === 'idle' || currentState === 'crouch' || currentState === 'jog') {
        _crouchIntensity = Math.min(_crouchIntensity + 0.08 * _dt, 0.5);
        currentState = 'crouch';
      }
    } else if (_crouchIntensity > 0) {
      // Crouch toggled off — zero intensity immediately, no slow decay
      _crouchIntensity = 0;
      if (currentState === 'crouch') {
        currentState = isMoving ? (sprinting ? 'jog' : 'walk') : 'idle';
      }
    }

    // Mount/dismount transition pose — overrides everything
    if (_hoverboard.transition === 'mount') {
      const mt = Math.min(_hoverboard.transT / HOVER_MOUNT_DUR, 1);
      if (mt < 0.2) poseJumpCharge(mt / 0.2);
      else _poseHoverMountAir(); // arms out to sides, not straight up
    }
    else if (_hoverboard.transition === 'dismount') {
      const dmt = Math.min(_hoverboard.transT / HOVER_DISMOUNT_DUR, 1);
      if (dmt < 0.15) poseHoverCharge(idleT, dmt / 0.15);
      else _poseHoverMountAir();
    }
    else if (_jetpack.active && (P._jumpVisualY || 0) < -6) { poseJetFly(_jetpack._pmVY || 0, _jetpack.thrusting, idleT); }
    else if (_hoverboard.active && (currentState === 'jump-charge' || currentState === 'crouch-release')) { poseHoverCharge(idleT, chargeFrames / PM_MAX_CHARGE); }
    else if (_hoverboard.active && currentState === 'charge-walk') { runPhase += 0.012 * _dt; poseHoverCharge(idleT, chargeFrames / PM_MAX_CHARGE); }
    else if (currentState === 'jump-air') { _hoverboard.active ? (_hoverboard.boosting ? poseHoverBoost(idleT) : poseHoverRide(idleT)) : poseJumpAir(P._jumpVY || 0); }
    else if (currentState === 'crouch-release') { poseJumpCharge(crouchFrame / crouchDur); }
    else if (currentState === 'land-absorb') { _hoverboard.active ? poseHoverLandAbsorb(landAbsorbT / absorbDur) : poseLandAbsorb(landAbsorbT / absorbDur); }
    else if (currentState === 'charge-walk') { runPhase += 0.012 * _dt; poseChargeWalk(runPhase, chargeFrames / PM_MAX_CHARGE); }
    else if (currentState === 'jump-charge') { poseJumpCharge(chargeFrames / PM_MAX_CHARGE); }
    else if (_hoverboard.active && currentState === 'crouch') { poseHoverCrouch(idleT, _crouchIntensity); }
    else if (_hoverboard.active && _hoverboard.boosting) { poseHoverBoost(idleT); }
    else if (_hoverboard.active && !isMoving) { poseHoverIdle(idleT); }
    else if (_hoverboard.active && isMoving) { poseHoverRide(idleT); }
    else if (currentState === 'crouch') {
      if (isMoving) { runPhase += 0.008 * _dt; poseChargeWalk(runPhase, _crouchIntensity); }
      else { poseJumpCharge(_crouchIntensity); }
    }
    else if (!isMoving) { poseIdle(idleT); }
    else if (_topDownDir === 'right' || _topDownDir === 'left') { sprinting ? poseJog(runPhase) : poseWalk(runPhase); }
    else if (_topDownDir === 'up' || _topDownDir === 'up-right' || _topDownDir === 'up-left') { poseWalkAway(runPhase); }
    else if (_topDownDir === 'down' || _topDownDir === 'down-right' || _topDownDir === 'down-left') { poseWalkToward(runPhase); }

    // Gun aiming still works
    if (_gun.held) { _updateGunAim(_lastMouseX, _lastMouseY, true); _syncArmsToGun(); }
    if (_mouseHeld && _gun.held && _gun.type) {
      const cfg = GUN_TYPES[_gun.type];
      if (cfg.autoFire) { _fireTimer += _dt; if (_fireTimer >= cfg.fireRate) { _fireTimer = 0; _shootGun(); } }
    }

    _syncCosmeticsToHead();
    _syncSkirt();
    _applyTickleOverlay();
    if (_tickleActive) _syncCosmeticsToHead();
    _tickCarry();

    // Update world canvas and get screen position
    if (_tickPlayModeFn) {
      const pos = _tickPlayModeFn(P.vx * _dt, P.vy * _dt, _dt);
      if (pos) { P.x = pos.sx; P.y = pos.sy; _playZoom = pos.zoom || 1; }
    }

    // Render — apply flip + depth scale + visual jump offset + hoverboard
    const jumpOffset = P._jumpVisualY || 0;
    const pmTransHop = _tickHoverTransition();
    const pmHoverOff = _hoverboard.active ? (HOVER_FLOAT - _hoverboard.bob) : 0;
    window._dexCharJumpOffset = jumpOffset;
    window._dexCharHoverOffset = pmHoverOff;
    _renderHoverboard(jumpOffset);
    if (_charEl) {
      // MD#CHAR-FLASH-REAL: skip ALL render-loop writes during exit
      // transition. exitPlayMode owns the char element's style during
      // exit; render-loop interference causes the visible center-flash.
      if (!_avatarExiting) {
        _charEl.style.left = P.x + 'px';
        _charEl.style.top = (P.y - CHAR_H + jumpOffset - pmHoverOff + pmTransHop) + 'px';
        if (_charEl.style.opacity === '0') { _charEl.style.opacity = '1'; }
      }
      _charEl.style.transformOrigin = 'bottom center';
      // Flip: movement direction when moving, mouse direction when idle with weapon
      let needsFlip;
      if (_topDownDir !== 'idle') {
        needsFlip = _topDownDir === 'left' || _topDownDir === 'up-left' || _topDownDir === 'down-left';
      } else if (_gun.held || _isBowVisible()) {
        needsFlip = _lastMouseX < P.x;
      } else {
        needsFlip = flipX;
      }
      flipX = needsFlip;
      const scaleVal = _getTopDownScale(_topDownDir);
      const flipStr = needsFlip ? 'scaleX(-1)' : '';
      const zoomStr = _playZoom !== 1 ? `scale(${_playZoom})` : '';
      if (_svgEl) _svgEl.style.transform = [zoomStr, scaleVal !== 1.0 ? `scale(${scaleVal})` : '', flipStr].filter(Boolean).join(' ');
    }
    if (_overlay) _overlay.style.zIndex = '150';

    _updateChargeBar();
    // Bow in play mode — visible when equipped
    if (_isBowVisible()) {
      if (_bow.drawing) {
        _bow.chargeT = Math.min(_bow.chargeT + _dt, MAX_BOW_CHARGE);
        _bow.shaking = _bow.chargeT >= MAX_BOW_CHARGE;
      }
      _syncArmsToBow();
    } else {
      const bp = _el('bow'), sl = _el('bow-str-l'), sr = _el('bow-str-r');
      if (bp) bp.style.display = 'none';
      if (sl) sl.style.display = 'none';
      if (sr) sr.style.display = 'none';
    }
    _updateBowChargeBar();
    _tickArrows();
    updateLongHairFlow(_uid);
    updateVikingHornSideView(_uid);
    _tickProjectiles();
    _tickCreatures();
    _tickCreatureFire();
    _tickLaser();
    _tickCreatureSpawner();
    // Shadow follows character in play mode — hide in tank
    const _inTankPM = _isInTankFn && _isInTankFn();
    if (_shadowEl && _inTankPM) { _shadowEl.style.display = 'none'; }
    else if (_shadowEl) { _shadowEl.style.display = '';
      // MD 10: every airborne state casts — jump, jetpack hover, board
      // float. Shrinks and fades with height, capped so it never vanishes
      // entirely (the cap IS the "very high" read).
      const h = Math.abs(P._jumpVisualY || 0) + (window._dexCharHoverOffset || 0);
      const scale = Math.max(0.3, 1 - h / 220);
      const opacity = h < 1 ? 0.85 : Math.max(0.12, scale * 0.8);
      const zoomScale = _playZoom || 1;
      _shadowEl.style.left = P.x + 'px';
      _shadowEl.style.top = P.y + 'px';
      _shadowEl.style.transform = `translate(-50%, calc(-50% - 5px)) scaleX(${scale * zoomScale}) scaleY(${zoomScale})`;
      _shadowEl.style.opacity = String(opacity);
    }
    _tickTickle();
    return; // skip normal platformer physics
  }

  // ── NORMAL MODE: platformer physics ──
  // Hard stop guard — if no movement key held, zero horizontal velocity immediately
  if (!wantsAnyMove && P.grounded && !P.stunned && !_drag.active && currentState !== 'launched' && currentState !== 'knockback') {
    P.vx = 0;
  }

  const blocked = P.stunned || currentState === 'splat' || currentState === 'get-up'
    || currentState === 'launched' || currentState === 'knockback'
    || _drag.active;

  if (!blocked && !_inPlayMode) {
    // Ground + air movement — acceleration based (note-taking mode only)
    const airCtrl = P.grounded ? 1.0 : 0.4;
    if (wantsWalk) {
      lastActivity = Date.now(); _trackAction();
      flipX = !!wL;
      const chargeRatio = chargeFrames / MAX_CHARGE;
      const sprinting = _keys['Shift'] && !isCharging;
      let speed;
      if (_hoverboard.active) speed = WALK_SPEED * (_hoverboard.boosting ? HOVER_BOOST_MULT : HOVER_SPEED_MULT);
      else if (isCharging && chargeRatio > 0.5) speed = WALK_SPEED * 0.55;
      else if (sprinting) speed = WALK_SPEED * 1.5;
      else speed = WALK_SPEED;
      const tgt = wL ? -speed : speed;
      P.vx += (tgt - P.vx) * ACCEL * airCtrl * _dt;
      if (P.grounded && !isCharging && currentState !== 'land-absorb' && currentState !== 'crouch-release') {
        currentState = sprinting ? 'jog' : 'walk';
      }
    } else if (P.grounded) {
      // No movement keys held — stop immediately (hoverboard: coast with friction)
      if (_hoverboard.active) {
        P.vx *= Math.pow(0.92, _dt); // gentle coast to stop
        if (Math.abs(P.vx) < 0.05) P.vx = 0;
      } else {
        P.vx = 0;
      }
      if (!isCharging && currentState !== 'land-absorb' && currentState !== 'crouch-release') {
        if (currentState === 'walk' || currentState === 'jog') currentState = 'idle';
      }
    }

    // Jetpack thrust (MD 07) — Space is the throttle while the pack is
    // on. Gravity still applies; thrust fights it, rise capped at
    // JET_MAX_RISE. Fuel drains in the air, refills on the ground.
    if (_jetpack.active) {
      if (spaceHeld && _jetpack.fuel > 0) {
        // Takeoff burst (MD 10): a shot of dust as the pack lights off the
        // ground — the same land-dust emitter, reused as downwash.
        if (!_jetpack.thrusting && P.grounded && window._dexPlatFX) window._dexPlatFX('land', P.x, P.y, 0.55);
        _jetpack.thrusting = true;
        // Lift off immediately: the grounded physics branch zeroes vy
        // every frame, so a threshold could only be crossed when _dt was
        // large — the pack flew at 60Hz and sat dead at 240Hz (MD 07b).
        if (P.grounded) { P.grounded = false; P.fallTimer = 0; P.vy = Math.min(P.vy, -0.6); }
        P.vy = Math.max(P.vy - JET_THRUST * _dt, JET_MAX_RISE);
        _jetpack.fuel = Math.max(0, _jetpack.fuel - _dt);
        sfxHold('jet');
        // MD 10: denser plume — every other frame instead of every third.
        if (window._dexPlatFX && (_frameCount % 2 === 0)) window._dexPlatFX('jet', P.x, P.y - 14);
      } else {
        if (_jetpack.thrusting) sfxHoldStop('jet');
        _jetpack.thrusting = false;
      }
      if (P.grounded) _jetpack.fuel = Math.min(_jetFuelMax(), _jetpack.fuel + JET_REFILL * _dt);
      _syncJetFuelHud();
    }
    // Space held — check if past delay threshold to start charging
    // (suppressed while the jetpack is on: Space is its throttle)
    if (spaceHeld && P.grounded && !_jetpack.active) {
      _spaceDownFrame += _dt;
      if (_spaceDownFrame > CHARGE_DELAY && !isCharging) {
        isCharging = true;
        chargeFrames = 0;
      }
      if (isCharging && currentState !== 'crouch-release') {
        chargeFrames = Math.min(chargeFrames + _dt, MAX_CHARGE);
        currentState = wantsWalk ? 'charge-walk' : 'jump-charge';
      }
    }
    // W/ArrowUp held — same charge mechanic as space (note-taking mode only)
    if (_wHeld && P.grounded && !(_isPlayModeFn && _isPlayModeFn())) {
      _wDownFrame += _dt;
      if (_wDownFrame > CHARGE_DELAY && !isCharging) {
        isCharging = true;
        chargeFrames = 0;
      }
      if (isCharging && currentState !== 'crouch-release') {
        chargeFrames = Math.min(chargeFrames + _dt, MAX_CHARGE);
        currentState = wantsWalk ? 'charge-walk' : 'jump-charge';
      }
    }
    // Sprint cancels crouch toggle
    if (_keys['Shift'] && _crouching && wantsWalk) { _crouching = false; _crouchIntensity = 0; }

    // Crouching — crouch pose (sessions mode, play mode handled above)
    if (_crouching && (P.grounded || (_isPlayModeFn && _isPlayModeFn()))) {
      if (currentState === 'walk' || currentState === 'idle' || currentState === 'crouch') {
        _crouchIntensity = Math.min(_crouchIntensity + 0.08 * _dt, 0.5);
        currentState = 'crouch';
      }
      // Pending drop-through: sessions mode only
      if (_dropThroughPending && !(_isPlayModeFn && _isPlayModeFn())) {
        if (_crouchIntensity >= 0.48) {
          // Fully crouched — now count the hold delay
          _dropThroughDelay += _dt;
          if (_dropThroughDelay >= 12) { // ~200ms hold at full crouch before dropping
            _dropThroughPending = false;
            _dropThroughDelay = 0;
            _crouching = false;
            _dropThroughUntil = Date.now() + 80;
            P.grounded = false;
            P.vy = 2;
          }
        }
      }
    } else if (_crouchIntensity > 0) {
      // Crouch toggled off — zero intensity immediately, no slow decay
      _crouchIntensity = 0;
      if (currentState === 'crouch') {
        currentState = wantsWalk ? (_keys['Shift'] ? 'jog' : 'walk') : 'idle';
      }
    }
  }

  // ── Crouch-release → launch ──
  if (currentState === 'crouch-release') {
    crouchFrame += _dt;
    if (crouchFrame >= crouchDur) _executeLaunch();
  }

  // ── Land absorb ──
  if (currentState === 'land-absorb') {
    landAbsorbT += _dt;
    // Hoverboard: interruptible almost immediately for fluid movement.
    // MD 03: on foot the cancel point moves up (0.45, was 0.6) — same
    // no-lockout rule as play mode.
    const absorbInterruptT = _hoverboard.active ? 0.25 : 0.45;
    if (landAbsorbT > absorbDur * absorbInterruptT && wantsWalk && !P.stunned) currentState = 'walk';
    else if (landAbsorbT >= absorbDur) currentState = _hoverboard.active ? (wantsWalk ? 'walk' : 'idle') : 'idle';
  }

  // ── Get-up stages ──
  if (currentState === 'get-up') {
    const dur = P.stunSeverity >= 3 ? 30 : P.stunSeverity >= 2 ? 25 : 20;
    getUpT += (1 / dur) * _dt;
    if (getUpT >= 1) {
      getUpStage++;
      getUpT = 0;
      if (getUpStage > 3) currentState = 'idle';
    }
  }

  // ── Launch blend ──
  if (currentState === 'launched') {
    launchBlendT += 0.05 * _dt;
    if (launchBlendT >= 1) currentState = 'jump-air';
  }
  if (currentState === 'knockback') {
    knockbackT += 0.06 * _dt;
    if (knockbackT >= 1) currentState = 'jump-air';
  }

  // ── Stun tick ──
  tickStun();

  // ── Tickle tick ──
  _tickTickle();

  // ── Drag tick ──
  if (_drag.active) {
    _tickDrag();
  }

  // Drop-in safety timeout
  if (_dropInActive) { _dropInTimer += _dt; if (_dropInTimer > 120) _dropInActive = false; }

  // ── Physics step (skip if being dragged) ──
  if (_drag.active) {
    // Physics handled by _tickDrag
  } else if (!P.grounded) {
    P.fallTimer += _dt;
    const grav = P.vy < 0 ? GRAVITY * RISE_MULT : GRAVITY;
    P.vy = Math.min(P.vy + grav * _dt, MAX_FALL);
    P.vx *= Math.pow(AIR_RESIST, _dt);
  } else if (!_dropInActive) {
    P.vy = 0;
    // No movement keys = instant stop (hoverboard: coast with friction)
    const noMoveKeys = !(_keys['ArrowLeft'] || _keys['a'] || _keys['ArrowRight'] || _keys['d']);
    if (noMoveKeys) {
      if (_hoverboard.active) {
        P.vx *= Math.pow(0.92, _dt);
        if (Math.abs(P.vx) < 0.05) P.vx = 0;
      } else {
        P.vx = 0;
      }
    } else if (currentState !== 'walk' && currentState !== 'jog' && currentState !== 'charge-walk') {
      P.vx *= Math.pow(FRICTION, _dt);
      if (Math.abs(P.vx) < 0.05) P.vx = 0;
    }
  }
  if (!_drag.active) {
    P.x += P.vx * _dt;
    P.y += P.vy * _dt;
  }

  // Floor detection (skip when dragged or jumping out to play mode)
  if (!_drag.active && !_avatarExiting) {
    const floorY = resolveFloor();
    if (floorY !== null) _sessFloorY = floorY;
    if (floorY !== null && P.y >= floorY && P.vy >= 0) {
      const impactVY = P.vy;
      P.y = floorY;
      if (!P.grounded && impactVY > 0.5) {
        P.grounded = true;
        P.floorType = P._resolvedFloor || 'canvas';
        if (_dropInActive) _dropInActive = false;
        // Check yak stomp — landing from height onto a yak squishes it
        if (P.fallTimer > 20) _checkYakStomp(P.x, P.y);
        if (impactVY > 2) triggerLanding(impactVY);
        else { currentState = (currentState === 'jump-air' || currentState === 'launched' || currentState === 'knockback') ? 'idle' : currentState; P.vy = 0; }
      } else {
        P.grounded = true;
        P.vy = 0;
        if (_dropInActive) _dropInActive = false;
      }
    } else if (P.y < floorY) {
      P.grounded = false;
    }
  }

  // ── Boundaries (skip when dragged — can go anywhere) ──
  if (_drag.active) { /* no boundaries while dragged */ }
  else {
  const halfW = 18;
  // Platformer mode (MD 06): the world is unbounded — the camera absorbs
  // drift instead of the window edge stopping the character.
  if (!_avatarExiting && !window._dexPlatActive) {
    if (P.x < halfW) { P.x = halfW; P.vx = 0; }
    if (P.x > window.innerWidth - halfW) { P.x = window.innerWidth - halfW; P.vx = 0; }
  }

  // The sidebar foot, infochips, the New Category button and the session-grid
  // popup were all solid walls here. Screen-edge clamping above is all that
  // remains; world ground and buildings are handled in playmode.js.
  } // end boundaries else block

  // ── Pose ──
  idleT += 0.016 * _dt;
  // Mount/dismount transition pose — overrides everything
  if (_hoverboard.transition === 'mount') {
    const mt = Math.min(_hoverboard.transT / HOVER_MOUNT_DUR, 1);
    if (mt < 0.2) poseJumpCharge(mt / 0.2);
    else _poseHoverMountAir();
  }
  else if (_hoverboard.transition === 'dismount') {
    const dmt = Math.min(_hoverboard.transT / HOVER_DISMOUNT_DUR, 1);
    if (dmt < 0.15) poseHoverCharge(idleT, dmt / 0.15);
    else _poseHoverMountAir();
  }
  else if (_hoverboard.active && (currentState === 'idle' || currentState === 'walk' || currentState === 'jog' || currentState === 'charge-walk' || currentState === 'jump-charge' || currentState === 'crouch' || currentState === 'crouch-release')) {
    if (currentState === 'jump-charge' || currentState === 'crouch-release') poseHoverCharge(idleT, chargeFrames / MAX_CHARGE);
    else if (currentState === 'charge-walk') { runPhase += 0.01 * _dt; poseHoverCharge(idleT, chargeFrames / MAX_CHARGE); }
    else if (_hoverboard.boosting) poseHoverBoost(idleT);
    else if (currentState === 'crouch') poseHoverCrouch(idleT, _crouchIntensity);
    else if (currentState === 'idle') poseHoverIdle(idleT);
    else poseHoverRide(idleT);
  }
  else if (_hoverboard.active && currentState === 'jump-air') { _hoverboard.boosting ? poseHoverBoost(idleT) : poseHoverRide(idleT); }
  else if (_hoverboard.active && currentState === 'land-absorb') poseHoverLandAbsorb(landAbsorbT / absorbDur);
  else if (_hoverboard.active && currentState === 'launched') { _hoverboard.boosting ? poseHoverBoost(idleT) : poseHoverRide(idleT); }
  // Jetpack flight (MD 07) — its own pose the moment the pack is airborne,
  // regardless of how the air was entered (thrust lift-off or a ledge walk).
  else if (_jetpack.active && !P.grounded) poseJetFly(P.vy, _jetpack.thrusting, idleT);
  else if (currentState === 'idle') poseIdle(idleT);
  else if (currentState === 'walk') { runPhase += 0.015 * _dt; footstep(runPhase, false); poseWalk(runPhase); }
  else if (currentState === 'jog') { runPhase += 0.025 * _dt; footstep(runPhase, true); poseJog(runPhase); }
  else if (currentState === 'charge-walk') { runPhase += 0.01 * _dt; poseChargeWalk(runPhase, chargeFrames/MAX_CHARGE); }
  else if (currentState === 'jump-charge') poseJumpCharge(chargeFrames/MAX_CHARGE);
  else if (currentState === 'crouch') { if (Math.abs(P.vx) > 0.1) { runPhase += 0.008 * _dt; poseChargeWalk(runPhase, _crouchIntensity); } else { poseJumpCharge(_crouchIntensity); } }
  else if (currentState === 'crouch-release') poseJumpCharge(crouchFrame/crouchDur);
  else if (currentState === 'jump-air') poseJumpAir(P.vy);
  else if (currentState === 'land-absorb') poseLandAbsorb(landAbsorbT/absorbDur);
  else if (currentState === 'splat') poseSplat(P.stunSeverity);
  else if (currentState === 'launched') poseLaunch(launchBlendT);
  else if (currentState === 'knockback') poseKnockback(knockbackT);
  else if (currentState === 'get-up') poseGetUp(getUpStage, getUpT);
  else if (currentState === 'dragged') poseDrag(_drag.swingAngle);

  // ── Gun: override arms to hold weapon, auto-fire ──
  if (_gun.held) {
    _updateGunAim(_lastMouseX, _lastMouseY, true);
    _syncArmsToGun();
    if (_mouseHeld && _gun.type) {
      const cfg = GUN_TYPES[_gun.type];
      if (cfg.autoFire) {
        // SMG: hold to auto-fire
        _fireTimer += _dt;
        if (_fireTimer >= cfg.fireRate) { _fireTimer = 0; _shootGun(); }
      }
      // Non-auto guns: only the initial click fires (handled in mousedown)
    }
  }

  // ── Sync cosmetics to body position after pose ──
  _syncCosmeticsToHead();
  _syncSkirt();
  _applyTickleOverlay();
  if (_tickleActive) _syncCosmeticsToHead();
  _tickCarry();

  // ── Render position ──
  if (_charEl) {
    // MD#CHAR-FLASH-REAL: see Action 1 — same gate so the exit's opacity=0
    // sticks during the transition.
    if (_charEl.style.opacity === '0' && !_avatarExiting) _charEl.style.opacity = '1';
    if (_drag.active) {
      // Place so grab hand (SVG 18,0) sits at mouse — translateX(-50%) handles centering
      _charEl.style.left = _drag.mouseX + 'px';
      _charEl.style.top = _drag.mouseY + 'px';
      _charEl.style.transformOrigin = 'top center';
      if (_svgEl) _svgEl.style.transform = '';
    } else {
      const transHop = _tickHoverTransition();
      const hoverOffset = _hoverboard.active ? (HOVER_FLOAT - _hoverboard.bob) : 0;
      _charEl.style.left = P.x + 'px';
      _charEl.style.top = (P.y - CHAR_H - hoverOffset + transHop) + 'px';
      _charEl.style.transformOrigin = 'bottom center';
      const scaleStr = flipX ? 'scaleX(-1)' : '';
      if (_svgEl) _svgEl.style.transform = scaleStr;
    }
  }
  if (_overlay) _overlay.style.zIndex = _drag.active ? '99999' : '150';

  // ── Hoverboard render ──
  _renderHoverboard();

  // Shadow (MD 10): projected onto the floor the character would land on —
  // platforms included — instead of riding the feet. Height above that
  // floor drives the shrink/fade, capped so extreme platformer altitude
  // still leaves a faint marker on the ground.
  if (_shadowEl) {
    let floorY = getCanvasFloorY();
    for (const f of _chipFloors) {
      if (P.x >= f.left && P.x <= f.right && f.top >= P.y - 1 && f.top < floorY) floorY = f.top;
    }
    const hover = _hoverboard.active ? HOVER_FLOAT : 0;
    const heightAbove = Math.max(0, floorY - P.y) + hover;
    const scale = Math.max(0.3, 1 - heightAbove / 220);
    const opacity = heightAbove < 1 ? 0.85 : Math.max(0.12, scale * 0.8);
    _shadowEl.style.left = P.x + 'px';
    _shadowEl.style.top = floorY + 'px';
    _shadowEl.style.transform = `translate(-50%, calc(-50% - 5px)) scaleX(${scale})`;
    _shadowEl.style.opacity = String(opacity);
  }

  _updateChargeBar();
  // Bow — visible when equipped (not holstered, no gun), charge when drawing
  if (_isBowVisible()) {
    if (_bow.drawing) {
      _bow.chargeT = Math.min(_bow.chargeT + _dt, MAX_BOW_CHARGE);
      _bow.shaking = _bow.chargeT >= MAX_BOW_CHARGE;
    }
    // Face toward mouse when idle with bow (override movement-based flipX)
    if (currentState === 'idle' || currentState === 'crouch') {
      const mouseLeft = _lastMouseX < P.x;
      if (mouseLeft !== flipX) {
        flipX = mouseLeft;
        if (_svgEl) _svgEl.style.transform = flipX ? 'scaleX(-1)' : '';
      }
    }
    _syncArmsToBow();
  } else {
    const bp = _el('bow'), sl = _el('bow-str-l'), sr = _el('bow-str-r');
    if (bp) bp.style.display = 'none';
    if (sl) sl.style.display = 'none';
    if (sr) sr.style.display = 'none';
  }
  // Face toward mouse when idle with gun (same as bow logic above)
  if (_gun.held && (currentState === 'idle' || currentState === 'crouch')) {
    const mouseLeft = _lastMouseX < P.x;
    if (mouseLeft !== flipX) {
      flipX = mouseLeft;
      if (_svgEl) _svgEl.style.transform = flipX ? 'scaleX(-1)' : '';
    }
  }
  _updateBowChargeBar();
  _tickArrows();
  _tickGunPickupProximity();
  _tickProjectiles();
  _tickCreatures();
  _tickCreatureFire();
  _tickLaser();
  _tickCreatureSpawner();
  // Platformer world (MD 06) — camera, ground, platforms, home. Runs after
  // physics so the frame's landing state is final; the colliders it
  // publishes are read by resolveFloor next frame.
  if (window._dexPlatTick && !_inputPaused) window._dexPlatTick(_dt);
  _tickAvatarExit();
  updateLongHairFlow(_uid);
  updateVikingHornSideView(_uid);
}

// The sidebar watchers (MutationObserver/ResizeObserver on #sb-wrap,
// #sb-archive-body and #sess-grid-popup) drove those reactions. Gone with them.

// ═══════════════════════════════════
//  CLEANUP & INIT
// ═══════════════════════════════════

function _cleanup() {}

// Exports for play mode world integration
export function getPhysicsVX() { return P.vx; }
export function getPhysicsVY() { return P.vy; }
export function getDt() { return _dt; }
export function setScreenPos(sx, sy) { P.x = sx; P.y = sy; }
let _dropInActive = false;
let _dropInTimer = 0;
export function setDropIn(sx, sy) {
  P.x = sx; P.y = sy; P.vy = 5; P.vx = 0;
  P.grounded = false; P.fallTimer = 0;
  currentState = 'jump-air';
  _dropInActive = true; _dropInTimer = 0;
}
export function triggerPlayModeLanding() {
  if (_hoverboard.active) { P.grounded = true; P.vy = 0; landImpact = 7; absorbDur = 22; currentState = 'land-absorb'; landAbsorbT = 0; sfx('land.board', { power: 7 / 9 }); window._dexLandFX?.(7 / 9, true); return; }
  sfx('land', { power: 7 / 9 });
  window._dexLandFX?.(7 / 9, false);
  landImpact = 7;
  absorbDur = 30; // ~0.5 seconds
  currentState = 'land-absorb';
  landAbsorbT = 0;
  P.grounded = true;
  P.vy = 0;
  P._jumpVY = 0;
  P._jumpVisualY = 0;
}
let _jumpOutId = 0;
export function cancelJumpOut() { _jumpOutId++; }
export function triggerJumpOut() {
  const charEl = document.querySelector('.char-local');
  if (!charEl) return;
  _avatarExiting = true;
  const jumpId = ++_jumpOutId;
  isCharging = false;
  chargeFrames = 0;
  crouchDur = 6;
  crouchFrame = 0;
  _jumpVYTarget = TAP_JUMP_VY;
  currentState = 'crouch-release';
  setTimeout(() => {
    if (_jumpOutId !== jumpId) return;
    P.vy = -10;
    currentState = 'jump-air';
    charEl.style.transformOrigin = 'bottom center';
    charEl.style.transition = 'transform 0.38s cubic-bezier(0.4, 0, 0.6, 1)';
    charEl.style.transform = 'translateY(-130vh)';
    setTimeout(() => {
      if (_jumpOutId !== jumpId) return;
      charEl.style.opacity = '0';
      charEl.style.transition = 'none';
      charEl.style.transform = '';
      charEl.style.transformOrigin = '';
    }, 400);
  }, 120);
}
export function unholsterBow() { _bow.holstered = false; }
export function toggleInventory() { _toggleInventory(); }
export function renderAllHotbarSlots() { _renderAllHotbarSlots(); }
export function resetCreatures() {
  if (_carriedCreature) { _dropCarriedCreature(); _carriedCreature = null; }
  _creatures.forEach(c => { if (c.el) c.el.remove(); });   // MD11: carried creatures release with el=null
  _creatures.length = 0;
  _activityScore = 0; _lastDecayTick = 0;
  // Clean up all session-mode blood, puddles, and impact effects
  document.querySelectorAll('.dex-blood, .impact-ring').forEach(el => el.remove());
  _lastSpawnCheck = 0;
}

// Deactivate hoverboard (called from playmode.js on death)
window._dexDeactivateHoverboard = function() {
  if (_hoverboard.active) { _hoverboard.active = false; _hoverboard.transition = ''; }
  if (_hoverboard.el) _hoverboard.el.style.display = 'none';
};

// Avatar toggle drop-in: character falls from above when re-enabled
window._dexSnapToFloor = function() {
  const inPM = _isPlayModeFn && _isPlayModeFn();
  if (inPM) return;
  const floorY = getCanvasFloorY();
  if (floorY !== null && floorY !== undefined) {
    P.y = floorY;
    P.vy = 0;
    P.grounded = true;
    P.fallTimer = 0;
    currentState = 'idle';
  }
};
window._dexResetAvatarExiting = function() { _avatarExiting = false; };
window._dexAvatarDropIn = function() {
  // Cancel any in-progress exit animation
  _avatarExiting = false;
  _avatarExitDir = 0;

  const inPM = _isPlayModeFn && _isPlayModeFn();
  if (inPM) return;
  // Deactivate hoverboard — fresh start
  if (_hoverboard.active) { _hoverboard.active = false; _hoverboard.transition = ''; }
  if (_hoverboard.el) _hoverboard.el.style.display = 'none';
  // Reset creature spawner — no creatures until player interacts
  _activityScore = 0; _lastDecayTick = 0;
  _lastSpawnCheck = 0;
  // Same spawn position as initial page load
  P.x = 40;
  P.y = -80;
  P.vy = 2;
  P.vx = 0;
  P.grounded = false;
  P.fallTimer = 0;
  currentState = 'jump-air';
  _playerDead = false;
  _bow.holstered = true; _bow.drawing = false;
  if (_gun.held) { _gun.held = false; _gun.type = null; if (_gun.svgLine) { _gun.svgLine.remove(); _gun.svgLine = null; } }
  if (_overlay) _overlay.style.display = '';
  if (_shadowEl) _shadowEl.style.display = '';
};

// Avatar exit animation: equip hoverboard, ride off nearest screen edge
let _avatarExiting = false;
window._dexAvatarExitAnim = function() {
  if (_avatarExiting) return;
  const inPM = _isPlayModeFn && _isPlayModeFn();
  if (inPM) return;
  _avatarExiting = true;
  // Drop any weapons
  if (_gun.held) _dropGun();
  _bow.holstered = true; _bow.drawing = false;
  if (_hoverboard.active) { _hoverboard.active = false; _hoverboard.transition = ''; }
  if (_hoverboard.el) _hoverboard.el.style.display = 'none';
  // Jump off screen toward nearest edge
  P.vy = -12;
  P.grounded = false;
  currentState = 'jump-air';
  _avatarExitDir = P.x < window.innerWidth / 2 ? -1 : 1;
};

let _avatarExitDir = 0;

function _tickAvatarExit() {
  if (!_avatarExiting) return;
  P.vx = _avatarExitDir * 4;
  P.vy += 0.4; // gravity
  // Off screen (below or to either side)
  if (P.x < -60 || P.x > window.innerWidth + 60 || P.y > window.innerHeight + 60) {
    _avatarExiting = false;
    _avatarExitDir = 0;
    window._dexAvatarEnabled = false;
    if (_hoverboard.active) { _hoverboard.active = false; _hoverboard.transition = ''; }
    if (_hoverboard.el) _hoverboard.el.style.display = 'none';
    if (_overlay) _overlay.style.display = 'none';
    if (_shadowEl) _shadowEl.style.display = 'none';
    document.body.classList.add('avatar-disabled');
    // Clean up creatures, blood, and effects
    _creatures.forEach(c => { if (c.el) c.el.remove(); });   // MD11: carried creatures release with el=null
    _creatures.length = 0;
    _activityScore = 0; _lastDecayTick = 0;
    document.querySelectorAll('.dex-blood, .impact-ring').forEach(el => el.remove());
  }
}

export async function initCharacter() {
  // Clean up any previous instance
  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  if (_overlay) { _overlay.remove(); }
  _projectiles.forEach(p => p.el.remove());
  _projectiles.length = 0;
  _pickups.forEach(p => { p.el.remove(); p.promptEl.remove(); });
  _pickups.length = 0;
  _creatures.forEach(c => { if (c.el) c.el.remove(); });   // MD11: carried creatures release with el=null
  _creatures.length = 0;
  _gun.held = false; _gun.svgLine = null; _gun.type = null; _gun._pickup = null;
  _arrows.forEach(a => a.el?.remove()); _arrows.length = 0;
  _bow.drawing = false; _bow.chargeT = 0;
  if (_shadowEl) { _shadowEl.remove(); _shadowEl = null; }
  // Remove old key listeners to prevent stacking
  document.removeEventListener('keydown', _onKeyDown);
  document.removeEventListener('keyup', _onKeyUp);

  _overlay = document.createElement('div');
  _overlay.id = 'char-overlay';
  document.body.appendChild(_overlay);

  // Standalone identity. _uid seeds every generated SVG element id
  // (`${uid}-horn-left` etc.), so it must be stable across reloads —
  // no randomized guest id here.
  _uid = 'local';
  _userName = 'Player';
  _sessionId = ROOM_ID;

  _charEl = document.createElement('div');
  _charEl.className = 'char-entity char-local';
  _svgEl = _buildCharSvg(_uid);
  _charEl.appendChild(_svgEl);
  // Shadow — separate element in overlay, not child of _charEl
  if (_shadowEl) _shadowEl.remove();
  _shadowEl = document.createElement('div');
  _shadowEl.className = 'char-shadow';
  _overlay.appendChild(_shadowEl);
  const cw = document.createElement('div'); cw.className = 'char-charge-bar-wrap';
  const cb = document.createElement('div'); cb.className = 'char-charge-bar';
  cw.appendChild(cb); _charEl.appendChild(cw);
  // Both guest and logged-in use the session accent color
  _charEl.style.setProperty('--char-clr','var(--clr-adj)'); // bridged from --accent by accent.js
  _overlay.appendChild(_charEl);

  // Initial position — bottom-left of the canvas
  P.x = 40;
  P.y = -80; // start above screen — drop in
  P.vy = 2;
  P.grounded = false;
  P.fallTimer = 0;
  P.floorType = 'canvas';
  // Fade in quickly
  if (_charEl) {
    _charEl.style.opacity = '0';
    _charEl.style.transition = 'opacity 0.25s ease';
    // Set initial position BEFORE making visible — prevents 0,0 flash
    _charEl.style.left = P.x + 'px';
    _charEl.style.top = (P.y - 80) + 'px';
  }

  document.addEventListener('keydown', _onKeyDown);
  document.addEventListener('keyup', _onKeyUp);
  // Block right-click context menu while any movement key is held
  document.addEventListener('contextmenu', e => {
    const movementHeld = _keys['ArrowLeft'] || _keys['ArrowRight'] || _keys['ArrowUp'] || _keys['ArrowDown'] ||
                         _keys['a'] || _keys['d'] || _keys['w'] || _keys['s'] ||
                         _keys['Shift'] || _keys[' '];
    if (movementHeld) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // Clear all held keys on any focus loss — prevents stuck movement
  // But NOT during drag operations (drag causes transient blur)
  let _isDragging = false;
  document.addEventListener('dragstart', () => { _isDragging = true; });
  document.addEventListener('dragend', () => { _isDragging = false; });
  function _clearAllKeys() {
    if (_isDragging) return;
    for (const k in _keys) _keys[k] = false;
    spaceHeld = false; isCharging = false; _mouseHeld = false;
  }
  window.addEventListener('blur', _clearAllKeys);
  document.addEventListener('visibilitychange', () => { if (document.hidden) _clearAllKeys(); });

  // If user drags a chip the character is standing on, character falls through
  document.addEventListener('mousedown', e => {
    const chip = e.target.closest('.infochip');
    if (chip && P.activeChip && chip === P.activeChip.el && P.grounded) {
      P.grounded = false;
      P.activeChip = null;
      P.vy = 0.5;
    }
  });

  // ── Tickle: proximity-based jitter detection ──
  document.addEventListener('mousemove', e => {
    const dx = e.clientX - _lastMouseX;
    const dy = e.clientY - _lastMouseY;
    _lastMouseX = e.clientX;
    _lastMouseY = e.clientY;

    if (_drag.active) { _onDragMove(e); return; }

    // Tickle: proximity-based jitter detection
    if (!_drag.active) {
      const charScreenX = P.x;
      const charScreenY = P.y - CHAR_H / 2;
      const distToChar = Math.sqrt((e.clientX - charScreenX) ** 2 + (e.clientY - charScreenY) ** 2);
      const speed = Math.sqrt(dx * dx + dy * dy);
      if (distToChar < 80 && speed > 2) {
        _tickleWarmup += 1;
        _tickleDecay = 30;
        if (_tickleWarmup >= TICKLE_WARMUP_THRESHOLD) _tickleActive = true;
      } else if (distToChar >= 80) {
        _tickleActive = false;
        _tickleDecay = 0;
        _tickleWarmup = 0;
      }
    }

    // Gun aiming
    if (_gun.held) _updateGunAim(e.clientX, e.clientY);
    // Bow aiming — follows mouse whenever equipped (not just when drawing)
    if (_isBowVisible()) {
      _bow.angle = Math.atan2(e.clientY - (P.y - CHAR_H/2), e.clientX - P.x);
    }
  });

  // ── Drag: click and hold on character ──
  _charEl.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    _startDrag(e);
  });
  document.addEventListener('mouseup', e => {
    if (_drag.active) _endDrag();
  });

  // ── Shoot: click while holding gun ──
  let _lastShotTime = 0;
  function _isUIClick(el) {
    if (!el) return false;
    // Check if click is on any interactive UI element
    if (el.closest('button, a, input, textarea, select, label, [contenteditable], #item-bar, #inventory-grid, .inv-slot, #inv2, .inv2-chip, .inv2-chev, .char-opt, #dxav-panel, .dxav-chip, .modal-overlay, #play-mode-ui')) return true;
    return false;
  }
  document.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (_drag.active) return;
    if (_charEl && _charEl.contains(e.target)) return;
    // Carry throw — allow even when clicking on UI (outliner platforms)
    if (_carriedCreature) {
      _carryThrowCharging = true;
      _carryThrowCharge = 0;
      return;
    }
    if (_isUIClick(e.target)) return; // don't fire weapons when clicking UI
    if (_isExitConfirmFn && _isExitConfirmFn()) return; // don't shoot during exit confirm
    if (_isChatOpenFn && _isChatOpenFn()) return; // don't shoot while typing
    if (_isPlayerStunnedFn && _isPlayerStunnedFn()) return; // don't shoot while stunned/dead
    // Avatar disabled in sessions mode — no shooting
    if (!(_isPlayModeFn && _isPlayModeFn()) && window._dexAvatarEnabled === false) return;
    // Tank fire — route click to tank instead of gun
    if (_isInTankFn && _isInTankFn()) {
      if (window._dexTankFire) window._dexTankFire();
      return;
    }
    if (document.querySelector('.inv-slot-dragging')) return; // don't shoot while dragging inventory
    // Flag planting — active hotbar slot has flag
    const _flagItemId = _hotbar[_activeHotbarSlot];
    if (_flagItemId === 'checkpointFlag' && _isPlayModeFn && _isPlayModeFn() && window._dexPlantFlag) {
      window._dexPlantFlag();
      // Remove flag from hotbar
      _hotbar[_activeHotbarSlot] = null;
      _saveHotbar();
      _renderHotbarSlot(_activeHotbarSlot);
      return;
    }
    _mouseHeld = true;
    _fireTimer = 0;
    if (_gun.held && _gun.type) {
      const cfg = GUN_TYPES[_gun.type];
      if (cfg.isLaser) {
        _startLaser();
      } else {
        const now = Date.now();
        const cooldownMs = cfg.fireRate * (1000 / 60);
        if (now - _lastShotTime >= cooldownMs) { _lastShotTime = now; _shootGun(); }
      }
    } else if (!_gun.held && !_bow.holstered) {
      // Bow drawing
      e.preventDefault(); // prevent text selection during draw
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
      _bow.drawing = true; _bow.chargeT = 0;
      _bow.angle = Math.atan2(e.clientY - (P.y - CHAR_H/2), e.clientX - P.x);
    }
  });
  document.addEventListener('mouseup', e => {
    if (e.button === 0) {
      // Restore text selection after bow draw
      if (_bow.drawing) {
        document.body.style.userSelect = '';
        document.body.style.webkitUserSelect = '';
      }
      if (_carriedCreature && _carryThrowCharging) { _throwCarriedCreature(); return; }
      _mouseHeld = false; _fireTimer = 0;
      _stopLaser();
      // Sword power swipe — releasing a held charge fires it (the function
      // no-ops and resets if the hold was too short to charge).
      if (_gun._swordChargeT > 0) _swordPowerRelease();
      if (_bow.drawing) { _bow.drawing = false; _fireBowArrow(); _bow.chargeT = 0; _bow.shaking = false; }
    }
  });

  // Create weapon entries for equip menu (no visible canvas pickups)
  const gunTypes = ['pistol', 'shotgun', 'smg', 'rifle', 'sword', 'rocket', 'laser', 'pufferLauncher', 'spellbook'];
  gunTypes.forEach(type => {
    const el = document.createElement('div');
    el.style.display = 'none'; // invisible — equip via menu only
    document.body.appendChild(el);
    const prompt = document.createElement('div');
    prompt.style.display = 'none';
    document.body.appendChild(prompt);
    _pickups.push({ type, x: 0, y: 0, el, promptEl: prompt });
  });
  _activityScore = 0; _lastDecayTick = 0; _lastSpawnCheck = 0; // reset creature spawner

  // Restore the saved outfit (localStorage). Falls through to the declared
  // defaults on first run.
  await _loadCosmetics();
  applyCosmetics(_uid, _cosmetics);
  _initCosmeticsUI();
  _renderAllHotbarSlots();
  // Start with everything holstered — _syncHotbarVisuals derives the slot
  // classes from this state every frame (MD 10).
  _bow.holstered = true; _bow.drawing = false;
  if (_gun.held) _dropGun();
  _renderBackpackSlots();

  // Lazy-link play mode check (avoids circular import)
  import('./playmode.js').then(m => { _isPlayModeFn = m.isPlayMode; _isPlayModePhysicsFn = m.isPlayModePhysics; _isChatOpenFn = m.isChatOpen; _isExitConfirmFn = m.isExitConfirmOpen; _tickPlayModeFn = m.tickPlayMode; _hitPlayCreaturesFn = m.hitTestCreatures; _screenToWorldFn = m.screenToWorld; _worldToScreenFn = m.worldToScreen; _getHomeScreenBoundsFn = m.getHomeScreenBounds; _getBuildingPolysFn = m.getBuildingPolygons; _addWorldExplosionFn = m.addWorldExplosion; _isPlayerStunnedFn = m.isPlayerStunned; _isInTankFn = m.isInTank; }).catch(() => {});


  // Watch for theme/color changes — update arrow + projectile colors
  new MutationObserver(() => {
    const accentClr = _getAccentColor();
    const flightClr = _getArrowFlightColor();
    _arrows.forEach(a => { if (a.el) a.el.style.background = a.stuck ? accentClr : flightClr; });
    _projectiles.forEach(p => { if (!p.el) return; p.el.style.background = accentClr; p.el.style.boxShadow = `0 0 8px ${accentClr}`; const _tr = p.el.querySelector('.proj-trail'); if (_tr) _tr.style.background = `linear-gradient(to left,${accentClr} 0%,rgba(255,255,255,0.15) 40%,transparent 100%)`; });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
  window.addEventListener('beforeunload', _cleanup);

  // Always spawn holstered — no weapon drawn, arms idle
  _bow.drawing = false; _bow.chargeT = 0; _bow.holstered = true;
  _gun.held = false; _gun.type = null;
  if (_gun.svgLine) { _gun.svgLine.remove(); _gun.svgLine = null; }
  const _bp = document.getElementById(_uid + '-bow');
  const _sl = document.getElementById(_uid + '-bow-str-l');
  const _sr = document.getElementById(_uid + '-bow-str-r');
  if (_bp) _bp.style.display = 'none';
  if (_sl) _sl.style.display = 'none';
  if (_sr) _sr.style.display = 'none';

  _rafId = requestAnimationFrame(_frame);
}
