// render/serpent.js — MD 18. Draws serpents from the snapshot and nothing else:
// this module never touches hp, armour or length, it reads them.
//
// Segment POSITIONS are not on the wire (see sim/sim.js). Each snapshot carries
// the serpent's static path parameters, so this rebuilds the body locally with
// the same closed form the sim uses — imported from sim/serpent.js rather than
// re-derived, because two copies of a sine chain would drift the moment either
// side was tuned.

import { headAt, segAt, segRadius, SEG_COUNT, HEAD_R } from '../sim/serpent.js';

export function createSerpentView({ scene, mat, V3 }) {
  const views = new Map();   // serpentId → { segs[], armour[], head, jaw, barrel }

  function build(id) {
    const bodyMat = mat('#3E7FC5');
    const headMat = mat('#FF3D81');
    const spikeMat = mat('#F2D6A2');
    const armMat = new BABYLON.StandardMaterial('serpArm' + id, scene);
    armMat.diffuseColor = BABYLON.Color3.FromHexString('#FFE7B0');
    armMat.emissiveColor = BABYLON.Color3.FromHexString('#FFE7B0').scale(0.5);
    armMat.alpha = 0.42;
    armMat.specularColor = BABYLON.Color3.Black();

    const segs = [], armour = [], spikes = [];
    for (let i = 0; i < SEG_COUNT; i++) {
      const r = segRadius(i);
      const m = BABYLON.MeshBuilder.CreateIcoSphere('serpSeg' + id + '_' + i,
        { radius: r, subdivisions: i === 0 ? 3 : 2 }, scene);
      m.convertToFlatShadedMesh();
      m.material = i === 0 ? headMat : bodyMat;
      m.isPickable = false;
      segs.push(m);

      // Armour bubble: a bigger translucent shell that scales up from nothing.
      const a = BABYLON.MeshBuilder.CreateIcoSphere('serpArm' + id + '_' + i,
        { radius: r + 0.45, subdivisions: 2 }, scene);
      a.material = armMat; a.isPickable = false; a.isVisible = false;
      a.scaling.setAll(0.01);
      armour.push(a);

      // Spikes on the BODY only — the head reads differently on purpose.
      if (i > 0) {
        const sp = BABYLON.MeshBuilder.CreateCylinder('serpSpk' + id + '_' + i,
          { height: r * 1.7, diameterTop: 0, diameterBottom: r * 0.62, tessellation: 4 }, scene);
        sp.material = spikeMat; sp.isPickable = false; sp.parent = m;
        sp.position = V3(0, r * 0.85, 0);
        spikes.push(sp);
      }
    }
    /* The head has to be identifiable at 30m, so it is not just a bigger
       sphere: a forward jaw wedge and a turret barrel give it a silhouette
       that reads as "front" from any angle. */
    const jaw = BABYLON.MeshBuilder.CreateCylinder('serpJaw' + id,
      { height: HEAD_R * 1.5, diameterTop: 0, diameterBottom: HEAD_R * 1.5, tessellation: 4 }, scene);
    jaw.material = headMat; jaw.isPickable = false; jaw.parent = segs[0];
    jaw.rotation.x = Math.PI / 2; jaw.position = V3(0, 0, HEAD_R * 0.85);
    const barrel = BABYLON.MeshBuilder.CreateCylinder('serpGun' + id,
      { height: HEAD_R * 1.8, diameter: HEAD_R * 0.34, tessellation: 8 }, scene);
    barrel.material = spikeMat; barrel.isPickable = false; barrel.parent = segs[0];
    barrel.rotation.x = Math.PI / 2; barrel.position = V3(0, HEAD_R * 0.5, HEAD_R * 0.7);

    const v = { segs, armour, spikes, jaw, barrel, seen: new Map() };
    views.set(id, v);
    return v;
  }

  // `tick` is the snapshot's tick; `nowMs` only drives the armour inflate,
  // which is pure decoration and never feeds back into anything.
  function sync(serpents, tick, nowMs) {
    const live = new Set();
    for (const s of serpents || []) {
      live.add(s.id);
      const v = views.get(s.id) || build(s.id);
      for (let i = 0; i < SEG_COUNT; i++) {
        const on = i < s.len;
        v.segs[i].isVisible = on;
        if (!on) { v.armour[i].isVisible = false; continue; }
        const c = segAt(s.path, tick, i);
        v.segs[i].position.set(c.x, c.y, c.z);
        // Face the direction of travel: toward where this segment will be.
        const ahead = segAt(s.path, tick + 4, i);
        v.segs[i].lookAt(new BABYLON.Vector3(ahead.x, ahead.y, ahead.z));

        // Armour: the BIT is authority, the inflate is local decoration.
        const shielded = (s.armour & (1 << i)) !== 0;
        const a = v.armour[i];
        if (shielded && !v.seen.has(i)) v.seen.set(i, nowMs);
        if (!shielded) v.seen.delete(i);
        a.isVisible = shielded;
        if (shielded) {
          const age = (nowMs - v.seen.get(i)) / 1000;
          // fast inflate, then a slow breathing pulse so it reads as "up"
          const grow = Math.min(1, age / 0.18);
          a.scaling.setAll(grow * (1 + Math.sin(nowMs / 120) * 0.05));
          a.position.copyFrom(v.segs[i].position);
        }
      }
      // Turret aim, so a player can read where it is about to shoot.
      v.barrel.rotation.x = Math.PI / 2 + s.aimPitch;
      v.barrel.rotation.y = s.aimYaw - (v.segs[0].rotation.y || 0);
    }
    for (const [id, v] of views) {
      if (live.has(id)) continue;
      v.segs.forEach((m) => m.dispose());
      v.armour.forEach((m) => m.dispose());
      views.delete(id);
    }
  }

  return { sync };
}
