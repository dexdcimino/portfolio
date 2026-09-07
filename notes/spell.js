/* Spell check and autocorrect.
 *
 * MARKING WITHOUT TOUCHING THE DOCUMENT. Misspellings are drawn with the CSS
 * Custom Highlight API: a set of Ranges the stylesheet paints with a wavy
 * underline. Nothing is wrapped, so the caret, the history and the saved
 * HTML never see the marks. Where the API is missing (old Safari, Firefox
 * before 140) the browser's own spellcheck attribute is the fallback, and
 * autocorrect still works because it never needed the marks.
 *
 * AUTOCORRECT. When a word is finished -- a space, a punctuation mark, Enter
 * -- and the dictionary does not know it, the dictionary's suggestions are
 * asked for and one is taken only when it is obviously what was meant: one
 * letter swapped, dropped, added or wrong, or two letters transposed, on a
 * word long enough for that to be unambiguous. A correction is its own undo
 * step, and Backspace straight after one puts the original back and stops
 * that word being corrected again this session.
 */

import { closest, liveRange, collapseAt } from './dom.js';
import { transact, bodyFrom } from './editor.js';
import { menu, toast, ICON } from './ui.js';

let ctx = null;
let worker = null;
let workerReady = false;
let workerFailed = false;
let seq = 0;
const waiting = new Map();
const cache = new Map();            // word -> bool (true = fine)
const marks = new Map();            // body -> Range[]
const scanTimers = new WeakMap();
const HAS_HIGHLIGHT = typeof Highlight === 'function' && !!(window.CSS && CSS.highlights);

const WORD = /[A-Za-z][A-Za-z'’]*[A-Za-z]|[A-Za-z]/g;
const SKIP = 'code, pre, a, .chip, [data-nospell]';

// Words this dictionary lacks that these notes use constantly.
const BUILTIN = new Set(['dex', 'dexnote', 'worldhop', 'roblox', 'youtube', 'vercel', 'github', 'discord', 'twitch',
  'unity', 'unreal', 'blender', 'photoshop', 'figma', 'notion', 'obsidian', 'npc', 'npcs', 'ui', 'ux', 'api', 'apis',
  'css', 'html', 'js', 'json', 'svg', 'png', 'jpg', 'webp', 'avif', 'gif', 'url', 'urls', 'http', 'https', 'wifi',
  'ok', 'okay', 'lol', 'gonna', 'wanna', 'gotta', 'kinda', 'sorta', 'todo', 'todos', 'wip', 'tbd', 'asap', 'fyi',
  'iphone', 'ipad', 'macbook', 'android', 'chromebook', 'gameplay', 'respawn', 'respawns', 'multiplayer', 'coop',
  'jetpack', 'jetpacks', 'hitbox', 'hitboxes', 'skybox', 'lightmap', 'shader', 'shaders', 'voxel', 'voxels', 'sprite',
  'sprites', 'texturing', 'rigging', 'lookdev', 'playtest', 'playtesting', 'devlog', 'changelog', 'backlog', 'readme']);

export function initSpell(context) {
  ctx = context;
  ctx.canvas.addEventListener('contextmenu', onContextMenu);
  ctx.canvas.addEventListener('keydown', onKeydown, true);
  applyEnabled();
}

function boot() {
  if (worker || workerFailed) return;
  try {
    worker = new Worker('/notes/spell-worker.js');
  } catch (err) {
    console.warn('notes: spell worker unavailable', err);
    workerFailed = true;
    return;
  }
  worker.onmessage = (e) => {
    if ('ready' in e.data) {
      workerReady = e.data.ready;
      if (!workerReady) { workerFailed = true; console.warn('notes: dictionary failed', e.data.error); }
      else rescanAll();
      return;
    }
    const w = waiting.get(e.data.id);
    if (w) { waiting.delete(e.data.id); w(e.data.result); }
  };
  worker.onerror = (e) => { console.warn('notes: spell worker error', e.message); workerFailed = true; };
}

function ask(msg) {
  return new Promise((resolve) => {
    if (!worker || workerFailed) { resolve(null); return; }
    const id = ++seq;
    waiting.set(id, resolve);
    worker.postMessage({ id, ...msg });
  });
}

export function enabled() { return !!ctx.doc.ui.spell; }
export function autocorrectOn() { return !!ctx.doc.ui.autocorrect; }

export function setEnabled(on) {
  ctx.doc.ui.spell = !!on;
  ctx.uiChanged();
  applyEnabled();
}

export function setAutocorrect(on) {
  ctx.doc.ui.autocorrect = !!on;
  ctx.uiChanged();
  if (on) boot();
}

function applyEnabled() {
  const on = enabled();
  ctx.root.classList.toggle('is-spell', on);
  // Native squiggles only where the Highlight API cannot draw ours.
  for (const body of ctx.canvas.querySelectorAll('.nt-body')) body.spellcheck = on && !HAS_HIGHLIGHT;
  if (on || autocorrectOn()) boot();
  if (!on) { marks.clear(); paint(); } else rescanAll();
}

function known(word) {
  const lower = word.toLowerCase();
  if (BUILTIN.has(lower)) return true;
  if (ctx.doc.spell.ignore.includes(lower) || ctx.doc.spell.custom.includes(lower)) return true;
  if (word.length < 2) return true;
  if (/\d/.test(word)) return true;
  // camelCase and ALLCAPS identifiers are names, not words.
  if (/[a-z][A-Z]/.test(word)) return true;
  return null;
}

/* ---- scanning ---------------------------------------------------------------- */

export function rescanAll() {
  if (!enabled()) return;
  for (const body of ctx.canvas.querySelectorAll('.nt-body')) rescan(body);
}

export function rescan(body, delayMs = 250) {
  if (!enabled() || !HAS_HIGHLIGHT) return;
  clearTimeout(scanTimers.get(body));
  scanTimers.set(body, setTimeout(() => scan(body), delayMs));
}

export function forget(body) {
  marks.delete(body);
  paint();
}

async function scan(body) {
  if (!body.isConnected) { marks.delete(body); paint(); return; }
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (closest(n, SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const found = [];   // [node, start, end, word]
  const unknown = new Set();
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.nodeValue;
    WORD.lastIndex = 0;
    let m;
    while ((m = WORD.exec(text))) {
      const word = m[0].replace(/[’]/g, "'");
      const k = known(word);
      if (k === true) continue;
      found.push([node, m.index, m.index + m[0].length, word]);
      if (!cache.has(word)) unknown.add(word);
    }
  }
  if (unknown.size) {
    if (!workerReady) return;      // the ready message triggers a rescan
    const words = [...unknown];
    const result = await ask({ op: 'check', words });
    if (!result) return;
    words.forEach((w, i) => cache.set(w, result[i]));
    if (!body.isConnected) return;
  }
  const ranges = [];
  for (const [node, start, end, word] of found) {
    if (!node.isConnected || cache.get(word) !== false) continue;
    try {
      const r = new StaticRange({ startContainer: node, startOffset: start, endContainer: node, endOffset: end });
      ranges.push(r);
    } catch { /* node changed under us */ }
  }
  marks.set(body, ranges);
  paint();
}

function paint() {
  if (!HAS_HIGHLIGHT) return;
  const all = [];
  for (const [body, ranges] of marks) {
    if (!body.isConnected) { marks.delete(body); continue; }
    all.push(...ranges);
  }
  if (!all.length) { CSS.highlights.delete('nt-spell'); return; }
  CSS.highlights.set('nt-spell', new Highlight(...all));
}

/* ---- the right-click menu -------------------------------------------------------- */

function wordAt(x, y) {
  const at = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
  if (!at || at.startContainer.nodeType !== 3) return null;
  const node = at.startContainer;
  if (closest(node, SKIP)) return null;
  const text = node.nodeValue;
  WORD.lastIndex = 0;
  let m;
  while ((m = WORD.exec(text))) {
    if (at.startOffset >= m.index && at.startOffset <= m.index + m[0].length) {
      return { node, start: m.index, end: m.index + m[0].length, word: m[0].replace(/[’]/g, "'") };
    }
  }
  return null;
}

async function onContextMenu(e) {
  const body = bodyFrom(e.target);
  if (!body || !enabled()) return;
  if (e.target.closest('.chip, img')) return;
  const hit = wordAt(e.clientX, e.clientY);
  if (!hit) return;
  if (known(hit.word) === true) return;
  if (cache.get(hit.word) !== false) return;    // not marked: native menu
  e.preventDefault();
  const suggestions = (await ask({ op: 'suggest', word: hit.word, limit: 6 })) || [];
  const replace = (with_) => transact(body, () => {
    const r = document.createRange();
    r.setStart(hit.node, hit.start);
    r.setEnd(hit.node, hit.end);
    r.deleteContents();
    const t = document.createTextNode(matchCase(hit.word, with_));
    r.insertNode(t);
    collapseAt(t, t.nodeValue.length);
    body.normalize();
  });
  const items = suggestions.map((s) => ({ label: s, run: () => { replace(s); rescan(body, 0); } }));
  if (!items.length) items.push({ label: 'No suggestions', disabled: true, run: () => {} });
  items.push(null,
    { label: `Ignore "${hit.word}"`, run: () => { addWord('ignore', hit.word); } },
    { label: 'Add to dictionary', icon: ICON.plus, run: () => { addWord('custom', hit.word); } });
  menu({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }, items, { focusFirst: false });
}

function addWord(list, word) {
  const lower = word.toLowerCase();
  if (!ctx.doc.spell[list].includes(lower)) ctx.doc.spell[list].push(lower);
  ctx.uiChanged();
  cache.delete(word);
  rescanAll();
  toast(list === 'custom' ? `"${word}" added to your dictionary` : `"${word}" ignored`);
}

export function removeWord(list, word) {
  ctx.doc.spell[list] = ctx.doc.spell[list].filter((w) => w !== word);
  ctx.uiChanged();
  rescanAll();
}

function matchCase(from, to) {
  if (from === from.toUpperCase() && from.length > 1) return to.toUpperCase();
  if (from[0] === from[0].toUpperCase()) return to[0].toUpperCase() + to.slice(1);
  return to;
}

/* ---- autocorrect ------------------------------------------------------------------- */

const noCorrect = new Set();     // words reverted this session
let last = null;                 // { body, node, start, from, to, at }

const CONTRACTIONS = {
  dont: "don't", cant: "can't", wont: "won't", didnt: "didn't", doesnt: "doesn't", isnt: "isn't", wasnt: "wasn't",
  werent: "weren't", couldnt: "couldn't", shouldnt: "shouldn't", wouldnt: "wouldn't", havent: "haven't", hasnt: "hasn't",
  hadnt: "hadn't", im: "I'm", ive: "I've", ill: "I'll", youre: "you're", youve: "you've", theyre: "they're", theyve: "they've",
  thats: "that's", whats: "what's", theres: "there's", heres: "here's", lets: "let's", arent: "aren't", aint: "ain't",
  i: 'I',
};
const FIXED = {
  teh: 'the', hte: 'the', adn: 'and', nad: 'and', taht: 'that', thsi: 'this', tihs: 'this', wiht: 'with', whcih: 'which',
  waht: 'what', jsut: 'just', liek: 'like', becuase: 'because', becasue: 'because', beacuse: 'because', recieve: 'receive',
  definately: 'definitely', definitly: 'definitely', seperate: 'separate', occured: 'occurred', untill: 'until',
  alot: 'a lot', wich: 'which', thier: 'their', freind: 'friend', truely: 'truly', tommorow: 'tomorrow', tomorow: 'tomorrow',
  fodler: 'folder', fiel: 'file', shoudl: 'should', woudl: 'would', coudl: 'could', hvae: 'have', ahve: 'have', yuo: 'you',
  yoru: 'your', thna: 'than', tehn: 'then', thne: 'then', ot: 'to', fo: 'of', si: 'is', ti: 'it', ni: 'in', no: null,
};

/* Called after a word-ending character was typed. `char` is that character. */
export async function wordDone(body, char) {
  if (!autocorrectOn()) return;
  const range = liveRange(body);
  if (!range || !range.collapsed || range.startContainer.nodeType !== 3) return;
  const node = range.startContainer;
  if (closest(node, SKIP)) return;
  const caret = range.startOffset;
  const text = node.nodeValue;
  // The character just typed sits right before the caret; the word before it.
  const endWord = caret - (char ? char.length : 0);
  if (endWord <= 0) return;
  const before = text.slice(0, endWord);
  const m = /([A-Za-z][A-Za-z']*)$/.exec(before);
  if (!m) return;
  const word = m[1];
  const start = endWord - word.length;
  if (start > 0 && /[A-Za-z0-9@#/._-]/.test(text[start - 1])) return;   // part of a token
  const fix = await correction(word);
  if (!fix) return;
  // Still there? Typing may have continued while the dictionary answered.
  const r2 = liveRange(body);
  if (!node.isConnected || !r2 || r2.startContainer !== node || node.nodeValue.slice(start, endWord) !== word) return;
  transact(body, () => {
    const caretNow = r2.startOffset;
    node.nodeValue = node.nodeValue.slice(0, start) + fix + node.nodeValue.slice(endWord);
    collapseAt(node, caretNow + (fix.length - word.length));
  });
  last = { body, node, start, from: word, to: fix, at: Date.now() };
  ctx.flashCorrection(node, start, fix.length);
}

async function correction(word) {
  const lower = word.toLowerCase();
  if (noCorrect.has(lower)) return null;
  if (known(word) === true) return null;
  if (word.length < 2) return null;
  if (CONTRACTIONS[lower] !== undefined && CONTRACTIONS[lower] !== null) {
    if (lower === 'i') return word === 'i' ? 'I' : null;
    return matchCase(word, CONTRACTIONS[lower]);
  }
  if (Object.prototype.hasOwnProperty.call(FIXED, lower) && FIXED[lower]) return matchCase(word, FIXED[lower]);
  if (word.length < 4) return null;
  // Proper nouns and shouting are left alone.
  if (word[0] === word[0].toUpperCase() && word.slice(1) !== word.slice(1).toLowerCase()) return null;
  if (word === word.toUpperCase()) return null;
  if (!workerReady) return null;
  const okList = await ask({ op: 'check', words: [word] });
  if (!okList || okList[0] !== false) return null;
  cache.set(word, false);
  const suggestions = await ask({ op: 'suggest', word: lower, limit: 6 });
  if (!suggestions || !suggestions.length) return null;
  const close = suggestions.filter((s) => /^[a-z]+$/i.test(s) && damerau(lower, s.toLowerCase()) === 1);
  if (!close.length) return null;
  // Several one-edit neighbours: take the first (Typo orders by likelihood)
  // only if it keeps the first letter, which is the letter people get right.
  const pick = close.find((s) => s[0].toLowerCase() === lower[0]) || (close.length === 1 ? close[0] : null);
  if (!pick) return null;
  // Long words can take a second edit when the ends match.
  return matchCase(word, pick);
}

/* Damerau-Levenshtein, capped: returns 0, 1, or 2 (meaning "2 or more"). */
function damerau(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  const m = a.length; const n = b.length;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return Math.min(2, d[m][n]);
}

/* Backspace right after a correction reverts it. */
function onKeydown(e) {
  if (e.key !== 'Backspace' || !last) return;
  if (Date.now() - last.at > 4000) { last = null; return; }
  const { body, node, start, from, to } = last;
  const range = liveRange(body);
  if (!range || !range.collapsed || range.startContainer !== node || !node.isConnected) { last = null; return; }
  const expectedEnd = start + to.length;
  // Caret must be right after the corrected word plus the one character
  // typed after it (a space) -- or right after the word.
  if (range.startOffset !== expectedEnd && range.startOffset !== expectedEnd + 1) { last = null; return; }
  if (node.nodeValue.slice(start, expectedEnd) !== to) { last = null; return; }
  e.preventDefault();
  e.stopPropagation();
  const gap = range.startOffset - expectedEnd;
  transact(body, () => {
    node.nodeValue = node.nodeValue.slice(0, start) + from + node.nodeValue.slice(expectedEnd);
    collapseAt(node, start + from.length + gap);
  });
  noCorrect.add(from.toLowerCase());
  last = null;
  toast(`Kept "${from}"`);
}

export function stats() {
  return { highlight: HAS_HIGHLIGHT, ready: workerReady, failed: workerFailed, cached: cache.size };
}
