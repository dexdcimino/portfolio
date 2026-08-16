// tests/world.mjs — Phase 2 acceptance, all headless (node tests/world.mjs).
// The five spec items: walks 10s without falling through · walks up rampA ·
// falls off an edge · rides a mover · (determinism re-passes — that one lives
// in determinism.mjs, run alongside). Plus the added acceptance item from Dex:
// a smoothness assertion — walk up rampA and along a wall at a shallow angle
// at full speed, and assert the per-tick velocity delta stays under a
// threshold with no spikes. Actual numbers are printed, not just pass/fail.
import { strict as assert } from 'node:assert';
import { createWorld, CAPSULE_R, CAPSULE_HALF_H } from '../js/sim/world.js';
import { buildLevel, tickPlatforms, HEX_APOTHEM, hexEdgeAngle } from '../js/sim/level.js';

/* MD 17: the arena is a hexagon, so "still inside the walls" is no longer a box
   test. A point is inside when its projection onto each of the six outward edge
   normals is under the apothem. Tolerance covers the capsule radius plus half
   the wall thickness — a body resting against a wall is legitimately a little
   past the wall's centre plane. */
const HEX_TOL = 0.4 + 1.5 + 0.3;
function insideHex(x, z) {
  for (let k = 0; k < 6; k++) {
    const m = hexEdgeAngle(k);
    if (x * Math.cos(m) + z * Math.sin(m) > HEX_APOTHEM + HEX_TOL) return false;
  }
  return true;
}
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
    assert.ok(insideHex(w.pos.x, w.pos.z),
      `escaped the hexagon at tick ${t}: (${w.pos.x.toFixed(1)}, ${w.pos.z.toFixed(1)})`);
  }
  assert.ok(w.grounded, 'not grounded after the 10s walk');
  ok('walks 10s across the arena', `min center y ${minY.toFixed(3)} (floor contact = 0.900)`);
}

// ── 2. walks up rampA + SMOOTHNESS (Dex's added acceptance item) ───────────
// Starts ON the ramp's low section already AT FULL SPEED (the item as given);
// per-tick |Δv| must stay under DV_MAX in the window x∈[8,23] (before the
// crest). The ground→ramp lip transition itself is a Phase 3 feel-check item.
{
  // Re-pinned for MD 17: rampA moved to x=17/len 22, so its runnable surface is
  // x∈[8,26] rising 0.91→5.32. Starting at x=6 now begins in mid-air short of
  // the lip (and under the widened spireCap), which is what produced a 3.96
  // Δv spike — an artefact of the start pose, not of the ramp.
  const w = makeWalker(world, { x: 8, y: 0.91 + 0.9, z: 0 }, Math.PI / 2);
  w.vel.x = TUNE.WALK;
  let prevV = { ...w.vel };
  const dvs = [], dvsAll = [];
  let winTicks = 0, groundedTicks = 0, maxY = 0, maxDvy = 0, speedSum = 0;
  for (let t = 0; t < 260; t++) {
    w.step(0, 1);
    const dv = Math.hypot(w.vel.x - prevV.x, w.vel.y - prevV.y, w.vel.z - prevV.z);
    if (w.pos.x <= 24) dvsAll.push(dv); // includes the flat→slope transition
    if (w.pos.x >= 10 && w.pos.x <= 24) {
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
  // The +z-facing flat replaces the old south wall: its face plane sits at the
  // apothem less half the wall thickness, so start just inside that.
  const w = makeWalker(world, { x: -30, y: 0.92, z: HEX_APOTHEM - 1.5 - 1.7 }, Math.PI / 2 - 0.15);
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
  const w = makeWalker(world, { x: 38, y: 5.5 + 0.92, z: 0 }, Math.PI / 2);   // padPlatA moved to x=38
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
  // Straight down from above the arena centre hits the spire cap. Derived from
  // the level rather than a literal — MD 17 raised the cap from 19 to 27 and a
  // hardcoded 19 only says "the spire moved", which is not what this checks.
  const cap = level.blocks.find((b) => b.name === 'spireCap');
  const capTop = cap.y + cap.h / 2;
  const down = world.raycast({ x: 0, y: capTop + 12, z: 0 }, { x: 0, y: -1, z: 0 }, 100);
  assert.ok(down && Math.abs(down.point.y - capTop) < 1e-6,
    `down ray hit y ${down?.point.y}, expected the spire cap at ${capTop}`);
  assert.ok(down.n.y === 1, 'down ray normal not +Y');
  /* Toward the +z flat. MD 17 replaced the axis-aligned south wall with a hex
     edge, so the inner face is now the apothem less half the wall thickness
     and it is an obb rather than an aabb — which is the more valuable thing to
     be raycasting at anyway. Crystals are capped at 0.82·apothem so this lane
     is still clear on every seed. */
  const innerFace = HEX_APOTHEM - 1.5;
  const south = world.raycast({ x: 0, y: 2, z: innerFace - 4 }, { x: 0, y: 0, z: 1 }, 10);
  assert.ok(south && Math.abs(south.point.z - innerFace) < 1e-4,
    `+z wall ray hit z ${south?.point.z}, expected ${innerFace.toFixed(3)}`);
  // Range-limited ray misses.
  assert.equal(world.raycast({ x: 0, y: 2, z: innerFace - 4 }, { x: 0, y: 0, z: 1 }, 1), null);
  ok('raycast', `spire cap at y ${down.point.y.toFixed(1)}, +z hex wall at z ${south.point.z.toFixed(2)}`);
}

// ── 8. hex rim: no gap at any wall seam or corner (MD 17) ──────────────────
// The six rim walls are angled obbs meeting at the vertices, and an obb-obb
// join is exactly where a capsule squeezes through. Run hard into all six
// corners AND the middle of all six flats; the body must neither sink nor
// escape the hexagon.
{
  let minY = Infinity, worstPush = 0, escapes = 0;
  const probes = [];
  for (let k = 0; k < 6; k++) probes.push({ label: `corner ${k}`, a: k * Math.PI / 3 });
  for (let k = 0; k < 6; k++) probes.push({ label: `flat ${k}`, a: hexEdgeAngle(k) });
  for (const pr of probes) {
    const sx = Math.cos(pr.a) * (HEX_APOTHEM - 12), sz = Math.sin(pr.a) * (HEX_APOTHEM - 12);
    const w = makeWalker(world, { x: sx, y: 0.92, z: sz }, Math.atan2(Math.cos(pr.a), Math.sin(pr.a)));
    for (let t = 0; t < 240; t++) {
      w.step(0, 1);
      assert.ok(Number.isFinite(w.pos.y), `${pr.label}: NaN at tick ${t}`);
      assert.ok(w.pos.y > 0.85, `${pr.label}: sank through the floor at tick ${t} (y ${w.pos.y.toFixed(3)})`);
      minY = Math.min(minY, w.pos.y);
      if (!insideHex(w.pos.x, w.pos.z)) escapes++;
    }
    worstPush = Math.max(worstPush, w.pos.x * Math.cos(pr.a) + w.pos.z * Math.sin(pr.a));
  }
  assert.equal(escapes, 0, `${escapes} ticks outside the hexagon at a seam`);
  ok('hex rim seams + corners hold', `12 probes x 4s into every corner and flat; `
    + `min y ${minY.toFixed(3)}, deepest reach ${worstPush.toFixed(2)}m (apothem ${HEX_APOTHEM.toFixed(2)})`);
}

console.log(`\nworld.mjs: ${passed}/8 passed (seed ${seed})`);
