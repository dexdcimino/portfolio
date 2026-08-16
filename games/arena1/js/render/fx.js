// render/fx.js — pooled cosmetics (ARENA1_STEPS Phase 4): gun + muzzle +
// kick, tracers, debris bursts, jet puffs, damage numbers, blob shadows
// (read-only world.raycast), grapple rope, hitmark, vignettes. Math.random is
// legal here — render only, none of this feeds back into the sim.

export function createFx({ scene, cam, mat, V3 }, world) {
  // ---- gun (parented to the camera, exactly the prototype's) ----
  const gunRoot = new BABYLON.TransformNode('gun', scene);
  gunRoot.parent = cam; gunRoot.position = V3(0.34, -0.30, 0.72);
  const gunBody = BABYLON.MeshBuilder.CreateBox('gb', { width: 0.13, height: 0.16, depth: 0.42 }, scene);
  gunBody.parent = gunRoot; gunBody.material = mat('#372052'); gunBody.isPickable = false;
  const gunBarrel = BABYLON.MeshBuilder.CreateCylinder('gbar', { height: 0.34, diameter: 0.075, tessellation: 8 }, scene);
  gunBarrel.parent = gunRoot; gunBarrel.rotation.x = Math.PI / 2; gunBarrel.position = V3(0, 0.03, 0.34);
  gunBarrel.material = mat('#FF7A59'); gunBarrel.isPickable = false;
  const gunFin = BABYLON.MeshBuilder.CreateBox('gf', { width: 0.03, height: 0.12, depth: 0.16 }, scene);
  gunFin.parent = gunRoot; gunFin.position = V3(0, 0.12, 0.1); gunFin.material = mat('#3EC5B4'); gunFin.isPickable = false;
  const hookEmit = BABYLON.MeshBuilder.CreateBox('he', { width: 0.08, height: 0.08, depth: 0.2 }, scene);
  hookEmit.parent = gunRoot; hookEmit.position = V3(-0.09, -0.02, 0.3); hookEmit.material = mat('#FF3D81'); hookEmit.isPickable = false;
  const muzzle = BABYLON.MeshBuilder.CreateIcoSphere('mz', { radius: 0.06, subdivisions: 1 }, scene);
  muzzle.parent = gunRoot; muzzle.position = V3(0, 0.03, 0.55);
  muzzle.material = mat('#FFE7B0', 1); muzzle.isPickable = false; muzzle.scaling.setAll(0.01);
  let gunKick = 0, muzzleT = 0;

  // ---- grapple rope + hook tip ----
  const rope = BABYLON.MeshBuilder.CreateBox('rope', { width: 0.05, height: 0.05, depth: 1 }, scene);
  rope.material = mat('#FF3D81', 0.7); rope.isVisible = false; rope.isPickable = false;
  const hookTip = BABYLON.MeshBuilder.CreateIcoSphere('hook', { radius: 0.14, subdivisions: 1 }, scene);
  hookTip.material = mat('#FF3D81', 1); hookTip.isVisible = false; hookTip.isPickable = false;
  function ropeTo(target) {
    const a = hookEmit.getAbsolutePosition();
    const t = new BABYLON.Vector3(target.x, target.y, target.z);
    const d = t.subtract(a), len = Math.max(0.01, d.length());
    rope.isVisible = true; hookTip.isVisible = true;
    rope.position = a.add(d.scale(0.5));
    rope.lookAt(t); rope.scaling.z = len;
    hookTip.position.copyFrom(t);
  }
  function ropeOff() { rope.isVisible = false; hookTip.isVisible = false; }

  // ---- tracers ----
  const tracers = [];
  for (let i = 0; i < 10; i++) {
    const t = BABYLON.MeshBuilder.CreateBox('tr' + i, { width: 0.05, height: 0.05, depth: 1 }, scene);
    t.material = mat('#FFE7B0', 1); t.isVisible = false; t.isPickable = false;
    tracers.push({ mesh: t, life: 0 });
  }
  function spawnTracer(a, b) {
    const t = tracers.find((t) => t.life <= 0); if (!t) return;
    const d = b.subtract(a), len = d.length();
    t.mesh.position = a.add(d.scale(0.5));
    t.mesh.lookAt(b); t.mesh.scaling.z = len; t.mesh.isVisible = true;
    t.mesh.visibility = 1; t.life = 0.07;
  }

  // ---- debris ----
  const debris = [];
  for (let i = 0; i < 40; i++) {
    const d = BABYLON.MeshBuilder.CreateBox('db' + i, { size: 0.22 }, scene);
    d.isVisible = false; d.isPickable = false;
    debris.push({ mesh: d, vel: V3(0, 0, 0), life: 0 });
  }
  function burst(pos, hex, n = 8, power = 6) {
    for (let i = 0; i < n; i++) {
      const d = debris.find((d) => d.life <= 0); if (!d) return;
      d.mesh.material = mat(hex);
      d.mesh.position.set(pos.x, pos.y, pos.z);
      d.vel.set((Math.random() - 0.5) * power, (Math.random() * 0.9 + 0.3) * power, (Math.random() - 0.5) * power);
      d.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      d.mesh.scaling.setAll(0.6 + Math.random() * 0.8);
      d.mesh.isVisible = true; d.life = 0.7;
    }
  }
  function jetPuff(playerPos) {
    const d = debris.find((d) => d.life <= 0); if (!d) return;
    d.mesh.material = mat('#FFB13D', 0.8);
    d.mesh.position.set(playerPos.x + (Math.random() - 0.5) * 0.4, playerPos.y - 0.9, playerPos.z + (Math.random() - 0.5) * 0.4);
    d.vel.set((Math.random() - 0.5) * 2, -6 - Math.random() * 3, (Math.random() - 0.5) * 2);
    d.mesh.scaling.setAll(0.5 + Math.random() * 0.5);
    d.mesh.isVisible = true; d.life = 0.35;
  }

  // ---- damage numbers (HUD divs projected each frame) ----
  const dmgPool = [];
  const hud = document.getElementById('hud');
  for (let i = 0; i < 14; i++) {
    const el = document.createElement('div');
    el.className = 'dmg'; el.style.display = 'none';
    hud.appendChild(el);
    dmgPool.push({ el, pos: V3(0, 0, 0), life: 0 });
  }
  function dmgNum(pos, text, color) {
    const d = dmgPool.find((d) => d.life <= 0); if (!d) return;
    d.pos.set(pos.x, pos.y + 0.6 + Math.random() * 0.4, pos.z);
    d.el.textContent = text; d.el.style.color = color || '#F2D6A2';
    d.el.style.display = 'block'; d.life = 0.6;
  }

  // ---- blob shadows (read-only world.raycast — the blessed one-way read) ----
  const DOWN = { x: 0, y: -1, z: 0 };
  function makeShadow() {
    const d = BABYLON.MeshBuilder.CreateDisc('bs', { radius: 0.55, tessellation: 12 }, scene);
    d.rotation.x = Math.PI / 2;
    const m = new BABYLON.StandardMaterial('bsm', scene);
    m.diffuseColor = BABYLON.Color3.Black(); m.alpha = 0.28; m.specularColor = BABYLON.Color3.Black();
    d.material = m; d.isPickable = false;
    return d;
  }
  const shadows = new Map(); // key → disc
  function placeShadow(key, pos, size) {
    let disc = shadows.get(key);
    if (!disc) { disc = makeShadow(); shadows.set(key, disc); }
    const hit = world.raycast(pos, DOWN, 30);
    if (hit) {
      disc.setEnabled(true);
      disc.position.set(pos.x, hit.point.y + 0.02, pos.z);
      const h = pos.y - hit.point.y;
      const s = Math.max(0.25, size * (1 - h * 0.04));
      disc.scaling.set(s, s, s);
      disc.material.alpha = Math.max(0.06, 0.28 - h * 0.012);
    } else disc.setEnabled(false);
  }
  function hideShadow(key) { shadows.get(key)?.setEnabled(false); }

  // ---- hitmark + vignettes ----
  const hitmark = document.getElementById('hitmark');
  let hitT = 0;
  function hitmarkFlash() { hitmark.classList.add('on'); hitT = 0.07; }
  const vig = {
    hurt: document.getElementById('hurtVig'),
    jet: document.getElementById('jetVig'),
    speed: document.getElementById('speedVig'),
  };
  let hurtT = 0;
  function hurtFlash() { vig.hurt.style.opacity = 1; hurtT = 0.06; }

  function fire() { gunKick = 1; muzzleT = 0.05; }

  function update(dt, grounded, bob) {
    gunKick = Math.max(0, gunKick - dt * 9);
    gunRoot.position.z = 0.72 - gunKick * 0.09;
    gunRoot.position.y = -0.30 + (grounded ? Math.sin(bob * 2) * 0.008 : 0) - gunKick * 0.02;
    gunRoot.rotation.x = -gunKick * 0.12;
    muzzleT -= dt;
    muzzle.scaling.setAll(muzzleT > 0 ? 1 + Math.random() * 0.6 : 0.01);
    if (hitT > 0) { hitT -= dt; if (hitT <= 0) hitmark.classList.remove('on'); }
    if (hurtT > 0) { hurtT -= dt; if (hurtT <= 0) vig.hurt.style.opacity = 0; }

    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt; t.mesh.visibility = Math.max(0, t.life / 0.07);
        if (t.life <= 0) t.mesh.isVisible = false;
      }
    }
    for (const d of debris) {
      if (d.life > 0) {
        d.life -= dt;
        d.vel.y += -30 * 0.7 * dt; // TUNE.G visual echo; cosmetics only
        d.mesh.position.addInPlace(d.vel.scale(dt));
        d.mesh.rotation.x += dt * 6; d.mesh.rotation.z += dt * 5;
        d.mesh.scaling.scaleInPlace(Math.max(0.001, 1 - dt * 1.4));
        if (d.life <= 0) d.mesh.isVisible = false;
      }
    }
    const engine = scene.getEngine();
    const w = engine.getRenderWidth(), h = engine.getRenderHeight();
    for (const d of dmgPool) {
      if (d.life > 0) {
        d.life -= dt; d.pos.y += dt * 1.2;
        const p = BABYLON.Vector3.Project(d.pos, BABYLON.Matrix.Identity(), scene.getTransformMatrix(), cam.viewport.toGlobal(w, h));
        if (p.z > 0 && p.z < 1) {
          d.el.style.left = (p.x * window.innerWidth / w) + 'px';
          d.el.style.top = (p.y * window.innerHeight / h) + 'px';
          d.el.style.opacity = d.life / 0.6;
        } else d.el.style.opacity = 0;
        if (d.life <= 0) d.el.style.display = 'none';
      }
    }
  }

  return {
    fire, spawnTracer, burst, jetPuff, dmgNum,
    ropeTo, ropeOff, placeShadow, hideShadow,
    hitmarkFlash, hurtFlash, vig, update,
    muzzleWorld: () => muzzle.getAbsolutePosition(),
  };
}
