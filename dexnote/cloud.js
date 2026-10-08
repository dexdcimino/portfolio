/* The account store: DexNote signed in, kept in Firebase.
 *
 * It is the SAME Firebase project as dexnote.dev (dexnote-d7047), so the same
 * Google, GitHub and Discord accounts sign in here. It does not touch anything
 * the old app wrote: the document lives at its own path,
 *
 *   users/{uid}/data/dexnote        { v, rev, savedAt, parts }
 *   users/{uid}/data/dexnote-<i>    { rev, s }   the JSON, in pieces
 *   users/{uid}/images/dexnote-<sha>.<ext>      pictures, in Storage
 *   users/{uid}/data/dexnote-backup-<iso>[-<i>] a copy, before a replace
 *
 * `users/{uid}/data/*` and `users/{uid}/images/*` are already owner-only in the
 * project's rules, so nothing had to be deployed for this to work.
 *
 * WHY IN PIECES. A Firestore document stops at 1 MiB and the server stores
 * accept four. The JSON is cut into PART_CHARS-character slices (three bytes a
 * character at worst, so a slice is always under the limit) and every slice
 * carries the rev it was written for, so a read can never stitch half of one
 * save to half of another.
 *
 * THE REV CHECK IS A TRANSACTION. A save reads the head, and if someone else
 * moved it on it writes nothing and answers `conflict` with their document --
 * the same contract as the 409 from /api/notes/save, so the app merges the two
 * exactly as it does for the password store.
 */

import { initializeApp } from './vendor/firebase/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithPopup, signOut as fbSignOut,
  GoogleAuthProvider, GithubAuthProvider, OAuthProvider,
} from './vendor/firebase/firebase-auth.js';
import { getFirestore, doc, runTransaction, writeBatch } from './vendor/firebase/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from './vendor/firebase/firebase-storage.js';

/* The production project, as in github.com/dexdcimino/dexnote's
   js/firebase-config.js. These are public identifiers, not secrets: what
   protects the data is the rules, which only let a signed-in user at their
   own documents. */
const CONFIG = {
  apiKey: 'AIzaSyCU7xuhuILTkbdcP-E2qBH3EnNKT_eWTjA',
  authDomain: 'dexnote-d7047.firebaseapp.com',
  projectId: 'dexnote-d7047',
  storageBucket: 'dexnote-d7047.firebasestorage.app',
  messagingSenderId: '981706581411',
  appId: '1:981706581411:web:afcdd27d285ba5ba9d2616',
};

const PART_CHARS = 250000;

let app, auth, db, storage;
function init() {
  if (!app) {
    app = initializeApp(CONFIG);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
  }
}

export function onUser(fn) { init(); return onAuthStateChanged(auth, fn); }

export async function signIn(which) {
  init();
  let provider;
  if (which === 'google') provider = new GoogleAuthProvider();
  else if (which === 'github') provider = new GithubAuthProvider();
  else {
    // Discord is not built into Firebase; dexnote.dev set it up as an OpenID
    // Connect provider under this id.
    provider = new OAuthProvider('oidc.discord');
    provider.addScope('identify');
    provider.addScope('email');
  }
  return signInWithPopup(auth, provider);
}

export async function signOut() { init(); return fbSignOut(auth); }

const head = (uid) => doc(db, 'users', uid, 'data', 'dexnote');
const part = (uid, i) => doc(db, 'users', uid, 'data', `dexnote-${i}`);

async function readIn(tx, uid, meta) {
  const parts = [];
  for (let i = 0; i < meta.parts; i++) {
    const snap = await tx.get(part(uid, i));
    const data = snap.exists() ? snap.data() : null;
    if (!data || data.rev !== meta.rev) throw new Error('the saved notes are incomplete; try again');
    parts.push(data.s);
  }
  return JSON.parse(parts.join(''));
}

/* A copy of an account's document, made before something replaces it whole.
   Same pieces as the live one under a dated name; nothing reads these but a
   person restoring by hand. */
export async function backupCurrent(user, current) {
  init();
  const uid = user.uid;
  const name = `dexnote-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const text = JSON.stringify(current.doc);
  const count = Math.max(1, Math.ceil(text.length / PART_CHARS));
  const batch = writeBatch(db);
  for (let i = 0; i < count; i++) batch.set(doc(db, 'users', uid, 'data', `${name}-${i}`), { rev: current.rev, s: text.slice(i * PART_CHARS, (i + 1) * PART_CHARS) });
  batch.set(doc(db, 'users', uid, 'data', name), { v: 1, rev: current.rev, savedAt: current.savedAt || null, parts: count, backedUpAt: new Date().toISOString() });
  await batch.commit();
  return name;
}

export function cloudBackend(user) {
  init();
  const uid = user.uid;
  const urls = new Map();
  return {
    kind: 'cloud',
    lockedText: 'SIGNED OUT — SIGN IN TO SAVE',
    ready: () => !!auth.currentUser && auth.currentUser.uid === uid,

    async load() {
      return runTransaction(db, async (tx) => {
        const snap = await tx.get(head(uid));
        if (!snap.exists()) return null;
        const meta = snap.data();
        return { doc: await readIn(tx, uid, meta), rev: meta.rev, savedAt: meta.savedAt };
      });
    },

    async save(docJson, baseRev) {
      const text = JSON.stringify(docJson);
      return runTransaction(db, async (tx) => {
        const snap = await tx.get(head(uid));
        const meta = snap.exists() ? snap.data() : { rev: 0, parts: 0 };
        if (meta.rev !== baseRev) return { conflict: true, doc: await readIn(tx, uid, meta), rev: meta.rev };
        const rev = meta.rev + 1;
        const savedAt = new Date().toISOString();
        const count = Math.max(1, Math.ceil(text.length / PART_CHARS));
        for (let i = 0; i < count; i++) tx.set(part(uid, i), { rev, s: text.slice(i * PART_CHARS, (i + 1) * PART_CHARS) });
        for (let i = count; i < (meta.parts || 0); i++) tx.delete(part(uid, i));
        tx.set(head(uid), { v: 1, rev, savedAt, parts: count });
        return { rev, savedAt };
      });
    },

    // Firestore has no request the browser will finish after the page goes,
    // so a close falls back to an ordinary save.
    beacon: () => false,

    async uploadAsset(blob, type) {
      const { keyFor } = await import('./local.js');
      const key = await keyFor(blob, type);
      await uploadBytes(ref(storage, `users/${uid}/images/dexnote-${key}`), blob, { contentType: type });
      return key;
    },

    assetSrc(key) {
      if (!urls.has(key)) {
        urls.set(key, getDownloadURL(ref(storage, `users/${uid}/images/dexnote-${key}`))
          .catch((err) => { urls.delete(key); throw err; }));
      }
      return urls.get(key);
    },
  };
}
