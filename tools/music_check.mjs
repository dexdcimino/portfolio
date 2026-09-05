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
   open. scrypt at 32 MiB takes a moment, hence the generous timeout. */
{
  await page.keyboard.press('Backquote');
  await page.waitForFunction(() => document.getElementById('codeModal')?.open === true,
                             { timeout: 5000 });
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

/* ---- 5. ticking moves a track into REPEAT, and it survives a reload ------
   FALSELY PASSES IF: only the checkbox's own state were read back. What the
   tick is FOR is the second playlist, so the check is that the rail count
   moves and that the REPEAT view holds exactly the ticked track. */
{
  const ticked = await page.evaluate(() => {
    const row = document.querySelector('#musicRows .music-row');
    const v = row.dataset.v;
    const box = row.querySelector('.music-check');
    box.click();
    return { v, checked: box.checked, railN: document.getElementById('musicNRepeat').textContent };
  });
  note(ticked.checked, 'clicking the tick did not check it');
  note(ticked.railN === '1', `the REPEAT count reads "${ticked.railN}" after one tick`);

  await page.click('#musicViewRepeat');
  const inRepeat = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#musicRows .music-row')];
    return { n: rows.length, v: rows[0]?.dataset.v,
             pressed: document.getElementById('musicViewRepeat').getAttribute('aria-pressed') };
  });
  note(inRepeat.n === 1, `the REPEAT playlist shows ${inRepeat.n} track(s), expected 1`);
  note(inRepeat.v === ticked.v, 'the REPEAT playlist is showing the wrong track');
  note(inRepeat.pressed === 'true', 'the REPEAT rail button does not read as pressed');

  // Untick from inside REPEAT: the row has to leave, or the tick means nothing
  // in the one place it matters most.
  await page.evaluate(() => document.querySelector('#musicRows .music-check').click());
  const emptied = await page.evaluate(() => ({
    n: document.querySelectorAll('#musicRows .music-row').length,
    said: document.getElementById('musicEmpty').hidden === false,
  }));
  note(emptied.n === 0, `unticking inside REPEAT left ${emptied.n} row(s) behind`);
  note(emptied.said, 'an empty REPEAT playlist says nothing at all');

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

/* ---- 8. closing the overlay stops the player --------------------------- */
{
  await page.click('#musicClose');
  await page.waitForFunction(() => document.getElementById('musicModal').open !== true,
                             { timeout: 5000 });
  const after = await page.evaluate(() => ({
    src: document.getElementById('musicVideo').getAttribute('src'),
    barHidden: document.getElementById('musicBar').hidden,
  }));
  note(after.src === null,
       'the embed still has a src after the overlay closed — sound from nowhere');
  note(after.barHidden === true, 'the player bar is still showing after the overlay closed');
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
if (TOTAL < 40) {
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
