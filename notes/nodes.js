/* The node layer: what a chip LOOKS like, what you can do to one, and the one
 * drag that creates, moves and copies them.
 *
 * chips.js owns what a node IS -- a link chip, a markdown chip, an image --
 * and how it is inserted and edited. This file owns everything around that:
 *
 *   the mark      every chip carries a coloured mark at its head. Clicking it
 *                 folds the chip down to just that mark and back again.
 *   the toolbar   resting on a chip raises a small bar over it: copy, edit,
 *                 open, delete. Delete ARMS on the first press and only acts
 *                 on the second, because a chip is one click from gone and
 *                 there is no dialog small enough to be worth it.
 *   the drag      ONE mechanism with three callers -- drag out of the header
 *                 to make a node, drag a chip to move it, hold Shift to leave
 *                 a copy behind. See beginDrag().
 *
 * WHY POINTER EVENTS AND NOT HTML5 DRAG-AND-DROP. A contenteditable is
 * already a drop target with opinions: the browser moves ranges, inserts its
 * own markup, and fires no event you can cleanly cancel on every path. Every
 * previous attempt at this fought that and lost in a different place each
 * time. Pointer events own the whole gesture, `caretFromPoint` says exactly
 * where the drop lands, and nothing is written until the pointer comes up.
 *
 * WHY THERE ARE NO REMOTE FAVICONS. This app ships under
 * `img-src 'self' data:`, so a favicon fetched from Google would be blocked
 * outright -- and widening that header would mean every render of a private
 * page telling a third party which domains are in it. The mark is derived
 * from the hostname instead: same letter and same colour for the same site,
 * every time, computed here and sent nowhere.
 */

import { el } from './dom.js';
import { ICON } from './ui.js';

let ctx = null;
export function initNodes(context) { ctx = context; }

/* ---- the kinds ------------------------------------------------------------
 * One table. The menu, the header button and the mark all read it, so a
 * fourth kind is a row here rather than four places to remember. */
export const NODES = [
  { key: 'link', label: 'Link', hint: 'Ctrl+K', color: '#67A2FF', icon: () => ICON.link },
  { key: 'md', label: 'Markdown', hint: '', color: '#9ACB5A', icon: () => ICON.md },
  { key: 'image', label: 'Image', hint: 'or paste', color: '#A79BF0', icon: () => ICON.image },
];
export const nodeKind = (key) => NODES.find((n) => n.key === key) || NODES[0];

export function kindOf(chip) {
  if (!chip) return null;
  if (chip.classList.contains('chip-link')) return 'link';
  if (chip.classList.contains('chip-md')) return 'md';
  return null;
}

/* ---- the mark -------------------------------------------------------------
 * A link's mark is its site: the first letter of the hostname on a colour
 * derived from the whole hostname, so google.com is the same green circle in
 * every note and never the same as github.com. A hash rather than a palette
 * lookup, because there is no list of sites to keep.
 *
 * THE MARK IS NEVER SAVED. It is built here on every hydrate and stripped by
 * serialize(); schema.js removes one outright if a stray copy ever reaches it
 * through a paste. What is in the document is the chip's label and nothing
 * else, which is what makes a chip's stored form readable. */
/* A BUCKET, NOT A HUE, and no inline style anywhere. scrub() strips every
 * style attribute in a body after each native input -- that is its whole job,
 * because Chrome leaves them behind when it merges two coloured lines -- so a
 * colour written onto the mark would survive exactly until the next
 * keystroke. Twelve classes, twelve rules in the stylesheet, nothing for the
 * scrubber to take away. Twelve is enough to tell a page of links apart and
 * few enough to be a readable set of rules. */
export const HUES = 12;

export function siteMark(url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { host = ''; }
  if (!host) return { text: '•', bucket: 7 };
  let hash = 0;
  for (let i = 0; i < host.length; i++) hash = (hash * 31 + host.charCodeAt(i)) >>> 0;
  return { text: host[0].toUpperCase(), bucket: hash % HUES };
}

export function paintMark(chip) {
  let mark = chip.querySelector('.nt-chip-mark');
  if (!mark) {
    mark = el('span', { class: 'nt-chip-mark', contenteditable: 'false' });
    chip.prepend(mark);
  }
  if (chip.classList.contains('chip-link')) {
    const m = siteMark(chip.getAttribute('href'));
    mark.className = `nt-chip-mark is-site h${m.bucket}`;
    /* THE LETTER IS GENERATED CONTENT, not a text node. A letter in the DOM
       is part of the chip's text, which means it is part of what the spell
       checker reads, what search matches, what "copy as text" writes out and
       what toText() hands the export -- a link to google.com would be the
       word "Ggoogle.com" to every one of them. Drawn from an attribute by
       CSS, it is visible and it is not text. */
    mark.dataset.l = m.text;
    mark.textContent = '';
  } else {
    mark.className = 'nt-chip-mark';
    mark.innerHTML = ICON.md;
  }
  /* draggable="false", AND IT IS LOAD-BEARING. A link chip is an <a href>,
     which Chrome drags natively: the moment the pointer moves with the button
     down it starts its own drag, the pointermove stream stops, and the drag
     built on those events never begins at all. The header's button worked and
     a chip did not, for exactly this reason. Set here because paintMark is
     the one place that runs both when a chip is made and on every hydrate --
     the attribute is not in the stored schema and does not need to be. */
  chip.setAttribute('draggable', 'false');
  chip.classList.toggle('is-min', chip.dataset.min === '1');
  return mark;
}

/* Folded, a chip is just its mark: a circle you can still point at, still
 * drag, and still open. The state rides in the document (data-min) because a
 * note you folded should come back folded. */
export function toggleMin(chip, body) {
  const now = chip.dataset.min === '1';
  ctx.editor.transact(body, () => {
    if (now) delete chip.dataset.min; else chip.dataset.min = '1';
    chip.classList.toggle('is-min', !now);
  });
}

/* ---- the hover toolbar ----------------------------------------------------
 * Not a panel(): there is one of those at a time and it closes on any outside
 * press, which would make opening the colour picker shut this and hovering a
 * chip shut the colour picker. This is its own small floating thing, owned
 * here, and it never takes focus. */
let bar = null;
let barChip = null;
let barTimer = 0;

export function hideToolbar(force) {
  clearTimeout(barTimer);
  if (!bar) return;
  if (!force && (bar.matches(':hover') || (barChip && barChip.matches(':hover')))) return;
  bar.remove();
  bar = null;
  barChip = null;
}

export function showToolbar(chip, body) {
  clearTimeout(barTimer);
  if (barChip === chip && bar) { place(chip); return; }
  hideToolbar(true);
  barChip = chip;
  const kind = kindOf(chip);
  const isLink = kind === 'link';
  const btn = (tip, icon, run, cls = '') => el('button', {
    type: 'button', class: `nt-chip-btn ${cls}`, 'data-tip': tip, 'data-tip-pos': 'above', 'aria-label': tip,
    html: icon, onclick: (e) => { e.preventDefault(); e.stopPropagation(); run(e); },
    onmousedown: (e) => e.preventDefault(),
  });
  const del = btn('Delete', ICON.close, () => {
    /* ARMED, then done. One press turns it red and says so; the second one
       removes the chip. A chip is a single click from gone and a confirm
       dialog for something Ctrl+Z brings straight back is heavier than the
       thing it is protecting. */
    if (del.classList.contains('is-armed')) { ctx.editor.transact(body, () => chip.remove()); hideToolbar(true); return; }
    del.classList.add('is-armed');
    del.setAttribute('data-tip', 'Press again to delete');
    setTimeout(() => { del.classList.remove('is-armed'); del.setAttribute('data-tip', 'Delete'); }, 2600);
  }, 'is-danger');
  bar = el('div', { class: 'nt-chip-bar', role: 'toolbar' },
    isLink ? btn('Open', ICON.eye, () => window.open(chip.getAttribute('href'), '_blank', 'noopener')) : null,
    btn('Edit', ICON.edit, () => ctx.chips.editChip(chip, body)),
    btn('Copy', ICON.copy, () => ctx.chips.copyChip(chip)),
    btn(chip.dataset.min === '1' ? 'Unfold' : 'Fold', ICON.collapse, () => { toggleMin(chip, body); hideToolbar(true); }),
    del);
  bar.addEventListener('pointerleave', () => { barTimer = setTimeout(() => hideToolbar(), 160); });
  bar.addEventListener('pointerenter', () => clearTimeout(barTimer));
  ctx.root.append(bar);
  place(chip);
}

function place(chip) {
  const r = chip.getBoundingClientRect();
  const root = ctx.root.getBoundingClientRect();
  const w = bar.offsetWidth;
  let left = r.left + r.width / 2 - w / 2 - root.left;
  left = Math.max(6, Math.min(left, root.width - w - 6));
  bar.style.left = `${Math.round(left)}px`;
  bar.style.top = `${Math.round(r.top - root.top - bar.offsetHeight - 5)}px`;
}

/* ---- the drag -------------------------------------------------------------
 * One gesture, three jobs:
 *
 *   from the header   `make` builds nothing yet; the drop places the caret
 *                     and opens the maker for that kind, so a link asks for
 *                     its address where it is going to live.
 *   from a chip       the chip itself moves to where it is dropped.
 *   Shift             the chip is copied instead of moved.
 *
 * Nothing is written until the pointer comes up. While it is down the only
 * thing on screen is a ghost following the pointer and a caret line where the
 * drop would land -- drawn as absolutely positioned elements over the page,
 * never inserted into the body, because a marker inserted into a live
 * contenteditable splits its text nodes and invalidates the very range the
 * drop is aiming at. */
function caretFromPoint(x, y) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (!p) return null;
    const r = document.createRange();
    r.setStart(p.offsetNode, p.offset);
    r.collapse(true);
    return r;
  }
  return null;
}

function caretRect(range) {
  const rects = range.getClientRects();
  if (rects.length) return rects[0];
  const n = range.startContainer;
  const e = n.nodeType === 1 ? n : n.parentElement;
  return e ? e.getBoundingClientRect() : null;
}

export function beginDrag(e, { ghost, onDrop, source }) {
  if (e.button !== 0) return;
  const startX = e.clientX;
  const startY = e.clientY;
  let dragging = false;
  let target = null;
  let ghostEl = null;
  let caret = null;

  const start = () => {
    dragging = true;
    hideToolbar(true);
    ctx.root.classList.add('is-node-dragging');
    ghostEl = el('div', { class: 'nt-node-ghost' }, ghost());
    caret = el('div', { class: 'nt-node-caret' });
    ctx.root.append(ghostEl, caret);
    if (source) source.classList.add('is-dragging');
  };

  const move = (ev) => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
      start();
    }
    const root = ctx.root.getBoundingClientRect();
    ghostEl.style.left = `${ev.clientX - root.left + 14}px`;
    ghostEl.style.top = `${ev.clientY - root.top + 12}px`;
    ghostEl.classList.toggle('is-copy', ev.shiftKey);

    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    const body = under && under.closest ? under.closest('.nt-body') : null;
    const range = body ? caretFromPoint(ev.clientX, ev.clientY) : null;
    if (!body || !range || !body.contains(range.startContainer)) {
      target = null;
      caret.classList.remove('is-on');
      return;
    }
    target = { body, range: range.cloneRange() };
    const rect = caretRect(range);
    if (!rect) { caret.classList.remove('is-on'); return; }
    caret.classList.add('is-on');
    caret.style.left = `${Math.round(rect.left - root.left)}px`;
    caret.style.top = `${Math.round(rect.top - root.top)}px`;
    caret.style.height = `${Math.max(16, Math.round(rect.height))}px`;
  };

  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (!dragging) return;
    ctx.root.classList.remove('is-node-dragging');
    if (ghostEl) ghostEl.remove();
    if (caret) caret.remove();
    if (source) { source.classList.remove('is-dragging'); source.dataset.dragged = '1'; setTimeout(() => { delete source.dataset.dragged; }, 0); }
    if (target) onDrop(target.body, target.range, ev.shiftKey);
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}
