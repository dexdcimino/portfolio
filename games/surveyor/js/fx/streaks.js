// Velocity lines: the only thing outside the craft that can show speed.
//
// Between worlds there is nothing to move past. The terrain is 300km behind
// you, the discs are effectively at infinity, and the fog has nothing to grade.
// So the reference has to be manufactured: short segments in a box around the
// camera, scrolling along the travel axis and stretching with speed.
//
// The whole field is placed in the vertex shader from a per-streak seed — see
// svStreak in materials.js — so this costs one draw call and four uniforms a
// frame, and nothing on the CPU. That matters here specifically, because this
// is the one moment in the game where the frame is already doing the most work.
//
// Everything is scaled by craft.hyperT, which is symmetric about the midpoint
// of a journey, so the streaks wind down on approach exactly as they wound up
// on departure. There is no "off" to forget: at hyperT 0 the mesh is disabled.

import { ATMO, COLORS } from '../tune.js';
import { ensureShaders, paletteOf } from '../world/materials.js';

export class Streaks {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.phase = 0;
    if (!ATMO.streaks) return;
    ensureShaders();

    const n = ATMO.streakCount;
    const seed = new Float32Array(n * 4 * 3);
    const corner = new Float32Array(n * 4 * 2);
    const pos = new Float32Array(n * 4 * 3);      // unused, but Babylon wants it
    const idx = [];
    // Deterministic: a fixed lattice with an irrational stride, so the field
    // has no visible pattern and no reliance on Math.random at load.
    for (let i = 0; i < n; i++) {
      const a = (i * 0.7548776662) % 1;
      const b = (i * 0.5698402909) % 1;
      const c = (i * 0.3819660112) % 1;
      const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let k = 0; k < 4; k++) {
        const v = i * 4 + k;
        seed[v * 3] = a; seed[v * 3 + 1] = b; seed[v * 3 + 2] = c;
        corner[v * 2] = CORNERS[k][0];
        corner[v * 2 + 1] = CORNERS[k][1];
      }
      const base = i * 4;
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }

    const mesh = new BABYLON.Mesh('streaks', scene);
    const vd = new BABYLON.VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.applyToMesh(mesh, false);
    mesh.setVerticesData('seed', seed, false, 3);
    mesh.setVerticesData('corner', corner, false, 2);

    const mat = new BABYLON.ShaderMaterial('svStreak', scene,
      { vertex: 'svStreak', fragment: 'svStreak' },
      {
        attributes: ['seed', 'corner'],
        uniforms: ['viewProjection', 'uCam', 'uDir', 'uRight', 'uUp', 'uBox',
          'uPhase', 'uLen', 'uWidth', 'uColor', 'uAlpha'],
        needAlphaBlending: true,
      });
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mat.setVector3('uColor', new BABYLON.Vector3(
      COLORS.coast[0], COLORS.coast[1], COLORS.coast[2]));

    mesh.material = mat;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    // With the sky and the discs: drawn before the world, never depth-sorted
    // against it. Out here there is no world in front of them anyway.
    mesh.renderingGroupId = 0;
    mesh.setEnabled(false);

    this.mesh = mesh;
    this.mat = mat;
    this.right = new BABYLON.Vector3();
    this.up = new BABYLON.Vector3();
    this.dir = new BABYLON.Vector3();
  }

  /** Tint them with the world being left, so departure reads as leaving IT. */
  setPalette(planet) {
    if (!this.mat) return;
    const c = paletteOf(planet).coast;
    this.mat.setVector3('uColor', new BABYLON.Vector3(c[0], c[1], c[2]));
  }

  update(dt, craft, camera) {
    if (!this.mesh) return;
    const t = craft.hyper ? craft.hyperT : 0;
    // Below the threshold there is nothing to see and nothing to draw: at
    // walking-pace-relative-to-a-planet the streaks would read as dirt.
    const on = t > ATMO.streakFrom;
    if (this.mesh.isEnabled() !== on) this.mesh.setEnabled(on);
    if (!on) return;

    const k = (t - ATMO.streakFrom) / (1 - ATMO.streakFrom);
    const d = craft.hyper.dir;
    this.dir.set(d.x, d.y, d.z);
    // A basis across the travel axis. The camera's own right/up would swing the
    // whole field whenever the camera settled, which reads as the streaks
    // sliding sideways rather than the craft moving forward.
    const ax = Math.abs(d.x) <= Math.abs(d.y) && Math.abs(d.x) <= Math.abs(d.z) ? 1 : 0;
    const ay = ax === 0 && Math.abs(d.y) <= Math.abs(d.z) ? 1 : 0;
    const az = ax === 0 && ay === 0 ? 1 : 0;
    let rx = ay * d.z - az * d.y, ry = az * d.x - ax * d.z, rz = ax * d.y - ay * d.x;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    this.right.set(rx, ry, rz);
    this.up.set(
      d.y * rz - d.z * ry,
      d.z * rx - d.x * rz,
      d.x * ry - d.y * rx);

    // The scroll rate is capped well below the real speed — at a million metres
    // a second the field would strobe rather than stream. What sells the speed
    // is the LENGTH of the streaks, which is why that is the term that runs.
    this.phase = (this.phase + dt * (0.35 + k * 5.5)) % 1;

    const box = ATMO.streakBox;
    this.mat.setVector3('uCam', camera.position);
    this.mat.setVector3('uDir', this.dir);
    this.mat.setVector3('uRight', this.right);
    this.mat.setVector3('uUp', this.up);
    this.mat.setFloat('uBox', box);
    this.mat.setFloat('uPhase', this.phase);
    this.mat.setFloat('uLen', box * ATMO.streakLen * (0.05 + k * 0.95));
    this.mat.setFloat('uWidth', 0.35 + k * 1.1);
    this.mat.setFloat('uAlpha', k * 0.85);
  }

  dispose() { if (this.mesh) this.mesh.dispose(); }
}
