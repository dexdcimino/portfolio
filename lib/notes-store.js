/* Storage and auth for the live notes overlay.
 *
 * Everything the API routes share lives here: where the document is kept,
 * how the password is checked, how a session token is minted and verified,
 * and how an image is stored beside the document. It sits in lib/ rather than
 * under api/ because Vercel turns every file under api/ into a route, and a
 * shared module is not a route.
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
 *   notes/current.json            the live document: { rev, savedAt, doc, tiers }
 *                                 `tiers` is the backup ledger -- see
 *                                 tierLedger() -- and never leaves the server.
 *   notes/current.html            the document BEFORE the 2026-09 rebuild. Read
 *                                 once, when there is no current.json yet, and
 *                                 then never written again -- it is the
 *                                 permanent safety net under the migration.
 *   notes/backups/<iso>.json      one per BACKUP_EVERY window, newest 20 kept
 *   notes/daily/<date>.json       one per calendar day, newest 14 kept
 *   notes/backups/<iso>.html      the pre-rebuild backups. Never pruned.
 *   notes/assets/<sha256>.<ext>   images pasted into the notes
 *
 * All of them are PRIVATE blobs. A public blob has a URL, and a URL is one
 * guess away from being the leak this feature exists to prevent -- the
 * pathname is fixed and the store id is not really a secret.
 *
 * THE REVISION COUNTER. Every save carries the rev it was built on, and a save
 * built on a rev that is no longer current comes back as a conflict carrying
 * the current document instead of overwriting it. Before this, two devices
 * with the overlay open would silently take turns wiping each other's edits:
 * whichever autosaved last won the whole document. The client merges per
 * session and retries, so the cost of the check is one read per save.
 */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const CURRENT = 'notes/current.json';
const LEGACY = 'notes/current.html';
const BACKUP_DIR = 'notes/backups/';
const DAILY_DIR = 'notes/daily/';
const ASSET_DIR = 'notes/assets/';

// How many timestamped copies survive. Twenty ten-minute copies walk back
// through a bad afternoon; fourteen dailies walk back through a bad fortnight.
// Before the rebuild every save wrote a copy, which at one save per second of
// typing made the twenty copies cover the last thirty seconds -- a window
// nobody could restore anything useful from.
const BACKUP_KEEP = 20;
const BACKUP_EVERY_MS = 10 * 60 * 1000;
const DAILY_KEEP = 14;

// A session lasts a working day and every save renews it, so a tab left open
// while Dex actually works does not drop him back to the keypad mid-sentence.
// It is still a bearer token: it expires on its own, and it is only ever as
// good as the password that minted it.
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

// The document is JSON with the note bodies as HTML strings inside it. Images
// are NOT in it -- they are assets, referenced by key -- so this is text, and
// four megabytes of text is a very long set of notes. It is also under the
// 4.5 MB Vercel puts on a request body, which is the real ceiling.
const MAX_BYTES = 4 * 1024 * 1024;

// One pasted image, after the client has already scaled it down. Three
// megabytes is a generous ceiling for a 1600px WebP and a clear refusal for a
// raw camera file that slipped past the resize.
const MAX_ASSET_BYTES = 3 * 1024 * 1024;

const ASSET_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

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

/* Both speak in Buffers for bytes and strings for text. `read` returns a
 * string, `readBytes` a Buffer, and both return null for a key that is not
 * there -- a genuine failure throws, and the difference matters: a throw that
 * looked like an empty store would reseed the seed over real notes. */

const local = {
  async read(key) {
    const bytes = await this.readBytes(key);
    return bytes === null ? null : bytes.toString('utf8');
  },
  async readBytes(key) {
    try {
      return await fs.readFile(path.join(devDir(), key));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  },
  async write(key, body) {
    const file = path.join(devDir(), key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
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
    const bytes = await this.readBytes(key);
    return bytes === null ? null : bytes.toString('utf8');
  },
  async readBytes(key) {
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
    return Buffer.from(await new Response(found.stream).arrayBuffer());
  },
  async write(key, body, contentType) {
    const { put } = require('@vercel/blob');
    await put(key, body, {
      access: 'private',
      contentType: contentType || contentTypeFor(key),
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

function contentTypeFor(key) {
  if (key.endsWith('.json')) return 'application/json; charset=utf-8';
  if (key.endsWith('.html')) return 'text/html; charset=utf-8';
  const ext = key.slice(key.lastIndexOf('.') + 1);
  const type = Object.keys(ASSET_TYPES).find((t) => ASSET_TYPES[t] === ext);
  return type || 'application/octet-stream';
}

const backend = () => (devDir() ? local : blobBackend);

/* ---- the document ------------------------------------------------------- */

/* The wrapper on disk is { rev, savedAt, doc }. A wrapper that does not parse
 * is treated as a hard error, not as an empty store: the one way to lose the
 * notes from here is to decide they are not there. */
function parseWrapper(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${CURRENT} is not valid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.rev !== 'number' || !('doc' in parsed)) {
    throw new Error(`${CURRENT} does not have the { rev, savedAt, doc } shape`);
  }
  return parsed;
}

/* What the unlock route hands back. Three shapes, in order of preference:
 *   json   the live document, rev and all
 *   html   the pre-rebuild document, for the client to migrate. rev is 0 and
 *          the first save writes current.json beside it.
 *   seed   nothing has ever been saved. Same rev 0. The seed is handed back
 *          WITHOUT being written: a read that writes turns a transient storage
 *          failure into a silent overwrite of real notes.
 */
async function readNotes() {
  const store = backend();
  const wrapped = await store.read(CURRENT);
  if (wrapped !== null) {
    const { rev, savedAt, doc } = parseWrapper(wrapped);
    return { format: 'json', content: doc, rev, savedAt: savedAt || null };
  }
  const legacy = await store.read(LEGACY);
  if (legacy !== null) {
    return { format: 'html', content: legacy, rev: 0, savedAt: null };
  }
  return { format: 'html', content: require('./notes-seed.js'), rev: 0, savedAt: null, seeded: true };
}

/* The backup policy, as one pure function so the cases can drive it without
 * a store. `names` are the pathnames already in a backup folder; `stamp` is
 * the name this save would write. Returns what to write, what to prune, and
 * when the newest copy will have been written once the plan has run --
 * which is what the ledger below carries forward.
 *
 * "Newest" is by name: the names are ISO timestamps with the punctuation
 * swapped for dashes, which still sort chronologically, and reading the time
 * back out of the name costs nothing where reading blob metadata costs a call.
 */
function backupPlan(names, stamp, everyMs, keep, now) {
  const mine = names.filter((n) => n.endsWith('.json')).sort();
  const newest = mine.length ? mine[mine.length - 1] : null;
  const newestAt = newest ? stampToMs(newest) : -Infinity;
  const write = !newest || !Number.isFinite(newestAt) || now - newestAt >= everyMs;
  const after = write ? [...mine, stamp].sort() : mine;
  const prune = after.slice(0, Math.max(0, after.length - keep));
  return { write, prune, kept: after.length - prune.length, newestAt: write ? now : newestAt };
}

/* THE TIER LEDGER, and why the counting moved off the hot path.
 *
 * Every save used to list BOTH backup folders to work out whether a
 * ten-minute copy or a daily was due. That is two blob LIST calls -- both
 * "advanced" operations on Vercel's meter -- on a save that is otherwise one
 * read and one write, and the editor saves on a debounce, so a session of
 * typing spends them by the thousand. On 2026-09-08 it spent the whole Hobby
 * allowance and the live store locked out.
 *
 * So the two facts those lists were being read for now ride in the wrapper
 * that every save already reads:
 *
 *   { rev, savedAt, doc, tiers: { backupAt, backups, dailyDate, dailies } }
 *
 * THE LEDGER IS A GATE, NOT THE DECISION. A save whose ledger says nothing is
 * due lists nothing at all. A save whose ledger says something IS due lists
 * the folder and hands the real names to backupPlan, which decides -- so the
 * "count what is there, then decide" rule this replaced still runs in full,
 * just on the one save in many that writes a copy instead of on all of them.
 *
 * THAT IS ALSO WHAT MAKES IT SELF-HEALING, which is the property a bare
 * counter would not have had. Every state the ledger can be wrong in resolves
 * on its own:
 *   - no ledger at all (every wrapper written before this change): read as
 *     "due", so the very first save lists exactly as before, backupPlan
 *     refuses or writes on the truth, and the ledger is seeded from what is
 *     really there. Nothing is duplicated and nothing is skipped.
 *   - a ledger that is garbage, or names a time that does not parse: same
 *     path, same outcome.
 *   - a save that died after writing a backup but before writing current:
 *     the ledger never advanced, so the next save still thinks a copy is due,
 *     lists, sees the copy that was written, and refuses. The extra list is
 *     the cost; there is no duplicate.
 *   - the reverse cannot happen, because the backup is written BEFORE current
 *     and a failure there throws before anything is committed.
 * The worst case is one extra list and one window's delay, and the next
 * backup-writing save rewrites the ledger from a real listing regardless.
 *
 * `backups` and `dailies` are counts, and are carried only so a save that
 * lists nothing can still report how many copies stand behind it. Nothing
 * decides on them.
 */
function tierLedger(wrapper) {
  const t = wrapper && wrapper.tiers;
  if (!t || typeof t !== 'object') return null;
  const backupAt = Date.parse(t.backupAt);
  return {
    backupAt: Number.isFinite(backupAt) ? backupAt : null,
    backups: Number.isFinite(t.backups) ? t.backups : 0,
    dailyDate: typeof t.dailyDate === 'string' ? t.dailyDate : null,
    dailies: Number.isFinite(t.dailies) ? t.dailies : 0,
  };
}

/* notes/backups/2026-09-07T10-27-31-123Z.json -> the epoch ms it names. */
function stampToMs(pathname) {
  const base = pathname.slice(pathname.lastIndexOf('/') + 1).replace(/\.json$/, '');
  // 2026-09-07T10-27-31-123Z -> 2026-09-07T10:27:31.123Z
  const iso = base.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, '$1T$2:$3:$4.$5Z');
  return Date.parse(iso);
}

/* Save, back up, prune -- in that order, so a failure part way through never
 * costs the document. The backup is written first for the same reason: a save
 * that dies between the two leaves an extra copy, which is harmless, rather
 * than a current with no copy behind it.
 *
 * `baseRev` is the rev the client built this document on. If the store has
 * moved past it the save is refused with the current document attached, and
 * nothing is written. `undefined` skips the check -- that is the migration's
 * first save and the harnesses, not the editor.
 */
async function writeNotes(doc, baseRev, now = Date.now()) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('doc must be an object');
  }
  const store = backend();

  const existing = await store.read(CURRENT);
  const current = existing === null ? null : parseWrapper(existing);
  const currentRev = current ? current.rev : 0;
  if (baseRev !== undefined && baseRev !== currentRev) {
    return {
      conflict: true,
      rev: currentRev,
      savedAt: current ? current.savedAt : null,
      doc: current ? current.doc : null,
    };
  }

  const rev = currentRev + 1;
  const savedAt = new Date(now).toISOString();

  // Colons are legal in a blob pathname but a nuisance everywhere else -- a
  // local dev backend on Windows cannot create the file at all.
  const stamp = `${BACKUP_DIR}${savedAt.replace(/[:.]/g, '-')}.json`;
  const today = savedAt.slice(0, 10);
  const daily = `${DAILY_DIR}${today}.json`;

  /* The two tiers, gated on the ledger the last save left behind. A steady
     save takes neither branch and so makes no list() call at all -- see
     tierLedger() above for why that stays honest. */
  const ledger = tierLedger(current);

  let backupWrite = false;
  let backupPrune = [];
  let backupAt = ledger ? ledger.backupAt : null;
  let backups = ledger ? ledger.backups : 0;
  if (backupAt === null || now - backupAt >= BACKUP_EVERY_MS) {
    // COUNT WHAT IS THERE, then decide. The alternative -- trusting a counter
    // to stay put -- drifts the moment a save fails halfway, and drifts
    // silently: too many backups and too few both look like a working system
    // until someone needs a restore. So the names decide, every time a copy
    // might be written.
    const names = (await store.list(BACKUP_DIR)).map((b) => b.pathname);
    const plan = backupPlan(names, stamp, BACKUP_EVERY_MS, BACKUP_KEEP, now);
    backupWrite = plan.write;
    backupPrune = plan.prune;
    backups = plan.kept;
    backupAt = plan.newestAt;
  }

  let dayWrite = false;
  let dayPrune = [];
  let dailyDate = ledger ? ledger.dailyDate : null;
  let dailies = ledger ? ledger.dailies : 0;
  if (dailyDate !== today) {
    const days = (await store.list(DAILY_DIR)).map((b) => b.pathname).filter((p) => p.endsWith('.json')).sort();
    dayWrite = !days.includes(daily);
    const dayAll = dayWrite ? [...days, daily].sort() : days;
    dayPrune = dayAll.slice(0, Math.max(0, dayAll.length - DAILY_KEEP));
    dailies = dayAll.length - dayPrune.length;
    dailyDate = today;
  }

  const tiers = {
    backupAt: Number.isFinite(backupAt) ? new Date(backupAt).toISOString() : null,
    backups,
    dailyDate,
    dailies,
  };
  const body = JSON.stringify({ rev, savedAt, doc, tiers });
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > MAX_BYTES) {
    const err = new Error(`document is ${bytes} bytes, over the ${MAX_BYTES} limit`);
    err.tooLarge = true;
    throw err;
  }

  if (backupWrite) await store.write(stamp, body);
  if (dayWrite) await store.write(daily, body);

  await store.write(CURRENT, body);

  if (backupPrune.length) await store.remove(backupPrune);
  if (dayPrune.length) await store.remove(dayPrune);

  return { rev, savedAt, backups, daily: dailies };
}

/* ---- assets ------------------------------------------------------------- */

/* Content-addressed: the key is the sha256 of the bytes, so pasting the same
 * screenshot twice stores it once and a re-upload after a failed save is a
 * no-op rather than a duplicate. Nothing is ever deleted from here by the
 * editor -- a note that is undone, or a backup that is restored, may point at
 * an image again, and an image the notes do not reference costs almost
 * nothing to keep. */
async function putAsset(bytes, contentType) {
  const ext = ASSET_TYPES[contentType];
  if (!ext) {
    const err = new Error(`unsupported image type ${contentType}`);
    err.badType = true;
    throw err;
  }
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error('asset must be bytes');
  if (bytes.length > MAX_ASSET_BYTES) {
    const err = new Error(`asset is ${bytes.length} bytes, over the ${MAX_ASSET_BYTES} limit`);
    err.tooLarge = true;
    throw err;
  }
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const key = `${ASSET_DIR}${sha}.${ext}`;
  await backend().write(key, bytes, contentType);
  return { key: `${sha}.${ext}`, bytes: bytes.length };
}

/* The key the client holds is `<sha>.<ext>`, never a path: it is validated
 * back into one here, so a request cannot name a blob outside the assets
 * folder however it is spelled. */
const ASSET_KEY = /^[0-9a-f]{64}\.(png|jpg|webp|gif)$/;

async function getAsset(key) {
  if (typeof key !== 'string' || !ASSET_KEY.test(key)) return null;
  const bytes = await backend().readBytes(`${ASSET_DIR}${key}`);
  if (bytes === null) return null;
  return { bytes, contentType: contentTypeFor(key) };
}

module.exports = {
  BACKUP_KEEP, BACKUP_EVERY_MS, DAILY_KEEP, MAX_BYTES, MAX_ASSET_BYTES,
  CURRENT, LEGACY, BACKUP_DIR, DAILY_DIR, ASSET_DIR, ASSET_TYPES, ASSET_KEY,
  configError, passwordOk, mintToken, tokenOk,
  readNotes, writeNotes, backupPlan, tierLedger, stampToMs, putAsset, getAsset,
};
