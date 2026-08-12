/* ==========================================================================
   Dex Cimino — Portfolio V30
   Theme note: accents only ever set `--accent`. Every tinted graphic is a CSS
   mask painted with background-color, so there are no filter chains to keep in
   sync and no wrong-color flash between themes.
   ========================================================================== */

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

function applyAccent(name, persist = true) {
  const theme = ACCENTS.find(item => item.name === name) || ACCENTS[2];
  currentTheme = theme.name;

  root.style.setProperty('--accent', theme.color);
  root.style.setProperty('--accent-ink', accentInk(theme.color));
  root.dataset.accent = theme.name;

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
function syncHash(id) {
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

function closeModal(dialog) {
  if (!dialog?.open) return;
  dialog.close();                       // the 'close' listener clears the lock
}

function openModal(dialog, panel, onOpen) {
  if (!dialog) return;
  openDialogs.forEach(closeModal);      // never two overlays at once
  document.body.classList.add('modal-open');
  dialog.showModal();
  onOpen?.();
}

// Wire a dialog once: scroll-lock teardown plus backdrop-click-to-close.
function bindModal(dialog, onClose) {
  if (!dialog) return;
  openDialogs.add(dialog);
  dialog.addEventListener('close', () => {
    if (![...openDialogs].some(d => d.open)) document.body.classList.remove('modal-open');
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
const ZOOM_MIN = 0.7, ZOOM_MAX = 1.6, ZOOM_STEP = 0.1;
const resumeModal = document.getElementById('resumeModal');
const resumeScroll = document.getElementById('resumeScroll');
const resumePage = document.getElementById('resumePage');
const zoomLevelEl = document.getElementById('zoomLevel');
const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');

// Desktop opens at a readable 110%; narrow screens start fitted near the
// viewport width. Read from CSS so the two defaults live in one place — the
// inline zoom has to be cleared first or we would just read back the last value
// the user set and reopen at that instead of the default.
function startZoom() {
  resumePage.style.zoom = '';
  return parseFloat(getComputedStyle(resumePage).getPropertyValue('zoom')) || 1.1;
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
let resumeOpener = null;

function applyZoom(next, anchorRatio) {
  const floor = minZoom();
  resumeZoom = Math.min(ZOOM_MAX, Math.max(floor, Math.round(next * 100) / 100));
  resumePage.style.zoom = resumeZoom;
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
  resumeOpener = trigger || document.activeElement;
  openModal(resumeModal, document.querySelector('.resume-shell'), () => {
    resumeScroll.scrollTop = 0;
    // Never open wider than the viewer: horizontal scroll should be something
    // the reader opts into by zooming, not the state they land in.
    applyZoom(Math.min(startZoom(), fitZoom()));
    resumeScroll.focus();
  });
  // pushState so the back button closes the overlay and /#resume is linkable —
  // the one place pushState is right, because it is a real navigation.
  if (location.hash !== '#resume') {
    try { history.pushState({ resume: true }, '', '#resume'); } catch { /* file:// */ }
  }
}

function closeResume() { closeModal(resumeModal); }

if (resumeModal) {
  // Everything that can close the dialog — button, Esc, backdrop, or being
  // displaced by the contact modal — lands here, so the hash is tidied once.
  bindModal(resumeModal, () => {
    resumeOpener?.focus();          // restore focus to the exact trigger
    resumeOpener = null;
    if (location.hash === '#resume') {
      try { history.back(); } catch { /* file:// */ }
    }
  });

  document.getElementById('resumeClose')?.addEventListener('click', () => closeResume());
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
