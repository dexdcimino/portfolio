// What is the actual frame budget on Home, measured on a real GPU.
//
//   node dev/budget.mjs              the full pass, ~4 minutes
//   node dev/budget.mjs --quick      fewer samples, ~2 minutes
//
// Every render-cost number this project has ever quoted came off SwiftShader,
// and the README says plainly what that was worth: a 49.9ms noise floor, two
// bare worlds measuring 27% apart on identical frames, one run where Shroud
// rendered FASTER with vegetation on. This file exists to replace that with a
// measurement someone can spend against.
//
// WHAT IS DIFFERENT HERE, in order of how much it matters:
//
//   1. THE REAL ADAPTER. cdp.mjs has had `gpu: true` (ANGLE/D3D11) since the
//      water pass and nothing that measured cost ever used it. Probed on this
//      machine: AMD Radeon 880M, 27x faster than SwiftShader on raw fill. The
//      run REFUSES to report numbers if it finds itself on SwiftShader —
//      a budget measured on a software rasteriser is not a budget.
//
//   2. GPU TIMER QUERIES. `performance.now()` around scene.render() times the
//      CPU submitting commands, not the GPU executing them — on hardware those
//      are asynchronous, which is why floracheck's numbers went soft the moment
//      anyone passed --gpu. EXT_disjoint_timer_query_webgl2 brackets the render
//      and reports what the GPU itself spent. Chrome never surfaces a query
//      result in the task that issued it, so collection happens after yielding
//      to the event loop — the first cut polled synchronously and got n/a for
//      every frame. Alongside the queries, wall time per frame is taken with a
//      readPixels sync and CPU submit time without one; a real frame overlaps
//      CPU and GPU, so the number a frame rate rides on is max(cpu, gpu).
//
//   3. INTERLEAVED PAIRS, because the machine drifts more than the effect. The
//      first cut measured baseline early and the load ramps late, and the load
//      ramps came back FASTER — minus 2.8ms for adding 324k triangles — because
//      a laptop's clocks ramp over a session. perf.mjs hit the identical wall
//      on SwiftShader and wrote the fix down: alternate the two states, take
//      the median of per-pair differences, and the drift cancels because both
//      halves of every pair run under the same conditions. Every comparison
//      here is paired, and the floor is an A/A pair — the same scene measured
//      against itself through the same toggling machinery, which must read
//      zero and is printed first. There is also a several-second spin before
//      anything is measured, so the clock ramp happens before the instrument
//      is watching rather than under it.
//
//   4. LOAD RAMPS TO THE CEILING, not guesses toward it. Vegetation density is
//      the cost axis the roadmap wants to spend on, and scaling it through the
//      REAL path (the resolved flora stack, the real cap, a real rebuild)
//      keeps draw calls constant — so that ramp isolates what triangles cost
//      with everything else held. Draw calls and materials get their own ramp
//      with 12-triangle boxes. Thin instances get measured against a merged
//      mesh and against per-mesh clones at the same triangle count, because
//      "reopen the instancing question" needs numbers, not positions.
//
// The one number this file does NOT measure is CPU leaf-build time. dev/run.mjs
// already times that in Node against its 6ms budget, with no browser in the
// way, and it is the only historical metric that was ever trustworthy.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { launch, serve, evaluate } from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../..');
const GAME = '/games/surveyor/';

const QUICK = process.argv.includes('--quick');
const FRAMES = QUICK ? 50 : 100;      // frames per timing sample
const PAIRS = QUICK ? 2 : 3;          // interleaved pairs per comparison

/* A port of its own. dev/ defaults to 9222 and another session may be running
   its own harnesses in this repo right now; colliding with a live debug port
   steals their browser. */
const PORT = 9344;

// ---- page-side snippets ---------------------------------------------------

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
  return {
    ok: true,
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    timerQuery: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
    width: S.scene.getEngine().getRenderWidth(),
    height: S.scene.getEngine().getRenderHeight(),
  };
})()`;

/* Spin the renderer for a few seconds before anything is timed. A laptop GPU
   raises its clocks under load over seconds, not frames; measure before that
   has happened and everything late in the session beats everything early by
   more than the effects being measured. */
const SPIN = (ms) => `(async () => {
  const S = window.SURVEYOR;
  const t0 = performance.now();
  let n = 0;
  while (performance.now() - t0 < ${ms}) { S.scene.render(); n++; }
  return { frames: n };
})()`;

/* One timing sample: N frames rendered by hand, three clocks each.
     gpu   TIME_ELAPSED around the render — what the GPU itself spent
     wall  render + readPixels sync — the serialized whole frame, conservative
     cpu   render alone, no sync — what the main thread spends submitting
   All three are MEDIANS of individually timed frames; floracheck already
   learned that a mean is moved by one scheduling spike and a median is not.
   Query results are collected only after yielding to the event loop, because
   Chrome makes them available at task boundaries and never in the task that
   issued them. */
const TIME = (n) => `(async () => {
  const S = window.SURVEYOR;
  const eng = S.scene.getEngine(), gl = eng._gl;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const px = new Uint8Array(4);
  const sync = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  };
  for (let i = 0; i < 10; i++) S.scene.render();     // warm: compiles, uploads
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
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    if (!disjoint) {
      for (const q of qs) {
        if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
          gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        }
      }
    }
    for (const q of qs) gl.deleteQuery(q);
  }
  const med = (a) => { a.sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
  const sorted = wall.slice().sort((a, b) => a - b);
  return {
    wall: med(wall), wallP95: sorted[Math.floor(sorted.length * 0.95)],
    gpu: med(gpu), gpuN: gpu.length,
    cpu: med(cpu),
  };
})()`;

/* What is on the ground and what the frame draws. Blade and vertex counts come
   off the chunk metadata, which is the only place they are known for certain;
   draw calls come off SceneInstrumentation, which counts actual drawElements
   calls rather than enabled meshes. */
const COUNT = `(() => {
  const S = window.SURVEYOR;
  if (!window.__SI) window.__SI = new BABYLON.SceneInstrumentation(S.scene);
  S.scene.render();
  let blades = 0, verts = 0, leaves = 0;
  for (const [, e] of S.field.live) {
    const m = e.mesh && e.mesh.metadata;
    leaves++;
    if (!m) continue;
    verts += m.verts;
    blades += m.blades;
  }
  return {
    blades, leaves,
    terrainTris: Math.round(verts / 3),
    drawCalls: window.__SI.drawCallsCounter.current,
    enabledMeshes: S.scene.meshes.filter((x) => x.isEnabled()).length,
    textures: S.scene.textures.length,
  };
})()`;

/* Rebuild the chunk field with the vegetation stack scaled by k.
   Through the REAL path: the field's resolved stack (floraOf runs once in the
   ChunkField constructor — mutating planet.flora does nothing, which is the
   +9527% lesson floracheck paid for), and the WORLD.floraPerChunk cap raised in
   step so the ceiling does not silently bind and flatten the ramp. k=1 restores
   the authored stack and cap exactly. Returns the leaf count so the caller can
   refuse to compare two scenes that are not the same scene at two densities. */
const RAMP = (k) => `(async () => {
  const S = window.SURVEYOR;
  const T = await import('./js/tune.js');
  if (!window.__VEG) {
    window.__VEG = { flora: S.field.flora, cap: T.WORLD.floraPerChunk };
  }
  if (${k} === 1) {
    S.field.flora = window.__VEG.flora;
    T.WORLD.floraPerChunk = window.__VEG.cap;
  } else {
    const scaled = structuredClone(window.__VEG.flora);
    for (const name of Object.keys(scaled)) scaled[name].perLeaf *= ${k};
    S.field.flora = scaled;
    T.WORLD.floraPerChunk = window.__VEG.cap * ${k};
  }
  S.field.dispose();
  S.field.live.clear();
  S.field.queue.length = 0;
  S.field.dirty = true;
  const dir = S.craft.surf.frame.up;
  S.field.update(dir);
  for (let i = 0; i < 8000 && S.field.queue.length; i++) S.field.update(dir);
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  for (let i = 0; i < 6; i++) await frame();
  return { leaves: S.field.live.size };
})()`;

/* Probe meshes in front of the camera. Built once, then toggled with
   setEnabled inside the pairs — toggling is cheap and identical in both
   directions, which is what makes an A/B pair honest. Positions are kept on
   window so every probe sees the same layout. */
const MAKE_POS = `(() => {
  const S = window.SURVEYOR;
  if (window.__POS) return { ok: true };
  const cam = S.cam.camera;
  const f = cam.getForwardRay().direction;
  const up = { x: 0, y: 1, z: 0 };
  const rx = f.y * up.z - f.z * up.y, ry = f.z * up.x - f.x * up.z, rz = f.x * up.y - f.y * up.x;
  const rl = Math.hypot(rx, ry, rz) || 1;
  const pos = [];
  let s = 12345;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < 2000; i++) {
    const d = 30 + rnd() * 220, side = (rnd() - 0.5) * d * 0.9, lift = 4 + rnd() * 30;
    pos.push([
      cam.position.x + f.x * d + (rx / rl) * side,
      cam.position.y + f.y * d + (ry / rl) * side + lift,
      cam.position.z + f.z * d + (rz / rl) * side,
    ]);
  }
  window.__POS = pos;
  return { ok: true };
})()`;

/* 12-triangle boxes: the geometry is nothing, so what the ramp isolates is the
   per-draw and per-material-switch overhead. */
const ADD_DRAWS = (n, uniqueMats) => `(() => {
  const S = window.SURVEYOR;
  const mat0 = new BABYLON.StandardMaterial('probe', S.scene);
  mat0.disableLighting = true;
  mat0.emissiveColor = new BABYLON.Color3(0.35, 0.55, 0.45);
  mat0.freeze();
  const made = [mat0];
  const meshes = [];
  const box = BABYLON.MeshBuilder.CreateBox('probeBox', { size: 2.5 }, S.scene);
  box.isPickable = false;
  box.renderingGroupId = 1;
  for (let i = 0; i < ${n}; i++) {
    const m = i === 0 ? box : box.clone('probeBox' + i);
    const p = window.__POS[i % window.__POS.length];
    m.position.set(p[0], p[1], p[2]);
    if (${uniqueMats}) {
      const mm = mat0.clone('probeMat' + i);
      mm.emissiveColor = new BABYLON.Color3(0.3 + (i % 7) * 0.05, 0.5, 0.4);
      mm.freeze();
      m.material = mm;
      made.push(mm);
    } else {
      m.material = mat0;
    }
    m.freezeWorldMatrix();
    meshes.push(m);
  }
  window.__PROBE = { meshes, mats: made };
  return { added: meshes.length };
})()`;

/* The instancing probe: the same ~200-triangle canopy-sized geometry at the
   same 1000 positions, carried three ways. THIS is the baked-vs-instanced
   evidence the roadmap asks for:
     thin    one mesh, one draw, a 16-float matrix per copy
     merged  one mesh, one draw, every triangle baked in — what flora.js does
     clones  1000 meshes, 1000 draws — the naive scatter
   All three under one frozen unlit StandardMaterial, so the only variable is
   how the geometry reaches the GPU. */
const ADD_MODELS = (mode) => `(() => {
  const S = window.SURVEYOR;
  const N = 1000;
  const mat = new BABYLON.StandardMaterial('probeM', S.scene);
  mat.disableLighting = true;
  mat.emissiveColor = new BABYLON.Color3(0.3, 0.5, 0.42);
  mat.freeze();
  const src = BABYLON.MeshBuilder.CreateSphere('probeSrc',
    { segments: 7, diameter: 5 }, S.scene);
  src.material = mat;
  src.isPickable = false;
  src.renderingGroupId = 1;
  const tris = src.getTotalIndices() / 3;
  const pos = window.__POS;
  const meshes = [src];
  let active = meshes;                 // which of them the pair toggling drives
  if ('${mode}' === 'thin') {
    const m = new Float32Array(16 * N);
    for (let i = 0; i < N; i++) {
      const p = pos[i % pos.length];
      BABYLON.Matrix.Translation(p[0], p[1], p[2]).copyToArray(m, i * 16);
    }
    src.thinInstanceSetBuffer('matrix', m, 16, true);
  } else if ('${mode}' === 'merged') {
    const parts = [];
    for (let i = 0; i < N; i++) {
      const c = src.clone('probeC' + i);
      const p = pos[i % pos.length];
      c.position.set(p[0], p[1], p[2]);
      parts.push(c);
    }
    src.setEnabled(false);
    const merged = BABYLON.Mesh.MergeMeshes(parts, true, true);
    merged.material = mat;
    merged.isPickable = false;
    merged.renderingGroupId = 1;
    merged.freezeWorldMatrix();
    meshes.push(merged);
    active = [merged];                 // the disabled source must stay disabled
  } else {
    for (let i = 0; i < N; i++) {
      const c = i === 0 ? src : src.clone('probeC' + i);
      const p = pos[i % pos.length];
      c.position.set(p[0], p[1], p[2]);
      c.freezeWorldMatrix();
      if (i > 0) meshes.push(c);
    }
  }
  window.__PROBE = { meshes, active, mats: [mat] };
  return { n: N, trisEach: tris, total: tris * N };
})()`;

const TOGGLE_PROBE = (on) => `(() => {
  if (!window.__PROBE) return { ok: false };
  for (const m of window.__PROBE.active || window.__PROBE.meshes) m.setEnabled(${on});
  return { ok: true };
})()`;

const CLEAR_PROBE = `(() => {
  if (window.__PROBE) {
    for (const m of window.__PROBE.meshes) m.dispose();
    for (const m of window.__PROBE.mats) m.dispose();
    window.__PROBE = null;
  }
  return { ok: true };
})()`;

/* Texture memory, estimated: width x height x 4 bytes, x1.33 with mips. An
   estimate is enough to know whether this is 20MB or 400MB. */
const TEXMEM = `(() => {
  const S = window.SURVEYOR;
  let bytes = 0, n = 0;
  const rows = [];
  for (const t of S.scene.textures) {
    const s = t.getSize();
    if (!s.width) continue;
    const b = s.width * s.height * 4 * (t.generateMipMaps ? 1.33 : 1);
    bytes += b; n++;
    rows.push({ name: (t.name || '?').split('/').pop().slice(0, 40), mb: +(b / 1048576).toFixed(1) });
  }
  rows.sort((a, b) => b.mb - a.mb);
  return { n, mb: +(bytes / 1048576).toFixed(1), top: rows.slice(0, 8) };
})()`;

// ---- the run ---------------------------------------------------------------

const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const bound = (r) => Math.max(r.cpu, r.gpu ?? 0);
const sgn = (x, d = 2) => (x >= 0 ? '+' : '') + x.toFixed(d);
const fmt = (r) => `cpu ${r.cpu.toFixed(2)}  gpu ${r.gpu == null ? 'n/a ' : r.gpu.toFixed(2)}  ` +
  `wall ${r.wall.toFixed(2)} (p95 ${r.wallP95.toFixed(2)})`;

const { server, port, close: closeServer } = await serve(SITE);
const chrome = await launch({ width: 900, height: 560, port: PORT, gpu: true });

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
  { width: 900, height: 560, deviceScaleFactor: 1, mobile: false });
await page.send('Page.navigate', { url: `http://127.0.0.1:${port}${GAME}?planet=home` });

const ready = await evaluate(page, READY);
if (!ready.ok) {
  console.log('FAILED: the game never became ready');
  process.exit(1);
}
console.log(`${chrome.version}`);
console.log(`renderer: ${ready.renderer}`);
console.log(`timer queries: ${ready.timerQuery}, canvas ${ready.width}x${ready.height}`);
if (/swiftshader/i.test(ready.renderer)) {
  console.log('\nREFUSING TO MEASURE: this is SwiftShader. A budget needs the real');
  console.log('adapter — check --use-angle=d3d11 reached Chrome, or set CHROME=.');
  await chrome.close(); closeServer(); server.unref();
  process.exit(1);
}

const spun = await evaluate(page, SPIN(4000));
console.log(`clock warm-up: ${spun.frames} frames over 4s\n`);

/* Every comparison below runs as interleaved pairs: prepare A, measure, prepare
   B, measure, PAIRS times over; the reported delta is the median of per-pair
   differences and the spread is their range. Drift cancels because both halves
   of a pair run back to back under the same conditions. */
async function paired(prepA, prepB, frames = FRAMES, pairs = PAIRS) {
  const d = { cpu: [], gpu: [], wall: [], bound: [] };
  let a0 = null, b0 = null;
  for (let i = 0; i < pairs; i++) {
    if (prepA) await prepA();
    const a = await evaluate(page, TIME(frames));
    if (prepB) await prepB();
    const b = await evaluate(page, TIME(frames));
    a0 = a; b0 = b;
    d.cpu.push(b.cpu - a.cpu);
    d.wall.push(b.wall - a.wall);
    d.bound.push(bound(b) - bound(a));
    if (a.gpu != null && b.gpu != null) d.gpu.push(b.gpu - a.gpu);
  }
  return {
    a: a0, b: b0,
    dCpu: med(d.cpu), dWall: med(d.wall), dBound: med(d.bound),
    dGpu: d.gpu.length ? med(d.gpu) : null,
    spread: Math.max(...d.bound) - Math.min(...d.bound),
  };
}
const line = (name, p) =>
  console.log(`  ${name.padEnd(26)} ${sgn(p.dBound)}ms bound  ` +
    `(cpu ${sgn(p.dCpu)}, gpu ${p.dGpu == null ? 'n/a' : sgn(p.dGpu)}, ` +
    `wall ${sgn(p.dWall)}; spread ${p.spread.toFixed(2)})`);

// The scene as authored.
const base = await evaluate(page, COUNT);
console.log(`HOME AS AUTHORED  ${base.blades} plants, ${base.terrainTris} terrain tris, ` +
  `${base.drawCalls} draw calls, ${base.leaves} leaves, ${base.enabledMeshes} meshes\n`);

// 1. The floor: A/A — the same scene against itself, through the pair machinery.
const aa = await paired(null, null);
const floor = Math.max(Math.abs(aa.dBound), aa.spread / 2);
console.log('FLOOR — A/A control, must read ~0:');
line('same scene twice', aa);
console.log(`  floor: ${floor.toFixed(2)}ms — no delta inside this is a finding\n`);

// ...and the rebuild control: rebuild-to-rebuild, because the vegetation ramp
// compares across rebuilds and rebuild motion is part of its floor.
const rbc = await paired(
  () => evaluate(page, RAMP(1)),
  () => evaluate(page, RAMP(1)),
);
const rampFloor = Math.max(floor, Math.abs(rbc.dBound), rbc.spread / 2);
console.log('REBUILD CONTROL — vegetation on -> on, must read ~0:');
line('rebuild vs rebuild', rbc);
console.log(`  ramp floor: ${rampFloor.toFixed(2)}ms\n`);

// 2. The baseline levels, for headroom arithmetic.
const level560 = await evaluate(page, TIME(FRAMES));
console.log(`LEVEL at 900x560:   ${fmt(level560)}`);

// 3. Resolution, paired: 900x560 against 1600x900 (2.9x the pixels).
const setRes = (w, h) => async () => {
  await page.send('Emulation.setDeviceMetricsOverride',
    { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await evaluate(page, '(() => { window.SURVEYOR.scene.getEngine().resize(); return 1; })()');
};
const res = await paired(setRes(900, 560), setRes(1600, 900));
await setRes(900, 560)();
console.log(`LEVEL at 1600x900:  ${fmt(res.b)}`);
line('1600x900 over 900x560', res);
console.log('');

// 4. The vegetation ramp, through the real path. Draw calls must not move.
console.log('VEGETATION RAMP — perLeaf x k, real stack, real rebuild, paired vs x1:');
console.log('  k   plants   terrain tris   draws   delta(bound)  gpu     spread');
const ramp = [];
for (const k of [2, 4, 8]) {
  let countK = null, leavesA = null, leavesB = null;
  const p = await paired(
    async () => { const r = await evaluate(page, RAMP(1)); leavesA = r.leaves; },
    async () => {
      const r = await evaluate(page, RAMP(k)); leavesB = r.leaves;
      countK = await evaluate(page, COUNT);
    },
  );
  const same = leavesA === leavesB;
  ramp.push({ k, count: countK, p, same });
  console.log(`  ${k}  ${String(countK.blades).padStart(7)}  ` +
    `${String(countK.terrainTris).padStart(12)}  ${String(countK.drawCalls).padStart(6)}  ` +
    `${sgn(p.dBound).padStart(9)}ms  ${(p.dGpu == null ? 'n/a' : sgn(p.dGpu)).padStart(6)}  ` +
    `${p.spread.toFixed(2).padStart(6)}` +
    (same ? '' : `  LEAVES DIFFER ${leavesA} vs ${leavesB} — not comparable`));
}
await evaluate(page, RAMP(1));
const hi = ramp[ramp.length - 1];
const dTris = hi.count.terrainTris - base.terrainTris;
const per100k = hi.p.dBound / (dTris / 100000);
const vegLine = hi.p.dBound <= rampFloor
  ? `the x8 ramp (+${dTris} tris) stayed inside the ${rampFloor.toFixed(2)}ms floor`
  : `+${dTris} tris cost ${hi.p.dBound.toFixed(2)}ms -> ${per100k.toFixed(3)}ms per 100k tris`;
console.log(`  ${vegLine}\n`);

// 5. The draw-call and material ramps, toggled inside the pairs.
console.log('DRAW CALL RAMP — 12-tri boxes, so the geometry is nothing:');
await evaluate(page, MAKE_POS);
const drawRes = {};
for (const [tag, n, uniq] of [['shared500', 500, false], ['unique500', 500, true]]) {
  await evaluate(page, ADD_DRAWS(n, uniq));
  drawRes[tag] = await paired(
    () => evaluate(page, TOGGLE_PROBE(false)),
    () => evaluate(page, TOGGLE_PROBE(true)),
  );
  await evaluate(page, CLEAR_PROBE);
  line(`+${n} draws ${uniq ? '(unique mats)' : '(one mat)'}`, drawRes[tag]);
}
const perDraw = drawRes.shared500.dBound / 500 * 1000;
const matPrem = drawRes.unique500.dBound - drawRes.shared500.dBound;
console.log(`  per draw: ${perDraw.toFixed(1)}us` +
  (drawRes.shared500.dBound <= floor ? ' (inside the floor at +500 — an upper bound)' : '') +
  `; 500 unique materials over 500 shared: ${sgn(matPrem)}ms` +
  (Math.abs(matPrem) <= floor ? ' (inside the floor)' : '') + '\n');

// 6. Thin instances vs merged vs clones, same geometry, same positions.
console.log('INSTANCING PROBE — 1000 copies of a ~200-tri solid, three ways:');
const inst = {};
for (const mode of ['thin', 'merged', 'clones']) {
  const info = await evaluate(page, ADD_MODELS(mode));
  inst[mode] = { info, p: await paired(
    () => evaluate(page, TOGGLE_PROBE(false)),
    () => evaluate(page, TOGGLE_PROBE(true)),
  ) };
  await evaluate(page, CLEAR_PROBE);
  line(`${mode} (${info.total} tris)`, inst[mode].p);
}
console.log('');

// 7. Texture memory.
const tex = await evaluate(page, TEXMEM);
console.log(`TEXTURE MEMORY — ${tex.n} textures, ~${tex.mb}MB estimated:`);
for (const r of tex.top) console.log(`  ${String(r.mb).padStart(7)}MB  ${r.name}`);
console.log('');

// ---- the budget, derived ----------------------------------------------------

const target = 16.67;
const b560 = bound(level560), b900 = bound(res.b);
console.log('==== THE BUDGET, ON THIS MACHINE =========================================');
console.log(`machine:  ${ready.renderer}`);
console.log(`floor:    ${floor.toFixed(2)}ms same-scene, ${rampFloor.toFixed(2)}ms across a rebuild`);
console.log(`Home now: ${b560.toFixed(2)}ms bound at 900x560 ` +
  `(cpu ${level560.cpu.toFixed(2)}, gpu ${level560.gpu == null ? 'n/a' : level560.gpu.toFixed(2)}), ` +
  `${b900.toFixed(2)}ms at 1600x900`);
console.log(`headroom to 60fps: ${(target - b560).toFixed(1)}ms at 900x560, ` +
  `${(target - b900).toFixed(1)}ms at 1600x900`);
if (hi.p.dBound > rampFloor) {
  console.log(`triangles: ~${per100k.toFixed(3)}ms per 100k baked veg tris -> ` +
    `~${(((target - b900) / per100k) / 10).toFixed(0)}0k more fit at 1600x900`);
} else {
  console.log(`triangles: +${dTris} baked veg tris never left the ` +
    `${rampFloor.toFixed(2)}ms floor — geometry at this scale is not the constraint`);
}
console.log(`draw calls: ~${perDraw.toFixed(1)}us each` +
  (drawRes.shared500.dBound <= floor ? ' (upper bound)' : ''));
console.log(`instancing, 200k tris in view: thin ${sgn(inst.thin.p.dBound)}ms, ` +
  `merged ${sgn(inst.merged.p.dBound)}ms, 1000 clones ${sgn(inst.clones.p.dBound)}ms`);
for (const e of errs) console.log(`! ${e}`);
if (!errs.length) console.log('no console errors, no exceptions');

await chrome.close();
closeServer();
server.unref();
