// sim/serpent.js — MD 18. A segmented flying serpent: a chain of spheres that
// shortens as you destroy it, with an armour rhythm and a turret on the head.
//
// THE ONE IDEA THAT SHAPES EVERYTHING HERE: the head's flight path is a CLOSED
// FORM function of the tick. Not a simulated body with velocity and steering —
// headAt(t) can be evaluated for any t, forward or backward, by anyone who
// knows the serpent's parameters. Two things fall out of that:
//
//   · Segment i is simply the head LAG*i ticks ago: headAt(t - i*LAG). The body
//     trails the head's real recent path, so it flows instead of moving as a
//     rigid queue, and it costs no history buffer to do it.
//   · A remote client can RECONSTRUCT every segment from the head parameters
//     and the tick. The wire never carries 12 segment positions — see the
//     snapshot note in sim.js and the bandwidth figures in the MD 18 report.
//
// The price of the closed form is that the serpent cannot collide with level
// geometry — a collision response would make position depend on history and
// break reconstruction. That is paid for by FLYING IT ABOVE THE LEVEL: the
// orbit sits over the summit where there is nothing to hit, which tests/
// serpent.mjs asserts rather than assumes. If a future MD wants a serpent that
// weaves through the spires, this is the decision to revisit, and the wire cost
// goes up with it.
//
// All randomness is rngFor(seed, 'serpent', id); all timing is tick math.

import { SIM_DT } from '../config.js';
import { hurtPlayer } from './movement.js';
import { raySphere, rayVCapsule, CAPSULE_R, CAPSULE_HALF_H } from './world.js';

// ── shape ───────────────────────────────────────────────────────────────────
export const SEG_COUNT = 12;          // inside the MD's 10–14 band
export const SEG_LAG = 5;             // ticks of delay between neighbours
export const HEAD_R = 1.15;           // the head is unmistakably the biggest
const SEG_R0 = 0.78;                  // first body segment
const SEG_TAPER_R = 0.955;            // each one a little smaller toward the tail
export const DEATH_LEN = 3;           // at or below this many segments it dies

// Radius of segment i (0 = head).
export function segRadius(i) {
  return i === 0 ? HEAD_R : SEG_R0 * Math.pow(SEG_TAPER_R, i - 1);
}

// ── hp curve ────────────────────────────────────────────────────────────────
// Tougher toward the head, because destroying segment i also destroys every
// segment behind it. Without a curve the only correct play is "always shoot the
// neck" and the whole tail is scenery. Numbers are in ZAP HITS (the zap does 1
// to an enemy; a rocket direct does 3), and the taper is steep on purpose — see
// the MD 18 report for the full ladder and the two strategies it produces.
const HEAD_HP = 90;
const HP_TAPER = 0.74;
export function segMaxHp(i) {
  return Math.max(3, Math.round(HEAD_HP * Math.pow(HP_TAPER, i)));
}

// ── armour ──────────────────────────────────────────────────────────────────
// A shield inflates every time a segment's hp crosses a quarter of its maximum,
// so a segment is four bursts of shooting separated by three shields, which is
// the beat the MD asks for. While it is up, damage to that segment is REFUSED
// — the hit still emits an event so the renderer can say so, it just does not
// land.
const ARMOUR_THRESHOLDS = [0.75, 0.5, 0.25];
const ARMOUR_TICKS = 72;              // 1.2s — long enough to force a pause

// ── turret ──────────────────────────────────────────────────────────────────
const TURRET_CD_TICKS = 84;           // 1.4s between shots
const BOLT_SPEED = 18;                // vs the player rocket's 40: dodgeable on sight
const BOLT_LIFE_TICKS = 300;          // 5s, then it despawns wherever it is
const BOLT_DMG = 12;
const BOLT_R = 0.35;
const TURRET_RANGE = 90;
const AIM_RATE = 2.2;                 // rad/s the turret can swing — it visibly tracks
const CONTACT_DMG = 15;               // the body is covered in spikes; touching hurts
const CONTACT_CD_TICKS = 48;

// ── the flight path ─────────────────────────────────────────────────────────
// A horizontal circuit, a vertical sine, and a lateral sine at 3x to give the
// snaking. Pure function of the tick and the spawn parameters.
export function headAt(s, tick) {
  const t = tick * SIM_DT;
  const a = s.w * t + s.phase;
  const lat = Math.sin(3 * a) * s.lat;
  return {
    x: s.cx + Math.cos(a) * s.R - Math.sin(a) * lat,
    y: s.cy + Math.sin(s.vw * t + s.vphase) * s.amp,
    z: s.cz + Math.sin(a) * s.R + Math.cos(a) * lat,
  };
}
// Segment i is the head, i*SEG_LAG ticks ago.
export function segAt(s, tick, i) {
  return headAt(s, tick - i * SEG_LAG);
}

export function spawnSerpent(ents, level, rng, id) {
  // Orbit ABOVE the summit: the closed-form path cannot dodge geometry, so it
  // is given air with nothing in it. tests/serpent.mjs proves the clearance.
  const summit = level?.summitY ?? 190;
  const s = {
    id, kind: 'serpent',
    cx: 0, cy: summit + 16 + rng() * 10, cz: 0,
    R: 24 + rng() * 10,
    amp: 4 + rng() * 3,
    lat: 2.5 + rng() * 1.5,
    w: (0.42 + rng() * 0.16) * (rng() > 0.5 ? 1 : -1),
    vw: 1.05 + rng() * 0.5,
    phase: rng() * 6.28,
    vphase: rng() * 6.28,
    len: SEG_COUNT,                       // alive segments, ALWAYS a prefix
    hp: [], armourUntil: [],              // per segment, index 0 = head
    aimYaw: 0, aimPitch: 0,
    fireCd: TURRET_CD_TICKS,
    contactCd: 0,
    alive: true,
  };
  for (let i = 0; i < SEG_COUNT; i++) { s.hp.push(segMaxHp(i)); s.armourUntil.push(-1); }
  ents.serpents.set(id, s);
  return s;
}

// Which quarter-band an hp value sits in; crossing a band edge raises armour.
const band = (hp, max) => {
  for (let k = 0; k < ARMOUR_THRESHOLDS.length; k++) if (hp > max * ARMOUR_THRESHOLDS[k]) return k;
  return ARMOUR_THRESHOLDS.length;
};

/* Damage one segment. Returns true if the hit LANDED, false if armour ate it —
   combat.js uses that to emit the right event, and the renderer uses the event
   to say "blocked" rather than showing a damage number that never happened. */
export function hitSegment(ctx, s, i, dmg, shooterId) {
  if (!s.alive || i >= s.len) return false;
  if (ctx.tick < s.armourUntil[i]) {
    ctx.events.push({ type: 'serpent_blocked', serpentId: s.id, seg: i, shooter: shooterId });
    return false;
  }
  const max = segMaxHp(i);
  const before = band(s.hp[i], max);
  s.hp[i] -= dmg;
  const after = band(s.hp[i], max);
  if (s.hp[i] <= 0) { severTail(ctx, s, i, shooterId); return true; }
  if (after > before) {
    // Crossed at least one quarter — armour inflates and blocks everything.
    s.armourUntil[i] = ctx.tick + ARMOUR_TICKS;
    ctx.events.push({ type: 'serpent_armour', serpentId: s.id, seg: i, untilTick: s.armourUntil[i] });
  }
  return true;
}

/* Destroying segment i destroys everything BEHIND it too — that is the whole
   mechanic, and it is why alive segments are always a prefix and the wire can
   carry one integer instead of a liveness array. Each detached segment emits
   its own event so the renderer can drop and pop it individually. */
function severTail(ctx, s, i, shooterId) {
  const from = Math.max(1, i);   // the head itself is never severed; killing seg 1 ends it
  for (let k = s.len - 1; k >= from; k--) {
    ctx.events.push({
      type: 'serpent_sever', serpentId: s.id, seg: k,
      point: segAt(s, ctx.tick, k), by: shooterId,
    });
  }
  s.len = from;
  if (s.len <= DEATH_LEN) {
    s.alive = false;
    ctx.events.push({ type: 'serpent_death', serpentId: s.id, by: shooterId, point: headAt(s, ctx.tick) });
  }
}

// Nearest non-ghost player, for aim and turret range.
function nearestPlayer(players, from) {
  let best = null, bd = Infinity;
  for (const p of players.values()) {
    if (p.ghost) continue;
    const d = Math.hypot(p.pos.x - from.x, p.pos.y - from.y, p.pos.z - from.z);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { p: best, dist: bd } : null;
}

export function stepSerpents(ctx) {
  // Mechanic-only harnesses build ents by hand; movement.js tolerates the same.
  if (!ctx.ents?.serpents) return;
  for (const s of ctx.ents.serpents.values()) {
    if (!s.alive) { ctx.ents.serpents.delete(s.id); continue; }
    const head = headAt(s, ctx.tick);
    const target = nearestPlayer(ctx.ents.players, head);

    // ---- turret aim: swings at a bounded rate so it visibly tracks ----
    if (target && target.dist < TURRET_RANGE) {
      const eye = { x: target.p.pos.x, y: target.p.pos.y + 0.55, z: target.p.pos.z };
      const dx = eye.x - head.x, dy = eye.y - head.y, dz = eye.z - head.z;
      const wantYaw = Math.atan2(dx, dz);
      const wantPitch = -Math.atan2(dy, Math.hypot(dx, dz));
      // shortest angular path, clamped per tick
      let dyaw = wantYaw - s.aimYaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const step = AIM_RATE * SIM_DT;
      s.aimYaw += Math.max(-step, Math.min(step, dyaw));
      s.aimPitch += Math.max(-step, Math.min(step, wantPitch - s.aimPitch));

      // ---- fire when the turret is actually pointing near the target ----
      s.fireCd--;
      if (s.fireCd <= 0 && Math.abs(dyaw) < 0.25) {
        s.fireCd = TURRET_CD_TICKS;
        const cp = Math.cos(s.aimPitch);
        const dir = { x: Math.sin(s.aimYaw) * cp, y: -Math.sin(s.aimPitch), z: Math.cos(s.aimYaw) * cp };
        const bid = ctx.ents.allocWorldId();
        ctx.ents.bolts.set(bid, {
          id: bid, serpentId: s.id, born: ctx.tick,
          pos: { x: head.x + dir.x * HEAD_R * 1.4, y: head.y + dir.y * HEAD_R * 1.4, z: head.z + dir.z * HEAD_R * 1.4 },
          vel: { x: dir.x * BOLT_SPEED, y: dir.y * BOLT_SPEED, z: dir.z * BOLT_SPEED },
        });
        ctx.events.push({ type: 'serpent_fire', serpentId: s.id, boltId: bid, origin: head, dir });
      }
    }

    // ---- contact damage: it is covered in spikes ----
    if (s.contactCd > 0) s.contactCd--;
    if (s.contactCd <= 0 && target) {
      for (let i = 0; i < s.len; i++) {
        const c = segAt(s, ctx.tick, i);
        const r = segRadius(i) + CAPSULE_R;
        const dx = target.p.pos.x - c.x, dy = target.p.pos.y - c.y, dz = target.p.pos.z - c.z;
        if (dx * dx + dy * dy + dz * dz <= r * r) {
          s.contactCd = CONTACT_CD_TICKS;
          hurtPlayer(target.p, CONTACT_DMG, ctx.events, c, null);
          ctx.events.push({ type: 'serpent_contact', serpentId: s.id, seg: i, playerId: target.p.id });
          break;
        }
      }
    }
  }
}

/* Turret bolts. Swept along the whole travel segment exactly like rockets —
   slow as they are, a bolt must still never end up on the far side of a
   platform — with a lifetime so a miss despawns instead of leaking. */
export function stepBolts(ctx) {
  if (!ctx.ents?.bolts) return;
  for (const b of ctx.ents.bolts.values()) {
    if (ctx.tick - b.born > BOLT_LIFE_TICKS) {
      ctx.ents.bolts.delete(b.id);
      ctx.events.push({ type: 'bolt_expire', boltId: b.id, point: { ...b.pos } });
      continue;
    }
    const speed = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
    const stepLen = speed * SIM_DT;
    if (stepLen < 1e-9) continue;
    const dir = { x: b.vel.x / speed, y: b.vel.y / speed, z: b.vel.z / speed };
    const wh = ctx.world.raycast(b.pos, dir, stepLen);
    let bestT = wh ? wh.t : Infinity;
    let hitPlayer = null;
    for (const q of ctx.ents.players.values()) {
      if (q.ghost) continue;
      const t = rayVCapsule(b.pos, dir, q.pos, CAPSULE_R + BOLT_R, CAPSULE_HALF_H + BOLT_R, Math.min(bestT, stepLen));
      if (t !== null) { bestT = t; hitPlayer = q; }
    }
    if (bestT <= stepLen) {
      const point = { x: b.pos.x + dir.x * bestT, y: b.pos.y + dir.y * bestT, z: b.pos.z + dir.z * bestT };
      ctx.ents.bolts.delete(b.id);
      // No splash, deliberately: splash would punish a moving player, and the
      // whole point of a slow bolt is that moving is the answer to it.
      if (hitPlayer) {
        ctx.events.push({ type: 'hit', shooter: null, target: hitPlayer.id, point, dmg: BOLT_DMG });
        hurtPlayer(hitPlayer, BOLT_DMG, ctx.events, point, null);
      }
      ctx.events.push({ type: 'bolt_impact', boltId: b.id, point, hit: hitPlayer ? hitPlayer.id : null });
    } else {
      b.pos.x += b.vel.x * SIM_DT;
      b.pos.y += b.vel.y * SIM_DT;
      b.pos.z += b.vel.z * SIM_DT;
    }
  }
}

/* Ray vs the serpent, for combat.js. Returns the FRONTMOST segment the ray hits
   within maxT (front = lowest index = toughest), because that is the segment a
   player aiming at the neck means to hit. */
export function raySerpents(ctx, origin, dir, maxT) {
  if (!ctx.ents?.serpents) return null;
  let best = null, bestT = maxT;
  for (const s of ctx.ents.serpents.values()) {
    if (!s.alive) continue;
    for (let i = 0; i < s.len; i++) {
      const c = segAt(s, ctx.tick, i);
      const shielded = ctx.tick < s.armourUntil[i];
      // The armour sphere is bigger than the segment, so a shielded segment is
      // an easier thing to hit — you cannot avoid the shield by aiming finer.
      const r = segRadius(i) + (shielded ? 0.45 : 0);
      const t = raySphere(origin, dir, c, r, bestT);
      if (t !== null) { bestT = t; best = { s, seg: i, t }; }
    }
  }
  return best;
}
