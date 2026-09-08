/* Look at the LIVE notes store, and put a backup back if the current document
 * is broken.
 *
 *   set BLOB_READ_WRITE_TOKEN=...        (or: vercel env pull .env.local)
 *   node tools/notes_rescue.mjs                 # read-only: what is there
 *   node tools/notes_rescue.mjs --restore newest
 *   node tools/notes_rescue.mjs --restore notes/daily/2026-09-07.json
 *
 * WHY THIS EXISTS. The overlay says SERVER ERROR when the password was
 * ACCEPTED and reading the document then failed -- unlock.js checks the
 * password first and only fills in `detail` after it passes. So "SERVER ERROR"
 * is never a wrong password; it is `store.read('notes/current.json')` or
 * parseWrapper() throwing, and the two are worth telling apart before touching
 * anything. There was no way to look without deploying a change, which is the
 * worst possible moment to be deploying changes.
 *
 * IT RUNS THE SERVER'S OWN CODE. lib/notes-store.js is required directly, not
 * re-implemented, so what this reports is what the route would do -- including
 * the get() shape that has already caused two separate incidents (see the
 * comments in blobBackend.readBytes).
 *
 * READ-ONLY UNLESS ASKED. --restore is the only path that writes, it says
 * exactly what it is about to overwrite and with what, and it writes the
 * current document to a fresh backup first, so a restore is itself undoable.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/* NOT the dev backend. This tool exists to look at the real store, and
   lib/notes-store.js silently prefers the filesystem when NOTES_DEV_DIR is
   set -- which would make this print a clean bill of health for a directory
   nobody is asking about. */
if (process.env.NOTES_DEV_DIR) {
  console.error('NOTES_DEV_DIR is set. Unset it: this tool is for the live store.');
  process.exit(2);
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN is not set.\n'
    + '  Vercel > the project > Storage > the blob store > .env.local,\n'
    + '  or:  vercel env pull .env.local   then export it into this shell.');
  process.exit(2);
}

const store = require(resolve(ROOT, 'lib/notes-store.js'));
const { get, list, put } = require('@vercel/blob');

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const restore = process.argv.includes('--restore') ? (arg('--restore') || 'newest') : null;

/* Read a key the way the route does, and report HOW it failed rather than
 * only that it did -- "not valid JSON" and "the blob call threw" are two
 * different problems with two different answers. */
async function look(key) {
  let found;
  try {
    found = await get(key, { access: 'private', useCache: false });
  } catch (err) {
    return { key, state: 'threw', why: `${err.name || 'Error'}: ${err.message}` };
  }
  if (!found) return { key, state: 'missing' };
  if (!found.stream) return { key, state: 'no-stream', why: `statusCode ${found.statusCode}` };
  const text = Buffer.from(await new Response(found.stream).arrayBuffer()).toString('utf8');
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    return { key, state: 'bad-json', bytes: text.length, why: err.message, head: text.slice(0, 120), tail: text.slice(-120) };
  }
  const shaped = doc && typeof doc === 'object' && typeof doc.rev === 'number' && 'doc' in doc;
  return {
    key, state: shaped ? 'ok' : 'bad-shape', bytes: text.length,
    rev: doc && doc.rev, savedAt: doc && doc.savedAt,
    sessions: doc && doc.doc && Array.isArray(doc.doc.sessions) ? doc.doc.sessions.length : null,
    cats: doc && doc.doc && Array.isArray(doc.doc.sessions)
      ? doc.doc.sessions.reduce((n, s) => n + (Array.isArray(s.cats) ? s.cats.length : 0), 0) : null,
    keys: doc && typeof doc === 'object' ? Object.keys(doc).join(', ') : null,
  };
}

const line = (r) => {
  if (r.state === 'ok') return `ok        ${String(r.bytes).padStart(8)} B  rev ${r.rev}  ${r.savedAt || '-'}  ${r.sessions} session(s), ${r.cats} categor(ies)`;
  if (r.state === 'missing') return 'missing';
  if (r.state === 'bad-json') return `BAD JSON  ${r.bytes} B — ${r.why}\n            starts: ${JSON.stringify(r.head)}\n            ends:   ${JSON.stringify(r.tail)}`;
  if (r.state === 'bad-shape') return `BAD SHAPE ${r.bytes} B — top-level keys: ${r.keys}`;
  if (r.state === 'no-stream') return `NO STREAM — ${r.why}`;
  return `THREW — ${r.why}`;
};

console.log(`live store, via ${store.CURRENT.split('/')[0]}/\n`);
const current = await look(store.CURRENT);
console.log(`${store.CURRENT.padEnd(28)} ${line(current)}`);

const legacy = await look(store.LEGACY).catch(() => ({ state: 'missing' }));
console.log(`${store.LEGACY.padEnd(28)} ${legacy.state === 'ok' || legacy.state === 'bad-json' ? 'present (pre-rebuild HTML)' : legacy.state}`);

/* Every copy, newest first, each one CHECKED rather than merely listed: a
 * backup that is itself unreadable is not a backup, and finding that out
 * during a restore is finding it out too late. */
const copies = [];
for (const dir of [store.BACKUP_DIR, store.DAILY_DIR]) {
  const found = await list({ prefix: dir });
  for (const b of found.blobs.filter((b) => b.pathname.endsWith('.json'))) copies.push(b.pathname);
}
copies.sort().reverse();
console.log(`\n${copies.length} backup(s), newest first:`);
const checked = [];
for (const key of copies) {
  const r = await look(key);
  checked.push(r);
  console.log(`  ${key.padEnd(44)} ${line(r)}`);
}

const good = checked.filter((r) => r.state === 'ok');
if (current.state === 'ok') {
  console.log('\nThe current document reads clean. A SERVER ERROR with this state is not the document —\n'
    + 'check the browser console line "notes: unlock failed" for what the route actually said.');
} else {
  console.log(`\nThe current document is ${current.state.toUpperCase()}. That is what SERVER ERROR is reporting.`);
  console.log(good.length
    ? `Newest readable backup: ${good[0].key} (rev ${good[0].rev}, ${good[0].sessions} session(s)).\n`
      + `  node tools/notes_rescue.mjs --restore newest`
    : 'No readable backup either. Do not write anything: get the raw bytes out first.');
}

if (!restore) process.exit(current.state === 'ok' ? 0 : 1);

/* ---- the write, and only now ---------------------------------------------- */
const pick = restore === 'newest' ? (good[0] && good[0].key) : restore;
if (!pick) { console.error('\nnothing to restore from'); process.exit(1); }
const from = checked.find((r) => r.key === pick) || await look(pick);
if (from.state !== 'ok') { console.error(`\n${pick} is ${from.state} — refusing to restore from it`); process.exit(1); }

console.log(`\nrestoring ${pick} -> ${store.CURRENT}`);
console.log(`  from: rev ${from.rev}, ${from.sessions} session(s), ${from.cats} categor(ies), ${from.savedAt || 'no time'}`);
console.log(`  over: ${line(current)}`);

// The current bytes are kept first, whatever state they are in: a restore that
// throws away the only copy of a damaged document throws away the evidence.
if (current.state !== 'missing') {
  const raw = await get(store.CURRENT, { access: 'private', useCache: false });
  if (raw && raw.stream) {
    const bytes = Buffer.from(await new Response(raw.stream).arrayBuffer());
    const keep = `${store.BACKUP_DIR}before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    await put(keep, bytes, { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 });
    console.log(`  kept the current bytes at ${keep}`);
  }
}

const src = await get(pick, { access: 'private', useCache: false });
const body = Buffer.from(await new Response(src.stream).arrayBuffer());
await put(store.CURRENT, body, { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 });

const after = await look(store.CURRENT);
console.log(`\nnow: ${line(after)}`);
process.exit(after.state === 'ok' ? 0 : 1);
