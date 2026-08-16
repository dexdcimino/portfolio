// data/biomes.js — biome ring defs by distance from origin (GDD "World"):
// Fungal (0–80) → Ember (80–200) → Frost (200–350) → Void (350+).
// carveThreshold: noise below it = open floor; lower = tighter cave (Void).
// Colors from ART_BIBLE palette, darkened for cave walls/floors/fog.

export const BIOME_BLEND_WIDTH = 40; // units — WIDE gradual blend between zones

export const BIOMES = [
  {
    key: 'fungal',
    range: [0, 80],
    wallColor: '#2E5F52',
    floorColor: '#13221E',
    fogColor: '#0B1512',
    fogDensity: 0.012,
    carveThreshold: 0.65,
    waterColor: '#2E6FA8',
    accentColor: '#C8E84A',
    accentColor2: '#9A5FD0',
    spawnWeights: {}, // filled MD-05/07
  },
  {
    key: 'ember',
    range: [80, 200],
    wallColor: '#5C3120',
    floorColor: '#1F1310',
    fogColor: '#150D08',
    fogDensity: 0.014,
    carveThreshold: 0.62,
    waterColor: '#B08A3E',
    accentColor: '#FFB03C',
    accentColor2: '#FF5A3C',
    spawnWeights: {}, // filled MD-05/07
  },
  {
    key: 'frost',
    range: [200, 350],
    wallColor: '#2C4A66',
    floorColor: '#101B26',
    fogColor: '#0A121C',
    fogDensity: 0.016,
    carveThreshold: 0.6,
    waterColor: '#7FD4FF',
    accentColor: '#A8E8FF',
    accentColor2: '#7FCFC0',
    spawnWeights: {}, // filled MD-05/07
  },
  {
    key: 'void',
    range: [350, Infinity],
    wallColor: '#452B62',
    floorColor: '#150D20',
    fogColor: '#0D0716',
    fogDensity: 0.02,
    carveThreshold: 0.56, // still tightest ring
    waterColor: '#5B3FA0',
    accentColor: '#B45BFF',
    accentColor2: '#FF5A3C',
    spawnWeights: {}, // filled MD-05/07
  },
];

// Biome whose ring contains this distance from origin.
export function biomeAt(dist) {
  for (const b of BIOMES) if (dist < b.range[1]) return b;
  return BIOMES[BIOMES.length - 1];
}

// Color blending near ring borders: returns { a, b, t } where t∈[0,1] blends
// a→b across BIOME_BLEND_WIDTH centred on the border. Pure ring ⇒ t = 0, a = b.
export function biomeBlendAt(dist) {
  const half = BIOME_BLEND_WIDTH / 2;
  for (let i = 0; i < BIOMES.length - 1; i++) {
    const border = BIOMES[i].range[1];
    if (dist >= border - half && dist <= border + half) {
      return { a: BIOMES[i], b: BIOMES[i + 1], t: (dist - (border - half)) / BIOME_BLEND_WIDTH };
    }
  }
  const b = biomeAt(dist);
  return { a: b, b, t: 0 };
}
