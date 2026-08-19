// Does the LOD handoff pop?
//
//   node dev/lodcheck.mjs              home approaching each neighbour
//   node dev/lodcheck.mjs vault        from another world
//   node dev/lodcheck.mjs --shot       ...and write the frames either side
//
// A body in the far band is a billboard while it is small and a displaced
// sphere once it is not. Both are drawn at the same angle by construction —
// the sphere is scaled so its surface subtends exactly the angle the quad did —
// so the claim is that the swap is invisible. Claims like that have been wrong
// here before, so it is measured.
//
// WHY IT CANNOT JUST BE PLAYED. Travel is still an instant swap, so nothing in
// normal play ever gets within the 17km to 170km at which a world promotes: on
// the sky sheets every neighbour is 294km to 944km away and pinned at the
// drawFloor. The approach that would exercise this is phase 4. So the harness
// drives a body through the boundary by moving it, using discs.js's OWN
// setDistance and sizeDisc rather than a restatement of the compression — a
// restatement is how this project has produced three confident wrong
// measurements, and the compression is exactly the part under test.
//
// WHAT IS MEASURED. At each distance: which LOD is live, and the body's angular
// size on screen, isolated by rendering the frame twice with the far band shown
// and hidden and differencing. If the geometry is continuous across the
// boundary the measured size is too, and the step between the last billboard
// sample and the first sphere sample is the size of the pop.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { launch, serve, evaluate } from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../..');
const GAME = '/games/surveyor/';

const argv = process.argv.slice(2);
const shot = argv.includes('--shot');
const only = argv.filter((a) => !a.startsWith('--'));
const { PLANETS, SPACE } = await import('../js/tune.js');
const FROM = only[0] || 'home';

// How far either side of the boundary to walk, as a factor on the promotion
// distance. The step is deliberately fine near the crossing.
const STEPS = [3.0, 2.0, 1.4, 1.12, 1.02, 0.98, 0.9, 0.72, 0.5, 0.32];

// A pop is a jump in measured angular size that the geometry does not explain.
// The samples either side of the boundary are 4% apart in distance, so anything
// beyond a few percent of angular size is the swap and not the approach.
const POP_TOL = 0.06;

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
  for (let i = 0; i < 30; i++) await frame();
  const S = window.SURVEYOR;
  S.scene.getEngine().stopRenderLoop();
  for (const ps of S.scene.particleSystems.slice()) { ps.stop(); ps.reset(); }
  S.scene.animationsEnabled = false;
  S.cam.update = () => {};
  // The ground is not the subject and its fog and horizon only get in the way.
  S.world.field.dispose();
  for (const m of S.scene.meshes) {
    if (m.name !== 'sky' && m.name !== 'discs' && !m.name.startsWith('far_')) {
      m.setEnabled(false);
    }
  }
  return { ok: true, promoteAngle: ${SPACE.promoteAngle} };
})()`;

/* Move one body to a true distance and aim at it. Uses the game's own
   setDistance so the compression under test is the shipped one. */
const PLACE = (key, dist) => `(async () => {
  const S = window.SURVEYOR, V = BABYLON.Vector3;
  const { setDistance } = await import('/games/surveyor/js/world/discs.js');
  const { makePlanet } = await import('/games/surveyor/js/world/sphere.js');
  const { PLANETS } = await import('/games/surveyor/js/tune.js');
  const d = S.discs.list.find((x) => x.key === ${JSON.stringify(key)});
  if (!d) return null;
  const R = makePlanet(PLANETS[${JSON.stringify(key)}]).radius;
  setDistance(S.planet, d, R, ${dist});

  const c = S.cam.camera;
  const dir = new V(d.dir.x, d.dir.y, d.dir.z).normalize();
  let up = new V(0, 1, 0);
  up = up.subtract(dir.scale(V.Dot(up, dir)));
  if (up.length() < 1e-3) up = V.Cross(dir, new V(1, 0, 0));
  c.upVector.copyFrom(up.normalize());
  c.setTarget(c.position.add(dir.scale(500)));
  S.discs.update(c);
  S.scene.render();
  return {
    dist: Math.round(d.dist),
    trueDeg: +(d.angle * 360 / Math.PI).toFixed(4),
    drawnDeg: +(d.drawAngle * 360 / Math.PI).toFixed(4),
    drawAngle: d.drawAngle,
    drawnAt: Math.round(d.K),
    promoted: S.discs.promoted.has(${JSON.stringify(key)}),
    hasBody: S.discs.bodies.has(${JSON.stringify(key)}),
  };
})()`;

/* The body on screen, isolated: render with the far band shown and hidden and
   difference. Post off, because the bloom around a bright body spreads far
   enough to swamp the thing being measured — that lesson is written into
   dev/disccheck.mjs and it applies unchanged here. */
const MEASURE = (key) => `(() => {
  const S = window.SURVEYOR, eng = S.scene.getEngine(), gl = eng._gl;
  const w = eng.getRenderWidth(), h = eng.getRenderHeight();
  const post = S.post, wasPost = post ? post.enabled : false;
  if (post) post.setEnabled(false);
  const body = S.discs.bodies.get(${JSON.stringify(key)});
  const discs = S.discs.mesh;
  for (let i = 0; i < 4; i++) S.scene.render();
  const grab = () => { const b = new Uint8Array(w * h * 4);
    S.scene.render(); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
  const on = grab();
  if (body) body.mesh.setEnabled(false);
  discs.setEnabled(false);
  const off = grab();
  if (body) body.mesh.setEnabled(S.discs.promoted.has(${JSON.stringify(key)}));
  discs.setEnabled(true);
  const again = grab();
  if (post) post.setEnabled(wasPost);

  /* Area, not a bounding box. A bounding box measures the outliers, which on a
     body wrapped in a halo is the halo. The diameter of a circle of the same
     area is what a body's angular size means. */
  const count = (A, B, cut) => {
    let n = 0, r = 0, g = 0, b = 0;
    for (let i = 0; i < A.length; i += 4) {
      const dd = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]),
        Math.abs(A[i + 2] - B[i + 2]));
      if (dd > cut) { n++; r += A[i]; g += A[i + 1]; b += A[i + 2]; }
    }
    // The body's own mean colour, not the difference's: SIZE agreeing across the
    // handoff says the two LODs are the same size, and says nothing about them
    // being the same picture. A dark sphere and a bright quad of equal area
    // would pass a size test and pop violently.
    return { n, rgb: n ? [r / n, g / n, b / n] : [0, 0, 0] };
  };
  const solidC = count(on, off, 40);
  const solid = solidC.n;
  const noise = count(on, again, 3).n;
  const perPx = eng.getRenderHeight() ? (S.cam.camera.fov / h * 180 / Math.PI) : 0;
  return {
    px: solid,
    deg: +(2 * Math.sqrt(solid / Math.PI) * perPx).toFixed(3),
    lum: +(0.2126 * solidC.rgb[0] + 0.7152 * solidC.rgb[1] + 0.0722 * solidC.rgb[2]).toFixed(1),
    noise,
  };
})()`;

const { port, close } = await serve(SITE);
const chrome = await launch({ width: 900, height: 560 });
console.log(`${chrome.version}\n`);
console.log(`FROM ${FROM.toUpperCase()}, promotion at drawn half-angle ${SPACE.promoteAngle} ` +
  `(${(SPACE.promoteAngle * 360 / Math.PI).toFixed(1)} deg across)\n`);

let bad = 0;
const targets = Object.keys(PLANETS).filter((k) => k !== FROM);
for (const key of targets) {
  const page = await chrome.newPage();
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride',
    { width: 900, height: 560, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.navigate', { url: `http://127.0.0.1:${port}${GAME}?planet=${FROM}&tier=high` });
  const r = await evaluate(page, READY);
  if (!r.ok) { console.log(`${key}: never ready`); bad++; await page.close(); continue; }

  // The distance at which this body promotes, found with the real function.
  const probe = await evaluate(page, PLACE(key, 1e6));
  if (!probe) { console.log(`${key}: not a neighbour`); await page.close(); continue; }
  let lo = 1e3, hi = 4e6;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const p = await evaluate(page, `(async () => {
      const S = window.SURVEYOR;
      const { setDistance } = await import('/games/surveyor/js/world/discs.js');
      const { makePlanet } = await import('/games/surveyor/js/world/sphere.js');
      const { PLANETS } = await import('/games/surveyor/js/tune.js');
      const d = S.discs.list.find((x) => x.key === ${JSON.stringify(key)});
      const R = makePlanet(PLANETS[${JSON.stringify(key)}]).radius;
      setDistance(S.planet, d, R, ${mid});
      return d.drawAngle;
    })()`);
    if (p >= SPACE.promoteAngle) lo = mid; else hi = mid;
  }
  const boundary = (lo + hi) / 2;

  console.log(`${key.padEnd(7)} promotes at ${(boundary / 1000).toFixed(1)}km`);
  console.log('   distance    true°   drawn°   drawn at      LOD   on screen°   lum   step');
  let prev = null, prevLod = null, prevLum = 0;
  for (const f of STEPS) {
    const info = await evaluate(page, PLACE(key, boundary * f));
    const m = await evaluate(page, MEASURE(key));
    const lod = info.promoted ? 'sphere' : 'quad';
    let step = '';
    if (prev && m.deg > 0 && prev > 0) {
      const rel = Math.abs(m.deg - prev) / prev;
      const crossing = prevLod && prevLod !== lod;
      step = (rel * 100).toFixed(1) + '%';
      if (crossing) {
        // Brightness across the handoff, on the same footing as size.
        const dl = prevLum > 0 ? Math.abs(m.lum - prevLum) / prevLum : 0;
        const popped = rel > POP_TOL || dl > POP_TOL;
        step += popped ? `  <-- POP (size ${(rel * 100).toFixed(1)}%, light ${(dl * 100).toFixed(1)}%)`
          : `  (the handoff, light ${(dl * 100).toFixed(1)}%)`;
        if (popped) bad++;
      }
    }
    console.log(`   ${String((boundary * f / 1000).toFixed(1) + 'km').padStart(8)}` +
      ` ${String(info.trueDeg).padStart(8)} ${String(info.drawnDeg).padStart(8)}` +
      ` ${String(info.drawnAt + 'm').padStart(9)} ${lod.padStart(8)}` +
      ` ${String(m.deg).padStart(11)} ${String(m.lum).padStart(6)}   ${step}`);
    if (shot && (f === 1.02 || f === 0.98)) {
      /* PNG, so .gitignore's `dev/shots/*.png` rule covers them. These are
         diagnostic frames from a harness that regenerates them in a command;
         the .jpg contact sheets are kept because they are the reference. */
      const png = await page.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(resolve(HERE, `shots/lod-${FROM}-${key}-${f === 1.02 ? 'quad' : 'sphere'}.png`),
        Buffer.from(png.data, 'base64'));
    }
    prev = m.deg; prevLod = lod; prevLum = m.lum;
  }
  console.log('');
  await page.close();
}

console.log(bad
  ? `FAIL: the handoff pops on ${bad} body/bodies.`
  : `The handoff is within ${(POP_TOL * 100).toFixed(0)}% of angular size on every body.`);
await chrome.close();
close();
process.exitCode = bad ? 1 : 0;
