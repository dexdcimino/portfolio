// Is the bright thing in the sky at the sun's direction, or at the camera's?
//
//   node dev/sundisc.mjs                  all six
//   node dev/sundisc.mjs ember --shots    ...and write the frames
//
// "It follows the view" and "it is fixed in the sky and I keep turning toward
// it" produce the same complaint and want opposite fixes, so this measures the
// difference instead of arguing about it. For each world it points the camera
// at a series of AZIMUTHS AROUND THE LOCAL UP, and at each one it:
//
//   - projects the world's own sunDir through the camera to get the screen
//     position the disc SHOULD have, or "behind you" if it is off-screen
//   - finds the centroid of the brightest pixels actually in the frame
//   - reports both, and how far apart they are
//
// A world-positioned sun tracks the projection and vanishes when the projection
// says it is behind you. A screen-locked one sits at the same place in every
// row and never vanishes. One run tells you which.
//
// The post stack stays ON. Bloom is most of what a sun disc IS here — the sky
// shader writes it above 1.0 on purpose — so measuring with bloom off would be
// measuring something the player never sees.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { launch, serve, evaluate } from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../..');
const GAME = '/games/surveyor/';

const argv = process.argv.slice(2);
const keep = argv.includes('--shots');
const only = argv.filter((a) => !a.startsWith('--'));
const { PLANETS } = await import('../js/tune.js');
const KEYS = Object.keys(PLANETS).filter((k) => !only.length || only.includes(k));

// Degrees of azimuth away from the sun, around the local up. 0 is straight at
// it; 180 is straight away, where a world-positioned sun cannot be in frame.
const AZIMUTHS = [0, 60, 120, 180];

const SETUP = `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const t0 = performance.now();
  let drained = 0;
  while (performance.now() - t0 < 40000) {
    await frame();
    const S = window.SURVEYOR;
    if (!S) continue;
    drained = S.field.queue.length === 0 ? drained + 1 : 0;
    if (drained > 20) break;
  }
  const S = window.SURVEYOR;
  if (!S) return { ok: false };
  document.getElementById('begin').click();
  document.getElementById('hud').style.visibility = 'hidden';
  document.getElementById('start').style.display = 'none';
  for (let i = 0; i < 60; i++) await frame();
  /* THE LOOP IS STOPPED AND THE FRAME IS DRIVEN BY HAND, which is the only
     arrangement that gets all three requirements at once.
     Leaving the loop running means gl.readPixels comes back BLACK — the buffer
     has been swapped by the time the next task runs, on an engine with
     preserveDrawingBuffer false. Stopping it and only calling scene.render()
     means the game update never runs, and the sky discs are billboards rebuilt
     from the camera basis inside that update: they keep a stale basis and
     rasterise as edge-on ELLIPSES, which cost a round of investigation as a
     suspected defect before it turned out to be this harness.
     So: loop stopped, world.update and mats.update called explicitly, then
     render and read, all in one task. */
  S.scene.getEngine().stopRenderLoop();
  for (const ps of S.scene.particleSystems.slice()) { ps.stop(); ps.reset(); }
  S.scene.animationsEnabled = false;
  S.cam.update = () => {};
  const sd = S.mats.skyParams.sunDir;
  return { ok: true, sun: [sd[0], sd[1], sd[2]] };
})()`;

/* Aim at an azimuth measured from the sun, around the local up, holding a few
   degrees of elevation so the horizon stays in shot. */
const look = (deg) => `(() => {
  const S = window.SURVEYOR;
  const c = S.cam.camera;
  const V = BABYLON.Vector3;
  const up0 = S.surface.frame.up;
  const up = new V(up0.x, up0.y, up0.z).normalize();
  const sd = S.mats.skyParams.sunDir;
  const sun = new V(sd[0], sd[1], sd[2]).normalize();

  // The sun's direction flattened into the local horizon plane, and a second
  // axis at right angles to it — the frame azimuth is measured in.
  let f = sun.subtract(up.scale(V.Dot(sun, up)));
  if (f.length() < 1e-3) f = new V(1, 0, 0).subtract(up.scale(up.x));
  f = f.normalize();
  const r = V.Cross(up, f).normalize();
  const a = ${deg} * Math.PI / 180;
  const dir = f.scale(Math.cos(a)).add(r.scale(Math.sin(a)))
    .add(up.scale(0.28)).normalize();

  c.upVector.copyFrom(up);
  c.setTarget(c.position.add(dir.scale(500)));
  const fr = S.craft.surf.frame;
  S.world.update(1 / 60, S.craft, c);
  S.world.mats.update(1 / 60, c.position, S.craft.boostHeat,
    fr.up, fr.east, fr.north, S.craft.pos.y);
  S.scene.render();

  // Where the sun OUGHT to land, projected through this camera.
  const eng = S.scene.getEngine();
  const w = eng.getRenderWidth(), h = eng.getRenderHeight();
  const far = c.position.add(sun.scale(1e6));
  const p = BABYLON.Vector3.Project(far, BABYLON.Matrix.Identity(),
    S.scene.getTransformMatrix(), c.viewport.toGlobal(w, h));
  const fwd = c.getForwardRay().direction;
  const infront = BABYLON.Vector3.Dot(fwd, sun) > 0;
  return { want: infront ? [Math.round(p.x), Math.round(p.y)] : null };
})()`;

const MEASURE = `(() => {
  const S = window.SURVEYOR;
  const eng = S.scene.getEngine();
  const gl = eng._gl;
  const w = eng.getRenderWidth(), h = eng.getRenderHeight();
  const buf = new Uint8Array(w * h * 4);
  S.scene.render();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);

  // Brightest pixels, and where their weight sits. A threshold rather than a
  // peak, because bloom spreads a sun over hundreds of pixels and the single
  // brightest texel of that is noise. The cut is relative to the frame's OWN
  // maximum, so a pale world does not report its whole sky as a sun.
  const lum = new Float32Array(w * h);
  let max = 0;
  for (let i = 0, p = 0; i < buf.length; i += 4, p++) {
    const l = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
    lum[p] = l; if (l > max) max = l;
  }
  const cut = Math.max(160, max - 10);
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (lum[y * w + x] >= cut) { sx += x; sy += y; n++; }
    }
  }
  return {
    max: Math.round(max),
    bright: +(100 * n / (w * h)).toFixed(2),
    at: n ? [Math.round(sx / n), Math.round(h - sy / n)] : null,
  };
})()`;

const { port, close } = await serve(SITE);
const chrome = await launch({ width: 900, height: 560 });
console.log(`${chrome.version}, serving on :${port}\n`);

for (const key of KEYS) {
  const page = await chrome.newPage();
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride',
    { width: 900, height: 560, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.navigate', { url: `http://127.0.0.1:${port}${GAME}?planet=${key}` });
  let info;
  try { info = await evaluate(page, SETUP); } catch (e) { info = { ok: false, err: e.message }; }
  if (!info.ok) { console.log(`${key.padEnd(7)} never ready ${info.err || ''}`); await page.close(); continue; }

  const rows = [];
  for (const az of AZIMUTHS) {
    const w = await evaluate(page, look(az));
    const m = await evaluate(page, MEASURE);
    if (keep) {
      const png = await page.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(resolve(HERE, `shots/sun-${key}-${az}.png`), Buffer.from(png.data, 'base64'));
    }
    const want = w.want ? `(${w.want[0]},${w.want[1]})` : 'behind you';
    const at = m.at ? `(${m.at[0]},${m.at[1]})` : 'none';
    rows.push(`${String(az).padStart(3)}° want ${want.padEnd(13)} bright ` +
      `${String(m.bright).padStart(5)}% at ${at.padEnd(11)} peak ${m.max}`);
  }
  console.log(key.padEnd(7) + rows.join('\n       '));
  await page.close();
}

await chrome.close();
close();
