// systems/audio.js — every synth recipe from the prototype (reference/
// prototype.html 160–233), verbatim frequencies/durations/waves, with ONE
// structural change (ARENA1_STEPS Phase 6): every voice routes through a
// single master GainNode instead of ctx.destination, so volume and mute are
// one knob, not per-recipe bookkeeping.
//
// Master volume API (site pause-menu contract, same shape as Chomp's):
// setVolume/getVolume/setMuted/isMuted, persisted under arena1-volume /
// arena1-muted, mute independent of volume — unmuting restores the level.

const VOLUME_KEY = 'arena1-volume';
const MUTED_KEY = 'arena1-muted';

function readStore(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch { return fallback; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

let volume = Math.min(1, Math.max(0, parseFloat(readStore(VOLUME_KEY, '1')) || 0));
let muted = readStore(MUTED_KEY, '0') === '1';

let ctx = null, master = null, jetNode = null, jetGain = null;

function applyMaster() {
  if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02);
}

export function setVolume(v) {
  volume = Math.min(1, Math.max(0, Number(v) || 0));
  writeStore(VOLUME_KEY, String(volume));
  applyMaster();
}
export function getVolume() { return volume; }
export function setMuted(on) {
  muted = !!on;
  writeStore(MUTED_KEY, muted ? '1' : '0');
  applyMaster();
}
export function isMuted() { return muted; }

function ensure() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function tone(f0, f1, dur, type = 'square', vol = 0.12) {
  if (!ctx) return;
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noiseBuf(dur) {
  const n = Math.floor(ctx.sampleRate * dur), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function noise(dur, vol = 0.1, hp = 800) {
  if (!ctx) return;
  const t = ctx.currentTime, s = ctx.createBufferSource(); s.buffer = noiseBuf(dur);
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t);
}
// soft cinematic whoosh: bandpass noise sweeping down + low sine swell
function whoosh(dur = 0.45, f0 = 1000, f1 = 220, vol = 0.12) {
  if (!ctx) return;
  const t = ctx.currentTime, s = ctx.createBufferSource(); s.buffer = noiseBuf(dur + 0.05);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1;
  bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.06);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(bp); bp.connect(g); g.connect(master); s.start(t);
  const o = ctx.createOscillator(), og = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(70, t + dur);
  og.gain.setValueAtTime(0.05, t); og.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(og); og.connect(master); o.start(t); o.stop(t + dur);
}
function jetStart() {
  if (!ctx || jetNode) return;
  jetNode = ctx.createBufferSource(); jetNode.buffer = noiseBuf(0.6); jetNode.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 460; lp.Q.value = 0.7;
  jetGain = ctx.createGain(); jetGain.gain.setValueAtTime(0.0001, ctx.currentTime);
  jetGain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.08);
  jetNode.connect(lp); lp.connect(jetGain); jetGain.connect(master); jetNode.start();
}
function jetStop() {
  if (!ctx || !jetNode) return;
  const g = jetGain, n = jetNode; jetNode = null; jetGain = null;
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
  setTimeout(() => { try { n.stop(); } catch { /* already stopped */ } }, 200);
}

export const AudioFX = {
  ensure, jetStart, jetStop,
  fire: () => { tone(760, 140, 0.09, 'square', 0.09); noise(0.05, 0.05, 2000); },
  jump: () => tone(300, 520, 0.12, 'triangle', 0.10),
  wall: () => { tone(200, 640, 0.14, 'sawtooth', 0.09); noise(0.06, 0.04, 1200); },
  dash: () => whoosh(0.5, 950, 200, 0.13),
  slide: () => whoosh(0.35, 500, 160, 0.06),
  pad: () => tone(220, 880, 0.25, 'triangle', 0.12),
  pop: () => { tone(520, 90, 0.18, 'square', 0.12); noise(0.08, 0.08, 900); },
  hit: () => tone(980, 700, 0.05, 'square', 0.07),
  hurt: () => tone(160, 60, 0.25, 'sawtooth', 0.14),
  land: () => noise(0.08, 0.07, 200),
  thwip: () => { noise(0.07, 0.07, 1600); tone(300, 900, 0.08, 'triangle', 0.07); },
  latch: () => tone(1200, 500, 0.05, 'square', 0.08),
  snap: () => tone(700, 180, 0.08, 'triangle', 0.08),
  cell: () => { tone(520, 1040, 0.14, 'triangle', 0.11); setTimeout(() => tone(780, 1560, 0.16, 'triangle', 0.10), 90); },
  ring: () => whoosh(0.4, 1400, 500, 0.11),
  crack: () => noise(0.15, 0.10, 300),
  screech: () => { tone(1300, 260, 0.28, 'sawtooth', 0.07); tone(1700, 400, 0.2, 'square', 0.03); },
  // MD 11 — new cues built from the same primitives, same master bus:
  launch: () => { noise(0.12, 0.09, 700); tone(220, 90, 0.18, 'square', 0.08); },
  boom: () => { tone(180, 40, 0.35, 'sawtooth', 0.16); noise(0.28, 0.12, 150); },
};
