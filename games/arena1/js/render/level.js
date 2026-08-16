// render/level.js — the pretty level, built FROM level data (ARENA1_STEPS
// Phase 4): named arena boxes, ramps, CSG ring/dish platform visuals, LOD
// crystals (3 tiers + L debug tint), thin-instance pebbles, pads, rings,
// summit beacon. Platform mesh positions read platform state derived from
// tick (base + offset, active, collapse FSM) — a one-directional read of sim
// state; nothing here writes back.
//
// Mesh recipes are the prototype's (reference/prototype.html 284–535) with
// the dims coming from level.platforms[i].dims instead of fresh rng draws, so
// visuals land exactly on the collision approximations built in sim/level.js.
import { rngFor } from '../core/rng.js';

export function buildLevelMeshes({ scene, mat, V3 }, level, seed) {
  const solid = (mesh, hex, freeze = true) => {
    mesh.material = mat(hex);
    if (freeze) mesh.freezeWorldMatrix();
    return mesh;
  };

  // arena boxes + ramps straight from level data
  for (const b of level.blocks) {
    /* MD 17: the collision floor is an oversized square (one shape, no seams to
       fall through) but the floor you SEE is the hexagon. A block tagged with
       hexDisc is drawn as a 6-sided cylinder of that radius instead of a box;
       the difference between the two only exists behind the rim walls. */
    const m = b.hexDisc
      ? BABYLON.MeshBuilder.CreateCylinder(b.name,
          { diameter: b.hexDisc * 2, height: b.h, tessellation: 6 }, scene)
      : BABYLON.MeshBuilder.CreateBox(b.name, { width: b.w, height: b.h, depth: b.d }, scene);
    m.position.set(b.x, b.y, b.z);
    solid(m, b.hex);
  }
  for (const rp of level.ramps) {
    const m = BABYLON.MeshBuilder.CreateBox(rp.name, { width: rp.w, height: rp.h, depth: rp.d }, scene);
    m.position.set(rp.x, rp.y, rp.z);
    m.rotation.x = rp.rotX; m.rotation.y = rp.rotY;
    solid(m, rp.hex);
  }

  // jump pads: emissive pink discs, pulsing (cosmetic clock per pad)
  const pads = [];
  for (const p of level.pads) {
    const d = BABYLON.MeshBuilder.CreateCylinder('pad', { height: 0.4, diameter: 4.4, tessellation: 10 }, scene);
    d.position.set(p.x, 0.2, p.z);
    const m = new BABYLON.StandardMaterial('padm', scene);
    m.diffuseColor = BABYLON.Color3.FromHexString('#FF3D81');
    m.emissiveColor = BABYLON.Color3.FromHexString('#FF3D81').scale(0.7);
    m.specularColor = BABYLON.Color3.Black();
    d.material = m;
    d.freezeWorldMatrix();
    pads.push({ mesh: d, matRef: m, t: Math.random() * 6 });
  }

  // boost rings: emissive tori, slow spin
  const rings = [];
  for (const r of level.rings) {
    const t = BABYLON.MeshBuilder.CreateTorus('ring', { diameter: 4.6, thickness: 0.32, tessellation: 18 }, scene);
    t.position.set(r.pos.x, r.pos.y, r.pos.z);
    t.lookAt(new BABYLON.Vector3(r.pos.x + r.dir.x, r.pos.y + r.dir.y, r.pos.z + r.dir.z));
    t.rotation.x += Math.PI / 2;
    const m = new BABYLON.StandardMaterial('ringm', scene);
    m.diffuseColor = BABYLON.Color3.FromHexString('#FF3D81');
    m.emissiveColor = BABYLON.Color3.FromHexString('#FF3D81').scale(0.8);
    m.specularColor = BABYLON.Color3.Black();
    t.material = m;
    t.isPickable = false;
    rings.push({ mesh: t });
  }

  // summit beacon
  {
    const beacon = BABYLON.MeshBuilder.CreateBox('beacon', { width: 0.8, height: 26, depth: 0.8 }, scene);
    beacon.position.set(0, level.summitY + 13, 0);
    beacon.material = mat('#FFE7B0', 0.9);
    beacon.isPickable = false;
    beacon.freezeWorldMatrix();
  }

  // ---- LOD crystals: hi/med/lo tiers, from level.crystals placements ----
  const lodTiers = { hi: [], med: [], lo: [] };
  const crystalMats = {
    teal: mat('#3EC5B4'), pink: mat('#FF6FA5'),
    dbgHi: mat('#37E86F', 0.6), dbgMed: mat('#FFD23E', 0.6), dbgLo: mat('#FF4B4B', 0.6),
  };
  const cm = (() => {
    const hi = BABYLON.MeshBuilder.CreateIcoSphere('cHi', { radius: 1, subdivisions: 3 }, scene);
    hi.convertToFlatShadedMesh();
    const med = BABYLON.MeshBuilder.CreateIcoSphere('cMed', { radius: 1, subdivisions: 1 }, scene);
    med.convertToFlatShadedMesh();
    const lo = BABYLON.MeshBuilder.CreateBox('cLo', { size: 1.5 }, scene);
    [hi, med, lo].forEach((m) => { m.setEnabled(false); m.isPickable = false; });
    return { hi, med, lo };
  })();
  level.crystals.forEach((c, i) => {
    const hi = cm.hi.clone('crys' + i); hi.setEnabled(true);
    const med = cm.med.clone('crysM' + i); med.setEnabled(true);
    const lo = cm.lo.clone('crysL' + i); lo.setEnabled(true);
    [hi, med, lo].forEach((m) => { m.material = crystalMats[c.col]; m.isPickable = false; });
    hi.scaling.set(c.s, c.sy, c.s);
    hi.position.set(c.x, c.y, c.z); // level data stores the mesh-center y
    hi.rotation.y = c.rotY;
    hi.addLODLevel(28, med); hi.addLODLevel(65, lo);
    hi.metadata = { crystal: c.col };
    lodTiers.hi.push(hi); lodTiers.med.push(med); lodTiers.lo.push(lo);
  });
  let lodDebug = false;
  function setLodDebug(on) {
    lodDebug = on;
    lodTiers.hi.forEach((m) => { m.material = on ? crystalMats.dbgHi : crystalMats[m.metadata.crystal]; });
    lodTiers.med.forEach((m, i) => { m.material = on ? crystalMats.dbgMed : crystalMats[lodTiers.hi[i].metadata.crystal]; });
    lodTiers.lo.forEach((m, i) => { m.material = on ? crystalMats.dbgLo : crystalMats[lodTiers.hi[i].metadata.crystal]; });
    const el = document.getElementById('lodState');
    if (el) { el.textContent = on ? 'ON' : 'off'; el.className = on ? 'lod-on' : ''; }
  }

  // pebbles: one draw call, seeded so every peer scatters the same gravel
  (function pebbles() {
    const rng = rngFor(seed, 'pebbles');
    const p = BABYLON.MeshBuilder.CreateIcoSphere('peb', { radius: 0.28, subdivisions: 1 }, scene);
    p.convertToFlatShadedMesh();
    p.material = mat('#C9A264'); p.isPickable = false;
    const N = 500, buf = new Float32Array(16 * N), M = BABYLON.Matrix;
    for (let i = 0; i < N; i++) {
      // Band scales with the arena — the old fixed 8..62 was sized to the ±65
      // square and would leave the outer half of the hexagon bare gravel-free.
      const rMax = (level.hex ? level.hex.apothem : 62) * 0.92;
      const a = rng() * Math.PI * 2, r = 8 + rng() * (rMax - 8), s = 0.4 + rng() * 1.4;
      M.Compose(V3(s, s * (0.5 + rng()), s), BABYLON.Quaternion.FromEulerAngles(0, rng() * 6.28, 0),
        V3(Math.cos(a) * r, 0.05, Math.sin(a) * r)).copyToArray(buf, i * 16);
    }
    p.thinInstanceSetBuffer('matrix', buf, 16);
    p.freezeWorldMatrix();
  })();

  // ---- Ascent platforms: pretty archetype meshes at rest pose, driven by
  // platform state each frame ----
  function platMesh(pl, i) {
    const d = pl.dims;
    if (pl.archetype === 'slab') {
      return BABYLON.MeshBuilder.CreateBox('plat' + i, { width: d.w, height: d.h, depth: d.d }, scene);
    }
    if (pl.archetype === 'pad') {
      return BABYLON.MeshBuilder.CreateCylinder('plat' + i, { diameter: d.dia, height: d.h, tessellation: d.tess }, scene);
    }
    if (pl.archetype === 'rock') {
      const m = BABYLON.MeshBuilder.CreateIcoSphere('plat' + i, { radius: 1, subdivisions: 1 }, scene);
      m.convertToFlatShadedMesh();
      m.scaling.set(d.sx, d.sy, d.sz);
      m.bakeCurrentTransformIntoVertices();
      return m;
    }
    if (pl.archetype === 'cross' || pl.archetype === 'L') {
      const A = BABYLON.MeshBuilder.CreateBox('pa' + i, { width: d.len, height: d.h, depth: d.wid }, scene);
      const B = BABYLON.MeshBuilder.CreateBox('pb' + i, { width: d.wid, height: d.h, depth: d.len }, scene);
      if (pl.archetype === 'L') B.position.set(d.len / 2 - d.wid / 2, 0, d.len / 2 - d.wid / 2);
      return BABYLON.Mesh.MergeMeshes([A, B], true, true, undefined, false, false);
    }
    if (pl.archetype === 'ring') {
      const A = BABYLON.MeshBuilder.CreateCylinder('pa' + i, { diameter: d.D, height: d.h, tessellation: 14 }, scene);
      const B = BABYLON.MeshBuilder.CreateCylinder('pb' + i, { diameter: d.D * 0.44, height: d.h + 1, tessellation: 12 }, scene);
      const m = BABYLON.CSG.FromMesh(A).subtract(BABYLON.CSG.FromMesh(B)).toMesh('plat' + i, null, scene);
      A.dispose(); B.dispose();
      return m;
    }
    // dish
    const A = BABYLON.MeshBuilder.CreateCylinder('pa' + i, { diameter: d.D, height: d.h, tessellation: 12 }, scene);
    const B = BABYLON.MeshBuilder.CreateSphere('pb' + i, { diameter: d.D, segments: 8 }, scene);
    B.position.y = d.h / 2 + d.D * 0.30;
    const m = BABYLON.CSG.FromMesh(A).subtract(BABYLON.CSG.FromMesh(B)).toMesh('plat' + i, null, scene);
    A.dispose(); B.dispose();
    return m;
  }

  const platViews = level.platforms.map((pl, i) => {
    const m = platMesh(pl, i);
    m.position.set(pl.base.x, pl.base.y, pl.base.z);
    m.material = mat(pl.hex);
    return { pl, mesh: m, prevState: pl.state };
  });

  // Per-frame platform/pad/ring cosmetics. now = wall-clock seconds (render
  // only); platform POSITIONS come from sim state, never from now.
  function update(now, dt) {
    for (const v of platViews) {
      const { pl, mesh } = v;
      mesh.setEnabled(pl.active);
      let sx = 0, sz = 0;
      if (pl.type === 'collapse') {
        if (pl.state === 'shaking') { sx = (Math.random() - 0.5) * 0.12; sz = (Math.random() - 0.5) * 0.12; }
        if (v.prevState === 'gone' && pl.state === 'idle') mesh.scaling.setAll(0.01); // regrow
        v.prevState = pl.state;
      }
      if (mesh.scaling.x < 1) mesh.scaling.setAll(Math.min(1, mesh.scaling.x + dt * 3));
      mesh.position.set(pl.base.x + pl.offset.x + sx, pl.base.y + pl.offset.y, pl.base.z + pl.offset.z + sz);
      if (pl.type === 'blink' && pl.active) {
        // warning flicker in the last 0.6s of the on-window (sim decides
        // on/off; the flicker itself is cosmetic)
        const c = (now + pl.phase) % 4.5;
        mesh.visibility = c > 2.4 ? 0.35 + 0.65 * Math.abs(Math.sin(now * 14)) : 1;
      }
    }
    for (const p of pads) {
      p.t += dt;
      p.matRef.emissiveColor.set(1, 0.24, 0.5).scaleInPlace(0.5 + 0.3 * Math.sin(p.t * 4));
    }
    for (const r of rings) r.mesh.rotation.y += dt * 0.6;
  }

  return { update, setLodDebug, get lodDebug() { return lodDebug; } };
}
