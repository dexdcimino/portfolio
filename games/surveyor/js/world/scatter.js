// Rock geometry is appended straight into the terrain chunk's vertex buffer.
// No instancing, no extra draw calls, no extra material — a boulder is
// literally part of the ground it sits on, and it streams in and out with it.

import { height } from './noise.js';
import { faceDir } from './sphere.js';
import { rngFor, range } from '../core/rng.js';

// Where the rock currently being emitted sits, and which way is up there.
// Rocks are authored y-up around their own origin, exactly as on the flat
// world; this transform is what puts them on the side of a ball. Module state
// because threading a matrix through every emitter buys nothing.
const XF = {
  ox: 0, oy: 0, oz: 0,          // rock origin, already rebased to the leaf
  ex: 1, ey: 0, ez: 0,          // local +X
  ux: 0, uy: 1, uz: 0,          // local +Y, the outward radial
  nx: 0, ny: 0, nz: 1,          // local +Z
};

// ---- base solids ------------------------------------------------------

function icosahedron() {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((v) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  });
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  return { verts, faces };
}

function subdivide(shape) {
  const { verts, faces } = shape;
  const out = [];
  const cache = new Map();
  const mid = (a, b) => {
    const key = a < b ? a + ':' + b : b + ':' + a;
    if (cache.has(key)) return cache.get(key);
    const va = verts[a], vb = verts[b];
    const m = [(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2];
    const l = Math.hypot(m[0], m[1], m[2]);
    verts.push([m[0] / l, m[1] / l, m[2] / l]);
    const idx = verts.length - 1;
    cache.set(key, idx);
    return idx;
  };
  for (const [a, b, c] of faces) {
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    out.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  }
  return { verts, faces: out };
}

const ICO_LO = icosahedron();
const ICO_HI = subdivide(icosahedron());

// ---- emitters ---------------------------------------------------------
// Each pushes flat-shaded triangle soup into pos/nrm.

/** Rock-local (x, y, z) -> leaf-local, through XF. */
function place(p) {
  return [
    XF.ox + XF.ex * p[0] + XF.ux * p[1] + XF.nx * p[2],
    XF.oy + XF.ey * p[0] + XF.uy * p[1] + XF.ny * p[2],
    XF.oz + XF.ez * p[0] + XF.uz * p[1] + XF.nz * p[2],
  ];
}

/**
 * Emits a, c, b — reversed.
 *
 * The solids in this file are built counter-clockwise, which is the opposite of
 * what Babylon treats as front-facing (its own generators wind clockwise; a
 * unit sphere from CreateSphere has a *negative* signed volume). The terrain
 * and the craft were already wound Babylon's way, so the rocks were the odd one
 * out and rendered inside-out.
 *
 * The normal is negated for the same reason: for this winding the raw cross
 * product points into the solid, not out of it.
 */
function pushTri(pos, nrm, la, lb, lc) {
  const a = place(la), b = place(lb), c = place(lc);
  const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2];
  const vx = b[0] - a[0], vy = b[1] - a[1], vz = b[2] - a[2];
  let nx = -(uy * vz - uz * vy);
  let ny = -(uz * vx - ux * vz);
  let nz = -(ux * vy - uy * vx);
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  pos.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2]);
  nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
}

function emitBoulder(pos, nrm, rng, ox, oy, oz, scale, hi) {
  const src = hi ? ICO_HI : ICO_LO;
  const sx = scale * range(rng, 0.75, 1.35);
  const sy = scale * range(rng, 0.55, 1.05);
  const sz = scale * range(rng, 0.75, 1.35);
  const yaw = rng() * Math.PI * 2;
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  // Per-vertex jitter, cached so shared verts stay welded before flattening.
  const jitter = src.verts.map(() => range(rng, 0.76, 1.26));
  const put = (i) => {
    const v = src.verts[i], j = jitter[i];
    const x = v[0] * sx * j, y = v[1] * sy * j, z = v[2] * sz * j;
    return [ox + x * ca - z * sa, oy + y, oz + x * sa + z * ca];
  };
  for (const [a, b, c] of src.faces) pushTri(pos, nrm, put(a), put(b), put(c));
}

function emitSpire(pos, nrm, rng, ox, oy, oz, radius, tall) {
  const sides = 5 + ((rng() * 3) | 0);
  const segs = 4;
  const lean = range(rng, -0.10, 0.10);
  const leanZ = range(rng, -0.10, 0.10);
  const twist = range(rng, -0.5, 0.5);
  const ring = (k) => {
    const t = k / segs;
    const r = radius * Math.pow(1 - t, 0.62) * range(rng, 0.92, 1.08);
    const y = oy + tall * t;
    const cx = ox + lean * tall * t, cz = oz + leanZ * tall * t;
    const out = [];
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2 + twist * t;
      out.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]);
    }
    return out;
  };
  let lower = ring(0);
  for (let k = 1; k <= segs; k++) {
    const upper = ring(k);
    for (let s = 0; s < sides; s++) {
      const n = (s + 1) % sides;
      pushTri(pos, nrm, lower[s], upper[s], upper[n]);
      pushTri(pos, nrm, lower[s], upper[n], lower[n]);
    }
    lower = upper;
  }
  const tip = [
    ox + lean * tall * 1.06, oy + tall * 1.06, oz + leanZ * tall * 1.06,
  ];
  for (let s = 0; s < lower.length; s++) {
    pushTri(pos, nrm, lower[s], tip, lower[(s + 1) % lower.length]);
  }
}

function emitSlab(pos, nrm, rng, ox, oy, oz, scale) {
  const w = scale * range(rng, 0.9, 2.0);
  const d = scale * range(rng, 0.3, 0.65);
  const h = scale * range(rng, 1.1, 2.6);
  const yaw = rng() * Math.PI * 2;
  const tiltX = range(rng, -0.34, 0.34);
  const tiltZ = range(rng, -0.34, 0.34);
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  const corners = [];
  for (let i = 0; i < 8; i++) {
    const sx = (i & 1) ? 1 : -1;
    const sy = (i & 2) ? 1 : 0;
    const sz = (i & 4) ? 1 : -1;
    let x = sx * w * 0.5, y = sy * h, z = sz * d * 0.5;
    x += tiltX * y; z += tiltZ * y;
    corners.push([ox + x * ca - z * sa, oy + y, oz + x * sa + z * ca]);
  }
  const quads = [
    [0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1],
    [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3],
  ];
  for (const [a, b, c, dd] of quads) {
    pushTri(pos, nrm, corners[a], corners[b], corners[c]);
    pushTri(pos, nrm, corners[a], corners[c], corners[dd]);
  }
}

// ---- placement --------------------------------------------------------

const RD = { x: 0, y: 0, z: 0 };
const RE = { x: 0, y: 0, z: 0 };

/**
 * Append one leaf's rock field, in leaf-local coordinates.
 *
 * Density is deliberately uneven — clustered boulder fields and bare terraces
 * read better than a uniform sprinkle. Placement is seeded on the leaf's face
 * and uv rect, so a boulder is in the same place every time the leaf streams
 * back in, and rocks at the same spot on two different LOD levels agree.
 */
export function appendRocks(planet, f, u0, v0, size, ox, oy, oz, pos, nrm) {
  // Seeded on the leaf rect, quantised so floating point cannot shift it.
  const rng = rngFor(planet.seed,
    `rocks:${f}:${Math.round(u0 * 4096)},${Math.round(v0 * 4096)},${Math.round(size * 4096)}`);
  const arc = size * planet.faceArc * 0.5;    // leaf width in metres
  const relief = planet.relief;

  // Cluster seeds bias where rocks bunch up within the leaf, in uv space.
  const clusters = [];
  const nClusters = 2 + ((rng() * 3) | 0);
  for (let i = 0; i < nClusters; i++) {
    clusters.push([rng(), rng(), range(rng, 0.12, 0.34)]);
  }

  const attempts = Math.max(8, Math.round(42 * Math.min(1, arc / 160)));
  for (let i = 0; i < attempts; i++) {
    let lu, lv;
    if (rng() < 0.68) {
      const c = clusters[(rng() * clusters.length) | 0];
      const a = rng() * Math.PI * 2, r = rng() * c[2];
      lu = c[0] + Math.cos(a) * r;
      lv = c[1] + Math.sin(a) * r;
      if (lu < 0 || lu > 1 || lv < 0 || lv > 1) continue;
    } else {
      lu = rng(); lv = rng();
    }

    const u = u0 + lu * size, v = v0 + lv * size;
    faceDir(f, u, v, RD);
    const h = height(RD, planet);
    if (h < -0.03 * relief) continue;                  // underwater, skip

    // Slope from a small uv-space difference, in metres per metre.
    const du = size / planet.leafRes;
    const scale = (planet.faceArc * 0.5) * du;
    faceDir(f, u + du, v, RE); const hu = height(RE, planet);
    faceDir(f, u, v + du, RE); const hv = height(RE, planet);
    const slope = Math.hypot(hu - h, hv - h) / Math.max(scale, 0.001);
    if (slope > 0.75 && rng() < 0.85) continue;        // won't perch on a cliff

    // Build the tangent basis at this rock and rebase to the leaf origin.
    const r = planet.surfaceR + h;
    XF.ux = RD.x; XF.uy = RD.y; XF.uz = RD.z;
    XF.ox = RD.x * r - ox; XF.oy = RD.y * r - oy; XF.oz = RD.z * r - oz;
    // Any tangent will do; rocks are rotationally random anyway.
    const ax = Math.abs(RD.x), ay = Math.abs(RD.y), az = Math.abs(RD.z);
    let kx = 0, ky = 0, kz = 0;
    if (ax <= ay && ax <= az) kx = 1; else if (ay <= az) ky = 1; else kz = 1;
    XF.ex = ky * RD.z - kz * RD.y;
    XF.ey = kz * RD.x - kx * RD.z;
    XF.ez = kx * RD.y - ky * RD.x;
    const el = Math.hypot(XF.ex, XF.ey, XF.ez) || 1;
    XF.ex /= el; XF.ey /= el; XF.ez /= el;
    // east x up, not up x east. The other way round the transform has
    // determinant -1, and a reflection flips the winding of every solid pushed
    // through it — which turned the whole rock field inside-out.
    XF.nx = XF.ey * XF.uz - XF.ez * XF.uy;
    XF.ny = XF.ez * XF.ux - XF.ex * XF.uz;
    XF.nz = XF.ex * XF.uy - XF.ey * XF.ux;

    // Sizes are absolute metres — a boulder is a boulder on any planet — but
    // the tallest features are capped against relief so a spire cannot out-top
    // the world it stands on.
    // Rocks scale with the world. A 6m boulder is a landmark on Home and an
    // absurdity on a 10m-relief moon, and a spire must never out-top the
    // planet it stands on.
    const tallCap = Math.max(3, relief * 0.42);
    const rockCap = Math.max(0.8, relief * 0.085);
    if (h > 0.62 * relief && rng() < 0.42) {
      emitSpire(pos, nrm, rng, 0, -1, 0,
        Math.min(rockCap, range(rng, 1.4, 3.4)), Math.min(tallCap, range(rng, 9, 26)));
    } else if (h > 0.22 * relief && rng() < 0.34) {
      emitSlab(pos, nrm, rng, 0, -0.4, 0, Math.min(rockCap, range(rng, 1.2, 3.0)));
    } else if (h < 0.05 * relief && rng() < 0.55) {
      emitBoulder(pos, nrm, rng, 0, -0.25, 0, Math.min(rockCap, range(rng, 0.5, 1.3)), false);
    } else {
      const big = rng() < 0.22;
      emitBoulder(pos, nrm, rng, 0, -0.5, 0,
        Math.min(rockCap, big ? range(rng, 3.0, 6.5) : range(rng, 0.9, 2.4)), big);
    }
  }
}
