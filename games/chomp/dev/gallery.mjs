// Gallery candidates for Chomp — played into, not posed.
//
//   node dev/gallery.mjs                 all shots
//   node dev/gallery.mjs --seed 4211     one specific cave
//
// The browser and the capture kit are shared with the other three games:
// games/_shared/dev/cdp.mjs launches Chrome and serves the repo,
// games/_shared/dev/capture.mjs drives real input and lays out the sheet.
// Nothing in here is a second copy of either.
//
// WHAT MAKES A CHOMP SHOT REAL. The game boots straight into the cave — there
// is no splash — so a frame taken at t=0 is technically gameplay and shows a
// bald blob in an empty clearing, which is what the game looked like on day
// one and not what it looks like now. Everything interesting is EARNED: the
// mawling has to eat to grow, growing changes its silhouette, its light radius
// and the biome it can survive in, and the enemies only become a threat once
// you are big enough to be worth chasing. So every shot below is taken after
// real play, and the growth stage is recorded next to it.
//
// Chomp seeds its RNG from ?seed=, so a frame worth keeping can be recaptured:
// the seed decides the cave, and the input stream below decides the rest.

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { launch, serve, evaluate, wait } from '../../_shared/dev/cdp.mjs';
import { createInput, createRoll, settle, frames } from '../../_shared/dev/capture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../..');
const GAME = '/games/chomp/';
const OUT = join(HERE, 'shots', 'gallery');

const W = 1920, H = 1080;

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

/* FIXED SEEDS, and that is the whole reproducibility story.
   ?seed= is read straight into rngFor, so the cave, the food scatter and the
   spawn table are all decided by this number. Three of them rather than one
   because a cave is a roll of the dice: one seed can put you in a corridor
   with nothing in it, and the point of a contact sheet is a choice. */
const SEEDS = (flag('seed', '') ? [flag('seed', '')] : ['70177', '31408']);

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

/* Chomp has no title screen, so "ready" is not a click — it is the first frame
   on which the world has actually been built. The chunk manager streams cells
   around the player and the visual factory builds meshes lazily, so the honest
   signal is the picture holding still, which is what capture.mjs's settle()
   watches for. This only waits for the systems to exist. */
const BOOT = `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const t0 = performance.now();
  while (performance.now() - t0 < 30000) {
    await frame();
    if (document.querySelector('#hud')?.children.length > 1) break;
  }
  for (let i = 0; i < 40; i++) await frame();
  return { ok: true, hidden: document.hidden };
})()`;

/* WHAT THE HARNESS CAN SEE, and it is exactly what a player can see.
   main.js keeps its state in module scope and exposes only window.Chomp
   (pause/resume), so there is no sim to interrogate — and adding a debug global
   would mean editing a file another session may be holding. What there IS, is a
   scene graph: Babylon keeps live engines on the global, the mawling's visual
   root is `proc_player_s<stage>` and every mounted food is `proc_food_<key>`.
   Those are the same glowing motes on the screen, so reading them is reading
   the picture, not cheating past it — and food only mounts within
   CONFIG.eat.activeRadius of the player, so this cannot see further than a
   player can either. Everything it learns is then acted on through real key
   presses, which is the half that matters.
   Guarded throughout: if any of these names change, `me` comes back null and
   the forage below sweeps blind, which is worse but not broken. */
const LOOK = `(() => {
  try {
    const s = BABYLON.Engine.Instances[0].scenes[0];
    const nodes = s.transformNodes;
    const me = nodes.find((n) => n.name.startsWith('proc_player_s') && n.isEnabled());
    if (!me) return { me: null };
    const p = me.absolutePosition;
    const food = [];
    for (const n of nodes) {
      if (!n.name.startsWith('proc_food_') || !n.isEnabled()) continue;
      const q = n.absolutePosition;
      food.push({ x: +q.x.toFixed(2), z: +q.z.toFixed(2),
                  d: +Math.hypot(q.x - p.x, q.z - p.z).toFixed(2),
                  key: n.name.slice(10) });
    }
    food.sort((a, b) => a.d - b.d);
    return { me: { x: +p.x.toFixed(2), z: +p.z.toFixed(2), stage: +me.name.slice(13) },
             food: food.slice(0, 6), foods: food.length };
  } catch (err) { return { me: null, err: String(err) }; }
})()`;

/* WHAT THE FRAME IS ACTUALLY SHOWING, read off the DOM rather than the sim.
   main.js keeps its state in module scope and exposes only window.Chomp, whose
   surface is pause/resume — there is no debug global to interrogate. The HUD is
   the honest reading anyway: it is what a player sees, so a shot whose caption
   says "stage 3, 41 gobbled" is describing the same thing the picture does. */
const STATE = `(() => {
  const hud = document.getElementById('hud');
  /* The growth bar's own label ("WISP 8 / 20") and the gobble counter, read as
     text. Selectors are loose on purpose: hud.js builds these divs with classes
     it owns and this harness has no business pinning them. */
  const all = [...(hud?.querySelectorAll('div, span') || [])]
    /* SKIP THE PAUSE MENU. It is built inside #hud and it is four hundred
       characters of settings text, so an unfiltered sweep matches its
       "2.00x / 1.0 in / 2.0 out" line as the growth bar and its volume
       percentages as the gobble count. Leaf nodes only, and nothing under
       #paused or #dead. */
    .filter((e) => !e.closest('#paused') && !e.closest('#dead') && e.children.length === 0)
    .map((e) => e.textContent.trim());
  const growth = all.find((t) => /\\d+\\s*\\/\\s*\\d+/.test(t)) || '';
  const gobble = all.find((t) => /^\\d+$/.test(t)) || '0';
  return {
    growth, gobble,
    paused: !document.getElementById('paused')?.classList.contains('hidden'),
    dead: !document.getElementById('dead')?.classList.contains('hidden'),
  };
})()`;

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
  /* CHOMP PAUSES ITSELF THE MOMENT THE PAGE STOPS BEING VISIBLE, and a headless
     tab that is not the front-most target is exactly that. main.js pauses on
     both `blur` and `visibilitychange`, which is correct behaviour and would
     otherwise photograph a paused overlay across a frozen cave. Telling Chrome
     the page is active is the honest fix — the alternative is reaching into
     the game to defeat its own pause, which would be photographing a state the
     game does not have. Best-effort: an older Chrome must not stop the run. */
  try { await page.send('Page.setWebLifecycleState', { state: 'active' }); } catch { /* older Chrome */ }

  await page.send('Page.navigate', { url: `http://127.0.0.1:${port}${GAME}?seed=${seed}` });
  let info;
  try { info = await evaluate(page, BOOT, 90000); } catch (err) { info = { ok: false, err: err.message }; }

  if (!info.ok) {
    problems++;
    console.log(`FAIL  seed ${seed} — never became ready${info.err ? ' — ' + info.err : ''}`);
  } else {
    const input = createInput(page);
    /* One real click into the canvas first. It is a mouse chomp, which is
       harmless, and it is what gives the page the user gesture the AudioContext
       is waiting on — a game running without its audio graph is not quite the
       game, and the first gesture is part of a real session. */
    await input.click(W / 2, H / 2);
    await frames(page, 20);
    try { await plan(page, input, seed); }
    catch (err) { problems++; console.log(`FAIL  seed ${seed} — ${err.message}`); }
  }
  for (const e of errs) { problems++; console.log(`      ! ${e}`); }

  await chrome.browser.send('Target.closeTarget', { targetId: page.targetId });
  await page.close();
  await wait(200);
}

async function take(page, opts) {
  const s = await evaluate(page, STATE, 30000);
  if (s.paused) throw new Error('paused at capture — the page lost visibility');
  if (s.dead) throw new Error('dead at capture — the run needs to be shorter');
  const file = await roll.take(page, {
    ...opts,
    note: `${s.growth || '?'}${s.gobble ? ` · ${s.gobble} gobbled` : ''}${opts.note ? ' · ' + opts.note : ''}`,
  });
  console.log(`  ok  ${opts.shot} / ${opts.variant}  (${s.growth || '?'}, ${s.gobble || '0'} gobbled)`);
  return file;
}

/* Play, rather than wait — and it took three cuts and a step-by-step trace to
   get this honest. The trace is worth writing down, because every wrong cut
   looked like it was working.

   Cut one held W with an alternating turn. That is not covering ground, it is
   shoving: a cave is mostly rock, so most legs were spent pressed into a wall.
   Sixty seconds, three gobbles.
   Cut two added stall detection on top, which made the shoving more varied and
   turned away from the motes as readily as from the rock. Nought gobbles.
   Cut three steered at the nearest lit mote — the motes are emissive and the
   cave is dark, so they are the only thing on screen worth walking toward, and
   walking toward them IS the early game. Better, and still nought, and the
   trace finally said why:

     me 4.3,1.5 -> 4.7,1.5  moved 0.4  target d=2.1 -> 1.8
     me 4.7,1.5 -> 4.8,1.5  moved 0.1  target d=1.8 -> 1.7
     me 4.8,1.5 -> 4.8,1.5  moved 0.0  target d=1.7 -> 1.7
     ...twenty more legs, all 0.0, all d=1.6

   The mawling walks to within a body length of a mote and stops dead, because
   the mote is inside the rock and the wall is between them. And there it can
   never eat, for a reason that is the actual lesson here: combat.js will only
   let you eat when `player.speed > eat.minEatSpeed || chomping`. Wedged, speed
   is zero. And `chomping` is not "Space is down" — it is `player.chomp.active`,
   the LUNGE, which is edge-triggered and on a 0.9s cooldown. Holding Space
   arms `chompHeld` once and then does nothing at all. So a harness that holds
   the chomp key while walking into a wall has disabled both halves of the eat
   condition simultaneously, and will forage until the heat death of the cave.

   Three things follow, and all three are what a person does:
     · TAP the chomp instead of holding it, roughly on its cooldown, so the
       lunge actually fires — and the lunge is also a burst of speed, which
       re-satisfies the other half of the condition.
     · GIVE UP ON A MOTE you have stopped closing on, and remember it. One
       unreachable mote inside a wall will otherwise hold the seek forever,
       because it stays the nearest one for as long as you stand next to it.
     · BACK OFF when wedged rather than turning a little, which just scrapes
       along the same wall. */
const DIRS = [
  { k: ['KeyW'],           x: 0,  z: 1 },
  { k: ['KeyW', 'KeyD'],   x: 1,  z: 1 },
  { k: ['KeyD'],           x: 1,  z: 0 },
  { k: ['KeyS', 'KeyD'],   x: 1,  z: -1 },
  { k: ['KeyS'],           x: 0,  z: -1 },
  { k: ['KeyS', 'KeyA'],   x: -1, z: -1 },
  { k: ['KeyA'],           x: -1, z: 0 },
  { k: ['KeyW', 'KeyA'],   x: -1, z: 1 },
];

/** The eight-way heading closest to (dx, dz). */
function headingFor(dx, dz) {
  let best = DIRS[0], bestDot = -Infinity;
  const len = Math.hypot(dx, dz) || 1;
  for (const d of DIRS) {
    const dl = Math.hypot(d.x, d.z);
    const dot = (dx / len) * (d.x / dl) + (dz / len) * (d.z / dl);
    if (dot > bestDot) { bestDot = dot; best = d; }
  }
  return best;
}

// A mote is "the same mote" if it is within half a metre of a remembered one.
// Positions rather than ids because the factory pools its nodes and a name is
// reused by the next mote to mount.
const near = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) < 0.5;

async function forage(page, input, { seconds, until: target = Infinity, sprint = false }) {
  const deadline = Date.now() + seconds * 1000;
  let explore = 0, lastPos = null, stuck = 0;
  let peak = 0, deaths = 0, lastSay = 0, look0 = null;
  const giveUp = [];              // motes proved unreachable this life
  let held = null;                // the mote currently being approached
  let heldFor = 0, heldBest = Infinity;

  while (Date.now() < deadline) {
    const st = await evaluate(page, STATE, 30000);
    const n = Number(st.gobble) || 0;
    if (n < peak) {
      deaths++;
      giveUp.length = 0;          // new cave, new geometry — forget the blacklist
      console.log(`      -- eaten at ${peak} gobbled; a held key reloaded the cave`);
    }
    peak = n;
    if (n >= target) return { ...st, gobbled: n, deaths };
    if (Date.now() - lastSay > 6000) {
      lastSay = Date.now();
      console.log(`      .. ${n}/${target} gobbled, ${look0 ? look0.foods : '?'} motes lit`
        + (giveUp.length ? `, ${giveUp.length} walled off` : ''));
    }

    const look = await evaluate(page, LOOK, 30000);
    look0 = look;
    if (!look.me) { await wait(400); continue; }

    // The nearest mote that has not already proved unreachable.
    const t = (look.food || []).find((f) => !giveUp.some((g) => near(g, f))) || null;

    let dir, ms;
    if (t) {
      if (!held || !near(held, t)) { held = t; heldFor = 0; heldBest = t.d; }
      /* Closing counts as progress; standing at the same distance does not.
         Six legs without getting meaningfully nearer means the wall is between
         you and it, whatever the straight-line distance says. */
      if (t.d < heldBest - 0.25) { heldBest = t.d; heldFor = 0; } else heldFor++;
      if (heldFor >= 6) {
        giveUp.push({ x: t.x, z: t.z });
        held = null;
        continue;
      }
      dir = headingFor(t.x - look.me.x, t.z - look.me.z);
      ms = t.d < 3 ? 200 : Math.min(900, 140 + t.d * 90);
    } else {
      // Nothing reachable lit nearby. Strike out; food only mounts inside
      // CONFIG.eat.activeRadius, so an empty look means leave, not circle.
      held = null;
      dir = DIRS[explore % 8];
      explore += 3;
      ms = 1100;
    }

    const codes = [...dir.k, ...(sprint && (!t || t.d > 4) ? ['ShiftLeft'] : [])];
    for (const c of codes) await input.down(c);
    /* THE CHOMP IS TAPPED, not held — see the note above. Roughly on the
       lunge's own 0.9s cooldown, and always at least once per leg, so an
       approach that ends beside a mote ends with a bite rather than a nudge. */
    const bites = Math.max(1, Math.round(ms / 450));
    for (let b = 0; b < bites; b++) {
      await input.tap('Space', 70);
      await wait(Math.max(0, ms / bites - 70));
    }
    for (const c of codes) await input.up(c);

    // Wedged: back out the way we came rather than scraping along the wall.
    if (lastPos && Math.hypot(look.me.x - lastPos.x, look.me.z - lastPos.z) < 0.4) {
      if (++stuck >= 2) {
        const back = DIRS[(DIRS.indexOf(dir) + 4) % 8];
        for (const c of back.k) await input.down(c);
        await wait(700);
        for (const c of back.k) await input.up(c);
        stuck = 0;
        if (t) { giveUp.push({ x: t.x, z: t.z }); held = null; }
      }
    } else stuck = 0;
    lastPos = look.me;
  }
  const st = await evaluate(page, STATE, 30000);
  return { ...st, gobbled: Number(st.gobble) || 0, deaths };
}

/** Hold the keys across the capture, so the frame is mid-action. */
async function act(page, input, codes, ms, opts) {
  const list = [].concat(codes);
  /* If the shot wants the mouth open, the lunge has to be FIRED, not just
     armed: Space held is one edge and then nothing. Tapped here, then held
     through the capture so `chompHeld` keeps the mouth posed open. */
  if (list.includes('Space')) { await input.tap('Space', 70); await wait(60); }
  for (const c of list) await input.down(c);
  await wait(ms);
  await frames(page, 5);
  const file = await take(page, opts);
  for (const c of list) await input.up(c);
  return file;
}

/* THE SHOTS ARE MILESTONES, NOT STOPWATCH READINGS.
   "Forage for thirty seconds" is a bet on how good the cave was; "forage until
   ten gobbled" is the state the caption is actually claiming. It also makes the
   sheet honest across seeds — the third frame of every seed is the same moment
   in the game's own terms, not the same number of seconds after boot. */
for (const seed of SEEDS) {
  await run(seed, async (page, input) => {
    // ── close and readable: the creature, mid-chomp, early ──────────────
    let st = await forage(page, input, { seconds: 45, until: 4 });
    await act(page, input, ['KeyW', 'Space'], 800, {
      shot: 'Real play — early, still small',
      variant: `seed ${seed}`,
      repro: `?seed=${seed} · forage to 4 gobbled · W+Space 0.8s (shot held)` });

    // ── mid-action: sprinting, grown enough to have a silhouette ────────
    st = await forage(page, input, { seconds: 70, until: 10, sprint: true });
    await act(page, input, ['KeyW', 'ShiftLeft', 'Space'], 1000, {
      shot: 'Real play — grown, sprinting',
      variant: `seed ${seed}`,
      repro: `?seed=${seed} · forage to 10 gobbled · W+Shift+Space 1s (shot held)` });

    // ── wide and atmospheric: big enough that the light radius reaches the
    //    biome rather than stopping at a pool of dark around the mawling ──
    st = await forage(page, input, { seconds: 90, until: 20, sprint: true });
    await act(page, input, ['KeyW'], 600, {
      shot: 'Real play — big enough to light the cave',
      variant: `seed ${seed} · ${st.gobbled} gobbled`,
      repro: `?seed=${seed} · forage to 20 gobbled · W 0.6s (shot held)` });

    // ── something about to go wrong: turned around, chomp open, backing
    //    off. Taken straight after the wide one, so it is the same life. ──
    await act(page, input, ['KeyS', 'Space'], 1200, {
      shot: 'Real play — backing off, chomp open',
      variant: `seed ${seed} · ${st.gobbled} gobbled`,
      repro: `?seed=${seed} · forage to 20 gobbled · S+Space 1.2s (shot held)` });
  });
}

// ---- the sheet ----------------------------------------------------------
const sheet = roll.write('Chomp — gallery candidates');
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
