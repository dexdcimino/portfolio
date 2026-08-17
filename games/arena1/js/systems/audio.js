// systems/audio.js — every synth recipe from the prototype (reference/
// prototype.html 160–233), verbatim frequencies/durations/waves, with ONE
// structural change (ARENA1_STEPS Phase 6): every voice routes through a
// single master GainNode instead of ctx.destination, so volume and mute are
// one knob, not per-recipe bookkeeping.
//
// MD 26: the mixer moved to games/_shared/audio-panel.js, which persists
// master/music/fx under `arena1-audio` and pushes them here via
// setAudioLevels. The old single-level arena1-volume / arena1-muted pair is
// retired — the keys below are read once so an existing player's saved level
// is not silently thrown away on the upgrade.

import { createSamplePlayer } from '../../../_shared/sample-player.js';

const LEGACY_VOLUME_KEY = 'arena1-volume';
const LEGACY_MUTED_KEY = 'arena1-muted';
/* One-time migration. Someone who had the game at 20% should not have it jump
   to the new 35% default just because the mixer changed shape underneath them;
   their old master level carries across, and the new music/fx buses take the
   defaults. Runs before the panel loads its own settings, and only when the
   panel has none stored yet. */
export function legacyAudioLevel() {
  const v = parseFloat(readStore(LEGACY_VOLUME_KEY, ''));
  if (!Number.isFinite(v)) return null;
  return readStore(LEGACY_MUTED_KEY, '0') === '1' ? 0 : Math.min(1, Math.max(0, v));
}

function readStore(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch { return fallback; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

let ctx = null, master = null, jetNode = null, jetGain = null;
/* MD 26 item 1: three buses instead of one master. `fx` is where every
   synthesized sound already routed (the old `master`), so nothing below had to
   change its wiring; `music` is built now and unused until MD 26 item 3 lands
   an actual loop, because a bus that appears with the track is a bus nobody
   remembers to add. Levels arrive from the shared panel via setAudioLevels. */
let musicBus = null, fxBus = null;
let pendingLevels = { master: 0.35, music: 0.30, fx: 0.40 };
/* The pre-MD-26 API (setVolume/getVolume/setMuted/isMuted) is gone: it had no
   callers left once the pause menu moved to the shared panel, and leaving two
   writers pointed at master.gain would have them fight — the last one to run
   wins, which is exactly the kind of bug that presents as "the slider
   sometimes does nothing". */
export function setAudioLevels(levels) {
  pendingLevels = levels;
  if (!ctx) return;                        // applied when the context is built
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(levels.master, t, 0.02);
  musicBus.gain.setTargetAtTime(levels.music, t, 0.02);
  fxBus.gain.setTargetAtTime(levels.fx, t, 0.02);
}
export function musicDestination() { return musicBus; }

/* MD 26 item 2 — CC0 samples in front of the synthesized sounds.
   Every entry here corresponds to an event the game ACTUALLY emits: the MD's
   six guns, sniper scope, reaver mortar, reload and wave sounds were dropped
   because none of that exists (zap and rocket are the whole arsenal).
   Caps are per sound and chosen by how fast the thing can fire: the zap is on
   an 0.11s cooldown so it needs headroom, a death happens once.
   If a file fails to load, `play` returns false and the caller falls through
   to the tone it always used — the game never goes quiet over a missing asset. */
let samples = null;
const SAMPLES = {
  zap:            ['zap.ogg',            { cap: 6, gain: 0.55 }],
  rocketLaunch:   ['rocket-launch.ogg',  { cap: 3, gain: 0.7 }],
  explosion:      ['explosion.ogg',      { cap: 4, gain: 0.8 }],
  serpentPop:     ['serpent-pop.ogg',    { cap: 5, gain: 0.7 }],
  serpentDeath:   ['serpent-death.ogg',  { cap: 2, gain: 0.9 }],
  playerHit:      ['player-hit.ogg',     { cap: 3, gain: 0.6 }],
  playerDeath:    ['player-death.ogg',   { cap: 1, gain: 0.85 }],
  pickup:         ['pickup.ogg',         { cap: 3, gain: 0.5 }],
  crit:           ['crit.ogg',           { cap: 3, gain: 0.5 }],
};
function initSamples() {
  if (samples) return;
  samples = createSamplePlayer({ ctx, destination: fxBus, basePath: 'assets/audio/' });
  for (const [name, [file, opts]] of Object.entries(SAMPLES)) samples.load(name, file, opts);
}
// `s(name)` -> true if a sample played. Callers read: s('zap') || synth().
const s = (name, opts) => !!samples && samples.play(name, opts);


function ensure() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    /* MD 26: master -> compressor -> destination, with music and fx feeding
       master. The compressor is Stickland's safety net and it matters more
       now than it did: synthesized tones were level by construction, sampled
       SFX are not, and a barrage that clips is worse than one that ducks. */
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 20; comp.ratio.value = 5;
    comp.attack.value = 0.004; comp.release.value = 0.18;
    comp.connect(ctx.destination);
    master = ctx.createGain();
    master.connect(comp);
    musicBus = ctx.createGain(); musicBus.connect(master);
    fxBus = ctx.createGain(); fxBus.connect(master);
    // The panel may have set levels before any sound existed to hear them.
    setAudioLevels(pendingLevels);
    initSamples();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function tone(f0, f1, dur, type = 'square', vol = 0.12) {
  if (!ctx) return;
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(fxBus); o.start(t); o.stop(t + dur + 0.02);
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
  s.connect(f); f.connect(g); g.connect(fxBus); s.start(t);
}
// soft cinematic whoosh: bandpass noise sweeping down + low sine swell
/* `sub` is the low sine under the noise. It used to be hard-coded at 0.05,
   which was fine while every caller used a similar `vol` — but MD 25 drops the
   dash to 0.045, and a fixed sub would then be LOUDER than the noise it is
   meant to sit under, turning a quieter sound into a boomier one. Explicit
   parameter, defaulted to the old value, so no existing sound moves. */
function whoosh(dur = 0.45, f0 = 1000, f1 = 220, vol = 0.12, sub = 0.05) {
  if (!ctx) return;
  const t = ctx.currentTime, s = ctx.createBufferSource(); s.buffer = noiseBuf(dur + 0.05);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1;
  bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.06);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(bp); bp.connect(g); g.connect(fxBus); s.start(t);
  const o = ctx.createOscillator(), og = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(70, t + dur);
  og.gain.setValueAtTime(Math.max(0.0001, sub), t); og.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(og); og.connect(fxBus); o.start(t); o.stop(t + dur);
}
function jetStart() {
  if (!ctx || jetNode) return;
  jetNode = ctx.createBufferSource(); jetNode.buffer = noiseBuf(0.6); jetNode.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 460; lp.Q.value = 0.7;
  jetGain = ctx.createGain(); jetGain.gain.setValueAtTime(0.0001, ctx.currentTime);
  jetGain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.08);
  jetNode.connect(lp); lp.connect(jetGain); jetGain.connect(fxBus); jetNode.start();
}
function jetStop() {
  if (!ctx || !jetNode) return;
  const g = jetGain, n = jetNode; jetNode = null; jetGain = null;
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
  setTimeout(() => { try { n.stop(); } catch { /* already stopped */ } }, 200);
}

export const AudioFX = {
  ensure, jetStart, jetStop,
  fire: () => { if (s('zap')) return; tone(760, 140, 0.09, 'square', 0.09); noise(0.05, 0.05, 2000); },
  jump: () => tone(300, 520, 0.12, 'triangle', 0.10),
  wall: () => { tone(200, 640, 0.14, 'sawtooth', 0.09); noise(0.06, 0.04, 1200); },
  /* MD 25 item 6 — sprint/dash. Was whoosh(0.5, 950, 200, 0.13): half a
     second of bandpassed noise sweeping down from 950Hz at the loudest volume
     of any movement sound in the game, plus a sine tail. Dash fires several
     times a minute, and at 950Hz it sat in the same band as the zap and the
     bolt hits — so the one sound you make constantly was competing with the
     sounds that carry information.
     Now: a third as long, a third as loud, and moved down out of the way.
     260Hz -> 90Hz is a body-level "shove" rather than a hiss, 0.16s is under
     the threshold where a repeated sound starts to feel like a rhythm, and
     0.045 puts it below the weapons instead of over them. */
  dash: () => whoosh(0.16, 260, 90, 0.045, 0.018),
  slide: () => whoosh(0.35, 500, 160, 0.06),
  pad: () => tone(220, 880, 0.25, 'triangle', 0.12),
  pop: () => { if (s('serpentPop')) return; tone(520, 90, 0.18, 'square', 0.12); noise(0.08, 0.08, 900); },
  /* MD 26: the double-pop tell. Deliberately UP where the normal pop goes
     down, and short — it has to be recognisable in the same instant as the
     blast it rides on, and it fires often enough that length would grate. */
  crit: () => { if (s('crit')) return; tone(680, 1180, 0.09, 'square', 0.085); tone(1400, 1900, 0.06, 'triangle', 0.05); },
  hit: () => tone(980, 700, 0.05, 'square', 0.07),
  hurt: () => { if (s('playerHit')) return; tone(160, 60, 0.25, 'sawtooth', 0.14); },
  land: () => noise(0.08, 0.07, 200),
  thwip: () => { noise(0.07, 0.07, 1600); tone(300, 900, 0.08, 'triangle', 0.07); },
  latch: () => tone(1200, 500, 0.05, 'square', 0.08),
  snap: () => tone(700, 180, 0.08, 'triangle', 0.08),
  cell: () => { if (s('pickup')) return; tone(520, 1040, 0.14, 'triangle', 0.11); setTimeout(() => tone(780, 1560, 0.16, 'triangle', 0.10), 90); },
  ring: () => whoosh(0.4, 1400, 500, 0.11),
  crack: () => noise(0.15, 0.10, 300),
  screech: () => { tone(1300, 260, 0.28, 'sawtooth', 0.07); tone(1700, 400, 0.2, 'square', 0.03); },
  // MD 11 — new cues built from the same primitives, same master bus:
  launch: () => { noise(0.12, 0.09, 700); tone(220, 90, 0.18, 'square', 0.08); },
  boom: () => { if (s('explosion')) return; tone(180, 40, 0.35, 'sawtooth', 0.16); noise(0.28, 0.12, 150); },
  // MD 14 — the same fire/launch cues heard from someone ELSE, scaled down
  // with distance (no positional audio bus; a crude linear falloff reads
  // fine at arena scale and keeps a full lobby from being a wall of zaps).
  fireAt: (dist) => {
    const k = Math.max(0.12, Math.min(1, 1 - dist / 70));
    tone(760, 140, 0.09, 'square', 0.09 * k); noise(0.05, 0.05 * k, 2000);
  },
  launchAt: (dist) => {
    const k = Math.max(0.12, Math.min(1, 1 - dist / 70));
    noise(0.12, 0.09 * k, 700); tone(220, 90, 0.18, 'square', 0.08 * k);
  },
};
