/* Rate limits for the shared sketch gallery (/api/sketch), Dex 2026-10-08:
 * "limit the number of canvases created ... handle spammers ... while letting
 * people make quite a few canvases pretty fast".
 *
 * TWO KINDS OF COUNTER, chosen per action by what a miss costs:
 *
 *  - KEPT counters live in the store (sketch/limits/<name>-<key>.json), so
 *    they hold across every function instance and every cold start. One
 *    small read and write each, so they guard only what is rare and worth
 *    it: making accounts, a NEW canvas on an account, publishing, renaming.
 *  - MEMORY counters live in the warm instance. They cost nothing, and they
 *    blunt a flood from one client (which Vercel keeps routing to warm
 *    instances), but two instances each have their own. They guard the
 *    frequent writes -- votes, comments, follows, saves -- and every request
 *    per address.
 *
 * Both are TOKEN BUCKETS: `cap` requests at once, then one more every
 * `every` ms. A bucket is the standard shape because it lets a burst through
 * (a first sign-in uploading every canvas made signed out) and then holds a
 * steady rate, with no cliff at a window boundary.
 *
 * The ESCALATING cooldown Dex described -- a burst, then 15 seconds, then one
 * a minute -- is `cooldown()` below. The app runs the same rule on the device
 * (inko/app.js, RATE), because a canvas is MADE on the device, often signed
 * out, and never reaches the server until it is saved to an account. The two
 * copies are checked against each other by tools/sketch_check.mjs.
 *
 * Addresses are hashed with the store's secret before they are used as keys,
 * so the store never holds a raw IP.
 */
'use strict';

const crypto = require('node:crypto');

/* ---- the pure rules (no I/O: the checks drive these directly) ---------- */

/* A token bucket. state is { n, at } (tokens left, when last counted) or null.
   Returns { ok, wait, state }: wait is the ms until the next token. */
function bucket(state, now, { cap, every }) {
  let n = cap, at = now;
  if (state && Number.isFinite(state.n) && Number.isFinite(state.at) && state.at <= now) {
    n = Math.min(cap, state.n + (now - state.at) / every);
    at = now;
  }
  if (n >= 1) return { ok: true, wait: 0, state: { n: n - 1, at } };
  return { ok: false, wait: Math.ceil((1 - n) * every), state: { n, at } };
}

/* Making canvases: up to BURST in a minute (and LONG in ten) go straight
   through. Past that, a 15 second wait; keep going and it is one a minute,
   until ten quiet minutes forgive it. state is { t: [times], strike, until,
   last } or null. A refused try does not count as a canvas. */
const COOLDOWN = { burst: 8, long: 30, first: 15_000, then: 60_000, forgive: 10 * 60_000 };
function cooldown(state, now, rule = COOLDOWN) {
  const s = state && Array.isArray(state.t)
    ? { t: state.t.filter((x) => Number.isFinite(x) && x <= now), strike: state.strike | 0, until: +state.until || 0, last: +state.last || 0 }
    : { t: [], strike: 0, until: 0, last: 0 };
  if (now < s.until) return { ok: false, wait: s.until - now, state: s };
  if (s.last && now - s.last > rule.forgive) { s.t = []; s.strike = 0; }
  s.t = s.t.filter((x) => now - x < rule.forgive);
  if (s.strike >= 2 && s.last && now - s.last < rule.then) {
    s.until = s.last + rule.then;
    return { ok: false, wait: s.until - now, state: s };
  }
  if (s.strike < 2) {
    const minute = s.t.filter((x) => now - x < 60_000).length;
    if (minute >= rule.burst || s.t.length >= rule.long) {
      s.strike += 1;
      s.until = now + (s.strike === 1 ? rule.first : rule.then);
      return { ok: false, wait: s.until - now, state: s };
    }
  }
  s.t.push(now); s.t = s.t.slice(-rule.long); s.last = now;
  return { ok: true, wait: 0, state: s };
}

/* What each guarded thing allows. cap at once, then one per `every` ms. */
const RULES = {
  // per address, every POST and every search
  'ip-post':    { cap: 240, every: 250, kept: false },
  'ip-search':  { cap: 60, every: 500, kept: false },
  // per address: password tries and the site account's sign-in
  'ip-login':   { cap: 20, every: 20_000, kept: false },
  'ip-site':    { cap: 30, every: 10_000, kept: false },
  // per address: making an account (password, Google/Discord or site), five an hour
  'ip-account': { cap: 5, every: 12 * 60_000, kept: true },
  // per account
  'new-canvas': { cap: 120, every: 30_000, kept: true },   // a first sign-in can bring 120 at once; then two a minute
  'publish':    { cap: 20, every: 2 * 60_000, kept: true },
  'rename':     { cap: 3, every: 60 * 60_000, kept: true },
  'comment':    { cap: 8, every: 8_000, kept: false },
  'react':      { cap: 60, every: 1_000, kept: false },     // votes, reports, follows, invites
  'avatar':     { cap: 30, every: 5_000, kept: false },
};

/* ---- the counters ------------------------------------------------------- */

const mem = new Map();          // `${name}:${key}` -> bucket state; oldest dropped past MEM_MAX
const MEM_MAX = 5000;

const KEY = /^[a-z0-9_-]{1,64}$/;
async function take(io, name, key, now = Date.now()) {
  const rule = RULES[name];
  if (!rule) throw new Error('no such limit: ' + name);
  if (!KEY.test(key)) throw new Error('bad limit key');
  if (!rule.kept) {
    const id = name + ':' + key;
    const r = bucket(mem.get(id), now, rule);
    mem.delete(id); mem.set(id, r.state);                // most recent last
    if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value);
    return r;
  }
  const file = `sketch/limits/${name}-${key}.json`;
  const r = bucket(await io.readJson(file).catch(() => null), now, rule);
  if (r.ok) await io.writeJson(file, r.state);
  return r;
}
function forget(io, names, key) {
  return io.backend().remove(names.filter((n) => RULES[n] && RULES[n].kept).map((n) => `sketch/limits/${n}-${key}.json`)).catch(() => {});
}

/* The caller's address, as Vercel reports it, hashed. x-forwarded-for's first
   entry is set by Vercel's edge, not passed through from the client. */
function clientKey(req, secret) {
  const h = req.headers || {};
  const raw = String(h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || (req.socket && req.socket.remoteAddress) || 'unknown').trim();
  return crypto.createHmac('sha256', secret).update('sketch-ip|' + raw).digest('hex').slice(0, 32);
}

const waitWords = (ms) => {
  const s = Math.max(1, Math.ceil(ms / 1000));
  return s < 90 ? `${s} second${s === 1 ? '' : 's'}` : `${Math.ceil(s / 60)} minutes`;
};

module.exports = { bucket, cooldown, COOLDOWN, RULES, take, forget, clientKey, waitWords, _mem: mem };
