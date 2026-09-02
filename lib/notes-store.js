/* Storage and auth for the live notes overlay.
 *
 * Everything the two API routes share lives here: where the document is kept,
 * how the password is checked, and how a session token is minted and verified.
 * It sits in lib/ rather than under api/ because Vercel turns every file under
 * api/ into a route, and a shared module is not a route.
 *
 * WHY THE PASSWORD IS CHECKED HERE AND NOT IN THE BROWSER
 * The Idea Vault on the same page ships ciphertext and decrypts it client-side,
 * which is the right shape for THAT: what is sealed is genuinely not in the
 * document, so there is no branch to flip. It is still a lock you can attack
 * offline forever, because the blob is public. These notes are different --
 * they are working notes that get edited every day, and re-sealing them on
 * every keystroke is not a thing. So the content never leaves the server until
 * a password has been checked, and the check is here.
 *
 * WHAT IS STORED, AND WHERE
 *   notes/current.html            the live document
 *   notes/backups/<iso>.html      one per save, newest BACKUP_KEEP retained
 *
 * Both are PRIVATE blobs. A public blob has a URL, and a URL is one guess away
 * from being the leak this feature exists to prevent -- the pathname is fixed
 * and the store id is not really a secret.
 */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const CURRENT = 'notes/current.html';
const BACKUP_DIR = 'notes/backups/';

// How many timestamped copies survive a save. Twenty is enough to walk back
// through a bad afternoon and small enough that pruning stays one list call.
const BACKUP_KEEP = 20;

// A session lasts a working day and every save renews it, so a tab left open
// while Dex actually works does not drop him back to the keypad mid-sentence.
// It is still a bearer token: it expires on its own, and it is only ever as
// good as the password that minted it.
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

// The notes are one HTML document, not an upload endpoint. A megabyte is
// roughly seventy times the seed, so it will not be hit by writing, and it
// stops a broken client from streaming something enormous into the store.
const MAX_BYTES = 1024 * 1024;

/* ---- configuration ------------------------------------------------------ */

/* The local backend exists so the real handlers can be driven end to end on
 * this machine, with no Vercel account and no network. It is a genuine hazard:
 * on Vercel the filesystem is ephemeral, so a deploy that quietly fell back to
 * it would accept every save, report success, and lose the lot on the next cold
 * start -- a false green of exactly the kind that is worth refusing outright.
 * So it is never a fallback. It turns on only when NOTES_DEV_DIR is set, and
 * never in production however it is set.
 */
function devDir() {
  const dir = process.env.NOTES_DEV_DIR;
  if (!dir) return null;
  if (process.env.VERCEL_ENV === 'production') {
    throw new Error(
      'NOTES_DEV_DIR is set in production. That backend writes to an ephemeral ' +
      'filesystem and would lose every note on the next cold start. Refusing.');
  }
  return dir;
}

function configError() {
  if (!process.env.NOTES_PASSWORD) {
    return 'NOTES_PASSWORD is not set. Add it in the Vercel project settings.';
  }
  if (!devDir() && !process.env.BLOB_READ_WRITE_TOKEN) {
    return 'BLOB_READ_WRITE_TOKEN is not set. Connect a Vercel Blob store to ' +
           'this project (Storage tab), which injects it automatically.';
  }
  return null;
}

/* ---- the password ------------------------------------------------------- */

/* scrypt, not a plain comparison, and not because the password is hashed at
 * rest -- it is not, it is an environment variable either way. It is because
 * this route is reachable by anyone and a plain compare costs the attacker
 * nothing. At ~100ms a guess, an online sweep of anything longer than a few
 * characters stops being worth starting. timingSafeEqual on the derived bytes
 * closes the side channel that made the length and prefix readable.
 */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

function derive(secret, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(secret, salt, SCRYPT.keylen, SCRYPT, (err, key) =>
      err ? reject(err) : resolve(key));
  });
}

async function passwordOk(given) {
  const real = process.env.NOTES_PASSWORD || '';
  if (typeof given !== 'string' || !real) return false;
  // A fixed salt: there is one password and it is not stored, so a salt buys
  // nothing here except making the two derivations comparable.
  const salt = 'dexcimino-notes-v1';
  const [a, b] = await Promise.all([derive(given, salt), derive(real, salt)]);
  return crypto.timingSafeEqual(a, b);
}

/* ---- session tokens ----------------------------------------------------- */

/* Stateless: expiry plus an HMAC of it, keyed by the password. Nothing to store
 * and nothing to expire on a schedule, which matters when every request may hit
 * a different instance that shares no memory with the last one.
 *
 * Keying on the password means changing NOTES_PASSWORD invalidates every token
 * that was minted under the old one -- which is what changing a password should
 * do, and would not happen with a separate signing secret.
 */
const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload) {
  return b64url(crypto.createHmac('sha256', process.env.NOTES_PASSWORD || '')
    .update(payload).digest());
}

function mintToken() {
  const payload = String(Date.now() + TOKEN_TTL_MS);
  return `${b64url(payload)}.${sign(payload)}`;
}

function tokenOk(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [head, mac] = token.split('.', 2);
  let payload;
  try {
    payload = Buffer.from(head, 'base64url').toString();
  } catch {
    return false;
  }
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac || '');
  // Length has to match before timingSafeEqual, which throws on a mismatch
  // rather than returning false.
  if (expected.length !== given.length) return false;
  if (!crypto.timingSafeEqual(expected, given)) return false;
  const expiry = Number(payload);
  return Number.isFinite(expiry) && Date.now() < expiry;
}

/* ---- the two backends --------------------------------------------------- */

const local = {
  async read(key) {
    try {
      return await fs.readFile(path.join(devDir(), key), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  },
  async write(key, body) {
    const file = path.join(devDir(), key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body, 'utf8');
  },
  async list(prefix) {
    const dir = path.join(devDir(), prefix);
    try {
      const names = await fs.readdir(dir);
      return names.map((n) => ({ pathname: prefix + n }));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  },
  async remove(keys) {
    await Promise.all(keys.map((k) =>
      fs.rm(path.join(devDir(), k), { force: true })));
  },
};

const blobBackend = {
  async read(key) {
    const { get } = require('@vercel/blob');
    /* get() RESOLVES NULL for a blob that is not there -- it does not throw.
       The first version destructured `{ blob }` straight off the result, so an
       empty store (which is every store on its first run) threw a TypeError,
       the route turned that into a 502 and the overlay said OFFLINE. It could
       not have been caught locally: the filesystem backend below returns null
       for ENOENT, so only the real SDK had the shape that broke.

       useCache:false because this document is written and read constantly and
       correctness beats latency here. The default serves it from the CDN edge,
       which is exactly how one device saves an edit and another opens the copy
       from before it -- the cross-device sync this feature exists for, quietly
       broken. */
    let found;
    try {
      found = await get(key, { access: 'private', useCache: false });
    } catch (err) {
      // A genuine failure must NOT look like an empty store: reseeding over
      // real notes because the network hiccuped is the one unrecoverable
      // outcome here.
      if (err && (err.name === 'BlobNotFoundError' || /not.?found/i.test(err.message || ''))) {
        return null;
      }
      throw err;
    }
    if (!found) return null;
    /* THE CONTENT IS IN `stream`. `blob` is METADATA -- url, pathname, etag,
       contentType -- and calling .text() on it is a TypeError, which is what
       the second deploy did. The doc comment says the call "resolves to
       { stream, blob }" and it is easy to read `blob` as a web Blob; the
       GetBlobResult type says otherwise.

       The result is a discriminated union on statusCode: 200 carries the
       stream, 304 carries null. Nothing here sends an etag so 304 should be
       unreachable, and if it ever is, that is an error rather than an empty
       store -- returning null would reseed the seed over real notes. */
    if (!found.stream) {
      throw new Error(`blob ${key} returned statusCode ${found.statusCode} with no stream`);
    }
    return await new Response(found.stream).text();
  },
  async write(key, body) {
    const { put } = require('@vercel/blob');
    await put(key, body, {
      access: 'private',
      contentType: 'text/html; charset=utf-8',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
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

/* ---- what the routes actually call -------------------------------------- */

async function readNotes() {
  const saved = await backend().read(CURRENT);
  if (saved !== null) return { content: saved, seeded: false };
  // First run: hand back the seed WITHOUT writing it. A read that writes turns
  // a transient storage failure into a silent overwrite of real notes, and the
  // first save will persist it anyway.
  return { content: require('./notes-seed.js'), seeded: true };
}

/* Save, back up, prune -- in that order, so a failure part way through never
 * costs the document. The backup is written first for the same reason: a save
 * that dies between the two leaves an extra copy, which is harmless, rather
 * than a current with no copy behind it.
 */
async function writeNotes(content) {
  if (typeof content !== 'string') throw new Error('content must be a string');
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_BYTES) {
    const err = new Error(`content is ${bytes} bytes, over the ${MAX_BYTES} limit`);
    err.tooLarge = true;
    throw err;
  }
  const store = backend();
  const savedAt = new Date().toISOString();
  // Colons are legal in a blob pathname but a nuisance everywhere else -- a
  // local dev backend on Windows cannot create the file at all.
  const key = `${BACKUP_DIR}${savedAt.replace(/[:.]/g, '-')}.html`;

  await store.write(key, content);
  await store.write(CURRENT, content);

  // COUNT WHAT IS THERE, then delete the surplus. The alternative -- deleting
  // one per save and trusting the count to stay put -- drifts the moment a save
  // fails halfway, and drifts silently: too many backups and too few both look
  // like a working system until someone needs a restore.
  const all = (await store.list(BACKUP_DIR))
    .map((b) => b.pathname)
    .filter((p) => p.endsWith('.html'))
    .sort();                                   // ISO-8601 sorts chronologically
  const surplus = all.slice(0, Math.max(0, all.length - BACKUP_KEEP));
  if (surplus.length) await store.remove(surplus);

  return { savedAt, backups: all.length - surplus.length };
}

module.exports = {
  BACKUP_KEEP, MAX_BYTES, CURRENT, BACKUP_DIR,
  configError, passwordOk, mintToken, tokenOk, readNotes, writeNotes,
};
