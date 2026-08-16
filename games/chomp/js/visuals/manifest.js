// visuals/manifest.js — ★ THE SWAP FILE ★ (TECH.md asset-swap contract).
// The ONLY file you touch to swap art. Key naming per ART_BIBLE:
// file name = key with dots→underscores, dropped into assets/.
//
// HOW TO SWAP (one line, zero code changes):
//   { type: 'proc' }                                 procedural placeholder (default)
//   { type: 'glb', src: 'models/mawling_s3.glb' }    3D model from assets/models/
//   (2D sprite pipeline REMOVED — this game is 3D-only now.)
//
// Missing key, missing file, or failed load ⇒ automatic proc fallback.
// The game NEVER breaks on assets.

export const MANIFEST = {
  // Player evolution stages (GDD stage table)
  'player.s1': { type: 'proc' },
  'player.s2': { type: 'proc' },
  'player.s3': { type: 'proc' },
  'player.s4': { type: 'proc' },
  'player.s5': { type: 'proc' },

  // Foods (GDD food table)
  'food.glowmote': { type: 'proc' },
  'food.cagedOrb': { type: 'proc' },
  'food.emberClutch': { type: 'proc' },
  'food.frostEgg': { type: 'proc' },
  'food.ghostSlime': { type: 'proc' },
  'food.marrowCrystal': { type: 'proc' },
  'food.urchin': { type: 'proc' },
  'food.voidShard': { type: 'proc' },
  'food.leechEye': { type: 'proc' },

  // Enemies (GDD enemy table)
  'enemy.nibbler': { type: 'proc' },
  'enemy.spikeball': { type: 'proc' },
  'enemy.urchin': { type: 'proc' },
  'enemy.voidShard': { type: 'proc' },
  'enemy.lancer': { type: 'proc' },
  'enemy.leech': { type: 'proc' },
  'enemy.gulper': { type: 'proc' },
  'enemy.elderMaw': { type: 'proc' },
};
