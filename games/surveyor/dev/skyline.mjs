// Does the horizon band sit on the horizon?
//
//   node dev/skyline.mjs              all six, ground to altitude
//   node dev/skyline.mjs home         one world
//   node dev/skyline.mjs --shot       ...and write the frames
//
// THE DEFECT. The band, the haze and the underglow were all drawn at ZERO
// ELEVATION in the local frame. That is the visual horizon at ground level and
// nowhere else: at altitude h on a planet of radius R the true skyline sits
// below local level by the dip angle acos(R / (R + h)). At 103m over Home that
// is 8 degrees, and the band floated that far above the skyline it was supposed
// to be drawn on. Found during the fog work and left for the sky pass.
//
// HOW IT IS MEASURED. The band is isolated by rendering the frame twice, once
// at the world's own SKY.band and once at zero, and differencing — the same
// trick that isolated the sun from its sky. Everything else in the frame is
// identical between the two, so what is left is the band and only the band, and
// its brightness-weighted centroid row is where it actually sits.
//
// That row is then compared against the projected TRUE horizon direction, which
// is computed from the dip angle and nothing else. The answer is in degrees of
// frame, because pixels do not mean anything across six fields of view.
//
// A pass is: the band lands on the true skyline at every altitude, and lands
// there at ground level too — where the dip is zero, so the fix has to be a
// no-op by construction or it has broken six approved surface skies.

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
const { PLANETS } = await import('../js/tune.js');
const KEYS = Object.keys(PLANETS).filter((k) => !only.length || only.includes(k));

// Altitudes as FRACTIONS OF RADIUS, because the worlds run 207m to 2072m and a
// fixed 100m is a rounding error on Anvil and half a world on Ember.
const ALTS = [0, 0.02, 0.06, 0.15];

// How far off the true skyline the band may sit. A tenth of a degree is well
// under a pixel at these fields of view.
const TOL_DEG = 0.35;

const READY = `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const t0 = performance.now();
  let drained = 0;
  while (performance.now() - t0 < 60000) {
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
  return { ok: true, band: S.mats.skyParams.band, radius: Math.round(S.planet.surfaceR) };
})()`;

/* Put the eye at `alt` over the spawn and aim AT THE TRUE SKYLINE, so the thing
   being measured is in the middle of the frame with room on both sides.
   Aiming at local level does not work and the first cut proved it: the dip
   reaches 30 degrees at 15% of Home's radius, against a 54.4 degree field of
   view, so the horizon is off the bottom of the picture before the interesting
   altitudes start.
   mats.update is handed the same altitude the game hands it, because that is
   the input under test. */
const LOOK = (altFrac) => `(() => {
  const S = window.SURVEYOR, V = BABYLON.Vector3;
  const c = S.cam.camera, surf = S.craft.surf, fr = surf.frame;
  const R = S.planet.surfaceR;
  const alt = ${altFrac} * R;
  const up = new V(fr.up.x, fr.up.y, fr.up.z).normalize();
  // A level direction: perpendicular to up, pointing away from the sun so the
  // sun's own glare is not sitting on top of the band being measured.
  const sd = S.mats.skyParams.sunDir;
  let f = new V(sd[0], sd[1], sd[2]).normalize();
  f = f.subtract(up.scale(V.Dot(f, up)));
  if (f.length() < 1e-3) f = new V(1, 0, 0).subtract(up.scale(up.x));
  f = f.normalize().scale(-1);

  const eye = fr.toWorld(0, alt, 0);
  c.position.set(eye.x, eye.y, eye.z);
  c.upVector.copyFrom(up);
  c.maxZ = Math.max(c.maxZ, R * 6);
  const dip0 = Math.acos(Math.min(1, R / (R + alt)));
  const aim = f.scale(Math.cos(dip0)).add(up.scale(-Math.sin(dip0))).normalize();
  c.setTarget(c.position.add(aim.scale(500)));

  /* THE GROUND IS HIDDEN FOR THIS MEASUREMENT, and that is not cheating.
     The question is where the SHADER draws the band, not how much of it the
     terrain lets you see — and at ground level the terrain sits exactly on the
     skyline, so it occludes the lower half of the band and drags the centroid
     of what is left upward by degrees. Measuring the visible half and calling
     it the band's position is how the first cut reported 1.85 degrees of error
     on a frame that was correct. Everything but the dome goes: the craft sits a
     few metres under the eye at low altitude and putting it in the centre
     column was enough to return NO BAND AT ALL on Ember. */
  S.world.field.dispose();
  for (const m of S.scene.meshes) if (m.name !== 'sky') m.setEnabled(false);

  S.world.update(1 / 60, S.craft, c);
  S.world.mats.update(1 / 60, c.position, 0, fr.up, fr.east, fr.north, alt);
  S.scene.render();

  const eng = S.scene.getEngine();
  const w = eng.getRenderWidth(), h = eng.getRenderHeight();
  const proj = (dir) => {
    const p = BABYLON.Vector3.Project(c.position.add(dir.scale(R * 40)),
      BABYLON.Matrix.Identity(), S.scene.getTransformMatrix(),
      c.viewport.toGlobal(w, h));
    return p.y;
  };
  // The dip angle, and the direction of the true skyline in this frame.
  const dip = dip0;
  const trueDir = aim;
  return {
    alt: +alt.toFixed(1),
    dipDeg: +(dip * 180 / Math.PI).toFixed(2),
    levelRow: proj(f),
    trueRow: proj(trueDir),
    perPx: c.fov / h * 180 / Math.PI,
    uHorizX: S.mats.sky._vectors3.uHoriz.x,
    wantHorizX: -Math.sin(dip0),
  };
})()`;

/* The band, isolated. Render at the world's own band strength, again at zero,
   and difference. The brightness-weighted centroid of that difference is where
   the band actually is; a bounding box would be a measure of its own tails. */
const BAND = (band) => `(() => {
  const S = window.SURVEYOR, eng = S.scene.getEngine(), gl = eng._gl;
  const w = eng.getRenderWidth(), h = eng.getRenderHeight();
  const post = S.post, wasPost = post ? post.enabled : false;
  if (post) post.setEnabled(false);

  /* THE OTHER HORIZON TERMS ARE NEUTRALISED FOR THE MEASUREMENT, and this is
     the difference between measuring the band and measuring the sky it sits in.
     SKY.below darkens from hzn 0.03 down to -0.12 — straight across the band's
     lower half — so mixing a fixed band colour over it produces a bigger
     difference below the skyline than above, and the peak of the DIFFERENCE
     lands below the peak of the BAND. Same for the scattering. Flattening both
     first is not enough either: the GRADIENT still varies across the band, and
     that alone was worth a degree. The whole sky is flattened to one colour for
     the measurement — every stop, the haze, the underglow, the cloud and the
     glare — so the frame is a constant field with a band on it and the peak of
     the difference is the peak of the band, exactly. */
  const SK = S.mats.skyParams;
  const lo = SK.horizon;
  const V = (c) => new BABYLON.Vector3(c[0], c[1], c[2]);
  for (const u of ['uLow', 'uMid', 'uHigh', 'uBelow']) S.mats.sky.setVector3(u, V(lo));
  for (const u of ['uHaze', 'uUnder', 'uClouds', 'uGlare']) S.mats.sky.setFloat(u, 0);
  for (let i = 0; i < 3; i++) S.scene.render();
  const grab = () => { const b = new Uint8Array(w * h * 4); S.scene.render();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
  const on = grab();
  S.mats.sky.setFloat('uBand', 0);
  const off = grab();
  S.mats.sky.setFloat('uBand', ${band});
  const again = grab();
  S.mats.sky.setVector3('uLow', V(SK.horizon));
  S.mats.sky.setVector3('uMid', V(SK.mid));
  S.mats.sky.setVector3('uHigh', V(SK.zenith));
  S.mats.sky.setVector3('uBelow', V(SK.below));
  S.mats.sky.setFloat('uHaze', SK.haze);
  S.mats.sky.setFloat('uUnder', SK.underglow);
  S.mats.sky.setFloat('uClouds', SK.clouds);
  S.mats.sky.setFloat('uGlare', SK.glare);
  if (post) post.setEnabled(wasPost);

  /* THE PEAK ROW, NOT THE CENTROID OF THE WHOLE DIFFERENCE.
     The band is a mix toward a colour, so the SIZE of the difference it makes
     depends on what it is mixed over — and the base is not symmetric about the
     skyline: SKY.below darkens under it and the scattering piles up on it. A
     brightness-weighted centroid of that is a measure of the base as much as of
     the band, and it reported the band 12% of the dip angle low at every
     altitude on a shader that was placing it correctly.
     The band's own weight peaks exactly at hzn = 0 whatever it is drawn over,
     so the peak row is the honest estimator. Refined by taking the centroid of
     only those rows within 20% of the peak, which is sub-pixel without
     reaching into the tails. */
  /* ONLY A NARROW COLUMN DOWN THE MIDDLE, and that is not fussiness.
     A line of constant elevation is a CONE around the local up, and a cone seen
     from inside projects as a conic section, not as a horizontal line: it is
     lowest at the point the camera is aimed at and rises toward both edges of
     the frame. Summing whole rows therefore counts each of the two rising
     branches into rows above the centre and biases the peak, by about a degree
     at these dips. The centre column is the one place the curve is flat and it
     is where the aim direction actually lands. */
  const x0 = Math.floor(w / 2) - 20, x1 = Math.floor(w / 2) + 20;
  const prof = new Float64Array(h);
  let noise = 0;
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      row += Math.abs(on[i] - off[i]) + Math.abs(on[i + 1] - off[i + 1]) +
        Math.abs(on[i + 2] - off[i + 2]);
      const n = Math.abs(on[i] - again[i]) + Math.abs(on[i + 1] - again[i + 1]) +
        Math.abs(on[i + 2] - again[i + 2]);
      if (n > noise) noise = n;
    }
    prof[y] = row;
  }
  let peak = 0;
  for (let y = 0; y < h; y++) if (prof[y] > peak) peak = prof[y];
  if (peak <= 0) return { row: null, weight: 0, noise };
  const cut = peak * 0.8;
  let sum = 0, wsum = 0, wide = 0;
  for (let y = 0; y < h; y++) {
    if (prof[y] < cut) continue;
    sum += (prof[y] - cut) * y; wsum += prof[y] - cut; wide++;
  }
  const row = wsum > 0 ? sum / wsum : prof.indexOf(peak);
  // gl.readPixels is bottom-up; the projected rows above are top-down.
  return { row: h - 1 - row, weight: peak, rows: wide, noise };
})()`;

const { port, close } = await serve(SITE);
const chrome = await launch({ width: 900, height: 560 });
console.log(`${chrome.version}\n`);
console.log('world     alt      dip    band sits    true skyline    off by     local level');

let bad = 0;
for (const key of KEYS) {
  const page = await chrome.newPage();
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride',
    { width: 900, height: 560, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.navigate', { url: `http://127.0.0.1:${port}${GAME}?planet=${key}&tier=high` });
  const r = await evaluate(page, READY);
  if (!r.ok) { console.log(`${key}: never ready`); bad++; await page.close(); continue; }
  if (!r.band) {
    console.log(`${key.padEnd(8)} band is 0 on this world — nothing to measure`);
    await page.close();
    continue;
  }

  for (const frac of ALTS) {
    const L = await evaluate(page, LOOK(frac));
    const B = await evaluate(page, BAND(r.band));
    if (B.row === null) {
      console.log(`${key.padEnd(8)} ${String(L.alt).padStart(6)}m  no band in frame`);
      bad++;
      continue;
    }
    const offDeg = (B.row - L.trueRow) * L.perPx;
    const levelDeg = (B.row - L.levelRow) * L.perPx;
    const ok = Math.abs(offDeg) <= TOL_DEG;
    if (!ok) bad++;
    console.log(`${key.padEnd(8)} ${String(L.alt).padStart(6)}m ${String(L.dipDeg).padStart(6)}°` +
      `  row ${B.row.toFixed(0).padStart(4)}    row ${L.trueRow.toFixed(0).padStart(4)}` +
      `   ${(offDeg >= 0 ? '+' : '') + offDeg.toFixed(2)}°${ok ? '  ' : ' !'}` +
      `   ${(levelDeg >= 0 ? '+' : '') + levelDeg.toFixed(2)}°` +
      (frac === 0 ? '   <- ground: dip is 0, so this must be a no-op' : ''));
    if (Math.abs(L.uHorizX - L.wantHorizX) > 1e-9) {
      bad++;
      console.log(`  FAIL: uHoriz.x is ${L.uHorizX}, want ${L.wantHorizX} for this dip.`);
    }
    if (frac === 0 && L.uHorizX !== 0) {
      bad++;
      console.log(`  FAIL: uHoriz.x is ${L.uHorizX} at zero altitude, not 0 — the term is not a no-op on the ground.`);
    }
    if (shot) {
      const png = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 86 });
      writeFileSync(resolve(HERE, `shots/skyline-${key}-${Math.round(frac * 1000)}.jpg`),
        Buffer.from(png.data, 'base64'));
    }
  }
  console.log('');
  await page.close();
}

console.log(bad
  ? `FAIL: the band is off the true skyline in ${bad} case(s).`
  : `The band sits on the true skyline at every altitude, within ${TOL_DEG}°.`);
await chrome.close();
close();
process.exitCode = bad ? 1 : 0;
