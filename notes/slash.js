/* The slash menu: "/" at the start of a line lists what a line can become.
 *
 * Typing filters it, arrows move, Enter or Tab runs, Escape closes. The
 * "/query" text is removed before the command runs so the command sees a
 * clean line.
 */

import { el, liveRange, blockOf, textBeforeCaret, deleteBeforeCaret } from './dom.js';
import { transact, toggleList, setBlock, insertDivider } from './editor.js';
import { panel, closePanel, currentPanel, ICON } from './ui.js';

let ctx = null;
let live = null;   // { body, block, query, items, active, handle }

export function initSlash(context) { ctx = context; }

const COMMANDS = () => [
  { key: 'bullet', label: 'Bullet list', hint: '- ', icon: ICON.ul, run: (b) => toggleList(b, 'ul') },
  { key: 'number', label: 'Numbered list', hint: '1. ', icon: ICON.ol, run: (b) => toggleList(b, 'ol') },
  { key: 'todo', label: 'To-do list', hint: '[] ', icon: ICON.todo, run: (b) => toggleList(b, 'todo') },
  { key: 'heading', label: 'Heading', hint: '# ', icon: ICON.heading, run: (b) => setBlock(b, 'h3') },
  { key: 'quote', label: 'Quote', hint: '> ', icon: ICON.quote, run: (b) => setBlock(b, 'blockquote') },
  { key: 'code', label: 'Code block', hint: '```', icon: ICON.code, run: (b) => setBlock(b, 'pre') },
  { key: 'divider', label: 'Divider', hint: '---', icon: ICON.hr, run: (b) => insertDivider(b) },
  { key: 'table', label: 'Table', hint: '', icon: ICON.table, run: (b) => ctx.tables.insert(b) },
  { key: 'link', label: 'Link', hint: 'Ctrl+K', icon: ICON.link, run: (b) => ctx.chips.promptLink(b) },
  { key: 'markdown', label: 'Markdown node', hint: '', icon: ICON.md, run: (b) => ctx.chips.insertMd(b) },
  { key: 'image', label: 'Image', hint: 'paste or drop', icon: ICON.image, run: (b) => ctx.chips.pickImage(b) },
  { key: 'emoji', label: 'Emoji', hint: ':', icon: null, emoji: '😀', run: (b) => ctx.emoji.openFull(b, (u) => { b.focus({ preventScroll: true }); ctx.insertText(b, u); }) },
  { key: 'date', label: "Today's date", hint: '', icon: null, emoji: '📅', run: (b) => ctx.insertText(b, new Date().toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })) },
];

export const isOpen = () => !!live;

export function watch(body) {
  const range = liveRange(body);
  if (!range || !range.collapsed) { close(); return; }
  const block = blockOf(body, range.startContainer);
  if (!block || (block.tagName !== 'P' && block.tagName !== 'LI')) { close(); return; }
  const before = textBeforeCaret(block, range);
  const m = /^\/([a-z]*)$/i.exec(before);
  if (!m) { close(); return; }
  open(body, block, m[1]);
}

function open(body, block, query) {
  const q = query.toLowerCase();
  const items = COMMANDS().filter((c) => !q || c.key.startsWith(q) || c.label.toLowerCase().includes(q));
  if (!items.length) { close(); return; }
  const list = el('div', { class: 'nt-slash' });
  const buttons = items.map((c, i) => {
    const b = el('button', { type: 'button', class: 'nt-slash-item', tabindex: '-1' },
      el('span', { class: 'nt-slash-icon', html: c.icon || '', text: c.icon ? undefined : c.emoji }),
      el('span', { class: 'nt-slash-label', text: c.label }),
      el('span', { class: 'nt-slash-hint', text: c.hint }));
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => run(i));
    list.append(b);
    return b;
  });
  const rect = (() => { const r = liveRange(body); const rs = r && r.getClientRects(); return rs && rs.length ? rs[0] : block.getBoundingClientRect(); })();
  // Close the previous menu first: its onClose nulls `live`, and it must
  // not null the one being made.
  closePanel();
  const mine = { body, block, query, items, buttons, active: 0, handle: null };
  live = mine;
  mine.handle = panel({ className: 'nt-slash-panel', content: list, anchor: rect, keepFocus: true, onClose: () => { if (live === mine) live = null; } });
  setActive(0);
}

function setActive(i) {
  if (!live) return;
  const n = live.buttons.length;
  live.active = ((i % n) + n) % n;
  live.buttons.forEach((b, j) => b.classList.toggle('is-active', j === live.active));
  live.buttons[live.active].scrollIntoView({ block: 'nearest' });
}

export function onKey(e) {
  if (!live) return false;
  if (e.key === 'ArrowDown') { e.preventDefault(); setActive(live.active + 1); return true; }
  if (e.key === 'ArrowUp') { e.preventDefault(); setActive(live.active - 1); return true; }
  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); run(live.active); return true; }
  if (e.key === 'Escape') { e.preventDefault(); close(); return true; }
  return false;
}

function close() {
  if (live && currentPanel() === live.handle) closePanel();
  live = null;
}

function run(i) {
  const s = live;
  close();
  if (!s) return;
  const { body, items } = s;
  const cmd = items[i];
  body.focus({ preventScroll: true });
  const range = liveRange(body);
  if (range && range.collapsed) {
    const block = blockOf(body, range.startContainer);
    const before = block ? textBeforeCaret(block, range) : '';
    if (/^\/[a-z]*$/i.test(before)) transact(body, () => { deleteBeforeCaret(range, before.length); });
  }
  cmd.run(body);
}
