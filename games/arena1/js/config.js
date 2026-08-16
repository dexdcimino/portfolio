// config.js — every tunable in one place (embed contract #8).
//
// TUNE is the prototype's object VERBATIM (reference/prototype.html, line
// ~555). These values are the asset — the feel was tuned by hand and they
// carry across unchanged. Phase 3's gate is Dex playing both builds
// side-by-side; do not "improve" a value here to fix a solver bug there.
export const TUNE = {
  G: -30, WALK: 9.2, ACCEL: 70, FRICTION: 11, AIR_ACCEL: 26, AIR_DRAG: 0.12,
  JUMP: 11.5, DASH: 19, DASH_T: 0.5, DASH_CD: 2.6, SLIDE_MAX: 15.5, SLIDE_FRICTION: 0.85,
  WALLJUMP_UP: 10, WALLJUMP_OUT: 8.5, SENS: 0.0022,
  JET_ACCEL: 52, JET_VMAX: 14.5, JET_BURN: 26, FUEL_REGEN: 16,
  // Air regen is its own rate, deliberately well under FUEL_REGEN. MD 15 made
  // regen ungated at the ground rate, which put the sustainable jet duty cycle
  // at 16/26 = 62% — high enough that staying airborne was free and the ground
  // game became optional. At 7 the break-even is 7/26 = 27%: topping up
  // between bursts still works, holding the jet still drains, and continuous
  // flight is 5.3s on a full tank instead of 10s.
  AIR_REGEN: 7,
  /* MD 20: a DELAY before air regen starts, not another rate cut. Lowering the
     rate only moves the break-even duty cycle (MD 16 put it at 7/26 = 27%);
     it never removes it, because tapping under the threshold is always
     available. The delay removes the strategy instead:
       holding altitude needs a duty cycle of g/JET_ACCEL = 30/52 = 58%
       earning any regen needs 2s with NO jet input
     and those two cannot both be true. At 58% duty the timer never expires, so
     regen never runs; to let it run you must fall for 2s (60m). Ground regen
     deliberately does NOT wait — see movement.js. */
  AIR_REGEN_DELAY_TICKS: 120,   // 2.0s
  GRAPPLE_RANGE: 75, GRAPPLE_PULL: 24, GRAPPLE_ACCEL: 14,
};

// Sim/network constants (ARENA1_STEPS.md at the repo root, "Wire formats").
export const SIM_DT = 1 / 60;            // fixed step; render interpolates
export const PVP_DEFAULT = true;         // sim-level flag, one combat path
export const SNAPSHOT_RATE_NET = 20;     // Hz, host -> peers (Phase 7)
export const INTERP_BUFFER_MS = 100;     // client-side snapshot buffer (Phase 7)
