// tests/combat.mjs — Phase 5 acceptance (node tests/combat.mjs):
//   · combat determinism: 600 ticks fighting live enemies, byte-identical
//   · the pvp gate: two players in one loopback sim damage each other with
//     pvp:true and cannot with pvp:false (the single-branch shared path)
//   · unit checks: grapple yank, grapple cell reel + pickup, touch pickup,
//     blob pop + touch damage + knockback
import { strict as assert } from 'node:assert';
import { createWorld } from '../js/sim/world.js';
import { buildLevel } from '../js/sim/level.js';
import { createPlayerState, stepPlayer, BTN } from '../js/sim/movement.js';
import { stepEnemies } from '../js/sim/enemies.js';
import { stepCombat, stepRockets, SPLASH_RADIUS } from '../js/sim/combat.js';
import { HEX_APOTHEM } from '../js/sim/level.js';
import { createSim } from '../js/sim/sim.js';
import { rngFor } from '../js/core/rng.js';

let passed = 0;
const ok = (name, detail) => { passed++; console.log(`ok  ${name}${detail ? ` — ${detail}` : ''}`); };
const cmd = (move, yaw, pitch, buttons) => ({ move, yaw, pitch, buttons });

// aim yaw/pitch from an eye point at a target point (matches the sim's dir math)
function aimAt(eye, tgt) {
  const dx = tgt.x - eye.x, dy = tgt.y - eye.y, dz = tgt.z - eye.z;
  return { yaw: Math.atan2(dx, dz), pitch: -Math.atan2(dy, Math.hypot(dx, dz)) };
}

// ── 1. combat determinism: 600 ticks of real fighting, byte-identical ──────
{
  const run = () => {
    const sim = createSim('combat-det');
    const id = sim.addPlayer();
    let last = null, hits = 0, kills = 0;
    const snaps = [];
    for (let t = 0; t < 600; t++) {
      let yaw = Math.PI, pitch = 0;
      if (last) {
        // deterministic aimbot: track the nearest live enemy from the last
        // snapshot — a pure function of sim output
        const me = last.players.find((p) => p.id === id);
        let best = null, bestD = Infinity;
        for (const e of last.enemies) {
          const d = Math.hypot(e.pos.x - me.pos.x, e.pos.y - me.pos.y, e.pos.z - me.pos.z);
          if (d < bestD) { bestD = d; best = e; }
        }
        if (best) {
          const a = aimAt({ x: me.pos.x, y: me.pos.y + 0.55, z: me.pos.z }, best.pos);
          yaw = a.yaw; pitch = a.pitch;
        }
      }
      // walk the aim line too: closes range past whatever crystals block the
      // long shots, and the blobs converge to meet it
      sim.step(new Map([[id, cmd({ x: 0, z: 1 }, yaw, pitch, BTN.FIRE)]]));
      last = sim.snapshot();
      for (const ev of last.events) {
        if (ev.type === 'hit') hits++;
        if (ev.type === 'kill') kills++;
      }
      snaps.push(JSON.stringify(last));
    }
    return { out: snaps.join('\n'), hits, kills, enemies: last.enemies.length };
  };
  const a = run(), b = run();
  assert.equal(a.out, b.out, 'combat runs diverged');
  assert.ok(a.hits > 10, `combat never connected: ${a.hits} hits`);
  assert.ok(a.kills > 0, `no kills in 600 ticks (${a.hits} hits)`);
  ok('combat determinism', `600 ticks vs live enemies byte-identical; ${a.hits} hits, ${a.kills} kills`);
}

// ── 2. the pvp gate: same path, one branch ─────────────────────────────────
{
  const duel = (pvp) => {
    const sim = createSim('pvp-duel', { pvp, enemies: false });
    const a = sim.addPlayer(), b = sim.addPlayer();
    let last = null;
    const dmg = [];
    for (let t = 0; t < 180; t++) {
      let yaw = 0, pitch = 0;
      if (last) {
        const pa = last.players.find((p) => p.id === a);
        const pb = last.players.find((p) => p.id === b);
        const aim = aimAt({ x: pa.pos.x, y: pa.pos.y + 0.55, z: pa.pos.z }, pb.pos);
        yaw = aim.yaw; pitch = aim.pitch;
      }
      sim.step(new Map([[a, cmd({ x: 0, z: 0 }, yaw, pitch, BTN.FIRE)]]));
      last = sim.snapshot();
      for (const ev of last.events) if (ev.type === 'hit' && ev.target === b) dmg.push(ev.dmg);
    }
    const pb = last.players.find((p) => p.id === b);
    return { hp: pb.hp, deaths: pb.deaths, hits: dmg.length, dmg };
  };
  const on = duel(true);
  assert.ok(on.hits > 5, `pvp on: only ${on.hits} hits landed`);
  assert.ok(on.deaths > 0 || on.hp < 100, `pvp on: no damage (hp ${on.hp}, deaths ${on.deaths})`);
  assert.ok(on.dmg.every((d) => d === 12), 'pvp on: wrong dmg in hit events');
  const off = duel(false);
  assert.ok(off.hits > 5, `pvp off: only ${off.hits} hits resolved`);
  assert.equal(off.hp, 100, `pvp off: damage leaked (hp ${off.hp})`);
  assert.equal(off.deaths, 0, 'pvp off: a death leaked');
  assert.ok(off.dmg.every((d) => d === 0), 'pvp off: hit events should carry dmg 0');
  ok('pvp gate', `on: ${on.hits} hits → hp ${on.hp}, deaths ${on.deaths}; off: ${off.hits} hits → hp 100, dmg 0`);
}

// ── unit harness: flat world, fabricated entities ──────────────────────────
function flatUnit() {
  const world = createWorld();
  world.addAabb({ x: -60, y: -1, z: -60 }, { x: 60, y: 0, z: 60 });
  const level = { platforms: [], pads: [], rings: [], platSpawnPoints: [], spikeSpots: [], cellSpots: [] };
  let nextId = 1000;
  const ents = { players: new Map(), enemies: new Map(), cells: new Map(), rockets: new Map(), allocId: () => nextId++ };
  return { world, level, ents, tick: 0 };
}
function unitStep(u, p, c) {
  const events = [];
  const ctx = { world: u.world, level: u.level, tick: u.tick, events, ents: u.ents };
  if (p) stepPlayer(ctx, p, c);
  stepEnemies(ctx);
  u.tick++;
  return events;
}
const mkBlob = (id, pos) => ({
  id, kind: 'blob', rng: rngFor('unit', 'enemy', id),
  pos: { ...pos }, vx: 0, vy: 0, vz: 0, hp: 3, alive: true,
  respawnT: 0, yanked: 0, hitCd: 0, hop: 1,
});

// ── 3. grapple yank: enemy reeled in, released with a pop-up ───────────────
{
  const u = flatUnit();
  const p = createPlayerState(1, { x: 0, y: 0.92, z: 0 });
  u.ents.players.set(1, p);
  const e = mkBlob(9, { x: 0, y: 0.65, z: 8 });
  u.ents.enemies.set(9, e);
  const aim = aimAt({ x: 0, y: 1.47, z: 0 }, e.pos);
  unitStep(u, p, cmd({ x: 0, z: 0 }, aim.yaw, aim.pitch, BTN.GRAPPLE));
  assert.equal(p.grapple?.mode, 'yank', `latch mode ${p.grapple?.mode}`);
  assert.ok(e.yanked > 0 && e.vz < -15, `yank vel vz ${e.vz.toFixed(1)}`);
  let releasedAt = null;
  for (let t = 0; t < 40 && releasedAt === null; t++) {
    unitStep(u, p, cmd({ x: 0, z: 0 }, aim.yaw, aim.pitch, BTN.GRAPPLE));
    if (!p.grapple) releasedAt = Math.hypot(e.pos.x - p.pos.x, e.pos.y - p.pos.y, e.pos.z - p.pos.z);
  }
  assert.ok(releasedAt !== null && releasedAt < 3, `never reeled close (released at ${releasedAt})`);
  // release sets vy = max(vy, 3); the same tick's blob gravity (G·0.55·dt)
  // then shaves 0.275 off — the prototype's frame order does the same.
  assert.ok(e.vy >= 2.5, `release pop-up vy ${e.vy.toFixed(1)}`);
  ok('grapple yank', `reeled 8m → released at ${releasedAt.toFixed(2)}m, pop-up vy ${e.vy.toFixed(1)}`);
}

// ── 4. grapple cell reel + pickup; touch pickup ────────────────────────────
{
  const u = flatUnit();
  const p = createPlayerState(1, { x: 0, y: 0.92, z: 0 });
  u.ents.players.set(1, p);
  u.ents.cells.set(5, { id: 5, pos: { x: 0, y: 1.4, z: 9 }, base: { x: 0, y: 1.4, z: 9 }, taken: false, pulled: false });
  const aim = aimAt({ x: 0, y: 1.47, z: 0 }, { x: 0, y: 1.4, z: 9 });
  let pickup = null;
  for (let t = 0; t < 40 && !pickup; t++) {
    const ev = unitStep(u, p, cmd({ x: 0, z: 0 }, aim.yaw, aim.pitch, BTN.GRAPPLE));
    pickup = ev.find((e) => e.type === 'pickup') || null;
    if (t === 0) assert.equal(p.grapple?.mode, 'cell', `latch mode ${p.grapple?.mode}`);
  }
  assert.ok(pickup, 'reel never collected the cell');
  assert.equal(p.fuelMax, 120, `fuelMax ${p.fuelMax}`);
  assert.equal(p.fuel, 120, 'tank not refilled');
  assert.equal(p.cellsGot, 1);
  assert.ok(u.ents.cells.get(5).taken, 'cell not taken');

  // touch pickup: second cell right next to a fresh player
  const p2 = createPlayerState(2, { x: 20, y: 0.92, z: 0 });
  u.ents.players.set(2, p2);
  u.ents.cells.set(6, { id: 6, pos: { x: 21, y: 1.2, z: 0 }, base: { x: 21, y: 1.2, z: 0 }, taken: false, pulled: false });
  const ev2 = unitStep(u, p2, cmd({ x: 0, z: 0 }, 0, 0, 0));
  assert.ok(ev2.some((e) => e.type === 'pickup' && e.playerId === 2), 'touch pickup missed');
  assert.equal(p2.fuelMax, 120);
  ok('cell reel + touch pickup', 'reel-in collected (tank 100→120), touch collected');
}

// ── 5. blob pop: touch damage + knockback ──────────────────────────────────
{
  const u = flatUnit();
  const p = createPlayerState(1, { x: 0, y: 0.92, z: 0 });
  u.ents.players.set(1, p);
  const e = mkBlob(9, { x: 1.1, y: 0.65, z: 0 });
  u.ents.enemies.set(9, e);
  const ev = unitStep(u, null, null);
  assert.ok(ev.some((x) => x.type === 'kill' && x.target === 9 && x.by === null), 'blob did not pop');
  assert.ok(!e.alive, 'blob still alive');
  assert.equal(p.hp, 80, `touch damage hp ${p.hp}`);
  assert.ok(p.vel.y >= 6 && Math.abs(p.vel.x) > 5, `knockback vel (${p.vel.x.toFixed(1)}, ${p.vel.y.toFixed(1)})`);
  ok('blob pop on touch', `hp 100→${p.hp}, knockback (${p.vel.x.toFixed(1)}, ${p.vel.y.toFixed(1)}, ${p.vel.z.toFixed(1)})`);
}

// ── 6. player grapple: pull TOWARD a player, moving anchor, never a yank ───
// (Supersedes "players are never grapple targets" — see ARENA1_STEPS Phase 3
// note. The capsule is resolved for real now, not geometry behind the target.)
{
  const sim = createSim('pgrapple', { enemies: false });
  const a = sim.addPlayer(), b = sim.addPlayer();
  sim.getPlayer(a).pos = { x: 0, y: 0.92, z: 20 };
  sim.getPlayer(b).pos = { x: 0, y: 0.92, z: 10 };
  const aim = { yaw: Math.PI, pitch: 0.03 }; // straight down the z lane at B
  const idle = { move: { x: 0, z: 0 }, yaw: aim.yaw, pitch: aim.pitch };
  // B strafes (oscillating, so it stays on open ground) — the anchor must
  // MOVE; A holds the grapple
  let released = null, minDist = Infinity, bMoved = 0;
  const b0 = { ...sim.getPlayer(b).pos };
  let maxOsc = 0;
  for (let t = 0; t < 240; t++) {
    sim.step(new Map([
      [a, { tick: t, playerId: a, ...idle, buttons: BTN.GRAPPLE }],
      [b, { tick: t, playerId: b, move: { x: ((t / 30) | 0) % 2 ? 1 : -1, z: 0 }, yaw: Math.PI, pitch: 0, buttons: 0 }],
    ]));
    const pa = sim.getPlayer(a), pb = sim.getPlayer(b);
    if (t === 0) {
      assert.equal(pa.grapple?.mode, 'player', `latch mode ${pa.grapple?.mode}`);
      assert.equal(pa.grapple?.targetId, b, 'latched the wrong body');
    }
    const d = Math.hypot(pb.pos.x - pa.pos.x, pb.pos.y - pa.pos.y, pb.pos.z - pa.pos.z);
    minDist = Math.min(minDist, d);
    bMoved = Math.hypot(pb.pos.x - b0.x, pb.pos.z - b0.z);
    maxOsc = Math.max(maxOsc, bMoved);
    if (released === null && !pa.grapple) released = { t, d };
  }
  assert.ok(released && released.d < 3, `never reeled in (min dist ${minDist.toFixed(2)})`);
  assert.ok(maxOsc > 2, `target should keep its own agency (peak strafe ${maxOsc.toFixed(1)}m)`);
  const pb = sim.getPlayer(b);
  assert.ok(Math.abs(pb.vel.y) < 12 && pb.hp === 100, 'target must never be yanked or hurt by a grapple');
  ok('player grapple', `latched mode=player, chased a strafing target to ${released.d.toFixed(2)}m `
    + `(target strafed ${maxOsc.toFixed(1)}m under its own input), released clean`);
}

// ═══ MD 11 — rocket launcher ═══════════════════════════════════════════════
const aim = (from, to) => {
  const dx = to.x - from.x, dy = to.y - (from.y + 0.55), dz = to.z - from.z;
  return { yaw: Math.atan2(dx, dz), pitch: -Math.atan2(dy, Math.hypot(dx, dz)) };
};
const idleAt = (a, w = 1) => ({ move: { x: 0, z: 0 }, yaw: a.yaw, pitch: a.pitch, buttons: 0, weapon: w });

// ── 7. rocket determinism: 600 ticks of fire/splash/self-damage ────────────
{
  const run = () => {
    const sim = createSim('rocket-det');
    const id = sim.addPlayer();
    const snaps = [];
    for (let t = 0; t < 600; t++) {
      const weapon = t > 80 ? 1 : 0; // switch mid-run
      const pitch = t % 200 < 100 ? 0.9 : -0.3; // alternate feet blasts and lobs
      sim.step(new Map([[id, {
        tick: t, playerId: id, move: { x: 0, z: t % 3 ? 1 : 0 },
        yaw: Math.PI + t * 0.01, pitch, buttons: BTN.FIRE, weapon,
      }]]));
      snaps.push(JSON.stringify(sim.snapshot()));
    }
    return snaps.join('\n');
  };
  const a = run(), b = run();
  assert.equal(a, b, 'rocket runs diverged');
  assert.ok(a.includes('"rockets":[{'), 'no rocket ever appeared in a snapshot');
  assert.ok(a.includes('"type":"explode"'), 'no explosion ever happened');
  ok('rocket determinism', '600 ticks with switching, feet blasts and lobs — byte-identical');
}

// ── 8. no tunneling: point-blank wall at full rocket speed ─────────────────
{
  const sim = createSim('rocket-wall', { enemies: false });
  const id = sim.addPlayer();
  const p = sim.getPlayer(id);
  // MD 17: the wall face is now the hex apothem less half the wall thickness.
  // Derived, so the "1.5m from the face" setup stays true wherever the wall is.
  const FACE = HEX_APOTHEM - 1.5;
  p.pos = { x: 0, y: 0.92, z: FACE - 1.5 }; p.spawn = { ...p.pos };
  const a = { yaw: 0, pitch: 0 }; // straight at the wall
  let exploded = null;
  for (let t = 0; t < 10 && !exploded; t++) {
    sim.step(new Map([[id, { tick: t, playerId: id, ...idleAt(a), buttons: t === 0 ? BTN.FIRE : 0 }]]));
    const s = sim.snapshot();
    exploded = s.events.find((e) => e.type === 'explode') || null;
    for (const r of s.rockets) {
      assert.ok(r.pos.z < FACE + 0.01, `rocket tunneled to z=${r.pos.z} (face ${FACE.toFixed(2)})`);
    }
  }
  assert.ok(exploded, 'never exploded on the wall');
  assert.ok(Math.abs(exploded.point.z - FACE) < 0.3, `impact at z=${exploded.point.z.toFixed(2)} (wall face ${FACE.toFixed(2)})`);
  ok('no tunneling at point blank', `impact z ${exploded.point.z.toFixed(2)} on the hex wall face, swept every tick`);
}

// ── 9. splash: damages at radius edge, not beyond ──────────────────────────
{
  const u = flatUnit();
  u.world.addAabb({ x: -20, y: 0, z: 10, }, { x: 20, y: 12, z: 12 }); // impact wall at z=10
  const p = createPlayerState(1, { x: 0, y: 0.92, z: 0 });
  p.weapon = 1;
  u.ents.players.set(1, p);
  const mkB = (bid, pos) => ({
    id: bid, kind: 'blob', rng: rngFor('unit', 'enemy', bid),
    pos, vx: 0, vy: 0, vz: 0, hp: 3, alive: true, respawnT: 0, yanked: 0, hitCd: 0, hop: 9,
  });
  // impact lands at ≈(0, 1.47, 10); distances measured from there. Placed as
  // FRACTIONS of SPLASH_RADIUS, not at literal metres — MD 15 item 3 moved the
  // radius from 4.5 to 11 and the old hardcoded 4.0/5.6 pair silently became
  // "both inside". Derived, this asserts the edge wherever the edge is.
  const rIn = SPLASH_RADIUS * 0.36;
  const rOut = SPLASH_RADIUS * 1.25;
  const inside = mkB(901, { x: rIn, y: 1.4, z: 9.6 });
  const outside = mkB(902, { x: rOut, y: 1.4, z: 9.6 });
  u.ents.enemies.set(901, inside);
  u.ents.enemies.set(902, outside);
  const ctx = () => ({ world: u.world, level: u.level, tick: u.tick, events: [], ents: u.ents, pvp: true });
  const c0 = ctx();
  stepCombat(c0, p, BTN.FIRE); // fires the rocket (weapon 1)
  assert.equal(u.ents.rockets.size, 1, 'rocket did not spawn');
  let exploded = false;
  for (let t = 0; t < 30 && !exploded; t++) {
    const c = ctx();
    stepRockets(c);
    u.tick++;
    exploded = c.events.some((e) => e.type === 'explode');
  }
  assert.ok(exploded, 'rocket never exploded on the wall');
  assert.ok(inside.hp < 3, `edge enemy untouched (hp ${inside.hp})`);
  assert.equal(outside.hp, 3, `beyond-radius enemy damaged (hp ${outside.hp})`);
  ok('splash radius edge', `≈${rIn.toFixed(1)}m enemy hp 3→${inside.hp}, ≈${rOut.toFixed(1)}m untouched (radius ${SPLASH_RADIUS})`);
}

// ── 10. pvp branch on splash + self-damage in BOTH modes ───────────────────
{
  const splashDuel = (pvp) => {
    const sim = createSim('rocket-pvp', { pvp, enemies: false });
    const a = sim.addPlayer(), b = sim.addPlayer();
    const pa = sim.getPlayer(a), pb = sim.getPlayer(b);
    /* Both derived from the hex wall face, and the LANE IS PROBED rather than
       assumed. Hardcoded 50/62.5 put the victim 22m from the impact once MD 17
       moved the wall out to 85, and the obvious re-pin (x=0) then fired straight
       into a crystal 1.8m from the muzzle. Scanning for a bearing whose first
       hit really is the wall makes this independent of where the scatter lands,
       which is the property the original quietly relied on. */
    const WF = HEX_APOTHEM - 1.5;
    // 15m back, the same setback the original had from the old wall — far
    // enough to stay outside the 11m splash, near enough that the rocket
    // still lands inside the loop's 40-tick budget.
    const shooterZ = WF - 15;
    let lane = null;
    for (let dx = 0; dx <= 24 && lane === null; dx += 1.5) {
      for (const sx of dx === 0 ? [0] : [dx, -dx]) {
        const h = sim.world.raycast({ x: sx, y: 1.5, z: shooterZ }, { x: 0, y: 0, z: 1 }, 60);
        if (h && Math.abs(h.point.z - WF) < 0.2) { lane = sx; break; }
      }
    }
    assert.ok(lane !== null, 'no clear firing lane to the wall on any x offset');
    pa.pos = { x: lane, y: 0.92, z: shooterZ }; pa.spawn = { ...pa.pos };
    pb.pos = { x: lane + 1.5, y: 0.92, z: WF - 2.5 }; pb.spawn = { ...pb.pos }; // near the wall impact
    const am = { yaw: 0, pitch: 0 };
    let hitEvents = [];
    for (let t = 0; t < 40; t++) {
      sim.step(new Map([[a, { tick: t, playerId: a, ...idleAt(am), buttons: t === 0 ? BTN.FIRE : 0 }]]));
      hitEvents.push(...sim.snapshot().events.filter((e) => e.type === 'hit' && e.target === b));
    }
    return { otherHp: pb.hp, hitEvents };
  };
  const on = splashDuel(true);
  assert.ok(on.otherHp < 100, `pvp on: splash did not damage the other player (hp ${on.otherHp})`);
  const off = splashDuel(false);
  assert.equal(off.otherHp, 100, `pvp off: splash leaked damage (hp ${off.otherHp})`);
  assert.ok(off.hitEvents.length >= 1 && off.hitEvents.every((e) => e.dmg === 0),
    'pvp off: hit event should exist with dmg 0');

  // self-damage applies in BOTH modes (never pvp-gated — rocket jumping in co-op)
  const selfBlast = (pvp) => {
    const sim = createSim('rocket-self', { pvp, enemies: false });
    const id = sim.addPlayer();
    const p = sim.getPlayer(id);
    p.pos = { x: 0, y: 0.92, z: 50 }; p.spawn = { ...p.pos };
    for (let t = 0; t < 20; t++) {
      sim.step(new Map([[id, {
        tick: t, playerId: id, move: { x: 0, z: 0 }, yaw: 0, pitch: 1.2, // at own feet
        buttons: t === 0 ? BTN.FIRE : 0, weapon: 1,
      }]]));
    }
    return p.hp;
  };
  const s1 = selfBlast(true), s0 = selfBlast(false);
  assert.ok(s1 < 100 && s0 < 100 && s1 === s0, `self-damage gated by pvp?! on=${s1}, off=${s0}`);
  assert.ok(100 - s1 >= 15 && 100 - s1 <= 35, `self-damage ${100 - s1} outside the third-to-quarter shape`);
  ok('pvp splash branch + ungated self-damage',
    `pvp on: other ${on.otherHp}hp; off: 100hp with dmg-0 events; self-blast costs ${100 - s1}hp in both modes`);
}

// ── 11. self-knockback launches, at full AND at low hp ─────────────────────
{
  const jump = (startHp) => {
    const sim = createSim('rocket-knock', { enemies: false });
    const id = sim.addPlayer();
    const p = sim.getPlayer(id);
    p.pos = { x: 0, y: 0.92, z: 50 }; p.spawn = { ...p.pos };
    p.hp = startHp;
    let maxVy = 0, death = null;
    for (let t = 0; t < 30; t++) {
      sim.step(new Map([[id, {
        tick: t, playerId: id, move: { x: 0, z: 0 }, yaw: 0, pitch: 1.2,
        buttons: t === 0 ? BTN.FIRE : 0, weapon: 1,
      }]]));
      maxVy = Math.max(maxVy, p.vel.y);
      death = death || sim.snapshot().events.find((e) => e.type === 'death');
    }
    return { maxVy, death };
  };
  const full = jump(100);
  assert.ok(full.maxVy > 8, `full-hp launch too weak (vy ${full.maxVy.toFixed(1)})`);
  // low but SURVIVABLE hp: the launch must still work (never damage-gated)
  const low = jump(30);
  assert.ok(low.maxVy > 8, `low-hp launch failed (vy ${low.maxVy.toFixed(1)}) — knockback must not be damage-gated`);
  assert.ok(!low.death, 'a 30hp jump should be survivable at ~23 self-damage');
  // lethal case: the death is attributed to YOURSELF, never read as an enemy
  // kill (respawn zeroing velocity is correct — dead players do not launch)
  const lethal = jump(10);
  assert.ok(lethal.death && lethal.death.by === lethal.death.playerId, 'self-kill not attributed to self');
  ok('self-knockback at any hp', `launch vy ${full.maxVy.toFixed(1)} at 100hp, ${low.maxVy.toFixed(1)} at 30hp; 10hp blast dies attributed SELF`);
}

// ── 12. sky rocket despawns; weapon round-trips ────────────────────────────
{
  const sim = createSim('rocket-sky', { enemies: false });
  const id = sim.addPlayer();
  let sawRocket = false;
  for (let t = 0; t < 300; t++) {
    sim.step(new Map([[id, {
      tick: t, playerId: id, move: { x: 0, z: 0 }, yaw: 0, pitch: -1.4, // straight up
      buttons: t === 0 ? BTN.FIRE : 0, weapon: 1,
    }]]));
    if (sim.snapshot().rockets.length) sawRocket = true;
  }
  const s = sim.snapshot();
  assert.ok(sawRocket, 'sky rocket never existed');
  assert.equal(s.rockets.length, 0, `sky rocket leaked (${s.rockets.length} alive after 5s)`);
  assert.equal(s.players[0].weapon, 1, 'weapon did not round-trip through the snapshot');
  // respawn persistence: kill-floor the player, weapon stays 1
  const p = sim.getPlayer(id);
  p.hp = 10; p.pos = { x: 0, y: -30, z: 0 };
  sim.step(new Map([[id, { tick: 301, playerId: id, move: { x: 0, z: 0 }, yaw: 0, pitch: 0, buttons: 0, weapon: 1 }]]));
  assert.equal(sim.snapshot().players[0].weapon, 1, 'weapon lost across respawn');
  ok('sky despawn + weapon round-trip', 'lifetime 4s enforced; weapon survives respawn in-snapshot');
}

console.log(`\ncombat.mjs: ${passed}/12 passed`);
