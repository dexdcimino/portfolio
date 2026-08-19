// The other five worlds, in the sky.
//
// Standing anywhere on any planet you can see the rest of the system as small
// bright discs, each tinted by its own palette, so a world is identifiable
// before you have ever been there. They are scenery in this phase — travel is
// not wired — but the geometry is honest: angular size is radius over distance,
// and the distances in SYSTEM.at are hundreds of kilometres, so Anvil is a hair
// wider than a full moon and Ember is a bright point. Small is correct.
//
// Three things this file is careful about.
//
// 1. CAMERA-RELATIVE. The quads are rebuilt every frame as offsets from the
//    camera, with the mesh itself parked at the camera position. A 300km
//    separation expressed in raw world coordinates is exactly the kind of
//    number that arrives at the GPU as float32 and comes back as a shimmer.
//
// 2. NO DEPTH ARGUMENT WITH THE TERRAIN. Rendering group 0 with depth writes
//    off, like the sky dome: they are drawn before the world and the world
//    draws over them. Nothing z-fights, and a hillside hides them because it is
//    painted afterwards, not because a depth test happened to win.
//
// 3. NO FOG. They are outside the atmosphere by definition, so the fog uniforms
//    are simply not wired to this shader.

import { SYSTEM, SPACE, PLANETS } from '../tune.js';
import { paletteOf, skyOf } from './materials.js';
import { previews } from './preview.js';
import { farDistance, farScale } from './space.js';
import { farBodyMesh } from './farbody.js';
import { makePlanet } from './sphere.js';

/**
 * Direction and angular radius of every other world, from this one.
 *
 * Positions are in kilometres in one shared frame, and the direction is used
 * unchanged as a direction in planet space — which is the same frame the sun
 * lives in, so the phase on the disc agrees with the light on the ground.
 */
export function neighbours(planet) {
  const self = SYSTEM.at[planet.key];
  if (!self) return [];
  const out = [];
  for (const [key, p] of Object.entries(SYSTEM.at)) {
    if (key === planet.key || !PLANETS[key]) continue;
    const dx = (p[0] - self[0]) * 1000;
    const dy = (p[1] - self[1]) * 1000;
    const dz = (p[2] - self[2]) * 1000;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1) continue;
    const other = PLANETS[key];
    const COL = paletteOf(other);
    out.push({
      key,
      dir: { x: dx / dist, y: dy / dist, z: dz / dist },
      dist,
      // Honest: the half-angle a sphere of this radius subtends at this range.
      angle: Math.atan2(other.radius, dist),
      /* Its own sun, not this world's. Each planet states a fixed sunDir in
         planet space, so the crescent on the disc is the one you will actually
         find when you land there — and six worlds do not all show the same
         phase from the same sky. */
      sun: (() => {
        const v = skyOf(other).sunDir;
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return { x: v[0] / l, y: v[1] / l, z: v[2] / l };
      })(),
      // Its own toon sheen. 0 on five worlds; on Vault it is what says ice
      // rather than pale rock, both on the ground and from three hundred km up.
      spec: COL.spec || 0,
      // Its own brightest band, warmed toward its fog. The surface map carries
      // the identification now; this is what colours the halo around it.
      tint: [
        COL.peak[0] * 0.55 + COL.fogSun[0] * 0.45,
        COL.peak[1] * 0.55 + COL.fogSun[1] * 0.45,
        COL.peak[2] * 0.55 + COL.fogSun[2] * 0.45,
      ],
    });
  }
  return out;
}

/**
 * One disc's drawn geometry, from its true distance.
 *
 * SEPARATE FROM THE CONSTRUCTOR because it is no longer a build-time decision.
 * A world you are flying toward changes distance every frame, and its drawn
 * size, its quad, its compressed placement and the LOD it is due all follow
 * from that one number. Pulling it out means the approach and the initial
 * build derive them the same way — and it means dev/lodcheck.mjs can walk a
 * body through the promotion boundary using the real function rather than a
 * restatement of it, which is the mistake that has cost this project three
 * wrong measurements.
 */
export function sizeDisc(planet, d) {
  const soft = SYSTEM.drawRef * Math.pow(d.angle / SYSTEM.drawRef, SYSTEM.drawExp);
  d.drawAngle = Math.max(d.angle, soft, SYSTEM.drawFloor);
  d.quadAngle = Math.max(d.drawAngle * SYSTEM.pad, SYSTEM.minAngle);
  // Its own compressed distance, not a shared shell.
  d.K = farDistance(planet, d.dist);
  d.half = d.K * Math.tan(d.quadAngle);
  d.core = d.drawAngle / d.quadAngle;
  return d;
}

/**
 * Move a body to a new true distance and re-derive everything.
 *
 * The honest half-angle is radius over distance; everything else follows from
 * sizeDisc. Used by the approach and by the LOD harness.
 */
export function setDistance(planet, d, radius, dist) {
  d.dist = dist;
  d.angle = Math.atan2(radius, dist);
  return sizeDisc(planet, d);
}

export class Discs {
  constructor(scene, planet) {
    this.planet = planet;
    this.list = neighbours(planet);
    this.mesh = null;
    if (!this.list.length) return;

    /* THE FAR BAND. Every disc used to sit on ONE SHELL at a fixed fraction of
       the far plane, with its quad sized against that shared distance so the
       angular size came out right. That is fine for painted coins and wrong for
       anything you are going to fly toward: on one shell there is no depth
       order between worlds, no parallax as you move, and nowhere for a body to
       come from as it grows.

       Each disc now sits at its OWN true distance compressed by k — see
       js/world/space.js. Two things are unchanged by construction and that is
       the whole point of the map: the DIRECTION is untouched, so a disc
       projects to exactly the same pixel it did before, and the quad is still
       sized against whatever distance it ends up at, so the drawn angular size
       is exactly what SYSTEM.drawRef/drawExp/drawFloor decided. What changes is
       that the number is now honest about which world is in front. */
    this.k = farScale(planet);

    // The baked surface maps. One atlas for the whole session — see preview.js.
    this.maps = previews(scene);

    const n = this.list.length;
    const pos = new Float32Array(n * 4 * 3);
    const quad = new Float32Array(n * 4 * 2);
    const col = new Float32Array(n * 4 * 4);
    const dirs = new Float32Array(n * 4 * 3);
    const suns = new Float32Array(n * 4 * 3);
    const slots = new Float32Array(n * 4);
    const specs = new Float32Array(n * 4);
    // 1 until the far band starts promoting this world. See svDisc.
    const fade = new Float32Array(n * 4).fill(1);
    const idx = [];
    const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

    for (let i = 0; i < n; i++) {
      const d = this.list[i];
      /* The drawn radius, then the quad around it.
         `angle` stays the honest half-angle and is never overwritten — the
         survey overlay and anything else that wants the truth reads it. What
         gets rasterised is `drawAngle`, the same number compressed toward a
         readable band by SYSTEM.drawRef/drawExp/drawFloor, because the honest
         disc is between a third of a pixel and five pixels across and the small
         end of that does not survive the resolve. Never smaller than honest, so
         the compression only ever pulls up.

         The quad is then padded out around the drawn disc so the glow has
         somewhere to live, and still floored at minAngle — which no longer
         binds at this drawFloor, and is left in as the guard it was for anyone
         who lowers the floor. */
      sizeDisc(planet, d);
      for (let c = 0; c < 4; c++) {
        const v = i * 4 + c;
        quad[v * 2] = CORNERS[c][0];
        quad[v * 2 + 1] = CORNERS[c][1];
        col[v * 4] = d.tint[0];
        col[v * 4 + 1] = d.tint[1];
        col[v * 4 + 2] = d.tint[2];
        col[v * 4 + 3] = d.core;
        // Per-disc, not per-frame: the worlds do not move and neither do their
        // suns, so all three ride the vertex buffer and cost one upload.
        dirs[v * 3] = d.dir.x; dirs[v * 3 + 1] = d.dir.y; dirs[v * 3 + 2] = d.dir.z;
        suns[v * 3] = d.sun.x; suns[v * 3 + 1] = d.sun.y; suns[v * 3 + 2] = d.sun.z;
        slots[v] = this.maps ? this.maps.slot[d.key] : 0;
        specs[v] = d.spec;
      }
      // Clockwise, matching everything else in this game.
      const b = i * 4;
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }

    const mesh = new BABYLON.Mesh('discs', scene);
    const vd = new BABYLON.VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.applyToMesh(mesh, true);            // updatable: rebuilt every frame
    mesh.setVerticesData('quad', quad, false, 2);
    mesh.setVerticesData('color', col, false, 4);
    mesh.setVerticesData('dir', dirs, false, 3);
    mesh.setVerticesData('sun', suns, false, 3);
    mesh.setVerticesData('slot', slots, false, 1);
    mesh.setVerticesData('spec', specs, false, 1);
    mesh.setVerticesData('fade', fade, false, 1);

    const mat = new BABYLON.ShaderMaterial('svDisc', scene,
      { vertex: 'svDisc', fragment: 'svDisc' },
      {
        attributes: ['position', 'quad', 'color', 'dir', 'sun', 'slot', 'spec', 'fade'],
        uniforms: ['worldViewProjection', 'uRight', 'uUp',
                   'uGlow', 'uLimb', 'uDisc', 'uNight', 'uEmit', 'uRows'],
        samplers: ['uMap'],
        needAlphaBlending: true,
      });
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mat.setFloat('uGlow', SYSTEM.glow);
    mat.setFloat('uLimb', SYSTEM.limb);
    mat.setFloat('uDisc', SYSTEM.disc);
    mat.setFloat('uNight', SYSTEM.night);
    mat.setFloat('uEmit', SYSTEM.emitBoost);
    if (this.maps) {
      mat.setTexture('uMap', this.maps.texture);
      mat.setFloat('uRows', this.maps.rows);
    }

    mesh.material = mat;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.infiniteDistance = false;
    // Group 0 is the sky's group. Opaque first, blended after, so these land on
    // top of the dome and under everything in group 1.
    mesh.renderingGroupId = 0;

    this.mesh = mesh;
    this.mat = mat;
    this.pos = pos;
    this.col = col;
    this.fade = fade;
    this.scene = scene;
    /* Promoted bodies, built lazily and kept. A world is promoted when its
       DRAWN half-angle passes SPACE.promoteAngle, which on the way in happens
       once and on the way out happens once — so this map holds at most the
       handful of worlds you have actually approached this session. */
    this.bodies = new Map();
    this.promoted = new Set();
    // Last core written per disc, so the colour buffer is only re-uploaded
    // when the fade actually moves rather than every frame.
    this.fadeNow = this.list.map(() => 1);
    this.right = new BABYLON.Vector3();
    this.up = new BABYLON.Vector3();
  }

  /** Rebuild the billboards for this frame's camera. */
  update(camera) {
    if (!this.mesh) return;
    const m = camera.getWorldMatrix();
    // Columns of the camera's world matrix: its own right and up. Forward is
    // no longer wanted — the shader builds each sphere around that world's own
    // direction, not around wherever the camera happens to be pointing.
    this.right.set(m.m[0], m.m[1], m.m[2]);
    this.up.set(m.m[4], m.m[5], m.m[6]);
    const r = this.right, u = this.up;

    const p = this.pos;
    for (let i = 0; i < this.list.length; i++) {
      const d = this.list[i];
      // Centre of the billboard, as an offset from the camera. The mesh sits at
      // the camera, so these stay small however far apart the worlds are.
      const cx = d.dir.x * d.K, cy = d.dir.y * d.K, cz = d.dir.z * d.K;
      const h = d.half;
      const sx = [-1, 1, 1, -1], sy = [-1, -1, 1, 1];
      for (let c = 0; c < 4; c++) {
        const v = (i * 4 + c) * 3;
        p[v] = cx + (r.x * sx[c] + u.x * sy[c]) * h;
        p[v + 1] = cy + (r.y * sx[c] + u.y * sy[c]) * h;
        p[v + 2] = cz + (r.z * sx[c] + u.z * sy[c]) * h;
      }
    }
    this.mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, p);
    this.promote(camera);
    this.mesh.position.copyFrom(camera.position);
    /* Only the camera's orientation goes up now. The sun does not: each disc
       carries its OWN world's sun on the vertex buffer, because the light on
       Vault is not the light here. */
    this.mat.setVector3('uRight', r);
    this.mat.setVector3('uUp', u);
  }

  /**
   * Show or hide everything this disc set owns, promoted bodies included.
   *
   * THE BODIES ARE THE NEW WAY TO LEAK A WORLD. World.setActive hid the sky
   * dome, the water shell and the disc mesh, which was the complete list until
   * a promoted body became a fourth thing with its own mesh and its own
   * lifetime. A world you fly away from would have left its bodies in the sky —
   * which is the six-sky-domes bug exactly, and it took three sessions to find
   * the first time. dev/run.mjs asserts this rather than trusting it.
   */
  setEnabled(on) {
    if (this.mesh) this.mesh.setEnabled(on);
    for (const b of this.bodies.values()) {
      // A hidden world shows nothing; a visible one shows what it had promoted.
      b.mesh.setEnabled(on && this.promoted.has(b.key));
    }
  }

  dispose() {
    if (this.mesh) this.mesh.dispose();
    for (const b of this.bodies.values()) b.mesh.dispose();
    this.bodies.clear();
    this.promoted.clear();
  }
}

/* ---- promotion ---------------------------------------------------------- */

Discs.prototype.promote = function promote(camera) {
  let changed = false;
  for (let i = 0; i < this.list.length; i++) {
    const d = this.list[i];
    /* HOW FAR THROUGH THE HANDOFF THIS BODY IS, 0 to 1. The sphere fades in
       across the band and the billboard's disc fades out across the same one,
       so at any instant the two together carry a full body. */
    const lo = SPACE.promoteAngle * (1 - SPACE.fadeBand);
    const hi = SPACE.promoteAngle * (1 + SPACE.fadeBand);
    const t = Math.max(0, Math.min(1, (d.drawAngle - lo) / Math.max(hi - lo, 1e-9)));
    const want = t > 0;
    const had = this.promoted.has(d.key);

    if (want && !this.bodies.has(d.key)) {
      /* Built on the frame it is first needed, which is a stall of a few
         milliseconds ONCE per world per session. Building all five up front
         would be 35ms at boot for four bodies nobody is looking at, and
         building per frame would be absurd. */
      const P = PLANETS[d.key] && makePlanet(PLANETS[d.key]);
      if (P) {
        const b = farBodyMesh(this.scene, P, SPACE.bodySubdiv, this.maps,
          this.maps ? this.maps.slot[d.key] : 0);
        b.mat.setVector3('uSun', new BABYLON.Vector3(d.sun.x, d.sun.y, d.sun.z));
        b.mat.setVector3('uTint', new BABYLON.Vector3(d.tint[0], d.tint[1], d.tint[2]));
        b.mat.setFloat('uDisc', SYSTEM.disc);
        b.mat.setFloat('uNight', SYSTEM.night);
        b.mat.setFloat('uEmit', SYSTEM.emitBoost);
        b.mat.setFloat('uLimb', SYSTEM.limb);
        b.mat.setFloat('uSpec', d.spec);
        b.mat.setFloat('uFade', 1);
        b.key = d.key;
        this.bodies.set(d.key, b);
      }
    }

    const b = this.bodies.get(d.key);
    if (b) {
      b.mesh.setEnabled(want);
      if (want) {
        /* Placed a whisker BEHIND the billboard, not in front of it, and the
           difference is most of what made the handoff visible.

           The billboard is one draw: a solid disc AND a halo around and over
           it, and the halo adds brightness across the body as well as outside
           it. Promotion drops the disc and keeps the halo. Put the sphere in
           FRONT and it writes depth, the halo over the body fails the depth
           test, and the body loses that light — measured at 22% to 55% darker
           across the boundary, on a swap whose SIZE was continuous to 1%.
           Behind, the halo composites over the sphere exactly as it did over
           the quad, and nothing z-fights because the billboard never writes
           depth. */
        const at = d.K * 1.02;
        b.mesh.position.set(
          camera.position.x + d.dir.x * at,
          camera.position.y + d.dir.y * at,
          camera.position.z + d.dir.z * at);
        // Scaled so its surface subtends exactly the angle the billboard did.
        const r = at * Math.tan(d.drawAngle);
        b.mesh.scaling.set(r, r, r);
        b.mat.setVector3('uCam', camera.position);
        b.mat.setFloat('uFade', t);
      }
    }

    /* THE BILLBOARD FADES; IT DOES NOT SHRINK. The first cut ramped `core`,
       which is the fraction of the quad the solid disc fills — so the disc got
       SMALLER rather than fainter, leaving a bright dot over a full-size sphere
       and a measured brightness that bumped up by 60% in the middle of the band
       instead of stepping at its edge. `fade` multiplies the body's colour and
       its alpha, and never the halo. */
    const f = 1 - t;
    if (Math.abs(f - (this.fadeNow[i] || 0)) > 1e-4) {
      this.fadeNow[i] = f;
      changed = true;
      for (let c = 0; c < 4; c++) this.fade[i * 4 + c] = f;
    }
    if (want !== had) {
      if (want) this.promoted.add(d.key); else this.promoted.delete(d.key);
      /* THE BILLBOARD KEEPS ITS HALO AND LOSES ITS BODY. `core` is the fraction
         of the quad the solid disc fills, and the shader reads it off the
         vertex colour alpha; at zero the body vanishes and pow(1 - r, 3.2)
         glow around it does not. That is what makes the handoff hard to see:
         the thing that disappears is exactly the thing the sphere replaces,
         and the atmosphere it sat in carries straight through. */
      for (let c = 0; c < 4; c++) this.col[(i * 4 + c) * 4 + 3] = d.core;
    }
  }
  if (changed) this.mesh.setVerticesData('fade', this.fade, false, 1);
};
