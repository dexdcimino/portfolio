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
  GRAPPLE_RANGE: 75, GRAPPLE_PULL: 24, GRAPPLE_ACCEL: 14,
};

// Sim/network constants (ARENA1_STEPS "Wire formats").
export const SIM_DT = 1 / 60;            // fixed step; render interpolates
export const PVP_DEFAULT = true;         // sim-level flag, one combat path
export const SNAPSHOT_RATE_NET = 20;     // Hz, host -> peers (Phase 7)
export const INTERP_BUFFER_MS = 100;     // client-side snapshot buffer (Phase 7)
