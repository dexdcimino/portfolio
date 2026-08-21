// Travel between worlds. The maths, with no Babylon and no game state in it, so
// the tunnelling test can fire a craft at a planet ten thousand times a second
// without a scene existing.
//
// Two ideas carry this file.
//
// 1. SPEED IS A FUNCTION OF ALTITUDE, and of nothing else. v(a) = v0·2^(a/H)
//    above the nearest surface. Climb away from a world and you accelerate;
//    fall toward one and you decelerate, on exactly the same curve. Nobody
//    presses anything, and there is no way to arrive fast.
//
//    H STILL RIDES ON THE TRANSIT STATE even though there is now only one law
//    (the 20s/10s split went out on 2026-08-21). Not ceremony: it is what
//    keeps every function here a pure function of its arguments, which is what
//    lets the tunnelling test fire ten thousand crossings a second with no
//    scene, no craft and no tune.js reachable from the call site. A default of
//    DOUBLING is the convenience; passing it is the contract.
//
// 2. THE STEP IS INTEGRATED, NOT SAMPLED. At the cap a frame is 33km long and
//    the smallest world is 414m across, so a per-frame `pos += v·dt` does not
//    merely lose accuracy — it passes clean through planets and never registers
//    a hit. The position step is solved in closed form and the resulting SEGMENT
//    is swept against every approach sphere. That is the whole reason this file
//    is separate and separately tested.

import { PLANETS, SYSTEM, HYPER, ARRIVE } from '../tune.js';

const L2 = Math.LN2;

const len = (x, y, z) => Math.hypot(x, y, z);

/**
 * How long a leg of `H` takes, boundary out to boundary in, in seconds.
 *
 *     t(H) = 2H·2^(-a0/H) / (v0·ln2)
 *
 * Out from the boundary to infinity and back down to it, with a0 the approach
 * altitude. There is no distance in it and no radius in it: the middle of a
 * journey is flown at the cap and costs nothing, so what a trip costs is the
 * climb out and the fall in, and those are the same climb on every world.
 */
export function legSeconds(H) {
  return (2 * H * Math.pow(2, -HYPER.approachAlt / H)) / (HYPER.localSpeed * L2);
}

/**
 * THE LENGTH OF A CROSSING IS AUTHORED IN SECONDS, and this solves back to H.
 *
 * `H` — metres of altitude per doubling — is the only knob that changes trip
 * time, and t(H) above is not a relation anyone can set by hand: 1500m is 18.1
 * seconds and nothing about the number says so. So tune.js states the seconds
 * it wants and this finds the H, which means the tuning file says what it
 * means and the arithmetic lives in one place.
 *
 * H IS AN ABSOLUTE LENGTH ON SIX WORLDS WHOSE RADII RUN 207m TO 2072m, which is
 * the exact shape of constant this project has now got wrong five times — so:
 * it is allowed to be absolute, and the reason is that the number it produces
 * is not. t(H) has no radius in it. Measured across all five destinations from
 * Home the legs run 18.3-18.6s against a predicted 18.1, a spread of 1.6% over
 * worlds that differ by a factor of ten, and `run.mjs` pins that convergence
 * for both laws. The player feels seconds; seconds are scale-free; seconds are
 * what tune.js says. The metres are derived and nobody has to divide them by
 * 207 and by 2072, because the thing they produce has already been checked at
 * both ends.
 *
 * t is strictly increasing in H — d/dH[H·2^(-a0/H)] = 2^(-a0/H)(1 + a0·ln2/H),
 * positive everywhere — so the bisection cannot land on a second root. Solved
 * twice at module load and never again.
 */
export function doublingFor(seconds) {
  let lo = 1, hi = 1e7;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (legSeconds(mid) < seconds) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * THE law, in metres per doubling. Derived; nothing authors this.
 *
 * It was two — `{first, repeat}`, picked per departure by a `doublingAfter()`
 * that read the save's crossing count — for exactly one day. Every crossing is
 * the same length now, so the pair, the selector and the save field's grip on
 * the physics all went with it. `economy.crossings` still counts and still
 * persists; it simply no longer decides anything.
 */
export const DOUBLING = doublingFor(HYPER.trip);

/**
 * The system, as spheres.
 *
 * `surfaceR` is where the ground is drawn (the profile's sea-level radius) and
 * `approachR` is the boundary between normal flight and hyper. Positions are in
 * metres in one frame shared by every world; SYSTEM.at is in kilometres because
 * that is the unit the separations are legible in.
 */
export function bodies() {
  const out = [];
  for (const [key, at] of Object.entries(SYSTEM.at)) {
    const p = PLANETS[key];
    if (!p) continue;
    const surfaceR = p.radius + p.waterY;
    out.push({
      key,
      name: p.name,
      c: { x: at[0] * 1000, y: at[1] * 1000, z: at[2] * 1000 },
      radius: p.radius,
      surfaceR,
      approachR: surfaceR + HYPER.approachAlt,
    });
  }
  return out;
}

/** Altitude above the nearest surface, and which world that is. */
export function nearest(bs, p) {
  let best = null, bestAlt = Infinity;
  for (const b of bs) {
    const alt = len(p.x - b.c.x, p.y - b.c.y, p.z - b.c.z) - b.surfaceR;
    if (alt < bestAlt) { bestAlt = alt; best = b; }
  }
  return { body: best, alt: bestAlt };
}

/** v(a), capped. `H` defaults to a first crossing, the slowest law there is. */
export function speedAt(alt, H) {
  const h = H === undefined ? DOUBLING : H;
  return Math.min(HYPER.maxSpeed,
    HYPER.localSpeed * Math.pow(2, Math.max(0, alt) / h));
}

/** Is this point inside any world's approach sphere? Hyper cannot run in one. */
export function insideAny(bs, p) {
  for (const b of bs) {
    if (len(p.x - b.c.x, p.y - b.c.y, p.z - b.c.z) <= b.approachR) return b;
  }
  return null;
}

/**
 * How far the craft travels this frame, solved rather than sampled.
 *
 * With k the cosine between the heading and the local radial, altitude and
 * distance obey da/dt = k·v(a) and ds/dt = v(a). The first has a closed-form
 * solution:
 *
 *     2^(-a1/H) = 2^(-a0/H) - k·v0·t·ln2/H
 *
 * and the second follows from it exactly, since ds = da/k. Two special cases
 * matter and both are real:
 *
 *   k ≈ 0  — flying tangentially. Altitude does not change, so neither does
 *            speed, and the step is the ordinary v·t.
 *   b ≤ 0  — the bracket going non-positive is the escape singularity: climbing
 *            away from everything, the uncapped law reaches infinite speed in
 *            finite time. The cap is what that case means physically, so the
 *            step is the cap's.
 *
 * The result is clamped to maxSpeed·dt regardless, which also guarantees the
 * step can never be longer than the swept segment the caller is about to test.
 */
export function stepDistance(alt0, k, dt, HIn) {
  const H = HIn === undefined ? DOUBLING : HIn;
  const v0 = HYPER.localSpeed;
  const capStep = HYPER.maxSpeed * dt;
  if (!(dt > 0)) return 0;
  if (Math.abs(k) < 1e-9) return Math.min(speedAt(alt0, H) * dt, capStep);

  const a0 = Math.max(0, alt0);
  const b = Math.pow(2, -a0 / H) - (k * v0 * dt * L2) / H;
  if (b <= 0) return capStep;

  const a1 = -H * Math.log2(b);
  const s = (a1 - a0) / k;
  // Descending into a world, `s` is positive and smaller than v·dt because the
  // craft is slowing the whole way. Both branches are bounded by the cap.
  return Math.min(Math.max(s, 0), capStep);
}

/**
 * Segment against sphere. Returns the distance along `dir` at which the segment
 * first enters, or -1.
 *
 * This is the anti-tunnelling test itself: six of these a frame, and a 33km
 * step cannot skip a 607m sphere because the segment either intersects it or
 * does not — the frame rate has nothing to do with it.
 */
export function sweepSphere(p, dir, dist, c, R) {
  const ox = p.x - c.x, oy = p.y - c.y, oz = p.z - c.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const cc = ox * ox + oy * oy + oz * oz - R * R;
  // Starting on or inside the sphere is not an arrival, it is a departure.
  // An earlier cut returned the far root here — the way OUT — which made a
  // craft sitting exactly on the boundary report that it had just arrived at
  // the world it was leaving, on its first frame, every time. Entries only.
  if (cc <= 0) return -1;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  if (t < 0 || t > dist) return -1;
  return t;
}

/**
 * The earliest approach sphere this segment ENTERS, if any.
 *
 * Entries only — see sweepSphere. That is what makes a departure and an arrival
 * distinguishable at the same boundary: the sphere you are climbing out of is
 * one you are already inside, so it cannot be arrived at. Stated as a property
 * of the geometry rather than as a remembered "the world I just left", so it
 * holds on the way out, on the way in, and on a trajectory that curves back.
 */
export function sweepAll(bs, p, dir, dist) {
  let hit = null;
  for (const b of bs) {
    const t = sweepSphere(p, dir, dist, b.c, b.approachR);
    if (t >= 0 && (!hit || t < hit.t)) hit = { body: b, t };
  }
  return hit;
}

/**
 * One frame of hyper flight.
 *
 * `state` is { p, dir, target, H } in system metres; it is mutated. `H` is the
 * law this trip flies under and is fixed at departure; a state without one
 * flies a first crossing. Returns the body arrived at, or null. On arrival the position is clamped to the entry
 * point on the approach sphere, which is where normal flight resumes — never
 * a point inside the world, and never past it.
 */
export function advance(bs, state, dt) {
  const near = nearest(bs, state.p);
  const p = state.p, dir = state.dir;

  // Rate of altitude change per metre travelled: the cosine between the heading
  // and the radial of whichever world is nearest.
  const d = len(p.x - near.body.c.x, p.y - near.body.c.y, p.z - near.body.c.z) || 1;
  const rx = (p.x - near.body.c.x) / d, ry = (p.y - near.body.c.y) / d, rz = (p.z - near.body.c.z) / d;
  const k = dir.x * rx + dir.y * ry + dir.z * rz;

  const dist = stepDistance(near.alt, k, dt, state.H);
  const hit = sweepAll(bs, p, dir, dist);

  const travel = hit ? hit.t : dist;
  p.x += dir.x * travel;
  p.y += dir.y * travel;
  p.z += dir.z * travel;

  state.speed = dist / dt;
  state.alt = near.alt;
  return hit ? hit.body : null;
}

/**
 * Pick a destination for a heading.
 *
 * A world's approach sphere is two thousandths of a radian wide from across the
 * system, so this is not a targeting aid, it is the feature: you leave pointing
 * roughly at a disc in the sky and the trajectory commits to it. Anything
 * outside the cone is not a candidate, and the nearest world is the fallback so
 * a climb straight up still goes somewhere.
 */
export function pickTarget(bs, p, dir, exclude) {
  let best = null, bestDot = Math.cos(HYPER.lockCone);
  let fallback = null, fallbackD = Infinity;
  for (const b of bs) {
    if (b.key === exclude) continue;
    const dx = b.c.x - p.x, dy = b.c.y - p.y, dz = b.c.z - p.z;
    const d = len(dx, dy, dz) || 1;
    const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / d;
    if (dot > bestDot) { bestDot = dot; best = b; }
    if (d < fallbackD) { fallbackD = d; fallback = b; }
  }
  return best || fallback;
}

/**
 * Bend the heading toward the target, at a bounded rate.
 *
 * Aimed at the point on the approach sphere rather than the centre, so the
 * craft stops correcting once it is committed instead of spiralling into a
 * head-on arrival every time.
 */
export function steer(state, target, dt, rate) {
  if (!target) return;
  const p = state.p, dir = state.dir;
  const dx = target.c.x - p.x, dy = target.c.y - p.y, dz = target.c.z - p.z;
  const d = len(dx, dy, dz) || 1;
  const wx = dx / d, wy = dy / d, wz = dz / d;
  const dot = Math.max(-1, Math.min(1, dir.x * wx + dir.y * wy + dir.z * wz));
  const ang = Math.acos(dot);
  if (ang < 1e-6) return;
  const t = Math.min(1, ((rate === undefined ? HYPER.turnRate : rate) * dt) / ang);
  dir.x += (wx - dir.x) * t;
  dir.y += (wy - dir.y) * t;
  dir.z += (wz - dir.z) * t;
  const l = len(dir.x, dir.y, dir.z) || 1;
  dir.x /= l; dir.y /= l; dir.z /= l;
}

/**
 * How high above a world the craft is handed back, in metres.
 *
 * ONE EXPRESSION, because three callers need the same answer and two of them
 * are harnesses. dev/arrivecheck.mjs used to drive the DEV WARP instead, which
 * passes HYPER.approachAlt explicitly and then settles to the deck — so the
 * check that exists to catch a camera underground was checking a path no
 * player takes, and that is how an absolute 900m shipped without anything
 * noticing that it framed nothing on the small worlds.
 *
 * Radii, not metres: see ARRIVE.alt. Never above the approach sphere, so the
 * craft is only ever placed at or below where it crossed.
 */
export function arriveAlt(radius) {
  return Math.min(HYPER.approachAlt, radius * ARRIVE.alt);
}

/** Where a world's centre sits, in system metres. */
export function centreOf(key) {
  const at = SYSTEM.at[key];
  return at ? { x: at[0] * 1000, y: at[1] * 1000, z: at[2] * 1000 } : { x: 0, y: 0, z: 0 };
}
