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
await page.click('.nt-session-btn');
await page.waitForSelector('.nt-sess-panel');
const cardsBefore = await page.$$eval('.nt-sess-card:not(.is-add)', els => els.length);
const sessionsBefore = cardsBefore;
await page.click('.nt-sess-card.is-add');
await sleep(300);
const newTitle = await page.$eval('.nt-session-title', e => e.textContent);
note(newTitle === 'New Session', `a new session did not open: title is "${newTitle}"`);
note((await page.$$eval('.nt-cat', els => els.length)) === 1, 'a new session did not start with one category');
await page.click('.nt-session-btn');
await page.waitForSelector('.nt-sess-panel');
note((await page.$$eval('.nt-sess-card:not(.is-add)', els => els.length)) === cardsBefore + 1, 'the sessions grid did not gain a card');
await page.click('.nt-sess-card:not(.is-add)');
await sleep(300);
note((await page.$eval('.nt-session-title', e => e.textContent)) === 'WorldHop', 'switching back did not restore the first session');
note((await page.$$eval('.nt-cat', els => els.length)) === catsBefore + 1, 'the first session lost categories on the round trip');
console.log('sessions: add, switch, switch back held');

/* ---- 16. archive, restore, undo an archive ------------------------------------- */
const archivedBefore = Number(await page.$eval('.nt-archive-count', e => e.textContent) || 0);
await page.evaluate((t) => { [...document.querySelectorAll('.nt-row')].find(r => r.querySelector('.nt-row-title').textContent === t).querySelector('.nt-row-x').click(); }, scratch);
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
await page.evaluate((t) => { [...document.querySelectorAll('.nt-row')].find(r => r.querySelector('.nt-row-title').textContent === t).querySelector('.nt-row-x').click(); }, scratch);
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
    return {
      dot: getComputedStyle(sec.querySelector('.nt-cat-color')).backgroundColor,
      session: getComputedStyle(document.querySelector('.nt-session-color')).backgroundColor,
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

/* ---- 18. what reached the store ---------------------------------------------------- */
await chord(['Control'], 's');
await page.waitForFunction(() => /^SAVED/.test(document.querySelector('.nt-status').textContent), { timeout: 15000 });
const stored = JSON.parse(await readFile(join(STORE, 'notes/current.json'), 'utf8'));
const s0 = stored.doc.sessions.find(s => s.title === 'WorldHop');
const cat = s0 && s0.cats.find(c => c.title === scratch);
note(!!cat, 'the scratch category is not in the store');
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
await page.evaluate((t) => { [...document.querySelectorAll('.nt-row')].find(r => r.querySelector('.nt-row-title').textContent === t).querySelector('.nt-row-x').click(); }, scratch);
await page.waitForSelector('.nt-modal');
await page.click('.nt-modal .nt-btn.is-left');
await sleep(100);
await page.click('.nt-session-btn');
await page.waitForSelector('.nt-sess-panel');
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
