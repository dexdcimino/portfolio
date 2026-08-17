// The soundtrack. A step sequencer on the WebAudio clock — lookahead
// scheduling, not setTimeout-per-note — playing a written arcade-synth score
// in A minor: i – VI – III – VII, 124bpm, four on the floor.
//
// It is adaptive. Layers gate in and out on an intensity value the game feeds
// it, so parking the rover thins the mix down to a pad, driving brings in the
// bass and the arp, and going airborne opens the filter and drops the lead in
// over the top. Nothing crossfades between separate tracks; it's one
// arrangement being played harder or softer.

import { SOUND } from '../tune.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Natural minor. Every pitch in the file is a scale index, so nothing can
// land outside the key by accident.
const SCALE = [0, 2, 3, 5, 7, 8, 10];
const semi = (i) => SCALE[((i % 7) + 7) % 7] + 12 * Math.floor(i / 7);
const hz = (s) => SOUND.root * Math.pow(2, s / 12);

// Four bars, one chord each. Offsets are semitones from A.
const PROG = [
  { root: 0,  tones: [0, 3, 7, 10] },   // Am7
  { root: -4, tones: [0, 4, 7, 11] },   // Fmaj7
  { root: 3,  tones: [0, 4, 7, 11] },   // Cmaj7
  { root: -2, tones: [0, 4, 7, 10] },   // G7
];

const KICK    = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const KICK_B  = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0];
const SNARE   = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
const HAT8    = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0];
const HAT16   = [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1];
const OPEN    = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0];
// 0 = rest, 1 = root, 2 = octave up, 3 = fifth
const BASS    = [1, 0, 0, 1, 0, 3, 1, 0, 1, 0, 2, 0, 1, 3, 0, 1];

// Four bars of lead, as [step, scaleIndex, lengthInSteps]. Index 21 is A4.
const LEAD = [
  [[0, 21, 2], [2, 23, 1], [3, 25, 3], [6, 24, 2], [8, 23, 2], [12, 21, 4]],
  [[0, 23, 2], [2, 25, 2], [4, 26, 4], [8, 25, 2], [10, 23, 2], [12, 25, 4]],
  [[0, 25, 2], [2, 27, 2], [4, 28, 4], [8, 27, 2], [10, 25, 2], [12, 23, 4]],
  [[0, 24, 2], [2, 25, 2], [4, 27, 4], [8, 25, 3], [11, 24, 2], [13, 22, 3]],
];

// Arp shape, as indices into the chord's tone list. Up, over the top, down.
const ARP = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 3, 2, 1, 0];

export class Music {
  constructor(engine) {
    this.e = engine;
    this.step = 0;
    this.next = 0;
    this.timer = null;
    this.playing = false;
    this.int = 0.20;         // damped intensity, 0..1
    this.want = 0.20;
    this.mode = 'rover';
    this.boost = 0;
    this.lead = 0;           // damped lead-layer gate
  }

  start() {
    if (!this.e.ready || this.playing) return;
    this.playing = true;
    this.step = 0;
    this.next = this.e.now + 0.18;
    this.timer = setInterval(() => this.tick(), 26);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.playing = false;
  }

  /**
   * Fed once a frame. intensity is what the arrangement follows; mode decides
   * whether the lead is allowed in at all.
   */
  update(dt, intensity, mode, boost) {
    this.want = clamp(intensity, 0, 1);
    this.mode = mode;
    this.boost = boost;
    const k = 1 - Math.exp(-1.6 * dt);
    this.int += (this.want - this.int) * k;
    const leadWant = mode === 'jet' ? 1 : (this.int > 0.86 ? 0.7 : 0);
    this.lead += (leadWant - this.lead) * (1 - Math.exp(-1.1 * dt));
  }

  tick() {
    if (!this.playing || !this.e.running) return;
    const stepDur = this.e.beat / 4;
    const now = this.e.now;
    // A backgrounded tab throttles the interval; resync rather than firing
    // fifty catch-up steps into the same millisecond.
    if (this.next < now - 0.4) this.next = now + 0.05;
    const horizon = now + 0.25;
    let guard = 0;
    while (this.next < horizon && guard++ < 48) {
      this.emit(this.step, this.next, stepDur);
      this.next += stepDur;
      this.step++;
    }
  }

  // ---- one sixteenth note ------------------------------------------------

  emit(step, at, sd) {
    const e = this.e;
    if (e.muted) return;

    const s = step % 16;
    const bar = Math.floor(step / 16) % 16;
    const chord = PROG[bar % 4];
    const half = bar >= 8;                 // the B half is a shade busier
    const I = this.int;
    const beat = e.beat;

    // Layer gates. Each is a soft window so a layer eases in.
    const gate = (lo, hi) => clamp((I - lo) / (hi - lo), 0, 1);
    const gDrum = gate(0.18, 0.34);
    const gBass = gate(0.10, 0.26);
    const gArp  = gate(0.34, 0.56);
    const gPad  = 1 - gate(0.55, 0.95) * 0.45;
    const open  = 700 + I * 3400 + this.boost * 2600;

    // ---- pad: one long chord per bar ----
    if (s === 0) {
      for (let i = 0; i < chord.tones.length; i++) {
        e.note({
          type: 'sawtooth',
          freq: hz(chord.root + chord.tones[i] + 24),
          at, dur: beat * 4 * 0.96,
          gain: 0.052 * gPad,
          bus: 'music', attack: 0.55, detune: 8,
          filter: 380 + I * 900, q: 1.1,
          send: 0.55, pan: (i - 1.5) * 0.34,
        });
      }
      // Sub root, so the bottom of the mix never drops out entirely.
      e.note({
        type: 'sine', freq: hz(chord.root - 12), at, dur: beat * 4 * 0.9,
        gain: 0.09 * gPad, bus: 'music', attack: 0.25,
      });
    }

    // ---- drums ----
    const fill = (bar % 4 === 3) && s >= 12;
    if (gDrum > 0.02) {
      const kick = (half ? KICK_B : KICK)[s];
      if (kick && !fill) {
        e.note({ type: 'sine', freq: 132, to: 44, glide: 0.055, at, dur: 0.30,
          gain: 0.62 * gDrum, bus: 'music', attack: 0.002, curve: 'flat' });
        e.hit({ at, dur: 0.028, gain: 0.11 * gDrum, type: 'lowpass', freq: 2800, q: 0.6, bus: 'music' });
        e.sidechain(at, SOUND.duck * gDrum);
      }
      if (SNARE[s] && !fill) {
        e.hit({ at, dur: 0.19, gain: 0.24 * gDrum, type: 'bandpass',
          freq: 1950, to: 1150, q: 0.9, bus: 'music', send: 0.55 });
        e.note({ type: 'triangle', freq: 215, to: 148, at, dur: 0.10,
          gain: 0.10 * gDrum, bus: 'music' });
      }
      if (fill) {
        // Four descending toms into the top of the next bar.
        const n = s - 12;
        e.note({ type: 'sine', freq: 300 - n * 46, to: (300 - n * 46) * 0.55,
          at, dur: 0.17, gain: 0.30 * gDrum, bus: 'music', attack: 0.003,
          pan: -0.4 + n * 0.27, send: 0.3 });
      } else {
        const pat = I > 0.62 ? HAT16 : HAT8;
        if (pat[s]) {
          e.hit({ at, dur: OPEN[s] ? 0.15 : 0.032, gain: (OPEN[s] ? 0.10 : 0.075) * gDrum,
            type: 'highpass', freq: 7800, q: 0.8, bus: 'music',
            pan: (s % 4) === 2 ? 0.28 : -0.22 });
        }
      }
    }

    // ---- bass ----
    if (gBass > 0.02 && BASS[s]) {
      const which = BASS[s];
      const off = which === 2 ? 12 : which === 3 ? 7 : 0;
      const f = hz(chord.root + off);
      e.note({ type: 'sawtooth', freq: f, at, dur: sd * 1.7,
        gain: 0.30 * gBass, bus: 'music', attack: 0.005, detune: 5,
        filter: 190 + I * 780 + this.boost * 900, filterTo: 120, q: 8 });
      e.note({ type: 'sine', freq: f * 0.5, at, dur: sd * 1.5,
        gain: 0.18 * gBass, bus: 'music', attack: 0.006 });
    }

    // ---- arp ----
    if (gArp > 0.02) {
      const sixteenths = I > 0.66;
      if (sixteenths || s % 2 === 0) {
        const tone = chord.tones[ARP[s] % chord.tones.length];
        const oct = ARP[s] >= 3 ? 36 : 24;
        e.note({ type: 'square', freq: hz(chord.root + tone + oct),
          at, dur: sd * 1.25, gain: 0.10 * gArp, bus: 'music',
          attack: 0.004, filter: open, filterTo: 620, q: 6,
          echo: 0.30, send: 0.20, pan: (s % 4) / 3 - 0.5 });
      }
    }

    // ---- lead, only when you're flying ----
    if (this.lead > 0.03 && s === 0) {
      for (const [st, idx, len] of LEAD[bar % 4]) {
        const t = at + st * sd;
        e.note({ type: 'square', freq: hz(semi(idx)), at: t, dur: len * sd * 0.92,
          gain: 0.115 * this.lead, bus: 'music', attack: 0.012, detune: 6,
          filter: 2200 + this.boost * 2200, q: 2.2,
          echo: 0.42, send: 0.35, pan: -0.12 });
      }
    }
  }

  /** A short cadence for a beacon or a pickup, in key with whatever's playing. */
  stab(kind) {
    const e = this.e;
    if (!e.running || e.muted) return;
    const at = e.now + 0.01;
    const chord = PROG[Math.floor(this.step / 16) % 4];
    const tones = kind === 'big' ? [0, 7, 12, 16, 19] : [0, 7, 12];
    tones.forEach((t, i) => {
      e.note({ type: 'triangle', freq: hz(chord.root + t + 24),
        at: at + i * 0.045, dur: kind === 'big' ? 0.85 : 0.34,
        gain: kind === 'big' ? 0.22 : 0.16, bus: 'sfx',
        attack: 0.004, filter: 5200, q: 1.4, echo: 0.35, send: 0.45 });
    });
  }
}
