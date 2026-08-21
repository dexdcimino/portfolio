// C IS BOUND TWICE, ON PURPOSE, AND THIS IS WHAT SAYS SO SAFELY.
//
//   node dev/keycheck.mjs        exits non-zero if the split has broken
//
// The drone's descend key is C (2026-08-21, after Ctrl was withdrawn for the
// second time — see the note in js/main.js). C was already the camera
// recentre, so it now means two different things in two different forms:
// `main.js` gates `cam.recenter()` on `craft.mode !== 'drone'`, exactly the
// arrangement Shift is already under. That is the shape the drone has been
// bitten by before — one key doing two things, and the bug only showing up in
// the form nobody tested — so it is tested here, in a real browser, through
// real key events, rather than reasoned about.
//
// Four claims, and all four have to hold:
//   1. holding C in the drone lowers the hover line
//   2. ...and does NOT recentre the camera
//   3. ...and the new height stays after the key comes up
//   4. tapping C in a rover still recentres
//
// `dev/run.mjs` cannot cover this: the bindings live in main.js's readInput,
// which needs a document, and the suite drives craft.js's `liftHeld`/`descHeld`
// inputs directly. Between them the input LAYER and the key MAP are both
// covered; neither file covers both.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { launch, serve, evaluate } from './cdp.mjs';
import { createInput } from '../../_shared/dev/capture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../..');
const { port, close } = await serve(SITE);
const chrome = await launch({ width: 900, height: 560 });
const page = await chrome.newPage();
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Emulation.setDeviceMetricsOverride',
  { width: 900, height: 560, deviceScaleFactor: 1, mobile: false });
await page.send('Page.navigate',
  { url: `http://127.0.0.1:${port}/games/surveyor/?planet=home` });
const input = createInput(page);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await evaluate(page, `(async () => {
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
  if (!window.SURVEYOR) return false;
  document.getElementById('begin').click();
  for (let i = 0; i < 40; i++) await frame();
  return true;
})()`);

const read = () => evaluate(page, `(() => {
  const S = window.SURVEYOR;
  return { mode: S.craft.mode, lift: +S.craft.droneLift.toFixed(2),
           y: +S.craft.pos.y.toFixed(1), wantYaw: +S.cam.wantYaw.toFixed(3) };
})()`);

// --- drone: hold C, expect droneLift to go DOWN and no recentre ------------
await input.tap('Digit4'); await wait(400);
await input.down('ShiftLeft'); await wait(3500); await input.up('ShiftLeft');
await wait(600);
const climbed = await read();
/* `recentering` is a TRANSIENT — camera.js clears it the moment the recentre
   lands, and at three frames a second that can be gone before the next read.
   The durable probe is the orbit offset itself: nudge it, then see whether C
   put it back. */
await evaluate(page, `(() => { window.SURVEYOR.cam.wantYaw = 1.0; return 1; })()`);
await input.down('KeyC'); await wait(3500);
const holding = await read();
await input.up('KeyC'); await wait(600);
const dropped = await read();

// --- rover: tap C, expect a recentre ---------------------------------------
await input.tap('KeyR'); await wait(900);
await evaluate(page, `(() => { window.SURVEYOR.cam.wantYaw = 1.0; return 1; })()`);
await input.tap('KeyC'); await wait(900);
const rover = await read();

console.log('drone, after Shift  ', JSON.stringify(climbed));
console.log('drone, holding C    ', JSON.stringify(holding));
console.log('drone, C released   ', JSON.stringify(dropped));
console.log('rover, C tapped     ', JSON.stringify(rover));

/* SIGN, NOT MAGNITUDE. SwiftShader runs this at a few frames a second and the
   game clamps dt at 0.05s, so three and a half seconds of held key is a
   handful of game frames and a couple of metres of travel. The claim being
   tested is which DIRECTION each key moves the hover line, and a bar in metres
   would be a bar on the frame rate. */
const ok1 = climbed.mode === 'drone' && climbed.lift > 0.2;
const ok2 = holding.lift < climbed.lift - 0.2;
/* `recenter()` sets wantYaw to EXACTLY 0. The orbit also eases back toward 0
   on its own when idle (CAM.orbitReturn), so the offset shrinking proves
   nothing — the offset SURVIVING does: an appreciable value means the snap to
   zero never happened. */
const ok3 = holding.wantYaw > 0.05;
const ok4 = Math.abs(dropped.lift - holding.lift) < 0.01;
const ok5 = rover.mode === 'rover' && Math.abs(rover.wantYaw) < 1e-6;
console.log(`\nC descends in the drone      ${ok2 ? 'yes' : 'NO'}  (${climbed.lift} -> ${holding.lift})`);
console.log(`...without recentring        ${ok3 ? 'yes' : 'NO'}  (offset 1.0 -> ${holding.wantYaw}, ` +
  `eased not snapped; a recentre sets it to exactly 0)`);
console.log(`...and the height stays      ${ok4 ? 'yes' : 'NO'}  (${dropped.lift} after release)`);
console.log(`C still recentres in a rover ${ok5 ? 'yes' : 'NO'}  (offset 1.0 -> ${rover.wantYaw})`);
const good = ok1 && ok2 && ok3 && ok4 && ok5;
console.log(good ? '\nC BINDING OK.' : '\nC BINDING BROKEN.');
await chrome.close(); close();
process.exit(good ? 0 : 1);
