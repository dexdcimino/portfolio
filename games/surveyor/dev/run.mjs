import { BABYLON, opts } from './babylon-stub.mjs';
globalThis.BABYLON = BABYLON;

const { ChunkField } = await import('../js/world/chunks.js');
const { Water } = await import('../js/world/water.js');
const { buildRover, buildBoat, buildJet } = await import('../js/player/meshes.js');
const { Craft } = await import('../js/player/craft.js');
const { Survey } = await import('../js/game/survey.js');
const { Colonies } = await import('../js/game/colony.js');
const { Sound } = await import('../js/audio/index.js');
const { WORLD, ROVER, BOAT, HOP, JET, SUSP, WHEEL, COLONY, PLANETS } =
  await import('../js/tune.js');
const { on } = await import('../js/core/events.js');
const { makePlanet, faceDir, dirToFace, arcBetween, TangentFrame } =
  await import('../js/world/sphere.js');
const { Surface, findSpawn, splitNode } = await import('../js/world/surface.js');
const { appendRocks } = await import('../js/world/scatter.js');

// One world for phase 2. A second, tiny profile is built alongside it purely so
// the suite can prove the conversion is radius-independent.
const HOME = makePlanet(PLANETS.home);
const SMALL = makePlanet(Object.assign({}, PLANETS.home, {
  key: 'small', name: 'Small', radius: 207, relief: 207 / 20, seed: 'surveyor-small',
}));

// Every craft needs a surface. Spawns land on dry, reasonably flat ground.
const spawnOn = (planet) =>
  new Surface(planet, findSpawn(planet, planet.relief * 0.12, planet.relief * 0.75));
const newCraft = (planet) => new Craft(forms, spawnOn(planet || HOME));

const IN = (o = {}) => Object.assign(
  { fwd: 0, turn: 0, pitch: 0, roll: 0, boost: false, hopHeld: false, hopPress: false, mode: null }, o);

let fails = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? ' PASS' : ' FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!cond) fails++;
};

const scene = new BABYLON.Scene();
const mat = new BABYLON.ShaderMaterial('m');

// ---- 1. craft geometry -------------------------------------------------
const forms = {
  rover: buildRover(scene, mat),
  boat: buildBoat(scene, mat),
  jet: buildJet(scene, mat),
};
ok('rover geometry builds', forms.rover.body.vertexCount > 0,
  forms.rover.body.vertexCount + ' verts, ' + forms.rover.wheels.length + ' wheels');
ok('rover has six wheels', forms.rover.wheels.length === 6);
ok('boat geometry builds', forms.boat.body.vertexCount > 0, forms.boat.body.vertexCount + ' verts');
ok('jet geometry builds', forms.jet.body.vertexCount > 0, forms.jet.body.vertexCount + ' verts');
ok('jet has two wingtip anchors', forms.jet.tips.length === 2);

// Winding. Babylon treats clockwise as front-facing, so a correctly built
// solid has a NEGATIVE signed volume — its own CreateSphere does.
const signedVolume = (m) => {
  const p = m._vd.position;
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    const a = [p[i], p[i + 1], p[i + 2]];
    const b = [p[i + 3], p[i + 4], p[i + 5]];
    const c = [p[i + 6], p[i + 7], p[i + 8]];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) +
      a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
};
for (const [name, form] of Object.entries(forms)) {
  ok(`${name} hull is wound the right way out`, signedVolume(form.body) < 0,
    'signed volume ' + signedVolume(form.body).toFixed(2));
}
// Per-side, because a total can be healthy while one wing is inside-out —
// which is exactly what happened while building this jet.
const { Geo, mirrorOutline, JET_OUTLINES } = await import('../js/player/meshes.js');
for (const [name, pts] of Object.entries(JET_OUTLINES)) {
  const sides = [-1, 1].map((s) => {
    const g = new Geo();
    g.extrudeY(mirrorOutline(pts, s), -0.09, 0.15, [1, 1, 1, 0]);
    return signedVolume(g.toMesh(scene, 'probe', mat));
  });
  ok(`jet ${name} is the right way out on both sides`, sides.every((v) => v < 0),
    `left ${sides[0].toFixed(3)}, right ${sides[1].toFixed(3)}`);
}

// Every Geo primitive, face by face, against its own centre.
//
// This is the check that should have existed from the start. Signed volume on a
// finished hull hides everything: four of the five primitives here had reversed
// faces — boxX and cylZ entirely, cylX's end discs, loft's end caps — and the
// rover, boat and jet all still reported a healthy negative volume because the
// correct side walls outweighed the inverted caps.
{
  const unit = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const COL = [1, 1, 1, 0];
  const faces = (g) => {
    const p = g.pos, n = g.nrm;
    let inward = 0;
    for (let i = 0; i < p.length; i += 9) {
      const cx = (p[i] + p[i + 3] + p[i + 6]) / 3;
      const cy = (p[i + 1] + p[i + 4] + p[i + 7]) / 3;
      const cz = (p[i + 2] + p[i + 5] + p[i + 8]) / 3;
      const l = Math.hypot(cx, cy, cz) || 1;
      if ((cx * n[i] + cy * n[i + 1] + cz * n[i + 2]) / l <= 0) inward++;
    }
    return inward;
  };
  const build = (fn) => { const g = new Geo(); fn(g); return g; };
  const prims = {
    cylX: (g) => g.cylX(0, 0, 0, 1, 1, 12, COL),
    cylZ: (g) => g.cylZ(0, 0, 0, 1, 1, 12, COL),
    boxX: (g) => g.boxX(0, 0, 0, 1, 1, 1, 0, COL),
    extrudeY: (g) => g.extrudeY(unit, -1, 1, COL),
    loft: (g) => g.loft([{ z: -1, pts: unit }, { z: 1, pts: unit }], COL),
  };
  for (const [name, fn] of Object.entries(prims)) {
    const bad = faces(build(fn));
    ok('Geo.' + name + ': every face points out of the solid', bad === 0,
      bad === 0 ? 'clean' : bad + ' faces reversed');
  }
}

// ---- 2. the sphere itself ----------------------------------------------
const { height, surfaceHeight, depthAt, isWater, waveAt } =
  await import('../js/world/noise.js');

// The cube-sphere chart must be an exact bijection, or terrain tears.
let chartErr = 0;
const sphereWalk = (n, fn) => {
  const GOLD = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * GOLD;
    fn({ x: Math.cos(a) * r, y, z: Math.sin(a) * r }, i);
  }
};
sphereWalk(20000, (d) => {
  const fc = dirToFace(d.x, d.y, d.z, {});
  const back = faceDir(fc.f, fc.u, fc.v, {});
  chartErr = Math.max(chartErr, Math.hypot(back.x - d.x, back.y - d.y, back.z - d.z));
});
ok('the cube-sphere chart round-trips exactly', chartErr < 1e-12,
  'worst error ' + chartErr.toExponential(1));

// Shared face edges must agree, or heights differ either side of a seam.
let seamErr = 0;
for (const v of [-0.97, -0.5, 0, 0.5, 0.97]) {
  const pairs = [[0, 1, 5, -1], [1, 1, 4, -1], [4, 1, 0, -1], [5, 1, 1, -1]];
  for (const [fa, ua, fb, ub] of pairs) {
    const a = faceDir(fa, ua, v, {}), b = faceDir(fb, ub, v, {});
    seamErr = Math.max(seamErr, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
  }
}
ok('adjacent cube faces share their edges', seamErr < 1e-12,
  'worst gap ' + seamErr.toExponential(1));

/**
 * The pole test. This is what a cube-sphere buys over lat/long: sample cell
 * areas near a "pole" (a cube-face centre and a cube corner) and confirm none
 * of them collapse. On a lat/long chart the ratio runs away to zero.
 */
const cellArea = (f, u, v, c) => {
  const p00 = faceDir(f, u, v, {}), p10 = faceDir(f, u + c, v, {});
  const p01 = faceDir(f, u, v + c, {});
  const ax = p10.x - p00.x, ay = p10.y - p00.y, az = p10.z - p00.z;
  const bx = p01.x - p00.x, by = p01.y - p00.y, bz = p01.z - p00.z;
  return Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
};
let aMin = Infinity, aMax = 0;
const cc = 2 / 64;
for (let f = 0; f < 6; f++) {
  for (let i = 0; i < 64; i += 4) {
    for (let j = 0; j < 64; j += 4) {
      const a = cellArea(f, -1 + i * cc, -1 + j * cc, cc);
      aMin = Math.min(aMin, a); aMax = Math.max(aMax, a);
    }
  }
}
// A plain normalised cube gives 3^1.5 = 5.20:1; the tangent warp in
// sphere.js pulls that down. Either way the point is that it is BOUNDED and
// non-zero — on a lat/long chart this ratio runs to infinity at the poles.
ok('no degenerate cells anywhere on the sphere', aMin > 0 && aMax / aMin < 2.0,
  'cell area ratio ' + (aMax / aMin).toFixed(2) + ':1 (naive cube is 5.20, lat/long is unbounded)');

// Relief must stay inside the radius budget on both worlds.
for (const P of [HOME, SMALL]) {
  let lo = Infinity, hi = -Infinity, wet = 0, n = 0;
  sphereWalk(12000, (d) => {
    const h = height(d, P);
    lo = Math.min(lo, h); hi = Math.max(hi, h); n++;
    if (h < -0.35) wet++;
  });
  ok(P.name + ': relief fits the radius budget', hi <= P.relief * 1.05 && lo > -P.relief,
    'range ' + lo.toFixed(1) + '..' + hi.toFixed(1) + 'm, cap ' + P.relief.toFixed(1) +
    'm, water ' + (100 * wet / n).toFixed(0) + '%');
  ok(P.name + ': has both land and usable water',
    wet / n > 0.10 && wet / n < 0.75, (100 * wet / n).toFixed(0) + '% water');
}

// surfaceHeight must reproduce the DRAWN mesh, not the analytic curve.
{
  const P = HOME;
  const c = P.finestCellUV;
  let onLattice = 0, between = 0, worstLattice = 0, maxGap = 0;
  for (let i = 0; i < 400; i++) {
    const f = i % 6;
    const u = -1 + Math.floor((i * 7.3) % 60) * c * 4;
    const v = -1 + Math.floor((i * 11.1) % 60) * c * 4;
    // On a lattice corner the two must agree exactly.
    const d0 = faceDir(f, u, v, {});
    const dLat = Math.abs(surfaceHeight(d0, P, c) - height(d0, P));
    worstLattice = Math.max(worstLattice, dLat);
    onLattice++;
    // Halfway across a cell they must differ, or it is not interpolating.
    const dm = faceDir(f, u + c * 0.5, v + c * 0.5, {});
    const gap = Math.abs(surfaceHeight(dm, P, c) - height(dm, P));
    maxGap = Math.max(maxGap, gap);
    if (gap > 1e-6) between++;
  }
  ok('surfaceHeight agrees with height on the lattice', worstLattice < 1e-9,
    'worst ' + worstLattice.toExponential(1) + 'm over ' + onLattice + ' corners');
  ok('surfaceHeight interpolates between lattice points, not the curve',
    between > 300 && maxGap > 0.02,
    between + '/400 cells differ, worst ' + maxGap.toFixed(3) + 'm');
}


// ---- 2a2. the tangent basis must be a ROTATION -------------------------
// A basis with determinant -1 is a reflection. It looks orthonormal, it passes
// a NaN check, and the quaternion pulled out of it comes back 0.71 long instead
// of unit — which Babylon folds into the node's scale, so every vehicle skews
// and squashes as it drives. Nothing else in this suite could see that.
{
  let worstDet = 1, worstQuat = 0;
  for (const P of [SMALL, HOME]) {
    sphereWalk(300, (d) => {
      const fr = new TangentFrame(P, d);
      for (let k = 0; k < 12; k++) {
        const e = fr.east, u = fr.up, n = fr.north;
        const det = e.x * (u.y * n.z - u.z * n.y) - e.y * (u.x * n.z - u.z * n.x) +
          e.z * (u.x * n.y - u.y * n.x);
        worstDet = Math.min(worstDet, det);
        const M = BABYLON.Matrix.Identity();
        BABYLON.Matrix.FromValuesToRef(
          e.x, e.y, e.z, 0, u.x, u.y, u.z, 0, n.x, n.y, n.z, 0, 0, 0, 0, 1, M);
        const q = new BABYLON.Quaternion();
        BABYLON.Quaternion.FromRotationMatrixToRef(M, q);
        worstQuat = Math.max(worstQuat,
          Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1));
        fr.advance(41, -23);
      }
    });
  }
  ok('the tangent basis is a rotation, not a reflection', worstDet > 0.9999,
    'worst determinant ' + worstDet.toFixed(6) + ' (must be +1, not -1)');
  ok('and its quaternion is unit length, so nothing gets scaled',
    worstQuat < 1e-9, 'worst length error ' + worstQuat.toExponential(1));
}

// The craft's own composed transform, end to end.
{
  const c = newCraft();
  let worst = 0;
  for (let i = 0; i < 600; i++) {
    c.update(1 / 60, IN({ fwd: 1, turn: Math.sin(i / 40) * 0.8 }));
    const q = c.forms[c.mode].root.rotationQuaternion;
    worst = Math.max(worst, Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1));
  }
  ok('the craft transform stays a pure rotation while driving', worst < 1e-9,
    'worst quaternion length error ' + worst.toExponential(1));
}

// ---- 2a3. every surface must face out of the planet --------------------
// Signed volume proves a closed solid is not inverted, but the ground is not a
// closed solid — and a whole planet of terrain lit from underneath passes every
// other check in this file. Test the faces against the radial directly.
//
// Three separate bugs were caught here: ground quads carried over the flat
// world's vertex order (stepping +u then +v on a cube face has the opposite
// handedness to +x then +z on a plane), and both the tangent frame and the rock
// placement transform were built with determinant -1.
{
  const P = HOME;
  const probe = new ChunkField(scene, mat, P);
  const size = 2 / Math.pow(2, P.maxLevel);
  const groundTris = P.leafRes * P.leafRes * 2;
  let worstFace = 0, reversed = 0, checked = 0;
  // Several leaves, on different cube faces, so a per-face handedness slip
  // cannot hide on the one face the test happens to look at.
  for (let f = 0; f < 6; f++) {
    const leaf = probe.build(f, -size, -size, size, 1);
    const p = leaf._vd.position, n = leaf._vd.normal;
    for (let t = 0; t < groundTris; t++) {
      const i = t * 9;
      const cx = (p[i] + p[i + 3] + p[i + 6]) / 3 + leaf.position.x;
      const cy = (p[i + 1] + p[i + 4] + p[i + 7]) / 3 + leaf.position.y;
      const cz = (p[i + 2] + p[i + 5] + p[i + 8]) / 3 + leaf.position.z;
      const l = Math.hypot(cx, cy, cz) || 1;
      const d = (cx * n[i] + cy * n[i + 1] + cz * n[i + 2]) / l;
      checked++;
      if (d <= 0) reversed++;
      worstFace = Math.min(worstFace, d);
    }
  }
  ok('every ground face points out of the planet', reversed === 0,
    reversed + '/' + checked + ' reversed across all six cube faces');

  // Rocks are closed solids, so signed volume is the right tool for them — and
  // it has to stay negative on the sphere, not just on a plane.
  let rockVol = 0, rockTris = 0;
  for (let f = 0; f < 6; f++) {
    const pos = [], nrm = [];
    appendRocks(P, f, -size, -size, size, 0, 0, 0, pos, nrm);
    rockTris += pos.length / 9;
    for (let i = 0; i < pos.length; i += 9) {
      const a = [pos[i], pos[i + 1], pos[i + 2]];
      const b = [pos[i + 3], pos[i + 4], pos[i + 5]];
      const c = [pos[i + 6], pos[i + 7], pos[i + 8]];
      rockVol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
  }
  ok('rocks stay the right way out once placed on the sphere', rockVol < 0,
    'signed volume ' + rockVol.toFixed(0) + ' over ' + rockTris + ' tris');
}

// ---- 2b. going all the way round ---------------------------------------
// The headline claim of a finite world: drive one way for long enough and you
// come back to where you started. This walks the frame itself rather than the
// craft, so it isolates the geometry — parallel transport, re-anchoring and the
// exponential map — from vehicle physics.
for (const P of [SMALL, HOME]) {
  const start = findSpawn(P, P.relief * 0.12, P.relief * 0.75);
  const fr = new TangentFrame(P, start);
  const startEast = Object.assign({}, fr.east);
  const circumference = 2 * Math.PI * P.radius;
  // Deliberately awkward step size: nothing lines up with the circumference.
  const step = 2.617;
  const steps = Math.round(circumference / step);
  let worstRadial = 0;
  for (let i = 0; i < steps; i++) {
    fr.advance(step, 0);
    // The basis must stay orthonormal for the whole trip, not just at the end.
    const dots = Math.abs(fr.up.x * fr.east.x + fr.up.y * fr.east.y + fr.up.z * fr.east.z);
    const len = Math.hypot(fr.up.x, fr.up.y, fr.up.z);
    worstRadial = Math.max(worstRadial, dots, Math.abs(len - 1));
  }
  const closed = arcBetween(fr.up, start, P.radius);
  ok(P.name + ': a great circle closes on itself', closed < P.radius * 0.004,
    'off by ' + closed.toFixed(2) + 'm after ' + (circumference / 1000).toFixed(2) +
    'km in ' + steps + ' steps');
  ok(P.name + ': the frame stays orthonormal all the way round', worstRadial < 1e-9,
    'worst drift ' + worstRadial.toExponential(1));
  // Going round should bring the basis back too, not just the position.
  const eastBack = Math.hypot(fr.east.x - startEast.x, fr.east.y - startEast.y,
    fr.east.z - startEast.z);
  ok(P.name + ': the basis comes back with it', eastBack < 0.02,
    'east vector off by ' + eastBack.toExponential(1));
}

// The same lap actually flown, so the craft's own per-frame re-basing is
// covered and not just the frame maths.
//
// Flown rather than driven on purpose. Home is 30% water and a rover holding
// one heading floods, gets recovered somewhere else, and the lap becomes a
// measurement of the rescue system instead of the geometry. The jet crosses
// water, which is the whole reason it exists.
{
  const P = HOME;
  const surf = spawnOn(P);
  const flier = new Craft(forms, surf);
  flier.fuel = 100;
  flier.setMode('jet');
  const start = Object.assign({}, surf.frame.up);
  const circumference = 2 * Math.PI * P.radius;
  let travelled = 0, closest = Infinity, bad = false, left = false;
  for (let i = 0; i < 60 * 200 && travelled < circumference * 1.02; i++) {
    const before = Object.assign({}, surf.frame.up);
    flier.update(1 / 60, IN({ boost: true }));
    travelled += arcBetween(before, surf.frame.up, P.radius);
    if (!Number.isFinite(flier.world.x) || !Number.isFinite(flier.pos.y)) { bad = true; break; }
    const home = arcBetween(surf.frame.up, start, P.radius);
    if (home > circumference * 0.30) left = true;         // genuinely went round
    if (left) closest = Math.min(closest, home);
  }
  ok('a flown circumnavigation closes the loop', !bad && left &&
    travelled >= circumference && closest < P.radius * 0.12,
    'flew ' + (travelled / 1000).toFixed(2) + 'km of a ' +
    (circumference / 1000).toFixed(2) + 'km lap, returned within ' +
    closest.toFixed(0) + 'm of the spawn');
  ok('and the world radius never drifts while flying', !bad &&
    Math.abs(Math.hypot(flier.world.x, flier.world.y, flier.world.z) -
      (P.surfaceR + flier.pos.y)) < 0.01,
    'world radius matches surfaceR + altitude');
}

// ---- 2c. no penetration, all three forms, smallest and largest ---------
// The MD asks for both extremes because the LOD depth, the cell size and the
// relief all scale with radius, and a bug in that scaling shows up at one end.
const BIG = makePlanet(Object.assign({}, PLANETS.home, {
  key: 'big', name: 'Anvil-sized', radius: 2072, relief: 2072 / 20, seed: 'surveyor-big',
}));
for (const P of [SMALL, BIG]) {
  let worst = 0, nan = false, modes = new Set();
  const surf = spawnOn(P);
  const c = new Craft(forms, surf);
  const script = [
    { n: 400, in: { fwd: 1, turn: 0.4 }, mode: null },
    { n: 300, in: { fwd: 1, boost: true }, mode: 'boat' },
    { n: 400, in: { fwd: 1, pitch: -0.1 }, mode: 'jet' },
    { n: 500, in: { fwd: 1, turn: -0.5, hopHeld: true }, mode: 'rover' },
  ];
  for (const st of script) {
    for (let i = 0; i < st.n; i++) {
      c.update(1 / 60, IN(Object.assign({}, st.in, { mode: i === 0 ? st.mode : null })));
      modes.add(c.mode);
      if (!Number.isFinite(c.world.x) || !Number.isFinite(c.pos.y)) { nan = true; break; }
      if (c.sinkY <= 0.001 && !c.airborne) {
        worst = Math.max(worst, surf.surfaceHeight(0, 0) - c.pos.y);
      }
    }
  }
  ok(P.name + ' (R=' + P.radius + '): no penetration across all three forms',
    !nan && worst < 1.2 && modes.size === 3,
    'deepest ' + worst.toFixed(2) + 'm, forms ' + [...modes].join('/') +
    ', maxLevel ' + P.maxLevel + ', cell ' + P.finestCellArc.toFixed(1) + 'm');
}

// ---- 2d. the leaf cache -------------------------------------------------
// The MD's requirement: caching the leaf descent has to turn ~18 resolutions a
// frame into about one. Measured over real driving, not asserted.
{
  const surf = spawnOn(HOME);
  const c = new Craft(forms, surf);
  for (let i = 0; i < 120; i++) c.update(1 / 60, IN({ fwd: 1 }));
  surf.cache.hits = 0; surf.cache.misses = 0;
  const frames = 600;
  for (let i = 0; i < frames; i++) c.update(1 / 60, IN({ fwd: 1, turn: Math.sin(i / 50) }));
  const perFrame = surf.cache.misses / frames;
  const queries = (surf.cache.hits + surf.cache.misses) / frames;
  ok('the leaf cache collapses the descents to about one a frame',
    perFrame < 3 && queries > 10,
    queries.toFixed(0) + ' queries a frame, ' + perFrame.toFixed(2) + ' descents');
}

// ---- 3. the quadtree --------------------------------------------------
const field = new ChunkField(scene, mat, HOME);
const homeSpawn = findSpawn(HOME, HOME.relief * 0.12, HOME.relief * 0.75);
field.update(homeSpawn);
let guard = 0;
while (field.queue.length && guard++ < 20000) field.update(homeSpawn);
let treeTris = 0;
const levels = {};
for (const [, e] of field.live) {
  treeTris += e.mesh.vertexCount / 3;
  levels[e.level] = (levels[e.level] || 0) + 1;
}
ok('the quadtree covers the whole planet and terminates',
  field.live.size > 40 && field.live.size < field.maxLeaves && field.queue.length === 0,
  field.live.size + ' leaves of a possible ' + field.maxLeaves + ', ' +
  (treeTris | 0) + ' tris, levels ' + JSON.stringify(levels));
ok('it subdivides toward the player', Object.keys(levels).length >= 3 &&
  (levels[HOME.maxLevel] || 0) > 0,
  'deepest level ' + HOME.maxLevel + ' present: ' + !!levels[HOME.maxLevel]);

opts.validate = false;
let t0 = performance.now();
let leaf;
const fine = 2 / Math.pow(2, HOME.maxLevel);
for (let i = 0; i < 12; i++) leaf = field.build(0, -1 + i * fine, -1, fine, HOME.maxLevel);
const leafMs = (performance.now() - t0) / 12;
opts.validate = true;
ok('a max-detail leaf builds inside the frame budget', leafMs < 6,
  leafMs.toFixed(2) + 'ms, ' + (leaf.vertexCount / 3 | 0) + ' tris (with rocks)');

// Walk a long way and confirm leaves are recycled, not leaked.
const walkFrame = new TangentFrame(HOME, homeSpawn);
const before3 = field.live.size;
for (let i = 0; i < 40; i++) {
  walkFrame.advance(120, 40);
  field.update(walkFrame.up);
  let g = 0;
  while (field.queue.length && g++ < 20000) field.update(walkFrame.up);
}
ok('no leaf leak after walking 5km of surface',
  field.live.size > 40 && field.live.size < before3 * 2.2,
  before3 + ' -> ' + field.live.size + ' leaves');

// ---- 4. water ----------------------------------------------------------
const water = new Water(scene, mat, HOME);
const depths = water.mesh._vd.depth;
ok('the water shell fills its depth attribute', depths && depths.length === water.count,
  water.count + ' vertices, ' + water.tris + ' tris');
ok('depth has both shallow and deep readings',
  [...depths].some((d) => d === 0) && [...depths].some((d) => d > 5),
  'max depth ' + Math.max(...depths).toFixed(1) + 'm');
// The shell is closed, so every vertex sits on the sea-level sphere.
{
  const pos = water.mesh._vd.position;
  let worst = 0;
  for (let i = 0; i < pos.length; i += 3) {
    worst = Math.max(worst,
      Math.abs(Math.hypot(pos[i], pos[i + 1], pos[i + 2]) - HOME.surfaceR));
  }
  ok('every water vertex sits exactly on sea level', worst < 1e-6,
    'worst radial error ' + worst.toExponential(1) + 'm');
}

// ---- 5. physics stability ---------------------------------------------
const craft = newCraft();
const survey = new Survey(scene, craft, HOME);
ok('craft spawns on dry land', craft.pos.y > 0, `y=${craft.pos.y.toFixed(1)}`);

const script = [
  { frames: 300, in: { fwd: 1, turn: 0.3 }, mode: null },
  { frames: 60, in: { fwd: 1 }, mode: 'jet' },
  { frames: 900, in: { fwd: 0.4, roll: 0.6, pitch: -0.2, boost: true }, mode: null },
  { frames: 600, in: { fwd: 1, pitch: 0.5, hop: true }, mode: null },
  { frames: 300, in: { fwd: 1, turn: -1, hop: true }, mode: 'boat' },
  { frames: 300, in: { fwd: -1, turn: 1 }, mode: 'rover' },
  { frames: 600, in: { fwd: 1, turn: 0, hop: true }, mode: null },
];

let bad = null, minFuel = 999, maxFuel = -1, maxSpd = 0, modesSeen = new Set();
let frame = 0;
const startDir = Object.assign({}, craft.surf.frame.up);
for (const step of script) {
  for (let i = 0; i < step.frames; i++) {
    const input = IN(Object.assign({}, step.in, {
      mode: i === 0 ? step.mode : null,
      // SPACE is a hold now; tap it on a cadence
      hopHeld: !!step.in.hop && (i % 37) < 3,
      hopPress: !!step.in.hop && i % 37 === 0,
    }));
    craft.update(1 / 60, input);
    survey.update(1 / 60);
    frame++;
    modesSeen.add(craft.mode);
    minFuel = Math.min(minFuel, craft.fuel);
    maxFuel = Math.max(maxFuel, craft.fuel);
    maxSpd = Math.max(maxSpd, craft.speed);
    const p = craft.pos;
    if (!bad && (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z) ||
        !Number.isFinite(craft.fuel) || !Number.isFinite(craft.yaw))) {
      bad = `frame ${frame} mode=${craft.mode} pos=${p.x},${p.y},${p.z} fuel=${craft.fuel}`;
    }
  }
}
ok('3060 frames with no NaN', !bad,
  bad || 'travelled ' + (arcBetween(craft.surf.frame.up, startDir, HOME.radius) / 1000)
    .toFixed(2) + 'km of surface');
ok('all three forms exercised', modesSeen.size === 3, [...modesSeen].join(', '));
ok('fuel stays within bounds', minFuel >= 0 && maxFuel <= 100,
  `${minFuel.toFixed(1)} .. ${maxFuel.toFixed(1)}`);
ok('top speed is in a sane range', maxSpd > 30 && maxSpd < 200, maxSpd.toFixed(1) + ' m/s');

// ---- 6. craft never sinks through the world ---------------------------
// Going *under water* is now a legitimate state, so the check is that the
// rover is never inside solid ground, and never below the waterline unless
// the hull is flooding.
let below = 0, unexplained = 0;

const c2 = newCraft();
for (let i = 0; i < 1800; i++) {
  c2.update(1 / 60, IN({ fwd: 1, turn: Math.sin(i / 90) * 0.8, boost: i % 3 === 0 }));
  const ground = c2.surf.surfaceHeight(0, 0);
  if (c2.pos.y < ground - 1.0) below++;
  // Under the waterline is only legitimate if the hull is actually taking
  // water on. A dry rover paddling through the shallows must stay on top.
  if (c2.pos.y < -0.9 && c2.swamp < 0.25 && c2.sinkY <= 0.001) unexplained++;
}
ok('rover never ends up inside the terrain', below === 0, below + ' frames below ground');
ok('a dry rover never goes under the waterline', unexplained === 0,
  unexplained + ' unexplained submerged frames');

// ---- 6b. the hop -------------------------------------------------------
// Point at whichever heading stays driest — a hop needs dry ground under it,
// and the spawn happens to have a lake directly ahead.
const dryYaw = (c) => {
  let best = 0, bestScore = -1e9;
  for (let a = 0; a < 32; a++) {
    const y = (a / 32) * Math.PI * 2;
    let score = 0;
    for (let d = 10; d <= 260; d += 10) {
      score += c.surf.height(Math.sin(y) * d, Math.cos(y) * d) > 4 ? 1 : -3;
    }
    if (score > bestScore) { bestScore = score; best = y; }
  }
  return best;
};

const c5 = newCraft();
c5.yaw = dryYaw(c5);
for (let i = 0; i < 180; i++) c5.update(1 / 60, IN({ fwd: 1 }));
ok('the hop test gets up to speed on dry land', c5.speedScalar > 15 && !c5.onWater,
  `${c5.speedScalar.toFixed(1)} m/s, ${c5.onWater ? 'in water' : 'dry'}`);
const restBody = c5.bodyY;
let crouched = 0, airFrames = 0, peak = 0, droop = 0, landed = false;
c5.update(1 / 60, IN({ fwd: 1, hopHeld: true }));
for (let i = 0; i < 150; i++) {
  const wasAir = c5.airborne;
  c5.update(1 / 60, IN({ fwd: 1 }));
  if (c5.charging && c5.bodyY < restBody - 0.05) crouched++;
  if (c5.airborne) {
    airFrames++;
    peak = Math.max(peak, c5.pos.y - Math.max(c5.surf.surfaceHeight(0, 0), 0));
    droop = Math.min(droop, c5.wheelY);
  }
  if (wasAir && !c5.airborne) landed = true;
}
ok('space hop leaves the ground and comes back down', airFrames > 12 && landed,
  `${airFrames} airborne frames, peak ${peak.toFixed(2)}m`);
ok('the body squats before the launch', crouched > 0, crouched + ' crouch frames');
ok('the wheels hang once the load comes off', droop < -0.10, `wheelY min ${droop.toFixed(3)}`);

// ---- 6b2. charged jump -------------------------------------------------
// The whole point of the sqrt curve: a full charge must be TEN times the
// height of a tap, not a hundred. Measure apex height directly rather than
// trusting the algebra.
// Hop from a standstill and measure the arc in ABSOLUTE y. Driving while
// measuring moves the craft 60m+ during a long hop, and the ground moving
// underneath it swamps the thing being measured.
const apexOf = (holdSeconds) => {
  const c = newCraft();
  for (let i = 0; i < 30; i++) c.update(1 / 60, IN({}));
  const held = Math.max(1, Math.round(holdSeconds * 60));
  // One loop across hold and release: splitting them lost the launch whenever
  // it happened on the last held frame, and silently under-measured the arc.
  let prevY = c.pos.y, launchY = null, apex = -1e9;
  for (let i = 0; i < held + 600; i++) {
    const wasAir = c.airborne;
    c.update(1 / 60, IN({ hopHeld: i < held }));
    if (c.airborne) {
      if (launchY === null) launchY = prevY;
      apex = Math.max(apex, c.pos.y);
    } else if (wasAir) break;
    prevY = c.pos.y;
  }
  return launchY === null ? 0 : apex - launchY;
};
const tapH = apexOf(1 / 60);
const fullH = apexOf(HOP.chargeTime + 0.25);
const ratio = fullH / Math.max(tapH, 1e-6);
ok('a full charge is ~10x the height of a tap', ratio > 8.0 && ratio < 12.5,
  `tap ${tapH.toFixed(2)}m, full ${fullH.toFixed(2)}m, ratio ${ratio.toFixed(1)}x`);
ok('a tap still gets you the old hop height', tapH > 1.0 && tapH < 1.9,
  tapH.toFixed(2) + 'm');

// Half charge is half the HEIGHT, not half the impulse.
const halfH = apexOf(HOP.crouch + (HOP.chargeTime - HOP.crouch) * 0.5);
const halfExpected = tapH + (fullH - tapH) * 0.5;
ok('the charge curve is linear in height', Math.abs(halfH - halfExpected) / halfExpected < 0.22,
  `half-charge ${halfH.toFixed(2)}m, linear-in-height predicts ${halfExpected.toFixed(2)}m`);

// Charging must not take the controls away.
const cCh = newCraft();
cCh.yaw = dryYaw(cCh);
for (let i = 0; i < 180; i++) cCh.update(1 / 60, IN({ fwd: 1 }));
const yaw0 = cCh.yaw, spd0 = cCh.speedScalar;
for (let i = 0; i < 40; i++) cCh.update(1 / 60, IN({ fwd: 1, turn: 1, hopHeld: true }));
ok('charging does not lock steering or throttle',
  Math.abs(cCh.yaw - yaw0) > 0.15 && cCh.speedScalar > spd0 * 0.6 && cCh.charging,
  `yaw moved ${(cCh.yaw - yaw0).toFixed(2)}rad, speed ${cCh.speedScalar.toFixed(1)}`);

// ---- 6d. suspension ----------------------------------------------------
// The body attitude now comes from where the six wheels are, not from the
// terrain normal. Those must agree: if SUSP.rollSign is inverted the rover
// leans into slopes the wrong way, and that is not something the other checks
// would ever notice.
const cSusp = newCraft();
cSusp.yaw = dryYaw(cSusp);
let pitchDot = 0, rollDot = 0, samples = 0, maxTravel = 0, spread = 0;
for (let i = 0; i < 900; i++) {
  cSusp.update(1 / 60, IN({ fwd: 1, turn: Math.sin(i / 70) * 0.9 }));
  if (i < 120 || cSusp.onWater || cSusp.airborne) continue;
  const c = cSusp.sampleWheels();
  const n = cSusp.surf.normalAt(0, 0, 2.4);
  const fx = Math.sin(cSusp.yaw), fz = Math.cos(cSusp.yaw);
  const rx = Math.cos(cSusp.yaw), rz = -Math.sin(cSusp.yaw);
  const np = Math.atan2(n.x * fx + n.z * fz, Math.max(n.y, 0.2));
  const nr = -Math.atan2(n.x * rx + n.z * rz, Math.max(n.y, 0.2));
  pitchDot += np * c.pitch;
  rollDot += nr * c.roll;
  samples++;
  let lo = 9, hi = -9;
  for (const w of forms.rover.wheels) {
    maxTravel = Math.max(maxTravel, Math.abs(w.metadata.travel));
    lo = Math.min(lo, w.metadata.travel); hi = Math.max(hi, w.metadata.travel);
  }
  spread = Math.max(spread, hi - lo);
}
ok('wheel-derived pitch agrees with the terrain normal', pitchDot > 0,
  `correlation ${(pitchDot / samples).toExponential(2)} over ${samples} samples`);
ok('wheel-derived roll agrees with the terrain normal', rollDot > 0,
  `SUSP.rollSign=${SUSP.rollSign}, correlation ${(rollDot / samples).toExponential(2)}`);
ok('the struts actually travel, and independently', maxTravel > 0.08 && spread > 0.05,
  `max travel ${maxTravel.toFixed(3)}m, max left/right spread ${spread.toFixed(3)}m`);
ok('travel stays inside the strut', maxTravel <= Math.max(SUSP.up, SUSP.down) + 1e-6,
  `limit ${Math.max(SUSP.up, SUSP.down)}m`);

// ---- 6e. the boat ------------------------------------------------------
// Find open water once and reuse it for the whole boat section.
/**
 * Find the direction with the most open water around it, by maximising the
 * SHALLOWEST reading in a ring. Taking the first direction that clears a fixed
 * depth silently fell through to the default pole on a world whose deepest
 * water is 10m, and every boat test then ran aground without saying so.
 */
const bestRing = (planet, radii, score) => {
  let best = null, bestScore = -Infinity;
  const probe = { x: 0, y: 0, z: 0 };
  sphereWalk(9000, (d) => {
    const fr = new TangentFrame(planet, d);
    let worst = Infinity;
    for (let a = 0; a < 10; a++) {
      const ang = (a / 10) * Math.PI * 2;
      for (const r of radii) {
        fr.dirAt(Math.cos(ang) * r, Math.sin(ang) * r, probe);
        worst = Math.min(worst, score(height(probe, planet)));
      }
    }
    if (worst > bestScore) { bestScore = worst; best = { x: d.x, y: d.y, z: d.z }; }
  });
  return { dir: best, score: bestScore };
};

// Deepest, most open water: score is depth below sea level.
const water0 = bestRing(HOME, [0, 45, 90], (h) => -h);
const openWater = water0.dir;
ok('the suite found genuinely open water to test the boat on',
  water0.score > 1.0, 'shallowest reading in a 90m ring is ' +
  water0.score.toFixed(1) + 'm deep');
const afloat = (setup) => {
  const c = new Craft(forms, new Surface(HOME, openWater));
  c.pos.set(0, 1, 0);
  c.setMode('boat');
  c.yaw = 0;
  if (setup) setup(c);
  return c;
};

// Planing: the hull must actually come up, and having come up must be harder
// to lose than it was to get (hysteresis, or it chatters on the threshold).
// Circles rather than driving a fixed heading: a straight line leaves the lake
// inside ten seconds and the test then measures a beached hull without saying so.
const cPlane = afloat();
let planedAt = -1, everPlaned = false;
for (let i = 0; i < 600; i++) {
  cPlane.update(1 / 60, IN({ fwd: 1, turn: 0.5 }));
  if (cPlane.planing && !everPlaned) { everPlaned = true; planedAt = cPlane.speedScalar; }
}
ok('the hull comes up onto the plane under power', everPlaned && cPlane.planing,
  `planed at ${planedAt.toFixed(1)} m/s, cruising ${cPlane.speedScalar.toFixed(1)}`);
const dropAt = (() => {
  for (let i = 0; i < 900; i++) {
    cPlane.update(1 / 60, IN({ fwd: 0, turn: 0.5 }));
    if (!cPlane.planing) return cPlane.speedScalar;
  }
  return -1;
})();
ok('planing has hysteresis, so it cannot chatter', dropAt >= 0 && dropAt < planedAt - 0.5,
  `up at ${planedAt.toFixed(1)}, back down at ${dropAt.toFixed(1)} m/s`);

// Carving, isolated. Two identical hulls, identical sideways velocity, the
// only difference being how hard they are banked — comparing whole turns
// instead would confound bank against yaw rate, which also makes slip.
const sideAfter = (roll) => {
  const c = afloat((b) => {
    b.vel.set(7, 0, 26);
    b.planing = true; b.planeMix = 1; b.roll = roll;
  });
  c.update(1 / 60, IN({ fwd: 1 }));
  return Math.abs(c.vel.x);
};
const lazySide = sideAfter(0);
const carvedSide = sideAfter(BOAT.bankMax);
ok('banking into a turn holds the line', carvedSide < lazySide * 0.95,
  `sideways velocity left: flat ${lazySide.toFixed(3)}, banked ${carvedSide.toFixed(3)}`);

// Boost is a surge, not just a taller ceiling.
const runFor = (frames, boost) => {
  const c = afloat();
  for (let i = 0; i < frames; i++) c.update(1 / 60, IN({ fwd: 1, boost }));
  return c.speedScalar;
};
const noBoost = runFor(24, false);
const withBoost = runFor(24, true);
ok('boost surges off the line', withBoost > noBoost * 1.25,
  `0.4s from rest: ${noBoost.toFixed(1)} vs ${withBoost.toFixed(1)} m/s`);

// Waves throw a planing hull. Also a NaN guard for the new launch path.
const cWave = afloat();
let launches = 0, waveAir = 0, waveBad = false;
on('wavelaunch', () => launches++);
for (let i = 0; i < 60 * 40; i++) {
  cWave.update(1 / 60, IN({ fwd: 1, boost: true, turn: Math.sin(i / 140) * 0.6 }));
  if (cWave.airborne) waveAir++;
  if (!Number.isFinite(cWave.pos.y) || !Number.isFinite(cWave.vel.x)) waveBad = true;
}
ok('a planing hull gets air off the swell', launches > 0 && waveAir > 0 && !waveBad,
  `${launches} launches, ${waveAir} airborne frames`);

// Chained hops raise the speed ceiling, and it bleeds back down.
const c6 = newCraft();
c6.yaw = dryYaw(c6);
for (let i = 0; i < 240; i++) c6.update(1 / 60, IN({ fwd: 1 }));
c6.sinceLand = 0.01;
c6.launchHop(HOP.impulse);
ok('chaining a hop lifts the speed cap', c6.chainBoost > 1 && c6.chainBoost <= HOP.chainCap,
  'chainBoost ' + c6.chainBoost.toFixed(3));

// ---- 6c. deep water swallows the rover --------------------------------
let deep = null, deepest = 0;
sphereWalk(8000, (d) => {
  const h = height(d, HOME);
  if (h < deepest) { deepest = h; deep = { x: d.x, y: d.y, z: d.z }; }
});
const cDeep = new Craft(forms, new Surface(HOME, deep));
cDeep.pos.set(0, 1.0, 0);
let flooded = false, maxSink = 0;
for (let i = 0; i < 60 * 20 && cDeep.drowns === 0; i++) {
  cDeep.update(1 / 60, IN({}));
  if (cDeep.swamp > 0.9) flooded = true;
  maxSink = Math.max(maxSink, cDeep.sinkY);
}
ok('a rover in deep water floods and goes under', flooded && maxSink > 1,
  `max sink ${maxSink.toFixed(2)}m`);
ok('and is recovered onto dry land',
  cDeep.drowns === 1 && cDeep.surf.surfaceHeight(0, 0) > 1.5,
  'recovered at ground height ' + cDeep.surf.surfaceHeight(0, 0).toFixed(1) + 'm');

// Switching to the boat is the escape hatch, so it must clear the flooding.
const c7 = new Craft(forms, new Surface(HOME, deep));
c7.pos.set(0, 1.0, 0);
for (let i = 0; i < 200; i++) c7.update(1 / 60, IN({}));
const swampedBefore = c7.swamp;
c7.update(1 / 60, IN({ mode: 'boat' }));
for (let i = 0; i < 120; i++) c7.update(1 / 60, IN({ fwd: 1 }));
ok('hitting 2 bails the hull out', swampedBefore > 0.5 && c7.sinkY === 0 && c7.mode === 'boat',
  `swamp ${swampedBefore.toFixed(2)} -> sink ${c7.sinkY.toFixed(2)}`);

// ---- 7. flight ---------------------------------------------------------
// The launch used to set `speed` (derived) instead of `speedScalar` (what the
// jet integrates), so hitting 3 from a standstill started you below stall and
// dropped you straight back on the ground. This is that regression, pinned.
const cLaunch = newCraft();
cLaunch.fuel = 100;
cLaunch.setMode('jet');                    // from a dead stop, no run-up
let jetFrames = 0, minClear = 1e9, maxClear = 0;
for (let i = 0; i < 60 * 30 && cLaunch.mode === 'jet'; i++) {
  cLaunch.update(1 / 60, IN({}));          // hands off the whole way
  jetFrames++;
  const clear = cLaunch.pos.y - Math.max(cLaunch.surf.surfaceHeight(0, 0), 0);
  if (i > 90) { minClear = Math.min(minClear, clear); maxClear = Math.max(maxClear, clear); }
}
ok('a standstill launch actually flies', cLaunch.mode === 'jet' && jetFrames >= 60 * 30,
  `${(jetFrames / 60).toFixed(1)}s airborne, hands off`);
ok('the autopilot holds a height over the terrain', minClear > 20 && maxClear < 260,
  `clearance ${minClear.toFixed(0)}..${maxClear.toFixed(0)}m (target ${JET.assistAlt}m)`);

// Taking the controls must actually take them.
const cMan = newCraft();
cMan.fuel = 100;
cMan.setMode('jet');
for (let i = 0; i < 120; i++) cMan.update(1 / 60, IN({}));
const autoBefore = cMan.assist;
for (let i = 0; i < 150; i++) cMan.update(1 / 60, IN({ pitch: -1, roll: 0.5 }));
ok('pitch input hands control over', autoBefore > 0 && cMan.assist === 0,
  `assist ${autoBefore.toFixed(1)}s -> 0`);

// Flight length. Deliberately near-unlimited while the handling is tuned.
const c3 = newCraft();
c3.fuel = 100;
c3.setMode('jet');
let airborneFrames = 0;
while (c3.mode === 'jet' && airborneFrames < 60 * 400) {
  c3.update(1 / 60, IN({ pitch: -0.12 }));
  airborneFrames++;
}
const secs = airborneFrames / 60;
ok('a full charge buys a long flight (testing burn rate)', secs > 120,
  secs.toFixed(1) + 's on 100 charge — JET.burn is turned down for testing');

// ---- 8. props ----------------------------------------------------------
const before = survey.active.size;
survey.craft.pos.set(9000, 40, 9000);
survey.update(1 / 60);
ok('props stream with the player', survey.active.size > 0 && survey.active.size <= (2 * 3 + 1) ** 2,
  `${before} -> ${survey.active.size} chunks of props`);

// ---- 8b. colonies ------------------------------------------------------
const cJet = newCraft();
const colonies = new Colonies(scene, cJet, mat, HOME);

ok('habitat domes are wound the right way out', signedVolume(colonies.domeProto) < 0,
  `signed volume ${signedVolume(colonies.domeProto).toFixed(2)} (Babylon wants negative)`);

// A probe can only be dropped from the air, and it costs charge.
cJet.fuel = 100;
ok('colonisers cannot be dropped from the ground', colonies.drop() === false);

// Dry and level: score is height above sea level, penalised for being steep.
const flat0 = bestRing(HOME, [0, 12, 24], (h) => h);
ok('the suite found dry level ground to land a coloniser on',
  flat0.score > 2, 'lowest reading in a 24m ring is ' + flat0.score.toFixed(1) + 'm');
cJet.surf.teleport(flat0.dir);
cJet.pos.set(0, cJet.surf.surfaceHeight(0, 0) + 1, 0);
cJet.setMode('jet');
// Hold it still overhead so the probe drops straight down onto known ground.
for (let i = 0; i < 60; i++) { cJet.update(1 / 60, IN({})); colonies.update(1 / 60); }
cJet.surf.teleport(flat0.dir);
cJet.pos.set(0, cJet.surf.surfaceHeight(0, 0) + 90, 0);
cJet.vel.set(0, 0, 0);
cJet.speedScalar = 1;
const fuelBefore = cJet.fuel;
const launched = colonies.drop();
ok('a coloniser drops from the jet and is paid for',
  launched && Math.abs((fuelBefore - cJet.fuel) - COLONY.cost) < 0.01,
  `charge ${fuelBefore.toFixed(1)} -> ${cJet.fuel.toFixed(1)}`);

// Let it fall and land.
for (let i = 0; i < 60 * 12 && colonies.probes.length; i++) {
  cJet.update(1 / 60, IN({}));
  colonies.update(1 / 60);
}
ok('the probe lands and plants a site', colonies.probes.length === 0 && colonies.sites.length === 1,
  `${colonies.sites.length} site(s)`);

// Growth runs on wall time whether or not anything is rendering it.
const site = colonies.sites[0];
colonies.clock += COLONY.domeEvery * COLONY.maxDomes + COLONY.growTime + 1;
colonies.update(1 / 60);
ok('a site grows to a full colony on its own', colonies.domes === COLONY.maxDomes,
  `${colonies.domes}/${COLONY.maxDomes} domes, stage ${site.stage}`);

// Meshes stream, the record does not.
ok('colony meshes build when you are near', !!site.node,
  site.node ? site.node.domes.length + ' dome meshes' : 'none');
// Walk the frame right round to the far side of the planet.
cJet.surf.teleport({ x: -site.dir.x, y: -site.dir.y, z: -site.dir.z });
colonies.update(1 / 60);
ok('and are released when you leave, without losing the site',
  site.node === null && colonies.sites.length === 1);
cJet.surf.teleport(site.dir);
colonies.update(1 / 60);
ok('and rebuild identically on the way back', !!site.node,
  'domes still ' + colonies.domes);

// A mature colony pays you back.
const before8b = cJet.fuel;
for (let i = 0; i < 60; i++) colonies.update(1 / 60);
ok('a mature colony trickles charge back', cJet.fuel > before8b,
  `+${(cJet.fuel - before8b).toFixed(2)}/s from ${colonies.domes} domes`);

// ---- 9. audio ----------------------------------------------------------
// There is no WebAudio in Node, so what is being checked is that the module
// degrades to silence rather than throwing — a missing or blocked context
// must never take the render loop down with it.
const sound = new Sound();
const started = sound.start();
let audioThrew = null;
try {
  for (let i = 0; i < 120; i++) sound.update(1 / 60, craft, true);
  sound.toggleMute();
  sound.update(1 / 60, craft, false);
} catch (err) {
  audioThrew = err.message;
}
ok('audio survives having no context at all', !audioThrew && started === false,
  audioThrew || 'silent, no throw');

console.log(fails === 0 ? '\nAll checks passed.' : `\n${fails} FAILURE(S).`);
process.exit(fails ? 1 : 0);
