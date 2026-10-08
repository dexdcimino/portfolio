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
const optTap = async (p, sel) => { await p.evaluate(() => { if (document.getElementById('opt-bar').hidden) document.getElementById('opt-btn').click(); }); return p.click(sel); };
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
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 80 && d[i + 2] < 80) n++;
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
  note(afterPlus.count === 24 && afterPlus.title === 'Untitled 1', `+ left ${afterPlus.count} drawings, wanted 24 — and more than 20 is the point; the new one is "${afterPlus.title}"`);
  await page.evaluate(() => { const h = document.getElementById('hue'); h.value = 0; h.dispatchEvent(new Event('input')); });
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
  note(blank.count === 26 && blank.title === 'Untitled 2', `a + on a blank canvas left ${blank.count} drawings titled "${blank.title}", wanted 26 and Untitled 2 (1 was renamed, so it is reused)`);

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
    title: document.getElementById('bp-title').textContent, tabs: !!document.getElementById('tab-brush'),
    rows: document.querySelectorAll('#brush-pop .hsb-row').length }));
  note(win.open && win.title === 'Canvas color' && !win.tabs && win.rows === 3, `the canvas window: ${JSON.stringify(win)}`);
  await slide('cv-hue', 120); await slide('cv-sat', 80); await slide('cv-bri', 70);
  const bg1 = await px();
  note(bg1 !== bg0 && (await dots()).cs === bg1, `the canvas sliders: canvas ${bg0} -> ${bg1}, swatch ${(await dots()).cs}`);
  await page.click('#pop-x'); await sleep(200);
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
             order: ['opt-btn', 'ed-btn', 'tool-toggle', 'color-btn', 'sym-btn'].map(id => [id, r(id).left]).sort((a, b) => a[1] - b[1]).map(x => x[0]).join(','),
             lockRight: lock.left > title.left && Math.abs(lock.top + lock.height / 2 - (title.top + title.height / 2)) < 8,
             install: !!document.getElementById('install-btn'),
             // The size bar is the toolbar's box, with undo, the scrub bar and redo on one centre line.
             sizeBar: (() => { const sb = r('size-bar'), u = r('undo-btn'), rd = r('redo-btn'), sl = r('size'), c = x => x.top + x.height / 2;
               return { h: sb.height, tbH: tb.height, skew: Math.max(Math.abs(c(u) - c(sl)), Math.abs(c(rd) - c(sl))), label: !!document.querySelector('#size-bar #size-v') }; })() };
  });
  note(bars.off < 2, `the draw/erase toggle is ${bars.off.toFixed(1)}px off the toolbar's centre`);
  note(bars.order === 'opt-btn,ed-btn,tool-toggle,color-btn,sym-btn', `the toolbar reads ${bars.order}`);
  note(Math.abs(bars.sizeBar.h - bars.sizeBar.tbH) < 0.5 && bars.sizeBar.skew < 1 && !bars.sizeBar.label, `the size bar: ${JSON.stringify(bars.sizeBar)}`);
  // A new canvas is SEEN to happen: the old one wiped away on a diagonal over the new one, then gone.
  {
    await page.evaluate(() => { window.__wipe = null; new MutationObserver((ms, o) => { const sn = document.querySelector('.pad-snap.go');
      if (sn){ window.__wipe = { mask: getComputedStyle(sn).maskImage || getComputedStyle(sn).webkitMaskImage, inFrame: sn.parentNode.id }; o.disconnect(); } })
      .observe(document.getElementById('canvas-frame'), { subtree: true, childList: true, attributes: true }); });
    await optTap(page, '#plus-btn'); await sleep(900);
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
    await page.click('#pop-x'); await sleep(200);
    // A phone whose page is taller than what shows (the browser's own bar): main put the canvas 62px under the bars here.
    await page.evaluate(() => { const st = document.createElement('style'); st.id = 'tall'; st.textContent = 'html,body{height:calc(100dvh + 70px) !important}'; document.head.appendChild(st); dispatchEvent(new Event('resize')); });
    await sleep(300); gaps.tallPage = await gapTo('#size-bar');
    await page.evaluate(() => { document.getElementById('tall').remove(); dispatchEvent(new Event('resize')); }); await sleep(200);
    note(Object.values(gaps).every(g => Math.abs(g - 8) < 1.1), `the canvas sits 8px above each panel: ${JSON.stringify(gaps)}`);
    note(/^Saturation \d+%$/.test(tip.text) && tip.off < 1 && tip.above, `the S tip: ${JSON.stringify(tip)}`);
    note(opt.hsb === 'none' && opt.size === 'none' && opt.order === 'grid-btn,copt-btn,plus-btn,dl-btn,clear-btn' && Math.abs(opt.h - opt.tb) < 0.5, `the options bar: ${JSON.stringify(opt)}`);
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
    await page.click('#sym-btn'); await sleep(200);
    const tick = await page.evaluate(() => { const t = document.getElementById('sym-tick'), tr = t.getBoundingClientRect(), fr = document.getElementById('canvas-frame').getBoundingClientRect();
      const c = document.getElementById('pad'), d = c.getContext('2d').getImageData(Math.floor(c.width / 2) - 1, Math.floor(c.height * 0.3), 3, 1).data;
      return { shown: !t.hidden && tr.height > 0, off: Math.abs((tr.left + tr.right) / 2 - (fr.left + fr.right) / 2), above: fr.top - tr.top, into: tr.bottom - fr.top, w: tr.width,
               line: [0, 4, 8].some(i => Math.abs(d[i] - d[i + 1]) < 30 && d[i] > 100 && d[i] < 160) }; });
    await page.click('#sym-btn'); await sleep(150);
    const gone = await page.evaluate(() => document.getElementById('sym-tick').hidden);
    note(tick.shown && tick.off < 1 && tick.above > 3 && tick.into > 5 && tick.into < 14 && tick.w <= 3 && !tick.line && gone, `the symmetry tick: ${JSON.stringify(tick)}, hidden again ${gone}`);
  }
  // Batch 8: the toast under the title, newest canvas bottom right, clear moving a canvas there, the swatch toggling, the canvas window from the options bar, download.
  {
    await optTap(page, '#plus-btn'); await sleep(250);
    const t = await page.evaluate(() => { const e = document.getElementById('toast'), r = e.getBoundingClientRect(), ti = document.getElementById('title-input').getBoundingClientRect();
      return { text: e.textContent, below: Math.round(r.top - ti.bottom), off: Math.abs((r.left + r.right) / 2 - innerWidth / 2), shown: e.classList.contains('show') }; });
    note(t.text === 'New canvas created' && t.shown && t.below >= 0 && t.below < 30 && t.off < 1, `the + toast: ${JSON.stringify(t)}`);
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
    if (taps[2]) { await page.click('#pop-x'); await sleep(200); }
    note(taps.join() === 'true,false,true', `three taps on the top-left swatch: ${taps.join()}`);
    // The canvas window from the options bar: colour, title and public, above the bar.
    await page.click('#opt-btn'); await sleep(200);
    await page.click('#copt-btn'); await sleep(300);
    const cw = await page.evaluate(() => { const p = document.getElementById('brush-pop').getBoundingClientRect(), o = document.getElementById('opt-bar').getBoundingClientRect(), c = document.getElementById('pad').getBoundingClientRect();
      return { open: document.getElementById('brush-pop').classList.contains('open'), more: !document.getElementById('cp-more').hidden, title: document.getElementById('cp-title').value === document.getElementById('title-input').value,
               lock: !!document.querySelector('#cp-lock svg'), aboveBar: p.bottom <= o.top, gap: Math.round(p.top - c.bottom) }; });
    await page.click('#cp-title'); await page.evaluate(() => document.getElementById('cp-title').select()); await page.keyboard.type('Thumb title'); await sleep(150);
    const typed = await page.evaluate(() => document.getElementById('title-input').value);
    await page.click('#copt-btn'); await sleep(250);
    const shut = await page.evaluate(() => !document.getElementById('brush-pop').classList.contains('open'));
    note(cw.open && cw.more && cw.title && cw.lock && cw.aboveBar && Math.abs(cw.gap - 8) < 1.1 && typed === 'Thumb title' && shut,
      `the canvas window from the options bar: ${JSON.stringify(cw)}, title typed there reads "${typed}" up top, shut again ${shut}`);
    // Download: one PNG named after the canvas.
    await page.evaluate(() => { window.__dl = null; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function(){ if (this.download){ window.__dl = this.download; return; } return orig.call(this); }; });
    await optTap(page, '#dl-btn'); await sleep(400);
    const dl = await page.evaluate(() => window.__dl);
    note(dl === 'inko-thumb-title.png', `download named ${dl}`);
    await page.evaluate(() => { if (!document.getElementById('opt-bar').hidden) document.getElementById('opt-btn').click(); });
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
