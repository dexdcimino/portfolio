/* What a note body is allowed to contain, and how anything else is coerced
 * into it.
 *
 * The body of a category is one HTML string. Every string that reaches the
 * DOM -- from the server, from a paste, from a drop, from undo -- passes
 * through `clean()` first, and every string that leaves the DOM for the
 * server passes through `serialize()`. Between those two, the browser is free
 * to do what a contenteditable does, and `scrub()` after each input pulls it
 * back into the schema before it can compound.
 *
 * THE SCHEMA
 *   root      p | h3 | ul | ol | pre | blockquote | hr | table
 *   ul, ol    li+            ul may carry class "todo"; ol may carry type 1|a|i
 *   li        inline*, then at most one ul|ol at the very end; data-checked
 *   p, h3, blockquote   inline*; class al-c | al-r for alignment
 *   pre       text and br only
 *   table     exactly one tbody; tbody tr+; tr th+ in the FIRST row, td+ after
 *   th, td    inline* only -- no blocks, no lists, no nested tables, and no
 *             colspan or rowspan. Every row is the same width.
 *   inline    text | b | i | u | s | code | a | br | img | span.chip
 *   a         href http(s)/mailto only. class "chip chip-link" for a chip.
 *   img       class nt-img, data-key <sha>.<ext>, data-w 25|50|75|100
 *   span      class "chip chip-md" with data-md; nothing else survives
 *
 * A TABLE IS RECTANGULAR AND FLAT, and both halves of that are enforced here
 * rather than trusted. Ragged rows and spans are where every table editor's
 * hard bugs live: with them, "the cell to the right" and "the column under
 * this one" stop being the same question, and every add, remove and Tab has
 * to answer both. Flat cells mean a cell is one line box holding inline
 * content, which is a shape the caret rules in editor.js already know.
 *
 * A table OVER THE CAP is not a table. `MAX_COLS` x `MAX_ROWS` is what the
 * editor can add up to; anything larger arriving from a paste or an older
 * document becomes one paragraph per row, cells joined by " · ", which is
 * exactly what every pasted table did before tables existed. Nothing is lost
 * and the invariant holds.
 *
 * No style attribute anywhere. The site's CSP has no 'unsafe-inline' for
 * styles, so an inline style is not merely untidy -- it is silently ignored
 * when the document is rendered from a string, and would show up as a body
 * that looks different after a reload than it did while typing.
 */

import { isEl, isText, isList, isCell } from './dom.js';

const ROOT_BLOCKS = new Set(['P', 'H3', 'UL', 'OL', 'PRE', 'BLOCKQUOTE', 'HR', 'TABLE']);
const TABLE_PARTS = new Set(['TBODY', 'TR', 'TD', 'TH']);
const INLINE = new Set(['B', 'I', 'U', 'S', 'CODE', 'A', 'BR', 'IMG', 'SPAN']);
// THEAD and TFOOT fold into the one tbody: a header row is the FIRST row,
// not a second container to keep in step with the first.
const ALIAS = { STRONG: 'B', EM: 'I', STRIKE: 'S', DEL: 'S', H1: 'H3', H2: 'H3', H4: 'H3', H5: 'H3', H6: 'H3', DIV: 'P', THEAD: 'TBODY', TFOOT: 'TBODY' };

/* THE CAP, and where the numbers came from.
 *
 * EIGHT COLUMNS is what the app's WIDEST writing area holds at a readable
 * width. Measured: a category body is 948px at 1440px and wider, and 8
 * columns of that is 118px each -- enough for "Progressive", the widest word
 * in the bills table this was built for, which is 88px at the default 17px.
 * A ninth column puts every cell under 105px and ordinary words start
 * wrapping. The NARROWEST body the layout produces is 368px (at a 780px
 * window, the last width before the sidebar stops being docked), and 8
 * columns cannot be readable in that -- so the table scrolls sideways inside
 * its own box below `--nt-col-min` per column rather than being squeezed.
 *
 * FIFTY ROWS is an editorial cap, not a technical one, and the measurement
 * is what says so. Every keystroke in a category clones the whole body twice
 * -- capture() for the history and serialize() for the save comparison -- and
 * an 8x50 table costs 1.4ms of that, against 0.05ms for an empty one; 8x400
 * is still only 7.2ms, well inside a frame. In the store an 8x50 filled table
 * is 8.4 KB, 0.2% of the 4 MB document ceiling. So 50 is where a note stops
 * being a note, chosen with roughly eight times that much headroom measured
 * underneath it -- which is the number to look at before moving it, rather
 * than re-deriving whether it is safe.
 */
export const MAX_COLS = 8;
export const MAX_ROWS = 50;
const BLOCK_CLASSES = new Set(['al-c', 'al-r']);
const IMG_WIDTHS = new Set(['25', '50', '75', '100']);

export const ASSET_KEY = /^[0-9a-f]{64}\.(png|jpg|webp|gif)$/;
const HREF_OK = /^(https?:\/\/|mailto:)/i;

/* ---- clean: any HTML string -> schema HTML ------------------------------ */

export function clean(html) {
  // Style attributes are renamed in the text before anything parses it.
  // Even an inert DOMParser document reports "Applying inline style
  // violates the CSP" for every one, and the only reader of them here is
  // the bold/italic inference below, which reads data-st.
  const defused = String(html || '').replace(/(<[a-zA-Z][^>]*?\s)style(\s*=)/g, '$1data-st$2');
  const parsed = new DOMParser().parseFromString(`<div id="r">${defused}</div>`, 'text/html');
  const holder = parsed.getElementById('r') || parsed.body;
  cleanTree(holder);
  normalizeRoot(holder);
  return holder.innerHTML;
}

/* Same, but on a live element (used after paste into a fragment). */
export function cleanNode(node) {
  cleanTree(node);
  normalizeRoot(node);
  return node;
}

function cleanTree(node) {
  for (const child of [...node.childNodes]) {
    if (isText(child)) {
      // Zero-width spaces were the old editor's scaffolding around chips.
      // They are invisible, they break word boundaries for the spell
      // checker, and nothing here needs them.
      if (child.nodeValue.includes('​')) child.nodeValue = child.nodeValue.replace(/​/g, '');
      // Whitespace-only text between blocks is source formatting, not
      // content, and inside a list it is a line box that pads the item.
      if (!child.nodeValue.trim()) {
        const blockish = (n) => isEl(n) && (ROOT_BLOCKS.has(n.tagName) || n.tagName === 'LI');
        if (blockish(child.previousSibling) || blockish(child.nextSibling) || isList(node) || (isEl(node) && node.tagName === 'LI' && isList(child.nextSibling))) {
          child.remove();
        }
      }
      continue;
    }
    if (!isEl(child)) { child.remove(); continue; }   // comments and the like

    let tag = child.tagName;
    if (ALIAS[tag]) tag = ALIAS[tag];

    // Some elements say what they are through their style, which is how a
    // paste from Google Docs arrives: <span style="font-weight:700">.
    if (child.tagName === 'SPAN' && !child.classList.contains('chip')) {
      const inferred = inlineFromStyle(child);
      if (inferred) tag = inferred;
    }
    if (child.tagName === 'B' && /font-weight:\s*(normal|[1-3]\d\d)\b/.test(child.getAttribute('data-st') || child.getAttribute('style') || '')) {
      unwrap(child); cleanTree(node); return;
    }

    const allowed = ROOT_BLOCKS.has(tag) || tag === 'LI' || TABLE_PARTS.has(tag) || INLINE.has(tag);
    if (!allowed) {
      // Unwrap rather than remove: a tag this does not know about is far
      // more likely to be a paste from somewhere than an attack, and deleting
      // the words inside it would lose real notes. A table part with no table
      // around it is one of those -- the parser drops it anyway, but a
      // <caption> or a <colgroup> arrives intact and is not content.
      if (tag === 'CAPTION') {
        const p = document.createElement('p');
        while (child.firstChild) p.append(child.firstChild);
        child.replaceWith(p);
        cleanTree(node);
        return;
      } else if (tag === 'COLGROUP' || tag === 'COL') {
        child.remove();
      } else if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'HEAD' || tag === 'META' || tag === 'LINK' || tag === 'TITLE') {
        child.remove();
      } else {
        unwrap(child);
      }
      cleanTree(node);
      return;
    }

    let target = child;
    if (tag !== child.tagName) {
      target = document.createElement(tag.toLowerCase());
      while (child.firstChild) target.append(child.firstChild);
      // Carry the two things a renamed element may legitimately keep.
      if (child.getAttribute('class')) target.setAttribute('class', child.getAttribute('class'));
      if (child.getAttribute('data-md')) target.setAttribute('data-md', child.getAttribute('data-md'));
      child.replaceWith(target);
    }
    cleanAttributes(target);
    cleanTree(target);
  }
}

function inlineFromStyle(span) {
  const style = span.getAttribute('data-st') || span.getAttribute('style') || '';
  if (/font-weight:\s*(bold|[6-9]\d\d)/.test(style)) return 'B';
  if (/font-style:\s*italic/.test(style)) return 'I';
  if (/text-decoration[^;]*underline/.test(style)) return 'U';
  if (/text-decoration[^;]*line-through/.test(style)) return 'S';
  return null;
}

function unwrap(node) { node.replaceWith(...node.childNodes); }

function unwrapAsLines(node) {
  const frag = document.createDocumentFragment();
  node.querySelectorAll('tr').forEach((row) => {
    const p = document.createElement('p');
    const cells = [...row.querySelectorAll('td,th')].map((c) => c.textContent.trim()).filter(Boolean);
    p.textContent = cells.join(' · ');
    if (cells.length) frag.append(p);
  });
  if (!frag.childNodes.length) { unwrap(node); return; }
  node.replaceWith(frag);
}

function cleanAttributes(el) {
  const tag = el.tagName;
  /* THE MARK GOES FIRST, before the class filter below runs -- `nt-chip-mark`
     is not in the allowed class set, so by the time the SPAN rule at the
     bottom of this function looks for it the class has already been stripped
     and the span is unwrapped instead of removed, leaving its letter loose in
     the middle of the chip's label. A chip pasted from one note into another
     came out reading "Ggoogle.com". */
  if (tag === 'SPAN' && el.classList.contains('nt-chip-mark')) { el.remove(); return; }
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase();
    let keep = false;
    if (name === 'class') keep = true;             // filtered below
    else if (name === 'href' && tag === 'A') keep = HREF_OK.test(attr.value);
    else if (name === 'type' && tag === 'OL') keep = /^(1|a|i)$/.test(attr.value);
    else if (name === 'data-checked' && tag === 'LI') keep = true;
    else if (name === 'data-key' && tag === 'IMG') keep = ASSET_KEY.test(attr.value);
    else if (name === 'data-w' && tag === 'IMG') keep = IMG_WIDTHS.has(attr.value);
    else if (name === 'alt' && tag === 'IMG') keep = true;
    else if (name === 'data-md' && tag === 'SPAN') keep = true;
    // Folded. Only the one value: a chip is folded or it is not.
    else if (name === 'data-min' && (tag === 'A' || tag === 'SPAN')) keep = attr.value === '1';
    else if (name === 'title' && (tag === 'A' || tag === 'SPAN')) keep = true;
    if (!keep) el.removeAttribute(attr.name);
  }
  // Classes are a closed set per tag.
  if (el.hasAttribute('class')) {
    const cls = [...el.classList].filter((c) => classOk(tag, c, el));
    if (cls.length) el.className = cls.join(' '); else el.removeAttribute('class');
  }
  if (tag === 'A') {
    if (!el.getAttribute('href')) { el.classList.remove('chip', 'chip-link'); }
    if (el.classList.contains('chip')) {
      el.setAttribute('contenteditable', 'false');
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener');
    } else {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener');
    }
  }
  if (tag === 'SPAN') {
    if (!el.classList.contains('chip') || !el.getAttribute('data-md')) {
      // A span that is not a markdown chip has no business here.
      el.replaceWith(...el.childNodes);
      return;
    }
    el.setAttribute('contenteditable', 'false');
  }
  if (tag === 'IMG') {
    if (!el.getAttribute('data-key')) { el.remove(); return; }
    el.className = 'nt-img';
    if (!el.getAttribute('data-w')) el.setAttribute('data-w', '50');
    el.setAttribute('draggable', 'false');
  }
  if (tag === 'LI' && el.getAttribute('data-checked') !== null && el.getAttribute('data-checked') !== '1') {
    el.removeAttribute('data-checked');
  }
}

function classOk(tag, cls, el) {
  if (tag === 'UL') return cls === 'todo';
  if (tag === 'P' || tag === 'H3' || tag === 'BLOCKQUOTE') return BLOCK_CLASSES.has(cls);
  if (tag === 'A') return cls === 'chip' || cls === 'chip-link';
  if (tag === 'SPAN') return cls === 'chip' || cls === 'chip-md';
  if (tag === 'IMG') return cls === 'nt-img';
  return false;
}

/* ---- normalize: enforce the block structure ------------------------------ */

/* Root children must be blocks. Runs of inline content and text at the root
 * are wrapped in <p>; a <br> at the root splits paragraphs. Lists are fixed
 * up so every child is an <li> and every nested list sits at the end of an
 * <li>. Empty root -> one empty paragraph. */
export function normalizeRoot(root) {
  wrapInline(root, 'p');
  for (const list of root.querySelectorAll('ul,ol')) fixList(list);
  for (const li of root.querySelectorAll('li')) fixItem(li);
  for (const pre of root.querySelectorAll('pre')) fixPre(pre);
  // Innermost first: a table inside a cell is flattened by the cell it is in,
  // so the outer table's own shape is settled after its cells are.
  for (const table of [...root.querySelectorAll('table')].reverse()) fixTable(table, root);
  for (const block of root.querySelectorAll('p,h3,blockquote,li,td,th')) {
    // A block with nothing in it keeps a <br> so it has a line box to click.
    if (!block.childNodes.length) block.append(document.createElement('br'));
    // No nested blocks inside a paragraph: <p><p>x</p></p> cannot exist in
    // the parser, but <li><p>x</p></li> can, and it should be <li>x</li>.
  }
  for (const p of [...root.querySelectorAll('li > p, li > h3, blockquote > p, p > p')]) unwrap(p);
  // Merge adjacent lists of the same kind: two <ul>s in a row are one list
  // that got split, and every editor operation assumes they were.
  for (const list of [...root.children]) {
    const prev = list.previousElementSibling;
    if (isList(list) && prev && prev.tagName === list.tagName && prev.className === list.className && prev.getAttribute('type') === list.getAttribute('type')) {
      while (list.firstChild) prev.append(list.firstChild);
      list.remove();
    }
  }
  /* A TABLE IS NEVER THE FIRST OR LAST BLOCK IN A BODY. Without this there
   * is no line to put the caret on above a table at the top of a note, or
   * below one at the bottom, and no key that can make one -- the caret has
   * nowhere to go, so the table cannot be escaped in that direction and a
   * paragraph cannot be typed there. Doing it here rather than in a key
   * handler is what makes it true for a body that arrived from the store,
   * from a paste and from undo, and it is idempotent, so clean() still
   * agrees with itself. */
  if (root.firstElementChild && root.firstElementChild.tagName === 'TABLE') root.prepend(emptyP());
  if (root.lastElementChild && root.lastElementChild.tagName === 'TABLE') root.append(emptyP());
  if (!root.childNodes.length) root.append(emptyP());
}

function emptyP() {
  const p = document.createElement('p');
  p.append(document.createElement('br'));
  return p;
}

/* ---- tables --------------------------------------------------------------- */

/* Make a table rectangular, flat and inside the cap, or make it not a table.
 * `root` is the body it lives in, so an over-cap table can be replaced by the
 * lines it becomes. */
function fixTable(table, root) {
  // Anything that is not a row container gets lifted OUT rather than dropped:
  // a <caption> has already become a paragraph by now, and a paragraph inside
  // a <table> is content standing in the wrong place, not decoration.
  for (const child of [...table.childNodes]) {
    if (isEl(child) && child.tagName === 'TBODY') continue;
    if (isEl(child) && child.tagName === 'TR') continue;      // moved below
    if (isText(child) && !child.nodeValue.trim()) { child.remove(); continue; }
    table.before(child);
  }
  // One tbody. Rows sitting directly on the table, or spread over several
  // bodies (a thead and a tbody, both aliased to TBODY above), come together.
  let body = table.querySelector(':scope > tbody');
  if (!body) { body = document.createElement('tbody'); table.prepend(body); }
  for (const child of [...table.children]) {
    if (child === body) continue;
    if (child.tagName === 'TBODY' || child.tagName === 'TR') {
      const rows = child.tagName === 'TR' ? [child] : [...child.children];
      for (const tr of rows) if (tr.tagName === 'TR') body.append(tr);
      if (child !== body) child.remove();
    }
  }
  const rows = [...body.children].filter((n) => n.tagName === 'TR');
  for (const tr of body.children) if (tr.tagName !== 'TR') tr.remove();

  // Cells hold inline content only, and a cell's own nested table is flattened
  // before anything is counted -- otherwise the width of this table depends on
  // a table inside it.
  for (const tr of rows) {
    for (const child of [...tr.childNodes]) {
      if (isCell(child)) { fixCell(child); continue; }
      if (isText(child) && !child.nodeValue.trim()) { child.remove(); continue; }
      // Loose content in a row: give it a cell rather than lose it.
      const td = document.createElement('td');
      child.replaceWith(td);
      td.append(child);
      fixCell(td);
    }
  }

  const width = rows.reduce((n, tr) => Math.max(n, tr.children.length), 0);
  if (!rows.length || !width) { table.remove(); return; }

  /* OVER THE CAP IS NOT A TABLE. The alternative -- truncating to the cap --
   * silently deletes cells, and a table that arrives from a paste is exactly
   * the case where nobody would notice which ones. Lines lose the grid and
   * keep every word. */
  if (width > MAX_COLS || rows.length > MAX_ROWS) { unwrapAsLines(table); void root; return; }

  // Rectangular: every row is `width` cells, and the first row is the header.
  rows.forEach((tr, r) => {
    const want = r === 0 ? 'TH' : 'TD';
    for (const cell of [...tr.children]) {
      if (cell.tagName === want) continue;
      const swap = document.createElement(want.toLowerCase());
      while (cell.firstChild) swap.append(cell.firstChild);
      cell.replaceWith(swap);
    }
    while (tr.children.length < width) tr.append(document.createElement(want.toLowerCase()));
  });
}

/* A cell is one line box of inline content. Blocks inside it flatten to lines
 * the way they do inside an <li>, and a nested table becomes its own cells'
 * text -- the same answer clean() gave every pasted table before this. */
function fixCell(cell) {
  const isBr = (n) => isEl(n) && n.tagName === 'BR';
  // One break between two flattened things, never two. A <p> followed by a
  // <ul> would otherwise earn a break from each of them and land in the cell
  // as a blank line nobody typed.
  const breakBefore = (node) => { if (node.previousSibling && !isBr(node.previousSibling)) node.before(document.createElement('br')); };
  const breakAfter = (node) => { if (node.nextSibling && !isBr(node.nextSibling)) node.after(document.createElement('br')); };
  for (const inner of [...cell.querySelectorAll('table')]) unwrapAsLines(inner);
  for (const list of [...cell.querySelectorAll('ul,ol')]) {
    for (const li of [...list.querySelectorAll('li')]) {
      // The FIRST item needs no break of its own: whatever the list follows
      // has already earned one from breakAfter below.
      breakBefore(li);
      unwrap(li);
    }
    unwrap(list);
  }
  for (const child of [...cell.childNodes]) {
    if (isEl(child) && (ROOT_BLOCKS.has(child.tagName) || child.tagName === 'LI')) {
      breakAfter(child);
      if (child.tagName === 'HR') { child.remove(); continue; }
      unwrap(child);
    }
  }
  cell.removeAttribute('class');
}

function wrapInline(root, tag) {
  let run = null;
  for (const child of [...root.childNodes]) {
    const inline = isText(child) || (isEl(child) && !ROOT_BLOCKS.has(child.tagName) && child.tagName !== 'LI');
    if (isEl(child) && child.tagName === 'LI') {
      // A stray <li> at the root: give it a list.
      const ul = document.createElement('ul');
      child.replaceWith(ul);
      ul.append(child);
      run = null;
      continue;
    }
    if (isEl(child) && child.tagName === 'BR' && !run) { child.remove(); continue; }
    if (isEl(child) && child.tagName === 'BR' && run) { child.remove(); run = null; continue; }
    if (inline) {
      if (isText(child) && !child.nodeValue.trim() && !run) { child.remove(); continue; }
      if (!run) { run = document.createElement(tag); child.replaceWith(run); run.append(child); }
      else run.append(child);
    } else {
      run = null;
    }
  }
}

function fixList(list) {
  for (const child of [...list.childNodes]) {
    if (isEl(child) && child.tagName === 'LI') continue;
    if (isList(child)) {
      // <ul><ul>..</ul></ul>: the nested list belongs to the previous item.
      const prev = child.previousElementSibling;
      if (prev && prev.tagName === 'LI') prev.append(child);
      else { const li = document.createElement('li'); child.replaceWith(li); li.append(child); }
      continue;
    }
    if (isText(child) && !child.nodeValue.trim()) { child.remove(); continue; }
    // Anything else: wrap in an item.
    const li = document.createElement('li');
    child.replaceWith(li);
    li.append(child);
  }
  if (!list.children.length) list.remove();
}

function fixItem(li) {
  // Every nested list goes to the end, merged into one.
  const nested = [...li.children].filter(isList);
  if (nested.length) {
    const first = nested[0];
    for (const extra of nested.slice(1)) { while (extra.firstChild) first.append(extra.firstChild); extra.remove(); }
    li.append(first);
    // A nested list needs the item to have its own line; an item that is
    // ONLY a nested list gets an empty line box in front.
    if (li.firstChild === first) li.prepend(document.createElement('br'));
  }
  // Block children inside an item (a paste of <li><p>a</p><p>b</p></li>)
  // flatten to inline content with breaks.
  for (const child of [...li.childNodes]) {
    if (isEl(child) && (child.tagName === 'P' || child.tagName === 'H3' || child.tagName === 'BLOCKQUOTE' || child.tagName === 'PRE')) {
      const next = child.nextSibling;
      if (next && !isList(next)) child.after(document.createElement('br'));
      unwrap(child);
    }
  }
  // The <br> Chrome leaves at the end of an item that has a nested list is a
  // blank line between the item and its children.
  for (const child of [...li.childNodes]) {
    if (isEl(child) && child.tagName === 'BR' && isList(child.nextSibling) && child.previousSibling && child.previousSibling.textContent) child.remove();
  }
}

function fixPre(pre) {
  // Code keeps text and line breaks only.
  for (const child of [...pre.querySelectorAll('*')]) {
    if (child.tagName === 'BR') continue;
    child.replaceWith(...child.childNodes);
  }
  pre.removeAttribute('class');
}

/* ---- scrub: after the browser has done something ------------------------ */

/* Cheap and local. After each native input the block under the caret is
 * checked for what Chrome adds on its own -- style attributes when merging
 * lines of different colour, <span>s, <div>s -- and the root is re-normalised
 * only if the root's children are no longer all blocks. Returns true if the
 * DOM was changed, so the caller can re-place the caret. */
export function scrub(root) {
  let changed = false;
  for (const styled of root.querySelectorAll('[style]')) {
    styled.removeAttribute('style');
    changed = true;
  }
  /* .nt-chip-mark is the third span this is not about. It is a rendering the
     app puts inside a chip on every hydrate -- not something Chrome left
     behind -- and unwrapping it dropped its letter loose into the middle of
     the chip's label, which is how a link came out reading "Ggoogle.com".
     The other two exclusions are here for the same reason. */
  for (const font of root.querySelectorAll('font, span:not(.chip):not(.nt-interim):not(.nt-chip-mark), div, strong, em, strike, del')) {
    if (font.tagName === 'DIV') {
      const p = document.createElement('p');
      while (font.firstChild) p.append(font.firstChild);
      font.replaceWith(p);
    } else if (font.tagName === 'STRONG' || font.tagName === 'EM' || font.tagName === 'STRIKE' || font.tagName === 'DEL') {
      const t = document.createElement(font.tagName === 'STRONG' ? 'b' : font.tagName === 'EM' ? 'i' : 's');
      while (font.firstChild) t.append(font.firstChild);
      font.replaceWith(t);
    } else {
      font.replaceWith(...font.childNodes);
    }
    changed = true;
  }
  for (const child of [...root.childNodes]) {
    if (isText(child) || (isEl(child) && !ROOT_BLOCKS.has(child.tagName))) {
      normalizeRoot(root);
      changed = true;
      break;
    }
  }
  /* A TABLE THE BROWSER HAS BEEN IN. Everything above looks at the root's own
   * children, so a <p> Chrome put inside a cell -- which is what it does on
   * Enter, on a paste and on a merge across cells -- is invisible to it and
   * compounds until the next reload rewrites the note under Dex. The gate is
   * cheap because it only runs where there is a table at all, and it asks the
   * three questions normalizeRoot answers: blocks in a cell, a ragged row,
   * and a table sitting at an edge of the body with no line beside it. */
  if (root.querySelector('table')) {
    const ragged = [...root.querySelectorAll('table')].some((t) => {
      const rows = [...t.querySelectorAll(':scope > tbody > tr')];
      return t.children.length !== 1 || !rows.length
        || rows.some((tr) => tr.children.length !== rows[0].children.length);
    });
    const edge = (root.firstElementChild && root.firstElementChild.tagName === 'TABLE')
      || (root.lastElementChild && root.lastElementChild.tagName === 'TABLE');
    if (ragged || edge || root.querySelector('td > p, th > p, td > div, th > div, td > h3, th > h3, td > ul, th > ul, td > ol, th > ol, td > table, th > table, td > li, th > li')) {
      normalizeRoot(root);
      changed = true;
    }
  }
  if (!root.childNodes.length) { normalizeRoot(root); changed = true; }
  return changed;
}

/* ---- serialize: DOM -> the string that is saved -------------------------- */

/* The live DOM carries things the saved document must not: the token in every
 * image URL, the selected-image outline, a pending upload's data URI. This
 * strips them off a clone. The result is what clean() would produce, so a
 * save and a reload are byte-identical -- which is what lets the save loop
 * compare strings to know whether anything changed. */
export function serialize(root) {
  const copy = root.cloneNode(true);
  // Words the speech engine has not committed to yet. They are in the DOM
  // so they can be seen; they are not in the document.
  for (const n of copy.querySelectorAll('.nt-interim')) n.remove();
  for (const img of copy.querySelectorAll('img')) {
    if (!img.getAttribute('data-key')) { img.remove(); continue; }   // still uploading
    img.removeAttribute('src');
    img.removeAttribute('width');
    img.removeAttribute('height');
    img.classList.remove('is-selected');
    img.removeAttribute('class');
    img.className = 'nt-img';
  }
  for (const sel of copy.querySelectorAll('.is-selected, .is-active')) sel.classList.remove('is-selected', 'is-active');
  // The mark is a rendering of the chip, not part of it.
  for (const mark of copy.querySelectorAll('.nt-chip-mark')) mark.remove();
  for (const styled of copy.querySelectorAll('[style]')) styled.removeAttribute('style');
  for (const el of copy.querySelectorAll('[contenteditable]')) {
    if (!(el.classList.contains('chip'))) el.removeAttribute('contenteditable');
  }
  return copy.innerHTML;
}

/* ---- plain text ---------------------------------------------------------- */

/* A readable text rendering, for search and for copying a whole category. */
export function toText(html) {
  const holder = document.createElement('div');
  holder.innerHTML = html || '';
  const lines = [];
  const walk = (node, depth) => {
    for (const child of node.childNodes) {
      if (isText(child)) { lines[lines.length - 1] += child.nodeValue; continue; }
      if (!isEl(child)) continue;
      const t = child.tagName;
      if (t === 'BR') { lines.push(''); continue; }
      if (t === 'LI') {
        const mark = child.parentElement.tagName === 'OL' ? `${[...child.parentElement.children].indexOf(child) + 1}. `
          : child.parentElement.classList.contains('todo') ? (child.getAttribute('data-checked') ? '[x] ' : '[ ] ') : '- ';
        lines.push('  '.repeat(depth) + mark);
        walk(child, depth + 1);
        continue;
      }
      if (t === 'UL' || t === 'OL') { walk(child, depth); continue; }
      // A table reads as one line per row, the way a pasted one always has.
      // Search matches a phrase inside a cell; it should not match one that
      // spans two, so the rows are lines and the cells are separated.
      if (t === 'TABLE' || t === 'TBODY') { walk(child, depth); continue; }
      if (t === 'TR') { lines.push('  '.repeat(depth)); walk(child, depth); continue; }
      if (t === 'TD' || t === 'TH') {
        if (child.previousElementSibling) lines[lines.length - 1] += ' · ';
        walk(child, depth);
        continue;
      }
      if (t === 'P' || t === 'H3' || t === 'PRE' || t === 'BLOCKQUOTE') {
        lines.push('  '.repeat(depth) + (t === 'BLOCKQUOTE' ? '> ' : ''));
        walk(child, depth);
        continue;
      }
      if (t === 'HR') { lines.push('---'); continue; }
      if (t === 'IMG') { lines[lines.length - 1] += '[image]'; continue; }
      if (t === 'A' && child.classList.contains('chip')) { lines[lines.length - 1] += child.getAttribute('href'); continue; }
      if (t === 'SPAN' && child.classList.contains('chip-md')) { lines[lines.length - 1] += `[${child.textContent}]`; continue; }
      walk(child, depth);
    }
  };
  lines.push('');
  walk(holder, 0);
  return lines.filter((l, i) => l.trim() || (i > 0 && lines[i - 1].trim())).join('\n').trim();
}
