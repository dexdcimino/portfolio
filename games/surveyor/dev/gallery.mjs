// Gallery candidates — one shot per vehicle, each on a different world.
//
//   node dev/gallery.mjs                 all four vehicles, ~4 candidates each
//   node dev/gallery.mjs rover jet       just those
//
// This is NOT dev/shots.mjs. That harness answers "can these six worlds be told
// apart", so it hides the HUD, freezes the camera and photographs the thing
// under test. This one answers "would someone click on this", so it does the
// opposite: the real chase camera, the HUD up, and the craft actually driven
// there rather than placed. A frozen camera pointed at a placed craft is a
// render, and a render says "tech demo" in a section whose whole claim is that
// these are games a person can play.
//
// Four vehicles across four worlds is deliberate and it is the entire shot
// list: it covers both axes of the game's variety — what you are driving and
// where — in the four frames the gallery has room for.
//
// The candidates within a shot vary DISTANCE and MOMENT, because a session
// cannot tell which of them is appealing and four near-identical frames is not
// a choice. Each vehicle also gets one frame on a second world, in case its
// primary turns out to be the dull one; the sheet says which combinations keep
// four worlds distinct.

import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { launch, serve, evaluate, wait } from './cdp.mjs';
import { createInput, createRoll, settle, frames } from '../../_shared/dev/capture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../..');
const GAME = '/games/surveyor/';
const OUT = join(HERE, 'shots', 'gallery');

const W = 1920, H = 1080;

const argv = process.argv.slice(2);
const only = argv.filter((a) => !a.startsWith('--'));

/* THE SHOT LIST — one vehicle per world, and the pairing is the whole design.
   Four vehicles across four worlds covers both axes of the game's variety in
   the four frames the gallery has room for, and pairing each vehicle with the
   world that shows it best costs nothing over pairing them arbitrarily.
   Boat wants Tarn because Tarn is 85% ocean and its shore is close to spawn;
   jet wants Shroud because a jet is the only way to be above its fog and that
   is the one view of it that is not violet soup; drone wants Ember because a
   hover is the only stable way to hold still over cracked ground that is
   otherwise too small a world to drive across. */
const VEHICLES = [
  { key: 'rover', digit: 'Digit1', world: 'home' },
  { key: 'boat',  digit: 'Digit2', world: 'tarn' },
  { key: 'jet',   digit: 'Digit3', world: 'shroud' },
  { key: 'drone', digit: 'Digit4', world: 'ember' },
];

const PLANETS = (await import('../js/tune.js')).PLANETS;

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

/* BOOT AND SETTLE, and the queue is the honest signal.
   The terrain streams in over dozens of frames at two leaves apiece. A fixed
   sleep either wastes ten seconds or photographs a half-built planet, and a
   half-built planet is exactly the frame that is technically gameplay and looks
   broken. The start card is DISMISSED rather than hidden — the game has to be
   in its real running state, not a paused one wearing a running one's clothes. */
const BOOT = `(async () => {
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
  if (!S) return { ok: false };
  document.getElementById('begin').click();
  document.getElementById('start').style.display = 'none';
  /* THE HUD STAYS — it is what says "this is a game someone can play", which is
     the whole reason the games section has a gallery — but the DEV WARP row
     does not. That panel is testing scaffolding: tune.js says in as many words
     to turn it off before this ships, and attachWarp removes it from the
     document entirely when DEBUG.warp is false. A gallery shot should look like
     the shipped game, so it is hidden here for the same reason the start card
     is dismissed rather than photographed. */
  const warp = document.getElementById('warp');
  if (warp) warp.style.display = 'none';
  for (let i = 0; i < 60; i++) await frame();
  return { ok: true, planet: S.planet.name, mode: S.craft.mode };
})()`;

/* Put the boat on OPEN WATER, pointing along it.
   The first cut placed it 26m past the shoreline crossing and let the harness
   drive forward, and what came back was a boat parked on sand at 010 KM/H with
   a lake behind it. Two separate mistakes, both worth naming.
   It was not far enough out — 26m past a crossing is still the shallows, and a
   shoreline is not a straight line, so a short run along it beaches. Now the
   placement walks OUTWARD along the water bearing while the ground keeps
   falling away, up to 150m, and stops at the last point that still has real
   depth under it.
   And it was pointing wherever it happened to be pointing. `craft.yaw` is the
   heading everything integrates along — the boat builds its velocity as
   (sin yaw, cos yaw) — so facing it out to sea is one assignment, and without
   it "drive forward" meant "drive whichever way the spawn faced", which on
   Tarn was inland.
   The shoreline search itself is lifted from dev/frames.mjs's SHORE, minus the
   camera half: this one hands the camera straight back to the game, because the
   shot is of a boat and not of a pan across a coast. */
const TO_SHORE = `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const S = window.SURVEYOR;
  if (!S.planet.hasWater) return { shore: null };
  const find = () => {
    const N = 1200, REACH = S.planet.radius * 0.6;
    let best = null;
    for (let a = 0; a < N; a++) {
      const ang = a * 2.39996323;
      const r = 14 + REACH * Math.sqrt(a / N);
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      if (Math.abs(S.surfaceHeight(x, z)) > 0.9) continue;
      let wet = 0, dry = 0;
      for (let k = 1; k <= 6; k++) {
        const d = k * 7.5;
        if (S.surfaceHeight(x + Math.cos(ang) * d, z + Math.sin(ang) * d) < -1.1) wet++;
        if (S.surfaceHeight(x - Math.cos(ang) * d, z - Math.sin(ang) * d) > 0.6) dry++;
      }
      if (wet < 4 || dry < 3) continue;
      if (!best || r < best.r) best = { x, z, r, ang };
    }
    return best;
  };
  const best = find();
  if (!best) return { shore: null };
  const found = best.r;

  // Walk out along the water bearing, keeping the last point with depth under
  // it. Stops early at a sandbar rather than marching over one into a lagoon.
  let ox = best.x, oz = best.z, out = 0;
  for (let d = 20; d <= 150; d += 10) {
    const x = best.x + Math.cos(best.ang) * d;
    const z = best.z + Math.sin(best.ang) * d;
    if (S.surfaceHeight(x, z) > -2.0) break;
    ox = x; oz = z; out = d;
  }
  if (out < 20) return { shore: null, why: 'no water deeper than 2m within 150m' };

  S.craft.pos.x = ox;
  S.craft.pos.z = oz;
  S.craft.pos.y = 0.8;
  S.craft.vel.x = 0; S.craft.vel.z = 0; S.craft.vel.y = 0;
  /* Face further out to sea. The heading basis is (sin yaw, cos yaw) over
     local (x, z), and the water lies along (cos ang, sin ang) — so the yaw
     that points at it is atan2 of those in that order, not the other way
     round. Getting it backwards points the boat down the beach. */
  S.craft.yaw = Math.atan2(Math.cos(best.ang), Math.sin(best.ang));
  for (let i = 0; i < 4; i++) await frame();
  const t1 = performance.now();
  let settled = 0;
  while (performance.now() - t1 < 30000) {
    await frame();
    settled = S.field.queue.length === 0 ? settled + 1 : 0;
    if (settled > 20) break;
  }
  return { shore: +found.toFixed(0), out, onWater: !!S.craft.onWater,
           depth: +S.surfaceHeight(ox, oz).toFixed(1) };
})()`;

/* Lift a flyer off the ground before it is asked to fly.
   A jet at rest on a hillside does not take off from a standing start inside
   the seconds this harness has, and a drone spawned in rover mode is sitting on
   its skids. Both are ALTITUDE, not flight: the craft is raised and held while
   the ground streams under it, then handed back, and the wingtip trail is reset
   afterwards because holding an altitude every frame is a teleport per frame
   and the TrailMesh will happily draw every one of them (see frames.mjs). */
const LIFT = (frac) => `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const S = window.SURVEYOR;
  /* CAPPED WELL UNDER THE HYPER THRESHOLD, and this is a real ceiling rather
     than a safety margin. HYPER.approachAlt is 900 metres ABSOLUTE — it is the
     boundary the whole travel model is built on — so a craft that gets above it
     leaves for another world, which is the game working exactly as designed and
     ruinous for a photograph. A boosted climb on Shroud reached 901m and the
     run carried on captioning the next three frames "Jet - Shroud" while the
     craft was in transit to Tarn; only the expect: 'jet' check noticed, and
     only because it arrived as a boat.
     650 leaves room for a boosted climb to overshoot and still stay home. */
  const alt = Math.min(S.planet.radius * ${frac}, 650);
  S.craft.pos.y = alt;
  S.craft.vel.set(0, 0, 0);
  for (let i = 0; i < 4; i++) await frame();
  const t0 = performance.now();
  let settled = 0;
  while (performance.now() - t0 < 30000) {
    await frame();
    S.craft.pos.y = alt;
    S.craft.vel.y = 0;
    settled = S.field.queue.length === 0 ? settled + 1 : 0;
    if (settled > 20) break;
  }
  if (S.trails) S.trails.resetJetTrails();
  for (let i = 0; i < 4; i++) await frame();
  return { alt: +alt.toFixed(0) };
})()`;

const STATE = `(() => {
  const S = window.SURVEYOR;
  return { mode: S.craft.mode, y: +S.craft.pos.y.toFixed(1),
           speed: +S.craft.speed.toFixed(1), onWater: !!S.craft.onWater,
           planet: S.planet.name, leaves: S.field.live.size };
})()`;

// ---- run ----------------------------------------------------------------

const { port, close: closeServer } = await serve(SITE);
/* GPU, not SwiftShader. dev/shots.mjs is right to default to software — its
   sheets are compared to each other and a software rasteriser is the same
   everywhere. This one is not a comparison, it is the picture people will see,
   and 1920x1080 of a streamed planet through SwiftShader is minutes per frame
   as well as a different picture. */
const chrome = await launch({ width: W, height: H, gpu: true });
console.log(`${chrome.version} — ${W}x${H}, GPU\n`);

const roll = createRoll(OUT, { width: W, height: H });
let problems = 0;

/** One boot on one world, driven by `plan`, which takes (page, input, take). */
async function run(world, label, plan) {
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
    // The CSP half of the verification: a blocked inline script or a refused
    // connection is reported here and nowhere else.
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
  await page.send('Page.navigate', { url: `http://127.0.0.1:${port}${GAME}?planet=${world}` });

  let info;
  try {
    info = await evaluate(page, BOOT, 120000);
  } catch (err) { info = { ok: false, err: err.message }; }

  if (!info.ok) {
    problems++;
    console.log(`FAIL  ${label} on ${world} — never became ready${info.err ? ' — ' + info.err : ''}`);
  } else {
    const input = createInput(page);
    try {
      await plan(page, input, info);
    } catch (err) {
      problems++;
      console.log(`FAIL  ${label} on ${world} — ${err.message}`);
    }
  }
  for (const e of errs) { problems++; console.log(`      ! ${e}`); }

  await chrome.browser.send('Target.closeTarget', { targetId: page.targetId });
  await page.close();
  await wait(200);
}

/** Switch vehicle the way a player does — the number row, through the sim. */
async function toMode(page, input, digit, key) {
  await input.tap(digit);
  await frames(page, 40);
  const s = await evaluate(page, STATE, 30000);
  if (s.mode !== key) throw new Error(`asked for ${key}, got ${s.mode}`);
  return s;
}

/* `expect` is the vehicle the caption is CLAIMING, and it is checked.
   Twelve candidates came back once with four of them captioned "Jet - Shroud"
   and every one of them a rover: the jet had been lifted, told to pitch down,
   and had flown into the ground inside the second and a half before the
   shutter — landing puts you back in rover, correctly. The pictures were
   handsome and completely wrong, and nothing in the run said so.
   A caption that cannot be wrong is worth more than a shot that might be. */
async function take(page, opts) {
  const s = await evaluate(page, STATE, 30000);
  if (opts.expect && s.mode !== opts.expect) {
    throw new Error(`shot claims ${opts.expect} but the craft is a ${s.mode}`
      + ` (y=${s.y}m) — it did not stay in the air`);
  }
  const file = await roll.take(page, {
    ...opts,
    note: `${s.planet} · ${s.mode} · ${s.speed}m/s · y=${s.y}m${opts.note ? ' · ' + opts.note : ''}`,
  });
  console.log(`  ok  ${opts.shot} / ${opts.variant}  (${s.planet}, ${s.mode}, ${s.speed}m/s, y=${s.y}m)`);
  return file;
}

const want = (k) => !only.length || only.includes(k);

/* THE PHOTOGRAPH HAS TO HAPPEN WHILE THE KEY IS STILL DOWN.
   The first run of this harness came back with four handsome frames of a rover
   reading 000 KM/H. Nothing was wrong with the driving: `hold` presses, waits,
   and RELEASES, and a rover with no throttle stops inside the settle that
   follows. So every frame was captured after the drive rather than during it,
   and a stationary vehicle in the middle of open terrain reads as a render of a
   vehicle, which is the exact failure this whole file exists to avoid.
   Hence down / wait / a few frames to render at speed / SHOOT / up. The keys
   stay down across the capture, so the speedo, the wake, the trail and the
   suspension are all showing what they show in play. */
async function drive(page, input, codes, ms, opts) {
  const list = [].concat(codes);
  for (const c of list) await input.down(c);
  await wait(ms);
  await frames(page, 6);
  const file = await take(page, opts);
  for (const c of list) await input.up(c);
  return file;
}

/* THE DEV WARP IS NOT USED HERE, and it was tried.
   Warping to a second world instead of booting into it should have saved a
   sixty-second engine start per vehicle. What it did instead was wedge: the
   run reached Home's four frames, called S.warp('vault'), and never produced
   another file or another log line for twenty-five minutes — not an exception,
   which would have been caught and printed, and not the bounded drain loop,
   which gives up after forty-five seconds. The CDP input commands after it
   simply stopped coming back, which points at the renderer rather than the
   harness.
   That is worth understanding and it is NOT worth understanding here: this
   file's job is four photographs. Every vehicle gets its own boot at its own
   world, which is slower and has never once failed. If a future session wants
   the warp path exercised, dev/spawncheck.mjs is where that belongs. */

// ---- rover --------------------------------------------------------------
if (want('rover')) {
  const V = VEHICLES[0];
  await run(V.world, 'rover', async (page, input) => {
    const N = PLANETS[V.world].name;
    await toMode(page, input, V.digit, 'rover');

    // Mid-action and readable: out of the spawn dish, under power, so the frame
    // is somewhere rather than the place every session's first shot already is.
    await drive(page, input, ['KeyW'], 5200, {
      shot: `Rover - ${N}`, variant: 'under power, out past the spawn', expect: 'rover',
      repro: `?planet=${V.world} - Digit1 - W 5.2s (shot held)` });

    // Close: hard over, so the chassis is across the frame rather than pointing
    // away down its own axis, and the suspension is loaded.
    await drive(page, input, ['KeyW', 'KeyD'], 2600, {
      shot: `Rover - ${N}`, variant: 'banking into a turn', expect: 'rover',
      repro: `?planet=${V.world} - Digit1 - W 5.2s, W+D 2.6s (shot held)` });

    // Wide and atmospheric: a long boosted run puts real terrain between the
    // craft and the horizon, which is the only thing that gives a frame depth.
    await drive(page, input, ['KeyW', 'ShiftLeft'], 9000, {
      shot: `Rover - ${N}`, variant: 'boosted, deep terrain behind', expect: 'rover',
      repro: `?planet=${V.world} - Digit1 - W 5.2s, W+D 2.6s, W+Shift 9s (shot held)` });

    // The instruments at their busiest - the one frame where holding still is
    // the point, so it is the one frame that may be captured stopped.
    await input.hold(['KeyS'], 900);
    await input.down('KeyQ');
    await frames(page, 40);
    await take(page, { shot: `Rover - ${N}`, variant: 'halted, survey overlay held', expect: 'rover',
      repro: `?planet=${V.world} - Digit1 - W 5.2s, W+D 2.6s, W+Shift 9s, S 0.9s, hold Q` });
    await input.up('KeyQ');

  });
}

// ---- boat ---------------------------------------------------------------
if (want('boat')) {
  const V = VEHICLES[1];
  await run(V.world, 'boat', async (page, input) => {
    const N = PLANETS[V.world].name;
    const sh = await evaluate(page, TO_SHORE, 120000);
    if (!sh.shore) throw new Error('no shoreline found within half a radius');
    await toMode(page, input, V.digit, 'boat');
    await frames(page, 30);

    await take(page, { shot: `Boat - ${N}`, variant: 'afloat off the shore', expect: 'boat',
      repro: `?planet=${V.world} - placed ${sh.out}m out from shore ${sh.shore}m - Digit2` });

    // The wake is the boat's whole visual signature and it does not exist at
    // rest - this is the shot that most needed the key to still be down.
    await drive(page, input, ['KeyW'], 4500, {
      shot: `Boat - ${N}`, variant: 'under way, wake behind', expect: 'boat',
      repro: `?planet=${V.world} - shore ${sh.shore}m - Digit2 - W 4.5s (shot held)` });

    await drive(page, input, ['KeyW', 'ShiftLeft'], 5000, {
      shot: `Boat - ${N}`, variant: 'boosted across open water', expect: 'boat',
      repro: `?planet=${V.world} - shore ${sh.shore}m - Digit2 - W 4.5s, W+Shift 5s (shot held)` });

    // Turning back toward land, so the frame has a coast in it and is not a
    // boat on a featureless plate of blue.
    await drive(page, input, ['KeyW', 'KeyA'], 3200, {
      shot: `Boat - ${N}`, variant: 'turning back toward the coast', expect: 'boat',
      repro: `?planet=${V.world} - shore ${sh.shore}m - Digit2 - W 4.5s, W+Shift 5s, W+A 3.2s (shot held)` });

  });
}

// ---- jet ----------------------------------------------------------------
if (want('jet')) {
  const V = VEHICLES[2];
  await run(V.world, 'jet', async (page, input) => {
    const N = PLANETS[V.world].name;
    await toMode(page, input, V.digit, 'jet');
    /* HIGHER THAN THE FIRST CUT, and the number is a fraction of the RADIUS
       rather than metres — 80m over Shroud (R=1451) is a low pass and 80m over
       Ember (R=207) is most of the way to orbit. */
    const up = await evaluate(page, LIFT(0.12), 120000);

    /* S, NOT W. readInput maps forward to PITCH in the air — "in the air,
       forward is nose-down" is the comment on the line — so the obvious
       W+Shift for "fly along fast" is actually full throttle straight at the
       ground. From 80m that is about a second, which is less than the time
       between pressing it and taking the picture: all four jet frames came
       back as a rover driving on Shroud, because the jet had already landed.
       Every hold below either climbs or is short enough to still be airborne,
       and take() now refuses the shot if the craft is not a jet when the
       shutter falls. */
    await drive(page, input, ['KeyS', 'ShiftLeft'], 1100, {
      shot: `Jet - ${N}`, variant: `climbing out at ${up.alt}m`, expect: 'jet',
      repro: `?planet=${V.world} - Digit3 - held to ${up.alt}m - S+Shift 1.1s (shot held)` });

    // A banking climb: the silhouette is only legible rolled, and a tilted
    // horizon is what makes a still frame read as flight.
    /* One second, not 1.8. At nearly 500 m/s a boosted climb covers most of a
       kilometre in under two seconds, which is what put the craft through the
       hyper ceiling. */
    await drive(page, input, ['KeyS', 'KeyD', 'ShiftLeft'], 1000, {
      shot: `Jet - ${N}`, variant: 'banking hard, boosted climb', expect: 'jet',
      repro: `?planet=${V.world} - Digit3 - ${up.alt}m - S+D+Shift 1s (shot held)` });

    // Nose down over the ground — the frame that shows the world rather than
    // the sky, and the one a fog world needs to prove it has anything in it.
    // Short, and from a fresh altitude, because this one really is a dive.
    const high = await evaluate(page, LIFT(0.16), 120000);
    await drive(page, input, ['KeyW', 'ShiftLeft'], 900, {
      shot: `Jet - ${N}`, variant: `nose down from ${high.alt}m`, expect: 'jet',
      repro: `?planet=${V.world} - Digit3 - held to ${high.alt}m - W+Shift 0.9s (shot held)` });

    const top = await evaluate(page, LIFT(0.22), 120000);
    await drive(page, input, ['KeyS'], 700, {
      shot: `Jet - ${N}`, variant: `high pass at ${top.alt}m, horizon curved`, expect: 'jet',
      repro: `?planet=${V.world} - Digit3 - held to ${top.alt}m - S 0.7s (shot held)` });
  });
}

// ---- drone --------------------------------------------------------------
if (want('drone')) {
  const V = VEHICLES[3];
  await run(V.world, 'drone', async (page, input) => {
    const N = PLANETS[V.world].name;
    await toMode(page, input, V.digit, 'drone');

    // T climbs, G descends - the drone's vertical is a pair, and Space is
    // nothing at all in this mode.
    await drive(page, input, ['KeyT'], 2200, {
      shot: `Drone - ${N}`, variant: 'climbing, close over the ground', expect: 'drone',
      repro: `?planet=${V.world} - Digit4 - T 2.2s (shot held)` });

    await drive(page, input, ['KeyT', 'KeyW'], 3600, {
      shot: `Drone - ${N}`, variant: 'wide, out over the terrain', expect: 'drone',
      repro: `?planet=${V.world} - Digit4 - T 2.2s, T+W 3.6s (shot held)` });

    // The beam is the one thing the drone does that no other vehicle does, and
    // the reason the mode exists. Held, not toggled.
    await drive(page, input, ['KeyE', 'KeyG'], 1500, {
      shot: `Drone - ${N}`, variant: 'beam out, descending onto a site', expect: 'drone',
      repro: `?planet=${V.world} - Digit4 - T 2.2s, T+W 3.6s, E+G 1.5s (shot held)` });

    await drive(page, input, ['KeyW', 'KeyD'], 2400, {
      shot: `Drone - ${N}`, variant: 'strafing across a ridge', expect: 'drone',
      repro: `?planet=${V.world} - Digit4 - T 2.2s, T+W 3.6s, E+G 1.5s, W+D 2.4s (shot held)` });

  });
}

// ---- the sheet ----------------------------------------------------------
const sheet = roll.write('Surveyor — gallery candidates');
{
  const page = await chrome.newPage();
  await page.send('Page.enable');
  await page.send('Page.navigate',
    { url: `http://127.0.0.1:${port}${GAME}dev/shots/gallery/sheet.html` });
  await wait(2500);
  const size = await evaluate(page, `(async () => {
    await new Promise((r) => requestAnimationFrame(r));
    return { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight };
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
  const { writeFileSync } = await import('node:fs');
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
