// systems/camera.js — tilted top-down follow rig (GDD "Camera", MD-04 §4).
// Pitch from config, exponential position lerp, smoothed look-ahead in the
// movement direction, per-stage distance with smooth zoom, FOV punch on chomp
// (subscribes to the player:chomp event).

import { CONFIG } from '../config.js';
import { on } from '../core/events.js';

export function createCameraRig(scene) {
  const C = CONFIG.camera;
  const cam = new BABYLON.ArcRotateCamera(
    'followCam',
    -Math.PI / 2,
    (C.pitchDeg * Math.PI) / 180,
    C.camDistByStage[0],
    BABYLON.Vector3.Zero(),
    scene
  );
  const baseFov = cam.fov;
  const look = { x: 0, z: 0 };
  let stageIdx = 0;
  // Default is FULL zoom-out (2.0, the slider's max) per Dex — the game reads
  // better wide. chomp-zoom persists the settings-menu choice; the debug
  // slider still drives the same multiplier.
  let zoomMult = (() => {
    try {
      const v = parseFloat(localStorage.getItem('chomp-zoom'));
      return Number.isFinite(v) ? Math.min(2, Math.max(0.5, v)) : 2;
    } catch { return 2; }
  })();
  let targetDist = C.camDistByStage[0];
  let punchT = Infinity;

  const retarget = () => {
    targetDist = C.camDistByStage[stageIdx] * zoomMult;
  };

  on('player:chomp', () => {
    punchT = 0;
  });

  // Apply the boot zoom NOW. retarget() otherwise first runs on a stage
  // change, so the camera sat at the x1 distance (radius 5.5) no matter what
  // zoomMult booted to — the default-zoom fix without this line was a no-op.
  retarget();
  // Snap, not lerp: the player should spawn at the framing, not watch the
  // camera pull out to it over a second.
  cam.radius = targetDist;

  // The pause menu lives in another module with no handle on this rig; it
  // dispatches chomp-zoom on window and the rig applies it here.
  window.addEventListener('chomp-zoom', (e) => {
    zoomMult = Math.min(2, Math.max(0.5, Number(e.detail) || 2));
    retarget();
    // Immediate, not lerped: while the pause menu is open the update loop is
    // not running, so without this the scrub would only land on resume.
    cam.radius = targetDist;
  });

  // Scroll wheel zooms too — down zooms out, up zooms in — and persists the
  // same chomp-zoom the menu slider uses. The menu listens for the event to
  // keep its slider in step.
  window.addEventListener('wheel', (e) => {
    zoomMult = Math.min(2, Math.max(0.5, zoomMult + (e.deltaY > 0 ? 0.1 : -0.1)));
    try { localStorage.setItem('chomp-zoom', zoomMult.toFixed(2)); } catch { /* private mode */ }
    retarget();
    cam.radius = targetDist;
    window.dispatchEvent(new CustomEvent('chomp-zoom-sync', { detail: zoomMult }));
  }, { passive: true });

  return {
    cam,
    setStage(stage) {
      stageIdx = Math.min(Math.max(stage, 1), 5) - 1;
      retarget();
    },
    setZoomMult(m) {
      zoomMult = Math.min(2, Math.max(0.5, m));
      retarget();
    },
    /* The spawn-framing raycast that used to live here is gone, and the reason
       is worth keeping: it raycast camera->player for the first 0.6s and yawed
       away from any wall or rocks mesh it hit. It could never hit anything.
       Both are built isPickable:false (chunks.js), and scene.pickWithRay
       skips unpickable meshes — so it returned "clear" on frame one, set its
       own timer to zero and did nothing, in every world, forever. It read like
       a guarantee and was a no-op, which is worse than no guard at all.

       The guarantee now lives in world/carve.js: the spawn view corridor is
       never carved as wall and never decorated, so there is nothing to yaw
       away from. See CONFIG.world.carve.spawnView*. */
    update(player, dt, targetY = 0) {
      // Smoothed look-ahead point in the velocity direction
      const speedFrac = player.maxSpeed > 0 ? Math.min(1, player.speed / player.maxSpeed) : 0;
      const lx = player.speed > 0.01 ? (player.vx / player.speed) * C.lookAhead * speedFrac : 0;
      const lz = player.speed > 0.01 ? (player.vz / player.speed) * C.lookAhead * speedFrac : 0;
      const kLook = 1 - Math.exp(-C.lookAheadLerp * dt);
      look.x += (lx - look.x) * kLook;
      look.z += (lz - look.z) * kLook;

      // Exponential follow — framerate-independent, never overshoots
      const k = 1 - Math.exp(-C.posLerp * dt);
      cam.target.x += (player.x + look.x - cam.target.x) * k;
      cam.target.z += (player.z + look.z - cam.target.z) * k;
      cam.target.y += (targetY - cam.target.y) * k; // ride the terrain

      // Per-stage zoom, smooth over zoomSmoothSec
      const kZoom = 1 - Math.exp((-1 / C.zoomSmoothSec) * dt);
      cam.radius += (targetDist - cam.radius) * kZoom;

      // FOV punch 0.9 → 1.0 over fovPunchSec
      if (punchT < C.fovPunchSec) {
        punchT += dt;
        const u = Math.min(1, punchT / C.fovPunchSec);
        cam.fov = baseFov * (C.fovPunchScale + (1 - C.fovPunchScale) * u);
      } else {
        cam.fov = baseFov;
      }
    },
  };
}
