/* Drive the notes overlay in a real browser against the real handlers.
 *
 *   node tools/notes_dev_server.mjs &
 *   node tools/notes_check.mjs [--port 8123] [--shots <dir>]
 *
 * Every check below names, in its own comment, what would make it pass while
 * the feature was broken -- because most of these have an obvious version that
 * proves nothing. "Refresh and the text is still there" is true of
 * localStorage. "The second browser sees it" is the only one that actually
 * says the server holds it.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const BASE = `http://127.0.0.1:${arg('--port', 8123)}`;
const SHOTS = resolve(arg('--shots', join(ROOT, '.notes-dev/shots')));
const STORE = resolve(arg('--dir', join(ROOT, '.notes-dev')));
const PASSWORD = 'notes';

const CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => p && existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found — set CHROME=<path to the exe>');

const fail = [];
const note = (ok, why) => { if (!ok) fail.push(why); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-first-run', '--no-default-browser-check', '--hide-scrollbars'],
});

async function newPage(context, allow) {
  const page = await (context || browser).newPage();
  // STANDING RULE: refuse downloads before navigating, or a throwaway profile
  // writes into the real ~/Downloads.
  await page.createCDPSession().then(s =>
    s.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {}));
  await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 });
  page.on('pageerror', e => fail.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    const text = m.text();
    // `allow` is for errors a check CAUSES on purpose -- the wrong-password
    // case below makes the browser log a 401, and treating that as a defect
    // would mean the suite could only pass by not testing the failure path.
    if (m.type() !== 'error' || /favicon/i.test(text)) return;
    if (allow && allow.test(text)) return;
    fail.push(`console: ${text}`);
  });
  return page;
}

/* Focus the first box and let the KEYPAD move focus, exactly as a person's
 * typing does. Re-selecting a box per character instead lands every character
 * in the same one -- the row advances focus on input, so a selector evaluated
 * fresh each time keeps finding box 0. */
async function type(page, word) {
  await page.waitForSelector('#notesPins .vault-pin', { visible: true, timeout: 10000 });
  await page.focus('#notesPins .vault-pin');
  for (const ch of word) {
    await page.keyboard.type(ch);
    await new Promise(r => setTimeout(r, 40));
  }
}

const unlocked = (page) => page.waitForFunction(
  () => !document.getElementById('notesEditor').hidden
     && document.querySelectorAll('#notesDoc .nv-sec').length > 0,
  { timeout: 20000 }).catch(async (err) => {
    // A bare timeout here says nothing about why. Report what the keypad
    // actually shows before giving up.
    const why = await page.evaluate(() => ({
      status: document.getElementById('notesStatus')?.textContent,
      typed: [...document.querySelectorAll('#notesPins .vault-pin')].map(p => p.value).join(''),
      editorHidden: document.getElementById('notesEditor')?.hidden,
    })).catch(() => ({}));
    throw new Error(`${err.message} — keypad says ${JSON.stringify(why)}`);
  });

const savedOnce = (page) => page.waitForFunction(
  () => /^SAVED/.test(document.getElementById('notesSave').textContent || ''),
  { timeout: 20000 });

/* ---- 1. a wrong password must leak nothing -------------------------------
   FALSELY PASSES IF: the content were fetched on load and merely hidden with
   CSS until unlock. So this looks at the whole document and at every response
   body the page received, not at what is visible. */
{
  const page = await newPage(null, /401 \(Unauthorized\)/);
  const bodies = [];
  page.on('response', async (r) => {
    try {
      if (r.request().resourceType() === 'image') return;
      bodies.push(await r.text());
    } catch { /* redirects and 204s have no body */ }
  });
  await page.goto(`${BASE}/#notes`, { waitUntil: 'networkidle2', timeout: 60000 });
  await type(page, 'wrong');
  await page.waitForFunction(
    () => /NOPE|WRONG/i.test(document.getElementById('notesStatus').textContent || ''),
    { timeout: 15000 }).catch(() => {});

  const marker = 'Pick a new game name';          // first line of the seed
  const inDom = await page.evaluate(() => document.documentElement.outerHTML);
  const anywhere = bodies.some(b => b.includes(marker));
  note(!inDom.includes(marker), 'the notes are in the DOM before any unlock');
  note(!anywhere, 'the notes came down the wire before any unlock');
  note(await page.$eval('#notesEditor', el => el.hidden), 'the editor is not hidden after a wrong password');
  console.log(`wrong-password leak check: ${bodies.length} response bodies scanned, marker found: ${anywhere}`);
  await page.close();
}

/* ---- 2. an edit survives a hard refresh ---------------------------------
   FALSELY PASSES IF: the save went to localStorage. Guarded two ways: the
   marker is checked in the STORE ON DISK before the reload, and check 3 loads
   it in a browser that shares nothing with this one. */
const marker = `harness-${Date.now()}`;
{
  const page = await newPage();
  await page.goto(`${BASE}/#notes`, { waitUntil: 'networkidle2', timeout: 60000 });
  await type(page, PASSWORD);
  await unlocked(page);

  await page.evaluate((m) => {
    const doc = document.getElementById('notesDoc');
    const li = document.createElement('li');
    li.textContent = m;
    doc.querySelector('ul').prepend(li);
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, marker);
  await savedOnce(page);

  const onDisk = await readFile(join(STORE, 'notes/current.html'), 'utf8');
  note(onDisk.includes(marker), 'the edit never reached the server-side store');

  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await unlocked(page);                              // token in sessionStorage
  const after = await page.$eval('#notesDoc', el => el.textContent);
  note(after.includes(marker), 'the edit did not survive a reload');
  console.log(`reload check: marker in store=${onDisk.includes(marker)}, on screen after reload=${after.includes(marker)}`);
  await page.close();
}

/* ---- 3. a SECOND browser sees it ----------------------------------------
   This is the only check that proves the server holds the document. An
   incognito context shares no storage of any kind with the one above, so a
   localStorage implementation cannot pass it. */
{
  const context = await browser.createBrowserContext();
  const page = await newPage(context);
  await page.goto(`${BASE}/#notes`, { waitUntil: 'networkidle2', timeout: 60000 });
  await type(page, PASSWORD);
  await unlocked(page);
  const seen = await page.$eval('#notesDoc', el => el.textContent);
  note(seen.includes(marker), 'a second browser did not see the first browser\'s edit');
  console.log(`second-browser check: marker visible=${seen.includes(marker)}`);
  await page.close();
  await context.close();
}

/* ---- 4. backups rotate at twenty ----------------------------------------
   FALSELY PASSES IF: backups accumulated forever, or only one ever existed.
   Both are silent until a restore is actually needed, so this asserts a RANGE
   with a floor as well as a ceiling, and drives more saves than the limit. */
{
  const page = await newPage();
  await page.goto(`${BASE}/#notes`, { waitUntil: 'networkidle2', timeout: 60000 });
  await type(page, PASSWORD);
  await unlocked(page);
  for (let i = 0; i < 25; i++) {
    await page.evaluate((n) => {
      const doc = document.getElementById('notesDoc');
      doc.querySelector('li').textContent = `edit ${n}`;
      doc.dispatchEvent(new Event('input', { bubbles: true }));
    }, i);
    await savedOnce(page);
    await new Promise(r => setTimeout(r, 40));   // distinct ISO timestamps
  }
  const files = (await readdir(join(STORE, 'notes/backups'))).filter(f => f.endsWith('.html'));
  note(files.length === 20, `${files.length} backups kept, expected exactly 20`);
  const newest = files.sort().at(-1);
  const body = await readFile(join(STORE, 'notes/backups', newest), 'utf8');
  note(body.includes('edit 24'), 'the newest backup is not the newest save');
  console.log(`backup check: ${files.length} kept after 25 saves, newest=${newest}`);
  await page.close();
}

/* ---- 5. the frame, looked at ---------------------------------------------- */
{
  const page = await newPage();
  await page.goto(`${BASE}/#notes`, { waitUntil: 'networkidle2', timeout: 60000 });
  await type(page, PASSWORD);
  await unlocked(page);
  const shape = await page.evaluate(() => {
    const shell = document.querySelector('.notes-shell').getBoundingClientRect();
    return {
      shell: `${Math.round(shell.width)}x${Math.round(shell.height)}`,
      viewport: `${innerWidth}x${innerHeight}`,
      railButtons: document.querySelectorAll('#notesRail button').length,
      railIcons: document.querySelectorAll('#notesRail svg').length,
      sections: document.querySelectorAll('#notesDoc .nv-sec').length,
      items: document.querySelectorAll('#notesDoc li').length,
      headingColour: getComputedStyle(document.querySelector('#notesDoc h2')).color,
      listColour: getComputedStyle(document.querySelector('#notesDoc ul')).color,
      inlineStyles: document.querySelectorAll('#notesDoc [style]').length,
      handlers: document.querySelectorAll('#notesDoc [onclick]').length,
    };
  });
  console.log('rendered:', JSON.stringify(shape));
  note(shape.sections === 9, `${shape.sections} sections rendered, expected 9`);
  // Not `=== 127`: the checks above deliberately edit the document and the
  // store keeps those edits, so the seed's own count is a floor here, not an
  // equality. Pinning it to 127 would make this check pass only when run
  // first, which is the kind of order dependence that goes unnoticed until it
  // fails for a reason that has nothing to do with the feature.
  note(shape.items >= 127, `${shape.items} list items rendered, expected at least 127`);
  note(shape.railButtons === 9, `${shape.railButtons} rail buttons, expected 9`);
  note(shape.railIcons === 9, `${shape.railIcons} rail icons, expected 9`);
  // The whole reason the content was converted: if these came back as the
  // browser default grey, the CSS is not reaching the document.
  note(shape.headingColour !== 'rgb(201, 206, 222)',
       `heading colour is ${shape.headingColour} — the accent is not applying`);
  note(shape.listColour !== shape.headingColour,
       'list colour equals heading colour — the derived tone is not applying');
  note(shape.handlers === 0, 'an onclick survived into the document');

  await page.screenshot({ path: join(SHOTS, 'notes-editor.png') });
  await page.click('#notesZoom');
  await new Promise(r => setTimeout(r, 250));
  const wide = await page.$eval('#notesEditor', el => el.classList.contains('is-wide'));
  note(wide, 'the zoom toggle did not switch to wide');
  await page.screenshot({ path: join(SHOTS, 'notes-editor-wide.png') });
  await page.click('#notesZoom');
  await page.screenshot({ path: join(SHOTS, 'notes-gate.png') });
  await page.close();
}

await browser.close();
console.log(fail.length ? `\nFAIL (${fail.length}):\n  ${fail.join('\n  ')}`
                        : '\nPASS — every notes check held');
process.exit(fail.length ? 1 : 0);
