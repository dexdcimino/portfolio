// Where does the craft actually start, and what does it do in the first second?
//
//   node dev/spawncheck.mjs                 all six, boot spawn
//   node dev/spawncheck.mjs --warp          ...then dev-warp to each of the others
//
// Written because "the spawn is too high" and "the spawn is underground" look
// identical from a still frame taken a second later: both end with the craft
// sitting on the ground, and the only difference is which way it travelled to
// get there and whether you saw it happen. This samples every frame from the
// first one and reports the extremes.
//
// The craft's y is height above SEA LEVEL, not above the ground — which is the
// whole reason this can go wrong. findSpawn returns a DIRECTION and has never
// returned a height; the placement is a separate line, and it puts the craft at
// y = 0 on a spawn whose ground is guaranteed to be above sea level, because
// the spawn band starts at relief * 0.12.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { launch, serve, evaluate } from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../..');
const GAME = '/games/surveyor/';

const argv = process.argv.slice(2);
const doWarp = argv.includes('--warp');
const only = argv.filter((a) => !a.startsWith('--'));
const { PLANETS } = await import('../js/tune.js');
const KEYS = Object.keys(PLANETS).filter((k) => !only.length || only.includes(k));

/* Sample from the FIRST frame. The start card is dismissed immediately rather
   than after the usual settle, because everything worth seeing here happens in
   the frames the settle was hiding. */
const TRACE = `(async () => {
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

  const rows = [];
  for (let i = 0; i < 120; i++) {
    const c = S.craft;
    const gh = S.surface.surfaceHeight(c.pos.x, c.pos.z);
    rows.push({ y: c.pos.y, gh, above: c.pos.y - gh });
    await frame();
  }
  const above = rows.map((r) => r.above);
  return {
    ok: true,
    ground: +rows[0].gh.toFixed(1),
    first: +rows[0].above.toFixed(1),
    min: +Math.min(...above).toFixed(1),
    max: +Math.max(...above).toFixed(1),
    settled: +above[above.length - 1].toFixed(1),
    mode: S.craft.mode,
  };
})()`;

const warpTrace = (key) => `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const S = window.SURVEYOR;
  // The HUD's warp row is the only caller; this is the same function it binds.
  S.warp('${key}');
  const rows = [];
  for (let i = 0; i < 120; i++) {
    const c = S.craft;
    /* c.surf, NOT S.surface. window.SURVEYOR.surface is the BOOT world's — a
       warp builds a new Surface and hands it to the craft, leaving the module's
       const pointing at where you came from. Measuring against it reported the
       craft 5m underground on Ember by comparing its height to Home's terrain. */
    const gh = c.surf.surfaceHeight(c.pos.x, c.pos.z);
    rows.push(c.pos.y - gh);
    await frame();
  }
  return { first: +rows[0].toFixed(1), settled: +rows[rows.length - 1].toFixed(1),
           mode: S.craft.mode, radius: S.planet.radius };
})()`;

const { port, close } = await serve(SITE);
const chrome = await launch({ width: 900, height: 560 });
console.log(`${chrome.version}, serving on :${port}\n`);
console.log('world    R     ground   frame 0    lowest   highest   after 2s   mode');

for (const key of KEYS) {
  const page = await chrome.newPage();
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride',
    { width: 900, height: 560, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.navigate', { url: `http://127.0.0.1:${port}${GAME}?planet=${key}` });
  let r;
  try { r = await evaluate(page, TRACE); } catch (e) { r = { ok: false, err: e.message }; }
  if (!r.ok) { console.log(`${key.padEnd(8)} never ready ${r.err || ''}`); await page.close(); continue; }
  const m = (v) => (v > 0 ? '+' : '') + v.toFixed(1) + 'm';
  console.log(`${key.padEnd(8)}${String(PLANETS[key].radius).padStart(5)} ` +
    `${(r.ground.toFixed(1) + 'm').padStart(7)} ${m(r.first).padStart(9)} ` +
    `${m(r.min).padStart(9)} ${m(r.max).padStart(9)} ${m(r.settled).padStart(10)}   ${r.mode}`);

  if (doWarp) {
    // Every world, not the filtered list — `node dev/spawncheck.mjs home --warp`
    // means "boot on home, then warp everywhere", and filtering both loops by
    // the same list made the inner one empty.
    for (const other of Object.keys(PLANETS)) {
      if (other === key) continue;
      const w = await evaluate(page, warpTrace(other));
      console.log(`         warp -> ${other.padEnd(7)} frame 0 ${m(w.first).padStart(9)} ` +
        `after 2s ${m(w.settled).padStart(9)}  ${w.mode}  ` +
        `(${(w.first / w.radius).toFixed(2)} x radius)`);
    }
    break;
  }
  await page.close();
}

await chrome.close();
close();
