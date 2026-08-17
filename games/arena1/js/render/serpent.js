// render/serpent.js — MD 18. Draws serpents from the snapshot and nothing else:
// this module never touches damage or length, it reads them.
//
// Segment POSITIONS are not on the wire (see sim/sim.js). Each snapshot carries
// the serpent's static path parameters, so this rebuilds the body locally with
// the same closed form the sim uses — imported from sim/serpent.js rather than
// re-derived, because two copies of a sine chain would drift the moment either
// side was tuned.

import { headAt, segAt, segRadius, SEG_COUNT, HEAD_R } from '../sim/serpent.js';

export function createSerpentView({ scene, mat, V3 }) {
  const views = new Map();   // serpentId → { segs[], head, jaw, barrel }

  /* MD 21 item 3: turret bolts had NO renderer. They were firing, reaching the
     snapshot and landing damage the whole time — the only thing missing was
     anything drawing them, which is why they were invisible.
     Pooled by id like rockets, and deliberately loud: a bolt is meant to be
     dodged on sight, so it is emissive, bigger than its 0.35m hit radius, and
     wears a trailing streak so it reads as travelling rather than hanging. */
  const boltMat = new BABYLON.StandardMaterial('boltm', scene);
  boltMat.diffuseColor = BABYLON.Color3.FromHexString('#FF7A59');
  boltMat.emissiveColor = BABYLON.Color3.FromHexString('#FFB03D');
  boltMat.specularColor = BABYLON.Color3.Black();
  const bolts = new Map();   // boltId → mesh
  function boltMesh() {
    const m = BABYLON.MeshBuilder.CreateSphere('bolt', { diameter: 1.15, segments: 6 }, scene);
    m.material = boltMat; m.isPickable = false;
    const tail = BABYLON.MeshBuilder.CreateCylinder('boltTail',
      { height: 2.4, diameterTop: 0.05, diameterBottom: 0.75, tessellation: 6 }, scene);
    tail.material = boltMat; tail.isPickable = false; tail.parent = m;
    tail.rotation.x = Math.PI / 2; tail.position.z = -1.35;
    return m;
  }
  function syncBolts(list) {
    const live = new Set();
    for (const b of list || []) {
      live.add(b.id);
      let m = bolts.get(b.id);
      if (!m) { m = boltMesh(); bolts.set(b.id, m); }
      m.position.set(b.pos.x, b.pos.y, b.pos.z);
      // point it along travel so the streak trails behind
      const v = b.vel;
      if (v && (v.x || v.y || v.z)) {
        m.lookAt(new BABYLON.Vector3(b.pos.x + v.x, b.pos.y + v.y, b.pos.z + v.z));
      }
    }
    for (const [id, m] of bolts) {
      if (live.has(id)) continue;
      m.dispose(); bolts.delete(id);
    }
  }

  function build(id) {
    const bodyMat = mat('#3E7FC5');
    const headMat = mat('#FF3D81');
    const spikeMat = mat('#F2D6A2');
    const segs = [], spikes = [];
    for (let i = 0; i < SEG_COUNT; i++) {
      const r = segRadius(i);
      const m = BABYLON.MeshBuilder.CreateIcoSphere('serpSeg' + id + '_' + i,
        { radius: r, subdivisions: i === 0 ? 3 : 2 }, scene);
      m.convertToFlatShadedMesh();
      m.material = i === 0 ? headMat : bodyMat;
      m.isPickable = false;
      segs.push(m);

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

    const v = { segs, spikes, jaw, barrel };
    views.set(id, v);
    return v;
  }

  // `tick` is the snapshot's tick. MD 21 removed the armour bubbles with the
  // armour mechanic, so there is no longer any local animation state here.
  function sync(serpents, tick, boltList) {
    const live = new Set();
    for (const s of serpents || []) {
      live.add(s.id);
      const v = views.get(s.id) || build(s.id);
      for (let i = 0; i < SEG_COUNT; i++) {
        const on = i < s.len;
        v.segs[i].isVisible = on;
        if (!on) continue;
        const c = segAt(s.path, tick, i);
        v.segs[i].position.set(c.x, c.y, c.z);
        // Face the direction of travel: toward where this segment will be.
        const ahead = segAt(s.path, tick + 4, i);
        v.segs[i].lookAt(new BABYLON.Vector3(ahead.x, ahead.y, ahead.z));
      }
      // Turret aim, so a player can read where it is about to shoot.
      v.barrel.rotation.x = Math.PI / 2 + s.aimPitch;
      v.barrel.rotation.y = s.aimYaw - (v.segs[0].rotation.y || 0);
    }
    for (const [id, v] of views) {
      if (live.has(id)) continue;
      v.segs.forEach((m) => m.dispose());
      views.delete(id);
    }
    syncBolts(boltList);
  }

  return { sync };
}
