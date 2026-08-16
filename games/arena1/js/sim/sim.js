// sim/sim.js — the headless, deterministic, fixed-step simulation.
// Phase 2 scope: the real world — buildLevel's shapes, the substepped capsule
// mover, platform ticking (movers/blinkers/collapsers) with ground carry, and
// enough movement for the harnesses (ground walk/friction, air accel, jump
// with the wire-format buffer/coyote edges). The full movement port is Phase 3
// and replaces stepPlayer's middle; the SHAPE of this file — createSim, step
// by commands, snapshot out — is the contract that does not change.
//
// Rules enforced by tests/guards.mjs: no Babylon, no Math.random, no wall
// clock. All time is `tick`; all randomness is rngFor(seed, ...salts).
import { TUNE, SIM_DT, PVP_DEFAULT } from '../config.js';
import { rngFor } from '../core/rng.js';
import { createEntities } from './entities.js';
import { createWorld, CAPSULE_R, CAPSULE_HALF_H } from './world.js';
import { buildLevel, tickPlatforms } from './level.js';

// Button bitfield (ARENA1_STEPS "Wire formats")
export const BTN = { JUMP: 1, DASH: 2, SLIDE: 4, FIRE: 8, GRAPPLE: 16, JET: 32 };

// Player state flags (snapshot `flags` bitfield)
export const FLAG = { GROUNDED: 1, SLIDING: 2, DASHING: 4, JETTING: 8, GRAPPLING: 16, WALLSLIDING: 32 };

const JUMP_BUFFER_TICKS = 7;
const COYOTE_TICKS = 6;

export function createSim(seed, { pvp = PVP_DEFAULT } = {}) {
  const ents = createEntities();
  const world = createWorld();
  const level = buildLevel(world, rngFor(seed, 'level'));
  let tick = 0;
  let lastEvents = [];

  function addPlayer() {
    const id = ents.allocId();
    // Prototype spawn (0, 4, 26), with a seeded scatter so the seed shapes
    // the state from tick 0 — two seeds differ in bodies, not just a header.
    const r = rngFor(seed, 'spawn', id);
    ents.players.set(id, {
      id,
      pos: { x: (r() - 0.5) * 4, y: 4, z: 26 + (r() - 0.5) * 4 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0, pitch: 0,
      hp: 100, fuel: 100, fuelMax: 100, dashCharges: 1,
      grounded: false,
      groundPlatformId: null,
      wallN: null,
      prevButtons: 0,
      jumpBufferedAt: -Infinity,   // tick the last JUMP edge landed
      lastGroundedAt: -Infinity,   // tick we last stood on ground
    });
    return id;
  }

  function stepPlayer(p, cmd) {
    const move = cmd ? cmd.move : { x: 0, z: 0 };
    const buttons = cmd ? cmd.buttons : 0;
    const pressed = buttons & ~p.prevButtons;
    p.prevButtons = buttons;
    if (cmd) { p.yaw = cmd.yaw; p.pitch = cmd.pitch; }

    if (pressed & BTN.JUMP) p.jumpBufferedAt = tick;

    // Horizontal: prototype ground accel/friction vs air accel (subset —
    // dash/slide/jet/grapple arrive with the Phase 3 port).
    const wishX = Math.sin(p.yaw) * move.z + Math.cos(p.yaw) * move.x;
    const wishZ = Math.cos(p.yaw) * move.z - Math.sin(p.yaw) * move.x;
    const wishLen = Math.hypot(wishX, wishZ);
    const accel = p.grounded ? TUNE.ACCEL : TUNE.AIR_ACCEL;
    if (wishLen > 1e-6) {
      p.vel.x += (wishX / wishLen) * accel * SIM_DT;
      p.vel.z += (wishZ / wishLen) * accel * SIM_DT;
      const speed = Math.hypot(p.vel.x, p.vel.z);
      if (speed > TUNE.WALK && p.grounded) {
        const k = TUNE.WALK / speed;
        p.vel.x *= k; p.vel.z *= k;
      }
    } else if (p.grounded) {
      const f = Math.max(0, 1 - TUNE.FRICTION * SIM_DT);
      p.vel.x *= f; p.vel.z *= f;
    } else {
      const f = Math.max(0, 1 - TUNE.AIR_DRAG * SIM_DT);
      p.vel.x *= f; p.vel.z *= f;
    }

    // Jump: buffered edge + coyote, both tick-math (wire-format spec).
    const buffered = tick - p.jumpBufferedAt < JUMP_BUFFER_TICKS;
    const coyote = tick - p.lastGroundedAt < COYOTE_TICKS;
    if (buffered && (p.grounded || coyote)) {
      p.vel.y = TUNE.JUMP;
      p.grounded = false;
      p.jumpBufferedAt = -Infinity;
      p.lastGroundedAt = -Infinity;
    }

    // Gravity, then the world's capsule mover does integrate + depenetrate +
    // slide, and reports grounded / groundPlatformId / wallN back.
    p.vel.y += TUNE.G * SIM_DT;
    const res = world.moveCapsule(
      p.pos, p.vel,
      { x: p.vel.x * SIM_DT, y: p.vel.y * SIM_DT, z: p.vel.z * SIM_DT },
      CAPSULE_R, CAPSULE_HALF_H);
    p.pos = res.pos;
    p.vel = res.vel;
    p.grounded = res.grounded;
    p.groundPlatformId = res.groundPlatformId;
    p.wallN = res.wallN;
    if (p.grounded) p.lastGroundedAt = tick;
  }

  return {
    get tick() { return tick; },
    // Read-only for the render layer (Phase 4): level data to build meshes
    // from, world.raycast for blob shadows. One-directional reads only.
    get world() { return world; },
    get level() { return level; },
    addPlayer,
    // commandsByPlayer: Map<playerId, command|undefined> for THIS tick.
    step(commandsByPlayer) {
      const events = [];
      // Platforms first (prototype order), so ground carry uses fresh deltas
      // and a collapser sees who stood on it at the end of last tick.
      const standing = new Set();
      for (const p of ents.players.values()) {
        if (p.groundPlatformId != null) standing.add(p.groundPlatformId);
      }
      tickPlatforms(world, level, tick, standing, events);
      for (const p of ents.players.values()) {
        // Ride movers / fall with collapsers: positional carry, like the
        // prototype's groundMesh delta add.
        if (p.groundPlatformId != null) {
          const pl = level.platforms[p.groundPlatformId];
          if (pl) {
            p.pos.x += pl.lastDelta.x;
            p.pos.y += pl.lastDelta.y;
            p.pos.z += pl.lastDelta.z;
          }
        }
        stepPlayer(p, commandsByPlayer?.get?.(p.id));
      }
      lastEvents = events;
      tick++;
    },
    snapshot() {
      const round = (v) => ({ // stable serialization: kill float noise at the wire
        x: Math.round(v.x * 1e6) / 1e6,
        y: Math.round(v.y * 1e6) / 1e6,
        z: Math.round(v.z * 1e6) / 1e6,
      });
      return {
        tick, seed, pvp,
        players: [...ents.players.values()].map((p) => ({
          id: p.id, pos: round(p.pos), vel: round(p.vel),
          yaw: p.yaw, pitch: p.pitch,
          hp: p.hp, fuel: p.fuel, fuelMax: p.fuelMax, dashCharges: p.dashCharges,
          flags: (p.grounded ? FLAG.GROUNDED : 0),
        })),
        enemies: [],
        cells: [],
        events: lastEvents,
      };
    },
  };
}
