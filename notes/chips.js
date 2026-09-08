/* The inline nodes: link chips, markdown nodes, and images.
 *
 * A chip is an inline atom -- contenteditable=false -- with ordinary text on
 * either side. The old app bracketed every chip in zero-width spaces and then
 * needed arrow-key hops, delete guards, a mouseup caret fix and a hydration
 * pass to keep them paired. Modern Chrome places the caret beside a
 * non-editable inline on its own; what it cannot do is put a caret after a
 * chip that ends a block, so a chip is always inserted with a real space
 * after it and Backspace directly after a chip removes the chip (editor.js).
 *
 * Images are content-addressed assets on the server (api/notes/asset.js).
 * The body holds <img data-key data-w>; the src is added at render time from
 * the session token, and stripped again by serialize(). While an upload is in
 * flight the image shows a scaled-down data: preview and has no key, so a
 * save in that window simply leaves it out and the next one has it.
 */

import { el, closest, collapseAt, liveRange, setRange } from './dom.js';
import { insertInline, insertBlockAfterCaret, transact, bodyFrom } from './editor.js';
import { renderMarkdown, titleOf } from './md.js';
import { panel, closePanel, menu, toast, confirm, ICON } from './ui.js';
import { NODES, nodeKind, kindOf, paintMark, showToolbar, hideToolbar, beginDrag } from './nodes.js';

let ctx = null;

export function initChips(context) {
  ctx = context;
  ctx.canvas.addEventListener('contextmenu', onContextMenu);
  /* THE CHIP SURFACE IS DELEGATED, all of it. Chips are rebuilt by every
     render, every undo and every paste; a listener per chip would be a
     listener per chip per rebuild, and the ones on chips that had gone would
     be the ones still holding a toolbar open. */
  ctx.canvas.addEventListener('pointerover', (e) => {
    const chip = e.target.closest && e.target.closest('.chip');
    const body = chip && bodyFrom(chip);
    if (chip && body) showToolbar(chip, body);
  });
  ctx.canvas.addEventListener('pointerout', (e) => {
    if (e.target.closest && e.target.closest('.chip')) setTimeout(() => hideToolbar(), 160);
  });
  ctx.canvas.addEventListener('scroll', () => hideToolbar(true), true);
  /* Dragging a chip MOVES it, and Shift leaves a copy behind. The mark at its
     head is not a drag handle -- that is the fold toggle -- so a press there
     is left alone. */
  ctx.canvas.addEventListener('pointerdown', (e) => {
    const chip = e.target.closest && e.target.closest('.chip');
    if (!chip || e.target.closest('.nt-chip-mark')) return;
    const from = bodyFrom(chip);
    if (!from) return;
    beginDrag(e, {
      source: chip,
      ghost: () => chipGhost(chip),
      onDrop: (body, range, copy) => dropChip(chip, from, body, range, copy),
    });
  });
  document.addEventListener('selectionchange', () => {
    // Clicking away from a selected image deselects it.
    if (selected && !selected.isConnected) selected = null;
    if (selected) {
      const r = liveRange(ctx.canvas);
      if (!r || !r.collapsed || !selected.parentNode.contains(r.startContainer)) deselectImage();
    }
  });
}

/* ---- rendering ------------------------------------------------------------ */

/* Give every image in a body its URL, and every chip its label. Runs after any
 * innerHTML assignment: render, undo, paste. */
export function hydrate(body) {
  const token = ctx.token();
  for (const img of body.querySelectorAll('img.nt-img[data-key]')) {
    const local = ctx.demoAssets.get(img.dataset.key);
    const want = local || `/api/notes/asset?key=${encodeURIComponent(img.dataset.key)}&t=${encodeURIComponent(token)}`;
    if (img.getAttribute('src') !== want && !img.src.startsWith('data:')) img.src = want;
    img.setAttribute('draggable', 'false');
    img.style.width = `${img.dataset.w || 50}%`;
  }
  for (const chip of body.querySelectorAll('.chip-md')) {
    if (!chipLabel(chip).trim()) setChipLabel(chip, titleOf(decode(chip.dataset.md)));
    chip.setAttribute('contenteditable', 'false');
    paintMark(chip);
  }
  for (const chip of body.querySelectorAll('a.chip-link')) {
    chip.setAttribute('contenteditable', 'false');
    if (!chipLabel(chip).trim()) setChipLabel(chip, labelFor(chip.getAttribute('href')));
    paintMark(chip);
  }
}

/* A CHIP'S LABEL IS NOT ITS textContent ANY MORE. The mark at its head is an
 * element inside it, so `chip.textContent` reads "Ggoogle.com" -- and writing
 * to it would take the mark out again. Every read and write of a chip's words
 * goes through these two, which touch the text nodes and nothing else. */
export function chipLabel(chip) {
  let out = '';
  for (const n of chip.childNodes) if (n.nodeType === 3) out += n.nodeValue;
  return out;
}
export function setChipLabel(chip, text) {
  for (const n of [...chip.childNodes]) if (n.nodeType === 3) n.remove();
  chip.append(document.createTextNode(text));
}

/* ---- one chip, dragged ---------------------------------------------------- */

function chipGhost(chip) {
  const copy = chip.cloneNode(true);
  copy.removeAttribute('contenteditable');
  copy.removeAttribute('href');
  return copy;
}

/* Moving between two bodies is TWO history entries, one per body, because a
 * text entry is one body's HTML before and after -- that is the shape of the
 * undo stack and it is the right shape for everything else. Undoing a
 * cross-box move therefore takes two presses, which is honest about what
 * happened rather than pretending one body changed. */
function dropChip(chip, from, body, range, copy) {
  const node = copy ? chip.cloneNode(true) : chip;
  // The clone is taken after the drag has flagged its source, so it inherits
  // the flag that suppresses the click that ends a drag -- and the copy's
  // FIRST click would then do nothing.
  if (copy) node.removeAttribute('data-dragged');
  body.focus({ preventScroll: true });
  /* THE DROP POINT IS PINNED BEFORE ANYTHING MOVES. Taking the chip out first
     shifts every offset after it, and the range this was aiming at is one of
     them -- a chip dragged a few words along its own line landed somewhere
     else entirely. An empty text node holds the spot; it serialises to
     nothing and is swapped for the chip a line later.
     insertInline is deliberately NOT used here: it opens a transaction of its
     own, and nesting one inside this one silently dropped the whole insert. */
  const drop = () => {
    const pin = document.createTextNode('');
    range.insertNode(pin);
    if (!copy && from === body) chip.remove();
    const space = document.createTextNode(' ');
    pin.replaceWith(node, space);
    collapseAt(space, 1);
  };
  if (!copy && from !== body) { transact(from, () => chip.remove()); transact(body, drop); }
  else transact(body, drop);
  hydrate(body);
  ctx.changed(body);
  if (from !== body) ctx.changed(from);
}

/* What the toolbar's Edit and Copy do, per kind. Kept here rather than in
 * nodes.js because they are about what a chip IS. */
export function editChip(chip, body) {
  if (kindOf(chip) === 'link') promptLink(body, chip);
  else openMd(chip, body);
}
export function copyChip(chip) {
  const isLink = kindOf(chip) === 'link';
  const text = isLink ? chip.getAttribute('href') : decode(chip.dataset.md);
  navigator.clipboard.writeText(text).then(() => toast(isLink ? 'Link copied' : 'Markdown copied')).catch(() => toast('Could not copy'));
}

/* ---- the nodes menu --------------------------------------------------------
 * The header's node control is a split button: pressing the left half inserts
 * the kind you used last -- and DRAGGING it puts one wherever you let go --
 * while the chevron opens the list. The kind you used last is the one on the
 * button, so the common case is one press and the menu is for changing your
 * mind rather than for every single insert. */
export function lastKind() { return nodeKind(ctx.doc.ui.node || 'link').key; }

export function insertNode(body, key) {
  ctx.doc.ui.node = key;
  ctx.uiChanged();
  if (key === 'link') promptLink(body);
  else if (key === 'md') insertMd(body);
  else pickImage(body);
}

export function nodeMenu(anchor, withBody) {
  const rows = NODES.map((n) => ({
    label: n.label, hint: n.hint, icon: n.icon(), tint: n.color,
    run: () => withBody((b) => insertNode(b, n.key)),
    /* The menu is a place to drag FROM, not only to pick from: the kind you
       want is often not the one on the button, and reaching for it should not
       cost a press to change the button and a second drag to place it. */
    drag: (e, close) => dragNewNode(e, n.key, close),
  }));
  menu(anchor, rows, { align: 'right', title: 'Nodes', tinted: true });
}

/* Dragging the header button makes a node WHERE YOU LET GO: the drop places
 * the caret and then opens that kind's own maker, so a link asks for its
 * address at the point it is going to live rather than at the caret you had
 * before you reached for the button. */
export function dragNewNode(e, key, onStart) {
  const n = nodeKind(key);
  beginDrag(e, {
    onStart,
    /* The ghost wears the kind's own colour -- blue link, green markdown,
       purple image -- so what you are carrying already looks like what it
       will be when you let go. `--node` is what every one of those rules
       reads; see the setProperty note in dom.js for why it used to be white. */
    ghost: () => el('span', { class: `chip chip-ghost chip-${key}`, style: { '--node': n.color } },
      el('span', { class: 'nt-chip-mark', html: n.icon() }), n.label),
    onDrop: (body, range) => {
      body.focus({ preventScroll: true });
      setRange(range);
      insertNode(body, key);
    },
  });
}

/* When the token is renewed, image URLs are rebuilt on the next hydrate;
 * the old ones keep working until the old token expires. */

/* ---- links ---------------------------------------------------------------- */

export const URL_RE = /^(https?:\/\/|www\.)[^\s<>"']+$/i;

/* WHAT COUNTS AS A LINK. `google.com` does, and so does `www.google.com`,
 * `mail@example.com` and anything already carrying a scheme. What does not is
 * a bare word with no dot in it -- `notes` is a thing you typed, not a host --
 * and anything with a space in the middle. Chrome's own url validator refused
 * `google.com` outright, which is the common case and not a mistake. */
const HOSTISH = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?::\d+)?(?:[/?#]\S*)?$/i;
const MAILISH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function looksLikeUrl(u) {
  const s = String(u || '').trim();
  if (!s || /\s/.test(s)) return false;
  if (/^(https?:\/\/|mailto:)/i.test(s)) return s.length > 8 || /^mailto:/i.test(s);
  if (MAILISH.test(s)) return true;
  return HOSTISH.test(s);
}

function normalizeUrl(u) {
  let s = String(u || '').trim();
  if (!s) return '';
  if (/^(https?:\/\/|mailto:)/i.test(s)) return s;
  if (MAILISH.test(s)) return `mailto:${s}`;
  return `https://${s}`;
}

export function labelFor(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname.replace(/\/$/, '');
    const short = path.length > 24 ? `${path.slice(0, 22)}…` : path;
    return host + short;
  } catch {
    return String(url || '').slice(0, 40);
  }
}

function makeLink(url, label) {
  const chip = el('a', {
    class: 'chip chip-link', href: normalizeUrl(url), contenteditable: 'false',
    target: '_blank', rel: 'noopener', text: label || labelFor(normalizeUrl(url)),
  });
  // Marked at BIRTH as well as at hydrate: hydrate runs after an innerHTML
  // assignment, and a chip inserted straight into the document never sees one.
  paintMark(chip);
  return chip;
}

export function insertLink(body, url, label) {
  insertInline(body, makeLink(url, label), { spaceAfter: true });
  ctx.changed(body);
}

/* Typing a URL then a space or Enter turns the URL into a chip. */
export function autoLink(body, paragraph) {
  const range = liveRange(body);
  if (!range || !range.collapsed) return;
  let node = range.startContainer;
  let offset = range.startOffset;
  if (!node || node.nodeType !== 3) {
    if (!paragraph) return;
    // After Enter the caret is in the new block; look at the previous one.
    const block = closest(node, 'p,li,h3,blockquote');
    const prev = block && block.previousSibling;
    if (!prev) return;
    const last = lastTextNode(prev);
    if (!last) return;
    node = last; offset = last.nodeValue.length;
  }
  if (closest(node, 'a,code,pre')) return;
  const text = node.nodeValue.slice(0, offset);
  const m = /(^|\s)((https?:\/\/|www\.)[^\s]+?)([.,;:!?)]*)(\s?)$/.exec(text);
  if (!m) return;
  if (!paragraph && !m[5]) return;          // the space is what completes it
  const url = m[2];
  if (url.length < 8) return;
  const start = m.index + m[1].length;
  const end = start + url.length;
  transact(body, () => {
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, end);
    r.deleteContents();
    const chip = makeLink(url);
    r.insertNode(chip);
    if (paragraph) {
      collapseAt(range.startContainer, range.startOffset);
    } else {
      const after = chip.nextSibling;
      if (after && after.nodeType === 3) collapseAt(after, Math.min(after.nodeValue.length, m[4].length + 1));
      else collapseAt(chip.parentNode, Array.prototype.indexOf.call(chip.parentNode.childNodes, chip) + 1);
    }
  });
}

function lastTextNode(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let last = null;
  while (walker.nextNode()) last = walker.currentNode;
  return last;
}

/* Ctrl+K: a small form for a URL and a label. With a selection, the selected
 * text is the label. */
export function promptLink(body, existing) {
  const range = liveRange(body);
  const selText = range && !range.collapsed ? range.toString().trim() : '';
  /* type=text, NOT type=url. A url-typed input inside a form hands the refusal
     to the browser: Chrome draws an orange-and-white bubble in its own style,
     in its own corner, saying "Please enter a URL" about `google.com` -- which
     is a link, and the most common way anyone types one. The form validates
     itself now and says so on its own line, in this app's voice. */
  const url = el('input', { type: 'text', class: 'nt-input', placeholder: 'google.com', autocomplete: 'off',
    value: existing ? existing.getAttribute('href') : '', spellcheck: 'false' });
  const label = el('input', { type: 'text', class: 'nt-input', placeholder: 'Label (optional)', value: existing ? chipLabel(existing) : selText });
  const err = el('p', { class: 'nt-form-err' }, el('span', { html: ICON.warn }), el('span', { text: '' }));
  const complain = (why) => {
    err.lastChild.textContent = why;
    err.classList.add('is-on');
    url.classList.add('is-bad');
    url.focus();
    url.select();
  };
  url.addEventListener('input', () => { err.classList.remove('is-on'); url.classList.remove('is-bad'); });
  const saved = range ? range.cloneRange() : null;
  const submit = () => {
    if (!url.value.trim()) { complain('Type an address, like google.com'); return; }
    if (!looksLikeUrl(url.value)) { complain(`"${url.value.trim().slice(0, 30)}" is not an address`); return; }
    const u = normalizeUrl(url.value);
    closePanel();
    body.focus({ preventScroll: true });
    if (existing) {
      transact(body, () => { existing.setAttribute('href', u); setChipLabel(existing, label.value.trim() || labelFor(u)); paintMark(existing); });
      return;
    }
    if (saved) setRange(saved);
    insertLink(body, u, label.value.trim());
  };
  const form = el('form', { class: 'nt-form', novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(); } },
    el('div', { class: 'nt-form-title', text: existing ? 'Edit link' : 'Insert link' }),
    url, label, err,
    el('div', { class: 'nt-form-btns' },
      el('button', { type: 'button', class: 'nt-btn', text: 'Cancel', onclick: () => { closePanel(); body.focus({ preventScroll: true }); } }),
      el('button', { type: 'submit', class: 'nt-btn is-primary', text: existing ? 'Save' : 'Insert' })));
  const anchor = existing || caretAnchor(body);
  panel({ className: 'nt-form-panel', content: form, anchor, keepFocus: false });
  setTimeout(() => url.focus(), 0);
}

function caretAnchor(body) {
  const r = liveRange(body);
  if (r) { const rects = r.getClientRects(); if (rects.length) return rects[rects.length - 1]; }
  return body.getBoundingClientRect();
}

/* ---- markdown nodes -------------------------------------------------------- */

const encode = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const decode = (b) => { try { return new TextDecoder().decode(Uint8Array.from(atob(b || ''), (c) => c.charCodeAt(0))); } catch { return ''; } };

function makeMd(text) {
  const chip = el('span', { class: 'chip chip-md', 'data-md': encode(text), contenteditable: 'false', text: titleOf(text) });
  paintMark(chip);
  return chip;
}

export function insertMd(body) {
  const chip = makeMd('');
  insertInline(body, chip, { spaceAfter: true });
  ctx.changed(body);
  openMd(chip, body);
}

/* The editor for a node: a textarea and a live preview, side by side when
 * there is room. Saved on close and on Ctrl+Enter; Escape closes and saves
 * too -- a node whose edits vanish because you pressed the wrong key is
 * worse than one you have to delete. */
export function openMd(chip, body) {
  const original = decode(chip.dataset.md);
  const area = el('textarea', { class: 'nt-md-text', spellcheck: 'true', placeholder: '# Title\n\nWrite markdown here…' });
  area.value = original;
  const preview = el('div', { class: 'nt-md-preview nt-md' });
  const render = () => { preview.innerHTML = renderMarkdown(area.value) || '<p class="nt-md-empty">Nothing to preview</p>'; };
  render();
  area.addEventListener('input', render);
  const save = () => {
    const text = area.value;
    if (text === original) return;
    transact(body, () => { chip.dataset.md = encode(text); setChipLabel(chip, titleOf(text)); paintMark(chip); });
  };
  const copy = () => navigator.clipboard.writeText(area.value).then(() => toast('Markdown copied')).catch(() => toast('Could not copy'));
  let mode = 'split';
  const wrap = el('div', { class: 'nt-md-editor is-split' });
  const setMode = (m) => { mode = m; wrap.className = `nt-md-editor is-${m}`; if (m !== 'edit') render(); };
  const head = el('div', { class: 'nt-md-head' },
    el('span', { class: 'nt-md-title', text: 'Markdown node' }),
    el('div', { class: 'nt-md-modes' },
      el('button', { type: 'button', class: 'nt-btn is-small', text: 'Edit', onclick: () => setMode('edit') }),
      el('button', { type: 'button', class: 'nt-btn is-small', text: 'Split', onclick: () => setMode('split') }),
      el('button', { type: 'button', class: 'nt-btn is-small', text: 'Preview', onclick: () => setMode('preview') })),
    el('button', { type: 'button', class: 'nt-icon-btn', 'data-tip': 'Copy markdown', html: ICON.copy, onclick: copy }),
    el('button', { type: 'button', class: 'nt-icon-btn', 'data-tip': 'Done', html: ICON.check, onclick: () => closePanel() }));
  wrap.append(head, el('div', { class: 'nt-md-panes' }, area, preview));
  panel({
    className: 'nt-md-panel', content: wrap, anchor: chip, align: 'left', onClose: save,
    onKey: (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); closePanel(); } },
  });
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = area.selectionStart; const t = area.selectionEnd;
      area.setRangeText(e.shiftKey ? '' : '  ', s, t, 'end');
      render();
    }
  });
  setTimeout(() => { area.focus(); area.setSelectionRange(area.value.length, area.value.length); }, 0);
}

/* ---- images ------------------------------------------------------------------ */

const MAX_EDGE = 1600;

async function shrink(file) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const keepPng = file.type === 'image/png' && file.size < 400 * 1024 && scale === 1;
  const type = file.type === 'image/gif' ? null : keepPng ? 'image/png' : 'image/webp';
  if (!type) return { blob: file, type: file.type };   // a gif keeps its frames
  const blob = await new Promise((r) => canvas.toBlob(r, type, 0.86));
  return { blob, type };
}

export async function insertImageFile(body, file) {
  if (!file || !file.type.startsWith('image/')) return;
  const shrunk = await shrink(file);
  if (!shrunk) { toast('That image could not be read', 'error'); return; }
  const dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(shrunk.blob); });
  const img = el('img', { class: 'nt-img is-pending', 'data-w': '50', alt: '', draggable: 'false' });
  img.src = dataUrl;
  img.style.width = '50%';
  const p = el('p', {}, img);
  body.focus({ preventScroll: true });
  insertBlockAfterCaret(body, p);
  const catId = body.dataset.cat;
  try {
    const key = await ctx.api.uploadAsset(shrunk.blob, shrunk.type);
    // The body may have been re-rendered while the upload ran; find the
    // pending image again by its preview.
    const live = ctx.bodyFor(catId);
    const target = live && [...live.querySelectorAll('img.is-pending')].find((i) => i.src === dataUrl);
    if (!target) return;
    target.dataset.key = key;
    target.classList.remove('is-pending');
    target.src = ctx.demoAssets.get(key) || `/api/notes/asset?key=${encodeURIComponent(key)}&t=${encodeURIComponent(ctx.token())}`;
    ctx.changed(live);
    ctx.history.seal();
  } catch (err) {
    console.warn('notes: image upload failed', err);
    toast(`Image not saved: ${err.message || 'upload failed'}`, 'error');
    const live = ctx.bodyFor(catId);
    const target = live && [...live.querySelectorAll('img.is-pending')].find((i) => i.src === dataUrl);
    if (target) { target.remove(); ctx.changed(live); }
  }
}

export function pickImage(body) {
  const input = el('input', { type: 'file', accept: 'image/*', multiple: true });
  input.addEventListener('change', () => { for (const f of input.files) insertImageFile(body, f); });
  input.click();
}

let selected = null;
export function selectImage(img, body) {
  deselectImage();
  selected = img;
  img.classList.add('is-selected');
  // The caret goes after the image so typing continues past it.
  const p = img.parentNode;
  collapseAt(p, Array.prototype.indexOf.call(p.childNodes, img) + 1);
  const bar = el('div', { class: 'nt-img-bar' },
    ...['25', '50', '75', '100'].map((w) => el('button', {
      type: 'button', class: `nt-btn is-small ${img.dataset.w === w ? 'is-on' : ''}`, text: `${w}%`,
      onclick: () => { transact(body, () => { img.dataset.w = w; img.style.width = `${w}%`; }); selectImage(img, body); },
    })),
    el('button', { type: 'button', class: 'nt-icon-btn', 'data-tip': 'Open full size', html: ICON.eye, onclick: () => window.open(img.src, '_blank', 'noopener') }),
    el('button', { type: 'button', class: 'nt-icon-btn is-danger', 'data-tip': 'Remove image', html: ICON.trash, onclick: () => removeImage(img, body) }));
  panel({ className: 'nt-img-panel', content: bar, anchor: img, align: 'center', below: false, keepFocus: true, onClose: () => { if (selected === img) { img.classList.remove('is-selected'); selected = null; } } });
}

function deselectImage() {
  if (selected) selected.classList.remove('is-selected');
  selected = null;
}

function removeImage(img, body) {
  closePanel();
  transact(body, () => {
    const p = img.parentNode;
    img.remove();
    if (p && p.tagName === 'P' && !p.textContent && !p.querySelector('img,br')) p.append(document.createElement('br'));
  });
}

/* ---- clicks and menus ----------------------------------------------------------- */

export function activate(chip, body, e) {
  // A drag that ended on this chip is not a click on it.
  if (chip.dataset.dragged) return;
  // The mark at the head folds the chip down to itself and back.
  if (e.target.closest && e.target.closest('.nt-chip-mark')) {
    const { toggleMin } = ctx.nodes;
    toggleMin(chip, body);
    return;
  }
  if (chip.classList.contains('chip-link')) {
    const href = chip.getAttribute('href');
    if (e.altKey) { chipMenu(chip, body); return; }
    window.open(href, '_blank', 'noopener');
    return;
  }
  if (chip.classList.contains('chip-md')) openMd(chip, body);
}

function onContextMenu(e) {
  const body = bodyFrom(e.target);
  if (!body) return;
  const chip = e.target.closest('.chip');
  if (chip) { e.preventDefault(); chipMenu(chip, body, { x: e.clientX, y: e.clientY }); return; }
  const img = e.target.closest('img.nt-img');
  if (img) { e.preventDefault(); selectImage(img, body); }
}

function chipMenu(chip, body, at) {
  const isLink = chip.classList.contains('chip-link');
  const anchor = at ? { left: at.x, right: at.x, top: at.y, bottom: at.y, width: 0, height: 0 } : chip;
  const items = isLink ? [
    { label: 'Open link', icon: ICON.link, run: () => window.open(chip.getAttribute('href'), '_blank', 'noopener') },
    { label: 'Copy link', icon: ICON.copy, run: () => navigator.clipboard.writeText(chip.getAttribute('href')).then(() => toast('Link copied')) },
    { label: 'Edit link…', icon: ICON.edit, run: () => promptLink(body, chip) },
    { label: 'Unlink (keep text)', run: () => transact(body, () => { chip.replaceWith(document.createTextNode(chipLabel(chip))); body.normalize(); }) },
    null,
    { label: 'Delete', icon: ICON.trash, danger: true, run: () => transact(body, () => chip.remove()) },
  ] : [
    { label: 'Edit markdown…', icon: ICON.edit, run: () => openMd(chip, body) },
    { label: 'Copy markdown', icon: ICON.copy, run: () => navigator.clipboard.writeText(decode(chip.dataset.md)).then(() => toast('Markdown copied')) },
    { label: 'Turn into text', run: () => transact(body, () => { chip.replaceWith(...fragmentFromMarkdown(decode(chip.dataset.md)).childNodes); }) },
    null,
    { label: 'Delete', icon: ICON.trash, danger: true, run: () => transact(body, () => chip.remove()) },
  ];
  menu(anchor, items, { focusFirst: !at });
}

function fragmentFromMarkdown(text) {
  const holder = document.createElement('div');
  holder.innerHTML = renderMarkdown(text);
  // Rendered markdown is richer than the body schema; clean() brings it in.
  const cleaned = document.createElement('div');
  cleaned.innerHTML = ctx.clean(holder.innerHTML);
  // Inline into the current block: only the first paragraph's content goes
  // inline; the rest are dropped behind it as blocks by the transact caller.
  const frag = document.createDocumentFragment();
  const first = cleaned.firstElementChild;
  if (first && first.tagName === 'P') { while (first.firstChild) frag.append(first.firstChild); first.remove(); }
  if (cleaned.childNodes.length) {
    // Anything else is appended after the chip's block by the caller's
    // transaction; simplest faithful behaviour is text with breaks.
    const span = document.createDocumentFragment();
    for (const b of [...cleaned.children]) { span.append(document.createElement('br'), document.createTextNode(b.textContent)); }
    frag.append(span);
  }
  return frag;
}

/* The node table travels with chips: app.js builds the header control from it
   and has no other reason to know nodes.js exists. */
export { NODES, nodeKind, kindOf };

export { confirm };
