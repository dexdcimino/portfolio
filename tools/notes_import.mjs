/* Add whole sessions to the notes store from a JSON file.
 *
 *   node tools/notes_import.mjs <seed.json>                  # dry run, LIVE store
 *   node tools/notes_import.mjs <seed.json> --write          # actually write
 *   node tools/notes_import.mjs <seed.json> --dev .notes-dev # the scratch store
 *
 * WHY THIS EXISTS. Three sessions of notes were written as standalone HTML
 * pages before the notes app existed. Retyping them into the editor is hours
 * of work and would still get the structure wrong in places; pasting them in
 * loses the category boundaries entirely, because a category is a row in the
 * sidebar and not a heading in a body. So the sessions are authored as JSON
 * and appended by a tool that can be read, re-read and refused.
 *
 * IT RUNS THE SERVER'S OWN CODE, the way tools/notes_rescue.mjs does:
 * readNotes() and writeNotes() from lib/notes-store.js, not a re-implementation.
 * That is what gets the rev check for free -- the write carries the rev it
 * read, so a save from Dex's browser between the read and the write comes back
 * as a conflict and NOTHING is written, rather than the import silently
 * winning the whole document.
 *
 * DEX MUST HAVE THE NOTES OVERLAY CLOSED WHILE THIS RUNS. The rev check makes
 * a collision safe, not impossible: a tab left open autosaves, and the save
 * that loses is whichever one went second. The tool prints this too.
 *
 * WHAT IT REFUSES
 *   - the live store with NOTES_DEV_DIR set (rescue's reason: a production
 *     tool that quietly reads a scratch directory is worse than no tool)
 *   - the live store with no BLOB_READ_WRITE_TOKEN
 *   - a store whose document is still the pre-rebuild HTML: there is no
 *     document to append to until the app has been opened once
 *   - a session whose title already exists, so a second run cannot duplicate
 *   - --write with any body this has not verified through the REAL clean()
 *
 * THAT LAST ONE IS THE POINT OF THE BODY CHECK. `body` is schema HTML
 * (notes/schema.js), and a body that clean() rewrites will look different
 * after the first reload than it did when it was imported -- which reads as
 * the import being broken. clean() needs a DOM, so the check runs the shipped
 * module in a real browser against tools/notes_dev_server.mjs and asserts
 * clean(body) === body byte for byte. No server, no --write.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const require = createRequire(import.meta.url);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

// The first bare argument that is not some flag's value. indexOf() would find
// the FIRST copy of a repeated string, which is how "--dev x --check-url x"
// ends up importing a file called x.
const TAKES_VALUE = new Set(['--dev', '--check-url']);
let seedPath = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { if (TAKES_VALUE.has(argv[i])) i++; continue; }
  seedPath = argv[i];
  break;
}
const write = has('--write');
const devDir = has('--dev') ? resolve(arg('--dev', '.notes-dev')) : null;
const checkUrl = arg('--check-url', 'http://127.0.0.1:8123');
const skipBodies = has('--no-body-check');

if (!seedPath) {
  console.error('usage: node tools/notes_import.mjs <seed.json> [--write] [--dev <dir>] [--check-url <url>]');
  process.exit(2);
}
if (skipBodies && write) {
  console.error('--no-body-check cannot be combined with --write. A body clean() would rewrite\n'
    + 'looks different after the first reload than it did when it was imported.');
  process.exit(2);
}

/* ---- which store ---------------------------------------------------------- */

if (devDir) {
  process.env.NOTES_DEV_DIR = devDir;
  console.log(`THE SCRATCH STORE at ${devDir} — not production.\n`);
} else {
  if (process.env.NOTES_DEV_DIR) {
    console.error('NOTES_DEV_DIR is set. Unset it, or pass --dev <dir> to say you meant the scratch store.');
    process.exit(2);
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('BLOB_READ_WRITE_TOKEN is not set.\n'
      + '  Vercel > the project > Storage > the blob store > .env.local,\n'
      + '  or:  vercel env pull .env.local   then export it into this shell.');
    process.exit(2);
  }
  console.log('THE LIVE STORE.\n');
}

const store = require(resolve(ROOT, 'lib/notes-store.js'));

/* ---- the seed ------------------------------------------------------------- */

/* The shape a session must already be in. `normalize()` in notes/state.js
 * would fix a sloppy one, but it lives in the browser and it runs AFTER the
 * bytes are in the store -- so a field it silently replaces is a field that
 * was imported wrong and nobody saw. Everything is checked here instead. */
const HEX = /^#[0-9a-f]{6}$/;
const isStr = (v) => typeof v === 'string';

function validate(seed) {
  const bad = [];
  if (!seed || !Array.isArray(seed.sessions) || !seed.sessions.length) {
    bad.push('the seed has no `sessions` array');
    return bad;
  }
  seed.sessions.forEach((s, i) => {
    const at = `session ${i + 1}`;
    if (!isStr(s.title) || !s.title.trim()) bad.push(`${at}: no title`);
    if (s.emoji !== undefined && !isStr(s.emoji)) bad.push(`${at}: emoji is not a string`);
    if (!isStr(s.color) || !HEX.test(s.color)) bad.push(`${at}: color ${JSON.stringify(s.color)} is not lower-case #rrggbb`);
    if (!Array.isArray(s.cats) || !s.cats.length) bad.push(`${at}: no categories`);
    (s.cats || []).forEach((c, j) => {
      const cat = `${at} / category ${j + 1} (${c && c.title})`;
      if (!isStr(c.title) || !c.title.trim()) bad.push(`${cat}: no title`);
      if (c.title && c.title.length > 80) bad.push(`${cat}: title is over 80 characters and would be cut`);
      if (!isStr(c.color) || !HEX.test(c.color)) bad.push(`${cat}: color ${JSON.stringify(c.color)} is not lower-case #rrggbb`);
      if (!isStr(c.body) || !c.body) bad.push(`${cat}: no body`);
    });
  });
  return bad;
}

const seed = JSON.parse(await readFile(resolve(seedPath), 'utf8'));
const problems = validate(seed);
if (problems.length) {
  console.error(`the seed is not importable:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

/* ---- what is there now ---------------------------------------------------- */

const current = await store.readNotes();
if (current.format !== 'json') {
  console.error(`the store's document is ${current.seeded ? 'the seed' : 'the pre-rebuild HTML'}, not JSON.\n`
    + 'Open the notes once in a browser so the migration writes current.json, then run this again.');
  process.exit(1);
}
const doc = current.content;
if (!doc || !Array.isArray(doc.sessions)) {
  console.error('the document has no sessions array — refusing to touch it');
  process.exit(1);
}

const existingTitles = new Set(doc.sessions.map((s) => String(s.title || '').trim().toLowerCase()));
const clash = seed.sessions.filter((s) => existingTitles.has(s.title.trim().toLowerCase()));
if (clash.length) {
  console.error(`already in the store: ${clash.map((s) => `"${s.title}"`).join(', ')}\n`
    + 'Refusing rather than importing a second copy. Rename, or delete the one that is there.');
  process.exit(1);
}

/* Ids must not collide with anything already in the document, or a rename
 * lands on two rows at once. normalize() would re-id the duplicate on load,
 * which fixes the symptom in the browser and leaves the store holding two
 * things with one name until then. */
const usedIds = new Set();
for (const s of doc.sessions) {
  usedIds.add(s.id);
  for (const c of [...(s.cats || []), ...(s.archived || [])]) usedIds.add(c.id);
}
let seq = 0;
function newId(prefix) {
  let id;
  do { id = `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}i`; } while (usedIds.has(id));
  usedIds.add(id);
  return id;
}

const stamp = new Date().toISOString();
const built = seed.sessions.map((s) => ({
  id: newId('s'),
  title: s.title,
  emoji: s.emoji || '',
  color: s.color,
  created: stamp,
  updated: stamp,
  cats: s.cats.map((c) => ({
    id: newId('c'),
    title: c.title,
    emoji: c.emoji || '',
    color: c.color,
    collapsed: !!c.collapsed,
    body: c.body,
    updated: stamp,
  })),
  archived: [],
}));

/* ---- the bodies, through the REAL clean() --------------------------------- */

/* COUNT THE SUBJECT (CLAUDE.md). A check that verifies no bodies passes
 * exactly like one that verifies all of them, so the number examined is
 * printed and asserted against the number there are. */
async function checkBodies(sessions) {
  const bodies = [];
  for (const s of sessions) for (const c of s.cats) bodies.push({ where: `${s.title} / ${c.title}`, body: c.body });
  if (!bodies.length) return { ok: false, why: 'there are no bodies to check' };

  const CHROME = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find((p) => p && existsSync(p));
  if (!CHROME) return { ok: false, why: 'no Chrome or Edge found — set CHROME=<path to the exe>' };

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    // Same origin as the app, so the module graph resolves the way it does
    // in the overlay. A data: or file: page cannot import './dom.js'.
    const res = await page.goto(`${checkUrl}/`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
    if (!res || !res.ok()) {
      return { ok: false, why: `no dev server at ${checkUrl} — start it:  node tools/notes_dev_server.mjs --port ${new URL(checkUrl).port || 80}` };
    }
    const out = await page.evaluate(async (list) => {
      const { clean, serialize } = await import('/notes/schema.js');
      const results = [];
      for (const item of list) {
        const cleaned = clean(item.body);
        // ...and back out of a live DOM again, which is the round trip a save
        // actually makes: clean() on load, serialize() on save. A body that
        // survives one and not the other still drifts on the first edit.
        const holder = document.createElement('div');
        holder.innerHTML = cleaned;
        const round = serialize(holder);
        results.push({ where: item.where, cleanOk: cleaned === item.body, roundOk: round === item.body, cleaned, round });
      }
      return results;
    }, bodies);

    const bad = out.filter((r) => !r.cleanOk || !r.roundOk);
    return { ok: !bad.length, checked: out.length, bad };
  } finally {
    await browser.close();
  }
}

let verified = 0;
if (skipBodies) {
  console.log('bodies: NOT CHECKED (--no-body-check). This cannot be combined with --write.\n');
} else {
  const r = await checkBodies(built);
  if (r.why) { console.error(`body check could not run: ${r.why}`); process.exit(1); }
  if (!r.ok) {
    console.error(`${r.bad.length} of ${r.checked} bodies are not schema HTML. clean() would rewrite them,\n`
      + 'so the import would look different after the first reload than it did going in:\n');
    for (const b of r.bad.slice(0, 6)) {
      console.error(`  ${b.where}  ${b.cleanOk ? 'survives clean() but not serialize()' : 'clean() rewrote it'}`);
      console.error(`    got:  ${(b.cleanOk ? b.round : b.cleaned).slice(0, 240)}`);
    }
    process.exit(1);
  }
  verified = r.checked;
  console.log(`bodies: ${verified} checked, all byte-identical through clean() and serialize()\n`);
}

/* ---- the report ----------------------------------------------------------- */

const bytes = (s) => Buffer.byteLength(s, 'utf8');
console.log(`store: rev ${current.rev}, ${doc.sessions.length} session(s) — none of them touched:`);
for (const s of doc.sessions) console.log(`  keep  ${String(s.title).padEnd(24)} ${(s.cats || []).length} categor(ies)`);

console.log(`\nappending ${built.length} session(s):`);
let total = 0;
for (const s of built) {
  const size = s.cats.reduce((n, c) => n + bytes(c.body), 0);
  total += size;
  console.log(`  add   ${s.title.padEnd(24)} ${s.emoji || '-'}  ${s.cats.length} categor(ies), ${size} B of body`);
  for (const c of s.cats) console.log(`          ${c.title.padEnd(30)} ${String(bytes(c.body)).padStart(6)} B`);
}
const after = JSON.stringify({ ...doc, sessions: [...doc.sessions, ...built] });
console.log(`\ndocument: ${bytes(JSON.stringify(doc))} B -> ${bytes(after)} B (+${total} B of bodies), limit ${store.MAX_BYTES} B`);

if (!write) {
  console.log('\nDRY RUN. Nothing was written. Add --write to do it.');
  console.log('Close the notes overlay in every browser first: a tab left open autosaves,');
  console.log('and the rev check makes a collision safe, not impossible.');
  process.exit(0);
}

/* ---- the write, and only now ---------------------------------------------- */

console.log('\nwriting…');
const result = await store.writeNotes({ ...doc, sessions: [...doc.sessions, ...built] }, current.rev);
if (result.conflict) {
  console.error(`CONFLICT: the store moved to rev ${result.rev} while this was running — nothing was written.\n`
    + 'Something saved between the read and the write, which is almost always a notes tab\n'
    + 'left open. Close it and run this again.');
  process.exit(1);
}
console.log(`written: rev ${current.rev} -> ${result.rev} at ${result.savedAt}`);
console.log(`  ${result.backups} ten-minute copy/copies, ${result.daily} daily behind it`);

const back = await store.readNotes();
const titles = back.content.sessions.map((s) => s.title);
console.log(`\nnow: rev ${back.rev}, ${titles.length} session(s): ${titles.join(', ')}`);
const missing = built.filter((s) => !titles.includes(s.title));
if (missing.length) {
  console.error(`read back WITHOUT ${missing.map((s) => s.title).join(', ')} — the write did not take`);
  process.exit(1);
}
console.log('read back with every imported session present.');
