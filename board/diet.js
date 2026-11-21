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
 * Inside a category body each h3 starts a block. Content before the first
 * h3 is the category's intro line and sits under the first block's title.
 * Each block becomes one card, of one of four kinds, decided by its shape:
 *   recipe  a block with bold-labelled paragraphs (Uses, Make it, Swap) or
 *           any block in a category whose title says recipe
 *   combos  a list whose items are bold-named or long (assemble-and-eat)
 *   foods   a list of short items, drawn as chips
 *   note    paragraphs only (Leavening rules)
 * Every food, combo and recipe is rendered from text only (textContent),
 * never by cloning the notes HTML into the page.
 *
 * Healthiness: the notes carry no health data, so every food, combo and
 * recipe gets a DEFAULT level from HEALTH_WORDS below (generic food words,
 * longest match wins, unknown = balanced). Clicking a food chip, or the dot
 * on a combo or recipe, cycles clean -> balanced -> treat. Overrides live
 * in the board-diet store doc as health: { "<lowercased text>": level };
 * cycling back to the default deletes the override. The filter bar narrows
 * by level, by category and by a text search; a card left with nothing
 * visible is hidden.
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
  { key: 'calories', label: 'Calories', unit: 'kcal', step: 100, quick: [100, 250], def: 2000 },
  { key: 'protein', label: 'Protein', unit: 'g', step: 5, quick: [10, 25], def: 150 },
  { key: 'water', label: 'Water', unit: 'cups', step: 1, quick: [1], def: 8 },
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
let items = [];        /* every filterable thing: { key, text, level el, card } */

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
  if (pill) head.append(el('span', 'pill', pill));
  section.append(head);
  if (sub) section.append(el('p', 'board-card-sub', sub));
  const body = el('div', 'board-card-body');
  section.append(body);
  return { section, body };
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

function renderFoods(c, block, ctxInfo) {
  const wrap = el('div', 'diet-chips');
  for (const li of block.nodes.flatMap(listItems)) {
    const text = ownText(li);
    if (!text) continue;
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
    register({ key: keyOf(text), text, def: defaultLevel(text), node: chip, dotHost: chip, card: c.section, cat: ctxInfo.cat });
  }
  c.body.append(wrap);
  renderNotes(c, block.nodes.filter((n) => !listItems(n).length));
}

function renderNotes(c, nodes) {
  for (const n of nodes) {
    const text = clean(n.textContent);
    if (text) c.body.append(el('p', 'diet-note', text));
  }
}

function renderCombos(c, block, ctxInfo) {
  const list = el('ul', 'board-list diet-combos');
  for (const li of block.nodes.flatMap(listItems)) {
    const text = ownText(li);
    if (!text) continue;
    const row = el('li', 'board-list-item diet-combo');
    const dot = levelDot();
    const body = el('span', 'row-text');
    const b = li.querySelector('b, strong');
    if (b && clean(b.textContent)) {
      const name = clean(b.textContent);
      body.append(el('strong', '', name));
      const rest = text.slice(text.indexOf(name) + name.length).replace(/^\s*[—–-]\s*/, '');
      if (rest) body.append(el('span', 'diet-combo-rest', rest));
    } else {
      body.textContent = text;
    }
    row.append(dot, body);
    list.append(row);
    register({ key: keyOf(b ? b.textContent : text), text, def: defaultLevel(text, true), node: row, dotHost: dot, card: c.section, cat: ctxInfo.cat });
  }
  c.body.append(list);
  renderNotes(c, block.nodes.filter((n) => !listItems(n).length));
}

function renderRecipe(c, block, ctxInfo) {
  const dot = levelDot('diet-dot-head');
  c.section.querySelector('.board-card-head').prepend(dot);
  const words = [block.heading];
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
      }
      c.body.append(ul);
    } else if (lead && !lead.rest) {
      c.body.append(el('p', 'diet-label', lead.label));
    } else if (lead) {
      const p = el('p', 'diet-step');
      p.append(el('strong', '', lead.label + ' '), document.createTextNode(lead.rest));
      c.body.append(p);
      words.push(lead.rest);
    } else {
      const text = clean(n.textContent);
      if (!text) continue;
      if (/\b\d+\s*(cal|kcal)\b/i.test(text)) c.body.append(el('p', 'diet-macros', text));
      else c.body.append(el('p', 'diet-step', text));
      words.push(text);
    }
  }
  register({
    key: keyOf(block.heading), text: block.heading, search: words.join(' '),
    def: defaultLevel(block.heading, true), node: c.section, dotHost: dot, card: c.section, cat: ctxInfo.cat, whole: true,
  });
}

function renderNoteCard(c, block, ctxInfo) {
  renderNotes(c, block.nodes);
  c.section.setAttribute('data-plain', '1');
  items.push({ plain: true, card: c.section, cat: ctxInfo.cat, search: block.heading + ' ' + block.nodes.map((n) => n.textContent).join(' ') });
}

/* ---- daily targets --------------------------------------------------- */

function renderTargets() {
  if (saved.today.date !== todayStamp()) saved.today = { date: todayStamp() };
  const c = card('Daily targets', 'Today');
  c.section.classList.add('diet-targets');
  const rows = [];
  const paint = () => {
    for (const r of rows) {
      const target = Number(saved.targets[r.t.key]) || r.t.def;
      const now = Number(saved.today[r.t.key]) || 0;
      r.value.textContent = now + ' / ' + target + ' ' + r.t.unit;
      const pct = Math.max(0, Math.min(100, Math.round((now / target) * 100)));
      r.fill.style.width = pct + '%';
      r.bar.classList.toggle('is-done', now >= target);
      if (document.activeElement !== r.now) r.now.value = String(now);
      if (document.activeElement !== r.target) r.target.value = String(target);
    }
  };
  for (const t of TARGETS) {
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
    const target = mk('Target', t.label + ' target');
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
    c.body.append(line, bar, controls);
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
  const c = card('Foods', 'From ' + source.title);
  c.section.setAttribute('data-span', 'full');
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
    ? 'Read only from the notes, edit foods in the Notes tab. Dots are guessed; click a food (or a dot) to change its level.'
    : 'Read only from the notes, edit foods in the Notes tab. Dots are guessed.'));
  filterUi = { healthButtons, catButtons, status, search };
  return c.section;
}

function applyFilters() {
  if (!gridEl || !filterUi) return;
  const counts = { all: 0, clean: 0, balanced: 0, treat: 0 };
  const visibleByCard = new Map();
  let shownFoods = 0;
  for (const item of items) {
    if (!visibleByCard.has(item.card)) visibleByCard.set(item.card, 0);
    const catOk = catFilter === 'all' || item.cat === catFilter;
    const text = (item.search || item.text || '').toLowerCase();
    const queryOk = !query || text.includes(query);
    if (item.plain) {
      const show = catOk && queryOk && healthFilter === 'all';
      if (show) visibleByCard.set(item.card, 1);
      continue;
    }
    const level = levelOf(item);
    if (catOk && queryOk) { counts.all += 1; counts[level] += 1; }
    const show = catOk && queryOk && (healthFilter === 'all' || level === healthFilter);
    if (!item.whole) item.node.hidden = !show;
    if (show) { visibleByCard.set(item.card, visibleByCard.get(item.card) + 1); shownFoods += 1; }
  }
  for (const [cardEl, n] of visibleByCard) cardEl.hidden = n === 0;
  for (const { level, b, count } of filterUi.healthButtons) {
    b.setAttribute('aria-pressed', level === healthFilter ? 'true' : 'false');
    count.textContent = String(counts[level]);
  }
  for (const { name, b } of filterUi.catButtons) b.setAttribute('aria-pressed', name === catFilter ? 'true' : 'false');
  const filtered = healthFilter !== 'all' || catFilter !== 'all' || query;
  filterUi.status.textContent = !filtered ? ''
    : shownFoods ? shownFoods + ' showing.' : 'Nothing matches these filters.';
  filterUi.status.hidden = !filtered;
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
  items = [];
  const grid = el('div', 'board-grid diet-grid');
  const catTitles = sections.map((s) => s.title);
  grid.append(renderFilterBar(source, catTitles));
  grid.append(renderTargets());
  let any = false;
  for (const s of sections) {
    s.blocks.forEach((block, i) => {
      const kind = classify(block, s.title);
      const c = card(block.heading, s.title, i === 0 && s.intro ? s.intro : '');
      c.section.setAttribute('data-kind', kind);
      const info = { cat: s.title };
      if (kind === 'foods') renderFoods(c, block, info);
      else if (kind === 'combos') renderCombos(c, block, info);
      else if (kind === 'recipe') renderRecipe(c, block, info);
      else renderNoteCard(c, block, info);
      grid.append(c.section);
      any = true;
    });
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
  gridEl = null; filterUi = null; items = [];
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
  gridEl = null; filterUi = null; items = [];
}
