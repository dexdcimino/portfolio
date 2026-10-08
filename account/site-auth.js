/* The site's one account: sign in once on dexcimino.com, signed in everywhere.
 *
 * It is the Firebase project dexnote.dev already used (dexnote-d7047), so every
 * DexNote account is already a site account, with the same Google, GitHub and
 * Discord sign-ins. Each app keeps its own data under the account:
 *
 *   DexNote  Firestore users/{uid}/data/dexnote*         (dexnote/cloud.js)
 *   Inko     its own server, the handle linked to the uid (lib/sketch-store.js
 *            identifySite, reached with idToken() below)
 *   later    preferences, games, music: users/{uid}/data/<app>*
 *
 * Firebase keeps the sign-in in this origin's IndexedDB and tells every open
 * page when it changes, so a sign-in in one tab (or one overlay) reaches the
 * others on its own. LOCAL_FLAG is a cheap mirror of "someone is signed in"
 * that an app can read at boot without fetching the SDK.
 *
 * The SDK is the copy vendored under /dexnote/vendor/firebase/, imported by
 * the SAME URLs dexnote/cloud.js uses, so a page that loads both shares one
 * Firebase app (initializeApp with the same options returns the existing one).
 */

import { initializeApp, getApps } from '/dexnote/vendor/firebase/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithPopup, signOut as fbSignOut,
  GoogleAuthProvider, GithubAuthProvider, OAuthProvider,
} from '/dexnote/vendor/firebase/firebase-auth.js';

/* Public identifiers, not secrets; the same object as dexnote/cloud.js. */
export const CONFIG = {
  apiKey: 'AIzaSyCU7xuhuILTkbdcP-E2qBH3EnNKT_eWTjA',
  authDomain: 'dexnote-d7047.firebaseapp.com',
  projectId: 'dexnote-d7047',
  storageBucket: 'dexnote-d7047.firebasestorage.app',
  messagingSenderId: '981706581411',
  appId: '1:981706581411:web:afcdd27d285ba5ba9d2616',
};

export const LOCAL_FLAG = 'site:signedIn';

let auth = null;
function init() {
  if (!auth) {
    const app = getApps()[0] || initializeApp(CONFIG);
    auth = getAuth(app);
    onAuthStateChanged(auth, (u) => {
      try { u ? localStorage.setItem(LOCAL_FLAG, '1') : localStorage.removeItem(LOCAL_FLAG); } catch { /* private mode */ }
      // The homepage asks the server whether this is Dex (script.js dexOwnerCheck).
      window.dispatchEvent(new CustomEvent('site:user', { detail: { signedIn: !!u } }));
    });
  }
  return auth;
}

/* Every change of who is signed in, starting with the current one. */
export function onUser(fn) { return onAuthStateChanged(init(), fn); }

/* The current user once Firebase has read its storage (null if nobody). */
export function currentUser() {
  const a = init();
  return a.authStateReady().then(() => a.currentUser);
}

export function provider(which) {
  if (which === 'google') return new GoogleAuthProvider();
  if (which === 'github') return new GithubAuthProvider();
  if (which === 'discord') {
    // Discord is not built into Firebase; dexnote.dev set it up as an OpenID
    // Connect provider under this id.
    const p = new OAuthProvider('oidc.discord');
    p.addScope('identify');
    p.addScope('email');
    return p;
  }
  throw new Error(`no such sign-in: ${which}`);
}

export function signIn(which) { return signInWithPopup(init(), provider(which)); }

export function signOut() { return fbSignOut(init()); }

/* What a server is shown to prove who this is (lib/site-identity.js). */
export async function idToken() {
  const u = await currentUser();
  return u ? u.getIdToken() : null;
}

/* A sign-in failure in words a person can act on, with Firebase's own code
   kept on the end so a screenshot says what broke. */
export function errorText(err) {
  const code = (err && err.code) || '';
  if (code === 'auth/unauthorized-domain') return 'This address is not allowed to sign in yet.';
  if (code === 'auth/popup-blocked') return 'The sign-in window was blocked. Allow pop-ups for this site and try again.';
  if (code === 'auth/account-exists-with-different-credential') return 'That email already signs in with a different provider. Use the one you used before.';
  return `Sign-in did not work (${code || (err && err.message) || 'unknown error'}). Try again.`;
}

/* Popup-closed and cancelled are a person changing their mind, not a failure. */
export const cancelled = (err) => /popup-closed|cancelled-popup/.test((err && err.code) || '');
