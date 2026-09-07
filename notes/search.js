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

export function initSearch(context, mount) {
  ctx = context;
  input = el('input', { type: 'search', class: 'nt-search-input', placeholder: 'Search', 'aria-label': 'Search notes', spellcheck: 'false', autocomplete: 'off' });
  countEl = el('span', { class: 'nt-search-count', hidden: true });
  const prev = el('button', { type: 'button', class: 'nt-icon-btn is-small', 'data-tip': 'Previous (Shift+Enter)', html: ICON.chevron, onclick: () => step(-1) });
  prev.classList.add('is-up');
  const next = el('button', { type: 'button', class: 'nt-icon-btn is-small', 'data-tip': 'Next (Enter)', html: ICON.chevron, onclick: () => step(1) });
  const wrap = el('div', { class: 'nt-search' }, el('span', { class: 'nt-search-icon', html: ICON.search }), input, countEl, prev, next);
  mount.append(wrap);
  const run = debounce(() => search(input.value), 150);
  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); run.flush(); if (!matches.length) search(input.value); step(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); clear(); input.blur(); }
  });
  wrap.classList.toggle('no-highlight', !HAS_HIGHLIGHT);
}

export function focus() { input.focus(); input.select(); }

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
