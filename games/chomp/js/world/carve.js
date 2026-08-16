// world/carve.js — noise cave carve + connectivity (TECH.md "World gen").
// Pure + deterministic: carveChunk(seed, cx, cz) → Uint8Array(N*N), 0 = open,
// 1 = wall. Same seed ⇒ identical cave, no shared state.
//
// Connectivity design:
// - Value noise samples a WORLD-space lattice (rngFor per lattice point), so
//   the field is continuous across chunk borders.
// - Each shared edge gets one deterministic opening cell derived from the edge
//   key alone — both neighbouring chunks compute the same cell, so passages
//   always line up across borders.
// - Worm tunnels connect all four edge openings to a jittered central hub,
//   so every edge opening is reachable from every other within the chunk.
// - A flood fill from the openings turns unreachable noise pockets into wall:
//   every remaining open cell connects to all four edges ⇒ the infinite cave
//   is one connected network. No dead-end sealed caverns across borders.

import { CONFIG } from '../config.js';
import { rngFor } from '../core/rng.js';
import { biomeAt } from '../data/biomes.js';

const N = CONFIG.world.chunkSize;
const C = CONFIG.world.carve;

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function lattice(cache, seed, tag, gx, gz) {
  const k = `${tag}:${gx}:${gz}`;
  let v = cache.get(k);
  if (v === undefined) {
    v = rngFor(seed, 'vn', tag, gx, gz)();
    cache.set(k, v);
  }
  return v;
}

function valueNoise(cache, seed, tag, wx, wz, spacing) {
  const fx = wx / spacing;
  const fz = wz / spacing;
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const tx = smooth(fx - x0);
  const tz = smooth(fz - z0);
  const v00 = lattice(cache, seed, tag, x0, z0);
  const v10 = lattice(cache, seed, tag, x0 + 1, z0);
  const v01 = lattice(cache, seed, tag, x0, z0 + 1);
  const v11 = lattice(cache, seed, tag, x0 + 1, z0 + 1);
  return (v00 * (1 - tx) + v10 * tx) * (1 - tz) + (v01 * (1 - tx) + v11 * tx) * tz;
}

// Floor terrain height at a world position: world-space value noise, so
// adjacent chunks displace their shared border vertices identically —
// seamless. Heights RISE AND FALL around the walk plane ((noise−bias)×amp);
// entities ride this surface visually while gameplay stays on the 2D grid.
// Module cache is fine: one seed per page.
// Hot path (called every frame per entity): per-tag numeric-key caches — no
// string building, no GC churn. Same rng derivation ⇒ identical terrain.
const FCACHES = { fa: new Map(), fb: new Map(), rv: new Map() };
function fastNoise(seed, tag, wx, wz, spacing) {
  const cacheMap = FCACHES[tag];
  const fx = wx / spacing;
  const fz = wz / spacing;
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const tx = smooth(fx - x0);
  const tz = smooth(fz - z0);
  const val = (gx, gz) => {
    const k = gx * 131072 + gz;
    let v = cacheMap.get(k);
    if (v === undefined) {
      v = rngFor(seed, 'vn', tag, gx, gz)();
      cacheMap.set(k, v);
    }
    return v;
  };
  const v00 = val(x0, z0), v10 = val(x0 + 1, z0), v01 = val(x0, z0 + 1), v11 = val(x0 + 1, z0 + 1);
  return (v00 * (1 - tx) + v10 * tx) * (1 - tz) + (v01 * (1 - tx) + v11 * tx) * tz;
}

// River factor at a world position: 0 = dry, →1 at the channel centreline.
// Winding channels are the iso-band |noise − 0.5| < width of large-scale
// value noise — a classic cheap river trick.
export function riverAt(seed, wx, wz) {
  const W = CONFIG.world.water;
  const n = fastNoise(seed, 'rv', wx, wz, W.lattice);
  const d = Math.abs(n - 0.5);
  return d >= W.width ? 0 : 1 - d / W.width;
}

// Terrain height WITHOUT river carving — the "bank line". Water surfaces sit
// levelBelow beneath this, so rivers follow the terrain up and down hills.
export function floorBaseAt(seed, wx, wz) {
  const F = CONFIG.world.floor;
  const n =
    fastNoise(seed, 'fa', wx, wz, F.lattice) * (1 - F.weightB) +
    fastNoise(seed, 'fb', wx, wz, F.latticeB) * F.weightB;
  // value noise clusters near 0.5 — stretch it so peaks/valleys actually land
  const e = Math.min(1, Math.max(0, 0.5 + (n - 0.5) * F.contrast));
  return (e - F.bias) * F.amp;
}

export function floorHeightAt(seed, wx, wz) {
  // rivers press the terrain down into valleys beneath their surface
  return floorBaseAt(seed, wx, wz) - riverAt(seed, wx, wz) * CONFIG.world.water.depth;
}

// Opening cell index along a shared edge. Edge keys are shared by both
// neighbours: vertical edge between (cx-1,cz)|(cx,cz) is ('v',cx,cz);
// horizontal edge between (cx,cz-1)|(cx,cz) is ('h',cx,cz).
function edgeOpening(seed, orient, ex, ez) {
  const r = rngFor(seed, 'edge', orient, ex, ez)();
  return C.edgeMargin + Math.floor(r * (N - 2 * C.edgeMargin));
}

function carveDisc(grid, i, j, radius) {
  for (let dj = -radius; dj <= radius; dj++) {
    for (let di = -radius; di <= radius; di++) {
      if (di * di + dj * dj > radius * radius) continue;
      const x = i + di;
      const z = j + dj;
      if (x >= 0 && x < N && z >= 0 && z < N) grid[z * N + x] = 0;
    }
  }
}

const clampCell = (v) => Math.max(0, Math.min(N - 1, v));

// Wandering tunnel from (i,j) to (ti,tj). Jitter is disabled for the back
// half of the step budget so arrival is guaranteed — an unfinished worm would
// leave an edge opening cut off from the chunk's network.
function worm(grid, rng, i, j, ti, tj, radius = C.wormRadius) {
  const maxSteps = N * 8;
  for (let step = 0; step < maxSteps; step++) {
    carveDisc(grid, i, j, radius);
    if (i === ti && j === tj) return;
    const jitterAllowed = step < maxSteps / 2;
    if (jitterAllowed && rng() < C.wormJitter) {
      if (rng() < 0.5) i = clampCell(i + (rng() < 0.5 ? -1 : 1));
      else j = clampCell(j + (rng() < 0.5 ? -1 : 1));
    } else {
      const di = ti - i;
      const dj = tj - j;
      if (Math.abs(di) >= Math.abs(dj)) i += Math.sign(di);
      else j += Math.sign(dj);
    }
  }
  carveDisc(grid, ti, tj, radius);
}

export function carveChunk(seed, cx, cz) {
  const grid = new Uint8Array(N * N);
  const cache = new Map();
  const cell = CONFIG.world.cellSize;
  const S = N * cell;

  // 1) Noise carve, threshold from biome at chunk centre
  const centerDist = Math.hypot((cx + 0.5) * S, (cz + 0.5) * S);
  const threshold = biomeAt(centerDist).carveThreshold;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const wx = cx * S + (i + 0.5) * cell;
      const wz = cz * S + (j + 0.5) * cell;
      const n =
        valueNoise(cache, seed, 'a', wx, wz, C.latticeA) * (1 - C.octaveBWeight) +
        valueNoise(cache, seed, 'b', wx, wz, C.latticeB) * C.octaveBWeight;
      grid[j * N + i] = n < threshold ? 0 : 1;
    }
  }

  // 2) Worm tunnels: all four edge openings → jittered central hub
  const west = edgeOpening(seed, 'v', cx, cz);
  const east = edgeOpening(seed, 'v', cx + 1, cz);
  const north = edgeOpening(seed, 'h', cx, cz);
  const south = edgeOpening(seed, 'h', cx, cz + 1);
  // Tunnels WIDEN with distance so grown mawlings have room to move —
  // squeezing stays a thing, not a lifestyle (stage 4/5 feedback).
  const wormR = Math.min(C.wormRadiusMax, C.wormRadius + Math.floor(centerDist / C.wormWidenPer));
  const wr = rngFor(seed, 'worm', cx, cz);
  const hubI = clampCell(Math.floor(N / 2 + (wr() * 2 - 1) * C.centerJitter));
  const hubJ = clampCell(Math.floor(N / 2 + (wr() * 2 - 1) * C.centerJitter));
  worm(grid, wr, 0, west, hubI, hubJ, wormR);
  worm(grid, wr, N - 1, east, hubI, hubJ, wormR);
  worm(grid, wr, north, 0, hubI, hubJ, wormR);
  worm(grid, wr, south, N - 1, hubI, hubJ, wormR);

  // 3) Origin clearing: forced-open disc at world (0,0), wormed to the hub so
  //    the spawn area survives the flood fill
  const R = C.originClearRadius;
  let originCell = null;
  if (cx * S <= R && (cx + 1) * S >= -R && cz * S <= R && (cz + 1) * S >= -R) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const wx = cx * S + (i + 0.5) * cell;
        const wz = cz * S + (j + 0.5) * cell;
        if (wx * wx + wz * wz <= R * R) grid[j * N + i] = 0;
      }
    }
    const oi = clampCell(Math.round(-cx * N - 0.5));
    const oj = clampCell(Math.round(-cz * N - 0.5));
    originCell = [oi, oj];
    worm(grid, rngFor(seed, 'worm0', cx, cz), oi, oj, hubI, hubJ);
  }

  // 4) Force the edge openings open (idempotent with the worms)
  carveDisc(grid, 0, west, wormR);
  carveDisc(grid, N - 1, east, wormR);
  carveDisc(grid, north, 0, wormR);
  carveDisc(grid, south, N - 1, wormR);

  // 5) Flood fill from the openings; wall off unreachable pockets
  const seeds = [[0, west], [N - 1, east], [north, 0], [south, N - 1]];
  if (originCell) seeds.push(originCell);
  const reach = new Uint8Array(N * N);
  const queue = [];
  for (const [si, sj] of seeds) {
    const idx = sj * N + si;
    if (grid[idx] === 0 && !reach[idx]) {
      reach[idx] = 1;
      queue.push(idx);
    }
  }
  while (queue.length) {
    const idx = queue.pop();
    const i = idx % N;
    const j = (idx - i) / N;
    if (i > 0 && grid[idx - 1] === 0 && !reach[idx - 1]) { reach[idx - 1] = 1; queue.push(idx - 1); }
    if (i < N - 1 && grid[idx + 1] === 0 && !reach[idx + 1]) { reach[idx + 1] = 1; queue.push(idx + 1); }
    if (j > 0 && grid[idx - N] === 0 && !reach[idx - N]) { reach[idx - N] = 1; queue.push(idx - N); }
    if (j < N - 1 && grid[idx + N] === 0 && !reach[idx + N]) { reach[idx + N] = 1; queue.push(idx + N); }
  }
  for (let k = 0; k < N * N; k++) {
    if (grid[k] === 0 && !reach[k]) grid[k] = 1;
  }

  return grid;
}
