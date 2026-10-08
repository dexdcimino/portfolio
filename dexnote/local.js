/* The guest store: DexNote with no account, kept in this browser only.
 *
 * The document is one localStorage entry, `{ rev, savedAt, doc }`, so a save
 * is synchronous and the pagehide flush cannot lose it. Pictures are blobs in
 * IndexedDB under the same `<sha256>.<ext>` keys the server stores use, which
 * is what lets them move into an account unchanged on the first sign-in.
 *
 * The rev check is the same one the server stores make: a second tab that
 * saved first answers `conflict`, and the app merges exactly as it would for a
 * second device.
 */

const DOC_KEY = 'dexnote:guest:v1';
const DB_NAME = 'dexnote-guest';
const DB_STORE = 'assets';

function read() {
  try { const raw = localStorage.getItem(DOC_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

let dbOpen = null;
function db() {
  if (!dbOpen) {
    dbOpen = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbOpen;
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(DB_STORE, mode);
    const req = fn(tx.objectStore(DB_STORE));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}

/* The same names lib/notes-store.js gives the same bytes. */
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
export const typeOf = (key) => Object.keys(EXT).find((t) => key.endsWith(`.${EXT[t]}`)) || 'image/webp';

export async function keyFor(blob, type) {
  const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${sha}.${EXT[type] || 'webp'}`;
}

const urls = new Map();

export function localBackend() {
  return {
    kind: 'local',
    lockedText: 'NOT SAVED',
    ready: () => true,
    async save(doc, baseRev) {
      const cur = read();
      if (cur && cur.rev > baseRev) return { conflict: true, doc: cur.doc, rev: cur.rev };
      const out = { rev: (cur ? cur.rev : 0) + 1, savedAt: new Date().toISOString(), doc };
      localStorage.setItem(DOC_KEY, JSON.stringify(out));
      return { rev: out.rev, savedAt: out.savedAt };
    },
    async load() { return read(); },
    beacon(doc, baseRev) {
      const cur = read();
      if (cur && cur.rev > baseRev) return false;
      try {
        localStorage.setItem(DOC_KEY, JSON.stringify({ rev: (cur ? cur.rev : 0) + 1, savedAt: new Date().toISOString(), doc }));
        return true;
      } catch { return false; }
    },
    async uploadAsset(blob, type) {
      const key = await keyFor(blob, type);
      await idb('readwrite', (s) => s.put(blob, key));
      return key;
    },
    assetSrc(key) {
      if (urls.has(key)) return urls.get(key);
      return idb('readonly', (s) => s.get(key)).then((blob) => {
        if (!blob) return '';
        const url = URL.createObjectURL(blob);
        urls.set(key, url);
        return url;
      });
    },
  };
}

/* For the move into an account: what is here, the pictures it uses, and
 * forgetting both once the account has them. */
export const guestDoc = () => read();
export const guestAsset = (key) => idb('readonly', (s) => s.get(key));
export async function clearGuest() {
  localStorage.removeItem(DOC_KEY);
  try { await idb('readwrite', (s) => s.clear()); } catch { /* nothing stored */ }
}
