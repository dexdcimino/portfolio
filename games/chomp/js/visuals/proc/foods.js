// visuals/proc/foods.js — recognizable procedural placeholders for every food
// key (GDD food table), ART_BIBLE palette, emissive glows. ≤40 lines each.

import { unlitMat, finishVisual } from './chomp.js';

function sph(scene, root, d, hex, glow, x = 0, y = 0.35, z = 0) {
  const m = BABYLON.MeshBuilder.CreateSphere('p', { diameter: d, segments: 8 }, scene);
  m.material = unlitMat(scene, hex, glow);
  m.parent = root;
  m.position.set(x, y, z);
  return m;
}

function box(scene, root, w, h, d, hex, glow, x = 0, y = 0.35, z = 0) {
  const m = BABYLON.MeshBuilder.CreateBox('p', { width: w, height: h, depth: d }, scene);
  m.material = unlitMat(scene, hex, glow);
  m.parent = root;
  m.position.set(x, y, z);
  return m;
}

const BUILDERS = {
  glowmote(scene, root) {
    sph(scene, root, 0.22, '#C8E84A', 1);
  },
  cagedOrb(scene, root) {
    sph(scene, root, 0.5, '#C8E84A', 0.9);
    for (let i = 0; i < 4; i++) {
      const bar = box(scene, root, 0.05, 0.7, 0.05, '#2A2230', 0.1);
      bar.rotation.z = (i * Math.PI) / 4;
    }
  },
  emberClutch(scene, root) {
    sph(scene, root, 0.3, '#FF7A30', 0.9, -0.14, 0.3, 0);
    sph(scene, root, 0.26, '#FF5A3C', 0.9, 0.14, 0.3, 0.06);
    sph(scene, root, 0.22, '#FFB03C', 1, 0, 0.48, -0.08);
  },
  frostEgg(scene, root) {
    sph(scene, root, 0.42, '#7FD4FF', 0.8).scaling.y = 1.45;
    sph(scene, root, 0.14, '#A8E8FF', 1, 0, 0.72, 0);
  },
  ghostSlime(scene, root) {
    const g = sph(scene, root, 0.5, '#A8E8FF', 0.7);
    g.material.alpha = 0.4;
    g.material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
  },
  marrowCrystal(scene, root) {
    const c = box(scene, root, 0.18, 0.55, 0.18, '#FFD23F', 0.9);
    c.rotation.set(0.3, 0.6, 0.2);
  },
  urchin(scene, root) {
    sph(scene, root, 0.42, '#2A2230', 0.15);
    for (let i = 0; i < 6; i++) {
      const spike = BABYLON.MeshBuilder.CreateCylinder('s', { diameterTop: 0, diameterBottom: 0.1, height: 0.35 }, scene);
      spike.material = unlitMat(scene, '#4A3A52', 0.3);
      spike.parent = root;
      const a = (i / 6) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 0.26, 0.35 + Math.sin(a) * 0.26, 0);
      spike.rotation.z = -a - Math.PI / 2;
    }
  },
  voidShard(scene, root) {
    const s = box(scene, root, 0.24, 0.7, 0.24, '#2A1840', 0.3); // obsidian, not pink
    s.rotation.set(0.2, 0.8, 0.35);
    sph(scene, root, 0.1, '#6B3FA0', 0.7, 0, 0.62, 0);
  },
  leechEye(scene, root) {
    sph(scene, root, 0.4, '#A8E8FF', 0.5);
    sph(scene, root, 0.16, '#C8E84A', 1, 0, 0.38, 0.14);
    const t = BABYLON.MeshBuilder.CreateCylinder('t', { diameterTop: 0.05, diameterBottom: 0.14, height: 0.4 }, scene);
    t.material = unlitMat(scene, '#6B3FA0', 0.4);
    t.parent = root;
    t.position.y = 0.08;
  },
};

export function buildFoodProc(key, scene) {
  const build = BUILDERS[key];
  if (!build) throw new Error(`no proc food builder for '${key}'`);
  const root = new BABYLON.TransformNode(`proc_food_${key}`, scene);
  build(scene, root);
  return finishVisual(root);
}
