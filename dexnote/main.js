/* DexNote with accounts: the notes app from the homepage, as its own page.
 *
 * Three ways in, one app:
 *   a guest     -> dexnote/local.js, everything stays in this browser
 *   an account  -> dexnote/cloud.js, Firebase (Google, GitHub or Discord)
 *   a first sign-in with guest notes here -> they are merged into the account
 *     and the browser's copy is cleared, the way Inko does it
 *
 * The app itself (notes/app.js) is the one the homepage overlay mounts, with a
 * backend instead of a token; nothing about how it looks or behaves is changed
 * here. The homepage's password notes are untouched by this page, except that
 * an account can copy them in (bringInVault below), which only ever reads them.
 */

import { mount } from '/notes/app.js';
import { normalize, merge, migrateHtml, emptyDoc } from '/notes/state.js';
import { menu, confirm, toast } from '/notes/ui.js';
import { el, escapeHtml } from '/notes/dom.js';
import { localBackend, guestDoc, guestAsset, clearGuest, typeOf } from './local.js';

const host = document.getElementById('dn-app');
const MODE_KEY = 'dexnote:mode';     // 'guest' once someone chose it, so the next visit goes straight in
const KEY_RE = /data-key="([0-9a-f]{64}\.(?:png|jpg|webp|gif))"/g;

let cloud = null;                    // the Firebase module, loaded on first need
let app = null;
let user = null;
let entering = 0;

const loadCloud = () => (cloud ||= import('./cloud.js'));
const remember = (mode) => { try { mode ? localStorage.setItem(MODE_KEY, mode) : localStorage.removeItem(MODE_KEY); } catch { /* private mode */ } };
const remembered = () => { try { return localStorage.getItem(MODE_KEY); } catch { return null; } };

const ICON_USER = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';

/* ---- the screen before the app ------------------------------------------ */

/* Built from the app's own modal classes inside an .nt-app, so it wears the
   app's colours, type and buttons rather than a second design. */
function gate(note) {
  unmountApp();
  const btn = (label, onclick, primary) => el('button', { type: 'button', class: `nt-btn ${primary ? 'is-primary' : ''}`, text: label, onclick });
  const error = el('p', { class: 'nt-modal-sub dn-error', hidden: true });
  const go = (which) => async () => {
    error.hidden = true;
    try { await listen(); await (await loadCloud()).signIn(which); }   // the listener does the rest
    catch (err) {
      if (err && /popup-closed|cancelled-popup/.test(err.code || '')) return;
      console.warn('dexnote: sign-in failed', err);
      error.textContent = signInError(err);
      error.hidden = false;
    }
  };
  const card = el('div', { class: 'nt-modal-card dn-card', role: 'dialog', 'aria-label': 'Sign in to DexNote' },
    el('img', { class: 'dn-logo', src: '/dexnote/icons/logo.svg', alt: '' }),
    el('h3', { class: 'nt-modal-title', text: 'DexNote' }),
    el('p', { class: 'nt-modal-msg', text: note || 'Sign in to keep your notes in your account, on every device.' }),
    el('div', { class: 'dn-providers' },
      btn('Continue with Google', go('google'), true),
      btn('Continue with GitHub', go('github')),
      btn('Continue with Discord', go('discord'))),
    error,
    el('div', { class: 'nt-modal-btns' }, btn('Continue as guest', () => { remember('guest'); enterGuest(); })),
    el('p', { class: 'nt-modal-sub', text: 'Guest notes stay on this device. Sign in any time and they move into your account.' }));
  host.replaceChildren(el('div', { class: 'nt-app dn-gate', 'data-theme': 'dark' }, el('div', { class: 'nt-modal' }, card)));
}

function signInError(err) {
  const code = (err && err.code) || '';
  if (code === 'auth/unauthorized-domain') return 'This address is not allowed to sign in yet. It has to be added to the Firebase project’s authorized domains.';
  if (code === 'auth/popup-blocked') return 'The sign-in window was blocked. Allow pop-ups for this site and try again.';
  if (code === 'auth/account-exists-with-different-credential') return 'That email already signs in with a different provider. Use the one you used before.';
  return 'Sign-in did not work. Try again.';
}

function busy(text) {
  unmountApp();
  host.replaceChildren(el('div', { class: 'nt-app dn-gate', 'data-theme': 'dark' },
    el('div', { class: 'nt-modal' }, el('div', { class: 'nt-modal-card dn-card' }, el('p', { class: 'nt-modal-msg', text })))));
}

/* ---- mounting ------------------------------------------------------------ */

function unmountApp() {
  if (app) { try { app.unmount(); } catch (err) { console.warn('dexnote: unmount threw', err); } }
  app = null;
}

async function start(backend, stored) {
  unmountApp();
  host.replaceChildren();
  const account = el('button', {
    type: 'button', class: 'nt-icon-btn dn-account', 'aria-label': 'Account', 'data-tip': user ? (user.displayName || user.email || 'Account') : 'Guest · sign in',
    html: ICON_USER,
  });
  if (user && user.photoURL) account.replaceChildren(el('img', { class: 'dn-avatar', src: user.photoURL, alt: '', referrerpolicy: 'no-referrer' }));
  account.addEventListener('click', () => accountMenu(account));
  const payload = stored
    ? { format: 'json', content: stored.doc, rev: stored.rev, savedAt: stored.savedAt }
    : { format: 'json', content: emptyDoc(), rev: 0 };
  app = await mount(host, { payload, backend, headerTail: account });
}

function accountMenu(anchor) {
  const items = user ? [
    { label: user.email || user.displayName || 'Signed in', disabled: true, run() {} },
    null,
    { label: 'Bring in the password notes…', run: bringInVault },
    { label: 'Sign out', danger: true, run: signOutNow },
  ] : [
    { label: 'Guest · saved on this device', disabled: true, run() {} },
    null,
    { label: 'Sign in…', run: () => { app && app.flush(); gate('Sign in and the notes on this device move into your account.'); } },
  ];
  menu(anchor, items, { align: 'right' });
}

async function enterGuest() {
  user = null;
  const backend = localBackend();
  await start(backend, await backend.load());
}

/* A body's pictures, by key. */
const keysIn = (json) => [...new Set([...json.matchAll(KEY_RE)].map((m) => m[1]))];

/* Anything a person would miss: text, a picture, a renamed or extra
   category or session. A fresh guest document is none of those. */
function hasContent(doc) {
  const d = normalize(doc);
  if (d.sessions.length > 1) return true;
  return d.sessions.some((s) => s.archived.length || s.cats.length > 1 || s.cats.some((c) =>
    c.title !== 'New Category' || /<img/.test(c.body) || c.body.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()));
}

async function enterAccount(u) {
  const mine = ++entering;
  user = u;
  busy('Opening your notes…');
  const { cloudBackend } = await loadCloud();
  const backend = cloudBackend(u);
  try {
    let stored = await backend.load();
    const guest = guestDoc();
    if (guest && hasContent(guest.doc)) {
      busy('Moving the notes on this device into your account…');
      const json = JSON.stringify(guest.doc);
      for (const key of keysIn(json)) {
        const blob = await guestAsset(key);
        if (blob) await backend.uploadAsset(blob, typeOf(key));
      }
      // The account's settings win; every session from both sides is kept.
      let merged = stored ? merge(normalize(stored.doc), normalize(guest.doc)) : normalize(guest.doc);
      let res = await backend.save(merged, stored ? stored.rev : 0);
      if (res.conflict) {
        merged = merge(normalize(res.doc), normalize(guest.doc));
        res = await backend.save(merged, res.rev);
        if (res.conflict) throw new Error('the account changed while the notes were moving; try again');
      }
      stored = { doc: merged, rev: res.rev, savedAt: res.savedAt };
      await clearGuest();
      remember(null);
      if (mine !== entering) return;
      await start(backend, stored);
      toast('The notes from this device are now in your account.');
      return;
    }
    if (mine !== entering) return;
    await start(backend, stored);
  } catch (err) {
    console.error('dexnote: could not open the account', err);
    if (mine !== entering) return;
    gate(`Your notes could not be opened: ${err.message || err}. Try again.`);
  }
}

async function signOutNow() {
  if (app) { app.flush(); await app.save(); }
  remember(null);
  await (await loadCloud()).signOut();      // onUser shows the gate
}

/* ---- the homepage's password notes, copied into an account ---------------- */

/* READ ONLY on the password store: one unlock, then each picture fetched with
   the token it returns. The account's current document is kept as a backup
   copy before it is replaced, so nothing is lost by bringing them in twice. */
async function bringInVault() {
  const password = await askPassword();
  if (!password) return;
  const res = await fetch('/api/notes/unlock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
  if (res.status === 401 || res.status === 403) { toast('That is not the password.', 'error'); return; }
  if (!res.ok) { toast(`The password notes could not be opened (HTTP ${res.status}).`, 'error'); return; }
  const data = await res.json();
  const vault = data.format === 'json' ? normalize(data.content) : migrateHtml(data.content);
  const cats = vault.sessions.reduce((n, s) => n + s.cats.length, 0);
  const ok = await confirm({
    title: 'Replace this account’s notes?',
    msg: `Everything in <b>${escapeHtml(user.email || user.displayName || 'this account')}</b> is replaced with the password notes: ${vault.sessions.length} session${vault.sessions.length === 1 ? '' : 's'}, ${cats} categor${cats === 1 ? 'y' : 'ies'}.`,
    sub: 'What is in the account now is kept as a backup copy. The password notes themselves are not changed.',
    ok: 'Replace', danger: true,
  });
  if (ok !== 'ok') return;

  const { cloudBackend, backupCurrent } = await loadCloud();
  const backend = cloudBackend(user);
  if (app) { app.flush(); await app.save(); }
  busy('Copying the password notes into your account…');
  try {
    const keys = keysIn(JSON.stringify(vault));
    let n = 0;
    for (const key of keys) {
      busy(`Copying pictures… ${++n} of ${keys.length}`);
      const img = await fetch(`/api/notes/asset?key=${encodeURIComponent(key)}&t=${encodeURIComponent(data.token)}`);
      if (!img.ok) { console.warn('dexnote: picture not copied', key, img.status); continue; }
      await backend.uploadAsset(await img.blob(), typeOf(key));
    }
    const current = await backend.load();
    if (current) await backupCurrent(user, current);
    const out = await backend.save(vault, current ? current.rev : 0);
    if (out.conflict) throw new Error('the account changed at the same moment; try again');
    await start(backend, { doc: vault, rev: out.rev, savedAt: out.savedAt });
    toast('The password notes are now in this account.');
  } catch (err) {
    console.error('dexnote: bringing in the password notes failed', err);
    await start(backend, await backend.load());
    toast(`Not copied: ${err.message || err}`, 'error');
  }
}

function askPassword() {
  return new Promise((resolve) => {
    const root = host.querySelector('.nt-app');
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

/* ---- boot --------------------------------------------------------------- */

/* One listener for the life of the page. A sign-in from the gate, a sign-out
   from the menu and an earlier sign-in Firebase remembers all arrive here. */
let listening = null;
function listen() {
  return listening ||= loadCloud().then(({ onUser }) => new Promise((resolve) => {
    let first = true;
    onUser((u) => {
      if (u) { remember('account'); if (!user || user.uid !== u.uid) enterAccount(u); }
      else if (user) { user = null; remember(null); gate(); }
      if (first) { first = false; resolve(u); }
    });
  }));
}

(async function boot() {
  // A guest who chose it before goes straight in, and Firebase is not even
  // fetched until they ask to sign in.
  if (remembered() === 'guest') { await enterGuest(); return; }
  if (remembered() === 'account') busy('Opening your notes…');
  else gate();
  const u = await listen();
  if (!u && remembered() === 'account') { remember(null); gate(); }
})();
