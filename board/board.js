/* Dex Board shell.
   Gate order, with no exceptions:
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
   ctx is { user, uid, store, dnd, boardApi }. See the lane summary. */

import { onUser, signIn, signOut, idToken, errorText, cancelled } from "/account/site-auth.js";
import { createBoardStore } from "/board/store.js";
import { makeSortable } from "/board/dnd.js";

const ACCENTS = ["red", "yellow", "lime", "cyan", "blue", "purple", "white"];
const ACCENT_KEY = "dex-accent-name";
const MASCOT_STEMS = {
  red: "red",
  yellow: "yellow",
  lime: "limegreen",
  cyan: "cyan",
  blue: "blue",
  purple: "purple",
  white: "white",
};

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "schedule", label: "Schedule" },
  { id: "notes", label: "Notes" },
  { id: "diet", label: "Diet" },
  { id: "exercise", label: "Exercise" },
  { id: "work", label: "Work" },
  { id: "music", label: "Music" },
];
const TAB_IDS = TABS.map((t) => t.id);
const DEFAULT_TAB = "overview";

const appEl = document.getElementById("board-app");
const wallEl = document.getElementById("board-wall");
const wallMsg = document.getElementById("board-wall-msg");
const wallError = document.getElementById("board-wall-error");
const wallSignInBtn = document.getElementById("board-signin-btn");
const wallSignOutBtn = document.getElementById("board-wall-signout-btn");
const signOutBtn = document.getElementById("board-signout-btn");
const themeBtn = document.getElementById("board-theme-btn");
const themeNameEl = document.getElementById("board-theme-name");
const mascotEl = document.getElementById("board-mascot");
const avatarSlot = document.getElementById("board-avatar-slot");
const savedEl = document.getElementById("board-saved");
const tabButtons = Array.from(document.querySelectorAll(".board-tab"));
const viewButtons = Array.from(document.querySelectorAll(".board-view-btn"));

/* Accent handling. accent-boot.js has already set data-accent from the
   saved name before paint. This keeps the button label and the mascot
   in step, and cycles the same seven names on click. */
function savedAccent() {
  try {
    const name = localStorage.getItem(ACCENT_KEY);
    return ACCENTS.includes(name) ? name : "lime";
  } catch (err) {
    void err;
    return "lime";
  }
}

function applyAccent(name, persist) {
  const accent = ACCENTS.includes(name) ? name : "lime";
  document.documentElement.setAttribute("data-accent", accent);
  if (themeNameEl) themeNameEl.textContent = accent;
  if (mascotEl) {
    const stem = MASCOT_STEMS[accent] || "limegreen";
    const next = "https://media.clayweld.com/assets/mascots/mascot_" + stem + ".png";
    if (mascotEl.getAttribute("src") !== next) mascotEl.setAttribute("src", next);
  }
  const wallMascot = document.querySelector(".board-wall-mascot");
  if (wallMascot) {
    const stem = MASCOT_STEMS[accent] || "limegreen";
    wallMascot.setAttribute("src", "https://media.clayweld.com/assets/mascots/mascot_" + stem + ".png");
  }
  if (persist) {
    try { localStorage.setItem(ACCENT_KEY, accent); } catch (err) { void err; }
    try {
      document.cookie = ACCENT_KEY + "=" + encodeURIComponent(accent) + "; domain=.dexcimino.com; path=/; max-age=31536000; SameSite=Lax";
    } catch (err) { void err; }
  }
  return accent;
}

let currentAccent = applyAccent(document.documentElement.getAttribute("data-accent") || savedAccent(), false);

if (mascotEl) {
  mascotEl.addEventListener("error", () => {
    const fallback = "https://media.clayweld.com/assets/mascots/mascot_limegreen.png";
    if (mascotEl.getAttribute("src") !== fallback) mascotEl.setAttribute("src", fallback);
  });
}

themeBtn.addEventListener("click", () => {
  const index = ACCENTS.indexOf(currentAccent);
  const next = ACCENTS[(index + 1) % ACCENTS.length];
  currentAccent = applyAccent(next, true);
});

/* Saved indicator, driven by the store callback. */
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

/* Shell state. */
let currentUser = null;
let ownerUnlocked = false;
let unlockGeneration = 0;
let boardStore = null;
let activeTab = DEFAULT_TAB;
let layoutState = { viewModes: {}, activeTab: DEFAULT_TAB };
const loadedTabs = new Set();
const mountedTabs = new Map();
const zoomStates = new Map();

function panelFor(tabId) {
  return document.getElementById("panel-" + tabId);
}

function createPanelScaffold(panel, tabId) {
  panel.replaceChildren();
  const viewport = document.createElement("div");
  viewport.className = "board-tab-viewport";
  viewport.setAttribute("data-mode", "scroll");
  viewport.setAttribute("data-tab-viewport", tabId);
  const canvas = document.createElement("div");
  canvas.className = "board-tab-canvas";
  const mount = document.createElement("div");
  mount.className = "board-tab-mount";
  mount.setAttribute("data-tab-mount", tabId);
  canvas.appendChild(mount);
  viewport.appendChild(canvas);
  panel.appendChild(viewport);
  attachZoomHandlers(viewport, canvas, tabId);
  return { viewport, canvas, mount };
}

function scaffoldFor(tabId) {
  const panel = panelFor(tabId);
  if (!panel) return null;
  let mount = panel.querySelector("[data-tab-mount]");
  if (mount) {
    return {
      viewport: panel.querySelector("[data-tab-viewport]"),
      canvas: panel.querySelector(".board-tab-canvas"),
      mount,
    };
  }
  return createPanelScaffold(panel, tabId);
}

function viewModeFor(tabId) {
  const mode = layoutState && layoutState.viewModes ? layoutState.viewModes[tabId] : null;
  return mode === "zoom" ? "zoom" : "scroll";
}

function zoomStateFor(tabId) {
  if (!zoomStates.has(tabId)) zoomStates.set(tabId, { scale: 1, x: 0, y: 0 });
  return zoomStates.get(tabId);
}

function applyZoomTransform(tabId) {
  const parts = scaffoldFor(tabId);
  if (!parts || !parts.canvas) return;
  const mode = viewModeFor(tabId);
  if (mode !== "zoom") {
    parts.canvas.style.transform = "";
    return;
  }
  const z = zoomStateFor(tabId);
  parts.canvas.style.transform = "translate(" + z.x + "px, " + z.y + "px) scale(" + z.scale + ")";
}

function applyViewMode(tabId) {
  const parts = scaffoldFor(tabId);
  if (!parts || !parts.viewport) return;
  const mode = viewModeFor(tabId);
  parts.viewport.setAttribute("data-mode", mode);
  if (tabId === activeTab) {
    for (const btn of viewButtons) {
      const isActive = btn.getAttribute("data-view-mode") === mode;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    }
  }
  applyZoomTransform(tabId);
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
  if (mode === "scroll") {
    const z = zoomStateFor(tabId);
    z.scale = 1; z.x = 0; z.y = 0;
  }
  applyViewMode(tabId);
  persistLayout();
}

function attachZoomHandlers(viewport, canvas, tabId) {
  if (viewport.getAttribute("data-zoom-bound") === "1") return;
  viewport.setAttribute("data-zoom-bound", "1");

  viewport.addEventListener("wheel", (event) => {
    if (viewModeFor(tabId) !== "zoom") return;
    event.preventDefault();
    const z = zoomStateFor(tabId);
    const rect = viewport.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const oldScale = z.scale;
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.max(0.25, Math.min(3, oldScale * factor));
    if (newScale === oldScale) return;
    const canvasX = (pointerX - z.x) / oldScale;
    const canvasY = (pointerY - z.y) / oldScale;
    z.scale = newScale;
    z.x = pointerX - canvasX * newScale;
    z.y = pointerY - canvasY * newScale;
    applyZoomTransform(tabId);
  }, { passive: false });

  let pan = null;
  viewport.addEventListener("pointerdown", (event) => {
    if (viewModeFor(tabId) !== "zoom") return;
    const target = event.target;
    if (target !== viewport && target !== canvas && !target.classList.contains("board-tab-mount")) return;
    pan = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, baseX: zoomStateFor(tabId).x, baseY: zoomStateFor(tabId).y };
    viewport.classList.add("is-panning");
    try { viewport.setPointerCapture(event.pointerId); } catch (err) { void err; }
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!pan || event.pointerId !== pan.pointerId) return;
    const z = zoomStateFor(tabId);
    z.x = pan.baseX + (event.clientX - pan.startX);
    z.y = pan.baseY + (event.clientY - pan.startY);
    applyZoomTransform(tabId);
  });
  const endPan = (event) => {
    if (!pan || (event && event.pointerId !== pan.pointerId)) return;
    pan = null;
    viewport.classList.remove("is-panning");
  };
  viewport.addEventListener("pointerup", endPan);
  viewport.addEventListener("pointercancel", endPan);
  viewport.addEventListener("dblclick", (event) => {
    if (viewModeFor(tabId) !== "zoom") return;
    if (event.target.closest && event.target.closest("button, input, textarea, select, a")) return;
    const z = zoomStateFor(tabId);
    z.scale = 1; z.x = 0; z.y = 0;
    applyZoomTransform(tabId);
  });
}

/* Board API handed to tab modules through ctx. */
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
};

function buildCtx() {
  return {
    user: currentUser,
    uid: currentUser ? currentUser.uid : null,
    store: boardStore,
    dnd: { makeSortable },
    boardApi,
  };
}

async function activateTab(tabId) {
  if (!ownerUnlocked || !boardStore) return;
  if (!TAB_IDS.includes(tabId)) tabId = DEFAULT_TAB;
  activeTab = tabId;
  for (const btn of tabButtons) {
    btn.setAttribute("aria-selected", btn.getAttribute("data-tab") === tabId ? "true" : "false");
  }
  for (const id of TAB_IDS) {
    const panel = panelFor(id);
    if (panel) panel.hidden = id !== tabId;
  }
  applyViewMode(tabId);
  persistLayout();

  if (!loadedTabs.has(tabId)) {
    loadedTabs.add(tabId);
    const parts = scaffoldFor(tabId);
    applyViewMode(tabId);
    try {
      const mod = await import("/board/" + tabId + ".js");
      if (!ownerUnlocked) return;
      if (typeof mod.mount !== "function") throw new Error("tab module " + tabId + " has no mount export");
      const result = mod.mount(parts.mount, buildCtx());
      if (result && typeof result.then === "function") await result;
      mountedTabs.set(tabId, mod);
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

for (const btn of tabButtons) {
  btn.addEventListener("click", () => { void activateTab(btn.getAttribute("data-tab")); });
}
for (const btn of viewButtons) {
  btn.addEventListener("click", () => { setViewMode(activeTab, btn.getAttribute("data-view-mode")); });
}

/* Wall and avatar rendering. */
function setWallError(text) {
  if (!text) {
    wallError.hidden = true;
    wallError.textContent = "";
    return;
  }
  wallError.hidden = false;
  wallError.textContent = text;
}

function showWall(mode, message) {
  appEl.hidden = true;
  wallEl.hidden = false;
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
  avatarSlot.replaceChildren();
  if (!user) return;
  if (user.photoURL) {
    const img = document.createElement("img");
    img.className = "board-avatar";
    img.src = user.photoURL;
    img.alt = "";
    img.setAttribute("referrerpolicy", "no-referrer");
    avatarSlot.appendChild(img);
    return;
  }
  const fallback = document.createElement("span");
  fallback.className = "board-avatar-fallback";
  const label = (user.displayName || user.email || "?").trim();
  fallback.textContent = label ? label.charAt(0).toUpperCase() : "?";
  avatarSlot.appendChild(fallback);
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
  for (const id of TAB_IDS) {
    const panel = panelFor(id);
    if (panel) panel.replaceChildren();
  }
  avatarSlot.replaceChildren();
  showSavedState("");
  if (boardStore) {
    try { boardStore.destroy(); } catch (err) { void err; }
    boardStore = null;
  }
  layoutState = { viewModes: {}, activeTab: DEFAULT_TAB };
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
  setWallError("");
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
