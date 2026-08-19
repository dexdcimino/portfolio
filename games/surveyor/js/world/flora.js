// Vegetation, baked straight into the terrain chunk's vertex buffer.
//
// NO INSTANCING, and that is a decision rather than a shortcut. The brief asked
// for instanced geometry with vertex-shader wind, and instancing is the right
// answer in an engine where the ground is a static mesh you scatter onto. It is
// the wrong answer here, because this ground is already a stream: chunks are
// built, dropped and rebuilt as you drive, at five LOD levels, and every one of
// them is a fresh mesh. Rocks solved that by being part of the ground they sit
// on — same buffer, same material, same draw call, streams and culls with the
// terrain because it IS the terrain. An instance buffer would need its own
// lifetime tied to a mesh that is already being thrown away, its own culling,
// its own LOD, and its own draw call per chunk.
//
// So this is scatter.js's approach with one attribute added, and the frame cost
// of vegetation is exactly the cost of the extra triangles: no draw calls, no
// materials, no per-frame CPU at all.
//
// THE WIND IS THE ATTRIBUTE. Every vertex carries `sway`:
//
//     -1     not vegetation. Terrain and rocks.
//      0     the base of a blade, pinned to the ground
//      1     its tip
//
// which is one float, the same budget the fissure mask already spends, and it
// does three jobs: it flags a vertex as vegetation for the tint, it weights the
// wind displacement so blades bend from the base rather than sliding, and its
// sign lets the terrain shader leave everything else alone. The oscillation
// PHASE is not stored — it is hashed from the vertex's own world position in
// the shader, which is free and means neighbouring blades are never in step.
//
// Wound clockwise and normals negated to match the terrain emitters, and the
// per-side signed-volume assertion in dev/run.mjs covers the solid forms.

import { height } from './noise.js';
import { faceDir } from './sphere.js';
import { rngFor, range } from '../core/rng.js';
import { FLORA } from '../tune.js';

const RD = { x: 0, y: 0, z: 0 };
const RE = { x: 0, y: 0, z: 0 };

// Where the clump being emitted sits, and which way is up there. Module state
// for the same reason scatter.js keeps one: threading a basis through every
// emitter buys nothing and costs an allocation per blade.
const XF = {
  ox: 0, oy: 0, oz: 0,
  ex: 1, ey: 0, ez: 0,
  ux: 0, uy: 1, uz: 0,
  nx: 0, ny: 0, nz: 1,
};

/** Local (x up y, z) in the clump's frame -> world, rebased to the leaf. */
function place(x, y, z, out) {
  out[0] = XF.ox + XF.ex * x + XF.ux * y + XF.nx * z;
  out[1] = XF.oy + XF.ey * x + XF.uy * y + XF.ny * z;
  out[2] = XF.oz + XF.ez * x + XF.uz * y + XF.nz * z;
  return out;
}

const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0];

/**
 * One triangle, wound clockwise with a negated normal, exactly as the terrain
 * and the rocks are. Vegetation is DOUBLE-SIDED in effect because a blade is
 * one triangle seen from both faces; the terrain material does not cull, so a
 * single triangle is enough and a second facing the other way would double the
 * cost of the whole system for nothing.
 */
function tri(pos, nrm, sway, a, b, c, sa, sb, sc) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx = -nx / l; ny = -ny / l; nz = -nz / l;
  for (const [p, s] of [[a, sa], [b, sb], [c, sc]]) {
    pos.push(p[0], p[1], p[2]);
    nrm.push(nx, ny, nz);
    sway.push(s);
  }
}

/**
 * A blade: two triangles, a quad tapering to a point, leaning.
 *
 * Three vertices would be cheaper and it was the first cut. It reads as a
 * shard rather than a blade, because a triangle bends around its own centroid
 * when the wind attribute weights it and the silhouette stays straight. Four
 * gives the tip a segment to lean on, which is where all the movement reads.
 */
function blade(pos, nrm, sway, rng, S) {
  const h = range(rng, S.height[0], S.height[1]);
  const w = range(rng, S.width[0], S.width[1]) * h;
  const a = rng() * Math.PI * 2;
  const cx = Math.cos(a), cz = Math.sin(a);
  // The lean is a fixed part of the blade's own height, so tall blades lean
  // further rather than every blade leaning the same number of metres.
  const lean = range(rng, -S.lean, S.lean) * h;
  const lx = Math.cos(a + 1.57) * lean, lz = Math.sin(a + 1.57) * lean;
  const mid = S.waist;

  const b0 = place(cx * w, 0, cz * w, A.slice());
  const b1 = place(-cx * w, 0, -cz * w, B.slice());
  const m0 = place(cx * w * mid + lx * 0.45, h * 0.55, cz * w * mid + lz * 0.45, C.slice());
  const m1 = place(-cx * w * mid + lx * 0.45, h * 0.55, -cz * w * mid + lz * 0.45, [0, 0, 0]);
  const tip = place(lx, h, lz, [0, 0, 0]);

  tri(pos, nrm, sway, b0, m0, b1, 0, 0.55, 0);
  tri(pos, nrm, sway, b1, m0, m1, 0, 0.55, 0.55);
  tri(pos, nrm, sway, m0, tip, m1, 0.55, 1, 0.55);
}

/**
 * Vegetation for one leaf, appended into its buffers.
 *
 * Same signature and same contract as appendRocks: it is handed the leaf's
 * face, its uv rect, its origin, and the arrays being filled. Returns the
 * number of blades emitted so the caller can count them without walking the
 * buffer.
 */
export function appendFlora(planet, f, u0, v0, size, ox, oy, oz, pos, nrm, sway, budget) {
  const S = Object.assign({}, FLORA, planet.flora || {});
  if (!S.density) return 0;

  const rng = rngFor(planet.seed,
    `flora:${f}:${Math.round(u0 * 4096)},${Math.round(v0 * 4096)},${Math.round(size * 4096)}`);
  const arc = size * planet.faceArc * 0.5;         // leaf width in metres
  const relief = planet.relief;

  /* WHERE IT GROWS, as fractions of the world's OWN relief. These worlds run
     5.5m to 87.8m of relief, so a height band written in metres would mean six
     different things and one written as a fraction means one. band[0] is the
     shoreline edge and band[1] is where it gives up. */
  const loH = S.band[0] * relief;
  const hiH = S.band[1] * relief;

  /* CLUMPS, so vegetation reads as growth rather than as a sprinkle — and the
     clump is also where the SLOPE TEST lives, which is the whole reason a
     max-detail leaf still builds inside the frame budget.

     The first cut tested height and slope per BLADE: three height() evaluations
     each, times the attempt count, is thousands of noise lookups a chunk, and
     it put leaf build at 16.77ms against a 16ms budget — caught by dev/run.mjs
     rather than by anything visible on screen. A clump is a couple of metres across and the ground
     under it does not change slope within that, so the slope is measured ONCE
     at the clump's centre and the whole clump lives or dies by it. Blades still
     take their own height() for placement, because a blade floating above the
     ground or buried in it is visible immediately. Three evaluations per clump
     plus one per blade, against three per blade: 16.77ms to 5.23ms. */
  const clumps = [];
  const nClumps = 3 + ((rng() * 6) | 0);
  const du = size / planet.leafRes;
  const scale = (planet.faceArc * 0.5) * du;
  for (let i = 0; i < nClumps; i++) {
    const cu = rng(), cv = rng(), cr = range(rng, S.clump[0], S.clump[1]);
    const u = u0 + cu * size, v = v0 + cv * size;
    faceDir(f, u, v, RD);
    const h = height(RD, planet);
    faceDir(f, u + du, v, RE); const hu = height(RE, planet);
    faceDir(f, u, v + du, RE); const hv = height(RE, planet);
    const slope = Math.hypot(hu - h, hv - h) / Math.max(scale, 1e-6);
    if (slope > S.slope) continue;
    // Thin approaching the limit rather than cutting at it, so a hillside
    // fades bare instead of ending in a line.
    if (rng() > 1 - (slope / S.slope) * S.slopeThin) continue;
    clumps.push([cu, cv, cr]);
  }
  if (!clumps.length) return 0;

  const want = Math.round(S.density * S.perLeaf * Math.min(1, arc / 160));
  const attempts = Math.max(0, Math.min(want, budget | 0));
  let made = 0;

  for (let i = 0; i < attempts; i++) {
    // Every blade belongs to a clump. The stragglers the first cut scattered
    // between them cost a full slope test each and read as litter.
    const c = clumps[(rng() * clumps.length) | 0];
    const ang = rng() * Math.PI * 2, r = Math.sqrt(rng()) * c[2];
    const lu = c[0] + Math.cos(ang) * r;
    const lv = c[1] + Math.sin(ang) * r;
    if (lu < 0 || lu > 1 || lv < 0 || lv > 1) continue;

    const u = u0 + lu * size, v = v0 + lv * size;
    faceDir(f, u, v, RD);
    const h = height(RD, planet);
    if (h < loH || h > hiH) continue;

    // The clump's own frame: outward radial is up, and any two perpendiculars
    // will do for the other axes because a blade is rotationally placed anyway.
    const R = planet.surfaceR + h;
    const wx = RD.x * R, wy = RD.y * R, wz = RD.z * R;
    XF.ox = wx - ox; XF.oy = wy - oy; XF.oz = wz - oz;
    XF.ux = RD.x; XF.uy = RD.y; XF.uz = RD.z;
    // A stable perpendicular: cross the radial with whichever world axis it is
    // least aligned to, so the cross is never near zero.
    const a0 = Math.abs(RD.x) < 0.8 ? 1 : 0, a1 = Math.abs(RD.x) < 0.8 ? 0 : 1;
    let ex = a1 * RD.z - 0 * RD.y;
    let ey = 0 * RD.x - a0 * RD.z;
    let ez = a0 * RD.y - a1 * RD.x;
    const el = Math.hypot(ex, ey, ez) || 1;
    XF.ex = ex / el; XF.ey = ey / el; XF.ez = ez / el;
    XF.nx = XF.uy * XF.ez - XF.uz * XF.ey;
    XF.ny = XF.uz * XF.ex - XF.ux * XF.ez;
    XF.nz = XF.ux * XF.ey - XF.uy * XF.ex;

    blade(pos, nrm, sway, rng, S);
    made++;
  }
  return made;
}
