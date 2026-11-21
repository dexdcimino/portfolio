/* Dex Board shell.
   Gate order, with no exceptions (unchanged from the first board):
   1. The page starts with only the sign in wall visible. No board data
      markup, no tab modules loaded, and no Firestore calls.
   2. Firebase Auth resolves through the site account helpers. No user
      means the wall stays.
   3. A user means POST /api/auth/unlock with the ID token. Only a
      server owner confirmation unlocks the board.
   4. Only then is the active tab module loaded with a dynamic import
      and mounted, and only then is the Firestore store created.
   5. A signed in non owner sees a plain not available message. No tab
      modules load and no Firestore calls happen.
   6. Sign out unmounts tab modules, clears all rendered board content,
      and returns to the wall.
   Tab modules export mount(container, ctx) and optionally unmount().
   ctx is { user, uid, store, dnd, boardApi }.

   Layout (the redo): the header carries the seven categories, the profile
   mark at the top left, the panel toggles, the hexagon theme picker and the
   Scroll / Zoom toggle at the far right. Under it: the left panel (an
   outline of the blocks on the current tab), the stage, and the right panel
   (the today rail, board/rail.js). Each tab's blocks are packed by
   board/pack.js. Scroll view scrolls the stage and nothing else; Zoom view
   moves a world inside the stage with a transform, wheel to zoom, drag
   empty space to pan, pinch on touch. */

import { onUser, signIn, signOut, idToken, errorText, cancelled } from "/account/site-auth.js";
import { createBoardStore } from "/board/store.js";
import { makeSortable } from "/board/dnd.js";
import { attachPacker } from "/board/pack.js";

/* ---------- Themes ---------- */

/* The site's seven accents, by name (the hex lives in board.css, as it does
   on the site). Picking one writes the same key and cookie the portfolio
   uses, so the accent follows Dex between the two. */
const SITE_ACCENTS = [
  { id: "red", label: "Red", sw: "#D94727" },
  { id: "yellow", label: "Yellow", sw: "#FAAA1E" },
  { id: "lime", label: "Lime", sw: "#9EE02B" },
  { id: "cyan", label: "Cyan", sw: "#2CC7F6" },
  { id: "blue", label: "Blue", sw: "#335DF3" },
  { id: "purple", label: "Purple", sw: "#A85CF5" },
  { id: "white", label: "White", sw: "#E9EBEC" },
];
/* The mockup's eight schemes. Board only: they never touch the site. */
const MOCK_THEMES = [
  { id: "m-red", label: "Red", sw: "#e5484d" },
  { id: "m-orange", label: "Orange", sw: "#f76b15" },
  { id: "m-amber", label: "Amber", sw: "#ffb224" },
  { id: "m-green", label: "Green", sw: "#46a758" },
  { id: "m-teal", label: "Teal", sw: "#12a594" },
  { id: "m-blue", label: "Blue", sw: "#0091ff" },
  { id: "m-violet", label: "Violet", sw: "#8e4ec6" },
  { id: "m-pink", label: "Pink", sw: "#e93d82" },
];
const ACCENT_KEY = "dex-accent-name";
const BOARD_THEME_KEY = "board-theme";

const TABS = [
  { id: "overview", label: "Overview", sub: "Today, what is coming up, and the bills." },
  { id: "schedule", label: "Schedule", sub: "The week, day by day." },
  { id: "notes", label: "Notes", sub: "" },
  { id: "diet", label: "Diet", sub: "From your Food and Diet notes." },
  { id: "exercise", label: "Exercise", sub: "The split and today's sets." },
  { id: "work", label: "Work", sub: "Mission Control, as blocks." },
  { id: "music", label: "Music", sub: "" },
];
const TAB_IDS = TABS.map((t) => t.id);
const DEFAULT_TAB = "overview";

const $ = (id) => document.getElementById(id);
const appEl = $("board-app");
const wallEl = $("board-wall");
const wallMsg = $("board-wall-msg");
const wallError = $("board-wall-error");
const wallSignInBtn = $("board-signin-btn");
const wallSignOutBtn = $("board-wall-signout-btn");
const signOutBtn = $("board-signout-btn");
const themeBtn = $("board-theme-btn");
const themeNameEl = $("board-theme-name");
const themePop = $("bd-theme-pop");
const profileBtn = $("bd-profile");
const menuEl = $("bd-menu");
const menuName = $("bd-menu-name");
const savedEl = $("board-saved");
const leftToggle = $("bd-left-toggle");
const rightToggle = $("bd-right-toggle");
const outlineEl = $("bd-outline");
const outlineTitle = $("bd-outline-title");
const outlineCount = $("bd-outline-count");
const outlineHint = $("bd-outline-hint");
const railEl = $("bd-right");
const hudEl = $("bd-hud");
const hudHint = $("bd-hud-hint");
const hudPct = hudEl.querySelector(".hud-pct");
const tabButtons = Array.from(document.querySelectorAll(".board-tab"));
const viewButtons = Array.from(document.querySelectorAll(".board-view-btn"));
const isDrawerWidth = () => window.matchMedia("(max-width: 1023px)").matches;

/* ---------- The profile mark: the site's hexagon person ---------- */

const SVG_NS = "http://www.w3.org/2000/svg";
function hexPoints(cx, cy, r) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = Math.PI / 180 * (90 + i * 60);
    return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
  });
}
function roundedPolygonPath(points, radius) {
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const scale = (a, s) => ({ x: a.x * s, y: a.y * s });
  const norm = (a) => { const l = Math.hypot(a.x, a.y); return { x: a.x / l, y: a.y / l }; };
  let d = "";
  points.forEach((curr, i) => {
    const prev = points[(i - 1 + points.length) % points.length];
    const next = points[(i + 1) % points.length];
    const p1 = sub(curr, scale(norm(sub(curr, prev)), radius));
    const p2 = add(curr, scale(norm(sub(next, curr)), radius));
    d += `${i === 0 ? "M" : "L"} ${p1.x} ${p1.y} Q ${curr.x} ${curr.y} ${p2.x} ${p2.y} `;
  });
  return d + "Z";
}
const svgEl = (tag, attrs) => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
  return n;
};
let clipSeq = 0;
function profileMark(photoURL) {
  const id = "bdclip" + (++clipSeq);
  const svg = svgEl("svg", { viewBox: "0 0 76 76", "aria-hidden": "true" });
  const defs = svgEl("defs");
  const clip = svgEl("clipPath", { id });
  clip.append(svgEl("path", { d: roundedPolygonPath(hexPoints(38, 38, 29), 5) }));
  defs.append(clip);
  const frame = roundedPolygonPath(hexPoints(38, 38, 32), 6);
  svg.append(defs,
    svgEl("path", { class: "pf-back", d: roundedPolygonPath(hexPoints(38, 38, 38), 8) }),
    svgEl("path", { class: "pf-fill", d: frame }));
  const body = svgEl("g", { "clip-path": `url(#${id})`, class: "pf-person" });
  if (photoURL) {
    const img = svgEl("image", { href: photoURL, x: "6", y: "6", width: "64", height: "64", preserveAspectRatio: "xMidYMid slice" });
    img.setAttribute("referrerpolicy", "no-referrer");
    body.append(img);
  } else {
    body.append(
      svgEl("path", { d: roundedPolygonPath(hexPoints(38, 29, 9.5), 3) }),
      svgEl("path", { d: "M 17 76 L 17 61 C 17 51 26 45 38 45 C 50 45 59 51 59 61 L 59 76 Z" }));
  }
  svg.append(svgEl("path", { class: "pf-frame", d: frame }), body);
  return svg;
}
function hexSwatch(color) {
  const svg = svgEl("svg", { viewBox: "0 0 38 42", "aria-hidden": "true" });
  const pts = hexPoints(19, 21, 17);
  svg.append(
    svgEl("path", { class: "hs-ring", d: roundedPolygonPath(hexPoints(19, 21, 20), 4) }),
    svgEl("path", { class: "hs-fill", d: roundedPolygonPath(pts, 3.5) }));
  svg.style.setProperty("--sw", color);
  return svg;
}
$("board-wall-mark").append(profileMark(null));
profileBtn.append(profileMark(null));

/* ---------- Theme picker ---------- */

function readTheme() {
  let board = null;
  let site = "lime";
  try {
    board = localStorage.getItem(BOARD_THEME_KEY);
    const s = localStorage.getItem(ACCENT_KEY);
    if (SITE_ACCENTS.some((a) => a.id === s)) site = s;
  } catch (err) { void err; }
  if (MOCK_THEMES.some((t) => t.id === board)) return board;
  return document.documentElement.getAttribute("data-accent") || site;
}

function themeLabel(id) {
  const site = SITE_ACCENTS.find((a) => a.id === id);
  if (site) return "Site " + site.label;
  const mock = MOCK_THEMES.find((t) => t.id === id);
  return mock ? "Board " + mock.label : "Theme";
}

let currentTheme = readTheme();

function applyTheme(id, persist) {
  const root = document.documentElement;
  if (MOCK_THEMES.some((t) => t.id === id)) {
    root.setAttribute("data-board-theme", id);
    if (persist) { try { localStorage.setItem(BOARD_THEME_KEY, id); } catch (err) { void err; } }
  } else {
    const accent = SITE_ACCENTS.some((a) => a.id === id) ? id : "lime";
    root.removeAttribute("data-board-theme");
    root.setAttribute("data-accent", accent);
    id = accent;
    if (persist) {
      try { localStorage.removeItem(BOARD_THEME_KEY); localStorage.setItem(ACCENT_KEY, accent); } catch (err) { void err; }
      try {
        document.cookie = ACCENT_KEY + "=" + encodeURIComponent(accent) + "; domain=.dexcimino.com; path=/; max-age=31536000; SameSite=Lax";
      } catch (err) { void err; }
    }
  }
  currentTheme = id;
  themeNameEl.textContent = themeLabel(id);
  for (const b of themePop.querySelectorAll(".hex-swatch")) {
    b.setAttribute("aria-checked", b.dataset.theme === id ? "true" : "false");
  }
  const nameOut = themePop.querySelector(".bd-theme-name b");
  if (nameOut) nameOut.textContent = themeLabel(id);
}

function buildThemePop() {
  const groups = [
    { title: "Site accents", list: SITE_ACCENTS, perRow: [4, 3] },
    { title: "Board schemes", list: MOCK_THEMES, perRow: [4, 4] },
  ];
  themePop.replaceChildren();
  for (const g of groups) {
    const h = document.createElement("h4");
    h.textContent = g.title;
    const grid = document.createElement("div");
    grid.className = "hex-grid";
    grid.setAttribute("role", "radiogroup");
    grid.setAttribute("aria-label", g.title);
    let i = 0;
    g.perRow.forEach((n, r) => {
      const row = document.createElement("div");
      row.className = "hex-row" + (r % 2 ? " is-odd" : "");
      for (const t of g.list.slice(i, i + n)) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "hex-swatch";
        b.dataset.theme = t.id;
        b.setAttribute("role", "radio");
        b.setAttribute("aria-label", (g.list === SITE_ACCENTS ? "Site " : "Board ") + t.label);
        b.title = t.label;
        b.append(hexSwatch(t.sw));
        b.addEventListener("click", () => applyTheme(t.id, true));
        row.append(b);
      }
      i += n;
      grid.append(row);
    });
    themePop.append(h, grid);
  }
  const name = document.createElement("span");
  name.className = "bd-theme-name";
  name.append("Now: ", document.createElement("b"));
  themePop.append(name);
}
buildThemePop();
applyTheme(currentTheme, false);

function setPopover(btn, pop, open) {
  pop.hidden = !open;
  btn.setAttribute("aria-expanded", open ? "true" : "false");
}
themeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  setPopover(profileBtn, menuEl, false);
  setPopover(themeBtn, themePop, themePop.hidden);
});
profileBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  setPopover(themeBtn, themePop, false);
  setPopover(profileBtn, menuEl, menuEl.hidden);
});
document.addEventListener("click", (e) => {
  if (!themePop.hidden && !themePop.contains(e.target)) setPopover(themeBtn, themePop, false);
  if (!menuEl.hidden && !menuEl.contains(e.target)) setPopover(profileBtn, menuEl, false);
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!themePop.hidden) { setPopover(themeBtn, themePop, false); themeBtn.focus(); }
  if (!menuEl.hidden) { setPopover(profileBtn, menuEl, false); profileBtn.focus(); }
});

/* ---------- Saved indicator ---------- */

let savedTimer = null;
function showSavedState(state) {
  if (!savedEl) return;
  if (savedTimer) { clearTimeout(savedTimer); savedTimer = null; }
  if (state === "saving") {
    savedEl.textContent = "Saving...";
    savedEl.setAttribute("data-state", "saving");
  } else if (state === "saved") {
    savedEl.textContent = "Saved";
    savedEl.setAttribute("data-state", "saved");
    savedTimer = setTimeout(() => { savedEl.textContent = ""; savedEl.removeAttribute("data-state"); }, 2400);
  } else if (state === "error") {
    savedEl.textContent = "Save failed";
    savedEl.setAttribute("data-state", "error");
  } else {
    savedEl.textContent = "";
    savedEl.removeAttribute("data-state");
  }
}

/* ---------- Shell state ---------- */

let currentUser = null;
let ownerUnlocked = false;
let unlockGeneration = 0;
let boardStore = null;
let activeTab = DEFAULT_TAB;
let layoutState = { viewModes: {}, activeTab: DEFAULT_TAB, panels: {} };
const loadedTabs = new Set();
const mountedTabs = new Map();
const zoomStates = new Map();
const packers = new Map();
let railMod = null;

function panelFor(tabId) { return $("panel-" + tabId); }
function tabMeta(tabId) { return TABS.find((t) => t.id === tabId) || TABS[0]; }

function createPanelScaffold(panel, tabId) {
  panel.replaceChildren();
  const viewport = document.createElement("div");
  viewport.className = "board-tab-viewport";
  viewport.setAttribute("data-mode", "scroll");
  viewport.setAttribute("data-tab-viewport", tabId);
  const canvas = document.createElement("div");
  canvas.className = "board-tab-canvas";
  const meta = tabMeta(tabId);
  if (meta.sub) {
    const head = document.createElement("div");
    head.className = "page-head";
    const h2 = document.createElement("h2");
    h2.textContent = meta.label;
    const p = document.createElement("p");
    p.setAttribute("data-page-sub", "");
    p.textContent = tabId === "overview" ? todayLong() + ". " + meta.sub : meta.sub;
    head.append(h2, p);
    canvas.append(head);
  }
  const mount = document.createElement("div");
  mount.className = "board-tab-mount" + (tabId === "notes" ? " board-notes" : "");
  mount.setAttribute("data-tab-mount", tabId);
  canvas.appendChild(mount);
  viewport.appendChild(canvas);
  panel.appendChild(viewport);
  attachZoomHandlers(viewport, canvas, tabId);
  packers.set(tabId, attachPacker(mount, {
    minCol: minColFor(tabId),
    onPacked: () => { if (tabId === activeTab) scheduleOutline(); },
  }));
  return { viewport, canvas, mount };
}

function scaffoldFor(tabId) {
  const panel = panelFor(tabId);
  if (!panel) return null;
  const mount = panel.querySelector("[data-tab-mount]");
  if (mount) {
    return { viewport: panel.querySelector("[data-tab-viewport]"), canvas: panel.querySelector(".board-tab-canvas"), mount };
  }
  return createPanelScaffold(panel, tabId);
}

function minColFor(tabId) {
  if (tabId === "work") return 270;
  if (tabId === "schedule") return 300;
  return 340;
}

function todayLong() {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

/* ---------- View modes ---------- */

function viewModeFor(tabId) {
  if (window.matchMedia("(max-width: 760px)").matches && tabId === "notes") return "scroll";
  const mode = layoutState && layoutState.viewModes ? layoutState.viewModes[tabId] : null;
  return mode === "zoom" ? "zoom" : "scroll";
}

function zoomStateFor(tabId) {
  if (!zoomStates.has(tabId)) zoomStates.set(tabId, { scale: 1, x: 0, y: 0, fitted: false });
  return zoomStates.get(tabId);
}

function applyZoomTransform(tabId, animate) {
  const parts = scaffoldFor(tabId);
  if (!parts || !parts.canvas) return;
  if (viewModeFor(tabId) !== "zoom") {
    parts.canvas.style.transform = "";
    parts.canvas.style.transition = "";
    return;
  }
  const z = zoomStateFor(tabId);
  parts.canvas.style.transition = animate ? "transform .35s cubic-bezier(.2,.7,.2,1)" : "";
  parts.canvas.style.transform = "translate(" + z.x + "px, " + z.y + "px) scale(" + z.scale + ")";
  if (tabId === activeTab) hudPct.textContent = Math.round(z.scale * 100) + "%";
}

/* The zoom world is laid out wider than the stage when the tab has many
   blocks, so zooming out shows the whole board in roughly the stage's shape
   instead of one very tall strip. Each width is tried by packing for real. */
function layoutZoomWorld(tabId) {
  const parts = scaffoldFor(tabId);
  const packer = packers.get(tabId);
  if (!parts || !packer) return;
  const stageW = parts.viewport.clientWidth;
  const stageH = parts.viewport.clientHeight;
  if (!stageW || !stageH) return;
  if (tabId === "notes") { parts.canvas.style.width = ""; return; }
  /* Pick the column count whose packed board is closest to the stage's own
     shape (the dev board's pick()): every count is packed for real and
     scored by |log(board aspect / stage aspect)|, so Fit shows a board that
     fills the screen instead of a tall strip with dead space either side. */
  const gap = 16;
  const pad = Math.max(0, parts.canvas.offsetWidth - (parts.canvas.querySelector(".board-grid") || parts.canvas).clientWidth);
  /* Work packs 270px columns in Scroll so 1440 gets three; on the zoom
     board there is room, and wider columns keep its text off one word a
     line. */
  const col = tabId === "work" ? 360 : minColFor(tabId);
  packer.setMinCol(col);
  const blocks = parts.canvas.querySelectorAll(".board-grid > .board-card").length || 1;
  const stageAspect = stageW / stageH;
  const maxCols = Math.min(blocks, 16);
  /* Music is three blocks whose track list flows into as many columns as
     its width allows, so it is tried by width rather than by block count. */
  const widths = [];
  if (tabId === "music") for (let k = 1; k <= 6; k += 0.5) widths.push(Math.round(stageW * k));
  else for (let c = 1; c <= maxCols; c += 1) widths.push(Math.max(stageW, Math.ceil(c * col + (c - 1) * gap + pad)));
  let best = null;
  for (const width of widths) {
    if (best && width === best.width) continue;
    parts.canvas.style.width = width + "px";
    packer.repack();
    const h = parts.canvas.offsetHeight || 1;
    const score = Math.abs(Math.log((width / h) / stageAspect));
    if (!best || score < best.score - 0.02) best = { width, score };
  }
  if (best) { parts.canvas.style.width = best.width + "px"; packer.repack(); }
}

function fitZoom(tabId, animate) {
  const parts = scaffoldFor(tabId);
  if (!parts) return;
  const z = zoomStateFor(tabId);
  const sw = parts.viewport.clientWidth;
  const sh = parts.viewport.clientHeight;
  const ww = parts.canvas.offsetWidth;
  const wh = parts.canvas.offsetHeight;
  if (!sw || !ww) return;
  /* Notes is one long document that cannot be re-packed wider, so fitting
     its whole height shrank it to 15%, too small to read. It fits the width
     instead, from the top. */
  const byWidth = tabId === "notes";
  const scale = Math.max(0.15, Math.min(1, (sw - 24) / ww, byWidth ? Infinity : (sh - 24) / wh));
  z.scale = scale;
  z.x = Math.round((sw - ww * scale) / 2);
  z.y = Math.max(12, Math.round((sh - wh * scale) / 2));
  if (wh * scale > sh) z.y = 12;
  z.fitted = true;
  applyZoomTransform(tabId, animate);
}

function zoomAt(tabId, factor, px, py, animate) {
  const z = zoomStateFor(tabId);
  const next = Math.max(0.15, Math.min(2.5, z.scale * factor));
  if (next === z.scale) return;
  const cx = (px - z.x) / z.scale;
  const cy = (py - z.y) / z.scale;
  z.scale = next;
  z.x = px - cx * next;
  z.y = py - cy * next;
  applyZoomTransform(tabId, animate);
}

function updateChrome() {
  const mode = viewModeFor(activeTab);
  for (const btn of viewButtons) {
    const on = btn.getAttribute("data-view-mode") === mode;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  hudEl.hidden = mode !== "zoom";
  hudHint.hidden = mode !== "zoom";
  if (mode === "zoom") hudPct.textContent = Math.round(zoomStateFor(activeTab).scale * 100) + "%";
}

function applyViewMode(tabId) {
  const parts = scaffoldFor(tabId);
  if (!parts || !parts.viewport) return;
  const mode = viewModeFor(tabId);
  const was = parts.viewport.getAttribute("data-mode");
  parts.viewport.setAttribute("data-mode", mode);
  const packer = packers.get(tabId);
  if (mode === "scroll") {
    parts.canvas.style.width = "";
    parts.canvas.style.transform = "";
    if (packer) { packer.setMinCol(minColFor(tabId)); packer.schedule(); }
  } else if (was !== "zoom" || !zoomStateFor(tabId).fitted) {
    if (!panelFor(tabId).hidden) {
      layoutZoomWorld(tabId);
      fitZoom(tabId, false);
    }
  } else {
    applyZoomTransform(tabId, false);
  }
  if (tabId === activeTab) updateChrome();
}

function persistLayout() {
  if (!boardStore) return;
  layoutState.activeTab = activeTab;
  boardStore.save("board-layout", layoutState);
}

function setViewMode(tabId, mode) {
  if (!TAB_IDS.includes(tabId)) return;
  if (mode !== "zoom" && mode !== "scroll") return;
  if (!layoutState.viewModes) layoutState.viewModes = {};
  layoutState.viewModes[tabId] = mode;
  const z = zoomStateFor(tabId);
  z.fitted = false;
  applyViewMode(tabId);
  persistLayout();
}

const INTERACTIVE = "button, input, textarea, select, a, label, summary, iframe, video, [contenteditable], [data-no-pan], .nt-app, .board-insertion-line";

function attachZoomHandlers(viewport, canvas, tabId) {
  if (viewport.getAttribute("data-zoom-bound") === "1") return;
  viewport.setAttribute("data-zoom-bound", "1");
  const zoomOn = () => viewModeFor(tabId) === "zoom";

  viewport.addEventListener("wheel", (event) => {
    if (!zoomOn()) return;
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    zoomAt(tabId, Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0018)), event.clientX - rect.left, event.clientY - rect.top, false);
  }, { passive: false });

  const pointers = new Map();
  let pan = null;
  let pinch = null;
  viewport.addEventListener("pointerdown", (event) => {
    if (!zoomOn()) return;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const t = event.target;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      const z = zoomStateFor(tabId);
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: z.scale };
      pan = null;
      return;
    }
    if (t && t.closest && t.closest(INTERACTIVE)) return;
    const z = zoomStateFor(tabId);
    pan = { id: event.pointerId, sx: event.clientX, sy: event.clientY, bx: z.x, by: z.y, live: false };
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!zoomOn()) return;
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = viewport.getBoundingClientRect();
      const z = zoomStateFor(tabId);
      zoomAt(tabId, (pinch.scale * d / pinch.dist) / z.scale, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top, false);
      return;
    }
    if (!pan || event.pointerId !== pan.id) return;
    const dx = event.clientX - pan.sx;
    const dy = event.clientY - pan.sy;
    if (!pan.live) {
      if (Math.hypot(dx, dy) < 4) return;
      pan.live = true;
      viewport.classList.add("is-panning");
      try { viewport.setPointerCapture(event.pointerId); } catch (err) { void err; }
    }
    const z = zoomStateFor(tabId);
    z.x = pan.bx + dx;
    z.y = pan.by + dy;
    applyZoomTransform(tabId, false);
  });
  const end = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pan && event.pointerId === pan.id) {
      pan = null;
      viewport.classList.remove("is-panning");
    }
  };
  viewport.addEventListener("pointerup", end);
  viewport.addEventListener("pointercancel", end);
  viewport.addEventListener("dblclick", (event) => {
    if (!zoomOn()) return;
    if (event.target.closest && event.target.closest(INTERACTIVE)) return;
    const z = zoomStateFor(tabId);
    const rect = viewport.getBoundingClientRect();
    if (z.scale >= 0.99) fitZoom(tabId, true);
    else zoomAt(tabId, Math.min(1 / z.scale, 2.2), event.clientX - rect.left, event.clientY - rect.top, true);
  });
}

hudEl.addEventListener("click", (e) => {
  const b = e.target.closest("[data-zoom]");
  if (!b) return;
  const parts = scaffoldFor(activeTab);
  const cx = parts.viewport.clientWidth / 2;
  const cy = parts.viewport.clientHeight / 2;
  const z = zoomStateFor(activeTab);
  const what = b.getAttribute("data-zoom");
  if (what === "in") zoomAt(activeTab, 1.25, cx, cy, true);
  else if (what === "out") zoomAt(activeTab, 0.8, cx, cy, true);
  else if (what === "reset") zoomAt(activeTab, 1 / z.scale, cx, cy, true);
  else if (what === "fit") fitZoom(activeTab, true);
});

/* ---------- The outline (left panel) ---------- */

let outlineFrame = 0;
function scheduleOutline() {
  if (outlineFrame) return;
  outlineFrame = requestAnimationFrame(() => { outlineFrame = 0; renderOutline(); });
}

function outlineTargets(tabId) {
  const parts = scaffoldFor(tabId);
  if (!parts) return [];
  const out = [];
  for (const node of parts.mount.querySelectorAll(".board-card, [data-outline]")) {
    if (node.offsetParent === null && viewModeFor(tabId) === "scroll") continue;
    if (node.style.display === "none") continue;
    let label = node.getAttribute("data-outline");
    if (!label) {
      const t = node.querySelector(".board-card-title");
      label = t ? t.textContent.trim() : "";
    }
    if (label) out.push({ node, label, n: node.getAttribute("data-outline-n") || "" });
  }
  return out;
}

function renderOutline() {
  outlineEl.replaceChildren();
  if (activeTab === "notes") {
    outlineTitle.textContent = "Notes";
    outlineCount.textContent = "";
    outlineHint.textContent = "Your categories are in the outliner inside the notes. Everything saves as you type, the same as DexNote.";
    return;
  }
  outlineTitle.textContent = tabMeta(activeTab).label;
  const targets = outlineTargets(activeTab);
  outlineCount.textContent = targets.length ? String(targets.length) : "";
  for (const t of targets) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    const span = document.createElement("span");
    span.textContent = t.label;
    b.append(span);
    if (t.n) {
      const n = document.createElement("span");
      n.className = "ol-n";
      n.textContent = t.n;
      b.append(n);
    }
    b.addEventListener("click", () => goToBlock(t.node));
    li.append(b);
    outlineEl.append(li);
  }
  outlineHint.textContent = viewModeFor(activeTab) === "zoom"
    ? "Click a block to fly to it. Fit in the corner shows everything."
    : "Click a block to jump to it.";
}

function goToBlock(node) {
  const tabId = activeTab;
  const parts = scaffoldFor(tabId);
  if (!parts) return;
  if (isDrawerWidth()) setPanel("left", "closed");
  if (viewModeFor(tabId) === "zoom") {
    /* Position of the block inside the world, unscaled. */
    let x = 0;
    let y = 0;
    let n = node;
    while (n && n !== parts.canvas) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    const sw = parts.viewport.clientWidth;
    const sh = parts.viewport.clientHeight;
    const scale = Math.max(0.3, Math.min(1, (sw - 60) / node.offsetWidth, (sh - 60) / Math.max(node.offsetHeight, 200)));
    const z = zoomStateFor(tabId);
    z.scale = scale;
    z.x = Math.round(sw / 2 - (x + node.offsetWidth / 2) * scale);
    z.y = Math.round(Math.max(24, sh / 2 - (node.offsetHeight * scale) / 2) - y * scale);
    applyZoomTransform(tabId, true);
  } else {
    const vr = parts.viewport.getBoundingClientRect();
    const nr = node.getBoundingClientRect();
    parts.viewport.scrollTo({ top: parts.viewport.scrollTop + nr.top - vr.top - 14, behavior: "smooth" });
  }
  node.classList.add("is-flash");
  setTimeout(() => node.classList.remove("is-flash"), 1100);
}

/* ---------- Side panels ---------- */

function setPanel(side, state) {
  appEl.setAttribute("data-" + side, state);
  const btn = side === "left" ? leftToggle : rightToggle;
  btn.setAttribute("aria-pressed", state === "open" ? "true" : "false");
  if (!isDrawerWidth()) {
    if (!layoutState.panels) layoutState.panels = {};
    layoutState.panels[side] = state;
  }
}
function initialPanels() {
  if (isDrawerWidth()) { setPanel("left", "closed"); setPanel("right", "closed"); return; }
  const p = layoutState.panels || {};
  setPanel("left", p.left === "closed" ? "closed" : "open");
  setPanel("right", p.right === "closed" ? "closed" : "open");
}
leftToggle.addEventListener("click", () => {
  const next = appEl.getAttribute("data-left") === "open" ? "closed" : "open";
  if (isDrawerWidth() && next === "open") setPanel("right", "closed");
  setPanel("left", next);
  persistLayout();
  afterStageResize();
});
rightToggle.addEventListener("click", () => {
  const next = appEl.getAttribute("data-right") === "open" ? "closed" : "open";
  if (isDrawerWidth() && next === "open") setPanel("left", "closed");
  setPanel("right", next);
  persistLayout();
  afterStageResize();
});
/* A tap on the stage closes an open drawer on narrow screens. */
document.querySelector(".board-main").addEventListener("pointerdown", () => {
  if (!isDrawerWidth()) return;
  if (appEl.getAttribute("data-left") === "open") setPanel("left", "closed");
  if (appEl.getAttribute("data-right") === "open") setPanel("right", "closed");
});

let resizeTimer = 0;
function afterStageResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    for (const [id, p] of packers) if (!panelFor(id).hidden) p.schedule();
    if (viewModeFor(activeTab) === "zoom") {
      zoomStateFor(activeTab).fitted = false;
      layoutZoomWorld(activeTab);
      fitZoom(activeTab, false);
    }
  }, 120);
}
/* Crossing into drawer width closes both panels, as a narrow load does:
   left open they would sit over the board. Crossing back restores the
   saved choice. */
let wasDrawer = isDrawerWidth();
window.addEventListener("resize", () => {
  const now = isDrawerWidth();
  if (now !== wasDrawer) { wasDrawer = now; initialPanels(); }
  afterStageResize();
});

/* ---------- Board API handed to tab modules through ctx ---------- */

const boardApi = {
  switchTab(tabId) { return activateTab(tabId); },
  activateTab(tabId) { return activateTab(tabId); },
  getActiveTab() { return activeTab; },
  getViewMode(tabId) { return viewModeFor(tabId || activeTab); },
  setViewMode(tabId, mode) {
    if (mode === undefined) { mode = tabId; tabId = activeTab; }
    setViewMode(tabId, mode);
  },
  showSavedState(state) { showSavedState(state); },
  signOut() { return doSignOut(); },
  getLayout() { return layoutState; },
  setCount(tabId, n) {
    const btn = tabButtons.find((b) => b.getAttribute("data-tab") === tabId);
    if (!btn) return;
    let c = btn.querySelector(".tab-count");
    if (!c) { c = document.createElement("span"); c.className = "tab-count"; btn.append(c); }
    c.textContent = n ? String(n) : "";
  },
  repack(tabId) { const p = packers.get(tabId || activeTab); if (p) p.schedule(); },
};

function buildCtx() {
  return { user: currentUser, uid: currentUser ? currentUser.uid : null, store: boardStore, dnd: { makeSortable }, boardApi };
}

async function activateTab(tabId) {
  if (!ownerUnlocked || !boardStore) return;
  if (!TAB_IDS.includes(tabId)) tabId = DEFAULT_TAB;
  activeTab = tabId;
  for (const btn of tabButtons) btn.setAttribute("aria-selected", btn.getAttribute("data-tab") === tabId ? "true" : "false");
  for (const id of TAB_IDS) {
    const panel = panelFor(id);
    if (panel) panel.hidden = id !== tabId;
  }
  appEl.setAttribute("data-tab", tabId);
  scaffoldFor(tabId);
  applyViewMode(tabId);
  updateChrome();
  scheduleOutline();
  persistLayout();

  if (!loadedTabs.has(tabId)) {
    loadedTabs.add(tabId);
    const parts = scaffoldFor(tabId);
    try {
      const mod = await import("/board/" + tabId + ".js");
      if (!ownerUnlocked) return;
      if (typeof mod.mount !== "function") throw new Error("tab module " + tabId + " has no mount export");
      const result = mod.mount(parts.mount, buildCtx());
      if (result && typeof result.then === "function") await result;
      mountedTabs.set(tabId, mod);
      if (tabId === activeTab && viewModeFor(tabId) === "zoom") {
        zoomStateFor(tabId).fitted = false;
        requestAnimationFrame(() => applyViewMode(tabId));
      }
      if (tabId === "notes") boardApi.setCount("notes", parts.mount.querySelectorAll(".nt-cat").length || "");
      scheduleOutline();
    } catch (err) {
      console.error("board: tab failed to load: " + tabId, err);
      loadedTabs.delete(tabId);
      const partsNow = scaffoldFor(tabId);
      if (partsNow && partsNow.mount) {
        partsNow.mount.replaceChildren();
        const card = document.createElement("div");
        card.className = "board-loading-card";
        card.textContent = "This tab could not load. Try again.";
        partsNow.mount.appendChild(card);
      }
    }
  }
}

for (const btn of tabButtons) btn.addEventListener("click", () => { void activateTab(btn.getAttribute("data-tab")); });
for (const btn of viewButtons) btn.addEventListener("click", () => { setViewMode(activeTab, btn.getAttribute("data-view-mode")); });

/* ---------- Wall and avatar ---------- */

function setWallError(text) {
  if (!text) { wallError.hidden = true; wallError.textContent = ""; return; }
  wallError.hidden = false;
  wallError.textContent = text;
}

function showWall(mode, message) {
  appEl.hidden = true;
  wallEl.hidden = false;
  document.body.classList.remove("is-board");
  if (mode === "checking") {
    wallMsg.textContent = message || "Checking access...";
    wallSignInBtn.hidden = true;
    wallSignOutBtn.hidden = true;
  } else if (mode === "not-available") {
    wallMsg.textContent = message || "This board is not available for this account.";
    wallSignInBtn.hidden = true;
    wallSignOutBtn.hidden = false;
  } else {
    wallMsg.textContent = message || "Sign in to open your board.";
    wallSignInBtn.hidden = false;
    wallSignOutBtn.hidden = !currentUser;
  }
}

function renderAvatar(user) {
  profileBtn.replaceChildren(profileMark(user && user.photoURL ? user.photoURL : null));
  if (menuName) menuName.textContent = (user && (user.displayName || user.email)) || "Dex";
}

function clearBoardContent() {
  for (const mod of mountedTabs.values()) {
    if (mod && typeof mod.unmount === "function") {
      try { mod.unmount(); } catch (err) { console.warn("board: tab unmount threw", err); }
    }
  }
  mountedTabs.clear();
  loadedTabs.clear();
  zoomStates.clear();
  for (const p of packers.values()) { try { p.destroy(); } catch (err) { void err; } }
  packers.clear();
  if (railMod && typeof railMod.unmount === "function") { try { railMod.unmount(); } catch (err) { void err; } }
  railMod = null;
  railEl.replaceChildren();
  outlineEl.replaceChildren();
  for (const id of TAB_IDS) {
    const panel = panelFor(id);
    if (panel) panel.replaceChildren();
    boardApi.setCount(id, "");
  }
  profileBtn.replaceChildren(profileMark(null));
  setPopover(profileBtn, menuEl, false);
  showSavedState("");
  if (boardStore) {
    try { boardStore.destroy(); } catch (err) { void err; }
    boardStore = null;
  }
  layoutState = { viewModes: {}, activeTab: DEFAULT_TAB, panels: {} };
  activeTab = DEFAULT_TAB;
}

async function unlockBoard(user) {
  const generation = unlockGeneration;
  boardStore = createBoardStore(user.uid, showSavedState);
  try {
    const savedLayout = await boardStore.load("board-layout");
    if (generation !== unlockGeneration) return;
    if (savedLayout && typeof savedLayout === "object") {
      layoutState = {
        viewModes: savedLayout.viewModes && typeof savedLayout.viewModes === "object" ? savedLayout.viewModes : {},
        activeTab: TAB_IDS.includes(savedLayout.activeTab) ? savedLayout.activeTab : DEFAULT_TAB,
        panels: savedLayout.panels && typeof savedLayout.panels === "object" ? savedLayout.panels : {},
      };
    }
  } catch (err) {
    console.warn("board: layout load failed, using defaults", err);
  }
  if (generation !== unlockGeneration) return;
  ownerUnlocked = true;
  renderAvatar(user);
  wallEl.hidden = true;
  appEl.hidden = false;
  document.body.classList.add("is-board");
  setWallError("");
  initialPanels();
  try {
    railMod = await import("/board/rail.js");
    if (generation !== unlockGeneration) return;
    railMod.mount(railEl, buildCtx());
  } catch (err) {
    console.warn("board: the today rail could not load", err);
  }
  const startTab = TAB_IDS.includes(layoutState.activeTab) ? layoutState.activeTab : DEFAULT_TAB;
  await activateTab(startTab);
}

async function handleUser(user) {
  const generation = ++unlockGeneration;
  currentUser = user || null;
  if (!user) {
    ownerUnlocked = false;
    clearBoardContent();
    showWall("signed-out");
    return;
  }
  if (ownerUnlocked && boardStore && boardStore.uid === user.uid) return;
  ownerUnlocked = false;
  clearBoardContent();
  currentUser = user;
  showWall("checking");
  setWallError("");
  let token = null;
  try {
    token = await idToken();
    if (!token && typeof user.getIdToken === "function") token = await user.getIdToken();
  } catch (err) {
    console.warn("board: could not get ID token", err);
  }
  if (generation !== unlockGeneration) return;
  if (!token) {
    showWall("signed-out", "Sign in to open your board.");
    setWallError("Could not read the sign in. Try signing in again.");
    return;
  }
  let response = null;
  try {
    response = await fetch("/api/auth/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });
  } catch (err) {
    if (generation !== unlockGeneration) return;
    showWall("signed-out", "Sign in to open your board.");
    setWallError("Could not reach the server to check access. Try again.");
    return;
  }
  if (generation !== unlockGeneration) return;
  if (response.ok) {
    await unlockBoard(user);
    return;
  }
  if (response.status === 403) {
    showWall("not-available");
    return;
  }
  showWall("signed-out", "Sign in to open your board.");
  setWallError("Access could not be confirmed. Try again.");
}

async function doSignOut() {
  unlockGeneration++;
  ownerUnlocked = false;
  if (boardStore) {
    try { await boardStore.flush(); } catch (err) { void err; }
  }
  try { await signOut(); } catch (err) { console.warn("board: sign out failed", err); }
  currentUser = null;
  clearBoardContent();
  showWall("signed-out");
}

wallSignInBtn.addEventListener("click", async () => {
  setWallError("");
  wallSignInBtn.disabled = true;
  try {
    await signIn("google");
  } catch (err) {
    if (!cancelled(err)) setWallError(errorText(err));
  } finally {
    wallSignInBtn.disabled = false;
  }
});
wallSignOutBtn.addEventListener("click", () => { void doSignOut(); });
signOutBtn.addEventListener("click", () => { void doSignOut(); });

/* Service worker, following the dexnote pattern. */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/board/sw.js", { scope: "/board/", updateViaCache: "none" }).catch(() => {});
}

/* Boot: wall first, then the auth listener drives the gate. */
showWall("checking", "Checking sign in...");
onUser((user) => { void handleUser(user); });
