// data/foods.js — food table (GDD "Food table"). sizeClass = min stage to eat
// (passive needs stage ≥ sizeClass; chomp widens the reach, not the class).
// radius = pickup size for the mouth-cone test. ability wired in a later MD.

export const FOODS = {
  glowmote: { sizeClass: 1, mass: 1, radius: 0.25, ability: null }, // bread & butter, spawns in clusters
  cagedOrb: { sizeClass: 3, mass: 12, radius: 0.4, ability: null }, // TODO: chomp-only shell crack
  emberClutch: { sizeClass: 2, mass: 4, radius: 0.35, ability: 'BURN' }, // TODO(abilities MD)
  frostEgg: { sizeClass: 2, mass: 4, radius: 0.35, ability: 'FROST' },
  ghostSlime: { sizeClass: 2, mass: 3, radius: 0.35, ability: 'PHASE' },
  marrowCrystal: { sizeClass: 2, mass: 2, radius: 0.3, ability: 'RICH' },
  urchin: { sizeClass: 3, mass: 8, radius: 0.4, ability: 'SPIKES' },
  voidShard: { sizeClass: 4, mass: 15, radius: 0.4, ability: 'VOID' },
  leechEye: { sizeClass: 4, mass: 10, radius: 0.35, ability: 'SIGHT' },
};
