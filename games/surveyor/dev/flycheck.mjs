// Frame pacing while the jet boosts across Home — the stress case the revamp
// is capped by, measured rather than judged.
//
//   node dev/flycheck.mjs             25s of boosted flight on Home
//   node dev/flycheck.mjs tarn 40     another world, another duration
//
// The chase camera crossing chunk boundaries at boost speed is the worst thing
// the streaming system is asked to do: leaves promote and drop under the
// craft every few frames, each build pays the full noise/flora/rock cost, and
// a build that misses the per-frame budget shows up as a spike, not as a
// higher average. So the number reported is the WORST frame and the count
// over 60fps/30fps budgets, never the mean — a mean of 6ms with three 80ms
// stalls in it is a bad flight that averages well.
//
// The game loop stays fully live (this is not a stopped-loop harness): real
// rAF pacing, real streaming, real physics, real post stack, on the real GPU.
// Headless Chrome paces rAF at 60Hz, so a clean flight reads as a wall of
// ~16.7ms deltas and every missed frame is a multiple of it.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { launch, serve, evaluate } from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../..');
const GAME = '/games/surveyor/';

const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const KEY = argv[0] || 'home';
const SECS = Math.max(5, Number(argv[1]) || 25);
const PORT = 9351;   // own port: other sessions run harnesses in this repo too

const FLY = `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const t0 = performance.now();
  let drained = 0;
  while (performance.now() - t0 < 90000) {
    await frame();
    const S = window.SURVEYOR;
    if (!S) continue;
    drained = S.field.queue.length === 0 ? drained + 1 : 0;
    if (drained > 20) break;
  }
  const S = window.SURVEYOR;
  if (!S) return { ok: false };
  document.getElementById('begin').click();
  const hud = document.getElementById('hud');
  if (hud) hud.style.visibility = 'hidden';
  for (let i = 0; i < 30; i++) await frame();

  // Clock warm-up before anything is timed — a laptop GPU ramps over seconds.
  const t1 = performance.now();
  while (performance.now() - t1 < 3000) await frame();

  /* Airborne at BOOST SPEED for the whole recording, guaranteed. The first
     cut held W, which in the air is pitch-down: the jet flew a beautiful
     parabola into the ground at 8 seconds and the harness spent the rest of
     the run measuring a rover. So the flight is forced instead of flown —
     ground speed pinned to JET.boostSpeed, altitude clamped above the
     terrain, mode pinned to jet — because what is being measured is the
     STREAMING under a 158m/s camera, not anyone's piloting. */
  const T = await import('./js/tune.js');
  S.craft.pos.y += 60;
  S.craft.setMode('jet');
  S.craft.vel.x = T.JET.boostSpeed;

  const dts = [];
  let last = performance.now();
  let builds0 = S.field.builds;
  const start = performance.now();
  while (performance.now() - start < ${SECS} * 1000) {
    await frame();
    const now = performance.now();
    dts.push(now - last);
    last = now;
    const c = S.craft;
    c.fuel = 200;
    if (c.mode !== 'jet') c.setMode('jet');
    const g = c.surf.surfaceHeight(c.pos.x, c.pos.z);
    if (c.pos.y < g + 25) { c.pos.y = g + 55; if (c.vel.y < 0) c.vel.y = 0; }
    const sp = Math.hypot(c.vel.x, c.vel.z);
    if (sp < T.JET.boostSpeed * 0.95) {
      if (sp > 1) {
        const k = T.JET.boostSpeed / sp;
        c.vel.x *= k; c.vel.z *= k;
      } else {
        c.vel.x = T.JET.boostSpeed;
      }
    }
  }

  const n = dts.length;
  const sorted = dts.slice().sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(n - 1, Math.floor(n * q))];
  const over = (ms) => dts.filter((d) => d > ms).length;
  // Where the spikes were, so a hitch can be correlated with what streamed.
  const worstIdx = dts.indexOf(sorted[n - 1]);
  return {
    ok: true,
    frames: n,
    builds: S.field.builds - builds0,
    leaves: S.field.live.size,
    median: +at(0.5).toFixed(1),
    p95: +at(0.95).toFixed(1),
    p99: +at(0.99).toFixed(1),
    worst: +sorted[n - 1].toFixed(1),
    over60: over(17.5),          // a 60Hz frame missed (16.7 + scheduler slack)
    over30: over(34),            // a 30Hz frame missed — a visible hitch
    over100: over(100),          // a stall
    worstAtSec: +(worstIdx / 60).toFixed(1),
    alt: +S.craft.pos.y.toFixed(0),
    mode: S.craft.mode,
  };
})()`;

const { server, port, close: closeServer } = await serve(SITE);
const chrome = await launch({ width: 1280, height: 760, port: PORT, gpu: true });
const page = await chrome.newPage();
const errs = [];
page.on((method, params) => {
  if (method === 'Runtime.exceptionThrown') {
    errs.push('exception: ' + (params.exceptionDetails.exception?.description
      || params.exceptionDetails.text));
  }
  if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
    errs.push('console.error: ' + params.args.map((a) => a.value || a.description).join(' '));
  }
});
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Emulation.setDeviceMetricsOverride',
  { width: 1280, height: 760, deviceScaleFactor: 1, mobile: false });
await page.send('Page.navigate', { url: `http://127.0.0.1:${port}${GAME}?planet=${KEY}` });

const r = await evaluate(page, FLY);
await chrome.close();
closeServer();
server.unref();

if (!r.ok) {
  console.log('FAILED: never became ready');
  process.exit(1);
}
console.log(`${KEY}, ${SECS}s of boosted jet at 1280x760, real GPU:`);
console.log(`  ${r.frames} frames, ${r.builds} leaf builds, ${r.leaves} leaves live, ` +
  `ended ${r.mode} at ${r.alt}m`);
console.log(`  median ${r.median}ms  p95 ${r.p95}  p99 ${r.p99}  worst ${r.worst}ms ` +
  `(at ~${r.worstAtSec}s)`);
console.log(`  missed 60Hz: ${r.over60}/${r.frames}  visible hitches (>34ms): ${r.over30}  ` +
  `stalls (>100ms): ${r.over100}`);
for (const e of errs) console.log(`  ! ${e}`);
const clean = r.over100 === 0 && r.over30 <= r.frames * 0.01;
console.log(clean ? 'SMOOTH: no stalls, hitches under 1% of frames'
  : 'NOT SMOOTH: see the counts above');
process.exit(clean ? 0 : 1);
