// Audio director. Owns the graph, the sequencer and the effects, and turns
// craft state into the one number the arrangement actually follows.

import { AudioEngine } from './engine.js';
import { Music } from './music.js';
import { Sfx } from './sfx.js';
import { ROVER, BOAT, JET, DRONE, WORLD } from '../tune.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Sound {
  constructor() {
    this.engine = new AudioEngine();
    this.music = new Music(this.engine);
    this.sfx = new Sfx(this.engine, this.music);
    this.started = false;
    this.live = false;
    this.submerged = 0;
  }

  get available() { return this.engine.ready; }
  get muted() { return this.engine.muted; }

  /** From a user gesture only — browsers will not start a context otherwise. */
  start() {
    if (this.started) return this.engine.ready;
    if (!this.engine.start()) return false;
    this.started = true;
    this.finishStart();
    return true;
  }

  /**
   * A context can exist but still be suspended — autoplay policy, or a tab
   * that was backgrounded at the wrong moment. Building the voices then means
   * every held source logs a warning and starts life muted, so the second half
   * of startup waits until the clock is genuinely running.
   */
  finishStart() {
    if (this.live || !this.engine.running) return;
    this.sfx.build();
    this.music.start();
    this.live = true;
  }

  /** The pause menu's mixer, straight through to the graph. */
  setLevels(levels) { this.engine.setLevels(levels); }

  /** Silence while the menu is up, without touching the player's mute. */
  setPaused(on) { this.engine.setPaused(on); }

  toggleMute() {
    this.engine.setMuted(!this.engine.muted);
    return this.engine.muted;
  }

  update(dt, craft, playing) {
    if (!this.engine.ready) return;
    if (this.started && !this.live) this.finishStart();

    // Intensity: what the arrangement follows. Flying is the top of the
    // arrangement, parked on a hillside is the bottom.
    let want = 0.14;
    if (playing) {
      const boost = craft.boostHeat;
      if (craft.hyper) {
        // Between worlds the arrangement goes to the top and stays there, and
        // the last stretch of the climb pushes past what flying can reach.
        // Symmetric for free: hyperT falls on approach exactly as it rose.
        want = 0.82 + craft.hyperT * 0.18;
      } else if (craft.mode === 'jet') {
        want = 0.74 + clamp(craft.speed / JET.maxSpeed, 0, 1) * 0.20 + boost * 0.12;
        if (craft.glide) want -= 0.16;
      } else if (craft.mode === 'drone') {
        // Airborne but deliberate: above the ground forms, below the jet.
        want = 0.42 + clamp(craft.speed / DRONE.maxSpeed, 0, 1) * 0.22 + boost * 0.12;
      } else if (craft.mode === 'boat') {
        want = 0.28 + clamp(craft.speed / BOAT.maxSpeed, 0, 1) * 0.46 + boost * 0.18;
      } else {
        want = 0.20 + clamp(Math.abs(craft.speedScalar) / ROVER.maxSpeed, 0, 1) * 0.50
          + boost * 0.20;
        if (craft.swamp > 0.5) want *= 1 - craft.swamp * 0.55;   // drop out as you go under
      }
    }
    this.music.update(dt, clamp(want, 0, 1), craft.mode, craft.boostHeat);
    this.sfx.update(dt, craft);

    // Underwater: driven by how far the hull is under, so the mix closes up
    // as the lake takes you.
    const under = craft.sinkY > 0
      ? clamp(craft.sinkY / Math.max(0.5, ROVER.drownDepth), 0, 1)
      : (craft.pos.y < WORLD.waterY - 0.5 ? 0.5 : 0);
    if (Math.abs(under - this.submerged) > 0.01) {
      this.submerged = under;
      this.engine.setSubmerged(under);
    }
  }
}
