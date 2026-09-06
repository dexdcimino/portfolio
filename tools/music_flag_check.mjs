/* Drive the music overlay against a video YouTube will not play.
 *
 *   node tools/music_flag_check.mjs
 *
 * Serves the repo itself. UNLIKE tools/music_check.mjs, this one REACHES
 * YOUTUBE ON PURPOSE -- that is the whole point of it. The bug it exists for
 * cannot be reproduced without a real embed refusing a real video:
 *
 *   An unplayable video posts back {"event":"onError","info":150} and nothing
 *   else, ever. script.js read `info` as a player state, and 150 is not 0, 1
 *   or 2, so every branch fell through: no error, no advance, no message. The
 *   playlist stopped dead on a song that was never going to start. Bohemian
 *   Rhapsody, 2026-09-05, found by listening rather than by any gate here.
 *
 * So this drives the actual failure and asserts the three things that answer
 * it: the player MOVES ON, the track that failed is MARKED, and the mark says
 * WHY. Then it asserts the auto-skip can stop -- a list with nothing playable
 * in it must give up rather than walk itself forever.
 *
 * WHY HTTPS. Same measured reason as tools/music_probe.mjs, and it is not a
 * nicety: over plain http on 127.0.0.1 YouTube refuses EVERY rights-managed
 * video with the same 150 it uses for a dead one, so a good track and a dead
 * track become indistinguishable and this harness would pass while proving
 * nothing. The cert is minted per run and thrown away.
 *
 * THE DEAD IDS ARE IMPOSSIBLE ONES, not real dead videos. "aaaaaaaaaaa" is a
 * well-formed id that has never named anything and never will; a real broken
 * link is a moving target that would turn this check green the day someone
 * fixed it. The GOOD ids are real, because "it played" has to be real.
 *
 * COUNT THE SUBJECT: the number of checks is asserted at the end, and so is
 * the fact that the good control track actually played -- a run where YouTube
 * refused everything would otherwise look exactly like a passing one.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:https';
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

// Real, and checked by tools/music_probe.mjs on every run of it.
const GOOD = [
  { t: 'Bohemian Rhapsody', a: 'Queen', v: 'fJ9rUzIMcZQ' },
  { t: 'Me at the zoo', a: 'jawed', v: 'jNQXAC9IVRw' },
];
// Well-formed, and have never named a video.
const DEAD = [
  { t: 'Nothing At All', a: 'Nobody', v: 'aaaaaaaaaaa' },
  { t: 'Also Nothing', a: 'Nobody', v: 'bbbbbbbbbbb' },
  { t: 'Still Nothing', a: 'Nobody', v: 'ccccccccccc' },
];
const url = (t) => ({ ...t, u: `https://www.youtube.com/watch?v=${t.v}` });

/* Which list the served manifest is, swapped between the two runs below. The
   real 311 are not used: this has to be able to say "every track in the list
   failed", and it must not depend on which of the real ones is broken today. */
let manifest = { count: 0, repeat: 0, tracks: [] };
const serve = (tracks) => {
  manifest = { count: tracks.length, repeat: 0, tracks: tracks.map(url) };
};

const dir = mkdtempSync(join(tmpdir(), 'music-flag-'));
const key = join(dir, 'key.pem'), cert = join(dir, 'cert.pem');
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
} catch {
  throw new Error('openssl is needed to mint the throwaway https cert '
                  + '(it ships with Git for Windows) — see the header for why http will not do');
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.webm': 'video/webm',
};
const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) },
  async (req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    // The one file that is answered from memory rather than from disk.
    if (path === '/assets/music/tracks.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(manifest));
      return;
    }
    const file = resolve(join(ROOT, normalize(path === '/' ? '/index.html' : path)));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404).end('404'); }
  });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `https://localhost:${server.address().port}`;

const fail = [];
let pass = 0;
const note = (ok, why) => { if (ok) pass++; else fail.push(why); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-first-run', '--no-default-browser-check', '--mute-audio',
         '--autoplay-policy=no-user-gesture-required',
         '--ignore-certificate-errors',
         // Without this YouTube answers 150 for every id, good ones included.
         '--disable-blink-features=AutomationControlled'],
  ignoreDefaultArgs: ['--enable-automation'],
});
const page = await browser.newPage();
// A thrown exception inside the overlay would otherwise look like a quiet
// failure to skip, which is the thing this file is trying to tell apart.
page.on('pageerror', e => fail.push(`pageerror: ${e.message}`));
const cdp = await page.createCDPSession();
// Before navigating, always: a headless Chrome on a throwaway profile still
// writes to the REAL Downloads folder otherwise.
await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
await page.setViewport({ width: 1600, height: 1000 });

/* The overlay is behind a scrypt decryption of a blob in the markup, so it is
   opened the way a person opens it: type MUSIC into the tilde keypad. */
async function openMusic() {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await page.keyboard.press('Backquote');
  await page.waitForFunction(() => document.getElementById('codeModal')?.open === true,
                             { timeout: 10000 });
  await page.focus('#codeModal .vault-pin');
  await page.keyboard.type('MUSIC', { delay: 30 });
  await page.waitForFunction(
    () => document.querySelectorAll('#musicRows .music-row').length > 0, { timeout: 40000 });
}

// Click the play button on the row for this video id, as a person would.
async function playRow(v) {
  const box = await page.evaluate((id) => {
    const btn = document.querySelector(
      '#musicRows .music-row[data-v="' + id + '"] .music-play');
    if (!btn) return null;
    btn.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = btn.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, v);
  if (!box) { note(false, `no row for ${v} to press play on`); return false; }
  await page.mouse.click(box.x, box.y);
  return true;
}

const read = () => page.evaluate(() => ({
  now: document.getElementById('musicNowTitle')?.textContent || '',
  sub: document.getElementById('musicNowArtist')?.textContent || '',
  lit: [...document.querySelectorAll('#musicRows .music-flag')]
    .filter(b => b.hidden === false)
    .map(b => b.closest('.music-row').dataset.v),
  stored: (() => { try { return JSON.parse(localStorage.getItem('music-flags') || '[]'); }
                   catch { return []; } })(),
  src: document.getElementById('musicVideo')?.getAttribute('src') || '',
}));

/* ---- 1. a dead track is skipped, marked, and says why -------------------
   The list is ONE dead track and two real ones, and the dead one is the one
   pressed. What has to happen is all three of: the audio moves on, the dead
   row is marked, and the mark explains itself. */
{
  serve([DEAD[0], ...GOOD]);
  await openMusic();

  const started = await playRow(DEAD[0].v);
  note(started, 'the dead track had no row to start');

  // The flag is what says the error was seen at all, so it is what is waited
  // for. Generous: this is a real embed doing a real round trip to YouTube.
  let flagged = true;
  try {
    await page.waitForFunction(
      (id) => document.querySelector('#musicRows .music-row[data-v="' + id + '"] .music-flag')
                ?.hidden === false, { timeout: 45000 }, DEAD[0].v);
  } catch { flagged = false; }
  note(flagged, 'THE DEAD TRACK WAS NEVER FLAGGED — the onError is being swallowed again');

  const after = await read();
  note(after.lit.length === 1 && after.lit[0] === DEAD[0].v,
       `the wrong rows are flagged: ${after.lit.join(', ') || 'none'}`);
  note(after.stored.length === 1 && after.stored[0][0] === DEAD[0].v,
       'the flag was not written to localStorage, so it dies with the tab');
  note(after.stored[0]?.[1] > 0, `no error code was recorded (${after.stored[0]?.[1]})`);

  /* ...and the player MOVED ON. This is the half that was actually noticed:
     the music stopping.

     READ OFF THE BAR, NOT THE IFRAME. The first track of a session navigates
     the frame and every track after it is a loadVideoById command to the
     player already running, so `src` still names the FIRST video for the whole
     session — deliberately, so the gesture that permits sound is not thrown
     away between songs. An earlier version of this check asserted on src and
     reported a skip that had plainly happened as a failure. */
  let moved = true;
  try {
    await page.waitForFunction(
      (dead) => {
        const now = document.getElementById('musicNowTitle')?.textContent || '';
        return now && now !== dead;
      }, { timeout: 30000 }, DEAD[0].t);
  } catch { moved = false; }
  note(moved, 'THE PLAYLIST STOPPED ON THE DEAD TRACK — the auto-skip did not fire');

  const next = await read();
  note(GOOD.some(g => g.t === next.now),
       `the skip did not land on a real track: the bar reads "${next.now}"`);

  // The mark has to answer "what was this for?" months later.
  const tip = await page.evaluate((id) => {
    const b = document.querySelector('#musicRows .music-row[data-v="' + id + '"] .music-flag');
    return { tip: b?.dataset.tip || '', kind: b?.dataset.tipKind || '' };
  }, DEAD[0].v);
  note(tip.tip.includes('WOULD NOT PLAY'), `the mark does not say what happened: "${tip.tip}"`);
  note(/embed|gone|removed|refused|malformed/i.test(tip.tip),
       `the mark does not say why: "${tip.tip}"`);
  note(tip.kind === 'loud', 'the mark is not the loud tooltip a warning wants');

  /* THE CONTROL, and without it every assertion above is satisfiable by a
     browser with no network at all: a run where YouTube refused EVERYTHING
     would skip, flag and move on exactly like this one. So the track it landed
     on has to be heard to actually play. */
  let reallyPlayed = true;
  try {
    await page.waitForFunction(() => {
      const el = document.getElementById('musicElapsed');
      return el && el.textContent !== '0:00' && el.textContent !== '--:--';
    }, { timeout: 45000 });
  } catch { reallyPlayed = false; }
  note(reallyPlayed,
       'THE CONTROL FAILED: the track it skipped to never played either, so this run '
       + 'proves nothing — check the network before reading anything above as a pass');
}

/* ---- 2. a list with nothing playable in it gives up ---------------------
   The other half of an auto-skip: it has to stop. Three dead tracks and
   nothing else, so the counter reaches the queue length and the bar says so
   rather than walking the list forever. */
{
  serve(DEAD);
  await openMusic();
  await playRow(DEAD[0].v);

  /* Slow on purpose. Only the FIRST dead track posts an onError: it is the one
     that navigates the frame, and every track after it arrives by
     loadVideoById on a player already sitting in an error state, which stays
     silent. The tracks after the first are therefore caught by the overlay's
     12-second stall clock rather than by an event, so three dead tracks take
     the better part of half a minute to walk. */
  let gaveUp = true;
  try {
    await page.waitForFunction(
      () => /would play/i.test(document.getElementById('musicNowTitle')?.textContent || ''),
      { timeout: 120000 });
  } catch { gaveUp = false; }
  note(gaveUp, 'THE AUTO-SKIP NEVER STOPPED on a list with nothing playable in it');

  const end = await read();
  note(end.lit.length === DEAD.length,
       `${end.lit.length} of ${DEAD.length} dead tracks were flagged before it gave up`);
  note(/refused/i.test(end.sub), `the bar does not explain why it stopped: "${end.sub}"`);
  note(end.src === '', 'the frame is still holding a src after giving up');
}

await browser.close();
server.close();

/* Assert the size of the run itself. A harness that stopped reaching its
   subject would drop checks silently and still print a green total. */
const TOTAL = pass + fail.length;
if (TOTAL < 15) {
  console.error(`music_flag_check: only ${TOTAL} checks ran — the harness has lost its subject`);
  process.exit(1);
}
if (fail.length) {
  console.error(`\nmusic_flag_check: ${fail.length} of ${TOTAL} FAILED`);
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nmusic_flag_check: ${pass} checks passed — a real embed refused `
            + `${DEAD.length} video(s), each one skipped and marked, and a real `
            + `video played through`);
