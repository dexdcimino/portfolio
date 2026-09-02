/* Drive lib/notes-store.js against a STUBBED @vercel/blob.
 *
 *   node tools/notes_store_check.mjs
 *
 * WHY THIS EXISTS. The browser harnesses run the real routes against a
 * filesystem backend, so everything above the storage call is exercised and the
 * storage call is not -- and that is exactly where the first deploy broke.
 * `get()` RESOLVES NULL for a missing blob rather than throwing; the code
 * destructured `{ blob }` off it, so an empty store (which is every store on
 * its first run) threw a TypeError, the route answered 502 and the overlay said
 * OFFLINE. The filesystem backend returns null for a missing file, so no local
 * run could reproduce it.
 *
 * These cases assert the SDK's DOCUMENTED CONTRACT against the real store
 * module, with the SDK replaced by a stub that behaves the way the type
 * definitions say it does. That is the seam where the bug lived.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);

process.env.NOTES_PASSWORD = 'notes';
process.env.BLOB_READ_WRITE_TOKEN = 'stub-token';
delete process.env.NOTES_DEV_DIR;
delete process.env.VERCEL_ENV;

/* The stub. Every behaviour here is taken from node_modules/@vercel/blob's own
 * type definitions, not from what the code happens to expect -- a stub written
 * to match the caller would have agreed with the bug. */
const store = new Map();
let getCalls = [];
const stub = {
  async get(pathname, options) {
    getCalls.push({ pathname, options });
    if (!options || options.access !== 'private') {
      throw new Error(`get() called without access:'private' (${JSON.stringify(options)})`);
    }
    // "@returns A promise that resolves to { stream, blob } or null if not found."
    if (!store.has(pathname)) return null;
    const body = store.get(pathname);
    return { stream: null, blob: { text: async () => body } };
  },
  async put(pathname, body, options) {
    if (!options || options.access !== 'private') throw new Error("put() without access:'private'");
    if (store.has(pathname) && !options.allowOverwrite) {
      throw new Error('blob exists and allowOverwrite was not set');
    }
    store.set(pathname, body);
    return { pathname, url: `https://stub/${pathname}` };
  },
  async list({ prefix, cursor } = {}) {
    const blobs = [...store.keys()]
      .filter(k => !prefix || k.startsWith(prefix))
      .map(pathname => ({ pathname }));
    return { blobs, cursor: undefined, hasMore: false };
  },
  async del(keys) {
    for (const k of [].concat(keys)) store.delete(k);
  },
};

// Put the stub in the module cache BEFORE the store module requires it.
const sdkPath = require.resolve('@vercel/blob');
require.cache[sdkPath] = { id: sdkPath, filename: sdkPath, loaded: true, exports: stub };

const notes = require(join(ROOT, 'lib/notes-store.js'));
const seed = require(join(ROOT, 'lib/notes-seed.js'));

const fail = [];
let pass = 0;
const check = (ok, why) => { if (ok) pass++; else fail.push(why); };

/* ---- 1. an empty store seeds, and does NOT throw -------------------------
   The exact shape of the shipped bug. */
{
  store.clear(); getCalls = [];
  // Caught rather than allowed to crash the run: the shipped bug threw a
  // TypeError from inside readNotes, and a gate that dies on the defect it
  // exists to name reports a stack trace instead of a sentence.
  try {
    const { content, seeded } = await notes.readNotes();
    check(seeded === true, 'an empty store did not report itself as seeded');
    check(content === seed, 'an empty store did not hand back the seed');
    check(getCalls.length === 1, `readNotes made ${getCalls.length} get() calls, expected 1`);
    console.log(`empty store: seeded=${seeded}, ${content.length} chars`);
  } catch (err) {
    fail.push(`an empty store threw instead of seeding: ${err.name}: ${err.message}`);
    console.log(`empty store: THREW ${err.name}`);
  }
}

/* ---- 2. reads are not served from the CDN cache -------------------------
   FALSELY PASSES IF: never asserted. useCache defaults to TRUE, and a cached
   read is how one device saves an edit and another opens the copy from before
   it -- the cross-device sync this feature exists for, quietly broken. */
{
  check(getCalls.every(c => c.options.useCache === false),
        'readNotes allowed the CDN cache; a second device can get a stale document');
  console.log(`get options: ${JSON.stringify(getCalls[0].options)}`);
}

/* ---- 3. a real storage failure must NOT look like an empty store ---------
   Reseeding over real notes because the network hiccuped is the one
   unrecoverable outcome here, so this must throw rather than return the seed. */
{
  store.clear();
  const boom = new Error('connection reset');
  stub.get = async () => { throw boom; };
  let threw = false;
  try { await notes.readNotes(); } catch { threw = true; }
  check(threw, 'a storage failure was swallowed and the seed returned over it');
  console.log(`storage failure: threw=${threw}`);
  // ...but a genuine not-found error still means "nothing saved yet".
  stub.get = async () => { const e = new Error('nope'); e.name = 'BlobNotFoundError'; throw e; };
  const { seeded } = await notes.readNotes();
  check(seeded === true, 'a BlobNotFoundError was not treated as an empty store');
}

/* ---- 4. a save writes both copies, and the backup FIRST ------------------
   Order matters: a save that dies between the two should leave a spare copy,
   not a current with nothing behind it. */
{
  store.clear();
  const order = [];
  stub.get = async (p) => (store.has(p) ? { blob: { text: async () => store.get(p) } } : null);
  const realPut = stub.put;
  stub.put = async (p, b, o) => { order.push(p); return realPut(p, b, o); };
  const { savedAt, backups } = await notes.writeNotes('<p>hello</p>');
  check(order.length === 2, `a save made ${order.length} writes, expected 2`);
  check(order[0].startsWith('notes/backups/'), `first write was ${order[0]}, expected the backup`);
  check(order[1] === 'notes/current.html', `second write was ${order[1]}, expected current`);
  check(backups === 1, `reported ${backups} backups after one save`);
  check(!!Date.parse(savedAt), `savedAt "${savedAt}" is not a date`);
  const { content, seeded } = await notes.readNotes();
  check(content === '<p>hello</p>' && !seeded, 'the saved document did not read back');
  console.log(`save: ${order.join(' then ')}, backups=${backups}`);
}

/* ---- 5. backups rotate at exactly BACKUP_KEEP ---------------------------
   FALSELY PASSES IF: only one save is made, or backups accumulate forever.
   Both are silent until a restore is needed, so drive well past the limit. */
{
  store.clear();
  for (let i = 0; i < 25; i++) {
    await notes.writeNotes(`<p>edit ${i}</p>`);
    await new Promise(r => setTimeout(r, 2));      // distinct ISO timestamps
  }
  const kept = [...store.keys()].filter(k => k.startsWith('notes/backups/')).sort();
  check(kept.length === notes.BACKUP_KEEP,
        `${kept.length} backups after 25 saves, expected ${notes.BACKUP_KEEP}`);
  check(store.get(kept.at(-1)) === '<p>edit 24</p>',
        'the newest backup is not the newest save');
  check(store.get('notes/current.html') === '<p>edit 24</p>', 'current is not the newest save');
  console.log(`rotation: ${kept.length} kept of 25 saves, newest holds ${store.get(kept.at(-1))}`);
}

/* ---- 6. the size ceiling refuses rather than truncating ------------------ */
{
  let tooLarge = false;
  try { await notes.writeNotes('x'.repeat(notes.MAX_BYTES + 1)); }
  catch (err) { tooLarge = !!err.tooLarge; }
  check(tooLarge, 'an over-size document was not refused');
}

/* ---- 7. password and token ---------------------------------------------- */
{
  check(await notes.passwordOk('notes'), 'the correct password was rejected');
  check(!await notes.passwordOk('Notes'), 'the password check is case-insensitive');
  check(!await notes.passwordOk(''), 'an empty password was accepted');
  check(!await notes.passwordOk(undefined), 'a missing password was accepted');

  const token = notes.mintToken();
  check(notes.tokenOk(token), 'a freshly minted token did not verify');
  check(!notes.tokenOk(`${token}x`), 'a tampered token verified');
  check(!notes.tokenOk('aaa.bbb'), 'a nonsense token verified');
  check(!notes.tokenOk(undefined), 'an absent token verified');

  // Changing the password must end every live session.
  process.env.NOTES_PASSWORD = 'different';
  check(!notes.tokenOk(token), 'a token survived the password changing under it');
  process.env.NOTES_PASSWORD = 'notes';
  check(notes.tokenOk(token), 'the token did not come back with the password');
  console.log('password and token cases held');
}

/* ---- 8. the dev backend can never run in production --------------------- */
{
  process.env.NOTES_DEV_DIR = join(ROOT, '.notes-dev');
  process.env.VERCEL_ENV = 'production';
  let refused = false;
  try { notes.configError(); } catch { refused = true; }
  check(refused, 'the ephemeral dev backend was allowed in production');
  delete process.env.VERCEL_ENV;
  delete process.env.NOTES_DEV_DIR;
  console.log(`dev backend in production: refused=${refused}`);
}

/* ---- 9. a missing config is reported, not guessed ------------------------ */
{
  const keep = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  check(/BLOB_READ_WRITE_TOKEN/.test(notes.configError() || ''),
        'a missing blob token was not reported by configError');
  process.env.BLOB_READ_WRITE_TOKEN = keep;
  const keepPw = process.env.NOTES_PASSWORD;
  delete process.env.NOTES_PASSWORD;
  check(/NOTES_PASSWORD/.test(notes.configError() || ''),
        'a missing password was not reported by configError');
  process.env.NOTES_PASSWORD = keepPw;
  check(notes.configError() === null, 'a complete config was reported as broken');
}

console.log(`\n${pass} checks passed`);
console.log(fail.length ? `FAIL (${fail.length}):\n  ${fail.join('\n  ')}`
                        : 'PASS — every store check held');
process.exit(fail.length ? 1 : 0);
