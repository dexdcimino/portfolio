// Cold load WITH A SAVE FILE — the condition every other harness here is blind to.
//
//   node dev/savedworlds.mjs            Home, with and without a save
//   node dev/savedworlds.mjs vault      from another world
//   node dev/savedworlds.mjs --shot     ...and write the frame
//
// WHY THIS FILE EXISTS. Every harness in dev/ launches Chrome on a throwaway
// --user-data-dir. localStorage is therefore empty, economy.load() returns
// null, and the restore loop in main.js never runs. That loop is the ONLY
// thing that calls Worlds.get() for a world you are not standing on, and
// Worlds.get() constructs a full World — sky dome, water shell, disc set.
//
// Babylon enables a new mesh by default, and enter() only ever deactivates the
// world you are LEAVING. So on a cold load with a save, every saved world's
// sky dome drew at once: concentric spheres around the shared planet centre,
// each sized off its own world's far plane, some of which you are standing
// outside. That is the hard-edged faceted ball in another world's sky colour
// hanging in the middle of the view. No measurement of the sun or of the
// planet discs could have found it, because none of them ran with a save.
//
// A pass is exactly one sky dome, one disc set and at most one water shell on
// screen, however many worlds are in the save.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { launch, serve, evaluate } from './cdp.mjs';
import { buildSave, seedSave, describeSave } from './savefile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../..');
const argv = process.argv.slice(2);
const shot = argv.includes('--shot');
const FROM = argv.filter((a) => !a.startsWith('--'))[0] || 'home';
const { PLANETS } = await import('../js/tune.js');

/* Every world, with colonies already on the ground and vents already claimed.
   Built by dev/savefile.mjs, which is the shared seeded-save mode every browser
   harness here can opt into with --save. */
const SAVE = buildSave({ sites: 2 });

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

const ENUM = `(() => {
  const S = window.SURVEYOR;
  const on = S.scene.meshes.filter((m) => m.isEnabled());
  const named = (n) => on.filter((m) => m.name === n).length;
  return {
    built: [...S.worlds.map.keys()],
    current: S.worlds.current ? S.worlds.current.planet.key : null,
    rows: [...S.worlds.map.entries()].map(([k, w]) => ({
      key: k,
      active: w.active,
      sky: w.sky ? w.sky.isEnabled() : null,
      water: w.water ? w.water.mesh.isEnabled() : null,
      discs: w.discs && w.discs.mesh ? w.discs.mesh.isEnabled() : null,
      domeD: w.sky ? Math.round(w.sky.getBoundingInfo().boundingSphere.radius * 2) : null,
    })),
    colonies: [...S.worlds.map.entries()].reduce((a, [, w]) => a + w.colonies.sites.length, 0),
    claimed: [...S.worlds.map.entries()].reduce((a, [, w]) =>
      a + w.colonies.sites.filter((x) => x.geyser).length, 0),
    skies: named('sky'),
    waters: named('water'),
    discs: named('discs'),
    camR: Math.round(Math.hypot(S.cam.camera.position.x, S.cam.camera.position.y,
      S.cam.camera.position.z)),
  };
})()`;

let bad = 0;
const { port, close } = await serve(SITE);
const chrome = await launch({ width: 900, height: 560, gpu: true });
console.log(`${chrome.version}\n`);

for (const withSave of [false, true]) {
  const page = await chrome.newPage();
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride',
    { width: 900, height: 560, deviceScaleFactor: 1, mobile: false });
  if (withSave) {
    // Seeded before any game script runs, so the restore loop sees it at boot.
    await seedSave(page, SAVE);
  }
  await page.send('Page.navigate', { url: `http://127.0.0.1:${port}/games/surveyor/?planet=${FROM}` });
  const r = await evaluate(page, READY);
  if (!r.ok) { console.log(`${FROM}: never ready`); bad++; await page.close(); continue; }

  const e = await evaluate(page, ENUM);
  console.log(`=== cold load of ${FROM}, save present: ${withSave} ===`);
  console.log(`worlds constructed: ${e.built.join(', ')}   current: ${e.current}`);
  console.log(`camera is ${e.camR}m from the planet centre`);
  console.log('  world    active   sky    water  discs   dome across');
  for (const w of e.rows) {
    console.log(`  ${w.key.padEnd(8)} ${String(w.active).padEnd(8)} ${String(w.sky).padEnd(6)} ` +
      `${String(w.water).padEnd(6)} ${String(w.discs).padEnd(7)} ${String(w.domeD).padStart(7)}m`);
  }
  console.log(`RESTORED: ${e.colonies} colonies, ${e.claimed} of them on a claimed vent`);
  console.log(`ON SCREEN: ${e.skies} sky dome(s), ${e.waters} water shell(s), ${e.discs} disc set(s)`);
  const ok = e.skies === 1 && e.discs === 1 && e.waters <= 1;
  if (!ok) { bad++; console.log('  FAIL: more than one world is being drawn.'); }
  /* The save has to have actually been taken, or this whole run is measuring
     the no-save case twice and reporting a pass. A blob the game silently
     dropped looks exactly like the clean case. */
  if (withSave && e.colonies === 0) {
    bad++;
    console.log('  FAIL: the seeded save restored nothing — the game did not take it.');
  }
  console.log('');

  /* ...and again after a warp, because the fix moved when the meshes are shown
     and enter() is the path that has to turn them back on. A world that is
     born hidden and never shown is the same bug with the sign flipped. */
  if (withSave) {
    const to = Object.keys(PLANETS).find((k) => k !== FROM);
    await evaluate(page, `(async () => {
      const f = () => new Promise((r) => requestAnimationFrame(r));
      window.SURVEYOR.warp(${JSON.stringify(to)});
      for (let i = 0; i < 90; i++) await f();
    })()`);
    const w = await evaluate(page, ENUM);
    const shown = w.rows.find((x) => x.sky);
    console.log(`  after warping to ${to}: ${w.skies} sky dome(s) on screen, ` +
      `and it is ${shown ? shown.key : 'none'} (current is ${w.current})`);
    if (w.skies !== 1 || !shown || shown.key !== w.current) {
      bad++;
      console.log('  FAIL: the wrong number of worlds is visible after a warp.');
    }
    console.log('');
  }

  if (shot) {
    await evaluate(page, `document.getElementById('hud').style.visibility='hidden'`);
    const png = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(resolve(HERE, `shots/savedworlds-${FROM}-${withSave ? 'save' : 'nosave'}.png`),
      Buffer.from(png.data, 'base64'));
  }
  await page.close();
}

console.log(bad
  ? `FAIL: ${bad} case(s) drew more than one world at once.`
  : 'Only the current world is on screen, save or no save.');
await chrome.close();
close();
process.exitCode = bad ? 1 : 0;
