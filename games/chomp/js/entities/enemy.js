// entities/enemy.js — enemy instances in chunk records (rec.enemies).
// THREAT RULE: predator only while physically BIGGER than the player (radius
// vs radius) — equal or smaller = prey. Logic only; visuals via factory.
// Activation is NEAREST-FIRST (optimization/correctness pass): candidates are
// sorted by distance before mounting, so a predator on top of the player can
// never be starved of a visual slot by a distant nibbler swarm. Stationary
// plants never count against the mobile cap.

import { CONFIG } from '../config.js';
import { ENEMIES } from '../data/enemies.js';
import { emit } from '../core/events.js';
import { playerRadius } from './player.js';

export function createEnemySystem(world, factory) {
  let t = 0;

  function deactivate(e) {
    e.handle?.dispose();
    e.handle = null;
  }

  return {
    update(player, dt) {
      t += dt;
      const actR2 = CONFIG.eat.activeRadius ** 2;
      const deactR2 = (CONFIG.eat.activeRadius + CONFIG.eat.deactivateSlack) ** 2;
      const pr = playerRadius(player);

      // Pass 1: gather — deactivate far, collect mount candidates + live set
      const candidates = [];
      const live = [];
      let mobileActive = 0;
      for (const rec of world.chunks.values()) {
        if (!rec.enemies) continue;
        for (const e of rec.enemies) {
          if (e.dead) {
            if (e.handle) deactivate(e);
            continue;
          }
          const def = ENEMIES[e.key];
          const dx = player.x - e.x;
          const dz = player.z - e.z;
          const d2 = dx * dx + dz * dz;
          if (e.handle && d2 > deactR2) {
            deactivate(e);
            continue;
          }
          if (!e.handle) {
            if (d2 < actR2) candidates.push({ e, def, d2 });
            continue;
          }
          if (!def.stationary) mobileActive++;
          live.push({ e, def, dx, dz, dist: Math.sqrt(d2) });
        }
      }

      // Pass 2: mount nearest-first up to the mobile cap
      candidates.sort((a, b) => a.d2 - b.d2);
      for (const c of candidates) {
        if (!c.def.stationary && mobileActive >= CONFIG.spawn.maxActiveEnemies) continue;
        c.e.handle = factory.mount('enemy.' + c.e.key);
        // Gulper rule (GDD): sized relative to the PLAYER when first
        // encountered — always ×spawnSizeMult your radius, always scary.
        if (c.def.spawnSizeMult && c.e.radius == null) {
          c.e.radius = Math.max(c.def.radius, pr * c.def.spawnSizeMult);
        }
        if (!c.def.stationary) mobileActive++;
        const dx = player.x - c.e.x;
        const dz = player.z - c.e.z;
        live.push({ e: c.e, def: c.def, dx, dz, dist: Math.hypot(dx, dz) });
      }

      // Pass 3: behavior for everything mounted
      for (const { e, def, dx, dz, dist } of live) {
        const radius = e.radius ?? def.radius;
        e.retreatT = Math.max(0, (e.retreatT ?? 0) - dt);
        const predator = radius > pr;
        let sx = 0, sz = 0, speed = def.driftSpeed;
        let biteAllowed = true;

        if (def.stationary) {
          // Spikeball plant: rooted. Close approach fires the spike volley;
          // extended spikes damage anything in reach — ANY size (touching
          // or trying to eat it is the mistake).
          e.spikeT = Math.max(0, (e.spikeT ?? 0) - dt);
          const T = def.trigger;
          if (e.spikeT === 0 && dist < radius * T.rangeMult) e.spikeT = T.spikeSec;
          const spiked = e.spikeT > 0;
          const sfh = world.floorHeight(e.x, e.z);
          e.handle.root.position.set(e.x, sfh, e.z);
          e.handle.root._baseY = sfh;
          e.handle.setPose({
            facing: e.phase, // rooted — no turning
            bob: Math.sin(t * 1.1 + e.phase) * 0.02,
            scale: (radius / def.radius) * (def.visualScale ?? 1),
            spike: spiked ? 1 : 0,
            threat: true,
          });
          if (spiked && dist < pr + radius * T.reachMult && player.iframes <= 0) {
            player.hp -= 1;
          player.sinceDamage = 0;
          player.regenAcc = 0;
            player.iframes = CONFIG.combat.iFramesSec;
            player.lastHit = { key: e.key, deathType: def.deathType, enemy: e };
            if (dist > 0.01) {
              player.vx = (dx / dist) * -def.knockback;
              player.vz = (dz / dist) * -def.knockback;
            }
            emit('player:damage', { by: e.key });
          }
          continue;
        }

        if (def.charger) {
          // wander → telegraph → charge → wall-bonk-stun; edible while stunned
          const C = def.charger;
          e.cstate ??= 'idle';
          e.cT = (e.cT ?? 0) - dt;
          if (e.cstate === 'idle') {
            sx = Math.sin(t * 0.3 + e.phase); sz = Math.cos(t * 0.4 + e.phase);
            biteAllowed = false;
            if (predator && dist < def.aggroRange) { e.cstate = 'tele'; e.cT = C.telegraphSec; }
          } else if (e.cstate === 'tele') {
            // shake in place, locked on
            sx = Math.sin(t * 40) * 0.25; sz = Math.cos(t * 43) * 0.25;
            biteAllowed = false;
            if (e.cT <= 0 && dist > 0.01) {
              e.cdx = dx / dist; e.cdz = dz / dist;
              e.cstate = 'charge'; e.cT = C.chargeMaxSec;
            }
          } else if (e.cstate === 'charge') {
            sx = e.cdx; sz = e.cdz; speed = C.chargeSpeed;
          } else { // stunned — helpless snack
            sx = 0; sz = 0; speed = 0;
            biteAllowed = false;
            if (e.cT <= 0) e.cstate = 'idle';
          }
        } else if (e.retreatT > 0 && dist > 0.01) {
          sx = -dx / dist; sz = -dz / dist; speed = def.seekSpeed;
        } else if (predator && dist < def.aggroRange && dist > 0.01) {
          sx = dx / dist; sz = dz / dist; speed = def.seekSpeed;
        } else if (!predator && dist < def.fleeRange && dist > 0.01) {
          sx = -dx / dist; sz = -dz / dist; speed = def.fleeSpeed;
        } else {
          sx = Math.sin(t * 0.3 + e.phase); sz = Math.cos(t * 0.4 + e.phase);
        }
        const res = world.circleSlide(e.x, e.z, radius, sx * speed * dt, sz * speed * dt);
        if (def.charger && e.cstate === 'charge' && (res.hitNormal || e.cT <= 0)) {
          e.cstate = 'stun'; // BONK — spiked into the wall
          e.cT = def.charger.stunSec;
        }
        e.x = res.x; e.z = res.z;
        const fh = world.floorHeight(e.x, e.z);
        e.handle.root.position.set(e.x, fh, e.z);
        e.handle.root._baseY = fh; // pose recomputes y from _baseY + bob
        e.handle.setPose({
          facing: speed > 1 && (sx || sz) ? Math.atan2(sx, sz) : t * 0.8 + e.phase,
          bob: Math.sin(t * 2.4 + e.phase) * 0.06,
          scale: (radius / def.radius) * (def.visualScale ?? 1), // screen size = threat size
          threat: predator && e.cstate !== 'stun', // stunned = green-eyed snack
        });

        // Predator contact = bite: 1 HP + knockback + i-frames
        if (predator && biteAllowed && e.retreatT === 0 && dist < pr + radius && player.iframes <= 0) {
          player.hp -= 1;
          player.sinceDamage = 0;
          player.regenAcc = 0;
          player.iframes = CONFIG.combat.iFramesSec;
          player.lastHit = { key: e.key, deathType: def.deathType, enemy: e }; // death cinematic cause
          if (dist > 0.01) {
            player.vx = (-dx / dist) * def.knockback;
            player.vz = (-dz / dist) * def.knockback;
          }
          if (def.retreatSec > 0) e.retreatT = def.retreatSec;
          emit('player:damage', { by: e.key });
        }
      }
    },

    // Prey-mode enemies as edible targets: yielded only while the player's
    // radius is at least the enemy's (size rule — no stage gate).
    *edibles(player) {
      const pr = playerRadius(player);
      for (const rec of world.chunks.values()) {
        if (!rec.enemies) continue;
        for (const e of rec.enemies) {
          if (e.dead || !e.handle) continue;
          const def = ENEMIES[e.key];
          if (def.alwaysHostile) continue; // spikeball: never food, only regret
          const radius = e.radius ?? def.radius;
          const stunnedSnack = def.charger && e.cstate === 'stun'; // bonked lancer: fair game at any size
          if (radius > pr && !stunnedSnack) continue; // still bigger than us — not food yet
          yield {
            x: e.x,
            z: e.z,
            sizeClass: 1, // size rule already applied above
            radius,
            massGain: def.massGain,
            eat: () => {
              e.dead = true;
              deactivate(e);
            },
          };
        }
      }
    },
  };
}
