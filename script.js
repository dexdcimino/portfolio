/* ==========================================================================
   Dex Cimino — Portfolio V30
   Theme note: accents only ever set `--accent`. Every tinted graphic is a CSS
   mask painted with background-color, so there are no filter chains to keep in
   sync and no wrong-color flash between themes.
   ========================================================================== */

/* ---------- refresh starts at the top ------------------------------------ */

// A reload restores the old scroll position by default, so refreshing looks
// like nothing happened. Two things have to give way for it to land at the top,
// and both are scoped to reloads only:
//   1. the browser's own scroll restoration, and
//   2. the fragment, because the scroll spy mirrors the current section into
//      the URL — reloading at #work would scroll straight back to #work even
//      with restoration off.
// Deliberately NOT touched: a fresh visit to a shared /#work link still lands
// on that section (type 'navigate'), and back/forward keeps its remembered
// position (type 'back_forward'), which is what those gestures are for.
if (performance.getEntriesByType('navigation')[0]?.type === 'reload') {
  history.scrollRestoration = 'manual';
  // #resume survives: the overlay reopens from it, and there is no element
  // with that id to scroll to, so it cannot drag the page back down.
  if (location.hash && location.hash !== '#resume') {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch { /* file:// throws in some browsers */ }
  }
  // 'instant', not 'auto': html has scroll-behavior:smooth, and a refresh
  // should arrive at the top rather than animate its way there.
  const toTop = () => window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  toTop();
  window.addEventListener('load', toTop, { once: true });
}

const root = document.documentElement;
const picker = document.getElementById('accentPicker');
const accentHost = document.getElementById('accentSwatches');
const heroMascot = document.getElementById('heroMascot');
const navLinks = [...document.querySelectorAll('.nav-link, .resume-mini')];
const homeLinks = [...document.querySelectorAll('a[href="#home"]')];
const reveals = [...document.querySelectorAll('.reveal')];
const parallaxEls = [...document.querySelectorAll('[data-parallax]')];

// Each accent is pinned to the hue of its mascot's emissive glow (sampled off
// the PNGs), then pushed to L 55-66% / S 82-96% — bright enough to clear 4.5:1
// both ways (accent text on #0e1217, and #080a0b button text on accent) without
// tipping into neon. Hue is the mascot's; lightness is the UI's.
// Exception: red is hand-picked and sits darker (L 50%), so accent-on-dark text
// lands at 4.37:1 — just under AA. #DE4E2C would clear it if that ever matters.
//
// CONSTRAINT on picking any future accent, and the reason the range above is a
// range: an accent is also the FILL under --accent-ink, and accentInk can only
// offer black or white. Those two tie at relative luminance .1857, where the
// best either can manage is 4.45:1 — under AA no matter which one wins. So an
// accent must sit clear of that luminance in one direction or the other; land
// on it and the button label cannot be fixed by any choice of ink, only by
// moving the colour. Blue (L .150) and purple (L .226) straddle it closely.
//
// Separately, these seven are tuned against the SITE's dark surfaces. The
// resume document is lighter (#1b1f24 / #23282f) and red, blue and purple do
// not clear AA there; --cv-accent in styles.css lifts those three for that
// subtree only. Retune a colour here and check that override still holds.
const ACCENTS = [
  { name:'red',    color:'#D94727', mascot:'red' },      // hand-picked; glow hue 6°
  { name:'yellow', color:'#FAAA1E', mascot:'yellow' },   // glow hue 39°
  { name:'lime',   color:'#9EE02B', mascot:'limegreen' },// glow hue 90°, brand mark 80°
  { name:'cyan',   color:'#2CC7F6', mascot:'cyan' },     // glow hue 194°
  { name:'blue',   color:'#335DF3', mascot:'blue' },     // hand-picked; glow hue 208°
  { name:'purple', color:'#A85CF5', mascot:'purple' },   // glow hue 272°
  { name:'white',  color:'#E9EBEC', mascot:'white' }     // mascot's cool neutral
];

const STORAGE_KEY = 'dex-accent-name';
const DEFAULT_ACCENT = 'lime';
const canHover = window.matchMedia('(hover:hover) and (pointer:fine)');

let swatches = [];
let currentTheme = DEFAULT_ACCENT;

/* ---------- hex geometry ------------------------------------------------- */

function hexPoints(cx, cy, r) {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = Math.PI / 180 * (90 + i * 60);
    return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
  });
}

function roundedPolygonPath(points, radius) {
  const sub = (a, b) => ({ x:a.x - b.x, y:a.y - b.y });
  const add = (a, b) => ({ x:a.x + b.x, y:a.y + b.y });
  const scale = (a, s) => ({ x:a.x * s, y:a.y * s });
  const norm = a => { const len = Math.hypot(a.x, a.y); return { x:a.x / len, y:a.y / len }; };

  let d = '';
  points.forEach((curr, i) => {
    const prev = points[(i - 1 + points.length) % points.length];
    const next = points[(i + 1) % points.length];
    const p1 = sub(curr, scale(norm(sub(curr, prev)), radius));
    const p2 = add(curr, scale(norm(sub(next, curr)), radius));
    d += `${i === 0 ? 'M' : 'L'} ${p1.x} ${p1.y} Q ${curr.x} ${curr.y} ${p2.x} ${p2.y} `;
  });
  return d + 'Z';
}

// Everything below is in viewBox user units (76 wide), NOT device px, so the
// swatch scales cleanly with --swatch.
const HEX_R = 30;          // hex radius; the active ring straddles it (18 wide -> 21..39)
const RIM_R = 42.5;        // rim sits on 39..46, i.e. flush OUTSIDE the ring, never inside it
const roundedHexPath = roundedPolygonPath(hexPoints(38, 38, HEX_R), 5);
const roundedRimPath = roundedPolygonPath(hexPoints(38, 38, RIM_R), 5 * RIM_R / HEX_R);

/* ---------- theming ------------------------------------------------------ */

// Each mascot <img> sits inside a <picture>, so changing img.src alone does
// nothing — the browser keeps serving whatever the <source> srcset resolved to.
// Rewriting the stem in place preserves each slot's own width list (the hero
// carries 900/600/400, the card only 600/400) instead of hard-coding them here.
function retint(el, attr, mascot) {
  const value = el.getAttribute(attr);
  // Only the stem is rewritten, so the ?v= cache stamp bake_markup wrote comes
  // along unchanged. It belongs to the mascot the markup NAMES, which is what
  // makes a re-export of that one bust every colour at once — and means a
  // re-export of only a non-default mascot would not. Re-save the named one
  // (or touch it) if that ever matters.
  if (value) el.setAttribute(attr, value.replace(/mascot_[a-z]+/g, `mascot_${mascot}`));
}

/* Every <picture> whose art follows the accent. The hero plus any
   [data-theme-mascot] slots — resolved fresh each time because the Work
   overlay builds and tears down DOM. */
function mascotPictures() {
  return [heroMascot, ...document.querySelectorAll('[data-theme-mascot]')]
    .filter(Boolean)
    .map(img => img.closest('picture'))
    .filter(Boolean);
}

/* A probe is a throwaway offscreen clone of a real mascot <picture> with its
   stems rewritten to the target colour. The browser runs the SAME format and
   rung negotiation on the clone that it will run on the real one, so whatever
   the probe fetches is — by construction — the exact resource the visible
   swap needs, ?v= stamp included (retint preserves it).

   This replaced hand-built warm URLs at guessed widths (600 idle / 900 swap),
   which warmed rungs the picture never picked: the hero's `sizes` resolves to
   the 900 rung on most desktops AND phones, so an idle warm at 600 left every
   colour click waiting on a fresh 900 download — the mascot visibly trailing
   the instant CSS repaint. Worse, small viewports downloaded 900 *and* their
   real rung. The probe can't drift like that: there is no width or format
   knowledge here to go stale.

   Resolves after load AND decode, so the caller can retint knowing the paint
   is a raster flip, not a fetch. Resolves on error/timeout too — a dead
   network must never wedge the colour swap behind it. */
function probeMascot(pic, mascot, priority) {
  return new Promise(resolve => {
    const clone = pic.cloneNode(true);
    const img = clone.querySelector('img');
    if (!img) { resolve(); return; }
    clone.querySelectorAll('source').forEach(source => retint(source, 'srcset', mascot));
    retint(img, 'src', mascot);
    img.removeAttribute('id');            // no duplicate #heroMascot
    img.removeAttribute('loading');       // lazy never fires offscreen
    img.setAttribute('fetchpriority', priority);
    img.alt = '';
    clone.style.cssText =
      'position:absolute;left:-9999px;top:0;width:2px;visibility:hidden;pointer-events:none;';
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clone.remove();
      resolve();
    };
    img.addEventListener('load',
      () => (img.decode ? img.decode().then(done, done) : done()), { once: true });
    img.addEventListener('error', done, { once: true });
    setTimeout(done, 3500);
    document.body.appendChild(clone);
  });
}

// Bumped per swap. Decodes finish out of order when someone clicks through the
// colours quickly, and without this an earlier, slower decode lands last and
// leaves the previous mascot on screen.
let swapToken = 0;

function swapMascots(theme) {
  const token = ++swapToken;
  // Each picture flips the moment ITS probe has decoded — the hero never
  // waits on the card slot, and vice versa. After the idle warm every probe
  // is a cache hit, so the whole thing is one decode away from instant.
  mascotPictures().forEach(pic => {
    probeMascot(pic, theme.mascot, 'high').then(() => {
      if (token !== swapToken) return;
      pic.querySelectorAll('source').forEach(source => retint(source, 'srcset', theme.mascot));
      const img = pic.querySelector('img');
      if (img) retint(img, 'src', theme.mascot);   // keep the master fallback in step
    });
  });
}

// Once the page has painted, pull the other six accents in during idle time —
// via probes, so what lands in cache is the file a click will actually ask
// for. One accent at a time: no 12-fetch burst shouldering into whatever the
// visitor is doing.
function warmOtherMascots() {
  const load = async () => {
    for (const theme of ACCENTS) {
      if (theme.name === currentTheme) continue;
      await Promise.all(mascotPictures().map(pic => probeMascot(pic, theme.mascot, 'low')));
    }
  };
  // Safari has no requestIdleCallback.
  if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 4000 });
  else setTimeout(load, 2000);
}
window.addEventListener('load', warmOtherMascots);

/* >>> GENERATED FAVICON — do not edit by hand.
   Source: assets/icons/favicon.svg — regenerate with: python tools/bake_favicon.py
   %ACCENT% is substituted in applyAccent(); see the .ico note there. >>> */
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect id="favicon_bg" x="0" width="64" height="64" rx="14" ry="14" fill="#0b0d12"/>
  <path id="favicon_icon" fill="%ACCENT%" d="M30.9636,8.1728l-19.9335,11.5081c-.6415.3704-1.0367,1.0548-1.0367,1.7955v23.5337c0,.7407.3952,1.4252,1.0367,1.7955l15.8066,9.1254c1.3822.798,3.1099-.1996,3.1099-1.7955v-21.5161c0-.781-.4389-1.4957-1.1354-1.849l-10.209-5.1787,6.0573,8.6804c.2428.348.373.7621.373,1.1864v9.6945c0,1.596-1.7278,2.5935-3.11,1.7955l-5.5702-3.2162c-.6414-.3704-1.0366-1.0548-1.0366-1.7955v-17.3873c0-.7407.3952-1.4252,1.0366-1.7955l14.6113-8.4358c.6415-.3704,1.4318-.3704,2.0733,0l14.6108,8.4358c.6415.3704,1.0366,1.0548,1.0366,1.7955v17.3872c0,.7407-.3952,1.4252-1.0367,1.7955l-5.5702,3.2159c-1.3822.798-3.1099-.1995-3.1099-1.7955v-9.6942c0-.4243.1302-.8385.373-1.1864l6.0573-8.6804-10.209,5.1787c-.6965.3533-1.1354,1.068-1.1354,1.849v21.5161c0,1.596,1.7277,2.5935,3.1099,1.7955l15.8066-9.1254c.6415-.3703,1.0367-1.0548,1.0367-1.7955v-23.5337c0-.7407-.3952-1.4252-1.0367-1.7955l-19.9331-11.5081c-.6415-.3703-1.4318-.3703-2.0732,0Z"/>
</svg>`;
/* <<< GENERATED FAVICON <<< */

function paintSwatches() {
  // The active hex reads as a hollow ring; the rest are solid.
  let row = 1;
  swatches.forEach(button => {
    const active = button.dataset.name === currentTheme;
    const color = button.dataset.accent;
    const path = button.querySelector('.hex');

    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    // Row 0 is the docked toggle; everything else cascades below it.
    button.style.setProperty('--row', active ? 0 : row++);

    path.setAttribute('fill', active ? 'none' : color);
    path.setAttribute('stroke', active ? color : 'none');
    path.setAttribute('stroke-width', active ? '18' : '0');
  });
}

// Near-black label on a light accent, white on a dark one — the button text has
// to follow the accent rather than being hard-coded, because no single ink
// clears AA against all seven.
//
// This used to flip at a hand-set luminance of .30, which was simply the wrong
// place: black and white actually tie at .1857, so everything in between was
// handed white when black scored higher. Red (L .194) got 4.30:1 and purple
// (L .226) got 3.81:1 — both under AA on 14px/900 button labels — when the same
// colours reach 4.61 and 5.21 on black. Rather than move the constant to .1857,
// which is just as unexplained a number, ask the contrast formula directly and
// let the crossover fall out of it. That also keeps this correct if BLACK is
// ever retuned; a threshold would silently drift.
const INK_BLACK = '#080a0b', INK_WHITE = '#ffffff';

function relLuminance(hex) {
  const channel = i => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  };
  return .2126 * channel(0) + .7152 * channel(1) + .0722 * channel(2);
}

// WCAG 2.x contrast from two relative luminances, lighter term first.
const contrastOf = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);

function accentInk(hex) {
  const accent = relLuminance(hex);
  return contrastOf(accent, relLuminance(INK_BLACK)) >= contrastOf(accent, relLuminance(INK_WHITE))
    ? INK_BLACK
    : INK_WHITE;
}

const faviconSvg = document.getElementById('faviconSvg');

/* ---------- the accent cursor -------------------------------------------
   The breakout toy's in-game cursor, promoted to the whole site: an accent
   stroke over a dark casing, which is what keeps it readable on any ground
   (the wallpaper lightbox magnifier is built the same way). Both variants —
   the arrow and the pointer hand for anything clickable — come from this ONE
   function and are regenerated on every accent change; hand-writing a cursor
   per accent would be eleven things to forget. The values live in two custom
   properties on :root and the whole feature rides one class, html.dex-cursor,
   so turning it off restores the system cursor everywhere instantly. Default
   on, persisted under dex-cursor like the other preferences. Deliberately NOT
   gated on prefers-reduced-motion — a cursor does not move by itself, and
   that signal would be a lie; the toggle in the accent picker is the escape
   hatch for anyone who needs the OS cursor (large, inverted, high-contrast). */
const CURSOR_KEY = 'dex-cursor';
const CURSOR_PATHS = {
  // Rotated ~9° clockwise ABOUT THE TIP from the original upright form:
  // 20° overshot and read as leaning, 14° still did, so another 5° came
  // back off (2026-08-20). Measured rather than nominal, the left edge now
  // sits 7.58° off vertical, was 12.58° — the ° figures in these comments
  // have always been the whole glyph's nominal lean, not that edge's.
  // ROTATING ABOUT THE TIP is what keeps the hotspot exactly on it: 'M6 4'
  // is the tip and it is the one number in here that never changes, which
  // is why 'hot' has read '6 4' through all three rotations. Verified by
  // rasterising the live data URI, keeping only the ACCENT ink (the casing
  // is a wider stroke under it and would read as the extreme), and fitting
  // the support function of the round cap back to its centre: measured
  // apex 5.998 4.000, which is 0.002px off the declared hotspot and inside
  // the raster's own noise. Assuming it had not moved is the failure this
  // avoids — a 5° turn is small enough to look like it cannot matter.
  arrow: { d: 'M6 4l2.95 22.17 5.13-7.22L22.93 19.34z', hot: '6 4', fallback: 'auto' },
  // The standard pointing hand: index extended, three folded knuckles, the
  // thumb tucked across. Same line weight, same casing; the hotspot is the
  // fingertip.
  pointer: {
    d: 'M12.9 3.3a1.7 1.7 0 0 1 1.7 1.7v5.3a1.55 1.55 0 0 1 3.1.2v.9a1.5 1.5 0 0 1 3 .3v.9a1.45 1.45 0 0 1 2.9.5l-.2 6.7a6.8 6.8 0 0 1-6.7 6.1h-1.5a6.4 6.4 0 0 1-4.6-2l-3.4-4.1a1.85 1.85 0 0 1 2.6-2.6l1.4 1.2V5a1.7 1.7 0 0 1 1.7-1.7zM14.6 12.4v-1.9M17.7 12.9v-1.4M20.6 13.4v-.9',
    hot: '13 3', fallback: 'pointer',
  },
  // The I-beam, for selectable copy and the form fields — the OS I-beam was
  // the one system cursor left on the page, and one system cursor in an
  // otherwise custom set is the thing people notice without naming it.
  text: { d: 'M12.5 6.5h7M16 6.5v19M12.5 25.5h7', hot: '16 16', fallback: 'text' },
};
function cursorValue(kind, hex) {
  const p = CURSOR_PATHS[kind];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>` +
    `<g fill='none' stroke='#000' stroke-opacity='.55' stroke-width='4.5' stroke-linejoin='round' stroke-linecap='round'><path d='${p.d}'/></g>` +
    `<g fill='none' stroke='${hex}' stroke-width='2' stroke-linejoin='round' stroke-linecap='round'><path d='${p.d}'/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${p.hot}, ${p.fallback}`;
}

function applyAccent(name, persist = true) {
  const theme = ACCENTS.find(item => item.name === name) || ACCENTS[2];
  currentTheme = theme.name;

  root.style.setProperty('--accent', theme.color);
  root.style.setProperty('--accent-ink', accentInk(theme.color));
  root.dataset.accent = theme.name;

  // The cursor is the accent: all three variants follow every accent change.
  root.style.setProperty('--dex-cursor-arrow', cursorValue('arrow', theme.color));
  root.style.setProperty('--dex-cursor-pointer', cursorValue('pointer', theme.color));
  root.style.setProperty('--dex-cursor-text', cursorValue('text', theme.color));

  // favicon.ico is a static raster — it cannot read --accent and never follows
  // the theme. The SVG data URI is the live one, and it is rebuilt here rather
  // than fetched so it is correct on the very first paint, including when the
  // stored accent is not the default.
  if (faviconSvg) {
    const svg = FAVICON_SVG.replace('%ACCENT%', theme.color);
    faviconSvg.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  swapMascots(theme);
  paintSwatches();
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, theme.name); } catch { /* private mode */ }
  }
}

/* ---------- accent picker: build + disclosure ---------------------------- */

function isDocked() {
  return Boolean(picker?.classList.contains('compact'));
}

/* PINNED = opened by a deliberate act (click, Enter, Space) rather than by the
   pointer happening to be over it. Only the pin survives pointerleave; a
   hover-open still closes the moment the pointer goes, which is the whole
   reason the two states are distinguished rather than one 'open' flag being
   made stickier. Every close funnels through setOpen(false), which drops the
   pin, so there is no path that leaves it latched behind a closed dropdown. */
let pickerPinned = false;

function setOpen(open, { pin = false } = {}) {
  if (!picker) return;
  pickerPinned = open && (pin || pickerPinned);
  picker.classList.toggle('open', open);
  const toggle = swatches.find(b => b.classList.contains('active'));
  swatches.forEach(b => b.removeAttribute('aria-expanded'));
  if (isDocked() && toggle) toggle.setAttribute('aria-expanded', String(open));
}

function orderedSwatches() {
  // Visual top-to-bottom order while docked (active first, then the cascade).
  return [...swatches].sort(
    (a, b) => Number(a.style.getPropertyValue('--row')) - Number(b.style.getPropertyValue('--row'))
  );
}

function moveFocus(from, delta) {
  const order = orderedSwatches();
  const next = order[(order.indexOf(from) + delta + order.length) % order.length];
  next?.focus();
}

function onSwatchClick(theme, button) {
  /* While docked, the active hex is the DISCLOSURE, never a re-pick — picking
     the accent that is already on is a no-op, so the gesture is free to mean
     the only thing anyone tries it for.

     This used to be gated on `!open`, which on a real pointer is never true:
     pointerenter fires before click and has already opened it, so every click
     fell through to applyAccent(same) + setOpen(false) + blur(). The click was
     not doing nothing — it was CANCELLING the hover, and because the pointer
     had already entered, pointerenter would not fire again, so it stayed shut
     until you left and came back. Clicking by instinct got you a dropdown that
     shut in your face and would not reopen under the cursor. */
  if (isDocked() && button.classList.contains('active')) {
    if (pickerPinned) {
      // Toggle shut, but do NOT blur: Enter closing the stack must not also
      // throw a keyboard visitor out of the tab order, and a mouse click
      // leaves no ring anyway (:focus-visible does not match a pointer).
      setOpen(false);
    } else {
      setOpen(true, { pin: true }); // first: open and hold it open
    }
    return;
  }
  applyAccent(theme.name);
  if (isDocked()) {
    setOpen(false);
    button.blur();
  }
}

function buildAccentPicker() {
  if (!accentHost || !picker) return;

  const frag = document.createDocumentFragment();
  ACCENTS.forEach(theme => {
    const button = document.createElement('button');
    button.className = 'swatch';
    button.type = 'button';
    button.dataset.name = theme.name;
    button.dataset.accent = theme.color;
    button.setAttribute('aria-label', `${theme.name} accent`);
    button.setAttribute('aria-pressed', 'false');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 76 76');
    svg.setAttribute('aria-hidden', 'true');
    // Rim: a separate, larger hexagon so its stroke lands entirely outside the
    // accent ring — an outer perimeter outline only, with nothing inside the
    // hex. CSS turns it on only while the picker is docked, where the hex can
    // land on a background that matches the accent.
    const halo = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    halo.setAttribute('class', 'halo');
    halo.setAttribute('d', roundedRimPath);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'hex');
    path.setAttribute('d', roundedHexPath);
    svg.append(halo, path);
    button.appendChild(svg);

    button.addEventListener('click', () => onSwatchClick(theme, button));
    frag.appendChild(button);
  });

  accentHost.replaceChildren(frag);
  swatches = [...accentHost.querySelectorAll('.swatch')];
  // One extra row: the cursor toggle sits at the bottom of the open cascade.
  picker.style.setProperty('--rows', String(ACCENTS.length));

  /* The cursor toggle: last member of the swatch row, after the seven hexes
     and after them in the tab order. It wears the SAME hexagon as the
     swatches — dark, so it reads as part of the set while being obviously
     not a colour — with the live arrow cursor drawn on top. No visible text,
     like the swatches, so the aria-label IS its name. It lives here because
     the cursor is the accent, and it is the escape hatch back to the OS
     cursor for anyone relying on the system's accessibility cursors. While
     the picker is docked it sits INSIDE the dropdown, at the bottom of the
     cascade (--row after the last swatch); collapsed, only the active hex
     shows, exactly as before. */
  const cursorBtn = document.createElement('button');
  cursorBtn.className = 'cursor-toggle';
  cursorBtn.type = 'button';
  cursorBtn.id = 'cursorToggle';
  cursorBtn.setAttribute('aria-label', 'Accent cursor: replace the system cursor with the site’s');
  cursorBtn.style.setProperty('--row', String(ACCENTS.length));
  const cSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  cSvg.setAttribute('viewBox', '0 0 76 76');
  cSvg.setAttribute('aria-hidden', 'true');
  const cHex = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  cHex.setAttribute('class', 'ct-hex');
  cHex.setAttribute('d', roundedHexPath);
  // The 32-box cursor artwork on the 76-box hexagon: slightly smaller than
  // a pure fit, and nudged down-right past the bounding-box centre — an
  // arrow's visual mass sits toward its tip, so geometric centring reads
  // high-left.
  const cG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  cG.setAttribute('transform', 'translate(19 19.5) scale(1.35)');
  const cPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  cPath.setAttribute('class', 'ct-glyph');
  cPath.setAttribute('d', CURSOR_PATHS.arrow.d);
  cG.appendChild(cPath);
  cSvg.append(cHex, cG);
  cursorBtn.appendChild(cSvg);
  accentHost.appendChild(cursorBtn);

  const applyCursorPref = (on, persist = true) => {
    document.documentElement.classList.toggle('dex-cursor', on);
    cursorBtn.setAttribute('aria-pressed', String(on));
    if (persist) {
      try { localStorage.setItem(CURSOR_KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
    }
  };
  let cursorStored = null;
  try { cursorStored = localStorage.getItem(CURSOR_KEY); } catch { /* private mode */ }
  applyCursorPref(cursorStored !== 'off', false);
  cursorBtn.addEventListener('click', () =>
    applyCursorPref(!document.documentElement.classList.contains('dex-cursor')));

  let stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch { /* private mode */ }
  applyAccent(stored || DEFAULT_ACCENT, false);

  // Pointer: hover opens on real pointers, tap-to-toggle handles touch.
  // Leaving closes a HOVER-open only — a pinned one is waiting on a click,
  // an outside tap or Escape, which is the point of pinning it.
  picker.addEventListener('pointerenter', () => { if (isDocked() && canHover.matches) setOpen(true); });
  picker.addEventListener('pointerleave', () => {
    if (isDocked() && canHover.matches && !pickerPinned) setOpen(false);
  });

  // Keyboard: focus opens it, arrows walk the stack, Escape closes it.
  picker.addEventListener('focusin', () => { if (isDocked()) setOpen(true); });
  picker.addEventListener('focusout', event => {
    if (isDocked() && !picker.contains(event.relatedTarget)) setOpen(false);
  });
  picker.addEventListener('keydown', event => {
    const target = event.target.closest?.('.swatch');
    if (!target) return;
    const vertical = isDocked();
    const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
    const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft';

    if (event.key !== nextKey && event.key !== prevKey) return;
    event.preventDefault();
    /* Open FIRST if it is shut. While docked and closed the six other hexes
       are still in the tab order but are opacity:0 and pointer-events:none,
       so walking the stack blind would park the focus ring on something the
       visitor cannot see. Pinned, because an arrow key is as deliberate as a
       click and the stack should not evaporate on the next pointer move. */
    if (vertical && !picker.classList.contains('open')) setOpen(true, { pin: true });
    moveFocus(target, event.key === nextKey ? 1 : -1);
  });

  /* Escape, from anywhere. It used to live on the picker's own keydown behind
     `event.target.closest('.swatch')`, which means it only ever fired while a
     swatch held focus — and the hover-open path leaves focus on <body>, so the
     one state a visitor is most likely to press Escape in was the one state it
     did nothing in. Focus is only pulled back to the active hex if it was
     inside the picker to begin with; Escape on a hover-open must not yank the
     caret out of whatever the reader was actually in. */
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !isDocked()) return;
    if (!picker.classList.contains('open')) return;
    const wasInside = picker.contains(document.activeElement);
    setOpen(false);
    if (wasInside) swatches.find(b => b.classList.contains('active'))?.focus();
  });

  // Outside tap closes the docked stack, pinned or not.
  document.addEventListener('pointerdown', event => {
    if (isDocked() && !picker.contains(event.target)) setOpen(false);
  });
}

function updateAccentPickerMode() {
  if (!picker || !topbar) return;
  const shouldDock = window.scrollY > Math.max(44, topbar.offsetHeight - 6);
  if (shouldDock === isDocked()) return;
  picker.classList.toggle('compact', shouldDock);
  setOpen(false);
}

const topbar = document.querySelector('.topbar');
buildAccentPicker();

/* ---------- reveal on scroll -------------------------------------------- */

const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('in');
    revealObserver.unobserve(entry.target);
  });
}, { threshold:.12 });
reveals.forEach(el => revealObserver.observe(el));

/* ---------- scroll spy --------------------------------------------------- */

// 'resume' is deliberately absent: the overlay owns #resume now, and the strip
// it used to point at is a contact CTA (id="contact-cta").
// 'collab' is absent WHILE THE SECTION IS DORMANT: it has no nav link, and a
// spy that activates an id no link carries turns every link off as you scroll
// through it. Restore the entry together with the link (see index.html's nav).
const sections = ['home', 'work', 'games', 'ai', 'about']
  .map(id => document.getElementById(id))
  .filter(Boolean);

// The scroll spy already knows the active section; mirror it into the URL so a
// copied link matches what the visitor is actually looking at. replaceState, not
// pushState — pushState would add an entry per section crossed and the back
// button would walk the page instead of leaving the site.
// The spy's first run happens at parse time, before the browser has scrolled to
// whatever fragment the visitor arrived with — so it measured scrollY 0, called
// this "home" and erased the fragment. That silently broke every shared deep
// link: /#about landed at the top of the page, and /#resume never opened the
// overlay, because the check for it further down runs after this and found the
// hash already gone. Hold the URL until load; by then the fragment scroll has
// happened and the spy is reporting where the reader actually is.
let hashSyncReady = false;

function syncHash(id) {
  if (!hashSyncReady) return;                                   // let the arrival fragment stand
  // The resume overlay pushes #resume, so a cached "last written" value goes
  // stale and the spy then refuses to correct the URL. Compare against the real
  // location instead — same dedup (updateMotion runs every rAF and Safari rate-
  // limits replaceState) without a cache that can drift.
  if (document.body.classList.contains('modal-open')) return;   // overlay owns the hash
  const hash = id === 'home' ? '' : `#${id}`;
  if (hash === location.hash) return;
  try {
    history.replaceState(null, '', hash || location.pathname + location.search);
  } catch { /* file:// throws in some browsers; scrolling still works */ }
}

// behavior:'auto' defers to CSS scroll-behavior, and the reduced-motion block in
// styles.css already forces that to `auto` — so this jumps instantly for anyone
// who asked for reduced motion, without duplicating the media query in JS.
function scrollToY(top) {
  window.scrollTo({ top, behavior: 'auto' });
}

function setActiveSection(id) {
  navLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${id}`));
  syncHash(id);
}

function updateScrollSpy() {
  const scrollY = window.scrollY;
  if (scrollY <= 6) { setActiveSection('home'); return; }

  const line = scrollY + Math.min(190, window.innerHeight * .24);
  let active = 'home';
  for (const section of sections) {
    if (section.offsetTop <= line) active = section.id;
    else break;
  }
  if (window.innerHeight + scrollY >= root.scrollHeight - 4) active = sections.at(-1)?.id || active;
  setActiveSection(active);
}

homeLinks.forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  // replaceState can throw on file:// in some browsers — scrolling still works.
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* noop */ }
  scrollToY(0);
  setActiveSection('home');
}));

// Intercept rather than letting the anchor navigate: a native anchor click
// pushes a real history entry that syncHash then overwrites, which strands the
// back button on a stale hash. Same shape as the homeLinks handler above.
navLinks.forEach(link => link.addEventListener('click', event => {
  const id = link.getAttribute('href')?.slice(1);
  if (!id || id === 'home') return;            // homeLinks owns #home
  const target = document.getElementById(id);
  if (!target) return;                         // unknown target: let it navigate
  event.preventDefault();
  scrollToY(target.offsetTop);                 // same metric the spy measures by
  setActiveSection(id);
}));

/* ---------- parallax ----------------------------------------------------- */

let ticking = false;

// Background bands scroll naturally with the page (no parallax) so the hero's
// front accent band stays locked to the background wedge.
function updateMotion() {
  const y = window.scrollY;

  parallaxEls.forEach(el => {
    const speed = Number(el.dataset.parallax || 0);
    el.style.translate = `0 ${Math.min(70, y * speed * .12)}px`;
  });

  updateScrollSpy();
  updateAccentPickerMode();
  ticking = false;
}

window.addEventListener('scroll', () => {
  if (!ticking) { ticking = true; requestAnimationFrame(updateMotion); }
}, { passive:true });

window.addEventListener('resize', () => {
  updateScrollSpy();
  updateAccentPickerMode();
}, { passive:true });

updateMotion();

// Order matters: re-measure first, so the nav's active state catches up with a
// fragment scroll that may not have fired a scroll event, and only then hand
// the URL over to the spy. Flipping the flag first would let this very call
// overwrite the fragment it is meant to be reading.
window.addEventListener('load', () => {
  updateMotion();
  hashSyncReady = true;
});

/* ==========================================================================
   CONTACT MODAL
   A static page cannot send mail on its own, so submission is relayed. Paste an
   endpoint below and it POSTs there; leave it blank and the form falls back to
   opening the visitor's mail client with everything pre-filled.
     Formspree: endpoint 'https://formspree.io/f/xxxxxxxx'  (accessKey stays '')
     Web3Forms: endpoint 'https://api.web3forms.com/submit' + your accessKey
   ========================================================================== */

const CONTACT = {
  endpoint: 'https://api.web3forms.com/submit',
  accessKey: 'b3cdb4e6-bcdf-41d0-96d3-b208fa714191',
  to: 'dexdcimino@gmail.com',
  maxSends: 2,
  windowMs: 10 * 60 * 1000
};

const RATE_KEY = 'dex-contact-sends';
const modal = document.getElementById('contactModal');
const contactForm = document.getElementById('contactForm');
const statusEl = document.getElementById('contactStatus');
const sendBtn = document.getElementById('contactSend');

/* ---------- rate limit --------------------------------------------------- */

// Client-side only, so it stops accidental double-sends and casual spam, not a
// determined attacker. Real throttling has to live on the relay.
function recentSends() {
  let stamps = [];
  try { stamps = JSON.parse(localStorage.getItem(RATE_KEY) || '[]'); } catch { /* private mode */ }
  const cutoff = Date.now() - CONTACT.windowMs;
  return (Array.isArray(stamps) ? stamps : []).filter(t => typeof t === 'number' && t > cutoff);
}

function recordSend() {
  const stamps = [...recentSends(), Date.now()];
  try { localStorage.setItem(RATE_KEY, JSON.stringify(stamps)); } catch { /* private mode */ }
}

function cooldownMinutes() {
  const oldest = Math.min(...recentSends());
  return Math.max(1, Math.ceil((oldest + CONTACT.windowMs - Date.now()) / 60000));
}

/* ---------- open / close ------------------------------------------------- */

// `lead` renders as a bolded phrase in front of the message, so a success reads
// as a state first and a sentence second. Built from nodes rather than innerHTML
// so interpolated values can never become markup.
function setStatus(message, kind = '', lead = '') {
  if (!statusEl) return;
  statusEl.className = `contact-status${kind ? ' ' + kind : ''}`;
  if (!lead) {
    statusEl.textContent = message;
    return;
  }
  const strong = document.createElement('strong');
  strong.textContent = lead;
  statusEl.replaceChildren(strong, ` ${message}`);
}

/* ---------- shared modal plumbing ---------------------------------------- */

// Both overlays are <dialog>, so focus trapping, inertness and Esc come from the
// platform. What has to be shared by hand: the scroll lock, the backdrop-click
// test (a modal <dialog>'s own box fills the viewport, so event.target is
// useless — compare the pointer against the visible panel), and making sure the
// two can never be open at once.
const openDialogs = new Set();
const openerFor = new WeakMap();
// Which of them were opened OVER another rather than in place of it — see
// openModal's `stack`. It changes one thing on the way out: where focus goes.
const stackedOn = new WeakSet();
const sidebar = document.getElementById('sidebar');

// A modal's trigger lives in the sidebar, and <dialog> restores focus to it on
// close — natively, even with no code of ours. That restored focus counts as
// :focus-visible, which would pop the rail open under the pointer's nose.
// Suppress only the focus branch, and only until the next genuine interaction:
// Tab straight after closing must still expand it, and so must moving the mouse
// onto it. Restoration itself is never skipped — dropping focus to <body> would
// strand keyboard users at the top of the document.
// The same restored focus also paints a ring. Closing a modal with Escape (or
// the X, or the backdrop) leaves the button that opened it wearing the accent
// outline as though it were still selected — every trigger, every exit path.
// The focus itself has to stay, so mute the ring instead and let the element
// earn it back the next time focus genuinely lands on it. Cleared on blur: by
// then focus has moved on and there is nothing left to mislabel.
function quietFocus(el) {
  if (!el || el === document.body || el.classList.contains('focus-quiet')) return;
  el.classList.add('focus-quiet');
  el.addEventListener('blur', () => el.classList.remove('focus-quiet'), { once: true });
}

// Armed before the dialog closes, so neither the rail nor the ring can flash in
// the frame between the platform restoring focus and our close handler running.
function suppressFocusExpand(el) {
  quietFocus(el);
  if (el && sidebar?.contains(el)) sidebar.classList.add('no-focus-expand');
}

function restoreFocusQuietly(el) {
  if (!el) return;
  const inSidebar = sidebar?.contains(el);
  if (inSidebar) sidebar.classList.add('no-focus-expand');
  quietFocus(el);                 // also covers openers that never went through closeModal
  el.focus({ preventScroll: true });
  if (!inSidebar) return;

  const clear = () => sidebar.classList.remove('no-focus-expand');
  sidebar.addEventListener('pointerenter', clear, { once: true });
  window.addEventListener('keydown', clear, { once: true });
}

function closeModal(dialog) {
  if (!dialog?.open) return;
  suppressFocusExpand(openerFor.get(dialog));   // in place before focus returns
  dialog.close();                               // the 'close' listener clears the lock
}

/* `stack` is the one exception to "never two overlays at once", and it is here
   for exactly one case: a document opened FROM inside another overlay, where
   closing the reader has to put you back in the list you opened it from. The
   Idea Vault is that case — its section relocks the moment its overlay closes,
   so replacing the overlay would leave the keypad on screen still reading OPEN
   with nothing to close. Native <dialog> stacks correctly by itself: the top
   layer orders them, Escape closes the topmost, the one underneath is inert.
   Nothing opened from OUTSIDE another overlay may pass it. */
function openModal(dialog, panel, onOpen, opener, stack) {
  if (!dialog) return;
  // Read the trigger before closing anything: closing a dialog synchronously
  // hands focus back to *its* opener, so activeElement would name the wrong one.
  const trigger = opener || document.activeElement;
  if (!stack) openDialogs.forEach(closeModal);      // never two overlays at once
  openerFor.set(dialog, trigger);
  if (stack) stackedOn.add(dialog); else stackedOn.delete(dialog);
  document.body.classList.add('modal-open');
  dialog.showModal();
  onOpen?.();
}

// Wire a dialog once: scroll-lock teardown plus backdrop-click-to-close.
function bindModal(dialog, onClose) {
  if (!dialog) return;
  openDialogs.add(dialog);
  // Escape closes natively without passing through closeModal, so the
  // suppression has to be armed here too — before the close steps restore focus.
  dialog.addEventListener('cancel', () => suppressFocusExpand(openerFor.get(dialog)));
  dialog.addEventListener('close', () => {
    // The close event is queued, not synchronous, so by the time it runs another
    // overlay may already have taken this one's place: openModal closes whatever
    // is open before it shows, so re-triggering RESUME while the overlay is up
    // lands here with the replacement already on screen. Treat that as a
    // hand-off, not an ending — restoring focus would yank it straight back out
    // of the overlay the user is now looking at, and the URL cleanup would undo
    // state the replacement just set.
    const opener = openerFor.get(dialog);
    openerFor.delete(dialog);
    const wasStacked = stackedOn.delete(dialog);
    if ([...openDialogs].some(d => d.open)) {
      /* One overlay still open, two ways to get here. A HAND-OFF — a
         replacement overlay took this one's place — must not pull focus back
         out of the thing the user is now looking at. A STACKED overlay closing
         back into the one it was opened from is the opposite: the overlay
         underneath was there first, and focus belongs on the control inside it
         that opened this one, or it lands on <body> and the list is gone from
         under the keyboard. */
      if (wasStacked) restoreFocusQuietly(opener);
      return;
    }
    document.body.classList.remove('modal-open');
    restoreFocusQuietly(opener);
    onClose?.();
  });
  // A click on a <dialog>'s ::backdrop reports the dialog itself as the target;
  // a click on anything inside reports that element. Comparing targets is both
  // simpler and correct where a coordinate test is not: keyboard activation of
  // an in-dialog button fires a click with clientX/clientY = 0, which any
  // rect-based test reads as "outside" and closes the dialog under the user.
  dialog.addEventListener('click', event => {
    if (event.target === dialog) closeModal(dialog);
  });
}

/* ---------- contact modal ------------------------------------------------ */

function openContact() {
  if (!modal) return;
  setStatus('');
  contactForm?.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));
  openModal(modal, contactForm, () => document.getElementById('cfName')?.focus());
  if (recentSends().length >= CONTACT.maxSends) {
    setStatus(`You have already sent ${CONTACT.maxSends} messages. Try again in about ${cooldownMinutes()} minutes.`, 'error');
    if (sendBtn) sendBtn.disabled = true;
  } else if (sendBtn) {
    sendBtn.disabled = false;
  }
}

function closeContact() { closeModal(modal); }

if (modal) {
  // Any mailto link becomes the trigger; the href stays as the no-JS fallback.
  document.querySelectorAll('a[href^="mailto:"]').forEach(link => {
    link.addEventListener('click', event => { event.preventDefault(); openContact(); });
  });

  document.getElementById('contactClose')?.addEventListener('click', closeContact);
  document.getElementById('contactCancel')?.addEventListener('click', closeContact);
  bindModal(modal);
}

/* ---------- submit ------------------------------------------------------- */

function flagField(input, bad) {
  input?.closest('.contact-field')?.classList.toggle('invalid', bad);
}

contactForm?.addEventListener('submit', async event => {
  event.preventDefault();

  const name = document.getElementById('cfName');
  const email = document.getElementById('cfEmail');
  const message = document.getElementById('cfMessage');
  const trap = contactForm.querySelector('.contact-trap');

  if (trap?.value) return;                     // bot filled the honeypot

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim());
  const messageOk = message.value.trim().length >= 10;
  flagField(email, !emailOk);
  flagField(message, !messageOk);

  if (!emailOk) { setStatus('That email address does not look right.', 'error'); email.focus(); return; }
  if (!messageOk) { setStatus('Add a little more detail — at least 10 characters.', 'error'); message.focus(); return; }

  if (recentSends().length >= CONTACT.maxSends) {
    setStatus(`Limit reached. Try again in about ${cooldownMinutes()} minutes.`, 'error');
    return;
  }

  const from = name.value.trim() || 'Portfolio visitor';

  if (!CONTACT.endpoint) {
    // No relay configured: hand off to the visitor's mail client.
    const body = `From: ${from} <${email.value.trim()}>\n\n${message.value.trim()}`;
    window.location.href = `mailto:${CONTACT.to}?subject=${encodeURIComponent('Portfolio message from ' + from)}&body=${encodeURIComponent(body)}`;
    recordSend();
    setStatus('Opening your email app…', 'ok');
    return;
  }

  sendBtn.disabled = true;
  setStatus('Sending…');

  try {
    const response = await fetch(CONTACT.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        ...(CONTACT.accessKey ? { access_key: CONTACT.accessKey } : {}),
        // Checked only by a bot that filled every field it found. Web3Forms
        // drops the submission server-side; a honeypot that is never sent is
        // just decoration, which is what _gotcha had been.
        botcheck: Boolean(document.getElementById('cfBotcheck')?.checked),
        name: from,
        email: email.value.trim(),
        message: message.value.trim(),
        subject: `Portfolio message from ${from}`
      })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    recordSend();
    contactForm.reset();
    if (recentSends().length >= CONTACT.maxSends) {
      setStatus(`That is ${CONTACT.maxSends} for now — the form reopens in about ${cooldownMinutes()} minutes.`, 'ok', '✓ Message sent.');
    } else {
      setStatus("I'll get back to you soon.", 'ok', '✓ Message sent.');
      sendBtn.disabled = false;
    }
  } catch {
    sendBtn.disabled = false;
    setStatus(`Could not send. Email me directly at ${CONTACT.to}.`, 'error');
  }
});

/* ==========================================================================
   RESUME OVERLAY
   ========================================================================== */

const PAGE_W = 816;                       // US Letter at 96dpi, matches the CSS
const ZOOM_MIN = 0.7, ZOOM_MAX = 2.5, ZOOM_STEP = 0.1;
const ZOOM_COMFORT = 0.8;                 // leave a margin rather than filling edge to edge
const resumeModal = document.getElementById('resumeModal');
const resumeScroll = document.getElementById('resumeScroll');
const resumePages = [...document.querySelectorAll('.resume-page')];
const resumeTabs = [...document.querySelectorAll('.resume-tab')];
const pdfLink = document.querySelector('.resume-pdf');
const DOCS = {
  'tab-resume': { file: 'Dex_Cimino_Resume.pdf', label: 'Download Dex Cimino resume as PDF',
                  tip: 'Download Resume' },
  'tab-cover':  { file: 'Dex_Cimino_Cover.pdf',  label: 'Download Dex Cimino cover letter as PDF',
                  tip: 'Download Cover' },
};
const zoomLevelEl = document.getElementById('zoomLevel');
const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');

// Derived from the available width rather than hardcoded, so a wide desktop
// opens genuinely readable (~130-150%) and a phone opens fitted, from one rule.
function defaultZoom() {
  return Math.round(fitZoom() * ZOOM_COMFORT * 10) / 10;
}

// The zoom at which the page exactly fills the viewer's width.
function fitZoom() {
  // clientWidth includes padding, and .resume-scroll's padding is fluid — a flat
  // guess leaves the page overflowing its own gutters at some widths.
  const cs = getComputedStyle(resumeScroll);
  const avail = resumeScroll.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 1;
  return Math.max(0.3, avail / PAGE_W);
}

// A flat 70% floor cannot fit an 816px page into a 390px phone, which would put
// the viewer in horizontal scroll the moment it opens. Let the floor drop to
// whatever fits when the viewport is narrower than the desktop minimum.
const minZoom = () => Math.min(ZOOM_MIN, fitZoom());

let resumeZoom = 1.1;

function applyZoom(next, anchorRatio) {
  const floor = minZoom();
  resumeZoom = Math.min(ZOOM_MAX, Math.max(floor, Math.round(next * 100) / 100));
  // Zoom is a viewing preference, not a property of either document — both
  // panels carry it so switching tabs keeps the level.
  resumePages.forEach(page => { page.style.zoom = resumeZoom; });
  const pct = `${Math.round(resumeZoom * 100)}%`;
  if (zoomLevelEl) zoomLevelEl.textContent = pct;
  // Zoom is on the button's accessible description, not just a live region, so
  // it is available on focus rather than only when it changes.
  zoomInBtn?.setAttribute('aria-label', `Zoom in, currently ${pct}`);
  zoomOutBtn?.setAttribute('aria-label', `Zoom out, currently ${pct}`);
  if (zoomInBtn) zoomInBtn.disabled = resumeZoom >= ZOOM_MAX - 0.001;
  if (zoomOutBtn) zoomOutBtn.disabled = resumeZoom <= floor + 0.001;
  // Keep roughly the same line under the reader instead of snapping to the top.
  if (anchorRatio != null) {
    resumeScroll.scrollTop = anchorRatio * (resumeScroll.scrollHeight - resumeScroll.clientHeight);
  }
}

function nudgeZoom(delta) {
  const range = resumeScroll.scrollHeight - resumeScroll.clientHeight;
  const anchor = range > 0 ? resumeScroll.scrollTop / range : 0;
  applyZoom(resumeZoom + delta, anchor);
}

function openResume(trigger) {
  if (!resumeModal) return;
  openModal(resumeModal, document.querySelector('.resume-shell'), () => {
    selectTab('tab-resume');            // every trigger lands on the resume
    resumeScroll.scrollTop = 0;
    // Never open wider than the viewer: horizontal scroll should be something
    // the reader opts into by zooming, not the state they land in.
    applyZoom(Math.min(defaultZoom(), fitZoom()));
    quietFocus(resumeScroll);        // same reason as the work stage
    resumeScroll.focus();
  }, trigger);
  // pushState so the back button closes the overlay and /#resume is linkable —
  // the one place pushState is right, because it is a real navigation.
  if (location.hash !== '#resume') {
    try { history.pushState({ resume: true }, '', '#resume'); } catch { /* file:// */ }
  }
}

function selectTab(id) {
  resumeTabs.forEach(tab => {
    const on = tab.id === id;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;                    // roving tabindex
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !on;
  });
  refreshPdfLink(id);
  resumeScroll.scrollTop = 0;                      // different document, start at the top
  resumeScroll.scrollLeft = 0;
}

/* The download must match the document on screen. There is ONE pre-rendered PDF
   per document (tools/build_docs_pdf) — the per-accent variants were rolled back
   in 35bd18b, so the accent no longer picks the file and this never needs to run
   on a colour change. data-name pins the saved filename rather than letting the
   browser derive one from the URL. Called from selectTab, so switching document
   re-aims the button — including its tooltip, which names what you are about to
   get. */
function refreshPdfLink(id) {
  const active = id || resumeTabs.find(t => t.getAttribute('aria-selected') === 'true')?.id;
  const doc = DOCS[active];
  if (!doc || !pdfLink) return;
  pdfLink.dataset.file = `assets/about/${doc.file}`;
  pdfLink.dataset.name = doc.file;
  pdfLink.dataset.tip = doc.tip;
  pdfLink.setAttribute('aria-label', doc.label);
}
// Aim it now rather than waiting for the first selectTab: the target, saved name
// and labels are all owned here, so this is what keeps them true to DOCS if the
// markup's hardcoded starting values ever drift from it.
refreshPdfLink();
if (pdfLink) pdfLink.addEventListener('click', () => saveFile(pdfLink));

/* A visitor printing the open overlay themselves (Ctrl+P) goes through the
   same @media print sheet as the generated PDFs. The fit factor cannot be
   computed in CSS, so it is set here from the same formula the generator
   uses: content taller than one Letter sheet shrinks onto it uniformly. */
let printFitMine = false;
window.addEventListener('beforeprint', () => {
  // beforeprint fires for the PDF generator's page.pdf() as well, and the
  // generator has already measured the fit UNDER PRINT MEDIA and set the
  // property — more exactly than this handler can from screen media. First
  // time round this stomped that value: the cover shrank from its exact 1.0
  // to 0.9962 and printed with a 3px band down the right edge and 4px along
  // the bottom. If a fit is already set, it wins; this handler only serves a
  // visitor's own Ctrl+P, where nothing has set one.
  if (document.documentElement.style.getPropertyValue('--print-fit') !== '') return;
  const page = resumePages.find(p => !p.hidden);
  if (!page) return;
  const inline = page.style.zoom;
  page.style.zoom = '1';
  const h = page.scrollHeight;
  page.style.zoom = inline;
  // 4px under the true sheet: this measures in screen media and print reflows
  // a few px taller — exact-on-screen can be one line over on paper, which
  // paginates. The generated PDFs measure in print media and use the full sheet.
  document.documentElement.style.setProperty('--print-fit', String(Math.min(1, (1056 - 4) / h)));
  printFitMine = true;
});
window.addEventListener('afterprint', () => {
  // Clear only what this handler set, so the next print remeasures the panel
  // that is showing THEN — otherwise a resume fit sticks to a later cover
  // print. The generator's own value is never touched.
  if (!printFitMine) return;
  printFitMine = false;
  document.documentElement.style.removeProperty('--print-fit');
});

function closeResume() { closeModal(resumeModal); }

if (resumeModal) {
  // Everything that can close the dialog — button, Esc, backdrop, or being
  // displaced by the contact modal — lands here, so the hash is tidied once.
  bindModal(resumeModal, () => {
    if (location.hash === '#resume') {
      try { history.back(); } catch { /* file:// */ }
    }
  });

  document.getElementById('resumeClose')?.addEventListener('click', () => closeResume());
  resumeTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => { selectTab(tab.id); tab.focus(); });
    tab.addEventListener('keydown', event => {
      const move = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
      let next = null;
      if (move != null) next = resumeTabs[(index + move + resumeTabs.length) % resumeTabs.length];
      else if (event.key === 'Home') next = resumeTabs[0];
      else if (event.key === 'End') next = resumeTabs[resumeTabs.length - 1];
      if (!next) return;
      event.preventDefault();
      selectTab(next.id);
      next.focus();
    });
  });

  zoomInBtn?.addEventListener('click', () => nudgeZoom(ZOOM_STEP));
  zoomOutBtn?.addEventListener('click', () => nudgeZoom(-ZOOM_STEP));

  // Every resume control opens the overlay.
  document.querySelectorAll('[data-resume-open]').forEach(control => {
    control.addEventListener('click', event => { event.preventDefault(); openResume(control); });
  });

  // Ctrl/Cmd +/- zooms the resume only while the overlay is open; otherwise the
  // browser keeps its own zoom.
  window.addEventListener('keydown', event => {
    if (!resumeModal.open || !(event.ctrlKey || event.metaKey)) return;
    if (event.key === '+' || event.key === '=') { event.preventDefault(); nudgeZoom(ZOOM_STEP); }
    else if (event.key === '-') { event.preventDefault(); nudgeZoom(-ZOOM_STEP); }
  });

  // Back button closes it; a direct load of /#resume opens it.
  window.addEventListener('popstate', () => {
    if (location.hash === '#resume') openResume(null);
    else closeResume();
  });
  if (location.hash === '#resume') {
    window.addEventListener('load', () => openResume(null), { once: true });
  }
}

/* ==========================================================================
   WORK OVERLAY
   A category gallery in a <dialog>, opened by the four featured cards and by
   VIEW ALL WORK. Everything a modal needs — scroll lock, focus trap, focus
   restoration, "never two overlays at once" — comes from openModal/bindModal
   above; nothing here reimplements it.

   MOCKUP STATUS: the images are generated filler, not artwork. The block
   marked TEMPORARY MOCKUP DATA is the only part that knows that. Everything
   after it renders a plain list of { title, desc, src, w, h } and does not
   care where the list came from, so the real build swaps one block for
   work.json plus the derivatives bake_images.py already writes.
   ========================================================================== */

/* >>> TEMPORARY MOCKUP DATA — filler only, delete this whole block >>>
   No files are involved and none should be added: each placeholder is an SVG
   data URI generated at a real pixel size, which the shipped CSP already
   allows (img-src 'self' data:, needed by the favicon and the icon masks).
   The ten shapes are deliberately mixed — landscape, portrait, square and
   ultrawide — because uniform placeholders hide exactly the layout problems
   the fixed hero box exists to solve.
   Replaced by: work.json + a manifest from tools/bake_images.py. */

const MOCK_SHAPES = [
  [1600, 900], [900, 1600], [1200, 1200], [2000, 850], [1400, 1050],
  [1080, 1350], [1600, 1000], [1000, 1000], [1500, 844], [1200, 1600]
];

const MOCK_CATS = [
  { id:'environment', label:'ENVIRONMENT', hue:96,
    tools:['Maya · Substance', 'Blender · Painter', 'Unreal · Substance'],
    titles:['Valley Outpost','Ashfall Ridge','Sunken Depot','Kiln District','Frostgate Pass',
            'Rust Chapel','Terrace Ruins','Dead Signal Bay','Quarry Nine','Verdant Spire'] },
  { id:'character', label:'CHARACTER', hue:280,
    tools:['ZBrush · Painter', 'Maya · ZBrush', 'Blender · Painter'],
    titles:['Bone Archer','Lava Goblin','Slag Runner','Wickerling','Clayweld',
            'Marrow Knight','Dust Pilgrim','Cinder Twin','Vault Warden','Hex Catalyst'] },
  { id:'prop', label:'PROP / DESIGN', hue:200,
    tools:['Maya · Substance', 'ZBrush · Painter', 'Blender · Painter'],
    titles:['Ember Lantern','Cargo Rig','Grimshot Rifle','Trench Kit','Signal Beacon',
            'Anvil Drone','Field Radio','Bolt Charm','Salvage Crate','Ration Pack'] },
  { id:'concept', label:'CONCEPT', hue:22,
    tools:['Photoshop · Concept', 'Procreate · Photoshop', 'Illustrator · Photoshop'],
    titles:['Wire Bloom','Nightfall Market','Paper Titan','Circuit Siege','Glass Orchard',
            'Static Choir','Iron Tide','Low Orbit Diner','Hollow Parade','Nine Lanterns'] },
  { id:'projects', label:'PROJECTS / GAMES', hue:330,
    tools:['Unity · Blender', 'Web · Claude Code', 'Roblox Studio'],
    titles:['Cupcake Gobbler','Stick It','Arena1','DexNote','NodeBlast',
            'Tilt Tactics','Grid Runner','Pocket Forge','Loop Lander','Sprite Foundry'] }
];

// A placeholder that shows its own geometry: the frame and centre ticks make
// the letterboxing obvious, and the printed w×h means a wrong crop is visible
// at a glance instead of having to be measured. `&#215;` rather than a literal
// ×, so the data URI stays pure ASCII and needs no charset declaration.
function mockImage(width, height, label, hue) {
  const min = Math.min(width, height);
  const pad = Math.round(min * .035);
  const tick = Math.round(min * .09);
  const r = value => Math.round(value * 10) / 10;   // keep 1600*.66 out of the markup
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="hsl(${hue},24%,23%)"/><stop offset="1" stop-color="hsl(${hue + 26},32%,9%)"/>`
    + `</linearGradient></defs>`
    + `<rect width="${width}" height="${height}" fill="url(#g)"/>`
    // The diagonal echoes the page background, so a filler still reads as this site.
    + `<path d="M${r(width * .66)} 0H${width}L${r(width * .34)} ${height}H0Z" fill="hsl(${hue},46%,58%)" fill-opacity=".07"/>`
    + `<g fill="none" stroke="hsl(${hue},48%,62%)" stroke-opacity=".3" stroke-width="${r(Math.max(2, min * .006))}">`
    + `<rect x="${pad}" y="${pad}" width="${width - pad * 2}" height="${height - pad * 2}"/>`
    + `<path d="M${pad} ${r(height / 2)}h${tick}M${width - pad} ${r(height / 2)}h-${tick}`
    + `M${r(width / 2)} ${pad}v${tick}M${r(width / 2)} ${height - pad}v-${tick}"/></g>`
    + `<g font-family="ui-monospace,monospace" text-anchor="middle" fill="#fff">`
    + `<text x="50%" y="47%" font-size="${r(Math.max(17, min * .082))}" fill-opacity=".84">${label}</text>`
    + `<text x="50%" y="58%" font-size="${r(Math.max(13, min * .052))}" fill-opacity=".44">${width} &#215; ${height}</text>`
    + `<text x="50%" y="${r(height - pad * 2.2)}" font-size="${r(Math.max(10, min * .026))}" fill-opacity=".3" letter-spacing="${r(Math.max(1, min * .004))}">FILLER — NOT REAL WORK</text>`
    + `</g></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function buildMockWork() {
  return MOCK_CATS.map((cat, catIndex) => ({
    id: cat.id,
    label: cat.label,
    items: cat.titles.map((title, i) => {
      // Rotated per category, so every tab carries the same ten aspect ratios
      // in a different order and no tab can accidentally look uniform.
      const [w, h] = MOCK_SHAPES[(i + catIndex * 3) % MOCK_SHAPES.length];
      return {
        title,
        desc: `${cat.tools[i % cat.tools.length]} · ${2022 + (i % 4)}`,
        src: mockImage(w, h, `${cat.label.split(' ')[0]} ${String(i + 1).padStart(2, '0')}`, cat.hue + i * 5),
        w, h
      };
    })
  }));
}

// Built on first open, not at load: fifty generated SVGs are cheap but there is
// no reason for them to compete with the hero image for the first paint.
let workCategoriesCache = null;
function workCategories() {
  return (workCategoriesCache ||= buildMockWork());
}
/* <<< TEMPORARY MOCKUP DATA <<< */

const workModal = document.getElementById('workModal');
const workTabsEl = document.getElementById('workTabs');
const workStripEl = document.getElementById('workStrip');
const workPanel = document.getElementById('workPanel');
const workHero = document.getElementById('workHero');
const workHeroImg = document.getElementById('workHeroImg');
const workCapTitle = document.getElementById('workCapTitle');
const workCapDesc = document.getElementById('workCapDesc');
const workCapIndex = document.getElementById('workCapIndex');
const workPrevBtn = document.getElementById('workPrev');
const workNextBtn = document.getElementById('workNext');

let workTabButtons = [];
let workCat = 0;      // index into workCategories()
let workIdx = 0;      // index into the active category's items
let workHeroToken = 0;

const pad2 = value => String(value).padStart(2, '0');
const workItems = () => workCategories()[workCat].items;

/* ---------- tabs --------------------------------------------------------- */

function buildWorkTabs() {
  const frag = document.createDocumentFragment();
  workCategories().forEach((cat, index) => {
    const tab = document.createElement('button');
    tab.className = 'work-tab';
    tab.type = 'button';
    tab.id = `work-tab-${cat.id}`;
    tab.dataset.index = String(index);
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'workPanel');   // one panel serves all five
    tab.setAttribute('aria-selected', 'false');
    tab.tabIndex = -1;                                // roving tabindex

    const label = document.createElement('span');
    label.textContent = cat.label;
    const count = document.createElement('span');
    count.className = 'work-tab-count';
    count.textContent = String(cat.items.length);
    tab.append(label, count);

    tab.addEventListener('click', () => selectWorkCategory(index));
    frag.appendChild(tab);
  });
  workTabsEl.replaceChildren(frag);
  workTabButtons = [...workTabsEl.querySelectorAll('.work-tab')];
}

// Switching category always resets to the first image and rebuilds the strip;
// only the openers pass an index, so a featured card can land on its own piece.
function selectWorkCategory(index, itemIndex = 0) {
  const cats = workCategories();
  workCat = Math.max(0, Math.min(cats.length - 1, index));

  workTabButtons.forEach((tab, i) => {
    const on = i === workCat;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
  });
  workPanel.setAttribute('aria-labelledby', workTabButtons[workCat].id);
  workTabButtons[workCat].scrollIntoView({ inline: 'nearest', block: 'nearest' });

  buildWorkStrip(cats[workCat].items);
  showWorkItem(itemIndex);
}

/* ---------- filmstrip ---------------------------------------------------- */

// Takes a list, not a category: the only thing it needs is { title, src, w, h }.
function buildWorkStrip(items) {
  const frag = document.createDocumentFragment();
  items.forEach((item, i) => {
    const thumb = document.createElement('button');
    thumb.className = 'work-thumb';
    thumb.type = 'button';
    thumb.setAttribute('aria-label', `${i + 1}. ${item.title}`);
    thumb.setAttribute('aria-current', 'false');

    const img = document.createElement('img');
    img.src = item.src;
    img.alt = '';
    img.width = item.w;          // intrinsic size as attributes, never as style
    img.height = item.h;
    img.loading = 'lazy';
    img.decoding = 'async';
    thumb.appendChild(img);

    thumb.addEventListener('click', () => showWorkItem(i));
    frag.appendChild(thumb);
  });
  workStripEl.replaceChildren(frag);
}

/* ---------- hero --------------------------------------------------------- */

// Decode before swapping so a half-painted frame can never land in the hero,
// and token the swap the way swapMascots does: click through the strip quickly
// and an earlier, slower decode must not finish last and win.
function paintWorkHero(item) {
  const token = ++workHeroToken;
  workHeroImg.classList.add('is-fading');

  const warm = new Image();
  warm.src = item.src;
  const show = () => {
    if (token !== workHeroToken) return;
    workHeroImg.src = item.src;
    workHeroImg.width = item.w;
    workHeroImg.height = item.h;
    workHeroImg.alt = item.title;
    // Two frames: the first commits the faded state with the new image in it,
    // the second starts the fade back in. One frame and the browser coalesces
    // both into a single style recalc, so the transition never plays.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (token === workHeroToken) workHeroImg.classList.remove('is-fading');
    }));
  };
  if (warm.decode) warm.decode().then(show, show);
  else warm.onload = warm.onerror = show;
}

// Free for data URIs, but this is the shape the real gallery needs: the next
// image is already decoded by the time the arrow key is pressed.
function preloadWorkNeighbours(items, index) {
  [index - 1, index + 1].forEach(i => {
    if (items[i]) new Image().src = items[i].src;
  });
}

function showWorkItem(index) {
  const items = workItems();
  if (!items.length) return;
  workIdx = Math.max(0, Math.min(items.length - 1, index));
  const item = items[workIdx];

  paintWorkHero(item);
  workCapTitle.textContent = item.title;
  workCapDesc.textContent = item.desc;
  // Built from nodes, not innerHTML — same rule as setStatus.
  const position = document.createElement('b');
  position.textContent = pad2(workIdx + 1);
  workCapIndex.replaceChildren(position, ` / ${pad2(items.length)}`);

  workPrevBtn.disabled = workIdx === 0;
  workNextBtn.disabled = workIdx === items.length - 1;
  // Reaching an end must not strand focus on a button that just went disabled.
  if (document.activeElement === workNextBtn && workNextBtn.disabled) workPrevBtn.focus();
  else if (document.activeElement === workPrevBtn && workPrevBtn.disabled) workNextBtn.focus();

  [...workStripEl.children].forEach((thumb, i) => thumb.setAttribute('aria-current', String(i === workIdx)));
  // behavior:'auto' defers to the strip's CSS scroll-behavior, which the
  // reduced-motion block already flattens — same trick as scrollToY.
  workStripEl.children[workIdx]?.scrollIntoView({ inline: 'center', block: 'nearest' });
  preloadWorkNeighbours(items, workIdx);
}

/* ---------- open / close ------------------------------------------------- */

function openWork(catId, index, trigger) {
  if (!workModal) return;
  if (!workTabButtons.length) buildWorkTabs();
  const cats = workCategories();
  const catIndex = Math.max(0, cats.findIndex(cat => cat.id === catId));   // unknown id -> first tab
  openModal(workModal, null, () => {
    selectWorkCategory(catIndex, index);
    // The panel, not a control: it is the thing that just appeared, and it
    // leaves Left/Right free to browse images instead of switching tabs.
    // Muted, because a ring drawn around the whole stage the instant the
    // overlay appears marks something the visitor never selected. Tab back to
    // it later and it rings normally.
    quietFocus(workPanel);
    workPanel.focus({ preventScroll: true });
  }, trigger);
}

if (workModal) {
  bindModal(workModal);
  document.getElementById('workClose')?.addEventListener('click', () => closeModal(workModal));
  workPrevBtn.addEventListener('click', () => showWorkItem(workIdx - 1));
  workNextBtn.addEventListener('click', () => showWorkItem(workIdx + 1));

  // Triggers: the four featured cards land on their own piece, VIEW ALL WORK
  // opens on the first tab.
  document.querySelectorAll('[data-work-cat]').forEach(card => {
    card.addEventListener('click', () => {
      openWork(card.dataset.workCat, Number(card.dataset.workIndex) || 0, card);
    });
  });
  document.getElementById('viewAllWork')?.addEventListener('click', event => {
    openWork(null, 0, event.currentTarget);
  });

  // Left/Right inside the tab row belong to the tablist; that handler runs
  // first (the tablist is inside the dialog, this listener is on window) and
  // calls preventDefault, so the same keys mean "walk the tabs" there and
  // "walk the images" everywhere else in the dialog.
  workTabsEl.addEventListener('keydown', event => {
    const tab = event.target.closest?.('.work-tab');
    if (!tab) return;
    const index = workTabButtons.indexOf(tab);
    const move = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    let next = null;
    if (move != null) next = workTabButtons[(index + move + workTabButtons.length) % workTabButtons.length];
    else if (event.key === 'Home') next = workTabButtons[0];
    else if (event.key === 'End') next = workTabButtons.at(-1);
    if (!next) return;
    event.preventDefault();
    selectWorkCategory(Number(next.dataset.index));
    next.focus();
  });

  window.addEventListener('keydown', event => {
    if (!workModal.open || event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;   // browser shortcuts stay the browser's
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (step != null) { event.preventDefault(); showWorkItem(workIdx + step); }
    else if (event.key === 'Home') { event.preventDefault(); showWorkItem(0); }
    else if (event.key === 'End') { event.preventDefault(); showWorkItem(workItems().length - 1); }
  });

  // Swipe the hero on touch. Mice are excluded on purpose — a drag on a desktop
  // means "select this", not "next image".
  let swipeFrom = null;
  workHero.addEventListener('pointerdown', event => {
    swipeFrom = event.pointerType === 'mouse' ? null : event.clientX;
  });
  workHero.addEventListener('pointerup', event => {
    if (swipeFrom == null) return;
    const dx = event.clientX - swipeFrom;
    swipeFrom = null;
    if (Math.abs(dx) > 45) showWorkItem(workIdx + (dx < 0 ? 1 : -1));
  });
  workHero.addEventListener('pointercancel', () => { swipeFrom = null; });
}

/* ==========================================================================
   TABBED SECTIONS  (Toolkit, Top Picks)
   One helper rather than a fourth hand-rolled tablist. It owns the parts that
   are identical everywhere and easy to get subtly wrong — roving tabindex,
   Left/Right wrapping, Home/End — and knows nothing about what a panel holds.
   ========================================================================== */

// tablist -> panels by aria-controls. Returns a select(index) if a caller ever
// needs to drive it; the sections here are content-only and just let it run.
function initTabs(tablist, onSelect) {
  if (!tablist) return null;
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  if (!tabs.length) return null;
  const panelFor = tab => document.getElementById(tab.getAttribute('aria-controls'));

  function select(index, focus = false) {
    const next = Math.max(0, Math.min(tabs.length - 1, index));
    tabs.forEach((tab, i) => {
      const on = i === next;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;              // roving: one stop for the whole row
      const panel = panelFor(tab);
      if (panel) panel.hidden = !on;           // hidden, not display:none — it is
    });                                        // the panel's own semantic state
    if (focus) tabs[next].focus();
    onSelect?.(next, tabs[next]);
  }

  tabs.forEach((tab, i) => tab.addEventListener('click', () => select(i)));

  tablist.addEventListener('keydown', event => {
    const current = tabs.indexOf(event.target.closest('[role="tab"]'));
    if (current === -1) return;
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    let next = null;
    if (step != null) next = (current + step + tabs.length) % tabs.length;   // wraps
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next == null) return;
    event.preventDefault();
    select(next, true);
  });

  return select;
}

/* Toolkit tab changes ANIMATE: the incoming panel slides in from the side the
   navigation is travelling — and only the target panel, never the tabs in
   between, so jumping Software -> Team Tools shows one movement, not a blur of
   skipped icons. Direction comes from index order for tab clicks and is forced
   by the arrows so a wrap still reads as continuing forward or back. */
let tkPrev = 0;
let tkForcedDir = null;
const tkSelect = initTabs(document.querySelector('.tk-tabs'), (next, tab) => {
  const panel = document.getElementById(tab.getAttribute('aria-controls'));
  const dir = tkForcedDir !== null ? tkForcedDir : Math.sign(next - tkPrev);
  tkForcedDir = null;
  if (panel && panel.animate && next !== tkPrev && dir !== 0
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    panel.animate(
      [{ opacity: 0, transform: `translateX(${dir * 44}px)` }, { opacity: 1, transform: 'none' }],
      { duration: 280, easing: 'cubic-bezier(.22,.61,.36,1)' });
  }
  tkPrev = next;
});

/* The blank-slots-then-pop problem: hidden panels hold loading="lazy" images,
   and a lazy image in a display:none panel is never fetched — so the first
   visit to a tab used to start its downloads. Same lesson as the games
   artwork. Warm every toolkit icon (small SVGs) as the section approaches:
   eager starts the fetch even while hidden, decode() takes the decode off the
   click path, and by the time anything slides in it is already painted. */
(function warmToolkitIcons() {
  const section = document.getElementById('toolkit');
  if (!section) return;
  const warm = () => {
    for (const img of section.querySelectorAll('img.tk-icon')) {
      img.loading = 'eager';
      if (img.decode) img.decode().catch(() => {});
    }
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { io.disconnect(); warm(); }
    }, { rootMargin: '600px 0px' });
    io.observe(section);
  } else warm();
})();

/* Toolkit carousel arrows. They drive the same select() the tabs use, so the
   roving tabindex, panel hidden flags and aria-selected all stay right, and
   the index wraps — with a cycle there is no end to grey out, which is why
   both arrows are always present. */
(function initTkArrows() {
  if (!tkSelect) return;
  const tabs = [...document.querySelectorAll('.tk-tabs [role="tab"]')];
  const step = delta => {
    const i = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
    tkForcedDir = delta;                    // a wrap still slides the way you pressed
    tkSelect((i + delta + tabs.length) % tabs.length);
  };
  document.querySelector('.tk-arrow-prev')?.addEventListener('click', () => step(-1));
  document.querySelector('.tk-arrow-next')?.addEventListener('click', () => step(1));
})();
/* Top Picks carousel — the Toolkit one, with the image problem solved properly.
   Same arrows, same wrap, same slide. What differs is the payload: Toolkit
   panels hold 2 KB SVG icons, these hold cover ART, and warming every one of
   them the moment the section nears (the Toolkit strategy) is the wrong trade
   for ~300 KB of AVIF. Three things happen instead:

     1. WARM BY DISTANCE. On approach, the panels one arrow press away go first,
        the rest follow in a second idle pass. The next click is always the one
        already paid for, and fetchPriority='low' keeps all of it behind
        anything the visible panel still wants.
     2. GATE THE SWAP ON DECODE. A fetched image is not a painted one — decode
        happens on the frame it first renders, which is exactly the frame the
        slide starts, and that is what makes covers hatch in mid-animation. The
        incoming panel is held at opacity 0 until decode() resolves, so the
        slide begins with the art already rasterised. Warm panels resolve in a
        microtask, so the common case is not delayed at all.
     3. NEVER STALL ON THE NETWORK. The hold races a 180 ms timeout: on a cold
        cache the panel slides in and paints progressively, which is the normal
        web, rather than sitting blank waiting on a promise.

   Save-Data turns off 1 entirely — on a metered connection, panels load when
   asked for and not a byte sooner. */
(function initPkCarousel() {
  const tablist = document.querySelector('.pk-tabs');
  if (!tablist) return;
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  if (!tabs.length) return;
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));

  const idle = fn => ('requestIdleCallback' in window)
    ? requestIdleCallback(fn, { timeout: 2000 })
    : setTimeout(fn, 400);

  /* One decode promise per panel, memoised — so a second visit costs nothing
     and the gate below resolves immediately. eager is what actually starts the
     fetch: a loading="lazy" image inside a [hidden] panel is never fetched at
     all, which is the blank-slots-then-pop bug in its original form. */
  const decoded = new WeakMap();
  function warm(panel, priority) {
    if (!panel) return Promise.resolve();
    const done = decoded.get(panel);
    if (done) return done;
    const imgs = [...panel.querySelectorAll('img')];
    const all = Promise.all(imgs.map(img => {
      img.loading = 'eager';
      if ('fetchPriority' in img) img.fetchPriority = priority;
      // A decode that rejects (format the browser won't take) still counts as
      // settled — <picture> falls through on its own and the gate must open.
      return img.decode ? img.decode().catch(() => {}) : Promise.resolve();
    })).then(() => {});
    decoded.set(panel, all);
    return all;
  }
  const warmNeighbours = i => {
    warm(panels[(i + 1) % panels.length], 'low');
    warm(panels[(i - 1 + panels.length) % panels.length], 'low');
  };

  /* The cold path, where the 180 ms timeout opened the gate with art still in
     flight. Those covers fade in as they land instead of snapping from empty
     box to full-bleed image — the same thing the gate prevents, just handled
     after the fact. Already-painted images are skipped, so on the warm path
     this loop does nothing. */
  function hatch(panel) {
    for (const img of panel.querySelectorAll('img')) {
      if (img.complete && img.naturalWidth > 0) continue;
      img.classList.add('is-hatching');
      const reveal = () => {
        img.classList.remove('is-hatching');
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease' });
        }
      };
      img.addEventListener('load', reveal, { once: true });
      img.addEventListener('error', reveal, { once: true });
    }
  }

  let current = 0;
  let forcedDir = null;
  let token = 0;                 // a second press must cancel the first's gate

  const select = initTabs(tablist, (next, tab) => {
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    const dir = forcedDir !== null ? forcedDir : Math.sign(next - current);
    forcedDir = null;
    const moved = next !== current && dir !== 0;
    current = next;
    if (!panel) return;

    const mine = ++token;
    panels.forEach(p => p && p.classList.remove('is-decoding'));
    const ready = warm(panel, 'high');
    idle(() => warmNeighbours(next));

    // Reduced motion has no slide to protect, so showing the panel at once
    // beats holding it blank while art decodes.
    if (!moved || !panel.animate
        || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    panel.classList.add('is-decoding');
    Promise.race([ready, new Promise(done => setTimeout(done, 180))]).then(() => {
      if (mine !== token) return;                 // superseded by a later press
      hatch(panel);                               // no-op unless the timeout won
      panel.classList.remove('is-decoding');
      panel.animate(
        [{ opacity: 0, transform: `translateX(${dir * 44}px)` }, { opacity: 1, transform: 'none' }],
        { duration: 280, easing: 'cubic-bezier(.22,.61,.36,1)' });
    });
  });

  if (select) {
    const step = delta => {
      const i = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
      forcedDir = delta;                  // a wrap still slides the way you pressed
      select((i + delta + tabs.length) % tabs.length);
    };
    document.querySelector('.pk-arrow-prev')?.addEventListener('click', () => step(-1));
    document.querySelector('.pk-arrow-next')?.addEventListener('click', () => step(1));
  }

  const section = document.getElementById('picks');
  if (!section || navigator.connection?.saveData) return;
  const prewarm = () => idle(() => {
    warmNeighbours(current);                            // one press away first
    idle(() => panels.forEach(p => warm(p, 'low')));    // then the far side
  });
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { io.disconnect(); prewarm(); }
    }, { rootMargin: '600px 0px' });
    io.observe(section);
  } else prewarm();
})();

/* --- quote renditions ----------------------------------------------------- */
/* Each card holds both versions in data-* and swaps text in place, so a quote
   and its cite can never drift apart. Cards with no rendition have no button —
   the has-rendition class gates it in CSS — so there is nothing to guard here.
   CLICK ONLY (Dex, 2026-08-24). Hover used to preview the second version and a
   click pinned it; the preview is gone, so the text changes on a deliberate
   press and never on a pointer crossing the card. Hover still lights the pill,
   which is CSS on the control and cannot touch the quote. aria-pressed carries
   the state, which is why this is a real <button>. */
(function initQuoteRenditions() {
  for (const card of document.querySelectorAll('.pk-quote')) {
    const text = card.querySelector('.pk-quote-text');
    const cite = card.querySelector('.pk-quote-cite');
    if (!text || !cite) continue;

    const paint = (mode) => {
      text.textContent = text.dataset[mode] || text.dataset.original || '';
      cite.textContent = cite.dataset[mode] || cite.dataset.original || '';
    };
    paint('original');

    const btn = card.querySelector('.pk-quote-toggle');
    if (!btn) continue;                      // no rendition: original is final

    let showing = false;                 // false = original, true = rendition
    const set = (on) => {
      paint(on ? 'rendition' : 'original');
      btn.setAttribute('aria-pressed', String(on));
    };

    /* The two versions are different lengths, so the card is locked to the
       taller one - measured only once the panel is actually visible (a hidden
       tab measures zero) and re-measured on resize, because wrapping moves the
       answer. This began as a flicker fix: a swap changed the height, moved the
       button out from under the pointer, fired pointerleave and reverted. That
       loop cannot happen now that hover does nothing, but the lock stays on its
       own merit - a card that resizes under a click is still worse than one
       that does not. */
    const lockHeight = () => {
      if (!card.offsetHeight) return;
      const was = btn.getAttribute('aria-pressed') === 'true' ? 'rendition' : 'original';
      card.style.minHeight = '';
      paint('original');
      const a = card.offsetHeight;
      paint('rendition');
      const b = card.offsetHeight;
      card.style.minHeight = Math.max(a, b) + 'px';
      paint(was);
    };
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) { io.disconnect(); lockHeight(); }
      });
      io.observe(card);
    } else lockHeight();
    let relock;
    window.addEventListener('resize', () => {
      clearTimeout(relock);
      relock = setTimeout(lockHeight, 150);
    });
    btn.addEventListener('click', () => { showing = !showing; set(showing); });
  }
})();
initTabs(document.querySelector('.ai-tabs'));
/* --- prefs votes ---------------------------------------------------------- */
/* ONE BROWSER, ONE OPINION, and that is the honest ceiling here: there is no
   server behind this page, so there is no way to hold one vote per person -
   that needs something running server-side to see who is asking. What this does
   instead is remember YOUR pick in localStorage under a single key for all ten
   cards, and show the seed from the markup plus your own vote. Nothing is
   shared between visitors, a private window is a new voter, and the numbers are
   a mood rather than a poll. Say so plainly rather than implying a tally.

   Seeds live on the cards as data-fire / data-poop so they can be retuned in
   the markup without opening this file.

   Every storage call is wrapped: localStorage THROWS outright in some privacy
   modes, and a panel of ten cards must not disappear because a getter raised. */
(function initPrefVotes() {
  const cards = [...document.querySelectorAll('.pk-pref')];
  if (!cards.length) return;
  const KEY = 'dex.prefs.votes';

  let votes = {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (raw && typeof raw === 'object') votes = raw;
  } catch { votes = {}; }                       // unreadable or disabled: start clean
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(votes)); } catch { /* not persisted */ }
  };

  for (const card of cards) {
    const key = card.dataset.key;
    const seed = { fire: Number(card.dataset.fire) || 0, poop: Number(card.dataset.poop) || 0 };
    const buttons = [...card.querySelectorAll('.pk-vote')];
    if (!key || buttons.length !== 2) continue;

    const paint = () => {
      for (const button of buttons) {
        const kind = button.dataset.vote;
        const on = votes[key] === kind;
        button.setAttribute('aria-pressed', String(on));
        button.querySelector('.pk-vote-count').textContent = seed[kind] + (on ? 1 : 0);
      }
    };

    for (const button of buttons) {
      button.addEventListener('click', () => {
        // Pressing the one already chosen takes the vote back; pressing the
        // other moves it. There is no way to be for and against at once.
        const kind = button.dataset.vote;
        if (votes[key] === kind) delete votes[key];
        else votes[key] = kind;
        save();
        paint();
      });
    }
    paint();
  }
})();

/* --- saving a file without a link ---------------------------------------- */
/* Every download on the site is a <button data-file data-name>, not an <a href
   download>, for one reason: a link makes the browser print the full asset URL
   in its status bubble at the bottom-left of the window on hover, and that
   bubble is browser chrome — no page can style, move or suppress it. So the
   file is fetched here and handed to a throwaway <a> carrying a blob URL, which
   never appears in the bubble.

   The cost is real and worth knowing: right-click "save link as" and the
   works-without-JS fallback both go away. That is acceptable for a decorative
   download button and would NOT be for a navigation link, which is why ordinary
   links are left alone.

   Declared (not assigned) so the carousels below can call it regardless of
   where they sit in this file. */
async function saveFile(btn) {
  const url = btn.dataset.file, name = btn.dataset.name;
  if (!url) return;
  const tip = btn.dataset.tip;
  btn.disabled = true;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = name || url.split('/').pop();
    document.body.appendChild(a); a.click(); a.remove();
    // Revoked later: revoking synchronously can beat the download to the file.
    setTimeout(() => URL.revokeObjectURL(href), 4000);
  } catch {
    // Nothing clever to do, but say so rather than looking like a dead button.
    btn.dataset.tip = 'Download failed — try again';
    setTimeout(() => { btn.dataset.tip = tip; }, 2600);
  } finally {
    btn.disabled = false;
  }
}

/* Clipboard, with the fallback. The async API needs a secure context and can be
   refused outright, so the old selection-based copy stays for a page opened over
   plain http or straight off the disk. Module-level for the same reason saveFile
   is: the callers sit elsewhere in this file. */
async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    // Off-screen but not display:none — a field with no box cannot be selected.
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

/* --- tooltip -------------------------------------------------------------- */
/* Assigned by initTooltip below, declared out here for the same reason saveFile
   is: the modules that call it sit elsewhere in this file and must not have to
   care which IIFE ran first. */
let flashTip = () => {};

/* One tooltip element for the whole page, moved and relabelled on hover.

   The native `title` bubble cannot be styled at all — not the font, not the
   radius, not the delay — so anything that wants a tooltip carries data-tip
   instead. Any `title` left on a link or button is converted on load rather
   than hunted down by hand: that also removes the attribute, which is what
   stops the OS bubble appearing UNDER this one. `title` elsewhere (an iframe's
   accessible name, an SVG <title>) is left alone, because there it is not a
   tooltip at all.

   Follows focus as well as the pointer, so keyboard users get the same label. */
(function initTooltip() {
  document.querySelectorAll('a[title], button[title]').forEach(el => {
    el.dataset.tip = el.getAttribute('title');
    el.removeAttribute('title');
  });

  const tip = document.createElement('div');
  tip.id = 'tip';
  tip.setAttribute('role', 'presentation');
  document.body.appendChild(tip);

  let current = null;
  const GAP = 10;
  // Non-null while the bubble is being used as a confirmation rather than a
  // label. Hover must not overwrite an answer to something the visitor just did.
  let flashing = null;

  function place(el) {
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    /* Opt-in side placement. data-tip-pos="right" puts the bubble BESIDE the
       target and centred on it, which is what a small mark parked in a margin
       wants: the default above-placement sits over the thing it labels, and
       for a stacked pair the upper bubble covers the upper mark.

       RIGHT IF IT FITS, OTHERWISE LEFT, and only then the default. The marks
       that ask for this are the bio's flags, which live in the section's own
       right padding - measured at 1440 there are 81px between them and the
       window edge against a 105px "Born Colorado", so the preferred side is
       the one there is least often room on. Flipping to the inside keeps the
       bubble beside its mark and centred, which is the part that matters;
       above is kept as the last resort for a viewport too narrow for either. */
    if (el.dataset.tipPos === 'right') {
      const fitsRight = r.right + GAP + t.width <= window.innerWidth - 6;
      const fitsLeft = r.left - GAP - t.width >= 6;
      if (fitsRight || fitsLeft) {
        const mid = r.top + r.height / 2 - t.height / 2;
        tip.style.left = `${Math.round(fitsRight ? r.right + GAP : r.left - GAP - t.width)}px`;
        tip.style.top = `${Math.round(Math.max(6, Math.min(mid, window.innerHeight - t.height - 6)))}px`;
        return;
      }
    }
    /* BELOW by default (Dex, 2026-08-24). Above put the bubble on top of the
       thing the label belongs to: on a picks card it landed over the title and
       the line under it, which is the text someone is reading at the moment
       they go looking for an icon's name. Above is kept as the fallback for a
       target close to the bottom of the window, and the clamp stops that
       fallback pushing it off the top on a short viewport. */
    let top = r.bottom + GAP;
    if (top + t.height > window.innerHeight - 6) top = r.top - t.height - GAP;
    if (top < 6) top = 6;
    let left = r.left + r.width / 2 - t.width / 2;
    left = Math.max(6, Math.min(left, window.innerWidth - t.width - 6));
    // left/top, not a transform: transform is animatable and the tip would slide
    // across the page from its previous spot every time it changed target.
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }

  function show(el) {
    if (flashing) return;
    const text = el.dataset.tip;
    if (!text) return;
    current = el;
    tip.textContent = text;
    tip.classList.add('is-on');
    // Measure after the text lands, or the first show is positioned off the
    // previous label's width.
    place(el);
  }
  function hide() {
    if (flashing) return;
    current = null;
    tip.classList.remove('is-on');
    // Position is left where it was. It fades out in place, and the next show()
    // moves it while it is still invisible.
  }

  /* The same bubble, borrowed as a confirmation: one word and an accent mark,
     placed against whatever control was just used. Built from nodes rather than
     innerHTML — the word is the caller's and never touches the parser. */
  flashTip = (el, word, bang = '!') => {
    clearTimeout(flashing);
    tip.textContent = word;
    if (bang) {
      const mark = document.createElement('span');
      mark.className = 'tip-bang';
      mark.textContent = bang;
      tip.append(mark);
    }
    tip.classList.add('is-on', 'is-flash');
    // Measured after the text lands, exactly as show() does.
    place(el);
    flashing = setTimeout(() => {
      flashing = null;
      tip.classList.remove('is-on', 'is-flash');
      current = null;
    }, 1500);
  };

  const target = (e) => e.target.closest?.('[data-tip]');
  document.addEventListener('pointerover', (e) => { const el = target(e); if (el && el !== current) show(el); });
  document.addEventListener('pointerout', (e) => { if (target(e) === current && current) hide(); });
  document.addEventListener('focusin', (e) => { const el = target(e); if (el) show(el); });
  document.addEventListener('focusout', hide);
  // A tooltip that outlives what it labels is the classic stuck-tooltip bug.
  document.addEventListener('click', (e) => { if (target(e)) hide(); });
  window.addEventListener('scroll', () => { if (current) place(current); }, { passive: true });
  window.addEventListener('resize', hide);
})();

/* --- idea vault ----------------------------------------------------------- */
/* A locked section, locked by DECRYPTION rather than by a check.

   The usual version of this is a password compared against a string in the
   page, which is theatre: the string is right there, and even a hash of it only
   moves the answer one step away. Here the page ships nothing but ciphertext.
   The code you type is run through PBKDF2 to derive an AES-GCM key, and AES-GCM
   authenticates what it decrypts — so a wrong code does not fail a comparison,
   it fails to produce plaintext at all. There is no branch to flip in the
   debugger and no secret to read out of the source, because what is sealed is
   simply not in the document.

   What that buys is bounded, and worth saying out loud: five digits is a
   hundred thousand combinations, and someone who wants in can grind them
   offline against the blob. The iteration count is what makes that hours rather
   than seconds. It is the right lock for half-finished ideas and the wrong one
   for anything that would hurt to lose — tools/seal_vault.mjs will seal a
   passphrase just as happily, and only the input boxes here are numeric.

   Reseal with:  node tools/seal_vault.mjs --pin 12345 --text "…" */
(function initVault() {
  const section = document.getElementById('vault');
  if (!section) return;
  const pins = [...section.querySelectorAll('.vault-pin')];
  const lockbox = section.querySelector('.vault-lockbox');
  const status = document.getElementById('vaultStatus');
  const timer = document.getElementById('vaultTimer');
  const revealed = document.getElementById('vaultOpen');
  const label = document.getElementById('vaultLabel');
  const padlock = document.getElementById('vaultLock');
  if (!pins.length || !lockbox || !status || !revealed) return;

  const RESTING = 'ENTER CODE';
  const TRIES = 3;              // failures allowed...
  const WINDOW = 15000;         // ...within this
  const LOCKOUT = 15;           // seconds of waiting once they are spent
  const ANSWER_HOLD = 5000;     // how long NOPE stays before it fades out

  /* What a decrypted payload is allowed to ask for. "show:<name>" opens one of
     these; anything else is printed as text. The code does not name the door —
     the sealed text does — so a second code sealed against a different name
     opens a different thing and nothing here changes but this table. */
  const VIEWS = { snail: document.getElementById('snailModal') };

  /* Folded to upper case on the way in, and folded the same way by
     tools/seal_vault.mjs before it derives its key, so "snail" and "SNAIL" open
     the same door. The WHOLE string is folded rather than only its letters:
     digits and symbols come through unchanged, so one call covers every kind of
     code. */
  const code = () => pins.map(p => p.value).join('').toUpperCase();

  const say = (text, state) => {
    status.textContent = text;
    section.classList.toggle('is-wrong', state === 'wrong');
    section.classList.toggle('is-working', state === 'working');
    section.classList.toggle('is-open', state === 'open');
  };

  /* SubtleCrypto only exists in a secure context. Over https or on localhost
     that is everywhere; opened as a file:// double-click it is nowhere, and the
     honest thing is to say so rather than shake at someone typing the right
     code. */
  const canDecrypt = !!(window.crypto && window.crypto.subtle);
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---- scrypt (RFC 7914) --------------------------------------------------

     WHY NOT PBKDF2, which the browser has natively and this used to use: PBKDF2
     is pure arithmetic and needs almost no memory, which is exactly the shape a
     GPU is good at. A mid-range card runs PBKDF2-SHA256 by the millions per
     second, so raising the iteration count buys one bit per doubling and the
     attacker buys a second card.

     scrypt is memory-hard. Every guess has to allocate and randomly walk 32 MiB
     (N=2^15, r=8), and memory is the one thing a GPU cannot multiply cheaply: a
     24 GB card holds a few hundred concurrent guesses instead of tens of
     thousands. That is worth far more than any iteration count, and it is the
     single biggest thing that can be done for a vault whose ciphertext is
     public — which this one's is, and always will be, because it ships in a
     static page.

     Hand-rolled cryptography is normally a mistake, so this one is checked
     rather than trusted: it reproduces all three RFC 7914 test vectors, and it
     is byte-identical to node's native crypto.scryptSync on a spread of inputs
     including unicode and 200-character passphrases. The outer and inner PBKDF2
     passes the construction calls for are the browser's own, not mine.

     Little-endian is assumed, as scrypt's spec requires and as every engine
     this will ever run on is. */
  function salsa20_8(B) {
    const x = new Uint32Array(16);
    x.set(B);
    const R = (a, b) => (a << b) | (a >>> (32 - b));
    for (let i = 8; i > 0; i -= 2) {
      x[4] ^= R(x[0] + x[12], 7);    x[8] ^= R(x[4] + x[0], 9);
      x[12] ^= R(x[8] + x[4], 13);   x[0] ^= R(x[12] + x[8], 18);
      x[9] ^= R(x[5] + x[1], 7);     x[13] ^= R(x[9] + x[5], 9);
      x[1] ^= R(x[13] + x[9], 13);   x[5] ^= R(x[1] + x[13], 18);
      x[14] ^= R(x[10] + x[6], 7);   x[2] ^= R(x[14] + x[10], 9);
      x[6] ^= R(x[2] + x[14], 13);   x[10] ^= R(x[6] + x[2], 18);
      x[3] ^= R(x[15] + x[11], 7);   x[7] ^= R(x[3] + x[15], 9);
      x[11] ^= R(x[7] + x[3], 13);   x[15] ^= R(x[11] + x[7], 18);
      x[1] ^= R(x[0] + x[3], 7);     x[2] ^= R(x[1] + x[0], 9);
      x[3] ^= R(x[2] + x[1], 13);    x[0] ^= R(x[3] + x[2], 18);
      x[6] ^= R(x[5] + x[4], 7);     x[7] ^= R(x[6] + x[5], 9);
      x[4] ^= R(x[7] + x[6], 13);    x[5] ^= R(x[4] + x[7], 18);
      x[11] ^= R(x[10] + x[9], 7);   x[8] ^= R(x[11] + x[10], 9);
      x[9] ^= R(x[8] + x[11], 13);   x[10] ^= R(x[9] + x[8], 18);
      x[12] ^= R(x[15] + x[14], 7);  x[13] ^= R(x[12] + x[15], 9);
      x[14] ^= R(x[13] + x[12], 13); x[15] ^= R(x[14] + x[13], 18);
    }
    for (let i = 0; i < 16; i++) B[i] = (B[i] + x[i]) | 0;
  }

  function blockMix(B, Y, r) {
    const X = new Uint32Array(16);
    X.set(B.subarray((2 * r - 1) * 16, 2 * r * 16));
    for (let i = 0; i < 2 * r; i++) {
      for (let k = 0; k < 16; k++) X[k] ^= B[i * 16 + k];
      salsa20_8(X);
      // Even blocks to the front half, odd to the back — the shuffle is what
      // makes the next round's reads depend on this one's writes.
      Y.set(X, ((i % 2 === 0) ? i / 2 : r + (i - 1) / 2) * 16);
    }
    B.set(Y);
  }

  /* The memory-hard part: fill V with N blocks, then walk it N times at
     positions the data itself picks. An attacker who keeps less than the whole
     of V has to recompute the misses, which is the trade this is built on. */
  function roMix(B, N, r) {
    const V = new Uint32Array(32 * r * N);
    const Y = new Uint32Array(32 * r);
    for (let i = 0; i < N; i++) { V.set(B, i * 32 * r); blockMix(B, Y, r); }
    for (let i = 0; i < N; i++) {
      const jj = (B[(2 * r - 1) * 16] >>> 0) % N;
      for (let k = 0; k < 32 * r; k++) B[k] ^= V[jj * 32 * r + k];
      blockMix(B, Y, r);
    }
    V.fill(0);
  }

  async function pbkdf2Bits(pw, salt, iterations, bytes) {
    const key = await crypto.subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, bytes * 8));
  }

  async function scrypt(pw, salt, N, r, p, dkLen) {
    const B = await pbkdf2Bits(pw, salt, 1, p * 128 * r);
    const B32 = new Uint32Array(B.buffer, B.byteOffset, B.byteLength / 4);
    for (let i = 0; i < p; i++) roMix(B32.subarray(i * 32 * r, (i + 1) * 32 * r), N, r);
    const out = await pbkdf2Bits(pw, B, 1, dkLen);
    B.fill(0);
    return out;
  }

  async function unseal(blob, secret) {
    const [version, N, r, p, payload] = blob.split('.');
    if (version !== 'v2') throw new Error('unknown vault format');
    const raw = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
    // salt | iv | ciphertext+tag — the layout tools/seal_vault.mjs writes.
    const salt = raw.slice(0, 16), iv = raw.slice(16, 28), body = raw.slice(28);
    const bytes = await scrypt(new TextEncoder().encode(secret), salt,
                               Number(N), Number(r), Number(p), 32);
    const key = await crypto.subtle.importKey(
      'raw', bytes, { name: 'AES-GCM' }, false, ['decrypt']);
    // The raw key material is no use to anyone once the CryptoKey holds it, and
    // a buffer nobody wiped is a buffer that outlives the reason for it.
    bytes.fill(0);
    // Throws on a wrong key: the tag will not verify. That IS the check.
    return new TextDecoder().decode(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, body));
  }

  /* ---- what happens when it opens ---- */

  const viewOf = (payload) =>
    payload.startsWith('show:') ? VIEWS[payload.slice(5).trim()] : null;

  const show = (dialog, opener) =>
    openModal(dialog, dialog.querySelector('.vault-modal-shell'), null, opener);

  function reveal(payload) {
    if (label) label.textContent = 'OPEN';
    if (padlock) padlock.dataset.icon = 'lock-open';
    say('YEP!', 'open');
    // Getting in clears the slate: three old failures should not put someone
    // who has just proved they know the code one mistype from a lockout.
    fails.length = 0;

    const dialog = viewOf(payload);
    if (dialog) {
      /* The keypad stays exactly where it is. Closing the overlay relocks the
         section (see relock), so getting back in means typing the code again —
         a door that stands open for the rest of the visit is not a locked
         section, it is a section with a lock on the front of it. */
      show(dialog, pins[pins.length - 1]);
      return;
    }
    /* Not a door, or a door this build does not have: whatever was sealed, as
       text, in place of the keypad. Nothing to close, so this one stays open.
       textContent, never innerHTML — it is words however it was written. */
    lockbox.hidden = true;
    revealed.hidden = false;
    revealed.textContent = payload;
  }

  /* Put the section back the way it was found. Runs when the overlay closes,
     however it closed — the button, the X, Escape or the backdrop — because it
     hangs off the dialog's own close event rather than off any one of them. */
  function relock() {
    clearBoxes();
    if (label) label.textContent = 'CLASSIFIED';
    if (padlock) padlock.dataset.icon = 'lock';
    say(RESTING, null);
    // The overlay hands focus back to the box that opened it — the LAST one,
    // where typing does nothing useful. Move it to the front of the row.
    pins[0].focus({ preventScroll: true });
  }

  /* ---- getting it wrong ---- */

  const fails = [];             // timestamps inside the current window
  let lockedUntil = 0;
  let tickTimer = null;
  let fadeTimer = null;

  const clearBoxes = () =>
    pins.forEach(p => { p.value = ''; p.classList.remove('is-set'); });

  /* Scripted rather than a CSS keyframe: it has to restart on a number that is
     already on screen, and re-running a keyframe animation means taking a class
     off, forcing a reflow and putting it back. The reduced-motion check is
     explicit because the site's blanket `animation:none` rule does not reach
     the Web Animations API. */
  function pop(el) {
    if (REDUCED.matches || !el.animate) return;
    el.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }],
               { duration: 900, easing: 'cubic-bezier(.22,.61,.36,1)' });
  }

  function fadeAnswer() {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      status.removeEventListener('transitionend', onEnd);
      clearTimeout(guard);
      say(RESTING, null);
      status.classList.remove('is-fading');
    };
    const onEnd = (event) => { if (event.propertyName === 'opacity') finish(); };
    status.addEventListener('transitionend', onEnd);
    // A transition that never runs — a backgrounded tab will skip it — would
    // otherwise leave the answer up for good, which is the thing this fixes.
    const guard = setTimeout(finish, 900);
    status.classList.add('is-fading');
  }

  /* The refusal clears the moment they start over, rather than sitting under a
     half-typed second attempt still saying NOPE about the first one. */
  const clearFail = () => {
    if (!section.classList.contains('is-wrong') || lockedUntil) return;
    clearTimeout(fadeTimer);
    status.classList.remove('is-fading');
    say(RESTING, null);
  };

  /* Three wrong codes inside fifteen seconds and the boxes stop listening for
     fifteen. It is a doorknob, not a vault door: a five-character code is small
     enough to sweep by hand, and this makes hammering it boring without ever
     locking out someone who mistyped twice. */
  function beginLockout() {
    lockedUntil = Date.now() + LOCKOUT * 1000;
    clearTimeout(fadeTimer);
    status.classList.remove('is-fading');
    say('TOO MANY TRIES', 'wrong');
    pins.forEach(p => { p.disabled = true; });
    timer.hidden = false;
    tick();
  }

  function tick() {
    const remain = lockedUntil - Date.now();
    const left = Math.ceil(remain / 1000);
    if (left <= 0) { endLockout(); return; }
    timer.textContent = left;
    pop(timer);
    /* Aim at the next whole second rather than 1000ms from now. A fixed
       interval drifts against the clock it is reading and eventually shows the
       same number twice, or skips one. */
    tickTimer = setTimeout(tick, remain - (left - 1) * 1000);
  }

  function endLockout() {
    clearTimeout(tickTimer);
    lockedUntil = 0;
    timer.hidden = true;
    pins.forEach(p => { p.disabled = false; });
    say(RESTING, null);
    // preventScroll: the wait is over whether or not they are still looking at
    // it, and yanking the page back to a section they scrolled away from is not
    // the reminder it sounds like.
    pins[0].focus({ preventScroll: true });
  }

  function fail() {
    clearBoxes();
    /* Off on animationend rather than on a timer that would have to be kept in
       step with the CSS — and off at all because a class already set does not
       replay its animation, so a second wrong code would sit there still. */
    section.classList.add('is-shaking');
    section.addEventListener('animationend',
                             () => section.classList.remove('is-shaking'), { once: true });

    const now = Date.now();
    while (fails.length && now - fails[0] > WINDOW) fails.shift();
    fails.push(now);
    if (fails.length >= TRIES) { fails.length = 0; beginLockout(); return; }

    say('NOPE', 'wrong');
    pins[0].focus({ preventScroll: true });
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(fadeAnswer, ANSWER_HOLD);
  }

  /* ---- the attempt ---- */

  let busy = false;
  async function attempt() {
    const secret = code();
    if (busy || lockedUntil || secret.length !== pins.length) return;
    const blobs = (section.dataset.vault || '').trim().split(/\s+/).filter(Boolean);
    if (!blobs.length) { say('EMPTY', 'wrong'); return; }
    if (!canDecrypt) { say('NEEDS HTTPS', 'wrong'); return; }

    /* Deriving the key is deliberately slow — that is the whole defence — so it
       has to be visible, or a phone taking half a second looks like a dead
       control. The boxes lock while it runs so a second attempt cannot overlap
       the first. */
    busy = true;
    pins.forEach(p => { p.disabled = true; });
    say('CHECKING', 'working');
    /* scrypt runs on this thread and holds it for a few hundred milliseconds.
       Yield one frame first or CHECKING never gets painted and the boxes just
       freeze — the label would arrive at the same moment as the answer. */
    await new Promise(requestAnimationFrame);

    /* Every blob is tried, because each is a different code opening a different
       thing and only its own key can read it. One derivation each, so this is a
       handful of hundred-millisecond steps — fine for a short list, and the
       reason to keep the list short. */
    let payload = null;
    for (const blob of blobs) {
      try { payload = await unseal(blob, secret); break; } catch { /* not this one */ }
    }

    busy = false;
    pins.forEach(p => { p.disabled = false; });
    if (payload !== null) reveal(payload);
    else fail();
  }

  /* ---- the keypad ---- */

  pins.forEach((pin, i) => {
    pin.addEventListener('input', () => {
      clearFail();
      /* Keep the last character typed, so typing over a filled box replaces it
         rather than being swallowed by maxlength. Anything printable counts —
         letters, digits, symbols — and it lands in caps whatever was pressed.
         Whitespace is dropped: an invisible character in a code you can see is
         a way to be locked out of your own vault. */
      const typed = pin.value.replace(/\s/g, '');
      pin.value = typed.slice(-1).toUpperCase();
      pin.classList.toggle('is-set', !!pin.value);
      if (pin.value && i < pins.length - 1) pins[i + 1].focus();
      // No submit button: filling the last box IS the submit. Deferred a frame
      // so the character is painted before the boxes lock.
      if (code().length === pins.length) requestAnimationFrame(attempt);
    });
    pin.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' && !pin.value && i > 0) {
        // Backspace in an empty box steps back and clears, which is what every
        // code field does and what the finger expects.
        event.preventDefault();
        pins[i - 1].value = '';
        pins[i - 1].classList.remove('is-set');
        pins[i - 1].focus();
      } else if (event.key === 'ArrowLeft' && i > 0) {
        event.preventDefault(); pins[i - 1].focus();
      } else if (event.key === 'ArrowRight' && i < pins.length - 1) {
        event.preventDefault(); pins[i + 1].focus();
      } else if (event.key === 'Enter') {
        event.preventDefault(); attempt();
      }
    });
    // Pasting a code should fill the row, not drop five characters into one box.
    pin.addEventListener('paste', (event) => {
      const chars = (event.clipboardData || window.clipboardData)
        .getData('text').replace(/\s/g, '').toUpperCase();
      if (!chars) return;
      event.preventDefault();
      clearFail();
      pins.slice(i).forEach((box, n) => {
        if (n >= chars.length) return;
        box.value = chars[n];
        box.classList.add('is-set');
      });
      const next = Math.min(i + chars.length, pins.length - 1);
      pins[next].focus();
      if (code().length === pins.length) requestAnimationFrame(attempt);
    });
    // A click anywhere in the row lands on the first empty box, so you cannot
    // start typing in the middle of a code by accident.
    pin.addEventListener('focus', () => {
      const firstEmpty = pins.find(box => !box.value);
      if (firstEmpty && pins.indexOf(firstEmpty) < i) firstEmpty.focus();
      else pin.select();
    });
  });

  /* Every view is a <dialog> on the site's shared plumbing, so Escape, the
     backdrop, the scroll lock and the focus return are the one implementation
     rather than a second one living in here. */
  for (const dialog of Object.values(VIEWS)) {
    if (dialog) bindModal(dialog, relock);
  }
  document.getElementById('snailClose')?.addEventListener('click',
    () => closeModal(VIEWS.snail));
  document.getElementById('snailOk')?.addEventListener('click',
    () => closeModal(VIEWS.snail));
})();

/* --- social links --------------------------------------------------------- */
/* Two jobs over the same five icons.

   ONE - THE STATUS BUBBLE. Every browser prints the href of whatever link is
   under the pointer in the bottom-left corner of the window. It is browser
   chrome: no page can style it, move it, or turn it off, and a raw Discord
   invite URL sliding across the bottom of a designed page is not a decision
   anyone made. The only thing that stops it is the hovered element not having
   an href, so the URL is taken off here and the navigation is done below. It is
   the same argument that made the wallpaper download a button rather than a
   link. Moving the href in JS rather than shipping markup without one is what
   keeps these real links to a crawler and working with JS off.

   TWO - THE HANDLE. Hovering a social puts that site's handle in the row under
   the icons, and the whole row is one button that copies it. Someone who wants
   to add Dex on Discord needs the tag, not the invite page, and the tag appears
   nowhere else on the site. It holds for fifteen seconds after the pointer
   leaves the icon: reading a handle, crossing to it and clicking it is a longer
   trip than a hover state normally survives, and the row sits BELOW the thing
   you were pointing at, so the pointer has to leave to reach it.

   Which handle belongs to which site is data-tag in the markup, next to the
   link it describes. A link without one reads "No tag" and the row will not
   copy it. Not the previous handle, which would name the wrong service; and
   not an empty row, which reads as something failing to load rather than as an
   answer. It is a real state, for a service with no @mention to give. */
(function initSocialLinks() {
  const row = document.querySelector('.social-mini');
  if (!row) return;
  const links = [...row.querySelectorAll('a')];
  if (!links.length) return;

  /* The attribute is REMOVED, not hidden behind a data- name it also answers
     to: an <a href> is what the browser reads at hover time, and anything that
     leaves one in place leaves the bubble in place. */
  for (const a of links) {
    const url = a.getAttribute('href');
    a.removeAttribute('href');
    // Nothing to act on without an href; window.open below carries the new tab.
    a.removeAttribute('target');
    // The '#' placeholders went nowhere and now do nothing, rather than
    // scrolling the page to the top on a click that looked like a profile link.
    if (url && url !== '#') a.dataset.href = url;
    // An <a> without an href is neither a link nor focusable. Say both.
    a.setAttribute('role', 'link');
    a.tabIndex = 0;
  }

  // noopener: the profile tab gets no handle back on this window.
  const open = (a) => { if (a.dataset.href) window.open(a.dataset.href, '_blank', 'noopener'); };

  row.addEventListener('click', (e) => { const a = e.target.closest('a'); if (a) open(a); });
  /* Middle-click meant "open in a new tab" on these before, and an element with
     no href gives the browser nothing to do with it. Same destination, since
     these open in a new tab either way. */
  row.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    open(a);
  });
  /* Enter only. Space on a role="link" is not an activation - it scrolls the
     page - and taking it would break scrolling for anyone who tabbed here. */
  row.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    open(a);
  });

  /* --- the handle row --- */
  const btn = document.getElementById('socialTag');
  const text = document.getElementById('socialTagText');
  if (!btn || !text) return;

  const HOLD = 15000;                  // per Dex: fifteen seconds after the last hover
  let timer = null;
  let held = false;                    // the pointer or focus is on the row itself

  /* The state lives on the WRAPPER, not the button: it is the wrapper that has
     a height to animate, and the panel above it slides down as that height
     arrives. See the CSS. */
  const wrap = btn.parentElement;
  const clear = () => { clearTimeout(timer); wrap.classList.remove('is-on'); };
  /* Restarted rather than resumed, everywhere: whatever the visitor just did
     with this row is the moment the fifteen seconds should count from. */
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (!held) clear(); }, HOLD);
  };

  const NO_TAG = 'No tag';

  const show = (a) => {
    const tag = a.dataset.tag || '';
    text.textContent = tag || NO_TAG;
    // The button reads its own dataset on click, so an empty one IS the "do not
    // copy" state — there is no second flag that could disagree with the label.
    btn.dataset.tag = tag;
    btn.classList.toggle('is-untagged', !tag);
    // A handle and a glyph, so the outcome has to reach a screen reader through
    // the button's name. With nothing to copy it stops claiming to be a button
    // that does something.
    btn.setAttribute('aria-label', tag ? `Copy ${tag} to the clipboard`
                                       : 'This link has no handle to copy');
    btn.setAttribute('aria-disabled', String(!tag));
    wrap.classList.add('is-on');
    arm();
  };

  for (const a of links) {
    a.addEventListener('pointerenter', () => show(a));
    // Follows focus as well as the pointer, the same way the tooltip does.
    a.addEventListener('focus', () => show(a));
  }

  // Nothing times out while it is being pointed at or is holding focus - a row
  // that vanished under the cursor mid-click would be the whole feature failing.
  btn.addEventListener('pointerenter', () => { held = true; clearTimeout(timer); });
  btn.addEventListener('pointerleave', () => { held = false; arm(); });
  btn.addEventListener('focus', () => { held = true; clearTimeout(timer); });
  btn.addEventListener('blur', () => { held = false; arm(); });

  btn.addEventListener('click', async () => {
    const tag = btn.dataset.tag;
    if (!tag) return;
    const ok = await copyText(tag);
    flashTip(btn, ok ? 'Copied' : 'Copy failed', ok ? '!' : '');
    // The reason to copy a handle is to paste it somewhere else, and they may
    // well come back for it. Start the fifteen seconds again.
    arm();
  });

})();

/* --- AI wallpapers -------------------------------------------------------- */
/* One carousel, driven entirely off the .wp-item figures in the markup.
   Nothing here knows how many wallpapers there are or what they are called:
   the titles, the strip and the download targets all come from the DOM, so
   adding a piece is one <figure> and no JS edit. That is the same contract the
   Stickland gallery uses, for the same reason — a hand-kept count goes stale
   the first time someone adds art.

   The overlay is not a second component. It shows the SAME index through the
   same select(), with its own plate, download and strip, so walking the set at
   full size and walking it in the panel can never disagree. */
/* ONE carousel, TWO instances: Wallpapers and Concepts. They are the same
   component down to the class names — a stage, a plate on the art, a download,
   a grid of thumbnails in the statement column and a lightbox — and the only
   thing that differs between them is the shape of the frame, which is CSS.

   So the ids became a prefix, and the arrows are looked up inside this
   instance's own root and its own dialog. Both were `document` lookups while
   there was only one of these, and both are exactly what a second instance
   cannot share: `document.querySelectorAll('.wp-prev')` would have wired the
   concepts arrows to the wallpapers' index as well as their own.

     id      the id prefix — 'wp' or 'cn'; every element is `${id}Frame` &c
     root    the carousel's own container id
     panel   the tab panel it belongs to, watched so the detached strip in the
             statement column follows it */
function initGallery({ id, root: rootId, panel: panelId }) {
  const root = document.getElementById(rootId);
  if (!root) return;
  const items = [...root.querySelectorAll('.wp-item')];
  if (!items.length) return;

  const el = (suffix) => document.getElementById(id + suffix);
  const frame = el('Frame');
  const plate = el('Plate');
  const modal = el('Modal');
  const full = el('Full');
  const fullPlate = el('FullPlate');
  const views = [
    { host: frame, title: el('Title'), dims: el('Dims'),
      dl: el('Download'), strip: el('Thumbs'), sizes: null },
    /* The overlay's `sizes` is rewritten to 90vw on its copy: the panel's value
       describes an ~856px card, and left alone the browser would reuse that
       choice and upscale a 900px file across most of the screen. This is the
       whole reason the ladder carries a 2560. */
    /* deferred: this view is NOT painted with the other one. Its `sizes` is
       90vw, so painting it at load picked the 1920 rung and fetched 167 KB of
       lightbox on every visit to the site — for an overlay nobody had opened,
       in a dialog that was not on screen. It is painted when it opens. */
    { host: full, title: el('FullTitle'), dims: el('FullDims'),
      dl: el('FullDl'), strip: el('FullThumbs'), sizes: '90vw',
      deferred: true },
  ];
  let index = 0;

  // Resolution comes from the img's width/height ATTRIBUTES, which the baker
  // writes from the master — not from naturalWidth, which would report whatever
  // derivative the browser happened to pick and print "900 x 563".
  const dimsOf = (item) => {
    const img = item.querySelector('img');
    return `${img.getAttribute('width')} × ${img.getAttribute('height')}`;
  };
  // Built from the attributes, not from the display string: turning
  // "2560 × 1600" back into "2560x1600" by substitution produced 2560xx1600,
  // because the multiplication sign has a space on each side.
  /* The extension comes off data-file rather than being typed: every master
     so far is a PNG, and a JPG concept saved as "concept-04-1600x1200.png"
     would be a file the OS opens wrong. */
  const fileName = (item) => {
    const img = item.querySelector('img');
    const ext = (item.dataset.file.match(/\.([a-z0-9]+)$/i) || [, 'png'])[1];
    return item.dataset.title.replace(/\s+/g, '-').toLowerCase()
      + `-${img.getAttribute('width')}x${img.getAttribute('height')}.${ext}`;
  };

  /* Thumbnails reuse the SAME <picture> the carousel does, cloned and given a
     small `sizes` so the browser picks the 600 rather than the 2560. Building
     them from a separate baked slot would double the derivative count for
     images that render 78px wide. */
  /* One row, always. The strip is a window and the thumbnails live on a track
     inside it, so a set too long to fit slides rather than wrapping — a second
     row of small thumbnails under the first is exactly what this is not. */
  views.forEach((view) => {
    view.track = document.createElement('div');
    view.track.className = 'wp-track';
    view.strip.appendChild(view.track);
    items.forEach((item, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wp-thumb';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-label', item.dataset.title);
      const pic = item.querySelector('picture').cloneNode(true);
      /* The real rendered width, not a round number: 190px is the widest a cell
         in the 3x3 gets (560px block / 3), and 30vw is what it is once the strip
         stacks. Under-describing it here is what made every thumbnail fetch the
         600 rung — `sizes` is the whole reason the ladder exists. */
      pic.querySelectorAll('source').forEach(
        sc => sc.setAttribute('sizes', '(max-width:1100px) 30vw, 190px'));
      const img = pic.querySelector('img');
      img.removeAttribute('class');
      img.loading = 'lazy';
      btn.appendChild(pic);
      // In the panel a thumbnail opens the piece full size; in the overlay it
      // just switches, because you are already looking at it full size.
      btn.addEventListener('click', () => {
        select(i);
        if (!modal.open) openFull();
      });
      /* Hovering a thumbnail shows that piece in the hero without selecting
         it — the fastest way to look through a set is to sweep the strip, and
         a click for every look is a click too many. The selection marker stays
         where it was (paint() reads `index`, not the hovered item), so leaving
         the strip puts back exactly what was there.

         The download follows what is on screen rather than what is selected,
         which is the only version that cannot lie: the button sits inside the
         frame, so reaching it leaves the thumbnail and restores the selection
         first. */
      btn.addEventListener('pointerenter', () => paint(view, item));
      btn.addEventListener('pointerleave', () => paint(view, items[index]));
      btn.addEventListener('focus', () => paint(view, item));
      btn.addEventListener('blur', () => paint(view, items[index]));
      view.track.appendChild(btn);
    });
    view.thumbs = [...view.track.children];
  });

  /* The grid used to be padded out to nine with dashed empty cells so it held
     a rectangle. It no longer is: while the set is this small the placeholders
     read as work that is missing rather than as room for more, and each new
     wallpaper closed one of them, which made the block look like a checklist.
     Three columns, growing a row at a time as art lands — the last row is short
     until it is not. Paging goes in here when there is enough art to need it. */

  /* A page of thumbnails is five at most, fewer when five would not be legible
     at the width available. Past that the set does not wrap — the track slides
     the next page in, and the page follows whatever is selected, so walking the
     set with the arrows carries the strip along without a control of its own.

     The shift is measured in pixels from a real thumbnail rather than assumed
     to be 100% of the strip: the thumbnails are capped at their designed size,
     so a page can be narrower than the window it sits in, and a percentage
     would drift by that slack on every page. */
  const PAGE_MAX = 5;                      // five across, per Dex
  const THUMB_MIN = 70;                    // below this a thumbnail stops reading
  function layoutStrip(view) {
    const strip = view.strip, track = view.track;
    /* None of this is the grid's. --per-page, the measured pixel shift and the
       centring all describe one sliding row; the grid is three across and as
       many rows as it takes, and has no pages until there are enough pieces to
       need them. */
    if (strip.classList.contains('wp-thumbs-grid')) return;
    const kids = track.children.length;
    if (!kids) return;
    const width = strip.clientWidth;
    if (!width) return;                    // hidden tab: nothing to measure yet
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    const fit = Math.max(1, Math.floor((width + gap) / (THUMB_MIN + gap)));
    const perPage = Math.min(PAGE_MAX, fit, kids);
    strip.style.setProperty('--per-page', perPage);
    view.perPage = perPage;
    view.pages = Math.ceil(kids / perPage);
    // Centred while it all fits; left-aligned once it pages, or the pages would
    // each sit at a different offset.
    strip.classList.toggle('is-paged', view.pages > 1);
    const thumb = track.firstElementChild.getBoundingClientRect().width;
    strip.style.setProperty('--shift', `${perPage * (thumb + gap)}px`);
    showPage(view, Math.floor(index / perPage));
  }
  function showPage(view, page) {
    const clamped = Math.max(0, Math.min(page, (view.pages || 1) - 1));
    view.page = clamped;
    view.strip.style.setProperty('--page', clamped);
  }
  const layoutStrips = () => views.forEach(layoutStrip);
  window.addEventListener('resize', layoutStrips);
  // The panel starts hidden, so the first measurable moment is when its tab is
  // opened — which is exactly when the strip first has a width.
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => layoutStrips());
    views.forEach(v => ro.observe(v.strip));
  } else layoutStrips();

  /* Hover is only instant if the file is already there, and the hero rung is
     not the thumbnail rung — so the pieces are fetched at hero size once the
     tab is actually opened. Cloning the real <picture> rather than building an
     Image() keeps the format and rung choice the browser's, which is the whole
     point of having baked a ladder. Hidden panels never intersect, so this
     fires exactly once, when someone first looks at the tab. */
  /* Five hero-sized images, so a hover swap is instant. They are speculative,
     and speculative work must never be in front of the work someone is waiting
     for: fetchpriority="low" puts them behind the thumbnails and the piece on
     screen in the browser's own queue, and one idle callback each keeps them
     from all starting in the same frame. Before this they went out at the same
     priority as everything else and the strip filled in behind them. */
  function preloadHeroes() {
    const host = document.createElement('div');
    host.className = 'wp-preload';
    host.setAttribute('aria-hidden', 'true');
    root.appendChild(host);
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 120));
    items.forEach((item, n) => {
      // The piece already on screen is not speculative and is already fetched.
      if (n === index) return;
      idle(() => {
        const pic = item.querySelector('picture').cloneNode(true);
        const img = pic.querySelector('img');
        img.removeAttribute('loading');
        img.removeAttribute('class');
        img.setAttribute('fetchpriority', 'low');
        host.appendChild(pic);
      }, { timeout: 2500 });
    });
  }
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) { io.disconnect(); preloadHeroes(); }
    });
    io.observe(root);
  } else preloadHeroes();

  function paint(view, item) {
    // The plate and the download live inside the frame, so replacing the
    // picture cannot go through textContent = '' — that would take them with
    // it. Swap only the <picture> and leave the furniture alone.
    view.host.querySelector('picture')?.remove();
    const pic = item.querySelector('picture').cloneNode(true);
    if (view.sizes) {
      pic.querySelectorAll('source').forEach(sc => sc.setAttribute('sizes', view.sizes));
      const img = pic.querySelector('img');
      img.removeAttribute('loading');
    }
    pic.querySelector('img').removeAttribute('class');
    if (view.host === frame) pic.querySelector('img').className = 'wp-img';
    view.host.insertBefore(pic, view.host.firstChild);
    view.title.textContent = item.dataset.title;
    view.dims.textContent = dimsOf(item);
    // The button carries what to fetch and what to call it; no href, so the
    // browser never shows its status bubble for this control.
    view.dl.dataset.file = item.dataset.file;
    view.dl.dataset.name = fileName(item);
    view.thumbs.forEach((b, n) => b.setAttribute('aria-selected', String(n === index)));
  }

  function select(i) {
    index = (i + items.length) % items.length;
    const item = items[index];
    views.forEach((view) => {
      // A deferred view is painted by whatever opens it, and kept up to date
      // only while it is up. Walking the set with the overlay closed must not
      // fetch a full-screen image per arrow press.
      if (!view.deferred || modal.open) paint(view, item);
      if (view.perPage) showPage(view, Math.floor(index / view.perPage));
    });
  }

  function openFull() {
    // Paint first, so the overlay has its picture before it is shown rather
    // than filling in a frame later.
    paint(views[1], items[index]);
    openModal(modal, full, null, views[0].thumbs[index]);
  }

  // The master, saved through the shared blob helper — see saveFile().
  views.forEach(v => v.dl.addEventListener('click', () => saveFile(v.dl)));

  // Both stages drive the same index, so the panel and the overlay walk
  // together and neither needs to know the other exists.
  const arrows = (sel) => [...root.querySelectorAll(sel), ...modal.querySelectorAll(sel)];
  arrows('.wp-prev, .wp-fullprev').forEach(b => b.addEventListener('click', () => select(index - 1)));
  arrows('.wp-next, .wp-fullnext').forEach(b => b.addEventListener('click', () => select(index + 1)));
  // The frame opens the overlay, but not when the click was the download link
  // sitting on top of it.
  frame.addEventListener('click', (event) => {
    if (event.target.closest('.wp-dl')) return;
    openFull();
  });
  el('Close').addEventListener('click', () => closeModal(modal));
  bindModal(modal);

  // Arrows walk the set while the overlay is up.
  modal.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    select(index + (event.key === 'ArrowRight' ? 1 : -1));
  });

  /* The panel's strip no longer lives in the panel — it sits in the statement
     column, which is outside every tab panel and therefore on screen whatever
     tab is open. That is the trap .app-info already fell into, so this is the
     same fix: watch the Wallpapers panel's own `hidden` attribute rather than a
     click on its tab, because initTabs owns that attribute and an observer on
     the thing itself cannot fall out of step with however the panel comes to be
     shown. Strips inside the panel or inside the overlay are left alone — they
     are already hidden with whatever contains them. */
  const panel = document.getElementById(panelId);
  const detached = views.map(v => v.strip)
    .filter(strip => panel && strip.closest('#ai') && !panel.contains(strip));
  if (detached.length) {
    const syncStrips = () => detached.forEach(strip => { strip.hidden = panel.hidden; });
    new MutationObserver(syncStrips)
      .observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    syncStrips();
  }

  select(0);
}

initGallery({ id: 'wp', root: 'wallpapers', panel: 'ai-panel-images' });
/* The concepts are PLACEHOLDERS today — nine generated cards that say so on
   their own face. Nothing here knows that, and nothing here should: the tab is
   the wallpapers' component over a second set of figures, and swapping the art
   in is a master and a directive with no JS to touch. */
initGallery({ id: 'cn', root: 'concepts', panel: 'ai-panel-concepts' });

/* --- shared media transport ------------------------------------------------ */
/* Two things on this page make sound — the clips player in the AI Lab and the
   songs bar — and neither knows the other exists. This is the only place that
   arbitrates between them, so "they must not both play" and "who owns the space
   bar" are one readable list here instead of two halves that drift apart.

   What registers is a small object, NOT the media element. Every question worth
   asking is about the UI around the element — is its panel the open tab, is its
   frame still on screen — and an <audio> cannot answer any of them. */
const MediaBus = (() => {
  const players = [];

  /* A player left running in a background tab is audio coming from nowhere, and
     nobody can find the tab it is coming from. So a player stops the moment the
     document is hidden — unless it declares `keepPlayingHidden`.

     Nothing resumes on the way back, deliberately. A page that starts talking
     the instant you return to it is the same ambush pointing the other way, and
     the player is right there — pressing play is one click or one space bar.

     THE SONGS BAR IS THE EXEMPTION (Dex, 2026-08-21), and it is the one case
     the rule above got wrong: someone who put a track on wants the track, and
     switching to another window or tab to do something else while it plays is
     the ordinary way music gets listened to. Cutting it there is not protecting
     them from anything — they know exactly where it is coming from, because
     they started it. The rule still holds for the clips player and the toy,
     where the sound is a side effect of looking at something and stops making
     sense the moment you look away.

     It lives in MediaBus rather than in the players because it is a rule about
     media on this page; a fourth player that registers with the bus gets the
     default without having to remember it. */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    for (const p of players) if (!p.keepPlayingHidden && !p.el.paused) p.pause();
  });

  return {
    add(p) { players.push(p); return p; },

    /* Whoever starts playing silences the rest. Wired to the `play` EVENT rather
       than to the buttons: a click on a card, a click on the bar, the space bar
       and a track ending and rolling to the next are four call sites and one
       event, and an event cannot be forgotten by whoever adds the fifth. */
    solo(who) { for (const p of players) if (p !== who && !p.el.paused) p.pause(); },

    /* Who owns the space bar right now, or null for "nobody — let it scroll".
       A player must be on screen to be in the running at all. Of those, one that
       is actually playing beats one that is merely open; if neither is playing
       the first registered wins, which is the clips player — it is on screen
       only when its tab is the open one AND its frame is in view, so it is the
       stronger evidence of what someone is actually looking at. */
    claimant() {
      /* A modal covers the page. Whatever is behind it is not what the space bar
         is addressing — the overlay's own scrolling is. */
      if (document.querySelector('dialog[open]')) return null;
      const live = players.filter(p => p.onScreen());
      return live.find(p => !p.el.paused) || live.find(p => p.touched()) || null;
    },
  };
})();

/* --- AI clips ------------------------------------------------------------- */
/* Same carousel as the wallpapers, with a player where the download was.
   Sources are remote (bunny.net) and the posters are the only local asset, so
   this deliberately never assumes a clip can load: the poster is always shown,
   the video fades in over it once it has frames, and a source that cannot play
   says so instead of leaving a spinner.

   A figure with no data-src is a slot nobody has connected yet — see
   assets/ai/clips/README.md. `playable()` is the one place that knows the
   difference, so wiring a real URL needs no other change here. */
(function initClips() {
  const root = document.getElementById('clips');
  if (!root) return;
  const items = [...root.querySelectorAll('.cl-item')];
  if (!items.length) return;

  const $ = id => document.getElementById(id);
  const frame = $('clFrame'), video = $('clVideo'), note = $('clNote');
  const title = $('clTitle'), meta = $('clMeta'), strip = $('clThumbs');
  const toggle = $('clToggle'), big = $('clBig'), loopBtn = $('clLoop');
  const scrub = $('clScrub'), vol = $('clVol'), muteBtn = $('clMute');
  const elapsed = $('clElapsed'), duration = $('clDuration');
  let index = 0, loop = false, scrubbing = false, lastVolume = 0.4;
  // Whether anyone has ever started this player. The space bar will not claim
  // a player nobody has touched — see MediaBus and initSpaceTransport.
  let touched = false;

  // 40% by default, matching the songs bar — loud enough to hear, quiet enough
  // that an autoplaying tab is not an event.
  video.volume = 0.4;
  vol.value = 40;

  const mmss = t => Number.isFinite(t) && t >= 0
    ? Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') : '--:--';
  const setFill = (el, pct) => el.style.setProperty('--fill', pct + '%');
  const icon = (btn, name) => { const i = btn.querySelector('.icon'); if (i) i.setAttribute('data-icon', name); };
  // A placeholder is a figure that carries a poster but no source yet.
  const playable = (item) => !!item.dataset.src;

  items.forEach((item, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wp-thumb';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-label', item.dataset.title);
    /* :scope >, not a bare 'picture': a figure now also carries the origin
       chain's source images, nested one level down. The poster is the direct
       child, and saying so is cheaper than relying on it coming first. */
    const pic = item.querySelector(':scope > picture').cloneNode(true);
    pic.querySelectorAll('source').forEach(s => s.setAttribute('sizes', '180px'));
    const img = pic.querySelector('img');
    img.removeAttribute('class');
    img.loading = 'lazy';
    btn.appendChild(pic);
    btn.addEventListener('click', () => select(i, isPlaying()));
    strip.appendChild(btn);
  });
  const thumbs = [...strip.children];

  /* Is a clip RUNNING right now — not merely loaded, and not merely unpaused.
     is-live is what separates a source that has actually started from one that
     is sitting behind its poster, and `ended` is a clip that ran to the end and
     stopped, which is not the same as one somebody paused. Shared by the paint
     below and by the step handlers, which carry this state to the next clip. */
  const isPlaying = () => !video.paused && !video.ended && frame.classList.contains('is-live');

  function paintButtons() {
    const playing = isPlaying();
    icon(toggle, playing ? 'pause' : 'play');
    toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    /* The big control is the whole video surface and stays operable while the
       clip runs, so its name has to follow the state — its disc is hidden by
       then, and a button announcing "Play clip" while pausing is a lie to
       anyone who cannot see it. */
    big.setAttribute('aria-label', playing ? 'Pause clip' : 'Play clip');
  }

  /* --- where the clip came from -------------------------------------------
     Every clip here was generated FROM something, and the walk from that
     something to the clip is the interesting half of it. The block lives in the
     statement column, which is OUTSIDE every tab panel and therefore on screen
     whatever tab is open — the trap .app-info and #wpThumbs both fell into, and
     this is their fix: watch the Clips panel's own `hidden`, because initTabs
     owns that attribute and an observer on the panel cannot fall out of step
     with however the panel comes to be shown.

     Nothing in here is typed twice. The sources are the .cl-step figures inside
     the .cl-item, in order; the last link is the clip's own poster, cloned, so
     a chain that ends in a picture of the clip cannot go stale against it; the
     copy is data-origin. A clip with no steps is copy alone (King Kong), and
     one with no copy at all hides the block. */
  const origin = document.getElementById('clOrigin');
  const videosPanel = document.getElementById('ai-panel-videos');
  let originFilled = false;
  const syncOrigin = () => {
    if (origin) origin.hidden = !originFilled || !!videosPanel?.hidden;
  };

  /* A CONVEYOR (Dex, 2026-08-25 — fifth pass, and the simplest of the five).
     One plain arrow, drawn TWICE, each copy gliding left to right while it
     fades up and back out. The second runs half a cycle behind the first, so
     there is always one arrow on screen and it always appears to be travelling
     — the motion IS the arrow moving, rather than something happening to a
     shape that stands still.

     Nothing is dashed, nothing is drawn on, and there is no second static copy
     underneath. Four earlier versions all animated a treatment ON an arrow; this
     one animates the arrow. The two copies are identical markup and differ only
     by an animation-delay in the CSS. */
  /* The viewBox is 60 wide for a glyph that spans about 32 of it. That margin
     is the TRAVEL: an <svg> clips at its own edge, so at a 44-wide box the
     glyph hit the wall while still partly visible and the two copies had to
     move so little that they simply overlapped and read as one doubled arrow
     rather than one arrow going somewhere. */
  const GLYPH = '<g class="cl-arrow-glyph">'
    + '<path d="M14 12H37" stroke-width="4.6" stroke-linecap="round"/>'
    + '<path d="M35 6l7 6-7 6" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>'
    + '</g>';
  const ARROW = '<svg viewBox="0 0 60 24" fill="none" aria-hidden="true" focusable="false">'
    + GLYPH + GLYPH + '</svg>';
  const arrowNode = () => {
    const span = document.createElement('span');
    span.className = 'cl-arrow';
    span.innerHTML = ARROW;                 // a constant; nothing interpolated
    return span;
  };

  /* flex-grow IS the aspect ratio, which is what justifies the row: the free
     width is shared in proportion to w/h, so every image ends up the same
     HEIGHT while keeping its own shape and its own edges. Read off the baker's
     width/height ATTRIBUTES, not naturalWidth — the attributes describe the
     MASTER, where naturalWidth describes whichever rung the browser picked and
     would answer differently on a phone. */
  const stepNode = (pic, label, { isClip = false, bare = false } = {}) => {
    const fig = document.createElement('figure');
    fig.className = isClip ? 'cl-step cl-step-clip' : 'cl-step';
    if (bare) fig.setAttribute('data-bare', '');
    const img = pic.querySelector('img');
    img.className = 'cl-step-img';
    img.loading = 'lazy';
    const w = Number(img.getAttribute('width')), h = Number(img.getAttribute('height'));
    fig.style.flexGrow = String(w > 0 && h > 0 ? w / h : 1);
    fig.appendChild(pic);
    const cap = document.createElement('figcaption');
    cap.textContent = label;
    fig.appendChild(cap);
    return fig;
  };

  function paintOrigin(item) {
    if (!origin) return;
    const copy = item.dataset.origin || '';
    origin.textContent = '';
    originFilled = !!copy;
    if (!originFilled) { syncOrigin(); return; }

    const eyebrow = document.createElement('p');
    eyebrow.className = 'cl-origin-eyebrow';
    eyebrow.textContent = 'How it was made';
    origin.appendChild(eyebrow);

    /* THE CLIP IS NOT AUTOMATICALLY THE LAST LINK (Dex, 2026-08-25). Most of
       these chains are about the artwork that went IN — the clip is the thing
       on screen two inches to the right, and repeating it stole width from the
       sources without saying anything new. Where the clip IS the payoff worth
       showing in sequence, the figure says so with `data-origin-clip`. */
    const links = [...item.querySelectorAll('.cl-step')].map(step => () =>
      stepNode(step.querySelector('picture').cloneNode(true),
               step.dataset.label || '', { bare: step.hasAttribute('data-bare') }));
    if (item.hasAttribute('data-origin-clip')) links.push(() => {
      /* Cloned from the poster rather than baked a second time. Its `sizes`
         describes the 900px stage, so it is rewritten for the cell — left alone
         the browser reuses the stage's choice and fetches a hero rung. */
      const pic = item.querySelector(':scope > picture').cloneNode(true);
      pic.querySelectorAll('source')
        .forEach(s => s.setAttribute('sizes', '(max-width:1100px) 46vw, 300px'));
      return stepNode(pic, item.dataset.clipLabel || 'Clip', { isClip: true });
    });

    /* WITH NO CHAIN there is nothing between the eyebrow and the copy, and the
       block sat hard under the section's own intro with a column of nothing
       under it. It is not a shorter version of the same block, it is a
       different shape, so it is marked as one and the CSS gives it the room. */
    origin.classList.toggle('is-copyonly', !links.length);

    if (links.length) {
      const chain = document.createElement('div');
      chain.className = 'cl-chain';
      links.forEach((make, i) => {
        if (i) chain.appendChild(arrowNode());   // BETWEEN, never trailing
        chain.appendChild(make());
      });
      origin.appendChild(chain);
    }

    const body = document.createElement('p');
    body.className = 'cl-origin-copy';
    body.textContent = copy;
    origin.appendChild(body);
    syncOrigin();
  }

  if (origin && videosPanel && !videosPanel.contains(origin)) {
    new MutationObserver(syncOrigin)
      .observe(videosPanel, { attributes: true, attributeFilter: ['hidden'] });
  }

  function select(i, autoplay) {
    index = (i + items.length) % items.length;
    const item = items[index];

    video.pause();
    frame.classList.remove('is-live');
    video.removeAttribute('src');
    video.load();

    // Poster first, always. The <picture> is cloned rather than referenced so
    // the source figures stay untouched and re-selecting is cheap.
    frame.querySelector('picture')?.remove();
    frame.insertBefore(item.querySelector(':scope > picture').cloneNode(true), frame.firstChild);

    /* A clip that is not 16:9 is fitted into the frame rather than cropped to
       it; the frame is shared, so the flag has to travel from the item onto it
       and be cleared again for the next clip. */
    if (item.dataset.fit) frame.dataset.fit = item.dataset.fit;
    else delete frame.dataset.fit;

    title.textContent = item.dataset.title;
    meta.textContent = item.dataset.note || '';
    paintOrigin(item);
    thumbs.forEach((b, n) => b.setAttribute('aria-selected', String(n === index)));
    scrub.value = 0; setFill(scrub, 0);
    elapsed.textContent = '0:00';
    duration.textContent = '--:--';

    const ok = playable(item);
    note.hidden = ok;
    if (!ok) note.textContent = 'Placeholder — no clip connected to this slot yet';
    big.disabled = !ok;
    toggle.disabled = !ok;
    scrub.disabled = !ok;
    if (ok) {
      video.src = item.dataset.src;
      if (autoplay) play();
    }
    paintButtons();
  }

  function play() {
    if (!playable(items[index])) return;
    touched = true;
    video.play().then(() => {
      frame.classList.add('is-live');
      paintButtons();
    }).catch(() => {
      // Autoplay refused, or the source is unreachable. Either way, say so
      // rather than leaving a dead button.
      note.hidden = false;
      note.textContent = 'This clip could not start — check the source URL and the media-src policy';
      paintButtons();
    });
  }

  /* The surface toggles rather than only starting: it covers the frame now, so
     the click that starts a clip and the click that pauses it are the same
     gesture in the same place. The bar and the note sit above it in z-order and
     keep their own clicks, so the scrubber and the chips are unaffected. */
  big.addEventListener('click', () => { video.paused ? play() : video.pause(); });
  toggle.addEventListener('click', () => { video.paused ? play() : video.pause(); });
  /* Two sets of prev/next: the ones on the frame's edges and the ones in the
     control bar. Same handler, so they cannot drift.

     STEPPING CARRIES THE CURRENT CLIP'S PLAY STATE FORWARD. select() has taken
     an autoplay flag since it was written; these two used to pass nothing, so a
     step landed on a poster and waited for a second click, and then briefly
     passed `true`, so a step started playing a clip even when the one before it
     was deliberately paused. Neither is right — the answer is not a constant.
     What the reader wants is for the transport to keep doing whatever it was
     doing, so the flag is isPlaying() read BEFORE select() runs (it pauses the
     video on its first line, so reading it afterwards would always say false).

     A click IS the user gesture the autoplay policy wants, which is why this
     path is never refused when it does ask to play.

     THE THUMBNAILS DO THE SAME NOW (Dex, 2026-08-25). They used to pass an
     unconditional true on the argument that picking a clip by name is a
     statement about that clip where a chevron is one about direction. In use it
     is not: someone who paused the player and then went looking through the
     strip gets sound and motion they did not ask for, and the only way to stop
     it is to pause again. Paused stays paused, playing stays playing, whichever
     control moved. */
  const step = (to) => select(to, isPlaying());
  document.querySelectorAll('#clPrev, .cl-prev').forEach(b => b.addEventListener('click', () => step(index - 1)));
  document.querySelectorAll('#clNext, .cl-next').forEach(b => b.addEventListener('click', () => step(index + 1)));

  loopBtn.addEventListener('click', () => {
    loop = !loop;
    video.loop = loop;
    loopBtn.dataset.loop = loop ? 'all' : 'off';
    loopBtn.setAttribute('aria-label', loop ? 'Loop this clip' : 'Loop off');
  });

  vol.addEventListener('input', () => {
    video.volume = vol.value / 100;
    video.muted = video.volume === 0;
    if (video.volume > 0) lastVolume = video.volume;
    setFill(vol, vol.value);
    icon(muteBtn, video.muted || video.volume === 0 ? 'volume-mute' : 'volume');
  });
  muteBtn.addEventListener('click', () => {
    if (video.volume > 0) { lastVolume = video.volume; video.volume = 0; }
    else video.volume = lastVolume || 0.4;
    video.muted = video.volume === 0;
    vol.value = Math.round(video.volume * 100);
    setFill(vol, vol.value);
    icon(muteBtn, video.volume === 0 ? 'volume-mute' : 'volume');
  });

  scrub.addEventListener('input', () => {
    scrubbing = true;
    setFill(scrub, scrub.value / 10);
    if (Number.isFinite(video.duration)) elapsed.textContent = mmss((scrub.value / 1000) * video.duration);
  });
  scrub.addEventListener('change', () => {
    if (Number.isFinite(video.duration)) video.currentTime = (scrub.value / 1000) * video.duration;
    scrubbing = false;
  });

  video.addEventListener('play', paintButtons);
  video.addEventListener('pause', paintButtons);
  video.addEventListener('playing', () => { frame.classList.add('is-live'); paintButtons(); });
  video.addEventListener('loadedmetadata', () => { duration.textContent = mmss(video.duration); });
  video.addEventListener('timeupdate', () => {
    if (scrubbing || !Number.isFinite(video.duration)) return;
    const pct = (video.currentTime / video.duration) * 100;
    scrub.value = Math.round(pct * 10);
    setFill(scrub, pct);
    elapsed.textContent = mmss(video.currentTime);
  });
  // Roll to the next clip when one ends, unless it is looping itself.
  video.addEventListener('ended', () => { if (!loop) select(index + 1, true); });
  video.addEventListener('error', () => {
    if (!playable(items[index])) return;
    frame.classList.remove('is-live');
    note.hidden = false;
    note.textContent = 'This clip could not load — check the source URL and the media-src policy';
    paintButtons();
  });

  // Watching full size reuses the wallpaper overlay's shape rather than adding
  // a second one; the video element itself moves into it and back.
  /* Fullscreen puts the FRAME full screen, not the video element: the plate,
     the controls and the poster are all children of it, so they come along and
     keep working. Fullscreening the <video> would hand the browser its own
     native chrome and drop ours. */
  const fullBtn = $('clFullBtn');
  fullBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else frame.requestFullscreen?.().catch(() => {});
  });
  // Driven off the event rather than off the click, so the icon is still right
  // when someone leaves fullscreen with Escape or the browser's own control.
  document.addEventListener('fullscreenchange', () => {
    const on = document.fullscreenElement === frame;
    icon(fullBtn, on ? 'fullscreen-exit' : 'fullscreen');
    fullBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
  });

  /* Space-bar ownership and the no-two-players-at-once rule are arbitrated in
     MediaBus. `onScreen` is deliberately strict: the Clips panel is a tab and is
     `hidden` unless it is the open one, and a frame scrolled past is not
     something worth stealing the page's scroll for. */
  const me = MediaBus.add({
    el: video,
    onScreen: () => {
      const panel = document.getElementById('ai-panel-videos');
      if (!panel || panel.hidden) return false;
      const r = frame.getBoundingClientRect();
      return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
    },
    touched: () => touched,
    toggle: () => { video.paused ? play() : video.pause(); },
    pause: () => video.pause(),
  });
  video.addEventListener('play', () => MediaBus.solo(me));

  setFill(vol, 40);
  select(0);
})();

/* --- markdown ------------------------------------------------------------- */
/* A deliberately small Markdown subset: headings, bold, italic, inline and
   fenced code, lists, tables, block quotes, rules and links. Enough to read a
   prompt the way it was written and nothing more.

   Raw HTML in a source file is ESCAPED, not passed through. These files are
   fetched and injected into the page, so honouring HTML would be a standing
   XSS hole in exchange for formatting no prompt needs. HTML comments are
   dropped instead of escaped — every other Markdown renderer hides them, and
   they are how the files mark where you paste your own text.

   Not a general Markdown implementation and not trying to be. Anything it does
   not recognise falls through as a paragraph, which is the right failure. */
function renderMarkdown(src) {
  /* Quotes are escaped too, and that is not cosmetic. The href below is
     interpolated into an attribute, and `sizes` aside, an unescaped " in a link
     target closes the attribute early: [x](/a"onmouseover=…) parsed as a real
     onmouseover handler on the anchor, which is script execution from a .md
     file. Verified in the browser before and after this line. */
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // Only http(s), mailto and same-origin relative targets become links. A
  // javascript: URL in a file someone dropped in the folder should render as
  // text, not as a working link.
  const safeHref = (h) => (/^(https?:\/\/|mailto:|\/|#|[\w.-]+\/)/i.test(h) ? h : null);

  const inline = (s) => {
    let out = esc(s);
    // Code first: nothing inside a span of code is markup.
    const code = [];
    // Parked behind a sentinel that cannot occur in the source text, so a
    // number in prose is never mistaken for a parked span.
    out = out.replace(/`([^`]+)`/g, (_, c) => `\u0000${code.push(c) - 1}\u0000`);
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, href) => {
      const url = safeHref(href);
      if (!url) return m;
      const ext = /^https?:/i.test(url);
      return `<a href="${url}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>`;
    });
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:!?)])/g, '$1<em>$2</em>');
    return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${code[i]}</code>`);
  };

  const row = (line) => line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());

  const lines = src.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const out = [];
  let para = [];

  // Paragraphs accumulate until something ends them, so a blank line is the
  // only thing that splits one — the same rule Markdown itself uses.
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = line.match(/^```\s*(\S*)/);
    if (fence) {
      flush();
      const body = [];
      while (++i < lines.length && !/^```/.test(lines[i])) body.push(lines[i]);
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    if (!line.trim()) { flush(); continue; }

    if (/^(---+|\*\*\*+|___+)\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }

    const head = line.match(/^(#{1,6})\s+(.*)$/);
    if (head) {
      flush();
      const level = Math.min(6, head[1].length + 1);   // h1 in the file is h2 here
      out.push(`<h${level}>${inline(head[2])}</h${level}>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      flush();
      const body = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      i--;
      out.push(`<blockquote>${renderMarkdown(body.join('\n'))}</blockquote>`);
      continue;
    }

    // A table needs its separator row, or a line of pipes in prose becomes one.
    if (/^\|/.test(line) && /^\s*\|?[\s:-]*\|[\s:|-]*$/.test(lines[i + 1] || '')) {
      flush();
      const head2 = row(line);
      i += 2;
      const body = [];
      while (i < lines.length && /^\|/.test(lines[i])) body.push(row(lines[i++]));
      i--;
      out.push('<table><thead><tr>' + head2.map(c => `<th>${inline(c)}</th>`).join('')
        + '</tr></thead><tbody>'
        + body.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('')
        + '</tbody></table>');
      continue;
    }

    const bullet = line.match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
    if (bullet) {
      flush();
      const ordered = /\d/.test(bullet[1]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
        if (!m) {
          // A wrapped continuation line belongs to the item above it.
          if (items.length && /^\s{2,}\S/.test(lines[i])) { items[items.length - 1] += ' ' + lines[i].trim(); i++; continue; }
          break;
        }
        if (/\d/.test(m[1]) !== ordered) break;
        items.push(m[2]);
        i++;
      }
      i--;
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>` + items.map(t => `<li>${inline(t)}</li>`).join('') + `</${tag}>`);
      continue;
    }

    para.push(line.trim());
  }
  flush();
  return out.join('\n');
}

/* --- markdown documents: one loader, one reader --------------------------- */
/* Two lists point at .md files now — the AI Lab's prompt cards and the Idea
   Vault's plan rows — and there is exactly one of everything between them: one
   fetch cache, one size format, one reading overlay. The alternative was a
   second reader for the vault, which is two implementations to keep in step and
   two places for the same markdown bug to live. */

/* Keyed by URL and holding the PROMISE, not the text: two cards hovered before
   the first response lands share one request, and a rejection is deleted by
   whoever caught it so a later open retries rather than caching the failure. */
const mdCache = new Map();
function loadMd(url) {
  if (mdCache.has(url)) return mdCache.get(url);
  const p = fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
  mdCache.set(url, p);
  return p;
}

/* The file opens with its own `# Title`, and every view already shows that title
   in its own furniture — the card foot, the row, the reader's bar. Rendering it
   a third time reads as a mistake. Dropped from the VIEW only: the file you
   download still has its heading. */
const mdBody = (md) => md.replace(/^\s*#\s+.*\n+/, '');
const mdSize = (text) => {
  const kb = new Blob([text]).size / 1024;
  return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`;
};

/* Assigned by initReader, declared out here for the same reason flashTip is:
   the lists that call it sit elsewhere in this file and must not have to care
   which IIFE ran first. */
let openReader = () => {};

/* --- the reader ----------------------------------------------------------- */
/* #prModal: the markdown rendered the way a person wants to read it, with the
   copy and the download in the same overlay so you never have to close it to
   take the file. It knows nothing about prompts or plans — it is handed a file,
   a title and a name, and the only state it keeps is which file is on screen. */
(function initReader() {
  const modal = document.getElementById('prModal');
  if (!modal) return;
  const readEl = document.getElementById('prRead');
  const titleEl = document.getElementById('pr-dialog-title');
  const metaEl = document.getElementById('prFullMeta');
  const fullDl = document.getElementById('prFullDl');
  const fullCopy = document.getElementById('prFullCopy');

  /* fullDl.dataset.file IS the record of what is showing — the download button
     has to carry it anyway, and a second variable tracking the same thing is a
     second thing that can disagree with it. */
  openReader = ({ file, title, name, opener, stack }) => {
    titleEl.textContent = title;
    metaEl.textContent = name;
    fullDl.dataset.file = file;
    fullDl.dataset.name = name;
    fullDl.setAttribute('aria-label', `Download ${title} as Markdown`);
    readEl.innerHTML = '<p class="pr-loading">Loading…</p>';
    openModal(modal, null, null, opener, stack);
    loadMd(file).then((md) => {
      // The overlay may already have been closed and reopened on another
      // document while this was in flight; only paint if it is still the one
      // on screen.
      if (fullDl.dataset.file !== file) return;
      readEl.innerHTML = renderMarkdown(mdBody(md));
      readEl.scrollTop = 0;
      metaEl.textContent = `${name} · ${mdSize(md)}`;
    }, () => {
      mdCache.delete(file);                    // let a later open retry
      if (fullDl.dataset.file !== file) return;
      readEl.innerHTML = '<p class="pr-loading">Could not load this document.</p>';
    });
  };

  fullDl.addEventListener('click', () => saveFile(fullDl));
  fullCopy?.addEventListener('click', async () => {
    const file = fullDl.dataset.file;
    if (!file) return;
    fullCopy.disabled = true;
    try {
      const ok = await copyText(await loadMd(file));
      flashTip(fullCopy, ok ? 'Copied' : 'Copy failed', ok ? '!' : '');
    } catch {
      mdCache.delete(file);
      flashTip(fullCopy, 'Copy failed', '');
    } finally {
      fullCopy.disabled = false;
    }
  });
  document.getElementById('prClose').addEventListener('click', () => closeModal(modal));
  bindModal(modal);
})();

/* --- AI prompts ----------------------------------------------------------- */
/* Four cards, one .md file each. Nothing about a prompt is written twice: the
   excerpt on the card, the size, the reading view and the downloaded bytes all
   come from the file itself, so adding one is a file plus an <article> in the
   markup — the same contract the wallpapers and the gallery use, for the same
   reason. A hand-kept copy of the text on the card goes stale the first time
   the prompt is edited.

   The files are fetched once, when the tab is first opened. Fetching them on
   load would cost four requests nobody asked for; fetching them per card would
   re-request one every time a card is hovered. */
(function initPrompts() {
  const grid = document.getElementById('prompts');
  if (!grid) return;
  const cards = [...grid.querySelectorAll('.pr-card')];
  if (!cards.length) return;

  const fileName = (card) => card.dataset.file.split('/').pop();

  // Build the card furniture here rather than in the markup: it is identical
  // for every prompt, so writing it four times only creates four chances to
  // write it differently.
  cards.forEach((card) => {
    const title = card.dataset.title || fileName(card);
    /* Head, then body, then the download. The description is what the card
       says at rest — what the prompt is FOR is the useful thing when you are
       scanning four of them — and hovering swaps it for the document itself,
       larger than the old always-on sheet so it can actually be read. */
    card.innerHTML = `
      <div class="pr-head">
        <div class="pr-head-text">
          <h3 class="pr-title"></h3>
          <p class="pr-meta">MD</p>
        </div>
        <span class="pr-tag"></span>
      </div>
      <div class="pr-body">
        <p class="pr-desc">${card.dataset.desc || ''}</p>
        <div class="pr-sheet" aria-hidden="true">
          <div class="pr-mini md"></div>
          <div class="pr-fade"></div>
        </div>
      </div>
      <button class="pr-open" type="button" aria-label="Preview ${title}"></button>
      <button class="pr-copy" type="button" data-tip="Copy prompt"
              aria-label="Copy ${title} to the clipboard">
        <span class="icon" data-icon="copy" aria-hidden="true"></span>
      </button>
      <button class="pr-dl" type="button" data-tip="Download MD"
              aria-label="Download ${title} as Markdown">
        <span class="icon" data-icon="download" aria-hidden="true"></span>
      </button>`;
    card.querySelector('.pr-title').textContent = title;
    card.querySelector('.pr-tag').textContent = card.dataset.tag || '';
    const dl = card.querySelector('.pr-dl');
    dl.dataset.file = card.dataset.file;
    dl.dataset.name = fileName(card);
    dl.addEventListener('click', () => saveFile(dl));

    /* Copies the file the card is already showing. loadMd is the same cached
       promise the preview and the reader use, so this costs no extra request —
       and on a card whose fetch failed it retries rather than copying nothing. */
    const cp = card.querySelector('.pr-copy');
    cp.addEventListener('click', async () => {
      cp.disabled = true;
      try {
        const ok = await copyText(await loadMd(card.dataset.file));
        flashTip(cp, ok ? 'Copied' : 'Copy failed', ok ? '!' : '');
      } catch {
        mdCache.delete(card.dataset.file);
        flashTip(cp, 'Copy failed', '');
      } finally {
        cp.disabled = false;
      }
    });
    const openBtn = card.querySelector('.pr-open');
    openBtn.addEventListener('click', () => openReader({
      file: card.dataset.file, title, name: fileName(card), opener: openBtn,
    }));
  });

  async function fill(card) {
    try {
      const md = await loadMd(card.dataset.file);
      card.querySelector('.pr-mini').innerHTML = renderMarkdown(mdBody(md));
      card.querySelector('.pr-meta').textContent = `MD · ${mdSize(md)}`;
    } catch {
      mdCache.delete(card.dataset.file);        // let a later open retry
      card.querySelector('.pr-mini').innerHTML = '<p>Preview unavailable.</p>';
    }
  }

  /* The panel is hidden until the tab is picked, and a hidden element never
     intersects — so this fires exactly once, the first time Prompts is opened
     and on screen. That is the cheapest correct trigger available: no polling,
     no coupling to the tab code. */
  const start = () => cards.forEach(fill);
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) { io.disconnect(); start(); }
    });
    cards.forEach(c => io.observe(c));
  } else start();
})();

/* --- the backlog, under the snail ----------------------------------------- */
/* The list beneath the vault's snail: every plan that is written but unbuilt,
   previewable and downloadable. Same contract as the prompt cards and for the
   same reason — a row names a .md file and the reading view, the byte size and
   the downloaded bytes all come from that file, so adding a plan is one
   <article> and no JS edit.

   The Surveyor rows point at the committed copies under games/surveyor/docs/.
   Nothing is duplicated into assets/: a second copy is a second thing to
   update, and it goes stale the first time a plan is amended.

   THE TABS ARE BUILT FROM THE ROWS rather than written beside them. That is
   what keeps "adding a plan is markup only" true when the plan is the first of
   a new category, and it is what makes "a category with one plan gets no tab of
   its own" automatic instead of something to remember. */
(function initVaultList() {
  const list = document.getElementById('ivList');
  if (!list) return;
  const rows = [...list.querySelectorAll('.iv-row')];
  if (!rows.length) return;
  const tabsEl = document.getElementById('ivTabs');

  const fileName = (row) => row.dataset.file.split('/').pop();

  rows.forEach((row) => {
    const title = row.dataset.title || fileName(row);
    // Icon, then what it is, then how to take it — left to right, in the order
    // the row is read.
    row.innerHTML = `
      <span class="icon iv-icon" data-icon="${row.dataset.icon || 'work'}" aria-hidden="true"></span>
      <div class="iv-text">
        <h3 class="iv-title"></h3>
        <p class="iv-desc"></p>
      </div>
      <div class="iv-tools">
        <button class="iv-btn iv-preview" type="button" data-tip="Preview">
          <span class="icon" data-icon="preview" aria-hidden="true"></span>
        </button>
        <button class="iv-btn iv-dl" type="button" data-tip="Download MD">
          <span class="icon" data-icon="download" aria-hidden="true"></span>
        </button>
      </div>`;
    row.querySelector('.iv-title').textContent = title;
    row.querySelector('.iv-desc').textContent = row.dataset.desc || '';

    const preview = row.querySelector('.iv-preview');
    preview.setAttribute('aria-label', `Preview ${title}`);
    preview.addEventListener('click', () => openReader({
      file: row.dataset.file, title, name: fileName(row), opener: preview,
      /* Stacked OVER the vault overlay rather than replacing it: closing the
         reader has to put you back in the list you opened it from, and the
         vault section relocks the moment its own overlay closes. */
      stack: true,
    }));

    const dl = row.querySelector('.iv-dl');
    dl.dataset.file = row.dataset.file;
    dl.dataset.name = fileName(row);
    dl.setAttribute('aria-label', `Download ${title} as Markdown`);
    dl.addEventListener('click', () => saveFile(dl));
  });

  if (!tabsEl) return;

  // Map insertion order is the order the rows are written in, so the tabs come
  // out in the markup's order and there is no second list to keep in step.
  const counts = new Map();
  rows.forEach(r => counts.set(r.dataset.cat, (counts.get(r.dataset.cat) || 0) + 1));
  const cats = [...counts.entries()].filter(([cat, n]) => cat && n > 1).map(([cat]) => cat);
  // One category, or one plan each: a row of tabs that cannot filter anything
  // is furniture. The list keeps its own label in that case.
  if (!cats.length) {
    tabsEl.hidden = true;
    list.setAttribute('aria-label', 'Plans');
    return;
  }

  const frag = document.createDocumentFragment();
  ['All', ...cats].forEach((label, i) => {
    const tab = document.createElement('button');
    tab.className = 'iv-tab';
    tab.type = 'button';
    tab.id = `iv-tab-${i}`;
    tab.dataset.cat = i === 0 ? '' : label;     // ALL filters on nothing
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.tabIndex = -1;                          // roving: initTabs owns it
    tab.textContent = label;
    frag.appendChild(tab);
  });
  tabsEl.replaceChildren(frag);

  /* One tab row over ONE list, so the tabs deliberately carry no aria-controls:
     initTabs reads that attribute to hide the panel a tab owns, and every tab
     here points at the same list — it would hide the list on every tab but the
     selected one. The relationship is stated the other way round instead, with
     the list naming the selected tab as its label. */
  list.setAttribute('role', 'tabpanel');
  const select = initTabs(tabsEl, (_, tab) => {
    const cat = tab.dataset.cat;
    rows.forEach(r => { r.hidden = !!cat && r.dataset.cat !== cat; });
    list.setAttribute('aria-labelledby', tab.id);
  });
  select?.(0);
})();

/* --- AI Lab app info ------------------------------------------------------ */
/* The empty half of the AI LAB column, filled with whatever app the pointer is
   on: a lead line, a paragraph, two tags and a gallery button. Same components
   as the games section (.game-desc, .game-actions) rather than a second set of
   styles that would drift.

   Copy lives on the cards as data-desc-lead / data-desc-body, next to the thing
   it describes, so adding an app is one card and no edit here — the same
   contract the games rows use.

   It follows hover and focus but does NOT touch the shared screenshot viewer
   until its button is actually clicked. Pointing the viewer at an app just
   because the pointer crossed a card would leave the GAMES button showing an
   app's set. */
(function initAppInfo() {
  const panel = document.getElementById('ai-panel-apps');
  const info = document.getElementById('appInfo');
  // The cards live in the statement column now (#aiApps), not in the panel —
  // the panel holds what they select: lead, shot, description, actions.
  const apps = document.getElementById('aiApps');
  if (!panel || !info || !apps) return;
  const cards = [...apps.querySelectorAll('.ai-card')];
  if (!cards.length) return;

  const title = document.getElementById('appInfoTitle');
  const lead = info.querySelector('.game-desc-lead');
  const body = info.querySelector('.game-desc-body');
  const tags = info.querySelectorAll('.game-tag');
  let current = cards[0];

  /* The inline gallery: every .gal-item shot for every app, cloned out of
     the gallery's data block once at boot. Cloned, never borrowed — the
     games viewer moves the originals into its own stage, and a shared node
     would vanish from here the first time that overlay opened. The original
     picture rides along per shot so the enlarge view can clone it again at
     overlay sizes on demand. sizes is rewritten on the inline clones because
     the originals advertise the overlay's near-full-width slot, and a 660px
     frame fetching a 1600 rung is the exact oversize fetch the slot table
     exists to prevent. */
  const art = document.getElementById('appArt');
  const artView = document.getElementById('appArtView');
  const artPrev = document.getElementById('appArtPrev');
  const artNext = document.getElementById('appArtNext');
  const artCount = document.getElementById('appArtCount');
  const shots = new Map();               // key -> [{span, source}]
  if (artView) {
    const SIZES = '(max-width:1100px) min(92vw, 660px), min(660px, 42vw)';
    for (const card of cards) {
      const key = card.dataset.gallery;
      if (!key || shots.has(key)) continue;
      const pics = [...document.querySelectorAll(`#galleryModal .gal-item[data-game="${key}"] picture`)];
      if (!pics.length) continue;
      shots.set(key, pics.map((source) => {
        const clone = source.cloneNode(true);
        for (const s of clone.querySelectorAll('source')) s.sizes = SIZES;
        const img = clone.querySelector('img');
        if (img) { img.classList.add('app-art-img'); img.sizes = SIZES; }
        const span = document.createElement('span');
        span.className = 'app-art-shot';
        span.hidden = true;
        span.appendChild(clone);
        artView.appendChild(span);
        return { span, source };
      }));
    }
  }

  /* One shot on screen, x/x in the corner, chevrons only when there is
     somewhere to go. The index resets when the shown app changes. */
  let viewKey = null;
  let idx = 0;
  const setFor = () => (viewKey && shots.get(viewKey)) || [];
  const paintShots = () => {
    if (!art) return;
    const set = setFor();
    for (const list of shots.values()) for (const s of list) s.span.hidden = true;
    art.hidden = !set.length;
    if (!set.length) return;
    idx = ((idx % set.length) + set.length) % set.length;
    set[idx].span.hidden = false;
    const single = set.length < 2;
    artPrev.hidden = single;
    artNext.hidden = single;
    artCount.textContent = `${idx + 1}/${set.length}`;
    artView.setAttribute('aria-label', `Enlarge screenshot ${idx + 1} of ${set.length}` +
      (current ? ` for ${current.querySelector('strong')?.textContent}` : ''));
  };
  artPrev?.addEventListener('click', () => { idx -= 1; paintShots(); });
  artNext?.addEventListener('click', () => { idx += 1; paintShots(); });

  const show = (card) => {
    current = card;
    if (title) title.textContent = card.querySelector('strong')?.textContent || '';
    lead.textContent = card.dataset.descLead || '';
    body.textContent = card.dataset.descBody || '';
    for (const tag of tags) {
      const value = card.dataset[tag.dataset.slot] || '';
      tag.textContent = value;
      tag.hidden = !value;
    }
    // The frame follows the panel: fresh app, first shot; no shots, no frame.
    viewKey = card.dataset.gallery || null;
    idx = 0;
    paintShots();
  };

  /* Hover PREVIEWS; only a click HOLDS. The pointer leaving the LIST snaps
     the panel back to whatever was last clicked — seeded on the first row, so
     with nothing ever clicked the section rests on the top app. Keyboard
     gets the same deal through focusout on the list. */
  let selected = cards[0];
  const setSelected = (card) => {
    selected = card;
    for (const c of cards) c.classList.toggle('is-current', c === selected);
  };

  for (const card of cards) {
    card.addEventListener('pointerenter', () => show(card));
    /* focusin, not focus: the card is a container and never takes focus
       itself — focus lands on the title link or the eyeball inside it, and
       focusin is the version that bubbles. Tabbing previews exactly as
       hovering does, with no third tab stop spent on selection. */
    card.addEventListener('focusin', () => show(card));
    /* The blank space selects and HOLDS. Lowest-stakes action of the three
       targets, and the only way to browse this section on touch, where hover
       never fires. The title link and the eyeball keep their own jobs and
       select as a side effect — same card either way, nothing prevented. */
    card.addEventListener('click', () => { setSelected(card); show(card); });
  }
  /* The revert belongs to the LIST, not to each row. Held per card, it fired
     the instant the pointer crossed the gap between two rows, so every move
     down the list flashed the selected app's copy and shot before the next
     row's pointerenter painted over it — a glitch, not a preview. The gaps
     are INSIDE #aiApps, and pointerleave on a container fires only when the
     pointer leaves the whole subtree, so crossing one is not leaving
     anything. Fixing it in the gaps themselves was the wrong end of it: the
     spacing is right, the handling was wrong. */
  apps.addEventListener('pointerleave', () => show(selected));
  // Focus leaving the whole list snaps back too, same rule as the pointer.
  apps.addEventListener('focusout', (event) => {
    if (!apps.contains(event.relatedTarget)) show(selected);
  });

  /* The enlarge view — wallpaper-style, not the games' gallery modal: one
     image large over the page, x/x centred under it between two arrows that
     grey out (never vanish) when there is only one shot. The stage clone is
     built from the ORIGINAL gallery picture at overlay sizes, so the big
     rungs are fetched only when someone actually enlarges. */
  const lb = document.getElementById('appShotModal');
  if (artView && lb) {
    const lbStage = document.getElementById('appShotStage');
    const lbCount = document.getElementById('appShotCount');
    const lbPrev = document.getElementById('appShotPrev');
    const lbNext = document.getElementById('appShotNext');
    let lbIdx = 0;
    const lbPaint = () => {
      const set = setFor();
      if (!set.length) return;
      lbIdx = ((lbIdx % set.length) + set.length) % set.length;
      const clone = set[lbIdx].source.cloneNode(true);
      for (const s of clone.querySelectorAll('source')) s.sizes = '92vw';
      const img = clone.querySelector('img');
      if (img) {
        img.sizes = '92vw';
        img.loading = 'eager';
        if (img.decode) img.decode().catch(() => {});
      }
      lbStage.replaceChildren(clone);
      lbCount.textContent = `${lbIdx + 1}/${set.length}`;
      const single = set.length < 2;
      lbPrev.disabled = single;
      lbNext.disabled = single;
      // the inline frame keeps step, so closing lands where you left off
      idx = lbIdx;
      paintShots();
    };
    artView.addEventListener('click', () => {
      if (!setFor().length) return;
      lbIdx = idx;
      lbPaint();
      openModal(lb, lb.querySelector('.app-shot-shell'), null, artView);
    });
    lbPrev.addEventListener('click', () => { lbIdx -= 1; lbPaint(); });
    lbNext.addEventListener('click', () => { lbIdx += 1; lbPaint(); });
    lb.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); lbIdx -= 1; lbPaint(); }
      if (event.key === 'ArrowRight') { event.preventDefault(); lbIdx += 1; lbPaint(); }
    });
    document.getElementById('appShotClose')?.addEventListener('click', () => closeModal(lb));
    bindModal(lb, () => lbStage.replaceChildren());
  }

  /* Same trap initGameArt documents: the clones' images are lazy and hidden,
     so the first hover would also be the first request. Warm them when the
     section comes into range instead, guarded so a width that hides the
     frame does not pull pictures it can never show. */
  if (art && shots.size) {
    const warm = () => {
      // display:none while NOT [hidden] means a media rule hides the frame on
      // this device — do not pull pictures it can never show. [hidden] alone
      // is just "this app has no shots"; eager images fetch through that.
      if (getComputedStyle(art).display === 'none' && !art.hidden) return false;
      for (const img of art.querySelectorAll('img')) {
        img.loading = 'eager';
        img.fetchPriority = 'low';
        if (img.decode) img.decode().catch(() => {});
      }
      return true;
    };
    const section = art.closest('section') || art;
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting) && warm()) io.disconnect();
      }, { rootMargin: '600px 0px' });
      io.observe(section);
    } else warm();
  }

  /* The panel must not change height as the pointer walks the list — apps
     with no shots collapse the frame, and every copy block wraps
     differently, so left alone the whole section breathed on every hover.
     Reserve the tallest state instead: run every card through show(), take
     the max rendered height, pin it as min-height, then restore. Width
     changes what wraps, so a resize re-measures; a hidden panel measures
     zero, so it never runs there — returning to the Apps tab re-runs it. */
  let reserveArmed = null;
  const reserve = () => {
    if (panel.hidden) return;
    const held = current;
    info.style.minHeight = '';
    let max = 0;
    for (const card of cards) { show(card); max = Math.max(max, info.offsetHeight); }
    show(held);
    info.style.minHeight = max + 'px';
  };
  window.addEventListener('resize', () => {
    clearTimeout(reserveArmed);
    reserveArmed = setTimeout(reserve, 150);
  });

  /* The card grid lives in the statement column, which is OUTSIDE the tab
     panels and therefore visible whatever tab is open — left alone it would
     follow the visitor into Wallpapers and Clips advertising apps the panels
     no longer describe. Same sync #wpThumbs uses for the same reason.

     Tied to the Apps panel's own `hidden` attribute through an observer rather
     than to a click on the tab: initTabs owns that attribute, and watching the
     thing itself cannot fall out of step with however the panel comes to be
     shown (a click, a keyboard arrow, or anything added later). The panel's
     own contents (lead, shot, description) need no sync — they hide with it. */
  const syncVisible = () => {
    apps.hidden = panel.hidden;
    if (!panel.hidden) reserve();
  };
  new MutationObserver(syncVisible).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  syncVisible();

  /* Seeded rather than left blank: this column is on screen before anyone has
     hovered anything, and an empty half-column reads as a loading failure.

     In a microtask, because the seed asks the gallery for a count and the
     gallery module is further down this file — synchronously, its listener does
     not exist yet and the button kept the bare "GALLERY" it ships with. A
     microtask runs after the whole script has finished, which is the earliest
     moment every module on the page is listening. */
  queueMicrotask(() => { setSelected(cards[0]); show(cards[0]); reserve(); });
})();

/* --- Collab project info -------------------------------------------------- */
/* The COLLAB section's initAppInfo: the statement column's empty half fills
   with whatever project card the pointer is on. Same contract — the copy and
   the tags live on the cards as data-*, so adding a project is one card and
   no edit here.

   One attribute is richer than the app cards needed: data-people, one entry
   per contributor ("Name | relation | label=url, label=url", joined ";;").
   It is parsed once and drives BOTH the brain row on the card and the
   collaborator list in the panel — the brain count is the length of the list
   it stands for, never a number typed beside it, so it cannot drift when
   someone joins.

   The + beside the brains goes to the repo's collaborators settings page
   (data-invite) — the page where inviting actually happens, gated by GitHub
   itself. It is rendered only when the card carries the URL, so cards whose
   repo is not Dex's to administer simply have no +. */
(function initCollabInfo() {
  const info = document.getElementById('collabInfo');
  const grid = document.querySelector('#collab .collab-grid');
  if (!info || !grid) return;
  const cards = [...grid.querySelectorAll('.collab-card')];
  if (!cards.length) return;

  const lead = info.querySelector('.game-desc-lead');
  const body = info.querySelector('.game-desc-body');
  const tags = info.querySelectorAll('.game-tag');
  const list = document.getElementById('collabPeople');

  const icon = (name) => {
    const el = document.createElement('span');
    el.className = 'icon';
    el.dataset.icon = name;
    el.setAttribute('aria-hidden', 'true');
    return el;
  };

  const people = (card) => (card.dataset.people || '').split(';;').map(entry => {
    const [name = '', relation = '', links = ''] = entry.split('|').map(s => s.trim());
    return name && {
      name, relation,
      links: links.split(',').map(pair => {
        // split on the FIRST '=' only — the URL side can carry its own.
        const at = pair.indexOf('=');
        return at < 0 ? null
          : { label: pair.slice(0, at).trim(), url: pair.slice(at + 1).trim() };
      }).filter(l => l && l.label && l.url),
    };
  }).filter(Boolean);

  for (const card of cards) {
    const crew = card.querySelector('.collab-crew');
    const crowd = people(card);
    if (crew) {
      const row = document.createElement('span');
      row.className = 'collab-brains';
      // One image to assistive tech, not N unlabeled decorations.
      row.setAttribute('role', 'img');
      row.setAttribute('aria-label', `${crowd.length} contributor${crowd.length === 1 ? '' : 's'}`);
      for (const person of crowd) {
        const brain = icon('brain');
        brain.classList.add('collab-brain');
        brain.title = person.name;
        row.append(brain);
      }
      crew.append(row);
      const invite = card.dataset.invite;
      if (invite) {
        const plus = document.createElement('a');
        plus.className = 'collab-invite';
        plus.href = invite;
        plus.target = '_blank';
        plus.rel = 'noreferrer';
        plus.setAttribute('aria-label', 'Invite a collaborator — repo access settings');
        plus.append(icon('plus'));
        crew.append(plus);
      }
    }
    // The pill on the thumbnail. Filled from data-status rather than typed in
    // the markup a second time; :empty hides it on a card that has none.
    const status = card.querySelector('.collab-status');
    if (status) status.textContent = card.dataset.status || '';
  }

  const show = (card) => {
    lead.textContent = card.dataset.descLead || card.querySelector('strong')?.textContent || '';
    body.textContent = card.dataset.descBody || '';
    for (const tag of tags) {
      const value = card.dataset[tag.dataset.slot] || '';
      tag.textContent = value;
      tag.hidden = !value;
    }
    list.replaceChildren(...people(card).map(person => {
      const li = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = person.name;
      const relation = document.createElement('small');
      relation.textContent = person.relation || '—';
      const links = document.createElement('span');
      links.className = 'collab-links';
      for (const link of person.links) {
        const a = document.createElement('a');
        a.href = link.url;
        a.target = '_blank';
        a.rel = 'noreferrer';
        a.append(link.label, icon('arrow-ne'));
        a.lastChild.classList.add('inline-arrow');
        links.append(a);
      }
      li.append(name, relation, links);
      return li;
    }));
  };

  for (const card of cards) {
    card.addEventListener('pointerenter', () => show(card));
    card.addEventListener('focusin', () => show(card));
  }
  // Seeded so the column is never empty; nothing here waits on another module,
  // so no microtask is needed the way the gallery-counting seed above is.
  show(cards[0]);
})();

/* --- AI Lab app overlay --------------------------------------------------- */
/* Phone-shaped iframe on desktop; a plain navigation on phones.

   The trigger is the card's eyeball button — authored only on cards that
   carry data-app-modal, so an app with no on-site preview has no dead
   control. The card itself is a plain container now (its three targets are
   split: title link out, eyeball to this overlay, blank space selects), so
   there is no href here to fall through to.

   768px matches the spec in the app's brief, and is read at CLICK time, not at
   load: a desktop window dragged narrow (or a tablet rotated) then behaves like
   what it currently is, rather than what it was when the page loaded. Below
   the breakpoint CSS hides the eyeball outright; if a resize strands a
   visible one, the click degrades to the title link's destination rather
   than a dead button. */
(function initAppModal() {
  const dialog = document.getElementById('appModal');
  const frame = document.getElementById('appFrame');
  const cards = document.querySelectorAll('.ai-card[data-app-modal]');
  if (!dialog || !frame || !cards.length) return;

  const wantsModal = () => window.matchMedia('(min-width: 768px)').matches;

  /* ESCAPE, ONCE FOCUS IS INSIDE THE FRAME.

     A <dialog> closes on Escape by itself, and that worked right up until
     anyone clicked anything: the key goes to the document that has focus,
     focus is in the iframe, and the parent never sees it. So Escape closed
     the overlay before you touched the app and stopped closing it forever
     after — which reads as the overlay being stuck, and is worse than never
     having worked, because it teaches the key and then takes it away.

     The frame is same-origin, so the fix is to listen on its document too.
     BUBBLE PHASE, NOT CAPTURE, and that is the whole contract: the app's own
     handler gets to call preventDefault() when it had something of its own
     to close, and this only closes the window when nothing did.

     AND THE ANSWER IS READ A TICK LATE, WHICH IS THE PART THAT WAS WRONG
     FIRST. Both apps listen on their `window`, and window is the LAST hop
     in the bubble path — after document. So a document listener, bubble phase
     or not, runs BEFORE them and reads defaultPrevented while it is still
     false: ThemeDock's slider popover closed and the window closed with it,
     in one press. Deferring the decision to a timeout lets the whole
     dispatch finish first, which makes this independent of where an app
     chooses to listen instead of quietly depending on it.
     MindSplit already worked that way — a sheet, then the profile page — and
     its comment says exactly why it could not reach the parent; ThemeDock
     claims Escape the same way for its slider popover. So a sheet takes one
     press and the window takes the next, innermost first, which is what
     Escape means everywhere else.

     Re-armed on every load because each open navigates the frame (it is
     blanked to about:blank on close), so the document this binds to is a new
     one each time and the old listener dies with the old document. */
  frame.addEventListener('load', () => {
    let doc = null;
    try { doc = frame.contentDocument; } catch { return; }   // never same-origin? nothing to do
    if (!doc) return;
    doc.addEventListener('keydown', event => {
      if (event.key !== 'Escape' && event.key !== 'Esc') return;
      setTimeout(() => {
        if (event.defaultPrevented) return;   // the app claimed it
        if (!dialog.open) return;
        closeModal(dialog);
      }, 0);
    });
  });

  cards.forEach(card => {
    const eye = card.querySelector('.ai-card-eye');
    const link = card.querySelector('.ai-card-link');
    if (!eye) return;
    /* data-link-preview: the app has no public home yet, so its TITLE link
       opens this same overlay instead of navigating — a stand-in, dropped
       from the card the day the app is live. Phones keep following the href
       (the overlay declines below 768px either way). */
    if (card.hasAttribute('data-link-preview') && link) {
      link.addEventListener('click', (event) => {
        if (!wantsModal()) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey
            || event.shiftKey || event.altKey) return;
        event.preventDefault();
        open(link);
      });
    }
    eye.addEventListener('click', () => {
      if (!wantsModal()) { link?.click(); return; }
      open(eye);
    });
    function open(opener) {
      const url = card.dataset.appModal;
      const title = card.dataset.appTitle || 'App';
      /* Phone unless the card says otherwise. Set on every open, not once: the
         overlay is shared, so a window-shaped app must not leave the next
         phone-shaped one stretched into a monitor. */
      dialog.dataset.shape = card.dataset.appShape || 'phone';
      dialog.querySelector('#app-dialog-title').textContent = title;
      frame.title = title;
      /* embed=1 tells the app it is already inside a phone-shaped frame, so it
         renders full-bleed instead of drawing its own device frame. It used to
         infer that from window.innerWidth, which worked only while this modal
         was narrow enough to pass for a phone — once the frame grew, the app
         saw a desktop-width viewport and drew a second, smaller phone inside
         this one. The link out and the mobile path stay clean URLs; only the
         iframe carries the flag. */
      const embedUrl = url + (url.includes('?') ? '&' : '?') + 'embed=1';
      // Set src on open, not in the markup: otherwise every visitor downloads
      // the whole bundle whether or not they ever click the card.
      if (frame.getAttribute('src') !== embedUrl) frame.setAttribute('src', embedUrl);
      openModal(dialog, dialog.querySelector('.app-shell'), null, opener);
    }
  });

  document.getElementById('appClose')?.addEventListener('click', () => closeModal(dialog));
  // Blank the frame on close so the app stops running — its scene animations
  // and the fake vote-drift interval would otherwise keep ticking behind the
  // page for as long as the tab is open.
  bindModal(dialog, () => frame.setAttribute('src', 'about:blank'));
})();

/* --- sidebar profile collapse -------------------------------------------- */
/* Hides the profile photo, bio and social row, leaving the toggle plus RESUME
   and CONTACT. The toggle only renders on the expanded sidebar, so the state is
   restored before first paint rather than on load — otherwise a collapsed
   profile would flash open on every navigation. */
const PROFILE_KEY = 'dex-profile-collapsed';

(function initProfileCollapse() {
  const toggle = document.getElementById('profileToggle');
  const block = document.getElementById('profileMini');
  const footer = toggle?.closest('.side-bottom');
  if (!toggle || !block || !footer) return;

  let armed = null;
  const apply = (collapsed, animate) => {
    // Transitions are opt-in via .is-toggling. Without that, the collapse rule
    // is scoped to the expanded sidebar, so simply expanding the rail re-ran
    // the animation and the block appeared to grow open before snapping shut.
    clearTimeout(armed);
    footer.classList.toggle('is-toggling', animate);
    if (animate) {
      const ms = parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue('--sidebar-transition-duration')) * 1000 || 240;
      armed = setTimeout(() => footer.classList.remove('is-toggling'), ms + 60);
    }
    footer.classList.toggle('is-profile-collapsed', collapsed);
    // One button, two homes: the collapsed mini row and the expanded name line.
    // Moving it beats rendering two, which would put two identical controls in
    // the tab order and make the accessible name ambiguous.
    const home = collapsed
      ? document.querySelector('.profile-compact')
      : document.querySelector('.profile-nameline');
    if (home && toggle.parentElement !== home) home.appendChild(toggle);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Show profile' : 'Hide profile');
    // Zero-height content is still tabbable without this — inert takes the
    // whole block, social links included, out of the tab order and the a11y tree.
    block.inert = collapsed;
  };

  let stored = null;
  try { stored = localStorage.getItem(PROFILE_KEY); } catch { /* private mode */ }
  apply(stored === '1', false);

  toggle.addEventListener('click', () => {
    const collapsed = toggle.getAttribute('aria-expanded') === 'true';
    apply(collapsed, true);
    try { localStorage.setItem(PROFILE_KEY, collapsed ? '1' : '0'); } catch { /* private mode */ }
  });
})();


/* --- songs player --------------------------------------------------------- */
/* One <audio> shared by every track. Switching songs swaps .src, which stops
   whatever was playing — "no overlap, no resume where you left off" is then a
   property of the markup rather than something the script has to police. */
const VOLUME_KEY = 'dex-song-volume';
const LOOP_MODES = ['off', 'all', 'one'];

(function initSongPlayer() {
  const audio = document.getElementById('songAudio');
  const bar = document.getElementById('player');
  if (!audio || !bar) return;

  // Only cards that actually carry a track. The four placeholders are skipped,
  // so skip/next walks real songs and picks the rest up when they land.
  const cards = [...document.querySelectorAll('.pk-song')]
    .filter(c => c.querySelector('.pk-play[data-audio]'));
  if (!cards.length) return;

  const $ = id => document.getElementById(id);
  const art = $('playerArt'), title = $('playerTitle'), artist = $('playerArtist');
  const toggle = $('playerToggle'), prev = $('playerPrev'), next = $('playerNext');
  const loopBtn = $('playerLoop'), shuffleBtn = $('playerShuffle');
  const scrub = $('playerScrub'), vol = $('playerVol');
  const elapsed = $('playerElapsed'), total = $('playerDuration');
  const muteBtn = $('playerMute'), stopBtn = $('playerStop');

  let index = -1, loop = 'off', scrubbing = false, lastVolume = 0.4, shuffle = false;

  /* Shuffle picks the next track at random rather than reordering the list: the
     grid on the page IS the queue, and quietly re-sorting it under the reader
     would make the bar disagree with what they are looking at.
     Never returns the track already playing — with five songs, a plain random
     pick repeats about one time in five, which reads as the button being
     broken rather than as chance. */
  const pickRandom = () => {
    if (cards.length < 2) return 0;
    let n = index;
    while (n === index) n = Math.floor(Math.random() * cards.length);
    return n;
  };
  /* What shuffle has already played this pass, so "loop off" can tell the
     difference between a shuffle that still has tracks left and one that has
     been through the list. Cleared whenever it wraps or shuffle is turned off. */
  const played = new Set();

  const mmss = t => Number.isFinite(t)
    ? Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') : '--:--';
  const setFill = (el, pct) => el.style.setProperty('--fill', pct + '%');
  const icon = (btn, name) => { const i = btn.querySelector('.icon'); if (i) i.setAttribute('data-icon', name); };

  function paint() {
    const playing = !audio.paused && index >= 0;
    cards.forEach((c, i) => {
      c.classList.toggle('is-playing', i === index);
      const b = c.querySelector('.pk-play');
      const on = i === index && playing;
      const ic = b.querySelector('.pk-play-icon');
      if (ic) ic.setAttribute('data-icon', on ? 'pause' : 'play');
      if (b.hasAttribute('data-audio')) {
        b.setAttribute('aria-label', (on ? 'Pause ' : 'Play ') + c.dataset.title + ' by ' + c.dataset.artist);
      }
    });
    icon(toggle, playing ? 'pause' : 'play');
    toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  function load(i, play) {
    const card = cards[i];
    if (!card) return;
    index = i;
    audio.src = card.querySelector('.pk-play').getAttribute('data-audio');
    // The bar's thumbnail reuses whatever the grid already decoded, so showing
    // it costs no extra request.
    const img = card.querySelector('.pk-cover');
    art.src = (img && (img.currentSrc || img.src)) || '';
    art.alt = '';
    title.textContent = card.dataset.title;
    artist.textContent = card.dataset.artist;
    total.textContent = '--:--';
    elapsed.textContent = '0:00';
    scrub.value = 0; setFill(scrub, 0);
    reveal();
    if (play) audio.play().catch(paint);
    paint();
  }

  function reveal() {
    if (!bar.hidden) return;
    bar.hidden = false;
    // One frame at translateY(100%) before the class lands, or the bar is
    // already in place by the time the transition is asked to run.
    requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.add('is-up')));
  }

  function step(delta, auto) {
    if (loop === 'one' && auto) { audio.currentTime = 0; audio.play(); return; }
    /* Shuffle owns next-track selection, whether the track ended on its own or
       you pressed skip. Loop still has the last word on whether playback stops:
       with loop off, an ended track in shuffle keeps going only as far as the
       list would have — otherwise "off" would never actually stop. */
    if (shuffle && index >= 0) {
      if (auto && loop === 'off' && played.size >= cards.length - 1) { audio.pause(); paint(); return; }
      const n = pickRandom();
      played.add(n);
      if (played.size >= cards.length) played.clear();
      load(n, true);
      return;
    }
    const at = index + delta;
    if (at >= cards.length) {
      if (auto && loop === 'off') { audio.pause(); paint(); return; }
      load(0, true); return;
    }
    if (at < 0) { load(cards.length - 1, true); return; }
    load(at, true);
  }

  document.querySelectorAll('.pk-play[data-audio]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = cards.indexOf(btn.closest('.pk-song'));
      if (i === index && audio.src) { audio.paused ? audio.play() : audio.pause(); return; }
      load(i, true);
    });
  });

  toggle.addEventListener('click', () => { audio.paused ? audio.play() : audio.pause(); });
  prev.addEventListener('click', () => step(-1, false));
  next.addEventListener('click', () => step(1, false));

  shuffleBtn.addEventListener('click', () => {
    shuffle = !shuffle;
    played.clear();
    if (shuffle && index >= 0) played.add(index);
    shuffleBtn.setAttribute('aria-pressed', String(shuffle));
    shuffleBtn.setAttribute('aria-label', shuffle ? 'Shuffle on' : 'Shuffle off');
  });

  loopBtn.addEventListener('click', () => {
    loop = LOOP_MODES[(LOOP_MODES.indexOf(loop) + 1) % LOOP_MODES.length];
    loopBtn.dataset.loop = loop;
    loopBtn.setAttribute('aria-label',
      loop === 'off' ? 'Loop off' : loop === 'all' ? 'Loop all tracks' : 'Loop this track');
  });

  stopBtn.addEventListener('click', () => {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    index = -1;
    bar.classList.remove('is-up');
    const done = () => { bar.hidden = true; bar.removeEventListener('transitionend', done); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
    else bar.addEventListener('transitionend', done);
    paint();
  });

  audio.addEventListener('play', paint);
  audio.addEventListener('pause', paint);
  audio.addEventListener('ended', () => step(1, true));
  audio.addEventListener('loadedmetadata', () => { total.textContent = mmss(audio.duration); });
  audio.addEventListener('timeupdate', () => {
    if (scrubbing || !Number.isFinite(audio.duration)) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    scrub.value = Math.round(pct * 10);
    setFill(scrub, pct);
    elapsed.textContent = mmss(audio.currentTime);
  });

  scrub.addEventListener('pointerdown', () => { scrubbing = true; });
  const commit = () => {
    scrubbing = false;
    if (Number.isFinite(audio.duration)) audio.currentTime = (scrub.value / 1000) * audio.duration;
  };
  scrub.addEventListener('pointerup', commit);
  scrub.addEventListener('change', commit);
  scrub.addEventListener('input', () => {
    setFill(scrub, scrub.value / 10);
    if (Number.isFinite(audio.duration)) elapsed.textContent = mmss((scrub.value / 1000) * audio.duration);
  });

  function applyVolume(v, persist) {
    audio.volume = v;
    vol.value = Math.round(v * 100);
    setFill(vol, v * 100);
    icon(muteBtn, v === 0 ? 'volume-mute' : 'volume');
    muteBtn.setAttribute('aria-label', v === 0 ? 'Unmute' : 'Mute');
    if (persist) { try { localStorage.setItem(VOLUME_KEY, String(v)); } catch { /* private mode */ } }
  }
  vol.addEventListener('input', () => {
    const v = vol.value / 100;
    if (v > 0) lastVolume = v;
    applyVolume(v, true);
  });
  muteBtn.addEventListener('click', () => {
    applyVolume(audio.volume === 0 ? (lastVolume || 0.4) : 0, true);
  });

  let stored = null;
  try { stored = localStorage.getItem(VOLUME_KEY); } catch { /* private mode */ }
  const parsed = stored === null ? 0.4 : parseFloat(stored);
  const start = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.4;
  lastVolume = start || 0.4;
  applyVolume(start, false);

  /* Registered exactly like the clips player — see MediaBus. The bar is fixed to
     the bottom of the viewport, so "on screen" is just whether it has been
     revealed; and the only thing that reveals it is someone starting a track,
     which is the same fact as having been interacted with. */
  const me = MediaBus.add({
    el: audio,
    // Keeps playing when the tab is hidden or the window loses focus — see the
    // exemption in MediaBus. Music is the one thing here you start and then go
    // and do something else to.
    keepPlayingHidden: true,
    onScreen: () => !bar.hidden,
    touched: () => index >= 0,
    toggle: () => { audio.paused ? audio.play().catch(paint) : audio.pause(); },
    pause: () => audio.pause(),
  });
  audio.addEventListener('play', () => MediaBus.solo(me));

  paint();
})();


/* --- the space bar --------------------------------------------------------- */
/* Space plays and pauses the media instead of scrolling the page — but only
   where taking it is not rude. The order below IS the specification, and every
   rule is here because skipping it breaks something that already worked:

     1. In a text field, space types a space. Nothing on this page is worth
        breaking that for, so it is the first question asked.
     2. On a button, link or any other control, space belongs to the platform:
        it activates the control, or on a link it scrolls. A page that takes it
        is a page you cannot operate from the keyboard. (The social row earlier
        in this file refuses it for the same reason, on the same grounds.)
     3. Only then may a player have it, and only one that is playing or that
        someone has already started. A player nobody has touched does not get
        to make the space bar mysterious.
     4. If both could claim it, the one playing wins, else the one on screen.
        MediaBus.claimant() is that decision and the comment there is why.
     5. If nothing claims it the page scrolls exactly as it always did. That is
        the case that most has to keep working, so it is the fall-through rather
        than a special case — every early return above lands on it.

   preventDefault() is called at ONE point, after a claimant is found. Calling
   it any earlier is how a feature like this quietly eats the page's scroll. */
(function initSpaceTransport() {
  const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
  const CONTROL = 'button, a[href], summary, audio[controls], video[controls],'
    + ' [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="switch"],'
    + ' [role="radio"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"],'
    + ' [role="option"], [role="slider"], [role="spinbutton"], [role="combobox"], [role="textbox"]';

  window.addEventListener('keydown', (event) => {
    if (event.key !== ' ' && event.code !== 'Space') return;
    // Shift+Space is page-up; the rest are the browser's shortcuts. None are ours.
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.defaultPrevented) return;

    // Rules 1 and 2. `closest` rather than a tag test, because focus can sit on
    // a <span class="icon"> inside the button that actually owns the key.
    const target = event.target;
    if (target instanceof Element && (target.closest(FIELD) || target.closest(CONTROL))) return;

    // Rules 3 and 4.
    const player = MediaBus.claimant();
    if (!player) return;                  // rule 5 — the page scrolls, untouched

    event.preventDefault();               // only now is the scroll ours to stop
    // Held down, space repeats. The scroll still has to be stopped on every
    // repeat, but toggling on each one would strobe the player.
    if (event.repeat) return;
    player.toggle();
  });
})();

/* --- toolkit hover descriptions ------------------------------------------- */
/* Fills the right-hand slot of the tab row with the hovered or focused tile's
   description, and clears it when nothing is targeted. Screen readers do not
   depend on this: each tile carries the same sentence as sr-only text, so the
   visual row is aria-hidden and purely an echo. */
(function initToolkitDescriptions() {
  const row = document.querySelector('.tk-tabrow');
  const out = document.getElementById('tkDesc');
  if (!row || !out) return;

  const show = text => {
    out.textContent = text || '';
    out.classList.toggle('is-on', !!text);
  };
  const from = el => {
    const tile = el && el.closest ? el.closest('.tk-item') : null;
    return tile ? tile.dataset.desc : null;
  };

  const panels = out.closest('section') || document;
  // Delegated, so tiles added later (the tabs Dex has not written copy for yet)
  // need no extra wiring.
  panels.addEventListener('pointerover', e => { const d = from(e.target); if (d) show(d); });
  panels.addEventListener('pointerout', e => {
    if (!e.relatedTarget || !from(e.relatedTarget)) show(null);
  });
  // Keyboard parity: focus drives the same slot as hover.
  panels.addEventListener('focusin', e => show(from(e.target)));
  panels.addEventListener('focusout', e => {
    if (!e.relatedTarget || !from(e.relatedTarget)) show(null);
  });
  // Switching tab wipes whatever the last tab left behind.
  document.querySelectorAll('.tk-tab').forEach(t => t.addEventListener('click', () => show(null)));
})();


/* --- copy the open document to the clipboard ------------------------------ */
/* Two flavours in one write: the paste target picks what it understands, so a
   plain-text field gets plain text and Word/Docs/Gmail get real paragraphs and
   anchors. No mode toggle, no dropdown.

   The HTML flavour deliberately carries NO colour, background, font-family or
   font-size. This page is light text on a dark ground; copying that styling
   into a white Word document pastes white-on-white and reads as nothing at all.
   Structure travels, typography stays behind. */
(function initResumeCopy() {
  const btn = document.getElementById('resumeCopy');
  if (!btn) return;
  const icon = btn.querySelector('.btn-icon');
  const restore = { icon: icon.dataset.icon, label: btn.getAttribute('aria-label') };
  let revert = null;

  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /** The document the viewer is currently showing. */
  const activePage = () => document.querySelector('.resume-page:not([hidden])');

  /* Walk the rendered page rather than a duplicate copy of the words, so the
     clipboard can never drift from what is on screen. */
  function build(page) {
    const lines = [];
    const html = [];
    for (const el of page.querySelectorAll('h2, h3, p, li')) {
      // Plain text: links become bare URLs, since text/plain cannot carry them.
      const plain = [...el.childNodes].map(n => {
        if (n.nodeType === 3) return n.textContent;
        if (n.nodeName === 'A') {
          const href = n.getAttribute('href') || '';
          const shown = n.textContent.trim();
          const url = href.replace(/^mailto:/, '');
          return url && url !== shown ? `${shown} (${url})` : shown;
        }
        return n.textContent;
      }).join('').replace(/\s+/g, ' ').trim();
      if (!plain) continue;
      lines.push(plain);

      const inner = [...el.childNodes].map(n => {
        if (n.nodeType === 3) return esc(n.textContent);
        if (n.nodeName === 'A') return `<a href="${esc(n.getAttribute('href') || '')}">${esc(n.textContent)}</a>`;
        if (n.nodeName === 'STRONG' || n.nodeName === 'B') return `<strong>${esc(n.textContent)}</strong>`;
        return esc(n.textContent);
      }).join('').replace(/\s+/g, ' ').trim();
      const tag = /^H\d$/.test(el.nodeName) ? 'p' : (el.nodeName === 'LI' ? 'li' : 'p');
      const bold = /^H\d$/.test(el.nodeName) || el.classList.contains('cv-signoff');
      html.push(`<${tag}>${bold && !inner.includes('<strong>') ? `<strong>${inner}</strong>` : inner}</${tag}>`);
    }
    return {
      // Blank line between paragraphs.
      text: lines.join('\n\n'),
      html: `<div>${html.join('')}</div>`,
    };
  }

  function flash(ok, msg) {
    clearTimeout(revert);
    icon.dataset.icon = ok ? 'tick-check' : 'copy';
    btn.classList.toggle('is-done', ok);
    btn.classList.toggle('is-failed', !ok);
    // Icon-only, so the outcome has to reach screen readers through the name.
    btn.setAttribute('aria-label', msg);
    revert = setTimeout(() => {
      icon.dataset.icon = restore.icon;
      btn.setAttribute('aria-label', restore.label);
      btn.classList.remove('is-done', 'is-failed');
    }, 2200);
  }

  btn.addEventListener('click', async () => {
    const page = activePage();
    if (!page) return;
    const { text, html } = build(page);
    // Rich write first; it needs a secure context and can reject outright.
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      })]);
      flash(true, 'Copied to the clipboard');
      return;
    } catch (e) { /* fall through to plain text */ }
    try {
      await navigator.clipboard.writeText(text);
      flash(true, 'Copied to the clipboard');
    } catch (e) {
      // Both refused — say so on the button rather than appearing to do nothing.
      flash(false, 'Copy failed');
    }
  });

  // The button follows whichever document is open.
  const sync = () => {
    const page = activePage();
    const what = page && page.id === 'panel-cover' ? 'cover letter' : 'resume';
    restore.label = `Copy Dex Cimino ${what} to the clipboard`;
    if (!btn.classList.contains('is-done') && !btn.classList.contains('is-failed')) {
      btn.setAttribute('aria-label', restore.label);
    }
  };
  document.querySelectorAll('.resume-tab').forEach(t => t.addEventListener('click', () => setTimeout(sync, 0)));
  sync();
})();


/* --- games list artwork preview ------------------------------------------- */
/* Hovering or focusing a row shows that game's artwork in the empty half of the
   left column, and it STAYS — moving off a row changes nothing, so the last one
   looked at remains for the rest of the session. Session-scoped by construction:
   nothing is written anywhere, so a reload starts empty again.

   The preview is a link to whatever it is currently showing. href, the
   accessible name and the visible artwork are set from the same row in one
   place, so the name cannot go stale against the picture.

   Artwork is named for what it depicts rather than for the game, so a row
   points at its file through data-art. Rows without one leave the preview
   alone — better than blanking the column for a game that has no art. */
(function initGameArt() {
  const art = document.getElementById('gameArt');
  const rows = [...document.querySelectorAll('.stack-row[data-game]')];
  if (!art || !rows.length) return;

  const shots = [...art.querySelectorAll('.game-art-shot')];
  if (!shots.length) return;

  /* The shots live in a display:none subtree until one is picked, and a lazy
     image inside display:none is never fetched — lazy loading watches for the
     element's box to approach the viewport, and there is no box. So without
     this the first hover is also the first request and the frame sits empty
     for a whole round trip, which is exactly as bad as it sounds.

     Warm them as the section comes into range instead: eager starts the fetch,
     decode() does the decode off the hover path too, so the pointer landing
     only has to unhide a picture the browser is already holding.

     The display check is not belt and braces. Phones hide the preview outright,
     and an EAGER image in display:none downloads anyway — only the lazy ones
     are skipped — so without it this would pull artwork that device can never
     show. Warming stays off until something could actually display it. */
  function warm() {
    if (getComputedStyle(art).display === 'none') return false;
    for (const img of art.querySelectorAll('.game-art-img')) {
      img.loading = 'eager';
      img.fetchPriority = 'low';           // never ahead of the hero, which is the LCP
      if (img.decode) img.decode().catch(() => {});
    }
    return true;
  }
  const section = art.closest('section') || art;
  if ('IntersectionObserver' in window) {
    // A screen of runway. The section is only one screen down to begin with, so
    // on a desktop this lands at load — which is the right time for something
    // that close to the fold, at low priority.
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting) && warm()) io.disconnect();
    }, { rootMargin: '600px 0px' });
    io.observe(section);
  } else warm();

  /* Hovering the artwork should feel like hovering the row it stands for, so
     the row it is showing lights up with it. One class, styled by the same
     rule as :hover, rather than a second highlight that looks nearly right. */
  let showing = null;
  const linkRow = on => { if (showing) showing.classList.toggle('is-linked', on); };
  art.addEventListener('pointerenter', () => linkRow(true));
  art.addEventListener('pointerleave', () => linkRow(false));
  art.addEventListener('focus', () => linkRow(true));
  art.addEventListener('blur', () => linkRow(false));

  /* Row-level state, split from the artwork on purpose: showArt() bails early
     for rows with no artwork (correct — it leaves the last picture up rather
     than blanking the frame), so anything set after that bail would never swap
     for Cupcake Gobbler or Arena1. select() runs for EVERY row: description,
     the persistent is-current that drives the play glyph, then artwork.
     is-current is not is-linked — is-linked is the transient artwork-hover
     highlight; folding them together would flicker the glyph on artwork hover. */
  const desc = document.getElementById('gameDesc');
  const descLead = desc && desc.querySelector('.game-desc-lead');
  const descBody = desc && desc.querySelector('.game-desc-body');

  /* The tag vocabulary, in ONE place and deliberately tiny. Left open, this
     turns into "Survival", "survival horror" and "Wave Survival" across three
     games inside a month, and the preview column — min(520px, 26vw), narrower
     again under 1100px — has no room to absorb the difference. Players is a
     pattern rather than a list because a range is the honest answer for a game
     that is both solo and multi, and "1-6P" says it in fewer characters than
     either label alone.
     A value outside this is rendered anyway (a slightly-off word beats a hole
     in the row) but shouted about, so it is caught in the session that
     introduced it rather than three games later. */
  const GAME_TAGS = {
    genre:   v => ['SURVIVAL', 'SANDBOX', 'SHOOTER', 'PLATFORMER', 'PUZZLE', 'EXPLORATION'].includes(v),
    dim:     v => ['2D', '3D'].includes(v),
    players: v => v === 'SOLO' || /^\d+-\d+P$/.test(v),
  };
  const tagSlots = [...document.querySelectorAll('#gameTags .game-tag')];

  // The row's own <strong> is the one name on the page for that game, so the
  // artwork's label and the gallery's label cannot drift apart from it.
  const gameName = row => (row.querySelector('strong') || {}).textContent || 'this game';

  function showTags(row) {
    for (const slot of tagSlots) {
      const key = slot.dataset.slot;
      const value = (row.dataset[key] || '').trim();
      if (value && GAME_TAGS[key] && !GAME_TAGS[key](value)) {
        console.warn(`game tag: "${value}" is not an allowed ${key} — see GAME_TAGS in script.js`);
      }
      slot.textContent = value;
    }
  }

  let current = null;
  function select(row) {
    if (current === row) return;
    if (current) current.classList.remove('is-current');
    current = row;
    row.classList.add('is-current');

    if (descLead) descLead.textContent = row.dataset.descLead || '';
    if (descBody) descBody.textContent = row.dataset.descBody || '';

    showTags(row);
    showArt(row);

    /* The gallery lives in its own IIFE below and owns the button's label and
       count, so tell it rather than reach into it. An event also means the
       seeding select() further down cannot race it: that fires before the
       gallery exists, and the gallery catches up by reading .is-current at its
       own init. Both paths, one source of truth — the selected row. */
    document.dispatchEvent(new CustomEvent('game:select', {
      detail: { game: row.dataset.game || null, name: gameName(row) },
    }));
  }

  function showArt(row) {
    const key = row.dataset.art;
    const shot = key && shots.find(s => s.dataset.art === key);
    if (!shot) return;                       // no artwork: leave what is there

    // Hand the highlight over cleanly, and keep it lit if the pointer is on the
    // artwork right now — a row can still win via keyboard focus while it is.
    if (showing && showing !== row) showing.classList.remove('is-linked');
    showing = row;
    linkRow(art.matches(':hover'));

    shots.forEach(s => { s.hidden = s !== shot; });
    art.classList.add('is-on');

    // Follow the row exactly: same destination, and the same target behaviour,
    // so the two never disagree about where the game opens.
    const href = row.getAttribute('href');
    if (href && href !== '#') art.setAttribute('href', href);
    else art.removeAttribute('href');
    const target = row.getAttribute('target');
    if (target) art.setAttribute('target', target); else art.removeAttribute('target');
    const rel = row.getAttribute('rel');
    if (rel) art.setAttribute('rel', rel); else art.removeAttribute('rel');

    art.setAttribute('aria-label', `Open ${gameName(row)}`);
    art.removeAttribute('aria-hidden');
  }

  for (const row of rows) {
    row.addEventListener('pointerenter', () => select(row));
    row.addEventListener('focus', () => select(row));
  }

  /* The section RESTS on the first game that has artwork. It is not a hover
     reward — the picture is what the left column is for, so leaving it blank
     until a pointer happens to land on a row means scrolling past a hole where
     the artwork goes and reading it as a broken or still-loading image.

     Seeded here rather than on the observer that warms the bytes: this is a
     class and a hidden flag, it costs no network of its own, and the download
     stays governed by warm() and by lazy loading either way. Deferring it just
     reintroduced a window where the column is empty. */
  const first = rows.find(r => r.dataset.art && shots.some(s => s.dataset.art === r.dataset.art));
  if (first) select(first);

  /* The description box is sized ONCE to the tallest copy any row carries, so
     hovering down the list never pushes the page taller and shorter — that
     reflow read as the section jumping under the pointer. Measured with a
     hidden clone at the real rendered width (the body's own margins and fonts
     apply to it, so the numbers are the truth, not an estimate), and
     re-measured on resize because line wrapping moves the answer. */
  function lockDescHeight() {
    if (!desc || !descLead || !descBody) return;
    const ghost = desc.cloneNode(true);
    ghost.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;'
      + 'width:' + desc.getBoundingClientRect().width + 'px;min-height:0';
    const gLead = ghost.querySelector('.game-desc-lead');
    const gBody = ghost.querySelector('.game-desc-body');
    desc.parentElement.appendChild(ghost);
    let max = 0;
    for (const row of rows) {
      gLead.textContent = row.dataset.descLead || '';
      gBody.textContent = row.dataset.descBody || '';
      max = Math.max(max, ghost.getBoundingClientRect().height);
    }
    ghost.remove();
    desc.style.minHeight = Math.ceil(max) + 'px';
  }
  lockDescHeight();
  let descResize;
  window.addEventListener('resize', () => {
    clearTimeout(descResize);
    descResize = setTimeout(lockDescHeight, 150);
  });
})();

/* ==========================================================================
   PORTRAIT TOGGLE  (accent line art <-> gray line art; photo parked)
   Two controls, one state. Either button drives every portrait on the page —
   the About hero, the sidebar profile, and the compact avatar the rail shows
   while the profile is collapsed. That third one is easy to miss: leave it out
   and the two portraits disagree the moment somebody hits the chevron.

   THE PHOTO IS PARKED AGAIN, NOT REMOVED (Dex: out 2026-08-22, back the same
   day, out again 2026-08-23). Each trip is the same two-line edit, to
   PORTRAIT_CYCLE and to the `gray` label, and nothing else moves either way.
   That is not luck — it is that the photo branches in apply() are all written
   as `state !== 'photo'` rather than as a photo case, so the state going
   missing from the cycle leaves them inert instead of leaving them wrong.
   Anything added here should keep that shape. `assets/about/profile.jpg`
   stays, all three <img> elements stay in the markup, lazy and at opacity 0
   under the drawing; restoring the photo is 'photo' back at the front of
   PORTRAIT_CYCLE and the gray label pointing at it again.

   While it is out: a saved 'photo' from a previous visit fails the `includes`
   test on load and falls back to the accent, so a returning visitor is never
   stranded on a state the cycle no longer has. The key is unchanged and
   nothing is migrated, so coming back in simply starts working again.

   No aria-pressed. It is a two-state attribute, and with three states both
   line-art variants would report pressed=true — so stepping from accent to gray
   would be silent to a screen reader while the page visibly changed. A cycling
   control has to speak through its name instead, which is why the label states
   what is showing AND what pressing next will do.

   State is two classes on <html> and nothing else, so the CSS owns every visual
   consequence. ink-on means "a drawing rather than the photo"; ink-gray only
   recolours it, so the two line-art states cannot drift apart. Applied
   synchronously, like the collapse state, so a returning visitor's choice is up
   before first paint rather than swapping in after it.
   ========================================================================== */
const PORTRAIT_KEY = 'dex-portrait-ink';
const PORTRAIT_CYCLE = ['ink', 'gray'];          // 'photo' parked again (Dex, 2026-08-23) — see above
const PORTRAIT_LABEL = {
  photo: 'Portrait: photo. Switch to accent line art.',
  ink: 'Portrait: accent line art. Switch to gray line art.',
  gray: 'Portrait: gray line art. Switch back to accent line art.'
};

(function initPortraitInk() {
  const buttons = [...document.querySelectorAll('[data-ink-toggle]')];
  if (!buttons.length) return;

  const apply = state => {
    const root = document.documentElement;
    const wasOn = root.classList.contains('ink-on');
    // One-way: the mask keys on this so it survives the fade-out. Clearing it
    // with the state is the bug it exists to fix — the mask snaps to none while
    // opacity is still easing, and a solid rectangle fades out instead of the
    // drawing.
    if (state !== 'photo') root.classList.add('ink-ready');
    root.classList.toggle('ink-on', state !== 'photo');
    // Leaving for the photo deliberately does NOT clear ink-gray. Clearing both
    // at once drops the drawing back to the accent rule underneath, so it
    // recoloured green over 260ms while it was still fading out over 340 — a
    // bright flash at ~50% opacity on its way to nothing. Holding the colour
    // until something asks for a different one means the drawing always fades
    // out in the colour it was, and the stale class matches nothing in the
    // photo state anyway: every gray rule needs .ink-on alongside it.
    if (state !== 'photo') {
      // Coming back from the photo, the drawing is still wearing whatever
      // colour it faded out in, and easing that to the new one across the
      // fade-in tints the first ~100ms. Recolour with the transition suppressed
      // instead: the overlay is at opacity 0 at this instant, so the swap is
      // free, and only the fade is left to animate. The reflow is what commits
      // the colour before transitions come back.
      const hidden = !wasOn;
      if (hidden) root.classList.add('ink-recolor');
      root.classList.toggle('ink-gray', state === 'gray');
      if (hidden) { void root.offsetWidth; root.classList.remove('ink-recolor'); }
    }
    // Every control, every time. One button left reading the old state is the
    // whole bug this loop exists to prevent.
    for (const button of buttons) {
      button.dataset.portrait = state;
      button.setAttribute('aria-label', PORTRAIT_LABEL[state]);
    }
  };

  // The accent line art is the DEFAULT face of the site now; the photo is one
  // click away and a stored choice still wins.
  let state = 'ink';
  try {
    const saved = localStorage.getItem(PORTRAIT_KEY);
    if (PORTRAIT_CYCLE.includes(saved)) state = saved;
  } catch (err) { /* private mode */ }
  apply(state);

  for (const button of buttons) {
    button.addEventListener('click', () => {
      state = PORTRAIT_CYCLE[(PORTRAIT_CYCLE.indexOf(state) + 1) % PORTRAIT_CYCLE.length];
      apply(state);
      try { localStorage.setItem(PORTRAIT_KEY, state); } catch (err) { /* private mode */ }
    });
  }
})();

/* ==========================================================================
   GAME GALLERY — per game, one overlay.
   The .gal-item pictures in the data block carry data-game; this groups them
   by it and shows only the set belonging to whichever row the games section
   currently has selected. The hero swaps the SELECTED picture in (moved, not
   cloned, so the browser never holds two copies), the filmstrip is rebuilt
   whenever the game changes. Modal behaviour (focus, Esc, backdrop, scroll
   lock) rides the shared helpers.

   This is the overlay the games section already had — it is NOT the work
   overlay above, which has its own shell and its own mockup data. Nothing here
   touches that one.

   A game with no shots is a real state, not an error: the button greys but
   stays live, and opening lands on an honest empty caption. Every game gets a
   gallery shortly, and a disabled control that quietly becomes enabled is
   worse than a live one that is briefly empty.
   ========================================================================== */
(function initGameGallery() {
  const dialog = document.getElementById('galleryModal');
  const openBtn = document.getElementById('galleryOpen');
  if (!dialog || !openBtn) return;

  const stage = document.getElementById('galStage');
  const film = document.getElementById('galFilm');
  const capTitle = document.getElementById('galCapTitle');
  const capIndex = document.getElementById('galCapIndex');
  const title = document.getElementById('gal-dialog-title');

  /* Counted off the DOM, never off an attribute. A hand-typed count is wrong
     the first time a shot is added and nobody notices for weeks; this cannot
     disagree with the pictures because it IS the pictures. */
  const byGame = new Map();
  for (const item of dialog.querySelectorAll('.gal-item')) {
    const key = item.dataset.game || '';
    if (!byGame.has(key)) byGame.set(key, []);
    byGame.get(key).push(item);
  }

  let items = [];        // the current game's set
  let thumbs = [];
  let index = 0;
  let gameKey;           // undefined until the first setGame, so null still sets
  let gameLabel = 'this game';
  /* Which figure the hero picture was borrowed FROM. Tracked rather than
     recomputed as items[index]: switching games repoints items, and stowing
     into the new set would file a Stickland shot under Chomp and lose it. */
  let heroItem = null;
  /* What the GAMES section currently has selected, kept separately from the
     viewer's live key: the viewer is shared and can be pointed at another
     section's pictures, and this is what the games button restores. */
  let gamesKey = null;
  let gamesName = null;

  function stow() {
    const pic = stage.querySelector('picture');
    if (pic && heroItem) heroItem.appendChild(pic);
    heroItem = null;
  }

  function buildFilm() {
    film.replaceChildren();
    thumbs = items.map((item, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gal-thumb';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', 'false');
      b.setAttribute('aria-label', item.dataset.title || `Screenshot ${i + 1}`);
      const pic = item.querySelector('picture');
      if (pic) b.appendChild(pic.cloneNode(true));
      b.addEventListener('click', () => select(i));
      film.appendChild(b);
      return b;
    });
  }

  /* Paints ONE open button. Split out from setGame because there is more than
     one of these on the page now — games has its own, the AI Lab's apps have
     another — and a button must always advertise its own set, not whichever set
     the shared viewer happens to be holding. */
  function paintOpenBtn(btn, count, name) {
    const lbl = btn.querySelector('.game-gallery-label') || btn.querySelector('span');
    if (lbl) lbl.textContent = `GALLERY (${count})`;
    btn.classList.toggle('is-empty', count === 0);
    btn.setAttribute('aria-label', count
      ? `Open the ${name} gallery, ${count} screenshot${count === 1 ? '' : 's'}`
      : `Open the ${name} gallery — no screenshots yet`);
  }
  const countFor = (key) => (byGame.get(key) || []).length;

  function setGame(key, name, btn) {
    const asked = name || 'this game';
    if (btn) paintOpenBtn(btn, countFor(key), asked);
    if (key === gameKey) return;
    stow();                       // hand the hero picture back BEFORE items moves
    gameKey = key;
    gameLabel = asked;
    items = byGame.get(key) || [];
    index = 0;

    buildFilm();
    if (title) title.textContent = `${gameLabel} gallery`;
    // The filmstrip is only a listbox when it has options in it, and arrows
    // that step through nothing are worse than no arrows.
    film.hidden = items.length === 0;
    dialog.classList.toggle('is-empty', items.length === 0);
  }

  function select(i) {
    /* Hand the previous hero back BEFORE borrowing the next, here rather than
       at each call site. The close event that used to be trusted to do it is
       QUEUED, not synchronous (see bindModal), so reopening fast enough got
       here with the picture still in the stage: the item no longer held one,
       replaceChildren(null) wiped the stage, and that shot was gone from the
       page until reload. Stowing first makes select() idempotent no matter
       when the queued close actually lands. */
    stow();
    if (!items.length) {
      // In the stage rather than the caption: the caption is a thin line under
      // a big empty frame, and the frame is what the eye lands on.
      const note = document.createElement('p');
      note.className = 'gal-empty';
      note.textContent = 'No shots yet.';
      stage.replaceChildren(note);
      capTitle.textContent = '';
      capIndex.textContent = '';
      return;
    }
    index = (i + items.length) % items.length;
    const item = items[index];
    const pic = item.querySelector('picture');
    // Guarded: replaceChildren(null) inserts the STRING "null" and drops the
    // real picture on the floor, which is a silent corruption rather than a
    // visible failure. stow() above should make this unreachable.
    if (!pic) return;
    heroItem = item;
    stage.replaceChildren(pic);
    // The picture moved out of the hidden data block, so its lazy images can
    // load now; decode() keeps the swap paint-clean.
    const img = stage.querySelector('img');
    if (img) { img.loading = 'eager'; if (img.decode) img.decode().catch(() => {}); }
    capTitle.textContent = item.dataset.title || '';
    capIndex.textContent = `${index + 1} / ${items.length}`;
    thumbs.forEach((t, n) => t.setAttribute('aria-selected', String(n === index)));
  }

  const step = delta => { if (items.length) select(index + delta); };
  dialog.querySelector('.gal-prev').addEventListener('click', () => step(-1));
  dialog.querySelector('.gal-next').addEventListener('click', () => step(1));
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
  });

  /* Re-assert this section's own set before opening. The viewer is shared, so
     another section may have shown its own pictures in the meantime, and
     opening on whatever was left there is how you click GAMES and get an app. */
  openBtn.addEventListener('click', () => {
    setGame(gamesKey, gamesName, openBtn);
    openModal(dialog, dialog.querySelector('.gal-shell'), () => select(index), openBtn);
  });

  /* The one door in for anything else on the page: say which set you want and
     which control asked, and this shows it. Used by the AI Lab's app cards —
     one screenshot viewer on the page rather than a second implementation. */
  document.addEventListener('gallery:open', (event) => {
    const d = event.detail || {};
    setGame(d.key ?? null, d.name, d.button || openBtn);
    openModal(dialog, dialog.querySelector('.gal-shell'), () => select(index),
              d.button || openBtn);
  });
  // Lets a caller label its own button without opening anything.
  document.addEventListener('gallery:count', (event) => {
    const d = event.detail || {};
    if (d.button) paintOpenBtn(d.button, countFor(d.key ?? null), d.name || 'this');
  });
  document.getElementById('galleryClose').addEventListener('click', () => closeModal(dialog));
  bindModal(dialog, stow);

  // Follow the games section. The seeding select() up there has already fired
  // by the time this runs, so read the row it settled on rather than waiting
  // for an event that is never coming again.
  document.addEventListener('game:select', e => {
    gamesKey = e.detail.game;
    gamesName = e.detail.name;
    setGame(gamesKey, gamesName, openBtn);
  });
  const seeded = document.querySelector('.stack-row.is-current');
  gamesKey = seeded ? seeded.dataset.game || null : null;
  gamesName = seeded ? (seeded.querySelector('strong') || {}).textContent : null;
  setGame(gamesKey, gamesName, openBtn);
})();


/* ---------- about breakout (the bio is the wall) --------------------------
   Everything game lives in about-breakout.js and loads on the FIRST click —
   nothing here touches the module, so the cold path costs a rect check and
   two chips. Pointer + motion gating is CSS (see .bb-ui); this block owns
   the geometry half: the toy only exists where the layout has dead space
   under the bio for the ball AND clear gutter to the right for the in-game
   control stack, which today means roughly >=1400px wide. */
(() => {
  const ui = document.getElementById('bbUi');
  const play = document.getElementById('bbPlay');
  const stack = document.getElementById('bbStack');
  const muteBtn = document.getElementById('bbMuteBtn');
  const vol = document.getElementById('bbVol');
  const pauseBtn = document.getElementById('bbPauseBtn');
  const stopBtn = document.getElementById('bbStopBtn');
  if (!ui || !play || !stack) return;

  const MODULE = './about-breakout.js?v=10';
  let mod = null;
  const load = async () => (mod ??= await import(MODULE));

  // The module's canPlay() re-checks the dead space at start; the duplicate
  // exists so the button can appear without loading the module. The gutter
  // check is what keeps the play button and the control stack gated
  // TOGETHER: no width may offer the game and then have nowhere to put stop.
  const room = () => {
    const copy = document.querySelector('.about-copy');
    const p = document.querySelector('.about-copy > p:last-of-type');
    const photo = document.querySelector('.about-photo');
    const sub = document.querySelector('.about-sub');
    if (!copy || !p || !photo || !sub) return false;
    const floor = Math.min(photo.getBoundingClientRect().bottom,
      sub.getBoundingClientRect().top - 10);
    return floor - p.getBoundingClientRect().bottom >= 56
      && window.innerWidth - copy.getBoundingClientRect().right >= 150;
  };
  const gate = () => { ui.hidden = !room(); };
  gate();
  window.addEventListener('resize', gate);
  window.addEventListener('load', gate);

  let ctl = null;
  let starting = false;

  /* The game registers with MediaBus THROUGH its music: starting the toy
     pauses the songs bar (two things playing at once is worse than either),
     the space bar reaches the game under the bus's existing rules — a
     focused field still types, a focused button still activates, nothing
     playing still scrolls — and the hidden-tab rule pauses it like any other
     player. The blips deliberately stay unregistered: short fx are not a
     player. `el` is a shim because the music is a WebAudio loop, not a media
     element — the bus only ever reads `.paused`. */
  const me = MediaBus.add({
    el: { get paused() { return !ctl || !ctl.state.running || ctl.state.paused; } },
    onScreen: () => !!ctl && ctl.state.running,
    touched: () => !!ctl,
    toggle: () => ctl?.toggle(),
    pause: () => ctl?.pause(),
  });

  const paintControls = () => {
    if (!mod) return;
    const s = mod.getAudio().settings;
    const pct = Math.round(s.get('master') * 100);
    vol.value = String(pct);
    vol.style.setProperty('--fill', pct + '%');
    const on = s.isOn('master');
    muteBtn.setAttribute('aria-checked', String(on));
    muteBtn.setAttribute('aria-label', on ? 'Mute game sound' : 'Unmute game sound');
    // muted hides the slider (a level not in effect) and slashes the speaker
    muteBtn.closest('.bb-mrow').classList.toggle('bb-muted', !on);
    const paused = !!ctl && ctl.state.paused;
    pauseBtn.setAttribute('aria-pressed', String(paused));
    pauseBtn.setAttribute('aria-label', paused ? 'Resume game' : 'Pause game');
  };

  play.addEventListener('click', async () => {
    if (ctl || starting) return;
    starting = true;
    try {
      const m = await load();
      if (!m.canPlay()) { gate(); return; }
      ui.classList.add('bb-playing');
      ctl = await m.start({
        onStop: () => {
          ctl = null;
          stack.hidden = true;
          const keys = document.getElementById('bbKeys');
          if (keys) keys.hidden = true;
          ui.classList.remove('bb-playing');
          gate();
        },
        onPauseChange: (paused) => {
          paintControls();
          // Resuming is "this player started playing": silence the rest.
          if (!paused) MediaBus.solo(me);
        },
      });
      // The stack sits LOW: its bottom roughly level with the paddle, and
      // only the game knows where that lands. Unhide first — a hidden
      // element has no height to measure.
      stack.hidden = false;
      const canvasTop = ctl.handle.canvas.getBoundingClientRect().top;
      const copyRect = document.querySelector('.about-copy').getBoundingClientRect();
      stack.style.top = (canvasTop + ctl.state.paddle.y + 8 -
        stack.offsetHeight - copyRect.top) + 'px';
      /* The keycap hints belong to the GAME, so they go under the playfield:
         left edge flush with the bio column, in the strip between the ball's
         floor and the toolkit below. They used to anchor to .about-photo,
         which is the other column entirely — the row rendered under the
         portrait, labelling controls for a game happening beside it.
         Unhide first: a hidden element has no height to measure, same as the
         stack above. */
      const keys = document.getElementById('bbKeys');
      if (keys) {
        keys.hidden = false;
        const floorY = ctl.handle.canvas.getBoundingClientRect().top +
          ctl.state.bounds.floor;
        const sub = document.querySelector('.about-sub');
        const strip = sub
          ? sub.getBoundingClientRect().top - floorY
          : keys.offsetHeight + 20;
        // Centred in that strip, and never within 6px of the ball's floor —
        // the paddle lives 14px above it and must stay clear of the caps.
        const slack = Math.max(6, (strip - keys.offsetHeight) / 2);
        keys.style.left = '0px';
        keys.style.top = (floorY + slack - copyRect.top) + 'px';
      }
      paintControls();
      paintTrack();
      MediaBus.solo(me);            // the music began: the songs bar yields
    } catch (e) {
      // Any failure to start leaves the section exactly as it was.
      ctl = null;
      stack.hidden = true;
      const keys = document.getElementById('bbKeys');
      if (keys) keys.hidden = true;
      ui.classList.remove('bb-playing');
    } finally {
      starting = false;
    }
  });

  /* The track picker under the playfield. It reads and writes the module's
     music, which owns the list, the fetch cache and the remembered choice —
     this only paints what it is told. The label is the only place that turns a
     0-based index into a human 1-based one. */
  const trkPrev = document.getElementById('bbTrkPrev');
  const trkNext = document.getElementById('bbTrkNext');
  const trkCount = document.getElementById('bbTrkCount');
  const paintTrack = () => {
    if (!mod || !trkCount) return;
    const t = mod.getAudio().music.track;
    trkCount.textContent = `${t.index + 1} / ${t.count}`;
    for (const el of [trkPrev, trkNext]) el?.setAttribute('data-tip', t.name);
  };
  const step = (dir) => {
    if (!mod) return;
    const m = mod.getAudio().music;
    dir > 0 ? m.next() : m.prev();
    paintTrack();
  };
  trkPrev?.addEventListener('click', () => step(-1));
  trkNext?.addEventListener('click', () => step(1));

  /* The stack: mute + slider write the SHARED mixer (the module's
     createAudioSettings instance — one place writes the level), pause is
     the module's own pause, and the X is a full reset and exit. */
  muteBtn.addEventListener('click', () => {
    if (!mod) return;
    const s = mod.getAudio().settings;
    s.setOn('master', !s.isOn('master'));
    paintControls();
  });
  vol.addEventListener('input', () => {
    if (!mod) return;
    mod.getAudio().settings.set('master', vol.value / 100);
    paintControls();
  });
  pauseBtn.addEventListener('click', () => { ctl?.toggle(); paintControls(); });
  stopBtn.addEventListener('click', () => ctl?.stop());
})();


/* ---------- top picks: the ? and its suggestion popover -------------------
   A full-screen modal was too much for one question and one field, so this
   is a compact popover anchored to the ? — no backdrop, no dialog, no
   modal-sized focus trap. It still owes everything a small surface owes:
   focus moves in on open and back to the ? on every close (Escape, outside
   click, a real scroll), and TYPED VALUES PERSIST — closing only hides the
   panel, so reopening finds the draft; only a successful send resets it.
   Scroll-close waits for >24px of travel so a nudge cannot eat a draft
   either. A single cycler button walks
   Game→Movie→Song→Quote (wrapping), with four aria-hidden dots above it
   as set-size indicators — deliberately NOT controls, because four extra
   tab stops to jump a four-step cycle the button already walks would cost
   more keyboard-wise than they pay. Same Web3Forms relay as the contact
   form (whose code stays untouched), same [Top Picks] subject, same
   payload-side Anon fallback + name_given flag, same honeypot pattern. */
(() => {
  const pop = document.getElementById('pkPop');
  const form = document.getElementById('pkForm');
  const openBtn = document.getElementById('pkSuggestOpen');
  if (!pop || !form || !openBtn) return;

  const status = document.getElementById('pkStatus');
  const send = document.getElementById('pkSend');
  const catBtn = document.getElementById('pkCat');
  const dashes = [...pop.querySelectorAll('.pk-cat-dashes i')];
  const suggestion = document.getElementById('pkSuggestion');
  const fromField = document.getElementById('pkFrom');

  /* Spam, the client-side half (Dex, 2026-08-23). The relay does the real
     filtering - Web3Forms drops a filled honeypot and runs its own scoring,
     and hCaptcha can be switched on there if it ever comes to that. What a
     browser can refuse BEFORE a request exists: three a minute, a dozen a
     day, the same title twice in a day, and junk that cannot be a title (no
     letters, one character run on, a link). All of it is localStorage, so it
     stops the enthusiastic and the accidental, not the determined - that is
     the relay's job, and pretending otherwise would be a false green. */
  const PK_RATE_KEY = 'dex-picks-sends';
  const PK_SEEN_KEY = 'dex-picks-seen';
  const PK_MAX = 3;
  const PK_WINDOW = 60 * 1000;          // three a minute is plenty of enthusiasm
  const PK_DAY_MAX = 12;
  const PK_DAY = 24 * 60 * 60 * 1000;   // stamps are kept this long, so both caps read one list
  const stampsWithin = window_ => {
    try {
      const stamps = JSON.parse(localStorage.getItem(PK_RATE_KEY) || '[]');
      const cutoff = Date.now() - window_;
      return (Array.isArray(stamps) ? stamps : []).filter(t => typeof t === 'number' && t > cutoff);
    } catch { return []; }
  };
  const sends = () => stampsWithin(PK_WINDOW);
  const record = () => {
    try { localStorage.setItem(PK_RATE_KEY, JSON.stringify([...stampsWithin(PK_DAY), Date.now()])); } catch { /* private mode */ }
  };
  // Category + title, folded, seen in the last day. The key is what would
  // land in the mail, so "Halo" and "halo " are the same suggestion.
  const seenKey = (category, title) => `${category}:${title.toLowerCase().replace(/\s+/g, ' ').trim()}`;
  const seen = () => {
    try {
      const list = JSON.parse(localStorage.getItem(PK_SEEN_KEY) || '[]');
      const cutoff = Date.now() - PK_DAY;
      return (Array.isArray(list) ? list : []).filter(x => x && typeof x.t === 'number' && x.t > cutoff);
    } catch { return []; }
  };
  const markSeen = key => {
    try { localStorage.setItem(PK_SEEN_KEY, JSON.stringify([...seen(), { k: key, t: Date.now() }])); } catch { /* private mode */ }
  };
  // What cannot be a title: nothing a language would call a letter, one
  // character six times running, or a link.
  const junk = text => !/\p{L}/u.test(text) || /(.)\1{5,}/u.test(text) || /https?:\/\/|www\./i.test(text);

  // The contact form's setStatus is bound to ITS status element; this is the
  // same two-node pattern against this popover's own line.
  const say = (message, kind = '', lead = '') => {
    if (!status) return;
    status.className = `pk-pop-status${kind ? ' ' + kind : ''}`;
    if (!lead) { status.textContent = message; return; }
    const strong = document.createElement('strong');
    strong.textContent = lead;
    status.replaceChildren(strong, ` ${message}`);
  };

  /* The category cycler: whatever shows is what gets sent — no unselected
     state, nothing to validate. Enter/Space advance it natively (it is a
     real button); the aria-label re-announces the value it landed on. */
  const CATS = ['Game', 'Movie', 'Show', 'Song', 'Toon', 'Quote', 'Pod'];
  // The title field asks a different question per category, so its
  // placeholder (and accessible name) say which one (Dex, 2026-08-23).
  const TITLE_HINT = { Game: 'Game Title', Movie: 'Movie Title', Show: 'Show Title', Song: 'Song Title', Toon: 'Cartoon Title', Quote: 'The Quote', Pod: 'Podcast Name' };
  // The picks tab that is showing when the ? is pressed is the category the
  // visitor means (Dex, 2026-08-23): open on Songs, suggest a song.
  const TAB_CAT = { 'pk-tab-games': 0, 'pk-tab-movies': 1, 'pk-tab-shows': 2, 'pk-tab-songs': 3, 'pk-tab-toons': 4, 'pk-tab-quotes': 5, 'pk-tab-pods': 6 };
  let cat = 0;
  /* The title field is a textarea so a quote can be lines (Dex, 2026-08-23).
     It sits at its rows - one for a title, two for a quote - and grows with
     the text; the CSS max-height is the five-line ceiling, past which it
     scrolls. Typing a multi-line quote into a one-line box was the complaint. */
  const fit = () => {
    suggestion.style.height = '';
    if (suggestion.scrollHeight <= suggestion.clientHeight) return;
    const max = parseFloat(getComputedStyle(suggestion).maxHeight) || Infinity;
    const chrome = suggestion.offsetHeight - suggestion.clientHeight;   // the border, under border-box
    suggestion.style.height = `${Math.min(suggestion.scrollHeight + chrome, max)}px`;
  };
  suggestion.addEventListener('input', fit);
  // Enter sends a title. On a quote Enter is a line break - that is the
  // point of the textarea - and Ctrl/Cmd+Enter sends. The emoji picker owns
  // Enter while it is open: its listener is registered later and inserts.
  suggestion.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    if (pop.querySelector('.emoji-pick.open')) return;
    if (CATS[cat] === 'Quote' && !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    form.requestSubmit();
  });
  const paintCat = () => {
    catBtn.textContent = CATS[cat];
    catBtn.setAttribute('aria-label', `Category: ${CATS[cat]} — press to change`);
    suggestion.placeholder = TITLE_HINT[CATS[cat]];
    suggestion.setAttribute('aria-label', TITLE_HINT[CATS[cat]]);
    suggestion.rows = CATS[cat] === 'Quote' ? 2 : 1;
    fit();
    dashes.forEach((d, i) => d.classList.toggle('on', i === cat));
  };
  catBtn.addEventListener('click', () => { cat = (cat + 1) % CATS.length; paintCat(); });
  paintCat();

  /* open / close: focus in on open, back to the ? on close. Values are NOT
     reset here — the panel only hides, so a draft survives its own closes. */
  let openScrollY = 0;
  const isOpen = () => !pop.hidden;
  const open = () => {
    say('');
    suggestion.classList.remove('invalid');
    const tab = document.querySelector('.pk-tab[aria-selected="true"]');
    if (tab && tab.id in TAB_CAT) { cat = TAB_CAT[tab.id]; paintCat(); }
    pop.hidden = false;
    openScrollY = window.scrollY;
    send.disabled = sends().length >= PK_MAX || stampsWithin(PK_DAY).length >= PK_DAY_MAX;
    if (sends().length >= PK_MAX) say('Three a minute is the cap — give it a moment.', 'error');
    else if (send.disabled) say('That is a dozen today — thank you, really. Tomorrow?', 'error');
    suggestion.focus();
  };
  const close = (refocus = true) => {
    if (!isOpen()) return;
    pop.hidden = true;
    if (refocus) openBtn.focus({ preventScroll: true });
  };
  openBtn.addEventListener('click', () => (isOpen() ? close() : open()));
  document.addEventListener('pointerdown', e => {
    if (isOpen() && !pop.contains(e.target) && !openBtn.contains(e.target)) close(false);
  });
  document.addEventListener('keydown', e => {
    // The emoji picker inside the panel takes the first Escape: it listens on
    // the field, after this capture listener, so this one has to step aside.
    if (e.key === 'Escape' && isOpen() && !pop.querySelector('.emoji-pick.open')) { e.stopPropagation(); close(); }
  }, true);
  // An anchored panel must not drift away from its anchor — but a nudge of a
  // few pixels must not eat a draft, so the close waits for real travel
  // (and the draft survives regardless; see above).
  window.addEventListener('scroll', () => {
    if (isOpen() && Math.abs(window.scrollY - openScrollY) > 24) close(false);
  }, { passive: true });

  form.addEventListener('submit', async event => {
    event.preventDefault();

    // A filled honeypot reports success and sends nothing — a bot told it
    // failed just tries again.
    const trap = form.querySelector('.contact-trap');
    if (trap?.value || document.getElementById('pkBotcheck')?.checked) {
      form.reset();
      cat = 0;
      paintCat();
      say('On the pile.', 'ok', '✓ Sent.');
      setTimeout(() => close(), 1400);
      return;
    }

    const sugg = suggestion.value.trim();
    const suggOk = sugg.length >= 3;
    suggestion.classList.toggle('invalid', !suggOk);
    if (!suggOk) { say('Give me at least a title to chase.', 'error'); suggestion.focus(); return; }
    if (junk(sugg)) {
      suggestion.classList.add('invalid');
      say('That does not look like a title.', 'error'); suggestion.focus(); return;
    }

    if (sends().length >= PK_MAX) {
      say('Three a minute is the cap — give it a moment.', 'error');
      return;
    }
    if (stampsWithin(PK_DAY).length >= PK_DAY_MAX) {
      say('That is a dozen today — thank you, really. Tomorrow?', 'error');
      return;
    }

    /* The Anon fallback happens HERE, in the payload — never as a value in
       the field — and name_given records whether it was typed, so a visitor
       who writes "Anon" and one who leaves the field blank stay
       distinguishable in the mail. */
    const typed = fromField.value.trim();
    const from = typed || 'Anon';
    const category = CATS[cat];
    const key = seenKey(category, sugg);
    if (seen().some(x => x.k === key)) {
      say('That one is already on the pile.', 'ok', '✓');
      return;
    }

    send.disabled = true;
    say('Sending…');

    try {
      const response = await fetch(CONTACT.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          ...(CONTACT.accessKey ? { access_key: CONTACT.accessKey } : {}),
          botcheck: false,
          // The subject is the tell: a picks mail must be distinguishable
          // from a contact message without opening either.
          subject: `[Top Picks] suggestion from ${from}`,
          name: from,
          name_given: Boolean(typed),
          category,
          suggestion: sugg,
          message: `Category: ${category}\n\nSuggestion:\n${sugg}`
        })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      record();
      markSeen(key);
      form.reset();          // the one reset: a SENT draft is done with
      cat = 0;
      paintCat();
      say('On the pile.', 'ok', '✓ Sent.');
      send.disabled = sends().length >= PK_MAX;
      setTimeout(() => close(), 1400);
    } catch {
      send.disabled = false;
      say(`Could not send — email me instead at ${CONTACT.to}.`, 'error');
    }
  });
})();

/* ---------- ":" emoji autocomplete on the message fields --------------------
   Stickland's chat picker (games/stickland/src/chat-picker.js), on the two
   fields people write to me from: the contact MESSAGE and the Top Picks TITLE.
   Same shape as the game's — ":" plus up to 20 letters, a 3-column grid of the
   six best matches over the three most-used, arrows move, Enter/Tab insert,
   Escape closes, click inserts — and the same 1907-emoji dataset, import()ed
   LAZILY from the game's own module on the first ":" so the page never pays
   the 130KB for a field nobody types an emoji into. One source, not a copy:
   games/stickland/src/emoji-data.js is the file, and that game's
   ARCHITECTURE.md records that this page reads it. (Under file:// a dynamic
   import is refused, so the picker is simply absent there.)

   The picker is built INSIDE its host — .contact-panel or .pk-pop — not on
   <body>: the contact form is a <dialog> in the top layer, and nothing
   appended to body can paint over that; a child of the panel can. Escape is
   claimed here first (preventDefault on the keydown stops the dialog's own
   cancel, and the popover's capture listener steps aside while a picker is
   open), so one Escape closes the picker and the next closes the surface.
   Frequency lives under its own key: a game session's most-used never leaks
   into a message, and vice versa. */
(() => {
  const DATA = './games/stickland/src/emoji-data.js';
  const FREQ_KEY = 'dex-emoji-freq';
  const DEFAULTS = ['😂', '❤️', '👍', '😊', '🔥', '😍', '🎉', '✨', '🙏'];
  const HOSTS = [
    ['cfMessage', '.contact-panel'],
    ['pkSuggestion', '.pk-pop']
  ];

  let data = null, loading = null, byUnicode = null;
  const load = () => (loading ??= import(DATA).then(m => {
    data = m.EMOJI_DATA;
    byUnicode = new Map(data.map(e => [e.u, e]));
    return data;
  }).catch(() => { loading = null; return null; }));

  let freq = {};
  try { freq = JSON.parse(localStorage.getItem(FREQ_KEY) || '{}') || {}; } catch { freq = {}; }
  const saveFreq = () => { try { localStorage.setItem(FREQ_KEY, JSON.stringify(freq)); } catch { /* private mode */ } };
  const topFreq = n => Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);

  // Scoring as in the game: exact label > whole word > prefix > word prefix >
  // substring > tag; ties to the shorter label, then emojibase order.
  const search = (query, limit) => {
    if (!query || !data) return [];
    const q = query.toLowerCase();
    const scored = [];
    for (const e of data) {
      const l = e.l;
      let s = 0;
      if (l === q) s = 5;
      else if (l.split(' ').some(w => w === q)) s = 4.5;
      else if (l.startsWith(q)) s = 4;
      else if (l.split(' ').some(w => w.startsWith(q))) s = 3;
      else if (l.includes(q)) s = 2;
      else if (e.t && e.t.some(t => t.startsWith(q))) s = 1;
      if (s > 0) scored.push({ u: e.u, l, s, len: l.length, o: e.o });
    }
    scored.sort((a, b) => b.s - a.s || a.len - b.len || a.o - b.o);
    return scored.slice(0, limit);
  };

  // ":" plus 0-20 letters immediately before the caret, as in the game.
  const colonQuery = field => {
    const pos = field.selectionStart ?? field.value.length;
    const before = field.value.slice(0, pos);
    const idx = before.lastIndexOf(':');
    if (idx === -1) return null;
    const q = before.slice(idx + 1);
    if (!/^[a-zA-Z]{0,20}$/.test(q)) return null;
    return { q, idx, pos };
  };

  HOSTS.forEach(([fieldId, hostSel]) => {
    const field = document.getElementById(fieldId);
    const host = field?.closest(hostSel);
    if (!field || !host) return;

    const pick = document.createElement('div');
    pick.className = 'emoji-pick';
    host.appendChild(pick);
    let active = -1;
    let ctx = null;             // the {idx, pos} the open grid was built for

    const cells = () => [...pick.querySelectorAll('.emoji-cell')];
    const isOpen = () => pick.classList.contains('open');
    const close = () => { pick.classList.remove('open'); active = -1; ctx = null; };

    const insert = emoji => {
      const c = ctx || colonQuery(field);
      if (!c) { close(); return; }
      const v = field.value;
      field.value = v.slice(0, c.idx) + emoji + v.slice(c.pos);
      const at = c.idx + emoji.length;
      field.setSelectionRange(at, at);
      freq[emoji] = (freq[emoji] || 0) + 1;
      saveFreq();
      close();
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.focus();
    };

    const setActive = i => {
      const list = cells();
      if (!list.length) return;
      list[active]?.classList.remove('active');
      active = ((i % list.length) + list.length) % list.length;
      list[active].classList.add('active');
    };

    const render = (results, used) => {
      const grid = document.createElement('div');
      grid.className = 'emoji-grid';
      const pool = results.length ? results : DEFAULTS.map(u => ({ u, l: byUnicode?.get(u)?.l || '' }));
      const main = pool.slice(0, 6);
      main.forEach(r => {
        const cell = document.createElement('button');
        cell.type = 'button'; cell.className = 'emoji-cell';
        cell.textContent = r.u; cell.dataset.emoji = r.u; cell.title = r.l || r.u;
        grid.appendChild(cell);
      });
      const sep = document.createElement('div');
      sep.className = 'emoji-freq-sep';
      grid.appendChild(sep);
      for (let i = 0; i < 3; i++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        if (i < used.length) {
          const em = used[i];
          cell.className = 'emoji-cell emoji-freq-cell';
          cell.dataset.emoji = em; cell.textContent = em; cell.title = byUnicode?.get(em)?.l || em;
          const x = document.createElement('span');
          x.className = 'emoji-freq-x'; x.textContent = '×';
          x.addEventListener('mousedown', ev => { ev.preventDefault(); ev.stopPropagation(); });
          x.addEventListener('click', ev => { ev.stopPropagation(); delete freq[em]; saveFreq(); render(results, topFreq(3)); });
          cell.appendChild(x);
        } else {
          cell.className = 'emoji-cell emoji-freq-cell emoji-freq-empty';
          cell.disabled = true;
        }
        grid.appendChild(cell);
      }
      pick.replaceChildren(grid);
      grid.querySelectorAll('.emoji-cell').forEach(cell => {
        cell.addEventListener('mousedown', ev => ev.preventDefault());   // the field keeps focus
        cell.addEventListener('click', ev => {
          if (ev.target.classList.contains('emoji-freq-x')) return;
          if (cell.dataset.emoji) insert(cell.dataset.emoji);
        });
      });
      active = -1;
      // With nothing typed, start on the first most-used rather than a default.
      setActive(results.length === 0 && used.length > 0 ? main.length : 0);
    };

    const place = () => {
      const f = field.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      const ph = pick.offsetHeight;
      pick.style.left = `${f.left - h.left}px`;
      // Under the field unless that runs off the screen, then above it.
      const fits = f.bottom + 4 + ph <= window.innerHeight - 8;
      pick.style.top = `${fits ? f.bottom - h.top + 4 : f.top - h.top - ph - 4}px`;
    };

    const update = async () => {
      if (!colonQuery(field)) { close(); return; }
      if (!data) { await load(); if (!data) return; }
      const now = colonQuery(field);          // the field may have moved on while the module loaded
      if (!now) { close(); return; }
      const results = now.q ? search(now.q, 9) : [];
      if (now.q && !results.length) { close(); return; }
      ctx = { idx: now.idx, pos: now.pos };
      render(results, topFreq(3));
      pick.classList.add('open');
      place();
    };

    field.addEventListener('input', update);
    field.addEventListener('click', () => { if (isOpen()) update(); });
    field.addEventListener('blur', close);
    field.addEventListener('keydown', e => {
      if (!isOpen()) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter' || e.key === 'Tab') {
        const em = cells()[active]?.dataset.emoji;
        if (em) { e.preventDefault(); insert(em); }
      }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
  });
})();
