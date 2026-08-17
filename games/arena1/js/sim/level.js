// sim/level.js — buildLevel(rng): the prototype's arena constants + Ascent
// generator + pads/rings/cells/summit, emitting collision SHAPES plus plain
// placement data. The render layer (Phase 4) builds the pretty meshes FROM
// this data — the sim never sees a mesh, and the same rng stream reproduces
// the same level on every peer.
//
// Prototype source of truth: games/arena1/reference/prototype.html lines
// 259–535 (geometry) and 972–1035 (mover/blinker/collapser semantics). The
// archetype → collision approximation table is ARENA1_STEPS Phase 2.
//
// rng draws happen in the same relative order as the prototype (crystals →
// Ascent → rings) so layout statistics match; the prototype's pebbles are
// render-only and draw from their own stream there (rngFor(seed,'pebbles')).

import { TUNE, SIM_DT } from '../config.js';
import { norm } from './vec.js';

export const SUMMIT_Y = 570;   // MD 22: 3x the old 190

/* MD 17 — the arena is a regular HEXAGON, flat-top, circumradius HEX_R. For a
   regular hexagon the side length equals the circumradius, and the apothem
   (centre to the middle of an edge) is R·cos30 = 0.866R. So:
       across the flats   2 · 0.866R = 173.2m
       across the corners 2R         = 200m
       area  (3√3/2)R²               = 25,981 m²  (the old square was 16,900)
   Crossing time is the number that decides whether this is open or just a
   walk: 173m at WALK 9.2 m/s is 18.8s on foot, but the kit is the real
   measure — GRAPPLE_RANGE is 75m at GRAPPLE_PULL 24 m/s, so corner to corner
   is three grapples, roughly 9s, and a dash chain sits between the two.
   Bigger than that and the middle becomes dead space. */
export const HEX_R = 100;
export const HEX_APOTHEM = HEX_R * Math.cos(Math.PI / 6);
// Edge k spans vertices k and k+1; its midpoint sits at this angle.
export const hexEdgeAngle = (k) => (k + 0.5) * Math.PI / 3;
const GOLD = 2.39996; // golden-angle spiral

// Axes of a box rotated Babylon-style (rotation.y then rotation.x, roll 0):
// R = Ry(ry)·Rx(rx). Columns are the images of the local basis — stored, not
// re-derived per query (spec).
function rotYX(rx, ry) {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  return [
    { x: cy, y: 0, z: -sy },
    { x: sx * sy, y: cx, z: sx * cy },
    { x: cx * sy, y: -sx, z: cx * cy },
  ];
}

export function buildLevel(world, rng) {
  const level = {
    summitY: SUMMIT_Y,
    blocks: [],   // plain arena boxes {name,w,h,d,x,y,z,hex} — render rebuilds from these
    ramps: [],    // rotated boxes {name,w,h,d,x,y,z,rotX,rotY,hex}
    platforms: [], // the Ascent — see the platform record below
    pads: [],     // jump pads {x,z,power,r}
    rings: [],    // boost rings {pos,dir}
    crystals: [], // {x,y,z,s,sy,rotY,col} — collidable, arena + platform deco
    cellSpots: [], platSpawnPoints: [], spikeSpots: [],
  };

  const box = (name, w, h, d, x, y, z, hex) => {
    level.blocks.push({ name, w, h, d, x, y, z, hex });
    world.addAabb(
      { x: x - w / 2, y: y - h / 2, z: z - d / 2 },
      { x: x + w / 2, y: y + h / 2, z: z + d / 2 });
  };
  const ramp = (name, w, h, d, x, y, z, rotX, rotY, hex) => {
    level.ramps.push({ name, w, h, d, x, y, z, rotX, rotY, hex });
    world.addObb({ x, y, z }, { x: w / 2, y: h / 2, z: d / 2 }, rotYX(rotX, rotY));
  };

  // ---- arena: hexagon ----
  /* COLLISION FLOOR is one oversized square slab, not a fan of wedges. A fan
     means five interior seams plus six wall joins, and a seam between angled
     obbs is precisely where a capsule falls through — the single likeliest
     failure this MD names. One slab has no seams at all. It extends past the
     walls, which is invisible from inside (the walls are 12 tall) and costs
     one shape instead of six.
     The floor you SEE is hexagonal: level.hex tells the render layer to draw a
     6-sided disc of radius HEX_R over it. Collision and appearance disagree
     only in the region behind a solid wall. */
  level.hex = { R: HEX_R, apothem: HEX_APOTHEM, floorY: 0, wallH: 12 };
  box('ground', HEX_R * 2.4, 2, HEX_R * 2.4, 0, -1, 0, '#E8C77E');
  level.blocks[level.blocks.length - 1].hexDisc = HEX_R;   // render draws a hexagon here

  const RIM = '#4A2B63';
  const WALL_H = 12, WALL_T = 3;
  /* Six rim walls on the edges. Emitted through ramp() — a rotated box — so the
     render layer draws them with no new code, and the obb axes come from the
     same rotYX the ramps use. rotY = -midpointAngle puts local +X on the
     outward normal and local +Z along the edge, which is the same convention
     the ring segments already use. Length is the side (= R) plus an overlap so
     the corner joins cannot open a gap. */
  for (let k = 0; k < 6; k++) {
    const m = hexEdgeAngle(k);
    ramp('wall' + k, WALL_T, WALL_H, HEX_R + WALL_T * 2, 
      Math.cos(m) * HEX_APOTHEM, WALL_H / 2, Math.sin(m) * HEX_APOTHEM,
      0, -m, RIM);
  }

  box('spire', 9, 26, 9, 0, 13, 0, '#372052');
  box('spireCap', 12, 1, 12, 0, 26.5, 0, '#3EC5B4');
  ramp('rampA', 5, 1, 22, 17, 2.6, 0, -0.24, Math.PI / 2, '#D9A85C');
  ramp('rampB', 5, 1, 22, -17, 2.6, 9, 0.24, Math.PI / 2, '#D9A85C');
  box('padPlatA', 10, 1, 10, 38, 5, 0, '#5A3B7A');
  box('padPlatB', 10, 1, 10, -38, 6, 18, '#5A3B7A');
  box('slab1', 2, 16, 18, 56, 8, -26, '#372052');
  box('slab2', 2, 16, 18, 66, 8, -26, '#372052');
  box('slab3', 18, 16, 2, -52, 8, 50, '#372052');
  box('slab4', 18, 16, 2, -52, 8, 60, '#372052');
  /* Pillars on the six edge bearings rather than a scatter: standing anywhere
     on the floor you see a pillar toward each flat, which is what makes the
     six-sidedness readable from inside without a map. */
  for (let k = 0; k < 6; k++) {
    const m = hexEdgeAngle(k);
    const r = HEX_APOTHEM * 0.62;
    const h = 12 + (k % 3) * 5;
    box('pil' + k, 3.6, h, 3.6, Math.cos(m) * r, h / 2, Math.sin(m) * r,
      k % 2 ? '#4A2B63' : '#372052');
  }
  // ...and a shorter marker at each CORNER, so the vertices read too.
  for (let k = 0; k < 6; k++) {
    const a = k * Math.PI / 3, r = HEX_R * 0.9;
    box('cor' + k, 4.4, 7, 4.4, Math.cos(a) * r, 3.5, Math.sin(a) * r, '#5A3B7A');
  }

  // Jump pads: vcyl solid + trigger radius (movement consumes the trigger in
  // Phase 3; power is the launch velocity, straight from the prototype).
  const pad = (x, z, power) => {
    level.pads.push({ x, z, power, r: 2.2 });
    world.addVcyl({ x, y: 0.2, z }, 2.2, 0.2);
  };
  pad(30, 0, 17); pad(-30, 14, 18); pad(0, -34, 20); pad(48, -32, 22);

  // Crystals collide in the prototype (checkCollisions on the LOD root), so
  // they collide here: a slightly-inset vcyl under the faceted blob. Draw
  // order inside matches the prototype's crystal() (height factor, then yaw).
  const crystal = (x, y, z, s, col) => {
    const sy = s * (1.6 + rng() * 1.4);
    const rotY = rng() * Math.PI;
    const cy = y + sy * 0.8;
    level.crystals.push({ x, y: cy, z, s, sy, rotY, col });
    world.addVcyl({ x, y: cy, z }, s * 0.9, sy);
  };
  // Scatter band scales with the arena. Capped at 0.82·apothem so a crystal
  // can never grow into a rim wall, which at the old fixed 60 would now leave
  // the outer third of the floor bare.
  /* SPAWN CLEARANCE, not just an origin box. Players spawn at (0±2, 26±2) and
     walk out from there, but the old exclusion only guarded the middle — the
     corridor in front of the spawn was never protected and simply happened to
     stay clear on the old layout. On the rebuild two crystals landed at
     (1.9, 34.6) and (-0.6, 34.8), close enough together to form a pocket that
     wedged a walking player solid about 8m from where they start. Carving the
     spawn as well as the centre fixes the class, not the instance. */
  const SPAWN = { x: 0, z: 26 }, SPAWN_CLEAR = 12;
  for (let i = 0; i < 64; i++) {
    const a = rng() * Math.PI * 2, r = 20 + rng() * (HEX_APOTHEM * 0.82 - 20);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < 12 && Math.abs(z) < 12) continue;
    if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < SPAWN_CLEAR) continue;
    crystal(x, 0, z, 0.7 + rng() * 1.6, rng() > 0.5 ? 'teal' : 'pink');
  }

  // ---- THE ASCENT (prototype lines 371–495) ----
  // platMesh() port: same rolls, same dims, collision per the Phase 2 table.
  function platShapes(x, y, z, platformId) {
    const roll = rng();
    const opts = { platformId };
    const shapes = [];
    const S = (sh) => { shapes.push(sh); return sh; };
    const cbox = (cx, cy, cz, w, h, d) => S(world.addAabb(
      { x: cx - w / 2, y: cy - h / 2, z: cz - d / 2 },
      { x: cx + w / 2, y: cy + h / 2, z: cz + d / 2 }, opts));
    if (roll < 0.28) { // slab — thickness varies wildly → aabb
      const w = 4 + rng() * 9, d = 4 + rng() * 9, h = 0.5 + rng() * 4.5;
      cbox(x, y, z, w, h, d);
      return { archetype: 'slab', dims: { w, d, h }, approxR: Math.min(w, d) * 0.45, halfH: h / 2, spikeOk: true, shapes };
    }
    if (roll < 0.48) { // hex/oct pad (convex) → vcyl at ~the polygon's mean radius
      const dia = 5 + rng() * 9, h = 0.6 + rng() * 3.4, tess = 6 + ((rng() * 3) | 0);
      S(world.addVcyl({ x, y, z }, dia * 0.46, h / 2, opts));
      return { archetype: 'pad', dims: { dia, h, tess }, approxR: dia * 0.42, halfH: h / 2, spikeOk: true, shapes };
    }
    if (roll < 0.62) { // rock chunk → vcyl (r = avg xz half-extent, halfH from bounds)
      const sx = 3 + rng() * 4, sy = 1.0 + rng() * 1.8, sz = 3 + rng() * 4;
      S(world.addVcyl({ x, y, z }, (sx + sz) / 2, sy, opts));
      return { archetype: 'rock', dims: { sx, sy, sz }, approxR: 2.6, halfH: sy * 0.8, spikeOk: true, shapes };
    }
    if (roll < 0.76) { // cross (concave inner corners) → 2 aabbs
      const h = 0.8 + rng() * 2.4, len = 6 + rng() * 7, wid = 2.6 + rng() * 2;
      cbox(x, y, z, len, h, wid);
      cbox(x, y, z, wid, h, len);
      return { archetype: 'cross', dims: { h, len, wid }, approxR: len * 0.32, halfH: h / 2, spikeOk: true, shapes };
    }
    if (roll < 0.86) { // L (concave corner) → 2 aabbs, second arm offset
      const h = 0.8 + rng() * 2.4, len = 6 + rng() * 6, wid = 3 + rng() * 1.6;
      cbox(x, y, z, len, h, wid);
      cbox(x + len / 2 - wid / 2, y, z + len / 2 - wid / 2, wid, h, len);
      return { archetype: 'L', dims: { h, len, wid }, approxR: len * 0.3, halfH: h / 2, spikeOk: true, shapes };
    }
    if (roll < 0.94) { // ring — 8 obb segments around the annulus; the hole stays a hole
      const D = 9 + rng() * 6, h = 0.9 + rng() * 1.4;
      const rm = D * 0.36;                       // annulus centerline (outer 0.5D, inner 0.22D)
      const radial = D * 0.14;                   // (0.5D − 0.22D) / 2
      const tang = rm * Math.tan(Math.PI / 8) * 1.02; // slight overlap so seams can't catch
      for (let k = 0; k < 8; k++) {
        const th = (k + 0.5) * Math.PI / 4;
        const ct = Math.cos(th), st = Math.sin(th);
        S(world.addObb(
          { x: x + ct * rm, y, z: z + st * rm },
          { x: radial, y: h / 2, z: tang },
          [{ x: ct, y: 0, z: st }, { x: 0, y: 1, z: 0 }, { x: -st, y: 0, z: ct }], opts));
      }
      return { archetype: 'ring', dims: { D, h }, approxR: D * 0.36, halfH: h / 2, spikeOk: false, shapes };
    }
    // dish — crater bowl → 10 rim obbs + one lowered floor vcyl (the bowl,
    // flattened at roughly the carve's mean depth; spec blesses the approximation)
    const D = 7 + rng() * 5, h = 2.6 + rng() * 1.6;
    {
      const rm = D * 0.45, radial = D * 0.07;
      const tang = rm * Math.tan(Math.PI / 10) * 1.05;
      for (let k = 0; k < 10; k++) {
        const th = (k + 0.5) * Math.PI / 5;
        const ct = Math.cos(th), st = Math.sin(th);
        S(world.addObb(
          { x: x + ct * rm, y, z: z + st * rm },
          { x: radial, y: h / 2, z: tang },
          [{ x: ct, y: 0, z: st }, { x: 0, y: 1, z: 0 }, { x: -st, y: 0, z: ct }], opts));
      }
      const floorTop = h / 2 - 0.165 * D, floorBot = -h / 2;
      S(world.addVcyl(
        { x, y: y + (floorTop + floorBot) / 2, z }, D * 0.25, (floorTop - floorBot) / 2, opts));
    }
    return { archetype: 'dish', dims: { D, h }, approxR: D * 0.34, halfH: h / 2, spikeOk: false, shapes };
  }

  (function genAscent() {
    /* TWO interleaved spiral arms instead of one. The vertical step is
       UNCHANGED (2.2 + rng*3.2, mean 3.8m) and that is deliberate: the shipped
       single-arm climb is known reachable with the current kit, so keeping the
       per-step delta identical means reachability per step is unchanged and
       only the count and the spread grow. Arm B is offset half a turn and sits
       in a wider radial band, so at any height there are two options at
       different bearings instead of one — that is what fills the dead pockets
       rather than making individual gaps bigger.
       Arm B is also seeded half a step higher, so the two arms alternate on
       the way up rather than pairing off at the same altitude. */
    const ARMS = [
      { a: rng() * 6.28, y: 10, rMin: 18, rSpan: 34, prev: null },
      { a: rng() * 6.28 + Math.PI, y: 11.9, rMin: 34, rSpan: 40, prev: null },
    ];
    /* MD 22: the column is 3x taller and DELIBERATELY thins with altitude — the
       sparse top is part of the difficulty curve, not decoration. The step
       between platforms grows with height, so the lower and middle bands keep
       roughly the density they had while the last stretch spreads out.
       The ceiling on that growth is REACHABILITY, and it is derived rather than
       guessed: the jetpack is hard-limited to 3.85s of continuous burn (MD 20)
       at JET_VMAX 14.5, and a rocket jump apexes ~77m, so a step the jet alone
       must cover has to stay well inside what one tank buys. STEP_MAX 10m is
       0.7s of jet at JET_VMAX out of the 3.85s a tank buys, so grapple and
       rocket jump stay comfort rather than necessity. */
    const STEP_MIN_LOW = 2.2, STEP_VAR_LOW = 3.2;   // unchanged near the floor
    const STEP_MAX = 10;
    const thin = (y) => Math.min(1, Math.max(0, (y - 120) / (SUMMIT_Y - 120)));
    let i = 0;
    // Round-robin the arms so the rng draw order is a stable interleave and
    // both arms climb together.
    while (ARMS.some((A) => A.y < SUMMIT_Y - 6)) {
    for (const ARM of ARMS) {
      if (ARM.y >= SUMMIT_Y - 6) continue;
      let a = ARM.a, y = ARM.y, prev = ARM.prev;
      a += GOLD + (rng() - 0.5) * 0.5;
      // Radial band scales with the hexagon; clamped inside 0.86·apothem so a
      // platform's collision approximation can never straddle a rim wall.
      const rRaw = ARM.rMin + rng() * ARM.rSpan + Math.sin(y * 0.08) * 8;
      const r = Math.min(rRaw, HEX_APOTHEM * 0.86);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const roll = rng();
      let type = 'static', hex = '#5A3B7A';
      if (roll > 0.87) { type = 'collapse'; hex = '#D9A85C'; }
      else if (roll > 0.76) { type = 'blink'; hex = '#B84D8F'; }
      else if (roll > 0.58) { type = 'mover'; hex = '#3E7FC5'; }
      const platformId = level.platforms.length;
      const info = platShapes(x, y, z, platformId);
      const pl = {
        id: platformId, type, hex, base: { x, y, z }, phase: rng() * 6.28,
        amp: 0, speed: 0, axis: { x: 0, y: 0, z: 0 },
        archetype: info.archetype, dims: info.dims,
        approxR: info.approxR, halfH: info.halfH, spikeOk: info.spikeOk,
        shapes: info.shapes,
        // runtime (ticked in tickPlatforms; all tick-derived, no wall clock)
        state: 'idle', timerTicks: 0, fallV: 0, fallY: 0, respawnTicks: 0,
        active: true, offset: { x: 0, y: 0, z: 0 }, lastDelta: { x: 0, y: 0, z: 0 },
      };
      if (type === 'mover') {
        const vert = rng() > 0.65;
        pl.axis = vert ? { x: 0, y: 1, z: 0 } : (rng() > 0.5 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 });
        pl.amp = vert ? 2.2 + rng() * 2.5 : 3.5 + rng() * 4.5;
        pl.speed = 0.25 + rng() * 0.4;
      }
      level.platforms.push(pl);

      // decorations only on static platforms (prototype lines 460–485)
      if (type === 'static') {
        const top = y + info.halfH;
        if (info.spikeOk) {
          if (rng() < 0.28) crystal(x + (rng() - 0.5) * info.approxR, top, z + (rng() - 0.5) * info.approxR, 0.4 + rng() * 0.7, rng() > 0.5 ? 'teal' : 'pink');
          if (rng() < 0.32 && level.cellSpots.length < 13) level.cellSpots.push({ x: x + (rng() - 0.5) * info.approxR * 0.8, y: top + 0.9, z: z + (rng() - 0.5) * info.approxR * 0.8 });
          if (rng() < 0.26) level.platSpawnPoints.push({ x, y: top + 0.7, z });
          if (rng() < 0.34 && level.spikeSpots.length < 8) level.spikeSpots.push({ pos: { x, y: top, z }, r: Math.max(1.4, info.approxR * 0.65) });
        } else if (rng() < 0.55 && level.cellSpots.length < 13) {
          level.cellSpots.push({ x, y: top + 1.1, z }); // hover bait over rings & craters
        }
        // occasional ramp down to the previous static platform
        if (prev && rng() < 0.30) {
          const dx = x - prev.x, dy = y - prev.y, dz = z - prev.z;
          const hd = Math.hypot(dx, dz);
          if (Math.abs(dy) < 4.5 && hd > 4 && hd < 16) {
            const len = Math.hypot(hd, dy);
            ramp('rmp' + i, 3, 0.6, len,
              prev.x + dx / 2, prev.y + dy / 2 + 0.2, prev.z + dz / 2,
              -Math.atan2(dy, hd), Math.atan2(dx, dz), '#D9A85C');
          }
        }
        prev = { x, y, z };
      }
      /* Step grows from the original 2.2-5.4m near the floor to at most
         STEP_MAX at the summit. `thin` is 0 below 120m so the lower band is
         bit-for-bit the spacing it always had. */
      const t01 = thin(y);
      const base = STEP_MIN_LOW + (STEP_MAX * 0.55 - STEP_MIN_LOW) * t01;
      const varr = STEP_VAR_LOW + (STEP_MAX * 0.45 - STEP_VAR_LOW) * t01;
      y += base + rng() * varr;
      i++;
      ARM.a = a; ARM.y = y; ARM.prev = prev;
    }
    }
    // summit (the beacon is render-only: no collision in the prototype either)
    box('summit', 15, 1.2, 15, 0, SUMMIT_Y, 0, '#3EC5B4');
    level.cellSpots.push({ x: 3, y: SUMMIT_Y + 1.6, z: 3 });
  })();

  // ---- boost rings (prototype lines 497–516; non-solid, trigger-only) ----
  for (let i = 0; i < 6; i++) {
    const y = 24 + i * 16 + rng() * 6;
    const a = rng() * 6.28, r = 20 + rng() * 18;
    const pos = { x: Math.cos(a) * r, y, z: Math.sin(a) * r };
    const dir = norm({ x: -Math.sin(a), y: 0.35 + rng() * 0.3, z: -Math.cos(a) }); // roughly inward+up
    level.rings.push({ pos, dir });
  }

  // ---- fuel cell starters + spire cap (prototype line 520) ----
  level.cellSpots.push({ x: 20, y: 1.4, z: 20 }, { x: -24, y: 1.4, z: -18 }, { x: 0, y: 19.6, z: 0 });

  return level;
}

// Ticked by the sim BEFORE players move each tick (the prototype's order:
// platforms first, so ground carry uses fresh deltas). standingIds is the set
// of platform ids players stood on at the end of last tick; events collects
// wire-format events for the snapshot.
export function tickPlatforms(world, level, tick, standingIds, events) {
  const t = tick * SIM_DT;
  for (const pl of level.platforms) {
    const px = pl.offset.x, py = pl.offset.y, pz = pl.offset.z;
    if (pl.type === 'mover') {
      // pos(tick) = base + axis · amp · sin(2π·speed·tick·SIM_DT + phase) — spec verbatim
      const o = Math.sin(2 * Math.PI * pl.speed * t + pl.phase) * pl.amp;
      pl.offset = { x: pl.axis.x * o, y: pl.axis.y * o, z: pl.axis.z * o };
    } else if (pl.type === 'blink') {
      const on = ((t + pl.phase) % 4.5) < 3.0;
      if (on !== pl.active) {
        pl.active = on;
        for (const s of pl.shapes) world.setShapeActive(s, on);
      }
    } else if (pl.type === 'collapse') {
      // FSM idle→shaking(0.8s)→falling→gone(4s)→idle, all in ticks. The shake
      // jitter is cosmetic (render-side); sim shapes hold still until the fall.
      if (pl.state === 'idle') {
        if (standingIds && standingIds.has(pl.id)) {
          pl.state = 'shaking';
          pl.timerTicks = Math.round(0.8 / SIM_DT);
          // The trigger tick is a wire event so late-joining peers can replay it.
          events.push({ type: 'platform_trigger', platformId: pl.id, tick });
        }
      } else if (pl.state === 'shaking') {
        if (--pl.timerTicks <= 0) { pl.state = 'falling'; pl.fallV = 0; }
      } else if (pl.state === 'falling') {
        pl.fallV += TUNE.G * 0.6 * SIM_DT;
        pl.fallY += pl.fallV * SIM_DT;
        if (pl.fallY < -45) {
          pl.state = 'gone';
          pl.respawnTicks = Math.round(4 / SIM_DT);
          pl.active = false;
          for (const s of pl.shapes) world.setShapeActive(s, false);
        }
      } else if (pl.state === 'gone') {
        if (--pl.respawnTicks <= 0) {
          pl.state = 'idle'; pl.fallV = 0; pl.fallY = 0;
          pl.active = true;
          for (const s of pl.shapes) world.setShapeActive(s, true);
        }
      }
      pl.offset = { x: 0, y: pl.fallY, z: 0 };
    }
    pl.lastDelta = { x: pl.offset.x - px, y: pl.offset.y - py, z: pl.offset.z - pz };
    if (pl.lastDelta.x !== 0 || pl.lastDelta.y !== 0 || pl.lastDelta.z !== 0) {
      for (const s of pl.shapes) world.setShapeOffset(s, pl.offset);
    }
  }
}
