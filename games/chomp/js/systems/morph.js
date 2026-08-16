// systems/morph.js — THE feel (TECH.md §Morph, MD-04 §2). Pure logic, no
// Babylon: computes an art-agnostic morphState each frame from player physics:
//   { stretch, squash, mouthOpen, bank, bob, breathe, facing, tint, alpha }
// Critically-damped springs (stretch in 120ms / out 250ms), bonk squash pulse,
// idle breathing + hover bob (visual only — never touches position).

import { CONFIG } from '../config.js';

const C = () => CONFIG.morph;

// Critically-damped spring step; tau = time to reach ~90% of the target
// (critically damped response hits 90% at ω·t ≈ 3.9).
function spring(state, target, tau, dt) {
  const omega = 3.9 / tau;
  const x = state.pos - target;
  const temp = (state.vel + omega * x) * dt;
  const decay = Math.exp(-omega * dt);
  state.vel = (state.vel - omega * temp) * decay;
  state.pos = target + (x + temp) * decay;
}

export function createMorph() {
  return {
    t: 0,
    stretch: { pos: 0, vel: 0 },
    mouth: { pos: 0, vel: 0 },
    bite: { pos: 0, vel: 0 }, // chomp/gulp only — no ambient proximity
    bank: { pos: 0, vel: 0 },
    bonkT: Infinity, // time since last bonk
    gulpT: Infinity, // time since last eat gulp
  };
}

export function morphOnBonk(m) {
  m.bonkT = 0;
}

// Auto-eat gulp: quick full-mouth pulse + a little swallow squash, so passive
// eating reads as real chomping, not vacuuming.
export function morphOnGulp(m) {
  m.gulpT = 0;
}

// opts.mouthTarget: MD-05 hook for food-proximity mouth opening (0..1).
export function updateMorph(m, player, dt, opts = {}) {
  const cfg = C();
  m.t += dt;
  m.bonkT += dt;
  m.gulpT += dt;

  const speedFrac = player.maxSpeed > 0 ? Math.min(1, player.speed / player.maxSpeed) : 0;

  // Stretch: fast in, slow out — the comet feel
  const stretchTarget = player.chomp.active ? 1.2 : speedFrac;
  spring(m.stretch, stretchTarget, stretchTarget > m.stretch.pos ? cfg.stretchIn : cfg.stretchOut, dt);

  // Mouth: chomp forces full open; food proximity pre-opens; a gulp pulse
  // slams it open briefly on every eat (auto or chomped).
  const gulping = m.gulpT < cfg.gulpSec;
  const gulpBoost = gulping ? Math.sin((m.gulpT / cfg.gulpSec) * Math.PI) : 0;
  const mouthTarget = Math.max(player.chomp.active ? 1 : 0, opts.mouthTarget ?? 0, gulpBoost);
  spring(m.mouth, mouthTarget, mouthTarget > m.mouth.pos ? cfg.mouthIn : cfg.mouthOut, dt);
  // bite excludes proximity — drives the big body moves (pitch, head swell)
  const biteTarget = Math.max(player.chomp.active ? 1 : 0, gulpBoost);
  spring(m.bite, biteTarget, biteTarget > m.bite.pos ? cfg.mouthIn : cfg.mouthOut, dt);

  // Bank from angular velocity (the "curl" pose)
  const bankTarget = Math.max(-cfg.bankMax, Math.min(cfg.bankMax, player.angVel * cfg.bankScale));
  spring(m.bank, bankTarget, cfg.bankSmooth, dt);

  // Bonk: squash pulse 1 → peak → 1 over bonkPulseSec; gulp adds a swallow
  let squash = 0;
  if (m.bonkT < cfg.bonkPulseSec) {
    squash = Math.sin((m.bonkT / cfg.bonkPulseSec) * Math.PI) * cfg.bonkSquashAmp;
  }
  if (gulping) squash = Math.max(squash, gulpBoost * cfg.gulpSquash);

  // Idle life: breathing fades out with speed; hover bob always on
  const breathe = cfg.breatheAmp * Math.sin(cfg.breatheOmega * m.t) * (1 - speedFrac);
  const bob = cfg.bobAmp * Math.sin(cfg.bobOmega * m.t);

  return {
    stretch: Math.max(0, m.stretch.pos),
    squash,
    mouthOpen: Math.max(0, Math.min(1, m.mouth.pos)),
    bite: Math.max(0, Math.min(1, m.bite.pos)),
    bank: m.bank.pos,
    bob,
    breathe,
    squeeze: player.squeeze ?? 0, // oozing through a tight gap (already smoothed)
    facing: player.facing,
    tint: null,
    alpha: 1,
  };
}
