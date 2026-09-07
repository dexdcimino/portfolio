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
 *   root      p | h3 | ul | ol | pre | blockquote | hr
 *   ul, ol    li+            ul may carry class "todo"; ol may carry type 1|a|i
 *   li        inline*, then at most one ul|ol at the very end; data-checked
 *   p, h3, blockquote   inline*; class al-c | al-r for alignment
 *   pre       text and br only
 *   inline    text | b | i | u | s | code | a | br | img | span.chip
 *   a         href http(s)/mailto only. class "chip chip-link" for a chip.
 *   img       class nt-img, data-key <sha>.<ext>, data-w 25|50|75|100
 *   span      class "chip chip-md" with data-md; nothing else survives
 *
 * No style attribute anywhere. The site's CSP has no 'unsafe-inline' for
 * styles, so an inline style is not merely untidy -- it is silently ignored
 * when the document is rendered from a string, and would show up as a body
 * that looks different after a reload than it did while typing.
 */

import { isEl, isText, isList } from './dom.js';

const ROOT_BLOCKS = new Set(['P', 'H3', 'UL', 'OL', 'PRE', 'BLOCKQUOTE', 'HR']);
const INLINE = new Set(['B', 'I', 'U', 'S', 'CODE', 'A', 'BR', 'IMG', 'SPAN']);
const ALIAS = { STRONG: 'B', EM: 'I', STRIKE: 'S', DEL: 'S', H1: 'H3', H2: 'H3', H4: 'H3', H5: 'H3', H6: 'H3', DIV: 'P' };
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

    const allowed = ROOT_BLOCKS.has(tag) || tag === 'LI' || INLINE.has(tag);
    if (!allowed) {
      // Unwrap rather than remove: a tag this does not know about is far
      // more likely to be a paste from somewhere than an attack, and deleting
      // the words inside it would lose real notes. Tables become their
      // cells' text, one after another.
      if (tag === 'TR' || tag === 'TABLE' || tag === 'TBODY' || tag === 'THEAD') {
        unwrapAsLines(child);
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
  for (const block of root.querySelectorAll('p,h3,blockquote,li')) {
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
  if (!root.childNodes.length) {
    const p = document.createElement('p');
    p.append(document.createElement('br'));
    root.append(p);
  }
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
  for (const font of root.querySelectorAll('font, span:not(.chip), div, strong, em, strike, del')) {
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
