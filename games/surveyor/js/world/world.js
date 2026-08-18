// Everything the scene holds for ONE planet, and the ability to put it down and
// pick another one up.
//
// Until travel existed, main.js bound a planet at module load and handed it to
// six different constructors. That was the honest thing to do while there was
// one world; it is the thing in the way now, because arriving somewhere means
// all six have to be rebuilt around a different planet mid-frame.
//
// The split is by cost and by permanence:
//
//   REBUILT on arrival — terrain, water, sky, discs, materials. All of them are
//   pure functions of the profile, so throwing them away costs nothing but the
//   streaming that was going to happen anyway.
//
//   KEPT for as long as the session lasts — the survey log and the colonies.
//   Those are the player's, not the planet's. A world you leave keeps its
//   scanned beacons and its growing habitats; only their MESHES are released,
//   and they rebuild from the record on the way back. That is the same
//   distinction colony.js already draws between a site and its node.

import { createMaterials } from './materials.js';
import { ChunkField } from './chunks.js';
import { Water } from './water.js';
import { createSky } from './sky.js';
import { Discs } from './discs.js';
import { Survey } from '../game/survey.js';
import { Colonies } from '../game/colony.js';

export class World {
  /**
   * `mats` is only ever passed for the world the session boots on. The craft's
   * meshes have to be built before a Craft exists, and a Craft has to exist
   * before Survey and Colonies can be constructed — so the boot world's
   * materials are made first, outside, and handed in here. Building a second
   * set instead leaves the craft wearing a material nobody updates: its uCam
   * stays at the origin, the rim term is computed against a view vector
   * pointing at the planet's core, and the hull renders blown out white.
   */
  constructor(scene, planet, craft, mats) {
    this.scene = scene;
    this.planet = planet;
    this.craft = craft;
    this.active = false;
    this.mats = mats || createMaterials(scene, planet);
    this.sky = createSky(scene, this.mats.sky, planet);
    // A dry world has no shell to build. Ember's sea level is a formality —
    // there is no water in the profile at all, so there is nothing to draw and
    // nothing for the rover to drown in.
    this.water = planet.hasWater ? new Water(scene, this.mats.water, planet) : null;
    this.discs = new Discs(scene, planet);
    this.field = new ChunkField(scene, this.mats.terrain, planet);
    this.survey = new Survey(scene, craft, planet);
    this.colonies = new Colonies(scene, craft, this.mats.craft, planet);
    // The beam is the scanner held down, so survey.js owns it — but the things
    // it disrupts belong to the colonies' record. This is the one wire between
    // them, and it is made here because this is where both first exist.
    this.survey.attachRaiders(this.colonies.raiders);
  }

  /** Stream in the ground around a direction before anyone sees the gap. */
  warm(dir, budget = 600) {
    this.field.update(dir);
    for (let i = 0; i < budget && this.field.queue.length; i++) this.field.update(dir);
    this.survey.update(0.016);
  }

  setActive(on) {
    this.active = on;
    this.sky.setEnabled(on);
    if (this.water) this.water.mesh.setEnabled(on);
    if (this.discs.mesh) this.discs.mesh.setEnabled(on);
    if (!on) {
      // Terrain is regenerated, never stored: dropping every leaf is both the
      // cheapest way to hide a world and the correct one, since the tree has to
      // be rebuilt around wherever you come back down anyway.
      this.field.dispose();
      this.field.live.clear();
      this.field.queue.length = 0;
      this.field.dirty = true;
      // Props and habitats keep their records and release their meshes, which
      // is exactly what they already do when you drive out of range.
      for (const key of [...this.survey.active.keys()]) this.survey.despawnChunk(key);
      this.survey.center = '';
      for (const site of this.colonies.sites) this.colonies.release(site);
      // Raiders keep attacking; only what you could see of them is thrown away.
      this.colonies.raiders.releaseAll();
    }
  }

  /**
   * The visible half. Growth and production are NOT here: the Economy ticks
   * every visited world every frame, including the five nobody is looking at,
   * so this only ever does the part that needs a scene.
   */
  update(dt, craft, camera) {
    if (!this.active) return;
    this.field.update(craft.surf.frame.up);
    if (this.water) this.water.update();
    this.survey.update(dt);
    this.colonies.stream(dt);
    this.discs.update(camera);
  }
}

/**
 * The set of worlds this session has visited.
 *
 * Built lazily and never thrown away: a return trip should show you the
 * habitats you left growing, and the second visit costs nothing but the terrain
 * stream. Six worlds of materials is a few dozen shader programs.
 */
export class Worlds {
  constructor(scene, craft) {
    this.scene = scene;
    this.craft = craft;
    this.map = new Map();
    this.current = null;
  }

  get(planet, mats) {
    let w = this.map.get(planet.key);
    if (!w) {
      w = new World(this.scene, planet, this.craft, mats);
      this.map.set(planet.key, w);
    }
    return w;
  }

  /** Make `planet` the world the scene is drawing. Returns its World. */
  enter(planet, dir, mats) {
    const next = this.get(planet, mats);
    if (this.current && this.current !== next) this.current.setActive(false);
    this.current = next;
    next.setActive(true);
    if (dir) next.warm(dir);
    return next;
  }
}
