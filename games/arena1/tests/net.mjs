// tests/net.mjs — Phase 7 protocol checks (node tests/net.mjs). Drives the
// host and client cores over an in-memory pipe with an injected clock — the
// exact machines the Photon SDK glue runs, minus the wire. The live
// two-window accept (smoothness, feel) is a browser matter; THIS suite pins
// the protocol: welcome/identity, 20Hz broadcast with event aggregation,
// interp buffer + local echo, command batching + dry-queue hold, pvp both
// ways, host-leave ending the match, departure cleanup.
import { strict as assert } from 'node:assert';
import { createHostCore, createClientCore, EV, TICKS_PER_NET } from '../js/net/photon.js';
import { BTN } from '../js/sim/sim.js';
import { SIM_DT, INTERP_BUFFER_MS } from '../js/config.js';

let passed = 0;
const ok = (name, detail) => { passed++; console.log(`ok  ${name}${detail ? ` — ${detail}` : ''}`); };
const cmd = (move, yaw, pitch, buttons) => ({ move, yaw, pitch, buttons });

// In-memory room: actor 1 is host, others clients. send() delivers to every
// OTHER endpoint, like Photon's default receiver group. Joins are announced
// EXPLICITLY after the joiner's core exists — matching reality, where a
// client's handlers are constructed before the host hears about the join
// (the wire latency real Photon always has).
function makeRoom() {
  const endpoints = new Map(); // actorNr → {eventCbs, joinCbs, leaveCbs}
  function adapterFor(actorNr) {
    const ep = { eventCbs: [], joinCbs: [], leaveCbs: [] };
    endpoints.set(actorNr, ep);
    return {
      myActorNr: () => actorNr,
      masterActorNr: () => 1,
      send: (code, data) => {
        const wire = JSON.parse(JSON.stringify(data)); // the wire is a copy, not a reference
        for (const [nr, other] of endpoints) {
          if (nr !== actorNr) for (const cb of other.eventCbs) cb(code, wire, actorNr);
        }
      },
      onEvent: (cb) => ep.eventCbs.push(cb),
      onActorJoin: (cb) => ep.joinCbs.push(cb),
      onActorLeave: (cb) => ep.leaveCbs.push(cb),
    };
  }
  function announceJoin(actorNr) {
    for (const [nr, other] of endpoints) {
      if (nr !== actorNr) for (const cb of other.joinCbs) cb(actorNr);
    }
  }
  function leave(actorNr) {
    endpoints.delete(actorNr);
    for (const [, other] of endpoints) for (const cb of other.leaveCbs) cb(actorNr);
  }
  return { adapterFor, announceJoin, leave };
}

// Fake clock shared by cores and test: one sim tick = one 16.667ms step.
function makeClock() {
  let t = 100000;
  return { now: () => t, step: (ms = 1000 / 60) => { t += ms; } };
}

// ── 1. welcome: identity + the client rebuilds the host's exact level ──────
{
  const room = makeRoom();
  const clock = makeClock();
  const host = createHostCore('net-a', { pvp: true }, room.adapterFor(1));
  const client = createClientCore(room.adapterFor(2), {}, { now: clock.now });
  room.announceJoin(2);
  let clientReady = false;
  client.ready.then(() => { clientReady = true; });
  await Promise.resolve(); // let the welcome microtask land
  assert.ok(client.localId !== null, 'client never got an identity');
  assert.notEqual(client.localId, host.localId);
  await client.ready;
  assert.ok(clientReady, 'ready never resolved');
  assert.equal(client.level.platforms.length, host.level.platforms.length, 'levels differ');
  assert.equal(client.world.shapes.length, host.world.shapes.length, 'worlds differ');
  ok('welcome + identity + level parity', `host p${host.localId}, client p${client.localId}, `
    + `${client.level.platforms.length} platforms / ${client.world.shapes.length} shapes both sides`);
}

// ── 2. broadcast cadence + interp buffer + immediate local echo ────────────
{
  const room = makeRoom();
  const clock = makeClock();
  const host = createHostCore('net-b', { pvp: true }, room.adapterFor(1));
  const client = createClientCore(room.adapterFor(2), {}, { now: clock.now });
  room.announceJoin(2);
  await client.ready;
  let wireSnaps = 0, newestWire = null;
  room.adapterFor(99).onEvent((code, data) => { // wire tap
    if (code === EV.SNAPSHOT) { wireSnaps++; newestWire = data; }
  });
  const emitted = [];
  client.onSnapshot((s) => emitted.push(s));
  // host player walks forward; client idles
  for (let t = 0; t < 120; t++) {
    host.sendCommand(cmd({ x: 0, z: 1 }, Math.PI, 0, 0));
    client.sendCommand(cmd({ x: 0, z: 0 }, 0, 0, 0));
    host.tick();
    client.tick();
    clock.step();
  }
  assert.equal(wireSnaps, Math.floor(120 / TICKS_PER_NET), `wire snapshots ${wireSnaps}`);
  assert.ok(emitted.length > 100, `client emitted ${emitted.length}`);
  const last = emitted[emitted.length - 1];
  // Local echo: the client's own entry must be the NEWEST wire state, bit
  // for bit. Remote: the walking host must render BEHIND its newest wire z
  // by ≈ INTERP_BUFFER_MS of walk speed (the buffer working).
  const meRendered = last.players.find((p) => p.id === client.localId);
  const meNewest = newestWire.players.find((p) => p.id === client.localId);
  assert.deepEqual(meRendered.pos, meNewest.pos, 'local echo is not the freshest snapshot');
  const hostRendered = last.players.find((p) => p.id === host.localId);
  const hostNewest = newestWire.players.find((p) => p.id === host.localId);
  const lag = hostNewest.pos.z - hostRendered.pos.z; // walking −z: rendered z is LESS negative (behind)
  const expectLag = -9.2 * (INTERP_BUFFER_MS / 1000); // ≈ −0.92m at full walk
  assert.ok(Math.abs(lag - expectLag) < 0.5, `remote lag ${lag.toFixed(2)}m vs expected ${expectLag.toFixed(2)}m`);
  ok('20Hz cadence, interp buffer, immediate local echo',
    `${wireSnaps} wire snaps / 120 ticks, ${emitted.length} synthesized; local echo exact; `
    + `remote renders ${Math.abs(lag).toFixed(2)}m behind authority (expected ${Math.abs(expectLag).toFixed(2)}m)`);
}

// ── 3. pvp both directions through the wire; co-op blocks it ───────────────
{
  const aimAt = (from, to) => {
    const dx = to.pos.x - from.pos.x, dy = to.pos.y - from.pos.y, dz = to.pos.z - from.pos.z;
    return { yaw: Math.atan2(dx, dz), pitch: -Math.atan2(dy, Math.hypot(dx, dz)) };
  };
  const fireAt = (snap, myId, otherId) => {
    if (!snap) return cmd({ x: 0, z: 0 }, 0, 0, 0);
    const me = snap.players.find((p) => p.id === myId);
    const other = snap.players.find((p) => p.id === otherId);
    if (!me || !other) return cmd({ x: 0, z: 0 }, 0, 0, 0);
    const a = aimAt(me, other);
    return cmd({ x: 0, z: 0 }, a.yaw, a.pitch, BTN.FIRE);
  };
  const duel = async (pvp) => {
    const room = makeRoom();
    const clock = makeClock();
    const host = createHostCore('net-duel', { pvp }, room.adapterFor(1));
    const client = createClientCore(room.adapterFor(2), {}, { now: clock.now });
    room.announceJoin(2);
    await client.ready;
    let lastSynth = null, lastHostSnap = null;
    client.onSnapshot((s) => { lastSynth = s; });
    let hostHits = 0, clientHits = 0;
    for (let t = 0; t < 300; t++) {
      // each side aims from the view it legitimately has: the host from its
      // own sim, the client from its buffered synthesis
      host.sendCommand(fireAt(lastHostSnap, host.localId, client.localId));
      client.sendCommand(fireAt(lastSynth, client.localId, host.localId));
      lastHostSnap = host.tick();
      for (const ev of lastHostSnap.events) {
        if (ev.type === 'hit' && ev.shooter === host.localId) hostHits++;
        if (ev.type === 'hit' && ev.shooter === client.localId) clientHits++;
      }
      client.tick();
      clock.step();
    }
    const hostP = lastHostSnap.players.find((p) => p.id === host.localId);
    const clientP = lastHostSnap.players.find((p) => p.id === client.localId);
    return { hostHits, clientHits, hostHp: hostP.hp, clientHp: clientP.hp, hostDeaths: hostP.deaths, clientDeaths: clientP.deaths };
  };
  const on = await duel(true);
  assert.ok(on.hostHits > 3 && on.clientHits > 3, `hits h${on.hostHits}/c${on.clientHits}`);
  assert.ok(on.clientHp < 100 || on.clientDeaths > 0, 'host shots did not damage client');
  assert.ok(on.hostHp < 100 || on.hostDeaths > 0, 'client shots did not damage host');
  const off = await duel(false);
  assert.ok(off.hostHits > 3 && off.clientHits > 3, `co-op hits h${off.hostHits}/c${off.clientHits}`);
  assert.ok(off.hostHp === 100 && off.clientHp === 100 && off.hostDeaths === 0 && off.clientDeaths === 0,
    `co-op leaked damage (h ${off.hostHp}, c ${off.clientHp})`);
  ok('pvp both directions through the wire; co-op blocks it',
    `pvp: host hp ${on.hostHp} (←${on.clientHits} hits), client hp ${on.clientHp} (←${on.hostHits} hits); co-op: both 100hp`);
}

// ── 4. command batching + dry-queue hold ───────────────────────────────────
{
  const room = makeRoom();
  const clock = makeClock();
  const host = createHostCore('net-c', { pvp: true }, room.adapterFor(1));
  const client = createClientCore(room.adapterFor(2), {}, { now: clock.now });
  room.announceJoin(2);
  await client.ready;
  let batches = 0;
  room.adapterFor(98).onEvent((code) => { if (code === EV.COMMANDS) batches++; });
  // client walks for 60 ticks…
  for (let t = 0; t < 60; t++) {
    client.sendCommand(cmd({ x: 0, z: 1 }, 0, 0, 0));
    host.tick(); client.tick(); clock.step();
  }
  assert.equal(batches, 60 / TICKS_PER_NET, `batches ${batches}`);
  const zAt60 = host.tick().players.find((p) => p.id === client.localId).pos.z;
  // …then goes silent (packet loss / stall): the host HOLDS the last inputs
  for (let t = 0; t < 30; t++) { host.tick(); clock.step(); }
  const zAt90 = host.tick().players.find((p) => p.id === client.localId).pos.z;
  assert.ok(zAt90 > zAt60 + 3, `dry queue did not hold inputs (${zAt60.toFixed(1)} → ${zAt90.toFixed(1)})`);
  ok('60Hz commands batched per net tick + dry-queue hold',
    `${batches} batches for 60 ticks, silent client kept walking ${zAt60.toFixed(1)} → ${zAt90.toFixed(1)}`);
}

// ── 5. host leaves → match ends; client leaves → body removed ──────────────
{
  const room = makeRoom();
  const clock = makeClock();
  const host = createHostCore('net-d', { pvp: true }, room.adapterFor(1));
  let ended = false;
  const client = createClientCore(room.adapterFor(2), { onEnded: () => { ended = true; } }, { now: clock.now });
  room.announceJoin(2);
  await client.ready;
  for (let t = 0; t < 12; t++) { host.tick(); client.tick(); clock.step(); }
  assert.equal(host.tick().players.length, 2);
  // a second client joins and leaves: host removes the body
  const c2 = createClientCore(room.adapterFor(3), {}, { now: clock.now });
  room.announceJoin(3);
  await c2.ready;
  assert.equal(host.tick().players.length, 3, 'join did not add a body');
  room.leave(3);
  assert.equal(host.tick().players.length, 2, 'leave did not remove the body');
  // host dies: the remaining client is told, not hung
  room.leave(1);
  assert.ok(ended, 'client was left hanging when the host vanished');
  ok('host-leave ends the match; departures clean up bodies');
}

console.log(`\nnet.mjs: ${passed}/5 passed`);
