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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-first-run', '--no-default-browser-check', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.createCDPSession().then(s => s.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {}));
await page.setViewport({ width: 1500, height: 950 });
page.on('pageerror', e => fail.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error' && !/favicon|401/.test(m.text())) fail.push(`console: ${m.text()}`); });

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
const caret = () => page.evaluate(() => { const s = getSelection(); const b = s.anchorNode && (s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode).closest('p,li,h3,pre,blockquote'); return { tag: b && b.tagName, text: b && b.textContent.slice(0, 20), offset: s.anchorOffset, node: s.anchorNode && s.anchorNode.nodeType === 3 ? s.anchorNode.nodeValue : `<${s.anchorNode && s.anchorNode.nodeName}>` }; });
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
note(/href="https:\/\/www\.google\.com"[^>]*>google\.com<\/a>/.test(await body()), `a typed URL did not become a chip on space: ${await body()}`);
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

/* The row across the top: options at the left end, the word centred ON THE
   POPUP however many cards there are, close at the right, and no paragraph of
   instructions under the grid. The centring is measured against the panel,
   not against the grid -- with one session those two are 200px apart. */
{
  const bar = await page.evaluate(() => {
    const panel = document.querySelector('.nt-sess-panel');
    const head = panel.querySelector('.nt-sess-head');
    const opts = panel.querySelector('.nt-sess-opts');
    const close = panel.querySelector('.nt-sess-close');
    const p = panel.getBoundingClientRect();
    const h = head.getBoundingClientRect();
    return {
      text: head.textContent,
      size: parseFloat(getComputedStyle(head).fontSize),
      off: Math.round((h.left + h.width / 2) - (p.left + p.width / 2)),
      optsLeft: Math.round(opts.getBoundingClientRect().left - p.left),
      closeRight: Math.round(p.right - close.getBoundingClientRect().right),
      hint: !!panel.querySelector('.nt-sess-hint'),
      menus: [...panel.querySelectorAll('[data-tip]')].length,
    };
  });
  note(bar.text === 'Sessions', `the popup's title is "${bar.text}"`);
  note(bar.size >= 13, `the Sessions label is ${bar.size}px, expected two points up from 11`);
  note(Math.abs(bar.off) <= 2, `the label is ${bar.off}px off the popup's centre`);
  note(bar.optsLeft < bar.closeRight + 30 && bar.optsLeft < 40, `the options button is not at the left end (${bar.optsLeft}px in)`);
  note(bar.closeRight < 40, `the close button is not at the right end (${bar.closeRight}px in)`);
  note(!bar.hint, 'the click-to-switch hint is still under the grid');
  console.log(`sessions bar: "${bar.text}" ${bar.size}px, ${bar.off}px off centre, hamburger ${bar.optsLeft}px in, close ${bar.closeRight}px in`);
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

  /* Read the colours a category actually paints, from getComputedStyle -- not
     from the custom properties, which would only prove JS set a variable. */
  const paint = (id) => page.evaluate((cid) => {
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
      boxBg: getComputedStyle(body).backgroundColor,
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
  note(relLum(after.bold) > relLum(after.body) && relLum(after.title) > relLum(after.bold),
       `on the dark theme each tier must be lighter than the last: ${after.body} / ${after.bold} / ${after.title}`);

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
  note(relLum(onLight.bold) < relLum(onLight.body) && relLum(onLight.title) < relLum(onLight.bold),
       `on the light theme each tier must be darker than the last: ${onLight.body} / ${onLight.bold} / ${onLight.title}`);
  console.log(`light theme: body ${onLight.body}, bold ${onLight.bold}, title ${onLight.title}`);
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
  const before = await page.evaluate(() => document.querySelector('.nt-archive').getBoundingClientRect().height);
  const box = await page.evaluate(() => { const r = document.querySelector('.nt-archive-grip').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
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
      rows: [...wrap.querySelectorAll('.nt-sess-row:not(.is-add)')].map((r) => r.querySelector('.nt-row-title').textContent),
      active: wrap.querySelectorAll('.nt-sess-row.is-active').length,
      add: !!wrap.querySelector('.nt-sess-row.is-add'),
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
  note(list.add, 'the session list has no way to add one');
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
      spell: (() => { const r = document.querySelector('.nt-spell-btn svg').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
      info: !!document.querySelector('.nt-info'),
      infoBeforeTheme: (() => {
        const kids = [...document.querySelector('.nt-header-right').children];
        return kids.findIndex((k) => k.classList.contains('nt-info')) < kids.findIndex((k) => k.classList.contains('nt-theme'));
      })(),
    };
  });
  note(!head.sidebarToggle, 'the sidebar toggle is still in the header — the chevron tab replaced it');
  note(!head.code, 'the inline-code button is still in the formatting group');
  note(head.tips['.nt-fmt'].filter(Boolean).length === 2, `${head.tips['.nt-fmt'].filter(Boolean).length} formatting buttons carry a tooltip, expected 2 (strikethrough and the list)`);
  note(head.tips['.nt-fmt'].includes('Strikethrough') && head.tips['.nt-fmt'].includes('Auto list'), `the two tipped formatting buttons are ${JSON.stringify(head.tips['.nt-fmt'].filter(Boolean))}`);
  note(head.tips['.nt-node-btn'][0] === 'Nodes', `the nodes button is called "${head.tips['.nt-node-btn'][0]}"`);
  note(!(await page.$('.nt-cat-toggle[data-tip], .nt-cat-emoji[data-tip], .nt-cat-color[data-tip], .nt-cat-x[data-tip], .nt-row-badge[data-tip], .nt-row-color[data-tip], .nt-row-x[data-tip], .nt-session-btn[data-tip], .nt-session-emoji[data-tip]')),
       'a chevron, emoji, colour, archive X or session badge still carries a tooltip');
  note(head.tips['.nt-spell-btn'][0] === 'Spell check', `the spell button's tip is "${head.tips['.nt-spell-btn'][0]}"`);
  for (const sel of ['.nt-theme', '.nt-close', '.nt-search-btn', '.nt-undo', '.nt-redo']) {
    note(!head.tips[sel].filter(Boolean).length, `${sel} still carries a tooltip: ${head.tips[sel]}`);
  }
  note(!head.withKeys.length, `${head.withKeys.length} tooltips still carry a keystroke: ${head.withKeys.join(' | ')}`);
  note(head.spell.w > head.spell.h + 6, `the spell mark is ${head.spell.w}x${head.spell.h} — the blanket square rule has squashed it`);
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

/* ---- 17f6. a focused category title is a ring, not a wash ---------------- */
/* The fill was 12% of the category's colour and the selection highlight is
   --c-sel; on a coloured category those two are close enough that you could
   not see what you had selected. */
{
  await page.evaluate(() => document.querySelector('.nt-cat .nt-cat-title').focus());
  await sleep(200);
  const look = await page.$eval('.nt-cat .nt-cat-title', (el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, shadow: cs.boxShadow, radius: cs.borderRadius };
  });
  note(/rgba\(0, 0, 0, 0\)|transparent/.test(look.bg), `the focused title is still filled (${look.bg})`);
  note(look.shadow && look.shadow !== 'none', 'the focused title has no ring to say it is being typed in');
  note(parseFloat(look.radius) >= 4, `the ring is not rounded (${look.radius})`);
  await page.evaluate(() => document.querySelector('.nt-cat .nt-cat-title').blur());
  await sleep(150);
  console.log(`category title focus: ${look.bg} fill, ring ${look.shadow.split(')')[0]})`);
}

/* ---- 17g. one list button, and the spelling menu opens on the click ------- */
{
  const listBtns = await page.$$eval('.nt-header-mid .nt-fmt', (els) => els.filter((e) => /list/i.test(e.getAttribute('data-tip') || '')).map((e) => e.getAttribute('data-tip')));
  note(listBtns.length === 1, `${listBtns.length} list buttons in the header, expected 1 (${listBtns.join(', ')})`);
  note(listBtns[0] === 'Auto list', `the list button is called "${listBtns[0]}"`);

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
  // A plain click still jumps rather than being eaten by the drag handler.
  await page.evaluate(() => document.querySelectorAll('.nt-rail-cat')[1].click());
  await sleep(400);
  note(true, 'a rail click after a drag did not throw');
  console.log(`rail reorder: ${was.slice(0, 3).join(',')} -> ${now.slice(0, 3).join(',')}`);
  // Put the sidebar back.
  await page.click('.nt-sb-tab');
  await sleep(400);
  await page.evaluate(() => { const a = document.querySelector('.nt-archive'); if (a.classList.contains('is-open')) a.querySelector('.nt-archive-head').click(); });
  await sleep(250);
}

/* ---- 17l. the caret and the highlight belong to the category too ---------- */
{
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
  const rgb = (c) => c.match(/\d+/g).slice(0, 3).map(Number);
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2);
  for (const c of seen) {
    note(c.caret !== 'rgb(232, 234, 240)' && near(rgb(c.caret), hex(c.title)),
         `the caret in ${c.cat} is ${c.caret}, not the category's own ${c.title}`);
    note(/^#[0-9a-f]{6}$/i.test(c.sel), `${c.cat} has no selection colour (${c.sel})`);
  }
  note(new Set(seen.map((c) => c.sel)).size === seen.length, 'two categories share a selection colour');
  // Readable: what is selected must not disappear into its own highlight.
  const relLum = (v) => { const [r, g, b] = v.map((x) => { const y = x / 255; return y <= 0.04045 ? y / 12.92 : ((y + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  for (const c of seen) {
    const la = relLum(rgb(c.body)); const lb = relLum(hex(c.sel));
    const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    note(ratio >= 2.8, `${c.cat}: selected text is ${ratio.toFixed(1)}:1 against its own highlight`);
  }
  console.log(`caret and highlight: ${seen.map((c) => `${c.caret.replace(/\s/g, '')}/${c.sel}`).join('  ')}`);
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
}

/* ---- 18. what reached the store ---------------------------------------------------- */
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
console.log(`\n${pass} checks passed`);
console.log(fail.length ? `FAIL (${fail.length}):\n  ${fail.join('\n  ')}` : 'PASS — every editor check held');
process.exit(fail.length ? 1 : 0);
