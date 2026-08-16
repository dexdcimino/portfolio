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
  return {
    allocId() { return nextId++; },
    players, enemies, cells, rockets,
  };
}
