// world/chunks.js — chunk lifecycle: generate/dispose around a probe point,
// deterministic from seed ⊕ chunkCoord (TECH.md "World gen").
// Per chunk: ONE merged wall mesh (greedy-merged horizontal runs of wall cells,
// vertex-color tinted by biome blend) + one ground plane (per-biome material).
// Meshes are truly disposed on unload so scene.meshes.length stays stable;
// chunk record objects are pooled via core/pool.js.

import { CONFIG } from '../config.js';
import { createPool } from '../core/pool.js';
import { rngFor } from '../core/rng.js';
import { carveChunk, floorHeightAt, floorBaseAt, riverAt } from './carve.js';
import { populateChunk } from './spawner.js';
import { biomeAt, biomeBlendAt } from '../data/biomes.js';

const N = CONFIG.world.chunkSize;

function wallColorAt(dist) {
  const { a, b, t } = biomeBlendAt(dist);
  return BABYLON.Color3.Lerp(
    BABYLON.Color3.FromHexString(a.wallColor),
    BABYLON.Color3.FromHexString(b.wallColor),
    t
  );
}

function floorColorAt(dist) {
  const { a, b, t } = biomeBlendAt(dist);
  return BABYLON.Color3.Lerp(
    BABYLON.Color3.FromHexString(a.floorColor),
    BABYLON.Color3.FromHexString(b.floorColor),
    t
  );
}

function waterColorAt(dist) {
  const { a, b, t } = biomeBlendAt(dist);
  return BABYLON.Color3.Lerp(
    BABYLON.Color3.FromHexString(a.waterColor),
    BABYLON.Color3.FromHexString(b.waterColor),
    t
  );
}

// Bake a flat vertex color into a mesh so it survives Mesh.MergeMeshes.
function paint(mesh, c) {
  const count = mesh.getTotalVertices();
  const colors = new Float32Array(count * 4);
  for (let v = 0; v < count; v++) {
    colors[v * 4] = c.r;
    colors[v * 4 + 1] = c.g;
    colors[v * 4 + 2] = c.b;
    colors[v * 4 + 3] = 1;
  }
  mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, colors);
}

export class ChunkManager {
  constructor(scene, seed) {
    this.scene = scene;
    this.seed = seed;
    this.chunks = new Map(); // 'cx,cz' → record
    this.fades = new Map(); // 'cx,cz' → current wall alpha (occlusion, MD-04b)
    this.debugBorders = false;
    this.debugCells = false;

    this.recordPool = createPool(
      () => ({}),
      (rec, cx, cz) => {
        rec.cx = cx;
        rec.cz = cz;
        rec.grid = null;
        rec.wall = null;
        rec.ground = null;
        rec.water = null;
        rec.decor = null;
        rec.border = null;
        rec.overlay = null;
        rec.foods = null;
        rec.enemies = null;
      }
    );

    this.wallMat = new BABYLON.StandardMaterial('wallMat', scene);
    this.wallMat.diffuseColor = BABYLON.Color3.White(); // × vertex color = biome tint
    this.wallMat.specularColor = BABYLON.Color3.Black();
    this.floorMats = new Map(); // biome key → material
    this.debugCellMat = null;
  }

  key(cx, cz) {
    return cx + ',' + cz;
  }

  // Terrain height for entity visuals (gameplay stays on the 2D grid).
  floorHeight(wx, wz) {
    return floorHeightAt(this.seed, wx, wz);
  }

  // Water for movement gating: true inside a river's gameplay band.
  isWater(wx, wz) {
    return riverAt(this.seed, wx, wz) >= CONFIG.world.water.gameplayBand;
  }

  get loadedCount() {
    return this.chunks.size;
  }

  // Load radius config.world.loadRadius around (wx,wz); dispose beyond
  // disposeRadius (= loadRadius + 1 hysteresis band).
  // AMORTIZED (optimization pass): the player's own ring (Chebyshev ≤ 1)
  // loads synchronously — collision correctness — but the outer ring goes
  // through a queue draining ONE chunk per call, so crossing a border never
  // builds five chunks in a single frame (that was the stutter).
  ensureAround(wx, wz) {
    const S = N * CONFIG.world.cellSize;
    const ccx = Math.floor(wx / S);
    const ccz = Math.floor(wz / S);
    const r = CONFIG.world.loadRadius;
    this.loadQueue ??= [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = ccx + dx;
        const cz = ccz + dz;
        if (this.chunks.has(this.key(cx, cz))) continue;
        if (Math.max(Math.abs(dx), Math.abs(dz)) <= 1) this.load(cx, cz);
        else if (!this.loadQueue.some((q) => q.cx === cx && q.cz === cz)) this.loadQueue.push({ cx, cz });
      }
    }
    // drain one queued chunk per call, nearest first, dropping stale entries
    this.loadQueue = this.loadQueue.filter(
      (q) => Math.max(Math.abs(q.cx - ccx), Math.abs(q.cz - ccz)) <= r && !this.chunks.has(this.key(q.cx, q.cz))
    );
    if (this.loadQueue.length) {
      this.loadQueue.sort(
        (a, b) =>
          Math.max(Math.abs(a.cx - ccx), Math.abs(a.cz - ccz)) - Math.max(Math.abs(b.cx - ccx), Math.abs(b.cz - ccz))
      );
      const next = this.loadQueue.shift();
      this.load(next.cx, next.cz);
    }
    for (const rec of [...this.chunks.values()]) {
      const d = Math.max(Math.abs(rec.cx - ccx), Math.abs(rec.cz - ccz));
      if (d > CONFIG.world.disposeRadius) this.unload(rec);
    }
  }

  load(cx, cz) {
    const key = this.key(cx, cz);
    if (this.chunks.has(key)) return;
    const rec = this.recordPool.acquire(cx, cz);
    rec.grid = carveChunk(this.seed, cx, cz);
    rec.wall = this.buildWall(rec);
    rec.ground = this.buildGround(rec);
    rec.water = this.buildWater(rec);
    rec.decor = this.buildDecor(rec);
    if (this.debugBorders) rec.border = this.buildBorder(rec);
    if (this.debugCells) rec.overlay = this.buildOverlay(rec);
    this.chunks.set(key, rec);
    populateChunk(rec, this.seed); // fills rec.foods / rec.enemies (data only)
  }

  unload(rec) {
    rec.wall?.dispose(false, true); // walls own a cloned material — free it too
    rec.ground?.dispose();
    rec.water?.dispose();
    rec.decor?.forEach((m) => m.dispose());
    rec.border?.dispose();
    rec.overlay?.dispose();
    // release any mounted food/enemy visuals living in this chunk
    rec.foods?.forEach((f) => f.handle?.dispose());
    rec.enemies?.forEach((e) => e.handle?.dispose());
    rec.foods = null;
    rec.enemies = null;
    this.fades.delete(this.key(rec.cx, rec.cz));
    this.chunks.delete(this.key(rec.cx, rec.cz));
    this.recordPool.release(rec);
  }

  // ── Camera occlusion (MD-04b §5) ──────────────────────────────────────────
  // Walk the camera→player segment across the collision cell grid; any wall
  // cell whose height crosses the segment's Y marks its chunk as occluding.
  // Occluding chunks fade their merged wall mesh to fadeAlpha and restore
  // when clear. Known tradeoff (accepted): merged meshes fade the WHOLE
  // chunk's walls, not just the one wall in the way.
  updateOcclusion(camPos, playerPos, dt) {
    const O = CONFIG.occlusion;
    const cell = CONFIG.world.cellSize;
    const wallH = CONFIG.world.wallHeight;
    const dx = playerPos.x - camPos.x;
    const dy = playerPos.y - camPos.y;
    const dz = playerPos.z - camPos.z;
    const len = Math.hypot(dx, dz);
    const occluders = new Set();
    if (len > 1e-3) {
      const steps = Math.ceil(len / O.sampleStep);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const y = camPos.y + dy * t;
        if (y > wallH) continue; // segment still above wall tops
        const wx = camPos.x + dx * t;
        const wz = camPos.z + dz * t;
        if (this.isWall(wx, wz)) {
          occluders.add(this.key(Math.floor(wx / (N * cell)), Math.floor(wz / (N * cell))));
        }
      }
    }
    // advance fades: down in fadeInSec, back up in fadeOutSec
    for (const [key, rec] of this.chunks) {
      const occ = occluders.has(key);
      let a = this.fades.get(key) ?? 1;
      const target = occ ? O.fadeAlpha : 1;
      if (a !== target) {
        const rate = occ ? (1 - O.fadeAlpha) / O.fadeInSec : (1 - O.fadeAlpha) / O.fadeOutSec;
        a = occ ? Math.max(target, a - rate * dt) : Math.min(target, a + rate * dt);
      }
      if (a === 1) {
        if (this.fades.has(key)) {
          this.fades.delete(key);
          if (rec.wall) {
            rec.wall.material.alpha = 1;
            rec.wall.material.needDepthPrePass = false;
          }
        }
      } else {
        this.fades.set(key, a);
        if (rec.wall) {
          rec.wall.material.alpha = a;
          // depth pre-pass keeps faded walls from showing their own backfaces
          // and other see-through artifacts
          rec.wall.material.needDepthPrePass = true;
        }
      }
    }
  }

  // HEX WALLS v3 (optimization pass): DIRECT geometry — no temporary meshes,
  // no MergeMeshes, no flat-shade conversion pass. Flat-faceted prisms are
  // written straight into vertex arrays (6 side quads + top fan each; no
  // bottom cap — never visible). BURIED cells (no open 4-neighbour) are
  // skipped entirely: they can never be seen. Same look, ~10× cheaper to
  // build, roughly half the vertices.
  buildWall(rec) {
    const cell = CONFIG.world.cellSize;
    const S = N * cell;
    const HX = CONFIG.world.hexWall;
    const jitter = rngFor(this.seed, 'walljitter', rec.cx, rec.cz);
    const D = CONFIG.decor;
    const grid = rec.grid;
    const isOpen = (i, j) => i < 0 || i >= N || j < 0 || j >= N || grid[j * N + i] === 0;
    const positions = [];
    const indices = [];
    const normals = [];
    const colors = [];
    const cxArr = new Array(6);
    const czArr = new Array(6);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        if (grid[j * N + i] !== 1) continue;
        // draw jitter for EVERY wall cell (deterministic pattern independent
        // of the visibility cull below)
        const h = HX.heightMin + jitter() * (HX.heightMax - HX.heightMin);
        const dia = cell * (HX.diaMin + jitter() * (HX.diaMax - HX.diaMin));
        const rot = jitter() * Math.PI / 3; // hex has 60° symmetry
        const shade = 1 - D.wallShadeJitter / 2 + jitter() * D.wallShadeJitter;
        if (!isOpen(i - 1, j) && !isOpen(i + 1, j) && !isOpen(i, j - 1) && !isOpen(i, j + 1)) continue; // buried
        const wx = rec.cx * S + (i + 0.5) * cell;
        const wz = rec.cz * S + (j + 0.5) * cell;
        const base = floorHeightAt(this.seed, wx, wz);
        const top = base + h;
        const col = wallColorAt(Math.hypot(wx, wz)).scale(shade);
        const rad = dia / 2;
        for (let k = 0; k < 6; k++) {
          const a = rot + (k * Math.PI) / 3;
          cxArr[k] = wx + Math.cos(a) * rad;
          czArr[k] = wz + Math.sin(a) * rad;
        }
        for (let k = 0; k < 6; k++) {
          const k2 = (k + 1) % 6;
          const ax = cxArr[k], az = czArr[k], bx = cxArr[k2], bz = czArr[k2];
          let nx = bz - az, nz = ax - bx;
          const nl = Math.hypot(nx, nz);
          nx /= nl; nz /= nl;
          if (nx * ((ax + bx) / 2 - wx) + nz * ((az + bz) / 2 - wz) < 0) { nx = -nx; nz = -nz; }
          const vi = positions.length / 3;
          positions.push(ax, base, az, bx, base, bz, bx, top, bz, ax, top, az);
          for (let q = 0; q < 4; q++) {
            normals.push(nx, 0, nz);
            colors.push(col.r, col.g, col.b, 1);
          }
          indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3); // CCW-out — Babylon front face
        }
        const ti = positions.length / 3;
        for (let k = 0; k < 6; k++) {
          positions.push(cxArr[k], top, czArr[k]);
          normals.push(0, 1, 0);
          colors.push(col.r, col.g, col.b, 1);
        }
        for (let k = 1; k < 5; k++) indices.push(ti, ti + k, ti + k + 1); // top fan faces UP (sides needed the flip; tops did not)
      }
    }
    if (positions.length === 0) return null;
    const wall = new BABYLON.Mesh(`wall_${rec.cx}_${rec.cz}`, this.scene);
    const vd = new BABYLON.VertexData();
    vd.positions = new Float32Array(positions);
    vd.indices = indices;
    vd.normals = new Float32Array(normals);
    vd.colors = new Float32Array(colors);
    vd.applyToMesh(wall);
    wall.name = `wall_${rec.cx}_${rec.cz}`;
    // Per-chunk material clone so occlusion can fade one chunk's walls
    // independently (MD-04b). Disposed with the mesh in unload().
    wall.material = this.wallMat.clone(`wallMat_${rec.cx}_${rec.cz}`);
    wall.isPickable = false;
    wall.freezeWorldMatrix();
    return wall;
  }

  // Triangulated terrain floor: subdivided ground displaced by world-space
  // noise (seamless across chunks), recomputed normals for real light
  // shading, vertex-darkened dips for depth. Heights ≤ 0 — the cave floor
  // rolls away beneath the hovering entities, never through them.
  buildGround(rec) {
    const S = N * CONFIG.world.cellSize;
    const F = CONFIG.world.floor;
    const g = BABYLON.MeshBuilder.CreateGround(
      `ground_${rec.cx}_${rec.cz}`,
      { width: S, height: S, subdivisions: F.subdivisions, updatable: true },
      this.scene
    );
    g.position.set(rec.cx * S + S / 2, 0, rec.cz * S + S / 2);
    const pos = g.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const colors = new Float32Array((pos.length / 3) * 4);
    for (let v = 0; v < pos.length; v += 3) {
      const h = floorHeightAt(this.seed, pos[v] + g.position.x, pos[v + 2] + g.position.z);
      pos[v + 1] = h;
      const shade = Math.min(1.25, Math.max(0.25, 1 + h * F.shadeDepth)); // dips darker, rises brighter
      const fc = floorColorAt(Math.hypot(pos[v] + g.position.x, pos[v + 2] + g.position.z));
      const c = (v / 3) * 4;
      colors[c] = fc.r * shade * 1.6;
      colors[c + 1] = fc.g * shade * 1.6;
      colors[c + 2] = fc.b * shade * 1.6;
      colors[c + 3] = 1;
    }
    g.updateVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
    g.setVerticesData(BABYLON.VertexBuffer.ColorKind, colors);
    const normals = [];
    BABYLON.VertexData.ComputeNormals(pos, g.getIndices(), normals);
    g.setVerticesData(BABYLON.VertexBuffer.NormalKind, normals); // update() no-ops on this buffer
    g.material = this.floorMat ??= (() => {
      const m = new BABYLON.StandardMaterial('floorMat', this.scene);
      m.diffuseColor = BABYLON.Color3.White(); // × blended vertex color
      m.specularColor = BABYLON.Color3.Black();
      m.emissiveColor = new BABYLON.Color3(0.05, 0.065, 0.06); // faint lift in the dark
      return m;
    })();
    g.isPickable = false;
    g.freezeWorldMatrix();
    return g;
  }

  // Decor v2: boulder clusters + grass tufts (lit group) and mushroom
  // clusters + crystals (glow group) — still merged into TWO meshes per chunk.
  // No collision; pure atmosphere.
  buildDecor(rec) {
    const cell = CONFIG.world.cellSize;
    const S = N * cell;
    const rng = rngFor(this.seed, 'decor', rec.cx, rec.cz);
    const D = CONFIG.decor;
    const biome = biomeAt(Math.hypot((rec.cx + 0.5) * S, (rec.cz + 0.5) * S));
    const open = [];
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) if (rec.grid[j * N + i] === 0) open.push([i, j]);
    if (open.length === 0) return [];
    const spot = () => {
      const [i, j] = open[Math.floor(rng() * open.length)];
      return [rec.cx * S + (i + 0.5) * cell, rec.cz * S + (j + 0.5) * cell];
    };
    const between = ([a, b]) => a + Math.floor(rng() * (b - a + 1));
    const accent = BABYLON.Color3.FromHexString(biome.wallColor);
    const solids = []; // lit only
    const glows = []; // biome-accent emissive material

    // Rocks: proper GREY, tinted toward the zone, with WILD size variance —
    // 60% small flat stones, 40% big boulders you notice from across a cavern.
    for (let k = between(D.rocksPerChunk); k > 0; k--) {
      const [x, z] = spot();
      const n = 1 + Math.floor(rng() * 3);
      for (let b = 0; b < n; b++) {
        const boulder = rng() < 0.4;
        const sc = boulder ? 0.5 + rng() * 0.75 : 0.1 + rng() * 0.2;
        const flat = boulder ? 0.55 + rng() * 0.35 : 0.2 + rng() * 0.15;
        const rock = BABYLON.MeshBuilder.CreateSphere('rock', { diameter: 1, segments: 3 }, this.scene);
        rock.scaling.set(sc * (1 + rng() * 0.9), sc * flat, sc * (1 + rng() * 0.9));
        const rx = x + (rng() - 0.5) * 1.1;
        const rz = z + (rng() - 0.5) * 1.1;
        rock.position.set(rx, sc * flat * 0.4 + floorHeightAt(this.seed, rx, rz), rz);
        rock.rotation.set((rng() - 0.5) * 0.3, rng() * Math.PI * 2, (rng() - 0.5) * 0.3);
        paint(rock, BABYLON.Color3.Lerp(BABYLON.Color3.FromHexString('#8A8F98'), accent, 0.25).scale(0.85 + rng() * 0.5));
        solids.push(rock);
      }
    }

    // Grass tufts v2 (optimization pass): DIRECT geometry — each blade is a
    // pair of crossed triangles written straight into arrays (6 verts) rather
    // than an 18-vert cylinder mesh that gets created, merged and disposed.
    // Same fat-blade look, ~10× cheaper to build, ~1/3 the vertices.
    const gPos = [], gIdx = [], gNrm = [], gCol = [];
    for (let k = between(D.grassTuftsPerChunk); k > 0; k--) {
      const [x, z] = spot();
      const blades = 5 + Math.floor(rng() * 4);
      for (let b = 0; b < blades; b++) {
        const h = 0.35 + rng() * 0.55;
        const bx = x + (rng() - 0.5) * 0.5;
        const bz = z + (rng() - 0.5) * 0.5;
        const fh = floorHeightAt(this.seed, bx, bz);
        const rot = rng() * Math.PI;
        const leanX = (rng() - 0.5) * 0.5;
        const leanZ = (rng() - 0.5) * 0.5;
        const c = accent.scale(0.9 + rng() * 0.7);
        const w = 0.17;
        for (const cross of [0, Math.PI / 2]) {
          const dx = Math.cos(rot + cross) * w * 0.5;
          const dz = Math.sin(rot + cross) * w * 0.5;
          const vi = gPos.length / 3;
          gPos.push(bx - dx, fh, bz - dz, bx + dx, fh, bz + dz, bx + leanX, fh + h, bz + leanZ);
          for (let q = 0; q < 3; q++) {
            gNrm.push(0, 1, 0); // up-lit; vertex color carries the hue
            gCol.push(c.r, c.g, c.b, 1);
          }
          gIdx.push(vi, vi + 2, vi + 1, vi, vi + 1, vi + 2); // both windings — visible from all sides
        }
      }
    }
    let grassMesh = null;
    if (gPos.length) {
      grassMesh = new BABYLON.Mesh(`grass_${rec.cx}_${rec.cz}`, this.scene);
      const gvd = new BABYLON.VertexData();
      gvd.positions = new Float32Array(gPos);
      gvd.indices = gIdx;
      gvd.normals = new Float32Array(gNrm);
      gvd.colors = new Float32Array(gCol);
      gvd.applyToMesh(grassMesh);
      grassMesh.material = this.rockMat ??= (() => {
        const m = new BABYLON.StandardMaterial('rockMat', this.scene);
        m.diffuseColor = BABYLON.Color3.White();
        m.specularColor = BABYLON.Color3.Black();
          return m;
      })();
      grassMesh.isPickable = false;
      grassMesh.freezeWorldMatrix();
    }

    // Mushroom clusters: 1–3 shrooms — tapered stalk, squashed cap, glow tip
    for (let k = between(D.mushroomClustersPerChunk); k > 0; k--) {
      const [x, z] = spot();
      const n = 1 + Math.floor(rng() * 3);
      for (let s = 0; s < n; s++) {
        const h = 0.3 + rng() * 0.55;
        const mx = x + (rng() - 0.5) * 0.8;
        const mz = z + (rng() - 0.5) * 0.8;
        const stalk = BABYLON.MeshBuilder.CreateCylinder('stalk', { diameterTop: h * 0.16, diameterBottom: h * 0.3, height: h, tessellation: 5 }, this.scene);
        const fh = floorHeightAt(this.seed, mx, mz);
        stalk.position.set(mx, h / 2 + fh, mz);
        stalk.rotation.set((rng() - 0.5) * 0.25, 0, (rng() - 0.5) * 0.25);
        paint(stalk, BABYLON.Color3.FromHexString('#B8C4C0').scale(0.35 + rng() * 0.2));
        const cap = BABYLON.MeshBuilder.CreateSphere('cap', { diameter: h * (0.7 + rng() * 0.5), segments: 5 }, this.scene);
        cap.scaling.y = 0.45 + rng() * 0.15;
        cap.position.set(mx, h * 1.02 + fh, mz);
        paint(cap, BABYLON.Color3.FromHexString(rng() < 0.5 ? biome.accentColor : biome.accentColor2).scale(0.9 + rng() * 0.6));
        glows.push(stalk, cap);
        if (rng() < 0.5) {
          const tip = BABYLON.MeshBuilder.CreateSphere('tip', { diameter: h * 0.14, segments: 4 }, this.scene);
          tip.position.set(mx, h * 1.15 + fh, mz);
          paint(tip, BABYLON.Color3.FromHexString(biome.accentColor));
          glows.push(tip);
        }
      }
    }

    // Crystals: tilted shards, rarer in the Fungal ring
    const crystalChance = biome.key === 'fungal' ? 0.35 : 1;
    for (let k = between(D.crystalSpotsPerChunk); k > 0; k--) {
      if (rng() > crystalChance) continue;
      const [x, z] = spot();
      const n = 1 + Math.floor(rng() * 2);
      for (let c = 0; c < n; c++) {
        const h = 0.35 + rng() * 0.6;
        const shard = BABYLON.MeshBuilder.CreateBox('shard', { width: h * 0.22, height: h, depth: h * 0.22 }, this.scene);
        const cx2 = x + (rng() - 0.5) * 0.6;
        const cz2 = z + (rng() - 0.5) * 0.6;
        shard.position.set(cx2, h * 0.38 + floorHeightAt(this.seed, cx2, cz2), cz2);
        shard.rotation.set((rng() - 0.5) * 0.5, rng() * Math.PI, (rng() - 0.5) * 0.5);
        paint(shard, BABYLON.Color3.FromHexString(biome.accentColor2).scale(1.1 + rng() * 0.6));
        glows.push(shard);
      }
    }

    const meshes = [];
    if (solids.length) {
      const merged = BABYLON.Mesh.MergeMeshes(solids, true, true, undefined, false, false);
      merged.name = `rocks_${rec.cx}_${rec.cz}`;
      merged.material = this.rockMat ??= (() => {
        const m = new BABYLON.StandardMaterial('rockMat', this.scene);
        m.diffuseColor = BABYLON.Color3.White();
        m.specularColor = BABYLON.Color3.Black();
          return m;
      })();
      merged.isPickable = false;
      merged.freezeWorldMatrix();
      meshes.push(merged);
    }
    if (glows.length) {
      const merged = BABYLON.Mesh.MergeMeshes(glows, true, true, undefined, false, false);
      merged.name = `plants_${rec.cx}_${rec.cz}`;
      merged.material = this.plantMatFor(biome);
      merged.isPickable = false;
      merged.freezeWorldMatrix();
      meshes.push(merged);
    }
    if (grassMesh) meshes.push(grassMesh);
    return meshes;
  }

  // Water surface v2: one subdivided sheet per river-bearing chunk with
  // PER-VERTEX ALPHA following the river band — edges fade out along the
  // channel's actual curve. No per-cell quads, no hard 90° corners.
  buildWater(rec) {
    const cell = CONFIG.world.cellSize;
    const S = N * cell;
    const W = CONFIG.world.water;
    let any = false;
    for (let j = 0; j < N && !any; j += 2)
      for (let i = 0; i < N && !any; i += 2) {
        if (riverAt(this.seed, rec.cx * S + (i + 0.5) * cell, rec.cz * S + (j + 0.5) * cell) > 0.05) any = true;
      }
    if (!any) return null;
    const water = BABYLON.MeshBuilder.CreateGround(
      `water_${rec.cx}_${rec.cz}`,
      { width: S, height: S, subdivisions: CONFIG.world.floor.subdivisions, updatable: true },
      this.scene
    );
    water.position.set(rec.cx * S + S / 2, 0, rec.cz * S + S / 2);
    const pos = water.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const colors = new Float32Array((pos.length / 3) * 4);
    for (let v = 0; v < pos.length; v += 3) {
      const wx = pos[v] + water.position.x;
      const wz = pos[v + 2] + water.position.z;
      const rv = riverAt(this.seed, wx, wz);
      // surface rides the terrain: just below the local bank line, above the
      // river-carved bed — rivers flow up and over the hills with the land
      pos[v + 1] = floorBaseAt(this.seed, wx, wz) - W.levelBelow;
      const a = Math.min(1, rv / W.gameplayBand); // smooth fade to the banks
      const wc = waterColorAt(Math.hypot(wx, wz)); // zone-blended hue
      const c = (v / 3) * 4;
      colors[c] = wc.r * 1.8;
      colors[c + 1] = wc.g * 1.8;
      colors[c + 2] = wc.b * 1.8;
      colors[c + 3] = a;
    }
    water.updateVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
    water.setVerticesData(BABYLON.VertexBuffer.ColorKind, colors);
    water.hasVertexAlpha = true;
    // Zone hue lives in the VERTEX colors now (blends smoothly across ring
    // borders); one shared material carries alpha + sheen.
    water.material = this.waterMat ??= (() => {
      const m = new BABYLON.StandardMaterial('waterMat', this.scene);
      m.diffuseColor = BABYLON.Color3.White();
      m.emissiveColor = new BABYLON.Color3(0.17, 0.2, 0.24); // strong self-glow — water must READ in the dark
      m.specularColor = new BABYLON.Color3(0.5, 0.55, 0.6);
      m.alpha = 0.62;
      m.needDepthPrePass = true; // no see-through artifacts on the surface
      return m;
    })();
    water.isPickable = false;
    water.freezeWorldMatrix();
    return water;
  }

  plantMatFor(biome) {
    this.plantMats ??= new Map();
    let mat = this.plantMats.get(biome.key);
    if (!mat) {
      mat = new BABYLON.StandardMaterial(`plantMat_${biome.key}`, this.scene);
      mat.diffuseColor = BABYLON.Color3.White();
      mat.specularColor = BABYLON.Color3.Black();
      // gentle self-glow so plants read in the dark (vertex colors carry hue)
      mat.emissiveColor = BABYLON.Color3.FromHexString(biome.wallColor).scale(0.45);
      this.plantMats.set(biome.key, mat);
    }
    return mat;
  }

  floorMatFor(biome) {
    let mat = this.floorMats.get(biome.key);
    if (!mat) {
      mat = new BABYLON.StandardMaterial(`floor_${biome.key}`, this.scene);
      const c = BABYLON.Color3.FromHexString(biome.floorColor);
      mat.diffuseColor = c;
      mat.emissiveColor = c.scale(0.35); // readable in the dark cave
      mat.specularColor = BABYLON.Color3.Black();
      this.floorMats.set(biome.key, mat);
    }
    return mat;
  }

  // ── Collision API (players/enemies later; circle vs cell grid, no physics) ─
  isWall(wx, wz) {
    const cell = CONFIG.world.cellSize;
    return this.isWallCell(Math.floor(wx / cell), Math.floor(wz / cell));
  }

  isWallCell(wcx, wcz) {
    const cx = Math.floor(wcx / N);
    const cz = Math.floor(wcz / N);
    const rec = this.chunks.get(this.key(cx, cz));
    if (!rec) return true; // unloaded space is solid
    return rec.grid[(wcz - cz * N) * N + (wcx - cx * N)] === 1;
  }

  circleHitsWall(x, z, r) {
    const cell = CONFIG.world.cellSize;
    const minX = Math.floor((x - r) / cell);
    const maxX = Math.floor((x + r) / cell);
    const minZ = Math.floor((z - r) / cell);
    const maxZ = Math.floor((z + r) / cell);
    for (let wcz = minZ; wcz <= maxZ; wcz++) {
      for (let wcx = minX; wcx <= maxX; wcx++) {
        if (!this.isWallCell(wcx, wcz)) continue;
        const px = Math.max(wcx * cell, Math.min(x, (wcx + 1) * cell));
        const pz = Math.max(wcz * cell, Math.min(z, (wcz + 1) * cell));
        if ((x - px) * (x - px) + (z - pz) * (z - pz) < r * r) return true;
      }
    }
    return false;
  }

  // Axis-separated slide: blocked axes are cancelled, the other axis keeps
  // moving, so movement slides along walls. The displacement is substepped to
  // below half a cell so large moves can't tunnel through walls.
  circleSlide(x, z, r, dx, dz) {
    const maxStep = Math.min(r, CONFIG.world.cellSize) * 0.5;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / maxStep));
    const sx = dx / steps;
    const sz = dz / steps;
    let px = x;
    let pz = z;
    let hitNormal = null;
    for (let s = 0; s < steps; s++) {
      let moved = false;
      let nx = px + sx;
      if (sx !== 0) {
        if (this.circleHitsWall(nx, pz, r)) {
          nx = px;
          hitNormal = { x: -Math.sign(sx), z: hitNormal ? hitNormal.z : 0 };
        } else moved = true;
      }
      let nz = pz + sz;
      if (sz !== 0) {
        if (this.circleHitsWall(nx, nz, r)) {
          nz = pz;
          hitNormal = { x: hitNormal ? hitNormal.x : 0, z: -Math.sign(sz) };
        } else moved = true;
      }
      px = nx;
      pz = nz;
      if (!moved) break; // fully blocked — further substeps are identical
    }
    return { x: px, z: pz, hitNormal };
  }

  // ── Debug visuals (?debug=1) ──────────────────────────────────────────────
  setDebugBorders(on) {
    if (on === this.debugBorders) return;
    this.debugBorders = on;
    for (const rec of this.chunks.values()) {
      if (on && !rec.border) rec.border = this.buildBorder(rec);
      else if (!on && rec.border) {
        rec.border.dispose();
        rec.border = null;
      }
    }
  }

  setDebugCells(on) {
    if (on === this.debugCells) return;
    this.debugCells = on;
    for (const rec of this.chunks.values()) {
      if (on && !rec.overlay) rec.overlay = this.buildOverlay(rec);
      else if (!on && rec.overlay) {
        rec.overlay.dispose();
        rec.overlay = null;
      }
    }
  }

  buildBorder(rec) {
    const S = N * CONFIG.world.cellSize;
    const x0 = rec.cx * S;
    const z0 = rec.cz * S;
    const y = 0.05;
    const pts = [
      new BABYLON.Vector3(x0, y, z0),
      new BABYLON.Vector3(x0 + S, y, z0),
      new BABYLON.Vector3(x0 + S, y, z0 + S),
      new BABYLON.Vector3(x0, y, z0 + S),
      new BABYLON.Vector3(x0, y, z0),
    ];
    const lines = BABYLON.MeshBuilder.CreateLines(`border_${rec.cx}_${rec.cz}`, { points: pts }, this.scene);
    lines.color = BABYLON.Color3.FromHexString('#C8E84A');
    lines.isPickable = false;
    return lines;
  }

  // Red slabs on top of wall cells (toggle C) — merged into one mesh per chunk.
  buildOverlay(rec) {
    const cell = CONFIG.world.cellSize;
    const S = N * cell;
    const y = CONFIG.world.wallHeight + 0.02;
    const slabs = [];
    for (let j = 0; j < N; j++) {
      let i = 0;
      while (i < N) {
        if (rec.grid[j * N + i] !== 1) {
          i++;
          continue;
        }
        let i2 = i;
        while (i2 < N && rec.grid[j * N + i2] === 1) i2++;
        const len = i2 - i;
        const slab = BABYLON.MeshBuilder.CreateBox(
          'cellSlab',
          { width: len * cell, height: 0.02, depth: cell },
          this.scene
        );
        slab.position.set(rec.cx * S + (i + len / 2) * cell, y, rec.cz * S + (j + 0.5) * cell);
        slabs.push(slab);
        i = i2;
      }
    }
    if (slabs.length === 0) return null;
    const overlay = BABYLON.Mesh.MergeMeshes(slabs, true, true, undefined, false, false);
    overlay.name = `overlay_${rec.cx}_${rec.cz}`;
    if (!this.debugCellMat) {
      this.debugCellMat = new BABYLON.StandardMaterial('debugCellMat', this.scene);
      this.debugCellMat.emissiveColor = BABYLON.Color3.Red();
      this.debugCellMat.disableLighting = true;
    }
    overlay.material = this.debugCellMat;
    overlay.isPickable = false;
    overlay.freezeWorldMatrix();
    return overlay;
  }

  dispose() {
    for (const rec of [...this.chunks.values()]) this.unload(rec);
    this.wallMat.dispose();
    for (const mat of this.floorMats.values()) mat.dispose();
    this.floorMats.clear();
    this.rockMat?.dispose();
    if (this.plantMats) for (const mat of this.plantMats.values()) mat.dispose();
    this.debugCellMat?.dispose();
  }
}
