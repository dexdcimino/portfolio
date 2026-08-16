// entities/food.js — food instances living in chunk records (world/spawner.js
// fills rec.foods). Visuals mount only within eat.activeRadius of the player
// and unmount beyond (+slack), so hundreds of spawned foods cost nothing.
// Logic only owns data; meshes come exclusively from the factory.

import { CONFIG } from '../config.js';
import { FOODS } from '../data/foods.js';

export function createFoodSystem(world, factory) {
  let t = 0;

  function deactivate(f) {
    f.handle?.dispose();
    f.handle = null;
  }

  return {
    update(player, dt) {
      t += dt;
      const actR2 = CONFIG.eat.activeRadius ** 2;
      const deactR2 = (CONFIG.eat.activeRadius + CONFIG.eat.deactivateSlack) ** 2;
      for (const rec of world.chunks.values()) {
        if (!rec.foods) continue;
        for (const f of rec.foods) {
          if (f.taken) {
            if (f.handle) deactivate(f);
            continue;
          }
          const d2 = (f.x - player.x) ** 2 + (f.z - player.z) ** 2;
          if (d2 < actR2 && !f.handle) {
            f.handle = factory.mount('food.' + f.key);
            const fh = world.floorHeight(f.x, f.z);
            f.handle.root.position.set(f.x, fh, f.z);
            f.handle.root._baseY = fh; // pose recomputes y from _baseY + bob
          } else if (d2 > deactR2 && f.handle) {
            deactivate(f);
          }
          if (f.handle) {
            f.handle.setPose({ bob: Math.sin(t * 2 + f.phase) * 0.08, facing: t * 0.6 + f.phase });
          }
        }
      }
    },

    // Active, uneaten foods as generic edible targets for combat.
    *edibles() {
      for (const rec of world.chunks.values()) {
        if (!rec.foods) continue;
        for (const f of rec.foods) {
          if (f.taken || !f.handle) continue;
          const def = FOODS[f.key];
          yield {
            x: f.x,
            z: f.z,
            sizeClass: def.sizeClass,
            radius: def.radius,
            massGain: def.mass,
            eat: () => {
              f.taken = true;
              deactivate(f);
            },
          };
        }
      }
    },
  };
}
