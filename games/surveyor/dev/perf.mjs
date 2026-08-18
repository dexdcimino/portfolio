// What the survey overlay costs, measured in a real browser on real frames.
//
//   node dev/perf.mjs              home and anvil
//   node dev/perf.mjs shroud       just that one
//
// The headless suite can time the CPU side of the pass and does, but "does not
// tank frame time" is a claim about a GPU drawing a depth-cleared rendering
// group over a finished frame, and no stub can answer it. This boots the real
// game, plants a realistic field of colonies and raiders through the same
// public API the game uses, and measures frames with the key up and with it
// held — same camera, same terrain, same everything else.
//
// Note the machine it runs on: headless Chrome falls back to SwiftShader, which
// is a SOFTWARE rasteriser. The absolute frame times are therefore much worse
// than any real GPU's, and that is fine — what is being measured is the
// DIFFERENCE between the two states on identical geometry, and a software
// rasteriser exaggerates it rather than hiding it. A cost that is invisible
// here is invisible everywhere.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { launch, serve, evaluate, wait } from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const { PLANETS } = await import('../js/tune.js');
const PARTS = process.argv.includes('--parts');
const argv = process.argv.slice(2).filter((a) => PLANETS[a]);
const KEYS = argv.length ? argv : ['home', 'anvil'];

// --fast trades precision for a run you will actually wait for: a SwiftShader
// frame here is around 170ms, so every sample is most of a minute.
const FAST = process.argv.includes('--fast');
const SITES = 14;                  // colonies planted before measuring
const FRAMES = FAST ? 50 : 120;    // frames per sample
const PAIRS = FAST ? 2 : 3;        // interleaved off/held pairs. See the note below
const SETTLE = FAST ? 14 : 22;     // frames discarded after a state change

/* Plant a field, then measure. Everything below runs in the page.

   Sites are placed through `colonies.restore`, which is the same path a reload
   takes, so what is measured is a genuine save-game's worth of world rather
   than a special test mode. Ages are staggered so densities — and therefore
   marker sizes and raider pressure — cover the real range. */
const MEASURE = ((PARTS, SETTLE) => `(async () => {
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
  document.getElementById('start').style.display = 'none';

  // A field: three clusters and a scatter, on the vents where a player's would
  // actually be, with raiders on the way to the biggest of them.
  const P = S.planet, col = S.colonies;
  const vents = col.geysers;
  let id = 1;
  for (let i = 0; i < ${SITES}; i++) {
    const v = vents[i % vents.length];
    const fr = new (Object.getPrototypeOf(S.surface.frame).constructor)(P, v.dir);
    const off = (i / vents.length | 0) * P.radius * 0.02;
    const d = fr.dirAt(off, off * 0.6, { x: 0, y: 0, z: 0 });
    col.restore({ id: id++, dir: [d.x, d.y, d.z], age: 200 + i * 60, geyser: v.id }, 0);
  }
  col.tick(1 / 60);
  for (let i = 0; i < 6; i++) S.raiders.spawn(col.sites[i % col.sites.length]);

  // Through the KEY, not through the overlay object: main.js drives the held
  // state from the key every frame, so anything that reaches in and sets it
  // directly is overwritten before the next frame is drawn — which is how the
  // first version of this harness measured a zero.
  const key = (type) => window.dispatchEvent(new KeyboardEvent(type, { code: 'KeyQ' }));
  const realUpdate = S.overlay.update.bind(S.overlay);
  const sample = async (held, opts) => {
    opts = opts || {};
    key(held ? 'keydown' : 'keyup');
    for (let i = 0; i < 8; i++) await frame();
    // The three costs are separable and worth separating: the marker pass, the
    // terrain going to wireframe, and a full-screen CSS backdrop filter. Each
    // is switched off AFTER the held transition has applied it, because the
    // transition is what owns them.
    const xray = document.getElementById('xray');
    xray.style.display = held && opts.noTint ? 'none' : '';
    S.overlay.update = opts.noMarkers ? () => {} : realUpdate;
    if (opts.noMarkers) S.overlay.hideAll();
    if (held && opts.noWire) {
      S.mats.terrain.wireframe = false;
      if (S.mats.water) S.mats.water.wireframe = false;
    }
    for (let i = 0; i < ${SETTLE}; i++) await frame();      // settle, then time
    const t = [];
    let last = performance.now();
    for (let i = 0; i < ${FRAMES}; i++) {
      await frame();
      const now = performance.now();
      t.push(now - last);
      last = now;
    }
    t.sort((a, b) => a - b);
    return {
      median: t[t.length >> 1],
      p95: t[Math.floor(t.length * 0.95)],
      markers: S.overlay.markers,
    };
  };

  /* INTERLEAVED, and this is not fussiness. A software rasteriser drifts by
     more than the thing being measured — the first version of this file timed
     one state then the other and reported +102ms on one run and +0.9ms on the
     next, from the same build. Alternating the two states and taking the median
     of the per-pair differences cancels the drift, because both halves of every
     pair are drawn under the same conditions. */
  const mid = (a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
  const pairUp = async (opts) => {
    const d = [], o = [], h = [];
    for (let i = 0; i < ${PAIRS}; i++) {
      const a = await sample(false);
      const b = await sample(true, opts);
      o.push(a.median); h.push(b.median); d.push(b.median - a.median);
    }
    return { off: mid(o), held: mid(h), delta: mid(d), spread: Math.max(...d) - Math.min(...d) };
  };
  const full = await pairUp({});
  const parts = ${PARTS} ? {
    markers: await pairUp({ noWire: true, noTint: true }),
    wire: await pairUp({ noMarkers: true, noTint: true }),
    tint: await pairUp({ noMarkers: true, noWire: true }),
  } : null;
  const off = { median: full.off };
  const on = { median: full.held, markers: S.overlay.markers };
  key('keyup');
  return {
    ok: true, off, on, delta: full.delta, spread: full.spread, parts,
    planet: P.name,
    sites: col.sites.length,
    vents: vents.length,
    raiders: S.raiders.list.length,
  };
})()`)(PARTS, SETTLE);

const { server, port, close: closeServer } = await serve(ROOT);
const chrome = await launch({ width: 900, height: 560 });
console.log(`${chrome.version}, SwiftShader — read the DIFFERENCE, not the absolutes\n`);

let worst = 0;
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
  await page.send('Page.navigate', { url: `http://127.0.0.1:${port}/?planet=${key}` });

  let r;
  try {
    r = await evaluate(page, MEASURE);
  } catch (err) {
    r = { ok: false, err: err.message };
  }

  if (r.ok) {
    const cost = r.delta;
    worst = Math.max(worst, cost);
    console.log(`${key.padEnd(7)} ${r.sites} colonies, ${r.vents} vents, ` +
      `${r.raiders} raiders -> ${r.on.markers} markers`);
    console.log(`        key up   ${r.off.median.toFixed(1)}ms median frame`);
    console.log(`        key held ${r.on.median.toFixed(1)}ms median frame`);
    if (r.parts) {
      for (const [k, v] of Object.entries(r.parts)) {
        console.log(`        ${k.padEnd(8)} +${v.delta.toFixed(1)}ms  (spread ${v.spread.toFixed(1)})`);
      }
    }
    console.log(`        overlay costs ${cost >= 0 ? '+' : ''}${cost.toFixed(2)}ms/frame ` +
      `(${(cost / Math.max(0.01, r.off.median) * 100).toFixed(0)}%)\n`);
  } else {
    console.log(`${key.padEnd(7)} FAILED — ${r.err || 'never became ready'}\n`);
  }
  for (const e of errs) console.log(`        ! ${e}`);

  await chrome.browser.send('Target.closeTarget', { targetId: page.targetId });
  page.close();
  await wait(150);
}

await chrome.close();
closeServer();
server.unref();
console.log(`worst overlay cost across ${KEYS.length} world(s): ${worst.toFixed(2)}ms/frame`);
