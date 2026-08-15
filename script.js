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
  if (value) el.setAttribute(attr, value.replace(/mascot_[a-z]+/g, `mascot_${mascot}`));
}

// Bumped per swap. Decodes finish out of order when someone clicks through the
// colours quickly, and without this an earlier, slower decode lands last and
// leaves the previous mascot on screen.
let swapToken = 0;

function swapMascots(theme) {
  const token = ++swapToken;
  const targets = [heroMascot, ...document.querySelectorAll('[data-theme-mascot]')].filter(Boolean);

  const apply = () => token === swapToken && targets.forEach(img => {
    img.closest('picture')?.querySelectorAll('source')
      .forEach(source => retint(source, 'srcset', theme.mascot));
    retint(img, 'src', theme.mascot);        // keep the master fallback in step
  });

  // Decode the widest derivative first so the swap never shows a half-painted
  // frame. decode() rejects on formats the browser can't take — apply anyway,
  // the <picture> negotiation will fall through to WebP or the PNG.
  const warm = new Image();
  warm.src = `assets/derived/mascots/mascot_${theme.mascot}-900.avif`;
  if (warm.decode) warm.decode().then(apply, apply);
  else warm.onload = warm.onerror = apply;
}

// Once the page has painted, pull the other six in during idle time at 600w
// only — enough that a colour click feels instant without competing with LCP.
function warmOtherMascots() {
  const load = () => ACCENTS
    .filter(theme => theme.name !== currentTheme)
    .forEach(theme => { new Image().src = `assets/derived/mascots/mascot_${theme.mascot}-600.avif`; });
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

// Near-black label on a light accent, white on a dark one. #3151F3 only manages
// 3.4:1 against #080a0b but 5.8:1 against white, so the button text has to follow
// the accent rather than being hard-coded.
function accentInk(hex) {
  const channel = i => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  };
  const luminance = .2126 * channel(0) + .7152 * channel(1) + .0722 * channel(2);
  return luminance > .30 ? '#080a0b' : '#ffffff';
}

const faviconSvg = document.getElementById('faviconSvg');

function applyAccent(name, persist = true) {
  const theme = ACCENTS.find(item => item.name === name) || ACCENTS[2];
  currentTheme = theme.name;

  root.style.setProperty('--accent', theme.color);
  root.style.setProperty('--accent-ink', accentInk(theme.color));
  root.dataset.accent = theme.name;

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

function setOpen(open) {
  if (!picker) return;
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
  // While docked and closed, the active hex is a disclosure toggle, not a re-pick.
  if (isDocked() && !picker.classList.contains('open') && button.classList.contains('active')) {
    setOpen(true);
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
  picker.style.setProperty('--rows', String(ACCENTS.length - 1));

  let stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch { /* private mode */ }
  applyAccent(stored || DEFAULT_ACCENT, false);

  // Pointer: hover opens on real pointers, tap-to-toggle handles touch.
  picker.addEventListener('pointerenter', () => { if (isDocked() && canHover.matches) setOpen(true); });
  picker.addEventListener('pointerleave', () => { if (isDocked() && canHover.matches) setOpen(false); });

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

    if (event.key === nextKey) { event.preventDefault(); moveFocus(target, 1); }
    else if (event.key === prevKey) { event.preventDefault(); moveFocus(target, -1); }
    else if (event.key === 'Escape' && isDocked()) {
      setOpen(false);
      swatches.find(b => b.classList.contains('active'))?.focus();
    }
  });

  // Outside tap closes the docked stack.
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

function openModal(dialog, panel, onOpen, opener) {
  if (!dialog) return;
  // Read the trigger before closing anything: closing a dialog synchronously
  // hands focus back to *its* opener, so activeElement would name the wrong one.
  const trigger = opener || document.activeElement;
  openDialogs.forEach(closeModal);      // never two overlays at once
  openerFor.set(dialog, trigger);
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
    if ([...openDialogs].some(d => d.open)) return;
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
  'tab-resume': { file: 'Dex_Cimino_Resume.pdf', label: 'Download Dex Cimino resume as PDF' },
  'tab-cover':  { file: 'Dex_Cimino_Cover.pdf',  label: 'Download Dex Cimino cover letter as PDF' },
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
  const doc = DOCS[id];
  if (doc && pdfLink) {
    pdfLink.href = `assets/about/${doc.file}`;
    pdfLink.setAttribute('download', doc.file);
    pdfLink.setAttribute('aria-label', doc.label);
  }
  resumeScroll.scrollTop = 0;                      // different document, start at the top
  resumeScroll.scrollLeft = 0;
}

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

initTabs(document.querySelector('.tk-tabs'));
initTabs(document.querySelector('.pk-tabs'));
initTabs(document.querySelector('.ai-tabs'));

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
  const loopBtn = $('playerLoop'), scrub = $('playerScrub'), vol = $('playerVol');
  const elapsed = $('playerElapsed'), total = $('playerDuration');
  const muteBtn = $('playerMute'), stopBtn = $('playerStop');

  let index = -1, loop = 'off', scrubbing = false, lastVolume = 0.4;

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
  paint();
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

  function show(row) {
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

    const name = (row.querySelector('strong') || {}).textContent || 'this game';
    art.setAttribute('aria-label', `Open ${name}`);
    art.removeAttribute('aria-hidden');
  }

  for (const row of rows) {
    row.addEventListener('pointerenter', () => show(row));
    row.addEventListener('focus', () => show(row));
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
  if (first) show(first);
})();
