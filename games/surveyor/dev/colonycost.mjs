// What a colony actually costs to draw, and what scales as they accumulate.
//
//   node dev/colonycost.mjs            28 mature sites on Home
//   node dev/colonycost.mjs --quick    fewer samples
//
// "Laying a lot of dome probes makes the game lag" is reproducible, and the
// suspects are meshes, materials, draw calls or the per-worker update. This
// measures instead of assuming: a dense basin of mature colonies is planted
// through `colonies.restore` — the same path a reload takes — and then whole
// sites are toggled by their root TransformNode inside interleaved A/B pairs,
// on the real GPU, with the same three clocks dev/budget.mjs uses (CPU submit,
// GPU timer query, synced wall). Toggling rather than replanting is what makes
// the pairs honest: both halves of a pair are the same scene, same frame,
// same everything except whether the sites render.
//
// The per-draw arithmetic this rides next to: dev/budget.mjs measured ~12us of
// CPU per draw call and near-zero GPU cost for small meshes. Every dome, tube,
// lander, worker and turret is a `clone()` — one mesh, one draw call each — so
// the prediction is that colony cost is CPU draw submission, linear in the
// enabled-mesh count. This file is the check on that prediction, and the
// numbers Part 2's gating/merging work gets sized against.

import { launch, serve, evaluate } from './cdp.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../..');
const GAME = '/games/surveyor/';

const QUICK = process.argv.includes('--quick');
const FRAMES = QUICK ? 50 : 100;
const PAIRS = QUICK ? 2 : 3;
const SITES = 28;                 // a dense basin: the game's worst case
const PORT = 9345;                // own port; other sessions run harnesses too

const READY = `(async () => {
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
  if (!window.SURVEYOR) return { ok: false };
  const S = window.SURVEYOR;
  const begin = document.getElementById('begin');
  if (begin) begin.click();
  const hud = document.getElementById('hud');
  if (hud) hud.style.visibility = 'hidden';
  for (let i = 0; i < 40; i++) await frame();
  S.scene.getEngine().stopRenderLoop();
  for (const ps of S.scene.particleSystems.slice()) { ps.stop(); ps.reset(); }
  S.scene.animationsEnabled = false;
  S.cam.update = () => {};
  const gl = S.scene.getEngine()._gl;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const t1 = performance.now();
  while (performance.now() - t1 < 4000) S.scene.render();   // clock warm-up
  return {
    ok: true,
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  };
})()`;

/* Plant the basin AROUND THE CRAFT, because that is the worst case the game
   invites: every site inside COLONY.viewRange, every mesh built. The first cut
   planted on the vents the way perf.mjs does and measured nothing at all —
   perf.mjs only needs the overlay markers, but MESHES are built in stream(),
   gated on the arc to the craft, and the vents are mostly outside it. Restore
   through the same path a reload takes, staggered old ages so every dome and
   tube is fully grown, then drive update() (tick AND stream) long enough for
   every site to build and staff itself. */
const PLANT = `(() => {
  const S = window.SURVEYOR;
  const col = S.colonies;
  const fr = S.surface.frame;
  let id = 1, s = 99;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < ${SITES}; i++) {
    const a = rnd() * Math.PI * 2, r = 40 + Math.sqrt(rnd()) * 320;
    const d = fr.dirAt(Math.cos(a) * r, Math.sin(a) * r, { x: 0, y: 0, z: 0 });
    col.restore({ id: id++, dir: [d.x, d.y, d.z], age: 900 + i * 30 }, 0);
  }
  for (let i = 0; i < 120; i++) col.update(1 / 60);
  let workers = 0, built = 0;
  for (const st of col.sites) {
    if (st.node) built++;
    workers += st.workers ? st.workers.length : 0;
  }
  return { sites: col.sites.length, built, workers };
})()`;

/* What the game loop itself pays per frame for the colony system — worker
   motion, turret shaping, streaming checks. scene.render() never sees this,
   because main.js calls colonies.update outside it, so it gets its own clock:
   the median of individually timed update() calls at a real dt. */
const UPDATE_COST = `(() => {
  const S = window.SURVEYOR;
  const ms = [];
  for (let i = 0; i < 200; i++) {
    const t0 = performance.now();
    S.colonies.update(1 / 60);
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  return { ms: ms[100] };
})()`;

/* Enable the first n sites, disable the rest. The root TransformNode carries
   every dome, tube and lander with it; workers are toggled by hand in case any
   are parented elsewhere. */
const SHOW = (n) => `(() => {
  const S = window.SURVEYOR;
  let on = 0;
  S.colonies.sites.forEach((s, i) => {
    const enable = i < ${n};
    if (s.node && s.node.node) s.node.node.setEnabled(enable);
    if (s.workers) for (const w of s.workers) w.mesh.setEnabled(enable);
    if (enable) on++;
  });
  return { on };
})()`;

const COUNT = `(() => {
  const S = window.SURVEYOR;
  if (!window.__SI) window.__SI = new BABYLON.SceneInstrumentation(S.scene);
  S.scene.render();
  return {
    drawCalls: window.__SI.drawCallsCounter.current,
    enabledMeshes: S.scene.meshes.filter((x) => x.isEnabled()).length,
    totalMeshes: S.scene.meshes.length,
  };
})()`;

const TIME = (n) => `(async () => {
  const S = window.SURVEYOR;
  const eng = S.scene.getEngine(), gl = eng._gl;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const px = new Uint8Array(4);
  const sync = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  };
  for (let i = 0; i < 10; i++) S.scene.render();
  sync();
  const wall = [], qs = [];
  for (let i = 0; i < ${n}; i++) {
    const q = ext ? gl.createQuery() : null;
    if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    const t0 = performance.now();
    S.scene.render();
    if (q) gl.endQuery(ext.TIME_ELAPSED_EXT);
    sync();
    wall.push(performance.now() - t0);
    if (q) qs.push(q);
  }
  const cpu = [];
  for (let i = 0; i < ${n}; i++) {
    const t0 = performance.now();
    S.scene.render();
    cpu.push(performance.now() - t0);
  }
  gl.finish();
  let gpu = [];
  if (ext) {
    for (let tries = 0; tries < 60; tries++) {
      await new Promise((r) => setTimeout(r, 15));
      if (qs.every((q) => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE))) break;
    }
    if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      for (const q of qs) {
        if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
          gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        }
      }
    }
    for (const q of qs) gl.deleteQuery(q);
  }
  const med = (a) => { a.sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
  return { wall: med(wall), gpu: med(gpu), cpu: med(cpu) };
})()`;

// ---- the run ---------------------------------------------------------------

const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const bound = (r) => Math.max(r.cpu, r.gpu ?? 0);
const sgn = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);

const { server, port, close: closeServer } = await serve(SITE);
const chrome = await launch({ width: 900, height: 560, port: PORT, gpu: true });
const page = await chrome.newPage();
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Emulation.setDeviceMetricsOverride',
  { width: 900, height: 560, deviceScaleFactor: 1, mobile: false });
await page.send('Page.navigate', { url: `http://127.0.0.1:${port}${GAME}?planet=home` });

const ready = await evaluate(page, READY);
if (!ready.ok || /swiftshader/i.test(ready.renderer)) {
  console.log('FAILED: not ready, or SwiftShader — a budget needs the real adapter');
  process.exit(1);
}
console.log(`renderer: ${ready.renderer}\n`);

const bare = await evaluate(page, COUNT);
const updBare = await evaluate(page, UPDATE_COST);
const planted = await evaluate(page, PLANT);
const full = await evaluate(page, COUNT);
const updFull = await evaluate(page, UPDATE_COST);
console.log(`planted ${planted.sites} mature sites (${planted.built} built), ` +
  `${planted.workers} workers`);
console.log(`meshes ${bare.enabledMeshes} -> ${full.enabledMeshes} enabled ` +
  `(${((full.enabledMeshes - bare.enabledMeshes) / planted.sites).toFixed(1)}/site), ` +
  `draws ${bare.drawCalls} -> ${full.drawCalls} ` +
  `(${((full.drawCalls - bare.drawCalls) / planted.sites).toFixed(1)}/site)`);
console.log(`colonies.update(): ${updBare.ms.toFixed(2)}ms empty -> ` +
  `${updFull.ms.toFixed(2)}ms with the basin ` +
  `(${((updFull.ms - updBare.ms) / planted.sites * 1000).toFixed(0)}us/site, ` +
  'on the game loop, invisible to render timing)\n');

/* A/A floor first, then each site count against zero sites, interleaved. */
async function pairedShow(nA, nB) {
  const d = [], dg = [];
  let b0 = null;
  for (let i = 0; i < PAIRS; i++) {
    await evaluate(page, SHOW(nA));
    const a = await evaluate(page, TIME(FRAMES));
    await evaluate(page, SHOW(nB));
    const b = await evaluate(page, TIME(FRAMES));
    b0 = b;
    d.push(bound(b) - bound(a));
    if (a.gpu != null && b.gpu != null) dg.push(b.gpu - a.gpu);
  }
  return { level: b0, dBound: med(d), dGpu: dg.length ? med(dg) : null,
    spread: Math.max(...d) - Math.min(...d) };
}

const aa = await pairedShow(0, 0);
const floor = Math.max(Math.abs(aa.dBound), aa.spread / 2);
console.log(`floor (0 vs 0 sites): ${sgn(aa.dBound)}ms, spread ${aa.spread.toFixed(2)} ` +
  `-> ${floor.toFixed(2)}ms\n`);

console.log('sites   draws   delta(bound)   gpu      spread   per site');
const counts = [];
for (const n of [7, 14, 28]) {
  const p = await pairedShow(0, n);
  await evaluate(page, SHOW(n));
  const c = await evaluate(page, COUNT);
  counts.push({ n, p, c });
  console.log(`  ${String(n).padStart(3)}  ${String(c.drawCalls).padStart(6)}  ` +
    `${sgn(p.dBound).padStart(9)}ms  ${(p.dGpu == null ? 'n/a' : sgn(p.dGpu)).padStart(7)}  ` +
    `${p.spread.toFixed(2).padStart(7)}  ${(p.dBound / n * 1000).toFixed(0)}us`);
}
const hi = counts[counts.length - 1];
const drawsPerSite = (hi.c.drawCalls - bare.drawCalls) / hi.n;
console.log(`\n${hi.n} sites cost ${sgn(hi.p.dBound)}ms bound ` +
  `(gpu ${hi.p.dGpu == null ? 'n/a' : sgn(hi.p.dGpu)}ms) — ` +
  `${(hi.p.dBound / hi.n * 1000).toFixed(0)}us and ${drawsPerSite.toFixed(1)} draws per mature site`);
console.log(hi.p.dGpu != null && hi.p.dGpu < hi.p.dBound * 0.4
  ? 'the cost is CPU draw submission, as the per-draw arithmetic predicts'
  : 'the GPU share is larger than the per-draw arithmetic predicts — look again');

await chrome.close();
closeServer();
server.unref();
