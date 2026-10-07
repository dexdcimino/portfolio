(()=>{ "use strict";
/* Inko rebuild — clean separation, MindSplit-style architecture.
   Embed mode: ?embed=1 renders full-bleed for the portfolio overlay. */
const EMBED = new URLSearchParams(location.search).has('embed');
if (EMBED) document.body.classList.add('embed');

/* ---------- Robust SW update system ---------- */
const APP_VERSION = '5.0.0';
if ('serviceWorker' in navigator){
  // Register with updateViaCache: 'none' to always check for new SW
  navigator.serviceWorker.register('/inko/sw.js', { updateViaCache: 'none' }).then(reg => {
    // Check immediately
    reg.update();
    
    // Handle new SW found
    reg.addEventListener('updatefound', () => {
      const newSW = reg.installing;
      if (!newSW) return;
      newSW.addEventListener('statechange', () => {
        if (newSW.state === 'installed'){
          if (navigator.serviceWorker.controller){
            showUpdateBanner('New version available');
          }
        }
      });
    });
    
    // Listen for messages from SW (e.g., after activate)
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data && e.data.type === 'SW_UPDATED'){
        showUpdateBanner('Updated to v' + e.data.version);
      }
    });
    
    // Periodic check every 60 seconds
    setInterval(() => reg.update(), 60000);
  }).catch(()=>{});
  
  // Check when tab becomes visible
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden){
      navigator.serviceWorker.getRegistration('/inko/').then(r => { if (r) r.update(); });
    }
  });
  
  // Force update check on online
  window.addEventListener('online', () => {
    navigator.serviceWorker.getRegistration('/inko/').then(r => { if (r) r.update(); });
  });
}

let updateBannerShown = false;
function showUpdateBanner(msg){
  if (updateBannerShown) return;
  updateBannerShown = true;
  const t = document.createElement('div');
  t.id = 'update-banner';
  t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#1a1f2e,#2a2f3e);color:#fff;padding:14px 20px;border-radius:14px;z-index:9999;display:flex;gap:14px;align-items:center;box-shadow:0 8px 30px rgba(0,0,0,.6);font-size:14px;font-weight:600;border:1px solid rgba(255,255,255,.1);';
  t.innerHTML = '<span>' + msg + '</span><button style="background:linear-gradient(135deg,#22d3ee,#a78bfa);border:none;border-radius:10px;padding:10px 20px;font-weight:700;cursor:pointer;color:#0b0d12;font-size:14px;">Update Now</button>';
  t.querySelector('button').onclick = async () => {
    // Nuclear update: clear all caches, unregister SW, hard reload
    try {
      if ('caches' in window){
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator){
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch(e){}
    window.location.reload(true);
  };
  document.body.appendChild(t);
}

/* ---------- constants & state ---------- */
const W = 880, H = 1170, DPR = Math.min(window.devicePixelRatio || 1, 2);
let hue = 4, sat = 100, bri = 100;
let brushSize = 45, eraserSize = null;
let bgH = 210, bgS = 35, bgB = 50;
let tool = 'brush', mirrorOn = false, panelMode = 'brush', popMode = null;
let history = [], step = -1, dirty = false, editingId = null;
let gallery = [];

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

/* ---------- history ---------- */
function pushHistory(){
  history = history.slice(0, step+1);
  history.push(sLayer.toDataURL('image/png'));
  if (history.length > 25) history.shift();
  step = history.length - 1;
  syncUndoRedo();
}
function restoreStrokes(dataURL){
  const img = new Image();
  img.onload = () => {
    sctx.clearRect(0,0,W,H);
    sctx.drawImage(img, 0,0,W,H);
    render(); dirty = true; scheduleDraft();
  };
  img.src = dataURL;
}
function syncUndoRedo(){
  $('undo-btn').disabled = step <= 0;
  $('redo-btn').disabled = step >= history.length-1;
}
$('undo-btn').addEventListener('click', () => {
  if (step > 0){ step--; restoreStrokes(history[step]); syncUndoRedo(); }
});
$('redo-btn').addEventListener('click', () => {
  if (step < history.length-1){ step++; restoreStrokes(history[step]); syncUndoRedo(); }
});

/* ---------- storage ---------- */
function persist(){
  try{ localStorage.setItem('sketchGalleryV1', JSON.stringify(gallery)); }
  catch(e){ toast('Storage is full — delete some canvases.'); }
}
function snapshotStrokes(){ return sLayer.toDataURL('image/png'); }
function saveCurrent(){
  const title = titleInput.value.trim() || 'Untitled';
  const item = {
    id: editingId || ('c'+Date.now().toString(36)+Math.floor(Math.random()*1296).toString(36)),
    title, bg:{h:bgH,s:bgS,b:bgB}, strokes:snapshotStrokes(), ts:Date.now()
  };
  if (editingId){
    const idx = gallery.findIndex(g => g.id === editingId);
    if (idx >= 0) gallery[idx] = item; else gallery.unshift(item);
  } else gallery.unshift(item);
  editingId = item.id;
  if (gallery.length > 20) gallery.length = 20;
  persist(); dirty = false;
}
let draftT = null;
function scheduleDraft(){
  clearTimeout(draftT);
  draftT = setTimeout(writeDraft, 600);
}
function writeDraft(){
  if (!dirty) return;
  try{
    localStorage.setItem('sketchDraftV1', JSON.stringify({
      title:titleInput.value, bg:{h:bgH,s:bgS,b:bgB}, strokes:snapshotStrokes()
    }));
  }catch(e){}
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && dirty) writeDraft();
});
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
  if (popMode==='brush'){ closePop(); return; }
  // Color picker doesn't change tool, just opens popup
  openBrushPop();
});

$('sym-btn').addEventListener('click', () => {
  mirrorOn = !mirrorOn;
  $('sym-btn').classList.toggle('on', mirrorOn);
  $('sym-btn').setAttribute('aria-pressed', mirrorOn);
  render();
});
$('plus-btn').addEventListener('click', () => {
  closePop();
  saveCurrent(); toast('Canvas saved');
  editingId = null; titleInput.value = '';
  bgH = 210; bgS = 35; bgB = 50;
  sctx.clearRect(0,0,W,H);
  render(); pushHistory(); dirty = false;
  try{ localStorage.removeItem('sketchDraftV1'); }catch(e){}
  refreshPanelUI();
});

/* ---------- brush popover ---------- */
function placePop(){
  const tb = $('toolbar').getBoundingClientRect();
  brushPop.style.bottom = Math.max(8, window.innerHeight - tb.top + 12) + 'px';
}
function openBrushPop(){
  panelMode = 'brush'; popMode = 'brush';
  syncTabs(); refreshPanelUI(); placePop();
  brushPop.classList.add('open');
}
function openEraserPop(){
  panelMode = 'brush'; popMode = 'eraser';
  syncTabs(); refreshPanelUI(); placePop();
  brushPop.classList.add('open');
}
function closePop(){ popMode = null; brushPop.classList.remove('open'); }
$('pop-x').addEventListener('click', e => { e.stopPropagation(); closePop(); });
document.addEventListener('pointerdown', e => {
  if (!popMode) return;
  if (brushPop.contains(e.target)) return;
  if (e.target.closest('#color-btn') || e.target.closest('#tool-toggle')) return;
  closePop();
});
document.addEventListener('touchstart', e => {
  if (!popMode) return;
  const x = e.touches[0].clientX;
  if (x < 28 || x > window.innerWidth-28) closePop();
}, {passive:true});
$('tab-brush').addEventListener('click', () => { panelMode='brush'; syncTabs(); refreshPanelUI(); });
$('tab-canvas').addEventListener('click', () => { panelMode='canvas'; syncTabs(); refreshPanelUI(); });
function syncTabs(){
  $('tab-brush').classList.toggle('on', panelMode==='brush');
  $('tab-canvas').classList.toggle('on', panelMode==='canvas');
  $('swatch-label').textContent = panelMode==='canvas' ? 'Canvas color' : 'Brush color';
}
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
function refreshPanelUI(){
  const cd=$('color-dot'); if(cd) cd.style.background = brushCss();
  const isCanvas = panelMode==='canvas' && popMode!=='eraser';
  const h = isCanvas ? bgH : hue, s = isCanvas ? bgS : sat, b = isCanvas ? bgB : bri;
  $('hue').value = h; $('sat').value = s; $('bri').value = b;
  $('hue-v').textContent = h+'°'; $('sat-v').textContent = s; $('bri-v').textContent = b;
  const css = hsbToCss(h,s,b,1);
  $('swatch').style.background = css;
  $('sat').style.setProperty('--sat-track', `linear-gradient(90deg, ${hsbToCss(h,0,b,1)}, ${hsbToCss(h,100,b,1)})`);
  $('bri').style.setProperty('--bri-track', `linear-gradient(90deg, ${hsbToCss(h,s,0,1)}, ${hsbToCss(h,s,100,1)})`);
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
  const on = () => {
    const h = +$('hue').value, s = +$('sat').value, b = +$('bri').value;
    if (panelMode==='canvas' && popMode!=='eraser'){ bgH=h; bgS=s; bgB=b; render(); }
    else { hue=h; sat=s; bri=b; }
    refreshPanelUI(); dirty = true; scheduleDraft();
  };
  $('hue').addEventListener('input', on);
  $('sat').addEventListener('input', on);
  $('bri').addEventListener('input', on);
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

/* ---------- gallery ---------- */
function thumbFor(it, cb){
  const t = document.createElement('canvas'); t.width = 360; t.height = 480;
  const c = t.getContext('2d');
  const done = () => cb(t.toDataURL('image/jpeg', 0.82));
  if (it.strokes){
    const bg = it.bg || {h:0,s:0,b:100};
    c.fillStyle = hsbToCss(bg.h,bg.s,bg.b,1); c.fillRect(0,0,360,480);
    const img = new Image();
    img.onload = () => { c.drawImage(img,0,0,360,480); done(); };
    img.src = it.strokes;
  } else {
    c.fillStyle = '#fff'; c.fillRect(0,0,360,480); done();
  }
}
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
function downloadItem(it, isLive){
  const t = document.createElement('canvas'); t.width = W; t.height = H;
  const c = t.getContext('2d');
  const done = () => {
    const a = document.createElement('a');
    a.href = t.toDataURL('image/png');
    a.download = fileName(isLive ? titleInput.value : it.title);
    document.body.appendChild(a); a.click(); a.remove();
    toast('Downloaded');
  };
  if (isLive){
    c.fillStyle = bgCss(); c.fillRect(0,0,W,H);
    c.drawImage(sLayer,0,0,W,H); done();
  } else if (it.strokes){
    const bg = it.bg || {h:0,s:0,b:100};
    c.fillStyle = hsbToCss(bg.h,bg.s,bg.b,1); c.fillRect(0,0,W,H);
    const img = new Image();
    img.onload = () => { c.drawImage(img,0,0,W,H); done(); };
    img.src = it.strokes;
  }
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
  const div = document.createElement('div'); div.className = 'g-item';
  const th = document.createElement('div'); th.className = 'g-thumb';
  const img = document.createElement('img'); th.appendChild(img);
  const dl = document.createElement('button'); dl.className = 'g-dl'; dl.setAttribute('aria-label','Download');
  dl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3 V15"/><path d="M7 10 L12 15 L17 10"/><path d="M4 19 H20"/></svg>';
  const del = document.createElement('button'); del.className = 'g-del'; del.setAttribute('aria-label','Delete');
  del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="12" x2="18" y2="12"/></svg>';
  dl.addEventListener('click', e => { e.stopPropagation(); downloadItem(it, isLive); });
  if (isLive){
    del.addEventListener('click', e => {
      e.stopPropagation();
      openModal('Clear canvas?','This erases the current drawing.','Clear', () => {
        clearCanvas(); dirty = false;
        try{ localStorage.removeItem('sketchDraftV1'); }catch(e){}
        toast('Canvas cleared'); renderGallery();
      });
    });
    liveThumb(url => img.src = url);
    div.addEventListener('click', () => $('gallery').classList.remove('open'));
  } else {
    del.addEventListener('click', e => {
      e.stopPropagation();
      openModal('Delete canvas?', `"${it.title}" will be permanently deleted.`, 'Delete', () => {
        gallery = gallery.filter(g => g.id !== it.id);
        if (editingId === it.id) editingId = null;
        persist(); toast('Canvas deleted'); renderGallery();
      });
    });
    thumbFor(it, url => img.src = url);
    div.addEventListener('click', () => openCanvas(it.id));
  }
  th.appendChild(dl); th.appendChild(del);
  const cap = document.createElement('div'); cap.className = 'g-title';
  cap.textContent = isLive ? (titleInput.value.trim() || 'Untitled') + ' • live' : it.title;
  div.appendChild(th); div.appendChild(cap);
  return div;
}
function renderGallery(){
  const rows = $('g-rows'); rows.innerHTML = '';
  $('g-count').textContent = gallery.length + (gallery.length===1 ? ' canvas' : ' canvases');
  // Oldest first → newest ends up bottom-right
  const items = [...gallery].reverse();
  for (let i=0; i<items.length; i+=3){
    const row = document.createElement('div'); row.className = 'g-row';
    items.slice(i, i+3).forEach(it => row.appendChild(makeItem(it, false)));
    rows.appendChild(row);
  }
  $('g-grid').scrollTop = $('g-grid').scrollHeight;
}
function openCanvas(id){
  if (dirty) saveCurrent();
  const it = gallery.find(g => g.id === id);
  if (!it) return;
  editingId = id; titleInput.value = it.title;
  bgH = it.bg.h; bgS = it.bg.s; bgB = it.bg.b;
  const img = new Image();
  img.onload = () => {
    sctx.clearRect(0,0,W,H);
    sctx.drawImage(img, 0,0,W,H);
    render(); history = []; step = -1; pushHistory();
    dirty = false;
    try{ localStorage.removeItem('sketchDraftV1'); }catch(e){}
    $('gallery').classList.remove('open');
    refreshPanelUI();
  };
  img.src = it.strokes;
}
$('grid-btn').addEventListener('click', () => {
  closePop(); renderGallery();
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

/* ---------- init ---------- */
function init(){
  setupCanvas();
  bindHSB(); refreshPanelUI(); syncToolSel(); syncUndoRedo();
  try{
    const raw = localStorage.getItem('sketchGalleryV1');
    if (raw){
      gallery = JSON.parse(raw) || [];
      gallery.forEach(it => {
        if (it.data && !it.strokes){ it.strokes = it.data; delete it.data; }
        if (!it.bg) it.bg = {h:0,s:0,b:100};
      });
    }
  }catch(e){ gallery = []; }
  try{
    const d = localStorage.getItem('sketchDraftV1');
    if (d){
      const draft = JSON.parse(d);
      titleInput.value = draft.title || '';
      bgH = draft.bg.h; bgS = draft.bg.s; bgB = draft.bg.b;
      const img = new Image();
      img.onload = () => {
        sctx.clearRect(0,0,W,H);
        sctx.drawImage(img, 0,0,W,H);
        render(); pushHistory(); dirty = true; refreshPanelUI();
      };
      img.src = draft.strokes;
    } else {
      render(); pushHistory();
    }
  }catch(e){ render(); pushHistory(); }
  if (!history.length){ render(); pushHistory(); }
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 120));
}

/* ---------- PWA install prompt ---------- */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = $('install-btn');
  if (btn) btn.style.display = '';
});
const installBtn = $('install-btn');
if (installBtn){
  // Always show the button - don't wait for beforeinstallprompt
  installBtn.style.display = '';
  installBtn.addEventListener('click', async () => {
    if (deferredPrompt){
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') installBtn.style.display = 'none';
      deferredPrompt = null;
    } else {
      // Fallback: show manual instructions
      showInstallInstructions();
    }
  });
}
function showInstallInstructions(){
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
  t.innerHTML = '<div style="background:#1a1f2e;border-radius:16px;padding:24px;max-width:340px;color:#fff;">' +
    '<h3 style="margin:0 0 12px;font-size:18px;">Install Inko</h3>' +
    '<p style="margin:0 0 8px;font-size:14px;color:#aaa;">To install this app on your home screen:</p>' +
    '<ol style="margin:0 0 16px;padding-left:20px;font-size:14px;color:#ddd;">' +
    '<li>Open <b>dexcimino.com/inko/</b> in Chrome</li>' +
    '<li>Tap the <b>⋮ menu</b> (top-right)</li>' +
    '<li>Tap <b>"Add to Home screen"</b> or <b>"Install app"</b></li>' +
    '</ol>' +
    '<button style="width:100%;background:linear-gradient(135deg,#22d3ee,#a78bfa);border:none;border-radius:10px;padding:12px;font-weight:700;cursor:pointer;color:#0b0d12;font-size:15px;">Got it</button></div>';
  t.querySelector('button').onclick = () => t.remove();
  t.onclick = e => { if (e.target === t) t.remove(); };
  document.body.appendChild(t);
}
window.addEventListener('appinstalled', () => {
  const btn = $('install-btn');
  if (btn) btn.style.display = 'none';
  deferredPrompt = null;
});

init();
})();
