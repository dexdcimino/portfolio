// The last discontinuity in a crossing: a far body becoming a world.
//
//   node dev/handoff.mjs                 home arriving at tarn
//   node dev/handoff.mjs home anvil      another pair
//   node dev/handoff.mjs --gpu           on ANGLE rather than SwiftShader
//
// dev/lodcheck.mjs measures the FIRST handoff, billboard to displaced sphere,
// which happens inside one disc set and can be driven by moving a body. This
// measures the LAST one, and it is a different kind of thing: the destination
// stops being a body in the sky you are standing under and becomes the ground
// you are standing on. Different mesh, different shader, different rendering
// group, and on the far side there is also a water shell, an atmosphere, rocks,
// vegetation and colonies that did not exist a frame earlier.
//
// SO IT CANNOT BE MEASURED BY DIFFING TWO FRAMES OF A CROSSING. The camera is
// re-seated on arrival and the sky changes completely, so a whole-frame
// difference is dominated by everything except the thing under test. Each side
// is isolated the way lodcheck isolates a body: render twice, once with that
// side's geometry shown and once with it hidden, and difference. What is left
// is the destination and nothing else.
//
// Both sides come from ONE session and through the real path — the far body is
// placed with discs.js's own setDistance, and the arrival is the same swapTo a
// player triggers — because a restatement of either is how this project has
// produced confident wrong measurements before.
//
// A WIDE LENS ON BOTH SIDES, and it is not cosmetic. At the approach sphere a
// world subtends 18 degrees (Ember) to 88 (Anvil), and the game's own field of
// view is about 54 — so on the big worlds BOTH sides fill the frame and what
// gets measured is the frame. The first run of this reported home-to-anvil as
// +0.0% size and +0.0% silhouette, which reads as a perfect handoff and is
// really two saturated measurements agreeing that the screen is the screen.
// Both sides are rendered at FOV_MEASURE instead, wide enough that the largest
// body in the system sits inside it with room around it.
//
// WHAT IS REPORTED, and it is three channels rather than one, because the
// billboard-to-sphere handoff measured continuous to 1.1% in SIZE while
// arriving at 0.42 of the brightness. See the continuity invariant.
//
//   size        area-equivalent angular diameter of the lit pixels
//   luminance   mean of those pixels
//   silhouette  how far the limb departs from a circle, which is the channel
//               that carries a 642-direction sphere becoming a quadtree
//
// WHAT IT CANNOT SEE, stated because two of these already produced a wrong
// reading before they were found:
//
//   - a body in SHADOW against a dark sky. The difference threshold is 12
//     levels, and the unlit side of a far body against Home's night sky is
//     under it, so the measured area understates a crescent-lit body.
//   - anything the frame cuts off. Both sides are rendered at FOV_MEASURE for
//     that reason; at the game's own 54 degrees, Anvil overflows and the first
//     run of this reported +0.0% size and +0.0% silhouette, which reads as a
//     perfect handoff and is two saturated measurements agreeing that the
//     screen is the screen.
//   - the halo, if you toggle the whole disc set instead of the body. The
//     billboard's glow reaches the quad's edge and is never faded, and putting
//     it in the difference moved the silhouette figure from 0.032 to 0.356.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { launch, serve, evaluate } from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../..');
const OUT = resolve(HERE, 'shots');
const GAME = '/games/surveyor/';

// 126 degrees: Anvil at its approach sphere is 88 across, and the body has to
// have sky around it or the lit region is bounded by the frame.
const FOV_MEASURE = 2.2;

const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FROM = argv[0] || 'home';
const TO = argv[1] || 'tarn';
const GPU = process.argv.includes('--gpu');
const W = 900, H = 700;

const READY = `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const t0 = performance.now();
  let drained = 0;
  while (performance.now() - t0 < 90000) {
    await frame();
    const S = window.SURVEYOR;
    if (!S) continue;
    drained = S.field.queue.length === 0 ? drained + 1 : 0;
    if (drained > 20) break;
  }
  const S = window.SURVEYOR;
  if (!S) return { ok: false };
  document.getElementById('begin').click();
  document.getElementById('start').style.display = 'none';
  document.getElementById('hud').style.visibility = 'hidden';
  for (let i = 0; i < 30; i++) await frame();
  /* The loop is stopped and the camera taken over. Everything below places the
     camera itself and renders by hand, so nothing may move between the two
     grabs that make up a difference. */
  S.scene.getEngine().stopRenderLoop();
  for (const ps of S.scene.particleSystems.slice()) { ps.stop(); ps.reset(); }
  S.cam.update = () => {};
  if (S.post) S.post.setEnabled(false);
  return { ok: true, planet: S.planet.key };
})()`;

/* The measurement, shared by both sides.

   AREA, NOT A BOUNDING BOX. Toggling a mesh shifts a scatter of unrelated
   pixels by a level or two elsewhere in the frame, and a bounding box is then
   a measure of the outliers — dev/disccheck.mjs reported 75 degrees that way.
   A blob of n pixels has the diameter of a circle of the same area, which is
   what a body actually is and which no scatter of singletons can inflate.

   The silhouette figure is the standard deviation of the lit radius around the
   centroid, over the mean of it: 0 is a perfect disc and a rough limb climbs.
   That is the channel a 642-direction sphere becoming a 5-metre quadtree moves
   in, and neither size nor luminance would show it. */
const MEASURE = `(on, off, w, h, fov) => {
  let n = 0, sr = 0, sg = 0, sb = 0, cx = 0, cy = 0;
  const xs = [], ys = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const d = Math.max(Math.abs(on[i] - off[i]), Math.abs(on[i + 1] - off[i + 1]),
      Math.abs(on[i + 2] - off[i + 2]));
    if (d <= 12) continue;
    n++; sr += on[i]; sg += on[i + 1]; sb += on[i + 2];
    cx += x; cy += y; xs.push(x); ys.push(y);
  }
  if (!n) return { n: 0, deg: 0, lum: 0, rough: 0 };
  cx /= n; cy /= n;
  const perPx = fov / h * 180 / Math.PI;
  // Radius of every lit pixel from the centroid, for the limb figure.
  let sum = 0;
  const rs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = Math.hypot(xs[i] - cx, ys[i] - cy);
    rs[i] = r; sum += r;
  }
  // Only the outer shell describes the limb: the interior is solid and would
  // drag the mean toward zero whatever shape the edge is.
  rs.sort();
  const outer = rs.subarray(Math.floor(n * 0.90));
  let m = 0;
  for (const r of outer) m += r;
  m /= outer.length;
  let v = 0;
  for (const r of outer) v += (r - m) * (r - m);
  const sd = Math.sqrt(v / outer.length);
  return {
    n,
    deg: +(2 * Math.sqrt(n / Math.PI) * perPx).toFixed(3),
    lum: +((0.2126 * sr + 0.7152 * sg + 0.0722 * sb) / n).toFixed(1),
    rough: +(sd / (m || 1)).toFixed(4),
  };
}`;

/* SIDE ONE: the destination as a far body, at the distance the approach sphere
   sits at. Placed with discs.js's own setDistance, and promoted by the disc
   set's own rule, so this is the geometry a player sees and not a rebuild. */
const FAR = (to) => `(async () => {
  const S = window.SURVEYOR, V = BABYLON.Vector3;
  const { setDistance } = await import('/games/surveyor/js/world/discs.js');
  const { PLANETS, HYPER } = await import('/games/surveyor/js/tune.js');
  const { makePlanet } = await import('/games/surveyor/js/world/sphere.js');
  const d = S.discs.list.find((x) => x.key === '${to}');
  if (!d) return { err: 'no disc for ${to}' };
  const P = makePlanet(PLANETS['${to}']);
  const dist = P.surfaceR + HYPER.approachAlt;      // where a hyper arrival lands
  setDistance(S.planet, d, P.radius, dist);

  const c = S.cam.camera;
  const dir = new V(d.dir.x, d.dir.y, d.dir.z).normalize();
  let up = new V(0, 1, 0);
  up = up.subtract(dir.scale(V.Dot(up, dir)));
  if (up.length() < 1e-3) up = V.Cross(dir, new V(1, 0, 0));
  c.upVector.copyFrom(up.normalize());
  c.fov = ${FOV_MEASURE};
  c.setTarget(c.position.add(dir.scale(500)));
  // The ground and the water of the world we are STANDING on are not the
  // subject; hide them so the difference is the far body against sky alone.
  S.world.ground.setEnabled(false);
  if (S.world.water) S.world.water.mesh.setEnabled(false);
  S.discs.update(c);

  const eng = S.scene.getEngine(), gl = eng._gl;
  const w = eng.getRenderWidth(), h = eng.getRenderHeight();
  const grab = () => { const b = new Uint8Array(w * h * 4);
    for (let i = 0; i < 3; i++) S.scene.render();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };

  /* ONLY THE BODY IS TOGGLED, not the whole disc set. The billboard carries a
     halo that reaches to the quad's edge and is never faded out, so toggling
     both put the glow into the difference: the silhouette figure went from
     0.032 to 0.356 purely by widening the lens enough to bring the halo into
     frame, which is a measurement of the halo and not of the limb. Leaving the
     billboard up in BOTH grabs subtracts it exactly. */
  /* --forcefog paints the body's air bright red at full strength. It answers
     one question and it is the question that took longest here: is the shader
     term running at all? With it the body goes from 20.8 to 51.7, so the code
     path is live and the uniforms reach it — which is what turned the search
     from "why is the shader ignoring me" to "why do the real values not close
     the gap". Worth keeping for the next person who adds a term to a shader
     they cannot single-step. */
  const probe = S.discs.bodies.get('${to}');
  /* --forcelit removes the terminator from the far body: every point fully
     lit, as if the sun were behind the camera. It answers whether the step is
     LIGHTING rather than air, which is the question two rounds of fog work
     did not settle. */
  if (probe && window.__forceLit) {
    probe.mat.setFloat('uNight', 1);
    probe.mat.setFloat('uLimb', 1);
  }
  if (probe && window.__forceFog) {
    probe.mat.setVector3('uFog', new BABYLON.Vector3(1, 0, 0));
    probe.mat.setVector3('uFogSun', new BABYLON.Vector3(1, 0, 0));
    probe.mat.setFloat('uFogAmt', 1);
    probe.mat.setVector2('uFogRange', new BABYLON.Vector2(0.001, 0.002));
  }
  const body = S.discs.bodies.get('${to}');
  const measure = ${MEASURE};
  const on = grab();
  if (body) body.mesh.setEnabled(false);
  const off = grab();
  if (body) body.mesh.setEnabled(true);
  const m = measure(on, off, w, h, c.fov);
  const bb = S.discs.bodies.get('${to}');
  const uf = bb && bb.mat && bb.mat._floats ? bb.mat._floats.uFogAmt : undefined;
  const ur = bb && bb.mat && bb.mat._vectors2 ? bb.mat._vectors2.uFogRange : undefined;
  return Object.assign({ promoted: S.discs.promoted.has('${to}'),
    distM: Math.round(dist), drawnDeg: +(2 * d.drawAngle * 180 / Math.PI).toFixed(3),
    fogAmt: uf === undefined ? 'unset' : +uf.toFixed(3),
    fogRange: ur ? [+ur.x.toFixed(1), +ur.y.toFixed(1)] : 'unset',
    airFrom: bb ? bb.airFrom : 'unset', surfaceR: bb ? bb.surfaceR : 'unset' }, m);
})()`;

/* SIDE TWO: the same world, arrived at, through the same swapTo a player
   triggers — then the camera put back exactly where the far body was seen
   from, looking the same way. */
const NEAR = (to) => `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const S = window.SURVEYOR, V = BABYLON.Vector3;
  const { PLANETS, HYPER } = await import('/games/surveyor/js/tune.js');
  const { makePlanet } = await import('/games/surveyor/js/world/sphere.js');
  const d = S.discs.list.find((x) => x.key === '${to}');
  const dir = { x: d.dir.x, y: d.dir.y, z: d.dir.z };
  // Arrive facing the way the far body was seen from: the arrival direction is
  // the radial the craft comes down on, so the reverse of the approach.
  window.dispatchEvent(new Event('blur'));
  S.craft.hyper = null;
  window.SURVEYOR.warp && null;
  const ev = { key: '${to}', dir: { x: -dir.x, y: -dir.y, z: -dir.z },
    alt: HYPER.approachAlt };
  const { emit } = await import('/games/surveyor/js/core/events.js');
  emit('hyperarrive', ev);
  // Let the ground stream in around the arrival point.
  for (let i = 0; i < 400 && S.field.queue.length; i++) { S.field.update(S.craft.surf.frame.up); }
  S.scene.getEngine().stopRenderLoop();
  S.cam.update = () => {};
  if (S.post) S.post.setEnabled(false);
  for (const ps of S.scene.particleSystems.slice()) { ps.stop(); ps.reset(); }

  const P = makePlanet(PLANETS['${to}']);
  const c = S.cam.camera;
  const r = P.surfaceR + HYPER.approachAlt;
  const u = { x: -dir.x, y: -dir.y, z: -dir.z };          // the arrival radial
  c.position.set(u.x * r, u.y * r, u.z * r);
  const look = new V(-u.x, -u.y, -u.z);                   // straight down at it
  let up2 = new V(0, 1, 0);
  up2 = up2.subtract(look.scale(V.Dot(up2, look)));
  if (up2.length() < 1e-3) up2 = V.Cross(look, new V(1, 0, 0));
  c.upVector.copyFrom(up2.normalize());
  c.fov = ${FOV_MEASURE};
  c.setTarget(new V(0, 0, 0));

  /* THE MATERIALS HAVE TO BE TOLD WHERE THE CAMERA IS, and the first version
     of this did not. mats.update carries the camera position, the tangent
     basis and the ALTITUDE, and the fog rule answers to altitude — so grabbing
     without it renders the arrival with the fog the spawn had, at ground
     level, on a world 414m across. That came back as a featureless white disc
     and read as a 193% brightness cliff that was the harness's, not the
     game's. */
  const fr = S.craft.surf.frame;
  const alt = Math.max(0, r - P.surfaceR);
  for (let i = 0; i < 3; i++) {
    S.world.mats.update(1 / 60, c.position, 0, fr.up, fr.east, fr.north, alt);
  }

  const eng = S.scene.getEngine(), gl = eng._gl;
  const w = eng.getRenderWidth(), h = eng.getRenderHeight();
  const grab = () => { const b = new Uint8Array(w * h * 4);
    for (let i = 0; i < 3; i++) S.scene.render();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };

  const measure = ${MEASURE};
  const water = S.world.water ? S.world.water.mesh : null;

  /* ATTRIBUTION, one layer at a time. Two rounds of shader work went into a
     cause that had not been established, so each piece of the arrival is
     isolated the same way the whole was: shown, hidden, differenced.
       world   ground and water together, which is what the step was measured on
       ground  the terrain alone
       water   the shell alone, on the worlds that have one
       sky     the dome behind all of it */
  const on = grab();
  S.world.ground.setEnabled(false);
  if (water) water.setEnabled(false);
  const off = grab();                       // sky only
  S.world.ground.setEnabled(true);
  const groundOn = grab();                  // sky + ground
  S.world.ground.setEnabled(false);
  if (water) water.setEnabled(true);
  const waterOn = grab();                   // sky + water
  S.world.ground.setEnabled(true);
  const m = measure(on, off, w, h, c.fov);
  const mg = measure(groundOn, off, w, h, c.fov);
  const mw = water ? measure(waterOn, off, w, h, c.fov) : { n: 0, deg: 0, lum: 0 };
  // The dome's own brightness, over the pixels the world covers.
  let skyN = 0, skySum = 0;
  for (let i = 0; i < off.length; i += 4) {
    const dd = Math.max(Math.abs(on[i] - off[i]), Math.abs(on[i + 1] - off[i + 1]),
      Math.abs(on[i + 2] - off[i + 2]));
    if (dd <= 12) continue;
    skyN++;
    skySum += 0.2126 * off[i] + 0.7152 * off[i + 1] + 0.0722 * off[i + 2];
  }
  const skyBehind = skyN ? +(skySum / skyN).toFixed(1) : 0;
  return Object.assign({ world: S.planet.key, leaves: S.field.live.size,
    distM: Math.round(r), altM: Math.round(alt), hasWater: !!water,
    groundLum: mg.lum, groundPx: mg.n, waterLum: mw.lum, waterPx: mw.n,
    skyBehind }, m);
})()`;

const SHOT = `(() => {
  const S = window.SURVEYOR;
  for (let i = 0; i < 2; i++) S.scene.render();
  return 1;
})()`;

const { port, close } = await serve(SITE);
const chrome = await launch({ width: W, height: H, gpu: GPU });
const page = await chrome.newPage();
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Emulation.setDeviceMetricsOverride',
  { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await page.send('Page.navigate', { url: `http://127.0.0.1:${port}${GAME}?planet=${FROM}` });

if (process.argv.includes('--forcefog')) await evaluate(page, 'window.__forceFog = true');
if (process.argv.includes('--forcelit')) await evaluate(page, 'window.__forceLit = true');
const r = await evaluate(page, READY);
if (!r.ok) {
  console.log('never ready');
  await chrome.close(); close(); process.exit(1);
}

const far = await evaluate(page, FAR(TO));
await evaluate(page, SHOT);
{
  const s = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/handoff-far.png`, Buffer.from(s.data, 'base64'));
}
const near = await evaluate(page, NEAR(TO));
await evaluate(page, SHOT);
{
  const s = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/handoff-near.png`, Buffer.from(s.data, 'base64'));
}

const pct = (a, b) => (b ? ((a - b) / b) * 100 : 0);
console.log(`${FROM} -> ${TO}, at the approach sphere (${far.distM}m from centre)\n`);
if (far.err) { console.log('far side:', far.err); }
console.log('              far body    the world     step');
console.log(`size        ${String(far.deg).padStart(9)}° ${String(near.deg).padStart(11)}° ` +
  `${(pct(near.deg, far.deg) >= 0 ? '+' : '') + pct(near.deg, far.deg).toFixed(1)}%`);
console.log(`luminance   ${String(far.lum).padStart(10)} ${String(near.lum).padStart(12)} ` +
  `${(pct(near.lum, far.lum) >= 0 ? '+' : '') + pct(near.lum, far.lum).toFixed(1)}%`);
console.log(`silhouette  ${String(far.rough).padStart(10)} ${String(near.rough).padStart(12)} ` +
  `${(pct(near.rough, far.rough) >= 0 ? '+' : '') + pct(near.rough, far.rough).toFixed(1)}%`);
console.log(`pixels      ${String(far.n).padStart(10)} ${String(near.n).padStart(12)}`);
console.log(`\nfar body promoted: ${far.promoted}; the world streamed ${near.leaves} leaves`);
console.log('the world, by layer:  ground ' + near.groundLum + ' over ' + near.groundPx + 'px' + '  water ' + near.waterLum + ' over ' + near.waterPx + 'px' + '  sky behind it ' + near.skyBehind + (near.hasWater ? '' : '   (dry world)'));
console.log('far body air: amt ' + far.fogAmt + ', range ' + JSON.stringify(far.fogRange) + ', airFrom ' + far.airFrom + ', surfaceR ' + far.surfaceR);
console.log(`frames -> dev/shots/handoff-far.png, dev/shots/handoff-near.png`);

await page.close();
await chrome.close();
close();
