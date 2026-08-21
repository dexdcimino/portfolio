// Where the other five worlds actually SIT in the sky, measured from more than
// one place on the ground.
//
//   node dev/skycheck.mjs            the table
//   node dev/skycheck.mjs --pairs    every ordered pair, long form
//
// ELEVATION IS NOT A PROPERTY OF A WORLD, and that is the whole reason this
// file exists. You are standing on a sphere: local up rotates as you drive, so
// a world 80 degrees above the horizon at the spawn is at 20 a quarter of the
// way round and below the horizon on the far side. A single number per pair —
// which is what `neighbours()` returns and what anyone reading tune.js would
// reach for — describes one point on one world and nothing else.
//
// The separations are 294km to 945km against radii of 207m to 2072m, so the
// DIRECTION to another world is fixed to a part in a thousand across the whole
// of any surface. Everything that varies is the observer's up. That is what
// makes this measurable analytically rather than by flying: elevation is
// asin(dot(dirTo(A), up(P))) and the only variable is P.
//
// The vantage points are one great circle through the spawn: the spawn itself,
// a quarter turn along it, the antipode, and three quarters. Four points, one
// lap, which is the trip the complaint is about — "you cannot aim at the one
// you want, and pointing at any of them means pointing straight up" is a claim
// about driving around, not about standing still.
//
// THE SPAWN IS NOT A NEUTRAL VANTAGE. `findSpawn` scores the Fibonacci spiral
// by how many neighbours sit ABOVE it — see SKY_LOW/SKY_FULL in surface.js —
// so the one point every session begins at is chosen to put worlds in the sky.
// Any complaint about where the worlds are has to be read against that first.

/* The Babylon stub first: `discs.js` builds a Vector2 at module scope, and
   `neighbours()` is in it. Nothing here draws anything — the stub exists so
   this can be pure arithmetic in node, the same arrangement run.mjs uses. */
import { BABYLON } from './babylon-stub.mjs';
globalThis.BABYLON = BABYLON;

const { PLANETS, SYSTEM } = await import('../js/tune.js');
const { makePlanet, TangentFrame } = await import('../js/world/sphere.js');
const { findSpawn } = await import('../js/world/surface.js');
const { neighbours } = await import('../js/world/discs.js');

const LONG = process.argv.includes('--pairs');
const deg = (r) => (r * 180) / Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const unit = (v) => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Rotate `v` about the unit axis `k` by `ang`. Rodrigues. */
function rot(v, k, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const kv = dot(k, v);
  return {
    x: v.x * c + (k.y * v.z - k.z * v.y) * s + k.x * kv * (1 - c),
    y: v.y * c + (k.z * v.x - k.x * v.z) * s + k.y * kv * (1 - c),
    z: v.z * c + (k.x * v.y - k.y * v.x) * s + k.z * kv * (1 - c),
  };
}

/* Four vantages on one great circle through the spawn, walked NORTH — the
   frame's own north, so the lap is a lap the craft could actually drive. */
const TURNS = [['spawn', 0], ['quarter', Math.PI / 2], ['half', Math.PI],
  ['three-qtr', 3 * Math.PI / 2]];

function vantages(key) {
  const P = makePlanet(PLANETS[key]);
  const dirs = neighbours(P).map((n) => n.dir);
  const spawn = findSpawn(P, P.relief * 0.12, P.relief * 0.75, dirs);
  const fr = new TangentFrame(P, spawn);
  // Driving north rotates the up vector about EAST.
  const axis = unit(fr.east);
  return TURNS.map(([name, ang]) => ({ name, up: unit(rot(unit(spawn), axis, ang)) }));
}

/** Elevation and azimuth of world `to` from a vantage on world `from`. */
function look(from, to, up) {
  const a = SYSTEM.at[from], b = SYSTEM.at[to];
  const dir = unit({ x: b[0] - a[0], y: b[1] - a[1], z: b[2] - a[2] });
  const elev = Math.asin(clamp(dot(dir, up), -1, 1));
  // Azimuth in the vantage's own tangent frame, north = 0, east = +90.
  const fr = new TangentFrame(makePlanet(PLANETS[from]), up);
  const n = dot(dir, fr.north), e = dot(dir, fr.east);
  let az = deg(Math.atan2(e, n));
  if (az < 0) az += 360;
  return { elev: deg(elev), az };
}

const KEYS = Object.keys(SYSTEM.at).filter((k) => PLANETS[k]);

/* COUNT THE SUBJECT. A loop over a discovered set reports clean when the set
   is empty — the rule is a section in the root ARCHITECTURE.md. Six worlds,
   thirty ordered pairs, four vantages each: 120 looks. */
const WANT_WORLDS = 6;
const WANT_PAIRS = WANT_WORLDS * (WANT_WORLDS - 1);
const WANT_LOOKS = WANT_PAIRS * TURNS.length;

let looks = 0, pairs = 0;
const rows = [];
const spawnElev = [];
const spawnAz = {};

for (const from of KEYS) {
  const vs = vantages(from);
  spawnAz[from] = [];
  for (const to of KEYS) {
    if (to === from) continue;
    pairs++;
    const seen = vs.map((v) => ({ turn: v.name, ...look(from, to, v.up) }));
    looks += seen.length;
    spawnElev.push(seen[0].elev);
    spawnAz[from].push({ to, az: seen[0].az, elev: seen[0].elev });
    rows.push({ from, to, seen });
  }
}

if (KEYS.length !== WANT_WORLDS || pairs !== WANT_PAIRS || looks !== WANT_LOOKS) {
  console.error(`skycheck: expected ${WANT_WORLDS} worlds, ${WANT_PAIRS} pairs and ` +
    `${WANT_LOOKS} looks; measured ${KEYS.length}, ${pairs}, ${looks}. ` +
    `Broken discovery, not a clean run.`);
  process.exit(1);
}

// ---- at the spawn ---------------------------------------------------------

console.log(`SKYCHECK — ${KEYS.length} worlds, ${pairs} ordered pairs, ` +
  `${looks} looks (${TURNS.length} vantages each)\n`);

console.log('AT THE SPAWN — elevation above the local horizon, and bearing\n');
console.log('from     ' + KEYS.map((k) => k.padStart(14)).join(''));
for (const from of KEYS) {
  const cells = KEYS.map((to) => {
    if (to === from) return '             .';
    const hit = spawnAz[from].find((x) => x.to === to);
    return `${hit.elev.toFixed(0)}° @${hit.az.toFixed(0)}°`.padStart(14);
  });
  console.log(from.padEnd(9) + cells.join(''));
}

const hi = Math.max(...spawnElev), lo = Math.min(...spawnElev);
const above60 = spawnElev.filter((e) => e > 60).length;
const below0 = spawnElev.filter((e) => e < 0).length;
const mean = spawnElev.reduce((a, b) => a + b, 0) / spawnElev.length;
console.log(`\nspawn elevations: ${lo.toFixed(0)}° to ${hi.toFixed(0)}°, mean ` +
  `${mean.toFixed(0)}° — ${above60} of ${pairs} above 60°, ${below0} below the horizon`);

/* AZIMUTH CLUSTERING, at the spawn. The complaint "you cannot tell them apart"
   is about bearing, not elevation: two worlds a few degrees apart in azimuth
   and both high up are one smear of sky. The gap reported is the smallest
   angular separation between any two of the five, ON THE SKY (not in azimuth
   alone — two worlds can share a bearing and be nowhere near each other). */
console.log('\nCLOSEST PAIR ON THE SKY, from each spawn\n');
let worstGap = Infinity, worstAt = '';
for (const from of KEYS) {
  const vs = vantages(from);
  const dirs = KEYS.filter((k) => k !== from).map((to) => {
    const a = SYSTEM.at[from], b = SYSTEM.at[to];
    return { to, d: unit({ x: b[0] - a[0], y: b[1] - a[1], z: b[2] - a[2] }) };
  });
  let gap = Infinity, which = '';
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      const g = deg(Math.acos(clamp(dot(dirs[i].d, dirs[j].d), -1, 1)));
      if (g < gap) { gap = g; which = `${dirs[i].to}/${dirs[j].to}`; }
    }
  }
  if (gap < worstGap) { worstGap = gap; worstAt = `${from}: ${which}`; }
  const up = vs[0].up;
  const both = which.split('/').map((k) => look(from, k, up).elev.toFixed(0) + '°').join(' and ');
  console.log(`${from.padEnd(9)} ${gap.toFixed(1)}° apart — ${which.padEnd(16)} (${both} up at the spawn)`);
}
console.log(`\nclosest anywhere: ${worstGap.toFixed(1)}° (${worstAt})`);

/* AND HOW MUCH OF THE COMPASS IS EMPTY. "Spread across the sky" has a bearing
   half as well as a separation half, and they are not the same claim: five
   worlds can all be 30 degrees apart and still sit in one half of the compass
   if they are stacked in elevation. This is the widest stretch of bearing with
   nothing in it, at the spawn. 72 degrees is what a perfectly even five would
   leave; anything near 180 is a sky with a blank side. */
console.log('\nWIDEST EMPTY ARC OF COMPASS, from each spawn (72° = perfectly even)\n');
let widestArc = 0, widestArcAt = '';
for (const from of KEYS) {
  const azs = spawnAz[from].map((x) => x.az).sort((a, b) => a - b);
  let arc = 0, after = '';
  for (let j = 0; j < azs.length; j++) {
    const g = (azs[(j + 1) % azs.length] - azs[j] + 360) % 360;
    if (g > arc) { arc = g; after = azs[j].toFixed(0); }
  }
  if (arc > widestArc) { widestArc = arc; widestArcAt = from; }
  console.log(from.padEnd(9) + arc.toFixed(0) + '° of empty compass, starting at bearing ' + after + '°');
}
console.log(`\nwidest anywhere: ${widestArc.toFixed(0)}° (${widestArcAt})`);

// ---- and around a lap -----------------------------------------------------

console.log('\nAROUND ONE LAP — elevation at each quarter turn from the spawn\n');
console.log('from     to        ' + TURNS.map(([n]) => n.padStart(11)).join('') + '        range');
let widest = 0, tightest = Infinity;
for (const r of rows) {
  const es = r.seen.map((s) => s.elev);
  const span = Math.max(...es) - Math.min(...es);
  widest = Math.max(widest, span);
  tightest = Math.min(tightest, span);
  if (LONG || r.from === 'home' || r.to === 'home') {
    console.log(r.from.padEnd(9) + r.to.padEnd(10) +
      es.map((e) => (e.toFixed(0) + '°').padStart(11)).join('') +
      (span.toFixed(0) + '°').padStart(13));
  }
}
if (!LONG) console.log('\n(--pairs for all thirty)');
console.log(`\nelevation SPAN over one lap: ${tightest.toFixed(0)}° to ${widest.toFixed(0)}° ` +
  `across ${pairs} pairs — a world is not at an elevation, it is at a range of them`);
