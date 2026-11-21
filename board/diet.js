/* The Dex Board Diet tab: Dex diet notes, read live at runtime.
 *
 * The diet content canonically lives in the private notes document, the
 * same document the Notes tab edits. This tab builds the shared owner
 * backend from board/notes-backend.js, reads the parsed document through
 * getDocument(), and finds the diet section by title search. It never
 * ships food content of its own: if no section matches, it shows an
 * honest empty state, and the mockup sample numbers never appear here.
 *
 * Search order: the terms diet, food, recipe, meal, and nutrition, in
 * that order. For each term, session titles are checked first in
 * document order, then category titles across every session in document
 * order. Matching is case insensitive and looks for the term inside the
 * title. A matching session contributes all of its live categories. A
 * matching category is used on its own. Archived categories are not
 * searched, because the backend document keeps them outside cats.
 *
 * Inside a category body, each h3 heading starts a new block. Content
 * before the first heading becomes a General foods block for a single
 * matched category, and a block titled with the category title when a
 * whole session matched. Blocks whose heading mentions recipe are
 * grouped into one Recipes card. Every other block becomes its own
 * card under its heading, with blocks that share a heading merged into
 * one card. Lists stay lists and tables stay tables, because the body
 * nodes are cloned into the cards as they are.
 *
 * The content is read only here. Editing happens in the Notes tab,
 * where the content canonically lives, and the tab says so in one
 * small line under the source title.
 *
 * Filters: one chip per card group, derived from the block headings
 * themselves, plus an All chip. There are no health scores and no per
 * food ratings, because no such data exists in the notes. Board owned
 * per food tags live in the board-diet Firestore doc as
 * { tags: { "<food text>": "<group name>" } }. Clicking a food cycles
 * its tag through the card groups. A tag changes which filter shows
 * the food, and clearing the tag returns the food to its own block.
 * Tags are the only thing this tab writes, and they go through
 * ctx.store, never into the notes document.
 *
 * Shell interface: board/board.js dynamically imports this module and
 * calls mount(container, ctx), awaiting the promise it returns, and
 * calls unmount() on sign out. ctx provides
 * { user, uid, store, dnd, boardApi }. This tab uses ctx.user for the
 * unlock exchange and ctx.store for the tag doc.
 */

import { createNotesBackend } from './notes-backend.js';

const SEARCH_TERMS = ['diet', 'food', 'recipe', 'meal', 'nutrition'];

let host = null;
let generation = 0;
let storeRef = null;
let tags = {};
let filterGroups = [];
let activeFilter = 'All';
let gridEl = null;
let filterButtons = [];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showLine(container, text) {
  const card = el('div', 'board-loading-card', text);
  container.replaceChildren(card);
}

function titleHas(title, term) {
  return typeof title === 'string' && title.toLowerCase().includes(term);
}

function isRecipeHeading(heading) {
  return typeof heading === 'string' && heading.toLowerCase().includes('recipe');
}

/* Find the diet section. Returns one of:
   { kind: 'session', title, session }
   { kind: 'category', title, cat }
   or null when nothing matches. */
function findDietSource(doc) {
  const sessions = doc && Array.isArray(doc.sessions) ? doc.sessions : [];
  for (const term of SEARCH_TERMS) {
    for (const session of sessions) {
      if (session && titleHas(session.title, term)) {
        return { kind: 'session', title: session.title, session };
      }
    }
    for (const session of sessions) {
      const cats = session && Array.isArray(session.cats) ? session.cats : [];
      for (const cat of cats) {
        if (cat && titleHas(cat.title, term)) {
          return { kind: 'category', title: cat.title, cat };
        }
      }
    }
  }
  return null;
}

/* Split one category body into blocks on its h3 headings. The body is
   schema HTML from the notes document, parsed with DOMParser and then
   imported into this document, so lists, tables, paragraphs, and chips
   keep their shape. fallbackHeading names the block that holds any
   content sitting before the first heading. Empty blocks are dropped. */
function parseBodyBlocks(bodyHtml, fallbackHeading) {
  const html = typeof bodyHtml === 'string' ? bodyHtml : '';
  if (!html.trim()) return [];
  const parsed = new DOMParser().parseFromString(
    '<div id="diet-parse-root">' + html + '</div>',
    'text/html',
  );
  const root = parsed.getElementById('diet-parse-root');
  if (!root) return [];
  const blocks = [];
  let current = { heading: null, nodes: [] };
  for (const node of [...root.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.nodeValue.trim()) continue;
      const p = document.createElement('p');
      p.textContent = node.nodeValue.trim();
      current.nodes.push(p);
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    if (node.tagName === 'H3') {
      blocks.push(current);
      const heading = (node.textContent || '').trim() || 'Untitled';
      current = { heading, nodes: [] };
      continue;
    }
    current.nodes.push(document.importNode(node, true));
  }
  blocks.push(current);
  const titled = [];
  for (const block of blocks) {
    const hasContent = block.nodes.some((n) => {
      if (n.querySelector && n.querySelector('table, img, hr')) return true;
      return (n.textContent || '').trim().length > 0;
    });
    if (!hasContent) continue;
    titled.push({ heading: block.heading || fallbackHeading, nodes: block.nodes });
  }
  return titled;
}

/* Turn the flat block list into cards. Recipe blocks group into one
   Recipes card. Other blocks group by heading, so two blocks with the
   same heading share one card. Card order follows first appearance in
   the document, with the Recipes card sitting where the first recipe
   block appeared. */
function buildCards(blocks) {
  const cards = [];
  const byKey = new Map();
  for (const block of blocks) {
    const recipe = isRecipeHeading(block.heading);
    const group = recipe ? 'Recipes' : block.heading;
    const key = group.toLowerCase();
    let card = byKey.get(key);
    if (!card) {
      card = { title: group, group, blocks: [] };
      byKey.set(key, card);
      cards.push(card);
    }
    card.blocks.push(block);
  }
  return cards;
}

/* The text that names a food: the list item own text, without any
   nested list inside it and without a tag badge this tab added. */
function ownText(li) {
  let text = '';
  for (const child of li.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.nodeValue;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      if (child.tagName === 'UL' || child.tagName === 'OL') continue;
      if (child.hasAttribute('data-diet-tag')) continue;
      text += child.textContent;
    }
  }
  return text.trim().replace(/\s+/g, ' ');
}

function paintTag(li) {
  for (const child of [...li.children]) {
    if (child.hasAttribute('data-diet-tag')) child.remove();
  }
  const food = li.getAttribute('data-food');
  const own = li.getAttribute('data-own-group') || '';
  const tag = food ? tags[food] : null;
  li.setAttribute('data-effective-group', tag || own);
  if (tag && tag !== own) {
    const badge = document.createElement('span');
    badge.setAttribute('data-diet-tag', '1');
    badge.textContent = ' (' + tag + ')';
    const nested = [...li.children].find((c) => c.tagName === 'UL' || c.tagName === 'OL');
    if (nested) li.insertBefore(badge, nested);
    else li.append(badge);
  }
  if (storeRef) {
    li.title = tag
      ? 'Tag: ' + tag + '. Click to change the tag.'
      : 'Click to add a tag.';
  }
}

function persistTags() {
  if (!storeRef) return;
  try {
    storeRef.save('board-diet', { tags: { ...tags } });
  } catch (err) {
    console.warn('board diet: tag save failed', err);
  }
}

function cycleTag(li) {
  const food = li.getAttribute('data-food');
  if (!food) return;
  const own = li.getAttribute('data-own-group') || '';
  const options = [null, ...filterGroups.filter((group) => group !== own)];
  const current = Object.prototype.hasOwnProperty.call(tags, food) ? tags[food] : null;
  let index = options.indexOf(current);
  if (index < 0) index = -1;
  const next = options[(index + 1) % options.length];
  if (next === null) delete tags[food];
  else tags[food] = next;
  persistTags();
  paintTag(li);
  applyFilter();
}

/* Give every list item in the grid its food name and its own group, so
   filtering and tagging can work per item. Items with no text of their
   own still take part in filtering through their card group. */
function enhanceItems() {
  if (!gridEl) return;
  for (const li of gridEl.querySelectorAll('li')) {
    const card = li.closest('.board-card');
    if (!card) continue;
    const own = card.getAttribute('data-group') || '';
    li.setAttribute('data-own-group', own);
    const food = ownText(li);
    if (food) li.setAttribute('data-food', food);
    paintTag(li);
    if (storeRef && food) {
      li.style.cursor = 'pointer';
      li.addEventListener('click', (event) => {
        if (event.target && typeof event.target.closest === 'function'
          && event.target.closest('a, button')) return;
        cycleTag(li);
      });
    }
  }
}

function applyFilter() {
  if (!gridEl) return;
  const wanted = activeFilter.toLowerCase();
  for (const card of gridEl.querySelectorAll('.board-card')) {
    const group = card.getAttribute('data-group') || '';
    const items = card.querySelectorAll('li');
    if (!items.length) {
      const show = activeFilter === 'All' || group.toLowerCase() === wanted;
      card.style.display = show ? '' : 'none';
      continue;
    }
    let visible = 0;
    for (const li of items) {
      const effective = li.getAttribute('data-effective-group') || group;
      const show = activeFilter === 'All' || effective.toLowerCase() === wanted;
      li.style.display = show ? '' : 'none';
      if (show) visible += 1;
    }
    card.style.display = activeFilter === 'All' || visible > 0 ? '' : 'none';
  }
}

function paintFilterChips() {
  for (const entry of filterButtons) {
    const isActive = entry.name === activeFilter;
    entry.button.classList.toggle('board-btn-primary', isActive);
    entry.button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  }
}

function renderFilters() {
  const row = el('div', 'board-row board-row-wrap');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Filter foods by group');
  filterButtons = [];
  for (const name of ['All', ...filterGroups]) {
    const button = el('button', 'board-btn', name);
    button.type = 'button';
    button.addEventListener('click', () => {
      activeFilter = name;
      paintFilterChips();
      applyFilter();
    });
    filterButtons.push({ name, button });
    row.append(button);
  }
  paintFilterChips();
  return row;
}

function renderCard(card) {
  const section = el('section', 'board-card');
  section.setAttribute('data-group', card.group);
  const head = el('div', 'board-card-head');
  head.append(el('h3', 'board-card-title', card.title));
  const body = el('div', 'board-card-body');
  for (const block of card.blocks) {
    if (card.group === 'Recipes' && block.heading.trim().toLowerCase() !== 'recipes') {
      const sub = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = block.heading;
      sub.append(strong);
      body.append(sub);
    }
    for (const node of block.nodes) body.append(node);
  }
  section.append(head, body);
  return section;
}

function renderEmptyState(container) {
  const wrap = el('div');
  const grid = el('div', 'board-grid-dense');
  const line = el(
    'p',
    'board-empty',
    'The diet notes were not found in the notes document. This tab will fill in when a category named Diet exists.',
  );
  wrap.append(grid, line);
  container.replaceChildren(wrap);
}

function renderDiet(container, source, blocks) {
  const cards = buildCards(blocks);
  filterGroups = cards.map((card) => card.group);
  activeFilter = 'All';

  const wrap = el('div');
  const sourceLine = el('p', 'board-card-title', 'Diet source: ' + source.title);
  const noteLine = el(
    'p',
    'board-card-sub',
    'Diet content is read only here. Edit it in the Notes tab, where it lives.',
  );
  wrap.append(sourceLine, noteLine);

  if (storeRef) {
    const hint = el(
      'p',
      'board-card-sub',
      'Click a food to cycle its tag. A tag changes which filter shows the food.',
    );
    wrap.append(hint);
  }

  if (!cards.length) {
    const grid = el('div', 'board-grid-dense');
    const line = el('p', 'board-empty', 'The matched diet section is empty.');
    wrap.append(grid, line);
    container.replaceChildren(wrap);
    gridEl = grid;
    return;
  }

  wrap.append(renderFilters());
  const grid = el('div', 'board-grid-dense');
  for (const card of cards) grid.append(renderCard(card));
  wrap.append(grid);
  container.replaceChildren(wrap);
  gridEl = grid;
  enhanceItems();
  applyFilter();
}

export async function mount(container, ctx) {
  const gen = ++generation;
  host = container;
  storeRef = ctx && ctx.store ? ctx.store : null;
  tags = {};
  filterGroups = [];
  activeFilter = 'All';
  gridEl = null;
  filterButtons = [];

  showLine(container, 'Loading diet notes...');

  const user = ctx && ctx.user;
  if (!user) {
    showLine(container, 'Diet notes are not available.');
    return;
  }

  let backend = null;
  try {
    backend = await createNotesBackend(user);
  } catch (err) {
    console.warn('board diet: the notes store could not be opened', err);
    if (gen === generation && host === container) {
      showLine(container, 'Your diet notes could not be opened.');
    }
    return;
  }
  if (gen !== generation || host !== container) return;

  let doc = backend.getDocument();
  if (!doc && typeof backend.load === 'function') {
    try {
      await backend.load();
      doc = backend.getDocument();
    } catch (err) {
      console.warn('board diet: the notes document could not be loaded', err);
    }
    if (gen !== generation || host !== container) return;
  }
  if (!doc) {
    showLine(container, 'Your diet notes could not be opened.');
    return;
  }

  if (storeRef) {
    try {
      const saved = await storeRef.load('board-diet');
      if (saved && typeof saved === 'object' && saved.tags && typeof saved.tags === 'object') {
        tags = { ...saved.tags };
      }
    } catch (err) {
      console.warn('board diet: saved tags could not be loaded', err);
      tags = {};
    }
    if (gen !== generation || host !== container) return;
  }

  const source = findDietSource(doc);
  if (!source) {
    renderEmptyState(container);
    return;
  }

  let blocks = [];
  if (source.kind === 'session') {
    const cats = Array.isArray(source.session.cats) ? source.session.cats : [];
    for (const cat of cats) {
      if (!cat) continue;
      const fallback = typeof cat.title === 'string' && cat.title.trim()
        ? cat.title.trim()
        : 'General foods';
      blocks.push(...parseBodyBlocks(cat.body, fallback));
    }
  } else {
    const fallback = isRecipeHeading(source.cat.title) ? 'Recipes' : 'General foods';
    blocks = parseBodyBlocks(source.cat.body, fallback);
  }

  renderDiet(container, source, blocks);
}

export function unmount() {
  generation += 1;
  if (host) host.replaceChildren();
  host = null;
  storeRef = null;
  tags = {};
  filterGroups = [];
  activeFilter = 'All';
  gridEl = null;
  filterButtons = [];
}
