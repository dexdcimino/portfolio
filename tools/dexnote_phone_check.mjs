/* The DexNote phone app -- /dexnote/ at a phone's size, installed the way
 * Inko is -- driven in a real browser against its own dev server.
 *
 *   node tools/dexnote_phone_check.mjs
 *
 * Brings its own notes dev server on its own port with a scratch store, and
 * its own stand-in for Google's certificates (SITE_AUTH_CERTS_URL), so the
 * ID tokens it signs are verified by the REAL lib/site-identity.js inside the
 * REAL /api/notes/unlock. Firebase itself is the same FAKE dexnote_check.mjs
 * uses (no harness can sign in to Google), extended with getIdToken().
 *
 *   1. INSTALLING: the manifest, its icons (the AI Lab card's own DexNote
 *      icon, compared pixel by pixel), one service worker scoped to /dexnote/,
 *      the AI Lab card's download button, and ?install=1 offering the steps.
 *   2. THE PHONE LAYOUT: no header; one bar of five in Dex's order; the emoji
 *      in the title strip and the box the width of the screen; the outliner
 *      as a drawer with no foot; search; the formatting bar bolding a word
 *      through a REAL tap without taking the caret out of the text; the
 *      sessions sheet with New and a ⋯ per row; the profile sheet and light
 *      mode; one thing open at a time.
 *   3. UPDATES AND OFFLINE: a new deploy under a running app reloads it with
 *      the notes intact and says so, an unchanged one does not, and the next
 *      launch with no network still opens.
 *   4. DEX'S ACCOUNT IS THE DEXDC NOTES: Google as Dex opens the keypad's
 *      document itself, the guest notes on the phone are NOT pushed into it,
 *      an edit on the phone lands in it, an edit from "another device" shows
 *      on the phone without a reload, and nothing offers to copy it onto
 *      itself. The same address through GitHub opens its own notes instead.
 *   5. THE DESKTOP IS UNTOUCHED: at desktop width there is no bar and the
 *      header is back.
 *
 * FALSELY PASSES IF the fake stops matching cloud.js (main.js would throw and
 * everything after the gate fails, loudly), or if a section stops running --
 * the total is asserted.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found — set CHROME=<path to the exe>');
const EXPECTED = 57;
const PORT = 8131;
const BASE = `http://127.0.0.1:${PORT}`;
const PROJECT = 'phone-check-project';

let n = 0, bad = 0;
const ok = (cond, what) => { n++; if (!cond) bad++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- Google, as far as the server can tell ---- */
const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
const certs = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' });
  res.end(JSON.stringify({ k1: key.publicKey.export({ type: 'spki', format: 'pem' }) }));
});
await new Promise((r) => certs.listen(0, '127.0.0.1', r));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(sub, email, provider) {
  const t = Math.floor(Date.now() / 1000);
  const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const p = b64({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, iat: t - 5, exp: t + 3600, auth_time: t - 5, sub, email, email_verified: true,
    firebase: { identities: { [provider]: [`${sub}-id`] }, sign_in_provider: provider } });
  return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key.privateKey).toString('base64url')}`;
}
const TOKENS = {
  'dex-google': idToken('dex-google', 'dexdcimino@gmail.com', 'google.com'),
  'dex-github': idToken('dex-github', 'dexdcimino@gmail.com', 'github.com'),
};

/* ---- the server ---- */
const SCRATCH = await mkdtemp(join(tmpdir(), 'dexnote-phone-'));
const server = spawn(process.execPath, [join(ROOT, 'tools', 'notes_dev_server.mjs'), '--port', String(PORT), '--dir', SCRATCH], {
  env: { ...process.env, NOTES_PASSWORD: 'phonecheck', SITE_AUTH_PROJECT: PROJECT, SITE_AUTH_CERTS_URL: `http://127.0.0.1:${certs.address().port}/certs` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
for (let i = 0; ; i++) {
  try { if ((await fetch(`${BASE}/dexnote/`)).ok) break; } catch { /* not yet */ }
  if (i > 200) throw new Error('dev server did not start');
  await sleep(50);
}
const api = async (path, body) => { const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };

/* The DEXDC notes, seeded with a document nothing else could produce. */
const VAULT_DOC = { v: 1, active: 'sv', ui: {}, sessions: [{ id: 'sv', title: 'DEXDC phone fixture', color: '#5cc8ff', emoji: '', updated: 1,
  cats: [{ id: 'cv', title: 'Vault cat', body: '<p>vault words</p>', color: '#ff9ccb', emoji: '', updated: 1, collapsed: false }], archived: [] }] };
const opened = await api('/api/notes/unlock', { idToken: TOKENS['dex-google'] });
const seeded = await api('/api/notes/save', { token: opened.body.token, doc: VAULT_DOC, baseRev: opened.body.rev });
const vaultNow = async () => { const r = await api('/api/notes/unlock', { idToken: TOKENS['dex-google'] }); return r.body; };

/* ---- Firebase, faked ---- */
const FAKE_CLOUD = `import { keyFor } from '/dexnote/local.js';
const KEY = 'fakecloud';
const all = () => JSON.parse(localStorage.getItem(KEY) || '{"users":{},"signedIn":null}');
const put = (s) => localStorage.setItem(KEY, JSON.stringify(s));
const listeners = [];
const TOKENS = ${JSON.stringify(TOKENS)};
const userOf = (uid) => uid ? { uid, email: 'dexdcimino@gmail.com', displayName: uid, photoURL: null, getIdToken: async () => TOKENS[uid] || 'no.such.token' } : null;
let current = userOf(all().signedIn);
export function onUser(fn) { listeners.push(fn); setTimeout(() => fn(current), 50); return () => {}; }
const emit = () => listeners.forEach((f) => f(current));
export async function signIn(which) { const s = all(); s.signedIn = 'dex-' + which; put(s); current = userOf(s.signedIn); emit(); return { user: current }; }
export async function signOut() { const s = all(); s.signedIn = null; put(s); current = null; emit(); }
export async function backupCurrent() { return 'b'; }
export function cloudBackend(user) {
  const uid = user.uid;
  return {
    kind: 'cloud', lockedText: 'SIGNED OUT', ready: () => current && current.uid === uid,
    async load() { const u = all().users[uid]; return u && u.doc ? { doc: u.doc, rev: u.rev, savedAt: u.savedAt } : null; },
    async save(doc, baseRev) {
      const s = all(); const u = s.users[uid] ||= {};
      if ((u.rev || 0) !== baseRev) return { conflict: true, doc: u.doc, rev: u.rev };
      u.doc = doc; u.rev = (u.rev || 0) + 1; u.savedAt = new Date().toISOString(); put(s);
      return { rev: u.rev, savedAt: u.savedAt };
    },
    beacon: () => false,
    async uploadAsset(blob, type) { return keyFor(blob, type); },
    assetSrc: () => 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  };
}
`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run', '--no-default-browser-check', '--no-sandbox'] });
const p = await browser.newPage();
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
await p.emulate({ viewport: PHONE, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' });
const errors = [];
p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|ERR_TUNNEL|ERR_PROXY|net::ERR/.test(m.text())) errors.push(m.text().slice(0, 300)); });
p.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));

/* Every request goes through here: the fake cloud, and the ETag a deploy
   would carry (the dev server sends none), so the update check has a build
   to compare. `deploy` is what the next HEAD answers. */
let deploy = 'build-one';
await p.setRequestInterception(true);
p.on('request', (r) => {
  if (r.url().endsWith('/dexnote/cloud.js')) return r.respond({ status: 200, contentType: 'text/javascript', body: FAKE_CLOUD });
  if (r.method() === 'HEAD' && r.url().startsWith(BASE)) return r.respond({ status: 200, headers: { etag: `"${deploy}"` }, body: '' });
  return r.continue();
});

const tap = async (sel) => {
  const box = await p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e || e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }; }, sel);
  if (!box) throw new Error(`nothing to tap: ${sel}`);
  if (!box.hit) console.log(`  (note: ${sel} is covered where it would be tapped)`);
  await p.touchscreen.tap(box.x, box.y);
  await sleep(250);
  return box.hit;
};
const clickText = (t) => p.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === t); if (!b) return false; b.click(); return true; }, t);
const shown = (sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.right > 0 && r.left < innerWidth; }, sel);
const caretEnd = (sel = '.nt-body') => p.evaluate((s) => { const b = document.querySelector(s); b.focus(); const r = document.createRange(); r.selectNodeContents(b); r.collapse(false); const g = getSelection(); g.removeAllRanges(); g.addRange(r); }, sel);
const status = () => p.evaluate(() => document.querySelector('.nt-status')?.textContent || '');
const waitSaved = () => p.waitForFunction(() => /^SAVED/.test(document.querySelector('.nt-status')?.textContent || ''), { timeout: 15000 }).then(() => true, () => false);

try {
  ok(seeded.status === 200, `set-up: the DEXDC notes seeded on the scratch store (rev ${seeded.body.rev})`);

  console.log('1. installing');
  await p.goto(`${BASE}/dexnote/`, { waitUntil: 'networkidle2' });
  await p.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('dexnote-guest'); });
  const man = await p.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    const m = await (await fetch(link.href)).json();
    const sizes = await Promise.all(m.icons.map((i) => new Promise((res) => { const im = new Image(); im.onload = () => res(`${im.naturalWidth}x${im.naturalHeight}`); im.onerror = () => res('broken'); im.src = new URL(i.src, link.href).href; })));
    return { m, sizes, viewport: document.querySelector('meta[name="viewport"]').content, touch: document.querySelector('link[rel="apple-touch-icon"]').href };
  });
  ok(man.m.display === 'standalone' && man.m.scope === '/dexnote/' && man.m.start_url === '/dexnote/' && man.m.id === '/dexnote/', 'the manifest opens /dexnote/ full screen, scoped to it');
  ok(man.m.icons.length === 4 && man.m.icons.every((i, k) => man.sizes[k] === i.sizes), `its four icons load at the sizes they claim (${man.sizes.join(', ')})`);
  ok(man.m.icons.some((i) => i.purpose === 'maskable') && man.m.icons.some((i) => i.purpose === 'monochrome'), 'a maskable icon for the home screen and a monochrome one');
  ok(/viewport-fit=cover/.test(man.viewport) && /interactive-widget=resizes-content/.test(man.viewport), 'the viewport reaches the edges and makes room for the keyboard');
  const same = await p.evaluate(async () => {
    const load = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = src; });
    const [a, b] = await Promise.all([load('/assets/icons/apps/dexnote.png'), load('/dexnote/icons/icon-512-v2.png')]);
    const px = (im) => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.drawImage(im, 0, 0, 64, 64); return g.getImageData(0, 0, 64, 64).data; };
    const A = px(a), B = px(b); let worst = 0; for (let i = 0; i < A.length; i++) worst = Math.max(worst, Math.abs(A[i] - B[i]));
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'); g.drawImage(b, 0, 0); const mid = [...g.getImageData(256, 110, 1, 1).data];
    return { worst, mid };
  });
  ok(same.worst <= 2 && same.mid[0] > 35 && same.mid[0] < 90 && same.mid[1] < 30 && same.mid[2] < 55, `the app icon IS the AI Lab card's DexNote icon (worst channel difference ${same.worst}, maroon mark ${same.mid.slice(0, 3)})`);
  const sw = await p.evaluate(async () => { const reg = await navigator.serviceWorker.ready; await new Promise((r) => setTimeout(r, 300)); const all = await navigator.serviceWorker.getRegistrations(); return { n: all.length, scope: new URL(reg.scope).pathname }; });
  ok(sw.n === 1 && sw.scope === '/dexnote/', `one service worker, scoped to /dexnote/ (${sw.n}, ${sw.scope})`);
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const card = html.slice(html.indexOf('data-gallery="dexnote"'), html.indexOf('</article>', html.indexOf('data-gallery="dexnote"')));
  const dl = card.indexOf('class="ai-card-dl" href="/dexnote/?install=1"');
  ok(dl > 0 && dl < card.indexOf('class="ai-card-eye"'), 'the AI Lab DexNote card has the download button, left of the eye as Inko’s is');
  await p.goto(`${BASE}/dexnote/?install=1`, { waitUntil: 'networkidle2' });
  await p.waitForSelector('.dn-install', { timeout: 5000 }).catch(() => {});
  const inst = await p.evaluate(() => ({ sheet: document.querySelector('.dn-install')?.textContent || '', url: location.search }));
  // Headless Chrome may or may not offer its own prompt: the steps, or the Install button.
  ok(/Install dexnote/.test(inst.sheet) && /Add to Home screen|Install app|goes on your home screen/.test(inst.sheet) && inst.url === '', `?install=1 offers to install and leaves the address clean (“${inst.sheet.slice(0, 48)}…”)`);
  await p.evaluate(() => document.querySelector('.dn-install .nt-modal')?.click());
  ok(!(await p.$('.dn-install')), 'a tap beside it puts it away');
  // Inside the dexcimino.com app (site.webmanifest, scope "/") the page is
  // standalone too, and Chrome will not install DexNote beside it: the sheet
  // must still come up and say what to do, not assume DexNote is installed.
  // CDP's setEmulatedMedia silently ignores display-mode, so the page's own
  // matchMedia is answered instead, on a page of its own.
  const sp = await browser.newPage();
  await sp.setViewport(await p.viewport());
  await sp.evaluateOnNewDocument(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : real(q));
  });
  await sp.goto(`${BASE}/dexnote/?install=1`, { waitUntil: 'networkidle2' });
  await sp.waitForSelector('.dn-install', { timeout: 5000 }).catch(() => {});
  const inApp = await sp.evaluate(() => ({ standalone: matchMedia('(display-mode: standalone)').matches, sheet: document.querySelector('.dn-install')?.textContent || '' }));
  ok(inApp.standalone && /inside the dexcimino\.com app/.test(inApp.sheet) && /Uninstall/.test(inApp.sheet), `opened inside the site's own app, ?install=1 says to uninstall that first (standalone ${inApp.standalone}: “${inApp.sheet.slice(15, 70)}…”)`);
  await sp.close();

  console.log('2. the phone layout');
  const gate = await p.evaluate(() => ({ btns: [...document.querySelectorAll('.dn-card button')].map((b) => b.textContent), logo: document.querySelector('.dn-card .dn-logo')?.getAttribute('src') }));
  ok(gate.btns.join('|') === 'Google|Discord|GitHub|Continue as guest' && gate.logo === '/dexnote/icons/logo-v2.svg',
    `the intro is the site's sign-in under the DexNote mark (${gate.btns.join(', ')})`);
  await clickText('Continue as guest');
  await p.waitForSelector('.dm-bar', { timeout: 10000 });
  await sleep(300);
  ok(!(await shown('.nt-header')), 'no header bar');
  const order = await p.evaluate(() => [...document.querySelectorAll('.dm-bar .dm-btn')].sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x).map((b) => b.getAttribute('aria-label')));
  ok(order.join(',') === 'Outliner,Search,Sessions,Formatting,Profile', `the bar, left to right: ${order.join(', ')}`);
  const barBox = await p.evaluate(() => { const r = document.querySelector('.dm-bar').getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom, vw: innerWidth, vh: innerHeight }; });
  ok(barBox.left >= 0 && barBox.right <= barBox.vw && barBox.vh - barBox.bottom < 30, `it sits along the bottom inside the screen (${Math.round(barBox.left)}–${Math.round(barBox.right)}, ${Math.round(barBox.vh - barBox.bottom)}px up)`);
  const strip = await p.evaluate(() => {
    const sec = document.querySelector('.nt-cat'); const box = sec.querySelector('.nt-cat-box').getBoundingClientRect();
    return { inHead: !!sec.querySelector('.nt-cat-head .nt-cat-emoji') && !!sec.querySelector('.nt-cat-head .nt-cat-toggle'), left: box.left, width: box.width, vw: innerWidth };
  });
  ok(strip.inHead, 'the emoji and the chevron are in the title strip');
  ok(strip.left <= 16 && strip.width >= strip.vw - 32, `so the box is the width of the screen (${Math.round(strip.left)}px in, ${Math.round(strip.width)} of ${strip.vw})`);

  await caretEnd();
  await p.keyboard.type('phone words here');
  ok(await waitSaved(), `a guest edit saves (${await status()})`);

  ok(await tap('.dm-outliner'), 'the outliner button takes a real tap');
  await sleep(350);
  const drawer = await p.evaluate(() => ({ left: document.querySelector('.nt-sidebar').getBoundingClientRect().left, foot: getComputedStyle(document.querySelector('.nt-sidebar-foot')).display, rows: document.querySelectorAll('.nt-sidebar .nt-row').length }));
  ok(drawer.left >= -1 && drawer.rows >= 1, `the outliner slides in from the left (${Math.round(drawer.left)}px, ${drawer.rows} row(s))`);
  ok(drawer.foot === 'none', 'with no New Category or My Sessions at its foot');
  await tap('.dm-scrim');
  await sleep(350);
  ok(await p.evaluate(() => document.querySelector('.nt-sidebar').getBoundingClientRect().right <= 0), 'a tap beside it puts it away');

  await tap('.dm-search');
  ok(await p.evaluate(() => document.activeElement && document.activeElement.classList.contains('nt-search-input')), 'search opens with the field ready to type');
  await p.keyboard.type('words');
  await sleep(400);
  const found = await p.evaluate(() => document.querySelector('.nt-search-count')?.textContent || '');
  ok(/1/.test(found), `and finds the note (${found})`);
  await tap('.dm-find-x');
  ok(!(await shown('.dm-findbar')) && !(await p.evaluate(() => document.querySelector('.nt-search')?.classList.contains('is-open'))), 'its X shuts it and the search with it');

  await tap('.dm-format');
  const fmt = await p.evaluate(() => [...document.querySelectorAll('.dm-fmtbar button, .dm-fmtbar .nt-node-btn')].filter((b) => !b.closest('.nt-node-btn') || b.classList.contains('nt-node-btn')).map((b) => b.getAttribute('aria-label') || b.className));
  ok(fmt.join(',') === 'Bold,Italic,Underline,Strikethrough,Align left,Align centre,Align right,nt-node-btn', `the formatting bar: ${fmt.join(', ')}`);
  ok(await shown('.dm-fmtbar') && await p.evaluate(() => document.querySelector('.dm-fmtbar').getBoundingClientRect().bottom <= document.querySelector('.dm-bar').getBoundingClientRect().top), 'it opens ABOVE the bar');
  // Select "here" and bold it with a finger.
  await p.evaluate(() => { const b = document.querySelector('.nt-body'); b.focus(); const t = [...b.querySelectorAll('*'), b].flatMap((x) => [...x.childNodes]).find((c) => c.nodeType === 3 && c.nodeValue.includes('here')); const r = document.createRange(); const i = t.nodeValue.indexOf('here'); r.setStart(t, i); r.setEnd(t, i + 4); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await tap('.dm-fmtbar .nt-fmt[aria-label="Bold"]');
  const bolded = await p.evaluate(() => ({ html: document.querySelector('.nt-body').innerHTML, focus: !!document.activeElement?.closest('.nt-body') }));
  ok(/<(b|strong)>here<\/(b|strong)>/.test(bolded.html), 'B on the bar bolds the selected word');
  ok(bolded.focus, 'and the caret is still in the text (the keyboard stays up)');
  await tap('.dm-search');
  ok(!(await shown('.dm-fmtbar')) && await shown('.dm-findbar'), 'opening search shuts the formatting bar: one at a time');
  await tap('.dm-search');

  await tap('.dm-sessions');
  ok(await shown('.dm-sess-sheet .nt-sesslist') && await p.evaluate(() => document.querySelectorAll('.dm-sess-sheet .nt-sess-row').length === 1), 'sessions open as a sheet over the bar');
  ok(await p.evaluate(() => !!document.querySelector('.dm-sess-sheet .nt-sess-row .nt-sess-row-more') && !!document.querySelector('.dm-sess-sheet .nt-sesslist-new')), 'every row has its ⋯, and New is in the sheet');
  await tap('.dm-sess-sheet .nt-sesslist-new');
  await sleep(300);
  const sessions = await p.evaluate(() => JSON.parse(localStorage.getItem('dexnote:guest:v1') || '{}'));
  const nNow = await p.evaluate(() => document.querySelectorAll('.dm-sess-sheet .nt-sess-row').length);
  ok(nNow === 2 || (sessions.doc && sessions.doc.sessions && sessions.doc.sessions.length === 2), `New makes a session (${nNow} rows)`);
  if (!(await shown('.dm-sess-sheet .nt-sesslist'))) await tap('.dm-sessions');
  const before = await p.evaluate(() => [...document.querySelectorAll('.dm-sess-sheet .nt-sess-row .nt-row-title')].map((t) => t.textContent));
  await tap('.dm-sess-sheet .nt-sess-row:last-child .nt-sess-row-more');
  ok(await clickText('Move up'), 'the ⋯ offers Move up');
  await sleep(300);
  if (!(await shown('.dm-sess-sheet .nt-sesslist'))) await tap('.dm-sessions');
  const after = await p.evaluate(() => [...document.querySelectorAll('.dm-sess-sheet .nt-sess-row .nt-row-title')].map((t) => t.textContent));
  ok(before.length === 2 && after.join() === [...before].reverse().join(), `and moves it (${before.join(' / ')} → ${after.join(' / ')})`);
  await tap('.dm-sess-sheet .nt-sesslist-x');
  await sleep(200);
  ok(!(await shown('.dm-sess-sheet .nt-sesslist')) && !(await p.evaluate(() => document.querySelector('.dm-sessions').classList.contains('is-on'))), 'its own X shuts it and the bar agrees');

  await tap('.dm-profile');
  const prof = await p.evaluate(() => document.querySelector('.dm-psheet')?.textContent || '');
  ok(/Guest/.test(prof) && /Sign in/.test(prof) && /Theme/.test(prof) && /Text size/.test(prof) && /Spell check/.test(prof), 'the profile: who is here, Sign in, and only the settings that matter');
  ok(!/Members|Shared|Avatar|Community/.test(prof), 'and none of what this app does not have (members, sharing, avatars, the hub)');
  await clickText('Light');
  ok(await p.evaluate(() => document.querySelector('.nt-app').dataset.theme === 'light'), 'light mode from the profile');
  await clickText('Dark');
  await tap('.dm-psheet .dm-sheet-x');

  console.log('3. updates and offline');
  await caretEnd();
  await p.keyboard.type('kept through a deploy');
  ok(await waitSaved(), 'set-up: the last edit saved');
  await p.evaluate(() => { window.__still = true; document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(1500);
  ok(await p.evaluate(() => window.__still === true), 'an unchanged deploy does NOT reload the app');
  deploy = 'build-two';
  await p.evaluate(() => { window.__oldPage = true; document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForFunction(() => !window.__oldPage && document.querySelector('.dm-bar'), { timeout: 15000 }).catch(() => {});
  const upd = await p.evaluate(() => ({ fresh: !window.__oldPage, toast: document.querySelector('.nt-toast')?.textContent || '', text: document.querySelector('.nt-body')?.textContent || '' }));
  ok(upd.fresh && /^Updated — build /.test(upd.toast), `a new deploy reloads the running app and says so (“${upd.toast}”)`);
  ok(/kept through a deploy/.test(upd.text), 'with the notes intact');
  await sleep(800);
  await p.setOfflineMode(true);
  await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.waitForSelector('.dm-bar', { timeout: 10000 }).catch(() => {});
  ok(/kept through a deploy/.test(await p.evaluate(() => document.querySelector('.nt-body')?.textContent || '')), 'the next launch with NO network opens the notes');
  await p.setOfflineMode(false);

  console.log('4. Dex’s account is the DEXDC notes');
  // From here the fake Firebase has to win over the worker's network-first
  // fetch of the real one, which page interception cannot see.
  await p.setBypassServiceWorker(true);
  const guestBefore = await p.evaluate(() => localStorage.getItem('dexnote:guest:v1') || '');
  await tap('.dm-profile');
  await clickText('Sign in');
  await sleep(300);
  ok(await clickText('Google'), 'Google, from the profile');
  await p.waitForFunction(() => /DEXDC phone fixture/.test(document.querySelector('.nt-session-title')?.textContent || ''), { timeout: 15000 }).catch(() => {});
  const mine = await p.evaluate(() => ({ title: document.querySelector('.nt-session-title')?.textContent, body: [...document.querySelectorAll('.nt-body')].map((b) => b.textContent).join('|') }));
  ok(mine.title === 'DEXDC phone fixture' && /vault words/.test(mine.body), `Dex's Google opens the DEXDC notes themselves (“${mine.title}”)`);
  ok(await p.evaluate(() => (localStorage.getItem('dexnote:guest:v1') || '').includes('phone words')) && guestBefore.includes('phone words'), 'the guest notes on the phone are left where they were');
  ok(!JSON.stringify((await vaultNow()).content).includes('phone words'), 'and are NOT pushed into the DEXDC notes');
  await tap('.dm-profile');
  const dexProf = await p.evaluate(() => document.querySelector('.dm-psheet')?.textContent || '');
  ok(/DEXDC notes/.test(dexProf) && !/Bring in the password notes/.test(dexProf), 'the profile says so, and offers no copy of them onto themselves');
  await tap('.dm-psheet .dm-sheet-x');
  await caretEnd();
  await p.keyboard.type(' typed on the phone');
  ok(await waitSaved(), `an edit on the phone saves (${await status()})`);
  const v1 = await vaultNow();
  ok(JSON.stringify(v1.content).includes('typed on the phone') && v1.rev === seeded.body.rev + 1, `and lands in the DEXDC notes, one rev on (rev ${v1.rev})`);
  // Another device -- the keypad on the site -- saves.
  const other = JSON.parse(JSON.stringify(v1.content));
  other.sessions[0].cats[0].body = other.sessions[0].cats[0].body.replace('vault words', 'vault words, edited on the site');
  other.sessions[0].cats[0].updated = Date.now();
  other.sessions[0].updated = Date.now();
  const siteSave = await api('/api/notes/save', { token: v1.token, doc: other, baseRev: v1.rev });
  ok(siteSave.status === 200, 'set-up: the site saves an edit of its own');
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await p.waitForFunction(() => /edited on the site/.test(document.querySelector('.nt-body')?.textContent || ''), { timeout: 8000 }).catch(() => {});
  ok(/edited on the site/.test(await p.evaluate(() => document.querySelector('.nt-body')?.textContent || '')), 'and it shows on the phone without a reload');

  await tap('.dm-profile');
  await clickText('Sign out');
  await p.waitForFunction(() => !!document.querySelector('.dn-card'), { timeout: 10000 }).catch(() => {});
  await clickText('GitHub');
  await p.waitForSelector('.dm-bar', { timeout: 10000 }).catch(() => {});
  await sleep(500);
  const gh = await p.evaluate(() => ({ title: document.querySelector('.nt-session-title')?.textContent, body: [...document.querySelectorAll('.nt-body')].map((b) => b.textContent).join('|') }));
  ok(gh.title !== 'DEXDC phone fixture' && !/vault words/.test(gh.body), `the same address through GitHub opens its own notes, not the DEXDC ones (“${gh.title}”)`);
  ok((await vaultNow()).rev === siteSave.body.rev, 'and the DEXDC notes are exactly as the last real save left them');

  console.log('5. the desktop');
  const d = await browser.newPage();
  await d.setViewport({ width: 1300, height: 850 });
  await d.setRequestInterception(true);
  d.on('request', (r) => (r.url().endsWith('/dexnote/cloud.js') ? r.respond({ status: 200, contentType: 'text/javascript', body: FAKE_CLOUD }) : r.continue()));
  await d.goto(`${BASE}/dexnote/`, { waitUntil: 'networkidle2' });
  await d.evaluate(() => { localStorage.setItem('dexnote:mode', 'guest'); localStorage.removeItem('fakecloud'); });
  await d.reload({ waitUntil: 'networkidle2' });
  await d.waitForSelector('.nt-header', { timeout: 10000 }).catch(() => {});
  const desk = await d.evaluate(() => ({ bar: !!document.querySelector('.dm-bar'), header: getComputedStyle(document.querySelector('.nt-header')).display, mobile: document.querySelector('.nt-app').classList.contains('is-mobile'), aside: !!document.querySelector('.nt-cat-shell > .nt-cat-aside') }));
  ok(!desk.bar && !desk.mobile && desk.header !== 'none' && desk.aside, 'at desktop width: no bar, the header, the emoji column where it was');

  ok(!errors.length, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} finally {
  await browser.close();
  server.kill();
  certs.close();
  await rm(SCRATCH, { recursive: true, force: true });
}

ok(n === EXPECTED, `ran ${n} checks, expected ${EXPECTED}`);
console.log(`\n${n - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
