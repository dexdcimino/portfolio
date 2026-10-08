/* DexNote with accounts: the notes app from the homepage, as its own page --
 * and, installed from the AI Lab's download button, the DexNote phone app.
 * The account logic (signing in, the moves between stores) is account.js,
 * shared with the homepage overlay; this file is the page around it.
 *
 * Three ways in, one app:
 *   a guest     -> dexnote/local.js, everything stays in this browser
 *   an account  -> dexnote/cloud.js, Firebase (Google, GitHub or Discord)
 *   Dex's own Google -> the DEXDC notes themselves, the keypad's document,
 *     decided by the server (account.js ownerVault); nothing is copied
 *   a first sign-in with guest notes here -> they are merged into the account
 *     and the browser's copy is cleared, the way Inko does it -- except into
 *     the DEXDC notes, which are never written to without Dex doing it
 *
 * The app itself (notes/app.js) is the one the homepage overlay mounts, with a
 * backend instead of a token. On a phone it is mounted with the shell in
 * dexnote/mobile.js, which moves the header into a bar along the bottom.
 */

import { mount } from '/notes/app.js';
import { emptyDoc } from '/notes/state.js';
import { menu, toast } from '/notes/ui.js';
import { el } from '/notes/dom.js';
import {
  remember, remembered, onAccount, signInCard, signInSheet, signOut, accountButton,
  openGuest, openAccount, unlockVault, copyVaultInto, askPassword,
} from './account.js';
import { phoneShell, MARK } from './mobile.js';

const host = document.getElementById('dn-app');

/* A phone is a narrow screen. An installed app on a desktop keeps the
   desktop layout; a phone in the browser gets the phone layout too, so the
   two are the same thing before and after installing. */
const PHONE = matchMedia('(max-width: 820px)').matches;
const STANDALONE = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
document.documentElement.classList.toggle('dn-phone', PHONE);

let app = null;
let phone = null;        // the shell, while mounted on a phone
let user = null;
let owner = false;       // the account open is Dex's: the DEXDC notes
let entering = 0;

/* ---- the screen before the app ------------------------------------------ */

/* Built from the app's own modal classes inside an .nt-app, so it wears the
   app's colours, type and buttons rather than a second design. On a phone it
   is the intro: the mark, then the site's sign-in under it. */
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

/* The loader: the DexNote mark breathing, and a line saying what it is
   waiting for. The same card as the gate, so the one becomes the other
   without anything jumping. */
function busy(text) {
  unmountApp();
  host.replaceChildren(el('div', { class: 'nt-app dn-gate', 'data-theme': 'dark' },
    el('div', { class: 'nt-modal' }, el('div', { class: 'nt-modal-card dn-card dn-loading' },
      el('img', { class: 'dn-logo', src: '/dexnote/icons/logo.svg', alt: '' }),
      el('p', { class: 'nt-modal-msg', text })))));
}

/* ---- mounting ------------------------------------------------------------ */

function unmountApp() {
  if (app) { try { app.unmount(); } catch (err) { console.warn('dexnote: unmount threw', err); } }
  app = null;
  phone = null;
}

async function start(backend, stored) {
  unmountApp();
  host.replaceChildren();
  const account = accountButton(user, accountMenu);
  const payload = stored
    ? { format: 'json', content: stored.doc, rev: stored.rev, savedAt: stored.savedAt }
    : { format: 'json', content: emptyDoc(), rev: 0 };
  phone = PHONE ? phoneShell({ profile: fillProfile, avatar: user }) : null;
  app = await mount(host, { payload, backend, headerTail: account, shell: phone ? phone.shell : undefined });
}

function accountMenu(anchor) {
  const items = user ? [
    { label: user.email || user.displayName || 'Signed in', disabled: true, run() {} },
    null,
    owner ? null : { label: 'Bring in the password notes…', run: bringInVault },
    { label: 'Sign out', danger: true, run: signOutNow },
  ].filter((item, i) => item || i === 1) : [
    { label: 'Guest · saved on this device', disabled: true, run() {} },
    null,
    { label: 'Sign in…', run: signInNow },
  ];
  menu(anchor, items, { align: 'right' });
}

/* The phone's profile sheet. mobile.js draws the settings; this fills in who
   is here and what the account can do, which only the page knows. */
function fillProfile(sheet, { close, who, actions }) {
  const pic = user && user.photoURL
    ? el('img', { class: 'dm-who-pic', src: user.photoURL, alt: '', referrerpolicy: 'no-referrer' })
    : el('span', { class: 'dm-who-pic', html: MARK.profile });
  who.replaceChildren(pic, el('div', { class: 'dm-who-text' },
    el('span', { class: 'dm-who-name', text: user ? (user.displayName || user.email || 'Signed in') : 'Guest' }),
    el('span', { class: 'dm-who-sub', text: user ? (owner ? `${user.email} · DEXDC notes` : user.email || '') : 'Notes saved on this device' })));
  const act = (label, run, kind = '') => el('button', { type: 'button', class: `dm-action ${kind}`, text: label, onclick: () => { close(); run(); } });
  actions.replaceChildren(...[
    user ? null : act('Sign in', signInNow, 'is-primary'),
    user && !owner ? act('Bring in the password notes…', bringInVault) : null,
    !STANDALONE ? act('Install DexNote on this device', () => showInstall()) : null,
    user ? act('Sign out', signOutNow, 'is-danger') : null,
  ].filter(Boolean));
  sheet.append(el('p', { class: 'dm-build', text: running ? `build ${label(running)}` : '' }));
}

async function enterGuest() {
  user = null;
  owner = false;
  const { backend, stored } = await openGuest();
  await start(backend, stored);
}

async function enterAccount(u) {
  const mine = ++entering;
  user = u;
  busy('Opening your notes…');
  try {
    const out = await openAccount(u, busy);
    if (out.moved) remember('account');
    if (mine !== entering) return;
    owner = !!out.owner;
    await start(out.backend, out.stored);
    if (out.moved) toast('The notes from this device are now in your account.');
  } catch (err) {
    console.error('dexnote: could not open the account', err);
    if (mine !== entering) return;
    gate(`Your notes could not be opened: ${err.message || err}. Try again.`);
  }
}

async function signInNow() {
  if (!app) { gate('Sign in and the notes on this device move into your account.'); return; }
  app.flush();
  listen();              // a guest who went straight in has no listener yet
  // Over the app rather than instead of it: backing out leaves you where you were.
  const u = await signInSheet(host.querySelector('.nt-app'), 'Sign in and the notes on this device move into your account.');
  void u;                // the account listener opens the account
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

/* ---- installing ----------------------------------------------------------- */

/* The AI Lab's download button opens /dexnote/?install=1. The browser's own
   install prompt where it has one (Chrome, Edge, Android), the Add to Home
   Screen steps where it does not (Safari, iPhone) -- the same offer Inko
   makes, drawn with classes because this page's CSP allows no inline style. */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
window.addEventListener('appinstalled', () => { deferredPrompt = null; });

function showInstall(inOtherApp = false) {
  if (document.querySelector('.dn-install')) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  /* Standalone with ?install=1 means ANOTHER app opened the link: DexNote's
     own start_url carries no query. On Android that is the dexcimino.com
     app (site.webmanifest, scope "/"): its scope holds /dexnote/, so Chrome
     hands every DexNote link to it and will not install DexNote beside it. */
  const steps = inOtherApp
    ? el('div', {},
      el('p', { class: 'nt-modal-msg', text: 'This opened inside the dexcimino.com app. While that app is on your home screen, it takes over DexNote, so DexNote cannot install on its own.' }),
      el('ol', { class: 'dn-steps' },
        el('li', { html: 'Hold the <b>dexcimino.com</b> icon on your home screen and tap <b>Uninstall</b>' }),
        el('li', { html: 'Open <b>dexcimino.com/dexnote</b> in Chrome and tap <b>Install</b>' }),
        el('li', { html: 'Add the site back afterwards if you want it' })))
    : deferredPrompt
      ? el('p', { class: 'nt-modal-msg', text: 'DexNote goes on your home screen and opens full screen, like any other app.' })
      : el('ol', { class: 'dn-steps' }, ...(ios
        ? [el('li', { html: 'Tap the <b>Share</b> button in Safari' }), el('li', { html: 'Tap <b>Add to Home Screen</b>' })]
        : [el('li', { html: 'Open the browser <b>menu</b> (⋮)' }), el('li', { html: 'Tap <b>Install app</b> or <b>Add to Home screen</b>' }),
          el('li', { html: 'Nothing happens? If the <b>dexcimino.com</b> app is on your home screen, uninstall it first: it takes over DexNote' })]));
  const close = () => wrap.remove();
  const go = el('button', {
    type: 'button', class: 'nt-btn is-primary', text: deferredPrompt && !inOtherApp ? 'Install' : 'Got it',
    onclick: async () => {
      if (deferredPrompt && !inOtherApp) { deferredPrompt.prompt(); try { await deferredPrompt.userChoice; } catch { /* dismissed */ } deferredPrompt = null; }
      close();
    },
  });
  const wrap = el('div', { class: 'nt-app dn-install', 'data-theme': 'dark', onclick: (e) => { if (e.target === wrap || e.target.classList.contains('nt-modal')) close(); } },
    el('div', { class: 'nt-modal' }, el('div', { class: 'nt-modal-card dn-card' },
      el('img', { class: 'dn-logo', src: '/dexnote/icons/logo.svg', alt: '' }),
      el('h3', { class: 'nt-modal-title', text: 'Install DexNote' }),
      steps,
      el('div', { class: 'nt-modal-btns' }, go))));
  document.body.append(wrap);
}
if (new URLSearchParams(location.search).has('install')) {
  history.replaceState(null, '', location.pathname + location.hash);
  // Chrome fires beforeinstallprompt shortly after load; give it a moment.
  setTimeout(() => showInstall(STANDALONE), 1200);
}

/* ---- updates -------------------------------------------------------------- */

/* THE SAME AS INKO'S. Every file the app is made of is asked for its ETag (a
   HEAD, so nothing is downloaded); the joined answer is the build. When it
   changes under a running app -- a deploy landed while the phone was in a
   pocket -- the notes are saved and the page reloads onto the new files,
   which the service worker serves network-first. Checked on coming back to
   the app, on focus, back online and every five minutes while open. */
const BUILD_FILES = ['/dexnote/index.html', '/dexnote/main.js', '/dexnote/mobile.js', '/dexnote/mobile.css', '/dexnote/dexnote.css',
  '/dexnote/account.js', '/dexnote/local.js', '/notes/app.js', '/notes/notes.css', '/notes/render.js', '/notes/editor.js', '/notes/state.js'];
let running = null;
let reloading = false;
const label = (sig) => { let h = 0; for (const c of sig) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h.toString(36).slice(0, 6); };

async function deployed() {
  const tags = await Promise.all(BUILD_FILES.map(async (f) => {
    const r = await fetch(f, { method: 'HEAD', cache: 'no-store' });
    return r.headers.get('etag') || r.headers.get('last-modified') || '';
  }));
  return tags.join('|');
}

async function checkForUpdate() {
  if (reloading || !navigator.onLine) return;
  let now;
  try { now = await deployed(); } catch { return; }
  if (!running) { running = now; return; }
  if (now === running) return;
  reloading = true;
  try { if (app) { app.flush(); await app.save(); } } catch { /* the beacon on pagehide is the fallback */ }
  try { sessionStorage.setItem('dexnoteUpdated', label(now)); } catch { /* private mode */ }
  location.reload();
}

/* The first visit is not controlled by the worker yet, so nothing it loaded
   went through it. Hand it the list of what this page DID load -- every
   module the app is made of, whatever it is today -- so the very next launch
   works with no network, rather than the one after it. */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/dexnote/sw.js', { scope: '/dexnote/', updateViaCache: 'none' }).catch(() => {});
  navigator.serviceWorker.ready.then((reg) => {
    const urls = performance.getEntriesByType('resource').map((e) => e.name)
      .filter((u) => { try { const x = new URL(u); return x.origin === location.origin && /^\/(dexnote|notes|account)\//.test(x.pathname); } catch { return false; } });
    if (reg.active) reg.active.postMessage({ cache: urls });
  }).catch(() => {});
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
window.addEventListener('focus', checkForUpdate);
window.addEventListener('online', checkForUpdate);
setInterval(() => { if (document.visibilityState === 'visible') checkForUpdate(); }, 5 * 60000);

/* ---- boot --------------------------------------------------------------- */

/* One listener for the life of the page. A sign-in from the gate, a sign-out
   from the menu and an earlier sign-in Firebase remembers all arrive here. */
let listening = null;
function listen() {
  return listening ||= new Promise((resolve) => {
    let first = true;
    onAccount((u) => {
      if (u) { if (!user || user.uid !== u.uid) enterAccount(u); }
      else if (user) { user = null; owner = false; gate(); }
      if (first) { first = false; resolve(u); }
    });
  });
}

(async function boot() {
  checkForUpdate();
  let updated = null;
  try { updated = sessionStorage.getItem('dexnoteUpdated'); sessionStorage.removeItem('dexnoteUpdated'); } catch { /* private mode */ }
  const announce = () => { if (updated) toast(`Updated — build ${updated}`); };
  // A guest who chose it before goes straight in, and Firebase is not even
  // fetched until they ask to sign in.
  if (remembered() === 'guest') { await enterGuest(); announce(); return; }
  const wasAccount = remembered() === 'account';
  if (wasAccount) busy('Opening your notes…');
  else gate();
  announce();
  const u = await listen();
  if (!u && wasAccount) gate();
})();
