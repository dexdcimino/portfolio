// The colonisation economy. One axis: DENSITY.
//
// A site's density is its own maturity plus the maturity of its neighbours,
// falling off with distance. Hyper output scales superlinearly with it, so four
// colonies packed around one basin are worth substantially more than four
// scattered singles — which makes WHERE you drop a probe a decision rather than
// a formality. The same number will drive raider pressure and defence in 4b, so
// it is deliberately one number and not three.
//
// Everything here reads the permanent `sites` records and never the meshes. A
// world you left an hour ago is producing exactly as much as it would be if you
// were standing on it, because nothing about production depends on anything
// being rendered.

import { COLONY, ECONOMY, PLANETS, SYSTEM } from '../tune.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Density of one site: own domes plus the weighted domes of its neighbours.
 *
 * The falloff radius is a fraction of the planet's radius, so "nearby" means
 * the same thing on a 207m moon as on a 2072m world — a fixed metre count would
 * make Ember one giant cluster and Anvil incapable of ever forming one.
 */
export function densityOf(site, sites, planet) {
  let d = site.grown;
  const R = planet.radius * COLONY.densityRadius;
  for (const other of sites) {
    if (other === site || other.grown === 0) continue;
    const dot = clamp(site.dir.x * other.dir.x + site.dir.y * other.dir.y +
      site.dir.z * other.dir.z, -1, 1);
    const arc = Math.acos(dot) * planet.radius;
    if (arc >= R) continue;
    // Linear falloff. A curve here would be one more thing to tune and the
    // superlinear part — where the interesting behaviour lives — is the
    // exponent below, not the shape of the neighbourhood.
    d += other.grown * (1 - arc / R);
  }
  return d;
}

/**
 * Hyper fuel per second from one site. Zero unless it sits on a vent.
 *
 * The exponent is what makes clustering a real decision. At 1.0 four singles
 * and a cluster of four are identical and the mechanic does not exist; at 1.7 a
 * cluster is worth roughly two and a half times the same domes spread out.
 */
export function hyperRateOf(site, sites, planet) {
  if (!site.geyser) return 0;
  const d = densityOf(site, sites, planet);
  if (d <= 0) return 0;
  return ECONOMY.hyperBase * Math.pow(d, ECONOMY.densityPower) * site.geyser.yield;
}

/**
 * The player's side of the economy: one hyper balance, every world's colonies,
 * and the question "can I get there from here".
 *
 * Registered per world rather than owning the colonies, because colony.js owns
 * the sites and the growth clock. This owns the money.
 */
export class Economy {
  constructor() {
    this.hyper = ECONOMY.startHyper;
    this.worlds = new Map();       // planetKey -> Colonies
    this.rate = 0;                 // hyper/sec, all worlds
    this.lastCost = null;
  }

  register(planetKey, colonies) { this.worlds.set(planetKey, colonies); }

  /**
   * Wall time, everywhere.
   *
   * Every registered world is ticked, not only the one being rendered — that is
   * the whole promise of the colony record. `tick` advances growth and totals
   * production; only the active world also streams meshes.
   */
  update(dt) {
    let rate = 0;
    for (const [, colonies] of this.worlds) {
      colonies.tick(dt);
      rate += colonies.hyperRate;
    }
    this.rate = rate;
    this.hyper = Math.min(ECONOMY.maxHyper, this.hyper + rate * dt);
  }

  // ---- travel ------------------------------------------------------------

  /** Hyper fuel to cross from one world to another. Proportional to distance. */
  costTo(fromKey, toKey) {
    const a = SYSTEM.at[fromKey], b = SYSTEM.at[toKey];
    if (!a || !b) return Infinity;
    const km = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    return ECONOMY.tripBase + km * ECONOMY.tripPerKm;
  }

  /**
   * Can this trip be paid for?
   *
   * Checked BEFORE the craft commits, which is the point: the escape burn stops
   * you leaving a world by accident, and this stops you leaving one by mistake.
   * Deceleration is automatic, so a craft that ran dry mid-flight would still
   * arrive somewhere — but it would arrive somewhere it did not choose, having
   * spent everything, and that is exactly the stranding this prevents.
   */
  canReach(fromKey, toKey) {
    const need = this.costTo(fromKey, toKey);
    return { ok: this.hyper >= need, need, have: this.hyper };
  }

  spend(amount) {
    this.hyper = Math.max(0, this.hyper - amount);
  }

  // ---- progress ----------------------------------------------------------

  /** Geysers claimed on a world — a set, so two sites on one vent count once. */
  claimed(planetKey) {
    const c = this.worlds.get(planetKey);
    if (!c) return 0;
    const seen = new Set();
    for (const s of c.sites) if (s.geyser) seen.add(s.geyser.id);
    return seen.size;
  }

  /** Claimed and total across every world, for the system readout. */
  progress(totals) {
    let claimed = 0, total = 0;
    for (const key of Object.keys(PLANETS)) {
      claimed += this.claimed(key);
      total += totals[key] || 0;
    }
    return { claimed, total };
  }

  // ---- persistence -------------------------------------------------------
  /* A colony grows on wall time and pays on wall time, so it has to survive the
     tab being closed — otherwise "leave it running and come back" is a lie the
     moment anyone reloads. Only the RECORD is saved: directions, ages and which
     vent each site claimed. Meshes, layouts and dome geometry all regenerate
     from the site seed exactly as they do when you drive back into range. */

  save() {
    try {
      const worlds = {};
      for (const [key, c] of this.worlds) {
        if (!c.sites.length) continue;
        worlds[key] = { clock: c.clock, sites: c.sites.map((s) => c.record(s)) };
      }
      localStorage.setItem(ECONOMY.saveKey, JSON.stringify({
        v: 1, hyper: this.hyper, at: Date.now(), worlds,
      }));
      return true;
    } catch (err) {
      return false;                      // private mode, quota, or no storage
    }
  }

  /** Returns the saved blob, or null. The caller restores per world. */
  load() {
    try {
      const raw = localStorage.getItem(ECONOMY.saveKey);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || data.v !== 1) return null;
      // Time passes while the tab is shut. Capped, so a save from last week does
      // not hand back a full tank the instant the page opens.
      data.away = Math.min(ECONOMY.offlineCap,
        Math.max(0, (Date.now() - (data.at || Date.now())) / 1000));
      return data;
    } catch (err) {
      return null;
    }
  }
}
