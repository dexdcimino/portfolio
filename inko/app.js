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
const BUILD_FILES = ['/inko/app.js', '/inko/app.css', '/inko/index.html', '/inko/social.js', '/inko/social.css'];
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
/* The canvas stands on the bars with one even gap under it (Dex,
   2026-10-08): the stage's margin is whatever the bars -- and the canvas
   colour window, when it is open -- take up right now, so opening the
   sliders lifts the canvas instead of covering it. */
/* Measured from the panels' own boxes, not from innerHeight: on a phone the
   fixed bars sit on the VISIBLE bottom while 100dvh, innerHeight and the
   flow can each disagree with it by the browser's own bar, and the canvas
   ended up under the size bar and the sliders (Dex, 2026-10-08). The stage
   is fixed too, so it shares the bars' coordinates exactly. */
const GAP = 8;
function fit(){
  const bb = $('bottom-bars').getBoundingClientRect();
  let panelsTop = bb.top;
  if (brushPop.classList.contains('open')) panelsTop = Math.min(panelsTop, brushPop.getBoundingClientRect().top);
  const top = $('topbar').getBoundingClientRect().bottom;
  const st = $('stage').style;
  st.top = top + 'px';
  st.bottom = Math.max(0, bb.bottom - panelsTop) + 'px';
  const availW = Math.min(window.innerWidth*0.94, 460);
  const availH = panelsTop - GAP - top - 6;
  const k = Math.max(0.2, Math.min(availW/W, availH/H));
  fitK = k;
  canvas.style.width = (W*k)+'px'; canvas.style.height = (H*k)+'px';
  placeSymTick();
}
/* Symmetry on (Dex, 2026-10-08): a short tick across the top centre of the
   canvas -- 6px above it, 10px into it -- instead of a dashed line through
   the whole drawing. Placed from the frame's box, so it follows fit(). */
function placeSymTick(){
  const t = $('sym-tick');
  t.hidden = !mirrorOn;
  if (!mirrorOn) return;
  const st = $('stage').getBoundingClientRect(), fr = $('canvas-frame').getBoundingClientRect();
  t.style.left = (fr.left + fr.width / 2 - st.left) + 'px';
  t.style.top = (fr.top - st.top - 6) + 'px';
}
function render(){
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = bgCss(); ctx.fillRect(0,0,W,H);
  ctx.drawImage(sLayer, 0,0,W,H);
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
function pushHistory(sameStrokes){
  /* Undo is live the moment a stroke ends, not when its snapshot has
     finished encoding: the handler waits for the chain itself. Without this
     a quick tap right after drawing landed on a disabled button. */
  pendingPushes++;
  syncUndoRedo();
  // The canvas colour is part of a step (Dex, 2026-10-08): undo after a
  // colour change brings the previous colour back. Read now, not when the
  // chain gets here, so a fast change after a stroke is not folded into it.
  const bg = { h: bgH, s: bgS, b: bgB };
  historyChain = historyChain.then(async () => {
    // A colour step leaves the strokes alone: reuse their blob, encode nothing.
    const blob = (sameStrokes && latestBlob) || await canvasBlob(sLayer);
    const id = stepId();
    // On disk before anything can name it.
    await idbPut('steps', { id, blob, bg, ts: Date.now() }).catch(() => {});
    history = history.slice(0, step + 1);
    history.push({ id, blob, bg });
    if (history.length > HISTORY_MAX) history.shift();
    step = history.length - 1;
    latestBlob = blob;
  }).catch(() => {}).then(() => { pendingPushes--; syncUndoRedo(); try { picFollow(); } catch (e) {} });
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
  const bg = history[i].bg;           // steps written before colour was kept have none
  if (bg){ bgH = bg.h; bgS = bg.s; bgB = bg.b; refreshPanelUI(); }
  picFollow();
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
    out.push({ id, blob: s.blob, bg: s.bg });
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
titleInput.addEventListener('input', () => { dirty = true; scheduleDraft(); const t = document.getElementById('cp-title'); if (t) t.value = titleInput.value; });

/* ---------- toolbar ---------- */
function syncToolSel(){
  const isBrush = tool==='brush';
  $('toggle-brush-icon').classList.toggle('big', isBrush); $('toggle-brush-icon').classList.toggle('small', !isBrush);
  $('toggle-eraser-icon').classList.toggle('big', !isBrush); $('toggle-eraser-icon').classList.toggle('small', isBrush);
  $('tool-toggle').setAttribute('aria-label', isBrush ? 'Switch to eraser' : 'Switch to brush');
}
/* The swap, as two arcs rather than a straight trade (Dex, 2026-10-08): the
   small icon swings out right and down as it grows into the middle; the big
   one dips down and left before it rises into the corner, shrinking. Each
   keyframe is a point on its arc. The resting places are the CSS classes. */
const TOOL_BIG = 'translate(0px,0px) scale(1)', TOOL_SMALL = 'translate(-16px,-14px) scale(.46)';
function swapTools(){
  const grow = tool === 'brush' ? $('toggle-brush-icon') : $('toggle-eraser-icon');
  const shrink = grow === $('toggle-brush-icon') ? $('toggle-eraser-icon') : $('toggle-brush-icon');
  syncToolSel();
  if (!grow.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const opts = { duration: 420, easing: 'cubic-bezier(.45,.05,.25,1)' };
  grow.animate([
    { transform: TOOL_SMALL, opacity: .7 },
    { transform: 'translate(10px,-12px) scale(.62)', opacity: .85, offset: .35 },
    { transform: 'translate(12px,4px) scale(.86)', opacity: 1, offset: .7 },
    { transform: TOOL_BIG, opacity: 1 },
  ], opts);
  shrink.animate([
    { transform: TOOL_BIG, opacity: 1 },
    { transform: 'translate(-6px,12px) scale(.8)', opacity: .9, offset: .35 },
    { transform: 'translate(-20px,0px) scale(.6)', opacity: .8, offset: .7 },
    { transform: TOOL_SMALL, opacity: .7 },
  ], opts);
}
$('tool-toggle').addEventListener('click', e => {
  e.stopPropagation();
  closePop();
  tool = tool==='brush' ? 'eraser' : 'brush';
  swapTools(); refreshSizeUI();
});
$('color-btn').addEventListener('click', e => {
  e.stopPropagation();
  setColorMode(!colorMode);
});

$('sym-btn').addEventListener('click', () => {
  mirrorOn = !mirrorOn;
  $('sym-btn').classList.toggle('on', mirrorOn);
  $('sym-btn').setAttribute('aria-pressed', mirrorOn);
  placeSymTick();
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
/* The canvas changing, made visible: a copy of what is on screen is laid
   over the pad, the change happens under it, and the copy wipes away on a
   diagonal while the new canvas fades in. Returns the function that starts
   the wipe, so a caller can finish its work (or close the gallery) first. */
function snapPad(){
  const pad = $('pad');
  if (!pad.width || matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  const snap = document.createElement('canvas');
  snap.className = 'pad-snap'; snap.width = pad.width; snap.height = pad.height;
  snap.style.width = pad.clientWidth + 'px'; snap.style.height = pad.clientHeight + 'px';
  snap.getContext('2d').drawImage(pad, 0, 0);
  document.querySelectorAll('.pad-snap').forEach(el => el.remove());
  pad.parentNode.appendChild(snap);
  return () => requestAnimationFrame(() => {
    snap.classList.add('go');
    if (pad.animate) pad.animate([{ opacity: .3 }, { opacity: 1 }], { duration: 360, easing: 'ease-out' });
    const done = () => snap.remove();
    snap.addEventListener('animationend', done, { once: true });
    setTimeout(done, 700);
  });
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
async function newCanvas(){
  closePop();
  if (dirty){ try { await saveCurrent(); } catch (e) { return; } }
  await keepCanvasHistory();
  const wipe = snapPad();
  await startBlank();
  wipe();
  setOptions(false);
}
$('plus-btn').addEventListener('click', async () => { await newCanvas(); toast('New canvas created'); });
// From the gallery: straight into it, ready to draw.
$('g-new').addEventListener('click', async () => {
  await newCanvas();
  closeGallery();
  toast('New canvas created');
});

/* ---------- brush popover ---------- */
function placePop(){
  // Above the topmost bar, never over one: the options bar stays reachable.
  const bb = $('bottom-bars').getBoundingClientRect();
  brushPop.style.bottom = Math.max(8, bb.bottom - bb.top + 8) + 'px';
}
function closePop(){
  const was = brushPop.classList.contains('open'); popMode = null; brushPop.classList.remove('open');
  $('copt-btn').classList.remove('on'); $('copt-btn').setAttribute('aria-pressed', 'false');
  if (was) fit();
}
$('pop-x').addEventListener('click', e => { e.stopPropagation(); closePop(); });
document.addEventListener('pointerdown', e => {
  if (!popMode) return;
  if (brushPop.contains(e.target)) return;
  if (e.target.closest('#color-btn') || e.target.closest('#tool-toggle') || e.target.closest('#canvas-swatch') || e.target.closest('#copt-btn')) return;
  closePop();
});
document.addEventListener('touchstart', e => {
  if (!popMode) return;
  // Not on the swatch or the window: the swatch sits inside the 28px edge, so
  // a tap on it closed the window here and the click then opened it again --
  // the canvas jumping down and up on every tap (Dex, 2026-10-08).
  if (brushPop.contains(e.target) || e.target.closest('#canvas-swatch, #copt-btn')) return;
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
  $('copt-dot').style.background = bgCss();
  $('hue').value = hue; $('sat').value = sat; $('bri').value = bri;
  paintTracks('', hue, sat, bri);
  $('cv-hue').value = bgH; $('cv-sat').value = bgS; $('cv-bri').value = bgB;
  paintTracks('cv-', bgH, bgS, bgB);
  syncTopLock();
  const sz = tool==='eraser' ? eraserEff() : brushSize;
  $('size').value = sizeToSlider(sz);
  const tip = document.getElementById('brush-tip');
  if (tip) tip.setAttribute('fill', brushCss());
}
function refreshSizeUI(){
  const sz = tool==='eraser' ? eraserEff() : brushSize;
  $('size').value = sizeToSlider(sz);

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
    // Picking a colour means painting again (Dex, 2026-10-08).
    if (tool !== 'brush'){ tool = 'brush'; swapTools(); refreshSizeUI(); }
    showColorPreview(); refreshPanelUI();
  };
  const bg = () => {
    bgH = +$('cv-hue').value; bgS = +$('cv-sat').value; bgB = +$('cv-bri').value;
    render(); refreshPanelUI(); dirty = true; scheduleDraft();
  };
  for (const id of ['hue', 'sat', 'bri']) $(id).addEventListener('input', brush);
  for (const id of ['cv-hue', 'cv-sat', 'cv-bri']){
    $(id).addEventListener('input', bg);
    // One undo step per slider let go, not one per pixel of the drag.
    $(id).addEventListener('change', () => pushHistory(true));
  }
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
  if (popMode === 'canvas'){ closePop(); return; }
  openCanvasPop('canvas');
});
function openCanvasPop(mode){
  const opts = mode === 'canvas-opts';
  popMode = mode;
  $('cp-more').hidden = !opts;
  $('bp-title').textContent = opts ? 'Canvas' : 'Canvas color';
  if (opts){ $('cp-title').value = titleInput.value; syncTopLock(); }
  $('copt-btn').classList.toggle('on', opts); $('copt-btn').setAttribute('aria-pressed', String(opts));
  refreshPanelUI();
  brushPop.classList.add('open');
  placePop();
  fit();
}
$('cp-title').addEventListener('input', () => { titleInput.value = $('cp-title').value; dirty = true; scheduleDraft(); });
$('cp-lock').addEventListener('click', e => { e.stopPropagation(); flipCurrent($('cp-lock')); });

/* ---------- color/size mode toggle ---------- */
let colorMode = false;
function setColorMode(on){
  colorMode = on;
  if (on && optionsOn) setOptions(false, true);
  showBars();
  $('color-btn').classList.toggle('on', on);
  if(on) syncHSBInputs();
  fit();
}
/* Options (Dex, 2026-10-08): the size bar's place becomes the options bar --
   profile, gallery, new canvas, clear -- and anything else open closes. */
let optionsOn = false;
function showBars(){
  // Undo and redo go with whichever bar is up: either side of the sliders,
  // level with S, in colour mode (Dex, 2026-10-08) -- the same two buttons.
  const host = colorMode ? $('hsb-bar') : $('size-bar');
  if ($('redo-btn').parentNode !== host){
    host.insertBefore($('redo-btn'), host.querySelector(colorMode ? '.hsb-rows' : '.ctl'));
    host.appendChild($('undo-btn'));
  }
  $('size-bar').style.display = colorMode || optionsOn ? 'none' : 'flex';
  $('hsb-bar').style.display = colorMode ? 'flex' : 'none';
  $('opt-bar').hidden = !optionsOn;
}
function setOptions(on, quiet){
  optionsOn = on;
  if (on){ closePop(); if (eyedropperOn) setEyedropper(false); if (colorMode){ colorMode = false; $('color-btn').classList.remove('on'); } }
  $('opt-btn').classList.toggle('on', on);
  $('opt-btn').setAttribute('aria-pressed', String(on));
  if (!quiet){ showBars(); fit(); }
}
$('opt-btn').addEventListener('click', e => { e.stopPropagation(); setOptions(!optionsOn); });
/* H, S or B named while you touch it, centred above its panel. */
{
  const NAMES = { hue: ['Hue', '°'], sat: ['Saturation', '%'], bri: ['Brightness', '%'] };
  const timers = new WeakMap();
  const showTip = input => {
    const kind = input.id.replace('cv-', ''), [name, unit] = NAMES[kind];
    const tip = input.closest('#hsb-bar, #brush-pop').querySelector('.hsb-tip');
    tip.textContent = `${name} ${Math.round(+input.value)}${unit}`;
    tip.hidden = false;
    clearTimeout(timers.get(tip));
    timers.set(tip, setTimeout(() => { tip.hidden = true; }, 3200));
  };
  for (const id of ['hue', 'sat', 'bri', 'cv-hue', 'cv-sat', 'cv-bri']){
    const input = $(id);
    for (const ev of ['pointerdown', 'input']) input.addEventListener(ev, () => showTip(input));
    // The letter too.
    const lbl = input.parentNode.querySelector('.hsb-lbl');
    if (lbl) lbl.addEventListener('pointerdown', () => showTip(input));
  }
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
// Select mode (see "select mode" below): on, the ids picked, and a hold that just fired.
let selecting = false, holdFired = false;
const selected = new Set();
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
async function fullBlob(it, isLive){
  const t = document.createElement('canvas'); t.width = W; t.height = H;
  const c = t.getContext('2d');
  const bg = isLive ? { h: bgH, s: bgS, b: bgB } : (it.bg || { h: 0, s: 0, b: 100 });
  c.fillStyle = hsbToCss(bg.h, bg.s, bg.b, 1); c.fillRect(0,0,W,H);
  if (isLive) c.drawImage(sLayer, 0,0,W,H);
  else if (it.png){ const bmp = await createImageBitmap(it.png); c.drawImage(bmp, 0,0,W,H); bmp.close && bmp.close(); }
  return canvasBlob(t);
}
async function downloadItem(it, isLive, quiet){
  saveBlob(await fullBlob(it, isLive), isLive ? titleInput.value : it.title);
  if (!quiet) toast('Downloaded');
}
function saveBlob(blob, title){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(title);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
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
/* Delete one of your canvases everywhere it is: the shared gallery, this
   device, its kept undo history, and the account's copy. False if it stayed. */
async function deleteCanvas(it){
  if (it.visibility === 'public'){
    try { await api('unpublish', { id: it.id }); }
    catch (err) { toast('Could not take it out of the shared gallery: ' + err.message); return false; }
  }
  try { await idbDel('canvases', it.id); }
  catch (err) { toast('Could not delete it.'); return false; }
  idbDel('meta', 'hist:' + it.id).then(gcSteps).catch(() => {});
  // On every device (later, if offline).
  if (scope !== 'local'){
    const sc = scope, ts = Date.now();
    api('canvas-delete', { id: it.id, ts }).catch(() => queueDelete(sc, it.id, ts));
  }
  gallery = gallery.filter(g => g.id !== it.id);
  // Deleting the canvas on screen leaves a fresh one, not a ghost of it.
  if (editingId === it.id) await startBlank();
  return true;
}
/* One card's buttons out at a time. */
function setTileOpts(div, on){
  if (on) for (const o of $('g-rows').querySelectorAll('.g-item.opts')) if (o !== div) setTileOpts(o, false);
  div.classList.toggle('opts', on);
  const b = div.querySelector('.g-opt'); if (b) b.setAttribute('aria-expanded', String(on));
}
function makeItem(it, isLive){
  const div = document.createElement('div'); div.className = 'g-item' + (!isLive && it.id === editingId ? ' current' : '') + (selected.has(it.id) ? ' sel' : '');
  if (!isLive) div.dataset.id = it.id;
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
    div.addEventListener('click', () => closeGallery());
  } else {
    del.addEventListener('click', e => {
      e.stopPropagation();
      const shared = it.visibility === 'public';
      openModal('Delete canvas?', `"${it.title}" will be permanently deleted${shared ? ', and taken out of the shared gallery' : ''}.`, 'Delete', async () => {
        if (await deleteCanvas(it)){ toast('Canvas deleted'); renderGallery(); }
      });
    });
    if (it.thumb) img.src = blobUrl(it.thumb);
    else if (it.png) thumbBlob(it.png, it.bg).then(b => { it.thumb = b; img.src = blobUrl(b); idbPut('canvases', it).catch(() => {}); });
    div.addEventListener('click', () => {
      if (holdFired){ holdFired = false; return; }
      if (div.classList.contains('opts')){ setTileOpts(div, false); return; }   // a tap off its buttons folds them
      if (selecting){ toggleSel(it.id); return; }
      picking ? openCrop(it) : openCanvas(it.id);
    });
    const tick = document.createElement('span'); tick.className = 'g-check'; th.appendChild(tick);
    // Public or private, on the card: the lock is this device only, the globe
    // is the shared gallery.
    const pub = document.createElement('button'); pub.className = 'g-pub';
    paintPubButton(pub, it);
    pub.addEventListener('click', e => { e.stopPropagation(); toggleVisibility(it, pub); });
    th.appendChild(pub);
    // The one button on the card; the others come out of it (see .g-opt).
    const opt = document.createElement('button'); opt.className = 'g-opt';
    opt.setAttribute('aria-label', 'Canvas options'); opt.setAttribute('aria-expanded', 'false');
    opt.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><circle cx="17" cy="17" r="3.6" fill="currentColor" stroke="none"/></svg>';
    opt.addEventListener('click', e => { e.stopPropagation(); setTileOpts(div, !div.classList.contains('opts')); });
    th.appendChild(opt);
  }
  th.appendChild(dl); th.appendChild(del);
  const cap = document.createElement('div'); cap.className = 'g-title';
  cap.textContent = isLive ? (titleInput.value.trim() || 'Untitled') + ' • live' : it.title;
  div.appendChild(th); div.appendChild(cap);
  return div;
}
function renderGallery(){
  if (searching() || galleryTab !== 'mine') return;
  paintProfile();
  thumbUrls.forEach(u => URL.revokeObjectURL(u)); thumbUrls = [];
  const rows = $('g-rows'); rows.innerHTML = '';
  $('g-count').textContent = gallery.length + (gallery.length===1 ? ' canvas' : ' canvases');
  // Oldest at the top left, NEWEST AT THE BOTTOM RIGHT (Dex, 2026-10-08):
  // rows are cut from the newest end, so the last row is always full and a
  // new canvas pushes the rest left and up; a short row is the top one,
  // sitting to the right.
  const items = [...gallery].sort((a, b) => (a.created || a.ts) - (b.created || b.ts));
  const short = items.length % 3;
  for (let i = short ? short - 3 : 0; i < items.length; i += 3){
    const row = document.createElement('div'); row.className = 'g-row' + (i < 0 ? ' short' : '');
    items.slice(Math.max(0, i), i + 3).forEach(it => row.appendChild(makeItem(it, false)));
    rows.appendChild(row);
  }
  $('g-grid').scrollTop = 0;   // the profile first
}
async function openCanvas(id){
  if (dirty) await saveCurrent().catch(() => {});
  await keepCanvasHistory();
  const it = gallery.find(g => g.id === id);
  if (!it || !it.png) return;
  const wipe = snapPad();
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
  closeGallery();
  refreshPanelUI();
  wipe();
}
$('grid-btn').addEventListener('click', async () => {
  closePop();
  // The card for the canvas on screen shows what is on it now.
  if (dirty) await saveCurrent().catch(() => {});
  // Someone else's profile is a stop on the way, not a place to come back to.
  setGalleryTab(galleryTab === 'user' ? 'public' : galleryTab);
  setOptions(false);
  openGallery();
});
$('dl-btn').addEventListener('click', () => downloadItem(null, true));
// The canvas window from down here: colour, title and public/private.
$('copt-btn').addEventListener('click', e => {
  e.stopPropagation();
  if (popMode === 'canvas-opts'){ closePop(); return; }
  openCanvasPop('canvas-opts');
});
// Clear asks first; undo brings it back (clearCanvas is one history step).
$('clear-btn').addEventListener('click', () => {
  // ...and it becomes the newest canvas, at the bottom right of the gallery,
  // wherever it was (Dex, 2026-10-08). Same canvas underneath, so undo works.
  openModal('Clear this canvas?', 'Undo brings it back.', 'Clear', () => {
    const it = currentItem(); if (it) it.created = Date.now();
    clearCanvas(); setOptions(false);
    saveCurrent().catch(() => {});
  });
});
/* Back: out of a search, out of picking a picture, from an artist back to
   Public -- and otherwise to the canvas. */
$('g-back').addEventListener('click', () => {
  if (selecting){ exitSelect(); return; }
  if (searching()){ clearSearch(); return; }
  if (picking){ setPicking(false); return; }
  if (canStepBack()){ window.history.back(); return; }
  if (galleryTab === 'user'){ setGalleryTab('public'); return; }
  closeGallery();
});

/* ---------- toast ---------- */
let toastT = null;
function toast(msg, sub){
  // Two short lines when there is a second; centred under the title, or low over the gallery.
  if (sub){ const b = document.createElement('b'), s = document.createElement('small'); b.textContent = msg; s.textContent = sub; toastEl.replaceChildren(b, s); }
  else toastEl.textContent = msg;
  const low = $('gallery').classList.contains('open');
  toastEl.classList.toggle('low', low);
  // Low clears the top it was given under the title: an inline top beat the
  // class's top:auto, and with its bottom set too the box ran from one to the other.
  toastEl.style.top = low ? '' : ($('title-input').getBoundingClientRect().bottom + 10) + 'px';
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
let galleryTab = 'mine', feed = [], myVoteFor = {}, feedLoaded = false;
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
  // The picture comes along too: it is cut from one of those canvases.
  const pic = await idbGet('meta', 'avatar:local').catch(() => null);
  if (pic && !(await idbGet('meta', 'avatar:' + next).catch(() => null))){
    await idbPut('meta', { ...pic, key: 'avatar:' + next, sent: false });
    await idbDel('meta', 'avatar:local');
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
  loadMyPic().catch(e => console.warn('inko: picture', e));
}
function syncAccountButton(){
  const b = $('g-account'); if (!b) return;
  b.textContent = session ? '@' + session.handle : 'Sign in';
  b.classList.toggle('signed', !!session);
  b.setAttribute('aria-label', session ? 'Edit @' + session.handle : 'Sign in');
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
    try { await publishItem(it); toast('This canvas is now public', 'Shared in the online gallery'); } catch (e) { toast(e.message); }
  }
  syncTopLock();
  if ($('gallery').classList.contains('open') && galleryTab === 'mine') renderGallery();
}
async function toggleVisibility(it, btn){
  if (!session){ rememberPublish(it.id); openAccount(); return; }
  btn.disabled = true;
  try {
    if (it.visibility === 'public'){ await unpublishItem(it); toast('This canvas is now private', 'Only you can see it'); }
    else { await publishItem(it); toast('This canvas is now public', 'Shared in the online gallery'); }
  } catch (e) { toast(e.message); }
  btn.disabled = false;
  paintPubButton(btn, it);
  syncTopLock();
  if (btn.id === 'top-lock' && $('gallery').classList.contains('open') && galleryTab === 'mine') renderGallery();
}
/* The lock at the top right is the canvas on screen's own public/private
   switch, the same one its gallery card carries. */
const currentItem = () => (editingId ? gallery.find(g => g.id === editingId) : null);
function syncTopLock(){
  for (const id of ['top-lock', 'cp-lock']){ const b = $(id); if (b) paintPubButton(b, currentItem() || { visibility: 'private' }); }
}
async function flipCurrent(btn){
  if (dirty || !currentItem()){ try { await saveCurrent(); } catch (err) { return; } }
  const it = currentItem();
  if (it) toggleVisibility(it, btn);
}
$('top-lock').addEventListener('click', e => { e.stopPropagation(); closePop(); flipCurrent($('top-lock')); });
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
    const got = await r.json();
    feed = got.posts || []; feedLoaded = true;
    feedAvatars = got.avatars || {};
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
  inkoEvent('feed');
}
const imgUrl = (p, thumb) => `${API}?img=${encodeURIComponent(`sketch/img/${p.id}-${p.v}${thumb ? '-t.jpg' : '.webp'}`)}`;
/* Never hide your OWN drawings: "Hide @you" was offered on them while
   signed out, and once taken, every drawing you published vanished from your
   Public tab for good. */
function visibleFeed(){ return feed.filter(p => !blocked.includes(p.handle) || (session && session.handle === p.handle)); }
/* Cards in rows: three across for your own canvases, TWO for public drawings
   (Dex, 2026-10-08: the artist's face and @tag have to be readable on them). */
function fillRows(items, per, make){
  const rows = $('g-rows');
  for (let i = 0; i < items.length; i += per){
    const row = document.createElement('div'); row.className = 'g-row' + (per === 2 ? ' two' : '');
    items.slice(i, i + per).forEach(x => row.appendChild(make(x)));
    rows.appendChild(row);
  }
}
let gridPosts = [];                 // the public drawings on screen, in order: what the viewer swipes through
function renderFeed(){
  if (searching() || galleryTab !== 'public') return;
  const rows = $('g-rows'); rows.innerHTML = '';
  const filter = inkoBridge.feedFilter;     // inko/social.js: Following, or the ones you gave fire
  const items = filter ? visibleFeed().filter(filter.keep) : visibleFeed();
  gridPosts = items;
  $('g-count').textContent = items.length + (items.length === 1 ? ' drawing' : ' drawings');
  if (!items.length){
    const e = document.createElement('div'); e.className = 'g-empty';
    e.textContent = filter ? filter.empty : 'Nothing shared yet. Make one of your drawings public to start it off.';
    rows.appendChild(e); return;
  }
  fillRows(items, 2, feedItem);
  $('g-grid').scrollTop = 0;
}
const rxIcon = kind => { const i = document.createElement('span'); i.className = 'rx-ico'; i.dataset.icon = kind; return i; };
/* Poop | fire, one pill (the viewer's). Grey until you rate; then the one you
   chose is in colour with its count, and only that count shows. */
function reactionRow(p){
  const wrap = document.createElement('div'); wrap.className = 'g-react';
  const pill = document.createElement('div'); pill.className = 'rx-pill';
  const mine = myVoteFor[p.id] || null;
  for (const kind of ['poop', 'fire']){
    const b = document.createElement('button');
    b.className = 'g-rx' + (mine === kind ? ' on' : '');
    b.dataset.kind = kind;
    b.setAttribute('aria-label', kind === 'fire' ? 'Fire' : 'Poop');
    b.setAttribute('aria-pressed', String(mine === kind));
    const n = document.createElement('b'); n.textContent = mine === kind ? String(p[kind] || 0) : '';
    b.append(rxIcon(kind), n);
    b.addEventListener('click', e => { e.stopPropagation(); react(p, kind); });
    pill.appendChild(b);
  }
  wrap.appendChild(pill);
  return wrap;
}
/* A public tile is the drawing and nothing under it: the artist (face and
   @tag) along its foot, the fire count in its corner. Tapping the artist
   opens their profile; anywhere else, the drawing. */
function fireBadge(p){
  const f = document.createElement('div'); f.className = 'p-fire';
  f.append(rxIcon('fire'), String(p.fire || 0));
  return f;
}
function feedItem(p){
  const div = document.createElement('div'); div.className = 'g-item p-item'; div.dataset.post = p.id;
  const th = document.createElement('div'); th.className = 'g-thumb';
  const img = document.createElement('img'); img.alt = p.title || ''; img.loading = 'lazy'; img.src = imgUrl(p, true);
  const by = document.createElement('div'); by.className = 'p-by';
  const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = '@' + p.handle;
  by.append(avatarEl(p.handle, 'mid'), tag);
  by.addEventListener('click', e => { e.stopPropagation(); openUser(p.handle); });
  th.append(img, fireBadge(p), by);
  div.append(th);
  div.addEventListener('click', () => openViewer(p, gridPosts));
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
  document.querySelectorAll(`#viewer[data-post="${p.id}"] .g-react`).forEach(el => el.replaceWith(reactionRow(p)));
  document.querySelectorAll(`[data-post="${p.id}"] .p-fire`).forEach(el => el.replaceWith(fireBadge(p)));
}

/* ---- the viewer ----
   An overlay over the grid it came from, holding that grid's list: swipe up
   for the next drawing, down for the one before, right to left (or the
   phone's own back gesture, see "back") to go back to the grid. */
let viewerList = [], viewerAt = 0;
function showPost(p){
  p = canonical(p);
  const v = $('viewer');
  v.dataset.post = p.id;
  $('v-img').src = imgUrl(p, false);
  $('v-img').alt = p.title || '';
  $('v-title').textContent = p.title;
  const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = '@' + p.handle;
  $('v-by').replaceChildren(avatarEl(p.handle, 'mid'), tag);
  $('v-by').onclick = () => { closeViewer(); openUser(p.handle); };
  const old = v.querySelector('.g-react'); if (old) old.replaceWith(reactionRow(p));
  const mine = session && session.handle === p.handle;
  $('v-more').hidden = !!mine; $('v-acts').hidden = true;
  $('v-report').onclick = () => { $('v-acts').hidden = true; openModal('Report this drawing?', 'Three reports take it down until it is reviewed.', 'Report', async () => {
    if (!session){ openAccount(); return; }
    try { const r = await api('report', { id: p.id }); toast(r.hidden ? 'Reported — it has been taken down' : 'Reported — thank you'); }
    catch (e) { toast(e.message); }
  }); };
  inkoEvent('post', { post: p });
  $('v-block').onclick = () => { $('v-acts').hidden = true; openModal('Hide @' + p.handle + '?', 'You will not see their drawings on this device.', 'Hide', () => {
    blocked = [...new Set([...blocked, p.handle])];
    try { localStorage.setItem(BLOCK_KEY, JSON.stringify(blocked)); } catch (e) {}
    closeViewer(); renderFeed(); toast('Hidden');
  }); };
}
function openViewer(p, list){
  viewerList = (list && list.length ? list : [p]).map(canonical);
  viewerAt = Math.max(0, viewerList.findIndex(x => x.id === p.id));
  showPost(viewerList[viewerAt] || p);
  if (!$('viewer').classList.contains('open')){ $('viewer').classList.add('open'); syncHistory(); }
}
function closeViewer(){
  if (!$('viewer').classList.contains('open')) return;
  $('viewer').classList.remove('open'); $('v-img').removeAttribute('src'); $('v-acts').hidden = true;
  syncHistory();
}
$('v-close').addEventListener('click', () => closeViewer());
$('v-more').addEventListener('click', e => { e.stopPropagation(); $('v-acts').hidden = !$('v-acts').hidden; });
/* Next / previous: the drawing slides out the way the finger went and the
   new one follows it in. */
let stepping = false;
async function stepViewer(dir){
  const at = viewerAt + dir;
  if (stepping || at < 0 || at >= viewerList.length){ bounce(dir); return; }
  stepping = true;
  const img = $('v-img'), h = $('v-stage').clientHeight;
  const out = img.animate ? img.animate([{ transform: img.style.transform || 'none', opacity: 1 }, { transform: `translateY(${-dir * h * 0.6}px)`, opacity: 0 }], { duration: 170, easing: 'ease-in' }) : null;
  if (out) await out.finished.catch(() => {});
  viewerAt = at; showPost(viewerList[at]); img.style.transform = '';
  if (img.animate) await img.animate([{ transform: `translateY(${dir * h * 0.6}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 230, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished.catch(() => {});
  stepping = false;
}
function bounce(dir){
  const img = $('v-img');
  img.style.transform = '';
  if (img.animate) img.animate([{ transform: 'none' }, { transform: `translateY(${-dir * 18}px)` }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });
}
{
  let start = null;
  const stage = $('viewer');
  stage.addEventListener('pointerdown', e => {
    if (e.target.closest('button') || !$('viewer').classList.contains('open')) return;
    start = { x: e.clientX, y: e.clientY, t: Date.now() };
  });
  stage.addEventListener('pointermove', e => {
    if (!start || stepping) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    // The drawing follows the finger, so the swipe feels held.
    $('v-img').style.transform = Math.abs(dy) > Math.abs(dx) ? `translateY(${dy * 0.5}px)` : `translateX(${Math.min(0, dx) * 0.5}px)`;
  });
  const end = e => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx)) { stepViewer(dy < 0 ? 1 : -1); return; }
    if (dx < -70 && Math.abs(dx) > Math.abs(dy)) { $('v-img').style.transform = ''; closeViewer(); return; }
    const img = $('v-img'); const from = img.style.transform; img.style.transform = '';
    if (from && img.animate) img.animate([{ transform: from }, { transform: 'none' }], { duration: 180, easing: 'ease-out' });
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', () => { start = null; $('v-img').style.transform = ''; });
}

/* ---- back ----
   The phone's back gesture (Android's swipe in from the edge) follows the
   way you came, like a browser, but short (Dex, 2026-10-08):
   - `trail` holds the last two places, newest last: 'canvas', 'mine',
     'public' or 'user:<handle>'. Back goes to the one before; with only one
     left, back leaves the app. So from anywhere, two backs at most get you
     out, and an open drawing (the viewer) or a sheet is one more on top.
   - Opening the app counts as having come from your gallery: the first back
     from the canvas opens the gallery, the second leaves.
   - Going to a place moves it to the end. The canvas goes to the end even
     when it was the one before, because a canvas opened from the gallery
     must go back to the gallery (and the gallery opened from a canvas, to
     the canvas). Between gallery pages, going to the one before is a step
     back instead (Public -> Mine, then back leaves, never to Public), so
     they never ping-pong.
   The page's history carries one entry per step back (`syncHistory`). Off
   inside the site's overlay, whose frame shares the site's history; and
   nothing is pushed until the first touch, because Chrome skips entries a
   page added before anyone touched it. */
const NO_HISTORY = EMBED || window.top !== window;
// An open sheet is one more step: back closes it (and counts as Cancel).
const SHEETS = ['crop', 'account', 'modal', 'g-sel', 'g-find'];
const sheetOpen = id => id === 'g-find' ? searching() : $(id).classList.contains('open');
if (window.MutationObserver) for (const id of [...SHEETS.slice(0, 4), 'gallery']) new MutationObserver(() => syncHistory()).observe($(id), { attributes: true, attributeFilter: ['class'] });
let trail = ['mine', 'canvas'], navDepth = 0, skipPops = 0, restoring = false, touched = false;
const placeNow = () => !$('gallery').classList.contains('open') ? 'canvas' : galleryTab === 'user' ? 'user:' + viewingUser : galleryTab;
function visit(place){
  if (restoring) return;
  const n = trail.length;
  if (place === trail[n - 1]) return;
  if (place !== 'canvas' && trail[n - 1] !== 'canvas' && place === trail[n - 2]) trail.pop();
  else { trail = trail.filter(p => p !== place); trail.push(place); if (trail.length > 2) trail = trail.slice(-2); }
  syncHistory();
}
function syncHistory(){
  if (NO_HISTORY || !touched) return;
  const want = trail.length - 1 + ($('viewer').classList.contains('open') ? 1 : 0)
    + SHEETS.filter(sheetOpen).length;
  try {
    while (navDepth < want){ window.history.pushState({ inko: navDepth + 1 }, ''); navDepth++; }
    if (navDepth > want){ const n = navDepth - want; navDepth = want; skipPops++; window.history.go(-n); }
  } catch (e) {}
}
for (const ev of ['pointerdown', 'keydown']){
  window.addEventListener(ev, () => {
    if (touched) return;
    touched = true;
    // The entry the app opened on is step 0 (a reload keeps the state a pushed entry had).
    if (!NO_HISTORY) try { window.history.replaceState({ inko: 0 }, ''); } catch (e) {}
    syncHistory();
  }, { capture: true });
}
/* Show a place on the trail without walking it again. */
function showPlace(place){
  restoring = true;
  try {
    if (place === 'canvas'){ closeGallery(); return; }
    $('gallery').classList.add('open');
    if (place.startsWith('user:')) openUser(place.slice(5));
    else setGalleryTab(place);
  } finally { restoring = false; }
}
/* The gallery's own back arrow walks the same trail. */
const canStepBack = () => !NO_HISTORY && touched && trail.length > 1 && navDepth > 0;
window.addEventListener('popstate', () => {
  if (skipPops > 0){ skipPops--; return; }
  navDepth = Math.max(0, navDepth - 1);
  // A sheet is closed first: that was its step.
  const sheet = SHEETS.find(sheetOpen);
  if (sheet){
    if (sheet === 'g-sel') exitSelect();
    else if (sheet === 'g-find') clearSearch();
    else $(sheet).classList.remove('open');
    if (sheet === 'account') afterSignIn = null;
    syncHistory(); return;
  }
  if ($('viewer').classList.contains('open')){ closeViewer(); return; }
  if (trail.length > 1){ trail.pop(); showPlace(trail[trail.length - 1]); }
  syncHistory();
});
function openGallery(){
  if ($('gallery').classList.contains('open')) return;
  $('gallery').classList.add('open');
  toastEl.classList.remove('show');   // a canvas toast belongs under the canvas's title, not over the gallery
  visit(placeNow());
}
function closeGallery(){
  if (!$('gallery').classList.contains('open')) return;
  closeViewer();
  exitSelect();
  if (searching()) clearSearch(true);
  $('gallery').classList.remove('open');
  visit('canvas');
}

/* ---- the account sheet ---- */
let afterSignIn = null;
function openAccount(then, message){
  afterSignIn = then || null;
  const signed = !!session;
  $('a-in').hidden = signed; $('a-out').hidden = !signed; $('a-claim').hidden = true;
  if (signed){
    $('a-who').textContent = '@' + session.handle;
    $('a-rename').value = session.handle; $('a-msg4').textContent = '';
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

/* Google and Discord sign in to the SITE account (/account/site-auth.js), the
   one dexcimino.com shares between DexNote, Inko and whatever comes next. Its
   ID token is shown to /api/sketch, which finds the Inko account linked to it
   -- or to the same Google or Discord, for an account made here before the
   site account existed -- or asks for a name (the claim sheet).

   A popup works inside the site's overlay too: the homepage sends
   Cross-Origin-Opener-Policy: same-origin-allow-popups, as /inko/ does.

   The old way stays as the fallback: a real navigation to
   /api/sketch-auth/<provider>, back to /inko/ with the result in the URL
   fragment (in a new tab inside the overlay, whose session then reaches the
   frame through localStorage -- see the storage listener below). It is what a
   failed site sign-in falls back to, so a site account that cannot sign in
   here yet never leaves Inko unable to. */
let siteAuth = null;
const loadSite = () => (siteAuth ||= import('/account/site-auth.js'));
const FRAMED = EMBED || window.top !== window.self;   // the overlay loads /inko/ without ?embed

async function linkSite(quiet){
  const site = await loadSite();
  const idToken = await site.idToken();
  if (!idToken) return false;
  const r = await api('site', { idToken });
  if (r.token){
    setSession({ handle: r.handle, token: r.token, sso: true, site: true });
    if ($('account').classList.contains('open')) closeAccount();
    if (!quiet) toast('Signed in as @' + r.handle);
    return true;
  }
  // Signed in to the site but no Inko name yet. On a quiet boot nobody asked,
  // so the sheet waits until they do.
  if (!quiet && r.ticket) openClaim(r.ticket, r.suggest || '');
  return false;
}

for (const id of ['a-google', 'a-discord']){
  $(id).addEventListener('click', async e => {
    e.preventDefault();
    const href = $(id).getAttribute('href');
    const which = id === 'a-google' ? 'google' : 'discord';
    try {
      await (await loadSite()).signIn(which);
      await linkSite(false);
      return;
    } catch (err) {
      if (siteAuth && (await siteAuth).cancelled(err)) return;
      console.warn('inko: site sign-in failed, using the Inko sign-in', err);
    }
    if (FRAMED){ window.open(href, '_blank', 'noopener'); return; }
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
    openGallery();
    const why = params.get('why');
    openAccount(null, (AUTH_ERRORS[params.get('auth-error')] || 'Sign-in did not work. Try again.') + (why ? ` (${why})` : ''));
  }
}
function openClaim(ticket, suggest){
  openGallery();
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
$('a-signout').addEventListener('click', () => {
  // A site sign-in is signed out of the whole site, as it was signed in to it.
  if (session && session.site) loadSite().then(m => m.signOut()).catch(e => console.warn('inko: site sign-out', e));
  setSession(null); closeAccount(); toast('Signed out'); if (galleryTab === 'public') renderFeed();
});
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

/* ---- where the gallery is: yours, Public, or one artist's ---- */
// Named at the top, so you always know which page this is.
function paintPage(){
  $('g-page').textContent = searching() ? 'Search' : galleryTab === 'public' ? 'Public' : galleryTab === 'user' ? '@' + (viewingUser || '') : 'Your gallery';
}
function setGalleryTab(tab){
  if (tab !== 'mine') setPicking(false);
  exitSelect();
  if (searching()) clearSearch(true);
  galleryTab = tab;
  const g = $('gallery');
  for (const m of ['mine', 'public', 'user']) g.classList.toggle('mode-' + m, tab === m);
  $('g-tab-mine').classList.toggle('on', tab === 'mine');
  // One square, Public <-> yours: it shows where it takes you -- the globe
  // out to Public, the gallery icon back to your own (Dex, 2026-10-08).
  $('g-tab-public').innerHTML = tab === 'public' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7.5" y="2.5" width="14" height="14" rx="3.2"/><path d="M16.5 21.5H6A3.5 3.5 0 0 1 2.5 18V7.5"/><path d="M7.8 13.6l3.6-3.6 2.8 2.8 1.9-1.9 5 5"/><circle cx="16.6" cy="7.4" r="1.5" fill="currentColor" stroke="none"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>';
  $('g-tab-public').dataset.go = tab === 'public' ? 'mine' : 'public';
  $('g-tab-public').setAttribute('aria-label', tab === 'public' ? 'Your drawings' : 'Public drawings');
  paintPage();
  $('g-account').hidden = tab !== 'mine';
  $('g-user-name').hidden = tab !== 'user';
  $('g-rows').innerHTML = '';
  if (tab === 'public') loadFeed();
  else if (tab === 'mine') renderGallery();
  if (tab !== 'user' && $('gallery').classList.contains('open')) visit(tab);
  inkoEvent('tab', { tab });
}
$('g-tab-mine').addEventListener('click', () => setGalleryTab('mine'));
$('g-tab-public').addEventListener('click', () => setGalleryTab(galleryTab === 'public' ? 'mine' : 'public'));
syncAccountButton();
// Yours until told otherwise; the classes are what show the profile header.
$('gallery').classList.add('mode-mine'); $('g-tab-mine').classList.add('on');

/* ---------- profiles ----------
   Your profile IS your gallery: the picture square at the bottom right
   opens it, with your picture over your canvases and your @tag under it.
   Anyone else's is their picture over the drawings they made public.

   THE PICTURE IS ONE OF YOUR CANVASES (Dex, 2026-10-08). Tap your picture,
   tap a canvas, place a square on it: that square is your picture, and it
   KEEPS UP -- every stroke, undo or colour change on that canvas redraws it
   (picFollow), and signed in, sends it to the account a moment after you
   stop. Until you choose one, you are the smiley. The choice (which canvas,
   which square) is kept per account in meta `avatar:<scope>` with the
   rendered picture, and on the server for an account, so another phone
   follows the same canvas. */
const SMILEY = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#1a1f2b"/><circle cx="32" cy="32" r="22" fill="#ffd23f"/><circle cx="24.5" cy="27" r="3.2" fill="#1a1f2b"/><circle cx="39.5" cy="27" r="3.2" fill="#1a1f2b"/><path d="M22 37 Q32 47 42 37" stroke="#1a1f2b" stroke-width="3.6" fill="none" stroke-linecap="round"/></svg>');
const PIC = 256;
let feedAvatars = {};               // handle -> picture version, from the feed
let myPic = null;                   // { canvas, crop, blob } for the scope on screen
let myPicUrl = null;
const avatarSrc = (h, v) => (v ? `${API}?img=${encodeURIComponent(`sketch/avatars/${h}-${v}.jpg`)}` : SMILEY);
function picFor(handle){
  if (session && handle === session.handle && myPicUrl) return myPicUrl;
  return avatarSrc(handle, feedAvatars[handle]);
}
function avatarEl(handle, size){
  const a = document.createElement('span'); a.className = 'avatar ' + size;
  a.style.backgroundImage = `url("${picFor(handle)}")`;
  return a;
}
function paintMyPic(){
  if (myPicUrl) URL.revokeObjectURL(myPicUrl);
  myPicUrl = myPic && myPic.blob ? URL.createObjectURL(myPic.blob) : null;
  $('g-tab-mine').style.backgroundImage = `url("${myPicUrl || SMILEY}")`;
  if (galleryTab === 'mine') $('g-avatar').style.backgroundImage = `url("${myPicUrl || SMILEY}")`;
  $('g-pick-smiley').hidden = !myPic;
}
function paintProfile(){
  if (galleryTab === 'mine'){
    $('g-avatar').style.backgroundImage = `url("${myPicUrl || SMILEY}")`;
    $('g-avatar').setAttribute('aria-label', 'Change your profile picture');
  }
}
/* A 256px square from a canvas's strokes and colour. */
async function renderPic(png, bg, crop){
  const t = document.createElement('canvas'); t.width = PIC; t.height = PIC;
  const c = t.getContext('2d');
  c.fillStyle = hsbToCss(bg.h, bg.s, bg.b, 1); c.fillRect(0, 0, PIC, PIC);
  const bmp = await createImageBitmap(png);
  const kx = bmp.width / W, ky = bmp.height / H;   // strokes are kept at the device's pixel ratio
  c.drawImage(bmp, crop.x * kx, crop.y * ky, crop.size * kx, crop.size * ky, 0, 0, PIC, PIC);
  bmp.close && bmp.close();
  return canvasBlob(t, 'image/jpeg', 0.86);
}
const picKey = () => 'avatar:' + scope;
let picUploadT = null;
async function savePic(rec, upload){
  myPic = rec;
  if (rec) await idbPut('meta', { key: picKey(), ...rec, ts: Date.now() }).catch(() => {});
  else await idbDel('meta', picKey()).catch(() => {});
  paintMyPic();
  if (!upload || !session) return;
  const sc = scope;
  clearTimeout(picUploadT);
  picUploadT = setTimeout(async () => {
    if (scope !== sc || !session) return;
    try {
      if (!myPic){ await api('avatar-clear'); return; }
      const sent = myPic;
      const r = await api('avatar-set', { image: await blobToDataUrl(sent.blob), canvas: sent.canvas, crop: sent.crop });
      // Remembered as the account's version, so the next launch knows it has it.
      if (myPic === sent && scope === sc){
        myPic = { ...sent, v: r.avatar.v, sent: true };
        await idbPut('meta', { key: picKey(), ...myPic, ts: Date.now() }).catch(() => {});
      }
    } catch (e) { console.warn('inko: picture upload', e); }
  }, rec ? 1200 : 0);
}
/* The picture's canvas changed on screen: redraw it from what is there now. */
let picFollowT = null;
function picFollow(){
  if (!myPic || !myPic.canvas || myPic.canvas !== editingId) return;
  clearTimeout(picFollowT);
  picFollowT = setTimeout(async () => {
    if (!myPic || myPic.canvas !== editingId) return;
    const png = await strokesBlob();
    const blob = await renderPic(png, { h: bgH, s: bgS, b: bgB }, myPic.crop);
    await savePic({ ...myPic, blob }, true);
  }, 600);
}
/* The scope's picture: this device's copy at once, then the account's word. */
async function loadMyPic(){
  const sc = scope;
  const local = await idbGet('meta', picKey()).catch(() => null);
  myPic = local && local.blob ? { canvas: local.canvas, crop: local.crop, blob: local.blob } : null;
  paintMyPic();
  if (!session || sc === 'local') return;
  const r = await api('me').catch(() => null);
  if (!r || scope !== sc) return;
  const a = r.avatar;
  if (!a){
    // Set on this device while the account had none: send it; else the account cleared it.
    if (myPic && local && !local.sent) savePic({ ...myPic, sent: true }, true);
    else if (myPic) savePic(null, false);
    return;
  }
  const same = local && local.v === a.v;
  if (same) return;
  try {
    const blob = await (await fetch(avatarSrc(session.handle, a.v))).blob();
    if (scope !== sc) return;
    await savePic({ canvas: a.canvas, crop: a.crop, blob, v: a.v, sent: true }, false);
  } catch (e) {}
  // And if that canvas is here, bring the picture up to what it holds now.
  picFollow();
}

/* ---- choosing the picture: a canvas, then a square of it ---- */
let picking = false;
function setPicking(on){
  picking = on;
  $('g-pick').hidden = !on;
  $('gallery').classList.toggle('picking', on);
}
$('g-avatar').addEventListener('click', () => {
  if (galleryTab !== 'mine') return;
  setPicking(!picking);
});
$('g-pick-cancel').addEventListener('click', () => setPicking(false));
$('g-pick-smiley').addEventListener('click', async () => {
  setPicking(false);
  await savePic(null, true);
  renderGallery(); toast('Back to the smiley');
});
let cropIt = null, crop = null, cropK = 1;
async function openCrop(it){
  // The canvas on screen may be ahead of its card.
  if (it.id === editingId && dirty){ await saveCurrent().catch(() => {}); it = gallery.find(g => g.id === it.id) || it; }
  if (!it.png) return;
  cropIt = it;
  const cv = $('crop-cv');
  const maxW = Math.min(300, window.innerWidth - 80), maxH = Math.max(220, window.innerHeight - 330);
  cropK = Math.min(maxW / W, maxH / H);
  cv.width = Math.round(W * cropK); cv.height = Math.round(H * cropK);
  const c = cv.getContext('2d');
  c.fillStyle = hsbToCss(it.bg.h, it.bg.s, it.bg.b, 1); c.fillRect(0, 0, cv.width, cv.height);
  const bmp = await createImageBitmap(it.png);
  c.drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close && bmp.close();
  // Back on the square it had, if this is the picture's canvas already.
  crop = myPic && myPic.canvas === it.id && myPic.crop ? { ...myPic.crop } : { x: 0, y: (H - W) / 2, size: W };
  $('crop-size').value = Math.round(crop.size / W * 100);
  placeCrop();
  $('crop').classList.add('open');
}
function clampCrop(){
  crop.size = Math.max(W * 0.2, Math.min(W, crop.size));
  crop.x = Math.max(0, Math.min(W - crop.size, crop.x));
  crop.y = Math.max(0, Math.min(H - crop.size, crop.y));
}
function placeCrop(){
  clampCrop();
  const b = $('crop-box').style;
  b.left = crop.x * cropK + 'px'; b.top = crop.y * cropK + 'px';
  b.width = b.height = crop.size * cropK + 'px';
}
$('crop-size').addEventListener('input', () => {
  const cx = crop.x + crop.size / 2, cy = crop.y + crop.size / 2;
  crop.size = W * (+$('crop-size').value) / 100;
  crop.x = cx - crop.size / 2; crop.y = cy - crop.size / 2;
  placeCrop();
});
{
  let drag = null;
  const box = $('crop-box');
  box.addEventListener('pointerdown', e => {
    e.preventDefault(); box.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, cx: crop.x, cy: crop.y };
  });
  box.addEventListener('pointermove', e => {
    if (!drag) return;
    crop.x = drag.cx + (e.clientX - drag.x) / cropK;
    crop.y = drag.cy + (e.clientY - drag.y) / cropK;
    placeCrop();
  });
  const end = () => { drag = null; };
  box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
}
$('crop-cancel').addEventListener('click', () => $('crop').classList.remove('open'));
$('crop-save').addEventListener('click', async () => {
  const it = cropIt; if (!it) return;
  const blob = await renderPic(it.png, it.bg, crop);
  await savePic({ canvas: it.id, crop: { ...crop }, blob }, true);
  $('crop').classList.remove('open');
  setPicking(false);
  renderGallery();
  toast('Profile picture set');
});

/* ---- someone else's profile ---- */
let viewingUser = null;
async function openUser(handle){
  if (session && handle === session.handle){ setGalleryTab('mine'); return; }
  setGalleryTab('user');
  viewingUser = handle;
  if ($('gallery').classList.contains('open')) visit('user:' + handle);
  $('g-user-name').textContent = '@' + handle;
  paintPage();
  $('g-avatar').style.backgroundImage = `url("${avatarSrc(handle, feedAvatars[handle])}")`;
  $('g-avatar').setAttribute('aria-label', '@' + handle);
  $('g-count').textContent = 'Loading…';
  let r;
  try {
    const res = await fetch(API + '?profile=' + encodeURIComponent(handle));
    r = await res.json();
    if (!res.ok) throw new Error(r.error || 'gone');
  } catch (e) { if (viewingUser === handle) $('g-count').textContent = 'No such artist'; return; }
  if (viewingUser !== handle || galleryTab !== 'user') return;
  if (r.movedTo){ openUser(r.movedTo); return; }
  feedAvatars[handle] = r.avatar || 0;
  $('g-avatar').style.backgroundImage = `url("${avatarSrc(handle, r.avatar)}")`;
  // The same objects as the Public tab, so a reaction here is one there.
  const posts = (r.posts || []).map(p => { const f = feed.find(x => x.id === p.id); if (f) return f; feed.push(p); return p; });
  inkoEvent('user', { handle, profile: r });
  $('g-count').textContent = posts.length + (posts.length === 1 ? ' drawing' : ' drawings');
  const rows = $('g-rows'); rows.innerHTML = '';
  gridPosts = posts; fillRows(posts, 2, feedItem);
}

/* ---- search (Dex, 2026-10-08) ----
   The square button on the bar opens a pill on the keyboard: artists by
   @tag (the server) and canvases by title (your own, and the public ones
   from the feed), with All / Artists / Canvases chips that can be flipped
   while typing -- they never take the keyboard down. With the keyboard
   gone the pill rests above the bar, so you can see what you searched. */
let searchT = null, searchSeq = 0, findKind = 'all';
const searching = () => $('gallery').classList.contains('searching');
function openSearch(){
  if (selecting) exitSelect();
  if (picking) setPicking(false);
  $('gallery').classList.add('searching');
  $('g-search-btn').classList.add('on');
  paintPage();
  // Focused inside the tap, or a phone will not bring up its keyboard.
  $('g-search').focus();
  placeFind();
  runSearch($('g-search').value.trim());
}
function clearSearch(quiet){
  clearTimeout(searchT); searchSeq++;
  $('g-search').value = '';
  $('g-search').blur();
  $('g-search-btn').classList.remove('on');
  $('gallery').classList.remove('searching');
  paintPage();
  if (!quiet) setGalleryTab(galleryTab === 'user' ? 'public' : galleryTab);
}
function placeFind(){
  if (!searching()) return;
  const vv = window.visualViewport;
  const kb = vv ? Math.max(0, innerHeight - (vv.offsetTop + vv.height)) : 0;
  const bar = innerHeight - $('g-bar').getBoundingClientRect().top;
  const f = $('g-find');
  f.style.bottom = (Math.max(kb, bar) + 8) + 'px';
  $('gallery').style.setProperty('--find-h', (f.offsetHeight + 16 + Math.max(0, kb - bar)) + 'px');
}
if (window.visualViewport){ visualViewport.addEventListener('resize', placeFind); visualViewport.addEventListener('scroll', placeFind); }
addEventListener('resize', placeFind);
$('g-search-btn').addEventListener('click', () => (searching() && document.activeElement !== $('g-search') ? $('g-search').focus() : searching() ? clearSearch() : openSearch()));
$('g-find-x').addEventListener('click', () => clearSearch());
$('g-find-x').addEventListener('pointerdown', e => e.preventDefault());
for (const chip of document.querySelectorAll('.g-chip')){
  chip.addEventListener('pointerdown', e => e.preventDefault());   // keep the keyboard up
  chip.addEventListener('click', () => {
    findKind = chip.dataset.kind;
    for (const c of document.querySelectorAll('.g-chip')){ c.classList.toggle('on', c === chip); c.setAttribute('aria-checked', String(c === chip)); }
    runSearch($('g-search').value.trim());
  });
}
$('g-search').addEventListener('input', () => {
  clearTimeout(searchT);
  const q = $('g-search').value.trim();
  searchT = setTimeout(() => runSearch(q), 220);
});
$('g-search').addEventListener('keydown', e => {
  if (e.key === 'Enter'){ e.preventDefault(); $('g-search').blur(); }
  if (e.key === 'Escape'){ e.stopPropagation(); clearSearch(); }
});
$('g-search').addEventListener('blur', () => setTimeout(placeFind, 60));
// Contains, with the ones that START with it first.
function titleMatches(list, q){
  const n = q.toLowerCase();
  return list.filter(x => (x.title || 'Untitled').toLowerCase().includes(n))
    .sort((a, b) => ((a.title || '').toLowerCase().startsWith(n) ? 0 : 1) - ((b.title || '').toLowerCase().startsWith(n) ? 0 : 1));
}
async function runSearch(raw){
  const seq = ++searchSeq;
  const rows = $('g-rows');
  const handleQ = raw.replace(/^@/, '');
  const say = text => { const e = document.createElement('div'); e.className = 'g-empty'; e.textContent = text; rows.appendChild(e); };
  if (!raw){ rows.innerHTML = ''; say('Search an @artist or a canvas title'); placeFind(); return; }
  const wantUsers = findKind !== 'canvases', wantCanvases = findKind !== 'artists' && !raw.startsWith('@');
  let users = [];
  const jobs = [];
  if (wantUsers) jobs.push(fetch(API + '?users=' + encodeURIComponent(handleQ)).then(r => r.json()).then(j => { users = j.users || []; }).catch(() => {}));
  if (wantCanvases && !feedLoaded) jobs.push(loadFeed().catch(() => {}));
  await Promise.all(jobs);
  if (seq !== searchSeq || !searching()) return;
  rows.innerHTML = '';
  const mine = wantCanvases ? titleMatches(gallery, raw) : [];
  const own = new Set(gallery.map(g => g.id));
  const pub = wantCanvases ? titleMatches(visibleFeed().filter(p => !own.has(p.id)), raw) : [];
  const sec = text => { const h = document.createElement('div'); h.className = 'g-sec'; h.textContent = text; rows.appendChild(h); };
  if (!users.length && !mine.length && !pub.length){
    say(findKind === 'artists' ? 'No artist called @' + handleQ : findKind === 'canvases' ? 'No canvas called "' + raw + '"' : 'Nothing called "' + raw + '"');
    placeFind(); return;
  }
  if (users.length){
    if (wantCanvases) sec('Artists');
    for (const u of users){
      feedAvatars[u.handle] = u.avatar || 0;
      const b = document.createElement('button'); b.className = 'g-user'; b.dataset.handle = u.handle;
      b.append(avatarEl(u.handle, 'mid'), '@' + u.handle);
      b.addEventListener('click', () => { clearSearch(true); openUser(u.handle); });
      rows.appendChild(b);
    }
  }
  if (mine.length){
    sec('Your canvases');
    for (let i = 0; i < mine.length; i += 3){
      const row = document.createElement('div'); row.className = 'g-row';
      mine.slice(i, i + 3).forEach(it => row.appendChild(makeItem(it, false)));
      rows.appendChild(row);
    }
  }
  if (pub.length){
    sec('Public');
    gridPosts = pub; fillRows(pub, 2, feedItem);
  }
  placeFind();
}

/* ---- select mode (Dex, 2026-10-08) ----
   Hold one of your canvases to start it. Then a tap picks or un-picks a
   card, and a finger that sets off SIDEWAYS from a card sweeps every card
   between it and wherever it goes, scrolling the grid at its edges (the
   grid pans only up and down, so an up-or-down drag is still a scroll).
   The window floats top left, named after the canvas or how many, and
   moves by its top; its X, back, or anywhere else in the app ends it. */
const HOLD_MS = 450;
let hold = null, sweep = null, selPos = null;
function enterSelect(){
  if (selecting) return;
  selecting = true;
  $('gallery').classList.add('selecting');
  const p = $('g-sel');
  p.classList.add('open');
  if (!selPos) selPos = { left: 12, top: $('g-grid').getBoundingClientRect().top + 8 };
  placeSel(selPos.left, selPos.top);
  paintSel();
}
function exitSelect(){
  if (!selecting) return;
  selecting = false; sweep = null;
  selected.clear();
  $('gallery').classList.remove('selecting');
  $('g-sel').classList.remove('open');
  for (const el of $('g-rows').querySelectorAll('.g-item.sel')) el.classList.remove('sel');
}
function toggleSel(id, on = !selected.has(id)){
  on ? selected.add(id) : selected.delete(id);
  const el = $('g-rows').querySelector(`.g-item[data-id="${CSS.escape(id)}"]`);
  if (el) el.classList.toggle('sel', on);
  paintSel();
}
const selItems = () => gallery.filter(g => selected.has(g.id));
function paintSel(){
  const n = selected.size, one = n === 1 ? selItems()[0] : null;
  $('g-sel-title').textContent = n === 0 ? 'Select canvases' : one ? (one.title || 'Untitled') : n + ' selected';
  $('sel-dl').disabled = $('sel-del').disabled = n === 0;
  $('sel-share').disabled = n === 0 || !navigator.share;
  $('sel-copy').disabled = n !== 1 || !(navigator.clipboard && window.ClipboardItem);
}
function placeSel(left, top){
  const p = $('g-sel'), w = p.offsetWidth, h = p.offsetHeight;
  left = Math.max(6, Math.min(innerWidth - w - 6, left));
  top = Math.max(6, Math.min(innerHeight - h - 6, top));
  p.style.left = left + 'px'; p.style.top = top + 'px';
  selPos = { left, top };
}
// Hold to start: cancelled by moving, lifting, or the grid scrolling.
$('g-rows').addEventListener('pointerdown', e => {
  const el = e.target.closest('.g-item[data-id]');
  if (!el || e.target.closest('button')) return;
  if (selecting){
    sweep = { id: el.dataset.id, x: e.clientX, y: e.clientY, pid: e.pointerId, on: null, base: null, mouse: e.pointerType === 'mouse' };
    return;
  }
  if (galleryTab !== 'mine' || picking || searching()) return;
  clearTimeout(hold && hold.t);
  hold = { x: e.clientX, y: e.clientY, id: el.dataset.id, t: setTimeout(() => {
    hold = null; holdFired = true;
    enterSelect(); toggleSel(el.dataset.id, true);
    if (navigator.vibrate) try { navigator.vibrate(12); } catch (err) {}
  }, HOLD_MS) };
});
$('g-rows').addEventListener('contextmenu', e => { if (e.target.closest('.g-item')) e.preventDefault(); });
$('g-grid').addEventListener('scroll', () => { if (hold){ clearTimeout(hold.t); hold = null; } }, { passive: true });
addEventListener('pointermove', e => {
  if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 10){ clearTimeout(hold.t); hold = null; }
  if (!sweep || e.pointerId !== sweep.pid) return;
  const dx = e.clientX - sweep.x, dy = e.clientY - sweep.y;
  if (sweep.on === null){
    if (Math.hypot(dx, dy) < 10) return;
    if (!sweep.mouse && Math.abs(dx) < Math.abs(dy)){ sweep = null; return; }   // that is a scroll
    sweep.on = !selected.has(sweep.id); sweep.base = new Set(selected);
    sweep.cx = e.clientX; sweep.cy = e.clientY;
    sweepEdge();
  }
  sweep.cx = e.clientX; sweep.cy = e.clientY;
  sweepTo();
});
function sweepTo(){
  if (!sweep || sweep.on === null) return;
  const hit = document.elementFromPoint(sweep.cx, sweep.cy);
  const el = hit && hit.closest('.g-item[data-id]');
  if (!el) return;
  const cards = [...$('g-rows').querySelectorAll('.g-item[data-id]')].map(c => c.dataset.id);
  const a = cards.indexOf(sweep.id), b = cards.indexOf(el.dataset.id);
  if (a < 0 || b < 0) return;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  cards.forEach((id, i) => toggleSel(id, i >= lo && i <= hi ? sweep.on : sweep.base.has(id)));
}
// Near the top or bottom of the grid, it scrolls under the finger.
function sweepEdge(){
  if (!sweep || sweep.on === null) return;
  const g = $('g-grid'), r = g.getBoundingClientRect(), zone = 70;
  const v = sweep.cy < r.top + zone ? -(r.top + zone - sweep.cy) / 4 : sweep.cy > r.bottom - zone ? (sweep.cy - (r.bottom - zone)) / 4 : 0;
  if (v){ g.scrollTop += v; sweepTo(); }
  requestAnimationFrame(sweepEdge);
}
const endPress = e => {
  if (hold){ clearTimeout(hold.t); hold = null; }
  if (sweep && e.pointerId === sweep.pid){
    if (sweep.on !== null) holdFired = true;   // a sweep is not also a tap
    sweep = null;
  }
};
addEventListener('pointerup', endPress); addEventListener('pointercancel', endPress);
// A tap on a card does what it says only after a real tap; the click that
// ends a hold or a sweep is eaten, and a stale flag never outlives its tap.
addEventListener('pointerdown', () => { if (!hold) holdFired = false; }, true);
// The window moves by its top.
(() => {
  let drag = null;
  const head = $('g-sel-head');
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    drag = { id: e.pointerId, dx: e.clientX - selPos.left, dy: e.clientY - selPos.top };
    head.setPointerCapture(e.pointerId); e.preventDefault();
  });
  head.addEventListener('pointermove', e => { if (drag && e.pointerId === drag.id) placeSel(e.clientX - drag.dx, e.clientY - drag.dy); });
  const end = () => { drag = null; };
  head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
})();
$('g-sel-x').addEventListener('click', () => exitSelect());
const selFile = async it => new File([await fullBlob(it, false)], fileName(it.title), { type: 'image/png' });
$('sel-dl').addEventListener('click', async () => {
  const items = selItems();
  for (const it of items){ saveBlob(await fullBlob(it, false), it.title); await new Promise(r => setTimeout(r, 250)); }
  toast(items.length === 1 ? 'Downloaded' : 'Downloaded ' + items.length + ' canvases');
});
$('sel-copy').addEventListener('click', async () => {
  const it = selItems()[0]; if (!it) return;
  // The promise goes straight in, so Safari still counts it as this tap.
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': fullBlob(it, false) })]); toast('Copied'); }
  catch (e) { toast('Could not copy it'); }
});
$('sel-share').addEventListener('click', async () => {
  const items = selItems(); if (!items.length) return;
  try {
    const files = await Promise.all(items.map(selFile));
    if (navigator.canShare && !navigator.canShare({ files })) throw new Error('no');
    await navigator.share({ files, title: items.length === 1 ? items[0].title : 'Inko' });
  } catch (e) { if (e && e.name !== 'AbortError') toast('Sharing is not available here'); }
});
$('sel-del').addEventListener('click', () => {
  const items = selItems(), n = items.length; if (!n) return;
  const shared = items.some(it => it.visibility === 'public');
  const title = n === 1 ? 'Delete canvas?' : `Delete ${n} canvases?`;
  const text = n === 1 ? `"${items[0].title}" will be permanently deleted${shared ? ', and taken out of the shared gallery' : ''}.`
    : `They will be permanently deleted${shared ? ', and the public ones taken out of the shared gallery' : ''}.`;
  openModal(title, text, 'Delete', async () => {
    let gone = 0;
    for (const it of items) if (await deleteCanvas(it)) gone++;
    exitSelect();
    toast(gone === 1 ? 'Canvas deleted' : gone + ' canvases deleted'); renderGallery();
  });
});

/* ---- renaming your @tag ---- */
async function renameLocal(from, to){
  const a = 'u:' + from, b = 'u:' + to;
  for (const it of await idbAll('canvases')) if (ownerOf(it) === a){ it.owner = b; await idbPut('canvases', it); }
  for (const k of ['seen:', 'draft:', 'deletes:', 'avatar:']){
    const r = await idbGet('meta', k + a).catch(() => null);
    if (r){ await idbPut('meta', { ...r, key: k + b }); await idbDel('meta', k + a); }
  }
}
$('a-rename-go').addEventListener('click', async () => {
  if (!session) return;
  $('a-msg4').textContent = '';
  const from = session.handle;
  try {
    const r = await api('rename', { handle: $('a-rename').value });
    if (r.handle === from){ closeAccount(); return; }
    // Everything this device holds for the old name moves with it, and the
    // scope follows without a sign-out and sign-in in between.
    await scopeChain;
    await flushDraft().catch(() => {});
    await renameLocal(from, r.handle);
    session = { ...session, handle: r.handle, token: r.token };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {}
    scope = scopeOf(session);
    gallery.forEach(g => { g.owner = scope; });
    if (myPic) myPic = { ...myPic, v: r.avatar ? r.avatar.v : undefined };
    syncAccountButton(); closeAccount();
    if (galleryTab === 'mine') renderGallery();
    toast('You are @' + r.handle + ' now');
  } catch (e) { $('a-msg4').textContent = e.message; }
});
$('a-rename').addEventListener('keydown', e => { if (e.key === 'Enter') $('a-rename-go').click(); });

/* ---------- init ---------- */
async function init(){
  setupCanvas();
  bindHSB(); refreshPanelUI(); syncToolSel(); syncUndoRedo();
  window.addEventListener('resize', fit);
  // The bars change height on their own (sliders, the options bar, a font
  // or a picture arriving late): the canvas follows whatever they do.
  if (window.ResizeObserver) new ResizeObserver(() => fit()).observe($('bottom-bars'));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);
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
  siteOnBoot();
  checkForUpdate();
}

/* Signed in or out somewhere else on the site since Inko last ran. The flag
   is site-auth's mirror of Firebase's sign-in, readable without loading
   Firebase, so a person who never signs in never downloads it. */
function siteOnBoot(){
  let flag = null;
  try { flag = localStorage.getItem('site:signedIn'); } catch (e) {}
  if (session && session.site && !flag){ setSession(null); return; }
  if (!session && flag) linkSite(true).catch(e => console.warn('inko: site link', e));
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

/* ---- hooks for inko/social.js (follows, the fire filter, comments) ----
   The social features live in their own file; this is all they see of the
   app. Events: inko:tab { tab }, inko:user { handle, profile }, inko:post
   { post }, inko:feed -- each fired after the app has drawn that screen. */
function inkoEvent(name, detail){ document.dispatchEvent(new CustomEvent('inko:' + name, { detail })); }
var inkoBridge = window.inkoBridge = {
  feedFilter: null,                 // { keep(post), empty } narrows the Public grid
  get session(){ return session; },
  get tab(){ return galleryTab; },
  get viewingUser(){ return viewingUser; },
  get myVotes(){ return myVoteFor; },
  api, toast, openModal, openAccount, openUser, avatarEl,
  renderFeed(){ renderFeed(); },
};

init();
})();
