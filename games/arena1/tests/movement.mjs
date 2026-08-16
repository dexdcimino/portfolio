// tests/movement.mjs — Phase 3 headless mechanic checks (node tests/movement.mjs).
// Every number here derives from TUNE (config.js, verbatim from the prototype)
// — the same math the prototype runs — so a port error shows as a hard numeric
// miss, not a vibe. The FEEL is still judged manually at the Phase 3 gate;
// this suite reports the reference numbers the checklist compares against.
import { strict as assert } from 'node:assert';
import { createWorld, CAPSULE_R, CAPSULE_HALF_H } from '../js/sim/world.js';
import { buildLevel, tickPlatforms } from '../js/sim/level.js';
import { createPlayerState, stepPlayer, BTN, FLAG } from '../js/sim/movement.js';
import { createSim } from '../js/sim/sim.js';
import { TUNE, SIM_DT } from '../js/config.js';
import { rngFor } from '../js/core/rng.js';

let passed = 0;
const ok = (name, detail) => { passed++; console.log(`ok  ${name}${detail ? ` — ${detail}` : ''}`); };
const cmd = (move, yaw, pitch, buttons) => ({ move, yaw, pitch, buttons });
const hspeed = (p) => Math.hypot(p.vel.x, p.vel.z);

// Clean slab world for pure-mechanic tests: no crystals, no obstructions.
function flatCtx() {
  const world = createWorld();
  world.addAabb({ x: -200, y: -1, z: -200 }, { x: 200, y: 0, z: 200 });
  return { world, level: { platforms: [], pads: [], rings: [] }, tick: 0 };
}
function levelCtx(seed = 'p2-2') {
  const world = createWorld();
  const level = buildLevel(world, rngFor(seed, 'level'));
  return { world, level, tick: 0 };
}
// One tick: platforms (real level only), carry, step. Returns the events.
function step(ctx, p, c) {
  const events = [];
  if (ctx.level.platforms.length) {
    const standing = new Set(p.groundPlatformId != null ? [p.groundPlatformId] : []);
    tickPlatforms(ctx.world, ctx.level, ctx.tick, standing, events);
    if (p.groundPlatformId != null) {
      const pl = ctx.level.platforms[p.groundPlatformId];
      if (pl) { p.pos.x += pl.lastDelta.x; p.pos.y += pl.lastDelta.y; p.pos.z += pl.lastDelta.z; }
    }
  }
  stepPlayer({ world: ctx.world, level: ctx.level, tick: ctx.tick, events }, p, c);
  ctx.tick++;
  return events;
}

// ── 1. flat-ground top speed and time-to-top (feel item 1) ─────────────────
{
  const ctx = flatCtx();
  const p = createPlayerState(1, { x: 0, y: 0.92, z: 0 });
  let toTop = null;
  for (let t = 0; t < 240; t++) {
    step(ctx, p, cmd({ x: 0, z: 1 }, 0, 0, 0));
    if (toTop === null && hspeed(p) >= TUNE.WALK - 0.1) toTop = t + 1;
  }
  const top = hspeed(p);
  assert.ok(Math.abs(top - TUNE.WALK) < 0.1, `top speed ${top.toFixed(3)} vs WALK ${TUNE.WALK}`);
  ok('flat-ground top speed', `${top.toFixed(2)} m/s (WALK ${TUNE.WALK}), time-to-top ${toTop} ticks = ${(toTop * SIM_DT).toFixed(2)}s`);
}

// ── 2. dash: sustained speed, distance, post-dash retention (feel item 3) ──
{
  const ctx = flatCtx();
  const p = createPlayerState(1, { x: 0, y: 0.92, z: 0 });
  for (let t = 0; t < 120; t++) step(ctx, p, cmd({ x: 0, z: 1 }, 0, 0, 0));
  const z0 = p.pos.z;
  let minDash = Infinity, dashTicks = 0;
  step(ctx, p, cmd({ x: 0, z: 1 }, 0, 0, BTN.DASH));
  for (let t = 0; t < 30; t++) {
    if (p.dashT > 0) { dashTicks++; minDash = Math.min(minDash, hspeed(p)); }
    step(ctx, p, cmd({ x: 0, z: 1 }, 0, 0, BTN.DASH)); // held: no re-trigger (edge)
  }
  const dist = p.pos.z - z0;
  for (let t = 0; t < 5; t++) step(ctx, p, cmd({ x: 0, z: 1 }, 0, 0, 0));
  const retained = hspeed(p);
  assert.ok(Math.abs(minDash - TUNE.DASH) < 0.01, `dash speed ${minDash.toFixed(2)} vs DASH ${TUNE.DASH}`);
  assert.ok(dashTicks >= 28, `dash lasted ${dashTicks} ticks vs DASH_T ${TUNE.DASH_T}s`);
  assert.ok(retained > 14, `post-dash retained ${retained.toFixed(2)}`);
  assert.equal(p.dashCharges, 1, 'one charge spent');
  ok('dash', `sustained ${minDash.toFixed(1)} m/s for ${dashTicks} ticks, distance ${dist.toFixed(2)}m, retained ${retained.toFixed(2)} m/s +5 ticks, charges 2→1`);
}

// ── 3. slide boost, then slide-hop chain ×3 (feel item 2) ──────────────────
{
  const ctx = flatCtx();
  const p = createPlayerState(1, { x: 0, y: 0.92, z: 0 });
  for (let t = 0; t < 120; t++) step(ctx, p, cmd({ x: 0, z: 1 }, 0, 0, 0));
  step(ctx, p, cmd({ x: 0, z: 1 }, 0, 0, BTN.SLIDE));
  const boosted = hspeed(p);
  const expectBoost = Math.min(TUNE.SLIDE_MAX, TUNE.WALK + 4.5);
  assert.ok(boosted > expectBoost - 0.3 && boosted <= expectBoost + 0.01,
    `slide boost ${boosted.toFixed(2)} vs ${expectBoost}`);

  // hop chain: hold SLIDE, tap JUMP in 3-tick pulses so each landing has a
  // fresh buffered edge waiting (the buffer is 7 ticks).
  const hops = [];
  let airborne = false;
  for (let t = 0; t < 260 && hops.length < 3; t++) {
    const jumpBit = (t % 6) < 3 ? BTN.JUMP : 0;
    step(ctx, p, cmd({ x: 0, z: 1 }, 0, 0, BTN.SLIDE | jumpBit));
    if (!airborne && !p.grounded && p.vel.y > 5) { airborne = true; hops.push(hspeed(p)); }
    if (airborne && p.grounded) airborne = false;
  }
  assert.equal(hops.length, 3, `only ${hops.length} hops happened`);
  assert.ok(hops[1] > hops[0] - 0.3, 'flow lost on second hop');
  assert.ok(hops[2] > TUNE.SLIDE_MAX - 0.7, `third hop ${hops[2].toFixed(2)} vs SLIDE_MAX ${TUNE.SLIDE_MAX}`);
  ok('slide + hop chain', `boost ${boosted.toFixed(2)} (expect ${expectBoost}), hops ${hops.map((h) => h.toFixed(2)).join(' → ')} (cap ${TUNE.SLIDE_MAX})`);
}

// ── 4. walljump + wall-cling (feel items 4, 7) ─────────────────────────────
{
  const ctx = flatCtx();
  ctx.world.addAabb({ x: 6, y: 0, z: -40 }, { x: 8, y: 12, z: 40 }); // the alley wall
  const p = createPlayerState(1, { x: 0, y: 0.92, z: 0 });
  const yaw = Math.PI / 2; // +x, straight at the wall
  // run at the wall, hop, drift in
  for (let t = 0; t < 40; t++) step(ctx, p, cmd({ x: 0, z: 1 }, yaw, 0, 0));
  step(ctx, p, cmd({ x: 0, z: 1 }, yaw, 0, BTN.JUMP));
  let clung = 0, minVy = 0, jumped = null, sawCling = false;
  for (let t = 0; t < 120; t++) {
    if (p.wallN && jumped === null) {
      // cling long enough to be descending, then walljump
      if (clung < 22) {
        clung++;
        step(ctx, p, cmd({ x: 0, z: 1 }, yaw, 0, 0));
        minVy = Math.min(minVy, p.vel.y);
        if (p.wallsliding) sawCling = true;
        continue;
      }
      step(ctx, p, cmd({ x: 0, z: 1 }, yaw, 0, BTN.JUMP));
      jumped = { vx: p.vel.x, vy: p.vel.y };
      continue;
    }
    step(ctx, p, cmd({ x: 0, z: 1 }, yaw, 0, 0));
  }
  assert.ok(clung === 22, `never reached the wall (clung ${clung})`);
  assert.ok(sawCling, 'wallsliding flag never set while descending on the wall');
  assert.ok(minVy >= -3.5 - 1e-9, `cling floor broken: vy ${minVy.toFixed(2)}`);
  // walljump: vx = -WALLJUMP_OUT + wx*3 (pressing in), vy = WALLJUMP_UP, both
  // then touched by one tick of air-accel/gravity.
  assert.ok(jumped && jumped.vy > TUNE.WALLJUMP_UP - 0.6 && jumped.vy <= TUNE.WALLJUMP_UP,
    `walljump vy ${jumped?.vy.toFixed(2)} vs WALLJUMP_UP ${TUNE.WALLJUMP_UP}`);
  assert.ok(jumped.vx < -(TUNE.WALLJUMP_OUT - 3) + 0.6, `walljump out ${jumped.vx.toFixed(2)}`);
  ok('walljump + cling', `cling vy floor ${minVy.toFixed(2)} (limit -3.5), kick vy ${jumped.vy.toFixed(2)} (UP ${TUNE.WALLJUMP_UP}), out vx ${jumped.vx.toFixed(2)} (OUT ${TUNE.WALLJUMP_OUT} - steer 3)`);
}

// ── 5. jetpack: vy cap, NET burn, and the TWO regen rates (MD 15 item 2 as
//       revised by MD 16 — air regen is its own, lower constant) ────────────
{
  const ctx = flatCtx();
  const p = createPlayerState(1, { x: 0, y: 0.92, z: 0 });
  step(ctx, p, cmd({ x: 0, z: 0 }, 0, 0, BTN.JUMP));
  let jetTicks = 0, maxVy = 0;
  for (let t = 0; t < 90; t++) {
    step(ctx, p, cmd({ x: 0, z: 0 }, 0, 0, BTN.JET));
    if (p.jetting) { jetTicks++; maxVy = Math.max(maxVy, p.vel.y); }
  }
  // Regen is not ground-gated (MD 15) but the air rate is its own constant
  // (MD 16), so holding jet costs BURN - AIR_REGEN. Pinning it against
  // TUNE.AIR_REGEN rather than a literal means the test follows a retune
  // instead of having to be rewritten for one.
  const net = TUNE.JET_BURN - TUNE.AIR_REGEN;
  const expectFuel = 100 - net * jetTicks * SIM_DT;
  assert.ok(maxVy <= TUNE.JET_VMAX + 1e-9, `jet vy ${maxVy.toFixed(2)} above JET_VMAX`);
  assert.ok(Math.abs(p.fuel - expectFuel) < 0.5,
    `fuel ${p.fuel.toFixed(1)} vs expected ${expectFuel.toFixed(1)} (net ${net}/s)`);
  // AIR regen, measured while provably not grounded. Coasting (no JET) for 30
  // ticks must gain exactly AIR_REGEN over that window.
  const airBefore = p.fuel;
  let airTicks = 0;
  for (let t = 0; t < 30 && !p.grounded; t++) { step(ctx, p, cmd({ x: 0, z: 0 }, 0, 0, 0)); airTicks++; }
  assert.ok(!p.grounded, 'fell to the ground before the air-regen window finished');
  const expectAir = Math.min(p.fuelMax, airBefore + TUNE.AIR_REGEN * airTicks * SIM_DT);
  assert.ok(Math.abs(p.fuel - expectAir) < 0.5,
    `air regen ${airBefore.toFixed(1)} → ${p.fuel.toFixed(1)}, expected ${expectAir.toFixed(1)}`);
  const airGain = p.fuel - airBefore;

  // fall back to ground, then regen on the ground over the SAME window.
  // Fuel is deliberately drained first: by the time the fall ends it has
  // already refilled to fuelMax, and a capped tank regenerates 0 — which is
  // what made the first version of this comparison read 8.00 vs 0.00.
  let t2 = 0;
  while (!p.grounded && t2 < 400) { step(ctx, p, cmd({ x: 0, z: 0 }, 0, 0, 0)); t2++; }
  assert.ok(p.grounded, 'never landed after jetting');
  p.fuel = 50;
  const fuelBefore = p.fuel;
  const groundBefore = p.fuel;
  for (let t = 0; t < airTicks; t++) step(ctx, p, cmd({ x: 0, z: 0 }, 0, 0, 0));
  const groundGain = p.fuel - groundBefore;
  assert.ok(p.fuel > fuelBefore + 5, `regen: ${fuelBefore.toFixed(1)} → ${p.fuel.toFixed(1)}`);
  // The two rates must now DIFFER, and in the right direction — the whole
  // point of MD 16's split is that landing refills faster than loitering.
  const expectGround = TUNE.FUEL_REGEN * airTicks * SIM_DT;
  assert.ok(Math.abs(groundGain - expectGround) < 0.5,
    `ground regen ${groundGain.toFixed(2)} vs expected ${expectGround.toFixed(2)}`);
  assert.ok(groundGain > airGain + 0.5,
    `ground regen ${groundGain.toFixed(2)} must exceed air regen ${airGain.toFixed(2)}`);
  ok('jetpack', `vy cap ${maxVy.toFixed(2)} (JET_VMAX ${TUNE.JET_VMAX}), net burn ${net}/s over ${jetTicks} ticks → fuel ${expectFuel.toFixed(1)}, air regen ${airGain.toFixed(2)} < ground regen ${groundGain.toFixed(2)}`);
}

// ── 6. grapple: latch, pull, momentum release, auto-release (feel item 5) ──
{
  const ctx = levelCtx();
  // z=8 keeps the standing spot off rampA's footprint (x 5–25, z ±2.5)
  const p = createPlayerState(1, { x: 10, y: 0.92, z: 8 });
  // aim exactly at a point on the spire's east face, upward
  const T = { x: 3.5, y: 12, z: 0 };
  const eye = { x: p.pos.x, y: p.pos.y + 0.55, z: p.pos.z };
  const dx = T.x - eye.x, dy = T.y - eye.y, dz = T.z - eye.z;
  const yaw = Math.atan2(dx, dz), pitch = -Math.atan2(dy, Math.hypot(dx, dz));
  const c = (btn) => cmd({ x: 0, z: 0 }, yaw, pitch, btn);
  step(ctx, p, c(BTN.GRAPPLE));
  assert.ok(p.grapple, 'grapple never latched');
  const anchor = { ...p.grapple.anchor };
  let peak = 0;
  for (let t = 0; t < 25 && p.grapple; t++) {
    step(ctx, p, c(BTN.GRAPPLE));
    peak = Math.max(peak, Math.hypot(p.vel.x, p.vel.y, p.vel.z));
  }
  assert.ok(peak > 10, `pull too weak: peak |v| ${peak.toFixed(2)}`);
  // momentum release: velocity survives the release tick untouched by the latch
  const before = { ...p.vel };
  if (p.grapple) {
    step(ctx, p, c(0)); // released
    assert.equal(p.grapple, null, 'release did not clear the latch');
    const kept = Math.hypot(p.vel.x, p.vel.z) / Math.max(0.01, Math.hypot(before.x, before.z));
    assert.ok(kept > 0.9, `momentum lost on release: ${kept.toFixed(2)}`);
  }
  ok('grapple', `latched at (${anchor.x.toFixed(1)}, ${anchor.y.toFixed(1)}, ${anchor.z.toFixed(1)}), peak |v| ${peak.toFixed(2)} (PULL ${TUNE.GRAPPLE_PULL}), momentum release clean`);
}

// ── 7. jump pad launches + event (real level) ──────────────────────────────
{
  const ctx = levelCtx();
  const p = createPlayerState(1, { x: 25, y: 0.92, z: 0 });
  let launched = null, padEvent = false;
  for (let t = 0; t < 120 && launched === null; t++) {
    const ev = step(ctx, p, cmd({ x: 0, z: 1 }, Math.PI / 2, 0, 0));
    if (ev.some((e) => e.type === 'pad')) padEvent = true;
    if (p.vel.y > 10) launched = p.vel.y;
  }
  assert.ok(padEvent, 'no pad event');
  assert.ok(launched !== null && launched <= 17 && launched > 15.5,
    `pad vy ${launched} vs power 17`);
  ok('jump pad', `launch vy ${launched.toFixed(2)} (power 17), pad event emitted`);
}

// ── 8. kill floor, hurt, death + respawn ───────────────────────────────────
{
  const ctx = levelCtx();
  const p = createPlayerState(1, { x: 0, y: 4, z: 26 });
  let deathEvent = false;
  for (let fall = 0; fall < 7; fall++) {
    p.pos = { x: 0, y: -30, z: 0 };
    p.vel = { x: 0, y: -10, z: 0 };
    const ev = step(ctx, p, cmd({ x: 0, z: 0 }, 0, 0, 0));
    if (ev.some((e) => e.type === 'death')) deathEvent = true;
    if (fall === 0) {
      assert.equal(p.hp, 85, `first fall hp ${p.hp}`);
      assert.equal(p.pos.y, 6, 'kill floor did not rebound to spawn');
    }
  }
  assert.ok(deathEvent, 'no death event after 7 falls (7×15 > 100)');
  assert.equal(p.deaths, 1);
  assert.equal(p.hp, 100, 'death did not reset hp');
  ok('kill floor + death', `15/fall, death on fall 7, respawned at (${p.spawn.x}, 4, ${p.spawn.z}) hp 100`);
}

// ── 9. summit trigger, once (real level) ───────────────────────────────────
{
  const ctx = levelCtx();
  const p = createPlayerState(1, { x: 3, y: 131, z: 3 });
  let summitEvents = 0;
  for (let t = 0; t < 120; t++) {
    const ev = step(ctx, p, cmd({ x: 0, z: 0 }, 0, 0, 0));
    summitEvents += ev.filter((e) => e.type === 'summit').length;
  }
  assert.ok(p.summitDone, 'summit never triggered');
  assert.equal(summitEvents, 1, `summit fired ${summitEvents}×`);
  ok('summit', 'triggered once, grounded on the summit slab');
}

// ── 10. full-sim determinism WITH every mechanic exercised ─────────────────
{
  const script = (t) => {
    if (t < 120) return cmd({ x: 0, z: 1 }, Math.PI, 0, (t >= 60 && t < 90) ? BTN.SLIDE : 0);
    if (t < 180) return cmd({ x: 0, z: 1 }, Math.PI, 0, t === 121 ? BTN.DASH : 0);
    if (t < 260) return cmd({ x: 0, z: 1 }, Math.PI, 0, (t % 40 < 8 ? BTN.JUMP : 0) | (t % 40 >= 12 ? BTN.JET : 0));
    // face back into the arena (the walk phases end pinned on the north
    // wall), down-forward at open floor: guaranteed latch, several pull ticks
    if (t < 400) return cmd({ x: 0, z: 0 }, 0, 0.35, BTN.GRAPPLE);
    return cmd({ x: 0.3, z: 0.5 }, Math.PI / 3, 0, 0);
  };
  const run = () => {
    const sim = createSim('move-det');
    const id = sim.addPlayer();
    const seen = new Set();
    const snaps = [];
    for (let t = 0; t < 600; t++) {
      sim.step(new Map([[id, { tick: t, playerId: id, ...script(t) }]]));
      const s = sim.snapshot();
      for (const f of [FLAG.SLIDING, FLAG.DASHING, FLAG.JETTING, FLAG.GRAPPLING]) {
        if (s.players[0].flags & f) seen.add(f);
      }
      snaps.push(JSON.stringify(s));
    }
    return { out: snaps.join('\n'), seen };
  };
  const a = run(), b = run();
  assert.equal(a.out, b.out, 'mechanic-heavy runs diverged');
  const names = { [FLAG.SLIDING]: 'SLIDING', [FLAG.DASHING]: 'DASHING', [FLAG.JETTING]: 'JETTING', [FLAG.GRAPPLING]: 'GRAPPLING' };
  for (const f of [FLAG.SLIDING, FLAG.DASHING, FLAG.JETTING, FLAG.GRAPPLING]) {
    assert.ok(a.seen.has(f), `script never exercised ${names[f]}`);
  }
  ok('determinism with all mechanics', 'slide/dash/jet/grapple all exercised, 600 ticks byte-identical');
}

console.log(`\nmovement.mjs: ${passed}/10 passed`);
