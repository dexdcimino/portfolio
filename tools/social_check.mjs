/* Inko's social features, end to end: lib/sketch-social.js through the real
 * api/sketch.js handler, and inko/social.js in a browser.
 *
 *   node tools/social_check.mjs        (CHROME=<path> if Chrome is not in the usual place)
 *
 * Runs the handler in this process on a scratch NOTES_DEV_DIR behind a server
 * that also serves the repo with the /inko/ policy from vercel.json, as
 * sketch_check does. Sessions are put straight into localStorage: signing in
 * is sketch_check's business, not this one's.
 *
 *   1. FOLLOWS, API: following both ways, the counts on a profile, refusals
 *      (yourself, nobody), a rename carrying the follows, a deletion taking
 *      the account out of every list.
 *   2. FOLLOWS, APP: the pill above the bar on Public (All | Following |
 *      fire) narrowing the grid to the artists you follow and to the drawings
 *      you gave fire, the Follow button on an artist's profile changing the
 *      count and the server, and Following signed out asking you to sign in.
 *
 * FALSELY PASSES IF: a grid counted as filtered was never drawn. The card
 * assertions read the cards' data-post off the DOM after the click.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const SCRATCH = await mkdtemp(join(tmpdir(), 'social-check-'));
process.env.NOTES_DEV_DIR = SCRATCH;
delete process.env.VERCEL_ENV;
const handler = require(join(ROOT, 'api', 'sketch.js'));

const CHROME = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found — set CHROME=<path to the exe>');
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const CSP = ((vercel.headers.find(h => h.source === '/inko/(.*)') || {}).headers || [])
  .find(h => h.key === 'Content-Security-Policy').value.replace(/;\s*upgrade-insecure-requests/, '');

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
const SHOTS = join(ROOT, '.notes-dev', 'shots');
await mkdir(SHOTS, { recursive: true });
const shot = (p, name) => p.screenshot({ path: join(SHOTS, `social-${name}.png`) });

const fail = [];
let pass = 0;
const note = (ok, why) => { if (ok) pass++; else fail.push(why); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = async (body) => {
  const r = await fetch(BASE + '/api/sketch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const get = async (q) => (await fetch(`${BASE}/api/sketch?${q}`)).json();
const signup = async (handle) => (await post({ action: 'signup', handle, password: 'correct horse' })).body;
const optTap = async (p, sel) => { await p.evaluate(() => { if (document.getElementById('opt-bar').hidden) document.getElementById('opt-btn').click(); }); return p.click(sel); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run', '--no-default-browser-check'] });
try {
  const scratchPage = await browser.newPage();
  await scratchPage.goto(`${BASE}/inko/manifest.webmanifest`);
  const real = await scratchPage.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 44; c.height = 60;
    const x = c.getContext('2d'); x.fillStyle = '#f40'; x.fillRect(4, 4, 30, 40);
    const url = (type) => new Promise(r => c.toBlob(b => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }, type, 0.9));
    return { webp: await url('image/webp'), jpeg: await url('image/jpeg') };
  });
  await scratchPage.close();
  const publish = (u, id, title) => post({ action: 'publish', token: u.token, id, title, image: real.webp, thumb: real.jpeg });

  // ---- 1. follows, API ----------------------------------------------------
  const ann = await signup('ann'), ben = await signup('ben'), cat = await signup('cat'), dan = await signup('dan');
  await publish(ann, 'pann1', 'Ann one');
  await publish(cat, 'pcat1', 'Cat one');
  await publish(dan, 'pdan1', 'Dan one');
  await post({ action: 'vote', token: ben.token, id: 'pcat1', kind: 'fire' });

  const f1 = await post({ action: 'follow', token: ben.token, handle: '@Ann', on: true });
  note(f1.status === 200 && f1.body.following === true && f1.body.followers === 1, `ben following ann answered ${f1.status} ${JSON.stringify(f1.body)}`);
  const again = await post({ action: 'follow', token: ben.token, handle: 'ann', on: true });
  note(again.body.followers === 1, `following twice counted twice: ${JSON.stringify(again.body)}`);
  const self = await post({ action: 'follow', token: ben.token, handle: 'ben' });
  note(self.status === 400, `following yourself answered ${self.status}`);
  const ghost = await post({ action: 'follow', token: ben.token, handle: 'nobody_here' });
  note(ghost.status === 404, `following nobody answered ${ghost.status}`);
  const anon = await post({ action: 'follow', handle: 'ann' });
  note(anon.status === 401, `following with no token answered ${anon.status}`);
  await post({ action: 'follow', token: dan.token, handle: 'ann' });
  await post({ action: 'follow', token: ann.token, handle: 'dan' });
  let prof = await get('profile=ann');
  note(prof.followers === 2 && prof.following === 1 && prof.posts.length === 1, `ann's profile: ${JSON.stringify({ f: prof.followers, g: prof.following, n: prof.posts && prof.posts.length })}`);
  const list = (await post({ action: 'following', token: ben.token })).body.following;
  note(JSON.stringify(list) === '["ann"]', `ben follows ${JSON.stringify(list)}`);

  // A rename carries the follows both ways.
  const ren = await post({ action: 'rename', token: ann.token, handle: 'anna' });
  note(ren.status === 200 && ren.body.handle === 'anna', `rename answered ${ren.status} ${JSON.stringify(ren.body).slice(0, 80)}`);
  ann.token = ren.body.token;
  prof = await get('profile=anna');
  const benNow = (await post({ action: 'following', token: ben.token })).body.following;
  const danProf = await get('profile=dan');
  note(prof.followers === 2 && prof.following === 1 && JSON.stringify(benNow) === '["anna"]' && danProf.followers === 1,
    `after the rename: anna ${prof.followers}/${prof.following}, ben follows ${JSON.stringify(benNow)}, dan has ${danProf.followers} follower(s)`);
  // A deleted account leaves every list.
  await post({ action: 'delete-account', token: dan.token, password: 'correct horse' });
  prof = await get('profile=anna');
  note(prof.followers === 1 && prof.following === 0, `after dan went, anna is ${prof.followers}/${prof.following}`);
  // Unfollow.
  const un = await post({ action: 'follow', token: ben.token, handle: 'anna', on: false });
  note(un.body.following === false && un.body.followers === 0, `unfollow answered ${JSON.stringify(un.body)}`);
  await post({ action: 'follow', token: ben.token, handle: 'anna', on: true });
  console.log('follows (api): both sides, counts on the profile, refusals, carried by a rename, dropped with a deleted account');

  // ---- 2. follows, app ----------------------------------------------------
  const errors = [];
  const open = async (session) => {
    const ctx = await browser.createBrowserContext();
    const p = await ctx.newPage();
    await p.setViewport({ width: 420, height: 860, isMobile: true });
    p.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error' && !/status of 40[134]/.test(m.text())) errors.push(`console: ${m.text()}`); });
    await p.goto(`${BASE}/inko/manifest.webmanifest`);
    if (session) await p.evaluate(s => localStorage.setItem('sketchSession', JSON.stringify(s)), session);
    await p.goto(`${BASE}/inko/`, { waitUntil: 'networkidle2' });
    return p;
  };
  const cards = (p) => p.evaluate(() => [...document.querySelectorAll('#g-rows .g-item[data-post]')].map(e => e.dataset.post).sort().join(','));
  const B = await open({ handle: 'ben', token: ben.token });
  await optTap(B, '#grid-btn'); await sleep(300);
  await B.click('#g-tab-public');
  await B.waitForFunction(() => document.querySelectorAll('#g-rows .g-item[data-post]').length >= 2, { timeout: 10000 }).catch(() => {});
  const barUp = await B.evaluate(() => { const s = document.getElementById('s-bar'), g = document.getElementById('g-bar');
    const a = s.getBoundingClientRect(), b = g.getBoundingClientRect();
    return { shown: !s.hidden && a.height > 0, above: a.bottom <= b.top + 1, lower: a.top > innerHeight / 2 }; });
  note(barUp.shown && barUp.above && barUp.lower, `the filter pill on Public: ${JSON.stringify(barUp)}`);
  const all = await cards(B);
  note(all === 'pann1,pcat1', `Public showed ${all}`);
  await shot(B, '1-public-all');
  await B.click('#s-filter [data-f="following"]'); await sleep(400);
  const fol = await cards(B);
  note(fol === 'pann1', `Following showed ${fol}`);
  await B.click('#s-filter [data-f="fire"]'); await sleep(300);
  const fire = await cards(B);
  note(fire === 'pcat1', `the fire filter showed ${fire}`);
  await shot(B, '2-public-fire');
  await B.click('#s-filter [data-f="all"]'); await sleep(300);
  note(await cards(B) === 'pann1,pcat1', 'All did not bring every drawing back');

  // An artist's profile: their count and the Follow button.
  await B.evaluate(() => window.inkoBridge.openUser('cat'));
  await B.waitForFunction(() => !document.getElementById('s-bar').hidden && document.getElementById('s-bar').dataset.mode === 'user', { timeout: 8000 }).catch(() => {});
  await sleep(300);
  const before = await B.evaluate(() => ({ n: document.getElementById('s-followers').textContent, b: document.getElementById('s-follow').textContent }));
  note(before.n === '0 followers' && before.b === 'Follow', `cat's profile before: ${JSON.stringify(before)}`);
  await B.click('#s-follow');
  await sleep(600);
  const after = await B.evaluate(() => ({ n: document.getElementById('s-followers').textContent, b: document.getElementById('s-follow').textContent }));
  const server1 = await get('profile=cat');
  note(after.n === '1 follower' && after.b === 'Following' && server1.followers === 1, `after Follow: ${JSON.stringify(after)}, server ${server1.followers}`);
  await shot(B, '3-artist-following');
  await B.click('#s-follow'); await sleep(600);
  const server2 = await get('profile=cat');
  note(server2.followers === 0 && await B.evaluate(() => document.getElementById('s-follow').textContent) === 'Follow', `unfollow left ${server2.followers}`);
  // Your own gallery: no pill.
  await B.click('#g-tab-mine'); await sleep(300);
  note(await B.evaluate(() => document.getElementById('s-bar').hidden), 'the pill showed on your own gallery');

  // Signed out, Following asks you to sign in.
  const S = await open(null);
  await optTap(S, '#grid-btn'); await sleep(300);
  await S.click('#g-tab-public'); await sleep(800);
  await S.click('#s-filter [data-f="following"]'); await sleep(300);
  note(await S.evaluate(() => document.getElementById('account').classList.contains('open')), 'Following signed out did not ask to sign in');
  console.log(`follows (app): Public ${all} -> Following ${fol} -> fire ${fire}; cat ${before.n} -> ${after.n} -> ${server2.followers}`);

  note(!errors.length, 'page errors: ' + errors.join(' | '));
} finally {
  await browser.close();
  server.close();
}
if (fail.length) { console.error(`\nsocial_check: ${fail.length} failed, ${pass} passed\n - ` + fail.join('\n - ')); process.exit(1); }
console.log(`\nsocial_check: ${pass} checks passed`);
