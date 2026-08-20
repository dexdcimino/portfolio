// Gallery candidates for Arena 1 — driven through the real sim.
//
//   node dev/gallery.mjs                 all shots, three seeds
//   node dev/gallery.mjs --seed 7        one arena
//
// Browser and capture kit are shared with the other three games
// (games/_shared/dev/cdp.mjs and capture.mjs). Nothing here is a second copy.
//
// WHY THIS ONE IS THE FIDDLY ONE. Arena 1 is a pointer-locked shooter, so a
// screenshot needs three things none of the others do: a real pointer lock (the
// mousemove handler returns immediately without one, so no lock means no aim at
// all), an actual target in the frame, and a moment worth photographing. The
// first turns out to be free — headless Chrome grants pointer lock to a
// CDP-dispatched click, because that click is a trusted gesture — and the other
// two are what the rest of this file is about.
//
// SERPENTS AND WRAITHS ARE THE GAME'S FACE. Five serpents band up the column and
// five wraiths orbit the arena from boot, so neither needs spawning — but both
// are above you, and the default view is level, so a frame taken without
// aiming is a corridor with nothing in it. Every shot below therefore picks a
// real enemy out of the scene and aims at it.
//
// REPRODUCIBILITY. The sim is deterministic on ?seed=, so the seed plus the
// input stream in each caption re-reaches the same moment. What is NOT captured
// by that: the exact frame within a burst, since the capture lands wherever the
// render loop is. Close enough to recapture a shot at another size, which is
// what the record is for.
//
// PHOTON: the ?photonver suffix is FIXED at -m12fixed and must stay that way.
// A fresh suffix per run partitions matchmaking, which is the point, but the
// Photon dashboard has a hard cap on distinct AppVersions and no way to release
// them — a harness that invents one per run burns the quota permanently.

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { launch, serve, evaluate, wait } from '../../_shared/dev/cdp.mjs';
import { createInput, createRoll, frames } from '../../_shared/dev/capture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../..');
const GAME = '/games/arena1/';
const OUT = join(HERE, 'shots', 'gallery');

const W = 1920, H = 1080;
const PHOTONVER = '-m12fixed';   // see the note above — do not invent a new one

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = flag('seed', '') ? [flag('seed', '')] : ['7', '1291', '4400'];

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

/* Boot means: the level is built, the actors are in the scene, and the controls
   modal is still up. Arena 1 starts a loopback session instantly rather than
   waiting on the network, so this is quick — what it is actually waiting for is
   the level meshes, which is the thing that would photograph half-built. */
const BOOT = `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const t0 = performance.now();
  while (performance.now() - t0 < 40000) {
    await frame();
    const s = (typeof BABYLON !== 'undefined' && BABYLON.Engine.Instances[0]?.scenes[0]) || null;
    if (s && s.meshes.length > 400 && document.getElementById('hpNum')?.textContent) break;
  }
  /* THE HUD STAYS AND THE INSTRUMENTATION GOES.
     Integrity, fuel, flow, altitude, the weapon slots and the POPS/CELLS/DOWNS
     panel are all things a player reads, and they are the reason a gallery shot
     of a game should have a HUD in it at all. #perf and #hud-boot are not:
     one is an FPS/mesh-count/quality readout with its own keyboard hints, the
     other prints the sim tick, the seed and the Photon room. They are the same
     kind of thing as Surveyor's DEV WARP row — useful while building, and an
     admission of a debug build in a shop window. */
  /* #feed goes too, and it is the one that needed looking at twice. It is a
     real player-facing feed — kills land in it — but in a solo harness the only
     thing it ever carries is the Photon room announcement, and every
     ground-level candidate came back with HOSTING GECKO or HOSTING JAGUAR
     printed across the middle of the arena. A room name is session chrome, it
     reads as a debug string, and it sits exactly where the eye goes. */
  for (const id of ['perf', 'hud-boot', 'feed']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  for (let i = 0; i < 30; i++) await frame();
  const s = BABYLON.Engine.Instances[0]?.scenes[0];
  return { ok: !!s, meshes: s ? s.meshes.length : 0 };
})()`;

/* WHAT IS IN FRONT OF THE PLAYER, read out of the scene graph.
   The sim keeps its entities in module scope and window.Arena1 is a five-method
   UI surface, so there is nothing to ask. The RENDERER, though, has put a mesh
   at every enemy's position this frame, and those meshes are literally what is
   on the screen — so reading them is reading the picture. render/actors.js
   names them `blob`, `wraith` and `skCore` (clones keep the stem), and
   render/serpent.js names segments `serpSeg<id>_<n>`.
   The camera's rotation is (pitch, yaw, roll) — main.js sets it that way every
   render frame from the local yaw/pitch — so the aim maths below can work in
   the same terms the mouse handler does. */
const LOOK = `(() => {
  try {
    const s = BABYLON.Engine.Instances[0].scenes[0];
    const c = s.activeCamera;
    const kindOf = (n) => n.startsWith('serpSeg') ? 'serpent'
      : n.startsWith('wraith') ? 'wraith'
      : n.startsWith('blob') ? 'blob'
      : n.startsWith('skCore') || n.startsWith('spike') ? 'spike' : null;
    const seen = [];
    for (const m of s.meshes) {
      const k = kindOf(m.name);
      if (!k || !m.isEnabled() || !m.isVisible) continue;
      const p = m.getAbsolutePosition();
      /* Serpents are a dozen segments each; keeping every one would let the
         nearest-target search lock onto a tail sphere behind a head that is
         somewhere else entirely. The head is segment 0. */
      if (k === 'serpent' && !/_0$/.test(m.name)) continue;
      seen.push({ kind: k, name: m.name,
        x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
        d: +BABYLON.Vector3.Distance(p, c.position).toFixed(1) });
    }
    seen.sort((a, b) => a.d - b.d);
    return {
      cam: { x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2), z: +c.position.z.toFixed(2),
             yaw: +c.rotation.y.toFixed(4), pitch: +c.rotation.x.toFixed(4) },
      seen,
      hp: document.getElementById('hpNum')?.textContent || '',
      alt: document.getElementById('alt')?.textContent || '',
      fuel: document.getElementById('fuelNum')?.textContent || '',
      locked: document.pointerLockElement?.tagName === 'CANVAS',
      paused: !document.getElementById('paused')?.classList.contains('hidden'),
    };
  } catch (err) { return { err: String(err) }; }
})()`;

// TUNE.SENS, so the aim below converts an angle into the pixels of mouse
// movement that produce it. Read from the game rather than copied.
const { TUNE } = await import('../js/config.js');

// ---- run ----------------------------------------------------------------

const { port, close: closeServer } = await serve(SITE);
const chrome = await launch({ width: W, height: H, gpu: true });
console.log(`${chrome.version} — ${W}x${H}, GPU\n`);

const roll = createRoll(OUT, { width: W, height: H });
let problems = 0;

async function run(seed, plan) {
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
    if (method === 'Log.entryAdded' && params.entry.level === 'error'
        && !/favicon/.test(params.entry.url || '')) {
      errs.push(params.entry.source + ': ' + params.entry.text);
    }
  });
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride',
    { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  try { await page.send('Page.setWebLifecycleState', { state: 'active' }); } catch { /* older Chrome */ }

  await page.send('Page.navigate',
    { url: `http://127.0.0.1:${port}${GAME}?seed=${seed}&photonver=${PHOTONVER}` });
  let info;
  try { info = await evaluate(page, BOOT, 90000); } catch (err) { info = { ok: false, err: err.message }; }

  if (!info.ok) {
    problems++;
    console.log(`FAIL  seed ${seed} — never became ready${info.err ? ' — ' + info.err : ''}`);
  } else {
    const input = createInput(page);
    /* THE CLICK IS THE WHOLE ENTRY. It dismisses the controls modal and buys
       the pointer lock in the same gesture — which is exactly what it does for
       a player, and is why the modal exists at all. Without the lock the
       mousemove handler returns on its first line and the harness has no aim. */
    await input.click(W / 2, H / 2);
    await wait(900);
    const l = await evaluate(page, LOOK, 30000);
    if (!l.locked) {
      problems++;
      console.log(`FAIL  seed ${seed} — no pointer lock; every shot would be aimless`);
    } else {
      try { await plan(page, input, seed); }
      catch (err) { problems++; console.log(`FAIL  seed ${seed} — ${err.message}`); }
    }
  }
  for (const e of errs) { problems++; console.log(`      ! ${e}`); }

  await chrome.browser.send('Target.closeTarget', { targetId: page.targetId });
  await page.close();
  await wait(200);
}

/**
 * Point the camera at a world position, through the real mousemove path.
 *
 * The angle is computed here and turned into MOUSE MOVEMENT, not written into
 * the game: main.js owns yaw and pitch and rebuilds the camera from them every
 * render frame, so anything set directly on the camera is gone by the next
 * frame anyway. Converting to pixels and dispatching them means the aim goes
 * through the same line a player's wrist does — `yaw += movementX * SENS`.
 *
 * Wrapped to the short way round, or a target four degrees to the left of
 * straight-behind sweeps the view 356 degrees the other way.
 */
async function aimAt(page, input, target, { lead = 0 } = {}) {
  const l = await evaluate(page, LOOK, 30000);
  if (l.err) throw new Error('look failed: ' + l.err);
  const dx = target.x - l.cam.x;
  const dy = target.y - l.cam.y + lead;
  const dz = target.z - l.cam.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  const wantYaw = Math.atan2(dx / len, dz / len);
  const wantPitch = -Math.asin(dy / len);
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const dYaw = wrap(wantYaw - l.cam.yaw);
  const dPitch = Math.max(-1.5, Math.min(1.5, wantPitch)) - l.cam.pitch;
  await input.aim(dYaw / TUNE.SENS, dPitch / TUNE.SENS, 16);
  await frames(page, 4);
  return l;
}

/** Nearest live enemy of a kind, or null. */
async function find(page, kind) {
  const l = await evaluate(page, LOOK, 30000);
  return (l.seen || []).find((e) => e.kind === kind) || null;
}

/* `minAlt` is the altitude the caption is CLAIMING, and it is checked at the
   shutter rather than when the climb finished. The jet holds about three and a
   half seconds of fuel, and the second airborne frame of the first working run
   came back captioned "51m, serpent at 12.7m" with the HUD reading ALT 1m —
   the tank had run dry during the aim and the player was standing on the floor
   again. Same class of mistake as a rover captioned as a jet, same fix. */
/* ONE SHOT FAILING MUST NOT COST THE REST OF THE SEED.
   The plan is a straight line of awaits, so the first throw ends it — and the
   throw that kept happening was the altitude guard on the serpent frame, which
   silently took the wraith frame down with it every run. A refused caption is
   a success for the guard and should cost exactly the frame it refused. */
async function attempt(label, fn) {
  try { await fn(); }
  catch (err) { console.log(`  --  ${label}: ${err.message}`); }
}

async function take(page, opts) {
  const l = await evaluate(page, LOOK, 30000);
  if (l.paused) throw new Error('paused at capture — the page lost visibility');
  if (opts.minAlt && l.cam.y < opts.minAlt) {
    throw new Error(`shot claims airborne but the player is at ${l.cam.y.toFixed(0)}m`
      + ` (wanted ${opts.minAlt}m) — the jetpack ran dry before the shutter`);
  }
  const inView = (l.seen || []).slice(0, 3).map((e) => e.kind).join('+') || 'nothing';
  const file = await roll.take(page, {
    ...opts,
    note: `hp ${l.hp} · alt ${l.alt} · nearest: ${inView}${opts.note ? ' · ' + opts.note : ''}`,
  });
  console.log(`  ok  ${opts.shot} / ${opts.variant}  (hp ${l.hp}, alt ${l.alt}, near ${inView})`);
  return file;
}

/** Hold the keys and the trigger across the capture, so the frame is mid-burst. */
async function act(page, input, { keys = [], fire = false, ms = 900, ...opts }) {
  for (const c of keys) await input.down(c);
  /* The trigger is pressed here and released after the capture, rather than
     through input.hold1 — that helper presses and releases around its own
     wait, and the whole point of this function is that the shutter falls
     BETWEEN the two. Firing is a held state in this game (mousedown sets
     `firing`, mouseup clears it), so a photograph of a burst has to be taken
     with the button still down. */
  if (fire) {
    await page.send('Input.dispatchMouseEvent',
      { type: 'mousePressed', x: W / 2, y: H / 2, button: 'left', clickCount: 1, buttons: 1 });
  }
  await wait(ms);
  await frames(page, 4);
  const file = await take(page, opts);
  if (fire) {
    await page.send('Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: W / 2, y: H / 2, button: 'left', clickCount: 1, buttons: 0 });
  }
  for (const c of keys) await input.up(c);
  return file;
}

/* GET OFF THE FLOOR, the way the game intends — and the timing is the whole
   trick.
   Space on the ground is a jump. Space pressed again IN THE AIR latches the
   JET, but only if all three of main.js's conditions hold at that instant:
   not grounded, coyote time expired (it is 0.1s), and no wall nearby. Miss any
   one and the same key buffers another jump instead, which is what the first
   cut did on all three seeds — "jet only reached 1m" three times, because a
   fixed 520ms wait after the hop found the player either already landed or
   still standing in the spawn booth, where FLAG.WALLNEAR is set.
   So this walks out of the booth first, then WATCHES for the apex instead of
   guessing at it: poll the altitude, and press the moment the player is
   demonstrably off the ground and past coyote. */
async function climb(page, input, ms = 2600) {
  // Out of the spawn booth. WALLNEAR alone will refuse the latch, and the
  // booth is three walls.
  await input.hold(['KeyW'], 1200);
  await frames(page, 6);

  const before = await evaluate(page, LOOK, 30000);
  const y0 = before.cam.y;

  await input.tap('Space', 60);
  /* Polled in-page: a round trip per sample from node would be most of the
     window. Waits for real height AND for coyote to have burned off — 140ms is
     comfortably past the 0.1s grace and still well inside the rise. */
  const airborne = await evaluate(page, `(async () => {
    const f = () => new Promise((r) => requestAnimationFrame(r));
    const cam = BABYLON.Engine.Instances[0].scenes[0].activeCamera;
    const t0 = performance.now();
    while (performance.now() - t0 < 900) {
      await f();
      if (cam.position.y > ${y0} + 1.0 && performance.now() - t0 > 140) {
        return +cam.position.y.toFixed(2);
      }
    }
    return null;
  })()`, 30000);

  if (airborne === null) {
    return { alt: y0, release: () => input.up('Space'), latched: false };
  }
  await input.down('Space');
  await wait(ms);
  const l = await evaluate(page, LOOK, 30000);
  return {
    alt: l.cam.y,
    latched: l.cam.y > airborne + 3,
    /* The jet stays HELD on return. Every airborne frame is taken with the key
       down — release it and the shot is of a fall, the plume is gone, and the
       altitude in the caption is already wrong. */
    release: () => input.up('Space'),
  };
}

for (const seed of SEEDS) {
  await run(seed, async (page, input) => {
    // ── 1. On the ground, looking at ground-level action ────────────────
    // Blobs hop across the arena floor and spikes patrol it; either is the
    // ground fight. Walk INTO it rather than sniping from spawn — the frame
    // wants the enemy at a size you can read.
    let t = (await find(page, 'blob')) || (await find(page, 'spike'));
    if (t) {
      await aimAt(page, input, t);
      await act(page, input, { keys: ['KeyW'], fire: true, ms: 1500,
        shot: 'Ground level — the floor fight',
        variant: `seed ${seed} · closing on a ${t.kind} at ${t.d}m`,
        repro: `?seed=${seed} · click · aim at nearest ${t.kind} · W + fire 1.5s (shot held)` });

      // Closer, dashing, still firing: the same fight from inside it.
      t = (await find(page, 'blob')) || (await find(page, 'spike'));
      if (t) await aimAt(page, input, t);
      await act(page, input, { keys: ['KeyW', 'ShiftLeft'], fire: true, ms: 1200,
        shot: 'Ground level — the floor fight',
        variant: `seed ${seed} · dashing in close`,
        repro: `?seed=${seed} · aim at nearest ${t ? t.kind : 'enemy'} · W+Shift + fire 1.2s (shot held)` });
    } else {
      console.log(`  --  seed ${seed}: no blob or spike in the scene for the ground shot`);
    }

    // ── 2. On the ground, looking UP ────────────────────────────────────
    // Wraiths orbit from 22m, so from the floor they are the sky threat that
    // is actually close enough to read. The serpent gets its own frame from
    // the air, below — squinting at one 90m up produced a handsome sunset
    // with a few blue pixels in the corner, which is not "a shot with a
    // serpent in it".
    const wr = await find(page, 'wraith');
    if (wr) {
      await aimAt(page, input, wr);
      await act(page, input, { keys: ['KeyA'], fire: true, ms: 1100,
        shot: 'Ground level — looking up',
        variant: `seed ${seed} · wraith overhead at ${wr.d}m`,
        repro: `?seed=${seed} · aim at nearest wraith · A + fire 1.1s (shot held)` });
    } else {
      console.log(`  --  seed ${seed}: no wraith in the scene`);
    }

    // ...and the wide version of the same look, aimed up the column, which is
    // the frame that shows the arena is 570m tall and not a room.
    const serpFar = await find(page, 'serpent');
    if (serpFar) {
      await aimAt(page, input, serpFar);
      await act(page, input, { ms: 800,
        shot: 'Ground level — looking up',
        variant: `seed ${seed} · up the column, serpent at ${serpFar.d}m`,
        repro: `?seed=${seed} · aim at nearest serpent head (shot held)` });
    }

    /* ── 3. AIRBORNE, and each of these buys its own tank ───────────────
       TANK holds about three and a half seconds of burn and FUEL_REGEN puts it
       back at 16 a second on the ground. Three airborne frames off one climb
       does not fit — the first version spent it on the ascent and the aim, and
       every later frame came back at 1m with the guard refusing the caption.
       Landing between them and waiting is not a workaround; it is the loop the
       game is built around, and eight seconds on the floor is a full tank. */
    const regen = async () => { await wait(8000); };

    // Looking down: the shot that shows the level as a place rather than as
    // the wall in front of you. Straight after the first climb, at full height.
    await attempt('airborne, looking down', async () => {
      const up = await climb(page, input, 3400);
      if (up.alt < 12) throw new Error(`jet reached only ${up.alt.toFixed(0)}m`);
      await aimAt(page, input, { x: 0, y: 0, z: 0 });
      await act(page, input, { ms: 700, minAlt: 12,
        shot: 'Airborne — looking down',
        variant: `seed ${seed} · ${up.alt.toFixed(0)}m over the arena`,
        repro: `?seed=${seed} · Space jump, 0.5s, Space held 3.4s · aim at origin (shot held)` });
      await up.release();
    });

    // The serpent, from level with it. Its own climb, because aiming at a
    // moving serpent costs most of a tank on its own.
    await regen();
    await attempt('airborne, level with a serpent', async () => {
      const up = await climb(page, input, 2600);
      if (up.alt < 12) throw new Error(`jet reached only ${up.alt.toFixed(0)}m`);
      const serp = await find(page, 'serpent');
      if (!serp) throw new Error('no serpent head in the scene');
      await aimAt(page, input, serp);
      await act(page, input, { fire: true, ms: 600, minAlt: 10,
        shot: 'Airborne — level with a serpent',
        variant: `seed ${seed} · ${up.alt.toFixed(0)}m, serpent at ${serp.d}m`,
        repro: `?seed=${seed} · Space jump, 0.5s, Space held 2.6s · aim at serpent head · fire 0.6s (shot held)` });
      await up.release();
    });

    /* ── 4. A WRAITH, CLOSE ENOUGH TO BE A WRAITH ────────────────────────
       The brief asks for wraiths and seventeen candidates could not deliver
       one. Not for want of wraiths — five orbit from boot — but because of
       WHERE: placeWraith puts them at 22m to (summit-40) on a radius of a
       fifth to two thirds of the arena, so from the floor the nearest is
       65-270m away and lands on about eight pixels.
       Flying to one does not work either, twice proved: a wraith is a hundred
       metres out and the tank is three and a half seconds long.
       So close the distance ON FOOT, which is free, and spend the tank only on
       the last twelve metres. That is also exactly the geometry the game asks
       for — enemies.js flips a wraith from `orbit` to `swoop` when the player
       is inside 22m horizontally and 16m vertically — so running under the
       lowest one and hopping into its band is not a trick to get a photograph,
       it is the thing that makes a wraith come at you. */
    await regen();
    await attempt('a wraith at close range', async () => {
      for (let leg = 0; leg < 14; leg++) {
        const w = await find(page, 'wraith');
        if (!w) throw new Error('no wraith in the scene');
        const l = await evaluate(page, LOOK, 30000);
        const flat = Math.hypot(w.x - l.cam.x, w.z - l.cam.z);
        if (flat < 18) break;
        /* Aim LEVEL at its ground position, not up at the wraith. W runs along
           the camera's horizontal forward, so aiming up still runs you there
           but points the view at empty sky. */
        await aimAt(page, input, { x: w.x, y: l.cam.y, z: w.z });
        await input.hold(['KeyW', 'ShiftLeft'], 700);
      }
      /* HOVER IN THE BAND AND WAIT, across three tanks.
         One hop is a three-and-a-half second window and a wraith on a 20-55m
         orbit at 0.25-0.6 rad/s sweeps past a given bearing in about that long,
         so a single hop is a coin flip — and it came up tails on all three
         seeds twice running. Three tanks with a landing between them is thirty
         seconds of real waiting for a bird to come round, which is what
         waiting for a bird to come round costs. */
      let closed = null;
      let hop = null;
      for (let tank = 0; tank < 3 && !closed; tank++) {
        if (tank) { await wait(8000); }
        hop = await climb(page, input, 900);
        // Poll the whole burn rather than a fixed count: the wraith only has
        // to be close for one frame for the shutter to be worth opening.
        for (let i = 0; i < 26 && !closed; i++) {
          const w = await find(page, 'wraith');
          if (w && w.d < 30) { closed = w; break; }
          await frames(page, 6);
        }
        if (!closed) await hop.release();
      }
      if (!closed) throw new Error('no wraith came inside 30m in three tanks');
      await aimAt(page, input, closed);
      await act(page, input, { fire: true, ms: 600,
        shot: 'A wraith at close range',
        variant: `seed ${seed} · wraith at ${closed.d}m`,
        repro: `?seed=${seed} · run to under the nearest wraith · Space hop · fire 0.6s (shot held)` });
      await hop.release();
    });
  });
}

// ---- the sheet ----------------------------------------------------------
const sheet = roll.write('Arena 1 — gallery candidates');
{
  const page = await chrome.newPage();
  await page.send('Page.enable');
  await page.send('Page.navigate',
    { url: `http://127.0.0.1:${port}${GAME}dev/shots/gallery/sheet.html` });
  await wait(2500);
  const size = await evaluate(page, `(async () => {
    await new Promise((r) => requestAnimationFrame(r));
    return { h: document.documentElement.scrollHeight };
  })()`);
  await page.send('Emulation.setDeviceMetricsOverride',
    { width: 1600, height: Math.min(size.h, 30000), deviceScaleFactor: 1, mobile: false });
  await wait(1200);
  /* JPEG, following dev/shots.mjs. The CANDIDATES are regenerable in one
     command and a megabyte apiece, so .gitignore drops them; the SHEET is the
     artefact — it is what Dex looks at to choose — and at q82 it is a couple
     of hundred kilobytes rather than one and a half megabytes. Same split, and
     the same file type, as the contact sheets already committed beside it. */
  const shot = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 }, 60000);
  writeFileSync(join(OUT, 'sheet.jpg'), Buffer.from(shot.data, 'base64'));
  await chrome.browser.send('Target.closeTarget', { targetId: page.targetId });
  await page.close();
}

console.log(`\n${roll.list().length} candidates → ${OUT}`);
console.log(`sheet: ${sheet}`);
console.log(problems ? `\n${problems} PROBLEM(S) — see above` : '\nno problems');

await chrome.close();
closeServer();
process.exit(problems ? 1 : 0);
