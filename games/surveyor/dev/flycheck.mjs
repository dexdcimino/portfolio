// Frame pacing while the jet boosts across Home — the stress case the revamp
// is capped by, measured rather than judged.
//
//   node dev/flycheck.mjs             25s of boosted flight on Home
//   node dev/flycheck.mjs tarn 40     another world, another duration
//   node dev/flycheck.mjs --size 1920x1080          a real player's backbuffer
//   node dev/flycheck.mjs --window --size 2560x1440 ...in a real window
//
// SIZE IS THE AXIS THAT WAS MISSING. Every number this harness ever reported
// came off 1280x760, and 900x560 before that, which is a quarter to a ninth of
// the pixels anyone actually plays at. That does not scale the answer down
// evenly: a CPU spike (a leaf build, a tree walk) costs the SAME at any
// resolution, but the frame it lands in gets longer with every pixel, so the
// spike that hides under a 6ms frame at 1280x760 blows through 16.7ms at
// 2560x1440. Measure at the size being asked about.
//
// --scale N and --off a,b,c are the LEVERS, applied after the world has
// streamed and before anything is timed, so one flight can be compared against
// another with only that lever moved. --scale is the engine's hardware scaling
// level (1 = one backbuffer pixel per CSS pixel; the game ships at 1/dpr, so a
// 125% display renders 1.56x the pixels it shows). --off takes any of
// ssao, bloom, grain, fxaa.
//
// --window drops headless for a real window on the real compositor: vsync, a
// desktop the GPU is also serving, and no Emulation override deciding the
// backbuffer. Noisier, and the only place a vsync-coupled hitch can appear at
// all. --size still applies; the harness reports the backbuffer it actually
// got rather than the one it asked for.
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

const ALL = process.argv.slice(2);
const argv = ALL.filter((a) => !a.startsWith('--') && !/^\d+x\d+$/.test(a));
const KEY = argv[0] || 'home';
const SECS = Math.max(5, Number(argv[1]) || 25);
const PORT = 9351;   // own port: other sessions run harnesses in this repo too
const HEADED = ALL.includes('--window');
const sizeArg = (ALL.find((a) => a.startsWith('--size=')) || '').slice(7)
  || (ALL[ALL.indexOf('--size') + 1] || '');
const [W, H] = /^\d+x\d+$/.test(sizeArg)
  ? sizeArg.split('x').map(Number)
  : [1280, 760];
const scaleArg = (ALL.find((a) => a.startsWith('--scale=')) || '').slice(8)
  || (ALL[ALL.indexOf('--scale') + 1] || '');
const SCALE = Number(scaleArg) > 0 ? Number(scaleArg) : 0;
const offArg = (ALL.find((a) => a.startsWith('--off=')) || '').slice(6)
  || (ALL.includes('--off') ? (ALL[ALL.indexOf('--off') + 1] || '') : '');
const OFF = offArg ? offArg.split(',').map((s) => s.trim()).filter(Boolean) : [];

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

  /* THE LEVERS. Applied here, after the world has streamed and before the
     warm-up, so both halves of an A/B run identical geometry and the only
     difference is the thing being tested. */
  const LEVER_SCALE = ${SCALE};
  const LEVER_OFF = ${JSON.stringify(OFF)};
  if (LEVER_SCALE) S.scene.getEngine().setHardwareScalingLevel(LEVER_SCALE);
  if (LEVER_OFF.includes('ssao')) S.post.setSsaoEnabled(false);
  if (LEVER_OFF.includes('bloom')) S.pipeline.bloomEnabled = false;
  if (LEVER_OFF.includes('grain')) S.pipeline.grainEnabled = false;
  if (LEVER_OFF.includes('fxaa')) S.pipeline.fxaaEnabled = false;

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

  /* WHERE THE FRAME WENT, not just how long it was. A worst-frame number on
     its own says a hitch exists; it does not say what to cut. These three
     wrappers are the whole attribution: streaming (the quadtree walk, the
     dispose sweep, and the builds it decides to run), the leaf builds inside
     it, and the CPU half of the render. Everything else is the remainder. */
  const field = S.field;
  let fieldMs = 0, buildMs = 0, buildN = 0, renderMs = 0;
  const rawUpdate = field.update.bind(field);
  field.update = (...a) => {
    const t = performance.now();
    const r = rawUpdate(...a);
    fieldMs += performance.now() - t;
    return r;
  };
  const rawBuild = field.build.bind(field);
  field.build = (...a) => {
    const t = performance.now();
    const m = rawBuild(...a);
    buildMs += performance.now() - t;
    buildN++;
    return m;
  };
  /* THE WHOLE GAME LOOP, so "our JavaScript" can be told apart from
     "everything else". Babylon keeps its registered loop in _activeRenderLoops;
     wrapping the entry times every update in main.js plus the render call, and
     dt minus this is what the browser, the GPU and the garbage collector spent
     while our code was not running. Without this split a 36ms frame with 8ms of
     render in it is unattributable, and unattributable is unfixable. */
  const eng = S.scene.getEngine();
  let loopMs = 0;
  const loops = eng._activeRenderLoops;
  const rawLoop = loops[0];
  loops[0] = () => {
    const t = performance.now();
    rawLoop();
    loopMs += performance.now() - t;
  };

  /* EVERY SUBSYSTEM THE LOOP CALLS, timed separately. The loop/render split
     narrows a spike to "our JavaScript"; this says WHICH of our JavaScript,
     which is the difference between a diagnosis and a hunch. Wrapped by name
     off the debug surface rather than by editing main.js, so the thing being
     measured is the shipping loop. */
  const parts = {};
  const partOf = (obj, method, label) => {
    if (!obj || typeof obj[method] !== 'function') return;
    const raw = obj[method].bind(obj);
    parts[label] = 0;
    obj[method] = (...a) => {
      const t = performance.now();
      const r = raw(...a);
      parts[label] += performance.now() - t;
      return r;
    };
  };
  partOf(S.craft, 'update', 'craft');
  partOf(S.economy, 'update', 'economy');
  partOf(S.world, 'update', 'world');
  partOf(S.trails, 'update', 'trails');
  partOf(S.cam, 'update', 'cam');
  partOf(S.streaks, 'update', 'streaks');
  partOf(S.overlay, 'update', 'overlay');
  partOf(S.mats, 'update', 'mats');
  partOf(S.colonies, 'update', 'colonies');
  partOf(S.survey, 'update', 'survey');
  partOf(S.discs, 'update', 'discs');
  const PARTKEYS = Object.keys(parts);

  const rawRender = S.scene.render.bind(S.scene);
  S.scene.render = (...a) => {
    const t = performance.now();
    const r = rawRender(...a);
    renderMs += performance.now() - t;
    return r;
  };

  const dts = [];
  const per = [];      // per frame: [fieldMs, buildMs, builds, renderMs]
  let last = performance.now();
  let builds0 = S.field.builds;
  const start = performance.now();
  while (performance.now() - start < ${SECS} * 1000) {
    await frame();
    const now = performance.now();
    dts.push(now - last);
    per.push([+fieldMs.toFixed(2), +buildMs.toFixed(2), buildN,
      +renderMs.toFixed(2), +loopMs.toFixed(2),
      PARTKEYS.map((k) => +parts[k].toFixed(2))]);
    fieldMs = buildMs = renderMs = loopMs = 0; buildN = 0;
    for (const k of PARTKEYS) parts[k] = 0;
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
  /* THE TEN WORST FRAMES, each with where its time went. One worst frame can
     be anything; ten of them with the same column lit is a cause. */
  const rank = dts.map((_, i) => i).sort((a, b) => dts[b] - dts[a]).slice(0, 10);
  const worstRows = rank.map((i) => ({
    ms: +dts[i].toFixed(1), at: +(i / 60).toFixed(1),
    field: per[i][0], build: per[i][1], builds: per[i][2], render: per[i][3],
    loop: per[i][4],
    parts: per[i][5],
  }));
  /* How much of the OVER-BUDGET time the streaming path accounts for, summed
     across every frame that missed 60Hz. This is the number that decides
     whether cutting the streaming path is worth anything at all. */
  const bad = dts.map((_, i) => i).filter((i) => dts[i] > 17.5);
  const badField = bad.reduce((s, i) => s + per[i][0], 0);
  const badTotal = bad.reduce((s, i) => s + dts[i], 0);
  const fieldSorted = per.map((r) => r[0]).sort((a, b) => a - b);
  const loopSorted = per.map((r) => r[4]).sort((a, b) => a - b);
  const renderSorted = per.map((r) => r[3]).sort((a, b) => a - b);
  return {
    ok: true,
    frames: n,
    backbuffer: [S.scene.getEngine().getRenderWidth(), S.scene.getEngine().getRenderHeight()],
    dpr: window.devicePixelRatio,
    worstRows,
    fieldMedian: +fieldSorted[Math.floor(n * 0.5)].toFixed(2),
    fieldWorst: +fieldSorted[n - 1].toFixed(2),
    renderMedian: +renderSorted[Math.floor(n * 0.5)].toFixed(2),
    loopMedian: +loopSorted[Math.floor(n * 0.5)].toFixed(2),
    loopWorst: +loopSorted[n - 1].toFixed(2),
    partKeys: PARTKEYS,
    /* Each subsystem's share of the OVER-BUDGET frames' time, and its worst
       single frame. The share says what to cut; the worst says how bad the one
       bad frame was, which a mean hides completely. */
    partBad: PARTKEYS.map((k, j) => ({
      k,
      sum: +bad.reduce((s, i) => s + per[i][5][j], 0).toFixed(1),
      worst: +Math.max(0, ...per.map((r) => r[5][j])).toFixed(1),
      median: +per.map((r) => r[5][j]).sort((a, b) => a - b)[Math.floor(n * 0.5)].toFixed(2),
    })).sort((a, b) => b.sum - a.sum),
    // Over-budget time our own JavaScript was not even running for.
    badOutside: badTotal > 0 ? +((badTotal -
      bad.reduce((s, i) => s + per[i][4], 0)) / badTotal * 100).toFixed(1) : 0,
    badFrames: bad.length,
    badFieldShare: badTotal > 0 ? +(badField / badTotal * 100).toFixed(1) : 0,
    badRestShare: badTotal > 0 ? +((badTotal - badField -
      bad.reduce((s, i) => s + per[i][3], 0)) / badTotal * 100).toFixed(1) : 0,
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
const PAGE_URL = `http://127.0.0.1:${port}${GAME}?planet=${KEY}`;
/* A real window is sized in WINDOW pixels, and an --app window is very nearly
   all canvas — but "very nearly" is not a measurement, so the backbuffer the
   engine actually got is read back and reported instead of this request. */
const chrome = await launch({
  width: W, height: H, port: PORT, gpu: true,
  headed: HEADED, app: HEADED ? PAGE_URL : null,
});
const page = HEADED ? await chrome.firstPage(PAGE_URL) : await chrome.newPage();
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
/* Headless has no window, so the backbuffer comes from an Emulation override.
   A real window already HAS one, and overriding it there would put the canvas
   back under Chrome's scaler and measure the wrong thing. */
if (!HEADED) {
  await page.send('Emulation.setDeviceMetricsOverride',
    { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.navigate', { url: PAGE_URL });
}

const r = await evaluate(page, FLY);
await chrome.close();
closeServer();
server.unref();

if (!r.ok) {
  console.log('FAILED: never became ready');
  process.exit(1);
}
const [bw, bh] = r.backbuffer;
console.log(`${KEY}, ${SECS}s of boosted jet, real GPU, ` +
  `${HEADED ? 'real window' : 'headless'} — backbuffer ${bw}x${bh}` +
  `${r.dpr !== 1 ? ` (dpr ${r.dpr})` : ''}` +
  `${SCALE ? `, scale ${SCALE}` : ''}${OFF.length ? `, off: ${OFF.join('+')}` : ''}:`);
console.log(`  ${r.frames} frames, ${r.builds} leaf builds, ${r.leaves} leaves live, ` +
  `ended ${r.mode} at ${r.alt}m`);
console.log(`  median ${r.median}ms  p95 ${r.p95}  p99 ${r.p99}  worst ${r.worst}ms ` +
  `(at ~${r.worstAtSec}s)`);
console.log(`  missed 60Hz: ${r.over60}/${r.frames}  visible hitches (>34ms): ${r.over30}  ` +
  `stalls (>100ms): ${r.over100}`);
console.log(`  render CPU median ${r.renderMedian}ms  |  streaming median ` +
  `${r.fieldMedian}ms, worst ${r.fieldWorst}ms  |  ${r.badFieldShare}% of all ` +
  `over-budget time sits in field.update`);
console.log(`  game loop CPU: median ${r.loopMedian}ms, worst ${r.loopWorst}ms  |  ` +
  `${r.badOutside}% of all over-budget time is OUTSIDE our JavaScript entirely ` +
  `(GPU, compositor, GC)`);
console.log('  subsystem  median   worst   sum over budget frames');
for (const q of r.partBad) {
  console.log(`    ${q.k.padEnd(9)} ${String(q.median).padStart(6)} ` +
    `${String(q.worst).padStart(7)} ${String(q.sum).padStart(8)}ms`);
}
console.log('  worst 10 frames (total, then where the time went):');
for (const w of r.worstRows) {
  console.log(`    ${String(w.ms).padStart(7)}ms at ${String(w.at).padStart(5)}s  ` +
    `build ${String(w.build).padStart(5)}(${w.builds})  ` +
    `render ${String(w.render).padStart(5)}  loop ${String(w.loop).padStart(5)}  ` +
    `OUTSIDE ${String((w.ms - w.loop).toFixed(1)).padStart(6)}`);
}
for (const e of errs) console.log(`  ! ${e}`);
const clean = r.over100 === 0 && r.over30 <= r.frames * 0.01;
console.log(clean ? 'SMOOTH: no stalls, hitches under 1% of frames'
  : 'NOT SMOOTH: see the counts above');
process.exit(clean ? 0 : 1);
