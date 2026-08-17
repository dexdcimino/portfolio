// Deterministic RNG. Same shape as core/rng.js in Chomp and Arena1.

export function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Named stream off a base seed — rngFor('chunk:3,-2') is stable forever. */
export function rngFor(seed, name) {
  return mulberry32(hashStr(seed + '|' + name));
}

/** Convenience wrappers around a raw rng function. */
export function range(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

export function pick(rng, arr) {
  return arr[Math.min(arr.length - 1, (rng() * arr.length) | 0)];
}

export function chance(rng, p) {
  return rng() < p;
}
