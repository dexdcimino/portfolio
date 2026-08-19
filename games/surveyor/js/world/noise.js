// The world is a pure function of a DIRECTION. Nothing is stored, so a planet
// generates identically forever.
//
// The noise is 3D, sampled straight from the direction vector. That is the
// whole reason there is no seam and no pole: a 2D chart per cube face would
// have to reconcile six parametrisations along twelve edges, and lat/long
// smears everything within a few degrees of the poles. Sampling the direction
// itself sidesteps both — height(dir) is continuous everywhere by construction,
// which is also why cracks cannot open at face boundaries.
//
// Terrain mesh, vehicle physics, rock placement and water depth all read this,
// which is the only reason a boulder sits *on* the ground instead of inside it.

import { hashStr } from '../core/rng.js';
import { faceDir, dirToFace } from './sphere.js';

// ---- 3D value noise -----------------------------------------------------

function hash3(ix, iy, iz, seed) {
  let h = (Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^
    Math.imul(iz, 1274126177) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Trilinear value noise, 0..1. */
export function noise3(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = smooth(x - ix), fy = smooth(y - iy), fz = smooth(z - iz);
  const c000 = hash3(ix, iy, iz, seed), c100 = hash3(ix + 1, iy, iz, seed);
  const c010 = hash3(ix, iy + 1, iz, seed), c110 = hash3(ix + 1, iy + 1, iz, seed);
  const c001 = hash3(ix, iy, iz + 1, seed), c101 = hash3(ix + 1, iy, iz + 1, seed);
  const c011 = hash3(ix, iy + 1, iz + 1, seed), c111 = hash3(ix + 1, iy + 1, iz + 1, seed);
  const x00 = c000 + (c100 - c000) * fx, x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx, x11 = c011 + (c111 - c011) * fx;
  const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

/** Fractal brownian motion on the sphere, normalised to 0..1. */
export function fbm3(x, y, z, oct, seed) {
  let sum = 0, amp = 1, norm = 0;
  let px = x, py = y, pz = z;
  for (let i = 0; i < oct; i++) {
    sum += noise3(px, py, pz, seed) * amp;
    norm += amp;
    amp *= 0.5;
    // Rotate-and-scale between octaves so the lattices never line up.
    px = px * 2.03 + 17.3; py = py * 2.03 - 9.1; pz = pz * 2.03 + 4.7;
  }
  return sum / norm;
}

/** Ridged fbm, 0..1 — sharp crests, the reason highlands look carved. */
export function ridged3(x, y, z, oct, seed) {
  let sum = 0, amp = 1, norm = 0;
  let px = x, py = y, pz = z;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(noise3(px, py, pz, seed) * 2 - 1);
    sum += n * n * amp;
    norm += amp;
    amp *= 0.52;
    px = px * 2.11 - 44.7; py = py * 2.11 + 31.9; pz = pz * 2.11 - 12.3;
  }
  return sum / norm;
}

function sstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const seedCache = new Map();
function seedOf(planet) {
  let s = seedCache.get(planet.seed);
  if (s === undefined) { s = hashStr(planet.seed); seedCache.set(planet.seed, s); }
  return s;
}

// ---- the height function ------------------------------------------------

/**
 * Ground height in metres above the planet's sea level. Negative is lake.
 *
 * Every amplitude is a fraction of `planet.relief`, which is itself derived
 * from the radius (~R/20). The old flat world produced up to 180m of shelf;
 * dropped unscaled onto a 207m-radius world that is a spike taller than half
 * the planet. Amplitude has to be a per-planet parameter, not a constant.
 */
export function height(dir, planet) {
  const seed = seedOf(planet);
  const relief = planet.relief;
  const x = dir.x, y = dir.y, z = dir.z;

  // Continental shelf — decides where land is at all.
  const f0 = planet.fShelf;
  const e = fbm3(x * f0, y * f0, z * f0, 4, seed);
  let m = (e - planet.seaBias) * planet.wShelf * relief;

  const land = sstep(-0.08 * relief, 0.50 * relief, m);

  // Blob-carved basins: inland lakes on high ground, bays near the coast.
  const f1 = planet.fCarve;
  const lk = fbm3(x * f1 + 31.7, y * f1 - 8.2, z * f1 + 55.1, 3, seed);
  const carve = sstep(0.53, 0.31, lk);
  m -= carve * planet.wCarve * relief * (0.4 + 0.6 * land);

  // Ridged stone ranges, kept off the lake floors.
  const f2 = planet.fRidge;
  const r = ridged3(x * f2, y * f2, z * f2, 4, seed);
  m += r * r * planet.wRidge * relief * land * (1 - carve * 0.75);

  // Boulder-field roughness and fine grain.
  const f3 = planet.fRough;
  m += (fbm3(x * f3, y * f3, z * f3, 3, seed) - 0.5) * planet.wRough * relief * land;
  const f4 = planet.fFine;
  m += (fbm3(x * f4, y * f4, z * f4, 2, seed) - 0.5) * planet.wFine * relief;

  /* ESCARPMENTS (the Home revamp) — cliff lines with plateaus behind them.
     Weight-gated like the fissures: wCliff is 0 or absent on five worlds and
     this block never runs there, which is what keeps them bit-identical.

     The wall is a STEP IN THE SHELF FIELD, not new noise: everything on the
     high side of an `e` threshold is lifted by the full cliff height, so the
     face appears exactly where the shelf field crosses the line — a long,
     coherent escarpment that wanders the world the way the coastline does,
     because it is literally a contour of the same field. The high side is a
     plateau by construction, since e varies at continental scale.

     `cliffWander` matters more than it looks: a second, faster field pushes
     the threshold locally, which bends the wall, varies its height, and —
     where the push exceeds the transition width — breaks it entirely. Those
     breaks are the ramps. A cliff line with no gaps is a wall around the
     world, and the rover has to live here. */
  if (planet.wCliff > 0) {
    // One octave for the wander on purpose: it only nudges a threshold, and
    // leaf build pays for every noise3 here 289 times a leaf.
    const fg = planet.fCliffGap;
    const g = noise3(x * fg - 19.1, y * fg + 42.7, z * fg + 8.3, seed);
    const t = e + (g - 0.5) * planet.cliffWander;
    const c = sstep(planet.cliffAt, planet.cliffAt + planet.cliffWidth, t);
    m += c * planet.wCliff * relief * land;
  }

  /* MESAS — isolated flat-topped landmarks you can navigate by. A low-
     frequency field over a sharp threshold: sstep saturating at 1 is what
     makes the top a plateau rather than a peak, and the narrowness of the
     band is the wall. Kept on land and off the carved basins. */
  if (planet.wMesa > 0 && land > 0.01) {
    const fm = planet.fMesa;
    const mm = fbm3(x * fm + 63.2, y * fm - 27.9, z * fm + 91.4, 2, seed);
    const top = sstep(planet.mesaAt, planet.mesaAt + planet.mesaWidth, mm);
    m += top * planet.wMesa * relief * land * (1 - carve);
  }

  /* GULLIES — erosion at driving scale. Inverted ridged noise is a drainage
     network in plan view (the same read as the fissures, wider and shallower),
     cubed so most ground is intact and the cuts are channels rather than a
     rumble strip. This is what makes the ground read at 15m instead of only
     at 1500. */
  if (planet.wGully > 0 && land > 0.01) {
    const fy = planet.fGully;
    const gy = ridged3(x * fy + 7.7, y * fy - 51.3, z * fy + 23.8, 2, seed);
    m -= gy * gy * gy * planet.wGully * relief * land;
  }

  // Terracing — stone breaks in steps, and steps read beautifully under
  // contour lines. Step height is absolute metres, because the contour
  // interval it plays against is too.
  if (planet.terraceAmt > 0) {
    const t = sstep(planet.terraceFrom * relief, planet.terraceTo * relief, m) *
      planet.terraceAmt;
    const step = planet.terraceStep;
    const terr = Math.floor(m / step) * step + step * 0.5;
    m += (terr - m) * t;
  }

  /* FISSURES (Phase 3a) — the only code this phase adds, and it is weight
     gated: wFissure is 0 on five of the six worlds, so this stays data rather
     than a branch on planet identity.

     Ember needs it because Ember cannot use topography. At radius 207 its
     relief budget is 10.4m for the ENTIRE world, so nothing broad reads at
     all. A fissure is the one feature that works inside that budget: it does
     not need height, it needs DEPTH in a narrow band, which is cheap in
     vertical range and lethal to drive into.

     Ridged noise inverted gives the network shape — ridged3 returns creases,
     and a crease is exactly the plan view of a fissure system. Raised to a
     power to narrow it: the exponent is what separates "cracked plain" from
     "eroded badland", because it decides how much of the surface is inside a
     crack at all. Cut downward only, and NOT scaled by `land`, since Ember has
     no sea for land to mean anything against. */
  if (planet.wFissure > 0) m -= fissureAt(dir, planet) * planet.wFissure * relief;

  /* Heights come out relative to THIS world's sea level.
     Everything above works in a datum measured from the nominal radius; the
     rest of the game — the water shell, the flooding rule, the craft's own y,
     the palette bands — reads sea level as zero. `waterY` is the offset between
     the two, and it was never applied, so a profile could declare a waterline
     that nothing but the assertions ever saw: Tarn measured 86% ocean and drew
     9%, Anvil measured 15% and drew 41%.
     It has to happen before the lake-floor clamp, because that clamp is about
     what is under water, which is exactly the thing being defined here. */
  m -= planet.waterY;

  // Lake floors flatten out so water reads as water, not as canyon.
  const floor = -0.06 * relief;
  if (m < floor) m = floor + (m - floor) * 0.5;

  return m;
}

/**
 * How deep inside a fissure a direction is, 0..1. 0 on the intact plain.
 *
 * This is the mask `height` cuts with, exposed so the chunk baker can write it
 * into a vertex attribute and the shader can burn the cracks (see the Phase 3a2
 * note in chunks.js). It is a separate function rather than a second return
 * value from `height` because `height` is called ~72 times a frame for the
 * suspension alone and none of those callers want it.
 *
 * The one thing that must not happen is a second copy of this expression. The
 * shader could recompute the noise itself in three lines, and on some hardware
 * those three lines disagree with these — so `height` calls this too, and there
 * is exactly one fissure field in the program.
 */
export function fissureAt(dir, planet) {
  if (!(planet.wFissure > 0)) return 0;
  const seed = seedOf(planet);
  const f5 = planet.fFissure;
  const fr = ridged3(dir.x * f5 + 12.4, dir.y * f5 + 71.9, dir.z * f5 - 40.3, 3, seed);
  return Math.pow(Math.max(0, fr), planet.fissureNarrow);
}

// ---- the drawn surface --------------------------------------------------

const FC = { f: 0, u: 0, v: 0 };
const D0 = { x: 0, y: 0, z: 0 };

/**
 * The height of the surface that is actually DRAWN, rather than the ideal one.
 *
 * `height` is a smooth analytic curve; the mesh samples it on the leaf lattice
 * and puts flat triangles in between. A vehicle riding the analytic curve
 * floats above every convex cell and sinks into every concave one. Anything
 * that has to *touch* the ground reads this instead.
 *
 * `cellUV` is the lattice spacing in face-uv units, which depends on the LOD
 * level covering this direction — see SurfaceCache, which resolves it once per
 * frame rather than once per sample.
 */
export function surfaceHeight(dir, planet, cellUV) {
  dirToFace(dir.x, dir.y, dir.z, FC);
  const c = cellUV;
  const u0 = Math.floor(FC.u / c) * c, v0 = Math.floor(FC.v / c) * c;
  const fu = (FC.u - u0) / c, fv = (FC.v - v0) / c;
  const f = FC.f;
  const h00 = height(faceDir(f, u0, v0, D0), planet);
  const h10 = height(faceDir(f, u0 + c, v0, D0), planet);
  const h01 = height(faceDir(f, u0, v0 + c, D0), planet);
  const h11 = height(faceDir(f, u0 + c, v0 + c, D0), planet);
  return (h00 * (1 - fu) + h10 * fu) * (1 - fv) +
         (h01 * (1 - fu) + h11 * fu) * fv;
}

/** Metres of water above the floor at a direction. 0 on dry land. */
export function depthAt(dir, planet) {
  return Math.max(0, -height(dir, planet));
}

export function isWater(dir, planet) {
  return height(dir, planet) < -0.35;
}

/**
 * Small analytic swell, shared by the water shader and boat physics.
 *
 * Driven by the direction rather than by x/z so it stays continuous all the
 * way round the planet — a world-space wave field would tear at the antipode.
 */
export function waveAt(dir, t, planet) {
  const k = planet.waveFreq;
  return (
    Math.sin(dir.x * k + t * 1.15) * 0.30 +
    Math.sin(dir.z * k * 0.79 - t * 0.87) * 0.26 +
    Math.sin((dir.x + dir.y + dir.z) * k * 0.40 + t * 0.55) * 0.20
  ) * planet.waveAmp;
}
