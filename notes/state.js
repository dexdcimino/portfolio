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
/* ---- the AI Lab preview -------------------------------------------------
 * A document with nothing behind it, shown to anyone who clicks the eyeball on
 * the DexNote card. It has one job beyond being harmless: SHOW WHAT A NOTE CAN
 * HOLD. So between them these three categories carry every shape the schema
 * allows -- headings, bullets, nesting, numbered lists, to-dos ticked and not,
 * a quote, inline code, a link chip, a markdown chip, an image and a table --
 * and one archived category, so the archive that opens with it has something
 * in it rather than the words "Nothing archived".
 *
 * THE PICTURE IS AN SVG DATA URI, and it goes through demoAssets like every
 * other image in the preview: chips.hydrate() resolves an image's data-key
 * against that map first and only then against the asset endpoint, which is
 * the path a picture dropped into the sandbox already takes. Nothing here can
 * reach the server, and nothing here needs to.
 *
 * Kept deliberately silly. It is a demo of an editor, not a portfolio piece,
 * and a page of lorem ipsum tells a visitor less about the app than a list of
 * snacks for a nine-light-year flight does. */

/* A REAL PNG AND ITS REAL HASH. The schema keeps an image only if its
 * data-key is <64 hex>.<png|jpg|webp|gif> -- a key IS the sha-256 of the
 * bytes, which is what makes an asset content-addressed and what stops
 * anything smuggling a made-up one in. So this is a real PNG, the key below
 * is really its hash, and the extension is really its format. An SVG was
 * written first and refused, correctly: the allowlist has no svg in it
 * because an SVG asset is a script-execution surface.
 *
 * 2650 bytes, drawn once by tools/ -- see the commit that added it. Inline
 * rather than a file under assets/ because it is the preview's only picture
 * and a fetch for it would be a request that can fail on the one screen a
 * visitor gets. */
const DEMO_IMG_KEY = '1cac60d88248870bd6676c65bd163e4c87b1cceec581c7a83bc303a23f2718c6.png';
const DEMO_IMG = 'data:image/png;base64,'
  + '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';

export const demoAssets = () => new Map([[DEMO_IMG_KEY, DEMO_IMG]]);

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
            + '<p>The whole plan, pasted in as markdown and folded up: '
            + '<span class="chip chip-md" data-md="'
            + 'IyBMYW5kaW5nIENoZWNrbGlzdAoKMS4gUmVkdWNlIHNwZWVkIGJlbG93IHRoZSBzb3VuZCBiYXJyaWVyLgoy'
            + 'LiBBaW0gZm9yIGEgZmllbGQsIG5vdCBhIHN0YWRpdW0uCjMuIFR1cm4gb2ZmIHRoZSBsaWdodHMgKmJlZm9y'
            + 'ZSogdGhlIGRlc2NlbnQuCgo+IEEgc2F1Y2VyIGFycml2aW5nIHF1aWV0bHkgaXMgYSBzYXVjZXIgbm9ib2R5'
            + 'IGZpbG1zLgo=" contenteditable="false">Landing Checklist</span></p>'
            + '<ul class="todo"><li data-checked="1">Park the saucer somewhere legal</li>'
            + '<li>Practise the handshake</li></ul>',
      }),
      newCat('Blending In', {
        emoji: '\u{1F576}\uFE0F', color: '#d59cff',
        body: '<h3>Things humans do that we do not</h3>'
            + '<ul><li>Queue. Apparently on purpose.</li>'
            + '<li>Say <i>"we should get coffee"</i> and then never do it</li>'
            + '<li>Apologise to furniture</li></ul>'
            + '<p>Field notes on the local idiom, straight from the source: '
            + '<a class="chip chip-link" href="https://en.wikipedia.org/wiki/Small_talk" '
            + 'contenteditable="false" target="_blank" rel="noopener">Small talk</a></p>'
            + '<blockquote>Nobody has asked what planet I am from. '
            + 'They keep asking what I do for work.</blockquote>'
            + '<p>The disguise runs on <code>sunglasses + confidence</code>. '
            + 'Do not overthink it.</p>'
            + '<ul class="todo"><li data-checked="1">Buy a coat</li>'
            + '<li data-checked="1">Learn three opinions about the weather</li>'
            + '<li>Stop hovering when nervous</li></ul>',
      }),
      newCat('Souvenirs', {
        emoji: '\u{1F4E6}', color: '#ffb85c',
        body: '<h3>What to take home</h3>'
            + '<p>The site as photographed on arrival. Nine light years is a long '
            + 'way to come and not bring anything back.</p>'
            /* IN A PARAGRAPH. An image is INLINE content in this schema, and a
               bare one at the root of a body is not a block clean() will keep
               where it was put. */
            + '<p><img class="nt-img" data-key="' + DEMO_IMG_KEY + '" data-w="75" draggable="false"></p>'
            + '<table><tbody>'
            + '<tr><td>Item</td><td>Mass</td><td>Legal?</td></tr>'
            + '<tr><td>Tacos, frozen</td><td>4 kg</td><td>Yes</td></tr>'
            + '<tr><td>One traffic cone</td><td>2 kg</td><td>Unclear</td></tr>'
            + '<tr><td>A goose</td><td>5 kg</td><td>Absolutely not</td></tr>'
            + '</tbody></table>'
            + '<ol><li>Weigh everything twice</li>'
            + '<li>Leave the goose</li>'
            + '<li>Take the goose</li></ol>',
      }),
    ],
  });
  /* One in the archive, because the preview opens with the archive expanded
     and an expanded archive with nothing in it demonstrates a label. */
  session.archived = [newCat('Abandoned Plans', {
    emoji: '\u{1F5FF}', color: '#5cc8ff',
    body: '<h3>Rejected on review</h3>'
        + '<ul><li>Land on the roof of the tallest building</li>'
        + '<li>Introduce ourselves during a live sports broadcast</li>'
        + '<li>Simply explain everything</li></ul>',
    archivedAt: now(),
  })];
  /* THE OUTLINER AND THE ARCHIVE BOTH OPEN. A visitor gets one look at this,
     and a folded sidebar and a folded archive are two of the app's features
     hidden behind two gestures nobody knows are there. The real notes keep
     whatever Dex left them at -- ui.archOpen and ui.sidebar are saved -- and
     this is a fresh document every time, so it can simply start right. */
  return normalize({
    v: 2, active: session.id, sessions: [session],
    ui: { ...defaultUi(), sidebar: 'open', archOpen: true },
  });
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
