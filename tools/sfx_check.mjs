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
  /* The library ships .ogg. Served as application/octet-stream a browser may
     still sniff it and play, which is exactly the kind of accidental pass this
     file exists to avoid -- Vercel sends audio/ogg, so this does too. */
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.webm': 'audio/webm', '.flac': 'audio/flac',
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
    plays: document.querySelectorAll('.sfx-play').length,
    /* .sfx-wave-off, not .sfx-wave svg: every picture is drawn TWICE, dim and
       bright, and counting both says there are two waveforms per card. */
    waves: document.querySelectorAll('.sfx-card:not(.is-empty) .sfx-wave-off').length,
    /* THE PICTURE IS THE MANIFEST'S, not something decoded here. Every bar is
       one <path> subpath, so counting the M commands counts the bars -- and a
       waveform drawn from nothing would be a valid, empty, invisible <svg>
       that every "is it there" assertion passes over. */
    bars: (() => {
      const p = document.querySelector('.sfx-card:not(.is-empty) .sfx-wave-off path');
      return p ? (p.getAttribute('d').match(/M/g) || []).length : 0;
    })(),
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
  /* NO TRANSPORT AT ALL ANY MORE. It used to be one element moved into
     whichever card was playing, and it arrived carrying a second play button
     -- which is what Dex reported on 2026-09-11: "we have two play buttons".
     The card is the transport now, so there must be exactly one play button
     per card and no transport anywhere. */
  note(built.transports === 0, `${built.transports} transport(s) in the DOM — the card is the transport now`);
  note(built.plays === built.cards, `${built.plays} play buttons for ${built.cards} cards`);
  note(built.waves === built.cards - built.empty,
       `${built.waves} waveforms for ${built.cards - built.empty} cards with a file`);
  note(built.bars === (onDisk.bars || 40),
       `a waveform is drawn with ${built.bars} bars, the manifest ships ${onDisk.bars}`);
  console.log(`library: ${built.cats} categories, ${built.cards} cards, ${built.options} takes, `
              + `${built.empty} still to source, ${built.bars}-bar waveforms — "${built.countLine}"`);

  /* ---- 2. a card with no file says so and cannot be played --------------
     The saying-so is the DROPDOWN, which is the place you were about to read
     anyway -- there was a "TO SOURCE" caption under the card as well and it
     was the same sentence twice. What has to hold is that neither control
     lies: nothing to play, nothing to download. */
  const unsourced = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.sfx-card.is-empty')][0];
    if (!c) return null;
    const get = c.querySelector('.sfx-get');
    return {
      disabled: c.querySelector('.sfx-play').disabled,
      says: /no file yet/i.test(c.querySelector('.sfx-pick').options[0].textContent),
      getOff: get.getAttribute('aria-disabled') === 'true' && !get.getAttribute('href'),
      caption: !!c.querySelector('.sfx-wait'),
      /* No file, no picture, and it says so where the length would be. */
      wave: !!c.querySelector('.sfx-wave svg'),
      dur: c.querySelector('.sfx-dur').textContent.trim(),
    };
  });
  note(!!unsourced, 'no unsourced card to check — the manifest has a file for everything?');
  note(unsourced && unsourced.disabled, 'a card with no file behind it still offers a play button');
  note(unsourced && unsourced.says, 'the dropdown does not say which takes have no file yet');
  note(unsourced && unsourced.getOff, 'a card with no file behind it still offers a download');
  note(unsourced && !unsourced.caption, 'the TO SOURCE caption is back — the dropdown already says it');
  note(unsourced && !unsourced.wave, 'a card with no file behind it drew a waveform of nothing');
  note(unsourced && /no file/i.test(unsourced.dur),
       `an unsourced card's length reads "${unsourced && unsourced.dur}"`);

  /* ---- 2b. a card WITH a file offers the take you are looking at --------- */
  const dl = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.sfx-card')].find(x => !x.classList.contains('is-empty'));
    if (!c) return null;
    const get = c.querySelector('.sfx-get');
    const pick = c.querySelector('.sfx-pick');
    const first = { href: get.getAttribute('href'), name: get.getAttribute('download') };
    pick.value = String(Math.min(1, pick.options.length - 1));
    pick.dispatchEvent(new Event('change', { bubbles: true }));
    return { first, second: { href: get.getAttribute('href'), name: get.getAttribute('download') },
             takes: pick.options.length, item: c.dataset.item };
  });
  note(!!dl && /^assets\/sfx\//.test(dl.first.href || ''), `the download points at "${dl && dl.first.href}"`);
  note(!!dl && /\.(ogg|mp3|wav|m4a|webm|flac)$/i.test(dl.first.name || ''),
       `the download would save as "${dl && dl.first.name}" — no extension`);
  note(!!dl && dl.first.name.includes(dl.item), 'the saved name does not say which item it is');
  /* CHANGING THE TAKE CHANGES THE DOWNLOAD. A link wired once is a link that
     hands over the first take forever, which is the same bug as a play button
     that ignores the dropdown. */
  note(!!dl && dl.takes > 1 && dl.second.href !== dl.first.href,
       'switching take did not move the download with it');
  console.log(`download: "${dl.first.name}" -> "${dl.second.name}"`);

  /* ---- 2c. the length is known BEFORE anything is fetched ----------------
     tools/bake_sfx.py measures every take, so a card can say 0.78s on the
     first frame. Read it against the manifest on disk rather than against
     itself: a card showing whatever it last decoded would pass that. */
  const lengths = await page.evaluate(() => {
    const out = [];
    for (const c of document.querySelectorAll('.sfx-card:not(.is-empty)')) {
      out.push({ cat: c.dataset.cat, item: c.dataset.item,
                 take: Number(c.querySelector('.sfx-pick').value) || 0,
                 says: c.querySelector('.sfx-dur').textContent.trim() });
    }
    return out;
  });
  const wantLength = (row) => {
    const cat = onDisk.categories.find(c => c.name === row.cat);
    const item = cat && cat.items.find(i => i.name === row.item);
    const t = item && item.tracks[row.take];
    return t && typeof t.d === 'number'
      ? (t.d < 10 ? `${t.d.toFixed(2)}s` : null) : null;
  };
  const wrongLength = lengths.filter(r => r.says !== wantLength(r));
  note(lengths.length > 10, `only ${lengths.length} cards had a length to check`);
  note(!wrongLength.length,
       `${wrongLength.length} card(s) show a length the manifest does not agree with`
       + (wrongLength[0] ? ` — ${wrongLength[0].item} says "${wrongLength[0].says}"` : ''));
  console.log(`lengths: ${lengths.length} cards say how long their take is with nothing fetched`);

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

  await sleep(400);
  const live = await page.evaluate(() => {
    const a = document.getElementById('sfxAudio');
    const card = document.querySelector('.sfx-card.is-playing');
    const tr = document.querySelector('.sfx-transport');
    return {
      playing: !a.paused,
      src: (a.currentSrc || '').split('/').pop(),
      dur: Math.round(a.duration * 10) / 10,
      cards: document.querySelectorAll('.sfx-card.is-playing').length,
      /* THE PROGRESS IS ON THE CARD, which is the whole design now. --at is
         what clips the bright half of the waveform, so a card that is playing
         and showing 0% is a picture that never fills. */
      at: card ? parseFloat(card.style.getPropertyValue('--at')) : -1,
      onlyPlay: card ? card.querySelectorAll('.sfx-play').length : -1,
      transports: document.querySelectorAll('.sfx-transport').length,
      icon: card && card.querySelector('.sfx-play .icon').dataset.icon,
    };
  });
  note(live.playing, 'the audio is not playing');
  note(live.src === 'harness-tone.wav', `playing "${live.src}", expected the fixture`);
  note(live.dur > 1.5 && live.dur < 2.5, `the fixture reports ${live.dur}s, expected about 2`);
  note(live.cards === 1, `${live.cards} cards are marked as playing, expected exactly 1`);
  note(live.at > 0, `the playing card's waveform is filled to ${live.at}% — it is not following the sound`);
  note(live.onlyPlay === 1, `the playing card has ${live.onlyPlay} play buttons — there must be exactly one`);
  note(live.transports === 0, `${live.transports} transports appeared when something started playing`);
  note(live.icon === 'pause', `the playing card's button shows "${live.icon}"`);

  /* ---- 4. seek, repeat, volume and stop --------------------------------- */
  /* THE WAVEFORM IS THE SCRUB BAR. Driven with a real pointer at a real
     coordinate, because the whole mechanism is "where in this box did you
     press" -- a synthetic event with no clientX would seek to the left edge
     and pass a test written against any number. */
  /* SETTLE FIRST. .sfx-list scrolls smoothly, so a rect read straight after
     scrollIntoView is the rect from before the scroll -- the click then lands
     somewhere else entirely and the seek reads as broken. */
  await page.evaluate(() => document.querySelector('.sfx-card.is-playing')
    .scrollIntoView({ block: 'center', behavior: 'instant' }));
  await sleep(400);
  const waveBox = await page.evaluate(() => {
    const w = document.querySelector('.sfx-card.is-playing .sfx-wave').getBoundingClientRect();
    return { x: Math.round(w.left + w.width * 0.55), y: Math.round(w.top + w.height / 2),
             left: Math.round(w.left), width: Math.round(w.width) };
  });
  await page.mouse.click(waveBox.x, waveBox.y);
  await sleep(300);
  const seeked = await page.evaluate(() => {
    const a = document.getElementById('sfxAudio');
    const card = document.querySelector('.sfx-card.is-playing');
    return { at: a.currentTime, dur: a.duration,
             fill: parseFloat(card.style.getPropertyValue('--at')),
             aria: Number(card.querySelector('.sfx-wave').getAttribute('aria-valuenow')) };
  });
  note(seeked.at > seeked.dur * 0.3, `pressing 55% across the waveform landed at ${seeked.at.toFixed(2)}s of ${seeked.dur}s`);
  note(seeked.fill > 30, `the waveform is filled to ${seeked.fill}% after seeking to the middle`);
  note(seeked.aria > 30, `the waveform reports aria-valuenow ${seeked.aria} after seeking to the middle`);

  const looped = await page.evaluate(() => {
    const b = document.querySelector('.sfx-card.is-playing [data-el="loop"]');
    b.click();
    return { loop: document.getElementById('sfxAudio').loop, pressed: b.getAttribute('aria-pressed'),
             everywhere: [...document.querySelectorAll('.sfx-card [data-el="loop"]')]
               .every(x => x.getAttribute('aria-pressed') === 'true') };
  });
  note(looped.loop === true && looped.pressed === 'true', 'the repeat toggle did not reach the audio element');
  /* ONE LATCH FOR THE LIBRARY, not one per card: there is one <audio>, and 25
     buttons disagreeing about whether it repeats is 24 of them lying. */
  note(looped.everywhere, 'repeat is on but only the card that is playing says so');
  await page.evaluate(() => document.querySelector('.sfx-card.is-playing [data-el="loop"]').click());

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

  /* STOP IS IN THE HEADER, because it is the library's and not a card's --
     and it is dead while nothing is playing, which is the only honest state
     for a button that stops things. */
  await page.evaluate(() => document.getElementById('sfxStop').click());
  await sleep(250);
  const stopped = await page.evaluate(() => ({
    paused: document.getElementById('sfxAudio').paused,
    src: document.getElementById('sfxAudio').getAttribute('src'),
    playing: document.querySelectorAll('.sfx-card.is-playing').length,
    stopDead: document.getElementById('sfxStop').disabled,
    fills: [...document.querySelectorAll('.sfx-card')]
      .map(c => parseFloat(c.style.getPropertyValue('--at')) || 0)
      .filter(v => v > 0).length,
  }));
  note(stopped.paused, 'stop did not pause the audio');
  note(stopped.src === null, 'stop left the element holding a src');
  note(stopped.playing === 0, 'a card is still marked as playing after stop');
  note(stopped.stopDead, 'the stop button is still live with nothing playing');
  note(stopped.fills === 0, `${stopped.fills} card(s) still show a filled waveform after stop`);

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
  note(swapped.transports === 0, `${swapped.transports} transports after switching take`);
  console.log(`one at a time: take "${swapped.take}" after a dropdown change, ${swapped.playingNow} card playing`);
  await page.evaluate(() => document.getElementById('sfxStop').click());

  /* ---- 5b. previous and next walk the takes ------------------------------
     The point of the pair: press play, then audition the rest with one finger
     instead of opening a dropdown per take. On the card that is SOUNDING they
     have to play what they moved to, and they have to wrap -- a library you
     cycle is a library you can go round. */
  const stepped = await page.evaluate(async () => {
    const c = [...document.querySelectorAll('.sfx-card')]
      .find(x => x.dataset.cat !== 'Harness' && !x.classList.contains('is-empty')
                 && x.querySelector('.sfx-pick').options.length > 2);
    if (!c) return null;
    c.scrollIntoView({ block: 'center' });
    const pick = c.querySelector('.sfx-pick');
    const wave = () => c.querySelector('.sfx-wave-off path').getAttribute('d');
    /* FROM THE FIRST TAKE, deliberately. The download check earlier leaves
       this same card on take 1, and a wrap test that starts wherever the last
       test left it is a wrap test that never reaches the wrap. */
    pick.value = '0';
    pick.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    const start = { i: Number(pick.value), d: wave() };
    c.querySelector('[data-el="next"]').click();
    await new Promise(r => setTimeout(r, 120));
    const next = { i: Number(pick.value), d: wave() };
    c.querySelector('[data-el="prev"]').click();
    c.querySelector('[data-el="prev"]').click();
    await new Promise(r => setTimeout(r, 120));
    const back = { i: Number(pick.value), n: pick.options.length };
    return { item: c.dataset.item, start, next, back };
  });
  note(!!stepped, 'no card with three takes to step through');
  note(stepped && stepped.next.i === stepped.start.i + 1,
       `next went from take ${stepped && stepped.start.i} to ${stepped && stepped.next.i}`);
  /* THE PICTURE MOVES WITH IT. A next button that changes the dropdown and
     leaves the waveform of the previous take on screen is the same bug the
     download had before it was wired to every change. */
  note(stepped && stepped.next.d !== stepped.start.d, 'the waveform did not change with the take');
  note(stepped && stepped.back.i === stepped.back.n - 1,
       `previous past the first take landed on ${stepped && stepped.back.i}, expected it to wrap to `
       + `${stepped && stepped.back.n - 1}`);
  console.log(`takes: "${stepped.item}" stepped forward, back, and wrapped round ${stepped.back.n}`);

  /* ---- 5c. holding the loop button auditions a loop ----------------------
     Asked for by name (Dex, 2026-09-11) for the sounds that repeat in the
     game -- a jetpack, tracks, a held trigger. Click latches; press and HOLD
     plays it round for as long as the button is down and stops on release.
     Driven with a real pointer held down, because the whole mechanism is the
     gap between pointerdown and pointerup. */
  await page.evaluate(() => [...document.querySelectorAll('.sfx-card')]
    .find(x => x.dataset.cat !== 'Harness' && !x.classList.contains('is-empty'))
    .scrollIntoView({ block: 'center', behavior: 'instant' }));
  await sleep(400);
  const holdBox = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.sfx-card')]
      .find(x => x.dataset.cat !== 'Harness' && !x.classList.contains('is-empty'));
    const b = c.querySelector('[data-el="loop"]').getBoundingClientRect();
    const at = document.elementFromPoint(Math.round(b.left + b.width / 2),
                                         Math.round(b.top + b.height / 2));
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2),
             item: c.dataset.item, onIt: !!at?.closest('[data-el="loop"]') };
  });
  note(holdBox.onIt, 'the point the hold is driven at is not on the loop button');
  await page.mouse.move(holdBox.x, holdBox.y);
  await page.mouse.down();
  await sleep(700);
  const held = await page.evaluate(() => {
    const a = document.getElementById('sfxAudio');
    const c = document.querySelector('.sfx-card.is-holding');
    return { holding: !!c, item: c && c.dataset.item, loop: a.loop, playing: !a.paused,
             pressed: document.querySelector('.sfx-card.is-playing [data-el="loop"]')
               ?.getAttribute('aria-pressed') };
  });
  await page.mouse.up();
  await sleep(350);
  const letGo = await page.evaluate(() => {
    const a = document.getElementById('sfxAudio');
    return { holding: !!document.querySelector('.sfx-card.is-holding'),
             paused: a.paused, loop: a.loop, src: a.getAttribute('src'),
             pressed: [...document.querySelectorAll('.sfx-card [data-el="loop"]')]
               .some(b => b.getAttribute('aria-pressed') === 'true') };
  });
  note(held.holding, 'holding the loop button did not put the card into its held state');
  note(held.playing && held.loop, `held: playing ${held.playing}, looping ${held.loop}`);
  /* A HOLD IS NOT A LATCH. If the press also toggled repeat on, letting go
     would leave the library latched to loop for every take after it. */
  note(held.pressed === 'false', 'holding the loop button latched repeat as well');
  note(!letGo.holding, 'the card is still held after the button came up');
  note(letGo.paused && letGo.src === null, 'letting go of the loop button did not stop the sound');
  note(!letGo.pressed, 'letting go of a hold left repeat latched on');
  console.log(`hold: "${holdBox.item}" looped while the button was down, stopped when it came up`);

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

  /* ---- 8b. a take that SHIPS plays, not only the fixture ----------------
     The fixture is a WAV this file wrote and then deletes. Everything the
     library actually holds is an .ogg on disk, and while every track was a
     dash there was nothing to prove that half with. A pass here means the
     manifest's path, the server's content type and the decoder all agree. */
  const real = await page.evaluate(async () => {
    const c = [...document.querySelectorAll('.sfx-card')]
      .find(x => x.dataset.cat !== 'Harness' && !x.classList.contains('is-empty'));
    if (!c) return null;
    c.scrollIntoView({ block: 'center' });
    c.querySelector('.sfx-play').click();
    /* 120ms, not 900: these are ONE-SHOTS and the shortest is 0.13s long.
       Reading `paused` a second later reports a take that finished, which is
       the sound working, not failing. */
    await new Promise(r => setTimeout(r, 120));
    const a = document.getElementById('sfxAudio');
    const mid = { playing: !a.paused, at: a.currentTime, dur: a.duration };
    await new Promise(r => setTimeout(r, 900));
    return {
      cat: c.dataset.cat, item: c.dataset.item,
      src: decodeURIComponent((a.currentSrc || '').split('/').pop()),
      ...mid, over: a.ended || a.paused,
    };
  });
  note(!!real, 'no card with a real file behind it — is every track still a dash?');
  note(real && real.playing, `pressing play on "${real && real.item}" did not start it`);
  note(real && /\.ogg$/i.test(real.src || ''), `the shipped take came back as "${real && real.src}"`);
  note(real && real.dur > 0.1 && real.dur < 10,
       `the shipped take reports ${real && real.dur}s, expected a one-shot`);
  note(real && real.at > 0, 'the shipped take never advanced past zero');
  note(real && real.over, 'a one-shot was still playing a second later — is it looping?');
  console.log(`shipped: ${real.cat} / ${real.item} -> ${real.src}, ${real.dur.toFixed(2)}s, `
              + `${real.at.toFixed(2)}s in after 120ms`);
  await page.evaluate(() => document.querySelector('.sfx-transport [data-el="stop"]')?.click());
  await sleep(200);

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
