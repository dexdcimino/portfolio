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
let namingId = null;          // the note whose name field is open (v1.6)

let state = 'idle';           // idle | live | paused
let wantRecord = false;
let rec = null;
let restartTimer = null;
let wakeLock = null;
let pendingDeleteId = null;
let pendingBulk = false;    // the delete confirm is for the whole selection

/* multi-select (v1.6): long-press a card to enter, taps toggle, a
   long-press drag selects the run it crosses */
let selMode = false;
const selectedIds = new Set();
let dragSel = null;           // { anchorIdx, base:Set } while a drag runs
let swallowUntil = 0;         // clicks landing before this time belong to a long-press/drag
const swallowed = () => { if (Date.now() < swallowUntil){ swallowUntil = 0; return true; } return false; };

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
if (!SR) setTimeout(() => toast("This browser can't do live transcription — open YapTap in Chrome on Android"), 600);

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
    startRec();
    grabWakeLock();
  } else if (next === 'paused'){
    state = 'paused';
    wantRecord = false;
    clearTimeout(restartTimer);
    try { rec && rec.stop(); } catch (e) {}
    interimText = '';
    commitDraftNote();
    dropWakeLock();
  } else {
    state = 'idle';
    wantRecord = false;
    clearTimeout(restartTimer);
    try { rec && rec.stop(); } catch (e) {}
    interimText = '';
    dropWakeLock();
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
/* The phone app's screen, mirrored: the caption carries the live words,
   the draft panel exists only while an uncommitted draft does, and the
   bottom stack's status line reads like the phone's — what's on, what
   the mic is doing. There is no stage/draft box and no timer: the phone
   app has neither. */
function render(){
  // the draft banner: the phone shows its draft whenever one exists;
  // while recording, the caption is the words' home instead
  const banner = $('draftBanner');
  const showDraft = state !== 'live' && finalText.trim().length > 0;
  banner.classList.toggle('hidden', !showDraft);
  if (showDraft){
    const tail = finalText.trim().split(/\s+/).slice(-40).join(' ');
    banner.textContent = 'Current note (not saved yet):\n' + tail;
  }

  // live caption: the tail of what's being said, one smooth line
  const tail = (finalText + ' ' + interimText).trim().split(/\s+/).slice(-14).join(' ');
  $('capText').textContent = state === 'idle' && !tail ? 'Tap the bubble and just talk…' : (tail || 'Listening…');
  const cs = $('capScroll');
  requestAnimationFrame(() => { cs.scrollLeft = cs.scrollWidth; });

  const cap = $('caption');
  cap.classList.toggle('live', state === 'live');
  cap.classList.toggle('paused', state === 'paused');
  cap.classList.toggle('idle', state === 'idle');

  // the status line, in the phone app's own format
  const parts = [];
  parts.push(SR ? 'Mic ✓' : 'Mic ✗ — needs Chrome on Android');
  parts.push(bubbleVisible ? 'Bubble on' : 'Bubble off');
  if (state === 'live') parts.push('Transcribing…');
  else if (state === 'paused') parts.push('Paused');
  $('statusLine').textContent = parts.join('   ');

  const bm = $('bubbleMain');
  bm.classList.toggle('live', state === 'live');
  bm.classList.toggle('paused', state === 'paused');
  $('bubbleBtnLabel').textContent = bubbleVisible ? 'Hide bubble' : 'Show bubble';
  setSyncHint();
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
let suppressStickOnce = false;
$('listScroll').addEventListener('scroll', () => {
  const el = $('listScroll');
  stickBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 48;
});

/* A note's display meta (v1.6, the phone app's NoteStore.displayMeta):
   its name when it has one — the name REPLACES the stats — else
   "2h ago · 128 words". The date+time footer never changes. */
function displayMeta(n){
  return (n.title && n.title.trim()) ? n.title.trim()
    : ago(n.ts) + ' · ' + wordCount(n.text) + ' words';
}
function whenText(n){
  return new Date(n.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' +
    new Date(n.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
/* The bulk copy format, byte-for-byte the phone app's: per note a header
   line (name-or-meta, plus the date), then the full text; blocks
   separated by one blank line, in list order. */
function bulkCopyText(inListOrder){
  return inListOrder.map(n => displayMeta(n) + ' · ' + whenText(n) + '\n' + n.text).join('\n\n');
}
const displayOrder = () => [...notes].sort((a, b) => (a.ts - b.ts) || String(a.id).localeCompare(String(b.id)));

/* ---------------- in-place editing (v1.6) ----------------
   The expanded body is a contenteditable: double-tap selects words,
   the keyboard edits. The edit flushes to the store (text + fresh
   `updated`, so sync carries it) on collapse, on switching notes, on
   delete, on entering selection, and before any list rebuild the user
   asked for. Rebuilds that arrive on their own (the minute tick, a sync
   landing) wait while an editor has focus — nothing typed is ever lost
   to a repaint. */
function editActive(){
  const a = document.activeElement;
  return !!(a && (a.classList.contains('note-edit') || a.classList.contains('note-name-input')));
}
function flushEdit(){
  const ed = $('listItems').querySelector('.note-edit');
  if (!ed) return;
  const n = notes.find(x => x.id === ed.dataset.id);
  const txt = (ed.innerText || '').replace(/\n+$/, '');
  if (n && txt !== n.text){
    n.text = txt;
    n.updated = Date.now();
    saveNotes();
    queueSync();
  }
  ed.blur();
}
function finishNameEdit(){
  if (!namingId) return;
  const input = $('listItems').querySelector('.note-name-input');
  const n = notes.find(x => x.id === namingId);
  namingId = null;
  if (input) input.blur();
  if (input && n){
    const t = input.value.trim();
    if (t !== (n.title || '')){
      if (t) n.title = t; else delete n.title;
      n.updated = Date.now();
      saveNotes();
      queueSync();
    }
  }
  renderList();
}

function renderList(){
  if (editActive()) return;   // a repaint must never eat an in-progress edit
  $('listEmpty').classList.toggle('hidden', notes.length > 0);
  const wrap = $('listItems');
  wrap.innerHTML = '';
  const display = displayOrder();
  display.forEach((n, idx) => {
    const el = document.createElement('div');
    el.className = 'note' + (n.id === expandedId ? ' expanded' : '') + (selMode && selectedIds.has(n.id) ? ' selected' : '');
    el.dataset.id = n.id;
    el.dataset.idx = idx;
    const naming = n.id === namingId;
    el.innerHTML =
      '<div class="note-body hidden"></div>' +
      '<div class="note-head">' +
        '<button class="note-del" aria-label="Delete this transcription"><svg viewBox="0 0 24 24" class="ic"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/></svg></button>' +
        (naming
          ? '<input class="note-name-input" type="text" placeholder="Name this note" autocomplete="off">'
          : '<button class="note-meta"></button>') +
        '<button class="note-rename" aria-label="Name this note"><svg viewBox="0 0 24 24" class="ic"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>' +
        '<button class="note-copy" aria-label="Copy this transcription"><svg viewBox="0 0 24 24" class="ic"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
      '</div>' +
      '<div class="note-when"></div>';
    const body = el.querySelector('.note-body');
    body.dataset.id = n.id;
    body.textContent = n.text;
    body.classList.toggle('hidden', n.id !== expandedId);
    if (n.id === expandedId){
      body.setAttribute('contenteditable', 'true');
      body.classList.add('note-edit');
      body.setAttribute('spellcheck', 'false');
    }
    el.querySelector('.note-when').textContent = whenText(n);
    if (naming){
      const input = el.querySelector('.note-name-input');
      input.value = n.title || '';
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter'){ e.preventDefault(); finishNameEdit(); }
        if (e.key === 'Escape'){ namingId = null; renderList(); }
      });
      input.addEventListener('blur', () => { if (namingId === n.id) finishNameEdit(); });
    } else {
      el.querySelector('.note-meta').textContent = displayMeta(n);
      el.querySelector('.note-meta').addEventListener('click', ev => {
        if (swallowed()) return;
        if (selMode){ toggleSelected(n.id); return; }
        toggleExpand(n, el);
      });
    }
    el.querySelector('.note-rename').addEventListener('click', () => {
      if (swallowed()) return;
      if (selMode){ toggleSelected(n.id); return; }
      if (namingId === n.id){ finishNameEdit(); return; }
      flushEdit();
      namingId = n.id;
      renderList();
      const input = wrap.querySelector('.note-name-input');
      if (input){ input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    });
    el.querySelector('.note-copy').addEventListener('click', () => {
      if (swallowed()) return;
      if (selMode){ toggleSelected(n.id); return; }
      copyText(n.text);
    });
    el.querySelector('.note-del').addEventListener('click', () => {
      if (swallowed()) return;
      if (selMode){ toggleSelected(n.id); return; }
      pendingDeleteId = n.id;
      pendingBulk = false;
      $('delText').textContent = 'Delete this transcription?';
      $('delModal').classList.remove('hidden');
    });
    wrap.appendChild(el);
  });
  if (stickBottom && !suppressStickOnce){
    const el = $('listScroll');
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }
  suppressStickOnce = false;
  renderSelBar();
}

/* Expand/collapse with the header pinned: the head's screen Y is read
   before the toggle; after the rebuild the scroll is adjusted by the
   delta, so the header stays exactly where the finger tapped it and the
   body unfolds above. If the card's top would leave the viewport, the
   card is clamped fully inside instead — never off-screen. */
function toggleExpand(n, el){
  const head = el.querySelector('.note-head');
  const beforeY = head.getBoundingClientRect().top;
  flushEdit();
  finishNameEditSilent();
  expandedId = expandedId === n.id ? null : n.id;
  renderList();
  requestAnimationFrame(() => {
    const el2 = $('listItems').querySelector('.note[data-id="' + n.id + '"]');
    if (!el2) return;
    const head2 = el2.querySelector('.note-head');
    const listEl = $('listScroll');
    const delta = head2.getBoundingClientRect().top - beforeY;
    if (delta) listEl.scrollTop += delta;
    const cRect = listEl.getBoundingClientRect();
    const cardRect = el2.getBoundingClientRect();
    if (cardRect.top < cRect.top) listEl.scrollTop -= (cRect.top - cardRect.top);
    if (cardRect.bottom > cRect.bottom && cardRect.height <= cRect.height) listEl.scrollTop += (cardRect.bottom - cRect.bottom);
  });
}
function finishNameEditSilent(){
  if (!namingId) return;
  const input = $('listItems').querySelector('.note-name-input');
  const n = notes.find(x => x.id === namingId);
  namingId = null;
  if (input) input.blur();
  if (input && n){
    const t = input.value.trim();
    if (t !== (n.title || '')){
      if (t) n.title = t; else delete n.title;
      n.updated = Date.now();
      saveNotes();
      queueSync();
    }
  }
}

function deleteNotesById(ids){
  const kill = new Set(ids);
  const now = Date.now();
  notes = notes.filter(n => !kill.has(n.id));
  tombstones = tombstones.filter(d => !kill.has(d.id));
  ids.forEach(id => tombstones.push({ id, ts: now }));
  ids.forEach(id => {
    if (expandedId === id) expandedId = null;
    if (namingId === id) namingId = null;
    if (openNoteId === id){ openNoteId = null; finalText = ''; interimText = ''; saveDraft(); }
  });
  saveNotes(); saveTombstones();
}
$('delCancel').addEventListener('click', () => { pendingDeleteId = null; pendingBulk = false; $('delModal').classList.add('hidden'); });
$('delModal').addEventListener('click', e => { if (e.target === $('delModal')){ pendingDeleteId = null; pendingBulk = false; $('delModal').classList.add('hidden'); } });
$('delGo').addEventListener('click', () => {
  flushEdit();
  if (pendingBulk){
    deleteNotesById([...selectedIds]);
    exitSelection();
  } else if (pendingDeleteId){
    deleteNotesById([pendingDeleteId]);
  }
  pendingDeleteId = null;
  pendingBulk = false;
  $('delModal').classList.add('hidden');
  renderList(); render();
  queueSync();
  toast('Deleted');
});

// refresh "x ago" labels while the app sits open (waits out an edit)
setInterval(() => { renderList(); }, 60000);

/* ---------------- multi-select (v1.6) ----------------
   Long-press a card (380ms, still) enters selection mode and selects
   it; keep the press moving and every card it crosses joins the run
   from the anchor — retract and the run shrinks back to what was
   selected when the press began. In selection mode, plain taps toggle
   any card, anywhere in the list (scroll freely). Exit with the bar's
   ✕, Esc, or by deselecting the last card. The click that ends the
   entering press is swallowed so it can't undo the selection. */
function renderSelBar(){
  const bar = $('selBar');
  bar.classList.toggle('hidden', !selMode);
  if (bar) $('selCount').textContent = selectedIds.size + (selectedIds.size === 1 ? ' note selected' : ' notes selected');
}
function enterSelection(id, idx){
  flushEdit();
  finishNameEditSilent();
  expandedId = null;
  selMode = true;
  selectedIds.clear();
  selectedIds.add(id);
  dragSel = { anchorIdx: idx, base: new Set(selectedIds) };
  $('listScroll').style.overflowY = 'hidden';
  document.querySelectorAll('.note').forEach(el => {
    el.classList.toggle('selected', selectedIds.has(el.dataset.id));
  });
  renderSelBar();
  if (navigator.vibrate) navigator.vibrate(12);
}
function exitSelection(){
  selMode = false;
  selectedIds.clear();
  dragSel = null;
  document.querySelectorAll('.note').forEach(el => el.classList.remove('selected'));
  renderSelBar();
}
function toggleSelected(id){
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  if (!selectedIds.size){ exitSelection(); return; }
  const el = $('listItems').querySelector('.note[data-id="' + id + '"]');
  if (el) el.classList.toggle('selected', selectedIds.has(id));
  renderSelBar();
}
function applyDragRange(idx){
  if (!dragSel) return;
  const order = displayOrder();
  const lo = Math.min(dragSel.anchorIdx, idx), hi = Math.max(dragSel.anchorIdx, idx);
  const next = new Set(dragSel.base);
  for (let i = lo; i <= hi; i++) if (order[i]) next.add(order[i].id);
  selectedIds.clear();
  next.forEach(id => selectedIds.add(id));
  document.querySelectorAll('.note').forEach(el => {
    el.classList.toggle('selected', selectedIds.has(el.dataset.id));
  });
  renderSelBar();
}
$('selClose').addEventListener('click', exitSelection);
$('selCopy').addEventListener('click', () => {
  const sel = displayOrder().filter(n => selectedIds.has(n.id));
  if (!sel.length) return;
  copyText(bulkCopyText(sel), sel.length === 1 ? 'Copied' : 'Copied ' + sel.length + ' notes');
});
$('selTrash').addEventListener('click', () => {
  if (!selectedIds.size) return;
  pendingBulk = true;
  pendingDeleteId = null;
  $('delText').textContent = selectedIds.size === 1 ? 'Delete this transcription?'
    : 'Delete ' + selectedIds.size + ' transcriptions?';
  $('delModal').classList.remove('hidden');
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && selMode) exitSelection(); });

/* press tracking on the cards (delegated: the list re-renders often) */
let pressCand = null;
$('listItems').addEventListener('pointerdown', e => {
  const card = e.target.closest('.note');
  if (!card) return;
  pressCand = { id: card.dataset.id, idx: +card.dataset.idx, x: e.clientX, y: e.clientY, fired: false };
  const cand = pressCand;
  cand.timer = setTimeout(() => {
    cand.fired = true;
    swallowUntil = Date.now() + 450;
    if (!selMode) enterSelection(cand.id, cand.idx);
    else {
      dragSel = { anchorIdx: cand.idx, base: new Set(selectedIds) };
      $('listScroll').style.overflowY = 'hidden';
    }
  }, selMode ? 250 : 380);
});
document.addEventListener('pointermove', e => {
  if (!pressCand) return;
  if (dragSel){
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const card = el && el.closest ? el.closest('.note') : null;
    if (card) applyDragRange(+card.dataset.idx);
    return;
  }
  if (Math.abs(e.clientX - pressCand.x) + Math.abs(e.clientY - pressCand.y) > 9){
    clearTimeout(pressCand.timer);
    pressCand = null;
  }
});
function endPress(){
  if (!pressCand) return;
  clearTimeout(pressCand.timer);
  const wasDrag = !!dragSel;
  pressCand = null;
  if (wasDrag){
    dragSel = null;
    $('listScroll').style.overflowY = '';
    swallowUntil = Date.now() + 450;
  }
}
document.addEventListener('pointerup', endPress);
document.addEventListener('pointercancel', endPress);

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
   A sine wave wrapped around the bubble over a breathing pool of light:
   r(θ) = R + A·[(1−m)·sin(5θ+φ) + m·sin(9θ−0.8φ)] — two integer
   harmonics so the loop always closes. The same motion design as the
   Android app's WaveRingView v2: the amplitude breathes (2.6s, never
   fully asleep), the blend m drifts the apparent frequency (3.9s), the
   wave rotates (7s), the radius pulsates (±3.5%, 1.7s), the stroke
   varies (1.9s), a second ring at 0.65 amplitude runs its phase
   BACKWARD so the two weave, and a soft red glow at the centre —
   swelling on the same breath as the amplitude — lights the bubble's
   face from behind. Recording red #FF4757 with a #FF8291 echo.
   NOTHING CLIPS: R is solved from the canvas — R = (avail − Amax −
   strokeMax/2) / (1 + pulseMax), avail = half the canvas minus 3px —
   and the glow is a fill whose radius (R + 0.55·A) stays inside the
   wave's own extent budget. The frame's worst case, the glow level and
   the periods are published on dataset for checks. */
const wave = { raf: 0, startMs: 0 };
function startWave(){
  const cv = $('bubbleWave');
  if (!cv) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(88 * dpr)){ cv.width = Math.round(88 * dpr); cv.height = Math.round(88 * dpr); }
  cv.classList.remove('hidden');
  cv.dataset.periods = '2.6,3.9,7.0,1.7';
  wave.startMs = performance.now();
  cancelAnimationFrame(wave.raf);
  const ctx = cv.getContext('2d');
  const draw = () => {
    const t = (performance.now() - wave.startMs) / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, 88, 88);
    const avail = 41, strokeMax = 3.4, aMax = 5.6, pulseMax = 0.035;
    const R0 = (avail - aMax - strokeMax / 2) / (1 + pulseMax);
    const breathEnv = 0.5 + 0.5 * Math.sin(2 * Math.PI * t / 2.6 - Math.PI / 2);
    const breath = Math.pow(breathEnv, 1.2);
    const A = aMax * (0.12 + 0.88 * breath);
    const mix = 0.5 + 0.5 * Math.sin(2 * Math.PI * t / 3.9 + 1.1);
    const phi = 2 * Math.PI * t / 7.0;
    const R = R0 * (1 + pulseMax * Math.sin(2 * Math.PI * t / 1.7));
    const stroke = 2.2 + 1.2 * (0.5 + 0.5 * Math.sin(2 * Math.PI * t / 1.9 + 0.6));
    // the glow: a pool of red light under the rings, breathing with them
    const glow = 0.10 + 0.28 * Math.pow(breathEnv, 1.6);
    const gr = R + A * 0.55;
    const grad = ctx.createRadialGradient(44, 44, 0, 44, 44, gr);
    grad.addColorStop(0, 'rgba(255,71,87,' + glow.toFixed(3) + ')');
    grad.addColorStop(1, 'rgba(255,71,87,0)');
    ctx.beginPath();
    ctx.arc(44, 44, gr, 0, 2 * Math.PI);
    ctx.fillStyle = grad;
    ctx.fill();
    const ring = (amp, phiUse, shift, width, color) => {
      ctx.beginPath();
      for (let i = 0; i <= 180; i++){
        const th = 2 * Math.PI * i / 180;
        const r = R + amp * ((1 - mix) * Math.sin(5 * th + phiUse + shift) + mix * Math.sin(9 * th - 0.8 * phiUse + shift));
        const x = 44 + r * Math.cos(th), y = 44 + r * Math.sin(th);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
      ctx.stroke();
    };
    ring(A * 0.65, -0.9 * phi, 0.5, Math.max(1, stroke * 0.38), '#ff8291');
    ring(A, phi, 0, stroke, '#ff4757');
    cv.dataset.maxr = (R + A + stroke / 2).toFixed(2);
    cv.dataset.avail = avail;
    cv.dataset.glow = glow.toFixed(3);
    cv.dataset.t = t.toFixed(2);
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
  // The account row's state line is the sync state's home now (the phone
  // app's row reads the same way: who's in, or "On this phone only").
  const stateEl = $('acctStateText');
  if (stateEl){
    stateEl.textContent = siteUser
      ? (msg || (syncBusy ? 'Syncing…' : (siteUser.email || 'Signed in')))
      : 'On this phone only';
  }
  const el2 = $('acctSyncState');
  if (el2 && siteUser) el2.textContent = syncBusy ? 'Syncing…' : 'Your notes sync to this account.';
}

function renderAccount(){
  $('acctBtnLabel').textContent = siteUser ? 'Account' : 'Sign in';
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
$('acctNotNow').addEventListener('click', () => $('acctSheet').classList.add('hidden'));
$('acctDone').addEventListener('click', () => $('acctSheet').classList.add('hidden'));
$('acctSheet').addEventListener('click', e => { if (e.target === $('acctSheet')) $('acctSheet').classList.add('hidden'); });

/* Email is the fourth way in: a quiet button swaps the provider column
   for the form, in the same column — the site's own layout. */
$('acctEmailWay').addEventListener('click', () => {
  $('acctProviders').classList.add('hidden');
  $('acctForm').classList.remove('hidden');
  $('acctMsg').textContent = '';
  $('acctEmail').focus();
});
$('acctBack').addEventListener('click', () => {
  $('acctForm').classList.add('hidden');
  $('acctProviders').classList.remove('hidden');
  $('acctMsg').textContent = '';
});
$('acctForm').addEventListener('submit', e => { e.preventDefault(); emailGo(false); });

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
/* The install control in the main row opens the compact sheet — the
   sheet itself is never permanent page text (Dex, 2026-10-14). */
$('installBtn').addEventListener('click', showInstallSheet);
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
bootAccount();
