// What a hyper arrival looks like FROM THE SEAT.
//
//   node dev/seatcheck.mjs ember tarn home anvil
//
// The chase camera untouched, landOn's own state, three quarters of a second
// in - and it reports how much of the frame the destination actually occupies,
// isolated by hiding the world's ground and water and differencing.
//
// WHY IT EXISTS. Most of a session went into the far-body-to-quadtree handoff:
// size, luminance, silhouette, three shader terms. Then this was run, and the
// destination fills 0% of the frame on Ember and Tarn and 1% on Anvil. At 880m
// nose-down the world is below and behind the boom on every world in the
// system. The step is real and nobody sees it. Measure who is looking before
// measuring what changed.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { launch, serve, evaluate } from './cdp.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../..');
const OUT = resolve(HERE, 'shots');
const READY = `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const t0 = performance.now(); let drained = 0;
  while (performance.now() - t0 < 90000) { await frame();
    const S = window.SURVEYOR; if (!S) continue;
    drained = S.field.queue.length === 0 ? drained + 1 : 0; if (drained > 20) break; }
  const S = window.SURVEYOR; if (!S) return { ok:false };
  document.getElementById('begin').click();
  document.getElementById('start').style.display='none';
  for (let i=0;i<30;i++) await frame();
  return { ok:true };
})()`;
// landOn's own state, then let the loop and the chase spring run as they would.
const SEAT = `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const S = window.SURVEYOR;
  const { HYPER, JET, ARRIVE } = await import('/games/surveyor/js/tune.js');
  const c = S.craft;
  /* A hyper arrival keeps the form it departed in, and departing needs the
     jet: the escape burn is the only thing that reaches the boundary. Landing
     a ROVER at 900m is not the arrival - its physics puts it on the deck
     inside a frame, which is what the first run of this measured. */
  c.setMode('jet', true);
  c.fuel = 999;
  /* The altitude the game actually hands back, which is per world now - see
     ARRIVE.alt. Hardcoding approachAlt here tested the path the fix replaced,
     and reported no change from a change that had landed. */
  const alt = Math.min(HYPER.approachAlt, S.planet.radius * ARRIVE.alt);
  c.landOn(c.surf, alt);                    // exactly what a hyper arrival calls
  S.cam.arrive(c);
  for (let i = 0; i < 45; i++) await frame();   // the first three-quarters of a second
  // How much of the frame is the world at all?
  const eng = S.scene.getEngine(), gl = eng._gl;
  const w = eng.getRenderWidth(), h = eng.getRenderHeight();
  const grab = () => { const b = new Uint8Array(w*h*4);
    for (let i=0;i<2;i++) S.scene.render();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,b); return b; };
  const on = grab();
  S.world.ground.setEnabled(false);
  const water = S.world.water ? S.world.water.mesh : null;
  if (water) water.setEnabled(false);
  const off = grab();
  S.world.ground.setEnabled(true);
  if (water) water.setEnabled(true);
  let n = 0;
  for (let i = 0; i < on.length; i += 4) {
    const d = Math.max(Math.abs(on[i]-off[i]), Math.abs(on[i+1]-off[i+1]), Math.abs(on[i+2]-off[i+2]));
    if (d > 12) n++;
  }
  return { world: S.planet.key, alt: +c.pos.y.toFixed(0), pitch: +c.pitch.toFixed(2),
    worldPct: +(100 * n / (w * h)).toFixed(1) };
})()`;
const { server, port, close } = await serve(SITE);
const chrome = await launch({ width: 900, height: 560, gpu: true });
for (const w of process.argv.slice(2)) {
  const page = await chrome.newPage();
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride',{width:900,height:560,deviceScaleFactor:1,mobile:false});
  await page.send('Page.navigate', { url:`http://127.0.0.1:${port}/games/surveyor/?planet=${w}` });
  const r = await evaluate(page, READY);
  if (!r.ok) { console.log(w, 'never booted'); await page.close(); continue; }
  const a = await evaluate(page, SEAT);
  const s = await page.send('Page.captureScreenshot', { format:'png' });
  writeFileSync(`${OUT}/seat-${w}.png`, Buffer.from(s.data,'base64'));
  console.log(`${w.padEnd(7)} alt ${a.alt}m  pitch ${a.pitch}  world fills ${a.worldPct}% of the frame`);
  await page.close();
}
await chrome.close(); close(); server.unref();
