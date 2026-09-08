/* The node layer: what a chip LOOKS like, what you can do to one, and the one
 * drag that creates, moves and copies them.
 *
 * chips.js owns what a node IS -- a link chip, a markdown chip, an image --
 * and how it is inserted and edited. This file owns everything around that:
 *
 *   the mark      every chip carries a coloured mark at its head. Clicking it
 *                 folds the chip down to just that mark and back again.
 *   the toolbar   resting on a chip raises a small bar over it: copy, edit,
 *                 open, delete. Delete ARMS on the first press and only acts
 *                 on the second, because a chip is one click from gone and
 *                 there is no dialog small enough to be worth it.
 *   the drag      ONE mechanism with three callers -- drag out of the header
 *                 to make a node, drag a chip to move it, hold Shift to leave
 *                 a copy behind. See beginDrag().
 *
 * WHY POINTER EVENTS AND NOT HTML5 DRAG-AND-DROP. A contenteditable is
 * already a drop target with opinions: the browser moves ranges, inserts its
 * own markup, and fires no event you can cleanly cancel on every path. Every
 * previous attempt at this fought that and lost in a different place each
 * time. Pointer events own the whole gesture, `caretFromPoint` says exactly
 * where the drop lands, and nothing is written until the pointer comes up.
 *
 * WHY THE FAVICONS ARE BUNDLED AND NOT FETCHED. This app ships under
 * `img-src 'self' data:`, so a favicon pulled from Google's icon service
 * would be blocked outright -- and widening that header would mean every
 * render of a private page telling a third party which domains are in it.
 * So the brands are DRAWN HERE, in the bundle: BRANDS below is a table of
 * the sites worth recognising, each with its own colours and, where the mark
 * is simple enough to draw honestly, its own glyph. Anything not in the
 * table still gets the old derived mark -- the site's initial on a colour
 * hashed from the hostname -- so an unknown link is never blank.
 */

import { el } from './dom.js';
import { ICON } from './ui.js';

let ctx = null;
export function initNodes(context) { ctx = context; }

/* ---- the kinds ------------------------------------------------------------
 * One table. The menu, the header button and the mark all read it, so a
 * fourth kind is a row here rather than four places to remember. */
export const NODES = [
  { key: 'link', label: 'Link', hint: 'Ctrl+K', color: '#67A2FF', icon: () => ICON.link },
  { key: 'md', label: 'Markdown', hint: '', color: '#9ACB5A', icon: () => ICON.md },
  { key: 'image', label: 'Image', hint: 'or paste', color: '#A79BF0', icon: () => ICON.image },
];
export const nodeKind = (key) => NODES.find((n) => n.key === key) || NODES[0];

export function kindOf(chip) {
  if (!chip) return null;
  if (chip.classList.contains('chip-link')) return 'link';
  if (chip.classList.contains('chip-md')) return 'md';
  return null;
}

/* ---- the mark -------------------------------------------------------------
 * A link's mark is its site: the first letter of the hostname on a colour
 * derived from the whole hostname, so google.com is the same green circle in
 * every note and never the same as github.com. A hash rather than a palette
 * lookup, because there is no list of sites to keep.
 *
 * THE MARK IS NEVER SAVED. It is built here on every hydrate and stripped by
 * serialize(); schema.js removes one outright if a stray copy ever reaches it
 * through a paste. What is in the document is the chip's label and nothing
 * else, which is what makes a chip's stored form readable. */
/* A BUCKET, NOT A HUE, and no inline style anywhere. scrub() strips every
 * style attribute in a body after each native input -- that is its whole job,
 * because Chrome leaves them behind when it merges two coloured lines -- so a
 * colour written onto the mark would survive exactly until the next
 * keystroke. Twelve classes, twelve rules in the stylesheet, nothing for the
 * scrubber to take away. Twelve is enough to tell a page of links apart and
 * few enough to be a readable set of rules. */
export const HUES = 12;

/* ---- the brands -----------------------------------------------------------
 * A GLYPH IS ONLY DRAWN WHERE IT CAN BE DRAWN HONESTLY. A logo rendered from
 * memory at 18 pixels is worse than no logo: it reads as a wrong mark rather
 * than as a generic one. So the table has two kinds of row --
 *
 *   glyph    a mark simple enough to be itself at this size: Google's ring,
 *            YouTube's play button, a triangle, a wordless shape.
 *   letter   everything else -- the brand's OWN colours behind its initial.
 *            Still instantly a brand (Netflix red, Spotify green, Amazon
 *            orange) without pretending to be a logo it is not.
 *
 * THE COLOURS ARE CLASSES, NOT STYLES, for the same reason the hue buckets
 * are: scrub() strips every style attribute in a body after each native
 * input, so a colour written onto the mark would survive until the next
 * keystroke and no longer. Each `cls` here has one rule in notes.css. */
const G = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

/* The four arcs and the bar, at r=7.2 about (12,12). Angles 20/140/215/320
   degrees, each arc under 180 so large-arc stays 0 and sweep stays 1. */
const GOOGLE = G('<g fill="none" stroke-width="4" stroke-linecap="butt">'
  + '<path stroke="#34A853" d="M18.77 14.46A7.2 7.2 0 0 1 6.48 16.63"/>'
  + '<path stroke="#FBBC05" d="M6.48 16.63A7.2 7.2 0 0 1 6.10 7.87"/>'
  + '<path stroke="#EA4335" d="M6.10 7.87A7.2 7.2 0 0 1 17.52 7.37"/>'
  + '<path stroke="#4285F4" d="M17.52 7.37A7.2 7.2 0 0 1 18.77 14.46"/>'
  + '<path stroke="#4285F4" d="M12.6 12h6.6"/></g>');

const YOUTUBE = G('<path fill="#FF0000" d="M22 12s0-3.4-.44-5.03a2.6 2.6 0 0 0-1.83-1.84C18.1 4.7 12 4.7 12 4.7s-6.1 0-7.73.43c-.9.24-1.6.94-1.83 1.84C2 8.6 2 12 2 12s0 3.4.44 5.03c.24.9.94 1.6 1.83 1.84C5.9 19.3 12 19.3 12 19.3s6.1 0 7.73-.43a2.6 2.6 0 0 0 1.83-1.84C22 15.4 22 12 22 12z"/><path fill="#fff" d="M10.1 15.1V8.9l5.4 3.1z"/>');

const XCORP = G('<path fill="#fff" d="M17.2 3h3.3l-7.2 8.2L21.7 21h-6.5l-5.1-6.5L4.2 21H.9l7.7-8.8L.6 3h6.7l4.6 5.9zm-1.2 16h1.8L7.9 4.8H6z"/>');

const VERCEL = G('<path fill="#fff" d="M12 4l9 15.5H3z"/>');

const SPOTIFY = G('<g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M6.6 8.6c3.6-1.1 7.7-.7 10.8 1.1"/><path d="M7.3 12.3c3-.9 6.4-.5 8.9.9"/><path d="M8 15.8c2.4-.7 5-.4 7 .7"/></g>');

const FACEBOOK = G('<path fill="#fff" d="M13.4 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.25-1.5 1.55-1.5h1.65V3.6A22 22 0 0 0 14.2 3.5c-2.4 0-4 1.45-4 4.1v2.3H7.5V13h2.7v8z"/>');

const LINKEDIN = G('<g fill="#fff"><rect x="4" y="9" width="3.2" height="10.5" rx=".4"/><circle cx="5.6" cy="5.6" r="2"/><path d="M10 9h3.05v1.45a3.35 3.35 0 0 1 3-1.65c3.2 0 3.8 2.1 3.8 4.85v5.85h-3.2v-5.2c0-1.24-.02-2.84-1.73-2.84-1.73 0-2 1.35-2 2.75v5.29H10z"/></g>');

const REDDIT = G('<g fill="#fff"><circle cx="12" cy="13.4" r="7.1"/></g><g fill="#FF4500"><circle cx="9.4" cy="12.9" r="1.25"/><circle cx="14.6" cy="12.9" r="1.25"/><path d="M8.6 16.2c1.9 1.5 4.9 1.5 6.8 0" stroke="#FF4500" stroke-width="1.3" fill="none" stroke-linecap="round"/></g><g fill="#fff"><circle cx="16.9" cy="5.4" r="1.9"/><path d="M12.4 6.6h-.8l1-3.2 3.3.7-.3 1.2-2.2-.5z"/></g>');

const TWITCH = G('<path fill="#fff" d="M5 3h15v11l-4.2 4.2h-3.4L9.6 21H7.5v-2.8H3.7V6.4zm13.3 1.7H6.4v11.6h3.3V19l2.4-2.7h3.6l2.6-2.6zM11 8h1.7v4.6H11zm4.6 0h1.7v4.6h-1.7z"/>');

const DROPBOX = G('<g fill="#fff"><path d="M7 4.2 2.2 7.4 7 10.6l4.9-3.2zM17 4.2l-4.9 3.2 4.9 3.2 4.8-3.2zM2.2 13.9 7 10.7l4.9 3.2L7 17.1zM17 10.7l-4.9 3.2 4.9 3.2 4.8-3.2zM7.2 18.2l4.8-3.1 4.8 3.1-4.8 3z"/></g>');

const NPM = G('<path fill="#fff" d="M2.5 8h19v8h-9.5v1.6H8V16H2.5zM4.2 14.3h2.1v-4.6h1.6v4.6H9.6V9.7H4.2zM11 9.7v6.2h2v-1.6h2v-4.6zm2 1.6h1.4v1.4H13zM16.4 14.3h1.6V9.7h-1.6zm2.5 0h1.6V9.7h-1.6z"/>');

const BRANDS = {
  'google.com': { cls: 'google', glyph: GOOGLE },
  'youtube.com': { cls: 'youtube', glyph: YOUTUBE },
  'youtu.be': { cls: 'youtube', glyph: YOUTUBE },
  'x.com': { cls: 'x', glyph: XCORP },
  'twitter.com': { cls: 'x', glyph: XCORP },
  'vercel.com': { cls: 'vercel', glyph: VERCEL },
  'vercel.app': { cls: 'vercel', glyph: VERCEL },
  'spotify.com': { cls: 'spotify', glyph: SPOTIFY },
  'facebook.com': { cls: 'facebook', glyph: FACEBOOK },
  'linkedin.com': { cls: 'linkedin', glyph: LINKEDIN },
  'reddit.com': { cls: 'reddit', glyph: REDDIT },
  'twitch.tv': { cls: 'twitch', glyph: TWITCH },
  'dropbox.com': { cls: 'dropbox', glyph: DROPBOX },
  'npmjs.com': { cls: 'npm', glyph: NPM },

  'github.com': { cls: 'github', letter: 'G' },
  'gitlab.com': { cls: 'gitlab', letter: 'G' },
  'stackoverflow.com': { cls: 'stackoverflow', letter: 'S' },
  'stackexchange.com': { cls: 'stackoverflow', letter: 'S' },
  'wikipedia.org': { cls: 'wikipedia', letter: 'W' },
  'amazon.com': { cls: 'amazon', letter: 'a' },
  'netflix.com': { cls: 'netflix', letter: 'N' },
  'instagram.com': { cls: 'instagram', letter: 'I' },
  'tiktok.com': { cls: 'tiktok', letter: 'T' },
  'pinterest.com': { cls: 'pinterest', letter: 'P' },
  'discord.com': { cls: 'discord', letter: 'D' },
  'discord.gg': { cls: 'discord', letter: 'D' },
  'slack.com': { cls: 'slack', letter: 'S' },
  'notion.so': { cls: 'notion', letter: 'N' },
  'figma.com': { cls: 'figma', letter: 'F' },
  'apple.com': { cls: 'apple', letter: '\u2318' },
  'microsoft.com': { cls: 'microsoft', letter: 'M' },
  'openai.com': { cls: 'openai', letter: 'O' },
  'chatgpt.com': { cls: 'openai', letter: 'O' },
  'claude.ai': { cls: 'claude', letter: 'C' },
  'anthropic.com': { cls: 'claude', letter: 'A' },
  'steampowered.com': { cls: 'steam', letter: 'S' },
  'itch.io': { cls: 'itch', letter: 'i' },
  'unity.com': { cls: 'unity', letter: 'U' },
  'unrealengine.com': { cls: 'unreal', letter: 'U' },
  'roblox.com': { cls: 'roblox', letter: 'R' },
  'epicgames.com': { cls: 'epic', letter: 'E' },
  'medium.com': { cls: 'medium', letter: 'M' },
  'substack.com': { cls: 'substack', letter: 'S' },
  'paypal.com': { cls: 'paypal', letter: 'P' },
  'ebay.com': { cls: 'ebay', letter: 'e' },
  'etsy.com': { cls: 'etsy', letter: 'E' },
  'shopify.com': { cls: 'shopify', letter: 'S' },
  'wordpress.com': { cls: 'wordpress', letter: 'W' },
  'vimeo.com': { cls: 'vimeo', letter: 'V' },
  'soundcloud.com': { cls: 'soundcloud', letter: 'S' },
  'bandcamp.com': { cls: 'bandcamp', letter: 'B' },
  'artstation.com': { cls: 'artstation', letter: 'A' },
  'behance.net': { cls: 'behance', letter: 'B' },
  'dribbble.com': { cls: 'dribbble', letter: 'D' },
  'deviantart.com': { cls: 'deviantart', letter: 'D' },
  'mozilla.org': { cls: 'mozilla', letter: 'M' },
  'developer.mozilla.org': { cls: 'mozilla', letter: 'M' },
  'news.ycombinator.com': { cls: 'hackernews', letter: 'Y' },
  'chrome.com': { cls: 'chrome', letter: 'C' },
  'cloudflare.com': { cls: 'cloudflare', letter: 'C' },
  'zoom.us': { cls: 'zoom', letter: 'Z' },
};

/* Keyed by the label before the suffix, so amazon.de and google.co.uk land on
   the same brand as their .com without a row each. Built once. */
const BY_NAME = {};
for (const [host, brand] of Object.entries(BRANDS)) {
  const parts = host.split('.');
  const name = parts[parts.length - 2] || parts[0];
  if (!BY_NAME[name]) BY_NAME[name] = brand;
}

export function brandOf(host) {
  if (!host) return null;
  if (BRANDS[host]) return BRANDS[host];
  // docs.google.com -> google.com, en.wikipedia.org -> wikipedia.org
  const parts = host.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const tail = parts.slice(i).join('.');
    if (BRANDS[tail]) return BRANDS[tail];
  }
  return BY_NAME[parts[parts.length - 2]] || null;
}

export function siteMark(url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { host = ''; }
  if (!host) return { text: '\u2022', bucket: 7, brand: null };
  let hash = 0;
  for (let i = 0; i < host.length; i++) hash = (hash * 31 + host.charCodeAt(i)) >>> 0;
  return { text: host[0].toUpperCase(), bucket: hash % HUES, brand: brandOf(host) };
}

export function paintMark(chip) {
  let mark = chip.querySelector('.nt-chip-mark');
  if (!mark) {
    mark = el('span', { class: 'nt-chip-mark', contenteditable: 'false' });
    chip.prepend(mark);
  }
  if (chip.classList.contains('chip-link')) {
    const m = siteMark(chip.getAttribute('href'));
    if (m.brand) {
      /* A KNOWN SITE WEARS ITS OWN COLOURS. The glyph rows carry their marks
         as real SVG -- multi-colour fills are plain attributes, not styles,
         so nothing strips them -- and the letter rows fall back to the same
         ::before the hashed marks use, over the brand's own ground. */
      mark.className = `nt-chip-mark is-brand b-${m.brand.cls}`;
      if (m.brand.glyph) { delete mark.dataset.l; mark.innerHTML = m.brand.glyph; }
      else { mark.innerHTML = ''; mark.dataset.l = m.brand.letter || m.text; }
      chip.setAttribute('draggable', 'false');
      chip.classList.toggle('is-min', chip.dataset.min === '1');
      return mark;
    }
    mark.className = `nt-chip-mark is-site h${m.bucket}`;
    /* THE LETTER IS GENERATED CONTENT, not a text node. A letter in the DOM
       is part of the chip's text, which means it is part of what the spell
       checker reads, what search matches, what "copy as text" writes out and
       what toText() hands the export -- a link to google.com would be the
       word "Ggoogle.com" to every one of them. Drawn from an attribute by
       CSS, it is visible and it is not text. */
    mark.dataset.l = m.text;
    mark.textContent = '';
  } else {
    mark.className = 'nt-chip-mark';
    mark.innerHTML = ICON.md;
  }
  /* draggable="false", AND IT IS LOAD-BEARING. A link chip is an <a href>,
     which Chrome drags natively: the moment the pointer moves with the button
     down it starts its own drag, the pointermove stream stops, and the drag
     built on those events never begins at all. The header's button worked and
     a chip did not, for exactly this reason. Set here because paintMark is
     the one place that runs both when a chip is made and on every hydrate --
     the attribute is not in the stored schema and does not need to be. */
  chip.setAttribute('draggable', 'false');
  chip.classList.toggle('is-min', chip.dataset.min === '1');
  return mark;
}

/* Folded, a chip is just its mark: a circle you can still point at, still
 * drag, and still open. The state rides in the document (data-min) because a
 * note you folded should come back folded. */
export function toggleMin(chip, body) {
  const now = chip.dataset.min === '1';
  ctx.editor.transact(body, () => {
    if (now) delete chip.dataset.min; else chip.dataset.min = '1';
    chip.classList.toggle('is-min', !now);
  });
}

/* ---- the hover toolbar ----------------------------------------------------
 * Not a panel(): there is one of those at a time and it closes on any outside
 * press, which would make opening the colour picker shut this and hovering a
 * chip shut the colour picker. This is its own small floating thing, owned
 * here, and it never takes focus. */
let bar = null;
let barChip = null;
let barTimer = 0;

export function hideToolbar(force) {
  clearTimeout(barTimer);
  if (!bar) return;
  if (!force && (bar.matches(':hover') || (barChip && barChip.matches(':hover')))) return;
  bar.remove();
  bar = null;
  barChip = null;
}

export function showToolbar(chip, body) {
  clearTimeout(barTimer);
  if (barChip === chip && bar) { place(chip); return; }
  hideToolbar(true);
  barChip = chip;
  const kind = kindOf(chip);
  const isLink = kind === 'link';
  const btn = (tip, icon, run, cls = '') => el('button', {
    type: 'button', class: `nt-chip-btn ${cls}`, 'data-tip': tip, 'data-tip-pos': 'above', 'aria-label': tip,
    html: icon, onclick: (e) => { e.preventDefault(); e.stopPropagation(); run(e); },
    onmousedown: (e) => e.preventDefault(),
  });
  const del = btn('Delete', ICON.close, () => {
    /* ARMED, then done. One press turns it red and says so; the second one
       removes the chip. A chip is a single click from gone and a confirm
       dialog for something Ctrl+Z brings straight back is heavier than the
       thing it is protecting. */
    if (del.classList.contains('is-armed')) { ctx.editor.transact(body, () => chip.remove()); hideToolbar(true); return; }
    del.classList.add('is-armed');
    del.setAttribute('data-tip', 'Press again to delete');
    setTimeout(() => { del.classList.remove('is-armed'); del.setAttribute('data-tip', 'Delete'); }, 2600);
  }, 'is-danger');
  bar = el('div', { class: 'nt-chip-bar', role: 'toolbar' },
    isLink ? btn('Open', ICON.eye, () => window.open(chip.getAttribute('href'), '_blank', 'noopener')) : null,
    btn('Edit', ICON.edit, () => ctx.chips.editChip(chip, body)),
    btn('Copy', ICON.copy, () => ctx.chips.copyChip(chip)),
    btn(chip.dataset.min === '1' ? 'Unfold' : 'Fold', ICON.collapse, () => { toggleMin(chip, body); hideToolbar(true); }),
    del);
  bar.addEventListener('pointerleave', () => { barTimer = setTimeout(() => hideToolbar(), 160); });
  bar.addEventListener('pointerenter', () => clearTimeout(barTimer));
  ctx.root.append(bar);
  place(chip);
}

function place(chip) {
  const r = chip.getBoundingClientRect();
  const root = ctx.root.getBoundingClientRect();
  const w = bar.offsetWidth;
  let left = r.left + r.width / 2 - w / 2 - root.left;
  left = Math.max(6, Math.min(left, root.width - w - 6));
  bar.style.left = `${Math.round(left)}px`;
  bar.style.top = `${Math.round(r.top - root.top - bar.offsetHeight - 5)}px`;
}

/* ---- the drag -------------------------------------------------------------
 * One gesture, three jobs:
 *
 *   from the header   `make` builds nothing yet; the drop places the caret
 *                     and opens the maker for that kind, so a link asks for
 *                     its address where it is going to live.
 *   from a chip       the chip itself moves to where it is dropped.
 *   Shift             the chip is copied instead of moved.
 *
 * Nothing is written until the pointer comes up. While it is down the only
 * thing on screen is a ghost following the pointer and a caret line where the
 * drop would land -- drawn as absolutely positioned elements over the page,
 * never inserted into the body, because a marker inserted into a live
 * contenteditable splits its text nodes and invalidates the very range the
 * drop is aiming at. */
function caretFromPoint(x, y) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (!p) return null;
    const r = document.createRange();
    r.setStart(p.offsetNode, p.offset);
    r.collapse(true);
    return r;
  }
  return null;
}

function caretRect(range) {
  const rects = range.getClientRects();
  if (rects.length) return rects[0];
  const n = range.startContainer;
  const e = n.nodeType === 1 ? n : n.parentElement;
  return e ? e.getBoundingClientRect() : null;
}

export function beginDrag(e, { ghost, onDrop, source, onStart }) {
  if (e.button !== 0) return;
  const startX = e.clientX;
  const startY = e.clientY;
  let dragging = false;
  let target = null;
  let ghostEl = null;
  let caret = null;

  const start = () => {
    dragging = true;
    /* The caller gets told the moment a press became a drag, not before: a
       menu that closed on pointerdown would close on a plain click too, and
       a menu still open under the pointer is a menu the ghost drops into. */
    if (onStart) onStart();
    hideToolbar(true);
    ctx.root.classList.add('is-node-dragging');
    ghostEl = el('div', { class: 'nt-node-ghost' }, ghost());
    caret = el('div', { class: 'nt-node-caret' });
    ctx.root.append(ghostEl, caret);
    if (source) source.classList.add('is-dragging');
  };

  const move = (ev) => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
      start();
    }
    const root = ctx.root.getBoundingClientRect();
    ghostEl.style.left = `${ev.clientX - root.left + 14}px`;
    ghostEl.style.top = `${ev.clientY - root.top + 12}px`;
    ghostEl.classList.toggle('is-copy', ev.shiftKey);

    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    const body = under && under.closest ? under.closest('.nt-body') : null;
    const range = body ? caretFromPoint(ev.clientX, ev.clientY) : null;
    if (!body || !range || !body.contains(range.startContainer)) {
      target = null;
      caret.classList.remove('is-on');
      return;
    }
    target = { body, range: range.cloneRange() };
    const rect = caretRect(range);
    if (!rect) { caret.classList.remove('is-on'); return; }
    caret.classList.add('is-on');
    caret.style.left = `${Math.round(rect.left - root.left)}px`;
    caret.style.top = `${Math.round(rect.top - root.top)}px`;
    caret.style.height = `${Math.max(16, Math.round(rect.height))}px`;
  };

  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (!dragging) return;
    ctx.root.classList.remove('is-node-dragging');
    if (ghostEl) ghostEl.remove();
    if (caret) caret.remove();
    if (source) { source.classList.remove('is-dragging'); source.dataset.dragged = '1'; setTimeout(() => { delete source.dataset.dragged; }, 0); }
    if (target) onDrop(target.body, target.range, ev.shiftKey);
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}
