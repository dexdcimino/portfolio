// net/transport.js — the seam. main.js talks ONLY to this interface; solo play
// is host-with-zero-peers from day one, so networking later is a second
// implementation of the same three methods, not a refactor (briefing:
// "Do not let solo mode bypass the seam").
//
//   transport.sendCommand(cmd)   queue this player's command for its tick
//   transport.onSnapshot(cb)     subscribe to per-tick snapshots
//   transport.tick()             advance one fixed step (host pumps this)
//
// LoopbackTransport owns the authoritative sim locally — the host case.
// Phase 7's PhotonTransport implements the same surface.
import { createSim } from '../sim/sim.js';
import { readTag, readAccent } from './photon.js';

export function createLoopbackTransport(seed, opts) {
  const sim = createSim(seed, opts);
  const subscribers = [];
  const pending = new Map(); // playerId → latest command for the coming tick
  let localId = null;

  return {
    // Same readiness surface as the Photon transport: loopback is ready the
    // moment it exists, and the local identity is known synchronously.
    ready: Promise.resolve(),
    isHost: true,
    get seed() { return seed; },
    get localId() { return localId; },
    get netInfo() { return null; },    // solo — nothing to show
    get prediction() { return null; }, // solo — zero latency, nothing to reconcile
    dispose() { /* nothing to close */ },
    addLocalPlayer() { localId = sim.addPlayer(); return localId; },
    sendCommand(cmd) { pending.set(cmd.playerId, cmd); },
    onSnapshot(cb) { subscribers.push(cb); },
    tick() {
      sim.step(pending);
      pending.clear();
      const snap = sim.snapshot();
      /* MD 25: solo snapshots carry the local tag and accent too. The host
         core already does this (withTags) and the leaderboard reads it, so
         without it a solo board would show "P1" and a default dot for a player
         who has both. Imported from photon.js rather than re-read here — one
         definition of where a tag lives, not two. */
      for (const q of snap.players) { q.tag = readTag(); q.accent = readAccent(); }
      for (const cb of subscribers) cb(snap);
      return snap;
    },
    get tickCount() { return sim.tick; },
    // One-directional render reads (spec: "the render layer may READ this"):
    // level data to build meshes from, world.raycast for blob shadows. The
    // Photon transport serves these by building the same level client-side
    // from the shared seed — the interface stays identical.
    get level() { return sim.level; },
    get world() { return sim.world; },
  };
}
