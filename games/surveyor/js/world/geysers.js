// Gas geysers: the only place a coloniser makes hyper fuel.
//
// That one rule is what turns the map into something worth reading. A probe
// dropped anywhere builds a habitat that pays flight time, as it always has;
// dropped on a vent, it builds one that pays for travel. So the exploration
// verb stops being "cover ground" and becomes "find the vents", and the survey
// overlay in 4b has something to be an overlay OF.
//
// Two properties this file exists to guarantee.
//
// 1. FINITE AND COUNTABLE. A planet has a fixed set of geysers, enumerated the
//    same way every session, so "seven of eleven claimed" is a real number and
//    not an estimate over a streamed field. Props stream; geysers do not.
//
// 2. NEVER A DEAD END. Every world has some. Land on Anvil with an empty hyper
//    tank and the way home is to find a vent and colonise it — which is the
//    standing rule of this project stated in geology: you can be a long way
//    from where you wanted to be, but you can never be stuck.
//
// Placement is a filter over a Fibonacci walk of the sphere, so it costs a few
// thousand height() samples once per planet and is identical forever after.

import { height, fissureAt } from './noise.js';
import { GEYSER, PLANETS } from '../tune.js';
import { hashStr } from '../core/rng.js';

const D = { x: 0, y: 0, z: 0 };
const cache = new Map();

/** Stable 0..1 from an index and a seed. */
function hash2(i, seed) {
  let h = (Math.imul(i, 374761393) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** How well a direction suits this world's kind of vent. -1 rejects it. */
function score(dir, planet, g) {
  const h = height(dir, planet);
  switch (g.kind) {
    // Tarn: vents rise through shallow water, so the plume is visible from a
    // long way off across open sea and finding them is a boat problem.
    case 'shallow': {
      if (h > -0.4 || h < -planet.relief * 0.45) return -1;
      return 1 - Math.abs(h + planet.relief * 0.16) / (planet.relief * 0.4);
    }
    // Vault: steam through the ice, out where the sheet is thick enough to
    // stand on — a vent you can drive to is worth more than one you cannot.
    case 'ice': {
      if (h > -0.5 || h < -planet.iceMeltFrom) return -1;
      return 1 - Math.abs(h + planet.iceMeltFrom * 0.5) / planet.iceMeltFrom;
    }
    // Ember: volcanic rather than gas. The fissures are already the hot part of
    // that world, so the vents sit in them.
    case 'fissure': {
      const f = fissureAt(dir, planet);
      if (f < 0.35 || h < -planet.relief * 0.6) return -1;
      return f;
    }
    // Everywhere else: dry, low and flat. Basins and valley floors, not peaks —
    // gas collects where the ground does.
    default: {
      if (h < 0.5 || h > planet.relief * g.maxHeight) return -1;
      return 1 - h / (planet.relief * g.maxHeight);
    }
  }
}

/** Slope in metres per metre, from a small cross around the direction. */
function slopeAt(dir, planet) {
  const e = 1 / planet.radius * 4;          // ~4m of arc, in radians
  const probe = (ax, ay, az) => {
    const l = Math.hypot(dir.x + ax, dir.y + ay, dir.z + az) || 1;
    D.x = (dir.x + ax) / l; D.y = (dir.y + ay) / l; D.z = (dir.z + az) / l;
    return height(D, planet);
  };
  // Two arbitrary perpendiculars are enough for a roughness reading.
  const a = Math.abs(dir.x) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  let px = a[1] * dir.z - a[2] * dir.y;
  let py = a[2] * dir.x - a[0] * dir.z;
  let pz = a[0] * dir.y - a[1] * dir.x;
  const pl = Math.hypot(px, py, pz) || 1;
  px /= pl; py /= pl; pz /= pl;
  const qx = dir.y * pz - dir.z * py;
  const qy = dir.z * px - dir.x * pz;
  const qz = dir.x * py - dir.y * px;
  const h0 = height(dir, planet);
  const dp = probe(px * e, py * e, pz * e) - h0;
  const dq = probe(qx * e, qy * e, qz * e) - h0;
  return Math.hypot(dp, dq) / 4;
}

/**
 * Every geyser on a planet, in a fixed order, cached per planet key.
 *
 * Candidates are walked as a Fibonacci sphere — even coverage, no clustering at
 * the poles — scored, rejected if unsuitable or too close to one already taken,
 * and the best `count` kept. Sorting by score before spacing means a world's
 * geysers land in its most characteristic terrain rather than wherever the walk
 * happened to start.
 */
export function geysersOf(planet) {
  const key = planet.key + ':' + planet.seed;
  if (cache.has(key)) return cache.get(key);

  const g = Object.assign({}, GEYSER, planet.geysers || {});
  const seed = hashStr(planet.seed + ':geyser');
  const GA = Math.PI * (3 - Math.sqrt(5));
  const N = GEYSER.candidates;
  const cands = [];
  for (let i = 0; i < N; i++) {
    // Rotated by the seed so two worlds sharing a profile do not share a field.
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * GA + (seed % 1000) / 1000 * Math.PI * 2;
    const dir = { x: Math.cos(a) * r, y, z: Math.sin(a) * r };
    const s = score(dir, planet, g);
    if (s < 0) continue;
    if (g.kind === 'dry' && slopeAt(dir, planet) > GEYSER.maxSlope) continue;
    // Ordered by a hash of the sample index, not by score and not by the walk.
    // Score first put every vent on a world at the same elevation — it peaks at
    // one height, so the top candidates were all the same place twelve times
    // over. Walk order is worse still: a Fibonacci walk runs pole to pole, so
    // taking the first that fit would put the whole field in one hemisphere.
    cands.push({ dir, s, k: hash2(i, seed) });
  }
  cands.sort((a, b) => a.k - b.k);

  // Spacing, as a fraction of the radius: two vents on top of each other would
  // be one claim, and would make the count a lie.
  const minArc = planet.radius * GEYSER.minSpacing;
  const out = [];
  for (const c of cands) {
    if (out.length >= g.count) break;
    let ok = true;
    for (const o of out) {
      const dot = Math.max(-1, Math.min(1, c.dir.x * o.dir.x + c.dir.y * o.dir.y + c.dir.z * o.dir.z));
      if (Math.acos(dot) * planet.radius < minArc) { ok = false; break; }
    }
    if (!ok) continue;
    const h = height(c.dir, planet);
    out.push({
      id: out.length,
      dir: c.dir,
      kind: g.kind,
      elevation: h,
      // Yield is per-world: Home's field is the rich one, and a vent on a
      // distant world is a way home rather than an industry.
      yield: g.yield,
      world: {
        x: c.dir.x * (planet.surfaceR + h),
        y: c.dir.y * (planet.surfaceR + h),
        z: c.dir.z * (planet.surfaceR + h),
      },
    });
  }
  cache.set(key, out);
  return out;
}

/** The geyser a direction sits on, or null. Claim radius scales with the world. */
export function geyserAt(planet, dir) {
  const r = planet.radius * GEYSER.claimRadius;
  for (const gy of geysersOf(planet)) {
    const dot = Math.max(-1, Math.min(1,
      dir.x * gy.dir.x + dir.y * gy.dir.y + dir.z * gy.dir.z));
    if (Math.acos(dot) * planet.radius <= r) return gy;
  }
  return null;
}

/** Every world's field, for the progress readout. Cheap after the first call. */
export function systemGeysers(makePlanet) {
  const out = {};
  for (const key of Object.keys(PLANETS)) {
    out[key] = geysersOf(makePlanet(PLANETS[key])).length;
  }
  return out;
}
