// core/rng.js — seeded, deterministic randomness. Same seed ⇒ same run
// (GDD: seed in URL, run summary shows seed, replayable).

// FNV-1a 32-bit string hash → uint32.
export function hashStr(str) {
  const s = String(str);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32 — tiny fast PRNG. Returns a function yielding floats in [0, 1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic per-purpose stream: rngFor(seed, 'chunk', cx, cz) always yields
// the same sequence for the same seed+salts (TECH.md: seed ⊕ chunkCoord).
export function rngFor(seed, ...salts) {
  let h = hashStr(seed);
  for (const salt of salts) h = hashStr(h + ':' + salt);
  return mulberry32(h);
}
