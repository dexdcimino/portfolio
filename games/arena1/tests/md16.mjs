// tests/md16.mjs — MD 16 acceptance (node tests/md16.mjs):
//   · grapple arrival lands you ON a ledge, not against its face
//   · a sheer wall with nothing above gives a modest redirect, not orbit
//   · a mover's ledge is probed where the platform IS on arrival
//   · wraiths cannot pass through solid geometry at any speed
//   · wraiths still slide rather than snag, and their AI does not deadlock
import { strict as assert } from 'node:assert';
import { createWorld } from '../js/sim/world.js';
import { createPlayerState, stepPlayer, BTN, ENEMY_R } from '../js/sim/movement.js';
import { stepEnemies } from '../js/sim/enemies.js';
import { TUNE, SIM_DT } from '../js/config.js';
import { rngFor } from '../js/core/rng.js';

let passed = 0;
const ok = (n, d) => { passed++; console.log(`ok  ${n}${d ? ` — ${d}` : ''}`); };
const cmd = (move, yaw, pitch, buttons) => ({ move, yaw, pitch, buttons });

function ctxWith(world, platforms = []) {
  // Same level stub shape movement.mjs uses — stepPlayer walks pads and rings.
  return { world, level: { platforms, pads: [], rings: [] }, tick: 0, events: [], ents: null };
}
// Aim from the eye at a point, the way the sim derives dir from yaw/pitch.
function aim(p, t) {
  const ex = p.pos.x, ey = p.pos.y + 0.55, ez = p.pos.z;
  const dx = t.x - ex, dy = t.y - ey, dz = t.z - ez;
  const h = Math.hypot(dx, dz);
  return { yaw: Math.atan2(dx, dz), pitch: -Math.atan2(dy, h) };
}

// ── 1. side face of a platform → you end up ABOVE its top ──────────────────
function grappleOnto(topY, label, { mover = false } = {}) {
  const world = createWorld();
  world.addAabb({ x: -60, y: -2, z: -60 }, { x: 60, y: 0, z: 60 });       // floor
  const platforms = [];
  let shape;
  if (mover) {
    shape = world.addAabb({ x: 6, y: topY - 3, z: -6 }, { x: 14, y: topY, z: 6 });
    shape.platformId = 0;
    platforms.push({ base: { x: 0, y: 0, z: 0 }, offset: { x: 0, y: 0, z: 0 }, shapes: [shape] });
  } else {
    world.addAabb({ x: 6, y: topY - 3, z: -6 }, { x: 14, y: topY, z: 6 });
  }
  const ctx = ctxWith(world, platforms);
  const p = createPlayerState(1, { x: 0, y: 0.92, z: 0 });
  // aim at the side face, a little below its top lip
  const anchor = { x: 6, y: topY - 0.8, z: 0 };
  const a = aim(p, anchor);
  stepPlayer(ctx, p, cmd({ x: 0, z: 0 }, a.yaw, a.pitch, BTN.GRAPPLE));
  assert.ok(p.grapple && p.grapple.mode === 'pull', `${label}: never latched`);

  if (mover) {
    // Drive the platform up mid-flight; the anchor and the ledge probe must
    // both follow it rather than using the fire-time position.
    for (let t = 0; t < 200 && p.grapple; t++) {
      platforms[0].offset.y = Math.min(2, t * 0.02);
      world.setShapeOffset(shape, platforms[0].offset);
      ctx.tick = t;
      stepPlayer(ctx, p, cmd({ x: 0, z: 0 }, a.yaw, a.pitch, BTN.GRAPPLE));
    }
  } else {
    for (let t = 0; t < 200 && p.grapple; t++) {
      ctx.tick = t;
      stepPlayer(ctx, p, cmd({ x: 0, z: 0 }, a.yaw, a.pitch, BTN.GRAPPLE));
    }
  }
  assert.ok(!p.grapple, `${label}: never arrived`);
  const vyAtArrival = p.vel.y;
  // coast: no input at all, just let the boost play out
  let peak = p.pos.y;
  for (let t = 0; t < 240; t++) {
    ctx.tick = 200 + t;
    stepPlayer(ctx, p, cmd({ x: 0, z: 0 }, a.yaw, a.pitch, 0));
    peak = Math.max(peak, p.pos.y);
  }
  const liveTop = mover ? topY + platforms[0].offset.y : topY;
  return { vyAtArrival, peak, liveTop, finalY: p.pos.y, grounded: p.grounded, x: p.pos.x };
}

{
  const low = grappleOnto(4, 'low lip');
  assert.ok(low.peak > low.liveTop, `low lip: peak ${low.peak.toFixed(2)} never cleared top ${low.liveTop}`);
  ok('grapple: low platform lip',
    `arrival vy ${low.vyAtArrival.toFixed(2)}, peak ${low.peak.toFixed(2)} > top ${low.liveTop}`);

  const tall = grappleOnto(18, 'tall spire');
  assert.ok(tall.peak > tall.liveTop, `tall spire: peak ${tall.peak.toFixed(2)} vs top ${tall.liveTop}`);
  ok('grapple: tall spire face',
    `arrival vy ${tall.vyAtArrival.toFixed(2)}, peak ${tall.peak.toFixed(2)} > top ${tall.liveTop}`);

  const mv = grappleOnto(9, 'mover', { mover: true });
  assert.ok(mv.peak > mv.liveTop, `mover: peak ${mv.peak.toFixed(2)} vs live top ${mv.liveTop}`);
  ok('grapple: mover mid-travel',
    `platform rose to ${mv.liveTop.toFixed(2)}, arrival vy ${mv.vyAtArrival.toFixed(2)}, peak ${mv.peak.toFixed(2)}`);
}

// ── 2. sheer wall, nothing above → modest redirect, not orbit ──────────────
{
  const world = createWorld();
  world.addAabb({ x: -60, y: -2, z: -60 }, { x: 60, y: 0, z: 60 });
  world.addAabb({ x: 6, y: 0, z: -6 }, { x: 14, y: 400, z: 6 });   // effectively infinite wall
  const ctx = ctxWith(world);
  const p = createPlayerState(1, { x: 0, y: 0.92, z: 0 });
  const anchor = { x: 6, y: 6, z: 0 };
  const a = aim(p, anchor);
  stepPlayer(ctx, p, cmd({ x: 0, z: 0 }, a.yaw, a.pitch, BTN.GRAPPLE));
  for (let t = 0; t < 200 && p.grapple; t++) { ctx.tick = t; stepPlayer(ctx, p, cmd({ x: 0, z: 0 }, a.yaw, a.pitch, BTN.GRAPPLE)); }
  const vy = p.vel.y;
  const apex = (vy * vy) / (2 * Math.abs(TUNE.G));
  assert.ok(vy > 0, `no redirect at all on a sheer wall (vy ${vy.toFixed(2)})`);
  assert.ok(apex < 4, `launched into orbit: vy ${vy.toFixed(2)} → apex ${apex.toFixed(2)}m`);
  ok('grapple: sheer wall, nothing above', `vy ${vy.toFixed(2)} → apex ${apex.toFixed(2)}m (bounded < 4m)`);
}

// ── 3. ceiling: verticality scaling means almost no upward pop ─────────────
{
  const world = createWorld();
  world.addAabb({ x: -60, y: -2, z: -60 }, { x: 60, y: 0, z: 60 });
  world.addAabb({ x: -8, y: 12, z: -8 }, { x: 8, y: 14, z: 8 });   // slab overhead
  const ctx = ctxWith(world);
  const p = createPlayerState(1, { x: 0, y: 0.92, z: 0 });
  const a = aim(p, { x: 0, y: 12, z: 0 });   // straight up at its underside
  stepPlayer(ctx, p, cmd({ x: 0, z: 0 }, a.yaw, a.pitch, BTN.GRAPPLE));
  assert.ok(p.grapple, 'never latched the ceiling');
  assert.ok(Math.abs(p.grapple.n.y) > 0.9, `expected a floor/ceiling normal, got ny ${p.grapple.n.y}`);
  ok('grapple: ceiling normal scales the redirect down', `|n.y| ${Math.abs(p.grapple.n.y).toFixed(2)} → verticality ${(1 - Math.abs(p.grapple.n.y)).toFixed(2)}`);
}

// ── 4. wraiths cannot pass through geometry ────────────────────────────────
function wraithRun({ hurlVz = 0, aggro = true } = {}) {
  const world = createWorld();
  const WALL = { min: { x: -30, y: -30, z: 4 }, max: { x: 30, y: 60, z: 5 } };
  world.addAabb(WALL.min, WALL.max);
  const player = createPlayerState(1, { x: 0, y: 0.92, z: 20 });   // behind the wall
  const wraith = {
    id: 7, kind: 'wraith', rng: rngFor('md16', 'enemy', 7),
    pos: { x: 0, y: 6, z: -6 }, vx: 0, vy: 0, vz: 0,
    hp: 1, alive: true, respawnT: 0, yanked: 0, hitCd: 0, blockT: 0,
    state: aggro ? 'swoop' : 'orbit', stT: 999, ang: 0, spd: 1.2, orbR: 20, orbH: 6,
  };
  // A yank is the only path that moves a wraith by its VELOCITY, so it is the
  // honest way to demand a huge single-tick displacement and see whether the
  // resolver catches it. Nudging e.pos from the test would bypass the very
  // code under test — which is what the first version of this did.
  if (hurlVz) { wraith.yanked = 99; wraith.vz = hurlVz; }
  const ents = { players: new Map([[1, player]]), enemies: new Map([[7, wraith]]), cells: new Map(), rockets: new Map() };
  let crossed = false, minZ = 99, states = new Set();
  for (let t = 0; t < 600; t++) {
    stepEnemies({ world, level: { platforms: [], pads: [], rings: [] }, tick: t, events: [], ents });
    states.add(wraith.state);
    minZ = Math.min(minZ, Math.abs(wraith.pos.z - 4.5));
    if (wraith.pos.z > WALL.max.z) crossed = true;
  }
  return { crossed, states: [...states], finalZ: wraith.pos.z, blockT: wraith.blockT };
}
{
  const slow = wraithRun({});
  assert.ok(!slow.crossed, `wraith passed through the wall (z ${slow.finalZ.toFixed(2)})`);
  ok('wraith: blocked by a wall while aggro', `600 ticks, never crossed (final z ${slow.finalZ.toFixed(2)})`);

  // 400 m/s is 6.67m of displacement in ONE tick against a 1m-thick wall —
  // roughly 28x a swoop, and far past anything the AI can produce. If the
  // resolver substeps properly nothing gets through even here.
  const hurled = wraithRun({ hurlVz: 400 });
  assert.ok(!hurled.crossed,
    `wraith TUNNELLED through a 1m wall at 400 m/s (z ${hurled.finalZ.toFixed(2)})`);
  ok('wraith: no tunnelling at 400 m/s (6.67m/tick vs a 1m wall)',
    `stopped at z ${hurled.finalZ.toFixed(2)}, wall face z 4`);

  // AI must not sit pressed against the wall forever.
  assert.ok(slow.states.includes('climb') || slow.states.includes('orbit'),
    `AI deadlocked in ${slow.states.join('/')}`);
  ok('wraith: AI resolves instead of deadlocking', `visited ${slow.states.join(' → ')}`);
}

// ── 5. wraith still moves freely in open air (no snagging) ─────────────────
{
  const world = createWorld();
  world.addAabb({ x: -60, y: -2, z: -60 }, { x: 60, y: 0, z: 60 });
  const player = createPlayerState(1, { x: 0, y: 0.92, z: 0 });
  const wraith = {
    id: 8, kind: 'wraith', rng: rngFor('md16', 'enemy', 8),
    pos: { x: 18, y: 14, z: 0 }, vx: 0, vy: 0, vz: 0,
    hp: 1, alive: true, respawnT: 0, yanked: 0, hitCd: 0, blockT: 0,
    state: 'orbit', stT: 0, ang: 0, spd: 1.2, orbR: 18, orbH: 14,
  };
  const ents = { players: new Map([[1, player]]), enemies: new Map([[8, wraith]]), cells: new Map(), rockets: new Map() };
  const start = { ...wraith.pos };
  let moved = 0;
  for (let t = 0; t < 300; t++) {
    const b = { ...wraith.pos };
    stepEnemies({ world, level: { platforms: [], pads: [], rings: [] }, tick: t, events: [], ents });
    moved += Math.hypot(wraith.pos.x - b.x, wraith.pos.y - b.y, wraith.pos.z - b.z);
  }
  assert.ok(moved > 20, `wraith barely moved in open air (${moved.toFixed(1)}m in 5s) — snagging`);
  ok('wraith: fluid in open air', `travelled ${moved.toFixed(1)}m in 5s from (${start.x},${start.y},${start.z})`);
}

console.log(`\nmd16.mjs: ${passed}/${passed} passed`);
