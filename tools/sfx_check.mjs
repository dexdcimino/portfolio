/* Drive the SOUND LIBRARY overlay in a real browser.
 *
 *   node tools/sfx_check.mjs
 *
 * Serves the repo itself and needs nothing running.
 *
 * WHY THIS EXISTS. Every part of this overlay comes into being once the
 * browser has run the script: the cards are built from a fetched manifest, the
 * grid has to collapse to one column on its own, and there is exactly ONE
 * transport that is MOVED between cards. None of it can be read off the source
 * and the repo's other gates all pass over an overlay that never opens.
 *
 * THE FIXTURE IS A SYNTHESISED WAV, and that is not a contradiction of "no
 * synthesised sounds ship". Nothing here is shipped: the manifest's own tracks
 * have no files yet, and a player that has never played anything is a player
 * nothing has been proved about. The harness writes one tone into
 * assets/sfx/ under a name the manifest does not use, adds a line for it,
 * drives it, and puts both back. That is the only way to assert a real
 * <audio> actually plays, seeks, loops and stops.
 *
 * COUNT THE SUBJECT: the categories, items and cards built are read back from
 * the page and asserted against the manifest on disk, because a render that
 * silently produced nothing would pass every "is it hidden" assertion.
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SFX = join(ROOT, 'assets', 'sfx');
const MANIFEST_TXT = join(SFX, 'sfx.txt');
const MANIFEST_JSON = join(SFX, 'sfx.json');
const FIXTURE = 'harness-tone.wav';

const CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => p && existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found — set CHROME=<path to the exe>');

const fail = [];
let pass = 0;
const note = (ok, why) => { if (ok) pass++; else fail.push(why); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ---- the fixture ---------------------------------------------------------
   Two seconds of a quiet 440Hz tone as a 16-bit PCM WAV. Long enough that a
   seek to the middle lands somewhere a `currentTime` can be read back from,
   and quiet enough that a run with speakers on is not an event. */
function tone(seconds = 2, hz = 440, rate = 22050) {
  const frames = Math.round(rate * seconds);
  const view = new DataView(new ArrayBuffer(44 + frames * 2));
  const tag = (at, s) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); tag(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, 'data'); view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) {
    view.setInt16(44 + i * 2, Math.round(Math.sin((i / rate) * hz * 2 * Math.PI) * 3000), true);
  }
  return Buffer.from(view.buffer);
}

const txtBefore = readFileSync(MANIFEST_TXT, 'utf8');
const jsonBefore = readFileSync(MANIFEST_JSON, 'utf8');
const restore = () => {
  writeFileSync(MANIFEST_TXT, txtBefore);
  writeFileSync(MANIFEST_JSON, jsonBefore);
  try { unlinkSync(join(SFX, FIXTURE)); } catch { /* already gone */ }
};

writeFileSync(join(SFX, FIXTURE), tone());
/* Appended to the LIVE manifest and baked by the real baker, so what the page
   fetches is what the pipeline produces -- not a hand-written JSON the bake
   would disagree with. */
writeFileSync(MANIFEST_TXT, txtBefore.trimEnd()
  + `\n\n# --- added by tools/sfx_check.mjs, removed again at the end ---\n`
  + `Harness|Test tone|Two seconds|${FIXTURE}\n`
  + `Harness|Test tone|Also two seconds|${FIXTURE}\n`);

const { spawnSync } = await import('node:child_process');
const baked = spawnSync(process.platform === 'win32' ? 'python' : 'python3',
  [join(ROOT, 'tools', 'bake_sfx.py')], { cwd: ROOT, encoding: 'utf8' });
if (baked.status !== 0) {
  restore();
  console.error('sfx_check: the baker refused the fixture line\n' + (baked.stdout || '') + (baked.stderr || ''));
  process.exit(1);
}

/* ---- the server ---------------------------------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
};
const server = createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = resolve(join(ROOT, normalize(url === '/' ? '/index.html' : url)));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
    /* RANGE REQUESTS, because the seek check needs them. A server that answers
       200 with the whole body to every request gives Chrome a resource with no
       seekable range, and `audio.currentTime = x` is then silently refused --
       which reads exactly like a broken scrub bar. Vercel serves ranges; a
       harness that does not is testing a different server. */
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Number(range[2]) : body.length - 1;
      res.writeHead(206, {
        'content-type': type,
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${body.length}`,
        'content-length': end - start + 1,
      });
      res.end(body.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes' });
    res.end(body);
  } catch { res.writeHead(404).end('404'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  // A scripted click is not a user gesture, and this player is driven entirely
  // by scripted clicks: without this every play() would be refused and the
  // whole file would be asserting nothing.
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  defaultViewport: { width: 1500, height: 1000 },
});
const page = await browser.newPage();
await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
const missing = [];
page.on('requestfailed', r => missing.push(r.url()));
page.on('response', r => { if (r.status() === 404) missing.push(r.url()); });
page.on('pageerror', e => fail.push(`pageerror: ${e.message}`));

try {
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(600);

  /* ---- 1. the code opens it, and the list is built ---------------------- */
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('sfx:open', { detail: {} })));
  await page.waitForFunction(() => document.getElementById('sfxModal')?.open === true, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll('.sfx-card').length > 0, { timeout: 15000 });

  const onDisk = JSON.parse(readFileSync(MANIFEST_JSON, 'utf8'));
  const built = await page.evaluate(() => ({
    cats: document.querySelectorAll('.sfx-cat').length,
    cards: document.querySelectorAll('.sfx-card').length,
    rail: document.querySelectorAll('.sfx-rail button').length,
    picks: document.querySelectorAll('.sfx-card .sfx-pick').length,
    options: [...document.querySelectorAll('.sfx-card .sfx-pick')]
      .reduce((n, s) => n + s.options.length, 0),
    counts: [...document.querySelectorAll('.sfx-card-n')].map(e => Number(e.textContent)),
    empty: document.querySelectorAll('.sfx-card.is-empty').length,
    transports: document.querySelectorAll('.sfx-transport').length,
    countLine: document.getElementById('sfxCount').textContent,
  }));
  note(built.cats === onDisk.categories.length,
       `${built.cats} categories on screen, ${onDisk.categories.length} in the manifest`);
  note(built.cards === onDisk.items, `${built.cards} cards on screen, ${onDisk.items} items in the manifest`);
  note(built.rail === onDisk.categories.length, `${built.rail} rail rows for ${onDisk.categories.length} categories`);
  note(built.picks === built.cards, 'not every card has a dropdown');
  note(built.options === onDisk.count,
       `${built.options} options across every dropdown, ${onDisk.count} tracks in the manifest`);
  /* The number beside the dropdown is the number of takes, and it is the one
     thing on the card nobody would notice being wrong. */
  const wantCounts = onDisk.categories.flatMap(c => c.items.map(i => i.tracks.length));
  note(JSON.stringify(built.counts) === JSON.stringify(wantCounts),
       'a card\'s take count does not match its dropdown');
  /* ONE transport for the library, not one per card. */
  note(built.transports <= 1, `${built.transports} transports in the DOM, expected at most one`);
  console.log(`library: ${built.cats} categories, ${built.cards} cards, ${built.options} takes, `
              + `${built.empty} still to source — "${built.countLine}"`);

  /* ---- 2. a card with no file says so and cannot be played -------------- */
  const unsourced = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.sfx-card.is-empty')][0];
    if (!c) return null;
    return {
      disabled: c.querySelector('.sfx-play').disabled,
      says: /no file yet/i.test(c.querySelector('.sfx-pick').options[0].textContent),
      label: (c.querySelector('.sfx-wait') || {}).textContent || '',
    };
  });
  note(!!unsourced, 'no unsourced card to check — the manifest has a file for everything?');
  note(unsourced && unsourced.disabled, 'a card with no file behind it still offers a play button');
  note(unsourced && unsourced.says, 'the dropdown does not say which takes have no file yet');
  note(unsourced && /SOURCE/i.test(unsourced.label), `an unsourced card is not labelled (${unsourced && unsourced.label})`);

  /* ---- 3. the fixture PLAYS, for real ----------------------------------- */
  const fixtureCard = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.sfx-card')].find(x => x.dataset.cat === 'Harness');
    if (!c) return null;
    c.scrollIntoView({ block: 'center' });
    c.querySelector('.sfx-play').click();
    return { cat: c.dataset.cat, item: c.dataset.item };
  });
  note(!!fixtureCard, 'the harness fixture card was not built');
  await page.waitForFunction(() => {
    const a = document.getElementById('sfxAudio');
    return a && !a.paused && a.currentTime > 0;
  }, { timeout: 8000 })
    .then(() => note(true, ''))
    .catch(() => note(false, 'pressing play did not start the audio'));

  const live = await page.evaluate(() => {
    const a = document.getElementById('sfxAudio');
    const card = document.querySelector('.sfx-card.is-playing');
    const tr = document.querySelector('.sfx-transport');
    return {
      playing: !a.paused,
      src: (a.currentSrc || '').split('/').pop(),
      dur: Math.round(a.duration * 10) / 10,
      cards: document.querySelectorAll('.sfx-card.is-playing').length,
      /* THE TRANSPORT IS IN THE CARD, which is the whole design -- one
         element, moved. Asserting it exists somewhere would pass with it
         parked at the end of the document. */
      inCard: !!card && !!tr && card.contains(tr),
      transports: document.querySelectorAll('.sfx-transport').length,
      icon: card && card.querySelector('.sfx-play .icon').dataset.icon,
    };
  });
  note(live.playing, 'the audio is not playing');
  note(live.src === 'harness-tone.wav', `playing "${live.src}", expected the fixture`);
  note(live.dur > 1.5 && live.dur < 2.5, `the fixture reports ${live.dur}s, expected about 2`);
  note(live.cards === 1, `${live.cards} cards are marked as playing, expected exactly 1`);
  note(live.inCard, 'the transport is not inside the card that is playing');
  note(live.transports === 1, `${live.transports} transports exist while one card is playing`);
  note(live.icon === 'pause', `the playing card's button shows "${live.icon}"`);

  /* ---- 4. seek, repeat, volume and stop --------------------------------- */
  const seeked = await page.evaluate(async () => {
    const a = document.getElementById('sfxAudio');
    const s = document.querySelector('.sfx-scrub');
    s.value = '500';
    s.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    return { at: a.currentTime, dur: a.duration };
  });
  note(seeked.at > seeked.dur * 0.3, `seeking to the middle landed at ${seeked.at.toFixed(2)}s of ${seeked.dur}s`);

  const looped = await page.evaluate(() => {
    const b = document.querySelector('.sfx-transport [data-el="loop"]');
    b.click();
    return { loop: document.getElementById('sfxAudio').loop, pressed: b.getAttribute('aria-pressed') };
  });
  note(looped.loop === true && looped.pressed === 'true', 'the repeat toggle did not reach the audio element');
  await page.evaluate(() => document.querySelector('.sfx-transport [data-el="loop"]').click());

  const vol = await page.evaluate(() => {
    const v = document.querySelector('.sfx-vol');
    v.value = '30';
    v.dispatchEvent(new Event('input', { bubbles: true }));
    let stored = null;
    try { stored = localStorage.getItem('sfx-volume'); } catch { /* private mode */ }
    return { audio: Math.round(document.getElementById('sfxAudio').volume * 100), stored };
  });
  note(vol.audio === 30, `the volume slider set the element to ${vol.audio}, expected 30`);
  note(vol.stored !== null, 'the volume was not remembered');

  await page.evaluate(() => document.querySelector('.sfx-transport [data-el="stop"]').click());
  await sleep(250);
  const stopped = await page.evaluate(() => ({
    paused: document.getElementById('sfxAudio').paused,
    src: document.getElementById('sfxAudio').getAttribute('src'),
    playing: document.querySelectorAll('.sfx-card.is-playing').length,
    transportInList: !!document.querySelector('.sfx-list .sfx-transport'),
  }));
  note(stopped.paused, 'stop did not pause the audio');
  note(stopped.src === null, 'stop left the element holding a src');
  note(stopped.playing === 0, 'a card is still marked as playing after stop');
  note(!stopped.transportInList, 'the transport was left in a card after stop');

  /* ---- 5. one at a time -------------------------------------------------- */
  const swapped = await page.evaluate(async () => {
    const cards = [...document.querySelectorAll('.sfx-card')].filter(c => c.dataset.cat === 'Harness');
    cards[0].querySelector('.sfx-play').click();
    await new Promise(r => setTimeout(r, 400));
    const first = document.querySelector('.sfx-card.is-playing')?.dataset.item;
    // The same card, second take: switching the dropdown plays the new one.
    const pick = cards[0].querySelector('.sfx-pick');
    pick.value = '1';
    pick.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    return {
      first,
      playingNow: document.querySelectorAll('.sfx-card.is-playing').length,
      transports: document.querySelectorAll('.sfx-transport').length,
      take: pick.options[pick.selectedIndex].textContent,
    };
  });
  note(swapped.playingNow === 1, `${swapped.playingNow} cards playing after switching take, expected 1`);
  note(swapped.transports === 1, `${swapped.transports} transports after switching take`);
  console.log(`transport: one element, moved; take "${swapped.take}" after a dropdown change`);
  await page.evaluate(() => document.querySelector('.sfx-transport [data-el="stop"]')?.click());

  /* ---- 6. folding a category, and it is remembered ---------------------- */
  const folded = await page.evaluate(() => {
    const sec = document.querySelector('.sfx-cat');
    const head = sec.querySelector('.sfx-cat-head');
    const before = sec.querySelector('.sfx-grid').getBoundingClientRect().height;
    head.click();
    const after = sec.querySelector('.sfx-grid').getBoundingClientRect().height;
    let stored = null;
    try { stored = localStorage.getItem('sfx-shut'); } catch { /* private mode */ }
    return { name: sec.dataset.cat, before: Math.round(before), after: Math.round(after),
             expanded: head.getAttribute('aria-expanded'), stored };
  });
  note(folded.before > 40, `the first category was already folded (${folded.before}px)`);
  note(folded.after === 0, `folding left the grid ${folded.after}px tall`);
  note(folded.expanded === 'false', 'the head does not say it is folded');
  note(!!folded.stored && folded.stored.includes(folded.name), `the fold was not remembered (${folded.stored})`);
  await page.evaluate(() => document.querySelector('.sfx-cat-head').click());

  /* ---- 7. three across, and one when it is narrow ----------------------- */
  const cols = async (w) => {
    await page.setViewport({ width: w, height: 1000 });
    await sleep(400);
    return page.evaluate(() => {
      const grid = document.querySelector('.sfx-cat:not(.is-shut) .sfx-grid');
      const cards = [...grid.querySelectorAll(':scope > .sfx-card')];
      if (cards.length < 2) return 0;
      const top = Math.round(cards[0].getBoundingClientRect().top);
      return cards.filter(c => Math.round(c.getBoundingClientRect().top) === top).length;
    });
  };
  const wide = await cols(1500);
  const mid = await cols(1050);
  const narrow = await cols(760);
  note(wide === 3, `at 1500px the grid is ${wide} across, expected 3`);
  note(mid === 2, `at 1050px the grid is ${mid} across, expected 2`);
  note(narrow === 1, `at 760px the grid is ${narrow} across, expected 1`);
  console.log(`grid: ${wide} / ${mid} / ${narrow} across at 1500 / 1050 / 760px`);
  await page.setViewport({ width: 1500, height: 1000 });
  await sleep(300);

  /* ---- 8. search, and the rail ------------------------------------------ */
  await page.evaluate(() => {
    const s = document.getElementById('sfxSearch');
    s.value = 'bow';
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(400);
  const found = await page.evaluate(() => ({
    cards: document.querySelectorAll('.sfx-card').length,
    names: [...document.querySelectorAll('.sfx-card-name')].map(e => e.textContent),
    line: document.getElementById('sfxCount').textContent,
  }));
  note(found.cards > 0 && found.cards < onDisk.items,
       `searching "bow" left ${found.cards} of ${onDisk.items} cards`);
  note(found.names.every(n => /bow/i.test(n)), `a card that does not match came back: ${found.names.join(', ')}`);
  await page.evaluate(() => {
    const s = document.getElementById('sfxSearch');
    s.value = '';
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(400);
  note(await page.evaluate(() => document.querySelectorAll('.sfx-card').length) === onDisk.items,
       'clearing the search did not bring every card back');

  /* ---- 9. the overlay closing stops the sound --------------------------- */
  await page.evaluate(() => {
    const c = [...document.querySelectorAll('.sfx-card')].find(x => x.dataset.cat === 'Harness');
    c.querySelector('.sfx-play').click();
  });
  await page.waitForFunction(() => !document.getElementById('sfxAudio').paused, { timeout: 8000 })
    .then(() => note(true, ''))
    .catch(() => note(false, 'could not start the fixture for the close check'));
  await page.evaluate(() => document.getElementById('sfxClose').click());
  await sleep(400);
  const shut = await page.evaluate(() => ({
    open: document.getElementById('sfxModal').open,
    paused: document.getElementById('sfxAudio').paused,
    src: document.getElementById('sfxAudio').getAttribute('src'),
    /* AND NOTHING IS LEFT AUDIBLE WITH NO CONTROL. This player has no docked
       form, so closing the overlay must stop it -- and the bus's own guard
       must agree, which is the rule rather than this file's opinion. */
    audit: MediaBus.audit(),
  }));
  note(!shut.open, 'the X did not close the overlay');
  note(shut.paused && shut.src === null, 'closing the overlay left the sound playing');
  note(shut.audit.every(p => !p.audible || p.reachable),
       `something is audible with no control after the overlay closed: ${JSON.stringify(shut.audit)}`);

  const unexpected = [...new Set(missing)].filter(u => !/favicon|\/api\//.test(u));
  note(unexpected.length === 0, `unexpected 404(s): ${unexpected.slice(0, 4).join(', ')}`);
} finally {
  await browser.close();
  server.close();
  restore();
}

const TOTAL = pass + fail.length;
if (TOTAL < 35) {
  console.error(`sfx_check: only ${TOTAL} checks ran — the harness has lost its subject`);
  process.exit(1);
}
if (fail.length) {
  console.error(`\nsfx_check: ${fail.length} of ${TOTAL} FAILED`);
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nsfx_check: ${pass} checks passed`);
