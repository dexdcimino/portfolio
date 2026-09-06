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

/* The overlay's own X DOCKS whenever a track is playing — that is the feature,
   not a bug — so a check that wants it properly shut has to use the bar's X,
   which is the one control that means stop. Works from either state. */
const shutMusic = async () => {
  await page.click('#musicStop');
  await page.waitForFunction(() => document.getElementById('musicModal').open !== true,
                             { timeout: 5000 });
};

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  // The Top Picks player is driven for real in check 8d, and a scripted click
  // is not a user gesture — without this the <audio> refuses to start and the
  // hand-off check would pass against a player that never played.
  args: ['--no-first-run', '--no-default-browser-check', '--mute-audio',
         '--autoplay-policy=no-user-gesture-required'],
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
  if (/youtube|ytimg|ERR_|net::/i.test(text)) return;
  if (/Failed to load resource/i.test(text)) return;
  fail.push(`console: ${text}`);
});
// Nothing in this harness should reach the network, and a YouTube request that
// hangs would only make it slow. Refuse them and count them instead.
let embedRequests = 0;
await page.setRequestInterception(true);
page.on('request', (req) => {
  // ytimg is the thumbnail host the docked bar's artwork comes from.
  if (/youtube(-nocookie)?\.com|ytimg\.com/.test(req.url())) { embedRequests++; req.abort().catch(() => {}); return; }
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
      loop: document.getElementById('musicLoop').dataset.loop,
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
  /* And repeat defaults to the whole playlist: reaching the end of a list you
     put on deliberately and having it stop is not what pressing play means. */
  note(rest.loop === 'all',
       `repeat defaults to "${rest.loop}" in a browser that has never set it`);
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

/* ---- 4. the five columns, and the two thin ones are square ---------------
   FALSELY PASSES IF: only the cells' existence were checked. The brief is a
   grid that lines up down the whole list, so what is measured is the LEFT
   EDGE of each column on a short-titled row and a long-titled one — a column
   that tracks its content instead of the grid drifts between them.

   THE FLAG CELL IS COUNTED HERE EVEN THOUGH IT IS EMPTY, and that is the point
   of it: the mark is hidden on a row that plays, but the CELL is always in the
   grid. Were it added only when a track failed, the first failure would
   re-lay-out all 311 rows under whoever was reading them. */
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
        flag: box(row.querySelector('.music-flagcell')),
        hasLink: !!row.querySelector('a.music-link')?.href,
        hasCopy: !!row.querySelector('.music-copy'),
        hasFlag: !!row.querySelector('.music-flag'),
        flagShown: row.querySelector('.music-flag')?.hidden === false,
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

  note(geo.short.cells === 5, `a row has ${geo.short.cells} cells, expected 5`);
  note(geo.short.hasLink && geo.short.hasCopy, 'the link cell is missing its link or its copy button');
  note(geo.short.hasFlag && geo.long.hasFlag, 'the flag column has no button in it');
  // Nothing in the shipped list has failed for THIS browser, so every flag must
  // be down. A mark that is on by default is a mark nobody will ever read.
  note(!geo.short.flagShown && !geo.long.flagShown,
       'a flag is showing on a track that has never failed');

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
  note(geo.short.flag.x === geo.long.flag.x,
       `the flag column moves between rows (${geo.short.flag.x} vs ${geo.long.flag.x})`);
  note(geo.short.flag.w >= 20,
       `the flag column is ${geo.short.flag.w}px wide — too narrow to hit`);

  // The brief: the name big and bold, the artist under it.
  note(Number(geo.short.titleWeight) >= 600,
       `the title is not bold (font-weight ${geo.short.titleWeight})`);
  note(geo.short.titleSize > geo.short.artistSize,
       `the title (${geo.short.titleSize}px) is not larger than the artist (${geo.short.artistSize}px)`);

  // Left to right: tick, play, title, link, flag. Asserted rather than assumed
  // — the brief puts the flag at the FAR RIGHT, past the link.
  const order = [geo.short.check.x, geo.short.play.x, geo.short.title.x,
                 geo.short.link.x, geo.short.flag.x];
  note(order.every((v, i) => i === 0 || v > order[i - 1]),
       `the columns are not in the order tick, play, title, link, flag: ${order.join(' < ')}`);
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
  await shutMusic();
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
  /* The cycle is asserted as a ROTATION rather than a fixed string, because
     where it starts is a preference now — repeat defaults to the whole playlist
     and is remembered. What must hold is the order and that it comes back. */
  const ORDER = ['off', 'all', 'one'];
  const from = ORDER.indexOf(seen[0].state);
  const want = [0, 1, 2, 3].map(i => ORDER[(from + i) % 3]);
  note(from !== -1, `the repeat button starts in an unknown state "${seen[0].state}"`);
  note(seen.map(s => s.state).join(',') === want.join(','),
       `the repeat button cycles ${seen.map(s => s.state).join(',')}, expected ${want.join(',')}`);
  // The 1 badge belongs to repeat-one and to nothing else, in every state.
  for (const s of seen) {
    note((s.badge === 1) === (s.state === 'one'),
         `the 1 badge reads ${s.badge} while repeat is "${s.state}"`);
  }
  note(new Set(seen.slice(0, 3).map(s => s.label)).size === 3,
       'the three repeat states do not have three different labels');
}

/* ---- 7b2. volume behaves like every other volume on this site ---------
   Reused rather than reimplemented: the input carries .player-range, the same
   class the songs bar and the clips player use, so the painted track, the 22px
   hit area behind a 5px bar and the white thumb come with it. What is checked
   here is the behaviour that is this overlay's own — the mute round trip, the
   painted fill, and that it survives the overlay closing.

   FALSELY PASSES IF: only the input's value were read. The fill is a CSS
   custom property the shared rules paint from, and a value that moves without
   it is a slider that does not look like it moved. */
{
  const shape = await page.evaluate(() => {
    const vol = document.getElementById('musicVol');
    const mute = document.getElementById('musicMute');
    const loop = document.getElementById('musicLoop');
    const mid = (el) => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; };
    return {
      exists: !!vol && !!mute,
      shared: vol.classList.contains('player-range'),
      type: vol.type, max: vol.max,
      value: Number(vol.value),
      fill: vol.style.getPropertyValue('--fill'),
      icon: mute.querySelector('.icon').dataset.icon,
      label: mute.getAttribute('aria-label'),
      rightOfRepeat: mid(vol) > mid(loop) && mid(mute) > mid(loop),
      wide: Math.round(vol.getBoundingClientRect().width),
    };
  });
  note(shape.exists, 'the music overlay has no volume control');
  note(shape.shared,
       'the volume slider does not use the site .player-range — it is a second copy');
  note(shape.type === 'range' && shape.max === '100',
       'the volume control is not a 0-100 range input');
  note(shape.rightOfRepeat, 'the volume control is not to the right of the repeat button');
  note(shape.wide >= 60, `the volume track is only ${shape.wide}px wide`);
  // The site default everywhere else is 0.4, and this is a browser that has
  // never set it.
  note(shape.value === 40, `volume starts at ${shape.value}, the site default is 40`);
  note(shape.fill.trim() === '40%', `the track is painted to "${shape.fill}", not 40%`);
  note(shape.icon === 'volume', `the speaker shows "${shape.icon}" while unmuted`);

  // Drag it somewhere, then mute, then unmute: unmuting has to come back to
  // where it was and not to the default, which would be a second surprise.
  await page.evaluate(() => {
    const vol = document.getElementById('musicVol');
    vol.value = 70;
    vol.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const moved = await page.evaluate(() => ({
    value: Number(document.getElementById('musicVol').value),
    fill: document.getElementById('musicVol').style.getPropertyValue('--fill').trim(),
  }));
  note(moved.value === 70 && moved.fill === '70%',
       `moving the slider left it at ${moved.value} / "${moved.fill}"`);

  await page.click('#musicMute');
  const muted = await page.evaluate(() => ({
    value: Number(document.getElementById('musicVol').value),
    fill: document.getElementById('musicVol').style.getPropertyValue('--fill').trim(),
    icon: document.getElementById('musicMute').querySelector('.icon').dataset.icon,
    label: document.getElementById('musicMute').getAttribute('aria-label'),
  }));
  note(muted.value === 0, `muting left the slider at ${muted.value}`);
  note(muted.fill === '0%', `muting left the track painted to "${muted.fill}"`);
  note(muted.icon === 'volume-mute', `the speaker shows "${muted.icon}" while muted`);
  note(muted.label === 'Unmute', `the muted button still reads "${muted.label}"`);

  await page.click('#musicMute');
  const back = await page.evaluate(() => ({
    value: Number(document.getElementById('musicVol').value),
    icon: document.getElementById('musicMute').querySelector('.icon').dataset.icon,
  }));
  note(back.value === 70, `unmuting went to ${back.value}, not back to 70`);
  note(back.icon === 'volume', 'unmuting did not put the speaker back');

  // ...and it is remembered, like every other volume on the site.
  await shutMusic();
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('music:open', { detail: {} })));
  await page.waitForFunction(() => document.getElementById('musicModal').open === true,
                             { timeout: 5000 });
  const kept = await page.evaluate(() => Number(document.getElementById('musicVol').value));
  note(kept === 70, `volume came back as ${kept} after reopening, not 70`);
}

/* ---- 7b3. the seek row is above the transport and has real width ------
   The recorded scar this guards: on the songs bar up the page, five groups on
   one line gave the scrub the same width as the VOLUME slider — about 50px for
   a three-minute track. It is not a sizing bug to patch, it is a layout that
   cannot give a scrubber room, and the fix was its own row. So what is checked
   is not that a scrub exists but that it got the row: above the play button,
   and far wider than the volume control it used to lose to.

   FALSELY PASSES IF: only presence and class were checked. A 50px scrub passes
   every one of those. */
{
  const seek = await page.evaluate(() => {
    const box = (sel) => { const r = document.querySelector(sel).getBoundingClientRect();
      return { x: r.left, w: r.width, top: r.top, bottom: r.bottom,
               mid: r.left + r.width / 2 }; };
    const scrub = document.getElementById('musicScrub');
    return {
      exists: !!scrub,
      shared: scrub.classList.contains('player-range'),
      type: scrub.type, max: scrub.max,
      s: box('#musicScrub'), v: box('#musicVol'),
      play: box('#musicToggle'), bar: box('#musicBar'),
      elapsed: document.getElementById('musicElapsed').textContent,
      duration: document.getElementById('musicDuration').textContent,
      tabular: getComputedStyle(document.getElementById('musicElapsed')).fontVariantNumeric,
      fill: scrub.style.getPropertyValue('--fill').trim(),
    };
  });
  note(seek.exists, 'the music overlay has no seek control');
  note(seek.shared,
       'the scrub does not use the site .player-range — it is a second copy');
  note(seek.type === 'range' && seek.max === '1000',
       'the scrub is not a 0-1000 range input');
  // ABOVE the play button, which is what "its own row" means geometrically.
  note(seek.s.bottom <= seek.play.top + 1,
       `the scrub overlaps the transport (bottom ${Math.round(seek.s.bottom)} vs play top ${Math.round(seek.play.top)})`);
  // ...and centred over it, which follows from the row spanning the bar.
  note(Math.abs(seek.s.mid - seek.bar.mid) <= 2,
       `the seek row is ${Math.round(seek.s.mid - seek.bar.mid)}px off the centre of the bar`);
  // THE SCAR: it must not be volume-slider-sized.
  note(seek.s.w > seek.v.w * 4,
       `the scrub is ${Math.round(seek.s.w)}px against a ${Math.round(seek.v.w)}px volume slider`);
  note(seek.s.w > seek.bar.w * 0.6,
       `the scrub is only ${Math.round(seek.s.w)}px of a ${Math.round(seek.bar.w)}px bar`);
  // Idle: a clock with nothing to say says so, rather than showing 0:00 / 0:00.
  note(seek.duration === '--:--' || /\d/.test(seek.duration),
       `the duration reads "${seek.duration}"`);
  note(/tabular-nums/.test(seek.tabular),
       'the times are not tabular figures — the seconds will nudge the track');

  // Dragging paints the track, which is the half a value change alone does not do.
  await page.evaluate(() => {
    const s = document.getElementById('musicScrub');
    s.value = 500;
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  note(await page.evaluate(() =>
       document.getElementById('musicScrub').style.getPropertyValue('--fill').trim() === '50%'),
       'moving the scrub did not paint its track');

  // A new track clears the old one's clock rather than leaving it under the
  // new title until the embed's first message lands.
  await page.evaluate(() =>
    document.querySelectorAll('#musicRows .music-row')[9].querySelector('.music-play').click());
  const fresh = await page.evaluate(() => ({
    elapsed: document.getElementById('musicElapsed').textContent,
    duration: document.getElementById('musicDuration').textContent,
    value: Number(document.getElementById('musicScrub').value),
    fill: document.getElementById('musicScrub').style.getPropertyValue('--fill').trim(),
  }));
  note(fresh.elapsed === '0:00' && fresh.duration === '--:--',
       `a new track kept the old clock (${fresh.elapsed} / ${fresh.duration})`);
  note(fresh.value === 0 && fresh.fill === '0%',
       `a new track kept the old scrub position (${fresh.value} / "${fresh.fill}")`);
}

/* ---- 7c. the PLAY BUTTON is centred in the bar -------------------------
   Asserting the GROUP is the weaker half and it hid a real fault: with the
   order prev, play, next, shuffle, repeat, the group is centred while the play
   button sits 65px left of centre, because the two modes hang off one end.
   Nothing noticed until the scrub had to be centred above the play button.

   So the button is what is measured, and the symmetry that makes it true is
   asserted next to it — shuffle, prev, PLAY, next, repeat. Measured again with
   a long title in the corner, which is what a flex row would drift on. */
{
  const centre = await page.evaluate(async () => {
    const mid = (el) => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; };
    const bar = document.getElementById('musicBar');
    const group = document.querySelector('.music-transport');
    const play = document.getElementById('musicToggle');
    const scrub = document.getElementById('musicScrub');
    const now = document.getElementById('musicNowTitle');

    const shortGroup = Math.round(mid(group) - mid(bar));
    const shortPlay = Math.round(mid(play) - mid(bar));
    const before = now.textContent;
    now.textContent = 'A title very much longer than the one that was there before it';
    await new Promise(r => requestAnimationFrame(r));
    const longPlay = Math.round(mid(play) - mid(bar));
    now.textContent = before;
    return {
      shortGroup, shortPlay, longPlay,
      overScrub: Math.round(mid(play) - mid(scrub)),
      order: [...group.children].map(el => el.id || el.className),
    };
  });
  note(Math.abs(centre.shortGroup) <= 2,
       `the transport group sits ${centre.shortGroup}px off the centre of the bar`);
  note(Math.abs(centre.shortPlay) <= 2,
       `the PLAY button sits ${centre.shortPlay}px off the centre of the bar`);
  note(Math.abs(centre.overScrub) <= 2,
       `the play button sits ${centre.overScrub}px off the centre of the scrub above it`);
  note(centre.shortPlay === centre.longPlay,
       `the play button moves ${Math.abs(centre.longPlay - centre.shortPlay)}px when the title grows`);
  // The symmetry is the reason the button lands where it does, so it is stated
  // rather than left to be re-derived from a pixel measurement next time.
  note(centre.order.join(',') === 'musicShuffle,musicPrev,musicToggle,musicNext,musicLoop',
       `the transport order is ${centre.order.join(',')} — it must be symmetric about the play button`);
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
  await shutMusic();
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
    await shutMusic();
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

/* ---- 8c. closing with music playing DOCKS it ---------------------------
   The brief: close the list, keep the music, carry on reading the site, and
   come back without typing the code again.

   The implementation is close()+show() on the SAME dialog and that is forced,
   not chosen. Moving a cross-origin <iframe> in the DOM reloads it, so a
   second bar elsewhere would restart the track on every open and close; and a
   modal dialog makes the page inert, which is the exact thing that has to
   stop. So the checks here are: the element never reloads, the page is left
   interactive, and the overlay comes back.

   FALSELY PASSES IF: only `open` and the class were read. A dialog can be
   marked docked while the iframe silently reloaded underneath it, which is the
   failure this shape exists to avoid — so the src and the load count are
   asserted too. */
{
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('music:open', { detail: {} })));
  await page.waitForFunction(() => document.getElementById('musicModal').open === true,
                             { timeout: 5000 });
  await page.waitForFunction(
    () => document.querySelectorAll('#musicRows .music-row').length > 0, { timeout: 10000 });

  // Start something, then watch the frame for any navigation at all.
  await page.evaluate(() =>
    document.querySelectorAll('#musicRows .music-row')[6].querySelector('.music-play').click());
  await page.waitForFunction(
    () => document.querySelectorAll('#musicRows .music-row.is-playing').length === 1,
    { timeout: 5000 });
  /* The counter starts AFTER the frame has settled. YouTube is unreachable
     from here, and the aborted navigation fires a load event of its own —
     counted from the click, that lands in the middle of the dock and reads as
     a reload that never happened. Verified with a same-origin frame in
     .notes-dev/probe.mjs: close()+show() keeps the inner window alive and
     fires nothing. */
  const before = await page.evaluate(async () => {
    const f = document.getElementById('musicVideo');
    window.__ytLoads = 0;
    f.addEventListener('load', () => { window.__ytLoads++; });
    await new Promise(r => setTimeout(r, 500));
    window.__ytLoads = 0;                       // whatever the abort did, it is done
    return { src: f.getAttribute('src'),
             v: document.querySelector('.music-row.is-playing').dataset.v };
  });

  // Close the LIST. The music must not go with it.
  await page.click('#musicClose');
  await page.waitForFunction(() => document.getElementById('musicModal')
                                     .classList.contains('is-docked'), { timeout: 5000 });
  const docked = await page.evaluate(() => ({
    open: document.getElementById('musicModal').open,
    barHidden: document.getElementById('musicBar').hidden,
    src: document.getElementById('musicVideo').getAttribute('src'),
    loads: window.__ytLoads,
    scrollLocked: document.body.classList.contains('modal-open'),
    listShown: document.getElementById('musicBody')
      ? true : getComputedStyle(document.querySelector('.music-body')).display !== 'none',
    expandShown: document.getElementById('musicExpand').hidden === false,
    playing: document.querySelectorAll('#musicRows .music-row.is-playing').length,
  }));
  note(docked.open, 'closing the overlay with music playing closed it outright');
  note(docked.src === before.src,
       'the embed was re-pointed while docking — the track would restart');
  note(docked.loads === 0,
       `the frame navigated ${docked.loads} time(s) while docking — the track restarts`);
  note(!docked.barHidden, 'the docked bar is not showing');
  note(docked.expandShown, 'the expand tab is not showing on the docked bar');
  note(!docked.listShown, 'the docked bar is still showing the whole list');
  note(docked.playing === 1, 'the docked player lost the track it was playing');
  // A non-modal dialog is not an overlay: the page has to be usable again.
  note(!docked.scrollLocked, 'the page is still scroll-locked behind the docked bar');

  /* THE SCROLL FIX. Compositing a live cross-origin video surface over a
     scrolling page costs a frame — confirmed by hiding this one element in
     devtools, which made the scroll and the hero's bob smooth again with the
     audio untouched. So the picture is stood down while docked and the
     artwork stands in.

     display:none is the assertion, not `hidden` or opacity: those still
     composite, which is the whole cost. And the iframe must keep its src —
     standing the PICTURE down is not stopping the player. */
  const shown = await page.evaluate(() => {
    const f = document.getElementById('musicVideo');
    const t = document.getElementById('musicThumb');
    return {
      video: getComputedStyle(f).display,
      videoSrc: f.getAttribute('src'),
      thumb: getComputedStyle(t).display,
      thumbSrc: t.getAttribute('src') || '',
      thumbBox: Math.round(t.getBoundingClientRect().width),
    };
  });
  note(shown.video === 'none',
       `the video is "${shown.video}" while docked — a live video surface over a `
       + 'scrolling page is what makes it catch');
  note(shown.videoSrc === before.src,
       'standing the picture down also dropped the embed — that stops the audio');
  note(shown.thumb === 'block', `the artwork is "${shown.thumb}" in the docked bar`);
  note(shown.thumbSrc.includes(before.v),
       `the artwork does not name the track that is playing (${shown.thumbSrc.slice(0, 60)})`);
  note(shown.thumbBox > 60, `the artwork is only ${shown.thumbBox}px wide`);

  /* The page really is interactive: the ` shortcut is the strictest test of it,
     because it refuses to fire while ANY overlay is up. */
  const scrolled = await page.evaluate(() => {
    window.scrollTo({ top: 1200, behavior: 'instant' });
    return Math.round(window.scrollY);
  });
  note(scrolled > 900, `the page would not scroll behind the docked bar (${scrolled})`);
  /* Nothing in the docked bar may be holding focus. The overlay's X goes
     display:none as it docks, and the browser then hands focus to the next
     focusable thing in the bar — the scrub or the volume slider, both <input>,
     which makes the ` shortcut refuse to fire. */
  const held = await page.evaluate(() => {
    const el = document.activeElement;
    return el && document.getElementById('musicModal').contains(el)
      ? `${el.tagName}#${el.id}` : null;
  });
  note(held === null, `the docked bar is still holding focus on ${held}`);
  await page.keyboard.press('Backquote');
  note(await page.evaluate(() => document.getElementById('codeModal').open === true),
       'the ` shortcut is swallowed while the bar is docked');
  await page.keyboard.press('Backquote');
  await page.waitForFunction(() => document.getElementById('codeModal').open !== true,
                             { timeout: 5000 });

  // ...and another overlay opening must not take the music with it.
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent('notes:open', { detail: {} })));
  await page.waitForFunction(() => document.getElementById('notesModal').open === true,
                             { timeout: 5000 });
  const survived = await page.evaluate(() => ({
    stillDocked: document.getElementById('musicModal').classList.contains('is-docked')
                 && document.getElementById('musicModal').open,
    src: document.getElementById('musicVideo').getAttribute('src'),
  }));
  note(survived.stillDocked, 'opening another overlay closed the docked music bar');
  note(survived.src === before.src, 'opening another overlay restarted the music');
  /* Closing that overlay must give the scroll back rather than leave it locked
     on the docked bar's account. WAITED for, not read: a dialog's close event
     is queued, so reading the class on the next line reads it before the
     handler that clears it has run. */
  await page.evaluate(() => document.getElementById('notesModal').close());
  await page.waitForFunction(() => !document.body.classList.contains('modal-open'),
                             { timeout: 5000 })
    .then(() => note(true, ''))
    .catch(() => note(false,
      'the page stayed scroll-locked after an overlay closed over the docked bar'));

  /* THE EXPAND TAB. A triangle out of the top edge, over the duration, and it
     puts the list back with no code asked for. */
  const tab = await page.evaluate(() => {
    const b = document.getElementById('musicExpand');
    const r = b.getBoundingClientRect();
    const shell = document.querySelector('.music-shell').getBoundingClientRect();
    const dur = document.getElementById('musicDuration').getBoundingClientRect();
    // The BUTTON is the hit area; the triangle is its ::before. They are
    // measured separately because they are deliberately different sizes.
    const cs = getComputedStyle(b);
    const mark = getComputedStyle(b, '::before');
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      markW: parseFloat(mark.width), markH: parseFloat(mark.height),
      offCentre: Math.round((r.left + r.width / 2) - (dur.left + dur.width / 2)),
      abovePanel: Math.round(shell.top - r.top),
      clipped: mark.clipPath,
      buttonClipped: cs.clipPath,
      origin: mark.transformOrigin,
      tip: b.dataset.tip,
      pos: b.dataset.tipPos,
    };
  });
  /* THE TARGET and THE TRIANGLE are different sizes on purpose. clip-path
     clips hit testing as well as paint, so a button that WAS the triangle could
     only be hit on the triangle — 22x10 of slanted edges, which is a pain to
     land on. The mark stays small; the box around it does not. */
  note(tab.markW >= 18 && tab.markH >= 8,
       `the triangle is only ${tab.markW}x${tab.markH}`);
  note(tab.markW <= 26 && tab.markH <= 12,
       `the triangle has grown back to ${tab.markW}x${tab.markH}`);
  note(tab.w >= 40 && tab.h >= 28,
       `the expand target is only ${tab.w}x${tab.h} — too fiddly to hit`);
  note(tab.w >= tab.markW * 1.7 && tab.h >= tab.markH * 2.5,
       `the target (${tab.w}x${tab.h}) is barely bigger than the triangle `
       + `(${tab.markW}x${tab.markH})`);
  note(!/polygon/.test(tab.buttonClipped),
       'the button itself is clipped to the triangle again — only the mark may be');
  /* ABOVE, not below. The bar lives on the bottom edge of the window, so the
     default below-placement puts the bubble off-screen and the fallback fires
     every time — a tooltip that is sometimes above and sometimes below reads
     as a bug. data-tip-pos="above" is the existing opt-in for exactly this. */
  note(tab.pos === 'above',
       `the expand tooltip is placed "${tab.pos || 'below'}" — it must be above the tab`);
  note(Math.abs(tab.offCentre) <= 3,
       `the expand tab sits ${tab.offCentre}px off the centre of the duration`);
  note(tab.abovePanel > 0, 'the expand tab does not stick out above the bar');
  note(/polygon/.test(tab.clipped), 'the expand tab is not a triangle');
  /* It grows UPWARD out of the border on hover, so the origin is its base.
     Compared as numbers: getComputedStyle resolves the percentages to px, so
     'bottom' and '100%' never appear in the value however it was authored. */
  const [ox, oy] = tab.origin.trim().split(/\s+/).map(parseFloat);
  note(Math.abs(ox - tab.markW / 2) <= 1 && Math.abs(oy - tab.markH) <= 1,
       `the expand tab scales from ${tab.origin}, not from the middle of its base `
       + `(${tab.markW / 2}px ${tab.markH}px)`);
  note(tab.tip === 'Expand', `the expand tab's tooltip reads "${tab.tip}"`);

  /* THE BAR IS ONE WIDTH. It was growing and shrinking with every track,
     because a <dialog> is width:fit-content in the UA stylesheet and the auto
     width resolved against the content rather than the gap. A control surface
     that changes size when the thing it is controlling changes is the one thing
     this must never do.

     FALSELY PASSES IF: two ordinary titles were compared. They both fit, so the
     width would match whatever the rule was — which is why the long one is
     asserted to actually OVERFLOW its column before the widths are compared. */
  const width = await page.evaluate(async () => {
    const shell = document.querySelector('.music-shell');
    const t = document.getElementById('musicNowTitle');
    const a = document.getElementById('musicNowArtist');
    const keep = { t: t.textContent, a: a.textContent };
    const read = () => Math.round(shell.getBoundingClientRect().width);
    const frame = () => new Promise(r => requestAnimationFrame(r));

    t.textContent = 'Hi'; a.textContent = 'Yo';
    await frame();
    const short = read();

    t.textContent = 'A Preposterously Long Track Title Nobody Would Ever Give A Song';
    a.textContent = 'And An Equally Preposterous Artist Name Of Considerable Length';
    await frame();
    const long = read();
    const overflowed = t.scrollWidth > t.clientWidth;
    const clip = getComputedStyle(t).textOverflow;
    const inside = t.getBoundingClientRect().right <= shell.getBoundingClientRect().right;

    t.textContent = keep.t; a.textContent = keep.a;
    await frame();
    return { short, long, overflowed, clip, inside };
  });
  note(width.overflowed,
       'the long title did not overflow its column — the width check proves nothing');
  note(width.short === width.long,
       `the docked bar is ${width.short}px on a short title and ${width.long}px on a long one`);
  note(width.clip === 'ellipsis', `a clipped title ends with "${width.clip}", not an ellipsis`);
  note(width.inside, 'a long title runs outside the bar instead of being clipped');

  await page.click('#musicExpand');
  await page.waitForFunction(() => {
    const m = document.getElementById('musicModal');
    return m.open && !m.classList.contains('is-docked');
  }, { timeout: 5000 });
  const back = await page.evaluate(() => ({
    rows: document.querySelectorAll('#musicRows .music-row').length,
    src: document.getElementById('musicVideo').getAttribute('src'),
    loads: window.__ytLoads,
    expandShown: document.getElementById('musicExpand').hidden === false,
    playing: document.querySelectorAll('#musicRows .music-row.is-playing').length,
  }));
  note(back.rows > 100, `expanding came back with ${back.rows} rows`);
  note(back.src === before.src, 'expanding re-pointed the embed — the track would restart');
  note(back.loads === 0, `the frame navigated ${back.loads} time(s) across dock and expand`);
  note(!back.expandShown, 'the expand tab is still showing on the full overlay');
  note(back.playing === 1, 'expanding lost the track that was playing');
  /* The real player is one click away, and that is what makes standing it down
     in the corner a reasonable trade: there is no page scrolling behind an open
     overlay for it to compete with. */
  const expanded = await page.evaluate(() => ({
    video: getComputedStyle(document.getElementById('musicVideo')).display,
    thumb: getComputedStyle(document.getElementById('musicThumb')).display,
    src: document.getElementById('musicVideo').getAttribute('src'),
  }));
  note(expanded.video !== 'none', 'the video does not come back when the overlay opens');
  note(expanded.thumb === 'none', 'the artwork is still covering the player in the overlay');
  note(expanded.src === before.src,
       'showing the picture again re-pointed the embed — the track would restart');

  /* THE REPORTED BUG, and it is the invariant worth stating on its own: while a
     track is playing there is ALWAYS a control box on screen — the overlay's,
     or the docked bar's. Never neither.

     Expanding and then closing used to land on neither. 'expand' was a flag
     that had to survive the queued close event, and bindModal skips its onClose
     whenever another dialog is already open — exactly the state expand leaves
     behind — so the flag was never cleared and the NEXT close read a stale
     'expand' and did nothing at all. Music playing, no bar, no way back. */
  await page.click('#musicClose');
  await page.waitForFunction(() => document.getElementById('musicModal')
                                     .classList.contains('is-docked'), { timeout: 5000 })
    .then(() => note(true, ''))
    .catch(() => note(false,
      'closing again after expanding did not dock — the music plays with no bar'));
  const again = await page.evaluate(() => ({
    open: document.getElementById('musicModal').open,
    docked: document.getElementById('musicModal').classList.contains('is-docked'),
    barHidden: document.getElementById('musicBar').hidden,
    expandShown: document.getElementById('musicExpand').hidden === false,
    src: document.getElementById('musicVideo').getAttribute('src'),
    loads: window.__ytLoads,
  }));
  note(again.open && again.docked && !again.barHidden,
       'the second close left no control box on screen while a track was playing');
  note(again.expandShown, 'the expand tab is missing after the second dock');
  note(again.src === before.src, 'the second dock re-pointed the embed');
  note(again.loads === 0,
       `the frame navigated ${again.loads} time(s) across dock, expand and dock again`);

  // ...and the cycle has to keep working, not just survive one lap.
  await page.click('#musicExpand');
  await page.waitForFunction(() => {
    const m = document.getElementById('musicModal');
    return m.open && !m.classList.contains('is-docked');
  }, { timeout: 5000 })
    .then(() => note(true, ''))
    .catch(() => note(false, 'the expand tab stopped working on the second lap'));
  await page.click('#musicClose');
  await page.waitForFunction(() => document.getElementById('musicModal')
                                     .classList.contains('is-docked'), { timeout: 5000 })
    .then(() => note(true, ''))
    .catch(() => note(false, 'the third close did not dock'));

  // And the bar's X still ends everything from either state.
  await shutMusic();
  const ended = await page.evaluate(() => ({
    open: document.getElementById('musicModal').open,
    docked: document.getElementById('musicModal').classList.contains('is-docked'),
    src: document.getElementById('musicVideo').getAttribute('src'),
  }));
  note(!ended.open && !ended.docked, 'the bar\'s X did not close the player');
  note(ended.src === null, 'the bar\'s X left the embed holding a src');
}

/* ---- 8d. the two players are two things --------------------------------
   THE REPORTED BUG: play a Top Picks song, pause it, and a track from the
   music playlist started up. It had not started — it had never stopped.

   pause() is a postMessage to another origin with no acknowledgement, and it
   set `playing = false` the moment it was sent. When the message did not land
   the video played on, inaudible under the song; the bus, reading that flag,
   believed it was already paused and never reached it again; and pausing the
   song simply uncovered it. Two things also decoded audio at once, which is
   what a scroll frame was paying for.

   FALSELY PASSES IF: only the flag were read back. What has to be true is that
   the iframe no longer HAS a src — the one state that cannot lie, because
   nothing can play from it. */
{
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('music:open', { detail: {} })));
  await page.waitForFunction(() => document.getElementById('musicModal').open === true,
                             { timeout: 5000 });
  await page.waitForFunction(
    () => document.querySelectorAll('#musicRows .music-row').length > 0, { timeout: 10000 });
  await page.evaluate(() =>
    document.querySelectorAll('#musicRows .music-row')[3].querySelector('.music-play').click());
  await page.click('#musicClose');
  await page.waitForFunction(() => document.getElementById('musicModal')
                                     .classList.contains('is-docked'), { timeout: 5000 });
  const live = await page.evaluate(() => ({
    src: document.getElementById('musicVideo').getAttribute('src'),
    docked: document.getElementById('musicModal').classList.contains('is-docked'),
  }));
  note(!!live.src && live.docked,
       'the music feed did not come up, so the hand-off check would prove nothing');

  /* Start a Top Picks song the way a click does: MediaBus.solo fires off the
     <audio> element's own play event. */
  const started = await page.evaluate(async () => {
    const btn = document.querySelector('.pk-song .pk-play[data-audio]');
    if (!btn) return 'no song button in the page';
    btn.click();
    const audio = document.getElementById('songAudio');
    try { await audio.play(); } catch { /* the click above usually has it going */ }
    await new Promise(r => setTimeout(r, 300));
    return audio.paused ? 'the audio would not start' : 'playing';
  });
  note(started === 'playing', `the Top Picks player did not start (${started})`);

  const after = await page.evaluate(() => ({
    open: document.getElementById('musicModal').open,
    docked: document.getElementById('musicModal').classList.contains('is-docked'),
    src: document.getElementById('musicVideo').getAttribute('src'),
    songPaused: document.getElementById('songAudio').paused,
  }));
  note(!after.open && !after.docked,
       'starting a Top Picks song left the music bar on screen');
  note(after.src === null,
       'starting a Top Picks song left the music embed loaded — it plays on under '
       + 'the song and comes back the moment the song is paused');
  note(!after.songPaused, 'the music hand-off stopped the Top Picks song as well');

  // ...and pausing the song must bring nothing back.
  await page.evaluate(() => document.getElementById('songAudio').pause());
  await new Promise(r => setTimeout(r, 300));
  const paused = await page.evaluate(() => ({
    src: document.getElementById('musicVideo').getAttribute('src'),
    open: document.getElementById('musicModal').open,
  }));
  note(paused.src === null && !paused.open,
       'pausing the Top Picks song brought the music feed back');
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

/* ---- 10. a flag remembered from a previous session ---------------------
   LAST ON PURPOSE. This one RELOADS THE PAGE — that is the point of it, the
   mark is in localStorage precisely so it survives one — and a reload in the
   middle of the run drops every check after it into a fresh session with
   nothing playing. It was written as 4b, beside the column geometry it
   belongs with, and the very next check failed on a button that was no
   longer on screen.
   The mark exists so a track that would not play STAYS marked, and "stays"
   means across a reload — the whole reason it is in localStorage rather than
   in a variable. Seeded here rather than earned, because earning one needs
   YouTube to refuse a real embed and this harness deliberately reaches no
   network. tools/music_flag_check.mjs is the one that earns it.

   FALSELY PASSES IF: only the mark's visibility were checked. It is meant to
   answer "what was this for?" months later, so the TOOLTIP TEXT is read, and
   read for the three things it has to carry: what happened, why, and when. */
{
  const v = manifest.tracks[0].v;
  await page.evaluate((id) => {
    localStorage.setItem('music-flags',
      JSON.stringify([[id, 150, Date.parse('2026-01-15T12:00:00Z')]]));
  }, v);
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });

  /* REOPENED BY THE EVENT, not by typing the code again. Check 2 above is what
     proves the sealed door works and it only needs to prove it once; this
     block is about the mark, and driving the keypad a second time made the run
     flaky twice — Backquote TOGGLES the keypad, so a press whose 5-second wait
     expired on a slow scrypt was closed again by the retry that followed it,
     and the run died on a dialog nobody had asked to shut. */
  const reopened = await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('music:open', { detail: {} }));
    return document.getElementById('musicModal')?.open === true;
  });
  note(reopened, 'the music:open event did not reopen the overlay after the reload');
  const relisted = await page.waitForFunction(
    () => document.querySelectorAll('#musicRows .music-row').length > 0, { timeout: 40000 })
    .then(() => true).catch(() => false);
  note(relisted, 'the track list did not come back after the reload');
  if (!relisted) throw new Error('music_check: cannot check the flag without the list');

  const seen = await page.evaluate((id) => {
    const row = document.querySelector('#musicRows .music-row[data-v="' + id + '"]');
    const btn = row?.querySelector('.music-flag');
    const lit = [...document.querySelectorAll('#musicRows .music-flag')]
      .filter(b => b.hidden === false).length;
    return { found: !!btn, shown: btn?.hidden === false, lit,
             tip: btn?.dataset.tip || '', kind: btn?.dataset.tipKind || '',
             label: btn?.getAttribute('aria-label') || '',
             red: btn ? getComputedStyle(btn).color : '' };
  }, v);

  note(seen.found, 'the flagged track has no flag button at all');
  note(seen.shown, 'a flag stored in localStorage did not survive a reload');
  note(seen.lit === 1, `${seen.lit} flags are lit — exactly one was stored`);
  note(seen.tip.includes('WOULD NOT PLAY'),
       `the flag tooltip does not say what happened: "${seen.tip}"`);
  note(/embed|gone|removed|refused|malformed|play/i.test(seen.tip),
       `the flag tooltip does not say WHY: "${seen.tip}"`);
  note(/2026/.test(seen.tip), `the flag tooltip does not say WHEN: "${seen.tip}"`);
  note(seen.tip.includes('\n'), 'the flag tooltip is one line — the bubble is set up for two');
  note(seen.kind === 'loud', 'the flag tooltip is not the loud kind a warning wants');
  note(seen.label.length > 20, `the flag has no useful accessible name: "${seen.label}"`);
  // Red, not the accent: this is the one mark in the overlay that is not
  // decoration, and an accent would make it another themed tick.
  const rgb = (seen.red.match(/\d+/g) || []).map(Number);
  note(rgb[0] > 180 && rgb[1] < 140 && rgb[2] < 140, `the flag is not red (${seen.red})`);

  /* ...AND THE TOOLTIP HAS TO BE VISIBLE. The overlay is a modal <dialog>, so
     it renders in the top layer, above every z-index on the page — and #tip is
     a div on <body>. A bubble painted behind the thing it labels is the same
     as no bubble, and nothing else in this file hovers a tip inside a dialog. */
  const box = await page.evaluate((id) => {
    const btn = document.querySelector(
      '#musicRows .music-row[data-v="' + id + '"] .music-flag');
    const r = btn.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, v);
  await page.mouse.move(box.x, box.y);
  await page.waitForFunction(() => document.getElementById('tip')?.classList.contains('is-on'),
                             { timeout: 3000 }).catch(() => {});
  const tip = await page.evaluate(() => {
    const t = document.getElementById('tip');
    if (!t) return { on: false, text: '', w: 0, h: 0, inDialog: false };
    const r = t.getBoundingClientRect();
    return { on: t.classList.contains('is-on'), text: t.textContent,
             w: Math.round(r.width), h: Math.round(r.height),
             // The mechanism: parked on <body> it is painted behind the
             // overlay, because a modal dialog is in the top layer.
             inDialog: t.parentElement?.tagName === 'DIALOG' };
  });
  note(tip.on, 'hovering the flag showed no tooltip');
  note(tip.w > 40 && tip.h > 10, `the tooltip has no size (${tip.w}x${tip.h})`);
  note(tip.inDialog, 'the tooltip is still parked outside the dialog it is labelling in');
  note(/WOULD NOT PLAY/.test(tip.text), `the bubble says something else: "${tip.text}"`);

  /* ...AND THAT IT IS ACTUALLY PAINTED. The parent assertion above is the
     mechanism, not the effect, and the effect cannot be read from the DOM:
     elementFromPoint was the first attempt and it can never work here, because
     #tip is pointer-events:none and therefore not hit-testable at all — it
     reported the bubble as covered whether it was or not.

     So: photograph the screen with the bubble up, take it down, photograph
     again. Nothing else on screen is moving — the pointer is held still on the
     flag, so even its hover state is the same in both frames — which makes any
     difference the bubble.

     WHAT THIS HALF DOES NOT CATCH, measured by putting the bug back: a bubble
     parked outside the dialog still tints pixels, because ::backdrop is
     rgba(3,5,7,.9) rather than opaque, so the mis-parented tooltip shows
     through it, dimmed to the point of being unreadable but not to nothing.
     That is what the parent assertion is for, and why both are here. This one
     catches the other failure — a bubble that renders nowhere at all. */
  const shot = () => page.screenshot({ encoding: 'binary' });
  const withTip = await shot();
  await page.evaluate(() => document.getElementById('tip').classList.remove('is-on'));
  // The bubble fades over .13s, so a shot taken straight away catches it
  // half-way and differs for the wrong reason.
  await page.waitForFunction(
    () => Number(getComputedStyle(document.getElementById('tip')).opacity) === 0,
    { timeout: 3000 }).catch(() => {});
  const without = await shot();
  note(!withTip.equals(without),
       'THE TOOLTIP IS BEHIND THE OVERLAY — showing and hiding it changed no pixel '
       + '(a modal dialog renders in the top layer, above every z-index)');
  // Re-shown for the click below, which is what takes the flag off.
  await page.mouse.move(box.x - 200, box.y);
  await page.mouse.move(box.x, box.y);

  // Clicking it takes it off, and that has to persist too — a flag that could
  // only ever be set becomes a column of marks nobody trusts.
  await page.mouse.click(box.x, box.y);
  const cleared = await page.evaluate((id) => ({
    shown: document.querySelector(
      '#musicRows .music-row[data-v="' + id + '"] .music-flag')?.hidden === false,
    stored: JSON.parse(localStorage.getItem('music-flags') || '[]').length,
  }), v);
  note(!cleared.shown, 'clicking the flag did not take it off');
  note(cleared.stored === 0, `the cleared flag is still in storage (${cleared.stored} left)`);

  await shutMusic();
  await page.evaluate(() => { try { localStorage.removeItem('music-flags'); } catch {} });
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
if (TOTAL < 230) {
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
