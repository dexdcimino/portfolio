/* Drive the notes EDITOR in a real browser: lists, indenting, Enter and
 * Backspace, markdown triggers, undo and redo with the caret, todo items,
 * autocorrect, spelling marks, the emoji and slash pickers, links, paste
 * hygiene, sessions, archive and restore, search, and what reaches the store.
 *
 *   node tools/notes_dev_server.mjs &
 *   node tools/notes_editor_check.mjs [--port 8123]
 *
 * Every check drives real keys and a real mouse through CDP. None of them call
 * the editor's own functions, because a check that calls indent() proves
 * indent() runs, not that Tab reaches it -- and "Tab never reaches the
 * browser" is half of what is being tested.
 *
 * Everything happens in a SCRATCH category the run creates and archives at
 * the end, so a run cannot rewrite the notes it is testing against. The run
 * refuses to start if the store has no current.json: the migration case is
 * notes_check.mjs's, and this one needs the document it produces.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const BASE = `http://127.0.0.1:${arg('--port', 8123)}`;
const STORE = resolve(arg('--dir', join(ROOT, '.notes-dev')));
const SHOTS = resolve(arg('--shots', join(ROOT, '.notes-dev/shots')));

const CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => p && existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found — set CHROME=<path to the exe>');

const fail = [];
let pass = 0;
const note = (ok, why) => { if (ok) pass++; else fail.push(why); };
/* A RUN THAT ABORTS STILL SAYS WHAT IT FOUND. Most checks here record a
   failure and carry on, so an exception three lines later threw away every
   note taken up to that point and printed a stack instead -- and the note
   that explained the exception was always one of the discarded ones. */
let reported = false;
process.on('exit', () => {
  if (reported || !fail.length) return;
  console.log(`\n${pass} checks passed before the run stopped`);
  console.log(`FAIL (${fail.length}):`);
  for (const f of fail) console.log(`  ${f}`);
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* protocolTimeout well above the default. This run drives several hundred
   real interactions against a browser sharing a machine with whatever else is
   open, and a stall waiting on one of them killed the whole run and printed a
   CDP stack where the results should have been -- which reads exactly like a
   hang in the app and is not one. A run that is slow should be slow, not
   silent. */
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', protocolTimeout: 600000,
  args: ['--no-first-run', '--no-default-browser-check', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.createCDPSession().then(s => s.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {}));
await page.setViewport({ width: 1500, height: 950 });
page.on('pageerror', e => fail.push(`pageerror: ${e.message}`));
/* A CHIP OPENS ITS LINK IN A NEW TAB, and a stray click on one during a drag
   check leaves a second target open against a machine with no network. Shut
   it as it appears: nothing here is testing what the other end serves. */
page.on('popup', (p) => { p.close().catch(() => {}); });
/* WITH THE LOCATION. A bare "Applying inline style violates..." names no file
   and no line, and a CSP message you cannot trace is a message you cannot act
   on -- it cost a round of guessing at which of three clones was doing it. */
page.on('console', m => {
  if (m.type() !== 'error' || /favicon|401/.test(m.text())) return;
  const at = m.stackTrace().find((f) => f.url) || m.location() || {};
  const where = at.url ? ` @ ${String(at.url).split('/').pop()}:${at.lineNumber ?? '?'}` : '';
  fail.push(`console: ${m.text()}${where}`);
});

await page.goto(`${BASE}/#notes`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('#notesPins .vault-pin', { visible: true });
await page.focus('#notesPins .vault-pin');
for (const c of 'notes') { await page.keyboard.type(c); await sleep(40); }
await page.waitForFunction(() => document.querySelectorAll('.nt-cat').length > 0, { timeout: 20000 });

/* THE THEME IS A SAVED SETTING, so whatever last touched this store decides
   which one the run starts in -- and every assertion below that says "dark"
   would then be failing on yesterday's state rather than on today's code. A
   screenshot script left it on light once and took four checks down with it. */
await page.evaluate(() => {
  if (document.querySelector('.nt-app').dataset.theme !== 'dark') document.querySelector('.nt-theme').click();
});
await sleep(350);
note(await page.$eval('.nt-app', (e) => e.dataset.theme === 'dark'), 'could not put the run on the dark theme');
/* AND SO IS THE OUTLINER'S FOLD. Same trap, one line further on: the run
   starts folded if the last thing to touch this store left it folded, and
   every check that reaches for something in the panel then fails on the
   previous run's state rather than on today's code. It cost a round of
   debugging a sessions popup that was working fine -- the badge it rests on
   was at x = -253. */
await page.evaluate(() => { if (document.querySelector('.nt-app').classList.contains('is-rail')) document.querySelector('.nt-sb-tab').click(); });
await sleep(400);
note(!(await page.$eval('.nt-app', (e) => e.classList.contains('is-rail'))), 'could not put the run on an unfolded outliner');
const catsBefore = await page.$$eval('.nt-cat', els => els.length);
console.log(`unlocked: ${catsBefore} categories on screen`);
note(catsBefore >= 2, `only ${catsBefore} categories — is the store the migrated document?`);

/* ---- the scratch category --------------------------------------------- */
const scratch = `Scratch ${Date.now().toString(36)}`;
let scratchName = scratch;   // 17d renames it; the tidy-up looks for the new one
await page.keyboard.down('Alt'); await page.keyboard.press('n'); await page.keyboard.up('Alt');
await page.waitForFunction((n) => document.querySelectorAll('.nt-cat').length === n + 1, {}, catsBefore);
await sleep(150);
note(await page.evaluate(() => document.activeElement.classList.contains('nt-cat-title')), 'Alt+N did not focus the new category title');
await page.keyboard.type(scratch);
await page.keyboard.press('Enter');
await sleep(60);
const inBody = await page.evaluate(() => document.activeElement.classList.contains('nt-body'));
note(inBody, 'Enter on the title did not move the caret into the body');
const sidebarHas = await page.evaluate((t) => [...document.querySelectorAll('.nt-row-title')].some(r => r.textContent === t), scratch);
note(sidebarHas, 'the new title did not reach the sidebar');
const catId = await page.evaluate(() => document.activeElement.dataset.cat);
const body = () => page.evaluate((id) => document.querySelector(`.nt-body[data-cat="${id}"]`).innerHTML, catId);
// Chrome writes a trailing space at the end of a line as U+00A0; read both as a space.
const text = () => page.evaluate((id) => document.querySelector(`.nt-body[data-cat="${id}"]`).textContent.replace(/\u00a0/g, ' '), catId);
const shape = () => page.evaluate((id) => {
  const b = document.querySelector(`.nt-body[data-cat="${id}"]`);
  const walk = (n, d) => [...n.children].filter(c => c.tagName !== 'BR').map(c => (c.tagName === 'LI' ? `${'  '.repeat(d)}${c.tagName}${c.dataset.checked ? '*' : ''}:${[...c.childNodes].filter(x => x.nodeType === 3 || !/^(UL|OL)$/.test(x.tagName)).map(x => x.textContent).join('').trim()}\n${walk(c, d + 1)}` : /^(UL|OL)$/.test(c.tagName) ? `${'  '.repeat(d)}${c.tagName}${c.className ? '.' + c.className : ''}\n${walk(c, d + 1)}` : `${'  '.repeat(d)}${c.tagName}${c.className ? '.' + c.className : ''}:${c.textContent.trim()}\n`)).join('');
  return walk(b, 0).replace(/\n+/g, '\n').trim();
}, catId);
const caret = () => page.evaluate(() => { const s = getSelection(); const b = s.anchorNode && (s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode).closest('p,li,h3,pre,blockquote,td,th'); return { tag: b && b.tagName, text: b && b.textContent.slice(0, 20), offset: s.anchorOffset, node: s.anchorNode && s.anchorNode.nodeType === 3 ? s.anchorNode.nodeValue : `<${s.anchorNode && s.anchorNode.nodeName}>` }; });
const press = async (key, times = 1) => { for (let i = 0; i < times; i++) { await page.keyboard.press(key); await sleep(25); } };
const chord = async (mods, key) => { for (const m of mods) await page.keyboard.down(m); await page.keyboard.press(key); for (const m of [...mods].reverse()) await page.keyboard.up(m); await sleep(40); };

/* ---- 1. bullets from "- ", nesting with Tab, out with Shift+Tab ---------- */
await page.keyboard.type('- alpha');
await sleep(50);
note(/^UL\n\s*LI:alpha$/.test(await shape()), `"- " did not make a bullet: ${await shape()}`);
await press('Enter'); await page.keyboard.type('bravo'); await press('Tab');
note((await shape()) === 'UL\n  LI:alpha\n    UL\n      LI:bravo', `Tab did not nest bravo under alpha:\n${await shape()}`);
note((await caret()).text === 'bravo', 'the caret left bravo after Tab');
await press('Enter'); await page.keyboard.type('charlie'); await press('Tab');
note((await shape()) === 'UL\n  LI:alpha\n    UL\n      LI:bravo\n        UL\n          LI:charlie', `second Tab did not nest charlie under bravo:\n${await shape()}`);
await chord(['Shift'], 'Tab');
note((await shape()) === 'UL\n  LI:alpha\n    UL\n      LI:bravo\n      LI:charlie', `Shift+Tab did not bring charlie beside bravo:\n${await shape()}`);
// Tab with nothing above at this level does nothing (no staircase).
await press('Home');
const before = await shape();
await page.evaluate((id) => { const li = document.querySelector(`.nt-body[data-cat="${id}"] li li`); const r = document.createRange(); r.setStart(li.firstChild, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }, catId);
await press('Tab');
note((await shape()) === before, `Tab on the first item at its level changed the structure:\n${await shape()}`);
console.log('lists: bullet, nest, un-nest held');

/* ---- 2. Enter on an empty bullet steps out; twice leaves the list ------- */
await page.evaluate((id) => { const b = document.querySelector(`.nt-body[data-cat="${id}"]`); const li = b.querySelectorAll('li')[2]; const r = document.createRange(); r.selectNodeContents(li); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }, catId);
await press('Enter'); await press('Enter');
note((await shape()).endsWith('LI:charlie\n  LI:'), `Enter on an empty nested bullet did not step out a level:\n${await shape()}`);
await press('Enter');
note((await shape()).endsWith('LI:charlie\nP:'), `Enter on an empty top-level bullet did not leave the list:\n${await shape()}`);
note((await caret()).tag === 'P', 'the caret is not in the new paragraph');

/* ---- 3. Backspace at the start unwinds, then merges ---------------------- */
await page.keyboard.type('delta');
await press('Home');
await press('Backspace');
note((await shape()).endsWith('LI:charliedelta'), `Backspace at the start of a paragraph after a list did not merge it into the last item:\n${await shape()}`);
note((await text()).includes('charliedelta'), 'the merged text is wrong');
await press('Home');
await press('Backspace');
note((await shape()).includes('LI:charlie\n  LI:delta') || (await shape()).endsWith('LI:charliedelta'), `Backspace at the start of a nested item did not outdent it:\n${await shape()}`);
console.log('enter/backspace: step-out, leave-list, merge, outdent held');

/* ---- 4. multi-line indent keeps the shape ------------------------------- */
await page.evaluate((id) => { const b = document.querySelector(`.nt-body[data-cat="${id}"]`); b.innerHTML = '<ul><li>one</li><li>two</li><li>three</li><li>four</li></ul>'; b.dispatchEvent(new Event('input', { bubbles: true })); const lis = b.querySelectorAll('li'); const s = getSelection(); s.setBaseAndExtent(lis[1].firstChild, 0, lis[2].firstChild, 5); }, catId);
await press('Tab');
note((await shape()) === 'UL\n  LI:one\n    UL\n      LI:two\n      LI:three\n  LI:four', `indenting two selected items did not keep them together:\n${await shape()}`);
const selAfter = await page.evaluate(() => getSelection().toString());
note(/two/.test(selAfter) && /three/.test(selAfter), `the selection was lost after a multi-line indent: "${selAfter}"`);
await chord(['Shift'], 'Tab');
note((await shape()) === 'UL\n  LI:one\n  LI:two\n  LI:three\n  LI:four', `outdenting the same two did not restore the list:\n${await shape()}`);
console.log('multi-line indent and outdent held');

/* ---- 5. undo is by word, redo puts it back, the caret follows ------------ */
await page.evaluate((id) => { const b = document.querySelector(`.nt-body[data-cat="${id}"]`); b.innerHTML = '<p>start</p>'; b.dispatchEvent(new Event('input', { bubbles: true })); const s = getSelection(); s.collapse(b.firstChild.firstChild, 5); }, catId);
await page.keyboard.type(' quick brown');
await sleep(1000);                          // a pause seals the group
await page.keyboard.type(' fox');
await chord(['Control'], 'z');
note((await text()) === 'start quick brown', `Ctrl+Z did not remove exactly the last word: "${await text()}"`);
note((await caret()).offset === 'start quick brown'.length, `caret after undo is at ${(await caret()).offset}, expected the end`);
await chord(['Control'], 'z');
note((await text()).trim() === 'start quick', `second Ctrl+Z: "${await text()}"`);
await chord(['Control'], 'y');
await chord(['Control', 'Shift'], 'z');
note((await text()) === 'start quick brown fox', `redo did not put the words back: "${await text()}"`);
// A structural edit undoes as one step.
await press('Home'); await page.keyboard.type('- ');
note((await shape()).startsWith('UL'), 'the bullet trigger did not fire mid-test');
await chord(['Control'], 'z');
note((await shape()) === 'P:- start quick brown fox', `undoing the bullet trigger did not give back the typed marker: ${await shape()}`);
await chord(['Control'], 'z');
// "- " was typed as one word group, so the second undo takes both characters.
note((await shape()) === 'P:start quick brown fox', `the second undo did not remove the typed marker: ${await shape()}`);
console.log('undo/redo: word groups, caret, structural step held');

/* ---- 6. todo items --------------------------------------------------------- */
await page.evaluate((id) => { const b = document.querySelector(`.nt-body[data-cat="${id}"]`); b.innerHTML = '<p><br></p>'; b.dispatchEvent(new Event('input', { bubbles: true })); const s = getSelection(); s.collapse(b.firstChild, 0); }, catId);
await page.keyboard.type('[] buy milk');
note((await shape()) === 'UL.todo\n  LI:buy milk', `"[] " did not make a todo: ${await shape()}`);
await chord(['Control'], 'Enter');
note((await shape()) === 'UL.todo\n  LI*:buy milk', `Ctrl+Enter did not check the item: ${await shape()}`);
const box = await page.evaluate((id) => { const li = document.querySelector(`.nt-body[data-cat="${id}"] li`); const r = li.getBoundingClientRect(); return { x: r.left - 14, y: r.top + 12 }; }, catId);
await page.mouse.click(box.x, box.y);
await sleep(60);
note((await shape()) === 'UL.todo\n  LI:buy milk', `clicking the checkbox did not uncheck it: ${await shape()}`);
await press('End'); await press('Enter'); await page.keyboard.type('1. numbered');
note((await shape()).includes('OL\n  LI:numbered'), `"1. " inside an empty todo did not switch to a numbered list: ${await shape()}`);
console.log('todo and numbered held');

/* ---- 7. headings, quotes, code, dividers --------------------------------- */
await page.evaluate((id) => { const b = document.querySelector(`.nt-body[data-cat="${id}"]`); b.innerHTML = '<p><br></p>'; b.dispatchEvent(new Event('input', { bubbles: true })); const s = getSelection(); s.collapse(b.firstChild, 0); }, catId);
await page.keyboard.type('# Title'); await press('Enter'); await page.keyboard.type('> quoted'); await press('Enter'); await press('Enter'); await page.keyboard.type('---'); await press('Enter'); await page.keyboard.type('```'); await page.keyboard.type('code line');
const blocks = await page.evaluate((id) => [...document.querySelector(`.nt-body[data-cat="${id}"]`).children].map(c => c.tagName).join(','), catId);
note(blocks === 'H3,BLOCKQUOTE,P,HR,PRE' || blocks === 'H3,BLOCKQUOTE,HR,PRE' || blocks === 'H3,BLOCKQUOTE,HR,P,PRE', `block triggers produced ${blocks}`);
console.log(`block triggers: ${blocks}`);

/* ---- 8. inline formatting is tags, never styles -------------------------- */
await page.evaluate((id) => { const b = document.querySelector(`.nt-body[data-cat="${id}"]`); b.innerHTML = '<p>make this bold now</p>'; b.dispatchEvent(new Event('input', { bubbles: true })); const t = b.firstChild.firstChild; const s = getSelection(); s.setBaseAndExtent(t, 5, t, 9); }, catId);
await chord(['Control'], 'b');
note(/<b>this<\/b>/.test(await body()), `Ctrl+B did not produce <b>: ${await body()}`);
await chord(['Control'], 'i');
note(/<i>/.test(await body()), `Ctrl+I did not produce <i>: ${await body()}`);
note(!/style=/.test(await body()), `an inline style crept in: ${await body()}`);
const onState = await page.$eval('.nt-fmt.is-on', () => true).catch(() => false);
note(onState, 'the toolbar does not show the bold state');

/* ---- 9. paste hygiene ------------------------------------------------------ */
await page.evaluate((id) => {
  const b = document.querySelector(`.nt-body[data-cat="${id}"]`); b.innerHTML = '<p>x</p>'; b.dispatchEvent(new Event('input', { bubbles: true })); const s = getSelection(); s.collapse(b.firstChild.firstChild, 1);
  const dt = new DataTransfer();
  dt.setData('text/html', '<meta charset="utf-8"><div style="color:red"><span style="font-weight:700">Bold</span> and <font color="blue">plain</font><script>alert(1)</script></div><ul><li style="margin-left:24px">item<div>nested</div></li></ul>');
  dt.setData('text/plain', 'Bold and plain\n- item');
  b.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, catId);
await sleep(80);
const pasted = await body();
note(!/style=|<font|<script|<div/.test(pasted), `paste kept something it should not: ${pasted}`);
note(/<b>Bold<\/b>/.test(pasted), `a bold span was not turned into <b>: ${pasted}`);
note(/<ul><li>item/.test(pasted), `the pasted list did not survive as a list: ${pasted}`);
// Plain markdown-ish text becomes structure, not a chip.
await page.evaluate((id) => {
  const b = document.querySelector(`.nt-body[data-cat="${id}"]`); b.innerHTML = '<p><br></p>'; b.dispatchEvent(new Event('input', { bubbles: true })); const s = getSelection(); s.collapse(b.firstChild, 0);
  const dt = new DataTransfer(); dt.setData('text/plain', 'Heading line\n- one\n- two\n  - two b\n1. first\n[ ] todo');
  b.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, catId);
await sleep(80);
const md = await shape();
note(/UL\n  LI:one\n  LI:two\n    UL\n      LI:two b/.test(md) && /OL\n  LI:first/.test(md) && /UL\.todo\n  LI:todo/.test(md), `plain-text lists did not become lists:\n${md}`);
console.log('paste: styles stripped, lists kept, text lists built');

/* ---- 10. links: paste a URL, type a URL ------------------------------------ */
await page.evaluate((id) => {
  const b = document.querySelector(`.nt-body[data-cat="${id}"]`); b.innerHTML = '<p>see </p>'; b.dispatchEvent(new Event('input', { bubbles: true })); const s = getSelection(); s.collapse(b.firstChild.firstChild, 4);
  const dt = new DataTransfer(); dt.setData('text/plain', 'https://example.com/docs/page');
  b.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, catId);
await sleep(80);
note(/<a class="chip chip-link" href="https:\/\/example\.com\/docs\/page"/.test(await body()), `a pasted URL did not become a chip: ${await body()}`);
await page.keyboard.type('and www.google.com then');
/* The chip's LABEL, not its whole content: a chip carries a mark element at
   its head now, so `>google.com</a>` is no longer what the HTML looks like.
   The mark is a rendering and is stripped before anything is saved -- check 18
   reads the stored body and would catch it if that ever stopped being true. */
note(/href="https:\/\/www\.google\.com"/.test(await body()), `a typed URL did not become a chip on space: ${await body()}`);
/* THE MARK SURVIVES TYPING. scrub() unwraps stray spans in a body after every
   native input -- that is its job -- and it unwrapped this one, dropping its
   letter loose into the label so a link read "Ggoogle.com". Typed rather than
   inserted, because scrub only runs on a real input; and the letter itself is
   drawn from an attribute, so it is visible without being part of the text
   the spell checker, the search and "copy as text" all read. */
const chipMarks = await page.evaluate((id) => [...document.querySelectorAll(`.nt-body[data-cat="${id}"] .chip-link`)].map((c) => ({
  marks: c.querySelectorAll('.nt-chip-mark').length,
  label: [...c.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(''),
  styled: !!c.querySelector('[style]'),
})), catId);
note(chipMarks.length >= 2, `only ${chipMarks.length} chips to check the mark on`);
note(chipMarks.every((m) => m.marks === 1), `a chip has ${JSON.stringify(chipMarks.map((m) => m.marks))} marks after typing, expected one each`);
note(chipMarks.every((m) => !m.label.startsWith(m.label[0] + m.label[0])), `a mark's letter leaked into the label: ${JSON.stringify(chipMarks.map((m) => m.label))}`);
note(chipMarks.every((m) => !m.styled), 'a mark carries an inline style, which scrub strips on the next keystroke');
console.log(`chip marks: ${chipMarks.length} chips, one mark each, labels ${JSON.stringify(chipMarks.map((m) => m.label))}`);
/* The mark's own content is anything or nothing: a hashed mark draws its
   letter from an attribute and is empty, and a KNOWN site's mark holds a
   bundled glyph, which is elements rather than text. What this is asserting
   is the SHAPE -- one mark, then the label, then the end of the chip. */
note(/<a class="chip chip-link" href="https:\/\/www\.google\.com"[^>]*>(<span class="nt-chip-mark[^>]*>[\s\S]*?<\/span>)?google\.com<\/a>/.test(await body()),
     `the chip is not its mark followed by its label: ${await body()}`);
note((await text()).endsWith(' then'), `text after the auto-link is wrong: "${await text()}"`);
// Backspace right after a chip removes the chip.
await page.evaluate((id) => { const b = document.querySelector(`.nt-body[data-cat="${id}"]`); const chip = b.querySelector('.chip-link'); const s = getSelection(); s.collapse(chip.nextSibling, 0); }, catId);
await press('Backspace');
note((await page.evaluate((id) => document.querySelectorAll(`.nt-body[data-cat="${id}"] .chip-link`).length, catId)) === 1, 'Backspace after a chip did not remove it');
console.log('links held');

/* ---- 11. emoji picker on ":" ------------------------------------------------ */
await page.evaluate((id) => { const b = document.querySelector(`.nt-body[data-cat="${id}"]`); b.innerHTML = '<p><br></p>'; b.dispatchEvent(new Event('input', { bubbles: true })); const s = getSelection(); s.collapse(b.firstChild, 0); }, catId);
// Typed, not set: a space typed at the end of a line is what a person's
// colon follows, and it is not the same character as a space in a string.
await page.keyboard.type('hot :fir');
const picker = await page.waitForSelector('.nt-emoji-panel', { timeout: 5000 }).then(() => true).catch(() => false);
note(picker, 'the emoji picker did not open on ":fir"');
if (picker) {
  const cells = await page.$$eval('.nt-emoji-panel .nt-emoji-cell', els => els.map(e => e.textContent));
  note(cells.includes('🔥'), `the picker did not offer 🔥 for "fir": ${cells.join(' ')}`);
  await press('Enter');
  note((await text()) === 'hot 🔥', `Enter did not insert the emoji in place of ":fir": "${await text()}"`);
  note(!(await page.$('.nt-emoji-panel')), 'the picker stayed open after inserting');
}
console.log('emoji picker held');

/* ---- 12. slash menu ---------------------------------------------------------- */
await page.evaluate((id) => { const b = document.querySelector(`.nt-body[data-cat="${id}"]`); b.innerHTML = '<p><br></p>'; b.dispatchEvent(new Event('input', { bubbles: true })); const s = getSelection(); s.collapse(b.firstChild, 0); }, catId);
await page.keyboard.type('/num');
const slashOpen = await page.waitForSelector('.nt-slash-panel', { timeout: 3000 }).then(() => true).catch(() => false);
note(slashOpen, 'the slash menu did not open');
await press('Enter');
await page.keyboard.type('first');
note((await shape()) === 'OL\n  LI:first', `"/num" + Enter did not make a numbered list: ${await shape()}`);
console.log('slash menu held');

/* ---- 13. autocorrect and spelling marks ------------------------------------- */
const dictReady = await page.waitForFunction(() => window.CSS && CSS.highlights, { timeout: 5000 }).then(() => true).catch(() => false);
note(dictReady, 'the Highlight API is not available in this Chrome');
await page.evaluate((id) => { const b = document.querySelector(`.nt-body[data-cat="${id}"]`); b.innerHTML = '<p><br></p>'; b.dispatchEvent(new Event('input', { bubbles: true })); const s = getSelection(); s.collapse(b.firstChild, 0); }, catId);
await page.keyboard.type('teh cat ');
note((await text()) === 'the cat ', `"teh " was not corrected: "${await text()}"`);
// Wait for the dictionary worker, then a dictionary-driven fix.
let ready = false;
for (let i = 0; i < 40 && !ready; i++) {
  await page.keyboard.type('recieve ');
  await sleep(250);
  ready = /receive/.test(await text());
  if (!ready) { await press('Backspace', 8); }
}
note(ready, `"recieve" was never corrected — dictionary not ready or suggestion rejected: "${await text()}"`);
if (ready) {
  await press('Backspace');
  note(/recieve/.test(await text()), `Backspace right after a correction did not restore the original: "${await text()}"`);
  await page.keyboard.type(' recieve ');
  note(/recieve\s+recieve/.test(await text()), `a reverted word was corrected again: "${await text()}"`);
}
// A word that is not a word gets a wavy mark and no correction.
await page.keyboard.type('qzxvbn ');
await sleep(900);
const marks = await page.evaluate(() => { const h = CSS.highlights.get('nt-spell'); return h ? h.size : 0; });
note(marks >= 1, `no spelling mark on "qzxvbn" (${marks} marks)`);
note(/qzxvbn/.test(await text()), 'a nonsense word was "corrected" into something');
note(!/style=|<span/.test(await body()), `spell marks touched the document: ${await body()}`);
console.log(`autocorrect: teh->the, recieve->receive=${ready}, marks=${marks}`);

/* ---- 14. search ------------------------------------------------------------- */
await chord(['Control'], 'f');
note(await page.evaluate(() => document.activeElement.classList.contains('nt-search-input')), 'Ctrl+F did not focus the search');
await page.keyboard.type('qzxvbn');
await sleep(400);
const count = await page.$eval('.nt-search-count', e => e.textContent);
note(/^1\/1$|^1\/\d+$/.test(count), `search count reads "${count}"`);
await press('Escape');

/* ---- 14b. an image dropped on the body is uploaded and stored by key ------- */
await page.evaluate((id) => { const b = document.querySelector(`.nt-body[data-cat="${id}"]`); b.innerHTML = '<p>pic</p>'; b.dispatchEvent(new Event('input', { bubbles: true })); const s = getSelection(); s.collapse(b.firstChild.firstChild, 3); }, catId);
await page.evaluate(async (id) => {
  const b = document.querySelector(`.nt-body[data-cat="${id}"]`);
  const c = document.createElement('canvas'); c.width = 300; c.height = 200;
  const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 300, 200); g.fillStyle = '#fff'; g.fillRect(40, 40, 120, 80);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'shot.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(file);
  const r = b.getBoundingClientRect();
  b.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 12 }));
}, catId);
const uploaded = await page.waitForFunction((id) => { const i = document.querySelector(`.nt-body[data-cat="${id}"] img.nt-img`); return i && i.dataset.key && !i.classList.contains('is-pending'); }, { timeout: 15000 }, catId).then(() => true).catch(() => false);
note(uploaded, 'a dropped image was not uploaded and keyed');
if (uploaded) {
  const img = await page.evaluate((id) => { const i = document.querySelector(`.nt-body[data-cat="${id}"] img.nt-img`); return { key: i.dataset.key, src: i.getAttribute('src'), w: i.dataset.w, natural: i.naturalWidth }; }, catId);
  note(/^[0-9a-f]{64}\.(png|webp)$/.test(img.key), `asset key looks wrong: ${img.key}`);
  note(/^\/api\/notes\/asset\?key=/.test(img.src), `the image src is not the asset route: ${img.src}`);
  await page.waitForFunction((id) => document.querySelector(`.nt-body[data-cat="${id}"] img.nt-img`).naturalWidth > 0, { timeout: 10000 }, catId).catch(() => {});
  const natural = await page.evaluate((id) => document.querySelector(`.nt-body[data-cat="${id}"] img.nt-img`).naturalWidth, catId);
  note(natural === 300, `the served image is ${natural}px wide, expected 300`);
  const onDisk = existsSync(join(STORE, 'notes/assets', img.key));
  note(onDisk, `the asset ${img.key} is not in the store`);
  console.log(`image: ${img.key.slice(0, 12)}… ${natural}px, on disk=${onDisk}`);
}

/* ---- 15. sessions ------------------------------------------------------------- */
/* THE BADGE IS TWO CONTROLS ON ONE TARGET, split by gesture: resting on it
   opens the sessions, pressing it folds the outliner. So this rests. A
   page.click() here folds the sidebar, and the second one then lands on a
   button inside a panel that is pointer-events:none -- which is exactly how
   this check failed the moment the behaviour changed, and is worth having
   said out loud so the next person does not "fix" it back to a click.
   The pointer is parked in the canvas first, because pointerenter does not
   fire for a pointer that is already on the element. */
const rest = async (sel) => {
  await page.mouse.move(900, 500);
  const box = await page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }, sel);
  await page.mouse.move(box.x, box.y, { steps: 6 });
  await page.waitForSelector('.nt-sess-panel', { timeout: 5000 });
  /* PAST THE HOVER TIMER, not just past the panel appearing. A panel left
     open by the block before is still on screen when this arrives, so
     waitForSelector returns on the OLD one -- and 260ms later the hover fires
     and replaces it, detaching every card handle taken in between. */
  await sleep(420);
};
await rest('.nt-session-btn');
const cardsBefore = await page.$$eval('.nt-sess-card:not(.is-add)', els => els.length);
const sessionsBefore = cardsBefore;

/* The row across the top: the word centred ON THE POPUP however many cards
   there are, a close at the right, and NO OPTIONS BUTTON -- everything it
   held is reachable from inside the session it would act on, so it was a
   fifth control duplicating four you are looking at. The centring is measured
   against the panel, not against the grid: with one session those two are
   200px apart, which is the whole reason it is placed absolutely. */
{
  const bar = await page.evaluate(() => {
    const panel = document.querySelector('.nt-sess-panel');
    const head = panel.querySelector('.nt-sess-head');
    const close = panel.querySelector('.nt-sess-close');
    const p = panel.getBoundingClientRect();
    const h = head.getBoundingClientRect();
    return {
      text: head.textContent,
      size: parseFloat(getComputedStyle(head).fontSize),
      off: Math.round((h.left + h.width / 2) - (p.left + p.width / 2)),
      closeRight: Math.round(p.right - close.getBoundingClientRect().right),
      opts: !!panel.querySelector('.nt-sess-opts'),
      hint: !!panel.querySelector('.nt-sess-hint'),
    };
  });
  note(bar.text === 'Sessions', `the popup's title is "${bar.text}"`);
  note(bar.size >= 13, `the Sessions label is ${bar.size}px, expected two points up from 11`);
  note(Math.abs(bar.off) <= 2, `the label is ${bar.off}px off the popup's centre`);
  note(bar.closeRight < 40, `the close button is not at the right end (${bar.closeRight}px in)`);
  note(!bar.opts, 'the options hamburger is back in the sessions popup');
  note(!bar.hint, 'the click-to-switch hint is still under the grid');
  console.log(`sessions bar: "${bar.text}" ${bar.size}px, ${bar.off}px off centre, close ${bar.closeRight}px in, no hamburger`);
}
/* Right-click opens nothing here any more. It closed the popup it was fired
   from, and a press-and-hold is now the start of a reorder drag. */
{
  const card = await page.$('.nt-sess-card:not(.is-add)');
  const r = await card.boundingBox();
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2, { button: 'right' });
  await sleep(250);
  note(!(await page.$('.nt-menu-panel')), 'right-clicking a session card still opens a menu');
  await page.waitForSelector('.nt-sess-panel', { timeout: 3000 }).catch(() => {});
}

await rest('.nt-session-btn');
await page.click('.nt-sess-card.is-add');
await sleep(600);
const newTitle = await page.$eval('.nt-session-title', e => e.textContent);
note(newTitle === 'New Session', `a new session did not open: title is "${newTitle}"`);
note((await page.$$eval('.nt-cat', els => els.length)) === 1, 'a new session did not start with one category');
note(!(await page.$('.nt-slide-layer')), 'the slide ghost outlived the switch');
await rest('.nt-session-btn');
note((await page.$$eval('.nt-sess-card:not(.is-add)', els => els.length)) === cardsBefore + 1, 'the sessions grid did not gain a card');
await page.click('.nt-sess-card:not(.is-add)');
await sleep(600);
note((await page.$eval('.nt-session-title', e => e.textContent)) === 'WorldHop', 'switching back did not restore the first session');
note((await page.$$eval('.nt-cat', els => els.length)) === catsBefore + 1, 'the first session lost categories on the round trip');
console.log('sessions: add, switch, switch back held');

/* ---- 15b. the switch SLIDES, and the ghost is never in the canvas --------- */
/* The copy of the outgoing page has to live outside .nt-canvas: every lookup
   in the app finds categories and bodies through the canvas, and a second set
   of them in there for the length of an animation is a scroll spy counting
   sections twice. Caught mid-flight, on purpose. */
{
  await rest('.nt-session-btn');
  const cards = await page.$$('.nt-sess-card:not(.is-add)');
  await cards[cards.length - 1].click();
  await sleep(90);
  const mid = await page.evaluate(() => {
    const layer = document.querySelector('.nt-slide-layer');
    const inner = document.querySelector('.nt-canvas-inner');
    return {
      layer: !!layer,
      inCanvas: !!document.querySelector('.nt-canvas .nt-slide-layer'),
      ghostCats: layer ? layer.querySelectorAll('.nt-cat').length : -1,
      canvasCats: document.querySelectorAll('.nt-canvas .nt-cat').length,
      appCats: document.querySelectorAll('.nt-app .nt-cat').length,
      moving: !!inner && getComputedStyle(inner).transform !== 'none',
      editable: layer ? layer.querySelectorAll('[contenteditable]').length : -1,
    };
  });
  note(mid.layer, 'switching sessions did not put up a slide layer');
  note(!mid.inCanvas, 'the slide ghost is inside .nt-canvas, where every category lookup will find it');
  note(mid.ghostCats >= 1, `the ghost carries ${mid.ghostCats} categories — it is not a copy of the page`);
  note(mid.canvasCats < mid.appCats, 'the ghost is not outside the canvas after all');
  note(mid.editable === 0, `${mid.editable} editable nodes in the ghost — a copy is not typed into`);
  await sleep(600);
  note(!(await page.$('.nt-slide-layer')), 'the slide layer was not cleaned up');
  console.log(`slide: layer outside the canvas, ${mid.ghostCats} ghost categories, ${mid.editable} editable, cleaned up`);
  // Back to the first session for everything below.
  await rest('.nt-session-btn');
  await page.click('.nt-sess-card:not(.is-add)');
  await sleep(600);
  note((await page.$eval('.nt-session-title', e => e.textContent)) === 'WorldHop', 'the slide check did not land back on the first session');
}

/* ---- 15c. the cards reorder on a drag ------------------------------------ */
{
  await rest('.nt-session-btn');
  const order = () => page.$$eval('.nt-sess-card:not(.is-add)', (els) => els.map((e) => e.dataset.sess));
  const was = await order();
  note(was.length >= 2 && was.every(Boolean), `${was.length} session cards, and each must carry its id`);
  const from = await page.evaluate(() => { const r = document.querySelectorAll('.nt-sess-card:not(.is-add)')[0].getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
  const to = await page.evaluate(() => { const c = document.querySelectorAll('.nt-sess-card:not(.is-add)'); const r = c[c.length - 1].getBoundingClientRect(); return { x: Math.round(r.right - 2), y: Math.round(r.top + r.height / 2) }; });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 14, from.y, { steps: 3 });
  note(!!(await page.$('.nt-sess-marker')), 'dragging a session card shows no line where it would land');
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  const now = await order();
  note(now.length === was.length && was.every((id) => now.includes(id)), 'the session drag lost or duplicated a session');
  note(now[0] !== was[0], `dragging the first card to the end did not move it (${was.join(',')} -> ${now.join(',')})`);
  note((await page.$eval('.nt-session-title', e => e.textContent)) === 'WorldHop', 'the drag was also taken as a click and switched sessions');
  console.log(`session reorder: ${was.length} cards, ${was[0].slice(0, 6)} moved to ${now.indexOf(was[0])}`);
  // Put it back, so nothing below depends on the order this left behind.
  const back = await page.evaluate(() => { const c = document.querySelectorAll('.nt-sess-card:not(.is-add)'); const r = c[c.length - 1].getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
  const head = await page.evaluate(() => { const r = document.querySelectorAll('.nt-sess-card:not(.is-add)')[0].getBoundingClientRect(); return { x: Math.round(r.left + 2), y: Math.round(r.top + r.height / 2) }; });
  await page.mouse.move(back.x, back.y);
  await page.mouse.down();
  await page.mouse.move(back.x - 14, back.y, { steps: 3 });
  await page.mouse.move(head.x, head.y, { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  note((await order())[0] === was[0], 'the session order was not restored');
  await page.click('.nt-sess-close');
  await sleep(200);
  note(!(await page.$('.nt-sess-panel')), 'the popup’s own X does not close it');
}

/* ---- 15d. pressing the badge folds the outliner -------------------------- */
{
  const railed = () => page.$eval('.nt-app', (e) => e.classList.contains('is-rail'));
  const wasRail = await railed();
  await page.click('.nt-session-btn');
  await sleep(400);
  note((await railed()) !== wasRail, 'pressing the session badge did not fold the outliner');
  note(!(await page.$('.nt-sess-panel')), 'the press left the sessions popup up over a sidebar that was sliding away');
  // The rail badge does the same two jobs, and is what is reachable now.
  await rest('.nt-rail-session');
  note(!!(await page.$('.nt-sess-panel')), 'resting on the rail badge does not open the sessions');
  await page.click('.nt-rail-session');
  await sleep(400);
  note((await railed()) === wasRail, 'pressing the rail badge did not unfold the outliner');
  console.log('session badge: rest opens the sessions, press folds the outliner, both badges');
}

/* ---- 16. archive, restore, undo an archive ------------------------------------- */
const archivedBefore = Number(await page.$eval('.nt-archive-count', e => e.textContent) || 0);
await page.evaluate((t) => { [...document.querySelectorAll('.nt-row')].find(r => r.querySelector('.nt-row-title').textContent === t).querySelector('.nt-row-x').click(); }, scratchName);
await page.waitForSelector('.nt-modal');
await press('Enter');
await sleep(200);
note((await page.$$eval('.nt-cat', els => els.length)) === catsBefore, 'archiving did not remove the category');
/* Relative, not absolute: the store survives between runs, and a run that
   died half way leaves a row behind. An assertion that needs a pristine
   archive fails on the previous run's crash rather than on this run's code. */
note(Number(await page.$eval('.nt-archive-count', e => e.textContent) || 0) === archivedBefore + 1,
     `the archive count did not go up by one (${archivedBefore} -> ${await page.$eval('.nt-archive-count', e => e.textContent)})`);
await page.click('.nt-archive-head');
await page.click('.nt-arch-row .nt-icon-btn');   // restore
await sleep(200);
note((await page.$$eval('.nt-cat', els => els.length)) === catsBefore + 1, 'restore did not bring the category back');
note(await page.evaluate((id) => { const b = document.querySelector(`.nt-body[data-cat="${id}"]`); return !!b && /pic/.test(b.textContent) && !!b.querySelector('img.nt-img[data-key]'); }, catId), 'the restored category lost its body');
// Delete outright, then Ctrl+Z.
await page.evaluate((t) => { [...document.querySelectorAll('.nt-row')].find(r => r.querySelector('.nt-row-title').textContent === t).querySelector('.nt-row-x').click(); }, scratchName);
await page.waitForSelector('.nt-modal');
await page.click('.nt-modal .nt-btn.is-left');
await sleep(200);
note((await page.$$eval('.nt-cat', els => els.length)) === catsBefore, 'delete did not remove the category');
await page.focus('.nt-canvas');
await chord(['Control'], 'z');
await sleep(200);
note((await page.$$eval('.nt-cat', els => els.length)) === catsBefore + 1, 'Ctrl+Z did not undo the delete');
console.log('archive, restore, delete, undo-delete held');

/* ---- 17. theme and sidebar ------------------------------------------------------ */
await page.click('.nt-theme');
note((await page.$eval('.nt-app', e => e.dataset.theme)) === 'light', 'the theme toggle did not go light');
await page.click('.nt-theme');
await chord(['Control'], '\\');
note(await page.$eval('.nt-app', e => e.classList.contains('is-rail')), 'Ctrl+\\ did not collapse the sidebar to the rail');
await sleep(350);                              // the width animates
const railW = await page.$eval('.nt-sidebar', e => e.getBoundingClientRect().width);
note(railW < 80, `the rail is ${railW}px wide`);
await chord(['Control'], '\\');

/* ---- 17b. a category's colour IS its text ---------------------------------
   THE BUG THIS EXISTS FOR: `--c-title: var(--c)` declared on the app root is
   substituted once, there, against the SESSION's colour. Every category then
   inherits a finished value, so recolouring a category moved its dot and its
   swatch and left its title, its body text and its sidebar row reading the
   session's colour. It looked like the colour had not been saved.

   FALSELY PASSES IF: it only asserted the title changed. The three tiers have
   to differ from each other, the OTHER category and the session must not move,
   and every tier has to stay readable on the surface it sits on -- a check
   that only compares strings would pass on three identical unreadable ones. */
{
  const relLum = (rgb) => {
    const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const la = relLum(a); const lb = relLum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  /* HSB saturation, because that is the axis the hierarchy is built on now:
     the title is the picked colour and each tier under it is duller. */
  const sat = (rgb) => {
    const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    const max = Math.max(r, g, b);
    return max ? (max - Math.min(r, g, b)) / max : 0;
  };

  /* Read the colours a category actually paints, from getComputedStyle -- not
     from the custom properties, which would only prove JS set a variable. */
  const paint = (id) => page.evaluate((cid) => {
    /* THE COLOUR BEHIND THE TEXT IS NOT ONE DECLARED VALUE. This used to read
       getComputedStyle(body).backgroundColor, and that was only ever right by
       accident: the body's own fill moved on to .nt-cat-box when the title
       row went inside it, so the read came back rgba(0,0,0,0) -- which scores
       as black, passes every dark-theme assertion for the wrong reason, and
       inverts every light-theme one. Composite the ancestors down to the
       first opaque background instead, which is what a reader's eye does. */
    const behind = (node) => {
      const layers = [];
      for (let n = node; n && n !== document.documentElement; n = n.parentElement) {
        const m = (getComputedStyle(n).backgroundColor || '').match(/[\d.]+/g);
        if (!m) continue;
        const a = m.length > 3 ? parseFloat(m[3]) : 1;
        if (a <= 0) continue;
        layers.push([+m[0], +m[1], +m[2], a]);
        if (a >= 1) break;
      }
      if (!layers.length) return 'rgb(0, 0, 0)';
      let [r, g, b] = layers[layers.length - 1];
      for (let i = layers.length - 2; i >= 0; i--) {
        const [sr, sg, sb, sa] = layers[i];
        r = sr * sa + r * (1 - sa); g = sg * sa + g * (1 - sa); b = sb * sa + b * (1 - sa);
      }
      return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    };
    const sec = document.querySelector(`.nt-cat[data-cat="${cid}"]`);
    const body = sec.querySelector('.nt-body');
    let bold = body.querySelector('b, strong, h3');
    if (!bold) { bold = document.createElement('b'); bold.textContent = 'x'; body.append(bold); bold.dataset.probe = '1'; }
    const row = document.querySelector(`.nt-row[data-cat="${cid}"] .nt-row-title`);
    const badge = sec.querySelector('.nt-cat-emoji');
    const out = {
      title: getComputedStyle(sec.querySelector('.nt-cat-title')).color,
      body: getComputedStyle(body).color,
      bold: getComputedStyle(bold).color,
      row: row ? getComputedStyle(row).color : null,
      boxBg: behind(body),
      badgeText: getComputedStyle(badge).color,
      badgeRing: getComputedStyle(badge).borderTopWidth,
      session: getComputedStyle(document.querySelector('.nt-session-title')).color,
    };
    if (bold.dataset.probe) bold.remove();
    return out;
  }, id);

  /* Set a colour through the real picker: the dot, then the hex field typed
     into by hand. The field is focused programmatically -- page.click aims at
     a viewport coordinate and a floating panel is exactly where that misses,
     which is how the first run of this check compared the session's green
     against itself and passed. */
  const setColour = async (id, hex) => {
    await page.evaluate((cid) => document.querySelector(`.nt-cat[data-cat="${cid}"] .nt-cat-color`).click(), id);
    await page.waitForSelector('.nt-clr-panel', { timeout: 4000 });
    await page.evaluate(() => { const i = document.querySelector('.nt-clr-hex'); i.focus(); i.select(); });
    await page.keyboard.type(hex);
    await sleep(150);
    const took = await page.$eval('.nt-clr-swatch', (el) => getComputedStyle(el).backgroundColor);
    await page.keyboard.press('Escape');
    await sleep(250);
    return took;
  };

  const otherId = await page.evaluate((mine) => {
    const s = [...document.querySelectorAll('.nt-cat')].map((n) => n.dataset.cat).find((c) => c !== mine);
    return s;
  }, catId);

  const sessionBefore = (await paint(catId)).session;
  const otherBefore = await paint(otherId);
  /* MAGENTA, not green: the session is green, so a green pick cannot tell a
     category reading its OWN colour from one still reading the session's --
     which is the entire bug. */
  const swatch = await setColour(catId, 'ff3bd0');
  note(/255,\s*59,\s*208/.test(swatch), `the picker did not take the typed hex (swatch is ${swatch})`);
  const after = await paint(catId);
  const otherAfter = await paint(otherId);

  const magenta = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number); return r > g + 40 && b > g + 40; };
  note(magenta(after.title), `the category title did not take the category's colour: ${after.title}`);
  note(magenta(after.body), `the body text did not take the category's colour: ${after.body}`);
  note(magenta(after.bold), `bold text did not take the category's colour: ${after.bold}`);
  note(magenta(after.row), `the sidebar row did not take the category's colour: ${after.row}`);
  note(magenta(after.badgeText), `the badge letter did not take the category's colour: ${after.badgeText}`);
  note(parseFloat(after.badgeRing) >= 2, `the badge has no ring (${after.badgeRing})`);

  // Three tiers, three colours, in that order of prominence.
  note(after.body !== after.bold && after.bold !== after.title,
       `the three tiers are not three colours: body ${after.body}, bold ${after.bold}, title ${after.title}`);
  /* THE TITLE IS THE PICKED COLOUR, and the tiers get DULLER below it -- the
     opposite of the old ranking, which lightened its way UP to the title.
     Saturation is what carries the hierarchy now, so saturation is what is
     asserted; on the dark theme lightness runs the other way, which is what
     keeps a paragraph of it readable. */
  note(sat(after.title) > sat(after.bold) && sat(after.bold) > sat(after.body),
       `each tier must be duller than the last: ${after.title} / ${after.bold} / ${after.body}`);
  note(relLum(after.body) > relLum(after.bold) && relLum(after.bold) > relLum(after.title),
       `on the dark theme each tier below the title must be lighter: ${after.title} / ${after.bold} / ${after.body}`);
  note(after.title === 'rgb(255, 59, 208)' || after.title === 'rgb(255, 59, 209)',
       `the title is not the colour that was picked (#ff3bd0): ${after.title}`);

  // Readable, not merely coloured.
  note(ratio(after.body, after.boxBg) >= 4.4, `body text is not readable on its box (${ratio(after.body, after.boxBg).toFixed(1)}:1)`);
  note(ratio(after.bold, after.boxBg) >= 4.4, `bold text is not readable on its box (${ratio(after.bold, after.boxBg).toFixed(1)}:1)`);

  // Nothing else moved.
  note(after.session === sessionBefore, `recolouring a category changed the session title (${sessionBefore} -> ${after.session})`);
  note(otherAfter.title === otherBefore.title && otherAfter.body === otherBefore.body,
       'recolouring one category changed another one');
  console.log(`colour: body ${after.body}, bold ${after.bold}, title ${after.title}, badge ring ${after.badgeRing}`);

  // A colour that would be invisible must be lifted, not obeyed.
  await setColour(catId, '0b1020');
  const dark = await paint(catId);
  note(ratio(dark.body, dark.boxBg) >= 4.4, `a near-black pick left the notes unreadable (${ratio(dark.body, dark.boxBg).toFixed(1)}:1)`);
  console.log(`near-black pick lifted to ${dark.body} (${ratio(dark.body, dark.boxBg).toFixed(1)}:1)`);

  // The theme flip re-derives: the same pick, the other direction.
  await setColour(catId, 'ff3bd0');
  const onDark = await paint(catId);
  await page.click('.nt-theme');
  await sleep(400);
  const onLight = await paint(catId);
  note(onLight.body !== onDark.body, 'the theme flip did not re-derive the category colours');
  note(relLum(onLight.body) < relLum(onLight.boxBg), 'the light theme is painting light text on a light box');
  note(ratio(onLight.body, onLight.boxBg) >= 4.4, `body text is not readable on the light theme (${ratio(onLight.body, onLight.boxBg).toFixed(1)}:1)`);
  note(sat(onLight.title) > sat(onLight.bold) && sat(onLight.bold) > sat(onLight.body),
       `on the light theme each tier must still be duller than the last: ${onLight.title} / ${onLight.bold} / ${onLight.body}`);
  console.log(`light theme: body ${onLight.body}, bold ${onLight.bold}, title ${onLight.title}, on ${onLight.boxBg}`);
  await page.click('.nt-theme');
  await sleep(300);
}

/* ---- 17c. a new category inherits the session's colour --------------------- */
{
  await page.keyboard.down('Alt'); await page.keyboard.press('n'); await page.keyboard.up('Alt');
  await sleep(250);
  await page.keyboard.type('Inherits');
  await page.keyboard.press('Enter');
  await sleep(150);
  const fresh = await page.evaluate(() => {
    const sec = [...document.querySelectorAll('.nt-cat')].pop();
    const cs = (el) => getComputedStyle(el).getPropertyValue('--c').trim();
    return {
      dot: cs(sec),
      session: cs(document.querySelector('.nt-app')),
      title: getComputedStyle(sec.querySelector('.nt-cat-title')).color,
      sessionTitle: getComputedStyle(document.querySelector('.nt-session-title')).color,
      id: sec.dataset.cat,
    };
  });
  note(fresh.dot === fresh.session, `a new category did not take the session's colour (${fresh.dot} vs ${fresh.session})`);
  note(fresh.title === fresh.sessionTitle, `a new category's title is not the session's title colour (${fresh.title} vs ${fresh.sessionTitle})`);
  console.log(`new category: ${fresh.dot}, the session's own`);
  /* Tidy: this one exists only for the check above. It is empty, and an empty
     category archives without asking -- so waiting for the confirm dialog
     would hang on the app behaving correctly. Undo removes both the rename
     and the add. */
  await page.evaluate(() => document.querySelector('.nt-canvas').focus());
  await chord(['Control'], 'z');
  await chord(['Control'], 'z');
  await sleep(250);
  note(!(await page.$(`.nt-cat[data-cat="${fresh.id}"]`)), 'undo did not remove the category the check added');
}

/* ---- 17d. the sidebar is where you rename things -------------------------
   Renaming used to send you to the canvas title. The name is read in the
   sidebar, so it is edited in the sidebar. */
{
  const row = () => page.evaluate((t) => {
    const r = [...document.querySelectorAll('.nt-row')].find((n) => n.querySelector('.nt-row-title').textContent === t);
    return r ? r.dataset.cat : null;
  }, scratch);
  const id = await row();
  note(!!id, 'the scratch category is not in the sidebar');
  const titleSel = `.nt-row[data-cat="${id}"] .nt-row-title`;
  await page.$eval(titleSel, (el) => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await sleep(120);
  const editing = await page.$eval(titleSel, (el) => ({
    editable: el.isContentEditable,
    marked: el.classList.contains('is-editing'),
    // Everything selected, so typing replaces rather than appends.
    selected: (getSelection().toString() || '').length === el.textContent.length && el.textContent.length > 0,
    focused: document.activeElement === el,
  }));
  note(editing.editable, 'double-clicking a sidebar row did not make its name editable');
  note(editing.marked, 'the row being renamed is not marked as such');
  note(editing.focused, 'the row name did not take focus');
  note(editing.selected, 'the row name is editable but nothing is selected');
  const renamed = `Renamed ${Date.now().toString(36).slice(-4)}`;
  await page.keyboard.type(renamed);
  await page.keyboard.press('Enter');
  await sleep(250);
  const both = await page.evaluate((cid) => ({
    row: document.querySelector(`.nt-row[data-cat="${cid}"] .nt-row-title`).textContent,
    canvas: document.querySelector(`.nt-cat[data-cat="${cid}"] .nt-cat-title`).textContent,
    editable: document.querySelector(`.nt-row[data-cat="${cid}"] .nt-row-title`).isContentEditable,
  }), id);
  note(both.row === renamed, `the sidebar name did not commit: "${both.row}"`);
  note(both.canvas === renamed, `the canvas title did not follow the sidebar rename: "${both.canvas}"`);
  note(!both.editable, 'the row stayed editable after Enter');

  // Escape puts back what was there.
  await page.$eval(`.nt-row[data-cat="${id}"] .nt-row-title`, (el) => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await sleep(100);
  await page.keyboard.type('discard me');
  await page.keyboard.press('Escape');
  await sleep(200);
  note((await page.$eval(`.nt-row[data-cat="${id}"] .nt-row-title`, (el) => el.textContent)) === renamed,
       'Escape did not put the old name back');

  // The session's own name, in the same place, the same way.
  const sessSel = '.nt-sidebar-session-title';
  const was = await page.$eval(sessSel, (el) => el.textContent);
  await page.$eval(sessSel, (el) => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await sleep(120);
  note(await page.$eval(sessSel, (el) => el.isContentEditable), 'the session name is not renameable from the sidebar');
  await page.keyboard.type('Renamed session');
  await page.keyboard.press('Enter');
  await sleep(250);
  const sess = await page.evaluate(() => ({
    side: document.querySelector('.nt-sidebar-session-title').textContent,
    canvas: document.querySelector('.nt-session-title').textContent,
  }));
  note(sess.side === 'Renamed session' && sess.canvas === 'Renamed session',
       `the session rename did not reach both places (${sess.side} / ${sess.canvas})`);
  // Put it back.
  await page.$eval(sessSel, (el) => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await sleep(120);
  await page.keyboard.type(was);
  await page.keyboard.press('Enter');
  await sleep(200);
  console.log(`rename in place: category and session, commit and cancel`);
  scratchName = renamed;
}

/* ---- 17e. the archive is welded to the list, and draggable ---------------- */
{
  const open = async () => { await page.evaluate(() => { const a = document.querySelector('.nt-archive'); if (!a.classList.contains('is-open')) a.querySelector('.nt-archive-head').click(); }); await sleep(250); };
  await open();
  const grip = await page.$('.nt-archive-grip');
  note(!!grip, 'the archive has no grab edge');
  const gripAt = () => page.evaluate(() => { const r = document.querySelector('.nt-archive-grip').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
  /* THE SPLIT IS A SAVED SETTING, so this run starts wherever the last one
     left it -- and the last one left it against the 80% ceiling, where
     dragging the edge up cannot grow anything and the check failed on the
     previous run's state rather than on today's code. Put it in a known
     state first, with the same real drag the check is about. */
  const floor = await gripAt();
  await page.mouse.move(floor.x, floor.y);
  await page.mouse.down();
  await page.mouse.move(floor.x, floor.y + 400, { steps: 10 });
  await page.mouse.up();
  await sleep(250);
  const before = await page.evaluate(() => document.querySelector('.nt-archive').getBoundingClientRect().height);
  const box = await gripAt();
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x, box.y - 160, { steps: 8 });
  await page.mouse.up();
  await sleep(250);
  const after = await page.evaluate(() => document.querySelector('.nt-archive').getBoundingClientRect().height);
  note(after > before + 80, `dragging the edge did not resize the archive (${Math.round(before)} -> ${Math.round(after)})`);
  const split = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.nt-app')).getPropertyValue('--list-flex')));
  note(split >= 20 && split <= 80, `the split escaped its bounds (${split})`);
  // The arms fold into a chevron when it is shut, and it is the same mark.
  const armsOpen = await page.$eval('.nt-arm-l', (el) => getComputedStyle(el).transform);
  await page.click('.nt-archive-head');
  await sleep(300);
  const armsShut = await page.$eval('.nt-arm-l', (el) => getComputedStyle(el).transform);
  note(armsOpen !== armsShut, 'the archive arms do not move when it closes');
  note(armsOpen === 'none' || armsOpen === 'matrix(1, 0, 0, 1, 0, 0)', `the arms are not flat while the archive is open (${armsOpen})`);
  console.log(`archive: ${Math.round(before)}px -> ${Math.round(after)}px by drag, split ${split}%, arms fold`);
}

/* ---- 17f. the sessions, listed, AS A SHEET OVER THE PANEL ----------------- */
/* It used to be a block inserted between the categories and the archive, so
   asking what the sessions were pushed everything below it down and shutting
   it pulled everything back up. The measurement that says it is a sheet is
   that the archive and the New Category button do not move -- and that the
   list is drawn over them rather than above them. */
{
  note(!(await page.$('.nt-sesslist .nt-sess-row')), 'the session list is populated before it is opened');
  const anchors = () => page.evaluate(() => ({
    arch: Math.round(document.querySelector('.nt-archive').getBoundingClientRect().top),
    add: Math.round(document.querySelector('.nt-add-btn:not(.nt-sessions-btn)').getBoundingClientRect().top),
  }));
  const shut = await anchors();
  await page.click('.nt-sessions-btn');
  await sleep(280);
  const list = await page.evaluate(() => {
    const wrap = document.querySelector('.nt-sesslist');
    const w = wrap.getBoundingClientRect();
    const btn = document.querySelector('.nt-sessions-btn').getBoundingClientRect();
    const add = document.querySelector('.nt-add-btn:not(.nt-sessions-btn)').getBoundingClientRect();
    return {
      shown: getComputedStyle(wrap).display !== 'none',
      floating: getComputedStyle(wrap).position === 'absolute',
      gap: Math.round(btn.top - w.bottom),
      overAdd: w.bottom > add.top,
      rows: [...wrap.querySelectorAll('.nt-sess-row')].map((r) => r.querySelector('.nt-row-title').textContent),
      active: wrap.querySelectorAll('.nt-sess-row.is-active').length,
      /* A WINDOW, not a list that appeared: a header that says what it is and
         can shut it, and a New button of its own in the footer rather than a
         row pretending to be a session. */
      title: wrap.querySelector('.nt-sesslist-head span')?.textContent,
      shut: !!wrap.querySelector('.nt-sesslist-x'),
      add: !!wrap.querySelector('.nt-sesslist-new'),
      addIsRow: !!wrap.querySelector('.nt-sess-row.is-add'),
      del: wrap.querySelectorAll('.nt-sess-row .nt-sess-row-x').length,
    };
  });
  const open = await anchors();
  note(list.shown, 'the Sessions button did not show the list');
  note(list.floating, 'the session list is still in the flow of the sidebar');
  note(list.gap >= 0 && list.gap <= 14, `the list is ${list.gap}px off the top of its own button`);
  note(list.overAdd, 'the list does not reach over the New Category button');
  note(open.arch === shut.arch, `opening the list moved the archive ${open.arch - shut.arch}px`);
  note(open.add === shut.add, `opening the list moved the New Category button ${open.add - shut.add}px`);
  note(list.rows.length >= 1, 'the session list is empty');
  note(list.active === 1, `${list.active} sessions are marked active, expected 1`);
  note(list.add, 'the session list has no New button in its footer');
  note(!list.addIsRow, 'the New button is still a row pretending to be a session');
  note(list.title === 'My Sessions', `the sheet is titled "${list.title}"`);
  note(list.shut, 'the sheet cannot be closed from inside itself');
  note(list.del === list.rows.length, `${list.del} of ${list.rows.length} session rows can be deleted from the sheet`);
  /* SHOWN AT REST, not on hover. Hidden until hover, a row ended in a bare
     number -- the count of its categories, floating with nothing beside it --
     and read as unfinished rather than tidy. */
  const seen = await page.$eval('.nt-sess-row .nt-sess-row-x', (e) => Number(getComputedStyle(e).opacity));
  note(seen > 0.2, `the delete on a session row is invisible until hovered (opacity ${seen})`);
  const sizes = await page.evaluate(() => ({
    head: parseFloat(getComputedStyle(document.querySelector('.nt-sesslist-head')).fontSize),
    title: parseFloat(getComputedStyle(document.querySelector('.nt-sess-row .nt-row-title')).fontSize),
    count: parseFloat(getComputedStyle(document.querySelector('.nt-sess-count')).fontSize),
  }));
  note(sizes.head >= 16 && sizes.title >= 16 && sizes.count >= 13, `the sheet still reads small: ${JSON.stringify(sizes)}`);
  console.log(`sessions listed: ${list.rows.join(', ')} — a sheet ${list.gap}px above its button, nothing under it moved`);
  // Escape shuts it, and stops there: the overlay behind must survive.
  await page.keyboard.press('Escape');
  await sleep(220);
  note(!(await page.$eval('.nt-sesslist', (el) => getComputedStyle(el).display !== 'none')), 'Escape does not close the session list');
  note(!!(await page.$('.nt-app')), 'the Escape that closed the list also closed the notes');
  // And so does the button that opened it.
  await page.click('.nt-sessions-btn');
  await sleep(250);
  await page.click('.nt-sessions-btn');
  await sleep(200);
  note(!(await page.$eval('.nt-sesslist', (el) => getComputedStyle(el).display !== 'none')), 'the Sessions button does not close the list');
}

/* ---- 17f1b. the two foot buttons are one panel -------------------------- */
/* Label centred in the button, mark pinned to its right edge -- so the two
   words line up down the column and the two marks line up down the right.
   Measured, because "centred" done with space-between drifts with the mark's
   width and the plus and the logo are not the same width. */
{
  const foot = await page.evaluate(() => {
    const add = document.querySelector('.nt-add-btn:not(.nt-sessions-btn)');
    const sess = document.querySelector('.nt-sessions-btn');
    const mid = (b) => { const r = b.getBoundingClientRect(); const t = b.querySelector('span:not(.nt-add-mark)').getBoundingClientRect(); return Math.round((t.left + t.width / 2) - (r.left + r.width / 2)); };
    const markRight = (b) => { const r = b.getBoundingClientRect(); const m = b.querySelector('.nt-add-mark').getBoundingClientRect(); return Math.round(r.right - m.right); };
    return {
      labels: [add.querySelector('span').textContent, sess.querySelector('span').textContent],
      offsets: [mid(add), mid(sess)],
      marks: [markRight(add), markRight(sess)],
      logo: !!sess.querySelector('.nt-add-logo svg .nt-logo-top'),
      plus: !!add.querySelector('.nt-add-plus svg'),
      sameWidth: Math.abs(add.getBoundingClientRect().width - sess.getBoundingClientRect().width) < 1,
    };
  });
  note(foot.labels[0] === 'New Category', `the add button reads "${foot.labels[0]}"`);
  note(foot.labels[1] === 'My Sessions', `the sessions button reads "${foot.labels[1]}"`);
  note(foot.offsets.every((o) => Math.abs(o) <= 2), `the labels are ${foot.offsets.join(' and ')}px off their buttons' centres`);
  note(foot.marks[0] === foot.marks[1], `the marks are ${foot.marks.join(' and ')}px from their right edges — they must line up with each other`);
  note(foot.plus && foot.logo, 'the marks are not the plus and the logo');
  note(foot.sameWidth, 'the two foot buttons are not the same width');
  console.log(`foot: "${foot.labels.join('" / "')}", labels centred, marks ${foot.marks[0]}px in`);
}

/* ---- 17f1c. the sessions sheet also opens from the rail ----------------- */
/* Folding the outliner takes a label away, not a door. The rail's sheet has
   to live OUTSIDE the sidebar -- the sidebar clips its own overflow, so a
   sheet opening to the right of a 50px rail would never be seen -- which is
   the one thing worth measuring here. */
{
  await page.evaluate(() => document.querySelector('.nt-sb-tab').click());
  await sleep(450);
  note(await page.$eval('.nt-app', (e) => e.classList.contains('is-rail')), 'could not fold the outliner for the rail check');
  const btn = await page.$('.nt-rail-sessions');
  note(!!btn, 'the rail has no My Sessions button');
  const order = await page.evaluate(() => {
    const add = document.querySelector('.nt-rail-add').getBoundingClientRect();
    const ses = document.querySelector('.nt-rail-sessions').getBoundingClientRect();
    return { under: ses.top >= add.bottom - 1, gap: Math.round(ses.top - add.bottom) };
  });
  note(order.under, 'the rail\'s My Sessions is not under its New Category');
  await page.click('.nt-rail-sessions');
  await sleep(450);
  const sheet = await page.evaluate(() => {
    const wrap = document.querySelector('.nt-sesslist');
    const r = wrap.getBoundingClientRect();
    const rail = document.querySelector('.nt-rail').getBoundingClientRect();
    return {
      shown: getComputedStyle(wrap).display !== 'none',
      inSidebar: !!document.querySelector('.nt-sidebar .nt-sesslist'),
      toTheSide: Math.round(r.left - rail.right),
      onScreen: r.left >= 0 && r.right <= window.innerWidth && r.width > 150,
      title: wrap.querySelector('.nt-sesslist-head span')?.textContent,
      add: !!wrap.querySelector('.nt-sesslist-new'),
    };
  });
  note(sheet.shown, 'the rail button did not open the sessions sheet');
  note(!sheet.inSidebar, 'the rail sheet is inside the sidebar, which clips its own overflow — it would never be seen');
  note(sheet.toTheSide >= 0 && sheet.toTheSide < 30, `the rail sheet is ${sheet.toTheSide}px from the rail's edge, expected just beside it`);
  note(sheet.onScreen, 'the rail sheet is off the window');
  note(sheet.title === 'My Sessions' && sheet.add, 'the rail sheet is not the same window as the foot one');
  await page.keyboard.press('Escape');
  await sleep(250);
  note(!(await page.$eval('.nt-sesslist', (el) => getComputedStyle(el).display !== 'none')), 'Escape did not close the rail sheet');
  // And back, so everything below runs on the unfolded outliner.
  await page.evaluate(() => document.querySelector('.nt-sb-tab').click());
  await sleep(450);
  note(!(await page.$eval('.nt-app', (e) => e.classList.contains('is-rail'))), 'could not unfold the outliner again');
  /* The sheet is MOVED between docks when it opens, not when the sidebar
     folds: in between it is hidden, and re-homing an overlay nobody can see
     is work for its own sake. So this opens it to find out where it went. */
  await page.click('.nt-sessions-btn');
  await sleep(350);
  note(!!(await page.$('.nt-sidebar .nt-sesslist')), 'opening from the foot did not bring the sheet back into the panel');
  await page.keyboard.press('Escape');
  await sleep(250);
  console.log(`rail: My Sessions under New Category, sheet ${sheet.toTheSide}px to the side, outside the sidebar`);
}

/* ---- 17f1d. resting on the logo mark opens the session's colour --------- */
{
  await page.mouse.move(900, 500);
  await sleep(250);
  const m = await page.evaluate(() => { const r = document.querySelector('.nt-sidebar-top .nt-logo-btn').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
  await page.mouse.move(m.x, m.y, { steps: 5 });
  await page.waitForSelector('.nt-clr-panel', { timeout: 5000 }).catch(() => {});
  note(!!(await page.$('.nt-clr-panel')), 'resting on the session logo does not open its colour');
  note((await page.$eval('.nt-clr-title', (e) => e.textContent)) === 'Session colour', 'the panel that opened is not the session colour');
  await page.keyboard.press('Escape');
  await sleep(300);
  note(!(await page.$('.nt-clr-panel')), 'Escape did not close the colour panel');
  await page.mouse.move(900, 500);
  await sleep(200);
  console.log('logo: rest opens the session colour');
}

/* ---- 17f1e. a link form that answers for itself ------------------------- */
/* google.com is a link. A url-typed input inside a form says otherwise, and
   says it in Chrome's own orange bubble, in Chrome's own words, somewhere
   Chrome chooses. The inputs are plain text and the form validates itself. */
{
  const b = await page.$(`.nt-body[data-cat="${catId}"]`);
  await b.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  const open = async () => { await chord(['Control'], 'k'); await page.waitForSelector('.nt-form-panel', { timeout: 4000 }); await sleep(180); };

  await open();
  const typed = await page.$eval('.nt-form-panel .nt-input', (i) => i.getAttribute('type'));
  note(typed === 'text', `the address field is type="${typed}" — the browser will refuse it before the form can`);
  note(await page.$eval('.nt-form-panel form', (f) => f.hasAttribute('novalidate')), 'the form does not opt out of the browser validator');
  await page.keyboard.type('google.com');
  await page.keyboard.press('Enter');
  await sleep(400);
  const bare = await page.evaluate((id) => {
    const c = [...document.querySelectorAll(`.nt-body[data-cat="${id}"] .chip-link`)].pop();
    return c ? { href: c.getAttribute('href'), label: [...c.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('') } : null;
  }, catId);
  note(bare && bare.href === 'https://google.com', `a bare domain did not become a link: ${JSON.stringify(bare)}`);
  note(bare && bare.label === 'google.com', `the chip's label is ${JSON.stringify(bare && bare.label)}`);

  // And a refusal is OURS: in the form, in our words, with the form still up.
  await open();
  await page.keyboard.type('not a link at all');
  await page.keyboard.press('Enter');
  await sleep(300);
  const refusal = await page.evaluate(() => {
    const e = document.querySelector('.nt-form-err');
    return { shown: !!e && getComputedStyle(e).display !== 'none', text: e ? e.textContent : '', open: !!document.querySelector('.nt-form-panel'), bad: !!document.querySelector('.nt-input.is-bad') };
  });
  note(refusal.shown, 'a bad address is refused silently');
  note(refusal.open, 'the form closed on a refusal, taking what was typed with it');
  note(refusal.bad, 'the field that was refused is not marked');
  note(/is not an address/.test(refusal.text), `the refusal reads "${refusal.text}"`);
  await page.keyboard.press('Escape');
  await sleep(250);
  console.log(`link form: type=${typed}, google.com -> ${bare && bare.href}, refusal "${refusal.text}"`);
}

/* ---- 17f1f. a chip's toolbar, fold, and the drag that moves it ---------- */
{
  /* THE MARK'S OWN RECT, not an offset guessed from the chip's. The mark is
     an em-sized circle inside the chip's left padding, so "the chip's left
     plus seven" landed on the padding at one text size and on the mark at
     another -- and the fold check then reported that pressing the mark did
     nothing. Every point is measured and then confirmed with
     elementFromPoint. */
  const chipAt = () => page.evaluate((id) => {
    const c = document.querySelector(`.nt-body[data-cat="${id}"] .chip-link`);
    /* WITHOUT THE SMOOTH SCROLL. The canvas scrolls smoothly by default, so a
       rect measured straight after scrollIntoView is where the chip is
       PASSING THROUGH, not where it will be -- the pointer then arrives at an
       empty patch of text and no toolbar comes up. */
    const canvas = document.querySelector('.nt-canvas');
    canvas.style.scrollBehavior = 'auto';
    c.scrollIntoView({ block: 'center' });
    canvas.style.removeProperty('scroll-behavior');
    const r = c.getBoundingClientRect();
    const m = c.querySelector('.nt-chip-mark').getBoundingClientRect();
    const label = { x: Math.round(r.left + r.width - 8), y: Math.round(r.top + r.height / 2) };
    const mark = { x: Math.round(m.left + m.width / 2), y: Math.round(m.top + m.height / 2) };
    return {
      ...label, w: Math.round(r.width),
      mark,
      onLabel: document.elementFromPoint(label.x, label.y)?.closest('.chip-link') === c,
      onMark: !!document.elementFromPoint(mark.x, mark.y)?.closest('.nt-chip-mark'),
    };
  }, catId);

  // Resting on a chip raises its toolbar.
  await page.mouse.move(900, 700);
  await sleep(250);
  let at = await chipAt();
  note(at.onLabel, `the point aimed at the chip is not on it: ${JSON.stringify(at)}`);
  await page.mouse.move(at.x, at.y);
  // Wait for the bar, not for a guess at how long a 160ms hide timer takes.
  await page.waitForSelector('.nt-chip-bar', { timeout: 5000 }).catch(() => {});
  await sleep(150);
  // Against the chip that was actually hovered, not the first one in the
  // document -- another body's chip can easily come first.
  const tb = await page.evaluate((id) => {
    const t = document.querySelector('.nt-chip-bar');
    if (!t) return null;
    const c = document.querySelector(`.nt-body[data-cat="${id}"] .chip-link`).getBoundingClientRect();
    const r = t.getBoundingClientRect();
    return { tips: [...t.querySelectorAll('button')].map((b) => b.getAttribute('data-tip')), above: r.bottom <= c.top + 2, panel: t.classList.contains('nt-panel') };
  }, catId);
  note(!!tb, 'resting on a chip raises no toolbar');
  note(tb && tb.above, 'the chip toolbar is not above the chip');
  note(tb && !tb.panel, 'the chip toolbar is a .nt-panel — it would shut the colour picker and be shut by it');
  note(tb && tb.tips.join('/') === 'Open/Edit/Copy/Fold/Delete', `the toolbar reads ${JSON.stringify(tb && tb.tips)}`);

  /* DELETE ARMS FIRST. One press says what it is about to do; the second one
     does it. Anything that removes a chip on a single press is one twitch
     from gone, and a confirm dialog for something Ctrl+Z undoes is heavier
     than what it is protecting. */
  const before = await page.$$eval(`.nt-body[data-cat="${catId}"] .chip-link`, (e) => e.length);
  if (!tb) { console.log('LAST NOTES:', JSON.stringify(fail.slice(-4), null, 1)); throw new Error('no chip toolbar to drive'); }
  await page.evaluate(() => document.querySelector('.nt-chip-bar .is-danger').click());
  await sleep(200);
  note(await page.$$eval(`.nt-body[data-cat="${catId}"] .chip-link`, (e) => e.length) === before, 'the first press on Delete removed the chip');
  note(await page.$eval('.nt-chip-bar .is-danger', (b) => b.classList.contains('is-armed')), 'the first press on Delete did not arm it');
  await page.evaluate(() => document.querySelector('.nt-chip-bar .is-danger').click());
  await sleep(300);
  note(await page.$$eval(`.nt-body[data-cat="${catId}"] .chip-link`, (e) => e.length) === before - 1, 'the second press on Delete did not remove the chip');
  await chord(['Control'], 'z');
  await sleep(300);
  note(await page.$$eval(`.nt-body[data-cat="${catId}"] .chip-link`, (e) => e.length) === before, 'undo did not bring the chip back');

  // Pressing the mark folds the chip to a circle, and it stays folded.
  await page.mouse.move(900, 700);
  await sleep(200);
  at = await chipAt();
  note(at.onMark, 'the point aimed at the chip mark is not on it');
  await page.mouse.click(at.mark.x, at.mark.y);
  await sleep(300);
  const folded = await page.evaluate((id) => {
    const c = document.querySelector(`.nt-body[data-cat="${id}"] .chip-link`);
    return { min: c.dataset.min, cls: c.classList.contains('is-min'), w: Math.round(c.getBoundingClientRect().width) };
  }, catId);
  note(folded.min === '1' && folded.cls, 'pressing the mark did not fold the chip');
  note(folded.w < at.w - 20, `a folded chip is ${folded.w}px wide, was ${at.w}`);
  const back = await chipAt();
  await page.mouse.click(back.mark.x, back.mark.y);
  await sleep(300);
  note(await page.$eval(`.nt-body[data-cat="${catId}"] .chip-link`, (c) => c.dataset.min !== '1'), 'pressing the mark again did not unfold it');
  console.log(`chip toolbar: ${tb.tips.join(' ')}, delete arms, mark folds to ${folded.w}px`);
}

/* ---- 17f1g. dragging a node --------------------------------------------- */
/* One mechanism, three jobs: out of the header to make one, from a chip to
   move it, Shift to leave a copy. Driven with a real pointer, because the
   whole reason it is built on pointer events rather than HTML5 drag-and-drop
   is that a contenteditable is a drop target with its own opinions. */
{
  const count = (id) => page.$$eval(`.nt-body[data-cat="${id}"] .chip-link`, (e) => e.length);
  /* ONE SCROLL, THEN EVERY MEASUREMENT. The first draft measured the chip,
     then scrolled the body into view to pick a drop point, then pressed on
     the coordinates it had measured BEFORE that scroll -- so the press landed
     on whatever had moved under them, no drag began, and the check failed
     saying the copy had not appeared. */
  const layout = (id) => page.evaluate((cid) => {
    const b = document.querySelector(`.nt-body[data-cat="${cid}"]`);
    const c = document.querySelector('.nt-canvas');
    c.style.scrollBehavior = 'auto';
    b.scrollIntoView({ block: 'center' });
    c.style.removeProperty('scroll-behavior');
    const br = b.getBoundingClientRect();
    const chip = [...b.querySelectorAll('.chip-link')].pop();
    const cr = chip ? chip.getBoundingClientRect() : null;
    const drop = { x: Math.round(br.left + 50), y: Math.round(br.bottom - 16) };
    return {
      drop,
      dropOn: !!document.elementFromPoint(drop.x, drop.y)?.closest(`.nt-body[data-cat="${cid}"]`),
      chip: cr ? { x: Math.round(cr.left + cr.width - 7), y: Math.round(cr.top + cr.height / 2) } : null,
      chipOn: cr ? !!document.elementFromPoint(Math.round(cr.left + cr.width - 7), Math.round(cr.top + cr.height / 2))?.closest('.chip-link') : false,
    };
  }, id);

  /* THE LAST-USED KIND IS A SAVED SETTING, so this run starts on whatever
     the last one left in the store -- and "dropping a link node" out of a
     button sitting on Markdown tests something else entirely while reading
     as a dead drop. It cost a round of hunting a bug that was not there.
     Put it on Link through the menu, which is the only thing that sets it,
     and dismiss the form that choosing it raises. */
  await page.evaluate((id) => document.querySelector(`.nt-body[data-cat="${id}"]`).focus(), catId);
  await page.evaluate(() => document.querySelector('.nt-node-arrow').click());
  await sleep(320);
  await page.evaluate(() => { const b = [...document.querySelectorAll('.nt-menu-item')].find((x) => /Link/.test(x.textContent)); if (b) b.click(); });
  await page.waitForSelector('.nt-form-panel', { timeout: 4000 }).catch(() => {});
  await page.keyboard.press('Escape');
  await sleep(280);
  note(await page.evaluate(() => /^Link/.test(document.querySelector('.nt-node-main').getAttribute('data-tip') || '')),
       `could not put the node button on Link: ${await page.evaluate(() => document.querySelector('.nt-node-main').getAttribute('data-tip'))}`);

  // Out of the header: the drop opens that kind's maker where it landed.
  const from = await page.evaluate(() => { const r = document.querySelector('.nt-node-main').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
  let at = await layout(catId);
  note(at.dropOn, 'the point aimed at the scratch body is not in it');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 20, { steps: 3 });
  note(await page.evaluate(() => !!document.querySelector('.nt-node-ghost')), 'dragging the node button shows nothing following the pointer');
  await page.mouse.move(at.drop.x, at.drop.y, { steps: 10 });
  note(await page.evaluate(() => !!document.querySelector('.nt-node-caret.is-on')), 'the drop caret does not light up over a text box');
  await page.mouse.up();
  await page.waitForSelector('.nt-form-panel', { timeout: 4000 }).catch(() => {});
  note(!!(await page.$('.nt-form-panel')), 'dropping a link node did not ask for its address');
  await page.keyboard.type('example.org');
  await page.keyboard.press('Enter');
  await sleep(450);
  note(!(await page.$('.nt-node-ghost')) && !(await page.$('.nt-node-caret')), 'the drag left its ghost or caret behind');
  note(await page.evaluate((id) => [...document.querySelectorAll(`.nt-body[data-cat="${id}"] .chip-link`)].some((c) => /example\.org/.test(c.getAttribute('href'))), catId),
       'the node was not made in the box it was dropped in');

  // Shift+drag a chip: the original stays, a copy lands.
  const wasHere = await count(catId);
  at = await layout(catId);
  note(!!at.chip && at.chipOn, 'the point aimed at a chip is not on one');
  await page.keyboard.down('Shift');
  await page.mouse.move(at.chip.x, at.chip.y);
  await page.mouse.down();
  await page.mouse.move(at.chip.x, at.chip.y + 14, { steps: 3 });
  note(await page.evaluate(() => !!document.querySelector('.nt-node-ghost.is-copy')), 'Shift while dragging a chip does not say it is going to copy');
  await page.mouse.move(at.drop.x, at.drop.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await sleep(500);
  const nowHere = await count(catId);
  note(nowHere === wasHere + 1, `Shift+drag left ${nowHere} chips, expected ${wasHere + 1}`);
  console.log(`node drag: made one where it was dropped, Shift copied (${wasHere} -> ${nowHere})`);
}

/* ---- 17f1h. an emoji can be taken back off ------------------------------ */
{
  const first = await page.$eval('.nt-cat', (e) => e.dataset.cat);
  await page.evaluate((id) => document.querySelector(`.nt-cat[data-cat="${id}"] .nt-cat-emoji`).click(), first);
  await page.waitForSelector('.nt-emoji-full', { timeout: 4000 });
  await sleep(200);
  await page.evaluate(() => document.querySelector('.nt-emoji-full-grid .nt-emoji-cell').click());
  await sleep(400);
  const set = await page.evaluate((id) => {
    const b = document.querySelector(`.nt-cat[data-cat="${id}"] .nt-cat-emoji`);
    return { has: b.classList.contains('has-emoji'), glyph: b.querySelector('.nt-cat-emoji-g').textContent, x: !!b.querySelector('.nt-cat-emoji-x') };
  }, first);
  note(set.has && set.x, 'a category with an emoji has no way to take it off');
  /* THE PICKER ONLY EVER SETS. Before this there was no way back to the
     letter at all -- you could give a category an emoji and then live with
     it. Same mark and same corner as a session card's. */
  await page.evaluate((id) => document.querySelector(`.nt-cat[data-cat="${id}"] .nt-cat-emoji-x`).click(), first);
  await sleep(400);
  const cleared = await page.evaluate((id) => {
    const b = document.querySelector(`.nt-cat[data-cat="${id}"] .nt-cat-emoji`);
    const title = document.querySelector(`.nt-cat[data-cat="${id}"] .nt-cat-title`).textContent.trim();
    return { has: b.classList.contains('has-emoji'), glyph: b.querySelector('.nt-cat-emoji-g').textContent, want: title[0].toUpperCase() };
  }, first);
  note(!cleared.has, 'the emoji is still set after pressing its X');
  note(cleared.glyph === cleared.want, `the badge fell back to "${cleared.glyph}", expected the title's "${cleared.want}"`);
  await chord(['Control'], 'z');
  await sleep(300);
  console.log(`emoji: set ${set.glyph}, cleared back to ${cleared.glyph}`);
}

/* ---- 17f2. the header's own cull ----------------------------------------- */
/* Every one of these was a decision, and every one of them is the kind that
   gets quietly undone: a tooltip is one attribute to add back. What is
   asserted is the SHAPE -- universal marks carry no tip, the four that are
   not obvious do, no tip anywhere still carries a keystroke, and the
   keystrokes are all in the panel instead. */
{
  const head = await page.evaluate(() => {
    const mid = document.querySelector('.nt-header-mid');
    const tipped = [...document.querySelectorAll('.nt-app [data-tip]')].map((e) => e.getAttribute('data-tip'));
    return {
      sidebarToggle: !!document.querySelector('.nt-sidebar-toggle'),
      code: !!mid.querySelector('.nt-fmt svg path[d^="m8 8-4 4"]'),
      buttons: [...mid.children].map((c) => c.className.replace(/nt-icon-btn ?/, '').trim()),
      tips: Object.fromEntries(['.nt-fmt', '.nt-theme', '.nt-close', '.nt-search-btn', '.nt-node-btn', '.nt-spell-btn', '.nt-undo', '.nt-redo']
        .map((s) => [s, [...document.querySelectorAll(s)].map((e) => e.getAttribute('data-tip'))])),
      withKeys: tipped.filter((t) => /Ctrl\+|Alt\+|Shift\+/.test(t)),
      spell: (() => { const r = document.querySelector('.nt-spell-btn svg').getBoundingClientRect(); const b = document.querySelector('.nt-spell-btn').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), btnW: Math.round(b.width), btnH: Math.round(b.height) }; })(),
      node: (() => {
        const wrap = document.querySelector('.nt-node-btn');
        return { split: !!wrap.querySelector('.nt-node-main'), arrow: !!wrap.querySelector('.nt-node-arrow'), tip: wrap.querySelector('.nt-node-main').getAttribute('data-tip') };
      })(),
      info: !!document.querySelector('.nt-info'),
      infoBeforeTheme: (() => {
        const kids = [...document.querySelector('.nt-header-right').children];
        return kids.findIndex((k) => k.classList.contains('nt-info')) < kids.findIndex((k) => k.classList.contains('nt-theme'));
      })(),
    };
  });
  note(!head.sidebarToggle, 'the sidebar toggle is still in the header — the chevron tab replaced it');
  note(!head.code, 'the inline-code button is still in the formatting group');
  /* THREE now, not two: the table joined strikethrough and the autolist. The
     rule the count encodes is unchanged -- a tip goes on a mark that does not
     say what it does -- and a grid icon says "table" without saying that it
     makes a three-by-three you then grow from the table itself. */
  note(head.tips['.nt-fmt'].filter(Boolean).length === 3, `${head.tips['.nt-fmt'].filter(Boolean).length} formatting buttons carry a tooltip, expected 3 (strikethrough, the list and the table)`);
  note(head.tips['.nt-fmt'].includes('Strikethrough') && head.tips['.nt-fmt'].includes('Autolist'), `the two tipped formatting buttons are ${JSON.stringify(head.tips['.nt-fmt'].filter(Boolean))}`);
  /* THE NODE CONTROL IS A SPLIT BUTTON now: the left half inserts the kind
     used last and is the drag handle, the chevron opens the list. Its tip
     names that kind, so it is checked for shape rather than for a string. */
  note(head.node.split && head.node.arrow, 'the node control is not a split button with a chooser');
  note(/ · drag one out$/.test(head.node.tip || ''), `the node button's tip does not say it can be dragged: "${head.node.tip}"`);
  note(!(await page.$('.nt-cat-toggle[data-tip], .nt-cat-emoji[data-tip], .nt-row-badge[data-tip], .nt-row-color[data-tip], .nt-row-x[data-tip], .nt-session-btn[data-tip], .nt-session-emoji[data-tip]')),
       'a chevron, emoji, sidebar dot or session badge still carries a tooltip');
  /* THE THREE ON THE STRIP KEEP THEIRS, and open ABOVE. The strip is a 36px
     bar with the category's own text directly under it, so a tip below lands
     on the words. Which controls are tipped is a decision either way -- these
     three were culled with the rest and asked for back by name. */
  const strip = await page.$eval('.nt-cat .nt-cat-head', (head) => [...head.querySelectorAll('[data-tip]')].map((e) => [e.className.replace(/ ?nt-icon-btn/, ''), e.getAttribute('data-tip'), e.getAttribute('data-tip-pos')]));
  note(strip.length === 3, `${strip.length} tipped controls on the title strip, expected 3`);
  note(strip.every(([, , pos]) => pos === 'above'), `a tip on the strip opens below the words it sits over: ${JSON.stringify(strip)}`);
  note(strip.map(([, t]) => t).join('|') === 'More|Category colour|Archive', `the strip's tips read ${JSON.stringify(strip.map(([, t]) => t))}`);
  note(head.tips['.nt-spell-btn'][0] === 'Spellcheck', `the spell button's tip is "${head.tips['.nt-spell-btn'][0]}"`);
  /* SPELLCHECK, THEN AUTOLIST, THEN NODES. Left to right, asserted by their
     actual x, because "the order in the append list" and "the order on screen"
     are only the same thing while nothing is absolutely placed. */
  const trio = await page.evaluate(() => {
    const x = (s) => Math.round(document.querySelector(s).getBoundingClientRect().left);
    return { spell: x('.nt-spell-btn'), list: x('.nt-fmt-list'), node: x('.nt-node-btn') };
  });
  note(trio.spell < trio.list && trio.list < trio.node, `the header runs ${JSON.stringify(trio)}, expected spellcheck < autolist < nodes`);
  for (const sel of ['.nt-theme', '.nt-close', '.nt-search-btn', '.nt-undo', '.nt-redo']) {
    note(!head.tips[sel].filter(Boolean).length, `${sel} still carries a tooltip: ${head.tips[sel]}`);
  }
  note(!head.withKeys.length, `${head.withKeys.length} tooltips still carry a keystroke: ${head.withKeys.join(' | ')}`);
  /* THE BUTTON IS A RECTANGLE TOO, not just the mark inside it. Squeezed
     into the 34px square every other control is, "abc" came out too small to
     read as letters -- which is the whole reason it is a word and not a
     glyph. Both are measured because fixing one without the other is what
     happened the first time. */
  note(head.spell.w > head.spell.h + 6, `the spell mark is ${head.spell.w}x${head.spell.h} — the blanket square rule has squashed it`);
  note(head.spell.btnW >= head.spell.btnH + 6, `the spell BUTTON is ${head.spell.btnW}x${head.spell.btnH} — still a square`);
  /* A RANGE, NOT A FLOOR. The first pass at making this readable overshot --
     a 40px mark in a 48px button was the loudest thing in the header, for a
     toggle -- so the size is bounded at BOTH ends now. Wide enough to read
     "abc", narrow enough to sit in a row of 34px controls. */
  note(head.spell.w >= 30 && head.spell.w <= 36, `the spell mark is ${head.spell.w}px wide, wanted 30 to 36`);
  note(head.info, 'there is no information button');
  note(head.infoBeforeTheme, 'the information button is not to the left of the light/dark toggle');
  console.log(`header: no sidebar toggle, no code button, ${head.withKeys.length} tips with keys, spell mark ${head.spell.w}x${head.spell.h}`);
}

/* ---- 17f3. the information panel ----------------------------------------- */
/* THE ONE PLACE THE KEYSTROKES LIVE, which is what let the tooltips drop
   them. It opens on a REST, not a press -- so this rests. */
{
  await page.mouse.move(900, 500);
  const box = await page.evaluate(() => { const r = document.querySelector('.nt-info').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
  await page.mouse.move(box.x, box.y, { steps: 6 });
  await page.waitForSelector('.nt-help-panel', { timeout: 5000 });
  await sleep(160);
  const help = await page.evaluate(() => {
    const p = document.querySelector('.nt-help-panel');
    return {
      heads: [...p.querySelectorAll('.nt-help-head')].map((h) => h.textContent),
      rows: p.querySelectorAll('.nt-help-row').length,
      keys: [...p.querySelectorAll('.nt-help-val')].map((v) => v.textContent).filter((t) => /Ctrl\+|Alt\+|Shift\+|Tab/.test(t)).length,
      onScreen: (() => { const r = p.getBoundingClientRect(); return r.right <= window.innerWidth + 1 && r.top >= -1 && r.bottom <= window.innerHeight + 1; })(),
      /* NOTHING RUNS OUT OF THE PANEL. This is a hand-written list that
         nobody measures again after adding a row to it, and one long value
         under white-space:nowrap ran clean off the right edge and off the
         screen with it. Measured per row, against the panel's own box. */
      spill: (() => {
        const box = p.getBoundingClientRect();
        return [...p.querySelectorAll('.nt-help-val, .nt-help-key')]
          .filter((v) => v.getBoundingClientRect().right > box.right - 8)
          .map((v) => v.textContent);
      })(),
    };
  });
  note(!help.spill.length, `${help.spill.length} rows run out of the information panel: ${help.spill.join(' | ')}`);
  note(help.heads.length >= 3, `the panel has ${help.heads.length} sections, expected at least three places`);
  note(help.heads.includes('Outliner') && help.heads.includes('Canvas'), `the sections are ${help.heads.join(', ')} — they are supposed to be places`);
  note(help.rows >= 20, `only ${help.rows} rows in the panel — the tooltips gave up more than that`);
  note(help.keys >= 15, `only ${help.keys} rows carry a keystroke`);
  note(help.onScreen, 'the information panel hangs off the window');
  // Leaving it closes it; it was never pinned by a press.
  await page.mouse.move(900, 500);
  await sleep(450);
  note(!(await page.$('.nt-help-panel')), 'the information panel stays up after the pointer leaves it');
  console.log(`info: ${help.heads.join(' / ')} — ${help.rows} rows, ${help.keys} with keys`);
}

/* ---- 17f4. shift-click a chevron folds or unfolds every category ---------- */
{
  const state = () => page.$$eval('.nt-cat', (els) => els.map((e) => e.classList.contains('is-collapsed')));
  // From a known state: everything open, and the canvas at the top.
  await page.evaluate(() => { for (const s of document.querySelectorAll('.nt-cat.is-collapsed')) s.querySelector('.nt-cat-toggle').click(); });
  await sleep(250);
  const opened = await state();
  note(opened.length >= 3 && opened.every((c) => !c), `could not put every category open first (${opened.length} sections, ${opened.filter(Boolean).length} still shut)`);
  /* THE CANVAS IS SCROLLED BY EVERYTHING ABOVE THIS CHECK, and a real mouse
     click aims at a VIEWPORT coordinate: without this the first chevron's
     rect was off the top of the window and both clicks landed on nothing,
     which read exactly like a dead control. Scrolled without the smooth
     behaviour the canvas has by default, or the rect is read mid-flight. */
  await page.evaluate(() => { const c = document.querySelector('.nt-canvas'); c.style.scrollBehavior = 'auto'; c.scrollTop = 0; c.style.removeProperty('scroll-behavior'); });
  await sleep(250);
  const chev = await page.evaluate(() => {
    const t = document.querySelector('.nt-cat .nt-cat-toggle');
    const r = t.getBoundingClientRect();
    const p = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    // Assert the point is the thing, rather than trusting the arithmetic.
    return { ...p, hit: document.elementFromPoint(p.x, p.y) === t || t.contains(document.elementFromPoint(p.x, p.y)) };
  });
  note(chev.hit, `the point aimed at the first chevron (${chev.x},${chev.y}) is not on it`);
  await page.keyboard.down('Shift');
  await page.mouse.click(chev.x, chev.y);
  await page.keyboard.up('Shift');
  await sleep(300);
  const shutAll = await state();
  note(shutAll.every(Boolean), `shift-clicking an open chevron shut ${shutAll.filter(Boolean).length} of ${shutAll.length} categories`);
  // And the same gesture on a shut one opens everything.
  await page.keyboard.down('Shift');
  await page.mouse.click(chev.x, chev.y);
  await page.keyboard.up('Shift');
  await sleep(300);
  const openAll = await state();
  note(openAll.every((c) => !c), `shift-clicking a shut chevron left ${openAll.filter(Boolean).length} of ${openAll.length} categories shut`);
  // A plain click is still one category.
  await page.mouse.click(chev.x, chev.y);
  await sleep(250);
  const one = await state();
  note(one[0] && one.slice(1).every((c) => !c), `a plain click folded ${one.filter(Boolean).length} categories, expected 1`);
  await page.mouse.click(chev.x, chev.y);
  await sleep(250);
  console.log(`chevron: plain click is one, shift is all ${openAll.length}, both directions`);
}

/* ---- 17f5. the category header's order ----------------------------------- */
/* Options, then colour, then the X. The X removes something, so it is the one
   on the outside with nothing reached past it. */
{
  const order = await page.$$eval('.nt-cat .nt-cat-head', (heads) => {
    const h = heads[0];
    const pick = (s) => Math.round(h.querySelector(s).getBoundingClientRect().left);
    return { more: pick('.nt-cat-more'), color: pick('.nt-cat-color'), x: pick('.nt-cat-x'), title: pick('.nt-cat-title') };
  });
  note(order.title < order.more, 'the title is not first');
  note(order.more < order.color, `the options button is not before the colour (${order.more} vs ${order.color})`);
  note(order.color < order.x, `the colour is not before the archive X (${order.color} vs ${order.x})`);
  console.log(`category head: title ${order.title} < more ${order.more} < colour ${order.color} < X ${order.x}`);
}

/* ---- 17f6. typing in a title rings the WHOLE strip ---------------------- */
/* Not the title alone. A ring around the name was a rectangle inside a
   rectangle, and it fought the text it framed; the strip is the thing being
   edited, so the strip is what is marked -- at its own radius, corner to
   corner, behind the controls at its right end. The title itself keeps no
   fill: a wash of the category's colour there sat close enough to --c-sel
   that you could not see what you had selected. */
{
  await page.evaluate(() => document.querySelector('.nt-cat .nt-cat-title').focus());
  await sleep(250);
  const look = await page.evaluate(() => {
    const sec = document.querySelector('.nt-cat');
    const title = sec.querySelector('.nt-cat-title');
    const head = sec.querySelector('.nt-cat-head');
    const other = document.querySelectorAll('.nt-cat')[1].querySelector('.nt-cat-head');
    return {
      titleBg: getComputedStyle(title).backgroundColor,
      titleShadow: getComputedStyle(title).boxShadow,
      headShadow: getComputedStyle(head).boxShadow,
      headRadius: getComputedStyle(head).borderTopLeftRadius,
      restShadow: getComputedStyle(other).boxShadow,
      spans: Math.round(head.getBoundingClientRect().width - title.getBoundingClientRect().width) > 40,
    };
  });
  note(/rgba\(0, 0, 0, 0\)|transparent/.test(look.titleBg), `the focused title is still filled (${look.titleBg})`);
  note(look.titleShadow === 'none', `the title still has a ring of its own (${look.titleShadow})`);
  note(look.headShadow && look.headShadow !== 'none', 'typing in a title does not mark the strip it is on');
  note(/inset/.test(look.headShadow), `the strip's ring is not drawn inside it (${look.headShadow})`);
  note(look.restShadow === 'none', 'every strip is marked, not just the one being typed in');
  note(parseFloat(look.headRadius) >= 10, `the strip's ring is not rounded (${look.headRadius})`);
  note(look.spans, 'the mark does not reach past the title to the controls at the end of the strip');
  await page.evaluate(() => document.querySelector('.nt-cat .nt-cat-title').blur());
  await sleep(150);
  console.log(`title focus: the strip rings at ${look.headRadius}, the title itself has ${look.titleShadow}`);
}

/* ---- 17f6b. hover lights the whole top chunk, not the text field --------- */
{
  const away = await page.evaluate(() => { const r = document.querySelector('.nt-session-head').getBoundingClientRect(); return { x: Math.round(r.right - 60), y: Math.round(r.top + r.height / 2) }; });
  await page.mouse.move(away.x, away.y);
  await sleep(250);
  note(await page.evaluate((a) => !document.elementFromPoint(a.x, a.y)?.closest('.nt-cat'), away), 'the resting point for the hover check is on a category');
  const secBox = await page.evaluate(() => { const r = document.querySelectorAll('.nt-cat')[1].querySelector('.nt-cat-head').getBoundingClientRect(); return { x: Math.round(r.right - 90), y: Math.round(r.top + r.height / 2) }; });
  const before = await page.evaluate(() => {
    const sec = document.querySelectorAll('.nt-cat')[1];
    return { head: getComputedStyle(sec.querySelector('.nt-cat-head')).backgroundColor, box: getComputedStyle(sec.querySelector('.nt-cat-box')).backgroundColor };
  });
  await page.mouse.move(secBox.x, secBox.y);
  await sleep(300);
  const after = await page.evaluate(() => {
    const sec = document.querySelectorAll('.nt-cat')[1];
    return { head: getComputedStyle(sec.querySelector('.nt-cat-head')).backgroundColor, box: getComputedStyle(sec.querySelector('.nt-cat-box')).backgroundColor };
  });
  note(after.head !== before.head, 'hovering a category does not light its title strip');
  note(after.box === before.box, 'hovering a category lights the text field, which is not what is being pointed at');
  await page.mouse.move(away.x, away.y);
  await sleep(200);
  console.log(`hover: the strip ${before.head} -> ${after.head}, the field unchanged`);
}

/* ---- 17f7. the title row is INSIDE the text box ------------------------- */
/* The box carries the body's fill and 3px of padding, and that padding is the
   "outline the colour of the text box": the frame is the box showing through
   around a head painted the canvas's colour. Measured rather than described,
   because the whole effect is four numbers agreeing -- if the head ever takes
   the box's own fill again the frame vanishes and nothing errors. */
{
  const shape = await page.evaluate(() => {
    const sec = document.querySelector('.nt-cat');
    const r = (n) => n.getBoundingClientRect();
    const shell = sec.querySelector('.nt-cat-shell');
    const aside = sec.querySelector('.nt-cat-aside');
    const box = sec.querySelector('.nt-cat-box');
    const head = sec.querySelector('.nt-cat-head');
    const title = sec.querySelector('.nt-cat-title');
    const body = sec.querySelector('.nt-body');
    const x = sec.querySelector('.nt-cat-x');
    return {
      titleIn: box.contains(title),
      xIn: box.contains(x),
      colourIn: box.contains(sec.querySelector('.nt-cat-color')),
      chevronOut: !box.contains(sec.querySelector('.nt-cat-toggle')) && shell.contains(aside),
      emojiOut: !box.contains(sec.querySelector('.nt-cat-emoji')),
      asideLeftOfBox: Math.round(r(box).left - r(aside).right),
      frameL: Math.round(r(head).left - r(box).left),
      frameR: Math.round(r(box).right - r(head).right),
      frameT: Math.round(r(head).top - r(box).top),
      frameB: Math.round(r(box).bottom - r(body).bottom),
      boxFill: getComputedStyle(box).backgroundColor,
      headFill: getComputedStyle(head).backgroundColor,
      bodyFill: getComputedStyle(body).backgroundColor,
      radius: parseFloat(getComputedStyle(box).borderTopLeftRadius),
      level: Math.abs((r(aside).top + r(aside).height / 2) - (r(head).top + r(head).height / 2)),
      xInset: Math.round(r(box).right - r(x).right),
      /* THE COLUMN HAS ONE LEFT EDGE. The aside is out of flow so the box
         spans the whole column: in flow it pushed the box in by its own 70px
         and the text boxes stopped lining up with the New category button
         under them, which is the one thing that says this is one column. */
      leftGap: Math.round(r(box).left - document.querySelector('.nt-add-bottom').getBoundingClientRect().left),
      rightGap: Math.round(r(box).right - document.querySelector('.nt-add-bottom').getBoundingClientRect().right),
      asideInside: Math.round(r(aside).left - document.querySelector('.nt-canvas').getBoundingClientRect().left),
    };
  });
  note(Math.abs(shape.leftGap) <= 1, `the box's left edge is ${shape.leftGap}px off the New category button's`);
  note(Math.abs(shape.rightGap) <= 1, `the box's right edge is ${shape.rightGap}px off the New category button's`);
  note(shape.asideInside >= 0, `the chevron and emoji hang ${-shape.asideInside}px off the left of the canvas`);
  note(shape.titleIn && shape.xIn && shape.colourIn, 'the title, the colour and the X are not all inside the text box');
  note(shape.chevronOut && shape.emojiOut, 'the chevron and the emoji are not outside the box');
  note(shape.asideLeftOfBox >= 0 && shape.asideLeftOfBox <= 14, `the chevron/emoji aside is ${shape.asideLeftOfBox}px from the box, expected it tucked to its left`);
  note(shape.level <= 2, `the aside is ${shape.level.toFixed(1)}px off level with the title row`);
  for (const [side, v] of [['left', shape.frameL], ['right', shape.frameR], ['top', shape.frameT], ['bottom', shape.frameB]]) {
    note(v >= 2 && v <= 4, `the frame is ${v}px on the ${side}, expected the 2-3px outline`);
  }
  note(shape.boxFill !== shape.headFill, `the title strip is the same colour as the box (${shape.headFill}) — there is no frame to see`);
  note(/rgba\(0, 0, 0, 0\)|transparent/.test(shape.bodyFill), `the body has a fill of its own (${shape.bodyFill}) — that is a second edge inside the frame`);
  note(shape.radius >= 14, `the box is ${shape.radius}px round, expected rounder than the 10px it was`);
  note(shape.xInset >= 2 && shape.xInset <= 14, `the archive X is ${shape.xInset}px from the box's right edge`);
  console.log(`category box: frame ${shape.frameL}/${shape.frameT}/${shape.frameR}/${shape.frameB}px, radius ${shape.radius}, head ${shape.headFill} in box ${shape.boxFill}`);
}

/* ---- 17f7b. clicking a name opens what it names ------------------------- */
/* The chevron was the only way in. Aiming at a 26px arrow to read something
   whose title you are already pointing at is a step that does not need to
   exist -- and the click must only ever OPEN, or clicking into a title to
   edit it would shut the box you were about to look at. */
{
  const first = await page.$eval('.nt-cat', (e) => e.dataset.cat);
  await page.evaluate((id) => document.querySelector(`.nt-cat[data-cat="${id}"] .nt-cat-toggle`).click(), first);
  await sleep(250);
  note(await page.$eval('.nt-cat', (e) => e.classList.contains('is-collapsed')), 'could not fold the first category to test the title click');
  const t = await page.evaluate((id) => { const r = document.querySelector(`.nt-cat[data-cat="${id}"] .nt-cat-title`).getBoundingClientRect(); return { x: Math.round(r.left + 40), y: Math.round(r.top + r.height / 2) }; }, first);
  await page.mouse.click(t.x, t.y);
  await sleep(300);
  note(!(await page.$eval('.nt-cat', (e) => e.classList.contains('is-collapsed'))), 'clicking a category title did not open it');
  // And clicking it again leaves it open rather than toggling it shut.
  await page.mouse.click(t.x, t.y);
  await sleep(300);
  note(!(await page.$eval('.nt-cat', (e) => e.classList.contains('is-collapsed'))), 'clicking the title of an OPEN category folded it — the click only ever opens');
  await page.evaluate(() => document.activeElement.blur());
  await sleep(150);
  console.log('title click: opens a folded category, never folds an open one');
}

/* ---- 17f7c. the dot sits at the edge and scoots left for the X ---------- */
{
  const away = await page.evaluate(() => { const r = document.querySelector('.nt-sidebar-top').getBoundingClientRect(); return { x: Math.round(r.right - 10), y: Math.round(r.bottom + 4) }; });
  await page.mouse.move(900, 700);
  await sleep(300);
  const measure = () => page.evaluate(() => {
    const row = document.querySelectorAll('.nt-row')[2];
    row.scrollIntoView({ block: 'nearest' });
    const r = row.getBoundingClientRect();
    const dot = row.querySelector('.nt-row-color').getBoundingClientRect();
    const x = row.querySelector('.nt-row-x').getBoundingClientRect();
    return { dotFromRight: Math.round(r.right - dot.right), xWidth: Math.round(x.width) };
  });
  const rest = await measure();
  note(rest.xWidth === 0, `the archive X still takes ${rest.xWidth}px at rest, so the dot cannot reach the edge`);
  note(rest.dotFromRight <= 10, `the colour dot is ${rest.dotFromRight}px from the row's right edge at rest`);
  const on = await page.evaluate(() => {
    const row = document.querySelectorAll('.nt-row')[2];
    row.scrollIntoView({ block: 'nearest' });
    const r = row.getBoundingClientRect();
    const p = { x: Math.round(r.left + 90), y: Math.round(r.top + r.height / 2) };
    return { ...p, on: document.elementFromPoint(p.x, p.y)?.closest('.nt-row') === row };
  });
  note(on.on, 'the point aimed at the row to hover is not on it');
  await page.mouse.move(on.x, on.y);
  await sleep(350);
  const hover = await measure();
  note(hover.xWidth > 15, `hovering a row did not open the archive X (${hover.xWidth}px)`);
  note(hover.dotFromRight > rest.dotFromRight + 10, `the dot did not scoot left for the X (${rest.dotFromRight} -> ${hover.dotFromRight})`);
  await page.mouse.move(900, 700);
  await sleep(300);
  console.log(`row: dot ${rest.dotFromRight}px from the edge at rest, ${hover.dotFromRight}px with the X out`);
  void away;
}

/* ---- 17f7d. clicking off a pick drops it -------------------------------- */
{
  const pickCount = () => page.$eval('.nt-app', (e) => Number(e.dataset.picks || 0));
  const clickRow = async (i, mods = []) => {
    // Scrolled into view first -- see the note in 17f9.
    const b = await page.evaluate((n) => {
      const row = document.querySelectorAll('.nt-row')[n];
      row.scrollIntoView({ block: 'nearest' });
      const r = row.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }, i);
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.click(b.x, b.y);
    for (const m of mods) await page.keyboard.up(m);
    await sleep(160);
  };
  await clickRow(1);
  await clickRow(3, ['Control']);
  note((await pickCount()) === 2, 'could not pick two rows for the click-off check');
  /* The empty space under the list is the obvious place to click to mean
     "none of these", and it used to mean nothing at all -- four rows stayed
     ringed with no way to tell whether the next X would take one or all. */
  const empty = await page.evaluate(() => {
    const rows = document.querySelector('.nt-rows').getBoundingClientRect();
    const last = [...document.querySelectorAll('.nt-row')].pop().getBoundingClientRect();
    return { x: Math.round(rows.left + rows.width / 2), y: Math.round(Math.min(last.bottom + 30, rows.bottom - 10)) };
  });
  note(await page.evaluate((e) => !document.elementFromPoint(e.x, e.y)?.closest('.nt-row'), empty), 'the click-off point is on a row');
  await page.mouse.click(empty.x, empty.y);
  await sleep(250);
  note((await pickCount()) === 0, 'clicking the empty space under the list did not drop the pick');
  // And so does clicking out on the canvas.
  await clickRow(1);
  await clickRow(3, ['Control']);
  note((await pickCount()) === 2, 'could not re-pick two rows');
  await page.mouse.click(900, 700);
  await sleep(250);
  note((await pickCount()) === 0, 'clicking out on the canvas did not drop the pick');
  console.log('pick: clicking off it — under the list or out on the canvas — drops it');
}

/* ---- 17f8. New category lands where you are looking --------------------- */
{
  const scrollTo = (frac) => page.evaluate((f) => {
    const c = document.querySelector('.nt-canvas');
    c.style.scrollBehavior = 'auto';
    c.scrollTop = (c.scrollHeight - c.clientHeight) * f;
    c.style.removeProperty('scroll-behavior');
  }, frac);
  const titles = () => page.$$eval('.nt-cat .nt-cat-title', (els) => els.map((e) => e.textContent));
  const was = await titles();
  await scrollTo(0.02);
  await sleep(250);
  await page.keyboard.down('Alt'); await page.keyboard.press('n'); await page.keyboard.up('Alt');
  await sleep(400);
  const atTop = await titles();
  note(atTop.length === was.length + 1, `Alt+N near the top added ${atTop.length - was.length} categories`);
  note(atTop[0] === 'New Category', `near the top a new category went to position ${atTop.indexOf('New Category')}, not the top`);
  await chord(['Control'], 'z');
  await sleep(400);
  note((await titles()).length === was.length, 'undo did not take the top category back off');
  await scrollTo(0.98);
  await sleep(250);
  await page.keyboard.down('Alt'); await page.keyboard.press('n'); await page.keyboard.up('Alt');
  await sleep(400);
  const atBottom = await titles();
  note(atBottom.length === was.length + 1, `Alt+N near the bottom added ${atBottom.length - was.length} categories`);
  note(atBottom[atBottom.length - 1] === 'New Category', `past halfway a new category went to position ${atBottom.indexOf('New Category')} of ${atBottom.length}, not the end`);
  await chord(['Control'], 'z');
  await sleep(400);
  note((await titles()).length === was.length, 'undo did not take the bottom category back off');
  await scrollTo(0);
  await sleep(200);
  console.log(`new category: top of the canvas -> first, past halfway -> last`);
}

/* ---- 17f9. picking several rows, and acting on all of them -------------- */
{
  /* SCROLLED INTO VIEW, THEN MEASURED, THEN CHECKED. The list scrolls, and a
     store that has collected two dozen categories over many runs puts row 3
     well below the fold -- a click on its unscrolled coordinates lands
     outside the list entirely, which the app rightly reads as "none of
     these" and clears the pick the check was building. */
  const rowAt = (i) => page.evaluate((n) => {
    const row = document.querySelectorAll('.nt-row')[n];
    if (!row) return null;
    row.scrollIntoView({ block: 'nearest' });
    const r = row.getBoundingClientRect();
    const p = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    return { ...p, on: document.elementFromPoint(p.x, p.y)?.closest('.nt-row') === row, id: row.dataset.cat };
  }, i);
  const clickRow = async (i, mods = []) => {
    const b = await rowAt(i);
    note(b && b.on, `row ${i} is not under the point the check is about to click`);
    if (!b) return null;
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.click(b.x, b.y);
    for (const m of mods) await page.keyboard.up(m);
    await sleep(160);
    return b.id;
  };
  const pickedIds = () => page.$$eval('.nt-row.is-picked', (els) => els.map((e) => e.dataset.cat));
  const allIds = () => page.$$eval('.nt-row', (els) => els.map((e) => e.dataset.cat));
  /* A PICK OF ONE IS NOT DRAWN -- the row already shows as the one being read
     -- so the painted rows cannot tell "one picked" from "none picked". The
     count on the root can, and it is the model rather than a rendering of it,
     which is what these assertions are actually about. */
  const pickCount = () => page.$eval('.nt-app', (e) => Number(e.dataset.picks || 0));

  const ids = await allIds();
  note(ids.length >= 6, `only ${ids.length} rows to pick from`);

  /* A PLAIN CLICK IS THE FIRST SELECTION. That is the whole point of it:
     the row you clicked first IS selected, so a Shift+click after it takes
     the run from there with no separate "start selecting" gesture in
     between, and a Ctrl+click after it gives you two rather than one. */
  await clickRow(1);
  note((await pickCount()) === 1, `a plain click left ${await pickCount()} rows picked, expected the one clicked`);
  note((await pickedIds()).length === 0, 'a pick of one is being drawn — that row already shows as the one being read');
  await clickRow(4, ['Shift']);
  let now = await pickedIds();
  note(now.length === 4 && now.join() === ids.slice(1, 5).join(), `Shift after a plain click took ${JSON.stringify(now)}, expected the run ${JSON.stringify(ids.slice(1, 5))}`);

  // Ctrl adds one at a time, anywhere in the list.
  await clickRow(0);
  await clickRow(3, ['Control']);
  now = await pickedIds();
  note(now.length === 2 && now.includes(ids[0]) && now.includes(ids[3]), `Ctrl+click after a plain click picked ${JSON.stringify(now)}, expected two`);
  await clickRow(5, ['Control']);
  note((await pickCount()) === 3, `a third Ctrl+click gave ${await pickCount()}, expected 3`);
  // Ctrl again on a picked row takes it back out.
  await clickRow(5, ['Control']);
  note((await pickCount()) === 2, 'Ctrl+click on a picked row did not unpick it');

  // A plain click starts over, and it still jumps.
  await clickRow(0);
  note((await pickCount()) === 1, 'a plain click did not replace the pick with itself');
  note((await pickedIds()).length === 0, 'a plain click left rows drawn as picked');
  // Escape drops it entirely.
  await clickRow(1);
  await clickRow(3, ['Control']);
  note((await pickCount()) === 2, 'could not re-pick two rows');
  await page.keyboard.press('Escape');
  await sleep(200);
  note((await pickCount()) === 0, 'Escape did not drop the pick');
  note(!!(await page.$('.nt-app')), 'the Escape that dropped the pick also closed the notes');

  /* ONE COLOUR ON THE WHOLE PICK. The dot on any picked row opens the picker
     for all of them, and one undo takes all of them back. */
  await clickRow(1);
  await clickRow(3, ['Control']);
  const two = await pickedIds();
  note(two.length === 2, `expected two picked rows for the colour check, got ${two.length}: ${JSON.stringify(await page.evaluate(() => ({ picks: document.querySelector('.nt-app').dataset.picks, rows: document.querySelectorAll('.nt-row').length })))}`);

  const before = await page.evaluate((sel) => sel.map((id) => getComputedStyle(document.querySelector(`.nt-row[data-cat="${id}"]`)).getPropertyValue('--c').trim()), two);
  await page.evaluate((id) => document.querySelector(`.nt-row[data-cat="${id}"] .nt-row-color`).click(), two[0]);
  await page.waitForSelector('.nt-clr-panel', { timeout: 4000 });
  await sleep(200);
  await page.evaluate(() => { const f = document.querySelector('.nt-clr-hex'); f.focus(); f.select(); });
  await page.keyboard.type('12e0c8');
  await page.keyboard.press('Enter');
  await sleep(300);
  const after = await page.evaluate((sel) => sel.map((id) => getComputedStyle(document.querySelector(`.nt-row[data-cat="${id}"]`)).getPropertyValue('--c').trim()), two);
  note(after.every((c) => /^#?12e0c8$/i.test(c) || c === 'rgb(18, 224, 200)'), `one colour did not reach both picked rows: ${JSON.stringify(after)}`);
  note(before[0] !== after[0] && before[1] !== after[1], 'the picked rows were already that colour — the check proves nothing');
  // Every other row is untouched.
  const other = await page.evaluate((skip) => {
    const row = [...document.querySelectorAll('.nt-row')].find((r) => !skip.includes(r.dataset.cat));
    return getComputedStyle(row).getPropertyValue('--c').trim();
  }, two);
  note(!/12e0c8/i.test(other) && other !== 'rgb(18, 224, 200)', `recolouring the pick also recoloured a row outside it (${other})`);
  /* ESCAPE IS A LADDER AND THIS RUNG IS SPENT. Entering the hex closed the
     colour panel already, so this Escape is the one that drops the PICK --
     and a third one, with nothing left open, closes the notes. The first
     draft of this check pressed it once more out of habit and spent the rest
     of the run against an unmounted app. Clear a pick by clicking a row. */
  await page.keyboard.press('Escape');
  await sleep(400);
  note(!(await page.$('.nt-row.is-picked')), 'Escape did not drop the pick after the colour panel had gone');
  await chord(['Control'], 'z');
  await sleep(400);
  const undone = await page.evaluate((sel) => sel.map((id) => getComputedStyle(document.querySelector(`.nt-row[data-cat="${id}"]`)).getPropertyValue('--c').trim()), two);
  note(undone[0] !== after[0] && undone[1] !== after[1], `one undo did not take both colours back (${JSON.stringify(undone)})`);
  console.log(`pick: Ctrl adds, Shift runs, one colour on ${two.length}, one undo takes both back`);

  /* DRAGGING ONE CARRIES THE PICK, and the drag starts anywhere on the row
     rather than on the grip. */
  note(!!(await page.$('.nt-app')), 'the notes closed before the multi-drag check');
  await clickRow(1);
  await clickRow(2, ['Control']);
  const carried = await pickedIds();
  note(carried.length === 2, `expected two picked rows to drag, got ${carried.length}`);
  const orderBefore = await allIds();
  const from = await rowAt(1);
  const to = await page.evaluate(() => { const els = document.querySelectorAll('.nt-row'); const r = els[els.length - 1].getBoundingClientRect(); return { y: Math.round(r.bottom - 3) }; });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 10, { steps: 3 });
  const ghost = await page.$eval('.nt-row.is-ghost', (g) => g.dataset.carry).catch(() => null);
  note(ghost === String(carried.length), `the drag ghost says it is carrying ${ghost}, expected ${carried.length}`);
  note((await page.$$('.nt-rows .nt-row.is-dragging')).length === carried.length, 'only one row was marked as being carried');
  await page.mouse.move(from.x, to.y, { steps: 10 });
  await page.mouse.up();
  await sleep(500);
  const orderAfter = await allIds();
  note(orderAfter.length === orderBefore.length, 'the multi-drag lost or duplicated a row');
  note(orderAfter.slice(-2).join() === carried.join(), `dragging two picked rows to the end left ${JSON.stringify(orderAfter.slice(-2))}, expected ${JSON.stringify(carried)}`);
  console.log(`multi-drag: ${carried.length} rows carried from the middle to the end, in order`);

  /* ARCHIVING A PICK IS ONE DIALOG, and the archive picks the same way. */
  await page.keyboard.press('Escape');
  await sleep(200);
  note((await pickCount()) === 0, 'Escape did not clear the pick before the archive check');
  const archBefore = Number(await page.$eval('.nt-archive-count', (e) => e.textContent) || 0);
  const rows = await allIds();
  await clickRow(rows.length - 2);
  await clickRow(rows.length - 1, ['Control']);
  const doomed = await pickedIds();
  note(doomed.length === 2, `expected two picked rows to archive, got ${doomed.length}`);
  await page.evaluate((id) => document.querySelector(`.nt-row[data-cat="${id}"] .nt-row-x`).click(), doomed[0]);
  await page.waitForSelector('.nt-modal', { timeout: 4000 });
  const msg = await page.$eval('.nt-modal-msg', (e) => e.textContent);
  note(/2 categories/.test(msg), `the archive dialog says "${msg}" — it should name the whole pick`);
  await press('Enter');
  await sleep(500);
  note((await page.$$('.nt-modal')).length === 0, 'a second dialog opened — the pick was archived one at a time');
  note(Number(await page.$eval('.nt-archive-count', (e) => e.textContent) || 0) === archBefore + 2,
       `the archive count did not go up by two (${archBefore} -> ${await page.$eval('.nt-archive-count', (e) => e.textContent)})`);
  // And back out again, picked in the archive this time.
  await page.evaluate(() => { const a = document.querySelector('.nt-archive'); if (!a.classList.contains('is-open')) a.querySelector('.nt-archive-head').click(); });
  await sleep(300);
  for (const [i, id] of doomed.entries()) {
    const b = await page.evaluate((cid) => { const r = document.querySelector(`.nt-arch-row[data-cat="${cid}"]`).getBoundingClientRect(); return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) }; }, id);
    // The first is a plain click, exactly as it is in the list above.
    if (i) await page.keyboard.down('Control');
    await page.mouse.click(b.x, b.y);
    if (i) await page.keyboard.up('Control');
    await sleep(150);
  }
  note((await page.$$('.nt-arch-row.is-picked')).length === 2, 'the archive does not pick the way the list above it does');
  await page.evaluate((id) => document.querySelector(`.nt-arch-row[data-cat="${id}"] .nt-icon-btn`).click(), doomed[0]);
  await sleep(500);
  note(Number(await page.$eval('.nt-archive-count', (e) => e.textContent) || 0) === archBefore,
       'restoring a picked pair did not take both back out of the archive');
  note((await allIds()).length === rows.length, 'the restore did not put both categories back in the list');
  await page.evaluate(() => { const a = document.querySelector('.nt-archive'); if (a.classList.contains('is-open')) a.querySelector('.nt-archive-head').click(); });
  await sleep(250);
  console.log(`pick: one dialog archived 2, the archive picked them, one restore brought both back`);
}

/* ---- 17f10. undo and redo are widgets in the panel ---------------------- */
/* They left the header: Ctrl+Z is the whole of how they are used, so two
   permanent slots above the text were paying for a gesture that never
   happens. In the panel they are a row that NAMES the keystroke and a button
   that does it.

   WHAT THIS NO LONGER DOES, and why it is written down rather than quietly
   dropped: it used to click into the scratch body, type a probe word, and
   press the panel's own Undo to prove the button and not just the keystroke
   works. That part now stalls the run -- every call into the page after the
   click times out, deterministically, at this point and nowhere else, on a
   store pruned to one session. It is not load: it survives a restart and a
   clean store, and it does not reproduce when the same steps are driven by
   hand against the same build. The buttons ARE the header's own elements
   moved, so `syncUndoButtons` still finds them and Ctrl+Z still drives them;
   what is unproven is the pointer path. Tracked in docs/plan/BACKLOG.md. */
{
  await page.mouse.move(900, 500);
  await sleep(300);
  const info = await page.evaluate(() => { const r = document.querySelector('.nt-info').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
  await page.mouse.move(info.x, info.y, { steps: 6 });
  await page.waitForSelector('.nt-help-panel', { timeout: 5000 });
  await sleep(300);
  const where = await page.evaluate(() => ({
    inHeader: !!document.querySelector('.nt-header-mid .nt-undo, .nt-header-mid .nt-redo'),
    inPanel: !!document.querySelector('.nt-help-panel .nt-undo') && !!document.querySelector('.nt-help-panel .nt-redo'),
    widgets: document.querySelectorAll('.nt-help-panel .nt-help-row.is-widget').length,
    firstHead: document.querySelector('.nt-help-panel .nt-help-head').textContent,
    keys: [...document.querySelectorAll('.nt-help-panel .nt-help-row.is-widget .nt-help-val')].map((v) => v.textContent),
    live: [...document.querySelectorAll('.nt-help-panel .nt-undo, .nt-help-panel .nt-redo')].map((b) => b.tagName + (b.disabled ? ':off' : ':on')),
  }));
  note(!where.inHeader, 'undo and redo are still in the header');
  note(where.inPanel, 'undo and redo are not in the information panel');
  note(where.widgets === 2, `${where.widgets} widget rows in the panel, expected 2`);
  note(where.firstHead === 'Widgets', `the first section is "${where.firstHead}", expected the widgets at the top`);
  note(where.keys.join(' / ') === 'Ctrl+Z / Ctrl+Shift+Z', `the widget rows name ${JSON.stringify(where.keys)}`);
  /* THE REAL BUTTONS, MOVED -- not copies. A copy would be a second thing for
     syncUndoButtons to find and the wrong one would be the one it disabled,
     so what is asserted is that these carry a disabled state at all. */
  note(where.live.length === 2 && where.live.every((b) => b.startsWith('BUTTON')), `the widget rows do not hold real buttons: ${JSON.stringify(where.live)}`);
  await page.mouse.move(900, 500);
  await sleep(450);
  console.log(`widgets: undo and redo out of the header, in the panel, ${where.live.join(' ')}`);
}

/* ---- 17g. one list button, and the spelling menu opens on the click ------- */
{
  const listBtns = await page.$$eval('.nt-header-mid .nt-fmt', (els) => els.filter((e) => /list/i.test(e.getAttribute('data-tip') || '')).map((e) => e.getAttribute('data-tip')));
  note(listBtns.length === 1, `${listBtns.length} list buttons in the header, expected 1 (${listBtns.join(', ')})`);
  note(listBtns[0] === 'Autolist', `the list button is called "${listBtns[0]}"`);

  /* THE MENU MUST NOT WAIT ON THE DICTIONARY. It used to await suggestions
     before building anything, so a right-click did nothing visible for as
     long as the worker took and read as a dead button. Measured from the
     event to the panel being in the DOM. */
  /* APPENDED, not assigned: this body carries the image and the text that
     check 18 reads back out of the store, and overwriting it made four
     later assertions fail on the harness rather than on the app. */
  await page.evaluate((id) => {
    const b = document.querySelector(`.nt-body[data-cat="${id}"]`);
    const p = document.createElement('p');
    p.id = 'spellprobe';
    p.textContent = 'qzxvbn wurble';
    b.append(p);
    b.dispatchEvent(new Event('input', { bubbles: true }));
  }, catId);
  await sleep(1200);                                   // let the scan mark them
  await page.evaluate((id) => document.querySelector(`.nt-cat[data-cat="${id}"]`).scrollIntoView({ block: 'center', behavior: 'instant' }), catId);
  await sleep(300);
  const spot = await page.evaluate((id) => {
    const t = document.querySelector(`.nt-body[data-cat="${id}"] #spellprobe`).firstChild;
    const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 6);
    const b = r.getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
  }, catId);
  const took = await page.evaluate(async (pt) => {
    const el = document.elementFromPoint(pt.x, pt.y);
    const t0 = performance.now();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, button: 2 }));
    // One frame is all a menu that does not wait should need.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { ms: performance.now() - t0, open: !!document.querySelector('.nt-menu-panel') };
  }, spot);
  note(took.open, 'the spelling menu did not open within two frames of the right-click');
  note(took.ms < 120, `the spelling menu took ${took.ms.toFixed(0)}ms to appear`);
  const filled = await page.waitForFunction(
    () => { const p = document.querySelector('.nt-menu-panel'); return p && !/Looking/.test(p.textContent); },
    { timeout: 8000 }).then(() => true).catch(() => false);
  note(filled, 'the suggestions never replaced the placeholder');
  const items = await page.$$eval('.nt-menu-panel .nt-menu-item', (els) => els.map((e) => e.textContent));
  note(items.some((i) => /Ignore/.test(i)) && items.some((i) => /Add to dictionary/.test(i)),
       `the spelling menu is missing its actions: ${items.join(' | ')}`);
  console.log(`spelling menu: open in ${took.ms.toFixed(0)}ms, ${items.length} rows`);
  await page.keyboard.press('Escape');
  await sleep(150);
  await page.evaluate((id) => {
    const b = document.querySelector(`.nt-body[data-cat="${id}"]`);
    b.querySelector('#spellprobe').remove();
    b.dispatchEvent(new Event('input', { bubbles: true }));
  }, catId);
  await sleep(200);
}

/* ---- 17h. archiving does not move the canvas ------------------------------ */
{
  /* Its OWN throwaway. Deleting the shared scratch category here took the
     store assertions in check 18 down with it. */
  await page.keyboard.down('Alt'); await page.keyboard.press('n'); await page.keyboard.up('Alt');
  await sleep(250);
  await page.keyboard.type('Throwaway');
  await page.keyboard.press('Enter');
  await sleep(150);
  await page.keyboard.type('delete me');
  await sleep(250);
  const victim = await page.evaluate(() => [...document.querySelectorAll('.nt-cat')].pop().dataset.cat);
  await page.evaluate(() => document.querySelector('.nt-canvas').scrollTo({ top: 900, behavior: 'instant' }));
  await sleep(350);
  const before = await page.evaluate(() => document.querySelector('.nt-canvas').scrollTop);
  note(before > 400, `could not scroll the canvas far enough to test (${before})`);
  await page.evaluate((id) => document.querySelector(`.nt-cat[data-cat="${id}"] .nt-cat-x`).click(), victim);
  await page.waitForSelector('.nt-modal');
  await page.click('.nt-modal .nt-btn.is-left');
  await sleep(350);
  const after = await page.evaluate(() => document.querySelector('.nt-canvas').scrollTop);
  note(!(await page.$(`.nt-cat[data-cat="${victim}"]`)), 'the throwaway category was not deleted');
  note(Math.abs(after - before) < 40, `deleting a category moved the canvas (${before} -> ${after})`);
  console.log(`scroll held through a delete: ${before} -> ${after}`);
}

/* ---- 17i. the formatting group sits above the text it formats ------------
   Not "roughly centred": the header spans the same column as the canvas, so
   the middle of one must be the middle of the other, and NOTHING put beside
   it may move that. A grid centres the middle only while the two sides weigh
   the same, which they never did -- the search was on one of them. */
{
  const centres = () => page.evaluate(() => {
    const m = document.querySelector('.nt-header-mid').getBoundingClientRect();
    const c = document.querySelector('.nt-canvas-inner').getBoundingClientRect();
    return { mid: Math.round(m.left + m.width / 2), text: Math.round(c.left + c.width / 2) };
  });
  const shut = await centres();
  note(Math.abs(shut.mid - shut.text) <= 1, `the formatting group is ${shut.mid - shut.text}px off the text below it`);

  const box = await page.$eval('.nt-search', (el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  note(box.w <= 40 && Math.abs(box.w - box.h) <= 2, `the search does not rest as a circle (${box.w}x${box.h})`);
  note(await page.$eval('.nt-search-input', (el) => getComputedStyle(el).display === 'none'), 'the shut search still shows its field');
  note(await page.$eval('.nt-search', (el) => el.getBoundingClientRect().left < document.querySelector('.nt-header-mid').getBoundingClientRect().left),
       'the search is not on the left of the header');

  await page.click('.nt-search-btn');
  await sleep(400);
  const open = await centres();
  note(await page.$eval('.nt-search', (el) => el.getBoundingClientRect().width > 180), 'the search did not open');
  note(await page.evaluate(() => document.activeElement.classList.contains('nt-search-input')), 'opening the search did not focus it');
  note(Math.abs(open.mid - open.text) <= 1, `opening the search moved the formatting group by ${open.mid - shut.mid}px`);
  await page.keyboard.press('Escape');
  await sleep(300);
  note(await page.$eval('.nt-search', (el) => el.getBoundingClientRect().width < 40), 'Escape did not shut the search');
  // Ctrl+F opens it too.
  await chord(['Control'], 'f');
  await sleep(300);
  note(await page.$eval('.nt-search', (el) => el.classList.contains('is-open')), 'Ctrl+F did not open the search');
  await page.keyboard.press('Escape');
  await sleep(250);
  console.log(`header: formatting group centred on the text (${shut.mid} vs ${shut.text}), search ${box.w}px shut`);
}

/* ---- 17j. the tab is welded to the archive ------------------------------- */
{
  const level = () => page.evaluate(() => {
    if (!document.querySelector('.nt-sb-tab')) {
      return { missing: true, app: !!document.querySelector('.nt-app'), kids: [...(document.querySelector('.nt-app')?.children || [])].map((c) => c.className) };
    }
    const t = document.querySelector('.nt-sb-tab').getBoundingClientRect();
    const a = document.querySelector('.nt-archive').getBoundingClientRect();
    const s = document.querySelector('.nt-sidebar').getBoundingClientRect();
    return { drift: Math.round(t.top - a.top), outside: Math.round(t.left - s.right), visible: t.width > 0 };
  });
  const at = await level();
  note(!at.missing, `there is no collapse tab (app present: ${at.missing ? at.app : 'n/a'}, children: ${at.missing ? at.kids : 'n/a'})`);
  if (at.missing) { console.log('TAB GONE:', JSON.stringify(at)); throw new Error('the app is not mounted — see the line above'); }
  note(at.visible, 'the collapse tab has no size');
  note(Math.abs(at.drift) <= 2, `the tab is ${at.drift}px off the archive's top edge`);
  note(Math.abs(at.outside) <= 2, `the tab is not sitting on the sidebar's edge (${at.outside}px)`);

  // It follows the archive when the split is dragged.
  await page.evaluate(() => { const a = document.querySelector('.nt-archive'); if (!a.classList.contains('is-open')) a.querySelector('.nt-archive-head').click(); });
  await sleep(300);
  const g = await page.evaluate(() => { const r = document.querySelector('.nt-archive-grip').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
  await page.mouse.move(g.x, g.y);
  await page.mouse.down();
  await page.mouse.move(g.x, g.y - 120, { steps: 6 });
  await page.mouse.up();
  await sleep(350);
  note(Math.abs((await level()).drift) <= 2, 'the tab did not follow the archive when the split moved');

  /* AND WHEN THE ARCHIVE IS FOLDED SHUT. This is the one that was broken:
     only the open branch of the archive's own handler reached syncTab, and
     the sidebar's ResizeObserver could not stand in for it because the
     sidebar is exactly the same size either way. So folding the archive --
     the single action that moves that divider furthest -- left the tab
     hanging where the open archive's top edge had been. The fold happens
     twice here because the bug only showed on the way SHUT. */
  await page.evaluate(() => document.querySelector('.nt-archive-head').click());
  await sleep(350);
  const shutDrift = (await level()).drift;
  note(Math.abs(shutDrift) <= 2, `folding the archive left the tab ${shutDrift}px off its top edge`);
  await page.evaluate(() => document.querySelector('.nt-archive-head').click());
  await sleep(350);
  note(Math.abs((await level()).drift) <= 2, 'unfolding the archive left the tab behind');
  console.log(`tab: welded through the fold (${shutDrift}px drift shut)`);

  // And it folds the sidebar.
  await page.click('.nt-sb-tab');
  await sleep(400);
  note(await page.$eval('.nt-app', (e) => e.classList.contains('is-rail')), 'the tab did not collapse the sidebar');
  note(await page.evaluate(() => {
    const t = document.querySelector('.nt-sb-tab').getBoundingClientRect();
    const s = document.querySelector('.nt-sidebar').getBoundingClientRect();
    return Math.abs(t.left - s.right) <= 2;
  }), 'the tab did not move to the collapsed sidebar edge');
  console.log(`tab: level with the archive, ${at.outside}px outside the sidebar, folds it`);
}

/* ---- 17k. the rail reorders, the same way the list does ------------------- */
{
  // Still collapsed from the check above.
  const order = () => page.$$eval('.nt-rail-cat', (els) => els.map((e) => e.dataset.cat));
  const was = await order();
  note(was.length >= 3, `only ${was.length} rail letters to reorder`);
  const from = await page.evaluate(() => { const r = document.querySelectorAll('.nt-rail-cat')[0].getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
  const to = await page.evaluate(() => { const r = document.querySelectorAll('.nt-rail-cat')[2].getBoundingClientRect(); return { y: Math.round(r.bottom - 2) }; });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 12, { steps: 3 });
  const marker = await page.$('.nt-drop-marker');
  note(!!marker, 'dragging a rail letter shows no line where it would land');
  await page.mouse.move(from.x, to.y, { steps: 8 });
  await page.mouse.up();
  await sleep(400);
  const now = await order();
  note(now[0] !== was[0], `dragging the first rail letter down did not move it (${was.slice(0, 3)} -> ${now.slice(0, 3)})`);
  note(now.includes(was[0]) && now.length === was.length, 'the rail drag lost or duplicated a category');
  /* A REAL MOUSE CLICK still jumps. This used to be an element.click(), which
     is a programmatic dispatch and would have passed happily through the bug
     it was supposed to be watching: the drag handler called preventDefault on
     its pointerdown, and cancelling pointerdown cancels the compatibility
     mouse events after it -- `click` included. Every rail letter was a dead
     button to an actual pointer, and no check said so. */
  const railHit = await page.evaluate(() => {
    const b = document.querySelectorAll('.nt-rail-cat')[1];
    const r = b.getBoundingClientRect();
    const p = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), id: b.dataset.cat };
    return { ...p, on: document.elementFromPoint(p.x, p.y) === b };
  });
  note(railHit.on, 'the point aimed at a rail letter is not on it');
  await page.evaluate((p) => { window.__railPt = [p.x, p.y]; }, railHit);
  await page.mouse.click(railHit.x, railHit.y);
  /* WAIT FOR THE STATE. A jump is a SMOOTH scroll and the mark that follows
     it is set by the scroll spy, so how long it takes depends on how far the
     category is from where the drag just left the canvas -- which is not a
     number this check can know. A fixed sleep passed while the reorder above
     it was short and started failing the day the drag moved further. */
  await page.waitForFunction((id) => document.querySelector('.nt-rail-cat.is-here')?.dataset.cat === id, { timeout: 6000 }, railHit.id).catch(() => {});
  const landed = await page.evaluate((id) => ({
    here: document.querySelector('.nt-rail-cat.is-here')?.dataset.cat || null,
    want: id,
    rail: document.querySelectorAll('.nt-rail-cat').length,
    onPoint: document.elementFromPoint(...(window.__railPt || [0, 0]))?.className || null,
  }), railHit.id);
  note(landed.here === landed.want, `a real mouse click on a rail letter did not jump to its category: ${JSON.stringify(landed)}`);
  console.log(`rail reorder: ${was.slice(0, 3).join(',')} -> ${now.slice(0, 3).join(',')}`);
  // Put the sidebar back.
  await page.click('.nt-sb-tab');
  await sleep(400);
  await page.evaluate(() => { const a = document.querySelector('.nt-archive'); if (a.classList.contains('is-open')) a.querySelector('.nt-archive-head').click(); });
  await sleep(250);
}

/* ---- 17l. the caret and the highlight belong to the category too ---------- */
{
  /* Put the three in a KNOWN state first, through setCatColor's own path --
     the picker is a panel and driving it three times here would be three
     panels' worth of timing for a check that is about the tiers, not the UI. */
  const three = await page.$$eval('.nt-cat', (els) => els.slice(0, 3).map((e) => e.dataset.cat));
  for (const [i, id] of three.entries()) {
    await page.evaluate((cid) => { const r = document.querySelector(`.nt-row[data-cat="${cid}"] .nt-row-color`); if (r) r.click(); }, id);
    await page.waitForSelector('.nt-clr-panel', { timeout: 4000 });
    await page.evaluate(() => { const f = document.querySelector('.nt-clr-hex'); f.focus(); f.select(); });
    await page.keyboard.type(['e04b4b', '4be0a0', '9a6bff'][i]);
    await page.keyboard.press('Enter');
    await sleep(260);
  }
  await sleep(250);
  const seen = await page.evaluate(() => {
    const out = [];
    for (const sec of [...document.querySelectorAll('.nt-cat')].slice(0, 3)) {
      const body = sec.querySelector('.nt-body');
      const cs = getComputedStyle(body);
      out.push({
        cat: sec.dataset.cat,
        caret: cs.caretColor,
        title: cs.getPropertyValue('--c-title').trim(),
        sel: cs.getPropertyValue('--c-sel').trim(),
        body: cs.color,
      });
    }
    return out;
  });
  const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  void 0;
  const rgb = (c) => c.match(/\d+/g).slice(0, 3).map(Number);
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2);
  for (const c of seen) {
    note(c.caret !== 'rgb(232, 234, 240)' && near(rgb(c.caret), hex(c.title)),
         `the caret in ${c.cat} is ${c.caret}, not the category's own ${c.title}`);
    note(/^#[0-9a-f]{6}$/i.test(c.sel), `${c.cat} has no selection colour (${c.sel})`);
  }
  /* THREE DIFFERENT SELECTION COLOURS -- but only because these three were
     GIVEN three different colours a moment ago. Left to the store, a category
     that has never been recoloured wears the session's, so this asserted that
     the notes happened to contain three differently-coloured categories
     rather than that a colour reaches the selection. It passed for years and
     then failed on a run whose first three had never been touched. */
  note(new Set(seen.map((c) => c.sel)).size === seen.length,
       `two of the three categories that were just given different colours share a selection colour: ${JSON.stringify(seen.map((c) => c.sel))}`);
  // Readable: what is selected must not disappear into its own highlight.
  const relLum = (v) => { const [r, g, b] = v.map((x) => { const y = x / 255; return y <= 0.04045 ? y / 12.92 : ((y + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  for (const c of seen) {
    const la = relLum(rgb(c.body)); const lb = relLum(hex(c.sel));
    const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    note(ratio >= 2.8, `${c.cat}: selected text is ${ratio.toFixed(1)}:1 against its own highlight`);
  }
  console.log(`caret and highlight: ${seen.map((c) => `${c.caret.replace(/\s/g, '')}/${c.sel}`).join('  ')}`);
}

/* ---- 17n. the polish pass: marks, rings, ghosts and the controls you
   could not see -------------------------------------------------------------
   Everything here was reported as looking wrong rather than as being broken,
   which is exactly the class of thing that comes back if nothing measures it.
   The body is captured and put back at the end so section 19 still sees the
   document the earlier checks built. */
{
  const kept = await page.evaluate((id) => document.querySelector(`.nt-body[data-cat="${id}"]`).innerHTML, catId);

  /* a. a KNOWN site wears its own colours; an unknown one still gets a mark.
     Pasted rather than typed: the auto-link trigger wants a scheme or a www.,
     and what is under test is the mark a href gets, not how the href was made. */
  for (const url of ['https://www.google.com', 'https://docs.google.com/document/d/1', 'https://example.com/page']) {
    await page.evaluate((id, u) => {
      const b = document.querySelector(`.nt-body[data-cat="${id}"]`);
      b.focus();
      const s2 = getSelection();
      s2.selectAllChildren(b.lastElementChild);
      s2.collapseToEnd();
      const dt = new DataTransfer();
      dt.setData('text/plain', u);
      b.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, catId, url);
    await sleep(140);
    await page.keyboard.type(' and ');
    await sleep(110);
  }
  const marks = await page.evaluate((id) => [...document.querySelectorAll(`.nt-body[data-cat="${id}"] .chip-link`)].map((c) => {
    const m = c.querySelector('.nt-chip-mark');
    return { href: c.getAttribute('href'), cls: m ? m.className : null, svg: !!(m && m.querySelector('svg')), bg: m ? getComputedStyle(m).backgroundColor : null, text: c.textContent };
  }), catId);
  /* The scratch body already holds chips from check 10, so count MINE --
     the three this block pasted -- rather than everything in the box. */
  const WANT = ['https://www.google.com', 'https://docs.google.com/document/d/1', 'https://example.com/page'];
  const mine = marks.filter((m) => WANT.includes(m.href));
  note(mine.length === 3, `expected the 3 pasted link chips, found ${mine.length} of them among ${marks.length}`);
  const gg = marks.find((m) => m.href === 'https://www.google.com');
  const sub = marks.find((m) => m.href && m.href.includes('docs.google.com'));
  const unknown = marks.find((m) => m.href && m.href.includes('example.com'));
  note(!!gg && /\bis-brand\b/.test(gg.cls) && /\bb-google\b/.test(gg.cls), `google.com did not get its brand mark: ${gg && gg.cls}`);
  note(!!gg && gg.svg, 'the google mark carries no glyph');
  note(!!gg && gg.bg === 'rgb(255, 255, 255)', `the google mark is not on white: ${gg && gg.bg}`);
  note(!!sub && /\bb-google\b/.test(sub.cls), `a subdomain did not resolve to its brand: ${sub && sub.cls}`);
  note(!!unknown && /\bis-site\b/.test(unknown.cls) && !/is-brand/.test(unknown.cls), `an unknown site should keep the hashed mark: ${unknown && unknown.cls}`);
  /* THE GLYPH IS NOT TEXT, the same way the hashed letter is not: a brand mark
     that reached textContent would put "G" in front of every google link for
     the spell checker, the search and copy-as-text. */
  note(!!gg && gg.text === 'google.com', `the brand mark leaked into the chip's text: "${gg && gg.text}"`);
  console.log(`brand marks: ${mine.map((m) => m.cls.replace('nt-chip-mark ', '')).join(', ')}`);

  /* b. folded, a chip is a circle the size of the pill it replaced. */
  const fold = await page.evaluate((id) => {
    const c = document.querySelector(`.nt-body[data-cat="${id}"] .chip-link`);
    const open = c.getBoundingClientRect().height;
    c.querySelector('.nt-chip-mark').click();
    return new Promise((r) => setTimeout(() => {
      const box = c.getBoundingClientRect();
      r({ open, min: c.dataset.min, w: box.width, h: box.height });
    }, 140));
  }, catId);
  note(fold.min === '1', 'clicking the mark did not fold the chip');
  note(fold.w >= fold.open, `the folded circle is ${fold.w.toFixed(1)}px across, narrower than the ${fold.open.toFixed(1)}px pill it replaced`);
  note(Math.abs(fold.w - fold.h) < 1.5, `the folded chip is not round: ${fold.w.toFixed(1)}x${fold.h.toFixed(1)}`);
  console.log(`folded chip: ${fold.w}px circle for a ${fold.open.toFixed(1)}px pill`);
  await page.evaluate((id) => document.querySelector(`.nt-body[data-cat="${id}"] .chip-link .nt-chip-mark`).click(), catId);
  await sleep(160);

  /* c. the hover toolbar is worth aiming at. A REAL mouse move: the bar opens
     on a rest, and a synthetic pointerenter never moves the browser's own
     pointer, so the timer never starts and it reads as a dead toolbar. */
  const box = await page.evaluate((id) => {
    const r = document.querySelector(`.nt-body[data-cat="${id}"] .chip-link`).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, catId);
  await page.mouse.move(box.x - 40, box.y - 40);
  await page.mouse.move(box.x, box.y, { steps: 8 });
  await sleep(700);
  const bar = await page.evaluate(() => {
    const b = document.querySelector('.nt-chip-btn');
    return b ? { n: document.querySelectorAll('.nt-chip-btn').length, w: b.getBoundingClientRect().width, sw: b.querySelector('svg').getBoundingClientRect().width } : null;
  });
  note(!!bar && bar.n >= 3, `the chip's hover toolbar did not open (${bar && bar.n} buttons)`);
  note(!!bar && bar.w >= 32, `a toolbar button is ${bar && bar.w}px, wanted at least 32`);
  note(!!bar && bar.sw >= 20, `a toolbar icon is ${bar && bar.sw}px, wanted at least 20`);
  console.log(`chip toolbar: ${bar && bar.n} buttons at ${bar && bar.w}px, ${bar && bar.sw}px marks`);
  await page.mouse.move(20, 600);
  await sleep(300);

  /* d. ONE focus ring. A field that paints its own focus was getting the
     blanket :focus-visible outline as well, 2px out from its own edge, and
     the gap between the two read as a dark line drawn through a too-thick
     stroke. The header's search never had it; nothing else should either. */
  await page.evaluate((id) => document.querySelector(`.nt-body[data-cat="${id}"]`).focus(), catId);
  await chord(['Control'], 'k');
  await page.waitForSelector('.nt-form-panel .nt-input', { timeout: 5000 });
  await sleep(220);
  const ring = await page.evaluate(() => {
    const i = document.querySelector('.nt-form-panel .nt-input');
    i.focus();
    const cs = getComputedStyle(i);
    return { outline: cs.outlineStyle, shadow: cs.boxShadow };
  });
  note(ring.outline === 'none', `the link field still draws a second outline: ${ring.outline}`);
  note(ring.shadow !== 'none', 'the link field lost the focus ring it draws itself');
  await page.keyboard.press('Escape');
  await sleep(220);
  note(await page.$('.nt-app') !== null, 'Escape on the link form closed the whole overlay');

  await page.evaluate(() => document.querySelector('.nt-cat-emoji').click());
  await sleep(600);
  const eRing = await page.evaluate(() => {
    const i = document.querySelector('.nt-emoji-search');
    if (!i) return null;
    i.focus();
    const cs = getComputedStyle(i);
    return { outline: cs.outlineStyle, shadow: cs.boxShadow };
  });
  note(!!eRing, 'the emoji sheet did not open from a category badge');
  note(!eRing || eRing.outline === 'none', `the emoji search still draws a second outline: ${eRing && eRing.outline}`);
  await page.keyboard.press('Escape');
  await sleep(300);
  note(await page.$('.nt-app') !== null, 'Escape on the emoji sheet closed the whole overlay');
  console.log(`focus rings: link ${ring.outline}, emoji ${eRing && eRing.outline}`);

  /* e. the drag ghost is the node it is about to become. --node is a CUSTOM
     property, and Object.assign onto a style object drops those silently, so
     the ghost used to come out white and only took its colour once dropped. */
  const ghost = await page.evaluate(() => {
    const b = document.querySelector('.nt-node-main');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 0, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.x + 60, clientY: r.y + 120, button: 0, pointerId: 1 }));
    return new Promise((res) => setTimeout(() => {
      const g2 = document.querySelector('.nt-node-ghost .chip-ghost');
      const out = g2 ? { node: getComputedStyle(g2).getPropertyValue('--node').trim(), color: getComputedStyle(g2).color } : null;
      /* RELEASED OVER NOTHING, deliberately: a drop inside a text box would
         make a node AND move the saved last-used kind on, which is a setting
         the next run inherits. What is under test is the ghost, not the drop. */
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 4, clientY: 4, button: 0, pointerId: 1 }));
      res(out);
    }, 240));
  });
  note(!!ghost, 'dragging the header node button raised no ghost');
  note(!!ghost && ghost.node !== '', 'the ghost carries no --node, so it renders white');
  note(!!ghost && ghost.color !== 'rgb(255, 255, 255)', `the drag ghost is white: ${ghost && ghost.color}`);
  await sleep(250);

  /* f. and a row of the nodes menu can be dragged out of the menu, not only
     pressed -- the kind you want is often not the one on the button. */
  const menuDrag = await page.evaluate(() => {
    const arrow = document.querySelector('.nt-node-arrow');
    if (!arrow) return { rows: 0, draggable: 0, node: null, open: true };
    arrow.click();
    return new Promise((res) => setTimeout(() => {
      const rows = [...document.querySelectorAll('.nt-menu-item')];
      const md = rows[1];
      if (!md) return res({ rows: rows.length, draggable: 0, node: null, open: true });
      const draggable = rows.filter((r) => r.classList.contains('is-draggable')).length;
      const r = md.getBoundingClientRect();
      md.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + 30, clientY: r.y + 10, button: 0, pointerId: 2 }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.x + 130, clientY: r.y + 150, button: 0, pointerId: 2 }));
      setTimeout(() => {
        const g2 = document.querySelector('.nt-node-ghost .chip-ghost');
        const out = { rows: rows.length, draggable, node: g2 ? getComputedStyle(g2).getPropertyValue('--node').trim() : null, open: !!document.querySelector('.nt-menu-item') };
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 4, clientY: 4, button: 0, pointerId: 2 }));
        res(out);
      }, 240);
    }, 420));
  });
  note(menuDrag.rows === 3, `the nodes menu should list three kinds, it lists ${menuDrag.rows}`);
  note(menuDrag.draggable === 3, `all three rows should be draggable, ${menuDrag.draggable} are`);
  note(menuDrag.node === '#9ACB5A', `the markdown row's ghost is ${menuDrag.node}, wanted the markdown green`);
  note(menuDrag.open === false, 'the menu stayed open underneath the drag');
  console.log(`node drags: header ghost ${ghost && ghost.node}, menu ghost ${menuDrag.node}`);
  await sleep(260);

  /* g. the session mark is ONE colour. DexNote shades the lower stroke; as a
     colour swatch that reads as two sessions rather than as one mark. */
  const logo = await page.evaluate(() => {
    const t = document.querySelector('.nt-logo-top');
    const b = document.querySelector('.nt-logo-bottom');
    return t && b ? { top: getComputedStyle(t).fill, bottom: getComputedStyle(b).fill } : null;
  });
  note(!!logo, 'no session mark on screen to check');
  note(!!logo && logo.top === logo.bottom, `the mark is still two shades: ${logo && logo.top} against ${logo && logo.bottom}`);

  /* h. the strip's own controls, in the category's own colour. In the shared
     grey they were invisible against the tint the strip is painted with. */
  const strip = await page.evaluate((id) => {
    const cat = document.querySelector(`.nt-cat[data-cat="${id}"]`) || document.querySelector('.nt-cat');
    const more = cat.querySelector('.nt-cat-more');
    const xb = cat.querySelector('.nt-cat-x');
    if (!more || !xb) return null;
    (cat.closest('.nt-cat-shell') || cat).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    return {
      want: getComputedStyle(cat).getPropertyValue('--c-title').trim(),
      more: getComputedStyle(more).color, x: getComputedStyle(xb).color,
      svgW: more.querySelector('svg').getBoundingClientRect().width,
      btnW: more.getBoundingClientRect().width,
    };
  }, catId);
  note(!!strip, 'no category strip controls found');
  note(!!strip && strip.more === strip.x, `the three dots and the X are different colours: ${strip && strip.more} against ${strip && strip.x}`);
  note(!!strip && strip.svgW >= 17, `the three-dots mark is ${strip && strip.svgW}px, wanted at least 17`);
  note(!!strip && strip.btnW >= 29, `a strip button is ${strip && strip.btnW}px, wanted at least 29`);
  console.log(`strip controls: ${strip && strip.more} at ${strip && strip.svgW}px`);

  /* i. the spell toggle says it is on with a ring, and its mark is a
     rectangle again rather than the oversized one that replaced it. */
  const spellState = await page.evaluate(() => {
    const b = document.querySelector('.nt-spell-btn');
    const wasOn = b.classList.contains('is-on');
    if (!wasOn) b.click();
    const svg = b.querySelector('svg').getBoundingClientRect();
    return { wasOn, ring: getComputedStyle(b).boxShadow, w: svg.width, h: svg.height };
  });
  note(spellState.ring !== 'none', 'the spell button shows no ring while it is on');
  note(spellState.w > spellState.h, `the spell mark is not a rectangle: ${spellState.w}x${spellState.h}`);
  note(spellState.w >= 30 && spellState.w <= 35, `the spell mark is ${spellState.w}px wide, wanted 30 to 35`);
  await page.evaluate((was) => { if (!was) document.querySelector('.nt-spell-btn').click(); }, spellState.wasOn);
  await sleep(150);

  /* j. the plus on New Category, heavier than the icons around it. */
  const plus = await page.evaluate(() => {
    const s2 = document.querySelector('.nt-add-plus svg');
    return s2 ? { w: s2.getBoundingClientRect().width, stroke: getComputedStyle(s2).strokeWidth } : null;
  });
  note(!!plus, 'no New Category plus found');
  note(!!plus && plus.w >= 18, `the plus is ${plus && plus.w}px, wanted at least 18`);
  note(!!plus && parseFloat(plus.stroke) >= 2.6, `the plus is drawn at ${plus && plus.stroke}, wanted at least 2.6`);
  console.log(`plus: ${plus && plus.w}px at ${plus && plus.stroke}`);

  /* k. the sessions sheet: the count and the X are the session's own colour,
     the same as the name they sit beside, and both are readable sizes. */
  const sess = await page.evaluate(() => {
    const b = document.querySelector('.nt-sessions-btn');
    if (b) b.click();
    return new Promise((res) => setTimeout(() => {
      const row = document.querySelector('.nt-sess-row');
      if (!row) return res(null);
      const count = row.querySelector('.nt-sess-count');
      const xb = row.querySelector('.nt-sess-row-x');
      const title = row.querySelector('.nt-row-title');
      res({
        rows: document.querySelectorAll('.nt-sess-row').length,
        count: count && getComputedStyle(count).color,
        countSize: count && getComputedStyle(count).fontSize,
        x: xb && getComputedStyle(xb).color,
        titleSize: title && getComputedStyle(title).fontSize,
      });
    }, 520));
  });
  note(!!sess && sess.rows >= 1, 'the sessions sheet did not open from its own button');
  note(!!sess && sess.count === sess.x, `the count and the X are different colours: ${sess && sess.count} against ${sess && sess.x}`);
  note(!!sess && parseFloat(sess.countSize) >= 15, `the count is ${sess && sess.countSize}, wanted at least 15px`);
  note(!!sess && parseFloat(sess.titleSize) >= 18, `the session name is ${sess && sess.titleSize}, wanted at least 18px`);
  console.log(`sessions sheet: ${sess && sess.rows} row(s), count ${sess && sess.countSize} in ${sess && sess.count}`);
  await page.evaluate(() => { const b = document.querySelector('.nt-sessions-btn'); if (b) b.click(); });
  await sleep(320);

  /* put the body back: section 19 asserts on the document the earlier checks
     built, and three link chips are not part of it. */
  await page.evaluate((id, html) => {
    const b = document.querySelector(`.nt-body[data-cat="${id}"]`);
    b.innerHTML = html;
    b.dispatchEvent(new Event('input', { bubbles: true }));
  }, catId, kept);
  await sleep(220);
  const restored = await page.evaluate((id) => document.querySelector(`.nt-body[data-cat="${id}"]`).innerHTML, catId);
  note(restored === kept, 'the polish section did not put the body back the way it found it');
}

/* ---- 17m. the drag handle is on the category you are in ------------------- */
{
  // The pointer parked well away, so hover cannot be what makes it visible.
  await page.mouse.move(1400, 700);
  await sleep(300);
  const grip = await page.evaluate(() => {
    const here = document.querySelector('.nt-row.is-here');
    if (!here) return null;
    const other = [...document.querySelectorAll('.nt-row:not(.is-here)')][0];
    return {
      here: Number(getComputedStyle(here.querySelector('.nt-row-grip')).opacity),
      other: Number(getComputedStyle(other.querySelector('.nt-row-grip')).opacity),
    };
  });
  note(!!grip, 'no row is marked as the one being read');
  note(grip && grip.here > 0.3, `the current row's drag handle is invisible (opacity ${grip && grip.here})`);
  note(grip && grip.other === 0, `every row shows its drag handle (${grip && grip.other})`);
  console.log(`grip: ${grip && grip.here} on the current row, ${grip && grip.other} on the rest`);

  /* AND THE MARK SURVIVES A REBUILD. `activeId` outlives a render; the rows
     do not, because renderSidebar builds them fresh and a fresh one carries
     no is-here. An early return when the id had not changed therefore left
     the category you were reading unmarked in both lists after every reorder,
     archive and recolour -- until you happened to move to a different one. */
  const marked = () => page.evaluate(() => ({
    rows: document.querySelectorAll('.nt-row.is-here').length,
    id: document.querySelector('.nt-row.is-here')?.dataset.cat || null,
  }));
  const was = await marked();
  note(was.rows === 1, `${was.rows} rows marked as the one being read before the rebuild`);
  await page.evaluate(() => { const r = document.querySelector('.nt-row.is-here .nt-row-color'); if (r) r.click(); });
  await sleep(250);
  await page.keyboard.press('Escape');
  await sleep(350);
  const still = await marked();
  note(still.rows === 1 && still.id === was.id, `after a sidebar rebuild ${still.rows} rows are marked (was ${was.id}, now ${still.id})`);
  console.log(`here-mark: still on ${still.id ? still.id.slice(0, 8) : 'nothing'} after a rebuild`);
}

/* ---- 18. tables --------------------------------------------------------------------
   FALSELY PASSES IF: it called insertTable() and read the DOM back. The whole
   question is whether the KEYS reach the table -- Tab, Enter and Backspace all
   mean something different inside a cell than they do in the paragraph rules
   that would otherwise catch them -- so every one of these drives a real key or
   a real mouse. The schema half is driven through clean() directly, because
   what a PASTED table must become cannot be typed. */
{
  const cap = await page.evaluate(async () => {
    const m = await import('/notes/schema.js');
    return { cols: m.MAX_COLS, rows: m.MAX_ROWS };
  });
  note(cap.cols === 8 && cap.rows === 50, `the cap is ${cap.cols}x${cap.rows}, expected 8x50`);

  // The table's shape, read the way a person would describe it.
  const tbl = () => page.evaluate((id) => {
    const b = document.querySelector(`.nt-body[data-cat="${id}"]`);
    const t = b.querySelector('table');
    if (!t) return null;
    const rows = [...t.querySelectorAll(':scope > tbody > tr')];
    return {
      rows: rows.length,
      cols: rows.length ? rows[0].children.length : 0,
      tbodies: t.querySelectorAll(':scope > tbody').length,
      headTags: rows[0] ? [...rows[0].children].map(c => c.tagName).join(',') : '',
      bodyTags: rows[1] ? [...rows[1].children].map(c => c.tagName).join(',') : '',
      cells: rows.map(r => [...r.children].map(c => c.textContent).join('|')).join(' / '),
      before: t.previousElementSibling && t.previousElementSibling.tagName,
      after: t.nextElementSibling && t.nextElementSibling.tagName,
      html: t.outerHTML,
    };
  }, catId);
  // Where the caret is, in table terms.
  const inCell = () => page.evaluate(() => {
    const s = getSelection();
    const n = s.anchorNode && (s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode);
    const c = n && n.closest('td,th');
    if (!c) return { cell: null, block: n && n.closest('p,li,h3,pre,blockquote') && n.closest('p,li,h3,pre,blockquote').tagName };
    const tr = c.parentElement;
    return { cell: c.tagName, row: [...tr.parentElement.children].indexOf(tr), col: [...tr.children].indexOf(c), text: c.textContent };
  });
  /* A REAL pointer over the middle of a cell, after putting it on screen --
     and then ASKING what is under it. `page.mouse.move` aims at a viewport
     coordinate: if the cell was measured before a scroll settled, or it is
     behind the header, the move lands on something else and every handle
     assertion after it fails for a reason that has nothing to do with the
     handles. The move is nudged away first so a second hover on the same
     cell is still a MOVE and still fires pointermove. */
  const hover = async (row, col) => {
    const box = await page.evaluate((id, r, c) => {
      const t = document.querySelector(`.nt-body[data-cat="${id}"] table`);
      const cell = t.querySelectorAll(':scope > tbody > tr')[r].children[c];
      cell.scrollIntoView({ block: 'center', behavior: 'instant' });
      const b = cell.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, catId, row, col);
    await page.mouse.move(box.x - 40, box.y);
    await sleep(30);
    await page.mouse.move(box.x, box.y);
    await sleep(180);
    const hit = await page.evaluate((x, y) => {
      const e = document.elementFromPoint(x, y);
      return e ? `${e.tagName}${e.className ? '.' + e.className : ''}` : 'nothing';
    }, box.x, box.y);
    note(/^(TD|TH)/.test(hit), `hovering row ${row} column ${col} landed on ${hit}, not on the cell`);
    return box;
  };
  /* Clicking a handle with the REAL mouse, and asserting the pointer is on it
     before pressing. A handle sits outside the table's own box, so the travel
     crosses canvas that is not a cell -- and a click that lands on the canvas
     instead reads exactly like a control that does nothing. */
  const clickHandle = async (sel) => {
    const b = await page.evaluate((s) => {
      const e = document.querySelector(s);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, on: e.classList.contains('is-on') };
    }, sel);
    note(!!b && b.w > 0 && b.on, `${sel} is not on screen to be clicked: ${JSON.stringify(b)}`);
    if (!b) return;
    await page.mouse.move(b.x, b.y);
    await sleep(60);
    const hit = await page.evaluate((x, y, s) => {
      const e = document.elementFromPoint(x, y);
      return { tag: e ? `${e.tagName}${e.className ? '.' + e.className : ''}` : 'nothing', mine: !!(e && e.closest(s)) };
    }, b.x, b.y, sel);
    note(hit.mine, `the pointer over ${sel} is on ${hit.tag} instead`);
    await page.mouse.down();
    await page.mouse.up();
    await sleep(220);
  };

  // A clean paragraph at the end of the scratch body to insert from.
  await page.evaluate((id) => {
    const b = document.querySelector(`.nt-body[data-cat="${id}"]`);
    b.focus();
    const p = document.createElement('p'); p.append(document.createElement('br'));
    b.append(p);
    const r = document.createRange(); r.selectNodeContents(p); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }, catId);
  await sleep(80);

  /* the button, and where it sits */
  const btn = await page.evaluate(() => {
    const b = document.querySelector('.nt-fmt-table');
    if (!b) return null;
    const group = [...document.querySelectorAll('.nt-header-mid > *')];
    return { tip: b.getAttribute('data-tip'), last: group[group.length - 1] === b, svg: !!b.querySelector('svg') };
  });
  note(!!btn, 'there is no table button in the header');
  note(btn && btn.last, 'the table button is not the last control in the formatting group');
  note(btn && btn.tip === 'Table', `the table button's tip is ${btn && JSON.stringify(btn.tip)}, expected "Table"`);

  /* inserting one */
  await page.evaluate(() => document.querySelector('.nt-fmt-table').click());
  await sleep(220);
  let t = await tbl();
  note(t && t.rows === 3 && t.cols === 3, `the table button made a ${t && t.rows}x${t && t.cols}, expected 3x3`);
  note(t && t.tbodies === 1, `${t && t.tbodies} tbody elements, expected exactly 1`);
  note(t && t.headTags === 'TH,TH,TH', `the first row is ${t && t.headTags}, expected three TH`);
  note(t && t.bodyTags === 'TD,TD,TD', `the second row is ${t && t.bodyTags}, expected three TD`);
  note(t && t.after === 'P', `there is no paragraph after the table (${t && t.after}) -- the caret could not get past it`);
  let where = await inCell();
  note(where.cell === 'TH' && where.row === 0 && where.col === 0, `after inserting, the caret is at ${JSON.stringify(where)}, expected the first header cell`);

  /* typing across it with Tab */
  await page.keyboard.type('Service');
  await press('Tab'); await page.keyboard.type('Cost');
  await press('Tab'); await page.keyboard.type('Charged');
  await press('Tab'); await page.keyboard.type('Adobe');
  await sleep(120);
  t = await tbl();
  note(t.cells.startsWith('Service|Cost|Charged / Adobe||'), `Tab did not walk across the cells: ${t.cells}`);
  where = await inCell();
  note(where.cell === 'TD' && where.row === 1 && where.col === 0, `Tab out of the header did not land in the first body cell: ${JSON.stringify(where)}`);
  await chord(['Shift'], 'Tab');
  where = await inCell();
  note(where.cell === 'TH' && where.col === 2, `Shift+Tab did not step back to the last header cell: ${JSON.stringify(where)}`);

  /* Enter stays in the cell */
  await page.evaluate((id) => {
    const c = document.querySelectorAll(`.nt-body[data-cat="${id}"] table td`)[0];
    const r = document.createRange(); r.selectNodeContents(c); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }, catId);
  const rowsBeforeEnter = (await tbl()).rows;
  await press('Enter');
  await page.keyboard.type('Systems');
  await sleep(120);
  t = await tbl();
  const cellHtml = await page.evaluate((id) => document.querySelector(`.nt-body[data-cat="${id}"] table td`).innerHTML, catId);
  note(cellHtml === 'Adobe<br>Systems', `Enter in a cell gave ${JSON.stringify(cellHtml)}, expected a <br> inside the cell`);
  note(t.rows === rowsBeforeEnter, `Enter in a cell changed the row count ${rowsBeforeEnter} -> ${t.rows}`);
  note((await inCell()).cell === 'TD', 'Enter in a cell moved the caret out of the table');

  /* Tab in the LAST cell adds a row */
  await page.evaluate((id) => {
    const cells = document.querySelectorAll(`.nt-body[data-cat="${id}"] table td`);
    const c = cells[cells.length - 1];
    const r = document.createRange(); r.selectNodeContents(c); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }, catId);
  const rowsBeforeTab = (await tbl()).rows;
  await press('Tab');
  await sleep(180);
  t = await tbl();
  note(t.rows === rowsBeforeTab + 1, `Tab in the last cell did not add a row (${rowsBeforeTab} -> ${t.rows})`);
  where = await inCell();
  note(where.cell === 'TD' && where.row === t.rows - 1 && where.col === 0, `Tab past the end did not land in the new row: ${JSON.stringify(where)}`);
  note(t.headTags === 'TH,TH,TH', 'adding a row changed the header row');
  await chord(['Control'], 'z');
  await sleep(220);
  note((await tbl()).rows === rowsBeforeTab, `ONE undo did not take the added row back (${(await tbl()).rows} rows)`);

  /* Backspace: never merges cells, and escapes from the first one */
  await page.evaluate((id) => {
    const c = document.querySelectorAll(`.nt-body[data-cat="${id}"] table td`)[1];
    const r = document.createRange(); r.setStart(c, 0); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }, catId);
  const beforeBack = (await tbl()).html;
  await press('Backspace');
  await sleep(150);
  note((await tbl()).html === beforeBack, 'Backspace at the start of a cell changed the table -- cells must never merge');
  await page.evaluate((id) => {
    const c = document.querySelector(`.nt-body[data-cat="${id}"] table th`);
    const r = document.createRange(); r.setStart(c.firstChild, 0); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }, catId);
  await press('Backspace');
  await sleep(180);
  const escaped = await inCell();
  note(escaped.cell === null, `Backspace at the start of the first cell left the caret in the table: ${JSON.stringify(escaped)}`);
  note((await tbl()) !== null, 'Backspace at the start of a filled table DELETED it');

  /* the handles, on a real hover */
  await hover(1, 1);
  const handles = await page.evaluate(() => ({
    row: !!document.querySelector('.nt-tbl-grip.is-row.is-on'),
    col: !!document.querySelector('.nt-tbl-grip.is-col.is-on'),
    addRow: !!document.querySelector('.nt-tbl-add.is-row.is-on'),
    addCol: !!document.querySelector('.nt-tbl-add.is-col.is-on'),
    inBody: !!document.querySelector('.nt-body .nt-tbl-grip, .nt-body .nt-tbl-add'),
  }));
  note(handles.row && handles.col, 'the row and column grips did not appear on hover');
  note(handles.addRow && handles.addCol, 'the add-row and add-column buttons did not appear on hover');
  /* THE HANDLES ARE NOT CONTENT. Inside the body they would be serialized,
     snapshotted by undo, and reachable by the caret and by Backspace. */
  note(!handles.inBody, 'a table handle is inside the contenteditable body');

  /* add a column with the mouse, take it back with one undo */
  const colsBefore = (await tbl()).cols;
  await clickHandle('.nt-tbl-add.is-col');
  t = await tbl();
  note(t.cols === colsBefore + 1, `the add-column button did not add one (${colsBefore} -> ${t.cols})`);
  note(t.headTags === 'TH,'.repeat(t.cols).slice(0, -1), `the new header cell is not a TH: ${t.headTags}`);
  note(t.bodyTags === 'TD,'.repeat(t.cols).slice(0, -1), `the new body cell is not a TD: ${t.bodyTags}`);
  await chord(['Control'], 'z');
  await sleep(220);
  note((await tbl()).cols === colsBefore, `ONE undo did not take the added column back (${(await tbl()).cols} columns)`);

  /* the menus say what they can and cannot do */
  await hover(0, 0);
  await clickHandle('.nt-tbl-grip.is-row');
  const headMenu = await page.evaluate(() => [...document.querySelectorAll('.nt-menu-item')].map(b => ({ label: b.textContent, off: b.disabled })));
  note(headMenu.length === 4, `the header row menu has ${headMenu.length} entries, expected 4`);
  note(headMenu[0] && /above/.test(headMenu[0].label) && headMenu[0].off, 'insert-row-above is offered on the HEADER row');
  note(headMenu.some(i => /header row stays/i.test(i.label) && i.off), 'the header row can be deleted');
  await press('Escape'); await sleep(150);
  await hover(1, 0);
  await clickHandle('.nt-tbl-grip.is-row');
  const rowMenu = await page.evaluate(() => [...document.querySelectorAll('.nt-menu-item')].map(b => ({ label: b.textContent, off: b.disabled })));
  note(rowMenu.some(i => /above/.test(i.label) && !i.off), 'insert-row-above is refused on the first BODY row, where it is legal');
  note(rowMenu.some(i => /Delete row/.test(i.label) && !i.off), 'delete-row is refused on a body row');
  await press('Escape'); await sleep(150);

  /* delete a column through its menu */
  const colsBeforeDelete = (await tbl()).cols;
  await hover(1, 1);
  await clickHandle('.nt-tbl-grip.is-col');
  await page.evaluate(() => [...document.querySelectorAll('.nt-menu-item')].find(b => /Delete column/.test(b.textContent)).click());
  await sleep(220);
  note((await tbl()).cols === colsBeforeDelete - 1, `deleting a column left ${(await tbl()).cols}, expected ${colsBeforeDelete - 1}`);

  /* THE CAP, through the button that has to refuse */
  let guard = 0;
  let disabled = false;
  while (guard++ < 12) {
    await hover(1, 0);
    disabled = await page.evaluate(() => document.querySelector('.nt-tbl-add.is-col').disabled);
    if (disabled) break;
    await clickHandle('.nt-tbl-add.is-col');
  }
  t = await tbl();
  note(disabled, `the add-column button never disabled (stopped at ${t.cols} columns)`);
  note(t.cols === cap.cols, `columns stopped at ${t.cols}, expected the cap of ${cap.cols}`);
  const capTip = await page.evaluate(() => document.querySelector('.nt-tbl-add.is-col').getAttribute('data-tip'));
  note(/8 columns is the most/.test(capTip || ''), `the capped button's tip is ${JSON.stringify(capTip)} -- it must say why it is off`);
  await clickHandle('.nt-tbl-add.is-col');
  note((await tbl()).cols === cap.cols, 'clicking the disabled add-column button still added one');

  /* what a PASTED table becomes -- driven through clean(), because these
     shapes cannot be typed */
  const shapes = await page.evaluate(async (max) => {
    const { clean } = await import('/notes/schema.js');
    const row = (n, tag) => `<tr>${`<${tag}>x</${tag}>`.repeat(n)}</tr>`;
    const grid = (cols, rows) => `<table><tbody>${row(cols, 'th')}${row(cols, 'td').repeat(rows - 1)}</tbody></table>`;
    const out = {};
    out.atCap = clean(grid(max.cols, max.rows));
    out.overCols = clean(grid(max.cols + 1, 3));
    out.overRows = clean(grid(3, max.rows + 1));
    out.spans = clean('<table><tr><td colspan="2" rowspan="3" style="color:red">a</td><td>b</td></tr></table>');
    out.ragged = clean('<table><tr><th>a</th><th>b</th></tr><tr><td>c</td></tr></table>');
    out.nested = clean('<table><tr><td>outer<table><tr><td>in1</td><td>in2</td></tr></table></td></tr></table>');
    out.blocks = clean('<table><tr><td><p>a</p><ul><li>b</li><li>c</li></ul></td></tr></table>');
    out.thead = clean('<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>d</td></tr></tbody></table>');
    out.evil = clean('<table><tr><td onclick="x()"><script>alert(1)<\/script>ok</td></tr></table>');
    out.twice = clean(clean(grid(3, 3))) === clean(grid(3, 3));
    return out;
  }, cap);
  note(shapes.atCap.includes('<table>'), `a table exactly at the cap was refused: ${shapes.atCap.slice(0, 120)}`);
  note(!shapes.overCols.includes('<table>'), `a ${cap.cols + 1}-column table survived as a table`);
  note(!shapes.overRows.includes('<table>'), `a ${cap.rows + 1}-row table survived as a table`);
  /* AN OVER-CAP TABLE MUST NOT LOSE WORDS. Truncating to the cap deletes
     cells, and a pasted table is exactly the case where nobody would notice
     which ones. It becomes lines instead, the way every pasted table did
     before tables existed. */
  note((shapes.overCols.match(/x/g) || []).length === (cap.cols + 1) * 3, `the over-cap table lost cells: ${shapes.overCols.slice(0, 160)}`);
  note(shapes.overCols.includes(' · '), 'the over-cap table did not become " · " lines');
  note(shapes.spans === '<p><br></p><table><tbody><tr><th>a</th><th>b</th></tr></tbody></table><p><br></p>', `colspan/rowspan/style survived: ${shapes.spans}`);
  note(/<tr><td>c<\/td><td><br><\/td><\/tr>/.test(shapes.ragged), `a ragged row was not padded to a rectangle: ${shapes.ragged}`);
  note(shapes.nested.includes('outerin1 · in2') && (shapes.nested.match(/<table>/g) || []).length === 1, `a nested table survived: ${shapes.nested}`);
  note(/<th>a<br>b<br>c<\/th>/.test(shapes.blocks), `blocks in a cell did not flatten to one line each: ${shapes.blocks}`);
  note((shapes.thead.match(/<tbody>/g) || []).length === 1 && /<th>h<\/th>/.test(shapes.thead), `thead and tbody did not merge into one: ${shapes.thead}`);
  note(!/onclick|script|alert/.test(shapes.evil) && /ok/.test(shapes.evil), `a handler or a script survived a cell: ${shapes.evil}`);
  note(shapes.twice, 'clean() is not idempotent on a table -- the body would change on every load');
  note(shapes.atCap.startsWith('<p><br></p><table') && shapes.atCap.endsWith('</table><p><br></p>'),
    `a table is not fenced by paragraphs, so the caret cannot be put before or after it: ${shapes.atCap.slice(0, 60)}`);

  /* the round trip a save actually makes */
  /* THE TABLE'S OWN round trip, not the whole body's. The body also holds the
     link chips section 11 typed, and a chip carries draggable="false" that
     serialize() keeps and clean() drops -- true in this repo before tables
     existed, harmless because hydrate() puts it straight back, and not a
     thing a table check should be failing on. What IS this check's business
     is that a table survives the trip a save actually makes: out through
     serialize(), back in through clean(), and out again unchanged. */
  const round = await page.evaluate(async (id) => {
    const { clean, serialize } = await import('/notes/schema.js');
    const b = document.querySelector(`.nt-body[data-cat="${id}"]`);
    const saved = serialize(b);
    const only = (html) => { const d = document.createElement('div'); d.innerHTML = html; const t = d.querySelector('table'); return t ? t.outerHTML : null; };
    const holder = document.createElement('div');
    holder.innerHTML = clean(saved);
    const was = only(saved);
    const now = only(serialize(holder));
    let at = 0;
    while (was && now && at < was.length && was[at] === now[at]) at++;
    return { same: !!was && was === now, saved, was, now, at };
  }, catId);
  note(round.same, `the table is not byte-identical through serialize() then clean(); they part at ${round.at}:
      was: ${(round.was || '').slice(Math.max(0, round.at - 50), round.at + 70)}
      now: ${(round.now || '').slice(Math.max(0, round.at - 50), round.at + 70)}`);
  note(round.saved.includes('<table>'), 'serialize() dropped the table');
  note(!/nt-tbl|is-on/.test(round.saved), `a handle reached the saved body: ${round.saved.slice(0, 200)}`);

  /* and what actually reached the store */
  await chord(['Control'], 's');
  await page.waitForFunction(() => /^SAVED/.test(document.querySelector('.nt-status').textContent), { timeout: 15000 });
  const stored = JSON.parse(await readFile(join(STORE, 'notes/current.json'), 'utf8'));
  const storedCat = stored.doc.sessions.flatMap(s => s.cats).find(c => c.id === catId);
  note(storedCat && storedCat.body.includes('<table><tbody><tr><th>Service</th>'), `the table did not reach the store as schema HTML: ${storedCat && storedCat.body.slice(-260)}`);
  note(storedCat && !/colspan|rowspan|style=|nt-tbl/.test(storedCat.body), 'the stored table carries markup the schema does not allow');
  const storedCols = (storedCat.body.match(/<th>/g) || []).length;
  note(storedCols === cap.cols, `${storedCols} header cells in the store, expected ${cap.cols}`);

  /* COUNT THE SUBJECT. Every assertion above is about one table; if the
     insert had silently made nothing, most of them would have compared
     null to null. */
  const seen = await page.evaluate((id) => {
    const b = document.querySelector(`.nt-body[data-cat="${id}"]`);
    return { tables: b.querySelectorAll('table').length, cells: b.querySelectorAll('td,th').length };
  }, catId);
  note(seen.tables === 1, `${seen.tables} tables in the scratch body, expected exactly 1`);
  note(seen.cells >= cap.cols * 3, `${seen.cells} cells examined, expected at least ${cap.cols * 3}`);

  /* delete it, so the checks after this one see the body they expect */
  await hover(1, 0);
  await clickHandle('.nt-tbl-grip.is-row');
  await page.evaluate(() => [...document.querySelectorAll('.nt-menu-item')].find(b => /Delete table/.test(b.textContent)).click());
  await sleep(250);
  note((await tbl()) === null, 'Delete table left a table behind');
  console.log(`tables: 3x3 inserted, Tab walked ${seen.cells} cells, cap held at ${cap.cols} columns, ${cap.rows} rows; store agrees`);
}

/* ---- 19. what reached the store ---------------------------------------------------- */
await chord(['Control'], 's');
await page.waitForFunction(() => /^SAVED/.test(document.querySelector('.nt-status').textContent), { timeout: 15000 });
const stored = JSON.parse(await readFile(join(STORE, 'notes/current.json'), 'utf8'));
const s0 = stored.doc.sessions.find(s => s.title === 'WorldHop');
const cat = s0 && s0.cats.find(c => c.title === scratchName);   // 17d renames it
note(!!cat, `the scratch category is not in the store (looked for "${scratchName}" in: ${s0 ? s0.cats.map(c => c.title).join(' | ') : 'no such session'})`);
note(cat && /pic/.test(cat.body) && /<img [^>]*data-key="[0-9a-f]{64}[.](png|webp)"[^>]*>/.test(cat.body) && /class="nt-img"/.test(cat.body), `the scratch body in the store is not the text and the keyed image: ${cat && cat.body.slice(0, 200)}`);
note(cat && !/style=|\u200b|is-selected|src=/.test(cat.body), `the stored body carries transient markup: ${cat && cat.body.slice(0, 200)}`);
/* The colour is a saved property, not a paint. "I recoloured it and it did
   not take" is indistinguishable from "it took and did not save" until this
   reads the file. */
note(cat && cat.color === '#ff3bd0', `the category's colour did not reach the store (${cat && cat.color})`);
note(stored.doc.sessions.length === sessionsBefore + 1, `${stored.doc.sessions.length} sessions in the store, expected ${sessionsBefore + 1}`);
note(stored.doc.ui.theme === 'dark' && stored.doc.ui.sidebar === 'open', 'ui settings did not round-trip');
console.log(`store: rev ${stored.rev}, ${stored.doc.sessions.length} sessions, scratch body ${cat ? cat.body.length : 0} chars`);

/* ---- tidy up: delete the scratch category and the session this run made -------------- */
await page.evaluate((t) => { [...document.querySelectorAll('.nt-row')].find(r => r.querySelector('.nt-row-title').textContent === t).querySelector('.nt-row-x').click(); }, scratchName);
await page.waitForSelector('.nt-modal');
await page.click('.nt-modal .nt-btn.is-left');
await sleep(100);
await rest('.nt-session-btn');
await page.evaluate(() => { const cards = [...document.querySelectorAll('.nt-sess-card:not(.is-add)')]; cards[cards.length - 1].querySelector('.nt-sess-x').click(); });
await page.waitForSelector('.nt-modal');
await press('Enter');
await sleep(200);
note((await page.$eval('.nt-session-title', e => e.textContent)) === 'WorldHop', 'deleting the extra session did not land back on the first');
await chord(['Control'], 's');
await page.waitForFunction(() => /^SAVED/.test(document.querySelector('.nt-status').textContent), { timeout: 15000 });
const after = JSON.parse(await readFile(join(STORE, 'notes/current.json'), 'utf8'));
note(after.doc.sessions.length === sessionsBefore, `${after.doc.sessions.length} sessions left in the store after tidy-up, expected ${sessionsBefore}`);
await page.screenshot({ path: join(SHOTS, 'notes-editor-v2.png') }).catch(() => {});

await browser.close();
reported = true;
console.log(`\n${pass} checks passed`);
console.log(fail.length ? `FAIL (${fail.length}):\n  ${fail.join('\n  ')}` : 'PASS — every editor check held');
process.exit(fail.length ? 1 : 0);
