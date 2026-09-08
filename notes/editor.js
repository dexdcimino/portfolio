/* Typing. Everything that happens inside a category body.
 *
 * One set of listeners on the canvas, delegated to whichever body the event
 * came from: bodies are re-rendered freely and nothing here holds one.
 *
 * THE DIVISION OF LABOUR WITH THE BROWSER. The browser types characters,
 * deletes characters, splits paragraphs and applies bold. This code does
 * lists -- indent, outdent, split, merge, convert -- and blocks, because a
 * contenteditable's own ideas about lists are the source of nearly every
 * scar in the two editors this replaces. Every native edit is recorded into
 * the history from beforeinput/input; every edit made here is wrapped in a
 * transaction. Either way Ctrl+Z knows about it.
 *
 * RESTRICTIONS, ON PURPOSE. Tab in a paragraph makes it a bullet rather than
 * inserting a tab character. An item cannot be indented past the item above
 * it. Alignment is per block and a class, never a style. A chip is an atom
 * with a real character after it, not a zero-width space. Fewer shapes to be
 * in means fewer shapes to be broken in.
 */

import {
  isEl, isText, isList, elOf, closest, liveRange, setRange, collapseAt, caretToEnd, caretToStart,
  endOf, blockOf, blocksIn, atStartOf, atEndOf, ownIsEmpty, textBeforeCaret,
  deleteBeforeCaret, splitBlock, moveChildren, dropTrailingBr, serializeSelection, restoreSelection,
  rectOfCaret, keepSelection,
} from './dom.js';
import { clean, scrub, serialize } from './schema.js';
import * as tables from './table.js';
import { toast } from './ui.js';

let ctx = null;

export function initEditor(context) {
  ctx = context;
  const area = ctx.canvas;
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* old engines */ }
  try { document.execCommand('styleWithCSS', false, false); } catch { /* old engines */ }

  area.addEventListener('keydown', onKeydown);
  area.addEventListener('beforeinput', onBeforeInput);
  area.addEventListener('input', onInput);
  area.addEventListener('paste', onPaste);
  area.addEventListener('drop', onDrop);
  area.addEventListener('dragover', (e) => { if (bodyFrom(e.target)) e.preventDefault(); });
  area.addEventListener('click', onClick);
  area.addEventListener('focusout', (e) => { if (bodyFrom(e.target)) ctx.history.seal(); });
  area.addEventListener('copy', onCopy);
  area.addEventListener('cut', onCopy);
}

/* ---- which body ----------------------------------------------------------- */

export const bodyFrom = (node) => closest(node, '.nt-body');
const catIdOf = (body) => body && body.dataset.cat;

/* Where the caret is, if it is inside a body. */
function here() {
  const range = liveRange(ctx.canvas);
  if (!range) return null;
  const body = bodyFrom(range.startContainer);
  if (!body) return null;
  return { range, body, catId: catIdOf(body) };
}

/* What the history records for a body. */
/* A SNAPSHOT CARRIES NO style ATTRIBUTE, because putting one back is putting
 * it back through innerHTML -- and the CSP this app ships under (style-src
 * 'self', no unsafe-inline) blocks an inline style attribute applied that
 * way. An image in a body has `style="width:50%"` on it, set through CSSOM
 * where the policy does not apply; the moment that width rode into a history
 * snapshot, every undo in a category holding a picture logged a blocked
 * operation. The width is not lost: `data-w` is the stored form of it and
 * chips.hydrate() puts it back through CSSOM after the html lands. */
export function capture(body) {
  const copy = body.cloneNode(true);
  for (const styled of copy.querySelectorAll('[style]')) styled.removeAttribute('style');
  return { html: copy.innerHTML, sel: serializeSelection(body) };
}

/* Run a change to `body` as one undoable step. */
export function transact(body, mutate) {
  const catId = catIdOf(body);
  // Provisional dictation is in the DOM but is not part of the document;
  // taking it out before the `before` snapshot is what keeps it out of the
  // history, and out of anything undo can put back.
  ctx.dictate.clearInterim();
  return ctx.history.text(catId, () => capture(body), () => {
    const r = mutate();
    ctx.changed(body);
    return r;
  });
}

/* ---- native edits into the history --------------------------------------- */

let pending = null;   // { body, before, key, seal } captured at beforeinput

function onBeforeInput(e) {
  const body = bodyFrom(e.target);
  if (!body) return;
  ctx.dictate.clearInterim();          // same reason as in transact()
  const type = e.inputType || '';

  // The browser's own undo is switched off in favour of the app's.
  if (type === 'historyUndo') { e.preventDefault(); ctx.history.undo(); return; }
  if (type === 'historyRedo') { e.preventDefault(); ctx.history.redo(); return; }

  // Markdown triggers are decided here, before the space or backtick lands,
  // and applied in onInput after it has: the native keystroke is recorded
  // as its own step, so Ctrl+Z after "- " gives back "- " and then "-".
  let trigger = null;
  if (type === 'insertText' && e.data === ' ') trigger = detectTrigger(body);
  if (type === 'insertText' && e.data === '`') trigger = detectFence(body);

  // A chip is an atom. Deleting backwards into one removes the whole chip,
  // which Chrome does on its own for contenteditable=false -- but it also
  // sometimes deletes the character AFTER it first. Do it by hand.
  if (type === 'deleteContentBackward') {
    const r = liveRange(body);
    if (r && r.collapsed && deleteChipBefore(body, r)) { e.preventDefault(); return; }
  }

  let key = 'other';
  let seal = false;
  if (type === 'insertText') {
    key = 'type';
    if (/^\s$/.test(e.data || '') || /[.,;:!?]/.test(e.data || '')) seal = true;
  } else if (type === 'deleteContentBackward' || type === 'deleteContentForward' || type === 'deleteWordBackward' || type === 'deleteWordForward') {
    key = type.startsWith('deleteContentB') || type === 'deleteWordBackward' ? 'back' : 'fwd';
  } else if (type === 'insertCompositionText') {
    key = 'type';
  }
  pending = { body, before: capture(body), key, seal, type, data: e.data, trigger };
}

function onInput(e) {
  const body = bodyFrom(e.target);
  if (!body) return;
  if (e.isComposing) return;
  const p = pending;
  pending = null;
  // Whatever the browser did, pull it back into the schema before it can
  // compound. A scrub that changes the DOM re-places the caret.
  if (scrub(body)) {
    const sel = p ? serializeSelection(body) : null;
    if (sel) restoreSelection(body, sel);
    else caretToEnd(body);
  }
  if (p && p.body === body) {
    const after = capture(body);
    if (after.html !== p.before.html) {
      ctx.history.native({ catId: catIdOf(body), key: p.key, before: p.before, after, seal: p.seal });
    }
  } else if (!ctx.history.applying) {
    // An input with no beforeinput (some IME paths): record it whole.
    ctx.history.seal();
  }
  ctx.changed(body);
  if (p && p.trigger && p.body === body) { ctx.history.seal(); applyTrigger(body, p.trigger); return; }
  if (p && p.type === 'insertText' && p.seal) ctx.spell.wordDone(body, p.data);
  if (p && (p.type === 'insertText' || p.type === 'insertParagraph')) ctx.chips.autoLink(body, p.type === 'insertParagraph');
  ctx.emoji.watch(body);
  ctx.slash.watch(body);
}

/* ---- keys ------------------------------------------------------------------ */

function onKeydown(e) {
  const body = bodyFrom(e.target);
  if (!body) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key;

  // Pickers get the navigation keys while they are open.
  if (ctx.emoji.isOpen() && ctx.emoji.onKey(e)) return;
  if (ctx.slash.isOpen() && ctx.slash.onKey(e)) return;

  /* A CELL FIRST. Tab, Enter and Backspace all mean something different
     inside a table, and every rule below this line assumes a block that can
     be split or a list item that can be outdented -- neither of which a cell
     is. table.js answers for the cell or says it did not. */
  if (tables.onKey(body, e)) return;

  if (key === 'Tab') { e.preventDefault(); indent(body, e.shiftKey); return; }
  if (key === 'Enter') {
    if (mod && !e.shiftKey) { if (toggleTodoAtCaret(body)) e.preventDefault(); return; }
    if (e.shiftKey) return;                   // a line break, natively
    if (onEnter(body)) e.preventDefault();
    return;
  }
  if (key === 'Backspace' && !mod && !e.altKey) { if (onBackspace(body)) e.preventDefault(); return; }
  /* Blur, and stop there. Without stopPropagation this also reached the
     <dialog> and shut the overlay, so one Escape both left the box and left
     the notes. A second Escape, with nothing focused, still closes. */
  if (key === 'Escape') { e.stopPropagation(); body.blur(); return; }

  if (!mod) return;
  const k = key.toLowerCase();
  if (k === 'z' && e.shiftKey) { e.preventDefault(); ctx.history.redo(); return; }
  if (k === 'z') { e.preventDefault(); ctx.history.undo(); return; }
  if (k === 'y') { e.preventDefault(); ctx.history.redo(); return; }
  if (k === 'b') { e.preventDefault(); format('bold'); return; }
  if (k === 'i') { e.preventDefault(); format('italic'); return; }
  if (k === 'u') { e.preventDefault(); format('underline'); return; }
  if (k === 'd' && e.shiftKey) { e.preventDefault(); format('strikeThrough'); return; }
  if (k === 'e' && !e.shiftKey) { e.preventDefault(); format('code'); return; }
  if (k === 'k') { e.preventDefault(); ctx.chips.promptLink(body); return; }
  if (e.shiftKey && (k === '7' || k === '&')) { e.preventDefault(); toggleList(body, 'ol'); return; }
  if (e.shiftKey && (k === '8' || k === '*')) { e.preventDefault(); toggleList(body, 'ul'); return; }
  if (e.shiftKey && (k === '9' || k === '(')) { e.preventDefault(); toggleList(body, 'todo'); return; }
  if (e.shiftKey && k === 'l') { e.preventDefault(); align(body, 'left'); return; }
  if (e.shiftKey && k === 'e') { e.preventDefault(); align(body, 'center'); return; }
  if (e.shiftKey && k === 'r') { e.preventDefault(); align(body, 'right'); return; }
  if (e.altKey && k === '1') { e.preventDefault(); setBlock(body, 'h3'); return; }
  if (e.altKey && k === '0') { e.preventDefault(); setBlock(body, 'p'); return; }
}

/* ---- Enter ---------------------------------------------------------------- */

function onEnter(body) {
  const range = liveRange(body);
  if (!range) return false;
  const block = blockOf(body, range.startContainer);
  if (!block) return false;

  if (block.tagName === 'LI') {
    return transact(body, () => {
      if (!range.collapsed) range.deleteContents();
      const li = block;
      if (ownIsEmpty(li) && !li.querySelector('ul,ol')) {
        // Enter on an empty item finishes the list the way it was built.
        outdentItem(li);
        return true;
      }
      const next = splitBlock(li, range, 'li');
      // A todo item's new sibling starts unchecked.
      next.removeAttribute('data-checked');
      dropTrailingBr(li);
      caretToStart(next);
      return true;
    });
  }

  if (block.tagName === 'PRE') {
    // Code takes newline characters, never <br>: Chrome treats a trailing
    // <br> as a placeholder it may remove or move when text follows it.
    return transact(body, () => {
      if (!range.collapsed) range.deleteContents();
      const before = textBeforeCaret(block, range);
      if (atEndOf(block, range) && /\n$/.test(before)) {
        // Enter on an empty last line leaves the block.
        deleteBeforeCaret(range, 1);
        const p = document.createElement('p');
        p.append(document.createElement('br'));
        block.after(p);
        caretToStart(p);
        return true;
      }
      const t = document.createTextNode('\n');
      range.insertNode(t);
      collapseAt(t, 1);
      return true;
    });
  }

  if (block.tagName === 'BLOCKQUOTE') {
    // A quote is one block per line; consecutive quotes draw as one. Enter on
    // an empty quote line leaves the quote.
    return transact(body, () => {
      if (!range.collapsed) range.deleteContents();
      if (ownIsEmpty(block)) { const p = setBlockTag(block, 'p'); caretToStart(p); return true; }
      const next = splitBlock(block, range, 'blockquote');
      dropTrailingBr(block);
      caretToStart(next);
      return true;
    });
  }

  if (block.tagName === 'P' && /^\s*(---|\*\*\*)\s*$/.test(block.textContent) && !block.querySelector('img,[contenteditable="false"]')) {
    return transact(body, () => {
      const hr = document.createElement('hr');
      const p = document.createElement('p');
      p.append(document.createElement('br'));
      block.replaceWith(hr);
      hr.after(p);
      caretToStart(p);
      return true;
    });
  }

  if (block.tagName === 'H3') {
    // Enter at the end of a heading starts a paragraph, not another heading.
    if (atEndOf(block, range)) {
      return transact(body, () => {
        const p = document.createElement('p');
        p.append(document.createElement('br'));
        block.after(p);
        caretToStart(p);
        return true;
      });
    }
  }
  if (block.tagName === 'P' && block.classList.length && atEndOf(block, range)) {
    // A new paragraph does not inherit alignment.
    return transact(body, () => {
      const p = document.createElement('p');
      p.append(document.createElement('br'));
      block.after(p);
      caretToStart(p);
      return true;
    });
  }
  return false;   // paragraphs split natively
}

/* ---- Backspace ------------------------------------------------------------ */

function onBackspace(body) {
  const range = liveRange(body);
  if (!range || !range.collapsed) return false;
  const block = blockOf(body, range.startContainer);
  if (!block || !atStartOf(block, range)) return false;

  if (block.tagName === 'LI') {
    // Unwind before merging: nested steps out, top-level becomes a
    // paragraph, and only a paragraph merges upward.
    return transact(body, () => { outdentItem(block); return true; });
  }
  if (block.tagName === 'H3' || block.tagName === 'BLOCKQUOTE' || block.tagName === 'PRE') {
    if (block.tagName === 'H3' || ownIsEmpty(block)) return transact(body, () => { setBlockTag(block, 'p'); return true; });
    return false;
  }
  if (block.tagName === 'P') {
    if (block.classList.length) return transact(body, () => { block.removeAttribute('class'); return true; });
    const prev = block.previousElementSibling;
    if (!prev) return false;
    if (prev.tagName === 'HR') return transact(body, () => { prev.remove(); return true; });
    if (isList(prev)) {
      // Merge into the deepest last item of the list above.
      return transact(body, () => {
        let li = prev.lastElementChild;
        while (li && li.lastElementChild && isList(li.lastElementChild)) li = li.lastElementChild.lastElementChild;
        if (!li) return false;
        const at = endOf(li);
        const nested = [...li.children].find(isList);
        const target = document.createRange();
        target.setStart(at.node, at.offset);
        if (isEl(li.lastChild) && li.lastChild.tagName === 'BR' && !nested) li.lastChild.remove();
        const frag = document.createDocumentFragment();
        while (block.firstChild) frag.append(block.firstChild);
        if (nested) nested.before(frag); else li.append(frag);
        block.remove();
        if (isEl(li.firstChild) && li.firstChild.tagName === 'BR' && li.childNodes.length > 1) li.firstChild.remove();
        setRange(target);
        return true;
      });
    }
    if (prev.tagName === 'PRE' || prev.tagName === 'BLOCKQUOTE') {
      return transact(body, () => {
        const at = endOf(prev);
        if (block.textContent || block.querySelector('img,[contenteditable="false"]')) {
          if (isEl(prev.lastChild) && prev.lastChild.tagName === 'BR') prev.lastChild.remove();
          if (prev.tagName === 'PRE') prev.append(document.createTextNode('\n' + block.textContent));
          else { prev.append(document.createElement('br')); moveChildren(block, prev); }
        }
        block.remove();
        collapseAt(at.node, at.offset);
        return true;
      });
    }
  }
  return false;
}

/* Remove a chip immediately before a collapsed caret. */
function deleteChipBefore(body, range) {
  let node = range.startContainer;
  let offset = range.startOffset;
  if (isText(node)) {
    if (offset > 0) return false;
    const prev = node.previousSibling;
    if (isEl(prev) && prev.classList.contains('chip')) {
      transact(body, () => { prev.remove(); });
      return true;
    }
    return false;
  }
  const prev = node.childNodes[offset - 1];
  if (isEl(prev) && prev.classList.contains('chip')) {
    transact(body, () => { prev.remove(); collapseAt(node, offset - 1); });
    return true;
  }
  return false;
}

/* ---- Tab / Shift+Tab ------------------------------------------------------- */

export function indent(body, back) {
  const range = liveRange(body);
  if (!range) return;
  const blocks = blocksIn(body, range);
  if (!blocks.length) return;
  const items = blocks.filter((b) => b.tagName === 'LI');
  const others = blocks.filter((b) => b.tagName !== 'LI' && b.tagName !== 'HR');

  // Only the topmost selected items move; their children come along.
  const tops = items.filter((li) => !items.some((o) => o !== li && o.contains(li)));

  transact(body, () => keepSelection(() => {
    if (back) {
      // Deepest first, so a child that is also selected is already out of
      // the way when its parent moves.
      for (const li of [...tops].reverse()) outdentItem(li, true);
    } else {
      // An item cannot go deeper than the one above it. If the first
      // selected item has nothing above it at its level, nothing moves:
      // partial indents are how a selection ends up as a staircase.
      if (tops.length && !previousItem(tops[0])) { if (!others.length) toast('Nothing to indent under'); }
      else for (const li of tops) indentItem(li);
      // Paragraphs become bullets. Consecutive ones join the same list.
      for (const p of others) listify(p, 'ul');
    }
  }));
}

function previousItem(li) {
  let p = li.previousSibling;
  while (p && !(isEl(p) && p.tagName === 'LI')) p = p.previousSibling;
  return p;
}

function indentItem(li) {
  const prev = previousItem(li);
  if (!prev) return false;
  const list = li.parentElement;
  let sub = [...prev.children].find(isList);
  if (!sub) {
    sub = document.createElement(list.tagName.toLowerCase());
    if (list.classList.contains('todo')) sub.className = 'todo';
    dropTrailingBr(prev);
    prev.append(sub);
  }
  sub.append(li);
  return true;
}

/* Out one level. A nested item moves after its parent, taking the items that
 * followed it as its own children. A top-level item becomes a paragraph and
 * splits the list around itself; its children become a list after it. */
function outdentItem(li, quiet) {
  const list = li.parentElement;
  const parentLi = list.parentElement;
  if (parentLi && parentLi.tagName === 'LI') {
    const following = [];
    let n = li.nextSibling;
    while (n) { following.push(n); n = n.nextSibling; }
    if (following.length) {
      let sub = [...li.children].find(isList);
      if (!sub) { sub = document.createElement(list.tagName.toLowerCase()); if (list.classList.contains('todo')) sub.className = 'todo'; dropTrailingBr(li); li.append(sub); }
      sub.append(...following);
    }
    parentLi.after(li);
    if (!list.children.length) list.remove();
    if (parentLi.childNodes.length && !parentLi.textContent && !parentLi.querySelector('br,img')) parentLi.append(document.createElement('br'));
    if (!quiet) caretToStart(li);
    return;
  }
  // Top level: leave the list.
  const p = document.createElement('p');
  const nested = [...li.children].find(isList);
  const after = [];
  let n = li.nextSibling;
  while (n) { after.push(n); n = n.nextSibling; }
  while (li.firstChild && li.firstChild !== nested) p.append(li.firstChild);
  if (!p.childNodes.length || (!p.textContent && !p.querySelector('br,img'))) p.replaceChildren(document.createElement('br'));
  list.after(p);
  let cursor = p;
  if (nested) {
    // Children were one level below the item; at the top they are a list
    // of their own after the paragraph.
    const lifted = document.createElement(list.tagName.toLowerCase());
    if (list.classList.contains('todo')) lifted.className = 'todo';
    while (nested.firstChild) lifted.append(nested.firstChild);
    cursor.after(lifted);
    cursor = lifted;
  }
  if (after.length) {
    const rest = list.cloneNode(false);
    rest.append(...after);
    cursor.after(rest);
  }
  li.remove();
  if (!list.children.length) list.remove();
  if (!quiet) caretToStart(p);
}

/* An item out of its list as a paragraph at the root, splitting the list
 * around it. Used when an empty item is retyped as another kind of list. */
function liftOut(li) {
  const list = li.parentElement;
  const p = document.createElement('p');
  const nested = [...li.children].find(isList);
  while (li.firstChild && li.firstChild !== nested) p.append(li.firstChild);
  if (!p.childNodes.length) p.append(document.createElement('br'));
  const after = [];
  let n = li.nextSibling;
  while (n) { after.push(n); n = n.nextSibling; }
  const top = topOfList(list);
  top.after(p);
  if (after.length) { const rest = list.cloneNode(false); rest.append(...after); p.after(rest); }
  if (nested) p.after(nested);
  li.remove();
  if (!list.children.length) list.remove();
  return p;
}

function topOfList(list) {
  let t = list;
  while (t.parentElement && t.parentElement.tagName === 'LI') t = t.parentElement.parentElement;
  return t;
}

/* A paragraph becomes an item of the list before it, or of a new list. */
function listify(block, kind) {
  const li = document.createElement('li');
  moveChildren(block, li);
  if (kind === 'todo' && block.dataset.checked) li.setAttribute('data-checked', '1');
  const prev = block.previousElementSibling;
  const tag = kind === 'ol' ? 'OL' : 'UL';
  const cls = kind === 'todo' ? 'todo' : '';
  if (prev && prev.tagName === tag && prev.className === cls) {
    prev.append(li);
    block.remove();
  } else {
    const list = document.createElement(tag.toLowerCase());
    if (cls) list.className = cls;
    list.append(li);
    block.replaceWith(list);
    // ...and join the list after, if it is the same kind.
    const next = list.nextElementSibling;
    if (next && next.tagName === tag && next.className === cls) { moveChildren(next, list); next.remove(); }
  }
  return li;
}

/* ---- markdown triggers ----------------------------------------------------- */

const TRIGGERS = [
  [/^[-*+]$/, (b, blk) => listify(blk, 'ul')],
  [/^1[.)]$/, (b, blk) => listify(blk, 'ol')],
  [/^\[( |x|X)?\]$/, (b, blk, m) => { const li = listify(blk, 'todo'); if (/x/i.test(m[1] || '')) li.setAttribute('data-checked', '1'); return li; }],
  [/^#{1,3}$/, (b, blk) => setBlockTag(blk, 'h3')],
  [/^>$/, (b, blk) => setBlockTag(blk, 'blockquote')],
  [/^---$/, (b, blk) => { const hr = document.createElement('hr'); blk.before(hr); return blk; }],
];

/* Decided at beforeinput: is the line so far exactly a marker? */
function detectTrigger(body) {
  const range = liveRange(body);
  if (!range || !range.collapsed) return null;
  const block = blockOf(body, range.startContainer);
  if (!block || (block.tagName !== 'P' && !(block.tagName === 'LI' && ownIsEmptyExcept(block)))) return null;
  const before = textBeforeCaret(block, range);
  for (const [re, run] of TRIGGERS) {
    const m = re.exec(before);
    if (!m) continue;
    if (block.tagName === 'LI' && !/^[-*+]$|^1[.)]$|^\[/.test(before)) return null;
    return { block, marker: before, m, run };
  }
  return null;
}

/* Applied at input, once the space is in the text. */
function applyTrigger(body, t) {
  const range = liveRange(body);
  if (!range || !range.collapsed || !t.block.isConnected) return;
  const block = blockOf(body, range.startContainer);
  if (block !== t.block) return;
  const before = textBeforeCaret(block, range);
  if (t.fence) {
    if (before !== '```') return;
    transact(body, () => {
      deleteBeforeCaret(range, 3);
      const pre = setBlockTag(block, 'pre');
      caretToStart(pre || body);
    });
    return;
  }
  if (before.replace(/[\s\u00a0]+$/, '') !== t.marker) return;
  const { m, run } = t;
  if (block.tagName === 'LI') {
    // "1. " inside an empty bullet switches the item's list kind.
    const list = block.parentElement;
    const want = /^\[/.test(t.marker) ? 'todo' : /^1/.test(t.marker) ? 'ol' : 'ul';
    const have = list.classList.contains('todo') ? 'todo' : list.tagName === 'OL' ? 'ol' : 'ul';
    if (want === have) return;
    transact(body, () => {
      deleteBeforeCaret(range, before.length);
      const p = liftOut(block);
      const li = listify(p, want);
      if (/x/i.test(m[1] || '')) li.setAttribute('data-checked', '1');
      caretToStart(li);
    });
    return;
  }
  transact(body, () => {
    deleteBeforeCaret(range, before.length);
    const target = run(body, block, m);
    if (target && !target.textContent && !target.querySelector('br,img')) target.append(document.createElement('br'));
    caretToStart(target || block);
  });
}

function ownIsEmptyExcept(li) {
  // An item whose own text is just a marker being typed.
  return !li.querySelector('img,[contenteditable="false"]');
}

/* ``` on its own line makes a code block. Decided on the third backtick,
 * applied once it has landed. */
function detectFence(body) {
  const range = liveRange(body);
  if (!range || !range.collapsed) return null;
  const block = blockOf(body, range.startContainer);
  if (!block || block.tagName !== 'P') return null;
  if (textBeforeCaret(block, range) !== '``') return null;
  return { block, marker: '```', fence: true };
}

/* ---- block kinds ------------------------------------------------------------ */

function setBlockTag(block, tag) {
  if (block.tagName === 'LI') {
    outdentItemToTop(block);
    return null;
  }
  if (block.tagName.toLowerCase() === tag) return block;
  const out = document.createElement(tag);
  if (tag === 'pre') {
    out.textContent = block.textContent;
    if (!out.textContent) out.append(document.createElement('br'));
  } else {
    moveChildren(block, out);
    if (tag !== 'p' && tag !== 'blockquote') out.removeAttribute('class');
  }
  block.replaceWith(out);
  return out;
}

function outdentItemToTop(li) {
  let guard = 12;
  while (li.isConnected && li.tagName === 'LI' && guard--) outdentItem(li);
}

export function setBlock(body, tag) {
  const range = liveRange(body);
  if (!range) return;
  const blocks = blocksIn(body, range).filter((b) => b.tagName !== 'HR');
  if (!blocks.length) return;
  transact(body, () => keepSelection(() => { for (const b of blocks) setBlockTag(b, tag); }));
}

/* Bullets, numbers, todo: toggle the blocks under the selection. All in the
 * kind already -> back to paragraphs. Otherwise -> that kind. */
export function toggleList(body, kind) {
  const range = liveRange(body);
  if (!range) return;
  const blocks = blocksIn(body, range).filter((b) => b.tagName !== 'HR');
  if (!blocks.length) return;
  const kindOf = (li) => { const l = li.parentElement; return l.classList.contains('todo') ? 'todo' : l.tagName === 'OL' ? 'ol' : 'ul'; };
  const allSame = blocks.every((b) => b.tagName === 'LI' && kindOf(b) === kind);
  transact(body, () => keepSelection(() => {
    if (allSame) {
      const tops = blocks.filter((li) => !blocks.some((o) => o !== li && o.contains(li)));
      for (const li of [...tops].reverse()) outdentItemToTop(li);
    } else {
      for (const b of blocks) {
        if (b.tagName === 'LI') {
          // Change the kind of this item's list in place. Simplest correct
          // thing: retag the whole list the item sits in.
          const list = b.parentElement;
          retagList(list, kind);
        } else {
          listify(b, kind);
        }
      }
    }
  }));
}

function retagList(list, kind) {
  const tag = kind === 'ol' ? 'ol' : 'ul';
  let out = list;
  if (list.tagName.toLowerCase() !== tag) {
    out = document.createElement(tag);
    moveChildren(list, out);
    list.replaceWith(out);
  }
  out.className = kind === 'todo' ? 'todo' : '';
  if (kind !== 'todo') for (const li of out.children) li.removeAttribute('data-checked');
  // Merge with same-kind neighbours so the numbering runs on.
  const prev = out.previousElementSibling;
  if (prev && prev.tagName === out.tagName && prev.className === out.className) { moveChildren(out, prev); out.replaceWith(prev); out = prev; }
  const next = out.nextElementSibling;
  if (next && next.tagName === out.tagName && next.className === out.className) { moveChildren(next, out); next.remove(); }
}

export function align(body, dir) {
  const range = liveRange(body);
  if (!range) return;
  const blocks = blocksIn(body, range).filter((b) => b.tagName === 'P' || b.tagName === 'H3' || b.tagName === 'BLOCKQUOTE');
  if (!blocks.length) { toast('Alignment applies to paragraphs, not list items'); return; }
  transact(body, () => keepSelection(() => {
    for (const b of blocks) {
      b.classList.remove('al-c', 'al-r');
      if (dir === 'center') b.classList.add('al-c');
      if (dir === 'right') b.classList.add('al-r');
      if (!b.classList.length) b.removeAttribute('class');
    }
  }));
}

export function insertDivider(body) {
  const range = liveRange(body);
  if (!range) return;
  const block = blockOf(body, range.startContainer);
  if (!block) return;
  transact(body, () => {
    const hr = document.createElement('hr');
    const top = topBlockOf(body, block);
    if (ownIsEmpty(block) && block.tagName === 'P') { block.before(hr); caretToStart(block); }
    else {
      const p = document.createElement('p');
      p.append(document.createElement('br'));
      top.after(hr);
      hr.after(p);
      caretToStart(p);
    }
  });
}

function topBlockOf(body, block) {
  let b = block;
  while (b.parentElement && b.parentElement !== body) b = b.parentElement;
  return b;
}

/* ---- inline formatting ------------------------------------------------------ */

export function format(cmd) {
  const h = here();
  if (!h) return;
  const { body, range } = h;
  if (cmd === 'code') { toggleCode(body, range); return; }
  transact(body, () => {
    document.execCommand(cmd, false, null);
  });
  ctx.toolbarState();
}

function toggleCode(body, range) {
  const inCode = closest(range.startContainer, 'code');
  transact(body, () => {
    if (inCode) {
      const saved = serializeSelection(body);
      inCode.replaceWith(...inCode.childNodes);
      body.normalize();
      restoreSelection(body, saved);
      return;
    }
    if (range.collapsed) {
      // Start a code run the caret types into.
      const code = document.createElement('code');
      code.textContent = '​';
      range.insertNode(code);
      collapseAt(code.firstChild, 1);
      return;
    }
    const text = range.toString();
    range.deleteContents();
    const code = document.createElement('code');
    code.textContent = text;
    range.insertNode(code);
    const r = document.createRange();
    r.selectNodeContents(code);
    setRange(r);
  });
}

/* What the toolbar should show as active. */
export function stateAt() {
  const h = here();
  if (!h) return null;
  const { body, range } = h;
  const block = blockOf(body, range.startContainer);
  const q = (c) => { try { return document.queryCommandState(c); } catch { return false; } };
  const list = block && block.tagName === 'LI' ? block.parentElement : null;
  return {
    bold: q('bold'), italic: q('italic'), underline: q('underline'), strike: q('strikeThrough'),
    code: !!closest(range.startContainer, 'code'),
    align: block ? (block.classList.contains('al-c') ? 'center' : block.classList.contains('al-r') ? 'right' : 'left') : 'left',
    list: list ? (list.classList.contains('todo') ? 'todo' : list.tagName === 'OL' ? 'ol' : 'ul') : null,
    block: block ? block.tagName.toLowerCase() : null,
  };
}

/* ---- todo ------------------------------------------------------------------- */

function toggleTodoAtCaret(body) {
  const range = liveRange(body);
  if (!range) return false;
  const li = closest(range.startContainer, 'li');
  if (!li || !li.parentElement.classList.contains('todo')) return false;
  transact(body, () => toggleChecked(li));
  return true;
}

function toggleChecked(li) {
  if (li.getAttribute('data-checked')) li.removeAttribute('data-checked');
  else li.setAttribute('data-checked', '1');
}

function onClick(e) {
  const body = bodyFrom(e.target);
  if (!body) return;
  // The checkbox is drawn in the list's padding, so the click lands on the
  // <ul>; find the item whose line the pointer is on.
  const list = e.target.closest('ul.todo');
  if (list && list.contains(e.target) && bodyFrom(list) === body) {
    const li = itemAtY(list, e.clientY, e.clientX);
    if (li) {
      const r = li.getBoundingClientRect();
      if (e.clientX < r.left && e.clientX > r.left - 28) {
        e.preventDefault();
        transact(body, () => toggleChecked(li));
        return;
      }
    }
  }
  const chip = e.target.closest('.chip');
  if (chip) { e.preventDefault(); ctx.chips.activate(chip, body, e); return; }
  const img = e.target.closest('img.nt-img');
  if (img) { e.preventDefault(); ctx.chips.selectImage(img, body); return; }
}

function itemAtY(list, y, x) {
  for (const li of list.children) {
    const r = li.getBoundingClientRect();
    if (y >= r.top && y <= r.bottom && x < r.left) {
      // The line of the item's own text, not of a nested list under it.
      const own = document.createRange();
      own.setStart(li, 0);
      const nested = [...li.children].find(isList);
      own.setEnd(li, nested ? Array.prototype.indexOf.call(li.childNodes, nested) : li.childNodes.length);
      const rects = own.getClientRects();
      const first = rects[0] || r;
      if (y <= first.bottom + 2 || !nested) return li;
      const deeper = itemAtY(nested, y, x);
      return deeper || null;
    }
  }
  return null;
}

/* ---- paste and drop ---------------------------------------------------------- */

function onPaste(e) {
  const body = bodyFrom(e.target);
  if (!body) return;
  const data = e.clipboardData;
  if (!data) return;
  e.preventDefault();

  // Images first: a screenshot on the clipboard also carries an HTML
  // fragment on some platforms.
  const imageFile = [...(data.items || [])].map((i) => (i.kind === 'file' ? i.getAsFile() : null)).find((f) => f && f.type.startsWith('image/'));
  if (imageFile) { ctx.chips.insertImageFile(body, imageFile); return; }

  const text = data.getData('text/plain') || '';
  const html = data.getData('text/html') || '';

  // A bare URL becomes a link chip.
  if (!html && /^\s*(https?:\/\/|www\.)\S+\s*$/i.test(text) && !text.trim().includes('\n')) {
    ctx.chips.insertLink(body, text.trim());
    return;
  }

  transact(body, () => {
    const range = liveRange(body);
    if (!range) return;
    range.deleteContents();
    let frag;
    if (html && !/^\s*$/.test(html)) {
      // Straight into clean(), which parses in an inert document: a style
      // attribute in the paste never applies, so it never trips the CSP.
      frag = fragmentFromClean(clean(html));
    } else {
      frag = fragmentFromText(text);
    }
    insertFragment(body, range, frag);
  });
  ctx.chips.hydrate(body);
  ctx.spell.rescan(body);
}

function onDrop(e) {
  const body = bodyFrom(e.target);
  if (!body) return;
  const files = [...((e.dataTransfer && e.dataTransfer.files) || [])].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;   // text drops stay native
  e.preventDefault();
  const at = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
  if (at && body.contains(at.startContainer)) setRange(at);
  body.focus({ preventScroll: true });
  for (const f of files) ctx.chips.insertImageFile(body, f);
}

/* Plain text with markdown-ish lines becomes real structure: "- a" is a
 * bullet, "1. a" a number, "[ ] a" a todo, blank lines separate paragraphs. */
export function fragmentFromText(text) {
  const holder = document.createElement('div');
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let list = null;
  let stack = [];   // [{list, indent}]
  const closeLists = () => { list = null; stack = []; };
  for (const raw of lines) {
    const m = /^(\s*)([-*+]|\d+[.)]|\[( |x|X)?\])\s+(.*)$/.exec(raw);
    if (m) {
      const indent = m[1].replace(/\t/g, '  ').length;
      const kind = /^\[/.test(m[2]) ? 'todo' : /^\d/.test(m[2]) ? 'ol' : 'ul';
      while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();
      let target;
      const top = stack[stack.length - 1];
      const kindOfList = (l) => (l.classList.contains('todo') ? 'todo' : l.tagName === 'OL' ? 'ol' : 'ul');
      if (top && top.indent === indent && kindOfList(top.list) !== kind) {
        // Same depth, different kind: a new list beside the old one.
        stack.pop();
        const l = document.createElement(kind === 'ol' ? 'ol' : 'ul');
        if (kind === 'todo') l.className = 'todo';
        if (stack.length) { const parentLi = stack[stack.length - 1].list.lastElementChild; if (parentLi) parentLi.append(l); else holder.append(l); } else holder.append(l);
        stack.push({ list: l, indent });
      }
      if (!stack.length || stack[stack.length - 1].indent < indent) {
        const l = document.createElement(kind === 'ol' ? 'ol' : 'ul');
        if (kind === 'todo') l.className = 'todo';
        if (stack.length) {
          const parentLi = stack[stack.length - 1].list.lastElementChild;
          if (parentLi) parentLi.append(l); else holder.append(l);
        } else holder.append(l);
        stack.push({ list: l, indent });
        target = l;
      } else {
        target = stack[stack.length - 1].list;
      }
      const li = document.createElement('li');
      li.textContent = m[4];
      if (kind === 'todo' && /x/i.test(m[3] || '')) li.setAttribute('data-checked', '1');
      target.append(li);
      list = target;
      continue;
    }
    closeLists();
    const p = document.createElement('p');
    if (!raw.trim()) { p.append(document.createElement('br')); }
    else p.textContent = raw;
    holder.append(p);
  }
  // Drop trailing empty paragraphs from a text that ended in newlines.
  while (holder.lastChild && holder.lastChild.tagName === 'P' && !holder.lastChild.textContent) holder.lastChild.remove();
  return fragmentFromClean(clean(holder.innerHTML));
}

function fragmentFromClean(html) {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const frag = document.createDocumentFragment();
  while (holder.firstChild) frag.append(holder.firstChild);
  return frag;
}

/* Insert block content at a caret inside a block: the first block's inline
 * content joins the caret's line, the remaining blocks go after it, and the
 * caret's tail goes on the end. A single paragraph pasted mid-line is just
 * text in the line. */
function insertFragment(body, range, frag) {
  const blocks = [...frag.childNodes].filter(isEl);
  if (!blocks.length) return;
  const block = blockOf(body, range.startContainer);
  if (!block) { body.append(frag); caretToEnd(body); return; }

  const first = blocks[0];
  const rest = blocks.slice(1);
  if (first.tagName === 'P' && !first.classList.length) {
    // Inline content joins the line at the caret.
    const tail = splitBlock(block, range, block.tagName);
    if (block.tagName === 'LI') tail.removeAttribute('data-checked');
    dropTrailingBr(block);
    const nodes = [...first.childNodes];
    // Trailing <br> of the pasted paragraph is a line box, not content.
    if (nodes.length && isEl(nodes[nodes.length - 1]) && nodes[nodes.length - 1].tagName === 'BR') nodes.pop();
    block.append(...nodes);
    first.remove();
    let last = block;
    if (rest.length) {
      const top = topBlockOf(body, block);
      if (block.tagName === 'LI' && rest.every((b) => isList(b))) {
        // Lists pasted into a list: their items join in place.
        let after = block;
        for (const l of rest) { for (const li of [...l.children]) { after.after(li); after = li; } }
        last = after;
      } else {
        let after = top;
        for (const b of rest) { after.after(b); after = b; }
        last = after;
      }
    }
    // The tail: merge back onto the last inserted block if it is inline.
    const tailEmpty = !tail.textContent && !tail.querySelector('img,[contenteditable="false"]');
    if (tailEmpty) {
      tail.remove();
      caretToEnd(last);
    } else if (last === block) {
      const at = endOf(block);
      moveChildren(tail, block);
      tail.remove();
      collapseAt(at.node, at.offset);
    } else {
      last.after(tail);
      caretToStart(tail);
    }
    return;
  }
  // Block content: goes after the caret's block, as blocks.
  const top = topBlockOf(body, block);
  let after = top;
  if (ownIsEmpty(block) && block.tagName === 'P') { after = top.previousSibling; top.remove(); }
  let lastBlock = null;
  for (const b of blocks) {
    if (after) after.after(b); else body.prepend(b);
    after = b;
    lastBlock = b;
  }
  caretToEnd(lastBlock);
}

/* ---- copy --------------------------------------------------------------------- */

/* Copies carry a plain-text version that reads like the notes: bullets as
 * dashes, todos as [ ] and [x]. The HTML flavour is the selection as is. */
function onCopy(e) {
  const body = bodyFrom(e.target);
  if (!body) return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !e.clipboardData) return;
  const range = sel.getRangeAt(0);
  const holder = document.createElement('div');
  holder.append(range.cloneContents());
  e.preventDefault();
  e.clipboardData.setData('text/html', serialize(holder));
  e.clipboardData.setData('text/plain', ctx.toText(holder.innerHTML));
  if (e.type === 'cut') {
    transact(body, () => { range.deleteContents(); });
  }
}

/* ---- inserting things at the caret (used by chips, emoji, slash) -------------- */

export function insertInline(body, node, opts = {}) {
  const range = liveRange(body);
  if (!range) return;
  transact(body, () => {
    range.deleteContents();
    range.insertNode(node);
    if (opts.spaceAfter) {
      // No-break: a plain space at the end of a block collapses, and Chrome
      // drops a collapsed space when the next character is typed. This is
      // the space Chrome itself would insert there; it rebalances it to an
      // ordinary space once a letter follows.
      const space = document.createTextNode('\u00a0');
      node.after(space);
      collapseAt(space, 1);
    } else {
      const r = document.createRange();
      r.setStartAfter(node);
      r.collapse(true);
      setRange(r);
    }
  });
}

export function insertBlockAfterCaret(body, node) {
  const range = liveRange(body);
  if (!range) return;
  const block = blockOf(body, range.startContainer);
  transact(body, () => {
    const p = document.createElement('p');
    p.append(document.createElement('br'));
    if (!block) {
      // The caret was on the body itself rather than in a block, which is
      // where it sits after a programmatic selectNodeContents. The trailing
      // line still has to be made: normalizeRoot puts one after a table at
      // the end of a body, but not until the next scrub, and until then the
      // block has nothing under it to click on.
      body.append(node, p);
      caretToStart(p);
      return;
    }
    const top = topBlockOf(body, block);
    if (ownIsEmpty(block) && block.tagName === 'P') top.replaceWith(node);
    else top.after(node);
    node.after(p);
    caretToStart(p);
  });
}

export { rectOfCaret, elOf, liveRange };
