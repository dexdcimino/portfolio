// render/serpent.js — MD 18. Draws serpents from the snapshot and nothing else:
// this module never touches damage or length, it reads them.
//
// Segment POSITIONS are not on the wire (see sim/sim.js). Each snapshot carries
// the serpent's static path parameters, so this rebuilds the body locally with
// the same closed form the sim uses — imported from sim/serpent.js rather than
// re-derived, because two copies of a sine chain would drift the moment either
// side was tuned.

import { headAt, segAt, segRadius, SEG_COUNT, HEAD_R } from '../sim/serpent.js';

/* MD 24 item 2. MD 22 raised SEG_LAG 5→14 to restore body span after the
   serpents were slowed, and it worked — but spacing is speed x lag, so the
   spheres ended up 3.1–4.1m apart centre to centre with radii of 0.5–2.2m.
   Measured surface gaps of 3.7–6.8m: a chain of beads, not a snake.
   The fix decouples VISUAL spacing from path lag rather than undoing the lag.
   segAt(s, tick, i) is headAt(s, tick - i*SEG_LAG) and segRadius's taper is a
   power of i — both are already continuous in i, so a sphere at i = 2.33 is
   just as closed-form as one at i = 2. Drawing FILL spheres per logical
   segment therefore keeps the property that matters: a client still rebuilds
   the whole body from the tick alone, with no extra bytes on the wire.
   Logical segments are untouched — `len`, damage and popping still work in
   whole segments. These are fill, and they carry no spikes. */
/* FILL was chosen by measuring, not by taste. Worst surface gap across the
   five tiers, at the same tick and seed:
       FILL 3 → 1.67m     FILL 5 → 0.54m
       FILL 4 → 0.96m     FILL 6 → 0.27m
   from a starting point of 6.76m. 4 is where the curve flattens: the residual
   is about one tail-sphere diameter on t1 (the fastest tier, so the widest
   spacing) and under half that everywhere else. Going to 6 buys 0.7m of gap
   for another 210 meshes across five serpents, which is not a trade worth
   making without a measured GPU problem — and item 7 found none. */
const FILL = 4;                       // sub-spheres per logical segment


export function createSerpentView({ scene, mat, V3 }) {
  const views = new Map();   // serpentId → { segs[], head, jaw, barrel }

  /* MD 21 item 3: turret bolts had NO renderer. They were firing, reaching the
     snapshot and landing damage the whole time — the only thing missing was
     anything drawing them, which is why they were invisible.
     Pooled by id like rockets, and deliberately loud: a bolt is meant to be
     dodged on sight, so it is emissive, bigger than its 0.35m hit radius, and
     wears a trailing streak so it reads as travelling rather than hanging. */
  /* MD 22 item 3 — redesigned, then MEASURED and redesigned again.
     The first attempt was a white core inside a bigger translucent magenta
     shell. Sampling a real frame at 55m killed it: the sky at the altitudes
     bolts actually fly through is plum (210,101,96), and #FF1E6E against that
     is 1.02:1 — no luminance difference at all, and the same hue family into
     the bargain. Worse, the shell was LARGER than the core and alpha-blended,
     so the one element that did carry (white, 3.64:1) was being veiled by the
     one that did not. At range the whole thing read as a faint pink ring.
     What follows from that measurement:
       · WHITE does the detecting. It is the only value the plum sky and the
         sand floor cannot both supply, so it is the core and it is opaque.
       · The magenta is a GLOW, and it is ADDITIVE. Additive can only brighten
         what is behind it, so it can never wash the core out the way an
         alpha-blended shell did, and over a mid-luminance sky it lifts rather
         than matches. It carries identity (this is serpent fire, not yours);
         it is not asked to carry visibility.
       · The TAIL says which way it is going, so a glance tells you whether it
         is yours to worry about. Additive for the same reason.
     Still deliberately NOT the player accent: a threat must never wear the
     colour the player chose for themselves. */
  const coreMat = new BABYLON.StandardMaterial('boltCore', scene);
  coreMat.diffuseColor = BABYLON.Color3.FromHexString('#FFFFFF');
  coreMat.emissiveColor = BABYLON.Color3.FromHexString('#FFFFFF');
  coreMat.specularColor = BABYLON.Color3.Black();
  coreMat.disableLighting = true;
  const glowMat = new BABYLON.StandardMaterial('boltGlow', scene);
  glowMat.diffuseColor = BABYLON.Color3.Black();     // additive: diffuse would double
  glowMat.emissiveColor = BABYLON.Color3.FromHexString('#FF1E6E');
  glowMat.specularColor = BABYLON.Color3.Black();
  glowMat.disableLighting = true;
  glowMat.alphaMode = BABYLON.Engine.ALPHA_ADD;
  glowMat.alpha = 0.6;
  glowMat.backFaceCulling = false;   // both hulls add, so it thickens at the rim
  glowMat.disableDepthWrite = true;  // never occlude the core or each other
  const bolts = new Map();   // boltId → mesh
  function boltMesh() {
    // 1.25m of white for a 0.7m hit diameter. Deliberately generous: erring
    // toward "dodged something that would have missed" is the safe direction,
    // and at 60m an honest 0.7m sphere is four pixels.
    const m = BABYLON.MeshBuilder.CreateSphere('bolt', { diameter: 1.25, segments: 8 }, scene);
    m.material = coreMat; m.isPickable = false;
    const glow = BABYLON.MeshBuilder.CreateSphere('boltGlow', { diameter: 2.7, segments: 8 }, scene);
    glow.material = glowMat; glow.isPickable = false; glow.parent = m;
    const tail = BABYLON.MeshBuilder.CreateCylinder('boltTail',
      { height: 6.2, diameterTop: 0.04, diameterBottom: 1.6, tessellation: 8 }, scene);
    tail.material = glowMat; tail.isPickable = false; tail.parent = m;
    tail.rotation.x = Math.PI / 2; tail.position.z = -3.3;
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

  /* Takes the snapshot entry, not just an id. `scale` and `segs` have been on
     the wire since MD 19 and this renderer used NEITHER: segRadius was called
     without a scale, so every tier drew at 1.0 and the giant's 1.95x — the
     whole point of a boss — was invisible. The mesh pool was likewise sized
     for SEG_COUNT on every serpent, allocating 22 segments' worth for a
     7-segment t1. Both fixed here. */
  function build(id, s) {
    const scale = s?.scale ?? 1;
    const segs = s?.segs ?? SEG_COUNT;
    const spheres = (segs - 1) * FILL + 1;
    const bodyMat = mat('#3E7FC5');
    const headMat = mat('#FF3D81');
    const spikeMat = mat('#F2D6A2');
    const meshes = [], spikes = [];
    for (let n = 0; n < spheres; n++) {
      const i = n / FILL;             // fractional index into the same path
      const whole = Number.isInteger(i);
      const r = segRadius(i, scale);
      const m = BABYLON.MeshBuilder.CreateIcoSphere('serpSeg' + id + '_' + n,
        { radius: r, subdivisions: i === 0 ? 3 : (whole ? 2 : 1) }, scene);
      m.convertToFlatShadedMesh();
      m.material = i === 0 ? headMat : bodyMat;
      m.isPickable = false;
      meshes.push(m);

      /* Spikes on the BODY only — the head reads differently on purpose.
         MD 22: they were one thin 1.7r cone on top, which vanished at any
         distance and disappeared entirely when a segment happened to present
         its underside. Now 3.4r long and 1.35r wide at the base — roughly
         double each way — and THREE of them ringed around the segment, so
         there is always a spike in silhouette whatever angle you see it from. */
      // Spikes ride the LOGICAL segments only. Putting them on the fill would
      // triple a count MD 22 already tripled, for no readability gain.
      if (whole && i > 0) {
        for (let k = 0; k < 3; k++) {
          const sp = BABYLON.MeshBuilder.CreateCylinder('serpSpk' + id + '_' + i + '_' + k,
            { height: r * 3.4, diameterTop: 0, diameterBottom: r * 1.35, tessellation: 5 }, scene);
          sp.material = spikeMat; sp.isPickable = false; sp.parent = m;
          const ang = (k / 3) * Math.PI * 2 + (i % 2) * 0.5;
          sp.position = V3(Math.sin(ang) * r * 0.75, Math.cos(ang) * r * 0.75, 0);
          sp.rotation.z = -ang;
          spikes.push(sp);
        }
      }
    }
    /* The head has to be identifiable at 30m, so it is not just a bigger
       sphere: a forward jaw wedge and a turret barrel give it a silhouette
       that reads as "front" from any angle. */
    const HR = HEAD_R * scale;
    const jaw = BABYLON.MeshBuilder.CreateCylinder('serpJaw' + id,
      { height: HR * 1.5, diameterTop: 0, diameterBottom: HR * 1.5, tessellation: 4 }, scene);
    jaw.material = headMat; jaw.isPickable = false; jaw.parent = meshes[0];
    jaw.rotation.x = Math.PI / 2; jaw.position = V3(0, 0, HR * 0.85);
    const barrel = BABYLON.MeshBuilder.CreateCylinder('serpGun' + id,
      { height: HR * 1.8, diameter: HR * 0.34, tessellation: 8 }, scene);
    barrel.material = spikeMat; barrel.isPickable = false; barrel.parent = meshes[0];
    barrel.rotation.x = Math.PI / 2; barrel.position = V3(0, HR * 0.5, HR * 0.7);

    const v = { segs: meshes, spikes, jaw, barrel, spheres };
    views.set(id, v);
    return v;
  }

  // `tick` is the snapshot's tick. MD 21 removed the armour bubbles with the
  // armour mechanic, so there is no longer any local animation state here.
  function sync(serpents, tick, boltList) {
    const live = new Set();
    for (const s of serpents || []) {
      live.add(s.id);
      const v = views.get(s.id) || build(s.id, s);
      for (let n = 0; n < v.spheres; n++) {
        const i = n / FILL;
        // A fill sphere is only drawn if the logical segment it sits inside is
        // alive — the body still ends exactly where `len` says it does.
        const on = i <= s.len - 1;
        v.segs[n].isVisible = on;
        if (!on) continue;
        const c = segAt(s.path, tick, i);
        v.segs[n].position.set(c.x, c.y, c.z);
        // Face the direction of travel: toward where this sphere will be.
        const ahead = segAt(s.path, tick + 4, i);
        v.segs[n].lookAt(new BABYLON.Vector3(ahead.x, ahead.y, ahead.z));
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
