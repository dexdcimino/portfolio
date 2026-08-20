// Which way is down, when there is more than one world.
//
// No Babylon and no game state, like hyper.js beside it, so the crossing test
// can fly a craft between two wells ten thousand times without a scene.
//
// Three ideas carry this file.
//
// 1. THE FIELD IS SUMMED, NOT SWITCHED. There is no "which body owns me"
//    decision anywhere in the physics, so there is no moment at which the
//    answer changes and nothing to blend across. The handover the plan asks
//    for happens where the two pulls are equal, because that is where the sum
//    stops leaning one way and starts leaning the other — it is a consequence
//    of the arithmetic rather than a rule someone had to write, and a
//    consequence cannot be got wrong at a boundary case.
//
//    A switched field is discontinuous by construction and the fix is a blend
//    band: a second set of numbers to tune and a second thing to be wrong at
//    the edges. A summed one is continuous everywhere except at its own zero.
//
// 2. A WELL'S REACH IS ITS RADIUS. Every world pulls the same at its own
//    ground — the game has always had exactly one gravity constant, and that
//    was already a statement about the six worlds. What it never said is how
//    FAR each one pulls, and equal surface gravity settles it: mu = g0 * R^2.
//    So dominance is R/d — the world that owns you is the one that looks
//    biggest in your sky. The player can read it off the window, which is why
//    it needs no HUD element and gets none.
//
// 3. CONTINUITY IS NOT THE SAME PROBLEM AS SMOOTHNESS. The summed field is
//    smooth, and following it still snaps the craft over, because a trajectory
//    that passes within a few hundred metres of the balance point sees the
//    direction reverse in under a frame. So the craft carries a BASIS and
//    turns it at a bounded rate, rather than deriving one from the field each
//    frame. That is also what removes the gimbal: a departure is a climb
//    straight up and an arrival is a dive straight down, which are exactly the
//    two attitudes at which yaw and roll are the same number.
//
// What this does NOT do is move anything. Hyper's speed law is a function of
// altitude and stays that way; the field decides orientation, not trajectory.

import { GRAV } from '../tune.js';
import { swingFrame, rollFrame } from './sphere.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Gravitational parameter. surfaceR rather than radius, so a world with an
 * ocean is measured from the surface you actually stand on and the field
 * reproduces g0 where the craft would feel it.
 */
export function muOf(b) { return GRAV.g0 * b.surfaceR * b.surfaceR; }

/**
 * The summed acceleration at a point, and its magnitude.
 *
 * Clamped at each body's own surface. The point-mass law diverges at the
 * centre, and the segment sweep in hyper.js means a position inside a world is
 * a state the maths must survive rather than one that cannot arise — a NaN
 * here would come back as an undefined attitude several frames later, which is
 * the worst kind of bug this file could have.
 */
export function fieldAt(bs, p, out = { x: 0, y: 0, z: 0, g: 0 }) {
  out.x = 0; out.y = 0; out.z = 0;
  for (const b of bs) {
    const dx = b.c.x - p.x, dy = b.c.y - p.y, dz = b.c.z - p.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-6) continue;
    const r = Math.max(d, b.surfaceR);
    const a = muOf(b) / (r * r * d);        // includes the 1/d of normalising
    out.x += dx * a; out.y += dy * a; out.z += dz * a;
  }
  out.g = Math.hypot(out.x, out.y, out.z);
  return out;
}

/**
 * The body with the largest angular radius from here — the one that looks
 * biggest in your sky, which with equal surface gravity is also the one
 * pulling hardest.
 *
 * NOT the same selector as hyper.js's nearest(), and the difference is the
 * point. nearest() ranks by ALTITUDE, d - surfaceR, which is right for a speed
 * law defined on altitude: it makes the craft slow down for the ground it is
 * about to meet. Gravity falls off as 1/d^2, so it ranks by R/d, and the two
 * disagree over a wide band — on the Ember-Anvil line, everything from 9% to
 * 50% of the way across is nearer Ember's surface and owned by Anvil. Both are
 * correct for what they are for; this exists so that nothing has to pick one
 * of them and use it for both.
 */
export function dominant(bs, p) {
  let best = null, bestQ = -Infinity;
  for (const b of bs) {
    const d = Math.hypot(p.x - b.c.x, p.y - b.c.y, p.z - b.c.z) || 1;
    const q = b.surfaceR / d;
    if (q > bestQ) { bestQ = q; best = b; }
  }
  return best;
}

/**
 * Where two wells balance, along the line between them.
 *
 * Returns the fraction from a toward b. With equal surface gravity this is
 * Ra / (Ra + Rb) and nothing else — no masses, no distances, no per-pair
 * tuning. Equal worlds balance at the midpoint, which is what the plan asked
 * for; unequal ones balance proportionally, which is what it meant.
 *
 * Nothing in the physics calls this. It is here because it is the number the
 * crossing test has to aim at, and a test that computes its own target out of
 * the code under test proves only that the code is self-consistent.
 */
export function balancePoint(a, b) {
  return a.surfaceR / (a.surfaceR + b.surfaceR);
}

/**
 * The craft's own basis, between worlds.
 *
 * (east, up, north) are its right, up and FORWARD in world space — the same
 * three fields a TangentFrame carries, in the same order, so frameQuat turns
 * it straight into the drawn rotation and applyTransform's transit branch
 * becomes the surface branch with the local rotation left out.
 *
 * WHY A CARRIED BASIS RATHER THAN ANGLES. Transit orientation used to be built
 * from world +Y as RotationYawPitchRoll(heading, pitch, 0), and world +Y is an
 * axis the player has no relationship with. The craft's roll SNAPPED at the
 * boundary by however far the departure point was from it — measured on Home
 * at 8.6 degrees leaving from the +Y pole, 146 from the equator and 171 from
 * the far side, then snapped back on arrival. Angles relative to the field
 * frame would fix that and buy a gimbal lock instead, because departure is a
 * climb straight up and arrival is a dive straight down, which are precisely
 * the two attitudes where yaw and roll stop being distinguishable. A basis has
 * no chart and therefore no pole.
 */
export class TransitFrame {
  constructor() {
    this.east = { x: 1, y: 0, z: 0 };    // right
    this.up = { x: 0, y: 1, z: 0 };
    this.north = { x: 0, y: 0, z: 1 };   // forward
    this.held = 0;          // seconds with no down to follow, for the harness
    this.rolled = 0;        // radians of bank correction applied, ditto
    this._f = { x: 0, y: 0, z: 0, g: 0 };
  }

  /**
   * Take the craft's exact drawn orientation at the moment it leaves: the
   * tangent frame's basis with the craft's own yaw, pitch and roll composed on
   * top, which is what applyTransform was already drawing. Departure is then
   * not a transition at all — the same orientation, expressed once more.
   */
  seed(fr, yaw, pitch, roll) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    // Babylon's yaw-pitch-roll is Ry * Rx * Rz; these are its columns.
    const L = [
      [cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp],
      [cp * sr, cp * cr, -sp],
      [-sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp],
    ];
    const put = (out, col) => {
      out.x = fr.east.x * L[0][col] + fr.up.x * L[1][col] + fr.north.x * L[2][col];
      out.y = fr.east.y * L[0][col] + fr.up.y * L[1][col] + fr.north.y * L[2][col];
      out.z = fr.east.z * L[0][col] + fr.up.z * L[1][col] + fr.north.z * L[2][col];
    };
    put(this.east, 0); put(this.up, 1); put(this.north, 2);
    this.held = 0;
    this.rolled = 0;
    return this;
  }

  /**
   * One frame of flying: point the nose where the craft is going, then bank it
   * so its up is the local up.
   *
   * The two are separate rotations on purpose. The nose follows the heading at
   * GRAV.aimRate, which is set above hyper's own steering rate so the craft
   * never visibly lags the course it is flying. The bank is a rotation ABOUT
   * the nose and nothing else, so correcting it can never disturb the heading,
   * and it is bounded by GRAV.turn — the number that turns the field's
   * instantaneous 180-degree reversal at the balance point into a roll the
   * player watches happen.
   *
   * Two cases have no answer and both are left alone rather than forced. With
   * no field there is no up: the craft holds its bank, which is what weightless
   * means. With the field along the nose — flying straight up out of a world,
   * or straight down into one — every bank is equally upright, so there is
   * nothing to correct toward and no reason to spin looking for it.
   */
  aim(bs, p, dir, dt) {
    swingFrame(this, this.north, dir, GRAV.aimRate * dt);
    const f = fieldAt(bs, p, this._f);
    if (f.g <= GRAV.hold) { this.held += dt; return f; }

    // Up is away from the field, and only the part of it across the nose can
    // be corrected by rolling.
    const tx = -f.x / f.g, ty = -f.y / f.g, tz = -f.z / f.g;
    const n = this.north;
    const along = tx * n.x + ty * n.y + tz * n.z;
    let px = tx - n.x * along, py = ty - n.y * along, pz = tz - n.z * along;
    const pl = Math.hypot(px, py, pz);
    if (pl < 1e-6) return f;              // down IS forward: no bank is wrong
    px /= pl; py /= pl; pz /= pl;

    // Signed angle from the craft's up to that, about the nose.
    const u = this.up;
    const cos = clamp(u.x * px + u.y * py + u.z * pz, -1, 1);
    const sin = (u.y * pz - u.z * py) * n.x + (u.z * px - u.x * pz) * n.y +
                (u.x * py - u.y * px) * n.z;
    const ang = Math.atan2(sin, cos);
    const step = clamp(ang, -GRAV.turn * dt, GRAV.turn * dt);
    rollFrame(this, n.x, n.y, n.z, step);
    this.rolled += Math.abs(step);
    return f;
  }

  /**
   * How far the craft is from upright, as a bank — the angle aim() is driving
   * to zero, signed about the nose.
   *
   * NOT the raw angle between the craft's up and the local up. A craft diving
   * straight into a world is at 90 degrees to the local up by definition and
   * is nonetheless perfectly upright; measuring the raw angle reports every
   * arrival in the system as a 90-degree error and says nothing about whether
   * the bank converged. Only the component across the nose is a bank, and only
   * a bank can be corrected by rolling.
   */
  rollError(bs, p) {
    const f = fieldAt(bs, p, this._f);
    if (f.g <= GRAV.hold) return 0;
    const tx = -f.x / f.g, ty = -f.y / f.g, tz = -f.z / f.g;
    const n = this.north;
    const along = tx * n.x + ty * n.y + tz * n.z;
    let px = tx - n.x * along, py = ty - n.y * along, pz = tz - n.z * along;
    const pl = Math.hypot(px, py, pz);
    if (pl < 1e-6) return 0;             // down is forward: no bank to be wrong
    px /= pl; py /= pl; pz /= pl;
    const u = this.up;
    const cos = clamp(u.x * px + u.y * py + u.z * pz, -1, 1);
    const sin = (u.y * pz - u.z * py) * n.x + (u.z * px - u.x * pz) * n.y +
                (u.x * py - u.y * px) * n.z;
    return Math.atan2(sin, cos);
  }
}

/**
 * The craft's compass heading in a tangent frame — the one number an arrival
 * has to carry across, because everything else about the attitude is reset by
 * the autopilot that takes the controls on the other side.
 *
 * Without this, yaw was simply whatever it had been on the world the craft
 * left, which is not a direction on the world it reached.
 *
 * A craft arriving exactly along the radial has no heading in its nose; the
 * fallback reads one off its own up instead, which is well conditioned in
 * precisely the case the nose is not. Measure zero in practice — the sweep
 * hands back the point where the trajectory ENTERED the sphere, and a chord
 * through a sphere is radial only if it is aimed at the centre exactly.
 */
export function landingYaw(att, fr) {
  let e = att.north.x * fr.east.x + att.north.y * fr.east.y + att.north.z * fr.east.z;
  let n = att.north.x * fr.north.x + att.north.y * fr.north.y + att.north.z * fr.north.z;
  if (Math.hypot(e, n) < 1e-6) {
    e = att.up.x * fr.east.x + att.up.y * fr.east.y + att.up.z * fr.east.z;
    n = att.up.x * fr.north.x + att.up.y * fr.north.y + att.up.z * fr.north.z;
  }
  return Math.atan2(e, n);
}
