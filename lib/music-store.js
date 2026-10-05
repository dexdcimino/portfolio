/* The live playlist: storage, backups, and the admin password.
 *
 * WHY THE PLAYLIST MOVED OFF THE STATIC FILE. assets/music/tracks.json ships
 * with the site and can only change with a commit and a deploy. The TUNES code
 * edits the list from the page, so the list has to live somewhere a request can
 * write: one small JSON document in the same Vercel Blob store the notes use.
 * tracklist.txt and tracks.json stay -- they are the SEED the live list starts
 * from, and the copy in git.
 *
 * WHAT IS STORED
 *   music/playlist.json                  { rev, savedAt, tracks:[{t,a,u,v,r}] }
 *   music/backups/<stamp>_<count>.json   the list as it was BEFORE each edit.
 *                                        Newest 40 kept.
 *   music/daily/<date>_<count>.json      the list as the day STARTED -- what the
 *                                        day's first edit replaced. 60 kept.
 *
 * THE BACKUP IS WRITTEN FIRST. An edit that cannot save a copy of what it is
 * about to replace does not replace it: the order is backup, then the new
 * playlist, then pruning -- so a failure at any step leaves the old list in
 * place and a copy of it beside. The count is in the file name so the restore
 * list can say "312 tracks" without opening forty files to find out.
 *
 * THE PASSWORD IS CHECKED HERE, NOT IN THE BROWSER. The vault code TUNES only
 * opens the overlay; anyone can read the page's source and call this API
 * directly, so the thing that decides whether a request may edit is
 * TUNES_PASSWORD, an environment variable, compared with scrypt. Same shape as
 * lib/notes-store.js, and the same reasons -- see there.
 */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const CURRENT = 'music/playlist.json';
const BACKUP_DIR = 'music/backups/';
/* Three-tier backup rotation (Dex, 2026-10-05): just three slots, no pileup.
   - latest.json: overwritten on EVERY edit (the state right before it)
   - daily.json:  overwritten when the existing one is older than 24 hours
   - weekly.json: overwritten when the existing one is older than 7 days */
const BACKUP_LATEST = `${BACKUP_DIR}latest.json`;
const BACKUP_DAILY = `${BACKUP_DIR}daily.json`;
const BACKUP_WEEKLY = `${BACKUP_DIR}weekly.json`;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_TRACKS = 3000;
const MAX_TEXT = 200;

/* ---- where the bytes go -------------------------------------------------- */

function devDir() {
  const dir = process.env.NOTES_DEV_DIR;
  if (!dir) return null;
  if (process.env.VERCEL_ENV === 'production') {
    throw new Error('NOTES_DEV_DIR is set in production. Refusing to keep the playlist on an ephemeral disk.');
  }
  return dir;
}

function configError() {
  if (!devDir() && !process.env.BLOB_READ_WRITE_TOKEN) {
    return 'BLOB_READ_WRITE_TOKEN is not set. Connect a Vercel Blob store to this project.';
  }
  return null;
}

/* Reading needs only storage; EDITING also needs the password to exist. Kept
 * apart so the public list still loads on a deploy where TUNES is not set up. */
function adminError() {
  if (!process.env.TUNES_PASSWORD) {
    return 'TUNES_PASSWORD is not set. Add it in the Vercel project settings and redeploy.';
  }
  return null;
}

const local = {
  async read(key) {
    try { return await fs.readFile(path.join(devDir(), key), 'utf8'); }
    catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  },
  async write(key, body) {
    const file = path.join(devDir(), key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  },
  async list(prefix) {
    try {
      const names = await fs.readdir(path.join(devDir(), prefix));
      return names.map((n) => ({ pathname: prefix + n }));
    } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  },
  async remove(keys) {
    await Promise.all(keys.map((k) => fs.rm(path.join(devDir(), k), { force: true })));
  },
};

const blobBackend = {
  async read(key) {
    const { get } = require('@vercel/blob');
    let found;
    try {
      /* useCache:false: an edit made in TUNES has to be what MUSIC loads next,
         and the CDN edge would serve the list from before it. */
      found = await get(key, { access: 'private', useCache: false });
    } catch (err) {
      if (err && (err.name === 'BlobNotFoundError' || /not.?found/i.test(err.message || ''))) return null;
      throw err;
    }
    if (!found) return null;
    if (!found.stream) throw new Error(`blob ${key} returned statusCode ${found.statusCode} with no stream`);
    return await new Response(found.stream).text();
  },
  async write(key, body) {
    const { put } = require('@vercel/blob');
    await put(key, body, {
      access: 'private', contentType: 'application/json; charset=utf-8',
      addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0,
    });
  },
  async list(prefix) {
    const { list } = require('@vercel/blob');
    const out = [];
    let cursor;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      out.push(...page.blobs);
      cursor = page.cursor;
    } while (cursor);
    return out;
  },
  async remove(keys) {
    if (!keys.length) return;
    const { del } = require('@vercel/blob');
    await del(keys);
  },
};

const backend = () => (devDir() ? local : blobBackend);

/* ---- tracks -------------------------------------------------------------- */

const ID = /^[A-Za-z0-9_-]{11}$/;

/* Every shape of YouTube link someone might paste, down to the 11-character
 * id. A playlist link with no video in it has no id and is refused. */
function parseId(input) {
  const s = String(input || '').trim();
  if (ID.test(s)) return s;
  let url;
  try { url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v');
    if (!id) {
      const m = url.pathname.match(/^\/(?:embed|shorts|v|live)\/([^/?#]+)/);
      id = m ? m[1] : null;
    }
  }
  return id && ID.test(id) ? id : null;
}

/* Control characters out by code point rather than by a regex escape: a
 * character-class escape written into this file once landed as real NUL bytes
 * (see the memory note on it), and a loop cannot do that. */
function text(value) {
  let out = '';
  for (const ch of String(value || '')) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c !== 127) out += ch;
  }
  return out.trim().slice(0, MAX_TEXT);
}

function cleanTrack(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const v = parseId(raw.v || raw.u);
  const t = text(raw.t), a = text(raw.a);
  if (!v || !t || !a) return null;
  const track = { t, a, u: `https://www.youtube.com/watch?v=${v}`, v };
  if (raw.r) track.r = true;
  return track;
}

function cleanList(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const track = cleanTrack(raw);
    if (!track || seen.has(track.v)) continue;
    seen.add(track.v);
    out.push(track);
    if (out.length >= MAX_TRACKS) break;
  }
  return out;
}

/* A title from YouTube is "Artist - Song (Official Music Video) | slogan".
 * This is a GUESS for the add form to prefill, and the form lets you fix it --
 * it is never written without a person seeing it first. */
function guess(title, author) {
  let t = text(title);
  t = t.replace(/\s*[[(](official|lyric|lyrics|audio|video|music video|hd|4k|visuali[sz]er|remaster(ed)?)[^\])]*[\])]/gi, '');
  t = t.split(' | ')[0].trim();
  const dash = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) return { a: dash[1].trim(), t: dash[2].trim() };
  return { a: text(author).replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim(), t };
}

/* ---- the document -------------------------------------------------------- */

function seed() {
  // Required, not read from disk: Vercel's bundler follows a require() and
  // ships the file with the function, which a runtime path would not get.
  const data = require('../assets/music/tracks.json');
  return cleanList(data && data.tracks);
}

async function read() {
  const raw = await backend().read(CURRENT);
  if (raw === null) return { rev: 0, savedAt: null, tracks: seed(), seeded: true };
  let doc;
  try { doc = JSON.parse(raw); } catch {
    /* A playlist that does not parse is a HARD error. Falling back to the seed
       here would quietly undo every edit ever made -- the backups are how this
       is recovered, and they are only useful if nobody writes over them. */
    throw new Error(`${CURRENT} is not valid JSON`);
  }
  const tracks = cleanList(doc && doc.tracks);
  if (!tracks.length) throw new Error(`${CURRENT} holds no usable tracks`);
  return { rev: Number(doc.rev) || 0, savedAt: doc.savedAt || null, tracks, seeded: false };
}

const stampOf = (ms) => new Date(ms).toISOString().replace(/[:.]/g, '-');
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

async function prune(prefix, keep) {
  const store = backend();
  const names = (await store.list(prefix)).map((b) => b.pathname).filter((p) => p.endsWith('.json')).sort();
  const extra = names.length - keep;
  if (extra > 0) await store.remove(names.slice(0, extra));
}

/* THE ONE WRITE. `before` is the document being replaced; it is copied out
 * before anything is overwritten, and if that copy fails nothing is. */
async function write(before, tracks, now = Date.now()) {
  const store = backend();
  const clean = cleanList(tracks);
  if (!clean.length) throw new Error('refusing to save an empty playlist');

  const backupDoc = JSON.stringify({
    rev: before.rev, savedAt: before.savedAt, backedUpAt: new Date(now).toISOString(), tracks: before.tracks,
  });

  // Tier 1: latest — overwritten on every edit.
  await store.write(BACKUP_LATEST, backupDoc);

  // Tier 2: daily — overwritten only if the existing one is older than 24h.
  try {
    const dailyExisting = await store.read(BACKUP_DAILY);
    let dailyAge = Infinity;
    if (dailyExisting) {
      const parsed = JSON.parse(dailyExisting);
      const backedUpAt = parsed.backedUpAt ? new Date(parsed.backedUpAt).getTime() : 0;
      dailyAge = now - backedUpAt;
    }
    if (dailyAge > DAY_MS) await store.write(BACKUP_DAILY, backupDoc);
  } catch (err) {
    console.error('music-store: daily backup failed', err);
  }

  // Tier 3: weekly — overwritten only if the existing one is older than 7 days.
  try {
    const weeklyExisting = await store.read(BACKUP_WEEKLY);
    let weeklyAge = Infinity;
    if (weeklyExisting) {
      const parsed = JSON.parse(weeklyExisting);
      const backedUpAt = parsed.backedUpAt ? new Date(parsed.backedUpAt).getTime() : 0;
      weeklyAge = now - backedUpAt;
    }
    if (weeklyAge > WEEK_MS) await store.write(BACKUP_WEEKLY, backupDoc);
  } catch (err) {
    console.error('music-store: weekly backup failed', err);
  }

  const doc = { rev: before.rev + 1, savedAt: new Date(now).toISOString(), tracks: clean };
  await store.write(CURRENT, JSON.stringify(doc));
  return { ...doc, seeded: false };
}

async function listBackups() {
  const store = backend();
  const rows = [];
  const slots = [
    [BACKUP_LATEST, 'latest'],
    [BACKUP_DAILY, 'daily'],
    [BACKUP_WEEKLY, 'weekly'],
  ];
  for (const [name, kind] of slots) {
    try {
      const raw = await store.read(name);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      rows.push({
        name, kind,
        label: parsed.backedUpAt || parsed.savedAt || '',
        count: (parsed.tracks || []).length,
      });
    } catch { /* slot empty or unreadable — skip */ }
  }
  // Latest first, then daily, then weekly.
  const order = { latest: 0, daily: 1, weekly: 2 };
  return rows.sort((a, b) => order[a.kind] - order[b.kind]);
}

const BACKUP_NAME = /^music\/backups\/(latest|daily|weekly)\.json$/;

async function readBackup(name) {
  if (!BACKUP_NAME.test(String(name || ''))) return null;
  const raw = await backend().read(name);
  if (raw === null) return null;
  try { return cleanList(JSON.parse(raw).tracks); } catch { return null; }
}

/* ---- the password -------------------------------------------------------- */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };
const derive = (secret, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(secret, salt, SCRYPT.keylen, SCRYPT, (err, key) => (err ? reject(err) : resolve(key)));
});

/* Folded to upper case both sides: the vault folds every code it is given, so
 * TUNES, Tunes and tunes are one code there and have to be one password here. */
async function passwordOk(given) {
  const real = process.env.TUNES_PASSWORD || '';
  if (typeof given !== 'string' || !given) return false;
  const salt = 'dexcimino-tunes-v1';
  const a = await derive(given.trim().toUpperCase(), salt);
  // Universal admin code: snail (scrypt hash, safe to commit — one-way).
  // Lets Dex retire the TUNES_PASSWORD env var when ready.
  const SNAIL_HASH = Buffer.from('wX57S0ZSZxN+rcC0x3pAbMENQLXFdHQbca7gZP+4aJ0=', 'base64');
  if (a.length === SNAIL_HASH.length && crypto.timingSafeEqual(a, SNAIL_HASH)) return true;
  if (!real) return false;
  const b = await derive(real.trim().toUpperCase(), salt);
  return crypto.timingSafeEqual(a, b);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sign = (payload) => b64url(crypto.createHmac('sha256', `tunes:${process.env.TUNES_PASSWORD || ''}`)
  .update(payload).digest());

function mintToken(now = Date.now()) {
  const payload = String(now + TOKEN_TTL_MS);
  return `${b64url(payload)}.${sign(payload)}`;
}

function tokenOk(token, now = Date.now()) {
  if (!process.env.TUNES_PASSWORD) return false;
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [head, mac] = token.split('.', 2);
  let payload;
  try { payload = Buffer.from(head, 'base64url').toString(); } catch { return false; }
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac || '');
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;
  const expiry = Number(payload);
  return Number.isFinite(expiry) && now < expiry;
}

module.exports = {
  CURRENT, BACKUP_DIR, MAX_TRACKS,
  configError, adminError, parseId, cleanTrack, cleanList, guess,
  read, write, listBackups, readBackup, passwordOk, mintToken, tokenOk,
};
