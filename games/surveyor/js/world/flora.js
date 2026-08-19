// Vegetation, baked straight into the terrain chunk's vertex buffer.
//
// NO INSTANCING, and that is a decision rather than a shortcut. Instancing is
// the right answer in an engine where the ground is a static mesh you scatter
// onto. This ground is a stream: chunks are built, dropped and rebuilt as you
// drive, at five LOD levels, and every one of them is a fresh mesh. An instance
// buffer would need its own lifetime tied to a mesh that is already being
// thrown away, its own culling, its own LOD and its own draw call per chunk.
// Rocks solved that by being part of the ground they sit on, and so does this:
// same buffer, same material, same draw call, streams and culls with the
// terrain because it IS the terrain.
//
// NO DOWNLOADED MODELS EITHER, and that one is arithmetic rather than taste. A
// max-detail leaf is about 2800 triangles including its rocks. A stylised CC0
// tree is 400 to 2000 triangles; fifty of them in one leaf is 20k to 100k, or
// seven to thirty-five times the entire leaf. Real models are affordable only
// as instances, and instancing is the thing this design deliberately does not
// do. What is here instead is generated geometry at 3 to 30 triangles a plant —
// the same technique that produced the rock spires nobody calls procedural.
// See assets/CREDITS.md.
//
// FOUR LAYERS, because one form repeated is why a field reads as texture rather
// than as plants:
//
//     cover   3 tris    the ground layer
//     shrub  12 tris    mid-height, breaks up the ground plane
//     tree   20 tris    trunk and a tiered canopy. What reads from a distance
//     hero   32 tris    rare, larger, worth driving toward
//
// THE WIND IS ONE VERTEX ATTRIBUTE. Every vertex carries `sway`:
//
//     -1     not vegetation. Terrain and rocks.
//      0     pinned to the ground: a blade's base, a trunk's foot
//      1     the part the wind has all of: a tip, the top of a canopy
//
// One float, the same budget the fissure mask already spends, doing three jobs:
// the sign flags a vertex as vegetation for the tint, the magnitude weights the
// wind, and together they bend a plant from its base rather than sliding it.
// The oscillation PHASE is hashed from world position in the shader, so it
// costs nothing and neighbouring plants are never in step.
//
// Wound clockwise with negated normals, matching the terrain and the rocks.

import { height } from './noise.js';
import { faceDir } from './sphere.js';
import { rngFor, range } from '../core/rng.js';
import { WORLD } from '../tune.js';

const RD = { x: 0, y: 0, z: 0 };
const RE = { x: 0, y: 0, z: 0 };

// Where the plant being emitted sits, and which way is up there. Module state
// for the same reason scatter.js keeps one: threading a basis through every
// emitter buys nothing and costs an allocation per plant.
const XF = {
  ox: 0, oy: 0, oz: 0,
  ex: 1, ey: 0, ez: 0,
  ux: 0, uy: 1, uz: 0,
  nx: 0, ny: 0, nz: 1,
};

/** Local (x, up, z) in the plant's frame -> world, rebased to the leaf. */
function place(x, y, z, out) {
  out[0] = XF.ox + XF.ex * x + XF.ux * y + XF.nx * z;
  out[1] = XF.oy + XF.ey * x + XF.uy * y + XF.ny * z;
  out[2] = XF.oz + XF.ez * x + XF.uz * y + XF.nz * z;
  return out;
}

/* SCRATCH VECTORS, REUSED, and they are not premature. The first cut built
   every point with `[0, 0, 0]` literals — five allocations a plant, times the
   per-leaf count, times every leaf that streams in while you drive. Leaf build
   is asserted against a 6ms budget in dev/run.mjs. Nothing here outlives the
   call, so nothing here needs to be allocated in it. */
const V = [];
for (let i = 0; i < 10; i++) V.push([0, 0, 0]);

/* Ring scratch for the shell canopies and lobes below — up to five rows of
   nine points, reused for the same reason as V. */
const RINGS = [];
for (let i = 0; i < 48; i++) RINGS.push([0, 0, 0]);

/* Cheap deterministic 0..1 from a float. Used for the silhouette jitter so
   variety comes from the plant's own position rather than from the rng —
   drawing it from the rng would shift every draw after it and reshuffle the
   whole leaf, including on the worlds that opted out. */
const h01 = (x) => { const s = Math.sin(x) * 43758.5453; return s - Math.floor(s); };

/**
 * One triangle, wound clockwise with a negated normal, exactly as the terrain
 * and the rocks are.
 *
 * Vegetation is effectively double-sided: the terrain material does not cull,
 * so a leaf blade is one triangle seen from both faces and a second facing the
 * other way would double the cost of the whole system for nothing.
 */
function tri(pos, nrm, sway, a, b, c, sa, sb, sc) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx = -nx / l; ny = -ny / l; nz = -nz / l;
  // Written out rather than looped over an array of pairs: that literal would
  // be three allocations per triangle.
  pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  sway.push(sa, sb, sc);
}

// ---- the forms -----------------------------------------------------------

/**
 * A blade: a quad tapering to a leaning point. Three triangles.
 *
 * Three vertices would be cheaper and it was the first cut. It reads as a shard
 * rather than a blade, because a triangle bends around its own centroid when
 * the wind attribute weights it and the silhouette stays straight. The waist
 * gives the tip a segment to lean on, which is where the movement reads.
 */
function blade(pos, nrm, sway, rng, L, scale) {
  const h = range(rng, L.height[0], L.height[1]) * scale;
  const w = range(rng, L.width[0], L.width[1]) * h;
  const a = rng() * Math.PI * 2;
  const cx = Math.cos(a), cz = Math.sin(a);
  const lean = range(rng, -L.lean, L.lean) * h;
  const lx = Math.cos(a + 1.57) * lean, lz = Math.sin(a + 1.57) * lean;
  const mid = L.waist;

  const b0 = place(cx * w, 0, cz * w, V[0]);
  const b1 = place(-cx * w, 0, -cz * w, V[1]);
  const m0 = place(cx * w * mid + lx * 0.45, h * 0.55, cz * w * mid + lz * 0.45, V[2]);
  const m1 = place(-cx * w * mid + lx * 0.45, h * 0.55, -cz * w * mid + lz * 0.45, V[3]);
  const tp = place(lx, h, lz, V[4]);

  tri(pos, nrm, sway, b0, m0, b1, 0, 0.55, 0);
  tri(pos, nrm, sway, b1, m0, m1, 0, 0.55, 0.55);
  tri(pos, nrm, sway, m0, tp, m1, 0.55, 1, 0.55);
}

/**
 * A shrub: four blades in a rosette off one root, splayed outward.
 *
 * The splay is the whole difference from four blades that happen to be near
 * each other. A rosette has a silhouette at thirty metres; four upright blades
 * do not, they read as noise. Twelve triangles.
 */
function shrub(pos, nrm, sway, rng, L, scale) {
  const h0 = range(rng, L.height[0], L.height[1]) * scale;
  const n = 4;
  const a0 = rng() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2 + range(rng, -0.3, 0.3);
    const h = h0 * range(rng, 0.62, 1.0);
    const w = range(rng, L.width[0], L.width[1]) * h;
    const cx = Math.cos(a), cz = Math.sin(a);
    // Splayed: the tip is pushed out along its own bearing, not straight up.
    const out = h * L.splay;
    const tx = cx * out, tz = cz * out;
    const px = Math.cos(a + 1.57), pz = Math.sin(a + 1.57);

    const b0 = place(px * w, 0, pz * w, V[0]);
    const b1 = place(-px * w, 0, -pz * w, V[1]);
    const m0 = place(tx * 0.5 + px * w * 0.7, h * 0.55, tz * 0.5 + pz * w * 0.7, V[2]);
    const m1 = place(tx * 0.5 - px * w * 0.7, h * 0.55, tz * 0.5 - pz * w * 0.7, V[3]);
    const tp = place(tx, h, tz, V[4]);
    tri(pos, nrm, sway, b0, m0, b1, 0, 0.5, 0);
    tri(pos, nrm, sway, b1, m0, m1, 0, 0.5, 0.5);
    tri(pos, nrm, sway, m0, tp, m1, 0.5, 1, 0.5);
  }

  /* LOBES, gated on the profile saying so: faceted diamonds of foliage sat in
     the rosette, which is what turns four blades into a bush with a body. Ten
     triangles each — a five-sided ring, a top apex, an underside apex — with
     the ring roughed by the position hash so neighbouring bushes differ. All
     rng draws live inside the gate; see the note on h01 above. */
  if (L.lobes) {
    const seed = XF.ox * 12.9898 + XF.oz * 78.233;
    const lsides = 5;
    for (let i = 0; i < L.lobes; i++) {
      const a = a0 + (i / L.lobes) * Math.PI * 2 + range(rng, -0.5, 0.5);
      const d = h0 * range(rng, 0.10, 0.42);
      const cy = h0 * range(rng, 0.30, 0.60);
      const lr = h0 * range(rng, 0.30, 0.48);
      const cx2 = Math.cos(a) * d, cz2 = Math.sin(a) * d;
      for (let s = 0; s < lsides; s++) {
        const aa = a0 + (s / lsides) * Math.PI * 2;
        const j = 1 + 0.34 * (h01(seed + i * 5.1 + s * 2.3) - 0.5);
        place(cx2 + Math.cos(aa) * lr * j, cy, cz2 + Math.sin(aa) * lr * j, RINGS[s]);
      }
      const topA = place(cx2, cy + lr * 1.05, cz2, V[4]);
      const botA = place(cx2, Math.max(0.02, cy - lr * 0.9), cz2, V[5]);
      for (let s = 0; s < lsides; s++) {
        const n = (s + 1) % lsides;
        tri(pos, nrm, sway, RINGS[s], topA, RINGS[n], 0.45, 0.8, 0.45);
        tri(pos, nrm, sway, RINGS[s], RINGS[n], botA, 0.45, 0.45, 0.25);
      }
    }
  }
}

/**
 * A tree: a tapered trunk and a canopy of stacked cones.
 *
 * THIS IS THE FORM THE WHOLE PASS EXISTS FOR. Ground cover cannot make a world
 * read as lush from a distance, because at thirty metres it is a texture on the
 * ground and nothing more. Something with a trunk and a silhouette standing off
 * the ground plane is what changes the read, and it is why "something tall" was
 * the thing most missing.
 *
 * The trunk is a tapered prism and it does NOT sway: a tree that bends at the
 * root reads as rubber. The canopy tiers do, increasingly with height, which is
 * what makes the crown drift while the trunk holds. `sides` x 2 for the trunk
 * plus `sides` x `tiers` for the canopy — twenty triangles at the defaults,
 * against four hundred to two thousand for a downloaded model.
 */
function tree(pos, nrm, sway, rng, L, scale) {
  const h = range(rng, L.height[0], L.height[1]) * scale;
  const trunkH = h * L.trunk;
  const r = h * L.girth;
  const sides = L.sides;
  const step = (Math.PI * 2) / sides;
  const a0 = rng() * Math.PI * 2;
  const lean = range(rng, -L.lean, L.lean) * h;
  const la = rng() * Math.PI * 2;
  const lx = Math.cos(la) * lean, lz = Math.sin(la) * lean;

  // Trunk: a prism from a wide foot to a narrow neck, leaning with the tree.
  for (let i = 0; i < sides; i++) {
    const a = a0 + i * step, b = a0 + (i + 1) * step;
    const x0 = Math.cos(a) * r, z0 = Math.sin(a) * r;
    const x1 = Math.cos(b) * r, z1 = Math.sin(b) * r;
    const k = L.taper;
    const f0 = place(x0, 0, z0, V[0]);
    const f1 = place(x1, 0, z1, V[1]);
    const t0 = place(x0 * k + lx * L.trunk, trunkH, z0 * k + lz * L.trunk, V[2]);
    const t1 = place(x1 * k + lx * L.trunk, trunkH, z1 * k + lz * L.trunk, V[3]);
    tri(pos, nrm, sway, f0, t0, f1, 0, 0, 0);
    tri(pos, nrm, sway, f1, t0, t1, 0, 0, 0);
  }

  /* BRANCHES, gated on the profile saying so. Bare three-sided spikes leaving
     the trunk just below the canopy — the mass the brief calls for between
     trunk and crown, and what stops the silhouette being a lollipop. Every rng
     draw sits inside the gate: a world that never asks for branches gets the
     exact stream, and therefore the exact field, it had before this existed. */
  if (L.branches) {
    for (let i = 0; i < L.branches; i++) {
      const ba = a0 + (i / L.branches) * Math.PI * 2 + range(rng, -0.4, 0.4);
      const bh = trunkH * range(rng, 0.72, 1.02);
      const bl = h * (L.branchLen || 0.30) * range(rng, 0.75, 1.15);
      const pitch = range(rng, 0.35, 0.75);
      const cx = Math.cos(ba), cz = Math.sin(ba);
      const ax = lx * (bh / h), az = lz * (bh / h);
      const br = r * 0.5;
      const px = Math.cos(ba + 1.5708), pz = Math.sin(ba + 1.5708);
      const b0 = place(ax + cx * r * 0.4 + px * br, bh - br * 0.8, az + cz * r * 0.4 + pz * br, V[0]);
      const b1 = place(ax + cx * r * 0.4 - px * br, bh - br * 0.8, az + cz * r * 0.4 - pz * br, V[1]);
      const b2 = place(ax + cx * r * 0.4, bh + br * 1.1, az + cz * r * 0.4, V[2]);
      const tp = place(ax + cx * bl * Math.cos(pitch), bh + bl * Math.sin(pitch),
        az + cz * bl * Math.cos(pitch), V[3]);
      tri(pos, nrm, sway, b0, tp, b1, 0.12, 0.35, 0.12);
      tri(pos, nrm, sway, b1, tp, b2, 0.12, 0.35, 0.12);
      tri(pos, nrm, sway, b2, tp, b0, 0.12, 0.35, 0.12);
    }
  }

  // Canopy: cones stacked up the trunk, each narrower than the one below it.
  // The overlap is what stops them reading as separate objects.
  // `tierVary` adds up to that many extra tiers per plant, so a stand is not
  // a stamp repeated; gated, like everything above, to keep opted-out worlds'
  // rng streams exact.
  const tiers = L.tiers + (L.tierVary ? ((rng() * (L.tierVary + 1)) | 0) : 0);
  const jig = L.jitter || 0;
  const seed = XF.ox * 12.9898 + XF.oz * 78.233;
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const base = trunkH + (h - trunkH) * f * 0.62;
    const top = base + (h - base) * range(rng, 0.72, 0.95);
    const rad = h * L.canopy * (1 - f * 0.42);
    const bx = lx * (base / h), bz = lz * (base / h);
    const tx = lx * (top / h), tz = lz * (top / h);
    // Sway rises up the tree, so the crown moves most and the neck least.
    const sBase = 0.25 + 0.5 * f;
    const sTop = 0.55 + 0.45 * f;
    const apex = place(tx, top, tz, V[4]);
    if (!L.shell) {
      for (let i = 0; i < sides; i++) {
        const a = a0 + i * step + f * 0.4, b = a0 + (i + 1) * step + f * 0.4;
        const p0 = place(bx + Math.cos(a) * rad, base, bz + Math.sin(a) * rad, V[0]);
        const p1 = place(bx + Math.cos(b) * rad, base, bz + Math.sin(b) * rad, V[1]);
        tri(pos, nrm, sway, p0, apex, p1, sBase, sTop, sBase);
      }
      continue;
    }

    /* THE SHELL: a closed faceted mass instead of an open cone. `shell` mid
       rings between the base ring and the apex, an underside fan so the tier
       has a bottom — an open cone reads as a paper hat the moment the camera
       is below it, which at 5m of boom on a 4m tree is most of the time — and
       a per-vertex radial jitter, hashed from the plant's own position, that
       roughs the silhouette so two trees are never the same solid. This is
       where the "200-400 triangles minimum" the brief asks for is spent: on
       the mass that reads at fifteen metres, not on more cones. */
    const rows = L.shell + 1;
    for (let k = 0; k < rows; k++) {
      const u = k / rows;
      const y = base + (top - base) * 0.75 * u;
      const rr = rad * (1 - 0.52 * u);
      const cx = bx + (tx - bx) * u, cz = bz + (tz - bz) * u;
      for (let i = 0; i < sides; i++) {
        const a = a0 + i * step + f * 0.4;
        const j = 1 + jig * (h01(seed + t * 7.31 + i * 2.17 + k * 3.9) - 0.5);
        place(cx + Math.cos(a) * rr * j, y, cz + Math.sin(a) * rr * j,
          RINGS[k * sides + i]);
      }
    }
    const under = place(bx, base - rad * 0.42, bz, V[5]);
    for (let i = 0; i < sides; i++) {
      const n = (i + 1) % sides;
      tri(pos, nrm, sway, RINGS[i], RINGS[n], under, sBase, sBase, sBase * 0.8);
      for (let k = 0; k < rows - 1; k++) {
        const s0 = sBase + (sTop - sBase) * (k / rows);
        const s1 = sBase + (sTop - sBase) * ((k + 1) / rows);
        const A = RINGS[k * sides + i], B = RINGS[k * sides + n];
        const C = RINGS[(k + 1) * sides + n], D = RINGS[(k + 1) * sides + i];
        tri(pos, nrm, sway, A, D, B, s0, s1, s0);
        tri(pos, nrm, sway, B, D, C, s0, s1, s1);
      }
      const kTop = (rows - 1) * sides;
      const sK = sBase + (sTop - sBase) * ((rows - 1) / rows);
      tri(pos, nrm, sway, RINGS[kTop + i], apex, RINGS[kTop + n], sK, sTop, sK);
    }
  }
}

const FORMS = { blade, shrub, tree };

// ---- placement -----------------------------------------------------------

/**
 * Vegetation for one leaf, appended into its buffers.
 *
 * Same contract as appendRocks: handed the leaf's face, its uv rect, its
 * origin, and the arrays being filled. `layers` is the resolved per-world
 * stack from floraOf(). Returns the number of plants emitted.
 */
/* `gridSample`, when given, is a bilinear read of the leaf's OWN height
   lattice (chunks.js hands it over, gated per world by flora.onGrid). Two
   things follow. It is cheaper: the lattice was already paid for, so clump
   placement stops re-deriving analytic heights that cost ~23 noise reads
   each. And it is more correct: the analytic curve floats above every convex
   cell of the drawn mesh by up to ~0.9m (run.mjs measures it), so plants
   placed on it hovered; plants placed on the lattice sit on the ground that
   is actually there. Gated rather than default because the switch moves
   every rejection test by centimetres and therefore reshuffles the field —
   the five untouched worlds must stay bit-identical. */
export function appendFlora(planet, f, u0, v0, size, ox, oy, oz, pos, nrm, sway,
  budget, layers, gridSample, level) {
  let made = 0;
  const base = `flora:${f}:${Math.round(u0 * 4096)},${Math.round(v0 * 4096)},${Math.round(size * 4096)}`;
  const arc = size * planet.faceArc * 0.5;         // leaf width in metres
  const relief = planet.relief;
  const du = size / planet.leafRes;
  const scale = (planet.faceArc * 0.5) * du;
  let left = budget | 0;

  for (const name of Object.keys(layers)) {
    const L = layers[name];
    if (!L.density || left <= 0) continue;
    /* Per-layer LOD reach: a layer carries into the finest `levels` quadtree
       levels (default: the global floraLevels). Trees can reach one level
       further than the ground cover — a treeline that materialises 200m out
       is a pop, a blade of grass that does is invisible. The skip sits before
       the rng is seeded, so a layer at default reach behaves exactly as it
       always has on every world. */
    const reach = L.levels || WORLD.floraLevels;
    if (level !== undefined && level < planet.maxLevel - (reach - 1)) continue;
    const rng = rngFor(planet.seed, `${base}:${name}`);

    /* WHERE EACH LAYER GROWS, as fractions of the world's OWN relief. These
       worlds run 5.5m to 87.8m of relief, so a band in metres would mean six
       different things and a fraction means one.
       This is also the distribution rule the brief asks for, stated per layer
       rather than per world: trees take a low band and a gentle slope, which
       is a valley; ground cover takes a wide band and a steeper one, which is
       a flat or a hillside; nothing takes a cliff. */
    const loH = L.band[0] * relief;
    const hiH = L.band[1] * relief;

    /* CLUMPS, and the clump is also where the SLOPE TEST lives.
       height() is multi-octave noise and it was the most expensive thing in
       this file. A clump is a couple of metres across and the ground under it
       does not change slope within that, so the slope is measured ONCE at the
       clump's centre — and the two partial derivatives it needs for that are
       exactly what lets every plant in the clump be placed by a first-order
       expansion instead of another height() call. */
    const clumps = [];
    const cell = 1 / planet.leafRes;          // one lattice cell, in leaf uv
    const nClumps = L.clumps[0] + ((rng() * (L.clumps[1] - L.clumps[0] + 1)) | 0);
    for (let i = 0; i < nClumps; i++) {
      const cu = rng(), cv = rng(), cr = range(rng, L.clump[0], L.clump[1]);
      let h, hu, hv;
      if (gridSample) {
        h = gridSample(cu, cv);
        if (h < loH || h > hiH) continue;
        hu = gridSample(cu + cell, cv);
        hv = gridSample(cu, cv + cell);
      } else {
        const u = u0 + cu * size, v = v0 + cv * size;
        faceDir(f, u, v, RD);
        h = height(RD, planet);
        if (h < loH || h > hiH) continue;
        faceDir(f, u + du, v, RE); hu = height(RE, planet);
        faceDir(f, u, v + du, RE); hv = height(RE, planet);
      }
      const slope = Math.hypot(hu - h, hv - h) / Math.max(scale, 1e-6);
      if (slope > L.slope) continue;
      // Thin approaching the limit rather than cutting at it, so a hillside
      // fades bare instead of ending in a line.
      if (rng() > 1 - (slope / L.slope) * L.slopeThin) continue;
      clumps.push([cu, cv, cr, h, (hu - h) / du, (hv - h) / du]);
    }
    if (!clumps.length) continue;

    const want = Math.round(L.density * L.perLeaf * Math.min(1, arc / 160));
    const attempts = Math.max(0, Math.min(want, left));
    const form = FORMS[L.form] || blade;

    for (let i = 0; i < attempts; i++) {
      const c = clumps[(rng() * clumps.length) | 0];
      const ang = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * c[2];
      const lu = c[0] + Math.cos(ang) * rr;
      const lv = c[1] + Math.sin(ang) * rr;
      if (lu < 0 || lu > 1 || lv < 0 || lv > 1) continue;

      // The ground height: read straight off the lattice when there is one
      // (a bilinear is cheaper than the first-order expansion was), else from
      // the clump's own gradient rather than another height() call — the
      // error is second-order in the clump radius and the clump has already
      // been rejected if it is steep.
      const h = gridSample ? gridSample(lu, lv)
        : c[3] + (lu - c[0]) * size * c[4] + (lv - c[1]) * size * c[5];
      if (h < loH || h > hiH) continue;

      const u = u0 + lu * size, v = v0 + lv * size;
      faceDir(f, u, v, RD);
      const R = planet.surfaceR + h;
      XF.ox = RD.x * R - ox; XF.oy = RD.y * R - oy; XF.oz = RD.z * R - oz;
      XF.ux = RD.x; XF.uy = RD.y; XF.uz = RD.z;
      // A stable perpendicular: cross the radial with whichever world axis it
      // is least aligned to, so the cross is never near zero.
      const a0 = Math.abs(RD.x) < 0.8 ? 1 : 0, a1 = Math.abs(RD.x) < 0.8 ? 0 : 1;
      const ex = a1 * RD.z;
      const ey = -a0 * RD.z;
      const ez = a0 * RD.y - a1 * RD.x;
      const el = Math.hypot(ex, ey, ez) || 1;
      XF.ex = ex / el; XF.ey = ey / el; XF.ez = ez / el;
      XF.nx = XF.uy * XF.ez - XF.uz * XF.ey;
      XF.ny = XF.uz * XF.ex - XF.ux * XF.ez;
      XF.nz = XF.ux * XF.ey - XF.uy * XF.ex;

      form(pos, nrm, sway, rng, L, range(rng, L.scale[0], L.scale[1]));
      made++;
      left--;
      if (left <= 0) break;
    }
  }
  return made;
}
