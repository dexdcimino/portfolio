// One water shell: a cube-sphere at sea level, built once.
//
// The mechanism that mattered on the flat world is kept exactly — a per-vertex
// `depth` attribute filled from `height()` on the CPU, which is what drives the
// banded bathymetry and the foam line without a depth pre-pass. What changed is
// that it no longer needs refilling: on a *finite* world the depth field is a
// property of the planet, not of where you are standing, so the snapped plane
// and its 1.2ms-every-60m refill collapse into one fill at construction.
//
// Vertices are in planet-centred coordinates with the mesh at the origin, so
// the shader can take the local up straight from normalize(position).

import { height } from './noise.js';
import { faceDir } from './sphere.js';
import { ICE, WORLD } from '../tune.js';

const D = { x: 0, y: 0, z: 0 };

const sstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Metres of ice over water this deep. 0 on every world but Vault.
 *
 * Thickness falls off with depth, which is the physical way round — a shallow
 * margin freezes solid, the deep middle of a lake freezes last and thinnest —
 * and it is also the only way round that produces a hazard, because thin ice has
 * to sit over water deep enough to swamp a hull or breaking through is a
 * non-event. The melt line is wherever this crosses ICE.support.
 */
export function iceAt(planet, depth) {
  if (!(planet.iceThickness > 0)) return 0;
  return planet.iceThickness *
    (1 - sstep(planet.iceMeltFrom, planet.iceMeltTo, depth));
}

/** Does the ice here hold the rover up? */
export function iceHolds(planet, depth) {
  return iceAt(planet, depth) >= ICE.support;
}

/**
 * The height a wheel actually rests at: the ice where the ice holds, the ground
 * everywhere else. Per contact patch, so driving off the edge of a frozen lake
 * tips the rover over the lip rather than dropping it a metre in one frame.
 */
export function iceRide(planet, ground) {
  const depth = WORLD.waterY - ground;
  return depth > 0.35 && iceHolds(planet, depth) ? WORLD.waterY : ground;
}

/**
 * The depth at which the ice stops holding, in metres. 0 on unfrozen worlds.
 *
 * Bisected rather than algebraically inverted because the falloff is a
 * smoothstep, and this runs once per planet at boot. The shader strokes a line
 * on the ice at exactly this depth, which is how the hazard becomes something
 * you read off the surface instead of something that just happens to you.
 */
export function meltDepth(planet) {
  if (!(planet.iceThickness > 0)) return 0;
  let lo = 0, hi = planet.iceMeltTo;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) * 0.5;
    if (iceHolds(planet, mid)) lo = mid; else hi = mid;
  }
  return (lo + hi) * 0.5;
}

export class Water {
  constructor(scene, material, planet) {
    this.planet = planet;
    const res = planet.waterFaceRes;
    const R = planet.surfaceR;

    const pos = [];
    const depth = [];
    const idx = [];

    for (let f = 0; f < 6; f++) {
      const base = pos.length / 3;
      for (let j = 0; j <= res; j++) {
        for (let i = 0; i <= res; i++) {
          const u = -1 + (2 * i) / res;
          const v = -1 + (2 * j) / res;
          faceDir(f, u, v, D);
          pos.push(D.x * R, D.y * R, D.z * R);
          depth.push(Math.max(0, -height(D, planet)));
        }
      }
      // Wound to match the terrain: Babylon's front face is the clockwise one.
      for (let j = 0; j < res; j++) {
        for (let i = 0; i < res; i++) {
          const a = base + j * (res + 1) + i;
          const b = a + 1;
          const c = a + res + 2;
          const d = a + res + 1;
          idx.push(a, d, c, a, c, b);
        }
      }
    }

    const mesh = new BABYLON.Mesh('water', scene);
    const vd = new BABYLON.VertexData();
    vd.positions = pos;
    vd.indices = idx;
    // Outward normals are just the direction; the shader perturbs them anyway.
    const nrm = new Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      const l = Math.hypot(pos[i], pos[i + 1], pos[i + 2]) || 1;
      nrm[i] = pos[i] / l; nrm[i + 1] = pos[i + 1] / l; nrm[i + 2] = pos[i + 2] / l;
    }
    vd.normals = nrm;
    vd.applyToMesh(mesh, false);
    mesh.setVerticesData('depth', depth, false, 1);

    mesh.material = material;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.renderingGroupId = 1;
    mesh.position.set(0, 0, 0);

    this.mesh = mesh;
    this.count = depth.length;
    this.depth = depth;
    this.tris = idx.length / 3;
  }

  /** Nothing to do. Kept so the call site reads the same as it always did. */
  update() {}

  dispose() { this.mesh.dispose(); }
}
