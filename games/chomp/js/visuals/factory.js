// visuals/factory.js — resolves MANIFEST key → builds a visual (MD-03 §2).
// The ONLY path from logic to meshes. Every visual returns the same interface:
//   { root: TransformNode, setPose(morphState), dispose() }
// dispose() releases to a per-key pool (TECH.md: all visuals pooled);
// destroyPools() actually frees everything (teardown/tests).
// Resolution: manifest type → any failure → proc fallback → magenta debug
// sphere as last resort. The game NEVER breaks on assets.

import { CONFIG } from '../config.js';
import { MANIFEST } from './manifest.js';
import { buildMawlingProc, finishVisual, unlitMat } from './proc/chomp.js';
import { buildFoodProc } from './proc/foods.js';
import { buildEnemyProc } from './proc/enemies.js';
import { buildGlbVisual } from './loaders/glb.js';

export function createFactory(scene) {
  const pools = new Map(); // key → array of internal records {root, setPose, destroy}
  let live = 0;

  function buildProc(key) {
    const [prefix, sub] = key.split('.');
    if (prefix === 'player') return buildMawlingProc(Number(sub.slice(1)) || 1, scene);
    if (prefix === 'food') return buildFoodProc(sub, scene);
    if (prefix === 'enemy') return buildEnemyProc(sub, scene);
    throw new Error(`no proc builder for '${key}'`);
  }

  function buildDebugSphere(key) {
    const root = new BABYLON.TransformNode(`debug_${key}`, scene);
    const m = BABYLON.MeshBuilder.CreateSphere('unknownKey', { diameter: 1 }, scene);
    m.material = unlitMat(scene, '#FF00FF', 1);
    m.parent = root;
    m.position.y = 0.5;
    return finishVisual(root);
  }

  function build(key) {
    const entry = MANIFEST[key];
    if (!entry) {
      console.warn(`[visuals] unknown manifest key '${key}' — magenta debug sphere`);
      return buildDebugSphere(key);
    }
    try {
      if (entry.type === 'glb') return buildGlbVisual(key, entry, scene, () => buildProc(key));
      return buildProc(key);
    } catch (err) {
      console.warn(`[visuals] build failed for '${key}' — proc fallback:`, err?.message ?? err);
      try {
        return buildProc(key);
      } catch {
        return buildDebugSphere(key);
      }
    }
  }

  // Blob shadow: dark disc at the floor, factory-side so it exists under
  // sprite AND proc visuals alike (MD-04 §3). The posed visual root is
  // re-parented under a wrapper so setPose (stretch/bank/bob) never deforms
  // or lifts the shadow — the wrapper becomes the consumer-facing root.
  function addShadow(rec, radius) {
    const wrap = new BABYLON.TransformNode(rec.root.name + '_wrap', scene);
    rec.root.parent = wrap;
    const mat = new BABYLON.StandardMaterial('blobShadow', scene); // per-visual: safe to dispose
    mat.diffuseColor = BABYLON.Color3.Black();
    mat.specularColor = BABYLON.Color3.Black();
    mat.alpha = CONFIG.visuals.shadowAlpha;
    mat.disableLighting = true;
    const disc = BABYLON.MeshBuilder.CreateDisc('shadow', { radius: 1, tessellation: 24 }, scene);
    disc.rotation.x = Math.PI / 2;
    disc.position.y = 0.02;
    disc.material = mat;
    disc.isPickable = false;
    disc.parent = wrap;
    disc.scaling.setAll(radius);
    rec.shadow = disc;
    const innerDestroy = rec.destroy;
    rec.root = wrap;
    rec.destroy = () => {
      innerDestroy();
      wrap.dispose(false, true);
    };
  }

  // Accent changes rebuild the player, but dispose() RELEASES TO THE POOL and
  // mount() hands the same pooled record straight back — old colours and all.
  // Flushing just the player pools forces the next mount to build fresh with
  // the new palette; food/enemy pools are accent-independent and stay warm.
  function flushPlayerPools() {
    for (const [key, pool] of pools) {
      if (!key.startsWith('player.')) continue;
      for (const rec of pool) rec.destroy();
      pool.length = 0;
    }
  }

  function mount(key, opts = {}) {
    const poolKey = key + (opts.shadow ? '|sh' : '');
    const pool = pools.get(poolKey);
    let rec = pool?.length ? pool.pop() : null;
    if (!rec) {
      rec = build(key);
      if (opts.shadow) addShadow(rec, opts.shadow);
    } else if (rec.shadow && opts.shadow) {
      rec.shadow.scaling.setAll(opts.shadow);
    }
    rec.root.setEnabled(true);
    live++;
    let released = false;
    return {
      root: rec.root,
      setPose: (pose) => rec.setPose(pose),
      dispose() {
        if (released) return;
        released = true;
        live--;
        rec.root.setEnabled(false);
        rec.root.position.set(0, 0, 0);
        rec.root.rotation.set(0, 0, 0);
        rec.root.scaling.set(1, 1, 1);
        if (!pools.has(poolKey)) pools.set(poolKey, []);
        pools.get(poolKey).push(rec);
      },
    };
  }

  // Thin-instances path for glowmote-scale clusters (MD-03 §5). Always uses
  // PROC geometry: a billboarded plane can't be thin-instanced (the billboard
  // rotation would swing every instance around the mesh origin).
  function mountInstanced(key, positions) {
    let rec;
    try {
      rec = buildProc(key);
    } catch {
      rec = buildDebugSphere(key);
    }
    const buf = new Float32Array(positions.length * 16);
    positions.forEach((p, i) =>
      BABYLON.Matrix.Translation(p.x, p.y ?? 0, p.z).copyToArray(buf, i * 16)
    );
    for (const mesh of rec.root.getChildMeshes()) {
      mesh.thinInstanceSetBuffer('matrix', buf, 16, true); // static buffer
    }
    return {
      root: rec.root,
      count: positions.length,
      dispose() {
        rec.destroy();
      },
    };
  }

  function destroyPools() {
    for (const pool of pools.values()) for (const rec of pool) rec.destroy();
    pools.clear();
  }

  return {
    mount,
    flushPlayerPools,
    mountInstanced,
    destroyPools,
    stats: () => ({
      live,
      pooled: [...pools.values()].reduce((n, arr) => n + arr.length, 0),
    }),
  };
}
