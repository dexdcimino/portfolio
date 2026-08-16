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
import { CAPSULE_R, CAPSULE_HALF_H } from './world.js';
import { SUMMIT_Y } from './level.js';

// Button bitfield (ARENA1_STEPS "Wire formats")
export const BTN = { JUMP: 1, DASH: 2, SLIDE: 4, FIRE: 8, GRAPPLE: 16, JET: 32 };

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
    sliding: false, jetting: false, wallsliding: false,
    grapple: null,               // { anchor, platformId, local } while latched
    grounded: false, groundPlatformId: null, wallN: null,
    summitDone: false, deaths: 0, kills: 0, cellsGot: 0,
    prevButtons: 0,
    jumpBufferedAt: -Infinity,
    lastGroundedAt: -Infinity,
  };
}

function hurt(p, amount, events) {
  p.hp -= amount;
  p.hurtT = 0;
  if (p.hp <= 0) {
    p.deaths++;
    p.hp = 100;
    p.fuel = p.fuelMax;
    p.pos = { ...p.spawn };
    p.vel = { x: 0, y: 0, z: 0 };
    p.grapple = null;
    events.push({ type: 'death', playerId: p.id });
  }
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

  // --- input wish direction (prototype lines 1008–1013)
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  let wx = move.x * cy + move.z * sy;
  let wz = -move.x * sy + move.z * cy;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }

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
  if (p.grounded && p.fuel < p.fuelMax) {
    p.fuel = Math.min(p.fuelMax, p.fuel + TUNE.FUEL_REGEN * dt);
  }

  // --- grapple: world pull only in Phase 3 (588–618, 1104–1141)
  if (pressed & BTN.GRAPPLE) {
    const eye = { x: p.pos.x, y: p.pos.y + EYE_H, z: p.pos.z };
    const cp = Math.cos(p.pitch);
    const dir = { x: sy * cp, y: -Math.sin(p.pitch), z: cy * cp };
    const hit = world.raycast(eye, dir, TUNE.GRAPPLE_RANGE);
    if (hit) {
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
      p.grapple = { anchor: { ...hit.point }, platformId, local };
    } else {
      p.grapple = null;
    }
  }
  if (released & BTN.GRAPPLE) p.grapple = null; // momentum release: vel untouched
  if (p.grapple) {
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
      p.grapple = null;
      p.vel.x *= 0.85; p.vel.y *= 0.85; p.vel.z *= 0.85;
    } else {
      const k = Math.min(1, TUNE.GRAPPLE_ACCEL * dt);
      p.vel.x += (tx / dist * TUNE.GRAPPLE_PULL - p.vel.x) * k;
      p.vel.y += (ty / dist * TUNE.GRAPPLE_PULL - p.vel.y) * k;
      p.vel.z += (tz / dist * TUNE.GRAPPLE_PULL - p.vel.z) * k;
    }
  }
  const pulling = p.grapple !== null;

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
    hurt(p, 15, events);
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
