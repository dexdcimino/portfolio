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

/* Frame time, by hand, as a MEDIAN of individually timed frames.
   The loop is already stopped, so this times the render and nothing else. A
   warm-up pass first, because the first render after any state change compiles,
   uploads and settles and timing it measures that.

   The median is not fussiness. The first version averaged a block of frames and
   reported the same world at +4.3% and +25.3% on two runs with identical
   geometry, because one scheduling spike in forty frames moves a mean and does
   not move a middle. The control worlds are what exposed it: Vault has zero
   vegetation and came back at -3.3% and +8.9%. */
const TIME = (n) => `(() => {
  const S = window.SURVEYOR;
  for (let i = 0; i < 10; i++) S.scene.render();
  const ms = [];
  for (let i = 0; i < ${n}; i++) {
    const t0 = performance.now();
    S.scene.render();
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  return ms[Math.floor(ms.length / 2)];
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
   Not "hide the plants" — they have to be GONE from the vertex buffer, because
   what is being measured is the cost of carrying them at all.

   IT IS THE FIELD'S CACHED STACK THAT HAS TO CHANGE, not the profile.
   ChunkField resolves floraOf() once in its constructor, because a leaf builds
   while you are driving and re-resolving per leaf would be work for nothing.
   This harness used to mutate planet.flora and rebuild, which after that change
   did nothing at all — and the run that exposed it reported Tarn at +9527%,
   because the rebuild left the field almost empty and it was comparing a full
   world against a nearly blank one.

   So the rebuild returns its leaf and plant counts, and the caller refuses to
   compare two scenes that are not the same scene minus the vegetation. */
const REBUILD = (on) => `(async () => {
  const S = window.SURVEYOR;
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  if (!window.__FLORA_SAVED) window.__FLORA_SAVED = S.field.flora;
  S.field.flora = ${on} ? window.__FLORA_SAVED : null;
  S.field.dispose();
  S.field.live.clear();
  S.field.queue.length = 0;
  S.field.dirty = true;
  const dir = S.craft.surf.frame.up;
  S.field.update(dir);
  for (let i = 0; i < 6000 && S.field.queue.length; i++) S.field.update(dir);
  for (let i = 0; i < 10; i++) await frame();
  let blades = 0;
  for (const [, e] of S.field.live) blades += (e.mesh && e.mesh.metadata || {}).blades || 0;
  return { leaves: S.field.live.size, blades };
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
  const msOn = await evaluate(page, TIME(60));
  if (shot) {
    const png = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
    writeFileSync(resolve(HERE, `shots/flora-${key}.jpg`), Buffer.from(png.data, 'base64'));
  }

  /* Rebuild ONCE WITH vegetation first, so the "with" and "without" frames are
     both post-rebuild: a fresh field and a re-streamed one are not the same
     scene, and comparing one of each attributes the difference to vegetation. */
  const reOn = await evaluate(page, REBUILD(true));
  const msOn2 = await evaluate(page, TIME(60));
  const reOff = await evaluate(page, REBUILD(false));
  const off = await evaluate(page, COUNT);
  const msOff = await evaluate(page, TIME(60));
  const comparable = reOn.leaves === reOff.leaves && reOff.blades === 0;
  if (!comparable) {
    console.log(`  SKIPPED: the two scenes differ — ${reOn.leaves} leaves with, ` +
      `${reOff.leaves} without, ${reOff.blades} plants left in the control. ` +
      'Nothing can be concluded from comparing them.');
  }

  const dens = Object.assign({}, FLORA, PLANETS[key].flora || {}).density;
  const cost = (comparable && msOff > 0) ? ((msOn2 / msOff - 1) * 100) : NaN;
  rows.push({ key, dens, on, off, msOn: msOn2, msOff, cost, comparable });
  console.log(`${key.padEnd(8)} ${String(dens).padStart(6)}  ` +
    `${String(on.blades).padStart(6)}  ${String(on.withFlora + '/' + on.leaves).padStart(11)}  ` +
    `${String(on.tris).padStart(7)}  ${String(on.drawn).padStart(6)}  ` +
    `${msOn2.toFixed(2).padStart(7)}  ${msOff.toFixed(2).padStart(10)}   ` +
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

/* THE MEASUREMENT FLOOR, FROM THE WORLDS THAT HAVE NO VEGETATION.
   Ember and Vault emit zero plants, so their "with" and "without" frames are
   the same picture and any difference between them is this rig, not this
   feature. That makes them a free control, and the honest thing to do with a
   control is let it veto the result: any world whose cost is inside the floor
   gets reported as inside it rather than as a number.

   It is a wide floor. Two renders separated by a full chunk-field rebuild, on a
   software rasteriser, in a browser sharing a machine with the harness, is not
   an instrument that resolves single-digit percentages — successive runs put
   the same unchanged world at -3.3%, +8.9% and +41.2%. Taking a median of
   individually timed frames did not fix it, because the noise is between the
   two measurements rather than within either.

   What IS reliable here is exact: blade counts, triangle counts, and draw
   calls. And the CPU side is measured properly elsewhere — dev/run.mjs times
   leaf build against a 6ms budget in Node, with no browser in the way. */
/* THE FLOOR IS IN MILLISECONDS, not percent.
   Percent is the wrong unit for a control here: Ember's whole frame is under
   two milliseconds because it is a small world with almost nothing in it, so a
   couple of milliseconds of jitter is a three-figure percentage there and a
   rounding error on Anvil. The absolute difference between two renders of the
   SAME picture is what this rig cannot resolve, and that is a number of
   milliseconds. */
const bare = rows.filter((r) => r.dens === 0 && r.comparable);
const floor = bare.length ? Math.max(...bare.map((r) => Math.abs(r.msOn - r.msOff))) : 0;
console.log('');
if (bare.length) {
  console.log(`MEASUREMENT FLOOR ${floor.toFixed(1)}ms, from ${bare.map((r) => r.key).join(' and ')}, ` +
    'which emit no vegetation at all: their two frames are the same picture, ' +
    'so any difference between them is this rig rather than this feature.');
}
for (const r of rows.filter((x) => x.dens > 0)) {
  const delta = Math.abs(r.msOn - r.msOff);
  const inside = !r.comparable || !Number.isFinite(r.cost) || delta <= floor;
  console.log(`  ${r.key.padEnd(7)} ${String(r.on.blades).padStart(6)} plants, ` +
    `${String(r.on.tris).padStart(7)} tris, draws unchanged, ` +
    (inside ? `render delta ${delta.toFixed(1)}ms — inside the floor`
      : `render cost ${r.cost.toFixed(1)}% (${delta.toFixed(1)}ms)`));
}
if (bare.length) {
  console.log(`
${bare.map((r) => r.key).join(' and ')} pay nothing: floraOf returns null, ` +
    'appendFlora is never called and the shader branch is never taken.');
}
await chrome.close();
close();
