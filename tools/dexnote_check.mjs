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
const EXPECTED = 66;

const FAKE_CLOUD = `// Stand-in for dexnote/cloud.js: same exports, the "server" is a localStorage key.
import { keyFor } from '/dexnote/local.js';
const KEY = 'fakecloud';
const all = () => JSON.parse(localStorage.getItem(KEY) || '{"users":{},"signedIn":null}');
const put = (s) => localStorage.setItem(KEY, JSON.stringify(s));
const listeners = [];
const userOf = (uid) => uid ? { uid, email: \`\${uid}@example.com\`, displayName: uid, photoURL: null } : null;
let current = userOf(all().signedIn);
export function onUser(fn) { listeners.push(fn); setTimeout(() => fn(current), 50); return () => {}; }
const emit = () => {
  listeners.forEach((f) => f(current));
  // As the real cloud.js does: the site's cheap flag and the page's event.
  current ? localStorage.setItem('site:signedIn', '1') : localStorage.removeItem('site:signedIn');
  window.dispatchEvent(new CustomEvent('site:user', { detail: { signedIn: !!current } }));
};
export const _current = () => current;
export async function signIn(which) { const s = all(); s.signedIn = 'dex-' + which; put(s); current = userOf(s.signedIn); emit(); return { user: current }; }
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
/* Stand-in for account/site-auth.js, the SITE's sign-in (~DEXDC). The real
   one shares cloud.js's Firebase app, so this one shares the fake's state by
   importing it: a sign-in here is a sign-in there, as it is for real. No ID
   token, so nobody is Dex here -- owner_gate_check covers that door. */
const FAKE_SITE_AUTH = `import * as cloud from '/dexnote/cloud.js';
export const LOCAL_FLAG = 'site:signedIn';
export const onUser = (fn) => cloud.onUser(fn);
export const currentUser = async () => cloud._current();
export const signIn = (which) => cloud.signIn(which);
export const signOut = () => cloud.signOut();
export const idToken = async () => null;
export const errorText = (e) => String((e && e.code) || e);
`;
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run', '--no-default-browser-check'] });
const p = await b.newPage();
await p.setViewport({ width: 1300, height: 850 });
const errors = [];
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
p.on('pageerror', (e) => errors.push('pageerror ' + e.message));
/* /dexnote/ registers a service worker now (the phone app), and a request
   the worker makes for the page is one interception never sees -- the REAL
   cloud.js would come back instead of the fake. Bypassing it keeps every
   request on the network, where the fake answers. dexnote_phone_check.mjs
   is where the worker itself is checked. */
await p.setBypassServiceWorker(true);
await p.setRequestInterception(true);
p.on('request', (r) => {
  const fake = r.url().endsWith('/dexnote/cloud.js') ? FAKE_CLOUD : r.url().endsWith('/account/site-auth.js') ? FAKE_SITE_AUTH : null;
  return fake ? r.respond({ status: 200, contentType: 'text/javascript', body: fake }) : r.continue();
});
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
ok(gate.join('|') === 'Google|Discord|GitHub|Continue as guest', `gate shows 3 providers + guest, no "Continue with": ${JSON.stringify(gate)}`);
/* The card is the site's sign-in panel with dexnote's mark (Dex, 2026-10-09):
   lowercase name, two lines, each provider its mark and its name at the
   site's 195x46 with a 24px mark that actually draws (a mask with no image
   paints a solid square, so the mask is asserted, not just the box). */
const look = await p.evaluate(() => {
  const c = document.querySelector('.dn-card');
  const btns = [...c.querySelectorAll('.dn-provider')].map((b) => { const r = b.getBoundingClientRect(); const m = b.querySelector('.dn-mark'); const mr = m.getBoundingClientRect(); const cs = getComputedStyle(m); return [Math.round(r.width), Math.round(r.height), Math.round(mr.width), /url\(/.test(cs.maskImage || cs.webkitMaskImage)]; });
  return { title: c.querySelector('.dn-title')?.textContent, lines: [...c.querySelectorAll('.dn-note > span')].map((x) => x.textContent), logo: c.querySelector('.dn-logo')?.getAttribute('src'), btns };
});
ok(look.title === 'dexnote' && look.lines.length === 2 && look.logo === '/dexnote/icons/logo-v2.svg', `the card says dexnote in lowercase over two lines, under the new mark: ${JSON.stringify({ title: look.title, lines: look.lines, logo: look.logo })}`);
ok(look.btns.length === 3 && look.btns.every(([w, h, m, mask]) => w === 195 && h === 46 && m === 24 && mask), `the three provider buttons are the site's size with their marks drawn: ${JSON.stringify(look.btns)}`);

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
ok(await clickText('Google'), 'Google pressed');
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

// bring in the password notes -- seeded first with a document nothing else
// on the page could produce, so the comparison below has a subject
const seeded = await p.evaluate(async () => {
  const { emptyDoc } = await import('/notes/state.js');
  const doc = emptyDoc();
  doc.sessions[0].cats[0].title = 'vault fixture';
  const u = await (await fetch('/api/notes/unlock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'notes' }) })).json();
  const r = await fetch('/api/notes/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: u.token, doc, baseRev: u.rev }) });
  return r.ok;
});
ok(seeded, 'the password notes seeded with a fixture');
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
// The store answers its document as TEXT. Compared as text this once read
// undefined === undefined and passed on nothing, so both sides are parsed and
// the subject is asserted to exist first.
const vaultDoc = typeof vault.content === 'string' ? JSON.parse(vault.content) : vault.content;
ok(JSON.stringify(cloud2.doc).includes('vault fixture')
  && JSON.stringify(cloud2.doc.sessions) === JSON.stringify(vaultDoc.sessions), 'account now holds exactly the password notes\' sessions');
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


// ---- the homepage overlay: the same account from every door ---------------
// The AI Lab's DexNote is this browser's guest notes; the keypad's is the
// password notes; both carry the same account button beside the X.
const inOverlay = (sel) => p.evaluate((sel) => !!document.querySelector(`#notesEditor ${sel}`), sel);
const overlayText = () => p.evaluate(() => [...document.querySelectorAll('#notesEditor .nt-body')].map((b) => b.textContent).join('|'));
const pressLab = () => p.evaluate(() => { const e = document.querySelector('[data-notes-demo]'); if (!e) return false; e.click(); return true; });
const overlayGone = () => p.waitForFunction(() => !document.querySelector('#notesEditor .nt-app'), { timeout: 10000 }).then(() => true, () => false);
const beforeHome = errors.length;
await p.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
// The homepage's own load reports two CSP refusals (an inline style and an
// inline script near the top of index.html) on main too, before any of this
// is touched. Reported here, not counted, so a new error still fails.
const homeLoad = errors.splice(beforeHome);
if (homeLoad.length) console.log(`     the homepage itself logged ${homeLoad.length} error(s) on load (not this check's subject)`);
ok(await p.evaluate(() => !document.querySelector('script[src*="firebase"]') && !performance.getEntriesByType('resource').some((r) => /dexnote\/(account|cloud)\.js/.test(r.name))), 'the homepage fetches no account code before anything is opened');
ok(await pressLab(), 'the AI Lab DexNote eye pressed');
await p.waitForSelector('#notesEditor .nt-body', { timeout: 15000 });
ok(await inOverlay('.dn-account') && await inOverlay('.nt-close') && !(await inOverlay('.is-demo')), 'the AI Lab opens the real app with the account button AND the X');
ok(/Brainstorm/.test(await p.evaluate(() => document.querySelector('#notesEditor .nt-app').textContent)), 'a first open shows the tour document');
await p.evaluate(() => { const b = document.querySelector('#notesEditor .nt-body'); b.focus(); const r = document.createRange(); r.selectNodeContents(b); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
await p.keyboard.type(' lab guest marker');
ok(await waitSaved(), `the AI Lab notes save as a guest (${await status()})`);
ok(await p.evaluate(() => (localStorage.getItem('dexnote:guest:v1') || '').includes('lab guest marker')), 'into the same guest store /dexnote/ uses');
await p.click('#notesEditor .nt-close');
ok(await overlayGone(), 'the X closes it');
await pressLab();
await p.waitForSelector('#notesEditor .nt-body', { timeout: 15000 });
ok((await overlayText()).includes('lab guest marker'), 'reopened from the AI Lab, the guest text is still there');

await p.click('#notesEditor .dn-account'); await sleep(300);
ok(await clickText('Sign in…'), 'the overlay account menu offers Sign in…');
await p.waitForSelector('#notesEditor .dn-card', { timeout: 5000 }).catch(() => {});
ok(await clickText('Google'), 'Google pressed inside the overlay');
await p.waitForFunction(() => /vault fixture/.test(document.querySelector('#notesEditor .nt-app')?.textContent || ''), { timeout: 15000 }).catch(() => {});
const cloud3 = await p.evaluate(() => JSON.parse(localStorage.getItem('fakecloud')).users['dex-google']);
ok(JSON.stringify(cloud3.doc).includes('lab guest marker') && JSON.stringify(cloud3.doc).includes('vault fixture'), 'signing in from the overlay moved the guest notes into the account');
// Which store is mounted is proved by where an edit lands, not by what is
// on screen: the account's active session is its own, not the guest's.
ok(!(await inOverlay('.dn-card')), 'the sign-in sheet went away');
await p.evaluate(() => { const b = document.querySelector('#notesEditor .nt-body'); b.focus(); const r = document.createRange(); r.selectNodeContents(b); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
await p.keyboard.type(' acct marker a');
await waitSaved();
ok(JSON.stringify(await p.evaluate(() => JSON.parse(localStorage.getItem('fakecloud')).users['dex-google'].doc)).includes('acct marker a'), 'the overlay now edits the account\'s notes');
await p.click('#notesEditor .nt-close');
await overlayGone();

await p.goto(`${BASE}/#notes`, { waitUntil: 'networkidle2' });
await p.waitForSelector('#notesPins .vault-pin', { visible: true, timeout: 10000 });
await p.focus('#notesPins .vault-pin');
for (const ch of 'notes') { await p.keyboard.type(ch); await sleep(40); }
await p.waitForSelector('#notesEditor .dn-account', { timeout: 20000 }).catch(() => {});
ok(await inOverlay('.dn-account') && await inOverlay('.nt-close'), 'the keypad opens the password notes with the same account button');
await p.click('#notesEditor .dn-account'); await sleep(300);
const items = await p.evaluate(() => [...document.querySelectorAll('.nt-menu button, .nt-menu [role="menuitem"]')].map((b) => b.textContent.trim()));
ok(items.includes('dex-google@example.com') && items.includes('Open my account notes') && items.includes('Bring in the password notes…'), `signed in, the keypad's menu offers the account: ${JSON.stringify(items)}`);
ok(await clickText('Open my account notes'), 'Open my account notes pressed');
await p.waitForFunction(() => /acct marker a/.test(document.querySelector('#notesEditor .nt-app')?.textContent || ''), { timeout: 15000 }).catch(() => {});
await p.evaluate(() => { const b = document.querySelector('#notesEditor .nt-body'); b.focus(); const r = document.createRange(); r.selectNodeContents(b); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
await p.keyboard.type(' acct marker b');
await waitSaved();
const vaultNow = await (await fetch(`${BASE}/api/notes/unlock`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'notes' }) })).json();
ok(JSON.stringify(await p.evaluate(() => JSON.parse(localStorage.getItem('fakecloud')).users['dex-google'].doc)).includes('acct marker b')
  && !JSON.stringify(vaultNow.content).includes('acct marker'), 'the keypad overlay swapped to the account notes, and the password notes did not get the edit');
await p.click('#notesEditor .dn-account'); await sleep(300);
ok(await clickText('Sign out'), 'Sign out pressed in the overlay');
await p.waitForFunction(() => document.querySelector('#notesEditor .nt-app') && !/acct marker/.test(document.querySelector('#notesEditor .nt-app').textContent), { timeout: 15000 }).catch(() => {});
ok(await p.evaluate(() => !JSON.parse(localStorage.getItem('fakecloud')).signedIn) && !/acct marker/.test(await overlayText()) && /vault fixture/.test(await overlayText() + await p.evaluate(() => document.querySelector('#notesEditor .nt-app')?.textContent || '')), 'signing out puts the password notes back, not the account\'s');

// ~DEXDC is the SITE's sign-in (Dex, 2026-10-09): from any keypad it opens
// one panel -- the site's own mark, Google / GitHub / Discord, no DexNote --
// and opens nothing else. Signed in, the same panel says who and offers Sign
// out. Over an open overlay it stacks, and the notes on screen follow the
// account it signs in to or out of. Nothing goes to the notes server for the
// code itself.
await p.click('#notesEditor .nt-close').catch(() => {});
await overlayGone();
await p.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
errors.splice(beforeHome);
let codeCalls = 0;
p.on('request', (r) => { if (r.url().includes('/api/notes/unlock') && /dexdc/i.test(r.postData() || '')) codeCalls++; });
const tilde = async (word) => {
  await p.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
  await p.keyboard.press('`');
  await p.waitForSelector('#codeModal[open] .vault-pin', { timeout: 5000 }).catch(() => {});
  await p.focus('#codeModal .vault-pin').catch(() => {});
  for (const ch of word) { await p.keyboard.type(ch); await sleep(40); }
};
const panel = () => p.evaluate(() => {
  const d = document.querySelector('#signinModal');
  if (!d || !d.open) return null;
  const visible = (b) => !!b && b.getClientRects().length > 0;
  const btn = (t) => [...d.querySelectorAll('button')].find((x) => x.textContent.trim() === t);
  return {
    text: d.textContent, logo: d.querySelector('.signin-logo')?.getAttribute('src') || '',
    google: visible(btn('Google')), github: visible(btn('GitHub')), discord: visible(btn('Discord')),
    signOut: visible(btn('Sign out')), notesOpen: !!document.querySelector('#notesModal[open]'),
  };
});
const panelPress = (t) => p.evaluate((t) => { const b = [...document.querySelectorAll('#signinModal button')].find((x) => x.textContent.trim() === t); if (!b || b.hidden) return false; b.click(); return true; }, t);
const panelShut = () => p.waitForFunction(() => !document.querySelector('#signinModal[open]'), { timeout: 10000 }).then(() => true, () => false);
const signedInAs = () => p.evaluate(() => JSON.parse(localStorage.getItem('fakecloud') || '{}').signedIn || null);

await tilde('dexdc');
await p.waitForSelector('#signinModal[open]', { timeout: 10000 }).catch(() => {});
let sp = await panel();
ok(sp && sp.google && sp.github && sp.discord && !sp.signOut && /^data:image\/svg\+xml/.test(sp.logo) && !/DexNote/i.test(sp.text) && /dexcimino\.com/.test(sp.text),
  `~dexdc signed out opens the SITE sign-in: its own mark, three providers, no Sign out, no DexNote: ${JSON.stringify(sp && { ...sp, logo: sp.logo.slice(0, 30), text: sp.text.slice(0, 80) })}`);
ok(sp && !sp.notesOpen && !(await p.evaluate(() => !!document.querySelector('#notesEditor .nt-app'))), 'and the notes did not open');
const order = await p.evaluate(() => [...document.querySelectorAll('#signinModal .signin-provider')].map((b) => b.textContent.trim()));
ok(order.join() === 'Google,Discord,GitHub,Email or name', `the buttons run Google, Discord, GitHub (Dex, 2026-10-09): ${order.join(', ')}`);
// The fourth way in: one box for an email or an Inko name, in the same column.
await panelPress('Email or name');
const form = await p.evaluate(() => {
  const d = document.querySelector('#signinModal');
  const f = d.querySelector('.signin-form');
  return { form: !!f && !f.hidden && getComputedStyle(f).display !== 'none', providers: !d.querySelector('.signin-providers').hidden,
    inputs: [...d.querySelectorAll('.signin-form input')].map((i) => i.type + ':' + i.placeholder), focused: document.activeElement && document.activeElement.placeholder };
});
ok(form.form && !form.providers && form.inputs.join() === 'text:Email or Inko name,password:Password' && form.focused === 'Email or Inko name',
  `Email or name swaps the buttons for an email-or-name box and a password, with the caret in it: ${JSON.stringify(form)}`);
await panelPress('Other ways to sign in');
ok(await p.evaluate(() => { const d = document.querySelector('#signinModal'); return !d.querySelector('.signin-providers').hidden && d.querySelector('.signin-form').hidden; }),
  'and Other ways to sign in puts the buttons back');
const profileState = () => p.evaluate(() => { const b = document.querySelector('#profileButton'); return b && { on: b.classList.contains('is-signed-in'), label: b.getAttribute('aria-label') }; });
ok(await panelPress('Google'), 'Google pressed on the site panel');
ok(await panelShut() && await signedInAs() === 'dex-google' && !(await p.evaluate(() => !!document.querySelector('#notesModal[open]'))),
  'the sign-in closes the panel, signs in, and still opens no notes');
await p.waitForFunction(() => document.querySelector('#profileButton')?.classList.contains('is-signed-in'), { timeout: 5000 }).catch(() => {});
ok(JSON.stringify(await profileState()) === JSON.stringify({ on: true, label: 'Your account' }), `the profile button at the top right fills in once signed in: ${JSON.stringify(await profileState())}`);
await tilde('dexdc');
await p.waitForSelector('#signinModal[open]', { timeout: 10000 }).catch(() => {});
await p.waitForFunction(() => /Signed in as/.test(document.querySelector('#signinModal')?.textContent || ''), { timeout: 10000 }).catch(() => {});
sp = await panel();
ok(sp && /Your account/.test(sp.text) && /Signed in as dex-google@example\.com/.test(sp.text) && !sp.google && !sp.github && sp.signOut,
  `~dexdc signed in is the account's own menu: who, a Sign out, and no sign-in buttons: "${sp && sp.text.slice(0, 90)}"`);
ok(await panelPress('Sign out'), 'Sign out pressed on that panel');
ok(await panelShut() && await signedInAs() === null, 'and it signs out and closes');
await p.waitForFunction(() => !document.querySelector('#profileButton')?.classList.contains('is-signed-in'), { timeout: 5000 }).catch(() => {});
ok(JSON.stringify(await profileState()) === JSON.stringify({ on: false, label: 'Sign in' }), `and the profile button goes back to Sign in: ${JSON.stringify(await profileState())}`);
// The button itself opens the same panel. It is fixed where the docked toggle
// sits from the first frame, so scrolling must not move it by a pixel.
const atTop = await p.evaluate(() => { const r = document.querySelector('#profileButton').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; });
await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 1600); });
await p.waitForFunction(() => document.querySelector('#accentPicker')?.classList.contains('compact'), { timeout: 5000 }).catch(() => {});
await sleep(400);
const docked = await p.evaluate(() => {
  const r = document.querySelector('#profileButton').getBoundingClientRect();
  const act = document.querySelector('#accentSwatches .swatch.active');
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return { right: Math.round(innerWidth - r.right), top: Math.round(r.top), w: Math.round(r.width), hit: !!hit && !!hit.closest('#profileButton'), activeShown: getComputedStyle(act).opacity };
});
ok(docked.right < 40 && docked.top < 30 && docked.w >= 36 && docked.hit && docked.activeShown === '0',
  `scrolled, the profile button stays at the top right in place of the active swatch: ${JSON.stringify(docked)}`);
const scrolledAt = await p.evaluate(() => { const r = document.querySelector('#profileButton').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; });
ok(JSON.stringify(atTop) === JSON.stringify(scrolledAt), `and it is exactly where it was at the top of the page: ${JSON.stringify(atTop)} then ${JSON.stringify(scrolledAt)}`);
// Headless Chrome has no hover, so this is the TOUCH path: the first tap opens
// the swatches (there is no hover to do it), the second opens the panel.
await p.click('#profileButton');
await sleep(400);
const firstTap = await p.evaluate(() => [document.querySelector('#accentPicker').classList.contains('open'), !!document.querySelector('#signinModal[open]')]);
const listed = await p.evaluate(() => [...document.querySelectorAll('#accentSwatches .swatch')]
  .map((s) => ({ active: s.classList.contains('active'), shown: getComputedStyle(s).opacity !== '0' })));
ok(listed.length === 7 && listed.filter((s) => s.shown).length === 6 && listed.every((s) => s.shown !== s.active),
  `the open stack lists the six other accents and never the current one: ${JSON.stringify(listed)}`);
await p.click('#profileButton');
await p.waitForSelector('#signinModal[open]', { timeout: 5000 }).catch(() => {});
sp = await panel();
ok(firstTap[0] && !firstTap[1] && sp && sp.google && !sp.signOut, `a first tap drops the swatches, a second opens the site sign-in (${JSON.stringify(firstTap)})`);
await panelPress('Not now');
await panelShut();
await p.evaluate(() => window.scrollTo(0, 0));

// Over an open overlay: the AI Lab's notes (a guest, signed out).
await pressLab();
await p.waitForSelector('#notesEditor .nt-body', { timeout: 15000 });
await tilde('dexdc');
await p.waitForSelector('#signinModal[open]', { timeout: 10000 }).catch(() => {});
sp = await panel();
ok(sp && sp.notesOpen && sp.google, 'typed over the notes, the panel stacks on them and the notes stay open underneath');
await panelPress('Google');
await panelShut();
await p.waitForFunction(() => /acct marker/.test(document.querySelector('#notesEditor .nt-app')?.textContent || ''), { timeout: 15000 }).catch(() => {});
ok(/acct marker/.test(await overlayText()) && await p.evaluate(() => !!document.querySelector('#notesModal[open]')), 'signing in there puts the account\'s notes on screen in the open overlay');
await tilde('dexdc');
await p.waitForSelector('#signinModal[open]', { timeout: 10000 }).catch(() => {});
await p.waitForFunction(() => /Signed in as/.test(document.querySelector('#signinModal')?.textContent || ''), { timeout: 10000 }).catch(() => {});
await panelPress('Sign out');
await panelShut();
await p.waitForFunction(() => document.querySelector('#notesEditor .nt-app') && !/acct marker/.test(document.querySelector('#notesEditor .nt-app').textContent), { timeout: 15000 }).catch(() => {});
ok(await signedInAs() === null && !/acct marker/.test(await overlayText()) && await p.evaluate(() => !!document.querySelector('#notesEditor .nt-app')),
  'signing out there takes the account\'s notes off the screen and leaves the overlay up');
ok(codeCalls === 0, `the code itself was sent to the notes server ${codeCalls} times`);

const real = errors.filter((e) => !/favicon|Failed to load resource/.test(e));
ok(real.length === 0, `no console errors (${real.length})${real.length ? ': ' + real.join(' || ') : ''}`);
// Count the subject: a check that silently stopped running is a failure.
ok(n === EXPECTED, `ran ${n} of ${EXPECTED} checks`);
console.log(`dexnote_check: ${n - bad}/${n} passed`);
await b.close();
process.exit(bad ? 1 : 0);
