// Everything that streams off the craft. All procedural — the particle sprite
// is drawn to a canvas at boot, so the folder ships with zero image assets.
//
// Nothing here is registered with a glow layer any more. Emissive materials
// are simply authored above 1.0 and the HDR bloom in main.js picks them up,
// which means a beacon behind a hill is behind the hill instead of shining
// through it.

import { Pool } from '../core/pool.js';
import { on } from '../core/events.js';
import { COLORS, WORLD, ATMO } from '../tune.js';
import { placeOnSphere } from '../world/surface.js';

// Effects are authored in the craft's tangent frame and converted at the last
// moment, the same deal as the camera. An anchor set from craft.pos directly
// would sit at the planet's core, since craft.pos is (0, altitude, 0).
const LW = { x: 0, y: 0, z: 0 };

function softDot(scene) {
  const size = 64;
  const tex = new BABYLON.DynamicTexture('dot', { width: size, height: size }, scene, false);
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

const C = (c, a = 1) => new BABYLON.Color4(c[0], c[1], c[2], a);
const E = (c, k) => new BABYLON.Color3(c[0] * k, c[1] * k, c[2] * k);

export class Trails {
  constructor(scene, craft, forms) {
    this.scene = scene;
    this.craft = craft;
    this.forms = forms;
    this.planet = craft.surf.planet;
    this.tex = softDot(scene);

    this.dustAnchor = new BABYLON.Mesh('dustAnchor', scene);
    this.sprayAnchor = new BABYLON.Mesh('sprayAnchor', scene);
    this.puffAnchor = new BABYLON.Mesh('puffAnchor', scene);
    this.moteAnchor = new BABYLON.Mesh('moteAnchor', scene);

    this.dust = this.makeSystem(160, this.dustAnchor, {
      color1: C(COLORS.shore, 0.75), color2: C(COLORS.stone, 0.5),
      dead: C(COLORS.shore, 0), min: 0.6, max: 2.6, life: [0.5, 1.3],
      power: [1.5, 5], grav: new BABYLON.Vector3(0, 2.2, 0),
    });
    this.spray = this.makeSystem(220, this.sprayAnchor, {
      color1: C(COLORS.coast, 0.9), color2: C(COLORS.shallow, 0.7),
      dead: C(COLORS.coast, 0), min: 0.25, max: 1.2, life: [0.35, 0.9],
      power: [3, 9], grav: new BABYLON.Vector3(0, -9, 0),
    });
    this.exhaust = this.makeSystem(300, forms.jet.exhaust, {
      color1: C(COLORS.phosphor, 0.95), color2: new BABYLON.Color4(1, 0.55, 0.3, 0.8),
      dead: C(COLORS.phosphor, 0), min: 0.4, max: 1.8, life: [0.18, 0.5],
      power: [2, 12], grav: new BABYLON.Vector3(0, 0, 0),
    });
    // Fired in bursts on landing rather than run continuously.
    this.puff = this.makeSystem(200, this.puffAnchor, {
      color1: C(COLORS.shore, 0.85), color2: C(COLORS.stone, 0.55),
      dead: C(COLORS.shore, 0), min: 0.8, max: 3.2, life: [0.4, 1.1],
      power: [3, 9], grav: new BABYLON.Vector3(0, 1.4, 0),
    });
    this.puff.direction1 = new BABYLON.Vector3(-1, 0.15, -1);
    this.puff.direction2 = new BABYLON.Vector3(1, 0.7, 1);
    this.puff.minEmitBox = new BABYLON.Vector3(-1.2, 0, -1.2);
    this.puff.maxEmitBox = new BABYLON.Vector3(1.2, 0.2, 1.2);

    // Motes drifting in the near field. They cost almost nothing and they are
    // most of why the air reads as air.
    if (ATMO.motes) {
      this.motes = this.makeSystem(260, this.moteAnchor, {
        color1: C(COLORS.coast, 0.20), color2: C(COLORS.phosphor, 0.14),
        dead: C(COLORS.coast, 0), min: 0.05, max: 0.30, life: [3.5, 9],
        power: [0.1, 0.7], grav: new BABYLON.Vector3(0, -0.30, 0),
      });
      this.motes.minEmitBox = new BABYLON.Vector3(-46, -14, -46);
      this.motes.maxEmitBox = new BABYLON.Vector3(46, 30, 46);
      this.motes.direction1 = new BABYLON.Vector3(-0.4, -0.1, -0.4);
      this.motes.direction2 = new BABYLON.Vector3(0.4, 0.2, 0.4);
      this.motes.emitRate = 34;
    }

    // Wingtip ribbons. Recreated on entering jet mode so they never streak
    // across the map from wherever you last landed.
    this.trailMat = new BABYLON.StandardMaterial('trailMat', scene);
    this.trailMat.emissiveColor = E(COLORS.phosphor, 2.4);
    this.trailMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    this.trailMat.alpha = 0.55;
    this.trailMat.backFaceCulling = false;
    this.trails = [];

    // Ring pool: boat wake, splashdowns, and transform shockwaves.
    this.ringMat = new BABYLON.StandardMaterial('ringMat', scene);
    this.ringMat.emissiveColor = E(COLORS.coast, 1.7);
    this.ringMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    this.ringMat.alpha = 0.999;
    this.ringMat.backFaceCulling = false;
    this.ringMat.disableLighting = true;

    this.ringMatGlow = this.ringMat.clone('ringMatGlow');
    this.ringMatGlow.emissiveColor = E(COLORS.phosphor, 2.6);

    const proto = BABYLON.MeshBuilder.CreateTorus('ringProto',
      { diameter: 2, thickness: 0.16, tessellation: 22 }, scene);
    proto.material = this.ringMat;
    proto.isPickable = false;
    proto.renderingGroupId = 1;
    proto.setEnabled(false);

    this.rings = new Pool(26, (i) => {
      const m = proto.clone('ring' + i);
      m.setEnabled(false);
      m.isPickable = false;
      m.renderingGroupId = 1;
      m.material = this.ringMat;
      return m;
    });
    this.proto = proto;

    this.wakeTimer = 0;

    on('transform', (e) => this.shockwave(e.pos));
    on('crash', (e) => { this.burst(e.pos); this.blast(e.pos, 90); });
    on('landed', (e) => this.burst(e.pos));
    on('hop', (e) => this.blast(e.pos, 14));
    on('thump', (e) => {
      this.burst(e.pos);
      this.blast(e.pos, Math.min(70, 14 + e.impact * 3.4));
    });
    on('splash', (e) => this.burst(e.pos));
    // The hull letting go throws a sheet of spray to either side.
    on('plane', (e) => { this.burst(e.pos); this.spray.manualEmitCount = 90; });
    on('wavelaunch', (e) => { this.burst(e.pos); this.spray.manualEmitCount = 60; });
    on('slam', (e) => { this.burst(e.pos); this.spray.manualEmitCount = 120; });
    on('drown', (e) => { this.burst(e.from); this.shockwave(e.to); });
  }

  makeSystem(cap, emitter, o) {
    const ps = new BABYLON.ParticleSystem('ps', cap, this.scene);
    ps.particleTexture = this.tex;
    ps.emitter = emitter;
    ps.minEmitBox = new BABYLON.Vector3(-0.4, 0, -0.4);
    ps.maxEmitBox = new BABYLON.Vector3(0.4, 0.3, 0.4);
    ps.color1 = o.color1;
    ps.color2 = o.color2;
    ps.colorDead = o.dead;
    ps.minSize = o.min; ps.maxSize = o.max;
    ps.minLifeTime = o.life[0]; ps.maxLifeTime = o.life[1];
    ps.emitRate = 0;
    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    ps.gravity = o.grav;
    ps.direction1 = new BABYLON.Vector3(-1, 0.4, -1);
    ps.direction2 = new BABYLON.Vector3(1, 1.2, 1);
    ps.minEmitPower = o.power[0];
    ps.maxEmitPower = o.power[1];
    ps.updateSpeed = 0.014;
    // Same group as the terrain, so particles depth-sort against it.
    ps.renderingGroupId = 1;
    ps.start();
    return ps;
  }

  startJetTrails() {
    this.stopJetTrails();
    for (const tip of this.forms.jet.tips) {
      const t = new BABYLON.TrailMesh('tip', tip, this.scene, 0.34, 58, true);
      t.material = this.trailMat;
      t.isPickable = false;
      t.renderingGroupId = 1;
      this.trails.push(t);
    }
  }

  stopJetTrails() {
    for (const t of this.trails) t.dispose();
    this.trails = [];
  }

  /**
   * Babylon's torus lies flat in XZ, so on a sphere it has to be turned to face
   * the local up — otherwise every wake ring stands on edge somewhere.
   */
  ringAt(planet, dir, elevation, glow, life, growth) {
    const it = this.rings.take();
    const m = it.obj;
    m.setEnabled(true);
    placeOnSphere(m, planet, dir, elevation, 0);
    m.material = glow ? this.ringMatGlow : this.ringMat;
    m.scaling.set(0.4, 1, 0.4);
    m.visibility = 0.9;
    it.life = life;
    it.growth = growth;
    return it;
  }

  /** A ring at a tangent offset from a surface's own frame. */
  ringLocal(surf, x, y, z, glow, life, growth) {
    const d = surf.dirAt(x, z);
    return this.ringAt(surf.planet, { x: d.x, y: d.y, z: d.z }, y, glow, life, growth);
  }

  /** A ring at a world position, oriented to that point's radial. */
  ring(pos, glow, life, growth) {
    const r = Math.hypot(pos.x, pos.y, pos.z) || 1;
    const it = this.rings.take();
    const m = it.obj;
    m.setEnabled(true);
    placeOnSphere(m, this.planet,
      { x: pos.x / r, y: pos.y / r, z: pos.z / r }, r - this.planet.surfaceR, 0);
    m.material = glow ? this.ringMatGlow : this.ringMat;
    m.scaling.set(0.4, 1, 0.4);
    m.visibility = 0.9;
    it.life = life;
    it.growth = growth;
    return it;
  }

  shockwave(pos) {
    for (let i = 0; i < 3; i++) {
      const it = this.ring(pos, true, 0.55 + i * 0.1, 26 + i * 10);
      it.obj.position.y += i * 0.4;
    }
  }

  burst(pos) {
    this.ring(pos, false, 0.7, 34);
  }

  /** One-shot cloud of grit where a wheel or a hull just hit something. */
  blast(pos, count) {
    // pos is a world position; nudge it toward the planet centre rather than
    // down world Y, which would be sideways on most of the sphere.
    const r = Math.hypot(pos.x, pos.y, pos.z) || 1;
    const k = (r - 0.8) / r;
    this.puffAnchor.position.set(pos.x * k, pos.y * k, pos.z * k);
    this.puff.manualEmitCount = count | 0;
  }

  update(dt, camPos) {
    const c = this.craft;
    const speed = c.speed;

    if (this.motes && camPos) {
      this.moteAnchor.position.copyFrom(camPos);
    }

    // --- ground dust ---
    const roverActive = c.mode === 'rover' && !c.onWater && !c.airborne;
    if (roverActive) {
      const w = c.surf.toWorld(-Math.sin(c.yaw) * 2.2, c.pos.y - 1.0,
        -Math.cos(c.yaw) * 2.2, LW);
      this.dustAnchor.position.set(w.x, w.y, w.z);
      this.dust.emitRate = Math.max(0, (speed - 7)) * 9 * (1 + c.boostHeat * 1.6);
      this.dust.minEmitPower = 1 + speed * 0.05;
      this.dust.maxEmitPower = 4 + speed * 0.12;
    } else {
      this.dust.emitRate = 0;
    }

    // --- water spray + expanding wake rings ---
    const onWater = c.onWater && (c.mode === 'boat' || c.mode === 'rover');
    if (onWater && speed > 3) {
      const bx = -Math.sin(c.yaw) * 2.8, bz = -Math.cos(c.yaw) * 2.8;
      const w = c.surf.toWorld(bx, WORLD.waterY + 0.2, bz, LW);
      this.sprayAnchor.position.set(w.x, w.y, w.z);
      this.spray.emitRate = Math.max(0, (speed - 3)) * 14 * (1 + c.boostHeat);

      this.wakeTimer -= dt;
      if (this.wakeTimer <= 0) {
        this.wakeTimer = 0.075 + 0.9 / Math.max(speed, 4);
        const lift = WORLD.waterY + 0.06 + c.surf.waveAt(bx, bz, c.time) * 0.5;
        this.ringLocal(c.surf, bx, lift, bz, false, 1.5, 9);
      }
    } else {
      this.spray.emitRate = 0;
    }

    // --- jet plume ---
    if (c.mode === 'jet') {
      this.exhaust.emitRate = 90 + c.boostHeat * 420;
      this.exhaust.maxSize = 1.4 + c.boostHeat * 1.6;
      if (!this.trails.length) this.startJetTrails();
      this.trailMat.alpha = 0.30 + c.boostHeat * 0.45;
    } else {
      this.exhaust.emitRate = 0;
      if (this.trails.length) this.stopJetTrails();
    }

    // --- ring lifecycle ---
    this.rings.forEachLive((it) => {
      it.age += dt;
      const t = it.age / it.life;
      if (t >= 1) { it.live = false; it.obj.setEnabled(false); return; }
      const s = 0.4 + it.growth * it.age;
      it.obj.scaling.set(s, 1, s);
      it.obj.visibility = (1 - t) * 0.85;
    });
  }
}
