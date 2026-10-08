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
  await page.click('#plus-btn'); await sleep(800);
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
  await page.click('#plus-btn'); await sleep(800);
  const saved = await state();
  note(saved.count === 25, `+ after the sketch left ${saved.count} drawings, wanted 25`);
  await page.click('#plus-btn'); await sleep(800);
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
    await page.click('#grid-btn'); await sleep(400);
    const n = await page.evaluate(() => document.querySelectorAll('#g-rows .g-item').length);
    await page.click('#g-back'); await sleep(200);
    return n;
  };
  await page.click('#plus-btn'); await sleep(800);
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
  await page.click('#plus-btn'); await sleep(1200);
  await stroke();                                          // a different canvas
  await page.click('#grid-btn'); await sleep(400);
  await page.evaluate(() => [...document.querySelectorAll('#g-rows .g-item')].find(el => el.textContent.includes('Kept history')).click());
  await sleep(1200);
  const reopened = await undoDepth();
  note(reopened === 19, `reopening a canvas brought back ${reopened} undos, wanted 19`);
  const kept = await db();
  note(kept.hists.length >= 1, `no canvas kept its undo history (kept: ${kept.hists.length})`);
  // Deleting it takes its history with it.
  await page.click('#grid-btn'); await sleep(400);
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
  await page.click('#grid-btn'); await sleep(300);
  await page.click('#g-account'); await sleep(300);
  await page.click('#a-signout'); await sleep(1500);
  await page.click('#g-back'); await sleep(200);
  note(await galleryCount() === 1, 'signed out, the account\'s canvases still show (wanted only the fresh blank one)');
  await stroke();
  await page.type('#title-input', 'Made signed out');
  await page.click('#plus-btn'); await sleep(1200);
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
  await page.click('#plus-btn'); await sleep(900);
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
             order: ['plus-btn', 'grid-btn', 'ed-btn', 'tool-toggle', 'color-btn', 'sym-btn'].map(id => [id, r(id).left]).sort((a, b) => a[1] - b[1]).map(x => x[0]).join(','),
             lockRight: lock.left > title.left && Math.abs(lock.top + lock.height / 2 - (title.top + title.height / 2)) < 8,
             install: !!document.getElementById('install-btn') };
  });
  note(bars.off < 2, `the draw/erase toggle is ${bars.off.toFixed(1)}px off the toolbar's centre`);
  note(bars.order === 'plus-btn,grid-btn,ed-btn,tool-toggle,color-btn,sym-btn', `the toolbar reads ${bars.order}`);
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
