/* The DexNote account: who is signed in, and every move between the stores.
 *
 * Shared by the two places the notes app is mounted with accounts:
 *   /dexnote/          (dexnote/main.js), a page of its own
 *   the homepage overlay (script.js, LIVE NOTES), opened by the keypad, the
 *                       tilde prompt, the Idea Vault or the AI Lab
 * so a sign-in, the guest notes moving in and the password notes being copied
 * across behave the same wherever they happen. Nothing in here draws the app;
 * it hands each caller a backend and a document to mount, and the caller
 * decides what that looks like on its page.
 *
 * KEPT LIFTABLE. The site is meant to grow one account for everything (notes,
 * Inko, music). Firebase is confined to cloud.js and the provider sign-in to
 * signIn() below, so this module is the seam that moves when that happens.
 */

import { normalize, merge, migrateHtml } from '/notes/state.js';
import { confirm, toast } from '/notes/ui.js';
import { el, escapeHtml } from '/notes/dom.js';
import { localBackend, guestDoc, guestAsset, clearGuest, typeOf } from '/dexnote/local.js';

const MODE_KEY = 'dexnote:mode';     // 'guest' | 'account', so a visit knows whether to fetch Firebase at all
const KEY_RE = /data-key="([0-9a-f]{64}\.(?:png|jpg|webp|gif))"/g;

let cloud = null;
export const loadCloud = () => (cloud ||= import('/dexnote/cloud.js'));
export const remember = (mode) => { try { mode ? localStorage.setItem(MODE_KEY, mode) : localStorage.removeItem(MODE_KEY); } catch { /* private mode */ } };
export const remembered = () => { try { return localStorage.getItem(MODE_KEY); } catch { return null; } };

/* ---- who is signed in --------------------------------------------------- */

/* ONE Firebase listener for the life of the page, however many things want to
   know. Started on first need: a visitor who never signed in never fetches
   Firebase, because nothing asks until they press Sign in. */
let user = null;
const subscribers = new Set();
let listening = null;
let settled = false;
function listen() {
  return listening ||= loadCloud().then(({ onUser }) => new Promise((resolve) => {
    let first = true;
    onUser((u) => {
      user = u || null;
      remember(u ? 'account' : remembered() === 'account' ? null : remembered());
      for (const fn of [...subscribers]) { try { fn(user); } catch (err) { console.error('dexnote: account listener threw', err); } }
      if (first) { first = false; settled = true; resolve(user); }
    });
  }));
}

export const currentUser = () => user;

/* fn(user|null) now and on every change. Returns the unsubscribe. */
export function onAccount(fn) {
  subscribers.add(fn);
  // A late subscriber still hears where things stand.
  if (settled) queueMicrotask(() => subscribers.has(fn) && fn(user));
  listen();
  return () => subscribers.delete(fn);
}

/* Signed in through the SITE's panel (account/site-auth.js, ~DEXDC) rather
   than here: the same Firebase account, so the notes are the account's too. */
const siteSignedIn = () => { try { return localStorage.getItem('site:signedIn') === '1'; } catch { return false; } };

/* Who is signed in right now -- WITHOUT loading Firebase for someone who has
   never signed in on this browser. */
export async function whoIsHere() {
  if (remembered() !== 'account' && !siteSignedIn() && !listening) return null;
  return listen();
}

/* ---- signing in ---------------------------------------------------------- */

export function signInError(err) {
  const code = (err && err.code) || '';
  if (code === 'auth/unauthorized-domain') return 'This address is not allowed to sign in yet. It has to be added to the Firebase project’s authorized domains.';
  if (code === 'auth/popup-blocked') return 'The sign-in window was blocked. Allow pop-ups for this site and try again.';
  if (code === 'auth/account-exists-with-different-credential') return 'That email already signs in with a different provider. Use the one you used before.';
  return `Sign-in did not work (${code || (err && err.message) || 'unknown error'}). Try again.`;
}

/* The sign-in card, laid out like the site's own sign-in panel (openSiteSignIn
   in script.js, .signin-* in styles.css) with dexnote's mark, name and two
   lines in place of the site's: each provider is its mark and its name, no
   "Continue with" (Dex, 2026-10-09). Drawn from notes.css, which /dexnote/ and
   the homepage overlay both load. `signedIn(user)` runs once Firebase says the
   sign-in landed; `error` is a line to show in red from the start (the notes
   could not be opened); `extra` is whatever the caller puts underneath (the
   page's "Continue as guest", the overlay's "Not now"). */
// Google, Discord, GitHub: the order Dex asked for, 2026-10-09.
const PROVIDERS = [['google', 'Google'], ['discord', 'Discord'], ['github', 'GitHub']];
export function signInCard({ error: firstError, signedIn, extra } = {}) {
  const provider = ([which, name], i) => el('button', {
    type: 'button', class: `dn-provider${i === 0 ? ' is-primary' : ''}`, 'aria-label': `Sign in with ${name}`, onclick: go(which),
  }, el('span', { class: 'dn-mark', 'data-provider': which, 'aria-hidden': 'true' }), el('span', { text: name }));
  const error = el('p', { class: 'dn-error', hidden: !firstError, text: firstError || '' });
  function go(which) {
    return async () => {
      error.hidden = true;
      try {
        await listen();
        const cred = await (await loadCloud()).signIn(which);
        remember('account');
        if (signedIn) signedIn(cred.user);
      } catch (err) {
        if (err && /popup-closed|cancelled-popup/.test(err.code || '')) return;
        console.warn('dexnote: sign-in failed', err);
        error.textContent = signInError(err);
        error.hidden = false;
      }
    };
  }
  return el('div', { class: 'nt-modal-card dn-card', role: 'dialog', 'aria-label': 'Sign in to dexnote' },
    el('img', { class: 'dn-logo', src: '/dexnote/icons/logo-v2.svg', alt: '' }),
    el('h3', { class: 'dn-title', text: 'dexnote' }),
    el('p', { class: 'dn-note' }, el('span', { text: 'Your notes, on every device.' }), el('span', { text: 'Sign in and they follow you.' })),
    el('div', { class: 'dn-providers' }, ...PROVIDERS.map(provider)),
    error,
    ...(extra || []));
}

/* The same card as a sheet over a mounted app. Resolves with the user once
   they are signed in, or null if they backed out. With `signOut` (someone is
   already signed in -- ~DEXDC, Dex 2026-10-08) it also offers Sign out, and
   resolves 'signout' when that is pressed. */
export function signInSheet(root, _note, { signOut = false } = {}) {
  return new Promise((resolve) => {
    const close = (value) => { wrap.remove(); resolve(value); };
    const btns = el('div', { class: 'nt-modal-btns' });
    if (signOut) btns.append(el('button', { type: 'button', class: 'nt-btn is-danger is-left', text: 'Sign out', onclick: () => close('signout') }));
    btns.append(el('button', { type: 'button', class: 'nt-btn', text: 'Not now', onclick: () => close(null) }));
    const card = signInCard({
      signedIn: (u) => close(u),
      extra: [btns],
    });
    const wrap = el('div', { class: 'nt-modal', onmousedown: (e) => { if (e.target === wrap) close(null); } }, card);
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); } });
    root.append(wrap);
    card.querySelector('.dn-provider')?.focus();
  });
}

export async function signOut() {
  remember(null);
  await (await loadCloud()).signOut();
}

const ICON_USER = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';

/* The account control in the app's header: the person's picture once signed
   in, a plain figure before. The caller says what a press does. */
export function accountButton(u, onclick) {
  const b = el('button', {
    type: 'button', class: 'nt-icon-btn dn-account', 'aria-label': u ? 'Account' : 'Sign in',
    'data-tip': u ? (u.displayName || u.email || 'Account') : 'Sign in',
    html: ICON_USER,
  });
  if (u && u.photoURL) b.replaceChildren(el('img', { class: 'dn-avatar', src: u.photoURL, alt: '', referrerpolicy: 'no-referrer' }));
  b.addEventListener('click', () => onclick(b));
  return b;
}

/* ---- the stores ---------------------------------------------------------- */

export async function openGuest() {
  const backend = localBackend();
  return { backend, stored: await backend.load() };
}

/* A body's pictures, by key. */
const keysIn = (json) => [...new Set([...json.matchAll(KEY_RE)].map((m) => m[1]))];

/* Anything a person would miss: text, a picture, a renamed or extra
   category or session. A fresh guest document is none of those. */
export function hasContent(doc) {
  const d = normalize(doc);
  if (d.sessions.length > 1) return true;
  return d.sessions.some((s) => s.archived.length || s.cats.length > 1 || s.cats.some((c) =>
    c.title !== 'New Category' || /<img/.test(c.body) || c.body.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()));
}

/* ---- Dex's account IS the DEXDC notes ------------------------------------ */

/* The server decides, never this file: /api/notes/unlock is handed the
   account's ID token and answers with the keypad's document only for Dex's
   verified Google (lib/site-identity.js isOwner). Any other account is a 403
   and keeps its own notes in Firebase. So there is one document, not a copy
   that drifts: the phone, /dexnote/ and the keypad all save to it, and the
   rev check that already merges two devices covers all three.
   Returns { token, payload } for Dex, null for anyone else, and THROWS when
   the question could not be asked -- a network failure must not quietly open
   the Firebase notes in the DEXDC notes' place. */
async function ownerVault(u) {
  if (!u || typeof u.getIdToken !== 'function') return null;
  const idToken = await u.getIdToken();
  const res = await fetch('/api/notes/unlock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }) });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`your notes could not be opened (HTTP ${res.status})`);
  return res.json();
}

/* The keypad's store, for a signed-in Dex. The same calls the overlay's
   vault backend makes (notes/app.js), with one difference: a session that
   runs out (eight idle hours) is reopened with a fresh ID token instead of
   asking for the password. */
function ownerBackend(u, first) {
  let token = first;
  const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  async function reopen() {
    const v = await ownerVault(u).catch(() => null);
    token = v ? v.token : null;
    return !!token;
  }
  async function withToken(call) {
    let res = await call(token);
    if (res.status === 401 && await reopen()) res = await call(token);
    return res;
  }
  return {
    kind: 'vault',
    owner: true,
    lockedText: 'SIGNED OUT — SIGN IN TO SAVE',
    ready: () => !!token,
    async save(doc, baseRev) {
      const res = await withToken((t) => post('/api/notes/save', { token: t, doc, baseRev }));
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { token = null; return { locked: true }; }
      if (res.status === 409) return { conflict: true, doc: data.doc, rev: data.rev };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.token) token = data.token;
      return { rev: data.rev, savedAt: data.savedAt };
    },
    async load() {
      const res = await withToken((t) => post('/api/notes/unlock', { token: t }));
      if (res.status === 401) return { locked: true };
      if (!res.ok) return null;
      const data = await res.json();
      if (data.token) token = data.token;
      if (data.format !== 'json') return null;
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
}

/* An account's notes, with this browser's guest notes moved in first if
   there are any: pictures uploaded, the two merged (the account's settings
   win, every session from both sides is kept), the browser's copy cleared.
   `busy(text)` is told what is happening. Returns { backend, stored, moved }. */
export async function openAccount(u, busy = () => {}) {
  /* Dex first. NOTHING is moved into the DEXDC notes automatically: a guest
     document on this device stays where it is, untouched, for him to look at
     signed out. `owner` tells the caller not to offer the password-notes copy,
     which would be copying the document onto itself. */
  const vault = await ownerVault(u);
  if (vault) {
    const backend = ownerBackend(u, vault.token);
    /* A store still in the pre-rebuild HTML is migrated here, the way the
       keypad used to migrate it on its first open; with DEXDC retired
       (2026-10-08) this is the only door left. Nothing is written until the
       first edit saves, over the rev the server gave. */
    const doc = vault.format === 'json' ? vault.content : migrateHtml(vault.content);
    return { backend, stored: { doc, rev: Number(vault.rev), savedAt: vault.savedAt }, moved: false, owner: true };
  }
  const { cloudBackend } = await loadCloud();
  const backend = cloudBackend(u);
  let stored = await backend.load();
  const guest = guestDoc();
  if (!guest || !hasContent(guest.doc)) return { backend, stored, moved: false };

  busy('Moving the notes on this device into your account…');
  const json = JSON.stringify(guest.doc);
  for (const key of keysIn(json)) {
    const blob = await guestAsset(key);
    if (blob) await backend.uploadAsset(blob, typeOf(key));
  }
  let merged = stored ? merge(normalize(stored.doc), normalize(guest.doc)) : normalize(guest.doc);
  let res = await backend.save(merged, stored ? stored.rev : 0);
  if (res.conflict) {
    merged = merge(normalize(res.doc), normalize(guest.doc));
    res = await backend.save(merged, res.rev);
    if (res.conflict) throw new Error('the account changed while the notes were moving; try again');
  }
  await clearGuest();
  return { backend, stored: { doc: merged, rev: res.rev, savedAt: res.savedAt }, moved: true };
}

/* ---- the password notes, copied into an account --------------------------- */

/* The keypad's door, for a caller that has no token yet. Null on a wrong
   password. */
export async function unlockVault(password) {
  const res = await fetch('/api/notes/unlock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`the password notes could not be opened (HTTP ${res.status})`);
  return res.json();
}

/* READ ONLY on the password store: `vault` is what /api/notes/unlock answered
   (its document and a token), and each picture is fetched with that token.
   The account's current document is kept as a backup copy before it is
   replaced, so nothing is lost by bringing them in twice. Asks first; returns
   { backend, stored } once copied, or null if the person said no. */
export async function copyVaultInto(u, vault, busy = () => {}) {
  const doc = vault.format === 'json' ? normalize(vault.content) : migrateHtml(vault.content);
  const cats = doc.sessions.reduce((n, s) => n + s.cats.length, 0);
  const ok = await confirm({
    title: 'Replace this account’s notes?',
    msg: `Everything in <b>${escapeHtml(u.email || u.displayName || 'this account')}</b> is replaced with the password notes: ${doc.sessions.length} session${doc.sessions.length === 1 ? '' : 's'}, ${cats} categor${cats === 1 ? 'y' : 'ies'}.`,
    sub: 'What is in the account now is kept as a backup copy. The password notes themselves are not changed.',
    ok: 'Replace', danger: true,
  });
  if (ok !== 'ok') return null;

  const { cloudBackend, backupCurrent } = await loadCloud();
  const backend = cloudBackend(u);
  busy('Copying the password notes into your account…');
  const keys = keysIn(JSON.stringify(doc));
  let n = 0;
  for (const key of keys) {
    busy(`Copying pictures… ${++n} of ${keys.length}`);
    const img = await fetch(`/api/notes/asset?key=${encodeURIComponent(key)}&t=${encodeURIComponent(vault.token)}`);
    if (!img.ok) { console.warn('dexnote: picture not copied', key, img.status); continue; }
    await backend.uploadAsset(await img.blob(), typeOf(key));
  }
  const current = await backend.load();
  if (current) await backupCurrent(u, current);
  const out = await backend.save(doc, current ? current.rev : 0);
  if (out.conflict) throw new Error('the account changed at the same moment; try again');
  return { backend, stored: { doc, rev: out.rev, savedAt: out.savedAt } };
}

export function askPassword(root) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'password', class: 'dn-input', autocomplete: 'current-password', 'aria-label': 'Password' });
    const close = (value) => { wrap.remove(); resolve(value); };
    const okBtn = el('button', { type: 'button', class: 'nt-btn is-primary', text: 'Open', onclick: () => close(input.value) });
    const card = el('form', { class: 'nt-modal-card', role: 'dialog', 'aria-modal': 'true', onsubmit: (e) => { e.preventDefault(); close(input.value); } },
      el('h3', { class: 'nt-modal-title', text: 'The password notes' }),
      el('p', { class: 'nt-modal-msg', text: 'The code you type on the homepage keypad.' }),
      input,
      el('div', { class: 'nt-modal-btns' }, el('button', { type: 'button', class: 'nt-btn', text: 'Cancel', onclick: () => close(null) }), okBtn));
    const wrap = el('div', { class: 'nt-modal', onmousedown: (e) => { if (e.target === wrap) close(null); } }, card);
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); } });
    root.append(wrap);
    input.focus();
  });
}

export { toast };
