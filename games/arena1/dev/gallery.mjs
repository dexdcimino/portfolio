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
/* `--only <text>` runs just the named shots. A gallery frame gets RE-shot far
   more often than the set gets shot from scratch — one frame is rejected and
   wants six more candidates — and the full run is four minutes a seed, most of
   it waiting on the fuel tank to refill for shots nobody is looking at. */
const ONLY = flag('only', '').toLowerCase();
const wanted = (shot) => !ONLY || shot.toLowerCase().includes(ONLY);

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

/* WHAT IS FILLING THE FRAME — the third thing a caption can lie about.
   "Ground level, looking up" shipped for a while as a frame whose right half
   was one pink crystal four metres from the lens: a real moment, honestly
   captured, and a photograph of a rock. The vehicle guard and the altitude
   guard could both pass on it, because neither is about what the picture is
   OF. So this is the third assertion, and it is measured the same way and at
   the same moment as the other two.
   A grid of picking rays over the viewport, and the answer is the fraction of
   the frame that is something within NEAR_M metres. Rays rather than bounding
   spheres because a bounding sphere on a 7m crystal is 7m of nothing in three
   directions, and the question is what is actually painted.
   THE PREDICATE IS LOAD-BEARING TWICE. Babylon skips `isPickable:false`
   meshes only when no predicate is given — crystals, rings and pebbles are all
   marked unpickable for the sim's benefit, so without one this measures
   everything EXCEPT the thing it was written to catch. And it is where the two
   deliberate exclusions live: the viewmodel (`gb`/`gbar`/`gf`/`he` — the
   player's own gun is in every frame by design and is the game's face, not an
   obstruction) and the floor, which is not "in front of" anything.
   The LOD proxies go too: `crysM*`/`crysL*` are clones Babylon draws through
   the master's world matrix, so they are all still sitting at the origin and
   a ray through the middle of the arena would hit sixty of them. */
const NEAR_M = 18;
const CLEAR = `(() => {
  try {
    const s = BABYLON.Engine.Instances[0].scenes[0];
    const e = s.getEngine();
    const W = e.getRenderWidth(), H = e.getRenderHeight();
    const keep = (m) => m.isEnabled() && m.isVisible && m.isReady()
      && !/^(gb|gbar|gf|he|ground|peb|crysM|crysL)/.test(m.name);
    /* 24x14 = 336 rays, about half a second. Fine enough that a crystal
       filling a fifth of the frame reads as a fifth, cheap enough to run at
       every shutter and at every step of the walk that looks for a spot. */
    const GX = 24, GY = 14;
    let hit = 0, tot = 0, closest = 1e9, cname = '';
    const by = new Map();
    for (let iy = 0; iy < GY; iy++) for (let ix = 0; ix < GX; ix++) {
      const p = s.pick((ix + 0.5) * W / GX, (iy + 0.5) * H / GY, keep);
      tot++;
      if (p && p.hit && p.distance < ${NEAR_M}) {
        hit++;
        by.set(p.pickedMesh.name, (by.get(p.pickedMesh.name) || 0) + 1);
        if (p.distance < closest) { closest = p.distance; cname = p.pickedMesh.name; }
      }
    }
    /* Both numbers are reported because they are different failures. "near"
       is clutter — a dozen small things close in — and "worst" is the one
       object that ate the frame, which is the thing that got rejected. */
    let worst = ['nothing', 0];
    for (const [n, c] of by) if (c > worst[1]) worst = [n, c];
    return { near: +(hit / tot).toFixed(3), worst: worst[0],
             worstFrac: +(worst[1] / tot).toFixed(3),
             closest: closest > 1e8 ? null : +closest.toFixed(1), closestName: cname };
  } catch (err) { return { err: String(err) }; }
})()`;

/* SOMEWHERE TO STAND WHERE THE SKY IS THE SUBJECT.
   The crystal was not bad luck. Spawn is (0, 26) with a 12m carve around it,
   the scatter band starts at 20m, and the looking-up shot was taken from
   wherever the floor fight had left the player — so the nearest crystal was
   reliably about one crystal-radius outside the carve and reliably enormous.
   Rather than walk in a hopeful direction and re-measure, ask the level: score
   floor positions by how far they are from anything with a footprint, and
   walk to the best one that is not a hike. Blockers are read as bounding
   spheres and the clearance is edge-to-edge, so a fat crystal counts as fat.
   The two rejections are the rim (a wall 12m tall right beside you is the same
   photograph) and the middle, where the 26m spire is. */
const OPEN_SPOT = `(() => {
  try {
    const s = BABYLON.Engine.Instances[0].scenes[0];
    const c = s.activeCamera;
    const blockers = [];
    for (const m of s.meshes) {
      if (!m.isEnabled() || !m.isVisible) continue;
      if (!/^(crys[0-9]+|pil[0-9]|cor[0-9]|spire|spireCap|slab[0-9]|padPlat[AB]|ramp[AB])$/
          .test(m.name)) continue;
      /* THE BOX, NOT THE SPHERE. A crystal is a unit icosphere scaled
         (s, sy, s) with sy up to three times s, and boundingSphere.radiusWorld
         is one number for all three axes — so a 2m-wide 7m-tall spike reads as
         7m wide and 12m tall and every position in the arena scores as blocked.
         The first cut of this returned "3.6 degrees of clear sky" for a spot
         whose frame came back 0% obstructed. The world AABB has the two
         extents this needs separately: how wide it is to walk around, and how
         tall it is to look over. */
      const bb = m.getBoundingInfo().boundingBox;
      const lo = bb.minimumWorld, hi = bb.maximumWorld;
      /* ON THE FLOOR, or it is scenery rather than an obstacle. The name
         crys<n> covers the 64 crystals scattered over the arena AND the 54
         more that dress the Ascent platforms, and the highest of those sits at
         565m. Scored as if it stood in front of you, a crystal 300m up leaves
         two degrees of clear sky ANYWHERE in the arena, which is how the first
         two cuts of this managed to report a spot as hopeless and then
         photograph a completely clear frame from it. */
      if (lo.y > 6) continue;
      blockers.push({ x: (lo.x + hi.x) / 2, z: (lo.z + hi.z) / 2,
                      r: Math.max(hi.x - lo.x, hi.z - lo.z) / 2, top: hi.y });
    }
    let best = null;
    for (let ring = 1; ring <= 7; ring++) {
      const rad = ring * 6;
      for (let k = 0; k < 24; k++) {
        const a = k * Math.PI * 2 / 24;
        const x = c.position.x + Math.cos(a) * rad, z = c.position.z + Math.sin(a) * rad;
        const fromMid = Math.hypot(x, z);
        /* THE BAND IS NOT "ANYWHERE CLEAR", and the first cut of this walked
           straight out of the picture. The Ascent spirals between 18m and 74m
           of the middle and climbs to 570m, so how much of it is overhead is
           entirely a question of how far out you stand: from 72m the column is
           a thing on the horizon and the frame is an empty orange sky, which
           is a different bad photograph from the crystal but just as bad. From
           20-42m it fills the upper half. The rim also stops mattering — the
           walls are at an apothem of 86.6m, so 42m out is 44m of clearance
           from the nearest one without having to score them. */
        if (fromMid > 42 || fromMid < 20) continue;
        /* THE SCORE IS AN ANGLE, not a distance, because the question is how
           high the skyline sits and that is what a distance cannot answer. Ten
           metres of clearance from a 3m crystal is open ground; ten metres
           from the 26m spire is a wall. So each blocker is measured as the
           ELEVATION of its top seen from here, and the spot keeps the worst
           one — SKY is how many degrees of clear air there are above the
           highest thing around you. It is also directly comparable with what
           the camera does: the fov is 0.8 rad, so a look pitched up 50 degrees
           has its bottom edge at 27, and a skyline under that is out of frame
           entirely.
           This is what seed 4400 needed. Scored on footprint alone it stood
           23m from the middle, cleared every crystal, and the spire filled a
           third of the frame — refused by maxNear, which is the guard
           working and the shot lost. */
        let sky = 90;
        for (const b of blockers) {
          const face = Math.max(0.5, Math.hypot(x - b.x, z - b.z) - b.r);
          sky = Math.min(sky, 90 - Math.atan2(b.top, face) * 180 / Math.PI);
        }
        // A degree of sky is worth about seven metres of walking.
        const score = sky - rad * 0.15;
        if (!best || score > best.score) {
          best = { x: +x.toFixed(2), z: +z.toFixed(2),
                   sky: +sky.toFixed(1), walk: rad, score };
        }
      }
    }
    return best || { err: 'no floor position scored' };
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
  /* `maxNear` is the same kind of promise as `minAlt`: a shot that says it is
     looking UP is claiming the sky is what you see, and a frame half-filled by
     a crystal is not that frame however honest the rest of it is. Refused here
     rather than noticed on the sheet, because five lying captions have got
     past a person looking at a sheet. */
  let clear = null;
  if (opts.maxNear != null) {
    clear = await evaluate(page, CLEAR, 60000);
    if (clear.err) throw new Error('clearance check failed: ' + clear.err);
    if (clear.worstFrac > opts.maxNear) {
      throw new Error(`${(clear.worstFrac * 100).toFixed(0)}% of the frame is `
        + `${clear.worst} within ${NEAR_M}m (allowed ${(opts.maxNear * 100).toFixed(0)}%)`
        + ` — the shot claims a clear look up`);
    }
    /* AND THE SAME OBSTRUCTION SPLIT IN TWO. The one-object cap alone passed a
       frame with a crystal down the left and a platform through the middle,
       12% each, because neither was the biggest thing on its own. Two things
       blocking a quarter of the picture is the failure this exists to catch,
       whatever the picking rays chose to call them. */
    if (opts.maxClutter != null && clear.near > opts.maxClutter) {
      throw new Error(`${(clear.near * 100).toFixed(0)}% of the frame is within `
        + `${NEAR_M}m across ${clear.worst} and others `
        + `(allowed ${(opts.maxClutter * 100).toFixed(0)}%)`
        + ` — the shot claims a clear look up`);
    }
  }
  const inView = (l.seen || []).slice(0, 3).map((e) => e.kind).join('+') || 'nothing';
  const file = await roll.take(page, {
    ...opts,
    note: `hp ${l.hp} · alt ${l.alt} · nearest: ${inView}`
      + (clear ? ` · foreground ${(clear.near * 100).toFixed(0)}% (worst ${clear.worst} `
        + `${(clear.worstFrac * 100).toFixed(0)}%)` : '')
      + (opts.note ? ' · ' + opts.note : ''),
  });
  console.log(`  ok  ${opts.shot} / ${opts.variant}  (hp ${l.hp}, alt ${l.alt}, near ${inView}`
    + (clear ? `, foreground ${(clear.near * 100).toFixed(0)}%` : '') + ')');
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

/**
 * Walk to a floor position, on foot, in legs.
 *
 * One long hold does not arrive: W runs along the camera's horizontal forward
 * and the target is a fixed point, so any drift — a crystal shouldered aside,
 * a pad, the slope off a ramp — compounds over ten metres. Re-aiming every leg
 * is what a player does and costs nothing.
 *
 * The aim is LEVEL, at the target's ground position rather than at the target,
 * for the same reason the wraith approach is: pitch does not steer, so aiming
 * up runs you there looking at empty sky and the arrival is already wrong.
 */
async function walkTo(page, input, spot, { legs = 10, within = 3.5 } = {}) {
  for (let leg = 0; leg < legs; leg++) {
    const l = await evaluate(page, LOOK, 30000);
    const left = Math.hypot(spot.x - l.cam.x, spot.z - l.cam.z);
    if (left < within) return left;
    await aimAt(page, input, { x: spot.x, y: l.cam.y, z: spot.z });
    // Sprint the long legs, walk the last few — a dash overshoots a 4m gap.
    await input.hold(left > 12 ? ['KeyW', 'ShiftLeft'] : ['KeyW'],
      Math.min(900, Math.max(220, left * 70)));
    await frames(page, 4);
  }
  const l = await evaluate(page, LOOK, 30000);
  return Math.hypot(spot.x - l.cam.x, spot.z - l.cam.z);
}

for (const seed of SEEDS) {
  await run(seed, async (page, input) => {
    // ── 1. On the ground, looking at ground-level action ────────────────
    // Blobs hop across the arena floor and spikes patrol it; either is the
    // ground fight. Walk INTO it rather than sniping from spawn — the frame
    // wants the enemy at a size you can read.
    let t = wanted('Ground level — the floor fight')
      ? (await find(page, 'blob')) || (await find(page, 'spike')) : null;
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
    } else if (wanted('Ground level — the floor fight')) {
      console.log(`  --  seed ${seed}: no blob or spike in the scene for the ground shot`);
    }

    /* ── 2. On the ground, looking UP ────────────────────────────────────
       AND THE FIRST THING IT DOES IS WALK SOMEWHERE. This shot shipped once
       with a pink crystal filling the right half of the frame, and that was
       not bad luck: the floor fight above leaves the player somewhere in the
       scatter band, the band starts 20m out with crystals up to 7m across, and
       the look up was taken from wherever that happened to be. So find an open
       piece of floor first, on the level's own terms, and photograph the sky
       from there — then let `maxNear` refuse the frame anyway if the walk did
       not work out.

       Wraiths orbit from 22m, so from the floor they are the sky threat that
       is actually close enough to read. The serpent gets its own frame from
       the air, below — squinting at one 90m up produced a handsome sunset with
       a few blue pixels in the corner, which is not "a shot with a serpent in
       it". Up the column it is a shape in a wide frame instead, which is a
       different and honest thing to ask of it.

       AN EIGHTH IS THE LINE, and it is on `worstFrac` — the single biggest
       near object — not on total clutter, because the rejected frame was one
       object at 45% and a busy skyline of small ones is a good photograph.
       It started at a fifth and that was too kind: seed 1291 came back with a
       pink crystal across the whole lower right of the frame, measured at 20%,
       and passed. A fifth of a 1920-wide frame is a quarter of the picture
       once you allow for the HUD, which is not "a bit of foreground". Every
       frame worth keeping so far has measured under 5%. */
    if (wanted('Ground level — looking up')) {
      const spot = await evaluate(page, OPEN_SPOT, 30000);
      if (spot.err) {
        console.log(`  --  seed ${seed}: no open floor position — ${spot.err}`);
      } else {
        const left = await walkTo(page, input, spot);
        console.log(`      open floor at ${spot.x},${spot.z}`
          + ` (${spot.sky}° of clear sky, ${spot.walk}m away)`
          + ` — stopped ${left.toFixed(1)}m off`);
      }

      const wr = await find(page, 'wraith');
      if (wr) {
        await aimAt(page, input, wr);
        await attempt('looking up, a wraith overhead', () => act(page, input,
          { keys: ['KeyA'], fire: true, ms: 1100, maxNear: 0.12, maxClutter: 0.18,
            shot: 'Ground level — looking up',
            variant: `seed ${seed} · wraith overhead at ${wr.d}m`,
            repro: `?seed=${seed} · walk to open floor · aim at nearest wraith`
              + ` · A + fire 1.1s (shot held)` }));
      } else {
        console.log(`  --  seed ${seed}: no wraith in the scene`);
      }

      // ...and the wide version of the same look, aimed up the column, which
      // is the frame that shows the arena is 570m tall and not a room.
      const serpFar = await find(page, 'serpent');
      if (serpFar) {
        await aimAt(page, input, serpFar);
        await attempt('looking up, the column', () => act(page, input,
          { ms: 800, maxNear: 0.12, maxClutter: 0.18,
            shot: 'Ground level — looking up',
            variant: `seed ${seed} · up the column, serpent at ${serpFar.d}m`,
            repro: `?seed=${seed} · walk to open floor · aim at nearest serpent head`
              + ` (shot held)` }));
      }

      /* ...and the same look with the COLUMN as the aim rather than whichever
         enemy is nearest, which is the frame that shows the arena is 570m tall
         and not a room. A serpent is somewhere in it either way — five of them
         are banded up the climb — but the subject is the Ascent.
         TWO HEIGHTS, because the aim decides the whole composition and there
         is no arguing it from here: 150m puts the lower spiral across the
         middle of the frame at a size you can read, 330m tips the view back
         until the stack runs off the top and the summit beacon is the vanishing
         point. Which of the two is the photograph is the sheet's question. */
      for (const up of [150, 330]) {
        await attempt(`looking up, the column at ${up}m`, async () => {
          const l = await evaluate(page, LOOK, 30000);
          await aimAt(page, input, { x: 0, y: up, z: 0 });
          await act(page, input, { ms: 700, maxNear: 0.12, maxClutter: 0.18,
            shot: 'Ground level — looking up',
            variant: `seed ${seed} · the Ascent to ${up}m, from ${Math.hypot(l.cam.x, l.cam.z)
              .toFixed(0)}m out`,
            repro: `?seed=${seed} · walk to open floor · aim at (0, ${up}, 0) (shot held)` });
        });
      }
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
    if (wanted('Airborne — looking down')) await attempt('airborne, looking down', async () => {
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
    if (wanted('Airborne — level with a serpent')) await attempt('airborne, level with a serpent', async () => {
      await regen();
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
    if (wanted('A wraith at close range')) await attempt('a wraith at close range', async () => {
      await regen();
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
