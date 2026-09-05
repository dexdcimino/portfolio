/* Drive the MUSIC overlay in a real browser.
 *
 *   node tools/music_check.mjs
 *
 * Serves the repo itself and needs nothing running. No network to YouTube is
 * required or used: what is checked is the embed URL the overlay builds, not
 * whether YouTube answers it.
 *
 * WHY THIS EXISTS. Every part of this overlay only comes into being once the
 * browser has run the script — the rows are built from a fetched manifest, the
 * columns are a grid that has to line up down 311 rows, the tick list lives in
 * localStorage, and the door is a scrypt decryption of a blob in an attribute.
 * None of it can be read off the source, and the repo's other gates all pass
 * over an overlay that never opens.
 *
 * It also covers the KEYPAD FLASH: opening the notes with a code in hand used
 * to show a password box to someone who had just typed that password. That is
 * a fix to a thing that happens in the first frame and disappears, so it is
 * asserted synchronously — after the event is dispatched and before the unlock
 * round trip can resolve.
 *
 * COUNT THE SUBJECT: the row count, the cell count and the number of checks
 * this file runs are all asserted, because a harness whose subject silently
 * became empty prints exactly what a passing one prints. See CLAUDE.md.
 */
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => p && existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found — set CHROME=<path to the exe>');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.webm': 'video/webm',
};
const server = createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = resolve(join(ROOT, normalize(url === '/' ? '/index.html' : url)));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('404'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const fail = [];
let pass = 0;
const note = (ok, why) => { if (ok) pass++; else fail.push(why); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-first-run', '--no-default-browser-check', '--mute-audio'],
});
const page = await browser.newPage();
const cdp = await page.createCDPSession();
// Before navigating, always: a headless Chrome on a throwaway profile still
// writes to the REAL Downloads folder otherwise.
await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
await page.setViewport({ width: 1600, height: 1000 });

page.on('pageerror', e => fail.push(`pageerror: ${e.message}`));

/* The static server has no /api routes, so the notes overlay's unlock POST
   404s — which is exactly the state check 9 wants to be in, and Chrome logs it
   to the console as an error with no URL attached. Rather than ignore every
   404 by text, the URLs are collected here and asserted at the end: an
   unexpected one is still a failure. */
const notFound = [];
page.on('response', r => { if (r.status() === 404) notFound.push(new URL(r.url()).pathname); });
page.on('console', m => {
  if (m.type() !== 'error') return;
  const text = m.text();
  // The embed is never reachable from here and is not what this checks. Its own
  // load failure is expected, and so is the 404 above; anything else is not.
  if (/youtube|ERR_|net::/i.test(text)) return;
  if (/Failed to load resource/i.test(text)) return;
  fail.push(`console: ${text}`);
});
// Nothing in this harness should reach the network, and a YouTube request that
// hangs would only make it slow. Refuse them and count them instead.
let embedRequests = 0;
await page.setRequestInterception(true);
page.on('request', (req) => {
  if (/youtube(-nocookie)?\.com/.test(req.url())) { embedRequests++; req.abort().catch(() => {}); return; }
  req.continue().catch(() => {});
});

await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle2', timeout: 60000 });

/* ---- 1. the overlay is shut, and shipped empty ---------------------------
   FALSELY PASSES IF: only `open` were checked. A dialog can be closed and
   still have 311 rows of markup in it, which is the cost this design exists
   to avoid — the rows must not be in the page until the manifest is fetched. */
{
  const shut = await page.evaluate(() => ({
    exists: !!document.getElementById('musicModal'),
    open: document.getElementById('musicModal')?.open === true,
    rows: document.querySelectorAll('#musicRows .music-row').length,
    barHidden: document.getElementById('musicBar')?.hidden === true,
  }));
  note(shut.exists, 'the #musicModal dialog is not in the page at all');
  note(!shut.open, 'the music overlay is open before anything asked for it');
  note(shut.rows === 0, `${shut.rows} row(s) shipped in the markup — the list must be fetched`);
  note(shut.barHidden, 'the player bar is showing before anything is playing');
}

/* ---- 2. the sealed code opens it, through the real decryption -------------
   Typed into the tilde keypad exactly as a person would. This is the only
   check that proves the blob in data-vault is the one that says show:music —
   a wrong seal cannot be seen in the source, only in a door that fails to
   open. scrypt at 32 MiB takes a moment, hence the generous timeout.

   The page is PARKED somewhere first, on purpose. Two bugs lived in this
   sequence and both are invisible unless the reader starts somewhere that is
   not the top: the code stayed in the boxes after it was accepted, and closing
   the overlay put focus in the Idea Vault and dragged the page down to it. */
let parkedAt = 0;
{
  parkedAt = await page.evaluate(() => {
    window.scrollTo({ top: 900, behavior: 'instant' });
    return Math.round(window.scrollY);
  });
  note(parkedAt > 100, `the page did not park anywhere to scroll away from (${parkedAt})`);

  await page.keyboard.press('Backquote');
  await page.waitForFunction(() => document.getElementById('codeModal')?.open === true,
                             { timeout: 5000 });
  note(Math.round(await page.evaluate(() => window.scrollY)) === parkedAt,
       'merely opening the tilde keypad scrolled the page');

  await page.focus('#codeModal .vault-pin');
  await page.keyboard.type('MUSIC', { delay: 30 });

  let opened = true;
  try {
    await page.waitForFunction(() => document.getElementById('musicModal')?.open === true,
                               { timeout: 30000 });
  } catch { opened = false; }
  note(opened, 'typing MUSIC into the tilde keypad did not open the music overlay');

  const closed = await page.evaluate(() => document.getElementById('codeModal')?.open !== true);
  note(closed, 'the tilde keypad is still open behind the overlay it opened');

  /* THE CODE MUST BE GONE. It used to survive, because the teardown that
     cleared it is bindModal's onClose and that deliberately does not run when
     one overlay hands off to another — which is exactly what this is. Both
     keypads are checked: the tilde one that was typed into, and the vault's,
     which shares the same createKeypad and the same bug. */
  const boxes = await page.evaluate(() => {
    const read = (sel) => [...document.querySelectorAll(sel)].map(p => p.value).join('');
    return { tilde: read('#codeModal .vault-pin'), vault: read('#vault .vault-pin') };
  });
  note(boxes.tilde === '',
       `the tilde keypad still shows "${boxes.tilde}" after the code was accepted`);
  note(boxes.vault === '',
       `the Idea Vault keypad still shows "${boxes.vault}" after the code was accepted`);

  note(Math.round(await page.evaluate(() => window.scrollY)) === parkedAt,
       'entering the code scrolled the page away from where the reader was');
}

await page.waitForFunction(
  () => document.querySelectorAll('#musicRows .music-row').length > 0, { timeout: 20000 });

/* ---- 3. every track in the manifest has a row ---------------------------- */
const manifest = JSON.parse(await readFile(join(ROOT, 'assets/music/tracks.json'), 'utf8'));
{
  const rows = await page.evaluate(() => document.querySelectorAll('#musicRows .music-row').length);
  note(manifest.count > 100,
       `the manifest itself only holds ${manifest.count} track(s) — the subject is missing`);
  note(rows === manifest.count,
       `${rows} row(s) rendered for ${manifest.count} track(s) in the manifest`);
  console.log(`  subject: ${rows} rows built from ${manifest.count} manifest entries`);
}

/* ---- 3b. the player bar is up before anything is playing ---------------
   The brief: the bar shows the whole time the overlay is open, so the play
   button is somewhere to press rather than somewhere that appears once you
   have found a track to click. Which means it needs a real idle state — a
   screen box the same size as the video that replaces it, so starting a track
   does not resize the row.

   FALSELY PASSES IF: only `hidden` were read. A bar that is present but says
   nothing, or whose screen collapses to nothing until a video arrives, is the
   thing this is guarding against. */
{
  const rest = await page.evaluate(() => {
    const box = (sel) => { const r = document.querySelector(sel).getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) }; };
    return {
      barHidden: document.getElementById('musicBar').hidden,
      title: document.getElementById('musicNowTitle').textContent,
      artist: document.getElementById('musicNowArtist').textContent,
      screen: box('#musicScreen'),
      videoHidden: document.getElementById('musicVideo').hidden,
      live: document.getElementById('musicScreen').classList.contains('is-live'),
      shufflePressed: document.getElementById('musicShuffle').getAttribute('aria-pressed'),
    };
  });
  note(rest.barHidden === false, 'the player bar is not showing when the overlay opens');
  note(rest.title.trim().length > 0, 'the idle bar says nothing at all');
  note(/\d/.test(rest.artist), `the idle bar does not name the queue: "${rest.artist}"`);
  note(rest.videoHidden === true, 'the embed is on screen before anything is playing');
  note(!rest.live, 'the screen claims to be live with nothing playing');
  note(rest.screen.w > 80 && rest.screen.h > 40,
       `the idle screen is ${rest.screen.w}x${rest.screen.h} — it collapses before a video arrives`);
  // Shuffle defaults ON: 311 tracks in alphabetical order is a filing cabinet.
  note(rest.shufflePressed === 'true',
       'shuffle is not on by default in a browser that has never set it');
}

/* ---- 3c. play with nothing playing starts something --------------------
   FALSELY PASSES IF: the button's own icon were checked. What the brief asks
   is that pressing play when nothing is going PLAYS something — the track it
   picks matters far less than that a track is picked at all. */
{
  await page.click('#musicToggle');
  await page.waitForFunction(
    () => document.querySelectorAll('#musicRows .music-row.is-playing').length === 1,
    { timeout: 5000 });
  const started = await page.evaluate(() => ({
    src: document.getElementById('musicVideo').getAttribute('src') || '',
    live: document.getElementById('musicScreen').classList.contains('is-live'),
    videoHidden: document.getElementById('musicVideo').hidden,
    title: document.getElementById('musicNowTitle').textContent,
  }));
  note(started.src.includes('/embed/'), 'play from idle loaded no video');
  note(started.live && !started.videoHidden,
       'play from idle did not put the picture on screen');
  note(started.title !== 'Nothing playing', 'the bar still says nothing is playing');
}

/* ---- 3d. the playing track can actually be FOUND -----------------------
   With shuffle on, play starts one of 311 rows and nothing else says which.
   Three things have to be true: the row is scrolled to, it is marked loudly
   enough to pick out, and the tick on the scroll track says where in the list
   it sits — the last being the only one that is visible from anywhere.

   FALSELY PASSES IF: only the is-playing class were checked. A class on a row
   a thousand pixels below the fold is not the reader finding their song. */
{
  const found = await page.evaluate(() => {
    const list = document.getElementById('musicList');
    const row = document.querySelector('#musicRows .music-row.is-playing');
    if (!row) return null;
    const rows = [...document.querySelectorAll('#musicRows .music-row')];
    const cs = getComputedStyle(row);
    const mark = document.getElementById('musicMark');
    return {
      at: rows.indexOf(row), total: rows.length,
      v: row.dataset.v,
      src: document.getElementById('musicVideo').getAttribute('src') || '',
      inView: row.offsetTop >= list.scrollTop
              && row.offsetTop + row.offsetHeight <= list.scrollTop + list.clientHeight,
      tinted: cs.backgroundColor,
      edge: cs.boxShadow,
      markHidden: mark.hidden,
      markTop: parseFloat(mark.style.top),
      markWide: Math.round(mark.getBoundingClientRect().width),
    };
  });
  note(found !== null, 'no row is marked as playing at all');
  if (found) {
    note(found.inView, `the playing row (${found.at} of ${found.total}) was not scrolled into view`);
    // A tint that is still the hover colour is not a highlight anyone can find.
    note(found.tinted !== 'rgba(0, 0, 0, 0)', 'the playing row has no tint of its own');
    note(/inset/.test(found.edge), 'the playing row has no accent edge to pick it out');
    note(found.markHidden === false, 'the scroll-track tick is hidden while a track plays');
    note(found.markWide >= 4, `the scroll-track tick is only ${found.markWide}px wide`);
    // The tick says where in the LIST the track is, not where the list is
    // scrolled to — so it has to track the index, not the scroll position.
    const want = ((found.at + 0.5) / found.total) * 100;
    note(Math.abs(found.markTop - want) < 0.5,
         `the tick sits at ${found.markTop.toFixed(1)}%, the track is ${want.toFixed(1)}% down the list`);
    // The first track of a session is the one that navigates the frame, so this
    // is where the built URL can be read against the row that is playing.
    note(found.src.includes(`/embed/${found.v}?`),
         'the embed URL does not name the row that started playing');
  }
}

/* ---- 4. the four columns, and the two thin ones are square ---------------
   FALSELY PASSES IF: only the cells' existence were checked. The brief is a
   grid that lines up down the whole list, so what is measured is the LEFT
   EDGE of each column on a short-titled row and a long-titled one — a column
   that tracks its content instead of the grid drifts between them. */
{
  const geo = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#musicRows .music-row')];
    const read = (row) => {
      const box = (el) => { const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }; };
      return {
        cells: row.children.length,
        check: box(row.querySelector('.music-check')),
        play: box(row.querySelector('.music-play')),
        title: box(row.querySelector('.music-title')),
        link: box(row.querySelector('.music-linkcell')),
        hasLink: !!row.querySelector('a.music-link')?.href,
        hasCopy: !!row.querySelector('.music-copy'),
        titleSize: parseFloat(getComputedStyle(row.querySelector('.music-title')).fontSize),
        titleWeight: getComputedStyle(row.querySelector('.music-title')).fontWeight,
        artistSize: parseFloat(getComputedStyle(row.querySelector('.music-artist')).fontSize),
      };
    };
    // The longest title in the list against the shortest: if a column is going
    // to drift with its content, it is between these two.
    const byLen = [...rows].sort((a, b) =>
      a.querySelector('.music-title').textContent.length -
      b.querySelector('.music-title').textContent.length);
    return { short: read(byLen[0]), long: read(byLen[byLen.length - 1]), n: rows.length };
  });

  note(geo.short.cells === 4, `a row has ${geo.short.cells} cells, expected 4`);
  note(geo.short.hasLink && geo.short.hasCopy, 'the link cell is missing its link or its copy button');

  for (const [name, cell] of [['check', 'check'], ['play', 'play']]) {
    const a = geo.short[cell], b = geo.long[cell];
    note(a.x === b.x, `the ${name} column moves between rows (${a.x} vs ${b.x})`);
    note(a.w > 12 && Math.abs(a.w - a.h) <= 10,
         `the ${name} cell is not a square block (${a.w}x${a.h})`);
  }
  note(geo.short.title.x === geo.long.title.x,
       `the title column moves between rows (${geo.short.title.x} vs ${geo.long.title.x})`);
  note(geo.short.link.x === geo.long.link.x,
       `the link column moves between rows (${geo.short.link.x} vs ${geo.long.link.x})`);

  // The brief: the name big and bold, the artist under it.
  note(Number(geo.short.titleWeight) >= 600,
       `the title is not bold (font-weight ${geo.short.titleWeight})`);
  note(geo.short.titleSize > geo.short.artistSize,
       `the title (${geo.short.titleSize}px) is not larger than the artist (${geo.short.artistSize}px)`);

  // Left to right: tick, play, title, link. Asserted rather than assumed.
  const order = [geo.short.check.x, geo.short.play.x, geo.short.title.x, geo.short.link.x];
  note(order.every((v, i) => i === 0 || v > order[i - 1]),
       `the columns are not in the order tick, play, title, link: ${order.join(' < ')}`);
}

/* ---- 5. the defaults are seeded, and ticking still owns the list --------
   The tracks marked |R in tracklist.txt arrive already ticked in a browser
   that has never opened this. That is the state under test here: a fresh
   profile, so localStorage is empty and the seed path is the one that runs.

   FALSELY PASSES IF: only the checkbox's own state were read back. What the
   tick is FOR is the second playlist, so what is checked is the rail count,
   the REPEAT view's contents, and that a row leaves when it is unticked. */
{
  const SEEDED = manifest.repeat;
  note(SEEDED > 0, 'the manifest marks no repeat defaults at all — nothing to seed');

  const seeded = await page.evaluate(() => ({
    checked: document.querySelectorAll('#musicRows .music-check:checked').length,
    railN: document.getElementById('musicNRepeat').textContent,
  }));
  note(seeded.checked === SEEDED,
       `${seeded.checked} rows arrived ticked, the manifest marks ${SEEDED}`);
  note(seeded.railN === String(SEEDED),
       `the REPEAT rail reads "${seeded.railN}", the manifest marks ${SEEDED}`);
  console.log(`  seeded: ${seeded.checked} of ${manifest.count} arrive on repeat`);

  // Every seeded row must be one the manifest actually marked, not just the
  // right NUMBER of rows — a seed that ticked the first 56 would pass a count.
  const wrong = await page.evaluate((marked) => {
    const on = [...document.querySelectorAll('#musicRows .music-row')]
      .filter(r => r.querySelector('.music-check').checked).map(r => r.dataset.v);
    return on.filter(v => !marked.includes(v)).length;
  }, manifest.tracks.filter(t => t.r).map(t => t.v));
  note(wrong === 0, `${wrong} ticked row(s) are not marked |R in the manifest`);

  const ticked = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#musicRows .music-row')]
      .find(r => !r.querySelector('.music-check').checked);
    const box = row.querySelector('.music-check');
    box.click();
    return { v: row.dataset.v, checked: box.checked,
             railN: document.getElementById('musicNRepeat').textContent };
  });
  note(ticked.checked, 'clicking an unticked row did not check it');
  note(ticked.railN === String(SEEDED + 1),
       `the REPEAT count reads "${ticked.railN}" after one more tick`);

  await page.click('#musicViewRepeat');
  const inRepeat = await page.evaluate((v) => {
    const rows = [...document.querySelectorAll('#musicRows .music-row')];
    return { n: rows.length, has: rows.some(r => r.dataset.v === v),
             allChecked: rows.every(r => r.querySelector('.music-check').checked),
             pressed: document.getElementById('musicViewRepeat').getAttribute('aria-pressed') };
  }, ticked.v);
  note(inRepeat.n === SEEDED + 1,
       `the REPEAT playlist shows ${inRepeat.n} track(s), expected ${SEEDED + 1}`);
  note(inRepeat.has, 'the track just ticked is not in the REPEAT playlist');
  note(inRepeat.allChecked, 'the REPEAT playlist is showing an unticked row');
  note(inRepeat.pressed === 'true', 'the REPEAT rail button does not read as pressed');

  // Untick from inside REPEAT: the row has to leave, or the tick means nothing
  // in the one place it matters most.
  const after = await page.evaluate((v) => {
    document.querySelector(`.music-row[data-v="${v}"] .music-check`).click();
    const rows = [...document.querySelectorAll('#musicRows .music-row')];
    return { n: rows.length, has: rows.some(r => r.dataset.v === v) };
  }, ticked.v);
  note(after.n === SEEDED, `unticking inside REPEAT left ${after.n} row(s), expected ${SEEDED}`);
  note(!after.has, 'the unticked row is still in the REPEAT playlist');

  // Empty it entirely: an empty list must say so rather than look broken.
  const drained = await page.evaluate(() => {
    let guard = 0;
    let box;
    while ((box = document.querySelector('#musicRows .music-check')) && guard++ < 2000) box.click();
    return { n: document.querySelectorAll('#musicRows .music-row').length,
             said: document.getElementById('musicEmpty').hidden === false,
             railN: document.getElementById('musicNRepeat').textContent };
  });
  note(drained.n === 0, `emptying REPEAT left ${drained.n} row(s) behind`);
  note(drained.said, 'an empty REPEAT playlist says nothing at all');
  note(drained.railN === '0', `the rail reads "${drained.railN}" with nothing ticked`);

  await page.click('#musicViewAll');
}

/* ---- 6. search and sort ------------------------------------------------- */
{
  const first = await page.evaluate(() =>
    document.querySelector('#musicRows .music-title').textContent);

  await page.click('#musicSortArtist');
  await page.waitForFunction(
    (was) => document.querySelector('#musicRows .music-title')?.textContent !== was,
    { timeout: 5000 }, first).catch(() => {});
  const byArtist = await page.evaluate(() => {
    const names = [...document.querySelectorAll('#musicRows .music-artist')].map(e => e.textContent);
    const sorted = [...names].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    return { n: names.length, ordered: names.every((v, i) => v === sorted[i]) };
  });
  note(byArtist.n === manifest.count, `sorting by artist lost rows (${byArtist.n})`);
  note(byArtist.ordered, 'sorting by artist did not actually order the list by artist');
  await page.click('#musicSortTitle');

  const term = manifest.tracks[7].a;
  await page.click('#musicSearch');
  await page.keyboard.type(term, { delay: 5 });
  await page.waitForFunction(
    (n) => document.querySelectorAll('#musicRows .music-row').length < n,
    { timeout: 5000 }, manifest.count);
  const found = await page.evaluate((q) => {
    const rows = [...document.querySelectorAll('#musicRows .music-row')];
    const hay = rows.map(r => (r.querySelector('.music-title').textContent + ' ' +
                               r.querySelector('.music-artist').textContent).toLowerCase());
    return { n: rows.length, all: hay.every(h => h.includes(q.toLowerCase())) };
  }, term);
  const expected = manifest.tracks.filter(t =>
    (t.t + ' ' + t.a).toLowerCase().includes(term.toLowerCase())).length;
  note(found.n > 0 && found.n < manifest.count,
       `searching "${term}" returned ${found.n} of ${manifest.count} rows`);
  note(found.n === expected,
       `searching "${term}" returned ${found.n} rows, the manifest holds ${expected}`);
  note(found.all, `searching "${term}" returned rows that do not match it`);

  // A search that matches nothing must say so rather than look broken.
  await page.evaluate(() => { document.getElementById('musicSearch').value = ''; });
  await page.click('#musicSearch');
  await page.keyboard.type('zzzznotatrack', { delay: 5 });
  await page.waitForFunction(
    () => document.getElementById('musicEmpty').hidden === false, { timeout: 5000 })
    .then(() => note(true, '')).catch(() => note(false, 'a search matching nothing shows an empty list with no explanation'));

  await page.evaluate(() => {
    const el = document.getElementById('musicSearch');
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(
    (n) => document.querySelectorAll('#musicRows .music-row').length === n,
    { timeout: 5000 }, manifest.count);
}

/* ---- 7. play builds the right embed URL --------------------------------
   FALSELY PASSES IF: only the bar's appearance were checked. The contract is
   the URL: the nocookie host (which is what the CSP allows), the id of the
   row that was clicked, and enablejsapi, without which every transport button
   below is inert. */
{
  /* Closed and reopened first, and this is the whole reason: only the FIRST
     track of a session navigates the frame. Every one after it is handed to a
     live player by loadVideoById and the src attribute keeps naming the first —
     deliberately, because re-pointing src would throw away the gesture that
     permits sound and flash a black box between songs. Reading src after a
     later track therefore reads the earlier one, which is exactly what this
     check did once the bar became permanent and nothing stopped playback
     between here and 3c. */
  await page.click('#musicClose');
  await page.waitForFunction(() => document.getElementById('musicModal').open !== true,
                             { timeout: 5000 });
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('music:open', { detail: {} })));
  await page.waitForFunction(() => document.getElementById('musicModal').open === true,
                             { timeout: 5000 });
  await page.waitForFunction(
    () => document.querySelectorAll('#musicRows .music-row').length > 0, { timeout: 5000 });
  note(await page.evaluate(() => document.getElementById('musicVideo').getAttribute('src') === null),
       'reopening the overlay left the previous track loaded in the frame');

  const track = await page.evaluate(() => {
    const row = document.querySelectorAll('#musicRows .music-row')[3];
    row.querySelector('.music-play').click();
    return { v: row.dataset.v, title: row.querySelector('.music-title').textContent };
  });
  await page.waitForFunction(() => document.getElementById('musicBar').hidden === false,
                             { timeout: 5000 });
  const bar = await page.evaluate(() => ({
    src: document.getElementById('musicVideo').getAttribute('src') || '',
    now: document.getElementById('musicNowTitle').textContent,
    playingRows: document.querySelectorAll('#musicRows .music-row.is-playing').length,
    videoBox: (() => { const r = document.getElementById('musicVideo').getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
  }));

  note(bar.src.startsWith('https://www.youtube-nocookie.com/embed/'),
       `the embed is not on the nocookie host: ${bar.src.slice(0, 60)}`);
  note(bar.src.includes(`/embed/${track.v}?`), 'the embed URL names the wrong video');
  note(bar.src.includes('enablejsapi=1'),
       'the embed has no enablejsapi — every transport button would be inert');
  note(bar.now === track.title, `the bar says "${bar.now}", the row says "${track.title}"`);
  note(bar.playingRows === 1, `${bar.playingRows} rows are marked as playing, expected 1`);
  // Visible, and staying visible: playing the embed with the picture hidden is
  // against the terms it ships under.
  note(bar.videoBox.w > 60 && bar.videoBox.h > 30,
       `the video is ${bar.videoBox.w}x${bar.videoBox.h} — effectively hidden`);
  note(embedRequests > 0, 'the page never even asked for the embed');
}

/* ---- 7b. the repeat button cycles through three states -----------------
   The brief: repeat off, repeat the playlist, repeat this one track. Two
   states would be an aria-pressed toggle; three cannot be, which is why this
   reads data-loop. The 1 badge must appear on the third and only the third. */
{
  /* The badge FADES, so a read taken straight after the click that turns it on
     catches the transition in flight and comes back near zero — which is what
     this check reported the first time it ran, as a fault in the button.
     Settle on the animation's own completion rather than guessing at a sleep:
     headless paints on demand and a mid-flight opacity is not a state anyone
     ever sees. An element with nothing running returns no animations and this
     reads the value it already holds. */
  const read = () => page.evaluate(async () => {
    const b = document.getElementById('musicLoop');
    const badge = b.querySelector('.music-loop-one');
    await Promise.all(badge.getAnimations().map(a => a.finished.catch(() => {})));
    return { state: b.dataset.loop, label: b.getAttribute('aria-label'),
             badge: parseFloat(getComputedStyle(badge).opacity) };
  });

  // Three clicks, four reads: the cycle has to come back to where it started.
  const seen = [await read()];
  for (let i = 0; i < 3; i++) {
    await page.click('#musicLoop');
    seen.push(await read());
  }
  note(seen.map(s => s.state).join(',') === 'off,all,one,off',
       `the repeat button cycles ${seen.map(s => s.state).join(',')}, expected off,all,one,off`);
  note(seen[2].badge === 1, 'the 1 badge is not shown on repeat-one');
  note(seen[0].badge === 0 && seen[1].badge === 0,
       'the 1 badge is showing on a state that is not repeat-one');
  note(new Set(seen.slice(0, 3).map(s => s.label)).size === 3,
       'the three repeat states do not have three different labels');
}

/* ---- 7c. the transport is centred in the BAR --------------------------
   FALSELY PASSES IF: the transport's own centring were read off its style.
   It is centred inside its column either way — what the brief asks for is
   that the GROUP sits in the middle of the bar, which only holds while the
   outer columns stay equal. Measured against the bar, and measured again
   with a long title in the corner, which is what a flex row would drift on. */
{
  const centre = await page.evaluate(async () => {
    const mid = (el) => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; };
    const bar = document.getElementById('musicBar');
    const group = document.querySelector('.music-transport');
    const now = document.getElementById('musicNowTitle');

    const short = Math.round(mid(group) - mid(bar));
    const before = now.textContent;
    now.textContent = 'A title very much longer than the one that was there before it';
    await new Promise(r => requestAnimationFrame(r));
    const long = Math.round(mid(group) - mid(bar));
    now.textContent = before;
    return { short, long };
  });
  note(Math.abs(centre.short) <= 2,
       `the transport sits ${centre.short}px off the centre of the bar`);
  note(centre.short === centre.long,
       `the transport moves ${Math.abs(centre.long - centre.short)}px when the title grows`);
}

/* ---- 7d. nothing has been quietly shrunk back -------------------------
   The whole interface was sized UP on purpose: this is a list read at arm's
   length, not a caption. Every one of these was smaller before and each is a
   thing a tidy-up would reach for first, so the floors are written down.
   Measured, not read off the stylesheet — a rule that loses to a later one
   still looks right in the source. */
{
  const px = await page.evaluate(() => {
    const size = (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize);
    const wide = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().width);
    return {
      title: size('.music-title'), artist: size('.music-artist'),
      link: size('.music-link'), count: size('#musicCount'),
      rail: size('#musicViewAll'), railN: size('#musicNAll'),
      sort: size('#musicSortTitle'), search: size('#musicSearch'),
      nowTitle: size('#musicNowTitle'), nowArtist: size('#musicNowArtist'),
      railIcon: wide('#musicViewAll .icon'), playIcon: wide('.music-play .icon'),
      copyIcon: wide('.music-copy .icon'),
      prev: wide('#musicPrev'), prevIcon: wide('#musicPrev .icon'),
      toggle: wide('#musicToggle'), toggleIcon: wide('#musicToggle .icon'),
      shuffleIcon: wide('#musicShuffle .icon'), loopIcon: wide('#musicLoop .icon'),
      check: wide('.music-check'),
      stop: wide('#musicStop'), stopGlyph: wide('#musicStop svg'),
      round: getComputedStyle(document.getElementById('musicToggle')).borderRadius,
    };
  });

  // The play button is the only CIRCLE in the bar; round is what carries the
  // hierarchy so the size does not have to do all of it.
  note(/50%|9999px|31px/.test(px.round) || parseFloat(px.round) >= px.toggle / 2,
       `the play button is not a circle (border-radius ${px.round} on ${px.toggle}px)`);
  // The X is a small glyph in a target big enough to hit: it is the only
  // destructive control in the bar and must not read as another transport
  // button. Both halves matter, so both are asserted.
  note(px.stopGlyph <= 19,
       `the stop glyph is ${px.stopGlyph}px — it should be well under the transport icons`);
  note(px.stop >= 36,
       `the stop button is only ${px.stop}px — the target is too small to hit`);
  note(px.stopGlyph < px.prevIcon,
       'the stop glyph is not smaller than the transport icons');
  // (what, measured, floor) — the floor is the value it was raised TO, so a
  // half-hearted revert fails as loudly as a full one.
  const floors = [
    ['the track title', px.title, 19], ['the artist', px.artist, 15],
    ['the link', px.link, 15], ['the count', px.count, 14],
    ['the rail label', px.rail, 14], ['the rail count', px.railN, 13],
    ['the sort buttons', px.sort, 14], ['the search box', px.search, 16],
    ['the now-playing title', px.nowTitle, 16], ['the now-playing artist', px.nowArtist, 14],
    ['the rail icon', px.railIcon, 22], ['the row play icon', px.playIcon, 20],
    ['the copy icon', px.copyIcon, 19], ['the prev/next button', px.prev, 50],
    ['the prev/next icon', px.prevIcon, 29], ['the play button', px.toggle, 62],
    ['the play icon', px.toggleIcon, 32], ['the shuffle icon', px.shuffleIcon, 29],
    ['the repeat icon', px.loopIcon, 29], ['the row checkbox', px.check, 27],
  ];
  for (const [what, got, floor] of floors) {
    note(got >= floor, `${what} is ${got}px, and must not go below ${floor}px`);
  }
  note(floors.length >= 20,
       `only ${floors.length} size floors are being checked — the table has been gutted`);
}

/* ---- 8. closing stops the player and LEAVES THE PAGE ALONE -------------
   The reported bug: closing the overlay scrolled to the Idea Vault. It was two
   things at once — every door was handed the vault's last pin as its opener
   whatever had opened it, and the keypad's own focus handler bounced focus to
   box one without preventScroll. Restoring focus therefore walked the page
   down the document. Asserted against where the reader was parked in check 2,
   which is nowhere near the vault. */
{
  await page.click('#musicClose');
  await page.waitForFunction(() => document.getElementById('musicModal').open !== true,
                             { timeout: 5000 });
  const after = await page.evaluate(() => ({
    src: document.getElementById('musicVideo').getAttribute('src'),
    scrollY: Math.round(window.scrollY),
    vaultBoxes: [...document.querySelectorAll('#vault .vault-pin')].map(p => p.value).join(''),
    label: document.getElementById('vaultLabel')?.textContent,
    padlock: document.getElementById('vaultLock')?.dataset.icon,
  }));
  note(after.src === null,
       'the embed still has a src after the overlay closed — sound from nowhere');
  note(after.scrollY === parkedAt,
       `closing the overlay scrolled the page from ${parkedAt} to ${after.scrollY}`);
  note(after.vaultBoxes === '',
       `the Idea Vault keypad shows "${after.vaultBoxes}" after the overlay closed`);
  // The vault relocks when its door shuts. The music overlay was missing the
  // close listener that does it, so the section sat there reading OPEN.
  note(after.label === 'CLASSIFIED',
       `the Idea Vault still reads "${after.label}" after the overlay closed`);
  note(after.padlock === 'lock',
       'the Idea Vault padlock is still undone after the overlay closed');

  /* THE REPORTED BUG, and it is a focus bug rather than a scroll one. relock()
     used to call keypad.reset() unconditionally, which parks focus in the Idea
     Vault's first box after ANY overlay closes. The ` shortcut then correctly
     refuses to fire — something is being typed into — so the next ` went in as
     a CHARACTER, and typing into a focused input the reader cannot see scrolls
     it into view. Hence "tilde jumps me to the Idea Vault", only ever on the
     second press. */
  const parked = await page.evaluate(() => {
    const el = document.activeElement;
    return { inVault: !!el && el.classList.contains('vault-pin'),
             where: el ? (el.id || el.className || el.tagName) : 'none' };
  });
  note(!parked.inVault,
       `focus is parked in the Idea Vault keypad after the overlay closed (${parked.where})`);

  await page.keyboard.press('Backquote');
  const again = await page.evaluate(() => ({
    open: document.getElementById('codeModal').open === true,
    vault: [...document.querySelectorAll('#vault .vault-pin')].map(p => p.value).join(''),
    tilde: [...document.querySelectorAll('#codeModal .vault-pin')].map(p => p.value).join(''),
    scrollY: Math.round(window.scrollY),
  }));
  note(again.open, 'pressing ` after closing an overlay did not reopen the keypad');
  note(again.vault === '', `pressing \` typed "${again.vault}" into the Idea Vault instead`);
  note(again.tilde === '', `pressing \` typed "${again.tilde}" into the keypad it opened`);
  note(again.scrollY === parkedAt,
       `pressing \` a second time scrolled the page to ${again.scrollY}, not ${parkedAt}`);

  await page.keyboard.press('Backquote');   // the same key closes it
  await page.waitForFunction(() => document.getElementById('codeModal').open !== true,
                             { timeout: 5000 });
}

/* ---- 8b. play from idle serves a different track each time -------------
   Not a probabilistic check: startFresh() excludes the track music-last names,
   so two fresh plays in a row MUST differ. Reported as "it keeps playing the
   same song" — the first version resumed the last track on purpose, which in a
   shuffled list of 311 reads as a broken button rather than as a bookmark. */
{
  const spin = async () => {
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('music:open', { detail: {} })));
    await page.waitForFunction(() => document.getElementById('musicModal').open === true,
                               { timeout: 5000 });
    await page.waitForFunction(() => document.getElementById('musicBar').hidden === false,
                               { timeout: 5000 });
    await page.click('#musicToggle');
    await page.waitForFunction(
      () => document.querySelectorAll('#musicRows .music-row.is-playing').length === 1,
      { timeout: 5000 });
    const v = await page.evaluate(() =>
      document.querySelector('#musicRows .music-row.is-playing').dataset.v);
    await page.click('#musicClose');
    await page.waitForFunction(() => document.getElementById('musicModal').open !== true,
                               { timeout: 5000 });
    return v;
  };
  const first = await spin();
  const second = await spin();
  note(first !== second,
       `play from idle served ${first} twice running — it must not repeat the last track`);

  /* Shuffle OFF is the one case that is not random. Someone who turned shuffle
     off and pressed play is asking for the top of the list, not a surprise. */
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('music:open', { detail: {} })));
  await page.waitForFunction(() => document.getElementById('musicModal').open === true,
                             { timeout: 5000 });
  await page.click('#musicShuffle');
  note(await page.evaluate(() =>
       document.getElementById('musicShuffle').getAttribute('aria-pressed') === 'false'),
       'clicking shuffle did not turn it off');
  await page.click('#musicToggle');
  await page.waitForFunction(
    () => document.querySelectorAll('#musicRows .music-row.is-playing').length === 1,
    { timeout: 5000 });
  note(await page.evaluate(() => {
         const rows = [...document.querySelectorAll('#musicRows .music-row')];
         return rows.indexOf(document.querySelector('.music-row.is-playing')) === 0;
       }), 'with shuffle off, play from idle did not start at the top of the list');
  await page.click('#musicShuffle');   // leave it as it was found

  /* ---- and the X closes the overlay. It used to put the bar away, which is
     not a thing that can happen now the bar is permanent, so it was left doing
     nothing anyone could see. */
  await page.click('#musicStop');
  const closed = await page.evaluate(() => ({
    open: document.getElementById('musicModal').open === true,
    src: document.getElementById('musicVideo').getAttribute('src'),
  }));
  note(!closed.open, 'the X in the player bar does not close the overlay');
  note(closed.src === null, 'closing with the X left the embed holding a src');
}

/* ---- 9. the keypad flash ------------------------------------------------
   THE BUG: opening the notes with a code already in hand showed the password
   keypad for the length of the unlock round trip. Asserted SYNCHRONOUSLY —
   the gate is hidden before open() reaches its first await, so this reads the
   exact frame the bug used to be visible in. Nothing here needs the server:
   what is being checked is what is on screen while the answer is pending. */
{
  const withCode = await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('notes:open', { detail: { code: 'MUSIC' } }));
    return {
      open: document.getElementById('notesModal').open,
      gateHidden: document.getElementById('notesGate').hidden,
      waitShown: document.getElementById('notesWait').hidden === false,
    };
  });
  note(withCode.open, 'notes:open with a code did not open the overlay');
  note(withCode.gateHidden,
       'THE FLASH IS BACK: the keypad is on screen while a code in hand is being checked');
  note(withCode.waitShown, 'nothing stands in for the keypad while the code is checked');

  // ...and once the code turns out to be wrong (there is no server here), the
  // keypad has to come back, or the overlay is a dead end.
  await page.waitForFunction(
    () => document.getElementById('notesGate').hidden === false, { timeout: 15000 })
    .then(() => note(true, ''))
    .catch(() => note(false, 'the keypad never came back after the silent try failed'));
  note(await page.evaluate(() => document.getElementById('notesWait').hidden),
       'the UNLOCKING stand-in is still up alongside the keypad');

  await page.evaluate(() => document.getElementById('notesModal').close());

  // The other half: with NO code and NO token, the keypad is what should be
  // there immediately. Hiding it in that case would be the opposite bug.
  const bare = await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('notes:open', { detail: {} }));
    return { gateHidden: document.getElementById('notesGate').hidden,
             waitShown: document.getElementById('notesWait').hidden === false };
  });
  note(!bare.gateHidden, 'opening the notes with no code hides the keypad it needs to show');
  note(!bare.waitShown, 'UNLOCKING is shown when there is nothing to unlock with');
  await page.evaluate(() => document.getElementById('notesModal').close());
}

/* Every 404 this run produced, named. The notes unlock is the only one that is
   supposed to happen — anything else is a real missing file that the blanket
   console filter above would otherwise have swallowed. */
{
  const unexpected = [...new Set(notFound)].filter(p => p !== '/api/notes/unlock');
  note(unexpected.length === 0, `unexpected 404(s): ${unexpected.join(', ')}`);
  note(notFound.includes('/api/notes/unlock'),
       'the notes unlock was never attempted — check 9 did not exercise the silent try');
}

await browser.close();
server.close();

/* Assert the size of the run itself. A harness that stopped reaching its
   subject would drop checks silently and still print a green total — the
   failure this repo has shipped four times. */
const TOTAL = pass + fail.length;
if (TOTAL < 120) {
  console.error(`music_check: only ${TOTAL} checks ran — the harness has lost its subject`);
  process.exit(1);
}

if (fail.length) {
  console.error(`\nmusic_check: ${fail.length} of ${TOTAL} FAILED`);
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nmusic_check: ${pass} checks passed over ${manifest.count} tracks `
            + `(${embedRequests} embed request(s) intercepted)`);
