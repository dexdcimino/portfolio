// visuals/proc/enemies.js — procedural enemy placeholders, redesigned for
// READABILITY in the dark cave: brighter rim-lit bodies, and glowing eyes on
// every enemy that flip color with threat state — RED while it outclasses the
// player (predator), GREEN once it's prey (pose.threat, set by entities/enemy).
// Gulper/elderMaw reuse the mawling builder, darkened (rival mawlings).

import { buildMawlingProc, unlitMat, finishVisual } from './chomp.js';
import { biomeAt } from '../../data/biomes.js';

const EYE_RED = BABYLON.Color3.FromHexString('#FF3030');
const EYE_GREEN = BABYLON.Color3.FromHexString('#7ADE4A');

function sph(scene, root, d, hex, glow, x = 0, y = 0.35, z = 0) {
  const m = BABYLON.MeshBuilder.CreateSphere('p', { diameter: d, segments: 8 }, scene);
  m.material = unlitMat(scene, hex, glow);
  m.parent = root;
  m.position.set(x, y, z);
  return m;
}

function cone(scene, root, dBottom, h, hex, glow) {
  const m = BABYLON.MeshBuilder.CreateCylinder('c', { diameterTop: 0, diameterBottom: dBottom, height: h }, scene);
  m.material = unlitMat(scene, hex, glow);
  m.parent = root;
  return m;
}

// Two forward-facing glowing eyes sharing one material (threat color target).
function addEyes(scene, root, d, y, z, spread) {
  const mat = unlitMat(scene, '#FF3030', 1);
  for (const side of [-1, 1]) {
    const eye = BABYLON.MeshBuilder.CreateSphere('redeye', { diameter: d, segments: 6 }, scene);
    eye.material = mat;
    eye.parent = root;
    eye.position.set(side * spread, y, z);
  }
  return mat;
}

// Each builder returns the eye material (or null) for threat coloring.
const BUILDERS = {
  nibbler(scene, root) {
    sph(scene, root, 0.4, '#463A5C', 0.45, 0, 0.42, 0); // brighter violet body
    sph(scene, root, 0.16, '#6B3FA0', 0.7, 0, 0.62, -0.1); // glowing hump
    return { eyes: addEyes(scene, root, 0.13, 0.46, 0.19, 0.1) };
  },
  urchin(scene, root) {
    sph(scene, root, 0.55, '#4A3A62', 0.4, 0, 0.45, 0);
    for (let i = 0; i < 8; i++) {
      const spike = cone(scene, root, 0.11, 0.42, '#8A6BB0', 0.55); // pale ridge spikes pop
      const a = (i / 8) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 0.32, 0.45 + Math.sin(a) * 0.32, 0);
      spike.rotation.z = -a - Math.PI / 2;
    }
    return { eyes: addEyes(scene, root, 0.15, 0.48, 0.3, 0.13) };
  },
  spikeball(scene, root) {
    // DARK grey ball cluster, tinted toward the zone it grows in, with BIG
    // red spikes that FIRE outward (×0.18 → ×1.6) when something gets close.
    const bodies = [
      sph(scene, root, 0.55, '#4A4A4E', 0.1, 0, 0.4, 0),
      sph(scene, root, 0.3, '#3E3E42', 0.08, 0.28, 0.28, 0.12),
      sph(scene, root, 0.26, '#44444A', 0.08, -0.26, 0.3, -0.1),
      sph(scene, root, 0.22, '#38383C', 0.08, 0.05, 0.3, -0.28),
    ];
    const spikeMat = unlitMat(scene, '#D93A2B', 0.85);
    const holders = [];
    for (let i = 0; i < 12; i++) {
      const th = Math.acos(1 - 2 * ((i + 0.5) / 12));
      const ph = i * 2.399963; // golden-angle spiral: even sphere coverage
      const dir = new BABYLON.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th) * 0.7 + 0.3, Math.sin(th) * Math.sin(ph)).normalize();
      const holder = new BABYLON.TransformNode('spikeHolder', scene);
      holder.parent = root;
      holder.position = dir.scale(0.26).add(new BABYLON.Vector3(0, 0.4, 0));
      holder.rotationQuaternion = BABYLON.Quaternion.FromUnitVectorsToRef(BABYLON.Vector3.Up(), dir, new BABYLON.Quaternion());
      const spike = BABYLON.MeshBuilder.CreateCylinder('spike', { diameterTop: 0, diameterBottom: 0.2, height: 0.95, tessellation: 5 }, scene);
      spike.material = spikeMat;
      spike.parent = holder;
      spike.position.y = 0.475;
      holders.push(holder);
    }
    let cur = 0.18;
    let tinted = false;
    return {
      extra(pose) {
        if (!tinted && (root.position.x !== 0 || root.position.z !== 0)) {
          // camouflage: blend the grey body toward the local biome's rock
          tinted = true;
          const zone = BABYLON.Color3.FromHexString(biomeAt(Math.hypot(root.position.x, root.position.z)).wallColor);
          for (const b of bodies) {
            b.material.diffuseColor = BABYLON.Color3.Lerp(b.material.diffuseColor, zone, 0.45);
            b.material.emissiveColor = b.material.diffuseColor.scale(0.12);
          }
        }
        const target = pose.spike ? 1.6 : 0.18; // SHOOT out, way past the body
        cur += (target - cur) * (pose.spike ? 0.5 : 0.08); // snap out, creep back
        for (const h of holders) h.scaling.setAll(cur);
      },
    };
  },
  lancer(scene, root) {
    const body = cone(scene, root, 0.42, 1.25, '#D8CFC0', 0.35); // pale bone dart
    body.position.y = 0.55;
    body.rotation.x = Math.PI / 2; // points forward (+z)
    const tip = cone(scene, root, 0.16, 0.55, '#4A3A52', 0.3);
    tip.position.set(0, 0.55, 0.85);
    tip.rotation.x = Math.PI / 2;
    for (const side of [-1, 1]) { // stabilizer fins
      const fin = cone(scene, root, 0.1, 0.4, '#8A8074', 0.25);
      fin.position.set(side * 0.28, 0.55, -0.45);
      fin.rotation.z = side * 1.2;
    }
    return { eyes: addEyes(scene, root, 0.15, 0.72, 0.35, 0.14) };
  },
  voidShard(scene, root) {
    // OBSIDIAN: near-black violet shard cluster, one dim ember seam — fits
    // the cave palette instead of glowing bubblegum
    for (const [rotY, w, h] of [[0.4, 0.36, 1.0], [1.97, 0.26, 0.78], [0.9, 0.18, 0.55]]) {
      const blade = BABYLON.MeshBuilder.CreateBox('b', { width: w, height: h, depth: w * 0.45 }, scene);
      blade.material = unlitMat(scene, '#241335', 0.2);
      blade.parent = root;
      blade.position.set((rotY - 1) * 0.12, h * 0.5, (rotY - 1) * -0.08);
      blade.rotation.set(0.15, rotY, 0.12);
    }
    const seam = BABYLON.MeshBuilder.CreateBox('seam', { width: 0.07, height: 0.6, depth: 0.07 }, scene);
    seam.material = unlitMat(scene, '#FF5A3C', 0.55); // dim ember crack
    seam.parent = root;
    seam.position.set(0.05, 0.45, 0.1);
    seam.rotation.set(0.2, 0.6, 0.1);
    return { eyes: addEyes(scene, root, 0.16, 0.55, 0.26, 0.12) };
  },
};

function darkenedMawling(stage, scene, name) {
  const v = buildMawlingProc(stage, scene);
  v.root.name = name;
  let eyeMat = null;
  for (const mesh of v.root.getChildMeshes()) {
    if (!mesh.material) continue;
    if (mesh.name === 'eye') {
      eyeMat = mesh.material;
      continue;
    }
    if (mesh.name === 'throat') continue;
    mesh.material.diffuseColor = mesh.material.diffuseColor.scale(0.35);
    mesh.material.emissiveColor = mesh.material.emissiveColor.scale(0.4);
  }
  // Rival mawlings get the threat-eye treatment too (red = it hunts you)
  const orig = v.setPose;
  v.setPose = (pose) => {
    orig(pose);
    if (eyeMat) {
      const c = pose.threat === false ? EYE_GREEN : EYE_RED;
      eyeMat.emissiveColor = c;
      eyeMat.diffuseColor = c;
    }
  };
  return v;
}

export function buildEnemyProc(key, scene) {
  if (key === 'gulper') return darkenedMawling(4, scene, 'proc_enemy_gulper');
  if (key === 'elderMaw') return darkenedMawling(5, scene, 'proc_enemy_elderMaw');
  const build = BUILDERS[key];
  if (!build) throw new Error(`no proc enemy builder for '${key}'`);
  const root = new BABYLON.TransformNode(`proc_enemy_${key}`, scene);
  const built = build(scene, root) ?? {};
  return finishVisual(root, (pose) => {
    if (built.eyes) {
      // pose.threat: true = predator (red), false = prey (green)
      const c = pose.threat === false ? EYE_GREEN : EYE_RED;
      built.eyes.emissiveColor = c;
      built.eyes.diffuseColor = c;
    }
    built.extra?.(pose); // e.g. spikeball spike volley animation
  });
}
