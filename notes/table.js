/* Tables: making one, moving around inside it, and the handles that add and
 * remove rows and columns.
 *
 * schema.js owns what a table IS -- one tbody, rectangular, header row first,
 * cells holding inline content and nothing else, inside MAX_COLS x MAX_ROWS.
 * This file owns everything you do to one. Every operation here goes through
 * `editor.transact`, so adding a row is ONE undo step and not six, and every
 * one of them ends with the table still matching the schema, because the next
 * `scrub()` would otherwise rewrite it under the caret.
 *
 * THE HANDLES LIVE OUTSIDE THE BODY. They are appended to the app root and
 * positioned over the table, the way nodes.js's chip toolbar is -- not
 * rendered into the contenteditable. A control inside the body is content:
 * it lands in `serialize()`, it lands in a history snapshot, the caret can be
 * put in it, and Backspace can delete it. The chip toolbar learned that
 * first; this follows it rather than inventing a second answer.
 *
 * WHY ENTER MAKES A LINE BREAK AND DOES NOT MOVE DOWN. A cell holds inline
 * content, so there is no second block for Enter to split into -- the only
 * two honest meanings are "a line inside this cell" and "go somewhere else".
 * Going somewhere else would leave no way at all to write two lines in a
 * cell, and there are already three keys that move: Tab, Shift+Tab and the
 * arrows. So Enter is a break, and it is the same thing Shift+Enter does
 * everywhere else in the app.
 */

import { el, isCell, caretToStart, caretToEnd, liveRange, atStartOf, closest } from './dom.js';
import { MAX_COLS, MAX_ROWS } from './schema.js';
import { ICON, menu, toast } from './ui.js';

let ctx = null;
export function initTables(context) {
  ctx = context;
  ctx.canvas.addEventListener('pointermove', onPointerMove);
  /* ARMED, NOT IMMEDIATE. The handles are children of the app root, not of
     the canvas, so reaching for one LEAVES the canvas -- and an immediate
     hide here took the button away in the same event that the pointer
     arrived on it. The press then landed on the category box underneath,
     which reads exactly like a dead control and is the second time this
     file has made that mistake. */
  ctx.canvas.addEventListener('pointerleave', () => armHide());
  // A scroll is different: the table has moved out from under the handles,
  // so there is nothing to be reaching for.
  ctx.canvas.addEventListener('scroll', () => hideHandles(), { passive: true });
}

export { MAX_COLS, MAX_ROWS };

/* ---- the shape ------------------------------------------------------------ */

const rowsOf = (table) => [...table.querySelectorAll(':scope > tbody > tr')];
const colCount = (table) => { const r = rowsOf(table); return r.length ? r[0].children.length : 0; };
export const tableOf = (node) => closest(node, 'table');
const cellOf = (node) => closest(node, 'td,th');

function blankCell(tag) {
  const cell = document.createElement(tag);
  cell.append(document.createElement('br'));
  return cell;
}

/* A fresh table is three columns and three rows: a header and two rows to
 * put something in. Smaller than that and it does not read as a table on
 * sight; bigger and the first thing anyone does is delete the extra. */
export function makeTable(cols = 3, rows = 3) {
  const c = Math.max(1, Math.min(MAX_COLS, cols));
  const r = Math.max(2, Math.min(MAX_ROWS, rows));
  const tbody = document.createElement('tbody');
  for (let y = 0; y < r; y++) {
    const tr = document.createElement('tr');
    for (let x = 0; x < c; x++) tr.append(blankCell(y === 0 ? 'th' : 'td'));
    tbody.append(tr);
  }
  const table = document.createElement('table');
  table.append(tbody);
  return table;
}

/* ---- adding and removing --------------------------------------------------- */

export function addRow(body, table, at) {
  const rows = rowsOf(table);
  if (rows.length >= MAX_ROWS) { toast(`A table holds ${MAX_ROWS} rows.`); return null; }
  const cols = colCount(table);
  let made = null;
  ctx.editor.transact(body, () => {
    const tr = document.createElement('tr');
    for (let x = 0; x < cols; x++) tr.append(blankCell('td'));
    // `at` is the index the new row TAKES. Index 0 is not offered: the first
    // row is the header, and a row inserted above it would have to either
    // become the header or leave the table with two kinds of first row.
    const before = rows[Math.max(1, Math.min(rows.length, at))];
    if (before) before.before(tr); else rows[rows.length - 1].after(tr);
    made = tr;
  });
  return made;
}

export function addColumn(body, table, at) {
  const cols = colCount(table);
  if (cols >= MAX_COLS) { toast(`A table holds ${MAX_COLS} columns.`); return; }
  const rows = rowsOf(table);
  ctx.editor.transact(body, () => {
    for (const tr of rows) {
      const cell = blankCell(tr === rows[0] ? 'th' : 'td');
      const before = tr.children[Math.max(0, Math.min(cols, at))];
      if (before) before.before(cell); else tr.append(cell);
    }
  });
}

export function removeRow(body, table, index) {
  const rows = rowsOf(table);
  // Never the header, and never the last body row: a table with only a header
  // has nothing in it, and the way to get rid of it is to delete the table.
  if (index <= 0 || rows.length <= 2) { toast('A table keeps its header and one row.'); return; }
  ctx.editor.transact(body, () => rows[index].remove());
}

export function removeColumn(body, table, index) {
  const rows = rowsOf(table);
  if (colCount(table) <= 1) { toast('A table keeps one column.'); return; }
  ctx.editor.transact(body, () => { for (const tr of rows) if (tr.children[index]) tr.children[index].remove(); });
}

export function removeTable(body, table) {
  ctx.editor.transact(body, () => {
    const after = table.nextElementSibling;
    table.remove();
    if (after) caretToStart(after);
  });
  hideHandles();
}

/* ---- inserting one --------------------------------------------------------- */

export function insertTable(body) {
  // The node first, so the caret lands in THIS table rather than in whichever
  // one happens to be first in the body.
  const table = makeTable();
  ctx.editor.insertBlockAfterCaret(body, table);
  const first = table.querySelector('th');
  if (first) caretToStart(first);
}

/* ---- keys inside a cell ------------------------------------------------------ */

/* Returns true when the key belonged to the table and has been dealt with.
 * Called from editor.js's keydown before its own list and block rules, which
 * all assume a block that can be split. */
export function onKey(body, e) {
  const range = liveRange(body);
  if (!range) return false;
  const cell = cellOf(range.startContainer);
  if (!cell || !body.contains(cell)) return false;
  const table = tableOf(cell);
  if (!table) return false;

  if (e.key === 'Tab') { e.preventDefault(); step(body, table, cell, e.shiftKey); return true; }

  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
    // A break, not a new block -- see the header comment. Done natively so
    // Chrome places the caret after it and the history records one step.
    e.preventDefault();
    ctx.editor.transact(body, () => { document.execCommand('insertLineBreak'); });
    return true;
  }

  if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && range.collapsed && atStartOf(cell, range)) {
    /* THE ESCAPE HATCH. At the start of the first cell there is nothing to
     * the left inside the table, and without this the caret is stuck: the
     * native Backspace would either do nothing or start pulling the table
     * apart from the outside. An empty table gets deleted -- which is what
     * Backspace at the start of an empty thing means everywhere else in this
     * editor -- and a table with anything in it hands the caret to the line
     * above instead, where Backspace can be pressed again on purpose. */
    const rows = rowsOf(table);
    const first = rows[0] && rows[0].children[0];
    if (cell !== first) { e.preventDefault(); return true; }   // inside: never merge cells
    e.preventDefault();
    if (isEmptyTable(table)) { removeTable(body, table); return true; }
    const prev = table.previousElementSibling;
    if (prev) caretToEnd(prev);
    return true;
  }
  return false;
}

const isEmptyTable = (table) => ![...table.querySelectorAll('td,th')].some((c) => c.textContent.trim() || c.querySelector('img,[contenteditable="false"]'));

/* Tab moves to the next cell; Tab in the LAST cell adds a row and lands in
 * it, which is how a table gets filled in without reaching for the mouse. At
 * the row cap it does nothing rather than silently swallowing the key -- the
 * toast says why. */
function step(body, table, cell, back) {
  const cells = [...table.querySelectorAll('td,th')];
  const i = cells.indexOf(cell);
  if (i < 0) return;
  if (!back && i === cells.length - 1) {
    const tr = addRow(body, table, rowsOf(table).length);
    if (tr) caretToStart(tr.children[0]);
    return;
  }
  const next = cells[back ? i - 1 : i + 1];
  if (next) caretToEnd(next);
  else if (back) {
    const prev = table.previousElementSibling;
    if (prev) caretToEnd(prev);
  }
}

/* ---- the handles ------------------------------------------------------------- */

/* One row grip and one column grip, moved to whichever row and column the
 * pointer is over, plus the two buttons that append. Four elements in total
 * rather than one per row and column: the same reason nodes.js has one chip
 * toolbar instead of a bar per chip. */
let handles = null;
let overCell = null;
/* THE HANDLES DO NOT VANISH WHILE YOU REACH FOR THEM. They sit OUTSIDE the
 * table's own box -- the grips in the margin, the two plus buttons past the
 * edges -- so the pointer has to cross canvas that is not a cell to get to
 * one. Hiding on the first non-cell move took them away mid-travel and the
 * click landed on nothing, which reads exactly like a dead button. A short
 * grace period, cancelled by entering a cell OR a handle, is the same answer
 * nodes.js's chip toolbar reached. */
let hideTimer = 0;
const HIDE_GRACE = 220;

function build() {
  if (handles) return handles;
  const grip = (cls, tip) => el('button', {
    type: 'button', class: `nt-tbl-grip ${cls}`, 'data-tip': tip, 'data-tip-pos': 'above',
    'aria-label': tip, 'aria-haspopup': 'menu', html: ICON.grip,
    onmousedown: (e) => e.preventDefault(),
  });
  const plus = (cls, tip) => el('button', {
    type: 'button', class: `nt-tbl-add ${cls}`, 'data-tip': tip, 'data-tip-pos': 'above',
    'aria-label': tip, html: ICON.plus,
    onmousedown: (e) => e.preventDefault(),
  });
  handles = {
    row: grip('is-row', 'Row'),
    col: grip('is-col', 'Column'),
    addRow: plus('is-row', 'Add a row'),
    addCol: plus('is-col', 'Add a column'),
  };
  for (const h of Object.values(handles)) {
    h.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    h.addEventListener('pointerleave', () => armHide());
  }
  handles.row.addEventListener('click', () => openRowMenu());
  handles.col.addEventListener('click', () => openColMenu());
  handles.addRow.addEventListener('click', () => {
    const { body, table } = at();
    if (table) { const tr = addRow(body, table, rowsOf(table).length); if (tr) caretToStart(tr.children[0]); }
  });
  handles.addCol.addEventListener('click', () => {
    const { body, table } = at();
    if (table) addColumn(body, table, colCount(table));
  });
  for (const h of Object.values(handles)) ctx.root.append(h);
  return handles;
}

function at() {
  const cell = overCell && overCell.isConnected ? overCell : null;
  const table = cell ? tableOf(cell) : null;
  const body = table ? closest(table, '.nt-body') : null;
  if (!cell || !table || !body) return {};
  const tr = cell.parentElement;
  return { cell, table, body, row: rowsOf(table).indexOf(tr), col: [...tr.children].indexOf(cell) };
}

function onPointerMove(e) {
  const cell = isCell(e.target) ? e.target : cellOf(e.target);
  if (!cell) { armHide(); return; }
  clearTimeout(hideTimer);
  overCell = cell;
  place();
}

function armHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => hideHandles(), HIDE_GRACE);
}

function place() {
  const { cell, table } = at();
  if (!cell) { hideHandles(); return; }
  const h = build();
  const root = ctx.root.getBoundingClientRect();
  const c = cell.getBoundingClientRect();
  const t = table.getBoundingClientRect();
  const put = (node, left, top) => {
    node.classList.add('is-on');
    node.style.left = `${Math.round(left - root.left)}px`;
    node.style.top = `${Math.round(top - root.top)}px`;
  };
  // The row grip sits in the left margin beside its row; the column grip
  // above its column. Both centre on the cell the pointer is in.
  put(h.row, t.left - 22, c.top + c.height / 2 - 11);
  put(h.col, c.left + c.width / 2 - 11, t.top - 22);
  put(h.addRow, t.left + t.width / 2 - 11, t.bottom + 3);
  put(h.addCol, t.right + 3, t.top + t.height / 2 - 11);
  h.addRow.disabled = rowsOf(table).length >= MAX_ROWS;
  h.addCol.disabled = colCount(table) >= MAX_COLS;
  // A disabled affordance that still looks live is a control that does
  // nothing; the cap has to be visible before it is hit, not after.
  h.addRow.setAttribute('data-tip', h.addRow.disabled ? `${MAX_ROWS} rows is the most` : 'Add a row');
  h.addCol.setAttribute('data-tip', h.addCol.disabled ? `${MAX_COLS} columns is the most` : 'Add a column');
}

export function hideHandles() {
  clearTimeout(hideTimer);
  overCell = null;
  if (!handles) return;
  for (const h of Object.values(handles)) h.classList.remove('is-on');
}

function openRowMenu() {
  const { body, table, row } = at();
  if (!table) return;
  const rows = rowsOf(table);
  const full = rows.length >= MAX_ROWS;
  menu(handles.row, [
    // Above the FIRST BODY ROW is allowed; above the header is not, because
    // the header is what makes the first row the first row.
    { label: 'Insert row above', icon: ICON.plus, disabled: full || row === 0, run: () => { const tr = addRow(body, table, row); if (tr) caretToStart(tr.children[0]); } },
    { label: 'Insert row below', icon: ICON.plus, disabled: full, run: () => { const tr = addRow(body, table, row + 1); if (tr) caretToStart(tr.children[0]); } },
    null,
    { label: row === 0 ? 'The header row stays' : 'Delete row', icon: ICON.trash, danger: row !== 0, disabled: row === 0 || rows.length <= 2, run: () => removeRow(body, table, row) },
    { label: 'Delete table', icon: ICON.trash, danger: true, run: () => removeTable(body, table) },
  ], { title: row === 0 ? 'Header row' : `Row ${row}` });
}

function openColMenu() {
  const { body, table, col } = at();
  if (!table) return;
  const full = colCount(table) >= MAX_COLS;
  menu(handles.col, [
    { label: 'Insert column left', icon: ICON.plus, disabled: full, run: () => addColumn(body, table, col) },
    { label: 'Insert column right', icon: ICON.plus, disabled: full, run: () => addColumn(body, table, col + 1) },
    null,
    { label: 'Delete column', icon: ICON.trash, danger: true, disabled: colCount(table) <= 1, run: () => removeColumn(body, table, col) },
  ], { title: `Column ${col + 1}` });
}
