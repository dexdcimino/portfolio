// visuals/loaders/glb.js — GLB loader with instant proc fallback (MD-03 §2).
// Mounts the proc placeholder first, then ImportMeshAsync hot-swaps the real
// model under the same root on success; on failure it console.warns and keeps
// the proc. Morph application order (ART_BIBLE): named morph targets
// (mouthOpen/stretch/squash) → bones (jaw/spine) → root-scale fallback.

import { CONFIG } from '../../config.js';
import { applyGenericPose } from '../proc/chomp.js';

const MORPH_NAMES = ['mouthOpen', 'stretch', 'squash'];

export function buildGlbVisual(key, entry, scene, buildProcFallback) {
  const proc = buildProcFallback();
  const root = proc.root;
  root.metadata = { glbActive: false };
  let impl = { setPose: proc.setPose };
  let destroyed = false;

  const slash = entry.src.lastIndexOf('/');
  const rootUrl = 'assets/' + entry.src.slice(0, slash + 1);
  const file = entry.src.slice(slash + 1);

  BABYLON.SceneLoader.ImportMeshAsync('', rootUrl, file, scene)
    .then(({ meshes, skeletons }) => {
      if (destroyed) {
        for (const m of meshes) m.dispose(false, true);
        return;
      }
      for (const child of [...root.getChildren()]) child.dispose(false, true); // drop proc
      for (const m of meshes) if (!m.parent) m.parent = root;
      impl = { setPose: makeGlbPose(root, meshes, skeletons) };
      root.metadata.glbActive = true;
    })
    .catch((err) => {
      console.warn(
        `[visuals] GLB '${entry.src}' failed for '${key}' — keeping proc fallback:`,
        err?.message ?? err
      );
    });

  return {
    root,
    setPose: (pose) => impl.setPose(pose),
    destroy() {
      destroyed = true;
      root.dispose(false, true);
    },
  };
}

function makeGlbPose(root, meshes, skeletons) {
  // 1) Named morph targets
  const targets = {};
  for (const mesh of meshes) {
    const mtm = mesh.morphTargetManager;
    if (!mtm) continue;
    for (let i = 0; i < mtm.numTargets; i++) {
      const t = mtm.getTarget(i);
      if (MORPH_NAMES.includes(t.name)) targets[t.name] = t;
    }
  }
  if (Object.keys(targets).length > 0) {
    return (pose) => {
      applyGenericPose(root, { facing: pose.facing, bob: pose.bob }); // no root squash — morphs own it
      if (targets.mouthOpen) targets.mouthOpen.influence = pose.mouthOpen ?? 0;
      if (targets.stretch) targets.stretch.influence = pose.stretch ?? 0;
      if (targets.squash) targets.squash.influence = pose.squash ?? 0;
    };
  }

  // 2) Named bones
  const skeleton = skeletons?.[0];
  const jaw = skeleton?.bones.find((b) => b.name === 'jaw');
  const spine = skeleton?.bones.find((b) => b.name === 'spine');
  if (jaw || spine) {
    const V = CONFIG.visuals;
    return (pose) => {
      applyGenericPose(root, { facing: pose.facing, bob: pose.bob });
      if (jaw) jaw.setRotation(new BABYLON.Vector3((pose.mouthOpen ?? 0) * V.jawOpenAngle, 0, 0), BABYLON.Space.LOCAL);
      if (spine) {
        const st = pose.stretch ?? 0;
        spine.setScale(new BABYLON.Vector3(1 - st * V.stretchShrink, 1 - st * V.stretchShrink, 1 + st * V.stretchGrow));
      }
    };
  }

  // 3) Root-scale fallback — even a static GLB still feels alive (TECH.md)
  return (pose) => applyGenericPose(root, pose);
}
