/* DexNote on a phone: the same app, with its header taken apart and put back
 * together as one bar along the bottom (Dex, 2026-10-08).
 *
 * Nothing here is a second editor. notes/app.js hands over its OWN controls
 * through the `shell` hook -- the formatting buttons, the node button, the
 * search field, the sessions list -- and this file only decides where they
 * sit. syncToolbar keeps lighting the bold button wherever it is, the sessions
 * sheet is the same renderSessionList, and every save still goes through the
 * one save loop. So the phone and the desktop cannot drift apart: there is
 * nothing on the phone the desktop does not also have.
 *
 * Left to right along the bar, as Dex laid it out:
 *   outliner · search · sessions · formatting · profile
 * Search and formatting open a second bar ABOVE it, the way Inko's options
 * bar does; the outliner is a drawer from the left; sessions and the profile
 * are sheets from the bottom. One thing is open at a time.
 *
 * The bars ride above the on-screen keyboard (--kb, from visualViewport), so
 * Bold is under your thumb while you type rather than behind the keyboard.
 */

import { el } from '/notes/dom.js';
import { ICON, menu, toast, confirm } from '/notes/ui.js';
import { touch } from '/notes/state.js';

const I = (body, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${extra}>${body}</svg>`;

/* The bar's marks. The outliner is a tree, not a hamburger: a parent and the
   two rows hanging off it, which is what the drawer actually shows. */
export const MARK = {
  outliner: I('<rect x="3" y="3.5" width="5" height="5" rx="1.2"/><path d="M11 6h10M5.5 8.5v9a1.5 1.5 0 0 0 1.5 1.5h2.5M5.5 13h4M13 13h8M13 19h8"/>'),
  search: I('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  sessions: I('<rect x="3.5" y="7" width="13" height="13" rx="2.5"/><path d="M7.5 3.5h10a3 3 0 0 1 3 3v10"/>'),
  format: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 4h6.5a4.5 4.5 0 0 1 3.2 7.7A4.75 4.75 0 0 1 14.5 20H7V4zm3 6.5h3.4a1.75 1.75 0 0 0 0-3.5H10v3.5zm0 3v3.5h4.3a1.75 1.75 0 0 0 0-3.5H10z"/></svg>',
  profile: I('<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>'),
  close: I('<path d="M6 6l12 12M18 6L6 18"/>'),
  more: I('<circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none"/>'),
};

/* `profile(sheet, api)` fills the profile sheet each time it opens; the page
   (dexnote/main.js) owns who is signed in. Returns the hook mount() takes,
   plus setAvatar() for when the account changes under a mounted app. */
export function phoneShell({ profile, avatar }) {
  let api = null;
  let profileBtn = null;
  let setAv = () => {};

  function shell(a) {
    api = a;
    const { root, header, sidebar, fmt, nodeBtn, searchMount, search, ctx } = a;
    root.classList.add('is-mobile');

    /* ---- what is open: one thing at a time ---- */
    let open = null;              // 'outliner' | 'search' | 'sessions' | 'format' | 'profile'
    const buttons = {};
    function set(which) {
      const prev = open;
      open = prev === which ? null : which;
      if (prev === 'search' && open !== 'search') search.shut();
      if (prev === 'sessions' && open !== 'sessions' && a.sessionsOpen()) a.closeSessions();
      if (prev === 'profile' && open !== 'profile') profileSheet.replaceChildren();
      root.classList.toggle('show-outliner', open === 'outliner');
      root.classList.toggle('show-find', open === 'search');
      root.classList.toggle('show-fmt', open === 'format');
      root.classList.toggle('show-profile', open === 'profile');
      for (const [k, b] of Object.entries(buttons)) { b.classList.toggle('is-on', k === open); b.setAttribute('aria-expanded', String(k === open)); }
      if (open === 'search') search.focus();
      if (open === 'sessions') a.openSessions();
      if (open === 'profile') fillProfile();
    }
    a.ctx.closeShell = () => { if (open) set(open); };

    /* ---- the bar ---- */
    const barBtn = (key, label, html) => {
      const b = el('button', { type: 'button', class: `dm-btn dm-${key}`, 'aria-label': label, 'aria-expanded': 'false', html, onclick: () => set(key) });
      b.addEventListener('mousedown', (e) => e.preventDefault());    // keep the caret, and the keyboard, where they are
      buttons[key] = b;
      return b;
    };
    profileBtn = barBtn('profile', 'Profile', MARK.profile);
    const sync = el('span', { class: 'dm-sync', 'aria-hidden': 'true' });
    profileBtn.append(sync);
    const sessBtn = barBtn('sessions', 'Sessions', MARK.sessions);
    sessBtn.dataset.sessionsToggle = '';
    const bar = el('nav', { class: 'dm-bar', 'aria-label': 'dexnote' },
      barBtn('outliner', 'Outliner', MARK.outliner),
      barBtn('search', 'Search', MARK.search),
      sessBtn,
      barBtn('format', 'Formatting', MARK.format),
      profileBtn);
    setAv = (u) => {
      for (const img of profileBtn.querySelectorAll('img')) img.remove();
      profileBtn.classList.toggle('has-avatar', !!(u && u.photoURL));
      if (u && u.photoURL) profileBtn.prepend(el('img', { class: 'dm-avatar', src: u.photoURL, alt: '', referrerpolicy: 'no-referrer' }));
    };
    setAv(avatar);

    /* ---- the second bars, above it ---- */
    const fmtBar = el('div', { class: 'dm-subbar dm-fmtbar', role: 'toolbar', 'aria-label': 'Formatting' },
      fmt.bold, fmt.italic, fmt.underline, fmt.strike,
      el('span', { class: 'dm-gap' }),
      fmt.left, fmt.center, fmt.right,
      el('span', { class: 'dm-gap' }),
      nodeBtn);
    // A finger on these must not take the caret out of the text.
    for (const b of fmtBar.querySelectorAll('button')) b.addEventListener('mousedown', (e) => e.preventDefault());

    const findClose = el('button', { type: 'button', class: 'dm-find-x', 'aria-label': 'Close search', html: MARK.close, onclick: () => set('search') });
    const findBar = el('div', { class: 'dm-subbar dm-findbar' }, searchMount, findClose);
    // Escape in the field shuts the search itself; follow it.
    searchMount.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open === 'search') setTimeout(() => { if (!search.isOpen()) set('search'); }, 0); });

    /* ---- the sheets ---- */
    const sessSheet = el('div', { class: 'dm-sheet dm-sess-sheet nt-sess-dock' });
    a.setDock(sessSheet);
    const profileSheet = el('div', { class: 'dm-sheet dm-psheet', role: 'dialog', 'aria-label': 'Profile' });
    const scrim = el('div', { class: 'dm-scrim', onclick: () => set(open) });

    const bars = el('div', { class: 'dm-bars' }, findBar, fmtBar, bar);
    root.append(scrim, sessSheet, profileSheet, bars);
    void header;

    /* The sessions sheet shuts itself (its X, a tap outside, Escape); keep the
       bar's idea of what is open in step with it. */
    new MutationObserver(() => {
      if (open === 'sessions' && !a.sessionsOpen()) set('sessions');
    }).observe(root, { attributes: true, attributeFilter: ['class'] });

    /* Tapping a category in the drawer jumps to it, and the drawer gets out
       of the way -- you opened it to go somewhere. */
    sidebar.addEventListener('click', (e) => {
      if (open !== 'outliner') return;
      const row = e.target.closest('.nt-row');
      if (row && !e.target.closest('button') && !e.ctrlKey && !e.shiftKey && !e.metaKey) setTimeout(() => { if (open === 'outliner') set('outliner'); }, 120);
    });

    /* Every session row gets a ⋯ with the things a session can have done to
       it. Rename puts the caret in the session's own title on the canvas,
       which is where the name lives; there is no second name field. */
    ctx.sessionMenu = (id, anchor) => {
      const doc = a.doc;
      const i = doc.sessions.findIndex((s) => s.id === id);
      if (i < 0) return;
      const s = doc.sessions[i];
      const move = (d) => {
        const j = i + d;
        if (j < 0 || j >= doc.sessions.length) return;
        doc.sessions.splice(j, 0, doc.sessions.splice(i, 1)[0]);
        touch(s);
        ctx.docChanged();
        a.openSessions();
      };
      menu(anchor, [
        { label: 'Rename', run: () => {
          if (doc.active !== id) anchor.closest('.nt-sess-row')?.click();
          set('sessions');
          setTimeout(() => {
            const t = a.canvas.querySelector('.nt-session-title');
            if (!t) return;
            t.focus();
            const r = document.createRange(); r.selectNodeContents(t);
            const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
          }, 60);
        } },
        { label: 'Colour', run: () => {
          if (doc.active !== id) anchor.closest('.nt-sess-row')?.click();
          setTimeout(() => a.openSessionColor(profileBtn), 0);
        } },
        { label: 'Move up', disabled: i === 0, run: () => move(-1) },
        { label: 'Move down', disabled: i === doc.sessions.length - 1, run: () => move(1) },
        null,
        { label: 'Delete', danger: true, run: () => anchor.closest('.nt-sess-row')?.querySelector('.nt-sess-row-x')?.click() },
      ], { align: 'right' });
    };

    /* ---- the save status, as a dot on the profile ---- */
    const st = a.status;
    const paintSync = () => {
      sync.classList.toggle('is-saving', st.classList.contains('is-saving'));
      sync.classList.toggle('is-error', st.classList.contains('is-error'));
      const line = profileSheet.querySelector('.dm-status');
      if (line) line.textContent = st.textContent;
    };
    new MutationObserver(paintSync).observe(st, { attributes: true, childList: true, characterData: true, subtree: true });

    /* ---- the keyboard ---- */
    /* The bars sit on the keyboard, not behind it. --kb is how much of the
       layout viewport the keyboard covers; Chrome on Android resizes the
       viewport itself when the page asks it to (interactive-widget in the
       viewport tag), and then this is 0 and costs nothing. */
    const vv = window.visualViewport;
    const placeKb = () => {
      if (!vv) return;
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      root.style.setProperty('--kb', `${kb}px`);
      root.classList.toggle('has-kb', kb > 80);
    };
    if (vv) { vv.addEventListener('resize', placeKb); vv.addEventListener('scroll', placeKb); placeKb(); }

    /* ---- the profile sheet ---- */
    function fillProfile() {
      const doc = a.doc;
      const row = (label, control) => el('div', { class: 'dm-row' }, el('span', { class: 'dm-row-label', text: label }), control);
      const seg = (items, value, pick) => el('div', { class: 'dm-seg' }, ...items.map(([v, label]) =>
        el('button', { type: 'button', class: `dm-seg-btn ${v === value ? 'is-on' : ''}`, text: label, onclick: (e) => { pick(v); for (const b of e.currentTarget.parentNode.children) b.classList.toggle('is-on', b === e.currentTarget); } })));
      const settings = el('div', { class: 'dm-group' },
        row('Theme', seg([['dark', 'Dark'], ['light', 'Light']], doc.ui.theme, (v) => a.setTheme(v))),
        row('Text size', seg([[15, 'S'], [17, 'M'], [20, 'L'], [22, 'XL']].filter(([n]) => a.SIZES.includes(n)), doc.ui.fs, (n) => a.setSize(n))),
        row('Font', el('button', {
          type: 'button', class: 'dm-pick', text: a.FONTS[doc.ui.font].label,
          onclick: (e) => menu(e.currentTarget, Object.entries(a.FONTS).map(([k, f]) => ({ label: f.label, run: () => { a.setFont(k); e.target.textContent = f.label; } }))),
        })),
        row('Spell check', seg([[true, 'On'], [false, 'Off']], a.spell.enabled(), (v) => a.setSpell(v))));
      profileSheet.replaceChildren(
        el('div', { class: 'dm-sheet-head' },
          el('span', { class: 'dm-sheet-title', text: 'Profile' }),
          el('button', { type: 'button', class: 'dm-sheet-x', 'aria-label': 'Close', html: MARK.close, onclick: () => set('profile') })),
        el('div', { class: 'dm-who' }),
        el('p', { class: 'dm-status', text: a.status.textContent }),
        settings,
        el('div', { class: 'dm-group dm-actions' }));
      profile(profileSheet, { close: () => { if (open === 'profile') set('profile'); }, who: profileSheet.querySelector('.dm-who'), actions: profileSheet.querySelector('.dm-actions'), toast, confirm });
    }

    return { set };
  }

  return {
    shell,
    setAvatar: (u) => setAv(u),
    get api() { return api; },
  };
}

