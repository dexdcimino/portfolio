// tests/stepup.mjs — lip/edge climb diagnostic + regression (node tests/stepup.mjs).
// Walks the capsule at full speed from flat ground onto rampA's base lip, onto
// a parametric ladder of step heights, and onto real Ascent ramp ends, and
// reports whether each CLIMBS, STALLS, or CATCHES. Context: the prototype's
// Babylon ellipsoid (0.4, 0.9) rolls over low lips because its tall vertical
// radius tilts contact normals upward; a capsule's r=0.4 bottom sphere gives a
// near-horizontal normal at lip height ≈ sphere center, so without a step-up
// allowance the solver walls out where the prototype climbed.
import { strict as assert } from 'node:assert';
import { createWorld, CAPSULE_R, CAPSULE_HALF_H } from '../js/sim/world.js';
import { buildLevel } from '../js/sim/level.js';
import { TUNE, SIM_DT } from '../js/config.js';
import { rngFor } from '../js/core/rng.js';

function makeWalker(world, pos, yaw) {
  const w = { pos: { ...pos }, vel: { x: 0, y: 0, z: 0 }, yaw, grounded: false };
  w.step = () => {
    const wishX = Math.sin(w.yaw), wishZ = Math.cos(w.yaw);
    const accel = w.grounded ? TUNE.ACCEL : TUNE.AIR_ACCEL;
    w.vel.x += wishX * accel * SIM_DT;
    w.vel.z += wishZ * accel * SIM_DT;
    const sp = Math.hypot(w.vel.x, w.vel.z);
    if (sp > TUNE.WALK && w.grounded) { const k = TUNE.WALK / sp; w.vel.x *= k; w.vel.z *= k; }
    w.vel.y += TUNE.G * SIM_DT;
    const res = world.moveCapsule(w.pos, w.vel,
      { x: w.vel.x * SIM_DT, y: w.vel.y * SIM_DT, z: w.vel.z * SIM_DT },
      CAPSULE_R, CAPSULE_HALF_H, { stepUp: w.grounded });
    w.pos = res.pos; w.vel = res.vel; w.grounded = res.grounded;
  };
  return w;
}

// Drive along +heading for `ticks`; classify by forward progress + jitter.
//   CLIMBS — passes the obstacle line and gains the expected height
//   STALLS — stops advancing at the obstacle
//   CATCHES — gets past but with a velocity spike ≥ catchDv (snag-and-pop)
function runCase(world, start, yaw, ticks, passDist, wantRise) {
  const w = makeWalker(world, start, yaw);
  w.vel.x = Math.sin(yaw) * TUNE.WALK;
  w.vel.z = Math.cos(yaw) * TUNE.WALK;
  const y0 = start.y;
  let prevV = { ...w.vel }, maxDv = 0, maxY = y0, minFwdSpeed = Infinity;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  for (let t = 0; t < ticks; t++) {
    w.step();
    maxDv = Math.max(maxDv, Math.hypot(w.vel.x - prevV.x, w.vel.y - prevV.y, w.vel.z - prevV.z));
    maxY = Math.max(maxY, w.pos.y);
    prevV = { ...w.vel };
  }
  const fwd = (w.pos.x - start.x) * fx + (w.pos.z - start.z) * fz;
  const rose = maxY - y0;
  const passed = fwd >= passDist && rose >= wantRise;
  const verdict = passed ? (maxDv > 4.0 ? 'CATCHES' : 'CLIMBS') : 'STALLS';
  return { verdict, fwd, rose, maxDv, endY: w.pos.y };
}

const world = createWorld();
const level = buildLevel(world, rngFor('p2-2', 'level')); // world.mjs's vetted seed
let failures = 0;
const expectClimb = (name, r, note) => {
  const s = `${name}: ${r.verdict}  (fwd ${r.fwd.toFixed(1)}m, rise ${r.rose.toFixed(2)}m, max|Δv| ${r.maxDv.toFixed(2)}${note ? ', ' + note : ''})`;
  if (r.verdict === 'CLIMBS') console.log(`ok  ${s}`);
  else { failures++; console.log(`FAIL ${s}`); }
};

// ── 1. parametric step ladder on a synthetic floor ─────────────────────────
// Steps up to 0.45 must climb (the ellipsoid handled the 0.41 rampA lip and
// the 0.40 jump-pad discs); 0.55 must NOT (that would be a half-meter curb —
// beyond anything the prototype climbs without jumping).
console.log('— step ladder —');
for (const h of [0.15, 0.25, 0.35, 0.41, 0.45]) {
  const sw = createWorld();
  sw.addAabb({ x: -20, y: -1, z: -20 }, { x: 20, y: 0, z: 20 });
  sw.addAabb({ x: 3, y: 0, z: -20 }, { x: 20, y: h, z: 20 });
  const r = runCase(sw, { x: 0, y: 0.92, z: 0 }, Math.PI / 2, 120, 5, h * 0.8);
  expectClimb(`step h=${h.toFixed(2)}`, r);
}
{
  const sw = createWorld();
  sw.addAabb({ x: -20, y: -1, z: -20 }, { x: 20, y: 0, z: 20 });
  sw.addAabb({ x: 3, y: 0, z: -20 }, { x: 20, y: 0.55, z: 20 });
  const r = runCase(sw, { x: 0, y: 0.92, z: 0 }, Math.PI / 2, 120, 5, 0.44);
  const s = `step h=0.55: ${r.verdict}  (fwd ${r.fwd.toFixed(1)}m, rise ${r.rose.toFixed(2)}m)`;
  if (r.verdict === 'STALLS') console.log(`ok  ${s} — correctly too tall`);
  else { failures++; console.log(`FAIL ${s} — should be too tall to walk up`); }
}

// ── 2. flat ground → rampA base lip (top corner y≈0.41 at x≈5.2) ───────────
console.log('— rampA base lip —');
{
  const r = runCase(world, { x: 2, y: 0.92, z: 0 }, Math.PI / 2, 180, 10, 1.0);
  expectClimb('ground → rampA → up the slope', r, `end y ${r.endY.toFixed(2)}`);
}

// ── 3. Ascent ramp→platform edges ──────────────────────────────────────────
// A 'rmp' end sits 0.5 above its platform's base, so thin platforms (halfH
// < 0.5 — slab/pad/cross/L rolls with small h) get a real lip at the join.
// Natural cases are rare in seed hunts, so synthesize the exact geometry —
// ascent-ramp dims (w3 h0.6, slope within the generator's |dy|<4.5, hd>4
// envelope) against a slab top — at the lip heights the generator produces.
console.log('— Ascent ramp→platform edges (generator geometry, synthesized lips) —');
for (const lip of [0.1, 0.25]) {
  const sw = createWorld();
  const yTop = 12; // platform top
  sw.addAabb({ x: -8, y: yTop - 1.5, z: -4 }, { x: 3, y: yTop, z: 4 }); // thin-ish slab
  const rx = -0.35, ry = Math.PI / 2, L = 10; // ~20° up toward +x
  const az = { x: Math.cos(rx) * Math.sin(ry), y: -Math.sin(rx), z: Math.cos(rx) * Math.cos(ry) };
  const lowCY = yTop + lip - 0.3 * Math.cos(rx); // low-end top surface = yTop + lip
  const center = { x: 3 + az.x * (L / 2), y: lowCY + az.y * (L / 2), z: az.z * (L / 2) };
  const axes = [
    { x: Math.cos(ry), y: 0, z: -Math.sin(ry) },
    { x: Math.sin(rx) * Math.sin(ry), y: Math.cos(rx), z: Math.sin(rx) * Math.cos(ry) },
    az,
  ];
  sw.addObb(center, { x: 1.5, y: 0.3, z: L / 2 }, axes);
  const r = runCase(sw, { x: 1, y: yTop + 0.92, z: 0 }, Math.PI / 2, 140, 5, lip + 0.5);
  expectClimb(`rmp join, lip ${lip.toFixed(2)}m`, r, `end y ${r.endY.toFixed(2)}`);
}

if (failures) { console.log(`\nstepup: ${failures} FAILURES`); process.exit(1); }
console.log('\nstepup clean');
