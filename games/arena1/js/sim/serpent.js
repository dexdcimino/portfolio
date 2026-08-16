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
import { rngFor } from '../core/rng.js';

// ── tiers (MD 19) ───────────────────────────────────────────────────────────
/* Three serpents at three heights, so the climb means something. Every tier
   keeps ALL of MD 18's mechanics — armour quarters, sever-everything-behind,
   hp rising toward the head, death at the last few segments, contact damage,
   swept bolts — and differs only in scale. The hpScale multiplies the whole
   curve rather than reshaping it, which is what keeps the head-ward slope (and
   therefore the burst-vs-attrition choice) intact at every tier. */
export const TIERS = {
  low:  { segs: 7,  scale: 0.80, hpScale: 0.55, boltDmg: 7,  boltCd: 120, boltSpeed: 15,
          respawnTicks: 600,  band: { yMin: 34,  yMax: 74 } },
  mid:  { segs: 10, scale: 1.00, hpScale: 1.00, boltDmg: 12, boltCd: 84,  boltSpeed: 18,
          respawnTicks: 1200, band: { yMin: 96,  yMax: 150 } },
  boss: { segs: 14, scale: 1.35, hpScale: 1.90, boltDmg: 18, boltCd: 54,  boltSpeed: 22,
          respawnTicks: 2400, band: { yMin: 206, yMax: 236 } },
};
export const TIER_NAMES = ['low', 'mid', 'boss'];

export const SEG_COUNT = 14;          // the largest any tier gets (buffer sizing)
export const SEG_LAG = 5;             // ticks of delay between neighbours
export const HEAD_R = 1.15;           // mid-tier head; scaled per tier
const SEG_R0 = 0.78;                  // first body segment
const SEG_TAPER_R = 0.955;            // each one a little smaller toward the tail
export const DEATH_LEN = 3;           // at or below this many segments it dies

// Radius of segment i (0 = head), scaled by the tier.
export function segRadius(i, scale = 1) {
  return scale * (i === 0 ? HEAD_R : SEG_R0 * Math.pow(SEG_TAPER_R, i - 1));
}

// ── hp curve ────────────────────────────────────────────────────────────────
// Tougher toward the head, because destroying segment i also destroys every
// segment behind it. Without a curve the only correct play is "always shoot the
// neck" and the whole tail is scenery. Numbers are in ZAP HITS (the zap does 1
// to an enemy; a rocket direct does 3), and the taper is steep on purpose — see
// the MD 18 report for the full ladder and the two strategies it produces.
const HEAD_HP = 90;
const HP_TAPER = 0.74;
export function segMaxHp(i, hpScale = 1) {
  return Math.max(3, Math.round(HEAD_HP * Math.pow(HP_TAPER, i) * hpScale));
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

/* MD 19. The path has NO collision awareness — that is the whole reason segment
   positions are derivable and the wire is cheap — so a lower tier is made safe
   by being PUT somewhere empty, and "empty" is measured rather than assumed.

   orbitClear walks a candidate orbit over a full horizontal period, at every
   segment, and asks the world whether anything is there. findClearOrbit scans
   candidates deterministically (outermost radius first, then rising through the
   altitude band) and returns the first that comes back clean. Outermost first
   because the platform spiral is clamped to 0.86*apothem, so the ring between
   the outer platforms and the rim wall is the widest genuinely empty air at low
   altitude — but the scan proves that per seed instead of trusting it.

   If a band has no clear orbit the caller raises the tier and reports it. An
   orbit slightly higher than intended is a much smaller problem than one that
   passes through a platform. */
const ORBIT_SAMPLES = 96;
function orbitClear(world, cand, segs, scale) {
  const period = Math.abs(2 * Math.PI / cand.w) / SIM_DT;   // ticks for one lap
  for (let n = 0; n < ORBIT_SAMPLES; n++) {
    const tick = (n / ORBIT_SAMPLES) * period;
    for (let i = 0; i < segs; i++) {
      const c = segAt(cand, tick, i);
      // margin so a near-miss still reads as clear
      const r = segRadius(i, scale) + 0.75;
      if (world.overlapCapsule(c, r, r).length) return false;
    }
  }
  return true;
}

function findClearOrbit(world, base, band, segs, scale, pick = 0) {
  /* Candidate radii outermost-first, but ROTATED by a seeded offset. Without
     the rotation every tier takes the first radius that works and all three end
     up stacked on the same ring — clear, but visibly uniform. The rotation only
     changes the ORDER candidates are tried in, so the result is still whatever
     is genuinely empty, and it stays deterministic because `pick` comes from
     the serpent's own rng. */
  const radii = [];
  for (let R = 80; R >= 12; R -= 4) radii.push(R);
  const off = Math.abs(Math.floor(pick * radii.length)) % radii.length;
  let tried = 0;
  for (let alt = band.yMin; alt <= band.yMax; alt += 5) {
    for (let n = 0; n < radii.length; n++) {
      const R = radii[(n + off) % radii.length];
      const cand = { ...base, cy: alt, R };
      tried++;
      if (orbitClear(world, cand, segs, scale)) return { cy: alt, R, tried };
    }
  }
  return null;
}

export function spawnSerpent(ents, level, rng, id, opts = {}) {
  const tierName = opts.tier || 'mid';
  const T = TIERS[tierName];
  const base = {
    cx: 0, cz: 0,
    amp: (3 + rng() * 3) * T.scale,
    lat: (2 + rng() * 1.5) * T.scale,
    w: (0.38 + rng() * 0.18) * (rng() > 0.5 ? 1 : -1),
    vw: 1.0 + rng() * 0.5,
    phase: rng() * 6.28,
    vphase: rng() * 6.28,
  };

  /* ?serpent=low drops every tier into one low band so all three can be
     inspected from the floor. Debug only — it changes where they fly and
     nothing else, and because the orbit parameters ride the wire in `path`, a
     client still reconstructs whatever the host chose. */
  const band = opts.lowDebug ? { yMin: 18, yMax: 46 } : T.band;

  const pick = rng();
  const found = opts.world ? findClearOrbit(opts.world, base, band, T.segs, T.scale, pick) : null;
  // No clear orbit anywhere in the band: go above it rather than through
  // anything. The caller reports this; tests assert it never happens.
  const cy = found ? found.cy : band.yMax + 24;
  const R = found ? found.R : 26;

  const s = {
    id, kind: 'serpent', tier: tierName,
    ...base, cy, R,
    segs: T.segs, scale: T.scale, hpScale: T.hpScale,
    boltDmg: T.boltDmg, boltCd: T.boltCd, boltSpeed: T.boltSpeed,
    respawnTicks: T.respawnTicks,
    len: T.segs,                          // alive segments, ALWAYS a prefix
    hp: [], armourUntil: [],              // per segment, index 0 = head
    aimYaw: 0, aimPitch: 0,
    fireCd: T.boltCd,
    contactCd: 0,
    alive: true,
    respawnAt: -1,
    placedClear: !!found,
  };
  for (let i = 0; i < T.segs; i++) { s.hp.push(segMaxHp(i, T.hpScale)); s.armourUntil.push(-1); }
  ents.serpents.set(id, s);
  return s;
}

/* Respawn: the record stays in the map while dead so the tier, the id and the
   orbit survive, and it simply reappears at its band after the delay. It does
   NOT fade or drop in — it is a patrol that comes back round, and at these
   altitudes a player is rarely watching the exact spot. Everything is tick
   math and rng, so both peers respawn on the same tick. */
export function respawnSerpent(s, tick, rng, world) {
  const T = TIERS[s.tier];
  s.phase = rng() * 6.28;
  s.vphase = rng() * 6.28;
  s.w = (0.38 + rng() * 0.18) * (rng() > 0.5 ? 1 : -1);
  const found = world ? findClearOrbit(world, s, s.debugBand || T.band, T.segs, T.scale, rng()) : null;
  if (found) { s.cy = found.cy; s.R = found.R; }
  s.len = T.segs;
  s.hp = []; s.armourUntil = [];
  for (let i = 0; i < T.segs; i++) { s.hp.push(segMaxHp(i, T.hpScale)); s.armourUntil.push(-1); }
  s.alive = true;
  s.respawnAt = -1;
  s.fireCd = T.boltCd;
  s.contactCd = 0;
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
  const max = segMaxHp(i, s.hpScale);
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
    s.respawnAt = ctx.tick + s.respawnTicks;
    ctx.events.push({
      type: 'serpent_death', serpentId: s.id, tier: s.tier, by: shooterId,
      point: headAt(s, ctx.tick), respawnAt: s.respawnAt,
    });
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
    if (!s.alive) {
      // Dead but not gone: the record holds the tier, id and orbit so the
      // respawn is the SAME serpent coming back round rather than a new one.
      if (s.respawnAt >= 0 && ctx.tick >= s.respawnAt) {
        respawnSerpent(s, ctx.tick, rngFor(ctx.seed ?? 'serp', 'serpent', s.id * 1000 + ctx.tick), ctx.world);
        ctx.events.push({ type: 'serpent_respawn', serpentId: s.id, tier: s.tier, point: headAt(s, ctx.tick) });
      }
      continue;
    }
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
        s.fireCd = s.boltCd;
        const cp = Math.cos(s.aimPitch);
        const dir = { x: Math.sin(s.aimYaw) * cp, y: -Math.sin(s.aimPitch), z: Math.cos(s.aimYaw) * cp };
        const bid = ctx.ents.allocWorldId();
        ctx.ents.bolts.set(bid, {
          id: bid, serpentId: s.id, born: ctx.tick,
          pos: { x: head.x + dir.x * HEAD_R * 1.4, y: head.y + dir.y * HEAD_R * 1.4, z: head.z + dir.z * HEAD_R * 1.4 },
          vel: { x: dir.x * s.boltSpeed, y: dir.y * s.boltSpeed, z: dir.z * s.boltSpeed },
          dmg: s.boltDmg,
        });
        ctx.events.push({ type: 'serpent_fire', serpentId: s.id, boltId: bid, origin: head, dir });
      }
    }

    // ---- contact damage: it is covered in spikes ----
    if (s.contactCd > 0) s.contactCd--;
    if (s.contactCd <= 0 && target) {
      for (let i = 0; i < s.len; i++) {
        const c = segAt(s, ctx.tick, i);
        const r = segRadius(i, s.scale) + CAPSULE_R;
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
        const dmg = b.dmg ?? BOLT_DMG;
        ctx.events.push({ type: 'hit', shooter: null, target: hitPlayer.id, point, dmg });
        hurtPlayer(hitPlayer, dmg, ctx.events, point, null);
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
      const r = segRadius(i, s.scale) + (shielded ? 0.45 : 0);
      const t = raySphere(origin, dir, c, r, bestT);
      if (t !== null) { bestT = t; best = { s, seg: i, t }; }
    }
  }
  return best;
}
