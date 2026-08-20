// One real crossing, in the real engine, with the drawn orientation recorded.
//
//   node dev/crosscheck.mjs                 home to anvil
//   node dev/crosscheck.mjs ember shroud    another pair
//   node dev/crosscheck.mjs --gpu           on ANGLE rather than SwiftShader
//
// dev/run.mjs already flies the crossing as maths: it carries a TransitFrame
// beside hyper's own integrator and proves the seams are zero and the bank
// converges. What it cannot prove is that the game draws what the maths says,
// because the drawn orientation goes through frameQuat, through Babylon's
// quaternion, onto a mesh, with a chase camera reading the same basis. Every
// one of those is a place the phase could be right and look wrong.
//
// So this samples `root.rotationQuaternion` on EVERY animation frame of an
// actual departure, transit and arrival, and reports the largest step between
// consecutive frames. A snap is a single large step; that is the whole of it.
//
// It also lays the crossing out as a filmstrip, because the one thing no number
// here can tell you is whether the roll reads as the craft turning over or as
// the universe lurching. The chase boom is pulled to its minimum for those
// frames and only for them: at the framing the game actually uses, a craft at
// a million metres a second is four dark pixels, and a photograph of four
// pixels cannot answer a question about attitude.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { launch, serve, evaluate, wait } from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../..');
const OUT = join(HERE, 'shots');
const GAME = '/games/surveyor/';

const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FROM = argv[0] || 'home';
const TO = argv[1] || 'anvil';
const GPU = process.argv.includes('--gpu');
const [W, H] = ['900', '560'].map(Number);

/* Boot, dismiss the card, wait for the ground to stop streaming, and put the
   craft where a departure begins.
   NOT by calling enterHyper. The trigger is `climbing through the approach
   altitude`, and a harness that skips the trigger cannot tell you the trigger
   still fires — so the craft is stood up as a jet just under the boundary, in a
   climb, and the real update loop takes it over the edge on its own. */
const SETUP = (to) => `(async () => {
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
  const S = window.SURVEYOR;
  if (!S) return { ok: false, why: 'never booted' };
  document.getElementById('begin').click();
  document.getElementById('start').style.display = 'none';
  for (let i = 0; i < 30; i++) await frame();

  const { JET, HYPER, SYSTEM } = await import('/games/surveyor/js/tune.js');
  const c = S.craft;
  // Fuel for the trip, so the departure is not refused by the economy check.
  S.economy.hyper = 999;
  c.addFuel(999);

  /* Point the climb at the destination. The heading you leave with is what
     picks the world, so this is the aim, not a teleport: yaw and pitch are set
     and the trajectory does the rest through hyper's own lock-on.

     YOU CANNOT LEAVE TOWARD A WORLD THAT IS BELOW YOUR HORIZON, and the first
     cut of this tried to. A world is only up from some of the surface, and the
     spawn search picks the point where the MOST of the five are up, not where
     any named one is: Anvil sits 31 degrees under Home's. Departing at a
     forced 25-degree climb and letting the lock-on bend the course down toward
     it turned the trajectory straight back through the sphere it had just
     left, and the trip ended two seconds later, back on Home. That is honest
     behaviour and the wrong thing to photograph, so the destination is the
     requested one if it is up and the highest one in the sky otherwise. */
  const me = SYSTEM.at[S.planet.key];
  const fr = c.surf.frame;
  const look = (k) => {
    const a = SYSTEM.at[k];
    const w = { x: (a[0] - me[0]) * 1000, y: (a[1] - me[1]) * 1000, z: (a[2] - me[2]) * 1000 };
    const L = Math.hypot(w.x, w.y, w.z) || 1;
    const d = (j) => (w.x * fr[j].x + w.y * fr[j].y + w.z * fr[j].z) / L;
    return { key: k, e: d('east'), u: d('up'), n: d('north') };
  };
  const up = Object.keys(SYSTEM.at).filter((k) => k !== S.planet.key).map(look)
    .sort((a, b) => b.u - a.u);
  const want = look('${to}');
  const aim = want.u > 0.18 ? want : up[0];
  c.setMode('jet', true);
  c.yaw = Math.atan2(aim.e, aim.n);
  c.pitch = -Math.max(0.44, Math.asin(Math.max(-1, Math.min(1, aim.u))));
  const u = aim.u;
  // Just under the boundary, and climbing.
  c.pos.set(0, HYPER.approachAlt - 40, 0);
  c.speedScalar = JET.boostSpeed;
  c.assist = 0;
  c.applyTransform();
  /* HOLD BOOST, and hold it the way a player does.
     Above JET.ceiling the air thins and the jet sinks; JET.escapeThin is a
     floor of thrust that only exists while boost is DOWN, and it is the only
     thing that gets a craft through the approach altitude. Setting the flag on
     the craft would not do — main.js rebuilds the input object from the key set
     every frame and would overwrite it — so the key is dispatched and left
     down, which is also the only version of this that proves the escape burn
     still works. */
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' }));

  /* Boom all the way in, and keep it there — the transit branch stretches it
     by 1.6 to 1.6+hyperDist as the speed climbs, and at the flight framing the
     craft is four pixels of dark hull against a black sky. The thing these
     frames exist to show is which way up it is, so it has to be big enough to
     have a way up. Held every frame because the wheel handler and arrive()
     both write it back to 1. */
  S.cam.wantZoom = 0.55;
  setInterval(() => { S.cam.wantZoom = 0.55; }, 100);
  for (let i = 0; i < 4; i++) await frame();

  /* The sampler. One entry per animation frame for the whole flight, read off
     the mesh the player is looking at rather than off the state that produced
     it — a transform that is computed correctly and applied to nothing would
     pass every check in dev/run.mjs. */
  window.__cross = { q: [], errs: [], peak: 0 };
  window.addEventListener('error', (ev) => window.__cross.errs.push(String(ev.message)));
  (function sample() {
    const S = window.SURVEYOR;
    const root = S.craft.forms[S.craft.mode].root;
    const r = root.rotationQuaternion;
    const cu = S.cam.camera.upVector;
    if (r) {
      window.__cross.q.push([r.x, r.y, r.z, r.w, S.craft.hyper ? 1 : 0,
        cu.x, cu.y, cu.z, +(S.craft.hyperT || 0).toFixed(4)]);
      if (S.craft.hyper) window.__cross.peak = Math.max(window.__cross.peak, S.craft.hyperT);
    }
    requestAnimationFrame(sample);
  })();
  return { ok: true, from: S.planet.key, y: +c.pos.y.toFixed(1), yaw: +c.yaw.toFixed(3),
    pitch: +c.pitch.toFixed(3), targetEl: Math.asin(Math.max(-1, Math.min(1, u))),
    aimed: aim.key, asked: '${to}', mode: c.mode,
    sky: up.map((o) => o.key + ' ' + (Math.asin(o.u) * 180 / Math.PI).toFixed(0)).join(', ') };
})()`;

/* Run frames until a predicate holds, or a wall-clock limit is hit. Returns how
   long it took and where the craft is, so the caller can caption the frame. */
const UNTIL = (cond, limit) => `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const t0 = performance.now();
  let n = 0;
  while (performance.now() - t0 < ${limit}) {
    await frame(); n++;
    const S = window.SURVEYOR;
    const c = S.craft;
    if (${cond}) break;
  }
  const S = window.SURVEYOR, c = S.craft;
  return {
    frames: n, secs: +((performance.now() - t0) / 1000).toFixed(2),
    hyper: !!c.hyper, hyperT: +(c.hyperT || 0).toFixed(3),
    alt: c.hyper ? c.hyper.alt : c.pos.y,
    world: S.planet.key, speed: Math.round(c.speed),
    to: c.hyper && c.hyper.target ? c.hyper.target.key : null,
  };
})()`;

const REPORT = `(() => {
  const X = window.__cross;
  const dotq = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const ang = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(dotq(a, b))));
  const deg = (r) => r * 180 / Math.PI;
  /* The rotation taking one drawn orientation to the next, as an axis and an
     angle. Which axis it turns about is the whole question at an arrival: a
     craft being stood up turns about its own wings, and anything else — a
     roll, a yaw, a frame that changed underneath it — does not. */
  const step = (a, b) => {
    const s = dotq(a, b) < 0 ? -1 : 1;
    const bb = [b[0] * s, b[1] * s, b[2] * s, b[3] * s];
    // b * conj(a)
    const x = bb[3] * -a[0] + bb[0] * a[3] + bb[1] * -a[2] - bb[2] * -a[1];
    const y = bb[3] * -a[1] + bb[1] * a[3] + bb[2] * -a[0] - bb[0] * -a[2];
    const z = bb[3] * -a[2] + bb[2] * a[3] + bb[0] * -a[1] - bb[1] * -a[0];
    const w = bb[3] * a[3] - (bb[0] * -a[0] + bb[1] * -a[1] + bb[2] * -a[2]);
    const l = Math.hypot(x, y, z);
    return { ang: 2 * Math.atan2(l, Math.abs(w)),
      axis: l > 1e-9 ? { x: x / l, y: y / l, z: z / l } : { x: 1, y: 0, z: 0 } };
  };
  // The craft's own right axis, out of a quaternion.
  const rightOf = (q) => {
    const [x, y, z, w] = q;
    return { x: 1 - 2 * (y * y + z * z), y: 2 * (x * y + z * w), z: 2 * (x * z - y * w) };
  };
  const q = X.q;
  let worst = 0, worstAt = -1, camWorst = 0, camAt = -1;
  let depart = null, arrive = null;
  for (let i = 1; i < q.length; i++) {
    const boundary = q[i - 1][4] !== q[i][4];
    const d = ang(q[i - 1], q[i]);
    if (boundary) {
      const st = step(q[i - 1], q[i]);
      const r = rightOf(q[i - 1]);
      const off = Math.acos(Math.min(1, Math.abs(
        st.axis.x * r.x + st.axis.y * r.y + st.axis.z * r.z)));
      const a0 = q[i - 1], a1 = q[i];
      const rec = { at: i, ang: +deg(st.ang).toFixed(2), offWings: +deg(off).toFixed(2),
        cam: +deg(Math.acos(Math.max(-1, Math.min(1,
          a0[5] * a1[5] + a0[6] * a1[6] + a0[7] * a1[7])))).toFixed(2) };
      if (q[i][4] === 1) depart = rec; else arrive = rec;
      continue;                       // the two seams are reported separately
    }
    if (d > worst) { worst = d; worstAt = i; }
    const c0 = q[i - 1], c1 = q[i];
    const cd = Math.acos(Math.max(-1, Math.min(1,
      c0[5] * c1[5] + c0[6] * c1[6] + c0[7] * c1[7])));
    if (cd > camWorst) { camWorst = cd; camAt = i; }
  }
  return {
    frames: q.length, inHyper: q.filter((r) => r[4] === 1).length,
    worst: +deg(worst).toFixed(2), worstAt,
    camWorst: +deg(camWorst).toFixed(2), camAt,
    depart, arrive, errs: X.errs.slice(0, 5),
  };
})()`;

const { server, port, close: closeServer } = await serve(SITE);
const chrome = await launch({ width: W, height: H, gpu: GPU });
const page = await chrome.newPage();
const errs = [];
page.on((method, params) => {
  if (method === 'Runtime.exceptionThrown') {
    errs.push(params.exceptionDetails?.exception?.description ||
      params.exceptionDetails?.text || 'exception');
  } else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
    errs.push(params.args.map((a) => a.value ?? a.description).join(' '));
  }
});
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Emulation.setDeviceMetricsOverride',
  { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await page.send('Page.navigate', { url: `http://127.0.0.1:${port}${GAME}?planet=${FROM}` });

const setup = await evaluate(page, SETUP(TO));
if (!setup.ok) {
  console.log('setup failed:', setup.why);
  await chrome.close(); closeServer(); server.unref();
  process.exit(1);
}
console.log(`sky from the ${setup.from} spawn: ${setup.sky}`);
if (setup.aimed !== setup.asked) {
  console.log(`${setup.asked} is below the horizon here — leaving toward ${setup.aimed} instead`);
}
console.log(`${setup.from} -> ${setup.aimed}, jet at ${setup.y}m, climbing at ` +
  `${(-setup.pitch * 180 / Math.PI).toFixed(0)}° at a world ` +
  `${(setup.targetEl * 180 / Math.PI).toFixed(0)}° up`);

const shots = [];
const grab = async (label) => {
  const s = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 86 });
  const file = `cross-${shots.length}.jpg`;
  writeFileSync(join(OUT, file), Buffer.from(s.data, 'base64'));
  shots.push({ file, label });
};

await grab('on the way up');
// Over the edge. The loop does this itself; the harness only watches for it.
const dep = await evaluate(page, UNTIL('c.hyper', 20000));
await grab(dep.hyper ? `left ${setup.from}` : 'never left');
if (!dep.hyper) console.log('WARNING: never departed');
else console.log(`departed after ${dep.secs}s, locked onto ${dep.to}`);

/* Four frames spaced through the transit, by PROGRESS rather than by wall
   clock. hyperT is symmetric about the midpoint by construction — the same
   number climbing out and falling in — so it cannot say which half you are
   looking at on its own, and the turnover is detected against the peak so far.
   Wall clock was worse than useless here: SwiftShader runs this at five frames
   a second, so four fixed windows photographed the first eight seconds of a
   twenty-eight second trip four times over. */
const MARKS = [
  ['climbing out', 'c.hyperT > 0.55'],
  ['near the top', 'c.hyperT > 0.9 || (window.__cross.peak > 0.3 && c.hyperT < window.__cross.peak - 0.01)'],
  ['past the balance point', 'c.hyperT < window.__cross.peak - 0.15'],
  ['on approach', 'c.hyperT < 0.45'],
];
for (const [label, cond] of MARKS) {
  const r = await evaluate(page, UNTIL(`!c.hyper || (${cond})`, 120000));
  await grab(`${label} — ${(r.hyperT * 100).toFixed(0)}%`);
  if (!r.hyper) break;
}

/* THE SWAP, FROM BOTH SIDES. The frame before it is the destination as the far
   band draws it — a promoted icosphere, compressed about the camera; the frame
   after is the same world as real terrain at true scale, built at the scene
   origin. Nothing crossfades between those two, and phase 4 is the phase that
   has to. Photographed rather than measured because "how big is the pop" is a
   question about a silhouette. */
const brink = await evaluate(page, UNTIL('!c.hyper || c.hyper.alt < 2000', 240000));
await grab(brink.hyper ? `the frame before the swap — ${Math.round(brink.alt)}m out`
  : 'arrived before the brink');
const arr = await evaluate(page, UNTIL('!c.hyper', 240000));
await grab(arr.hyper ? 'still in transit' : `the frame after — ${arr.world} at true scale`);
console.log(`arrived: ${!arr.hyper}, world ${arr.world}, after ${arr.secs}s more`);

const rep = await evaluate(page, REPORT);
/* The axis of a rotation smaller than a few degrees is not a fact about the
   craft, it is a fact about rounding — so it is only quoted where the angle is
   big enough for it to mean something. */
const fmt = (r) => (!r ? 'n/a'
  : r.ang < 5 ? `${r.ang}\u00b0, camera ${r.cam}\u00b0`
    : `${r.ang}\u00b0 of which ${r.offWings}\u00b0 is off the wings, camera ${r.cam}\u00b0`);
console.log('');
console.log(`frames                    ${rep.frames} (${rep.inHyper} in transit)`);
console.log(`worst step in flight      ${rep.worst}°  at frame ${rep.worstAt}`);
console.log(`the departure seam        ${fmt(rep.depart)}`);
console.log(`the arrival seam          ${fmt(rep.arrive)}`);
console.log(`worst camera up step      ${rep.camWorst}°  at frame ${rep.camAt}`);
/* THE ARRIVAL SEAM IS NOT ZERO AND IS NOT SUPPOSED TO BE. landOn stands the
   craft up — pitch to 0.10 and the autopilot on — because arriving nose-down
   at 900m over a world you have never seen is a bad first second. What Phase 3
   owns is that the stand-up is a PITCH ABOUT THE CRAFT'S OWN WINGS and nothing
   else: no roll, no yaw, no frame swapping underneath it. So the angle is
   reported and the off-axis part is what is judged.
   Phase 4 deletes the swap and with it this seam entirely. */

// The filmstrip. Two rows of three, same stylesheet the six-way sheets use.
const cells = shots.map((s) => `  <figure><img src="${s.file}" alt="${s.label}">` +
  `<figcaption>${s.label}</figcaption></figure>`).join('\n');
writeFileSync(join(OUT, 'crosssheet.html'),
  '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">' +
  `<title>Surveyor — ${FROM} to ${setup.aimed}</title>` +
  '<link rel="stylesheet" href="sheet.css"></head>\n<body>\n' +
  `<main>\n${cells}\n</main>\n</body></html>\n`);
{
  const p2 = await chrome.newPage();
  await p2.send('Page.enable');
  await p2.send('Page.navigate',
    { url: `http://127.0.0.1:${port}${GAME}dev/shots/crosssheet.html` });
  await wait(1200);
  const size = await evaluate(p2, `(async () => {
    await new Promise((r) => requestAnimationFrame(r));
    const d = document.documentElement;
    return { w: d.scrollWidth, h: d.scrollHeight };
  })()`);
  await p2.send('Emulation.setDeviceMetricsOverride',
    { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: false });
  await wait(400);
  const s = await p2.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
  const sheet = `cross-${FROM}-${setup.aimed}.jpg`;
  writeFileSync(join(OUT, sheet), Buffer.from(s.data, 'base64'));
  console.log(`\nfilmstrip  ${size.w}x${size.h}  -> dev/shots/${sheet}`);
  await p2.close();
}

await chrome.close();
closeServer();
server.unref();

const noisy = errs.concat(rep.errs);
if (noisy.length) {
  console.log('\nconsole errors:');
  for (const e of noisy.slice(0, 8)) console.log('  ' + e);
}
/* A snap is a step, so the thresholds are steps. 12 degrees in one frame is
   720 deg/s at 60fps — well above anything the rate limits can produce, and
   well below what a boundary snap looked like: the world-+Y build put 180 into
   a single frame. The two seams are judged on the part that is NOT the
   deliberate stand-up, which is the part this phase is responsible for. */
const bad = !!noisy.length || arr.hyper || !dep.hyper ||
  rep.worst > 12 ||
  !rep.depart || rep.depart.ang > 12 ||
  !rep.arrive || rep.arrive.offWings > 6;
console.log(bad ? '\nCROSSING FAILED.' : '\nCrossing is continuous.');
process.exit(bad ? 1 : 0);
