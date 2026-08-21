// The adapter between the sphere and everything written for a flat world.
//
// `craft.js` asks for height(x, z) at local tangent offsets and gets metres
// above sea level, exactly as before. Underneath, (x, z) becomes a direction by
// exponential map and the direction becomes a height. The craft never learns
// that the world is round; it only ever sees a patch of ground with y up.
//
// The LOD split rule lives here too, because two things need to agree on it:
// chunks.js, which builds the mesh, and SurfaceCache, which has to reproduce
// the mesh's lattice spacing for surfaceHeight.

import { TangentFrame, faceDir, dirToFace, arcBetween } from './sphere.js';
import { height, surfaceHeight, waveAt } from './noise.js';
import { WORLD } from '../tune.js';

const CT = { x: 0, y: 0, z: 0 };

let FM = null;

/**
 * A tangent basis as a quaternion. (east, up, north) are the frame's local
 * (x, y, z), so they are literally the columns of the rotation matrix — read
 * them off rather than decomposing anything.
 */
export function frameQuat(fr, out) {
  if (!FM) FM = BABYLON.Matrix.Identity();
  BABYLON.Matrix.FromValuesToRef(
    fr.east.x, fr.east.y, fr.east.z, 0,
    fr.up.x, fr.up.y, fr.up.z, 0,
    fr.north.x, fr.north.y, fr.north.z, 0,
    0, 0, 0, 1, FM);
  BABYLON.Quaternion.FromRotationMatrixToRef(FM, out);
  return out;
}

/**
 * Stand a node up on the planet at a direction: position on the radial at the
 * given elevation, and +Y pointing away from the centre. Everything scattered
 * on the surface — beacons, cells, habitat domes — is placed with this.
 */
export function placeOnSphere(node, planet, dir, elevation, spinY) {
  const r = planet.surfaceR + elevation;
  node.position.set(dir.x * r, dir.y * r, dir.z * r);
  const fr = new TangentFrame(planet, dir);
  if (!node.rotationQuaternion) node.rotationQuaternion = new BABYLON.Quaternion();
  frameQuat(fr, node.rotationQuaternion);
  if (spinY) {
    const spin = BABYLON.Quaternion.RotationYawPitchRoll(spinY, 0, 0);
    node.rotationQuaternion.multiplyToRef(spin, node.rotationQuaternion);
  }
  return fr;
}

/**
 * Should this quadtree node subdivide? Angular distance from the player
 * against the node's own span, so a node splits when it is close enough to be
 * worth the triangles.
 */
export function splitNode(planet, f, u0, v0, size, level, playerDir) {
  if (level >= planet.maxLevel) return false;
  faceDir(f, u0 + size * 0.5, v0 + size * 0.5, CT);
  const span = size * planet.faceArc * 0.5;      // node width in metres
  return arcBetween(CT, playerDir, planet.radius) < span * WORLD.lodSplit;
}

/**
 * Resolves which leaf covers a direction, and caches it.
 *
 * The six wheels sit within a few metres of each other, so they are almost
 * always inside the same leaf: descend once, reuse, and only descend again
 * when a sample falls outside the cached leaf's uv rect. That turns ~18 tree
 * descents a frame into about one.
 *
 * Deliberately does NOT cache height() results — the samples are at different
 * positions and would never hit. The descent is the expensive part.
 */
export class SurfaceCache {
  constructor(planet) {
    this.planet = planet;
    this.player = { x: 0, y: 1, z: 0 };
    this.fc = { f: 0, u: 0, v: 0 };
    this.valid = false;
    this.f = -1; this.u0 = -1; this.v0 = -1; this.size = 2;
    this.level = 0;
    this.cell = planet.finestCellUV;
    this.hits = 0;
    this.misses = 0;
  }

  /** The player moved, so the LOD field moved with them. */
  setPlayer(dir) {
    this.player.x = dir.x; this.player.y = dir.y; this.player.z = dir.z;
    this.valid = false;
  }

  /** Lattice spacing in face-uv units for the leaf covering this direction. */
  cellUV(dir) {
    const fc = dirToFace(dir.x, dir.y, dir.z, this.fc);
    if (this.valid && fc.f === this.f &&
        fc.u >= this.u0 && fc.u <= this.u0 + this.size &&
        fc.v >= this.v0 && fc.v <= this.v0 + this.size) {
      this.hits++;
      return this.cell;
    }
    this.misses++;
    this.descend(fc.f, fc.u, fc.v);
    return this.cell;
  }

  descend(f, u, v) {
    const P = this.planet;
    let u0 = -1, v0 = -1, size = 2, level = 0;
    while (splitNode(P, f, u0, v0, size, level, this.player)) {
      size *= 0.5;
      level++;
      if (u >= u0 + size) u0 += size;
      if (v >= v0 + size) v0 += size;
    }
    this.f = f; this.u0 = u0; this.v0 = v0; this.size = size; this.level = level;
    this.cell = size / P.leafRes;
    this.valid = true;
  }
}

export class Surface {
  constructor(planet, startDir) {
    this.planet = planet;
    this.frame = new TangentFrame(planet, startDir);
    this.cache = new SurfaceCache(planet);
    this._d = { x: 0, y: 0, z: 0 };
    this._e = { x: 0, y: 0, z: 0 };
    this.cache.setPlayer(this.frame.up);
  }

  get radius() { return this.planet.radius; }

  /** Local tangent offset -> unit direction. */
  dirAt(x, z) { return this.frame.dirAt(x, z, this._d); }

  /** The analytic surface. Rock placement and smooth normals use this. */
  height(x, z) { return height(this.dirAt(x, z), this.planet); }

  /** The drawn surface. Anything that touches the ground uses this. */
  surfaceHeight(x, z) {
    const d = this.frame.dirAt(x, z, this._e);
    return surfaceHeight(d, this.planet, this.cache.cellUV(d));
  }

  /** Height at an arbitrary direction, on the drawn surface. */
  surfaceAtDir(dir) {
    return surfaceHeight(dir, this.planet, this.cache.cellUV(dir));
  }

  /**
   * Surface normal in LOCAL tangent coordinates, y up — the same contract the
   * flat world had, so the suspension's blend partner is unchanged.
   */
  normalAt(x, z, eps = 1.4) {
    const hL = this.height(x - eps, z), hR = this.height(x + eps, z);
    const hD = this.height(x, z - eps), hU = this.height(x, z + eps);
    const nx = hL - hR, ny = 2 * eps, nz = hD - hU;
    const len = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  waveAt(x, z, t) { return waveAt(this.dirAt(x, z), t, this.planet); }

  /** Walk the frame along the surface, carrying the basis with it. */
  advance(dx, dz) {
    this.frame.advance(dx, dz);
    this.cache.setPlayer(this.frame.up);
  }

  /** Jump the frame to a direction outright — respawns, hyper arrivals. */
  teleport(dir) {
    this.frame.setDir(dir);
    this.cache.setPlayer(this.frame.up);
  }

  toWorld(x, y, z, out) { return this.frame.toWorld(x, y, z, out); }
  toLocal(wx, wy, wz, out) { return this.frame.toLocal(wx, wy, wz, out); }

  /**
   * Spiral outward from the frame origin until something is convincingly dry.
   * Returns a tangent offset, not a direction, so callers stay in local space.
   */
  findDry(minHeight, maxArc) {
    const R = this.planet.radius;
    const limit = Math.min(maxArc, R * 1.2);
    for (let r = 10; r <= limit; r += Math.max(8, limit / 40)) {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + r * 0.61;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (this.height(x, z) > minHeight) return { x, z };
      }
    }
    return null;
  }
}

/* WHERE A NEIGHBOUR WANTS TO SIT IN YOUR SKY — a BAND, not a ramp.

   These are sines of elevation, because that is what a dot product gives you.
   6 degrees is the least that clears the local skyline reliably; 12 is up
   properly; 40 is the top of the band this SYSTEM.at can hold from one point
   and is a little over half of `CAM.fov.jet` (1.05 rad, so 30 degrees of frame
   above the axis in level flight). Above that you are craning, and `SKY_TOP`
   at 65 degrees is near enough overhead that a world stops being something you
   can aim at.

   40 IS NOT A TASTE, IT IS WHAT THE SPREAD LEAVES. Two worlds g degrees apart
   on the sky differ in elevation by up to g from any point, so a layout with
   no two worlds closer than 29.4 degrees cannot put all five inside a band
   narrower than 29.4. 6 to 40 is 34 wide: as tight as this spread allows with
   anything to spare. Tighten the band without respacing the worlds and the
   spare goes below the horizon instead — measured, a 6-to-30 band puts four of
   thirty under it. See the table on SYSTEM.at.

   IT WAS A RAMP THAT SATURATED AT 0.40 AND NEVER CAME BACK DOWN, which made
   "as high as possible" free. That was harmless while the worlds were badly
   spread — there was no point with all five well up, so the score never
   reached its plateau — and it stopped being harmless the moment SYSTEM.at was
   respaced on 2026-08-21: with the worlds separated, the spiral found points
   where everything was up, ties went to the earliest, and two neighbours came
   out at 83 and 87 degrees. Measured: spawn elevations ran 17-87 degrees, mean
   45, four of thirty above 60. Fixing the spread made the overhead complaint
   true where it had not been.

   So above `SKY_HIGH` the score falls away to `SKY_OVER` rather than holding.
   Not to zero: a world overhead is still in your sky and still better than one
   below the horizon, it is just not one you can point at. */
const SKY_LOW = 0.105;   // sin 6deg   — clears the skyline
const SKY_FULL = 0.208;  // sin 12deg  — up, full marks from here
const SKY_HIGH = 0.643;  // sin 40deg  — the top of the band the layout can hold
const SKY_TOP = 0.906;   // sin 65deg  — overhead
const SKY_OVER = 0;      // an overhead world is not one you can aim at

/** How much a neighbour at sin(elevation) `e` contributes to a spawn's score. */
function skyScore(e) {
  if (e <= SKY_LOW) return 0;
  if (e < SKY_FULL) return (e - SKY_LOW) / (SKY_FULL - SKY_LOW);
  if (e <= SKY_HIGH) return 1;
  if (e >= SKY_TOP) return SKY_OVER;
  return 1 - (1 - SKY_OVER) * ((e - SKY_HIGH) / (SKY_TOP - SKY_HIGH));
}

/**
 * A direction on the planet where the ground is between lo and hi metres.
 * Deterministic: walks a fixed spiral over the sphere so a planet's spawn is
 * the same every time.
 *
 * `face` is optional, and is what stops a world opening on an empty sky. The
 * spiral starts at the north pole and returns the first point in the height
 * band, which put every spawn in the same polar cap — and the six worlds are at
 * fixed points in one shared frame, so on Vault, the highest of them, all five
 * neighbours came out BELOW the local horizon and the sky was empty. Measured:
 * Vault 0 of 5 up, Anvil 1, Home 3.
 *
 * Given a list of directions, this scans the whole spiral instead of stopping
 * early and returns the valid point with the most of them IN THE BAND above —
 * not the most of them high, which is what it did until 2026-08-21. The
 * positions do not move and no disc is drawn that should not be — this only
 * chooses which way you are standing when the world opens.
 *
 * THE HEIGHT BAND IS PART OF THE ANSWER, not a filter on it. Only a small
 * fraction of the spiral has ground between `lo` and `hi`, so the reachable
 * standing points are a sparse subset of the sphere and the best point on the
 * sphere is usually not one of them. A `SYSTEM.at` chosen against the whole
 * sphere put Tarn's ideal point somewhere this cannot return and three of its
 * five neighbours came out below the horizon; the layout search uses this same
 * filtered set now.
 *
 * Deliberately unweighted: a world is identified in the sky by its tint, not by
 * its size, so a hemisphere with the small ones up is not worth less than one
 * with the big ones up.
 */
export function findSpawn(planet, lo, hi, face) {
  const GOLD = Math.PI * (3 - Math.sqrt(5));
  const d = { x: 0, y: 0, z: 0 };
  const scored = face && face.length;
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < 4000; i++) {
    // Fibonacci sphere — even coverage with no clustering at the poles.
    const y = 1 - (i / 3999) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * GOLD;
    d.x = Math.cos(a) * r; d.y = y; d.z = Math.sin(a) * r;
    const h = height(d, planet);
    if (!(h > lo && h < hi)) continue;
    if (!scored) return { x: d.x, y: d.y, z: d.z };
    let score = 0;
    for (const f of face) {
      score += skyScore(d.x * f.x + d.y * f.y + d.z * f.z);
    }
    // Strictly greater, so ties go to the earlier point and the answer stays
    // the same on every boot.
    if (score > bestScore) { bestScore = score; best = { x: d.x, y: d.y, z: d.z }; }
  }
  return best || { x: 0, y: 1, z: 0 };
}
