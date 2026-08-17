// tests/md24.mjs — MD 24 item 1: predicted rocket self-impulse.
//
// MD 11 said rockets are never predicted. That was right for damage and wrong
// for movement, and rocket jumping made a rocket a movement input. These cases
// pin the split: the shooter's own impulse is predicted, everything that
// decides a health value or a kill is not.
//
// The room here adds a configurable one-way delay driven by the fake clock,
// because "does the client see its own launch promptly" is meaningless at zero
// latency and that is the only latency the older suites run at.
import { strict as assert } from 'node:assert';
import { createHostCore, createClientCore, EV } from '../js/net/photon.js';
import { BTN } from '../js/sim/sim.js';
import { SIM_DT } from '../js/config.js';

let passed = 0;
const ok = (name, detail) => { passed++; console.log(`ok  ${name}${detail ? ` — ${detail}` : ''}`); };
const cmd = (move, yaw, pitch, buttons) => ({ move, yaw, pitch, buttons });

function makeClock() {
  let t = 100000;
  return { now: () => t, step: (ms = 1000 / 60) => { t += ms; } };
}

// Room with a one-way delay. Messages queue with a due time and are delivered
// by pump(), which the test loop calls once per tick — so latency is measured
// in the same clock the cores read, not in wall time.
function makeRoom(clock, onewayMs = 0) {
  const endpoints = new Map();
  const queue = [];
  function adapterFor(actorNr) {
    const ep = { eventCbs: [], joinCbs: [], leaveCbs: [] };
    endpoints.set(actorNr, ep);
    return {
      myActorNr: () => actorNr,
      masterActorNr: () => 1,
      send: (code, data) => {
        const wire = JSON.parse(JSON.stringify(data));
        const due = clock.now() + onewayMs;
        for (const [nr] of endpoints) {
          if (nr !== actorNr) queue.push({ due, to: nr, code, wire, from: actorNr });
        }
        if (onewayMs === 0) pump();
      },
      onEvent: (cb) => ep.eventCbs.push(cb),
      onActorJoin: (cb) => ep.joinCbs.push(cb),
      onActorLeave: (cb) => ep.leaveCbs.push(cb),
    };
  }
  function pump() {
    const now = clock.now();
    for (let i = 0; i < queue.length; i++) {
      const m = queue[i];
      if (m.due > now) continue;
      queue.splice(i--, 1);
      const ep = endpoints.get(m.to);
      if (ep) for (const cb of ep.eventCbs) cb(m.code, m.wire, m.from);
    }
  }
  function announceJoin(actorNr) {
    for (const [nr, other] of endpoints) {
      if (nr !== actorNr) for (const cb of other.joinCbs) cb(actorNr);
    }
  }
  return { adapterFor, announceJoin, pump };
}

// Aim straight down and fire: the canonical rocket jump, and the case MD 24
// calls out as invisible today (a feet blast lives ~2 ticks on the host and
// can die before any snapshot carries it).
const LOOK_DOWN = Math.PI / 2 - 0.001;

async function pair(seed, onewayMs) {
  const clock = makeClock();
  const room = makeRoom(clock, onewayMs);
  const host = createHostCore(seed, { pvp: true }, room.adapterFor(1));
  const client = createClientCore(room.adapterFor(2), {}, { now: clock.now });
  room.announceJoin(2);
  /* With a delayed room the welcome is not deliverable at t=0, so advance the
     clock and pump until it lands. Awaiting ready without this hangs. */
  let isReady = false;
  client.ready.then(() => { isReady = true; });
  for (let i = 0; i < 400 && !isReady; i++) {
    clock.step(); room.pump();
    await Promise.resolve();
  }
  await client.ready;
  const rendered = [];
  client.onSnapshot((s) => rendered.push(s));
  /* Always steps BOTH cores and pumps the room. A loop that ticks only the
     client looks like a test and is not one: authority never arrives, so
     "no duplicate rocket" and "how many corrections" are both vacuously true.
     opts.pitch/move/at let a case aim and fire without bypassing that. */
  const run = (ticks, opts = {}) => {
    const { clientBtn = 0, hostBtn = 0, weapon = 1, pitch = LOOK_DOWN,
      move = { x: 0, z: 0 }, at = null } = opts;
    for (let t = 0; t < ticks; t++) {
      const btn = at == null ? clientBtn : (t === at ? BTN.FIRE : 0);
      host.sendCommand({ ...cmd({ x: 0, z: 0 }, 0, 0, hostBtn), weapon });
      client.sendCommand({ ...cmd(move, 0, pitch, btn), weapon });
      host.tick(); client.tick();
      clock.step(); room.pump();
    }
  };
  return { clock, room, host, client, rendered, run };
}

// ── 1. zero latency: firing costs NOTHING in corrections ──────────────────
/* MD 8's canary is "corrections stay at zero with an instant transport". It is
   very nearly true and not exactly true: an identical run with the trigger
   never touched still produces ONE correction of 0.195m, always at the tick
   prediction bootstraps off the first authoritative snapshot, and it is
   present unchanged before this MD. So the property worth pinning is not an
   absolute zero that was never there — it is that FIRING adds nothing to the
   idle baseline. Measured at HEAD, firing cost 2 corrections at 2.250m (the
   ~2.33m the MD reports); the assertion below is that it now costs none. */
{
  const idle = await pair('md24-a', 0);
  idle.run(330);
  const baseline = idle.client.prediction.corrections;

  const { client, run } = await pair('md24-a', 0);   // same seed, same ticks
  run(90);
  run(240, { clientBtn: BTN.FIRE });
  const pred = client.prediction;
  assert.ok(pred, 'prediction never bootstrapped');
  assert.equal(pred.corrections, baseline,
    `firing added ${pred.corrections - baseline} corrections over the idle baseline `
    + `(max ${pred.maxCorrection.toFixed(3)}m) — the predicted and authoritative rockets disagree`);
  ok('zero latency: firing adds no corrections',
    `${pred.corrections} corrections over 240 firing ticks = the idle baseline of ${baseline} `
    + `(one 0.195m bootstrap artefact, pre-existing); was 2 at 2.250m before this MD`);
}

// ── 2. 250ms RTT: the client sees its own launch within a frame or two ─────
{
  const RTT = 250;
  const { client, rendered, run } = await pair('md24-b', RTT / 2);
  run(120);                                  // settle and bootstrap
  const base = rendered[rendered.length - 1].players.find((p) => p.id === client.localId);
  const y0 = base.pos.y, vy0 = base.vel.y;
  const mark = rendered.length;
  run(1, { clientBtn: BTN.FIRE });           // ONE firing tick
  run(30);                                   // then watch
  // First rendered frame after the shot where the local player is moving up.
  let launchFrame = -1;
  for (let i = mark; i < rendered.length; i++) {
    const me = rendered[i].players.find((p) => p.id === client.localId);
    if (me && me.vel.y > vy0 + 5) { launchFrame = i - mark; break; }
  }
  const ms = launchFrame < 0 ? Infinity : launchFrame * (1000 / 60);
  assert.ok(launchFrame >= 0 && ms <= 50,
    `launch became visible after ${ms.toFixed(0)}ms at ${RTT}ms RTT (baseline was 367ms)`);
  ok('250ms RTT: own launch is visible immediately',
    `${ms.toFixed(0)}ms / ${launchFrame} frames after the keypress, against a 367ms baseline `
    + `(y ${y0.toFixed(2)} → moving up)`);
}

// ── 3. a point-blank feet blast produces a rocket the shooter can see ──────
{
  const { client, rendered, run } = await pair('md24-c', 125);
  run(120);
  const mark = rendered.length;
  run(1, { clientBtn: BTN.FIRE });
  run(12);
  let framesWithOwn = 0, everAuth = 0;
  for (let i = mark; i < rendered.length; i++) {
    const mine = (rendered[i].rockets || []).filter((r) => r.ownerId === client.localId);
    if (mine.length) framesWithOwn++;
    everAuth += mine.filter((r) => !r.predicted).length;
  }
  assert.ok(framesWithOwn > 0,
    'the shooter never saw their own rocket — a feet blast lives ~2 ticks and dies before any snapshot carries it');
  ok('feet blast: the shooter sees their own rocket',
    `${framesWithOwn} rendered frames carried it, all predicted (${everAuth} authoritative frames — `
    + 'it detonated before a snapshot could carry it, which is exactly the case MD 24 names)');
}

// ── 4. exactly one rocket per shot: no duplicate, no pop ───────────────────
{
  const { client, rendered, run } = await pair('md24-d', 125);
  run(120);
  const mark = rendered.length;
  // Aim FLAT so the rocket flies for long enough that authority really does
  // carry it — that is the only case where a duplicate could appear at all.
  run(200, { pitch: 0, at: 0 });
  let worstCount = 0, jumps = [];
  let prev = null;
  for (let i = mark; i < rendered.length; i++) {
    const mine = (rendered[i].rockets || []).filter((r) => r.ownerId === client.localId);
    worstCount = Math.max(worstCount, mine.length);
    if (mine.length === 1) {
      if (prev) {
        const d = Math.hypot(mine[0].pos.x - prev.x, mine[0].pos.y - prev.y, mine[0].pos.z - prev.z);
        jumps.push(d);
      }
      prev = { ...mine[0].pos };
    } else prev = null;
  }
  const maxJump = jumps.length ? Math.max(...jumps) : 0;
  assert.ok(worstCount <= 1, `${worstCount} of the shooter's own rockets on screen at once — duplicate at handoff`);
  // One tick of rocket travel is the legitimate per-frame step; anything much
  // over that is a positional pop.
  assert.ok(maxJump < 3.0, `rocket jumped ${maxJump.toFixed(2)}m between frames — that is a pop, not travel`);
  ok('one rocket per shot, no duplicate and no pop',
    `never more than ${worstCount} on screen; largest frame-to-frame step ${maxJump.toFixed(2)}m over ${jumps.length} frames`);
}

// ── 5. the client predicts MOVEMENT and never health or kills ──────────────
{
  const { client, host, rendered, run } = await pair('md24-e', 125);
  run(120);
  const before = rendered[rendered.length - 1].players.find((p) => p.id === client.localId);
  run(1, { clientBtn: BTN.FIRE });
  // Sample the predicted entry on the very next frames, before authority for
  // the shot could possibly have arrived (one-way is 125ms ≈ 7.5 ticks).
  const soon = rendered.slice(-4).map((s) => s.players.find((p) => p.id === client.localId));
  const movedEarly = soon.some((m) => m && m.vel.y > before.vel.y + 5);
  const hpChangedEarly = soon.some((m) => m && m.hp !== before.hp);
  assert.ok(movedEarly, 'the impulse was not predicted');
  assert.ok(!hpChangedEarly, 'the client predicted its own self-damage — damage is host-only, MD 11 and MD 24');
  // and the host is the one that eventually takes the hp off
  run(40);
  const after = rendered[rendered.length - 1].players.find((p) => p.id === client.localId);
  assert.ok(after.hp < before.hp, `self-damage never arrived from authority (hp ${before.hp} → ${after.hp})`);
  ok('movement predicted, health not',
    `impulse landed within 4 frames; hp untouched locally, then ${before.hp} → ${after.hp} when authority said so`);
}

// ── 6. corrections and magnitude over a long firing run at real latency ────
/* Verification point 7 wants a correction count over minutes of play. The
   first version of this reported "8 corrections, max 106.4m" and that number
   was worthless: 80 point-blank self-blasts kill the player repeatedly, and a
   respawn teleport is a legitimate 100m+ snap with nothing to do with whether
   a rocket was predicted correctly. Corrections are ATTRIBUTED here, not just
   counted — one that follows a death is a respawn.
   The death has to be read in HOST time. Reading it off the client's rendered
   stream puts it an interp buffer plus half an RTT late, which is well after
   the correction it caused has already fired — the first attempt did that and
   classified all 8 as "other". */
{
  const { clock, room, host, client, rendered } = await pair('md24-f', 60);
  let fired = 0, deaths = 0, lastDeathTick = -999;
  let hostTickNow = 0;
  host.onSnapshot((s2) => {
    const me = s2.players.find((q) => q.id === client.localId);
    if (me && me.deaths > deaths) { deaths = me.deaths; lastDeathTick = hostTickNow; }
  });
  // A correction cannot precede the death that caused it, and cannot trail it
  // by more than the round trip plus a snapshot interval.
  const RESPAWN_WINDOW = 40;
  let prevCorr = 0, respawnCorr = 0, otherCorr = 0, worstOther = 0;
  for (let t = 0; t < 3720; t++) {
    const firing = t > 120 && t % 45 === 0;
    if (firing) fired++;
    host.sendCommand({ ...cmd({ x: 0, z: 0 }, 0, 0, 0), weapon: 1 });
    client.sendCommand({
      ...cmd({ x: t % 120 < 60 ? 1 : -1, z: 1 }, t * 0.01, LOOK_DOWN, firing ? BTN.FIRE : 0),
      weapon: 1,
    });
    hostTickNow = t;
    host.tick(); client.tick();
    clock.step(); room.pump();

    const pr = client.prediction;
    if (pr && pr.corrections > prevCorr) {
      if ((t - lastDeathTick) <= RESPAWN_WINDOW) respawnCorr += pr.corrections - prevCorr;
      else { otherCorr += pr.corrections - prevCorr; worstOther = Math.max(worstOther, pr.lastCorrection); }
      prevCorr = pr.corrections;
    }
  }
  const pr = client.prediction;
  console.log(`     [telemetry] 62s at 120ms RTT, ${fired} rockets, ${deaths} deaths: `
    + `${pr.corrections} corrections = ${respawnCorr} respawn teleports + ${otherCorr} other`);
  /* And the number that actually answers "did predicting rockets make
     multiplayer worse": the same 62 seconds of the same movement with the
     trigger never pulled. At 120ms RTT corrections are normal — MD 8's zero
     only ever held at zero latency — so the test is that firing does not add
     to them, not that they vanish. */
  let baseCorr = 0;
  {
    const b = await pair('md24-f', 60);
    for (let t = 0; t < 3720; t++) {
      b.host.sendCommand({ ...cmd({ x: 0, z: 0 }, 0, 0, 0), weapon: 1 });
      b.client.sendCommand({ ...cmd({ x: t % 120 < 60 ? 1 : -1, z: 1 }, t * 0.01, LOOK_DOWN, 0), weapon: 1 });
      b.host.tick(); b.client.tick();
      b.clock.step(); b.room.pump();
    }
    baseCorr = b.client.prediction.corrections;
  }
  console.log(`     [telemetry] same 62s with the trigger never pulled: ${baseCorr} corrections`);
  /* Firing adds a small, bounded residual and this does not try to hide it.
     The cause is the one MD 24 names and accepts: a predict sim holds no
     enemies and no serpents, so a rocket the host detonates early against a
     blob keeps flying on the client, and reconciliation corrects the
     difference like any other input. Sub-metre and a few times a minute is
     the cost; 367ms of inertness on every shot was the alternative. The
     bounds are set just above what was measured so a regression trips them. */
  const added = otherCorr - baseCorr;
  assert.ok(added <= 4,
    `firing added ${added} corrections over the no-firing baseline of ${baseCorr}`);
  assert.ok(worstOther < 1.5,
    `worst non-respawn correction ${worstOther.toFixed(2)}m — was 2.25m before this MD`);
  ok('correction telemetry over a minute of firing',
    `${fired} rockets, ${deaths} deaths → ${pr.corrections} corrections = ${respawnCorr} respawn `
    + `teleports + ${otherCorr} other, worst non-respawn ${worstOther.toFixed(2)}m; `
    + `the same movement without firing costs ${baseCorr}, so firing adds ${added} `
    + `(sub-metre, vs 2.25m before this MD)`);
}

console.log(`\nmd24.mjs: ${passed}/${passed} passed`);
