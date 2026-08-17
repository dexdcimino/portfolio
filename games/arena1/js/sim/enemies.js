// sim/enemies.js — enemies as sim citizens (ARENA1_STEPS Phase 5): the
// prototype's blob hop / wraith orbit-swoop-climb / spike patrol (reference/
// prototype.html 676–793 make/place, 1253–1346 AI), all timing tick math, all
// randomness from each enemy's own rngFor(seed, 'enemy', id) stream — drawn
// sequentially forever, so respawn placements replay identically on every
// peer. Respawns are sim-side; spawn points come from level data.
//
// Visual-only prototype behavior (grow-in scale, squash, wing flap, spin,
// flash) lives in render/actors.js; nothing here touches a mesh.

import { TUNE, SIM_DT } from '../config.js';
import { rngFor } from '../core/rng.js';

import { hurtPlayer, ENEMY_R } from './movement.js';

// The blob's collision radius — the same 0.65 the old downward-ray snap added.
const BLOB_R = 0.65;

const DOWN = { x: 0, y: -1, z: 0 };
const KILL_Y = -25;

export function initEnemies(ents, level, seed) {
  const mk = (kind, extra) => {
    const id = ents.allocId();
    const e = {
      id, kind, rng: rngFor(seed, 'enemy', id),
      pos: { x: 0, y: 0, z: 0 }, vx: 0, vy: 0, vz: 0,
      hp: 1, alive: true, respawnT: 0, yanked: 0, hitCd: 0, blockT: 0,
      ...extra,
    };
    ents.enemies.set(id, e);
    return e;
  };
  for (let i = 0; i < 8; i++) {
    const e = mk('blob', { hop: 0 });
    e.hop = 0.4 + e.rng();
    placeBlob(e, level);
  }
  for (let i = 0; i < 5; i++) {
    const e = mk('wraith', { ang: 0, orbR: 0, orbH: 0, spd: 0, state: 'orbit', stT: 0 });
    e.spd = (0.25 + e.rng() * 0.35) * (e.rng() > 0.5 ? 1 : -1);
    placeWraith(e, level);
  }
  for (const s of level.spikeSpots) {
    const e = mk('spike', { home: { ...s.pos }, r: s.r, dirA: 0, t: 0, spd: 0 });
    e.dirA = e.rng() * 6.28;
    e.spd = 0.6 + e.rng() * 0.8;
    placeSpike(e);
  }
}

function placeBlob(e, level) {
  if (level.platSpawnPoints.length && e.rng() < 0.55) {
    const p = level.platSpawnPoints[(e.rng() * level.platSpawnPoints.length) | 0];
    e.pos = { ...p };
  } else {
    const reach = level && level.hex ? level.hex.apothem : 66;
    const a = e.rng() * Math.PI * 2, r = reach * 0.25 + e.rng() * reach * 0.55;
    e.pos = { x: Math.cos(a) * r, y: 0.65, z: Math.sin(a) * r };
  }
  e.hp = 3; e.vx = 0; e.vy = 0; e.vz = 0; e.alive = true; e.yanked = 0;
}
/* MD 17 scales the two hardcoded spawn bands to the level. These are placement
   numbers, not behaviour: the AI is untouched. Left alone, wraiths would orbit
   only to y=112 of a 190m climb — the whole upper third of the new ascent would
   have no air threat at all — and blobs would stay inside r=50 of an arena whose
   apothem is now 86.6, leaving the outer ring empty. */
function placeWraith(e, level) {
  const top = level ? level.summitY : 128;
  const reach = level && level.hex ? level.hex.apothem : 66;
  e.ang = e.rng() * 6.28;
  e.orbR = reach * 0.2 + e.rng() * reach * 0.45;
  e.orbH = 22 + e.rng() * (top - 40);
  e.pos = { x: Math.cos(e.ang) * e.orbR, y: e.orbH, z: Math.sin(e.ang) * e.orbR };
  e.hp = 2; e.alive = true; e.yanked = 0; e.state = 'orbit'; e.stT = 0;
  e.vx = 0; e.vy = 0; e.vz = 0;
}
function placeSpike(e) {
  e.t = e.rng() * 6;
  e.pos = { x: e.home.x, y: e.home.y + 0.55, z: e.home.z };
  e.hp = 2; e.alive = true; e.yanked = 0; e.vx = 0; e.vy = 0; e.vz = 0;
}

export function killEnemy(ctx, e, byPlayerId) {
  e.alive = false;
  e.respawnT = e.kind === 'wraith' ? 4 : e.kind === 'spike' ? 5 : 2.5;
  releaseYankers(ctx, e);
  // kind: renderer-facing extension (burst color) on the specced {target, by}
  ctx.events.push({ type: 'kill', target: e.id, by: byPlayerId ?? null, kind: e.kind });
  if (byPlayerId != null) {
    const p = ctx.ents.players.get(byPlayerId);
    if (p) p.kills++;
  }
}
function releaseYankers(ctx, e) {
  for (const p of ctx.ents.players.values()) {
    if (p.grapple?.mode === 'yank' && p.grapple.enemyId === e.id) p.grapple = null;
  }
}

/* MD 25 item 5. A paused player is not a target — enemies behave as if they
   are not in the room, which is what makes disengagement fall out for free:
   nearestPlayer simply picks somebody else, or nobody, and the existing
   no-target branch handles the rest. There is no separate "forget your target"
   path to keep in sync.
   This is a TARGETING rule, not an invulnerability rule: other PLAYERS can
   still hit a paused player (see combat.js), because pause that stops bullets
   is a worse problem in PvP than the one being fixed. */
function nearestPlayer(players, pos) {
  let best = null;
  for (const p of players.values()) {
    if (p.paused) continue;
    const d = Math.hypot(p.pos.x - pos.x, p.pos.y - pos.y, p.pos.z - pos.z);
    if (!best || d < best.dist) best = { p, dist: d };
  }
  return best;
}
function moveToward(pos, tgt, maxStep) {
  const dx = tgt.x - pos.x, dy = tgt.y - pos.y, dz = tgt.z - pos.z;
  const l = Math.hypot(dx, dy, dz);
  if (l <= maxStep) { pos.x = tgt.x; pos.y = tgt.y; pos.z = tgt.z; }
  else { const k = maxStep / l; pos.x += dx * k; pos.y += dy * k; pos.z += dz * k; }
}

export function stepEnemies(ctx) {
  const dt = SIM_DT;
  const t = ctx.tick * SIM_DT;
  for (const e of ctx.ents.enemies.values()) {
    if (!e.alive) {
      e.respawnT -= dt;
      if (e.respawnT <= 0) {
        if (e.kind === 'blob') placeBlob(e, ctx.level);
        else if (e.kind === 'wraith') placeWraith(e, ctx.level);
        else placeSpike(e);
      }
      continue;
    }
    e.yanked -= dt; e.hitCd -= dt;
    const P = nearestPlayer(ctx.ents.players, e.pos);

    if (e.kind === 'blob') {
      /* MD 19: blobs used a DOWNWARD RAY for landing and nothing at all
         horizontally, so a hop toward the player went straight through walls —
         measured, not suspected. The whole move now goes through moveCapsule at
         the blob's own radius, which gives horizontal sliding and landing from
         the same solver. Radius 0.65 both ways is not arbitrary: it is exactly
         the +0.65 the old ray snap added, so a blob still rests at the same
         height it always did and the hop cadence is unchanged. res.grounded
         replaces the ray comparison outright. */
      let tx = 0, tz = 0;
      if (P) {
        tx = P.p.pos.x - e.pos.x; tz = P.p.pos.z - e.pos.z;
        const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      }
      e.vy += TUNE.G * 0.55 * dt;
      const bFrom = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
      const bRes = ctx.world.moveCapsule(bFrom, { x: e.vx, y: e.vy, z: e.vz },
        { x: e.vx * dt, y: e.vy * dt, z: e.vz * dt }, BLOB_R, BLOB_R);
      e.pos.x = bRes.pos.x; e.pos.y = bRes.pos.y; e.pos.z = bRes.pos.z;
      e.vx = bRes.vel.x; e.vy = bRes.vel.y; e.vz = bRes.vel.z;
      if (e.yanked <= 0) {
        const f = Math.max(0, 1 - 2 * dt);
        e.vx *= f; e.vz *= f;
      }
      if (bRes.grounded) {
        e.vy = 0;
        e.hop -= dt;
        if (e.hop <= 0 && P && P.dist < 45) {
          e.hop = 0.55 + e.rng() * 0.5;
          e.vy = 6.5; e.vx = tx * 4.2; e.vz = tz * 4.2;
        }
      }
      if (e.pos.y < KILL_Y) { e.alive = false; e.respawnT = 2.5; releaseYankers(ctx, e); continue; }
      if (P && P.dist < 1.5) {
        killEnemy(ctx, e, null); // it pops on you
        hurtPlayer(P.p, 20, ctx.events, e.pos);
      }
    } else if (e.kind === 'wraith') {
      /* MD 16 item 2. Every wraith state below writes e.pos DIRECTLY — orbit,
         swoop and climb all did free 3D movement with no shape test at all,
         which is why they flew through platforms. Rather than teach each state
         about collision, the states still propose a position and the move is
         RESOLVED once, here, against the world.
         Resolved with moveCapsule, not a bare raycast: it substeps at 0.25m
         (a swoop covers 0.23m/tick, so nothing thin can be tunnelled) and it
         SLIDES along contacts instead of stopping at them, which is the
         difference between an agile flier and one that snags on every corner.
         Radius = its own hit radius, half-height the same, so it resolves as a
         sphere — it is not a ground unit and gets no step-up. */
      const from = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
      if (e.yanked > 0) {
        e.pos.x += e.vx * dt; e.pos.y += e.vy * dt; e.pos.z += e.vz * dt;
      } else if (e.state === 'orbit') {
        e.ang += e.spd * dt;
        const tgt = {
          x: Math.cos(e.ang) * e.orbR,
          y: e.orbH + Math.sin(t * 1.3 + e.ang * 2) * 1.6,
          z: Math.sin(e.ang) * e.orbR,
        };
        moveToward(e.pos, tgt, 9 * dt);
        if (P && P.dist < 22 && Math.abs(P.p.pos.y - e.pos.y) < 16) { e.state = 'swoop'; e.stT = 3; }
      } else if (e.state === 'swoop') {
        e.stT -= dt;
        if (P) {
          moveToward(e.pos, { x: P.p.pos.x, y: P.p.pos.y + 0.4, z: P.p.pos.z }, 14 * dt);
          if (P.dist < 1.6 && e.hitCd <= 0) {
            e.hitCd = 1;
            hurtPlayer(P.p, 15, ctx.events, e.pos);
            e.state = 'climb'; e.stT = 1.4;
          } else if (e.stT <= 0) { e.state = 'climb'; e.stT = 1.2; }
        } else { e.state = 'climb'; e.stT = 1.2; }
      } else { // climb away, then resume orbit from wherever it ended up
        e.stT -= dt;
        if (P) {
          let ax = e.pos.x - P.p.pos.x, az = e.pos.z - P.p.pos.z;
          const al = Math.hypot(ax, az);
          if (al > 0.01) { ax /= al; az /= al; }
          e.pos.x += ax * 7 * dt; e.pos.z += az * 7 * dt;
        }
        e.pos.y += 9 * dt;
        if (e.stT <= 0) {
          e.state = 'orbit';
          e.ang = Math.atan2(e.pos.z, e.pos.x);
          e.orbR = Math.min(44, Math.max(14, Math.hypot(e.pos.x, e.pos.z)));
          e.orbH = Math.min(115, Math.max(16, e.pos.y));
        }
      }
      const disp = { x: e.pos.x - from.x, y: e.pos.y - from.y, z: e.pos.z - from.z };
      const res = ctx.world.moveCapsule(from, { x: e.vx, y: e.vy, z: e.vz }, disp,
        ENEMY_R.wraith, ENEMY_R.wraith);
      e.pos.x = res.pos.x; e.pos.y = res.pos.y; e.pos.z = res.pos.z;
      // A yanked wraith is ballistic, so its velocity has to be slid too or it
      // keeps driving into the surface it already hit. The AI states steer by
      // position and never read vx/vz, so their velocity is left alone.
      if (e.yanked > 0) { e.vx = res.vel.x; e.vy = res.vel.y; e.vz = res.vel.z; }

      /* AI deadlock guard. A swoop at a player behind a wall would otherwise
         press into it, slide, and keep pressing for the full 3s timer. wallN
         is moveCapsule's own "I am against something" report, so this needs no
         second query: half a second of being blocked ends the swoop early and
         sends it into climb, which lifts it over the obstruction and re-orbits
         from wherever it gets to. Orbit itself cannot deadlock — its target is
         an angle that keeps advancing whether or not the body follows. */
      if (res.wallN && e.state === 'swoop') {
        e.blockT += dt;
        if (e.blockT > 0.5) { e.state = 'climb'; e.stT = 1.2; e.blockT = 0; }
      } else if (e.blockT > 0) {
        e.blockT = Math.max(0, e.blockT - dt);
      }
      if (e.pos.y < KILL_Y) { e.alive = false; e.respawnT = 3; releaseYankers(ctx, e); continue; }
    } else { // spike — patrols its platform; grapple-yanking one is on you
      if (e.yanked > 0) {
        /* MD 19: only the YANKED path is resolved. That is the one that
           actually clipped — a spike flung at 60 m/s went clean through a 1m
           wall — while the patrol below is a lerp toward a point on the
           spike's OWN platform, bounded by that platform's radius, so it
           cannot reach geometry in the first place (measured: r=3 patrol never
           crossed, r=14 did, and the level never issues r=14). Resolving the
           patrol too would fight its 0.55m hover against a capsule the same
           size as the gap, which buys nothing and risks a standing push-up. */
        const sFrom = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
        const sRes = ctx.world.moveCapsule(sFrom, { x: e.vx, y: e.vy, z: e.vz },
          { x: e.vx * dt, y: e.vy * dt, z: e.vz * dt }, ENEMY_R.spike, ENEMY_R.spike);
        e.pos.x = sRes.pos.x; e.pos.y = sRes.pos.y; e.pos.z = sRes.pos.z;
        e.vx = sRes.vel.x; e.vy = sRes.vel.y; e.vz = sRes.vel.z;
      } else {
        e.t += dt * e.spd;
        const off = Math.sin(e.t) * e.r;
        const tgt = { x: e.home.x + Math.cos(e.dirA) * off, y: e.home.y + 0.55, z: e.home.z + Math.sin(e.dirA) * off };
        const k = Math.min(1, 5 * dt);
        e.pos.x += (tgt.x - e.pos.x) * k;
        e.pos.y += (tgt.y - e.pos.y) * k;
        e.pos.z += (tgt.z - e.pos.z) * k;
      }
      if (e.pos.y < KILL_Y) { e.alive = false; e.respawnT = 4; releaseYankers(ctx, e); continue; }
      if (P && P.dist < 1.35 && e.hitCd <= 0) {
        e.hitCd = 0.8;
        hurtPlayer(P.p, 12, ctx.events, e.pos);
      }
    }
  }
}
