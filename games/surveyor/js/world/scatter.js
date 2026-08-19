// Rock geometry is appended straight into the terrain chunk's vertex buffer.
// No instancing, no extra draw calls, no extra material — a boulder is
// literally part of the ground it sits on, and it streams in and out with it.

import { height } from './noise.js';
import { faceDir, dirToFace } from './sphere.js';
import { rngFor, range } from '../core/rng.js';
import { SCATTER } from '../tune.js';

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

/**
 * The vertical form: eroded sea stack, crystalline shard or fog-bound needle,
 * depending on `sides`, `taper` and how the caller has scaled radius against
 * height. Four sides with a taper near 1.0 is a faceted shard; seven sides with
 * a low taper is a blunt stack; six sides, thin and very tall, is a needle.
 */
function emitSpire(pos, nrm, rng, ox, oy, oz, radius, tall, sides, taper, lean0) {
  const segs = 4;
  const lean = range(rng, -lean0, lean0);
  const leanZ = range(rng, -lean0, lean0);
  const twist = range(rng, -0.5, 0.5);
  const ring = (k) => {
    const t = k / segs;
    const r = radius * Math.pow(1 - t, taper) * range(rng, 0.92, 1.08);
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
  // Cap the base. It is buried — spires are emitted from a metre below the
  // ground — so this is never seen, and it is here for the test rather than
  // the view: an open solid has no signed volume worth asserting on, and that
  // is precisely how an inside-out slab survived this long.
  for (let s = 1; s + 1 < lower.length; s++) {
    pushTri(pos, nrm, lower[0], lower[s], lower[s + 1]);
  }
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

/**
 * The blocky form. Home stands them up as broken slabs; Ember's `tall` of 0.30
 * against a `thin` of 2.3 lays the same solid down as a wide shattered plate,
 * and Anvil's scale turns it into a fallen wall.
 */
function emitSlab(pos, nrm, rng, ox, oy, oz, scale, tall, thin, tilt) {
  const w = scale * range(rng, 0.9, 2.0);
  const d = scale * thin * range(rng, 0.3, 0.65);
  const h = scale * tall * range(rng, 1.1, 2.6);
  const yaw = rng() * Math.PI * 2;
  const tiltX = range(rng, -tilt, tilt);
  const tiltZ = range(rng, -tilt, tilt);
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
  // Reversed. Every one of these six faces was wound inward — a slab has been
  // inside-out since the flat world, and nothing caught it: the only signed
  // volume check ran on Home, where the spires' open bases produce an enormous
  // position-dependent negative that swamped a few positive boxes. Ember is
  // slab-dominated and has no spires, so it is the first world where the sum
  // came out positive and the bug had nowhere to hide.
  for (const [a, b, c, dd] of quads) {
    pushTri(pos, nrm, corners[a], corners[c], corners[b]);
    pushTri(pos, nrm, corners[a], corners[dd], corners[c]);
  }
}

// ---- placement --------------------------------------------------------

const RD = { x: 0, y: 0, z: 0 };
const RE = { x: 0, y: 0, z: 0 };

/** The shared tangent-basis + rebase step, split out of appendRocks so the
 * monuments below can stand things up the same way. Fills XF for a direction
 * whose ground is at height h, rebased to a leaf origin. The east x up order
 * is load-bearing — the other way round is a reflection and every solid
 * pushed through it comes out inside-out. */
function basisAt(planet, dir, h, ox, oy, oz) {
  const r = planet.surfaceR + h;
  XF.ux = dir.x; XF.uy = dir.y; XF.uz = dir.z;
  XF.ox = dir.x * r - ox; XF.oy = dir.y * r - oy; XF.oz = dir.z * r - oz;
  const ax = Math.abs(dir.x), ay = Math.abs(dir.y), az = Math.abs(dir.z);
  let kx = 0, ky = 0, kz = 0;
  if (ax <= ay && ax <= az) kx = 1; else if (ay <= az) ky = 1; else kz = 1;
  XF.ex = ky * dir.z - kz * dir.y;
  XF.ey = kz * dir.x - kx * dir.z;
  XF.ez = kx * dir.y - ky * dir.x;
  const el = Math.hypot(XF.ex, XF.ey, XF.ez) || 1;
  XF.ex /= el; XF.ey /= el; XF.ez /= el;
  XF.nx = XF.ey * XF.uz - XF.ez * XF.uy;
  XF.ny = XF.ez * XF.ux - XF.ex * XF.uz;
  XF.nz = XF.ex * XF.uy - XF.ey * XF.ux;
}

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
  /* The world's rock profile. Geometry, not colour — rocks are baked into the
     terrain mesh and take the terrain palette for free, so the only thing left
     to differentiate is the silhouette, and that is what this is. */
  const S = Object.assign({}, SCATTER, planet.scatter || {});

  // Cluster seeds bias where rocks bunch up within the leaf, in uv space.
  const clusters = [];
  const nClusters = 2 + ((rng() * 3) | 0);
  for (let i = 0; i < nClusters; i++) {
    clusters.push([rng(), rng(), range(rng, 0.12, 0.34)]);
  }

  const attempts = Math.max(8, Math.round(42 * S.density * Math.min(1, arc / 160)));
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
    // Any tangent will do; rocks are rotationally random anyway.
    basisAt(planet, RD, h, ox, oy, oz);

    // Sizes are absolute metres — a boulder is a boulder on any planet — but
    // the tallest features are capped against relief so a spire cannot out-top
    // the world it stands on.
    // Rocks scale with the world. A 6m boulder is a landmark on Home and an
    // absurdity on a 10m-relief moon, and a spire must never out-top the
    // planet it stands on.
    //
    // `scale` raises the small-rock cap, because a world whose identity is
    // "enormous boulders" has to be allowed enormous boulders — but tallCap
    // stays absolute: out-topping the planet is not a stylistic choice.
    const tallCap = Math.max(3, relief * 0.42);
    const rockCap = Math.max(0.8, relief * 0.085) * S.scale;

    /* Which of the three solids. Weighted by the profile, with the old height
       gates kept as a bias rather than a hard rule: verticals still prefer high
       ground and small boulders the flats, but a world that asks for no spires
       (Ember) gets none anywhere, which a gate could not express.
       The gates SUPPRESS rather than promote. Promoting was the first cut, and
       it put two 20m spires next to Home's spawn — a spire on the flats has to
       be rare, or the world with a moderate mixed field reads as the world
       carried by verticals. */
    const bias = [
      S.forms[0] * (h < 0.05 * relief ? 1.4 : 1),
      S.forms[1] * (h > 0.22 * relief ? 1 : 0.55),
      S.forms[2] * (h > 0.55 * relief ? 1 : 0.30),
    ];
    const total = bias[0] + bias[1] + bias[2];
    if (total <= 0) continue;
    const roll = rng() * total;
    let form = 2, acc = 0;
    for (let k = 0; k < 3; k++) {
      acc += bias[k];
      if (roll <= acc) { form = k; break; }
    }

    if (form === 2) {
      emitSpire(pos, nrm, rng, 0, -1, 0,
        Math.min(rockCap, range(rng, 1.4, 3.4) * S.scale * S.thin),
        Math.min(tallCap, range(rng, 9, 26) * S.scale * S.tall),
        S.sides, S.taper, S.tilt * 0.30);
    } else if (form === 1) {
      emitSlab(pos, nrm, rng, 0, -0.4 * Math.min(1, S.tall), 0,
        Math.min(rockCap, range(rng, 1.2, 3.0) * S.scale), S.tall, S.thin, S.tilt);
    } else {
      // Big boulders are rarer, and the flats get pebbles rather than landmarks.
      const low = h < 0.05 * relief;
      const big = !low && rng() < 0.22;
      const base = low ? range(rng, 0.5, 1.3) : (big ? range(rng, 3.0, 6.5) : range(rng, 0.9, 2.4));
      emitBoulder(pos, nrm, rng, 0, low ? -0.25 : -0.5, 0,
        Math.min(rockCap, base * S.scale), big);
    }
  }
}

// ---- monuments ----------------------------------------------------------
//
// Hero formations: a fixed, seeded set of large landmarks a world can opt
// into with `scatter.monuments: N`. They are NOT part of the per-leaf rock
// roll, for two reasons that are both about being a landmark:
//
//   - Rocks exist only on the finest two LOD levels, so anything emitted
//     there pops into existence a couple of hundred metres out. A landmark's
//     whole job is to be visible from across the world, so monuments are
//     baked into EVERY level's leaf — the same full geometry each time, which
//     is what makes the LOD handoff invisible: the vertices are identical,
//     only the terrain under them changes resolution.
//   - The per-leaf rng stream must not move. Monuments draw from their own
//     rngFor streams, so a world that never asks for them emits every rock it
//     emitted before, bit for bit.
//
// A monument is a few thousand triangles at most, and dev/budget.mjs measured
// baked triangles as near-free — what is NOT free is a draw call, which is
// why these ride the terrain buffer like everything else on the ground.

const MON_CACHE = new Map();

/** The world's monument sites: seeded, dry, moderately flat, well spaced. */
export function monumentsOf(planet) {
  const S = planet.scatter || {};
  if (!S.monuments) return null;
  let list = MON_CACHE.get(planet.seed);
  if (list) return list;
  list = [];
  const rng = rngFor(planet.seed, 'monuments');
  const relief = planet.relief;
  const d = { x: 0, y: 0, z: 0 }, e = { x: 0, y: 0, z: 0 };
  const fc = { f: 0, u: 0, v: 0 };
  const step = 8 / planet.surfaceR;              // ~8m slope baseline, in radians
  for (let tries = 0; tries < 4000 && list.length < S.monuments; tries++) {
    // A random unit direction, from the monument stream only.
    let x = rng() * 2 - 1, y = rng() * 2 - 1, z = rng() * 2 - 1;
    const l = Math.hypot(x, y, z);
    if (l < 0.05 || l > 1) continue;
    d.x = x / l; d.y = y / l; d.z = z / l;
    const h = height(d, planet);
    // On land, below the mesa tops: a tower ON a summit outreaches the cap.
    if (h < 0.06 * relief || h > 0.45 * relief) continue;
    e.x = d.x + step * (1 - d.x * d.x); e.y = d.y - step * d.x * d.y; e.z = d.z - step * d.x * d.z;
    const le = Math.hypot(e.x, e.y, e.z); e.x /= le; e.y /= le; e.z /= le;
    if (Math.abs(height(e, planet) - h) / (8) > 0.30) continue;
    // Spacing: no two monuments crowd one horizon.
    let clear = true;
    for (const m of list) {
      if (m.dir.x * d.x + m.dir.y * d.y + m.dir.z * d.z > 0.9997) { clear = false; break; }
    }
    if (!clear) continue;
    dirToFace(d.x, d.y, d.z, fc);
    list.push({ i: list.length, dir: { x: d.x, y: d.y, z: d.z }, h, f: fc.f, u: fc.u, v: fc.v });
  }
  MON_CACHE.set(planet.seed, list);
  return list;
}

/**
 * Append every monument whose site falls inside this leaf's uv rect.
 * Called for leaves at EVERY level; the geometry is identical at each, so a
 * leaf split or merge under a monument never moves a vertex of it.
 */
export function appendMonuments(planet, f, u0, v0, size, ox, oy, oz, pos, nrm) {
  const list = monumentsOf(planet);
  if (!list) return 0;
  let made = 0;
  for (const M of list) {
    if (M.f !== f || M.u < u0 || M.u >= u0 + size || M.v < v0 || M.v >= v0 + size) continue;
    emitMonument(planet, M, ox, oy, oz, pos, nrm);
    made++;
  }
  return made;
}

const MW = { x: 0, y: 0, z: 0 };

function emitMonument(planet, M, ox, oy, oz, pos, nrm) {
  const rng = rngFor(planet.seed, 'monument:' + M.i);
  const relief = planet.relief;
  basisAt(planet, M.dir, M.h, ox, oy, oz);
  // Elements sit at local (ex, ez) offsets; each is grounded on its OWN
  // terrain height, read back through the world position, so a formation on
  // a gentle slope steps down the hill instead of floating off it.
  const R0 = planet.surfaceR + M.h;
  const groundAt = (lx, lz) => {
    MW.x = M.dir.x * R0 + XF.ex * lx + XF.nx * lz;
    MW.y = M.dir.y * R0 + XF.ey * lx + XF.ny * lz;
    MW.z = M.dir.z * R0 + XF.ez * lx + XF.nz * lz;
    const l = Math.hypot(MW.x, MW.y, MW.z) || 1;
    MW.x /= l; MW.y /= l; MW.z /= l;
    return height(MW, planet) - M.h;
  };

  const tallCap = relief * 0.62;
  if (rng() < 0.55) {
    /* A CROWN OF SPIRES: a ring rising toward one great central needle. */
    const n = 4 + ((rng() * 4) | 0);
    const spread = range(rng, 7, 13);
    const a0 = rng() * Math.PI * 2;
    emitSpire(pos, nrm, rng, 0, groundAt(0, 0) - 2, 0,
      range(rng, 3.2, 5.2), Math.min(tallCap, range(rng, 34, 52)),
      7, 0.62, 0.04);
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2 + range(rng, -0.3, 0.3);
      const dx = Math.cos(a) * spread * range(rng, 0.8, 1.3);
      const dz = Math.sin(a) * spread * range(rng, 0.8, 1.3);
      emitSpire(pos, nrm, rng, dx, groundAt(dx, dz) - 1.5, dz,
        range(rng, 1.8, 3.4), Math.min(tallCap * 0.62, range(rng, 14, 30)),
        6, 0.62, 0.10);
    }
  } else {
    /* A TIERED BUTTE: stacked, shrinking slabs — a stepped monolith. */
    const tiers = 3 + ((rng() * 3) | 0);
    let base = 0;
    const w0 = range(rng, 10, 16);
    for (let t = 0; t < tiers; t++) {
      const k = 1 - t / (tiers + 0.5);
      emitSlab(pos, nrm, rng, 0, groundAt(0, 0) + base - 1.5, 0,
        w0 * k * 0.5, range(rng, 2.2, 3.2), 1.6, 0.05);
      base += w0 * k * 0.5 * 2.0;                 // emitSlab's own h scale
      if (base > tallCap) break;
    }
  }
  // Scree: a skirt of boulders around the foot, so the thing meets the
  // ground the way fallen rock does rather than the way a chess piece does.
  const nb = 5 + ((rng() * 5) | 0);
  for (let i = 0; i < nb; i++) {
    const a = rng() * Math.PI * 2, r = range(rng, 9, 20);
    const dx = Math.cos(a) * r, dz = Math.sin(a) * r;
    emitBoulder(pos, nrm, rng, dx, groundAt(dx, dz) - 0.6, dz,
      range(rng, 1.4, 3.6), rng() < 0.4);
  }
}
