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
import { hurtPlayer } from './movement.js';

const DOWN = { x: 0, y: -1, z: 0 };
const KILL_Y = -25;

export function initEnemies(ents, level, seed) {
  const mk = (kind, extra) => {
    const id = ents.allocId();
    const e = {
      id, kind, rng: rngFor(seed, 'enemy', id),
      pos: { x: 0, y: 0, z: 0 }, vx: 0, vy: 0, vz: 0,
      hp: 1, alive: true, respawnT: 0, yanked: 0, hitCd: 0,
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
    placeWraith(e);
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
    const a = e.rng() * Math.PI * 2, r = 26 + e.rng() * 24;
    e.pos = { x: Math.cos(a) * r, y: 0.65, z: Math.sin(a) * r };
  }
  e.hp = 3; e.vx = 0; e.vy = 0; e.vz = 0; e.alive = true; e.yanked = 0;
}
function placeWraith(e) {
  e.ang = e.rng() * 6.28;
  e.orbR = 16 + e.rng() * 24;
  e.orbH = 22 + e.rng() * 90;
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

function nearestPlayer(players, pos) {
  let best = null;
  for (const p of players.values()) {
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
        else if (e.kind === 'wraith') placeWraith(e);
        else placeSpike(e);
      }
      continue;
    }
    e.yanked -= dt; e.hitCd -= dt;
    const P = nearestPlayer(ctx.ents.players, e.pos);

    if (e.kind === 'blob') {
      const gHit = ctx.world.raycast({ x: e.pos.x, y: e.pos.y + 0.3, z: e.pos.z }, DOWN, 50);
      const gy = gHit ? gHit.point.y + 0.65 : -999;
      let tx = 0, tz = 0;
      if (P) {
        tx = P.p.pos.x - e.pos.x; tz = P.p.pos.z - e.pos.z;
        const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      }
      e.vy += TUNE.G * 0.55 * dt;
      e.pos.y += e.vy * dt;
      e.pos.x += e.vx * dt; e.pos.z += e.vz * dt;
      if (e.yanked <= 0) {
        const f = Math.max(0, 1 - 2 * dt);
        e.vx *= f; e.vz *= f;
      }
      if (e.pos.y <= gy && e.vy <= 0) {
        e.pos.y = gy; e.vy = 0;
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
      if (e.pos.y < KILL_Y) { e.alive = false; e.respawnT = 3; releaseYankers(ctx, e); continue; }
    } else { // spike — patrols its platform; grapple-yanking one is on you
      if (e.yanked > 0) {
        e.pos.x += e.vx * dt; e.pos.y += e.vy * dt; e.pos.z += e.vz * dt;
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
