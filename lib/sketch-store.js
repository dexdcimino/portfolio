/* The shared sketch gallery: accounts, published drawings, reactions, reports.
 *
 * NAMED "sketch", NOT AFTER THE APP. The app is being renamed (2026-10-07), and
 * an API path or a storage prefix is the one name that cannot change once real
 * data sits under it. The UI can rename freely; these keys stay.
 *
 * WHAT IS ON THE SERVER, AND WHAT IS NOT. A drawing is PRIVATE by default and
 * private means it never leaves the device -- it lives in the app's IndexedDB
 * and nowhere else. Making one PUBLIC uploads a flattened snapshot (a WebP and
 * a JPEG thumbnail) and lists it in the feed; making it private again deletes
 * both from here. So "private" is a promise the server cannot break, because
 * the server never had it.
 *
 * Layout, in the site's existing private Blob store (or NOTES_DEV_DIR locally):
 *   sketch/users/<handle>.json   { handle, salt, hash, created, fails, lockUntil }
 *   sketch/posts/<id>.json       { id, handle, title, created, updated, v, fire, poop, reporters[], hidden }
 *   sketch/votes/<id>.json       { <handle>: 'fire' | 'poop' }
 *   sketch/img/<id>-<v>.webp     the drawing; sketch/img/<id>-<v>-t.jpg its thumbnail
 *   sketch/feed.json             [summary, ...] newest first: ONE read per feed view
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
const path = require('node:path');

const HANDLE = /^[a-z0-9_]{3,20}$/;
const RESERVED = new Set(['admin', 'administrator', 'mod', 'moderator', 'support', 'staff', 'system', 'dex', 'dexdc', 'dexcimino', 'sketch', 'inko', 'official', 'root']);
const POST_ID = /^[a-z0-9]{3,40}$/;
const IMG_KEY = /^sketch\/img\/[a-z0-9]{3,40}-\d{1,6}(-t)?\.(webp|jpg)$/;
const MAX_IMAGE = 1_500_000, MAX_THUMB = 250_000, MAX_FEED = 500, MAX_TITLE = 40;
const HIDE_AT_REPORTS = 3;
const TOKEN_TTL = 90 * 24 * 60 * 60 * 1000;     // a phone stays signed in for three months
const FAIL_LIMIT = 10, LOCK_MS = 15 * 60 * 1000;

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
  if (await readJson(`sketch/users/${handle}.json`)) throw new Refused(409, 'That name is taken');
  const salt = b64u(crypto.randomBytes(16));
  const hash = b64u(await scrypt(password, salt));
  await writeJson(`sketch/users/${handle}.json`, { handle, salt, hash, created: Date.now(), fails: 0, lockUntil: 0 });
  return { handle, token: mintToken(handle) };
}

async function login(handleIn, password) {
  const handle = normHandle(handleIn);
  const user = HANDLE.test(handle) ? await readJson(`sketch/users/${handle}.json`) : null;
  if (!user) throw new Refused(401, 'Wrong name or password');
  if (!user.hash) throw new Refused(401, 'This account signs in with Google or Discord');
  if (user.lockUntil > Date.now()) throw new Refused(429, 'Too many tries. Wait 15 minutes.');
  const ok = typeof password === 'string' &&
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
  await backend().remove([`sketch/posts/${id}.json`, `sketch/votes/${id}.json`, ...Object.values(imgKeys(id, post.v))]);
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
  for (const id of (Array.isArray(ids) ? ids : []).slice(0, 200)) {
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

/* Deleting an account takes every drawing it published with it -- an app
   store requirement, and the right thing anyway. */
async function deleteAccount(handle, password) {
  const user = await readJson(`sketch/users/${handle}.json`);
  if (!user) throw new Refused(404, 'No such account');
  if (user.hash) await login(handle, password);
  const ids = new Set(Array.isArray(user && user.posts) ? user.posts : []);
  for (const id of ids) await removePost(id);
  const links = (Array.isArray(user.identities) ? user.identities : []).map((i) => `sketch/identities/${i}.json`);
  await backend().remove([`sketch/users/${handle}.json`, ...links]);
  return { deleted: true, posts: ids.size };
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
const PROVIDER_ID = /^(google|discord)-[0-9A-Za-z_.-]{1,64}$/;

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
  return data && data.t === 'claim' && now < data.exp && PROVIDER_ID.test(`${data.provider}-${data.pid}`) ? data : null;
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

async function claim(ticket, handleIn) {
  const who = readTicket(ticket);
  if (!who) throw new Refused(401, 'That sign-in expired. Start again.');
  const handle = normHandle(handleIn);
  if (!HANDLE.test(handle)) throw new Refused(400, 'Names are 3-20 letters, numbers or _');
  const owner = who.provider === 'google' && who.verified && String(who.email || '').toLowerCase() === OWNER_EMAIL;
  if (RESERVED.has(handle) && !(owner && OWNER_NAMES.has(handle))) throw new Refused(409, 'That name is taken');
  if (await readJson(`sketch/users/${handle}.json`)) throw new Refused(409, 'That name is taken');
  const idKey = `${who.provider}-${who.pid}`;
  // The same person cannot claim twice from one ticket: the link is the lock.
  const existing = await readJson(`sketch/identities/${idKey}.json`);
  if (existing && existing.handle) return { handle: existing.handle, token: mintToken(existing.handle) };
  await writeJson(`sketch/users/${handle}.json`, { handle, created: Date.now(), identities: [idKey], posts: [], fails: 0, lockUntil: 0 });
  await writeJson(`sketch/identities/${idKey}.json`, { handle, linked: Date.now() });
  return { handle, token: mintToken(handle) };
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
  if (!IMG_KEY.test(String(key || ''))) return null;
  const buf = await backend().read(key);
  return buf && { buf, type: key.endsWith('.webp') ? 'image/webp' : 'image/jpeg' };
}

module.exports = {
  Refused, configError, signup, login, readToken, isAdmin, readFeed, publish, unpublish,
  vote, myVotes, report, moderate, deleteAccount, image, mintToken,
  identify, claim, mintTicket, readTicket, mintState, readState, OWNER_NAMES,
  HANDLE, POST_ID, IMG_KEY, HIDE_AT_REPORTS, MAX_FEED,
};
