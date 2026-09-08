/* Sessions in and out, as markdown.
 *
 * A session is a title and a list of categories, and markdown already has a
 * word for both of those. So the format is the obvious one and needs no
 * explaining to anybody who has ever written a readme:
 *
 *     # 🍣 Food & Diet        a session
 *     ## Staples              a category in it
 *     ### Drinks              a heading inside that category's text box
 *     - Ryl iced teas         its content
 *
 * Everything under a `##` is that category's body. Anything before the first
 * `##` becomes a category called Notes rather than being dropped. A file with
 * no `#` at all is one session named after the file. Several `#` in one file
 * are several sessions, so a whole backup restores in one go.
 *
 * WHY THIS IS IN THE APP AND NOT A SCRIPT. `tools/notes_import.mjs` does the
 * same job from a terminal, and to do it safely it needs the blob token in a
 * shell, a dev server to borrow a DOM from, and a person who knows what those
 * are. In here there is no token -- the import is an ordinary edit and rides
 * the same authenticated save every keystroke uses -- and `clean()` is already
 * loaded, so a body is verified by CONSTRUCTION rather than by a checker:
 * what gets stored is `clean(renderMarkdown(md))`, which is the output of the
 * one function that decides what a body may contain. There is nothing left for
 * a body check to disagree with.
 *
 * WHAT DOES NOT SURVIVE A ROUND TRIP, and is said out loud rather than
 * discovered: images. They are stored by content hash against the account, not
 * inside the note, so a markdown file can only carry a reference to one. Export
 * writes `![image](key)` and import leaves it as that text. Everything else --
 * headings, both kinds of list, todo boxes with their ticks, quotes, code
 * fences, rules, tables, links, and bold/italic/strike/code -- goes out and
 * comes back the same.
 */

import { el } from './dom.js';
import { ICON, panel, closePanel, toast } from './ui.js';
import { renderMarkdown } from './md.js';
import { clean } from './schema.js';
import { newCat, newSession, PALETTE, SESSION_PALETTE } from './state.js';

/* NOTHING IS IMPORTED FROM render.js, deliberately. The sessions sheet is what
   opens this, so render.js imports here; importing back would be a cycle, and
   a cycle between two modules that both run at load is the kind of thing that
   works until the day someone reorders an import. What this needs from the
   rest of the app arrives as one callback. */

/* An emoji at the head of a title is the title's emoji, not part of its text --
   which is how they are written in a heading and how they read in a list.

   \p{Extended_Pictographic} IS NOT ENOUGH ON ITS OWN. It misses the Dingbats
   and Miscellaneous Symbols that this app's own picker offers and that people
   plainly read as emoji: U+275D, the quote ornament already sitting on the
   Quotes category, is not Extended_Pictographic, and neither is a star.
   Exporting one and reading it back turned "Quotes" into a category named
   "<ornament> Quotes" -- a round trip that quietly corrupts a title, which is
   worse than one that fails.

   ARROWS ARE DELIBERATELY OUT. "-> Next steps" is a title, and nothing later
   can tell that apart from an emoji followed by a title.

   The cluster carries the variation selector and any zero-width joiners, or a
   two-part mark arrives as a base character plus a stray one the badge draws
   as a box. The space after it is REQUIRED: without it a title that is only
   an emoji has nothing left to be called.  */
const EMOJI = '(?:\\p{Extended_Pictographic}|[\\u2300-\\u27bf\\u2b00-\\u2bff])';
const LEAD_EMOJI = new RegExp(
  `^(${EMOJI}(?:\\ufe0f|\\u200d${EMOJI}|\\p{Emoji_Modifier})*)(?:\\s+|$)`, 'u');

function splitEmoji(title) {
  const m = LEAD_EMOJI.exec(title || '');
  if (!m) return { emoji: '', title: (title || '').trim() };
  return { emoji: m[1], title: title.slice(m[0].length).trim() };
}

/* ---- markdown -> sessions ------------------------------------------------- */

export function parseSessions(src, fallbackTitle = 'Imported') {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let session = null;
  let cat = null;
  let buf = [];
  let fenced = false;

  const closeCat = () => {
    if (!cat) return;
    cat.md = buf.join('\n').trim();
    buf = [];
    if (cat.title || cat.md) session.cats.push(cat);
    cat = null;
  };
  const openSession = (title) => {
    closeCat();
    const t = splitEmoji(title);
    session = { title: t.title || fallbackTitle, emoji: t.emoji, cats: [] };
    out.push(session);
  };
  const openCat = (title) => {
    if (!session) openSession(fallbackTitle);
    closeCat();
    const t = splitEmoji(title);
    cat = { title: t.title || 'Untitled', emoji: t.emoji, md: '' };
  };

  for (const line of lines) {
    /* A heading inside a fence is CODE, not a heading. Without this a note
       that documents this very format would split itself into sessions. */
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced) {
      const h2 = /^##\s+(.+)$/.exec(line);
      if (h2) { openCat(h2[1].trim()); continue; }
      const h1 = /^#\s+(.+)$/.exec(line);
      if (h1) { openSession(h1[1].trim()); continue; }
    }
    if (!line.trim() && !cat) continue;
    if (!session) openSession(fallbackTitle);
    if (!cat) cat = { title: 'Notes', emoji: '', md: '' };
    buf.push(line);
  }
  closeCat();
  return out.filter((s) => s.cats.length);
}

/* The parsed shape becomes real sessions. `clean(renderMarkdown(md))` is the
   whole conversion: renderMarkdown decides what the markdown MEANS and clean()
   decides what a body may CONTAIN, and running them in that order is what makes
   an imported body indistinguishable from a typed one. */
export function buildSessions(parsed, startIndex = 0) {
  return parsed.map((p, i) => {
    const s = newSession(p.title, {
      emoji: p.emoji,
      color: SESSION_PALETTE[(startIndex + i) % SESSION_PALETTE.length],
    });
    s.cats = p.cats.map((c, j) => newCat(c.title, {
      emoji: c.emoji,
      color: PALETTE[j % (PALETTE.length - 1)],
      body: clean(renderMarkdown(c.md)) || '<p><br></p>',
    }));
    return s;
  });
}

/* ---- sessions -> markdown ------------------------------------------------- */

const MD_ESCAPE = /([\\`*_[\]])/g;
const esc = (t) => t.replace(MD_ESCAPE, '\\$1');

function inlineMd(node) {
  if (node.nodeType === 3) return esc(node.nodeValue);
  if (node.nodeType !== 1) return '';
  const kids = () => [...node.childNodes].map(inlineMd).join('');
  switch (node.tagName) {
    case 'BR': return '\n';
    case 'B': return `**${kids()}**`;
    case 'I': return `*${kids()}*`;
    case 'S': return `~~${kids()}~~`;
    case 'CODE': return `\`${[...node.childNodes].map((n) => (n.nodeType === 3 ? n.nodeValue : '')).join('')}\``;
    case 'IMG': return `![image](${node.dataset.key || 'image'})`;
    case 'A': {
      /* A chip's mark is a rendering, not text -- it has no place in an
         export. Reading the element's own text nodes is the same rule
         chipLabel() follows for the same reason. */
      const label = [...node.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('').trim()
        || node.getAttribute('href');
      return `[${esc(label)}](${node.getAttribute('href')})`;
    }
    case 'U': return kids();
    default: return kids();
  }
}

function listMd(list, depth, out) {
  const ordered = list.tagName === 'OL';
  const todo = list.classList.contains('todo');
  let n = 1;
  for (const li of [...list.children].filter((c) => c.tagName === 'LI')) {
    const nested = [...li.children].filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
    const own = [...li.childNodes].filter((c) => !(c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')));
    const text = own.map(inlineMd).join('').trim();
    const bullet = todo ? `- [${li.dataset.checked ? 'x' : ' '}]` : ordered ? `${n}.` : '-';
    out.push(`${'  '.repeat(depth)}${bullet} ${text}`);
    n += 1;
    for (const sub of nested) listMd(sub, depth + 1, out);
  }
}

function tableMd(table, out) {
  const rows = [...table.querySelectorAll('tr')];
  if (!rows.length) return;
  const cells = (tr) => [...tr.children].map((td) => [...td.childNodes].map(inlineMd).join('').trim().replace(/\|/g, '\\|') || ' ');
  const head = cells(rows[0]);
  out.push(`| ${head.join(' | ')} |`);
  out.push(`| ${head.map(() => '---').join(' | ')} |`);
  for (const tr of rows.slice(1)) out.push(`| ${cells(tr).join(' | ')} |`);
}

export function bodyToMarkdown(html) {
  const holder = document.createElement('div');
  holder.innerHTML = html || '';
  const out = [];
  for (const block of holder.children) {
    switch (block.tagName) {
      case 'H3': out.push(`### ${[...block.childNodes].map(inlineMd).join('').trim()}`); break;
      case 'UL': case 'OL': listMd(block, 0, out); break;
      case 'PRE': out.push('```', block.textContent.replace(/\n$/, ''), '```'); break;
      case 'BLOCKQUOTE': out.push([...block.childNodes].map(inlineMd).join('').trim().split('\n').map((l) => `> ${l}`).join('\n')); break;
      case 'HR': out.push('---'); break;
      case 'TABLE': tableMd(block, out); break;
      default: {
        const t = [...block.childNodes].map(inlineMd).join('').trim();
        if (t) out.push(t);
      }
    }
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function sessionToMarkdown(session) {
  const lines = [`# ${session.emoji ? `${session.emoji} ` : ''}${session.title}`, ''];
  for (const c of session.cats) {
    lines.push(`## ${c.emoji ? `${c.emoji} ` : ''}${c.title}`, '');
    const md = bodyToMarkdown(c.body);
    if (md) lines.push(md, '');
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/* ---- the panel ------------------------------------------------------------ */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function openImport(anchor, onImport) {
  const drop = el('div', { class: 'nt-io-drop' },
    el('span', { class: 'nt-io-drop-icon', html: ICON.image }),
    el('span', { text: 'Drop a .md file here, or ' }),
    el('label', { class: 'nt-io-pick' }, 'choose one',
      el('input', { type: 'file', accept: '.md,.markdown,.txt,text/markdown,text/plain' })));
  const area = el('textarea', {
    class: 'nt-io-text', rows: '9', spellcheck: 'false',
    placeholder: '# My Session\n## A category\n- a bullet\n\n...or paste markdown here',
  });
  const summary = el('div', { class: 'nt-io-summary', text: 'Nothing to import yet.' });
  const go = el('button', { type: 'button', class: 'nt-btn nt-io-go', text: 'Import', disabled: true });
  let parsed = [];
  let name = 'Imported';

  const review = () => {
    parsed = parseSessions(area.value, name);
    const cats = parsed.reduce((n, s) => n + s.cats.length, 0);
    go.disabled = !parsed.length;
    summary.classList.toggle('is-ready', !!parsed.length);
    summary.textContent = parsed.length
      ? `${plural(parsed.length, 'session', 'sessions')}, ${plural(cats, 'category', 'categories')} — ${parsed.map((s) => `${s.emoji} ${s.title}`.trim()).join(', ')}`
      : area.value.trim() ? 'No headings found. A session needs a "# Title" or a "## Category".' : 'Nothing to import yet.';
  };

  const take = async (file) => {
    if (!file) return;
    name = file.name.replace(/\.[^.]+$/, '') || 'Imported';
    area.value = await file.text();
    review();
  };
  drop.querySelector('input').addEventListener('change', (e) => take(e.target.files[0]));
  for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  for (const t of ['dragleave', 'drop']) drop.addEventListener(t, () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); take(e.dataTransfer.files[0]); });
  area.addEventListener('input', review);

  go.addEventListener('click', () => {
    const taking = parsed;
    const cats = taking.reduce((n, s) => n + s.cats.length, 0);
    closePanel();
    onImport(taking);
    toast(`Imported ${plural(taking.length, 'session', 'sessions')}, ${plural(cats, 'category', 'categories')}`);
  });

  panel({
    className: 'nt-io-panel', anchor, align: 'left', below: false, keepFocus: true,
    content: el('div', { class: 'nt-io' },
      el('div', { class: 'nt-io-head', text: 'Import a session' }),
      drop, area, summary,
      el('div', { class: 'nt-io-foot' }, go)),
  });
  setTimeout(() => area.focus(), 0);
}

export function exportSession(session) {
  const md = sessionToMarkdown(session);
  const safe = (session.title || 'session').replace(/[\\/:*?"<>|]/g, '-').trim() || 'session';
  const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
  const a = el('a', { href: url, download: `${safe}.md` });
  document.body.append(a);
  a.click();
  a.remove();
  /* Revoked on a timer, not immediately: the click is asynchronous and a URL
     revoked in the same tick is a download that silently never starts. */
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(`Exported ${session.title}`);
}
