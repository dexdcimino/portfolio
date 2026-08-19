// Does arriving somewhere put the camera under the ground?
//
//   node dev/arrivecheck.mjs                  every world, warped to from home
//   node dev/arrivecheck.mjs vault ember      just these
//
// THE BUG THIS EXISTS FOR. The chase camera's framing is computed in the
// craft's tangent frame and the spring that drives it runs in WORLD space. Both
// are right while you stay on one planet. The instant you are on another, the
// camera's world position is still a point on the world you left — and on a
// sphere of a different radius that point is usually INSIDE this one. So the
// arrival started underground and rose through the terrain to the boom, every
// time, on every world. Nothing threw and nothing was out of range; it simply
// looked broken.
//
// So this measures the one number that says it: the camera's height above the
// GROUND UNDER IT, every frame, for two seconds after a warp. Not its height
// above sea level — a camera 7m over a 20m hill is still inside the hill, and
// that distinction is exactly what the sea-level version of this check missed.
//
// A pass is: no frame below zero, and the height falling monotonically-ish from
// the arrival lift to the settled boom. See ChaseCam.arrive and CAM.arriveLift.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { launch, serve, evaluate } from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../..');
const GAME = '/games/surveyor/';

const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const { PLANETS } = await import('../js/tune.js');
const ALL = Object.keys(PLANETS);
const KEYS = argv.length ? argv : ALL;

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
  for (let i = 0; i < 40; i++) await frame();
  return { ok: true };
})()`;

/* Warp, then sample for 120 frames. The probe takes the camera's WORLD position
   back into the arrival world's tangent frame and compares it against the
   terrain height there — the same surfaceHeight the camera's own boom probe
   uses, so a pass here means the same thing the camera means by it. */
const WARP = (key) => `(async () => {
  const S = window.SURVEYOR;
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const probe = () => {
    const c = S.cam.camera, surf = S.craft.surf;
    const l = surf.frame.toLocal(c.position.x, c.position.y, c.position.z);
    return {
      cam: +(l.y - surf.surfaceHeight(l.x, l.z)).toFixed(2),
      craft: +(S.craft.pos.y - surf.surfaceHeight(S.craft.pos.x, S.craft.pos.z)).toFixed(2),
    };
  };
  S.warp(${JSON.stringify(key)});
  const rows = [];
  for (let i = 0; i < 120; i++) { rows.push(probe()); await frame(); }
  return { rows, landed: S.planet.key, r: Math.round(S.planet.radius) };
})()`;

const { port, close } = await serve(SITE);
const chrome = await launch({ width: 900, height: 560 });
console.log(`${chrome.version}, serving on :${port}\n`);
console.log('from     to       first frames (m above ground)        settles  worst  craft   verdict');

let bad = 0;
for (const key of KEYS) {
  const from = key === 'home' ? 'ember' : 'home';
  const page = await chrome.newPage();
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride',
    { width: 900, height: 560, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.navigate', { url: `http://127.0.0.1:${port}${GAME}?planet=${from}` });
  const r = await evaluate(page, READY);
  if (!r.ok) { console.log(`${from.padEnd(8)} ${key.padEnd(8)} never ready`); bad++; await page.close(); continue; }

  const res = await evaluate(page, WARP(key));
  const rows = res.rows;
  const cam = rows.map((x) => x.cam);
  const worst = Math.min(...cam);
  const settled = cam[cam.length - 1];
  const craft = rows[rows.length - 1].craft;
  // The craft's ride height is the other half of the same class of bug: a
  // spawn placed at sea level is underground on all six. See Craft.settle.
  const ok = worst >= 0 && craft >= 0;
  if (!ok) bad++;
  console.log(`${from.padEnd(8)} ${key.padEnd(8)} ${cam.slice(0, 6).map((v) => String(v).padStart(6)).join('')}   ` +
    `${String(settled).padStart(6)}m ${String(worst).padStart(6)}m ${String(craft).padStart(6)}m  ${ok ? 'ok' : 'UNDER GROUND'}  [${res.landed} r=${res.r}]`);
  await page.close();
}

console.log(bad ? `\n${bad} arrival(s) put something under the ground.` : '\nEvery arrival stayed above ground.');
await chrome.close();
close();
process.exitCode = bad ? 1 : 0;
