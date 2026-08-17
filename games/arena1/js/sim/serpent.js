// sim/serpent.js — MD 18. A segmented flying serpent: a chain of spheres that
// shortens as you destroy it from the tail, with a turret on the head.
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

// ── tiers (MD 22) ───────────────────────────────────────────────────────────
/* FIVE serpents: four regular, banded up the 570m column so there is roughly
   always one in view as you climb, plus one giant at the very top. Every tier
   keeps MD 21's model — damage anywhere pops tail spheres one at a time,
   overkill carries, death at the last 3, no armour.

   SPEED (MD 22 item 1). Tiers now specify a TANGENTIAL SPEED in m/s, and `w` is
   derived from it once the orbit radius is known: w = speed / R. That matters
   because R comes from the clear-air scan and lands anywhere from 16 to 80m —
   with a fixed angular rate the same tier cruised at 2.7 m/s on a tight orbit
   and 10.9 on a wide one, a 4x spread nobody designed. Deriving from speed
   makes lap time vary instead, which is what physically should vary.
   Old rate was 0.38-0.56 rad/s, up to 45 m/s on an 80m orbit — five times a
   player's run, which is why they darted. Bigger tiers now cruise slower, which
   reinforces the step up to the giant.

   FIRE BAND (item 6). A serpent only shoots a player inside its OWN altitude
   band, on top of the 90m range check. That is what stops a serpent 200m up
   sniping someone on the floor, and it makes the difficulty curve legible: you
   get shot at by the thing whose airspace you just entered. The lowest band
   starts at 18m, well clear of the arena floor.

   popHp rises with the tier so a sphere costs more the higher you go; the
   rocket is scaled to it in combat.js so ONE rocket is still ONE sphere on
   every tier, giant included. */
export const TIERS = {
  t1:    { segs: 7,  scale: 0.80, popHp: 5,  boltDmg: 14, boltCd: 110, boltSpeed: 26,
           speed: 11, respawnTicks: 600,
           band: { yMin: 40,  yMax: 90 },  fire: { yMin: 18,  yMax: 130 } },
  t2:    { segs: 9,  scale: 0.95, popHp: 6,  boltDmg: 18, boltCd: 96,  boltSpeed: 29,
           speed: 10, respawnTicks: 900,
           band: { yMin: 120, yMax: 190 }, fire: { yMin: 95,  yMax: 235 } },
  t3:    { segs: 11, scale: 1.10, popHp: 7,  boltDmg: 22, boltCd: 84,  boltSpeed: 32,
           speed: 9, respawnTicks: 1200,
           band: { yMin: 220, yMax: 300 }, fire: { yMin: 195, yMax: 350 } },
  t4:    { segs: 13, scale: 1.25, popHp: 8,  boltDmg: 26, boltCd: 72,  boltSpeed: 35,
           speed: 8, respawnTicks: 1500,
           band: { yMin: 330, yMax: 430 }, fire: { yMin: 305, yMax: 480 } },
  /* The giant is a STEP CHANGE, not the next size up: 22 spheres against 13, a
     body scaled half again, a sphere that costs 12 instead of 8, and a turret
     on roughly half the cooldown of the tier below it. */
  giant: { segs: 22, scale: 1.95, popHp: 12, boltDmg: 34, boltCd: 44,  boltSpeed: 40,
           speed: 6.5, respawnTicks: 2700,
           band: { yMin: 590, yMax: 650 }, fire: { yMin: 455, yMax: 900 } },
};
export const TIER_NAMES = ['t1', 't2', 't3', 't4', 'giant'];

export const SEG_COUNT = 22;          // the largest any tier gets (the giant)
/* Ticks of delay between neighbours. Segment SPACING is speed x lag, so MD
   22's slowdown (45 m/s down to ~11) collapsed a 9-segment body to a 4.5m
   clump of overlapping spheres. Raised to hold roughly the old 2.5-3m
   spacing at the new cruise: 11 m/s x 14 ticks = 2.6m. Anything that changes
   `w` again has to revisit this — the two are one number in disguise. */
export const SEG_LAG = 14;
export const HEAD_R = 1.15;           // mid-tier head; scaled per tier
const SEG_R0 = 0.78;                  // first body segment
const SEG_TAPER_R = 0.955;            // each one a little smaller toward the tail
/* MD 25 item 3. Was 3, which killed a serpent while three segments were still
   drawn — you shot something to pieces and it gave up with a visible chunk of
   body left, which read as the fight ending early rather than being won.
   2 = head plus one segment, taken literally from the MD: every remaining body
   sphere pops before the kill lands. */
export const DEATH_LEN = 2;           // at or below this many segments it dies

// Radius of segment i (0 = head), scaled by the tier.
export function segRadius(i, scale = 1) {
  return scale * (i === 0 ? HEAD_R : SEG_R0 * Math.pow(SEG_TAPER_R, i - 1));
}

// ── damage (MD 21) ──────────────────────────────────────────────────────────
/* One threshold, one strategy: hit it ANYWHERE and the tail loses a sphere.

   This replaces MD 18's per-segment hp curve and its 25%-threshold armour, and
   the removal is deliberate. That model made a neck kill expensive and
   tail-chipping cheap so both burst and attrition were viable — a real choice,
   but one that made the serpent far too hard to kill. With no per-segment hp
   left there is nothing for armour to gate, so it goes too rather than
   surviving as a vestige.

   POP_HP is the whole balance now, and the two weapons are DECOUPLED on
   purpose. The zap does 1 and fires every 0.11s, so POP_HP sets the zap pace;
   a rocket direct is special-cased in combat.js to deal exactly POP_HP, so it
   always pops precisely one sphere. That is the literal reading of "a few zap
   hits, or one rocket", and it is what lets both weapons feel right at once —
   tying the rocket to its own 3 damage would have made either the zap a 1.3s
   formality or the rocket an 8-shots-per-sphere slog on the boss.
   5 gives 2.2s / 3.9s / 6.1s on zap and 3.2s / 5.6s / 8.8s on rockets across
   the three tiers; the ladder is in the MD 21 report. */
export const POP_HP = 5;

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
/* MD 21: a real S-curve. The old wave was subtle for a reason worth writing
   down — the body spans SEG_LAG*(segs-1) ticks, about 0.75s, while the lateral
   wave ran at 3*w ≈ 1.2 rad/s, a 5.2s period. Only ~14% of a cycle fitted
   across the whole snake, so it read as a near-straight line with a slight
   lean, not as undulation.
   The fix is FREQUENCY, not just amplitude: `sw` is set so roughly a full wave
   spans the body, which is what makes neighbouring segments swing to opposite
   sides and the thing read as a snake. Vertical gets the same treatment at a
   different multiple so the S is three-dimensional rather than a flat ribbon.
   Still a pure function of the tick — no velocity, no steering — so clients
   keep reconstructing the body from the tick alone. */
export function headAt(s, tick) {
  const t = tick * SIM_DT;
  const a = s.w * t + s.phase;
  const lat = Math.sin(s.sw * t + s.phase) * s.lat;
  const rise = Math.sin(s.sw * 0.62 * t + s.vphase) * s.amp;
  return {
    x: s.cx + Math.cos(a) * s.R - Math.sin(a) * lat,
    y: s.cy + rise,
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

/* `speed` is passed in because w = speed/R, so the candidate's angular rate —
   and therefore the curve it actually traces — depends on the radius being
   tried. Deriving w AFTER the scan validated a different path from the one the
   serpent flies, which is exactly how 19 of 69,440 samples ended up inside
   geometry. The scan now tests the real thing. */
function findClearOrbit(world, base, band, segs, scale, pick = 0, speed = null, dir = 1) {
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
      if (speed !== null) cand.w = (speed / R) * dir;
      tried++;
      if (orbitClear(world, cand, segs, scale)) return { cy: alt, R, tried };
    }
  }
  return null;
}

export function spawnSerpent(ents, level, rng, id, opts = {}) {
  const tierName = opts.tier || 'mid';
  const T = TIERS[tierName];
  /* sw is chosen so about one full lateral wave spans the body: the body is
     SEG_LAG*(segs-1) ticks long, so the period wants to be roughly that, and
     the frequency is 2π over it. Amplitudes are up hard from MD 18/19 — the
     old 2–3.5 barely moved a body 18m long. */
  const bodySeconds = SEG_LAG * (T.segs - 1) * SIM_DT;
  const base = {
    cx: 0, cz: 0,
    amp: (2.6 + rng() * 1.6) * T.scale,
    lat: (5.5 + rng() * 2.5) * T.scale,
    sw: (2 * Math.PI / bodySeconds) * (0.85 + rng() * 0.3),
    w: T.speed / 40,                      // provisional; re-derived from R below
    dir: rng() > 0.5 ? 1 : -1,
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
  const found = opts.world
    ? findClearOrbit(opts.world, base, band, T.segs, T.scale, pick, T.speed, base.dir)
    : null;
  // No clear orbit anywhere in the band: go above it rather than through
  // anything. The caller reports this; tests assert it never happens.
  const cy = found ? found.cy : band.yMax + 24;
  const R = found ? found.R : 26;
  // Now R is known, so the angular rate that yields the intended cruise speed is
  // too. Sign comes from the rng draw above so direction stays seeded.
  base.w = (T.speed / R) * base.dir;   // matches what findClearOrbit validated

  const s = {
    id, kind: 'serpent', tier: tierName,
    ...base, cy, R,
    segs: T.segs, scale: T.scale, popHp: T.popHp, fire: T.fire,
    boltDmg: T.boltDmg, boltCd: T.boltCd, boltSpeed: T.boltSpeed,
    respawnTicks: T.respawnTicks,
    len: T.segs,                          // alive segments, ALWAYS a prefix
    tailHp: T.popHp,                      // damage left on the CURRENT tail sphere
    aimYaw: 0, aimPitch: 0,
    fireCd: T.boltCd,
    contactCd: 0,
    alive: true,
    respawnAt: -1,
    placedClear: !!found,
  };
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
  const dir = rng() > 0.5 ? 1 : -1;
  const found = world
    ? findClearOrbit(world, s, s.debugBand || T.band, T.segs, T.scale, rng(), T.speed, dir)
    : null;
  if (found) { s.cy = found.cy; s.R = found.R; }
  // After `found`, because w depends on the radius actually taken.
  s.w = (T.speed / s.R) * dir;
  s.len = T.segs;
  s.tailHp = T.popHp;
  s.alive = true;
  s.respawnAt = -1;
  s.fireCd = T.boltCd;
  s.contactCd = 0;
}

/* Damage the serpent ANYWHERE. Spheres pop off the TAIL, one at a time, however
   far forward the shot landed — `seg` rides through only so the renderer can
   put the hit mark where the player actually aimed. Always returns true:
   nothing refuses damage any more, so callers no longer need a blocked path.

   Overkill carries into the next sphere rather than being discarded, so a
   rocket landing on a nearly-dead sphere is never wasted and the kill stays
   predictable. */
export function damageSerpent(ctx, s, dmg, shooterId, seg = 0) {
  if (!s.alive) return false;
  s.tailHp -= dmg;
  while (s.tailHp <= 0 && s.alive) {
    const popped = s.len - 1;
    ctx.events.push({
      type: 'serpent_sever', serpentId: s.id, seg: popped,
      point: segAt(s, ctx.tick, popped), by: shooterId,
    });
    s.len--;
    if (s.len <= DEATH_LEN) {
      s.alive = false;
      s.respawnAt = ctx.tick + s.respawnTicks;
      ctx.events.push({
        type: 'serpent_death', serpentId: s.id, tier: s.tier, by: shooterId,
        point: headAt(s, ctx.tick), respawnAt: s.respawnAt,
      });
      break;
    }
    s.tailHp += s.popHp;
  }
  return true;
}

// Nearest non-ghost player, for aim and turret range.
// MD 25 item 5: a paused player is not a target, same rule as enemies.js.
function nearestPlayer(players, from) {
  let best = null, bd = Infinity;
  for (const p of players.values()) {
    if (p.ghost || p.paused) continue;
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
    /* MD 22 item 6: range alone is not the gate — the player must be inside
       THIS serpent's altitude band. A player standing on the arena floor is
       below every band, so none of the five can shoot them. */
    const inBand = target && target.p.pos.y >= s.fire.yMin && target.p.pos.y <= s.fire.yMax;
    if (target && inBand && target.dist < TURRET_RANGE) {
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
      /* A bolt already in the air when its target pauses PASSES THROUGH.
         MD 25 leaves this to judgement; passing through is the only option
         with no visible artefact — freezing it mid-air leaves a threat hanging
         over a menu, and detonating it early punishes a pause the player has
         already taken. It also keeps one rule instead of two: a paused player
         is not there, for aiming and for hitting alike. */
      if (q.ghost || q.paused) continue;
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
      const r = segRadius(i, s.scale);
      const t = raySphere(origin, dir, c, r, bestT);
      if (t !== null) { bestT = t; best = { s, seg: i, t }; }
    }
  }
  return best;
}
