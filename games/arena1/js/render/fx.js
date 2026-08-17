// render/fx.js — pooled cosmetics (ARENA1_STEPS Phase 4): gun + muzzle +
// kick, tracers, debris bursts, jet puffs, damage numbers, blob shadows
// (read-only world.raycast), grapple rope, hitmark, vignettes, and the MD 13
// two-layer explosion. Math.random is legal here — render only, none of this
// feeds back into the sim. SPLASH_RADIUS is a one-way constant read: the
// damage-core visual derives from it so the bright boundary can never drift
// from the true splash volume.

import { SPLASH_RADIUS } from '../sim/combat.js';
import { makeZap, makeLauncher } from './weapons.js';

export function createFx({ scene, cam, mat, V3 }, world) {
  // ---- gun (parented to the camera, exactly the prototype's) ----
  // Geometry comes from the SHARED factories (MD 14) — remote pills hold the
  // same models, so the viewmodel and the pill weapon can never drift.
  const gunRoot = new BABYLON.TransformNode('gun', scene);
  gunRoot.parent = cam; gunRoot.position = V3(0.34, -0.30, 0.72);
  // Canted inward (the prototype held it dead straight): end-on you only saw
  // the body's flat back face — a dark slab. A few degrees of yaw shows the
  // side profile where the gun shape actually lives. The kick animation only
  // writes rotation.x, so the cant persists.
  gunRoot.rotation.y = -0.16;
  const zapView = makeZap({ mat, V3 }, scene, gunRoot);
  const launcherView = makeLauncher({ mat, V3 }, scene, gunRoot);
  const hookEmit = zapView.hookEmit;
  /* MD 15 item 13. The rope used to start at hookEmit, which sits at local
     z=0.3 with a depth of 0.2 — its back half is INSIDE the zap body (a 0.42
     box centred on 0, so its front face is z=0.21). Coincident faces, so the
     rope and the gun z-fought at the muzzle and the rope flickered through the
     body cube.
     Fixed by moving the rope's visual origin forward along the barrel axis,
     past every piece of both weapons, rather than by switching off depth
     testing — that would draw the rope over the level and the players too.
     Clearance: the zap's barrel ends at z=0.51, the launcher's rim at 0.58 and
     the muzzle flash sphere at 0.61, so 0.68 is past all of them with room to
     spare. It has to clear BOTH models because the emitter is the zap's and is
     used whichever weapon is shown. x/y stay on hookEmit so the rope still
     leaves the same corner of the gun; only the depth changes, which at this
     distance from the camera is a couple of pixels on screen. */
  const ropeEmit = new BABYLON.TransformNode('ropeEmit', scene);
  ropeEmit.parent = gunRoot;
  ropeEmit.position = V3(-0.09, -0.02, 0.68);
  const muzzle = BABYLON.MeshBuilder.CreateIcoSphere('mz', { radius: 0.06, subdivisions: 1 }, scene);
  muzzle.parent = gunRoot; muzzle.position = V3(0, 0.03, 0.55);
  muzzle.material = mat('#FFE7B0', 1); muzzle.isPickable = false; muzzle.scaling.setAll(0.01);
  let gunKick = 0, muzzleT = 0;

  let shownWeapon = -1;
  function setWeapon(w) {
    if (w === shownWeapon) return;
    shownWeapon = w;
    zapView.root.setEnabled(w === 0);
    launcherView.root.setEnabled(w === 1);
  }
  setWeapon(0);

  // ---- grapple rope + hook tip ----
  // MD 13: the rope wears the player's ACCENT. Dedicated material — the mat()
  // helper caches by hex, so retinting a shared entry would repaint every
  // mesh using that colour. Remote ropes (when the remote-visuals MD draws
  // them) use their own neutral default; the accent never rides the wire here.
  const ropeMat = new BABYLON.StandardMaterial('ropem', scene);
  ropeMat.specularColor = BABYLON.Color3.Black();
  ropeMat.alpha = 0.85;
  function setRopeColor(hex) {
    try {
      const c = BABYLON.Color3.FromHexString(hex);
      ropeMat.diffuseColor = c;
      ropeMat.emissiveColor = c.scale(0.55);
    } catch { /* malformed hex: keep the last colour */ }
  }
  setRopeColor('#9EE02B'); // site default (lime) until main hands over the real one
  const rope = BABYLON.MeshBuilder.CreateBox('rope', { width: 0.05, height: 0.05, depth: 1 }, scene);
  rope.material = ropeMat; rope.isVisible = false; rope.isPickable = false;
  const hookTip = BABYLON.MeshBuilder.CreateIcoSphere('hook', { radius: 0.14, subdivisions: 1 }, scene);
  hookTip.material = ropeMat; hookTip.isVisible = false; hookTip.isPickable = false;
  function ropeTo(target) {
    const a = ropeEmit.getAbsolutePosition();
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

  // ---- explosions (MD 13): two layers with deliberately different radii ----
  // DAMAGE CORE — bright, near-opaque, bounded at exactly SPLASH_RADIUS (the
  // scale is derived, never typed). It expands fast, HOLDS at the true splash
  // boundary, then dies by fading in place — it never grows past the radius,
  // so what players learn as "that hurt" is always the real volume.
  // SPECTACLE FALLOFF — shockwave ring + light bloom + smoke reading ~12m.
  // Fast and transparent on purpose: hand-tuned numbers, NOT derived from the
  // splash constant, so spectacle can be art-directed without moving the
  // damage read. Someone at 5.5m stands inside the bloom, outside the core.
  const CORE_T = 0.5, RING_T = 0.45, BLOOM_T = 0.22;
  const explosions = [];
  {
    const coreMatT = new BABYLON.StandardMaterial('exCore', scene);
    coreMatT.emissiveColor = BABYLON.Color3.FromHexString('#FFE7B0');
    coreMatT.diffuseColor = BABYLON.Color3.Black();
    coreMatT.specularColor = BABYLON.Color3.Black();
    coreMatT.disableLighting = true;
    coreMatT.backFaceCulling = false; // rocket-jumpers are INSIDE the core
    const ringMatT = new BABYLON.StandardMaterial('exRing', scene);
    ringMatT.emissiveColor = BABYLON.Color3.FromHexString('#FF7A59');
    ringMatT.diffuseColor = BABYLON.Color3.Black();
    ringMatT.specularColor = BABYLON.Color3.Black();
    ringMatT.disableLighting = true;
    const bloomMatT = new BABYLON.StandardMaterial('exBloom', scene);
    bloomMatT.emissiveColor = BABYLON.Color3.FromHexString('#FFB13D');
    bloomMatT.diffuseColor = BABYLON.Color3.Black();
    bloomMatT.specularColor = BABYLON.Color3.Black();
    bloomMatT.disableLighting = true;
    // backFaceCulling stays ON: standing inside the 13m bloom must not wash
    // the whole screen — the falloff is for onlookers, and a wash would bury
    // the core boundary the split exists to keep legible.
    for (let i = 0; i < 4; i++) {
      const core = BABYLON.MeshBuilder.CreateSphere('exc' + i, { diameter: 2, segments: 10 }, scene);
      core.material = coreMatT.clone('exCore' + i);
      const ring = BABYLON.MeshBuilder.CreateTorus('exr' + i, { diameter: 2, thickness: 0.22, tessellation: 28 }, scene);
      ring.material = ringMatT.clone('exRing' + i);
      const bloom = BABYLON.MeshBuilder.CreateSphere('exb' + i, { diameter: 2, segments: 8 }, scene);
      bloom.material = bloomMatT.clone('exBloom' + i);
      for (const m of [core, ring, bloom]) { m.isVisible = false; m.isPickable = false; }
      explosions.push({ core, ring, bloom, t: -1 });
    }
  }
  function explosion(pos) {
    let e = explosions.find((e) => e.t < 0);
    if (!e) { // all busy: steal the oldest so a barrage never goes silent
      e = explosions.reduce((a, b) => (a.t > b.t ? a : b));
    }
    e.t = 0;
    for (const m of [e.core, e.ring, e.bloom]) {
      m.position.set(pos.x, pos.y, pos.z);
      m.isVisible = true;
    }
    for (let i = 0; i < 7; i++) { // smoke drifting out of the core
      puff({
        x: pos.x + (Math.random() - 0.5) * SPLASH_RADIUS,
        y: pos.y + Math.random() * 1.5,
        z: pos.z + (Math.random() - 0.5) * SPLASH_RADIUS,
      }, 0.8, 2.6, 0.9, 0.32, 2.2);
    }
  }

  /* MD 24 — SERPENT DESTRUCTION, second pass.
     The first version called explosion() and burst(). Both were the wrong
     tools and it showed as "just an explosion sphere":
       · explosion()'s core is bounded at EXACTLY SPLASH_RADIUS, on purpose —
         it is how a rocket tells you its damage radius. Firing it where there
         is no splash draws a damage indicator that lies, and at 7m across it
         swallowed everything else in the effect.
       · burst() throws 0.22m boxes scaled 0.6–1.4, so 0.13–0.31m of confetti,
         out of a 40-slot pool shared with jet puffs. A 22-segment death asked
         for ~250 of them and got 40.
     So: a blast with its own radius, and a real CHUNK pool — big tumbling
     shards, sized per emit, that read as pieces of the body coming apart. */
  const chunks = [];
  {
    // Icospheres, not boxes: a low-poly shard reads as a piece broken off a
    // low-poly body, where a cube reads as a crate.
    for (let i = 0; i < 72; i++) {
      const m = BABYLON.MeshBuilder.CreateIcoSphere('ck' + i, { radius: 0.5, subdivisions: 1 }, scene);
      m.convertToFlatShadedMesh();
      m.isVisible = false; m.isPickable = false;
      chunks.push({ mesh: m, vel: V3(0, 0, 0), spin: V3(0, 0, 0), life: 0, max: 1 });
    }
  }
  function chunkBurst(pos, { n = 10, power = 14, size = 0.9, hex = '#3E7FC5', life = 1.7, up = 0.45 } = {}) {
    for (let i = 0; i < n; i++) {
      const c = chunks.find((c) => c.life <= 0);
      if (!c) return;                 // pool dry: drop the rest, never allocate
      c.mesh.material = mat(hex);
      c.mesh.position.set(pos.x, pos.y, pos.z);
      // Even-ish sphere of directions so pieces leave in every direction,
      // biased upward so they arc rather than skid.
      const a = Math.random() * Math.PI * 2;
      const e = Math.acos(1 - 2 * Math.random()) - Math.PI / 2;
      const sp = power * (0.45 + Math.random() * 0.9);
      c.vel.set(Math.cos(a) * Math.cos(e) * sp,
        Math.sin(e) * sp + power * up,
        Math.sin(a) * Math.cos(e) * sp);
      c.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      c.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      c.mesh.scaling.setAll(size * (0.55 + Math.random() * 0.95));
      c.mesh.isVisible = true;
      c.life = life * (0.7 + Math.random() * 0.6);
      c.max = c.life;
    }
  }

  /* A blast whose radius is an ARGUMENT. Deliberately separate from
     explosion(): that one's size is load-bearing information about splash
     damage, and this one is free to be whatever size the thing that died was. */
  const blasts = [];
  {
    const bm = new BABYLON.StandardMaterial('sbCore', scene);
    bm.emissiveColor = BABYLON.Color3.FromHexString('#FFD9A0');
    bm.diffuseColor = BABYLON.Color3.Black(); bm.specularColor = BABYLON.Color3.Black();
    bm.disableLighting = true; bm.backFaceCulling = false;
    const rm = new BABYLON.StandardMaterial('sbRing', scene);
    rm.emissiveColor = BABYLON.Color3.FromHexString('#FF7A59');
    rm.diffuseColor = BABYLON.Color3.Black(); rm.specularColor = BABYLON.Color3.Black();
    rm.disableLighting = true;
    for (let i = 0; i < 8; i++) {
      const core = BABYLON.MeshBuilder.CreateSphere('sbc' + i, { diameter: 2, segments: 8 }, scene);
      core.material = bm.clone('sbCore' + i);
      const ring = BABYLON.MeshBuilder.CreateTorus('sbr' + i, { diameter: 2, thickness: 0.18, tessellation: 20 }, scene);
      ring.material = rm.clone('sbRing' + i);
      core.isVisible = false; ring.isVisible = false;
      core.isPickable = false; ring.isPickable = false;
      blasts.push({ core, ring, t: -1, r: 1 });
    }
  }
  function blast(pos, r) {
    let b = blasts.find((x) => x.t < 0) || blasts.reduce((a, c) => (a.t > c.t ? a : c));
    b.t = 0; b.r = r;
    for (const m of [b.core, b.ring]) { m.position.set(pos.x, pos.y, pos.z); m.isVisible = true; }
    b.ring.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  }

  /* One sphere popping off. A modest flash and a lot of body: the point is
     that a PIECE came off, so the pieces are the effect and the flash is only
     there to punctuate it. `scale` is the tier's, so a giant sheds bigger
     chunks than a t1 rather than the same ones louder. */
  function serpentPop(pos, scale = 1) {
    blast(pos, 1.5 * scale);
    chunkBurst(pos, { n: 9, power: 15 * scale, size: 0.85 * scale, hex: '#3E7FC5', life: 1.6 });
    chunkBurst(pos, { n: 5, power: 17 * scale, size: 0.55 * scale, hex: '#F2D6A2', life: 1.4 });
    for (let i = 0; i < 4; i++) {
      puff({ x: pos.x + (Math.random() - 0.5) * 2.5 * scale,
        y: pos.y + (Math.random() - 0.5) * 2 * scale,
        z: pos.z + (Math.random() - 0.5) * 2.5 * scale },
        0.9 * scale, 3.0 * scale, 0.9, 0.3, 2.4);
    }
  }

  /* The final death. Not "one bigger pop": a serpent dies along its whole
     length, so the blasts walk the body over ~0.45s and the head goes last and
     hardest. Staggered with setTimeout because this is presentation only — no
     sim state depends on it, and pinning it to sim ticks would make a death
     look different at a different frame rate. */
  function serpentDeath(pos, scale = 1, body = []) {
    const points = body.length ? body : [pos];
    points.forEach((q, i) => {
      const k = 1 - i / Math.max(1, points.length);     // hardest at the head
      setTimeout(() => {
        blast(q, (1.6 + 1.4 * k) * scale);
        chunkBurst(q, { n: 7, power: (17 + 9 * k) * scale, size: (0.9 + 0.5 * k) * scale,
          hex: '#3E7FC5', life: 2.1 });
        chunkBurst(q, { n: 4, power: (19 + 9 * k) * scale, size: 0.6 * scale,
          hex: '#F2D6A2', life: 1.9 });
      }, (points.length - 1 - i) * (450 / Math.max(1, points.length)));
    });
    setTimeout(() => {
      blast(pos, 6 * scale);
      chunkBurst(pos, { n: 12, power: 30 * scale, size: 1.5 * scale, hex: '#FF3D81', life: 2.6, up: 0.7 });
      chunkBurst(pos, { n: 10, power: 26 * scale, size: 1.2 * scale, hex: '#3E7FC5', life: 2.4, up: 0.6 });
      for (let i = 0; i < 10; i++) {
        puff({ x: pos.x + (Math.random() - 0.5) * 6 * scale,
          y: pos.y + (Math.random() - 0.5) * 4 * scale,
          z: pos.z + (Math.random() - 0.5) * 6 * scale },
          1.5 * scale, 6.0 * scale, 1.0, 0.24, 3.2);
      }
    }, 450);
  }

  // ---- soft puffs: rocket exhaust trail + explosion smoke (one pool) ----
  const puffs = [];
  {
    const pm = new BABYLON.StandardMaterial('puffm', scene);
    pm.emissiveColor = BABYLON.Color3.FromHexString('#C9BFD8');
    pm.diffuseColor = BABYLON.Color3.Black();
    pm.specularColor = BABYLON.Color3.Black();
    pm.disableLighting = true;
    for (let i = 0; i < 28; i++) {
      const s = BABYLON.MeshBuilder.CreateSphere('pf' + i, { diameter: 1, segments: 4 }, scene);
      s.material = pm.clone('puffm' + i);
      s.isVisible = false; s.isPickable = false;
      puffs.push({ mesh: s, life: 0, max: 1, s0: 1, s1: 1, a0: 0.3, rise: 1 });
    }
  }
  function puff(pos, s0, s1, life, alpha, rise, hex) {
    const p = puffs.find((p) => p.life <= 0); if (!p) return;
    p.mesh.position.set(pos.x, pos.y, pos.z);
    p.s0 = s0; p.s1 = s1; p.max = life; p.life = life; p.a0 = alpha; p.rise = rise;
    // per-instance material, so a tinted use (remote muzzle/launch flash,
    // MD 14) never repaints the default smoke gray
    p.mesh.material.emissiveColor = BABYLON.Color3.FromHexString(hex || '#C9BFD8');
    p.mesh.scaling.setAll(s0);
    p.mesh.isVisible = true;
  }
  // exhaust: small, quick, barely rising — reads as a dotted line behind the
  // rocket that tells you where it came from
  function trailPuff(pos) { puff(pos, 0.22, 0.7, 0.45, 0.4, 0.6); }

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
    /* MD 24 chunks: real gravity and tumble, and they SHRINK only at the very
       end. The old debris faded from the first frame (scale x0.986 every
       frame), which is why a burst read as a puff of confetti rather than
       pieces — these hold their size for most of their life so you can see
       what came off, then collapse. */
    for (const c of chunks) {
      if (c.life <= 0) continue;
      c.life -= dt;
      c.vel.y += -30 * 0.85 * dt;
      c.mesh.position.addInPlace(c.vel.scale(dt));
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      const k = c.life / c.max;
      if (k < 0.3) c.mesh.scaling.scaleInPlace(Math.max(0.001, 1 - dt * 4.5));
      if (c.life <= 0) c.mesh.isVisible = false;
    }
    for (const b of blasts) {
      if (b.t < 0) continue;
      b.t += dt;
      const CT = 0.34, RT = 0.46;
      if (b.t < CT) {
        const g = Math.min(1, b.t / 0.07);
        b.core.scaling.setAll(b.r * (0.4 + 0.6 * (1 - (1 - g) * (1 - g))));
        b.core.material.alpha = 0.95 * (1 - b.t / CT);
      } else b.core.isVisible = false;
      if (b.t < RT) {
        const rt = b.t / RT;
        b.ring.scaling.setAll(b.r * (0.5 + 3.2 * (1 - (1 - rt) * (1 - rt))));
        b.ring.material.alpha = 0.6 * (1 - rt);
      } else b.ring.isVisible = false;
      if (b.t >= CT && b.t >= RT) b.t = -1;
    }
    for (const e of explosions) {
      if (e.t < 0) continue;
      e.t += dt;
      // core: fast expand to EXACTLY the splash radius, hold, fade in place
      const ct = e.t;
      if (ct < CORE_T) {
        const grow = Math.min(1, ct / 0.1);
        const s = SPLASH_RADIUS * (0.35 + 0.65 * (1 - (1 - grow) * (1 - grow))); // ease-out
        e.core.scaling.setAll(s);
        e.core.material.alpha = ct < 0.32 ? 0.92 : 0.92 * (1 - (ct - 0.32) / (CORE_T - 0.32));
      } else e.core.isVisible = false;
      // ring: races out to ~12m and thins — pure spectacle, hand-tuned
      if (ct < RING_T) {
        const rt = ct / RING_T;
        e.ring.scaling.setAll(1 + 11 * (1 - (1 - rt) * (1 - rt)));
        e.ring.material.alpha = 0.55 * (1 - rt);
      } else e.ring.isVisible = false;
      // bloom: a flash of light out to ~13m, gone in a quarter second
      if (ct < BLOOM_T) {
        const bt = ct / BLOOM_T;
        e.bloom.scaling.setAll(3 + 10 * bt);
        e.bloom.material.alpha = 0.3 * (1 - bt);
      } else e.bloom.isVisible = false;
      if (ct >= CORE_T && ct >= RING_T && ct >= BLOOM_T) e.t = -1;
    }
    for (const p of puffs) {
      if (p.life > 0) {
        p.life -= dt;
        const k = 1 - p.life / p.max;
        p.mesh.position.y += p.rise * dt;
        p.mesh.scaling.setAll(p.s0 + (p.s1 - p.s0) * k);
        p.mesh.material.alpha = p.a0 * (1 - k);
        if (p.life <= 0) p.mesh.isVisible = false;
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
    fire, spawnTracer, burst, jetPuff, dmgNum, setWeapon,
    explosion, serpentPop, serpentDeath, trailPuff, puff, setRopeColor,
    /* MD 20: the viewmodel is parented to the CAMERA, so the boot flyover
       carried the gun with it — a first-person weapon floating over an
       establishing shot of the arena. Hidden for the duration of the title
       state and restored on handoff. */
    setViewmodelVisible(on) { gunRoot.setEnabled(!!on); },
    ropeTo, ropeOff, placeShadow, hideShadow,
    hitmarkFlash, hurtFlash, vig, update,
    muzzleWorld: () => muzzle.getAbsolutePosition(),
  };
}
