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
import { geyserAt, geysersOf } from '../world/geysers.js';
import { densityOf, hyperRateOf } from './economy.js';
import { Raiders } from './raiders.js';
import { COLONY, ECONOMY, FUEL, GEYSER } from '../tune.js';
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

/** The vent itself: a low fluted collar of rock around a dark throat. */
function ventGeo() {
  const g = new Geo();
  const N = 9;
  const ROCK = [0.196, 0.243, 0.271, 0];
  const THROAT = [0.031, 0.055, 0.075, 0];
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    // Uneven lip, so it reads as something the ground did rather than a pipe.
    const h0 = 0.55 + 0.45 * Math.abs(Math.sin(i * 2.4));
    const h1 = 0.55 + 0.45 * Math.abs(Math.sin((i + 1) * 2.4));
    const o0 = [Math.cos(a0) * 1.75, 0, Math.sin(a0) * 1.75];
    const o1 = [Math.cos(a1) * 1.75, 0, Math.sin(a1) * 1.75];
    const t0 = [Math.cos(a0), h0, Math.sin(a0)];
    const t1 = [Math.cos(a1), h1, Math.sin(a1)];
    g.quad(o0, o1, t1, t0, ROCK);            // outer flank
    g.quad(t1, [Math.cos(a1) * 0.72, h1 * 0.72, Math.sin(a1) * 0.72],
      [Math.cos(a0) * 0.72, h0 * 0.72, Math.sin(a0) * 0.72], t0, THROAT);
  }
  return g;
}

/** A worker: a stubby box on a lit strip. Seen at 40m, this is plenty. */
function workerGeo() {
  const g = new Geo();
  const BODY = [0.760, 0.780, 0.745, 0];
  const EYE = [0.169, 0.878, 0.784, 1];
  g.extrudeY([[-0.30, -0.22], [0.30, -0.22], [0.30, 0.22], [-0.30, 0.22]], 0, 0.42, BODY);
  g.extrudeY([[-0.20, 0.20], [0.20, 0.20], [0.20, 0.26], [-0.20, 0.26]], 0.16, 0.32, EYE);
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
    /* Set while the away window is being replayed at boot. Everything that
       talks to the player or pays them checks it: an hour of catch-up is
       thirty dome announcements, a dozen raider contacts and an hour of
       charge income, and none of that happened while you were watching. The
       summary you do get is emitted once, by main.js, at the end. */
    this.quiet = false;

    // Prototypes, cloned per instance. Unit-sized so a clone is just a scale.
    this.domeProto = domeGeo(11, 4).toMesh(scene, 'domeProto', mat);
    this.domeProto.setEnabled(false);
    this.tubeProto = tubeGeo(7).toMesh(scene, 'tubeProto', mat);
    this.tubeProto.setEnabled(false);
    this.landerProto = landerGeo().toMesh(scene, 'landerProto', mat);
    this.landerProto.setEnabled(false);
    this.probeProto = landerGeo().toMesh(scene, 'probeProto', mat);
    this.probeProto.setEnabled(false);
    this.workerProto = workerGeo().toMesh(scene, 'workerProto', mat);
    this.workerProto.setEnabled(false);
    this.ventProto = ventGeo().toMesh(scene, 'ventProto', mat);
    this.ventProto.setEnabled(false);

    /* The plume. Translucent and emissive rather than lit, because it is smoke
       seen against six very different skies and it has to stay blue on all of
       them — the same reason the wake rings in trails.js are built this way. */
    this.puffMat = new BABYLON.StandardMaterial('plume', scene);
    // Authored above 1.0 so the bloom pass carries the column the last few
    // hundred metres. A vent has to be spottable from a ridge across a valley —
    // it is the objective, and one you cannot see turns finding them into a
    // grid search rather than a discovery.
    this.puffMat.emissiveColor = new BABYLON.Color3(
      GEYSER.plumeGlow[0], GEYSER.plumeGlow[1], GEYSER.plumeGlow[2]);
    this.puffMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    this.puffMat.specularColor = new BABYLON.Color3(0, 0, 0);
    this.puffMat.disableLighting = true;
    this.puffMat.alpha = GEYSER.plumeAlpha;
    this.puffProto = BABYLON.MeshBuilder.CreatePolyhedron('puffProto',
      { type: 2, size: 1 }, scene);
    this.puffProto.material = this.puffMat;
    this.puffProto.isPickable = false;
    this.puffProto.setEnabled(false);

    this.vents = new Map();        // geyser id -> { node, vent, puffs }
    this.geysers = geysersOf(planet);
    // Raiders live with the sites they attack, so that ticking a world's
    // colonies is the same act as ticking the threat to them — one clock, one
    // record, and no way for the two to drift apart on a world nobody is
    // rendering.
    this.raiders = new Raiders(scene, this, planet, mat);
  }

  /** How many geysers on this world have a colony on them. */
  get claimed() {
    const seen = new Set();
    for (const s of this.sites) if (s.geyser) seen.add(s.geyser.id);
    return seen.size;
  }

  get geyserCount() { return this.geysers.length; }

  get count() { return this.sites.length; }
  get domes() { return this.domesBuilt; }

  // ---- dropping ---------------------------------------------------------

  /**
   * True if a probe actually left the rack.
   *
   * Droppable from the rover as well as the jet now. Geysers are the thing
   * worth colonising and you find them by driving; making the claim require a
   * take-off, a circuit and a lead-the-target bombing run turned the reward for
   * exploring into a chore. From the ground it plants where you stand.
   */
  drop() {
    const c = this.craft;
    if (c.hyper) { emit('dropfail', { why: 'transit' }); return false; }
    if (c.mode === 'boat') { emit('dropfail', { why: 'water' }); return false; }
    if (c.mode === 'jet' && c.altitude < COLONY.minAlt) {
      emit('dropfail', { why: 'low' });
      return false;
    }
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

    // Which vent, if any, this lands on. THE rule of the economy: a habitat on
    // a geyser makes hyper fuel, one anywhere else makes flight charge.
    const geyser = geyserAt(P, dir);

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
      id, dir, frame: fr, elevation: g, world, geyser,
      t0: this.clock, domes, node: null, stage: 0, grown: 0, workers: null,
    });
    emit('colony', { pos: world, id, stage: 0, geyser: !!geyser });
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
    site.node = { node, lander, domes, tubes, turret: null };
  }

  /** Raided to nothing. The record goes, which is what makes the loss real. */
  destroy(site) {
    this.release(site);
    const i = this.sites.indexOf(site);
    if (i >= 0) this.sites.splice(i, 1);
  }

  release(site) {
    if (!site.node) return;
    if (site.node.turret) { site.node.turret.dispose(); site.node.turret = null; }
    if (site.workers) {
      for (const w of site.workers) w.mesh.dispose();
      site.workers = null;
    }
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

  // ---- geysers and workers ----------------------------------------------

  /**
   * Vents stream like everything else: built on approach, released on leaving,
   * regenerated from the same fixed field so a plume is where you left it.
   *
   * The plume is a ring of puffs on a shared phase — each rises, swells and
   * fades, then wraps. That is cheaper than a particle system per vent and it
   * loops seamlessly, which matters because these are meant to be read from a
   * long way off and never seen to restart.
   */
  streamGeysers(dt, here) {
    const P = this.planet;
    const range = Math.min(GEYSER.viewRange, P.radius * 1.6);
    this.plumeT = (this.plumeT || 0) + dt;
    const tall = GEYSER.plumeHeight * Math.max(0.5, Math.min(2, P.relief / 52));

    for (const gy of this.geysers) {
      const near = here && arcBetween(gy.dir, here, P.radius) < range;
      const live = this.vents.get(gy.id);
      if (near && !live) {
        const node = new BABYLON.TransformNode('vent' + gy.id, this.scene);
        placeOnSphere(node, P, gy.dir, gy.elevation, 0);
        const vent = this.ventProto.clone('ventM' + gy.id);
        vent.parent = node;
        vent.setEnabled(true);
        vent.renderingGroupId = 1;
        vent.scaling.setAll(1.6);
        const puffs = [];
        for (let i = 0; i < GEYSER.plumePuffs; i++) {
          const m = this.puffProto.clone('puff' + gy.id + '_' + i);
          m.parent = node;
          m.setEnabled(true);
          m.renderingGroupId = 1;
          puffs.push(m);
        }
        this.vents.set(gy.id, { node, vent, puffs });
      } else if (!near && live) {
        for (const m of live.puffs) m.dispose();
        live.vent.dispose();
        live.node.dispose();
        this.vents.delete(gy.id);
      }

      const v = this.vents.get(gy.id);
      if (!v) continue;
      for (let i = 0; i < v.puffs.length; i++) {
        // Evenly spaced phases, so the column is continuous.
        const ph = ((this.plumeT * GEYSER.plumeRise / tall) + i / v.puffs.length) % 1;
        const m = v.puffs[i];
        m.position.set(
          Math.sin(this.plumeT * 0.7 + i) * ph * GEYSER.plumeSpread,
          1.2 + ph * tall,
          Math.cos(this.plumeT * 0.9 + i * 1.7) * ph * GEYSER.plumeSpread);
        // Swell as it rises, and thin out rather than blink off. The column is
        // read from a ridge, so it is wide at the top rather than a thread.
        m.scaling.setAll(1.6 + ph * GEYSER.plumeWidth);
        // Held up for the first two thirds and only then given away: a plume
        // that fades linearly reads as half its height from a distance.
        m.visibility = (ph < 0.10 ? ph / 0.10 : Math.min(1, (1 - ph) * 2.4)) * 0.92;
      }
    }
  }

  /**
   * Workers, and what they are for.
   *
   * They are decoration and a READOUT, never a simulation: production is
   * computed from density on wall time whether or not one of these is on
   * screen. Their job is that a dense colony looks busy from a ridge away, so
   * you can read a site's worth before the HUD tells you — which is the same
   * reason the plume is tall.
   */
  /** How many bots this site should be showing right now. */
  workerCount(site) {
    return Math.min(COLONY.maxWorkers,
      Math.round(1 + (site.density || site.grown) * COLONY.workersPerDensity));
  }

  buildWorkers(site) {
    if (site.workers) for (const w of site.workers) w.mesh.dispose();
    const n = this.workerCount(site);
    const rng = rngFor(this.planet.seed, 'workers:' + site.id);
    const list = [];
    for (let i = 0; i < n; i++) {
      const m = this.workerProto.clone('worker' + site.id + '_' + i);
      m.parent = site.node.node;
      m.setEnabled(true);
      m.renderingGroupId = 1;
      // A route between two of the site's own points, walked back and forth.
      // Seeded, so a colony you return to is doing what it was doing.
      const a = (rng() * site.domes.length) | 0;
      const b = (rng() * site.domes.length) | 0;
      list.push({
        mesh: m, a, b, t: rng(), dir: rng() < 0.5 ? 1 : -1,
        speed: range(rng, 0.55, 1.25),
        // A third of them work the vent head rather than the domes.
        atVent: site.geyser && rng() < 0.34,
      });
    }
    site.workers = list;
  }

  moveWorkers(site, dt) {
    if (!site.node) return;
    /* Rebuilt when the number changes, not only when the meshes appear. The
       crew is the readout — a site that has grown, or that a neighbour has
       grown next to, has to LOOK busier — and the first build happens before
       the first density tick, so a site that never rebuilt showed one bot
       forever however big it got. */
    if (!site.workers || site.workers.length !== this.workerCount(site)) {
      this.buildWorkers(site);
    }
    for (const w of site.workers) {
      w.t += w.dir * w.speed * dt * 0.18;
      if (w.t > 1) { w.t = 1; w.dir = -1; } else if (w.t < 0) { w.t = 0; w.dir = 1; }
      const A = site.domes[w.a], B = site.domes[w.b];
      const ease = w.t * w.t * (3 - 2 * w.t);
      const x = A.ox + (B.ox - A.ox) * ease;
      const z = A.oz + (B.oz - A.oz) * ease;
      const y = site.node.domes[w.a].position.y;
      w.mesh.position.set(x, y + 0.1, z);
      w.mesh.rotation.y = Math.atan2((B.ox - A.ox) * w.dir, (B.oz - A.oz) * w.dir);
    }
  }

  // ---- loop -------------------------------------------------------------

  /**
   * Wall time. Growth, density and production, for a world whether or not it is
   * the one being rendered.
   *
   * Split from `stream` so the Economy can advance every visited world every
   * frame while only one of them owns the scene. Nothing here touches a mesh,
   * which is what makes "your colonies keep working while you are away" true
   * rather than merely claimed.
   */
  tick(dt) {
    this.clock += dt;
    this.dropCool = Math.max(0, this.dropCool - dt);

    let domes = 0;
    for (const site of this.sites) {
      const age = this.clock - site.t0;
      let grown = 0;
      for (const d of site.domes) if (age - d.born >= COLONY.growTime) grown++;
      site.grown = grown;
      domes += grown;

      // Announce each new dome once, wherever you happen to be.
      const stage = Math.min(COLONY.maxDomes,
        Math.max(0, Math.floor(age / COLONY.domeEvery) + 1));
      if (stage > site.stage) {
        site.stage = stage;
        if (stage > 1 && !this.quiet) emit('colonygrow', { id: site.id, stage, pos: site.world });
      }
    }
    this.domesBuilt = domes;

    // Density needs every site's `grown` settled first, so this is a second
    // pass rather than part of the loop above.
    let flight = 0, hyper = 0;
    for (const site of this.sites) {
      site.density = densityOf(site, this.sites, this.planet);
      flight += site.grown * COLONY.income;
      hyper += hyperRateOf(site, this.sites, this.planet);
    }
    this.flightRate = flight;
    this.hyperRate = hyper;
    // No income during the replay. Raiding offline is the decision that was
    // made; paying an hour of charge into a tank you were not holding is not.
    if (flight > 0 && !this.quiet) this.craft.addFuel(Math.min(flight, FUEL.max) * dt);

    // Last, and on the same clock: density has to be settled before raiders can
    // be drawn to it or a turret can decide whether it exists.
    this.raiders.tick(dt);
  }

  /**
   * The visible half: falling probes, colony meshes, geyser plumes, workers.
   * Only ever called for the world the scene is drawing.
   */
  stream(dt) {
    const craft = this.craft;

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

    const here = craft.hyper ? null : craft.surf.frame.up;
    const range = Math.min(COLONY.viewRange, this.planet.radius * 1.4);
    for (const site of this.sites) {
      const near = here &&
        arcBetween(site.dir, here, this.planet.radius) < range;
      if (near && !site.node) this.build(site);
      else if (!near && site.node) this.release(site);
      if (site.node) {
        this.shape(site, this.clock - site.t0);
        this.moveWorkers(site, dt);
        this.raiders.shapeTurret(site);
      }
    }

    this.streamGeysers(dt, here);
    this.raiders.stream(dt, here, craft);
  }

  /** Kept so a caller that does not care about the split still works. */
  update(dt) {
    this.tick(dt);
    this.stream(dt);
  }

  /**
   * REPLAY the time the tab was shut, rather than back-dating through it.
   *
   * Growth used to be credited by simply making every site older by the away
   * time, which is exact for growth and impossible for anything else: raiders
   * spawn, close, do damage and get shot down, and none of that is a function
   * of a site's age alone. So the window is run through the same `tick` the
   * game runs, at a coarse step, and both halves come out of one mechanism —
   * which is also the only way they can be guaranteed to agree.
   *
   * The point of doing this at all: crediting growth for an absence and not
   * attacks made closing the tab strictly better than playing. That is a
   * perverse incentive, and the fix is not to take the growth away.
   *
   * Returns what the player missed, for the one summary they are told.
   */
  catchUp(seconds) {
    if (!(seconds > 0) || !this.sites.length) return null;
    const step = Math.max(0.25, ECONOMY.offlineStep);
    const before = this.sites.length;
    const killsBefore = this.raiders.kills;
    this.quiet = true;
    for (let t = 0; t < seconds; t += step) this.tick(Math.min(step, seconds - t));
    this.quiet = false;
    return {
      world: this.planet.key,
      seconds,
      lost: before - this.sites.length,
      held: this.raiders.kills - killsBefore,
      raiders: this.raiders.list.length,
    };
  }

  /** The savable record of a site: everything the layout cannot regenerate. */
  record(site) {
    return {
      id: site.id,
      dir: [site.dir.x, site.dir.y, site.dir.z],
      age: this.clock - site.t0,
      geyser: site.geyser ? site.geyser.id : null,
      // Integrity as a FRACTION, because the pool it is a fraction of grows
      // with the domes and those are regenerated from the age, not stored.
      hp: site.maxHp ? site.hp / site.maxHp : 1,
    };
  }

  /**
   * Rebuild a site from a saved record.
   *
   * Only the direction and the age come back; the dome layout, radii and link
   * order are all regenerated from the same seeded rng that made them, which is
   * the same guarantee that lets the meshes be thrown away between visits.
   *
   * `away` still ages a site directly, and main.js no longer uses it: the away
   * window is REPLAYED by `catchUp` instead, so that raiders live through it
   * too. It is kept because ageing a site on the way in is a genuinely useful
   * thing to be able to ask for, and the harness asks for it constantly.
   */
  restore(rec, away) {
    const P = this.planet;
    const dir = { x: rec.dir[0], y: rec.dir[1], z: rec.dir[2] };
    const g = height(dir, P);
    const fr = new TangentFrame(P, dir);
    const rng = rngFor(P.seed,
      'colony:' + rec.id + ':' + Math.round(dir.x * 1e4) + ',' + Math.round(dir.z * 1e4));
    const domes = [];
    for (let i = 0; i < COLONY.maxDomes; i++) {
      const a = rng() * Math.PI * 2;
      const d = i === 0 ? 0 : range(rng, 0.75, 1.15) * COLONY.spread * (0.6 + i * 0.22);
      domes.push({
        ox: Math.cos(a) * d, oz: Math.sin(a) * d,
        r: COLONY.baseRadius + i * COLONY.radiusStep * range(rng, 0.7, 1.2),
        born: i * COLONY.domeEvery,
        parent: i === 0 ? -1 : (rng() * i) | 0,
      });
    }
    const geyser = rec.geyser === null ? null
      : geysersOf(P).find((x) => x.id === rec.geyser) || null;
    this.nextId = Math.max(this.nextId, rec.id + 1);
    this.sites.push({
      id: rec.id, dir, frame: fr, elevation: g, geyser,
      world: { x: dir.x * (P.surfaceR + g), y: dir.y * (P.surfaceR + g), z: dir.z * (P.surfaceR + g) },
      // The age it had when saved plus the time the tab was shut: growth is a
      // function of wall time, so closing the game only pauses watching it.
      t0: this.clock - (rec.age + (away || 0)),
      domes, node: null, stage: COLONY.maxDomes, grown: 0, workers: null,
      /* Damage carries across a reload; RAIDING DOES NOT RUN OFFLINE. Growth is
         credited for the time the tab was shut and attacks are not, which is
         deliberately the merciful way round — coming back to a world you left
         alive and finding it razed by a clock you could not see is the worst
         version of this mechanic. Away time is a grace period. */
      hpFrac: rec.hp === undefined ? 1 : rec.hp,
    });
  }
}
