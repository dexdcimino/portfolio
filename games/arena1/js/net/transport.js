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

export function createLoopbackTransport(seed, opts) {
  const sim = createSim(seed, opts);
  const subscribers = [];
  const pending = new Map(); // playerId → latest command for the coming tick

  return {
    addLocalPlayer() { return sim.addPlayer(); },
    sendCommand(cmd) { pending.set(cmd.playerId, cmd); },
    onSnapshot(cb) { subscribers.push(cb); },
    tick() {
      sim.step(pending);
      pending.clear();
      const snap = sim.snapshot();
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
