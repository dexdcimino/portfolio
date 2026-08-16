// main.js — boot + the fixed-step accumulator (Phase 1). The sim runs at
// SIM_DT through the transport regardless of display rate; rendering of sim
// state arrives in Phase 4 (which interpolates between the last two
// snapshots by the accumulator's alpha — that is why lastSnap/prevSnap are
// both kept even though nothing draws them yet).
//
// main talks ONLY to the transport. There is no path from here into sim
// internals — solo play is the host case with zero peers.
import { SIM_DT, PVP_DEFAULT } from './config.js';
import { BTN } from './sim/sim.js';
import { createLoopbackTransport } from './net/transport.js';

const canvas = document.getElementById('game');

// Babylon engine + empty scene: proves the vendored bundle loads under the
// /games/* CSP. If BABYLON is undefined here, the CDN rule was violated.
const engine = new BABYLON.Engine(canvas, true, { stencil: true });
const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0, 0, 0, 1);
new BABYLON.FreeCamera('boot', new BABYLON.Vector3(0, 1.7, 0), scene);

// ── transport + local player ────────────────────────────────────────────────
const seed = (() => {
  const q = new URLSearchParams(location.search).get('seed');
  return q ? Number(q) >>> 0 : 1;
})();
const transport = createLoopbackTransport(seed, { pvp: PVP_DEFAULT });
const localId = transport.addLocalPlayer();

// Input capture is a Phase 3/4 concern; Phase 1 sends honest idle commands so
// the command path is exercised every tick from day one.
function commandForTick(tick) {
  return {
    tick, playerId: localId,
    move: { x: 0, z: 0 },
    yaw: 0, pitch: 0,
    buttons: 0 | (0 && BTN.JUMP), // bitfield; no inputs bound yet
  };
}

let prevSnap = null;
let lastSnap = null;
transport.onSnapshot((s) => { prevSnap = lastSnap; lastSnap = s; });

// ── accumulator ─────────────────────────────────────────────────────────────
let acc = 0;
let lastTime = performance.now(); // render-side clock; the sim only sees ticks
engine.runRenderLoop(() => {
  const now = performance.now();
  acc += Math.min(0.25, (now - lastTime) / 1000); // clamp: tab-switch stalls
  lastTime = now;
  while (acc >= SIM_DT) {
    transport.sendCommand(commandForTick(transport.tickCount));
    transport.tick();
    acc -= SIM_DT;
  }
  // alpha = acc / SIM_DT — Phase 4's interpolation factor, unused until then
  scene.render();
});
window.addEventListener('resize', () => engine.resize());

// Embed hooks (contract #3) — exact shape; wired to the state machine in
// Phase 6. Declared from Phase 0 so the wrapper contract is never retrofitted.
window.Arena1 = {
  pause() { /* state machine lands with the game states */ },
  resume() { /* state machine lands with the game states */ },
  setSafeTop(px) {
    document.documentElement.style.setProperty('--safe-top', `${px}px`);
  },
};

// Dev visibility: tick counter on the HUD shell proves the accumulator runs
// at sim rate independent of refresh rate.
const boot = document.getElementById('hud-boot');
setInterval(() => {
  if (boot && lastSnap) {
    boot.textContent = `ARENA 1 — sim tick ${lastSnap.tick} · p1 y ${lastSnap.players[0].pos.y.toFixed(2)}`;
  }
}, 250);
