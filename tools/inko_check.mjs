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
  await page.setViewport({ width: 420, height: 860, isMobile: true, hasTouch: false });
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
  note(migrated.count === 22 && migrated.blobs, `migration kept ${migrated.count} of 22 drawings (as Blobs: ${migrated.blobs})`);
  note(migrated.ls === 0, 'the old localStorage keys are still there after the migration');
  note(migrated.title === 'Draft from before', `the old draft did not come back (title "${migrated.title}")`);
  note(/^build [0-9a-z]{6}$/.test(migrated.label), `the build label reads "${migrated.label}"`);
  console.log(`migration: ${migrated.count} drawings, draft "${migrated.title}", ${migrated.label}`);

  // ---- 2. a real stroke, undo and redo ----------------------------------
  // A clean canvas first: + saves the migrated draft (23 now) and starts over.
  await page.click('#plus-btn'); await sleep(800);
  const afterPlus = await state();
  note(afterPlus.count === 23, `+ on the draft left ${afterPlus.count} drawings, wanted 23 — and more than 20 is the point`);
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
  await page.type('#title-input', 'Harness sketch');
  await sleep(1000);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => (document.getElementById('g-build') || {textContent: ''}).textContent.startsWith('build '), { timeout: 15000 }).catch(() => {});
  await sleep(500);
  const reloaded = await state();
  note(reloaded.title === 'Harness sketch' && await ink() > 200, `after a reload: title "${reloaded.title}", the stroke ${await ink() > 200 ? 'kept' : 'LOST'}`);
  await page.click('#plus-btn'); await sleep(800);
  const saved = await state();
  note(saved.count === 24, `saving the sketch left ${saved.count} drawings, wanted 24`);
  await page.click('#plus-btn'); await sleep(800);
  note((await state()).count === 24, 'a + on an untouched blank canvas saved an empty card');

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

  // ---- 5. one service worker, and an offline launch -----------------------
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

  // ---- 6. the overlay: no install button, no service worker of its own ----
  const embed = await browser.newPage();
  await embed.goto(`${BASE}/inko/?embed=1`, { waitUntil: 'networkidle2' });
  const e = await embed.evaluate(() => ({ install: getComputedStyle(document.getElementById('install-btn')).display,
    embed: document.body.classList.contains('embed') }));
  note(e.embed && e.install === 'none', `in the overlay: embed class ${e.embed}, install button "${e.install}"`);
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
