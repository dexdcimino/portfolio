/* The shared sketch gallery, end to end: the store, the API, and two people.
 *
 *   node tools/sketch_check.mjs
 *
 * Runs the REAL api/sketch.js handler in this process against a scratch
 * NOTES_DEV_DIR, behind a server that also serves the repo -- with ETags and
 * the /inko/ policy out of vercel.json, as inko_check does.
 *
 *   1. The API alone: refusals that matter (no token, a name taken, a short
 *      password, a "WebP" whose bytes are a JPEG, someone else's drawing),
 *      three reports hiding a post, deleting an account taking its posts.
 *   2. TWO BROWSER CONTEXTS -- not tabs, which would share one account -- as
 *      two people: A makes a drawing public (the sign-in sheet opening on the
 *      way), B sees it in the Public tab with its picture, reacts, switches the
 *      reaction, opens it, reports it, hides the artist; A makes it private and
 *      it is gone from the server.
 *
 * FALSELY PASSES IF: a picture that never loaded counted as a card. Every
 * image assertion reads naturalWidth, not the presence of an <img>.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const SCRATCH = await mkdtemp(join(tmpdir(), 'sketch-check-'));
process.env.NOTES_DEV_DIR = SCRATCH;
delete process.env.VERCEL_ENV;
const handler = require(join(ROOT, 'api', 'sketch.js'));
const store = require(join(ROOT, 'lib', 'sketch-store.js'));

const CHROME = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found — set CHROME=<path to the exe>');
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const CSP = ((vercel.headers.find(h => h.source === '/inko/(.*)') || {}).headers || [])
  .find(h => h.key === 'Content-Security-Policy').value.replace(/;\s*upgrade-insecure-requests/, '');

/* A Vercel-shaped req/res around a node one: query, body, status().json(). */
function vercelRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); return res; };
  res.send = (buf) => { res.end(buf); return res; };
  return res;
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/sketch') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    req.query = Object.fromEntries(u.searchParams);
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = raw; }
    await handler(req, vercelRes(res));
    return;
  }
  let path = decodeURIComponent(u.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = resolve(join(ROOT, normalize(path)));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    const headers = { 'content-type': MIME[extname(file)] || 'application/octet-stream',
      etag: '"' + createHash('md5').update(body).digest('hex') + '"' };
    if (path.startsWith('/inko/')) headers['content-security-policy'] = CSP;
    res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
// Screenshots of the screens this adds, for a person to look at.
const SHOTS = join(ROOT, '.notes-dev', 'shots');
await import('node:fs/promises').then(f => f.mkdir(SHOTS, { recursive: true }));
const shot = (p, name) => p.screenshot({ path: join(SHOTS, `sketch-${name}.png`) });

const fail = [];
let pass = 0;
const note = (ok, why) => { if (ok) pass++; else fail.push(why); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = async (body) => {
  const r = await fetch(BASE + '/api/sketch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

// A tiny real WebP and JPEG, made by the browser below, are what the API
// accepts; these are what it must refuse.
const fakeWebp = 'data:image/webp;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).toString('base64');

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run', '--no-default-browser-check'] });
try {
  // ---- 1. the API alone -------------------------------------------------
  const scratchPage = await browser.newPage();
  await scratchPage.goto(`${BASE}/inko/manifest.webmanifest`);
  const real = await scratchPage.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 44; c.height = 60;
    const x = c.getContext('2d'); x.fillStyle = '#f40'; x.fillRect(4, 4, 30, 40);
    const url = (type) => new Promise(r => c.toBlob(b => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }, type, 0.9));
    return { webp: await url('image/webp'), jpeg: await url('image/jpeg') };
  });
  await scratchPage.close();

  const noToken = await post({ action: 'publish', id: 'abc123', title: 'x', image: real.webp, thumb: real.jpeg });
  note(noToken.status === 401, `publish with no token answered ${noToken.status}`);
  const shortPw = await post({ action: 'signup', handle: 'someone', password: 'short' });
  note(shortPw.status === 400, `a 5-character password answered ${shortPw.status}`);
  const reserved = await post({ action: 'signup', handle: 'admin', password: 'longenough' });
  note(reserved.status === 409, `the name "admin" answered ${reserved.status}`);
  const u1 = await post({ action: 'signup', handle: 'Painter_1', password: 'correct horse' });
  note(u1.status === 200 && u1.body.handle === 'painter_1', `signup answered ${u1.status} ${JSON.stringify(u1.body).slice(0, 80)}`);
  const dup = await post({ action: 'signup', handle: 'painter_1', password: 'correct horse' });
  note(dup.status === 409, `a taken name answered ${dup.status}`);
  const wrongPw = await post({ action: 'login', handle: 'painter_1', password: 'wrong wrong' });
  note(wrongPw.status === 401, `a wrong password answered ${wrongPw.status}`);
  const t1 = u1.body.token;
  const bad = await post({ action: 'publish', token: t1, id: 'abc123', title: 'x', image: fakeWebp, thumb: real.jpeg });
  note(bad.status === 400, `a JPEG labelled WebP answered ${bad.status}`);
  const ok = await post({ action: 'publish', token: t1, id: 'abc123', title: 'First', image: real.webp, thumb: real.jpeg });
  note(ok.status === 200 && ok.body.post.v === 1, `publish answered ${ok.status} ${JSON.stringify(ok.body).slice(0, 80)}`);
  const img = await fetch(`${BASE}/api/sketch?img=${encodeURIComponent('sketch/img/abc123-1.webp')}`);
  note(img.status === 200 && img.headers.get('content-type') === 'image/webp' && /immutable/.test(img.headers.get('cache-control') || ''),
       `the image route answered ${img.status} ${img.headers.get('content-type')} ${img.headers.get('cache-control')}`);
  const traversal = await fetch(`${BASE}/api/sketch?img=${encodeURIComponent('sketch/users/painter_1.json')}`);
  note(traversal.status === 404, `the image route served a non-image key (${traversal.status}) — it would leak password hashes`);
  const u2 = (await post({ action: 'signup', handle: 'thief', password: 'correct horse' })).body;
  const steal = await post({ action: 'publish', token: u2.token, id: 'abc123', title: 'mine now', image: real.webp, thumb: real.jpeg });
  note(steal.status === 403, `publishing over someone else's drawing answered ${steal.status}`);
  // Three different people report it, and it leaves the feed.
  for (const n of ['r_one', 'r_two', 'r_three']) {
    const u = (await post({ action: 'signup', handle: n, password: 'correct horse' })).body;
    await post({ action: 'report', token: u.token, id: 'abc123' });
  }
  const afterReports = (await (await fetch(`${BASE}/api/sketch?feed=1`)).json()).posts;
  note(!afterReports.some(p => p.id === 'abc123'), 'three reports did not take the drawing out of the feed');
  // Deleting the account removes its posts, the hidden one included.
  const gone = await post({ action: 'delete-account', token: t1, password: 'correct horse' });
  note(gone.status === 200 && gone.body.posts === 1, `deleting the account answered ${gone.status} ${JSON.stringify(gone.body)}`);
  note(!(await store.image('sketch/img/abc123-1.webp')), 'the deleted account\'s image is still stored');
  console.log(`api: refusals held, 3 reports hid it, account deletion took ${gone.body.posts} post(s)`);

  // ---- 2. two people, two browsers --------------------------------------
  const ctxA = await browser.createBrowserContext(), ctxB = await browser.createBrowserContext();
  const A = await ctxA.newPage(), B = await ctxB.newPage();
  const errors = [];
  for (const [who, p] of [['A', A], ['B', B]]) {
    await p.setViewport({ width: 420, height: 860, isMobile: true });
    p.on('pageerror', e => errors.push(`${who} pageerror: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error' && !/status of 40[134]/.test(m.text())) errors.push(`${who} console: ${m.text()}`); });
    await p.goto(`${BASE}/inko/`, { waitUntil: 'networkidle2' });
  }
  const strokeOn = async (p) => {
    const r = await p.evaluate(() => { const b = document.getElementById('pad').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
    await p.mouse.move(r.x + r.w * 0.2, r.y + r.h * 0.4); await p.mouse.down();
    await p.mouse.move(r.x + r.w * 0.8, r.y + r.h * 0.6, { steps: 10 }); await p.mouse.up(); await sleep(500);
  };
  // A draws, names it, saves it with +.
  await strokeOn(A);
  await A.type('#title-input', 'Dragon');
  await A.click('#plus-btn'); await sleep(900);
  await A.click('#grid-btn'); await sleep(500);
  // The lock on the card: tapping it signed out opens the account sheet.
  await A.click('.g-item .g-pub'); await sleep(300);
  note(await A.evaluate(() => document.getElementById('account').classList.contains('open')), 'making a drawing public signed out did not ask to sign in');
  await shot(A, '1-account');
  await A.type('#a-handle', 'artist_a');
  await A.type('#a-pass', 'correct horse');
  await A.click('#a-signup');
  await A.waitForFunction(() => document.querySelector('.g-item .g-pub.on'), { timeout: 15000 }).catch(() => {});
  note(await A.evaluate(() => !!document.querySelector('.g-item .g-pub.on')), 'after signing up the drawing did not become public');
  note(await A.evaluate(() => document.getElementById('g-account').textContent) === '@artist_a', 'the account button does not show @artist_a');
  await sleep(600); await shot(A, '2-mine-public');

  // B signs up from the Public tab and sees A's drawing, with its picture.
  await B.click('#grid-btn'); await sleep(300);
  await B.click('#g-tab-public');
  await B.waitForFunction(() => document.querySelector('.g-item[data-post] img'), { timeout: 10000 }).catch(() => {});
  await B.waitForFunction(() => { const i = document.querySelector('.g-item[data-post] img'); return i && i.complete && i.naturalWidth > 0; }, { timeout: 10000 }).catch(() => {});
  const seen = await B.evaluate(() => {
    const card = document.querySelector('.g-item[data-post]');
    return card && { title: card.querySelector('.g-title').textContent, by: card.querySelector('.g-by').textContent,
                     w: card.querySelector('img').naturalWidth };
  });
  note(seen && seen.title === 'Dragon' && seen.by === '@artist_a' && seen.w > 0, `B's Public tab shows ${JSON.stringify(seen)}`);
  // Reacting signed out asks to sign in first, then lands the reaction.
  await B.click('.g-item[data-post] .g-rx[data-kind="fire"]'); await sleep(300);
  await B.type('#a-handle', 'fan_b'); await B.type('#a-pass', 'correct horse'); await B.click('#a-signup');
  await B.waitForFunction(() => document.querySelector('.g-item[data-post] .g-rx[data-kind="fire"] b')?.textContent === '1', { timeout: 10000 }).catch(() => {});
  const fire = await B.evaluate(() => document.querySelector('.g-item[data-post] .g-rx[data-kind="fire"]').outerHTML);
  note(/on/.test(fire) && />1</.test(fire), `after B's fire: ${fire}`);
  // Clicked as found NOW: the app replaces the reaction row when a vote's reply
  // lands, so a handle taken a moment earlier can be a detached button.
  await sleep(500);
  await B.evaluate(() => document.querySelector('.g-item[data-post] .g-rx[data-kind="poop"]').click()); await sleep(800);
  const counts = await B.evaluate(() => [...document.querySelectorAll('.g-item[data-post] .g-rx b')].map(b => b.textContent).join('/'));
  note(counts === '0/1', `switching to poop left fire/poop at ${counts}`);
  // The server agrees, from a fresh feed read.
  await shot(B, '3-public-feed');
  const serverFeed = (await (await fetch(`${BASE}/api/sketch?feed=1`)).json()).posts.find(p => p.title === 'Dragon');
  note(serverFeed && serverFeed.fire === 0 && serverFeed.poop === 1, `the server holds ${JSON.stringify(serverFeed)}`);
  // The viewer: the full drawing, loaded.
  await B.click('.g-item[data-post] .g-thumb'); await sleep(300);
  await B.waitForFunction(() => { const i = document.getElementById('v-img'); return i.complete && i.naturalWidth > 0; }, { timeout: 10000 }).catch(() => {});
  const big = await B.evaluate(() => ({ open: document.getElementById('viewer').classList.contains('open'), w: document.getElementById('v-img').naturalWidth,
    counts: [...document.querySelectorAll('#viewer .g-rx b')].map(b => b.textContent).join('/') }));
  // The viewer and the card are one post: the screenshot that found this showed
  // 0/0 in the viewer over a card reading 0/1.
  note(big.counts === '0/1', `the viewer reads fire/poop ${big.counts}, the card and the server 0/1`);
  await shot(B, '4-viewer');
  note(big.open && big.w >= 800, `the viewer opened ${JSON.stringify(big)} — the full drawing is 880 wide`);
  // Hide this artist: gone from B's feed, on this device only.
  await B.click('#v-block'); await sleep(200); await B.click('#m-del'); await sleep(400);
  note(await B.evaluate(() => !document.querySelector('.g-item[data-post]')), 'hiding the artist left their drawing in B\'s feed');

  // A makes it private: gone from the server.
  await A.click('#g-tab-mine'); await sleep(300);
  await A.click('.g-item .g-pub.on');
  await A.waitForFunction(() => document.querySelector('.g-item .g-pub') && !document.querySelector('.g-item .g-pub.on'), { timeout: 10000 }).catch(() => {});
  const afterPrivate = (await (await fetch(`${BASE}/api/sketch?feed=1`)).json()).posts;
  note(!afterPrivate.some(p => p.title === 'Dragon'), 'making it private left it in the shared feed');
  console.log(`people: A published "Dragon", B saw it at ${seen && seen.w}px, reacted 🔥 then 💩, viewed it at ${big.w}px, hid the artist; A took it back`);
  note(errors.length === 0, `console/page errors: ${errors.join(' | ')}`);
  await ctxA.close(); await ctxB.close();
} finally {
  await browser.close();
  server.close();
  await rm(SCRATCH, { recursive: true, force: true });
}
console.log(`\nsketch_check: ${pass} checks passed${fail.length ? `, ${fail.length} FAILED` : ''}`);
for (const f of fail) console.log(`  - ${f}`);
process.exit(fail.length ? 1 : 0);
