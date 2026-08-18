// What the water shader actually computes, per world, as numbers.
//
//   node dev/waterstats.mjs            all six
//   node dev/waterstats.mjs home       just that one
//
// The debug modes in WATER.debug render thickness, the raw seabed distance and
// the foam mask as greyscale. Photographing those and looking at them tells you
// something is wrong; it does not tell you what. This reads them back and
// reports the distribution, from the shoreline camera, with the frame frozen —
// so "the foam covers half the frame" becomes "median depth under this camera
// is 0.2m, and the foam is doing exactly what it was told".

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { launch, serve, evaluate } from './cdp.mjs';
import { SHORE } from './frames.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../..');
const GAME = '/games/surveyor/';

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const { PLANETS } = await import('../js/tune.js');
const KEYS = Object.keys(PLANETS).filter((k) => !only.length || only.includes(k));

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
  const shore = (await ${SHORE}).shore;
  const engine = S.scene.getEngine();
  engine.stopRenderLoop();
  if (S.pipeline) S.pipeline.grainEnabled = false;
  for (const ps of S.scene.particleSystems.slice()) { ps.stop(); ps.reset(); }
  S.scene.animationsEnabled = false;
  S.scene.render();
  /* Is the texture the shader samples the one the pass renders into? A zero
     reading has two causes and only this separates them: a render target that
     drew nothing, or a sampler pointing somewhere else entirely. */
  const sb = S.world.seabed, mat = S.scene.getMaterialByName('svWater');
  const bound = mat._textures ? mat._textures.uSeabed : null;
  return { ok: true, shore, hasWater: S.planet.hasWater,
           maxDepth: S.world.water ? +S.world.water.maxDepth.toFixed(2) : 0,
           bind: {
             enabled: !!(sb && sb.enabled),
             sameObject: !!(sb && bound && bound === sb.rtt),
             boundName: bound ? bound.name : '(nothing bound)',
             rttSize: sb && sb.rtt ? sb.rtt.getSize().width + 'x' + sb.rtt.getSize().height : '-',
             renderSize: engine.getRenderWidth() + 'x' + engine.getRenderHeight(),
             meshes: sb && sb.rtt ? sb.rtt.renderList.length : -1,
             inScene: !!(sb && S.scene.customRenderTargets.indexOf(sb.rtt) >= 0),
             ready: !!(sb && sb.rtt && sb.rtt.isReady()),
             shadows: !!(S.world.shadows && S.world.shadows.enabled),
           } };
})()`;

/* THE POST STACK IS TURNED OFF FOR THIS, and it has to be. The debug modes
   write a linear ramp into the colour buffer, and ACES plus a colour-grading
   LUT plus bloom would then regrade it — so the byte that comes back would be a
   tonemapped version of the number, which is not the number. */
const READ = `(() => {
  const S = window.SURVEYOR;
  const engine = S.scene.getEngine();
  const gl = engine._gl;
  const w = engine.getRenderWidth(), h = engine.getRenderHeight();
  const buf = new Uint8Array(w * h * 4);
  const water = S.scene.getMaterialByName('svWater');
  if (S.pipeline) {
    S.pipeline.imageProcessingEnabled = false;
    S.pipeline.bloomEnabled = false;
    S.pipeline.fxaaEnabled = false;
  }
  /* ALPHA BLENDING OFF FOR THE READ. The water is a blended surface, so a debug
     value written through it comes back mixed with whatever is behind — and the
     mask has to come back as exactly magenta or it cannot be used as a mask. */
  const wasBlend = water.needAlphaBlending;
  water.needAlphaBlending = () => false;

  const shot = (mode) => {
    water.setFloat('uWaterDebug', mode);
    S.scene.render();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf.slice();
  };

  // Mode 4 paints every water fragment flat magenta. This is the only honest
  // way to say which pixels the following histograms are allowed to count.
  const maskBuf = shot(4);
  const mask = [];
  for (let i = 0; i < maskBuf.length; i += 4) {
    if (maskBuf[i] === 255 && maskBuf[i + 1] === 0 && maskBuf[i + 2] === 255) mask.push(i);
  }

  const read = (mode) => {
    const px = shot(mode);
    const hist = new Array(256).fill(0);
    for (const i of mask) hist[px[i]]++;
    return hist;
  };
  const thickness = read(1);
  const seabed = read(2);
  const foam = read(3);
  water.setFloat('uWaterDebug', 0);
  water.needAlphaBlending = wasBlend;

  const pct = (hist, p) => {
    const total = hist.reduce((a, b) => a + b, 0);
    if (!total) return -1;
    let seen = 0;
    for (let i = 0; i < 256; i++) { seen += hist[i]; if (seen >= total * p) return i; }
    return 255;
  };
  return {
    px: w * h,
    water: mask.length,
    // Mode 1 is thickness / 20m, so a byte of 255 is 20 metres or more.
    thickness: { p10: pct(thickness, 0.10), p50: pct(thickness, 0.50),
                 p90: pct(thickness, 0.90), zero: thickness[0] },
    seabed: { p10: pct(seabed, 0.10), p50: pct(seabed, 0.50), p90: pct(seabed, 0.90),
              zero: seabed[0], full: seabed[255] },
    foamLit: foam.slice(96).reduce((a, b) => a + b, 0),
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
  if (!info.ok || !info.hasWater) {
    console.log(`${key.padEnd(7)} ${info.hasWater === false ? 'dry' : 'never ready'}`);
    await page.close();
    continue;
  }
  /* READ THE RENDER TARGET ITSELF, not what the water shader made of it.
     Everything up to here measures the depth pass THROUGH the shader that
     samples it, so a wrong answer could be the pass, the sampler, the UVs or
     the shader. This asks the target directly. */
  const RTT = `(async () => {
    const S = window.SURVEYOR;
    const rtt = S.world.seabed.rtt;
    const px = await rtt.readPixels();
    let zero = 0, cleared = 0, real = 0, lo = 1e30, hi = -1e30;
    for (let i = 0; i < px.length; i += 4) {
      const v = px[i];
      if (v === 0) zero++;
      else if (v > 30000) cleared++;
      else { real++; if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    const n = px.length / 4;
    return { n, kind: px.constructor.name,
             zero: +(100 * zero / n).toFixed(1),
             cleared: +(100 * cleared / n).toFixed(1),
             real: +(100 * real / n).toFixed(1),
             lo: real ? +lo.toFixed(1) : -1, hi: real ? +hi.toFixed(1) : -1 };
  })()`;
  const t = await evaluate(page, RTT);
  console.log(`        target itself: ${t.kind} ${t.n}px  ` +
    `zero ${t.zero}%  cleared ${t.cleared}%  real ${t.real}% (${t.lo}m..${t.hi}m)`);

  /* WHAT THE PASS COSTS, from the shoreline camera — which is the worst case
     on purpose, because it is the frame with the most water and the most
     terrain in the depth pass at once.
     Measured by splicing the target in and out of scene.customRenderTargets
     rather than by disabling the shader, so what is timed is the extra render
     and not a branch. Headless Chrome falls back to SwiftShader, a SOFTWARE
     rasteriser, so the absolute numbers are far worse than any real GPU's — the
     DIFFERENCE on identical geometry is the measurement, and a software
     rasteriser exaggerates an extra pass rather than hiding it. */
  const PERF = `(() => {
    const S = window.SURVEYOR;
    const rtt = S.world.seabed.rtt;
    const list = S.scene.customRenderTargets;
    const on = () => { if (list.indexOf(rtt) < 0) list.push(rtt); };
    const off = () => { const i = list.indexOf(rtt); if (i >= 0) list.splice(i, 1); };
    const one = () => { const t = performance.now(); S.scene.render(); return performance.now() - t; };

    /* INTERLEAVED A/B/A/B, and the median of the PAIRED differences.
       The first version timed a block with the pass and then a block without,
       and reported the pass making the frame 40% FASTER — which is what you get
       when the machine drifts more between the two blocks than the thing you
       are measuring costs. Alternating cancels the drift; taking the median
       rather than the mean throws away the frames where the OS scheduled
       something else on top.
       IT IS STILL NOT A USABLE NUMBER, and that is worth knowing before anyone
       acts on one. Interleaved, the medians came back between +17ms and +330ms
       a frame for identical structural work, against baselines swinging from
       94ms to 188ms. SwiftShader is a software rasteriser and this machine runs
       two browser sessions. Treat the output as a smoke test — the pass is
       there and it is not free — and take any real figure off a real GPU. */
    on(); for (let i = 0; i < 8; i++) S.scene.render();
    const d = [];
    let sumOn = 0, sumOff = 0;
    for (let i = 0; i < 30; i++) {
      on();  const a = one();
      off(); const b = one();
      sumOn += a; sumOff += b;
      d.push(a - b);
    }
    on();
    d.sort((x, y) => x - y);
    return { delta: +d[d.length >> 1].toFixed(2),
             withPass: +(sumOn / 30).toFixed(1), without: +(sumOff / 30).toFixed(1),
             meshes: rtt.renderList.length };
  })()`;
  const perf = await evaluate(page, PERF);
  console.log(`        cost: median +${perf.delta}ms a frame over ${perf.meshes} meshes ` +
    `(${perf.without}ms -> ${perf.withPass}ms mean, 30 interleaved pairs, SwiftShader)`);

  const B = info.bind;
  console.log(`${key.padEnd(7)} bind: bound=${B.boundName} same=${B.sameObject} ` +
    `rtt=${B.rttSize} render=${B.renderSize} meshes=${B.meshes} ` +
    `inScene=${B.inScene} ready=${B.ready} shadows=${B.shadows}`);
  const r = await evaluate(page, READ);
  // Mode 1 writes thickness/20, so a byte is 20/255 = 0.0784 metres.
  const m = (b) => (b * 20 / 255).toFixed(2) + 'm';
  const ofWater = (n) => r.water ? (100 * n / r.water).toFixed(1) + '%' : 'n/a';
  console.log(`${key.padEnd(7)} shore@${String(info.shore).padStart(3)}m  ` +
    `shell max ${String(info.maxDepth).padStart(5)}m  ` +
    `water ${(100 * r.water / r.px).toFixed(1)}% of frame  |  over water only: ` +
    `thickness p10 ${m(r.thickness.p10)} p50 ${m(r.thickness.p50)} ` +
    `p90 ${m(r.thickness.p90)}  foam>0.38 ${ofWater(r.foamLit)}`);
  // Mode 2 writes the raw pass value over fogFar, so a byte is fogFar/255
  // metres. Printed separately because "thickness is zero" has two causes and
  // only this tells them apart: a seabed at the same distance as the water, or
  // a seabed texture reading nothing at all.
  const far = PLANETS[key].fogFar * PLANETS[key].radius;
  const sm = (b) => (b * far / 255).toFixed(0) + 'm';
  console.log(`        depth pass raw: p10 ${sm(r.seabed.p10)} p50 ${sm(r.seabed.p50)} ` +
    `p90 ${sm(r.seabed.p90)}   exactly-zero ${ofWater(r.seabed.zero)}  ` +
    `saturated ${ofWater(r.seabed.full)}   (fogFar ${far.toFixed(0)}m)`);
  await page.close();
}

await chrome.close();
close();
