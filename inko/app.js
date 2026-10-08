(()=>{ "use strict";
/* Inko rebuild — clean separation, MindSplit-style architecture.
   Embed mode: ?embed=1 renders full-bleed for the portfolio overlay. */
const EMBED = new URLSearchParams(location.search).has('embed');
if (EMBED) document.body.classList.add('embed');

/* ---------- updates: the deployed build, noticed on its own ----------
   WHY THIS REPLACED THE OLD SYSTEM. An installed web app on Android is not
   reloaded when you reopen it: it RESUMES, with yesterday's code still in
   memory. The old check only asked whether sw.js had changed -- which it did
   only when someone remembered to bump a version string in it -- so most
   edits never reached the phone until the OS happened to kill the app. That
   is the "works sometimes, reinstall to fix" the old Update Now button
   (clear every cache, unregister, hard reload) was a patch over.

   NOW THE BUILD IS READ OFF THE SERVER. Vercel sends an ETag with every file
   -- a fingerprint of its bytes -- so a HEAD request for the three files that
   make the app says exactly whether what is deployed is what is running.
   Nothing to bump, nothing to remember, and it works whoever pushed the edit.
   Checked on launch, every time the app comes back to the foreground, and
   every five minutes while it is open. A new build: the drawing is saved,
   and the app reloads itself. */
const BUILD_FILES = ['/inko/app.js', '/inko/app.css', '/inko/index.html'];
let runningBuild = null;            // the signature this page loaded with
async function deployedBuild(){
  const tags = await Promise.all(BUILD_FILES.map(async url => {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (!r.ok) throw new Error(url + ' ' + r.status);
    return r.headers.get('etag') || r.headers.get('last-modified') || '';
  }));
  return tags.join('|');
}
function buildLabel(sig){
  // Short, stable, and the same on every device running the same build.
  let h = 0;
  for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(6, '0').slice(-6);
}
let reloading = false;
async function checkForUpdate(){
  if (reloading || !navigator.onLine) return;
  let now;
  try { now = await deployedBuild(); } catch (e) { return; }   // offline, or a deploy mid-flight
  if (!runningBuild){
    runningBuild = now;
    const el = $('g-build'); if (el) el.textContent = 'build ' + buildLabel(now);
    return;
  }
  if (now === runningBuild) return;
  // Never under a finger: a stroke in progress finishes first.
  if (drawing){ setTimeout(checkForUpdate, 1500); return; }
  reloading = true;
  try { await flushDraft(); } catch (e) {}
  try { sessionStorage.setItem('inkoUpdated', buildLabel(now)); } catch (e) {}
  location.reload();
}
if ('serviceWorker' in navigator && !EMBED){
  // One registration, here. updateViaCache 'none': the browser always asks the
  // server for sw.js rather than trusting its own HTTP cache of it.
  navigator.serviceWorker.register('/inko/sw.js', { scope: '/inko/', updateViaCache: 'none' }).catch(() => {});
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
window.addEventListener('focus', checkForUpdate);
window.addEventListener('online', checkForUpdate);
setInterval(() => { if (!document.hidden) checkForUpdate(); }, 5 * 60 * 1000);

/* ---------- storage: IndexedDB ----------
   The gallery used to be every drawing as PNG text in localStorage: about
   5 MB on a phone, so a handful of real drawings filled it, and a hard cap
   of 20 that silently DELETED the oldest one on every save past it. Both are
   gone. Drawings are Blobs in IndexedDB, with no cap, and the browser is
   asked not to evict them. Each record carries an id, timestamps and a
   visibility, so syncing to a server later is a matter of uploading records,
   not of reshaping them.

   Version 2 adds 'steps': one undo snapshot per record, written ONCE when
   its stroke ends. The draft and each canvas's kept history name their
   steps by id, so saving the undo stack costs nothing per save -- the blobs
   are already on disk. Steps nothing names any more are swept by gcSteps. */
const DB_NAME = 'inko', DB_VERSION = 2;
let dbp = null;
function db(){
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('canvases')) d.createObjectStore('canvases', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('steps')) d.createObjectStore('steps', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function tx(store, mode, fn){
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  });
}
const idbAll = store => tx(store, 'readonly', s => s.getAll());
const idbGet = (store, key) => tx(store, 'readonly', s => s.get(key));
const idbPut = (store, value) => tx(store, 'readwrite', s => s.put(value));
const idbDel = (store, key) => tx(store, 'readwrite', s => s.delete(key));
const canvasBlob = (c, type = 'image/png', q) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), type, q));
const dataUrlBlob = url => fetch(url).then(r => r.blob());

/* The old localStorage gallery and draft, moved across ONCE and only deleted
   after every record is safely written. */
async function migrateLocalStorage(){
  const done = await idbGet('meta', 'migratedLS').catch(() => null);
  if (done) return;
  let old = [], draft = null;
  try { old = JSON.parse(localStorage.getItem('sketchGalleryV1') || '[]') || []; } catch (e) {}
  try { draft = JSON.parse(localStorage.getItem('sketchDraftV1') || 'null'); } catch (e) {}
  for (const it of old){
    const src = it.strokes || it.data;
    if (!src) continue;
    await idbPut('canvases', {
      id: it.id || ('c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      title: it.title || 'Untitled', bg: it.bg || { h: 0, s: 0, b: 100 },
      png: await dataUrlBlob(src), created: it.ts || Date.now(), ts: it.ts || Date.now(),
      visibility: 'private',
    });
  }
  if (draft && draft.strokes){
    await idbPut('meta', { key: 'draft', title: draft.title || '', bg: draft.bg, png: await dataUrlBlob(draft.strokes), editingId: null, ts: Date.now() });
  }
  await idbPut('meta', { key: 'migratedLS', at: Date.now(), count: old.length });
  try { localStorage.removeItem('sketchGalleryV1'); localStorage.removeItem('sketchDraftV1'); } catch (e) {}
}

/* ---------- constants & state ---------- */
const W = 880, H = 1170, DPR = Math.min(window.devicePixelRatio || 1, 2);
let hue = 4, sat = 100, bri = 100;
let brushSize = 45, eraserSize = null;
let bgH = 210, bgS = 35, bgB = 50;
let tool = 'brush', mirrorOn = false, popMode = null;
let history = [], step = -1, dirty = false, editingId = null;
let gallery = [];                   // the canvases of the scope on screen

/* ---------- whose canvases ----------
   Each account has its OWN canvases on this device (Dex, 2026-10-08):
   signed out is 'local', and every account -- Google, Discord, or a name and
   password, each its own handle -- is 'u:<handle>'. A canvas record carries
   its owner, and a record with none is local (every record from before
   this). The gallery, the draft and the undo stack all belong to the scope
   on screen, and signing in or out swaps all three.

   THE FIRST TIME an account signs in on this device, the signed-out canvases
   and the drawing on screen move INTO it and stop showing signed out. After
   that, signing out shows only what was made signed out since.

   SIGNED IN, the account's canvases are also kept on the server, so the
   same gallery is on every device the account signs in on (see "the
   account's canvases, everywhere"). Signed out, nothing leaves the device. */
let scope = 'local';
const scopeOf = s => (s && s.handle ? 'u:' + s.handle : 'local');
const ownerOf = it => it.owner || 'local';
const draftKey = sc => (sc === 'local' ? 'draft' : 'draft:' + sc);

/* ---------- dom ---------- */
const $ = id => document.getElementById(id);
const canvas = $('pad'), ctx = canvas.getContext('2d');
const sLayer = document.createElement('canvas'); const sctx = sLayer.getContext('2d');
const titleInput = $('title-input');
const brushPop = $('brush-pop'), toastEl = $('toast');

/* ---------- color ---------- */
function hsbToCss(h, s, b, a){
  s/=100; b/=100;
  const k = n => (n + h/60) % 6;
  const f = n => b - b*s*Math.max(0, Math.min(k(n), 4-k(n), 1));
  const r = Math.round(f(5)*255), g = Math.round(f(3)*255), bl = Math.round(f(1)*255);
  return a===undefined ? `rgb(${r},${g},${bl})` : `rgba(${r},${g},${bl},${a})`;
}
const brushCss = () => hsbToCss(hue, sat, bri, 1);
const bgCss = () => hsbToCss(bgH, bgS, bgB, 1);

/* ---------- canvas setup ---------- */
function setupCanvas(){
  canvas.width = W*DPR; canvas.height = H*DPR;
  sLayer.width = W*DPR; sLayer.height = H*DPR;
  ctx.setTransform(DPR,0,0,DPR,0,0);
  sctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.lineCap = ctx.lineJoin = 'round';
  sctx.lineCap = sctx.lineJoin = 'round';
  fit();
}
let fitK = 1;
function fit(){
  const topbar = $('topbar').offsetHeight;
  const bottomBars = $('bottom-bars') ? $('bottom-bars').offsetHeight : 140;
  const availW = Math.min(window.innerWidth*0.94, 460);
  const availH = window.innerHeight - topbar - bottomBars - 24;
  const k = Math.max(0.2, Math.min(availW/W, availH/H));
  fitK = k;
  canvas.style.width = (W*k)+'px'; canvas.style.height = (H*k)+'px';
}
function render(){
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = bgCss(); ctx.fillRect(0,0,W,H);
  ctx.drawImage(sLayer, 0,0,W,H);
  if (mirrorOn){
    ctx.save();
    ctx.strokeStyle = 'rgba(120,130,150,.4)'; ctx.lineWidth = 2;
    ctx.setLineDash([9,9]); ctx.beginPath();
    ctx.moveTo(W/2, 0); ctx.lineTo(W/2, H); ctx.stroke();
    ctx.restore();
  }
}
function clearCanvas(){
  sctx.clearRect(0,0,W,H);
  render(); pushHistory(); dirty = true; scheduleDraft();
}

/* ---------- drawing ---------- */
function pt(e){
  const r = canvas.getBoundingClientRect();
  return { x:(e.clientX-r.left)/r.width*W, y:(e.clientY-r.top)/r.height*H };
}
function activeSize(){ return tool==='eraser' ? eraserEff() : brushSize; }
function eraserEff(){ return eraserSize===null ? brushSize : eraserSize; }
function applyTool(){
  if (tool==='eraser'){
    sctx.globalCompositeOperation = 'destination-out';
    sctx.strokeStyle = sctx.fillStyle = 'rgba(0,0,0,1)';
    sctx.lineWidth = eraserEff();
  } else {
    sctx.globalCompositeOperation = 'source-over';
    sctx.strokeStyle = sctx.fillStyle = brushCss();
    sctx.lineWidth = brushSize;
  }
}
function dot(x,y){
  const r = activeSize()/2;
  sctx.beginPath(); sctx.arc(x,y,r,0,Math.PI*2); sctx.fill();
  if (mirrorOn){ sctx.beginPath(); sctx.arc(W-x,y,r,0,Math.PI*2); sctx.fill(); }
}
function seg(ax,ay,bx,by,cx,cy){
  sctx.beginPath(); sctx.moveTo(ax,ay); sctx.quadraticCurveTo(bx,by,cx,cy); sctx.stroke();
  if (mirrorOn){
    sctx.beginPath(); sctx.moveTo(W-ax,ay);
    sctx.quadraticCurveTo(W-bx,by,W-cx,cy); sctx.stroke();
  }
}
let drawing = false, last = null, midPrev = null;
canvas.addEventListener('pointerdown', e => {
  if (popMode){ closePop(); e.preventDefault(); return; }
  if (eyedropperOn){ startEyedrop(e); return; }
  e.preventDefault();
  try{ canvas.setPointerCapture(e.pointerId); }catch(err){}
  drawing = true;
  const p = pt(e); last = p; midPrev = p;
  applyTool(); dot(p.x, p.y); render();
});
canvas.addEventListener('pointermove', e => {
  if (!drawing) return;
  e.preventDefault();
  const p = pt(e); applyTool();
  const mid = { x:(last.x+p.x)/2, y:(last.y+p.y)/2 };
  seg(midPrev.x, midPrev.y, last.x, last.y, mid.x, mid.y);
  render(); midPrev = mid; last = p;
});
function endStroke(){
  if (!drawing) return;
  drawing = false;
  sctx.globalCompositeOperation = 'source-over';
  pushHistory(); dirty = true; scheduleDraft();
}
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);
canvas.addEventListener('contextmenu', e => e.preventDefault());

/* ---------- history ----------
   Each step is a PNG BLOB from toBlob, which encodes off the main thread,
   instead of toDataURL, which encoded ON it and then grew the result by a
   third as base64 -- a visible hitch at the end of every stroke on a phone.
   The same blob is the draft, so a stroke is encoded once, not twice.
   Pushes are chained so a fast run of strokes lands in order.

   KEPT, NOT ONLY HELD (Dex, 2026-10-08). The stack used to live in memory
   alone, so anything that reloaded the page -- Android reclaiming the app in
   the background, or a new build arriving when it came back -- returned with
   no undo at all. Each step is now written to the 'steps' store as its
   stroke ends, and the draft names the stack by id, so:
     - while the app is OPEN (a reload, an update, the OS killing it in the
       background) the whole stack comes back, up to HISTORY_MAX;
     - after the app was CLOSED, the last KEEP_STEPS come back, for KEEP_MS;
     - a canvas left for another keeps its last KEEP_STEPS, for the
       KEEP_CANVASES most recently left, for KEEP_MS; deleting the canvas
       deletes them.
   Open is told from closed by sessionStorage, which survives a reload and a
   background kill of the same window but not the window being closed. */
let historyChain = Promise.resolve();
let pendingPushes = 0;              // strokes whose snapshot is still encoding
const HISTORY_MAX = 50, KEEP_STEPS = 20, KEEP_CANVASES = 10, KEEP_MS = 24 * 60 * 60 * 1000;
const stepId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function pushHistory(){
  /* Undo is live the moment a stroke ends, not when its snapshot has
     finished encoding: the handler waits for the chain itself. Without this
     a quick tap right after drawing landed on a disabled button. */
  pendingPushes++;
  syncUndoRedo();
  historyChain = historyChain.then(async () => {
    const blob = await canvasBlob(sLayer);
    const id = stepId();
    // On disk before anything can name it.
    await idbPut('steps', { id, blob, ts: Date.now() }).catch(() => {});
    history = history.slice(0, step + 1);
    history.push({ id, blob });
    if (history.length > HISTORY_MAX) history.shift();
    step = history.length - 1;
    latestBlob = blob;
  }).catch(() => {}).then(() => { pendingPushes--; syncUndoRedo(); });
  return historyChain;
}
async function drawBlob(blob){
  const bmp = await createImageBitmap(blob);
  sctx.save();
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.globalCompositeOperation = 'source-over';
  sctx.clearRect(0, 0, sLayer.width, sLayer.height);
  sctx.drawImage(bmp, 0, 0, sLayer.width, sLayer.height);
  sctx.restore();
  bmp.close && bmp.close();
}
async function restoreStep(i){
  await historyChain;
  const blob = history[i] && history[i].blob;
  if (!blob) return;
  await drawBlob(blob);
  latestBlob = blob;
  render(); dirty = true; scheduleDraft();
}
function syncUndoRedo(){
  $('undo-btn').disabled = step <= 0 && !(pendingPushes > 0 && history.length > 0);
  $('redo-btn').disabled = pendingPushes > 0 || step >= history.length-1;
}
$('undo-btn').addEventListener('click', async () => {
  await historyChain;
  if (step > 0){ step--; syncUndoRedo(); restoreStep(step); }
});
$('redo-btn').addEventListener('click', async () => {
  await historyChain;
  if (step < history.length-1){ step++; syncUndoRedo(); restoreStep(step); }
});
/* The stack as ids, for a record to name; and a named stack read back, cut
   to `keep` steps around the current one. Null if any step is missing. */
const stackRecord = () => ({ steps: history.map(h => h.id), step });
function cutStack(ids, at, keep){
  if (!keep || ids.length <= keep) return { ids, at };
  const start = Math.max(0, Math.min(at, ids.length - keep));
  return { ids: ids.slice(start, start + keep), at: at - start };
}
async function loadStack(rec, keep){
  if (!rec || !Array.isArray(rec.steps) || !rec.steps.length) return null;
  const at0 = Math.max(0, Math.min(typeof rec.step === 'number' ? rec.step : rec.steps.length - 1, rec.steps.length - 1));
  const { ids, at } = cutStack(rec.steps, at0, keep);
  const out = [];
  for (const id of ids){
    const s = await idbGet('steps', id).catch(() => null);
    if (!s || !s.blob) return null;
    out.push({ id, blob: s.blob });
  }
  return { history: out, step: at };
}
function useStack(kept){
  history = kept.history; step = kept.step;
  latestBlob = history[step].blob;
  syncUndoRedo();
}
/* Leaving a saved canvas: its last KEEP_STEPS stay with it. */
async function keepCanvasHistory(){
  await historyChain;
  if (!editingId || history.length < 2) return;
  const it = gallery.find(g => g.id === editingId);
  if (!it) return;
  const r = stackRecord();
  const { ids, at } = cutStack(r.steps, r.step, KEEP_STEPS);
  await idbPut('meta', { key: 'hist:' + it.id, canvasTs: it.ts, steps: ids, step: at, ts: Date.now() }).catch(() => {});
}
/* Opening one: its kept steps, if they still describe it. */
async function keptCanvasHistory(it){
  const rec = await idbGet('meta', 'hist:' + it.id).catch(() => null);
  if (!rec || rec.canvasTs !== it.ts || Date.now() - rec.ts > KEEP_MS) return null;
  return loadStack(rec);
}
/* Kept histories past their day, past the most recent KEEP_CANVASES, or for
   a canvas that is gone, are dropped; then every step nothing names. Steps
   younger than a minute are left alone: one may be mid-push. */
async function gcSteps(){
  await historyChain;
  const now = Date.now();
  const metas = await idbAll('meta');
  const canvasIds = new Set(await tx('canvases', 'readonly', s => s.getAllKeys()));
  const hists = metas.filter(m => m.key.startsWith('hist:'));
  const keep = hists.filter(h => now - h.ts <= KEEP_MS && canvasIds.has(h.key.slice(5)))
    .sort((a, b) => b.ts - a.ts).slice(0, KEEP_CANVASES);
  for (const h of hists) if (!keep.includes(h)) await idbDel('meta', h.key);
  const named = new Set(history.map(h => h.id));
  const drafts = metas.filter(m => (m.key === 'draft' || m.key.startsWith('draft:')) && now - m.ts <= KEEP_MS);
  for (const m of [...keep, ...drafts]) (m.steps || []).forEach(id => named.add(id));
  const steps = await tx('steps', 'readonly', s => s.getAll());
  for (const st of steps) if (!named.has(st.id) && now - st.ts > 60 * 1000) await idbDel('steps', st.id);
}

/* ---------- saving ---------- */
let latestBlob = null;              // the strokes as of the last history step
async function strokesBlob(){
  await historyChain;
  return latestBlob || canvasBlob(sLayer);
}
async function thumbBlob(png, bg){
  const t = document.createElement('canvas'); t.width = 360; t.height = 480;
  const c = t.getContext('2d');
  c.fillStyle = hsbToCss(bg.h, bg.s, bg.b, 1); c.fillRect(0, 0, 360, 480);
  const bmp = await createImageBitmap(png);
  c.drawImage(bmp, 0, 0, 360, 480);
  bmp.close && bmp.close();
  return canvasBlob(t, 'image/jpeg', 0.82);
}
let saveChain = Promise.resolve();
function saveCurrent(){
  const owner = scope;
  saveChain = saveChain.then(async () => {
    const title = titleInput.value.trim() || 'Untitled';
    const bg = { h: bgH, s: bgS, b: bgB };
    const png = await strokesBlob();
    const now = Date.now();
    const existing = editingId ? gallery.find(g => g.id === editingId) : null;
    const item = {
      id: editingId || ('c' + now.toString(36) + Math.floor(Math.random() * 1296).toString(36)),
      title, bg, png, thumb: await thumbBlob(png, bg),
      created: existing ? existing.created : now, ts: now,
      visibility: existing ? existing.visibility : 'private', owner,
    };
    try { await idbPut('canvases', item); }
    catch (e) { toast('Could not save — storage refused it.'); throw e; }
    if (owner === scope) gallery = [item, ...gallery.filter(g => g.id !== item.id)];
    if (owner !== 'local') syncSoon();
    editingId = item.id;
    dirty = false;
    republishIfPublic(item);
    return item;
  });
  return saveChain;
}
/* The draft is what is ON SCREEN -- the drawing, which canvas it is, and its
   undo stack by id -- so a reload of any kind comes back to exactly this.
   It is written whenever anything changed since the last write (draftRev),
   not only while there are unsaved strokes: an opened canvas, or an undo
   stack, is worth coming back to too. One draft per account (see scope). */
let draftT = null, draftRev = 0, draftSavedRev = 0;
function scheduleDraft(){
  draftRev++;
  clearTimeout(draftT);
  draftT = setTimeout(flushDraft, 700);
}
async function flushDraft(){
  clearTimeout(draftT);
  const key = draftKey(scope), rev = draftRev;
  const png = await strokesBlob();
  if (rev === draftSavedRev) return;
  if (!dirty && !editingId && history.length < 2) return;
  await idbPut('meta', { key, title: titleInput.value, bg: { h: bgH, s: bgS, b: bgB }, png, editingId, dirty,
                         ...stackRecord(), ts: Date.now() });
  draftSavedRev = rev;
}
const clearDraft = () => { draftSavedRev = draftRev; return idbDel('meta', draftKey(scope)).catch(() => {}); };
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushDraft();
});
window.addEventListener('pagehide', () => { flushDraft(); });
titleInput.addEventListener('input', () => { dirty = true; scheduleDraft(); });

/* ---------- toolbar ---------- */
function syncToolSel(){
  const isBrush = tool==='brush';
  $('toggle-brush-icon').style.display = isBrush ? '' : 'none';
  $('toggle-eraser-icon').style.display = isBrush ? 'none' : '';
  $('tool-toggle').setAttribute('aria-label', isBrush ? 'Switch to eraser' : 'Switch to brush');
}
$('tool-toggle').addEventListener('click', e => {
  e.stopPropagation();
  closePop();
  tool = tool==='brush' ? 'eraser' : 'brush';
  syncToolSel(); refreshSizeUI();
});
$('color-btn').addEventListener('click', e => {
  e.stopPropagation();
  setColorMode(!colorMode);
});

$('sym-btn').addEventListener('click', () => {
  mirrorOn = !mirrorOn;
  $('sym-btn').classList.toggle('on', mirrorOn);
  $('sym-btn').setAttribute('aria-pressed', mirrorOn);
  render();
});
/* THE CANVAS ON SCREEN IS ALWAYS A CARD in the gallery (Dex, 2026-10-08):
   a new one is saved the moment it is made, blank or not, named Untitled 1,
   2, 3... so + always visibly makes a canvas, and the gallery never lacks the
   one being drawn on. (It used to skip saving a blank, untitled canvas, so a
   fresh canvas was missing from the gallery until something was drawn.) */
function nextUntitled(){
  let n = 0;
  for (const g of gallery){ const m = /^Untitled (\d+)$/.exec(g.title || ''); if (m) n = Math.max(n, +m[1]); }
  return 'Untitled ' + (n + 1);
}
async function startBlank(){
  editingId = null; titleInput.value = nextUntitled();
  bgH = 210; bgS = 35; bgB = 50;
  await historyChain;
  sctx.clearRect(0,0,W,H);
  // A fresh history too: undo on a new canvas must not bring the old one back.
  render(); history = []; step = -1; pushHistory();
  dirty = true;
  await saveCurrent().catch(() => {});
  scheduleDraft();
  refreshPanelUI();
}
/* Whatever is on screen, as a card: called once the scope is on screen. */
async function ensureCurrent(){
  if (editingId && gallery.some(g => g.id === editingId)) return;
  if (!titleInput.value.trim()) titleInput.value = nextUntitled();
  await saveCurrent().catch(() => {});
  scheduleDraft();
  refreshPanelUI();
}
$('plus-btn').addEventListener('click', async () => {
  closePop();
  if (dirty){ try { await saveCurrent(); } catch (e) { return; } }
  await keepCanvasHistory();
  await startBlank();
  toast(titleInput.value);
});

/* ---------- brush popover ---------- */
function placePop(){
  const tb = $('toolbar').getBoundingClientRect();
  brushPop.style.bottom = Math.max(8, window.innerHeight - tb.top + 12) + 'px';
}
function closePop(){ popMode = null; brushPop.classList.remove('open'); }
$('pop-x').addEventListener('click', e => { e.stopPropagation(); closePop(); });
document.addEventListener('pointerdown', e => {
  if (!popMode) return;
  if (brushPop.contains(e.target)) return;
  if (e.target.closest('#color-btn') || e.target.closest('#tool-toggle') || e.target.closest('#canvas-swatch')) return;
  closePop();
});
document.addEventListener('touchstart', e => {
  if (!popMode) return;
  const x = e.touches[0].clientX;
  if (x < 28 || x > window.innerWidth-28) closePop();
}, {passive:true});
function syncSizeNote(){ /* size is now permanent, no-op */ }
/* log-ish slider: 10-100px on first half, 100-500px on second half */
function sliderToSize(p){
  p = Math.max(0, Math.min(100, +p));
  if (p <= 25) return Math.round(10 + (p/25)*20);
  if (p <= 50) return Math.round(30 + ((p-25)/25)*70);
  return Math.round(100 + ((p-50)/50)*400);
}
function sizeToSlider(s){
  s = Math.max(10, Math.min(500, +s));
  if (s <= 30) return ((s-10)/20)*25;
  if (s <= 100) return 25 + ((s-30)/70)*25;
  return 50 + ((s-100)/400)*50;
}
/* Two colour controls, never crossed: the brush bar (hue/sat/bri, opened by
   the brush swatch in the toolbar) only ever sets the BRUSH, and the canvas
   window (cv-hue/cv-sat/cv-bri, opened by the top-left swatch) only ever
   sets the CANVAS. Both read back from state here, and so do both swatches. */
function paintTracks(prefix, h, s, b){
  $(prefix + 'sat').style.setProperty('--sat-track', `linear-gradient(90deg, ${hsbToCss(h,0,b,1)}, ${hsbToCss(h,100,b,1)})`);
  $(prefix + 'bri').style.setProperty('--bri-track', `linear-gradient(90deg, ${hsbToCss(h,s,0,1)}, ${hsbToCss(h,s,100,1)})`);
}
function refreshPanelUI(){
  const cd=$('color-dot'); if(cd) cd.style.background = brushCss();
  $('cs-dot').style.background = bgCss();
  $('hue').value = hue; $('sat').value = sat; $('bri').value = bri;
  paintTracks('', hue, sat, bri);
  $('cv-hue').value = bgH; $('cv-sat').value = bgS; $('cv-bri').value = bgB;
  paintTracks('cv-', bgH, bgS, bgB);
  syncTopLock();
  const sz = tool==='eraser' ? eraserEff() : brushSize;
  $('size').value = sizeToSlider(sz);
  $('size-v').textContent = sz+'px';
  const tip = document.getElementById('brush-tip');
  if (tip) tip.setAttribute('fill', brushCss());
}
function refreshSizeUI(){
  const sz = tool==='eraser' ? eraserEff() : brushSize;
  $('size').value = sizeToSlider(sz);
  $('size-v').textContent = sz + 'px';

  const sp = $('sp-circle');
  if (sp){
    const d = Math.max(4, Math.min(60, sz * 0.2));
    sp.style.width = sp.style.height = d + 'px';
  }
  const lbl = $('sp-label');
  if (lbl) lbl.textContent = sz + 'px';
}
function bindHSB(){
  const brush = () => {
    hue = +$('hue').value; sat = +$('sat').value; bri = +$('bri').value;
    showColorPreview(); refreshPanelUI();
  };
  const bg = () => {
    bgH = +$('cv-hue').value; bgS = +$('cv-sat').value; bgB = +$('cv-bri').value;
    render(); refreshPanelUI(); dirty = true; scheduleDraft();
  };
  for (const id of ['hue', 'sat', 'bri']) $(id).addEventListener('input', brush);
  for (const id of ['cv-hue', 'cv-sat', 'cv-bri']) $(id).addEventListener('input', bg);
}
let spHideT = null;
function showSizePreview(){
  const sz = tool==='eraser' ? eraserEff() : brushSize;
  const c = $('sp-circle'), d = Math.max(6, Math.min(240, Math.round(sz * fitK)));
  c.style.width = c.style.height = d+'px';
  if (tool==='eraser'){ c.style.background = '#fff'; }
  else { c.style.background = brushCss(); }
  $('sp-label').textContent = sz+'px';
  $('size-preview').classList.add('show');
  clearTimeout(spHideT);
  spHideT = setTimeout(() => $('size-preview').classList.remove('show'), 1400);
}
$('size').addEventListener('input', () => {
  const v = sliderToSize($('size').value);
  if (tool==='eraser'){ eraserSize = v; }
  else brushSize = v;
  refreshSizeUI(); showSizePreview();
});

/* ---------- eyedropper ---------- */
let eyedropperOn = false;
function rgbToHsb(r, g, b){
  r/=255; g/=255; b/=255;
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
  let h=0;
  if(d!==0){
    if(mx===r) h=((g-b)/d)%6;
    else if(mx===g) h=(b-r)/d+2;
    else h=(r-g)/d+4;
    h*=60; if(h<0) h+=360;
  }
  return {h:Math.round(h), s:mx===0?0:Math.round(d/mx*100), b:Math.round(mx*100)};
}
/* The canvas's BACKING pixels are W*DPR by H*DPR, so a point in drawing
   units has to be scaled by DPR to read the pixel under it. Without that,
   on any phone (DPR 2+) it read a pixel up and to the left of the finger --
   the "eyedropper picks the wrong colour". */
function sampleColorAt(clientX, clientY){
  const r = canvas.getBoundingClientRect();
  const fx = (clientX - r.left) / r.width, fy = (clientY - r.top) / r.height;
  if (fx < 0 || fy < 0 || fx >= 1 || fy >= 1) return null;
  const d = ctx.getImageData(Math.floor(fx * canvas.width), Math.floor(fy * canvas.height), 1, 1).data;
  return rgbToHsb(d[0], d[1], d[2]);
}
/* Touch and drag: the loupe follows the finger showing the colour under it,
   and the colour is taken when the finger lifts. Captured, so a drag that
   strays off the canvas keeps the last colour it was over. */
function startEyedrop(e){
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  let picked = sampleColorAt(e.clientX, e.clientY);
  if (picked) showEdPreview(e.clientX, e.clientY, picked);
  const move = ev => {
    if (ev.pointerId !== e.pointerId) return;
    const h = sampleColorAt(ev.clientX, ev.clientY);
    if (h) picked = h;
    if (picked) showEdPreview(ev.clientX, ev.clientY, picked);
  };
  const up = ev => {
    if (ev.pointerId !== e.pointerId) return;
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    hideEdPreview(); setEyedropper(false);
    if (picked && ev.type === 'pointerup'){
      applyEyedropperColor(picked);
      if (tool !== 'brush'){ tool = 'brush'; syncToolSel(); refreshSizeUI(); }
    }
  };
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
}
function applyEyedropperColor(hsb){
  hue=hsb.h; sat=hsb.s; bri=hsb.b;
  refreshPanelUI();
}
let edLongPressT=null, edPreviewEl=null;
function showEdPreview(x, y, hsb){
  if(!edPreviewEl){
    edPreviewEl=document.createElement('div');
    edPreviewEl.style.cssText='position:fixed;z-index:9999;width:56px;height:56px;border-radius:50%;border:3px solid #fff;box-shadow:0 4px 20px rgba(0,0,0,.5);pointer-events:none;transform:translate(-50%,-130%);';
    document.body.appendChild(edPreviewEl);
  }
  edPreviewEl.style.left=x+'px'; edPreviewEl.style.top=y+'px';
  edPreviewEl.style.background=hsbToCss(hsb.h,hsb.s,hsb.b,1);
  edPreviewEl.style.display='block';
}
function hideEdPreview(){
  if(edPreviewEl) edPreviewEl.style.display='none';
  clearTimeout(edLongPressT); edLongPressT=null;
}
function setEyedropper(on){
  eyedropperOn=on;
  $('ed-btn').classList.toggle('on', on);
  if(!on) hideEdPreview();
  canvas.style.cursor = on ? 'crosshair' : '';
}

$('ed-btn').addEventListener('click', () => setEyedropper(!eyedropperOn));
$('canvas-swatch').addEventListener('click', e => {
  e.stopPropagation();
  if (popMode){ closePop(); return; }
  popMode = 'canvas';
  refreshPanelUI(); placePop();
  brushPop.classList.add('open');
});

/* ---------- color/size mode toggle ---------- */
let colorMode = false;
function setColorMode(on){
  colorMode = on;
  $('size-bar').style.display = on ? 'none' : 'flex';
  $('hsb-bar').style.display = on ? 'flex' : 'none';
  $('color-btn').classList.toggle('on', on);
  if(on) syncHSBInputs();
}
function syncHSBInputs(){
  refreshPanelUI();
  updateHSBTracks();
}
function updateHSBTracks(){
  const h=hue, s=sat, b=bri;
  $('hue').style.setProperty('--hue-track', `linear-gradient(90deg, ${hsbToCss(0,s,b,1)}, ${hsbToCss(60,s,b,1)}, ${hsbToCss(120,s,b,1)}, ${hsbToCss(180,s,b,1)}, ${hsbToCss(240,s,b,1)}, ${hsbToCss(300,s,b,1)}, ${hsbToCss(360,s,b,1)})`);
  $('sat').style.setProperty('--sat-track', `linear-gradient(90deg, ${hsbToCss(h,0,b,1)}, ${hsbToCss(h,100,b,1)})`);
  $('bri').style.setProperty('--bri-track', `linear-gradient(90deg, ${hsbToCss(h,s,0,1)}, ${hsbToCss(h,s,100,1)})`);
}
function showColorPreview(){
  const c = $('sp-circle');
  const sz = Math.max(40, Math.min(120, 60));
  c.style.width = c.style.height = sz+'px';
  c.style.background = brushCss();
  $('sp-label').textContent = '';
  $('sp-label').style.display = 'none';
  $('size-preview').classList.add('show');
  clearTimeout(spHideT);
  spHideT = setTimeout(() => {
    $('size-preview').classList.remove('show');
    $('sp-label').style.display = '';
  }, 1200);
}

/* ---------- gallery ----------
   Thumbnails are stored with each drawing (a 360x480 JPEG made at save), so
   opening the gallery decodes small images instead of re-rendering every full
   drawing. Object URLs are revoked whenever the grid is rebuilt. */
let thumbUrls = [];
function blobUrl(blob){ const u = URL.createObjectURL(blob); thumbUrls.push(u); return u; }
function liveThumb(cb){
  const t = document.createElement('canvas'); t.width = 360; t.height = 480;
  const c = t.getContext('2d');
  c.fillStyle = bgCss(); c.fillRect(0,0,360,480);
  c.drawImage(sLayer, 0,0,sLayer.width,sLayer.height, 0,0,360,480);
  cb(t.toDataURL('image/jpeg', 0.82));
}
function fileName(title){
  let s = (title||'untitled').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  return 'inko-'+(s||'canvas')+'.png';
}
async function downloadItem(it, isLive){
  const t = document.createElement('canvas'); t.width = W; t.height = H;
  const c = t.getContext('2d');
  const bg = isLive ? { h: bgH, s: bgS, b: bgB } : (it.bg || { h: 0, s: 0, b: 100 });
  c.fillStyle = hsbToCss(bg.h, bg.s, bg.b, 1); c.fillRect(0,0,W,H);
  if (isLive) c.drawImage(sLayer, 0,0,W,H);
  else if (it.png){ const bmp = await createImageBitmap(it.png); c.drawImage(bmp, 0,0,W,H); bmp.close && bmp.close(); }
  const url = URL.createObjectURL(await canvasBlob(t));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(isLive ? titleInput.value : it.title);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Downloaded');
}
let modalCb = null;
function openModal(title, text, confirmLabel, cb){
  $('m-title').textContent = title; $('m-text').textContent = text;
  $('m-del').textContent = confirmLabel; modalCb = cb;
  $('modal').classList.add('open');
}
$('m-cancel').addEventListener('click', () => $('modal').classList.remove('open'));
$('m-del').addEventListener('click', () => {
  $('modal').classList.remove('open');
  if (modalCb) modalCb();
});
function makeItem(it, isLive){
  const div = document.createElement('div'); div.className = 'g-item' + (!isLive && it.id === editingId ? ' current' : '');
  const th = document.createElement('div'); th.className = 'g-thumb';
  const img = document.createElement('img'); img.alt = ''; th.appendChild(img);
  const dl = document.createElement('button'); dl.className = 'g-dl'; dl.setAttribute('aria-label','Download');
  dl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3 V15"/><path d="M7 10 L12 15 L17 10"/><path d="M4 19 H20"/></svg>';
  const del = document.createElement('button'); del.className = 'g-del'; del.setAttribute('aria-label','Delete');
  del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="12" x2="18" y2="12"/></svg>';
  dl.addEventListener('click', e => { e.stopPropagation(); downloadItem(it, isLive); });
  if (isLive){
    del.addEventListener('click', e => {
      e.stopPropagation();
      openModal('Clear canvas?','This erases the current drawing.','Clear', () => {
        clearCanvas(); dirty = false; clearDraft();
        toast('Canvas cleared'); renderGallery();
      });
    });
    liveThumb(url => img.src = url);
    div.addEventListener('click', () => $('gallery').classList.remove('open'));
  } else {
    del.addEventListener('click', e => {
      e.stopPropagation();
      const shared = it.visibility === 'public';
      openModal('Delete canvas?', `"${it.title}" will be permanently deleted${shared ? ', and taken out of the shared gallery' : ''}.`, 'Delete', async () => {
        if (shared){
          try { await api('unpublish', { id: it.id }); }
          catch (err) { toast('Could not take it out of the shared gallery: ' + err.message); return; }
        }
        try { await idbDel('canvases', it.id); }
        catch (err) { toast('Could not delete it.'); return; }
        // Its kept undo history goes with it.
        idbDel('meta', 'hist:' + it.id).then(gcSteps).catch(() => {});
        // And the account's copy, on every device (later, if offline).
        if (scope !== 'local'){
          const sc = scope, ts = Date.now();
          api('canvas-delete', { id: it.id, ts }).catch(() => queueDelete(sc, it.id, ts));
        }
        gallery = gallery.filter(g => g.id !== it.id);
        // Deleting the canvas on screen leaves a fresh one, not a ghost of it.
        if (editingId === it.id) await startBlank();
        toast('Canvas deleted'); renderGallery();
      });
    });
    if (it.thumb) img.src = blobUrl(it.thumb);
    else if (it.png) thumbBlob(it.png, it.bg).then(b => { it.thumb = b; img.src = blobUrl(b); idbPut('canvases', it).catch(() => {}); });
    div.addEventListener('click', () => openCanvas(it.id));
    // Public or private, on the card: the lock is this device only, the globe
    // is the shared gallery.
    const pub = document.createElement('button'); pub.className = 'g-pub';
    paintPubButton(pub, it);
    pub.addEventListener('click', e => { e.stopPropagation(); toggleVisibility(it, pub); });
    th.appendChild(pub);
  }
  th.appendChild(dl); th.appendChild(del);
  const cap = document.createElement('div'); cap.className = 'g-title';
  cap.textContent = isLive ? (titleInput.value.trim() || 'Untitled') + ' • live' : it.title;
  div.appendChild(th); div.appendChild(cap);
  return div;
}
function renderGallery(){
  thumbUrls.forEach(u => URL.revokeObjectURL(u)); thumbUrls = [];
  const rows = $('g-rows'); rows.innerHTML = '';
  $('g-count').textContent = gallery.length + (gallery.length===1 ? ' canvas' : ' canvases');
  // Oldest first → newest ends up bottom-right
  const items = [...gallery].sort((a, b) => (a.created || a.ts) - (b.created || b.ts));
  for (let i=0; i<items.length; i+=3){
    const row = document.createElement('div'); row.className = 'g-row';
    items.slice(i, i+3).forEach(it => row.appendChild(makeItem(it, false)));
    rows.appendChild(row);
  }
  $('g-grid').scrollTop = $('g-grid').scrollHeight;
}
async function openCanvas(id){
  if (dirty) await saveCurrent().catch(() => {});
  await keepCanvasHistory();
  const it = gallery.find(g => g.id === id);
  if (!it || !it.png) return;
  editingId = id; titleInput.value = it.title;
  bgH = it.bg.h; bgS = it.bg.s; bgB = it.bg.b;
  await historyChain;
  await drawBlob(it.png);
  render();
  // Back to a canvas left earlier today: its last strokes can still be undone.
  const kept = await keptCanvasHistory(it).catch(() => null);
  if (kept) useStack(kept); else { history = []; step = -1; pushHistory(); }
  dirty = false;
  scheduleDraft();
  $('gallery').classList.remove('open');
  refreshPanelUI();
}
$('grid-btn').addEventListener('click', async () => {
  closePop();
  // The card for the canvas on screen shows what is on it now.
  if (dirty) await saveCurrent().catch(() => {});
  if (galleryTab === 'public') loadFeed(); else renderGallery();
  $('gallery').classList.add('open');
});
$('g-back').addEventListener('click', () => $('gallery').classList.remove('open'));

/* ---------- toast ---------- */
let toastT = null;
function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

/* ---------- the shared gallery ----------
   PRIVATE MEANS ON THIS DEVICE ONLY. A drawing is private until its owner
   flips it public; then a flattened snapshot is uploaded and listed in the
   Public tab, and flipping it back deletes it from the server. Nothing private
   is ever sent anywhere. The server side is /api/sketch (lib/sketch-store.js),
   named "sketch" so renaming the app touches none of it. */
const API = '/api/sketch';
const SESSION_KEY = 'sketchSession', BLOCK_KEY = 'sketchBlocked';
let session = null;                 // { handle, token }
try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) {}
let blocked = [];
try { blocked = JSON.parse(localStorage.getItem(BLOCK_KEY) || '[]') || []; } catch (e) {}
let galleryTab = 'mine', feed = [], myVoteFor = {};
/* What THIS device just published or took back: id -> { post } | { gone }.
   The feed is cached at the edge for up to ~40 s (s-maxage 10 plus
   stale-while-revalidate 30), so a drawing made public a moment ago was
   missing from the Public tab and one made private was still in it. For a
   few minutes after a change of our own, the feed is asked for past the
   cache, and the change is laid over whatever comes back. */
const mineLately = new Map();
const LATELY_MS = 3 * 60 * 1000;

async function api(action, data = {}){
  const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, token: session && session.token, ...data }) });
  let body = {};
  try { body = await r.json(); } catch (e) {}
  if (r.status === 401 && session && action !== 'login' && action !== 'signup'){ setSession(null); }
  if (!r.ok) throw Object.assign(new Error(body.error || 'Something went wrong'), { status: r.status });
  return body;
}
function setSession(s){
  session = s;
  try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch (e) {}
  syncAccountButton();
  switchScope(scopeOf(s));
  if (s) resumePublish();
}

/* ---- signing in and out swaps the canvases (see "whose canvases") ---- */
let scopeChain = Promise.resolve();
function switchScope(next){
  scopeChain = scopeChain.then(() => enterScope(next)).catch(e => console.warn('inko: scope', e));
  return scopeChain;
}
/* An account's first sign-in on this device: the signed-out canvases and
   draft move into it. Returns how many canvases moved. */
async function adoptLocal(next){
  if (next === 'local' || await idbGet('meta', 'seen:' + next).catch(() => null)) return 0;
  let moved = 0;
  for (const it of await idbAll('canvases')){
    if (ownerOf(it) !== 'local') continue;
    it.owner = next; await idbPut('canvases', it); moved++;
  }
  const d = await idbGet('meta', 'draft').catch(() => null);
  if (d && !(await idbGet('meta', draftKey(next)).catch(() => null))){
    await idbPut('meta', { ...d, key: draftKey(next) });
    await idbDel('meta', 'draft');
  }
  await idbPut('meta', { key: 'seen:' + next, at: Date.now() });
  return moved;
}
async function enterScope(next){
  if (next === scope) return;
  // The drawing on screen stays with the account it was drawn in, as that
  // account's draft, undo stack and all.
  await flushDraft().catch(() => {});
  await keepCanvasHistory();
  const moved = await adoptLocal(next);
  scope = next;
  await showScope(false);
  if (moved) toast(moved + (moved === 1 ? ' canvas' : ' canvases') + ' moved into @' + next.slice(2));
  syncSoon();
}

/* ---- the account's canvases, everywhere (Dex, 2026-10-08) ----
   The device keeps its copy in IndexedDB as before (so the app works
   offline and opens instantly); the server holds the account's own copy
   (/api/sketch canvases, canvas-put, canvas-delete, canvas-img). A sync
   compares the two by each canvas's `ts` -- when it was last saved,
   wherever -- and the newer wins in both directions. Deletions travel as
   tombstones; one made offline waits in meta `deletes:<scope>`. A sync runs
   on sign-in, on launch, on coming back to the foreground, on going online,
   and shortly after any save, delete or change of visibility. Drafts (the
   drawing in progress) stay on the device: a canvas syncs once it is saved,
   which + and leaving it for another do. */
let syncing = null, syncAgain = false, syncT = null, syncWarned = false;
function syncSoon(){ clearTimeout(syncT); syncT = setTimeout(syncAccount, 400); }
async function canvasImg(c, thumb){
  const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'canvas-img', token: session && session.token, id: c.id, v: c.v, thumb }) });
  if (r.status === 401) setSession(null);
  if (!r.ok) throw new Error('canvas image ' + r.status);
  return r.blob();
}
async function uploadCanvas(it){
  if (!it.png) return;
  if (!it.thumb) it.thumb = await thumbBlob(it.png, it.bg);
  await api('canvas-put', { id: it.id, title: it.title, bg: it.bg, created: it.created, ts: it.ts, visibility: it.visibility,
                            png: await blobToDataUrl(it.png), thumb: await blobToDataUrl(it.thumb) });
}
async function queueDelete(sc, id, ts){
  const key = 'deletes:' + sc;
  const rec = (await idbGet('meta', key).catch(() => null)) || { key, ids: {} };
  rec.ids[id] = ts;
  await idbPut('meta', rec).catch(() => {});
}
function syncAccount(){
  if (!session || scope === 'local' || !navigator.onLine) return Promise.resolve();
  if (syncing){ syncAgain = true; return syncing; }
  const sc = scope;
  syncing = (async () => {
    // Deletions made while offline go first, so they are not undone below.
    const key = 'deletes:' + sc;
    const pend = await idbGet('meta', key).catch(() => null);
    if (pend && Object.keys(pend.ids).length){
      for (const [id, ts] of Object.entries(pend.ids)){ await api('canvas-delete', { id, ts }); delete pend.ids[id]; }
      await idbPut('meta', pend);
    }
    const { canvases = [] } = await api('canvases');
    if (scope !== sc) return;
    const server = new Map(canvases.map(c => [c.id, c]));
    const local = new Map((await idbAll('canvases')).filter(it => ownerOf(it) === sc).map(it => [it.id, it]));
    let changed = false;
    for (const c of server.values()){
      const it = local.get(c.id);
      if (c.deleted){
        if (it && it.ts <= c.ts){
          await idbDel('canvases', c.id); idbDel('meta', 'hist:' + c.id).catch(() => {});
          local.delete(c.id); changed = true;
          if (editingId === c.id) editingId = null;
        }
        continue;
      }
      if (it && it.ts >= c.ts) continue;
      const rec = { id: c.id, title: c.title, bg: c.bg, png: await canvasImg(c, false), thumb: await canvasImg(c, true),
                    created: c.created, ts: c.ts, visibility: c.visibility, owner: sc };
      if (scope !== sc) return;
      await idbPut('canvases', rec);
      local.set(c.id, rec); changed = true;
    }
    for (const it of local.values()){
      const c = server.get(it.id);
      if (c && it.ts <= c.ts) continue;
      try { await uploadCanvas(it); }
      catch (e){
        if (e.status === 413 && !syncWarned){ syncWarned = true; toast('"' + it.title + '" is too large to keep on the account — it stays on this device'); }
        else if (e.status === 401) return;
      }
    }
    if (changed && scope === sc){
      gallery = (await idbAll('canvases')).filter(it => ownerOf(it) === sc);
      if ($('gallery').classList.contains('open') && galleryTab === 'mine') renderGallery();
    }
  })().catch(e => console.warn('inko: sync', e)).finally(() => {
    syncing = null;
    if (syncAgain){ syncAgain = false; syncSoon(); }
  });
  return syncing;
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncSoon(); });
window.addEventListener('online', syncSoon);
/* Put the scope's gallery and its draft on screen (a blank canvas if it has
   none). COLD is a launch after the app was closed: the undo stack comes
   back cut to KEEP_STEPS rather than whole. */
async function showScope(cold){
  try { gallery = (await idbAll('canvases')).filter(it => ownerOf(it) === scope); }
  catch (e) { gallery = []; toast('Storage is unavailable — drawings will not be kept.'); }
  let draft = null;
  try { draft = await idbGet('meta', draftKey(scope)); } catch (e) {}
  await historyChain;
  history = []; step = -1; latestBlob = null;
  if (draft && draft.png){
    titleInput.value = draft.title || '';
    if (draft.bg){ bgH = draft.bg.h; bgS = draft.bg.s; bgB = draft.bg.b; }
    // Carrying on with a gallery drawing after a reload saves back to IT,
    // not to a new card.
    editingId = draft.editingId && gallery.some(g => g.id === draft.editingId) ? draft.editingId : null;
    await drawBlob(draft.png);
    // A draft from before 'dirty' was recorded was always unsaved work.
    dirty = draft.dirty !== false;
    const fresh = Date.now() - (draft.ts || 0) <= KEEP_MS;
    const kept = fresh ? await loadStack(draft, cold ? KEEP_STEPS : 0).catch(() => null) : null;
    if (kept) useStack(kept);
  } else {
    editingId = null; titleInput.value = '';
    bgH = 210; bgS = 35; bgB = 50;
    sctx.clearRect(0, 0, W, H);
    dirty = false;
  }
  render(); refreshPanelUI();
  if (!history.length) pushHistory();
  syncUndoRedo();
  draftSavedRev = draftRev;
  await ensureCurrent();
  if ($('gallery').classList.contains('open') && galleryTab === 'mine') renderGallery();
}
function syncAccountButton(){
  const b = $('g-account'); if (!b) return;
  b.textContent = session ? '@' + session.handle : 'Sign in';
  b.classList.toggle('signed', !!session);
}
const blobToDataUrl = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });

/* The public copy: the drawing on its own background, at the canvas's logical
   size, as WebP. The thumbnail already exists. */
async function publishImage(it){
  const t = document.createElement('canvas'); t.width = W; t.height = H;
  const c = t.getContext('2d');
  c.fillStyle = hsbToCss(it.bg.h, it.bg.s, it.bg.b, 1); c.fillRect(0, 0, W, H);
  const bmp = await createImageBitmap(it.png); c.drawImage(bmp, 0, 0, W, H); bmp.close && bmp.close();
  return canvasBlob(t, 'image/webp', 0.9);
}
async function publishItem(it){
  if (!it.thumb) it.thumb = await thumbBlob(it.png, it.bg);
  const image = await blobToDataUrl(await publishImage(it));
  const thumb = await blobToDataUrl(it.thumb);
  const r = await api('publish', { id: it.id, title: it.title, image, thumb });
  it.visibility = 'public'; it.ts = Date.now();
  await idbPut('canvases', it);
  syncSoon();
  if (r && r.post) mineLately.set(it.id, { post: r.post, at: Date.now() });
}
async function unpublishItem(it){
  await api('unpublish', { id: it.id });
  it.visibility = 'private'; it.ts = Date.now();
  await idbPut('canvases', it);
  syncSoon();
  mineLately.set(it.id, { gone: true, at: Date.now() });
}
/* A drawing someone tried to make public while signed out goes public once
   they ARE signed in, however that happened -- the name-and-password sheet,
   or a Google or Discord round trip that reloaded the page and lost any
   callback held in memory (which is how "I made it public and it is not on
   the Public page" happened). Remembered for the tab, for 15 minutes, and
   forgotten if the sheet is closed instead. */
const PENDING_KEY = 'inkoPendingPublish';
function rememberPublish(id){ try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ id, at: Date.now() })); } catch (e) {} }
function forgetPublish(){ try { sessionStorage.removeItem(PENDING_KEY); } catch (e) {} }
async function resumePublish(){
  let p = null;
  try { p = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); } catch (e) {}
  forgetPublish();
  if (!p || Date.now() - p.at > 15 * 60 * 1000) return;
  await scopeChain;
  if (!session) return;
  let it = gallery.find(g => g.id === p.id);
  if (!it){
    // Drawn signed out, on an account this device already knew: going public
    // under the account brings that one drawing into it.
    const rec = await idbGet('canvases', p.id).catch(() => null);
    if (!rec || ownerOf(rec) !== 'local') return;
    rec.owner = scope; await idbPut('canvases', rec);
    gallery = [rec, ...gallery]; it = rec;
  }
  if (it.visibility !== 'public'){
    try { await publishItem(it); toast('Public — in the shared gallery'); } catch (e) { toast(e.message); }
  }
  syncTopLock();
  if ($('gallery').classList.contains('open') && galleryTab === 'mine') renderGallery();
}
async function toggleVisibility(it, btn){
  if (!session){ rememberPublish(it.id); openAccount(); return; }
  btn.disabled = true;
  try {
    if (it.visibility === 'public'){ await unpublishItem(it); toast('Private — only on this device'); }
    else { await publishItem(it); toast('Public — in the shared gallery'); }
  } catch (e) { toast(e.message); }
  btn.disabled = false;
  paintPubButton(btn, it);
  syncTopLock();
  if (btn.id === 'top-lock' && $('gallery').classList.contains('open') && galleryTab === 'mine') renderGallery();
}
/* The lock at the top right is the canvas on screen's own public/private
   switch, the same one its gallery card carries. */
const currentItem = () => (editingId ? gallery.find(g => g.id === editingId) : null);
function syncTopLock(){ const b = $('top-lock'); if (b) paintPubButton(b, currentItem() || { visibility: 'private' }); }
$('top-lock').addEventListener('click', async e => {
  e.stopPropagation();
  closePop();
  if (dirty || !currentItem()){ try { await saveCurrent(); } catch (err) { return; } }
  const it = currentItem();
  if (it) toggleVisibility(it, $('top-lock'));
});
function paintPubButton(btn, it){
  const pub = it.visibility === 'public';
  btn.classList.toggle('on', pub);
  btn.setAttribute('aria-label', pub ? 'Public — make private' : 'Private — make public');
  btn.innerHTML = pub
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
}
/* An edited public drawing re-publishes itself on save, so the shared copy
   is never older than the one on the device. */
function republishIfPublic(item){
  if (item && item.visibility === 'public' && session) publishItem(item).catch(() => toast('Saved here — the public copy will update next time'));
}

/* ---- the Public tab ---- */
async function loadFeed(){
  $('g-count').textContent = 'Loading…';
  try {
    const now = Date.now();
    for (const [id, m] of mineLately) if (now - m.at > LATELY_MS) mineLately.delete(id);
    const r = await fetch(API + '?feed=1' + (mineLately.size ? '&fresh=' + now : ''), { cache: 'no-store' });
    if (!r.ok) throw new Error();
    feed = (await r.json()).posts || [];
    for (const [id, m] of mineLately){
      const at = feed.findIndex(p => p.id === id);
      if (m.gone){ if (at >= 0) feed.splice(at, 1); }
      else if (at < 0) feed.unshift(m.post);
      else if ((feed[at].v || 0) < (m.post.v || 0)) feed[at] = m.post;
    }
  } catch (e) { feed = []; $('g-count').textContent = 'Offline'; renderFeed(); return; }
  if (session && feed.length){
    try { myVoteFor = (await api('votes', { ids: feed.map(p => p.id) })).votes || {}; } catch (e) {}
  }
  renderFeed();
}
const imgUrl = (p, thumb) => `${API}?img=${encodeURIComponent(`sketch/img/${p.id}-${p.v}${thumb ? '-t.jpg' : '.webp'}`)}`;
/* Never hide your OWN drawings: "Hide @you" was offered on them while
   signed out, and once taken, every drawing you published vanished from your
   Public tab for good. */
function visibleFeed(){ return feed.filter(p => !blocked.includes(p.handle) || (session && session.handle === p.handle)); }
function renderFeed(){
  const rows = $('g-rows'); rows.innerHTML = '';
  const items = visibleFeed();
  $('g-count').textContent = items.length + (items.length === 1 ? ' drawing' : ' drawings');
  if (!items.length){
    const e = document.createElement('div'); e.className = 'g-empty';
    e.textContent = 'Nothing shared yet. Make one of your drawings public to start it off.';
    rows.appendChild(e); return;
  }
  for (let i = 0; i < items.length; i += 3){
    const row = document.createElement('div'); row.className = 'g-row';
    items.slice(i, i + 3).forEach(p => row.appendChild(feedItem(p)));
    rows.appendChild(row);
  }
  $('g-grid').scrollTop = 0;
}
function reactionRow(p){
  const wrap = document.createElement('div'); wrap.className = 'g-react';
  for (const kind of ['fire', 'poop']){
    const b = document.createElement('button');
    b.className = 'g-rx' + (myVoteFor[p.id] === kind ? ' on' : '');
    b.dataset.kind = kind;
    b.setAttribute('aria-label', kind === 'fire' ? 'Fire' : 'Poop');
    b.innerHTML = `<span>${kind === 'fire' ? '🔥' : '💩'}</span><b>${p[kind] || 0}</b>`;
    b.addEventListener('click', e => { e.stopPropagation(); react(p, kind); });
    wrap.appendChild(b);
  }
  return wrap;
}
function feedItem(p){
  const div = document.createElement('div'); div.className = 'g-item'; div.dataset.post = p.id;
  const th = document.createElement('div'); th.className = 'g-thumb';
  const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy'; img.src = imgUrl(p, true);
  th.appendChild(img);
  const cap = document.createElement('div'); cap.className = 'g-title';
  cap.textContent = p.title;
  const by = document.createElement('div'); by.className = 'g-by';
  by.textContent = '@' + p.handle;
  div.append(th, cap, by, reactionRow(p));
  div.addEventListener('click', () => openViewer(p));
  return div;
}
/* ONE object per post. A sign-in reloads the feed with fresh objects while a
   reaction may still hold the old one, and the viewer showed one count while
   the card showed another. Every handler looks its post up by id, now. */
const canonical = p => feed.find(x => x.id === p.id) || p;
async function react(p, kind){
  if (!session){ openAccount(() => react(p, kind)); return; }
  p = canonical(p);
  const before = { fire: p.fire, poop: p.poop, mine: myVoteFor[p.id] || null };
  // Optimistic: the count moves under the finger, and is corrected by the reply.
  const mine = before.mine === kind ? null : kind;
  if (before.mine) p[before.mine]--;
  if (mine) p[mine]++;
  myVoteFor[p.id] = mine;
  repaintPost(p);
  try {
    const r = await api('vote', { id: p.id, kind: mine });
    p.fire = r.fire; p.poop = r.poop; myVoteFor[p.id] = r.mine;
  } catch (e) {
    p.fire = before.fire; p.poop = before.poop; myVoteFor[p.id] = before.mine;
    toast(e.message);
  }
  repaintPost(p);
}
function repaintPost(p){
  document.querySelectorAll(`[data-post="${p.id}"] .g-react, #viewer[data-post="${p.id}"] .g-react`).forEach(el => el.replaceWith(reactionRow(p)));
}

/* ---- the viewer ---- */
function openViewer(p){
  p = canonical(p);
  const v = $('viewer');
  v.dataset.post = p.id;
  $('v-img').src = imgUrl(p, false);
  $('v-title').textContent = p.title;
  $('v-by').textContent = '@' + p.handle;
  const old = v.querySelector('.g-react'); if (old) old.replaceWith(reactionRow(p));
  const mine = session && session.handle === p.handle;
  $('v-report').hidden = mine; $('v-block').hidden = mine;
  $('v-report').onclick = () => openModal('Report this drawing?', 'Three reports take it down until it is reviewed.', 'Report', async () => {
    if (!session){ openAccount(); return; }
    try { const r = await api('report', { id: p.id }); toast(r.hidden ? 'Reported — it has been taken down' : 'Reported — thank you'); }
    catch (e) { toast(e.message); }
  });
  $('v-block').onclick = () => openModal('Hide @' + p.handle + '?', 'You will not see their drawings on this device.', 'Hide', () => {
    blocked = [...new Set([...blocked, p.handle])];
    try { localStorage.setItem(BLOCK_KEY, JSON.stringify(blocked)); } catch (e) {}
    closeViewer(); renderFeed(); toast('Hidden');
  });
  v.classList.add('open');
}
function closeViewer(){ $('viewer').classList.remove('open'); $('v-img').removeAttribute('src'); }
$('v-close').addEventListener('click', closeViewer);

/* ---- the account sheet ---- */
let afterSignIn = null;
function openAccount(then, message){
  afterSignIn = then || null;
  const signed = !!session;
  $('a-in').hidden = signed; $('a-out').hidden = !signed; $('a-claim').hidden = true;
  if (signed){
    $('a-who').textContent = '@' + session.handle;
    // A Google or Discord account has no password to type to delete it.
    $('a-pass2').hidden = !!session.sso;
  }
  $('a-msg').textContent = message || '';
  $('a-pass').value = '';
  setPasswordFields(false);
  $('account').classList.add('open');
}
function setPasswordFields(open){
  $('a-pw').hidden = !open;
  $('a-more').setAttribute('aria-expanded', String(open));
  $('a-more').textContent = open ? 'Hide name and password' : 'Use a name and password instead';
  if (open) setTimeout(() => $('a-handle').focus(), 50);
}
$('a-more').addEventListener('click', () => setPasswordFields($('a-pw').hidden));

/* Google and Discord: a real navigation to /api/sketch-auth/<provider>, which
   comes back to /inko/ with the result in the URL fragment. The drawing in
   progress is saved first, because the page is about to be left. Inside the
   site's overlay the providers refuse to be framed, so there it opens in a new
   tab -- and the session it ends with reaches this overlay through
   localStorage, which the two share (see the storage listener below). */
for (const id of ['a-google', 'a-discord']){
  $(id).addEventListener('click', async e => {
    e.preventDefault();
    const href = $(id).getAttribute('href');
    // The site's overlay loads /inko/ without ?embed, so check for a frame too.
    if (EMBED || window.top !== window.self){ window.open(href, '_blank', 'noopener'); return; }
    try { await flushDraft(); } catch (err) {}
    location.href = href;
  });
}
const AUTH_ERRORS = {
  'google-not-ready': 'Google sign-in is not switched on yet.',
  'discord-not-ready': 'Discord sign-in is not switched on yet.',
  cancelled: 'Sign-in was cancelled.',
  expired: 'That took too long. Try again.',
  failed: 'Sign-in did not work. Try again.',
};
/* What the sign-in came back with, read once and wiped from the address bar
   so a session never sits in history or a shared link. */
function handleAuthReturn(){
  const hash = location.hash.slice(1);
  if (!hash) return;
  const params = new URLSearchParams(hash);
  // window.history: `history` in this file is the undo stack.
  window.history.replaceState(null, '', location.pathname + location.search);
  if (params.has('auth')){
    try {
      const got = JSON.parse(params.get('auth'));
      if (got && got.handle && got.token){
        setSession({ handle: got.handle, token: got.token, sso: true });
        toast('Signed in as @' + got.handle);
      }
    } catch (e) {}
  } else if (params.has('claim')){
    openClaim(params.get('claim'), params.get('suggest') || '');
  } else if (params.has('auth-error')){
    forgetPublish();
    $('gallery').classList.add('open');
    const why = params.get('why');
    openAccount(null, (AUTH_ERRORS[params.get('auth-error')] || 'Sign-in did not work. Try again.') + (why ? ` (${why})` : ''));
  }
}
function openClaim(ticket, suggest){
  $('gallery').classList.add('open');
  $('a-in').hidden = true; $('a-out').hidden = true; $('a-claim').hidden = false;
  $('a-claim-handle').value = suggest;
  $('a-msg3').textContent = '';
  $('account').classList.add('open');
  $('a-claim-go').onclick = async () => {
    $('a-msg3').textContent = '';
    try {
      const r = await api('claim', { ticket, handle: $('a-claim-handle').value });
      setSession({ handle: r.handle, token: r.token, sso: true });
      closeAccount();
      toast('Welcome, @' + r.handle);
    } catch (e) { $('a-msg3').textContent = e.message; }
  };
  setTimeout(() => $('a-claim-handle').focus(), 50);
}
$('a-claim-handle').addEventListener('keydown', e => { if (e.key === 'Enter') $('a-claim-go').click(); });
// A sign-in finished in another tab (the overlay's case) lands here too.
window.addEventListener('storage', e => {
  if (e.key !== SESSION_KEY) return;
  try { session = JSON.parse(e.newValue || 'null'); } catch (err) { session = null; }
  syncAccountButton();
  switchScope(scopeOf(session));
  if (session) resumePublish();
  if (session && $('account').classList.contains('open')) closeAccount();
  if (galleryTab === 'public') loadFeed();
});
function closeAccount(){ $('account').classList.remove('open'); afterSignIn = null; }
async function signIn(action){
  $('a-msg').textContent = '';
  const handle = $('a-handle').value, password = $('a-pass').value;
  try {
    const r = await api(action, { handle, password });
    setSession({ handle: r.handle, token: r.token });
    const then = afterSignIn;
    closeAccount();
    toast(action === 'signup' ? 'Welcome, @' + r.handle : 'Signed in as @' + r.handle);
    // The feed (and this person's own reactions) first, THEN whatever the
    // sign-in was for, so it acts on the objects now on screen.
    await scopeChain;
    if (galleryTab === 'public') await loadFeed();
    if (then) then();
  } catch (e) { $('a-msg').textContent = e.message; }
}
$('a-login').addEventListener('click', () => signIn('login'));
$('a-signup').addEventListener('click', () => signIn('signup'));
$('a-pass').addEventListener('keydown', e => { if (e.key === 'Enter') signIn('login'); });
$('a-close').addEventListener('click', () => { forgetPublish(); closeAccount(); });
$('a-signout').addEventListener('click', () => { setSession(null); closeAccount(); toast('Signed out'); if (galleryTab === 'public') renderFeed(); });
$('a-delete').addEventListener('click', () => {
  const pw = $('a-pass2').value;
  if (!pw && !(session && session.sso)){ $('a-msg2').textContent = 'Enter your password to delete the account.'; return; }
  openModal('Delete your account?', 'Every drawing you made public is removed from the shared gallery, and the account\'s saved canvases from every other device. The ones on this device stay, signed out.', 'Delete', async () => {
    try {
      await api('delete-account', { password: pw });
      // Its canvases stay on this device, private, back with the signed-out ones.
      for (const it of gallery){ it.visibility = 'private'; it.owner = 'local'; await idbPut('canvases', it).catch(() => {}); }
      await idbDel('meta', 'seen:' + scope).catch(() => {});
      setSession(null); closeAccount(); toast('Account deleted');
    } catch (e) { $('a-msg2').textContent = e.message; }
  });
});
$('g-account').addEventListener('click', () => openAccount());

/* ---- the tabs ---- */
function setGalleryTab(tab){
  galleryTab = tab;
  $('g-tab-mine').classList.toggle('on', tab === 'mine');
  $('g-tab-public').classList.toggle('on', tab === 'public');
  if (tab === 'public') loadFeed(); else renderGallery();
}
$('g-tab-mine').addEventListener('click', () => setGalleryTab('mine'));
$('g-tab-public').addEventListener('click', () => setGalleryTab('public'));
syncAccountButton();

/* ---------- init ---------- */
async function init(){
  setupCanvas();
  bindHSB(); refreshPanelUI(); syncToolSel(); syncUndoRedo();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 120));
  render();
  try { await migrateLocalStorage(); } catch (e) { console.warn('inko: migration', e); }
  // Open or closed since the last run (see history): sessionStorage outlives
  // a reload and a background kill, not the app being closed.
  let cold = true;
  try { cold = !sessionStorage.getItem('inkoOpen'); sessionStorage.setItem('inkoOpen', '1'); } catch (e) {}
  // Already signed in from before canvases had owners: the first launch of
  // this build is that account's first sign-in here.
  try { await adoptLocal(scopeOf(session)); } catch (e) {}
  scope = scopeOf(session);
  await showScope(cold);
  gcSteps().catch(() => {});
  syncSoon();
  // Ask the browser not to evict the drawings under storage pressure.
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  try {
    const updated = sessionStorage.getItem('inkoUpdated');
    if (updated){ sessionStorage.removeItem('inkoUpdated'); toast('Updated — build ' + updated); }
  } catch (e) {}
  handleAuthReturn();
  checkForUpdate();
}

/* ---------- installing ----------
   No install button in the app any more (it was a testing leftover). The
   site's Inko card has a download button that opens /inko/?install=1, and
   that is the one place installing is offered: the browser's own prompt
   where it has one (Chrome, Edge, Android), and the Add to Home Screen steps
   where it does not (Safari, iPhone). */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });
window.addEventListener('appinstalled', () => { deferredPrompt = null; });
const STANDALONE = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function showInstallSheet(){
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const t = document.createElement('div');
  t.id = 'install-sheet';
  t.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
  const steps = deferredPrompt ? '<p style="margin:0 0 16px;font-size:14px;color:#ddd;">Inko goes on your home screen and opens like any other app, offline too.</p>'
    : ios ? '<ol style="margin:0 0 16px;padding-left:20px;font-size:14px;color:#ddd;"><li>Tap the <b>Share</b> button in Safari</li><li>Tap <b>Add to Home Screen</b></li></ol>'
    : '<ol style="margin:0 0 16px;padding-left:20px;font-size:14px;color:#ddd;"><li>Open the browser <b>menu</b> (⋮)</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b></li></ol>';
  t.innerHTML = '<div style="background:#1a1f2e;border-radius:16px;padding:24px;max-width:340px;width:100%;color:#fff;">' +
    '<h3 style="margin:0 0 12px;font-size:18px;">Install Inko</h3>' + steps +
    '<button data-go style="width:100%;background:linear-gradient(135deg,#22d3ee,#a78bfa);border:none;border-radius:10px;padding:12px;font-weight:700;cursor:pointer;color:#0b0d12;font-size:15px;">' + (deferredPrompt ? 'Install' : 'Got it') + '</button></div>';
  t.querySelector('[data-go]').onclick = async () => {
    if (deferredPrompt){ deferredPrompt.prompt(); try { await deferredPrompt.userChoice; } catch (e) {} deferredPrompt = null; }
    t.remove();
  };
  t.onclick = e => { if (e.target === t) t.remove(); };
  document.body.appendChild(t);
}
if (!EMBED && !STANDALONE && new URLSearchParams(location.search).has('install')){
  window.history.replaceState(null, '', location.pathname + location.hash);
  // Chrome fires beforeinstallprompt shortly after load; give it a moment.
  setTimeout(showInstallSheet, 1200);
}

init();
})();
