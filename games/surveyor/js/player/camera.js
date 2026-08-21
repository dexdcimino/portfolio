// Chase camera. Lags on a spring so speed reads as speed, widens under boost,
// and refuses to clip through terrain.
//
// The orientation control is the part that had to be got right. Drag input is
// smoothed into a target rather than applied raw, the orbit holds where you
// left it for a beat before swinging back, the boom is probed along its whole
// length instead of only at the tip, and the camera banks with the craft so
// you can tell which way is up in a roll.

import { CAM, WORLD, ROVER, BOAT, JET, DRONE } from '../tune.js';

// What counts as "flat out" for each form. The boom pulls back and the FOV
// widens as you approach it, so this is derived from the vehicles' own top
// speeds rather than hardcoded — retuning a boost used to quietly cost that
// form its sense of speed, because the reference stayed where it was.
const REF_SPEED = {
  rover: ROVER.boostSpeed,
  boat: BOAT.boostSpeed,
  jet: JET.maxSpeed * 1.3,
  drone: DRONE.maxSpeed,     // the drone has no boost; 26 IS flat out
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

  /**
   * Arrived somewhere else. Only the far plane is per-planet, but it is per
   * planet for a reason — Ember's is a fifth of Anvil's, and carrying Home's
   * across to a 207m world wastes the whole depth range on empty space.
   */
  setPlanet(planet) {
    this.planet = planet;
    this.camera.maxZ = planet.farPlane;
  }

  /**
   * Arrive somewhere: PLACE the boom, rather than interpolate toward it.
   *
   * The framing in update() is computed in the craft's tangent frame and the
   * spring that drives it runs in WORLD space. Both are right while you stay
   * on one planet and both are wrong the instant you are on another: the
   * camera's world position is still a point on the world you left, and on a
   * sphere of a different radius that point is usually inside this one. That
   * is the whole of “warping arrives below the surface and rises through the
   * terrain” — the camera was never placed on arrival, it was interpolated,
   * starting from somewhere in the rock.
   *
   * So this is the one place the spring is bypassed. It builds the settled
   * boom exactly as update() does with the orbit at rest — including the
   * terrain probe along its whole length, without which an arrival can still
   * be placed inside a hillside — writes position and aim rather than lerping
   * toward them, and then lifts the result by CAM.arriveLift so the ordinary
   * spring still has something to do. You drop the last few metres into the
   * shot instead of cutting to it, which is also what distinguishes an
   * arrival from a teleport.
   *
   * Everything the drag input owns is reset here too: an orbit carried across
   * a warp is a camera aimed at the horizon of a world that is no longer
   * under it.
   */
  arrive(craft) {
    const surf = craft.surf;
    if (!surf || craft.hyper) return;
    const fr = surf.frame;
    const mode = craft.mode;

    this.wantYaw = 0; this.wantPitch = 0;
    this.orbitYaw = 0; this.orbitPitch = 0;
    this.wantZoom = 1; this.zoom = 1;
    this.recentering = false;
    this.idle = 9;
    this.shakeAmt = 0;
    this.tilt = 0;
    this.dist = CAM.dist[mode];
    this.hgt = CAM.height[mode];

    const yaw = craft.yaw;
    const lx = -Math.sin(yaw) * this.dist;
    const lz = -Math.cos(yaw) * this.dist;
    let ly = craft.pos.y + this.hgt;
    let floor = -1e9;
    for (let i = 1; i <= CAM.boomSamples; i++) {
      const t = i / CAM.boomSamples;
      const h = Math.max(surf.surfaceHeight(lx * t, lz * t), WORLD.waterY) +
        CAM.boomClearance * t;
      if (h > floor) floor = h;
    }
    if (ly < floor) ly = floor;

    const w = fr.toWorld(lx, ly + CAM.arriveLift, lz, WA);
    this.camera.position.set(w.x, w.y, w.z);

    // The aim is update()'s, at rest: the lead with no speed term on it.
    const aw = fr.toWorld(Math.sin(yaw) * 8, craft.pos.y + 1.6,
      Math.cos(yaw) * 8, WB);
    this.aim.set(aw.x, aw.y, aw.z);
    this.camera.fov = CAM.fov[mode];
    this.setUp(0, fr.up);
    this.camera.setTarget(this.aim);
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

    /* In transit there is no tangent frame and no ground to clear the boom
       against — the whole framing below is expressed in a frame that does not
       exist between worlds. Sit behind the craft along its heading instead,
       and take "up" from the craft's own transit basis.

       That last part used to read "any perpendicular will do out here; the
       heading is what reads", and it was wrong twice. The perpendicular was
       chosen by which of the heading's components was smallest, so it JUMPED
       to a different axis whenever the steering turned the heading through a
       component swap — a camera roll mid-flight, from a tie-break. And the
       camera's own upVector was never written at all in this branch, so the
       view stayed rolled to the departure world's radial for the whole trip
       and snapped to the destination's on arrival. The craft now carries a
       basis that is continuous across both boundaries; the camera shares it,
       and both problems are the same line. */
    if (craft.hyper) {
      const d = craft.hyper.dir;
      const t = craft.hyperT;
      // Wider lens and a longer boom as the speed climbs. Both are lerped
      // rather than set, so the approach unwinds them at the same rate the
      // departure wound them on.
      const wantFov = CAM.fov.jet + t * CAM.hyperFov;
      this.camera.fov = lerp(this.camera.fov, wantFov, 1 - Math.exp(-CAM.hyperLerp * dt));
      const dist = CAM.dist.jet * this.zoom * (1.6 + t * CAM.hyperDist);
      const w = craft.world;
      const u = craft.transit.up;
      const k = 1 - Math.exp(-CAM.posLerp * dt);
      const tx = w.x - d.x * dist + u.x * CAM.height.jet;
      const ty = w.y - d.y * dist + u.y * CAM.height.jet;
      const tz = w.z - d.z * dist + u.z * CAM.height.jet;
      this.camera.position.x = lerp(this.camera.position.x, tx, k);
      this.camera.position.y = lerp(this.camera.position.y, ty, k);
      this.camera.position.z = lerp(this.camera.position.z, tz, k);
      this.aim.set(w.x, w.y, w.z);
      // Level in transit: the bank the player should read is the craft's
      // against the field, not the camera's against the craft.
      this.tilt = damp(this.tilt, 0, 6, dt);
      this.setUp(this.tilt, u);
      this.camera.setTarget(this.aim);
      return;
    }

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

    /* Look slightly ahead of the craft, not at it. Also in the tangent frame.
       THE LEAD ORBITS WITH THE BOOM, and that is the whole of what makes the
       craft the pivot. The boom was already swung by `yaw` — craft plus orbit —
       while the aim stayed pinned to `craft.yaw`, so dragging the view rotated
       the camera about a point `reach` metres AHEAD of the vehicle and the
       vehicle swung across the frame instead of holding still. Feeding the same
       yaw to both puts the craft exactly on the camera-to-aim segment, so the
       world turns around it and it stays where it is.
       The pitch term is that same argument in the other axis. The boom rises by
       orbitPitch * dist, so the aim has to fall by orbitPitch * (its own
       horizontal distance) for the ray between them to keep passing through the
       craft — same 0.9 in both places, or it does not cancel.
       That horizontal distance is `reach * cp` and NOT `reach`, which is why
       it is named here rather than written twice: the lead is laid along the
       craft's heading, so pitching the nose foreshortens how far forward of the
       craft it actually lands, and the compensation has to be measured against
       where the aim IS. It is a small correction — cp is 0.96 in a jet at a
       fair dive, so a few percent of the term — and it only shows up in the
       jet, since the rover and the boat barely pitch. It is here because with
       it the cancellation is exact in the tangent frame rather than nearly
       exact, and "nearly" is what this whole block was suffering from.
       Measured, in fractions of the half-frame the craft travels across while
       you swing the view through nine orbits: rover 6.04 -> 0.27, boat 0.60 ->
       0.18, jet 0.62 -> 0.10, and the rover no longer leaves the frame at all
       on the three orbits that used to push it off the edge. What is left is
       the boom hitting its terrain clearance on a low angle, which is ground
       the camera genuinely cannot go through. */
    const cp = Math.cos(craft.pitch), sp = Math.sin(craft.pitch);
    const reach = 8 + speedT * 14;
    const lead = reach * cp;
    const aw = fr.toWorld(
      Math.sin(yaw) * lead,
      craft.pos.y + 1.6 - this.orbitPitch * lead * 0.9 +
        (mode === 'jet' ? -sp : 0) * reach,
      Math.cos(yaw) * lead, WB);
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
