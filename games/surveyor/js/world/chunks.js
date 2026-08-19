// Finite terrain by cube-face quadtree. Six roots, each subdivided by angular
// distance from the player, so the ground under you is fine and the far side of
// the planet is four triangles.
//
// What carried over from the LOD ring grid, because it all still matters:
//   - a build budget per frame, so a fast jet never stalls on mesh generation
//   - vertical skirts, so a seam between LOD levels never shows as sky
//   - rocks baked into the leaf mesh, streaming with the ground for free
//
// What is better: the tree is bounded. A finite world has a knowable leaf
// count, so there is no unbounded stream to leak.

import { height, fissureAt } from './noise.js';
import { faceDir, dirToFace, arcBetween } from './sphere.js';
import { splitNode } from './surface.js';
import { appendRocks, appendMonuments } from './scatter.js';
import { appendFlora } from './flora.js';
import { floraOf } from './materials.js';
import { WORLD } from '../tune.js';

const D = { x: 0, y: 0, z: 0 };

export class ChunkField {
  constructor(scene, material, planet) {
    this.scene = scene;
    this.material = material;
    this.planet = planet;
    /* Resolved once per field rather than per leaf: the stack is a pure
       function of the profile and a leaf builds while you are driving. null
       means this world has no vegetation and the whole system is skipped. */
    this.flora = floraOf(planet);
    // Home opts its flora and rocks onto the leaf's own height lattice —
    // cheaper and sits everything on the drawn ground. See appendFlora and
    // appendRocks.
    this.floraOnGrid = !!(planet.flora && planet.flora.onGrid);
    this.rocksOnGrid = !!(planet.scatter && planet.scatter.onGrid);
    // How many finest levels carry ANY layer — the widest per-layer reach.
    // appendFlora gates each layer to its own reach inside that.
    this.floraReach = this.flora
      ? Math.max(...Object.values(this.flora).map((L) => L.levels || WORLD.floraLevels))
      : 0;
    this.live = new Map();       // key -> { mesh, level }
    this.queue = [];
    this.wanted = new Set();
    this.player = { x: 0, y: 1, z: 0 };
    this.dirty = true;
    this.visited = new Set();
    this.builds = 0;
  }

  /** Player direction drives the whole tree. */
  update(dir) {
    const moved = arcBetween(dir, this.player, this.planet.radius);
    if (moved > this.planet.finestCellArc * 0.5 || this.dirty) {
      this.player.x = dir.x; this.player.y = dir.y; this.player.z = dir.z;
      this.dirty = false;
      this.refresh();
    }
    // Sectors surveyed, keyed on the finest leaf you have stood in.
    this.visited.add(this.leafKeyAt(dir));

    /* Builds are budgeted by TIME as well as count. A max-detail Home leaf is
       ~4.2ms of CPU, and two of them landing in one frame on top of the render
       was most of what dev/flycheck.mjs measured as hitches at jet boost. One
       build per frame is 60 leaves a second, four times what a 158m/s boost
       actually demands (~15/s measured), so capping the frame's build time
       costs no streaming and buys back the worst frame. The first build always
       runs — a stall must never starve the queue entirely. */
    let built = 0;
    const t0 = performance.now();
    while (this.queue.length && built < WORLD.buildBudgetPerFrame &&
      (built === 0 || performance.now() - t0 < WORLD.buildBudgetMs)) {
      const job = this.queue.shift();
      if (this.live.has(job.key) || !this.wanted.has(job.key)) continue;
      const mesh = this.build(job.f, job.u0, job.v0, job.size, job.level);
      this.live.set(job.key, { mesh, level: job.level });
      // Whoever wants to know a leaf exists. The shadow pass does: its render
      // list has to follow a stream that builds and drops meshes every frame.
      if (this.onBuild) this.onBuild(mesh);
      this.builds++;
      built++;
    }
  }

  /** Walk the six roots, collect the leaf set, queue what is missing. */
  refresh() {
    const P = this.planet;
    this.wanted.clear();
    const jobs = [];
    const walk = (f, u0, v0, size, level) => {
      if (splitNode(P, f, u0, v0, size, level, this.player)) {
        const h = size * 0.5;
        walk(f, u0, v0, h, level + 1);
        walk(f, u0 + h, v0, h, level + 1);
        walk(f, u0, v0 + h, h, level + 1);
        walk(f, u0 + h, v0 + h, h, level + 1);
        return;
      }
      const key = `${f}:${level}:${Math.round((u0 + 1) / size)},${Math.round((v0 + 1) / size)}`;
      this.wanted.add(key);
      if (!this.live.has(key)) {
        faceDir(f, u0 + size * 0.5, v0 + size * 0.5, D);
        jobs.push({
          key, f, u0, v0, size, level,
          d: arcBetween(D, this.player, P.radius),
        });
      }
    };
    for (let f = 0; f < 6; f++) walk(f, -1, -1, 2, 0);

    // Nearest first, so the ground under the player exists before the horizon.
    jobs.sort((a, b) => a.d - b.d);
    this.queue = jobs;

    // Drop anything the tree no longer wants.
    for (const [key, entry] of this.live) {
      if (!this.wanted.has(key)) {
        if (this.onDrop) this.onDrop(entry.mesh);
        entry.mesh.dispose();
        this.live.delete(key);
      }
    }
  }

  /** Index of the max-level leaf containing a direction. One "sector". */
  leafKeyAt(dir) {
    const P = this.planet;
    if (!this._fc) this._fc = { f: 0, u: 0, v: 0 };
    const fc = dirToFace(dir.x, dir.y, dir.z, this._fc);
    const c = P.finestCellUV * P.leafRes;
    return fc.f + ':' + Math.floor(fc.u / c) + ',' + Math.floor(fc.v / c);
  }

  /**
   * One leaf mesh. Vertices are generated in world space around the planet
   * centre and then rebased to the leaf's own centre, so each mesh keeps its
   * numbers small and can freeze its world matrix.
   */
  build(f, u0, v0, size, level) {
    const P = this.planet;
    const res = P.leafRes;
    const step = size / res;

    // Height lattice first — every corner sampled once, not four times.
    const grid = new Float64Array((res + 1) * (res + 1));
    for (let j = 0; j <= res; j++) {
      for (let i = 0; i <= res; i++) {
        faceDir(f, u0 + i * step, v0 + j * step, D);
        grid[j * (res + 1) + i] = height(D, P);
      }
    }

    // Leaf centre, which becomes the mesh origin.
    faceDir(f, u0 + size * 0.5, v0 + size * 0.5, D);
    const ox = D.x * P.surfaceR, oy = D.y * P.surfaceR, oz = D.z * P.surfaceR;

    const dirTmp = { x: 0, y: 0, z: 0 };
    const pt = (i, j) => {
      faceDir(f, u0 + i * step, v0 + j * step, dirTmp);
      const r = P.surfaceR + grid[j * (res + 1) + i];
      return [dirTmp.x * r - ox, dirTmp.y * r - oy, dirTmp.z * r - oz];
    };
    // A point pulled inward toward the planet centre — the skirt hem.
    const hem = (i, j) => {
      faceDir(f, u0 + i * step, v0 + j * step, dirTmp);
      const r = P.surfaceR + grid[j * (res + 1) + i] - WORLD.skirt;
      return [dirTmp.x * r - ox, dirTmp.y * r - oy, dirTmp.z * r - oz];
    };

    const pos = [];
    const nrm = [];

    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
        // Split along the shorter diagonal so ridges stay sharp.
        //
        // Wound (a, c, b) — reversed from the flat world's (a, b, c). Stepping
        // +u then +v on a cube face has the opposite handedness to stepping +x
        // then +z on a plane, so carrying the old vertex order across inverted
        // every triangle on the planet: the ground was back-facing AND lit from
        // underneath at the same time.
        const ac = Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
        const bd = Math.hypot(b[0] - d[0], b[1] - d[1], b[2] - d[2]);
        if (ac <= bd) { tri(pos, nrm, a, c, b); tri(pos, nrm, a, d, c); }
        else { tri(pos, nrm, a, d, b); tri(pos, nrm, b, d, c); }
      }
    }

    // Skirts: a curtain hanging inward off every edge, hiding LOD seams.
    for (let i = 0; i < res; i++) {
      skirt(pos, nrm, pt(i, 0), pt(i + 1, 0), hem(i, 0), hem(i + 1, 0));
      skirt(pos, nrm, pt(i + 1, res), pt(i, res), hem(i + 1, res), hem(i, res));
      skirt(pos, nrm, pt(0, i + 1), pt(0, i), hem(0, i + 1), hem(0, i));
      skirt(pos, nrm, pt(res, i), pt(res, i + 1), hem(res, i), hem(res, i + 1));
    }

    // The lattice above, re-read bilinearly in leaf uv, for whichever of the
    // scatter passes below has opted onto it. Clamped so a gradient probe half
    // a cell past the edge reads the edge rather than walking off the array.
    const gridSample = (this.floraOnGrid || this.rocksOnGrid) ? (lu, lv) => {
      const gx = Math.min(res, Math.max(0, lu * res));
      const gy = Math.min(res, Math.max(0, lv * res));
      const i = Math.min(res - 1, gx | 0), j = Math.min(res - 1, gy | 0);
      const fx = gx - i, fy = gy - j;
      const r0 = j * (res + 1) + i, r1 = r0 + res + 1;
      return (grid[r0] * (1 - fx) + grid[r0 + 1] * fx) * (1 - fy) +
             (grid[r1] * (1 - fx) + grid[r1 + 1] * fx) * fy;
    } : null;

    if (level >= P.maxLevel - (WORLD.rockLevels - 1)) {
      appendRocks(P, f, u0, v0, size, ox, oy, oz, pos, nrm,
        this.rocksOnGrid ? gridSample : null);
    }
    /* Monuments ride every level, not just the rock levels: a landmark that
       pops in at 200m is not a landmark. Same geometry at every level, so the
       LOD handoff under one never moves a vertex. No-op unless the world's
       scatter profile asks (scatter.monuments). */
    appendMonuments(P, f, u0, v0, size, ox, oy, oz, pos, nrm);

    /* VEGETATION, on the finest levels only and after the rocks.
       WORLD.floraLevels is the single biggest lever on what this costs, ahead
       of density: it decides how much GROUND carries blades at all, and one
       level out is four times the area. It shipped at 1 and reads at 2 — at 1
       the vegetation only existed in the leaves immediately under the craft and
       the field ended in a visible ring a few metres away.
       `sway` starts as -1 for every vertex emitted so far — terrain, skirts and
       rocks — which is the value that means "not vegetation" and is what keeps
       the terrain shader from having to know which world it is drawing. */
    const before = pos.length / 3;
    const sway = new Array(before).fill(-1);
    let blades = 0;
    if (this.flora && level >= P.maxLevel - (this.floraReach - 1)) {
      blades = appendFlora(P, f, u0, v0, size, ox, oy, oz, pos, nrm, sway,
        WORLD.floraPerChunk, this.flora, this.floraOnGrid ? gridSample : null,
        level);
    }

    /* Bake the fissure mask (Phase 3a2). Ember's cracks glow, and the shader has
       no way to know where they are: the mask lives inside height(), which the
       GPU never sees.
       Filled from each vertex's own DIRECTION after the fact rather than
       threaded through the winding-critical emitters above — which means it
       cannot fall out of step with the vertex order, and it covers the skirts
       and the baked rocks for free. Zero everywhere else, because the shader
       always declares the attribute and only Ember pays for filling it. */
    const verts = pos.length / 3;
    const fis = new Float32Array(verts);
    if (P.wFissure > 0) {
      for (let i = 0; i < verts; i++) {
        const x = pos[i * 3] + ox, y = pos[i * 3 + 1] + oy, z = pos[i * 3 + 2] + oz;
        const l = Math.hypot(x, y, z) || 1;
        D.x = x / l; D.y = y / l; D.z = z / l;
        fis[i] = fissureAt(D, P);
      }
    }

    const mesh = new BABYLON.Mesh(`leaf_${f}_${level}_${u0.toFixed(3)}_${v0.toFixed(3)}`, this.scene);
    const vd = new BABYLON.VertexData();
    vd.positions = pos;
    vd.normals = nrm;
    // Non-indexed triangle soup: flat shading with no post-process pass.
    const idx = new Array(pos.length / 3);
    for (let i = 0; i < idx.length; i++) idx[i] = i;
    vd.indices = idx;
    vd.applyToMesh(mesh, false);
    mesh.setVerticesData('fissure', fis, false, 1);
    /* One float a vertex, the same budget the fissure mask spends. -1 is
       terrain, 0 is a blade's base and 1 is its tip; the terrain shader reads
       the sign as the flag and the magnitude as the wind weight. */
    mesh.setVerticesData('sway', new Float32Array(sway), false, 1);
    mesh.metadata = { blades, verts: pos.length / 3 };

    mesh.material = this.material;
    mesh.position.set(ox, oy, oz);
    mesh.freezeWorldMatrix();
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    mesh.renderingGroupId = 1;
    return mesh;
  }

  get sectorsMapped() { return this.visited.size; }

  /** Leaf count if the whole planet were at max detail — the tree's bound. */
  get maxLeaves() { return 6 * Math.pow(4, this.planet.maxLevel); }

  dispose() {
    for (const [, e] of this.live) {
      if (this.onDrop) this.onDrop(e.mesh);
      e.mesh.dispose();
    }
    this.live.clear();
  }
}

// Winding here is Babylon's front-facing one, for which the raw cross product
// points into the surface — so it is negated. Get this wrong and the whole
// planet is lit from underneath.
function tri(pos, nrm, a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = -(uy * vz - uz * vy);
  let ny = -(uz * vx - ux * vz);
  let nz = -(ux * vy - uy * vx);
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
}

function skirt(pos, nrm, a, b, a2, b2) {
  // Reversed for the same reason as the ground quads above.
  tri(pos, nrm, a, b2, b);
  tri(pos, nrm, a, a2, b2);
}
