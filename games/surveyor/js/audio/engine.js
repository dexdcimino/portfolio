// The audio graph. One context, four buses, a generated convolution reverb and
// a tempo-synced ping-pong delay.
//
// Nothing here loads a file — the folder still ships with zero assets — but
// this is a produced mix rather than three oscillators bolted on: everything
// runs through a send reverb and a delay, the music bus is sidechained to the
// kick, and a limiter sits across the master so a crash and a chord stab on
// the same frame don't clip.
//
//   music ──► duck ──┐
//                    ├──► master ──► limiter ──► muffle ──► out
//   sfx ─────────────┤                  ▲
//   send ──► verb ───┘                  │ (muffle is the underwater lowpass)
//        └──► delay ──┘

import { SOUND } from '../tune.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Noise with an exponential tail — a plausible small-hall impulse. */
function makeIR(ctx, seconds, decay, bright) {
  const len = Math.max(1, (ctx.sampleRate * seconds) | 0);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp += ((Math.random() * 2 - 1) - lp) * bright;
      d[i] = lp * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

function makeNoise(ctx, seconds) {
  const len = (ctx.sampleRate * seconds) | 0;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Slightly pink: white through a one-pole, then normalised. Reads as air
  // rather than as static.
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    lp += (w - lp) * 0.22;
    d[i] = clamp(lp * 2.6 + w * 0.35, -1, 1);
  }
  return buf;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.beat = 60 / SOUND.bpm;
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ready;
    }
    const AC = typeof window !== 'undefined' &&
      (window.AudioContext || window.webkitAudioContext);
    if (!AC) return false;

    let ctx;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { return false; }
    this.ctx = ctx;

    const out = ctx.destination;

    // Underwater filter. Parked wide open; the drowning code closes it.
    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 20000;
    muffle.Q.value = 0.7;
    muffle.connect(out);

    // Master limiter — fast, hard, and only there to catch collisions.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 2;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;
    limiter.connect(muffle);

    const master = ctx.createGain();
    master.gain.value = SOUND.master;
    master.connect(limiter);

    // Music bus, with the sidechain duck in front of it.
    const duck = ctx.createGain();
    duck.gain.value = 1;
    duck.connect(master);
    const music = ctx.createGain();
    music.gain.value = SOUND.music;
    music.connect(duck);

    const sfx = ctx.createGain();
    sfx.gain.value = SOUND.sfx;
    sfx.connect(master);

    // Reverb send.
    const verb = ctx.createConvolver();
    verb.buffer = makeIR(ctx, 2.2, 3.4, 0.34);
    const verbGain = ctx.createGain();
    verbGain.gain.value = 0.9;
    verb.connect(verbGain);
    verbGain.connect(master);
    const send = ctx.createGain();
    send.gain.value = SOUND.reverb;
    send.connect(verb);

    // Tempo-synced ping-pong delay — 3/16, the classic arcade-synth setting.
    const dTime = this.beat * 0.75;
    const dl = ctx.createDelay(1.5);
    const dr = ctx.createDelay(1.5);
    dl.delayTime.value = dTime;
    dr.delayTime.value = dTime;
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    const dTone = ctx.createBiquadFilter();
    dTone.type = 'lowpass';
    dTone.frequency.value = 2600;
    const pL = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const pR = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pL) { pL.pan.value = -0.75; pR.pan.value = 0.75; }
    dl.connect(dTone); dTone.connect(dr); dr.connect(fb); fb.connect(dl);
    if (pL) { dl.connect(pL); dr.connect(pR); pL.connect(master); pR.connect(master); }
    else { dl.connect(master); dr.connect(master); }
    // Unity: the per-voice send gain is what decides how wet a sound gets.
    const echo = ctx.createGain();
    echo.gain.value = 1.0;
    echo.connect(dl);

    this.out = { master, music, duck, sfx, send, echo, muffle, limiter };
    this.noise = makeNoise(ctx, 2.5);
    this.ready = true;
    return true;
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  /**
   * A context that exists but is still suspended (autoplay policy, or a
   * backgrounded tab) will log a warning for every single source you start on
   * it. Nothing schedules while this is false.
   */
  get running() { return !!this.ctx && this.ctx.state === 'running'; }

  /**
   * The pause menu's mixer. Three levels in 0..1, scaling the tune's own
   * numbers rather than replacing them: SOUND.master and friends are the mix
   * this game was balanced at, and a shared panel that set absolute gains would
   * throw that balance away the first time anyone touched a slider.
   */
  setLevels(levels) {
    if (levels && typeof levels.master === 'number') this.level = levels.master;
    if (!this.ready) return;
    const set = (node, base, k) => {
      if (typeof k !== 'number') return;
      node.gain.cancelScheduledValues(this.now);
      node.gain.setTargetAtTime(base * k, this.now, 0.05);
    };
    set(this.out.music, SOUND.music, levels.music);
    set(this.out.sfx, SOUND.sfx, levels.fx);
    this.applyMaster();
  }

  /* THREE things can silence the master and they are independent: the M key,
     the mixer's own fader, and the pause menu being up. One place computes the
     result, or unmuting after a pause restores the wrong level — which is the
     shape of bug that only shows up in the fourth combination someone tries. */
  applyMaster() {
    if (!this.ready) return;
    const k = typeof this.level === 'number' ? this.level : 1;
    const g = this.out.master.gain;
    g.cancelScheduledValues(this.now);
    g.setTargetAtTime(this.muted || this.paused ? 0 : SOUND.master * k, this.now, 0.05);
  }

  setMuted(m) { this.muted = m; this.applyMaster(); }

  /** Paused is not muted: it does not touch the player's own mute state, and
   *  the mixer comes back exactly where it was. */
  setPaused(p) { this.paused = p; this.applyMaster(); }

  /** 0 = dry air, 1 = fully under. Rolls the whole mix off. */
  setSubmerged(t) {
    if (!this.ready) return;
    const f = this.out.muffle;
    const hz = 20000 * Math.pow(0.017, clamp(t, 0, 1));   // 20k -> ~340Hz
    f.frequency.setTargetAtTime(hz, this.now, 0.08);
    f.Q.setTargetAtTime(0.7 + t * 3, this.now, 0.1);
  }

  /** Duck the music bus, called by the sequencer on every kick. */
  sidechain(at, amount = SOUND.duck) {
    if (!this.running) return;
    const g = this.out.duck.gain;
    g.setValueAtTime(1 - amount, at);
    g.linearRampToValueAtTime(1, at + this.beat * 0.55);
  }

  // ---- voice construction ------------------------------------------------

  /**
   * A gain node wired through an optional panner to a bus, plus the two
   * sends. The returned node is what you envelope; everything downstream is
   * already connected.
   */
  chain(bus, sendAmt = 0, echoAmt = 0, panValue) {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    let head = g;
    if (panValue !== undefined && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = clamp(panValue, -1, 1);
      g.connect(p);
      head = p;
    }
    head.connect(this.out[bus]);
    if (sendAmt > 0) {
      const s = this.ctx.createGain();
      s.gain.value = sendAmt;
      head.connect(s); s.connect(this.out.send);
    }
    if (echoAmt > 0) {
      const e = this.ctx.createGain();
      e.gain.value = echoAmt;
      head.connect(e); e.connect(this.out.echo);
    }
    return g;
  }

  /**
   * One pitched note. Everything melodic in the game goes through here.
   * o: { type, freq, to, at, dur, gain, bus, attack, decay, curve,
   *      detune, pan, send, echo, filter, filterTo, q }
   */
  note(o) {
    if (!this.running || this.muted) return;
    const ctx = this.ctx;
    const at = o.at || this.now;
    const dur = o.dur || 0.25;
    const g = this.chain(o.bus || 'sfx', o.send || 0, o.echo || 0, o.pan);

    let tail = g;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(o.filter, at);
      f.Q.value = o.q || 1;
      if (o.filterTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.filterTo), at + dur);
      f.connect(g);
      tail = f;
    }

    const voices = o.detune ? [-o.detune, o.detune] : [0];
    for (const d of voices) {
      const osc = ctx.createOscillator();
      osc.type = o.type || 'sawtooth';
      osc.frequency.setValueAtTime(Math.max(8, o.freq), at);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(8, o.to), at + (o.glide || dur));
      osc.detune.value = d;
      osc.connect(tail);
      osc.start(at);
      osc.stop(at + dur + 0.06);
    }

    const peak = (o.gain === undefined ? 0.3 : o.gain) / voices.length;
    const a = o.attack === undefined ? 0.008 : o.attack;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + a);
    if (o.curve === 'flat') {
      g.gain.setValueAtTime(peak, at + dur * 0.72);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    } else {
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    }
    setTimeout(() => { try { g.disconnect(); } catch (e) { /* gone */ } },
      (dur + 0.5) * 1000 + (at - this.now) * 1000);
  }

  /**
   * One burst of noise. Drums, splashes, wind gusts, thrusters.
   * o: { at, dur, gain, bus, type, freq, to, q, pan, send, echo, attack }
   */
  hit(o) {
    if (!this.running || this.muted) return;
    const ctx = this.ctx;
    const at = o.at || this.now;
    const dur = o.dur || 0.12;
    const g = this.chain(o.bus || 'sfx', o.send || 0, o.echo || 0, o.pan);

    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(Math.max(30, o.freq || 1200), at);
    if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.to), at + dur);
    f.Q.value = o.q === undefined ? 1.1 : o.q;
    f.connect(g);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    src.connect(f);
    src.start(at, Math.random() * 2);
    src.stop(at + dur + 0.05);

    const peak = o.gain === undefined ? 0.3 : o.gain;
    const a = o.attack === undefined ? 0.004 : o.attack;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + a);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    setTimeout(() => { try { g.disconnect(); } catch (e) { /* gone */ } },
      (dur + 0.5) * 1000 + (at - this.now) * 1000);
  }

  /**
   * A held layer that lives for the whole session — engine notes, wind, water.
   * Returns handles so the per-frame code can just set values.
   */
  loop(o) {
    if (!this.ready) return null;
    const ctx = this.ctx;
    const g = this.chain(o.bus || 'sfx', o.send || 0, 0);
    const f = ctx.createBiquadFilter();
    f.type = o.filterType || 'lowpass';
    f.frequency.value = o.freq || 800;
    f.Q.value = o.q === undefined ? 1 : o.q;
    f.connect(g);

    const parts = [];
    if (o.noise) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.connect(f);
      src.start(0);
      parts.push(src);
    }
    for (const d of (o.detunes || [])) {
      const osc = ctx.createOscillator();
      osc.type = o.type || 'sawtooth';
      osc.frequency.value = o.pitch || 80;
      osc.detune.value = d;
      osc.connect(f);
      osc.start(0);
      parts.push(osc);
    }
    return {
      gain: g.gain,
      filter: f.frequency,
      q: f.Q,
      parts,
      set(vol, hz, pitch, at, slew = 0.06) {
        g.gain.setTargetAtTime(Math.max(0, vol), at, slew);
        if (hz) f.frequency.setTargetAtTime(Math.max(30, hz), at, slew);
        if (pitch) {
          for (const p of parts) {
            if (p.frequency && p.detune) p.frequency.setTargetAtTime(Math.max(8, pitch), at, slew);
            else if (p.playbackRate) p.playbackRate.setTargetAtTime(Math.max(0.05, pitch), at, slew);
          }
        }
      },
    };
  }
}
