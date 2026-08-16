// sim/entities.js — stable numeric ids, allocated by the sim at spawn.
// The renderer keys its mesh pools by these ids; they are never derived from
// mesh creation order or names (briefing: "Entity IDs"). Per-type tables keep
// snapshot assembly cheap and ordered (insertion order = id order, which is
// what makes two same-seed sims serialize identically).
export function createEntities() {
  let nextId = 1;
  const players = new Map();  // id → player state
  const enemies = new Map();  // Phase 5
  const cells = new Map();    // Phase 5
  const rockets = new Map();  // MD 11 — projectiles that live across ticks
  const serpents = new Map(); // MD 18 — one record per serpent, segments derived
  const bolts = new Map();    // MD 18 — turret projectiles, same discipline as rockets
  /* MD 18 serpents and their bolts allocate from a SEPARATE counter, and that
     is not cosmetic. Player ids come from allocId() too, so spawning one more
     world entity at level init shifted every player's id by one — and since a
     player's spawn point is rngFor(seed, 'spawn', id), that silently moved
     every spawn on every seed and changed the whole run. A player's identity
     must not depend on how many creatures the level happens to contain. The
     base is far above anything the shared counter will reach, so the two spaces
     stay disjoint and ids remain unique across the snapshot. */
  let nextWorldId = 100000;
  return {
    allocId() { return nextId++; },
    allocWorldId() { return nextWorldId++; },
    players, enemies, cells, rockets, serpents, bolts,
  };
}
