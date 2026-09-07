/* Rendering and structure: the sidebar, the rail, the canvas, the sessions
 * popup and the archive, plus every operation that changes the shape of a
 * session (add, rename, recolour, reorder, archive, restore, delete).
 *
 * Every structural change runs inside ctx.history.structure(), which snapshots
 * the session before and after, so a deleted category comes back with Ctrl+Z
 * exactly as it was, body and all.
 *
 * Bodies are rendered once and then left alone: a re-render of the canvas
 * keeps any body that is unchanged and focused, so an autosave or a sidebar
 * change never moves the caret. Only the category whose structure changed
 * is rebuilt.
 */

import { el, closest, caretToEnd } from './dom.js';
import { newCat, newSession, catOf, archivedOf, touch, snapshot, restore, PALETTE, SESSION_PALETTE, now } from './state.js';
import { confirm, toast, menu, panel, closePanel, ICON } from './ui.js';
import { contrastOn } from './color.js';

let ctx = null;
export function initRender(context) { ctx = context; }

/* ---- helpers ---------------------------------------------------------------- */

const GRAPHEME = /^(\p{Extended_Pictographic}(️|\p{Emoji_Modifier})?(‍\p{Extended_Pictographic}(️|\p{Emoji_Modifier})?)*)/u;

/* What the rail shows: the emoji if there is one, else the first letter. */
export function glyph(item) {
  if (item.emoji) return { text: item.emoji, emoji: true };
  const t = (item.title || '').trim();
  const m = GRAPHEME.exec(t);
  if (m) return { text: m[0], emoji: true };
  return { text: t ? [...t][0].toUpperCase() : '?', emoji: false };
}

function paintColor(node, color) {
  node.style.setProperty('--c', color);
  node.style.setProperty('--c-on', contrastOn(color));
}

const S = () => ctx.session;

function structure(label, mutate) {
  return ctx.history.structure(label, () => snapshot(S()), () => {
    const r = mutate();
    touch(S());
    ctx.docChanged();
    return r;
  });
}

/* ---- sessions ----------------------------------------------------------------- */

export function addSession() {
  const used = ctx.doc.sessions.length;
  const s = newSession('New Session', { color: SESSION_PALETTE[used % SESSION_PALETTE.length] });
  ctx.doc.sessions.push(s);
  switchSession(s.id);
  ctx.docChanged();
  setTimeout(() => editSessionTitle(), 60);
}

export function switchSession(id) {
  if (!ctx.doc.sessions.some((s) => s.id === id) || id === ctx.doc.active) return;
  ctx.flushBodies();
  ctx.doc.active = id;
  ctx.history.clear();
  ctx.docChanged();
  renderAll();
  ctx.canvas.scrollTop = 0;
}

export async function deleteSession(id) {
  const s = ctx.doc.sessions.find((x) => x.id === id);
  if (!s) return;
  if (ctx.doc.sessions.length === 1) { toast('The last session cannot be deleted'); return; }
  const cats = s.cats.length + s.archived.length;
  const ok = await confirm({
    title: 'Delete session?', msg: `Delete <strong>${esc(s.title)}</strong> and its ${cats} categor${cats === 1 ? 'y' : 'ies'}?`,
    sub: 'This cannot be undone. Archive categories you want to keep first.', ok: 'Delete', danger: true,
  });
  if (ok !== 'ok') return;
  ctx.flushBodies();
  ctx.doc.sessions = ctx.doc.sessions.filter((x) => x.id !== id);
  if (ctx.doc.active === id) ctx.doc.active = ctx.doc.sessions[0].id;
  ctx.history.clear();
  ctx.docChanged();
  renderAll();
  toast(`"${s.title}" deleted`);
}

export function openSessions(anchor) {
  const grid = el('div', { class: 'nt-sess-grid' });
  const draw = () => {
    grid.replaceChildren(...ctx.doc.sessions.map((s) => {
      const g = glyph(s);
      const card = el('button', { type: 'button', class: `nt-sess-card ${s.id === ctx.doc.active ? 'is-active' : ''} ${g.emoji ? 'is-emoji' : ''}`, 'data-tip': s.title, text: g.text });
      paintColor(card, s.color);
      card.addEventListener('click', () => { switchSession(s.id); draw(); });
      card.addEventListener('contextmenu', (e) => { e.preventDefault(); sessionMenu(s, card); });
      const x = el('span', { class: 'nt-sess-x', html: ICON.close, title: 'Delete session' });
      x.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); deleteSession(s.id); });
      card.append(x);
      return card;
    }), el('button', { type: 'button', class: 'nt-sess-card is-add', 'data-tip': 'New session', html: ICON.plus, onclick: () => { closePanel(); addSession(); } }));
  };
  draw();
  const box = el('div', { class: 'nt-sess' },
    el('div', { class: 'nt-sess-head', text: 'Sessions' }),
    grid,
    el('p', { class: 'nt-sess-hint', text: 'Click to switch · right-click for options' }));
  panel({ className: 'nt-sess-panel', content: box, anchor, align: 'left' });
}

function sessionMenu(s, anchor) {
  menu(anchor, [
    { label: 'Rename', icon: ICON.edit, run: () => { switchSession(s.id); setTimeout(editSessionTitle, 50); } },
    { label: 'Emoji…', run: () => ctx.emoji.openFull(anchor, (u) => { s.emoji = u; touch(s); ctx.docChanged(); renderAll(); }) },
    { label: 'Colour…', icon: ICON.palette, run: () => ctx.color.open(anchor, { title: 'Session colour', value: s.color, onChange: (c) => { s.color = c; touch(s); ctx.docChanged(); applySessionColor(); } }) },
    null,
    { label: 'Delete session', icon: ICON.trash, danger: true, run: () => deleteSession(s.id) },
  ]);
}

function editSessionTitle() {
  const t = ctx.root.querySelector('.nt-session-title');
  if (t) { t.focus(); selectAll(t); }
}

function selectAll(node) {
  const r = document.createRange();
  r.selectNodeContents(node);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

/* ---- categories ---------------------------------------------------------------- */

export function addCat(where) {
  // where: 'top' | 'bottom' | { after: id }
  const s = S();
  let cat;
  structure('add category', () => {
    cat = newCat('New Category', { color: PALETTE[s.cats.length % (PALETTE.length - 1)] });
    if (where === 'top') s.cats.unshift(cat);
    else if (where && where.after) { const i = s.cats.findIndex((c) => c.id === where.after); s.cats.splice(i + 1, 0, cat); }
    else s.cats.push(cat);
  });
  renderAll();
  const sec = sectionFor(cat.id);
  if (sec) {
    sec.classList.add('is-new');
    sec.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const title = sec.querySelector('.nt-cat-title');
    setTimeout(() => { title.focus(); selectAll(title); }, 60);
  }
  return cat;
}

export function renameCat(id, title) {
  const cat = catOf(S(), id);
  if (!cat) return;
  const clean = title.replace(/\s+/g, ' ').trim().slice(0, 80) || 'New Category';
  if (clean === cat.title) return;
  structure('rename', () => { cat.title = clean; touch(S(), cat); });
  // The title element already shows the text; only the sidebar needs it.
  renderSidebar();
}

export function setCatEmoji(id, emoji) {
  const cat = catOf(S(), id);
  if (!cat) return;
  structure('emoji', () => { cat.emoji = emoji; touch(S(), cat); });
  renderCatHeader(id);
  renderSidebar();
}

export function setCatColor(id, color) {
  const cat = catOf(S(), id);
  if (!cat) return;
  cat.color = color;
  touch(S(), cat);
  ctx.docChanged();
  const sec = sectionFor(id);
  if (sec) paintColor(sec, color);
  renderSidebar();
}

export function toggleCollapse(id, force) {
  const cat = catOf(S(), id);
  if (!cat) return;
  cat.collapsed = force === undefined ? !cat.collapsed : !!force;
  ctx.docChanged();
  const sec = sectionFor(id);
  if (sec) sec.classList.toggle('is-collapsed', cat.collapsed);
  renderSidebar();
}

export function expandCat(id) { const cat = catOf(S(), id); if (cat && cat.collapsed) toggleCollapse(id, false); }

export function moveCat(id, to) {
  const s = S();
  const from = s.cats.findIndex((c) => c.id === id);
  if (from < 0) return;
  const target = Math.max(0, Math.min(s.cats.length - 1, to));
  if (target === from) return;
  structure('move', () => {
    const [cat] = s.cats.splice(from, 1);
    s.cats.splice(target, 0, cat);
  });
  renderAll();
  const sec = sectionFor(id);
  if (sec) sec.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export async function archiveCat(id) {
  const cat = catOf(S(), id);
  if (!cat) return;
  const empty = !ctx.toText(cat.body).trim();
  let choice = 'ok';
  if (!empty) {
    choice = await confirm({
      title: 'Archive category', msg: `Archive <strong>${esc(cat.title)}</strong>?`,
      sub: 'It moves to the archive at the bottom of the sidebar and can be restored any time. Ctrl+Z also brings it back.',
      ok: 'Archive', alt: 'Delete', altDanger: true,
    });
  }
  if (!choice) return;
  ctx.flushBodies();
  structure(choice === 'alt' ? 'delete' : 'archive', () => {
    const s = S();
    s.cats = s.cats.filter((c) => c.id !== id);
    if (choice !== 'alt') { cat.archivedAt = now(); s.archived.unshift(cat); }
    if (!s.cats.length) s.cats.push(newCat('New Category'));
  });
  renderAll();
  toast(choice === 'alt' ? `"${cat.title}" deleted (Ctrl+Z to undo)` : `"${cat.title}" archived`);
}

export function restoreCat(id) {
  const cat = archivedOf(S(), id);
  if (!cat) return;
  structure('restore', () => {
    const s = S();
    s.archived = s.archived.filter((c) => c.id !== id);
    delete cat.archivedAt;
    s.cats.push(cat);
  });
  renderAll();
  const sec = sectionFor(id);
  if (sec) sec.scrollIntoView({ block: 'center', behavior: 'smooth' });
  toast(`"${cat.title}" restored`);
}

export async function deleteArchived(id) {
  const cat = archivedOf(S(), id);
  if (!cat) return;
  const ok = await confirm({ title: 'Delete permanently?', msg: `Delete <strong>${esc(cat.title)}</strong> from the archive?`, sub: 'Ctrl+Z can still bring it back until you close the notes.', ok: 'Delete', danger: true });
  if (ok !== 'ok') return;
  structure('delete archived', () => { S().archived = S().archived.filter((c) => c.id !== id); });
  renderSidebar();
}

export function duplicateCat(id) {
  const s = S();
  const cat = catOf(s, id);
  if (!cat) return;
  ctx.flushBodies();
  let copy;
  structure('duplicate', () => {
    copy = newCat(`${cat.title} copy`, { color: cat.color, emoji: cat.emoji, body: cat.body });
    s.cats.splice(s.cats.indexOf(cat) + 1, 0, copy);
  });
  renderAll();
  const sec = sectionFor(copy.id);
  if (sec) sec.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* ---- the canvas ------------------------------------------------------------------ */

const sectionFor = (id) => ctx.canvas.querySelector(`.nt-cat[data-cat="${CSS.escape(id)}"]`);

export function renderAll() {
  applySessionColor();
  renderSessionHeader();
  renderCanvas();
  renderSidebar();
  ctx.dictate.paintButtons();
  ctx.spell.rescanAll();
  ctx.search.refresh();
}

export function applySessionColor() {
  const s = S();
  paintColor(ctx.root, s.color);
  const btn = ctx.root.querySelector('.nt-session-btn');
  if (btn) { const g = glyph(s); btn.textContent = g.text; btn.classList.toggle('is-emoji', g.emoji); paintColor(btn, s.color); btn.setAttribute('data-tip', `${s.title} · sessions`); }
  const railBtn = ctx.root.querySelector('.nt-rail-session');
  if (railBtn) { const g = glyph(s); railBtn.textContent = g.text; railBtn.classList.toggle('is-emoji', g.emoji); paintColor(railBtn, s.color); railBtn.setAttribute('data-tip', `${s.title} · sessions`); }
  const title = ctx.root.querySelector('.nt-sidebar-session-title');
  if (title) title.textContent = s.title;
}

function renderSessionHeader() {
  const s = S();
  const head = ctx.canvas.querySelector('.nt-session-head');
  if (!head) return;
  const emojiBtn = head.querySelector('.nt-session-emoji');
  const g = glyph(s);
  emojiBtn.textContent = g.text;
  emojiBtn.classList.toggle('is-emoji', g.emoji);
  const title = head.querySelector('.nt-session-title');
  if (document.activeElement !== title) title.textContent = s.title;
}

function renderCanvas() {
  const s = S();
  const list = ctx.canvas.querySelector('.nt-cats');
  const existing = new Map([...list.children].map((n) => [n.dataset.cat, n]));
  const frag = document.createDocumentFragment();
  for (const cat of s.cats) {
    let sec = existing.get(cat.id);
    if (sec && sec.querySelector('.nt-body').dataset.rev === cat.updated) {
      // Unchanged: keep the element, and with it the caret if it is inside.
      existing.delete(cat.id);
      fillHeader(sec, cat);
      sec.classList.toggle('is-collapsed', cat.collapsed);
      paintColor(sec, cat.color);
    } else {
      if (sec) { existing.delete(cat.id); ctx.spell.forget(sec.querySelector('.nt-body')); }
      sec = buildSection(cat);
    }
    frag.append(sec);
  }
  for (const gone of existing.values()) { ctx.spell.forget(gone.querySelector('.nt-body')); gone.remove(); }
  list.replaceChildren(frag);
  ctx.canvas.classList.toggle('is-empty', !s.cats.length);
}

function buildSection(cat) {
  const sec = el('section', { class: `nt-cat ${cat.collapsed ? 'is-collapsed' : ''}`, 'data-cat': cat.id });
  paintColor(sec, cat.color);
  const head = el('div', { class: 'nt-cat-head' },
    el('button', { type: 'button', class: 'nt-cat-toggle', 'data-tip': 'Collapse', html: ICON.chevron, 'aria-label': 'Collapse category', onclick: () => toggleCollapse(cat.id) }),
    el('button', { type: 'button', class: 'nt-cat-emoji', 'data-tip': 'Emoji', 'aria-label': 'Choose an emoji', onclick: (e) => ctx.emoji.openFull(e.currentTarget, (u) => setCatEmoji(cat.id, u)) }),
    el('h2', { class: 'nt-cat-title', contenteditable: 'true', spellcheck: 'false', 'data-cat': cat.id, 'aria-label': 'Category title' }),
    el('button', { type: 'button', class: 'nt-cat-color', 'data-tip': 'Colour', 'aria-label': 'Choose a colour', onclick: (e) => openCatColor(cat.id, e.currentTarget) }),
    el('button', { type: 'button', class: 'nt-cat-more nt-icon-btn', 'data-tip': 'More', 'aria-label': 'Category options', html: ICON.more, onclick: (e) => catMenu(cat.id, e.currentTarget) }),
    el('button', { type: 'button', class: 'nt-cat-x nt-icon-btn', 'data-tip': 'Archive', 'aria-label': 'Archive category', html: ICON.close, onclick: () => archiveCat(cat.id) }));
  const body = el('div', { class: 'nt-body', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'data-cat': cat.id, 'data-rev': cat.updated, 'aria-label': `${cat.title} notes` });
  body.innerHTML = ctx.clean(cat.body);
  body.spellcheck = false;
  ctx.chips.hydrate(body);
  // The microphone sits in the box's bottom-right corner, in the wrapper
  // rather than inside the contenteditable: a button inside the text is a
  // thing the caret can land on.
  sec.append(head, el('div', { class: 'nt-cat-body' }, body, ctx.dictate.micButton(cat.id)));
  fillHeader(sec, cat);
  wireTitle(head.querySelector('.nt-cat-title'), cat.id);
  return sec;
}

function fillHeader(sec, cat) {
  const g = glyph(cat);
  const emojiBtn = sec.querySelector('.nt-cat-emoji');
  emojiBtn.textContent = cat.emoji || g.text;
  emojiBtn.classList.toggle('is-emoji', !!cat.emoji || g.emoji);
  const title = sec.querySelector('.nt-cat-title');
  if (document.activeElement !== title && title.textContent !== cat.title) title.textContent = cat.title;
  sec.querySelector('.nt-body').dataset.rev = cat.updated;
}

function renderCatHeader(id) {
  const sec = sectionFor(id);
  const cat = catOf(S(), id);
  if (sec && cat) fillHeader(sec, cat);
}

function wireTitle(title, id) {
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      renameCat(id, title.textContent);
      const body = ctx.bodyFor(id);
      if (body) { expandCat(id); body.focus({ preventScroll: true }); caretToEnd(body); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); title.textContent = catOf(S(), id).title; title.blur(); return; }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const i = S().cats.findIndex((c) => c.id === id);
      moveCat(id, e.key === 'ArrowUp' ? i - 1 : i + 1);
      setTimeout(() => { const t = sectionFor(id)?.querySelector('.nt-cat-title'); if (t) { t.focus(); caretToEnd(t); } }, 0);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) ctx.history.redo(); else ctx.history.undo(); return; }
    if (ctx.emoji.isOpen() && ctx.emoji.onKey(e)) return;
  });
  title.addEventListener('input', () => {
    // Titles are one line of plain text.
    if (title.querySelector('*')) { const t = title.textContent; title.textContent = t; caretToEnd(title); }
    ctx.emoji.watch(title);
    const row = ctx.sidebar.querySelector(`.nt-row[data-cat="${CSS.escape(id)}"] .nt-row-title`);
    if (row) row.textContent = title.textContent;
  });
  title.addEventListener('blur', () => renameCat(id, title.textContent));
  title.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' ');
    document.execCommand('insertText', false, text);
  });
}

function openCatColor(id, anchor) {
  const cat = catOf(S(), id);
  if (!cat) return;
  const before = cat.color;
  ctx.color.open(anchor, {
    title: 'Category colour', value: cat.color,
    onChange: (c) => setCatColor(id, c),
    onClear: () => setCatColor(id, PALETTE[8]),
  });
  // One undo step for the whole picker session.
  const seal = () => { if (cat.color !== before) { const after = cat.color; cat.color = before; structure('colour', () => { cat.color = after; }); } };
  const check = setInterval(() => { if (!ctx.root.querySelector('.nt-clr-panel')) { clearInterval(check); seal(); } }, 300);
}

function catMenu(id, anchor) {
  const s = S();
  const i = s.cats.findIndex((c) => c.id === id);
  const cat = s.cats[i];
  menu(anchor, [
    { label: 'Move up', hint: 'Alt+↑', disabled: i === 0, run: () => moveCat(id, i - 1) },
    { label: 'Move down', hint: 'Alt+↓', disabled: i === s.cats.length - 1, run: () => moveCat(id, i + 1) },
    { label: 'Move to top', disabled: i === 0, run: () => moveCat(id, 0) },
    { label: 'Move to bottom', disabled: i === s.cats.length - 1, run: () => moveCat(id, s.cats.length - 1) },
    null,
    { label: 'Add category below', icon: ICON.plus, run: () => addCat({ after: id }) },
    { label: 'Duplicate', icon: ICON.copy, run: () => duplicateCat(id) },
    { label: 'Copy as text', run: () => navigator.clipboard.writeText(`${cat.title}\n\n${ctx.toText(cat.body)}`).then(() => toast('Copied')) },
    null,
    { label: 'Archive', icon: ICON.archive, run: () => archiveCat(id) },
  ], { align: 'right' });
}

/* ---- the sidebar ------------------------------------------------------------------ */

export function renderSidebar() {
  const s = S();
  const list = ctx.sidebar.querySelector('.nt-rows');
  const rail = ctx.sidebar.querySelector('.nt-rail-cats');
  const rows = s.cats.map((cat) => {
    const g = glyph(cat);
    const row = el('div', { class: `nt-row ${cat.collapsed ? 'is-collapsed' : ''}`, 'data-cat': cat.id, role: 'button', tabindex: '0' });
    paintColor(row, cat.color);
    const grip = el('span', { class: 'nt-row-grip', html: ICON.grip, 'data-tip': 'Drag to reorder', 'data-tip-pos': 'right' });
    const badge = el('button', { type: 'button', class: `nt-row-badge ${g.emoji || cat.emoji ? 'is-emoji' : ''}`, text: cat.emoji || g.text, 'data-tip': 'Emoji', tabindex: '-1', onclick: (e) => { e.stopPropagation(); ctx.emoji.openFull(e.currentTarget, (u) => setCatEmoji(cat.id, u)); } });
    const title = el('span', { class: 'nt-row-title', text: cat.title });
    const color = el('button', { type: 'button', class: 'nt-row-color', 'data-tip': 'Colour', tabindex: '-1', 'aria-label': 'Colour', onclick: (e) => { e.stopPropagation(); openCatColor(cat.id, e.currentTarget); } });
    const x = el('button', { type: 'button', class: 'nt-row-x', 'data-tip': 'Archive', tabindex: '-1', 'aria-label': 'Archive', html: ICON.close, onclick: (e) => { e.stopPropagation(); archiveCat(cat.id); } });
    row.append(grip, badge, title, color, x);
    row.addEventListener('click', (e) => { if (e.target.closest('button,.nt-row-grip')) return; jumpTo(cat.id); });
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jumpTo(cat.id); } });
    row.addEventListener('dblclick', (e) => { if (e.target.closest('button')) return; const t = sectionFor(cat.id)?.querySelector('.nt-cat-title'); if (t) { jumpTo(cat.id); t.focus(); selectAll(t); } });
    wireDrag(row, grip, cat.id);
    return row;
  });
  list.replaceChildren(...rows);

  rail.replaceChildren(...s.cats.map((cat) => {
    const g = glyph(cat);
    const b = el('button', { type: 'button', class: `nt-rail-cat ${g.emoji ? 'is-emoji' : ''}`, text: g.text, 'data-cat': cat.id, 'data-tip': cat.title, 'data-tip-pos': 'right', onclick: () => jumpTo(cat.id) });
    paintColor(b, cat.color);
    return b;
  }));

  renderArchive();
  spy();
}

function renderArchive() {
  const s = S();
  const wrap = ctx.sidebar.querySelector('.nt-archive');
  const list = wrap.querySelector('.nt-archive-list');
  const count = wrap.querySelector('.nt-archive-count');
  count.textContent = s.archived.length ? String(s.archived.length) : '';
  wrap.classList.toggle('is-empty', !s.archived.length);
  list.replaceChildren(...s.archived.map((cat) => {
    const g = glyph(cat);
    const row = el('div', { class: 'nt-arch-row', 'data-cat': cat.id });
    paintColor(row, cat.color);
    row.append(
      el('span', { class: `nt-row-badge ${g.emoji ? 'is-emoji' : ''}`, text: g.text }),
      el('span', { class: 'nt-row-title', text: cat.title, title: cat.title }),
      el('button', { type: 'button', class: 'nt-icon-btn is-small', 'data-tip': 'Restore', html: ICON.restore, 'aria-label': 'Restore', onclick: () => restoreCat(cat.id) }),
      el('button', { type: 'button', class: 'nt-icon-btn is-small is-danger', 'data-tip': 'Delete forever', html: ICON.trash, 'aria-label': 'Delete forever', onclick: () => deleteArchived(cat.id) }));
    return row;
  }));
}

export function jumpTo(id) {
  const sec = sectionFor(id);
  if (!sec) return;
  expandCat(id);
  const top = sec.offsetTop - 18;
  ctx.canvas.scrollTo({ top, behavior: 'smooth' });
  spyHold = id;
  clearTimeout(spyTimer);
  spyTimer = setTimeout(() => { spyHold = null; spy(); }, 900);
  setActive(id);
}

/* ---- scroll spy: which category the reader is in ------------------------------------ */

let spyHold = null;
let spyTimer = 0;
let spyFrame = 0;
let activeId = null;

export function onCanvasScroll() {
  if (!spyFrame) spyFrame = requestAnimationFrame(spy);
}

function spy() {
  spyFrame = 0;
  if (spyHold) { setActive(spyHold); return; }
  const secs = [...ctx.canvas.querySelectorAll('.nt-cat')];
  if (!secs.length) { setActive(null); return; }
  const top = ctx.canvas.scrollTop;
  const bottom = top + ctx.canvas.clientHeight;
  let best = null; let bestSeen = -1;
  for (const sec of secs) {
    const a = sec.offsetTop; const b = a + sec.offsetHeight;
    const seen = Math.min(bottom, b) - Math.max(top, a);
    if (seen > bestSeen) { bestSeen = seen; best = sec; }
  }
  // At the very top the first section wins even if a taller one shows more.
  if (top < 40) best = secs[0];
  setActive(best ? best.dataset.cat : null);
}

function setActive(id) {
  if (id === activeId) return;
  activeId = id;
  for (const n of ctx.sidebar.querySelectorAll('.nt-row, .nt-rail-cat')) n.classList.toggle('is-here', n.dataset.cat === id);
  const here = ctx.sidebar.querySelector('.nt-rail-cat.is-here');
  if (here) here.scrollIntoView({ block: 'nearest' });
  const cat = id && catOf(S(), id);
  ctx.root.style.setProperty('--here', cat ? cat.color : S().color);
}

/* ---- drag to reorder in the sidebar ----------------------------------------------------- */

function wireDrag(row, grip, id) {
  let dragging = false;
  let ghost = null;
  let marker = null;
  let target = -1;
  const list = () => ctx.sidebar.querySelector('.nt-rows');
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const onMove = (ev) => {
      if (!dragging) {
        if (Math.abs(ev.clientY - startY) < 4) return;
        dragging = true;
        ghost = row.cloneNode(true);
        ghost.classList.add('is-ghost');
        ghost.style.width = `${row.offsetWidth}px`;
        ctx.root.append(ghost);
        marker = el('div', { class: 'nt-drop-marker' });
        row.classList.add('is-dragging');
      }
      ghost.style.left = `${row.getBoundingClientRect().left}px`;
      ghost.style.top = `${ev.clientY - 16}px`;
      const rows = [...list().querySelectorAll('.nt-row:not(.is-dragging)')];
      target = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) { target = i; break; }
      }
      if (target < rows.length) rows[target].before(marker); else list().append(marker);
      // Auto-scroll the list near its edges.
      const lr = list().getBoundingClientRect();
      if (ev.clientY < lr.top + 30) list().scrollTop -= 8;
      else if (ev.clientY > lr.bottom - 30) list().scrollTop += 8;
    };
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
      if (!dragging) return;
      dragging = false;
      row.classList.remove('is-dragging');
      if (ghost) ghost.remove();
      if (marker) marker.remove();
      const s = S();
      const from = s.cats.findIndex((c) => c.id === id);
      const others = s.cats.filter((c) => c.id !== id);
      const before = target < others.length ? others[target] : null;
      const to = before ? s.cats.indexOf(before) - (s.cats.indexOf(before) > from ? 1 : 0) : s.cats.length - 1;
      moveCat(id, to);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  });
}

/* ---- filtering (search) ------------------------------------------------------------------ */

export function filterSidebar(hits) {
  for (const n of ctx.sidebar.querySelectorAll('.nt-row, .nt-rail-cat')) n.classList.toggle('is-dim', !!hits && !hits.has(n.dataset.cat));
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export { sectionFor, selectAll, restore };
