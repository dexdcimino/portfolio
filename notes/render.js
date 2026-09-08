/* Rendering and structure: the sidebar, the rail, the canvas, the sessions
 * popup and the archive, plus every operation that changes the shape of a
 * session (add, rename, recolour, reorder, archive, restore, delete).
 *
 * Every structural change runs inside ctx.history.structure(), which snapshots
 * the session before and after, so a deleted category comes back with Ctrl+Z
 * exactly as it was, body and all.
 *
 * Bodies are rendered once and then left alone: a re-render of the canvas
 * keeps any body that is unchanged and focused, so an autosave or a sidebar
 * change never moves the caret. Only the category whose structure changed
 * is rebuilt.
 */

import { el, closest, caretToEnd } from './dom.js';
import { newCat, newSession, catOf, archivedOf, touch, snapshot, restore, PALETTE, SESSION_PALETTE, now } from './state.js';
import { confirm, toast, menu, panel, closePanel, ICON } from './ui.js';
import { contrastOn, tints } from './color.js';

let ctx = null;
export function initRender(context) {
  ctx = context;
  // The one grab edge between the list and the archive. Delegated, because
  // the sidebar's insides are rebuilt and the edge is not.
  ctx.sidebar.addEventListener('pointerdown', onGripDown);
  /* CLICKING OFF A PICK DROPS IT. A plain click on another row already
     replaces the pick, but clicking the empty space under the list, the
     canvas, or anything else left four rows ringed with no way to tell
     whether the next X would take one or all of them.
     What is EXEMPT is anything acting on the pick: a row (which handles its
     own click), a floating panel -- the colour picker is opened from a picked
     row and clicking in it must not clear what it is painting -- and a modal,
     which is the archive confirmation asking about the pick. */
  ctx.root.addEventListener('pointerdown', (e) => {
    if (!picked.size) return;
    if (e.target.closest('.nt-row, .nt-arch-row, .nt-panel, .nt-modal')) return;
    clearPicks();
  }, true);
  /* The tab is welded to the archive, so it moves whenever the archive does:
     the split drag, the fold, a window resize, the sidebar collapsing. One
     observer covers all four without a listener per cause. */
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => syncTab()).observe(ctx.sidebar);
  }
  window.addEventListener('resize', syncTab);
}

/* ---- the split between the list and the archive ----------------------------
 * They are welded: one drag decides how the leftover height is shared, and
 * the number is saved, because a sidebar that forgets how you sized it is a
 * sidebar you resize every time you open it. */
export function applySplit() {
  const share = Math.max(20, Math.min(80, Number(ctx.doc.ui.archSplit) || 72));
  ctx.root.style.setProperty('--list-flex', String(share));
  ctx.root.style.setProperty('--arch-flex', String(100 - share));
}

function onGripDown(e) {
  const grip = e.target.closest('.nt-archive-grip');
  if (!grip || e.button !== 0) return;
  e.preventDefault();
  grip.setPointerCapture(e.pointerId);
  const rows = ctx.sidebar.querySelector('.nt-rows');
  const foot = ctx.sidebar.querySelector('.nt-sidebar-foot');
  const top = rows.getBoundingClientRect().top;
  const span = foot.getBoundingClientRect().top - top;
  ctx.sidebar.classList.add('is-splitting');
  const move = (ev) => {
    if (span < 120) return;
    const share = Math.max(20, Math.min(80, ((ev.clientY - top) / span) * 100));
    ctx.doc.ui.archSplit = Math.round(share);
    applySplit();
    syncTab();
  };
  const up = () => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    grip.removeEventListener('pointercancel', up);
    ctx.sidebar.classList.remove('is-splitting');
    syncTab();
    ctx.uiChanged();
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', up);
}

/* ---- renaming in place -----------------------------------------------------
 * A title in the sidebar is renamed IN the sidebar. Double-click turns the
 * text into a field with everything selected, Enter or clicking away keeps
 * it, Escape puts back what was there. Used by the session's name at the top
 * and by every category row under it. */
export function wireInlineTitle(node, { get, set, max = 80 }) {
  const start = () => {
    if (node.isContentEditable) return;
    node.textContent = get();
    node.contentEditable = 'true';
    node.spellcheck = false;
    node.classList.add('is-editing');
    node.focus();
    selectAll(node);
  };
  const stop = (keep) => {
    if (!node.isContentEditable) return;
    const text = node.textContent;
    // Cleared BEFORE set(), because set() re-renders and a re-entrant blur
    // would otherwise commit the same edit twice.
    node.contentEditable = 'false';
    node.classList.remove('is-editing');
    const sel = window.getSelection();
    if (sel && node.contains(sel.anchorNode)) sel.removeAllRanges();
    if (keep) set(text.slice(0, max)); else node.textContent = get();
  };
  node.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); start(); });
  node.addEventListener('mousedown', (e) => { if (node.isContentEditable) e.stopPropagation(); });
  node.addEventListener('keydown', (e) => {
    if (!node.isContentEditable) return;
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); stop(true); }
    else if (e.key === 'Escape') { e.preventDefault(); stop(false); }
  });
  node.addEventListener('blur', () => stop(true));
  node.addEventListener('paste', (e) => {
    e.preventDefault();
    document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' '));
  });
  node.startEdit = start;
  return start;
}

/* ---- helpers ---------------------------------------------------------------- */

const GRAPHEME = /^(\p{Extended_Pictographic}(️|\p{Emoji_Modifier})?(‍\p{Extended_Pictographic}(️|\p{Emoji_Modifier})?)*)/u;

/* What the rail shows: the emoji if there is one, else the first letter. */
export function glyph(item) {
  if (item.emoji) return { text: item.emoji, emoji: true };
  const t = (item.title || '').trim();
  const m = GRAPHEME.exec(t);
  if (m) return { text: m[0], emoji: true };
  return { text: t ? [...t][0].toUpperCase() : '?', emoji: false };
}

/* Every element that carries a colour carries its THREE TEXT TIERS with it,
 * as literal values.
 *
 * They cannot be derived in CSS. `--c-title: var(--c)` declared on the app
 * root is substituted once, THERE, against the session's colour -- and every
 * category inherits that already-resolved value, so no per-category `--c`
 * could ever change the title's colour. That was the bug: a category recoloured
 * green kept a blue title, because the title was reading the session's. */
function paintColor(node, color) {
  const t = tints(color, (ctx.root.dataset.theme || 'dark') !== 'light');
  node.style.setProperty('--c', color);
  node.style.setProperty('--c-on', t.on);
  node.style.setProperty('--c-body', t.body);
  node.style.setProperty('--c-bold', t.bold);
  node.style.setProperty('--c-title', t.title);
  node.style.setProperty('--c-sel', t.sel);
  // The title strip is derived from the colour too: a faint wash of it, and
  // one step further when the category is under the pointer.
  node.style.setProperty('--c-head', t.head);
  node.style.setProperty('--c-head-hi', t.headHi);
}

/* The tiers are derived against the theme's own backgrounds, so a theme flip
 * has to derive them again. Cheaper than a re-render and it cannot move the
 * caret, which a re-render of a focused box can. */
export function repaintColors() {
  const s = S();
  paintColor(ctx.root, s.color);
  for (const sec of ctx.canvas.querySelectorAll('.nt-cat')) {
    const cat = catOf(s, sec.dataset.cat);
    if (cat) paintColor(sec, cat.color);
  }
  for (const row of ctx.sidebar.querySelectorAll('.nt-row, .nt-rail-cat, .nt-arch-row')) {
    const cat = catOf(s, row.dataset.cat) || archivedOf(s, row.dataset.cat);
    if (cat) paintColor(row, cat.color);
  }
}

const S = () => ctx.session;

function structure(label, mutate) {
  return ctx.history.structure(label, () => snapshot(S()), () => {
    const r = mutate();
    touch(S());
    ctx.docChanged();
    return r;
  });
}

/* ---- sessions ----------------------------------------------------------------- */

export function addSession() {
  const used = ctx.doc.sessions.length;
  const s = newSession('New Session', { color: SESSION_PALETTE[used % SESSION_PALETTE.length] });
  ctx.doc.sessions.push(s);
  // A new session is always to the RIGHT of every existing one, so the page
  // you were on leaves to the left and the blank one arrives from the right.
  switchSession(s.id, 1);
  ctx.docChanged();
  setTimeout(() => editSessionTitle(), 60);
}

export function switchSession(id, forceDir) {
  if (!ctx.doc.sessions.some((s) => s.id === id) || id === ctx.doc.active) return;
  const from = ctx.doc.sessions.findIndex((s) => s.id === ctx.doc.active);
  const to = ctx.doc.sessions.findIndex((s) => s.id === id);
  const dir = forceDir === undefined ? (to > from ? 1 : -1) : forceDir;
  const finish = beginSlide(dir);
  ctx.flushBodies();
  // A pick is a set of ids in the session you were in. It does not travel.
  clearPicks();
  ctx.doc.active = id;
  ctx.history.clear();
  ctx.docChanged();
  renderAll();
  ctx.canvas.scrollTop = 0;
  finish();
}

export function moveSession(id, target) {
  const list = ctx.doc.sessions;
  const from = list.findIndex((s) => s.id === id);
  if (from < 0) return;
  const [s] = list.splice(from, 1);
  // `target` indexes the list WITHOUT the dragged session, which is exactly
  // what the array is once the splice above has run.
  list.splice(Math.max(0, Math.min(list.length, target)), 0, s);
  ctx.docChanged();
}

/* ---- the slide between sessions ---------------------------------------------
 * Switching sessions is a move sideways through a row, so it looks like one:
 * the page you are leaving is cloned where it stands and pushed off in the
 * direction of the one you picked, while the new one arrives from the other
 * side. Left when the session you picked is further down the list, right when
 * it is further up -- the same order the cards are in.
 *
 * THE CLONE IS MOUNTED OUTSIDE .nt-canvas, in a layer over it. That is not a
 * styling choice: half this file and app.js reach for `.nt-cat`, `.nt-cats`
 * and `.nt-body` through ctx.canvas, and a second copy of every one of them
 * living inside it for the length of an animation is a scroll spy counting
 * sections twice and a flush walking bodies that belong to a session nobody
 * is in any more.
 *
 * The clone also carries the outgoing session's colour tiers as literal
 * values, because --c and everything derived from it is about to be
 * repainted on the root -- a live clone would change colour halfway across. */
const SLIDE_MS = 380;
const TIERS = ['--c', '--c-on', '--c-body', '--c-bold', '--c-title', '--c-sel', '--here'];
const stillness = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function beginSlide(dir) {
  const inner = ctx.canvas.querySelector('.nt-canvas-inner');
  const main = ctx.canvas.parentNode;
  if (!inner || !main || !dir || stillness()) return () => {};
  const ghost = inner.cloneNode(true);
  ghost.className = 'nt-slide-ghost';
  ghost.removeAttribute('id');
  // Nothing in a copy is typed in, tabbed to or read out.
  ghost.setAttribute('aria-hidden', 'true');
  for (const node of ghost.querySelectorAll('[contenteditable]')) node.removeAttribute('contenteditable');
  ghost.style.top = `${-ctx.canvas.scrollTop}px`;
  const now = getComputedStyle(ctx.root);
  for (const v of TIERS) ghost.style.setProperty(v, now.getPropertyValue(v));
  const layer = el('div', { class: 'nt-slide-layer', 'aria-hidden': 'true' }, ghost);
  main.append(layer);
  return () => {
    inner.classList.add(dir > 0 ? 'is-from-right' : 'is-from-left');
    // Read the layout back, so the starting offset is committed before the
    // transition is armed. Without it both classes land in one style pass and
    // there is nothing to animate FROM.
    void inner.offsetWidth;
    inner.classList.add('is-sliding');
    inner.classList.remove('is-from-right', 'is-from-left');
    ghost.classList.add(dir > 0 ? 'is-out-left' : 'is-out-right');
    setTimeout(() => {
      layer.remove();
      inner.classList.remove('is-sliding');
    }, SLIDE_MS + 40);
  };
}

export async function deleteSession(id) {
  const s = ctx.doc.sessions.find((x) => x.id === id);
  if (!s) return;
  if (ctx.doc.sessions.length === 1) { toast('The last session cannot be deleted'); return; }
  const cats = s.cats.length + s.archived.length;
  const ok = await confirm({
    title: 'Delete session?', msg: `Delete <strong>${esc(s.title)}</strong> and its ${cats} categor${cats === 1 ? 'y' : 'ies'}?`,
    sub: 'This cannot be undone. Archive categories you want to keep first.', ok: 'Delete', danger: true,
  });
  if (ok !== 'ok') return;
  ctx.flushBodies();
  ctx.doc.sessions = ctx.doc.sessions.filter((x) => x.id !== id);
  if (ctx.doc.active === id) ctx.doc.active = ctx.doc.sessions[0].id;
  ctx.history.clear();
  ctx.docChanged();
  renderAll();
  toast(`"${s.title}" deleted`);
}

/* The sessions, as a popup on the badge.
 *
 * ONE ROW ACROSS THE TOP, and the word in it is centred on the POPUP rather
 * than on the cards: with one session the grid is 44px wide and a label
 * centred over it sits in the corner, which is not where a title goes. The
 * options are at the left end of that row and the close at the right, so the
 * middle is genuinely free -- it is placed absolutely for the same reason the
 * header's formatting group is, because two arms of unequal width cannot
 * centre anything between them.
 *
 * NOTHING HERE ANSWERS A RIGHT-CLICK ANY MORE. The cards reorder on a drag,
 * and a press-and-hold that is the beginning of a drag and a press that is a
 * context menu are the same gesture -- the menu was winning, and it closed
 * the popup it was opened from on the way. The row's own options button does
 * that job now. */
export function openSessions(anchor) {
  const grid = el('div', { class: 'nt-sess-grid' });
  const draw = () => {
    const add = el('button', { type: 'button', class: 'nt-sess-card is-add', 'data-tip': 'New session', html: ICON.plus, onclick: () => { closePanel(); addSession(); } });
    grid.replaceChildren(...ctx.doc.sessions.map((s) => {
      const g = glyph(s);
      const card = el('button', { type: 'button', class: `nt-sess-card ${s.id === ctx.doc.active ? 'is-active' : ''} ${g.emoji ? 'is-emoji' : ''}`, 'data-sess': s.id, 'data-tip': s.title, text: g.text });
      paintColor(card, s.color);
      // A drag that ended on this card is not a click on it.
      card.addEventListener('click', () => { if (!card.dataset.dragged) { switchSession(s.id); draw(); } });
      const x = el('span', { class: 'nt-sess-x', html: ICON.close, title: 'Delete session' });
      x.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); deleteSession(s.id); });
      card.append(x);
      wireSessionDrag(card, s.id, draw);
      return card;
    }), add);
  };
  draw();
  /* NO OPTIONS BUTTON. Everything it held is already reachable from inside
     the session it would have acted on: the name renames on a double-click
     in the sidebar or on the canvas, the emoji and the colour are the two
     controls beside it, and a card's own X deletes. A menu that duplicates
     four controls you are looking at is a fifth thing to maintain. */
  const box = el('div', { class: 'nt-sess' },
    el('div', { class: 'nt-sess-bar' },
      el('div', { class: 'nt-sess-head', text: 'Sessions' }),
      el('button', { type: 'button', class: 'nt-sess-close', 'aria-label': 'Close', html: ICON.close, onclick: () => closePanel() })),
    grid);
  panel({ className: 'nt-sess-panel', content: box, anchor, align: 'left' });
}

/* Reordering the cards. The grid wraps, so "which gap is the pointer in" is
 * not a list of tops the way the sidebar's is: a card counts as after the
 * pointer when the pointer is above its bottom edge AND left of its middle,
 * which reads rows top to bottom and each row left to right. */
function wireSessionDrag(card, id, redraw) {
  card.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.nt-sess-x')) return;
    const grid = card.parentNode;
    /* NO preventDefault ON THE POINTERDOWN. Cancelling it also cancels the
       compatibility mouse events the browser would have sent after it --
       mousedown, mouseup AND click -- so the card stopped switching sessions
       the moment it learned to be dragged. There is nothing to suppress here
       anyway: the app sets user-select:none, so a press cannot start a text
       selection. The click is suppressed by dataset.dragged instead, and only
       when a drag actually happened. */
    card.setPointerCapture(e.pointerId);
    const x0 = e.clientX; const y0 = e.clientY;
    let dragging = false;
    let marker = null;
    let target = -1;
    const onMove = (ev) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
        dragging = true;
        card.dataset.dragged = '1';
        card.classList.add('is-dragging');
        marker = el('div', { class: 'nt-sess-marker' });
      }
      const items = [...grid.querySelectorAll('.nt-sess-card:not(.is-dragging):not(.is-add)')];
      target = items.length;
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect();
        if (ev.clientY < r.bottom && ev.clientX < r.left + r.width / 2) { target = i; break; }
      }
      if (target < items.length) items[target].before(marker);
      else grid.querySelector('.nt-sess-card.is-add').before(marker);
    };
    const onUp = () => {
      card.removeEventListener('pointermove', onMove);
      card.removeEventListener('pointerup', onUp);
      card.removeEventListener('pointercancel', onUp);
      if (!dragging) return;
      dragging = false;
      card.classList.remove('is-dragging');
      if (marker) marker.remove();
      moveSession(id, target);
      redraw();
      // The click that ends the drag must not also be taken as a switch.
      setTimeout(() => { delete card.dataset.dragged; }, 0);
    };
    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerup', onUp);
    card.addEventListener('pointercancel', onUp);
  });
}

function editSessionTitle() {
  const t = ctx.root.querySelector('.nt-session-title');
  if (t) { t.focus(); selectAll(t); }
}

function selectAll(node) {
  const r = document.createRange();
  r.selectNodeContents(node);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

/* ---- picking more than one ---------------------------------------------------
 * The sidebar list and the archive list are LISTS, so they select like lists:
 * Ctrl (or Cmd) adds one anywhere, Shift takes the run between the last one
 * and this one. Everything a row can do to itself -- archive, recolour, drag,
 * restore, delete -- does it to the whole pick instead when the row is in one.
 *
 * ONE SET, NOT TWO. A pick that spanned the live list and the archive would
 * mean "archive these and also un-archive those", which is not an action, so
 * picking in one list clears the other. `pickIn` is which list is live. */
const picked = new Set();
let pickIn = 'cats';
let pickAnchor = null;

const pickedList = () => (pickIn === 'archived' ? S().archived : S().cats);
/* In LIST order, never in click order: everything downstream of this splices
 * an array, and a move that took them out in the order they were clicked
 * would reorder them against each other on the way. */
const picks = () => pickedList().filter((c) => picked.has(c.id)).map((c) => c.id);

/* What an action on `id` should actually act on. A row that is not in the
 * pick acts on itself even when a pick exists -- clicking the X on an
 * unpicked row is not a request to archive four others. */
function targets(id, list = 'cats') {
  if (pickIn !== list || !picked.has(id) || picked.size < 2) return [id];
  return picks();
}

export function clearPicks() {
  if (!picked.size) return false;
  picked.clear();
  pickAnchor = null;
  paintPicks();
  return true;
}

export const pickCount = () => picked.size;

function paintPicks() {
  /* PRUNE FIRST. A pick is a set of ids, and archiving, deleting or an undo
     can take one out from under it -- a stale id would keep counting toward
     picked.size and make a single row act as if it had company. */
  if (picked.size) {
    const live = new Set(pickedList().map((c) => c.id));
    for (const id of [...picked]) if (!live.has(id)) picked.delete(id);
    if (pickAnchor && !live.has(pickAnchor)) pickAnchor = null;
  }
  /* A pick of one is not DRAWN -- that row already shows as the one being
     read, and a ring on top of that is a second mark saying the same thing.
     The count goes on the root all the same, because "one is picked" and
     "none is picked" are different states and nothing else can tell them
     apart from the outside. */
  const many = picked.size > 1;
  for (const n of ctx.sidebar.querySelectorAll('.nt-row, .nt-arch-row')) {
    n.classList.toggle('is-picked', many && picked.has(n.dataset.cat));
  }
  ctx.root.classList.toggle('has-picks', many);
  ctx.root.dataset.picks = String(picked.size);
}

/* EVERY CLICK ON A ROW IS A SELECTION, including a plain one. That is what
 * makes Ctrl and Shift work the way a file list does: the row you clicked
 * first IS the first one selected, so the next Ctrl+click gives you two and
 * the next Shift+click gives you the run from it -- with no separate "start a
 * selection" gesture to perform first. A plain click still replaces whatever
 * was picked and still jumps to the category; only Ctrl and Shift build.
 *
 * A pick of one is not painted (see paintPicks): a single row already shows
 * as the one being read, and a ring on top of that is a second mark saying
 * the same thing. It is a real pick all the same -- targets() ignores a pick
 * of one, so a lone selected row acts on itself and nothing else. */
function onPickClick(e, id, list) {
  const mod = e.ctrlKey || e.metaKey;
  if (pickIn !== list) { picked.clear(); pickIn = list; pickAnchor = null; }
  const order = pickedList().map((c) => c.id);
  if (e.shiftKey && pickAnchor && order.includes(pickAnchor)) {
    const a = order.indexOf(pickAnchor);
    const b = order.indexOf(id);
    // Shift REPLACES the run rather than adding to it, the way a file list
    // does: dragging the far end of a range should not leave the old one on.
    if (!mod) picked.clear();
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) picked.add(order[i]);
    // The anchor does NOT move: shift-clicking again re-measures from the
    // same end, which is how a range is adjusted rather than restarted.
  } else if (mod && picked.has(id)) {
    picked.delete(id);
    pickAnchor = picked.size ? pickAnchor : null;
  } else {
    if (!mod) picked.clear();
    picked.add(id);
    pickAnchor = id;
  }
  paintPicks();
  return mod || e.shiftKey;
}

/* ---- categories ---------------------------------------------------------------- */

export function addCat(where) {
  // where: 'top' | 'bottom' | 'auto' | { after: id }
  const s = S();
  /* 'auto' PUTS IT WHERE YOU ARE LOOKING. Past halfway down the canvas the
     bottom of the list is what is on screen, so that is where a new category
     belongs; above halfway it is the top. The two buttons that are themselves
     positional -- the plus in the session header and the New category at the
     very end of the canvas -- stay 'top' and 'bottom' and mean it. */
  if (where === 'auto') {
    const range = ctx.canvas.scrollHeight - ctx.canvas.clientHeight;
    where = range > 0 && ctx.canvas.scrollTop / range > 0.5 ? 'bottom' : 'top';
  }
  let cat;
  structure('add category', () => {
    // A new category is the session's colour until it is given its own. The
    // session colour is the page's accent; a category's is its text.
    cat = newCat('New Category', { color: s.color });
    if (where === 'top') s.cats.unshift(cat);
    else if (where && where.after) { const i = s.cats.findIndex((c) => c.id === where.after); s.cats.splice(i + 1, 0, cat); }
    else s.cats.push(cat);
  });
  renderAll();
  const sec = sectionFor(cat.id);
  if (sec) {
    sec.classList.add('is-new');
    sec.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const title = sec.querySelector('.nt-cat-title');
    setTimeout(() => { title.focus(); selectAll(title); }, 60);
  }
  return cat;
}

export function renameCat(id, title) {
  const cat = catOf(S(), id);
  if (!cat) return;
  const clean = title.replace(/\s+/g, ' ').trim().slice(0, 80) || 'New Category';
  if (clean === cat.title) return;
  structure('rename', () => { cat.title = clean; touch(S(), cat); });
  /* A rename can start in either place now, so both are written. Whichever
     one is being typed in is skipped -- rewriting the element under the
     caret would collapse the selection and eat the next keystroke. */
  const sec = sectionFor(id);
  const onCanvas = sec && sec.querySelector('.nt-cat-title');
  if (onCanvas && document.activeElement !== onCanvas) onCanvas.textContent = clean;
  const body = ctx.bodyFor(id);
  if (body) body.setAttribute('aria-label', `${clean} notes`);
  renderSidebar();
}

export function setCatEmoji(id, emoji) {
  const cat = catOf(S(), id);
  if (!cat) return;
  structure('emoji', () => { cat.emoji = emoji; touch(S(), cat); });
  renderCatHeader(id);
  renderSidebar();
}

export function setCatColor(id, color) {
  const cat = catOf(S(), id);
  if (!cat) return;
  cat.color = color;
  touch(S(), cat);
  ctx.docChanged();
  const sec = sectionFor(id);
  if (sec) paintColor(sec, color);
  renderSidebar();
}

/* `all` folds or unfolds every category in the session rather than this one.
 * Which way is decided by the category that was clicked, not by a majority:
 * shift-clicking an OPEN chevron shuts everything, shift-clicking a shut one
 * opens everything, so the same gesture on the same arrow always does the
 * thing that arrow was already pointing at. */
export function toggleCollapse(id, force, all = false) {
  const cat = catOf(S(), id);
  if (!cat) return;
  const next = force === undefined ? !cat.collapsed : !!force;
  const list = all ? S().cats : [cat];
  for (const c of list) {
    c.collapsed = next;
    const sec = sectionFor(c.id);
    if (sec) sec.classList.toggle('is-collapsed', next);
  }
  ctx.docChanged();
  renderSidebar();
}

export function expandCat(id) { const cat = catOf(S(), id); if (cat && cat.collapsed) toggleCollapse(id, false); }

export function moveCat(id, to) {
  const s = S();
  const from = s.cats.findIndex((c) => c.id === id);
  if (from < 0) return;
  const target = Math.max(0, Math.min(s.cats.length - 1, to));
  if (target === from) return;
  structure('move', () => {
    const [cat] = s.cats.splice(from, 1);
    s.cats.splice(target, 0, cat);
  });
  renderAll();
  const sec = sectionFor(id);
  if (sec) sec.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* Several at once, landing in front of `beforeId` (or at the end for null).
 * They keep their order relative to each other -- a drop is a relocation, not
 * a reshuffle -- which is what `picks()` returning list order is for. */
export function moveCats(ids, beforeId) {
  const s = S();
  const set = new Set(ids);
  const moving = s.cats.filter((c) => set.has(c.id));
  if (!moving.length) return;
  structure('move', () => {
    const rest = s.cats.filter((c) => !set.has(c.id));
    const at = beforeId ? rest.findIndex((c) => c.id === beforeId) : -1;
    rest.splice(at < 0 ? rest.length : at, 0, ...moving);
    s.cats = rest;
  });
  renderAll();
  const sec = sectionFor(moving[0].id);
  if (sec) sec.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export async function archiveCat(id) {
  const ids = targets(id, 'cats');
  const cats = ids.map((x) => catOf(S(), x)).filter(Boolean);
  if (!cats.length) return;
  const many = cats.length > 1;
  const empty = cats.every((c) => !ctx.toText(c.body).trim());
  const name = many ? `${cats.length} categories` : `<strong>${esc(cats[0].title)}</strong>`;
  let choice = 'ok';
  // One dialog for the whole pick: four confirmations in a row is four
  // chances to answer the wrong one.
  if (!empty || many) {
    choice = await confirm({
      title: many ? `Archive ${cats.length} categories` : 'Archive category',
      msg: many ? `Archive ${name}?` : `Archive ${name}?`,
      sub: 'They move to the archive at the bottom of the sidebar and can be restored any time. Ctrl+Z also brings them back.',
      ok: 'Archive', alt: 'Delete', altDanger: true,
    });
  }
  if (!choice) return;
  ctx.flushBodies();
  structure(choice === 'alt' ? 'delete' : 'archive', () => {
    const s = S();
    const set = new Set(ids);
    s.cats = s.cats.filter((c) => !set.has(c.id));
    if (choice !== 'alt') for (const cat of [...cats].reverse()) { cat.archivedAt = now(); s.archived.unshift(cat); }
    if (!s.cats.length) s.cats.push(newCat('New Category'));
  });
  clearPicks();
  renderAll();
  const what = many ? `${cats.length} categories` : `"${cats[0].title}"`;
  toast(choice === 'alt' ? `${what} deleted (Ctrl+Z to undo)` : `${what} archived`);
}

export function restoreCat(id) {
  const ids = targets(id, 'archived');
  const cats = ids.map((x) => archivedOf(S(), x)).filter(Boolean);
  if (!cats.length) return;
  structure('restore', () => {
    const s = S();
    const set = new Set(ids);
    s.archived = s.archived.filter((c) => !set.has(c.id));
    for (const cat of cats) { delete cat.archivedAt; s.cats.push(cat); }
  });
  clearPicks();
  renderAll();
  const sec = sectionFor(cats[0].id);
  if (sec) sec.scrollIntoView({ block: 'center', behavior: 'smooth' });
  toast(cats.length > 1 ? `${cats.length} categories restored` : `"${cats[0].title}" restored`);
}

export async function deleteArchived(id) {
  const ids = targets(id, 'archived');
  const cats = ids.map((x) => archivedOf(S(), x)).filter(Boolean);
  if (!cats.length) return;
  const many = cats.length > 1;
  const ok = await confirm({
    title: 'Delete permanently?',
    msg: many ? `Delete ${cats.length} categories from the archive?` : `Delete <strong>${esc(cats[0].title)}</strong> from the archive?`,
    sub: 'Ctrl+Z can still bring it back until you close the notes.', ok: 'Delete', danger: true,
  });
  if (ok !== 'ok') return;
  const set = new Set(ids);
  structure('delete archived', () => { S().archived = S().archived.filter((c) => !set.has(c.id)); });
  clearPicks();
  renderSidebar();
}

export function duplicateCat(id) {
  const s = S();
  const cat = catOf(s, id);
  if (!cat) return;
  ctx.flushBodies();
  let copy;
  structure('duplicate', () => {
    copy = newCat(`${cat.title} copy`, { color: cat.color, emoji: cat.emoji, body: cat.body });
    s.cats.splice(s.cats.indexOf(cat) + 1, 0, copy);
  });
  renderAll();
  const sec = sectionFor(copy.id);
  if (sec) sec.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* ---- the canvas ------------------------------------------------------------------ */

const sectionFor = (id) => ctx.canvas.querySelector(`.nt-cat[data-cat="${CSS.escape(id)}"]`);

export function renderAll() {
  applySessionColor();
  renderSessionHeader();
  renderCanvas();
  renderSidebar();
  if (ctx.root.classList.contains('show-sessions')) renderSessionList();
  ctx.dictate.paintButtons();
  ctx.spell.rescanAll();
  ctx.search.refresh();
}

export function applySessionColor() {
  const s = S();
  paintColor(ctx.root, s.color);
  /* No tooltip on either badge. Resting the pointer on one opens the sessions
     popup, which says every session's name including this one -- a tip that
     appears at the same moment as the thing it duplicates. */
  const btn = ctx.root.querySelector('.nt-session-btn');
  if (btn) { const g = glyph(s); btn.textContent = g.text; btn.classList.toggle('is-emoji', g.emoji); paintColor(btn, s.color); }
  const railBtn = ctx.root.querySelector('.nt-rail-session');
  if (railBtn) { const g = glyph(s); railBtn.textContent = g.text; railBtn.classList.toggle('is-emoji', g.emoji); paintColor(railBtn, s.color); }
  const title = ctx.root.querySelector('.nt-sidebar-session-title');
  if (title) title.textContent = s.title;
}

function renderSessionHeader() {
  const s = S();
  const head = ctx.canvas.querySelector('.nt-session-head');
  if (!head) return;
  const emojiBtn = head.querySelector('.nt-session-emoji');
  const g = glyph(s);
  emojiBtn.textContent = g.text;
  emojiBtn.classList.toggle('is-emoji', g.emoji);
  const title = head.querySelector('.nt-session-title');
  if (document.activeElement !== title) title.textContent = s.title;
}

function renderCanvas() {
  const s = S();
  /* replaceChildren detaches every section, which resets the scroll to the
     top; restoring it is what stops archiving a category throwing the view
     back to wherever it was before. An explicit scroll (jumpTo, addCat) runs
     after this and still wins. */
  const keepScroll = ctx.canvas.scrollTop;
  const list = ctx.canvas.querySelector('.nt-cats');
  const existing = new Map([...list.children].map((n) => [n.dataset.cat, n]));
  const frag = document.createDocumentFragment();
  for (const cat of s.cats) {
    let sec = existing.get(cat.id);
    if (sec && sec.querySelector('.nt-body').dataset.rev === cat.updated) {
      // Unchanged: keep the element, and with it the caret if it is inside.
      existing.delete(cat.id);
      fillHeader(sec, cat);
      sec.classList.toggle('is-collapsed', cat.collapsed);
      paintColor(sec, cat.color);
    } else {
      if (sec) { existing.delete(cat.id); ctx.spell.forget(sec.querySelector('.nt-body')); }
      sec = buildSection(cat);
    }
    frag.append(sec);
  }
  for (const gone of existing.values()) { ctx.spell.forget(gone.querySelector('.nt-body')); gone.remove(); }
  list.replaceChildren(frag);
  ctx.canvas.classList.toggle('is-empty', !s.cats.length);
  if (keepScroll && ctx.canvas.scrollTop !== keepScroll) {
    // Directly, not smoothly: the canvas scrolls smoothly by default and an
    // animated restore is a visible lurch.
    ctx.canvas.style.scrollBehavior = 'auto';
    ctx.canvas.scrollTop = keepScroll;
    ctx.canvas.style.removeProperty('scroll-behavior');
  }
}

/* THE TITLE ROW IS INSIDE THE TEXT BOX, and the chevron and the emoji are
 * outside it to the left.
 *
 * .nt-cat-box carries the body's own fill and 3px of padding, so the "outline
 * the colour of the box" is the box itself showing through around a head that
 * is painted the canvas's colour -- a frame that cannot drift out of step
 * with the fill it is supposed to match, which a real border of its own would
 * on every hover and focus. The head and the body are the two things inside
 * that frame, and the head reads as a shelf recessed into it.
 *
 * The aside is the chevron and the emoji together, aligned with the head row
 * so the four things on that line -- fold, emoji, title, and the controls at
 * the right end -- all sit level whether the box is open or shut. */
function buildSection(cat) {
  const sec = el('section', { class: `nt-cat ${cat.collapsed ? 'is-collapsed' : ''}`, 'data-cat': cat.id });
  paintColor(sec, cat.color);
  const aside = el('div', { class: 'nt-cat-aside' },
    // No tip. A chevron says fold, and the shift-for-all trick is in the
    // information panel with every other thing you have to be told once.
    el('button', { type: 'button', class: 'nt-cat-toggle', html: ICON.chevron, 'aria-label': 'Collapse category', onclick: (e) => toggleCollapse(cat.id, undefined, e.shiftKey) }),
    el('button', { type: 'button', class: 'nt-cat-emoji', 'aria-label': 'Choose an emoji', onclick: (e) => ctx.emoji.openFull(e.currentTarget, (u) => setCatEmoji(cat.id, u)) }));
  /* Options, then colour, then archive. The X is the one that removes
     something, so it is the one on the outside where nothing else is reached
     past it. */
  const head = el('div', { class: 'nt-cat-head' },
    el('h2', { class: 'nt-cat-title', contenteditable: 'true', spellcheck: 'false', 'data-cat': cat.id, 'aria-label': 'Category title' }),
    /* These three keep a tip, and it opens ABOVE them: the strip is a 36px
       bar with the text of the category directly under it, so a tip below
       lands on the words it is meant to be explaining nothing about. */
    el('button', { type: 'button', class: 'nt-cat-more nt-icon-btn', 'data-tip': 'More', 'data-tip-pos': 'above', 'aria-label': 'Category options', html: ICON.more, onclick: (e) => catMenu(cat.id, e.currentTarget) }),
    el('button', { type: 'button', class: 'nt-cat-color', 'data-tip': 'Category colour', 'data-tip-pos': 'above', 'aria-label': 'Choose a colour', onclick: (e) => openCatColor(cat.id, e.currentTarget) }),
    el('button', { type: 'button', class: 'nt-cat-x nt-icon-btn', 'data-tip': 'Archive', 'data-tip-pos': 'above', 'aria-label': 'Archive category', html: ICON.close, onclick: () => archiveCat(cat.id) }));
  const body = el('div', { class: 'nt-body', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'data-cat': cat.id, 'data-rev': cat.updated, 'aria-label': `${cat.title} notes` });
  body.innerHTML = ctx.clean(cat.body);
  body.spellcheck = false;
  ctx.chips.hydrate(body);
  // The microphone sits in the box's bottom-right corner, in the wrapper
  // rather than inside the contenteditable: a button inside the text is a
  // thing the caret can land on.
  sec.append(el('div', { class: 'nt-cat-shell' }, aside,
    el('div', { class: 'nt-cat-box' }, head,
      el('div', { class: 'nt-cat-body' }, body, ctx.dictate.micButton(cat.id)))));
  fillHeader(sec, cat);
  wireTitle(head.querySelector('.nt-cat-title'), cat.id);
  return sec;
}

function fillHeader(sec, cat) {
  const g = glyph(cat);
  const emojiBtn = sec.querySelector('.nt-cat-emoji');
  emojiBtn.textContent = cat.emoji || g.text;
  emojiBtn.classList.toggle('is-emoji', !!cat.emoji || g.emoji);
  const title = sec.querySelector('.nt-cat-title');
  if (document.activeElement !== title && title.textContent !== cat.title) title.textContent = cat.title;
  sec.querySelector('.nt-body').dataset.rev = cat.updated;
}

function renderCatHeader(id) {
  const sec = sectionFor(id);
  const cat = catOf(S(), id);
  if (sec && cat) fillHeader(sec, cat);
}

function wireTitle(title, id) {
  /* A NAME IS A WAY IN. Clicking the title of a folded category unfolds it --
     the chevron beside it was the only way, and aiming at a 26px arrow to
     read something whose name you are already pointing at is a step that does
     not need to exist. It only ever opens: clicking into a title to edit it
     must not shut the box you are about to look at. */
  title.addEventListener('click', () => expandCat(id));
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      renameCat(id, title.textContent);
      const body = ctx.bodyFor(id);
      if (body) { expandCat(id); body.focus({ preventScroll: true }); caretToEnd(body); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); title.textContent = catOf(S(), id).title; title.blur(); return; }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const i = S().cats.findIndex((c) => c.id === id);
      moveCat(id, e.key === 'ArrowUp' ? i - 1 : i + 1);
      setTimeout(() => { const t = sectionFor(id)?.querySelector('.nt-cat-title'); if (t) { t.focus(); caretToEnd(t); } }, 0);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) ctx.history.redo(); else ctx.history.undo(); return; }
    if (ctx.emoji.isOpen() && ctx.emoji.onKey(e)) return;
  });
  title.addEventListener('input', () => {
    // Titles are one line of plain text.
    if (title.querySelector('*')) { const t = title.textContent; title.textContent = t; caretToEnd(title); }
    ctx.emoji.watch(title);
    const row = ctx.sidebar.querySelector(`.nt-row[data-cat="${CSS.escape(id)}"] .nt-row-title`);
    if (row) row.textContent = title.textContent;
  });
  title.addEventListener('blur', () => renameCat(id, title.textContent));
  title.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' ');
    document.execCommand('insertText', false, text);
  });
}

function openCatColor(id, anchor) {
  const ids = targets(id, 'cats');
  const cats = ids.map((x) => catOf(S(), x)).filter(Boolean);
  if (!cats.length) return;
  // The picker opens on the colour of the one that was CLICKED, not on some
  // average of the pick: that is the swatch the pointer is on.
  const clicked = catOf(S(), id) || cats[0];
  const before = new Map(cats.map((c) => [c.id, c.color]));
  const paint = (c) => { for (const cat of cats) setCatColor(cat.id, c); };
  ctx.color.open(anchor, {
    title: cats.length > 1 ? `Colour · ${cats.length} categories` : 'Category colour',
    value: clicked.color,
    onChange: paint,
    // "Use default" hands the category back to the session's colour, which
    // is what a category that has never been given one already shows.
    onClear: () => paint(S().color),
  });
  // One undo step for the whole picker session, however many it painted.
  const seal = () => {
    const after = new Map(cats.map((c) => [c.id, c.color]));
    if (cats.every((c) => before.get(c.id) === after.get(c.id))) return;
    for (const c of cats) c.color = before.get(c.id);
    structure('colour', () => { for (const c of cats) c.color = after.get(c.id); });
  };
  const check = setInterval(() => { if (!ctx.root.querySelector('.nt-clr-panel')) { clearInterval(check); seal(); } }, 300);
}

function catMenu(id, anchor) {
  const s = S();
  const i = s.cats.findIndex((c) => c.id === id);
  const cat = s.cats[i];
  menu(anchor, [
    { label: 'Move up', hint: 'Alt+↑', disabled: i === 0, run: () => moveCat(id, i - 1) },
    { label: 'Move down', hint: 'Alt+↓', disabled: i === s.cats.length - 1, run: () => moveCat(id, i + 1) },
    { label: 'Move to top', disabled: i === 0, run: () => moveCat(id, 0) },
    { label: 'Move to bottom', disabled: i === s.cats.length - 1, run: () => moveCat(id, s.cats.length - 1) },
    null,
    { label: 'Add category below', icon: ICON.plus, run: () => addCat({ after: id }) },
    { label: 'Duplicate', icon: ICON.copy, run: () => duplicateCat(id) },
    { label: 'Copy as text', run: () => navigator.clipboard.writeText(`${cat.title}\n\n${ctx.toText(cat.body)}`).then(() => toast('Copied')) },
    null,
    { label: 'Archive', icon: ICON.archive, run: () => archiveCat(id) },
  ], { align: 'right' });
}

/* ---- the sidebar ------------------------------------------------------------------ */

export function renderSidebar() {
  const s = S();
  const list = ctx.sidebar.querySelector('.nt-rows');
  const rail = ctx.sidebar.querySelector('.nt-rail-cats');
  const rows = s.cats.map((cat) => {
    const g = glyph(cat);
    const row = el('div', { class: `nt-row ${cat.collapsed ? 'is-collapsed' : ''} ${picked.has(cat.id) ? 'is-picked' : ''}`, 'data-cat': cat.id, role: 'button', tabindex: '0' });
    paintColor(row, cat.color);
    // The grip stays as the thing that SAYS the row is draggable, but the
    // whole row is the handle now -- see wireDrag's `anywhere`.
    const grip = el('span', { class: 'nt-row-grip', html: ICON.grip, 'data-tip-pos': 'right' });
    const badge = el('button', { type: 'button', class: `nt-row-badge ${g.emoji || cat.emoji ? 'is-emoji' : ''}`, text: cat.emoji || g.text, tabindex: '-1', 'aria-label': 'Emoji', onclick: (e) => { e.stopPropagation(); ctx.emoji.openFull(e.currentTarget, (u) => setCatEmoji(cat.id, u)); } });
    const title = el('span', { class: 'nt-row-title', text: cat.title });
    const color = el('button', { type: 'button', class: 'nt-row-color', tabindex: '-1', 'aria-label': 'Colour', onclick: (e) => { e.stopPropagation(); openCatColor(cat.id, e.currentTarget); } });
    const x = el('button', { type: 'button', class: 'nt-row-x', tabindex: '-1', 'aria-label': 'Archive', html: ICON.close, onclick: (e) => { e.stopPropagation(); archiveCat(cat.id); } });
    row.append(grip, badge, title, color, x);
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      // A drag that ended on this row is not a click on it.
      if (row.dataset.dragged) return;
      // A plain click picks this row AND jumps; Ctrl and Shift only pick.
      if (onPickClick(e, cat.id, 'cats')) return;
      jumpTo(cat.id);
    });
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jumpTo(cat.id); } });
    wireInlineTitle(title, {
      get: () => (catOf(S(), cat.id) || cat).title,
      set: (t) => renameCat(cat.id, t),
    });
    wireDrag(row, row, cat.id, { anywhere: true });
    return row;
  });
  list.replaceChildren(...rows);

  rail.replaceChildren(...s.cats.map((cat) => {
    const g = glyph(cat);
    const b = el('button', {
      type: 'button', class: `nt-rail-cat ${g.emoji ? 'is-emoji' : ''}`, text: g.text,
      'data-cat': cat.id, 'data-tip': cat.title, 'data-tip-pos': 'right',
      // A drag that ended here is not a jump.
      onclick: () => { if (!b.dataset.dragged) jumpTo(cat.id); },
    });
    paintColor(b, cat.color);
    // The letter IS the handle when there is no room for a grip beside it.
    wireDrag(b, b, cat.id, { list: '.nt-rail-cats', item: '.nt-rail-cat', markerClass: 'is-rail' });
    return b;
  }));

  renderArchive();
  paintPicks();
  syncTab();
  spy();
}

/* The sidebar's collapse tab is welded to the archive's top edge -- it is a
 * tab ON that divider, not a control floating on the sidebar's outer edge. It
 * lives outside the sidebar (which clips its own overflow) and is told where
 * to sit, because the archive's position moves with the split and with the
 * window. */
let archWatch = null;
export function syncTab() {
  const tab = ctx.root.querySelector('.nt-sb-tab');
  const arch = ctx.sidebar.querySelector('.nt-archive');
  if (!tab || !arch) return;
  /* THE ARCHIVE IS WHAT THE TAB IS WELDED TO, SO THE ARCHIVE IS WHAT IS
     WATCHED. Observing the sidebar alone -- which is all initRender could do,
     because the archive is not built yet when it runs -- missed the one thing
     that moves the divider without changing the sidebar's own box: folding
     the archive shut. The sidebar is the same size either way, the observer
     never fired, and the tab stayed level with where the open archive's top
     edge had been. */
  if (archWatch && archWatch.node !== arch) { archWatch.ro.disconnect(); archWatch = null; }
  if (!archWatch && typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => syncTab());
    ro.observe(arch);
    archWatch = { ro, node: arch };
  }
  const y = arch.getBoundingClientRect().top - ctx.root.getBoundingClientRect().top;
  tab.style.setProperty('--tab-y', `${Math.round(y)}px`);
}

/* The sessions as a list, under the sidebar's own button. The grid behind the
 * badge is the same set; this is the one you can read the names in. */
export function renderSessionList() {
  const wrap = ctx.root.querySelector('.nt-sesslist');
  if (!wrap) return;
  const rows = ctx.doc.sessions.map((s) => {
    const g = glyph(s);
    const row = el('div', { class: `nt-sess-row ${s.id === ctx.doc.active ? 'is-active' : ''}`, 'data-sess': s.id, role: 'button', tabindex: '0' });
    paintColor(row, s.color);
    const x = el('button', { type: 'button', class: 'nt-sess-row-x', html: ICON.close, tabindex: '-1', 'aria-label': `Delete ${s.title}` });
    x.addEventListener('click', (e) => { e.stopPropagation(); deleteSession(s.id); });
    row.append(
      el('span', { class: `nt-row-badge ${g.emoji ? 'is-emoji' : ''}`, text: g.text }),
      el('span', { class: 'nt-row-title', text: s.title }),
      el('span', { class: 'nt-sess-count', text: String(s.cats.length) }),
      x);
    const go = (e) => { if (e.target.closest('button')) return; switchSession(s.id); renderSessionList(); };
    row.addEventListener('click', go);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchSession(s.id); renderSessionList(); } });
    return row;
  });
  /* A HEADER AND A FOOTER, so the sheet is a window rather than a list that
     appeared: it says what it is, it can be shut from inside itself, and the
     one thing you might want that is not a row in it -- another session --
     is a button of its own rather than a row pretending to be one. */
  wrap.replaceChildren(
    el('div', { class: 'nt-sesslist-head' },
      el('span', { text: 'My Sessions' }),
      el('button', { type: 'button', class: 'nt-sesslist-x', html: ICON.close, 'aria-label': 'Close', onclick: () => ctx.closeSessionList && ctx.closeSessionList() })),
    el('div', { class: 'nt-sesslist-rows' }, ...rows),
    el('div', { class: 'nt-sesslist-foot' },
      el('button', { type: 'button', class: 'nt-sesslist-new', html: `${ICON.plus}<span>New</span>`, onclick: () => addSession() })));
}

function renderArchive() {
  const s = S();
  const wrap = ctx.sidebar.querySelector('.nt-archive');
  const list = wrap.querySelector('.nt-archive-list');
  const count = wrap.querySelector('.nt-archive-count');
  count.textContent = s.archived.length ? String(s.archived.length) : '';
  wrap.classList.toggle('is-empty', !s.archived.length);
  list.replaceChildren(...s.archived.map((cat) => {
    const g = glyph(cat);
    const row = el('div', { class: `nt-arch-row ${picked.has(cat.id) ? 'is-picked' : ''}`, 'data-cat': cat.id });
    paintColor(row, cat.color);
    row.append(
      el('span', { class: `nt-row-badge ${g.emoji ? 'is-emoji' : ''}`, text: g.text }),
      el('span', { class: 'nt-row-title', text: cat.title, title: cat.title }),
      el('button', { type: 'button', class: 'nt-icon-btn is-small', 'data-tip': 'Restore', html: ICON.restore, 'aria-label': 'Restore', onclick: () => restoreCat(cat.id) }),
      el('button', { type: 'button', class: 'nt-icon-btn is-small is-danger', 'data-tip': 'Delete forever', html: ICON.trash, 'aria-label': 'Delete forever', onclick: () => deleteArchived(cat.id) }));
    /* The archive picks exactly the way the list above it does, so restoring
       or deleting ten is ten of one gesture rather than ten of the whole
       cycle. A plain click here selects nothing -- there is nowhere to jump
       to -- so it is the way OUT of a pick. */
    row.addEventListener('click', (e) => { if (!e.target.closest('button')) onPickClick(e, cat.id, 'archived'); });
    return row;
  }));
}

export function jumpTo(id) {
  const sec = sectionFor(id);
  if (!sec) return;
  expandCat(id);
  const top = sec.offsetTop - 18;
  ctx.canvas.scrollTo({ top, behavior: 'smooth' });
  spyHold = id;
  clearTimeout(spyTimer);
  spyTimer = setTimeout(() => { spyHold = null; spy(); }, 900);
  setActive(id);
}

/* ---- scroll spy: which category the reader is in ------------------------------------ */

let spyHold = null;
let spyTimer = 0;
let spyFrame = 0;
let activeId = null;

export function onCanvasScroll() {
  if (!spyFrame) spyFrame = requestAnimationFrame(spy);
}

function spy() {
  spyFrame = 0;
  if (spyHold) { setActive(spyHold); return; }
  const secs = [...ctx.canvas.querySelectorAll('.nt-cat')];
  if (!secs.length) { setActive(null); return; }
  const top = ctx.canvas.scrollTop;
  const bottom = top + ctx.canvas.clientHeight;
  let best = null; let bestSeen = -1;
  for (const sec of secs) {
    const a = sec.offsetTop; const b = a + sec.offsetHeight;
    const seen = Math.min(bottom, b) - Math.max(top, a);
    if (seen > bestSeen) { bestSeen = seen; best = sec; }
  }
  // At the very top the first section wins even if a taller one shows more.
  if (top < 40) best = secs[0];
  setActive(best ? best.dataset.cat : null);
}

function setActive(id) {
  if (id === activeId) return;
  activeId = id;
  for (const n of ctx.sidebar.querySelectorAll('.nt-row, .nt-rail-cat')) n.classList.toggle('is-here', n.dataset.cat === id);
  const here = ctx.sidebar.querySelector('.nt-rail-cat.is-here');
  if (here) here.scrollIntoView({ block: 'nearest' });
  const cat = id && catOf(S(), id);
  ctx.root.style.setProperty('--here', cat ? cat.color : S().color);
}

/* ---- drag to reorder in the sidebar ----------------------------------------------------- */

/* ONE reorder, two places to do it from: the grip on a sidebar row, and the
 * letter itself when the sidebar is collapsed to the rail. Both show the same
 * line between the two categories the drop would land between; only the
 * container and the item selector differ. */
function wireDrag(node, handle, id, opts = {}) {
  const listSel = opts.list || '.nt-rows';
  const itemSel = opts.item || '.nt-row';
  let dragging = false;
  let ghost = null;
  let marker = null;
  let target = -1;
  let carrying = [id];
  const list = () => ctx.sidebar.querySelector(listSel);
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    /* THE WHOLE ROW IS THE HANDLE, so this has to let go of everything on the
       row that is not the row: the buttons, and the title while it is being
       renamed. A grip you have to find first is a grip you have to find. */
    if (opts.anywhere && (e.target.closest('button') || e.target.closest('[contenteditable="true"]'))) return;
    /* NO preventDefault. Cancelling pointerdown cancels the compatibility
       mouse events after it, `click` included -- which silently killed the
       jump on a sidebar row and the jump on a rail letter, and went unnoticed
       because the harness clicked the rail programmatically. Nothing needs
       suppressing: the app is user-select:none, so a press cannot start a
       text selection. dataset.dragged stops the click instead, and only when
       a drag actually happened. */
    const startY = e.clientY;
    const onMove = (ev) => {
      if (!dragging) {
        if (Math.abs(ev.clientY - startY) < 4) return;
        dragging = true;
        /* CAPTURE HERE, NOT ON THE PRESS. Capturing a pointer retargets the
           compatibility mouse events that come with it, dblclick included --
           so a row that grabbed the pointer the moment it was touched
           swallowed the double-click that renames its own title, and
           double-click-to-rename simply stopped working in the outliner.
           Nothing needs the capture until there is a drag to keep hold of;
           the move and up listeners are on the window so the pointer can
           leave the row before then. */
        try { handle.setPointerCapture(e.pointerId); } catch { /* gone */ }
        // A drag that starts on a picked row carries the whole pick.
        carrying = opts.anywhere ? targets(id, 'cats') : [id];
        node.dataset.dragged = '1';
        ghost = node.cloneNode(true);
        ghost.classList.add('is-ghost');
        ghost.style.width = `${node.offsetWidth}px`;
        if (carrying.length > 1) ghost.dataset.carry = String(carrying.length);
        ctx.root.append(ghost);
        marker = el('div', { class: `nt-drop-marker ${opts.markerClass || ''}` });
        for (const c of carrying) {
          const n = list().querySelector(`${itemSel}[data-cat="${CSS.escape(c)}"]`);
          if (n) n.classList.add('is-dragging');
        }
      }
      ghost.style.left = `${node.getBoundingClientRect().left}px`;
      ghost.style.top = `${ev.clientY - 16}px`;
      const items = [...list().querySelectorAll(`${itemSel}:not(.is-dragging)`)];
      target = items.length;
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) { target = i; break; }
      }
      if (target < items.length) items[target].before(marker); else list().append(marker);
      // Auto-scroll near the container's edges.
      const lr = list().getBoundingClientRect();
      if (ev.clientY < lr.top + 30) list().scrollTop -= 8;
      else if (ev.clientY > lr.bottom - 30) list().scrollTop += 8;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (!dragging) return;
      dragging = false;
      for (const n of list().querySelectorAll('.is-dragging')) n.classList.remove('is-dragging');
      if (ghost) ghost.remove();
      if (marker) marker.remove();
      // `target` indexes the rows that were NOT being carried, which is the
      // same list the move is about to splice into.
      const set = new Set(carrying);
      const others = S().cats.filter((c) => !set.has(c.id));
      moveCats(carrying, target < others.length ? others[target].id : null);
      carrying = [id];
      // The click that ends the drag must not also be taken as a jump.
      setTimeout(() => { delete node.dataset.dragged; }, 0);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

/* ---- filtering (search) ------------------------------------------------------------------ */

export function filterSidebar(hits) {
  for (const n of ctx.sidebar.querySelectorAll('.nt-row, .nt-rail-cat')) n.classList.toggle('is-dim', !!hits && !hits.has(n.dataset.cat));
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export { sectionFor, selectAll, restore };
