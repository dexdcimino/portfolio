// sim/combat.js — hitscan (Phase 5) + the rocket launcher (MD 11).
//
// Hitscan: FIRE → the sim raycasts against level ∪ enemies ∪ players and
// resolves the nearest. PvE and PvP share this one path with a single branch:
// hits on players apply damage only when sim.pvp is true. Resolution emits
// events; the renderer maps them to hitmark/tracer/damage number/feed and
// NEVER mutates hp.
//
// Rockets: real sim entities with stable ids, stepped every tick with a FULLY
// SWEPT test — the level via world.raycast, enemies/players via raySphere/
// rayVCapsule along the tick's travel segment — so no speed can tunnel.
// Splash damage falls off linearly; players go through the SAME pvp branch as
// direct hits, with one deliberate exception on record: SELF-damage and
// self-knockback are never gated (rocket jumping must work in co-op, and the
// launch must work at any hp). Knockback is pure radial impulse scaled by
// proximity — angled blasts give angled launches, which is the whole feel.
//
// v1 numbers (balance later, on record now):
//   speed 40 m/s · cooldown 0.8s · lifetime 4s · splash radius 4.5m
//   players: 35 direct (pvp), splash 30 → 0 linear falloff, self included
//   enemies: 3 direct; splash 2 inside half radius, 1 outside
//   knockback (MD 13): players 54 · (1 − d/4.5) radial, min-clamped d ≥ 0.5 —
//   3× the MD 11 value, so a feet blast launches ~35 m/s vertical against an
//   11.5 jump and reaches geometry jumping never can. Enemies keep the old 18:
//   the raise is about the rocket JUMP, and 3× enemy fling would hurl patrol
//   spikeballs off their platforms as a side effect nobody asked for.

import { SIM_DT } from '../config.js';
import { CAPSULE_R, CAPSULE_HALF_H, raySphere, rayVCapsule } from './world.js';
import { BTN, ENEMY_R, hurtPlayer } from './movement.js';
import { killEnemy } from './enemies.js';
import { raySerpents, hitSegment, segAt, segRadius } from './serpent.js';

const FIRE_CD = 0.11; // prototype cadence (zap)
const RANGE = 250;
const EYE_H = 0.55;
// v1 decision, not TUNE's: 12/hit ≈ 1s time-to-kill at full cadence against
// 100 hp — arena-fast without being instant.
const PLAYER_DMG = 12;

const ROCKET_SPEED = 40;
const ROCKET_CD = 0.8;
const ROCKET_LIFE_TICKS = 240;      // 4s — a rocket fired at the sky never leaks
const ROCKET_MUZZLE = 0.8;          // spawn ahead of the eye
// Exported for the render layer: the explosion's DAMAGE CORE visual scales
// from this constant so the bright boundary can never drift from the real
// splash volume. The spectacle falloff around it deliberately does not.
export const SPLASH_RADIUS = 11;

/* MD 15 items 3+4. The radius was 4.5 while the spectacle reached 10-15m, and
   MD 13's split — a small damage core inside a larger "effect only" falloff —
   did not read: people take the whole effect for the explosion. Resolved the
   other way, by raising damage to meet the visual. The core visual scales off
   this constant (render/fx.js), so the two converge automatically.

   A flat falloff at 11m would make every near-miss lethal, so the curve goes
   CUBIC. That is chosen, not arbitrary: cubic at 11m reproduces the old linear
   4.5m numbers almost exactly inside 2m (24->23 at the feet, 17->16 at 2m) and
   then trails off to a long chip tail — 8 at 4m, 4 at 5.5m, 1 at 7m. So the
   close-range economy people already know is preserved, rocket-jump
   self-damage is unchanged in practice, and the radius grows into chip damage
   rather than into one-shot territory. */
const FALLOFF_POW = 3;
const falloff = (d) => Math.pow(1 - d / SPLASH_RADIUS, FALLOFF_POW);
const DIRECT_PLAYER = 35;           // pvp-gated like every player hit
const DIRECT_ENEMY = 3;             // a blob dies to a direct hit
const SPLASH_PLAYER_MAX = 30;       // → ~22 self-damage from a feet blast (survivable ≥4×)
/* MD 15 item 5: substantially stronger, and it has to be read together with
   the cubic curve above — the curve alone would have cut knockback at range,
   so the constant rises to more than compensate. Net effect at a feet blast is
   ~1.6x (43 -> 68 impulse), and 3.8x at 4m where the old radius delivered
   almost nothing. Rocket-jump apex goes from ~31m to ~77m, which is the
   "rocket jumping gets wilder" MD 3 accepted, on a spire map built for it.
   NOT gated by sim.pvp — on record from MD 11, and what keeps rocket jumping
   alive in co-op. It does mean you can punt teammates: accepted, not a bug. */
const KNOCK_PLAYER = 88;
const KNOCK_ENEMY = 18;             // unchanged from MD 11 — see header

function viewDir(p) {
  const cp = Math.cos(p.pitch);
  return { x: Math.sin(p.yaw) * cp, y: -Math.sin(p.pitch), z: Math.cos(p.yaw) * cp };
}

export function stepCombat(ctx, p, buttons) {
  p.fireCd -= SIM_DT;
  if (!(buttons & BTN.FIRE) || p.fireCd > 0) return;

  // MD 14: EVERY shot emits fire — hit or miss — because remote muzzle flash
  // driven off `hit` alone would flash only on connects, and most shots miss.
  // The renderer maps it to flash/tracer/sound on the shooter's pill; `hit`
  // keeps doing impact effects. (Wire vocabulary: ARENA1_STEPS.md.)
  {
    const dir = viewDir(p);
    ctx.events.push({
      type: 'fire', playerId: p.id, weapon: p.weapon,
      origin: { x: p.pos.x, y: p.pos.y + EYE_H, z: p.pos.z },
      dir,
    });
  }

  if (p.weapon === 1) {
    p.fireCd = ROCKET_CD;
    const dir = viewDir(p);
    const id = ctx.ents.allocId();
    ctx.ents.rockets.set(id, {
      id,
      ownerId: p.id,
      pos: {
        x: p.pos.x + dir.x * ROCKET_MUZZLE,
        y: p.pos.y + EYE_H + dir.y * ROCKET_MUZZLE,
        z: p.pos.z + dir.z * ROCKET_MUZZLE,
      },
      vel: { x: dir.x * ROCKET_SPEED, y: dir.y * ROCKET_SPEED, z: dir.z * ROCKET_SPEED },
      born: ctx.tick,
    });
    return;
  }

  p.fireCd = FIRE_CD;
  const eye = { x: p.pos.x, y: p.pos.y + EYE_H, z: p.pos.z };
  const dir = viewDir(p);
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
    if (q.id === p.id || q.ghost) continue;
    const t = rayVCapsule(eye, dir, q.pos, CAPSULE_R, CAPSULE_HALF_H, bestT);
    if (t !== null) { bestT = t; best = { type: 'player', q }; }
  }
  {
    const hit = raySerpents(ctx, eye, dir, bestT);
    if (hit) { bestT = hit.t; best = { type: 'serpent', hit }; }
  }
  if (!best) return; // world impact FX is the renderer's own read

  const point = at(bestT);
  if (best.type === 'serpent') {
    const { s, seg } = best.hit;
    // hitSegment returns false when armour ate it; the event it emits is what
    // tells the renderer to show a blocked read instead of a damage number.
    const landed = hitSegment(ctx, s, seg, 1, p.id);
    if (landed) ctx.events.push({ type: 'hit', shooter: p.id, target: s.id, point, dmg: 1, seg });
    return;
  }
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
    if (ctx.pvp) hurtPlayer(best.q, PLAYER_DMG, ctx.events, null, p.id);
  }
}

// ── rockets ─────────────────────────────────────────────────────────────────

function explode(ctx, r, point, direct) {
  ctx.events.push({ type: 'explode', point: { ...point }, ownerId: r.ownerId });

  // direct hit first: full damage to whatever the sweep struck
  if (direct?.type === 'serpent') {
    // A rocket direct is DIRECT_ENEMY (3 zap-hits' worth) into one segment.
    // Splash deliberately does NOT spread down the chain: a blast that chewed
    // several segments at once would collapse the whole hp curve into "aim
    // anywhere near the neck", which is exactly the single correct answer the
    // curve exists to prevent.
    const { s: ser, seg } = direct.hit;
    const landed = hitSegment(ctx, ser, seg, DIRECT_ENEMY, r.ownerId);
    if (landed) ctx.events.push({ type: 'hit', shooter: r.ownerId, target: ser.id, point, dmg: DIRECT_ENEMY, seg });
  } else if (direct?.type === 'enemy' && direct.e.alive) {
    const e = direct.e;
    e.hp -= DIRECT_ENEMY;
    ctx.events.push({ type: 'hit', shooter: r.ownerId, target: e.id, point, dmg: DIRECT_ENEMY });
    if (e.hp <= 0) killEnemy(ctx, e, r.ownerId);
  } else if (direct?.type === 'player') {
    const dmg = ctx.pvp ? DIRECT_PLAYER : 0;
    ctx.events.push({ type: 'hit', shooter: r.ownerId, target: direct.q.id, point, dmg });
    if (ctx.pvp) hurtPlayer(direct.q, DIRECT_PLAYER, ctx.events, null, r.ownerId);
  }

  // splash: everything in radius, falling off with distance
  for (const e of ctx.ents.enemies.values()) {
    if (!e.alive || (direct?.type === 'enemy' && direct.e === e)) continue;
    const d = Math.hypot(e.pos.x - point.x, e.pos.y - point.y, e.pos.z - point.z);
    if (d > SPLASH_RADIUS) continue;
    const dmg = d < SPLASH_RADIUS / 2 ? 2 : 1;   // ratio-based, so it tracks the radius
    e.hp -= dmg;
    ctx.events.push({ type: 'hit', shooter: r.ownerId, target: e.id, point, dmg });
    // KNOCK_ENEMY itself is untouched (MD 15 item 5 says leave it), but it takes
    // the same cubic curve — with the radius now 11m a LINEAR falloff would start
    // shoving patrol spikeballs off platforms from 8m away, which is exactly the
    // outcome the enemy/player split was created to avoid. Cubic keeps the
    // profile close to what it was at 4.5m linear.
    const k = KNOCK_ENEMY * falloff(d);
    const dd = Math.max(0.5, d);
    e.vx += (e.pos.x - point.x) / dd * k * 0.8;
    e.vz += (e.pos.z - point.z) / dd * k * 0.8;
    e.vy = Math.max(e.vy, k * 0.6);
    if (e.hp <= 0) killEnemy(ctx, e, r.ownerId);
  }
  for (const q of ctx.ents.players.values()) {
    if (q.ghost || (direct?.type === 'player' && direct.q === q)) continue;
    const d = Math.hypot(q.pos.x - point.x, q.pos.y - point.y, q.pos.z - point.z);
    if (d > SPLASH_RADIUS) continue;
    const isSelf = q.id === r.ownerId;
    const raw = Math.round(SPLASH_PLAYER_MAX * falloff(d));
    // The one pvp branch, same as direct hits — with self-damage DELIBERATELY
    // outside it: pvp off means you cannot hurt OTHER players, not that your
    // own rockets go soft. Gating self would silently kill rocket jumping in
    // co-op (decision on record, MD 11).
    const dmg = (isSelf || ctx.pvp) ? raw : 0;
    ctx.events.push({ type: 'hit', shooter: r.ownerId, target: q.id, point, dmg });
    // Knockback before damage, never damage-gated: the launch must work at
    // any hp and under any pvp setting. Pure radial impulse — angled blasts
    // give angled launches (the rocket-jump feel), scaled by proximity like
    // the enemy knockback.
    const dd = Math.max(0.5, d);
    const k = KNOCK_PLAYER * falloff(d);
    q.vel.x += (q.pos.x - point.x) / dd * k;
    q.vel.y += (q.pos.y - point.y) / dd * k;
    q.vel.z += (q.pos.z - point.z) / dd * k;
    if (dmg > 0) hurtPlayer(q, dmg, ctx.events, null, r.ownerId);
  }
}

// Steps every live rocket one tick with a fully swept collision test — the
// projectile analog of the capsule mover's substepping discipline. Called
// from sim.step after enemies (fixed order, documented there).
export function stepRockets(ctx) {
  for (const r of ctx.ents.rockets.values()) {
    if (ctx.tick - r.born > ROCKET_LIFE_TICKS) { ctx.ents.rockets.delete(r.id); continue; }
    const stepLen = Math.hypot(r.vel.x, r.vel.y, r.vel.z) * SIM_DT;
    if (stepLen < 1e-9) continue;
    const dir = {
      x: r.vel.x / (stepLen / SIM_DT),
      y: r.vel.y / (stepLen / SIM_DT),
      z: r.vel.z / (stepLen / SIM_DT),
    };
    // nearest impact along this tick's whole travel segment
    const wh = ctx.world.raycast(r.pos, dir, stepLen);
    let bestT = wh ? wh.t : Infinity;
    let direct = null;
    for (const e of ctx.ents.enemies.values()) {
      if (!e.alive) continue;
      const t = raySphere(r.pos, dir, e.pos, ENEMY_R[e.kind] + 0.15, Math.min(bestT, stepLen));
      if (t !== null) { bestT = t; direct = { type: 'enemy', e }; }
    }
    for (const q of ctx.ents.players.values()) {
      if (q.ghost || q.id === r.ownerId) continue; // never direct-hits its owner; splash reaches them
      const t = rayVCapsule(r.pos, dir, q.pos, CAPSULE_R + 0.15, CAPSULE_HALF_H + 0.15, Math.min(bestT, stepLen));
      if (t !== null) { bestT = t; direct = { type: 'player', q }; }
    }
    {
      const sh = raySerpents(ctx, r.pos, dir, Math.min(bestT, stepLen));
      if (sh) { bestT = sh.t; direct = { type: 'serpent', hit: sh }; }
    }
    if (bestT <= stepLen) {
      const point = { x: r.pos.x + dir.x * bestT, y: r.pos.y + dir.y * bestT, z: r.pos.z + dir.z * bestT };
      ctx.ents.rockets.delete(r.id);
      explode(ctx, r, point, direct);
    } else {
      r.pos.x += r.vel.x * SIM_DT;
      r.pos.y += r.vel.y * SIM_DT;
      r.pos.z += r.vel.z * SIM_DT;
    }
  }
}
