/* /dexnote/ -- the notes app with accounts -- driven end to end in a real
 * browser against the notes dev server.
 *
 *   node tools/notes_dev_server.mjs &
 *   node tools/dexnote_check.mjs [--port 8123]
 *
 * WHAT IS REAL: the page, main.js, the guest store (local.js), the notes app,
 * and the password store's own /api/notes/unlock and /api/notes/asset.
 * WHAT IS NOT: Firebase. dexnote/cloud.js is answered with FAKE_CLOUD below,
 * the same exports over a localStorage key, because a harness cannot sign in
 * to Google. So this proves the flows -- the gate, a guest save that survives
 * a reload, guest notes moving into an account on the first sign-in and
 * leaving the browser, the password notes replacing an account's notes with a
 * backup taken first, a remembered sign-in, sign-out -- and says nothing about
 * whether the real Firebase project accepts the requests.
 *
 * FALSELY PASSES IF the fake stops matching cloud.js's exports; the import in
 * main.js would then throw and every check after the gate fails, so it cannot
 * pass quietly. Needs the dev server (its password is "notes").
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const BASE = `http://127.0.0.1:${arg('--port', 8123)}`;
const CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => p && existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found — set CHROME=<path to the exe>');
const EXPECTED = 24;

const FAKE_CLOUD = `// Stand-in for dexnote/cloud.js: same exports, the "server" is a localStorage key.
import { keyFor } from '/dexnote/local.js';
const KEY = 'fakecloud';
const all = () => JSON.parse(localStorage.getItem(KEY) || '{"users":{},"signedIn":null}');
const put = (s) => localStorage.setItem(KEY, JSON.stringify(s));
const listeners = [];
const userOf = (uid) => uid ? { uid, email: \`\${uid}@example.com\`, displayName: uid, photoURL: null } : null;
let current = userOf(all().signedIn);
export function onUser(fn) { listeners.push(fn); setTimeout(() => fn(current), 50); return () => {}; }
const emit = () => listeners.forEach((f) => f(current));
export async function signIn(which) { const s = all(); s.signedIn = 'dex-' + which; put(s); current = userOf(s.signedIn); emit(); }
export async function signOut() { const s = all(); s.signedIn = null; put(s); current = null; emit(); }
export async function backupCurrent(user, cur) { const s = all(); const u = s.users[user.uid] ||= {}; (u.backups ||= []).push(cur); put(s); return 'b'; }
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
    async uploadAsset(blob, type) { const key = await keyFor(blob, type); const s = all(); const u = s.users[uid] ||= {}; (u.assets ||= []).push(key); put(s); return key; },
    assetSrc: () => 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  };
}
`;
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run', '--no-default-browser-check'] });
const p = await b.newPage();
await p.setViewport({ width: 1300, height: 850 });
const errors = [];
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
p.on('pageerror', (e) => errors.push('pageerror ' + e.message));
await p.setRequestInterception(true);
p.on('request', (r) => r.url().endsWith('/dexnote/cloud.js') ? r.respond({ status: 200, contentType: 'text/javascript', body: FAKE_CLOUD }) : r.continue());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0, bad = 0;
const ok = (cond, what) => { n++; if (!cond) bad++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); };
const text = () => p.evaluate(() => [...document.querySelectorAll('.nt-body')].map((b) => b.textContent).join('|'));
const status = () => p.evaluate(() => document.querySelector('.nt-status')?.textContent || '');
const clickText = (t) => p.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === t); if (!b) return false; b.click(); return true; }, t);
const waitSaved = () => p.waitForFunction(() => /^SAVED/.test(document.querySelector('.nt-status')?.textContent || ''), { timeout: 15000 }).then(() => true, () => false);

await p.goto(`${BASE}/dexnote/`, { waitUntil: 'networkidle2' });
await p.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('dexnote-guest'); });
await p.reload({ waitUntil: 'networkidle2' });
const gate = await p.evaluate(() => [...document.querySelectorAll('.dn-card button')].map((b) => b.textContent));
ok(gate.length === 4 && gate.includes('Continue with Google') && gate.includes('Continue as guest'), `gate shows 3 providers + guest: ${JSON.stringify(gate)}`);

ok(await clickText('Continue as guest'), 'guest button pressed');
await p.waitForSelector('.nt-body', { timeout: 10000 });
ok(await p.evaluate(() => !!document.querySelector('.dn-account') && !document.querySelector('.nt-close')), 'account button where the X was, no close button');
await p.evaluate(() => { const b = document.querySelector('.nt-body'); b.focus(); const r = document.createRange(); r.selectNodeContents(b); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
await p.keyboard.type('guest marker one');
ok(await waitSaved(), `guest save reaches SAVED (${await status()})`);
ok(await p.evaluate(() => (localStorage.getItem('dexnote:guest:v1') || '').includes('guest marker one')), 'guest doc is in localStorage');
const pic = await p.evaluate(async () => {
  const { localBackend } = await import('/dexnote/local.js');
  const blob = new Blob([Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0))], { type: 'image/gif' });
  const key = await localBackend().uploadAsset(blob, 'image/gif');
  const url = await localBackend().assetSrc(key);
  // Read back the way the app does: as an <img>, under the page's own CSP.
  const width = await new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i.naturalWidth); i.onerror = () => resolve(-1); i.src = url; });
  return { key, url, width };
});
ok(/^[0-9a-f]{64}\.gif$/.test(pic.key) && /^blob:/.test(pic.url) && pic.width === 1, `a guest picture is kept by its sha and drawn back (${pic.key.slice(0, 12)}…, ${pic.width}px)`);

await p.reload({ waitUntil: 'networkidle2' });
await p.waitForSelector('.nt-body', { timeout: 10000 });
ok((await text()).includes('guest marker one'), 'guest goes straight back in after reload, text kept');

await p.click('.dn-account'); await sleep(300);
ok(await clickText('Sign in…'), 'menu offers Sign in…');
await sleep(300);
ok(await clickText('Continue with Google'), 'Google pressed');
await p.waitForFunction(() => document.querySelector('.dn-account') && !localStorage.getItem('dexnote:guest:v1'), { timeout: 15000 }).catch(() => {});
await p.waitForSelector('.nt-body', { timeout: 10000 });
const cloud1 = await p.evaluate(() => JSON.parse(localStorage.getItem('fakecloud')));
ok(JSON.stringify(cloud1.users['dex-google']?.doc || '').includes('guest marker one'), 'guest notes moved into the account');
ok(await p.evaluate(() => !localStorage.getItem('dexnote:guest:v1')), 'guest copy cleared after the move');
ok((await text()).includes('guest marker one'), 'account shows the moved notes');

// type more, saves to cloud
await p.evaluate(() => { const b = document.querySelector('.nt-body'); b.focus(); const r = document.createRange(); r.selectNodeContents(b); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
await p.keyboard.type(' cloud two');
await sleep(1500);
ok(await waitSaved(), `account save reaches SAVED (${await status()})`);
ok(JSON.stringify(await p.evaluate(() => JSON.parse(localStorage.getItem('fakecloud')).users['dex-google'].doc)).includes('cloud two'), 'account edit is in the store');

// bring in the password notes
await p.click('.dn-account'); await sleep(300);
ok(await clickText('Bring in the password notes…'), 'menu offers the password notes');
await p.waitForSelector('.dn-input', { timeout: 5000 });
await p.type('.dn-input', 'notes');
await p.keyboard.press('Enter');
await p.waitForFunction(() => [...document.querySelectorAll('.nt-modal-title')].some((h) => /Replace/.test(h.textContent)), { timeout: 10000 });
const msg = await p.evaluate(() => document.querySelector('.nt-modal-msg')?.textContent);
console.log('     confirm says:', msg);
ok(await clickText('Replace'), 'Replace pressed');
await p.waitForFunction(() => /password notes are now/.test(document.querySelector('.nt-toast')?.textContent || ''), { timeout: 15000 }).catch(() => {});
const cloud2 = await p.evaluate(() => JSON.parse(localStorage.getItem('fakecloud')).users['dex-google']);
const vault = await (await fetch(`${BASE}/api/notes/unlock`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'notes' }) })).json();
ok(cloud2.backups?.length === 1 && JSON.stringify(cloud2.backups[0].doc).includes('cloud two'), 'the account copy was backed up before the replace');
ok(JSON.stringify(cloud2.doc.sessions) === JSON.stringify(vault.content.sessions), 'account now holds exactly the password notes\' sessions');
ok(!JSON.stringify(cloud2.doc).includes('cloud two'), 'old account text replaced');
const shown = await p.evaluate(() => document.querySelectorAll('.nt-cat').length);
ok(shown > 0, `app re-mounted on the vault notes (${shown} categories)`);

// reload: account remembered
await p.reload({ waitUntil: 'networkidle2' });
await p.waitForSelector('.nt-body', { timeout: 10000 });
ok(await p.evaluate(() => !!document.querySelector('.dn-account')) && !(await p.evaluate(() => document.querySelector('.dn-card'))), 'signed-in reload goes straight to the notes');

// sign out
await p.click('.dn-account'); await sleep(300);
ok(await clickText('Sign out'), 'Sign out pressed');
await p.waitForSelector('.dn-card', { timeout: 10000 }).catch(() => {});
ok(await p.evaluate(() => !!document.querySelector('.dn-card') && !document.querySelector('.nt-body')), 'sign out returns to the gate with no notes on screen');


const real = errors.filter((e) => !/favicon|Failed to load resource/.test(e));
ok(real.length === 0, `no console errors (${real.length})${real.length ? ': ' + real.join(' || ') : ''}`);
// Count the subject: a check that silently stopped running is a failure.
ok(n === EXPECTED, `ran ${n} of ${EXPECTED} checks`);
console.log(`dexnote_check: ${n - bad}/${n} passed`);
await b.close();
process.exit(bad ? 1 : 0);
