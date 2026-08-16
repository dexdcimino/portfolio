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
import { stepCombat, stepRockets } from './combat.js';
import { stepSerpents, stepBolts, spawnSerpent, TIER_NAMES, segMaxHp } from './serpent.js';

export { BTN, FLAG }; // wire-format constants live with the movement port

// opts.enemies=false is a TEST hook: mechanic/settling suites need a world
// where nothing hops over and bounces the subject mid-assert. Gameplay and
// the combat determinism suite run the default.
//
// opts.predictOnly (ARENA1 MD 8) is the net client's local prediction sim:
// one player stepped against the world through the UNMODIFIED movement port,
// with everything authoritative-only switched off — no cells (pickups are
// never predicted), no enemies, no combat (damage/kills are never predicted).
// Platforms still tick: movers and collapse timing shape movement.
export function createSim(seed, { pvp = PVP_DEFAULT, enemies = true, predictOnly = false,
  // Debug only (?serpent=low): drops every tier into one low band so all
  // three can be looked at from the floor. Host-authoritative like any
  // other spawn parameter — the orbit rides the wire, so a client without
  // the flag still reconstructs whatever the host chose.
  serpentLow = false } = {}) {
  const ents = createEntities();
  const world = createWorld();
  const level = buildLevel(world, rngFor(seed, 'level'));
  let tick = 0;
  let lastEvents = [];

  // Cells first (level-derived, fixed count), then enemies — a fixed id
  // layout every peer reproduces from the seed.
  if (!predictOnly) {
    for (const pos of level.cellSpots) {
      const id = ents.allocId();
      ents.cells.set(id, { id, pos: { ...pos }, base: { ...pos }, taken: false, pulled: false });
    }
    if (enemies) {
      initEnemies(ents, level, seed);
      /* MD 19: three tiers, always patrolling. Each gets its own rng stream
         and its own world id, so the count never touches the shared counter
         that player ids come from. `world` is handed in so spawnSerpent can
         SAMPLE for clear air rather than assume a radius is empty. */
      for (const tier of TIER_NAMES) {
        const sid = ents.allocWorldId();
        spawnSerpent(ents, level, rngFor(seed, 'serpent', sid), sid,
          { tier, world, lowDebug: serpentLow });
      }
    }
  }

  // withId: the prediction sim mirrors a player the HOST allocated, and the
  // seeded spawn scatter is keyed by id — the mirror must use the host's id
  // or it spawns somewhere else and reconciliation starts life correcting.
  function addPlayer(withId) {
    const id = withId ?? ents.allocId();
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
    // Read-only handle for tests that need to compare wire state against
    // authority (MD 18 item 9). Nothing in the game reads this.
    get ents() { return ents; },
    get level() { return level; },
    addPlayer,
    removePlayer,
    // Net-client alignment + reconciliation surface (MD 8). setTick aligns a
    // prediction sim to the host's tick domain (platform state is a pure
    // function of tick, so jumping the counter is exact, not a cheat);
    // getPlayer exposes the live state object so reconciliation can snap and
    // replay it. Neither is for gameplay code.
    setTick(t) { tick = t; },
    getPlayer(id) { return ents.players.get(id); },
    setPlayer(id, state) { ents.players.set(id, state); },
    playerIds() { return [...ents.players.keys()]; },
    // commandsByPlayer: Map<playerId, command|undefined> for THIS tick.
    step(commandsByPlayer) {
      const events = [];
      const ctx = { world, level, tick, events, ents, pvp, seed };
      // Platforms first (prototype order), so ground carry uses fresh deltas
      // and a collapser sees who stood on it at the end of last tick.
      const standing = new Set();
      for (const p of ents.players.values()) {
        if (p.groundPlatformId != null) standing.add(p.groundPlatformId);
      }
      tickPlatforms(world, level, tick, standing, events);
      for (const p of ents.players.values()) {
        // Ghosts are kinematic mirrors of remote players inside a net
        // client's predictOnly sim — grapple targets, never simulated. The
        // transport positions them from snapshots; nothing here steps them.
        if (p.ghost) continue;
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
        if (!predictOnly) stepCombat(ctx, p, cmd ? cmd.buttons : 0);
      }
      if (!predictOnly) {
        stepEnemies(ctx);
        stepSerpents(ctx);
        stepRockets(ctx); // after enemies: a rocket sweeps against this tick's poses
        stepBolts(ctx);   // and bolts after those, same fixed-order discipline
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
      // Rope endpoint per grapple mode — the renderer draws to this.
      const ropeEnd = (p) => {
        if (!p.grapple) return null;
        if (p.grapple.mode === 'pull') return round(p.grapple.anchor);
        if (p.grapple.mode === 'yank') {
          const e = ents.enemies.get(p.grapple.enemyId);
          return e ? round(e.pos) : null;
        }
        if (p.grapple.mode === 'player') {
          const q = ents.players.get(p.grapple.targetId);
          return q ? round(q.pos) : null;
        }
        const c = ents.cells.get(p.grapple.cellId);
        return c ? round(c.pos) : null;
      };
      return {
        tick, seed, pvp,
        players: [...ents.players.values()].filter((p) => !p.ghost).map((p) => ({
          id: p.id, pos: round(p.pos), vel: round(p.vel),
          yaw: p.yaw, pitch: p.pitch,
          hp: p.hp, fuel: p.fuel, fuelMax: p.fuelMax, dashCharges: p.dashCharges,
          weapon: p.weapon,
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
        rockets: [...ents.rockets.values()].map((r) => ({
          id: r.id, pos: round(r.pos), vel: round(r.vel), ownerId: r.ownerId,
        })),
        /* MD 18. NO segment positions on the wire. The head path is a closed
           form of the tick (serpent.js), so a client holding the parameters can
           evaluate headAt() — and therefore every segment, which is just the
           head SEG_LAG*i ticks ago — itself. Only what cannot be derived
           travels:
             len      alive segments. Destroying a segment always destroys
                      everything behind it, so the alive set is always a prefix
                      and fits in ONE integer, not a liveness array.
             armour   a bitmask, one bit per segment — 12 segments in a single
                      number. The inflate ANIMATION belongs to the renderer and
                      is driven off the bit appearing, so no per-segment timer
                      goes over the wire.
             aim      two angles for the turret.
             hp0      frontmost segment hp, for the health readout only.
           `path` is static after spawn; a client caches it by id on first
           sight. It is sent every frame here for simplicity and still costs
           less than one segment position would. */
        serpents: [...ents.serpents.values()].filter((s) => s.alive).map((s) => {
          let mask = 0;
          for (let i = 0; i < s.len; i++) if (tick < s.armourUntil[i]) mask |= (1 << i);
          return {
            id: s.id, tier: s.tier, segs: s.segs, scale: s.scale, len: s.len, armour: mask,
            aimYaw: Math.round(s.aimYaw * 1e4) / 1e4,
            aimPitch: Math.round(s.aimPitch * 1e4) / 1e4,
            hp0: s.hp[0],
            path: {
              cx: s.cx, cy: s.cy, cz: s.cz, R: s.R, amp: s.amp, lat: s.lat,
              w: s.w, vw: s.vw, phase: s.phase, vphase: s.vphase,
            },
          };
        }),
        bolts: [...ents.bolts.values()].map((b) => ({
          id: b.id, pos: round(b.pos), vel: round(b.vel), serpentId: b.serpentId,
        })),
        events: lastEvents,
      };
    },
  };
}
