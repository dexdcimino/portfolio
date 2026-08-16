// data/enemies.js — enemy table. THREAT RULE (design direction): an enemy is
// a predator ONLY while its body radius is LARGER than the player's current
// radius; at equal-or-smaller size it is prey — flees and can be eaten.
// The player's radius grows continuously, so enemies flip naturally mid-stage.
// visualScale scales the mounted proc/sprite so on-screen size matches radius.

export const ENEMIES = {
  nibbler: {
    deathType: 'popped', // (can never kill — smaller than any player)
    radius: 0.3, // smaller than a Wisp (0.35) ⇒ NEVER a threat, always a snack
    visualScale: 1.7,
    massGain: 2,
    knockback: 6,
    seekSpeed: 2.6,
    fleeSpeed: 2.2,
    driftSpeed: 0.9,
    aggroRange: 12,
    fleeRange: 10,
    retreatSec: 0,
  },
  urchin: {
    deathType: 'popped', // spiked — you burst and deflate
    radius: 0.5, // predator only until the player outgrows 0.5 (mid stage 1)
    visualScale: 1.1,
    massGain: 8,
    knockback: 12,
    seekSpeed: 2.0,
    fleeSpeed: 1.8,
    driftSpeed: 0.7,
    aggroRange: 12, // ~screen edge — no ambushes out of the dark
    fleeRange: 12,
    retreatSec: 0,
  },
  voidShard: {
    deathType: 'popped', // jagged shard — same fate
    radius: 0.75, // stays scary until well into stage 2
    visualScale: 1.7,
    massGain: 15,
    knockback: 10,
    seekSpeed: 2.4,
    fleeSpeed: 2.0,
    driftSpeed: 0.6,
    aggroRange: 11,
    fleeRange: 12,
    retreatSec: 1.0, // bites then backs off (GDD)
  },
  spikeball: {
    deathType: 'popped', // impaled — obviously
    stationary: true,    // it's a plant. It does not chase. It doesn't need to.
    alwaysHostile: true, // NEVER edible — "eating" it means touching it: damage
    radius: 0.55,        // baseline; spawner varies instances 0.35–0.9
    visualScale: 1.3,
    massGain: 0,
    knockback: 14,
    trigger: {
      rangeMult: 2.6, // spikes FIRE when the player is within radius × this
      reachMult: 1.9, // extended spikes damage within radius × this
      spikeSec: 0.9,  // how long the spikes stay out per volley
    },
    seekSpeed: 0, fleeSpeed: 0, driftSpeed: 0, aggroRange: 0, fleeRange: 0, retreatSec: 0,
  },
  lancer: {
    deathType: 'popped', // impaled on a bone dart
    radius: 0.9, // big — scary well into stage 3
    visualScale: 1.5,
    massGain: 20,
    knockback: 18,
    seekSpeed: 0, // it never chases — it CHARGES (see charger)
    fleeSpeed: 2.2,
    driftSpeed: 1.0,
    aggroRange: 9,     // must be ON SCREEN before it winds up — no dark-charge kills
    fleeRange: 12,
    retreatSec: 0,
    charger: {
      telegraphSec: 0.8, // long, readable shake before committing
      chargeSpeed: 8,    // fast but dodgeable
      chargeMaxSec: 1.2,
      stunSec: 1.2,      // wall bonk ⇒ stunned, edible even while bigger
    },
  },
  gulper: {
    deathType: 'eaten', // it has a maw — it USES it
    radius: 1.3, // floor — spawnSizeMult overrides per instance
    spawnSizeMult: 1.4, // sized ×1.4 the PLAYER's radius when first encountered (GDD)
    visualScale: 1,
    massGain: 40,
    knockback: 16,
    seekSpeed: 3.1, // faster than you — outrun it with sprint or lose it in tunnels
    fleeSpeed: 2.4,
    driftSpeed: 0.8,
    aggroRange: 16,
    fleeRange: 14,
    retreatSec: 0,
  },
  // TODO: lancer, leech, elderMaw (later MDs)
};
