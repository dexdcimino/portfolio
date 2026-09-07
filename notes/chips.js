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

let ctx = null;

export function initChips(context) {
  ctx = context;
  ctx.canvas.addEventListener('contextmenu', onContextMenu);
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
    if (!chip.textContent.trim()) chip.textContent = titleOf(decode(chip.dataset.md));
    chip.setAttribute('contenteditable', 'false');
  }
  for (const chip of body.querySelectorAll('a.chip-link')) {
    chip.setAttribute('contenteditable', 'false');
    if (!chip.textContent.trim()) chip.textContent = labelFor(chip.getAttribute('href'));
  }
}

/* When the token is renewed, image URLs are rebuilt on the next hydrate;
 * the old ones keep working until the old token expires. */

/* ---- links ---------------------------------------------------------------- */

export const URL_RE = /^(https?:\/\/|www\.)[^\s<>"']+$/i;

function normalizeUrl(u) {
  let s = String(u || '').trim();
  if (!s) return '';
  if (/^www\./i.test(s)) s = `https://${s}`;
  if (!/^(https?:\/\/|mailto:)/i.test(s)) s = `https://${s}`;
  return s;
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
  return el('a', {
    class: 'chip chip-link', href: normalizeUrl(url), contenteditable: 'false',
    target: '_blank', rel: 'noopener', text: label || labelFor(normalizeUrl(url)),
  });
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
  const url = el('input', { type: 'url', class: 'nt-input', placeholder: 'https://', value: existing ? existing.getAttribute('href') : '', spellcheck: 'false' });
  const label = el('input', { type: 'text', class: 'nt-input', placeholder: 'Label (optional)', value: existing ? existing.textContent : selText });
  const saved = range ? range.cloneRange() : null;
  const submit = () => {
    const u = normalizeUrl(url.value);
    if (!u || !/^(https?:\/\/|mailto:)/.test(u)) { toast('That is not a link'); url.focus(); return; }
    closePanel();
    body.focus({ preventScroll: true });
    if (existing) {
      transact(body, () => { existing.setAttribute('href', u); existing.textContent = label.value.trim() || labelFor(u); });
      return;
    }
    if (saved) setRange(saved);
    insertLink(body, u, label.value.trim());
  };
  const form = el('form', { class: 'nt-form', onsubmit: (e) => { e.preventDefault(); submit(); } },
    el('div', { class: 'nt-form-title', text: existing ? 'Edit link' : 'Insert link' }),
    url, label,
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
  return el('span', { class: 'chip chip-md', 'data-md': encode(text), contenteditable: 'false', text: titleOf(text) });
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
    transact(body, () => { chip.dataset.md = encode(text); chip.textContent = titleOf(text); });
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
    { label: 'Unlink (keep text)', run: () => transact(body, () => { chip.replaceWith(document.createTextNode(chip.textContent)); body.normalize(); }) },
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

export { confirm };
