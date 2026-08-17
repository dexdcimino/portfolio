// tests/md25.mjs — MD 25 item 5: a paused player is not an enemy target, but
// is still a valid target for other PLAYERS.
//
// The split is the whole point. Solo pause freezes the sim, so there is
// nothing to test there beyond "it froze"; a NET session cannot freeze without
// stalling the match for everyone, so the host has to be told and its enemies
// have to act on it. Pause that also stopped bullets would be an invincibility
// button in PvP — a worse problem than the one being fixed.
import { strict as assert } from 'node:assert';
import { createSim, BTN } from '../js/sim/sim.js';
import { SIM_DT } from '../js/config.js';

let passed = 0;
const ok = (name, detail) => { passed++; console.log(`ok  ${name}${detail ? ` — ${detail}` : ''}`); };
const cmd = (tick, buttons = 0, move = { x: 0, z: 0 }) =>
  ({ tick, yaw: 0, pitch: 0, buttons, move, weapon: 0 });

// ── 1. the PAUSED bit reaches the sim and clears again ────────────────────
{
  const sim = createSim('md25-a', { pvp: true });
  const id = sim.addPlayer();
  const p = sim.getPlayer(id);
  sim.step([{ id, cmd: cmd(0) }]);
  assert.equal(!!p.paused, false, 'paused before anything was pressed');
  sim.step([{ id, cmd: cmd(1, BTN.PAUSED) }]);
  assert.equal(p.paused, true, 'BTN.PAUSED did not reach the sim');
  sim.step([{ id, cmd: cmd(2) }]);
  assert.equal(p.paused, false, 'paused stuck on after the bit cleared — enemies would never re-engage');
  ok('PAUSED is a level, not an edge', 'set on the tick it arrives, cleared on the tick it stops');
}

// ── 2a. a paused player takes no contact damage ───────────────────────────
/* Two separate checks rather than one, because a single "did it hurt them
   after chasing them" run turned out to hinge on the blob closing to 1.51m
   against a 1.5m damage threshold — a knife-edge that would fail for reasons
   having nothing to do with pausing. Damage and disengagement are tested
   independently, each at a distance where the outcome is not marginal. */
{
  const hit = (pauseThem) => {
    const sim = createSim('md25-b', { pvp: true });
    const id = sim.addPlayer();
    const p = sim.getPlayer(id);
    const blob = [...sim.ents.enemies.values()].find((e) => e.alive && e.kind === 'blob');
    // Well inside the 1.5m contact radius, so the awake case cannot miss.
    const home = { x: blob.pos.x + 0.8, y: blob.pos.y, z: blob.pos.z };
    for (let t = 0; t < 4; t++) {
      p.pos = { ...home }; p.vel = { x: 0, y: 0, z: 0 };
      sim.step([{ id, cmd: cmd(t, pauseThem ? BTN.PAUSED : 0) }]);
    }
    return p.hp;
  };
  const awake = hit(false), paused = hit(true);
  assert.ok(awake < 100, `the control run took no contact damage (hp ${awake}) — the case would prove nothing`);
  assert.equal(paused, 100, `a paused player lost ${100 - paused} hp to a blob sitting on top of them`);
  ok('a paused player takes no contact damage',
    `blob 0.8m away: awake hp ${awake}, paused hp ${paused}`);
}

// ── 2b. …and enemies actually disengage, not just fail to damage ──────────
{
  const approach = (pauseThem) => {
    const sim = createSim('md25-b', { pvp: true });
    const id = sim.addPlayer();
    const p = sim.getPlayer(id);
    const blob = [...sim.ents.enemies.values()].find((e) => e.alive && e.kind === 'blob');
    const home = { x: blob.pos.x + 8, y: blob.pos.y, z: blob.pos.z };
    let closest = Infinity;
    for (let t = 0; t < 900; t++) {
      p.pos = { ...home }; p.vel = { x: 0, y: 0, z: 0 };
      sim.step([{ id, cmd: cmd(t, pauseThem ? BTN.PAUSED : 0) }]);
      if (!blob.alive) return { closest: 0 };          // it reached them and popped
      const d = Math.hypot(blob.pos.x - home.x, blob.pos.y - home.y, blob.pos.z - home.z);
      if (d < closest) closest = d;
    }
    return { closest };
  };
  const awake = approach(false), paused = approach(true);
  assert.ok(awake.closest < 3, `the blob never approached an awake player (closest ${awake.closest.toFixed(1)}m)`);
  assert.ok(paused.closest > 6,
    `the blob closed to ${paused.closest.toFixed(1)}m on a PAUSED player from 8m — it is still tracking them`);
  ok('enemies disengage from a paused player', `from 8m over 900 ticks: closed to `
    + `${awake.closest.toFixed(1)}m when awake, never nearer than ${paused.closest.toFixed(1)}m when paused`);
}

// ── 3. …but another PLAYER can still kill them ────────────────────────────
{
  const sim = createSim('md25-c', { pvp: true });
  const a = sim.addPlayer(), b = sim.addPlayer();
  const pa = sim.getPlayer(a), pb = sim.getPlayer(b);
  /* b is paused and pinned 6m down a's line of sight. Pinned EVERY tick, not
     once: set only at the start, b falls under gravity and drifts out of the
     line of fire, and the case then "passes" for the wrong reason — which is
     exactly what happened on the first run. */
  const hp0 = pb.hp;
  for (let t = 0; t < 200; t++) {
    pb.pos = { x: pa.pos.x, y: pa.pos.y, z: pa.pos.z + 6 };
    pb.vel = { x: 0, y: 0, z: 0 };
    sim.step([
      { id: a, cmd: { tick: t, yaw: 0, pitch: 0, buttons: BTN.FIRE, move: { x: 0, z: 0 }, weapon: 0 } },
      { id: b, cmd: cmd(t, BTN.PAUSED) },
    ]);
  }
  assert.ok(pb.hp < hp0,
    `a paused player took no damage from another player (hp ${pb.hp}) — pause is an invincibility button`);
  assert.equal(pb.paused, true, 'the target stopped being paused mid-test');
  ok('a paused player is still shootable by other players',
    `hp ${hp0} → ${pb.hp} over 200 ticks of point-blank fire while paused`);
}

// ── 4. and they stay visible to everyone else ─────────────────────────────
{
  const sim = createSim('md25-d', { pvp: true });
  const a = sim.addPlayer(), b = sim.addPlayer();
  for (let t = 0; t < 30; t++) {
    sim.step([{ id: a, cmd: cmd(t) }, { id: b, cmd: cmd(t, BTN.PAUSED) }]);
  }
  const snap = sim.snapshot();
  const entry = snap.players.find((q) => q.id === b);
  assert.ok(entry, 'a paused player vanished from the snapshot — they must not disappear');
  assert.ok(Number.isFinite(entry.pos.x), 'paused player has no position on the wire');
  ok('a paused player stays visible to others',
    `${snap.players.length} players on the wire, the paused one at `
    + `(${entry.pos.x.toFixed(1)}, ${entry.pos.z.toFixed(1)})`);
}

// ── 5. serpent bolts already in flight pass through ───────────────────────
{
  const sim = createSim('md25-e', { pvp: true });
  const id = sim.addPlayer();
  const p = sim.getPlayer(id);
  // Fly into the lowest tier's fire band and draw shots, then pause and check
  // that nothing that was already airborne lands.
  const t1 = [...sim.ents.serpents.values()].find((s) => s.tier === 't1');
  const band = (t1.fire.yMin + t1.fire.yMax) / 2;
  let t = 0;
  for (; t < t1.boltCd * 6; t++) {
    p.pos.x = 0; p.pos.z = 0; p.pos.y = band; p.vel.y = 0;
    sim.step([{ id, cmd: cmd(t) }]);
  }
  const drewFire = sim.ents.bolts.size > 0 || p.hp < 100;
  assert.ok(drewFire, 'no bolts were ever drawn — nothing to pass through');
  /* Counting HIT EVENTS aimed at this player, not an hp delta. A first version
     compared hp before and after and reported a loss of -36.6: the player had
     died to the pre-pause barrage and respawned at full health inside the
     measurement window. Events cannot be confounded that way. */
  let boltHits = 0, boltsSeen = 0;
  for (let k = 0; k < 400; k++, t++) {
    p.pos.x = 0; p.pos.z = 0; p.pos.y = band; p.vel.y = 0;
    sim.step([{ id, cmd: cmd(t, BTN.PAUSED) }]);
    boltsSeen = Math.max(boltsSeen, sim.ents.bolts.size);
    for (const e of sim.snapshot().events) {
      if ((e.type === 'hit' || e.type === 'bolt_hit') && e.target === id) boltHits++;
    }
  }
  assert.equal(boltHits, 0,
    `${boltHits} bolt hits landed on a paused player — in-flight bolts are meant to pass through`);
  ok('in-flight bolts pass through a paused player',
    `400 paused ticks in t1's fire band, up to ${boltsSeen} bolts airborne at once, 0 hits landed`);
}

console.log(`\nmd25.mjs: ${passed}/${passed} passed`);
