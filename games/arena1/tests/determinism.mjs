// determinism.mjs — the Phase 1 acceptance test, headless in plain Node.
// Two sims, same seed, identical 600-tick scripted command stream (walk,
// jump, idle) → final snapshots must be BYTE-identical. Then a different
// seed → must differ. This test grows with the phases (combat joins it in
// Phase 5) and must never be weakened to "approximately equal".
import { createSim, BTN } from '../js/sim/sim.js';

function scriptedCommand(tick, playerId) {
  // 0–199: walk forward. 200–399: strafe + a jump edge every 90 ticks.
  // 400–599: idle (glide to rest). Edges matter: buffer/coyote are tick math.
  let move = { x: 0, z: 0 };
  let buttons = 0;
  if (tick < 200) move = { x: 0, z: 1 };
  else if (tick < 400) {
    move = { x: 1, z: 0.25 };
    if (tick % 90 === 0) buttons |= BTN.JUMP;
  }
  return { tick, playerId, move, yaw: tick * 0.001, pitch: 0, buttons };
}

function run(seed) {
  const sim = createSim(seed, { pvp: true });
  const id = sim.addPlayer();
  for (let t = 0; t < 600; t++) {
    sim.step(new Map([[id, scriptedCommand(t, id)]]));
  }
  return JSON.stringify(sim.snapshot());
}

const a = run(12345);
const b = run(12345);
const c = run(54321);

let failures = 0;
if (a === b) console.log('pass  same seed, same commands → byte-identical snapshots');
else { failures++; console.error('FAIL  same-seed snapshots differ:\n' + a + '\n' + b); }

// The seed field itself differs by construction; the state must too.
const stripSeed = (s) => s.replace(/"seed":\d+,/, '');
if (stripSeed(a) !== stripSeed(c)) console.log('pass  different seed → different world state (not just the header)');
else { failures++; console.error('FAIL  different seed produced identical state'); }

const parsed = JSON.parse(a);
const p = parsed.players[0];
if (p.flags & 1 && Math.abs(p.vel.y) < 1e-6) console.log('pass  600 ticks end grounded and at rest vertically');
else { failures++; console.error('FAIL  end state not grounded/rested: ' + JSON.stringify(p)); }

console.log(failures ? `\n${failures} failure(s)` : '\ndeterminism clean');
process.exit(failures ? 1 : 0);
