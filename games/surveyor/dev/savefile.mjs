// A save file, for harnesses that want to test a RETURNING player.
//
//   import { buildSave, seedSave, saveFromArgv } from './savefile.mjs';
//   const save = saveFromArgv(process.argv);     // honours --save / --save=N
//   ...
//   if (save) await seedSave(page, save);        // BEFORE Page.navigate
//
// WHY THIS IS A SHARED MODULE AND NOT A FLAG IN ONE FILE.
//
// Every harness in dev/ launches Chrome on a throwaway --user-data-dir. That is
// correct for determinism and it has a consequence nobody costed: localStorage
// is always empty, so `economy.load()` always returns null, so every code path
// that exists only for someone coming back to the game has never once been
// exercised by a test. No save, no restore loop, no colonies on a world you are
// not standing on, no claimed vents, no away-window catch-up. That is a whole
// class of bug this repo is structurally unable to see, and it hid a real one:
// every saved world's sky dome drawing at once on a cold load, because
// Worlds.get() builds a World and only Worlds.enter() ever hid one.
//
// So seeding a save is a standing option rather than something one harness did
// once. A blob from here is the same shape economy.save() writes and
// Colonies.record() produces — including real geyser ids, so vents come back
// CLAIMED, which is the state a returning player actually has.
//
// `v: 1` is load()'s gate. A blob without it is dropped in silence and the
// reproduction then looks exactly like the clean case, which cost a run.

import { PLANETS, ECONOMY, COLONY } from '../js/tune.js';
import { makePlanet } from '../js/world/sphere.js';
import { geysersOf } from '../js/world/geysers.js';

/**
 * Build a save.
 *
 * @param sites    colonies per world. 0 gives worlds with no sites, which is
 *                 still enough to make the restore loop construct them.
 * @param worlds   which worlds are in the save. Default: all of them.
 * @param ageSec   how grown each colony is, in seconds of its own clock.
 * @param hp       integrity as a fraction, the way Colonies.record stores it.
 * @param awaySec  how long ago the tab was shut. Drives the away-window replay
 *                 in main.js, and is CAPPED by ECONOMY.offlineCap on the way in.
 * @param now      wall clock, injected so a caller can make a run reproducible.
 */
export function buildSave({
  sites = 2,
  worlds = Object.keys(PLANETS),
  ageSec = COLONY.maxDomes * COLONY.domeEvery,
  hp = 1,
  awaySec = 0,
  hyper = 40,
  now = Date.now(),
} = {}) {
  const out = {};
  for (const key of worlds) {
    if (!PLANETS[key]) continue;
    const planet = makePlanet(PLANETS[key]);
    /* Sites are planted ON REAL VENTS, in the order geysersOf returns them, so
       the geyser id in the record resolves to a geyser that exists. A made-up
       id restores as an unclaimed site, which is a different thing to test and
       not the one anybody means by "a returning player". */
    const vents = geysersOf(planet);
    const recs = [];
    for (let i = 0; i < sites; i++) {
      const g = vents[i % Math.max(1, vents.length)];
      if (!g) break;
      recs.push({
        id: i,
        dir: [g.dir.x, g.dir.y, g.dir.z],
        age: ageSec,
        geyser: g.id,
        hp,
      });
    }
    out[key] = { clock: ageSec, sites: recs };
  }
  return {
    v: 1,
    hyper,
    at: now - awaySec * 1000,
    worlds: out,
  };
}

/**
 * Put a save in the page's localStorage BEFORE any game script runs.
 *
 * Must be called before Page.navigate: the restore loop runs during module
 * evaluation of main.js, so a save written after the page loads is a save the
 * game has already decided it does not have.
 */
export async function seedSave(page, save) {
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem(${JSON.stringify(ECONOMY.saveKey)}, ` +
      `${JSON.stringify(JSON.stringify(save))}); } catch (e) {}`,
  });
}

/** Clear it again, for a harness that wants both cases in one browser. */
export async function clearSave(page) {
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.removeItem(${JSON.stringify(ECONOMY.saveKey)}); } catch (e) {}`,
  });
}

/**
 * The standing command-line convention, so every harness spells it the same:
 *
 *   --save        a returning player: every world, two colonies each
 *   --save=4      ...with four colonies each
 *   --save=0      every world in the save, no colonies — enough to build them
 *   --away=3600   and shut the tab an hour ago
 *
 * Returns null when no --save was passed, which is the existing behaviour of
 * every harness and stays the default.
 */
export function saveFromArgv(argv, extra = {}) {
  const arg = argv.find((a) => a === '--save' || a.startsWith('--save='));
  if (!arg) return null;
  const n = arg.includes('=') ? Number(arg.split('=')[1]) : 2;
  const awayArg = argv.find((a) => a.startsWith('--away='));
  return buildSave({
    sites: Number.isFinite(n) ? n : 2,
    awaySec: awayArg ? Number(awayArg.split('=')[1]) || 0 : 0,
    ...extra,
  });
}

/** One line for a harness to print, so a run says which case it measured. */
export function describeSave(save) {
  if (!save) return 'no save (a first-time player)';
  const worlds = Object.keys(save.worlds);
  const sites = worlds.reduce((a, k) => a + save.worlds[k].sites.length, 0);
  const away = Math.round((Date.now() - save.at) / 1000);
  return `save: ${worlds.length} worlds, ${sites} colonies, tab shut ${away}s ago`;
}
