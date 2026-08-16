// data/stages.js — 5 evolution stage defs (GDD "Mass, growth, evolution").
// mass = threshold to reach the stage. camDist lives in config.camera.

export const STAGES = [
  { key: 'wisp', name: 'Wisp', mass: 0 },
  { key: 'tuft', name: 'Tuft', mass: 20 },
  { key: 'shag', name: 'Shag', mass: 60 },
  { key: 'brute', name: 'Brute', mass: 150 },
  { key: 'maw', name: 'Maw', mass: 350 },
];

// Authored visual radius per stage (ART_BIBLE GLB spec: s1 0.35 … s5 2.0).
export const STAGE_RADII = [0.35, 0.55, 0.85, 1.3, 2.0];
