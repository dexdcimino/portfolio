// world/spawner.js — per-chunk food/enemy population, deterministic from
// rngFor(seed,'spawn',cx,cz). Pure data: fills rec.foods / rec.enemies;
// entities/food.js + entities/enemy.js handle activation and visuals.
// Pressure spawner (density scaling with stage/time) comes in a later MD.

import { CONFIG } from '../config.js';
import { rngFor } from '../core/rng.js';

const N = CONFIG.world.chunkSize;

function openCells(grid) {
  const cells = [];
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) if (grid[j * N + i] === 0) cells.push([i, j]);
  return cells;
}

export function populateChunk(rec, seed) {
  const rng = rngFor(seed, 'spawn', rec.cx, rec.cz);
  const cell = CONFIG.world.cellSize;
  const S = N * cell;
  const cells = openCells(rec.grid);
  rec.foods = [];
  rec.enemies = [];
  if (cells.length === 0) return;

  const world = ([i, j]) => [rec.cx * S + (i + 0.5) * cell, rec.cz * S + (j + 0.5) * cell];
  const pick = () => cells[Math.floor(rng() * cells.length)];
  const between = ([a, b]) => a + Math.floor(rng() * (b - a + 1));
  const centerDist = Math.hypot((rec.cx + 0.5) * S, (rec.cz + 0.5) * S);

  // A jittered position must stay on open floor — otherwise fall back to the
  // cluster centre (foods inside walls would be invisible and uneatable).
  const openAt = (x, z) => {
    const i = Math.floor(x / cell) - rec.cx * N;
    const j = Math.floor(z / cell) - rec.cz * N;
    return i >= 0 && i < N && j >= 0 && j < N && rec.grid[j * N + i] === 0;
  };

  // Glowmote clusters — bread & butter
  const clusters = between(CONFIG.spawn.glowClustersPerChunk);
  for (let c = 0; c < clusters; c++) {
    const [cx, cz] = world(pick());
    const count = between(CONFIG.spawn.clusterSize);
    for (let m = 0; m < count; m++) {
      let x = cx + (rng() * 2 - 1) * 1.2;
      let z = cz + (rng() * 2 - 1) * 1.2;
      if (!openAt(x, z)) {
        x = cx;
        z = cz;
      }
      rec.foods.push({ key: 'glowmote', x, z, phase: rng() * Math.PI * 2, taken: false, handle: null });
    }
  }

  // One premium food per chunk sometimes — richer beyond the Fungal ring
  if (rng() < CONFIG.spawn.premiumChance) {
    const key = centerDist > 80 ? (rng() < 0.5 ? 'emberClutch' : 'frostEgg') : 'marrowCrystal';
    const [x, z] = world(pick());
    rec.foods.push({ key, x, z, phase: rng() * Math.PI * 2, taken: false, handle: null });
  }

  // Enemies. minDist is checked PER SPAWN POSITION (a chunk whose centre is
  // past the safe radius can still have cells right next to spawn). Nibblers
  // are prey-sized and may live anywhere; predators keep their distance.
  const spawnEnemies = (key, range, minDist) => {
    const count = between(range);
    for (let u = 0; u < count; u++) {
      const [x, z] = world(pick());
      if (Math.hypot(x, z) < minDist) continue;
      rec.enemies.push({ key, x, z, phase: rng() * Math.PI * 2, dead: false, handle: null });
    }
  };
  // Spikeball plants: rooted hazards, size varies per instance
  {
    const count = between([1, 2]);
    for (let s = 0; s < count; s++) {
      const [x, z] = world(pick());
      if (Math.hypot(x, z) < CONFIG.spawn.safeRadius) continue; // NEVER near spawn
      rec.enemies.push({
        key: 'spikeball', x, z,
        radius: 0.35 + rng() * 0.55, // they vary in size
        phase: rng() * Math.PI * 2, dead: false, handle: null,
      });
    }
  }
  spawnEnemies('nibbler', CONFIG.spawn.nibblersPerChunk, 6);
  spawnEnemies('urchin', CONFIG.spawn.urchinsPerChunk, CONFIG.spawn.safeRadius);
  spawnEnemies('lancer', CONFIG.spawn.lancersPerChunk, Math.max(CONFIG.spawn.safeRadius, CONFIG.spawn.lancerRange));
  spawnEnemies('voidShard', CONFIG.spawn.voidShardsPerChunk, Math.max(CONFIG.spawn.safeRadius, CONFIG.spawn.voidShardRange));
  spawnEnemies('gulper', CONFIG.spawn.gulpersPerChunk, Math.max(CONFIG.spawn.safeRadius, CONFIG.spawn.gulperRange));
}
