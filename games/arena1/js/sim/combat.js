// sim/combat.js — hitscan (ARENA1_STEPS Phase 5): FIRE → the sim raycasts
// against level ∪ enemies ∪ players and resolves the nearest. PvE and PvP
// share this one path with a single branch: hits on players apply damage only
// when sim.pvp is true. Resolution emits events; the renderer maps them to
// hitmark/tracer/damage number/feed and NEVER mutates hp.
//
// Prototype source: shoot() at reference/prototype.html 926–954 (0.11s
// cadence, dmg 1 vs 3/2/2-hp enemies, knockback dir*4 + vy 2.5).

import { SIM_DT } from '../config.js';
import { CAPSULE_R, CAPSULE_HALF_H, raySphere, rayVCapsule } from './world.js';
import { BTN, ENEMY_R, hurtPlayer } from './movement.js';
import { killEnemy } from './enemies.js';

const FIRE_CD = 0.11; // prototype cadence
const RANGE = 250;
const EYE_H = 0.55;
// v1 decision, not TUNE's: 12/hit ≈ 1s time-to-kill at full cadence against
// 100 hp — arena-fast without being instant.
const PLAYER_DMG = 12;

export function stepCombat(ctx, p, buttons) {
  p.fireCd -= SIM_DT;
  if (!(buttons & BTN.FIRE) || p.fireCd > 0) return;
  p.fireCd = FIRE_CD;

  const eye = { x: p.pos.x, y: p.pos.y + EYE_H, z: p.pos.z };
  const cp = Math.cos(p.pitch);
  const dir = { x: Math.sin(p.yaw) * cp, y: -Math.sin(p.pitch), z: Math.cos(p.yaw) * cp };
  const at = (t) => ({ x: eye.x + dir.x * t, y: eye.y + dir.y * t, z: eye.z + dir.z * t });

  const wh = ctx.world.raycast(eye, dir, RANGE);
  let bestT = wh ? wh.t : RANGE;
  let best = null; // null = world/nothing
  for (const e of ctx.ents.enemies.values()) {
    if (!e.alive) continue;
    const t = raySphere(eye, dir, e.pos, ENEMY_R[e.kind], bestT);
    if (t !== null) { bestT = t; best = { type: 'enemy', e }; }
  }
  for (const q of ctx.ents.players.values()) {
    if (q.id === p.id) continue;
    const t = rayVCapsule(eye, dir, q.pos, CAPSULE_R, CAPSULE_HALF_H, bestT);
    if (t !== null) { bestT = t; best = { type: 'player', q }; }
  }
  if (!best) return; // world impact FX is the renderer's own read

  const point = at(bestT);
  if (best.type === 'enemy') {
    const e = best.e;
    e.hp--;
    ctx.events.push({ type: 'hit', shooter: p.id, target: e.id, point, dmg: 1 });
    e.vx += dir.x * 4; e.vz += dir.z * 4;
    e.vy = Math.max(e.vy, 2.5);
    if (e.hp <= 0) killEnemy(ctx, e, p.id);
  } else {
    const dmg = ctx.pvp ? PLAYER_DMG : 0;
    ctx.events.push({ type: 'hit', shooter: p.id, target: best.q.id, point, dmg });
    if (ctx.pvp) hurtPlayer(best.q, PLAYER_DMG, ctx.events, null);
  }
}
