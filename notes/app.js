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
import { normalize, migrateHtml, demoDoc, activeSession, catOf, touch, restore as restoreSession, FONTS, SIZES, emptyDoc } from './state.js';
import { initEditor, capture, format, align, toggleList, indent, stateAt, insertInline, insertBlockAfterCaret, transact as editorTransact } from './editor.js';
import * as chips from './chips.js';
import * as tables from './table.js';
import * as nodes from './nodes.js';
import * as emoji from './emoji.js';
import * as color from './color.js';
import * as spell from './spell.js';
import * as search from './search.js';
import * as slash from './slash.js';
import * as render from './render.js';
import * as dictate from './dictate.js';
import { setRoot, toast, confirm, menu, panel, currentPanel, initTooltips, closePanel, ICON } from './ui.js';
import { restoreSelection } from './dom.js';

/* HOW OFTEN A SAVE MAY COST A NETWORK WRITE.
 *
 * The debounce was 1200ms, which is the right number for a save that costs
 * nothing and the wrong one for a save that costs a metered blob write. At
 * 1.2s a pause, sustained typing produced about fifty saves a minute; on
 * 2026-09-08 that spent a month's Vercel Blob allowance and locked the live
 * store out.
 *
 * Two numbers now. SAVE_DEBOUNCE is how long typing has to stop before a save
 * is worth making -- five seconds, which still lands the save well inside the
 * time it takes to look away. SAVE_MIN_GAP is a floor UNDER SUSTAINED TYPING:
 * a save is never scheduled sooner than fifteen seconds after the last one
 * went out, so an hour of unbroken writing costs 240 saves rather than 3000.
 * The floor is a floor on the AUTOMATIC path only.
 *
 * WHAT THIS COSTS is at most fifteen seconds of typing, and only if the tab
 * dies without telling anyone. Everything that knows the document is about to
 * stop being watched already saves immediately and is unaffected: Ctrl+S,
 * flush() on pagehide and on the tab going to the background (sendBeacon,
 * which the browser promises to finish), and the retry after a failure.
 */
const SAVE_DEBOUNCE = 5000;
const SAVE_MIN_GAP = 15000;

/* And a failed save backs OFF rather than hammering. A store that is refusing
 * writes -- out of quota, out of network -- was being retried every four
 * seconds for as long as the tab stayed open, which is the one situation
 * where a fixed retry makes the problem it is reacting to worse. */
const RETRY_FIRST = 4000;
const RETRY_MAX = 60000;

export async function mount(container, { payload, token, onToken, onLocked, onStatus }) {
  await ensureCss();

  /* ---- the document ---- */
  /* THE DEMO IS THE SAME APP WITH NOTHING BEHIND IT. `demo` is not a reduced
     mode with features switched off -- everything works, including images --
     it is the save loop and only the save loop that is absent. There is no
     token, so no request to /api/notes/* can be made or would be answered,
     which is also the whole of the answer to "can a visitor reach, spam or
     see the real notes": there is nothing here to reach them with. The
     document is a local variable and dies with the overlay. */
  let doc;
  let migrated = false;
  const demo = payload.format === 'demo';
  if (demo) doc = demoDoc();
  else if (payload.format === 'json') doc = normalize(payload.content);
  else { doc = migrateHtml(payload.content); migrated = true; }
  let rev = Number(payload.rev) || 0;
  let currentToken = token;
  const loadedStamps = new Map(doc.sessions.map((s) => [s.id, s.updated]));

  /* ---- the layout ---- */
  const root = el('div', { class: `nt-app ${demo ? 'is-demo' : ''}`, 'data-theme': doc.ui.theme });
  const header = el('header', { class: 'nt-header' });
  const sidebar = el('aside', { class: 'nt-sidebar', 'aria-label': 'Categories' });
  const canvas = el('div', { class: 'nt-canvas', tabindex: '-1' });
  const main = el('main', { class: 'nt-main' }, canvas);
  /* The sidebar is a column of the WINDOW, not of the area under a bar: it
     reaches the top of the screen and the header spans only what is beside
     it. That is what puts the session's name, its emoji and its colour at the
     very top-left, and it is why the sidebar toggle and the type controls
     moved into the header's middle group -- there is no left group any more
     for them to sit in. */
  /* The tab that folds the sidebar away. It sits OUTSIDE the sidebar because
     the sidebar clips its own overflow, and render.syncTab() keeps it level
     with the archive's top edge -- it is a tab on that divider, not a control
     floating on an edge. */
  const sbTab = el('button', {
    type: 'button', class: 'nt-sb-tab', 'aria-label': 'Collapse sidebar', 'data-tip': 'Collapse sidebar', 'data-tip-pos': 'right',
    html: ICON.chevronLeft,
    onclick: () => setSidebar(doc.ui.sidebar === 'open' ? 'rail' : 'open'),
  });
  root.append(el('div', { class: 'nt-frame' }, sidebar, el('div', { class: 'nt-col' }, header, main)), sbTab);
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
    demo,
    // In the demo an image has nowhere to be uploaded to, so it is kept in
    // memory under the same kind of key and resolved by hydrate(). It works
    // exactly like the real thing until the overlay closes, and then it is
    // gone with everything else.
    demoAssets: new Map(),
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
    chips, emoji, slash, spell, search, dictate, nodes,
    tables: { insert: (b) => tables.insertTable(b) },
    editor: { transact: editorTransact, insertBlockAfterCaret },
    color: { open: color.openColor },
    catTitle: (id) => { const c = catOf(activeSession(doc), id); return c ? c.title : 'Notes'; },
    scrollToCat: (id) => render.jumpTo(id),
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
  nodes.initNodes(ctx);
  tables.initTables(ctx);
  chips.initChips(ctx);
  emoji.initEmoji(ctx);
  color.initColor(ctx);
  slash.initSlash(ctx);
  spell.initSpell(ctx);
  dictate.initDictate(ctx);

  /* ---- header ---- */
  const btn = (cls, tip, icon, onClick, extra = {}) => el('button', { type: 'button', class: `nt-icon-btn ${cls}`, 'data-tip': tip, html: icon, 'aria-label': tip, onclick: onClick, ...extra });
  const sep = () => el('span', { class: 'nt-sep' });

  /* No sidebar toggle up here any more. The chevron tab is ON the sidebar's
     own edge, welded to the archive, which is where a control that folds the
     sidebar belongs -- and this one sat inside the group that is supposed to
     be the formatting controls for the text below it. Ctrl+\ still does it. */
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
  /* WHICH OF THESE CARRY A TOOLTIP IS A DECISION, NOT AN OVERSIGHT.
     A tip that names what everyone already knows is noise that trains you to
     ignore the ones that say something -- so bold, italic, underline, the
     three alignments and undo/redo carry none. Strikethrough, the auto list
     (our own word for it), the spell check and the nodes menu do, because
     none of those four is obvious from its mark alone.
     The keystrokes used to ride along in every one of these. They live in the
     information panel now, in one place, where they can be read rather than
     hunted for one hover at a time. */
  const fmt = {
    bold: btn('nt-fmt', null, ICON.bold, () => format('bold'), { 'aria-label': 'Bold' }),
    italic: btn('nt-fmt', null, ICON.italic, () => format('italic'), { 'aria-label': 'Italic' }),
    underline: btn('nt-fmt', null, ICON.underline, () => format('underline'), { 'aria-label': 'Underline' }),
    strike: btn('nt-fmt', 'Strikethrough', ICON.strike, () => format('strikeThrough')),
    /* PARKED, not deleted. The button is built so syncToolbar keeps working
       and so bringing it back is one entry in the header's append list, but
       it is not in the header: an inline-code run inside a note is a thing
       almost nothing here wanted, and the control read as unexplained.
       Ctrl+E and the slash menu still make one. */
    code: btn('nt-fmt', null, ICON.code, () => format('code'), { 'aria-label': 'Code' }),
    left: btn('nt-fmt', null, ICON.alignLeft, () => withBody((b) => align(b, 'left')), { 'aria-label': 'Align left' }),
    center: btn('nt-fmt', null, ICON.alignCenter, () => withBody((b) => align(b, 'center')), { 'aria-label': 'Align centre' }),
    right: btn('nt-fmt', null, ICON.alignRight, () => withBody((b) => align(b, 'right')), { 'aria-label': 'Align right' }),
    /* ONE list button. Numbered and to-do are still a keystroke and still in
       the slash menu; three buttons for one idea was three buttons. */
    ul: btn('nt-fmt nt-fmt-list', 'Autolist', ICON.autolist, () => withBody((b) => toggleList(b, 'ul'))),
    /* A TABLE CARRIES A TIP by the rule three comments up: the mark is a
       grid, which says "table" and says nothing about the three-by-three it
       actually makes or that the rows and columns are added from the table
       itself afterwards. */
    table: btn('nt-fmt nt-fmt-table', 'Table', ICON.table, () => withBody((b) => tables.insertTable(b))),
  };
  for (const b of Object.values(fmt)) b.addEventListener('mousedown', (e) => e.preventDefault());
  const spellBtn = btn('nt-spell-btn', 'Spellcheck', ICON.spell, () => { spell.setEnabled(!spell.enabled()); syncSettings(); });
  spellBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); settingsMenu(spellBtn); });
  /* A SPLIT BUTTON. The left half inserts the kind you used last and is the
     handle you DRAG a new node out of; the chevron opens the list. The mark on
     it is that kind's own mark in that kind's own colour, so the control says
     which node it is about to make before you press it. */
  const nodeMark = el('span', { class: 'nt-node-mark' });
  const nodeMain = el('button', { type: 'button', class: 'nt-node-main', 'data-tip': 'Nodes · drag one out', 'aria-label': 'Insert node' }, nodeMark);
  const nodeArrow = el('button', { type: 'button', class: 'nt-node-arrow', 'data-tip': 'Choose a node', 'aria-label': 'Choose a node type', html: ICON.chevron });
  const nodeBtn = el('div', { class: 'nt-node-btn' }, nodeMain, nodeArrow);
  const syncNode = () => {
    const k = chips.nodeKind(doc.ui.node || 'link');
    nodeMark.innerHTML = k.icon();
    nodeMark.style.color = k.color;
    nodeMain.setAttribute('data-tip', `${k.label} · drag one out`);
  };
  nodeMain.addEventListener('click', () => { if (!nodeMain.dataset.dragged) withBody((b) => chips.insertNode(b, chips.lastKind())); syncNode(); });
  nodeMain.addEventListener('pointerdown', (e) => chips.dragNewNode(e, chips.lastKind()));
  nodeArrow.addEventListener('click', () => chips.nodeMenu(nodeArrow, (fn) => { withBody(fn); setTimeout(syncNode, 0); }));
  for (const b of [nodeMain, nodeArrow]) b.addEventListener('mousedown', (e) => e.preventDefault());
  const undoBtn = btn('nt-undo', null, ICON.undo, () => ctx.history.undo(), { 'aria-label': 'Undo' });
  const redoBtn = btn('nt-redo', null, ICON.redo, () => ctx.history.redo(), { 'aria-label': 'Redo' });
  for (const b of [undoBtn, redoBtn]) b.addEventListener('mousedown', (e) => e.preventDefault());
  const infoBtn = btn('nt-info', null, ICON.info, () => toggleHelp(), { 'aria-label': 'Keys and tips', 'aria-haspopup': 'dialog' });
  const themeBtn = btn('nt-theme', null, `${ICON.sun}${ICON.moon}`, () => setTheme(doc.ui.theme === 'dark' ? 'light' : 'dark'), { 'aria-label': 'Light / dark' });
  const status = el('span', { class: 'nt-status', role: 'status', 'aria-live': 'polite' });
  const closeBtn = btn('nt-close', null, ICON.close, () => container.dispatchEvent(new CustomEvent('notes:close', { bubbles: true })), { 'aria-label': 'Close' });
  const searchMount = el('div', { class: 'nt-header-search' });
  /* UNDO AND REDO LIVE IN THE INFORMATION PANEL, not in the header. They are
     the two controls almost nobody reaches for with a pointer -- Ctrl+Z is
     the whole of how they are used -- so they were two permanent slots above
     the text paying for a gesture that never happens. In the panel they are
     the row that names the keystroke AND the button that does it, which is
     also what the Widgets section is for: the rows in it are not only
     descriptions. */
  header.append(
    el('div', { class: 'nt-header-left' }, searchMount),
    el('div', { class: 'nt-header-mid' }, fontBtn, sizeBtn, sep(), fmt.bold, fmt.italic, fmt.underline, fmt.strike, sep(), fmt.left, fmt.center, fmt.right, sep(), spellBtn, fmt.ul, nodeBtn, fmt.table),
    el('div', { class: 'nt-header-right' }, status, infoBtn, themeBtn, closeBtn));
  search.initSearch(ctx, searchMount);
  wireHelp(infoBtn);

  /* ---- sidebar ---- */
  /* THE BADGE IS TWO CONTROLS ON ONE TARGET, split by gesture rather than by
     area. Resting on it opens the sessions; pressing it folds the outliner.
     That pairing is why it can be the only thing in the corner: the sessions
     are what you want to SEE from here and folding is what you want to DO,
     and neither needs a second button beside the name.
     The press closes the popup the hover opened -- leaving it up over a
     sidebar that is sliding away reads as a control that did two things. */
  const sessionBtn = el('button', {
    type: 'button', class: 'nt-session-btn', 'aria-label': 'Sessions · click to fold the outliner',
    onclick: () => { closePanel(); setSidebar(doc.ui.sidebar === 'open' ? 'rail' : 'open'); },
  });
  const sessionTitle = el('span', { class: 'nt-sidebar-session-title' });
  render.wireInlineTitle(sessionTitle, {
    get: () => ctx.session.title,
    set: (t) => {
      const s = ctx.session;
      const clean = t.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Session';
      if (clean === s.title) return;
      s.title = clean;
      touch(s);
      docChanged();
      render.applySessionColor();
      const canvasTitle = canvas.querySelector('.nt-session-title');
      if (canvasTitle && document.activeElement !== canvasTitle) canvasTitle.textContent = clean;
    },
  });
  const openSessionColor = (anchor) => color.openColor(anchor, {
    title: 'Session colour', value: ctx.session.color,
    onChange: (c) => { const s = ctx.session; s.color = c; touch(s); docChanged(); render.applySessionColor(); },
  });
  const sessionSwatch = el('button', {
    type: 'button', class: 'nt-logo-btn', 'data-tip': 'Session colour', 'aria-label': 'Session colour',
    html: ICON.logo,
    onclick: (e) => openSessionColor(e.currentTarget),
  });
  const rows = el('div', { class: 'nt-rows', role: 'list' });
  /* The archive is welded to the list above it: one grab edge between them
     sets how the leftover height is shared, and the header's two arms fold
     into a chevron when it is closed. Both come from the app this borrows
     from, and both were missed the moment they were gone. */
  const archive = el('div', { class: 'nt-archive' },
    el('div', { class: 'nt-archive-grip', 'aria-hidden': 'true' }),
    el('button', { type: 'button', class: 'nt-archive-head', 'aria-expanded': 'false',
      /* syncTab UNCONDITIONALLY. Only the open branch used to reach it, via
         renderSidebar, so folding the archive left the collapse tab hanging
         where the archive's top edge had been -- the one control that is
         supposed to be welded to that edge, unwelded by the one action that
         moves it furthest. */
      /* AND THE FOLD IS SAVED. The height this thing was dragged to has been
         saved since it was built (ui.archSplit), so leaving it open and
         coming back to it shut was the split being honoured for an archive
         nobody could see. It is one flag and it belongs beside the other. */
      onclick: (e) => {
        const open = archive.classList.toggle('is-open');
        e.currentTarget.setAttribute('aria-expanded', String(open));
        doc.ui.archOpen = open;
        docChanged();
        if (open) render.renderSidebar();
        render.syncTab();
      } },
      el('span', { text: 'Archive' }), el('span', { class: 'nt-archive-count' }),
      el('span', { class: 'nt-archive-arms', html: ICON.archArms })),
    el('div', { class: 'nt-archive-list' }));
  /* THE MARK IS ON THE RIGHT AND THE LABEL IS CENTRED IN THE BUTTON, which
     is the shape these two have in the app this borrows from: the words line
     up with each other down the column and the marks line up with each other
     down the right edge, so the pair reads as one control panel rather than
     as two buttons that happen to be adjacent. Title Case for the same
     reason -- these are the names of two places, not two sentences. */
  const addBtn = el('button', {
    type: 'button', class: 'nt-add-btn',
    html: `<span>New Category</span><span class="nt-add-mark nt-add-plus">${ICON.plus}</span>`,
    onclick: () => render.addCat('auto'),
  });
  /* The sessions, as a list rather than a grid, and only where there is room
     to read one: the collapsed rail has the same thing behind its badge. */
  /* A SHEET OVER THE PANEL, NOT A SECTION IN IT. Opening it used to insert a
     block between the categories and the archive, so everything below the
     categories moved down the moment you asked what the sessions were -- the
     archive you were looking at went off the bottom, and shutting it again
     put the page back a second time. It is a small overlay now, pinned to the
     top edge of the button that opens it, lying over the New Category button
     and as much of the archive as it needs. Nothing under it moves.
     .nt-sess-dock is what it is pinned TO: the button's own box, so the two
     stay together whatever the foot's padding does. */
  const sessList = el('div', { class: 'nt-sesslist' });
  const toggleSessions = () => (root.classList.contains('show-sessions') ? closeSessionList() : openSessionList());
  const sessBtn = el('button', {
    type: 'button', class: 'nt-add-btn nt-sessions-btn', 'aria-expanded': 'false',
    html: `<span>My Sessions</span><span class="nt-add-mark nt-add-logo">${ICON.logo}</span>`,
    onclick: toggleSessions,
  });
  /* THE SAME SHEET, FROM TWO PLACES. There is one list element and it is
     MOVED into whichever dock is on screen -- above the foot button while the
     outliner is open, out to the side of the rail while it is folded. Two
     copies would be two things to keep rendered, and the one that was not
     visible would be the one that went stale. */
  const railSessBtn = el('button', {
    type: 'button', class: 'nt-rail-sessions', 'data-tip': 'My Sessions', 'data-tip-pos': 'right',
    'aria-label': 'My Sessions', 'aria-expanded': 'false', html: ICON.logo,
    onclick: toggleSessions,
  });
  const sessDock = el('div', { class: 'nt-sess-dock' }, sessList, sessBtn);
  /* THE RAIL'S DOCK LIVES OUTSIDE THE SIDEBAR, and is told where to sit --
     the same arrangement, and for the same reason, as the collapse tab: the
     sidebar clips its own overflow, so a sheet that opens to the RIGHT of a
     50px rail is a sheet you would never see. It is positioned against the
     rail button's own rect, so the two stay together through a resize. */
  const railDock = el('div', { class: 'nt-sess-dock is-rail' });
  const railed = () => root.classList.contains('is-rail');
  const liveDock = () => (railed() ? railDock : sessDock);
  function placeRailDock() {
    const b = railSessBtn.getBoundingClientRect();
    const r = root.getBoundingClientRect();
    if (!b.width) return;
    railDock.style.left = `${Math.round(b.right - r.left + 10)}px`;
    railDock.style.bottom = `${Math.round(r.bottom - b.bottom)}px`;
  }
  function openSessionList() {
    const dock = liveDock();
    dock.prepend(sessList);
    root.classList.add('show-sessions');
    sessBtn.setAttribute('aria-expanded', 'true');
    railSessBtn.setAttribute('aria-expanded', 'true');
    if (dock === railDock) placeRailDock();
    render.renderSessionList();
    // Deferred, or the pointerdown that opened it is the one that shuts it.
    setTimeout(() => document.addEventListener('pointerdown', onSessListDown, true), 0);
    window.addEventListener('resize', placeRailDock);
  }
  function closeSessionList() {
    if (!root.classList.contains('show-sessions')) return;
    root.classList.remove('show-sessions');
    sessBtn.setAttribute('aria-expanded', 'false');
    railSessBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onSessListDown, true);
    window.removeEventListener('resize', placeRailDock);
  }
  const onSessListDown = (e) => {
    if (liveDock().contains(e.target) || railSessBtn.contains(e.target) || sessBtn.contains(e.target)) return;
    closeSessionList();
  };
  ctx.closeSessionList = closeSessionList;
  const railCats = el('div', { class: 'nt-rail-cats' });
  const railSession = el('button', {
    type: 'button', class: 'nt-rail-session', 'aria-label': 'Sessions · click to unfold the outliner', 'data-tip-pos': 'right',
    onclick: () => { closePanel(); setSidebar('open'); },
  });
  /* Rest on either badge and the sessions come up. A delay, because the badge
     is in the corner every pointer crosses on its way somewhere else, and a
     panel that opens on the way past is a panel in the way. */
  /* A PRESS DISARMS THE HOVER UNTIL THE POINTER ACTUALLY MOVES AGAIN.
     Without it the popup came straight back after a fold: you press, the
     sidebar collapses under a hand that has not moved, and the badge that
     lands under the pointer is the rail's -- which is a fresh pointerenter,
     because Chrome re-evaluates hover when the layout moves even though no
     pointer moved. So the sessions reopened over a sidebar mid-slide and the
     press read as doing two things.
     Disarming on a MOVE rather than on a leave is what makes that work: the
     leave and enter the fold produces are exactly the pair that has to be
     ignored, and only a real hand can produce a pointermove. */
  let sessHover = 0;
  let sessArmed = true;
  root.addEventListener('pointermove', () => { sessArmed = true; });
  for (const badge of [sessionBtn, railSession]) {
    badge.addEventListener('pointerenter', () => { clearTimeout(sessHover); if (sessArmed) sessHover = setTimeout(() => render.openSessions(badge), 260); });
    badge.addEventListener('pointerleave', () => clearTimeout(sessHover));
    badge.addEventListener('pointerdown', () => { clearTimeout(sessHover); sessArmed = false; });
  }
  const railAdd = el('button', { type: 'button', class: 'nt-rail-add', 'data-tip': 'New Category', 'data-tip-pos': 'right', html: ICON.plus, 'aria-label': 'New Category', onclick: () => render.addCat('auto') });
  /* The rail's foot is the panel's foot in miniature and in the same order:
     New Category, then My Sessions under it. Folding the outliner should not
     take a door away, only its label. */
  sidebar.append(
    el('div', { class: 'nt-sidebar-panel' },
      el('div', { class: 'nt-sidebar-top' }, sessionBtn, sessionTitle, sessionSwatch),
      rows, archive,
      el('div', { class: 'nt-sidebar-foot' }, addBtn, sessDock)),
    el('div', { class: 'nt-rail' }, railSession, railCats, el('div', { class: 'nt-rail-foot' }, railAdd, railSessBtn)));
  root.append(railDock);

  /* Resting on either logo mark opens the session's colour, the way resting
     on the badge opens the sessions. Same delay and the same disarm-on-press
     as the badge: a panel that opens on the way past is a panel in the way. */
  let clrHover = 0;
  function wireColorHover(mark) {
    mark.addEventListener('pointerenter', () => { clearTimeout(clrHover); if (sessArmed) clrHover = setTimeout(() => openSessionColor(mark), 320); });
    mark.addEventListener('pointerleave', () => clearTimeout(clrHover));
    mark.addEventListener('pointerdown', () => { clearTimeout(clrHover); sessArmed = false; });
  }
  wireColorHover(sessionSwatch);

  /* ---- canvas ---- */
  const sessionEmoji = el('button', { type: 'button', class: 'nt-session-emoji', 'aria-label': 'Session emoji', onclick: (e) => emoji.openFull(e.currentTarget, (u) => { const s = ctx.session; s.emoji = u; touch(s); docChanged(); render.renderAll(); }) });
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
  const sessionColor = el('button', { type: 'button', class: 'nt-session-color nt-logo-btn', 'data-tip': 'Session colour', 'aria-label': 'Session colour', html: ICON.logo, onclick: (e) => color.openColor(e.currentTarget, { title: 'Session colour', value: ctx.session.color, onChange: (c) => { const s = ctx.session; s.color = c; touch(s); docChanged(); render.applySessionColor(); } }) });
  wireColorHover(sessionColor);
  const addTop = btn('nt-session-addtop', 'Add a category at the top', ICON.plus, () => render.addCat('top'));
  canvas.append(
    el('div', { class: 'nt-canvas-inner' },
      el('div', { class: 'nt-session-head' }, sessionEmoji, sessionTitleEl, addTop, sessionColor),
      demo ? el('p', { class: 'nt-demo-note', html: 'This is a <strong>live sandbox</strong> of the notes app \u2014 type, dictate, drag, undo, break it. Nothing is saved, and closing this window throws it all away.' }) : null,
      el('div', { class: 'nt-cats' }),
      el('button', { type: 'button', class: 'nt-add-bottom', html: `${ICON.plus}<span>New Category</span>`, onclick: () => render.addCat('bottom') })));
  canvas.addEventListener('scroll', render.onCanvasScroll, { passive: true });

  /* ---- settings that live in the doc ---- */
  /* The tiers are derived against the theme's own backgrounds -- lighter than
     a dark box, darker than a light one -- so flipping the theme has to derive
     them again or every category keeps colours computed for the other one. */
  function setTheme(t) { doc.ui.theme = t; root.dataset.theme = t; render.repaintColors(); docChanged(); }
  function setFont(k) { doc.ui.font = k; root.style.setProperty('--font', FONTS[k].stack); fontBtn.textContent = FONTS[k].label; docChanged(); }
  function setSize(n) { doc.ui.fs = n; root.style.setProperty('--fs', `${n}px`); sizeBtn.textContent = `${n}`; docChanged(); }
  function setSidebar(mode) {
    doc.ui.sidebar = mode;
    root.classList.toggle('is-rail', mode === 'rail');
    /* Folding the outliner takes the sessions sheet with it. It is pinned to
       a button that is about to be replaced by a different one on the other
       side of the fold, and re-homing a live overlay mid-slide is a worse
       answer than shutting it. */
    closeSessionList();
    const tab = root.querySelector('.nt-sb-tab');
    if (tab) {
      const label = mode === 'open' ? 'Collapse sidebar' : 'Expand sidebar';
      tab.setAttribute('aria-label', label);
      tab.setAttribute('data-tip', label);
    }
    // The sidebar's width animates, so the tab is level again a beat later.
    setTimeout(() => render.syncTab(), 260);
    docChanged();
  }
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

  /* ---- the information panel ----------------------------------------------
   * ONE PLACE FOR EVERY KEYSTROKE, which is what let the tooltips stop
   * carrying them. A keybind that only exists inside a tooltip can only be
   * found by hovering the control you were already going to click, which is
   * the one moment you do not need to be told about the shortcut; and thirty
   * of them, one per button, is thirty places for the same fact to go stale.
   *
   * Grouped by WHERE, because that is how you look for one: things that work
   * anywhere, then the outliner, the canvas and the text itself. Nothing in
   * here explains bold. */
  /* A row is [label, keystroke] or [label, keystroke, node]. The third makes
     it a WIDGET: the real control goes in at the right end, so the panel is
     somewhere you can act rather than only read. */
  const HELP = [
    ['Widgets', [
      ['Undo', 'Ctrl+Z', () => undoBtn],
      ['Redo', 'Ctrl+Shift+Z', () => redoBtn],
    ]],
    ['Everywhere', [
      ['Search', 'Ctrl+F'],
      ['Save now', 'Ctrl+S'],
      ['Fold the outliner', 'Ctrl+\\'],
      ['New category', 'Alt+N'],
      ['Dictate here', 'Ctrl+Shift+M'],
      ['Back out of anything', 'Esc'],
    ]],
    ['Outliner', [
      ['See the sessions', 'Hover the badge'],
      ['Fold the outliner', 'Press the badge'],
      ['Jump to a category', 'Click its row'],
      ['Rename in place', 'Double-click the name'],
      ['Reorder', 'Drag a row'],
      ['Pick several', 'Ctrl+click · Shift+click'],
      ['Act on the pick', 'Its own X, dot or drag'],
      ['Drop the pick', 'Esc, or click one row'],
      ['Resize the archive', 'Drag the line above it'],
    ]],
    ['Canvas', [
      ['Fold a category', 'Click its chevron'],
      ['Fold or unfold ALL', 'Shift+click a chevron'],
      ['Move a category', 'Alt+↑ / Alt+↓ in its title'],
      ['Leave the title, start typing', 'Enter'],
      ['Tick a to-do', 'Click the box · Ctrl+Enter'],
    ]],
    ['Editor', [
      ['Bold · italic · underline', 'Ctrl+B / I / U'],
      ['Strikethrough', 'Ctrl+Shift+D'],
      ['Inline code', 'Ctrl+E'],
      ['Align left · centre', 'Ctrl+Shift+L / E'],
      /* Right has no key on purpose: Ctrl+Shift+R is the browser's hard
         reload, and a page must not take that. See editor.js. */
      ['Align right', 'The toolbar button'],
      ['Auto list', 'Ctrl+Shift+8'],
      ['Numbered · to-do', 'Ctrl+Shift+7 / 9'],
      ['Indent / outdent', 'Tab / Shift+Tab'],
      ['Heading · plain', 'Ctrl+Alt+1 / 0'],
      ['Link', 'Ctrl+K · or paste a URL'],
      ['Emoji · commands', 'Type : · type /'],
      ['Line break, no new block', 'Shift+Enter'],
    ]],
  ];

  let helpHandle = null;
  let helpTimer = 0;
  let helpPinned = false;

  function helpCard() {
    /* The widget rows take the REAL buttons, not copies: they carry their own
       handlers and their own disabled state, and a copy would be a second
       thing for syncUndoButtons to find. Rebuilding the card detaches them
       and re-appends them next time, which a plain element survives. */
    return el('div', { class: 'nt-help' },
      el('div', { class: 'nt-help-title', text: 'Keys and tips' }),
      ...HELP.map(([name, rows]) => el('div', { class: 'nt-help-section' },
        el('div', { class: 'nt-help-head', text: name }),
        ...rows.map(([k, v, widget]) => el('div', { class: `nt-help-row ${widget ? 'is-widget' : ''}` },
          el('span', { class: 'nt-help-key', text: k }),
          el('span', { class: 'nt-help-val', text: v }),
          widget ? widget() : null)))));
  }

  function openHelp(anchor, pinned) {
    clearTimeout(helpTimer);
    if (helpHandle && currentPanel() === helpHandle) { helpPinned = helpPinned || pinned; return; }
    helpPinned = !!pinned;
    helpHandle = panel({
      className: 'nt-help-panel', content: helpCard(), anchor, align: 'right',
      onClose: () => { helpHandle = null; helpPinned = false; },
    });
    // Reading it means having the pointer in it, so being in it holds it open.
    helpHandle.el.addEventListener('pointerenter', () => clearTimeout(helpTimer));
    helpHandle.el.addEventListener('pointerleave', () => { if (!helpPinned) helpTimer = setTimeout(closeHelp, 220); });
  }
  function closeHelp() {
    clearTimeout(helpTimer);
    if (!helpHandle) return;
    // Something else may have taken the one open panel since; only close ours.
    if (currentPanel() === helpHandle) closePanel();
    else helpHandle = null;
  }
  function toggleHelp() {
    clearTimeout(helpTimer);
    if (!helpHandle) { openHelp(infoBtn, true); return; }
    if (helpPinned) closeHelp(); else helpPinned = true;
  }
  function wireHelp(anchor) {
    anchor.addEventListener('pointerenter', () => { clearTimeout(helpTimer); helpTimer = setTimeout(() => openHelp(anchor, false), 180); });
    anchor.addEventListener('pointerleave', () => { clearTimeout(helpTimer); if (!helpPinned) helpTimer = setTimeout(closeHelp, 220); });
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
    fmt.ul.classList.toggle('is-on', !!s.list);
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
  let lastSaveAt = 0;      // when the last request went out, for SAVE_MIN_GAP
  let retryIn = RETRY_FIRST;

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
    if (demo) { setStatus('SANDBOX — NOT SAVED', null); return; }
    setStatus('EDITING…', 'saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, Math.max(SAVE_DEBOUNCE, lastSaveAt + SAVE_MIN_GAP - Date.now()));
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
    if (demo) { dirty = false; setStatus('SANDBOX — NOT SAVED', null); return; }
    if (!currentToken) return;
    if (inFlight) { pendingSave = true; return; }
    flushBodies();
    const body = JSON.stringify(doc);
    if (body === lastSaved) { dirty = false; setStatus(status.textContent.replace('EDITING…', 'SAVED'), null); return; }
    inFlight = true;
    lastSaveAt = Date.now();
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
      retryIn = RETRY_FIRST;
      setStatus(`SAVED ${clock(data.savedAt)}`.trim(), null);
    } catch (err) {
      console.warn('notes: save failed', err);
      setStatus('NOT SAVED — RETRYING', 'error');
      clearTimeout(retryTimer);
      retryTimer = setTimeout(save, retryIn);
      retryIn = Math.min(retryIn * 2, RETRY_MAX);
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
    if (demo || !currentToken || dirty || inFlight) return;
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
    if (demo || !currentToken) return;
    flushBodies();
    const body = JSON.stringify(doc);
    if (body === lastSaved) return;
    clearTimeout(saveTimer);
    if (inFlight) return;
    const blob = new Blob([JSON.stringify({ token: currentToken, doc, baseRev: rev })], { type: 'application/json' });
    if (navigator.sendBeacon && navigator.sendBeacon('/api/notes/save', blob)) { lastSaved = body; dirty = false; lastSaveAt = Date.now(); }
    else save();
  }
  window.addEventListener('pagehide', flush);

  async function uploadAsset(blob, type) {
    if (demo) {
      const key = `${'d'.repeat(63)}${ctx.demoAssets.size % 10}.${type === 'image/png' ? 'png' : 'webp'}`;
      ctx.demoAssets.set(key, URL.createObjectURL(blob));
      return key;
    }
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
    const t = e.target;
    const inBody = t && t.closest && t.closest('.nt-body');
    const inField = t && t.closest && t.closest('input, textarea, [contenteditable="true"]');
    /* Escape is a ladder and these are two more rungs on it: the sessions
       sheet and the information panel each take the key that closed them and
       stop it, so one press never also reaches the <dialog> behind. */
    if (e.key === 'Escape' && root.classList.contains('show-sessions')) { e.preventDefault(); e.stopPropagation(); closeSessionList(); return; }
    if (e.key === 'Escape' && helpHandle) { e.preventDefault(); e.stopPropagation(); closeHelp(); return; }
    if (e.key === 'Escape' && render.pickCount()) { e.preventDefault(); e.stopPropagation(); render.clearPicks(); return; }
    if (mod && e.key.toLowerCase() === 'f' && !e.shiftKey) { e.preventDefault(); search.focus(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    if (mod && e.key === '\\') { e.preventDefault(); setSidebar(doc.ui.sidebar === 'open' ? 'rail' : 'open'); return; }
    if (e.altKey && e.key.toLowerCase() === 'n' && !mod) { e.preventDefault(); render.addCat('auto'); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); dictate.toggleHere(); return; }
    if (mod && e.key.toLowerCase() === 'z' && !inBody && !inField) { e.preventDefault(); if (e.shiftKey) ctx.history.redo(); else ctx.history.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y' && !inBody && !inField) { e.preventDefault(); ctx.history.redo(); }
  }
  /* ON THE DOCUMENT, not on the app's own root. A keydown bubbles from
     whatever has focus, and focus is regularly NOT inside the app -- the
     dialog itself, or <body> after something blurred. The app's root is not
     an ancestor of those, so every shortcut here silently stopped working
     the moment you closed a field: Ctrl+F did nothing, and the Escape that
     followed it went to the <dialog> and shut the notes. */
  const onDocKey = (e) => { if (root.isConnected) onRootKey(e); };
  document.addEventListener('keydown', onDocKey);

  /* ---- first paint ---- */
  function applyUi() {
    root.dataset.theme = doc.ui.theme;
    root.style.setProperty('--font', FONTS[doc.ui.font].stack);
    root.style.setProperty('--fs', `${doc.ui.fs}px`);
    fontBtn.textContent = FONTS[doc.ui.font].label;
    sizeBtn.textContent = String(doc.ui.fs);
    root.classList.toggle('is-rail', doc.ui.sidebar === 'rail');
    render.applySplit();
    /* The archive comes back the way it was left, open or shut. applySplit
       above only decides how TALL it is; without this it was always shut, so
       the height was restored for something folded away. syncTab because the
       collapse tab is welded to the archive's top edge and that edge is in a
       different place depending on this line. */
    const arch = sidebar.querySelector('.nt-archive');
    if (arch) {
      arch.classList.toggle('is-open', doc.ui.archOpen);
      const head = arch.querySelector('.nt-archive-head');
      if (head) head.setAttribute('aria-expanded', String(doc.ui.archOpen));
    }
    render.syncTab();
    syncSettings();
  }
  applyUi();
  syncNode();
  render.renderAll();
  syncUndoButtons();
  lastSaved = migrated ? '' : JSON.stringify(doc);
  if (demo) {
    setStatus('SANDBOX — NOT SAVED', null);
    toast('A sandbox copy. Nothing here is saved, and nothing here can see anyone else\u2019s notes.');
  } else if (migrated) {
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
      dictate.shutdown();
      closeSessionList();
      flush();
      clearTimeout(saveTimer);
      clearTimeout(retryTimer);
      document.removeEventListener('keydown', onDocKey);
      document.removeEventListener('selectionchange', onSelection);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', flush);
      closePanel();
      for (const url of ctx.demoAssets.values()) URL.revokeObjectURL(url);
      ctx.demoAssets.clear();
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
