/* ==========================================================================
   games/_shared/cursor.js — the site's accent cursor, for game documents.

   The portfolio page draws its cursor set (arrow, pointing hand, I-beam) as
   double-stroke data URIs — accent stroke over a dark casing — regenerated
   per accent. Games are separate documents inside iframes, so each installs
   the same set here; a visitor moving from the site into a game and back
   should never see the cursor change identity.

   THE SVG PATHS ARE DUPLICATED in script.js (CURSOR_PATHS) at the repo root,
   because the root file is a classic script that runs before modules load —
   change a shape there, change it here (and in games/stickland/src/cursor.js,
   which carries its own copy because Stickland builds from src/ alone).

   Respects game states: it only ever sets INHERITED cursors plus generic
   clickable families, so a game's own explicit cursor — Surveyor's reticle
   set (which never loads this file), Arena 1's cursor:none while locked,
   Stickland's inline grabbing — always wins.

   Follows the site's preference live: the dex-cursor localStorage key is
   same-origin, and the storage event re-applies on toggle or accent change
   without a reload.
   ========================================================================== */

const PATHS = {
  arrow: { d: 'M6 4l2.56 22.21 5.25-7.13L22.66 19.64z', hot: '6 4', fallback: 'auto' },
  pointer: {
    d: 'M12.9 3.3a1.7 1.7 0 0 1 1.7 1.7v5.3a1.55 1.55 0 0 1 3.1.2v.9a1.5 1.5 0 0 1 3 .3v.9a1.45 1.45 0 0 1 2.9.5l-.2 6.7a6.8 6.8 0 0 1-6.7 6.1h-1.5a6.4 6.4 0 0 1-4.6-2l-3.4-4.1a1.85 1.85 0 0 1 2.6-2.6l1.4 1.2V5a1.7 1.7 0 0 1 1.7-1.7zM14.6 12.4v-1.9M17.7 12.9v-1.4M20.6 13.4v-.9',
    hot: '13 3', fallback: 'pointer',
  },
  text: { d: 'M12.5 6.5h7M16 6.5v19M12.5 25.5h7', hot: '16 16', fallback: 'text' },
};

function cursorValue(kind, hex) {
  const p = PATHS[kind];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>` +
    `<g fill='none' stroke='#000' stroke-opacity='.55' stroke-width='4.5' stroke-linejoin='round' stroke-linecap='round'><path d='${p.d}'/></g>` +
    `<g fill='none' stroke='${hex}' stroke-width='2' stroke-linejoin='round' stroke-linecap='round'><path d='${p.d}'/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${p.hot}, ${p.fallback}`;
}

export function installAccentCursor(doc = document) {
  const root = doc.documentElement;
  const wantOn = () => {
    try { return localStorage.getItem('dex-cursor') !== 'off'; } catch { return true; }
  };
  const accent = () =>
    getComputedStyle(root).getPropertyValue('--accent').trim() || '#68d121';

  const style = doc.createElement('style');
  style.textContent = `
    html.dex-cursor{cursor:var(--dex-cursor-arrow,auto)}
    html.dex-cursor :is(a,button,summary,select,label,
      input[type="range"],input[type="checkbox"],input[type="radio"],
      [role="button"],[role="tab"],[role="switch"]){cursor:var(--dex-cursor-pointer,pointer)}
    html.dex-cursor :is(input[type="text"],input[type="email"],input[type="search"],
      input:not([type]),textarea){cursor:var(--dex-cursor-text,text)}
    html.dex-cursor :is(:disabled,[disabled],[aria-disabled="true"]){cursor:var(--dex-cursor-arrow,auto)}
  `;
  doc.head.appendChild(style);

  const apply = () => {
    const hex = accent();
    root.style.setProperty('--dex-cursor-arrow', cursorValue('arrow', hex));
    root.style.setProperty('--dex-cursor-pointer', cursorValue('pointer', hex));
    root.style.setProperty('--dex-cursor-text', cursorValue('text', hex));
    root.classList.toggle('dex-cursor', wantOn());
  };
  apply();

  // The site's toggle and accent picker write localStorage; storage events
  // reach every open same-origin document, so an open game follows along
  // without a reload. The tiny delay lets the game's own accent bridge
  // (which reads the same key) publish --accent first.
  window.addEventListener('storage', (e) => {
    if (e.key === 'dex-cursor' || e.key === 'dex-accent-name') setTimeout(apply, 80);
  });
  return apply;
}
