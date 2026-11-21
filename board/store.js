/* Dex Board Firestore store.
   Docs live at users/{uid}/data/<name> under the existing rules, which
   lock each doc to its owner uid. The board page only creates this store
   after the server owner check has passed, so no Firestore call happens
   for a signed out visitor or for a signed in non owner.
   The CONFIG and the shared Firebase app come from the site account
   module, and the SDK is the vendored copy under dexnote. */

import { initializeApp, getApps } from "/dexnote/vendor/firebase/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from "/dexnote/vendor/firebase/firebase-firestore.js";
import { CONFIG } from "/account/site-auth.js";

export const BOARD_DOC_NAMES = [
  "board-overview",
  "board-schedule",
  "board-diet",
  "board-layout",
  "board-exercise",
  "board-work",
];

const SAVE_DEBOUNCE_MS = 1000;
const META_FIELD = "_boardSavedAt";

function assertName(name) {
  if (!BOARD_DOC_NAMES.includes(name)) {
    throw new Error("unknown board doc name: " + String(name));
  }
}

function unwrap(data) {
  if (!data || typeof data !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(data, "value") && Object.keys(data).length <= 2) {
    return data.value;
  }
  const copy = Object.assign({}, data);
  delete copy[META_FIELD];
  return copy;
}

function wrap(data) {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return Object.assign({}, data, { [META_FIELD]: new Date().toISOString() });
  }
  return { value: data === undefined ? null : data, [META_FIELD]: new Date().toISOString() };
}

/* createBoardStore(uid, onSavedState)
   onSavedState, when given, is called with "saving", "saved" or "error"
   so the shell can show a small saved indicator.
   Returns { load, save, listen, flush, uid }. */
export function createBoardStore(uid, onSavedState) {
  if (!uid) throw new Error("createBoardStore needs a uid");
  const app = getApps()[0] || initializeApp(CONFIG);
  const db = getFirestore(app);
  const timers = new Map();
  const pending = new Map();
  const listeners = new Map();

  const notify = (state) => {
    if (typeof onSavedState === "function") {
      try { onSavedState(state); } catch (err) { console.warn("board store: saved callback threw", err); }
    }
  };

  const refFor = (name) => doc(db, "users", uid, "data", name);

  async function writeNow(name) {
    if (!pending.has(name)) return true;
    const data = pending.get(name);
    pending.delete(name);
    notify("saving");
    try {
      await setDoc(refFor(name), wrap(data), { merge: false });
      notify("saved");
      return true;
    } catch (err) {
      console.warn("board store: save failed for " + name, err);
      if (!pending.has(name)) pending.set(name, data);
      notify("error");
      return false;
    }
  }

  function load(name) {
    assertName(name);
    return getDoc(refFor(name)).then((snap) => {
      if (!snap.exists()) return null;
      return unwrap(snap.data());
    });
  }

  function save(name, data) {
    assertName(name);
    pending.set(name, data);
    notify("saving");
    if (timers.has(name)) clearTimeout(timers.get(name));
    const timer = setTimeout(() => {
      timers.delete(name);
      void writeNow(name);
    }, SAVE_DEBOUNCE_MS);
    timers.set(name, timer);
  }

  function listen(name, cb) {
    assertName(name);
    if (typeof cb !== "function") throw new Error("listen needs a callback");
    const unsub = onSnapshot(refFor(name), (snap) => {
      cb(snap.exists() ? unwrap(snap.data()) : null);
    }, (err) => {
      console.warn("board store: listen failed for " + name, err);
    });
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(unsub);
    return () => {
      const set = listeners.get(name);
      if (set) set.delete(unsub);
      unsub();
    };
  }

  async function flush(name) {
    if (name) {
      assertName(name);
      if (timers.has(name)) { clearTimeout(timers.get(name)); timers.delete(name); }
      return writeNow(name);
    }
    const names = Array.from(pending.keys());
    for (const n of names) {
      if (timers.has(n)) { clearTimeout(timers.get(n)); timers.delete(n); }
    }
    let ok = true;
    for (const n of names) {
      const done = await writeNow(n);
      if (!done) ok = false;
    }
    return ok;
  }

  function destroy() {
    if (typeof window !== "undefined") {
      try { window.removeEventListener("pagehide", onPageHide); } catch (err) { void err; }
    }
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    for (const set of listeners.values()) {
      for (const unsub of set) { try { unsub(); } catch (err) { void err; } }
    }
    listeners.clear();
  }

  const onPageHide = () => { void flush(); };
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", onPageHide);
  }

  return { load, save, listen, flush, destroy, uid };
}

export default createBoardStore;
