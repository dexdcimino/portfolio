// The six-way screenshot harness.
//
//   node dev/shots.mjs                    all six worlds + the contact sheet
//   node dev/shots.mjs ember vault        just those
//   node dev/shots.mjs --tag before       writes shots/before-<key>.png
//   node dev/shots.mjs --size 1280x800    bigger, slower
//
// This exists because no assertion can tell you two worlds look alike. It boots
// the real game once per planet through ?planet=<key>, waits for the chunk queue
// to drain rather than sleeping and hoping, and lays the six frames out side by
// side — which is the only way the "could these two be mistaken for each other"
// question gets asked honestly.
//
// It also reports every console error and page exception per world, so a world
// that renders but throws does not pass on the strength of a pretty picture.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { launch, serve, evaluate, wait } from './cdp.mjs';
// The shoreline set-up, shared with dev/noop.mjs — see dev/frames.mjs for why
// it is shared rather than copied.
import { SHORE, ALOFT } from './frames.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
/* SERVED FROM THE REPO ROOT, not from this game's folder, and the game is
   loaded at its real path. js/pausemenu.js imports the shared audio mixer from
   games/_shared/ — one directory ABOVE this game — which is correct on the site
   and a 404 against a server rooted here. Serving the root is also simply more
   honest: it is the path the game actually ships at. */
const SITE = resolve(HERE, '../../..');
const GAME = '/games/surveyor/';

const OUT = join(HERE, 'shots');

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const tag = flag('tag', '');
const [W, H] = flag('size', '900x560').split('x').map(Number);
const only = argv.filter((a) => !a.startsWith('--') && !/^\d+x\d+$/.test(a) && a !== tag);

// Read straight out of tune.js so the harness cannot fall out of step with the
// system: a seventh world shows up here the moment it is declared.
const { PLANETS } = await import('../js/tune.js');
const KEYS = Object.keys(PLANETS).filter((k) => !only.length || only.includes(k));

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const name = (key) => (tag ? `${tag}-${key}` : key) + '.png';

/* Wait for the world, then hold still for a moment.
   The queue draining is the real signal — the terrain streams in over dozens of
   frames at 2 leaves apiece, and a fixed sleep either wastes ten seconds or
   photographs a half-built planet. The extra settle frames are for the chase
   cam, which lerps into place. */
const READY = `(async () => {
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
  // The start card covers the whole viewport and the HUD is not the thing under
  // test. Dismissing rather than hiding, so the game is in its real running
  // state and not a paused one.
  document.getElementById('begin').click();
  document.getElementById('hud').style.visibility = 'hidden';
  document.getElementById('start').style.display = 'none';
  for (let i = 0; i < 60; i++) await frame();
  return {
    ok: true,
    planet: S.planet.name,
    radius: S.planet.radius,
    leaves: S.field.live.size,
    y: +S.craft.pos.y.toFixed(1),
    mode: S.craft.mode,
  };
})()`;

/* The second frame: the survey overlay, held.
   Photographing this is the only way to check the claim it makes — that the
   markers draw THROUGH the terrain — on all six worlds at once. A field is
   planted first through the same `restore` path a reload uses, because an
   overlay of an empty world proves nothing, and the key is dispatched rather
   than the overlay poked, since main.js drives the held state from the key
   every frame and would overwrite anything set directly. */
const OVERLAY = `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const S = window.SURVEYOR;
  const P = S.planet, col = S.colonies;
  const TF = Object.getPrototypeOf(S.surface.frame).constructor;
  let id = 1;
  for (let i = 0; i < col.geysers.length; i++) {
    const fr = new TF(P, col.geysers[i].dir);
    for (let j = 0; j < 1 + (i % 3); j++) {
      const d = fr.dirAt(j * P.radius * 0.012, j * P.radius * 0.008, { x: 0, y: 0, z: 0 });
      // Every other vent is claimed, so the frame carries both states of the
      // marker rather than a field of one colour.
      col.restore({ id: id++, dir: [d.x, d.y, d.z], age: 150 + i * 40,
        geyser: i % 2 ? null : col.geysers[i].id }, 0);
    }
  }
  col.tick(1 / 60);
  for (let i = 0; i < 4; i++) S.raiders.spawn(col.sites[i % col.sites.length]);
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' }));
  // The HUD comes back for this one frame only: the system view is half of what
  // the overlay IS, and a photograph of the markers without it is half a test.
  document.getElementById('hud').style.visibility = '';
  for (let i = 0; i < 30; i++) await frame();
  return { markers: S.overlay.markers, sites: col.sites.length };
})()`;

/* The third frame: the sky, aimed at another world.
   Half of this phase is sky, and the chase cam points at the craft — from the
   default view the sky is a strip above the horizon. So the cam is frozen and
   pointed at whichever neighbouring world sits highest above the local horizon,
   which makes one frame test both things at once and makes it deterministic:
   the discs are a few pixels across, and "look up and hope" photographs an
   empty sky about nine times in ten.
   Frozen rather than replaced: the bloom pipeline is attached to that camera,
   and Ember's cracks and the discs' haloes are both bloom. */
const SKYWARD = `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const S = window.SURVEYOR;
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyQ' }));
  document.getElementById('hud').style.visibility = 'hidden';
  const c = S.cam.camera;
  S.cam.update = () => {};
  const up = S.surface.frame.up;
  const U = new BABYLON.Vector3(up.x, up.y, up.z);
  let best = null, bestEl = -2;
  for (const d of S.discs.list) {
    const el = d.dir.x * up.x + d.dir.y * up.y + d.dir.z * up.z;
    if (el > bestEl) { bestEl = el; best = d; }
  }
  let dir;
  if (best) {
    dir = new BABYLON.Vector3(best.dir.x, best.dir.y, best.dir.z);
    // Still lift the aim if the highest neighbour is near the skyline, or the
    // frame fills with ground and photographs no sky at all.
    if (bestEl < 0.30) dir = dir.add(U.scale(0.30 - bestEl)).normalize();
  } else {
    const f = c.getForwardRay().direction.normalize();
    dir = f.scale(Math.cos(0.73)).add(U.scale(Math.sin(0.73))).normalize();
  }
  const aim = c.position.add(dir.scale(200));
  for (let i = 0; i < 20; i++) { c.setTarget(aim); await frame(); }
  /* Both sizes, because they are no longer the same number: angle is the
     honest half-angle and drawAngle is what is rasterised, compressed toward
     a readable band by SYSTEM.drawRef/drawExp/drawFloor. Printing only the
     honest one made a disc look four times smaller than the pixels in the
     photograph beside it. */
  return {
    discs: S.discs.list.length,
    aimed: best ? best.key : null,
    px: best ? +(2 * best.angle / (c.fov / ${H})).toFixed(1) : 0,
    drawnPx: best ? +(2 * best.drawAngle / (c.fov / ${H})).toFixed(1) : 0,
    up: S.discs.list.filter((d) =>
      d.dir.x * up.x + d.dir.y * up.y + d.dir.z * up.z > 0.02).length,
  };
})()`;

/* KNOWN, OPEN, AND NOT THE GAME.
   Occasionally a world's captured PNG comes back wearing the previous world's
   sky — Vault after Ember, most often. The game is fine: probed in the same
   browser and the same sequence, that world's sky uniforms are correct, a
   readPixels off the framebuffer returns the right colour, and an independent
   harness running the identical setup captures it correctly. It is something
   between the render and Page.captureScreenshot, on an engine that runs
   preserveDrawingBuffer:false.
   Two things were tried and neither fixed it, so neither is in this file:
   waiting after Target.closeTarget for the GPU context to release, and
   capturing twice to force a fresh composite. Until it is understood, CHECK THE
   SHEET — a world wearing a neighbour's sky is this, and re-shooting that world
   alone has been correct every time. */

const { server, port, close: closeServer } = await serve(SITE);
const chrome = await launch({ width: W, height: H });
console.log(`${chrome.version}, serving ${ROOT} on :${port}\n`);

let problems = 0;
const rows = [];

for (const key of KEYS) {
  const page = await chrome.newPage();
  const errs = [];
  page.on((method, params) => {
    if (method === 'Runtime.exceptionThrown') {
      errs.push('exception: ' + (params.exceptionDetails.exception?.description
        || params.exceptionDetails.text));
    }
    if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
      errs.push('console.error: ' + params.args.map((a) => a.value || a.description).join(' '));
    }
    // Chrome reports a blocked inline script or a refused connection here, and
    // nowhere else — this is the CSP half of the verification. The favicon is
    // the one 404 that is not a finding: this repo ships no icon on purpose.
    if (method === 'Log.entryAdded' && params.entry.level === 'error' &&
        !/favicon/.test(params.entry.url || '')) {
      errs.push(params.entry.source + ': ' + params.entry.text);
    }
  });
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride',
    { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  await page.send('Page.navigate', { url: `http://127.0.0.1:${port}${GAME}?planet=${key}` });
  let info;
  try {
    info = await evaluate(page, READY);
  } catch (err) {
    info = { ok: false, err: err.message };
  }

  if (info.ok) {
    const shot = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, name(key)), Buffer.from(shot.data, 'base64'));

    // The overlay, from the same camera, with a field planted under it.
    Object.assign(info, await evaluate(page, OVERLAY));
    const ov = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, name(key + '-survey')), Buffer.from(ov.data, 'base64'));

    Object.assign(info, await evaluate(page, SKYWARD));
    const sky = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, name(key + '-sky')), Buffer.from(sky.data, 'base64'));

    // ...and the water's edge, on the five worlds that have one.
    Object.assign(info, await evaluate(page, SHORE));
    if (info.shore) {
      const sh = await page.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(OUT, name(key + '-shore')), Buffer.from(sh.data, 'base64'));
    }

    // ...and the same world from a jet, which is the only frame that can show
    // whether its fog leaves anything to navigate by.
    Object.assign(info, await evaluate(page, ALOFT));
    const al = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, name(key + '-aloft')), Buffer.from(al.data, 'base64'));
  }

  const bad = !info.ok || errs.length;
  if (bad) problems++;
  rows.push({ key, info, errs });
  console.log(`${bad ? 'FAIL' : ' ok '}  ${key.padEnd(7)} ` +
    (info.ok
      ? `R=${String(info.radius).padStart(4)}m  ${String(info.leaves).padStart(3)} leaves  ` +
        `spawn y=${String(info.y).padStart(5)}m  ${info.discs} discs, ` +
        `${info.up} above the horizon, ` +
        `sky shot aimed at ${info.aimed} (${info.px}px honest, ${info.drawnPx}px drawn)`
      : 'never became ready' + (info.err ? ' — ' + info.err : '')));
  if (info.ok) {
    console.log(`        overlay: ${info.markers} markers over ${info.sites} colonies`);
    console.log(`        aloft: ${info.aloft}m`);
    console.log(`        shore: ` + (info.shore
      ? `found at ${info.shore}m from spawn`
      : (PLANETS[key].dry ? 'dry world, no water frame' : 'NONE FOUND within half a radius')));
  }
  for (const e of errs) console.log(`        ! ${e}`);

  await chrome.browser.send('Target.closeTarget', { targetId: page.targetId });
  await page.close();

  await wait(150);
}

// ---- contact sheets -----------------------------------------------------
// The actual test. Six frames at thumbnail size, in one image, because that is
// the size at which two worlds being interchangeable becomes obvious. One sheet
// of ground, one of sky.
if (KEYS.length > 1) {
  for (const view of ['', '-survey', '-sky', '-shore', '-aloft']) {
    // The shore sheet is five wide, not six: Ember has no water, and a blank
    // cell captioned "Ember" would read as a world that failed to render.
    const shown = KEYS.filter((k) => view !== '-shore' || rows.some(
      (r) => r.key === k && r.info.shore));
    if (!shown.length) continue;
    const cells = shown.map((k) => `  <figure><img src="${name(k + view)}" alt="${k}">` +
      `<figcaption>${PLANETS[k].name} · R=${PLANETS[k].radius}m</figcaption></figure>`).join('\n');
    const html = 'sheet' + view + '.html';
    writeFileSync(join(OUT, html),
      '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">' +
      `<title>Surveyor — six worlds${view ? ', sky' : ''}</title>` +
      '<link rel="stylesheet" href="sheet.css"></head>\n<body>\n' +
      `<main>\n${cells}\n</main>\n</body></html>\n`);

    const page = await chrome.newPage();
    await page.send('Page.enable');
    await page.send('Page.navigate', { url: `http://127.0.0.1:${port}${GAME}dev/shots/${html}` });
    await wait(1200);
    const size = await evaluate(page, `(async () => {
      await new Promise((r) => requestAnimationFrame(r));
      const d = document.documentElement;
      return { w: d.scrollWidth, h: d.scrollHeight };
    })()`);
    await page.send('Emulation.setDeviceMetricsOverride',
      { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: false });
    await wait(400);
    // JPEG, and only the sheets. The six full frames are 500KB of PNG each and
    // are regenerable in one command; the sheet is the artefact worth keeping
    // in the repo, and at 2748px wide it has to be small enough to be worth it.
    const shot = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
    const sheet = (tag ? tag + '-' : '') + 'sixup' + view + '.jpg';
    writeFileSync(join(OUT, sheet), Buffer.from(shot.data, 'base64'));
    console.log(`sheet  ${size.w}x${size.h}  -> dev/shots/${sheet}`);
    await chrome.browser.send('Target.closeTarget', { targetId: page.targetId });
    await page.close();
  }
}

await chrome.close();
closeServer();
server.unref();

console.log(problems ? `\n${problems} world(s) with problems.` : '\nAll worlds rendered clean.');
process.exit(problems ? 1 : 0);
