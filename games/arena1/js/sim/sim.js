// sim/sim.js — the headless, deterministic, fixed-step simulation.
// Phase 1 scope: one hardcoded floor AABB, gravity, and enough movement for
// the determinism harness (ground walk/friction, air accel, jump with the
// wire-format buffer/coyote edges). The full movement port is Phase 3 and
// replaces the mover here; the SHAPE of this file — createSim, step by
// commands, snapshot out — is the contract that does not change.
//
// Rules enforced by tests/guards.mjs: no Babylon, no Math.random, no wall
// clock. All time is `tick`; all randomness is rngFor(seed, ...salts).
import { TUNE, SIM_DT, PVP_DEFAULT } from '../config.js';
import { rngFor } from '../core/rng.js';
import { createEntities } from './entities.js';

// Button bitfield (ARENA1_STEPS "Wire formats")
export const BTN = { JUMP: 1, DASH: 2, SLIDE: 4, FIRE: 8, GRAPPLE: 16, JET: 32 };

// Player state flags (snapshot `flags` bitfield)
export const FLAG = { GROUNDED: 1, SLIDING: 2, DASHING: 4, JETTING: 8, GRAPPLING: 16, WALLSLIDING: 32 };

const JUMP_BUFFER_TICKS = 7;
const COYOTE_TICKS = 6;

// Phase 1 world: one floor slab. Replaced by sim/world.js in Phase 2.
const FLOOR = { min: { x: -60, y: -1, z: -60 }, max: { x: 60, y: 0, z: 60 } };
const CAPSULE_HALF_H = 0.9; // matches the prototype ellipsoid (r 0.4 in Phase 2)

export function createSim(seed, { pvp = PVP_DEFAULT } = {}) {
  const ents = createEntities();
  let tick = 0;

  function addPlayer() {
    const id = ents.allocId();
    // Seeded spawn scatter: the seed must shape the world from tick 0, so two
    // different seeds produce genuinely different states, not just a header.
    const r = rngFor(seed, 'spawn', id);
    ents.players.set(id, {
      id,
      pos: { x: (r() - 0.5) * 4, y: 6, z: (r() - 0.5) * 4 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0, pitch: 0,
      hp: 100, fuel: 100, fuelMax: 100, dashCharges: 1,
      grounded: false,
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

    // Gravity + integrate
    p.vel.y += TUNE.G * SIM_DT;
    p.pos.x += p.vel.x * SIM_DT;
    p.pos.y += p.vel.y * SIM_DT;
    p.pos.z += p.vel.z * SIM_DT;

    // Phase 1 collision: rest on the floor slab (feet = pos.y - halfH).
    const overFloor = p.pos.x >= FLOOR.min.x && p.pos.x <= FLOOR.max.x
      && p.pos.z >= FLOOR.min.z && p.pos.z <= FLOOR.max.z;
    const feet = p.pos.y - CAPSULE_HALF_H;
    if (overFloor && feet <= FLOOR.max.y && p.vel.y <= 0) {
      p.pos.y = FLOOR.max.y + CAPSULE_HALF_H;
      p.vel.y = 0;
      p.grounded = true;
    } else {
      p.grounded = false;
    }
    if (p.grounded) p.lastGroundedAt = tick;
  }

  return {
    get tick() { return tick; },
    addPlayer,
    // commandsByPlayer: Map<playerId, command|undefined> for THIS tick.
    step(commandsByPlayer) {
      for (const p of ents.players.values()) {
        stepPlayer(p, commandsByPlayer?.get?.(p.id));
      }
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
        events: [],
      };
    },
  };
}
