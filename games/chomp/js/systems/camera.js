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
  let zoomMult = 1; // debug slider multiplier (MD-04b)
  let targetDist = C.camDistByStage[0];
  let punchT = Infinity;

  const retarget = () => {
    targetDist = C.camDistByStage[stageIdx] * zoomMult;
  };

  on('player:chomp', () => {
    punchT = 0;
  });

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
