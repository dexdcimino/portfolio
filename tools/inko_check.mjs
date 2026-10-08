/* Inko, driven in a real browser.
 *
 *   node tools/inko_check.mjs
 *
 * Serves the repo itself, with ETags (as Vercel sends them) and with the
 * /inko/ Content-Security-Policy READ OUT OF vercel.json, so the app runs
 * under the policy it ships with rather than under none.
 *
 * WHAT IT IS FOR (Dex, 2026-10-07): the installed app only "sometimes" got
 * updates, the gallery silently deleted the oldest drawing past 20, and
 * localStorage was a few drawings from full. Each of those is driven here:
 *   - a legacy localStorage gallery of 22 drawings and a draft, MIGRATED to
 *     IndexedDB with nothing lost and the old keys gone only afterwards;
 *   - more than 20 drawings kept;
 *   - a real stroke, undo, redo, save, a reload that keeps it all;
 *   - a SERVED FILE CHANGED UNDER A RUNNING APP -- the update arrives on its
 *     own when the app comes back to the foreground, the drawing survives the
 *     reload, and the build label changes;
 *   - offline launch from the service worker's cache;
 *   - the overlay (?embed=1) with no install button and no service worker.
 *
 * FALSELY PASSES IF: the update test changed nothing the app checks. So the
 * file it edits is one of the three the app fingerprints, the reload is
 * proven by a marker the old page set and the new page does not have, and
 * the label is compared before and after.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CHROME = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found — set CHROME=<path to the exe>');

// The policy the site really sends for /inko/, out of vercel.json.
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const inkoHeaders = (vercel.headers.find(h => h.source === '/inko/(.*)') || {}).headers || [];
const CSP = (inkoHeaders.find(h => h.key === 'Content-Security-Policy') || {}).value || '';
if (!/script-src/.test(CSP)) throw new Error('no /inko/ Content-Security-Policy found in vercel.json');
// upgrade-insecure-requests would turn this http harness's requests into https.
const HARNESS_CSP = CSP.replace(/;\s*upgrade-insecure-requests/, '');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const overrides = new Map();   // path -> replacement body, to change a "deployed" file
let offline = false;
const server = createServer(async (req, res) => {
  if (offline) { req.socket.destroy(); return; }
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url.endsWith('/')) url += 'index.html';
  const file = resolve(join(ROOT, normalize(url)));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = overrides.has(url) ? Buffer.from(overrides.get(url)) : await readFile(file);
    const etag = '"' + createHash('md5').update(body).digest('hex') + '"';
    const headers = { 'content-type': MIME[extname(file)] || 'application/octet-stream', etag,
                      'cache-control': 'public, max-age=0, must-revalidate' };
    if (url.startsWith('/inko/')) headers['content-security-policy'] = HARNESS_CSP;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers).end(); return; }
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const fail = [];
let pass = 0;
const note = (ok, why) => { if (ok) pass++; else fail.push(why); };
// + and the gallery live in the options bar (Dex, 2026-10-08): open it first.
// A + here is one of the run's own canvases, not a person spamming: the new-canvas limit is cleared for it
// (the limit itself is driven on purpose in its own block).
// The gallery is on the toolbar itself since batch 13; asked for while it is already open, it stays open (its
// button would be under the gallery's own back button).
const optTap = async (p, sel) => {
  if (sel === '#grid-btn') { if (await p.evaluate(() => document.getElementById('gallery').classList.contains('open'))) return; return p.click(sel); }
  await p.evaluate(plus => { if (plus) localStorage.removeItem('inko:newRate'); if (document.getElementById('opt-bar').hidden) document.getElementById('opt-btn').click(); }, sel === '#plus-btn'); return p.click(sel); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--no-first-run', '--no-default-browser-check'] });
try {
  const page = await browser.newPage();
  await page.createCDPSession().then(s => s.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {}));
  await page.setViewport({ width: 420, height: 860, isMobile: true, hasTouch: false, deviceScaleFactor: 2 });   // a phone's pixel ratio: the eyedropper misread at 2
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  const state = () => page.evaluate(async () => {
    const open = () => new Promise((res, rej) => { const r = indexedDB.open('inko'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    // An app without the stores (the pre-rebuild one) reads as EMPTY, and fails
    // the assertions below one by one rather than crashing the run.
    let all = [], draft = null;
    try {
      const d = await open();
      if (d.objectStoreNames.contains('canvases')) {
        all = await new Promise(res => { const q = d.transaction('canvases').objectStore('canvases').getAll(); q.onsuccess = () => res(q.result); });
        draft = await new Promise(res => { const q = d.transaction('meta').objectStore('meta').get('draft'); q.onsuccess = () => res(q.result || null); });
      }
      d.close();
    } catch (e) { /* no database at all */ }
    return { count: all.length, ids: all.map(x => x.id).sort(), blobs: all.every(x => x.png instanceof Blob),
             draft: draft ? { title: draft.title, editingId: draft.editingId, png: draft.png instanceof Blob } : null,
             ls: [localStorage.getItem('sketchGalleryV1'), localStorage.getItem('sketchDraftV1')].filter(Boolean).length,
             label: (document.getElementById('g-build') || {}).textContent || '',
             undo: !document.getElementById('undo-btn').disabled, redo: !document.getElementById('redo-btn').disabled,
             title: document.getElementById('title-input').value };
  });
  // Ink on the strokes layer, read off the visible canvas at its centre band.
  const ink = () => page.evaluate(() => {
    const c = document.getElementById('pad'), x = c.getContext('2d');
    const d = x.getImageData(0, Math.floor(c.height * 0.45), c.width, Math.floor(c.height * 0.1)).data;
    // Red (the old default brush) or the deep blue that is the default now (hue 200, 100%, 25%).
    let n = 0; for (let i = 0; i < d.length; i += 4) if ((d[i] > 200 && d[i + 1] < 80 && d[i + 2] < 80) || (d[i] < 25 && d[i + 1] > 25 && d[i + 1] < 60 && d[i + 2] > 45 && d[i + 2] < 85)) n++;
    return n;
  });
  const stroke = async () => {
    const r = await page.evaluate(() => { const b = document.getElementById('pad').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
    await page.mouse.move(r.x + r.w * 0.2, r.y + r.h * 0.5);
    await page.mouse.down();
    await page.mouse.move(r.x + r.w * 0.8, r.y + r.h * 0.5, { steps: 12 });
    await page.mouse.up();
    await sleep(500);
  };

  // ---- 1. a legacy localStorage gallery of 22, and a draft --------------
  await page.goto(`${BASE}/inko/legacy-seed`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.goto(`${BASE}/inko/manifest.webmanifest`);    // same origin, to write localStorage before the app runs
  await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 40; c.height = 40;
    const x = c.getContext('2d'); x.fillStyle = '#e00'; x.fillRect(5, 5, 30, 30);
    const png = c.toDataURL('image/png');
    const gallery = Array.from({ length: 22 }, (_, i) => ({ id: 'old' + i, title: 'Old ' + i, bg: { h: 200, s: 30, b: 50 }, strokes: png, ts: 1700000000000 + i }));
    localStorage.setItem('sketchGalleryV1', JSON.stringify(gallery));
    localStorage.setItem('sketchDraftV1', JSON.stringify({ title: 'Draft from before', bg: { h: 10, s: 20, b: 90 }, strokes: png }));
  });
  await page.goto(`${BASE}/inko/`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => (document.getElementById('g-build') || {textContent: ''}).textContent.startsWith('build '), { timeout: 15000 }).catch(() => {});
  const migrated = await state();
  // 22 drawings plus the old draft, which is on screen and so is a card too.
  note(migrated.count === 23 && migrated.blobs, `migration kept ${migrated.count} of 22 drawings + the draft's card (as Blobs: ${migrated.blobs})`);
  note(migrated.ls === 0, 'the old localStorage keys are still there after the migration');
  note(migrated.title === 'Draft from before', `the old draft did not come back (title "${migrated.title}")`);
  note(/^build [0-9a-z]{6}$/.test(migrated.label), `the build label reads "${migrated.label}"`);
  console.log(`migration: ${migrated.count} drawings, draft "${migrated.title}", ${migrated.label}`);

  // ---- 2. a real stroke, undo and redo ----------------------------------
  // A clean canvas first: + saves the migrated draft (23 now) and starts over.
  await optTap(page, '#plus-btn'); await sleep(800);
  const afterPlus = await state();
  // None of the migrated drawings is untitled, so the count starts from plain "Untitled" (batch 13).
  note(afterPlus.count === 24 && afterPlus.title === 'Untitled', `+ left ${afterPlus.count} drawings, wanted 24 — and more than 20 is the point; the new one is "${afterPlus.title}"`);
  await page.evaluate(() => { for (const [id, v] of [['hue', 0], ['sat', 100], ['bri', 100]]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input')); } });   // full red: the default brush is a dark blue now
  await stroke();
  const inked = await ink();
  note(inked > 200, `a stroke drew ${inked} red pixels`);
  note((await state()).undo, 'undo is not enabled after a stroke');
  await page.click('#undo-btn'); await sleep(600);
  note(await ink() < 20, 'undo did not take the stroke off');
  await page.click('#redo-btn'); await sleep(600);
  note(await ink() > 200, 'redo did not bring the stroke back');

  // ---- 3. the draft survives a reload, and + on a blank adds nothing -----
  await page.evaluate(() => { document.getElementById('title-input').value = ''; });
  await page.type('#title-input', 'Harness sketch');
  await sleep(1000);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => (document.getElementById('g-build') || {textContent: ''}).textContent.startsWith('build '), { timeout: 15000 }).catch(() => {});
  await sleep(500);
  const reloaded = await state();
  note(reloaded.title === 'Harness sketch' && await ink() > 200, `after a reload: title "${reloaded.title}", the stroke ${await ink() > 200 ? 'kept' : 'LOST'}`);
  await optTap(page, '#plus-btn'); await sleep(800);
  const saved = await state();
  note(saved.count === 25, `+ after the sketch left ${saved.count} drawings, wanted 25`);
  await optTap(page, '#plus-btn'); await sleep(800);
  // A blank canvas is a canvas (Dex, 2026-10-08): + always makes one, named in turn.
  const blank = await state();
  // "Untitled" was renamed "Harness sketch", so the + after it started again from "Untitled", and this one counts on from it.
  note(blank.count === 26 && blank.title === 'Untitled 1', `a + on a blank canvas left ${blank.count} drawings titled "${blank.title}", wanted 26 and Untitled 1 (the first was renamed, so the count restarted)`);

  // ---- 4. a served file changes under the running app --------------------
  const before = (await state()).label;
  await stroke();
  await sleep(900);                                       // the draft is written
  await page.evaluate(() => { window.__oldPage = true; });
  const css = await readFile(join(ROOT, 'inko', 'app.css'), 'utf8');
  overrides.set('/inko/app.css', css + '\n/* deployed by the harness */\n');
  // The app returning to the foreground: what resuming it on a phone fires.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const reloadedForUpdate = await page.waitForFunction(() => !window.__oldPage && (document.getElementById('g-build') || {textContent: ''}).textContent.startsWith('build '), { timeout: 15000 })
    .then(() => true).catch(() => false);
  note(reloadedForUpdate, 'a changed app.css did not reload the app when it came back to the foreground');
  await sleep(700);
  const updated = await state();
  note(updated.label !== before, `the build label stayed "${updated.label}" across the update`);
  const toastText = await page.evaluate(() => document.getElementById('toast').textContent);
  note(/^Updated — build /.test(toastText), `after the update the toast reads "${toastText}"`);
  note(await ink() > 200, 'the drawing in progress was lost across the update reload');
  console.log(`update: ${before} -> ${updated.label}, toast "${toastText}"`);
  // ...and an unchanged deploy does NOT reload.
  await page.evaluate(() => { window.__stillHere = true; document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(1500);
  note(await page.evaluate(() => window.__stillHere === true), 'the app reloaded with nothing deployed');

  // ---- 5. undo that outlives the page (Dex, 2026-10-08) ------------------
  // Backgrounding a phone app can reload it -- the OS reclaiming it, or an
  // update arriving -- and undo used to come back empty.
  const ready = () => page.waitForFunction(() => (document.getElementById('g-build') || {textContent: ''}).textContent.startsWith('build '), { timeout: 15000 }).catch(() => {});
  const undoDepth = () => page.evaluate(async () => {
    const b = document.getElementById('undo-btn'); let n = 0;
    while (!b.disabled && n < 200) { b.click(); n++; await new Promise(r => setTimeout(r, 150)); }
    return n;
  });
  const db = () => page.evaluate(async () => {
    const d = await new Promise((res, rej) => { const r = indexedDB.open('inko'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = (store) => new Promise(res => { const q = d.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result); });
    const canvases = await all('canvases'), meta = await all('meta'), steps = await all('steps');
    d.close();
    const owners = {};
    for (const c of canvases) { const o = c.owner || 'local'; owners[o] = (owners[o] || 0) + 1; }
    return { owners, hists: meta.filter(m => m.key.startsWith('hist:')).map(m => m.key.slice(5)), steps: steps.length,
             gallery: document.getElementById('g-count').textContent };
  });
  const galleryCount = async () => {
    await page.bringToFront();               // a background tab renders no frames, and a click waits for one
    await optTap(page, '#grid-btn'); await sleep(400);
    const n = await page.evaluate(() => document.querySelectorAll('#g-rows .g-item').length);
    await page.click('#g-back'); await sleep(200);
    return n;
  };
  await optTap(page, '#plus-btn'); await sleep(800);
  for (let i = 0; i < 3; i++) await stroke();
  await sleep(1000);
  await page.reload({ waitUntil: 'networkidle2' }); await ready(); await sleep(600);
  const warm = await undoDepth();
  note(warm === 3, `after a reload with the app still open, ${warm} of 3 strokes could be undone`);
  // Back to all three drawn, then past KEEP_STEPS, then the app CLOSED:
  // sessionStorage is what a closed app loses.
  await page.evaluate(async () => { const b = document.getElementById('redo-btn'); while (!b.disabled) { b.click(); await new Promise(r => setTimeout(r, 150)); } });
  for (let i = 0; i < 24; i++) await stroke();
  await sleep(1000);
  await page.reload({ waitUntil: 'networkidle2' }); await ready(); await sleep(600);
  const full = await undoDepth();
  note(full === 27, `the whole stack did not come back while open: ${full} undos of 27`);
  await page.evaluate(async () => { const b = document.getElementById('redo-btn'); while (!b.disabled) { b.click(); await new Promise(r => setTimeout(r, 150)); } });
  await sleep(1000);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' }); await ready(); await sleep(600);
  const cold = await undoDepth();
  note(cold === 19, `after the app was closed, ${cold} undos came back — wanted 19 (the last 20 steps)`);
  // Leaving a canvas keeps its last strokes; opening it again brings them.
  await page.evaluate(async () => { const b = document.getElementById('redo-btn'); while (!b.disabled) { b.click(); await new Promise(r => setTimeout(r, 150)); } });
  await page.type('#title-input', 'Kept history');
  await optTap(page, '#plus-btn'); await sleep(1200);
  await stroke();                                          // a different canvas
  await optTap(page, '#grid-btn'); await sleep(400);
  await page.evaluate(() => [...document.querySelectorAll('#g-rows .g-item')].find(el => el.textContent.includes('Kept history')).click());
  await sleep(1200);
  const reopened = await undoDepth();
  note(reopened === 19, `reopening a canvas brought back ${reopened} undos, wanted 19`);
  const kept = await db();
  note(kept.hists.length >= 1, `no canvas kept its undo history (kept: ${kept.hists.length})`);
  // Deleting it takes its history with it.
  await optTap(page, '#grid-btn'); await sleep(400);
  await page.evaluate(() => [...document.querySelectorAll('#g-rows .g-item')].find(el => el.textContent.includes('Kept history')).querySelector('.g-del').click());
  await sleep(300); await page.click('#m-del'); await sleep(1500);
  await page.click('#g-back'); await sleep(200);
  const afterDel = await db();
  note(afterDel.hists.length === kept.hists.length - 1, `deleting the canvas left its history: ${kept.hists.length} kept before, ${afterDel.hists.length} after`);
  console.log(`undo: ${warm} back after a reload, ${full} with the app open, ${cold} after it closed, ${reopened} on reopening a canvas; ${kept.hists.length} canvas histories kept, ${afterDel.hists.length} after a delete`);

  // ---- 6. each account its own canvases (Dex, 2026-10-08) ----------------
  // Signed out has its own; an account's FIRST sign-in on this device takes
  // the signed-out ones with it; another account sees none of them.
  const signedOut = await galleryCount();
  const owners0 = (await db()).owners;
  note(signedOut > 20 && Object.keys(owners0).length === 1, `signed out shows ${signedOut} canvases, owners ${JSON.stringify(owners0)}`);
  // A sign-in landing from another tab (the overlay's route) -- the storage event.
  const other = await browser.newPage();
  await other.goto(`${BASE}/inko/manifest.webmanifest`);
  await other.evaluate(() => localStorage.setItem('sketchSession', JSON.stringify({ handle: 'artist_a', token: 'x.y' })));
  await sleep(1500);
  const owners1 = (await db()).owners;
  note(owners1['u:artist_a'] === signedOut && !owners1.local, `first sign-in did not take the canvases along: ${JSON.stringify(owners1)}`);
  note(await galleryCount() === signedOut, 'signed in, the gallery does not show the canvases it brought');
  // Signing out: none of them, and something new made signed out stays there.
  await page.bringToFront();
  await page.bringToFront();
  await optTap(page, '#grid-btn'); await sleep(300);
  await page.click('#g-account'); await sleep(300);
  await page.click('#a-signout'); await sleep(1500);
  await page.click('#g-back'); await sleep(200);
  note(await galleryCount() === 1, 'signed out, the account\'s canvases still show (wanted only the fresh blank one)');
  await stroke();
  await page.type('#title-input', 'Made signed out');
  await optTap(page, '#plus-btn'); await sleep(1200);
  note(await galleryCount() === 2, 'a canvas made signed out is not in the signed-out gallery');
  // The same account again (not a first sign-in): its own, not the new one.
  await other.evaluate(() => localStorage.setItem('sketchSession', JSON.stringify({ handle: 'artist_a', token: 'x.y' })));
  await sleep(1500);
  note(await galleryCount() === signedOut, 'signing back in did not show exactly that account\'s canvases');
  // A different account: a first sign-in, so it takes the one signed-out canvas.
  await other.evaluate(() => localStorage.setItem('sketchSession', JSON.stringify({ handle: 'artist_b', token: 'x.y' })));
  await sleep(1500);
  const owners2 = (await db()).owners;
  note(await galleryCount() === 2 && owners2['u:artist_b'] === 2 && owners2['u:artist_a'] === signedOut,
    `a second account sees the wrong canvases: ${JSON.stringify(owners2)}`);
  // A reload keeps the scope.
  await page.reload({ waitUntil: 'networkidle2' }); await ready(); await sleep(600);
  note(await galleryCount() === 2, 'after a reload the signed-in gallery changed');
  console.log(`accounts: ${signedOut} signed out -> @artist_a; signed out then shows only a fresh blank, a new one there; @artist_b took it: ${JSON.stringify(owners2)}`);
  await other.evaluate(() => localStorage.removeItem('sketchSession'));
  await other.close();
  await sleep(1500);

  // ---- 6b. the two colour controls, the eyedropper, the bars (Dex, 2026-10-08)
  await page.bringToFront();
  await optTap(page, '#plus-btn'); await sleep(900);
  const px = () => page.evaluate(() => {           // the canvas's top-left pixel: the background
    const c = document.getElementById('pad'), d = c.getContext('2d').getImageData(4, 4, 1, 1).data;
    return `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
  });
  const dots = () => page.evaluate(() => ({ cs: getComputedStyle(document.getElementById('cs-dot')).backgroundColor,
    brush: getComputedStyle(document.getElementById('color-dot')).backgroundColor }));
  const slide = (id, v) => page.evaluate((id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input')); }, id, v);
  const bg0 = await px();
  note((await dots()).cs === bg0, `the canvas swatch ${(await dots()).cs} does not match the canvas ${bg0}`);
  await page.click('#canvas-swatch'); await sleep(300);
  const win = await page.evaluate(() => ({ open: document.getElementById('brush-pop').classList.contains('open'),
    inBars: document.getElementById('brush-pop').parentNode.id, tabs: !!document.getElementById('tab-brush'),
    rows: document.querySelectorAll('#brush-pop .hsb-row').length }));
  note(win.open && win.inBars === 'bottom-bars' && !win.tabs && win.rows === 3, `the canvas window: ${JSON.stringify(win)}`);
  await slide('cv-hue', 120); await slide('cv-sat', 80); await slide('cv-bri', 70);
  const bg1 = await px();
  note(bg1 !== bg0 && (await dots()).cs === bg1, `the canvas sliders: canvas ${bg0} -> ${bg1}, swatch ${(await dots()).cs}`);
  await page.click('#canvas-swatch'); await sleep(200);
  // THE BUG: after the canvas window, the brush sliders painted the canvas.
  await page.click('#color-btn'); await sleep(200);
  const brush0 = (await dots()).brush;
  await slide('hue', 270); await slide('sat', 90); await slide('bri', 90);
  const after = await dots();
  note(await px() === bg1 && after.cs === bg1 && after.brush !== brush0, `the brush sliders: canvas ${bg1} -> ${await px()}, brush ${brush0} -> ${after.brush}`);
  await page.click('#color-btn'); await sleep(200);
  // The eyedropper reads the pixel UNDER the finger, at any pixel ratio.
  await page.evaluate(() => { for (const [id, v] of [['hue', 0], ['sat', 100], ['bri', 100]]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input')); } });
  await stroke();
  await page.evaluate(() => { for (const [id, v] of [['hue', 200], ['sat', 50], ['bri', 50]]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input')); } });
  await page.click('#ed-btn'); await sleep(150);
  {
    const r = await page.evaluate(() => { const b = document.getElementById('pad').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
    await page.mouse.move(r.x + r.w * 0.1, r.y + r.h * 0.1); await page.mouse.down();
    await page.mouse.move(r.x + r.w * 0.5, r.y + r.h * 0.5, { steps: 6 }); await page.mouse.up();
    await sleep(300);
  }
  const picked = (await dots()).brush;
  note(picked === 'rgb(255, 0, 0)', `the eyedropper dragged onto a red stroke picked ${picked}`);
  // The toggle dead centre; the swatch right of it; the mirror far right; the lock top right.
  const bars = await page.evaluate(() => {
    const r = id => document.getElementById(id).getBoundingClientRect();
    const tb = r('toolbar'), t = r('tool-toggle'), title = r('title-input'), lock = r('top-lock');
    return { off: Math.abs((t.left + t.right) / 2 - (tb.left + tb.right) / 2),
             order: ['grid-btn', 'ed-btn', 'tool-toggle', 'color-btn', 'opt-btn'].map(id => [id, r(id).left]).sort((a, b) => a[1] - b[1]).map(x => x[0]).join(','),
             lockRight: lock.left > title.left && Math.abs(lock.top + lock.height / 2 - (title.top + title.height / 2)) < 8,
             install: !!document.getElementById('install-btn'),
             // The size bar is the toolbar's box, with undo, the scrub bar and redo on one centre line.
             sizeBar: (() => { const sb = r('size-bar'), u = r('undo-btn'), rd = r('redo-btn'), sl = r('size'), c = x => x.top + x.height / 2;
               return { h: sb.height, tbH: tb.height, skew: Math.max(Math.abs(c(u) - c(sl)), Math.abs(c(rd) - c(sl))), label: !!document.querySelector('#size-bar #size-v') }; })() };
  });
  note(bars.off < 2, `the draw/erase toggle is ${bars.off.toFixed(1)}px off the toolbar's centre`);
  note(bars.order === 'grid-btn,ed-btn,tool-toggle,color-btn,opt-btn', `the toolbar reads ${bars.order}`);
  note(Math.abs(bars.sizeBar.h - bars.sizeBar.tbH) < 0.5 && bars.sizeBar.skew < 1 && !bars.sizeBar.label, `the size bar: ${JSON.stringify(bars.sizeBar)}`);
  // A new canvas is SEEN to happen: the old one wiped away on a diagonal over the new one, then gone.
  {
    await page.evaluate(() => { window.__wipe = null; new MutationObserver((ms, o) => { const sn = document.querySelector('.pad-snap.go');
      if (sn){ window.__wipe = { mask: getComputedStyle(sn).maskImage || getComputedStyle(sn).webkitMaskImage, inFrame: sn.parentNode.id }; o.disconnect(); } })
      .observe(document.getElementById('canvas-frame'), { subtree: true, childList: true, attributes: true }); });
    await optTap(page, '#plus-btn'); await sleep(1400);
    const wipe = await page.evaluate(() => ({ seen: window.__wipe, left: document.querySelectorAll('.pad-snap').length }));
    note(wipe.seen && /135deg/.test(wipe.seen.mask) && wipe.seen.inFrame === 'canvas-frame' && wipe.left === 0,
      `the + wipe: ${JSON.stringify(wipe)}`);
  }
  // Back follows the way you came, two backs at most to leave (cold launch, so the trail is fresh).
  {
    await page.goto(`${BASE}/inko/`, { waitUntil: 'networkidle2' }); await sleep(600);
    const pad = await page.evaluate(() => { const b = document.getElementById('pad').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 20 }; });
    await page.mouse.click(pad.x, pad.y); await sleep(200);   // a first touch: Chrome skips entries pushed before one
    const where = () => page.evaluate(() => { const g = document.getElementById('gallery');
      return (g.classList.contains('open') ? (/mode-(\w+)/.exec(g.className) || [])[1] : 'canvas') + (history.state && history.state.inko ? '' : '|last'); });
    const steps = [];
    await page.goBack(); await sleep(300); steps.push(await where());                    // canvas -> your gallery, the last stop
    await page.evaluate(() => document.querySelector('#g-rows .g-item:not(.current) img, #g-rows .g-item:not(.current) .g-thumb').click()); await sleep(500);
    steps.push(await where());                                                           // a canvas opened from it
    await page.goBack(); await sleep(300); steps.push(await where());                    // back to the gallery, the last stop
    await page.click('#g-back'); await sleep(300); steps.push(await where());            // the arrow from there: the canvas
    await optTap(page, '#grid-btn'); await sleep(300); steps.push(await where());          // gallery from the canvas
    await page.goBack(); await sleep(300); steps.push(await where());                    // back to that canvas, the last stop
    note(steps.join(' ') === 'mine|last canvas mine|last canvas mine canvas|last', `back steps: ${steps.join(' ')}`);
  }
  // Batch 7: the canvas above every panel, the big tool centred, options, clear, the H/S/B tip, the symmetry tick.
  {
    const gapTo = async sel => page.evaluate(sel => { const c = document.getElementById('pad').getBoundingClientRect(), p = document.querySelector(sel).getBoundingClientRect(); return Math.round((p.top - c.bottom) * 10) / 10; }, sel);
    const gaps = { size: await gapTo('#size-bar') };
    await page.click('#color-btn'); await sleep(250); gaps.hsb = await gapTo('#hsb-bar');
    // The tip: a press on S names it, centred above the panel.
    const sr = await page.evaluate(() => { const b = document.getElementById('sat').getBoundingClientRect(); return { x: b.left + b.width * 0.3, y: b.top + b.height / 2 }; });
    await page.mouse.click(sr.x, sr.y); await sleep(150);
    const tip = await page.evaluate(() => { const t = document.querySelector('#hsb-bar .hsb-tip'), tr = t.getBoundingClientRect(), br = document.getElementById('hsb-bar').getBoundingClientRect();
      return { text: t.hidden ? '' : t.textContent, off: Math.abs((tr.left + tr.right) / 2 - (br.left + br.right) / 2), above: tr.bottom <= br.top }; });
    // Options closes the sliders and takes the size bar's place.
    await page.click('#opt-btn'); await sleep(250); gaps.opt = await gapTo('#opt-bar');
    const opt = await page.evaluate(() => ({ hsb: getComputedStyle(document.getElementById('hsb-bar')).display, size: getComputedStyle(document.getElementById('size-bar')).display,
      order: [...document.querySelectorAll('#opt-bar button')].map(b => b.id).join(','), h: document.getElementById('opt-bar').offsetHeight, tb: document.getElementById('toolbar').offsetHeight }));
    await page.click('#opt-btn'); await sleep(200);
    await page.click('#canvas-swatch'); await sleep(300); gaps.pop = await gapTo('#brush-pop');
    await page.click('#canvas-swatch'); await sleep(200);
    // A phone whose page is taller than what shows (the browser's own bar): main put the canvas 62px under the bars here.
    await page.evaluate(() => { const st = document.createElement('style'); st.id = 'tall'; st.textContent = 'html,body{height:calc(100dvh + 70px) !important}'; document.head.appendChild(st); dispatchEvent(new Event('resize')); });
    await sleep(300); gaps.tallPage = await gapTo('#size-bar');
    await page.evaluate(() => { document.getElementById('tall').remove(); dispatchEvent(new Event('resize')); }); await sleep(200);
    note(Object.values(gaps).every(g => Math.abs(g - 8) < 1.1), `the canvas sits 8px above each panel: ${JSON.stringify(gaps)}`);
    note(/^Saturation \d+%$/.test(tip.text) && tip.off < 1 && tip.above, `the S tip: ${JSON.stringify(tip)}`);
    note(opt.hsb === 'none' && opt.size === 'none' && opt.order === 'sym-btn,copt-btn,plus-btn,dl-btn,clear-btn' && Math.abs(opt.h - opt.tb) < 0.5, `the options bar: ${JSON.stringify(opt)}`);
    // The big tool icon dead centre, either way round.
    const centre = () => page.evaluate(() => { const t = document.getElementById('tool-toggle').getBoundingClientRect(), b = document.querySelector('#tool-toggle .tool-ico.big').getBoundingClientRect();
      return Math.max(Math.abs((b.left + b.right) / 2 - (t.left + t.right) / 2), Math.abs((b.top + b.bottom) / 2 - (t.top + t.bottom) / 2)); });
    const c1 = await centre(); await page.click('#tool-toggle'); await sleep(600); const c2 = await centre(); await page.click('#tool-toggle'); await sleep(600);
    note(c1 < 0.6 && c2 < 0.6, `the big tool icon is ${c1.toFixed(1)} / ${c2.toFixed(1)}px off the button's centre`);
    // Clear: asks; back is Cancel; Clear clears; undo brings it back.
    await page.evaluate(() => { for (const [id, v] of [['hue', 0], ['sat', 100], ['bri', 100]]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input')); } });
    await stroke();
    const inked = await ink();
    await optTap(page, '#clear-btn'); await sleep(200);
    const asked = await page.evaluate(() => ({ open: document.getElementById('modal').classList.contains('open'), title: document.getElementById('m-title').textContent, ok: document.getElementById('m-del').textContent,
      order: document.getElementById('m-cancel').getBoundingClientRect().left < document.getElementById('m-del').getBoundingClientRect().left }));
    await page.goBack(); await sleep(300);
    const cancelled = { open: await page.evaluate(() => document.getElementById('modal').classList.contains('open')), ink: await ink(), inko: await page.evaluate(() => location.pathname) };
    await optTap(page, '#clear-btn'); await sleep(200); await page.click('#m-del'); await sleep(300);
    const cleared = await ink();
    await page.click('#undo-btn'); await sleep(400);
    const back = await ink();
    note(inked > 50 && asked.open && asked.title === 'Clear this canvas?' && asked.ok === 'Clear' && asked.order && !cancelled.open && cancelled.ink === inked && cancelled.inko === '/inko/' && cleared === 0 && back === inked,
      `clear: ink ${inked}, asked ${JSON.stringify(asked)}, back-as-cancel ${JSON.stringify(cancelled)}, cleared ${cleared}, undo ${back}`);
    // Symmetry: a tick at the top centre, poking above the canvas, no line through it.
    // Symmetry lives in the options bar now (batch 13): switched on there, then the bar put away.
    await optTap(page, '#sym-btn'); await page.click('#opt-btn'); await sleep(300);
    const tick = await page.evaluate(() => { const t = document.getElementById('sym-tick'), tr = t.getBoundingClientRect(), fr = document.getElementById('canvas-frame').getBoundingClientRect();
      const c = document.getElementById('pad'), d = c.getContext('2d').getImageData(Math.floor(c.width / 2) - 1, Math.floor(c.height * 0.3), 3, 1).data;
      return { shown: !t.hidden && tr.height > 0, off: Math.abs((tr.left + tr.right) / 2 - (fr.left + fr.right) / 2), above: fr.top - tr.top, into: tr.bottom - fr.top, w: tr.width,
               line: [0, 4, 8].some(i => Math.abs(d[i] - d[i + 1]) < 30 && d[i] > 100 && d[i] < 160) }; });
    await optTap(page, '#sym-btn'); await page.click('#opt-btn'); await sleep(250);
    const gone = await page.evaluate(() => document.getElementById('sym-tick').hidden);
    note(tick.shown && tick.off < 1 && tick.above > 3 && tick.into > 5 && tick.into < 14 && tick.w <= 3 && !tick.line && gone, `the symmetry tick: ${JSON.stringify(tick)}, hidden again ${gone}`);
  }
  // Batch 8: the toast under the title, newest canvas bottom right, clear moving a canvas there, the swatch toggling, the canvas window from the options bar, download.
  {
    await optTap(page, '#plus-btn');
    // The toast follows the save of the canvas left behind, which can take a moment: wait for it, then measure.
    await page.waitForFunction(() => document.getElementById('toast').classList.contains('show'), { timeout: 3000 }).catch(() => {}); await sleep(150);
    const t = await page.evaluate(() => { const e = document.getElementById('toast'), r = e.getBoundingClientRect(), ti = document.getElementById('title-input').getBoundingClientRect();
      return { text: e.textContent, below: Math.round(r.top - ti.bottom), off: Math.abs((r.left + r.right) / 2 - innerWidth / 2), shown: e.classList.contains('show') }; });
    note(t.text === 'New canvas created' && t.shown && t.below >= 0 && t.below < 40 && t.off < 1, `the + toast: ${JSON.stringify(t)}`);
    const grid = async () => { await optTap(page, '#grid-btn'); await sleep(400);
      if (await page.evaluate(() => !/mode-mine/.test(document.getElementById('gallery').className))) { await page.click('#g-tab-public'); await sleep(400); }
      const g = await page.evaluate(() => { const rows = [...document.querySelectorAll('#g-rows .g-row')], last = rows[rows.length - 1], items = [...document.querySelectorAll('#g-rows .g-item')];
        return { n: items.length, lastRow: last ? last.children.length : 0, lastIsCurrent: !!items.length && items[items.length - 1].classList.contains('current'),
                 shortTop: rows.length && rows[0].children.length < 3 ? getComputedStyle(rows[0]).justifyContent : 'full' }; });
      return g; };
    const g1 = await grid();
    note(g1.n > 3 && g1.lastRow === 3 && g1.lastIsCurrent && (g1.shortTop === 'full' || g1.shortTop === 'flex-end'), `the gallery after +: newest bottom right ${JSON.stringify(g1)}`);
    // An OLD canvas, cleared, becomes the newest.
    await page.evaluate(() => document.querySelector('#g-rows .g-item:not(.current) img, #g-rows .g-item:not(.current) .g-thumb').click()); await sleep(600);
    await stroke();
    await optTap(page, '#clear-btn'); await sleep(200); await page.click('#m-del'); await sleep(700);
    const g2 = await grid();
    note(g2.n === g1.n && g2.lastRow === 3 && g2.lastIsCurrent, `a cleared old canvas moves to the bottom right: ${JSON.stringify(g2)}`);
    await page.click('#g-back'); await sleep(300);
    // The top-left swatch, tapped by a FINGER inside the edge guard, toggles.
    const sw = await page.evaluate(() => { const b = document.getElementById('canvas-swatch').getBoundingClientRect(); return { x: b.left + 6, y: b.top + b.height / 2 }; });
    const taps = [];
    for (let i = 0; i < 3; i++){ await page.touchscreen.tap(sw.x, sw.y); await sleep(250); taps.push(await page.evaluate(() => document.getElementById('brush-pop').classList.contains('open'))); }
    if (taps[2]) { await page.click('#canvas-swatch'); await sleep(200); }
    note(taps.join() === 'true,false,true', `three taps on the top-left swatch: ${taps.join()}`);
    // The canvas window from the options bar: colour, title and public, above the bar.
    await page.click('#opt-btn'); await sleep(200);
    await page.click('#copt-btn'); await sleep(300);
    const cw = await page.evaluate(() => { const p = document.getElementById('brush-pop').getBoundingClientRect(), o = document.getElementById('opt-bar').getBoundingClientRect(), c = document.getElementById('pad').getBoundingClientRect();
      return { open: document.getElementById('brush-pop').classList.contains('open'), more: !document.getElementById('cp-more').hidden, title: document.getElementById('cp-title').value === document.getElementById('title-input').value,
               lock: !!document.querySelector('#cp-lock svg'), aboveBar: document.getElementById('opt-bar').hidden && getComputedStyle(document.getElementById('size-bar')).display === 'none', gap: Math.round(p.top - c.bottom) }; });
    await page.click('#cp-title'); await page.evaluate(() => document.getElementById('cp-title').select()); await page.keyboard.type('Thumb title'); await sleep(150);
    const typed = await page.evaluate(() => document.getElementById('title-input').value);
    // The eyedropper closes it (batch 11), and brings the size bar back.
    await page.click('#ed-btn'); await sleep(250);
    const shut = await page.evaluate(() => !document.getElementById('brush-pop').classList.contains('open') && getComputedStyle(document.getElementById('size-bar')).display === 'flex');
    await page.click('#ed-btn'); await sleep(150);
    note(cw.open && cw.more && cw.title && cw.lock && cw.aboveBar && Math.abs(cw.gap - 8) < 1.1 && typed === 'Thumb title' && shut,
      `the canvas window from the options bar, closing that bar and the size bar (aboveBar): ${JSON.stringify(cw)}, title typed there reads "${typed}" up top, shut again ${shut}`);
    // Download: one PNG named after the canvas.
    await page.evaluate(() => { window.__dl = null; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function(){ if (this.download){ window.__dl = this.download; return; } return orig.call(this); }; });
    await optTap(page, '#dl-btn'); await sleep(250);
    // It asks first now (batch 12): Cancel on the left, a GREEN Download, and nothing saved until that.
    const dlAsk = await page.evaluate(() => { const m = document.getElementById('m-del'), c = document.getElementById('m-cancel');
      return { open: document.getElementById('modal').classList.contains('open'), title: document.getElementById('m-title').textContent, ok: m.textContent,
               bg: getComputedStyle(m).backgroundColor, left: c.getBoundingClientRect().left < m.getBoundingClientRect().left, early: window.__dl,
               named: document.getElementById('tool-name').textContent }; });
    await page.click('#m-del'); await sleep(400);
    const dl = await page.evaluate(() => window.__dl);
    note(dlAsk.open && dlAsk.title === 'Download this canvas?' && dlAsk.ok === 'Download' && dlAsk.bg === 'rgb(34, 180, 90)' && dlAsk.left && !dlAsk.early && dlAsk.named === 'Download',
      `download asks first, green: ${JSON.stringify(dlAsk)}`);
    note(dl === 'inko-thumb-title.png', `download named ${dl}`);
    await page.evaluate(() => { if (!document.getElementById('opt-bar').hidden) document.getElementById('opt-btn').click(); });
  }
  // Batch 9: picking a colour brings the brush back, undo/redo by the sliders, the tip that stays, the gallery bar, search, select mode, the low toast.
  {
    if (await page.evaluate(() => document.getElementById('gallery').classList.contains('open'))) { await page.click('#g-back'); await sleep(300); }
    await page.click('#tool-toggle'); await sleep(400);
    const eraser = await page.evaluate(() => document.getElementById('tool-toggle').getAttribute('aria-label'));
    await page.click('#color-btn'); await sleep(300);
    const hb = await page.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect(), mid = q => q.top + q.height / 2;
      const u = r('undo-btn'), d = r('redo-btn'), s = r('sat'), rows = document.querySelector('.hsb-rows').getBoundingClientRect();
      return { host: document.getElementById('undo-btn').parentNode.id + ',' + document.getElementById('redo-btn').parentNode.id,
               level: Math.max(Math.abs(mid(u) - mid(s)), Math.abs(mid(d) - mid(s))), redoLeft: d.right <= rows.left, undoRight: u.left >= rows.right, h: Math.round(s.height) }; });
    await page.evaluate(() => { const h = document.getElementById('hue'); h.value = 200; h.dispatchEvent(new Event('input', { bubbles: true })); });
    await sleep(500);
    const brushBack = await page.evaluate(() => document.getElementById('tool-toggle').getAttribute('aria-label'));
    note(eraser === 'Switch to brush' && brushBack === 'Switch to eraser', `a colour picked with the eraser on: ${eraser} -> ${brushBack}`);
    note(hb.host === 'hsb-bar,hsb-bar' && hb.level < 1.5 && hb.redoLeft && hb.undoRight && hb.h >= 36, `undo and redo beside the sliders, level with S, and taller sliders: ${JSON.stringify(hb)}`);
    const sat = await page.evaluate(() => { const b = document.getElementById('sat').getBoundingClientRect(); return { x: b.left + b.width * 0.4, y: b.top + b.height / 2 }; });
    await page.touchscreen.tap(sat.x, sat.y); await sleep(2600);
    const tipUp = await page.evaluate(() => !document.querySelector('#hsb-bar .hsb-tip').hidden);
    await sleep(1000);
    const tipGone = await page.evaluate(() => document.querySelector('#hsb-bar .hsb-tip').hidden);
    note(tipUp && tipGone, `the S tip still up at 2.6s ${tipUp}, gone by 3.6s ${tipGone}`);
    await page.click('#color-btn'); await sleep(300);
    const home = await page.evaluate(() => document.getElementById('undo-btn').parentNode.id + ',' + document.getElementById('redo-btn').parentNode.id + ',' + [...document.getElementById('size-bar').children].map(e => e.id || e.className).join('|'));
    note(home === 'size-bar,size-bar,redo-btn|ctl-size-perm|undo-btn', `undo and redo back in the size bar: ${home}`);

    // The gallery bar is the toolbar's pill; search lives on it.
    await optTap(page, '#grid-btn'); await sleep(400);
    if (await page.evaluate(() => !/mode-mine/.test(document.getElementById('gallery').className))) { await page.click('#g-tab-public'); await sleep(400); }
    const gb = await page.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect(), b = r('g-back'), s = r('g-search-btn'), p = r('g-tab-public'), m = r('g-tab-mine'), n = r('g-new');
      return { h: Math.round(r('g-bar').height), tb: Math.round(r('toolbar').height), order: b.right <= p.left && p.right <= n.left && n.right <= s.left && s.right <= m.left,
               page: document.getElementById('g-page').textContent, centred: Math.abs((n.left + n.right) / 2 - innerWidth / 2) < 1.5,
               topSearch: getComputedStyle(document.getElementById('g-find')).display }; });
    note(gb.h === gb.tb && gb.order && gb.centred && gb.page === 'Your gallery' && gb.topSearch === 'none', `the gallery bar (back, globe | + | search, you) and the page named: ${JSON.stringify(gb)}`);
    await page.click('#g-search-btn'); await sleep(250);
    await page.keyboard.type('thumb'); await sleep(700);
    const sr = await page.evaluate(() => ({ focus: document.activeElement.id, secs: [...document.querySelectorAll('#g-rows .g-sec')].map(e => e.textContent),
      cards: [...document.querySelectorAll('#g-rows .g-item .g-title')].map(e => e.textContent), above: document.getElementById('g-find').getBoundingClientRect().bottom <= document.getElementById('g-bar').getBoundingClientRect().top }));
    await page.click('.g-chip[data-kind="artists"]'); await sleep(700);
    const sr2 = await page.evaluate(() => ({ focus: document.activeElement.id, cards: document.querySelectorAll('#g-rows .g-item').length, empty: (document.querySelector('#g-rows .g-empty') || {}).textContent }));
    await page.click('.g-chip[data-kind="all"]'); await sleep(200);
    note(sr.focus === 'g-search' && sr.secs.includes('Your canvases') && sr.cards.includes('Thumb title') && sr.above && sr2.focus === 'g-search' && sr2.cards === 0,
      `searching "thumb": ${JSON.stringify(sr)}; on Artists ${JSON.stringify(sr2)}`);
    await page.click('#g-find-x'); await sleep(300);
    const closed = await page.evaluate(() => ({ searching: document.getElementById('gallery').classList.contains('searching'), mine: document.querySelectorAll('#g-rows .g-item').length }));
    note(!closed.searching && closed.mine > 3, `the search closed back to your gallery: ${JSON.stringify(closed)}`);

    // Hold a canvas: select mode, named by its title, the window top left.
    const centre = async i => page.evaluate(i => { const b = document.querySelectorAll('#g-rows .g-item')[i].querySelector('.g-thumb').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, i);
    const n0 = await page.evaluate(() => document.querySelectorAll('#g-rows .g-item').length);
    const last = n0 - 1, c1 = await centre(last - 2), c2 = await centre(last - 1), c3 = await centre(last);
    await page.touchscreen.touchStart(c1.x, c1.y); await sleep(650); await page.touchscreen.touchEnd(); await sleep(200);
    const s1 = await page.evaluate(() => { const items = [...document.querySelectorAll('#g-rows .g-item')], p = document.getElementById('g-sel').getBoundingClientRect();
      return { on: document.getElementById('gallery').classList.contains('selecting'), sel: items.filter(e => e.classList.contains('sel')).length,
               title: document.getElementById('g-sel-title').textContent, cardTitle: items[items.length - 3].querySelector('.g-title').textContent,
               left: Math.round(p.left), top: Math.round(p.top), cardButtons: getComputedStyle(items[0].querySelector('.g-opt')).display }; });
    note(s1.on && s1.sel === 1 && s1.title === s1.cardTitle && s1.left < 30 && s1.top < 200 && s1.cardButtons === 'none', `a hold enters select mode: ${JSON.stringify(s1)}`);
    await page.touchscreen.tap(c2.x, c2.y); await sleep(200);
    const t2 = await page.evaluate(() => document.getElementById('g-sel-title').textContent);
    await page.touchscreen.tap(c2.x, c2.y); await sleep(200);
    const t1 = await page.evaluate(() => document.getElementById('g-sel-title').textContent);
    note(t2 === '2 selected' && t1 === s1.title, `tap picks and a second tap drops: "${t2}" then "${t1}"`);
    // A sideways sweep from the first card over the next two.
    await page.touchscreen.touchStart(c1.x, c1.y);
    for (let k = 1; k <= 8; k++) { await page.touchscreen.touchMove(c1.x + (c3.x - c1.x) * k / 8, c1.y + 2); await sleep(30); }
    await page.touchscreen.touchEnd(); await sleep(250);
    const sw3 = await page.evaluate(() => ({ n: document.querySelectorAll('#g-rows .g-item.sel').length, title: document.getElementById('g-sel-title').textContent }));
    // A sweep from a picked card drops what it crosses: c1 was picked, so the sweep un-picks.
    note(sw3.n === 0 || sw3.n === 3, `a sideways sweep: ${JSON.stringify(sw3)}`);
    if (sw3.n === 0) { await page.touchscreen.touchStart(c1.x, c1.y);
      for (let k = 1; k <= 8; k++) { await page.touchscreen.touchMove(c1.x + (c3.x - c1.x) * k / 8, c1.y + 2); await sleep(30); }
      await page.touchscreen.touchEnd(); await sleep(250); }
    const sw4 = await page.evaluate(() => document.getElementById('g-sel-title').textContent);
    note(sw4 === '3 selected', `a sideways sweep over three cards: ${sw4} (first pass ${sw3.n})`);
    // The window moves by its top.
    const hd = await page.evaluate(() => { const b = document.getElementById('g-sel-title').getBoundingClientRect(), p = document.getElementById('g-sel').getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2, l: p.left, t: p.top }; });
    await page.mouse.move(hd.x, hd.y); await page.mouse.down(); await page.mouse.move(hd.x + 60, hd.y + 50, { steps: 6 }); await page.mouse.up(); await sleep(150);
    const moved = await page.evaluate(() => { const p = document.getElementById('g-sel').getBoundingClientRect(); return { l: p.left, t: p.top }; });
    note(Math.abs(moved.l - hd.l - 60) < 2 && Math.abs(moved.t - hd.t - 50) < 2, `the window dragged by its top: ${JSON.stringify(hd)} -> ${JSON.stringify(moved)}`);
    // Delete three: asks with the count, Cancel keeps them, Delete takes them and leaves nothing picked.
    await page.click('#sel-del'); await sleep(200);
    const ask = await page.evaluate(() => ({ title: document.getElementById('m-title').textContent, red: getComputedStyle(document.getElementById('m-del')).backgroundColor }));
    await page.click('#m-cancel'); await sleep(250);
    const kept = await page.evaluate(() => ({ n: document.querySelectorAll('#g-rows .g-item').length, sel: document.querySelectorAll('#g-rows .g-item.sel').length, cur: document.querySelectorAll('#g-rows .g-item.sel.current').length }));
    await page.click('#sel-del'); await sleep(200); await page.click('#m-del'); await sleep(900);
    const after = await page.evaluate(() => { const t = document.getElementById('toast').getBoundingClientRect();
      return { n: document.querySelectorAll('#g-rows .g-item').length, sel: document.querySelectorAll('#g-rows .g-item.sel').length,
               selecting: document.getElementById('gallery').classList.contains('selecting'), toast: document.getElementById('toast').textContent, toastH: Math.round(t.height) }; });
    note(ask.title === 'Delete 3 canvases?' && kept.n === n0 && kept.sel === 3 && after.n === n0 - 3 + kept.cur && after.sel === 0 && !after.selecting,
      `deleting three (the canvas on screen among them leaves a fresh one): asked "${ask.title}", cancel kept ${JSON.stringify(kept)}, then ${JSON.stringify(after)}`);
    // THE BUG: the toast over the gallery stretched from its old top to its new bottom.
    note(after.toast === '3 canvases deleted' && after.toastH < 60, `the toast over the gallery is one small box: "${after.toast}" ${after.toastH}px`);
    // The X ends select mode.
    const c4 = await centre(0);
    await page.touchscreen.touchStart(c4.x, c4.y); await sleep(650); await page.touchscreen.touchEnd(); await sleep(200);
    await page.click('#g-sel-x'); await sleep(200);
    const xd = await page.evaluate(() => ({ selecting: document.getElementById('gallery').classList.contains('selecting'), panel: getComputedStyle(document.getElementById('g-sel')).display }));
    note(!xd.selecting && xd.panel === 'none', `the X ends select mode: ${JSON.stringify(xd)}`);

    // Batch 10: one options button per card; its buttons fly out to their corners and fold back.
    const tile = i => page.evaluate(i => { const it = document.querySelectorAll('#g-rows .g-item')[i], t = it.querySelector('.g-thumb').getBoundingClientRect();
      const box = c => { const r = it.querySelector(c).getBoundingClientRect(), cs = getComputedStyle(it.querySelector(c));
        return { dl: Math.round(r.left - t.left), dt: Math.round(r.top - t.top), dr: Math.round(t.right - r.right), db: Math.round(t.bottom - r.bottom), op: +cs.opacity, pe: cs.pointerEvents }; };
      return { opt: box('.g-opt'), pub: box('.g-pub'), dl: box('.g-dl'), del: box('.g-del'), open: it.classList.contains('opts') }; }, i);
    const shut0 = await tile(0);
    note(shut0.opt.dl <= 6 && shut0.opt.dt <= 6 && shut0.opt.op === 1 && [shut0.pub, shut0.dl, shut0.del].every(x => x.op === 0 && x.pe === 'none' && x.dl <= 16 && x.dt <= 16)   /* scaled down in the corner */,
      `a card shows only its options button, tight top left: ${JSON.stringify(shut0)}`);
    const ob = await page.evaluate(() => { const r = document.querySelector('#g-rows .g-item .g-opt').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.touchscreen.tap(ob.x, ob.y); await sleep(80);
    const mid = await tile(0);
    await sleep(400);
    const out = await tile(0);
    const hitPub = await page.evaluate(() => { const b = document.querySelector('#g-rows .g-item .g-pub'), r = b.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.g-pub') === b; });
    note(out.open && out.pub.dr <= 6 && out.pub.dt <= 6 && out.dl.dr <= 6 && out.dl.db <= 6 && out.del.dl <= 6 && out.del.db <= 6 && [out.pub, out.dl, out.del].every(x => x.op === 1) && hitPub,
      `the buttons out at their corners (public top right, download bottom right, delete bottom left): ${JSON.stringify(out)}, public pressable ${hitPub}`);
    note(mid.pub.dl > shut0.pub.dl && mid.pub.dl < out.pub.dl, `they travel out of the corner rather than appearing: public at ${mid.pub.dl}px on the way from ${shut0.pub.dl} to ${out.pub.dl}`);
    // Another card's button folds this one; its own button again folds it.
    await page.evaluate(() => document.querySelectorAll('#g-rows .g-item')[1].querySelector('.g-opt').click()); await sleep(350);
    const one = await page.evaluate(() => [...document.querySelectorAll('#g-rows .g-item')].map(e => e.classList.contains('opts') ? 1 : 0).join(''));
    const ob1 = await page.evaluate(() => { const r = document.querySelectorAll('#g-rows .g-item')[1].querySelector('.g-opt').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.touchscreen.tap(ob1.x, ob1.y); await sleep(400);
    const back1 = await tile(1);
    note(one.startsWith('01') && !one.slice(2).includes('1') && !back1.open && back1.pub.op === 0 && back1.pub.dl <= 16, `one card open at a time (${one}), and its button folds it back: ${JSON.stringify(back1.pub)}`);
    // The page is named, and the square toggles globe <-> your gallery.
    await page.click('#g-tab-public'); await sleep(500);
    const pg = await page.evaluate(() => ({ page: document.getElementById('g-page').textContent, go: document.getElementById('g-tab-public').dataset.go }));
    await page.click('#g-tab-public'); await sleep(400);
    const pg2 = await page.evaluate(() => ({ page: document.getElementById('g-page').textContent, go: document.getElementById('g-tab-public').dataset.go }));
    note(pg.page === 'Public' && pg.go === 'mine' && pg2.page === 'Your gallery' && pg2.go === 'public', `the page named and the toggle: ${JSON.stringify(pg)} then ${JSON.stringify(pg2)}`);
    // + in the gallery: a new canvas, and straight into it.
    const nBefore = await page.evaluate(() => document.querySelectorAll('#g-rows .g-item').length);
    await page.evaluate(() => localStorage.removeItem('inko:newRate')); await page.click('#g-new'); await sleep(700);
    const nw = await page.evaluate(() => ({ gallery: document.getElementById('gallery').classList.contains('open'), toast: document.getElementById('toast').textContent, title: document.getElementById('title-input').value }));
    await optTap(page, '#grid-btn'); await sleep(400);
    const nAfter = await page.evaluate(() => { const items = [...document.querySelectorAll('#g-rows .g-item')]; return { n: items.length, lastCurrent: items[items.length - 1].classList.contains('current') }; });
    note(!nw.gallery && nw.toast === 'New canvas created' && /^Untitled( \d+)?$/.test(nw.title) && nAfter.n === nBefore + 1 && nAfter.lastCurrent,
      `+ from the gallery: ${JSON.stringify(nw)}, ${nBefore} -> ${JSON.stringify(nAfter)}`);
    // Batch 11: your picture, tapped in your own gallery, opens the profile bar (signed out: picture and sign in).
    await page.click('#g-tab-mine'); await sleep(250);
    const pf = await page.evaluate(() => { const g = document.getElementById('g-prof'), r = g.getBoundingClientRect(), bar = document.getElementById('g-bar').getBoundingClientRect();
      return { shown: !g.hidden, above: r.bottom <= bar.top, w: Math.round(r.width), bw: Math.round(bar.width),
               buttons: [...g.querySelectorAll('.pf-btn')].filter(b => !b.hidden).map(b => b.textContent.trim()).join(','), mode: /mode-mine/.test(document.getElementById('gallery').className) }; });
    await page.click('#pf-pic'); await sleep(250);
    const picking = await page.evaluate(() => ({ picking: !document.getElementById('g-pick').hidden, bar: document.getElementById('g-prof').hidden }));
    await page.click('#g-pick-cancel'); await sleep(150);
    note(pf.shown && pf.above && pf.w === pf.bw && pf.mode && pf.buttons === 'Picture,Sign in' && picking.picking && picking.bar,
      `the profile bar: ${JSON.stringify(pf)}, Picture then picking a canvas ${JSON.stringify(picking)}`);
    await page.click('#g-back'); await sleep(300);
    // The canvas window is THE panel: the toolbar's width, the sliders where the brush colour's are, nothing else up.
    await page.click('#color-btn'); await sleep(250);
    const brushSl = await page.evaluate(() => { const r = document.getElementById('sat').getBoundingClientRect(), b = document.getElementById('hsb-bar').getBoundingClientRect(); return { x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), barH: Math.round(b.height) }; });
    await page.click('#canvas-swatch'); await sleep(300);
    const cp = await page.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect(), s = r('cv-sat'), p = r('brush-pop'), t = r('toolbar'), u = r('undo-btn'), mid = q => q.top + q.height / 2;
      return { w: Math.round(p.width), tw: Math.round(t.width), x: Math.round(s.left), sw: Math.round(s.width), h: Math.round(s.height), barH: Math.round(p.height),
               hsb: getComputedStyle(document.getElementById('hsb-bar')).display, size: getComputedStyle(document.getElementById('size-bar')).display,
               colorOn: document.getElementById('color-btn').classList.contains('on'), undoHost: document.getElementById('undo-btn').parentNode.id, undoLevel: Math.abs(mid(u) - mid(s)) }; });
    note(cp.w === cp.tw && cp.x === brushSl.x && cp.sw === brushSl.w && cp.h === brushSl.h && cp.barH === brushSl.barH && cp.hsb === 'none' && cp.size === 'none' && !cp.colorOn && cp.undoHost === 'cp-sliders' && cp.undoLevel < 1.5,
      `the canvas window as the one panel, its sliders on the brush colour's: ${JSON.stringify(cp)} vs ${JSON.stringify(brushSl)}`);
    // The brush swatch takes it back; the brush/eraser toggle too, to the size bar.
    await page.click('#color-btn'); await sleep(250);
    const sw1 = await page.evaluate(() => ({ pop: document.getElementById('brush-pop').classList.contains('open'), hsb: getComputedStyle(document.getElementById('hsb-bar')).display }));
    await page.click('#color-btn'); await sleep(200);
    await page.click('#canvas-swatch'); await sleep(250);
    await page.click('#tool-toggle'); await sleep(450);
    const sw2 = await page.evaluate(() => ({ pop: document.getElementById('brush-pop').classList.contains('open'), size: getComputedStyle(document.getElementById('size-bar')).display }));
    await page.click('#tool-toggle'); await sleep(450);
    note(!sw1.pop && sw1.hsb === "flex" && !sw2.pop && sw2.size === "flex", `the swatch then the toggle close it: ${JSON.stringify(sw1)} ${JSON.stringify(sw2)}`);
    // Clear is a trash can.
    const trash = await page.evaluate(() => document.querySelectorAll('#clear-btn svg path').length >= 3 && !document.querySelector('#clear-btn svg line'));
    note(trash, `clear is drawn as a trash can: ${trash}`);
    // Batch 12: the default brush, the tool named under the title, a held control naming itself, and the + wipe's gap.
    {
      const fresh = await browser.newPage();
      await fresh.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await fresh.goto(`${BASE}/inko/`, { waitUntil: 'networkidle2' }); await sleep(600);
      const def = await fresh.evaluate(() => ({ h: +document.getElementById('hue').value, s: +document.getElementById('sat').value, b: +document.getElementById('bri').value,
        size: +document.getElementById('size').value, dot: getComputedStyle(document.getElementById('color-dot')).backgroundColor, name: document.getElementById('tool-name').textContent }));
      // 25 on the size slider is 30px (sliderToSize); hsb(200,100%,25%) is rgb(0, 43, 64).
      note(def.h === 200 && def.s === 100 && def.b === 25 && def.size === 25 && /rgb\(0, 4[23], 6[34]\)/.test(def.dot) && def.name === 'Brush',
        `the default brush on opening: ${JSON.stringify(def)}`);
      const named = () => fresh.evaluate(() => document.getElementById('tool-name').textContent);
      const walk = [];
      const tap = async sel => { await fresh.click(sel); await sleep(500); walk.push(await named()); };
      await tap('#tool-toggle'); await tap('#ed-btn'); await tap('#ed-btn'); await tap('#tool-toggle');
      // Symmetry is in the options bar (batch 13): on there, then named once the bar is put away.
      await tap('#opt-btn'); await tap('#sym-btn'); await tap('#opt-btn'); await tap('#color-btn'); await tap('#color-btn');
      await tap('#opt-btn'); await tap('#sym-btn'); await tap('#copt-btn'); await tap('#opt-btn'); await tap('#clear-btn'); await tap('#m-cancel'); await tap('#opt-btn');
      const under = await fresh.evaluate(() => { const t = document.getElementById('title-input').getBoundingClientRect(), n = document.getElementById('tool-name').getBoundingClientRect();
        return { below: Math.round(n.top - t.bottom), off: Math.abs((n.left + n.right) / 2 - (t.left + t.right) / 2) }; });
      note(walk.join() === 'Eraser,Eyedropper,Eraser,Brush,Canvas options,Canvas options,Symmetry,Color,Symmetry,Canvas options,Canvas options,Canvas color,Canvas options,Trash,Canvas options,Brush'
        && under.below >= -1 && under.below < 8 && under.off < 1.5, `the tool named under the title: ${walk.join()} ${JSON.stringify(under)}`);
      // A REAL touch hold names the control above the bar that is up, and is not a tap.
      const hold = async (sel, bar) => {
        const c = await fresh.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
        await fresh.touchscreen.touchStart(c.x, c.y); await sleep(700);
        const up = await fresh.evaluate(bar => { const t = document.getElementById('hold-tip'), r = t.getBoundingClientRect(), b = document.getElementById(bar).getBoundingClientRect();
          return { shown: !t.hidden, name: t.querySelector('b').textContent, what: t.querySelector('small').textContent, lines: t.children.length,
                   off: Math.abs((r.left + r.right) / 2 - (b.left + b.right) / 2), gap: Math.round(b.top - r.bottom) }; }, bar);
        await fresh.touchscreen.touchEnd(); await sleep(250);
        return up; };
      const h1 = await hold('#ed-btn', 'size-bar');
      const notTapped = await fresh.evaluate(() => !document.getElementById('ed-btn').classList.contains('on'));
      await sleep(2000);
      const gone = await fresh.evaluate(() => document.getElementById('hold-tip').hidden);
      await fresh.click('#opt-btn'); await sleep(300);
      const h2 = await hold('#dl-btn', 'opt-bar');
      const noAsk = await fresh.evaluate(() => !document.getElementById('modal').classList.contains('open'));
      // ...and a plain tap after a hold still works.
      await fresh.touchscreen.tap(...await fresh.evaluate(() => { const r = document.getElementById('dl-btn').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })); await sleep(300);
      const asked = await fresh.evaluate(() => document.getElementById('modal').classList.contains('open'));
      await fresh.click('#m-cancel'); await sleep(200);
      note(h1.shown && h1.name === 'Eyedropper' && h1.what === 'Pick a color' && h1.lines === 2 && h1.off < 1 && h1.gap === 8 && notTapped && gone
        && h2.shown && h2.name === 'Download' && h2.off < 1 && h2.gap === 8 && noAsk && asked,
        `held controls: ${JSON.stringify(h1)} not a tap ${notTapped}, gone later ${gone}; ${JSON.stringify(h2)} no dialog ${noAsk}, a tap after asks ${asked}`);
      // The + wipe, FROZEN mid-run: the new canvas written in at the top left, the old one still at the bottom
      // right, and a dark gap between -- both canvases the same colour, which is when it used to show nothing.
      await fresh.evaluate(() => { window.__freeze = null; new MutationObserver((ms, o) => { if (!document.getElementById('canvas-frame').classList.contains('go')) return; o.disconnect();
        for (const a of document.getAnimations()) if (a.animationName === 'padWipe'){ a.pause(); a.currentTime = 400; }
        window.__freeze = document.getAnimations().filter(a => a.animationName === 'padWipe').length; })
        .observe(document.getElementById('canvas-frame'), { attributes: true, attributeFilter: ['class'] }); });
      await fresh.click('#plus-btn'); await sleep(400);
      const shot = await fresh.evaluate(() => { const r = document.getElementById('canvas-frame').getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; });
      const png = await fresh.screenshot({ clip: shot, encoding: 'base64' });
      const sample = await fresh.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
        const at = f => { const d = x.getImageData(Math.round(img.width * f), Math.round(img.height * f), 1, 1).data; return d[0] + d[1] + d[2]; };
        return { tl: at(.08), mid: at(.5), br: at(.97), frozen: window.__freeze }; }, png);
      await fresh.evaluate(() => { for (const a of document.getAnimations()) a.finish(); }); await sleep(300);
      const after = await fresh.evaluate(() => ({ snaps: document.querySelectorAll('.pad-snap').length, swap: document.getElementById('canvas-frame').classList.contains('swap') }));
      note(sample.frozen === 2 && sample.tl > 200 && sample.br > 200 && Math.abs(sample.tl - sample.br) < 12 && sample.mid < 40 && after.snaps === 0 && !after.swap,
        `the + wipe's gap (r+g+b): ${JSON.stringify(sample)}, after ${JSON.stringify(after)}`);
      // Batch 13: the gallery one tap from the toolbar's left end, options at its right, symmetry first in the options bar.
      const bar13 = await fresh.evaluate(() => { const ids = [...document.querySelectorAll('#toolbar button.tbtn')].filter(b => !b.closest('#tool-toggle') || b.id === 'tool-toggle').map(b => b.id);
        return { tb: ids.join(), opt: [...document.querySelectorAll('#opt-bar > button')].map(b => b.id).join(), optHidden: document.getElementById('opt-bar').hidden }; });
      await fresh.click('#grid-btn'); await sleep(500);
      const galOpen = await fresh.evaluate(() => document.getElementById('gallery').classList.contains('open'));
      await fresh.click('#g-back'); await sleep(400);
      note(bar13.tb === 'grid-btn,ed-btn,tool-toggle,color-btn,opt-btn' && bar13.opt === 'sym-btn,copt-btn,plus-btn,dl-btn,clear-btn' && bar13.optHidden && galOpen,
        `the bars: ${JSON.stringify(bar13)}, one tap on the gallery opens it ${galOpen}`);
      // NEW CANVASES, LIMITED: eight straight through, the ninth told to wait 15s, then (the wait run out) one a minute.
      await fresh.evaluate(() => localStorage.removeItem('inko:newRate'));
      const count = () => fresh.evaluate(() => new Promise(res => { const r = indexedDB.open('inko'); r.onsuccess = () => { const t = r.result.transaction('canvases').objectStore('canvases').count(); t.onsuccess = () => res(t.result); }; }));
      const plus = async () => { await fresh.evaluate(() => { if (document.getElementById('opt-bar').hidden) document.getElementById('opt-btn').click(); });
        await fresh.click('#plus-btn'); await sleep(450); return fresh.evaluate(() => document.getElementById('toast').textContent); };
      const n0 = await count(), said = [];
      for (let i = 0; i < 9; i++) said.push(await plus());
      const n1 = await count();
      // The 15 seconds, run out on the stored clock rather than waited for: the eight are still inside the minute.
      await fresh.evaluate(() => { const s = JSON.parse(localStorage.getItem('inko:newRate')); s.until = Date.now() - 1; localStorage.setItem('inko:newRate', JSON.stringify(s)); });
      const tenth = await plus();
      await fresh.evaluate(() => { const s = JSON.parse(localStorage.getItem('inko:newRate')); s.until = 0; s.last = Date.now() - 61000; localStorage.setItem('inko:newRate', JSON.stringify(s)); });
      const minuteOn = await plus(), tooSoon = await plus();
      const n2 = await count();
      // A reload does not reset it.
      await fresh.reload({ waitUntil: 'networkidle2' }); await sleep(600);
      const afterReload = await plus();
      note(said.slice(0, 8).every(t => t === 'New canvas created') && /^Slow down a little.*in 15s$/.test(said[8]) && n1 === n0 + 8
        && /in 60s$/.test(tenth) && minuteOn === 'New canvas created' && /^Slow down a little.*in \d+s$/.test(tooSoon) && n2 === n0 + 9 && /^Slow down a little/.test(afterReload),
        `the new-canvas limit: ${said.join(' | ')} (${n0} -> ${n1}), then "${tenth}", a minute on "${minuteOn}", straight after "${tooSoon}" (${n2}), after a reload "${afterReload}"`);
      // Batch 13, the third notes: the canvas title as wide as the sliders, centred, 18px.
      await fresh.evaluate(() => { if (document.getElementById('opt-bar').hidden) document.getElementById('opt-btn').click(); }); await sleep(250); await fresh.click('#copt-btn'); await sleep(350);
      const ct = await fresh.evaluate(() => { const t = document.getElementById('cp-title'), r = t.getBoundingClientRect(), h = document.getElementById('cv-hue').getBoundingClientRect(), b = document.getElementById('cv-bri').getBoundingClientRect(), cs = getComputedStyle(t);
        const lock = document.getElementById('cp-lock').getBoundingClientRect(), undo = document.getElementById('undo-btn').getBoundingClientRect();
        return { dl: Math.abs(r.left - h.left), dw: Math.abs(r.width - h.width), bri: Math.abs(r.width - b.width), align: cs.textAlign, size: cs.fontSize,
                 lockOff: Math.abs((lock.left + lock.right) / 2 - (undo.left + undo.right) / 2), overlap: lock.left < r.right }; });
      await fresh.click('#opt-btn'); await sleep(250); await fresh.click('#opt-btn'); await sleep(200);   // the canvas window back to options, options away
      note(ct.dl < 1 && ct.dw < 1 && ct.bri < 1 && ct.align === 'center' && ct.size === '18px' && ct.lockOff < 1.5 && !ct.overlap, `the canvas title field: ${JSON.stringify(ct)}`);
      // The default face is the canvas grey, not yellow.
      const face = await fresh.evaluate(() => decodeURIComponent(getComputedStyle(document.getElementById('g-tab-mine')).backgroundImage));
      note(/536980/i.test(face) && !/ffd23f/i.test(face), `the default smiley: ${face.slice(0, 160)}`);
      // THE SEARCH PILL rides the keyboard. A fake keyboard: the visual viewport shrunk and grown by hand.
      await fresh.click('#grid-btn'); await sleep(400);
      if (await fresh.evaluate(() => !/mode-mine/.test(document.getElementById('gallery').className))) { await fresh.click('#g-tab-public'); await sleep(300); }
      await fresh.evaluate(() => { const vv = visualViewport; window.__kb = 0;
        Object.defineProperty(vv, 'height', { configurable: true, get: () => innerHeight - window.__kb });
        Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 });
        // Chrome (and so this harness) has the VirtualKeyboard API, which is the path a phone's Chrome takes: its box, announced.
        const vk = navigator.virtualKeyboard;
        if (vk) Object.defineProperty(vk, 'boundingRect', { configurable: true, get: () => new DOMRect(0, innerHeight - window.__kb, innerWidth, window.__kb) });
        window.__key = h => { window.__kb = h; vv.dispatchEvent(new Event('resize')); if (vk) vk.dispatchEvent(new Event('geometrychange')); }; });
      const pill = () => fresh.evaluate(() => ({ on: document.getElementById('gallery').classList.contains('searching'), bottom: parseFloat(document.getElementById('g-find').style.bottom),
        page: document.getElementById('g-page').textContent, focus: document.activeElement === document.getElementById('g-search') }));
      await fresh.click('#g-search-btn'); await sleep(120);
      const early = await pill();                       // tapped, no keyboard yet: still below the screen
      await fresh.evaluate(() => window.__key(320)); await sleep(60);
      const withKb = await pill();                      // the keyboard announced: up beside it
      await fresh.evaluate(() => window.__key(0)); await sleep(150);
      const dropped = await pill();                     // the keyboard dropped with the caret still in the field: that was back
      // Enter keeps it: the pill rests above the bar.
      await fresh.click('#g-search-btn'); await sleep(100); await fresh.evaluate(() => window.__key(320)); await sleep(60);
      await fresh.type('#g-search', 'zz'); await fresh.keyboard.press('Enter'); await fresh.evaluate(() => window.__key(0)); await sleep(150);
      const entered = await pill();
      // And the back gesture closes it, leaving you on the page you searched from.
      await fresh.goBack(); await sleep(400);
      const backed = await fresh.evaluate(() => ({ on: document.getElementById('gallery').classList.contains('searching'), gallery: document.getElementById('gallery').classList.contains('open'), page: document.getElementById('g-page').textContent }));
      note(early.on && early.bottom < 0 && withKb.bottom === 328 && withKb.focus && !dropped.on && dropped.page === 'Your gallery' && entered.on && entered.bottom > 0 && entered.bottom < 200
        && !backed.on && backed.gallery && backed.page === 'Your gallery',
        `the search pill: tapped ${JSON.stringify(early)}, keyboard up ${JSON.stringify(withKb)}, keyboard dropped ${JSON.stringify(dropped)}, after Enter ${JSON.stringify(entered)}, back ${JSON.stringify(backed)}`);
      await fresh.close();
    }
  }
  note(bars.lockRight && !bars.install, `the top row: lock at the right ${bars.lockRight}, install button ${bars.install}`);
  console.log(`colours: canvas ${bg0} -> ${bg1} from its own window, brush sliders left it alone, eyedropper picked ${picked}; toggle ${bars.off.toFixed(1)}px off centre`);

  // ---- 7. one service worker, and an offline launch -----------------------
  const sw = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    await navigator.serviceWorker.ready;
    return { n: regs.length, scope: regs[0] && new URL(regs[0].scope).pathname };
  });
  note(sw.n === 1 && sw.scope === '/inko/', `service workers: ${sw.n}, scope ${sw.scope}`);
  offline = true;
  await page.setOfflineMode(true);
  const offlineOk = await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 })
    .then(() => page.waitForFunction(() => !!document.getElementById('pad') && document.getElementById('pad').width > 0, { timeout: 10000 }))
    .then(() => true).catch(() => false);
  note(offlineOk, 'the app did not open offline from the service worker cache');
  await page.setOfflineMode(false);
  offline = false;

  // ---- 8. the overlay: no install button, no service worker of its own ----
  const embed = await browser.newPage();
  await embed.goto(`${BASE}/inko/?embed=1`, { waitUntil: 'networkidle2' });
  // The in-app Install button is GONE everywhere (Dex, 2026-10-08): installing
  // is offered from the site's card, through /inko/?install=1.
  const e = await embed.evaluate(() => ({ install: !!document.getElementById('install-btn'),
    embed: document.body.classList.contains('embed') }));
  note(e.embed && !e.install, `in the overlay: embed class ${e.embed}, install button present ${e.install}`);
  await embed.close();

  const relevant = errors.filter(m => !/ERR_INTERNET_DISCONNECTED|net::ERR|Failed to load resource/.test(m));
  note(relevant.length === 0, `console/page errors: ${relevant.join(' | ')}`);
} finally {
  await browser.close();
  server.close();
}
console.log(`\ninko_check: ${pass} checks passed${fail.length ? `, ${fail.length} FAILED` : ''}`);
for (const f of fail) console.log(`  - ${f}`);
process.exit(fail.length ? 1 : 0);
