// sim/sim.js — the headless, deterministic, fixed-step simulation.
// Phase 5 scope: full movement (sim/movement.js), combat hitscan
// (sim/combat.js), and enemies + fuel cells as sim citizens (sim/enemies.js)
// over the Phase 2 world. The SHAPE of this file — createSim, step by
// commands, snapshot out — is the contract that does not change.
//
// Rules enforced by tests/guards.mjs: no Babylon, no Math.random, no wall
// clock. All time is `tick`; all randomness is rngFor(seed, ...salts).
import { PVP_DEFAULT } from '../config.js';
import { rngFor } from '../core/rng.js';
import { createEntities } from './entities.js';
import { createWorld } from './world.js';
import { buildLevel, tickPlatforms } from './level.js';
import { createPlayerState, stepPlayer, playerFlags, BTN, FLAG } from './movement.js';
import { initEnemies, stepEnemies } from './enemies.js';
import { stepCombat } from './combat.js';

export { BTN, FLAG }; // wire-format constants live with the movement port

// opts.enemies=false is a TEST hook: mechanic/settling suites need a world
// where nothing hops over and bounces the subject mid-assert. Gameplay and
// the combat determinism suite run the default.
export function createSim(seed, { pvp = PVP_DEFAULT, enemies = true } = {}) {
  const ents = createEntities();
  const world = createWorld();
  const level = buildLevel(world, rngFor(seed, 'level'));
  let tick = 0;
  let lastEvents = [];

  // Cells first (level-derived, fixed count), then enemies — a fixed id
  // layout every peer reproduces from the seed.
  for (const pos of level.cellSpots) {
    const id = ents.allocId();
    ents.cells.set(id, { id, pos: { ...pos }, base: { ...pos }, taken: false, pulled: false });
  }
  if (enemies) initEnemies(ents, level, seed);

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

  // Host-side departure (Phase 7): a peer left, its body leaves the match.
  // Ids are never reused (allocId is monotonic), so a stale wire reference
  // to a removed player simply resolves to nothing.
  function removePlayer(id) {
    ents.players.delete(id);
  }

  return {
    get tick() { return tick; },
    get pvp() { return pvp; },
    // Read-only for the render layer (Phase 4): level data to build meshes
    // from, world.raycast for blob shadows. One-directional reads only.
    get world() { return world; },
    get level() { return level; },
    addPlayer,
    removePlayer,
    // commandsByPlayer: Map<playerId, command|undefined> for THIS tick.
    step(commandsByPlayer) {
      const events = [];
      const ctx = { world, level, tick, events, ents, pvp };
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
        const cmd = commandsByPlayer?.get?.(p.id);
        stepPlayer(ctx, p, cmd);
        stepCombat(ctx, p, cmd ? cmd.buttons : 0);
      }
      stepEnemies(ctx);
      lastEvents = events;
      tick++;
    },
    snapshot() {
      const round = (v) => ({ // stable serialization: kill float noise at the wire
        x: Math.round(v.x * 1e6) / 1e6,
        y: Math.round(v.y * 1e6) / 1e6,
        z: Math.round(v.z * 1e6) / 1e6,
      });
      // Rope endpoint per grapple mode — the renderer draws to this.
      const ropeEnd = (p) => {
        if (!p.grapple) return null;
        if (p.grapple.mode === 'pull') return round(p.grapple.anchor);
        if (p.grapple.mode === 'yank') {
          const e = ents.enemies.get(p.grapple.enemyId);
          return e ? round(e.pos) : null;
        }
        const c = ents.cells.get(p.grapple.cellId);
        return c ? round(c.pos) : null;
      };
      return {
        tick, seed, pvp,
        players: [...ents.players.values()].map((p) => ({
          id: p.id, pos: round(p.pos), vel: round(p.vel),
          yaw: p.yaw, pitch: p.pitch,
          hp: p.hp, fuel: p.fuel, fuelMax: p.fuelMax, dashCharges: p.dashCharges,
          summitDone: p.summitDone, deaths: p.deaths, kills: p.kills, cellsGot: p.cellsGot,
          grapple: ropeEnd(p),
          flags: playerFlags(p),
        })),
        enemies: [...ents.enemies.values()].filter((e) => e.alive).map((e) => ({
          id: e.id, kind: e.kind, pos: round(e.pos), hp: e.hp,
        })),
        cells: [...ents.cells.values()].filter((c) => !c.taken).map((c) => ({
          id: c.id, pos: round(c.pos),
        })),
        events: lastEvents,
      };
    },
  };
}
