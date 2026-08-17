// Cube-sphere geometry, and the local tangent frame that lets the y-up physics
// survive the move onto a ball.
//
// Two ideas carry this file.
//
// 1. A direction is addressed as (face, u, v) on a cube projected onto the
//    sphere. Six charts, none of them degenerate — a lat/long chart pinches at
//    the poles and every quad there collapses to a triangle. Terrain noise is
//    sampled in 3D from the direction itself, so there is no seam at all.
//
// 2. The craft never carries world coordinates. It lives at the origin of a
//    tangent frame whose +Y is the local up, and every frame the frame walks
//    along the surface by however far the craft moved and rotates with it. In
//    that frame y IS up, so craft.js — six struts, hop arcs, boats, autopilot —
//    keeps working unchanged. Only the conversion at the edges is new.
//
// Nothing here imports Babylon: it runs in the harness with no stub at all.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---- cube-sphere charts -------------------------------------------------

// Tangent warp. A cube projected onto a sphere by plain normalisation has cells
// 5.2:1 (that is 3^1.5) larger at the face corners than at the centres, which
// means terrain resolution — and rock density, and the lattice the vehicles
// ride — would vary by that much across a single face. Pre-warping uv through
// tan flattens that to about 1.3:1. It is exactly invertible, which matters:
// dirToFace has to undo it precisely or the chart stops being a bijection.
const WARP = Math.PI / 4;
const warp = (t) => Math.tan(t * WARP);
const unwarp = (t) => Math.atan(t) / WARP;

/**
 * (face, u, v) -> unit direction. u and v run -1..1 across a face.
 *
 * The face table is chosen so that shared edges agree: face 0's u=+1 edge maps
 * to exactly the same directions as face 5's u=-1 edge, at the same v. That is
 * what stops cracks opening along the seams — vertices either side land on the
 * same direction, so they get the same height.
 */
export function faceDir(f, uRaw, vRaw, out = { x: 0, y: 0, z: 0 }) {
  const u = warp(uRaw), v = warp(vRaw);
  switch (f) {
    case 0: out.x = 1;  out.y = v;  out.z = -u; break;   // +X
    case 1: out.x = -1; out.y = v;  out.z = u;  break;   // -X
    case 2: out.x = u;  out.y = 1;  out.z = -v; break;   // +Y
    case 3: out.x = u;  out.y = -1; out.z = v;  break;   // -Y
    case 4: out.x = u;  out.y = v;  out.z = 1;  break;   // +Z
    default: out.x = -u; out.y = v; out.z = -1; break;   // -Z
  }
  const l = Math.hypot(out.x, out.y, out.z);
  out.x /= l; out.y /= l; out.z /= l;
  return out;
}

/** Unit direction -> (face, u, v). The exact inverse of faceDir. */
export function dirToFace(x, y, z, out = { f: 0, u: 0, v: 0 }) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if (ax >= ay && ax >= az) {
    if (x > 0) { out.f = 0; out.u = -z / ax; out.v = y / ax; }
    else { out.f = 1; out.u = z / ax; out.v = y / ax; }
  } else if (ay >= az) {
    if (y > 0) { out.f = 2; out.u = x / ay; out.v = -z / ay; }
    else { out.f = 3; out.u = x / ay; out.v = z / ay; }
  } else if (z > 0) { out.f = 4; out.u = x / az; out.v = y / az; }
  else { out.f = 5; out.u = -x / az; out.v = y / az; }
  out.u = unwarp(out.u);
  out.v = unwarp(out.v);
  return out;
}

/** Any perpendicular to d, chosen to stay well conditioned. */
function anyPerp(d, out) {
  // Cross with whichever axis d is least aligned to.
  const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
  let kx = 0, ky = 0, kz = 0;
  if (ax <= ay && ax <= az) kx = 1; else if (ay <= az) ky = 1; else kz = 1;
  out.x = ky * d.z - kz * d.y;
  out.y = kz * d.x - kx * d.z;
  out.z = kx * d.y - ky * d.x;
  const l = Math.hypot(out.x, out.y, out.z) || 1;
  out.x /= l; out.y /= l; out.z /= l;
  return out;
}

// ---- the tangent frame --------------------------------------------------

const T1 = { x: 0, y: 0, z: 0 };

export class TangentFrame {
  constructor(planet, dir) {
    this.planet = planet;
    this.up = { x: 0, y: 1, z: 0 };
    this.east = { x: 1, y: 0, z: 0 };
    this.north = { x: 0, y: 0, z: 1 };
    this.setDir(dir || { x: 0, y: 1, z: 0 });
  }

  /** Re-anchor and rebuild the basis from scratch. Loses the old heading. */
  setDir(d) {
    const l = Math.hypot(d.x, d.y, d.z) || 1;
    this.up.x = d.x / l; this.up.y = d.y / l; this.up.z = d.z / l;
    anyPerp(this.up, this.east);
    // north = east x up, NOT up x east.
    //
    // This sign is load-bearing. With the operands the other way round the
    // basis has determinant -1 — a reflection, not a rotation — and the
    // quaternion pulled out of it comes back 0.71 long instead of unit. Babylon
    // folds a non-unit rotation quaternion into the node's scale, so every
    // vehicle visibly skewed and squashed as it drove.
    this.north.x = this.east.y * this.up.z - this.east.z * this.up.y;
    this.north.y = this.east.z * this.up.x - this.east.x * this.up.z;
    this.north.z = this.east.x * this.up.y - this.east.y * this.up.x;
  }

  /**
   * Local tangent offset (x, z) -> unit direction, by exponential map.
   *
   * Exact, not a flat-plane approximation. At 100m out on a 1036m world the
   * plane is already 4.8m off the sphere, and the camera boom alone reaches
   * 40m — so the cheap version is not cheap enough anywhere but the origin.
   */
  dirAt(x, z, out = { x: 0, y: 0, z: 0 }) {
    const d = Math.hypot(x, z);
    if (d < 1e-9) { out.x = this.up.x; out.y = this.up.y; out.z = this.up.z; return out; }
    const ang = d / this.planet.radius;
    const c = Math.cos(ang), s = Math.sin(ang) / d;
    const tx = this.east.x * x + this.north.x * z;
    const ty = this.east.y * x + this.north.y * z;
    const tz = this.east.z * x + this.north.z * z;
    out.x = this.up.x * c + tx * s;
    out.y = this.up.y * c + ty * s;
    out.z = this.up.z * c + tz * s;
    const l = Math.hypot(out.x, out.y, out.z) || 1;
    out.x /= l; out.y /= l; out.z /= l;
    return out;
  }

  /** Local (x, y, z) -> world position, y measured from sea level. */
  toWorld(x, y, z, out = { x: 0, y: 0, z: 0 }) {
    this.dirAt(x, z, out);
    const r = this.planet.surfaceR + y;
    out.x *= r; out.y *= r; out.z *= r;
    return out;
  }

  /** World position -> local (x, y, z) in this frame. */
  toLocal(wx, wy, wz, out = { x: 0, y: 0, z: 0 }) {
    const r = Math.hypot(wx, wy, wz) || 1;
    const dx = wx / r, dy = wy / r, dz = wz / r;
    const dot = clamp(dx * this.up.x + dy * this.up.y + dz * this.up.z, -1, 1);
    const ang = Math.acos(dot);
    // Component of the direction in the tangent plane, re-scaled to arc length.
    let tx = dx - this.up.x * dot, ty = dy - this.up.y * dot, tz = dz - this.up.z * dot;
    const tl = Math.hypot(tx, ty, tz);
    const arc = ang * this.planet.radius;
    if (tl > 1e-9) { tx /= tl; ty /= tl; tz /= tl; } else { tx = ty = tz = 0; }
    out.x = (tx * this.east.x + ty * this.east.y + tz * this.east.z) * arc;
    out.z = (tx * this.north.x + ty * this.north.y + tz * this.north.z) * arc;
    out.y = r - this.planet.surfaceR;
    return out;
  }

  /**
   * Walk the anchor along the surface by a tangent offset and carry the basis
   * with it.
   *
   * The basis is rotated by exactly the rotation that takes the old up to the
   * new one, which is parallel transport along the geodesic. That is what
   * keeps craft.yaw meaningful across the move: the frame turns with the
   * craft, so a heading measured against it does not drift.
   */
  advance(dx, dz) {
    if (dx === 0 && dz === 0) return;
    const from = this.up;
    const to = this.dirAt(dx, dz, T1);
    // Rotation axis and angle between the two ups.
    let kx = from.y * to.z - from.z * to.y;
    let ky = from.z * to.x - from.x * to.z;
    let kz = from.x * to.y - from.y * to.x;
    const sinA = Math.hypot(kx, ky, kz);
    const cosA = clamp(from.x * to.x + from.y * to.y + from.z * to.z, -1, 1);
    this.up.x = to.x; this.up.y = to.y; this.up.z = to.z;
    if (sinA < 1e-12) return;              // already there
    kx /= sinA; ky /= sinA; kz /= sinA;
    const a = Math.atan2(sinA, cosA);
    rodrigues(this.east, kx, ky, kz, a);
    rodrigues(this.north, kx, ky, kz, a);
    // Re-orthonormalise. Thousands of small rotations a minute will drift.
    orthonormalise(this);
  }
}

/** Rotate v about unit axis k by angle a, in place. */
function rodrigues(v, kx, ky, kz, a) {
  const c = Math.cos(a), s = Math.sin(a);
  const dot = kx * v.x + ky * v.y + kz * v.z;
  const cx = ky * v.z - kz * v.y;
  const cy = kz * v.x - kx * v.z;
  const cz = kx * v.y - ky * v.x;
  v.x = v.x * c + cx * s + kx * dot * (1 - c);
  v.y = v.y * c + cy * s + ky * dot * (1 - c);
  v.z = v.z * c + cz * s + kz * dot * (1 - c);
}

function orthonormalise(fr) {
  const u = fr.up, e = fr.east;
  // Gram-Schmidt east against up, then rebuild north from the cross product.
  const d = e.x * u.x + e.y * u.y + e.z * u.z;
  e.x -= u.x * d; e.y -= u.y * d; e.z -= u.z * d;
  const l = Math.hypot(e.x, e.y, e.z) || 1;
  e.x /= l; e.y /= l; e.z /= l;
  // east x up, matching setDir — see the note there about determinant -1.
  fr.north.x = e.y * u.z - e.z * u.y;
  fr.north.y = e.z * u.x - e.x * u.z;
  fr.north.z = e.x * u.y - e.y * u.x;
}

// ---- planets ------------------------------------------------------------

/**
 * Fill in everything derivable from a profile's radius.
 *
 * The finest mesh cell is held near a constant metre size across worlds so the
 * vehicles handle the same everywhere, which means the quadtree depth has to
 * change with radius rather than the cell size.
 */
export function makePlanet(profile) {
  const R = profile.radius;
  const faceArc = R * Math.PI / 2;          // arc length across one cube face
  const maxLevel = clamp(
    Math.round(Math.log2(faceArc / (profile.leafRes * profile.targetCell))), 1, 7);
  const leafArc = faceArc / Math.pow(2, maxLevel);
  return Object.assign({}, profile, {
    faceArc,
    maxLevel,
    // The radius at which local y is zero: this world's sea level. Terrain is
    // drawn at surfaceR + height(), and height() is now measured from the same
    // waterline, so the ground lands at R + (its raw offset) on every world.
    surfaceR: R + profile.waterY,
    // A dry world has no shell to build and nothing to flood in.
    hasWater: !profile.dry,
    // uv size of one grid cell in the finest leaf. This is the lattice the
    // vehicles actually ride, and what surfaceHeight has to reproduce.
    finestCellUV: (2 / Math.pow(2, maxLevel)) / profile.leafRes,
    finestCellArc: leafArc / profile.leafRes,
    // Horizon at a 2m eye, the number that makes each world feel its size.
    horizon: Math.sqrt(2 * R * 2),
    fogNear: R * profile.fogNear,
    fogFar: R * profile.fogFar,
    farPlane: R * 4,
  });
}

/** Great-circle distance in metres between two unit directions. */
export function arcBetween(a, b, radius) {
  const d = clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1);
  return Math.acos(d) * radius;
}
