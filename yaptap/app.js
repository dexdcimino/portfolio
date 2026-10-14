'use strict';
/* YapTap — talk, it types. The web twin of the phone app, same model:
   the notes list IS the home screen, the bubble is the microphone, and
   notes save themselves as you dictate — segments append to the open note
   and are written down the moment they land, exactly like the Android
   app's draft. There is no Save button and no Start Talking button
   because the phone app has neither.
   Engine: the Web Speech API. On Chrome for Android that is Google's own
   speech recognizer: live interim results, automatic punctuation, free,
   no key, no server of ours. It needs the network (recognition happens
   server-side at Google) and Chrome ends sessions on its own, so while
   the user wants to record we simply restart it, seamlessly.
   Notes live in localStorage on this phone. Signed in to the site's one
   account (/account/site-auth.js — the same account as Inko, DexNote and
   MindSplit), they also sync to that account via /api/yaptap-notes;
   signed out, everything below works exactly the same, locally. */

const $ = id => document.getElementById(id);
const NOTES_KEY = 'yaptap.notes.v1';
const DRAFT_KEY = 'yaptap.draft.v1';
const POS_KEY = 'yaptap.pos.v1';
const DELETED_KEY = 'yaptap.deleted.v1';

let notes = [];
try { notes = JSON.parse(localStorage.getItem(NOTES_KEY) || '[]'); } catch (e) { notes = []; }
let tombstones = [];
try { tombstones = JSON.parse(localStorage.getItem(DELETED_KEY) || '[]'); } catch (e) { tombstones = []; }
let finalText = '';
try { finalText = (JSON.parse(localStorage.getItem(DRAFT_KEY) || '""') || ''); } catch (e) { finalText = ''; }
let interimText = '';
/* The note the dictation is currently appending to. It is already a saved
   note — autosave commits each final segment as it arrives — so "open"
   only decides whether the next segment extends it or starts a new one. */
let openNoteId = null;
let expandedId = null;

let state = 'idle';           // idle | live | paused
let wantRecord = false;
let rec = null;
let restartTimer = null;
let startedAt = 0, elapsedBase = 0, tickTimer = null;
let wakeLock = null;
let pendingDeleteId = null;

/* ---------------- text cleanup: light grammar polish on final results ---------------- */
function polish(s){
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\bi\b/g, 'I')
    .replace(/(^\s*[a-z])|([.!?]\s+[a-z])/g, m => m.toUpperCase())
    .trim();
}
const wordCount = s => (s.trim().match(/\S+/g) || []).length;

/* ---------------- relative time: minutes, hours, then always days ---------------- */
function ago(ts){
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

/* ---------------- storage ---------------- */
function saveNotes(){ localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); }
function saveDraft(){ localStorage.setItem(DRAFT_KEY, JSON.stringify(finalText)); }
function saveTombstones(){ localStorage.setItem(DELETED_KEY, JSON.stringify(tombstones)); }
function newNoteId(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function toast(msg){
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), 1800);
}

/* ---------------- the open note: autosave ---------------- */
/* Every final segment lands here. The segment's words are already in
   finalText (mergeAppend put them there); this writes them into the open
   note — extending it, or starting it — and persists immediately. */
function commitDraftNote(){
  const text = polish(finalText);
  if (wordCount(text) < 1) return;
  const now = Date.now();
  let n = openNoteId ? notes.find(x => x.id === openNoteId) : null;
  if (n){
    if (n.text !== text){ n.text = text; n.updated = now; }
  } else {
    n = { id: newNoteId(), ts: now, updated: now, text };
    notes.unshift(n);
    openNoteId = n.id;
  }
  saveNotes();
  renderList();
  queueSync();
}
/* "Save" on the phone means: this note is finished, the next dictation
   starts a fresh one. The words are already saved; this just closes it. */
function closeDraftNote(){
  commitDraftNote();
  openNoteId = null;
  finalText = ''; interimText = '';
  saveDraft();
}

/* ---------------- speech engine ---------------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) $('srWarn').classList.remove('hidden');

// Append a recognized chunk without duplicating words the recognizer
// replays. Chrome restarts its speech session every few seconds and
// re-delivers the last chunk as a fresh final; Android can too. Word-level
// overlap merge: if the chunk starts with words the draft already ends
// with, drop the overlap; if the whole chunk is already the draft's tail,
// drop it entirely. (The "Testing Testing Testing" bug, 2026-10-14.)
function mergeAppend(base, chunk){
  const clean = x => (x || '').trim().replace(/\s+/g, ' ');
  base = clean(base); chunk = clean(chunk);
  if (!chunk) return base;
  if (!base) return polish(chunk);
  const bw = base.split(' '), cw = chunk.split(' ');
  const norm = w => w.toLowerCase().replace(/[^a-z0-9']/g, '');
  const maxK = Math.min(bw.length, cw.length, 60);
  let k = 0;
  outer:
  for (let n = maxK; n > 0; n--){
    for (let j = 0; j < n; j++){
      if (norm(bw[bw.length - n + j]) !== norm(cw[j])) continue outer;
    }
    k = n; break;
  }
  if (k < cw.length){
    // Out-of-order replay: the whole chunk already sits in the recent
    // draft (recognizers replay recent audio after a restart) — drop it.
    const win = bw.slice(-80).map(norm);
    const needle = cw.map(norm);
    outer2:
    for (let a = 0; a + needle.length <= win.length; a++){
      for (let j = 0; j < needle.length; j++){
        if (win[a + j] !== needle[j]) continue outer2;
      }
      return polish(base);
    }
  }
  const rest = cw.slice(k).join(' ');
  return polish(rest ? (base + ' ' + rest) : base);
}

function newRec(){
  const r = new SR();
  r.lang = 'en-US';
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 1;
  // Chrome re-includes already-delivered finals in later events, so count
  // finals per session and commit each exactly once; mergeAppend then
  // swallows any cross-session replay on top of that.
  let finalsHandled = 0;
  r.onresult = e => {
    let interim = '';
    let finalsSeen = 0;
    let committed = false;
    for (let i = 0; i < e.results.length; i++){
      const res = e.results[i];
      if (res.isFinal){
        finalsSeen++;
        if (finalsSeen > finalsHandled){
          finalsHandled = finalsSeen;
          const seg = (res[0].transcript || '').trim();
          if (seg){ finalText = mergeAppend(finalText, seg); committed = true; }
        }
      } else {
        interim += res[0].transcript;
      }
    }
    interimText = interim.trim();
    if (finalText) saveDraft();
    if (committed) commitDraftNote();
    render();
  };
  r.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed'){
      wantRecord = false;
      setState('idle');
      toast('Mic blocked — allow microphone for dexcimino.com');
    }
    // 'no-speech', 'network', 'aborted': onend fires next and restarts us.
  };
  r.onend = () => {
    if (wantRecord && state === 'live'){
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => { if (wantRecord && state === 'live') startRec(); }, 220);
    }
  };
  return r;
}
function startRec(){
  if (!SR) { toast('Needs Chrome on Android for live transcription'); return; }
  try { rec = newRec(); rec.start(); } catch (e) { /* already running */ }
}
async function grabWakeLock(){
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
}
function dropWakeLock(){ try { wakeLock && wakeLock.release(); } catch (e) {} wakeLock = null; }

function setState(next){
  if (next === 'live'){
    state = 'live';
    wantRecord = true;
    startedAt = Date.now();
    startRec();
    grabWakeLock();
    clearInterval(tickTimer); tickTimer = setInterval(tick, 500); tick();
  } else if (next === 'paused'){
    elapsedBase += Date.now() - startedAt;
    state = 'paused';
    wantRecord = false;
    clearTimeout(restartTimer);
    try { rec && rec.stop(); } catch (e) {}
    interimText = '';
    commitDraftNote();
    dropWakeLock();
    tick();
  } else {
    state = 'idle';
    wantRecord = false;
    elapsedBase = 0;
    clearTimeout(restartTimer);
    clearInterval(tickTimer);
    try { rec && rec.stop(); } catch (e) {}
    interimText = '';
    dropWakeLock();
    tick();
  }
  render();
  if (state === 'live') startWave(); else stopWave();
}
function toggleRecord(){
  if (state === 'live') setState('paused');
  else setState('live');
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden'){ if (siteUser) syncNow(); return; }
  if (document.visibilityState === 'visible' && state === 'live'){
    grabWakeLock();
    // Chrome may have killed the session while backgrounded; nudge it.
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => { if (state === 'live'){ try { rec && rec.stop(); } catch (e) {} startRec(); } }, 400);
  }
});

/* ---------------- rendering ---------------- */
function fmtTime(ms){
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function render(){
  const has = finalText.trim().length > 0 || interimText.trim().length > 0;
  $('draftEmpty').classList.toggle('hidden', has);
  $('draftText').classList.toggle('hidden', !finalText.trim());
  $('draftText').textContent = finalText;
  $('draftInterim').textContent = interimText ? (finalText && !/\s$/.test(finalText) ? ' ' : '') + interimText : '';
  $('wordCount').textContent = wordCount(finalText + ' ' + interimText) + ' words';
  const d = $('draft');
  d.scrollTop = d.scrollHeight;

  // live caption: the tail of what's being said, one smooth line
  const tail = (finalText + ' ' + interimText).trim().split(/\s+/).slice(-14).join(' ');
  $('capText').textContent = state === 'idle' && !tail ? 'Tap the bubble and just talk…' : (tail || 'Listening…');
  const cs = $('capScroll');
  requestAnimationFrame(() => { cs.scrollLeft = cs.scrollWidth; });

  const cap = $('caption');
  cap.classList.toggle('live', state === 'live');
  cap.classList.toggle('paused', state === 'paused');
  cap.classList.toggle('idle', state === 'idle');

  $('statusDot').className = 'status-dot' + (state === 'live' ? ' live' : state === 'paused' ? ' paused' : '');
  $('statusText').textContent = state === 'live' ? 'Transcribing…' : state === 'paused' ? 'Paused — tap the bubble to keep going' : 'Ready';
  const bm = $('bubbleMain');
  bm.classList.toggle('live', state === 'live');
  bm.classList.toggle('paused', state === 'paused');
  bm.querySelector('.ic-mic').classList.toggle('hidden', state === 'live');
  bm.querySelector('.ic-pause').classList.toggle('hidden', state !== 'live');
  $('bubbleBtnLabel').textContent = bubbleVisible ? 'Hide bubble' : 'Show bubble';
  setSyncHint();
}
function tick(){
  const ms = elapsedBase + (state === 'live' ? Date.now() - startedAt : 0);
  $('timer').textContent = fmtTime(ms);
  $('bubbleTimer').textContent = fmtTime(ms);
  $('bubbleTimer').classList.toggle('hidden', state === 'idle');
}

async function copyText(text, msg){
  try { await navigator.clipboard.writeText(text); toast(msg || 'Copied'); }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(msg || 'Copied'); } catch (e2) { toast('Copy failed'); }
    ta.remove();
  }
}

/* The list builds UPWARD (Dex, 2026-10-14): storage keeps notes
   newest-first, the screen shows them oldest at the top and newest at
   the bottom by the thumb, chat-style, and the scroll stays anchored to
   the bottom unless the reader has deliberately scrolled away. */
let stickBottom = true;
$('listScroll').addEventListener('scroll', () => {
  const el = $('listScroll');
  stickBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 48;
});
function renderList(){
  $('listMeta').textContent = notes.length ? notes.length + (notes.length === 1 ? ' note' : ' notes') : '';
  $('listEmpty').classList.toggle('hidden', notes.length > 0);
  const wrap = $('listItems');
  wrap.innerHTML = '';
  const display = [...notes].sort((a, b) => (a.ts - b.ts) || String(a.id).localeCompare(String(b.id)));
  display.forEach(n => {
    const el = document.createElement('div');
    el.className = 'note' + (n.id === expandedId ? ' expanded' : '');
    el.innerHTML =
      '<div class="note-head">' +
        '<button class="note-del" aria-label="Delete this transcription"><svg viewBox="0 0 24 24" class="ic"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/></svg></button>' +
        '<button class="note-meta"></button>' +
        '<button class="note-copy" aria-label="Copy this transcription"><svg viewBox="0 0 24 24" class="ic"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
      '</div>' +
      '<div class="note-body hidden"></div>' +
      '<div class="note-when"></div>';
    const meta = el.querySelector('.note-meta');
    meta.textContent = ago(n.ts) + ' · ' + wordCount(n.text) + ' words';
    const when = el.querySelector('.note-when');
    when.textContent =
      new Date(n.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' +
      new Date(n.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const body = el.querySelector('.note-body');
    body.textContent = n.text;
    body.classList.toggle('hidden', n.id !== expandedId);
    meta.addEventListener('click', () => {
      expandedId = expandedId === n.id ? null : n.id;
      renderList();
    });
    el.querySelector('.note-copy').addEventListener('click', () => copyText(n.text));
    el.querySelector('.note-del').addEventListener('click', () => {
      pendingDeleteId = n.id;
      $('delModal').classList.remove('hidden');
    });
    wrap.appendChild(el);
  });
  if (stickBottom){
    const el = $('listScroll');
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }
}

$('delCancel').addEventListener('click', () => { pendingDeleteId = null; $('delModal').classList.add('hidden'); });
$('delModal').addEventListener('click', e => { if (e.target === $('delModal')){ pendingDeleteId = null; $('delModal').classList.add('hidden'); } });
$('delGo').addEventListener('click', () => {
  const id = pendingDeleteId;
  pendingDeleteId = null;
  notes = notes.filter(n => n.id !== id);
  tombstones = tombstones.filter(d => d.id !== id);
  tombstones.push({ id, ts: Date.now() });
  if (expandedId === id) expandedId = null;
  if (openNoteId === id){ openNoteId = null; finalText = ''; interimText = ''; saveDraft(); }
  saveNotes(); saveTombstones();
  $('delModal').classList.add('hidden');
  renderList(); render();
  queueSync();
  toast('Deleted');
});

// refresh "x ago" labels while the app sits open
setInterval(() => { renderList(); }, 60000);

/* ---------------- bubble: show/hide, drag, snap, options ----------------
   The bubble is the microphone. Shown, it records; while it records it
   wears the red sine wave (below). It drags anywhere but always docks to
   an edge — and on the left it docks CLEAR of the site's pop-out nav bar
   when the page is composed inside one (Dex, 2026-10-14): the nav is
   measured, not guessed, with the plain 10px dock as the fallback. */
const bubble = $('bubble');
let bubbleVisible = true;
let bpos = { side: 'right', top: 110 };
try { Object.assign(bpos, JSON.parse(localStorage.getItem(POS_KEY) || '{}')); } catch (e) {}

function navClearance(){
  let clear = 0;
  document.querySelectorAll('nav, aside, [data-nav], [class*="sidenav" i], [id*="sidenav" i]').forEach(el => {
    if (el === bubble || bubble.contains(el)) return;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') return;
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    if (r.left <= 2 && r.width > 0 && r.height > window.innerHeight * 0.4) clear = Math.max(clear, r.right);
  });
  return clear;
}
const leftDock = () => Math.max(10, Math.ceil(navClearance()) + 8);

function placeBubble(){
  bubble.style.display = bubbleVisible ? '' : 'none';
  bubble.style.top = Math.max(64, Math.min(window.innerHeight - 92, bpos.top)) + 'px';
  if (bpos.side === 'left'){
    bubble.style.left = leftDock() + 'px';
    bubble.style.right = 'auto';
  } else {
    bubble.style.left = 'auto';
    bubble.style.right = '10px';
  }
  bubble.classList.toggle('at-right', bpos.side === 'right');
  bubble.classList.toggle('at-left', bpos.side === 'left');
  bubble.classList.toggle('opts-down', bpos.top < 240);
  bubble.classList.toggle('opts-up', bpos.top >= 240);
}
placeBubble();
window.addEventListener('resize', placeBubble);

$('bubbleBtn').addEventListener('click', () => {
  bubbleVisible = !bubbleVisible;
  if (!bubbleVisible) hideOpts();
  placeBubble();
  render();
});

let drag = null;
$('bubbleMain').addEventListener('pointerdown', e => {
  drag = { x: e.clientX, y: e.clientY, top: bpos.top, moved: false };
});
/* Move/up live on the document, not the bubble: pointer capture is not
   reliable everywhere (synthetic pointers, some webviews), and a drag
   that escapes the bubble's box must still track and land. */
document.addEventListener('pointermove', e => {
  if (!drag || !(e.buttons & 1)) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 7) drag.moved = true;
  if (!drag.moved) return;
  bubble.style.top = Math.max(60, Math.min(window.innerHeight - 88, drag.top + dy)) + 'px';
  bubble.style.left = Math.max(navClearance() + 2, Math.min(window.innerWidth - 72, e.clientX - 34)) + 'px';
  bubble.style.right = 'auto';
});
document.addEventListener('pointerup', e => {
  if (!drag) return;
  const wasDrag = drag.moved;
  const upX = e.clientX, upY = e.clientY;
  drag = null;
  if (wasDrag){
    bpos.side = upX < window.innerWidth / 2 ? 'left' : 'right';
    bpos.top = Math.max(64, Math.min(window.innerHeight - 92, parseInt(bubble.style.top, 10) || bpos.top));
    localStorage.setItem(POS_KEY, JSON.stringify(bpos));
    placeBubble();
    return;
  }
  // A plain tap counts only if it lands on the bubble itself.
  const r = bubble.getBoundingClientRect();
  if (upX >= r.left && upX <= r.right && upY >= r.top && upY <= r.bottom){ hideOpts(); toggleRecord(); }
});
document.addEventListener('pointercancel', () => { drag = null; });
$('bubbleNub').addEventListener('click', e => {
  e.stopPropagation();
  $('opts').classList.toggle('hidden');
});
function hideOpts(){ $('opts').classList.add('hidden'); }
document.addEventListener('pointerdown', e => {
  if (!bubble.contains(e.target)) hideOpts();
});
$('optNotes').addEventListener('click', () => {
  hideOpts();
  stickBottom = true;
  renderList();
  $('listScroll').scrollTop = $('listScroll').scrollHeight;
});
$('optCopy').addEventListener('click', () => {
  hideOpts();
  const cur = (finalText + ' ' + interimText).trim();
  if (cur) copyText(polish(cur), 'Current note copied');
  else if (notes.length) copyText(notes[0].text, 'Latest note copied');
  else toast('Nothing to copy yet');
});
$('optSave').addEventListener('click', () => {
  hideOpts();
  closeDraftNote();
  if (state === 'live') setState('paused');
  render();
  toast('Saved to Notes');
});
$('optClose').addEventListener('click', () => {
  hideOpts();
  bubbleVisible = false;
  placeBubble();
  render();
});

/* ---------------- the recording wave ----------------
   A sine wave wrapped around the bubble: r(θ) = R + A·[(1−m)·sin(4θ+φ) +
   m·sin(7θ−0.8φ)] — two integer harmonics so the loop always closes. The
   same envelope math as the Android app's WaveRingView: the amplitude
   breathes (full wave → almost flat → wave again, ~7.3s), the blend m
   drifts the apparent frequency (~11.7s), the wave slowly rotates
   (~26s), the radius gently pulsates (±2.2%, ~3.1s) and the stroke
   varies (2.5–3.2px, ~4.7s). Recording red #FF4757 with a #FF8291 echo.
   NOTHING CLIPS: R is solved from the canvas — R = (avail − Amax −
   strokeMax/2) / (1 + pulseMax) with avail = half the canvas minus 3px —
   so at maximum extent the ink ends at 41px of the 44px half-canvas.
   The frame's worst case is published on dataset.maxr for checks. */
const wave = { raf: 0, startMs: 0 };
function startWave(){
  const cv = $('bubbleWave');
  if (!cv) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(88 * dpr)){ cv.width = Math.round(88 * dpr); cv.height = Math.round(88 * dpr); }
  cv.classList.remove('hidden');
  wave.startMs = performance.now();
  cancelAnimationFrame(wave.raf);
  const ctx = cv.getContext('2d');
  const draw = () => {
    const t = (performance.now() - wave.startMs) / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, 88, 88);
    const avail = 41, strokeMax = 3.2, aMax = 5.6, pulseMax = 0.022;
    const R0 = (avail - aMax - strokeMax / 2) / (1 + pulseMax);
    const breath = Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI * t / 7.3 - Math.PI / 2), 1.4);
    const A = aMax * (0.05 + 0.95 * breath);
    const mix = 0.5 + 0.5 * Math.sin(2 * Math.PI * t / 11.7 + 1.1);
    const phi = 2 * Math.PI * t / 26.0;
    const R = R0 * (1 + pulseMax * Math.sin(2 * Math.PI * t / 3.1));
    const stroke = 2.5 + 0.7 * (0.5 + 0.5 * Math.sin(2 * Math.PI * t / 4.7 + 0.6));
    const ring = (amp, shift, width, color) => {
      ctx.beginPath();
      for (let i = 0; i <= 160; i++){
        const th = 2 * Math.PI * i / 160;
        const r = R + amp * ((1 - mix) * Math.sin(4 * th + phi + shift) + mix * Math.sin(7 * th - 0.8 * phi + shift));
        const x = 44 + r * Math.cos(th), y = 44 + r * Math.sin(th);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
      ctx.stroke();
    };
    ring(A, 0, stroke, '#ff4757');
    ring(A * 0.8, 0.5, Math.max(1, stroke * 0.38), '#ff8291');
    cv.dataset.maxr = (R + A + stroke / 2).toFixed(2);
    cv.dataset.avail = avail;
    wave.raf = requestAnimationFrame(draw);
  };
  draw();
}
function stopWave(){
  cancelAnimationFrame(wave.raf);
  wave.raf = 0;
  const cv = $('bubbleWave');
  if (cv) cv.classList.add('hidden');
}

/* ---------------- the site account: ONE account for the domain ----------------
   There is no YapTap login. The sign-in below is the site's own shared
   module, /account/site-auth.js — the exact file Inko, DexNote and
   MindSplit load. Its session is Firebase Auth (project dexnote-d7047)
   with browser-local persistence on the dexcimino.com origin, so a user
   who signed in on any app on this domain is already signed in here, and
   signing in here signs them in everywhere. Providers the module really
   supports: Google, GitHub, Discord, and email/password ("custom
   account"). No YapTap-specific token exists or is minted: sync sends
   the session's Firebase ID token to /api/yaptap-notes, which verifies
   it server-side (lib/site-identity.js) and keys the notebook by uid in
   the same Blob store the other apps' per-user data lives in.

   MERGE RULE (lib/yaptap-merge.js on the server, mergeDocs below is the
   same rule on this side): notes unite by id, the copy with the larger
   `updated` wins; a deletion tombstone with ts >= a note's `updated`
   beats the note. Flow on sign-in and on every later change: pull the
   account notebook, merge with the local one, push the merged set; the
   server merges again with its stored copy and returns the canonical
   set, which is adopted locally. Local notes are never thrown away for
   being local — they upload. */
let siteAuthP = null;
const loadSite = () => (siteAuthP || (siteAuthP = import('/account/site-auth.js')));
let siteUser = null;
let siteEmailVerified = true;
let syncBusy = false;
let syncTimer = null;

function mergeDocs(a, b){
  const byId = new Map();
  for (const doc of [a, b]){
    for (const n of (doc && doc.notes) || []){
      if (!n || typeof n.id !== 'string') continue;
      const cur = byId.get(n.id);
      if (!cur || (n.updated || n.ts || 0) > (cur.updated || cur.ts || 0)) byId.set(n.id, n);
    }
  }
  const del = new Map();
  for (const doc of [a, b]){
    for (const d of (doc && doc.deleted) || []){
      if (!d || typeof d.id !== 'string') continue;
      del.set(d.id, Math.max(del.get(d.id) || 0, d.ts || 0));
    }
  }
  const notes = [...byId.values()].filter(n => (del.get(n.id) || 0) < (n.updated || n.ts || 0));
  notes.sort((x, y) => (y.ts - x.ts) || (y.updated - x.updated));
  return { notes, deleted: [...del.entries()].map(([id, ts]) => ({ id, ts })) };
}

async function apiNotes(payload){
  const r = await fetch('/api/yaptap-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('sync ' + r.status));
  return data;
}

function queueSync(){
  if (!siteUser) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 1200);
}
async function syncNow(){
  if (!siteUser || syncBusy) return;
  syncBusy = true;
  setSyncHint();
  try {
    const m = await loadSite();
    const idToken = await m.idToken();
    if (!idToken) throw new Error('no token');
    const pulled = await apiNotes({ action: 'pull', idToken });
    let merged = mergeDocs({ notes, deleted: tombstones }, pulled);
    merged = await apiNotes({ action: 'push', idToken, notes: merged.notes, deleted: merged.deleted });
    notes = merged.notes; tombstones = merged.deleted;
    saveNotes(); saveTombstones();
    if (openNoteId && !notes.some(n => n.id === openNoteId)) openNoteId = null;
    renderList();
    setSyncHint('Synced to your account');
  } catch (e) {
    setSyncHint('Sync hiccup — notes are safe on this device');
  }
  syncBusy = false;
}

function setSyncHint(msg){
  const text = msg || (siteUser
    ? (syncBusy ? 'Syncing…' : 'Synced to your account')
    : 'On this phone only — sign in to sync');
  const el = $('saveHint');
  if (el) el.textContent = text;
  const el2 = $('acctSyncState');
  if (el2 && siteUser) el2.textContent = text === 'Synced to your account' ? 'Your notes sync to this account.' : text;
}

function renderAccount(){
  $('acctBtnLabel').textContent = siteUser ? (siteUser.displayName || (siteUser.email || '').split('@')[0] || 'Account') : 'Sign in';
  $('acctOut').classList.toggle('hidden', !!siteUser);
  $('acctIn').classList.toggle('hidden', !siteUser);
  if (siteUser){
    $('acctName').textContent = siteUser.displayName || 'Signed in';
    $('acctDetail').textContent = siteUser.email || '';
  }
  setSyncHint();
}

$('acctBtn').addEventListener('click', () => {
  $('acctMsg').textContent = '';
  $('acctSheet').classList.remove('hidden');
  renderAccount();
});
$('acctClose').addEventListener('click', () => $('acctSheet').classList.add('hidden'));
$('acctSheet').addEventListener('click', e => { if (e.target === $('acctSheet')) $('acctSheet').classList.add('hidden'); });

async function providerSignIn(provider){
  const msg = $('acctMsg');
  msg.textContent = '';
  try {
    const m = await loadSite();
    await m.signIn(provider);
  } catch (e) {
    const m = await loadSite().catch(() => null);
    if (m && m.cancelled(e)) return;
    msg.textContent = m ? m.errorText(e) : 'Sign-in opens on dexcimino.com — this copy can\u2019t reach it.';
  }
}
document.querySelectorAll('.acct-provider').forEach(btn =>
  btn.addEventListener('click', () => providerSignIn(btn.dataset.provider)));

async function emailGo(create){
  const msg = $('acctMsg');
  const email = $('acctEmail').value.trim();
  const password = $('acctPass').value;
  msg.textContent = '';
  if (!email || !password){ msg.textContent = 'Type your email and a password first.'; return; }
  try {
    const m = await loadSite();
    if (create) await m.createEmail(email, password);
    else await m.signInEmail(email, password);
    $('acctPass').value = '';
  } catch (e) {
    const m = await loadSite().catch(() => null);
    msg.textContent = m ? m.errorText(e) : 'Sign-in opens on dexcimino.com — this copy can\u2019t reach it.';
  }
}
$('acctSignIn').addEventListener('click', () => emailGo(false));
$('acctCreate').addEventListener('click', () => emailGo(true));
$('acctReset').addEventListener('click', async () => {
  const msg = $('acctMsg');
  const email = $('acctEmail').value.trim();
  if (!email){ msg.textContent = 'Type your email above first.'; return; }
  try {
    const m = await loadSite();
    await m.resetPassword(email);
    msg.textContent = 'Password reset email sent — check your inbox.';
  } catch (e) {
    const m = await loadSite().catch(() => null);
    msg.textContent = m ? m.errorText(e) : 'Sign-in opens on dexcimino.com — this copy can\u2019t reach it.';
  }
});
$('acctSignOut').addEventListener('click', async () => {
  try { const m = await loadSite(); await m.signOut(); } catch (e) {}
  $('acctSheet').classList.add('hidden');
  toast('Signed out — notes stay on this device');
});

function bootAccount(){
  loadSite().then(m => {
    m.onUser(u => {
      siteUser = u || null;
      siteEmailVerified = !u || u.emailVerified !== false;
      renderAccount();
      render();
      if (siteUser) syncNow();
    });
  }).catch(() => { /* no reachable account module: local-only mode */ });
}

/* ---------------- install: the compact MindSplit-style bottom sheet ----------------
   It exists because dexcimino.com itself is an installed app ("dexdc",
   scope "/") on Dex's phone: a download tap inside that app's window opens
   this page INSIDE the site app, where no install prompt can fire and there
   is no browser menu. The sheet detects that window (display-mode:
   standalone) and says so, and it WAITS for the prompt: if
   beforeinstallprompt arrives while the sheet is open, the steps vanish
   and the button becomes Install.
   ALL styling lives in style.css (.ish-* classes) — the /yaptap/ CSP is
   style-src 'self', which strips inline styles and <style> elements; the
   first version of this sheet used inline styles and rendered as naked
   text with a giant icon on Dex's phone (2026-10-14). */
const YT_EMBED = new URLSearchParams(location.search).has('embed');
if ('serviceWorker' in navigator && !YT_EMBED){
  navigator.serviceWorker.register('/yaptap/sw.js', { scope: '/yaptap/', updateViaCache: 'none' }).catch(() => {});
}
let __ip = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); __ip = e; window.dispatchEvent(new Event('app:installable')); });
window.addEventListener('appinstalled', () => { __ip = null; });
function showInstallSheet(){
  if (document.getElementById('install-sheet')) return;
  const name = 'YapTap';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const t = document.createElement('div');
  t.id = 'install-sheet';
  t.className = 'ish-scrim';
  t.innerHTML =
    '<div class="ish-sheet">' +
      '<div class="ish-handle"></div>' +
      '<button class="ish-x" type="button" aria-label="Close">\u2715</button>' +
      '<img class="ish-icon" src="icon-512.png" alt="">' +
      '<h3 class="ish-title">Install ' + name + '</h3>' +
      '<p class="ish-sub">It goes on your home screen and opens like any other app.</p>' +
      '<a class="ish-applink" href="/yaptap/android.html">Get the Android app \u2014 the one with the floating bubble \u2192</a>' +
      '<div class="ish-steps" data-steps></div>' +
      '<div class="ish-spacer"></div>' +
      '<button class="ish-go" data-go type="button">Got it</button>' +
    '</div>';
  const stepsBox = t.querySelector('[data-steps]');
  const goBtn = t.querySelector('[data-go]');
  function render(){
    const steps = standalone
      ? ['Open dexcimino.com in your browser instead of the site\u2019s app', 'Remove the dexcimino.com app first, then install ' + name, 'Add the site\u2019s app back afterwards']
      : __ip ? null
      : ios ? ['Tap the Share button in Safari', 'Tap Add to Home Screen']
      : ['Open the browser menu (\u22ee)', 'Tap Install app or Add to Home screen'];
    stepsBox.innerHTML = steps ? steps.map((s, i) =>
      '<div class="ish-step"><span class="ish-num">' + (i + 1) + '</span><span class="ish-steptext">' + s + '</span></div>').join('') : '';
    goBtn.textContent = (__ip && !standalone) ? 'Install' : 'Got it';
    t.querySelector('.ish-sheet').classList.toggle('ish-tall', !!steps);
  }
  function close(){ window.removeEventListener('app:installable', render); t.remove(); }
  render();
  window.addEventListener('app:installable', render);
  goBtn.onclick = async () => {
    if (__ip && !standalone){ __ip.prompt(); try { await __ip.userChoice; } catch (e) {} __ip = null; }
    close();
  };
  t.querySelector('.ish-x').onclick = close;
  t.onclick = e => { if (e.target === t) close(); };
  document.body.appendChild(t);
}
if (!YT_EMBED && new URLSearchParams(location.search).has('install')){
  window.history.replaceState(null, '', location.pathname + location.hash);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showInstallSheet);
  else showInstallSheet();
}

/* ---------------- boot ----------------
   The draft on disk: the phone app keeps its draft inside its newest
   note, so if this draft matches the newest note it reopens that note;
   if it never got committed (the page died mid-dictation before), it is
   committed now. Either way nothing spoken is ever lost. */
if (wordCount(finalText) > 0){
  const top = notes[0];
  if (top && polish(top.text) === polish(finalText)) openNoteId = top.id;
  else commitDraftNote();
}
renderList();
render();
tick();
bootAccount();
