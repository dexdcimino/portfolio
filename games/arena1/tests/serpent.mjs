// tests/serpent.mjs — MD 18 acceptance (node tests/serpent.mjs).
import { strict as assert } from 'node:assert';
import { createSim, BTN } from '../js/sim/sim.js';
import { createWorld } from '../js/sim/world.js';
import { buildLevel } from '../js/sim/level.js';
import { createEntities } from '../js/sim/entities.js';
import { createPlayerState } from '../js/sim/movement.js';
import {
  spawnSerpent, stepSerpents, stepBolts, headAt, segAt, segRadius,
  SEG_COUNT, SEG_LAG, HEAD_R, DEATH_LEN, TIERS, TIER_NAMES, POP_HP, damageSerpent,
} from '../js/sim/serpent.js';
import { rngFor } from '../js/core/rng.js';
import { SIM_DT, TUNE } from '../js/config.js';

let passed = 0;
const ok = (n, d) => { passed++; console.log(`ok  ${n}${d ? ` — ${d}` : ''}`); };

function rig({ withPlayer = true, playerAt = null } = {}) {
  const world = createWorld();
  const level = buildLevel(world, rngFor('serp', 'level'));
  const ents = createEntities();
  const id = ents.allocWorldId();
  const s = spawnSerpent(ents, level, rngFor('serp', 'serpent', id), id,
    { tier: 't2', world });
  if (withPlayer) {
    const p = createPlayerState(1, playerAt || { x: 0, y: level.summitY + 20, z: 0 });
    ents.players.set(1, p);
  }
  const ctx = (tick) => ({ world, level, tick, events: [], ents, pvp: true, seed: 'serp' });
  // N = this serpent's REAL segment count. SEG_COUNT is now only the buffer
  // size for the largest tier, so tests must read the tier, not the constant.
  return { world, level, ents, s, ctx, N: s.segs };
}

// ── 1. shape: head is unmistakable, segments taper ─────────────────────────
{
  const N = TIERS.t2.segs;
  const radii = Array.from({ length: N }, (_, i) => segRadius(i));
  assert.equal(radii[0], HEAD_R);
  assert.ok(radii[0] > radii[1] * 1.35,
    `head only ${(radii[0] / radii[1]).toFixed(2)}x the first body segment — not unmistakable`);
  for (let i = 2; i < N; i++) {
    assert.ok(radii[i] < radii[i - 1], `segment ${i} is not smaller than ${i - 1}`);
  }
  ok('head unmistakable + taper', `head r ${radii[0]} = ${(radii[0] / radii[1]).toFixed(2)}x seg1; `
    + `tail r ${radii[N - 1].toFixed(3)}, monotonic over ${N} segments`);
}

// ── 2. body undulates and trails the head's real path ──────────────────────
{
  const { s, N } = rig();
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
  const span = (() => { const a = segAt(s, 300, 0), b = segAt(s, 300, N - 1);
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); })();
  ok('body trails the head and undulates', `vertical ${yAmp.toFixed(1)}m, circuit ${xAmp.toFixed(1)}m, `
    + `head-to-tail span ${span.toFixed(1)}m at tick 300`);
}

// ── 3. MD 21: damage ANYWHERE pops spheres off the TAIL, one at a time ─────
{
  const { s, ctx, N } = rig();
  let tick = 0, popped = 0;
  // Aim at the HEAD every time; the tail must still be what falls off.
  for (let k = 0; k < 4; k++) {
    for (let h = 0; h < s.popHp; h++) {
      const c = ctx(tick++);
      damageSerpent(c, s, 1, 1, 0);          // seg 0 = the head
      popped += c.events.filter((e) => e.type === 'serpent_sever').length;
    }
  }
  assert.equal(popped, 4, `expected 4 spheres off in 4x${s.popHp} hits, got ${popped}`);
  assert.equal(s.len, N - 4, `len ${s.len}, expected ${N - 4}`);
  ok('damage anywhere pops the tail', `${4 * s.popHp} hits aimed at the HEAD removed `
    + `${popped} TAIL spheres; len ${N}→${s.len} (popHp ${s.popHp})`);
}

// ── 4. overkill carries into the next sphere ───────────────────────────────
{
  const { s, ctx } = rig();
  const c = ctx(10);
  // one hit shy of a pop, then a rocket: should pop two, not waste the excess
  damageSerpent(c, s, s.popHp - 1, 1, 0);
  assert.equal(c.events.filter((e) => e.type === 'serpent_sever').length, 0, 'popped early');
  const c2 = ctx(11);
  damageSerpent(c2, s, s.popHp * 2, 1, 0);
  const n = c2.events.filter((e) => e.type === 'serpent_sever').length;
  assert.ok(n >= 2, `overkill was discarded: ${s.popHp * 2} damage popped only ${n}`);
  ok('overkill carries', `${s.popHp - 1} then ${s.popHp * 2} damage → ${n} spheres, nothing wasted`);
}

// ── 5. time-to-kill: a fight, not a formality and not a slog ───────────────
{
  const ZAP_CD = 0.11, ROCKET_CD = 0.8, ROCKET_DMG = 3;
  const rows = [];
  for (const tier of TIER_NAMES) {
    const T = TIERS[tier];
    const pops = T.segs - DEATH_LEN;
    const zapHits = pops * T.popHp;
    const zapS = zapHits * ZAP_CD;
    const rockets = pops;                  // one rocket = one sphere, every tier
    const rocketS = rockets * ROCKET_CD;
    assert.ok(zapS > 1.6, `${tier}: ${zapS.toFixed(1)}s on zap is a formality`);
    assert.ok(zapS < 30, `${tier}: ${zapS.toFixed(1)}s on zap is a slog`);
    assert.ok(rocketS < 30, `${tier}: ${rocketS.toFixed(1)}s on rockets is a slog`);
    rows.push(`${tier} ${pops}x${T.popHp}hp → zap ${zapHits} hits ${zapS.toFixed(1)}s | rocket ${rockets} shots ${rocketS.toFixed(1)}s`);
  }
  ok('time-to-kill is a fight', rows.join('  |  '));
}

// ── 5b. armour is fully gone, no dangling references ───────────────────────
{
  const { s, ctx } = rig();
  assert.equal(s.armourUntil, undefined, 'armourUntil still on the serpent record');
  assert.equal(s.hp, undefined, 'per-segment hp array still on the serpent record');
  const c = ctx(5);
  damageSerpent(c, s, 1, 1, 0);
  assert.ok(!c.events.some((e) => e.type === 'serpent_blocked'), 'serpent_blocked still emitted');
  const snapSim = createSim('armour-gone', { pvp: true });
  snapSim.addPlayer();
  snapSim.step(new Map());
  const wire = snapSim.snapshot().serpents[0];
  assert.equal(wire.armour, undefined, 'armour mask still on the wire');
  assert.ok(wire.tailHp !== undefined, 'tailHp missing from the wire');
  ok('armour fully removed', 'no armourUntil, no hp[], no serpent_blocked, no armour mask on the wire');
}

// ── 6. down to the last few segments it dies ───────────────────────────────
{
  const { s, ctx } = rig();
  const c = ctx(50);
  
  damageSerpent(c, s, 9999, 1, 0);
  assert.equal(s.alive, false, `still alive at len ${s.len}`);
  assert.ok(c.events.some((e) => e.type === 'serpent_death'), 'no serpent_death event');
  ok('dies at the last few segments', `cut to len ${s.len} (DEATH_LEN ${DEATH_LEN}) → death event`);
}

// ── 7. turret: dodgeable, no tunnelling, despawns on a miss ────────────────
{
  const { s, ents, ctx } = rig({ playerAt: { x: 20, y: 0, z: 0 } });
  // Park the player right beside the orbit. The old fixed summit+14 assumed the
  // MD 18 altitude; tiers put the orbit wherever the clear-air scan found room,
  // so this reads it off the serpent instead.
  const p = ents.players.get(1);
  p.pos = { x: s.R, y: s.cy, z: 0 };
  let fired = 0, tick = 0;
  for (; tick < 600 && fired === 0; tick++) {
    const c = ctx(tick);
    stepSerpents(c); stepBolts(c);
    fired += c.events.filter((e) => e.type === 'serpent_fire').length;
  }
  assert.ok(fired > 0, 'turret never fired at a player in range');
  const bolt = [...ents.bolts.values()][0];
  assert.ok(bolt, 'fire event but no bolt entity');
  /* MD 22 raised bolt speed, so "under 25 m/s" is no longer the property that
     matters — DODGEABLE WHILE STRAFING is. At a typical 40m engagement the
     bolt's flight time must let a player moving at WALK clear their own hit
     radius (capsule 0.4 + bolt 0.35) with margin. Derived, so a future speed
     bump fails here instead of silently becoming unavoidable. */
  const speed = Math.hypot(bolt.vel.x, bolt.vel.y, bolt.vel.z);
  const flight = 40 / speed;
  const sidestep = TUNE.WALK * flight;
  assert.ok(sidestep > (0.4 + 0.35) * 2.5,
    `bolt at ${speed.toFixed(0)} m/s gives ${flight.toFixed(2)}s — a strafing player only clears `
    + `${sidestep.toFixed(1)}m, not enough to dodge`);
  // it must despawn rather than leak
  let alive = true;
  for (let t = tick; t < tick + 400 && alive; t++) {
    const c = ctx(t); stepSerpents(c); stepBolts(c);
    alive = ents.bolts.has(bolt.id);
  }
  assert.ok(!alive, 'bolt never despawned — a miss leaks forever');
  ok('turret bolts', `fired at tick ${tick}, speed ${speed.toFixed(0)} m/s → ${flight.toFixed(2)}s over 40m; `
    + `a strafing player clears ${sidestep.toFixed(1)}m vs a 0.75m hit radius; despawns on a miss`);
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
/* Host and wire must be the SAME serpent, so both come out of one sim: `host`
   is the live record, `wire` is the path object the snapshot actually ships.
   Building `wire` from the snapshot rather than hand-listing fields is the
   point — a parameter added to headAt() and forgotten on the wire fails here
   instead of silently reconstructing NaN in a real client, which is exactly
   what MD 21's `sw` did until this caught it. */
{
  const sim = createSim('serp-recon', { pvp: true });
  sim.addPlayer();
  sim.step(new Map());
  const host = [...sim.ents.serpents.values()][0];
  const wire = sim.snapshot().serpents.find((x) => x.id === host.id).path;
  for (const k of Object.keys(wire)) {
    assert.ok(Number.isFinite(wire[k]), `path.${k} is not finite`);
  }
  let worst = 0;
  for (const tick of [0, 91, 455, 1200]) {
    for (let i = 0; i < host.len; i++) {
      const h = segAt(host, tick, i);
      const c = segAt(wire, tick, i);
      worst = Math.max(worst, Math.hypot(h.x - c.x, h.y - c.y, h.z - c.z));
    }
  }
  assert.ok(worst < 1e-9, `client reconstruction drifted ${worst}m from the host`);
  ok('client reconstructs the body from path + tick',
    `${Object.keys(wire).length} path params on the wire, all finite; max divergence `
    + `${worst.toExponential(1)}m over 4 ticks x ${host.len} segments`);
}

// ── 11. the orbit is clear of all level geometry ───────────────────────────
// The closed-form path cannot dodge anything, so this is the assertion that
// makes that safe rather than lucky.
{
  let bossClear = Infinity, overlaps = 0, worstSeed = null;
  for (const seed of ['serp', 'p2-1', 'p2-2', 'p2-3', 12345, 999]) {
    const sim = createSim(seed, { pvp: true });
    const boss = [...sim.ents.serpents.values()].find((x) => x.tier === 'giant');
    for (let t = 0; t < 900; t += 3) {
      for (let i = 0; i < boss.segs; i++) {
        const c = segAt(boss, t, i);
        const r = segRadius(i, boss.scale) + 0.6;
        if (sim.world.overlapCapsule(c, r, r).length) { overlaps++; worstSeed = seed; }
      }
    }
    let lowest = Infinity;
    for (let t = 0; t < 900; t++) lowest = Math.min(lowest, headAt(boss, t).y);
    bossClear = Math.min(bossClear, lowest - sim.level.summitY);
  }
  assert.equal(overlaps, 0, `boss path intersects level geometry (seed ${worstSeed})`);
  assert.ok(bossClear > 0, `boss orbit dips ${bossClear.toFixed(1)}m below the summit`);
  ok('boss orbit clear and above the summit',
    `lowest point ${bossClear.toFixed(1)}m above the summit; 6 seeds x 300 samples, zero overlaps`);
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
  const hostId = host0.id;
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
    severed += sim.snapshot().events.filter((e) => e.type === 'serpent_sever').length;
    /* Match by ID, not by index. There are three serpents and the snapshot
       filters out dead ones, so the two arrays fall out of step the moment one
       dies — which read as "len disagrees" when nothing was actually wrong. */
    const host = [...sim.ents.serpents.values()].find((x) => x.id === hostId);
    const wire = snap.serpents.find((x) => x.id === hostId);
    if (!wire || !host || !host.alive) continue;
    assert.equal(wire.len, host.len, `len disagrees at tick ${t}`);
    // MD 21 removed armour; tailHp is the per-tick state that now has to agree.
    assert.equal(wire.tailHp, host.tailHp, `tailHp disagrees at tick ${t}`);
    if (wire.tailHp < host.popHp) armourTicks++;   // ticks with a partly-damaged sphere
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
    + `${severed} spheres popped, ${armourTicks} ticks mid-sphere, max drift ${worstPos.toExponential(1)}m`);
}

// ── 13. MD 22: five tiers, distinct, all in clear air on every seed ───────
// The sweep matters more than it used to: the space is 3x taller, there are
// five orbits instead of three, and w now depends on the radius the scan
// picks — so the path being sampled is the path actually flown.
{
  const seeds = ['serp', 'p2-1', 'p2-2', 'p2-3', 'hex-a', 12345, 999];
  let samples = 0, overlaps = 0;
  const shapes = new Map();
  for (const seed of seeds) {
    const sim = createSim(seed, { pvp: true });
    const list = [...sim.ents.serpents.values()];
    assert.equal(list.length, TIER_NAMES.length, `seed ${seed}: expected ${TIER_NAMES.length} serpents, got ${list.length}`);
    const tiers = list.map((x) => x.tier).sort();
    assert.deepEqual(tiers, [...TIER_NAMES].sort(), `seed ${seed}: tiers ${tiers}`);
    // distinct altitudes, t1 < t2 < t3 < t4 < giant
    const byTier = Object.fromEntries(list.map((x) => [x.tier, x]));
    assert.ok(TIER_NAMES.every((t,i)=>i===0||byTier[TIER_NAMES[i-1]].cy < byTier[t].cy),
      `seed ${seed}: altitudes not ordered (${TIER_NAMES.map(t=>byTier[t].cy.toFixed(0)).join('/')})`);
    for (const x of list) {
      assert.ok(x.placedClear, `seed ${seed}: ${x.tier} fell back to the raised orbit — no clear air found`);
      shapes.set(x.tier, { segs: x.segs, scale: x.scale, popHp: x.popHp, boltDmg: x.boltDmg,
        cd: x.boltCd, cy: x.cy, R: x.R, speed: Math.abs(x.w) * x.R });
      // SAMPLE the orbit against real geometry, the MD 18 way — do not trust
      // the placement search, re-prove it here at a finer step.
      /* MD 24 item 2 tightened the visual spacing, which changes the swept
         volume: the renderer now draws a sphere every 1/FILL of a segment, so
         this samples at the same resolution. Strictly stricter than before —
         every old integer sample is still taken, plus the FILL-1 between each
         pair that the old sweep stepped straight over.
         `x.w` is read off the live serpent, which is the same w findClearOrbit
         validated (MD 22 fixed that: the scan used to test a provisional w and
         pass a curve the serpent never flew). */
      const period = Math.abs(2 * Math.PI / x.w) / SIM_DT;
      const FILL = 4;   // must match render/serpent.js
      const subs = (x.segs - 1) * FILL;
      for (let n = 0; n < 160; n++) {
        const tick = (n / 160) * period;
        for (let j = 0; j <= subs; j++) {
          const k = j / FILL;
          const c = segAt(x, tick, k);
          const r = segRadius(k, x.scale);
          samples++;
          if (sim.world.overlapCapsule(c, r, r).length) overlaps++;
        }
      }
    }
  }
  assert.equal(overlaps, 0, `${overlaps} of ${samples} orbit samples intersect geometry`);
  // visibly different at a glance
  assert.ok(TIER_NAMES.every((t,i)=>i===0||shapes.get(TIER_NAMES[i-1]).segs < shapes.get(t).segs));
  assert.ok(shapes.get('giant').scale > shapes.get('t1').scale);
  ok('five tiers, all in clear air', `${seeds.length} seeds x ${TIER_NAMES.length} tiers x 160 samples = `
    + `${samples} segment probes, zero overlaps; `
    + TIER_NAMES.map((t) => {
        const x = shapes.get(t);
        return `${t} y${x.cy.toFixed(0)} ${x.segs}seg x${x.scale} ${x.speed.toFixed(1)}m/s`;
      }).join(', '));
}

// ── 15. each tier respawns after its own delay, deterministically ──────────
{
  const runOnce = () => {
    const sim = createSim('serp-respawn', { pvp: true });
    const pid = sim.addPlayer();
    const log = [];
    const target = [...sim.ents.serpents.values()].find((x) => x.tier === 't1');
    // kill it outright at tick 10
    for (let t = 0; t < target.respawnTicks + 200; t++) {
      if (t === 10) {
        const c = { world: sim.world, level: null, tick: t, events: [], ents: sim.ents, pvp: true, seed: 'serp-respawn' };
        damageSerpent(c, target, 99999, pid);
      }
      sim.step(new Map([[pid, { tick: t, playerId: pid, move: { x: 0, z: 0 }, yaw: 0, pitch: 0, buttons: 0 }]]));
      for (const e of sim.snapshot().events) {
        if (e.type === 'serpent_respawn' || e.type === 'serpent_death') log.push(`${t}:${e.type}:${e.tier}`);
      }
    }
    return log;
  };
  const a = runOnce(), b = runOnce();
  assert.deepEqual(a, b, 'respawn timing is not deterministic');
  assert.ok(a.some((x) => x.includes('serpent_respawn')), `no respawn happened: ${a.join(',')}`);
  const delay = Number(a.find((x) => x.includes('respawn')).split(':')[0]) - 10;
  assert.ok(Math.abs(delay - TIERS.t1.respawnTicks) <= 2,
    `low tier respawned after ${delay} ticks, expected ${TIERS.t1.respawnTicks}`);
  ok('tiers respawn on their own delay', `low died t10, back at t${10 + delay} (${delay} ticks = ${(delay / 60).toFixed(0)}s); identical across two runs`);
}

// ── 16. player identity is independent of serpents (MD 18 fix, re-proved) ──
/* The claim is that serpent and bolt ids come from a SEPARATE counter, so no
   number of them can renumber a player and move its rngFor(seed,'spawn',id)
   position. Comparing against enemies:false would not test that — it removes
   the enemies too, and the enemies are what actually move the id (39 vs 18).
   So this tests the invariant directly instead. */
{
  const sim = createSim('idcheck', { pvp: true });
  const a = sim.addPlayer();
  const pa = sim.getPlayer(a);

  // every serpent id sits in the world range, none in the shared one
  for (const x of sim.ents.serpents.values()) {
    assert.ok(x.id >= 100000, `serpent id ${x.id} came from the shared counter`);
  }
  // 900 ticks of three turrets firing allocates a lot of bolts
  for (let t = 0; t < 900; t++) {
    sim.step(new Map([[a, { tick: t, playerId: a, move: { x: 0, z: 0 }, yaw: 0, pitch: 0, buttons: 0 }]]));
  }
  let bolts = 0;
  for (const b of sim.ents.bolts.values()) { bolts++; assert.ok(b.id >= 100000, `bolt id ${b.id} came from the shared counter`); }

  // the next player id must be exactly one past the first, unchanged by any of it
  const b2 = sim.addPlayer();
  assert.equal(b2, a + 1, `next player id ${b2} is not ${a + 1} — world ids leaked into the shared counter`);
  // and the first player's spawn never moved
  const after = sim.getPlayer(a);
  assert.deepEqual(after.spawn, pa.spawn, 'player spawn moved during the run');
  ok('player identity independent of serpents', `3 serpents + ${bolts} live bolts, all ids >= 100000; `
    + `player id ${a} → next ${b2}; spawn (${pa.spawn.x.toFixed(2)}, ${pa.spawn.z.toFixed(2)}) unchanged`);
}

// ── 17. MD 22 item 6: the ground floor is a safe deck ─────────────────────
/* The arena is a climb now, so the bottom has to be somewhere you can stand,
   pick a route and gear up without being sniped from 500m. This is a whole-sim
   assertion rather than band arithmetic: run every tier with a player parked on
   the hex floor, in the open, long enough that each would have cleared its
   cooldown a dozen times, and require that not one bolt is ever fired. */
{
  // enemies:true, because the same flag gates the serpents — but the ground
  // blobs are cleared, so a bolt is the ONLY thing left that could take hp off
  // a player standing still on the floor. That makes the hp assertion mean
  // what it says instead of measuring blob pathing.
  const sim = createSim('serp-floor', { pvp: true });
  for (const e of sim.ents.enemies.values()) e.alive = false;
  const id = sim.addPlayer();
  const p = sim.getPlayer(id);
  const list = [...sim.ents.serpents.values()];
  const TICKS = Math.max(...list.map((x) => x.boltCd)) * 12;

  let fired = 0, everBolt = 0;
  for (let t = 0; t < TICKS; t++) {
    p.pos.y = 1.6; p.vel.x = 0; p.vel.y = 0; p.vel.z = 0;
    sim.step([{ id, cmd: { tick: t, yaw: 0, pitch: 0, buttons: 0, move: { x: 0, z: 0 } } }]);
    fired += sim.snapshot().events.filter((e) => e.type === 'serpent_fire').length;
    everBolt += sim.ents.bolts.size;
  }
  assert.equal(fired, 0, `${fired} bolts fired at a player standing on the floor`);
  assert.equal(everBolt, 0, 'a bolt existed while the only player was on the floor');
  assert.equal(p.hp, 100, `floor player lost ${100 - p.hp} hp`);

  // And prove it is the ALTITUDE GATE doing it, not distance or luck: lift the
  // same player into the lowest tier's window and it must open fire.
  const t1 = list.find((x) => x.tier === 't1');
  const mid = (t1.fire.yMin + t1.fire.yMax) / 2;
  let firedUp = 0;
  for (let t = 0; t < t1.boltCd * 4; t++) {
    p.pos.y = mid; p.pos.x = 0; p.pos.z = 0; p.vel.y = 0;
    sim.step([{ id, cmd: { tick: TICKS + t, yaw: 0, pitch: 0, buttons: 0, move: { x: 0, z: 0 } } }]);
    firedUp += sim.snapshot().events.filter((e) => e.type === 'serpent_fire').length;
  }
  assert.ok(firedUp > 0, 'nothing fired inside the band either — the gate is not what is silencing them');
  ok('the floor is a safe deck, and the gate is why', `${TICKS} ticks at y1.6: 0 shots from all `
    + `${list.length} tiers (lowest window opens at y${t1.fire.yMin}), 100 hp intact; `
    + `the same player at y${mid.toFixed(0)} drew ${firedUp} shots`);
}

// ── 18. MD 24: the destruction events carry what the FX needs ─────────────
/* serpent_sever and serpent_death have been in the wire vocabulary since MD 18
   with nothing drawing them — spheres popped in silence and a serpent died by
   ceasing to be rendered. MD 24 wires them to an explosion chain, and the
   chain is built from the SAME closed form the renderer draws with, so this
   asserts the data that feeds it rather than the pixels: a finite point on
   every event, a reconstructible body at the death tick, and the tier `scale`
   the blast size is derived from actually present on the wire.
   NOT covered here: that Babylon draws it. Verified only as far as node can
   see — no page errors and correct inputs. */
{
  const sim = createSim('serp-fx', { pvp: true });
  const list = [...sim.ents.serpents.values()];
  const giant = list.find((x) => x.tier === 'giant');
  const wire = sim.snapshot().serpents.find((x) => x.id === giant.id);
  assert.ok(Number.isFinite(wire.scale) && wire.scale > 1,
    `tier scale missing from the wire (${wire.scale}) — the renderer sized every tier at 1.0 before MD 24`);
  assert.ok(Number.isInteger(wire.segs) && wire.segs === giant.segs, 'segs missing from the wire');

  const ctx = { world: sim.world, level: null, tick: 500, events: [], ents: sim.ents, pvp: true, seed: 'serp-fx' };
  let severs = 0, death = null;
  for (let i = 0; i < 400 && giant.alive; i++) damageSerpent(ctx, giant, giant.popHp, 1);
  for (const e of ctx.events) {
    if (e.type === 'serpent_sever') {
      severs++;
      assert.ok(Number.isFinite(e.point?.x) && Number.isFinite(e.point?.y) && Number.isFinite(e.point?.z),
        `serpent_sever ${severs} has no finite point — the pop would draw at the origin`);
    }
    if (e.type === 'serpent_death') death = e;
  }
  assert.ok(death, 'no serpent_death emitted');
  assert.ok(Number.isFinite(death.point?.x), 'serpent_death has no finite point');
  // the body chain the death FX walks down
  const chain = [];
  for (let i = 0; i < wire.len; i++) chain.push(segAt(wire.path, 500, i));
  assert.ok(chain.length > 1 && chain.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z)),
    'the death blast chain is not reconstructible from path + tick');
  ok('destruction events carry what the FX needs', `${severs} severs each with a finite point, `
    + `death at (${death.point.x.toFixed(0)}, ${death.point.y.toFixed(0)}); `
    + `${chain.length}-point blast chain rebuilt from path+tick; wire carries scale ${wire.scale} and segs ${wire.segs}`);
}

console.log(`\nserpent.mjs: ${passed}/${passed} passed`);
