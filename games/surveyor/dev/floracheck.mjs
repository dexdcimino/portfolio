// What does vegetation cost, and how much of it is there?
//
//   node dev/floracheck.mjs            all six, on and off
//   node dev/floracheck.mjs home tarn  just these
//   node dev/floracheck.mjs --gpu      on the real adapter rather than SwiftShader
//
// THE BIGGEST FRAME-COST RISK IN THE ROADMAP, so it gets measured rather than
// asserted. Vegetation here is baked into the terrain chunk's vertex buffer, so
// there is no draw call and no per-frame CPU: the entire cost is vertices and
// the fragments they cover. That makes the two numbers that matter the blade
// count and the frame time, and it makes DRAW CALLS a thing to prove has not
// changed rather than a thing to reduce.
//
// The frame time is measured by rendering a fixed number of frames by hand and
// timing them, with the game loop stopped so nothing else is competing. It is
// then measured AGAIN with the vegetation gone, from the same camera on the
// same streamed world, by rebuilding the field with density forced to zero.
// Same ground, same sky, same post stack, one variable.
//
// SwiftShader by default, like the rest of dev/. A software rasteriser is the
// wrong absolute number and the right relative one: it is fill-rate bound in a
// way a real GPU is not, so it OVERSTATES what extra triangles covering extra
// pixels cost, which is the conservative direction for a budget decision. Pass
// --gpu for the real adapter and report both.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { launch, serve, evaluate } from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../..');
const GAME = '/games/surveyor/';

const argv = process.argv.slice(2);
const gpu = argv.includes('--gpu');
const shot = argv.includes('--shot');
const only = argv.filter((a) => !a.startsWith('--'));
const { PLANETS, FLORA } = await import('../js/tune.js');
const KEYS = Object.keys(PLANETS).filter((k) => !only.length || only.includes(k));

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
  document.getElementById('begin').click();
  document.getElementById('hud').style.visibility = 'hidden';
  for (let i = 0; i < 40; i++) await frame();
  const S = window.SURVEYOR;
  S.scene.getEngine().stopRenderLoop();
  for (const ps of S.scene.particleSystems.slice()) { ps.stop(); ps.reset(); }
  S.scene.animationsEnabled = false;
  S.cam.update = () => {};
  return { ok: true };
})()`;

/* Count what is on the ground, from the chunk metadata rather than by walking
   vertex buffers: chunks.js records the blade count and the vertex count as it
   builds, which is the only place either is known for certain. */
const COUNT = `(() => {
  const S = window.SURVEYOR;
  let blades = 0, verts = 0, leaves = 0, withFlora = 0;
  for (const [, e] of S.field.live) {
    const m = e.mesh && e.mesh.metadata;
    leaves++;
    if (!m) continue;
    verts += m.verts;
    blades += m.blades;
    if (m.blades > 0) withFlora++;
  }
  const drawn = S.scene.meshes.filter((x) => x.isEnabled()).length;
  return { blades, verts, leaves, withFlora, drawn,
    tris: Math.round(verts / 3) };
})()`;

/* Frame time, by hand. The loop is already stopped, so this times exactly the
   render and nothing else. A warm-up pass first: the first render after any
   state change compiles, uploads and settles, and timing it measures that. */
const TIME = (n) => `(() => {
  const S = window.SURVEYOR;
  for (let i = 0; i < 8; i++) S.scene.render();
  const t0 = performance.now();
  for (let i = 0; i < ${n}; i++) S.scene.render();
  return (performance.now() - t0) / ${n};
})()`;

/* DOES THE WIND ACTUALLY MOVE ANYTHING?
   A still frame cannot answer it and the brief puts movement ahead of density,
   so it is measured: render the same frame at two values of uTime and count the
   pixels that changed. The loop is stopped and the particle systems are off, so
   the only thing in the scene that can move is the vegetation.
   Reported as a percentage of the frame AND as a peak channel delta, because a
   thousand pixels changing by one level is not motion anyone can see. */
const WIND = `(() => {
  const S = window.SURVEYOR, eng = S.scene.getEngine(), gl = eng._gl;
  const w = eng.getRenderWidth(), h = eng.getRenderHeight();
  const post = S.post, wasPost = post ? post.enabled : false;
  if (post) post.setEnabled(false);
  const at = (t) => {
    S.mats.terrain.setFloat('uTime', t);
    for (let i = 0; i < 2; i++) S.scene.render();
    const b = new Uint8Array(w * h * 4);
    S.scene.render();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
    return b;
  };
  const a = at(0.0);
  const b = at(1.9);          // most of a half-cycle at WIND.speed 1.15
  const again = at(0.0);      // ...and back, as the control
  if (post) post.setEnabled(wasPost);
  const count = (X, Y) => {
    let n = 0, peak = 0;
    for (let i = 0; i < X.length; i += 4) {
      const d = Math.max(Math.abs(X[i] - Y[i]), Math.abs(X[i + 1] - Y[i + 1]),
        Math.abs(X[i + 2] - Y[i + 2]));
      if (d > 6) n++;
      if (d > peak) peak = d;
    }
    return { pct: +(100 * n / (X.length / 4)).toFixed(2), peak };
  };
  return { moved: count(a, b), control: count(a, again) };
})()`;

/* Rebuild every live chunk with vegetation forced off, from the same camera.
   Not "hide the blades" — they have to be GONE from the vertex buffer, because
   what is being measured is the cost of carrying them at all. */
const REBUILD = (density) => `(async () => {
  const S = window.SURVEYOR;
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  S.planet.flora = Object.assign({}, S.planet.flora, { density: ${density} });
  S.field.dispose();
  S.field.live.clear();
  S.field.queue.length = 0;
  S.field.dirty = true;
  const dir = S.craft.surf.frame.up;
  S.field.update(dir);
  for (let i = 0; i < 4000 && S.field.queue.length; i++) S.field.update(dir);
  for (let i = 0; i < 10; i++) await frame();
  return S.field.live.size;
})()`;

const { port, close } = await serve(SITE);
const chrome = await launch({ width: 900, height: 560, gpu });
const renderer = gpu ? 'real adapter (ANGLE/D3D11)' : 'SwiftShader (software)';
console.log(`${chrome.version}\nrenderer: ${renderer}\n`);
console.log('world    density  blades  leaves(veg)   tris     draws   ms with   ms without   cost');

const rows = [];
for (const key of KEYS) {
  const page = await chrome.newPage();
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride',
    { width: 900, height: 560, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.navigate', { url: `http://127.0.0.1:${port}${GAME}?planet=${key}` });
  const r = await evaluate(page, READY);
  if (!r.ok) { console.log(`${key}: never ready`); await page.close(); continue; }

  const on = await evaluate(page, COUNT);
  const wind = await evaluate(page, WIND);
  const msOn = await evaluate(page, TIME(40));
  if (shot) {
    const png = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
    writeFileSync(resolve(HERE, `shots/flora-${key}.jpg`), Buffer.from(png.data, 'base64'));
  }

  await evaluate(page, REBUILD(0));
  const off = await evaluate(page, COUNT);
  const msOff = await evaluate(page, TIME(40));

  const dens = Object.assign({}, FLORA, PLANETS[key].flora || {}).density;
  const cost = msOff > 0 ? ((msOn / msOff - 1) * 100) : 0;
  rows.push({ key, dens, on, off, msOn, msOff, cost });
  console.log(`${key.padEnd(8)} ${String(dens).padStart(6)}  ` +
    `${String(on.blades).padStart(6)}  ${String(on.withFlora + '/' + on.leaves).padStart(11)}  ` +
    `${String(on.tris).padStart(7)}  ${String(on.drawn).padStart(6)}  ` +
    `${msOn.toFixed(2).padStart(7)}  ${msOff.toFixed(2).padStart(10)}   ` +
    `${((cost >= 0 ? '+' : '') + cost.toFixed(1) + '%').padStart(7)}   ` +
    `wind moves ${String(wind.moved.pct).padStart(5)}% of frame, peak ${wind.moved.peak}` +
    (wind.control.pct > 0.02 ? `  (CONTROL DIRTY: ${wind.control.pct}%)` : ''));
  if (dens > 0 && wind.moved.pct < 0.05) {
    console.log('  NOTE: the wind is not moving anything measurable on this world.');
  }

  if (on.drawn !== off.drawn) {
    console.log(`  NOTE: draw calls changed, ${off.drawn} -> ${on.drawn}. Vegetation is` +
      ' supposed to be free of those — it is baked into the terrain buffer.');
  }
  await page.close();
}

const worst = rows.filter((r) => r.dens > 0).sort((a, b) => b.cost - a.cost)[0];
console.log('');
if (worst) {
  console.log(`Worst case: ${worst.key} at ${worst.cost.toFixed(1)}% of frame time for ` +
    `${worst.blades || worst.on.blades} blades, and no extra draw calls.`);
}
const bare = rows.filter((r) => r.dens === 0);
if (bare.length) {
  console.log(`No vegetation at all on ${bare.map((r) => r.key).join(', ')} — ` +
    'appendFlora returns before it seeds an rng, so those pay nothing for the system.');
}
await chrome.close();
close();
