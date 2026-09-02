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
  // NOT --hide-scrollbars: the scrollbar is a feature here (it takes the colour
  // of the section beside it), and a flag that hides it would leave every
  // screenshot unable to show the thing being checked.
  args: ['--no-first-run', '--no-default-browser-check'],
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

  /* The panel should be nearly the whole screen. The matte around it was the
     complaint, so it is measured rather than eyeballed. */
  const fill = await page.evaluate(() => {
    const r = document.querySelector('.notes-shell').getBoundingClientRect();
    return { w: r.width / innerWidth, h: r.height / innerHeight,
             top: Math.round(r.top), bottom: Math.round(innerHeight - r.bottom) };
  });
  console.log(`panel fills ${(fill.w * 100).toFixed(0)}% x ${(fill.h * 100).toFixed(0)}% ` +
              `of the viewport, gaps ${fill.top}px top / ${fill.bottom}px bottom`);
  note(fill.h >= 0.93, `panel is only ${(fill.h * 100).toFixed(0)}% of the viewport height`);
  note(fill.w >= 0.90, `panel is only ${(fill.w * 100).toFixed(0)}% of the viewport width`);

  /* The close button and the save line moved OUT of the panel. Asserted by
     GEOMETRY: being a child of the frame proves nothing about where they draw. */
  const outside = await page.evaluate(() => {
    const shell = document.querySelector('.notes-shell').getBoundingClientRect();
    const x = document.getElementById('notesClose').getBoundingClientRect();
    const save = document.getElementById('notesSave').getBoundingClientRect();
    return { closeLeft: Math.round(x.left - shell.right),
             saveTop: Math.round(save.top - shell.bottom),
             bar: document.querySelectorAll('.notes-bar').length };
  });
  console.log(`close is ${outside.closeLeft}px right of the panel, ` +
              `save is ${outside.saveTop}px below it, bottom bars: ${outside.bar}`);
  note(outside.closeLeft >= 0, 'the close button still overlaps the panel');
  /* POSITIONED IS NOT PAINTED. The first version of this passed while the
     button was invisible: <dialog> carries overflow:auto from the UA
     stylesheet, so an element placed outside the frame is clipped and draws
     nothing while still reporting a perfectly good bounding box. Ask the
     document what is actually at that point. */
  const hit = await page.evaluate(() => {
    const b = document.getElementById('notesClose');
    const r = b.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { found: !!at && (at === b || b.contains(at)), what: at ? at.tagName : null };
  });
  note(hit.found, `the close button is positioned but not hittable (found ${hit.what})`);
  note(outside.saveTop >= 0, 'the save line is still inside the panel');
  note(outside.bar === 0, 'the bottom bar is still there');

  const zoom = await page.evaluate(() => {
    const b = document.getElementById('notesZoom');
    const r = b.getBoundingClientRect();
    return { inRail: !!b.closest('.notes-rail-wrap'),
             label: (b.textContent || '').trim(),
             square: Math.abs(r.width - r.height) < 2 };
  });
  note(zoom.inRail, 'the zoom button is not in the rail');
  note(zoom.label === '', `the zoom button still carries the text "${zoom.label}"`);
  note(zoom.square, 'the zoom button is not square');

  /* Two sizes, and the DEFAULT is the larger of the old pair -- the small
     default was the complaint. Read off the rendered size, not a number typed
     here. */
  const before = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector('#notesDoc ul')).fontSize));
  await page.click('#notesZoom');
  await new Promise(r => setTimeout(r, 250));
  const huge = await page.$eval('#notesEditor', el => el.classList.contains('is-huge'));
  const after = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector('#notesDoc ul')).fontSize));
  console.log(`zoom: ${before}px default -> ${after}px stepped up (is-huge=${huge})`);
  note(huge, 'the zoom toggle did not step up');
  note(before >= 16, `the default body size is ${before}px, no bigger than the old default`);
  note(after > before, `zoom did not grow the text (${before} -> ${after})`);
  await page.screenshot({ path: join(SHOTS, 'notes-editor-huge.png') });
  await page.click('#notesZoom');

  const spell = await page.evaluate(() => {
    const named = document.getElementById('names') &&
                  document.getElementById('names').closest('.nv-sec');
    const other = document.getElementById('urgent') &&
                  document.getElementById('urgent').closest('.nv-sec');
    return { names: named && named.spellcheck, urgent: other && other.spellcheck };
  });
  console.log(`spellcheck: names=${spell.names}, urgent=${spell.urgent}`);
  note(spell.names === false, 'spellcheck is still on in the Names section');
  note(spell.urgent !== false, 'spellcheck was switched off everywhere, not just Names');

  /* The scrollbar takes the colour of the section beside it. Three different
     sections must give three different colours, or it is a constant. */
  /* The bar is a DRAWN element, so it can be measured rather than admired: it
     must exist, sit at the right edge, be a proportional length, MOVE as the
     document scrolls, and be hittable. A coloured div that never moves is not a
     scroll indicator, and it would sail through a colour-only check. */
  const barAt = (id) => page.evaluate((i) => {
    document.getElementById(i).scrollIntoView({ block: 'center', behavior: 'instant' });
  }, id);
  const barState = () => page.evaluate(() => {
    const t = document.getElementById('notesThumb');
    const s = document.getElementById('notesScroll');
    const r = t.getBoundingClientRect();
    const sr = s.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      hidden: t.hidden,
      top: Math.round(r.top - sr.top),
      height: Math.round(r.height),
      rightGap: Math.round(sr.right - r.right),
      colour: getComputedStyle(t).backgroundColor,
      hittable: at === t,
    };
  });

  const colours = [];
  const tops = [];
  // NOT the first section: it sits at the top of the document and cannot be
  // scrolled to the middle, so asking it to dominate the viewport is asking
  // for something the scroll container cannot do -- a test failing on its own
  // impossible setup, not on the feature.
  for (const id of ['world-design', 'creatures-npcs', 'names']) {
    await barAt(id);
    await new Promise(r => setTimeout(r, 340));
    const bar = await barState();
    colours.push(bar.colour);
    tops.push(bar.top);
    if (id === 'creatures-npcs') {
      console.log(`bar: ${bar.height}px tall, ${bar.rightGap}px from the right edge, ` +
                  `hittable=${bar.hittable}, hidden=${bar.hidden}`);
      note(!bar.hidden, 'the scroll indicator is hidden on an overflowing document');
      note(bar.hittable, 'the indicator is drawn but not hittable, so it cannot be dragged');
      note(bar.rightGap >= 0 && bar.rightGap < 20,
           `the indicator is ${bar.rightGap}px from the right edge`);
      note(bar.height > 20 && bar.height < 400,
           `the indicator is ${bar.height}px tall, which is not a proportional thumb`);
    }
  }
  console.log(`bar colours: ${colours.join(' | ')}`);
  console.log(`bar offsets: ${tops.join(' | ')}`);
  note(new Set(colours).size === colours.length,
       `the bar colour did not follow the section: ${colours.join(', ')}`);
  const blank = /^(|none|rgba\(0, 0, 0, 0\))$/;
  note(colours.every(c => !blank.test(c)), `the bar colour was never set: ${colours.join(', ')}`);
  note(new Set(tops).size === tops.length,
       `the bar did not move as the document scrolled: ${tops.join(', ')}`);

  /* ...and it must actually scroll when dragged. Hiding the native bar took
     that away, and a coloured div you cannot grab is worse than the bar it
     replaced. */
  const dragged = await page.evaluate(() => {
    const t = document.getElementById('notesThumb');
    const s = document.getElementById('notesScroll');
    const r = t.getBoundingClientRect();
    const before = s.scrollTop;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const make = (type, clientY) =>
      new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, clientY });
    t.dispatchEvent(make('pointerdown', y));
    t.dispatchEvent(make('pointermove', y + 140));
    t.dispatchEvent(make('pointerup', y + 140));
    return { before, after: s.scrollTop };
  });
  console.log(`drag the bar: scrollTop ${Math.round(dragged.before)} -> ${Math.round(dragged.after)}`);
  note(dragged.after > dragged.before + 50, 'dragging the indicator did not scroll the document');

  await page.screenshot({ path: join(SHOTS, 'notes-gate.png') });
  await page.close();
}

/* ---- 6. the Idea Vault opens it ------------------------------------------
   FALSELY PASSES IF: the overlay were opened by URL instead. This types the
   code into the VAULT's own keypad and waits for the notes dialog. */
{
  const page = await newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.$eval('#vault', el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForSelector('#vaultPins .vault-pin', { visible: true, timeout: 10000 });
  await page.focus('#vaultPins .vault-pin');
  for (const c of 'notes') { await page.keyboard.type(c); await new Promise(r => setTimeout(r, 60)); }
  const opened = await page.waitForFunction(
    () => document.getElementById('notesModal') &&
          document.getElementById('notesModal').open === true, { timeout: 40000 })
    .then(() => true).catch(() => false);
  const gate = await page.evaluate(() => ({
    keypad: !document.getElementById('notesGate').hidden,
    editorHidden: document.getElementById('notesEditor').hidden,
    inDom: document.documentElement.outerHTML.includes('Pick a new game name'),
  }));
  console.log(`vault code NOTES: opened=${opened}, on the keypad=${gate.keypad}, ` +
              `editor hidden=${gate.editorHidden}`);
  note(opened, 'the vault code did not open the notes overlay');
  // It opens the DOOR, not the notes: the server check still stands.
  note(gate.keypad && gate.editorHidden,
       'the vault opened the overlay past its own password');
  note(!gate.inDom, 'the vault opening leaked the notes into the page');
  await page.screenshot({ path: join(SHOTS, 'notes-from-vault.png') });
  await page.close();
}

await browser.close();
console.log(fail.length ? `\nFAIL (${fail.length}):\n  ${fail.join('\n  ')}`
                        : '\nPASS — every notes check held');
process.exit(fail.length ? 1 : 0);
