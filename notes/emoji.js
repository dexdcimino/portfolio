/* The emoji picker.
 *
 * Two shapes, as in the old app. COMPACT: type a colon and letters anywhere
 * text is typed and a 3x3 grid appears at the caret -- six matches, a line,
 * and the three most-used. Arrows move, Enter or Tab inserts, Escape closes,
 * typing keeps filtering. FULL: a search box, group tabs and a scrolling
 * grid, reached from the compact grid's expand button or directly from a
 * category's or session's emoji button.
 *
 * The data is notes/emoji.json (emojibase, trimmed to
 * [unicode, label, tags, group]), fetched on first use. Usage counts live in
 * the document so the three most-used follow Dex between devices.
 */

import { el, liveRange, collapseAt, closest } from './dom.js';
import { transact, bodyFrom } from './editor.js';
import { panel, closePanel, currentPanel, ICON } from './ui.js';

let ctx = null;
let data = null;
let loading = null;

const DEFAULTS = ['😂', '❤️', '👍', '😊', '🔥', '😍', '🎉', '✨', '🙏'];
const GROUPS = [
  [0, '😀', 'Smileys'], [1, '👋', 'People'], [3, '🐱', 'Animals'], [4, '🍕', 'Food'],
  [5, '🏠', 'Travel'], [6, '⚽', 'Activities'], [7, '💡', 'Objects'], [8, '❤️', 'Symbols'], [9, '🏁', 'Flags'],
];

export function initEmoji(context) { ctx = context; }

function load() {
  if (data) return Promise.resolve(data);
  if (!loading) {
    loading = fetch('/notes/emoji.json').then((r) => r.json()).then((rows) => {
      data = rows.map(([u, l, t, g]) => ({ u, l, t: t || '', g, k: `${l} ${t || ''}`.toLowerCase() }));
      return data;
    }).catch((err) => { console.warn('notes: emoji data failed', err); loading = null; return []; });
  }
  return loading;
}

export function search(query, limit) {
  if (!data) return [];
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const scored = [];
  for (const e of data) {
    let s = 0;
    const label = e.l.toLowerCase();
    if (label === q) s = 6;
    else if (label.startsWith(q)) s = 5;
    else if (label.split(/[\s-]/).some((w) => w.startsWith(q))) s = 4;
    else if (label.includes(q)) s = 3;
    else if (e.t.split(' ').some((w) => w.startsWith(q))) s = 2;
    else if (e.k.includes(q)) s = 1;
    if (s) scored.push([s, e]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].l.length - b[1].l.length);
  return scored.slice(0, limit).map((x) => x[1]);
}

function topUsed(n) {
  const freq = ctx.doc.emojiFreq || {};
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, n).map((x) => x[0]);
}

function bump(emoji) {
  const freq = ctx.doc.emojiFreq || (ctx.doc.emojiFreq = {});
  freq[emoji] = (freq[emoji] || 0) + 1;
  ctx.uiChanged();
}

/* ---- the colon trigger in a body ------------------------------------------ */

let live = null;   // { body, node, colonAt, cells, active, handle, query }

export const isOpen = () => !!live;

/* Called after every input in a body or title. */
export function watch(host) {
  const found = detect(host);
  if (!found) { if (live && live.host === host) close(); return; }
  load().then(() => { if (detect(host)) open(host, found); });
}

function detect(host) {
  const range = liveRange(host);
  if (!range || !range.collapsed || range.startContainer.nodeType !== 3) return null;
  const node = range.startContainer;
  if (closest(node, 'code,pre,a,.chip')) return null;
  const before = node.nodeValue.slice(0, range.startOffset);
  const at = before.lastIndexOf(':');
  if (at < 0) return null;
  const query = before.slice(at + 1);
  if (!/^[a-zA-Z_]{0,20}$/.test(query)) return null;
  // ":" straight after a letter is punctuation (e.g. "note:"), not a trigger.
  if (at > 0 && /[A-Za-z0-9]/.test(before[at - 1])) return null;
  return { node, colonAt: at, query, offset: range.startOffset };
}

function open(host, found) {
  const results = found.query ? search(found.query, 6) : [];
  if (found.query && !results.length) { close(); return; }
  const shown = (results.length ? results.map((e) => e.u) : DEFAULTS.slice(0, 6));
  const used = topUsed(3);
  const grid = el('div', { class: 'nt-emoji-grid' });
  const cells = [];
  const add = (emoji, cls) => {
    const b = el('button', { type: 'button', class: `nt-emoji-cell ${cls || ''}`, text: emoji, tabindex: '-1' });
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => pick(emoji));
    grid.append(b);
    cells.push(b);
  };
  shown.forEach((u) => add(u));
  grid.append(el('div', { class: 'nt-emoji-sep' }));
  for (let i = 0; i < 3; i++) {
    if (used[i]) add(used[i], 'is-used');
    else { grid.append(el('span', { class: 'nt-emoji-cell is-empty' })); }
  }
  const expand = el('button', { type: 'button', class: 'nt-emoji-expand', 'data-tip': 'All emoji', html: ICON.expand, tabindex: '-1' });
  expand.addEventListener('mousedown', (e) => e.preventDefault());
  expand.addEventListener('click', () => { const s = { ...live }; close(); openFull(caretRect(host) || host, (u) => insertAt(s, u), s.query); });
  const box = el('div', { class: 'nt-emoji-box' }, grid, expand);
  const anchor = caretRect(host) || host;
  closePanel();
  const mine = { host, node: found.node, colonAt: found.colonAt, query: found.query, cells, active: 0, handle: null };
  live = mine;
  mine.handle = panel({ className: 'nt-emoji-panel', content: box, anchor, keepFocus: true, onClose: () => { if (live === mine) live = null; } });
  setActive(0);
}

function caretRect(host) {
  const r = liveRange(host);
  if (!r) return null;
  const rects = r.getClientRects();
  if (rects.length) return rects[rects.length - 1];
  const b = closest(r.startContainer, '*');
  return b ? b.getBoundingClientRect() : null;
}

function setActive(i) {
  if (!live) return;
  const n = live.cells.length;
  live.active = ((i % n) + n) % n;
  live.cells.forEach((c, j) => c.classList.toggle('is-active', j === live.active));
}

export function onKey(e) {
  if (!live) return false;
  const cols = 3;
  if (e.key === 'ArrowRight') { e.preventDefault(); setActive(live.active + 1); return true; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); setActive(live.active - 1); return true; }
  if (e.key === 'ArrowDown') { e.preventDefault(); setActive(live.active + cols); return true; }
  if (e.key === 'ArrowUp') { e.preventDefault(); setActive(live.active - cols); return true; }
  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(live.cells[live.active].textContent); return true; }
  if (e.key === 'Escape') { e.preventDefault(); close(); return true; }
  return false;
}

function close() {
  if (live && currentPanel() === live.handle) closePanel();
  live = null;
}

function pick(emoji) {
  const s = live;
  close();
  if (s) insertAt(s, emoji);
}

/* Replace ":query" with the emoji. */
function insertAt(s, emoji) {
  const { host, node, colonAt } = s;
  if (!node || !node.isConnected) return;
  const body = bodyFrom(host) || host;
  const doIt = () => {
    const text = node.nodeValue;
    // The query may have grown since detection; take letters after the colon.
    let end = colonAt + 1;
    while (end < text.length && /[a-zA-Z_]/.test(text[end])) end++;
    node.nodeValue = text.slice(0, colonAt) + emoji + text.slice(end);
    collapseAt(node, colonAt + emoji.length);
  };
  host.focus({ preventScroll: true });
  if (body.classList && body.classList.contains('nt-body')) transact(body, doIt);
  else { doIt(); host.dispatchEvent(new Event('input', { bubbles: true })); }
  bump(emoji);
}

/* ---- the full picker ----------------------------------------------------------- */

export function openFull(anchor, onPick, initialQuery) {
  load().then(() => {
    const input = el('input', { type: 'search', class: 'nt-input nt-emoji-search', placeholder: 'Search emoji…', value: initialQuery || '' });
    const tabs = el('div', { class: 'nt-emoji-tabs' });
    const grid = el('div', { class: 'nt-emoji-full-grid' });
    let group = 0;
    const show = () => {
      const q = input.value.trim();
      const rows = q ? search(q, 80) : data.filter((e) => e.g === group).slice(0, 240);
      grid.replaceChildren(...rows.map((e) => {
        const b = el('button', { type: 'button', class: 'nt-emoji-cell', text: e.u, 'data-tip': e.l, tabindex: '-1' });
        b.addEventListener('mousedown', (ev) => ev.preventDefault());
        b.addEventListener('click', () => { closePanel(); bump(e.u); onPick(e.u); });
        return b;
      }));
      if (!rows.length) grid.append(el('p', { class: 'nt-emoji-none', text: 'No match' }));
      tabs.querySelectorAll('button').forEach((t) => t.classList.toggle('is-on', !q && Number(t.dataset.g) === group));
    };
    for (const [g, icon, name] of GROUPS) {
      const t = el('button', { type: 'button', class: 'nt-emoji-tab', text: icon, 'data-g': String(g), 'data-tip': name, tabindex: '-1' });
      t.addEventListener('mousedown', (ev) => ev.preventDefault());
      t.addEventListener('click', () => { group = g; input.value = ''; show(); });
      tabs.append(t);
    }
    const used = topUsed(12);
    const recent = used.length ? el('div', { class: 'nt-emoji-recent' }, ...used.map((u) => {
      const b = el('button', { type: 'button', class: 'nt-emoji-cell', text: u, tabindex: '-1' });
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
      b.addEventListener('click', () => { closePanel(); bump(u); onPick(u); });
      return b;
    })) : null;
    input.addEventListener('input', show);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const first = grid.querySelector('.nt-emoji-cell'); if (first) { e.preventDefault(); first.click(); } }
    });
    const box = el('div', { class: 'nt-emoji-full' }, input, recent, tabs, grid);
    panel({ className: 'nt-emoji-full-panel', content: box, anchor, align: 'left' });
    show();
    setTimeout(() => input.focus(), 0);
  });
}
