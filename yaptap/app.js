'use strict';
/* YapTap — talk, it types.
   Engine: the Web Speech API. On Chrome for Android that is Google's own
   speech recognizer: live interim results, automatic punctuation, free,
   no key, no server of ours. It needs the network (recognition happens
   server-side at Google) and Chrome ends sessions on its own, so while
   the user wants to record we simply restart it, seamlessly.
   Notes + the in-progress draft live in localStorage on this phone only. */

const $ = id => document.getElementById(id);
const NOTES_KEY = 'yaptap.notes.v1';
const DRAFT_KEY = 'yaptap.draft.v1';
const POS_KEY = 'yaptap.pos.v1';

let notes = [];
try { notes = JSON.parse(localStorage.getItem(NOTES_KEY) || '[]'); } catch (e) { notes = []; }
let finalText = '';
try { finalText = (JSON.parse(localStorage.getItem(DRAFT_KEY) || '""') || ''); } catch (e) { finalText = ''; }
let interimText = '';

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

function toast(msg){
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), 1800);
}

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
  $('statusText').textContent = state === 'live' ? 'Transcribing…' : state === 'paused' ? 'Paused — tap to keep going' : 'Ready';
  const rb = $('recBtn');
  rb.classList.toggle('live', state === 'live');
  rb.classList.toggle('paused', state === 'paused');
  $('recBtnLabel').textContent = state === 'live' ? 'Pause' : state === 'paused' ? 'Keep talking' : 'Start talking';
  const bm = $('bubbleMain');
  bm.classList.toggle('live', state === 'live');
  bm.classList.toggle('paused', state === 'paused');
  bm.querySelector('.ic-mic').classList.toggle('hidden', state === 'live');
  bm.querySelector('.ic-pause').classList.toggle('hidden', state !== 'live');
  $('listCount').textContent = notes.length;
}
function tick(){
  const ms = elapsedBase + (state === 'live' ? Date.now() - startedAt : 0);
  $('timer').textContent = fmtTime(ms);
  $('bubbleTimer').textContent = fmtTime(ms);
  $('bubbleTimer').classList.toggle('hidden', state === 'idle');
}

/* ---------------- speech engine ---------------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) $('srWarn').classList.remove('hidden');

function newRec(){
  const r = new SR();
  r.lang = 'en-US';
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 1;
  r.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++){
      const res = e.results[i];
      if (res.isFinal){
        const seg = polish(res[0].transcript);
        if (seg) finalText = polish((finalText + ' ' + seg).trim());
      } else {
        interim += res[0].transcript;
      }
    }
    interimText = interim.trim();
    if (finalText) saveDraft();
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
}
function toggleRecord(){
  if (state === 'live') setState('paused');
  else setState('live');
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state === 'live'){
    grabWakeLock();
    // Chrome may have killed the session while backgrounded; nudge it.
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => { if (state === 'live'){ try { rec && rec.stop(); } catch (e) {} startRec(); } }, 400);
  }
});

/* ---------------- notes ---------------- */
function saveNoteAndNew(silent){
  const text = (finalText + (interimText ? ' ' + interimText : '')).trim();
  if (wordCount(text) < 1){ if (!silent) toast('Nothing to save yet'); return false; }
  notes.unshift({ id: Date.now() + '', ts: Date.now(), text: polish(text) });
  saveNotes();
  finalText = ''; interimText = '';
  saveDraft();
  if (state !== 'idle') setState('idle'); else render();
  render();
  if (!silent) toast('Saved to Notes');
  return true;
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

function renderList(){
  $('listMeta').textContent = notes.length ? notes.length + (notes.length === 1 ? ' note' : ' notes') : '';
  $('listEmpty').classList.toggle('hidden', notes.length > 0);
  const wrap = $('listItems');
  wrap.innerHTML = '';
  notes.forEach(n => {
    const el = document.createElement('div');
    el.className = 'note';
    el.innerHTML =
      '<div class="note-head">' +
        '<button class="note-del" aria-label="Delete this transcription"><svg viewBox="0 0 24 24" class="ic"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/></svg></button>' +
        '<button class="note-meta"></button>' +
        '<button class="note-copy" aria-label="Copy this transcription"><svg viewBox="0 0 24 24" class="ic"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
      '</div>' +
      '<div class="note-body hidden"></div>';
    const meta = el.querySelector('.note-meta');
    meta.innerHTML = ago(n.ts) + ' · ' + wordCount(n.text) + ' words<small>' +
      new Date(n.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
      new Date(n.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '</small>';
    const body = el.querySelector('.note-body');
    body.textContent = n.text;
    meta.addEventListener('click', () => body.classList.toggle('hidden'));
    el.querySelector('.note-copy').addEventListener('click', () => copyText(n.text));
    el.querySelector('.note-del').addEventListener('click', () => {
      pendingDeleteId = n.id;
      $('delModal').classList.remove('hidden');
    });
    wrap.appendChild(el);
  });
}
function openList(){ renderList(); $('listView').classList.remove('hidden'); }
function closeList(){ $('listView').classList.add('hidden'); }

$('delCancel').addEventListener('click', () => { pendingDeleteId = null; $('delModal').classList.add('hidden'); });
$('delModal').addEventListener('click', e => { if (e.target === $('delModal')){ pendingDeleteId = null; $('delModal').classList.add('hidden'); } });
$('delGo').addEventListener('click', () => {
  notes = notes.filter(n => n.id !== pendingDeleteId);
  pendingDeleteId = null;
  saveNotes();
  $('delModal').classList.add('hidden');
  renderList(); render();
  toast('Deleted');
});

/* ---------------- home controls ---------------- */
$('recBtn').addEventListener('click', toggleRecord);
$('saveBtn').addEventListener('click', () => saveNoteAndNew(false));
$('listBtn').addEventListener('click', openList);
$('listClose').addEventListener('click', closeList);

/* ---------------- bubble: drag, snap, tap, options ---------------- */
const bubble = $('bubble');
let bpos = { side: 'right', top: 110 };
try { Object.assign(bpos, JSON.parse(localStorage.getItem(POS_KEY) || '{}')); } catch (e) {}
function placeBubble(){
  bubble.style.top = Math.max(64, Math.min(window.innerHeight - 92, bpos.top)) + 'px';
  bubble.style.left = bpos.side === 'left' ? '10px' : 'auto';
  bubble.style.right = bpos.side === 'right' ? '10px' : 'auto';
  bubble.classList.toggle('at-right', bpos.side === 'right');
  bubble.classList.toggle('at-left', bpos.side === 'left');
  bubble.classList.toggle('opts-down', bpos.top < 240);
  bubble.classList.toggle('opts-up', bpos.top >= 240);
}
placeBubble();
window.addEventListener('resize', placeBubble);

let drag = null;
$('bubbleMain').addEventListener('pointerdown', e => {
  drag = { x: e.clientX, y: e.clientY, top: bpos.top, moved: false, id: e.pointerId };
  $('bubbleMain').setPointerCapture(e.pointerId);
});
$('bubbleMain').addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 7) drag.moved = true;
  if (!drag.moved) return;
  bubble.style.top = Math.max(60, Math.min(window.innerHeight - 88, drag.top + dy)) + 'px';
  bubble.style.left = Math.max(4, Math.min(window.innerWidth - 72, e.clientX - 34)) + 'px';
  bubble.style.right = 'auto';
});
$('bubbleMain').addEventListener('pointerup', e => {
  if (!drag) return;
  const wasDrag = drag.moved;
  if (wasDrag){
    const cx = e.clientX;
    bpos.side = cx < window.innerWidth / 2 ? 'left' : 'right';
    bpos.top = Math.max(64, Math.min(window.innerHeight - 92, parseInt(bubble.style.top, 10) || bpos.top));
    localStorage.setItem(POS_KEY, JSON.stringify(bpos));
    placeBubble();
  }
  drag = null;
  if (!wasDrag){ hideOpts(); toggleRecord(); }
});
$('bubbleNub').addEventListener('click', e => {
  e.stopPropagation();
  $('opts').classList.toggle('hidden');
});
function hideOpts(){ $('opts').classList.add('hidden'); }
document.addEventListener('pointerdown', e => {
  if (!bubble.contains(e.target)) hideOpts();
});
$('optList').addEventListener('click', () => { hideOpts(); openList(); });
$('optCopy').addEventListener('click', () => {
  hideOpts();
  const cur = (finalText + ' ' + interimText).trim();
  if (cur) copyText(polish(cur), 'Current note copied');
  else if (notes.length) copyText(notes[0].text, 'Latest note copied');
  else toast('Nothing to copy yet');
});
$('optSave').addEventListener('click', () => { hideOpts(); saveNoteAndNew(false); });
$('optHide').addEventListener('click', () => {
  hideOpts();
  // Saves what's there, then collapses to just the floating bubble (+ caption).
  const text = (finalText + (interimText ? ' ' + interimText : '')).trim();
  if (wordCount(text) >= 1) saveNoteAndNew(true);
  if (state === 'live') setState('paused');
  $('home').classList.add('hidden');
  $('unhide').classList.remove('hidden');
  toast('Bubble only — swipe YapTap away in Recents to fully close');
});
$('unhide').addEventListener('click', () => {
  $('home').classList.remove('hidden');
  $('unhide').classList.add('hidden');
});

// refresh "x ago" labels while the list sits open
setInterval(() => { if (!$('listView').classList.contains('hidden')) renderList(); }, 60000);

render(); tick();

/* ---------- installing (the MindSplit arrangement, ported 2026-10-14) ----------
   The AI Lab card's download button opens /yaptap/?install=1. The sheet is
   MindSplit's: a bottom sheet half a screen tall with ONE primary button.
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
