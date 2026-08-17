// Chase camera. Lags on a spring so speed reads as speed, widens under boost,
// and refuses to clip through terrain.
//
// The orientation control is the part that had to be got right. Drag input is
// smoothed into a target rather than applied raw, the orbit holds where you
// left it for a beat before swinging back, the boom is probed along its whole
// length instead of only at the tip, and the camera banks with the craft so
// you can tell which way is up in a roll.

import { CAM, WORLD, ROVER, BOAT, JET } from '../tune.js';

// What counts as "flat out" for each form. The boom pulls back and the FOV
// widens as you approach it, so this is derived from the vehicles' own top
// speeds rather than hardcoded — retuning a boost used to quietly cost that
// form its sense of speed, because the reference stayed where it was.
const REF_SPEED = {
  rover: ROVER.boostSpeed,
  boat: BOAT.boostSpeed,
  jet: JET.maxSpeed * 1.3,
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

let UPV = null;
const WA = { x: 0, y: 0, z: 0 };
const WB = { x: 0, y: 0, z: 0 };

export class ChaseCam {
  constructor(scene, canvas, planet) {
    this.camera = new BABYLON.UniversalCamera('chase',
      new BABYLON.Vector3(0, planet.surfaceR + 30, -30), scene);
    this.camera.minZ = 0.4;
    // Per-planet: the old fixed 2800 was more than the diameter of most of
    // these worlds, which wastes the whole depth range on empty space.
    this.camera.maxZ = planet.farPlane;
    this.camera.fov = CAM.fov.rover;
    this.camera.inputs.clear();
    if (!UPV) UPV = new BABYLON.Vector3(0, 1, 0);
    this.camera.upVector = new BABYLON.Vector3(0, 1, 0);
    scene.activeCamera = this.camera;

    this.aim = new BABYLON.Vector3(0, 0, 0);
    // Split target/actual so a jittery mouse can't put jitter on screen.
    this.orbitYaw = 0; this.orbitPitch = 0;
    this.wantYaw = 0; this.wantPitch = 0;
    this.zoom = 1; this.wantZoom = 1;
    this.dist = CAM.dist.rover;
    this.hgt = CAM.height.rover;
    this.tilt = 0;
    this.idle = 9;              // seconds since you last touched the camera
    this.shakeAmt = 0;
    this.shakeT = 0;
    this.recentering = false;

    // A map rather than a boolean, so two fingers can pinch-zoom.
    this.pointers = new Map();
    this.pinchBase = 0;
    this.pinchZoom = 1;

    const pos = (e) => ({ x: e.clientX, y: e.clientY });

    canvas.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, pos(e));
      this.recentering = false;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
      if (this.pointers.size === 2) {
        this.pinchBase = this.spread();
        this.pinchZoom = this.wantZoom;
      }
    });

    const release = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchBase = 0;
      if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('lostpointercapture', release);

    canvas.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      this.idle = 0;

      if (this.pointers.size >= 2) {
        if (this.pinchBase > 0) {
          const s = this.spread() / this.pinchBase;
          this.wantZoom = clamp(this.pinchZoom / Math.max(0.2, s), CAM.zoomMin, CAM.zoomMax);
        }
        return;
      }
      this.wantYaw += dx * CAM.sensitivity;
      this.wantPitch = clamp(
        this.wantPitch + dy * CAM.pitchSensitivity * (CAM.invertY ? -1 : 1),
        CAM.minPitch, CAM.maxPitch);
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      this.wantZoom = clamp(this.wantZoom * (1 + dir * CAM.zoomStep), CAM.zoomMin, CAM.zoomMax);
    }, { passive: false });
  }

  spread() {
    const p = [...this.pointers.values()];
    if (p.length < 2) return 0;
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  }

  /** C key: swing straight back behind the craft and reset the zoom. */
  recenter() {
    this.wantYaw = 0;
    this.wantPitch = 0;
    this.wantZoom = 1;
    this.recentering = true;
    this.idle = 99;
  }

  addShake(v) {
    this.shakeAmt = Math.min(1.4, this.shakeAmt + v);
  }

  update(dt, craft) {
    const dragging = this.pointers.size > 0;
    if (dragging) this.idle = 0; else this.idle += dt;

    // Hold the framing you chose for a moment, then drift back behind. The
    // old camera started returning the instant you let go, which fought you.
    if (!dragging && this.idle > CAM.orbitHold) {
      const rate = this.recentering ? CAM.recenterRate : CAM.orbitReturn;
      const k = Math.exp(-rate * dt);
      this.wantYaw *= k;
      this.wantPitch *= k;
      if (Math.abs(this.wantYaw) < 0.002 && Math.abs(this.wantPitch) < 0.002) {
        this.recentering = false;
      }
    }

    this.orbitYaw = damp(this.orbitYaw, this.wantYaw, CAM.orbitLerp, dt);
    this.orbitPitch = damp(this.orbitPitch, this.wantPitch, CAM.orbitLerp, dt);
    this.zoom = damp(this.zoom, this.wantZoom, CAM.zoomLerp, dt);

    const mode = craft.mode;
    const speedT = clamp(craft.speed / REF_SPEED[mode], 0, 1);
    const surf = craft.surf;
    const fr = surf.frame;

    // Damped framing, so 1/2/3 doesn't snap the camera to a new arm length.
    this.dist = damp(this.dist, CAM.dist[mode] * (1 + speedT * 0.30) * this.zoom,
      CAM.frameLerp, dt);
    this.hgt = damp(this.hgt, CAM.height[mode], CAM.frameLerp, dt);

    // The whole framing is computed in the craft's own tangent frame, exactly
    // as it was on the flat world — the craft sits at that frame's origin, so
    // (x, z) here are just offsets behind it. Only the last step is new.
    const yaw = craft.yaw + this.orbitYaw;
    const lx = -Math.sin(yaw) * this.dist;
    const lz = -Math.cos(yaw) * this.dist;
    let ly = craft.pos.y + this.hgt + this.orbitPitch * this.dist * 0.9;
    // In the air the camera rides the pitch so you see where you're pointed.
    if (mode === 'jet') ly += Math.sin(craft.pitch) * this.dist * 0.55;

    // Probe the whole boom, not just its end: a ridge between you and the
    // camera used to slice straight through the frame. surfaceHeight follows
    // the sphere exactly, so this stays right at 40m out where a flat tangent
    // plane would already be metres wrong.
    let floor = -1e9;
    for (let i = 1; i <= CAM.boomSamples; i++) {
      const t = i / CAM.boomSamples;
      const h = Math.max(surf.surfaceHeight(lx * t, lz * t), WORLD.waterY) +
        CAM.boomClearance * t;
      if (h > floor) floor = h;
    }
    if (ly < floor) ly = floor;

    // Local -> world, then spring in world space so the lag reads as lag. Doing
    // the spring in the craft's frame instead would drag the camera along with
    // it and lose the trail entirely.
    const w = fr.toWorld(lx, ly, lz, WA);
    const pk = 1 - Math.exp(-CAM.posLerp * dt);
    this.camera.position.x = lerp(this.camera.position.x, w.x, pk);
    this.camera.position.y = lerp(this.camera.position.y, w.y, pk);
    this.camera.position.z = lerp(this.camera.position.z, w.z, pk);

    // Shake is applied here rather than to the craft mesh. Shaking the
    // vehicle looked like the vehicle was broken; shaking the camera looks
    // like the impact was.
    if (this.shakeAmt > 0.001) {
      this.shakeT += dt * 33;
      const a = this.shakeAmt * CAM.shakeScale;
      this.camera.position.x += Math.sin(this.shakeT * 1.7) * a;
      this.camera.position.y += Math.sin(this.shakeT * 2.31 + 1.1) * a;
      this.camera.position.z += Math.sin(this.shakeT * 1.29 + 2.7) * a * 0.6;
      this.shakeAmt *= Math.exp(-CAM.shakeDecay * dt);
    }

    // Look slightly ahead of the craft, not at it. Also in the tangent frame.
    const cp = Math.cos(craft.pitch), sp = Math.sin(craft.pitch);
    const reach = 8 + speedT * 14;
    const aw = fr.toWorld(
      Math.sin(craft.yaw) * cp * reach,
      craft.pos.y + 1.6 + (mode === 'jet' ? -sp : 0) * reach,
      Math.cos(craft.yaw) * cp * reach, WB);
    const ak = 1 - Math.exp(-CAM.aimLerp * dt);
    this.aim.x = lerp(this.aim.x, aw.x, ak);
    this.aim.y = lerp(this.aim.y, aw.y, ak);
    this.aim.z = lerp(this.aim.z, aw.z, ak);

    // Bank with the craft. Without this a roll in the jet is unreadable —
    // the world tips and the frame doesn't, so you lose which way is up.
    this.tilt = damp(this.tilt, -craft.roll * CAM.rollTilt[mode], 6, dt);
    this.setUp(this.tilt, fr.up);
    this.camera.setTarget(this.aim);

    const targetFov = CAM.fov[mode] + craft.boostHeat * CAM.fovBoost + speedT * 0.06;
    this.camera.fov = lerp(this.camera.fov, targetFov, 1 - Math.exp(-4 * dt));
  }

  /**
   * Roll the up vector about the view axis before setTarget reads it.
   *
   * `localUp` is the planet's radial at the craft, not world +Y. This is the
   * single most load-bearing line of the sphere conversion for legibility: with
   * world +Y the camera stays bolted to an arbitrary axis and you drive down
   * the side of the planet lying on your ear.
   */
  setUp(tilt, localUp) {
    const U = UPV;
    U.set(localUp.x, localUp.y, localUp.z);
    if (Math.abs(tilt) < 0.0005) {
      this.camera.upVector.set(U.x, U.y, U.z);
      return;
    }
    const f = this.aim.subtract(this.camera.position);
    const len = f.length();
    if (len < 0.001) return;
    f.scaleInPlace(1 / len);
    const right = BABYLON.Vector3.Cross(U, f);
    if (right.length() < 0.0001) { this.camera.upVector.set(U.x, U.y, U.z); return; }
    right.normalize();
    const up = BABYLON.Vector3.Cross(f, right).normalize();
    const c = Math.cos(tilt), s = Math.sin(tilt);
    this.camera.upVector.set(
      up.x * c + right.x * s,
      up.y * c + right.y * s,
      up.z * c + right.z * s);
  }
}
