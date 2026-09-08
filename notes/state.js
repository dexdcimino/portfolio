/* The document: what is saved, how an old one is brought up to date, and how
 * the pre-rebuild HTML notes become one.
 *
 * SHAPE (v2)
 *   doc = {
 *     v: 2,
 *     active: sessionId,
 *     sessions: [ session ],
 *     ui: { theme, font, fs, sidebar, spell, autocorrect, slots[16] },
 *     spell: { ignore: [word], custom: [word] },
 *     emojiFreq: { emoji: count },
 *   }
 *   session = { id, title, emoji, color, created, updated, cats: [cat], archived: [cat] }
 *   cat     = { id, title, emoji, color, collapsed, body, updated, archivedAt? }
 *
 * `body` is the schema HTML from schema.js. `updated` on a session is what the
 * conflict merge compares, so every mutation that touches a session goes
 * through `touch()`.
 *
 * There are no subcategories. The old app had them, the notes never used
 * them, and one level of category with one body each is the shape the notes
 * are actually written in. Flat is what keeps every other operation simple.
 */

import { clean } from './schema.js';

export const FONTS = {
  outfit: { label: 'Outfit', stack: "'Outfit', sans-serif" },
  raleway: { label: 'Raleway', stack: "'Raleway', sans-serif" },
  inter: { label: 'Inter', stack: "'Inter', sans-serif" },
  jetbrains: { label: 'JetBrains', stack: "'JetBrains Mono', monospace" },
  spacemono: { label: 'Space Mono', stack: "'Space Mono', monospace" },
};
export const SIZES = [14, 15, 16, 17, 18, 20, 22, 24];

/* The category colours the seed used, plus a spread for new categories. */
export const PALETTE = ['#ff5c5c', '#ffb85c', '#ffe45c', '#7cffb2', '#5cf0ff', '#5cc8ff', '#d59cff', '#ff9ccb', '#b0b0b0'];
export const SESSION_PALETTE = ['#68d121', '#5cc8ff', '#d59cff', '#ffb85c', '#ff5c5c', '#5cf0ff', '#ff9ccb', '#ffe45c'];

export const HEX = /^#[0-9a-f]{6}$/i;

let counter = 0;
export function newId(prefix) {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

export const now = () => new Date().toISOString();

/* ---- defaults ------------------------------------------------------------ */

export function newCat(title, extra = {}) {
  return {
    id: newId('c'),
    title: title || 'New Category',
    emoji: '',
    color: extra.color || PALETTE[Math.floor(Math.random() * (PALETTE.length - 1))],
    collapsed: false,
    body: '<p><br></p>',
    updated: now(),
    ...extra,
  };
}

export function newSession(title, extra = {}) {
  const session = {
    id: newId('s'),
    title: title || 'New Session',
    emoji: '',
    color: extra.color || SESSION_PALETTE[0],
    created: now(),
    updated: now(),
    cats: [],
    archived: [],
    ...extra,
  };
  if (!session.cats.length) session.cats.push(newCat('New Category'));
  return session;
}

export function emptyDoc() {
  const session = newSession('Notes');
  return {
    v: 2,
    active: session.id,
    sessions: [session],
    ui: defaultUi(),
    spell: { ignore: [], custom: [] },
    emojiFreq: {},
  };
}

export function defaultUi() {
  return {
    theme: 'dark',
    font: 'outfit',
    fs: 17,
    sidebar: 'open',
    // The node kind the header's button inserts, i.e. the one used last.
    node: 'link',
    spell: true,
    autocorrect: true,
    // How the sidebar's leftover height is split between the category list
    // and the archive, as the list's percentage. Dragged, so it is saved.
    archSplit: 72,
    /* ...and whether the archive is FOLDED OPEN, saved for the same reason
       and missed for longer: the split was restored on every load while the
       fold was not, so an archive left open came back shut every single time
       and the height it came back at was invisible until you opened it again.
       Two halves of one piece of state, only one of which was kept. */
    archOpen: false,
    slots: Array(16).fill(''),
  };
}

/* ---- normalise: any saved doc -> a doc this code can run on --------------- */

export function normalize(input) {
  const doc = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
  const out = {
    v: 2,
    active: typeof doc.active === 'string' ? doc.active : null,
    sessions: Array.isArray(doc.sessions) ? doc.sessions.map(normalizeSession).filter(Boolean) : [],
    ui: { ...defaultUi(), ...(doc.ui && typeof doc.ui === 'object' ? doc.ui : {}) },
    spell: {
      ignore: uniqueWords(doc.spell && doc.spell.ignore),
      custom: uniqueWords(doc.spell && doc.spell.custom),
    },
    emojiFreq: (doc.emojiFreq && typeof doc.emojiFreq === 'object') ? doc.emojiFreq : {},
  };
  if (!FONTS[out.ui.font]) out.ui.font = 'outfit';
  if (!SIZES.includes(Number(out.ui.fs))) out.ui.fs = 17;
  out.ui.fs = Number(out.ui.fs);
  if (out.ui.theme !== 'light') out.ui.theme = 'dark';
  if (out.ui.sidebar !== 'rail') out.ui.sidebar = 'open';
  out.ui.spell = out.ui.spell !== false;
  out.ui.autocorrect = out.ui.autocorrect !== false;
  out.ui.archSplit = Math.max(20, Math.min(80, Number(out.ui.archSplit) || 72));
  out.ui.archOpen = out.ui.archOpen === true;
  if (!Array.isArray(out.ui.slots) || out.ui.slots.length !== 16) out.ui.slots = Array(16).fill('');
  out.ui.slots = out.ui.slots.map((s) => (typeof s === 'string' && HEX.test(s) ? s.toLowerCase() : ''));
  if (!out.sessions.length) out.sessions.push(newSession('Notes'));
  if (!out.sessions.some((s) => s.id === out.active)) out.active = out.sessions[0].id;
  // Ids must be unique across the whole document, or a rename lands twice.
  const seen = new Set();
  for (const s of out.sessions) {
    if (seen.has(s.id)) s.id = newId('s');
    seen.add(s.id);
    for (const c of [...s.cats, ...s.archived]) {
      if (seen.has(c.id)) c.id = newId('c');
      seen.add(c.id);
    }
  }
  return out;
}

function normalizeSession(s) {
  if (!s || typeof s !== 'object') return null;
  const cats = (Array.isArray(s.cats) ? s.cats : []).map(normalizeCat).filter(Boolean);
  const archived = (Array.isArray(s.archived) ? s.archived : []).map(normalizeCat).filter(Boolean);
  const out = {
    id: typeof s.id === 'string' && s.id ? s.id : newId('s'),
    title: str(s.title, 'Session', 60),
    emoji: str(s.emoji, '', 16),
    color: HEX.test(s.color || '') ? s.color.toLowerCase() : SESSION_PALETTE[0],
    created: str(s.created, now(), 40),
    updated: str(s.updated, now(), 40),
    cats,
    archived,
  };
  if (!out.cats.length) out.cats.push(newCat('New Category'));
  return out;
}

function normalizeCat(c) {
  if (!c || typeof c !== 'object') return null;
  return {
    id: typeof c.id === 'string' && c.id ? c.id : newId('c'),
    title: str(c.title, 'New Category', 80),
    emoji: str(c.emoji, '', 16),
    color: HEX.test(c.color || '') ? c.color.toLowerCase() : PALETTE[8],
    collapsed: !!c.collapsed,
    body: typeof c.body === 'string' ? c.body : '<p><br></p>',
    updated: str(c.updated, now(), 40),
    ...(c.archivedAt ? { archivedAt: str(c.archivedAt, now(), 40) } : {}),
  };
}

const str = (v, d, max) => (typeof v === 'string' ? v.slice(0, max) : d);
const uniqueWords = (list) => [...new Set((Array.isArray(list) ? list : [])
  .filter((w) => typeof w === 'string').map((w) => w.toLowerCase().trim()).filter(Boolean))];

/* ---- lookups -------------------------------------------------------------- */

export const activeSession = (doc) => doc.sessions.find((s) => s.id === doc.active) || doc.sessions[0];
export const sessionOf = (doc, id) => doc.sessions.find((s) => s.id === id) || null;
export const catOf = (session, id) => session.cats.find((c) => c.id === id) || null;
export const archivedOf = (session, id) => session.archived.find((c) => c.id === id) || null;

export function touch(session, cat) {
  const t = now();
  session.updated = t;
  if (cat) cat.updated = t;
}

/* The session as a string, for the structural undo stack and for change
 * detection. */
export const snapshot = (session) => JSON.stringify(session);
export const restore = (json) => normalizeSession(JSON.parse(json));

/* ---- the conflict merge -------------------------------------------------- */

/* Another device saved first. Take THEIR document, then merge every session
 * this device also has, CATEGORY BY CATEGORY: each category comes from
 * whichever side stamped it last, a category only one side has is kept, and
 * the session's own title, emoji and colour follow the newer session stamp.
 * Two devices editing different categories of the same session both keep
 * their work; the same category edited on both keeps the later one. Nothing
 * is ever dropped by a merge; the worst case is a category deleted on one
 * device coming back from the other, which is recoverable in a way that a
 * lost one is not. */
export function merge(mine, theirs, loadedStamps) {
  const out = normalize(theirs);
  const byId = new Map(out.sessions.map((s) => [s.id, s]));
  for (const s of mine.sessions) {
    const theirsS = byId.get(s.id);
    if (!theirsS) { out.sessions.push(s); continue; }
    const i = out.sessions.indexOf(theirsS);
    out.sessions[i] = mergeSession(s, theirsS);
  }
  void loadedStamps;
  out.ui = mine.ui;
  out.spell = {
    ignore: [...new Set([...out.spell.ignore, ...mine.spell.ignore])],
    custom: [...new Set([...out.spell.custom, ...mine.spell.custom])],
  };
  out.emojiFreq = { ...out.emojiFreq, ...mine.emojiFreq };
  out.active = mine.active;
  return normalize(out);
}

function mergeSession(mine, theirs) {
  const newer = mine.updated >= theirs.updated ? mine : theirs;
  const pick = (a, b) => (a && b ? (a.updated >= b.updated ? a : b) : a || b);
  const mergeList = (listA, listB) => {
    const bById = new Map(listB.map((c) => [c.id, c]));
    const out = listA.map((c) => pick(c, bById.get(c.id)));
    const seen = new Set(listA.map((c) => c.id));
    for (const c of listB) if (!seen.has(c.id)) out.push(c);
    return out;
  };
  // A category archived on one side and live on the other: the newer copy
  // says where it belongs.
  let cats = mergeList(mine.cats, theirs.cats);
  let archived = mergeList(mine.archived, theirs.archived);
  const archivedIds = new Set(archived.map((c) => c.id));
  cats = cats.filter((c) => {
    const a = archived.find((x) => x.id === c.id);
    if (!a) return true;
    if (a.updated > c.updated) return false;
    archived = archived.filter((x) => x.id !== c.id);
    return true;
  });
  void archivedIds;
  return { ...newer, cats, archived, updated: newer.updated };
}

/* ---- the sandbox document ------------------------------------------------- */

/* What the AI Lab preview opens with. It is a demonstration, so it is short
 * and it shows the shapes: a heading, nested bullets, bold, a to-do list with
 * something already ticked, two categories, and a second colour that is not
 * the session's -- which is the thing a screenshot of an empty editor cannot
 * show. Nothing here is ever saved anywhere. */
export function demoDoc() {
  const green = '#68d121';
  const session = newSession('Brainstorm', {
    emoji: '\u{1F47D}', color: green,
    cats: [
      newCat('First Contact', {
        emoji: '\u{1F6F8}', color: green,
        body: '<h3>Before we land</h3>'
            + '<ul><li>Find a field nobody is watching'
            + '<ul><li>Kansas \u2014 traditional, low risk</li>'
            + '<li>Times Square \u2014 maximum reach, maximum questions</li></ul></li>'
            + '<li>Learn what <b>brb</b> means before the broadcast</li></ul>'
            + '<ul class="todo"><li data-checked="1">Park the saucer somewhere legal</li>'
            + '<li>Practise the handshake</li></ul>',
      }),
      newCat('Snacks For The Trip', {
        emoji: '\u{1F32E}', color: '#ffb85c',
        body: '<p>Nine light years is a long time to be hungry.</p>'
            + '<ul><li>Tacos. Non-negotiable.</li>'
            + '<li>Something that survives re-entry</li></ul>'
            + '<ul class="todo"><li>Work out why they put pineapple on pizza</li></ul>',
      }),
    ],
  });
  return normalize({ v: 2, active: session.id, sessions: [session], ui: defaultUi() });
}

/* ---- migration from the pre-rebuild HTML --------------------------------- */

/* The old document was one HTML string: a .nv-title, then <section
 * class="nv-sec" data-accent="..."> blocks each holding an <h2> (with an
 * inline SVG icon) and lists. Each section becomes a category; the accent
 * becomes its colour; the icon, which the new app does not have, becomes an
 * emoji chosen for the nine headings the seed shipped with. Anything outside
 * a section is kept, in a category of its own, rather than dropped.
 *
 * The result is asserted against the seed by tools/notes_migrate_check.mjs:
 * nine categories and every one of the 127 list items, word for word. */
const ACCENTS = {
  red: '#ff5c5c', blue: '#5cc8ff', green: '#7cffb2', orange: '#ffb85c',
  purple: '#d59cff', yellow: '#ffe45c', cyan: '#5cf0ff', pink: '#ff9ccb', grey: '#b0b0b0',
};
const ICON_EMOJI = {
  urgent: '⚠️', 'world-design': '🌍', 'creatures-npcs': '👾', 'player-character': '🧍',
  equipment: '⚔️', 'game-modes': '🎮', 'ideas-later': '💡', names: '🏷️', misc: '📦',
};

export function migrateHtml(html) {
  const holder = document.createElement('div');
  holder.innerHTML = html || '';
  const titleEl = holder.querySelector('.nv-title');
  const title = (titleEl && titleEl.textContent.trim()) || 'Notes';
  if (titleEl) titleEl.remove();

  const cats = [];
  for (const section of [...holder.querySelectorAll('.nv-sec')]) {
    const heading = section.querySelector('h2');
    const id = (heading && heading.id) || '';
    const name = heading ? heading.textContent.trim() : 'Untitled';
    if (heading) heading.remove();
    const color = ACCENTS[section.getAttribute('data-accent')] || PALETTE[8];
    cats.push(newCat(name, {
      color,
      emoji: ICON_EMOJI[id] || '',
      body: clean(section.innerHTML),
    }));
    section.remove();
  }
  // Whatever was outside every section: text typed at the top or bottom of
  // the old document. Kept, in its own category.
  const stray = clean(holder.innerHTML);
  if (stray && stray !== '<p><br></p>') cats.push(newCat('Notes', { color: PALETTE[8], body: stray }));

  const session = newSession(title, { cats: cats.length ? cats : undefined, emoji: '🌍', color: SESSION_PALETTE[0] });
  return normalize({
    v: 2,
    active: session.id,
    sessions: [session],
    ui: defaultUi(),
  });
}
