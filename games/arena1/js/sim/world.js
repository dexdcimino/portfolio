// sim/world.js — collision for the headless sim: the shape store, the
// overlap/raycast queries, and the substepped capsule mover that replaces
// Babylon's moveWithCollisions (ARENA1_STEPS Phase 2). Plain data in, plain
// data out — no Babylon, no wall clock, no Math.random (tests/guards.mjs
// enforces all three).
//
// Shapes: aabb {min,max} · obb {center,half,axes} · vcyl {center,r,halfH}.
// Every shape carries {id, kind, active, platformId, layer} plus a `rest` copy
// of its geometry: movers/collapsers position shapes ABSOLUTELY each tick as
// rest + offset (level.js), so nothing accumulates drift over a long session.
//
// Broadphase: brute force with a cheap world-AABB reject. ~150 shapes; do not
// build a grid unless profiling demands (spec).

export const CAPSULE_R = 0.4;      // matches the prototype ellipsoid (0.4, 0.9, 0.4)
export const CAPSULE_HALF_H = 0.9; // TOTAL half-height; the inner segment is halfH - r

// moveCapsule tuning — all from the Phase 2 spec, none of it TUNE's business.
const SUBSTEP_LEN = 0.25;
const MAX_ITERS = 4;
const GROUND_NY = 0.55;    // contact n.y above this = ground
const WALL_NY = 0.35;      // contact |n.y| below this = wall
const WALL_INFLATE = 0.15; // wall probe inflates the capsule radius by this
const EPS = 1e-9;

// Step-up allowance (grounded only, opt-in via moveCapsule opts.stepUp).
// The prototype's Babylon ellipsoid (0.4, 0.9) rolls over low lips because its
// tall vertical radius tilts contact normals upward; the capsule's r=0.4
// bottom sphere walls out at lip height ≈ its center (measured: hard stall at
// h≥0.35, snag-and-pop below — tests/stepup.mjs). 0.5 clears the tallest lip
// the prototype walks (rampA's 0.41 base, the 0.40 jump-pad discs) and rejects
// half-meter curbs.
const STEP_H = 0.5;
const STEP_OPPOSE = -0.3;   // contact must oppose the horizontal step direction
const STEP_EDGE_NY = 0.85;  // edge contacts steeper than this trigger too (snag guard)
const STEP_MIN_GAIN = 0.02; // must actually gain height (protects wall glides)
const STEP_MIN_FWD = 0.5;   // must keep ≥ half the intended horizontal substep

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createWorld() {
  const shapes = [];
  let nextId = 1;

  function refreshBounds(s) {
    if (s.kind === 'aabb') {
      s.bmin = { x: s.min.x, y: s.min.y, z: s.min.z };
      s.bmax = { x: s.max.x, y: s.max.y, z: s.max.z };
    } else if (s.kind === 'vcyl') {
      s.bmin = { x: s.center.x - s.r, y: s.center.y - s.halfH, z: s.center.z - s.r };
      s.bmax = { x: s.center.x + s.r, y: s.center.y + s.halfH, z: s.center.z + s.r };
    } else { // obb: sum of |axis| * half per world component
      const [a0, a1, a2] = s.axes, h = s.half;
      const ex = Math.abs(a0.x) * h.x + Math.abs(a1.x) * h.y + Math.abs(a2.x) * h.z;
      const ey = Math.abs(a0.y) * h.x + Math.abs(a1.y) * h.y + Math.abs(a2.y) * h.z;
      const ez = Math.abs(a0.z) * h.x + Math.abs(a1.z) * h.y + Math.abs(a2.z) * h.z;
      s.bmin = { x: s.center.x - ex, y: s.center.y - ey, z: s.center.z - ez };
      s.bmax = { x: s.center.x + ex, y: s.center.y + ey, z: s.center.z + ez };
    }
  }

  function finish(s, opts) {
    s.id = nextId++;
    s.active = true;
    s.platformId = opts?.platformId ?? null;
    s.layer = opts?.layer ?? 1;
    s.offset = { x: 0, y: 0, z: 0 };
    refreshBounds(s);
    shapes.push(s);
    return s;
  }

  function addAabb(min, max, opts) {
    return finish({
      kind: 'aabb',
      rest: { min: { ...min }, max: { ...max } },
      min: { ...min }, max: { ...max },
    }, opts);
  }
  function addObb(center, half, axes, opts) {
    return finish({
      kind: 'obb',
      rest: { center: { ...center } },
      center: { ...center },
      half: { ...half },
      axes: axes.map((a) => ({ ...a })),
    }, opts);
  }
  function addVcyl(center, r, halfH, opts) {
    return finish({
      kind: 'vcyl',
      rest: { center: { ...center } },
      center: { ...center }, r, halfH,
    }, opts);
  }

  function setShapeOffset(s, off) {
    s.offset = { x: off.x, y: off.y, z: off.z };
    if (s.kind === 'aabb') {
      s.min = { x: s.rest.min.x + off.x, y: s.rest.min.y + off.y, z: s.rest.min.z + off.z };
      s.max = { x: s.rest.max.x + off.x, y: s.rest.max.y + off.y, z: s.rest.max.z + off.z };
    } else {
      s.center = { x: s.rest.center.x + off.x, y: s.rest.center.y + off.y, z: s.rest.center.z + off.z };
    }
    refreshBounds(s);
  }

  function setShapeActive(s, on) { s.active = on; }

  // ---- capsule vs shape → contact {n, depth, shape} | null -----------------
  // The capsule is its vertical inner segment (half length halfH - r) swept by
  // a sphere of radius r; every test reduces to sphere-vs-shape at the segment
  // point nearest the shape.

  function insideBoxPush(x, y, z, min, max, r, s) {
    // Sphere center inside the box: push out through the nearest face. Depth
    // includes r so the pushout leaves the capsule flush, not embedded.
    const cand = [
      { pen: max.x - x, n: { x: 1, y: 0, z: 0 } },
      { pen: x - min.x, n: { x: -1, y: 0, z: 0 } },
      { pen: max.y - y, n: { x: 0, y: 1, z: 0 } },
      { pen: y - min.y, n: { x: 0, y: -1, z: 0 } },
      { pen: max.z - z, n: { x: 0, y: 0, z: 1 } },
      { pen: z - min.z, n: { x: 0, y: 0, z: -1 } },
    ];
    let best = cand[0];
    for (const c of cand) if (c.pen < best.pen) best = c;
    return { n: best.n, depth: best.pen + r, shape: s };
  }

  function contactAabb(s, px, py, pz, r, segHalf) {
    const ya = py - segHalf, yb = py + segHalf;
    let sy;
    if (yb < s.min.y) sy = yb;
    else if (ya > s.max.y) sy = ya;
    else sy = clamp(py, Math.max(ya, s.min.y), Math.min(yb, s.max.y));
    const qx = clamp(px, s.min.x, s.max.x);
    const qy = clamp(sy, s.min.y, s.max.y);
    const qz = clamp(pz, s.min.z, s.max.z);
    const dx = px - qx, dy = sy - qy, dz = pz - qz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r * r) return null;
    if (d2 > EPS) {
      const d = Math.sqrt(d2);
      // Edge/corner contact when the sphere center sits outside the box on
      // two or more axes (a face contact clamps exactly one).
      const edge = ((px < s.min.x || px > s.max.x) ? 1 : 0)
        + ((sy < s.min.y || sy > s.max.y) ? 1 : 0)
        + ((pz < s.min.z || pz > s.max.z) ? 1 : 0) >= 2;
      return { n: { x: dx / d, y: dy / d, z: dz / d }, depth: r - d, shape: s, edge };
    }
    return insideBoxPush(px, sy, pz, s.min, s.max, r, s);
  }

  function contactVcyl(s, px, py, pz, r, segHalf) {
    const c = s.center;
    const dx = px - c.x, dz = pz - c.z;
    const d = Math.hypot(dx, dz);
    const cyMin = c.y - s.halfH, cyMax = c.y + s.halfH;
    const ya = py - segHalf, yb = py + segHalf;
    let sy;
    if (yb < cyMin) sy = yb;
    else if (ya > cyMax) sy = ya;
    else sy = clamp(py, Math.max(ya, cyMin), Math.min(yb, cyMax));
    // 2D problem in (radial, y): the cylinder is the rectangle [0..R]×[yMin..yMax].
    const qr = Math.min(d, s.r);
    const qy = clamp(sy, cyMin, cyMax);
    const ddr = d - qr, ddy = sy - qy;
    const d2 = ddr * ddr + ddy * ddy;
    if (d2 > r * r) return null;
    if (d2 > EPS) {
      const dist = Math.sqrt(d2);
      const rx = d > EPS ? dx / d : 0, rz = d > EPS ? dz / d : 0;
      const nr = ddr / dist;
      const edge = d > s.r && (sy < cyMin || sy > cyMax); // rim contact
      return { n: { x: rx * nr, y: ddy / dist, z: rz * nr }, depth: r - dist, shape: s, edge };
    }
    // Inside: smallest of top / bottom / radial pushout.
    const cand = [
      { pen: cyMax - sy, n: { x: 0, y: 1, z: 0 } },
      { pen: sy - cyMin, n: { x: 0, y: -1, z: 0 } },
    ];
    if (d > EPS) cand.push({ pen: s.r - d, n: { x: dx / d, y: 0, z: dz / d } });
    let best = cand[0];
    for (const cc of cand) if (cc.pen < best.pen) best = cc;
    return { n: best.n, depth: best.pen + r, shape: s };
  }

  function contactObb(s, px, py, pz, r, segHalf) {
    const [a0, a1, a2] = s.axes, h = s.half;
    const rx = px - s.center.x, ry = py - s.center.y, rz = pz - s.center.z;
    // Local coords of the capsule center and of world-up (for the segment).
    const base = {
      x: rx * a0.x + ry * a0.y + rz * a0.z,
      y: rx * a1.x + ry * a1.y + rz * a1.z,
      z: rx * a2.x + ry * a2.y + rz * a2.z,
    };
    const up = { x: a0.y, y: a1.y, z: a2.y };
    const A = { x: base.x - up.x * segHalf, y: base.y - up.y * segHalf, z: base.z - up.z * segHalf };
    const B = { x: base.x + up.x * segHalf, y: base.y + up.y * segHalf, z: base.z + up.z * segHalf };
    // Closest point pair segment↔box by alternating projection. Exact when the
    // nearest feature is a face (the walking case); 3 rounds is plenty for the
    // short (≤1.0) capsule segment against edges/corners.
    const abx = B.x - A.x, aby = B.y - A.y, abz = B.z - A.z;
    const ab2 = abx * abx + aby * aby + abz * abz;
    let P = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, z: (A.z + B.z) / 2 };
    let Q;
    for (let i = 0; i < 3; i++) {
      Q = { x: clamp(P.x, -h.x, h.x), y: clamp(P.y, -h.y, h.y), z: clamp(P.z, -h.z, h.z) };
      const t = ab2 > EPS
        ? clamp(((Q.x - A.x) * abx + (Q.y - A.y) * aby + (Q.z - A.z) * abz) / ab2, 0, 1)
        : 0;
      P = { x: A.x + abx * t, y: A.y + aby * t, z: A.z + abz * t };
    }
    Q = { x: clamp(P.x, -h.x, h.x), y: clamp(P.y, -h.y, h.y), z: clamp(P.z, -h.z, h.z) };
    const ex = P.x - Q.x, ey = P.y - Q.y, ez = P.z - Q.z;
    const d2 = ex * ex + ey * ey + ez * ez;
    if (d2 > r * r) return null;
    if (d2 > EPS) {
      const d = Math.sqrt(d2);
      const nl = { x: ex / d, y: ey / d, z: ez / d };
      const edge = ((P.x < -h.x || P.x > h.x) ? 1 : 0)
        + ((P.y < -h.y || P.y > h.y) ? 1 : 0)
        + ((P.z < -h.z || P.z > h.z) ? 1 : 0) >= 2;
      return {
        n: {
          x: a0.x * nl.x + a1.x * nl.y + a2.x * nl.z,
          y: a0.y * nl.x + a1.y * nl.y + a2.y * nl.z,
          z: a0.z * nl.x + a1.z * nl.y + a2.z * nl.z,
        },
        depth: r - d, shape: s, edge,
      };
    }
    // Inside: face pushout in local space, normal mapped back to world.
    const cand = [
      { pen: h.x - P.x, ax: a0, sgn: 1 }, { pen: P.x + h.x, ax: a0, sgn: -1 },
      { pen: h.y - P.y, ax: a1, sgn: 1 }, { pen: P.y + h.y, ax: a1, sgn: -1 },
      { pen: h.z - P.z, ax: a2, sgn: 1 }, { pen: P.z + h.z, ax: a2, sgn: -1 },
    ];
    let best = cand[0];
    for (const c of cand) if (c.pen < best.pen) best = c;
    return {
      n: { x: best.ax.x * best.sgn, y: best.ax.y * best.sgn, z: best.ax.z * best.sgn },
      depth: best.pen + r, shape: s,
    };
  }

  function overlapCapsule(pos, r = CAPSULE_R, halfH = CAPSULE_HALF_H) {
    const segHalf = Math.max(0, halfH - r);
    const out = [];
    const nx = pos.x - r, xx = pos.x + r;
    const ny = pos.y - halfH, xy = pos.y + halfH;
    const nz = pos.z - r, xz = pos.z + r;
    for (const s of shapes) {
      if (!s.active) continue;
      if (s.bmin.x > xx + 0.01 || s.bmax.x < nx - 0.01
        || s.bmin.y > xy + 0.01 || s.bmax.y < ny - 0.01
        || s.bmin.z > xz + 0.01 || s.bmax.z < nz - 0.01) continue;
      let c = null;
      if (s.kind === 'aabb') c = contactAabb(s, pos.x, pos.y, pos.z, r, segHalf);
      else if (s.kind === 'vcyl') c = contactVcyl(s, pos.x, pos.y, pos.z, r, segHalf);
      else c = contactObb(s, pos.x, pos.y, pos.z, r, segHalf);
      if (c && c.depth > EPS) out.push(c);
    }
    return out;
  }

  // ---- raycast --------------------------------------------------------------
  // Serves grapple, shooting, enemy grounding; the render layer may READ this
  // for blob shadows — one-directional reads are allowed (spec).

  function raySlab(o, d, min, max, maxLen) {
    let tmin = -Infinity, tmax = Infinity, axis = -1, sgn = 0;
    const os = [o.x, o.y, o.z], ds = [d.x, d.y, d.z];
    const mins = [min.x, min.y, min.z], maxs = [max.x, max.y, max.z];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(ds[a]) < 1e-12) {
        if (os[a] < mins[a] || os[a] > maxs[a]) return null;
        continue;
      }
      let t1 = (mins[a] - os[a]) / ds[a];
      let t2 = (maxs[a] - os[a]) / ds[a];
      let s = -1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = a; sgn = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (tmin < 1e-6 || tmin > maxLen) return null; // starting inside = no hit
    const n = [0, 0, 0]; n[axis] = sgn;
    return { t: tmin, n: { x: n[0], y: n[1], z: n[2] } };
  }

  function rayVcyl(s, o, d, maxLen) {
    const cyMin = s.center.y - s.halfH, cyMax = s.center.y + s.halfH;
    let best = null;
    // side wall
    const ox = o.x - s.center.x, oz = o.z - s.center.z;
    const a = d.x * d.x + d.z * d.z;
    if (a > 1e-12) {
      const b = 2 * (ox * d.x + oz * d.z);
      const c = ox * ox + oz * oz - s.r * s.r;
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / (2 * a);
        if (t > 1e-6 && t <= maxLen) {
          const y = o.y + d.y * t;
          if (y >= cyMin && y <= cyMax) {
            const hx = (ox + d.x * t) / s.r, hz = (oz + d.z * t) / s.r;
            best = { t, n: { x: hx, y: 0, z: hz } };
          }
        }
      }
    }
    // caps
    for (const [capY, ny] of [[cyMax, 1], [cyMin, -1]]) {
      if (Math.abs(d.y) < 1e-12) continue;
      const t = (capY - o.y) / d.y;
      if (t <= 1e-6 || t > maxLen || (best && t >= best.t)) continue;
      const hx = ox + d.x * t, hz = oz + d.z * t;
      if (hx * hx + hz * hz <= s.r * s.r) best = { t, n: { x: 0, y: ny, z: 0 } };
    }
    return best;
  }

  function rayObb(s, o, d, maxLen) {
    const [a0, a1, a2] = s.axes;
    const rx = o.x - s.center.x, ry = o.y - s.center.y, rz = o.z - s.center.z;
    const ol = {
      x: rx * a0.x + ry * a0.y + rz * a0.z,
      y: rx * a1.x + ry * a1.y + rz * a1.z,
      z: rx * a2.x + ry * a2.y + rz * a2.z,
    };
    const dl = {
      x: d.x * a0.x + d.y * a0.y + d.z * a0.z,
      y: d.x * a1.x + d.y * a1.y + d.z * a1.z,
      z: d.x * a2.x + d.y * a2.y + d.z * a2.z,
    };
    const h = s.half;
    const hit = raySlab(ol, dl, { x: -h.x, y: -h.y, z: -h.z }, { x: h.x, y: h.y, z: h.z }, maxLen);
    if (!hit) return null;
    const nl = hit.n;
    return {
      t: hit.t,
      n: {
        x: a0.x * nl.x + a1.x * nl.y + a2.x * nl.z,
        y: a0.y * nl.x + a1.y * nl.y + a2.y * nl.z,
        z: a0.z * nl.x + a1.z * nl.y + a2.z * nl.z,
      },
    };
  }

  function raycast(origin, dir, maxLen, mask = 0xffff) {
    let best = null, bestShape = null;
    for (const s of shapes) {
      if (!s.active || !(s.layer & mask)) continue;
      let h = null;
      if (s.kind === 'aabb') h = raySlab(origin, dir, s.min, s.max, maxLen);
      else if (s.kind === 'vcyl') h = rayVcyl(s, origin, dir, maxLen);
      else h = rayObb(s, origin, dir, maxLen);
      if (h && (!best || h.t < best.t)) { best = h; bestShape = s; }
    }
    if (!best) return null;
    return {
      point: {
        x: origin.x + dir.x * best.t,
        y: origin.y + dir.y * best.t,
        z: origin.z + dir.z * best.t,
      },
      n: best.n, shape: bestShape, t: best.t,
    };
  }

  // ---- the capsule mover ---------------------------------------------------
  // Substepped depenetration, not swept (spec):
  //   substeps = ceil(|disp| / 0.25); per substep, up to 4 iterations of
  //   gather-overlaps → push out along the deepest MTV → remove the velocity
  //   component into every contact normal (slide).
  // grounded = any contact n.y > 0.55 (records groundPlatformId);
  // wallN = strongest contact |n.y| < 0.35 probed with the capsule inflated.
  // Lift the substep STEP_H, replay it horizontally, depenetrate, then snap
  // back down onto whatever walkable surface is there. Null unless the result
  // gains real height (≤ STEP_H), keeps most of the intended horizontal step,
  // and lands on ground — so slope faces and shallow wall glides, which the
  // plain solver already handles smoothly, can never take this path.
  function tryStepUp(sx0, sy0, sz0, hx, hz, r, halfH) {
    // Advance at least r past the lip, not just one substep (~0.15m at walk
    // speed) — a shorter replay drops the capsule straddling the edge, whose
    // corner contact reads unwalkable. A thin barrier can't be hopped by the
    // extra reach: landing at the start height fails the min-gain gate.
    const hl = Math.hypot(hx, hz);
    const adv = Math.max(hl, r + 0.1);
    const q = { x: sx0 + (hx / hl) * adv, y: sy0 + STEP_H, z: sz0 + (hz / hl) * adv };
    for (let it = 0; it < MAX_ITERS; it++) {
      const cs = overlapCapsule(q, r, halfH);
      if (!cs.length) break;
      let deepest = cs[0];
      for (const c of cs) if (c.depth > deepest.depth) deepest = c;
      q.x += deepest.n.x * deepest.depth;
      q.y += deepest.n.y * deepest.depth;
      q.z += deepest.n.z * deepest.depth;
    }
    if (overlapCapsule(q, r, halfH).some((c) => c.depth > 0.02)) return null;
    let ground = null;
    for (let dropped = 0; dropped < STEP_H + 0.15; dropped += 0.1) {
      q.y -= 0.1;
      const cs = overlapCapsule(q, r, halfH);
      if (!cs.length) continue;
      let g = null;
      for (const c of cs) if (c.n.y > GROUND_NY && (!g || c.depth > g.depth)) g = c;
      if (!g) return null;             // dropped onto something unwalkable
      q.x += g.n.x * g.depth; q.y += g.n.y * g.depth; q.z += g.n.z * g.depth;
      ground = g;
      break;
    }
    if (!ground) return null;          // no floor within a step's drop — a ledge, not a step
    const gain = q.y - sy0;
    if (gain < STEP_MIN_GAIN || gain > STEP_H + 0.01) return null;
    const fwd = ((q.x - sx0) * hx + (q.z - sz0) * hz) / hl;
    if (fwd < STEP_MIN_FWD * hl) return null;
    return { q, ground };
  }

  function moveCapsule(pos, vel, disp, r = CAPSULE_R, halfH = CAPSULE_HALF_H, opts) {
    const stepUp = !!(opts && opts.stepUp);
    const p = { x: pos.x, y: pos.y, z: pos.z };
    const v = { x: vel.x, y: vel.y, z: vel.z };
    const dl = Math.hypot(disp.x, disp.y, disp.z);
    const steps = Math.max(1, Math.ceil(dl / SUBSTEP_LEN));
    const sx = disp.x / steps, sy = disp.y / steps, sz = disp.z / steps;
    const stepHLen = Math.hypot(sx, sz);
    let grounded = false, groundPlatformId = null, groundDepth = -1;
    for (let st = 0; st < steps; st++) {
      const sx0 = p.x, sy0 = p.y, sz0 = p.z;
      const v0 = { x: v.x, y: v.y, z: v.z };
      p.x += sx; p.y += sy; p.z += sz;
      let blocker = false;
      for (let it = 0; it < MAX_ITERS; it++) {
        const contacts = overlapCapsule(p, r, halfH);
        if (!contacts.length) break;
        let deepest = contacts[0];
        for (const c of contacts) if (c.depth > deepest.depth) deepest = c;
        p.x += deepest.n.x * deepest.depth;
        p.y += deepest.n.y * deepest.depth;
        p.z += deepest.n.z * deepest.depth;
        for (const c of contacts) {
          const vn = v.x * c.n.x + v.y * c.n.y + v.z * c.n.z;
          if (vn < 0) { v.x -= c.n.x * vn; v.y -= c.n.y * vn; v.z -= c.n.z * vn; }
          if (c.n.y > GROUND_NY && c.depth > groundDepth) {
            grounded = true;
            groundDepth = c.depth;
            groundPlatformId = c.shape.platformId;
          }
          // A lip: a contact opposing the horizontal step that is either a
          // wall face or a snaggy edge (steep-face contacts — real ramps —
          // never qualify, so their smooth solve is untouched).
          if (stepUp && stepHLen > EPS
            && (c.n.x * sx + c.n.z * sz) / stepHLen < STEP_OPPOSE
            && (c.n.y < GROUND_NY || (c.edge && c.n.y < STEP_EDGE_NY))) {
            blocker = true;
          }
        }
      }
      if (blocker) {
        const up = tryStepUp(sx0, sy0, sz0, sx, sz, r, halfH);
        if (up) {
          p.x = up.q.x; p.y = up.q.y; p.z = up.q.z;
          // The blocked iterations mangled v; restore the substep's incoming
          // velocity and slide it against the landing surface only, so the
          // step carries speed the way the prototype's ellipsoid roll did.
          v.x = v0.x; v.y = v0.y; v.z = v0.z;
          const g = up.ground;
          const vn = v.x * g.n.x + v.y * g.n.y + v.z * g.n.z;
          if (vn < 0) { v.x -= g.n.x * vn; v.y -= g.n.y * vn; v.z -= g.n.z * vn; }
          grounded = true;
          groundDepth = Math.max(groundDepth, g.depth);
          groundPlatformId = g.shape.platformId;
        }
      }
    }
    let wallN = null, wallDepth = 0;
    for (const c of overlapCapsule(p, r + WALL_INFLATE, halfH)) {
      if (Math.abs(c.n.y) < WALL_NY && c.depth > wallDepth) { wallDepth = c.depth; wallN = c.n; }
    }
    return { pos: p, vel: v, grounded, groundPlatformId, wallN };
  }

  return {
    shapes,
    addAabb, addObb, addVcyl,
    setShapeOffset, setShapeActive,
    overlapCapsule, raycast, moveCapsule,
  };
}
