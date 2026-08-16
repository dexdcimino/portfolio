// main.js — boot. Phase 0 scope: prove the shell serves (black canvas + HUD
// root) with Babylon resolving from vendor/. The fixed-step accumulator, state
// machine and loopback transport arrive in Phase 1 — nothing here should
// pre-empt their shape.
import { SIM_DT, PVP_DEFAULT } from './config.js';

const canvas = document.getElementById('game');

// Babylon engine + empty scene: proves the vendored bundle loads under the
// /games/* CSP. If BABYLON is undefined here, the CDN rule was violated.
const engine = new BABYLON.Engine(canvas, true, { stencil: true });
const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0, 0, 0, 1);
// A scene will not render without a camera — placeholder until Phase 4's rig.
new BABYLON.FreeCamera('boot', new BABYLON.Vector3(0, 1.7, 0), scene);

engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());

// Embed hooks (contract #3) — exact shape now, wired to the real state
// machine in Phase 6. Present from Phase 0 so the wrapper contract is never
// retrofitted (the Chomp lesson).
window.Arena1 = {
  pause() { /* state machine lands in Phase 1 */ },
  resume() { /* state machine lands in Phase 1 */ },
  setSafeTop(px) {
    document.documentElement.style.setProperty('--safe-top', `${px}px`);
  },
};

console.log(`[arena1] scaffold up — SIM_DT ${SIM_DT.toFixed(4)}s, pvp default ${PVP_DEFAULT}`);
