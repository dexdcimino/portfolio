/* Arena 1 pause menu — ported from Chomp's (games/chomp/js/pausemenu.js), the
   proven site-integration precedent. Sections: accent picker, controls
   reference, quality, PvP (match-start flag), volume + mute.

   Wiring contract (do not change): main.js owns the state machine AND Escape.
   This module binds NO keys — it only fills the #paused overlay that
   setState('paused') shows and hides, and Resume goes through
   window.Arena1.resume(). Quality changes are handed to main via the
   'arena1-quality' event (main owns the engine).

   Self-contained: injects its own styles, edits nothing else. */

import { setVolume, getVolume, setMuted, isMuted } from './systems/audio.js';

/* The site's seven accents, byte-identical to ACCENTS in the site's script.js
   (verified against script.js:51-59 at build time). The duplication is
   deliberate and documented there: the game must not reach into the parent
   document, and the palette changes rarely. */
const SITE_ACCENTS = [
  { name: 'red',    hex: '#D94727' },
  { name: 'yellow', hex: '#FAAA1E' },
  { name: 'lime',   hex: '#9EE02B' },
  { name: 'cyan',   hex: '#2CC7F6' },
  { name: 'blue',   hex: '#335DF3' },
  { name: 'purple', hex: '#A85CF5' },
  { name: 'white',  hex: '#E9EBEC' },
];
// The site's own key. Same-origin (the wrapper loads the game from
// /games/arena1/, a root-relative path), so one localStorage is shared and
// the choice made here carries back to dexcimino.com with no postMessage.
const SITE_ACCENT_KEY = 'dex-accent-name';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/* Relative luminance, sRGB — same maths as Stickland's/Chomp's. Above ~0.5
   the accent is a light colour and dark ink reads on it; below, white. */
function inkFor(hex) {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 0.5 ? '#0b0d12' : '#ffffff';
}

function currentAccent() {
  const hit = SITE_ACCENTS.find((a) => a.name === store.get(SITE_ACCENT_KEY));
  return hit || SITE_ACCENTS[2]; // lime, the site default
}

function applyAccent(a, persist = true) {
  document.documentElement.style.setProperty('--cmenu-accent', a.hex);
  document.documentElement.style.setProperty('--cmenu-ink', inkFor(a.hex));
  if (persist) store.set(SITE_ACCENT_KEY, a.name);
  for (const b of document.querySelectorAll('.cmenu-swatch')) {
    b.classList.toggle('is-on', b.dataset.name === a.name);
  }
}

const CONTROLS = [
  ['Move', ['W', 'A', 'S', 'D'], ''],
  ['Jump / mid-air jet', ['Space'], 'hold to burn'],
  ['Dash', ['Shift'], '×2 charges'],
  ['Slide', ['C', 'Ctrl'], ''],
  ['Zap', ['LMB'], ''],
  ['Grapple', ['RMB'], 'hold to reel'],
  ['Pause', ['Esc'], ''],
];

const CSS = `
/* pointer-events: the game's #hud is pointer-events:none so the canvas gets
   clicks — the overlay reclaims events for itself and everything in it
   (Chomp's lesson, kept). */
#paused{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;
  padding:18px;pointer-events:auto;background:rgba(13,17,22,.55)}
#paused.hidden{display:none}
.cmenu{
  width:min(460px,92vw);max-height:min(86vh,660px);overflow:auto;
  background:rgba(23,13,43,.96);border:1px solid rgba(242,214,162,.22);
  border-radius:16px;padding:22px 22px 18px;
  color:#F2D6A2;font-family:"Cascadia Mono","JetBrains Mono",Consolas,monospace;text-align:left;
  box-shadow:0 18px 60px rgba(0,0,0,.6);
}
.cmenu h1{margin:0 0 16px;font-size:24px;letter-spacing:.2em;font-weight:400}
.cmenu h2{margin:18px 0 10px;font-size:11px;font-weight:800;letter-spacing:.22em;
  color:#a8916b;text-transform:uppercase;border-bottom:1px solid rgba(242,214,162,.14);padding-bottom:6px}
.cmenu-swatches{display:flex;gap:10px;justify-content:center}
.cmenu-swatch{width:30px;height:30px;border-radius:50%;cursor:pointer;padding:0;
  border:2px solid rgba(255,255,255,.18);transition:transform .15s ease,border-color .15s ease}
.cmenu-swatch:hover{transform:scale(1.12)}
.cmenu-swatch.is-on{border-color:#fff;box-shadow:0 0 0 2px var(--cmenu-accent,#9EE02B)}
.cmenu-tag{width:100%;height:34px;padding:0 10px;border-radius:8px;font-family:inherit;
  font-size:13px;letter-spacing:.08em;color:#F2D6A2;background:#2b1b45;
  border:2px solid #4A2B63;outline:none}
.cmenu-tag:focus{border-color:var(--cmenu-accent,#9EE02B)}
.cmenu-rows{display:grid;gap:8px}
.cmenu-row{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px}
.cmenu-keys{display:flex;gap:4px;align-items:center}
.cmenu-key{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:22px;
  padding:0 7px;font-size:11px;font-weight:600;color:#F2D6A2;background:#2b1b45;
  border:2px solid #4A2B63;border-radius:6px;white-space:nowrap}
.cmenu-alt{color:#a8916b;font-size:11px;margin-left:6px}
.cmenu-seg{display:flex;gap:8px}
.cmenu-seg button{flex:1;height:32px;border-radius:8px;cursor:pointer;font-size:11px;font-weight:800;
  letter-spacing:.1em;border:2px solid #4A2B63;background:#2b1b45;color:#F2D6A2;
  transition:background .15s ease,border-color .15s ease,color .15s ease}
.cmenu-seg button.is-on{background:var(--cmenu-accent,#9EE02B);border-color:var(--cmenu-accent,#9EE02B);color:var(--cmenu-ink,#0b0d12)}
.cmenu-note{font-size:10px;letter-spacing:.06em;color:#a8916b;margin-top:6px}
.cmenu-audio{display:flex;align-items:center;gap:12px}
.cmenu-audio input[type=range]{flex:1;accent-color:var(--cmenu-accent,#9EE02B)}
.cmenu-mute{min-width:64px;height:28px;border-radius:14px;cursor:pointer;font-size:11px;font-weight:800;
  letter-spacing:.08em;border:2px solid #4A2B63;background:#2b1b45;color:#F2D6A2;
  transition:background .15s ease,color .15s ease,border-color .15s ease}
.cmenu-mute.is-muted{background:var(--cmenu-accent,#9EE02B);border-color:var(--cmenu-accent,#9EE02B);color:var(--cmenu-ink,#0b0d12)}
.cmenu-foot{display:flex;justify-content:space-between;gap:12px;margin-top:20px}
.cmenu-btn{min-height:42px;padding:0 20px;border-radius:10px;cursor:pointer;font-weight:800;
  letter-spacing:.06em;font-size:13px;border:2px solid rgba(242,214,162,.3);background:transparent;color:#F2D6A2;
  transition:border-color .15s ease,background .15s ease;font-family:inherit}
.cmenu-btn:hover{border-color:rgba(242,214,162,.6)}
/* Exit left, Resume right — the standing order from Stickland's menu. Resume
   wears the accent, its ink flipped dark/light by the same luminance rule. */
.cmenu-resume{background:var(--cmenu-accent,#9EE02B);border-color:var(--cmenu-accent,#9EE02B);color:var(--cmenu-ink,#0b0d12)}
.cmenu-resume:hover{filter:brightness(1.08)}
`;

function build() {
  const host = document.getElementById('paused');
  if (!host) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const menu = document.createElement('div');
  menu.className = 'cmenu';
  menu.innerHTML = `
    <h1>PAUSED</h1>
    <h2>Accent</h2>
    <div class="cmenu-swatches"></div>
    <h2>Player Tag</h2>
    <input class="cmenu-tag" type="text" maxlength="16" spellcheck="false"
           placeholder="shown above you in multiplayer" aria-label="Player tag">
    <h2>Controls</h2>
    <div class="cmenu-rows"></div>
    <h2>Quality</h2>
    <div class="cmenu-seg cmenu-qual">
      <button type="button" data-q="0">LOW</button>
      <button type="button" data-q="1">MED</button>
      <button type="button" data-q="2">HIGH</button>
    </div>
    <h2>Versus</h2>
    <div class="cmenu-seg cmenu-pvp">
      <button type="button" data-pvp="1">PVP ON</button>
      <button type="button" data-pvp="0">PVP OFF</button>
    </div>
    <div class="cmenu-note">applies when the next match starts — never mid-match</div>
    <h2>Audio</h2>
    <div class="cmenu-audio">
      <button class="cmenu-mute" type="button"></button>
      <input class="cmenu-vol" type="range" min="0" max="1" step="0.01" aria-label="Master volume">
    </div>
    <div class="cmenu-foot">
      <button class="cmenu-btn cmenu-exit" type="button">EXIT GAME</button>
      <button class="cmenu-btn cmenu-resume" type="button">RESUME</button>
    </div>`;
  host.replaceChildren(menu);

  const swatches = menu.querySelector('.cmenu-swatches');
  for (const a of SITE_ACCENTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cmenu-swatch';
    b.dataset.name = a.name;
    b.style.background = a.hex;
    b.setAttribute('aria-label', `Accent ${a.name}`);
    b.addEventListener('click', () => applyAccent(a));
    swatches.appendChild(b);
  }
  applyAccent(currentAccent(), false);

  // Player tag: persisted under arena1-tag; the transport listens for the
  // event and announces the change to the room. Typing must not leak into the
  // game's global key handlers (WASD state, Escape-resume) — stop keys at
  // the input.
  const tagInput = menu.querySelector('.cmenu-tag');
  tagInput.value = store.get('arena1-tag') || '';
  tagInput.addEventListener('input', () => {
    const v = tagInput.value.slice(0, 16);
    store.set('arena1-tag', v);
    window.dispatchEvent(new CustomEvent('arena1-tag', { detail: v }));
  });
  tagInput.addEventListener('keydown', (e) => e.stopPropagation());
  tagInput.addEventListener('keyup', (e) => e.stopPropagation());

  const rows = menu.querySelector('.cmenu-rows');
  for (const [label, keyList, alt] of CONTROLS) {
    const row = document.createElement('div');
    row.className = 'cmenu-row';
    const keySpans = keyList.map((k) => `<kbd class="cmenu-key">${k}</kbd>`).join('');
    row.innerHTML = `<span>${label}</span><span class="cmenu-keys">${keySpans}${alt ? `<span class="cmenu-alt">${alt}</span>` : ''}</span>`;
    rows.appendChild(row);
  }

  // Quality: main owns the engine; hand the choice over by event + persist it.
  const qualBtns = [...menu.querySelectorAll('.cmenu-qual button')];
  const paintQual = () => {
    const q = store.get('arena1-quality') ?? '1';
    qualBtns.forEach((b) => b.classList.toggle('is-on', b.dataset.q === q));
  };
  for (const b of qualBtns) {
    b.addEventListener('click', () => {
      store.set('arena1-quality', b.dataset.q);
      window.dispatchEvent(new CustomEvent('arena1-quality', { detail: Number(b.dataset.q) }));
      paintQual();
    });
  }
  window.addEventListener('arena1-quality-sync', paintQual); // 1/2/3 keys mirror back
  paintQual();

  // PvP: writes the flag the NEXT createSim reads (match start), never the
  // live sim — the spec's "not mid-match" rule made structural.
  const pvpBtns = [...menu.querySelectorAll('.cmenu-pvp button')];
  const paintPvp = () => {
    const v = store.get('arena1-pvp') ?? '1'; // PVP_DEFAULT: true
    pvpBtns.forEach((b) => b.classList.toggle('is-on', b.dataset.pvp === v));
  };
  for (const b of pvpBtns) {
    b.addEventListener('click', () => { store.set('arena1-pvp', b.dataset.pvp); paintPvp(); });
  }
  paintPvp();

  const vol = menu.querySelector('.cmenu-vol');
  const mute = menu.querySelector('.cmenu-mute');
  // audio.js persists arena1-volume / arena1-muted itself; this UI only reads
  // and writes the live API. Muted shows the slider at 0 but the stored level
  // survives underneath, so unmuting restores it rather than resetting.
  const paint = () => {
    const m = isMuted();
    vol.value = m ? 0 : getVolume();
    mute.textContent = m ? 'MUTED' : 'MUTE';
    mute.classList.toggle('is-muted', m);
    mute.setAttribute('aria-pressed', String(m));
  };
  vol.addEventListener('input', () => {
    if (isMuted()) setMuted(false);         // touching the fader is intent to hear
    setVolume(parseFloat(vol.value));
    paint();
  });
  mute.addEventListener('click', () => { setMuted(!isMuted()); paint(); });
  paint();

  menu.querySelector('.cmenu-resume').addEventListener('click', () => {
    window.Arena1?.resume?.();
  });
  menu.querySelector('.cmenu-exit').addEventListener('click', () => {
    window.location.href = '/';
  });
  // Clicking the dimmed area OUTSIDE the panel resumes — the same contract as
  // the site's dialogs (backdrop click closes). Clicks inside stay inside.
  host.addEventListener('click', (e) => {
    if (e.target === host) window.Arena1?.resume?.();
  });
}

build();
