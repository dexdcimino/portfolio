/* The shared sketch gallery: accounts, published drawings, reactions, reports.
 *
 * NAMED "sketch", NOT AFTER THE APP. The app is being renamed (2026-10-07), and
 * an API path or a storage prefix is the one name that cannot change once real
 * data sits under it. The UI can rename freely; these keys stay.
 *
 * WHAT IS ON THE SERVER, AND WHAT IS NOT. Signed OUT, a drawing never leaves
 * the device -- it lives in the app's IndexedDB and nowhere else. Signed IN,
 * the account's canvases are kept here too, so they follow the account to
 * every device (Dex, 2026-10-08) -- readable only with that account's token,
 * never through the public image route, never in the feed. Making one PUBLIC
 * is still separate: it uploads a flattened snapshot (a WebP and a JPEG
 * thumbnail) and lists it in the feed; making it private again deletes both.
 *
 * Layout, in the site's existing private Blob store (or NOTES_DEV_DIR locally):
 *   sketch/users/<handle>.json   { handle, salt, hash, created, fails, lockUntil }
 *   sketch/posts/<id>.json       { id, handle, title, created, updated, v, fire, poop, reporters[], hidden }
 *   sketch/votes/<id>.json       { <handle>: 'fire' | 'poop' }
 *   sketch/img/<id>-<v>.webp     the drawing; sketch/img/<id>-<v>-t.jpg its thumbnail
 *   sketch/feed.json             [summary, ...] newest first: ONE read per feed view
 *   sketch/canvases/<handle>/index.json        { <id>: { id, title, bg, created, ts, visibility, v } | { id, deleted, ts } }
 *   sketch/canvases/<handle>/<id>-<v>.png      an account canvas's strokes; -<v>-t.jpg its thumbnail
 *   sketch/avatars/<handle>-<v>.jpg            the profile picture, a 256px square cut from a canvas
 *   sketch/avatars.json          { <handle>: v } every profile picture, so a feed read can name them
 *   sketch/handles.json          [handle, ...] sorted: what @-search searches
 *
 *   sketch/canvases/<handle>/index.json["~meta"]  the backup ledger: retired versions, snapshots
 *   sketch-backup/<handle>/<iso>-<why>.json      an account snapshot; sketch/trash.json  accounts kept 30 days
 *
 * BACKUPS (lib/sketch-backup.js): a canvas's bytes are never deleted or
 * overwritten by a save, a delete, a rename or an account deletion -- they
 * are retired and collected on a schedule, so any of those can be undone.
 *
 * Versioned image keys (-<v>) are what let the image route say "immutable":
 * re-publishing an edited drawing writes new keys rather than new bytes under
 * an old one.
 *
 * CONCURRENCY. Writes are read-modify-write with no lock. At one person and
 * their friends that is fine, and it is the first thing to change -- a ledger
 * per post, as the notes store has -- when the feed is busy enough to race.
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const backup = require('./sketch-backup.js');
const path = require('node:path');

const HANDLE = /^[a-z0-9_]{3,20}$/;
const RESERVED = new Set(['admin', 'administrator', 'mod', 'moderator', 'support', 'staff', 'system', 'dex', 'dexdc', 'dexcimino', 'sketch', 'inko', 'official', 'root']);
const POST_ID = /^[a-z0-9]{3,40}$/;
const IMG_KEY = /^sketch\/img\/[a-z0-9]{3,40}-\d{1,6}(-t)?\.(webp|jpg)$/;
const AVATAR_KEY = /^sketch\/avatars\/[a-z0-9_]{3,20}-\d{1,6}\.jpg$/;
const MAX_AVATAR = 120_000;
const MAX_IMAGE = 1_500_000, MAX_THUMB = 250_000, MAX_FEED = 500, MAX_TITLE = 40;
const MAX_CANVAS = 3_000_000, MAX_CANVASES = 1000, TOMBSTONE_MS = 90 * 24 * 60 * 60 * 1000;
const HIDE_AT_REPORTS = 3;
const TOKEN_TTL = 90 * 24 * 60 * 60 * 1000;     // a phone stays signed in for three months
const FAIL_LIMIT = 10, LOCK_MS = 15 * 60 * 1000;
// scrypt on a megabyte of password is a denial of service; nobody types 256 characters.
const MAX_PASSWORD = 256;
const FUTURE_MS = 24 * 60 * 60 * 1000;

/* ---- where the bytes go -------------------------------------------------- */

function devDir() {
  const dir = process.env.NOTES_DEV_DIR;
  if (!dir) return null;
  if (process.env.VERCEL_ENV === 'production') throw new Error('NOTES_DEV_DIR is set in production.');
  return dir;
}

function configError() {
  if (!devDir() && !process.env.BLOB_READ_WRITE_TOKEN) return 'BLOB_READ_WRITE_TOKEN is not set.';
  return null;
}

const local = {
  async read(key) {
    try { return await fs.readFile(path.join(devDir(), key)); }
    catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  },
  async write(key, body) {
    const file = path.join(devDir(), key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  },
  async remove(keys) { await Promise.all(keys.map((k) => fs.rm(path.join(devDir(), k), { force: true }))); },
  async list(prefix) {
    const out = [];
    const walk = async (rel) => {
      let names;
      try { names = await fs.readdir(path.join(devDir(), rel), { withFileTypes: true }); }
      catch (err) { if (err.code === 'ENOENT') return; throw err; }
      for (const d of names) {
        const k = rel ? `${rel}/${d.name}` : d.name;
        if (d.isDirectory()) await walk(k); else if (k.startsWith(prefix)) out.push(k);
      }
    };
    await walk(prefix.replace(/\/[^/]*$/, ''));
    return out.sort();
  },
};

const blobBackend = {
  async read(key) {
    const { get } = require('@vercel/blob');
    let found;
    try { found = await get(key, { access: 'private', useCache: false }); }
    catch (err) {
      if (err && (err.name === 'BlobNotFoundError' || /not.?found/i.test(err.message || ''))) return null;
      throw err;
    }
    if (!found || !found.stream) return null;
    return Buffer.from(await new Response(found.stream).arrayBuffer());
  },
  async write(key, body, contentType = 'application/json; charset=utf-8') {
    const { put } = require('@vercel/blob');
    await put(key, body, { access: 'private', contentType, addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 });
  },
  async remove(keys) {
    if (!keys.length) return;
    const { del } = require('@vercel/blob');
    await del(keys);
  },
  // An advanced operation per page: only restores and the trash use it.
  async list(prefix) {
    const { list } = require('@vercel/blob');
    const out = [];
    let cursor;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      for (const b of page.blobs) out.push(b.pathname);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out.sort();
  },
};

const backend = () => (devDir() ? local : blobBackend);
const readJson = async (key) => { const b = await backend().read(key); return b ? JSON.parse(b.toString('utf8')) : null; };
const writeJson = (key, value) => backend().write(key, JSON.stringify(value));

/* ---- sessions ------------------------------------------------------------- */

/* The signing key is DERIVED, so there is no new secret to configure: from the
   Blob token in production (always set when this store works at all), and a
   fixed dev key on the dev disk. Domain-separated by the prefix, so it can sign
   nothing any other part of the site would accept. */
function secret() {
  const base = process.env.SKETCH_SECRET || process.env.BLOB_READ_WRITE_TOKEN || (devDir() ? 'sketch-dev-only' : '');
  if (!base) throw new Error('no secret to sign sessions with');
  return crypto.createHash('sha256').update('sketch-session-v1|' + base).digest();
}
const b64u = (b) => Buffer.from(b).toString('base64url');
function mintToken(handle, now = Date.now()) {
  const payload = b64u(JSON.stringify({ h: handle, exp: now + TOKEN_TTL }));
  return payload + '.' + b64u(crypto.createHmac('sha256', secret()).update(payload).digest());
}
function readToken(token, now = Date.now()) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, mac] = token.split('.', 2);
  const want = Buffer.from(b64u(crypto.createHmac('sha256', secret()).update(payload).digest()));
  const got = Buffer.from(mac || '');
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  return data && HANDLE.test(data.h) && now < data.exp ? data.h : null;
}

/* Dex's universal admin token (api/auth/unlock: an HS256 JWT signed with
   AUTH_SECRET, tier admin) is what moderation accepts -- no second admin. */
function isAdmin(jwt) {
  const key = process.env.AUTH_SECRET;
  if (!key || typeof jwt !== 'string') return false;
  const [h, b, s] = jwt.split('.');
  if (!h || !b || !s) return false;
  const want = b64u(crypto.createHmac('sha256', key).update(h + '.' + b).digest());
  if (want.length !== s.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(s))) return false;
  try {
    const p = JSON.parse(Buffer.from(b, 'base64url').toString());
    return p.tier === 'admin' && (!p.exp || p.exp * 1000 > Date.now());
  } catch { return false; }
}

const scrypt = (pw, salt) => new Promise((res, rej) =>
  crypto.scrypt(pw, salt, 32, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? rej(err) : res(key))));

/* ---- accounts -------------------------------------------------------------- */

class Refused extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const normHandle = (h) => String(h || '').trim().toLowerCase();

async function signup(handleIn, password) {
  const handle = normHandle(handleIn);
  if (!HANDLE.test(handle)) throw new Refused(400, 'Names are 3-20 letters, numbers or _');
  if (RESERVED.has(handle)) throw new Refused(409, 'That name is taken');
  if (typeof password !== 'string' || password.length < 8) throw new Refused(400, 'Passwords need at least 8 characters');
  if (password.length > MAX_PASSWORD) throw new Refused(400, 'Passwords can be at most 256 characters');
  if (await readJson(`sketch/users/${handle}.json`)) throw new Refused(409, 'That name is taken');
  const salt = b64u(crypto.randomBytes(16));
  const hash = b64u(await scrypt(password, salt));
  await writeJson(`sketch/users/${handle}.json`, { handle, salt, hash, created: Date.now(), fails: 0, lockUntil: 0 });
  await indexHandle(handle);
  // FRESH: this call made the account. It is the ONLY thing that lets the app
  // move a device's signed-out canvases into an account (inko/app.js
  // adoptLocal); the server decides it, so no sign-in to an account that
  // already exists can ever say it (Dex, 2026-10-08).
  return { handle, token: mintToken(handle), fresh: true };
}

async function login(handleIn, password) {
  const handle = normHandle(handleIn);
  const user = HANDLE.test(handle) ? await readJson(`sketch/users/${handle}.json`) : null;
  if (!user) throw new Refused(401, 'Wrong name or password');
  if (user.movedTo) throw new Refused(401, `That name is now @${user.movedTo}`);
  if (!user.hash) throw new Refused(401, 'This account signs in with Google or Discord');
  if (user.lockUntil > Date.now()) throw new Refused(429, 'Too many tries. Wait 15 minutes.');
  const ok = typeof password === 'string' && password.length <= MAX_PASSWORD &&
    crypto.timingSafeEqual(await scrypt(password, user.salt), Buffer.from(user.hash, 'base64url'));
  if (!ok) {
    user.fails = (user.fails || 0) + 1;
    if (user.fails >= FAIL_LIMIT) { user.lockUntil = Date.now() + LOCK_MS; user.fails = 0; }
    await writeJson(`sketch/users/${handle}.json`, user);
    throw new Refused(401, 'Wrong name or password');
  }
  if (user.fails) { user.fails = 0; await writeJson(`sketch/users/${handle}.json`, user); }
  return { handle, token: mintToken(handle) };
}

/* ---- the feed -------------------------------------------------------------- */

const summary = (p) => ({ id: p.id, handle: p.handle, title: p.title, created: p.created, v: p.v, fire: p.fire, poop: p.poop });
async function readFeed() { return (await readJson('sketch/feed.json')) || []; }
async function writeFeedEntry(post) {
  const feed = (await readFeed()).filter((s) => s.id !== post.id);
  if (post && !post.hidden) feed.unshift(summary(post));
  feed.sort((a, b) => b.created - a.created);
  await writeJson('sketch/feed.json', feed.slice(0, MAX_FEED));
}
async function dropFeedEntry(id) {
  const feed = await readFeed();
  const next = feed.filter((s) => s.id !== id);
  if (next.length !== feed.length) await writeJson('sketch/feed.json', next);
}

/* ---- posts -------------------------------------------------------------- */

function decodeImage(dataUrl, kind) {
  const m = /^data:image\/(webp|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
  if (!m) throw new Refused(400, `The ${kind} is not a WebP or JPEG image`);
  const buf = Buffer.from(m[2], 'base64');
  // The bytes have to agree with the label: RIFF....WEBP, or a JPEG SOI marker.
  const webp = buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  const jpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (!(m[1] === 'webp' ? webp : jpeg)) throw new Refused(400, `The ${kind} bytes are not what they claim to be`);
  const limit = kind === 'thumbnail' ? MAX_THUMB : MAX_IMAGE;
  if (buf.length > limit) throw new Refused(413, `The ${kind} is too large`);
  return { buf, ext: m[1] === 'webp' ? 'webp' : 'jpg', type: m[1] === 'webp' ? 'image/webp' : 'image/jpeg' };
}
const imgKeys = (id, v) => ({ image: `sketch/img/${id}-${v}.webp`, thumb: `sketch/img/${id}-${v}-t.jpg` });
const cleanTitle = (t) => String(t || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_TITLE) || 'Untitled';

async function publish(handle, { id, title, image, thumb }) {
  if (!POST_ID.test(String(id || ''))) throw new Refused(400, 'Bad drawing id');
  const img = decodeImage(image, 'drawing');
  const th = decodeImage(thumb, 'thumbnail');
  if (img.ext !== 'webp' || th.ext !== 'jpg') throw new Refused(400, 'Expected a WebP drawing and a JPEG thumbnail');
  const key = `sketch/posts/${id}.json`;
  const old = await readJson(key);
  if (old && old.handle !== handle) throw new Refused(403, 'That drawing belongs to someone else');
  const now = Date.now();
  const v = old ? old.v + 1 : 1;
  const keys = imgKeys(id, v);
  await backend().write(keys.image, img.buf, img.type);
  await backend().write(keys.thumb, th.buf, th.type);
  const post = { id, handle, title: cleanTitle(title), created: old ? old.created : now, updated: now, v,
                 fire: old ? old.fire : 0, poop: old ? old.poop : 0, reporters: old ? old.reporters : [], hidden: old ? old.hidden : false };
  await writeJson(key, post);
  if (!old) await ownPosts(handle, (ids) => ids.concat(id));
  if (old) await backend().remove(Object.values(imgKeys(id, old.v))).catch(() => {});
  await writeFeedEntry(post);
  return summary(post);
}

/* Each account keeps the list of its own posts, so deleting the account finds
   the ones reports have taken OUT of the feed too. */
async function ownPosts(handle, change) {
  const key = `sketch/users/${handle}.json`;
  const user = await readJson(key);
  if (!user) return [];
  user.posts = change(Array.isArray(user.posts) ? user.posts : []);
  await writeJson(key, user);
  return user.posts;
}

async function removePost(id) {
  const post = await readJson(`sketch/posts/${id}.json`);
  if (!post) return false;
  // Its comments (lib/sketch-social.js) go with it.
  await backend().remove([`sketch/posts/${id}.json`, `sketch/votes/${id}.json`, `sketch/comments/${id}.json`, ...Object.values(imgKeys(id, post.v))]);
  await dropFeedEntry(id);
  await ownPosts(post.handle, (ids) => ids.filter((x) => x !== id));
  return true;
}

async function unpublish(handle, id) {
  if (!POST_ID.test(String(id || ''))) throw new Refused(400, 'Bad drawing id');
  const post = await readJson(`sketch/posts/${id}.json`);
  if (!post) return { removed: false };
  if (post.handle !== handle) throw new Refused(403, 'That drawing belongs to someone else');
  return { removed: await removePost(id) };
}

/* One reaction per person per drawing, switchable, and taken back by sending
   the same one again (or null). The counts are recomputed from the vote file
   every time, never incremented, so they cannot drift. */
async function vote(handle, id, kind) {
  if (!POST_ID.test(String(id || ''))) throw new Refused(400, 'Bad drawing id');
  if (kind !== null && kind !== 'fire' && kind !== 'poop') throw new Refused(400, 'A reaction is fire or poop');
  const post = await readJson(`sketch/posts/${id}.json`);
  if (!post || post.hidden) throw new Refused(404, 'That drawing is gone');
  const votes = (await readJson(`sketch/votes/${id}.json`)) || {};
  if (kind === null || votes[handle] === kind) delete votes[handle]; else votes[handle] = kind;
  await writeJson(`sketch/votes/${id}.json`, votes);
  const all = Object.values(votes);
  post.fire = all.filter((k) => k === 'fire').length;
  post.poop = all.filter((k) => k === 'poop').length;
  await writeJson(`sketch/posts/${id}.json`, post);
  await writeFeedEntry(post);
  return { fire: post.fire, poop: post.poop, mine: votes[handle] || null };
}

async function myVotes(handle, ids) {
  const out = {};
  for (const id of (Array.isArray(ids) ? ids : []).slice(0, 100)) {   // each is a read: a cap on what one request can cost
    if (!POST_ID.test(String(id))) continue;
    const votes = await readJson(`sketch/votes/${id}.json`);
    if (votes && votes[handle]) out[id] = votes[handle];
  }
  return out;
}

/* Three different people reporting a drawing takes it out of the feed until an
   admin looks. The store requires report-and-hide for anything users share. */
async function report(handle, id) {
  if (!POST_ID.test(String(id || ''))) throw new Refused(400, 'Bad drawing id');
  const post = await readJson(`sketch/posts/${id}.json`);
  if (!post) return { hidden: true };
  if (post.handle === handle) throw new Refused(400, 'That one is yours');
  if (!post.reporters.includes(handle)) post.reporters.push(handle);
  if (post.reporters.length >= HIDE_AT_REPORTS) post.hidden = true;
  await writeJson(`sketch/posts/${id}.json`, post);
  if (post.hidden) await dropFeedEntry(id); else await writeFeedEntry(post);
  return { hidden: post.hidden };
}

async function moderate(id, action) {
  const post = await readJson(`sketch/posts/${id}.json`);
  if (!post) throw new Refused(404, 'No such drawing');
  if (action === 'delete') { await removePost(id); return { deleted: true }; }
  post.hidden = action === 'hide';
  if (action === 'restore') post.reporters = [];
  await writeJson(`sketch/posts/${id}.json`, post);
  if (post.hidden) await dropFeedEntry(id); else await writeFeedEntry(post);
  return { hidden: post.hidden };
}

/* ---- an account's canvases ---------------------------------------------
   The whole gallery of a signed-in account, so it is the same on every
   device. One index per account (ONE read lists it), and the strokes and
   thumbnail under versioned keys. LAST WRITE WINS by the canvas's own `ts`
   (when it was last saved on whichever device): an older save arriving late
   is answered with what the server already has, not written. A deletion is
   a tombstone, so a device that was offline learns of it rather than
   uploading the canvas again; tombstones go after 90 days. */
const canvasIndexKey = (h) => `sketch/canvases/${h}/index.json`;
const canvasKeys = (h, id, v) => ({ png: `sketch/canvases/${h}/${id}-${v}.png`, thumb: `sketch/canvases/${h}/${id}-${v}-t.jpg` });
async function readCanvasIndex(handle) { return (await readJson(canvasIndexKey(handle))) || {}; }
function pruneTombstones(idx, now = Date.now()) {
  for (const [id, c] of Object.entries(idx)) if (c.deleted && now - c.ts > TOMBSTONE_MS) delete idx[id];
  return idx;
}
async function listCanvases(handle) { return Object.values(backup.live(await readCanvasIndex(handle))); }

function decodePng(dataUrl) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
  if (!m) throw new Refused(400, 'The canvas is not a PNG');
  const buf = Buffer.from(m[1], 'base64');
  if (!(buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG')) throw new Refused(400, 'The canvas bytes are not a PNG');
  if (buf.length > MAX_CANVAS) throw new Refused(413, 'That canvas is too large to keep on the account');
  return buf;
}
const num = (x, lo, hi) => { const n = Number(x); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; };

/* isNew is the caller's rate limit, spent only by a canvas the account has
   never had (a tombstone counts as had: restoring is not making). */
async function putCanvas(handle, { id, title, bg, created, ts, visibility, png, thumb }, isNew) {
  if (!POST_ID.test(String(id || ''))) throw new Refused(400, 'Bad canvas id');
  const when = Number(ts);
  if (!Number.isFinite(when) || when <= 0) throw new Refused(400, 'Bad canvas time');
  // A save stamped far in the future would make every real save after it "older".
  if (when > Date.now() + FUTURE_MS) throw new Refused(400, 'This device\'s clock is far ahead');
  const idx = await readCanvasIndex(handle);
  const old = idx[id];
  if (old && old.ts > when) return { canvas: old, stale: true };
  if (!old && Object.values(backup.live(idx)).filter((c) => !c.deleted).length >= MAX_CANVASES) throw new Refused(413, 'This account has too many canvases');
  if (!old && isNew) await isNew();
  const strokes = decodePng(png);
  const th = decodeImage(thumb, 'thumbnail');
  if (th.ext !== 'jpg') throw new Refused(400, 'Expected a JPEG thumbnail');
  const now = Date.now();
  await backup.beforeWrite(handle, idx, now);
  const v = backup.nextVersion(idx, id);
  const keys = canvasKeys(handle, id, v);
  await backend().write(keys.png, strokes, 'image/png');
  await backend().write(keys.thumb, th.buf, th.type);
  const b = bg || {};
  const entry = { id, title: cleanTitle(title), bg: { h: num(b.h, 0, 360), s: num(b.s, 0, 100), b: num(b.b, 0, 100) },
                  created: Number(created) > 0 ? Number(created) : when, ts: when,
                  visibility: visibility === 'public' ? 'public' : 'private', v, saved: now };
  // The version this replaces is RETIRED, not deleted (lib/sketch-backup.js).
  backup.retire(idx, old, now);
  idx[id] = entry;
  const drop = backup.tidy(handle, idx, now);
  await writeJson(canvasIndexKey(handle), pruneTombstones(idx));
  await backend().remove(drop).catch(() => {});
  return { canvas: entry };
}

async function deleteCanvas(handle, id, ts) {
  if (!POST_ID.test(String(id || ''))) throw new Refused(400, 'Bad canvas id');
  const idx = await readCanvasIndex(handle);
  const old = idx[id];
  const when = Math.max(Number(ts) || Date.now(), old ? old.ts : 0);
  const now = Date.now();
  await backup.beforeWrite(handle, idx, now);
  // Its last version stays for 30 days (lib/sketch-backup.js).
  backup.retire(idx, old, now, true);
  idx[id] = { id, deleted: true, ts: when };
  const drop = backup.tidy(handle, idx, now);
  await writeJson(canvasIndexKey(handle), pruneTombstones(idx));
  await backend().remove(drop).catch(() => {});
  return { deleted: true };
}

async function canvasImage(handle, id, v, thumb) {
  if (!POST_ID.test(String(id || '')) || !/^\d{1,6}$/.test(String(v))) return null;
  const keys = canvasKeys(handle, id, Number(v));
  const buf = await backend().read(thumb ? keys.thumb : keys.png);
  return buf && { buf, type: thumb ? 'image/jpeg' : 'image/png' };
}

/* The account's canvases leave it at once, but their bytes and backups go to
   the trash for 30 days (lib/sketch-backup.js) -- the snapshot is taken while
   the account's record still exists, so an undelete gets that back too. */
async function removeAllCanvases(handle) {
  const idx = await readCanvasIndex(handle);
  await backup.trashAccount(handle, idx, 'deleted', Date.now());
  await backend().remove([canvasIndexKey(handle)]);
}

/* Deleting an account takes every drawing it published with it -- an app
   store requirement, and the right thing anyway -- and its saved canvases. */
async function deleteAccount(handle, password) {
  const user = await readJson(`sketch/users/${handle}.json`);
  if (!user) throw new Refused(404, 'No such account');
  if (user.hash) await login(handle, password);
  const ids = new Set(Array.isArray(user && user.posts) ? user.posts : []);
  for (const id of ids) await removePost(id);
  await removeAllCanvases(handle);   // first: its snapshot keeps the record
  await clearAvatar(handle);
  await indexHandle(handle, false);
  const links = (Array.isArray(user.identities) ? user.identities : []).map((i) => `sketch/identities/${i}.json`);
  // The names it had before a rename were held for it; they are free again.
  const old = (Array.isArray(user.renamedFrom) ? user.renamedFrom : []).filter((h) => HANDLE.test(h)).map((h) => `sketch/users/${h}.json`);
  await backend().remove([`sketch/users/${handle}.json`, ...links, ...old]);
  return { deleted: true, posts: ids.size };
}


/* ---- profiles ----------------------------------------------------------------
   A profile is the handle, a picture, and the drawings it made public. The
   PICTURE is cut from one of the account's own canvases (Dex, 2026-10-08):
   the app renders a 256px square from that canvas and the crop it was given,
   and sends it again whenever that canvas changes, so the picture follows
   the drawing. The record keeps which canvas and which crop, so every device
   signed in to the account does the same. No picture means the app's
   default smiley; nobody is asked to draw one. */
const avatarKey = (h, v) => `sketch/avatars/${h}-${v}.jpg`;
async function readAvatars() { return (await readJson('sketch/avatars.json')) || {}; }
async function setAvatarVersion(handle, v) {
  const all = await readAvatars();
  if (v) all[handle] = v; else delete all[handle];
  await writeJson('sketch/avatars.json', all);
}
function cleanCrop(c) {
  const o = c || {};
  return { x: num(o.x, 0, 10000), y: num(o.y, 0, 10000), size: num(o.size, 1, 10000) };
}
async function setAvatar(handle, { image, canvas, crop }) {
  const img = decodeImage(image, 'thumbnail');
  if (img.ext !== 'jpg') throw new Refused(400, 'Expected a JPEG picture');
  if (img.buf.length > MAX_AVATAR) throw new Refused(413, 'The picture is too large');
  const key = `sketch/users/${handle}.json`;
  const user = await readJson(key);
  if (!user || user.movedTo) throw new Refused(401, 'Sign in again');
  const old = user.avatar && user.avatar.v;
  const v = (old || 0) + 1;
  await backend().write(avatarKey(handle, v), img.buf, img.type);
  user.avatar = { v, canvas: POST_ID.test(String(canvas || '')) ? String(canvas) : null, crop: cleanCrop(crop) };
  await writeJson(key, user);
  await setAvatarVersion(handle, v);
  if (old) await backend().remove([avatarKey(handle, old)]).catch(() => {});
  return { avatar: user.avatar };
}
async function clearAvatar(handle) {
  const key = `sketch/users/${handle}.json`;
  const user = await readJson(key);
  const old = user && user.avatar && user.avatar.v;
  if (user && user.avatar) { delete user.avatar; await writeJson(key, user); }
  if (old) await backend().remove([avatarKey(handle, old)]).catch(() => {});
  if (old || user) await setAvatarVersion(handle, 0);
  return { avatar: null };
}
/* What a signed-in device asks on launch: its name and its picture's source.
   It also puts the name in the search index, which is how accounts made
   before search existed find their way into it. */
async function me(handle) {
  const user = await readJson(`sketch/users/${handle}.json`);
  if (!user || user.movedTo) throw new Refused(401, 'Sign in again');
  await indexHandle(handle);
  return { handle, avatar: user.avatar || null };
}
/* Anyone's public face: name, picture, and the drawings in the feed. */
async function profile(handleIn) {
  const handle = normHandle(String(handleIn || '').replace(/^@/, ''));
  if (!HANDLE.test(handle)) throw new Refused(404, 'No such artist');
  const user = await readJson(`sketch/users/${handle}.json`);
  if (!user) throw new Refused(404, 'No such artist');
  if (user.movedTo) return { handle, movedTo: user.movedTo };
  const posts = (await readFeed()).filter((p) => p.handle === handle);
  return { handle, avatar: (user.avatar && user.avatar.v) || 0, posts };
}

/* ---- @-search ------------------------------------------------------------
   One sorted list of names, maintained on signup, claim, rename, delete and
   each signed-in launch. Names that contain the query, the ones that START
   with it first. */
async function indexHandle(handle, add = true) {
  const list = (await readJson('sketch/handles.json')) || [];
  const has = list.includes(handle);
  if (add === has) return;
  const next = add ? [...list, handle].sort() : list.filter((h) => h !== handle);
  await writeJson('sketch/handles.json', next);
}
async function searchUsers(q) {
  const want = normHandle(String(q || '').slice(0, 40).replace(/^@/, '')).replace(/[^a-z0-9_]/g, '').slice(0, 20);
  if (!want) return [];
  const list = (await readJson('sketch/handles.json')) || [];
  const hits = list.filter((h) => h.includes(want))
    .sort((a, b) => (b.startsWith(want) - a.startsWith(want)) || a.length - b.length || (a < b ? -1 : 1))
    .slice(0, 20);
  const pics = await readAvatars();
  return hits.map((h) => ({ handle: h, avatar: pics[h] || 0 }));
}

/* ---- renaming --------------------------------------------------------------
   A handle names everything the account owns -- its record, its sign-in
   links, its posts, its canvases' folder, its picture -- so a rename MOVES
   all of it and leaves a stub at the old name. The stub holds the old name
   (nobody else can take it and inherit the reactions it gave) and turns a
   password sign-in with it into "that name is now @new". Tokens minted for
   the old name stop working, so another signed-in phone signs in again.
   Reactions the account GAVE stay filed under the old name: there is no
   index of them, and the cost is only that they no longer light up as yours. */
async function rename(handle, nextIn) {
  const next = normHandle(String(nextIn || '').replace(/^@/, ''));
  if (next === handle) return { handle, token: mintToken(handle) };
  if (!HANDLE.test(next)) throw new Refused(400, 'Names are 3-20 letters, numbers or _');
  if (RESERVED.has(next) && !(OWNER_NAMES.has(handle) && OWNER_NAMES.has(next))) throw new Refused(409, 'That name is taken');
  if (await readJson(`sketch/users/${next}.json`)) throw new Refused(409, 'That name is taken');
  const user = await readJson(`sketch/users/${handle}.json`);
  if (!user || user.movedTo) throw new Refused(401, 'Sign in again');

  // The canvases' bytes first: until the record moves, the old name still owns them.
  const idx = await readCanvasIndex(handle);
  for (const c of Object.values(backup.live(idx))) {
    if (!c.v) continue;
    const from = canvasKeys(handle, c.id, c.v), to = canvasKeys(next, c.id, c.v);
    for (const k of ['png', 'thumb']) {
      const buf = await backend().read(from[k]);
      if (buf) await backend().write(to[k], buf, k === 'png' ? 'image/png' : 'image/jpeg');
    }
  }
  // The new name starts its own backup ledger; the old name's backups go to the
  // trash below, restorable onto the new name for 30 days (backup-restore from).
  const moving = backup.live(idx);
  if (Object.keys(moving).length) await writeJson(canvasIndexKey(next), moving);
  let avatar = user.avatar || null;
  if (avatar && avatar.v) {
    const buf = await backend().read(avatarKey(handle, avatar.v));
    if (buf) await backend().write(avatarKey(next, avatar.v), buf, 'image/jpeg');
    else avatar = null;
  }

  const moved = { ...user, handle: next, renamedFrom: [...(Array.isArray(user.renamedFrom) ? user.renamedFrom : []), handle] };
  if (avatar) moved.avatar = avatar; else delete moved.avatar;
  await writeJson(`sketch/users/${next}.json`, moved);
  for (const i of Array.isArray(user.identities) ? user.identities : []) {
    await writeJson(`sketch/identities/${i}.json`, { handle: next, linked: Date.now() });
  }
  const ids = new Set(Array.isArray(user.posts) ? user.posts : []);
  for (const id of ids) {
    const post = await readJson(`sketch/posts/${id}.json`);
    if (post && post.handle === handle) { post.handle = next; await writeJson(`sketch/posts/${id}.json`, post); }
  }
  const feed = await readFeed();
  if (feed.some((p) => p.handle === handle)) await writeJson('sketch/feed.json', feed.map((p) => (p.handle === handle ? { ...p, handle: next } : p)));
  const pics = await readAvatars();
  delete pics[handle];
  if (avatar) pics[next] = avatar.v;
  await writeJson('sketch/avatars.json', pics);
  const list = ((await readJson('sketch/handles.json')) || []).filter((h) => h !== handle);
  await writeJson('sketch/handles.json', [...list, next].sort());

  // Only now is the old name a stub. Its canvases' bytes stay in the trash
  // for 30 days with a last snapshot of the account before the move.
  if (Object.keys(idx).length) await backup.trashAccount(handle, idx, 'renamed', Date.now(), { to: next });
  await writeJson(`sketch/users/${handle}.json`, { handle, movedTo: next, at: Date.now() });
  const gone = [canvasIndexKey(handle)];
  if (avatar) gone.push(avatarKey(handle, avatar.v));
  await backend().remove(gone).catch(() => {});
  return { handle: next, token: mintToken(next), avatar };
}
/* A token names a handle; the handle has to still be an account. A rename
   or a deletion is how one stops being. */
async function liveHandle(handle) {
  const user = handle && await readJson(`sketch/users/${handle}.json`);
  return user && !user.movedTo ? handle : null;
}

/* ---- Google and Discord ----------------------------------------------------
   A provider account is an IDENTITY linked to a handle:
     sketch/identities/<provider>-<id>.json  -> { handle }
   and the user record lists its identities (so deleting the account removes
   the links). A first sign-in has no handle yet, so the callback hands the
   app a short-lived signed TICKET, and the app asks for a name and CLAIMS it.

   The three names reserved for Dex are claimable only by his verified Google
   address -- nobody else can be @dex, and he does not need a password. */
const OWNER_EMAIL = 'dexdcimino@gmail.com';
const OWNER_NAMES = new Set(['dex', 'dexdc', 'dexcimino']);
const TICKET_TTL = 15 * 60 * 1000;
// firebase-<uid> is the SITE account (lib/site-identity.js); google- and
// discord- are the links Inko made on its own before there was one.
const PROVIDER_ID = /^(google|discord|firebase)-[0-9A-Za-z_.-]{1,128}$/;

function mintTicket(identity, now = Date.now()) {
  const payload = b64u(JSON.stringify({ ...identity, exp: now + TICKET_TTL, t: 'claim' }));
  return payload + '.' + b64u(crypto.createHmac('sha256', secret()).update('ticket|' + payload).digest());
}
function readTicket(ticket, now = Date.now()) {
  if (typeof ticket !== 'string' || !ticket.includes('.')) return null;
  const [payload, mac] = ticket.split('.', 2);
  const want = Buffer.from(b64u(crypto.createHmac('sha256', secret()).update('ticket|' + payload).digest()));
  const got = Buffer.from(mac || '');
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  if (!data || data.t !== 'claim' || !(now < data.exp) || !PROVIDER_ID.test(`${data.provider}-${data.pid}`)) return null;
  if (data.also !== undefined && !(Array.isArray(data.also) && data.also.every((i) => PROVIDER_ID.test(i)))) return null;
  return data;
}

/* After the provider vouched for someone: the handle linked to them, or a
   ticket to choose one. */
async function identify(identity) {
  const key = `sketch/identities/${identity.provider}-${identity.pid}.json`;
  if (!PROVIDER_ID.test(`${identity.provider}-${identity.pid}`)) throw new Refused(400, 'Bad identity');
  const link = await readJson(key);
  if (link && link.handle && (await readJson(`sketch/users/${link.handle}.json`))) {
    return { handle: link.handle, token: mintToken(link.handle) };
  }
  return { ticket: mintTicket(identity) };
}

/* The site account (one Firebase uid for the whole site) signing in to Inko.
   Every live Inko account this person can reach is found: the one linked to
   the provider they signed in with THIS time (so Google and Discord keep
   their own canvases, as they did before the site account), the uid's own
   link, then the rest of their Google and Discord links -- so an Inko account
   made through Inko's own sign-in before the site account existed is FOUND,
   not duplicated, and from then on is linked to the uid as well.

   An account with nothing in it never wins over one with drawings. That was
   the 2026-10-08 loss: the uid's link had landed on an empty account, it was
   looked at first, and every sign-in -- Google and Discord alike -- opened the
   empty one while the drawings sat untouched under the old name. The others
   come back too (`others`, each with its token), so the app can switch to any
   of them. Nothing is moved: every handle, its canvases and its posts stay
   exactly where they are. */
async function liveLinked(idKey) {
  const link = await readJson(`sketch/identities/${idKey}.json`);
  const user = link && link.handle && await readJson(`sketch/users/${link.handle}.json`);
  return user && !user.movedTo ? user : null;
}
async function hasDrawings(user) {
  if (Array.isArray(user.posts) && user.posts.length) return true;
  return Object.values(await readCanvasIndex(user.handle)).some((c) => !c.deleted);
}
const VIA = { 'google.com': 'google-', 'oidc.discord': 'discord-' };
async function identifySite(who) {
  const own = `firebase-${who.uid}`;
  const linked = (who.linked || []).filter((i) => PROVIDER_ID.test(i));
  if (!PROVIDER_ID.test(own)) throw new Refused(400, 'Bad identity');
  const via = VIA[who.provider];
  const order = [...linked.filter((i) => via && i.startsWith(via)), own, ...linked];
  const found = [];
  for (const idKey of order) {
    const user = await liveLinked(idKey);
    if (user && !found.some((u) => u.handle === user.handle)) found.push(user);
  }
  if (!found.length) {
    return { ticket: mintTicket({ provider: 'firebase', pid: who.uid, email: who.email, verified: who.verified, also: linked }) };
  }
  let pick = found[0];
  if (!(await hasDrawings(pick))) {
    for (const u of found.slice(1)) if (await hasDrawings(u)) { pick = u; break; }
  }
  await linkIdentities(pick, [own, ...linked]);
  const others = found.filter((u) => u.handle !== pick.handle).map((u) => ({ handle: u.handle, token: mintToken(u.handle) }));
  return { handle: pick.handle, token: mintToken(pick.handle), others };
}

/* Point each id at this account and list it on the record, so a rename moves
   it and a deletion removes it. An id already linked to ANOTHER live account
   is left alone: one person's two old Inko accounts are not merged. */
async function linkIdentities(user, ids) {
  const have = new Set(Array.isArray(user.identities) ? user.identities : []);
  const add = [];
  for (const idKey of ids) {
    if (have.has(idKey)) continue;
    const link = await readJson(`sketch/identities/${idKey}.json`);
    if (link && link.handle && link.handle !== user.handle && await liveHandle(link.handle)) continue;
    await writeJson(`sketch/identities/${idKey}.json`, { handle: user.handle, linked: Date.now() });
    add.push(idKey);
  }
  if (add.length) {
    const fresh = (await readJson(`sketch/users/${user.handle}.json`)) || user;
    await writeJson(`sketch/users/${user.handle}.json`, { ...fresh, identities: [...new Set([...(fresh.identities || []), ...add])] });
  }
}

async function claim(ticket, handleIn) {
  const who = readTicket(ticket);
  if (!who) throw new Refused(401, 'That sign-in expired. Start again.');
  const handle = normHandle(handleIn);
  if (!HANDLE.test(handle)) throw new Refused(400, 'Names are 3-20 letters, numbers or _');
  // The site account vouches for the address the same way Google does: it is
  // only marked verified when the provider said so.
  const owner = (who.provider === 'google' || who.provider === 'firebase') && who.verified && String(who.email || '').toLowerCase() === OWNER_EMAIL;
  if (RESERVED.has(handle) && !(owner && OWNER_NAMES.has(handle))) throw new Refused(409, 'That name is taken');
  if (await readJson(`sketch/users/${handle}.json`)) throw new Refused(409, 'That name is taken');
  const idKey = `${who.provider}-${who.pid}`;
  // The same person cannot claim twice from one ticket: the link is the lock.
  const existing = await readJson(`sketch/identities/${idKey}.json`);
  // An account that already exists is never fresh (see signup).
  if (existing && existing.handle) return { handle: existing.handle, token: mintToken(existing.handle) };
  await writeJson(`sketch/users/${handle}.json`, { handle, created: Date.now(), identities: [idKey], posts: [], fails: 0, lockUntil: 0 });
  await writeJson(`sketch/identities/${idKey}.json`, { handle, linked: Date.now() });
  if (who.also && who.also.length) await linkIdentities({ handle, identities: [idKey] }, who.also);
  await indexHandle(handle);
  return { handle, token: mintToken(handle), fresh: true };
}

/* The state parameter of an OAuth round trip, signed, so a callback can only
   complete a sign-in this server started. */
function mintState(provider, nonce, now = Date.now()) {
  const payload = b64u(JSON.stringify({ p: provider, n: nonce, exp: now + 10 * 60 * 1000 }));
  return payload + '.' + b64u(crypto.createHmac('sha256', secret()).update('state|' + payload).digest());
}
function readState(state, now = Date.now()) {
  if (typeof state !== 'string' || !state.includes('.')) return null;
  const [payload, mac] = state.split('.', 2);
  const want = Buffer.from(b64u(crypto.createHmac('sha256', secret()).update('state|' + payload).digest()));
  const got = Buffer.from(mac || '');
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try { const d = JSON.parse(Buffer.from(payload, 'base64url').toString()); return now < d.exp ? d : null; } catch { return null; }
}

async function image(key) {
  if (!IMG_KEY.test(String(key || '')) && !AVATAR_KEY.test(String(key || ''))) return null;
  const buf = await backend().read(key);
  return buf && { buf, type: key.endsWith('.webp') ? 'image/webp' : 'image/jpeg' };
}

module.exports = {
  Refused, configError, secret, signup, login, readToken, isAdmin, readFeed, publish, unpublish,
  vote, myVotes, report, moderate, deleteAccount, image, mintToken,
  listCanvases, putCanvas, deleteCanvas, canvasImage,
  setAvatar, clearAvatar, me, profile, searchUsers, rename, liveHandle, readAvatars, AVATAR_KEY,
  identify, identifySite, claim, mintTicket, readTicket, mintState, readState, OWNER_NAMES,
  HANDLE, POST_ID, IMG_KEY, HIDE_AT_REPORTS, MAX_FEED, indexHandle,
  // lib/sketch-social.js (follows, comments) keeps its files in the same store.
  io: { readJson, writeJson, backend },
};
