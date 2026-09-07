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
 *
 * Since the rebuild the store also owns the rev check, the two backup tiers
 * and the asset store, and every one of those has a case here that must
 * refuse: a stale rev must NOT write, a save inside the window must NOT add
 * a copy, a wrong asset key must NOT read.
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
    /* The REAL shape, from the GetBlobResult type: a discriminated union on
       statusCode, where the CONTENT is `stream` (a ReadableStream) and `blob`
       is METADATA. */
    if (!store.has(pathname)) return null;
    const body = store.get(pathname);
    return {
      statusCode: 200,
      stream: new Response(body).body,
      headers: new Headers(),
      blob: { url: `https://stub/${pathname}`, pathname, contentType: 'text/html', size: Buffer.byteLength(body) },
    };
  },
  async put(pathname, body, options) {
    if (!options || options.access !== 'private') throw new Error("put() without access:'private'");
    if (store.has(pathname) && !options.allowOverwrite) throw new Error('blob exists and allowOverwrite was not set');
    store.set(pathname, Buffer.isBuffer(body) ? body : String(body));
    return { pathname, url: `https://stub/${pathname}` };
  },
  async list({ prefix } = {}) {
    const blobs = [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).map(pathname => ({ pathname }));
    return { blobs, cursor: undefined, hasMore: false };
  },
  async del(keys) { for (const k of [].concat(keys)) store.delete(k); },
};

const sdkPath = require.resolve('@vercel/blob');
require.cache[sdkPath] = { id: sdkPath, filename: sdkPath, loaded: true, exports: stub };

const notes = require(join(ROOT, 'lib/notes-store.js'));
const seed = require(join(ROOT, 'lib/notes-seed.js'));

const fail = [];
let pass = 0;
const check = (ok, why) => { if (ok) pass++; else fail.push(why); };
const wrapped = (key = notes.CURRENT) => JSON.parse(store.get(key));

/* ---- 1. an empty store seeds, and does NOT throw ------------------------- */
{
  store.clear(); getCalls = [];
  try {
    const r = await notes.readNotes();
    check(r.seeded === true, 'an empty store did not report itself as seeded');
    check(r.format === 'html' && r.content === seed, 'an empty store did not hand back the seed as html');
    check(r.rev === 0, `an empty store reported rev ${r.rev}`);
    check(getCalls.length === 2, `readNotes made ${getCalls.length} get() calls on an empty store, expected 2 (json, then html)`);
    console.log(`empty store: seeded=${r.seeded}, format=${r.format}, ${r.content.length} chars`);
  } catch (err) {
    fail.push(`an empty store threw instead of seeding: ${err.name}: ${err.message}`);
  }
}

/* ---- 2. reads are not served from the CDN cache -------------------------- */
{
  check(getCalls.every(c => c.options.useCache === false), 'readNotes allowed the CDN cache; a second device can get a stale document');
}

/* ---- 3. the pre-rebuild document is read when there is no json yet -------- */
{
  store.clear();
  store.set(notes.LEGACY, '<div class="nv-title">Old</div><section class="nv-sec"><h2>A</h2><ul><li>x</li></ul></section>');
  const r = await notes.readNotes();
  check(r.format === 'html' && r.content.includes('nv-title') && !r.seeded, 'a store with only current.html did not hand it back for migration');
  check(r.rev === 0, 'a legacy read is not rev 0');
  // ...and the json wins once it exists.
  store.set(notes.CURRENT, JSON.stringify({ rev: 7, savedAt: '2026-09-07T10:00:00.000Z', doc: { v: 2, sessions: [] } }));
  const j = await notes.readNotes();
  check(j.format === 'json' && j.rev === 7 && j.content.v === 2, 'current.json was not preferred over current.html');
  console.log(`legacy read: html first, then json at rev ${j.rev}`);
}

/* ---- 4. a real storage failure must NOT look like an empty store --------- */
{
  store.clear();
  const realGet = stub.get;
  stub.get = async () => { throw new Error('connection reset'); };
  let threw = false;
  try { await notes.readNotes(); } catch { threw = true; }
  check(threw, 'a storage failure was swallowed and the seed returned over it');
  stub.get = async () => { const e = new Error('nope'); e.name = 'BlobNotFoundError'; throw e; };
  const { seeded } = await notes.readNotes();
  check(seeded === true, 'a BlobNotFoundError was not treated as an empty store');
  stub.get = async () => ({ statusCode: 304, stream: null, blob: { pathname: 'x' } });
  threw = false;
  try { await notes.readNotes(); } catch { threw = true; }
  check(threw, 'a 304 with no stream was treated as an empty store');
  stub.get = realGet;
  // A current.json that does not parse is an error, never an empty store.
  store.set(notes.CURRENT, '{not json');
  threw = false;
  try { await notes.readNotes(); } catch { threw = true; }
  check(threw, 'a corrupt current.json was read as an empty store');
  console.log('storage failures: all refused rather than reseeding');
}

/* ---- 5. a save writes the tiers first, then current; rev counts up -------- */
{
  store.clear();
  const order = [];
  const realPut = stub.put;
  stub.put = async (p, b, o) => { order.push(p); return realPut(p, b, o); };
  const r1 = await notes.writeNotes({ v: 2, a: 1 }, undefined, Date.parse('2026-09-07T10:00:00.000Z'));
  check(!r1.conflict && r1.rev === 1, `first save reported rev ${r1.rev}`);
  check(order.length === 3, `first save made ${order.length} writes, expected 3 (backup, daily, current)`);
  check(order[0].startsWith(notes.BACKUP_DIR), `first write was ${order[0]}, expected the ten-minute backup`);
  check(order[1].startsWith(notes.DAILY_DIR), `second write was ${order[1]}, expected the daily`);
  check(order[2] === notes.CURRENT, `third write was ${order[2]}, expected current`);
  check(order[1] === `${notes.DAILY_DIR}2026-09-07.json`, `the daily is named ${order[1]}`);
  const w = wrapped();
  check(w.rev === 1 && w.doc.a === 1 && w.savedAt === '2026-09-07T10:00:00.000Z', 'current.json does not carry { rev, savedAt, doc }');
  const r2 = await notes.writeNotes({ v: 2, a: 2 }, 1, Date.parse('2026-09-07T10:00:05.000Z'));
  check(r2.rev === 2, `second save reported rev ${r2.rev}`);
  check((await notes.readNotes()).content.a === 2, 'the second save did not read back');
  check(!store.has(notes.LEGACY), 'a save wrote current.html');
  stub.put = realPut;
  console.log(`save: ${order.join(' then ')}; rev 1 -> ${r2.rev}`);
}

/* ---- 6. a stale rev is refused WITHOUT writing --------------------------- */
{
  const before = store.get(notes.CURRENT);
  const r = await notes.writeNotes({ v: 2, a: 99 }, 1, Date.parse('2026-09-07T10:00:10.000Z'));
  check(r.conflict === true, 'a save on a stale rev was accepted');
  check(r.rev === 2 && r.doc && r.doc.a === 2, 'the conflict did not carry the current document back');
  check(store.get(notes.CURRENT) === before, 'a conflicting save WROTE anyway');
  // A save without a baseRev (the migration's first write) skips the check.
  const r3 = await notes.writeNotes({ v: 2, a: 3 }, undefined, Date.parse('2026-09-07T10:00:11.000Z'));
  check(r3.rev === 3, 'a save with no baseRev was refused');
  console.log('rev check: stale refused and nothing written; undefined baseRev accepted');
}

/* ---- 7. the ten-minute tier: spacing and pruning, on a clock -------------- */
{
  const t0 = Date.parse('2026-09-08T00:00:00.000Z');
  const min = 60 * 1000;
  const stamp = (ms) => `${notes.BACKUP_DIR}${new Date(ms).toISOString().replace(/[:.]/g, '-')}.json`;
  // Inside the window: no new copy.
  let plan = notes.backupPlan([stamp(t0)], stamp(t0 + 3 * min), notes.BACKUP_EVERY_MS, notes.BACKUP_KEEP, t0 + 3 * min);
  check(plan.write === false && plan.kept === 1, 'a save three minutes after a backup wrote another backup');
  // At the window: a new copy.
  plan = notes.backupPlan([stamp(t0)], stamp(t0 + 10 * min), notes.BACKUP_EVERY_MS, notes.BACKUP_KEEP, t0 + 10 * min);
  check(plan.write === true && plan.kept === 2 && plan.prune.length === 0, 'a save ten minutes after a backup did not write one');
  // Twenty-five spaced copies prune to twenty, oldest first.
  const names = Array.from({ length: 25 }, (_, i) => stamp(t0 + i * 10 * min));
  plan = notes.backupPlan(names, stamp(t0 + 25 * 10 * min), notes.BACKUP_EVERY_MS, notes.BACKUP_KEEP, t0 + 25 * 10 * min);
  check(plan.write && plan.kept === notes.BACKUP_KEEP, `${plan.kept} kept of 26, expected ${notes.BACKUP_KEEP}`);
  check(plan.prune.length === 6 && plan.prune[0] === names[0] && plan.prune[5] === names[5], 'the prune list is not the six oldest');
  // The old .html backups are never counted and never pruned.
  plan = notes.backupPlan([`${notes.BACKUP_DIR}2026-08-01T00-00-00-000Z.html`, ...names], stamp(t0 + 25 * 10 * min), notes.BACKUP_EVERY_MS, notes.BACKUP_KEEP, t0 + 25 * 10 * min);
  check(plan.prune.every(p => p.endsWith('.json')), 'a pre-rebuild .html backup was queued for pruning');
  // A name that does not parse as a time counts as "long ago".
  plan = notes.backupPlan([`${notes.BACKUP_DIR}garbage.json`], stamp(t0), notes.BACKUP_EVERY_MS, notes.BACKUP_KEEP, t0);
  check(plan.write === true, 'an unparseable backup name stopped a backup being written');
  check(Number.isFinite(notes.stampToMs(stamp(t0))) && notes.stampToMs(stamp(t0)) === t0, 'stampToMs does not invert the stamp');
  console.log(`ten-minute tier: window ${notes.BACKUP_EVERY_MS / min} min, keep ${notes.BACKUP_KEEP}; cases held`);
}

/* ---- 8. the tiers through the live route: 25 saves in a window ------------ */
{
  store.clear();
  const t0 = Date.parse('2026-09-09T12:00:00.000Z');
  for (let i = 0; i < 25; i++) await notes.writeNotes({ v: 2, i }, i === 0 ? undefined : i, t0 + i * 1000);
  const tens = [...store.keys()].filter(k => k.startsWith(notes.BACKUP_DIR));
  const days = [...store.keys()].filter(k => k.startsWith(notes.DAILY_DIR));
  check(tens.length === 1, `${tens.length} ten-minute copies after 25 saves in one window, expected 1`);
  check(days.length === 1, `${days.length} daily copies after 25 saves in one day, expected 1`);
  check(wrapped().doc.i === 24 && wrapped().rev === 25, 'current is not the newest save');
  // Sixteen days of one save each prune the dailies to fourteen.
  for (let d = 1; d <= 16; d++) await notes.writeNotes({ v: 2, d }, 25 + d - 1, t0 + d * 24 * 60 * 60 * 1000);
  const days2 = [...store.keys()].filter(k => k.startsWith(notes.DAILY_DIR)).sort();
  check(days2.length === notes.DAILY_KEEP, `${days2.length} dailies after 17 days, expected ${notes.DAILY_KEEP}`);
  check(days2[days2.length - 1] === `${notes.DAILY_DIR}2026-09-25.json`, `the newest daily is ${days2[days2.length - 1]}`);
  console.log(`live tiers: ${tens.length} ten-minute, ${days2.length} daily after 17 days`);
}

/* ---- 9. the size ceiling refuses rather than truncating ------------------ */
{
  let tooLarge = false;
  try { await notes.writeNotes({ x: 'x'.repeat(notes.MAX_BYTES + 1) }, undefined); }
  catch (err) { tooLarge = !!err.tooLarge; }
  check(tooLarge, 'an over-size document was not refused');
  let notObject = false;
  try { await notes.writeNotes('<p>html</p>', undefined); } catch { notObject = true; }
  check(notObject, 'a string document was accepted');
}

/* ---- 10. password and token ---------------------------------------------- */
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
  process.env.NOTES_PASSWORD = 'different';
  check(!notes.tokenOk(token), 'a token survived the password changing under it');
  process.env.NOTES_PASSWORD = 'notes';
  check(notes.tokenOk(token), 'the token did not come back with the password');
  console.log('password and token cases held');
}

/* ---- 11. assets: content-addressed, typed, bounded --------------------------- */
{
  store.clear();
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const a = await notes.putAsset(png, 'image/png');
  check(/^[0-9a-f]{64}\.png$/.test(a.key), `asset key is ${a.key}`);
  check(store.has(`${notes.ASSET_DIR}${a.key}`), 'the asset was not written under notes/assets/');
  const b = await notes.putAsset(png, 'image/png');
  check(b.key === a.key && [...store.keys()].length === 1, 'the same bytes stored twice');
  const got = await notes.getAsset(a.key);
  check(got && got.contentType === 'image/png' && Buffer.compare(got.bytes, png) === 0, 'the asset did not read back byte for byte');
  check((await notes.getAsset('../current.json')) === null, 'a path was accepted as an asset key');
  check((await notes.getAsset('notes/assets/' + a.key)) === null, 'a prefixed key was accepted');
  check((await notes.getAsset(a.key.replace('.png', '.exe'))) === null, 'an unknown extension was accepted');
  let bad = false;
  try { await notes.putAsset(png, 'image/svg+xml'); } catch (err) { bad = !!err.badType; }
  check(bad, 'an SVG was accepted as an image asset');
  let big = false;
  try { await notes.putAsset(Buffer.alloc(notes.MAX_ASSET_BYTES + 1), 'image/png'); } catch (err) { big = !!err.tooLarge; }
  check(big, 'an over-size asset was accepted');
  console.log(`assets: ${a.key.slice(0, 12)}… deduplicated, typed, bounded`);
}

/* ---- 12. the dev backend can never run in production --------------------- */
{
  process.env.NOTES_DEV_DIR = join(ROOT, '.notes-dev');
  process.env.VERCEL_ENV = 'production';
  let refused = false;
  try { notes.configError(); } catch { refused = true; }
  check(refused, 'the ephemeral dev backend was allowed in production');
  delete process.env.VERCEL_ENV;
  delete process.env.NOTES_DEV_DIR;
}

/* ---- 13. a missing config is reported, not guessed ------------------------ */
{
  const keep = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  check(/BLOB_READ_WRITE_TOKEN/.test(notes.configError() || ''), 'a missing blob token was not reported by configError');
  process.env.BLOB_READ_WRITE_TOKEN = keep;
  const keepPw = process.env.NOTES_PASSWORD;
  delete process.env.NOTES_PASSWORD;
  check(/NOTES_PASSWORD/.test(notes.configError() || ''), 'a missing password was not reported by configError');
  process.env.NOTES_PASSWORD = keepPw;
  check(notes.configError() === null, 'a complete config was reported as broken');
}

console.log(`\n${pass} checks passed`);
console.log(fail.length ? `FAIL (${fail.length}):\n  ${fail.join('\n  ')}` : 'PASS — every store check held');
process.exit(fail.length ? 1 : 0);
