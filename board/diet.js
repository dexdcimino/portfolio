/* The Dex Board Diet tab: Dex diet notes, read live at runtime.
 *
 * The diet content canonically lives in the private notes document, the
 * same document the Notes tab edits. This tab builds the shared owner
 * backend from board/notes-backend.js, reads the parsed document through
 * getDocument(), and finds the diet section by title search. It never
 * ships food content of its own: if no section matches, it shows an
 * honest empty state. The notes document is only ever READ here.
 *
 * Search order: the terms diet, food, recipe, meal, and nutrition, in
 * that order. For each term, session titles are checked first in
 * document order, then category titles across every session in document
 * order. Matching is case insensitive. A matching session contributes all
 * of its live categories; a matching category is used on its own.
 *
 * Layout (round 3, dev-board style): ONE card per notes category (the main
 * categories: Get and try, Staples, Baking, Quick combos, Recipes), plus a
 * Daily targets card and a Find card. Content before a category's first h3
 * is its intro line (the card's sub). Inside a category each h3 starts a
 * block, which becomes ROWS of that card, of one of four kinds decided by
 * its shape:
 *   recipe  a block with bold-labelled paragraphs (Uses, Make it, Swap) or
 *           any block in a category whose title says recipe. One row; a
 *           click opens its ingredients and method in place.
 *   combos  a list whose items are bold-named or long (assemble-and-eat).
 *           A small label, then one row per combo, clamped to one line
 *           until clicked.
 *   foods   a list of short items. One row per group (name, preview, a
 *           clean/balanced/treat mix bar and a count); a click opens its
 *           chips. A health or text filter opens every matching group.
 *   note    paragraphs only (Leavening rules). One row that opens its text.
 * Nothing scrolls inside a card: lists over CLAMP_AT rows show the first
 * CLAMP_TO and a "Show all" button.
 * Every food, combo and recipe is rendered from text only (textContent),
 * never by cloning the notes HTML into the page.
 *
 * Healthiness: the notes carry no health data, so every food, combo and
 * recipe gets a DEFAULT level from HEALTH_WORDS below (generic food words,
 * longest match wins, unknown = balanced). Clicking a food chip, or the dot
 * on a combo or recipe, cycles clean -> balanced -> treat. Overrides live
 * in the board-diet store doc as health: { "<lowercased text>": level };
 * cycling back to the default deletes the override. The filter bar narrows
 * by level, by category and by a text search; a row or card left with
 * nothing visible is hidden.
 *
 * Daily targets: calories, protein and water, each a target and today's
 * number, saved as targets: {...} and today: { date, ... } in the same doc.
 * Today's numbers reset when the date changes.
 *
 * The board-diet doc predates this version and holds { tags: {...} } from
 * the old per-food group tags. That field is read and written back
 * untouched, so nothing in it is lost.
 *
 * Shell interface: board/board.js dynamically imports this module and
 * calls mount(container, ctx), awaiting the promise it returns, and
 * calls unmount() on sign out. ctx provides
 * { user, uid, store, dnd, boardApi }. This tab uses ctx.user for the
 * unlock exchange and ctx.store for the board-diet doc.
 */

import { createNotesBackend } from './notes-backend.js';

const SEARCH_TERMS = ['diet', 'food', 'recipe', 'meal', 'nutrition'];
const LEVELS = ['clean', 'balanced', 'treat'];
const LEVEL_LABEL = { clean: 'Clean', balanced: 'Balanced', treat: 'Treat' };

/* Generic food words only. A phrase takes the level of the LONGEST word
   in it, so "chocolate protein powder" is clean and "dark chocolate" is
   balanced while "chocolate" alone is a treat. */
const HEALTH_WORDS = {
  clean: [
    'egg', 'egg white', 'egg whites', 'greek yogurt', 'kefir', 'berries', 'berry', 'broccoli',
    'shrimp', 'fish', 'tuna', 'salmon', 'smoked salmon', 'chicken', 'turkey', 'tofu', 'buffalo',
    'lamb', 'oatmeal', 'oats', 'steel-cut oats', 'cucumber', 'tomato', 'tomatoes', 'avocado',
    'veg', 'vegetables', 'eggplant', 'seaweed', 'bean sprouts', 'garlic', 'ginger', 'onion',
    'cilantro', 'basil', 'lime', 'lemon', 'jalapeño', 'jalapeno', 'salsa', 'apple', 'apples',
    'pear', 'apricot', 'pineapple', 'mango', 'banana', 'bananas', 'seltzer', 'tea', 'water',
    'kombucha', 'whey', 'protein powder', 'protein powders', 'whey protein', 'egg white powder',
    'chia', 'chia seeds', 'hemp', 'hemp hearts', 'multivitamin', 'fish oil', 'vitamin',
    'magnesium', 'electrolyte', 'nuun', 'lmnt', 'cottage cheese', 'almonds', 'pistachios',
    'olive oil', 'avocado oil', 'vinegar', 'rice vinegar', 'balsamic', 'spinach', 'kale',
    'lentils', 'beans', 'quinoa', 'sweet potato', 'coconut flour', 'almond flour', 'cinnamon',
    'monk fruit', 'pickles', 'olives', 'green olives', 'hummus', 'pepper', 'cacao', 'protein drinks',
    'almond milk', 'vanilla extract', 'mixed nuts', 'seasoned almonds',
  ],
  balanced: [
    'granola', 'honey', 'dates', 'dried fruit', 'croissant', 'croissants', 'cheese', 'feta',
    'mozzarella', 'goat cheese', 'parmesan', 'butter', 'sour cream', 'cream cheese', 'jerky',
    'noodles', 'bread', 'rice', 'cream of wheat', 'coffee', 'protein bar', 'peanut butter',
    'nut butter', 'almond butter', 'hoisin', 'soy sauce', 'sriracha', 'hot sauce', 'dressing',
    'celsius', 'liquid iv', 'iced tea', 'iced teas', 'coconut cream', 'coconut milk',
    'coconut butter', 'shredded coconut', 'dark chocolate', 'cocoa', 'sugar-free', 'macadamias',
    'macadamia', 'sesame oil', 'salt', 'sea salt', 'pepperoncini', 'tapioca', 'soup', 'yogurt',
    'milk', 'protein bread', 'pancake bowl', 'parfait', 'pudding', 'cloud bread', 'mayo',
    'marinara', 'pho', 'ramen', 'caprese', 'chunky soup', 'ribeye', 'milk tea',
    'dark chocolate chips', 'sugar-free jello', 'protein brownie',
  ],
  treat: [
    'candy', 'chocolate', 'chocolate chips', 'spam', 'cake', 'brownie', 'fudge', 'pancakes',
    'tart', 'tarte', 'tarte tatin', 'pie', 'cookie', 'cookies', 'ice cream', 'sugar',
    'brown sugar', 'sesame balls', 'chips', 'soda', 'fries', 'bacon', 'salami', 'pepperoni',
    'fruit bites', 'donut', 'doughnut', 'pastry', 'frosting', 'whipped cream', 'jello',
    'ginger candy', 'mozzarella sticks', 'bacon-wrapped',
  ],
};

const LEVEL_OF_WORD = new Map();
for (const level of LEVELS) for (const word of HEALTH_WORDS[level]) LEVEL_OF_WORD.set(word, level);
const WORDS_LONGEST_FIRST = [...LEVEL_OF_WORD.keys()].sort((a, b) => b.length - a.length);
const WORD_PATTERNS = WORDS_LONGEST_FIRST.map((word) => ({
  word,
  re: new RegExp('(?<![\\p{L}])' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:s|es)?(?![\\p{L}])', 'iu'),
}));

const TARGETS = [
  { key: 'calories', label: 'Calories', unit: 'kcal', step: 100, quick: [100, 250] },
  { key: 'protein', label: 'Protein', unit: 'g', step: 5, quick: [10, 25] },
  { key: 'water', label: 'Water', unit: 'cups', step: 1, quick: [1] },
];

let host = null;
let generation = 0;
let storeRef = null;
let saved = { tags: {}, health: {}, targets: {}, today: {} };
let gridEl = null;
let healthFilter = 'all';
let catFilter = 'all';
let query = '';
let filterUi = null;
let items = [];        /* every filterable thing: { key, text, def, node, dotHost, card, cat, group? } */
let groups = [];       /* expandable food-group rows: { li, head, meta, mix, body, open, items, total } */
let lists = [];        /* clamped lists: { ul, more, expanded } */
const CLAMP_AT = 10;
const CLAMP_TO = 8;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showLine(container, text) {
  container.replaceChildren(el('div', 'board-loading-card', text));
}

function titleHas(title, term) {
  return typeof title === 'string' && title.toLowerCase().includes(term);
}

function todayStamp() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/* ---- the source ------------------------------------------------------ */

function findDietSource(doc) {
  const sessions = doc && Array.isArray(doc.sessions) ? doc.sessions : [];
  for (const term of SEARCH_TERMS) {
    for (const session of sessions) {
      if (session && titleHas(session.title, term)) return { kind: 'session', title: session.title, session };
    }
    for (const session of sessions) {
      const cats = session && Array.isArray(session.cats) ? session.cats : [];
      for (const cat of cats) {
        if (cat && titleHas(cat.title, term)) return { kind: 'category', title: cat.title, cat };
      }
    }
  }
  return null;
}

/* Split one category body on its h3 headings. Returns the intro text and
   the blocks, each { heading, nodes } with nodes still in the parsed
   (inert) document: they are only ever read for text. */
function splitBody(bodyHtml) {
  const html = typeof bodyHtml === 'string' ? bodyHtml : '';
  if (!html.trim()) return { intro: '', blocks: [] };
  const parsed = new DOMParser().parseFromString('<div id="diet-parse-root">' + html + '</div>', 'text/html');
  const root = parsed.getElementById('diet-parse-root');
  if (!root) return { intro: '', blocks: [] };
  const intro = [];
  const blocks = [];
  let current = null;
  for (const node of [...root.childNodes]) {
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'H3') {
      current = { heading: clean(node.textContent) || 'Untitled', nodes: [] };
      blocks.push(current);
      continue;
    }
    if (node.nodeType === Node.TEXT_NODE && !node.nodeValue.trim()) continue;
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) continue;
    if (current) current.nodes.push(node);
    else if (clean(node.textContent)) intro.push(clean(node.textContent));
  }
  return { intro: intro.join(' '), blocks: blocks.filter((b) => b.nodes.some((n) => clean(n.textContent))) };
}

function ownText(li) {
  let text = '';
  for (const child of li.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) text += child.nodeValue;
    else if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== 'UL' && child.tagName !== 'OL') text += child.textContent;
  }
  return clean(text);
}

function listItems(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const lists = node.tagName === 'UL' || node.tagName === 'OL' ? [node] : [...node.querySelectorAll('ul, ol')];
  const out = [];
  for (const list of lists) for (const li of list.children) if (li.tagName === 'LI') out.push(li);
  return out;
}

/* A paragraph that opens with a bold run: { label, rest }. */
function boldLead(node) {
  if (node.nodeType !== Node.ELEMENT_NODE || node.tagName !== 'P') return null;
  const first = [...node.childNodes].find((c) => c.nodeType !== Node.TEXT_NODE || c.nodeValue.trim());
  if (!first || first.nodeType !== Node.ELEMENT_NODE || !/^(B|STRONG)$/.test(first.tagName)) return null;
  const label = clean(first.textContent);
  const rest = clean(node.textContent.slice(node.textContent.indexOf(first.textContent) + first.textContent.length));
  return { label, rest };
}

function classify(block, catTitle) {
  if (/recipe/i.test(catTitle || '') || block.nodes.some((n) => boldLead(n))) return 'recipe';
  const lis = block.nodes.flatMap(listItems);
  if (!lis.length) return 'note';
  const bolded = lis.filter((li) => li.querySelector('b, strong')).length;
  const words = lis.reduce((sum, li) => sum + ownText(li).split(' ').length, 0) / lis.length;
  if (bolded > 0 || words > 6) return 'combos';
  return 'foods';
}

/* ---- health ---------------------------------------------------------- */

/* A single food takes the level of its longest matching word. A dish
   (combo or recipe) takes the WORST level among its words, matched
   longest first with each match blanked out, so "tuna, mayo, spam" is a
   treat while "dark chocolate" never also counts as "chocolate". */
function defaultLevel(text, dish) {
  let t = String(text || '');
  let worst = -1;
  for (const { word, re } of WORD_PATTERNS) {
    if (!re.test(t)) continue;
    const level = LEVEL_OF_WORD.get(word);
    if (!dish) return level;
    worst = Math.max(worst, LEVELS.indexOf(level));
    t = t.replace(new RegExp(re.source, 'giu'), ' ');
  }
  return worst < 0 ? 'balanced' : LEVELS[worst];
}

function keyOf(text) {
  return clean(text).toLowerCase();
}

function levelOf(item) {
  const o = saved.health[item.key];
  return LEVELS.includes(o) ? o : item.def;
}

function cycle(item) {
  if (!storeRef) return;
  const next = LEVELS[(LEVELS.indexOf(levelOf(item)) + 1) % LEVELS.length];
  if (next === item.def) delete saved.health[item.key];
  else saved.health[item.key] = next;
  persist();
  for (const other of items) if (other.key === item.key) paintLevel(other);
  applyFilters();
}

function paintLevel(item) {
  const level = levelOf(item);
  item.dotHost.setAttribute('data-level', level);
  const over = Object.prototype.hasOwnProperty.call(saved.health, item.key);
  item.dotHost.title = LEVEL_LABEL[level] + (over ? ' (your pick)' : ' (guessed)') + (storeRef ? '. Click to change.' : '');
  item.dotHost.setAttribute('aria-label', item.text + ', ' + LEVEL_LABEL[level] + (storeRef ? '. Click to change.' : ''));
}

function persist() {
  if (!storeRef) return;
  try {
    storeRef.save('board-diet', {
      tags: { ...saved.tags },
      health: { ...saved.health },
      targets: { ...saved.targets },
      today: { ...saved.today },
    });
  } catch (err) {
    console.warn('board diet: save failed', err);
  }
}

/* ---- cards ----------------------------------------------------------- */

function card(title, pill, sub) {
  const section = el('section', 'board-card diet-card');
  const head = el('div', 'board-card-head');
  head.append(el('h3', 'board-card-title', title));
  let pillEl = null;
  if (pill) { pillEl = el('span', 'pill', pill); head.append(pillEl); }
  section.append(head);
  if (sub) section.append(el('p', 'board-card-sub', sub));
  const body = el('div', 'board-card-body');
  section.append(body);
  return { section, body, head, pill: pillEl };
}

function register(item) {
  items.push(item);
  paintLevel(item);
  if (storeRef) {
    item.dotHost.addEventListener('click', (e) => { e.stopPropagation(); cycle(item); });
  }
  return item;
}

function levelDot(className) {
  const b = el(storeRef ? 'button' : 'span', 'diet-dot ' + (className || ''));
  if (storeRef) b.type = 'button';
  return b;
}

/* A row that opens in place: [lead] [button: caret, name, preview, meta]
   and a body below it. Returns the parts; the caller fills the body. */
function openRow(name, opts) {
  const li = el('li', 'board-list-item diet-open' + (opts.className ? ' ' + opts.className : ''));
  const line = el('div', 'board-row');
  if (opts.lead) line.append(opts.lead);
  const head = el('button', 'diet-open-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', 'false');
  head.append(el('span', 'diet-caret'));
  head.append(el('span', 'diet-open-name', name));
  const preview = el('span', 'diet-open-preview', opts.preview || '');
  if (!opts.preview) preview.hidden = true;
  head.append(preview);
  const mix = opts.mix ? el('span', 'diet-mix') : null;
  if (mix) {
    for (const level of LEVELS) { const seg = el('i'); seg.setAttribute('data-level', level); mix.append(seg); }
    mix.setAttribute('aria-hidden', 'true');
    head.append(mix);
  }
  const meta = el('span', 'row-meta', opts.meta || '');
  head.append(meta);
  line.append(head);
  const body = el('div', 'diet-open-body');
  body.hidden = true;
  li.append(line, body);
  const row = { li, head, body, meta, mix, open: false, forced: false, dismissed: false, preview };
  head.addEventListener('click', () => {
    if (row.open || (row.forced && !row.dismissed)) { row.open = false; if (row.forced) row.dismissed = true; }
    else { row.open = true; row.dismissed = false; }
    paintOpen(row);
  });
  return row;
}

/* forced: a filter is narrowing, so every matching group shows its chips
   until it is clicked shut (dismissed). */
function paintOpen(row) {
  const shown = row.open || (row.forced && !row.dismissed);
  row.body.hidden = !shown;
  row.li.classList.toggle('is-open', shown);
  row.head.setAttribute('aria-expanded', shown ? 'true' : 'false');
}

function renderNotes(target, nodes) {
  for (const n of nodes) {
    const text = clean(n.textContent);
    if (text) target.append(el('p', 'diet-note', text));
  }
}

function foodGroupRow(list, block, info) {
  const lis = block.nodes.flatMap(listItems).map(ownText).filter(Boolean);
  const names = lis.map((t) => t.replace(/\s*\(.*\)$/, ''));
  const row = openRow(block.heading, { preview: names.join(', '), meta: String(lis.length), mix: true, className: 'diet-group' });
  const wrap = el('div', 'diet-chips');
  const group = Object.assign(row, { items: [], total: lis.length });
  for (const text of lis) {
    const chip = el(storeRef ? 'button' : 'span', 'diet-food');
    if (storeRef) chip.type = 'button';
    chip.append(el('span', 'diet-dot-mark'));
    const m = text.match(/^(.*?)\s*(\(.*\))$/);
    if (m && m[1]) {
      chip.append(el('span', 'diet-food-name', m[1]));
      chip.append(el('span', 'diet-food-detail', m[2].slice(1, -1)));
    } else {
      chip.append(el('span', 'diet-food-name', text));
    }
    wrap.append(chip);
    group.items.push(register({ key: keyOf(text), text, def: defaultLevel(text), node: chip, dotHost: chip, card: info.card, cat: info.cat, group }));
  }
  row.body.append(wrap);
  renderNotes(row.body, block.nodes.filter((n) => !listItems(n).length));
  groups.push(group);
  list.append(row.li);
}

function noteRow(list, block, info) {
  const words = block.nodes.map((n) => clean(n.textContent)).join(' ');
  const row = openRow(block.heading, { preview: words, meta: 'note', className: 'diet-noterow' });
  renderNotes(row.body, block.nodes);
  list.append(row.li);
  items.push({ plain: true, node: row.li, card: info.card, cat: info.cat, search: block.heading + ' ' + words });
}

function recipeRow(list, block, info) {
  const dot = levelDot();
  const words = [block.heading];
  let uses = 0;
  let macros = '';
  const body = [];
  for (const n of block.nodes) {
    const lead = boldLead(n);
    const lis = listItems(n);
    if (lis.length) {
      const ul = el('ul', 'diet-uses');
      for (const li of lis) {
        const t = ownText(li);
        if (!t) continue;
        ul.append(el('li', '', t));
        words.push(t);
        uses += 1;
      }
      body.push(ul);
    } else if (lead && !lead.rest) {
      body.push(el('p', 'diet-label', lead.label));
    } else if (lead) {
      const p = el('p', 'diet-step');
      p.append(el('strong', '', lead.label + ' '), document.createTextNode(lead.rest));
      body.push(p);
      words.push(lead.rest);
    } else {
      const text = clean(n.textContent);
      if (!text) continue;
      if (/\b\d+\s*(cal|kcal)\b/i.test(text)) { body.push(el('p', 'diet-macros', text)); if (!macros) macros = text; }
      else body.push(el('p', 'diet-step', text));
      words.push(text);
    }
  }
  const kcal = macros.match(/(\d[\d,]*)\s*(?:cal|kcal)\b/i);
  const meta = kcal ? kcal[1] + ' cal' : uses ? uses + (uses === 1 ? ' item' : ' items') : '';
  const row = openRow(block.heading, { lead: dot, meta, className: 'diet-recipe' });
  row.body.append(...body);
  list.append(row.li);
  register({
    key: keyOf(block.heading), text: block.heading, search: words.join(' '),
    def: defaultLevel(block.heading, true), node: row.li, dotHost: dot, card: info.card, cat: info.cat,
  });
}

function comboRows(list, block, info) {
  for (const li of block.nodes.flatMap(listItems)) {
    const text = ownText(li);
    if (!text) continue;
    const row = el('li', 'board-list-item diet-combo');
    const dot = levelDot();
    const body = el('button', 'row-text diet-combo-text');
    body.type = 'button';
    body.setAttribute('aria-expanded', 'false');
    body.title = 'Click to show the whole line';
    const b = li.querySelector('b, strong');
    if (b && clean(b.textContent)) {
      const name = clean(b.textContent);
      body.append(el('strong', '', name));
      const rest = text.slice(text.indexOf(name) + name.length).replace(/^\s*[—–-]\s*/, '');
      if (rest) body.append(el('span', 'diet-combo-rest', rest));
    } else {
      body.textContent = text;
    }
    body.addEventListener('click', () => {
      const open = row.classList.toggle('is-open');
      body.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    row.append(dot, body);
    list.append(row);
    register({ key: keyOf(b ? b.textContent : text), text, def: defaultLevel(text, true), node: row, dotHost: dot, card: info.card, cat: info.cat });
  }
}

function newList(body) {
  const ul = el('ul', 'board-list diet-rows');
  body.append(ul);
  const more = el('button', 'more-btn');
  more.type = 'button';
  more.hidden = true;
  body.append(more);
  const entry = { ul, more, expanded: false };
  more.addEventListener('click', () => { entry.expanded = !entry.expanded; applyFilters(); });
  lists.push(entry);
  return ul;
}

/* One card per notes category; each h3 block inside it becomes rows. */
function renderCategory(s) {
  const c = card(s.title, ' ', s.intro);
  const info = { cat: s.title, card: c.section };
  const kinds = s.blocks.map((block) => classify(block, s.title));
  c.section.setAttribute('data-kind', kinds.every((k) => k === kinds[0]) ? kinds[0] : 'mixed');
  let list = null;
  s.blocks.forEach((block, i) => {
    const kind = kinds[i];
    if (kind === 'combos') {
      const single = s.blocks.length === 1 && block.heading === s.title;
      if (!single) c.body.append(el('p', 'diet-sub-label', block.heading));
      comboRows(newList(c.body), block, info);
      list = null;
      return;
    }
    if (!list) list = newList(c.body);
    if (kind === 'foods') foodGroupRow(list, block, info);
    else if (kind === 'recipe') recipeRow(list, block, info);
    else noteRow(list, block, info);
  });
  /* The head pill counts what the card holds. */
  const mine = items.filter((it) => it.card === c.section);
  const n = (k) => kinds.filter((x) => x === k).length;
  const foods = mine.filter((it) => it.group).length;
  const combos = mine.filter((it) => !it.plain && !it.group && it.node.classList.contains('diet-combo')).length;
  const parts = [];
  if (n('recipe')) parts.push(n('recipe') + (n('recipe') === 1 ? ' recipe' : ' recipes'));
  if (combos) parts.push(combos + (combos === 1 ? ' combo' : ' combos'));
  if (foods) parts.push(foods + (foods === 1 ? ' food' : ' foods'));
  if (!parts.length && n('note')) parts.push(n('note') + (n('note') === 1 ? ' note' : ' notes'));
  c.pill.textContent = parts.join(' · ') || 'Empty';
  return c.section;
}

/* ---- daily targets --------------------------------------------------- */

function renderTargets() {
  if (saved.today.date !== todayStamp()) saved.today = { date: todayStamp() };
  const c = card('Daily targets', 'Today');
  c.section.classList.add('diet-targets');
  const rows = [];
  const paint = () => {
    let set = 0;
    let met = 0;
    for (const r of rows) {
      /* No made-up default: until Dex types a target it says so. */
      const target = Number(saved.targets[r.t.key]) || 0;
      const now = Number(saved.today[r.t.key]) || 0;
      r.value.textContent = target ? now + ' / ' + target + ' ' + r.t.unit : now + ' ' + r.t.unit + ', set your target';
      r.value.classList.toggle('is-unset', !target);
      const pct = target ? Math.max(0, Math.min(100, Math.round((now / target) * 100))) : 0;
      r.fill.style.width = pct + '%';
      r.bar.classList.toggle('is-done', !!target && now >= target);
      if (target) { set += 1; if (now >= target) met += 1; }
      if (document.activeElement !== r.now) r.now.value = String(now);
      if (document.activeElement !== r.target) r.target.value = target ? String(target) : '';
    }
    c.pill.textContent = set ? met + ' of ' + set + ' met' : 'Today';
    c.pill.classList.toggle('good', !!set && met === set);
  };
  for (const t of TARGETS) {
    const block = el('div', 'diet-target');
    const line = el('div', 'stat-row');
    const value = el('span', 'stat-value');
    line.append(el('span', 'stat-label', t.label), value);
    const bar = el('div', 'bar');
    const fill = el('i');
    bar.append(fill);
    const controls = el('div', 'diet-target-controls');
    const mk = (label, aria) => {
      const wrap = el('label', 'diet-field');
      wrap.append(el('span', 'diet-field-label', label));
      const input = el('input', 'board-input');
      input.type = 'number';
      input.min = '0';
      input.step = String(t.step);
      input.inputMode = 'numeric';
      input.setAttribute('aria-label', aria);
      wrap.append(input);
      controls.append(wrap);
      return input;
    };
    const now = mk('Today', t.label + ' today');
    controls.append(el('span', 'diet-of', '/'));
    const target = mk('Target', t.label + ' target');
    target.placeholder = 'Target';
    now.title = 'Today';
    target.title = 'Target';
    now.addEventListener('input', () => { saved.today[t.key] = Math.max(0, Number(now.value) || 0); persist(); paint(); });
    target.addEventListener('input', () => {
      const v = Number(target.value);
      if (v > 0) saved.targets[t.key] = v; else delete saved.targets[t.key];
      persist(); paint();
    });
    for (const q of t.quick) {
      const b = el('button', 'board-btn is-small', '+' + q);
      b.type = 'button';
      b.setAttribute('aria-label', 'Add ' + q + ' ' + (q === 1 && t.unit === 'cups' ? 'cup' : t.unit) + ' of ' + t.label.toLowerCase());
      b.addEventListener('click', () => { saved.today[t.key] = (Number(saved.today[t.key]) || 0) + q; persist(); paint(); });
      controls.append(b);
    }
    block.append(line, bar, controls);
    c.body.append(block);
    rows.push({ t, value, bar, fill, now, target });
  }
  const reset = el('button', 'board-btn is-small diet-reset', 'Reset today');
  reset.type = 'button';
  reset.addEventListener('click', () => { saved.today = { date: todayStamp() }; persist(); paint(); });
  c.body.append(reset);
  if (!storeRef) for (const n of c.body.querySelectorAll('input, button')) n.disabled = true;
  paint();
  return c.section;
}

/* ---- filters --------------------------------------------------------- */

function renderFilterBar(source, catTitles) {
  const c = card('Find', ' ', 'From ' + source.title + ' in Notes');
  c.section.classList.add('diet-filters');
  const row = el('div', 'diet-filter-row');

  const search = el('input', 'board-input diet-search');
  search.type = 'search';
  search.placeholder = 'Search foods and recipes';
  search.setAttribute('aria-label', 'Search foods and recipes');
  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); applyFilters(); });

  const health = el('div', 'chip-row');
  health.setAttribute('role', 'group');
  health.setAttribute('aria-label', 'Filter by how healthy');
  const healthButtons = [];
  for (const level of ['all', ...LEVELS]) {
    const b = el('button', 'chip');
    b.type = 'button';
    if (level !== 'all') {
      const dot = el('span', 'dot');
      dot.setAttribute('data-level', level);
      b.append(dot);
    }
    const label = el('span', '', level === 'all' ? 'All' : LEVEL_LABEL[level]);
    const count = el('span', 'diet-count');
    b.append(label, count);
    b.addEventListener('click', () => { healthFilter = level; applyFilters(); });
    health.append(b);
    healthButtons.push({ level, b, count });
  }

  const cats = el('div', 'chip-row');
  cats.setAttribute('role', 'group');
  cats.setAttribute('aria-label', 'Filter by notes category');
  const catButtons = [];
  for (const name of ['all', ...catTitles]) {
    const b = el('button', 'chip', name === 'all' ? 'Every category' : name);
    b.type = 'button';
    b.addEventListener('click', () => { catFilter = name; applyFilters(); });
    cats.append(b);
    catButtons.push({ name, b });
  }

  row.append(search, health, cats);
  c.body.append(row);
  const status = el('p', 'diet-status');
  c.body.append(status);
  c.body.append(el('p', 'diet-hint', storeRef
    ? 'Read only; edit foods in the Notes tab. Dots are guessed: click a food or a dot to change it.'
    : 'Read only; edit foods in the Notes tab. Dots are guessed.'));
  filterUi = { healthButtons, catButtons, status, search, pill: c.pill };
  return c.section;
}

function applyFilters() {
  if (!gridEl || !filterUi) return;
  const counts = { all: 0, clean: 0, balanced: 0, treat: 0 };
  const visibleByCard = new Map();
  let shownFoods = 0;
  const narrowing = healthFilter !== 'all' || !!query;
  for (const item of items) {
    if (!visibleByCard.has(item.card)) visibleByCard.set(item.card, 0);
    const catOk = catFilter === 'all' || item.cat === catFilter;
    const text = (item.search || item.text || '').toLowerCase();
    const queryOk = !query || text.includes(query);
    if (item.plain) {
      const show = catOk && queryOk && healthFilter === 'all';
      item.node.hidden = !show;
      if (show) visibleByCard.set(item.card, visibleByCard.get(item.card) + 1);
      continue;
    }
    const level = levelOf(item);
    if (catOk && queryOk) { counts.all += 1; counts[level] += 1; }
    const show = catOk && queryOk && (healthFilter === 'all' || level === healthFilter);
    item.node.hidden = !show;
    item.shown = show;
    if (show) { visibleByCard.set(item.card, visibleByCard.get(item.card) + 1); shownFoods += 1; }
  }
  /* Food groups: the count, the health mix, and open while a filter narrows. */
  for (const g of groups) {
    const shown = g.items.filter((it) => it.shown).length;
    g.li.hidden = shown === 0;
    g.meta.textContent = narrowing && shown !== g.total ? shown + ' of ' + g.total : String(g.total);
    const mix = { clean: 0, balanced: 0, treat: 0 };
    for (const it of g.items) mix[levelOf(it)] += 1;
    [...g.mix.children].forEach((seg) => { seg.style.flexGrow = String(mix[seg.getAttribute('data-level')]); });
    g.mix.title = mix.clean + ' clean, ' + mix.balanced + ' balanced, ' + mix.treat + ' treat';
    g.forced = narrowing;
    if (!narrowing) g.dismissed = false;
    paintOpen(g);
  }
  for (const [cardEl, n] of visibleByCard) cardEl.hidden = n === 0;
  /* Long lists clamp unless a filter is narrowing them or Show all was pressed. */
  for (const entry of lists) {
    const rows = [...entry.ul.children].filter((li) => !li.hidden);
    const clamp = !narrowing && rows.length > CLAMP_AT && !entry.expanded;
    [...entry.ul.children].forEach((li) => li.classList.remove('is-clamped-out'));
    if (clamp) rows.slice(CLAMP_TO).forEach((li) => li.classList.add('is-clamped-out'));
    entry.more.hidden = narrowing || rows.length <= CLAMP_AT;
    entry.more.textContent = entry.expanded ? 'Show fewer' : 'Show all (' + rows.length + ')';
  }
  for (const { level, b, count } of filterUi.healthButtons) {
    b.setAttribute('aria-pressed', level === healthFilter ? 'true' : 'false');
    count.textContent = String(counts[level]);
  }
  for (const { name, b } of filterUi.catButtons) b.setAttribute('aria-pressed', name === catFilter ? 'true' : 'false');
  const filtered = healthFilter !== 'all' || catFilter !== 'all' || query;
  filterUi.status.textContent = !filtered ? ''
    : shownFoods ? shownFoods + ' showing.' : 'Nothing matches these filters.';
  filterUi.status.hidden = !filtered;
  filterUi.pill.textContent = filtered ? shownFoods + ' showing' : counts.all + ' items';
  filterUi.pill.classList.toggle('hot', !!filtered);
}

/* ---- render ---------------------------------------------------------- */

function renderEmptyState(container) {
  const grid = el('div', 'board-grid diet-grid');
  const c = card('Diet', 'Not found');
  c.body.append(el('p', 'board-empty', 'No diet section was found in the notes document. This tab fills in when a session or category with Diet, Food, Recipe, Meal or Nutrition in its title exists.'));
  grid.append(c.section, renderTargets());
  container.replaceChildren(grid);
  gridEl = grid;
}

function renderDiet(container, source, sections) {
  items = []; groups = []; lists = [];
  const grid = el('div', 'board-grid diet-grid');
  const catTitles = sections.map((s) => s.title);
  grid.append(renderTargets());
  grid.append(renderFilterBar(source, catTitles));
  let any = false;
  for (const s of sections) {
    if (!s.blocks.length) continue;
    grid.append(renderCategory(s));
    any = true;
  }
  if (!any) {
    const c = card('Diet', 'Empty');
    c.body.append(el('p', 'board-empty', 'The diet section "' + source.title + '" has no headed blocks yet.'));
    grid.append(c.section);
  }
  container.replaceChildren(grid);
  gridEl = grid;
  applyFilters();
}

export async function mount(container, ctx) {
  const gen = ++generation;
  host = container;
  storeRef = ctx && ctx.store ? ctx.store : null;
  saved = { tags: {}, health: {}, targets: {}, today: {} };
  gridEl = null; filterUi = null; items = []; groups = []; lists = [];
  healthFilter = 'all'; catFilter = 'all'; query = '';

  showLine(container, 'Loading diet notes...');

  const user = ctx && ctx.user;
  if (!user) { showLine(container, 'Diet notes are not available.'); return; }

  let backend = null;
  try {
    backend = await createNotesBackend(user);
  } catch (err) {
    console.warn('board diet: the notes store could not be opened', err);
    if (gen === generation && host === container) showLine(container, 'Your diet notes could not be opened.');
    return;
  }
  if (gen !== generation || host !== container) return;

  let doc = backend.getDocument();
  if (!doc && typeof backend.load === 'function') {
    try { await backend.load(); doc = backend.getDocument(); } catch (err) {
      console.warn('board diet: the notes document could not be loaded', err);
    }
    if (gen !== generation || host !== container) return;
  }
  if (!doc) { showLine(container, 'Your diet notes could not be opened.'); return; }

  if (storeRef) {
    try {
      const s = await storeRef.load('board-diet');
      if (s && typeof s === 'object') {
        const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? { ...v } : {});
        saved = { tags: obj(s.tags), health: obj(s.health), targets: obj(s.targets), today: obj(s.today) };
      }
    } catch (err) {
      console.warn('board diet: the saved diet doc could not be loaded', err);
    }
    if (gen !== generation || host !== container) return;
  }

  const source = findDietSource(doc);
  if (!source) { renderEmptyState(container); return; }

  const sections = [];
  if (source.kind === 'session') {
    for (const cat of Array.isArray(source.session.cats) ? source.session.cats : []) {
      if (!cat) continue;
      const title = clean(cat.title) || 'Foods';
      const { intro, blocks } = splitBody(cat.body);
      sections.push({ title, intro, blocks });
    }
  } else {
    const title = clean(source.cat.title) || 'Foods';
    const { intro, blocks } = splitBody(source.cat.body);
    sections.push({ title, intro, blocks: blocks.length || !intro ? blocks : [] });
  }
  /* A category with text but no h3 still shows, as one block under its own title. */
  for (const s of sections) {
    if (!s.blocks.length) {
      const html = source.kind === 'session'
        ? (source.session.cats.find((c) => c && clean(c.title) === s.title) || {}).body
        : source.cat.body;
      const parsed = new DOMParser().parseFromString('<div>' + (html || '') + '</div>', 'text/html').body.firstChild;
      const nodes = parsed ? [...parsed.childNodes].filter((n) => clean(n.textContent)) : [];
      if (nodes.length) { s.blocks = [{ heading: s.title, nodes }]; s.intro = ''; }
    }
  }

  renderDiet(container, source, sections);
}

export function unmount() {
  generation += 1;
  if (host) host.replaceChildren();
  host = null;
  storeRef = null;
  saved = { tags: {}, health: {}, targets: {}, today: {} };
  gridEl = null; filterUi = null; items = []; groups = []; lists = [];
}
