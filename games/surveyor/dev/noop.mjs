// Prove a new term is NEUTRAL, by flipping it inside one frozen frame.
//
//   node dev/noop.mjs                 all six worlds
//   node dev/noop.mjs tarn home       just those
//
// WHY THIS EXISTS, and why dev/shots.mjs cannot do it. The house habit for the
// last four passes has been: ship a new term at its neutral value, prove it
// changes nothing, then author. Every one of the four scale errors in T1-T3 was
// caught by that. The obvious way to prove it is to photograph the six worlds
// before and after and compare — and that does not work here. Two runs of
// shots.mjs over IDENTICAL code differ in 85% of their pixels, up to 83 levels:
// the film grain is per-frame noise, the swell is a function of wall-clock time,
// and the chase camera is still settling. A cross-version diff of those frames
// says nothing at all.
//
// So the comparison is made INSIDE one run instead, against a frame that is
// held still:
//
//   1. boot the world and let the chunk queue drain, as shots.mjs does
//   2. stop the render loop, so uTime stops and the swell and the camera freeze
//   3. turn the grain off — it is the one thing left that is random per frame
//   4. render, READ THE FRAMEBUFFER, flip the term, render, read again
//
// Nothing between the two frames changes except the uniform under test, so an
// identical pair is proof and one differing pixel is a finding.
//
// STEP 4 IS gl.readPixels AND NOT A SCREENSHOT, and that is not a detail.
// The first cut of this used Page.captureScreenshot and reported every world
// unstable — three renders of a frozen scene, three different images, with the
// term under test not even flipped between two of them. The engine runs
// preserveDrawingBuffer:false, so a screenshot is whatever Chrome's compositor
// has when it gets round to it, which is a different question from what the
// frame drew. Reading the default framebuffer synchronously in the same task as
// scene.render() asks the right one. (This is very likely the same root cause
// as the known wrong-sky capture noted in shots.mjs.)
//
// WHAT IS UNDER TEST HERE is the water pass: uWaterOn flips the whole
// per-pixel seabed path on and off. With every WATER weight at its shipped
// default the two frames must be identical, which says the depth pass is
// running, bound, and contributing exactly nothing — the state it ships in.
//
// FROM THE SHORELINE CAMERA, NOT THE CHASE CAMERA, and that was not the first
// guess. Run from the default view this reported Tarn, Vault and Anvil as
// having no wired term at all — foam turned up to sixty metres, deeper than any
// water in the game, moving exactly zero pixels. It was telling the truth:
// there is no water in those frames. Tarn is 85% ocean and spawns you on a dry
// ridge. Proving a water term neutral over a picture with no water in it is not
// proof of anything, so this goes and finds a shore first.

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

/* Boot, drain, then FREEZE. Stopping the render loop is what makes the rest of
   this meaningful: it stops uTime, which stops the swell, the foam ripple and
   the sky's clouds, and it stops the chase camera lerping. Grain is switched
   off separately because it is noise by design and would survive a frozen
   clock. */
const FREEZE = `(async () => {
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

  /* THE SHORELINE, and it has to happen while the loop is still running: the
     set-up awaits frames to let setTarget settle. Freezing first would leave
     the camera wherever it was. */
  window.__shore = (await ${SHORE}).shore;

  const engine = S.scene.getEngine();
  engine.stopRenderLoop();
  if (S.pipeline) { S.pipeline.grainEnabled = false; }
  /* PARTICLES ADVANCE ON scene.render(), not on the game loop — they read the
     engine's wall-clock delta directly. With the loop stopped and the grain off
     they were the whole of the residue: 615 scattered pixels out of 504,000,
     drifting between two renders of a scene where nothing else had moved. Dust,
     the engine trail, and any vent plume in frame. Stopped AND reset, because
     stopping only ends emission and leaves the live ones still flying. */
  for (const ps of S.scene.particleSystems.slice()) { ps.stop(); ps.reset(); }
  S.scene.animationsEnabled = false;
  // One render after the loop stops, so the grain removal is in the frame the
  // first screenshot photographs.
  S.scene.render();

  const water = S.scene.getMaterialByName('svWater');
  return {
    ok: true,
    shore: window.__shore,
    // A dry world has no water shell and nothing to prove neutral. Reported as
    // skipped rather than passed: a run that quietly counted Ember as evidence
    // would be claiming six worlds' worth of proof from five.
    dry: !S.planet.hasWater,
    planet: S.planet.name,
    water: !!water,
    // What the pass reports about itself, printed so a run that proves
    // "identical" cannot be a run where the pass quietly did not exist.
    seabed: S.world && S.world.seabed ? S.world.seabed.describe() : ['no world handle'],
  };
})()`;

/* ONE evaluate, three renders, three hashes — all of it inside the page.
   Everything that decides the answer happens between a scene.render() and the
   gl.readPixels on the next line, in one synchronous block, so nothing can slip
   in between drawing the frame and measuring it. */
const PROBE = `(() => {
  const S = window.SURVEYOR;
  const engine = S.scene.getEngine();
  const gl = engine._gl;
  const w = engine.getRenderWidth(), h = engine.getRenderHeight();
  const buf = new Uint8Array(w * h * 4);
  const water = S.scene.getMaterialByName('svWater');

  const shot = () => {
    S.scene.render();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf.slice();
  };
  const hash = (a) => {
    let x = 2166136261;
    for (let i = 0; i < a.length; i++) { x ^= a[i]; x = Math.imul(x, 16777619); }
    return (x >>> 0).toString(16).padStart(8, '0');
  };
  const diff = (a, b) => {
    let px = 0, worst = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i+1] - b[i+1]),
                         Math.abs(a[i+2] - b[i+2]));
      if (d) { px++; if (d > worst) worst = d; }
    }
    return { px, worst, of: a.length / 4 };
  };

  /* THE NEUTRAL VALUES ARE FORCED HERE, not assumed.
     This started as a one-off proof taken before any world was authored, when
     every WATER term was still at its default. The moment Home got an absorb
     and Tarn got a foam width, flipping the pass off legitimately changed the
     picture, and a harness that still printed NOT NEUTRAL would be reporting
     the authoring as a fault. So the probe sets the terms to their neutral
     values itself and puts them back afterwards. What it asks is durable: with
     nothing turned on, does the pass change a single pixel — which is a
     question about the PLUMBING, and stays worth asking for as long as the
     plumbing exists. */
  const keep = {
    p: water._vectors4 ? water._vectors4.uWaterP : null,
    p2: water._vectors4 ? water._vectors4.uWaterP2 : null,
    foam: water._vectors3 ? water._vectors3.uFoamP : null,
    waveN: water._floats ? water._floats.uWaveN : 0,
  };
  const far = keep.p ? keep.p.w : 60000;
  water.setVector4('uWaterP', new BABYLON.Vector4(0, 0.35, 0, far));
  water.setVector4('uWaterP2', new BABYLON.Vector4(0, 0, 3, 0));
  water.setVector3('uFoamP', new BABYLON.Vector3(0, 0, 0.85));
  water.setFloat('uWaveN', 0);

  water.setFloat('uWaterOn', 1); const A = shot();
  water.setFloat('uWaterOn', 0); const B = shot();
  water.setFloat('uWaterOn', 1); const C = shot();
  /* THE POSITIVE CONTROL, and without it the whole run is worthless.
     "Zero pixels changed" has two readings: the pass is neutral, or the uniform
     never reached the shader at all and nothing was ever under test. So one
     term is turned up hard on the way out — three metres of shoreline foam,
     which every world with water has somewhere in frame — and the run only
     passes if THAT moves pixels. A neutral result is only evidence next to a
     wired one. */
  water.setVector3('uFoamP', new BABYLON.Vector3(3.0, 0.0, 0.85));
  const D = shot();
  /* ...and a SECOND control at sixty metres, which is deeper than any water in
     the game. Whatever else is true, that has to repaint every water pixel on
     screen. It separates the two readings of "the 3m control moved nothing":
     the pass is broken here, or there is simply no water within 3m of the
     surface in this frame. Without it those are indistinguishable, and the
     first is a bug while the second is just where the camera is pointing. */
  /* ON A FROZEN WORLD THE ICE IS ALSO LIFTED for this one control, and that is
     not a fudge — it is the finding.
     Vault reported no wired term at sixty metres while five other worlds
     reported a quarter of the frame. The frozen branch ends with
     col = mix(col, ice, uFrozen), and uFrozen is 1 there, so every water term
     the shader computed is overwritten before it reaches the eye. That is
     CORRECT: Vault's surface is ice, and foam under ice would be a bug. But a
     harness that cannot separate "correctly covered" from "never ran" is not
     measuring anything, so the control lifts the ice to ask the second question
     and the label says it did. */
  const frozen = S.planet.iceThickness > 0;
  if (frozen) water.setFloat('uFrozen', 0);
  water.setVector3('uFoamP', new BABYLON.Vector3(60.0, 0.0, 0.85));
  const E = shot();
  if (frozen) water.setFloat('uFrozen', 1);
  // Put the world back the way it was authored.
  if (keep.p) water.setVector4('uWaterP', keep.p);
  if (keep.p2) water.setVector4('uWaterP2', keep.p2);
  if (keep.foam) water.setVector3('uFoamP', keep.foam);
  water.setFloat('uWaveN', keep.waveN);
  return {
    frozen,
    size: [w, h],
    on: hash(A), off: hash(B), backOn: hash(C),
    flip: diff(A, B),      // the claim: the pass on vs off
    control: diff(A, C),   // the control: the same state twice
    wired: diff(A, D),     // the positive control: shoreline foam at 3m
    anyWater: diff(A, E),  // ...and at 60m, which must repaint all of it
  };
})()`;

const { port, close: closeServer } = await serve(SITE);
const chrome = await launch({ width: 900, height: 560 });
console.log(`${chrome.version}, serving on :${port}\n`);

let fails = 0;

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
  });
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride',
    { width: 900, height: 560, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.navigate', { url: `http://127.0.0.1:${port}${GAME}?planet=${key}` });

  let info;
  try { info = await evaluate(page, FREEZE); } catch (e) { info = { ok: false, err: e.message }; }

  if (info.ok && info.dry) {
    console.log(`skip          ${key.padEnd(7)} dry world, no water shell`);
    await page.close();
    continue;
  }
  if (!info.ok) {
    console.log(`FAIL  ${key.padEnd(7)} never reached a frozen frame  ${info.err || ''}`);
    fails++;
    await page.close();
    continue;
  }

  /* THREE renders, not two, and the third is the CONTROL.
     on -> off -> on. The first pair is the claim; the second is proof that this
     rig would have noticed a difference, because "the two frames matched" means
     nothing from a harness that returns matching frames no matter what. */
  let r;
  try { r = await evaluate(page, PROBE); } catch (e) { r = { err: e.message }; }

  if (r.err) {
    console.log(`FAIL  ${key.padEnd(7)} probe threw: ${r.err}`);
    fails++;
  } else {
    const unstable = r.control.px > 0;
    const neutral = r.flip.px === 0;
    const wired = r.anyWater.px > 0;
    const verdict = unstable ? 'UNSTABLE RIG' : !wired ? 'NOT WIRED   '
      : neutral ? 'ok          ' : 'NOT NEUTRAL ';
    if (unstable || !neutral || !wired) fails++;
    const pc = (d) => `${d.px}px (${(100 * d.px / d.of).toFixed(2)}%, max ${d.worst})`;
    console.log(`${verdict}  ${key.padEnd(7)} ${r.size[0]}x${r.size[1]}  ` +
      `neutral flip ${pc(r.flip)}  control ${r.control.px}px  ` +
      `foam@3m ${pc(r.wired)}  ` +
      `${r.frozen ? 'water-under-the-ice' : 'water-in-frame'} ${pc(r.anyWater)}`);
    for (const line of info.seabed || []) console.log(`        ${line}`);
  }
  for (const e of errs.slice(0, 4)) console.log(`        ! ${e}`);
  await page.close();
}

await chrome.close();
closeServer();
console.log(fails === 0
  ? '\nThe water pass is live and changes nothing. Author from here.'
  : `\n${fails} world(s) not neutral.`);
process.exit(fails ? 1 : 0);
