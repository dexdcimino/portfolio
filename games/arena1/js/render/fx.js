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
    explosion, trailPuff, puff, setRopeColor,
    ropeTo, ropeOff, placeShadow, hideShadow,
    hitmarkFlash, hurtFlash, vig, update,
    muzzleWorld: () => muzzle.getAbsolutePosition(),
  };
}
