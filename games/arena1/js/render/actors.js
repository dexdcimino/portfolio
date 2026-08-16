// render/actors.js — mesh pools keyed by entity id (ARENA1_STEPS Phase 4):
// create on first sight in a snapshot, disable on absence (dead enemies and
// taken cells vanish from snapshots; ids are stable so respawns reuse their
// pooled meshes with a grow-in). Positions interpolate between the last two
// snapshots by the accumulator alpha. Visual recipes are the prototype's
// (reference/prototype.html 676–793); wing flap / spin / bob / squash are
// cosmetic wall-clock animation — position truth stays with the snapshots.

export function createActors({ scene, mat, V3 }) {
  const eyeMat = mat('#170D2B');

  function makeBlob() {
    const body = BABYLON.MeshBuilder.CreateIcoSphere('blob', { radius: 0.65, subdivisions: 2 }, scene);
    body.convertToFlatShadedMesh();
    const m = new BABYLON.StandardMaterial('blobm', scene);
    m.diffuseColor = BABYLON.Color3.FromHexString('#7BE3B0');
    m.specularColor = BABYLON.Color3.Black();
    body.material = m;
    const eL = BABYLON.MeshBuilder.CreateBox('eyeL', { width: 0.14, height: 0.2, depth: 0.08 }, scene);
    const eR = eL.clone('eyeR');
    eL.parent = body; eR.parent = body; eL.material = eyeMat; eR.material = eyeMat;
    eL.position = V3(-0.2, 0.15, 0.58); eR.position = V3(0.2, 0.15, 0.58);
    return { root: body, matRef: m };
  }

  function makeWraith() {
    const body = BABYLON.MeshBuilder.CreateIcoSphere('wraith', { radius: 0.5, subdivisions: 2 }, scene);
    body.convertToFlatShadedMesh();
    const m = new BABYLON.StandardMaterial('wrm', scene);
    m.diffuseColor = BABYLON.Color3.FromHexString('#8E5BD6');
    m.specularColor = BABYLON.Color3.Black();
    body.material = m;
    const hL = BABYLON.MeshBuilder.CreateCylinder('hnL', { height: 0.34, diameterTop: 0.01, diameterBottom: 0.13, tessellation: 5 }, scene);
    const hR = hL.clone('hnR');
    hL.parent = body; hR.parent = body; hL.material = eyeMat; hR.material = eyeMat;
    hL.position = V3(-0.22, 0.42, 0); hL.rotation.z = 0.45;
    hR.position = V3(0.22, 0.42, 0); hR.rotation.z = -0.45;
    const eL = BABYLON.MeshBuilder.CreateBox('weL', { width: 0.13, height: 0.09, depth: 0.06 }, scene);
    const eR = eL.clone('weR');
    eL.parent = body; eR.parent = body; eL.material = eyeMat; eR.material = eyeMat;
    eL.position = V3(-0.16, 0.1, 0.45); eL.rotation.z = 0.4;
    eR.position = V3(0.16, 0.1, 0.45); eR.rotation.z = -0.4;
    const wL = BABYLON.MeshBuilder.CreateBox('wgL', { width: 0.85, height: 0.05, depth: 0.38 }, scene);
    const wR = wL.clone('wgR');
    wL.parent = body; wR.parent = body; wL.material = m; wR.material = m;
    wL.position = V3(-0.6, 0.15, -0.05); wL.setPivotPoint(V3(0.42, 0, 0));
    wR.position = V3(0.6, 0.15, -0.05); wR.setPivotPoint(V3(-0.42, 0, 0));
    return { root: body, matRef: m, wingL: wL, wingR: wR, wingT: Math.random() * 6 };
  }

  // spikeball: core + 10 spikes merged once, cloned per instance
  const spikeTpl = (() => {
    const parts = [];
    const core = BABYLON.MeshBuilder.CreateIcoSphere('skCore', { radius: 0.42, subdivisions: 1 }, scene);
    core.convertToFlatShadedMesh();
    parts.push(core);
    for (let i = 0; i < 10; i++) {
      const c = BABYLON.MeshBuilder.CreateCylinder('skSp' + i, { height: 0.42, diameterTop: 0.02, diameterBottom: 0.17, tessellation: 4 }, scene);
      const th = Math.acos(1 - 2 * (i + 0.5) / 10), ph = i * 2.39996;
      const dir = V3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
      c.position = dir.scale(0.5);
      c.rotationQuaternion = BABYLON.Quaternion.FromUnitVectorsToRef
        ? (() => { const q = new BABYLON.Quaternion(); BABYLON.Quaternion.FromUnitVectorsToRef(BABYLON.Axis.Y, dir, q); return q; })()
        : BABYLON.Quaternion.Identity();
      parts.push(c);
    }
    const m = BABYLON.Mesh.MergeMeshes(parts, true, true, undefined, false, false);
    m.setEnabled(false); m.isPickable = false;
    return m;
  })();
  function makeSpike() {
    const body = spikeTpl.clone('spike');
    body.setEnabled(true);
    const m = new BABYLON.StandardMaterial('skm', scene);
    m.diffuseColor = BABYLON.Color3.FromHexString('#E05548');
    m.specularColor = BABYLON.Color3.Black();
    body.material = m;
    return { root: body, matRef: m, t: Math.random() * 6 };
  }

  function makeRocket() {
    // MD 13: an actual rocket — body, bright nose, three tail fins, exhaust
    // glow — built +z-forward inside a holder so sync()'s lookAt orients the
    // whole thing along its velocity. Cheap flat-shaded prims; several fly at
    // once and the smoke trail comes from the fx puff pool, not from here.
    const holder = new BABYLON.TransformNode('rocketH', scene);
    const bodyM = new BABYLON.StandardMaterial('rocketm', scene);
    bodyM.diffuseColor = BABYLON.Color3.FromHexString('#FF7A59');
    bodyM.emissiveColor = BABYLON.Color3.FromHexString('#FF7A59').scale(0.6); // reads in flight
    bodyM.specularColor = BABYLON.Color3.Black();
    const noseM = new BABYLON.StandardMaterial('rocketnm', scene);
    noseM.emissiveColor = BABYLON.Color3.FromHexString('#FFE7B0');
    noseM.diffuseColor = BABYLON.Color3.Black();
    noseM.specularColor = BABYLON.Color3.Black();
    const finM = new BABYLON.StandardMaterial('rocketfm', scene);
    finM.diffuseColor = BABYLON.Color3.FromHexString('#3EC5B4');
    finM.emissiveColor = BABYLON.Color3.FromHexString('#3EC5B4').scale(0.35);
    finM.specularColor = BABYLON.Color3.Black();
    const body = BABYLON.MeshBuilder.CreateCylinder('rocket', { height: 0.42, diameter: 0.13, tessellation: 8 }, scene);
    body.rotation.x = Math.PI / 2; // cylinder +y → +z
    body.material = bodyM; body.parent = holder;
    const nose = BABYLON.MeshBuilder.CreateCylinder('rocketN', { height: 0.16, diameterTop: 0.015, diameterBottom: 0.13, tessellation: 8 }, scene);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 0.29; // ahead of the body
    nose.material = noseM; nose.parent = holder;
    for (let i = 0; i < 3; i++) {
      const fin = BABYLON.MeshBuilder.CreateBox('rocketF' + i, { width: 0.02, height: 0.2, depth: 0.16 }, scene);
      const a = i * (Math.PI * 2 / 3);
      fin.position.set(Math.sin(a) * 0.1, Math.cos(a) * 0.1, -0.15);
      fin.rotation.z = -a; // blade radiates outward
      fin.material = finM; fin.parent = holder;
    }
    const flame = BABYLON.MeshBuilder.CreateSphere('rocketX', { diameter: 0.12, segments: 4 }, scene);
    flame.position.z = -0.26;
    const flameM = new BABYLON.StandardMaterial('rocketxm', scene);
    flameM.emissiveColor = BABYLON.Color3.FromHexString('#FFB13D');
    flameM.diffuseColor = BABYLON.Color3.Black();
    flameM.specularColor = BABYLON.Color3.Black();
    flame.material = flameM; flame.parent = holder;
    for (const m of holder.getChildMeshes()) m.isPickable = false;
    return { root: holder, matRef: bodyM };
  }

  function makeCell() {
    const body = BABYLON.MeshBuilder.CreateCylinder('cell', { height: 0.75, diameter: 0.4, tessellation: 8 }, scene);
    const m = new BABYLON.StandardMaterial('cellm', scene);
    m.diffuseColor = BABYLON.Color3.FromHexString('#FFB13D');
    m.emissiveColor = BABYLON.Color3.FromHexString('#FFB13D').scale(0.85);
    m.specularColor = BABYLON.Color3.Black();
    body.material = m;
    return { root: body, matRef: m, t: Math.random() * 6 };
  }

  function makeRemotePlayer() {
    // The pill IS the collision capsule: r 0.4, total height 1.8 (halfH 0.9),
    // centered on the player position like the solver's capsule.
    const body = BABYLON.MeshBuilder.CreateCapsule('rplayer', {
      radius: 0.4, height: 1.8, tessellation: 12, subdivisions: 4,
    }, scene);
    const m = new BABYLON.StandardMaterial('rpm', scene);
    m.diffuseColor = BABYLON.Color3.FromHexString('#FF7A59');
    m.emissiveColor = BABYLON.Color3.FromHexString('#FF7A59').scale(0.25); // reads against fog
    m.specularColor = BABYLON.Color3.Black();
    body.material = m;
    // Floating tag: billboard plane + dynamic texture, redrawn only when the
    // tag string changes. Hidden until a non-empty tag arrives.
    const plane = BABYLON.MeshBuilder.CreatePlane('rtag', { width: 2.6, height: 0.65 }, scene);
    plane.parent = body;
    plane.position.y = 1.55;
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    plane.isPickable = false;
    const tex = new BABYLON.DynamicTexture('rtagTex', { width: 256, height: 64 }, scene, false);
    tex.hasAlpha = true;
    const lm = new BABYLON.StandardMaterial('rtagMat', scene);
    lm.emissiveTexture = tex;
    lm.opacityTexture = tex;
    lm.disableLighting = true;
    lm.backFaceCulling = false;
    plane.material = lm;
    plane.setEnabled(false);
    return { root: body, matRef: m, tagPlane: plane, tagTex: tex, tagText: null };
  }

  const pool = new Map(); // id → { kind, view, seen }
  const flashUntil = new Map(); // enemy id → wall-clock time (hit events)

  function get(id, kind) {
    let a = pool.get(id);
    if (!a || a.kind !== kind) {
      if (a) a.view.root.dispose();
      const view = kind === 'blob' ? makeBlob()
        : kind === 'wraith' ? makeWraith()
          : kind === 'spike' ? makeSpike()
            : kind === 'cell' ? makeCell()
              : kind === 'rocket' ? makeRocket()
                : makeRemotePlayer();
      a = { kind, view, wasVisible: false };
      pool.set(id, a);
    }
    return a;
  }

  function flash(id, dur = 0.08) { flashUntil.set(id, performance.now() / 1000 + dur); }

  const lerp = (a, b, t) => a + (b - a) * t;

  // prev/last snapshots + alpha; localId excluded from player meshes; myPos
  // aims blob eyes (cosmetic).
  function sync(prev, last, alpha, localId, myPos, now, dt) {
    if (!last) return;
    const seen = new Set();
    const prevEnemies = new Map((prev?.enemies || []).map((e) => [e.id, e]));
    for (const e of last.enemies) {
      seen.add(e.id);
      const a = get(e.id, e.kind);
      const r = a.view.root;
      const pe = prevEnemies.get(e.id) || e;
      r.setEnabled(true);
      if (!a.wasVisible) r.scaling.setAll(0.01); // spawn/respawn grow-in
      a.wasVisible = true;
      if (r.scaling.x < 1) r.scaling.setAll(Math.min(1, r.scaling.x + dt * 4));
      const x = lerp(pe.pos.x, e.pos.x, alpha), y = lerp(pe.pos.y, e.pos.y, alpha), z = lerp(pe.pos.z, e.pos.z, alpha);
      r.position.set(x, y, z);
      if (e.kind === 'blob') {
        const vy = (e.pos.y - pe.pos.y) * 60; // squash from apparent vertical speed
        const st = 1 + Math.max(-0.35, Math.min(0.4, vy * 0.04));
        r.scaling.y = r.scaling.x * st;
        if (myPos) r.lookAt(new BABYLON.Vector3(myPos.x, r.position.y, myPos.z));
      } else if (e.kind === 'wraith') {
        a.view.wingT += dt * 11;
        a.view.wingL.rotation.z = 0.45 + Math.sin(a.view.wingT) * 0.5;
        a.view.wingR.rotation.z = -0.45 - Math.sin(a.view.wingT) * 0.5;
        if (myPos) r.lookAt(new BABYLON.Vector3(myPos.x, r.position.y, myPos.z));
      } else if (e.kind === 'spike') {
        r.rotation.y += dt * 1.1;
        r.rotation.x += dt * 0.8;
      }
      const until = flashUntil.get(e.id) || 0;
      a.view.matRef.emissiveColor = (now < until) ? BABYLON.Color3.White() : BABYLON.Color3.Black();
    }
    const prevRockets = new Map((prev?.rockets || []).map((r) => [r.id, r]));
    for (const r of (last.rockets || [])) {
      const key = 'r:' + r.id;
      seen.add(key);
      const a = get(key, 'rocket');
      const pr = prevRockets.get(r.id) || r;
      a.view.root.setEnabled(true);
      a.wasVisible = true;
      const x = lerp(pr.pos.x, r.pos.x, alpha), y = lerp(pr.pos.y, r.pos.y, alpha), z = lerp(pr.pos.z, r.pos.z, alpha);
      a.view.root.position.set(x, y, z);
      a.view.root.lookAt(new BABYLON.Vector3(x + r.vel.x, y + r.vel.y, z + r.vel.z)); // nose along flight
    }
    const prevCells = new Map((prev?.cells || []).map((c) => [c.id, c]));
    for (const c of last.cells) {
      const key = 'cell:' + c.id;
      seen.add(key);
      const a = get(key, 'cell');
      const pc = prevCells.get(c.id) || c;
      a.view.root.setEnabled(true);
      a.wasVisible = true;
      a.view.t += dt;
      a.view.root.position.set(
        lerp(pc.pos.x, c.pos.x, alpha),
        lerp(pc.pos.y, c.pos.y, alpha) + Math.sin(a.view.t * 2) * 0.15,
        lerp(pc.pos.z, c.pos.z, alpha));
      a.view.root.rotation.y += dt * 1.5;
    }
    const prevPlayers = new Map((prev?.players || []).map((p) => [p.id, p]));
    for (const p of last.players) {
      if (p.id === localId) continue;
      const key = 'p:' + p.id;
      seen.add(key);
      const a = get(key, 'player');
      const pp = prevPlayers.get(p.id) || p;
      a.view.root.setEnabled(true);
      a.wasVisible = true;
      a.view.root.position.set(lerp(pp.pos.x, p.pos.x, alpha), lerp(pp.pos.y, p.pos.y, alpha), lerp(pp.pos.z, p.pos.z, alpha));
      a.view.root.rotation.y = p.yaw;
      const tag = (p.tag || '').slice(0, 12);
      if (tag !== a.view.tagText) {
        a.view.tagText = tag;
        const ctx2 = a.view.tagTex.getContext();
        ctx2.clearRect(0, 0, 256, 64);
        if (tag) a.view.tagTex.drawText(tag, null, 46, 'bold 40px Consolas, monospace', '#FFE7B0', 'transparent', true);
        else a.view.tagTex.update();
        a.view.tagPlane.setEnabled(!!tag);
      }
    }
    for (const [id, a] of pool) {
      if (!seen.has(id)) { a.view.root.setEnabled(false); a.wasVisible = false; }
    }
  }

  // enemy positions for FX (bursts on kill read the last known pose)
  function positionOf(id) {
    const a = pool.get(id);
    return a ? a.view.root.position : null;
  }

  return { sync, flash, positionOf };
}
