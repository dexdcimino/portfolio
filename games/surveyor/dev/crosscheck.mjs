// One real crossing, in the real engine, with the drawn orientation recorded.
//
//   node dev/crosscheck.mjs                 home to anvil
//   node dev/crosscheck.mjs ember shroud    another pair
//   node dev/crosscheck.mjs --gpu           on ANGLE rather than SwiftShader
//   node dev/crosscheck.mjs --repeat        the SHORT crossing, not the first
//
// A fresh profile has never flown, so the default here is the long first
// crossing — which is the one nobody makes twice. `--repeat` seeds the save's
// crossing count so the run flies HYPER.tripRepeat instead, which is the trip
// the FX and the approach actually have to hold up under.
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
const REPEAT = process.argv.includes('--repeat');
const [W, H] = ['900', '560'].map(Number);

/* Boot, dismiss the card, wait for the ground to stop streaming, and put the
   craft where a departure begins.
   NOT by calling enterHyper. The trigger is `climbing through the approach
   altitude`, and a harness that skips the trigger cannot tell you the trigger
   still fires — so the craft is stood up as a jet just under the boundary, in a
   climb, and the real update loop takes it over the edge on its own. */
const SETUP = (to, repeat) => `(async () => {
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
  /* Which trip length this run flies. The count is read at enterHyper, so it
     has to be set before the climb crosses the boundary — which is here. */
  S.economy.crossings = ${repeat ? 1 : 0};

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
        cu.x, cu.y, cu.z, +(S.craft.hyperT || 0).toFixed(4), performance.now(),
        (() => { const e = S.scene.getEngine()._compiledEffects;
          return e ? Object.keys(e).length : -1; })(),
        window.__getMs || 0]);
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
    tgt: (() => {
      const t = c.hyper && c.hyper.target; if (!t) return null;
      const d = S.discs.list.find((x) => x.key === t.key); if (!d) return null;
      const p = c.hyper.p, cc = t.c;
      const trueDist = Math.hypot(p.x - cc.x, p.y - cc.y, p.z - cc.z);
      return { key: t.key,
        trueKm: +(trueDist / 1000).toFixed(1),
        discKm: +(d.dist / 1000).toFixed(1),
        trueDeg: +(2 * Math.atan2(t.surfaceR, trueDist) * 180 / Math.PI).toFixed(2),
        drawnDeg: +(2 * d.drawAngle * 180 / Math.PI).toFixed(2),
        promoted: S.discs.promoted.has(t.key),
        fov: +(S.cam.camera.fov * 180 / Math.PI).toFixed(1) };
    })(),
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
  /* THE HITCH. Frame-to-frame wall clock, so the swap's teardown-and-rebuild
     shows up as the one long frame it is. Reported against the median rather
     than against 16.7ms, because this runs on SwiftShader where an ordinary
     frame is already tens of milliseconds and a fixed budget would call every
     frame a hitch. */
  const dt = [];
  for (let i = 1; i < q.length; i++) if (q[i][9] && q[i - 1][9]) dt.push(q[i][9] - q[i - 1][9]);
  const sorted = dt.slice().sort((a, b) => a - b);
  const med = sorted.length ? sorted[sorted.length >> 1] : 0;
  let hitch = 0, hitchAt = -1;
  for (let i = 0; i < dt.length; i++) if (dt[i] > hitch) { hitch = dt[i]; hitchAt = i + 1; }
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
    medFrame: +med.toFixed(1), hitch: +hitch.toFixed(1), hitchAt,
    /* HOW MANY SHADERS WERE COMPILED, and when. A ShaderMaterial compiles the
       first time Babylon is asked to draw with it, and it is never asked while
       the mesh is disabled — so a world built during transit brings its whole
       shader bill to the frame you arrive unless something forces it earlier.
       Frame times are far too noisy across runs to answer that; the count is
       not. */
    fxAtDepart: depart ? q[depart.at][10] : -1,
    fxBeforeSwap: arrive ? q[arrive.at - 1][10] : -1,
    fxAfterSwap: arrive ? q[Math.min(q.length - 1, arrive.at + 1)][10] : -1,
    fxEnd: q.length ? q[q.length - 1][10] : -1,
    getMs: Math.max.apply(null, q.map((r) => r[11] || 0)),
    hitchAtBoundary: arrive ? Math.abs(hitchAt - arrive.at) <= 2 : false,
    worst: +deg(worst).toFixed(2), worstAt,
    camWorst: +deg(camWorst).toFixed(2), camAt,
    swap: performance.getEntriesByType('measure')
      .filter((m) => m.name.startsWith('swap:'))
      .map((m) => [m.name.slice(5), +m.duration.toFixed(1)]),
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

const setup = await evaluate(page, SETUP(TO, REPEAT));
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
/* IS IT VISIBLE, WHICH IS NOT THE SAME QUESTION AS HOW BIG IT IS.
   The brief says distant worlds should grow VISIBLY, and what was measured to
   close that in phase 4 was angular size: 4.21 degrees climbing out to 13.04 on
   approach. Both figures are true and neither says the world can be SEEN. A
   body drawn at 13 degrees in the same tone as the sky behind it is 13 degrees
   of nothing, and the filmstrip is what said so first.

   So the body is lifted for one frame and the frame differenced against itself.
   The pixels that CHANGE are the body, exactly — limb, air and all — with no
   projection maths, which is the same trick the water pass and --forcelit use.
   BOTH GRABS HAPPEN INSIDE ONE SYNCHRONOUS EVALUATION, with no await between
   them, so the game's rAF loop cannot run and the craft cannot move: at a
   million metres a second two consecutive real frames differ by more than the
   body does. */
const VISIBLE = (key) => `(() => {
  const S = window.SURVEYOR;
  const b = S.discs && S.discs.bodies && S.discs.bodies.get(${JSON.stringify(key)});
  if (!b || !b.mesh || !b.mesh.isEnabled()) return { promoted: false, pixels: 0 };
  const eng = S.scene.getEngine(), gl = eng._gl;
  const w = eng.getRenderWidth(), h = eng.getRenderHeight();
  /* AVERAGED OVER N RENDERS, and that is not caution, it is required. Two
     consecutive renders of a completely static scene differ by more than two
     levels across SIXTY-ONE PERCENT of the frame — the sky's dither and the
     post stack's grain are per-frame — so a single-frame difference is all
     noise and the first version of this measured exactly that. The control
     below is what said so; averaging is what makes the control go quiet. */
  const N = 12;
  const grab = () => {
    const acc = new Float32Array(w * h);
    const p = new Uint8Array(w * h * 4);
    for (let f = 0; f < N; f++) {
      S.scene.render();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, p);
      for (let i = 0, j = 0; i < acc.length; i++, j += 4) {
        acc[i] += (0.2126 * p[j] + 0.7152 * p[j + 1] + 0.0722 * p[j + 2]) / N;
      }
    }
    return acc;
  };
  /* A CONTROL FIRST. Two grabs with NOTHING toggled between them, so the
     render-to-render variation is known before any of it is attributed to the
     body. Without this the first version of this measurement reported 61% of
     the frame responding at a stage where the body was not even promoted. */
  const ctrlA = grab();
  const ctrlB = grab();
  /* WHAT THE SCENE THINKS OF IT, before any pixels are counted. If the toggle
     changes nothing, the next question is whether the thing being toggled is
     in the frame at all — and that is cheaper to ask than to infer. */
  /* THE TARGET'S OWN LIVE NUMBERS, READ HERE. The stage line above comes from
     a previous round trip, and at a million metres a second the craft moves
     kilometres between two evaluations — so comparing that line's trueKm and
     drawnDeg against a scale measured now is comparing two different instants,
     and the first version of this did exactly that and appeared to show the
     body drawn seven times too small. Everything compared below is read in one
     synchronous pass. */
  const tgt = (S.discs.list || []).find((x) => x.key === ${JSON.stringify(key)});
  const act = S.scene.getActiveMeshes ? S.scene.getActiveMeshes() : null;
  const active = act ? (act.data || []).indexOf(b.mesh) >= 0 : null;
  const state = {
    enabled: b.mesh.isEnabled(), visibility: b.mesh.visibility,
    group: b.mesh.renderingGroupId, active,
    /* No isInFrustum here on purpose: calling it needs the scene's frustum
       planes and the obvious accessor hands back an empty array, which makes it
       answer false for everything. A field that is always false looks exactly
       like a finding. */
    scale: +b.mesh.scaling.x.toFixed(2),
    trueKm: tgt ? +(tgt.dist / 1000).toFixed(1) : null,
    drawnDeg: tgt ? +(tgt.drawAngle * 360 / Math.PI).toFixed(2) : null,
    /* PROMOTE'S OWN IDENTITY, CHECKED AGAINST ITS OWN INPUTS. It sets
         at = d.K * 1.02;  scaling = at * tan(d.drawAngle)
       so if wantScale matches scaling the maths is self-consistent and any
       disagreement is in what this harness is measuring against; if it does
       not, the renderer is placing the body by numbers it did not derive. One
       of those is a bug and the other is a broken measurement, and this is the
       line that says which. wantDist is the same question for the position. */
    K: tgt ? +tgt.K.toFixed(2) : null,
    wantScale: tgt ? +(tgt.K * 1.02 * Math.tan(tgt.drawAngle)).toFixed(2) : null,
    wantDist: tgt ? +(tgt.K * 1.02).toFixed(1) : null,
    // What that scale and distance actually subtend, to compare against the
    // drawnDeg the line above reports. These are the two numbers that disagree.
    subtend: +(2 * Math.atan(b.mesh.scaling.x / Math.max(1e-6,
      BABYLON.Vector3.Distance(b.mesh.position, S.scene.activeCamera.position)))
      * 180 / Math.PI).toFixed(2),
    dist: +BABYLON.Vector3.Distance(b.mesh.position, S.scene.activeCamera.position).toFixed(1),
  };
  const on = grab();
  b.mesh.setEnabled(false);
  const off = grab();
  b.mesh.setEnabled(true);
  /* SWEPT, NOT THRESHOLDED ONCE. A single cut cannot tell "the body is there
     and has no contrast" from "the body is not drawn": both give zero. Three
     cuts and the peak difference can — a body present but flat shows a big
     count at 2 and nothing at 20, and a body absent shows the control's
     numbers at every cut. */
  const CUTS = [2, 8, 20];
  const diff = (x, y) => {
    const k = [0, 0, 0];
    let sx = 0, sy = 0, sAbs = 0, peak = 0;
    for (let i = 0; i < x.length; i++) {
      const a = x[i], c = y[i], m = Math.abs(a - c);
      if (m > peak) peak = m;
      for (let j = 0; j < CUTS.length; j++) if (m > CUTS[j]) k[j]++;
      if (m > CUTS[0]) { sx += a; sy += c; sAbs += m; }
    }
    return { k, sx, sy, sAbs, peak: +peak.toFixed(1) };
  };
  const ctrl = diff(ctrlA, ctrlB);
  const d = diff(on, off);
  const mean = (v, k) => +(v / Math.max(1, k)).toFixed(1);
  return {
    promoted: true, state,
    noise: ctrl.k, noisePeak: ctrl.peak,
    pixels: d.k, peak: d.peak,
    body: mean(d.sx, d.k[0]), behind: mean(d.sy, d.k[0]),
    // MEAN ABSOLUTE difference, not the difference of the means: a body half of
    // which is brighter than the sky and half darker cancels to zero otherwise,
    // which is exactly what the first run of this reported.
    contrast: mean(d.sAbs, d.k[0]),
  };
})()`;

let placed = 0, misplaced = 0;
for (const [label, cond] of MARKS) {
  const r = await evaluate(page, UNTIL(`!c.hyper || (${cond})`, 120000));
  await grab(`${label} — ${(r.hyperT * 100).toFixed(0)}%`);
  if (r.tgt) {
    console.log(`  ${label.padEnd(24)} ${r.tgt.key} is ${r.tgt.trueKm}km away, ` +
      `drawn as if ${r.tgt.discKm}km — true ${r.tgt.trueDeg}°, drawn ${r.tgt.drawnDeg}°` +
      `, fov ${r.tgt.fov}°${r.tgt.promoted ? ', promoted' : ''}`);
    const v = await evaluate(page, VISIBLE(r.tgt.key));
    /* THE FAR BAND IS WHERE IT SAYS IT IS. promote() places a body at K*1.02
       along its direction from the camera and scales it to subtend drawAngle,
       so the angle its transform actually subtends must BE drawAngle. It was
       not: the placement used last frame's camera, which on the ground is an
       error of a part in ten thousand and in hyper flight is larger than the
       placement distance itself — 101.6m from the camera against the 15.5m it
       was placed at, and a destination reported as drawn at 13.7 degrees that
       was not in the frame at all. Counted per stage, and stages are counted
       too: a run that measured none of them must not pass. */
    const st = v.state || {};
    if (v.promoted && st.drawnDeg > 0) {
      placed++;
      const err = Math.abs(st.subtend - st.drawnDeg) / st.drawnDeg;
      if (err > 0.02) {
        misplaced++;
        console.log(`  ${''.padEnd(24)} MISPLACED: subtends ${st.subtend}° but ` +
          `drawAngle says ${st.drawnDeg}° — placed ${st.dist}m from the camera, ` +
          `promote wanted ${st.wantDist}m`);
      }
    }
    console.log(`  ${''.padEnd(24)} ${v.promoted
      ? `px over 2/8/20: ${v.pixels.join('/')} (control ${v.noise.join('/')}), ` +
        `peak ${v.peak} vs ${v.noisePeak}
  ${''.padEnd(24)} ${JSON.stringify(v.state)}`
      : 'not promoted yet — still the billboard'}`);
  }
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
console.log(`median frame              ${rep.medFrame}ms`);
console.log(`building the destination  ${rep.getMs}ms, once, on departure`);
console.log(`shaders compiled          ${rep.fxAtDepart} at departure -> ` +
  `${rep.fxBeforeSwap} before the swap -> ${rep.fxAfterSwap} after -> ${rep.fxEnd} at rest` +
  (rep.fxAfterSwap > rep.fxBeforeSwap
    ? `   <-- ${rep.fxAfterSwap - rep.fxBeforeSwap} COMPILED ON THE ARRIVAL FRAME` : ''));
if (rep.swap && rep.swap.length) {
  console.log('the swap, by phase        ' +
    rep.swap.map(([n, d]) => `${n} ${d}ms`).join('  '));
}
console.log(`worst frame               ${rep.hitch}ms  at frame ${rep.hitchAt}` +
  (rep.hitchAtBoundary ? '   <-- THIS IS THE SWAP' : ''));
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
  const sheet = `cross-${FROM}-${setup.aimed}${REPEAT ? '-repeat' : ''}.jpg`;
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
if (misplaced) {
  console.log(`\n${misplaced} of ${placed} stage(s) drew the destination somewhere ` +
    'other than where promote() placed it.');
} else if (!placed) {
  console.log('\nFAIL: no stage measured the destination at all — the far band ' +
    'was never promoted, so nothing here checked it.');
} else {
  console.log(`\nthe far band is where it says it is, at ${placed} stage(s)`);
}
const bad = !!noisy.length || arr.hyper || !dep.hyper ||
  rep.worst > 12 ||
  !rep.depart || rep.depart.ang > 12 ||
  !rep.arrive || rep.arrive.offWings > 6 ||
  !placed || misplaced > 0;
console.log(bad ? '\nCROSSING FAILED.' : '\nCrossing is continuous.');
process.exit(bad ? 1 : 0);
