/* Search across the open session: every title and every body.
 *
 * Matches are drawn with the Highlight API like spelling is, so the document
 * is never rewritten to show them. Enter and the arrows walk the matches;
 * the current one is scrolled into the top third of the canvas. Escape
 * clears. Categories with no match dim in the sidebar so the list doubles as
 * a filter.
 */

import { el, closest, debounce } from './dom.js';
import { ICON } from './ui.js';

let ctx = null;
let input = null;
let countEl = null;
let matches = [];      // [{ range, catId }]
let current = -1;
const HAS_HIGHLIGHT = typeof Highlight === 'function' && !!(window.CSS && CSS.highlights);

let wrap = null;

/* A CIRCLE UNTIL IT IS WANTED. Expanded, the field is as wide as the whole
 * formatting group is off-centre -- and the formatting group is supposed to
 * sit squarely above the text it formats. So the search rests as its own icon
 * at the far left of the header, and opening it does not move anything:
 * the middle group is centred absolutely and the field grows underneath it. */
export function initSearch(context, mount) {
  ctx = context;
  input = el('input', { type: 'search', class: 'nt-search-input', placeholder: 'Search', 'aria-label': 'Search notes', spellcheck: 'false', autocomplete: 'off', tabindex: '-1' });
  countEl = el('span', { class: 'nt-search-count', hidden: true });
  const prev = el('button', { type: 'button', class: 'nt-icon-btn is-small', 'data-tip': 'Previous (Shift+Enter)', html: ICON.chevron, tabindex: '-1', onclick: () => step(-1) });
  prev.classList.add('is-up');
  const next = el('button', { type: 'button', class: 'nt-icon-btn is-small', 'data-tip': 'Next (Enter)', html: ICON.chevron, tabindex: '-1', onclick: () => step(1) });
  const toggle = el('button', {
    type: 'button', class: 'nt-search-btn', 'data-tip': 'Search (Ctrl+F)', 'aria-label': 'Search notes',
    'aria-expanded': 'false', html: ICON.search,
    onclick: () => (wrap.classList.contains('is-open') ? close() : open()),
  });
  wrap = el('div', { class: 'nt-search' }, toggle, input, countEl, prev, next);
  mount.append(wrap);
  const run = debounce(() => search(input.value), 150);
  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); run.flush(); if (!matches.length) search(input.value); step(e.shiftKey ? -1 : 1); }
    /* stopPropagation, or Escape reaches the <dialog> and shuts the whole
       overlay. Escape is a ladder: it closes the innermost thing that is
       open, and only the last one closes the notes. */
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  wrap.classList.toggle('no-highlight', !HAS_HIGHLIGHT);
}

function open() {
  wrap.classList.add('is-open');
  wrap.querySelector('.nt-search-btn').setAttribute('aria-expanded', 'true');
  input.tabIndex = 0;
  input.focus();
  input.select();
}

/* Closing clears: a collapsed field still filtering the sidebar is a filter
 * with nothing on screen to explain it. */
function close() {
  clear();
  wrap.classList.remove('is-open');
  wrap.querySelector('.nt-search-btn').setAttribute('aria-expanded', 'false');
  input.tabIndex = -1;
  input.blur();
  // Back to the text, not to <body>: focus is what decides where the next
  // keystroke goes, and nowhere is the wrong answer.
  const body = ctx.canvas.querySelector('.nt-body');
  if (body) body.focus({ preventScroll: true });
}

export function focus() { open(); }
export const isOpen = () => !!wrap && wrap.classList.contains('is-open');

export function clear() {
  input.value = '';
  matches = [];
  current = -1;
  paint();
  countEl.hidden = true;
  ctx.filterSidebar(null);
}

/* Re-run after the document changed under an active search. */
export function refresh() { if (input.value.trim()) search(input.value, true); }

function search(q, keepCurrent) {
  const query = q.trim();
  matches = [];
  if (!query) { clear(); return; }
  const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const hosts = [...ctx.canvas.querySelectorAll('.nt-cat-title, .nt-body')];
  const catsHit = new Set();
  for (const host of hosts) {
    const catId = closest(host, '.nt-cat') ? closest(host, '.nt-cat').dataset.cat : null;
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(node.nodeValue))) {
        const r = new Range();
        r.setStart(node, m.index);
        r.setEnd(node, m.index + m[0].length);
        matches.push({ range: r, catId });
        if (catId) catsHit.add(catId);
        if (!m[0].length) break;
      }
    }
  }
  if (!keepCurrent || current >= matches.length) current = matches.length ? 0 : -1;
  ctx.filterSidebar(catsHit);
  paint();
  showCount();
  if (!keepCurrent && matches.length) reveal();
}

function step(dir) {
  if (!matches.length) return;
  current = (current + dir + matches.length) % matches.length;
  paint();
  showCount();
  reveal();
}

function showCount() {
  countEl.hidden = false;
  countEl.textContent = matches.length ? `${current + 1}/${matches.length}` : '0';
  countEl.classList.toggle('is-none', !matches.length);
}

function reveal() {
  const m = matches[current];
  if (!m) return;
  const cat = closest(m.range.startContainer, '.nt-cat');
  if (cat && cat.classList.contains('is-collapsed')) ctx.expandCat(cat.dataset.cat);
  const rect = m.range.getBoundingClientRect();
  const view = ctx.canvas.getBoundingClientRect();
  if (rect.top < view.top + 80 || rect.bottom > view.bottom - 80) {
    ctx.canvas.scrollBy({ top: rect.top - view.top - view.height * 0.3, behavior: 'smooth' });
  }
  if (!HAS_HIGHLIGHT) {
    // Nothing to paint with: select the match instead.
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(m.range);
  }
}

function paint() {
  if (!HAS_HIGHLIGHT) return;
  const live = matches.filter((m) => m.range.startContainer.isConnected);
  if (!live.length) { CSS.highlights.delete('nt-search'); CSS.highlights.delete('nt-search-current'); return; }
  CSS.highlights.set('nt-search', new Highlight(...live.map((m) => m.range)));
  const c = matches[current];
  if (c) CSS.highlights.set('nt-search-current', new Highlight(c.range)); else CSS.highlights.delete('nt-search-current');
}
