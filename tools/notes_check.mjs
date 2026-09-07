/* Drive the notes overlay in a real browser against the real handlers.
 *
 *   node tools/notes_dev_server.mjs &
 *   node tools/notes_check.mjs [--port 8123] [--shots <dir>]
 *
 * Every check below names, in its own comment, what would make it pass while
 * the feature was broken -- because most of these have an obvious version that
 * proves nothing. "Refresh and the text is still there" is true of
 * localStorage. "The second browser sees it" is the only one that actually
 * says the server holds it.
 *
 * THE RUN STARTS FROM THE PRE-REBUILD STORE: it writes the seed into
 * notes/current.html and removes current.json, so the first unlock exercises
 * the migration every real device goes through once. The dev server reads
 * the disk per request, so this is safe to do under it.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const require = createRequire(import.meta.url);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const BASE = `http://127.0.0.1:${arg('--port', 8123)}`;
const SHOTS = resolve(arg('--shots', join(ROOT, '.notes-dev/shots')));
const STORE = resolve(arg('--dir', join(ROOT, '.notes-dev')));
const PASSWORD = 'notes';
const SEED = require(join(ROOT, 'lib/notes-seed.js'));

const CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => p && existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found — set CHROME=<path to the exe>');

const fail = [];
let pass = 0;
const note = (ok, why) => { if (ok) pass++; else fail.push(why); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ---- 0. the store as every device finds it on the first open after the rebuild */
{
  const dir = join(STORE, 'notes');
  await mkdir(dir, { recursive: true });
  for (const sub of ['backups', 'daily', 'assets']) await rm(join(dir, sub), { recursive: true, force: true });
  await rm(join(dir, 'current.json'), { force: true });
  await writeFile(join(dir, 'current.html'), SEED, 'utf8');
  await mkdir(SHOTS, { recursive: true });
  console.log(`store reset: current.html is the seed (${SEED.length} chars), no current.json`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-first-run', '--no-default-browser-check'],
});

async function newPage(context, allow) {
  const page = await (context || browser).newPage();
  // STANDING RULE: refuse downloads before navigating, or a throwaway profile
  // writes into the real ~/Downloads.
  await page.createCDPSession().then(s =>
    s.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {}));
  await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 });
  page.on('pageerror', e => fail.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    const text = m.text();
    // `allow` is for errors a check CAUSES on purpose -- the wrong-password
    // case below makes the browser log a 401, and treating that as a defect
    // would mean the suite could only pass by not testing the failure path.
    if (m.type() !== 'error' || /favicon/i.test(text)) return;
    if (allow && allow.test(text)) return;
    fail.push(`console: ${text}`);
  });
  return page;
}

/* Focus the first box and let the KEYPAD move focus, exactly as a person's
 * typing does. */
async function type(page, word) {
  await page.waitForSelector('#notesPins .vault-pin', { visible: true, timeout: 10000 });
  await page.focus('#notesPins .vault-pin');
  for (const ch of word) {
    await page.keyboard.type(ch);
    await sleep(40);
  }
}

const unlocked = (page) => page.waitForFunction(
  () => !document.getElementById('notesEditor').hidden
     && document.querySelectorAll('.nt-cat').length > 0,
  { timeout: 20000 }).catch(async (err) => {
    const why = await page.evaluate(() => ({
      status: document.getElementById('notesStatus')?.textContent,
      save: document.getElementById('notesSave')?.textContent,
      editorHidden: document.getElementById('notesEditor')?.hidden,
    })).catch(() => ({}));
    throw new Error(`${err.message} — overlay says ${JSON.stringify(why)}`);
  });

const savedOnce = (page) => page.waitForFunction(
  () => /^SAVED/.test(document.querySelector('.nt-status')?.textContent || ''),
  { timeout: 20000 });

/* Type into the first body through real keys. */
async function typeInto(page, marker, nth = 0) {
  await page.evaluate((n) => {
    const b = document.querySelectorAll('.nt-body')[n];
    b.focus();
    const r = document.createRange(); r.selectNodeContents(b); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }, nth);
  await page.keyboard.press('Enter');
  await page.keyboard.type(marker);
}

/* ---- 1. a wrong password must leak nothing -------------------------------
   FALSELY PASSES IF: the content were fetched on load and merely hidden with
   CSS until unlock. So this looks at the whole document and at every response
   body the page received, not at what is visible. It also asserts the app's
   own code was not fetched: an editor downloaded before the password is a
   different kind of leak, but a leak. */
{
  const page = await newPage(null, /401 \(Unauthorized\)/);
  const bodies = [];
  const urls = [];
  page.on('response', async (r) => {
    urls.push(r.url());
    try {
      if (r.request().resourceType() === 'image') return;
      bodies.push(await r.text());
    } catch { /* redirects and 204s have no body */ }
  });
  await page.goto(`${BASE}/#notes`, { waitUntil: 'networkidle2', timeout: 60000 });
  await type(page, 'wrong');
  await page.waitForFunction(
    () => /NOPE|WRONG/i.test(document.getElementById('notesStatus').textContent || ''),
    { timeout: 15000 }).catch(() => {});

  const marker = 'Pick a new game name';          // first line of the seed
  const inDom = await page.evaluate(() => document.documentElement.outerHTML);
  const anywhere = bodies.some(b => b.includes(marker));
  note(!inDom.includes(marker), 'the notes are in the DOM before any unlock');
  note(!anywhere, 'the notes came down the wire before any unlock');
  note(await page.$eval('#notesEditor', el => el.hidden), 'the editor is not hidden after a wrong password');
  note(!urls.some(u => /\/notes\/app\.js/.test(u)), 'the notes app was downloaded before the password passed');
  console.log(`wrong-password leak check: ${bodies.length} response bodies scanned, marker found: ${anywhere}, app fetched: ${urls.some(u => /\/notes\/app\.js/.test(u))}`);
  await page.close();
}

/* ---- 2. the migration: the old HTML becomes the new document, once --------
   FALSELY PASSES IF: it only counted categories. The seed's 127 items are
   asserted, the legacy file is asserted untouched, and the JSON is asserted
   to exist with the first rev. */
{
  const page = await newPage();
  await page.goto(`${BASE}/#notes`, { waitUntil: 'networkidle2', timeout: 60000 });
  await type(page, PASSWORD);
  await unlocked(page);
  await savedOnce(page);
  const shape = await page.evaluate(() => ({
    cats: document.querySelectorAll('.nt-cat').length,
    items: document.querySelectorAll('.nt-body li').length,
    emojis: [...document.querySelectorAll('.nt-cat-emoji')].filter(e => e.classList.contains('is-emoji')).length,
    rows: document.querySelectorAll('.nt-row').length,
    rail: document.querySelectorAll('.nt-rail-cat').length,
    title: document.querySelector('.nt-session-title').textContent,
    styles: document.querySelectorAll('.nt-body [style]').length,
    handlers: document.querySelectorAll('.nt-body [onclick]').length,
    words: document.querySelector('.nt-body').textContent.slice(0, 40),
  }));
  console.log('migrated:', JSON.stringify(shape));
  note(shape.cats === 9, `${shape.cats} categories after migration, expected 9`);
  note(shape.items === 127, `${shape.items} list items after migration, expected 127`);
  note(shape.emojis === 9, `${shape.emojis} categories got an emoji, expected 9`);
  note(shape.rows === 9 && shape.rail === 9, 'the sidebar and rail do not list the nine categories');
  note(shape.title === 'WorldHop', `the session title is "${shape.title}"`);
  note(shape.styles === 0, 'an inline style survived into a body');
  note(shape.handlers === 0, 'an onclick survived into a body');
  note(shape.words.startsWith('Pick a new game name'), 'the first body does not start with the seed');

  const json = JSON.parse(await readFile(join(STORE, 'notes/current.json'), 'utf8'));
  note(json.rev === 1, `current.json is at rev ${json.rev} after the migration save, expected 1`);
  note(json.doc.v === 2 && json.doc.sessions.length === 1 && json.doc.sessions[0].cats.length === 9, 'current.json does not hold the migrated document');
  const legacy = await readFile(join(STORE, 'notes/current.html'), 'utf8');
  note(legacy === SEED, 'current.html was rewritten by the migration -- it must stay as the safety net');
  await page.screenshot({ path: join(SHOTS, 'notes-migrated.png') });
  await page.close();
}

/* ---- 3. an edit survives a hard refresh ---------------------------------
   FALSELY PASSES IF: the save went to localStorage. Guarded two ways: the
   marker is checked in the STORE ON DISK before the reload, and check 4 loads
   it in a browser that shares nothing with this one. */
const marker = `harness-${Date.now().toString(36)}`;
{
  const page = await newPage();
  await page.goto(`${BASE}/#notes`, { waitUntil: 'networkidle2', timeout: 60000 });
  await type(page, PASSWORD);
  await unlocked(page);
  await typeInto(page, marker);
  await savedOnce(page);
  await sleep(200);
  const onDisk = await readFile(join(STORE, 'notes/current.json'), 'utf8');
  note(onDisk.includes(marker), 'the edit never reached the server-side store');

  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await unlocked(page);                              // token in sessionStorage
  const after = await page.$eval('.nt-canvas', el => el.textContent);
  note(after.includes(marker), 'the edit did not survive a reload');
  console.log(`reload check: marker in store=${onDisk.includes(marker)}, on screen after reload=${after.includes(marker)}`);
  await page.close();
}

/* ---- 4. a SECOND browser sees it ----------------------------------------
   This is the only check that proves the server holds the document. An
   incognito context shares no storage of any kind with the one above, so a
   localStorage implementation cannot pass it. */
{
  const context = await browser.createBrowserContext();
  const page = await newPage(context);
  await page.goto(`${BASE}/#notes`, { waitUntil: 'networkidle2', timeout: 60000 });
  await type(page, PASSWORD);
  await unlocked(page);
  const seen = await page.$eval('.nt-canvas', el => el.textContent);
  note(seen.includes(marker), 'a second browser did not see the first browser\'s edit');
  console.log(`second-browser check: marker visible=${seen.includes(marker)}`);
  await page.close();
  await context.close();
}

/* ---- 5. two devices, two categories, both edits survive ---------------------
   FALSELY PASSES IF: only one device ever saved. B is opened BEFORE A saves
   so B's rev is stale; B's save must come back 409, merge, and retry -- and
   A's edit and B's edit must both be in the store afterwards. Before the
   rebuild the later save silently won the whole document. */
{
  const ctxA = await browser.createBrowserContext();
  const ctxB = await browser.createBrowserContext();
  // B's stale save is MEANT to be answered 409; the browser logs that as an error.
  const A = await newPage(ctxA, /409 \(Conflict\)/);
  const B = await newPage(ctxB, /409 \(Conflict\)/);
  const statuses = [];
  B.on('response', (r) => { if (/\/api\/notes\/save/.test(r.url())) statuses.push(r.status()); });
  await A.goto(`${BASE}/#notes`, { waitUntil: 'networkidle2', timeout: 60000 });
  await type(A, PASSWORD); await unlocked(A);
  await B.goto(`${BASE}/#notes`, { waitUntil: 'networkidle2', timeout: 60000 });
  await type(B, PASSWORD); await unlocked(B);
  const mA = `device-a-${Date.now().toString(36)}`;
  const mB = `device-b-${Date.now().toString(36)}`;
  await typeInto(A, mA, 0);
  await savedOnce(A);
  await sleep(300);
  await typeInto(B, mB, 1);
  await savedOnce(B);
  await sleep(500);
  const store = await readFile(join(STORE, 'notes/current.json'), 'utf8');
  console.log(`two devices: B's save statuses ${statuses.join('/')}, A in store=${store.includes(mA)}, B in store=${store.includes(mB)}`);
  note(statuses.includes(409), 'B saved on a stale rev and was NOT told -- the conflict check is not running');
  note(statuses[statuses.length - 1] === 200, `B's retry after the conflict did not succeed (${statuses.join('/')})`);
  note(store.includes(mA), 'device A\'s edit was lost to device B\'s later save');
  note(store.includes(mB), 'device B\'s edit was lost in the merge');
  const merged = await B.evaluate(() => document.querySelector('.nt-canvas').textContent);
  note(merged.includes(mA), 'device B does not show device A\'s edit after merging');
  await A.close(); await B.close();
  await ctxA.close(); await ctxB.close();
}

/* ---- 6. backups are tiered, not one per keystroke ---------------------------
   FALSELY PASSES IF: it only counted after one save. Twenty-five saves inside
   one ten-minute window must leave ONE ten-minute copy and ONE daily copy,
   and current must hold the newest edit. The spacing rule itself is driven
   through a clock in notes_store_check.mjs; this proves the live route
   honours it. */
{
  const page = await newPage();
  await page.goto(`${BASE}/#notes`, { waitUntil: 'networkidle2', timeout: 60000 });
  await type(page, PASSWORD);
  await unlocked(page);
  for (let i = 0; i < 25; i++) {
    await page.evaluate((n) => {
      const b = document.querySelector('.nt-body');
      b.querySelector('li').textContent = `edit ${n}`;
      b.dispatchEvent(new Event('input', { bubbles: true }));
    }, i);
    await page.keyboard.down('Control'); await page.keyboard.press('s'); await page.keyboard.up('Control');
    await savedOnce(page);
    await sleep(40);
  }
  const backups = (await readdir(join(STORE, 'notes/backups'))).filter(f => f.endsWith('.json'));
  const daily = (await readdir(join(STORE, 'notes/daily'))).filter(f => f.endsWith('.json'));
  const current = await readFile(join(STORE, 'notes/current.json'), 'utf8');
  note(backups.length === 1, `${backups.length} ten-minute backups after 25 saves in one window, expected 1`);
  note(daily.length === 1, `${daily.length} daily backups, expected 1`);
  note(current.includes('edit 24'), 'current does not hold the newest save');
  note(daily[0] === `${new Date().toISOString().slice(0, 10)}.json`, `the daily copy is named ${daily[0]}`);
  console.log(`backup check: ${backups.length} ten-minute, ${daily.length} daily, current has edit 24=${current.includes('edit 24')}`);
  await page.close();
}

/* ---- 7. the frame, looked at ------------------------------------------------ */
{
  const page = await newPage();
  await page.goto(`${BASE}/#notes`, { waitUntil: 'networkidle2', timeout: 60000 });
  await type(page, PASSWORD);
  await unlocked(page);
  const fill = await page.evaluate(() => {
    const r = document.querySelector('.notes-shell').getBoundingClientRect();
    const app = document.querySelector('.nt-app').getBoundingClientRect();
    return { w: r.width / innerWidth, h: r.height / innerHeight, appW: app.width / innerWidth, appH: app.height / innerHeight,
             header: document.querySelector('.nt-header').getBoundingClientRect().height,
             sidebar: document.querySelector('.nt-sidebar').getBoundingClientRect().width,
             closeOut: document.querySelectorAll('#notesClose').length && getComputedStyle(document.getElementById('notesClose')).display,
             font: getComputedStyle(document.querySelector('.nt-body')).fontFamily };
  });
  console.log(`frame: shell ${(fill.w * 100).toFixed(0)}%x${(fill.h * 100).toFixed(0)}%, app ${(fill.appW * 100).toFixed(0)}%x${(fill.appH * 100).toFixed(0)}%, header ${fill.header}px, sidebar ${fill.sidebar}px, body font ${fill.font}`);
  note(fill.w >= 0.99 && fill.h >= 0.99, 'the shell is not the whole viewport with the app open');
  note(fill.appW >= 0.99 && fill.appH >= 0.9, 'the app does not fill the shell');
  note(fill.closeOut === 'none', 'the old outside close button is still drawn beside the app');
  note(/Outfit/.test(fill.font), `the body is not in Outfit: ${fill.font}`);
  // Faces load lazily on first use, so ASK for it rather than sampling: a
  // check() the instant after unlock is a race, and it lost once.
  const fonts = await page.evaluate(() => document.fonts.load("16px 'Outfit'").then(f => f.length > 0).catch(() => false));
  note(fonts, 'the Outfit face did not load from the site itself');
  await page.screenshot({ path: join(SHOTS, 'notes-app.png') });

  // Close relocks and removes the document from the page.
  await page.click('.nt-close');
  await sleep(300);
  const gone = await page.evaluate(() => ({
    open: document.getElementById('notesModal').open,
    app: document.querySelectorAll('.nt-app').length,
    text: document.documentElement.outerHTML.includes('Pick a new game name'),
    gate: !document.getElementById('notesGate').hidden,
  }));
  note(!gone.open, 'the app close button did not close the overlay');
  note(gone.app === 0, 'the app is still in the DOM after closing');
  note(!gone.text, 'the notes are still in the page after closing');
  await page.close();
}

/* ---- 8. the Idea Vault opens it, and the SERVER still decides -------------
   FALSELY PASSES IF: the overlay were opened by URL instead. This types the
   code into the VAULT's own keypad and waits for the notes dialog. Under this
   harness the vault code and the notes password are the same word, so the
   hand-off succeeds; in production they differ and the keypad stands. Both
   outcomes are accepted, and what is asserted is that a request went to
   /api/notes/unlock and nothing was in the page before it answered. */
{
  const page = await newPage();
  const unlocks = [];
  page.on('response', (res) => {
    if (/\/api\/notes\/unlock/.test(res.url())) unlocks.push(res.status());
  });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.$eval('#vault', el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForSelector('#vaultPins .vault-pin', { visible: true, timeout: 10000 });
  await page.focus('#vaultPins .vault-pin');
  for (const c of 'notes') { await page.keyboard.type(c); await sleep(60); }
  const opened = await page.waitForFunction(
    () => document.getElementById('notesModal') && document.getElementById('notesModal').open === true, { timeout: 40000 })
    .then(() => true).catch(() => false);
  const leakedEarly = await page.evaluate(() => document.documentElement.outerHTML.includes('Pick a new game name'));
  await sleep(3000);
  const gate = await page.evaluate(() => ({
    keypad: !document.getElementById('notesGate').hidden,
    editorHidden: document.getElementById('notesEditor').hidden,
    app: document.querySelectorAll('.nt-cat').length,
  }));
  const coincide = unlocks.some(s => s === 200);
  console.log(`vault code NOTES: opened=${opened}, ${unlocks.length} unlock request(s) ${unlocks.join('/') || '-'}, keypad=${gate.keypad}, app categories=${gate.app} (this server's notes password ${coincide ? 'IS' : 'is not'} the vault code)`);
  note(opened, 'the vault code did not open the notes overlay');
  note(unlocks.length > 0, 'the vault opened the notes with no request to /api/notes/unlock — something local decided');
  note(!leakedEarly, 'the notes were already in the page when the overlay opened, before any server answer');
  note(coincide ? (!gate.keypad && !gate.editorHidden && gate.app > 0) : (gate.keypad && gate.editorHidden),
       `the server ${coincide ? 'accepted' : 'refused'} the code but the overlay is ${gate.keypad ? 'on the keypad' : 'in the editor'}`);
  await page.screenshot({ path: join(SHOTS, 'notes-from-vault.png') });
  await page.close();
}

await browser.close();
console.log(`\n${pass} checks passed`);
console.log(fail.length ? `FAIL (${fail.length}):\n  ${fail.join('\n  ')}` : 'PASS — every notes check held');
process.exit(fail.length ? 1 : 0);
