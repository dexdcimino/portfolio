// All three forms are built from two primitives: a lofted cross-section run
// (fuselages, hulls, pontoons) and a Y-extruded outline (wings, decks, fins).
// Vertex colour carries paint in rgb and an emissive flag in alpha.

import { WHEEL, ROVER } from '../tune.js';

const HULL   = [0.855, 0.875, 0.835, 0];
const PANEL  = [0.208, 0.259, 0.290, 0];
const DARK   = [0.106, 0.145, 0.169, 0];
/* Tyre carcass and tread. The same black as DARK — this is not a new paint, it
   is a new FINISH. Alpha is the craft shader's finish flag: 0 ordinary paint,
   1 emissive, and 0.5 matte, which costs no new vertex attribute because the
   mesh already carries a vec4 per vertex.
   Rubber was taking the full hull rim light, so the tread read as wet paint at
   roughly the same value as the painted panels beside it. Hubs, beadlocks and
   bolt heads stay HULL and PANEL and keep their finish — the contrast between
   dead tread and bright hardware is the point. */
const RUBBER = [0.106, 0.145, 0.169, 0.5];
const AMBER  = [1.000, 0.690, 0.239, 0];
const GLASS  = [0.094, 0.341, 0.412, 0];
const GLOW   = [0.169, 0.878, 0.784, 1];
const CHUTE  = [0.925, 0.400, 0.243, 0];
const CHUTE_B = [0.965, 0.851, 0.706, 0];
const HOT    = [1.000, 0.451, 0.298, 1];

export class Geo {
  constructor() { this.pos = []; this.nrm = []; this.col = []; }

  // Negated: these solids are wound Babylon's way (clockwise / front-facing),
  // and for that winding the raw cross product points inward.
  tri(a, b, c, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = -(uy * vz - uz * vy), ny = -(uz * vx - ux * vz), nz = -(ux * vy - uy * vx);
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    for (let i = 0; i < 3; i++) this.col.push(col[0], col[1], col[2], col[3]);
  }

  quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); }

  /** Loft a run of same-sized cross sections along Z. */
  loft(sections, col, capStart = true, capEnd = true) {
    for (let s = 0; s < sections.length - 1; s++) {
      const A = sections[s], B = sections[s + 1];
      const n = A.pts.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        this.quad(
          [A.pts[i][0], A.pts[i][1], A.z],
          [B.pts[i][0], B.pts[i][1], B.z],
          [B.pts[j][0], B.pts[j][1], B.z],
          [A.pts[j][0], A.pts[j][1], A.z],
          col);
      }
    }
    // Both end caps were wound inward while the side walls were correct, so
    // every lofted hull — rover chassis, boat pontoons, jet fuselage — had its
    // two end discs lit from inside the solid.
    const cap = (S, flip) => {
      const n = S.pts.length;
      for (let i = 1; i < n - 1; i++) {
        const p = (k) => [S.pts[k][0], S.pts[k][1], S.z];
        if (flip) this.tri(p(0), p(i), p(i + 1), col);
        else this.tri(p(0), p(i + 1), p(i), col);
      }
    };
    if (capStart) cap(sections[0], true);
    if (capEnd) cap(sections[sections.length - 1], false);
  }

  /** Extrude a convex XZ outline between two heights. */
  extrudeY(outline, y0, y1, col) {
    const n = outline.length;
    for (let i = 1; i < n - 1; i++) {
      this.tri([outline[0][0], y1, outline[0][1]],
        [outline[i][0], y1, outline[i][1]],
        [outline[i + 1][0], y1, outline[i + 1][1]], col);
      this.tri([outline[0][0], y0, outline[0][1]],
        [outline[i + 1][0], y0, outline[i + 1][1]],
        [outline[i][0], y0, outline[i][1]], col);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad(
        [outline[i][0], y0, outline[i][1]],
        [outline[j][0], y0, outline[j][1]],
        [outline[j][0], y1, outline[j][1]],
        [outline[i][0], y1, outline[i][1]], col);
    }
  }

  /**
   * A box centred at (cx,cy,cz), rotated about the X axis. Tread lugs are
   * built with this so they sit square on the tyre carcass and turn with it.
   */
  boxX(cx, cy, cz, hw, hh, hd, ang, col) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const p = (sx, sy, sz) => [
      cx + sx * hw,
      cy + sy * hh * c - sz * hd * s,
      cz + sy * hh * s + sz * hd * c,
    ];
    const v = [
      p(-1, -1, -1), p(1, -1, -1), p(1, 1, -1), p(-1, 1, -1),
      p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1),
    ];
    // All six wound so the stored normal points out of the box. Every one of
    // these was reversed, which is what made the tyre tread read inside-out.
    this.quad(v[1], v[2], v[3], v[0], col);
    this.quad(v[7], v[6], v[5], v[4], col);
    this.quad(v[4], v[5], v[1], v[0], col);
    this.quad(v[2], v[6], v[7], v[3], col);
    this.quad(v[3], v[7], v[4], v[0], col);
    this.quad(v[5], v[6], v[2], v[1], col);
  }

  /** Cylinder around the X axis — wheels and thruster rings. */
  cylX(cx, cy, cz, r, halfW, sides, col) {
    const ring = (sign) => {
      const out = [];
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        out.push([cx + sign * halfW, cy + Math.cos(a) * r, cz + Math.sin(a) * r]);
      }
      return out;
    };
    const L = ring(-1), R = ring(1);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.quad(L[i], R[i], R[j], L[j], col);
      // Caps reversed from how they were: the side wall was outward-facing but
      // both end discs pointed into the solid, so a wheel's rim and hub faces
      // were lit from inside.
      this.tri([cx - halfW, cy, cz], L[i], L[j], col);
      this.tri([cx + halfW, cy, cz], R[j], R[i], col);
    }
  }

  /** Cylinder around Z — engine nacelles. */
  cylZ(cx, cy, cz, r, halfL, sides, col, cap = true) {
    const ring = (sign) => {
      const out = [];
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz + sign * halfL]);
      }
      return out;
    };
    const B = ring(-1), F = ring(1);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      // Every face of this one was inside-out. A ring in XY extruded along Z
      // has the opposite handedness to an outline in XZ extruded along Y, so
      // copying extrudeY's vertex order — which is correct — inverts it.
      this.quad(F[i], F[j], B[j], B[i], col);
      if (cap) {
        this.tri([cx, cy, cz - halfL], B[i], B[j], col);
        this.tri([cx, cy, cz + halfL], F[j], F[i], col);
      }
    }
  }

  /**
   * Mirror everything built so far across X, properly.
   *
   * NOT `mesh.scaling.x = -1`, which is how the three left wheels came to be
   * facing inwards in the first place — a negative scale flips the winding, so
   * Babylon culls the outside and lights the inside, and the mesh reads as
   * turned in on itself. This negates x on the positions, SWAPS two vertices of
   * every triangle to put the winding back, and recomputes each normal through
   * the same negated cross product `tri` uses, so a mirrored solid obeys the
   * same convention as an unmirrored one and the suite's signed-volume check
   * means the same thing on both sides.
   *
   * `mirrorOutline` already does this for the jet's 2D outlines; this is the
   * same idea for geometry that is already built.
   */
  mirrorX() {
    const p = this.pos, n = this.nrm;
    for (let i = 0; i < p.length; i += 9) {
      const a = [-p[i], p[i + 1], p[i + 2]];
      const b = [-p[i + 3], p[i + 4], p[i + 5]];
      const c = [-p[i + 6], p[i + 7], p[i + 8]];
      // b and c swapped: mirroring reverses handedness and this restores it.
      p[i] = a[0]; p[i + 1] = a[1]; p[i + 2] = a[2];
      p[i + 3] = c[0]; p[i + 4] = c[1]; p[i + 5] = c[2];
      p[i + 6] = b[0]; p[i + 7] = b[1]; p[i + 8] = b[2];
      const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2];
      const vx = b[0] - a[0], vy = b[1] - a[1], vz = b[2] - a[2];
      let nx = -(uy * vz - uz * vy), ny = -(uz * vx - ux * vz), nz = -(ux * vy - uy * vx);
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 3; k++) { n[i + k * 3] = nx; n[i + k * 3 + 1] = ny; n[i + k * 3 + 2] = nz; }
    }
    return this;
  }

  toMesh(scene, name, material) {
    const mesh = new BABYLON.Mesh(name, scene);
    const vd = new BABYLON.VertexData();
    vd.positions = this.pos;
    vd.normals = this.nrm;
    vd.colors = this.col;
    const idx = new Array(this.pos.length / 3);
    for (let i = 0; i < idx.length; i++) idx[i] = i;
    vd.indices = idx;
    vd.applyToMesh(mesh, false);
    mesh.material = material;
    mesh.hasVertexAlpha = false;
    mesh.isPickable = false;
    mesh.renderingGroupId = 1;
    return mesh;
  }
}

// Regular n-gon cross section, squashed to width/height.
function ngon(n, w, h, yOff = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    pts.push([Math.cos(a) * w, Math.sin(a) * h + yOff]);
  }
  return pts;
}

// ---- form 1: six-wheeled ground rover ---------------------------------

/**
 * The auto-deploy canopy, carried by the rover and the boat.
 *
 * Built once with the form and scaled up out of nothing when it opens, so the
 * deploy costs no allocation at the one moment you would notice a hitch.
 *
 * EVERY FACE IS WOUND BOTH WAYS, deliberately. You see this thing almost
 * entirely from underneath — hanging under it is the entire point — and the
 * shared vehicle material is back-face culled like everything else here, so a
 * single-sided dome would be invisible in exactly the shot it exists for.
 * Doubling 140 quads is cheaper than a second material.
 */
function buildChute(scene, mat, name) {
  const g = new Geo();
  const RINGS = 5, SEGS = 14, R = 3.1, H = 1.5;
  const at = (ring, seg) => {
    const t = ring / RINGS;                    // 0 at the crown, 1 at the hem
    const a = (seg / SEGS) * Math.PI * 2;
    // A flattened dome with a little flare at the hem, so it reads as loaded
    // fabric rather than as half a ball.
    const r = Math.sin(t * Math.PI * 0.5) * R * (1 + t * t * 0.10);
    const y = Math.cos(t * Math.PI * 0.5) * H;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };
  for (let ring = 0; ring < RINGS; ring++) {
    for (let seg = 0; seg < SEGS; seg++) {
      const a = at(ring, seg), b = at(ring, seg + 1);
      const c = at(ring + 1, seg + 1), d = at(ring + 1, seg);
      // Alternating gores. This is what makes the canopy's rotation legible —
      // a single-colour dome spinning looks like a dome standing still.
      const col = seg % 2 ? CHUTE : CHUTE_B;
      g.tri(a, b, c, col); g.tri(a, c, d, col);
      g.tri(c, b, a, col); g.tri(d, c, a, col);
    }
  }
  // Shroud lines, converging on the hardpoint the vehicle hangs from.
  for (let seg = 0; seg < SEGS; seg += 2) {
    const hem = at(RINGS, seg);
    const w = 0.05;
    const p0 = [hem[0], hem[1], hem[2]], p1 = [hem[0] + w, hem[1], hem[2] + w];
    const p2 = [w, -2.6, w], p3 = [0, -2.6, 0];
    g.tri(p0, p1, p2, DARK); g.tri(p0, p2, p3, DARK);
    g.tri(p2, p1, p0, DARK); g.tri(p3, p2, p0, DARK);
  }
  const mesh = g.toMesh(scene, name, mat);
  mesh.setEnabled(false);
  return mesh;
}

export function buildRover(scene, mat) {
  const root = new BABYLON.TransformNode('rover', scene);
  const g = new Geo();

  // Chassis — a flattened hex tube, tapered at the nose.
  g.loft([
    { z: -2.40, pts: ngon(6, 0.86, 0.38, 1.02) },
    { z: -1.90, pts: ngon(6, 1.06, 0.46, 1.00) },
    { z: 1.30, pts: ngon(6, 1.06, 0.46, 1.00) },
    { z: 2.10, pts: ngon(6, 0.92, 0.40, 0.98) },
    { z: 2.62, pts: ngon(6, 0.54, 0.26, 0.94) },
  ], PANEL);

  // Deck plate and side rails.
  g.extrudeY([[-1.02, -2.30], [1.02, -2.30], [1.02, 2.10], [-1.02, 2.10]], 1.34, 1.44, HULL);
  g.extrudeY([[-1.30, -2.10], [-1.06, -2.10], [-1.06, 1.80], [-1.30, 1.80]], 1.10, 1.30, DARK);
  g.extrudeY([[1.06, -2.10], [1.30, -2.10], [1.30, 1.80], [1.06, 1.80]], 1.10, 1.30, DARK);

  // Cabin pod with a raked canopy.
  g.loft([
    { z: -0.30, pts: ngon(6, 0.70, 0.44, 1.86) },
    { z: 0.55, pts: ngon(6, 0.76, 0.48, 1.88) },
    { z: 1.30, pts: ngon(6, 0.62, 0.34, 1.80) },
  ], HULL);
  g.extrudeY([[-0.52, 0.60], [0.52, 0.60], [0.42, 1.34], [-0.42, 1.34]], 1.92, 2.06, GLASS);

  // Survey mast and dish at the stern.
  g.extrudeY([[-0.10, -1.90], [0.10, -1.90], [0.10, -1.70], [-0.10, -1.70]], 1.44, 3.00, DARK);
  g.cylZ(0, 3.05, -1.80, 0.46, 0.06, 10, HULL);
  g.cylZ(0, 3.05, -1.72, 0.14, 0.10, 8, GLOW);

  // Light bar forward, thruster vents aft.
  // HULL, not amber. Cyan is the only accent this game reserves — it means
  // technology, and it is the one saturated hue in the palette — so a second
  // warm accent on the hull was reading as something left over rather than
  // something meant.
  g.extrudeY([[-0.70, 2.28], [0.70, 2.28], [0.70, 2.40], [-0.70, 2.40]], 1.30, 1.46, HULL);
  g.cylZ(-0.52, 1.02, -2.46, 0.28, 0.12, 10, GLOW);
  g.cylZ(0.52, 1.02, -2.46, 0.28, 0.12, 10, GLOW);

  const body = g.toMesh(scene, 'roverBody', mat);
  body.parent = root;

  // Six independently sprung wheels. The mount height is derived from the
  // tyre radius and the ride height so the tread always meets the ground:
  // at rest the bottom of the tyre is exactly on the root plane.
  const restY = WHEEL.radius - ROVER.rideHeight;
  const wheels = [];
  const struts = [];
  const arms = [];

  for (const z of WHEEL.axles) {
    for (const sx of [-1, 1]) {
      // Mirrored geometry per side, not a mirrored transform. The hub, the
      // rim bolts and the beadlock all sit on one face of the wheel, so an
      // unmirrored left wheel presents that face INWARD — which is exactly
      // what the three left wheels were doing.
      const w = buildWheel(scene, mat, `wheel_${z}_${sx}`, sx);
      w.parent = root;
      w.position.set(sx * WHEEL.track, restY, z);
      w.metadata = { restY, side: sx, lx: sx * WHEEL.track, lz: z, travel: 0 };
      wheels.push(w);

      // Gas strut: a fixed sleeve on the chassis and a chromed piston that
      // slides out of it. The piston is a unit-length cylinder anchored at
      // its top, so scaling.y IS the extension.
      const sg = new Geo();
      sg.cylZ(0, 0, 0, 0.15, 0.5, 8, PANEL);
      const sleeve = sg.toMesh(scene, `sleeve_${z}_${sx}`, mat);
      sleeve.parent = root;
      sleeve.rotation.x = Math.PI / 2;
      sleeve.position.set(sx * (WHEEL.track - 0.30), restY + 0.86, z);

      const pg = new Geo();
      // Built downward from the origin so scaling.y extends it toward the hub.
      pg.cylZ(0, 0, -0.5, 0.085, 0.5, 8, HULL);
      const piston = pg.toMesh(scene, `piston_${z}_${sx}`, mat);
      piston.parent = root;
      piston.rotation.x = -Math.PI / 2;
      piston.position.set(sx * (WHEEL.track - 0.30), restY + 0.86, z);
      piston.metadata = { anchorY: restY + 0.86, restY };
      struts.push(piston);

      // Trailing arm from the chassis out to the hub.
      const ag = new Geo();
      ag.extrudeY([[-0.11, -0.17], [0.11, -0.17], [0.11, 0.17], [-0.11, 0.17]], 0, 0.62, PANEL);
      const arm = ag.toMesh(scene, `arm_${z}_${sx}`, mat);
      arm.parent = root;
      arm.position.set(sx * (WHEEL.track - 0.62), restY + 0.10, z);
      arm.rotation.z = sx * -0.62;
      arm.metadata = { baseY: restY + 0.10, baseRoll: sx * -0.62, side: sx };
      arms.push(arm);
    }
  }

  const chute = buildChute(scene, mat, 'roverChute');
  chute.parent = root;

  root.setEnabled(false);
  return { root, body, wheels, arms, struts, restY, chute };
}

/**
 * One lugged tyre. Built around the X axis because that is the axis it spins
 * on: a carcass, two staggered rows of tread blocks, a beadlock rim and a hub.
 */
export function buildWheel(scene, mat, name, side = 1) {
  const g = new Geo();
  const R = WHEEL.radius, W = WHEEL.halfWidth;

  // Carcass and sidewalls. The lugs stand proud of the carcass and their outer
  // face lands exactly on WHEEL.radius, so the radius in tune.js is the real
  // rolling radius rather than an approximation of one.
  g.cylX(0, 0, 0, R - WHEEL.lugDepth, W * 0.86, 14, RUBBER);
  g.cylX(0, 0, 0, R * 0.80, W, 14, PANEL);

  // Two staggered rows of tread blocks — the stagger is what makes it read as
  // a mud tyre rather than a ribbed cylinder.
  const rowW = W * WHEEL.lugWidth;
  for (let i = 0; i < WHEEL.lugs; i++) {
    const a = (i / WHEEL.lugs) * Math.PI * 2;
    const rMid = R - WHEEL.lugDepth * 0.9;
    for (const row of [-1, 1]) {
      const ang = a + (row > 0 ? Math.PI / WHEEL.lugs : 0);
      g.boxX(row * W * 0.46, Math.cos(ang) * rMid, Math.sin(ang) * rMid,
        rowW, WHEEL.lugDepth * 0.9, R * 0.20, ang, RUBBER);
    }
  }

  // Beadlock rim with bolt heads, then the hub and drive spokes.
  g.cylX(0, 0, 0, R * 0.60, W * 1.04, 12, HULL);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rr = R * 0.60;
    g.boxX(W * 1.02, Math.cos(a) * rr, Math.sin(a) * rr, 0.05, 0.07, 0.07, a, HULL);
  }
  g.cylX(0, 0, 0, R * 0.26, W * 1.16, 8, PANEL);
  g.cylX(0, 0, 0, R * 0.12, W * 1.22, 6, GLOW);

  if (side < 0) g.mirrorX();
  return g.toMesh(scene, name, mat);
}

// ---- form 2: hydrofoil survey boat -------------------------------------

export function buildBoat(scene, mat) {
  const root = new BABYLON.TransformNode('boat', scene);
  const g = new Geo();

  // Twin pontoons with knifed bows.
  for (const sx of [-1.28, 1.28]) {
    g.loft([
      { z: -2.70, pts: ngon(6, 0.46, 0.34, 0.10) },
      { z: -1.60, pts: ngon(6, 0.54, 0.42, 0.10) },
      { z: 1.40, pts: ngon(6, 0.54, 0.42, 0.10) },
      { z: 2.60, pts: ngon(6, 0.34, 0.30, 0.16) },
      { z: 3.30, pts: ngon(6, 0.10, 0.14, 0.26) },
    ].map((s) => ({ z: s.z, pts: s.pts.map((p) => [p[0] + sx, p[1]]) })), PANEL);
  }

  // Deck bridging the hulls, plus a spine keel.
  g.extrudeY([[-1.70, -2.20], [1.70, -2.20], [1.42, 2.30], [-1.42, 2.30]], 0.44, 0.60, HULL);
  g.loft([
    { z: -2.10, pts: ngon(6, 0.34, 0.24, 0.30) },
    { z: 1.90, pts: ngon(6, 0.40, 0.30, 0.30) },
    { z: 2.90, pts: ngon(6, 0.14, 0.16, 0.34) },
  ], DARK);

  // Cockpit pod, swept back.
  g.loft([
    { z: -0.70, pts: ngon(6, 0.66, 0.42, 1.02) },
    { z: 0.30, pts: ngon(6, 0.72, 0.46, 1.04) },
    { z: 1.25, pts: ngon(6, 0.48, 0.30, 0.94) },
  ], HULL);
  g.extrudeY([[-0.46, 0.35], [0.46, 0.35], [0.34, 1.20], [-0.34, 1.20]], 1.08, 1.22, GLASS);

  // Hydrofoil struts and the foil itself, under the waterline.
  for (const sx of [-1.28, 1.28]) {
    g.extrudeY([[sx - 0.09, -0.90], [sx + 0.09, -0.90], [sx + 0.09, -0.60], [sx - 0.09, -0.60]], -0.90, 0.10, DARK);
  }
  g.extrudeY([[-1.90, -0.86], [1.90, -0.86], [1.74, -0.62], [-1.74, -0.62]], -0.96, -0.86, PANEL);

  // Water-jet stack.
  g.cylZ(-1.28, 0.16, -2.86, 0.30, 0.20, 10, DARK);
  g.cylZ(1.28, 0.16, -2.86, 0.30, 0.20, 10, DARK);
  g.cylZ(-1.28, 0.16, -3.02, 0.20, 0.06, 10, GLOW);
  g.cylZ(1.28, 0.16, -3.02, 0.20, 0.06, 10, GLOW);
  g.extrudeY([[-0.60, -2.50], [0.60, -2.50], [0.60, -2.36], [-0.60, -2.36]], 0.62, 0.78, AMBER);

  const body = g.toMesh(scene, 'boatBody', mat);
  body.parent = root;

  const jetL = new BABYLON.TransformNode('boatJetL', scene);
  jetL.parent = root; jetL.position.set(-1.28, 0.16, -3.1);
  const jetR = new BABYLON.TransformNode('boatJetR', scene);
  jetR.parent = root; jetR.position.set(1.28, 0.16, -3.1);

  const chute = buildChute(scene, mat, 'boatChute');
  chute.parent = root;

  root.setEnabled(false);
  return { root, body, jets: [jetL, jetR], chute };
}

// ---- form 3: alien delta jet -------------------------------------------

/**
 * Mirroring an outline across X reverses its winding, so the point order has
 * to be reversed to put it back. Get this wrong and one side of the aircraft
 * renders inside-out, which is nearly invisible in motion — and it is exactly
 * the trap that has already caught three meshes in this repo.
 */
export const mirrorOutline = (pts, s) => (s > 0
  ? pts.slice().reverse()
  : pts.map((p) => [-p[0], p[1]]));

/** Flared exhaust petals around a throat, so it reads as a nozzle not a pipe. */
function nozzle(g, cz, rThroat, rLip, len, petals, col) {
  const TAU = Math.PI * 2;
  for (let i = 0; i < petals; i++) {
    const a0 = (i / petals) * TAU, a1 = ((i + 0.84) / petals) * TAU;
    const t0 = [Math.cos(a0) * rThroat, Math.sin(a0) * rThroat, cz];
    const t1 = [Math.cos(a1) * rThroat, Math.sin(a1) * rThroat, cz];
    const l0 = [Math.cos(a0) * rLip, Math.sin(a0) * rLip, cz - len];
    const l1 = [Math.cos(a1) * rLip, Math.sin(a1) * rLip, cz - len];
    // Same vertex cycle as cylZ: back[i], back[j], front[j], front[i].
    g.quad(l0, l1, t1, t0, col);
  }
}

/**
 * The jet's mirrored outlines, exported so the harness can check each side
 * independently. A total signed volume can look healthy while one wing is
 * inside-out, so the per-side check is the one that matters.
 */
export const JET_OUTLINES = {
  // Cranked delta: hard leading-edge sweep, kinked trailing edge, tips well
  // aft. The silhouette has to be legible at 200m against fog.
  WING: [
    [0.58, 2.05], [2.32, 0.20], [3.98, -1.62],
    [3.72, -2.34], [1.48, -2.28], [0.58, -1.86],
  ],
  // A narrow band tracking the leading edge, raised and in bone.
  EDGE: [
    [0.62, 2.02], [2.34, 0.17], [4.00, -1.64],
    [3.86, -1.86], [2.24, -0.06], [0.66, 1.74],
  ],
  FIN: [[0.26, -1.80], [0.40, -1.80], [0.90, -3.02], [0.76, -3.02]],
  FENCE: [[2.62, -0.42], [2.74, -0.42], [2.74, -1.36], [2.62, -1.36]],
};

export function buildJet(scene, mat) {
  const root = new BABYLON.TransformNode('jet', scene);
  const g = new Geo();

  // Blended body — the fuselage widens into the wing root rather than sitting
  // on top of it, which is what makes the planform read as one shape.
  g.loft([
    { z: -3.10, pts: ngon(8, 0.44, 0.38) },
    { z: -2.10, pts: ngon(8, 0.62, 0.50) },
    { z: -0.60, pts: ngon(8, 0.78, 0.56) },
    { z: 0.95, pts: ngon(8, 0.74, 0.52) },
    { z: 2.35, pts: ngon(8, 0.54, 0.40) },
    { z: 3.55, pts: ngon(8, 0.28, 0.21) },
    { z: 4.40, pts: ngon(8, 0.05, 0.05) },
  ], HULL);

  // Cranked delta: hard leading-edge sweep, kinked trailing edge, tips well
  // aft. The silhouette has to be legible at 200m against fog.
  const { WING, EDGE, FIN, FENCE } = JET_OUTLINES;

  for (const s of [-1, 1]) {
    g.extrudeY(mirrorOutline(WING, s), -0.09, 0.15, PANEL);
    g.extrudeY(mirrorOutline(EDGE, s), 0.12, 0.21, HULL);
    g.extrudeY(mirrorOutline(FIN, s), 0.26, 1.34, PANEL);
    // Wing fence, so the wing has a hard edge to catch the band light.
    g.extrudeY(mirrorOutline(FENCE, s), 0.15, 0.40, DARK);

    // Shoulder intake with a dark mouth, feeding the single nozzle.
    g.loft([
      { z: 0.05, pts: ngon(4, 0.30, 0.25, 0.16).map((p) => [p[0] + s * 0.92, p[1]]) },
      { z: 1.10, pts: ngon(4, 0.36, 0.30, 0.18).map((p) => [p[0] + s * 0.96, p[1]]) },
      { z: 1.82, pts: ngon(4, 0.29, 0.25, 0.15).map((p) => [p[0] + s * 0.92, p[1]]) },
    ], PANEL);
    g.cylZ(s * 0.94, 0.16, 1.86, 0.21, 0.05, 6, DARK);
  }

  // Canopy: a raised bubble rather than a flat pane.
  g.loft([
    { z: 0.50, pts: ngon(6, 0.32, 0.17, 0.58) },
    { z: 1.25, pts: ngon(6, 0.40, 0.25, 0.63) },
    { z: 2.15, pts: ngon(6, 0.26, 0.15, 0.55) },
  ], GLASS);

  // Spine of survey lamps, nose sensor strip.
  g.extrudeY([[-0.15, -1.95], [0.15, -1.95], [0.15, 0.05], [-0.15, 0.05]], 0.56, 0.63, GLOW);
  g.extrudeY([[-0.46, 3.15], [0.46, 3.15], [0.33, 3.62], [-0.33, 3.62]], -0.09, 0.03, AMBER);

  // One central nozzle: throat, flared petals, hot inner ring.
  g.cylZ(0, 0, -2.90, 0.40, 0.30, 10, PANEL);
  nozzle(g, -3.18, 0.40, 0.56, 0.44, 10, PANEL);
  g.cylZ(0, 0, -3.34, 0.33, 0.12, 10, HOT);

  const body = g.toMesh(scene, 'jetBody', mat);
  body.parent = root;

  // Empty nodes the trail ribbons hang off.
  const tipL = new BABYLON.TransformNode('tipL', scene);
  tipL.parent = root; tipL.position.set(-3.85, 0.06, -1.95);
  const tipR = new BABYLON.TransformNode('tipR', scene);
  tipR.parent = root; tipR.position.set(3.85, 0.06, -1.95);
  // An empty Mesh, not a TransformNode: particle emitters expect AbstractMesh.
  const exhaust = new BABYLON.Mesh('exhaust', scene);
  exhaust.parent = root; exhaust.position.set(0, 0, -3.5);

  root.setEnabled(false);
  return { root, body, tips: [tipL, tipR], exhaust };
}
