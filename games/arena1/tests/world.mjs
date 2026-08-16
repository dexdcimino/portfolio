// tests/world.mjs — Phase 2 acceptance, all headless (node tests/world.mjs).
// The five spec items: walks 10s without falling through · walks up rampA ·
// falls off an edge · rides a mover · (determinism re-passes — that one lives
// in determinism.mjs, run alongside). Plus the added acceptance item from Dex:
// a smoothness assertion — walk up rampA and along a wall at a shallow angle
// at full speed, and assert the per-tick velocity delta stays under a
// threshold with no spikes. Actual numbers are printed, not just pass/fail.
import { strict as assert } from 'node:assert';
import { createWorld, CAPSULE_R, CAPSULE_HALF_H } from '../js/sim/world.js';
import { buildLevel, tickPlatforms } from '../js/sim/level.js';
import { createSim } from '../js/sim/sim.js';
import { TUNE, SIM_DT } from '../js/config.js';
import { rngFor } from '../js/core/rng.js';

// Per-tick |Δv| ceiling for the smoothness windows. Legitimate steady-state
// churn is ~1.3 m/s per tick (ACCEL·dt = 1.17 + the gravity/slide cancel of
// G·dt = 0.5); solver jitter (pop-out, re-fall, corner catching) shows as
// several m/s. 2.5 sits far above the first and far below the second.
const DV_MAX = 2.5;

let passed = 0;
const ok = (name, detail) => { passed++; console.log(`ok  ${name}${detail ? ` — ${detail}` : ''}`); };

function makeWorldForSeed(seed) {
  const world = createWorld();
  const level = buildLevel(world, rngFor(seed, 'level'));
  return { world, level };
}

// Minimal grounded-walk driver: the sim's Phase-1 accel model over the real
// solver. Movement richness is Phase 3's port; the SOLVER is what Phase 2
// tests, so the driver stays deliberately dumb.
function makeWalker(world, pos, yaw) {
  const w = {
    pos: { ...pos }, vel: { x: 0, y: 0, z: 0 }, yaw,
    grounded: false, groundPlatformId: null, wallN: null,
  };
  w.step = (moveX = 0, moveZ = 0) => {
    const wishX = Math.sin(w.yaw) * moveZ + Math.cos(w.yaw) * moveX;
    const wishZ = Math.cos(w.yaw) * moveZ - Math.sin(w.yaw) * moveX;
    const wl = Math.hypot(wishX, wishZ);
    const accel = w.grounded ? TUNE.ACCEL : TUNE.AIR_ACCEL;
    if (wl > 1e-6) {
      w.vel.x += (wishX / wl) * accel * SIM_DT;
      w.vel.z += (wishZ / wl) * accel * SIM_DT;
      const sp = Math.hypot(w.vel.x, w.vel.z);
      if (sp > TUNE.WALK && w.grounded) { const k = TUNE.WALK / sp; w.vel.x *= k; w.vel.z *= k; }
    } else if (w.grounded) {
      const f = Math.max(0, 1 - TUNE.FRICTION * SIM_DT);
      w.vel.x *= f; w.vel.z *= f;
    }
    w.vel.y += TUNE.G * SIM_DT;
    const res = world.moveCapsule(w.pos, w.vel,
      { x: w.vel.x * SIM_DT, y: w.vel.y * SIM_DT, z: w.vel.z * SIM_DT },
      CAPSULE_R, CAPSULE_HALF_H);
    w.pos = res.pos; w.vel = res.vel; w.grounded = res.grounded;
    w.groundPlatformId = res.groundPlatformId; w.wallN = res.wallN;
    return res;
  };
  return w;
}

// The ramp and edge-landing lanes must be clear of (seed-random) arena
// crystals or the smoothness numbers measure crystal bumps, not the solver.
// Ascent crystals all sit at y ≥ 12 and are excluded by the y filter.
function laneBlocked(level, x0, x1, z, halfW) {
  return level.crystals.some((c) => c.y < 8
    && c.x > x0 - 3 && c.x < x1 + 3
    && Math.abs(c.z - z) < halfW + c.s * 0.9 + 0.6);
}

function pickSeed() {
  for (let i = 0; i < 60; i++) {
    const seed = `p2-${i}`;
    const { world, level } = makeWorldForSeed(seed);
    const rampClear = !laneBlocked(level, 3, 27, 0, 1.0);
    const edgeClear = !laneBlocked(level, 29, 42, 0, 1.2);
    const mover = level.platforms.find((pl) => pl.type === 'mover'
      && ['slab', 'pad', 'cross', 'L', 'rock'].includes(pl.archetype));
    if (rampClear && edgeClear && mover) return { seed, world, level, mover };
  }
  throw new Error('no seed with clear ramp/edge lanes and a boxy mover in 60 tries');
}

const { seed, world, level, mover } = pickSeed();
console.log(`seed ${seed}: ${world.shapes.length} shapes, ${level.platforms.length} platforms, `
  + `${level.crystals.length} crystals, ${level.cellSpots.length} cells, ${level.ramps.length} ramps`);

// ── 1. walks 10s across the arena without falling through ──────────────────
{
  const w = makeWalker(world, { x: 0, y: 0.92, z: 26 }, 0);
  const headings = [0, 0.8, 1.6, 2.4, 3.2, 4.0, 4.8, 5.6, 0.4, 2.0];
  let minY = Infinity;
  for (let t = 0; t < 600; t++) {
    w.yaw = headings[Math.floor(t / 60)];
    w.step(0, 1);
    assert.ok(Number.isFinite(w.pos.y), `NaN position at tick ${t}`);
    minY = Math.min(minY, w.pos.y);
    // Ground top is y=0, capsule center rides at 0.9. Below 0.85 = sunk in.
    assert.ok(w.pos.y > 0.85, `fell through at tick ${t}: y=${w.pos.y.toFixed(3)}`);
    assert.ok(Math.abs(w.pos.x) < 64.2 && Math.abs(w.pos.z) < 64.2,
      `escaped the walled arena at tick ${t}`);
  }
  assert.ok(w.grounded, 'not grounded after the 10s walk');
  ok('walks 10s across the arena', `min center y ${minY.toFixed(3)} (floor contact = 0.900)`);
}

// ── 2. walks up rampA + SMOOTHNESS (Dex's added acceptance item) ───────────
// Starts ON the ramp's low section already AT FULL SPEED (the item as given);
// per-tick |Δv| must stay under DV_MAX in the window x∈[8,23] (before the
// crest). The ground→ramp lip transition itself is a Phase 3 feel-check item.
{
  const w = makeWalker(world, { x: 6, y: 1.55, z: 0 }, Math.PI / 2);
  w.vel.x = TUNE.WALK;
  let prevV = { ...w.vel };
  const dvs = [], dvsAll = [];
  let winTicks = 0, groundedTicks = 0, maxY = 0, maxDvy = 0, speedSum = 0;
  for (let t = 0; t < 260; t++) {
    w.step(0, 1);
    const dv = Math.hypot(w.vel.x - prevV.x, w.vel.y - prevV.y, w.vel.z - prevV.z);
    if (w.pos.x <= 23) dvsAll.push(dv); // includes the flat→slope transition
    if (w.pos.x >= 8 && w.pos.x <= 23) {
      winTicks++;
      if (w.grounded) groundedTicks++;
      dvs.push(dv);
      speedSum += Math.hypot(w.vel.x, w.vel.y, w.vel.z);
      maxDvy = Math.max(maxDvy, Math.abs(w.vel.y - prevV.y));
    }
    maxY = Math.max(maxY, w.pos.y);
    prevV = { ...w.vel };
  }
  const maxDv = Math.max(...dvs);
  const meanDv = dvs.reduce((a, b) => a + b, 0) / dvs.length;
  const spikes = dvs.filter((d) => d > DV_MAX).length;
  const maxDvAll = Math.max(...dvsAll);
  assert.ok(winTicks >= 30, `ramp window too short: ${winTicks} ticks`);
  assert.ok(maxY > 4.5, `never climbed the ramp: max y ${maxY.toFixed(2)}`);
  assert.ok(groundedTicks / winTicks > 0.9,
    `grounded flicker on the ramp: ${groundedTicks}/${winTicks}`);
  assert.equal(spikes, 0, `${spikes} velocity spikes over ${DV_MAX} on the ramp (max ${maxDv.toFixed(3)})`);
  assert.ok(maxDvAll < DV_MAX, `spike in the slope transition: ${maxDvAll.toFixed(3)}`);
  ok('rampA climb smoothness', `steady max|Δv| ${maxDv.toFixed(3)}, mean ${meanDv.toFixed(3)} m/s per tick `
    + `(limit ${DV_MAX}); incl. slope transition max|Δv| ${maxDvAll.toFixed(3)}; max|Δvy| ${maxDvy.toFixed(3)}; `
    + `grounded ${(100 * groundedTicks / winTicks).toFixed(1)}% over ${winTicks} ticks; `
    + `climb speed ${(speedSum / winTicks).toFixed(2)} m/s; crest y ${maxY.toFixed(2)}`);
}

// ── 3. wall glide SMOOTHNESS (the other half of the added item) ────────────
// Full speed along the south wall at a shallow (~8.6°) approach angle; same
// per-tick |Δv| ceiling once the wall is engaged.
{
  const w = makeWalker(world, { x: -30, y: 0.92, z: 63.4 }, Math.PI / 2 - 0.15);
  w.vel.x = Math.cos(0.15) * TUNE.WALK;
  w.vel.z = Math.sin(0.15) * TUNE.WALK;
  let prevV = { ...w.vel };
  const dvs = [], dvsAll = [];
  let winTicks = 0, wallTicks = 0, everTouched = false, speedSum = 0;
  for (let t = 0; t < 400; t++) {
    w.step(0, 1);
    const dv = Math.hypot(w.vel.x - prevV.x, w.vel.y - prevV.y, w.vel.z - prevV.z);
    if (w.pos.x <= 25) dvsAll.push(dv); // includes the free-approach → wall-engage impact
    const touching = w.wallN !== null;
    if (touching) everTouched = true;
    if (everTouched && w.pos.x >= -25 && w.pos.x <= 25) {
      winTicks++;
      if (touching) wallTicks++;
      dvs.push(dv);
      speedSum += Math.hypot(w.vel.x, w.vel.y, w.vel.z);
    }
    prevV = { ...w.vel };
  }
  const maxDv = Math.max(...dvs);
  const meanDv = dvs.reduce((a, b) => a + b, 0) / dvs.length;
  const spikes = dvs.filter((d) => d > DV_MAX).length;
  const maxDvAll = Math.max(...dvsAll);
  assert.ok(winTicks >= 100, `wall window too short: ${winTicks} ticks`);
  assert.ok(w.pos.x > 20, `no progress along the wall: ended x ${w.pos.x.toFixed(1)}`);
  assert.ok(wallTicks / winTicks > 0.8, `wall contact lost: ${wallTicks}/${winTicks}`);
  assert.equal(spikes, 0, `${spikes} velocity spikes over ${DV_MAX} on the wall (max ${maxDv.toFixed(3)})`);
  assert.ok(maxDvAll < DV_MAX, `spike at wall engage: ${maxDvAll.toFixed(3)}`);
  ok('wall glide smoothness', `glide max|Δv| ${maxDv.toFixed(3)}, mean ${meanDv.toFixed(3)} m/s per tick `
    + `(limit ${DV_MAX}); incl. wall engage max|Δv| ${maxDvAll.toFixed(3)}; wall contact `
    + `${(100 * wallTicks / winTicks).toFixed(1)}% over ${winTicks} ticks; glide speed ${(speedSum / winTicks).toFixed(2)} m/s`);
}

// ── 4. falls off an edge (padPlatA) and lands, no tunneling ────────────────
{
  const w = makeWalker(world, { x: 30, y: 5.5 + 0.92, z: 0 }, Math.PI / 2);
  let airStreak = 0, longestAir = 0, landedY = null, landTick = null;
  for (let t = 0; t < 400; t++) {
    w.step(0, 1);
    if (!w.grounded) { airStreak++; longestAir = Math.max(longestAir, airStreak); }
    else {
      if (airStreak >= 15 && landedY === null) { landedY = w.pos.y; landTick = t; }
      airStreak = 0;
    }
    assert.ok(w.pos.y > 0.85, `tunneled through the ground at tick ${t}: y=${w.pos.y.toFixed(3)}`);
  }
  assert.ok(longestAir >= 15, `never actually fell (longest air ${longestAir} ticks)`);
  assert.ok(landedY !== null && landedY < 3, `no clean landing (landed y ${landedY})`);
  ok('falls off the padPlatA edge and lands', `${longestAir} ticks airborne, landed y ${landedY.toFixed(3)} at tick ${landTick}`);
}

// ── 5. stands on a mover and translates with it ────────────────────────────
{
  // Fresh world so platform state starts clean of the tests above.
  const { world: w2, level: l2 } = makeWorldForSeed(seed);
  const pl = l2.platforms[mover.id];
  // Advance platforms to tick 0's pose BEFORE placing the capsule (a mover's
  // offset at tick 0 is sin(phase)·amp, not zero).
  tickPlatforms(w2, l2, 0, new Set(), []);
  const s0 = pl.shapes[0];
  const top = s0.kind === 'aabb'
    ? { x: (s0.min.x + s0.max.x) / 2, y: s0.max.y, z: (s0.min.z + s0.max.z) / 2 }
    : { x: s0.center.x, y: s0.center.y + s0.halfH, z: s0.center.z };
  const w = makeWalker(w2, { x: top.x, y: top.y + CAPSULE_HALF_H + 0.02, z: top.z }, 0);
  let relStart = null, maxDrift = 0, onTicks = 0, total = 0;
  for (let t = 1; t <= 300; t++) {
    tickPlatforms(w2, l2, t, new Set(), []);
    if (w.groundPlatformId === pl.id) {
      w.pos.x += pl.lastDelta.x; w.pos.y += pl.lastDelta.y; w.pos.z += pl.lastDelta.z;
    }
    w.step(0, 0);
    if (t > 20) { // let it settle onto the surface first
      total++;
      if (w.grounded && w.groundPlatformId === pl.id) onTicks++;
      const rel = {
        x: w.pos.x - (pl.base.x + pl.offset.x),
        z: w.pos.z - (pl.base.z + pl.offset.z),
      };
      if (relStart === null) relStart = rel;
      maxDrift = Math.max(maxDrift,
        Math.hypot(rel.x - relStart.x, rel.z - relStart.z));
    }
  }
  assert.ok(onTicks / total > 0.85, `kept falling off the mover: ${onTicks}/${total}`);
  assert.ok(maxDrift < 1.0, `slid ${maxDrift.toFixed(2)}m across the mover while riding`);
  const axis = pl.axis.y ? 'vertical' : (pl.axis.x ? 'x' : 'z');
  ok('rides a mover', `platform ${pl.id} (${pl.archetype}, ${axis}, amp ${pl.amp.toFixed(1)}, `
    + `speed ${pl.speed.toFixed(2)}), on-platform ${(100 * onTicks / total).toFixed(1)}%, drift ${maxDrift.toFixed(3)}m`);
}

// ── 6. full-sim smoke: spawn through createSim onto the real level ─────────
{
  // enemies:false — a blob bouncing the idle player mid-settle would fail the
  // rest asserts; this test is about the world, combat.mjs owns the enemies.
  const sim = createSim('world-smoke', { enemies: false });
  const id = sim.addPlayer();
  for (let t = 0; t < 300; t++) sim.step(new Map());
  const p = sim.snapshot().players.find((q) => q.id === id);
  assert.ok(p.flags & 1, 'player not grounded after settling');
  assert.ok(Math.abs(p.vel.y) < 1e-6, `resting vel.y ${p.vel.y}`);
  assert.ok(p.pos.y > 0.85 && p.pos.y < 1.0, `resting y ${p.pos.y}`);
  ok('full sim settles on the real level', `rest y ${p.pos.y.toFixed(3)}`);
}

// ── 7. raycast sanity (the query Phase 3 grapple/shooting will lean on) ────
{
  // Straight down from above the arena center hits the spire cap (top y=19).
  const down = world.raycast({ x: 0, y: 30, z: 0 }, { x: 0, y: -1, z: 0 }, 100);
  assert.ok(down && Math.abs(down.point.y - 19) < 1e-6, `down ray hit y ${down?.point.y}`);
  assert.ok(down.n.y === 1, 'down ray normal not +Y');
  // Toward the south wall from just short of it (crystals never reach z>62.1,
  // so this lane is clear for every seed) hits its inner face (z=64.5).
  const south = world.raycast({ x: 0, y: 2, z: 63 }, { x: 0, y: 0, z: 1 }, 10);
  assert.ok(south && Math.abs(south.point.z - 64.5) < 1e-6, `south ray hit z ${south?.point.z}`);
  // Range-limited ray misses.
  assert.equal(world.raycast({ x: 0, y: 2, z: 63 }, { x: 0, y: 0, z: 1 }, 1), null);
  ok('raycast', `spire cap at y ${down.point.y.toFixed(1)}, south wall at z ${south.point.z.toFixed(1)}`);
}

console.log(`\nworld.mjs: ${passed}/7 passed (seed ${seed})`);
