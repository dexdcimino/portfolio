// systems/combat.js — eat resolution + growth (GDD "Eating rules"):
// - passive eat: stage ≥ sizeClass, target in the front mouth cone
//   (radius × mouth.coneRadiusMult) while moving
// - CHOMP: same class rule, eat radius × chomp.eatRadiusMult
// - evolve at stage thresholds (de-evolve with 15% hysteresis), death at
//   stage 1 below eat.deathMass. Emits player:eat/evolve/devolve/death.
// Also returns mouthTarget (0..1) so the mouth opens as food approaches.

import { CONFIG } from '../config.js';
import { emit } from '../core/events.js';
import { STAGES } from '../data/stages.js';
import { playerRadius } from '../entities/player.js';

export function updateCombat(player, foodSys, enemySys, dt) {
  const r = playerRadius(player);
  const chomping = player.chomp.active;
  const eatR = r * CONFIG.mouth.coneRadiusMult * (chomping ? CONFIG.chomp.eatRadiusMult : 1);
  const proxR = r * CONFIG.eat.mouthProximityMult;
  const fx = Math.sin(player.facing);
  const fz = Math.cos(player.facing);
  const canEatNow = player.speed > CONFIG.eat.minEatSpeed || chomping;
  let mouthTarget = 0;

  for (const src of [foodSys, enemySys]) {
    for (const it of src.edibles(player)) {
      if (player.stage < it.sizeClass) continue; // still outclasses us
      const dx = it.x - player.x;
      const dz = it.z - player.z;
      if (dx * fx + dz * fz <= 0) continue; // behind us — mouth is up front
      const dist = Math.hypot(dx, dz);
      if (canEatNow && dist < eatR + it.radius) {
        it.eat();
        player.mass += it.massGain;
        player.gobbled = (player.gobbled ?? 0) + 1;
        emit('player:eat', { massGain: it.massGain, mass: player.mass });
      } else if (dist < proxR + it.radius) {
        mouthTarget = Math.max(mouthTarget, 1 - dist / (proxR + it.radius));
      }
    }
  }

  // Evolve / de-evolve / death
  while (player.stage < STAGES.length && player.mass >= STAGES[player.stage].mass) {
    player.stage++;
    emit('player:evolve', { stage: player.stage });
  }
  const floor = STAGES[player.stage - 1].mass;
  if (player.stage > 1 && player.mass < floor * (1 - CONFIG.evolve.deEvolveHysteresis)) {
    player.stage--;
    emit('player:devolve', { stage: player.stage });
  }
  // Death: out of HP (hits), or eaten down below viability at stage 1.
  // Carries the cause so main can play the right cinematic (eaten vs popped).
  if (!player.deathEmitted && (player.hp <= 0 || (player.stage === 1 && player.mass <= CONFIG.eat.deathMass))) {
    player.deathEmitted = true;
    emit('player:death', player.hp <= 0 ? player.lastHit ?? {} : { deathType: 'popped' });
  }

  return { mouthTarget };
}
