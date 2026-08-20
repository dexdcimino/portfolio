// Gallery candidates for Stickland — all five shots replaced.
//
//   node dev/gallery.mjs                 every shot
//   node dev/gallery.mjs base tank        just those
//
// Browser and capture kit are shared with the other three games
// (games/_shared/dev/cdp.mjs and capture.mjs). Nothing here is a second copy.
//
// WHY THE OLD SET WAS WEAK, since that is what this file is answering. The four
// shots it replaces have NO HUD in them at all — no hotbar, no health bar, no
// chat button — and a stick figure about fifty pixels tall in the middle of a
// mostly black 1440x690 frame. Line art on black is this game's whole look and
// it photographs beautifully, but only when there is something in the frame:
// the figure close enough to read, the instruments that say a person plays
// this, and an actual event rather than a wide shot of a village nobody is in.
//
// So every shot below is framed around CONTENT — the tank, the forest, the
// jetpack, the cosmetics — and every one keeps the HUD.
//
// WHAT THE HARNESS KNOWS ABOUT THE WORLD, all of it read out of playmode.js
// rather than guessed: the world is 7200x4500, spawn is the forest base at
// (3600, 2250), the village row sits at y=2130 with home/treehouse/castle/
// shop/jail at x=3270/3435/3600/3765/3930, the tank is parked at (3150, 2170),
// and the deep forest is everything past x=4300, y=2150.

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { launch, serve, evaluate, wait } from '../../_shared/dev/cdp.mjs';
import { createInput, createRoll, frames } from '../../_shared/dev/capture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../..');
/* v1/, and DIRECTLY rather than through the /stickland wrapper.
   Two separate points. The wrapper's chrome — its exit chip, its iframe — has
   no business in a gallery shot. And `v1/index.html` is the build the SITE
   serves: build.mjs writes its output beside itself at games/stickland/
   index.html and the shipped copy is moved into v1/, so the two can differ by
   exactly one forgotten move. Photographing the shipped one means the shot
   cannot be of a build nobody can play. */
const GAME = '/games/stickland/v1/index.html';
const OUT = join(HERE, 'shots', 'gallery');

const W = 1920, H = 1080;

const argv = process.argv.slice(2);
const only = argv.filter((a) => !a.startsWith('--'));
const want = (k) => !only.length || only.includes(k);

// Places, from playmode.js. Named here so a shot says where it is going.
const HOME = { x: 3270, y: 2130 };
const CASTLE = { x: 3600, y: 2130 };
const TANK = { x: 3150, y: 2170 };
const FOREST = { x: 4750, y: 2500 };     // well inside the x>4300, y>2150 band

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

/* Stickland has no loading screen and no splash — enterPlayMode runs at boot
   and drops the character in. "Ready" is the play state existing and the HUD
   having finished its slide-up, which is the animation that would otherwise be
   caught halfway and photograph a hotbar sliding off the bottom of the frame. */
const BOOT = `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const t0 = performance.now();
  while (performance.now() - t0 < 30000) {
    await frame();
    if (window._dexGetPlayState?.()) break;
  }
  // The HUD slide is a CSS transition on #game-hud; hud-visible is its end
  // state, and waiting for the class is exact where a sleep is a guess.
  const t1 = performance.now();
  while (performance.now() - t1 < 6000) {
    await frame();
    if (document.getElementById('game-hud')?.classList.contains('hud-visible')) break;
  }
  for (let i = 0; i < 40; i++) await frame();
  const p = window._dexGetPlayState?.();
  return { ok: !!p, x: Math.round(p?.x ?? 0), y: Math.round(p?.y ?? 0) };
})()`;

/* WHERE THE FIGURE IS ON SCREEN, not in the world.
   The four-up panels are cropped tight around the character, and a crop needs
   pixels. The character is not drawn into the world canvas at all — it is a
   DOM overlay of SVG limbs (#char-overlay, .char-local), which is what makes
   this exact rather than a reconstruction of the camera transform: the browser
   already knows the box, and getBoundingClientRect is the answer.
   Falls back to the frame's centre if the overlay is not up, which is what
   platform mode and tank mode do — neither of which is cropped. */
const CHARBOX = `(() => {
  const el = document.querySelector('.char-local');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
           w: Math.round(r.width), h: Math.round(r.height) };
})()`;

const STATE = `(() => {
  const p = window._dexGetPlayState?.() || null;
  const t = window._dexGetTankState?.() || null;
  /* Platform mode has its own readout — "▲ 12m · best 81m · ✦ 0" — and it is
     the only altitude there is in that mode: _dexGetPlayState returns null
     because play mode is not active. Parsed rather than assumed, because four
     frames captioned "jetpacking" came back with the character standing on the
     ground and nothing in the run noticed. */
  /* #plat-stats by id, and parsed WITHOUT a regex on purpose. The first cut
     scanned every leaf element for a backslash-s, backslash-d pattern and
     matched nothing on a HUD that plainly read "0m": this whole expression is
     a template literal, and inside one those escapes collapse to plain s and d
     before the page ever sees them. Any regex written in here needs its
     backslashes doubled; not writing one is simpler and cannot regress.
     The element sets its own textContent, so slicing the marker off the front
     and letting parseInt stop at the m is exact.
     (No backticks in this comment either — one would close the literal.) */
  const platTxt = document.getElementById('plat-stats')?.textContent || '';
  const platAlt = platTxt ? (parseInt(platTxt.slice(1).trim(), 10) ?? -1) : -1;

  return {
    play: !!window._dexPlayModeActive,
    plat: !!window._dexPlatActive,
    x: p ? Math.round(p.x) : null,
    y: p ? Math.round(p.y) : null,
    anim: p?.animState || '', weapon: p?.weapon || 'none',
    platAlt,
    inTank: !!t?.inTank,
    tankX: t ? Math.round(t.tankX) : null,
    tankY: t ? Math.round(t.tankY) : null,
  };
})()`;

// ---- run ----------------------------------------------------------------

const { port, close: closeServer } = await serve(SITE);
const chrome = await launch({ width: W, height: H, gpu: true });
console.log(`${chrome.version} — ${W}x${H}, GPU\n`);

const roll = createRoll(OUT, { width: W, height: H });
let problems = 0;

/**
 * One boot.
 *
 * `prefs` is written into localStorage BEFORE the page loads, which is the only
 * moment it can be: character.js reads the hotbar and the cosmetics during
 * module evaluation, so anything written afterwards is a preference the game
 * has already decided it does not have.
 *
 * Writing them at all is honest for the same reason the reset rule draws the
 * line where it does: cosmetics and the hotbar are CHOSEN, not earned. Seeding
 * a chosen preference is standing in for a player who chose it. Seeding
 * progress would not be, and nothing here does.
 */
/* `dpr` renders the page at a higher device pixel ratio.
   Only the four-up uses it, and only because of what the character IS: the
   world is a 2D canvas whose backing store Stickland sizes in CSS pixels, but
   the CHARACTER is an SVG overlay in the DOM. At deviceScaleFactor 3 the canvas
   is composited up and softens, while the SVG is RE-RASTERISED — so the figure
   comes back with three times the real pixels rather than three times the same
   ones. That is the whole difference between a legible top hat and a smudge,
   and it is why the four-up is cropped out of a 5760x3240 capture at 1:1
   instead of being upscaled out of a 1920x1080 one.
   The background pays for it. In these panels the background is empty ground
   forty metres behind the subject, so it pays very little. */
async function run(label, plan, prefs = null, dpr = 1) {
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
    { width: W, height: H, deviceScaleFactor: dpr, mobile: false });
  try { await page.send('Page.setWebLifecycleState', { state: 'active' }); } catch { /* older Chrome */ }

  if (prefs) {
    /* Seeded on the ORIGIN, before the game's own script runs. addScriptToEvaluateOnNewDocument
       fires ahead of every document script, which is what makes this a
       preference the game boots with rather than one it is told about later. */
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try {
        localStorage.setItem('sfg-cosmetics', ${JSON.stringify(JSON.stringify(prefs.cosmetics))});
        localStorage.setItem('dexnote-hotbar', ${JSON.stringify(JSON.stringify(prefs.hotbar))});
      } catch (e) {}`,
    });
  }

  await page.send('Page.navigate', { url: `http://127.0.0.1:${port}${GAME}` });
  let info;
  try { info = await evaluate(page, BOOT, 90000); } catch (err) { info = { ok: false, err: err.message }; }

  if (!info.ok) {
    problems++;
    console.log(`FAIL  ${label} — never became ready${info.err ? ' — ' + info.err : ''}`);
  } else {
    const input = createInput(page);
    // A real click into the world: it is the gesture the audio graph is waiting
    // on, and a session with no sound is not quite the session.
    await input.click(W / 2, H * 0.62);
    await wait(400);
    try { await plan(page, input); }
    catch (err) { problems++; console.log(`FAIL  ${label} — ${err.message}`); }
  }
  for (const e of errs) { problems++; console.log(`      ! ${e}`); }

  await chrome.browser.send('Target.closeTarget', { targetId: page.targetId });
  await page.close();
  await wait(200);
}

/* ZOOM IN. The game has a camera zoom on the scroll wheel — 1.0 fully out to
   1.5, in 0.05 steps, smoothed — and not one of the four shots this file
   replaces used it. That is most of why they read as diagrams: at 1.0 on a
   1920-wide frame the stick figure is about fifty pixels in a very large dark
   room, and no amount of choosing WHERE to stand fixes a scale problem.
   Driven as a real wheel event, because that is the control: twelve notches of
   scroll-up is what a player does, and the game's own lerp eases it. The extra
   frames afterwards are for that lerp — photograph it too early and the shot is
   of a camera still moving. */
async function zoomIn(page, notches = 12) {
  for (let i = 0; i < notches; i++) {
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: W / 2, y: H / 2, deltaX: 0, deltaY: -120,
    }, 8000);
    await wait(45);
  }
  await frames(page, 45);
}

async function take(page, opts) {
  const s = await evaluate(page, STATE, 30000);
  if (opts.minPlatAlt && s.platAlt < opts.minPlatAlt) {
    throw new Error(`shot claims jetpacking but the platform HUD reads ${s.platAlt}m`
      + ' — the pack is equipped and the character never left the ground');
  }
  const box = opts.box ? await evaluate(page, CHARBOX, 15000) : null;
  const where = s.inTank ? `tank at ${s.tankX},${s.tankY}`
    : s.plat ? `platform mode, ${s.platAlt}m up`
    : `${s.x},${s.y}`;
  const file = await roll.take(page, {
    ...opts,
    note: `${where} · ${s.anim}${s.weapon !== 'none' ? ' · ' + s.weapon : ''}${opts.note ? ' · ' + opts.note : ''}`,
  });
  if (opts.box) {
    /* getBoundingClientRect answers in CSS pixels; the screenshot is in DEVICE
       pixels. Recording the ratio rather than pre-multiplying keeps the sidecar
       readable and puts the conversion in one place — the composite tool. */
    boxes[opts.variant] = box ? { ...box, dpr: FOURUP_DPR } : null;
    console.log(`  ok  ${opts.shot} / ${opts.variant}  (${where}, ${s.anim}`
      + (box ? `, figure ${box.w}x${box.h} at ${box.x},${box.y})` : ', figure NOT FOUND)'));
  } else {
    console.log(`  ok  ${opts.shot} / ${opts.variant}  (${where}, ${s.anim})`);
  }
  return file;
}

/* Written beside the PNGs so tools/make_gallery_composite.py can crop each
   four-up panel around its figure instead of centring on the frame. Keeping it
   as a sidecar rather than baking the crop in here is the same split the rest
   of the pipeline uses: the harness produces frames, one tool turns frames into
   a master, and neither knows the other's job. */
const boxes = {};

/* THE PACK NEEDS A JUMP UNDER IT BEFORE IT WILL THRUST.
   Holding Space from a standing start does nothing: character.js reads a
   grounded Space as the start of a CHARGE, and only lets the jetpack burn once
   the character is already off the floor. So four frames captioned
   "jetpacking" came back with the pack lit on the character's back, the HUD
   reading 0m, and the figure standing in the grass — the same shape of lie as
   a rover captioned as a jet, and caught the same way once something checked.
   Tap, let the hop clear the ground, then hold: measured, that takes the
   character from 0m to 52m in two seconds. */
async function platLift(page, input) {
  /* WAIT FOR THE FLOOR FIRST. Each shot releases Space, so the next one starts
     while the character is still falling from the last — and a jump needs
     ground under it. Tapping mid-fall does nothing, the hold that follows finds
     the character grounded a moment later, and the grounded branch swallows it
     as a charge: the second frame read 0m for exactly this reason.
     _dexPlatCharPos reports it, so this is a wait on the game's own state
     rather than a sleep long enough to probably work. */
  await evaluate(page, `(async () => {
    const f = () => new Promise((r) => requestAnimationFrame(r));
    for (let i = 0; i < 400; i++) {
      const P = window._dexPlatCharPos && window._dexPlatCharPos();
      if (P && P.grounded) return true;
      await f();
    }
    return false;
  })()`, 30000);
  /* ...and let the tank refill. JET_FUEL_MAX is 300 against a JET_REFILL of
     2.2 a frame while grounded, so a full tank is a little over two seconds of
     standing still and holds about 1.9s of thrust. The second frame read 0m
     even once it was jumping properly, because the first frame's 2.6s burn had
     emptied it and nothing waited. */
  await wait(3200);
  await input.tap('Space', 90);
  await wait(320);
}

/** Hold keys across the capture, so the frame is mid-action rather than after it. */
async function act(page, input, codes, ms, opts) {
  const list = [].concat(codes);
  if (opts.prejump) await platLift(page, input);
  /* RE-ZOOM AT THE SHUTTER, for the tank.
     zoomIn() after mounting does not survive: entering the tank hands the
     camera to _tickTank, which frames the hull at its own distance, and the
     wheel notches spent on the way in are simply gone. Every tank frame came
     back at zoom 1.0 — a small tank in a large black field, which is exactly
     what the pass-B session called out. Re-applying it here, inside the same
     act that takes the picture, means the zoom is the last thing that happens
     before the capture and nothing can undo it in between. */
  if (opts.rezoom) await zoomIn(page, opts.rezoom);
  for (const c of list) await input.down(c);
  await wait(ms);
  await frames(page, 4);
  const file = await take(page, opts);
  for (const c of list) await input.up(c);
  return file;
}

/* WALK THERE. WASD moves the character in world x and y — measured at about
   235 units a second, 360 sprinting — so this is a seek loop and not a
   teleport. It is also slow, which is the honest cost of a screenshot that is
   of somewhere the player can actually walk to. */
async function walkTo(page, input, target, { tol = 55, legs = 26, sprint = true } = {}) {
  let last = null, stuck = 0;
  for (let i = 0; i < legs; i++) {
    const s = await evaluate(page, STATE, 15000);
    if (s.x === null) return s;
    const dx = target.x - s.x, dy = target.y - s.y;
    if (Math.hypot(dx, dy) < tol) return s;

    /* THE BUILDINGS HAVE COLLISION AND THE FIRST CUT WALKED INTO ONE.
       Aiming at the front door of Home put the target behind its collision box,
       so the seek held A+W into the wall for all twenty-six legs, travelled 227
       units of the 300 it needed, and reported success by simply running out.
       Both halves are fixed: the targets below now sit on the open row rather
       than inside a footprint, and this notices. Sidestepping along the blocked
       axis is what a person does at a wall — it is also what gets you round the
       corner of a building rather than through it. */
    if (last && Math.hypot(s.x - last.x, s.y - last.y) < 18) {
      if (++stuck >= 2) {
        const side = Math.abs(dx) > Math.abs(dy)
          ? (dy >= 0 ? 'KeyS' : 'KeyW')     // blocked going across: slide vertically
          : (dx >= 0 ? 'KeyD' : 'KeyA');    // blocked going up/down: slide across
        await input.down(side);
        if (sprint) await input.down('ShiftLeft');
        await wait(650);
        await input.up(side);
        if (sprint) await input.up('ShiftLeft');
        stuck = 0;
        last = null;
        continue;
      }
    } else stuck = 0;
    last = s;

    const codes = [];
    if (dx < -12) codes.push('KeyA'); else if (dx > 12) codes.push('KeyD');
    if (dy < -12) codes.push('KeyW'); else if (dy > 12) codes.push('KeyS');
    if (!codes.length) return s;

    /* THE LEG HAS TO BE SHORTER THAN THE TOLERANCE NEAR THE END.
       A fixed 420ms leg covers about 150 world units sprinting, and the tank
       approach wants to stop within 40 of a point — so the seek stepped past
       the target, turned round, stepped past it the other way, and did that
       until it ran out of legs. It never got within the interact radius and
       the run reported "never got into the tank" for a walk that was working
       perfectly except at the very end.
       Distance-proportional, and sprint drops off once the target is close:
       at 235 units a second the last approach is fine-grained enough to land
       inside any tolerance worth asking for. */
    const dist = Math.hypot(dx, dy);
    const near = dist < 180;
    if (sprint && !near) codes.push('ShiftLeft');
    const speed = near ? 0.235 : 0.36;          // units per millisecond
    const ms = Math.max(90, Math.min(420, Math.round((dist * 0.6) / speed)));

    for (const c of codes) await input.down(c);
    await wait(ms);
    for (const c of codes) await input.up(c);
  }
  return evaluate(page, STATE, 15000);
}

/* DRIVE THERE, and a tank is not a character.
   _tickTank is car-style: W is forward along the hull's own angle and A/D
   ROTATE. Pressing D to go east — which is what walking teaches — spins the
   tank on the spot and moves it nowhere.
   The hull angle is not exposed (window._dexGetTankState hands back the TURRET
   angle), so the heading is MEASURED: sample the position twice while rolling
   forward and the vector between them is the way the tank is actually
   pointing. That is also robust to what an exposed angle would not be —
   sliding, terrain, and being shoved by a creature.

   THE FIRST VERSION OF THIS STEERED ITSELF IN CIRCLES. It asked for a heading
   before the tank had moved far enough to have one — TANK_ACCEL is 0.025 and
   it takes a good second to reach a speed worth measuring — and when the
   sample came back under its 3-unit threshold it turned on `i % 2`, a coin
   flip. So the tank spent every other leg rotating on the spot, the estimate
   never settled, and one run photographed four frames a kilometre short of the
   forest while reporting success.
   Now: two full-throttle legs first to BUILD a heading, then turns that are
   proportional to the error and always taken with the throttle still down —
   a tank that stops to turn never gets anywhere. */
async function driveTo(page, input, target, { tol = 140, legs = 44 } = {}) {
  let last = null;
  let heading = null;
  for (let i = 0; i < legs; i++) {
    const s = await evaluate(page, STATE, 30000);
    if (!s.inTank) throw new Error('left the tank mid-drive');
    const dx = target.x - s.tankX, dy = target.y - s.tankY;
    const dist = Math.hypot(dx, dy);
    if (dist < tol) return s;

    if (last) {
      const mx = s.tankX - last.tankX, my = s.tankY - last.tankY;
      // 6 units in a leg is unambiguous motion; below that the direction is
      // mostly rounding and taking it as a heading is what caused the spin.
      if (Math.hypot(mx, my) > 6) heading = Math.atan2(my, mx);
    }
    last = s;

    let err = 0;
    if (heading !== null) {
      err = Math.atan2(dy, dx) - heading;
      while (err > Math.PI) err -= 2 * Math.PI;
      while (err < -Math.PI) err += 2 * Math.PI;
    }

    /* Throttle is ALWAYS down. TANK_ROT_SPEED scales with speed anyway
       (rotMult falls as the tank goes faster), so turning under power is both
       what the game expects and the only way to make progress while steering. */
    const codes = ['KeyW'];
    if (heading === null) {
      // No heading yet: a long straight leg to make one.
      await input.down('KeyW');
      await wait(900);
      await input.up('KeyW');
      continue;
    }
    if (Math.abs(err) > 0.15) codes.push(err > 0 ? 'KeyD' : 'KeyA');
    // Turn for as long as the error deserves, capped so one leg cannot spin
    // past the target and start the correction over.
    const ms = Math.abs(err) > 0.15
      ? Math.max(140, Math.min(650, Math.round(Math.abs(err) * 420)))
      : Math.max(300, Math.min(800, Math.round(dist * 1.6)));

    for (const c of codes) await input.down(c);
    await wait(ms);
    for (const c of codes) await input.up(c);
  }
  return evaluate(page, STATE, 30000);
}

/* The forest is a REGION, not a coordinate: playmode.js calls everything past
   x=4300 with y>2150 'forest' and seeds 14 tree clumps into it. A shot
   captioned "through the forest" taken at x=3800 is a shot of the meadow, and
   one run produced exactly that — four frames near the village, all reported
   ok, because nothing checked. */
const inForest = (s) => s.tankX > 4300 && s.tankY > 2150;

// ---- 1. Home base -------------------------------------------------------
if (want('base')) {
  await run('home base', async (page, input) => {
    // Stand at the house rather than in the middle of the row: the old shot
    // framed all five buildings and a figure too small to see, and what came
    // out was a diagram of a village. Close to one building with the figure
    // beside it is a place someone lives.
    /* y=2250 is the spawn row and it is CLEAR — the buildings sit at y=2130
       with collision boxes around them, and the first cut of this aimed at
       y=2220 which is inside Home's. Standing on the open row just south of
       the house frames the house and the figure together and is somewhere a
       player can actually stand. */
    await walkTo(page, input, { x: HOME.x + 40, y: 2250 });
    await zoomIn(page);
    await take(page, { shot: 'Home base', variant: 'below the house, zoomed in',
      repro: `walk to ${HOME.x + 40},2250 · wheel-in x12` });

    // The bow drawn on the doorstep: an action at the base rather than a
    // portrait of it. Slot 1 is the bow in the default loadout.
    await input.tap('Digit1');
    await frames(page, 12);
    await act(page, input, ['KeyD'], 700, {
      shot: 'Home base', variant: 'bow out, moving off',
      repro: `walk to ${HOME.x + 30},${HOME.y + 90} · 1 · D 0.7s (shot held)` });

    // Wider, from the middle of the row — kept as the one frame that still
    // shows the base IS a row of five, in case that reads better than a door.
    // The wide one, kept as the frame that still shows the base IS a row of
    // five — but half-zoomed, so it is a place rather than a map of one.
    await walkTo(page, input, { x: CASTLE.x, y: 2260 });
    await page.send('Input.dispatchMouseEvent',
      { type: 'mouseWheel', x: W / 2, y: H / 2, deltaX: 0, deltaY: 240 }, 8000);
    await frames(page, 45);
    await take(page, { shot: 'Home base', variant: 'the whole row, half-zoomed',
      repro: `walk to ${CASTLE.x},2260 · wheel-in x12, out x2` });
  });
}

// ---- 2. A tank driving through the forest -------------------------------
if (want('tank')) {
  await run('tank in the forest', async (page, input) => {
    /* MOUNTING THE TANK IS A GEOMETRY PROBLEM, and both obvious approaches
       fail. The pad carries its own collision box — hw 60, y 2120..2220 in
       playmode.js — and the prompt only appears within 75 of the tank's
       centre at (3150, 2170). Walking straight at the tank stops dead on the
       pad's edge. Coming up from the clear spawn row below stops at y=2220
       plus the character's own radius, which measured 84 away: eighty-four
       against a seventy-five metre prompt, missed by nine.
       So it tries STANDING SPOTS, each one outside the pad's rectangle and
       inside the prompt's circle, and holds E at each until one takes. East
       and west of the pad at the tank's own latitude are both about 70 out and
       both on open ground; the two below are the fallbacks. */
    /* AND EVERY SPOT HAS TO BE CLEAR OF HOME'S OWN E-PROMPT.
       The first version of this list led with the spot due EAST of the pad,
       (3222, 2170), which is 62 from the house at (3270, 2130) — inside
       HOME_INTERACT_RADIUS of 80. Holding E there for two seconds does not
       mount the tank: it triggers the house, whose hold is HOME_E_HOLD_FRAMES
       (120, about two seconds), and the house's action is exitPlayMode(). So
       the attempt dropped the run into the platformer, and every subsequent
       probe came back `null` because _dexGetPlayState only answers while play
       mode is active.
       Every spot below is inside the tank's 75 and outside the house's 80. The
       east side has no such spot at all — the house is simply too close — so
       the approach is from the west and south. */
    /* FROM THE NORTH, which is the only side that actually works.
       South is blocked: the pad's collision box ends at y=2220 and the
       character's own radius holds it at about 2212, which measured 86 from the
       tank against a 75 prompt — every southern and western spot stalled there.
       North is clear, and it is where a hand-driven probe reached the tank on
       the first attempt: standing at (3167, 2138) mounted it with a one-second
       hold. That spot is 36 from the tank and 103 from the house, so it clears
       the pad, reaches the prompt, and stays outside Home's radius — the three
       constraints that between them rule out everywhere else.
       The route goes wide to the west first, then north of the village row,
       then down onto the spot: walking the direct line crosses the pad. */
    const SPOTS = [
      { x: 3167, y: 2138 },   // the probe's spot: 36 from the tank, 103 from Home
      { x: 3150, y: 2115 },   // straight above it
      { x: 3105, y: 2135 },   // north-west shoulder
      { x: 3185, y: 2118 },   // north-east, still 91 clear of the house
    ];
    await walkTo(page, input, { x: TANK.x - 150, y: 2250 });
    await walkTo(page, input, { x: TANK.x - 150, y: 2060 });   // up, west of the pad
    await walkTo(page, input, { x: TANK.x, y: 2060 });          // across, north of it

    let mounted = null;
    for (const spot of SPOTS) {
      await walkTo(page, input, spot, { tol: 45, legs: 16, sprint: false });
      // E is HELD to mount — TANK_E_HOLD_FRAMES is 60, about a second, and the
      // same hold a player does. Two seconds leaves margin for a slow frame.
      await input.down('KeyE');
      await wait(2000);
      await input.up('KeyE');
      await frames(page, 20);
      const got = await evaluate(page, STATE, 30000);
      if (got.inTank) { mounted = { spot, got }; break; }
      /* A null position means play mode is gone, not that the spot was bad —
         something else answered the E. Carrying on would hold E four more
         times in a mode that has no tank in it. */
      if (!got.play) throw new Error('an E-hold left play mode — a building took it, not the tank');
      console.log(`      -- no mount from ${spot.x},${spot.y} (stood at ${got.x},${got.y})`);
    }
    if (!mounted) {
      const t0 = await evaluate(page, STATE, 30000);
      throw new Error(`never got into the tank — last stood at ${t0.x},${t0.y}, `
        + `${Math.round(Math.hypot(t0.x - TANK.x, t0.y - TANK.y))} from it `
        + '(the prompt needs 75)');
    }
    await zoomIn(page);
    const edge = await driveTo(page, input, { x: 4500, y: 2350 });
    if (!inForest(edge)) {
      throw new Error(`never reached the forest — tank stopped at `
        + `${edge.tankX},${edge.tankY} (needs x>4300, y>2150)`);
    }
    // Held forward across the capture: a tank at rest among trees is a parked
    // tank, and the frame is supposed to be of one driving.
    await act(page, input, ['KeyW', 'ShiftLeft'], 1200, {
      shot: 'A tank driving through the forest', rezoom: 12,
      variant: 'entering the treeline, boosting',
      repro: `walk to tank · hold E 1.6s · drive to 4450,2300 · W+Shift 1.2s (shot held)` });

    await driveTo(page, input, FOREST);
    await act(page, input, ['KeyW'], 1000, {
      shot: 'A tank driving through the forest', rezoom: 12,
      variant: 'deep in the trees',
      repro: `drive to ${FOREST.x},${FOREST.y} · W 1s (shot held)` });

    // Turning under canopy, so the hull is across the frame rather than
    // pointing away down its own axis.
    await act(page, input, ['KeyW', 'KeyD'], 900, {
      shot: 'A tank driving through the forest', rezoom: 12,
      variant: 'turning under the canopy',
      repro: `drive to ${FOREST.x},${FOREST.y} · W+D 0.9s (shot held)` });

    // ...and firing, which is the tank's own event.
    await input.click(W * 0.66, H * 0.35);
    await act(page, input, ['KeyW'], 500, {
      shot: 'A tank driving through the forest', rezoom: 12,
      variant: 'firing on the move',
      repro: `drive to ${FOREST.x},${FOREST.y} · click to fire · W 0.5s (shot held)` });
  });
}

// ---- 3. Platform mode, jetpacking ---------------------------------------
if (want('jet')) {
  await run('platform mode', async (page, input) => {
    /* /home is a real in-game chat command — the command picker offers it —
       and it is what exits play mode. The platformer then self-activates,
       because the platformer IS the mode play mode was covering up. */
    await evaluate(page, `(() => { window._dexExecuteChatCommand('home'); return true; })()`);
    /* POLLED, not counted. platformer.js only activates after ~60 frames of
       continuous notes mode — a debounce, so the boot frames before
       enterPlayMode do not flash the world — and exitPlayMode's teardown runs
       first. Ninety frames was a guess and it was short. */
    const got = await evaluate(page, `(async () => {
      const f = () => new Promise((r) => requestAnimationFrame(r));
      for (let i = 0; i < 900; i++) { await f(); if (window._dexPlatActive) return true; }
      return false;
    })()`, 30000);
    if (!got) throw new Error('never reached platform mode');
    await zoomIn(page, 6);

    /* The pack straps itself on at the door — platformer.js _enter does it,
       because the climb is designed around it. Asked for anyway rather than
       assumed: a shot captioned "jetpacking" with no pack on is a lie the
       sheet cannot see. */
    await evaluate(page, `(() => { window._dexEquipJetpack?.(); return true; })()`);
    await frames(page, 20);

    // Space is the thrust. Held across every capture — the flame only exists
    // while it is down, and the flame is the whole picture.
    await act(page, input, ['Space'], 1800, {
      shot: 'Platform mode, jetpacking', minPlatAlt: 3, prejump: true,
      variant: 'lifting off the first platform',
      repro: `/home · equip jetpack · Space 0.9s (shot held)` });

    await act(page, input, ['Space', 'KeyD'], 1800, {
      shot: 'Platform mode, jetpacking', minPlatAlt: 8, prejump: true,
      variant: 'climbing right across the gap',
      repro: `/home · Space 0.9s, Space+D 1.6s (shot held)` });

    await act(page, input, ['Space', 'KeyD', 'ShiftLeft'], 1800, {
      shot: 'Platform mode, jetpacking', minPlatAlt: 10, prejump: true,
      variant: 'high and fast, platforms below',
      repro: `/home · Space+D 1.6s, Space+D+Shift 1.8s (shot held)` });

    // Falling with the thrust off, which is the other half of the mode and
    // the frame where the platforms are legible under the character.
    /* The drop. Its premise is thrust OFF, so it cannot use prejump+hold like
       the three above — it has to climb first and then let go, and the shutter
       has to fall while the character is still in the air. Written out rather
       than pushed through act(), because act() holds one set of keys for the
       whole shot and this one deliberately changes them mid-flight. */
    await platLift(page, input);
    await input.down('Space');
    await wait(1200);
    await input.up('Space');
    await input.down('KeyD');
    await wait(420);
    await frames(page, 3);
    await take(page, { shot: 'Platform mode, jetpacking', minPlatAlt: 4,
      variant: 'thrust off, dropping to the next platform',
      repro: `/home · equip jetpack · Space hop + hold 1.2s, release, D 0.4s (shot held)` });
    await input.up('KeyD');
  });
}

// ---- 4. Four cosmetics, four weapons ------------------------------------
/* THE FOUR-UP IS COMPOSED, NOT CAPTURED, and this is the capture half.
   Four boots, four loadouts, four frames — merged into one image afterwards by
   tools/make_gallery_composite.py, the same tool that builds Chomp's progress
   strip and the same idea as assets/gallery/themedock-panel.png.
   Each panel changes BOTH axes at once. Four figures in four hats holding the
   same bow is a hat catalogue; four figures that differ in build, hat, hair and
   what they are holding is the customiser doing what it is for. */
/* FOUR, and the number is chosen against the panel rather than against the
   screen. The four-up crops 957x537 straight out of this capture at 1:1, so the
   ratio IS the framing: at 3x the figure is 108x180 real pixels and fills a
   third of its panel, at 4x it is 144x240 and fills nearly half. Half is where
   the top hat, the viking horns, the robe and the coat all read at a glance,
   which is the entire job of this shot.
   Going tighter than the capture allows would mean upscaling again, and
   upscaling three-pixel line art is what made the first version soft. Raising
   the ratio instead buys the same tightness in real pixels. */
const FOURUP_DPR = 4;

const LOADOUTS = [
  { tag: 'slim-bow',      cosmetics: { torso: 'default',  hat: 'cap_forward', hair: 'short' },
    hotbar: { 1: 'bow', 2: 'smg', 3: 'rocket', 4: 'hoverboard' }, slot: 'Digit1', weapon: 'bow' },
  { tag: 'armor-smg',     cosmetics: { torso: 'vtorso',   hat: 'viking',      hair: 'none' },
    hotbar: { 1: 'smg', 2: 'bow', 3: 'rocket', 4: 'hoverboard' }, slot: 'Digit1', weapon: 'machine gun' },
  { tag: 'robe-rocket',   cosmetics: { torso: 'robe',     hat: 'tophat',      hair: 'long' },
    hotbar: { 1: 'rocket', 2: 'bow', 3: 'smg', 4: 'hoverboard' }, slot: 'Digit1', weapon: 'rocket launcher' },
  { tag: 'coat-board',    cosmetics: { torso: 'coat',     hat: 'cap_back',    hair: 'ponytail' },
    hotbar: { 1: 'hoverboard', 2: 'bow', 3: 'smg', 4: 'rocket' }, slot: 'Digit1', weapon: 'hoverboard' },
];

if (want('cosmetics')) {
  for (const L of LOADOUTS) {
    await run(`cosmetics ${L.tag}`, async (page, input) => {
      // Out of the village row and onto open ground: the four panels are
      // cropped tight around the figure, and a castle wall behind one of them
      // and nothing behind another makes the set look like four accidents.
      await walkTo(page, input, { x: CASTLE.x + 40, y: 2450 });
      await input.tap(L.slot);
      /* Hardest zoom of the set. These four frames get cropped to a quarter of
         a 1920 master each, so whatever the figure measures here it measures
         half of that in the composite — and a stick figure at 1.0 zoom would
         come out unreadable in every panel. */
      await zoomIn(page, 12);
      // Facing the camera and moving, so the pose is the game's own jog rather
      // than the idle stance every character customiser already shows.
      await act(page, input, ['KeyD'], 600, {
        shot: 'Four-up — cosmetics and weapons',
        variant: L.tag,
        box: true,
        note: `${L.cosmetics.torso}/${L.cosmetics.hat}/${L.cosmetics.hair} · ${L.weapon}`,
        repro: `sfg-cosmetics=${JSON.stringify(L.cosmetics)} · slot1=${L.hotbar[1]} · wheel-in x12 · D 0.6s (shot held)` });
    }, { cosmetics: L.cosmetics, hotbar: L.hotbar }, FOURUP_DPR);
  }
}

if (Object.keys(boxes).length) {
  writeFileSync(join(OUT, 'fourup-boxes.json'), JSON.stringify(boxes, null, 2));
  console.log(`\nfigure boxes → ${join(OUT, 'fourup-boxes.json')}`);
}

// ---- the sheet ----------------------------------------------------------
const sheet = roll.write('Stickland — gallery candidates');
{
  const page = await chrome.newPage();
  await page.send('Page.enable');
  await page.send('Page.navigate',
    { url: `http://127.0.0.1:${port}/games/stickland/dev/shots/gallery/sheet.html` });
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
