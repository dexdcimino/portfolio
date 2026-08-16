// sim/sim.js — the headless, deterministic, fixed-step simulation.
// Phase 3 scope: the full movement port (sim/movement.js) over the Phase 2
// world — dash, slide, jump buffer/coyote, walljump/cling, jetpack + fuel,
// grapple world-pull, pads, rings, kill floor, summit. Enemies/combat/cells
// arrive in Phase 5. The SHAPE of this file — createSim, step by commands,
// snapshot out — is the contract that does not change.
//
// Rules enforced by tests/guards.mjs: no Babylon, no Math.random, no wall
// clock. All time is `tick`; all randomness is rngFor(seed, ...salts).
import { PVP_DEFAULT } from '../config.js';
import { rngFor } from '../core/rng.js';
import { createEntities } from './entities.js';
import { createWorld } from './world.js';
import { buildLevel, tickPlatforms } from './level.js';
import { createPlayerState, stepPlayer, playerFlags, BTN, FLAG } from './movement.js';

export { BTN, FLAG }; // wire-format constants live with the movement port

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
    ents.players.set(id, createPlayerState(id, {
      x: (r() - 0.5) * 4, y: 4, z: 26 + (r() - 0.5) * 4,
    }));
    return id;
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
      const ctx = { world, level, tick, events };
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
        stepPlayer(ctx, p, commandsByPlayer?.get?.(p.id));
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
          summitDone: p.summitDone, deaths: p.deaths,
          // Rope endpoint for the renderer; null unless latched.
          grapple: p.grapple ? round(p.grapple.anchor) : null,
          flags: playerFlags(p),
        })),
        enemies: [],
        cells: [],
        events: lastEvents,
      };
    },
  };
}
