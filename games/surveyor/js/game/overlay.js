// THE SURVEY OVERLAY. Hold a key and the planet goes transparent.
//
// This is not a convenience, and it is not a minimap. Horizon distance at a 2m
// eye height is 29m on Ember and 91m on Anvil: you physically cannot see your
// own colonies past the curve of the world you are standing on. Some instrument
// is mandatory, and an x-ray survey chart is native to a game whose entire art
// direction is a topographic map you are driving around inside.
//
// HOW IT RENDERS THROUGH TERRAIN. Everything the overlay draws goes into
// rendering group 2, and the depth buffer is cleared before that group runs.
// Terrain, props, colonies and the craft are all group 1, so they are already
// drawn and already depth-tested against each other when the markers land on
// top. That is the whole trick, and it is the exact opposite of the GlowLayer
// this project threw out in phase 1 — there, haloes came through hillsides by
// ACCIDENT and it was wrong; here it is the feature, it is switched on by a
// held key, and it is off the rest of the time.
//
// THERE IS NO RANGE LIMIT, and adding one would throw away the best property
// this design has. Markers are drawn at world scale, so a colony on the far
// side of Ember is 414m away and plainly legible, and the same colony on Anvil
// is 4.1km away and a speck. Survey difficulty scales with planet radius for
// free, out of the geometry — measured in the suite, not asserted, because it
// is a consequence rather than a rule.
//
// It also carries the SYSTEM VIEW: all six worlds with progress, production and
// threat, so you can decide where to go next without going there. 4a left that
// out of the HUD deliberately rather than growing a second permanent panel; a
// held key is where it belongs.

import { arcBetween } from '../world/sphere.js';
import { placeOnSphere } from '../world/surface.js';
import { OVERLAY, COLORS, PLANETS, ECONOMY } from '../tune.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DEG = 180 / Math.PI;
const $ = (id) => (typeof document === 'undefined' ? null : document.getElementById(id));
const F = { x: 0, y: 0, z: 0 };
const W = { x: 0, y: 0, z: 0 };
const LOC = { x: 0, y: 0, z: 0 };

/** The rendering group everything x-ray lives in. See the note at the top. */
const XRAY = 2;

export class Overlay {
  constructor(scene, craft) {
    this.scene = scene;
    this.craft = craft;
    this.world = null;
    this.held = false;
    this.mix = 0;                 // 0..1, eased, so the tint is not a hard cut
    this.selected = null;
    this.markers = 0;             // how many were drawn last frame. Measured
    this.refreshT = 0;

    // Depth is cleared before the overlay group and NOT written by it, so a
    // marker never occludes another marker — two colonies in a line read as one
    // brighter blob, which is exactly the information wanted.
    if (scene.setRenderingAutoClearDepthStencil) {
      scene.setRenderingAutoClearDepthStencil(XRAY, true, true, false);
    }

    this.mats = {
      colony: this.glow('ovColony', COLORS.phosphor, 2.6),
      vent: this.glow('ovVent', [0.30, 0.62, 1.00], 3.2),
      ventDone: this.glow('ovVentDone', [0.16, 0.86, 0.72], 2.0),
      raider: this.glow('ovRaider', [1.00, 0.22, 0.28], 3.2),
      pick: this.glow('ovPick', COLORS.coast, 3.4),
    };

    this.protos = {
      colony: BABYLON.MeshBuilder.CreateSphere('ovColonyProto',
        { diameter: 2, segments: 8 }, scene),
      vent: BABYLON.MeshBuilder.CreateCylinder('ovVentProto',
        { height: 1, diameterTop: 1.6, diameterBottom: 0.5, tessellation: 8 }, scene),
      raider: BABYLON.MeshBuilder.CreatePolyhedron('ovRaiderProto',
        { type: 0, size: 1 }, scene),
    };
    for (const m of Object.values(this.protos)) {
      m.isPickable = false;
      m.setEnabled(false);
      m.renderingGroupId = XRAY;
    }
    this.pool = { colony: [], vent: [], raider: [] };

    // The DOM half. Absent in the headless harness, which is why every touch of
    // it below is guarded — the render pass is the part worth testing.
    this.el = {
      xray: $('xray'), panel: $('survey'), rows: $('systemRows'),
      sel: $('surveySel'), selName: $('selName'), selRange: $('selRange'),
      selNote: $('selNote'),
    };
    this.rowEls = null;
  }

  /**
   * Additive, unlit, and it does not write depth.
   *
   * Additive is doing real work: two overlapping colony volumes are literally
   * brighter than one, so the biggest cluster is the brightest thing on the
   * chart without anybody computing a brightness. That is the same number the
   * economy pays on and the same number raiders are drawn to, arrived at three
   * different ways and agreeing.
   */
  glow(name, c, k) {
    const m = new BABYLON.StandardMaterial(name, this.scene);
    m.emissiveColor = new BABYLON.Color3(c[0] * k, c[1] * k, c[2] * k);
    m.diffuseColor = new BABYLON.Color3(0, 0, 0);
    m.specularColor = new BABYLON.Color3(0, 0, 0);
    m.disableLighting = true;
    m.alpha = 0.80;
    m.backFaceCulling = false;
    m.disableDepthWrite = true;
    // Additive blend. Named through Constants rather than typed as a 1, and
    // guarded because the headless harness's stub has neither.
    if (BABYLON.Constants && BABYLON.Constants.ALPHA_ADD !== undefined) {
      m.alphaMode = BABYLON.Constants.ALPHA_ADD;
    }
    return m;
  }

  attach(economy, totals, keys) {
    this.economy = economy;
    this.totals = totals;
    this.keys = keys || Object.keys(PLANETS);
    if (!this.el.rows) return;
    this.rowEls = this.keys.map((key) => {
      const row = document.createElement('div');
      row.className = 'srow';
      const mk = (cls, text) => {
        const s = document.createElement('span');
        s.className = cls;
        s.textContent = text;
        row.appendChild(s);
        return s;
      };
      const cells = {
        name: mk('sname', PLANETS[key].name),
        prog: mk('sprog', '0/0'),
        rate: mk('srate', '0.0'),
        threat: mk('sthreat', '—'),
        trip: mk('strip', '—'),
      };
      this.el.rows.appendChild(row);
      return { key, row, cells, was: '' };
    });
  }

  /** Arrived somewhere else: new planet, new colonies, new materials. */
  retarget(world) {
    if (this.world && this.world !== world) this.wire(this.world, false);
    this.world = world;
    if (this.held) this.wire(world, true);
  }

  /** Terrain and water to wireframe, or back. The x-ray look, such as it is. */
  wire(world, on) {
    if (!world) return;
    // Turning it OFF is unconditional. `OVERLAY.wireframe` is the dial someone
    // flips from the console mid-session, and gating both directions on it
    // leaves the terrain in wireframe forever the moment they do it while the
    // key is down.
    const want = !!(on && OVERLAY.wireframe);
    if (world.mats.terrain) world.mats.terrain.wireframe = want;
    if (world.mats.water) world.mats.water.wireframe = want;
  }

  setHeld(on) {
    if (on === this.held) return;
    this.held = on;
    this.wire(this.world, on);
    if (this.el.panel) this.el.panel.classList.toggle('on', on);
    if (!on) this.hideAll();
  }

  hideAll() {
    for (const kind of Object.keys(this.pool)) {
      for (const m of this.pool[kind]) m.setEnabled(false);
    }
    this.markers = 0;
    this.selected = null;
  }

  /** A pooled marker of a kind. Built once, reused for the whole session. */
  take(kind, i) {
    const list = this.pool[kind];
    if (i < list.length) { list[i].setEnabled(true); return list[i]; }
    const m = this.protos[kind].clone('ov_' + kind + i);
    m.renderingGroupId = XRAY;
    m.isPickable = false;
    m.setEnabled(true);
    list.push(m);
    return m;
  }

  // ---- the pass ----------------------------------------------------------

  /**
   * `cam` is the ChaseCam, not the Babylon camera: selection is by what is
   * nearest the middle of the screen, and the aim point is the only honest
   * statement of where that is.
   */
  update(dt, cam) {
    const to = this.held ? 1 : 0;
    this.mix += (to - this.mix) * (1 - Math.exp(-dt / Math.max(0.01, OVERLAY.fade)));
    if (this.el.xray) {
      this.el.xray.classList.toggle('on', this.mix > 0.02);
      this.el.xray.style.opacity = this.mix.toFixed(3);
    }
    if (!this.held || !this.world || this.craft.hyper) {
      if (this.markers) this.hideAll();
      return;
    }

    // Screen centre, as a direction. Everything below is scored against it.
    let fx = 0, fy = 0, fz = 1;
    if (cam) {
      fx = cam.aim.x - cam.camera.position.x;
      fy = cam.aim.y - cam.camera.position.y;
      fz = cam.aim.z - cam.camera.position.z;
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl; fy /= fl; fz /= fl;
    }
    const camP = cam ? cam.camera.position : this.craft.world;
    const cosSel = Math.cos(OVERLAY.selectCone);
    let best = null, bestDot = cosSel;

    const consider = (kind, label, mesh, extra) => {
      const dx = mesh.position.x - camP.x;
      const dy = mesh.position.y - camP.y;
      const dz = mesh.position.z - camP.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const dot = (dx * fx + dy * fy + dz * fz) / d;
      if (dot > bestDot) {
        bestDot = dot;
        best = { kind, label, mesh, extra, dir: null };
      }
    };

    const P = this.world.planet;
    const col = this.world.colonies;
    let n = 0;

    // Colonies: a glowing volume, radius and brightness by density. The biggest
    // cluster is the brightest blob, which is also the most fuel and — since
    // this phase — the most pressure.
    for (let i = 0; i < col.sites.length; i++) {
      const s = col.sites[i];
      const d = s.density || s.grown || 0;
      const r = Math.min(OVERLAY.blobMax, OVERLAY.blobBase + d * OVERLAY.blobPerDensity);
      const m = this.take('colony', i);
      m.material = this.mats.colony;
      placeOnSphere(m, P, s.dir, s.elevation + r * 0.55, 0);
      m.scaling.setAll(r);
      m.visibility = clamp(0.50 + d * 0.045, 0.50, 1);
      consider('colony', 'COLONY ' + s.id, m, s);
      n++;
    }
    for (let i = col.sites.length; i < this.pool.colony.length; i++) {
      this.pool.colony[i].setEnabled(false);
    }

    // Vents: a blue column, claimed distinct from unclaimed. Claimed goes teal
    // and short — the same colour the survey uses for "logged" everywhere else.
    const claimed = new Set();
    for (const s of col.sites) if (s.geyser) claimed.add(s.geyser.id);
    for (let i = 0; i < col.geysers.length; i++) {
      const g = col.geysers[i];
      const done = claimed.has(g.id);
      const h = OVERLAY.ventHeight * (done ? 0.45 : 1);
      const m = this.take('vent', i);
      m.material = done ? this.mats.ventDone : this.mats.vent;
      placeOnSphere(m, P, g.dir, g.elevation + h * 0.5, 0);
      m.scaling.set(OVERLAY.ventSize, h, OVERLAY.ventSize);
      m.visibility = done ? 0.55 : 1;
      consider('vent', (done ? 'VENT ' : 'VENT — UNCLAIMED ') + g.id, m, g);
      n++;
    }
    for (let i = col.geysers.length; i < this.pool.vent.length; i++) {
      this.pool.vent[i].setEnabled(false);
    }

    // Raiders: red, and intensity by how far along the attack is. One that has
    // arrived is at full brightness and one still closing is dim, so the overlay
    // reads as "how long have I got" rather than as a count.
    const rd = col.raiders;
    for (let i = 0; i < rd.list.length; i++) {
      const r = rd.list[i];
      const t = clamp(r.age / r.approach, 0, 1);
      const m = this.take('raider', i);
      m.material = this.mats.raider;
      rd.worldOf(r, W);
      m.position.set(W.x, W.y, W.z);
      m.rotation.y = r.age * 1.4;
      m.scaling.setAll(OVERLAY.raiderSize * (0.7 + t * 0.6));
      m.visibility = clamp(0.45 + t * 0.55, 0.45, 1);
      consider('raider', 'RAIDER', m, r);
      n++;
    }
    for (let i = rd.list.length; i < this.pool.raider.length; i++) {
      this.pool.raider[i].setEnabled(false);
    }

    this.markers = n;
    this.selected = best;
    if (best) best.mesh.material = this.mats.pick;

    this.readout(best, P);
    this.refreshT -= dt;
    if (this.refreshT <= 0) { this.refreshT = OVERLAY.refresh; this.system(); }
  }

  /**
   * Heading and distance to whatever is selected.
   *
   * Bearing is taken in the craft's own tangent frame. Subtracting world
   * coordinates gives a chord through the planet, which points at the wrong
   * thing the moment the target is over the curve — and over the curve is the
   * only place this instrument is ever used.
   */
  readout(best, P) {
    if (!this.el.sel) return;
    this.el.sel.classList.toggle('on', !!best);
    if (!best) return;
    const c = this.craft;
    const L = c.surf.toLocal(best.mesh.position.x, best.mesh.position.y,
      best.mesh.position.z, LOC);
    const bearing = ((Math.atan2(L.x, L.z) * DEG) % 360 + 360) % 360;
    const here = c.surf.frame.up;
    F.x = best.mesh.position.x; F.y = best.mesh.position.y; F.z = best.mesh.position.z;
    const len = Math.hypot(F.x, F.y, F.z) || 1;
    F.x /= len; F.y /= len; F.z /= len;
    const arc = arcBetween(F, here, P.radius);
    this.el.selName.textContent = best.label;
    this.el.selRange.textContent =
      (arc > 1500 ? (arc / 1000).toFixed(1) + ' KM' : Math.round(arc) + ' M') +
      '  ·  ' + Math.round(bearing).toString().padStart(3, '0') + '°';
    let note = '';
    if (best.kind === 'colony') {
      const s = best.extra;
      note = `${s.grown}/6 DOMES · DENSITY ${(s.density || 0).toFixed(1)}` +
        (s.turret ? ' · DEFENDED' : '') +
        (s.maxHp && s.hp < s.maxHp * 0.98
          ? ` · INTEGRITY ${Math.round((s.hp / s.maxHp) * 100)}%` : '');
    } else if (best.kind === 'vent') {
      note = best.extra.kind.toUpperCase() + ' VENT · YIELD ' + best.extra.yield.toFixed(1);
    } else {
      const r = best.extra;
      note = r.age >= r.approach ? 'ENGAGED' :
        'CONTACT IN ' + Math.max(0, Math.round(r.approach - r.age)) + 'S';
    }
    this.el.selNote.textContent = note;
  }

  /**
   * The system view: six worlds, one row each.
   *
   * Everything here is already in the record — this reads it, it does not keep
   * its own. Refreshed a few times a second rather than every frame, because it
   * is a panel of text and nobody can read it at 60Hz.
   */
  system() {
    if (!this.rowEls || !this.economy) return;
    const e = this.economy;
    const here = this.world ? this.world.planet.key : null;
    for (const row of this.rowEls) {
      const c = e.worlds.get(row.key);
      const got = e.claimed(row.key);
      const total = this.totals[row.key] || 0;
      const rate = c ? c.hyperRate * 60 : 0;
      const raiders = c ? c.raiders.list.length : 0;
      const cost = row.key === here ? 0 : e.costTo(here, row.key);
      const reach = row.key === here || e.hyper >= cost;
      const line = `${got}/${total}|${rate.toFixed(1)}|${raiders}|${reach}|${row.key === here}`;
      if (line === row.was) continue;
      row.was = line;
      row.cells.prog.textContent = got + '/' + total;
      row.cells.rate.textContent = rate > 0 ? rate.toFixed(1) : '—';
      row.cells.threat.textContent = raiders ? '▲'.repeat(Math.min(4, raiders)) : '—';
      row.cells.trip.textContent = row.key === here ? 'HERE' : Math.ceil(cost);
      row.row.className = 'srow' + (row.key === here ? ' here' : '') +
        (!reach ? ' far' : '') + (raiders ? ' hot' : '') +
        (total && got >= total ? ' full' : '');
    }
    if (this.el.panel) {
      this.el.panel.classList.toggle('rich', this.economy.hyper >= ECONOMY.maxHyper * 0.5);
    }
  }
}
