/* Dictation: a brain dump, spoken.
 *
 * A microphone in the bottom-right of every text box. Press it and talk; the
 * words land at the caret. It keeps going until you stop it -- through tab
 * switches, through the engine ending its own session every minute or so,
 * through you editing what it just wrote -- and gives up only after ten
 * minutes in which nothing at all was said.
 *
 * THE FOUR THINGS THAT MAKE IT FEEL RIGHT
 *
 * 1. THE CARET IS THE INSERTION POINT, always. Click somewhere else mid-
 *    sentence and the next words land there; type a word yourself and the
 *    dictation continues after it; click into a different category and the
 *    session follows you there. There is no second cursor to keep in step
 *    with the real one, which is the machinery the app this borrows from
 *    spent six numbered bug fixes on and still got wrong across a re-render.
 *    The only fallback is for when the caret is genuinely gone -- focus left
 *    the app -- and then it is the last place it was.
 *
 * 2. PROVISIONAL WORDS ARE VISIBLE BUT NOT IN THE DOCUMENT. What the engine
 *    is still deciding shows as grey italic text in a <span class="nt-interim">
 *    marked contenteditable=false, so the browser will not type into it and
 *    the caret sits in front of it. It is removed before every history
 *    capture (editor.js calls clearInterim() at the top of transact and
 *    beforeinput) and stripped by serialize(), so it can never be undone
 *    into, saved, or spell-checked. Nothing provisional reaches the store --
 *    and nothing pulls it out from under the engine mid-utterance either,
 *    because the save path clones the body rather than editing it.
 *
 * 3. COMMITTING IS A DIFF, NOT A SWEEP. Chrome hands back a growing list of
 *    results in which an interim can turn final later. Worse, engines
 *    disagree about what a final IS: desktop Chrome sends each one as the NEW
 *    words, Android re-sends the WHOLE utterance every time. Committing
 *    "every final in this event" writes the sentence once on one and four
 *    times on the other. So the finals are reduced to one string -- the last
 *    slot if each starts with the one before it, the concatenation otherwise
 *    -- and only the part beyond what is already written gets inserted.
 *
 * 4. A CLICK CUTS THE UTTERANCE OFF. Move the caret while half a sentence is
 *    still provisional and that half is committed where it already is, then
 *    the recognizer is aborted and respawned. Without the abort the engine's
 *    own final for those words arrives a moment later and lands AGAIN at the
 *    new caret: the same words, in two places.
 *
 * WHY IT RESTARTS AT ALL. `continuous` does not mean forever: Chrome ends a
 * session on its own after a stretch of silence, and on some builds after a
 * fixed span regardless. `onend` starts a fresh one unless the stop was
 * deliberate. A monotonic session id guards it, so an `onend` arriving late
 * from a recognizer nobody is listening to cannot resurrect itself.
 *
 * THE MICROPHONE MUST BE ALLOWED BY THE PAGE. vercel.json's
 * Permissions-Policy said `microphone=()`, which forbids it to every origin
 * including this one, and SpeechRecognition is gated on that policy: the
 * request fails with `not-allowed` before any permission prompt appears. It
 * says `microphone=(self)` now, and that one word is the difference between
 * this working and looking like a permission the visitor denied.
 */

import { el, liveRange, collapseAt, caretToEnd, blockOf, dropTrailingBr, endOf } from './dom.js';
import { transact, bodyFrom } from './editor.js';
import { toast, ICON } from './ui.js';

/* Ten minutes of nothing said ends it. Any result -- even a half-word the
 * engine later discards -- puts the full ten minutes back, so a session lasts
 * as long as there is talking to do, which is what a brain dump needs and
 * what a fixed cap would keep interrupting. */
const SILENCE_MS = 10 * 60 * 1000;

/* Restarts that produce nothing, several in a row with no time between them,
 * mean the engine is wedged rather than waiting: Chrome will hand out
 * sessions that end instantly, forever. This counts every empty restart, not
 * only the ones that bothered to report an error. */
const DEAD_RESTARTS = 6;
const DEAD_WINDOW_MS = 8000;

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const supported = () => !!Recognition;

/* One microphone per machine. Two tabs of this page both listening is two
 * half-transcripts; the newest claim wins and the others stand down. */
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('dex-notes-mic') : null;

let ctx = null;
let session = null;      // the live session, or null
let sessionSeq = 0;      // monotonic: a late onend from an old recognizer must
                         // never match the id of a new session
let interim = null;      // the <span> holding provisional words
let tick = 0;            // the elapsed-time interval

export function initDictate(context) {
  ctx = context;
  document.addEventListener('selectionchange', onSelectionChange);
  ctx.canvas.addEventListener('pointerdown', onPointerDown, true);
  ctx.canvas.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', queuePill);
  if (channel) channel.addEventListener('message', onChannel);
}

export function shutdown() {
  if (session) stop('unmount');
  document.removeEventListener('selectionchange', onSelectionChange);
  ctx.canvas.removeEventListener('pointerdown', onPointerDown, true);
  ctx.canvas.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', queuePill);
  if (channel) channel.removeEventListener('message', onChannel);
  if (pill) { pill.remove(); pill = null; }
}

const onScroll = () => { if (session) queuePill(); };
const onChannel = (e) => { if (e.data && e.data.claim && session) stop('taken'); };

export const isRecording = (catId) => !!session && (catId === undefined || session.catId === catId);

/* ---- the button on a text box ------------------------------------------- */

export function micButton(catId) {
  const b = el('button', {
    type: 'button', class: 'nt-mic', 'data-cat': catId,
    'data-tip': 'Dictate', 'aria-label': 'Dictate into this text box',
    html: ICON.mic,
    onclick: (e) => { e.preventDefault(); toggle(catId); },
  });
  // Never take focus from the text: the caret is where the words go.
  b.addEventListener('mousedown', (e) => e.preventDefault());
  // A button for something the browser cannot do is worse than no button.
  if (!Recognition) b.hidden = true;
  if (isRecording(catId)) b.classList.add('is-live');
  return b;
}

/* The buttons are new elements after any render, so their state is painted
 * rather than remembered. */
export function paintButtons() {
  for (const b of ctx.root.querySelectorAll('.nt-mic')) {
    const live = isRecording(b.dataset.cat);
    b.classList.toggle('is-live', live);
    b.innerHTML = live ? ICON.micStop : ICON.mic;
    b.setAttribute('data-tip', live ? 'Stop dictating' : 'Dictate');
    b.setAttribute('aria-pressed', String(live));
  }
  ctx.root.classList.toggle('is-dictating', !!session);
}

/* ---- start and stop ------------------------------------------------------ */

export function toggle(catId) {
  if (session && session.catId === catId) { stop('button'); return; }
  if (session) stop('switch');
  start(catId);
}

/* Ctrl+Shift+M from anywhere in the app: the focused box, or the first one. */
export function toggleHere() {
  if (session) { stop('button'); return; }
  const body = focusedBody() || ctx.canvas.querySelector('.nt-body');
  if (body) toggle(body.dataset.cat);
}

function start(catId) {
  if (!Recognition) { toast('This browser has no speech recognition. Chrome does.', 'error'); return; }
  const body = ctx.bodyFor(catId);
  if (!body) return;

  session = {
    catId, id: ++sessionSeq, recog: null, committed: '',
    startedAt: Date.now(), lastHeard: Date.now(), stopping: false,
    restarts: 0, restartAt: 0, point: null,
  };

  /* On a phone, focusing the box raises the on-screen keyboard over the note
   * being dictated into. inputmode="none" keeps the caret and loses the
   * keyboard; it is put back on stop. */
  if (window.matchMedia('(max-width: 768px)').matches) {
    if (!body.hasAttribute('data-mode-was')) body.dataset.modeWas = body.getAttribute('inputmode') || '';
    body.setAttribute('inputmode', 'none');
  }

  // The first words need somewhere to go if the caret is not already here.
  const at = liveRange(ctx.canvas);
  if (!at || !bodyFrom(at.startContainer)) {
    body.focus({ preventScroll: true });
    if (!liveRange(body)) caretToEnd(body);
  }
  rememberPoint();
  spawn();
  paintButtons();
  showPill();
  tick = setInterval(() => { paintPill(); checkSilence(); }, 1000);
  if (channel) channel.postMessage({ claim: Date.now() });
}

export function stop(why) {
  if (!session) return;
  const s = session;
  s.stopping = true;
  session = null;
  clearInterval(tick);
  tick = 0;
  clearInterim();
  if (s.recog) {
    // Unhook before aborting: abort() fires onend, and an onend that can
    // still see its handlers is how a stopped session comes back to life.
    s.recog.onend = null;
    s.recog.onresult = null;
    s.recog.onerror = null;
    try { s.recog.abort(); } catch { /* already gone */ }
  }
  const body = ctx.bodyFor(s.catId);
  if (body && body.hasAttribute('data-mode-was')) {
    const was = body.dataset.modeWas;
    if (was) body.setAttribute('inputmode', was); else body.removeAttribute('inputmode');
    delete body.dataset.modeWas;
  }
  hidePill();
  paintButtons();
  if (why === 'silence') toast('Dictation stopped — ten minutes without a word.');
  if (why === 'denied') toast('Microphone blocked. Allow it for this site in the address bar, then try again.', 'error');
  if (why === 'nomic') toast('No microphone found.', 'error');
  if (why === 'dead') toast('Speech recognition stopped responding. Try again.', 'error');
  if (why === 'taken') toast('Dictation moved to another tab.');
}

function spawn() {
  const s = session;
  const recog = new Recognition();
  s.recog = recog;
  s.committed = '';               // each recognizer owns its own results list
  recog.continuous = true;
  recog.interimResults = true;
  recog.lang = document.documentElement.lang || navigator.language || 'en-US';
  recog.maxAlternatives = 1;
  // A brain dump is not a broadcast; do not star out its words.
  try { recog.profanityFilter = false; } catch { /* not everywhere */ }

  recog.onresult = (e) => {
    if (!session || session.id !== s.id) return;
    s.lastHeard = Date.now();
    s.restarts = 0;
    const finals = [];
    let live = '';
    for (let i = 0; i < e.results.length; i++) {
      const t = e.results[i][0].transcript || '';
      if (e.results[i].isFinal) { if (t) finals.push(t); } else live += t;
    }
    const fresh = unwritten(s, reduceFinals(finals));
    if (fresh.trim()) commit(fresh);
    showInterim(live);
  };

  recog.onerror = (e) => {
    if (!session || session.id !== s.id) return;
    // `no-speech` and `aborted` are ordinary: the engine ends a quiet session
    // and onend starts another. The silence clock, not this, decides when
    // enough is enough.
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stop('denied'); return; }
    if (e.error === 'audio-capture') { stop('nomic'); return; }
    // `network` and the rest: let onend try again, and let the dead detector
    // give up if it never comes back.
    console.warn('notes: dictation error', e.error);
  };

  recog.onend = () => {
    if (!session || session.id !== s.id || s.stopping) return;
    const now = Date.now();
    s.restarts = now - s.restartAt < DEAD_WINDOW_MS ? s.restarts + 1 : 1;
    s.restartAt = now;
    if (s.restarts >= DEAD_RESTARTS) { stop('dead'); return; }
    try { spawn(); } catch (err) { console.warn('notes: dictation restart failed', err); stop('dead'); }
  };

  try {
    recog.start();
  } catch {
    // start() throws if the previous recognizer has not released the
    // microphone yet. One retry on the next tick is all it ever needs.
    setTimeout(() => { try { if (session && session.id === s.id) recog.start(); } catch { stop('dead'); } }, 250);
  }
}

/* Cut the current utterance off and start a fresh recognizer. Used when the
 * caret moves mid-sentence: the words already on screen are committed where
 * they are, and this stops the engine delivering them again somewhere else.
 * abort(), not stop(): stop() flushes a final for exactly those words. */
function respawn() {
  const s = session;
  if (!s || !s.recog) return;
  const old = s.recog;
  s.recog = null;
  old.onresult = null;
  old.onerror = null;
  // The new one waits for the old to let go of the microphone.
  old.onend = () => { if (session === s && !s.stopping) spawn(); };
  try { old.abort(); } catch { spawn(); }
}

function checkSilence() {
  if (session && Date.now() - session.lastHeard >= SILENCE_MS) stop('silence');
}

/* ---- what is new since the last commit ----------------------------------- */

/* Engines disagree about what a final result is. Desktop Chrome sends the new
 * words each time; Android re-sends the whole utterance. If every slot starts
 * with the one before it they are snapshots, and the last one is the whole
 * utterance; otherwise they are increments, and they join. */
export function reduceFinals(finals) {
  if (!finals.length) return '';
  if (finals.length === 1) return finals[0];
  for (let i = 1; i < finals.length; i++) {
    const a = finals[i - 1].toLowerCase();
    const b = finals[i].toLowerCase();
    if (b.length < a.length || !b.startsWith(a)) return finals.join('');
  }
  return finals[finals.length - 1];
}

/* The part of `whole` that has not been written yet, plus the bookkeeping.
 * Case-insensitive, because an engine will re-send a sentence with different
 * capitalisation once it has decided where the sentence began. */
export function unwritten(s, whole) {
  if (!whole) return '';
  const done = s.committed;
  const lower = whole.toLowerCase();
  const doneLower = done.toLowerCase();
  if (lower === doneLower) return '';
  if (whole.length > done.length && lower.startsWith(doneLower)) {
    s.committed = whole;
    return whole.slice(done.length);
  }
  // A shorter re-emission of something already written: the engine changed
  // its mind about the tail. Leave what is on the page alone.
  if (done.length > whole.length && doneLower.startsWith(lower)) return '';
  // Unrelated: a new utterance in a list that was reset under us.
  s.committed = whole;
  return whole;
}

/* ---- where the words go --------------------------------------------------- */

const focusedBody = () => {
  const a = document.activeElement;
  return a && a.closest ? a.closest('.nt-body') : null;
};

function onSelectionChange() {
  if (!session) return;
  const r = liveRange(ctx.canvas);
  if (!r || !r.collapsed) return;
  const body = bodyFrom(r.startContainer);
  if (!body) return;
  // Into a different category: the session follows the caret, which is what
  // "carry on where I am now" has to mean.
  if (body.dataset.cat !== session.catId) {
    session.catId = body.dataset.cat;
    paintButtons();
    paintPill();
    queuePill();
  }
  rememberPoint();
}

/* A deliberate click somewhere else with words still provisional: keep them
 * where they were said, and cut the engine off (see the header, point 4). */
function onPointerDown(e) {
  if (!session || !interim) return;
  if (!bodyFrom(e.target)) return;
  if (interim.contains(e.target)) return;
  commitInterimInPlace();
  respawn();
}

/* The caret, as something that survives focus leaving the app. */
function rememberPoint() {
  const r = liveRange(ctx.canvas);
  if (!r || !r.collapsed) return;
  if (!bodyFrom(r.startContainer)) return;
  if (interim && interim.contains(r.startContainer)) return;
  session.point = { node: r.startContainer, offset: r.startOffset };
}

/* Where to write: the live caret if it is in a body, else the last place it
 * was, else the end of the recording box. */
function target() {
  const body = ctx.bodyFor(session.catId);
  if (!body) return null;
  let node = null;
  let offset = 0;
  const r = liveRange(body);
  const p = session.point;
  if (r && r.collapsed && !(interim && interim.contains(r.startContainer))) {
    node = r.startContainer; offset = r.startOffset;
  } else if (p && p.node.isConnected && body.contains(p.node)) {
    node = p.node; offset = p.offset;
  }
  /* Never write at the body's own root. Selecting everything and clicking,
     or a caret left over from a rebuild, can put it there, and a bare text
     node between two blocks is not something the schema allows -- it comes
     back as a paragraph on the next load, so what was saved and what was on
     screen would not match. The end of the last line is what "the end" means
     to a person anyway. */
  if (!node || !blockOf(body, node)) {
    let last = body.lastElementChild;
    while (last && /^(UL|OL)$/.test(last.tagName)) last = last.lastElementChild;
    if (!last) return { body, node: body, offset: body.childNodes.length };
    const at = endOf(last);
    node = at.node; offset = at.offset;
  }
  return { body, node, offset };
}

/* ---- provisional words ---------------------------------------------------- */

export function clearInterim() {
  if (!interim) return;
  const node = interim;
  interim = null;
  node.remove();
}

function showInterim(text) {
  const t = text.trim();
  if (!t) { clearInterim(); return; }
  const at = target();
  if (!at) return;
  const lead = needsSpace(at) ? ' ' : '';
  if (interim && interim.isConnected) { interim.textContent = lead + t; return; }
  interim = el('span', { class: 'nt-interim', contenteditable: 'false', text: lead + t });
  const r = document.createRange();
  try { r.setStart(at.node, at.offset); } catch { interim = null; return; }
  r.collapse(true);
  r.insertNode(interim);
  /* insertNode can split the text node the caret was in. Put the caret back
     immediately BEFORE the span, so anything typed goes in front of the
     provisional words rather than into them. */
  const parent = interim.parentNode;
  try { collapseAt(parent, Array.prototype.indexOf.call(parent.childNodes, interim)); } catch { /* fine */ }
}

/* Turn what is on screen into real text, exactly where it sits. */
function commitInterimInPlace() {
  if (!interim || !interim.isConnected) { clearInterim(); return; }
  const span = interim;
  interim = null;
  const body = bodyFrom(span);
  const text = span.textContent;
  if (!text.trim() || !body) { span.remove(); return; }
  transact(body, () => {
    const node = document.createTextNode(text);
    span.replaceWith(node);
    const block = blockOf(body, node);
    if (block) dropTrailingBr(block);
    body.normalize();
  });
  ctx.spell.rescan(body);
}

/* ---- committing ------------------------------------------------------------ */

function commit(raw) {
  clearInterim();
  const at = target();
  if (!at) return;
  const text = polish(raw, at);
  if (!text) return;
  transact(at.body, () => {
    const node = document.createTextNode(text);
    const r = document.createRange();
    try { r.setStart(at.node, at.offset); } catch { at.body.append(node); collapseAt(node, node.length); return; }
    r.collapse(true);
    r.insertNode(node);
    // An empty block holds a <br> so it has a line to click on. Once there
    // are words in it that <br> is a blank line after them.
    const block = blockOf(at.body, node);
    if (block) dropTrailingBr(block);
    collapseAt(node, node.length);
    at.body.normalize();
  });
  rememberPoint();
  ctx.spell.rescan(at.body);
}

/* A space before the words unless one is there already, and a capital when a
 * sentence is starting. Chrome punctuates, but knows nothing about what is
 * already on the line in front of the caret. */
function polish(raw, at) {
  let text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const before = textBefore(at);
  if (!before.trim() || /[.!?]["')\]]?\s*$/.test(before)) text = text[0].toUpperCase() + text.slice(1);
  if (needsSpace(at) && !/^[,.!?;:)\]]/.test(text)) text = ` ${text}`;
  return text;
}

function needsSpace(at) {
  const before = textBefore(at);
  return !!before && !/[\s(\[—–-]$/.test(before);
}

/* The characters immediately before the insertion point, within its block,
 * with any provisional words taken out. Measuring THROUGH them is how the app
 * this borrows from lost the space between two utterances. */
function textBefore(at) {
  const block = blockOf(at.body, at.node) || at.body;
  const probe = document.createRange();
  probe.selectNodeContents(block);
  try { probe.setEnd(at.node, at.offset); } catch { return ''; }
  const frag = probe.cloneContents();
  frag.querySelectorAll('.nt-interim').forEach((n) => n.remove());
  return frag.textContent.slice(-80);
}

/* ---- the pill --------------------------------------------------------------- */

/* Scroll the recording box out of sight and a pill appears at the top-left of
 * the canvas, clear of the sidebar: what is being dictated into, for how long,
 * a way back to it, and a way to stop. Without it, a session left running in a
 * category three screens up is invisible and still writing. */
let pill = null;
let pillFrame = 0;

function showPill() {
  if (!pill) {
    pill = el('div', { class: 'nt-pill', role: 'status', 'aria-live': 'polite' },
      el('span', { class: 'nt-pill-dot' }),
      el('button', {
        type: 'button', class: 'nt-pill-main', 'data-tip': 'Scroll back to it',
        onclick: () => { if (session) ctx.scrollToCat(session.catId); },
      }, el('span', { class: 'nt-pill-name' }), el('span', { class: 'nt-pill-time' })),
      el('button', { type: 'button', class: 'nt-pill-stop', 'data-tip': 'Stop dictating', html: ICON.micStop, 'aria-label': 'Stop dictating', onclick: () => stop('button') }));
    ctx.root.append(pill);
  }
  paintPill();
  queuePill();
}

function hidePill() { if (pill) pill.classList.remove('is-on'); }

function paintPill() {
  if (!pill || !session) return;
  pill.querySelector('.nt-pill-name').textContent = ctx.catTitle(session.catId);
  const secs = Math.floor((Date.now() - session.startedAt) / 1000);
  pill.querySelector('.nt-pill-time').textContent =
    `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
}

function queuePill() {
  if (pillFrame || !session) return;
  pillFrame = requestAnimationFrame(() => {
    pillFrame = 0;
    if (!pill || !session) return;
    const body = ctx.bodyFor(session.catId);
    if (!body) { pill.classList.add('is-on'); return; }
    const b = body.getBoundingClientRect();
    const view = ctx.canvas.getBoundingClientRect();
    // Generous on purpose: a box with its last line still showing is still
    // the box you are looking at.
    const seen = Math.min(view.bottom, b.bottom) - Math.max(view.top, b.top);
    pill.classList.toggle('is-on', seen < 40);
    paintPill();
  });
}
