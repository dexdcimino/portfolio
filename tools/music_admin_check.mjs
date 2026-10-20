/* Drive the TUNES door: the live playlist, its backups, and editing it.
 *
 *   node tools/music_admin_check.mjs      # starts its own server, needs nothing
 *   node tools/music_admin_check.mjs --in-process # real handlers + browser interception, no local HTTP
 *
 * THREE LAYERS, each of which can be wrong on its own.
 *
 * 1. THE STORE, in-process. The id parser and its refusals, the title guess,
 *    the password fold, token expiry, and the backup tiers on a real directory:
 *    forty-five edits must leave the current hourly/daily/weekly backup slots,
 *    an empty list must be refused, and a playlist file that does not parse
 *    must be an ERROR rather than a quiet fall back to the seed -- the one path
 *    that would undo every edit ever made.
 *
 * 2. THE API over HTTP, against the real handler. Reading is public; every
 *    edit without a token is refused; editing opens for Dex signed in with no
 *    code, and the TUNES code opens nothing signed out or for someone else's
 *    Google (ID tokens this harness signs, checked by the real
 *    lib/site-identity.js against its own stand-in for Google's
 *    certificates); add, the duplicate, repeat, remove, the backup list and a
 *    restore that is itself backed up.
 *
 * 3. BROWSERS. MUSIC signed out -- read-only, ticks disabled, no minus --
 *    TUNES signed out and TUNES as someone else, both read-only, and plain
 *    MUSIC signed in as Dex (/account/site-auth.js answered by a fake that
 *    hands over the signed token), which is the editor with no code: it adds
 *    a song through the form, deletes one with two presses, ticks one onto
 *    REPEAT, and has every one of those turn up on the signed-out screen
 *    without a reload; then signing out ends editing on the spot.
 *
 * A ROOM OF ITS OWN, like chess_check: the dev server keeps the playlist under
 * its --dir, so a scratch directory is a fresh store seeded from tracks.json.
 * MUSIC_LOOKUP_OFFLINE keeps YouTube out of it -- whether oEmbed answers is not
 * a fact about this site.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, readdirSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const IN_PROCESS = process.argv.includes('--in-process');
const require = createRequire(import.meta.url);
const PORT = 8100 + ((process.pid + Date.now()) % 300);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found — set CHROME=<path to the exe>');

const fail = [];
let pass = 0;
const note = (ok, why) => { if (ok) pass++; else fail.push(why); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEED = require(join(ROOT, 'assets/music/tracks.json'));
const SEEDN = SEED.tracks.length;
const SEEDR = SEED.tracks.filter((t) => t.r).length;

const scratches = [];
const scratch = (tag) => { const d = mkdtempSync(join(tmpdir(), `tunes-${tag}-`)); scratches.push(d); return d; };

/* ---- 1. the store ---------------------------------------------------------- */
{
  process.env.NOTES_DEV_DIR = scratch('unit');
  process.env.TUNES_PASSWORD = 'tunes';
  delete process.env.VERCEL_ENV;
  const store = require(join(ROOT, 'lib/music-store.js'));

  const IDS = [
    ['https://youtu.be/6KkryIC0DEk?list=RD6KkryIC0DEk', '6KkryIC0DEk'],
    ['https://www.youtube.com/watch?v=Ngng8UyyaGQ&t=30s', 'Ngng8UyyaGQ'],
    ['youtube.com/shorts/IB1MlSvHq58', 'IB1MlSvHq58'],
    ['https://music.youtube.com/watch?v=sVx1mJDeUjY', 'sVx1mJDeUjY'],
    ['6KkryIC0DEk', '6KkryIC0DEk'],
    ['https://www.youtube.com/playlist?list=PL123', null],
    ['https://vimeo.com/123456789', null],
    ['not a link at all', null],
  ];
  note(IDS.filter(([, want]) => want === null).length === 3, 'the id table lost a refusal');
  for (const [input, want] of IDS) {
    note(store.parseId(input) === want, `parseId(${input}) gave ${store.parseId(input)}, wanted ${want}`);
  }
  const g = store.guess('Iron Jarl - Natty or Not (Official Music Video) | No Talk. Just Work.', 'Iron Jarl');
  note(g.a === 'Iron Jarl' && g.t === 'Natty or Not', `the title guess read ${JSON.stringify(g)}`);

  note(await store.passwordOk('TUNES') && await store.passwordOk('tunes'), 'the code is not case-folded like the vault folds it');
  note(!(await store.passwordOk('tune')) && !(await store.passwordOk('')), 'a wrong code unlocked editing');
  const tok = store.mintToken();
  note(store.tokenOk(tok), 'a fresh token is refused');
  note(!store.tokenOk(`${tok}x`), 'a tampered token is accepted');
  note(!store.tokenOk(store.mintToken(Date.now() - 13 * 3600 * 1000)), 'a token past its twelve hours is accepted');

  let doc = await store.read();
  note(doc.seeded && doc.tracks.length === SEEDN, `the first read is ${doc.tracks.length} tracks, seeded ${doc.seeded}`);

  // Repeated edits must retain just the current three backup tiers.
  for (let i = 0; i < 45; i++) {
    const next = doc.tracks.map((t, k) => (k === 0 ? { ...t, r: i % 2 === 0 } : t));
    doc = await store.write(doc, next);
  }
  const dir = process.env.NOTES_DEV_DIR;
  const edits = readdirSync(join(dir, 'music/backups')).length;
  note(doc.rev === 45, `45 edits left rev ${doc.rev}`);
  note(edits === 3, `${edits} backup slots after 45 edits, expected 3`);
  note((await store.listBackups()).map(b => b.kind).join() === 'hourly,daily,weekly', 'the three backup tiers are not in order');

  let threw = false;
  try { await store.write(doc, []); } catch { threw = true; }
  note(threw, 'an empty playlist was saved');
  note(await store.readBackup('../../etc/passwd') === null, 'a path outside the backups was read');
  const list = await store.listBackups();
  note(list.length === 3 && list[0].label >= list[list.length - 1].label, `the backup list has ${list.length} entries, newest first`);
  note((await store.readBackup(list[0].name) || []).length === SEEDN, 'the newest backup does not read back');

  /* A PLAYLIST THAT DOES NOT PARSE IS AN ERROR. Falling back to the seed here
     would silently undo every edit ever made, which is the one outcome the
     backups cannot fix because nobody would know to use them. */
  writeFileSync(join(dir, 'music/playlist.json'), '{ this is not json');
  let broken = false;
  try { await store.read(); } catch { broken = true; }
  note(broken, 'a corrupt playlist quietly fell back to the seed');
  console.log(`store: ${IDS.length} links parsed, 45 edits -> ${edits} backup slots, corrupt file refused`);
}

/* ---- 2. the API ------------------------------------------------------------- */

/* ---- Google, as far as the server can tell ---- */
const PROJECT = 'tunes-check-project';
const gkey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const certs = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' });
  res.end(JSON.stringify({ k1: gkey.publicKey.export({ type: 'spki', format: 'pem' }) }));
});
await new Promise((r) => certs.listen(0, '127.0.0.1', r));
certs.unref();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(email) {
  const t = Math.floor(Date.now() / 1000);
  const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const p = b64({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, iat: t - 5, exp: t + 3600, auth_time: t - 5, sub: email,
    email, email_verified: true, firebase: { identities: { 'google.com': [email] }, sign_in_provider: 'google.com' } });
  return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), gkey.privateKey).toString('base64url')}`;
}
const DEX = idToken('dexdcimino@gmail.com');
const SOMEONE = idToken('someone@gmail.com');

const serverDir = scratch('api');
const serverEnv = { ...process.env, MUSIC_LOOKUP_OFFLINE: '1', TUNES_PASSWORD: 'tunes',
  SITE_AUTH_PROJECT: PROJECT, SITE_AUTH_CERTS_URL: `http://127.0.0.1:${certs.address().port}/certs` };
const networkFetch = globalThis.fetch;
if (IN_PROCESS) {
  Object.assign(process.env, serverEnv, { NOTES_DEV_DIR: serverDir, AUTH_SECRET: 'dev-auth-secret' });
  globalThis.fetch = async (url, options) => String(url) === serverEnv.SITE_AUTH_CERTS_URL
    ? new Response(JSON.stringify({ k1: gkey.publicKey.export({ type: 'spki', format: 'pem' }) }), { headers: { 'cache-control': 'public, max-age=600' } })
    : networkFetch(url, options);
}
const playlistHandler = IN_PROCESS ? require(join(ROOT, 'api/music/playlist.js')) : null;
async function localApi(body, handler = playlistHandler, headers = {}) {
  let status = 200, data;
  const response = { setHeader() {}, status(code) { status = code; return this; }, json(value) { data = value; return this; } };
  await handler({ method: body ? 'POST' : 'GET', body, query: {}, headers }, response);
  return { status, data };
}
const server = IN_PROCESS ? { killed: false, kill() { this.killed = true; } } : spawn(process.execPath,
  [join(ROOT, 'tools/notes_dev_server.mjs'), '--port', String(PORT), '--dir', serverDir],
  { stdio: ['ignore', 'pipe', 'pipe'], env: serverEnv });
server.stderr?.on('data', (d) => { if (/EADDRINUSE|Error/.test(String(d))) console.error('dev server: ' + String(d).trim()); });
const stop = () => {
  if (!server.killed) server.kill();
  for (const d of scratches) { try { rmSync(d, { recursive: true, force: true }); } catch { /* temp */ } }
};
process.on('exit', stop);

const api = async (body) => {
  if (IN_PROCESS) return localApi(body);
  const res = body
    ? await fetch(`${BASE}/api/music/playlist`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    : await fetch(`${BASE}/api/music/playlist`);
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
};

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try { up = (await api()).status === 200; } catch { await sleep(250); }
}
if (!up) { console.error(`music_admin_check: the dev server never answered at ${BASE}`); stop(); process.exit(1); }

let TOKEN = null;
{
  let r = await api();
  note(r.data.count === SEEDN && r.data.seeded, `GET is ${r.data.count} tracks, seeded ${r.data.seeded}`);
  r = await api({ action: 'add', url: 'HarnessTst1', t: 'T', a: 'A' });
  note(r.status === 401, `an add with no token came back ${r.status}`);
  r = await api({ action: 'unlock', code: 'TUNES' });
  note(r.status === 401 && !r.data.token, `TUNES signed out came back ${r.status}`);
  r = await api({ action: 'unlock', code: 'TUNES', idToken: SOMEONE });
  note(r.status === 401 && !r.data.token, `TUNES as someone else came back ${r.status}`);
  r = await api({ action: 'unlock', idToken: DEX });
  note(r.status === 200 && !!r.data.token, `Dex signed in, no code, came back ${r.status}`);
  TOKEN = r.data.token;

  r = await api({ action: 'lookup', token: TOKEN, url: 'https://vimeo.com/1' });
  note(r.status === 400, `a Vimeo link looked up as ${r.status}`);
  r = await api({ action: 'lookup', token: TOKEN, url: SEED.tracks[3].u });
  note(r.status === 200 && r.data.already === true, 'a link already in the list was not called out');
  r = await api({ action: 'add', token: TOKEN, url: 'HarnessTst1', t: '', a: 'A' });
  note(r.status === 400, `an add with no title came back ${r.status}`);
  r = await api({ action: 'add', token: TOKEN, url: 'https://youtu.be/HarnessTst1', t: 'Harness Song', a: 'Harness Band', repeat: true });
  note(r.status === 200 && r.data.count === SEEDN + 1 && !r.data.seeded, `the add came back ${r.status} with ${r.data && r.data.count}`);
  note(r.data.tracks.find(t => t.v === 'HarnessTst1')?.r === true, 'adding from Repeat must save library and repeat membership atomically');
  r = await api({ action: 'add', token: TOKEN, url: 'HarnessTst1', t: 'Again', a: 'Again' });
  note(r.status === 409, `the same video twice came back ${r.status}`);
  r = await api({ action: 'repeat', token: TOKEN, v: 'HarnessTst1', on: true });
  note(r.data.tracks.filter((t) => t.r).length === SEEDR + 1, 'ticking a track onto REPEAT did not stick');
  r = await api({ action: 'remove', token: TOKEN, v: 'HarnessTst1' });
  note(r.status === 200 && !r.data.tracks.some((t) => t.v === 'HarnessTst1'), 'the remove did not remove');
  r = await api({ action: 'remove', token: TOKEN, v: 'HarnessTst1' });
  note(r.status === 404, `removing it twice came back ${r.status}`);
  r = await api({ action: 'repeat', token: `${TOKEN}x`, v: SEED.tracks[0].v, on: true });
  note(r.status === 401, `a tampered token edited, status ${r.status}`);

  r = await api({ action: 'backups', token: TOKEN });
  const backups = r.data.backups || [];
  const editsOnly = backups.filter((b) => b.kind === 'hourly');
  /* Hourly keeps the latest replaced document; daily keeps the first one. */
  note(editsOnly.length === 1, `${editsOnly.length} edit backups after three edits`);
  note(editsOnly[0] && editsOnly[0].count === SEEDN + 1, `the newest backup holds ${editsOnly[0] && editsOnly[0].count}`);
  /* THE DAY'S COPY IS THE DAY BEFORE ITS FIRST EDIT. That edit was an add, so
     the start of the day is the seed, not the seed plus one. */
  const daily = backups.filter((b) => b.kind === 'daily');
  note(daily.length === 1 && daily[0].count === SEEDN,
       `the daily backup holds ${daily[0] && daily[0].count} tracks, the day started with ${SEEDN}`);
  const oldest = editsOnly[editsOnly.length - 1];
  r = await api({ action: 'restore', token: TOKEN, name: oldest.name });
  note(r.status === 200 && r.data.count === oldest.count, `restoring the oldest backup came back ${r.status} with ${r.data && r.data.count}`);
  r = await api({ action: 'backups', token: TOKEN });
  note(r.data.backups.length === 3 && r.data.backups[0].count === SEEDN, 'the restore did not back up the list it replaced');
  console.log(`api: public read, 401 without a token, add/duplicate/repeat/remove, ${editsOnly.length} backups, restore backed up`);
}

/* ---- 3. two browsers --------------------------------------------------------- */

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', pipe: IN_PROCESS, args: ['--no-sandbox', '--mute-audio'], defaultViewport: { width: 1400, height: 950 } });
// Finite silent PCM media exercises the real HTMLMediaElement ended event without
// relying on canvas capture/GPU availability in a headless sandbox.
const fixtureVideo = Buffer.alloc(44 + 16000 * 2 * 2);
fixtureVideo.write('RIFF', 0); fixtureVideo.writeUInt32LE(fixtureVideo.length - 8, 4);
fixtureVideo.write('WAVEfmt ', 8); fixtureVideo.writeUInt32LE(16, 16);
fixtureVideo.writeUInt16LE(1, 20); fixtureVideo.writeUInt16LE(1, 22);
fixtureVideo.writeUInt32LE(16000, 24); fixtureVideo.writeUInt32LE(32000, 28);
fixtureVideo.writeUInt16LE(2, 32); fixtureVideo.writeUInt16LE(16, 34);
fixtureVideo.write('data', 36); fixtureVideo.writeUInt32LE(fixtureVideo.length - 44, 40);
let mediaLookups = 0, refuseMedia = false, refuseAdd = false, refuseImport = false;


/* Signed in: the site-auth mirror flag set, and site-auth.js answered by a
   fake whose idToken() is a token signed above. Signed out: neither. */
const FAKE_SITE_AUTH = (token) => `export const LOCAL_FLAG = 'site:signedIn';
export async function idToken() { return ${JSON.stringify(token)}; }
export async function currentUser() { return { uid: 'u' }; }
export function onUser(fn) { setTimeout(() => fn({ uid: 'u' }), 0); return () => {}; }`;
const localCSP = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')).headers
  .find(h => h.source === '/(.*)').headers.find(h => h.key === 'Content-Security-Policy').value.replace(/;\s*upgrade-insecure-requests/, '');
async function localRequest(req) {
  const url = new URL(req.url());
  if (url.origin !== BASE) return req.abort();
  if (['/api/music/playlist', '/api/auth/unlock', '/api/auth/verify'].includes(url.pathname)) {
    const handler = url.pathname === '/api/music/playlist' ? playlistHandler : require(join(ROOT, url.pathname + '.js'));
    const response = await localApi(req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : undefined, handler, req.headers());
    return req.respond({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.data) });
  }
  if (url.pathname.startsWith('/api/')) return req.respond({ status: 404, contentType: 'application/json', body: '{}' });
  const file = resolve(ROOT, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(ROOT + '/') && !file.startsWith(ROOT + '\\')) return req.abort();
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.avif': 'image/avif', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
  try { return req.respond({ status: 200, contentType: types[extname(file)] || 'application/octet-stream', headers: { 'Content-Security-Policy': localCSP }, body: readFileSync(file) }); }
  catch { return req.respond({ status: 404, body: '404' }); }
}
async function door(event, code, name, signedIn = null, legacyPlaylists = null) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  if (legacyPlaylists) await page.evaluateOnNewDocument(playlists => { localStorage.setItem('dex-music-playlists', JSON.stringify(playlists)); }, legacyPlaylists);
  if (signedIn) await page.evaluateOnNewDocument(() => { try { localStorage.setItem('site:signedIn', '1'); } catch { /* */ } });
  await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
  /* The embed is not what this checks, and it autoplays. Refused at the wire,
     the way music_check does it, so no test waits on YouTube. */
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (refuseImport && req.url().endsWith('/api/music/playlist') && req.method() === 'POST' && JSON.parse(req.postData() || '{}').action === 'playlist-import') return req.respond({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'music changed while saving' }) });
    if (refuseAdd && req.url().endsWith('/api/music/playlist') && req.method() === 'POST' && JSON.parse(req.postData() || '{}').action === 'add') return req.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'test save refused' }) });
    if (req.url().includes('/api/music/media?')) { mediaLookups++; return req.respond({ status: refuseMedia ? 422 : 200, contentType: 'application/json', body: JSON.stringify(refuseMedia ? { error: 'unavailable' } : { url: 'https://test.cdninstagram.com/fixture.wav' }) }); }
    if (req.url() === 'https://test.cdninstagram.com/fixture.wav') return req.respond({ status: 200, contentType: 'audio/wav', body: fixtureVideo });
    if (/^https:\/\/(www.instagram.com|player.vimeo.com|w.soundcloud.com|open.spotify.com|www.tiktok.com|bandcamp.com)\//.test(req.url())) return req.respond({ status: 200, contentType: 'text/html', body: '<button id="native-play">Provider play</button>' });
    if (/youtube|ytimg|googlevideo/.test(req.url())) return req.abort();
    if (signedIn && req.url().endsWith('/account/site-auth.js')) return req.respond({ status: 200, contentType: 'text/javascript', body: FAKE_SITE_AUTH(signedIn) });
    if (IN_PROCESS) return localRequest(req);
    return req.continue();
  });
  page.on('pageerror', (e) => fail.push(`pageerror (${name}): ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/youtube|ytimg|Failed to load resource|net::|ERR_/i.test(m.text())) return;
    /* KNOWN, AND NOT THIS FEATURE: the media-session hold in MediaBus plays a
       blob: WAV, and the site's own CSP (media-src) does not allow blob:. It
       predates TUNES -- it is in the commit before this file existed -- and
       this is the first harness to run the music under the shipped CSP.
       Reported rather than silently fixed; delete this line with the fix. */
    if (/Loading media from\s+'blob:/.test(m.text())) return;
    // Existing cursor boot markup has these two exact CSP violations; unrelated to embeds.
    if (/sha256-yfeeyJJFv0e0ETclMoA\/fQpcw8fQzfeyHwr3xcTLMbA=|sha256-SDDSKD\+gm5Y\/3ONeJpDILYC3YFvKXREhacfb0i9Rsxw=/.test(m.text())) return;
    fail.push(`console (${name}): ${m.text()}`);
  });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate((ev, c) => document.dispatchEvent(new CustomEvent(ev, { detail: { code: c } })), event, code);
  await page.waitForFunction(() => document.querySelectorAll('#musicRows .music-row').length > 300, { timeout: 20000 });
  await sleep(900);
  return { context, page, name };
}

const state = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('#musicRows .music-row')];
  return {
    rows: rows.length,
    admin: document.getElementById('musicModal').classList.contains('is-admin'),
    title: document.getElementById('musicTitle').textContent.trim(),
    add: !document.getElementById('musicAdd').hidden,
    backups: !document.getElementById('musicBackups').hidden,
    del: document.querySelectorAll('#musicRows .music-del').length,
    enabled: document.querySelectorAll('#musicRows .music-playlist-add:not(:disabled)').length,
    cells: rows[0] ? rows[0].children.length : 0,
    toast: document.getElementById('musicToast').textContent,
  };
});
const has = (page, v) => page.evaluate((id) => !!document.querySelector(`.music-row[data-v="${id}"]`), v);
const pull = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
async function centre(page, selector) {
  await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center', behavior: 'instant' }), selector);
  await sleep(300);
  return page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, selector);
}

try {
  const viewer = await door('music:open', '', 'MUSIC');
  const editor = await door('music:open', '', 'MUSIC as Dex', DEX);
  const wrong = await door('tunes:open', 'tunes', 'TUNES as someone else', SOMEONE);
  const out = await door('tunes:open', 'tunes', 'TUNES signed out');

  const v0 = await state(viewer.page);
  note(!v0.admin && v0.title === 'MUSIC', `MUSIC opened as ${v0.title}, admin ${v0.admin}`);
  note(!v0.add && !v0.backups && v0.del === 0 && v0.enabled === 0 && v0.cells === 5,
       `MUSIC shows add ${v0.add}, backups ${v0.backups}, ${v0.del} minus, ${v0.enabled} live ticks, ${v0.cells} cells`);
  const e0 = await state(editor.page);
  /* DEX SIGNED IN IS THE EDITOR, through plain MUSIC and no code at all. */
  note(e0.admin && e0.title === 'MUSIC', `MUSIC as Dex opened as ${e0.title}, admin ${e0.admin}`);
  note(e0.add && e0.backups && e0.del === e0.rows && e0.enabled === e0.rows && e0.cells === 7,
       `MUSIC as Dex shows add ${e0.add}, backups ${e0.backups}, ${e0.del} minus for ${e0.rows} rows, ${e0.cells} cells`);
  const w0 = await state(wrong.page);
  note(!w0.admin && !w0.add && w0.del === 0 && w0.enabled === 0, `TUNES as someone else: admin ${w0.admin}, add ${w0.add}, ${w0.del} minus`);
  await wrong.context.close();
  /* THE OLD CODE, SIGNED OUT: read-only, like any visitor. */
  const o0 = await state(out.page);
  note(!o0.admin && !o0.add && o0.del === 0 && o0.enabled === 0, `TUNES signed out: admin ${o0.admin}, add ${o0.add}, ${o0.del} minus`);
  await out.context.close();

  /* ADD, through the form, with real keys. */
  await editor.page.click('#musicAdd');
  await sleep(200);
  note(await editor.page.evaluate(() => document.activeElement.id === 'musicAddUrl'), 'the link field does not have the caret when the form opens');
  await editor.page.keyboard.type('https://youtu.be/HarnessTst2?list=RDHarnessTst2');
  await editor.page.waitForFunction(() => !document.getElementById('musicAddFound').hidden, { timeout: 5000 }).catch(() => {});
  note(await editor.page.evaluate(() => document.getElementById('musicAddSave').disabled), 'Add is pressable before there is a title');
  await editor.page.click('#musicAddTitle');
  await editor.page.keyboard.type('Harness Anthem');
  await editor.page.click('#musicAddArtist');
  await editor.page.keyboard.type('The Checks');
  note(!(await editor.page.evaluate(() => document.getElementById('musicAddSave').disabled)), 'Add stays dead with a link, a title and an artist');
  await editor.page.click('#musicAddSave');
  await editor.page.waitForFunction(() => !!document.querySelector('.music-row[data-v="HarnessTst2"]'), { timeout: 5000 }).catch(() => {});
  const added = await editor.page.evaluate(() => ({
    row: !!document.querySelector('.music-row[data-v="HarnessTst2"]'),
    lit: !!document.querySelector('.music-row[data-v="HarnessTst2"].is-new'),
    panel: document.getElementById('musicAddPanel').hidden,
    n: document.querySelectorAll('#musicRows .music-row').length,
  }));
  note(added.row && added.panel, `after Add: row ${added.row}, form closed ${added.panel}`);
  note(added.lit, 'the new row is not lit where it landed');
  await pull(viewer.page);
  await viewer.page.waitForFunction(() => !!document.querySelector('.music-row[data-v="HarnessTst2"]'), { timeout: 5000 }).catch(() => {});
  note(await has(viewer.page, 'HarnessTst2'), 'the song added in TUNES never reached the MUSIC screen');

  /* ESCAPE closes the form and nothing else. */
  await editor.page.click('#musicAdd');
  await sleep(150);
  await editor.page.keyboard.press('Escape');
  await sleep(200);
  const esc = await editor.page.evaluate(() => ({ panel: document.getElementById('musicAddPanel').hidden, open: document.getElementById('musicModal').open }));
  note(esc.panel && esc.open, `Escape in the form: form closed ${esc.panel}, overlay still open ${esc.open}`);

  /* MINUS: two presses, and a press elsewhere or a wait puts it back. */
  const sel = '.music-row[data-v="HarnessTst2"] .music-del';
  let at = await centre(editor.page, sel);
  await editor.page.mouse.click(at.x, at.y);
  await sleep(250);
  const armed = await editor.page.evaluate((s) => {
    const b = document.querySelector(s);
    return { armed: b.classList.contains('is-armed'), word: b.textContent.trim(), w: Math.round(b.getBoundingClientRect().width),
             bg: getComputedStyle(b).backgroundColor, still: !!b.closest('.music-row') };
  }, sel);
  note(armed.armed && armed.word === 'SURE?' && armed.w > 60, `one press: armed ${armed.armed}, says "${armed.word}", ${armed.w}px`);
  note(/229, 72, 77/.test(armed.bg), `the armed pill is ${armed.bg}, not red`);
  note(armed.still && await has(editor.page, 'HarnessTst2'), 'one press removed the track');
  await sleep(3900);
  note(!(await editor.page.evaluate((s) => document.querySelector(s).classList.contains('is-armed'), sel)), 'the armed delete did not stand down after 3.5 seconds');

  at = await centre(editor.page, sel);
  await editor.page.mouse.click(at.x, at.y);
  await sleep(200);
  const t = await centre(editor.page, '.music-row[data-v="HarnessTst2"] .music-title');
  await editor.page.mouse.click(t.x, t.y);
  await sleep(200);
  note(!(await editor.page.evaluate((s) => document.querySelector(s)?.classList.contains('is-armed'), sel)), 'a press elsewhere did not disarm the delete');

  at = await centre(editor.page, sel);
  await editor.page.mouse.click(at.x, at.y);
  await sleep(250);
  at = await editor.page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, sel);
  await editor.page.mouse.click(at.x, at.y);
  await editor.page.waitForFunction(() => !document.querySelector('.music-row[data-v="HarnessTst2"]'), { timeout: 5000 }).catch(() => {});
  note(!(await has(editor.page, 'HarnessTst2')), 'two presses did not delete the track');
  await pull(viewer.page);
  await viewer.page.waitForFunction(() => !document.querySelector('.music-row[data-v="HarnessTst2"]'), { timeout: 5000 }).catch(() => {});
  note(!(await has(viewer.page, 'HarnessTst2')), 'the delete in TUNES never reached the MUSIC screen');

  // Create a custom playlist through the existing form, then use the new row picker.
  await editor.page.click('#musicAddPlaylist');
  await editor.page.type('#musicPlaylistName', 'Stillness');
  await editor.page.click('.music-playlist-ok');
  await editor.page.waitForFunction(() => document.getElementById('musicPlaylistForm').hidden);
  await editor.page.click('#musicViewAll');
  const customId = await editor.page.evaluate(() => JSON.parse(localStorage.getItem('dex-music-playlists-shared-cache-v1')).find(p => p.name === 'Stillness').id);

  /* A TICK in TUNES is a tick on every screen. */
  const target = await editor.page.evaluate(() => [...document.querySelectorAll('#musicRows .music-row')]
    .find((r) => !(r.querySelector('.music-playlist-add').dataset.repeat === 'true')).dataset.v);
  at = await centre(editor.page, `.music-row[data-v="${target}"] .music-playlist-add`);
  await editor.page.mouse.click(at.x, at.y);
  await editor.page.waitForSelector('#musicPlaylistPicker[open]');
  const picker = await editor.page.evaluate(() => ({ names: [...document.querySelectorAll('.music-picker-entry span')].map(e => e.textContent), all: document.querySelector('.music-picker-entry input[data-playlist="all"]').disabled }));
  note(picker.names.join() === 'ALL,REPEAT,Stillness' && picker.all, `all current playlists appear in the picker: ${JSON.stringify(picker)}`);
  await editor.page.click('.music-picker-entry:has(input[data-playlist="repeat"]) span');
  await editor.page.waitForFunction(() => !document.querySelector('.music-picker-entry input[data-playlist="repeat"]').disabled);
  await editor.page.click(`.music-picker-entry:has(input[data-playlist="${customId}"]) span`);
  await editor.page.waitForFunction(id => !document.querySelector(`.music-picker-entry input[data-playlist="${id}"]`).disabled, {}, customId);
  note(await editor.page.evaluate(v => JSON.parse(localStorage.getItem('dex-music-playlists-shared-cache-v1')).find(p => p.name === 'Stillness').tracks.includes(v), target), 'the song was not saved to Stillness immediately');
  await editor.page.click('.music-picker-okay');
  note(await editor.page.evaluate(() => !document.getElementById('musicPlaylistPicker')), 'Okay did not close the picker');
  await sleep(700);
  note(await editor.page.evaluate((v) => (document.querySelector(`.music-row[data-v="${v}"] .music-playlist-add`).dataset.repeat === 'true'), target), 'ticking in TUNES did not tick');
  await pull(viewer.page);
  await sleep(900);
  const seen = await viewer.page.evaluate((v) => {
    const box = document.querySelector(`.music-row[data-v="${v}"] .music-playlist-add`);
    return { checked: box.dataset.repeat === 'true', disabled: box.disabled };
  }, target);
  note(seen.checked && seen.disabled, `MUSIC sees that tick as checked ${seen.checked}, disabled ${seen.disabled}`);

  // Removing from a custom playlist updates its visible rows while its picker stays open.
  await editor.page.click('#musicCustomPlaylists .music-rail-pl > button');
  note(await has(editor.page, target), 'the selected song was not present in Stillness');
  at = await centre(editor.page, `.music-row[data-v="${target}"] .music-playlist-add`);
  await editor.page.mouse.click(at.x, at.y);
  await editor.page.click(`.music-picker-entry:has(input[data-playlist="${customId}"]) span`);
  await editor.page.waitForFunction(id => !document.querySelector(`.music-picker-entry input[data-playlist="${id}"]`).disabled, {}, customId);
  note(!(await has(editor.page, target)) && await editor.page.evaluate(() => document.getElementById('musicPlaylistPicker').open), 'removing membership failed to update the list or closed the picker');
  await editor.page.click(`.music-picker-entry:has(input[data-playlist="${customId}"]) span`);
  await editor.page.waitForFunction(id => !document.querySelector(`.music-picker-entry input[data-playlist="${id}"]`).disabled, {}, customId);
  note(await has(editor.page, target), 'checking Stillness again did not return the song');
  await editor.page.keyboard.press('Escape');
  note(await editor.page.evaluate(() => !document.getElementById('musicPlaylistPicker') && document.getElementById('musicModal').open), 'Escape closed the music overlay instead of just the picker');
  at = await centre(editor.page, `.music-row[data-v="${target}"] .music-playlist-add`);
  await editor.page.mouse.click(at.x, at.y); await editor.page.mouse.click(20, 20);
  note(await editor.page.evaluate(() => !document.getElementById('musicPlaylistPicker') && document.getElementById('musicModal').open), 'outside click failed to dismiss just the picker');
  await editor.page.click('#musicViewAll');

  // The shared repeat list also removes and returns its selected row live.
  await editor.page.click('#musicViewRepeat');
  at = await centre(editor.page, `.music-row[data-v="${target}"] .music-playlist-add`);
  await editor.page.mouse.click(at.x, at.y);
  await editor.page.click('.music-picker-entry:has(input[data-playlist="repeat"]) span');
  await editor.page.waitForFunction(() => !document.querySelector('.music-picker-entry input[data-playlist="repeat"]').disabled);
  note(!(await has(editor.page, target)) && await editor.page.evaluate(() => document.getElementById('musicPlaylistPicker').open), 'removing Repeat membership did not update its visible playlist live');
  await editor.page.click('.music-picker-entry:has(input[data-playlist="repeat"]) span');
  await editor.page.waitForFunction(() => !document.querySelector('.music-picker-entry input[data-playlist="repeat"]').disabled);
  note(await has(editor.page, target), 'checking Repeat again did not restore the song');
  await editor.page.click('.music-picker-okay');
  await editor.page.click('#musicViewAll');
  await editor.page.setViewport({ width: 390, height: 844 });
  await editor.page.setViewport({ width: 1400, height: 950 });
  note(await editor.page.$eval('#musicRows .music-row', row => { const left = sel => row.querySelector(sel).getBoundingClientRect().left; return left('.music-copy') < left('.music-rename') && left('.music-rename') < left('.music-playlist-add') && left('.music-playlist-add') < left('.music-del'); }), 'desktop song actions must keep their original order');
  for (const width of [320, 390]) {
    await editor.page.setViewport({ width, height: 844 });
    const header = await editor.page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, cy: (r.top + r.bottom) / 2, bottom: r.bottom, top: r.top }; };
      return { count: rect('#musicCount'), backups: rect('#musicBackups'), add: rect('#musicAdd'), sort: rect('.music-sort'), search: rect('#musicSearch') };
    });
    note(Math.abs(header.count.cy - header.backups.cy) < 2 && Math.abs(header.add.cy - header.count.cy) < 2 && header.count.right <= header.backups.left && header.backups.right <= header.add.left && header.add.right <= width - 12, `mobile ${width}: count, Backups and far-right Add Song must share a row: ${JSON.stringify(header)}`);
    note(Math.abs(header.sort.cy - header.search.cy) < 2 && header.sort.right < header.search.left && header.search.right <= width - 12 && header.search.top > header.add.bottom, `mobile ${width}: search must sit right of Title/Artist below the song actions: ${JSON.stringify(header)}`);
    const actions = await editor.page.$eval('#musicRows .music-row', row => {
      const rect = sel => { const r = row.querySelector(sel).getBoundingClientRect(); return { left: r.left, right: r.right, cy: (r.top + r.bottom) / 2, width: r.width, height: r.height }; };
      return { meta: rect('.music-meta'), copy: rect('.music-copy'), del: rect('.music-del'), edit: rect('.music-rename'), playlist: rect('.music-playlist-add') };
    });
    note(actions.copy.right <= actions.del.left && actions.del.right <= actions.edit.left && actions.edit.right <= actions.playlist.left && Object.values(actions).every(r => Math.abs(r.cy - actions.meta.cy) < 2), `mobile ${width}: Copy, Delete, Edit and Playlist must share the title/artist row in that order: ${JSON.stringify(actions)}`);
    note(actions.del.width === actions.copy.width && actions.del.height === actions.copy.height && actions.del.width === actions.edit.width && actions.del.height === actions.edit.height, `mobile ${width}: delete must match copy/edit size`);
    const flagged = await editor.page.$eval('#musicRows .music-row', row => {
      const flag = row.querySelector('.music-flag'), wasHidden = flag.hidden; flag.hidden = false;
      const mid = sel => { const r = row.querySelector(sel).getBoundingClientRect(); return (r.top + r.bottom) / 2; };
      const fits = ['.music-copy', '.music-del', '.music-rename', '.music-playlist-add', '.music-flag'].every(sel => Math.abs(mid(sel) - mid('.music-meta')) < 2);
      flag.hidden = wasHidden; return fits;
    });
    note(flagged, `mobile ${width}: a playback warning must not push delete onto another row`);
    await editor.page.click('#musicRows .music-row .music-del');
    const armedRow = await editor.page.$eval('#musicRows .music-row', row => { const meta = row.querySelector('.music-meta').getBoundingClientRect(), del = row.querySelector('.music-del').getBoundingClientRect(); return { cy: (del.top + del.bottom) / 2, metaCY: (meta.top + meta.bottom) / 2, height: row.getBoundingClientRect().height, armed: row.querySelector('.music-del').classList.contains('is-armed') }; });
    note(armedRow.armed && Math.abs(armedRow.cy - armedRow.metaCY) < 2, `mobile ${width}: confirming deletion must stay on the same song row`);
    await editor.page.click('#musicSearch');
    await editor.page.screenshot({ path: join(ROOT, `.notes-dev/shots/music-header-${width}.png`) });
  }
  at = await centre(editor.page, `.music-row[data-v="${target}"] .music-playlist-add`);
  await editor.page.mouse.click(at.x, at.y);
  const mobilePicker = await editor.page.evaluate(() => { const r = document.getElementById('musicPlaylistPicker').getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
  note(mobilePicker.left >= 12 && mobilePicker.right <= 378 && mobilePicker.top >= 12 && mobilePicker.bottom <= 832, `the anchored picker fits the phone: ${JSON.stringify(mobilePicker)}`);
  await editor.page.screenshot({ path: join(ROOT, '.notes-dev/shots/music-playlists-phone.png') });
  await editor.page.click('.music-picker-okay');
  note(await editor.page.$eval('#musicRows .music-row', row => { const meta = row.querySelector('.music-meta').getBoundingClientRect(), add = row.querySelector('.music-playlist-add').getBoundingClientRect(); return add.left > meta.right && Math.abs((add.top + add.bottom) / 2 - (meta.top + meta.bottom) / 2) < 2; }), 'owner mobile playlist icon must stay on the right of its song');
  await viewer.page.setViewport({ width: 390, height: 844 });
  note(await viewer.page.evaluate(() => { const sort = document.querySelector('.music-sort').getBoundingClientRect(), search = document.getElementById('musicSearch').getBoundingClientRect(), count = document.getElementById('musicCount').getBoundingClientRect(); return Math.abs(sort.top - search.top) < 3 && sort.right < search.left && count.bottom < search.top; }), 'visitor mobile header must keep search beside sorting and song count above');
  note(await viewer.page.$eval('#musicRows .music-row', row => { const meta = row.querySelector('.music-meta').getBoundingClientRect(), add = row.querySelector('.music-playlist-add').getBoundingClientRect(); return add.left > meta.right && Math.abs((add.top + add.bottom) / 2 - (meta.top + meta.bottom) / 2) < 2; }), 'visitor mobile playlist icon must stay on the right of its song');
  await viewer.page.setViewport({ width: 1400, height: 950 });
  const plus = await editor.page.$eval('#musicAddPlaylist', e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  note(plus.w === 44 && plus.h === 44, `mobile new playlist is a square plus: ${JSON.stringify(plus)}`);
  await editor.page.click('#musicAddPlaylist');
  note(await editor.page.evaluate(() => document.querySelector('.music-rail').classList.contains('is-expanded') && !document.getElementById('musicPlaylistForm').hidden), 'phone plus should expand the rail and open its form');
  const nameBounds = await editor.page.$eval('#musicPlaylistName', e => { const r = e.getBoundingClientRect(); return { w: r.width, right: r.right }; });
  note(nameBounds.w >= 180 && nameBounds.right <= 390, `mobile playlist name input is usable: ${JSON.stringify(nameBounds)}`);
  await editor.page.type('#musicPlaylistName', 'Phone playlist');
  await editor.page.click('.music-playlist-ok');
  await editor.page.waitForFunction(() => document.getElementById('musicPlaylistForm').hidden);
  note(await editor.page.evaluate(() => [...document.querySelectorAll('#musicCustomPlaylists .music-rail-label')].some(e => e.textContent === 'PHONE PLAYLIST' && e.getBoundingClientRect().width > 0)), 'new phone playlist should have a visible name in the expanded rail');
  await editor.page.click('.music-rail-toggle');
  note(await editor.page.$eval('.music-rail', e => !e.classList.contains('is-expanded')), 'phone rail collapse control failed');
  const railBlank = await editor.page.$eval('.music-rail', e => { const r = e.getBoundingClientRect(); return { x: r.left + 20, y: r.bottom - 20 }; });
  await editor.page.mouse.click(railBlank.x, railBlank.y);
  note(await editor.page.$eval('.music-rail', e => e.classList.contains('is-expanded')), 'tapping blank phone rail should expand playlists');
  await editor.page.click('.music-rail-toggle');
  await editor.page.click('#musicViewAll');
  await editor.page.setViewport({ width: 1400, height: 950 });

  /* BACKUPS, from the screen. */
  await editor.page.click('#musicBackups');
  await editor.page.waitForFunction(() => document.querySelectorAll('#musicBackupsList .music-bk-restore').length > 0, { timeout: 5000 }).catch(() => {});
  const bk = await editor.page.evaluate(() => ({
    n: document.querySelectorAll('#musicBackupsList .music-bk-restore').length,
    counts: [...document.querySelectorAll('#musicBackupsList .music-bk-count')].every((c) => /\d+ tracks/.test(c.textContent)),
    dl: !!document.getElementById('musicDownload'),
  }));
  note(bk.n === 3 && bk.counts, `the backups panel lists ${bk.n} restore points`);
  note(bk.dl, 'there is no download button in the backups panel');
  at = await centre(editor.page, '#musicBackupsList .music-bk-restore');
  await editor.page.mouse.click(at.x, at.y);
  await sleep(150);
  note(await editor.page.evaluate(() => /Replace/.test(document.querySelector('#musicBackupsList .music-bk-restore').textContent)),
       'Restore acted on one press instead of asking for a second');

  /* CLOSED AND OPENED AGAIN, still Dex, still the editor -- signed in is
     the key, so nothing is asked for twice. */
  await editor.page.evaluate(() => window.dexMusic.stopAll());
  await sleep(400);
  await editor.page.evaluate(() => document.dispatchEvent(new CustomEvent('music:open', { detail: {} })));
  await editor.page.waitForFunction(() => document.getElementById('musicModal').open, { timeout: 5000 });
  await sleep(900);
  note(await editor.page.evaluate(v => JSON.parse(localStorage.getItem('dex-music-playlists-shared-cache-v1')).find(p => p.name === 'Stillness').tracks.includes(v), target), 'Stillness membership did not persist across reopening');
  const e1 = await state(editor.page);
  note(e1.admin && e1.del === e1.rows, `reopened as Dex: admin ${e1.admin}, ${e1.del} minus for ${e1.rows} rows`);
  // Add an Instagram Reel through the actual editor, preserving its URL through storage and polling.
  const reel = 'https://www.instagram.com/p/DI4qDiEyZpU/';
  await editor.page.click('#musicAdd');
  await editor.page.type('#musicAddUrl', 'https://www.instagram.com/reel/DI4qDiEyZpU/?igsh=tracking');
  await editor.page.waitForFunction(() => !document.getElementById('musicAddFound').hidden);
  await editor.page.type('#musicAddTitle', 'Instagram music check');
  await editor.page.type('#musicAddArtist', 'Embed artist');
  await editor.page.click('#musicAddSave');
  await editor.page.waitForFunction(u => [...document.querySelectorAll('#musicRows .music-row')].some(e => e.dataset.v === u), {}, reel);
  await pull(viewer.page);
  await viewer.page.waitForFunction(u => [...document.querySelectorAll('#musicRows .music-row')].some(e => e.dataset.v === u), {}, reel);
  note(await has(viewer.page, reel), 'the Instagram Reel did not persist and reach the visitor playlist');
  await editor.page.click('#musicSearch'); await editor.page.type('#musicSearch', 'Instagram music check');
  await sleep(350); await editor.page.click('#musicRows .music-play'); await sleep(300);
  await editor.page.waitForFunction(() => document.getElementById('musicModal').classList.contains('has-direct-video') && document.getElementById('musicDirectVideo').readyState >= 2);
  await editor.page.$eval('#musicDirectVideo', v => { v.playbackRate = .0625; });
  const embedded = await editor.page.evaluate(() => {
    const r = document.getElementById('musicScreen').getBoundingClientRect();
    return { w: r.width, h: r.height, seek: document.getElementById('musicScrub').disabled, volume: document.getElementById('musicVol').disabled, loop: document.getElementById('musicLoop').disabled, original: document.getElementById('musicEmbedOriginal').href };
  });
  note(embedded.w === 170 && Math.abs(embedded.h - 95.625) < 1 && !embedded.seek && !embedded.volume && !embedded.loop && embedded.original === reel, `Instagram uses the compact screen with real controls: ${JSON.stringify(embedded)}`);
  await editor.page.screenshot({ path: join(ROOT, '.notes-dev/shots/music-instagram.png') });
  await editor.page.click('#musicFull');
  await editor.page.waitForFunction(() => document.fullscreenElement?.id === 'musicScreen');
  const full = await editor.page.evaluate(() => { const r = document.getElementById('musicDirectVideo').getBoundingClientRect(); return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; });
  note(full.w === full.vw && full.h === full.vh, `explicit fullscreen still fills the screen: ${JSON.stringify(full)}`);
  await editor.page.click('#musicFsExit'); await editor.page.waitForFunction(() => !document.fullscreenElement);
  note(await editor.page.evaluate(() => document.getElementById('musicModal').open && !document.getElementById('musicDirectVideo').hidden), 'fullscreen exit lost the compact video');

  await editor.page.setViewport({ width: 390, height: 844 }); await sleep(250);
  const phone = await editor.page.evaluate(() => { const r = document.getElementById('musicScreen').getBoundingClientRect(); return { x: r.x, right: r.right, w: r.width, h: r.height }; });
  note(phone.x >= 0 && phone.right <= 390 && phone.w === 96 && Math.abs(phone.h - 54) < 1, `phone Instagram uses the same YouTube size: ${JSON.stringify(phone)}`);
  const beforeVolume = await editor.page.$eval('#musicVol', e => Number(e.value));
  await editor.page.click('#musicMute');
  note(await editor.page.$eval('#musicMute', e => e.getAttribute('aria-expanded') === 'true') && await editor.page.$eval('#musicVol', e => Number(e.value)) === beforeVolume, 'phone speaker must open volume without muting');
  const volBounds = await editor.page.$eval('#musicVolumeSlider', e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }; });
  const speakerTop = await editor.page.$eval('#musicMute', e => e.getBoundingClientRect().top);
  note(volBounds.left >= 0 && volBounds.right <= 390 && volBounds.height >= 44 && volBounds.right - volBounds.left === 172 && volBounds.bottom < speakerTop, `volume popover above speaker: ${JSON.stringify(volBounds)}`);
  await editor.page.$eval('#musicVol', e => { e.value = 75; e.dispatchEvent(new Event('input', { bubbles: true })); });
  note(await editor.page.$eval('#musicDirectVideo', e => e.volume === .75) && await editor.page.evaluate(() => localStorage.getItem('music-volume') === '0.75'), 'mobile volume did not apply and persist at the displayed percentage');
  note(await editor.page.$eval('#musicVol', e => e.getBoundingClientRect().width >= 120), 'mobile volume slider must have enough travel to drag');
  await editor.page.keyboard.press('Escape');
  note(await editor.page.evaluate(() => !document.querySelector('.music-volume').classList.contains('is-open') && document.getElementById('musicModal').open), 'volume Escape should only close its popover');
  await editor.page.screenshot({ path: join(ROOT, '.notes-dev/shots/music-instagram-phone.png') });
  await editor.page.setViewport({ width: 1400, height: 950 }); await sleep(200);

  await editor.page.click('#musicToggle');
  note(await editor.page.$eval('#musicDirectVideo', e => e.paused), 'Instagram Pause did not pause real media');
  await editor.page.click('#musicToggle');
  note(await editor.page.$eval('#musicDirectVideo', e => !e.paused), 'Instagram Play did not resume real media');
  while (await editor.page.$eval('#musicLoop', e => e.dataset.loop) !== 'one') await editor.page.click('#musicLoop');
  const beforeRepeat = mediaLookups;
  const replayResponse = editor.page.waitForResponse(r => r.url().includes("/api/music/media?") && r.status() === 200);
  await editor.page.$eval('#musicDirectVideo', e => { e.playbackRate = 1; e.currentTime = e.duration - .05; });
  await editor.page.waitForFunction(() => document.getElementById('musicDirectVideo').currentTime < .5 && !document.getElementById('musicDirectVideo').paused);
  await replayResponse;
  await editor.page.waitForFunction(() => document.getElementById("musicDirectVideo").currentTime < .5 && !document.getElementById("musicDirectVideo").paused);
  note(mediaLookups === beforeRepeat + 1, 'a real ended event must refresh the Instagram public link exactly once');
  await editor.page.$eval('#musicDirectVideo', e => { e.playbackRate = .0625; });
  while (await editor.page.$eval('#musicLoop', e => e.dataset.loop) !== 'off') await editor.page.click('#musicLoop');
  await editor.page.$eval('#musicDirectVideo', e => { e.playbackRate = 1; e.currentTime = e.duration - .05; });
  await editor.page.waitForFunction(() => document.getElementById('musicDirectVideo').hidden);
  note(await editor.page.$eval('#musicDirectVideo', e => e.paused && !e.hasAttribute('src')), 'repeat off must stop at the end of the filtered playlist');
  refuseMedia = true;
  await editor.page.click('#musicRows .music-play');
  await editor.page.waitForFunction(() => document.getElementById('musicVideo').src.endsWith('/embed/'));
  note(await editor.page.$eval('#musicScreen', e => e.getBoundingClientRect().width === 170) && await editor.page.$eval('#musicLoop', e => !e.disabled), 'unavailable Instagram media must retain a compact fallback and visible repeat control');
  await editor.page.click('#musicToggle');
  note(await editor.page.$eval('#musicVideo', e => !e.hasAttribute('src')), 'Close embed left the fallback running');
  await editor.page.click('#musicToggle');
  await editor.page.waitForFunction(() => document.getElementById('musicVideo').src.endsWith('/embed/'));
  refuseMedia = false;
  await editor.page.evaluate(() => { document.getElementById('contactModal').showModal(); document.getElementById('musicModal').close(); }); await sleep(350);
  note(await editor.page.evaluate(() => !document.getElementById('musicVideo').hasAttribute('src') && !document.getElementById('musicModal').open), 'closing Instagram left a hidden provider player');
  note(await editor.page.evaluate(() => document.getElementById('contactModal').open), 'provider cleanup disturbed the overlay taking over');
  await editor.page.evaluate(() => document.getElementById('contactModal').close());
  await editor.page.evaluate(() => document.dispatchEvent(new CustomEvent('music:open'))); await sleep(800);
  await editor.page.click('#musicSearch'); await editor.page.keyboard.down('Control'); await editor.page.keyboard.press('A'); await editor.page.keyboard.up('Control'); await editor.page.keyboard.press('Backspace'); await sleep(300);
  await editor.page.click('#musicRows .music-play'); await sleep(200);
  note(await editor.page.evaluate(() => !document.getElementById('musicModal').classList.contains('has-native-embed') && document.getElementById('musicVideo').src.includes('youtube-nocookie.com/embed/')), 'YouTube did not recover after the provider player');
  await editor.page.click('#musicToggle');

  // Adding while a playlist is selected must also populate that playlist, including embeds.
  const choosePlaylist = async name => editor.page.$$eval('#musicCustomPlaylists button:not(.music-rail-del)', (buttons, label) => buttons.find(b => b.querySelector('.music-rail-label')?.textContent === label.toUpperCase()).click(), name);
  const addSong = async (url, title) => {
    await editor.page.click('#musicAdd');
    await editor.page.type('#musicAddUrl', url);
    await editor.page.waitForFunction(() => !document.getElementById('musicAddFound').hidden);
    await editor.page.type('#musicAddTitle', title);
    await editor.page.type('#musicAddArtist', 'Destination test');
    await editor.page.click('#musicAddSave');
    if (!refuseAdd) await editor.page.waitForFunction(() => document.getElementById('musicAddPanel').hidden);
  };
  const memberOf = (name, v) => editor.page.evaluate((name, v) => JSON.parse(localStorage.getItem('dex-music-playlists-shared-cache-v1')).find(p => p.name === name)?.tracks.includes(v), name, v);
  await editor.page.click('#musicAddPlaylist');
  await editor.page.type('#musicPlaylistName', 'Fresh Adds');
  await editor.page.click('.music-playlist-ok');
  await editor.page.waitForFunction(() => document.getElementById('musicPlaylistForm').hidden);
  await addSong('FreshSong01', 'Fresh playlist song');
  note(await has(editor.page, 'FreshSong01') && await memberOf('Fresh Adds', 'FreshSong01'), 'adding to a brand-new empty playlist must show the song there and save membership');
  await pull(viewer.page);
  await viewer.page.waitForFunction(() => !!document.querySelector('.music-row[data-v="FreshSong01"]'));
  note(await has(viewer.page, 'FreshSong01'), 'adding to a custom playlist must also add to the public All library');
  await choosePlaylist('Stillness');
  const vimeo = 'https://vimeo.com/123456789';
  await addSong(vimeo, 'Existing playlist embed');
  note(await has(editor.page, vimeo) && await memberOf('Stillness', vimeo), 'adding an embed to an existing custom playlist must keep that playlist selected and populate it');
  await editor.page.click('#musicViewRepeat');
  await addSong('RepeatAdd01', 'Repeat destination song');
  note(await has(editor.page, 'RepeatAdd01') && (await api()).data.tracks.find(t => t.v === 'RepeatAdd01')?.r === true, 'adding from Repeat must immediately show the track there with shared membership saved');
  await editor.page.click('#musicViewAll');
  await addSong('AllOnlyAdd1', 'All-only destination song');
  note(await has(editor.page, 'AllOnlyAdd1') && !(await api()).data.tracks.find(t => t.v === 'AllOnlyAdd1')?.r && await editor.page.evaluate(() => JSON.parse(localStorage.getItem('dex-music-playlists-shared-cache-v1')).every(p => !p.tracks.includes('AllOnlyAdd1'))), 'adding from All must not add to Repeat or any custom playlist');
  await choosePlaylist('Fresh Adds');
  refuseAdd = true;
  await addSong('RefusedAdd1', 'Refused playlist save');
  await editor.page.waitForFunction(() => document.getElementById('musicAddNote').dataset.tone === 'bad');
  note(!(await memberOf('Fresh Adds', 'RefusedAdd1')) && !(await api()).data.tracks.some(t => t.v === 'RefusedAdd1'), 'a failed add must not leave a phantom custom playlist membership');
  refuseAdd = false;
  await editor.page.click('#musicAddCancel');
  await editor.page.evaluate(() => window.dexMusic.stopAll());
  await sleep(350);
  await editor.page.evaluate(() => document.dispatchEvent(new CustomEvent('music:open')));
  await editor.page.waitForFunction(() => document.getElementById('musicModal').open);
  await choosePlaylist('Fresh Adds');
  note(await has(editor.page, 'FreshSong01'), 'newly added custom playlist membership must survive reopening Music');

  // Real isolated device stores: migrate both originals, share publicly and propagate deletion.
  const legacyDesktop = [{ id: 'legacy-desktop', name: 'Stillness', tracks: [SEED.tracks[0].v] }];
  const legacyPhone = [{ id: 'legacy-phone', name: 'Shorts', tracks: [SEED.tracks[1].v, SEED.tracks[2].v] }];
  refuseImport = true;
  const offlineOriginal = [{ id: 'offline-short', name: 'Retained Shorts', tracks: [SEED.tracks[1].v] }, { id: 'offline-empty', name: 'Retained Test', tracks: [] }];
  const failedMigration = await door('music:open', '', 'failed migration owner', DEX, offlineOriginal);
  note(await failedMigration.page.evaluate(() => ['RETAINED SHORTS', 'RETAINED TEST'].every(name => [...document.querySelectorAll('#musicCustomPlaylists .music-rail-label')].some(e => e.textContent === name))), 'failed migration must keep populated and empty original playlists visible');
  await failedMigration.page.$$eval('#musicCustomPlaylists .music-rail-label', labels => labels.find(e => e.textContent === 'RETAINED SHORTS').closest('button').click());
  note(await has(failedMigration.page, offlineOriginal[0].tracks[0]), 'original songs remain accessible when migration is refused');
  note(await failedMigration.page.evaluate(original => !localStorage.getItem('dex-music-playlists-migrated-v1') && localStorage.getItem('dex-music-playlists') === JSON.stringify(original) && !JSON.parse(localStorage.getItem('dex-music-playlists-shared-cache-v1')).some(p => p.name === 'Retained Shorts'), offlineOriginal), 'failed import preserves originals without falsely marking them shared');
  note(await failedMigration.page.$('[aria-label="Delete playlist Retained Shorts"]') === null, 'pending local playlist must not offer a destructive cloud delete');
  await failedMigration.context.close();
  refuseImport = false;
  const retryMigration = await door('music:open', '', 'retry migration owner', DEX, offlineOriginal);
  await retryMigration.page.waitForFunction(() => !!localStorage.getItem('dex-music-playlists-migrated-v1'));
  note((await api()).data.playlists.some(p => p.name === 'Retained Shorts' && p.tracks.includes(offlineOriginal[0].tracks[0])), 'reopening after a refused migration must recover the same original songs into shared storage');
  await retryMigration.context.close();
  const desktop = await door('music:open', '', 'legacy desktop owner', DEX, legacyDesktop);
  const phoneDevice = await door('music:open', '', 'legacy phone owner', DEX, legacyPhone);
  await phoneDevice.page.setViewport({ width: 390, height: 844 });
  await phoneDevice.page.waitForFunction(() => !!localStorage.getItem('dex-music-playlists-migrated-v1'));
  await desktop.page.waitForFunction(() => [...document.querySelectorAll('#musicCustomPlaylists .music-rail-label')].some(e => e.textContent === 'SHORTS'), { timeout: 8000 });
  await viewer.page.waitForFunction(() => [...document.querySelectorAll('#musicCustomPlaylists .music-rail-label')].some(e => e.textContent === 'SHORTS'), { timeout: 8000 });
  note(await phoneDevice.page.evaluate(() => ['STILLNESS', 'SHORTS'].every(name => [...document.querySelectorAll('#musicCustomPlaylists .music-rail-label')].some(e => e.textContent === name))), 'phone must see both its Shorts and the desktop Stillness playlist');
  note(await desktop.page.evaluate(() => ['STILLNESS', 'SHORTS'].every(name => [...document.querySelectorAll('#musicCustomPlaylists .music-rail-label')].some(e => e.textContent === name))), 'desktop must receive the phone playlist through automatic polling');
  note(await viewer.page.$eval('#musicAddPlaylist', b => b.hidden) && await viewer.page.evaluate(() => [...document.querySelectorAll('#musicCustomPlaylists .music-rail-label')].some(e => e.textContent === 'SHORTS')), 'signed-out visitors see curator playlists without gaining editing rights');
  for (const [device, original] of [[desktop, legacyDesktop], [phoneDevice, legacyPhone]]) {
    note(await device.page.evaluate(original => localStorage.getItem('dex-music-playlists') === JSON.stringify(original) && localStorage.getItem('dex-music-playlists-legacy-backup-v1') === JSON.stringify(original), original), 'migration must retain both original device storage and its backup byte for byte');
  }
  const shared = (await api()).data;
  note(shared.playlists.find(p => p.name === 'Shorts').tracks.join() === legacyPhone[0].tracks.join() && shared.playlists.find(p => p.name === 'Stillness').tracks.includes(legacyDesktop[0].tracks[0]), 'both imported collections must retain their original song memberships');
  const shortsId = shared.playlists.find(p => p.name === 'Shorts').id;
  await phoneDevice.page.click('.music-rail-toggle');
  await phoneDevice.page.$$eval('#musicCustomPlaylists .music-rail-label', labels => labels.find(e => e.textContent === 'SHORTS').closest('button').click());
  await phoneDevice.page.click('.music-rail-toggle');
  await phoneDevice.page.click(`.music-row[data-v="${legacyPhone[0].tracks[0]}"] .music-playlist-add`);
  await phoneDevice.page.click(`.music-picker-entry:has(input[data-playlist="${shortsId}"]) span`);
  await phoneDevice.page.waitForFunction(id => !document.querySelector(`.music-picker-entry input[data-playlist="${id}"]`).disabled, {}, shortsId);
  await phoneDevice.page.click('.music-picker-okay');
  await desktop.page.waitForFunction(v => !JSON.parse(localStorage.getItem('dex-music-playlists-shared-cache-v1')).find(p => p.name === 'Shorts').tracks.includes(v), { timeout: 8000 }, legacyPhone[0].tracks[0]);
  note(true, 'a song removed from the phone reaches the desktop automatically');
  await phoneDevice.page.click('.music-rail-toggle');
  await phoneDevice.page.click('[aria-label="Delete playlist Shorts"]');
  await phoneDevice.page.click('.music-confirm-ok');
  await desktop.page.waitForFunction(() => ![...document.querySelectorAll('#musicCustomPlaylists .music-rail-label')].some(e => e.textContent === 'SHORTS'), { timeout: 8000 });
  await viewer.page.waitForFunction(() => ![...document.querySelectorAll('#musicCustomPlaylists .music-rail-label')].some(e => e.textContent === 'SHORTS'), { timeout: 8000 });
  note(true, 'deleting on mobile removes the playlist from desktop and signed-out visitors');
  const late = await door('music:open', '', 'late legacy owner', DEX, [{ ...legacyPhone[0], id: 'late-phone' }]);
  await late.page.waitForFunction(() => !!localStorage.getItem('dex-music-playlists-migrated-v1'));
  note(!(await api()).data.playlists.some(p => p.name === 'Shorts'), 'a newly opened old device must not resurrect a deleted public playlist');
  const otherLegacy = await door('music:open', '', 'non-owner legacy', SOMEONE, [{ id: 'outsider', name: 'Private old visitor list', tracks: [SEED.tracks[0].v] }]);
  note(!(await api()).data.playlists.some(p => p.name === 'Private old visitor list'), 'another signed-in account cannot import its local collection into the public catalog');
  for (const device of [desktop, phoneDevice, late, otherLegacy]) await device.context.close();

  /* SIGNING OUT ENDS EDITING THERE AND THEN, with the list still up. */
  await editor.page.evaluate(() => { localStorage.removeItem('site:signedIn'); window.dispatchEvent(new CustomEvent('site:user')); });
  await sleep(900);
  const e2 = await state(editor.page);
  note(!e2.admin && e2.del === 0 && e2.enabled === 0, `signed out with the list up: admin ${e2.admin}, ${e2.del} minus, ${e2.enabled} live ticks`);

  await editor.page.screenshot({ path: join(ROOT, '.notes-dev/shots/tunes-music.png') });
  console.log(`browsers: signed out read-only, Dex signed in added, deleted (two presses) and ticked, each seen on the signed-out screen live, and signing out ended it`);

  await viewer.context.close();
  await editor.context.close();
} finally {
  await browser.close();
  stop();
}

console.log('');
if (fail.length) {
  console.log(`music_admin_check: ${fail.length} of ${pass + fail.length} FAILED`);
  for (const f of fail) console.log('  - ' + f);
  process.exit(1);
}
console.log(`music_admin_check: ${pass} checks passed`);
