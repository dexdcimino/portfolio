/* Backups for Inko's account data (Dex, 2026-10-08: "a professional backup
 * system ... if somebody accidentally deletes an account, or gets hacked, or
 * an account with canvases is overwritten by an empty one").
 *
 * THREE LAYERS, and the order matters: each one covers what the one above
 * cannot.
 *
 *   1. NOTHING IS DELETED OR OVERWRITTEN IN PLACE. A canvas save writes a new
 *      version (it always did: <id>-<v>.png) but the version it replaces is no
 *      longer removed -- it is RETIRED: its bytes stay, and the account's
 *      index records it with the window it was live in ({ from, to }). A
 *      deleted canvas is retired the same way. That is point-in-time recovery
 *      per save, for free: no extra write, the record rides in the index the
 *      save writes anyway.
 *   2. SNAPSHOTS. Once a day, the first write to an account first copies the
 *      whole account as it stood -- its record, its follows, its canvas index
 *      and the retired list -- to sketch-backup/<handle>/. They thin out like
 *      every serious backup rotation (grandfather-father-son): the newest of
 *      each of the last 7 days, 4 weeks and 4 months. A snapshot names bytes,
 *      it does not copy them; a version a kept snapshot names is never
 *      collected. This is what survives the index itself being wiped.
 *   3. A TRASH for whole accounts. Deleting an account (or renaming it) takes
 *      it off the site at once, but its canvases and backups stay for 30
 *      days, listed in sketch/trash.json, and an admin can bring it back
 *      exactly. The daily cron (vercel.json) purges what is past 30 days.
 *
 * WHAT IT COSTS. Vercel Blob on Hobby includes 2,000 puts a month, and going
 * over locks the store for 30 days -- which would take the site down, the
 * very thing a backup is for. So: a steady save costs exactly what it did
 * (png, thumb, index: three puts); a snapshot is ONE put per active account
 * per day; deletes are free. Retired versions are collected on the next save:
 * a canvas keeps its 5 newest old versions and the newest of each hour of the
 * last day for a week, its last version for 30 days after a delete, and
 * whatever a kept snapshot names.
 *
 * WHAT IT DOES NOT COVER. Published copies (the public WebP), reactions and
 * comments are not kept: they hang off public posts, a canvas can be
 * published again, and deleting an account must take its public face down
 * at once. Everything lives in the same Blob store; a copy off Vercel is the
 * next step if the site moves to Pro (see docs/BACKUPS.md).
 *
 * RESTORE is admin-only (Dex's universal JWT, like moderation): /api/sketch
 * actions backup-status, backup-restore and backup-undelete, and
 * tools/inko_restore.mjs to drive them for one account or everyone.
 */
'use strict';

const HOUR = 60 * 60 * 1000, DAY = 24 * HOUR;
const META = '~meta';                    // the ledger's key in a canvas index; never a canvas id
const KEEP_RECENT = 5;                   // newest retired versions of each canvas...
const RECENT_MS = 7 * DAY;               // ...kept this long
const HOURLY_MS = DAY;                   // plus the newest of each hour of the last day
const TRASH_MS = 30 * DAY;               // deleted canvases, deleted and renamed accounts
const TIERS = [['day', 7], ['week', 4], ['month', 4]];
const FORCED_MS = 30 * DAY;              // snapshots taken before a restore or a rename
const TRASH_KEY = 'sketch/trash.json';
const PREFIX = 'sketch-backup/';

// Required lazily: the store requires this module.
const store = () => require('./sketch-store.js');
const io = () => store().io;

const stamp = (t) => new Date(t).toISOString().replace(/[:.]/g, '-');
const snapKey = (h, at, why) => `${PREFIX}${h}/${stamp(at)}-${why}.json`;
const pngKeys = (h, id, v) => [`sketch/canvases/${h}/${id}-${v}.png`, `sketch/canvases/${h}/${id}-${v}-t.jpg`];

/* ---- the ledger ----------------------------------------------------------- */

function meta(idx) {
  const m = idx[META] && typeof idx[META] === 'object' ? idx[META] : {};
  idx[META] = {
    retired: Array.isArray(m.retired) ? m.retired : [],
    snaps: Array.isArray(m.snaps) ? m.snaps : [],
    top: m.top && typeof m.top === 'object' ? m.top : {},
  };
  return idx[META];
}
/* The canvases alone, as the app sees them. */
function live(idx) {
  const out = {};
  for (const [k, c] of Object.entries(idx || {})) if (k !== META) out[k] = c;
  return out;
}

/* Never reuse a version number: a retired version's bytes sit under it. */
function nextVersion(idx, id) {
  const m = meta(idx);
  let top = Number(m.top[id]) || 0;
  if (idx[id] && idx[id].v) top = Math.max(top, idx[id].v);
  for (const r of m.retired) if (r.id === id) top = Math.max(top, r.v);
  m.top[id] = top + 1;
  return top + 1;
}

/* An entry stops being live: keep its bytes and the window it was live in. */
function retire(idx, entry, now, deleted = false) {
  if (!entry || !entry.v || entry.deleted) return;
  const m = meta(idx);
  m.retired.push({ ...entry, from: Number(entry.saved) || 0, to: now, ...(deleted ? { deleted: true } : {}) });
}

/* ---- the rotation: which snapshots and which retired versions stay --------
   Pure, so the check can drive a hundred days through it on a fake clock. */
function bucket(t, unit) {
  const d = new Date(t);
  if (unit === 'day') return d.toISOString().slice(0, 10);
  if (unit === 'month') return d.toISOString().slice(0, 7);
  // ISO-ish week: the Monday it starts on.
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}
function keepSnaps(snaps, now) {
  const keep = new Set();
  const newestFirst = [...snaps].sort((a, b) => b.at - a.at);
  for (const [unit, n] of TIERS) {
    const seen = new Set();
    for (const s of newestFirst) {
      if (s.why !== 'daily') continue;
      const b = bucket(s.at, unit);
      if (seen.has(b)) continue;
      if (seen.size >= n) break;
      seen.add(b); keep.add(s.key);
    }
  }
  for (const s of snaps) if (s.why !== 'daily' && now - s.at < FORCED_MS) keep.add(s.key);
  return keep;
}
function plan(idx, now) {
  const m = meta(idx);
  const snapsKept = keepSnaps(m.snaps, now);
  const kept = m.snaps.filter((s) => snapsKept.has(s.key));
  const dropSnaps = m.snaps.filter((s) => !snapsKept.has(s.key)).map((s) => s.key);
  const isLive = (r) => idx[r.id] && !idx[r.id].deleted && idx[r.id].v === r.v;
  const byId = new Map();
  for (const r of m.retired) { if (!byId.has(r.id)) byId.set(r.id, []); byId.get(r.id).push(r); }
  const keepR = [], dropR = [];
  for (const list of byId.values()) {
    list.sort((a, b) => b.to - a.to);
    const hours = new Set();
    list.forEach((r, i) => {
      const age = now - r.to;
      const hour = Math.floor(r.to / HOUR);
      const hourly = age < HOURLY_MS && !hours.has(hour);
      if (hourly) hours.add(hour);
      const ok = isLive(r)
        || (age < RECENT_MS && i < KEEP_RECENT)
        || hourly
        || (r.deleted && age < TRASH_MS)
        || kept.some((s) => r.from <= s.at && s.at <= r.to);
      (ok ? keepR : dropR).push(r);
    });
  }
  return { snaps: kept, retired: keepR, dropSnaps, dropRetired: dropR };
}

/* Called by every write to an index, after the change and before the index is
   written. Applies the rotation to the ledger and answers the keys to delete
   AFTER the index is safely written (deletes are free on Blob). */
function tidy(handle, idx, now) {
  const p = plan(idx, now);
  const m = meta(idx);
  m.retired = p.retired;
  m.snaps = p.snaps;
  // A version can be live more than once (a restore brings it back), so a
  // dropped record's bytes go only when nothing live or kept names them.
  const keepKeys = new Set();
  for (const c of Object.values(live(idx))) if (c.v && !c.deleted) pngKeys(handle, c.id, c.v).forEach((k) => keepKeys.add(k));
  for (const r of p.retired) pngKeys(handle, r.id, r.v).forEach((k) => keepKeys.add(k));
  const drop = p.dropSnaps.slice();
  for (const r of p.dropRetired) for (const k of pngKeys(handle, r.id, r.v)) if (!keepKeys.has(k)) drop.push(k);
  return drop;
}

/* ---- snapshots ------------------------------------------------------------- */

const due = (idx, now) => !meta(idx).snaps.some((s) => s.why === 'daily' && bucket(s.at, 'day') === bucket(now, 'day'));

async function snapshot(handle, idx, why, now) {
  const { readJson, writeJson } = io();
  const m = meta(idx);
  const [user, social] = await Promise.all([readJson(`sketch/users/${handle}.json`), readJson(`sketch/social/${handle}.json`)]);
  const key = snapKey(handle, now, why);
  await writeJson(key, { v: 1, handle, at: now, why, user, social, index: live(idx), retired: m.retired, snaps: m.snaps });
  m.snaps.push({ at: now, key, why });
  return key;
}

/* The first write of the day to an account snapshots it as it stood before
   that write. A failed snapshot is logged and the save goes ahead: losing a
   drawing because its backup could not be written is the wrong way round. */
async function beforeWrite(handle, idx, now) {
  if (!due(idx, now)) return null;
  if (!Object.keys(live(idx)).length && !meta(idx).retired.length) return null;   // nothing to keep yet
  try { return await snapshot(handle, idx, 'daily', now); }
  catch (err) { console.error('sketch-backup: snapshot failed', handle, err); return null; }
}

/* ---- the trash: whole accounts ----------------------------------------- */

async function readTrash() { return (await io().readJson(TRASH_KEY)) || []; }

/* An account leaves (deleted, or renamed away from this name): snapshot it
   one last time, list it in the trash, and leave its bytes where they are. */
async function trashAccount(handle, idx, kind, now, extra = {}) {
  const key = await snapshot(handle, idx, kind, now);
  const trash = (await readTrash()).filter((t) => !(t.handle === handle && t.kind === kind && t.at === now));
  trash.push({ handle, kind, at: now, purgeAt: now + TRASH_MS, snap: key, ...extra });
  await io().writeJson(TRASH_KEY, trash);
  return key;
}

/* Everything a trashed account's last snapshot can reach. */
function keysOf(handle, snap) {
  const keys = new Set([...(snap.snaps || []).map((s) => s.key)]);
  for (const c of Object.values(snap.index || {})) if (c && c.v) pngKeys(handle, c.id, c.v).forEach((k) => keys.add(k));
  for (const r of snap.retired || []) pngKeys(handle, r.id, r.v).forEach((k) => keys.add(k));
  return keys;
}

/* The daily cron. Removes what is past its 30 days -- except anything the
   name's CURRENT owner uses, if the name was taken again meanwhile. */
async function purge(now = Date.now()) {
  const { readJson, writeJson, backend } = io();
  const trash = await readTrash();
  const keep = [], purged = [];
  for (const t of trash) {
    if (t.purgeAt > now) { keep.push(t); continue; }
    const snap = await readJson(t.snap);
    const keys = snap ? keysOf(t.handle, snap) : new Set();
    keys.add(t.snap);
    const nowIdx = (await readJson(`sketch/canvases/${t.handle}/index.json`)) || {};
    if (Object.keys(nowIdx).length) {
      for (const c of Object.values(live(nowIdx))) if (c.v) pngKeys(t.handle, c.id, c.v).forEach((k) => keys.delete(k));
      const m = meta(nowIdx);
      for (const r of m.retired) pngKeys(t.handle, r.id, r.v).forEach((k) => keys.delete(k));
      for (const s of m.snaps) keys.delete(s.key);
    }
    await backend().remove([...keys]);
    purged.push({ handle: t.handle, kind: t.kind, at: t.at, keys: keys.size });
  }
  if (purged.length) await writeJson(TRASH_KEY, keep);
  return { purged, waiting: keep.length };
}

/* ---- restore ------------------------------------------------------------ */

/* Every version of every canvas the backups know of, with the window it was
   live in: the live index, the retired list, and every snapshot (found by
   listing, so a wiped index does not hide them). */
async function history(handle, now) {
  const { readJson, backend } = io();
  const idx = (await readJson(`sketch/canvases/${handle}/index.json`)) || {};
  // One record per time a version was live: a restore makes an old version
  // live again, under its old number, from a new time.
  const recs = new Map();
  const add = (r, precise) => {
    const k = `${r.id}:${r.v}:${r.from}`;
    const had = recs.get(k);
    if (!had || (precise && !had.precise)) recs.set(k, { ...r, precise });
  };
  for (const c of Object.values(live(idx))) if (c.v && !c.deleted) add({ ...c, from: Number(c.saved) || 0, to: Infinity }, true);
  for (const r of meta(idx).retired) add(r, true);
  const keys = new Set(meta(idx).snaps.map((s) => s.key));
  for (const k of await backend().list(`${PREFIX}${handle}/`)) keys.add(k);
  const snaps = [];
  for (const k of keys) {
    const s = await readJson(k);
    if (!s) continue;
    snaps.push({ at: s.at, key: k, why: s.why, canvases: Object.keys(s.index || {}).length, user: !!s.user });
    for (const r of s.retired || []) add(r, true);
    for (const c of Object.values(s.index || {})) if (c && c.v && !c.deleted) add({ ...c, from: Number(c.saved) || 0, to: undefined, seen: s.at }, false);
  }
  // A version only a snapshot knows of was live until the next version began.
  const all = [...recs.values()];
  for (const r of all) {
    if (r.to !== undefined) continue;
    const next = all.filter((o) => o.id === r.id && o.from > r.from).sort((a, b) => a.from - b.from)[0];
    r.to = next ? Math.max(next.from, r.seen) : Infinity;
  }
  snaps.sort((a, b) => a.at - b.at);
  return { idx, versions: all, snaps };
}

/* The account as it stood at `at`: for each canvas, the version live then. */
function stateAt(versions, at) {
  const out = new Map();
  for (const r of versions) {
    if (!(r.from <= at && at < r.to)) continue;
    const had = out.get(r.id);
    if (!had || r.from > had.from) out.set(r.id, r);
  }
  return out;
}

/* Put an account's canvases back as they were at `at`.
 *   from   restore from another handle's backups (an account renamed away)
 *   ids    only these canvases
 *   mode   'exact'   (default) the account ends up as it was: canvases made
 *                    since are retired, which is itself undoable
 *          'missing' only bring back canvases that are gone now
 *   dry    say what would happen, change nothing
 * Restored canvases get ts = now so every device takes them over whatever it
 * holds; a 'pre-restore' snapshot is taken first so a restore can be undone. */
async function restore(handle, { at, from, ids, mode = 'exact', dry = false } = {}, now = Date.now()) {
  const { readJson, writeJson, backend } = io();
  const { HANDLE, POST_ID, Refused } = store();
  const src = from || handle;
  if (!HANDLE.test(handle) || !HANDLE.test(src)) throw new Refused(400, 'Bad handle');
  const when = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(when)) throw new Refused(400, 'at: a time to restore to');
  if (mode !== 'exact' && mode !== 'missing') throw new Refused(400, 'mode: exact or missing');
  const only = Array.isArray(ids) && ids.length ? new Set(ids.map(String).filter((i) => POST_ID.test(i))) : null;
  const user = await readJson(`sketch/users/${handle}.json`);
  if (!user || user.movedTo) throw new Refused(404, `@${handle} is not a live account`);

  const hist = await history(src, now);
  const want = stateAt(hist.versions, when);
  const idx = src === handle ? hist.idx : ((await readJson(`sketch/canvases/${handle}/index.json`)) || {});
  const current = live(idx);
  const plan = { restored: [], removed: [], unchanged: [], missing: [] };
  const touch = (id) => !only || only.has(id);

  for (const [id, r] of want) {
    if (!touch(id)) continue;
    const cur = current[id];
    if (mode === 'missing' && cur && !cur.deleted) continue;
    if (src === handle && cur && !cur.deleted && cur.v === r.v) { plan.unchanged.push(id); continue; }
    const png = await backend().read(pngKeys(src, id, r.v)[0]);
    if (!png) { plan.missing.push({ id, v: r.v }); continue; }
    plan.restored.push({ id, v: r.v, title: r.title, png });
  }
  if (mode === 'exact') {
    for (const c of Object.values(current)) if (!c.deleted && touch(c.id) && !want.has(c.id)) plan.removed.push(c.id);
  }
  const answer = () => ({ at: new Date(when).toISOString(), from: src, restored: plan.restored.map(({ id, v, title }) => ({ id, v, title })),
                          removed: plan.removed, unchanged: plan.unchanged, missing: plan.missing });
  if (dry) return { dry: true, ...answer() };

  const pre = await snapshot(handle, idx, 'pre-restore', now);
  for (const p of plan.restored) {
    const r = want.get(p.id);
    let v = r.v;
    if (src !== handle) {
      v = nextVersion(idx, p.id);
      const [pngK, thumbK] = pngKeys(handle, p.id, v);
      await backend().write(pngK, p.png, 'image/png');
      const th = await backend().read(pngKeys(src, p.id, r.v)[1]);
      if (th) await backend().write(thumbK, th, 'image/jpeg');
    }
    retire(idx, idx[p.id], now);
    const { from: _f, to: _t, precise: _p, seen: _s, deleted: _d, ...entry } = r;
    idx[p.id] = { ...entry, id: p.id, v, ts: now, saved: now };
    const m = meta(idx);
    m.top[p.id] = Math.max(Number(m.top[p.id]) || 0, v);
  }
  for (const id of plan.removed) {
    retire(idx, idx[id], now, true);
    idx[id] = { id, deleted: true, ts: now };
  }
  const drop = tidy(handle, idx, now);
  await writeJson(`sketch/canvases/${handle}/index.json`, idx);
  await backend().remove(drop).catch(() => {});
  return { ...answer(), snapshot: pre };
}

/* Bring a deleted account back, exactly as it was when it was deleted: its
   record (password, sign-in links), its follows and its canvases. Its public
   posts and comments are not part of it (see the top). */
async function undelete(handle, now = Date.now()) {
  const { readJson, writeJson } = io();
  const { Refused, HANDLE } = store();
  if (!HANDLE.test(handle)) throw new Refused(400, 'Bad handle');
  const trash = await readTrash();
  const t = trash.filter((x) => x.handle === handle && x.kind === 'deleted').sort((a, b) => b.at - a.at)[0];
  if (!t) throw new Refused(404, `@${handle} is not in the trash`);
  if (await readJson(`sketch/users/${handle}.json`)) throw new Refused(409, `@${handle} has been taken again; restore with backup-restore from:"${handle}" into another account`);
  const snap = await readJson(t.snap);
  if (!snap || !snap.user) throw new Refused(410, 'That account\'s last snapshot is gone');
  const user = { ...snap.user, posts: [] };
  delete user.avatar;    // the picture's bytes went with the account
  const identities = [];
  for (const i of Array.isArray(user.identities) ? user.identities : []) {
    const link = await readJson(`sketch/identities/${i}.json`);
    if (link && link.handle && link.handle !== handle && await store().liveHandle(link.handle)) continue;
    await writeJson(`sketch/identities/${i}.json`, { handle, linked: now });
    identities.push(i);
  }
  user.identities = identities;
  await writeJson(`sketch/users/${handle}.json`, user);
  if (snap.social && !(await readJson(`sketch/social/${handle}.json`))) {
    await writeJson(`sketch/social/${handle}.json`, { ...snap.social, comments: [] });
  }
  // The canvases come back with ts = now, so a phone still holding them agrees.
  const idx = { ...snap.index, [META]: { retired: snap.retired || [], snaps: snap.snaps || [], top: {} } };
  for (const c of Object.values(live(idx))) if (!c.deleted) c.ts = Math.max(c.ts || 0, now);
  await writeJson(`sketch/canvases/${handle}/index.json`, idx);
  await store().indexHandle(handle);
  await writeJson(TRASH_KEY, trash.filter((x) => x !== t));
  return { handle, canvases: Object.values(live(idx)).filter((c) => !c.deleted).length, identities: identities.length };
}

async function status(handle, now = Date.now()) {
  const trash = await readTrash();
  if (!handle) {
    const handles = (await io().readJson('sketch/handles.json')) || [];
    return { handles, trash };
  }
  const h = await history(handle, now);
  const c = live(h.idx);
  return {
    handle,
    canvases: Object.values(c).filter((x) => !x.deleted).map(({ id, v, title, ts, saved }) => ({ id, v, title, ts, saved })),
    retired: meta(h.idx).retired.map(({ id, v, title, from, to, deleted }) => ({ id, v, title, from, to, ...(deleted ? { deleted } : {}) })),
    snapshots: h.snaps,
    trash: trash.filter((t) => t.handle === handle),
  };
}

module.exports = {
  META, live, meta, nextVersion, retire, tidy, plan, beforeWrite, snapshot, trashAccount, purge,
  history, stateAt, restore, undelete, status, readTrash,
  TRASH_MS, RECENT_MS, KEEP_RECENT, TIERS, PREFIX,
};
