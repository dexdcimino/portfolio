// ══════════════════════════════════════════════════════
//  Game audio — the only module that touches AudioContext
// ══════════════════════════════════════════════════════
//  Synthesized core (oscillators, one shared noise buffer, envelopes,
//  filters) with a SAMPLED OVERLAY on top: a set of CC0 recordings in
//  sfx/ next to index.html (see sfx/CREDITS.md) that replace the synth
//  voice for the sounds where a real recording reads better — gunshots,
//  explosions, creature hurt/death, corpse thuds, gore, and the forest
//  ambience bed. The synth voices all remain as fallbacks: over file://
//  (or any fetch/decode failure) every sample silently degrades to the
//  synth that has always been there, matching music.js's contract.
//
//  Guarantees the rest of the codebase relies on:
//   · never throws — a browser that blocks AudioContext gets a silent game
//   · never blocks the frame — one-shots build a handful of nodes; the
//     noise buffer is built once at init and reused
//   · one public trigger:  sfx('shoot.shotgun', opts)
//     plus  sfxHold(name, params)  for sustained sounds (laser, charge),
//     called every frame — a watchdog releases them when the calls stop
//   · voice cap + per-sound retrigger cooldown, so cascades (shotgun
//     pellets, SMG spam, gore bursts) collapse into single varied hits
//     instead of clipping mush
//   · ±few-percent pitch/gain variation on every one-shot
//
//  Buses: sfx / ui / amb feed a master gain → soft compressor → out.
//  MD 02's ESC menu binds to setVolume/getVolume/setMuted/isMuted.

import { safeStorage } from './storage.js';

const LS_KEY = 'sfg-audio';           // {volume, muted} — sfg- prefix like the others

// ── State ───────────────────────────────────────────────
let _ctx = null;          // AudioContext, lazily created
let _failed = false;      // constructor threw — stay silent forever
let _unlocked = false;    // a user gesture has resumed the context
let _master = null, _comp = null;
const _bus = {};          // sfx / ui / amb gain nodes
let _noiseBuf = null;     // 1s of white noise, built once

// Master defaults to 50% — the synth mix reads hot at 80%, and first-boot
// loudness is the one thing a settings menu can't retroactively fix.
const _settings = { volume: 0.5, muted: false, buses: { sfx: 1, ui: 0.7, amb: 0.5 } };
try {
  const s = JSON.parse(safeStorage.getItem(LS_KEY) || 'null');
  if (s && typeof s === 'object') {
    if (typeof s.volume === 'number' && s.volume >= 0 && s.volume <= 1) _settings.volume = s.volume;
    _settings.muted = !!s.muted;
    if (s.buses && typeof s.buses === 'object') {
      for (const b of ['sfx', 'ui', 'amb']) {
        if (typeof s.buses[b] === 'number' && s.buses[b] >= 0 && s.buses[b] <= 1) _settings.buses[b] = s.buses[b];
      }
    }
  }
} catch (e) {}

function _saveSettings() {
  try { safeStorage.setItem(LS_KEY, JSON.stringify(_settings)); } catch (e) {}
}

// ── Context bootstrap ───────────────────────────────────
function _ensure() {
  if (_ctx || _failed) return _ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { _failed = true; return null; }
    _ctx = new AC();

    // master → compressor → destination. The compressor is a safety net so
    // heavy combat squeezes instead of clipping.
    _comp = _ctx.createDynamicsCompressor();
    _comp.threshold.value = -18;
    _comp.knee.value = 20;
    _comp.ratio.value = 5;
    _comp.attack.value = 0.004;
    _comp.release.value = 0.18;
    _comp.connect(_ctx.destination);

    _master = _ctx.createGain();
    _master.gain.value = _settings.muted ? 0 : _settings.volume;
    _master.connect(_comp);

    // Bus trims come from persisted settings (defaults: UI sits below
    // notice, ambience is a whisper).
    for (const name of ['sfx', 'ui', 'amb']) {
      const g = _ctx.createGain();
      g.gain.value = _settings.buses[name];
      g.connect(_master);
      _bus[name] = g;
    }

    // Shared noise buffer — built once, reused by every noise-based sound.
    _noiseBuf = _ctx.createBuffer(1, _ctx.sampleRate, _ctx.sampleRate);
    const data = _noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  } catch (e) {
    _failed = true;
    _ctx = null;
    console.warn('[audio] AudioContext unavailable — game runs silent:', e && e.message);
  }
  return _ctx;
}

// Browsers gate audio behind a user gesture. The game boots straight into
// the world, so hang the unlock on the first keydown/pointerdown.
function _unlock() {
  if (_unlocked || _failed) return;
  const ctx = _ensure();
  if (!ctx) return;
  ctx.resume().then(() => {
    _unlocked = true;
    _loadSamples();
    _startAmbience();
    // The audition rack, if it is present in this build. Late-bound through the
    // window rather than imported: audio.js is the bottom of the module graph
    // and importing upward would make a cycle.
    try { window._sticklandStartMusic && window._sticklandStartMusic(); } catch (e) {}
  }).catch(() => {});
}
try {
  window.addEventListener('keydown', _unlock, { capture: true });
  window.addEventListener('pointerdown', _unlock, { capture: true });
  // Pause everything when the tab is hidden — the game's rAF loop stops
  // there too, so a sustained sound would otherwise drone on unattended.
  document.addEventListener('visibilitychange', () => {
    if (!_ctx || !_unlocked) return;
    try {
      if (document.hidden) _ctx.suspend().catch(() => {});
      else _ctx.resume().catch(() => {});
    } catch (e) {}
  });
} catch (e) {}

// ── Public volume API (MD 02's ESC menu binds to these) ─
export function setVolume(v) {
  _settings.volume = Math.min(1, Math.max(0, +v || 0));
  _saveSettings();
  _applyMaster();
}
export function getVolume() { return _settings.volume; }
export function setMuted(m) {
  _settings.muted = !!m;
  _saveSettings();
  _applyMaster();
  // Kill sustained voices immediately — mute must silence the laser mid-beam,
  // not just future one-shots. (sfxHold early-returns while muted, so they
  // won't restart until unmute.)
  if (_settings.muted) {
    try { for (const n of Object.keys(_activeHolds)) _releaseHold(n); } catch (e) {}
  }
}
export function isMuted() { return _settings.muted; }
export function toggleMuted() { setMuted(!_settings.muted); return _settings.muted; }
export function setBusVolume(name, v) {
  if (!(name in _settings.buses)) return;
  _settings.buses[name] = Math.min(1, Math.max(0, +v || 0));
  _saveSettings();
  if (_ensure() && _bus[name]) _bus[name].gain.value = _settings.buses[name];
}
/* For music.js. Exported rather than letting another module reach in, so the
   context is still created in exactly one place, and the music bus is named
   here rather than guessed there: music rides `amb`, which is the bus the pause
   menu's Music fader already drives. */
export function audioContext() { return _ctx; }
export function musicDestination() { return (_bus && _bus.amb) || null; }

export function getBusVolume(name) {
  return (name in _settings.buses) ? _settings.buses[name] : 1;
}
function _applyMaster() {
  if (!_ctx || !_master) return;
  const target = _settings.muted ? 0 : _settings.volume;
  try {
    _master.gain.cancelScheduledValues(_ctx.currentTime);
    _master.gain.setTargetAtTime(target, _ctx.currentTime, 0.02);
  } catch (e) {}
}

// ── Positional listener ─────────────────────────────────
// playmode registers a provider returning the player's world position.
// World events pass  opts.at = {x, y}  (world coords) and get distance
// attenuation plus subtle pan. This is a 2D game — keep the panning gentle.
let _listenerFn = null;
export function sfxSetListener(fn) { _listenerFn = (typeof fn === 'function') ? fn : null; }

function _spatial(at) {
  if (!at || !_listenerFn) return { gain: 1, pan: 0 };
  try {
    const l = _listenerFn();
    if (!l) return { gain: 1, pan: 0 };
    const dx = at.x - l.x, dy = at.y - l.y;
    const dist = Math.hypot(dx, dy);
    // Full volume inside 320 world px, fading to a floor of 0.12 by ~2000.
    const gain = dist <= 320 ? 1 : Math.max(0.12, 1 - (dist - 320) / 1700);
    const pan = Math.max(-1, Math.min(1, dx / 900)) * 0.35;
    return { gain, pan };
  } catch (e) { return { gain: 1, pan: 0 }; }
}

// ── Synthesis primitives ────────────────────────────────
// Everything below composes these five. They all schedule against ctx time
// and self-clean via onended on their gain envelope's source.

const _rand = (lo, hi) => lo + Math.random() * (hi - lo);
const _vary = (v, pct) => v * (1 + (Math.random() * 2 - 1) * pct);

let _liveVoices = 0;
const VOICE_CAP = 24;

// Per-trigger output chain: gain (envelope) → optional panner → bus.
function _chain(bus, pan) {
  const g = _ctx.createGain();
  let tail = g;
  if (pan && _ctx.createStereoPanner) {
    const p = _ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    tail = p;
  }
  tail.connect(_bus[bus] || _bus.sfx);
  return g;
}

function _envelope(param, t0, peak, attack, dur) {
  param.setValueAtTime(0.0001, t0);
  param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
  param.exponentialRampToValueAtTime(0.0001, t0 + dur);
}

/** Pitched blip: one oscillator, pitch glide, exponential decay. */
function _blip(o) {
  const t0 = _ctx.currentTime + (o.delay || 0);
  const g = _chain(o.bus || 'sfx', o.pan);
  const osc = _ctx.createOscillator();
  osc.type = o.type || 'square';
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.endFreq), t0 + (o.glide || o.dur));
  _envelope(g.gain, t0, o.gain, o.attack || 0.004, o.dur);
  osc.connect(g);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.05);
  osc.onended = () => { _liveVoices = Math.max(0, _liveVoices - 1); };
  _liveVoices++;
}

/** Noise burst through a biquad filter, optional filter sweep. */
function _noise(o) {
  const t0 = _ctx.currentTime + (o.delay || 0);
  const g = _chain(o.bus || 'sfx', o.pan);
  const src = _ctx.createBufferSource();
  src.buffer = _noiseBuf;
  src.loop = true;
  src.playbackRate.value = o.rate || 1;
  const f = _ctx.createBiquadFilter();
  f.type = o.filter || 'lowpass';
  f.frequency.setValueAtTime(o.freq || 1200, t0);
  if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.sweepTo), t0 + o.dur);
  f.Q.value = o.q || 0.8;
  _envelope(g.gain, t0, o.gain, o.attack || 0.003, o.dur);
  src.connect(f); f.connect(g);
  src.start(t0, Math.random() * 0.5);   // random offset so bursts never phase
  src.stop(t0 + o.dur + 0.05);
  src.onended = () => { _liveVoices = Math.max(0, _liveVoices - 1); };
  _liveVoices++;
}

/** Low thud: sine with a fast downward pitch drop — the "kick" shape. */
function _thud(o) {
  _blip({ type: 'sine', freq: o.freq || 150, endFreq: o.endFreq || 50,
          glide: (o.dur || 0.18) * 0.7, dur: o.dur || 0.18, gain: o.gain,
          attack: 0.002, bus: o.bus, pan: o.pan, delay: o.delay });
}

/** Whoosh: bandpassed noise with a filter sweep. */
function _whoosh(o) {
  _noise({ filter: 'bandpass', freq: o.from || 300, sweepTo: o.to || 1400,
           q: 1.4, dur: o.dur || 0.25, gain: o.gain, attack: o.attack || 0.03,
           bus: o.bus, pan: o.pan, delay: o.delay });
}

/** Two-note motif helper for UI/pickup confirmations. */
function _duo(f1, f2, o) {
  _blip({ type: o.type || 'triangle', freq: f1, dur: o.dur || 0.07, gain: o.gain, bus: o.bus || 'ui', pan: o.pan });
  _blip({ type: o.type || 'triangle', freq: f2, dur: o.dur || 0.08, gain: o.gain, bus: o.bus || 'ui', pan: o.pan, delay: o.gap || 0.06 });
}

// ── The sound table ─────────────────────────────────────
// v = _vary. Every entry gets a few percent of pitch/gain drift per trigger
// so repeated fire reads as a weapon, not a machine.
// `cd` = per-sound retrigger cooldown (ms). One shotgun blast, not six.

const SOUNDS = {
  // — combat —
  'shoot.pistol':  { cd: 70, fn: (o) => {
    _blip({ type: 'square', freq: _vary(430, 0.06), endFreq: 150, dur: 0.09, gain: _vary(0.22, 0.1), pan: o.pan });
    _noise({ filter: 'highpass', freq: 1800, dur: 0.05, gain: _vary(0.10, 0.15), pan: o.pan });
  }},
  'shoot.shotgun': { cd: 110, fn: (o) => {
    _thud({ freq: _vary(160, 0.06), endFreq: 55, dur: 0.20, gain: 0.5, pan: o.pan });
    _noise({ filter: 'lowpass', freq: _vary(950, 0.1), sweepTo: 220, dur: 0.22, gain: _vary(0.4, 0.08), pan: o.pan });
    _noise({ filter: 'highpass', freq: 2500, dur: 0.04, gain: 0.12, pan: o.pan });
  }},
  // MD 14: the pump-rack chk-chk, fired from the foregrip animation's
  // turnaround (~75ms after the blast), not from the shot itself.
  'shotgun.pump': { cd: 150, fn: (o) => {
    _noise({ filter: 'bandpass', freq: 1800, dur: 0.03, gain: 0.12, pan: o.pan });
    _noise({ filter: 'bandpass', freq: 1300, dur: 0.035, gain: 0.14, delay: 0.07, pan: o.pan });
    _blip({ type: 'square', freq: 320, endFreq: 250, dur: 0.03, gain: 0.05, delay: 0.07, pan: o.pan });
  }},
  // MD 20: rebuilt — the old voice was a thin crack (short square + bare
  // hiss) that read as a toy at full auto. Now a body thud under a bark of
  // lowpassed noise, with just a breath of snap on top: each round has
  // weight, and the variance keeps a spray from machine-stitching.
  'shoot.smg':     { cd: 40, fn: (o) => {
    _thud({ freq: _vary(185, 0.07), endFreq: 68, dur: 0.075, gain: _vary(0.30, 0.1), pan: o.pan });
    _noise({ filter: 'lowpass', freq: _vary(2300, 0.15), sweepTo: 480, dur: 0.05, gain: _vary(0.22, 0.15), pan: o.pan });
    _blip({ type: 'square', freq: _vary(430, 0.08), endFreq: 130, dur: 0.05, gain: _vary(0.13, 0.12), pan: o.pan });
    _noise({ filter: 'highpass', freq: 3200, dur: 0.02, gain: 0.07, pan: o.pan });
  }},
  'shoot.rifle':   { cd: 90, fn: (o) => {
    _noise({ filter: 'highpass', freq: _vary(2600, 0.08), dur: 0.07, gain: 0.3, pan: o.pan });
    _blip({ type: 'sawtooth', freq: _vary(900, 0.05), endFreq: 180, dur: 0.12, gain: 0.2, pan: o.pan });
    _thud({ freq: 130, endFreq: 60, dur: 0.12, gain: 0.18, delay: 0.01, pan: o.pan });
  }},
  'shoot.rocket':  { cd: 120, fn: (o) => {
    _whoosh({ from: _vary(220, 0.1), to: 1600, dur: 0.35, gain: 0.3, attack: 0.01, pan: o.pan });
    _thud({ freq: 120, endFreq: 55, dur: 0.16, gain: 0.3, pan: o.pan });
  }},
  'shoot.puffer':  { cd: 100, fn: (o) => {
    // Boingy — this thing launches pufferfish.
    _blip({ type: 'sine', freq: _vary(190, 0.08), endFreq: 520, glide: 0.12, dur: 0.16, gain: 0.26, pan: o.pan });
    _noise({ filter: 'bandpass', freq: 700, dur: 0.06, gain: 0.08, pan: o.pan });
  }},
  'shoot.spellbook': { cd: 140, fn: (o) => {
    _blip({ type: 'triangle', freq: _vary(520, 0.04), dur: 0.12, gain: 0.16, pan: o.pan });
    _blip({ type: 'triangle', freq: _vary(780, 0.04), dur: 0.16, gain: 0.14, delay: 0.05, pan: o.pan });
    _noise({ filter: 'highpass', freq: 3200, dur: 0.3, gain: 0.05, attack: 0.05, pan: o.pan });
  }},
  // Sword (MD 10 follow-up, replaces melee.hammer): the jab is a short
  // bright lunge, the swipe a longer falling whoosh with a light ring.
  // o.power (0..1, charged release) turns the swipe into a deeper, louder
  // sweep with a low body under it.
  'melee.sword':   { cd: 90, fn: (o) => {
    if (o.power) {
      const p = Math.min(1, o.power);
      _whoosh({ from: 1200 - 500 * p, to: 300, dur: 0.2 + 0.08 * p, gain: 0.24 + 0.14 * p, pan: o.pan });
      _blip({ type: 'sawtooth', freq: _vary(220 + 120 * p, 0.06), endFreq: 90, dur: 0.14, gain: 0.1 + 0.08 * p, delay: 0.02, pan: o.pan });
    } else if (o.jab) {
      _whoosh({ from: 1400, to: 2200, dur: 0.07, gain: 0.14, pan: o.pan });
      _blip({ type: 'triangle', freq: _vary(1500, 0.06), endFreq: 2100, dur: 0.05, gain: 0.07, pan: o.pan });
    } else {
      _whoosh({ from: 1800, to: 500, dur: 0.15, gain: 0.18, pan: o.pan });
      _blip({ type: 'sine', freq: _vary(2400, 0.05), endFreq: 1700, dur: 0.09, gain: 0.05, delay: 0.03, pan: o.pan });
    }
  }},
  // Full-charge cue for the sword's held power swipe — one soft rising tick.
  'melee.swordReady': { cd: 250, fn: (o) => {
    _blip({ type: 'triangle', freq: 880, endFreq: 1320, dur: 0.07, gain: 0.09, pan: o.pan });
  }},
  'shoot.bow':     { cd: 80, fn: (o) => {
    const p = Math.min(1, Math.max(0, o.power == null ? 0.5 : o.power));
    // String pluck pitched by draw strength, plus flight whoosh on hard draws.
    _blip({ type: 'triangle', freq: _vary(240 + p * 480, 0.04), endFreq: 180 + p * 220, dur: 0.09, gain: 0.14 + p * 0.16, pan: o.pan });
    _whoosh({ from: 500, to: 700 + p * 1800, dur: 0.10 + p * 0.12, gain: 0.05 + p * 0.13, pan: o.pan });
  }},
  // — gamma laser overload (MD 17) —
  // The swell squeak rises with inflation progress (o.p 0..1); the pop is
  // a slide-whistle up into a big wet boom. Comedy is the point.
  'laser.swell': { cd: 90, fn: (o) => {
    const p = Math.min(1, o.p || 0);
    _blip({ type: 'sine', freq: 260 + p * 900, endFreq: 340 + p * 1150, dur: 0.08, gain: 0.07 + p * 0.1, pan: o.pan });
  }},
  'laser.pop': { cd: 200, fn: (o) => {
    _blip({ type: 'sine', freq: 350, endFreq: 1500, glide: 0.2, dur: 0.22, gain: 0.2, pan: o.pan });
    _thud({ freq: 100, endFreq: 36, dur: 0.42, gain: 0.5, delay: 0.2, pan: o.pan });
    _noise({ filter: 'lowpass', freq: 700, sweepTo: 110, dur: 0.45, gain: 0.4, delay: 0.2, pan: o.pan });
    _noise({ filter: 'lowpass', freq: 480, sweepTo: 130, dur: 0.12, gain: 0.2, delay: 0.22, pan: o.pan });
    _blip({ type: 'sine', freq: 170, endFreq: 60, dur: 0.1, gain: 0.12, delay: 0.24, pan: o.pan });
  }},
  'explosion':     { cd: 80, fn: (o) => {
    const big = !!o.big;
    _thud({ freq: big ? _vary(95, 0.1) : _vary(140, 0.1), endFreq: big ? 32 : 48,
            dur: big ? 0.5 : 0.26, gain: (big ? 0.55 : 0.38) * (o.gain || 1), pan: o.pan });
    _noise({ filter: 'lowpass', freq: big ? 800 : 650, sweepTo: big ? 90 : 140,
             dur: big ? 0.55 : 0.3, gain: (big ? 0.45 : 0.3) * (o.gain || 1), pan: o.pan });
    if (big) _noise({ filter: 'highpass', freq: 1800, dur: 0.08, gain: 0.14 * (o.gain || 1), pan: o.pan });
  }},
  // MD 18: afterburner ignition — a kick and a rising whoosh. The spool-up
  // while held is the 'tankboost' hold voice below.
  'tank.boost':    { cd: 300, fn: (o) => {
    _thud({ freq: 90, endFreq: 50, dur: 0.18, gain: 0.4, pan: o.pan });
    _whoosh({ from: 180, to: 950, dur: 0.4, gain: 0.3, attack: 0.02, pan: o.pan });
    _noise({ filter: 'highpass', freq: 1200, dur: 0.1, gain: 0.12, pan: o.pan });
  }},
  'tank.fire':     { cd: 120, fn: (o) => {
    _noise({ filter: 'highpass', freq: 1400, dur: 0.06, gain: 0.3 * (o.gain || 1), pan: o.pan });
    _thud({ freq: _vary(85, 0.08), endFreq: 34, dur: 0.4, gain: 0.55 * (o.gain || 1), pan: o.pan });
    _noise({ filter: 'lowpass', freq: 500, sweepTo: 100, dur: 0.4, gain: 0.3 * (o.gain || 1), pan: o.pan });
  }},

  // — player —
  'player.hurt':   { cd: 150, fn: (o) => {
    _blip({ type: 'triangle', freq: _vary(320, 0.08), endFreq: 150, dur: 0.12, gain: 0.22, pan: o.pan });
    _noise({ filter: 'bandpass', freq: 900, dur: 0.06, gain: 0.08, pan: o.pan });
  }},
  'player.death':  { cd: 400, fn: () => {
    // Three descending tones — synthetic, a little comic, not grim.
    _blip({ type: 'triangle', freq: 420, endFreq: 380, dur: 0.14, gain: 0.24 });
    _blip({ type: 'triangle', freq: 310, endFreq: 280, dur: 0.14, gain: 0.24, delay: 0.13 });
    _blip({ type: 'triangle', freq: 190, endFreq: 130, dur: 0.30, gain: 0.26, delay: 0.26 });
    _thud({ freq: 120, endFreq: 40, dur: 0.35, gain: 0.3, delay: 0.30 });
  }},
  'player.respawn': { cd: 400, fn: () => {
    _duo(392, 587, { type: 'sine', gain: 0.16, dur: 0.10, gap: 0.09, bus: 'ui' });
  }},
  'gore':          { cd: 120, fn: (o) => {
    _noise({ filter: 'lowpass', freq: _vary(500, 0.2), sweepTo: 120, dur: 0.09, gain: 0.13 * (o.gain || 1), pan: o.pan });
    _blip({ type: 'sine', freq: _vary(180, 0.15), endFreq: 70, dur: 0.06, gain: 0.08 * (o.gain || 1), pan: o.pan });
  }},

  // — movement —
  // 'jump' removed in MD 06b: jumps and jump-charge are silent by request.
  // Landing keeps its audio (scaled off landImpact).
  'land':          { cd: 90, fn: (o) => {
    const p = Math.min(1, Math.max(0.05, o.power == null ? 0.4 : o.power));
    _thud({ freq: _vary(150 + p * 60, 0.06), endFreq: 55, dur: 0.1 + p * 0.14, gain: 0.08 + p * 0.4 });
    if (p > 0.55) _noise({ filter: 'lowpass', freq: 500, sweepTo: 130, dur: 0.16, gain: (p - 0.5) * 0.5 });
  }},
  'land.board':    { cd: 90, fn: (o) => {
    const p = Math.min(1, Math.max(0.05, o.power == null ? 0.4 : o.power));
    _thud({ freq: 140, endFreq: 60, dur: 0.1 + p * 0.1, gain: 0.06 + p * 0.28 });
    _blip({ type: 'sine', freq: _vary(300, 0.05), endFreq: 420, glide: 0.08, dur: 0.12, gain: 0.05 + p * 0.08 });
  }},
  // MD 20: audible now — the old tick sat at gain 0.03-0.045, under the
  // ambience bed. A soft heel thud under the scuff gives each step a body
  // without turning walking into a drum line.
  'footstep':      { cd: 70, fn: (o) => {
    _noise({ filter: 'bandpass', freq: _vary(o.sprint ? 440 : 360, 0.22), q: 1.1,
             dur: 0.045, gain: _vary(o.sprint ? 0.15 : 0.11, 0.2) });
    _thud({ freq: _vary(110, 0.1), endFreq: 55, dur: 0.06, gain: o.sprint ? 0.09 : 0.06 });
  }},
  'board.mount':   { cd: 200, fn: () => {
    _duo(330, 494, { type: 'sine', gain: 0.14, dur: 0.09, gap: 0.07, bus: 'sfx' });
    _whoosh({ from: 200, to: 900, dur: 0.25, gain: 0.08 });
  }},
  'board.dismount': { cd: 200, fn: () => {
    _duo(494, 330, { type: 'sine', gain: 0.12, dur: 0.09, gap: 0.07, bus: 'sfx' });
  }},
  'tank.enter':    { cd: 250, fn: () => {
    _thud({ freq: 130, endFreq: 55, dur: 0.14, gain: 0.3 });
    _blip({ type: 'square', freq: 190, endFreq: 90, dur: 0.1, gain: 0.12, delay: 0.09 });
    _noise({ filter: 'bandpass', freq: 1600, q: 3, dur: 0.05, gain: 0.1, delay: 0.16 });
  }},
  'tank.exit':     { cd: 250, fn: () => {
    _blip({ type: 'square', freq: 100, endFreq: 170, dur: 0.09, gain: 0.1 });
    _thud({ freq: 120, endFreq: 60, dur: 0.1, gain: 0.18, delay: 0.07 });
  }},

  // — UI: felt, not heard —
  'ui.slot':       { cd: 60, fn: () => {
    _blip({ type: 'triangle', freq: _vary(950, 0.05), dur: 0.035, gain: 0.09, bus: 'ui' });
  }},
  'ui.equip':      { cd: 90, fn: () => {
    _duo(660, 880, { gain: 0.08, dur: 0.05, gap: 0.045 });
  }},
  'ui.open':       { cd: 120, fn: () => {
    _whoosh({ from: 400, to: 1100, dur: 0.12, gain: 0.06, bus: 'ui' });
    _blip({ type: 'sine', freq: 660, dur: 0.06, gain: 0.06, bus: 'ui', delay: 0.03 });
  }},
  'ui.close':      { cd: 120, fn: () => {
    _whoosh({ from: 1100, to: 400, dur: 0.11, gain: 0.05, bus: 'ui' });
  }},
  'collect':       { cd: 70, fn: () => {
    // Collectible pickup (MD 07) — a bright two-step chime, unmistakable
    // but small.
    _blip({ type: 'sine', freq: _vary(880, 0.03), dur: 0.06, gain: 0.14, bus: 'ui' });
    _blip({ type: 'sine', freq: _vary(1320, 0.03), dur: 0.09, gain: 0.12, bus: 'ui', delay: 0.05 });
  }},
  'ui.chat':       { cd: 100, fn: () => {
    _blip({ type: 'sine', freq: _vary(880, 0.04), dur: 0.05, gain: 0.08, bus: 'ui' });
  }},

  // — creatures —
  // MD 20: synth IS the voice here now. The recorded grunts/chirps from the
  // first sample batch read as a person being punched, not a stick yak —
  // retired. These stay synthetic and toylike, like the rest of the game.
  'creature.hurt': { cd: 120, fn: (o) => {
    // Small startled squeak — pitch falls, reads "ow" without being one.
    _blip({ type: 'triangle', freq: _vary(520, 0.12), endFreq: _vary(300, 0.1), dur: 0.08, gain: 0.14 * (o.gain || 1), pan: o.pan });
  }},
  'creature.death': { cd: 200, fn: (o) => {
    // Two falling notes — reads "down", not "in pain". The body.thud that
    // follows the tip-over is the weight; this is just the sigh.
    _blip({ type: 'triangle', freq: _vary(420, 0.06), endFreq: 320, dur: 0.09, gain: 0.14 * (o.gain || 1), pan: o.pan });
    _blip({ type: 'triangle', freq: _vary(260, 0.06), endFreq: 150, dur: 0.14, gain: 0.13 * (o.gain || 1), delay: 0.08, pan: o.pan });
  }},
  'bird.death':    { cd: 150, fn: (o) => {
    // One short falling tweet.
    _blip({ type: 'sine', freq: _vary(1500, 0.12), endFreq: 700, dur: 0.09, gain: 0.10 * (o.gain || 1), pan: o.pan });
  }},
  'body.thud':     { cd: 120, fn: (o) => {
    _thud({ freq: _vary(130, 0.08), endFreq: 50, dur: 0.14, gain: 0.22 * (o.gain || 1), pan: o.pan });
  }},

  // — bullet impact (MD 20) —
  // Bullets used to end EVERY flight — creature, wall, or just offscreen —
  // with the full 'explosion' voice; automatic fire turned into one long
  // boom-mush. Now only building hits tick, quietly.
  'bullet.impact': { cd: 50, fn: (o) => {
    _noise({ filter: 'bandpass', freq: _vary(1100, 0.2), q: 1.2, dur: 0.045, gain: 0.16 * (o.gain || 1), pan: o.pan });
    _thud({ freq: _vary(200, 0.1), endFreq: 90, dur: 0.05, gain: 0.10 * (o.gain || 1), pan: o.pan });
  }},
};

// ── Sampled overlay ─────────────────────────────────────
// name (or 'explosion.big') → recording(s). `gain` normalizes each file's
// measured peak to a level matched against the synth mix; `vary` is the
// per-trigger playbackRate spread (the sampled cousin of the synth's pitch
// drift); multiple files round-robin at random so repeats don't machine-gun
// the identical waveform. Everything still runs through _chain — same
// buses, cooldowns, voice cap, and spatial gain/pan as the synth voices.
const SFX_BASE = 'sfx/';
// MD 20 audition verdicts: the creature vocals (recorded grunts/chirps) and
// the smg crack were rejected — those names now play their synth voices, and
// the files left the repo. What survived: guns, explosions, gore, thuds,
// the spell cast, and the ambience bed.
const SAMPLES = {
  'shoot.pistol':    { files: ['shot-pistol.ogg'],     gain: 0.56, vary: 0.05 },
  'shoot.rifle':     { files: ['shot-rifle.ogg'],      gain: 0.44, vary: 0.04 },
  'shoot.shotgun':   { files: ['shot-shotgun.ogg'],    gain: 0.70, vary: 0.05 },
  'shoot.rocket':    { files: ['shot-rocket.ogg'],     gain: 1.44, vary: 0.05, rate: 1.15 },
  'shoot.spellbook': { files: ['cast-spell.ogg'],      gain: 0.56, vary: 0.05 },
  'shoot.puffer':    { files: ['shot-puffer.ogg'],     gain: 0.45, vary: 0.08 },
  'explosion':       { files: ['explosion-small.ogg'], gain: 1.17, vary: 0.06 },
  'explosion.big':   { files: ['explosion-big.ogg'],   gain: 0.93, vary: 0.04 },
  'gore':            { files: ['gore-splat-1.ogg', 'gore-splat-2.ogg'], gain: 1.25, vary: 0.1 },
  'body.thud':       { files: ['body-thud-1.ogg', 'body-thud-2.ogg'],  gain: 0.5,  vary: 0.06 },
};

const _sampleBufs = Object.create(null);   // file → AudioBuffer (present = ready)
let _samplesRequested = false;
function _loadSamples() {
  if (_samplesRequested || !_ctx) return;
  _samplesRequested = true;
  try {
    const files = new Set();
    for (const d of Object.values(SAMPLES)) for (const f of d.files) files.add(f);
    for (const f of files) {
      fetch(SFX_BASE + f)
        .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
        .then(ab => _ctx.decodeAudioData(ab))
        .then(buf => { _sampleBufs[f] = buf; })
        .catch(() => { /* file:// or 404 — the synth voice keeps the slot */ });
    }
  } catch (e) { /* no fetch — synth only */ }
}

function _playSample(def, o) {
  const file = def.files.length > 1
    ? def.files[Math.floor(Math.random() * def.files.length)]
    : def.files[0];
  const buf = _sampleBufs[file];
  if (!buf) return false;                    // not loaded (yet) — synth plays
  const t0 = _ctx.currentTime;
  const g = _chain(def.bus || 'sfx', o.pan);
  const src = _ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = _vary(def.rate || 1, def.vary == null ? 0.04 : def.vary);
  const peak = (def.gain || 1) * (o.gain || 1);
  // 4ms attack ramp — dodges the click a hard start can make.
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.004);
  src.connect(g);
  src.start(t0);
  src.onended = () => { _liveVoices = Math.max(0, _liveVoices - 1); try { g.disconnect(); } catch (e) {} };
  _liveVoices++;
  return true;
}

const _lastTrigger = Object.create(null);   // name → performance.now()

/** The one public one-shot trigger. opts: {power, big, gain, at:{x,y}, ...} */
export function sfx(name, opts) {
  try {
    if (_failed || !_unlocked || _settings.muted) return;
    const def = SOUNDS[name];
    if (!def || !_ctx) return;
    const now = performance.now();
    if (_lastTrigger[name] && now - _lastTrigger[name] < (def.cd || 70)) return;
    if (_liveVoices >= VOICE_CAP) return;   // drop, don't queue
    _lastTrigger[name] = now;
    const o = opts ? Object.assign({}, opts) : {};
    if (o.at) {
      const s = _spatial(o.at);
      if (s.gain <= 0.02) return;
      o.gain = (o.gain || 1) * s.gain;
      o.pan = s.pan;
    }
    // Sampled overlay first; the synth voice is the fallback, not a layer.
    const sKey = (name === 'explosion' && o.big) ? 'explosion.big' : name;
    const smp = SAMPLES[sKey];
    if (smp && _playSample(smp, o)) return;
    def.fn(o);
  } catch (e) {}
}

// ── Sustained sounds ────────────────────────────────────
// sfxHold(name, params) is called every frame while the sound should play.
// First call builds the voice; subsequent calls update parameters and feed
// the watchdog; ~150ms without a call (or sfxHoldStop) releases it.

const HOLDS = {
  laser: {
    attack: 0.06, release: 0.12, gain: 0.16,
    build(g) {
      const o1 = _ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 82;
      const o2 = _ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 82 * 1.008;
      const f = _ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 4;
      const lfo = _ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 7;
      const lfoG = _ctx.createGain(); lfoG.gain.value = 220;
      lfo.connect(lfoG); lfoG.connect(f.frequency);
      o1.connect(f); o2.connect(f); f.connect(g);
      o1.start(); o2.start(); lfo.start();
      return { nodes: [o1, o2, lfo], set() {} };
    },
  },
  // 'charge' hold removed in MD 06b along with its callers.
  hold: {  // E-hold progress ring (home, tank)
    attack: 0.08, release: 0.1, gain: 0.05,
    build(g) {
      const osc = _ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 260;
      osc.connect(g); osc.start();
      return { nodes: [osc], set(p) {
        const t = Math.min(1, Math.max(0, p && p.t || 0));
        osc.frequency.setTargetAtTime(260 + t * 300, _ctx.currentTime, 0.04);
      } };
    },
  },
  jet: {  // jetpack thrust (MD 07) — low rumble with a fast sputter
    attack: 0.05, release: 0.14, gain: 0.13,
    build(g) {
      const src = _ctx.createBufferSource(); src.buffer = _noiseBuf; src.loop = true;
      const f = _ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 1.2;
      const lfo = _ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 26;
      const lfoG = _ctx.createGain(); lfoG.gain.value = 90;
      lfo.connect(lfoG); lfoG.connect(f.frequency);
      src.connect(f); f.connect(g);
      src.start(0, Math.random() * 0.5); lfo.start();
      return { nodes: [src, lfo], set() {} };
    },
  },
  tankboost: {  // MD 18: afterburner spool — pitch and filter climb while held
    attack: 0.06, release: 0.25, gain: 0.2,
    build(g) {
      const o1 = _ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 70;
      const o2 = _ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 105;
      const f = _ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 6;
      const src = _ctx.createBufferSource(); src.buffer = _noiseBuf; src.loop = true;
      const nf = _ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 0.8;
      const ng = _ctx.createGain(); ng.gain.value = 0.5;
      o1.connect(f); o2.connect(f); f.connect(g);
      src.connect(nf); nf.connect(ng); ng.connect(g);
      o1.start(); o2.start(); src.start(0, Math.random() * 0.5);
      return { nodes: [o1, o2, src], set(p) {
        const t = Math.min(1, Math.max(0, (p && p.t) || 0));
        o1.frequency.setTargetAtTime(70 + t * 90, _ctx.currentTime, 0.1);
        o2.frequency.setTargetAtTime(105 + t * 135, _ctx.currentTime, 0.1);
        f.frequency.setTargetAtTime(500 + t * 1400, _ctx.currentTime, 0.1);
        nf.frequency.setTargetAtTime(900 + t * 1200, _ctx.currentTime, 0.1);
      } };
    },
  },
  board: {  // hoverboard hum; brightens and swells on boost
    attack: 0.15, release: 0.2, gain: 0.05,
    build(g) {
      const src = _ctx.createBufferSource(); src.buffer = _noiseBuf; src.loop = true;
      const f = _ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 240; f.Q.value = 2.5;
      src.connect(f); f.connect(g);
      src.start(0, Math.random() * 0.5);
      return { nodes: [src], set(p) {
        const boost = p && p.boost ? 1 : 0;
        f.frequency.setTargetAtTime(240 + boost * 480, _ctx.currentTime, 0.08);
        g.gain.setTargetAtTime(0.04 + boost * 0.075, _ctx.currentTime, 0.08);
      } };
    },
  },
};

const _activeHolds = Object.create(null); // name → {g, voice, lastFed}
let _holdSweeper = 0;

export function sfxHold(name, params) {
  try {
    if (_failed || !_unlocked || _settings.muted) { return; }
    const def = HOLDS[name];
    if (!def || !_ctx) return;
    let h = _activeHolds[name];
    if (!h) {
      const g = _ctx.createGain();
      g.gain.value = 0.0001;
      g.connect(_bus.sfx);
      const voice = def.build(g);
      g.gain.setTargetAtTime(def.gain, _ctx.currentTime, def.attack);
      h = _activeHolds[name] = { g, voice, def };
      if (!_holdSweeper) _holdSweeper = setInterval(_sweepHolds, 60);
    }
    h.lastFed = performance.now();
    if (params && h.voice.set) h.voice.set(params);
  } catch (e) {}
}

export function sfxHoldStop(name) {
  try { _releaseHold(name); } catch (e) {}
}

function _releaseHold(name) {
  const h = _activeHolds[name];
  if (!h) return;
  delete _activeHolds[name];
  const rel = h.def.release || 0.1;
  try {
    h.g.gain.cancelScheduledValues(_ctx.currentTime);
    h.g.gain.setTargetAtTime(0.0001, _ctx.currentTime, rel);
  } catch (e) {}
  setTimeout(() => {
    try { h.voice.nodes.forEach(n => { try { n.stop(); } catch (e) {} }); h.g.disconnect(); } catch (e) {}
  }, rel * 1000 + 250);
  if (!Object.keys(_activeHolds).length && _holdSweeper) {
    clearInterval(_holdSweeper);
    _holdSweeper = 0;
  }
}

function _sweepHolds() {
  const now = performance.now();
  for (const name of Object.keys(_activeHolds)) {
    if (now - _activeHolds[name].lastFed > 150) _releaseHold(name);
  }
}

// ── Footsteps ───────────────────────────────────────────
// The pose code advances runPhase continuously; two footfalls per cycle.
// Called every frame from the walk/jog branches — detect half-cycle
// crossings and click quietly. Speed-accurate for free.
let _lastStepBucket = -1;
export function footstep(phase, sprint) {
  try {
    const bucket = Math.floor(phase * 2);
    if (bucket === _lastStepBucket) return;
    _lastStepBucket = bucket;
    sfx('footstep', { sprint: !!sprint });
  } catch (e) {}
}

// ── Ambience ────────────────────────────────────────────
// Two layers with one survivor: the synth wind (slow LFO drifting a
// bandpass over looped noise) starts instantly, and the recorded forest
// bed (sfx/ambience-forest.ogg — wind + birds, CC0) crossfades in over it
// once fetched and decoded. Over file:// the fetch fails and the synth
// wind simply stays, same degrade story as the music rack. Lives on the
// amb bus, starts after the first user gesture, muted with everything
// else. Deliberately background.
// Temporary programmatic handle until MD 02's ESC menu binds the exported
// API — lets volume/mute be exercised from the console. Trivially removable.
try {
  window._dexAudio = { setVolume, getVolume, setMuted, isMuted, toggleMuted, setBusVolume, getBusVolume };
} catch (e) {}

let _ambStarted = false;
function _startAmbience() {
  if (_ambStarted || _failed || !_ctx) return;
  _ambStarted = true;
  let windG = null;
  try {
    const src = _ctx.createBufferSource();
    src.buffer = _noiseBuf; src.loop = true;
    const f = _ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 320; f.Q.value = 0.6;
    const lfo = _ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.07;
    const lfoG = _ctx.createGain(); lfoG.gain.value = 140;
    lfo.connect(lfoG); lfoG.connect(f.frequency);
    const g = _ctx.createGain(); g.gain.value = 0.0001;
    src.connect(f); f.connect(g); g.connect(_bus.amb);
    src.start(); lfo.start();
    g.gain.setTargetAtTime(0.022, _ctx.currentTime, 3);   // fade in over seconds
    windG = g;
  } catch (e) {}
  // The recorded bed — fades in over the wind, then the wind bows out.
  try {
    fetch(SFX_BASE + 'ambience-forest.ogg')
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then(ab => _ctx.decodeAudioData(ab))
      .then(buf => {
        const src = _ctx.createBufferSource();
        src.buffer = buf; src.loop = true;
        const g = _ctx.createGain(); g.gain.value = 0.0001;
        src.connect(g); g.connect(_bus.amb);
        src.start(0, Math.random() * Math.max(0, buf.duration - 1));
        g.gain.setTargetAtTime(0.5, _ctx.currentTime, 4);
        if (windG) windG.gain.setTargetAtTime(0.0001, _ctx.currentTime, 3);
      })
      .catch(() => { /* file:// — the synth wind stays */ });
  } catch (e) {}
}
