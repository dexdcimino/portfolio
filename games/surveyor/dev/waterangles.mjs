// Can you tell shallow water from deep, at every viewing angle, on every world?
//
//   node dev/waterangles.mjs            all five worlds with water
//   node dev/waterangles.mjs vault      just that one
//
// This is one acceptance criterion turned into a number. "The bathymetry
// banding must never be fully occluded" cannot be checked by looking at five
// screenshots taken from one angle, because the terms that occlude it are the
// ones that depend on angle: a specular that fires on wave crests, a reflection
// weighted by Fresnel, a depth read along the view ray. All of them are
// invisible looking down and worst at a graze.
//
// HOW IT ASKS. For each world it finds open water, then orbits the camera to a
// series of elevation angles above the surface, holding the same patch of water
// in frame. At each angle it renders three times:
//
//   mode 4  a flat magenta mask, so water pixels can be told from terrain and
//           sky — without it every histogram is polluted by the sky's blue
//   mode 5  the vertical depth the chart is drawn from, per pixel
//   normal  the frame as shipped
//
// Then it buckets the water pixels by depth and reports the LUMINANCE GAP
// between the shallowest fifth and the deepest fifth. That gap is the chart:
// if it collapses at 8 degrees, the water has gone flat white or flat dark and
// the depth ladder is gone, whatever it looks like from above.
//
// The post stack is switched off for the two debug reads, because ACES and a
// colour-grading LUT would regrade a linear ramp — but NOT for the shipped
// frame, because bloom is the thing most likely to be doing the occluding and
// measuring the water with the bloom turned off would be measuring the wrong
// picture.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { launch, serve, evaluate } from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../..');
const GAME = '/games/surveyor/';

const argv = process.argv.slice(2);
// --shots writes dev/shots/angle-<world>-<deg>.png, because a gap of 19 has two
// readings — the shading went flat, or the geometry hid the water — and only a
// picture separates them.
const keep = argv.includes('--shots');
const only = argv.filter((a) => !a.startsWith('--'));
const { PLANETS } = await import('../js/tune.js');
const KEYS = Object.keys(PLANETS).filter((k) => !only.length || only.includes(k));

// Degrees above the horizontal. 6 is a chase camera over a lake; 70 is a jet
// looking down. The first two are where everything goes wrong.
const ANGLES = [6, 12, 22, 40, 70];

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
  if (!S.planet.hasWater) return { ok: true, dry: true };

  /* Find open water, and drive there — terrain streams around the CRAFT, so a
     camera sent somewhere the craft is not has no seabed behind the water and
     the depth pass falls back. Same reasoning as dev/frames.mjs. */
  const N = 1200, REACH = S.planet.radius * 0.6;
  let best = null;
  for (let a = 0; a < N; a++) {
    const ang = a * 2.39996323;
    const r = 14 + REACH * Math.sqrt(a / N);
    const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
    // Deep enough to have a ladder to read, with shallows within reach of it.
    if (S.surfaceHeight(x, z) > -2.5) continue;
    let shallow = 0;
    for (let k = 1; k <= 8; k++) {
      const d = k * 9;
      if (S.surfaceHeight(x + Math.cos(ang) * d, z + Math.sin(ang) * d) > -0.6) shallow++;
    }
    if (shallow < 2) continue;
    if (!best || r < best.r) best = { x, z, r, ang };
  }
  if (!best) return { ok: true, noWater: true };

  S.craft.pos.x = best.x;
  S.craft.pos.z = best.z;
  S.craft.pos.y = 3;
  S.craft.vel.x = 0; S.craft.vel.z = 0;
  for (let i = 0; i < 4; i++) await frame();
  const t1 = performance.now();
  let settled = 0;
  while (performance.now() - t1 < 30000) {
    await frame();
    settled = S.field.queue.length === 0 ? settled + 1 : 0;
    if (settled > 20) break;
  }

  const engine = S.scene.getEngine();
  engine.stopRenderLoop();
  if (S.pipeline) S.pipeline.grainEnabled = false;
  for (const ps of S.scene.particleSystems.slice()) { ps.stop(); ps.reset(); }
  S.scene.animationsEnabled = false;
  S.cam.update = () => {};
  S.scene.render();
  return { ok: true, frozen: S.planet.iceThickness > 0 };
})()`;

/* One elevation angle, with BOTH ENDS OVER THE WATER.
   The first version stood the camera back on a slant and aimed at the patch,
   which is the natural way to write it and gives a useless answer at low
   angles: on Vault at 12 degrees the line of sight crossed a rise and the frame
   came back 90% terrain with the lake a sliver on the skyline. It measured a
   depth gap of 19 and the honest reading of that number was "the camera is
   looking at a hill".
   So the eye goes directly ABOVE the water patch and the target is another
   point on the water further along it. The elevation angle is then just
   atan(height / range), nothing can get between the two, and the only thing
   that varies between rows is the incidence — which is the whole point. */
const look = (deg) => `(() => {
  const S = window.SURVEYOR;
  const c = S.cam.camera;
  const rad = ${deg} * Math.PI / 180;
  const range = 70;
  const eye = new BABYLON.Vector3(), aim = new BABYLON.Vector3();
  const alt = 1.5 + range * Math.tan(rad);
  /* THE CRAFT GOES UP WITH THE CAMERA, and leaving it behind was worth three
     wrong conclusions. Fog thins with the CRAFT's altitude — deliberately, so a
     chase camera swinging high cannot clear the world by itself — so a rig that
     flies the camera to 192m and leaves the craft floating at sea level asks
     the shader for a state the game cannot produce: a top-down view through
     surface-level murk. Shroud measured a correlation of -0.03 that way, which
     read as "the depth ladder is gone" and was really "you are looking at 192m
     of fog that would not be there if you were the one up here". */
  S.craft.pos.y = alt;
  S.craft.vel.y = 0;
  /* ...and DRIVE THE PER-FRAME UPDATE BY HAND, because stopping the render loop
     stopped it too. scene.render() draws; it does not run the game, and every
     uniform main.js refreshes each frame — the fog range above all — was frozen
     at whatever the surface had left in it. Moving the craft up without this
     did exactly nothing, twice, which is the sort of null result that looks
     like a finding about the shader. */
  const fr = S.craft.surf.frame;
  S.world.mats.update(1 / 60, c.position, S.craft.boostHeat,
    fr.up, fr.east, fr.north, S.craft.pos.y);
  S.surface.toWorld(0, alt, 0, eye);
  S.surface.toWorld(range, 0, 0, aim);
  const up = S.surface.frame.up;
  c.upVector.set(up.x, up.y, up.z);
  c.position.copyFrom(eye);
  c.setTarget(aim);
  S.scene.render();
  return true;
})()`;

const MEASURE = `(() => {
  const S = window.SURVEYOR;
  const engine = S.scene.getEngine();
  const gl = engine._gl;
  const w = engine.getRenderWidth(), h = engine.getRenderHeight();
  const buf = new Uint8Array(w * h * 4);
  const water = S.scene.getMaterialByName('svWater');
  const pipe = S.pipeline;

  const shot = (mode, post) => {
    if (pipe) {
      pipe.imageProcessingEnabled = post;
      pipe.bloomEnabled = post;
      pipe.fxaaEnabled = post;
    }
    water.setFloat('uWaterDebug', mode);
    S.scene.render();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf.slice();
  };

  const wasBlend = water.needAlphaBlending;
  water.needAlphaBlending = () => false;
  const maskBuf = shot(4, false);
  const depthBuf = shot(5, false);
  water.needAlphaBlending = wasBlend;
  // The SHIPPED frame, post stack and all — bloom is a prime suspect for
  // occluding the chart, so it has to be in the picture being measured.
  const shipped = shot(0, true);

  const px = [];
  for (let i = 0; i < maskBuf.length; i += 4) {
    if (maskBuf[i] === 255 && maskBuf[i + 1] === 0 && maskBuf[i + 2] === 255) {
      px.push({ d: depthBuf[i],
                l: 0.2126 * shipped[i] + 0.7152 * shipped[i + 1] + 0.0722 * shipped[i + 2] });
    }
  }
  if (px.length < 400) return { n: px.length };

  /* CORRELATION, not just the raw gap between the ends.
     The gap alone answers the wrong question at a grazing angle. Looking along
     the water you mostly see water that is FAR AWAY, and far-away water is all
     at similar depth — so the range of depths in the frame collapses and the
     gap collapses with it, whether or not anything is occluding the chart.
     Tarn measured 24 levels at six degrees and 82 at twenty-two, and capping
     every additive term in the shader moved that by 0.1: the number was never
     about glare, it was about what was in frame.
     Pearson between depth and luminance is invariant to how much depth the
     frame happens to contain. If the ladder is readable, brightness tracks
     depth however narrow the range; if something has washed the surface, the
     tracking is what breaks. The sign is kept because an INVERTED ladder is a
     different fault from a flat one and wants a different fix. */
  let sd = 0, sl = 0;
  for (const p of px) { sd += p.d; sl += p.l; }
  const md = sd / px.length, ml = sl / px.length;
  let num = 0, dd = 0, dl = 0;
  for (const p of px) {
    const a = p.d - md, b = p.l - ml;
    num += a * b; dd += a * a; dl += b * b;
  }
  const r = (dd > 0 && dl > 0) ? num / Math.sqrt(dd * dl) : 0;

  px.sort((a, b) => a.d - b.d);
  const fifth = Math.max(1, Math.floor(px.length / 5));
  const mean = (arr) => arr.reduce((s, p) => s + p.l, 0) / arr.length;
  const shallow = mean(px.slice(0, fifth));
  const deep = mean(px.slice(-fifth));
  // How much of the frame is pinned at the top of the range — the signature of
  // something additive having blown the surface out rather than shaded it.
  let blown = 0;
  for (const p of px) if (p.l > 246) blown++;
  return {
    n: px.length,
    r: +r.toFixed(3),
    spread: +(px[px.length - 1].d - px[0].d).toFixed(0),
    shallow: +shallow.toFixed(1),
    deep: +deep.toFixed(1),
    gap: +(shallow - deep).toFixed(1),
    blown: +(100 * blown / px.length).toFixed(1),
  };
})()`;

const { port, close } = await serve(SITE);
const chrome = await launch({ width: 900, height: 560 });
console.log(`${chrome.version}, serving on :${port}\n`);

// A chart you cannot read is a chart that is not there. Below about 0.5 the
// luminance has stopped tracking depth in any way an eye would follow.
const FLOOR = 0.5;
let fails = 0;

for (const key of KEYS) {
  const page = await chrome.newPage();
  const errs = [];
  page.on((m, p) => {
    if (m === 'Runtime.exceptionThrown') errs.push(p.exceptionDetails.text);
  });
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride',
    { width: 900, height: 560, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.navigate', { url: `http://127.0.0.1:${port}${GAME}?planet=${key}` });

  let info;
  try { info = await evaluate(page, SETUP); } catch (e) { info = { ok: false, err: e.message }; }
  if (!info.ok) { console.log(`FAIL  ${key.padEnd(7)} never ready ${info.err || ''}`); fails++; await page.close(); continue; }
  if (info.dry) { console.log(`skip  ${key.padEnd(7)} dry`); await page.close(); continue; }
  if (info.noWater) { console.log(`FAIL  ${key.padEnd(7)} found no open water to look at`); fails++; await page.close(); continue; }

  const row = [];
  let worst = Infinity;
  for (const deg of ANGLES) {
    await evaluate(page, look(deg));
    if (keep) {
      const png = await page.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(resolve(HERE, `shots/angle-${key}-${deg}.png`),
        Buffer.from(png.data, 'base64'));
    }
    const r = await evaluate(page, MEASURE);
    // Say WHY it could not answer. "n/a" on its own sent the first
    // investigation looking at the shader when the camera was the problem.
    if (!r.gap && r.gap !== 0) { row.push(`${deg}° only ${r.n}px of water`); continue; }
    /* A FRAME WITH NO DEPTH IN IT CANNOT BE JUDGED, and refusing to judge it is
       the difference between this tool working and this tool lying.
       Looking straight down from 190m you see one pool at one depth: Shroud's
       depth spread at 70 degrees is 16 bytes out of 255, about a metre of water
       across the entire frame. Correlating brightness against a metre of depth
       measures the dither, and it came back at -0.03 — which reads exactly like
       "the chart is gone" and is really "there is no chart in this picture to
       read". Three separate fixes were aimed at that number before the spread
       was printed next to it. Forty bytes is about three metres of depth, which
       is the least a six-band ladder needs to have anything to say. */
    if (r.spread < 40) { row[row.length - 1] += ' — too little depth to judge'; continue; }
    if (Math.abs(r.r) < worst) worst = Math.abs(r.r);
    /* n and spread are printed because a correlation of exactly 0 is almost
       never a measurement — it is what this returns when every water pixel in
       the frame carries the SAME depth, which is a statement about what the
       camera found, not about the shading. */
    row.push(`${String(deg).padStart(2)}° r ${String(r.r).padStart(6)} ` +
      `(gap ${String(r.gap).padStart(6)}, ${r.n}px, spread ${r.spread})` +
      (r.blown > 2 ? ` blown ${r.blown}%` : ''));
  }
  // Infinity means every angle was skipped for want of depth, which is not a
  // pass — it is a world this test never managed to ask about.
  /* FROZEN WORLDS ARE HELD TO A LOWER BAR, and it is not a fudge — it is that
     Pearson is the wrong shape for what Vault draws.
     Vault's ice carries a deliberately BRIGHT stroke at the melt line, in the
     middle of the depth range, because that line is the hazard: past it the ice
     does not hold the rover. A bright band at mid-depth makes brightness
     non-monotonic in depth, and a linear correlation reads non-monotonic as
     weak — Vault scores 0.36 looking straight down while its ladder is plainly
     legible in dev/shots/vault-shore.png and vault-aloft.png. The number is
     measuring the hazard marker, not missing the chart. */
  const floor = info.frozen ? 0.30 : FLOOR;
  const ok = worst !== Infinity && worst >= floor;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FLAT'}  ${key.padEnd(7)}${info.frozen ? ' (ice)' : '     '} ` +
    row.join('  |  '));
  for (const e of errs.slice(0, 2)) console.log(`        ! ${e}`);
  await page.close();
}

await chrome.close();
close();
console.log(fails === 0
  ? `\nShallow reads differently from deep at every angle on every world (floor ${FLOOR}).`
  : `\n${fails} world(s) where the depth ladder goes flat at some angle.`);
process.exit(fails ? 1 : 0);
