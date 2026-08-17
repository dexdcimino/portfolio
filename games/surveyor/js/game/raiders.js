// Raiders, and the two defences that do not need a weapon.
//
// THE RULE THIS FILE OBEYS is the one colony.js already set: the record is the
// world, the meshes are only what you can currently see of it. A raider's whole
// state is an age, a target and a hit-point count, and its POSITION is derived
// from those three — so a world nobody is rendering is attacked exactly as hard
// as one you are standing on, for the cost of six numbers per raider and no
// integration at all. Leave a world for twenty minutes and it has been under
// attack for twenty minutes.
//
// THE LOOP THIS CLOSES. Raiders are drawn to density, and density is what pays:
// 4a made clustering worth 3.8x, and this is the bill for it. The brightest blob
// on the survey overlay is simultaneously your biggest producer and your biggest
// problem, which is what turns "where do I drop this probe" from an optimisation
// into a bet.
//
// AND THE COUNTERWEIGHT. Past a density threshold a site grows its own turret
// and holds its ground without you — including over the young sites next to it,
// because a turret defends everything inside its range and not merely itself.
// That is what makes the away game work. Without it, every world you leave
// decays while you are gone, the correct strategy becomes not colonising, and
// the whole economy the last phase built is a chore with extra steps.

import { Geo } from '../player/meshes.js';
import { height } from '../world/noise.js';
import { arcBetween } from '../world/sphere.js';
import { placeOnSphere } from '../world/surface.js';
import { rngFor } from '../core/rng.js';
import { RAIDER, DEFENCE } from '../tune.js';
import { emit } from '../core/events.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const SHELL = [0.235, 0.208, 0.243, 0];
const EDGE  = [0.098, 0.086, 0.110, 0];
const EYE   = [1.000, 0.220, 0.290, 1];

/** A dart: a faceted spindle with a lit core band and four swept fins. */
function raiderGeo() {
  const g = new Geo();
  const ring = (n, r) => {
    const p = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / n;
      p.push([Math.cos(a) * r, Math.sin(a) * r * 0.72]);
    }
    return p;
  };
  // Nose forward along +Z, so a raider closing on a site is pointed at it.
  g.loft([
    { z: -0.95, pts: ring(6, 0.16) },
    { z: -0.30, pts: ring(6, 0.52) },
    { z: 0.16, pts: ring(6, 0.44) },
    { z: 1.05, pts: ring(6, 0.10) },
  ], SHELL);
  // The band. Authored above 1.0 in alpha so the craft shader treats it as
  // emissive and the bloom pass picks it up — the same channel the beacons use.
  g.cylZ(0, 0, -0.08, 0.50, 0.10, 6, EYE);
  /* The tail collar, and it is a SOLID rather than four flat fins. A fin drawn
     as a pair of back-to-back triangles is two faces pointing into each other,
     which is precisely the thing the signed-volume checks in the suite exist to
     catch — and it would have passed one, because the two cancel. Everything
     here is a closed solid built out of the same primitives as the hulls. */
  g.cylZ(0, 0, -0.72, 0.84, 0.14, 4, EDGE);
  return g;
}

/** A turret: a squat drum with a lit ring, sat beside the site's first dome. */
function turretGeo() {
  const g = new Geo();
  const BASE = [0.208, 0.259, 0.290, 0];
  const LIT = [0.169, 0.878, 0.784, 1];
  const ngon = (n, r) => {
    const p = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      p.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return p;
  };
  g.extrudeY(ngon(7, 1.0), 0, 1.05, BASE);
  g.extrudeY(ngon(7, 0.68), 1.05, 1.45, LIT);
  g.extrudeY([[-0.16, 0], [0.16, 0], [0.16, 2.6], [-0.16, 2.6]], 1.30, 1.62, BASE);
  return g;
}

const D = { x: 0, y: 0, z: 0 };
const L = { x: 0, y: 0, z: 0 };

export class Raiders {
  constructor(scene, colonies, planet, mat) {
    this.scene = scene;
    this.colonies = colonies;
    this.planet = planet;
    this.mat = mat;
    this.list = [];
    this.nextId = 1;
    this.spawnClock = 0;
    this.kills = 0;
    this.lost = 0;                     // colonies destroyed on this world

    // Per-world profile. Overrides are absolute where they name a quantity and
    // multipliers where they name a scale, so a profile reads as what the world
    // IS — "slow and armoured" — rather than as arithmetic.
    this.P = Object.assign({}, RAIDER, planet.raiders || {});

    if (scene && mat) {
      this.proto = raiderGeo().toMesh(scene, 'raiderProto', mat);
      this.proto.setEnabled(false);
      this.turretProto = turretGeo().toMesh(scene, 'turretProto', mat);
      this.turretProto.setEnabled(false);
    }
  }

  get sites() { return this.colonies.sites; }

  /** Live raiders that have reached their target. The HUD's threat number. */
  get engaged() {
    let n = 0;
    for (const r of this.list) if (r.age >= r.approach) n++;
    return n;
  }

  /** 0..1 for the overlay's red. Count is the honest measure of pressure. */
  get threat() { return clamp(this.list.length / 6, 0, 1); }

  // ---- wall time ---------------------------------------------------------

  /**
   * Everything that is true whether or not anyone is looking.
   *
   * Ticked from Colonies.tick, which the Economy runs for every visited world
   * every frame — so this is running on all six worlds at once and only one of
   * them has meshes.
   */
  tick(dt) {
    const P = this.P;
    const sites = this.sites;

    // 1. Integrity. A dome is structure: a growing site is genuinely tougher
    //    than a lander alone, which is why growth is the first defence.
    let domes = 0;
    for (const s of sites) {
      const maxHp = P.siteHp + s.grown * P.hpPerDome;
      if (s.maxHp === undefined) {
        s.maxHp = maxHp;
        // A restored site brings back the fraction it was saved at, not full
        // health: damage is part of the record the same way age is.
        s.hp = maxHp * (s.hpFrac === undefined ? 1 : clamp(s.hpFrac, 0.05, 1));
      } else if (maxHp > s.maxHp) { s.hp += maxHp - s.maxHp; s.maxHp = maxHp; }
      s.underAttack = 0;
      s.turret = s.density >= DEFENCE.turretFrom;
      domes += s.grown;
    }

    // 2. Raiders age, arrive, and start taking the site apart.
    for (const r of this.list) {
      r.age += dt;
      if (r.age < r.approach) continue;
      const s = r.site;
      s.hp -= r.dps * dt;
      s.underAttack++;
    }

    /* 3. Turrets. A turret answers anything within its range, which is what
          makes a cluster protect the young site you just dropped inside it
          rather than only itself — the difference between "expansion is a bet"
          and "expansion is a mistake".

          THE ARMOUR TERM IS NOT A DETAIL. Turret damage is scaled by the local
          raider's hit points, so a turret takes the same time to kill whatever
          its world throws at it. Without it, Vault's 1.9x armour quietly means
          "turrets here are half as good", which is not what that profile says
          and is not something a player could read — measured, it cost four of
          five mature Vault colonies over an hour away while every other world
          lost none. Armour is meant to change what YOU have to do about a
          raider — three and a half seconds of beam instead of two — and the
          away game is a promise that does not vary by world. */
    const armour = (P.hp * (P.hpScale || 1)) / RAIDER.hp;
    for (const r of this.list) {
      if (r.age < r.approach) continue;
      let dps = 0;
      for (const s of sites) {
        if (!s.turret) continue;
        const arc = s === r.site ? 0
          : arcBetween(s.dir, r.site.dir, this.planet.radius);
        if (arc > DEFENCE.turretRange) continue;
        dps += DEFENCE.turretDps * (s.density / DEFENCE.turretFrom) * armour;
      }
      if (dps > 0) r.hp -= dps * dt;
    }

    // 4. Repair, but only where nothing is currently attacking. A site under
    //    fire does not quietly heal through it.
    for (const s of sites) {
      if (!s.underAttack && s.hp < s.maxHp) {
        s.hp = Math.min(s.maxHp, s.hp + P.repair * dt);
      }
    }

    // 5. The dead, both kinds. Raiders first, so a turret that finished one on
    //    the same frame the site fell still gets the credit.
    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i];
      if (r.hp > 0) continue;
      this.kills++;
      // Silent during the away replay — see Colonies.catchUp. An hour of
      // turret kills is an hour of toasts about a fight nobody was at.
      if (!this.colonies.quiet) emit('raiderkill', { id: r.id, by: r.killedBy || 'turret' });
      this.release(r);
      this.list.splice(i, 1);
    }
    let razed = false;
    for (let i = sites.length - 1; i >= 0; i--) {
      const s = sites[i];
      if (s.hp > 0) continue;
      s.destroyed = true;
      razed = true;
      this.colonies.destroy(s);
      this.lost++;
      if (!this.colonies.quiet) {
        emit('colonylost', { id: s.id, pos: s.world, geyser: !!s.geyser });
      }
    }
    // A destroyed site is spliced out of the record, so its attackers are
    // holding a reference to something that is no longer the world. They leave.
    if (razed) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        if (this.list[i].site.destroyed) { this.release(this.list[i]); this.list.splice(i, 1); }
      }
    }

    // 6. Pressure. A baseline so a lone young site is genuinely at risk, plus a
    //    term in domes so a cluster draws the weather onto itself.
    if (!sites.length) { this.spawnClock = 0; return; }
    const cap = P.maxLive + domes * P.maxPerDome;
    if (this.list.length >= cap) return;
    const rate = (P.spawnBase + domes * P.spawnPerDome) * (P.spawnScale || 1);
    this.spawnClock += rate * dt;
    while (this.spawnClock >= 1) {
      this.spawnClock -= 1;
      this.spawn();
    }
  }

  /**
   * Choose a target and put a raider on the way to it.
   *
   * Weighted by (density + 1)^pull: above 1 the biggest cluster takes most of
   * the traffic, and at 1 it is flat and the mechanic is only a tax on owning
   * colonies. A site younger than `grace` is skipped entirely — a probe you
   * dropped ten seconds ago is not an invitation.
   */
  spawn(forceSite) {
    const P = this.P;
    const clock = this.colonies.clock;
    const pool = forceSite ? [forceSite]
      : this.sites.filter((s) => !s.destroyed && clock - s.t0 >= P.grace);
    if (!pool.length) return null;

    const id = this.nextId++;
    const rng = rngFor(this.planet.seed, 'raider:' + this.planet.key + ':' + id);
    let total = 0;
    const w = pool.map((s) => {
      const v = Math.pow((s.density || 0) + 1, P.densityPull);
      total += v;
      return v;
    });
    let pickV = rng() * total, site = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) {
      pickV -= w[i];
      if (pickV <= 0) { site = pool[i]; break; }
    }

    const r = {
      id,
      site,
      age: 0,
      approach: P.approach,
      hp: P.hp * (P.hpScale || 1),
      maxHp: P.hp * (P.hpScale || 1),
      dps: P.dps * (P.dpsScale || 1),
      // Capped against the world: 810m on Ember is two thirds of the way round
      // it, and a raider "approaching" from the far side of a moon is not an
      // approach. Big worlds get the honest range, small ones get their own.
      dist0: Math.min(P.viewRange * P.spawnDist, this.planet.radius * 1.2),
      angle: rng() * Math.PI * 2,
      spin: rng() * 6.28,
      node: null,
      killedBy: null,
    };
    // Tarn's raiders come in off the water. The bearing is not written down
    // anywhere — it is found by sampling the ground around the site and taking
    // the lowest, which on a world that is 86% ocean is the sea.
    if (P.fromWater) r.angle = this.lowestBearing(site, r.dist0);
    this.list.push(r);
    if (!this.colonies.quiet) {
      emit('raider', { id, site: site.id, world: this.planet.key, pos: site.world });
    }
    return r;
  }

  /** The bearing from a site whose ground falls away fastest — the sea. */
  lowestBearing(site, dist) {
    let best = 0, bestH = Infinity;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      site.frame.dirAt(Math.cos(a) * dist, Math.sin(a) * dist, D);
      const h = height(D, this.planet);
      if (h < bestH) { bestH = h; best = a; }
    }
    return best;
  }

  // ---- position, derived -------------------------------------------------

  /**
   * Where a raider is, computed from its age rather than integrated.
   *
   * This is what lets an unrendered world be simulated for free: nothing is
   * stepped, so twenty minutes of absence is the same arithmetic as one frame.
   */
  placeOf(r, out = { x: 0, y: 0, z: 0 }) {
    const P = this.P;
    const t = clamp(r.age / r.approach, 0, 1);
    // Ease in, so it does not arrive at a dead stop.
    const e = t * t * (3 - 2 * t);
    const dist = r.dist0 + (P.orbitDist - r.dist0) * e;
    const ang = r.angle + r.age * P.orbitRate * (t >= 1 ? 1 : 0.15);
    r.dist = dist;
    r.bearing = ang;
    return r.site.frame.dirAt(Math.cos(ang) * dist, Math.sin(ang) * dist, out);
  }

  /** Planet-space position, for the overlay, the beam and the bumper. */
  worldOf(r, out = { x: 0, y: 0, z: 0 }) {
    this.placeOf(r, D);
    const h = Math.max(height(D, this.planet), 0) + this.P.hover;
    const rad = this.planet.surfaceR + h;
    out.x = D.x * rad; out.y = D.y * rad; out.z = D.z * rad;
    return out;
  }

  // ---- damage from the player -------------------------------------------

  hurt(r, amount, by) {
    r.hp -= amount;
    r.killedBy = by || null;
    return r.hp <= 0;
  }

  /**
   * Everything inside a cone from a point along a direction.
   *
   * The scanner beam and nothing else uses this. It lives here because this is
   * what owns raider positions, and survey.js owns the verb.
   */
  inCone(origin, dir, range, cone, out = []) {
    out.length = 0;
    const cosC = Math.cos(cone);
    for (const r of this.list) {
      this.worldOf(r, L);
      const dx = L.x - origin.x, dy = L.y - origin.y, dz = L.z - origin.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > range || d < 0.001) continue;
      if ((dx * dir.x + dy * dir.y + dz * dir.z) / d < cosC) continue;
      out.push(r);
    }
    return out;
  }

  // ---- meshes ------------------------------------------------------------

  releaseAll() { for (const r of this.list) this.release(r); }

  release(r) {
    if (!r.node) return;
    r.node.mesh.dispose();
    r.node.node.dispose();
    r.node = null;
  }

  /**
   * The visible half, and the third defence.
   *
   * Momentum is a defence because it needs nothing built: a rover at boost
   * speed, a boat off a swell, a jet on a strafing line. There is no ammunition
   * and no cooldown, so it is always the desperate option and never the plan.
   */
  stream(dt, here, craft) {
    if (!this.proto) return;
    const P = this.P;
    const range = Math.min(P.viewRange, this.planet.radius * 1.6);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i];
      this.placeOf(r, D);
      const arc = here ? arcBetween(D, here, this.planet.radius) : Infinity;
      // Shroud holds the mesh back until a raider is close: on that world there
      // is no visual warning at all and the overlay is the only thing that sees
      // them coming, which is what the fog already says about the terrain.
      const visible = arc < range && (!P.ambush || arc < P.ambush);
      if (visible && !r.node) {
        const node = new BABYLON.TransformNode('raider' + r.id, this.scene);
        const mesh = this.proto.clone('raiderM' + r.id);
        mesh.parent = node;
        mesh.setEnabled(true);
        mesh.renderingGroupId = 1;
        mesh.scaling.setAll(2.6);
        r.node = { node, mesh };
      } else if (!visible && r.node) {
        this.release(r);
      }

      if (r.node) {
        const h = Math.max(height(D, this.planet), 0) + P.hover;
        // Faces along its own bearing — inward while it closes, tangentially
        // once it is circling, which is the read you get from a ridge.
        placeOnSphere(r.node.node, this.planet, D, h,
          -r.bearing + (r.age >= r.approach ? Math.PI * 0.5 : Math.PI));
        r.node.mesh.rotation.z = Math.sin(craft ? craft.time * 2.2 + r.spin : r.spin) * 0.16;
      }

      // The bumper. Closing speed, not raw speed, so a raider that flies into a
      // parked rover is not killed by the rover having once been fast.
      if (craft && !craft.hyper && r.node && craft.speed >= DEFENCE.ramSpeed) {
        this.worldOf(r, L);
        const d = Math.hypot(L.x - craft.world.x, L.y - craft.world.y, L.z - craft.world.z);
        if (d < DEFENCE.ramRadius) {
          this.hurt(r, r.maxHp, 'ram');
          this.kills++;
          emit('raiderkill', { id: r.id, by: 'ram', pos: { x: L.x, y: L.y, z: L.z } });
          this.release(r);
          this.list.splice(i, 1);
        }
      }
    }
  }

  /** Turret meshes belong to the site, so they stream with the colony node. */
  shapeTurret(site) {
    if (!site.node || !this.turretProto) return;
    if (site.turret && !site.node.turret) {
      const m = this.turretProto.clone('turret' + site.id);
      m.parent = site.node.node;
      m.setEnabled(true);
      m.renderingGroupId = 1;
      const d = site.domes[0];
      site.frame.dirAt(d.ox + 5.5, d.oz + 2.0, D);
      m.position.set(d.ox + 5.5, height(D, this.planet) - site.elevation, d.oz + 2.0);
      m.scaling.setAll(1.25);
      site.node.turret = m;
    } else if (!site.turret && site.node.turret) {
      site.node.turret.dispose();
      site.node.turret = null;
    }
  }
}
