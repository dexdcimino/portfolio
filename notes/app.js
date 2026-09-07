/* The notes app. Mounted into the overlay by script.js once the password has
 * been checked; unmounted when the overlay closes.
 *
 *   const app = await mount(container, { payload, token, onToken, onLocked });
 *   app.unmount();
 *
 * This file owns the layout, the shared context every module reads, the
 * save loop, and the keyboard routing that is not about typing in a body.
 *
 * SAVING. Bodies are the source of truth while typing. Every input serialises
 * the changed body back into its category (cheap: one clone of one body),
 * stamps the session, and arms a debounce. The save carries the rev it was
 * built on; a 409 means another device saved first, the two are merged per
 * session and the save retried. A tab that comes back from the background
 * asks for the current document and takes it if nothing here has changed.
 */

import { el, escapeHtml, debounce, caretToEnd } from './dom.js';
import { clean, serialize, toText } from './schema.js';
import { History } from './history.js';
import { normalize, migrateHtml, activeSession, catOf, touch, restore as restoreSession, FONTS, SIZES, emptyDoc } from './state.js';
import { initEditor, capture, format, align, toggleList, indent, stateAt, insertInline } from './editor.js';
import * as chips from './chips.js';
import * as emoji from './emoji.js';
import * as color from './color.js';
import * as spell from './spell.js';
import * as search from './search.js';
import * as slash from './slash.js';
import * as render from './render.js';
import { setRoot, toast, confirm, menu, initTooltips, closePanel, ICON } from './ui.js';
import { restoreSelection } from './dom.js';

const SAVE_DEBOUNCE = 1200;

export async function mount(container, { payload, token, onToken, onLocked, onStatus }) {
  await ensureCss();

  /* ---- the document ---- */
  let doc;
  let migrated = false;
  if (payload.format === 'json') doc = normalize(payload.content);
  else { doc = migrateHtml(payload.content); migrated = true; }
  let rev = Number(payload.rev) || 0;
  let currentToken = token;
  const loadedStamps = new Map(doc.sessions.map((s) => [s.id, s.updated]));

  /* ---- the layout ---- */
  const root = el('div', { class: 'nt-app', 'data-theme': doc.ui.theme });
  const header = el('header', { class: 'nt-header' });
  const sidebar = el('aside', { class: 'nt-sidebar', 'aria-label': 'Categories' });
  const canvas = el('div', { class: 'nt-canvas', tabindex: '-1' });
  const main = el('main', { class: 'nt-main' }, canvas);
  root.append(header, el('div', { class: 'nt-frame' }, sidebar, main));
  container.replaceChildren(root);
  setRoot(root);
  initTooltips(root);

  /* ---- the context every module reads ---- */
  const ctx = {
    doc, root, header, sidebar, canvas,
    get session() { return activeSession(doc); },
    history: null,
    token: () => currentToken,
    api: { uploadAsset },
    clean, toText,
    bodyFor: (id) => canvas.querySelector(`.nt-body[data-cat="${CSS.escape(id)}"]`),
    changed,           // a body changed
    docChanged,        // the doc changed outside a body
    uiChanged: () => docChanged(),
    flushBodies,
    toolbarState: () => syncToolbar(),
    flashCorrection,
    insertText: (body, text) => insertInline(body, document.createTextNode(text)),
    filterSidebar: (hits) => render.filterSidebar(hits),
    expandCat: (id) => render.expandCat(id),
    chips, emoji, slash, spell, search,
    color: { open: color.openColor },
  };

  /* ---- history ---- */
  ctx.history = new History({
    applyText(catId, state) {
      const body = ctx.bodyFor(catId);
      if (!body) return;
      body.innerHTML = state.html;
      chips.hydrate(body);
      body.focus({ preventScroll: true });
      if (!restoreSelection(body, state.sel)) caretToEnd(body);
      changed(body);
      scrollCaretIntoView(body);
    },
    applyStructure(json) {
      flushBodies();
      const s = restoreSession(json);
      const i = doc.sessions.findIndex((x) => x.id === s.id);
      if (i < 0) doc.sessions.push(s); else doc.sessions[i] = s;
      if (doc.active !== s.id) doc.active = s.id;
      docChanged();
      render.renderAll();
    },
    onChange: () => syncUndoButtons(),
  });

  /* ---- modules ---- */
  render.initRender(ctx);
  initEditor(ctx);
  chips.initChips(ctx);
  emoji.initEmoji(ctx);
  color.initColor(ctx);
  slash.initSlash(ctx);
  spell.initSpell(ctx);

  /* ---- header ---- */
  const btn = (cls, tip, icon, onClick, extra = {}) => el('button', { type: 'button', class: `nt-icon-btn ${cls}`, 'data-tip': tip, html: icon, 'aria-label': tip, onclick: onClick, ...extra });
  const sep = () => el('span', { class: 'nt-sep' });

  const sidebarBtn = btn('nt-sidebar-toggle', 'Toggle sidebar (Ctrl+\\)', ICON.sidebar, () => setSidebar(doc.ui.sidebar === 'open' ? 'rail' : 'open'));
  const fontBtn = el('button', { type: 'button', class: 'nt-pick', 'data-tip': 'Font', 'aria-haspopup': 'menu' });
  fontBtn.addEventListener('click', () => menu(fontBtn, Object.entries(FONTS).map(([k, f]) => ({
    label: f.label, run: () => setFont(k),
  })), { onClose: () => { root.style.removeProperty('--font-preview'); } }));
  fontBtn.addEventListener('click', () => {
    // Each entry previews in its own face; hovering previews the whole app.
    setTimeout(() => {
      root.querySelectorAll('.nt-menu-item').forEach((item, i) => {
        const k = Object.keys(FONTS)[i];
        if (!k) return;
        item.style.fontFamily = FONTS[k].stack;
        item.addEventListener('mouseenter', () => root.style.setProperty('--font', FONTS[k].stack));
        item.addEventListener('mouseleave', () => root.style.setProperty('--font', FONTS[doc.ui.font].stack));
        if (k === doc.ui.font) item.classList.add('is-on');
      });
    }, 0);
  });
  const sizeBtn = el('button', { type: 'button', class: 'nt-pick nt-pick-size', 'data-tip': 'Text size', 'aria-haspopup': 'menu' });
  sizeBtn.addEventListener('click', () => menu(sizeBtn, SIZES.map((n) => ({ label: `${n}px`, run: () => setSize(n) }))));
  const fmt = {
    bold: btn('nt-fmt', 'Bold (Ctrl+B)', ICON.bold, () => format('bold')),
    italic: btn('nt-fmt', 'Italic (Ctrl+I)', ICON.italic, () => format('italic')),
    underline: btn('nt-fmt', 'Underline (Ctrl+U)', ICON.underline, () => format('underline')),
    strike: btn('nt-fmt', 'Strikethrough (Ctrl+Shift+D)', ICON.strike, () => format('strikeThrough')),
    code: btn('nt-fmt', 'Code (Ctrl+E)', ICON.code, () => format('code')),
    left: btn('nt-fmt', 'Align left (Ctrl+Shift+L)', ICON.alignLeft, () => withBody((b) => align(b, 'left'))),
    center: btn('nt-fmt', 'Align centre (Ctrl+Shift+E)', ICON.alignCenter, () => withBody((b) => align(b, 'center'))),
    right: btn('nt-fmt', 'Align right (Ctrl+Shift+R)', ICON.alignRight, () => withBody((b) => align(b, 'right'))),
    ul: btn('nt-fmt', 'Bullet list (Ctrl+Shift+8)', ICON.ul, () => withBody((b) => toggleList(b, 'ul'))),
    ol: btn('nt-fmt', 'Numbered list (Ctrl+Shift+7)', ICON.ol, () => withBody((b) => toggleList(b, 'ol'))),
    todo: btn('nt-fmt', 'To-do list (Ctrl+Shift+9)', ICON.todo, () => withBody((b) => toggleList(b, 'todo'))),
  };
  for (const b of Object.values(fmt)) b.addEventListener('mousedown', (e) => e.preventDefault());
  const spellBtn = btn('nt-spell-btn', 'Spell check', ICON.spell, () => { spell.setEnabled(!spell.enabled()); syncSettings(); });
  spellBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); settingsMenu(spellBtn); });
  const nodeBtn = btn('nt-node-btn', 'Insert a link, markdown node or image', ICON.link, () => menu(nodeBtn, [
    { label: 'Link', icon: ICON.link, hint: 'Ctrl+K', run: () => withBody((b) => chips.promptLink(b)) },
    { label: 'Markdown node', icon: ICON.md, run: () => withBody((b) => chips.insertMd(b)) },
    { label: 'Image', icon: ICON.image, hint: 'or paste', run: () => withBody((b) => chips.pickImage(b)) },
  ]));
  nodeBtn.addEventListener('mousedown', (e) => e.preventDefault());
  const undoBtn = btn('nt-undo', 'Undo (Ctrl+Z)', ICON.undo, () => ctx.history.undo());
  const redoBtn = btn('nt-redo', 'Redo (Ctrl+Y)', ICON.redo, () => ctx.history.redo());
  for (const b of [undoBtn, redoBtn]) b.addEventListener('mousedown', (e) => e.preventDefault());
  const themeBtn = btn('nt-theme', 'Light / dark', `${ICON.sun}${ICON.moon}`, () => setTheme(doc.ui.theme === 'dark' ? 'light' : 'dark'));
  const status = el('span', { class: 'nt-status', role: 'status', 'aria-live': 'polite' });
  const closeBtn = btn('nt-close', 'Close (Esc)', ICON.close, () => container.dispatchEvent(new CustomEvent('notes:close', { bubbles: true })));
  const searchMount = el('div', { class: 'nt-header-search' });
  header.append(
    el('div', { class: 'nt-header-left' }, sidebarBtn, sep(), fontBtn, sizeBtn),
    el('div', { class: 'nt-header-mid' }, fmt.bold, fmt.italic, fmt.underline, fmt.strike, fmt.code, sep(), fmt.left, fmt.center, fmt.right, sep(), fmt.ul, fmt.ol, fmt.todo, sep(), nodeBtn, spellBtn, sep(), undoBtn, redoBtn),
    el('div', { class: 'nt-header-right' }, searchMount, status, themeBtn, closeBtn));
  search.initSearch(ctx, searchMount);

  /* ---- sidebar ---- */
  const sessionBtn = el('button', { type: 'button', class: 'nt-session-btn', 'aria-label': 'Sessions', onclick: (e) => render.openSessions(e.currentTarget) });
  const sessionTitle = el('span', { class: 'nt-sidebar-session-title' });
  const rows = el('div', { class: 'nt-rows', role: 'list' });
  const archive = el('div', { class: 'nt-archive' },
    el('button', { type: 'button', class: 'nt-archive-head', 'aria-expanded': 'false', onclick: (e) => { const open = archive.classList.toggle('is-open'); e.currentTarget.setAttribute('aria-expanded', String(open)); } },
      el('span', { class: 'nt-archive-chev', html: ICON.chevron }), el('span', { text: 'Archive' }), el('span', { class: 'nt-archive-count' })),
    el('div', { class: 'nt-archive-list' }));
  const addBtn = el('button', { type: 'button', class: 'nt-add-btn', html: `${ICON.plus}<span>New category</span>`, onclick: () => render.addCat('bottom') });
  const railCats = el('div', { class: 'nt-rail-cats' });
  const railSession = el('button', { type: 'button', class: 'nt-rail-session', 'aria-label': 'Sessions', 'data-tip-pos': 'right', onclick: (e) => render.openSessions(e.currentTarget) });
  const railAdd = el('button', { type: 'button', class: 'nt-rail-add', 'data-tip': 'New category (Alt+N)', 'data-tip-pos': 'right', html: ICON.plus, 'aria-label': 'New category', onclick: () => render.addCat('bottom') });
  const railExpand = el('button', { type: 'button', class: 'nt-rail-expand', 'data-tip': 'Expand sidebar', 'data-tip-pos': 'right', html: ICON.sidebar, 'aria-label': 'Expand sidebar', onclick: () => setSidebar('open') });
  sidebar.append(
    el('div', { class: 'nt-sidebar-panel' },
      el('div', { class: 'nt-sidebar-top' }, sessionBtn, sessionTitle),
      rows, archive,
      el('div', { class: 'nt-sidebar-foot' }, addBtn)),
    el('div', { class: 'nt-rail' }, railSession, railCats, railAdd, railExpand));

  /* ---- canvas ---- */
  const sessionEmoji = el('button', { type: 'button', class: 'nt-session-emoji', 'data-tip': 'Session emoji', 'aria-label': 'Session emoji', onclick: (e) => emoji.openFull(e.currentTarget, (u) => { const s = ctx.session; s.emoji = u; touch(s); docChanged(); render.renderAll(); }) });
  const sessionTitleEl = el('h1', { class: 'nt-session-title', contenteditable: 'true', spellcheck: 'false', 'aria-label': 'Session title' });
  sessionTitleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sessionTitleEl.blur(); const first = canvas.querySelector('.nt-body'); if (first) { first.focus(); caretToEnd(first); } }
    if (e.key === 'Escape') { sessionTitleEl.textContent = ctx.session.title; sessionTitleEl.blur(); }
    if (emoji.isOpen() && emoji.onKey(e)) return;
  });
  sessionTitleEl.addEventListener('input', () => { if (sessionTitleEl.querySelector('*')) { sessionTitleEl.textContent = sessionTitleEl.textContent; caretToEnd(sessionTitleEl); } emoji.watch(sessionTitleEl); sessionTitle.textContent = sessionTitleEl.textContent; });
  sessionTitleEl.addEventListener('blur', () => {
    const s = ctx.session;
    const t = sessionTitleEl.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Session';
    sessionTitleEl.textContent = t;
    if (t !== s.title) { s.title = t; touch(s); docChanged(); render.applySessionColor(); }
  });
  sessionTitleEl.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' ')); });
  const sessionColor = el('button', { type: 'button', class: 'nt-session-color', 'data-tip': 'Session colour', 'aria-label': 'Session colour', onclick: (e) => color.openColor(e.currentTarget, { title: 'Session colour', value: ctx.session.color, onChange: (c) => { const s = ctx.session; s.color = c; touch(s); docChanged(); render.applySessionColor(); } }) });
  const addTop = btn('nt-session-addtop', 'Add a category at the top', ICON.plus, () => render.addCat('top'));
  canvas.append(
    el('div', { class: 'nt-canvas-inner' },
      el('div', { class: 'nt-session-head' }, sessionEmoji, sessionTitleEl, addTop, sessionColor),
      el('div', { class: 'nt-cats' }),
      el('button', { type: 'button', class: 'nt-add-bottom', html: `${ICON.plus}<span>New category</span>`, onclick: () => render.addCat('bottom') })));
  canvas.addEventListener('scroll', render.onCanvasScroll, { passive: true });

  /* ---- settings that live in the doc ---- */
  function setTheme(t) { doc.ui.theme = t; root.dataset.theme = t; docChanged(); }
  function setFont(k) { doc.ui.font = k; root.style.setProperty('--font', FONTS[k].stack); fontBtn.textContent = FONTS[k].label; docChanged(); }
  function setSize(n) { doc.ui.fs = n; root.style.setProperty('--fs', `${n}px`); sizeBtn.textContent = `${n}`; docChanged(); }
  function setSidebar(mode) { doc.ui.sidebar = mode; root.classList.toggle('is-rail', mode === 'rail'); sidebarBtn.setAttribute('aria-pressed', String(mode === 'open')); docChanged(); }
  function syncSettings() {
    spellBtn.classList.toggle('is-on', spell.enabled());
    spellBtn.setAttribute('aria-pressed', String(spell.enabled()));
  }
  function settingsMenu(anchor) {
    menu(anchor, [
      { label: `${spell.enabled() ? '✓ ' : ''}Spell check`, run: () => { spell.setEnabled(!spell.enabled()); syncSettings(); } },
      { label: `${spell.autocorrectOn() ? '✓ ' : ''}Autocorrect as you type`, run: () => spell.setAutocorrect(!spell.autocorrectOn()) },
      null,
      { label: `Dictionary: ${doc.spell.custom.length} added, ${doc.spell.ignore.length} ignored`, run: () => dictionaryPanel(anchor) },
    ]);
  }
  function dictionaryPanel(anchor) {
    const items = [...doc.spell.custom.map((w) => ({ label: w, hint: 'added', run: () => spell.removeWord('custom', w) })),
      ...doc.spell.ignore.map((w) => ({ label: w, hint: 'ignored', run: () => spell.removeWord('ignore', w) }))];
    if (!items.length) { toast('Right-click a marked word to add or ignore it'); return; }
    menu(anchor, [{ label: 'Click a word to remove it', disabled: true, run: () => {} }, null, ...items]);
  }

  /* ---- toolbar state ---- */
  function syncToolbar() {
    const s = stateAt();
    root.classList.toggle('in-body', !!s);
    if (!s) { for (const b of Object.values(fmt)) b.classList.remove('is-on'); return; }
    fmt.bold.classList.toggle('is-on', s.bold);
    fmt.italic.classList.toggle('is-on', s.italic);
    fmt.underline.classList.toggle('is-on', s.underline);
    fmt.strike.classList.toggle('is-on', s.strike);
    fmt.code.classList.toggle('is-on', s.code);
    fmt.left.classList.toggle('is-on', s.align === 'left');
    fmt.center.classList.toggle('is-on', s.align === 'center');
    fmt.right.classList.toggle('is-on', s.align === 'right');
    fmt.ul.classList.toggle('is-on', s.list === 'ul');
    fmt.ol.classList.toggle('is-on', s.list === 'ol');
    fmt.todo.classList.toggle('is-on', s.list === 'todo');
  }
  function syncUndoButtons() {
    undoBtn.disabled = !ctx.history.canUndo;
    redoBtn.disabled = !ctx.history.canRedo;
  }
  let toolbarFrame = 0;
  const onSelection = () => { if (!toolbarFrame) toolbarFrame = requestAnimationFrame(() => { toolbarFrame = 0; syncToolbar(); }); };
  document.addEventListener('selectionchange', onSelection);

  let lastBody = null;
  canvas.addEventListener('focusin', (e) => { const b = e.target.closest('.nt-body'); if (b) lastBody = b; });
  function withBody(fn) {
    const active = document.activeElement && document.activeElement.closest && document.activeElement.closest('.nt-body');
    const body = active || (lastBody && lastBody.isConnected ? lastBody : null) || canvas.querySelector('.nt-body');
    if (!body) return;
    if (document.activeElement !== body) { body.focus({ preventScroll: true }); if (!window.getSelection().rangeCount || !body.contains(window.getSelection().anchorNode)) caretToEnd(body); }
    fn(body);
  }

  /* ---- changes and saving ---- */
  let dirty = false;
  let inFlight = false;
  let pendingSave = false;
  let lastSaved = '';
  let saveTimer = 0;
  let retryTimer = 0;

  function changed(body) {
    const catId = body.dataset.cat;
    const s = ctx.session;
    const cat = catOf(s, catId);
    if (!cat) return;
    const html = serialize(body);
    if (html !== cat.body) {
      cat.body = html;
      touch(s, cat);
      body.dataset.rev = cat.updated;
      docChanged();
    }
    spell.rescan(body);
    searchRefresh();
  }
  const searchRefresh = debounce(() => search.refresh(), 400);

  function docChanged() {
    dirty = true;
    setStatus('EDITING…', 'saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DEBOUNCE);
  }

  function flushBodies() {
    for (const body of canvas.querySelectorAll('.nt-body')) {
      const cat = catOf(ctx.session, body.dataset.cat);
      if (!cat) continue;
      const html = serialize(body);
      if (html !== cat.body) { cat.body = html; touch(ctx.session, cat); body.dataset.rev = cat.updated; dirty = true; }
    }
  }

  function setStatus(text, kind) {
    status.textContent = text;
    status.classList.toggle('is-saving', kind === 'saving');
    status.classList.toggle('is-error', kind === 'error');
    if (onStatus) onStatus(text, kind);
  }
  const clock = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };

  async function save() {
    clearTimeout(saveTimer);
    if (!currentToken) return;
    if (inFlight) { pendingSave = true; return; }
    flushBodies();
    const body = JSON.stringify(doc);
    if (body === lastSaved) { dirty = false; setStatus(status.textContent.replace('EDITING…', 'SAVED'), null); return; }
    inFlight = true;
    setStatus('SAVING…', 'saving');
    try {
      const res = await fetch('/api/notes/save', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: currentToken, doc, baseRev: rev }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { currentToken = null; setStatus('SESSION EXPIRED — REOPEN TO SAVE', 'error'); onLocked && onLocked(); return; }
      if (res.status === 409) {
        // Someone else saved first. Merge, re-render, and go again on
        // their rev.
        const { merge } = await import('./state.js');
        const merged = merge(doc, data.doc, loadedStamps);
        adopt(merged, data.rev);
        pendingSave = true;
        toast('Merged changes from another device');
        return;
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      lastSaved = body;
      dirty = false;
      rev = data.rev;
      for (const s of doc.sessions) loadedStamps.set(s.id, s.updated);
      if (data.token) { currentToken = data.token; onToken && onToken(data.token); }
      setStatus(`SAVED ${clock(data.savedAt)}`.trim(), null);
    } catch (err) {
      console.warn('notes: save failed', err);
      setStatus('NOT SAVED — RETRYING', 'error');
      clearTimeout(retryTimer);
      retryTimer = setTimeout(save, 4000);
    } finally {
      inFlight = false;
      if (pendingSave) { pendingSave = false; save(); }
    }
  }

  /* Take a document from the server. Keeps the caret where it is if the
   * body it is in did not change. */
  function adopt(next, nextRev) {
    const activeBody = document.activeElement && document.activeElement.closest && document.activeElement.closest('.nt-body');
    const sel = activeBody ? capture(activeBody).sel : null;
    const activeId = activeBody ? activeBody.dataset.cat : null;
    Object.assign(doc, next);
    for (const k of Object.keys(doc)) if (!(k in next)) delete doc[k];
    rev = nextRev;
    for (const s of doc.sessions) loadedStamps.set(s.id, s.updated);
    ctx.history.clear();
    applyUi();
    render.renderAll();
    if (activeId) { const b = ctx.bodyFor(activeId); if (b) { b.focus({ preventScroll: true }); restoreSelection(b, sel); } }
  }

  /* When the tab comes back, ask whether the store moved on. */
  async function refresh() {
    if (!currentToken || dirty || inFlight) return;
    try {
      const res = await fetch('/api/notes/unlock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: currentToken }) });
      if (res.status === 401) { currentToken = null; onLocked && onLocked(); return; }
      if (!res.ok) return;
      const data = await res.json();
      if (data.format !== 'json' || Number(data.rev) <= rev) return;
      adopt(normalize(data.content), data.rev);
      lastSaved = JSON.stringify(doc);
      setStatus(`SAVED ${clock(data.savedAt)} · UPDATED`.trim(), null);
    } catch { /* offline; the next save will say so */ }
  }
  const onVisible = () => { if (document.visibilityState === 'visible') refresh(); else flush(); };
  document.addEventListener('visibilitychange', onVisible);

  /* A close or a tab-away should not sit on an unsaved second. sendBeacon is
   * the only request the browser promises to finish after the page goes. */
  function flush() {
    if (!currentToken) return;
    flushBodies();
    const body = JSON.stringify(doc);
    if (body === lastSaved) return;
    clearTimeout(saveTimer);
    if (inFlight) return;
    const blob = new Blob([JSON.stringify({ token: currentToken, doc, baseRev: rev })], { type: 'application/json' });
    if (navigator.sendBeacon && navigator.sendBeacon('/api/notes/save', blob)) { lastSaved = body; dirty = false; }
    else save();
  }
  window.addEventListener('pagehide', flush);

  async function uploadAsset(blob, type) {
    const data = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1]);
      fr.onerror = () => reject(new Error('could not read the image'));
      fr.readAsDataURL(blob);
    });
    const res = await fetch('/api/notes/asset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: currentToken, type, data }) });
    const out = await res.json().catch(() => ({}));
    if (res.status === 401) { currentToken = null; onLocked && onLocked(); throw new Error('session expired'); }
    if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
    return out.key;
  }

  function flashCorrection(node, start, length) {
    if (typeof Highlight !== 'function' || !CSS.highlights) return;
    try {
      const r = new Range();
      r.setStart(node, start);
      r.setEnd(node, start + length);
      CSS.highlights.set('nt-fix', new Highlight(r));
      setTimeout(() => CSS.highlights.delete('nt-fix'), 1400);
    } catch { /* node moved */ }
  }

  function scrollCaretIntoView(body) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const view = canvas.getBoundingClientRect();
    if (rect.height && (rect.top < view.top + 60 || rect.bottom > view.bottom - 60)) canvas.scrollBy({ top: rect.top - view.top - view.height / 2 });
    void body;
  }

  /* ---- keys that are not about typing ---- */
  function onRootKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    const inBody = e.target.closest && e.target.closest('.nt-body');
    const inField = e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]');
    if (mod && e.key.toLowerCase() === 'f' && !e.shiftKey) { e.preventDefault(); search.focus(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    if (mod && e.key === '\\') { e.preventDefault(); setSidebar(doc.ui.sidebar === 'open' ? 'rail' : 'open'); return; }
    if (e.altKey && e.key.toLowerCase() === 'n' && !mod) { e.preventDefault(); render.addCat('bottom'); return; }
    if (mod && e.key.toLowerCase() === 'z' && !inBody && !inField) { e.preventDefault(); if (e.shiftKey) ctx.history.redo(); else ctx.history.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y' && !inBody && !inField) { e.preventDefault(); ctx.history.redo(); }
  }
  root.addEventListener('keydown', onRootKey);

  /* ---- first paint ---- */
  function applyUi() {
    root.dataset.theme = doc.ui.theme;
    root.style.setProperty('--font', FONTS[doc.ui.font].stack);
    root.style.setProperty('--fs', `${doc.ui.fs}px`);
    fontBtn.textContent = FONTS[doc.ui.font].label;
    sizeBtn.textContent = String(doc.ui.fs);
    root.classList.toggle('is-rail', doc.ui.sidebar === 'rail');
    sidebarBtn.setAttribute('aria-pressed', String(doc.ui.sidebar === 'open'));
    syncSettings();
  }
  applyUi();
  render.renderAll();
  syncUndoButtons();
  lastSaved = migrated ? '' : JSON.stringify(doc);
  if (migrated) {
    setStatus('MIGRATED — SAVING…', 'saving');
    toast('Your notes were moved into the new editor. The old copy is kept on the server.');
    dirty = true;
    save();
  } else {
    setStatus(payload.savedAt ? `SAVED ${clock(payload.savedAt)}` : 'NOT SAVED YET', null);
  }
  // Focus the first body so typing can start.
  const first = canvas.querySelector('.nt-body');
  if (first) { first.focus({ preventScroll: true }); caretToEnd(first); }

  return {
    flush,
    save,
    get doc() { return doc; },
    unmount() {
      flush();
      clearTimeout(saveTimer);
      clearTimeout(retryTimer);
      document.removeEventListener('selectionchange', onSelection);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', flush);
      closePanel();
      if (window.CSS && CSS.highlights) { CSS.highlights.delete('nt-spell'); CSS.highlights.delete('nt-search'); CSS.highlights.delete('nt-search-current'); CSS.highlights.delete('nt-fix'); }
      root.remove();
    },
  };
}

/* The stylesheet is loaded when the app is, not with the page. */
let cssReady = null;
function ensureCss() {
  if (cssReady) return cssReady;
  cssReady = new Promise((resolve) => {
    if (document.querySelector('link[data-notes-css]')) { resolve(); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/notes/notes.css?v=1';
    link.dataset.notesCss = '1';
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.append(link);
  });
  return cssReady;
}

export { emptyDoc, escapeHtml };
