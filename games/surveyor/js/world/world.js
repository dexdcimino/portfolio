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
import { Shadows } from './shadows.js';
import { Seabed } from './seabed.js';
import { CONTACT } from '../tune.js';
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
    /* The shadow pass, and the wiring that keeps it honest. Its render list
       follows the chunk stream through onBuild/onDrop rather than being rebuilt
       — a list holding disposed meshes grows without bound and Babylon will
       happily try to draw them. */
    this.shadows = new Shadows(scene, planet, this.mats.skyParams.sunDir);
    /* The seabed depth pass, which answers "how much water is between the eye
       and the ground" per pixel — the question the water shell's 40m depth grid
       could only ever guess at. Same wiring as the shadow pass and for the same
       reason, so the two share the chunk stream's one pair of hooks below. */
    this.seabed = new Seabed(scene, planet);
    this._tmpA = { x: 0, y: 0, z: 0 };
    this._tmpB = { x: 0, y: 0, z: 0 };
    this.field = new ChunkField(scene, this.mats.terrain, planet);
    /* ONE pair of hooks, two consumers. ChunkField carries a single onBuild and
       a single onDrop; assigning the seabed's over the shadow's would leave the
       shadow map with an empty caster list and no error anywhere. Both are
       registered here, and both are cheap enough that the branch is inside
       rather than around. */
    const castsShadow = this.shadows.cfg.castTerrain && this.shadows.enabled;
    if (castsShadow || this.seabed.enabled) {
      this.field.onBuild = (mesh) => {
        if (castsShadow) this.shadows.addCaster(mesh);
        if (this.seabed.enabled) this.seabed.add(mesh);
      };
      this.field.onDrop = (mesh) => {
        if (castsShadow) this.shadows.removeCaster(mesh);
        if (this.seabed.enabled) this.seabed.remove(mesh);
      };
    }
    this.mats.bindShadows(this.shadows);
    this.mats.bindSeabed(this.seabed);
    // The shell knows how deep this world actually gets; the material was
    // guessing from relief. See WATER.measureDepth.
    if (this.water) this.mats.setMaxDepth(this.water.maxDepth);
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

  /**
   * The craft's contact shadow: where it meets the ground, and how much.
   *
   * The ground point is the terrain height under the craft's own tangent
   * coordinates, not the craft's position — a rover on a slope sits above the
   * point its shadow belongs on, and a jet sits a long way above it. Faded out
   * with altitude, because a craft at fifty metres painting a hard disc under
   * itself is worse than no contact shadow at all.
   */
  contact(craft) {
    if (!CONTACT.enabled || !craft || !craft.surf) {
      this.mats.setContact(this._cAt(0, 0, 0, 1), this._cF(0, 0, 1),
        this._cS(1, 1, 0.4, 2.6), 0);
      return;
    }
    const p = craft.pos;
    const gy = craft.surf.surfaceHeight(p.x, p.z);
    const alt = Math.max(0, p.y - gy);
    const k = CONTACT.strength *
      (1 - Math.min(1, Math.max(0, (alt - CONTACT.fadeFrom) /
        (CONTACT.fadeTo - CONTACT.fadeFrom))));
    if (k <= 0.001) {
      this.mats.setContact(this._cAt(0, 0, 0, 1), this._cF(0, 0, 1),
        this._cS(1, 1, 0.4, 2.6), 0);
      return;
    }
    const w = craft.surf.toWorld(p.x, gy, p.z, this._tmpA);
    /* The heading, as a WORLD direction. Taken as the difference between two
       points on the ground rather than from a stored basis, because the tangent
       frame re-anchors as you drive and this way there is nothing to keep in
       step with it. */
    const fx = Math.sin(craft.yaw), fz = Math.cos(craft.yaw);
    const w2 = craft.surf.toWorld(p.x + fx, gy, p.z + fz, this._tmpB);
    const sz = CONTACT.size[craft.mode] || CONTACT.size.rover;
    this.mats.setContact(
      this._cAt(w.x, w.y, w.z, CONTACT.vertical),
      this._cF(w2.x - w.x, w2.y - w.y, w2.z - w.z),
      this._cS(sz.long, sz.wide, CONTACT.edge, CONTACT.exponent), k);
  }

  _cAt(x, y, z, w) {
    if (!this._at) this._at = new BABYLON.Vector4(0, 0, 0, 1);
    this._at.set(x, y, z, w); return this._at;
  }
  _cF(x, y, z) {
    if (!this._fw) this._fw = new BABYLON.Vector3(0, 0, 1);
    this._fw.set(x, y, z); return this._fw;
  }
  _cS(x, y, z, w) {
    if (!this._sz) this._sz = new BABYLON.Vector4(1, 1, 0.4, 2.6);
    this._sz.set(x, y, z, w); return this._sz;
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
      // Terrain is gone, so every caster it registered is too — and every
      // mesh the seabed pass was measuring against.
      this.shadows.clearCasters();
      this.seabed.clear();
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
    // Centred on the craft, not the camera: the camera swings and pulls back,
    // and a box that followed it would slide the shadows around under a
    // stationary rover.
    this.shadows.update(craft.world);
    this.mats.syncShadows(this.shadows);
    /* The CAMERA, not the craft — this one measures distance from the eye, and
       measuring it from anywhere else would put the foam line where the chase
       cam is not looking. */
    if (camera) this.seabed.update(camera.position);
    this.contact(craft);
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
