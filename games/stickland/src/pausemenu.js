// ══════════════════════════════════════════════════════
//  ESC pause menu — controls, audio, theme, exit
// ══════════════════════════════════════════════════════
//  Replaces the old notes-app exit-confirm dialog. playmode.js opens/closes
//  this from its Escape ladder (topmost-thing-first order is preserved
//  there); this module never binds Escape itself.
//
//  Pause semantics: input paused, world keeps ticking — the same contract
//  the cosmetics panel uses (window._dexPausePlayInput). The RAF loop never
//  stops, so there is no accumulated-_dt spike to clamp on resume; creatures
//  and projectiles behind the backdrop stay live, exactly like the
//  cosmetics panel precedent.
//
//  No playmode import (playmode imports us — a static cycle would break the
//  build). Everything playmode-owned arrives through initPauseMenu(hooks).

import { sfx, setVolume, getVolume, setMuted, isMuted, setBusVolume, getBusVolume } from './audio.js';
import { nextTrack, prevTrack, toggleMusic, onMusicChange } from './music.js';
import { safeStorage } from './storage.js';
import { createResetProgress } from './reset-progress.js';

// ── Exit destination ────────────────────────────────────
// '/' → the portfolio homepage (MD 12): relative on purpose, so it's right
// on the production domain, Vercel previews, or anywhere else same-origin.
// The window.close()/endcard fallback below stays for the '' case — the
// correct behavior when index.html runs standalone from disk or a bare tab.
const EXIT_URL = '/';

const ACCENT_LS_KEY = 'sfg-accent';           // sfg- prefix like world/cosmetics/audio
const KEYBINDS_LS_KEY = 'dexnote-keybinds';   // existing key — extend, don't fork
const FX_LS_KEY = 'sfg-fx';                   // {shake: 0..1} — playmode reads window._dexShakeScale

// The portfolio's seven accents, names included. Restricted to these on
// purpose: picking one writes the SITE's key so the choice carries back to
// dexcimino.com, which is only meaningful for colours the site can name.
// Kept byte-identical to ACCENTS in the site's script.js.
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
// /games/stickland/v1/, a root-relative path), so one localStorage is shared
// and no postMessage bridge is needed.
const SITE_ACCENT_KEY = 'dex-accent-name';

// Grouped key-cap clusters rather than a long list — six labelled groups read
// as a reference card. `bind` marks the one rebindable action (camera lock);
// everything else is a hardcoded comparison and shows as fixed.
const CONTROL_GROUPS = [
  { title: 'Move',  rows: [ { keys: ['W','A','S','D'] }, { keys: ['\u2190','\u2191','\u2193','\u2192'] } ] },
  { title: 'Jump', inline: true, rows: [ { keys: ['Space'], note: 'tap, hold to charge, again mid-air' } ] },
  // Inline: the title is the label and the cap sits beside it, so Sprint lines
  // up under Move and Crouch under Jump.
  { title: 'Sprint', inline: true, rows: [ { keys: ['Shift'] } ] },
  { title: 'Crouch', inline: true, rows: [ { keys: ['C'] } ] },
  { title: 'Equip', rows: [ { keys: ['1','2','3','4'], note: 'slots' },
                            { keys: ['H'], note: 'holster' }, { keys: ['E'], note: 'interact' } ] },
  { title: 'Menus', rows: [ { keys: ['B'], note: 'bag' }, { keys: ['G'], note: 'cosmetics' },
                            { keys: ['T'], note: 'chat' } ] },
  { title: 'View',  rows: [ { keys: ['Scroll Wheel'], note: 'zoom' } ] },
  { title: 'Game',  rows: [ { keys: ['Esc'], note: 'settings' } ] },
];

let _hooks = { exitWorld: null, restart: null, getKeybind: null, setKeybind: null, getCameraLock: null, setCameraLock: null };
let _open = false;
let _menuEl = null, _backdropEl = null, _endcardEl = null;
let _openSection = 'general';   // General is expanded on open
let _rebindArmed = null;   // action name while listening for a new key

export function isPauseMenuOpen() { return _open; }

// ── Persisted accent ────────────────────────────────────
// The host page owns --accent by default; a choice made in this menu
// overrides it and survives reload. accent.js watches the property and
// republishes into --clr/--clr-adj, so applying is one line.
function _normalizeHex(v) {
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) s = s.split('').map(c => c + c).join('');
  return /^[0-9a-fA-F]{6}$/.test(s) ? '#' + s.toLowerCase() : null;
}
/* Relative luminance, sRGB. Above ~0.5 the track is a light colour and the
   knob has to go dark; below it, the reverse. Recomputed on every accent
   change so the switches stay legible across the whole palette. */
function _knobFor(hex) {
  const h = String(hex).replace('#', '');
  if (h.length !== 6) return '#e8ecef';
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin(parseInt(h.slice(0, 2), 16))
          + 0.7152 * lin(parseInt(h.slice(2, 4), 16))
          + 0.0722 * lin(parseInt(h.slice(4, 6), 16));
  return L > 0.42 ? '#12161b' : '#e8ecef';
}

function _applyAccent(hex, persist) {
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--sw-knob', _knobFor(hex));
  // Resume is filled with the accent, so its label needs the same treatment as
  // the switch knobs: dark on light accents, light on dark ones.
  document.documentElement.style.setProperty('--on-accent', _knobFor(hex));
  if (persist) safeStorage.setItem(ACCENT_LS_KEY, hex);
}
function _currentAccent() {
  // Falls back to lime — the site's DEFAULT_ACCENT.
  return _normalizeHex(getComputedStyle(document.documentElement).getPropertyValue('--accent')) || SITE_ACCENTS[2].hex;
}

// ── Persisted FX settings ───────────────────────────────
// blood: false (default) recolors gore to the accent and silences gore
// audio — the recolor-not-remove pattern _bloodClr()/_bloodColor() have
// always implemented; this is just the switch and the flipped default.
let _fxSettings = { shake: 1, blood: false };
try {
  const s = JSON.parse(safeStorage.getItem(FX_LS_KEY) || 'null');
  if (s && typeof s.shake === 'number' && s.shake >= 0 && s.shake <= 1) _fxSettings.shake = s.shake;
  if (s && typeof s.blood === 'boolean') _fxSettings.blood = s.blood;
} catch (e) {}
function _applyFx() {
  window._dexShakeScale = _fxSettings.shake;
  window._dexBloodEnabled = _fxSettings.blood;
  try { safeStorage.setItem(FX_LS_KEY, JSON.stringify(_fxSettings)); } catch (e) {}
}

/** Called once from initPlayMode. Applies the persisted accent + FX at boot. */
export function initPauseMenu(hooks) {
  _hooks = Object.assign(_hooks, hooks || {});
  // The site's key wins at boot. Reading only the game's own key meant a
  // change made on dexcimino.com never reached the game — the accent carried
  // out but not back in. Picking in-game writes both, so this stays correct in
  // that direction too. Falls back to the site's default rather than the old
  // built-in green, which sat outside the seven the picker offers.
  let boot = null;
  try {
    const name = safeStorage.getItem(SITE_ACCENT_KEY);
    const hit = SITE_ACCENTS.find(a => a.name === name);
    if (hit) boot = hit.hex;
  } catch (e) {}
  if (!boot) boot = _normalizeHex(safeStorage.getItem(ACCENT_LS_KEY));
  _applyAccent(boot || SITE_ACCENTS[2].hex, false);
  window._dexShakeScale = _fxSettings.shake;
  window._dexBloodEnabled = _fxSettings.blood;
}

// ── Open / close ────────────────────────────────────────
/* A programmatic handle, the same pattern audio.js already uses for the mixer:
   the menu is guarded by a key ladder in playmode.js (chat, inventory and the
   cosmetics panel all take Escape first), which automation cannot reliably
   reproduce. This opens the real menu through the real function — nothing is
   mocked — and is how the track picker is tested. */
try {
  window._dexPauseMenu = {
    open: () => openPauseMenu(), close: () => closePauseMenu(), isOpen: () => isPauseMenuOpen(),
  };
} catch (e) {}

export function openPauseMenu() {
  if (_open) return;
  _open = true;
  _ensureDom();
  _renderTab();
  _backdropEl.style.display = '';
  _menuEl.style.display = '';
  requestAnimationFrame(() => { _backdropEl.classList.add('open'); _menuEl.classList.add('open'); });
  window._dexPausePlayInput?.(true);
  window._dexClearKeys?.();
  window.addEventListener('keydown', _captureKey, true);
  window.addEventListener('keyup', _captureKey, true);
  sfx('ui.open');
}

export function closePauseMenu() {
  if (!_open) return;
  _open = false;
  _rebindArmed = null;
  window.removeEventListener('keydown', _captureKey, true);
  window.removeEventListener('keyup', _captureKey, true);
  if (_menuEl) {
    _backdropEl.classList.remove('open');
    _menuEl.classList.remove('open');
    setTimeout(() => {
      if (!_open) { _menuEl.style.display = 'none'; _backdropEl.style.display = 'none'; }
    }, 200);
  }
  _hideEndcard();
  window._dexPausePlayInput?.(false);
  window._dexClearKeys?.();
  sfx('ui.close');
}

// While the menu is open, game key handlers must not fire (no hotbar
// switching, no chat opening, no camera toggle). Escape is deliberately
// left alone — playmode's ladder owns it (fullscreen/F11 handling included).
// Keys targeted inside the menu (the hex input) rely on default behaviour,
// which stopPropagation doesn't touch.
function _captureKey(e) {
  if (!_open) return;
  if (e.key === 'Escape') return;
  // Keys aimed at the menu's own fields (hex input, buttons) pass through
  // untouched — their target-phase listeners and default behaviour need the
  // event. Game handlers already ignore input-focused keys.
  if (_menuEl.contains(e.target)) return;
  if (e.type === 'keydown') {
    if (_rebindArmed) { _finishRebind(e); e.preventDefault(); e.stopPropagation(); return; }
  }
  e.stopPropagation();
}

// ── DOM ─────────────────────────────────────────────────
function _ensureDom() {
  if (_menuEl) return;

  _backdropEl = document.createElement('div');
  _backdropEl.id = 'pmenu-backdrop';
  _backdropEl.addEventListener('mousedown', (e) => { e.stopPropagation(); closePauseMenu(); });
  document.body.appendChild(_backdropEl);

  _menuEl = document.createElement('div');
  _menuEl.id = 'pmenu';
  _menuEl.addEventListener('mousedown', (e) => e.stopPropagation());
  const _sec = (id, label) => `
    <section class="pmenu-sec" data-sec="${id}">
      <button class="pmenu-sec-head" type="button" data-toggle="${id}" aria-expanded="false">
        <span class="pmenu-sec-label">${label}</span>
        <span class="pmenu-chev" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
               stroke-linecap="round" stroke-linejoin="round"><polyline points="6,15 12,9 18,15"/></svg>
        </span>
      </button>
      <div class="pmenu-sec-body"></div>
    </section>`;
  _menuEl.innerHTML = `
    <div class="pmenu-title">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3.2"/>
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.09A1.7 1.7 0 0 0 10 3v-.09a2 2 0 1 1 4 0V3a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"/>
      </svg>
      <span>Settings</span>
    </div>
    <div class="pmenu-scroll">
      ${_sec('general', 'General')}
      ${_sec('audio', 'Audio')}
      ${_sec('controls', 'Controls')}
    </div>
    <div class="pmenu-footer">
      <button class="pmenu-btn" data-act="exit" type="button">Exit game</button>
      <button class="pmenu-btn pmenu-btn-icon" data-act="respawn" type="button"
              aria-label="Respawn" title="Respawn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>
      <button class="pmenu-btn pmenu-btn-accent" data-act="resume" type="button">Resume</button>
    </div>`;
  /* Reset, at the very bottom and behind a rule — see src/reset-progress.js
     (a mirror of games/_shared/reset-progress.js; its header says why).

     WHAT GOES, and the reasoning matters more than the list:
       `sfg-plat`  — {bestH}, the best climb in metres. The one number this
                     game persists that a player actually earned.
       `sfg-world` — today this is only a CACHE of generateWorld() output, which
                     is deterministic and which nothing in play mutates (see the
                     note in storage.js), so clearing it regenerates an identical
                     world. It is listed anyway because it is the file any future
                     world editing would land in, and a reset that quietly
                     skipped the world would stop being a reset the day that
                     shipped.

     WHAT SURVIVES, because none of it was earned: `sfg-audio` (volume, mute),
     `sfg-accent` and `dex-accent-name`, `sfg-fx` (screen shake), `stickland-track`
     (track choice), `dexnote-keybinds`, `dexnote-play-camera` (camera mode),
     `sfg-cosmetics` and `dexnote-hotbar` — the last two are freely chosen, not
     unlocked, so they are wardrobe and loadout rather than progress. */
  _menuEl.appendChild(createResetProgress({
    keys: ['sfg-plat', 'sfg-world'],
    describe() {
      const st = JSON.parse(safeStorage.getItem('sfg-plat') || 'null');
      const best = st && typeof st.bestH === 'number' ? st.bestH : 0;
      return best > 0 ? `best climb ${best}m` : null;
    },
  }));

  document.body.appendChild(_menuEl);

  _menuEl.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => _toggleSection(btn.dataset.toggle));
  });
  _menuEl.querySelector('[data-act="resume"]').addEventListener('click', closePauseMenu);
  _menuEl.querySelector('[data-act="exit"]').addEventListener('click', _exitGame);
  // Restart belongs to playmode — it owns HP, the spawn point and the death
  // screen — so this only calls the hook and gets out of the way. Closing after
  // is the point: you press it to be back in the world, not to admire the menu.
  // The menu is shared with the platformer, and the hook handles that: from
  // there a restart returns you to the open world at the base.
  _menuEl.querySelector('[data-act="respawn"]').addEventListener('click', () => {
    _hooks.restart?.();
    closePauseMenu();
  });
}

function _toggleSection(id) {
  // One open at a time, and never zero: re-clicking the open one keeps it open
  // rather than leaving the panel empty inside a fixed frame.
  if (_openSection === id) return;
  _openSection = id;
  _rebindArmed = null;
  sfx('ui.slot');
  _renderTab();
}

/* The frame is a fixed size, so sections expand and collapse INSIDE it and the
   scroll container absorbs the difference. Nothing here changes the outer box. */
function _renderTab() {
  for (const sec of _menuEl.querySelectorAll('.pmenu-sec')) {
    const id = sec.dataset.sec;
    const on = id === _openSection;
    sec.classList.toggle('open', on);
    sec.querySelector('.pmenu-sec-head').setAttribute('aria-expanded', String(on));
    const body = sec.querySelector('.pmenu-sec-body');
    body.innerHTML = '';
    if (!on) continue;
    if (id === 'general') _renderGeneral(body);
    else if (id === 'audio') _renderAudio(body);
    else _renderControls(body);
  }
}

/* ── shared DexNote-style controls ─────────────────────── */
function _toggle(on, onchange) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pmenu-sw' + (on ? ' on' : '');
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', String(!!on));
  b.innerHTML = '<span class="pmenu-sw-knob"></span>';
  b.addEventListener('click', () => {
    const next = !b.classList.contains('on');
    b.classList.toggle('on', next);
    b.setAttribute('aria-checked', String(next));
    onchange(next);
    sfx('ui.open');
  });
  return b;
}

function _switchRow(label, on, onchange, iconPath) {
  const row = document.createElement('div');
  row.className = 'pmenu-swrow';
  const ic = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ic.setAttribute('viewBox', '0 0 24 24');
  ic.setAttribute('class', 'pmenu-swicon');
  ic.setAttribute('fill', 'none');
  ic.setAttribute('stroke', 'currentColor');
  ic.setAttribute('stroke-width', '1.8');
  ic.setAttribute('stroke-linecap', 'round');
  ic.setAttribute('stroke-linejoin', 'round');
  ic.innerHTML = iconPath;
  const lab = document.createElement('span');
  lab.className = 'pmenu-swlabel';
  lab.textContent = label;
  row.appendChild(ic);
  row.appendChild(lab);
  row.appendChild(_toggle(on, onchange));
  return row;
}

/* ── General ──────────────────────────────────────────── */
function _renderGeneral(root) {
  // Quiet framing, not a warning: muted, secondary to the controls under it.
  const note = document.createElement('p');
  note.className = 'pmenu-proto';
  note.innerHTML = '<strong>Prototype</strong> \u2014 Stickland is an open sandbox for now. '
    + 'No objectives, no win condition \u2014 just a world to move around in while the systems get built out.';
  root.appendChild(note);

  const accentLabel = document.createElement('div');
  accentLabel.className = 'pmenu-sublabel';
  accentLabel.textContent = 'Accent';
  root.appendChild(accentLabel);

  const cur = _currentAccent().toLowerCase();
  const row = document.createElement('div');
  row.className = 'pmenu-swatches';
  for (const a of SITE_ACCENTS) {
    const cell = document.createElement('button');
    cell.type = 'button';
    const on = a.hex.toLowerCase() === cur;
    cell.className = 'pmenu-swatch' + (on ? ' active' : '');
    cell.style.setProperty('--c', a.hex);
    cell.setAttribute('aria-label', a.name);
    cell.setAttribute('aria-pressed', String(on));
    cell.dataset.tip = a.name;
    cell.innerHTML = '<i></i>';
    cell.addEventListener('click', () => {
      _applyAccent(a.hex, true);
      // Carry the choice back to the portfolio. Same-origin, so this writes the
      // site's own key directly; the site reads names, not hexes.
      try { safeStorage.setItem(SITE_ACCENT_KEY, a.name); } catch (e) {}
      sfx('ui.equip');
      // MD 13: update the selection in place. The old _renderTab() here
      // rebuilt the whole tab on every click — the rebuild is what made
      // picking a colour feel laggy.
      row.querySelectorAll('.pmenu-swatch').forEach(b => {
        const isOn = b === cell;
        b.classList.toggle('active', isOn);
        b.setAttribute('aria-pressed', String(isOn));
      });
    });
    row.appendChild(cell);
  }
  root.appendChild(row);

  const fxLabel = document.createElement('div');
  fxLabel.className = 'pmenu-sublabel';
  fxLabel.textContent = 'Effects';
  root.appendChild(fxLabel);

  root.appendChild(_switchRow('Camera lock (Y)', !!_hooks.getCameraLock?.(), on => {
    _hooks.setCameraLock?.(on);
  }, '<rect x="3" y="7" width="12" height="10" rx="2"/><path d="M15 11l6-3v8l-6-3z"/>'));

  root.appendChild(_switchRow('Screen shake', _fxSettings.shake > 0, on => {
    _fxSettings.shake = on ? 1 : 0;
    _applyFx();
  }, '<path d="M3 12h3l2-5 4 10 3-7 2 2h4"/>'));

  root.appendChild(_switchRow('Blood', _fxSettings.blood, on => {
    _fxSettings.blood = on;
    _applyFx();
  }, '<path d="M12 3s5 6 5 9a5 5 0 0 1-10 0c0-3 5-9 5-9z"/>'));

  const fxNote = document.createElement('div');
  fxNote.className = 'pmenu-note';
  fxNote.textContent = 'Blood off renders hits in your accent colour instead of red.';
  root.appendChild(fxNote);
}

/* ── Controls ─────────────────────────────────────────── */
function _keycap(text) {
  const el = document.createElement('span');
  el.className = 'pmenu-key';
  el.textContent = text;
  return el;
}

function _renderControls(root) {
  const card = document.createElement('div');
  card.className = 'pmenu-ctlcard';
  for (const grp of CONTROL_GROUPS) {
    const box = document.createElement('div');
    box.className = 'pmenu-ctlgrp' + (grp.inline ? ' inline' : '');
    const title = document.createElement('div');
    title.className = 'pmenu-ctltitle';
    title.textContent = grp.title;
    box.appendChild(title);
    for (const r of grp.rows) {
      const line = document.createElement('div');
      line.className = 'pmenu-ctlline';
      const keys = document.createElement('div');
      keys.className = 'pmenu-ctlkeys';
      if (r.bind) {
        // The one rebindable action — click, then press a key.
        const cur = (_hooks.getKeybind?.(r.bind) || 'Y').toUpperCase();
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pmenu-key pmenu-key-bind';
        btn.textContent = cur;
        btn.dataset.tip = 'Click, then press a key';
        btn.addEventListener('click', () => {
          _rebindArmed = r.bind;
          btn.textContent = '\u2026';
          btn.classList.add('listening');
        });
        keys.appendChild(btn);
      } else {
        for (const k of r.keys) keys.appendChild(_keycap(k));
      }
      line.appendChild(keys);
      if (r.note) {
        const n = document.createElement('span');
        n.className = 'pmenu-ctlnote';
        n.textContent = r.note;
        line.appendChild(n);
      }
      box.appendChild(line);
    }
    card.appendChild(box);
  }
  root.appendChild(card);
  const note = document.createElement('div');
  note.className = 'pmenu-note';
  note.textContent = 'Camera lock is rebindable \u2014 click its key. The rest are fixed.';
  root.appendChild(note);
}

function _finishRebind(e) {
  const action = _rebindArmed;
  _rebindArmed = null;
  // Single printable characters only — modifiers/arrows stay out of the
  // one-key comparison path playmode uses.
  if (e.key.length === 1 && /\S/.test(e.key)) {
    const key = e.key.toUpperCase();
    _hooks.setKeybind?.(action, key);
    // Extend the existing dexnote-keybinds blob, same shape enterPlayMode reads.
    try {
      const cur = JSON.parse(safeStorage.getItem(KEYBINDS_LS_KEY) || '{}');
      cur[action] = key;
      safeStorage.setItem(KEYBINDS_LS_KEY, JSON.stringify(cur));
    } catch (err) {}
    sfx('ui.equip');
  }
  _renderTab();
}

/* ── Audio ────────────────────────────────────────────── */
/* DexNote's channel row: pill toggle on the left, label, slider, then the
   percentage hard right. The toggle mutes the channel by parking its level at
   zero and restoring the previous one, so it needs no extra persisted state. */
function _channel(label, get, set, isOn, setOn, sync) {
  const row = document.createElement('div');
  row.className = 'pmenu-chan';
  let last = get() > 0 ? get() : 0.6;

  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0'; input.max = '100';
  input.className = 'pmenu-range';
  const val = document.createElement('span');
  val.className = 'pmenu-range-val';

  const paint = () => {
    const v = get();
    input.value = String(Math.round(v * 100));
    val.textContent = Math.round(v * 100) + '%';
    input.style.setProperty('--fill', Math.round(v * 100) + '%');
    const on = isOn();
    sw.classList.toggle('on', on);
    sw.setAttribute('aria-checked', String(on));
  };

  const sw = _toggle(isOn(), on => {
    if (!on) last = get() || last;
    setOn(on);
    if (sync) sync(); else paint();
  });

  const lab = document.createElement('span');
  lab.className = 'pmenu-chanlabel';
  lab.textContent = label;

  // 'input', not 'change' — applies live while dragging; you tune by ear.
  input.addEventListener('input', () => {
    const v = input.value / 100;
    if (v > 0) last = v;
    set(v);
    if (sync) sync(); else paint();
  });

  // Centre tick sits over the track's midpoint, matching the DexNote slider.
  const wrap = document.createElement('span');
  wrap.className = 'pmenu-trackwrap';
  const tick = document.createElement('span');
  tick.className = 'pmenu-tick';
  wrap.appendChild(input);
  wrap.appendChild(tick);

  row.appendChild(sw);
  row.appendChild(lab);
  row.appendChild(wrap);
  row.appendChild(val);
  paint();
  return { el: row, paint };
}

function _renderAudio(root) {
  const wrap = document.createElement('div');
  wrap.className = 'pmenu-audio';

  /* The three channels are ganged the way a mixer behaves: master is the sum,
     so silencing it silences the children, and bringing any child back up has
     to bring the master with it or the child would still be inaudible.
     `sync` is handed to each row so a change in one repaints the others
     without a full re-render (which would drop the slider mid-drag). */
  const rows = [];
  const sync = () => rows.forEach(r => r.paint());

  // Silencing the children lives in one helper so the switch and the slider
  // cannot drift apart — dragging master to zero has to behave like muting it.
  let lastMaster = getVolume() || 0.5;
  const silenceChildren = () => { setBusVolume('amb', 0); setBusVolume('sfx', 0); setBusVolume('ui', 0); };
  const restoreChildren = () => {
    if (getBusVolume('amb') === 0 && getBusVolume('sfx') === 0) {
      setBusVolume('amb', 0.6); setBusVolume('sfx', 0.6); setBusVolume('ui', 0.6);
    }
  };

  const master = _channel('Master',
    getVolume,
    (v) => {
      setVolume(v);
      if (v === 0) { setMuted(true); silenceChildren(); }
      else { if (isMuted()) setMuted(false); restoreChildren(); }
    },
    () => !isMuted() && getVolume() > 0,
    (on) => {
      setMuted(!on);
      if (!on) {
        // Muting has to move the master fader itself: leaving it at 80% while
        // the switch reads off is the slider disagreeing with the state.
        lastMaster = getVolume() || lastMaster;
        setVolume(0);
        silenceChildren();
      } else {
        setVolume(lastMaster || 0.5);
        restoreChildren();
      }
    }, sync);

  const child = (label, bus, extra) => _channel(label,
    () => getBusVolume(bus),
    (v) => {
      setBusVolume(bus, v);
      if (extra) setBusVolume(extra, v);
      // Any child coming off zero un-mutes the master, or it stays silent.
      if (v > 0 && (isMuted() || getVolume() === 0)) {
        setMuted(false);
        if (getVolume() === 0) setVolume(0.5);
      }
    },
    () => getBusVolume(bus) > 0,
    (on) => {
      const v = on ? 0.6 : 0;
      setBusVolume(bus, v);
      if (extra) setBusVolume(extra, v);
      if (on && (isMuted() || getVolume() === 0)) {
        setMuted(false);
        if (getVolume() === 0) setVolume(0.5);
      }
      // Both children off is the same as muting the sum.
      if (!on && getBusVolume('amb') === 0 && getBusVolume('sfx') === 0) setMuted(true);
    }, sync);

  // Music rides the ambience bus — the game's only continuous background
  // channel. FX drives sfx and ui together so retiring the Interface slider
  // does not leave UI sound with no control at all.
  rows.push(master, child('Music', 'amb', null), child('FX', 'sfx', 'ui'));
  rows.forEach(r => wrap.appendChild(r.el));
  sync();
  wrap.appendChild(_trackPicker());
  root.appendChild(wrap);
}

/* The audition rack: previous / next across the candidate tracks, with the
   number and the name, so a track can be judged while the game is actually
   being played rather than in a browser tab. Numbered because that is how the
   answer comes back — "track 4" — and named so the number can be turned into a
   file without counting rows.

   Temporary by design. When one is chosen this row goes and music.js shrinks to
   that track. It is inside the audio section because it belongs to the Music
   fader immediately above it — the same bus, the same mute. */
function _trackPicker() {
  const row = document.createElement('div');
  row.className = 'pmenu-track-pick';

  const prev = document.createElement('button');
  prev.type = 'button'; prev.className = 'pmenu-track-btn'; prev.textContent = '\u2039';
  prev.setAttribute('aria-label', 'Previous track');

  const play = document.createElement('button');
  play.type = 'button'; play.className = 'pmenu-track-btn pmenu-track-play';

  const next = document.createElement('button');
  next.type = 'button'; next.className = 'pmenu-track-btn'; next.textContent = '\u203a';
  next.setAttribute('aria-label', 'Next track');

  const label = document.createElement('span');
  label.className = 'pmenu-track-label';

  prev.addEventListener('click', () => { prevTrack(); sfx('ui.slot'); });
  next.addEventListener('click', () => { nextTrack(); sfx('ui.slot'); });
  play.addEventListener('click', () => { toggleMusic(); sfx('ui.slot'); });

  onMusicChange((st) => {
    label.textContent = st.failed
      ? 'Track ' + st.number + ' \u2014 unavailable'
      : 'Track ' + st.number + '/' + st.total + ' \u2014 ' + st.name;
    play.textContent = st.playing ? '\u2016' : '\u25b6';
    play.setAttribute('aria-label', st.playing ? 'Pause music' : 'Play music');
    row.classList.toggle('is-failed', !!st.failed);
  });

  row.appendChild(prev);
  row.appendChild(play);
  row.appendChild(next);
  row.appendChild(label);
  return row;
}

function _exitGame() {
  // MD 14: navigate the TOP window — inside the portfolio's /stickland
  // iframe, bare `location` is the frame, and navigating it to '/' hits
  // frame-ancestors 'none' (error page in the frame, tab goes nowhere).
  // Same-origin on the live site, so window.top is accessible; standalone
  // window.top === window, so nothing changes there.
  if (EXIT_URL) { (window.top || window).location.href = EXIT_URL; return; }
  try { window.close(); } catch (e) {}
  // Browsers block close() for user-opened tabs; if we're still here in a
  // moment, show a clean end card instead of appearing broken.
  setTimeout(() => {
    if (!document.hidden) _showEndcard();
  }, 350);
}

function _showEndcard() {
  if (!_endcardEl) {
    _endcardEl = document.createElement('div');
    _endcardEl.id = 'pmenu-endcard';
    _endcardEl.innerHTML = `
      <svg width="56" height="56" viewBox="0 0 32 32" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round">
        <circle cx="16" cy="7" r="4"/><path d="M16 11v10M16 14l-6 4M16 14l6 4M16 21l-5 7M16 21l5 7"/>
      </svg>
      <div class="pmenu-endcard-title">Thanks for playing</div>
      <div class="pmenu-endcard-sub">This tab can be closed — or jump back in.</div>
      <button class="pmenu-btn pmenu-btn-accent" type="button">Back to the game</button>`;
    _endcardEl.querySelector('button').addEventListener('click', () => { _hideEndcard(); closePauseMenu(); });
    document.body.appendChild(_endcardEl);
  }
  _endcardEl.style.display = '';
  requestAnimationFrame(() => _endcardEl.classList.add('open'));
  if (_menuEl) { _menuEl.classList.remove('open'); _menuEl.style.display = 'none'; }
}

function _hideEndcard() {
  if (!_endcardEl) return;
  _endcardEl.classList.remove('open');
  const el = _endcardEl;
  setTimeout(() => { el.style.display = 'none'; }, 200);
}
