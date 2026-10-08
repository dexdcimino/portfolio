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
 *   1b. COMMENTS, API: posting, reading back oldest first, refusals (empty,
 *      no token, a drawing that is gone), who may delete (the author and the
 *      artist, nobody else), three reports hiding one, a rename re-signing
 *      them, a deleted account taking them down, unpublishing taking all.
 *   2. FOLLOWS, APP: the pill above the bar on Public (All | Following |
 *      fire) narrowing the grid to the artists you follow and to the drawings
 *      you gave fire, the Follow button on an artist's profile changing the
 *      count and the server, Draw together alone on your own gallery, and
 *      Following signed out asking you to sign in.
 *   3. COMMENTS, APP: the bubble in the viewer's bar (fitting a 360px phone),
 *      the sheet over the bottom half, a comment typed and sent landing in the
 *      list, the count and the server, and held to delete it.
 *   4. DRAWING TOGETHER, with inko/room-firestore.js SWAPPED for a fake that
 *      keeps the room in this process (no harness can reach Firestore): the
 *      brushes on an artist's profile opening a room and inviting them, the
 *      invitee's card popping up and joining, strokes crossing both ways as
 *      pixels, chat with an unread count, undo taking back only your own
 *      stroke on both phones, leaving keeping a card in the gallery, and the
 *      room listed under Draw together.
 *
 * NOT CHECKED HERE: room-firestore.js itself and the Firestore rules -- the
 * fake stands in for both. Try a room on two real phones after a change.
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
/* A FAKE ROOM SERVICE: the same five calls as room-firestore.js, over HTTP
   to this process, which keeps every room in memory and feeds each phone the
   events after the last one it saw. */
const rooms = new Map();
const roomOf = (id) => { if (!rooms.has(id)) rooms.set(id, { data: null, events: [], n: 0 }); return rooms.get(id); };
const FAKE_TRANSPORT = `
let uid = 'u' + Math.random().toString(36).slice(2, 8);
const call = (op, body) => fetch('/fake-room/' + op, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
export async function create(id, fields){ await call('create', { id, fields }); }
export async function connect(id, on){
  let since = 0, stop = false, roomJson = '';
  const tick = async () => {
    if (stop) return;
    try {
      const r = await call('poll', { id, since });
      if (JSON.stringify(r.room) !== roomJson){ roomJson = JSON.stringify(r.room); on.room(r.room); }
      const added = [], removed = [], chat = [];
      for (const e of r.events){ since = e.seq; if (e.type === 'add') added.push(e.doc); else if (e.type === 'remove') removed.push(...e.ids); else chat.push(e.msg); }
      if (added.length || removed.length) on.strokes(added, removed);
      if (chat.length) on.chat(chat);
    } catch (e) {}
    setTimeout(tick, 90);
  };
  tick();
  return {
    uid,
    add: c => call('add', { id, doc: { ...c, uid } }).then(r => r.id),
    remove: ids => call('remove', { id, ids }),
    chat: m => call('chat', { id, msg: { ...m, uid, at: Date.now() } }),
    update: fields => call('update', { id, fields }),
    close: () => { stop = true; },
  };
}`;
const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/inko/room-firestore.js') { res.writeHead(200, { 'content-type': 'text/javascript', 'content-security-policy': CSP }).end(FAKE_TRANSPORT); return; }
  if (u.pathname.startsWith('/fake-room/')) {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const b = JSON.parse(raw || '{}'), r = roomOf(b.id), op = u.pathname.split('/').pop();
    const push = (e) => r.events.push({ ...e, seq: r.events.length + 1 });
    let out = {};
    if (op === 'create') r.data = b.fields;
    if (op === 'poll') out = { room: r.data, events: r.events.filter(e => e.seq > (b.since || 0)) };
    if (op === 'add') { const id = 'd' + (++r.n); push({ type: 'add', doc: { ...b.doc, id } }); out = { id }; }
    if (op === 'remove') push({ type: 'remove', ids: b.ids });
    if (op === 'chat') push({ type: 'chat', msg: b.msg });
    if (op === 'update' && r.data) for (const [k, v] of Object.entries(b.fields)) {
      const [a, c] = k.split('.'); if (c) r.data = { ...r.data, [a]: { ...(r.data[a] || {}), [c]: v } }; else r.data = { ...r.data, [k]: v };
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out)); return;
  }
  if (u.pathname === '/api/sketch') {
    // Every caller is 127.0.0.1 here, so the per-address limits would treat the run's many people as one:
    // each request gets its own address unless the check names one (the limits are driven in their own block).
    if (!req.headers['x-real-ip']) req.headers['x-real-ip'] = '10.' + Math.floor(Math.random() * 1e6);
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

  // ---- 1b. comments, API ----------------------------------------------------
  {
    const eve = await signup('eve'), fay = await signup('fay'), gus = await signup('gus'), hal = await signup('hal');
    await publish(eve, 'peve1', 'Eve one');
    const c1 = await post({ action: 'comment', token: fay.token, id: 'peve1', text: '  so   good\n\u0000 ' });
    note(c1.status === 200 && c1.body.comment.t === 'so good' && c1.body.comment.h === 'fay' && c1.body.count === 1, `a comment answered ${c1.status} ${JSON.stringify(c1.body)}`);
    await post({ action: 'comment', token: gus.token, id: 'peve1', text: 'second' });
    const long = await post({ action: 'comment', token: hal.token, id: 'peve1', text: 'x'.repeat(400) });
    note(long.body.comment && long.body.comment.t.length === 280, `a 400-character comment kept ${long.body.comment && long.body.comment.t.length}`);
    const empty = await post({ action: 'comment', token: fay.token, id: 'peve1', text: '   ' });
    const noTok = await post({ action: 'comment', id: 'peve1', text: 'hi' });
    const nowhere = await post({ action: 'comment', token: fay.token, id: 'nosuchpost', text: 'hi' });
    note(empty.status === 400 && noTok.status === 401 && nowhere.status === 404, `refusals: empty ${empty.status}, no token ${noTok.status}, no drawing ${nowhere.status}`);
    let got = await get('comments=peve1');
    note(got.count === 3 && got.comments.map(c => c.h).join() === 'fay,gus,hal' && !('reporters' in got.comments[0]), `read back: ${JSON.stringify(got).slice(0, 120)}`);
    const gusC = got.comments[1].c, halC = got.comments[2].c;
    const notYours = await post({ action: 'comment-delete', token: fay.token, id: 'peve1', c: gusC });
    note(notYours.status === 403, `fay deleting gus's comment answered ${notYours.status}`);
    const artist = await post({ action: 'comment-delete', token: eve.token, id: 'peve1', c: gusC });
    note(artist.body.deleted === true && artist.body.count === 2, `the artist deleting a comment answered ${JSON.stringify(artist.body)}`);
    // Three reports hide hal's.
    for (const u of [eve, fay, gus]) await post({ action: 'comment-report', token: u.token, id: 'peve1', c: halC });
    const ownReport = await post({ action: 'comment-report', token: hal.token, id: 'peve1', c: halC });
    got = await get('comments=peve1');
    note(got.count === 1 && got.comments[0].h === 'fay' && ownReport.status === 400, `after three reports: ${JSON.stringify(got.comments.map(c => c.h))}, own report ${ownReport.status}`);
    // A rename re-signs them.
    const r = await post({ action: 'rename', token: fay.token, handle: 'faye' });
    fay.token = r.body.token;
    got = await get('comments=peve1');
    note(got.comments[0].h === 'faye', `after the rename the comment says @${got.comments[0].h}`);
    // A deleted account takes its comments down.
    await post({ action: 'comment', token: gus.token, id: 'peve1', text: 'back again' });
    await post({ action: 'delete-account', token: gus.token, password: 'correct horse' });
    got = await get('comments=peve1');
    note(got.count === 1 && !got.comments.some(c => c.h === 'gus'), `after gus went: ${JSON.stringify(got.comments.map(c => c.h))}`);
    // Unpublishing takes them all.
    await post({ action: 'unpublish', token: eve.token, id: 'peve1' });
    got = await get('comments=peve1');
    note(got.count === 0, `after unpublishing, ${got.count} comment(s) left`);
    console.log('comments (api): posted and read back, refusals, author and artist delete, 3 reports hide, renamed, gone with the account and the drawing');
  }

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
  // Your own gallery: only Draw together.
  await B.click('#g-tab-mine'); await sleep(300);
  const minePill = await B.evaluate(() => { const v = id => getComputedStyle(document.getElementById(id)).display !== 'none'; return { together: v('s-mine'), filter: v('s-filter'), artist: v('s-artist') }; });
  note(minePill.together && !minePill.filter && !minePill.artist, `the pill on your own gallery: ${JSON.stringify(minePill)}`);

  // Signed out, Following asks you to sign in.
  const S = await open(null);
  await optTap(S, '#grid-btn'); await sleep(300);
  await S.click('#g-tab-public'); await sleep(800);
  await S.click('#s-filter [data-f="following"]'); await sleep(300);
  note(await S.evaluate(() => document.getElementById('account').classList.contains('open')), 'Following signed out did not ask to sign in');
  console.log(`follows (app): Public ${all} -> Following ${fol} -> fire ${fire}; cat ${before.n} -> ${after.n} -> ${server2.followers}`);

  // ---- 3. comments, app ----------------------------------------------------
  {
    await B.setViewport({ width: 360, height: 760, isMobile: true });
    await B.click('#g-tab-public'); await sleep(200);
    await B.waitForFunction(() => document.querySelector('#g-rows .g-item[data-post="pcat1"]'), { timeout: 8000 }).catch(() => {});
    await B.click('#g-rows .g-item[data-post="pcat1"] .g-thumb'); await sleep(600);
    const bar = await B.evaluate(() => { const v = document.getElementById('v-bar'), b = document.getElementById('s-cbtn').getBoundingClientRect();
      return { open: document.getElementById('viewer').classList.contains('open'), fits: v.scrollWidth <= v.clientWidth + 1, inside: b.right <= innerWidth && b.width > 40 }; });
    note(bar.open && bar.fits && bar.inside, `the viewer's bar with the comment button at 360px: ${JSON.stringify(bar)}`);
    await B.click('#s-cbtn'); await sleep(450);
    const sh = await B.evaluate(() => { const r = document.getElementById('s-csheet').getBoundingClientRect();
      return { open: document.getElementById('s-csheet').classList.contains('open'), top: Math.round(r.top), h: innerHeight, empty: document.querySelector('.s-cempty')?.textContent }; });
    note(sh.open && sh.top >= sh.h * 0.4 && /No comments/.test(sh.empty || ''), `the comment sheet: ${JSON.stringify(sh)}`);
    await B.type('#s-cinput', 'Love the orange');
    await B.keyboard.press('Enter');
    await B.waitForFunction(() => document.querySelectorAll('#s-clist .s-c').length === 1, { timeout: 8000 }).catch(() => {});
    const sent = await B.evaluate(() => ({ text: document.querySelector('#s-clist .s-ctext')?.textContent, tag: document.querySelector('#s-clist .s-ctag')?.textContent,
      count: document.getElementById('s-ccount').textContent, input: document.getElementById('s-cinput').value }));
    const onServer = await get('comments=pcat1');
    note(sent.text === 'Love the orange' && sent.tag === '@ben' && sent.count === '1' && sent.input === '' && onServer.count === 1,
      `after sending: ${JSON.stringify(sent)}, server ${onServer.count}`);
    await shot(B, '4-comments');
    // Hold it to delete it.
    const box = await (await B.$('#s-clist .s-c .s-ctext')).boundingBox();
    await B.mouse.move(box.x + 10, box.y + 5); await B.mouse.down(); await sleep(650); await B.mouse.up();
    await sleep(200);
    note(await B.evaluate(() => document.getElementById('modal').classList.contains('open') && document.getElementById('m-title').textContent === 'Delete comment?'), 'holding your comment did not offer to delete it');
    await B.click('#m-del'); await sleep(600);
    const left = await get('comments=pcat1');
    note(left.count === 0 && await B.evaluate(() => !document.querySelector('#s-clist .s-c') && document.getElementById('s-ccount').textContent === ''), `after deleting, server ${left.count}`);
    // The down arrow puts it away; closing the viewer takes it too.
    await B.click('#s-cclose'); await sleep(350);
    note(await B.evaluate(() => !document.getElementById('s-csheet').classList.contains('open')), 'the down arrow did not hide the sheet');
    console.log(`comments (app): ${JSON.stringify(sent)} -> deleted`);
  }

  // ---- 4. drawing together ---------------------------------------------------
  {
    const ivy = await signup('ivy');
    await B.click('#v-close'); await sleep(300);
    await B.setViewport({ width: 400, height: 820, isMobile: true });
    await B.evaluate(() => window.inkoBridge.openUser('ivy'));
    await B.waitForFunction(() => document.getElementById('s-bar').dataset.mode === 'user' && !document.getElementById('s-bar').hidden, { timeout: 8000 }).catch(() => {});
    await sleep(300);
    await B.click('#s-draw');
    await B.waitForFunction(() => window.inkoRoomState && window.inkoRoomState().open && document.getElementById('r-wait').hidden, { timeout: 10000 }).catch(() => {});
    const opened = await B.evaluate(() => ({ s: window.inkoRoomState && window.inkoRoomState(), title: document.getElementById('r-title').textContent }));
    note(opened.s && opened.s.open && opened.title === '@ben + @ivy', `the brushes on @ivy's profile: ${JSON.stringify(opened)}`);
    const box = (await post({ action: 'inbox', token: ivy.token })).body.invites || [];
    note(box.length === 1 && box[0].from === 'ben' && box[0].room === opened.s.id, `ivy's inbox: ${JSON.stringify(box)}`);
    const roomId = opened.s.id;
    // Nothing to press in the top half of the room.
    const topHalf = await B.evaluate(() => [...document.querySelectorAll('#room button')].filter(b => { const r = b.getBoundingClientRect(); return r.height && r.top < innerHeight / 2 && getComputedStyle(b).visibility !== 'hidden'; }).length);
    note(topHalf === 0, `${topHalf} button(s) in the room's top half`);
    const strokeOn = async (p, fx) => {
      const r = await p.evaluate(() => { const b = document.getElementById('r-pad').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
      await p.mouse.move(r.x + r.w * fx, r.y + r.h * 0.2); await p.mouse.down();
      await p.mouse.move(r.x + r.w * fx, r.y + r.h * 0.8, { steps: 14 }); await sleep(60); await p.mouse.up(); await sleep(500);
    };
    // Ink in one column of the pad, read off the pixels.
    const inkAt = (p, fx) => p.evaluate((fx) => { const c = document.getElementById('r-pad'), x = c.getContext('2d');
      const d = x.getImageData(Math.round(c.width * fx) - 3, Math.round(c.height * 0.5) - 3, 6, 6).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; }, fx);
    await strokeOn(B, 0.3);
    note(await inkAt(B, 0.3) > 0, 'ben\'s stroke did not show on his own pad');

    // Ivy: the card pops up, and Join takes her in.
    const I = await open({ handle: 'ivy', token: ivy.token });
    await I.waitForFunction(() => !document.getElementById('s-invite').hidden, { timeout: 8000 }).catch(() => {});
    const cardText = await I.evaluate(() => document.querySelector('#s-invite .s-inv-text')?.textContent);
    note(cardText === '@ben wants to draw with you', `the invitation card read ${JSON.stringify(cardText)}`);
    await shot(I, '5-invite-card');
    await I.click('#s-invite [data-join]');
    await I.waitForFunction(() => window.inkoRoomState && window.inkoRoomState().open && window.inkoRoomState().chunks > 0, { timeout: 10000 }).catch(() => {});
    await sleep(300);
    note(await inkAt(I, 0.3) > 0, 'ben\'s stroke did not reach ivy\'s pad');
    await strokeOn(I, 0.7);
    await B.waitForFunction(() => window.inkoRoomState().members.includes('ivy'), { timeout: 5000 }).catch(() => {});
    await sleep(500);
    note(await inkAt(B, 0.7) > 0, 'ivy\'s stroke did not reach ben\'s pad');
    const who = await B.evaluate(() => window.inkoRoomState().members.sort().join());
    note(who === 'ben,ivy', `the room says ${who} are in it`);

    // Chat, with an unread count on the other phone.
    await I.click('#r-chat'); await sleep(250);
    await I.type('#r-chatinput', 'hi ben'); await I.keyboard.press('Enter');
    await B.waitForFunction(() => document.getElementById('r-unread').textContent === '1', { timeout: 5000 }).catch(() => {});
    note(await B.evaluate(() => document.getElementById('r-unread').textContent) === '1', 'ben had no unread badge for ivy\'s message');
    await B.click('#r-chat'); await sleep(300);
    const said = await B.evaluate(() => ({ msgs: window.inkoRoomState().msgs, badge: document.getElementById('r-unread').textContent }));
    note(said.msgs.join('|') === 'ivy: hi ben' && said.badge === '', `ben's chat: ${JSON.stringify(said)}`);
    await shot(B, '6-room-chat');
    await B.click('#r-chatclose'); await sleep(400);
    await shot(B, '6b-room');

    // Undo takes back ben's stroke only, on both pads.
    await B.click('#r-undo');
    await sleep(900);
    const afterUndo = { b3: await inkAt(B, 0.3), b7: await inkAt(B, 0.7), i3: await inkAt(I, 0.3), i7: await inkAt(I, 0.7) };
    note(afterUndo.b3 === 0 && afterUndo.i3 === 0 && afterUndo.b7 > 0 && afterUndo.i7 > 0, `after ben's undo: ${JSON.stringify(afterUndo)}`);
    await shot(I, '7-room');

    // Leaving keeps a card in the gallery, and the room is listed to go back to.
    await B.click('#r-back'); await sleep(900);
    note(await B.evaluate(() => !window.inkoRoomState().open), 'back did not leave the room');
    await B.click('#g-tab-mine'); await sleep(500);
    const kept = await B.evaluate(() => [...document.querySelectorAll('#g-rows .g-title')].map(e => e.textContent));
    note(kept.includes('@ben + @ivy'), `the gallery after leaving: ${JSON.stringify(kept)}`);
    await B.click('#s-together-btn'); await sleep(600);
    const listed = await B.evaluate(() => [...document.querySelectorAll('#s-tlist .s-ctag')].map(e => e.textContent));
    note(listed.includes('@ben + @ivy'), `Draw together lists ${JSON.stringify(listed)}`);
    await shot(B, '8-together');
    console.log(`together: room ${roomId.slice(0, 6)}…, strokes both ways, chat ${JSON.stringify(said.msgs)}, undo ${JSON.stringify(afterUndo)}, kept and listed`);
    void rooms;
  }

  note(!errors.length, 'page errors: ' + errors.join(' | '));
} finally {
  await browser.close();
  server.close();
}
if (fail.length) { console.error(`\nsocial_check: ${fail.length} failed, ${pass} passed\n - ` + fail.join('\n - ')); process.exit(1); }
console.log(`\nsocial_check: ${pass} checks passed`);
