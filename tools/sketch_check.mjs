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
const authFor = { google: require(join(ROOT, 'api', 'sketch-auth', 'google.js')),
                  discord: require(join(ROOT, 'api', 'sketch-auth', 'discord.js')) };
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
  /* A FAKE GOOGLE AND DISCORD: authorize sends straight back with a code,
     the token endpoint answers as each provider does. Who signs in is set by
     the check in fakeUser before each round trip. */
  if (u.pathname === '/fake/authorize') {
    const back = new URL(u.searchParams.get('redirect_uri'));
    back.searchParams.set('code', 'code-' + Math.random().toString(36).slice(2));
    back.searchParams.set('state', u.searchParams.get('state'));
    res.writeHead(302, { location: back.toString() }).end(); return;
  }
  if (u.pathname === '/fake/google/token') {
    const payload = Buffer.from(JSON.stringify({ sub: fakeUser.google.sub, email: fakeUser.google.email, email_verified: true, given_name: fakeUser.google.name })).toString('base64url');
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id_token: `x.${payload}.y`, access_token: 'g' })); return;
  }
  if (u.pathname === '/fake/discord/token' && fakeUser.rejectSecret) {
    // What Discord answers a wrong or stale client secret.
    res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid_client' })); return;
  }
  if (u.pathname === '/fake/discord/token') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'd' })); return; }
  if (u.pathname === '/fake/discord/user') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(fakeUser.discord)); return; }
  if (u.pathname.startsWith('/api/sketch-auth/')) {
    req.query = Object.fromEntries(u.searchParams);
    await authFor[u.pathname.split('/').pop()](req, res);
    return;
  }
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
const fakeUser = { google: { sub: 'g-1001', email: 'dexdcimino@gmail.com', name: 'Dex' }, discord: { id: '555001', username: 'Discord.Fan' } };
Object.assign(process.env, {
  SKETCH_OAUTH_BASE: BASE,
  GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret', DISCORD_CLIENT_ID: 'did', DISCORD_CLIENT_SECRET: 'dsecret',
  SKETCH_OAUTH_GOOGLE_AUTHORIZE: `${BASE}/fake/authorize`, SKETCH_OAUTH_GOOGLE_TOKEN: `${BASE}/fake/google/token`,
  SKETCH_OAUTH_DISCORD_AUTHORIZE: `${BASE}/fake/authorize`, SKETCH_OAUTH_DISCORD_TOKEN: `${BASE}/fake/discord/token`,
  SKETCH_OAUTH_DISCORD_USER: `${BASE}/fake/discord/user`,
});
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

  // ---- 1b. an account's own canvases, kept for every device ---------------
  {
    const T = Date.now();   // tombstones older than 90 days are pruned, so real times
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
    const me = (await post({ action: 'signup', handle: 'keeper', password: 'correct horse' })).body;
    const other = (await post({ action: 'signup', handle: 'snoop', password: 'correct horse' })).body;
    const put1 = await post({ action: 'canvas-put', token: me.token, id: 'cv1', title: 'Kept', bg: { h: 10, s: 20, b: 30 }, created: T, ts: T + 2000, visibility: 'private', png: PNG, thumb: real.jpeg });
    note(put1.status === 200 && put1.body.canvas.v === 1, `canvas-put answered ${put1.status} ${JSON.stringify(put1.body).slice(0, 80)}`);
    const stale = await post({ action: 'canvas-put', token: me.token, id: 'cv1', title: 'Older', ts: T + 1500, png: PNG, thumb: real.jpeg });
    note(stale.body.stale === true && stale.body.canvas.title === 'Kept', `an older save overwrote a newer one: ${JSON.stringify(stale.body).slice(0, 80)}`);
    const notPng = await post({ action: 'canvas-put', token: me.token, id: 'cv2', title: 'x', ts: T + 3000, png: real.jpeg, thumb: real.jpeg });
    note(notPng.status === 400, `a JPEG as the canvas answered ${notPng.status}`);
    const mine = (await post({ action: 'canvases', token: me.token })).body.canvases;
    const theirs = (await post({ action: 'canvases', token: other.token })).body.canvases;
    note(mine.length === 1 && mine[0].title === 'Kept' && theirs.length === 0, `the lists: mine ${JSON.stringify(mine)}, theirs ${JSON.stringify(theirs)}`);
    const back = await fetch(BASE + '/api/sketch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'canvas-img', token: me.token, id: 'cv1', v: 1 }) });
    const snooped = await fetch(BASE + '/api/sketch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'canvas-img', token: other.token, id: 'cv1', v: 1 }) });
    const anon = await fetch(`${BASE}/api/sketch?img=${encodeURIComponent('sketch/canvases/keeper/cv1-1.png')}`);
    note(back.status === 200 && back.headers.get('content-type') === 'image/png' && snooped.status === 404 && anon.status === 404,
      `a canvas image: owner ${back.status}, another account ${snooped.status}, the public route ${anon.status}`);
    await post({ action: 'canvas-delete', token: me.token, id: 'cv1', ts: T + 4000 });
    const tomb = (await post({ action: 'canvases', token: me.token })).body.canvases;
    note(tomb.length === 1 && tomb[0].deleted === true, `a deletion is not a tombstone: ${JSON.stringify(tomb)}`);
    const revive = await post({ action: 'canvas-put', token: me.token, id: 'cv1', title: 'Late', ts: T + 3500, png: PNG, thumb: real.jpeg });
    note(revive.body.stale === true, 'a save older than the deletion brought the canvas back');
    await post({ action: 'canvas-put', token: me.token, id: 'cv3', title: 'Last', ts: T + 5000, png: PNG, thumb: real.jpeg });
    await post({ action: 'delete-account', token: me.token, password: 'correct horse' });
    note(!(await store.canvasImage('keeper', 'cv3', 1, false)), 'deleting the account left its saved canvases');
    console.log('canvases: kept per account, older saves refused, private to the account, deletions as tombstones, gone with the account');
  }

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
  await A.evaluate(() => { document.getElementById('title-input').value = ''; });   // a new canvas is pre-named Untitled N
  await A.type('#title-input', 'Dragon');
  await A.click('#plus-btn'); await sleep(900);
  await A.click('#grid-btn'); await sleep(500);
  // The lock on the card: tapping it signed out opens the account sheet.
  await A.click('.g-item .g-pub'); await sleep(300);
  note(await A.evaluate(() => document.getElementById('account').classList.contains('open')), 'making a drawing public signed out did not ask to sign in');
  await shot(A, '1-account');
  await A.click('#a-more'); await sleep(150);    // the sheet focuses the name field 50 ms later; typing before that split the name
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
  await B.click('#a-more'); await sleep(150); await B.type('#a-handle', 'fan_b'); await B.type('#a-pass', 'correct horse'); await B.click('#a-signup');
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

  // ---- 2b. one account on two devices (Dex, 2026-10-08) ------------------
  // Two browser contexts are two phones. A canvas saved on one is on the
  // other; deleted on the other, it leaves the first; signed out, neither
  // shows the account's canvases.
  {
    const acct = (await post({ action: 'signup', handle: 'two_phones', password: 'correct horse' })).body;
    const devices = [];
    for (let i = 0; i < 2; i++) {
      const ctx = await browser.createBrowserContext();
      const p = await ctx.newPage();
      await p.setViewport({ width: 420, height: 860, isMobile: true });
      await p.goto(`${BASE}/inko/manifest.webmanifest`);
      await p.evaluate((sess) => localStorage.setItem('sketchSession', JSON.stringify(sess)), { handle: acct.handle, token: acct.token });
      await p.goto(`${BASE}/inko/`, { waitUntil: 'networkidle2' });
      devices.push({ ctx, p });
    }
    const [one, two] = devices.map(d => d.p);
    const titles = (p) => p.evaluate(() => [...document.querySelectorAll('#g-rows .g-item .g-title')].map(t => t.textContent));
    const openGallery = async (p) => {
      await p.bringToFront();
      await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));   // back to the foreground: a sync
      await sleep(2500);
      await p.click('#grid-btn'); await sleep(500);
    };
    await one.bringToFront();
    await strokeOn(one);
    await one.evaluate(() => { document.getElementById('title-input').value = ''; });   // a new canvas is pre-named Untitled N
    await one.type('#title-input', 'Both phones');
    await one.click('#plus-btn'); await sleep(2500);
    await openGallery(two);
    const onTwo = await titles(two);
    const thumbOk = await two.evaluate(() => { const i = [...document.querySelectorAll('#g-rows .g-item')].find(el => el.textContent.includes('Both phones'))?.querySelector('img'); return !!i && i.complete && i.naturalWidth > 0; });
    note(onTwo.includes('Both phones') && thumbOk, `the second device's gallery after a save on the first: ${JSON.stringify(onTwo)}, thumbnail loaded ${thumbOk}`);
    // Opening it there draws the real strokes, not just the thumbnail.
    await two.evaluate(() => [...document.querySelectorAll('#g-rows .g-item')].find(el => el.textContent.includes('Both phones')).click());
    await sleep(1200);
    const inkTwo = await two.evaluate(() => {
      const c = document.getElementById('pad'), x = c.getContext('2d');
      const d = x.getImageData(0, 0, c.width, c.height).data, bg = [d[0], d[1], d[2]];
      let n = 0; for (let i = 0; i < d.length; i += 64) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 60) n++;
      return n;
    });
    note(inkTwo > 100, `the canvas opened on the second device has ${inkTwo} sampled stroke pixels`);
    // Deleted on the second device: gone from the first.
    await two.click('#grid-btn'); await sleep(400);
    await two.evaluate(() => [...document.querySelectorAll('#g-rows .g-item')].find(el => el.textContent.includes('Both phones')).querySelector('.g-del').click());
    await sleep(300); await two.click('#m-del'); await sleep(1500);
    await one.click('#g-back').catch(() => {});
    await openGallery(one);
    note(!(await titles(one)).includes('Both phones'), 'a canvas deleted on one device is still on the other');
    // Signed out on the first device: the account's canvases are not there.
    await one.click('#g-account'); await sleep(300); await one.click('#a-signout'); await sleep(1500);
    { const t = await titles(one); note(t.length === 1 && /^Untitled \d+$/.test(t[0]), `signed out, the gallery shows ${JSON.stringify(t)} — wanted only its own fresh blank`); }
    console.log(`two devices: "Both phones" saved on one appeared on the other (${inkTwo} stroke pixels), deleted there left both, signed out shows none`);
    for (const d of devices) await d.ctx.close();
  }

  // ---- 3. Google and Discord, through the real sign-in sheet --------------
  {
    const ctxC = await browser.createBrowserContext();
    const C = await ctxC.newPage();
    await C.setViewport({ width: 420, height: 860, isMobile: true });
    const cErrors = [];
    C.on('pageerror', e => cErrors.push(e.message));
    await C.goto(`${BASE}/inko/`, { waitUntil: 'networkidle2' });
    await C.click('#grid-btn'); await sleep(300);
    await C.click('#g-account'); await sleep(300);
    const sheet = await C.evaluate(() => {
      const css = id => getComputedStyle(document.getElementById(id));
      return { google: css('a-google').backgroundColor, discord: css('a-discord').backgroundColor,
               gh: document.getElementById('a-google').offsetHeight, dh: document.getElementById('a-discord').offsetHeight,
               order: [...document.querySelectorAll('#a-in > *')].filter(e => !e.hidden && e.offsetHeight).map(e => e.id || e.className).join(','),
               pwHidden: document.getElementById('a-pw').hidden };
    });
    note(sheet.google === 'rgb(255, 255, 255)' && sheet.discord === 'rgb(88, 101, 242)' && sheet.gh === sheet.dh,
         `the buttons: Google ${sheet.google}, Discord ${sheet.discord}, heights ${sheet.gh}/${sheet.dh}`);
    note(/a-google.*a-discord.*a-more/.test(sheet.order) && sheet.pwHidden, `the sheet reads ${sheet.order}, password fields hidden=${sheet.pwHidden}`);
    await shot(C, '5-sign-in');

    // Google, first time: the provider vouches, the app asks for a name.
    await Promise.all([C.waitForNavigation({ waitUntil: 'networkidle2' }), C.click('#a-google')]);
    await C.waitForFunction(() => !document.getElementById('a-claim').hidden, { timeout: 10000 }).catch(() => {});
    const claim = await C.evaluate(() => ({ open: !document.getElementById('a-claim').hidden, suggest: document.getElementById('a-claim-handle').value, hash: location.hash }));
    note(claim.open && claim.suggest === 'dex' && claim.hash === '', `after Google: ${JSON.stringify(claim)}`);
    await shot(C, '6-pick-name');
    // The owner's verified address may take a reserved name; nobody else can.
    await C.evaluate(() => { document.getElementById('a-claim-handle').value = 'dexcimino'; });
    await C.click('#a-claim-go'); await sleep(800);
    note(await C.evaluate(() => document.getElementById('g-account').textContent) === '@dexcimino', 'the owner could not claim @dexcimino');
    const sess = await C.evaluate(() => JSON.parse(localStorage.getItem('sketchSession')));
    note(sess && sess.sso === true, `the session is ${JSON.stringify(sess)}`);
    // Signed out and back in with Google: straight in, no name to pick.
    await C.evaluate(() => { localStorage.removeItem('sketchSession'); });
    await C.goto(`${BASE}/inko/`, { waitUntil: 'networkidle2' });
    await C.click('#grid-btn'); await sleep(200); await C.click('#g-account'); await sleep(200);
    await Promise.all([C.waitForNavigation({ waitUntil: 'networkidle2' }), C.click('#a-google')]);
    await sleep(600);
    const again = await C.evaluate(() => ({ who: document.getElementById('g-account').textContent, claim: !document.getElementById('a-claim').hidden, hash: location.hash }));
    note(again.who === '@dexcimino' && !again.claim && again.hash === '', `a second Google sign-in: ${JSON.stringify(again)}`);

    // Making a drawing public SIGNED OUT, through a Google round trip: the
    // page reloads on the way back, and the drawing must still go public and
    // be in the Public tab at once (Dex, 2026-10-08: "if I make a canvas
    // public, it's not showing up in the public page").
    await C.click('#g-back').catch(() => {}); await sleep(200);
    await C.evaluate(() => { localStorage.removeItem('sketchSession'); });
    await C.goto(`${BASE}/inko/`, { waitUntil: 'networkidle2' });
    {
      const r = await C.evaluate(() => { const b = document.getElementById('pad').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
      await C.mouse.move(r.x + r.w * 0.3, r.y + r.h * 0.3); await C.mouse.down();
      await C.mouse.move(r.x + r.w * 0.7, r.y + r.h * 0.7, { steps: 10 }); await C.mouse.up(); await sleep(500);
    }
    await C.evaluate(() => { document.getElementById('title-input').value = ''; });   // a new canvas is pre-named Untitled N
    await C.type('#title-input', 'Sunset');
    await C.click('#plus-btn'); await sleep(900);
    await C.click('#grid-btn'); await sleep(400);
    await C.evaluate(() => [...document.querySelectorAll('#g-rows .g-item')].find(el => el.textContent.includes('Sunset')).querySelector('.g-pub').click());
    await sleep(300);
    await Promise.all([C.waitForNavigation({ waitUntil: 'networkidle2' }), C.click('#a-google')]);
    await sleep(1500);
    await C.click('#grid-btn');
    await C.waitForFunction(() => document.querySelector('.g-item .g-pub.on'), { timeout: 15000 }).catch(() => {});
    const pending = await C.evaluate(() => ({ who: document.getElementById('g-account').textContent,
      pub: [...document.querySelectorAll('#g-rows .g-item')].filter(el => el.querySelector('.g-pub.on')).map(el => el.querySelector('.g-title').textContent) }));
    note(pending.who === '@dexcimino' && pending.pub.includes('Sunset'), `after a Google sign-in started from the lock: ${JSON.stringify(pending)}`);
    await C.click('#g-tab-public');
    await C.waitForFunction(() => [...document.querySelectorAll('.g-item[data-post] .g-title')].some(t => t.textContent === 'Sunset'), { timeout: 8000 }).catch(() => {});
    note(await C.evaluate(() => [...document.querySelectorAll('.g-item[data-post] .g-title')].some(t => t.textContent === 'Sunset')),
      'the drawing just made public is not in the Public tab');
    // Hidden as an artist on this device, your OWN drawings still show to you.
    await C.evaluate(() => localStorage.setItem('sketchBlocked', JSON.stringify(['dexcimino'])));
    await C.goto(`${BASE}/inko/`, { waitUntil: 'networkidle2' });
    await C.click('#grid-btn'); await sleep(300); await C.click('#g-tab-public');
    await C.waitForFunction(() => document.querySelector('.g-item[data-post]'), { timeout: 8000 }).catch(() => {});
    note(await C.evaluate(() => [...document.querySelectorAll('.g-item[data-post] .g-title')].some(t => t.textContent === 'Sunset')),
      'having once hidden yourself hides your own drawings from your Public tab');
    await C.evaluate(() => localStorage.removeItem('sketchBlocked'));
    console.log(`publish through Google: ${JSON.stringify(pending)}, in the Public tab, and shown despite a self-hide`);

    // Discord, a different person: a reserved name refused, their own taken.
    await C.evaluate(() => { localStorage.removeItem('sketchSession'); });
    await C.goto(`${BASE}/inko/`, { waitUntil: 'networkidle2' });
    await C.click('#grid-btn'); await sleep(200); await C.click('#g-account'); await sleep(200);
    await Promise.all([C.waitForNavigation({ waitUntil: 'networkidle2' }), C.click('#a-discord')]);
    await C.waitForFunction(() => !document.getElementById('a-claim').hidden, { timeout: 10000 }).catch(() => {});
    note(await C.evaluate(() => document.getElementById('a-claim-handle').value) === 'discord_fan', 'Discord did not suggest discord_fan');
    await C.evaluate(() => { document.getElementById('a-claim-handle').value = 'dex'; });
    await C.click('#a-claim-go'); await sleep(500);
    note(/taken/i.test(await C.evaluate(() => document.getElementById('a-msg3').textContent)), 'a Discord account claimed the reserved @dex');
    await C.evaluate(() => { document.getElementById('a-claim-handle').value = 'discord_fan'; });
    await C.click('#a-claim-go'); await sleep(800);
    note(await C.evaluate(() => document.getElementById('g-account').textContent) === '@discord_fan', 'the Discord account did not get @discord_fan');
    // Deleting a Discord account: no password field, no password needed.
    await C.click('#g-account'); await sleep(200);
    note(await C.evaluate(() => document.getElementById('a-pass2').hidden), 'a Discord account was asked for a password to delete itself');
    await C.click('#a-delete'); await sleep(200); await C.click('#m-del'); await sleep(800);
    note(await C.evaluate(() => document.getElementById('g-account').textContent) === 'Sign in', 'the Discord account was not deleted');
    note(!(await store.identify({ provider: 'discord', pid: '555001' })).token, 'the deleted account\'s Discord link still signs in');

    // A provider that is not configured says so in the sheet.
    const saved = process.env.DISCORD_CLIENT_SECRET; delete process.env.DISCORD_CLIENT_SECRET;
    await C.click('#g-account'); await sleep(200);
    await Promise.all([C.waitForNavigation({ waitUntil: 'networkidle2' }), C.click('#a-discord')]);
    await sleep(500);
    note(/not switched on/.test(await C.evaluate(() => document.getElementById('a-msg').textContent)), 'an unconfigured Discord did not say so');
    process.env.DISCORD_CLIENT_SECRET = saved;
    // A secret Discord turns down says WHY on screen, not only in the logs.
    fakeUser.rejectSecret = true;
    await C.click('#g-account'); await sleep(200);
    await Promise.all([C.waitForNavigation({ waitUntil: 'networkidle2' }), C.click('#a-discord')]);
    await sleep(500);
    const rejected = await C.evaluate(() => document.getElementById('a-msg').textContent);
    note(/did not work/.test(rejected) && /401/.test(rejected) && /invalid_client/.test(rejected), `a rejected Discord secret read "${rejected}"`);
    fakeUser.rejectSecret = false;
    // A callback this server did not start is refused.
    const forged = await fetch(`${BASE}/api/sketch-auth/google?code=x&state=forged`, { redirect: 'manual' });
    note(/auth-error=expired/.test(forged.headers.get('location') || ''), `a forged callback went to ${forged.headers.get('location')}`);
    note(cErrors.length === 0, `sign-in page errors: ${cErrors.join(' | ')}`);
    console.log('sign-in: Google claimed @dexcimino and came back without asking, Discord refused @dex and took @discord_fan, then deleted itself');
    await ctxC.close();
  }

  // ---- 6. profiles: pictures, @-search, renaming (Dex, 2026-10-08) ------
  {
    // The API: a picture is a JPEG, public by its versioned key; search finds names; a rename moves everything.
    const T = Date.now();
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
    const fa = (await post({ action: 'signup', handle: 'face_a', password: 'correct horse' })).body;
    const fb = (await post({ action: 'signup', handle: 'face_b', password: 'correct horse' })).body;
    const me0 = await post({ action: 'me', token: fa.token });
    note(me0.status === 200 && me0.body.avatar === null, `a new account has a picture: ${JSON.stringify(me0.body)}`);
    const webpPic = await post({ action: 'avatar-set', token: fa.token, image: real.webp, canvas: 'cvpic', crop: { x: 0, y: 0, size: 100 } });
    note(webpPic.status === 400, `a WebP picture answered ${webpPic.status}`);
    const set = await post({ action: 'avatar-set', token: fa.token, image: real.jpeg, canvas: 'cvpic', crop: { x: 10, y: 20, size: 300 } });
    note(set.status === 200 && set.body.avatar.v === 1 && set.body.avatar.canvas === 'cvpic', `avatar-set answered ${set.status} ${JSON.stringify(set.body)}`);
    const picUrl = (h, v) => `${BASE}/api/sketch?img=${encodeURIComponent(`sketch/avatars/${h}-${v}.jpg`)}`;
    const pic = await fetch(picUrl('face_a', 1));
    note(pic.status === 200 && pic.headers.get('content-type') === 'image/jpeg', `the picture route answered ${pic.status} ${pic.headers.get('content-type')}`);
    await post({ action: 'publish', token: fa.token, id: 'facepost', title: 'Faces', image: real.webp, thumb: real.jpeg });
    await post({ action: 'canvas-put', token: fa.token, id: 'facecv', title: 'Moves', ts: T, png: PNG, thumb: real.jpeg });
    const feedNow = await (await fetch(`${BASE}/api/sketch?feed=1&x=${T}`)).json();
    note(feedNow.avatars && feedNow.avatars.face_a === 1, `the feed does not name the pictures: ${JSON.stringify(feedNow.avatars)}`);
    const prof = await (await fetch(`${BASE}/api/sketch?profile=face_a`)).json();
    note(prof.avatar === 1 && prof.posts.length === 1 && prof.posts[0].id === 'facepost', `the profile: ${JSON.stringify(prof).slice(0, 120)}`);
    const found = (await (await fetch(`${BASE}/api/sketch?users=${encodeURIComponent('@FACE')}`)).json()).users.map(u => u.handle);
    note(found.length === 2 && found.includes('face_a') && found.includes('face_b'), `search for @FACE found ${JSON.stringify(found)}`);
    const firstB = (await (await fetch(`${BASE}/api/sketch?users=e_b`)).json()).users.map(u => u.handle);
    note(firstB[0] === 'face_b' && !firstB.includes('face_a'), `search for e_b found ${JSON.stringify(firstB)}`);

    const taken = await post({ action: 'rename', token: fa.token, handle: 'face_b' });
    const reservedName = await post({ action: 'rename', token: fa.token, handle: 'admin' });
    note(taken.status === 409 && reservedName.status === 409, `renaming onto a taken name ${taken.status}, a reserved one ${reservedName.status}`);
    const moved = await post({ action: 'rename', token: fa.token, handle: 'Face_C' });
    note(moved.status === 200 && moved.body.handle === 'face_c' && moved.body.token, `rename answered ${moved.status} ${JSON.stringify(moved.body).slice(0, 80)}`);
    const oldTok = await post({ action: 'me', token: fa.token });
    const newMe = await post({ action: 'me', token: moved.body.token });
    note(oldTok.status === 401 && newMe.status === 200 && newMe.body.avatar && newMe.body.avatar.v === 1 && newMe.body.avatar.canvas === 'cvpic',
      `after a rename: the old token ${oldTok.status}, the new one ${newMe.status} ${JSON.stringify(newMe.body)}`);
    const [picNew, picOld] = await Promise.all([fetch(picUrl('face_c', 1)), fetch(picUrl('face_a', 1))]);
    const feedAfter = (await (await fetch(`${BASE}/api/sketch?feed=1&y=${T}`)).json()).posts.find(p => p.id === 'facepost');
    const cvs = (await post({ action: 'canvases', token: moved.body.token })).body.canvases;
    const cvImg = await fetch(BASE + '/api/sketch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'canvas-img', token: moved.body.token, id: 'facecv', v: 1 }) });
    note(picNew.status === 200 && picOld.status === 404 && feedAfter && feedAfter.handle === 'face_c' && cvs.length === 1 && cvImg.status === 200,
      `a rename moved: picture ${picNew.status}/${picOld.status}, post ${feedAfter && feedAfter.handle}, canvases ${cvs.length}, canvas image ${cvImg.status}`);
    const stubProfile = await (await fetch(`${BASE}/api/sketch?profile=face_a`)).json();
    const reclaim = await post({ action: 'signup', handle: 'face_a', password: 'correct horse' });
    const oldLogin = await post({ action: 'login', handle: 'face_a', password: 'correct horse' });
    note(stubProfile.movedTo === 'face_c' && reclaim.status === 409 && oldLogin.status === 401 && /face_c/.test(oldLogin.body.error),
      `the old name: profile ${JSON.stringify(stubProfile)}, signup ${reclaim.status}, login ${oldLogin.status} "${oldLogin.body.error}"`);
    const newLogin = await post({ action: 'login', handle: 'face_c', password: 'correct horse' });
    note(newLogin.status === 200, `signing in with the new name answered ${newLogin.status}`);
    await post({ action: 'delete-account', token: moved.body.token, password: 'correct horse' });
    const pics = (await (await fetch(`${BASE}/api/sketch?feed=1&z=${T}`)).json()).avatars;
    const freed = await post({ action: 'signup', handle: 'face_a', password: 'correct horse' });
    const gone = (await (await fetch(`${BASE}/api/sketch?users=face_c`)).json()).users;
    note(!('face_c' in pics) && freed.status === 200 && gone.length === 0, `deleting the renamed account: pictures ${JSON.stringify(pics)}, old name signup ${freed.status}, search ${JSON.stringify(gone)}`);
    // face_b gets a picture and a public drawing, for the browser to find.
    await post({ action: 'avatar-set', token: fb.token, image: real.jpeg, canvas: null, crop: {} });
    await post({ action: 'publish', token: fb.token, id: 'bpost', title: 'From B', image: real.webp, thumb: real.jpeg });
    console.log('profiles (api): a JPEG picture by versioned key, in the feed and the profile, @-search by contains and prefix, a rename that moved the picture, the post, the canvases and the sign-in, and held the old name until the account went');

    // The app.
    const ctxD = await browser.createBrowserContext();
    const D = await ctxD.newPage();
    const dErrors = [];
    await D.setViewport({ width: 420, height: 860, isMobile: true, deviceScaleFactor: 2 });
    D.on('pageerror', e => dErrors.push(`pageerror: ${e.message}`));
    D.on('console', m => { if (m.type() === 'error' && !/status of 40[134]/.test(m.text())) dErrors.push(`console: ${m.text()}`); });
    await D.goto(`${BASE}/inko/`, { waitUntil: 'networkidle2' });
    await strokeOn(D);
    // Sign up from the profile's own Sign in.
    await D.click('#grid-btn'); await sleep(400);
    const bar = await D.evaluate(() => {
      const r = id => { const q = document.getElementById(id).getBoundingClientRect(); return { left: q.left, right: q.right, width: q.width, height: q.height }; };
      const b = r('g-back'), p = r('g-tab-public'), m = r('g-tab-mine');
      return { b, p, m, order: b.right <= p.left && p.right <= m.left, back: document.getElementById('g-back').textContent.trim(),
               smiley: /^url\("data:image\/svg/.test(document.getElementById('g-avatar').style.backgroundImage),
               mineSmiley: /^url\("data:image\/svg/.test(document.getElementById('g-tab-mine').style.backgroundImage),
               profile: getComputedStyle(document.getElementById('g-profile')).display !== 'none',
               signIn: document.getElementById('g-account').textContent };
    });
    note(bar.order && Math.abs(bar.b.width - bar.b.height) < 1 && Math.abs(bar.m.width - bar.m.height) < 1 && Math.abs(bar.b.width - bar.m.width) < 1 && bar.p.width > bar.b.width * 2 && bar.back === '',
      `the bottom bar is not back, a wide Public, then a square profile: ${JSON.stringify(bar)}`);
    note(bar.smiley && bar.mineSmiley && bar.profile && bar.signIn === 'Sign in', `signed out, the profile is not a smiley over Sign in: ${JSON.stringify(bar)}`);
    await shot(D, '6-profile-signed-out');
    await D.click('#g-account'); await sleep(300);
    await D.click('#a-more'); await sleep(150);
    await D.type('#a-handle', 'pic_artist'); await D.type('#a-pass', 'correct horse');
    await D.click('#a-signup'); await sleep(1500);
    note(await D.evaluate(() => document.getElementById('g-account').textContent) === '@pic_artist', 'the profile does not show @pic_artist after signing up');

    // Choose the canvas on screen as the picture, keep the default square.
    await D.click('#g-avatar'); await sleep(200);
    note(await D.evaluate(() => !document.getElementById('g-pick').hidden), 'tapping your picture did not offer to choose a canvas');
    await D.click('.g-item.current'); await sleep(600);
    note(await D.evaluate(() => document.getElementById('crop').classList.contains('open')), 'tapping a canvas did not open the crop');
    await shot(D, '6-crop');
    await D.click('#crop-save'); await sleep(2500);
    // What the picture holds: read the blob the profile square shows.
    const picPixels = () => D.evaluate(async () => {
      const m = /url\("(blob:[^"]+)"\)/.exec(document.getElementById('g-tab-mine').style.backgroundImage);
      if (!m) return null;
      const bmp = await createImageBitmap(await (await fetch(m[1])).blob());
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let red = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 80 && d[i + 2] < 80) red++;
      return { w: c.width, red, corner: [d[0], d[1], d[2]] };
    });
    const first = await picPixels();
    note(first && first.w === 256 && first.red > 500, `the picture is not the canvas: ${JSON.stringify(first)}`);
    const acct1 = await store.me('pic_artist');
    const canvasId = await D.evaluate(() => document.querySelector('.g-item.current') && 1);
    note(acct1.avatar && acct1.avatar.v >= 1 && acct1.avatar.canvas && canvasId, `the account did not get the picture: ${JSON.stringify(acct1)}`);

    // Back to the canvas: a colour change is an undo step, and the picture follows it.
    await D.click('#g-back'); await sleep(300);
    const dot = () => D.evaluate(() => getComputedStyle(document.getElementById('cs-dot')).backgroundColor);
    const before = await dot();
    await D.evaluate(() => {
      const s = document.getElementById('cv-hue'); s.value = 120; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change'));
      const b = document.getElementById('cv-bri'); b.value = 90; b.dispatchEvent(new Event('input')); b.dispatchEvent(new Event('change'));
    });
    await sleep(2500);
    const after = await dot();
    const followed = await picPixels();
    const want = after.match(/\d+/g).map(Number);
    note(followed && followed.corner.every((v, i) => Math.abs(v - want[i]) < 12) && followed.red > 500,
      `the picture did not follow its canvas to ${after}: ${JSON.stringify(followed)}`);
    const acct2 = await store.me('pic_artist');
    note(acct2.avatar.v > acct1.avatar.v, `the account's picture did not follow the canvas: v${acct1.avatar.v} -> v${acct2.avatar.v}`);
    await D.click('#undo-btn'); await sleep(500);
    const undone1 = await dot();
    await D.click('#undo-btn'); await sleep(500);
    const undone2 = await dot();
    await D.click('#redo-btn'); await sleep(300); await D.click('#redo-btn'); await sleep(500);
    const redone = await dot();
    note(undone1 !== after && undone2 === before && redone === after, `undo did not walk the canvas colour back: ${before} -> ${after}; undo ${undone1}, ${undone2}; redo ${redone}`);

    // Search from the top, into someone's profile, and back out to Public.
    await D.click('#grid-btn'); await sleep(400);
    await D.type('#g-search', 'face'); await sleep(900);
    const results = await D.evaluate(() => [...document.querySelectorAll('.g-user')].map(b => b.dataset.handle));
    note(results.includes('face_b') && results.includes('face_a'), `searching "face" found ${JSON.stringify(results)}`);
    await shot(D, '6-search');
    await D.click('.g-user[data-handle="face_b"]'); await sleep(900);
    const prof2 = await D.evaluate(() => ({ mode: document.getElementById('gallery').className, name: document.getElementById('g-user-name').textContent,
      pic: document.getElementById('g-avatar').style.backgroundImage, cards: [...document.querySelectorAll('.g-item .g-title')].map(e => e.textContent),
      search: document.getElementById('g-search').value }));
    note(/mode-user/.test(prof2.mode) && prof2.name === '@face_b' && /sketch%2Favatars%2Fface_b-1\.jpg/.test(prof2.pic) && prof2.cards.includes('From B') && prof2.search === '',
      `face_b's profile: ${JSON.stringify(prof2)}`);
    await shot(D, '6-user');
    await D.click('#g-back'); await sleep(900);
    const pub = await D.evaluate(() => ({ mode: document.getElementById('gallery').className,
      by: [...document.querySelectorAll('.g-item')].filter(e => /From B/.test(e.textContent)).map(e => e.querySelector('.g-by .avatar').style.backgroundImage) }));
    note(/mode-public/.test(pub.mode) && pub.by.length === 1 && /face_b-1\.jpg/.test(pub.by[0]), `back from a profile, Public with B's face on the card: ${JSON.stringify(pub)}`);

    // Rename from the edit button: the canvases on this phone follow the name.
    await D.click('#g-tab-mine'); await sleep(300);
    await D.click('#g-account'); await sleep(300);
    note(await D.evaluate(() => document.getElementById('a-rename').value) === 'pic_artist', 'the edit sheet does not offer the current @tag');
    await D.evaluate(() => { document.getElementById('a-rename').value = ''; });
    await D.type('#a-rename', 'pic_renamed');
    await D.click('#a-rename-go'); await sleep(1500);
    const renamed = await D.evaluate(async () => {
      const db = await new Promise(r => { const q = indexedDB.open('inko'); q.onsuccess = () => r(q.result); });
      const all = await new Promise(r => { const q = db.transaction('canvases').objectStore('canvases').getAll(); q.onsuccess = () => r(q.result); });
      const owners = {}; for (const c of all) owners[c.owner] = (owners[c.owner] || 0) + 1;
      return { label: document.getElementById('g-account').textContent, owners, session: JSON.parse(localStorage.getItem('sketchSession')).handle,
               pic: /blob:/.test(document.getElementById('g-tab-mine').style.backgroundImage) };
    });
    note(renamed.label === '@pic_renamed' && renamed.session === 'pic_renamed' && renamed.owners['u:pic_renamed'] > 0 && !renamed.owners['u:pic_artist'] && renamed.pic,
      `after renaming in the app: ${JSON.stringify(renamed)}`);
    const acct3 = await store.me('pic_renamed');
    note(acct3.avatar && acct3.avatar.v >= acct2.avatar.v, `the renamed account lost its picture: ${JSON.stringify(acct3)}`);
    await shot(D, '6-profile-renamed');
    note(dErrors.length === 0, `profile page errors: ${dErrors.join(' | ')}`);
    console.log(`profiles (app): smiley then a picture cut from the canvas (${first.red} red px), following a colour change that undo walked back (${before} -> ${after}), search into @face_b and back to Public, renamed to @pic_renamed with ${renamed.owners['u:pic_renamed']} canvas(es)`);
    await ctxD.close();
  }

} finally {
  await browser.close();
  server.close();
  await rm(SCRATCH, { recursive: true, force: true });
}
console.log(`\nsketch_check: ${pass} checks passed${fail.length ? `, ${fail.length} FAILED` : ''}`);
for (const f of fail) console.log(`  - ${f}`);
process.exit(fail.length ? 1 : 0);
