/* Small shared UI: toast, confirm dialog, floating panels, menus, tooltips.
 *
 * Everything floating is appended to the app root so it inherits the theme
 * variables and sits inside the <dialog>'s top layer. Nothing uses a native
 * confirm(): the overlay is a <dialog> already, and a nested native dialog
 * drops focus on the floor when it closes.
 */

import { el } from './dom.js';

let root = null;
export function setRoot(node) { root = node; }

/* ---- toast --------------------------------------------------------------- */

let toastEl = null;
let toastTimer = 0;
export function toast(msg, kind) {
  if (!root) return;
  if (!toastEl) { toastEl = el('div', { class: 'nt-toast', role: 'status', 'aria-live': 'polite' }); root.append(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.toggle('is-error', kind === 'error');
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), Math.min(4500, Math.max(2200, msg.length * 90)));
}

/* ---- confirm ------------------------------------------------------------- */

/* Resolves to 'ok', 'alt' (the optional second action) or null. Enter is the
 * primary action, Escape cancels, the backdrop cancels. */
export function confirm({ title, msg, sub, ok = 'OK', alt = null, danger = false, altDanger = false }) {
  return new Promise((resolve) => {
    const prior = document.activeElement;
    const close = (value) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey, true);
      if (prior && prior.isConnected && typeof prior.focus === 'function') prior.focus({ preventScroll: true });
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close('ok'); }
    };
    const okBtn = el('button', { type: 'button', class: `nt-btn ${danger ? 'is-danger' : 'is-primary'}`, text: ok, onclick: () => close('ok') });
    const cancelBtn = el('button', { type: 'button', class: 'nt-btn', text: 'Cancel', onclick: () => close(null) });
    const altBtn = alt ? el('button', { type: 'button', class: `nt-btn is-left ${altDanger ? 'is-danger' : ''}`, text: alt, onclick: () => close('alt') }) : null;
    const card = el('div', { class: 'nt-modal-card', role: 'dialog', 'aria-modal': 'true' },
      el('h3', { class: 'nt-modal-title', text: title }),
      el('p', { class: 'nt-modal-msg', html: msg }),
      sub ? el('p', { class: 'nt-modal-sub', text: sub }) : null,
      el('div', { class: 'nt-modal-btns' }, altBtn, cancelBtn, okBtn));
    const wrap = el('div', { class: 'nt-modal', onmousedown: (e) => { if (e.target === wrap) close(null); } }, card);
    root.append(wrap);
    document.addEventListener('keydown', onKey, true);
    okBtn.focus();
  });
}

/* ---- floating panels ----------------------------------------------------- */

/* One panel open at a time. `place` positions it against an anchor rect; the
 * panel closes on an outside pointerdown, on Escape, and on scroll of the
 * canvas unless `sticky`. Returns a handle with close(). */
let openPanel = null;

export function closePanel() {
  if (!openPanel) return;
  const p = openPanel;
  openPanel = null;
  p.el.remove();
  document.removeEventListener('pointerdown', p.onDown, true);
  document.removeEventListener('keydown', p.onKey, true);
  window.removeEventListener('resize', p.onResize);
  if (p.onClose) p.onClose();
}

export function panel({ className, content, anchor, align = 'left', below = true, onClose, keepFocus = false, onKey }) {
  closePanel();
  const node = el('div', { class: `nt-panel ${className || ''}`, role: 'dialog' }, content);
  root.append(node);
  const handle = {
    el: node,
    onClose,
    close: closePanel,
    reposition: () => place(node, anchor, align, below),
    onDown: (e) => { if (!node.contains(e.target) && !(anchor && anchor.contains && anchor.contains(e.target))) closePanel(); },
    onKey: (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePanel(); return; }
      if (onKey) onKey(e);
    },
    onResize: () => place(node, anchor, align, below),
  };
  if (keepFocus) node.addEventListener('mousedown', (e) => { if (!e.target.closest('input,textarea,[contenteditable="true"],button,select')) e.preventDefault(); });
  place(node, anchor, align, below);
  openPanel = handle;
  // Deferred so the click that opened it is not the click that closes it.
  setTimeout(() => {
    if (openPanel !== handle) return;
    document.addEventListener('pointerdown', handle.onDown, true);
    document.addEventListener('keydown', handle.onKey, true);
    window.addEventListener('resize', handle.onResize);
  }, 0);
  return handle;
}

export const currentPanel = () => openPanel;

function place(node, anchor, align, below) {
  const rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
  if (!rect) { node.style.left = '50%'; node.style.top = '50%'; node.style.transform = 'translate(-50%,-50%)'; return; }
  const w = node.offsetWidth;
  const h = node.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = align === 'right' ? rect.right - w : align === 'center' ? rect.left + rect.width / 2 - w / 2 : rect.left;
  let top = below ? rect.bottom + 6 : rect.top - h - 6;
  if (below && top + h > vh - 8 && rect.top - h - 6 >= 8) top = rect.top - h - 6;
  if (!below && top < 8 && rect.bottom + 6 + h <= vh - 8) top = rect.bottom + 6;
  left = Math.max(8, Math.min(left, vw - w - 8));
  top = Math.max(8, Math.min(top, vh - h - 8));
  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(top)}px`;
}

/* ---- menus --------------------------------------------------------------- */

/* A list of actions. items: [{label, icon?, danger?, disabled?, run}] with
 * null entries as separators. Arrow keys move, Enter runs. */
export function menu(anchor, items, opts = {}) {
  const list = el('div', { class: 'nt-menu', role: 'menu' });
  const buttons = [];
  for (const item of items) {
    if (!item) { list.append(el('div', { class: 'nt-menu-sep' })); continue; }
    const b = el('button', {
      type: 'button', role: 'menuitem', class: `nt-menu-item ${item.danger ? 'is-danger' : ''}`,
      disabled: item.disabled ? true : null,
      onclick: () => { closePanel(); item.run(); },
    }, item.icon ? el('span', { class: 'nt-menu-icon', html: item.icon }) : null,
    el('span', { class: 'nt-menu-label', text: item.label }),
    item.hint ? el('span', { class: 'nt-menu-hint', text: item.hint }) : null);
    list.append(b);
    if (!item.disabled) buttons.push(b);
  }
  let idx = -1;
  const focus = (i) => { idx = (i + buttons.length) % buttons.length; buttons[idx].focus(); };
  const h = panel({
    className: 'nt-menu-panel', content: list, anchor, align: opts.align || 'left', below: opts.below !== false, onClose: opts.onClose,
    onKey: (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); focus(idx + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); focus(idx - 1); }
    },
  });
  if (opts.focusFirst !== false && buttons.length) setTimeout(() => focus(0), 0);
  return h;
}

/* ---- tooltips ------------------------------------------------------------ */

/* data-tip on any element inside the root. One element, moved around. */
let tipEl = null;
let tipTimer = 0;
export function initTooltips(container) {
  container.addEventListener('pointerover', (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t || !container.contains(t)) return;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => showTip(t), 350);
  });
  container.addEventListener('pointerout', (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t) return;
    clearTimeout(tipTimer);
    hideTip();
  });
  container.addEventListener('pointerdown', () => { clearTimeout(tipTimer); hideTip(); }, true);
}

function showTip(target) {
  const text = target.getAttribute('data-tip');
  if (!text) return;
  if (!tipEl) { tipEl = el('div', { class: 'nt-tip', role: 'tooltip' }); root.append(tipEl); }
  tipEl.textContent = text;
  tipEl.classList.add('is-on');
  const r = target.getBoundingClientRect();
  const pos = target.getAttribute('data-tip-pos') || 'below';
  const w = tipEl.offsetWidth;
  const h = tipEl.offsetHeight;
  let left; let top;
  if (pos === 'right') { left = r.right + 8; top = r.top + r.height / 2 - h / 2; }
  else if (pos === 'left') { left = r.left - w - 8; top = r.top + r.height / 2 - h / 2; }
  else if (pos === 'above') { left = r.left + r.width / 2 - w / 2; top = r.top - h - 6; }
  else { left = r.left + r.width / 2 - w / 2; top = r.bottom + 6; }
  left = Math.max(6, Math.min(left, window.innerWidth - w - 6));
  top = Math.max(6, Math.min(top, window.innerHeight - h - 6));
  tipEl.style.left = `${Math.round(left)}px`;
  tipEl.style.top = `${Math.round(top)}px`;
}

export function hideTip() { if (tipEl) tipEl.classList.remove('is-on'); }

/* ---- icons --------------------------------------------------------------- */

const S = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
export const ICON = {
  bold: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 4h6.5a4.5 4.5 0 0 1 3.2 7.7A4.75 4.75 0 0 1 14.5 20H7V4zm3 6.5h3.4a1.75 1.75 0 0 0 0-3.5H10v3.5zm0 3v3.5h4.3a1.75 1.75 0 0 0 0-3.5H10z"/></svg>`,
  italic: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10 4h8v2.5h-2.8l-3.2 11H15V20H7v-2.5h2.8l3.2-11H10z"/></svg>`,
  underline: S('<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" y1="21" x2="20" y2="21"/>'),
  strike: S('<path d="M16 6.5c-.6-1.7-2.3-2.5-4-2.5-2.5 0-4.5 1.2-4.5 3.2 0 1.6 1.2 2.4 3 2.9"/><path d="M8 17.5c.7 1.6 2.4 2.5 4.2 2.5 2.5 0 4.5-1.3 4.5-3.3 0-1.3-.8-2.1-2.2-2.7"/><line x1="4" y1="12" x2="20" y2="12"/>'),
  alignLeft: S('<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="17" y2="18"/>'),
  alignCenter: S('<line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="5" y1="18" x2="19" y2="18"/>'),
  alignRight: S('<line x1="4" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="7" y1="18" x2="20" y2="18"/>'),
  ul: S('<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor"/>'),
  ol: S('<line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><path d="M4 4.5h1.5v4M3.8 10.8c.3-.6 2-.8 2 .3 0 .9-2 1.4-2 2.4h2.4M3.8 16.5h1.6c.9 0 1 1.1.2 1.3.9.2.9 1.5-.2 1.5H3.8" stroke-width="1.4"/>'),
  todo: S('<rect x="3" y="4" width="7" height="7" rx="1.5"/><path d="M5 7.5l1.5 1.5L9 6"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><line x1="13" y1="7.5" x2="21" y2="7.5"/><line x1="13" y1="17.5" x2="21" y2="17.5"/>'),
  spell: S('<path d="M4 15l3.5-9 3.5 9M5.2 12h4.6"/><path d="M13 6v9M13 9.5c1.2-1 4.5-1.2 4.5 1.3v4.2M13 13.2c0 2 4.5 2.4 4.5-.3"/><path d="M4 20l3 2 6-5" stroke-width="2.2"/>'),
  link: S('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  md: S('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M6.5 15V9l2.5 3 2.5-3v6M16.5 9v6M14.5 13l2 2 2-2"/>'),
  image: S('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-8 8"/>'),
  search: S('<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>'),
  sun: S('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: S('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  close: S('<path d="M6 6l12 12M18 6L6 18"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  chevron: S('<path d="M6 9l6 6 6-6"/>'),
  chevronLeft: S('<path d="M15 6l-6 6 6 6"/>'),
  grip: `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></g></svg>`,
  restore: S('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  trash: S('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  undo: S('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: S('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  sidebar: S('<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/>'),
  sessions: S('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  more: `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></g></svg>`,
  quote: S('<path d="M7 7h4v4H8v3H6V9a2 2 0 0 1 1-2zM15 7h4v4h-3v3h-2V9a2 2 0 0 1 1-2z"/>'),
  code: S('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>'),
  heading: S('<path d="M5 5v14M15 5v14M5 12h10"/><path d="M18 14.5c.5-.6 2.5-.6 2.5.5S18.5 17 18.5 18.5H21" stroke-width="1.6"/>'),
  hr: S('<line x1="4" y1="12" x2="20" y2="12"/>'),
  copy: S('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>'),
  check: S('<path d="M5 12l4.5 4.5L19 7"/>'),
  eye: S('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  edit: S('<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M13.5 6.5l3 3"/>'),
  expand: S('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  collapse: S('<rect x="6" y="6" width="12" height="12" rx="1.5"/>'),
  palette: S('<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.3" fill="currentColor"/><circle cx="12" cy="7.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="10" r="1.3" fill="currentColor"/><path d="M12 21c-1.5-2-.5-4 1-4h2a3 3 0 0 0 0-6"/>'),
  archive: S('<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9M10 13h4"/>'),
  mic: S('<path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"/><path d="M19 11a7 7 0 0 1-14 0"/><line x1="12" y1="18" x2="12" y2="22"/>'),
  micStop: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor"/></svg>`,
};
