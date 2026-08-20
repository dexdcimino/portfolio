// How big is each planet disc, honestly and as drawn?
//
//   node dev/disccheck.mjs             from Home
//   node dev/disccheck.mjs vault       from Vault
//   node dev/disccheck.mjs --all       from every world
//
// A giant disc in the sky and a correctly sized one in the same frame means the
// disc system works and one entry in it does not. This prints, for every
// neighbour of the world you are standing on:
//
//   - its direction, as the unit vector the billboard is placed along
//   - its TRUE angular diameter, radius over distance, the honest number
//   - its DRAWN angular diameter, after SYSTEM.drawRef/drawExp/drawFloor
//   - its QUAD's angular diameter, which is the drawn disc times SYSTEM.pad
//     and is where the glow lives
//   - and what it ACTUALLY covers on screen, measured by rendering the frame
//     twice with the disc mesh enabled and disabled and differencing
//
// The last one is the only one that cannot lie. The three above it are what the
// CPU believes; if they disagree with it, the fault is in the shader or in the
// quad, not in the compression chain.
//
// Exits non-zero if a disc is COMPUTED wider than MAX_DEG, or MEASURED wider
// than the frame it is in. Two different bars because they are two different
// measurements — see the note on them further down.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { launch, serve, evaluate } from './cdp.mjs';
import { saveFromArgv, seedSave, describeSave } from './savefile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../..');
const GAME = '/games/surveyor/';

/* What a planet in the sky is allowed to be, in degrees of DRAWN diameter.

   THE BAR HAS TO SIT ABOVE THE AUTHORED RANGE, and for a long time it did not.
   It was 5, which was the right number on 2026-08-17 and stopped being one
   later the same day: the disc compression's reference was raised twenty-fold
   in the sky pass, deliberately, so that a world reads as a place rather than
   as a dot. Computed across all thirty ordered pairs, the design now produces

       3.90 degrees   the drawFloor, which is what a distant world lands on
       6.80 degrees   Anvil seen from Ember, the widest in the system

   so a gate at 5 fails on Shroud and Anvil from a perfectly healthy build. A
   check that fails on a healthy build is worse than no check, because what it
   teaches is that the suite can be ignored.

   8 clears the widest by about a fifth, which is enough headroom for the
   measured on-screen figure to sit a little above the computed one without
   crying wolf, and still catches the failure this harness was written for: a
   single disc drawn at seventy-five degrees while the others were correct.
   Tighten it per run with --max= when you want to gate on design intent rather
   than on breakage. */
const argv = process.argv.slice(2);
const SAVE = saveFromArgv(argv);
const maxArg = argv.find((a) => a.startsWith('--max='));
const MAX_DEG = maxArg ? Number(maxArg.slice(6)) : 8.0;

const all = argv.includes('--all');
const only = argv.filter((a) => !a.startsWith('--'));
const { PLANETS, SYSTEM, SPACE } = await import('../js/tune.js');
const FROM = all ? Object.keys(PLANETS) : (only.length ? only : ['home']);

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
  document.getElementById('hud').style.visibility = 'hidden';
  for (let i = 0; i < 40; i++) await frame();
  const S = window.SURVEYOR;
  S.scene.getEngine().stopRenderLoop();
  for (const ps of S.scene.particleSystems.slice()) { ps.stop(); ps.reset(); }
  S.scene.animationsEnabled = false;
  S.cam.update = () => {};
  return { ok: true };
})()`;

/* What the CPU believes, straight off the Discs instance rather than
   recomputed here — a check that restates the formula it is checking proves
   only that it can copy. */
const NUMBERS = `(() => {
  const S = window.SURVEYOR;
  const D = S.discs;
  const deg = (r) => +(r * 360 / Math.PI).toFixed(3);   // half-angle -> diameter
  return {
    planet: S.planet.key,
    // The far band's compression for this world, and the widest true
    // separation it has to fit inside the frustum. See js/world/space.js.
    k: D.k,
    extent: Math.round(S.spaceExtent / 1000),
    farPlane: Math.round(S.planet.farPlane),
    list: D.list.map((d) => ({
      key: d.key,
      dir: [+d.dir.x.toFixed(4), +d.dir.y.toFixed(4), +d.dir.z.toFixed(4)],
      distKm: +(d.dist / 1000).toFixed(1),
      trueDeg: deg(d.angle),
      drawnDeg: deg(d.drawAngle),
      quadDeg: deg(d.quadAngle),
      core: +d.core.toFixed(4),
      halfM: Math.round(d.half),
      // Where it is actually drawn, in metres from the camera: its true
      // distance compressed by k. Each disc has its own now.
      drawnAt: Math.round(d.K),
    })),
  };
})()`;

/* Aim at one disc and measure what it puts on screen.
   THE POST STACK IS OFF FOR THIS, and that is the whole reason the first
   version of this measurement was useless. The discs are authored past 1.0 so
   they bloom; with bloom on, toggling one changes almost every pixel in the
   frame and the "footprint" came back as 87 degrees in a 54.4 degree frame,
   which is a measurement of the bloom kernel and not of the disc.
   So: post off, render with the disc mesh on, render with it off, difference.
   What is left is exactly the pixels the disc rasterised into. */
const MEASURE = (key) => `(() => {
  const S = window.SURVEYOR;
  const eng = S.scene.getEngine(), gl = eng._gl;
  const w = eng.getRenderWidth(), h = eng.getRenderHeight();
  const c = S.cam.camera, V = BABYLON.Vector3;
  const d = S.discs.list.find((x) => x.key === ${JSON.stringify(key)});
  if (!d) return null;

  /* Point straight at it. The camera's up is built PERPENDICULAR TO THE
     DIRECTION rather than taken from the local vertical: a world sitting near
     your zenith makes setTarget degenerate against a radial up, and the frame
     that comes back is aimed somewhere else entirely. */
  const dir = new V(d.dir.x, d.dir.y, d.dir.z).normalize();
  const fr = S.craft.surf.frame;
  let up = new V(fr.up.x, fr.up.y, fr.up.z);
  up = up.subtract(dir.scale(V.Dot(up, dir)));
  if (up.length() < 1e-3) up = V.Cross(dir, new V(1, 0, 0));
  up = up.normalize();
  c.upVector.copyFrom(up);
  c.setTarget(c.position.add(dir.scale(500)));
  S.world.update(1 / 60, S.craft, c);
  S.world.mats.update(1 / 60, c.position, S.craft.boostHeat,
    fr.up, fr.east, fr.north, S.craft.pos.y);

  const post = S.post;
  const wasPost = post ? post.enabled : false;
  if (post) post.setEnabled(false);

  const grab = () => { const b = new Uint8Array(w * h * 4); S.scene.render();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };

  /* WARM-UP FRAMES, and they are not optional. Detaching the post pipeline
     changes what the camera renders into, and the FIRST render after that
     toggle is not the same picture as the second. Grabbing immediately put a
     whole-frame transient into the difference and reported discs 75 degrees
     across inside a 54.4 degree frame — a number that cannot be a disc, and
     was the pipeline settling. */
  for (let i = 0; i < 3; i++) S.scene.render();

  /* ON, OFF, ON. The third grab is the CONTROL: differenced against the first
     it must come back at zero, because nothing changed between them. If it
     does not, the frame is not stable and the on-vs-off number below is noise
     rather than a disc. */
  const on = grab();
  S.discs.mesh.setEnabled(false);
  const off = grab();
  S.discs.mesh.setEnabled(true);
  const again = grab();
  if (post) post.setEnabled(wasPost);

  /* HOW BIG IS THE BLOB, and the answer is NOT its bounding box.
     Toggling a blended mesh in rendering group 0 shifts a scatter of unrelated
     pixels elsewhere in the frame by a level or two — blend rounding against
     the other transparent things in the scene. Min/max over the lit pixels
     therefore reported 75 degrees while only 1.5% of the frame had changed at
     all: two stray pixels in opposite corners, and a bounding box that is a
     measure of the outliers rather than of the disc.
     So the size is taken from the AREA. A blob of n pixels has the diameter of
     a circle of the same area, which is what a disc actually is and which no
     scatter of singletons can inflate. The bounding box is still printed, from
     the 2nd to the 98th percentile of the lit rows and columns, as the check
     that the blob is round and where it should be. */
  const box = (A, B, cut) => {
    const xs = [], ys = [];
    let n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]),
        Math.abs(A[i + 2] - B[i + 2]));
      if (v > cut) { n++; xs.push(x); ys.push(y); }
    }
    if (!n) return { n: 0, areaPx: 0, boxPx: 0 };
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    const lo = Math.floor(n * 0.02), hi = Math.floor(n * 0.98);
    return {
      n,
      areaPx: 2 * Math.sqrt(n / Math.PI),
      boxPx: Math.max(xs[hi] - xs[lo], ys[hi] - ys[lo]) + 1,
    };
  };

  const perPx = c.fov / h * 180 / Math.PI;   // vertical FOV over the frame height
  const body = box(on, off, 40), reach = box(on, off, 3);
  const noise = box(on, again, 3);

  /* An independent geometric read of the same thing: project two opposite quad
     corners and measure the pixels between them. If this and the rendered
     footprint disagree, the quad and the shader disagree. */
  const proj = (p) => BABYLON.Vector3.Project(p, BABYLON.Matrix.Identity(),
    S.scene.getTransformMatrix(), c.viewport.toGlobal(w, h));
  const ctr = c.position.add(dir.scale(d.K));
  const right = new V(c.getWorldMatrix().m[0], c.getWorldMatrix().m[1], c.getWorldMatrix().m[2]);
  const a = proj(ctr.subtract(right.scale(d.half)));
  const b = proj(ctr.add(right.scale(d.half)));
  const quadPx = Math.abs(b.x - a.x);

  return {
    key: d.key,
    bodyDeg: +(body.areaPx * perPx).toFixed(2),
    bodyBoxDeg: +(body.boxPx * perPx).toFixed(2),
    reachDeg: +(reach.areaPx * perPx).toFixed(2),
    quadPx: Math.round(quadPx),
    quadFromPxDeg: +(quadPx * perPx).toFixed(2),
    pctFrame: +(100 * reach.n / (w * h)).toFixed(2),
    noisePct: +(100 * noise.n / (w * h)).toFixed(3),
    fovDeg: +(c.fov * 180 / Math.PI).toFixed(1),
  };
})()`;

const { port, close } = await serve(SITE);
const chrome = await launch({ width: 900, height: 560 });
console.log(`${chrome.version}\n`);
console.log(`SYSTEM.drawRef   ${SYSTEM.drawRef} rad  (${(SYSTEM.drawRef * 360 / Math.PI).toFixed(2)}° diameter)`);
console.log(`SYSTEM.drawExp   ${SYSTEM.drawExp}`);
console.log(`SYSTEM.drawFloor ${SYSTEM.drawFloor} rad  (${(SYSTEM.drawFloor * 360 / Math.PI).toFixed(2)}° diameter)`);
console.log(`SYSTEM.pad       ${SYSTEM.pad}`);
console.log(`SYSTEM.minAngle  ${SYSTEM.minAngle} rad  (${(SYSTEM.minAngle * 360 / Math.PI).toFixed(2)}° diameter)`);
console.log(`SYSTEM.distance  ${SYSTEM.distance} of farPlane\n`);

let bad = 0;
for (const from of FROM) {
  const page = await chrome.newPage();
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride',
    { width: 900, height: 560, deviceScaleFactor: 1, mobile: false });
  // --save measures the discs as a returning player sees them. See savefile.mjs.
  if (SAVE) await seedSave(page, SAVE);
  await page.send('Page.navigate', { url: `http://127.0.0.1:${port}${GAME}?planet=${from}` });
  const r = await evaluate(page, READY);
  if (!r.ok) { console.log(`${from}: never ready`); bad++; await page.close(); continue; }

  const N = await evaluate(page, NUMBERS);
  console.log(`FROM ${N.planet.toUpperCase()}   far band k = 1/${Math.round(1 / N.k)} ` +
    `(farPlane ${N.farPlane}m, system ${N.extent}km across)`);
  console.log('  disc     direction                    dist     TRUE°    DRAWN°   QUAD°   core    ' +
    'drawn at  ON SCREEN: body°  halo°  quadpx  noise%');
  for (const d of N.list) {
    const m = await evaluate(page, MEASURE(d.key));
    /* TWO GATES, EACH COMPARING LIKE WITH LIKE, and it used to be one that
       did not. `bodyDeg` was gated against MAX_DEG as though the two were the
       same measurement. They are not. MAX_DEG is a BODY diameter the CPU
       computed; `bodyDeg` is the area-equivalent diameter of every pixel that
       changed by more than 40 levels when the disc was toggled, which is the
       solid disc PLUS whatever of its halo is bright enough to clear that
       threshold — and how much of the halo clears it depends on the sky behind
       it. The same disc measured 5.25 against Home's pale sky and 8.73 against
       a dark one, with a computed body of 3.90 both times. Gating on that is
       gating on contrast.

       So: the computed body answers to MAX_DEG, which is what MAX_DEG means.
       The measured footprint answers to the FRAME, which is the bound that
       cannot be argued with and is the one that caught the failure this
       harness was written for — a single disc covering 75 degrees inside a
       54.4 degree view. A disc wider than the frame is wrong however bright
       its halo is. */
    const tooBig = d.drawnDeg > MAX_DEG;
    const offFrame = !!(m && m.bodyDeg > m.fovDeg);
    const over = tooBig || offFrame;
    if (over) bad++;
    const dir = `[${d.dir.map((v) => (v < 0 ? '' : ' ') + v.toFixed(3)).join(', ')}]`;
    console.log(`  ${d.key.padEnd(7)} ${dir.padEnd(28)} ${String(d.distKm).padStart(6)}km ` +
      `${String(d.trueDeg).padStart(7)} ${String(d.drawnDeg).padStart(8)} ${String(d.quadDeg).padStart(7)} ` +
      `${String(d.core).padStart(7)} ${String(d.drawnAt).padStart(6)}m ${String(m ? m.bodyDeg : '?').padStart(6)} ` +
      `${String(m ? m.reachDeg : '?').padStart(6)} ${String(m ? m.quadPx : '?').padStart(7)} ` +
      `${String(m ? m.pctFrame : '?').padStart(6)}% ${String(m ? m.noisePct : '?').padStart(6)}%` +
      (tooBig ? '   <-- DRAWN OVER ' + MAX_DEG + '°' : '') +
      (offFrame ? '   <-- WIDER THAN THE FRAME' : ''));
  }
  console.log('');
  await page.close();
}

console.log(bad
  ? `FAIL: ${bad} disc(s) over ${MAX_DEG}° computed, or wider than the frame.`
  : `All discs at or under ${MAX_DEG}° computed, and inside the frame.`);
await chrome.close();
close();
process.exitCode = bad ? 1 : 0;
