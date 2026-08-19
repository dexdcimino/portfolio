// Everything that isn't music. Three continuous engine voices that crossfade
// with the form you're in, an ambience pair (wind and water), and a one-shot
// for every event the game already emits.
//
// The engines are held layers whose gain, filter and pitch are set once a
// frame from the craft state — no note-per-frame, no allocation in the loop.

import { on } from '../core/events.js';
import { ROVER, BOAT, JET, WORLD, SOUND } from '../tune.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Sfx {
  constructor(engine, music) {
    this.e = engine;
    this.m = music;
    this.L = null;
    this.slapTimer = 0;
    this.burnTimer = 0;
    this.lastMode = 'rover';
    this.alarm = 0;
    this.wire();
  }

  /** Called once the context exists. */
  build() {
    const e = this.e;
    if (!e.running || this.L) return;
    this.L = {
      // Rover: an electric drive rather than a combustion drone. A triangle
      // pair gives a smooth motor whir with none of the sawtooth buzz, a sine
      // underneath carries the weight of the chassis, and the tyre noise is
      // the only broadband part.
      roverMotor: e.loop({ type: 'triangle', detunes: [-6, 7], pitch: 96, freq: 1100, q: 2.2 }),
      roverRumble: e.loop({ type: 'sine', detunes: [0], pitch: 34, freq: 190, q: 0.9 }),
      roverRoad: e.loop({ noise: true, filterType: 'bandpass', freq: 700, q: 1.1 }),
      // Boat: a low turbine and the rush of a hull pushing water. The rush
      // splits in two so ploughing and planing are different sounds rather
      // than the same sound at two volumes — ploughing is a heavy low churn,
      // planing is a bright hiss skating over the top.
      boatHum: e.loop({ type: 'triangle', detunes: [-5, 6], pitch: 68, freq: 520, q: 3 }),
      boatRush: e.loop({ noise: true, filterType: 'lowpass', freq: 900, q: 0.9, send: 0.10 }),
      boatPlane: e.loop({ noise: true, filterType: 'highpass', freq: 2600, q: 0.7, send: 0.14 }),
      // Winding up a jump: a rising tone you release on.
      charge: e.loop({ type: 'triangle', detunes: [-3, 4], pitch: 90, freq: 1400, q: 4, send: 0.12 }),
      // Jet, in four layers. A single noise band plus one saw read as a hair
      // dryer; a real engine is a low core you feel, a mid roar, a tonal
      // compressor whine at blade-pass frequency, and airframe rush over the
      // top. Each tracks a different thing, which is what makes it sound like
      // it is doing work rather than just playing.
      jetCore: e.loop({ noise: true, filterType: 'lowpass', freq: 110, q: 2.4 }),
      jetRoar: e.loop({ noise: true, filterType: 'bandpass', freq: 480, q: 1.5, send: 0.14 }),
      jetTurbine: e.loop({ type: 'sawtooth', detunes: [-4, 5], pitch: 300, freq: 2600, q: 9 }),
      jetBlade: e.loop({ type: 'square', detunes: [0], pitch: 740, freq: 3400, q: 12 }),
      jetAir: e.loop({ noise: true, filterType: 'highpass', freq: 3600, q: 0.8, send: 0.10 }),
      /* Skid layers, and the reason they are loops rather than one-shots. A
         skid lasts as long as the momentum takes to bleed out, which depends on
         how fast you arrived — an impact one-shot has to guess that length in
         advance and is wrong every time it guesses. These are held and driven
         from craft.skid, so the sound stops when the sliding stops, by
         construction rather than by tuning. */
      skidWash: e.loop({ noise: true, filterType: 'bandpass', freq: 1200, q: 0.6, send: 0.35 }),
      skidScrape: e.loop({ noise: true, filterType: 'bandpass', freq: 520, q: 1.6, send: 0.30 }),
      // Canopy: fabric under load, and the only sound in the game that means
      // "you are going to survive this".
      chuteFlap: e.loop({ noise: true, filterType: 'bandpass', freq: 700, q: 0.9, send: 0.25 }),
      // Ambience.
      wind: e.loop({ noise: true, filterType: 'bandpass', freq: 460, q: 0.7, send: 0.18 }),
      lap: e.loop({ noise: true, filterType: 'lowpass', freq: 360, q: 1.4, send: 0.12 }),
    };
  }

  // ---- one-shots ---------------------------------------------------------

  wire() {
    const ok = () => this.e.running && !this.e.muted;

    on('transform', (ev) => {
      if (!ok()) return;
      const t = this.e.now;
      // Servo whine up, then the mechanism seating.
      this.e.note({ type: 'sawtooth', freq: 180, to: 640, at: t, dur: 0.18,
        gain: 0.16, filter: 2400, q: 4, send: 0.3 });
      this.e.hit({ at: t + 0.10, dur: 0.20, gain: 0.32, type: 'lowpass',
        freq: 1400, to: 260, q: 1.2, send: 0.4 });
      this.e.note({ type: 'square', freq: 96, to: 52, at: t + 0.10, dur: 0.34,
        gain: 0.30, attack: 0.002, filter: 900, q: 3 });
      if (ev && ev.to === 'jet') {
        this.e.hit({ at: t + 0.16, dur: 0.7, gain: 0.30, type: 'bandpass',
          freq: 300, to: 2200, q: 0.8, send: 0.5 });
      }
    });

    on('chargestart', () => {
      if (!ok()) return;
      this.e.hit({ at: this.e.now, dur: 0.05, gain: 0.10, type: 'bandpass',
        freq: 2600, to: 1200, q: 3 });
    });

    // The hull letting go of the water — the moment worth hearing.
    on('plane', () => {
      if (!ok()) return;
      const t = this.e.now;
      this.e.hit({ at: t, dur: 0.5, gain: 0.24, type: 'bandpass',
        freq: 500, to: 3400, q: 0.8, send: 0.45 });
      this.e.note({ type: 'triangle', freq: 210, to: 420, at: t, dur: 0.30,
        gain: 0.10, attack: 0.02, filter: 2600, q: 2 });
    });

    on('plough', () => {
      if (!ok()) return;
      this.e.hit({ at: this.e.now, dur: 0.42, gain: 0.20, type: 'lowpass',
        freq: 2200, to: 320, q: 1.2, send: 0.35 });
    });

    on('wavelaunch', (ev) => {
      if (!ok()) return;
      const g = clamp(((ev && ev.rise) || 1) / 2.4, 0.3, 1);
      this.e.hit({ at: this.e.now, dur: 0.26, gain: 0.20 * g, type: 'bandpass',
        freq: 1400, to: 3000, q: 0.9, send: 0.4 });
    });

    on('slam', (ev) => {
      if (!ok()) return;
      const g = clamp((ev && ev.harsh) || 0.5, 0.2, 1);
      const t = this.e.now;
      this.e.hit({ at: t, dur: 0.34, gain: 0.30 * g, type: 'lowpass',
        freq: 1600, to: 180, q: 1.3, send: 0.4 });
      this.e.note({ type: 'sine', freq: 150, to: 54, at: t, dur: 0.26, gain: 0.22 * g });
    });

    on('hop', (ev) => {
      if (!ok()) return;
      const t = this.e.now;
      const chain = Math.min((ev && ev.chain) || 0, 5);
      // Suspension release, then air. Chained hops go up in pitch — the
      // combo is audible before it's visible on the speed readout.
      this.e.note({ type: 'triangle', freq: 150 * Math.pow(1.09, chain), to: 420,
        at: t, dur: 0.16, gain: 0.20, attack: 0.003, filter: 3000, q: 2 });
      this.e.hit({ at: t, dur: 0.16, gain: 0.14, type: 'bandpass',
        freq: 900, to: 3200, q: 0.9, send: 0.3 });
    });

    on('thump', (ev) => {
      if (!ok()) return;
      const hard = clamp((ev && ev.impact ? ev.impact : 6) / 16, 0.25, 1.3);
      const t = this.e.now;
      if (ev && ev.water) { this.splash(hard * 1.2); return; }
      this.e.note({ type: 'sine', freq: 130, to: 46, at: t, dur: 0.22,
        gain: 0.34 * hard, attack: 0.002, glide: 0.05 });
      this.e.hit({ at: t, dur: 0.15, gain: 0.20 * hard, type: 'lowpass',
        freq: 1800, to: 300, q: 0.9, send: 0.25 });
      // Suspension rebound.
      this.e.note({ type: 'triangle', freq: 320, to: 190, at: t + 0.05,
        dur: 0.14, gain: 0.09 * hard, filter: 1800, q: 3 });
    });

    on('splash', (ev) => { if (ok()) this.splash(clamp((ev && ev.force) || 0.6, 0.2, 1.4)); });

    /* A hull taking the sand. The bite of it only — the body of the sound is
       the held scrape in update(), which runs for exactly as long as the boat
       is still sliding. Soft attack on purpose: a beaching is something that
       takes hold of you, and an instant transient would be the wall this whole
       change exists to remove. */
    on('beach', (ev) => {
      if (!ok()) return;
      const t = this.e.now;
      const g = clamp(((ev && ev.speed) || 12) / 34, 0.25, 1);
      const secs = clamp((ev && ev.secs) || 0.6, 0.3, 2.0);
      this.e.hit({ at: t, dur: 0.55 * secs, gain: 0.13 * g, type: 'bandpass',
        freq: 850, to: 240, q: 0.8, send: 0.40 });
      this.e.note({ type: 'triangle', freq: 118, to: 62, at: t, dur: 0.45 * secs,
        gain: 0.08 * g, attack: 0.09, filter: 640, q: 2 });
    });

    // The canopy taking the air: a crack, then fabric settling into its load.
    on('chute', () => {
      if (!ok()) return;
      const t = this.e.now;
      this.e.hit({ at: t, dur: 0.16, gain: 0.20, type: 'bandpass',
        freq: 1700, to: 720, q: 1.1, send: 0.5 });
      this.e.hit({ at: t + 0.10, dur: 0.85, gain: 0.10, type: 'lowpass',
        freq: 1100, to: 300, q: 0.8, send: 0.45 });
    });

    on('crash', () => {
      if (!ok()) return;
      const t = this.e.now;
      this.e.hit({ at: t, dur: 0.55, gain: 0.50, type: 'lowpass',
        freq: 2600, to: 120, q: 1.0, send: 0.6 });
      this.e.note({ type: 'square', freq: 110, to: 30, at: t, dur: 0.5,
        gain: 0.34, attack: 0.001, filter: 700, q: 4 });
      this.e.note({ type: 'sawtooth', freq: 620, to: 180, at: t + 0.02, dur: 0.22,
        gain: 0.14, filter: 2600, q: 6 });
    });

    on('landed', () => {
      if (!ok()) return;
      const t = this.e.now;
      this.e.hit({ at: t, dur: 0.30, gain: 0.26, type: 'bandpass',
        freq: 1700, to: 420, q: 0.8, send: 0.35 });
      this.e.note({ type: 'sine', freq: 120, to: 50, at: t, dur: 0.24, gain: 0.26 });
    });

    /* THE UI VOICE. Three sounds, and everything the interface does is one of
       them: a TICK for anything that merely moves, a CONFIRM for anything that
       commits, and a BACK for anything that reverses. Adding a fourth is how
       an interface ends up sounding like a xylophone.
       Quiet by a wide margin - a third of the gain of the gameplay one-shots
       around it, and no echo except a whisper on the confirm. A menu is not an
       event in the world, and a click that competes with a crash is a click
       somebody turns off. Sine and short: nothing here should have a texture.
       NOTE ON THE PAUSE MENU. It is deliberately silent, and that is the
       engine's doing rather than an omission here - applyMaster() takes the
       master to zero while `paused`, so a paused game is quiet, full stop. The
       menu's feedback is the press state on the button instead. What DOES
       sound is everything that happens with the game running: opening the
       pause ladder, resuming out of it, starting the session, taking the map
       up, choosing a world. */
    on('ui', (ev) => {
      if (!ok()) return;
      const t = this.e.now;
      const kind = (ev && ev.kind) || 'tick';
      if (kind === 'confirm') {
        this.e.note({ type: 'sine', freq: 660, at: t, dur: 0.05,
          gain: 0.05, filter: 5200, q: 1 });
        this.e.note({ type: 'sine', freq: 990, at: t + 0.045, dur: 0.09,
          gain: 0.042, filter: 5200, q: 1, send: 0.18 });
      } else if (kind === 'back') {
        this.e.note({ type: 'sine', freq: 520, to: 330, at: t, dur: 0.12,
          gain: 0.05, filter: 3000, q: 1 });
      } else {
        this.e.note({ type: 'sine', freq: 1180, at: t, dur: 0.03,
          gain: 0.035, filter: 6000, q: 1 });
      }
    });

    on('pickup', () => {
      if (!ok()) return;
      const t = this.e.now;
      this.e.note({ type: 'square', freq: 880, at: t, dur: 0.07, gain: 0.13,
        filter: 6000, q: 1, echo: 0.25 });
      this.e.note({ type: 'square', freq: 1320, at: t + 0.06, dur: 0.10, gain: 0.13,
        filter: 6000, q: 1, echo: 0.3 });
      this.m.stab('small');
    });

    on('scanstart', () => {
      if (!ok()) return;
      this.e.note({ type: 'sine', freq: 420, to: 720, at: this.e.now, dur: 0.30,
        gain: 0.09, attack: 0.05, send: 0.4, echo: 0.2 });
    });

    on('scanabort', () => {
      if (!ok()) return;
      this.e.note({ type: 'sine', freq: 620, to: 300, at: this.e.now, dur: 0.16, gain: 0.07 });
    });

    on('scanned', () => {
      if (!ok()) return;
      this.m.stab('big');
      this.e.hit({ at: this.e.now, dur: 0.6, gain: 0.14, type: 'highpass',
        freq: 4200, q: 0.7, send: 0.7 });
    });

    on('denied', () => {
      if (!ok()) return;
      const t = this.e.now;
      for (let i = 0; i < 2; i++) {
        this.e.note({ type: 'square', freq: 150, at: t + i * 0.12, dur: 0.09,
          gain: 0.16, filter: 700, q: 2 });
      }
    });

    on('fuelout', () => { this.alarm = 3; });

    on('flood', () => {
      if (!ok()) return;
      const t = this.e.now;
      this.e.hit({ at: t, dur: 0.9, gain: 0.30, type: 'lowpass',
        freq: 900, to: 180, q: 1.6, send: 0.5 });
      for (let i = 0; i < 6; i++) {
        this.e.note({ type: 'sine', freq: 220 + Math.random() * 500,
          to: 90, at: t + i * 0.09 + Math.random() * 0.05, dur: 0.12, gain: 0.07 });
      }
    });

    on('probedrop', () => {
      if (!ok()) return;
      const t = this.e.now;
      // Rack release, then the probe falling away from you.
      this.e.hit({ at: t, dur: 0.09, gain: 0.20, type: 'bandpass',
        freq: 2200, to: 900, q: 2.5 });
      this.e.note({ type: 'sawtooth', freq: 520, to: 150, at: t + 0.04, dur: 0.55,
        gain: 0.11, filter: 2200, q: 3, send: 0.4 });
    });

    on('probelost', () => {
      if (!ok()) return;
      const t = this.e.now;
      this.e.note({ type: 'square', freq: 260, to: 90, at: t, dur: 0.35,
        gain: 0.13, filter: 900, q: 2 });
    });

    on('colony', () => {
      if (!ok()) return;
      // Touchdown, then the site coming online.
      const t = this.e.now;
      this.e.hit({ at: t, dur: 0.28, gain: 0.24, type: 'lowpass',
        freq: 1400, to: 200, q: 1.1, send: 0.4 });
      this.m.stab('big');
    });

    on('colonygrow', (ev) => {
      if (!ok()) return;
      const t = this.e.now;
      // Rises a step with each new dome, so the site audibly matures.
      const step = Math.min((ev && ev.stage) || 1, 6);
      this.e.note({ type: 'triangle', freq: 330 * Math.pow(2, (step - 1) / 12),
        at: t, dur: 0.45, gain: 0.13, attack: 0.02, send: 0.5, echo: 0.3 });
      this.e.note({ type: 'triangle', freq: 495 * Math.pow(2, (step - 1) / 12),
        at: t + 0.10, dur: 0.5, gain: 0.10, attack: 0.02, send: 0.5, echo: 0.3 });
    });

    on('dropfail', () => {
      if (!ok()) return;
      this.e.note({ type: 'square', freq: 165, at: this.e.now, dur: 0.10,
        gain: 0.13, filter: 800, q: 2 });
    });

    on('drown', () => {
      if (!ok()) return;
      const t = this.e.now;
      this.e.hit({ at: t, dur: 1.1, gain: 0.36, type: 'lowpass',
        freq: 600, to: 90, q: 2.0, send: 0.7 });
      // Winch, then the all-clear.
      this.e.note({ type: 'sawtooth', freq: 70, to: 40, at: t + 0.2, dur: 0.7,
        gain: 0.18, filter: 500, q: 5 });
      [0, 7, 12].forEach((s, i) => {
        this.e.note({ type: 'triangle', freq: 330 * Math.pow(2, s / 12),
          at: t + 0.95 + i * 0.09, dur: 0.4, gain: 0.15, send: 0.4, echo: 0.3 });
      });
    });
  }

  /**
   * Entering water — softer and longer than it was, and the low sine is gone.
   *
   * That tone was the "hit" in this sound, and a rover now carries its speed
   * into a lake over twenty-odd metres instead of stopping at the surface, so a
   * thud was describing something that no longer happens. What is left is spray
   * over a wash, both at roughly half the gain and twice the length; the body
   * of the entry is the held layer in update(), cut to the skid.
   */
  splash(force) {
    const t = this.e.now;
    this.e.hit({ at: t, dur: 0.55 * force, gain: 0.16 * force, type: 'bandpass',
      freq: 1900, to: 430, q: 0.6, send: 0.50 });
    this.e.hit({ at: t + 0.04, dur: 0.90 * force, gain: 0.09 * force, type: 'lowpass',
      freq: 720, to: 190, q: 0.9, send: 0.45 });
  }

  // ---- per-frame ---------------------------------------------------------

  update(dt, craft) {
    if (!this.e.ready) return;
    if (!this.L) this.build();
    const L = this.L;
    if (!L || !L.roverMotor) return;
    const now = this.e.now;
    const mode = craft.mode;
    const boost = craft.boostHeat;
    const swamp = craft.swamp || 0;

    const gnd = Math.abs(craft.speedScalar || 0);
    const gT = clamp(gnd / ROVER.maxSpeed, 0, 1.9);
    const rov = (mode === 'rover' ? 1 : 0) * SOUND.engineRover;
    const offGround = craft.airborne ? 0.5 : 1;
    // Motor pitch tracks road speed across roughly an octave and a half.
    L.roverMotor.set(
      rov * (0.030 + gT * 0.060 + boost * 0.045) * (1 - swamp * 0.55) * offGround,
      620 + gT * 1500 + boost * 700 - swamp * 200,
      92 + gT * 150,
      now, 0.05);
    L.roverRumble.set(
      rov * (0.045 + gT * 0.035) * (1 - swamp * 0.4) * offGround,
      150 + gT * 190, 32 + gT * 16, now, 0.06);
    L.roverRoad.set(
      rov * (craft.onWater ? 0 : 1) * gT * 0.045 * (craft.airborne ? 0.08 : 1),
      480 + gT * 1700, 0.75 + gT * 0.7, now, 0.06);

    const bT = clamp(craft.speed / BOAT.maxSpeed, 0, 1.7);
    const bo = (mode === 'boat' ? 1 : 0) * SOUND.engineBoat;
    const plane = craft.planeMix || 0;
    L.boatHum.set(bo * (0.05 + bT * 0.05 + boost * 0.04), 420 + bT * 1100, 62 + bT * 40, now, 0.06);
    // Ploughing churn fades out as the hull comes up...
    L.boatRush.set(bo * (craft.onWater ? 1 : 0.25) * (0.025 + bT * 0.085) * (1 - plane * 0.65),
      420 + bT * 2200, 0.7 + bT * 0.9, now, 0.07);
    // ...and the planing hiss fades in, so the transition is audible.
    L.boatPlane.set(bo * (craft.onWater ? 1 : 0) * plane * (0.02 + bT * 0.055),
      2200 + bT * 3000, 0.8 + bT * 0.8, now, 0.09);

    // Charge: pitch climbs with the wind-up so you can hear how far you are.
    const ch = craft.chargeT || 0;
    L.charge.set(ch > 0 ? 0.020 + ch * 0.055 : 0,
      900 + ch * 2600, 105 + ch * 300, now, 0.03);

    /* In hyper `craft.speed` runs to a million, which pins every speed-driven
       term at its clamp within a second and then says nothing for the rest of
       the trip. So the local terms are frozen at their top and the log-scaled
       hyperT takes over as the thing that moves — one number, the same one the
       camera and the shaders read, extending this path rather than forking it. */
    const hy = craft.hyperT || 0;
    const jT = craft.hyper ? 1.8 : clamp(craft.speed / JET.maxSpeed, 0, 1.8);
    const je = (mode === 'jet' ? 1 : 0) * SOUND.engineJet;
    // Thrust, not speed, drives the engine layers — gliding has to go quiet
    // even at 300km/h, and that contrast is most of the drama in a dead-stick.
    const thrust = craft.hyper ? 1 : (craft.glide ? 0 : clamp(0.45 + boost * 0.55, 0, 1));
    // Blade pitch climbs a full octave and a half across the trip. This is the
    // layer that carries the acceleration: everything else saturates.
    const blade = (190 + thrust * 460 + jT * 130) * (1 + hy * 1.55);

    L.jetCore.set(je * (0.075 + thrust * 0.10 + jT * 0.03) * (1 - hy * 0.55),
      70 + thrust * 90, 0.55 + thrust * 0.35, now, 0.10);
    // The roar thins out as the air does — by the cap there is nothing left for
    // an engine to shout into, and the mix opens up for the turbine.
    L.jetRoar.set(je * (0.035 + thrust * 0.11 + jT * 0.045) * (1 - hy * 0.45),
      340 + thrust * 900 + jT * 380 + hy * 900, 0.75 + thrust * 0.7, now, 0.08);
    L.jetTurbine.set(je * (0.010 + thrust * 0.032 + hy * 0.055),
      1500 + thrust * 3200 + hy * 3200, blade, now, 0.09);
    // The upper partial is what gives it that hollow turbine edge.
    L.jetBlade.set(je * (0.004 + thrust * 0.016 + boost * 0.010 + hy * 0.030),
      2600 + thrust * 3400 + hy * 4000, blade * 2.49, now, 0.09);
    // Airframe rush follows speed alone, so a glide still whistles.
    L.jetAir.set(je * (0.012 + jT * 0.055 + hy * 0.075), 2600 + jT * 3600 + hy * 4200,
      0.7 + jT * 0.7 + hy * 1.2, now, 0.12);

    // Afterburner: irregular low-frequency crackle on top of the roar. Random
    // spacing is the whole trick — an even rhythm sounds like a machine gun.
    if (mode === 'jet' && boost > 0.35 && !craft.glide) {
      this.burnTimer -= dt;
      if (this.burnTimer <= 0) {
        this.burnTimer = 0.045 + Math.random() * 0.075;
        this.e.hit({ at: now, dur: 0.07 + Math.random() * 0.06,
          gain: (0.030 + Math.random() * 0.045) * boost * SOUND.engineJet,
          type: 'bandpass', freq: 120 + Math.random() * 260, to: 60,
          q: 2.2, send: 0.25, pan: Math.random() * 1.4 - 0.7 });
      }
    }

    /* Skid and canopy, driven from state rather than fired as events. craft.skid
       falls from 1 to 0 across the slide, so these fade out ON the skid: the
       wash of a rover carrying into a lake and the scrape of a hull running up
       a beach both end when the sliding does, at whatever length that turned
       out to be. */
    const skid = craft.skid || 0;
    const wash = craft.skidKind === 'water' ? skid : 0;
    const scrape = craft.skidKind === 'beach' ? skid : 0;
    L.skidWash.set(wash * 0.075, 460 + wash * 2300, 0.5 + wash * 0.85, now, 0.08);
    L.skidScrape.set(scrape * 0.085, 250 + scrape * 950, 1.2 + scrape * 1.4, now, 0.08);
    // Fabric noise that rises as the canopy fills, so it reads as taking load.
    const cf = craft.chute || 0;
    L.chuteFlap.set(cf * 0.045, 380 + cf * 760, 0.7 + cf * 0.5, now, 0.15);

    // Wind rises with speed and with height — it's the altimeter you hear.
    const amb = SOUND.ambience;
    const alt = clamp((craft.pos.y - WORLD.waterY) / 320, 0, 1);
    const spd = craft.hyper ? 1 : clamp(craft.speed / 90, 0, 1);
    // Wind is an atmosphere effect and there is no atmosphere between worlds:
    // it fades out as the trip climbs, which is what leaves room for the
    // turbine to be the whole of the sound at the top.
    L.wind.set(amb * (0.016 + spd * 0.050 + alt * 0.045) * (1 - hy * 0.85),
      320 + spd * 900 + alt * 500, 0.6 + spd * 0.5, now, 0.2);

    // Water is audible whenever you're on or over it.
    const nearWater = craft.onWater ? 1 : 0;
    L.lap.set(amb * nearWater * (0.040 + clamp(craft.speed / 40, 0, 1) * 0.055),
      280 + craft.speed * 14, 0.5 + clamp(craft.speed / 40, 0, 1) * 0.6, now, 0.15);

    // Hull slap: a periodic knock whose rate follows speed.
    if (mode === 'boat' && craft.onWater && craft.speed > 6) {
      this.slapTimer -= dt;
      if (this.slapTimer <= 0) {
        this.slapTimer = 0.55 - clamp(craft.speed / BOAT.maxSpeed, 0, 1) * 0.34;
        this.e.hit({ at: now, dur: 0.11, gain: 0.05 + clamp(craft.speed / 60, 0, 1) * 0.09,
          type: 'lowpass', freq: 700, to: 200, q: 1.3, send: 0.3,
          pan: Math.random() * 1.2 - 0.6 });
      }
    }

    // Dry-cell alarm: two tones, three times, then it stops nagging.
    if (this.alarm > 0) {
      const prev = this.alarm;
      this.alarm -= dt;
      if (Math.floor(prev * 2) !== Math.floor(this.alarm * 2) && !this.e.muted) {
        const up = Math.floor(this.alarm * 2) % 2 === 0;
        this.e.note({ type: 'square', freq: up ? 660 : 495, at: now, dur: 0.18,
          gain: 0.10, filter: 2400, q: 1.5, send: 0.2 });
      }
    }

    this.lastMode = mode;
  }
}
