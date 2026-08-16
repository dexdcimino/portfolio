// tests/prediction.mjs — MD 8 headless verification (node tests/prediction.mjs).
//   1. zero latency  → ZERO corrections (corrections here = determinism leak)
//   2. 250ms RTT     → converges to authority under epsilon
//   3. 5% cmd loss   → corrects and converges, no drift
//   4. forced mismatch → replay result equals host's computation; replay cost
// The live feel judgement is Dex's, after this gate.
import { strict as assert } from 'node:assert';
import { createHostCore, createClientCore, EV } from '../js/net/photon.js';
import { createSim, BTN } from '../js/sim/sim.js';

let passed = 0;
const ok = (name, detail) => { passed++; console.log(`ok  ${name}${detail ? ` — ${detail}` : ''}`); };
const cmd = (move, yaw, pitch, buttons) => ({ move, yaw, pitch, buttons });
const EPS = 0.05;

function makeClock() {
  let t = 100000;
  return { now: () => t, step: (ms = 1000 / 60) => { t += ms; } };
}

// In-memory room with one-way latency on the fake clock and an optional
// deterministic drop hook. deliver() releases due messages in FIFO order.
function makeDelayedRoom(clock, { latencyMs = 0, drop = null } = {}) {
  const endpoints = new Map();
  const inflight = [];
  let seq = 0;
  function adapterFor(actorNr) {
    const ep = { eventCbs: [], joinCbs: [], leaveCbs: [] };
    endpoints.set(actorNr, ep);
    return {
      myActorNr: () => actorNr,
      masterActorNr: () => 1,
      send: (code, data) => {
        seq++;
        if (drop && drop(code, seq)) return;
        inflight.push({ deliverAt: clock.now() + latencyMs, code, data: JSON.parse(JSON.stringify(data)), from: actorNr });
      },
      onEvent: (cb) => ep.eventCbs.push(cb),
      onActorJoin: (cb) => ep.joinCbs.push(cb),
      onActorLeave: (cb) => ep.leaveCbs.push(cb),
    };
  }
  function deliver() {
    const nowT = clock.now();
    for (let i = 0; i < inflight.length;) {
      if (inflight[i].deliverAt <= nowT) {
        const m = inflight.splice(i, 1)[0];
        for (const [nr, other] of endpoints) {
          if (nr !== m.from) for (const cb of other.eventCbs) cb(m.code, m.data, m.from);
        }
      } else i++;
    }
  }
  function announceJoin(actorNr) {
    for (const [nr, other] of endpoints) {
      if (nr !== actorNr) for (const cb of other.joinCbs) cb(actorNr);
    }
  }
  return { adapterFor, deliver, announceJoin };
}

async function makePair(seedName, opts = {}) {
  const clock = makeClock();
  const room = makeDelayedRoom(clock, opts);
  // enemies:false — enemy knockback is authoritative-only physics that
  // legitimately corrects; these tests isolate the prediction machinery,
  // where a correction can only mean the two sims computed different answers.
  const host = createHostCore(seedName, { pvp: true, enemies: false }, room.adapterFor(1));
  const client = createClientCore(room.adapterFor(2), {}, { now: clock.now });
  room.announceJoin(2);
  const P = { clock, room, host, client, lastSynth: null, lastHost: null };
  client.onSnapshot((s) => { P.lastSynth = s; });
  // run the handshake + prediction bootstrap through the delay
  for (let i = 0; i < 120; i++) step(P, null);
  await client.ready;
  return P;
}

// One lockstep iteration: client issues + predicts, batches flush, wire
// delivers what is due, host consumes + broadcasts, wire delivers again.
function step(P, c) {
  if (c) P.client.sendCommand(c);
  P.client.tick();
  P.room.deliver();
  P.lastHost = P.host.tick();
  P.room.deliver();
  P.clock.step();
}
const run = (P, n, cmdFor) => { for (let t = 0; t < n; t++) step(P, cmdFor ? cmdFor(t) : null); };
const idle = () => cmd({ x: 0, z: 0 }, 0, 0, 0);
// a workout: yaw sweeps, strafes, jumps, dash, slide, jet, a grapple hold
const script = (t) => {
  const yaw = Math.PI + Math.sin(t * 0.01) * 0.8;
  const buttons =
    (t % 120 === 30 ? BTN.JUMP : 0)
    | (t % 240 === 100 ? BTN.DASH : 0)
    | (t > 380 && t < 440 ? BTN.SLIDE : 0)
    | (t > 460 && t < 520 ? BTN.JET : 0)
    | (t > 540 ? BTN.GRAPPLE : 0);
  const pitch = t > 540 ? 0.35 : 0;
  return cmd({ x: Math.sin(t * 0.005), z: 1 }, yaw, pitch, buttons);
};
const dist = (a, b) => Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);
function me(P) {
  const pred = P.lastSynth.players.find((p) => p.id === P.client.localId);
  const auth = P.lastHost.players.find((p) => p.id === P.client.localId);
  return { pred, auth };
}

// ── 1. zero latency: prediction and authority agree, zero corrections ──────
{
  const P = await makePair('pred-zero');
  run(P, 150, idle);       // settle at spawn (idle cmd ≡ host idle step)
  run(P, 600, script);     // the workout
  const pr = P.client.prediction;
  assert.ok(pr, 'prediction never bootstrapped');
  assert.equal(pr.corrections, 0,
    `corrections at ZERO latency: ${pr.corrections} (max ${pr.maxCorrection?.toFixed(3)}m) — determinism leak`);
  run(P, 120, () => cmd({ x: 0, z: 0 }, Math.PI, 0, 0)); // stop + settle
  const { pred, auth } = me(P);
  const d = dist(pred, auth);
  assert.ok(d < EPS, `zero-latency disagreement ${d.toFixed(4)}m`);
  ok('zero latency: 0 corrections, prediction ≡ authority',
    `750 ticks, corrections 0, final Δ ${d.toFixed(4)}m (wire rounding is 0.01m)`);
}

// ── 2. 250ms RTT: immediate prediction, converges to authority ─────────────
{
  const P = await makePair('pred-rtt', { latencyMs: 125 });
  run(P, 150, idle);
  // prove the same-frame response: predicted pos must move the tick input
  // starts, long before the host can know
  const before = me(P).pred.pos.z;
  step(P, cmd({ x: 0, z: 1 }, Math.PI, 0, 0));
  const after = me(P).pred.pos.z;
  assert.ok(before - after > 0.001, `no same-frame response (Δz ${(before - after).toFixed(4)})`);
  run(P, 600, script);
  const pr = P.client.prediction;
  run(P, 300, () => cmd({ x: 0, z: 0 }, Math.PI, 0, 0)); // stop; let acks catch up
  const { pred, auth } = me(P);
  const d = dist(pred, auth);
  assert.ok(d < EPS, `did not converge under 250ms RTT: Δ ${d.toFixed(3)}m`);
  // steady-state pipeline depth ≈ RTT in ticks (15) + batch (3) + snapshot
  // cadence (3); anything far past that means acks are not being consumed
  assert.ok(P.client.prediction.unacked < 30, `ack pipeline clogged: ${P.client.prediction.unacked} unacked`);
  ok('250ms RTT: same-frame response + convergence',
    `input visible in 1 tick; corrections ${pr.corrections} (max ${pr.maxCorrection.toFixed(3)}m); final Δ ${d.toFixed(4)}m`);
}

// ── 3. 5% command loss: corrects and converges, no drift ───────────────────
{
  const P = await makePair('pred-loss', {
    latencyMs: 125,
    drop: (code, seq) => code === EV.COMMANDS && seq % 20 === 0, // deterministic 5%
  });
  run(P, 150, idle);
  run(P, 600, script);
  run(P, 300, () => cmd({ x: 0, z: 0 }, Math.PI, 0, 0));
  const pr = P.client.prediction;
  const { pred, auth } = me(P);
  const d = dist(pred, auth);
  assert.ok(pr.corrections >= 1, 'losses never triggered a correction — the compare is dead');
  assert.ok(d < EPS, `drifted under packet loss: Δ ${d.toFixed(3)}m after ${pr.corrections} corrections`);
  ok('5% command loss: corrected, converged, no drift',
    `corrections ${pr.corrections} (max ${pr.maxCorrection.toFixed(2)}m), final Δ ${d.toFixed(4)}m`);
}

// ── 4. forced mismatch: one replay fixes it; replay cost measured ──────────
{
  let armDrop = false;
  const P = await makePair('pred-replay', {
    latencyMs: 125,
    drop: (code) => armDrop && code === EV.COMMANDS && (armDrop = false, true),
  });
  run(P, 150, idle);
  run(P, 200, script);
  const before = P.client.prediction.corrections;
  armDrop = true; // exactly one batch vanishes mid-sprint
  run(P, 200, (t) => script(t + 200));
  run(P, 300, () => cmd({ x: 0, z: 0 }, Math.PI, 0, 0));
  const pr = P.client.prediction;
  const { pred, auth } = me(P);
  const d = dist(pred, auth);
  assert.ok(pr.corrections > before, 'the dropped batch never registered as a mismatch');
  assert.ok(pr.corrections - before <= 3,
    `one drop caused ${pr.corrections - before} corrections — replay is not converging`);
  assert.ok(d < EPS, `replay result diverges from host: Δ ${d.toFixed(3)}m`);

  // replay cost: worst case ≈ 500ms of 60Hz commands = 30 steps in one frame
  const bench = createSim('replay-bench', { predictOnly: true });
  bench.addPlayer(999);
  const t0 = performance.now();
  for (let i = 0; i < 30; i++) {
    bench.step(new Map([[999, cmd({ x: 0, z: 1 }, Math.PI, 0, i % 10 === 0 ? BTN.JUMP : 0)]]));
  }
  const ms = performance.now() - t0;
  assert.ok(ms < 16, `30-step replay burst took ${ms.toFixed(1)}ms — over a frame budget`);
  ok('forced mismatch: 1 replay converges; replay cost fine',
    `corrections +${pr.corrections - before} (max ${pr.maxCorrection.toFixed(2)}m), final Δ ${d.toFixed(4)}m; 30-step replay ${ms.toFixed(2)}ms`);
}

// ── 5. player-grapple consistency: client and host resolve the same latch ──
// The client's predict sim mirrors remote players as kinematic ghosts, so a
// grapple aimed at the host's player latches mode 'player' locally — the
// same resolution the host computes — instead of anchoring on geometry
// behind the target and correcting later.
{
  const P = await makePair('pred-pgrapple');
  run(P, 150, idle); // both bodies settled at spawn
  // the host walks away so the pull has real distance to cover
  for (let t = 0; t < 120; t++) {
    P.client.sendCommand(idle());
    P.client.tick();
    P.room.deliver();
    P.host.sendCommand(cmd({ x: 0, z: 1 }, 0, 0, 0)); // walks +z, away from spawn
    P.lastHost = P.host.tick();
    P.room.deliver();
    P.clock.step();
  }
  // aim from the client's predicted eye at the host player's authoritative pos
  const hostP = P.lastHost.players.find((p) => p.id === P.host.localId);
  const meP = P.lastSynth.players.find((p) => p.id === P.client.localId);
  const dxA = hostP.pos.x - meP.pos.x, dyA = hostP.pos.y - (meP.pos.y + 0.55), dzA = hostP.pos.z - meP.pos.z;
  const startDist = Math.hypot(dxA, dyA, dzA);
  const a = { yaw: Math.atan2(dxA, dzA), pitch: -Math.atan2(dyA, Math.hypot(dxA, dzA)) };
  let hostSawLatch = false, clientPredictedLatch = false;
  for (let t = 0; t < 120; t++) {
    step(P, cmd({ x: 0, z: 0 }, a.yaw, a.pitch, BTN.GRAPPLE));
    const onHost = P.lastHost.players.find((p) => p.id === P.client.localId);
    if (onHost?.grapple) hostSawLatch = true;
    const predicted = P.lastSynth.players.find((p) => p.id === P.client.localId);
    if (predicted?.grapple) clientPredictedLatch = true;
  }
  assert.ok(startDist > 10, `host never got far enough away (${startDist.toFixed(1)}m)`);
  assert.ok(hostSawLatch, 'host never saw the latch');
  assert.ok(clientPredictedLatch, 'client never PREDICTED the latch (ghosts missing)');
  const pr = P.client.prediction;
  // and the two sims agreed the whole way: no corrections at zero latency
  assert.equal(pr.corrections, 0, `player-grapple diverged: ${pr.corrections} corrections (max ${pr.maxCorrection?.toFixed(2)}m)`);
  const d = dist(P.lastSynth.players.find((p) => p.id === P.client.localId),
    P.lastHost.players.find((p) => p.id === P.client.localId));
  assert.ok(d < EPS + 0.05, `end-state disagreement ${d.toFixed(3)}m`);
  ok('player-grapple predicts consistently',
    `pulled across ${startDist.toFixed(1)}m; latched on host AND in prediction; 0 corrections; end Δ ${d.toFixed(4)}m`);
}

console.log(`\nprediction.mjs: ${passed}/5 passed`);
