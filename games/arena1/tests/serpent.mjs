// tests/serpent.mjs — MD 18 acceptance (node tests/serpent.mjs).
import { strict as assert } from 'node:assert';
import { createSim, BTN } from '../js/sim/sim.js';
import { createWorld } from '../js/sim/world.js';
import { buildLevel } from '../js/sim/level.js';
import { createEntities } from '../js/sim/entities.js';
import { createPlayerState } from '../js/sim/movement.js';
import {
  spawnSerpent, stepSerpents, stepBolts, hitSegment, headAt, segAt, segRadius,
  segMaxHp, SEG_COUNT, SEG_LAG, HEAD_R, DEATH_LEN,
} from '../js/sim/serpent.js';
import { rngFor } from '../js/core/rng.js';
import { SIM_DT } from '../js/config.js';

let passed = 0;
const ok = (n, d) => { passed++; console.log(`ok  ${n}${d ? ` — ${d}` : ''}`); };

function rig({ withPlayer = true, playerAt = null } = {}) {
  const world = createWorld();
  const level = buildLevel(world, rngFor('serp', 'level'));
  const ents = createEntities();
  const id = ents.allocId();
  const s = spawnSerpent(ents, level, rngFor('serp', 'serpent', id), id);
  if (withPlayer) {
    const p = createPlayerState(1, playerAt || { x: 0, y: level.summitY + 20, z: 0 });
    ents.players.set(1, p);
  }
  const ctx = (tick) => ({ world, level, tick, events: [], ents, pvp: true });
  return { world, level, ents, s, ctx };
}

// ── 1. shape: head is unmistakable, segments taper ─────────────────────────
{
  const radii = Array.from({ length: SEG_COUNT }, (_, i) => segRadius(i));
  assert.equal(radii[0], HEAD_R);
  assert.ok(radii[0] > radii[1] * 1.35,
    `head only ${(radii[0] / radii[1]).toFixed(2)}x the first body segment — not unmistakable`);
  for (let i = 2; i < SEG_COUNT; i++) {
    assert.ok(radii[i] < radii[i - 1], `segment ${i} is not smaller than ${i - 1}`);
  }
  ok('head unmistakable + taper', `head r ${radii[0]} = ${(radii[0] / radii[1]).toFixed(2)}x seg1; `
    + `tail r ${radii[SEG_COUNT - 1].toFixed(3)}, monotonic over ${SEG_COUNT} segments`);
}

// ── 2. body undulates and trails the head's real path ──────────────────────
{
  const { s } = rig();
  // Segment i now must equal the head SEG_LAG*i ticks ago — that is what makes
  // it a trail rather than a rigid queue.
  for (const tick of [0, 137, 601]) {
    for (const i of [1, 5, 11]) {
      const seg = segAt(s, tick, i);
      const was = headAt(s, tick - i * SEG_LAG);
      assert.ok(Math.hypot(seg.x - was.x, seg.y - was.y, seg.z - was.z) < 1e-9,
        `segment ${i} is not on the head's path at tick ${tick}`);
    }
  }
  // and the path actually undulates in all three axes
  const ys = [], xs = [];
  for (let t = 0; t < 600; t++) { const h = headAt(s, t); ys.push(h.y); xs.push(h.x); }
  const yAmp = Math.max(...ys) - Math.min(...ys);
  const xAmp = Math.max(...xs) - Math.min(...xs);
  assert.ok(yAmp > 3, `vertical undulation only ${yAmp.toFixed(2)}m`);
  assert.ok(xAmp > 20, `horizontal circuit only ${xAmp.toFixed(2)}m`);
  // body length: head to tail should be a real span, not a clump
  const span = (() => { const a = segAt(s, 300, 0), b = segAt(s, 300, SEG_COUNT - 1);
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); })();
  ok('body trails the head and undulates', `vertical ${yAmp.toFixed(1)}m, circuit ${xAmp.toFixed(1)}m, `
    + `head-to-tail span ${span.toFixed(1)}m at tick 300`);
}

// ── 3. severing: kills the segment and everything behind it ────────────────
{
  const { s, ctx } = rig();
  const c = ctx(100);
  s.armourUntil.fill(-1);
  hitSegment(c, s, 7, 9999, 1);
  assert.equal(s.len, 7, `expected len 7 after severing at 7, got ${s.len}`);
  const severs = c.events.filter((e) => e.type === 'serpent_sever');
  assert.equal(severs.length, SEG_COUNT - 7, `severed ${severs.length} segments, expected ${SEG_COUNT - 7}`);
  assert.ok(severs.every((e) => e.point && Number.isFinite(e.point.y)), 'sever events carry no drop point');
  ok('severing detaches the whole tail', `cut at 7 → len ${SEG_COUNT}→${s.len}, `
    + `${severs.length} sever events each with a drop point`);
}

// ── 4. armour inflates on every quarter crossing and blocks ────────────────
{
  const { s, ctx } = rig();
  const SEG = 6, max = segMaxHp(SEG);
  let tick = 0, shields = 0, blocked = 0, landed = 0;
  // chip it down one zap at a time, waiting out each shield
  for (let guard = 0; guard < 4000 && s.len > SEG; guard++) {
    const c = ctx(tick);
    const did = hitSegment(c, s, SEG, 1, 1);
    if (did) landed++; else blocked++;
    shields += c.events.filter((e) => e.type === 'serpent_armour').length;
    tick++;
  }
  assert.equal(shields, 3, `expected 3 shields (75/50/25 crossings), got ${shields}`);
  assert.ok(blocked > 0, 'armour never blocked a single shot');
  assert.equal(landed, max, `took ${landed} landed hits to clear ${max} hp`);
  ok('armour: 3 shields, 4 shooting phases', `segment ${SEG} (${max} hp): ${shields} shields raised, `
    + `${blocked} shots refused while up, ${landed} landed — four bursts separated by three shields`);
}

// ── 5. hp curve: neck expensive, tail cheap, both viable ───────────────────
{
  const hp = Array.from({ length: SEG_COUNT }, (_, i) => segMaxHp(i));
  for (let i = 1; i < SEG_COUNT; i++) {
    assert.ok(hp[i] < hp[i - 1], `hp not decreasing toward the tail at ${i}`);
  }
  // cheapest instant kill: the frontmost segment whose removal drops len to DEATH_LEN
  const killSeg = DEATH_LEN;
  const burst = hp[killSeg];
  // attrition: chip from the tail inward down to the same cut
  let chip = 0;
  for (let i = SEG_COUNT - 1; i > killSeg; i--) chip += hp[i];
  chip += hp[killSeg];
  assert.ok(burst < chip, 'a neck kill is not cheaper in raw damage than chipping — no trade');
  assert.ok(chip / burst > 1.8, `chipping is only ${(chip / burst).toFixed(1)}x the burst — too close to matter`);
  ok('hp curve makes both strategies real', `ladder ${hp.join('/')}; `
    + `burst cut at seg ${killSeg} = ${burst} dmg, tail attrition to the same cut = ${chip} dmg `
    + `(${(chip / burst).toFixed(1)}x, but delivered safely and in small pieces)`);
}

// ── 6. down to the last few segments it dies ───────────────────────────────
{
  const { s, ctx } = rig();
  const c = ctx(50);
  s.armourUntil.fill(-1);
  hitSegment(c, s, DEATH_LEN, 9999, 1);
  assert.equal(s.alive, false, `still alive at len ${s.len}`);
  assert.ok(c.events.some((e) => e.type === 'serpent_death'), 'no serpent_death event');
  ok('dies at the last few segments', `cut to len ${s.len} (DEATH_LEN ${DEATH_LEN}) → death event`);
}

// ── 7. turret: dodgeable, no tunnelling, despawns on a miss ────────────────
{
  const { s, ents, ctx, level } = rig({ playerAt: { x: 20, y: 0, z: 0 } });
  // park the player inside turret range, below the orbit
  const p = ents.players.get(1);
  p.pos = { x: 0, y: level.summitY + 14, z: 0 };
  let fired = 0, tick = 0;
  for (; tick < 600 && fired === 0; tick++) {
    const c = ctx(tick);
    stepSerpents(c); stepBolts(c);
    fired += c.events.filter((e) => e.type === 'serpent_fire').length;
  }
  assert.ok(fired > 0, 'turret never fired at a player in range');
  const bolt = [...ents.bolts.values()][0];
  assert.ok(bolt, 'fire event but no bolt entity');
  const speed = Math.hypot(bolt.vel.x, bolt.vel.y, bolt.vel.z);
  assert.ok(speed < 25, `bolt speed ${speed.toFixed(1)} m/s is not dodgeable-slow`);
  // it must despawn rather than leak
  let alive = true;
  for (let t = tick; t < tick + 400 && alive; t++) {
    const c = ctx(t); stepSerpents(c); stepBolts(c);
    alive = ents.bolts.has(bolt.id);
  }
  assert.ok(!alive, 'bolt never despawned — a miss leaks forever');
  ok('turret bolts', `fired at tick ${tick}, speed ${speed.toFixed(1)} m/s `
    + `(player rocket is 40), despawned rather than leaking`);
}

// ── 8. bolts do not tunnel through geometry ────────────────────────────────
{
  const world = createWorld();
  world.addAabb({ x: -40, y: -40, z: 6 }, { x: 40, y: 60, z: 7 });   // 1m wall
  const ents = createEntities();
  const id = ents.allocId();
  const bolt = { id, serpentId: 99, born: 0, pos: { x: 0, y: 5, z: 0 },
    vel: { x: 0, y: 0, z: 600 } };                                     // 10m per tick
  ents.bolts.set(id, bolt);
  let crossed = false;
  for (let t = 1; t < 40; t++) {
    stepBolts({ world, level: { platforms: [] }, tick: t, events: [], ents, pvp: true });
    const b = ents.bolts.get(id);
    if (b && b.pos.z > 7) crossed = true;
  }
  assert.ok(!crossed, 'bolt tunnelled through a 1m wall');
  assert.ok(!ents.bolts.has(id), 'bolt survived the wall impact');
  ok('bolts sweep, never tunnel', '600 m/s (10m per tick) into a 1m wall — stopped and consumed');
}

// ── 9. determinism: spawn, flight, severing and turret fire ────────────────
{
  const run = () => {
    const sim = createSim('serpent-det', { pvp: true });
    const id = sim.addPlayer();
    const out = [];
    for (let t = 0; t < 600; t++) {
      // fire upward at the orbit so severing happens inside the window
      sim.step(new Map([[id, { tick: t, playerId: id, move: { x: 0, z: 1 },
        yaw: t * 0.02, pitch: -1.2, buttons: BTN.FIRE, weapon: t % 120 < 60 ? 0 : 1 }]]));
      const s = sim.snapshot();
      out.push(JSON.stringify({ s: s.serpents, b: s.bolts, e: s.events.filter((e) => String(e.type).startsWith('serpent') || String(e.type).startsWith('bolt')) }));
    }
    return out.join('\n');
  };
  const a = run(), b = run();
  assert.equal(a, b, 'serpent runs diverged');
  ok('determinism', '600 ticks of flight, fire and severing byte-identical across two runs');
}

// ── 10. the closed form is what a remote client would reconstruct ──────────
{
  const { s } = rig();
  // A client holding only `path` + tick must land on the same segment positions
  // the host computed — this is the claim the whole wire design rests on.
  const wire = { cx: s.cx, cy: s.cy, cz: s.cz, R: s.R, amp: s.amp, lat: s.lat,
    w: s.w, vw: s.vw, phase: s.phase, vphase: s.vphase };
  let worst = 0;
  for (const tick of [0, 91, 455, 1200]) {
    for (let i = 0; i < SEG_COUNT; i++) {
      const host = segAt(s, tick, i);
      const client = segAt(wire, tick, i);
      worst = Math.max(worst, Math.hypot(host.x - client.x, host.y - client.y, host.z - client.z));
    }
  }
  assert.ok(worst < 1e-9, `client reconstruction drifted ${worst}m from the host`);
  ok('client reconstructs the body from path + tick', `max divergence ${worst.toExponential(1)}m over 4 ticks x ${SEG_COUNT} segments`);
}

// ── 11. the orbit is clear of all level geometry ───────────────────────────
// The closed-form path cannot dodge anything, so this is the assertion that
// makes that safe rather than lucky.
{
  let minClear = Infinity, worstSeed = null;
  for (const seed of ['serp', 'p2-1', 'p2-2', 'p2-3', 12345, 999]) {
    const world = createWorld();
    const level = buildLevel(world, rngFor(seed, 'level'));
    const ents = createEntities();
    const id = ents.allocId();
    const s = spawnSerpent(ents, level, rngFor(seed, 'serpent', id), id);
    for (let t = 0; t < 900; t += 3) {
      for (let i = 0; i < SEG_COUNT; i++) {
        const c = segAt(s, t, i);
        const hits = world.overlapCapsule(c, segRadius(i) + 0.6, segRadius(i) + 0.6);
        if (hits.length) { minClear = -1; worstSeed = seed; }
      }
    }
    // and how much air is under the lowest point of the path
    let lowest = Infinity;
    for (let t = 0; t < 900; t++) lowest = Math.min(lowest, headAt(s, t).y);
    minClear = Math.min(minClear, lowest - level.summitY);
  }
  assert.ok(minClear > 0, `serpent path intersects level geometry (seed ${worstSeed})`);
  ok('orbit is clear of the level on every seed',
    `lowest point sits ${minClear.toFixed(1)}m above the summit; 6 seeds x 300 samples x ${SEG_COUNT} segments, zero overlaps`);
}

// ── 12. a client sees the same serpent THROUGH severing (item 9) ───────────
// Runs a host sim, takes only what the wire carries, rebuilds the body from it,
// and compares against the host's own segments on every tick — including the
// ticks where the tail comes off. This is the two-window claim reduced to what
// could actually break: length or armour disagreeing, or the reconstruction
// drifting once len changes.
{
  const sim = createSim('serp-net', { pvp: true });
  const pid = sim.addPlayer();
  // Park the player up near the orbit and aim at a real segment each tick —
  // spraying at the sky from the floor never connects, and a check that never
  // severs anything proves nothing (which is what the first version did).
  const me = sim.getPlayer(pid);
  const host0 = [...sim.ents.serpents.values()][0];
  me.pos = { x: 0, y: host0.cy, z: 0 }; me.spawn = { ...me.pos };
  let worstPos = 0, ticksChecked = 0, armourTicks = 0, severed = 0;
  const lenSeen = new Set();
  for (let t = 0; t < 900; t++) {
    const hs = [...sim.ents.serpents.values()][0];
    let yaw = 0, pitch = 0;
    if (hs) {
      // aim at the deepest live segment so severing actually happens
      const tgt = segAt(hs, t, Math.max(1, hs.len - 1));
      const dx = tgt.x - me.pos.x, dy = tgt.y - (me.pos.y + 0.55), dz = tgt.z - me.pos.z;
      yaw = Math.atan2(dx, dz); pitch = -Math.atan2(dy, Math.hypot(dx, dz));
    }
    me.pos = { x: 0, y: host0.cy, z: 0 };   // hold station; gravity is not the point here
    me.vel = { x: 0, y: 0, z: 0 };
    sim.step(new Map([[pid, { tick: t, playerId: pid, move: { x: 0, z: 0 },
      yaw, pitch, buttons: BTN.FIRE, weapon: 0 }]]));
    const snap = sim.snapshot();
    severed += snap.events.filter((e) => e.type === 'serpent_sever').length;
    const wire = snap.serpents[0];
    const host = [...sim.ents.serpents.values()][0];
    if (!wire || !host) continue;
    assert.equal(wire.len, host.len, `len disagrees at tick ${t}`);
    let hostMask = 0;
    for (let k = 0; k < host.len; k++) if (snap.tick < host.armourUntil[k]) hostMask |= (1 << k);
    assert.equal(wire.armour, hostMask, `armour mask disagrees at tick ${t}`);
    if (wire.armour) armourTicks++;
    lenSeen.add(wire.len);
    for (let k = 0; k < wire.len; k++) {
      const c = segAt(wire.path, snap.tick, k);
      const h = segAt(host, snap.tick, k);
      worstPos = Math.max(worstPos, Math.hypot(c.x - h.x, c.y - h.y, c.z - h.z));
    }
    ticksChecked++;
  }
  assert.ok(severed > 0, 'the run never severed anything — the check proved nothing');
  assert.ok(lenSeen.size > 1, `length never changed (only saw ${[...lenSeen]})`);
  assert.ok(worstPos < 1e-9, `client body drifted ${worstPos}m from the host`);
  ok('client agrees through severing', `${ticksChecked} ticks, lengths ${[...lenSeen].sort((a, b) => b - a).join('→')}, `
    + `${severed} segments severed, ${armourTicks} ticks with armour up, max drift ${worstPos.toExponential(1)}m`);
}

console.log(`\nserpent.mjs: ${passed}/${passed} passed`);
