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
  warm.src = `assets/derived/mascot_${theme.mascot}-900.avif`;
  if (warm.decode) warm.decode().then(apply, apply);
  else warm.onload = warm.onerror = apply;
}

// Once the page has painted, pull the other six in during idle time at 600w
// only — enough that a colour click feels instant without competing with LCP.
function warmOtherMascots() {
  const load = () => ACCENTS
    .filter(theme => theme.name !== currentTheme)
    .forEach(theme => { new Image().src = `assets/derived/mascot_${theme.mascot}-600.avif`; });
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

const sections = ['home', 'work', 'games', 'ai', 'about', 'resume']
  .map(id => document.getElementById(id))
  .filter(Boolean);

function setActiveSection(id) {
  navLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${id}`));
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
  window.scrollTo({ top:0, behavior:'smooth' });
  setActiveSection('home');
}));

navLinks.forEach(link => link.addEventListener('click', () => {
  const id = link.getAttribute('href')?.slice(1);
  if (id && id !== 'home') setActiveSection(id);
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
  endpoint: '',
  accessKey: '',
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

function setStatus(message, kind = '') {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = `contact-status${kind ? ' ' + kind : ''}`;
}

function openContact() {
  if (!modal) return;
  setStatus('');
  contactForm?.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));
  document.body.classList.add('modal-open');
  modal.showModal();
  if (recentSends().length >= CONTACT.maxSends) {
    setStatus(`You have already sent ${CONTACT.maxSends} messages. Try again in about ${cooldownMinutes()} minutes.`, 'error');
    if (sendBtn) sendBtn.disabled = true;
  } else if (sendBtn) {
    sendBtn.disabled = false;
  }
  document.getElementById('cfName')?.focus();
}

function closeContact() {
  document.body.classList.remove('modal-open');
  modal?.close();
}

if (modal) {
  // Any mailto link becomes the trigger; the href stays as the no-JS fallback.
  document.querySelectorAll('a[href^="mailto:"]').forEach(link => {
    link.addEventListener('click', event => { event.preventDefault(); openContact(); });
  });

  document.getElementById('contactClose')?.addEventListener('click', closeContact);
  document.getElementById('contactCancel')?.addEventListener('click', closeContact);
  // Esc is handled by <dialog>; this keeps body scroll-lock in sync.
  modal.addEventListener('close', () => document.body.classList.remove('modal-open'));
  // Clicking the backdrop: the dialog box fills the whole viewport, so compare
  // the pointer against the panel's own rect rather than the event target.
  modal.addEventListener('click', event => {
    const panel = contactForm?.getBoundingClientRect();
    if (!panel) return;
    const outside = event.clientX < panel.left || event.clientX > panel.right ||
                    event.clientY < panel.top  || event.clientY > panel.bottom;
    if (outside) closeContact();
  });
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
    setStatus('Sent — thanks. I will get back to you soon.', 'ok');
    if (recentSends().length >= CONTACT.maxSends) setStatus(`Sent — thanks. That is ${CONTACT.maxSends} for now; the form reopens in about ${cooldownMinutes()} minutes.`, 'ok');
    else sendBtn.disabled = false;
  } catch {
    sendBtn.disabled = false;
    setStatus(`Could not send. Email me directly at ${CONTACT.to}.`, 'error');
  }
});
