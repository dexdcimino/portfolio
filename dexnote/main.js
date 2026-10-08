/* DexNote with accounts: the notes app from the homepage, as its own page.
 * The account logic (signing in, the moves between stores) is account.js,
 * shared with the homepage overlay; this file is the page around it.
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
import { emptyDoc } from '/notes/state.js';
import { menu, toast } from '/notes/ui.js';
import { el } from '/notes/dom.js';
import {
  remember, remembered, onAccount, signInCard, signOut, accountButton,
  openGuest, openAccount, unlockVault, copyVaultInto, askPassword,
} from './account.js';

const host = document.getElementById('dn-app');

let app = null;
let user = null;
let entering = 0;

/* ---- the screen before the app ------------------------------------------ */

/* Built from the app's own modal classes inside an .nt-app, so it wears the
   app's colours, type and buttons rather than a second design. */
function gate(note) {
  unmountApp();
  listen();                          // so the sign-in these buttons make is heard
  const card = signInCard({
    note,
    extra: [
      el('div', { class: 'nt-modal-btns' }, el('button', { type: 'button', class: 'nt-btn', text: 'Continue as guest', onclick: () => { remember('guest'); enterGuest(); } })),
      el('p', { class: 'nt-modal-sub', text: 'Guest notes stay on this device. Sign in any time and they move into your account.' }),
    ],
  });
  host.replaceChildren(el('div', { class: 'nt-app dn-gate', 'data-theme': 'dark' }, el('div', { class: 'nt-modal' }, card)));
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
  const account = accountButton(user, accountMenu);
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
  const { backend, stored } = await openGuest();
  await start(backend, stored);
}

async function enterAccount(u) {
  const mine = ++entering;
  user = u;
  busy('Opening your notes…');
  try {
    const { backend, stored, moved } = await openAccount(u, busy);
    if (moved) remember('account');
    if (mine !== entering) return;
    await start(backend, stored);
    if (moved) toast('The notes from this device are now in your account.');
  } catch (err) {
    console.error('dexnote: could not open the account', err);
    if (mine !== entering) return;
    gate(`Your notes could not be opened: ${err.message || err}. Try again.`);
  }
}

async function signOutNow() {
  if (app) { app.flush(); await app.save(); }
  await signOut();      // the listener shows the gate
}

/* ---- the homepage's password notes, copied into an account ---------------- */

async function bringInVault() {
  const password = await askPassword(host.querySelector('.nt-app'));
  if (!password) return;
  let vault;
  try { vault = await unlockVault(password); }
  catch (err) { toast(`${err.message || err}`, 'error'); return; }
  if (!vault) { toast('That is not the password.', 'error'); return; }
  if (app) { app.flush(); await app.save(); }
  try {
    const out = await copyVaultInto(user, vault, busy);
    if (!out) return;
    await start(out.backend, out.stored);
    toast('The password notes are now in this account.');
  } catch (err) {
    console.error('dexnote: bringing in the password notes failed', err);
    const { backend, stored } = await openAccount(user);
    await start(backend, stored);
    toast(`Not copied: ${err.message || err}`, 'error');
  }
}

/* ---- boot --------------------------------------------------------------- */

/* One listener for the life of the page. A sign-in from the gate, a sign-out
   from the menu and an earlier sign-in Firebase remembers all arrive here. */
let listening = null;
function listen() {
  return listening ||= new Promise((resolve) => {
    let first = true;
    onAccount((u) => {
      if (u) { if (!user || user.uid !== u.uid) enterAccount(u); }
      else if (user) { user = null; gate(); }
      if (first) { first = false; resolve(u); }
    });
  });
}

(async function boot() {
  // A guest who chose it before goes straight in, and Firebase is not even
  // fetched until they ask to sign in.
  if (remembered() === 'guest') { await enterGuest(); return; }
  const wasAccount = remembered() === 'account';
  if (wasAccount) busy('Opening your notes…');
  else gate();
  const u = await listen();
  if (!u && wasAccount) gate();
})();
