/* DOM and selection helpers shared by every module in the notes app.
 *
 * Nothing in here knows about categories, sessions or saving. It is the layer
 * under the editor: where the caret is, how to say that as data that survives
 * a re-render, and how to put it back.
 */

export const BLOCKS = new Set(['P', 'H3', 'UL', 'OL', 'LI', 'PRE', 'BLOCKQUOTE', 'HR']);
export const LISTS = new Set(['UL', 'OL']);

export const isEl = (n) => !!n && n.nodeType === 1;
export const isText = (n) => !!n && n.nodeType === 3;
export const isList = (n) => isEl(n) && LISTS.has(n.tagName);
export const isBlock = (n) => isEl(n) && BLOCKS.has(n.tagName);

export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      /* A CUSTOM PROPERTY NEEDS setProperty. Object.assign onto a
         CSSStyleDeclaration silently drops any key starting `--` -- it is not
         a member of the object -- so `style: { '--node': ... }` set nothing at
         all. That is why the node drag ghost came out white: its whole paint
         hangs off --node, and --node was never there. */
      else if (k === 'style') { for (const [prop, val] of Object.entries(v)) { if (prop.startsWith('--')) node.style.setProperty(prop, val); else node.style[prop] = val; } }
      else node.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/* The element for a node: itself, or its parent for a text node. */
export const elOf = (n) => (isEl(n) ? n : n && n.parentElement);

export const closest = (n, sel) => { const e = elOf(n); return e ? e.closest(sel) : null; };

/* ---- the live selection ------------------------------------------------- */

export function selection() {
  const sel = window.getSelection();
  return sel && sel.rangeCount ? sel : null;
}

export function liveRange(root) {
  const sel = selection();
  if (!sel) return null;
  const range = sel.getRangeAt(0);
  if (root && !root.contains(range.commonAncestorContainer)) return null;
  return range;
}

export function setRange(range) {
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

export function collapseAt(node, offset) {
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  setRange(r);
  return r;
}

/* The deepest last text position inside a node, for "caret at the end". */
export function endOf(node) {
  let n = node;
  while (n && n.lastChild) {
    const last = n.lastChild;
    // A trailing <br> is the line's own terminator; the caret goes before it.
    if (isEl(last) && last.tagName === 'BR') return { node: n, offset: n.childNodes.length - 1 };
    if (isEl(last) && last.contentEditable === 'false') return { node: n, offset: n.childNodes.length };
    n = last;
  }
  return isText(n) ? { node: n, offset: n.nodeValue.length } : { node: n, offset: n.childNodes ? n.childNodes.length : 0 };
}

export function startOf(node) {
  let n = node;
  while (n && n.firstChild) {
    const first = n.firstChild;
    if (isEl(first) && first.contentEditable === 'false') return { node: n, offset: 0 };
    n = first;
  }
  return { node: n, offset: 0 };
}

export function caretToEnd(node) { const p = endOf(node); return collapseAt(p.node, p.offset); }
export function caretToStart(node) { const p = startOf(node); return collapseAt(p.node, p.offset); }

/* ---- caret as data ------------------------------------------------------- */

/* A position is the list of child indices from `root` down to a node, plus an
 * offset inside it. It survives innerHTML being replaced by an identical
 * string, which is what undo does, and it survives a re-render of everything
 * around the body. It does NOT survive the body's own structure changing --
 * that is what the transaction that changed it records a fresh one for.
 */
export function pathTo(root, node, offset) {
  const path = [];
  let n = node;
  while (n && n !== root) {
    const parent = n.parentNode;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, n));
    n = parent;
  }
  if (n !== root) return null;
  path.push(offset);
  return path;
}

export function nodeAt(root, path) {
  if (!path) return null;
  let n = root;
  for (let i = 0; i < path.length - 1; i++) {
    n = n.childNodes[path[i]];
    if (!n) return null;
  }
  const max = isText(n) ? n.nodeValue.length : n.childNodes.length;
  return { node: n, offset: Math.min(path[path.length - 1], max) };
}

export function serializeSelection(root) {
  const sel = selection();
  if (!sel) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  // anchor/focus rather than start/end so a backwards drag comes back backwards.
  const a = pathTo(root, sel.anchorNode, sel.anchorOffset);
  const f = pathTo(root, sel.focusNode, sel.focusOffset);
  if (!a || !f) return null;
  return { anchor: a, focus: f };
}

export function restoreSelection(root, saved) {
  if (!saved) return false;
  const a = nodeAt(root, saved.anchor);
  const f = nodeAt(root, saved.focus);
  if (!a || !f) return false;
  const sel = window.getSelection();
  if (!sel) return false;
  try {
    if (sel.setBaseAndExtent) sel.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
    else { const r = document.createRange(); r.setStart(a.node, a.offset); r.setEnd(f.node, f.offset); setRange(r); }
    return true;
  } catch {
    return false;
  }
}

/* ---- blocks ------------------------------------------------------------- */

/* The nearest block that holds `node`, stopping at `root`. For text inside
 * an <li> that is the <li>; inside a <p> the <p>. Returns null for a node
 * sitting directly in the root (which the schema never allows to persist). */
export function blockOf(root, node) {
  let n = elOf(node);
  while (n && n !== root) {
    if (isBlock(n) && !isList(n)) return n;
    n = n.parentElement;
  }
  return null;
}

/* Every leaf block (p, li, h3, pre, blockquote, hr) that the range touches,
 * in document order. Lists themselves are not returned, their items are. */
export function blocksIn(root, range) {
  const out = [];
  const first = blockOf(root, range.startContainer);
  const last = blockOf(root, range.endContainer);
  if (!first) return out;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (isBlock(n) && !isList(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  let started = false;
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n === first) started = true;
    if (started) out.push(n);
    if (n === last) break;
  }
  return out;
}

/* Is the caret before every character of this block? Measured by looking at
 * the content between the block's start and the caret, rather than by
 * comparing offsets: offset 0 of the third text node is not the start of the
 * line, and a line beginning with <b> fools any container-only test. */
export function atStartOf(block, range) {
  const probe = document.createRange();
  probe.selectNodeContents(block);
  try { probe.setEnd(range.startContainer, range.startOffset); } catch { return false; }
  const before = probe.cloneContents();
  return before.textContent.length === 0 && !before.querySelector('img,br,[contenteditable="false"]');
}

export function atEndOf(block, range) {
  const probe = document.createRange();
  probe.selectNodeContents(block);
  try { probe.setStart(range.endContainer, range.endOffset); } catch { return false; }
  const after = probe.cloneContents();
  // A single trailing <br> is the block's own terminator, not content.
  const brs = after.querySelectorAll('br');
  const onlyBr = after.childNodes.length === 1 && brs.length === 1;
  return (after.textContent.length === 0 && !after.querySelector('img,[contenteditable="false"]') && (brs.length === 0 || onlyBr));
}

/* The text of a block's OWN line -- for an <li>, everything before its
 * nested list. */
export function ownText(block) {
  let s = '';
  for (const c of block.childNodes) {
    if (isList(c)) break;
    s += c.textContent;
  }
  return s;
}

export function ownIsEmpty(block) {
  for (const c of block.childNodes) {
    if (isList(c)) break;
    if (isText(c) && c.nodeValue.replace(/​/g, '').length) return false;
    if (isEl(c) && c.tagName !== 'BR' && (c.textContent.replace(/​/g, '').length || c.querySelector('img,[contenteditable="false"]') || c.contentEditable === 'false')) return false;
  }
  return true;
}

/* The text from the start of the block's own line up to the caret. */
export function textBeforeCaret(block, range) {
  const probe = document.createRange();
  probe.selectNodeContents(block);
  try { probe.setEnd(range.startContainer, range.startOffset); } catch { return ''; }
  const frag = probe.cloneContents();
  frag.querySelectorAll('ul,ol').forEach((l) => l.remove());
  return frag.textContent;
}

/* Delete the last `count` characters before a collapsed caret, walking back
 * across text nodes but never across an element boundary that is not text. */
export function deleteBeforeCaret(range, count) {
  let node = range.startContainer;
  let offset = range.startOffset;
  if (!isText(node)) {
    const prev = node.childNodes[offset - 1];
    if (!isText(prev)) return false;
    node = prev; offset = prev.nodeValue.length;
  }
  let left = count;
  while (left > 0) {
    const take = Math.min(left, offset);
    node.nodeValue = node.nodeValue.slice(0, offset - take) + node.nodeValue.slice(offset);
    offset -= take;
    left -= take;
    if (left > 0) {
      let prev = node.previousSibling;
      while (prev && isText(prev) && !prev.nodeValue.length) prev = prev.previousSibling;
      if (!isText(prev)) return false;
      node = prev; offset = prev.nodeValue.length;
    }
  }
  collapseAt(node, offset);
  return true;
}

/* Split a block at the caret: everything after the caret moves into a new
 * element of `tag` placed after `block`. Returns the new element. Nested
 * lists inside an <li> travel with the tail, so a new item made in the
 * middle of a parent keeps the children under the line that follows. */
export function splitBlock(block, range, tag) {
  const after = document.createRange();
  after.setStart(range.endContainer, range.endOffset);
  after.setEnd(block, block.childNodes.length);
  const tail = after.extractContents();
  const next = document.createElement(tag || block.tagName);
  next.append(tail);
  // A block that lost everything needs a <br> to keep its line box.
  if (!block.childNodes.length || (block.childNodes.length && !block.textContent && !block.querySelector('br,img'))) {
    block.append(document.createElement('br'));
  }
  if (!next.childNodes.length || (!next.textContent && !next.querySelector('br,img,ul,ol'))) {
    next.replaceChildren(document.createElement('br'));
  }
  block.after(next);
  return next;
}

/* Move every child node of `from` to the end of `into`. */
export function moveChildren(from, into) {
  while (from.firstChild) into.append(from.firstChild);
}

/* Strip a single trailing <br> that would otherwise render as a blank line
 * once other content follows it. */
export function dropTrailingBr(block) {
  const last = block.lastChild;
  if (isEl(last) && last.tagName === 'BR' && block.childNodes.length > 1) last.remove();
}

/* Run `fn` and put the selection back on the same text nodes afterwards.
 * Structural edits (indent, outdent, list conversion) MOVE nodes and never
 * recreate them, so the nodes the selection sits on are still the right
 * ones when they are done. */
export function keepSelection(fn) {
  const sel = window.getSelection();
  const keep = sel && sel.rangeCount ? { a: sel.anchorNode, ao: sel.anchorOffset, f: sel.focusNode, fo: sel.focusOffset } : null;
  const r = fn();
  if (keep && keep.a && keep.f && keep.a.isConnected && keep.f.isConnected) {
    try { sel.setBaseAndExtent(keep.a, Math.min(keep.ao, lengthOf(keep.a)), keep.f, Math.min(keep.fo, lengthOf(keep.f))); return r; } catch { /* fall through */ }
  }
  return r;
}
const lengthOf = (n) => (isText(n) ? n.nodeValue.length : n.childNodes.length);

export function rectOfCaret() {
  const r = liveRange();
  if (!r) return null;
  const rects = r.getClientRects();
  if (rects.length) return rects[rects.length - 1];
  const node = elOf(r.startContainer);
  return node ? node.getBoundingClientRect() : null;
}

export const debounce = (fn, ms) => {
  let t = 0;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = 0; fn(...a); }, ms); };
  d.cancel = () => { clearTimeout(t); t = 0; };
  d.flush = (...a) => { if (t) { clearTimeout(t); t = 0; fn(...a); } };
  return d;
};

export const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
