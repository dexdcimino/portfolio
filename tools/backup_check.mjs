/* Inko's backups (lib/sketch-backup.js), proven by breaking things and
 * putting them back.
 *
 *   node tools/backup_check.mjs
 *
 * Runs the REAL api/sketch.js handler in this process against a scratch
 * NOTES_DEV_DIR, on a FAKE CLOCK (Date.now is replaced), so months of saves
 * take a second. No browser, no server, no network.
 *
 * Every disaster is checked against the BYTES that come back through the
 * account's own canvas-img route, not against an index that merely says so:
 *   - an overwrite with a blank canvas, put back
 *   - one canvas deleted by accident, put back without touching the rest
 *   - every canvas wiped at once (the empty-account case), put back exactly
 *   - a "hacker" with the token overwriting and deleting, rolled back
 *   - the index itself wiped to {}, recovered from the snapshots alone
 *   - a restore undone by restoring to just before it
 *   - a deleted account brought back, password and all
 *   - a renamed account's old canvases restored onto the new name
 *   - the 30-day purge removing a deleted account's every byte, and NOT the
 *     canvases of someone who took the name meanwhile
 *   - 120 days of saves: snapshots and retired versions staying bounded, and
 *     every snapshot that is kept still pointing at bytes that exist
 *   - the Hobby budget: a steady save costs exactly three writes, as before
 *   - admin only: a user token and no token are refused
 *   - the Blob backend's list() following its cursor (a stubbed SDK)
 *
 * FALSELY PASSES IF: the scratch store is not where the handler writes. The
 * first case reads a canvas back through the API before anything else.
 */
import { createHmac } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const SCRATCH = await mkdtemp(join(tmpdir(), 'backup-check-'));
process.env.NOTES_DEV_DIR = SCRATCH;
process.env.AUTH_SECRET = 'backup-check-secret';
delete process.env.VERCEL_ENV;
delete process.env.CRON_SECRET;

let clock = Date.UTC(2026, 0, 1, 9, 0, 0);
Date.now = () => clock;
const HOUR = 3600e3, DAY = 24 * HOUR;

const handler = require(join(ROOT, 'api', 'sketch.js'));
const store = require(join(ROOT, 'lib', 'sketch-store.js'));
const backup = require(join(ROOT, 'lib', 'sketch-backup.js'));

let checks = 0, failed = 0;
function note(ok, msg) { checks++; if (!ok) { failed++; console.error('FAIL: ' + msg); } }

/* A Vercel-shaped call straight into the handler. */
async function call(method, { body, query = {}, headers = {} } = {}) {
  return new Promise((done, fail) => {
    const out = { status: 200, headers: {}, body: null };
    const res = {
      setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; },
      getHeader: (k) => out.headers[k.toLowerCase()],
      status(code) { out.status = code; return res; },
      json(obj) { out.body = obj; done(out); return res; },
      send(buf) { out.body = buf; done(out); return res; },
      end() { done(out); return res; },
    };
    handler({ method, query, headers, body, url: '/api/sketch' }, res).catch(fail);
  });
}
const post = (body) => call('POST', { body });
const b64u = (x) => Buffer.from(x).toString('base64url');
function adminJwt() {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const b = b64u(JSON.stringify({ tier: 'admin', owner: true, exp: Math.floor(Date.UTC(2030, 0, 1) / 1000) }));
  return `${h}.${b}.${b64u(createHmac('sha256', process.env.AUTH_SECRET).update(h + '.' + b).digest())}`;
}
const ADMIN = adminJwt();
const admin = (action, extra) => { clock += 1000; return post({ action, admin: ADMIN, ...extra }); };

/* Canvas bytes whose CONTENT says what they are: a PNG signature and a label. */
const png = (label) => 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('|' + label)]).toString('base64');
const jpg = (label) => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('|' + label)]).toString('base64');
async function save(tok, id, label, title = id) {
  clock += 1000;
  const r = await post({ action: 'canvas-put', token: tok, id, title, bg: { h: 1, s: 2, b: 3 }, created: clock, ts: clock, visibility: 'private', png: png(label), thumb: jpg(label) });
  if (r.status !== 200) throw new Error(`save ${id}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.canvas;
}
async function del(tok, id) { clock += 1000; return post({ action: 'canvas-delete', token: tok, id, ts: clock }); }
/* What the account's devices would see: each live canvas and the label in its bytes. */
async function seen(tok) {
  const { canvases } = (await post({ action: 'canvases', token: tok })).body;
  const out = {};
  for (const c of canvases) {
    if (c.deleted) continue;
    const r = await post({ action: 'canvas-img', token: tok, id: c.id, v: c.v });
    out[c.id] = r.status === 200 ? r.body.toString('latin1').split('|')[1] : `<${r.status}>`;
  }
  return out;
}
const same = (a, b) => JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort());
async function files(prefix) {
  const out = [];
  const walk = async (rel) => {
    let ds; try { ds = await readdir(join(SCRATCH, rel), { withFileTypes: true }); } catch { return; }
    for (const d of ds) { const k = rel + '/' + d.name; if (d.isDirectory()) await walk(k); else out.push(k); }
  };
  await walk(prefix);
  return out;
}

try {
  // ---- 0. the store is where we think, and steady saves cost what they did --
  const A = (await post({ action: 'signup', handle: 'artist', password: 'correct horse' })).body;
  await save(A.token, 'cv1', 'cv1-good');
  note(same(await seen(A.token), { cv1: 'cv1-good' }), 'a canvas did not read back through the API');
  await save(A.token, 'cv1', 'cv1-good');   // an empty account has nothing to snapshot; this save takes today's
  const dev = store.io.backend();
  const realWrite = dev.write;
  let writes = [];
  dev.write = async (k, ...rest) => { writes.push(k); return realWrite.call(dev, k, ...rest); };
  writes = []; await save(A.token, 'cv1', 'cv1-v2');
  note(writes.length === 3, `a steady save wrote ${writes.length} blobs, not 3: ${writes.join(', ')}`);
  clock += DAY;
  writes = []; await save(A.token, 'cv1', 'cv1-good');
  note(writes.length === 4 && writes.some((k) => k.startsWith('sketch-backup/artist/')), `the first save of a day did not add exactly one snapshot: ${writes.join(', ')}`);
  writes = []; await save(A.token, 'cv1', 'cv1-good');
  note(writes.length === 3, `a second save that day wrote ${writes.length}`);
  dev.write = realWrite;
  console.log('cost: a steady save is 3 writes, the first of the day 4 (one snapshot)');

  // ---- 1. overwritten with a blank canvas ---------------------------------
  for (const id of ['cv2', 'cv3', 'cv4', 'cv5']) await save(A.token, id, id + '-good');
  const good = await seen(A.token);
  const tGood = clock;
  clock += HOUR;
  await save(A.token, 'cv1', 'BLANK');
  note((await seen(A.token)).cv1 === 'BLANK', 'the blank overwrite did not land');
  const r1 = await admin('backup-restore', { handle: 'artist', at: tGood, ids: ['cv1'] });
  note(r1.status === 200 && same(await seen(A.token), good), `an overwritten canvas did not come back: ${JSON.stringify(r1.body)} -> ${JSON.stringify(await seen(A.token))}`);
  const cv1 = (await post({ action: 'canvases', token: A.token })).body.canvases.find((c) => c.id === 'cv1');
  note(cv1.ts === clock, 'a restored canvas is not stamped now, so a phone holding the blank would win');
  console.log('overwrite: a blank save over cv1 put back from its retired version');

  // ---- 2. one canvas deleted by accident ----------------------------------
  clock += HOUR;
  const tBefore = clock;
  await del(A.token, 'cv3');
  await save(A.token, 'cv2', 'cv2-newer');      // a later edit that must survive
  const r2 = await admin('backup-restore', { handle: 'artist', at: tBefore, mode: 'missing' });
  const after2 = await seen(A.token);
  note(r2.status === 200 && after2.cv3 === 'cv3-good' && after2.cv2 === 'cv2-newer', `undeleting one canvas: ${JSON.stringify(r2.body)} -> ${JSON.stringify(after2)}`);
  console.log('accidental delete: cv3 back, the newer edit to cv2 untouched');

  // ---- 3. everything wiped at once (the empty-account case) ---------------
  clock += HOUR;
  const full = await seen(A.token);
  const tFull = clock;
  for (const id of Object.keys(full)) await del(A.token, id);
  note(Object.keys(await seen(A.token)).length === 0, 'the wipe did not wipe');
  const dry = await admin('backup-restore', { handle: 'artist', at: tFull, dry: true });
  note(dry.body.dry && dry.body.restored.length === 5 && Object.keys(await seen(A.token)).length === 0, `a dry run changed something or planned wrong: ${JSON.stringify(dry.body)}`);
  const r3 = await admin('backup-restore', { handle: 'artist', at: tFull });
  note(same(await seen(A.token), full), `a wiped account did not come back exactly: ${JSON.stringify(await seen(A.token))} vs ${JSON.stringify(full)}`);
  console.log(`wipe: all ${r3.body.restored.length} canvases deleted at once, all back, bytes identical`);

  // ---- 4. a "hacker" with the token -----------------------------------------
  clock += DAY;
  const tSafe = clock;
  const safe = await seen(A.token);
  await save(A.token, 'cv1', 'HACKED'); await save(A.token, 'cv2', 'HACKED');
  await del(A.token, 'cv4'); await save(A.token, 'junk', 'JUNK');
  const r4 = await admin('backup-restore', { handle: 'artist', at: tSafe });
  note(same(await seen(A.token), safe), `rolling back an attack: ${JSON.stringify(r4.body)} -> ${JSON.stringify(await seen(A.token))}`);
  // ...and the restore itself can be undone.
  const tAttacked = clock - 1;
  const undo = await admin('backup-restore', { handle: 'artist', at: tAttacked });
  const undone = await seen(A.token);
  note(undo.status === 200 && undone.cv1 === 'HACKED' && undone.junk === 'JUNK' && !undone.cv4, `undoing a restore: ${JSON.stringify(undone)}`);
  await admin('backup-restore', { handle: 'artist', at: tSafe });
  note(same(await seen(A.token), safe), 'redoing the restore');
  console.log('attack: overwrites, a delete and junk rolled back; the restore undone and redone');

  // ---- 5. the index itself wiped ---------------------------------------
  clock += DAY;
  await save(A.token, 'cv5', 'cv5-day5');     // first save of the day: a snapshot of what stood
  const before5 = await seen(A.token);
  const tWipe = clock;
  await writeFile(join(SCRATCH, 'sketch/canvases/artist/index.json'), '{}');
  note(Object.keys(await seen(A.token)).length === 0, 'the wiped index still listed canvases');
  const r5 = await admin('backup-restore', { handle: 'artist', at: tWipe - 1 });
  const got5 = await seen(A.token);
  // cv5's day-5 save came after the snapshot and its record died with the
  // index: the snapshot's cv5 is what a snapshot can give back.
  note(r5.status === 200 && Object.keys(got5).length === Object.keys(before5).length && got5.cv1 === before5.cv1,
    `a wiped index was not recovered from snapshots: ${JSON.stringify(r5.body)} -> ${JSON.stringify(got5)}`);
  console.log(`index wiped to {}: ${Object.keys(got5).length} canvases recovered from snapshots alone`);

  // ---- 6. admin only ------------------------------------------------------
  note((await post({ action: 'backup-status', handle: 'artist' })).status === 401, 'backup-status without admin');
  note((await post({ action: 'backup-restore', admin: A.token, handle: 'artist', at: 0 })).status === 401, 'a user token restored');
  const st = await admin('backup-status', { handle: 'artist' });
  note(st.status === 200 && st.body.snapshots.length >= 3 && st.body.canvases.length === 5, `backup-status: ${JSON.stringify(st.body).slice(0, 200)}`);

  // ---- 7. a deleted account --------------------------------------------
  clock += DAY;
  const B = (await post({ action: 'signup', handle: 'leaver', password: 'correct horse' })).body;
  await save(B.token, 'bv1', 'bv1'); await save(B.token, 'bv2', 'bv2');
  await post({ action: 'follow', token: B.token, handle: 'artist', on: true });
  const kept = await seen(B.token);
  const gone = await post({ action: 'delete-account', token: B.token, password: 'correct horse' });
  note(gone.status === 200 && (await post({ action: 'canvases', token: B.token })).status === 401
       && (await store.listCanvases('leaver')).length === 0, 'a deleted account still answers');
  const un = await admin('backup-undelete', { handle: 'leaver' });
  const back = (await post({ action: 'login', handle: 'leaver', password: 'correct horse' })).body;
  note(un.status === 200 && back.token && same(await seen(back.token), kept), `undelete: ${JSON.stringify(un.body)}, login ${!!back.token}, ${JSON.stringify(back.token && await seen(back.token))}`);
  const fol = (await post({ action: 'following', token: back.token })).body;
  note(fol.following && fol.following.includes('artist'), `undelete lost the follows: ${JSON.stringify(fol)}`);
  console.log('account deleted: gone from the site, then back with its password, canvases and follows');

  // ---- 8. rename, then restore the old name's canvases onto the new ------
  clock += DAY;
  const C = (await post({ action: 'signup', handle: 'oldname', password: 'correct horse' })).body;
  await save(C.token, 'kv1', 'kv1-v1'); const tK = clock; await save(C.token, 'kv1', 'kv1-v2');
  const ren = (await post({ action: 'rename', token: C.token, handle: 'newname' })).body;
  note((await seen(ren.token)).kv1 === 'kv1-v2', 'the rename did not move the canvas');
  const r8 = await admin('backup-restore', { handle: 'newname', from: 'oldname', at: tK });
  note(r8.status === 200 && (await seen(ren.token)).kv1 === 'kv1-v1', `restoring across a rename: ${JSON.stringify(r8.body)}`);
  console.log('rename: an old version from @oldname restored onto @newname');

  // ---- 9. the purge: 30 days, and not a byte of whoever took the name ------
  clock += DAY;
  const D = (await post({ action: 'signup', handle: 'gone', password: 'correct horse' })).body;
  await save(D.token, 'gv1', 'gv1'); clock += DAY; await save(D.token, 'gv1', 'g1b');
  await post({ action: 'delete-account', token: D.token, password: 'correct horse' });
  const E = (await post({ action: 'signup', handle: 'gone', password: 'another horse' })).body;
  await save(E.token, 'ev1', 'ev1-new-owner');
  note((await call('GET', { query: { cron: 'backup' } })).body.purged.length === 0, 'the purge ran early');
  process.env.CRON_SECRET = 'cron-secret';
  note((await call('GET', { query: { cron: 'backup' } })).status === 401, 'the cron ran without its secret');
  clock += 31 * DAY;
  const pg = await call('GET', { query: { cron: 'backup' }, headers: { authorization: 'Bearer cron-secret' } });
  delete process.env.CRON_SECRET;
  const leftG = (await files('sketch/canvases/gone')).filter((k) => !k.includes('/ev1-') && !k.endsWith('index.json'));
  const leftSnaps = (await files('sketch-backup/gone')).filter((k) => !k.includes('2026-'));
  note(pg.status === 200 && pg.body.purged.some((p) => p.handle === 'gone') && leftG.length === 0, `the purge left: ${JSON.stringify(leftG)} ${JSON.stringify(pg.body)}`);
  note((await seen(E.token)).ev1 === 'ev1-new-owner', 'the purge took the new owner\'s canvas');
  note(leftSnaps.length === 0, 'snapshots left');
  note(!(await store.io.readJson('sketch/trash.json')).some((t) => t.handle === 'gone'), 'the trash still lists the purged account');
  console.log(`purge: @gone's ${pg.body.purged.find((p) => p.handle === 'gone').keys} blobs removed after 30 days; the new @gone kept hers`);

  // ---- 10. 120 days of daily work stays bounded --------------------------
  let F = (await post({ action: 'signup', handle: 'daily', password: 'correct horse' })).body;
  const marks = [];
  for (let d = 0; d < 120; d++) {
    clock += DAY;
    if (d % 60 === 59) F.token = (await post({ action: 'login', handle: 'daily', password: 'correct horse' })).body.token;
    for (let i = 0; i < 6; i++) { clock += 20 * 60 * 1000; await save(F.token, 'fv1', `fv1-d${d}-${i}`); }
    marks.push({ at: clock, label: `fv1-d${d}-5` });
  }
  const idx = await store.io.readJson('sketch/canvases/daily/index.json');
  const m = idx['~meta'];
  const pngs = (await files('sketch/canvases/daily')).filter((k) => k.endsWith('.png'));
  const snapFiles = await files('sketch-backup/daily');
  note(m.snaps.length <= 15 && snapFiles.length === m.snaps.length, `snapshots not bounded: ${m.snaps.length} in the ledger, ${snapFiles.length} on disk`);
  note(pngs.length <= 1 + m.retired.length && pngs.length <= 40, `retired versions not bounded: ${pngs.length} PNGs, ${m.retired.length} retired`);
  // Every kept snapshot can still be restored: the version it names exists.
  let broken = 0;
  for (const s of m.snaps) {
    const snap = await store.io.readJson(s.key);
    for (const c of Object.values(snap.index)) if (!(await store.io.backend().read(`sketch/canvases/daily/${c.id}-${c.v}.png`))) broken++;
  }
  note(broken === 0, `${broken} kept snapshot(s) name versions that were collected`);
  // The oldest snapshot kept is months back, and restores to what it holds.
  const oldest = [...m.snaps].sort((a, b) => a.at - b.at)[0];
  const held = Object.values((await store.io.readJson(oldest.key)).index)[0];
  // A snapshot is the account as it stood just BEFORE the write that took it.
  const r10 = await admin('backup-restore', { handle: 'daily', at: oldest.at - 1, dry: true });
  note(clock - oldest.at > 60 * DAY && r10.status === 200 && r10.body.restored.length === 1 && r10.body.restored[0].v === held.v,
    `a restore ${Math.round((clock - oldest.at) / DAY)} days back: ${JSON.stringify(r10.body)} wanted v${held.v}`);
  // A week back, to the hour: the retired versions.
  const r10b = await admin('backup-restore', { handle: 'daily', at: clock - 30 * 60 * 1000 });
  note((await seen(F.token)).fv1 === 'fv1-d119-3', `half an hour back: ${JSON.stringify(r10b.body)} -> ${JSON.stringify(await seen(F.token))}`);
  console.log(`120 days, 720 saves: ${m.snaps.length} snapshots and ${pngs.length} PNGs kept, every snapshot restorable, ${Math.round((clock - oldest.at) / DAY)} days back to a snapshot, 30 minutes back to the save`);

  // ---- 11. the Blob backend's list() follows the cursor -----------------
  {
    const blobPath = require.resolve('@vercel/blob');
    const real = require.cache[blobPath];
    const pages = { undefined: { blobs: [{ pathname: 'p/a' }, { pathname: 'p/c' }], hasMore: true, cursor: 'n2' },
                    n2: { blobs: [{ pathname: 'p/b' }], hasMore: false } };
    require.cache[blobPath] = { id: blobPath, filename: blobPath, loaded: true, exports: { list: async ({ cursor }) => pages[cursor] } };
    delete process.env.NOTES_DEV_DIR;
    process.env.BLOB_READ_WRITE_TOKEN = 'stub';
    const listed = await store.io.backend().list('p/');
    process.env.NOTES_DEV_DIR = SCRATCH;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    if (real) require.cache[blobPath] = real; else delete require.cache[blobPath];
    note(JSON.stringify(listed) === '["p/a","p/b","p/c"]', `blob list() over two pages: ${JSON.stringify(listed)}`);
  }
} catch (err) {
  failed++; console.error(err);
} finally {
  await rm(SCRATCH, { recursive: true, force: true });
}
console.log(`\nbackup_check: ${checks - failed} of ${checks} checks passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
