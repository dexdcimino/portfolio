// The far band: how a body three hundred kilometres away gets drawn at all.
//
// THE PROBLEM, and it is not "make the far plane bigger".
//
//   DEPTH RANGE. The near plane is 0.4m and the worlds are up to 944km apart.
//   That is a range of two and a half million to one, and no conventional depth
//   buffer holds it — a 24-bit buffer spread over that puts the entire surface
//   of a planet inside one depth value.
//
//   FLOAT32. Positions in JavaScript are doubles and 944km is nothing to them.
//   Vertices reach the GPU as float32, which has about seven significant
//   digits: at 400km, one unit in the last place is roughly 30 millimetres, and
//   a vertex that should be still shimmers by that much every frame as the
//   camera moves and the exponent flips.
//
// THE SOLUTION IS TO COMPRESS THE PICTURE, NOT THE PHYSICS.
//
// A body at true distance D with radius R is drawn at D*k and R*k. Its angular
// size is atan(R/D) either way — the k cancels — so the image is identical and
// the numbers reaching the GPU are small. Depth order between far bodies
// survives, and so does parallax, because a uniform scale about the camera is a
// similarity transform: every angle in the picture is preserved exactly.
//
// What does NOT go through here: SYSTEM.at, the travel integrator, the speed
// law, the approach spheres and the analytic sweep. Those stay in doubles at
// true scale, so the speed readout is not a lie and the collision test still
// catches a 414m planet at a million metres a second. This module is a
// rendering transform and nothing else.
//
// WHY k IS PER WORLD. The far band has to land inside the camera's far plane,
// and that plane is per world: Ember's is 828m and Anvil's is 8288m, a factor
// of ten. One global k would put the system comfortably inside Anvil's frustum
// and a kilometre outside Ember's. So k is derived from the world you are
// standing on and the true extent of the system, which is what makes the same
// picture appear on a world a tenth the size.

import { SYSTEM, SPACE, PLANETS } from '../tune.js';

/**
 * The widest true separation between any two worlds, in metres.
 *
 * Computed once. It is the number the compression is scaled against, so that
 * the most distant thing you can ever look at still lands inside the frustum.
 */
let widest = 0;
export function systemExtent() {
  if (widest) return widest;
  const keys = Object.keys(SYSTEM.at).filter((k) => PLANETS[k]);
  for (const a of keys) {
    for (const b of keys) {
      if (a === b) continue;
      const p = SYSTEM.at[a], q = SYSTEM.at[b];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 1000;
      if (d > widest) widest = d;
    }
  }
  return widest;
}

/**
 * The far band's compression for the world you are standing on.
 *
 * Chosen so the widest separation in the system lands at SPACE.fill of this
 * world's far plane. Everything nearer lands proportionally nearer, which is
 * the whole point: the band keeps its own depth order.
 */
export function farScale(planet) {
  return (SPACE.fill * planet.farPlane) / systemExtent();
}

/**
 * Where a far body is drawn, as a distance from the camera in metres.
 *
 * `dist` is the true separation. The direction is unchanged — a point along a
 * ray projects to the same pixel whatever its distance, which is why moving a
 * body along this map cannot shift it on screen.
 */
export function farDistance(planet, dist) {
  return Math.max(SPACE.minDraw, dist * farScale(planet));
}

/**
 * THE INVARIANT, as a function, so the suite can assert on the real one.
 *
 * The half-angle a body of radius R subtends at distance D, and the half-angle
 * its compressed image subtends at D*k with radius R*k. These must agree to the
 * last bit the arithmetic allows: if they do not, the far band is a different
 * picture rather than the same picture drawn closer, and every phase built on
 * top of it inherits the error.
 */
export function angularHalf(radius, dist) {
  return Math.atan2(radius, dist);
}

/** True and compressed half-angles for one body, for the assertion above. */
export function angularPair(planet, radius, dist) {
  const k = farScale(planet);
  return {
    k,
    truth: angularHalf(radius, dist),
    drawn: angularHalf(radius * k, dist * k),
  };
}

/**
 * Is this body in the far band or the near one?
 *
 * The boundary is a true distance, not a compressed one — a world is far
 * because it is far, not because of how it is being drawn this frame.
 */
export function isFar(dist) {
  return dist >= SPACE.nearBand;
}
