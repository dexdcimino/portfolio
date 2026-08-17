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

import { SYSTEM, PLANETS } from '../tune.js';
import { paletteOf } from './materials.js';

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
      // Its own brightest band, warmed toward its fog, so the tint identifies
      // the world rather than just being "a colour".
      tint: [
        COL.peak[0] * 0.55 + COL.fogSun[0] * 0.45,
        COL.peak[1] * 0.55 + COL.fogSun[1] * 0.45,
        COL.peak[2] * 0.55 + COL.fogSun[2] * 0.45,
      ],
    });
  }
  return out;
}

export class Discs {
  constructor(scene, planet) {
    this.planet = planet;
    this.list = neighbours(planet);
    this.mesh = null;
    if (!this.list.length) return;

    // How far in front of the camera the billboards sit. Well inside the far
    // plane, and the quad is sized against this distance so the angular size
    // does not depend on it.
    this.K = planet.farPlane * SYSTEM.distance;

    const n = this.list.length;
    const pos = new Float32Array(n * 4 * 3);
    const quad = new Float32Array(n * 4 * 2);
    const col = new Float32Array(n * 4 * 4);
    const idx = [];
    const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

    for (let i = 0; i < n; i++) {
      const d = this.list[i];
      // The quad is padded out around the disc so the glow has somewhere to
      // live, and never allowed below a few pixels' worth of angle: a
      // sub-pixel quad is what shimmers, and the disc inside it stays honest
      // because the shader is told what fraction of the quad it fills.
      d.quadAngle = Math.max(d.angle * SYSTEM.pad, SYSTEM.minAngle);
      d.half = this.K * Math.tan(d.quadAngle);
      d.core = d.angle / d.quadAngle;
      for (let c = 0; c < 4; c++) {
        const v = i * 4 + c;
        quad[v * 2] = CORNERS[c][0];
        quad[v * 2 + 1] = CORNERS[c][1];
        col[v * 4] = d.tint[0];
        col[v * 4 + 1] = d.tint[1];
        col[v * 4 + 2] = d.tint[2];
        col[v * 4 + 3] = d.core;
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

    const mat = new BABYLON.ShaderMaterial('svDisc', scene,
      { vertex: 'svDisc', fragment: 'svDisc' },
      {
        attributes: ['position', 'quad', 'color'],
        uniforms: ['worldViewProjection', 'uLight', 'uRight', 'uUp', 'uFwd', 'uGlow'],
        needAlphaBlending: true,
      });
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mat.setFloat('uGlow', SYSTEM.glow);

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
    this.right = new BABYLON.Vector3();
    this.up = new BABYLON.Vector3();
    this.fwd = new BABYLON.Vector3();
  }

  /** Rebuild the billboards for this frame's camera. */
  update(camera, light) {
    if (!this.mesh) return;
    const m = camera.getWorldMatrix();
    // Columns of the camera's world matrix: its own right, up and forward.
    this.right.set(m.m[0], m.m[1], m.m[2]);
    this.up.set(m.m[4], m.m[5], m.m[6]);
    this.fwd.set(m.m[8], m.m[9], m.m[10]);
    const r = this.right, u = this.up;

    const p = this.pos;
    for (let i = 0; i < this.list.length; i++) {
      const d = this.list[i];
      // Centre of the billboard, as an offset from the camera. The mesh sits at
      // the camera, so these stay small however far apart the worlds are.
      const cx = d.dir.x * this.K, cy = d.dir.y * this.K, cz = d.dir.z * this.K;
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
    this.mesh.position.copyFrom(camera.position);
    this.mat.setVector3('uRight', r);
    this.mat.setVector3('uUp', u);
    this.mat.setVector3('uFwd', this.fwd);
    if (light) this.mat.setVector3('uLight', light);
  }

  dispose() { if (this.mesh) this.mesh.dispose(); }
}
