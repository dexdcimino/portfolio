/* dexcimino.com/account/ -- the site account's own page.
 *
 * Sign in, see who you are, sign out. With ?then=close it closes itself after
 * a sign-in, for an app in a frame that cannot open a popup: open this page in
 * a new tab, and the sign-in reaches the frame through Firebase's shared
 * storage. With ?app=inko&p=<provider>, a failure offers Inko's own sign-in.
 *
 * The card is DexNote's sign-in card (the same classes from notes.css and
 * dexnote.css), so the site has one sign-in look rather than a second one.
 */

import { onUser, signIn, signOut, errorText, cancelled } from './site-auth.js';

const host = document.getElementById('dn-app');
const params = new URLSearchParams(location.search);
const closeAfter = params.get('then') === 'close';
/* Opened from Inko's overlay: if the site account cannot sign in, Inko's own
   sign-in (the way it worked before the site account) is offered instead, so
   Inko is never left without one. */
const inkoVia = params.get('app') === 'inko' && /^(google|discord)$/.test(params.get('p') || '') ? params.get('p') : null;

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v !== null && v !== undefined) n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...kids);
  return n;
}
const btn = (label, onclick, primary) => el('button', { type: 'button', class: `nt-btn ${primary ? 'is-primary' : ''}`, text: label, onclick });

function card(...kids) {
  host.replaceChildren(el('div', { class: 'nt-app dn-gate', 'data-theme': 'dark' },
    el('div', { class: 'nt-modal' }, el('div', { class: 'nt-modal-card dn-card', role: 'dialog', 'aria-label': 'Your account' }, ...kids))));
}

function signedOut() {
  const error = el('p', { class: 'nt-modal-sub dn-error', hidden: true });
  const go = (which) => async () => {
    error.hidden = true;
    try { await signIn(which); }       // onUser shows the result
    catch (err) {
      if (cancelled(err)) return;
      console.warn('account: sign-in failed', err);
      error.textContent = errorText(err);
      if (inkoVia) error.append(' ', el('a', { href: `/api/sketch-auth/${inkoVia}`, text: 'Sign in to Inko only instead' }));
      error.hidden = false;
    }
  };
  card(
    el('h3', { class: 'nt-modal-title', text: 'Sign in' }),
    el('p', { class: 'nt-modal-msg', text: 'One account for everything on dexcimino.com: your notes, your drawings, and whatever comes next.' }),
    el('div', { class: 'dn-providers' },
      btn('Continue with Google', go('google'), true),
      btn('Continue with GitHub', go('github')),
      btn('Continue with Discord', go('discord'))),
    error);
}

function signedIn(u) {
  const who = u.email || u.displayName || 'your account';
  if (closeAfter) {
    card(el('h3', { class: 'nt-modal-title', text: 'Signed in' }),
      el('p', { class: 'nt-modal-msg', text: `You are signed in as ${who}. You can close this tab.` }));
    setTimeout(() => window.close(), 600);
    return;
  }
  card(
    el('h3', { class: 'nt-modal-title', text: 'Signed in' }),
    el('p', { class: 'nt-modal-msg', text: who }),
    el('p', { class: 'nt-modal-sub', text: 'dexnote and Inko use this account on every device you sign in on.' }),
    el('div', { class: 'nt-modal-btns' }, btn('Sign out', () => signOut()), btn('Home', () => { location.href = '/'; }, true)));
}

card(el('p', { class: 'nt-modal-msg', text: 'Checking your account…' }));
onUser((u) => (u ? signedIn(u) : signedOut()));
