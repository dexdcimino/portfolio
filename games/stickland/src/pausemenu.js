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
import { safeStorage } from './storage.js';

// ── Exit destination ────────────────────────────────────
// '/' → the portfolio homepage (MD 12): relative on purpose, so it's right
// on the production domain, Vercel previews, or anywhere else same-origin.
// The window.close()/endcard fallback below stays for the '' case — the
// correct behavior when index.html runs standalone from disk or a bare tab.
const EXIT_URL = '/';

const ACCENT_LS_KEY = 'sfg-accent';           // sfg- prefix like world/cosmetics/audio
const KEYBINDS_LS_KEY = 'dexnote-keybinds';   // existing key — extend, don't fork
const FX_LS_KEY = 'sfg-fx';                   // {shake: 0..1} — playmode reads window._dexShakeScale

// Accent presets — hexagon swatch row. Default green first.
const ACCENT_PRESETS = ['#68d121', '#2fd4b2', '#4da3ff', '#b76bff', '#f051c7', '#ff5f7a', '#ff9636', '#ffd23e'];

// The real control list, verified against character.js/playmode.js.
// (Mid-air jump added in MD 03 — one per airtime, resets on landing.)
// `bind` marks the entries that live in playmode's _keybinds map and can be
// rebound; everything else is a hardcoded comparison and shows as fixed.
const CONTROLS = [
  { keys: ['W A S D', '← ↑ ↓ →'], label: 'Move' },
  { keys: ['Space'], label: 'Jump — tap to hop, hold to charge, tap again mid-air' },
  { keys: ['Shift'], label: 'Sprint' },
  { keys: ['C'], label: 'Crouch' },
  { keys: ['H'], label: 'Holster / unholster' },
  { keys: ['E'], label: 'Interact — hold near tank, home, flag' },
  { keys: ['1', '2', '3', '4'], label: 'Equip hotbar slot' },
  { keys: ['5', 'B', 'I'], label: 'Inventory' },
  { keys: ['6', 'G'], label: 'Cosmetics' },
  { keys: ['T', 'Enter'], label: 'Chat — / commands, : emoji' },
  { bind: 'lock-camera', label: 'Camera lock' },
  { keys: ['Wheel'], label: 'Zoom (1.0 – 1.5×)' },
  { keys: ['Esc'], label: 'Pause menu' },
];

let _hooks = { exitWorld: null, getKeybind: null, setKeybind: null };
let _open = false;
let _menuEl = null, _backdropEl = null, _endcardEl = null;
let _activeTab = 'controls';
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
function _applyAccent(hex, persist) {
  document.documentElement.style.setProperty('--accent', hex);
  if (persist) safeStorage.setItem(ACCENT_LS_KEY, hex);
}
function _currentAccent() {
  return _normalizeHex(getComputedStyle(document.documentElement).getPropertyValue('--accent')) || ACCENT_PRESETS[0];
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
  const saved = _normalizeHex(safeStorage.getItem(ACCENT_LS_KEY));
  if (saved) _applyAccent(saved, false);
  window._dexShakeScale = _fxSettings.shake;
  window._dexBloodEnabled = _fxSettings.blood;
}

// ── Open / close ────────────────────────────────────────
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
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const tabs = ['controls', 'audio', 'fx', 'theme'];
      const i = tabs.indexOf(_activeTab);
      _setTab(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]);
      e.preventDefault();
    }
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
  _menuEl.innerHTML = `
    <div class="pmenu-title">Paused</div>
    <div class="pmenu-tabs" role="tablist">
      <button class="pmenu-tab" data-tab="controls" type="button">Controls</button>
      <button class="pmenu-tab" data-tab="audio" type="button">Audio</button>
      <button class="pmenu-tab" data-tab="fx" type="button">FX</button>
      <button class="pmenu-tab" data-tab="theme" type="button">Theme</button>
    </div>
    <div class="pmenu-content"></div>
    <div class="pmenu-footer">
      <button class="pmenu-btn pmenu-btn-accent" data-act="resume" type="button">Resume</button>
      <button class="pmenu-btn" data-act="hub" type="button">Return to hub</button>
      <button class="pmenu-btn" data-act="exit" type="button">Exit game</button>
    </div>
    <div class="pmenu-hint">Esc resumes · ←/→ switch tabs</div>`;
  document.body.appendChild(_menuEl);

  _menuEl.querySelectorAll('.pmenu-tab').forEach(btn => {
    btn.addEventListener('click', () => _setTab(btn.dataset.tab));
  });
  _menuEl.querySelector('[data-act="resume"]').addEventListener('click', closePauseMenu);
  _menuEl.querySelector('[data-act="hub"]').addEventListener('click', () => {
    closePauseMenu();
    _hooks.exitWorld?.();
  });
  _menuEl.querySelector('[data-act="exit"]').addEventListener('click', _exitGame);
}

function _setTab(tab) {
  if (tab === _activeTab) return;
  _activeTab = tab;
  _rebindArmed = null;
  sfx('ui.slot');
  _renderTab();
}

function _renderTab() {
  _menuEl.querySelectorAll('.pmenu-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === _activeTab);
  });
  const c = _menuEl.querySelector('.pmenu-content');
  c.innerHTML = '';
  if (_activeTab === 'controls') _renderControls(c);
  else if (_activeTab === 'audio') _renderAudio(c);
  else if (_activeTab === 'fx') _renderFx(c);
  else _renderTheme(c);
}

// ── FX tab ──────────────────────────────────────────────
function _renderFx(root) {
  const wrap = document.createElement('div');
  wrap.className = 'pmenu-audio';   // same slider layout as the audio tab
  wrap.appendChild(_slider('Screen shake', _fxSettings.shake, v => {
    _fxSettings.shake = v;
    _applyFx();
  }));
  const note = document.createElement('div');
  note.className = 'pmenu-note';
  note.textContent = 'Shake scales with impact and falls off with distance. 0 turns it off entirely.';
  wrap.appendChild(note);

  // Blood toggle (MD 10) — off by default: gore keeps its shapes and motion
  // but renders in the accent color, and the gore sound stays silent.
  const bloodRow = document.createElement('div');
  bloodRow.className = 'pmenu-row';
  const bloodLabel = document.createElement('span');
  bloodLabel.textContent = 'Blood';
  const bloodBtn = document.createElement('button');
  bloodBtn.type = 'button';
  bloodBtn.className = 'pmenu-key pmenu-key-bind';
  const syncBloodBtn = () => {
    bloodBtn.textContent = _fxSettings.blood ? 'ON' : 'OFF';
    bloodBtn.style.opacity = _fxSettings.blood ? '' : '0.65';
  };
  syncBloodBtn();
  bloodBtn.addEventListener('click', () => {
    _fxSettings.blood = !_fxSettings.blood;
    _applyFx();
    syncBloodBtn();
    sfx('ui.open');
  });
  bloodRow.appendChild(bloodLabel);
  bloodRow.appendChild(bloodBtn);
  wrap.appendChild(bloodRow);
  const bloodNote = document.createElement('div');
  bloodNote.className = 'pmenu-note';
  bloodNote.textContent = 'Off renders hits in your accent color instead of red.';
  wrap.appendChild(bloodNote);
  root.appendChild(wrap);
}

// ── Controls tab ────────────────────────────────────────
function _renderControls(root) {
  const list = document.createElement('div');
  list.className = 'pmenu-controls';
  for (const ctl of CONTROLS) {
    const row = document.createElement('div');
    row.className = 'pmenu-row';
    const keys = document.createElement('div');
    keys.className = 'pmenu-keys';
    if (ctl.bind) {
      // Rebindable — lives in playmode's _keybinds map.
      const cur = (_hooks.getKeybind?.(ctl.bind) || 'Y').toUpperCase();
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pmenu-key pmenu-key-bind';
      btn.textContent = cur;
      btn.dataset.tip = 'Click, then press a key';
      btn.addEventListener('click', () => {
        _rebindArmed = ctl.bind;
        btn.textContent = '…';
        btn.classList.add('listening');
      });
      keys.appendChild(btn);
    } else {
      for (const k of ctl.keys) {
        const chip = document.createElement('span');
        chip.className = 'pmenu-key';
        chip.textContent = k;
        keys.appendChild(chip);
      }
    }
    const label = document.createElement('div');
    label.className = 'pmenu-label';
    label.textContent = ctl.label;
    row.appendChild(keys);
    row.appendChild(label);
    list.appendChild(row);
  }
  const note = document.createElement('div');
  note.className = 'pmenu-note';
  note.textContent = 'Camera lock is rebindable — click its key. The rest are fixed.';
  root.appendChild(list);
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

// ── Audio tab ───────────────────────────────────────────
function _slider(label, value, oninput) {
  const row = document.createElement('div');
  row.className = 'pmenu-row pmenu-slider-row';
  const lab = document.createElement('div');
  lab.className = 'pmenu-label';
  lab.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0'; input.max = '100'; input.value = String(Math.round(value * 100));
  input.className = 'pmenu-range';
  const val = document.createElement('span');
  val.className = 'pmenu-range-val';
  val.textContent = String(Math.round(value * 100));
  // 'input', not 'change' — applies live while dragging; you tune by ear.
  input.addEventListener('input', () => {
    val.textContent = input.value;
    oninput(input.value / 100);
  });
  row.appendChild(lab);
  row.appendChild(input);
  row.appendChild(val);
  return row;
}

function _renderAudio(root) {
  const wrap = document.createElement('div');
  wrap.className = 'pmenu-audio';

  wrap.appendChild(_slider('Master', getVolume(), v => setVolume(v)));

  const muteRow = document.createElement('div');
  muteRow.className = 'pmenu-row';
  const muteBtn = document.createElement('button');
  muteBtn.type = 'button';
  muteBtn.className = 'pmenu-btn pmenu-mute' + (isMuted() ? ' active' : '');
  muteBtn.textContent = isMuted() ? 'Unmute' : 'Mute';
  muteBtn.addEventListener('click', () => {
    setMuted(!isMuted());
    muteBtn.textContent = isMuted() ? 'Unmute' : 'Mute';
    muteBtn.classList.toggle('active', isMuted());
    sfx('ui.slot');   // audible confirmation on unmute; silent when muting
  });
  muteRow.appendChild(muteBtn);
  wrap.appendChild(muteRow);

  const sep = document.createElement('div');
  sep.className = 'pmenu-sep';
  wrap.appendChild(sep);

  wrap.appendChild(_slider('Effects', getBusVolume('sfx'), v => setBusVolume('sfx', v)));
  wrap.appendChild(_slider('Ambience', getBusVolume('amb'), v => setBusVolume('amb', v)));
  wrap.appendChild(_slider('Interface', getBusVolume('ui'), v => setBusVolume('ui', v)));

  root.appendChild(wrap);
}

// ── Theme tab ───────────────────────────────────────────
function _renderTheme(root) {
  const wrap = document.createElement('div');
  wrap.className = 'pmenu-theme';

  const cur = _currentAccent();
  const row = document.createElement('div');
  row.className = 'pmenu-hexrow';
  for (const hex of ACCENT_PRESETS) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'pmenu-hexwrap' + (hex === cur ? ' active' : '');
    cell.setAttribute('aria-label', hex);
    const inner = document.createElement('span');
    inner.className = 'pmenu-hex';
    inner.style.background = hex;
    cell.appendChild(inner);
    cell.addEventListener('click', () => {
      _applyAccent(hex, true);
      sfx('ui.equip');
      _renderTab();   // refresh active ring + hex field
    });
    row.appendChild(cell);
  }
  wrap.appendChild(row);

  // Free-form hex — applies on valid input, shakes off malformed entries.
  const hexRow = document.createElement('div');
  hexRow.className = 'pmenu-row pmenu-hexinput-row';
  const hash = document.createElement('span');
  hash.className = 'pmenu-hexhash';
  hash.textContent = '#';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 6;
  input.className = 'pmenu-hexinput';
  input.value = cur.slice(1);
  input.spellcheck = false;
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'pmenu-btn pmenu-hexapply';
  apply.textContent = 'Apply';
  const doApply = () => {
    const hex = _normalizeHex(input.value);
    if (hex) {
      _applyAccent(hex, true);
      sfx('ui.equip');
      _renderTab();
    } else {
      input.classList.remove('invalid');
      void input.offsetWidth;   // restart the shake animation
      input.classList.add('invalid');
    }
  };
  apply.addEventListener('click', doApply);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doApply(); });
  hexRow.appendChild(hash);
  hexRow.appendChild(input);
  hexRow.appendChild(apply);
  wrap.appendChild(hexRow);

  const note = document.createElement('div');
  note.className = 'pmenu-note';
  note.textContent = 'Colors the HUD, bars and chrome. Your character’s own colors live in Cosmetics (6/G).';
  wrap.appendChild(note);

  root.appendChild(wrap);
}

// ── Exit ────────────────────────────────────────────────
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
