// sim/movement.js — the Phase 3 movement port: the prototype's update() body,
// same structure, same order, TUNE values from config UNCHANGED (reference/
// prototype.html lines 1007–1211). Differences from the prototype are
// mechanical, not behavioral: wall-clock dt → SIM_DT, keys → the command
// button bitfield (edges via prevButtons), Babylon rays → world queries, and
// moveWithCollisions → world.moveCapsule with the grounded step-up allowance
// standing in for the ellipsoid's lip roll-over (tests/stepup.mjs).
//
// Client input policy stays client-side (main.js): Space-in-midair-means-jet
// is resolved there and arrives as distinct JUMP/JET bits.
//
// Phase 3 scope per ARENA1_STEPS: dash, slide + slide-hop, jump buffer/coyote,
// walljump + wall-cling, jetpack + fuel + ground regen, grapple (WORLD pull
// only — enemies/cells are Phase 5 sim citizens), pads, rings, kill floor,
// summit. FIRE is reserved; shooting lands in Phase 5's combat.js.

import { TUNE, SIM_DT } from '../config.js';
import { CAPSULE_R, CAPSULE_HALF_H, raySphere, rayVCapsule } from './world.js';
import { SUMMIT_Y } from './level.js';

// Grapple/shoot hitspheres for enemies (Phase 5). Slightly over body radius,
// like the prototype picking against whole child-mesh hierarchies.
export const ENEMY_R = { blob: 0.75, wraith: 0.7, spike: 0.62 };

// Button bitfield (ARENA1_STEPS "Wire formats")
/* RESPAWN is a real input bit, not a client-side teleport, and it has to be.
   The sim is deterministic and every peer replays the same commands, so a
   player yanked back to spawn locally would desync against the host the moment
   it happened. Riding the command means host and clients apply it on the same
   tick, prediction reconciles it like any other input, and the transport does
   not care — it ships the whole command object rather than a packed bitfield,
   so widening this costs nothing on the wire. */
export const BTN = { JUMP: 1, DASH: 2, SLIDE: 4, FIRE: 8, GRAPPLE: 16, JET: 32, RESPAWN: 64 };

// Player state flags (snapshot `flags` bitfield). WALLNEAR extends the six
// specced bits: the client's Space policy (prototype: mid-air Space = jet
// UNLESS a wall is near, then it buffers a walljump) needs wall presence,
// which is sim state — without it the client would jet-burn during wall
// clings the prototype kicks off from.
export const FLAG = { GROUNDED: 1, SLIDING: 2, DASHING: 4, JETTING: 8, GRAPPLING: 16, WALLSLIDING: 32, WALLNEAR: 64 };

export const JUMP_BUFFER_TICKS = 7; // ≈ the prototype's 0.12s buffer
export const COYOTE_TICKS = 6;      // ≈ the prototype's 0.1s coyote

const EYE_H = 0.55;      // camera height above capsule center (prototype camH)
const KILL_Y = -25;
const RING_CD_TICKS = 72; // 1.2s, per-ring (global, like the prototype's r.cd)

/* MD 16 item 1 — grapple ARRIVAL. Pulling to the anchor and stopping left you
   hugging the face of whatever you grabbed, which made the grapple useless for
   reaching the thing you grappled. Arrival now overshoots (no damping — the
   whole movement system is built on carrying momentum) and adds an upward
   redirect DERIVED from the real lip height rather than a flat pop, which
   would sail over short ledges and fail to clear tall ones.
   All four numbers are metres/(m/s) and all of it goes through world.raycast,
   so it is deterministic and predicted on the client like any other movement. */
const LEDGE_PROBE = 1.5;    // how far above the anchor a walkable top may sit
const LEDGE_INSET = 0.35;   // step INTO the face before probing down, or the
                            // ray grazes the wall it is standing on instead of
                            // finding the surface above it
const LEDGE_MARGIN = 0.6;   // clear the lip by this much, so you land ON it
const LEDGE_WALKABLE_NY = 0.6;  // normal.y at or above this counts as a top
const NO_LEDGE_REDIRECT = 7;    // m/s, scaled by how vertical the face is
const RING_RADIUS = 2.4;

// One player's full movement state; sim.addPlayer uses this so the tests can
// fabricate players at arbitrary positions without reaching into the sim.
export function createPlayerState(id, pos) {
  return {
    id,
    pos: { ...pos },
    spawn: { ...pos },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0, pitch: 0,
    hp: 100, hurtT: 99,
    fuel: 100, fuelMax: 100,
    dashCharges: 2, dashCd: 0, dashT: 0, dashDir: { x: 0, z: 1 },
    // Far in the past, so a player who never jets regenerates immediately and
    // nothing about non-jetting play changes.
    lastJetTick: -1e9,
    sliding: false, jetting: false, wallsliding: false, fireCd: 0,
    weapon: 0, // 0 = zap (hitscan), 1 = rocket (MD 11); survives respawn, resets with the match
    grapple: null,               // { mode:'pull'|'yank'|'cell', ... } while latched
    grounded: false, groundPlatformId: null, wallN: null,
    summitDone: false, deaths: 0, kills: 0, cellsGot: 0,
    prevButtons: 0,
    jumpBufferedAt: -Infinity,
    lastGroundedAt: -Infinity,
  };
}

// Exported for enemies.js (touch damage) and combat.js (shots + splash).
// `from` applies the prototype's knockback: shoved away horizontally, popped
// up. `by` attributes a resulting death (MD 11: a self-kill must read as a
// self-kill in the feed, not as an enemy kill) — null means environment/PvE.
export function hurtPlayer(p, amount, events, from = null, by = null) {
  p.hp -= amount;
  p.hurtT = 0;
  if (from) {
    let ax = p.pos.x - from.x, az = p.pos.z - from.z;
    const al = Math.hypot(ax, az) || 1;
    ax /= al; az /= al;
    p.vel.x += ax * 9; p.vel.z += az * 9;
    p.vel.y = Math.max(p.vel.y, 6);
  }
  if (p.hp <= 0) {
    p.deaths++;
    p.hp = 100;
    p.fuel = p.fuelMax;
    p.pos = { ...p.spawn };
    p.vel = { x: 0, y: 0, z: 0 };
    p.grapple = null;
    events.push({ type: 'death', playerId: p.id, by });
  }
}

function collectCell(p, c, events) {
  c.taken = true;
  p.cellsGot++;
  p.fuelMax = Math.min(280, p.fuelMax + 20);
  p.fuel = p.fuelMax;
  // point: FX anchor for the pickup burst (renderer-facing extension)
  events.push({ type: 'pickup', cellId: c.id, playerId: p.id, point: { ...c.pos } });
}

// ctx: { world, level, tick, events }
export function stepPlayer(ctx, p, cmd) {
  const { world, level, tick, events } = ctx;
  const dt = SIM_DT;
  const move = cmd ? cmd.move : { x: 0, z: 0 };
  const buttons = cmd ? cmd.buttons : 0;
  const pressed = buttons & ~p.prevButtons;
  const released = ~buttons & p.prevButtons;
  p.prevButtons = buttons;
  if (cmd) { p.yaw = cmd.yaw; p.pitch = cmd.pitch; }
  // Weapon select rides the command (MD 11) — a sim action, not a display
  // toggle: the host must know which weapon fired.
  if (cmd && cmd.weapon !== undefined) p.weapon = cmd.weapon === 1 ? 1 : 0;

  // --- input wish direction (prototype lines 1008–1013)
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  let wx = move.x * cy + move.z * sy;
  let wz = -move.x * sy + move.z * cy;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }

  /* Respawn on the PRESS edge, before anything else this tick reads position:
     a held button would re-spawn every tick at 60Hz and pin the player to the
     pad. Not routed through hurtPlayer on purpose — this is a voluntary reset,
     so it does not count a death or credit a killer, but it clears exactly what
     dying clears so no stale grapple or fall velocity survives the trip. */
  if (pressed & BTN.RESPAWN) {
    p.pos = { ...p.spawn };
    p.vel = { x: 0, y: 0, z: 0 };
    p.grapple = null;
    p.hp = 100;
    p.fuel = p.fuelMax;
    p.sliding = false;
    p.dashT = 0;
    events.push({ type: 'respawn', playerId: p.id });
  }

  if (pressed & BTN.JUMP) p.jumpBufferedAt = tick;

  // --- dash: sustained, steerable surge (1042–1062)
  p.dashCd -= dt; p.dashT -= dt;
  if (p.dashCd <= 0 && p.dashCharges < 2) {
    p.dashCharges++;
    if (p.dashCharges < 2) p.dashCd = TUNE.DASH_CD;
  }
  if ((pressed & BTN.DASH) && p.dashCharges > 0) {
    p.dashCharges--; p.dashCd = TUNE.DASH_CD;
    let dx = wx, dz = wz;
    if (wl === 0) { dx = sy; dz = cy; } // no input: dash toward facing
    p.dashDir = { x: dx, z: dz };
    p.vel.y = Math.max(p.vel.y, 1.5);
    p.dashT = TUNE.DASH_T;
  }
  if (p.dashT > 0) {
    if (wl > 0) {
      p.dashDir.x += wx * 2.2 * dt; p.dashDir.z += wz * 2.2 * dt;
      const dl = Math.hypot(p.dashDir.x, p.dashDir.z) || 1;
      p.dashDir.x /= dl; p.dashDir.z /= dl;
    }
    p.vel.x = p.dashDir.x * TUNE.DASH;
    p.vel.z = p.dashDir.z * TUNE.DASH;
  }

  // --- slide (1064–1072)
  const hSpeed = Math.hypot(p.vel.x, p.vel.z);
  const slideKey = !!(buttons & BTN.SLIDE);
  if (!p.sliding && slideKey && p.grounded && hSpeed > 6) {
    p.sliding = true;
    const boost = Math.min(TUNE.SLIDE_MAX, hSpeed + 4.5) / Math.max(hSpeed, 0.01);
    p.vel.x *= boost; p.vel.z *= boost;
  }
  if (p.sliding && (!slideKey || hSpeed < 4.5)) p.sliding = false;

  // --- jump / walljump (1074–1087), buffer+coyote in tick math
  const buffered = tick - p.jumpBufferedAt < JUMP_BUFFER_TICKS;
  const coyote = tick - p.lastGroundedAt < COYOTE_TICKS;
  if (buffered) {
    if (p.grounded || coyote) {
      p.vel.y = TUNE.JUMP;
      p.grounded = false;
      p.jumpBufferedAt = -Infinity;
      p.lastGroundedAt = -Infinity;
      if (p.sliding) p.sliding = false;
    } else if (p.wallN) {
      p.vel.x = p.wallN.x * TUNE.WALLJUMP_OUT + wx * 3;
      p.vel.z = p.wallN.z * TUNE.WALLJUMP_OUT + wz * 3;
      p.vel.y = TUNE.WALLJUMP_UP;
      p.jumpBufferedAt = -Infinity;
    }
  }

  // --- jetpack (1089–1102)
  const jetting = !!(buttons & BTN.JET) && p.fuel > 0 && !p.grounded;
  p.jetting = jetting;
  if (jetting) {
    p.vel.y = Math.min(TUNE.JET_VMAX, p.vel.y + TUNE.JET_ACCEL * dt);
    p.fuel = Math.max(0, p.fuel - TUNE.JET_BURN * dt);
  }
  /* MD 20. Two rates and, in the air, a DELAY.

     MD 15 ungated regen, MD 16 split the air onto a lower rate — and neither
     killed tap-jetting, because a rate only sets a break-even duty cycle and
     you can always tap under it. The delay attacks the strategy directly: air
     regen does not begin until AIR_REGEN_DELAY_TICKS have passed with no jet
     input, and ANY jet input resets it. Holding altitude costs g/JET_ACCEL =
     58% duty, which never leaves a 2s gap, so a hovering player earns nothing.

     GROUND regen ignores the delay entirely, and that is deliberate: the delay
     exists to stop you loitering in the air, not to punish the thing we want
     you doing. Land and you refill immediately at the faster rate, so touching
     down stays unambiguously the efficient way to refuel. */
  if (jetting) p.lastJetTick = tick;
  const airReady = (tick - p.lastJetTick) >= TUNE.AIR_REGEN_DELAY_TICKS;
  const regen = p.grounded ? TUNE.FUEL_REGEN : (airReady ? TUNE.AIR_REGEN : 0);
  if (regen > 0 && p.fuel < p.fuelMax) {
    p.fuel = Math.min(p.fuelMax, p.fuel + regen * dt);
  }

  // --- grapple (588–618, 1104–1141): pull self toward world, yank enemies,
  // reel in cells — and pull self toward other PLAYERS. The original decision
  // ("players are never grapple targets") is superseded on Dex's instruction:
  // the beam used to pass through players and anchor on geometry behind them,
  // which READ as player-grappling; now it is real, sim-resolved against the
  // target's capsule. Players are pulled TOWARD, never yanked.
  const ents = ctx.ents; // absent in mechanic-only test harnesses
  if (pressed & BTN.GRAPPLE) {
    const eye = { x: p.pos.x, y: p.pos.y + EYE_H, z: p.pos.z };
    const cp = Math.cos(p.pitch);
    const dir = { x: sy * cp, y: -Math.sin(p.pitch), z: cy * cp };
    const wh = world.raycast(eye, dir, TUNE.GRAPPLE_RANGE);
    let best = wh ? { t: wh.t, hit: wh } : null;
    let target = null; // { mode, id }
    if (ents) {
      for (const e of ents.enemies.values()) {
        if (!e.alive) continue;
        const t = raySphere(eye, dir, e.pos, ENEMY_R[e.kind], best ? best.t : TUNE.GRAPPLE_RANGE);
        if (t !== null) { best = { t }; target = { mode: 'yank', id: e.id }; }
      }
      for (const c of ents.cells.values()) {
        if (c.taken) continue;
        const t = raySphere(eye, dir, c.pos, 0.5, best ? best.t : TUNE.GRAPPLE_RANGE);
        if (t !== null) { best = { t }; target = { mode: 'cell', id: c.id }; }
      }
      for (const q of ents.players.values()) {
        if (q.id === p.id) continue; // ghosts included: the client's predict
        // sim mirrors remote players as kinematic ghosts so both sides
        // resolve the same latch
        const t = rayVCapsule(eye, dir, q.pos, CAPSULE_R, CAPSULE_HALF_H, best ? best.t : TUNE.GRAPPLE_RANGE);
        if (t !== null) { best = { t }; target = { mode: 'player', id: q.id }; }
      }
    }
    if (target) {
      p.grapple = target.mode === 'yank' ? { mode: 'yank', enemyId: target.id }
        : target.mode === 'cell' ? { mode: 'cell', cellId: target.id }
          : { mode: 'player', targetId: target.id };
    } else if (best && best.hit) {
      const hit = best.hit;
      const platformId = hit.shape.platformId;
      let local = null;
      if (platformId != null) {
        // Mover anchors ride via platformId + local offset (spec).
        const pl = level.platforms[platformId];
        local = {
          x: hit.point.x - (pl.base.x + pl.offset.x),
          y: hit.point.y - (pl.base.y + pl.offset.y),
          z: hit.point.z - (pl.base.z + pl.offset.z),
        };
      }
      // The face normal is kept for the arrival redirect below. Movers only
      // translate, so a normal captured at fire time is still correct on
      // arrival. Not snapshotted — sim.snapshot serialises only the rope
      // endpoint — so this costs nothing on the wire.
      p.grapple = { mode: 'pull', anchor: { ...hit.point }, platformId, local, n: { ...hit.n } };
    } else {
      p.grapple = null;
    }
  }
  if (released & BTN.GRAPPLE) p.grapple = null; // momentum release: vel untouched
  if (p.grapple && p.grapple.mode === 'pull') {
    const g = p.grapple;
    if (g.platformId != null) {
      const pl = level.platforms[g.platformId];
      g.anchor = {
        x: pl.base.x + pl.offset.x + g.local.x,
        y: pl.base.y + pl.offset.y + g.local.y,
        z: pl.base.z + pl.offset.z + g.local.z,
      };
    }
    const tx = g.anchor.x - p.pos.x, ty = g.anchor.y - p.pos.y, tz = g.anchor.z - p.pos.z;
    const dist = Math.hypot(tx, ty, tz);
    if (dist < 2.2) {
      /* ARRIVAL. Note g.anchor was recomputed from the platform's CURRENT
         offset a few lines up, so on a mover this probes where the platform is
         now, not where it was when the hook left. */
      p.grapple = null;
      // (a) Overshoot: velocity is deliberately NOT damped any more. You carry
      //     the pull through the anchor instead of arriving dead.

      // (b) Ledge-aware redirect. Probe from inside the face, straight down,
      //     for a walkable top within LEDGE_PROBE above the anchor.
      const gn = g.n || { x: 0, y: 0, z: 0 };
      const probe = {
        x: g.anchor.x - gn.x * LEDGE_INSET,
        y: g.anchor.y + LEDGE_PROBE,
        z: g.anchor.z - gn.z * LEDGE_INSET,
      };
      const lip = world.raycast(probe, { x: 0, y: -1, z: 0 }, LEDGE_PROBE + LEDGE_INSET);
      if (lip && lip.n.y >= LEDGE_WALKABLE_NY && lip.point.y > p.pos.y) {
        // Exactly the launch that reaches the lip plus the margin: v = sqrt(2gh).
        // Derived, so a 0.4m kerb gets a hop and a 1.4m lip gets a real boost.
        const need = (lip.point.y + LEDGE_MARGIN) - p.pos.y;
        p.vel.y = Math.max(p.vel.y, Math.sqrt(2 * Math.abs(TUNE.G) * need));
      } else {
        // Nothing to land on. Scale the default by how vertical the face is —
        // full on a sheer wall, ~nothing on a floor or a ceiling — so grappling
        // the underside of a slab does not fire you into it.
        const verticality = 1 - Math.min(1, Math.abs(gn.y));
        p.vel.y = Math.max(p.vel.y, NO_LEDGE_REDIRECT * verticality);
      }
    } else {
      const k = Math.min(1, TUNE.GRAPPLE_ACCEL * dt);
      p.vel.x += (tx / dist * TUNE.GRAPPLE_PULL - p.vel.x) * k;
      p.vel.y += (ty / dist * TUNE.GRAPPLE_PULL - p.vel.y) * k;
      p.vel.z += (tz / dist * TUNE.GRAPPLE_PULL - p.vel.z) * k;
    }
  } else if (p.grapple && p.grapple.mode === 'yank') {
    const e = ents?.enemies.get(p.grapple.enemyId);
    if (!e || !e.alive) p.grapple = null;
    else {
      const tx = p.pos.x - e.pos.x, ty = p.pos.y - e.pos.y, tz = p.pos.z - e.pos.z;
      const dist = Math.hypot(tx, ty, tz);
      if (dist < 2.2) { p.grapple = null; e.vy = Math.max(e.vy, 3); }
      else {
        e.vx = tx / dist * 22; e.vy = ty / dist * 22; e.vz = tz / dist * 22;
        e.yanked = 0.2;
      }
    }
  } else if (p.grapple && p.grapple.mode === 'cell') {
    const c = ents?.cells.get(p.grapple.cellId);
    if (!c || c.taken) p.grapple = null;
    else {
      const tx = p.pos.x - c.pos.x, ty = p.pos.y - c.pos.y, tz = p.pos.z - c.pos.z;
      const dist = Math.hypot(tx, ty, tz);
      if (dist < 1.6) { collectCell(p, c, events); p.grapple = null; }
      else {
        c.pulled = true;
        c.pos.x += tx / dist * 30 * dt;
        c.pos.y += ty / dist * 30 * dt;
        c.pos.z += tz / dist * 30 * dt;
      }
    }
  } else if (p.grapple && p.grapple.mode === 'player') {
    // World-pull semantics with a MOVING anchor: the target player's capsule
    // center. The target is never moved — pulled toward, never yanked.
    const q = ents?.players.get(p.grapple.targetId);
    const dist = q ? Math.hypot(q.pos.x - p.pos.x, q.pos.y - p.pos.y, q.pos.z - p.pos.z) : Infinity;
    if (!q || dist > TUNE.GRAPPLE_RANGE * 1.25) {
      p.grapple = null; // target left, died-and-respawned far away, or line broke
    } else if (dist < 2.2) {
      p.grapple = null;
      p.vel.x *= 0.85; p.vel.y *= 0.85; p.vel.z *= 0.85;
    } else {
      const k = Math.min(1, TUNE.GRAPPLE_ACCEL * dt);
      p.vel.x += ((q.pos.x - p.pos.x) / dist * TUNE.GRAPPLE_PULL - p.vel.x) * k;
      p.vel.y += ((q.pos.y - p.pos.y) / dist * TUNE.GRAPPLE_PULL - p.vel.y) * k;
      p.vel.z += ((q.pos.z - p.pos.z) / dist * TUNE.GRAPPLE_PULL - p.vel.z) * k;
    }
  }
  const pulling = p.grapple !== null && (p.grapple.mode === 'pull' || p.grapple.mode === 'player');

  // --- accelerate — dash owns horizontal vel while active (1143–1168)
  if (p.dashT <= 0) {
    if (p.grounded) {
      if (p.sliding) {
        const f = Math.max(0, 1 - TUNE.SLIDE_FRICTION * dt);
        p.vel.x *= f; p.vel.z *= f;
        p.vel.x += wx * 8 * dt; p.vel.z += wz * 8 * dt;
      } else if (wl > 0) {
        const k = Math.min(1, TUNE.ACCEL * dt / TUNE.WALK);
        p.vel.x += (wx * TUNE.WALK - p.vel.x) * k;
        p.vel.z += (wz * TUNE.WALK - p.vel.z) * k;
      } else {
        const f = Math.max(0, 1 - TUNE.FRICTION * dt);
        p.vel.x *= f; p.vel.z *= f;
      }
    } else if (!pulling) {
      // air accel under the momentum ceiling: steering never ADDS speed
      // beyond max(current, WALK)
      const before = Math.max(Math.hypot(p.vel.x, p.vel.z), TUNE.WALK);
      p.vel.x += wx * TUNE.AIR_ACCEL * dt;
      p.vel.z += wz * TUNE.AIR_ACCEL * dt;
      const after = Math.hypot(p.vel.x, p.vel.z);
      if (after > before) { const k = before / after; p.vel.x *= k; p.vel.z *= k; }
      const drag = Math.max(0, 1 - TUNE.AIR_DRAG * dt);
      p.vel.x *= drag; p.vel.z *= drag;
    }
  }

  // --- gravity + wallslide (1170–1176)
  const gScale = pulling ? 0.25 : (jetting ? 0.55 : 1);
  p.vel.y += TUNE.G * gScale * dt;
  p.wallsliding = false;
  if (p.wallN && p.vel.y < 0 && (wx * -p.wallN.x + wz * -p.wallN.z) > 0.2) {
    p.vel.y = Math.max(p.vel.y, -3.5); // cling while steering into the wall
    p.wallsliding = true;
  }
  if (p.grounded && p.vel.y < 0) p.vel.y = -2; // ground stick for ramp descent

  // --- jump pads (1178–1185)
  for (let i = 0; i < level.pads.length; i++) {
    const pad = level.pads[i];
    const dx = p.pos.x - pad.x, dz = p.pos.z - pad.z;
    if (dx * dx + dz * dz < 4.6 && p.pos.y < 1.6 && p.vel.y <= 0.5) {
      p.vel.y = pad.power;
      p.grounded = false;
      events.push({ type: 'pad', padId: i, playerId: p.id });
    }
  }

  // --- boost rings (1187–1200); per-ring cooldown like the prototype's r.cd
  for (let i = 0; i < level.rings.length; i++) {
    const ring = level.rings[i];
    if (ring.cdUntil !== undefined && tick < ring.cdUntil) continue;
    const dx = p.pos.x - ring.pos.x, dy = p.pos.y - ring.pos.y, dz = p.pos.z - ring.pos.z;
    if (Math.hypot(dx, dy, dz) < RING_RADIUS) {
      ring.cdUntil = tick + RING_CD_TICKS;
      p.vel.x += ring.dir.x * 16;
      p.vel.z += ring.dir.z * 16;
      p.vel.y = Math.max(p.vel.y, ring.dir.y * 16 + 6);
      events.push({ type: 'ring', ringId: i, playerId: p.id });
    }
  }

  // --- integrate (1202–1204)
  const res = world.moveCapsule(
    p.pos, p.vel,
    { x: p.vel.x * dt, y: p.vel.y * dt, z: p.vel.z * dt },
    CAPSULE_R, CAPSULE_HALF_H,
    { stepUp: p.grounded });
  p.pos = res.pos;
  p.vel = res.vel;
  p.grounded = res.grounded;
  p.groundPlatformId = res.groundPlatformId;
  p.wallN = res.grounded ? null : res.wallN; // prototype: wall state is airborne-only
  if (p.grounded) p.lastGroundedAt = tick;

  // --- kill floor (1204)
  if (p.pos.y < KILL_Y) {
    p.pos = { x: p.spawn.x, y: 6, z: p.spawn.z };
    p.vel = { x: 0, y: 0, z: 0 };
    p.grapple = null;
    hurtPlayer(p, 15, events);
  }

  // --- fuel cells: touch pickup (1241–1251); cells are sim citizens
  if (ents) {
    for (const c of ents.cells.values()) {
      if (c.taken) continue;
      const d = Math.hypot(c.pos.x - p.pos.x, c.pos.y - p.pos.y, c.pos.z - p.pos.z);
      if (d < 1.7) {
        collectCell(p, c, events);
        if (p.grapple?.mode === 'cell' && p.grapple.cellId === c.id) p.grapple = null;
      }
    }
  }

  // --- summit (1206–1211)
  if (!p.summitDone && p.pos.y > SUMMIT_Y - 2
    && Math.abs(p.pos.x) < 9 && Math.abs(p.pos.z) < 9 && p.grounded) {
    p.summitDone = true;
    events.push({ type: 'summit', playerId: p.id });
  }

  // --- hp regen (1237–1239)
  p.hurtT += dt;
  if (p.hurtT > 4 && p.hp < 100) p.hp = Math.min(100, p.hp + 9 * dt);
}

export function playerFlags(p) {
  return (p.grounded ? FLAG.GROUNDED : 0)
    | (p.sliding ? FLAG.SLIDING : 0)
    | (p.dashT > 0 ? FLAG.DASHING : 0)
    | (p.jetting ? FLAG.JETTING : 0)
    | (p.grapple ? FLAG.GRAPPLING : 0)
    | (p.wallsliding ? FLAG.WALLSLIDING : 0)
    | (p.wallN ? FLAG.WALLNEAR : 0);
}
