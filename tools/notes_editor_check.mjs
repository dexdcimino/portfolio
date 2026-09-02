/* Drive the notes EDITOR in a real browser: indenting, backspace, shortcuts,
 * and the selection bug.
 *
 *   node tools/notes_dev_server.mjs &
 *   node tools/notes_editor_check.mjs
 *
 * Every check drives real keys and a real mouse through CDP. None of them call
 * the page's own functions, because a check that calls indent() proves indent()
 * runs, not that Tab reaches it -- and "Tab never reaches the browser" is half
 * of what is being tested.
 *
 * The nesting checks work on a SCRATCH section appended to the document rather
 * than on the notes themselves, so a run cannot quietly rewrite Dex's list
 * structure into whatever the last assertion left behind.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const BASE = `http://127.0.0.1:${arg('--port', 8123)}`;
const SHOTS = resolve(arg('--shots', join(ROOT, '.notes-dev/shots')));

const CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => p && existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found — set CHROME=<path to the exe>');

const fail = [];
const note = (ok, why) => { if (!ok) fail.push(why); else pass++; };
let pass = 0;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-first-run', '--no-default-browser-check', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.createCDPSession().then(s =>
  s.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {}));
await page.setViewport({ width: 1500, height: 950 });
page.on('pageerror', e => fail.push(`pageerror: ${e.message}`));

await page.goto(`${BASE}/#notes`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('#notesPins .vault-pin', { visible: true });
await page.focus('#notesPins .vault-pin');
for (const c of 'notes') { await page.keyboard.type(c); await new Promise(r => setTimeout(r, 40)); }
await page.waitForFunction(() => !document.getElementById('notesEditor').hidden, { timeout: 20000 });

/* A known list to work on: three bullets at three different depths, which is
   what the multi-select check needs and what a same-depth-only test would
   quietly fail to cover. */
const SCRATCH = `
<section class="nv-sec" data-harness data-accent="cyan"><h2 id="scratch">SCRATCH</h2>
<ul><li id="s0">alpha</li><li id="s1">bravo<ul><li id="s2">charlie</li>
<li id="s3">delta<ul><li id="s4">echo</li></ul></li></ul></li>
<li id="s5">foxtrot</li><li id="s6"></li></ul></section>`;

/* Clears EVERY node a previous check left behind, not just the scratch
   section. The editor saves to the store, so debris survives the run that made
   it: an emptied <div id="md"> from the last pass is still there on the next
   one, getElementById finds that instead of the fresh copy, and the check dies
   on a null firstChild. Everything the harness creates is tagged
   data-harness and swept here. */
const reset = () => page.evaluate((html) => {
  const doc = document.getElementById('notesDoc');
  doc.querySelectorAll('[data-harness]').forEach(el => el.remove());
  doc.insertAdjacentHTML('beforeend', html);
  document.getElementById('scratch').scrollIntoView({ block: 'center', behavior: 'instant' });
}, SCRATCH);

/* Found BY TEXT, not by id. execCommand('outdent') unwraps and rebuilds the
   element, so the id is gone the moment the thing under test works -- an
   id-based lookup reports "vanished" for a successful outdent and cannot tell
   that apart from a real failure. Text is what the reader sees and what
   survives the rewrite. Returns the tag too, so "became a plain line" is a
   distinguishable outcome rather than an absence. */
const findByText = (text) => page.evaluate((t) => {
  const doc = document.getElementById('notesDoc');
  const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
  let node = null;
  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue.trim() === t) { node = walker.currentNode; break; }
  }
  // Walks TEXT NODES, not elements. The last Shift+Tab out of a list leaves the
  // text as a direct child of the document -- a plain line, which is the
  // desired end state -- and an element-only search reports that as "vanished",
  // making success and destruction look identical.
  if (!node) return { found: false, depth: -1, tag: null };
  let n = 0;
  for (let p = node.parentElement; p && p.id !== 'notesDoc'; p = p.parentElement) {
    if (/^(UL|OL)$/.test(p.tagName)) n++;
  }
  const parent = node.parentElement;
  return { found: true, depth: n, tag: parent && parent.id === 'notesDoc' ? 'TEXT' : parent.tagName };
}, text);

const depthOf = async (text) => (await findByText(text)).depth;

/* Put the caret at the END of a bullet's text, the way a click would. */
const caretIn = (id, atStart) => page.evaluate((i, start) => {
  const el = document.getElementById(i);
  const node = [...el.childNodes].find(n => n.nodeType === 3) || el;
  const r = document.createRange();
  const len = node.nodeType === 3 ? node.nodeValue.length : 0;
  r.setStart(node, start ? 0 : len);
  r.collapse(true);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  document.getElementById('notesDoc').focus({ preventScroll: true });
}, id, !!atStart);

const settle = (ms = 150) => new Promise(r => setTimeout(r, ms));

/* ---- 1. Shift+Tab walks OUT one level at a time -------------------------
   FALSELY PASSES IF: tested once at one nesting level. "echo" starts three
   lists deep, so this asserts the whole walk: 3 -> 2 -> 1 -> not a bullet. */
{
  await reset();
  await caretIn('s4');
  const seen = [await findByText('echo')];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
    await settle();
    seen.push(await findByText('echo'));
  }
  const shape = seen.map(s => `${s.tag || 'gone'}@${s.depth}`).join(' -> ');
  console.log(`outdent walk: ${shape}`);
  note(seen[0].depth === 3, `"echo" started at depth ${seen[0].depth}, expected 3`);
  note(seen[1].depth === 2, `first Shift+Tab gave depth ${seen[1].depth}, expected 2`);
  note(seen[2].depth === 1, `second Shift+Tab gave depth ${seen[2].depth}, expected 1`);
  note(seen.every(s => s.found), 'the bullet vanished during the walk');
  note(seen[3].tag !== 'LI' || seen[3].depth === 0,
       `third Shift+Tab left ${seen[3].tag}@${seen[3].depth}, expected a plain line or depth 0`);
}

/* ---- 2. Tab is captured, in all three states ----------------------------
   FALSELY PASSES IF: only tested with the cursor in a filled bullet. Focus
   leaving #notesDoc is the failure -- that is the shape of "Tab reached the
   browser", and it is what sent the caret into Chrome's own UI. */
{
  await reset();
  for (const [id, what] of [['s5', 'filled bullet'], ['s6', 'empty bullet']]) {
    await caretIn(id);
    await page.keyboard.press('Tab');
    await settle();
    const focused = await page.evaluate(() =>
      document.activeElement?.id || document.activeElement?.tagName);
    note(focused === 'notesDoc', `Tab in a ${what} moved focus to ${focused}`);
    console.log(`tab capture (${what}): focus stayed on ${focused}`);
  }
  // ...and on a plain line, which has no list for Tab to act on at all.
  await page.evaluate(() => {
    const doc = document.getElementById('notesDoc');
    doc.insertAdjacentHTML('beforeend', '<div id="plain" data-harness>plain line</div>');
    const node = document.getElementById('plain').firstChild;
    const r = document.createRange(); r.setStart(node, 5); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    doc.focus({ preventScroll: true });
  });
  await page.keyboard.press('Tab');
  await settle();
  const focused = await page.evaluate(() => document.activeElement?.id);
  note(focused === 'notesDoc', `Tab on a plain line moved focus to ${focused}`);
  const blockquotes = await page.evaluate(() => document.querySelectorAll('#notesDoc blockquote').length);
  note(blockquotes === 0, 'Tab on a plain line produced a <blockquote>');
  console.log(`tab capture (plain line): focus stayed on ${focused}, blockquotes ${blockquotes}`);
}

/* ---- 3. multi-line indent across DIFFERENT depths ------------------------
   FALSELY PASSES IF: the three bullets were already at the same level, which
   is the easy case. bravo(1) charlie(2) delta(2) span two depths, and all
   three must move together and keep their relative order. */
{
  await reset();
  await page.evaluate(() => {
    const from = document.getElementById('s1').firstChild;      // "bravo"
    const to = document.getElementById('s3').firstChild;        // "delta"
    const r = document.createRange();
    r.setStart(from, 1); r.setEnd(to, 3);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.getElementById('notesDoc').focus({ preventScroll: true });
  });
  const trio = ['bravo', 'charlie', 'delta'];
  const before = [];
  for (const t of trio) before.push(await depthOf(t));
  await page.keyboard.press('Tab');
  await settle(250);
  const after = [];
  for (const t of trio) after.push(await depthOf(t));
  // Order by TEXT, for the same reason the depths are: the ids do not survive.
  const order = await page.evaluate(() => [...document.querySelectorAll('#notesDoc li')]
    .map(l => (l.firstChild?.textContent || '').trim())
    .filter(t => ['alpha','bravo','charlie','delta','echo','foxtrot'].includes(t)).join(','));
  console.log(`multi indent: ${before.join(',')} -> ${after.join(',')}  order ${order}`);
  note(after.every((d, i) => d === before[i] + 1),
       `indent moved ${before.join(',')} to ${after.join(',')}, expected each +1`);
  note(order === 'alpha,bravo,charlie,delta,echo,foxtrot', `order became ${order}`);

  await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
  await settle(250);
  const back = [];
  for (const t of trio) back.push(await depthOf(t));
  console.log(`multi outdent: ${after.join(',')} -> ${back.join(',')}`);
  note(back.every((d, i) => d === before[i]),
       `outdent left ${back.join(',')}, expected ${before.join(',')}`);
  // execCommand preserves appearance by wrapping the moved text in a styled
  // <span>. That colour is the section accent, so the wrapper both freezes the
  // wrong colour and puts an inline style into the saved document.
  const spans = await page.evaluate(() =>
    document.querySelectorAll('#notesDoc span[style]').length);
  console.log(`styled spans after indent/outdent: ${spans}`);
  note(spans === 0, `${spans} styled <span> wrappers left behind by indent/outdent`);
}

/* ---- 4. Backspace at the start unwinds before it merges ------------------ */
{
  await reset();
  await caretIn('s2', true);                    // "charlie", depth 2
  const b0 = await findByText('charlie');
  await page.keyboard.press('Backspace');
  await settle();
  const b1 = await findByText('charlie');
  await page.keyboard.press('Backspace');
  await settle();
  const b2 = await findByText('charlie');
  const merged = await page.evaluate(() =>
    !![...document.querySelectorAll('#notesDoc li')]
      .find(l => /bravocharlie/.test(l.textContent.replace(/\s+/g, ''))));
  console.log(`backspace: ${b0.tag}@${b0.depth} -> ${b1.tag}@${b1.depth} -> ${b2.tag}@${b2.depth}, merged: ${merged}`);
  note(b1.depth === b0.depth - 1, `first Backspace went ${b0.depth} -> ${b1.depth}, expected one level out`);
  note(b1.found && b2.found, 'the bullet was destroyed by Backspace');
  note(!merged, 'Backspace merged into the line above instead of unwinding');
}

/* ---- 5. bold / italic / underline --------------------------------------- */
{
  await reset();
  await page.evaluate(() => {
    const node = document.getElementById('s0').firstChild;
    const r = document.createRange(); r.setStart(node, 0); r.setEnd(node, 5);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.getElementById('notesDoc').focus({ preventScroll: true });
  });
  for (const [key, tag] of [['b', 'B'], ['i', 'I'], ['u', 'U']]) {
    await page.keyboard.down('Control'); await page.keyboard.press(key); await page.keyboard.up('Control');
    await settle(80);
  }
  const marks = await page.evaluate(() => {
    const li = document.getElementById('s0');
    return ['b', 'i', 'u'].map(t => li.querySelector(t) ? t : '').filter(Boolean).join('');
  });
  console.log(`formatting: ${marks || '(none)'}`);
  note(marks.includes('b') && marks.includes('i') && marks.includes('u'),
       `Ctrl+B/I/U produced "${marks}", expected all three`);
}

/* ---- 6. undo and redo --------------------------------------------------- */
{
  await reset();
  await caretIn('s0');
  await page.keyboard.type('XYZ');
  await settle(120);
  const typed = await page.evaluate(() => document.getElementById('s0').textContent);
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  await settle(150);
  const undone = await page.evaluate(() => document.getElementById('s0').textContent);
  await page.keyboard.down('Control'); await page.keyboard.press('y'); await page.keyboard.up('Control');
  await settle(150);
  const redone = await page.evaluate(() => document.getElementById('s0').textContent);
  console.log(`undo/redo: "${typed}" -> undo "${undone}" -> redo "${redone}"`);
  note(typed.includes('XYZ'), 'typing did not land');
  note(!undone.includes('XYZ'), 'Ctrl+Z did not undo the typing');
  note(redone.includes('XYZ'), 'Ctrl+Y did not redo it');
}

/* ---- 7. "- " turns a plain line into a bullet ---------------------------- */
{
  await reset();
  await page.evaluate(() => {
    const doc = document.getElementById('notesDoc');
    doc.insertAdjacentHTML('beforeend', '<div id="md" data-harness><br></div>');
    const el = document.getElementById('md');
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = document.createRange(); r.setStart(el, 0); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    doc.focus({ preventScroll: true });
  });
  await settle(150);
  await page.keyboard.type('- ');
  await settle(200);
  const became = await page.evaluate(() => {
    const sel = getSelection();
    const el = sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement;
    return { inList: !!el?.closest('li'), text: el?.closest('li')?.textContent ?? null };
  });
  console.log(`markdown bullet: inList=${became.inList} text=${JSON.stringify(became.text)}`);
  note(became.inList, '"- " did not convert the line into a bullet');
  note(!(became.text || '').includes('-'), 'the "-" was left in the new bullet');
  // The first cut deleted the marker with a raw range operation, which the
  // undo stack never saw -- Ctrl+Z could not put it back.
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  await settle(200);
  const undoneList = await page.evaluate(() => {
    const sel = getSelection();
    const el = sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement;
    return !!el?.closest('li');
  });
  console.log(`markdown bullet undo: still a bullet after Ctrl+Z = ${undoneList}`);
  note(!undoneList, 'Ctrl+Z did not undo the "- " conversion');
}

/* ---- 8. the selection bug ------------------------------------------------
   FALSELY PASSES IF: run on a long line, where the drag start is near the left
   edge anyway, or on a bullet with no nested list -- Chrome gets that shape
   right and always did. "Creatures" is short AND has a nested list, which is
   the exact combination that failed. */
{
  await reset();
  const cases = [
    ['Creatures', 'short bullet WITH a nested list'],
    ['Coop', 'short bullet with no nested list'],
  ];
  for (const [want, what] of cases) {
    const geom = await page.evaluate((w) => {
      const li = [...document.querySelectorAll('#notesDoc li')]
        .find(l => (l.firstChild?.textContent || '').trim() === w);
      if (!li) return null;
      li.scrollIntoView({ block: 'center', behavior: 'instant' });
      const node = [...li.childNodes].find(n => n.nodeType === 3 && n.nodeValue.trim());
      const r = document.createRange(); r.selectNodeContents(node);
      const t = r.getBoundingClientRect(), b = li.getBoundingClientRect();
      return { tx: t.x, tw: t.width, ty: t.y, th: t.height, bx: b.x, bw: b.width,
               len: node.nodeValue.length };
    }, want);
    if (!geom) { fail.push(`selection check: no bullet "${want}"`); continue; }
    await settle(250);
    const y = geom.ty + geom.th / 2;
    // Start the drag in the empty space to the RIGHT of the text, then move
    // left into it — the reported gesture.
    await page.mouse.move(geom.bx + geom.bw - 40, y);
    await page.mouse.down();
    await page.mouse.move(geom.tx + geom.tw * 0.45, y, { steps: 12 });
    await page.mouse.up();
    const sel = await page.evaluate(() => {
      const s = getSelection();
      return { text: s.toString(), anchorOffset: s.anchorOffset };
    });
    console.log(`drag from the right (${what}): anchor=${sel.anchorOffset} of ${geom.len}, selected "${sel.text}"`);
    note(sel.anchorOffset === geom.len,
         `${what}: drag anchored at ${sel.anchorOffset}, expected ${geom.len} (the end of the text)`);
    note(sel.text.length > 0 && !sel.text.startsWith(want[0]),
         `${what}: selection "${sel.text}" started at the beginning of the line`);
  }
}

/* ---- 9. the frame, looked at -------------------------------------------- */
{
  await reset();
  await caretIn('s4');
  await page.evaluate(() => document.getElementById('scratch')
    .scrollIntoView({ block: 'center', behavior: 'instant' }));
  await settle(300);
  await page.screenshot({ path: join(SHOTS, 'notes-editor-nesting.png') });

  // The header gap: every section's h2-to-list distance should be the same.
  const gaps = await page.evaluate(() => [...document.querySelectorAll('#notesDoc .nv-sec')]
    .map(s => {
      const h = s.querySelector('h2'), u = s.querySelector('ul');
      if (!h || !u) return null;
      return Math.round(u.getBoundingClientRect().top - h.getBoundingClientRect().bottom);
    }).filter(v => v !== null));
  const spread = Math.max(...gaps) - Math.min(...gaps);
  console.log(`header gaps: ${gaps.join(', ')} (spread ${spread}px)`);
  note(spread <= 1, `header-to-list gaps vary by ${spread}px: ${gaps.join(', ')}`);
}

await browser.close();
console.log(`\n${pass} checks passed`);
console.log(fail.length ? `FAIL (${fail.length}):\n  ${fail.join('\n  ')}`
                        : 'PASS — every editor check held');
process.exit(fail.length ? 1 : 0);
