// Colonisation.
//
// Drop a probe from the jet and it falls, lands, and turns into a habitat that
// builds itself: one dome inflates, then another beside it, then a pressure
// tube linking them, and so on until the site is mature. Growth runs on wall
// time and does not care whether you are watching, so a site you planted an
// hour ago on the far side of a lake will be a town when you get back to it.
//
// Two lists, deliberately separated:
//   sites  — the record. Small, permanent, never disposed. This is the world.
//   node   — the meshes. Built on approach, thrown away on departure. This is
//            just what you can currently see of it.
//
// Everything about a site's layout is derived from its seed, so the meshes
// rebuild identically every time you drive back into range.

import { Geo } from '../player/meshes.js';
import { height } from '../world/noise.js';
import { TangentFrame, arcBetween } from '../world/sphere.js';
import { placeOnSphere } from '../world/surface.js';
import { rngFor, range } from '../core/rng.js';
import { COLONY, FUEL } from '../tune.js';
import { emit } from '../core/events.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const SHELL = [0.780, 0.800, 0.762, 0];
const RIB   = [0.208, 0.259, 0.290, 0];
const DARK  = [0.106, 0.145, 0.169, 0];
const LIT   = [0.169, 0.878, 0.784, 1];
const WARM  = [1.000, 0.690, 0.239, 1];

/** A faceted hemisphere with a rib band and lit windows, radius 1. */
function domeGeo(segs, rings) {
  const g = new Geo();
  const P = (p, a) => [Math.cos(p) * Math.cos(a), Math.sin(p), Math.cos(p) * Math.sin(a)];
  for (let j = 0; j < rings; j++) {
    const p0 = (j / rings) * Math.PI / 2;
    const p1 = ((j + 1) / rings) * Math.PI / 2;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      // Alternating panels, and a lit window ring one row up from the base.
      const lit = j === 1 && i % 2 === 0;
      const col = lit ? LIT : (i % 2 === 0 ? SHELL : [
        SHELL[0] * 0.90, SHELL[1] * 0.92, SHELL[2] * 0.88, 0]);
      // Wound clockwise, like everything else Babylon considers front-facing.
      // Built the natural way round it comes out inside-out.
      g.quad(P(p0, a0), P(p0, a1), P(p1, a1), P(p1, a0), col);
    }
  }
  // Skirt and floor, so it is a closed solid and reads as sealed to the ground.
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const o0 = [Math.cos(a0), 0, Math.sin(a0)], o1 = [Math.cos(a1), 0, Math.sin(a1)];
    const b0 = [Math.cos(a0) * 1.06, -0.16, Math.sin(a0) * 1.06];
    const b1 = [Math.cos(a1) * 1.06, -0.16, Math.sin(a1) * 1.06];
    g.quad(o1, b1, b0, o0, RIB);
    g.tri([0, -0.16, 0], b0, b1, DARK);
  }
  return g;
}

/** Unit tube along +Z, from z=0 to z=1, radius 1. Scaled to fit at runtime. */
function tubeGeo(sides) {
  const g = new Geo();
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const col = i % 3 === 0 ? LIT : RIB;
    g.quad([c0, s0, 0], [c0, s0, 1], [c1, s1, 1], [c1, s1, 0], col);
  }
  return g;
}

/** The probe itself: a drum on three legs with a beacon on top. */
function landerGeo() {
  const g = new Geo();
  const ngon = (n, r, y) => {
    const p = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / n;
      p.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return p;
  };
  g.loft([
    { z: -0.45, pts: ngon(6, 0.50).map((p) => [p[0], p[1] + 0.62]) },
    { z: 0.30, pts: ngon(6, 0.62).map((p) => [p[0], p[1] + 0.66]) },
    { z: 0.62, pts: ngon(6, 0.40).map((p) => [p[0], p[1] + 0.62]) },
  ], SHELL);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const dx = Math.cos(a) * 0.78, dz = Math.sin(a) * 0.78;
    g.extrudeY([[dx - 0.09, dz - 0.09], [dx + 0.09, dz - 0.09],
      [dx + 0.09, dz + 0.09], [dx - 0.09, dz + 0.09]], 0, 0.66, RIB);
  }
  g.cylZ(0, 1.24, 0, 0.10, 0.26, 6, WARM);
  return g;
}

const PD = { x: 0, y: 0, z: 0 };

export class Colonies {
  constructor(scene, craft, mat, planet) {
    this.scene = scene;
    this.craft = craft;
    this.mat = mat;
    this.planet = planet;
    this.sites = [];
    this.probes = [];
    this.clock = 0;
    this.dropCool = 0;
    this.nextId = 1;
    this.domesBuilt = 0;

    // Prototypes, cloned per instance. Unit-sized so a clone is just a scale.
    this.domeProto = domeGeo(11, 4).toMesh(scene, 'domeProto', mat);
    this.domeProto.setEnabled(false);
    this.tubeProto = tubeGeo(7).toMesh(scene, 'tubeProto', mat);
    this.tubeProto.setEnabled(false);
    this.landerProto = landerGeo().toMesh(scene, 'landerProto', mat);
    this.landerProto.setEnabled(false);
    this.probeProto = landerGeo().toMesh(scene, 'probeProto', mat);
    this.probeProto.setEnabled(false);
  }

  get count() { return this.sites.length; }
  get domes() { return this.domesBuilt; }

  // ---- dropping ---------------------------------------------------------

  /** True if a probe actually left the rack. */
  drop() {
    const c = this.craft;
    if (c.mode !== 'jet') { emit('dropfail', { why: 'ground' }); return false; }
    if (c.altitude < COLONY.minAlt) { emit('dropfail', { why: 'low' }); return false; }
    if (c.fuel < COLONY.cost) { emit('dropfail', { why: 'fuel' }); return false; }
    if (this.dropCool > 0) return false;

    c.fuel -= COLONY.cost;
    this.dropCool = COLONY.dropCooldown;

    const m = this.probeProto.clone('probe' + this.nextId);
    m.setEnabled(true);
    m.renderingGroupId = 1;
    // A probe is tracked in the craft's tangent frame at the moment of release
    // and then falls in that frame. It only ever travels a few hundred metres
    // before landing, so it does not need a frame of its own.
    this.probes.push({
      frame: new TangentFrame(this.planet, c.surf.frame.up),
      x: 0, y: c.pos.y - 2, z: 0,
      // Inherits the jet's momentum, so you have to lead the target.
      vx: c.vel.x * 0.55, vy: -2, vz: c.vel.z * 0.55,
      spin: 0,
      mesh: m,
    });
    emit('probedrop', { pos: c.world.clone() });
    return true;
  }

  /** Land a probe: plant a site, or lose it to water or a cliff. */
  settle(p) {
    p.mesh.dispose();
    const P = this.planet;
    const dir = p.frame.dirAt(p.x, p.z, { x: 0, y: 0, z: 0 });
    const g = height(dir, P);
    const world = {
      x: dir.x * (P.surfaceR + g), y: dir.y * (P.surfaceR + g), z: dir.z * (P.surfaceR + g),
    };
    if (g < 0.6) {
      emit('probelost', { pos: world, why: 'water' });
      return;
    }
    // Slope from the local tangent frame at the landing point.
    const fr = new TangentFrame(P, dir);
    const e = 3;
    const sx = height(fr.dirAt(e, 0, { x: 0, y: 0, z: 0 }), P) -
      height(fr.dirAt(-e, 0, { x: 0, y: 0, z: 0 }), P);
    const sz = height(fr.dirAt(0, e, { x: 0, y: 0, z: 0 }), P) -
      height(fr.dirAt(0, -e, { x: 0, y: 0, z: 0 }), P);
    const slope = Math.hypot(sx, sz) / (2 * e);
    if (slope > COLONY.landSlope) {
      emit('probelost', { pos: world, why: 'slope' });
      return;
    }

    const id = this.nextId++;
    const rng = rngFor(P.seed,
      'colony:' + id + ':' + Math.round(dir.x * 1e4) + ',' + Math.round(dir.z * 1e4));
    const domes = [];
    // Lay the whole site out now, even though most of it will not exist for
    // several minutes. Deterministic layout is what lets the meshes be thrown
    // away and rebuilt identically.
    for (let i = 0; i < COLONY.maxDomes; i++) {
      const a = rng() * Math.PI * 2;
      const d = i === 0 ? 0 : range(rng, 0.75, 1.15) * COLONY.spread * (0.6 + i * 0.22);
      domes.push({
        ox: Math.cos(a) * d,
        oz: Math.sin(a) * d,
        r: COLONY.baseRadius + i * COLONY.radiusStep * range(rng, 0.7, 1.2),
        born: i * COLONY.domeEvery,
        // Every dome after the first links back to one already standing.
        parent: i === 0 ? -1 : (rng() * i) | 0,
      });
    }

    // A site records the DIRECTION it sits at, plus a tangent frame so its
    // dome layout can stay in the flat local coordinates it was authored in.
    this.sites.push({
      id, dir, frame: fr, elevation: g, world,
      t0: this.clock, domes, node: null, stage: 0,
    });
    emit('colony', { pos: world, id, stage: 0 });
  }

  // ---- meshes -----------------------------------------------------------

  build(site) {
    const node = new BABYLON.TransformNode('colony' + site.id, this.scene);
    // The site's own frame becomes the node's transform, so every dome offset
    // below is still a plain (x, z) in metres — the layout code never changed.
    placeOnSphere(node, this.planet, site.dir, site.elevation, 0);
    const lander = this.landerProto.clone('lander' + site.id);
    lander.parent = node;
    lander.setEnabled(true);
    lander.renderingGroupId = 1;

    const domes = [], tubes = [];
    for (let i = 0; i < site.domes.length; i++) {
      const d = site.domes[i];
      const m = this.domeProto.clone(`dome${site.id}_${i}`);
      m.parent = node;
      m.renderingGroupId = 1;
      // Sit each dome on its own patch of ground, not on the site's.
      const dd = site.frame.dirAt(d.ox, d.oz, { x: 0, y: 0, z: 0 });
      m.position.set(d.ox, height(dd, this.planet) - site.elevation, d.oz);
      m.setEnabled(false);
      domes.push(m);

      if (d.parent >= 0) {
        const t = this.tubeProto.clone(`tube${site.id}_${i}`);
        t.parent = node;
        t.renderingGroupId = 1;
        t.setEnabled(false);
        tubes.push({ mesh: t, from: d.parent, to: i });
      }
    }
    site.node = { node, lander, domes, tubes };
  }

  release(site) {
    if (!site.node) return;
    for (const m of site.node.domes) m.dispose();
    for (const t of site.node.tubes) t.mesh.dispose();
    site.node.lander.dispose();
    site.node.node.dispose();
    site.node = null;
  }

  /** Scale the visible parts to match how far along the site is. */
  shape(site, age) {
    const n = site.node;
    for (let i = 0; i < site.domes.length; i++) {
      const d = site.domes[i];
      const grow = clamp((age - d.born) / COLONY.growTime, 0, 1);
      const m = n.domes[i];
      if (grow <= 0) { m.setEnabled(false); continue; }
      m.setEnabled(true);
      // Inflate: overshoot slightly and settle, the way a pressurised
      // structure would.
      const e = grow < 1 ? 1 - Math.pow(1 - grow, 3) : 1;
      const puff = grow < 1 ? 1 + Math.sin(grow * Math.PI) * 0.06 : 1;
      m.scaling.set(d.r * e * puff, d.r * e * (0.82 + 0.18 * e), d.r * e * puff);
    }

    for (const t of n.tubes) {
      const a = site.domes[t.from], b = site.domes[t.to];
      const growB = clamp((age - b.born) / COLONY.growTime, 0, 1);
      if (growB <= 0.25) { t.mesh.setEnabled(false); continue; }
      t.mesh.setEnabled(true);
      const ay = n.domes[t.from].position.y + a.r * 0.30;
      const by = n.domes[t.to].position.y + b.r * 0.30;
      const dx = b.ox - a.ox, dz = b.oz - a.oz, dy = by - ay;
      const len = Math.hypot(dx, dy, dz);
      // The tube reaches across as its dome inflates.
      const ext = clamp((growB - 0.25) / 0.6, 0, 1);
      t.mesh.position.set(a.ox, ay, a.oz);
      t.mesh.rotation.set(-Math.asin(dy / Math.max(len, 0.01)),
        Math.atan2(dx, dz), 0);
      t.mesh.scaling.set(COLONY.tubeRadius, COLONY.tubeRadius, len * ext);
    }
  }

  // ---- loop -------------------------------------------------------------

  update(dt) {
    this.clock += dt;
    this.dropCool = Math.max(0, this.dropCool - dt);
    const craft = this.craft;

    // Falling probes.
    for (let i = this.probes.length - 1; i >= 0; i--) {
      const p = this.probes[i];
      p.vy -= COLONY.probeGravity * dt;
      const k = Math.exp(-COLONY.probeDrag * dt);
      p.vx *= k; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.spin += dt * 2.2;
      const pd = p.frame.dirAt(p.x, p.z, PD);
      placeOnSphere(p.mesh, this.planet, pd, p.y, p.spin);
      const g = Math.max(height(pd, this.planet), 0);
      if (p.y <= g + 0.4) {
        this.probes.splice(i, 1);
        p.y = g;
        this.settle(p);
      }
    }

    // Sites: stream meshes, advance growth, pay out.
    let income = 0;
    let domes = 0;
    for (const site of this.sites) {
      const age = this.clock - site.t0;
      const near = arcBetween(site.dir, craft.surf.frame.up, this.planet.radius) <
        Math.min(COLONY.viewRange, this.planet.radius * 1.4);

      if (near && !site.node) this.build(site);
      else if (!near && site.node) this.release(site);
      if (site.node) this.shape(site, age);

      let grown = 0;
      for (const d of site.domes) if (age - d.born >= COLONY.growTime) grown++;
      domes += grown;
      income += grown * COLONY.income;

      // Announce each new dome once, wherever you happen to be.
      const stage = Math.min(COLONY.maxDomes,
        Math.max(0, Math.floor(age / COLONY.domeEvery) + 1));
      if (stage > site.stage) {
        site.stage = stage;
        if (stage > 1) emit('colonygrow', { id: site.id, stage, pos: site.world });
      }
    }

    this.domesBuilt = domes;
    if (income > 0) craft.addFuel(Math.min(income, FUEL.max) * dt);
  }
}
