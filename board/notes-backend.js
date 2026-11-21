/* The shared owner backend for the board's notes data.
 *
 * This is the owner path from dexnote/account.js (ownerVault and
 * ownerBackend), lifted for the board: the signed in user's Firebase ID
 * token is exchanged at POST /api/notes/unlock for a session token and the
 * private document, and saves go to POST /api/notes/save with that token.
 * The server decides who the owner is (lib/owner-auth.js); a 401 or a 403
 * from the unlock means this account does not open the private store.
 *
 * There is deliberately no fallback here. Dex's notes are not in Firestore:
 * the dexnote cloud backend reads users/{uid}/data/dexnote, which for Dex
 * is an empty notebook, and account.js refuses to open it in place of the
 * real one. This module never imports it and never falls back to it. If the
 * unlock exchange fails, the factory throws and the caller shows no editor.
 *
 * Used by board/notes.js (which passes the returned object to the notes
 * app's mount() as its backend) and by board/diet.js (which only reads,
 * through getDocument()).
 *
 * The returned object matches the backend interface notes/app.js expects:
 *   save(doc, baseRev), load(), beacon(doc, rev), uploadAsset(blob, type),
 *   assetSrc(key), ready(), kind, lockedText
 * plus two board extras:
 *   payload          the first unlock result, shaped for mount():
 *                    { format, content, rev, savedAt }
 *   getDocument()    the current parsed notes document in its stored,
 *                    nested shape ({ sessions, cats, ... }), or null when
 *                    nothing has been loaded yet. Updated on the factory
 *                    unlock, on every load(), and on every save().
 */

import { migrateHtml } from '/notes/state.js';

/* The unlock exchange, mirroring ownerVault in dexnote/account.js. Returns
   the parsed unlock response for the owner, null when the server refuses
   this account (401 or 403), and throws when the question could not be
   asked, so a network failure never quietly opens a different notebook. */
async function ownerVault(user) {
  if (!user || typeof user.getIdToken !== 'function') return null;
  const idToken = await user.getIdToken();
  const res = await fetch('/api/notes/unlock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`your notes could not be opened (HTTP ${res.status})`);
  return res.json();
}

/* The factory. `user` is the signed in Firebase user from the board shell's
   ctx (the same user object site-auth.js hands out, with getIdToken()).
   Performs the unlock exchange once, then returns the backend holding the
   session token that exchange minted. A session that runs out (eight idle
   hours) is reopened with a fresh ID token instead of locking the tab,
   exactly as ownerBackend in dexnote/account.js does. */
export async function createNotesBackend(user) {
  const first = await ownerVault(user);
  if (!first) {
    throw new Error('This account does not open the private notes store.');
  }

  let token = first.token;
  let currentDoc = null;
  if (first.format === 'json') currentDoc = first.content;
  else if (first.format === 'html' && typeof first.content === 'string') {
    /* A store still in the pre rebuild HTML form, migrated for readers such
       as the Diet tab. The payload below keeps the original form, because
       mount() in notes/app.js migrates it itself on first open. */
    try { currentDoc = migrateHtml(first.content); } catch { currentDoc = null; }
  }

  const post = (path, body) => fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  async function reopen() {
    const v = await ownerVault(user).catch(() => null);
    token = v ? v.token : null;
    if (v && v.format === 'json') currentDoc = v.content;
    return !!token;
  }

  async function withToken(call) {
    let res = await call(token);
    if (res.status === 401 && await reopen()) res = await call(token);
    return res;
  }

  const backend = {
    kind: 'vault',
    owner: true,
    lockedText: 'SIGNED OUT, SIGN IN TO SAVE',
    payload: {
      format: first.format,
      content: first.content,
      rev: Number(first.rev) || 0,
      savedAt: first.savedAt || null,
    },
    ready: () => !!token,
    getDocument: () => currentDoc,
    async save(doc, baseRev) {
      const res = await withToken((t) => post('/api/notes/save', { token: t, doc, baseRev }));
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { token = null; return { locked: true }; }
      if (res.status === 409) {
        if (data.doc) currentDoc = data.doc;
        return { conflict: true, doc: data.doc, rev: data.rev };
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.token) token = data.token;
      currentDoc = doc;
      return { rev: data.rev, savedAt: data.savedAt };
    },
    async load() {
      const res = await withToken((t) => post('/api/notes/unlock', { token: t }));
      if (res.status === 401) return { locked: true };
      if (!res.ok) return null;
      const data = await res.json();
      if (data.token) token = data.token;
      if (data.format !== 'json') return null;
      currentDoc = data.content;
      return { doc: data.content, rev: Number(data.rev), savedAt: data.savedAt };
    },
    beacon(doc, baseRev) {
      const blob = new Blob([JSON.stringify({ token, doc, baseRev })], { type: 'application/json' });
      return !!(navigator.sendBeacon && navigator.sendBeacon('/api/notes/save', blob));
    },
    async uploadAsset(blob, type) {
      const data = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1]);
        fr.onerror = () => reject(new Error('could not read the image'));
        fr.readAsDataURL(blob);
      });
      const res = await withToken((t) => post('/api/notes/asset', { token: t, type, data }));
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
      return out.key;
    },
    assetSrc: (key) => `/api/notes/asset?key=${encodeURIComponent(key)}&t=${encodeURIComponent(token)}`,
  };
  return backend;
}
