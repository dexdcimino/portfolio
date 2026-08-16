// entities/player.js — player LOGIC only. Zero Babylon imports; visuals mount
// via visuals/factory.js and are fed morphState (TECH.md contract).
// Movement: accel/friction toward input, wall slide via world.circleSlide.
// CHOMP (GDD "Eating rules", lunge only — eating itself is MD-05): 0.35s lunge
// ×2.6 along facing, cooldown 0.9s; wall hit mid-lunge = bonk (stun + event).

import { CONFIG } from '../config.js';
import { emit } from '../core/events.js';
import { STAGES, STAGE_RADII } from '../data/stages.js';

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function createPlayer() {
  return {
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    facing: 0, // atan2(vx, vz); held when idle
    angVel: 0, // rad/s — drives morph bank
    speed: 0,
    maxSpeed: CONFIG.player.maxSpeed,
    mass: CONFIG.player.startMass,
    stage: 1,
    hp: CONFIG.combat.maxHpByStage[0],
    maxHp: CONFIG.combat.maxHpByStage[0],
    sinceDamage: 999, // seconds since last hit (drives regen)
    regenAcc: 0,
    gobbled: 0, // run stat: things eaten
    chomp: { active: false, t: 0, cd: 0 },
    stunned: 0,
    iframes: 0, // invulnerability after taking damage
    stamina: 1, // sprint fuel, 0..1
    sprinting: false,
    sprintWait: 0, // regen delay after sprinting
    squeeze: 0, // 0..1 — currently oozing through a gap smaller than the body
  };
}

// Progress through the current stage: 0 at its threshold, 1 at the next.
// Stage 5 keeps growing toward a virtual 2× threshold, slower.
export function stageProgress(p) {
  const cur = STAGES[p.stage - 1].mass;
  const next = STAGES[p.stage]?.mass ?? cur * 2;
  return Math.min(1, Math.max(0, (p.mass - cur) / (next - cur)));
}

// Visual/collision growth: authored stage radius scaling smoothly toward the
// NEXT stage's authored radius across the stage — continuous at evolve time.
export function growthScale(p) {
  const curR = STAGE_RADII[p.stage - 1];
  const nextR = STAGE_RADII[p.stage] ?? STAGE_RADII[4] * 1.3;
  return 1 + (nextR / curR - 1) * stageProgress(p);
}

export function playerRadius(p) {
  return STAGE_RADII[p.stage - 1] * growthScale(p);
}

// input: { x, z (normalized -1..1), chomp: bool } · world: ChunkManager
export function updatePlayer(p, input, world, dt) {
  const cfg = CONFIG.player;
  const prevFacing = p.facing;
  p.chomp.cd = Math.max(0, p.chomp.cd - dt);
  p.stunned = Math.max(0, p.stunned - dt);
  p.iframes = Math.max(0, p.iframes - dt);

  // HP regen: quiet for a while ⇒ health trickles back
  p.sinceDamage += dt;
  if (p.hp < p.maxHp && p.hp > 0 && p.sinceDamage > CONFIG.combat.hpRegenDelaySec) {
    p.regenAcc += dt;
    if (p.regenAcc >= CONFIG.combat.hpRegenIntervalSec) {
      p.regenAcc = 0;
      p.hp = Math.min(p.maxHp, p.hp + 1);
    }
  } else if (p.hp >= p.maxHp) {
    p.regenAcc = 0;
  }

  // Sprint (Shift): burns stamina while held + moving; regens after a pause.
  const S = CONFIG.sprint;
  p.sprinting =
    !!input.sprint && p.stamina > 0 && p.stunned === 0 && (input.x !== 0 || input.z !== 0);
  if (p.sprinting) {
    p.stamina = Math.max(0, p.stamina - dt / S.drainSec);
    p.sprintWait = S.regenDelaySec;
  } else {
    p.sprintWait = Math.max(0, p.sprintWait - dt);
    if (p.sprintWait === 0) p.stamina = Math.min(1, p.stamina + dt / S.regenSec);
  }

  p.maxSpeed =
    cfg.maxSpeed *
    cfg.stageSpeedMult[p.stage - 1] *
    (p.sprinting ? S.speedMult : 1) *
    (p.inWater ? CONFIG.world.water.slowMult : 1); // wading is slow going

  // Start chomp
  if (input.chomp && !p.chomp.active && p.chomp.cd === 0 && p.stunned === 0) {
    p.chomp.active = true;
    p.chomp.t = 0;
    p.chomp.cd = CONFIG.chomp.cooldown;
    emit('player:chomp', p);
  }

  if (p.chomp.active) {
    // Lunge: locked to facing at chomp speed
    p.chomp.t += dt;
    const lunge = p.maxSpeed * CONFIG.chomp.speedMult;
    p.vx = Math.sin(p.facing) * lunge;
    p.vz = Math.cos(p.facing) * lunge;
    if (p.chomp.t >= CONFIG.chomp.duration) p.chomp.active = false;
  } else if (p.stunned > 0) {
    const f = Math.max(0, 1 - cfg.friction * 2 * dt);
    p.vx *= f;
    p.vz *= f;
  } else if (input.x !== 0 || input.z !== 0) {
    p.vx += input.x * cfg.accel * dt;
    p.vz += input.z * cfg.accel * dt;
    const sp = Math.hypot(p.vx, p.vz);
    if (sp > p.maxSpeed) {
      p.vx *= p.maxSpeed / sp;
      p.vz *= p.maxSpeed / sp;
    }
    p.facing = Math.atan2(p.vx, p.vz);
  } else {
    const f = Math.max(0, 1 - cfg.friction * dt);
    p.vx *= f;
    p.vz *= f; // facing intentionally held
  }

  // Move with wall slide. SOFT BODY with HYSTERESIS: the collision radius
  // follows the smoothed squeeze factor. Squeeze RISES only when hard-blocked
  // AND a min-radius probe proves the opening is a gap (a flat wall blocks
  // every radius). It RELAXES only when the full body has clearance. Ordinary
  // wall slides never touch it — no magnet-sticking to walls.
  const SQ = CONFIG.squeeze;
  const rFull = playerRadius(p);
  const rMin = rFull * SQ.minMult;
  const rEff = rFull - p.squeeze * (rFull - rMin);
  const spdMult = 1 - p.squeeze * (1 - SQ.minSpeedMult);
  const mx = p.vx * dt * spdMult;
  const mz = p.vz * dt * spdMult;
  const want = Math.hypot(mx, mz);
  let res = world.circleSlide(p.x, p.z, rEff, mx, mz);
  const moved = Math.hypot(res.x - p.x, res.z - p.z);

  let squeezeTarget = p.squeeze;
  if (want > 1e-5 && moved < want * 0.25) {
    const probe = world.circleSlide(p.x, p.z, rMin, mx, mz);
    const probeMoved = Math.hypot(probe.x - p.x, probe.z - p.z);
    if (probeMoved > want * 0.5) squeezeTarget = 1; // a gap — ooze in
  } else if (!world.circleHitsWall(p.x, p.z, rFull * 0.98)) {
    squeezeTarget = 0; // full size fits here — relax
  }
  p.squeeze += (squeezeTarget - p.squeeze) * Math.min(1, SQ.smooth * dt);

  // Broken-state escape: overlapping walls even at MINIMUM squeeze size
  // (e.g. grew while wedged). Ghost toward the nearest breathable spot —
  // physics is already invalid inside a wall.
  if (world.circleHitsWall(p.x, p.z, rMin * 0.95)) {
    let escape = null;
    for (let ring = 1; ring <= 6 && !escape; ring++) {
      const d = ring * rFull * 0.4;
      for (let a = 0; a < 12; a++) {
        const ex = Math.sin((a / 12) * Math.PI * 2) * d;
        const ez = Math.cos((a / 12) * Math.PI * 2) * d;
        if (!world.circleHitsWall(p.x + ex, p.z + ez, rMin)) {
          escape = { ex, ez, d };
          break;
        }
      }
    }
    if (escape) {
      const step = Math.min(SQ.unstickSpeed * dt, escape.d);
      res = { x: p.x + (escape.ex / escape.d) * step, z: p.z + (escape.ez / escape.d) * step, hitNormal: null };
    }
  }

  // Water never blocks — any size wades through, just slowed (via maxSpeed).
  p.inWater = world.isWater(res.x, res.z);

  p.x = res.x;
  p.z = res.z;
  if (res.hitNormal) {
    if (p.chomp.active) {
      // Bonk: chomped into a wall
      p.chomp.active = false;
      p.stunned = CONFIG.chomp.wallBonkStun;
      emit('player:bonk', p);
    }
    if (p.squeeze < 0.05) {
      if (res.hitNormal.x !== 0) p.vx = 0;
      if (res.hitNormal.z !== 0) p.vz = 0;
    }
  }

  p.speed = Math.hypot(p.vx, p.vz);
  p.angVel = dt > 0 ? wrapAngle(p.facing - prevFacing) / dt : 0;
  return p;
}
