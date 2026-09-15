/* Drive the TUNES door: the live playlist, its backups, and editing it.
 *
 *   node tools/music_admin_check.mjs      # starts its own server, needs nothing
 *
 * THREE LAYERS, each of which can be wrong on its own.
 *
 * 1. THE STORE, in-process. The id parser and its refusals, the title guess,
 *    the password fold, token expiry, and the backup tiers on a real directory:
 *    forty-five edits must leave exactly forty per-edit copies and one daily,
 *    an empty list must be refused, and a playlist file that does not parse
 *    must be an ERROR rather than a quiet fall back to the seed -- the one path
 *    that would undo every edit ever made.
 *
 * 2. THE API over HTTP, against the real handler. Reading is public; every
 *    edit without a token is refused; add, the duplicate, repeat, remove, the
 *    backup list and a restore that is itself backed up.
 *
 * 3. TWO BROWSERS. One through MUSIC -- read-only, ticks disabled, no minus --
 *    and one through TUNES, which adds a song through the form, deletes one
 *    with two presses, ticks one onto REPEAT, and has every one of those turn
 *    up on the MUSIC screen without a reload.
 *
 * A ROOM OF ITS OWN, like chess_check: the dev server keeps the playlist under
 * its --dir, so a scratch directory is a fresh store seeded from tracks.json.
 * MUSIC_LOOKUP_OFFLINE keeps YouTube out of it -- whether oEmbed answers is not
 * a fact about this site.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const PORT = 8100 + ((process.pid + Date.now()) % 300);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found — set CHROME=<path to the exe>');

const fail = [];
let pass = 0;
const note = (ok, why) => { if (ok) pass++; else fail.push(why); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEED = require(join(ROOT, 'assets/music/tracks.json'));
const SEEDN = SEED.tracks.length;
const SEEDR = SEED.tracks.filter((t) => t.r).length;

const scratches = [];
const scratch = (tag) => { const d = mkdtempSync(join(tmpdir(), `tunes-${tag}-`)); scratches.push(d); return d; };

/* ---- 1. the store ---------------------------------------------------------- */
{
  process.env.NOTES_DEV_DIR = scratch('unit');
  process.env.TUNES_PASSWORD = 'tunes';
  delete process.env.VERCEL_ENV;
  const store = require(join(ROOT, 'lib/music-store.js'));

  const IDS = [
    ['https://youtu.be/6KkryIC0DEk?list=RD6KkryIC0DEk', '6KkryIC0DEk'],
    ['https://www.youtube.com/watch?v=Ngng8UyyaGQ&t=30s', 'Ngng8UyyaGQ'],
    ['youtube.com/shorts/IB1MlSvHq58', 'IB1MlSvHq58'],
    ['https://music.youtube.com/watch?v=sVx1mJDeUjY', 'sVx1mJDeUjY'],
    ['6KkryIC0DEk', '6KkryIC0DEk'],
    ['https://www.youtube.com/playlist?list=PL123', null],
    ['https://vimeo.com/123456789', null],
    ['not a link at all', null],
  ];
  note(IDS.filter(([, want]) => want === null).length === 3, 'the id table lost a refusal');
  for (const [input, want] of IDS) {
    note(store.parseId(input) === want, `parseId(${input}) gave ${store.parseId(input)}, wanted ${want}`);
  }
  const g = store.guess('Iron Jarl - Natty or Not (Official Music Video) | No Talk. Just Work.', 'Iron Jarl');
  note(g.a === 'Iron Jarl' && g.t === 'Natty or Not', `the title guess read ${JSON.stringify(g)}`);

  note(await store.passwordOk('TUNES') && await store.passwordOk('tunes'), 'the code is not case-folded like the vault folds it');
  note(!(await store.passwordOk('tune')) && !(await store.passwordOk('')), 'a wrong code unlocked editing');
  const tok = store.mintToken();
  note(store.tokenOk(tok), 'a fresh token is refused');
  note(!store.tokenOk(`${tok}x`), 'a tampered token is accepted');
  note(!store.tokenOk(store.mintToken(Date.now() - 13 * 3600 * 1000)), 'a token past its twelve hours is accepted');

  let doc = await store.read();
  note(doc.seeded && doc.tracks.length === SEEDN, `the first read is ${doc.tracks.length} tracks, seeded ${doc.seeded}`);

  /* FORTY-FIVE EDITS. Five past the per-edit cap, so pruning has to run, and
     all on one day, so the daily tier has to hold exactly one. */
  for (let i = 0; i < 45; i++) {
    const next = doc.tracks.map((t, k) => (k === 0 ? { ...t, r: i % 2 === 0 } : t));
    doc = await store.write(doc, next);
  }
  const dir = process.env.NOTES_DEV_DIR;
  const edits = readdirSync(join(dir, 'music/backups')).length;
  const days = readdirSync(join(dir, 'music/daily')).length;
  note(doc.rev === 45, `45 edits left rev ${doc.rev}`);
  note(edits === store.BACKUP_KEEP, `${edits} per-edit backups after 45 edits, expected ${store.BACKUP_KEEP}`);
  note(days === 1, `${days} daily backups after one day of edits, expected 1`);

  let threw = false;
  try { await store.write(doc, []); } catch { threw = true; }
  note(threw, 'an empty playlist was saved');
  note(await store.readBackup('../../etc/passwd') === null, 'a path outside the backups was read');
  const list = await store.listBackups();
  note(list.length === 41 && list[0].label > list[list.length - 1].label, `the backup list has ${list.length} entries, newest first`);
  note((await store.readBackup(list[0].name) || []).length === SEEDN, 'the newest backup does not read back');

  /* A PLAYLIST THAT DOES NOT PARSE IS AN ERROR. Falling back to the seed here
     would silently undo every edit ever made, which is the one outcome the
     backups cannot fix because nobody would know to use them. */
  writeFileSync(join(dir, 'music/playlist.json'), '{ this is not json');
  let broken = false;
  try { await store.read(); } catch { broken = true; }
  note(broken, 'a corrupt playlist quietly fell back to the seed');
  console.log(`store: ${IDS.length} links parsed, 45 edits -> ${edits} edit backups + ${days} daily, corrupt file refused`);
}

/* ---- 2. the API ------------------------------------------------------------- */

const serverDir = scratch('api');
const server = spawn(process.execPath,
  [join(ROOT, 'tools/notes_dev_server.mjs'), '--port', String(PORT), '--dir', serverDir],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MUSIC_LOOKUP_OFFLINE: '1', TUNES_PASSWORD: 'tunes' } });
server.stderr.on('data', (d) => { if (/EADDRINUSE|Error/.test(String(d))) console.error('dev server: ' + String(d).trim()); });
const stop = () => {
  if (!server.killed) server.kill();
  for (const d of scratches) { try { rmSync(d, { recursive: true, force: true }); } catch { /* temp */ } }
};
process.on('exit', stop);

const api = async (body) => {
  const res = body
    ? await fetch(`${BASE}/api/music/playlist`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    : await fetch(`${BASE}/api/music/playlist`);
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
};

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try { up = (await api()).status === 200; } catch { await sleep(250); }
}
if (!up) { console.error(`music_admin_check: the dev server never answered at ${BASE}`); stop(); process.exit(1); }

let TOKEN = null;
{
  let r = await api();
  note(r.data.count === SEEDN && r.data.seeded, `GET is ${r.data.count} tracks, seeded ${r.data.seeded}`);
  r = await api({ action: 'add', url: 'HarnessTst1', t: 'T', a: 'A' });
  note(r.status === 401, `an add with no token came back ${r.status}`);
  r = await api({ action: 'unlock', code: 'nope' });
  note(r.status === 401 && !r.data.token, `a wrong code came back ${r.status}`);
  r = await api({ action: 'unlock', code: 'TUNES' });
  note(r.status === 200 && !!r.data.token, `TUNES came back ${r.status}`);
  TOKEN = r.data.token;

  r = await api({ action: 'lookup', token: TOKEN, url: 'https://vimeo.com/1' });
  note(r.status === 400, `a Vimeo link looked up as ${r.status}`);
  r = await api({ action: 'lookup', token: TOKEN, url: SEED.tracks[3].u });
  note(r.status === 200 && r.data.already === true, 'a link already in the list was not called out');
  r = await api({ action: 'add', token: TOKEN, url: 'HarnessTst1', t: '', a: 'A' });
  note(r.status === 400, `an add with no title came back ${r.status}`);
  r = await api({ action: 'add', token: TOKEN, url: 'https://youtu.be/HarnessTst1', t: 'Harness Song', a: 'Harness Band' });
  note(r.status === 200 && r.data.count === SEEDN + 1 && !r.data.seeded, `the add came back ${r.status} with ${r.data && r.data.count}`);
  r = await api({ action: 'add', token: TOKEN, url: 'HarnessTst1', t: 'Again', a: 'Again' });
  note(r.status === 409, `the same video twice came back ${r.status}`);
  r = await api({ action: 'repeat', token: TOKEN, v: 'HarnessTst1', on: true });
  note(r.data.tracks.filter((t) => t.r).length === SEEDR + 1, 'ticking a track onto REPEAT did not stick');
  r = await api({ action: 'remove', token: TOKEN, v: 'HarnessTst1' });
  note(r.status === 200 && !r.data.tracks.some((t) => t.v === 'HarnessTst1'), 'the remove did not remove');
  r = await api({ action: 'remove', token: TOKEN, v: 'HarnessTst1' });
  note(r.status === 404, `removing it twice came back ${r.status}`);
  r = await api({ action: 'repeat', token: `${TOKEN}x`, v: SEED.tracks[0].v, on: true });
  note(r.status === 401, `a tampered token edited, status ${r.status}`);

  r = await api({ action: 'backups', token: TOKEN });
  const backups = r.data.backups || [];
  const editsOnly = backups.filter((b) => b.kind === 'edit');
  /* Three edits, three copies of what each one replaced: the seed, the seed
     plus one, the seed plus one on repeat. Newest first. */
  note(editsOnly.length === 3, `${editsOnly.length} edit backups after three edits`);
  note(editsOnly[0] && editsOnly[0].count === SEEDN + 1, `the newest backup holds ${editsOnly[0] && editsOnly[0].count}`);
  /* THE DAY'S COPY IS THE DAY BEFORE ITS FIRST EDIT. That edit was an add, so
     the start of the day is the seed, not the seed plus one. */
  const daily = backups.filter((b) => b.kind === 'daily');
  note(daily.length === 1 && daily[0].count === SEEDN,
       `the daily backup holds ${daily[0] && daily[0].count} tracks, the day started with ${SEEDN}`);
  const oldest = editsOnly[editsOnly.length - 1];
  r = await api({ action: 'restore', token: TOKEN, name: oldest.name });
  note(r.status === 200 && r.data.count === oldest.count, `restoring the oldest backup came back ${r.status} with ${r.data && r.data.count}`);
  r = await api({ action: 'backups', token: TOKEN });
  note(r.data.backups.filter((b) => b.kind === 'edit').length === 4, 'the restore did not back up the list it replaced');
  console.log(`api: public read, 401 without a token, add/duplicate/repeat/remove, ${editsOnly.length} backups, restore backed up`);
}

/* ---- 3. two browsers --------------------------------------------------------- */

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--mute-audio'], defaultViewport: { width: 1400, height: 950 } });

async function door(event, code, name) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
  /* The embed is not what this checks, and it autoplays. Refused at the wire,
     the way music_check does it, so no test waits on YouTube. */
  await page.setRequestInterception(true);
  page.on('request', (req) => (/youtube|ytimg|googlevideo/.test(req.url()) ? req.abort() : req.continue()));
  page.on('pageerror', (e) => fail.push(`pageerror (${name}): ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/youtube|ytimg|Failed to load resource|net::|ERR_/i.test(m.text())) return;
    /* KNOWN, AND NOT THIS FEATURE: the media-session hold in MediaBus plays a
       blob: WAV, and the site's own CSP (media-src) does not allow blob:. It
       predates TUNES -- it is in the commit before this file existed -- and
       this is the first harness to run the music under the shipped CSP.
       Reported rather than silently fixed; delete this line with the fix. */
    if (/Loading media from\s+'blob:/.test(m.text())) return;
    fail.push(`console (${name}): ${m.text()}`);
  });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate((ev, c) => document.dispatchEvent(new CustomEvent(ev, { detail: { code: c } })), event, code);
  await page.waitForFunction(() => document.querySelectorAll('#musicRows .music-row').length > 300, { timeout: 20000 });
  await sleep(900);
  return { context, page, name };
}

const state = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('#musicRows .music-row')];
  return {
    rows: rows.length,
    admin: document.getElementById('musicModal').classList.contains('is-admin'),
    title: document.getElementById('musicTitle').textContent.trim(),
    add: !document.getElementById('musicAdd').hidden,
    backups: !document.getElementById('musicBackups').hidden,
    del: document.querySelectorAll('#musicRows .music-del').length,
    enabled: document.querySelectorAll('#musicRows .music-check:not(:disabled)').length,
    cells: rows[0] ? rows[0].children.length : 0,
    toast: document.getElementById('musicToast').textContent,
  };
});
const has = (page, v) => page.evaluate((id) => !!document.querySelector(`.music-row[data-v="${id}"]`), v);
const pull = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
async function centre(page, selector) {
  await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center', behavior: 'instant' }), selector);
  await sleep(300);
  return page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, selector);
}

try {
  const viewer = await door('music:open', '', 'MUSIC');
  const editor = await door('tunes:open', 'tunes', 'TUNES');
  const wrong = await door('tunes:open', 'nope', 'wrong code');

  const v0 = await state(viewer.page);
  note(!v0.admin && v0.title === 'MUSIC', `MUSIC opened as ${v0.title}, admin ${v0.admin}`);
  note(!v0.add && !v0.backups && v0.del === 0 && v0.enabled === 0 && v0.cells === 5,
       `MUSIC shows add ${v0.add}, backups ${v0.backups}, ${v0.del} minus, ${v0.enabled} live ticks, ${v0.cells} cells`);
  const e0 = await state(editor.page);
  note(e0.admin && e0.title === 'TUNES', `TUNES opened as ${e0.title}, admin ${e0.admin}`);
  note(e0.add && e0.backups && e0.del === e0.rows && e0.enabled === e0.rows && e0.cells === 6,
       `TUNES shows add ${e0.add}, backups ${e0.backups}, ${e0.del} minus for ${e0.rows} rows, ${e0.cells} cells`);
  const w0 = await state(wrong.page);
  note(!w0.admin && !w0.add && /does not unlock/i.test(w0.toast), `a wrong TUNES code: admin ${w0.admin}, toast "${w0.toast}"`);
  await wrong.context.close();

  /* ADD, through the form, with real keys. */
  await editor.page.click('#musicAdd');
  await sleep(200);
  note(await editor.page.evaluate(() => document.activeElement.id === 'musicAddUrl'), 'the link field does not have the caret when the form opens');
  await editor.page.keyboard.type('https://youtu.be/HarnessTst2?list=RDHarnessTst2');
  await editor.page.waitForFunction(() => !document.getElementById('musicAddFound').hidden, { timeout: 5000 }).catch(() => {});
  note(await editor.page.evaluate(() => document.getElementById('musicAddSave').disabled), 'Add is pressable before there is a title');
  await editor.page.click('#musicAddTitle');
  await editor.page.keyboard.type('Harness Anthem');
  await editor.page.click('#musicAddArtist');
  await editor.page.keyboard.type('The Checks');
  note(!(await editor.page.evaluate(() => document.getElementById('musicAddSave').disabled)), 'Add stays dead with a link, a title and an artist');
  await editor.page.click('#musicAddSave');
  await editor.page.waitForFunction(() => !!document.querySelector('.music-row[data-v="HarnessTst2"]'), { timeout: 5000 }).catch(() => {});
  const added = await editor.page.evaluate(() => ({
    row: !!document.querySelector('.music-row[data-v="HarnessTst2"]'),
    lit: !!document.querySelector('.music-row[data-v="HarnessTst2"].is-new'),
    panel: document.getElementById('musicAddPanel').hidden,
    n: document.querySelectorAll('#musicRows .music-row').length,
  }));
  note(added.row && added.panel, `after Add: row ${added.row}, form closed ${added.panel}`);
  note(added.lit, 'the new row is not lit where it landed');
  await pull(viewer.page);
  await viewer.page.waitForFunction(() => !!document.querySelector('.music-row[data-v="HarnessTst2"]'), { timeout: 5000 }).catch(() => {});
  note(await has(viewer.page, 'HarnessTst2'), 'the song added in TUNES never reached the MUSIC screen');

  /* ESCAPE closes the form and nothing else. */
  await editor.page.click('#musicAdd');
  await sleep(150);
  await editor.page.keyboard.press('Escape');
  await sleep(200);
  const esc = await editor.page.evaluate(() => ({ panel: document.getElementById('musicAddPanel').hidden, open: document.getElementById('musicModal').open }));
  note(esc.panel && esc.open, `Escape in the form: form closed ${esc.panel}, overlay still open ${esc.open}`);

  /* MINUS: two presses, and a press elsewhere or a wait puts it back. */
  const sel = '.music-row[data-v="HarnessTst2"] .music-del';
  let at = await centre(editor.page, sel);
  await editor.page.mouse.click(at.x, at.y);
  await sleep(250);
  const armed = await editor.page.evaluate((s) => {
    const b = document.querySelector(s);
    return { armed: b.classList.contains('is-armed'), word: b.textContent.trim(), w: Math.round(b.getBoundingClientRect().width),
             bg: getComputedStyle(b).backgroundColor, still: !!b.closest('.music-row') };
  }, sel);
  note(armed.armed && armed.word === 'Delete' && armed.w > 60, `one press: armed ${armed.armed}, says "${armed.word}", ${armed.w}px`);
  note(/229, 72, 77/.test(armed.bg), `the armed pill is ${armed.bg}, not red`);
  note(armed.still && await has(editor.page, 'HarnessTst2'), 'one press removed the track');
  await sleep(3900);
  note(!(await editor.page.evaluate((s) => document.querySelector(s).classList.contains('is-armed'), sel)), 'the armed delete did not stand down after 3.5 seconds');

  at = await centre(editor.page, sel);
  await editor.page.mouse.click(at.x, at.y);
  await sleep(200);
  const t = await centre(editor.page, '.music-row[data-v="HarnessTst2"] .music-title');
  await editor.page.mouse.click(t.x, t.y);
  await sleep(200);
  note(!(await editor.page.evaluate((s) => document.querySelector(s)?.classList.contains('is-armed'), sel)), 'a press elsewhere did not disarm the delete');

  at = await centre(editor.page, sel);
  await editor.page.mouse.click(at.x, at.y);
  await sleep(250);
  at = await editor.page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, sel);
  await editor.page.mouse.click(at.x, at.y);
  await editor.page.waitForFunction(() => !document.querySelector('.music-row[data-v="HarnessTst2"]'), { timeout: 5000 }).catch(() => {});
  note(!(await has(editor.page, 'HarnessTst2')), 'two presses did not delete the track');
  await pull(viewer.page);
  await viewer.page.waitForFunction(() => !document.querySelector('.music-row[data-v="HarnessTst2"]'), { timeout: 5000 }).catch(() => {});
  note(!(await has(viewer.page, 'HarnessTst2')), 'the delete in TUNES never reached the MUSIC screen');

  /* A TICK in TUNES is a tick on every screen. */
  const target = await editor.page.evaluate(() => [...document.querySelectorAll('#musicRows .music-row')]
    .find((r) => !r.querySelector('.music-check').checked).dataset.v);
  at = await centre(editor.page, `.music-row[data-v="${target}"] .music-check`);
  await editor.page.mouse.click(at.x, at.y);
  await sleep(700);
  note(await editor.page.evaluate((v) => document.querySelector(`.music-row[data-v="${v}"] .music-check`).checked, target), 'ticking in TUNES did not tick');
  await pull(viewer.page);
  await sleep(900);
  const seen = await viewer.page.evaluate((v) => {
    const box = document.querySelector(`.music-row[data-v="${v}"] .music-check`);
    return { checked: box.checked, disabled: box.disabled };
  }, target);
  note(seen.checked && seen.disabled, `MUSIC sees that tick as checked ${seen.checked}, disabled ${seen.disabled}`);

  /* BACKUPS, from the screen. */
  await editor.page.click('#musicBackups');
  await editor.page.waitForFunction(() => document.querySelectorAll('#musicBackupsList .music-bk-restore').length > 0, { timeout: 5000 }).catch(() => {});
  const bk = await editor.page.evaluate(() => ({
    n: document.querySelectorAll('#musicBackupsList .music-bk-restore').length,
    counts: [...document.querySelectorAll('#musicBackupsList .music-bk-count')].every((c) => /\d+ tracks/.test(c.textContent)),
    dl: !!document.getElementById('musicDownload'),
  }));
  note(bk.n >= 6 && bk.counts, `the backups panel lists ${bk.n} restore points`);
  note(bk.dl, 'there is no download button in the backups panel');
  at = await centre(editor.page, '#musicBackupsList .music-bk-restore');
  await editor.page.mouse.click(at.x, at.y);
  await sleep(150);
  note(await editor.page.evaluate(() => /Replace/.test(document.querySelector('#musicBackupsList .music-bk-restore').textContent)),
       'Restore acted on one press instead of asking for a second');

  /* CLOSING ENDS EDITING, and MUSIC after TUNES in one tab is read-only. */
  await editor.page.evaluate(() => document.getElementById('musicStop').click());
  await sleep(400);
  await editor.page.evaluate(() => document.dispatchEvent(new CustomEvent('music:open', { detail: {} })));
  await editor.page.waitForFunction(() => document.getElementById('musicModal').open, { timeout: 5000 });
  await sleep(600);
  const e1 = await state(editor.page);
  note(!e1.admin && e1.del === 0 && e1.enabled === 0, `MUSIC after TUNES in one tab: admin ${e1.admin}, ${e1.del} minus, ${e1.enabled} live ticks`);

  await editor.page.screenshot({ path: join(ROOT, '.notes-dev/shots/tunes-music.png') });
  console.log(`browsers: MUSIC read-only, TUNES added, deleted (two presses) and ticked, each seen on the MUSIC screen live`);

  await viewer.context.close();
  await editor.context.close();
} finally {
  await browser.close();
  stop();
}

console.log('');
if (fail.length) {
  console.log(`music_admin_check: ${fail.length} of ${pass + fail.length} FAILED`);
  for (const f of fail) console.log('  - ' + f);
  process.exit(1);
}
console.log(`music_admin_check: ${pass} checks passed`);
