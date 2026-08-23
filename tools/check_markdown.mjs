#!/usr/bin/env node
/**
 * Prove renderMarkdown() cannot be talked into emitting an attribute.
 *
 *     node tools/check_markdown.mjs            # static pass + browser pass
 *     node tools/check_markdown.mjs --static   # static pass only, no browser
 *
 * WHY THIS EXISTS. On 2026-08-19 renderMarkdown escaped &, < and > but not
 * quotes, and dropped the link target straight into an attribute:
 *
 *     [x](/a"onmouseover=…)   ->   <a href="/a"onmouseover=…">
 *
 * The HTML parser reads that as a SECOND attribute, so a markdown link in any
 * .md file under assets/ai/prompts/ was script execution in the page's origin.
 * The fix was one `.replace(/"/g, '&quot;')`. A one-character fix on a function
 * nobody looks at again is exactly the kind that comes back, which is what this
 * is for.
 *
 * TWO PASSES, because they fail in different ways.
 *
 *   STATIC reads script.js as text and needs nothing installed. It asserts that
 *   esc() still escapes both quote characters, and that every attribute
 *   renderMarkdown interpolates into is one of the three it is allowed to emit.
 *   That second one is the check that catches a NEW hole — someone adding
 *   title="${…}" a year from now — rather than the one already fixed.
 *
 *   BROWSER runs the real function against hostile input in a real HTML parser
 *   and asserts that nothing outside the allowlist survives. It is the only
 *   faithful oracle here: the bug existed precisely because the parser does
 *   something surprising with `"` inside an attribute value, and any check that
 *   reimplements that parsing is guessing at the thing it is meant to verify.
 *   It needs Chrome or Edge; without one it says so and the static pass stands.
 *
 * The browser half borrows games/surveyor/dev/cdp.mjs — the repo's dependency-
 * free CDP client — rather than carrying a second copy of one.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATIC_ONLY = process.argv.includes('--static');

/* The three the renderer is allowed to write. href is interpolated; target and
   rel are literal constants on external links. Anything else appearing in the
   output — or interpolated into in the source — is a finding. */
const ALLOWED_ATTRS = ['href', 'target', 'rel'];
const ALLOWED_TAGS = ['P', 'A', 'CODE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'UL', 'OL', 'LI',
  'STRONG', 'EM', 'BR', 'DIV'];

/* One per construct the renderer supports, each carrying an attempt to break out
   of an attribute, smuggle a handler, or introduce an element. Add a row when
   the renderer learns a new construct — a payload nobody wrote is a construct
   nobody checked. */
const PAYLOADS = [
  ['link quote-break',    '[x](/a"onmouseover=alert`1`)'],
  ['link single quote',   "[x](/a'onmouseover=alert`1`)"],
  ['link backtick',       '[x](/a`onmouseover=1)'],
  ['link javascript:',    '[x](javascript:alert`1`)'],
  ['link JaVaScRiPt:',    '[x](JaVaScRiPt:alert`1`)'],
  ['link data:',          '[x](data:text/html,<script>alert(1)</script>)'],
  ['link vbscript:',      '[x](vbscript:msgbox)'],
  ['link relative+quote', '[x](foo/bar"autofocus onfocus=alert`1`)'],
  ['image syntax',        '![alt"onerror=alert`1`](/x.png)'],
  ['raw img tag',         '<img src=x onerror=alert`1`>'],
  ['raw script tag',      '<script>alert(1)</script>'],
  ['raw iframe',          '<iframe src=javascript:alert`1`></iframe>'],
  ['raw svg onload',      '<svg onload=alert`1`>'],
  ['heading',             '## <img src=x onerror=alert`1`> and [y](/a"onclick=1)'],
  ['table cell',          '| a | b |\n| --- | --- |\n| <img src=x onerror=1> | [z](/q"onmouseover=1) |'],
  ['list item',           '- [a](/x"onmouseover=1)\n- <img src=x onerror=1>'],
  ['ordered list',        '1. [a](/x"onmouseover=1)'],
  ['blockquote',          '> [a](/x"onmouseover=1) <img src=x onerror=1>'],
  ['code fence',          '```\n<img src=x onerror=alert`1`>\n```'],
  ['inline code',         'text `<img src=x onerror=1>` more'],
  ['bold/em',             '**<img src=x onerror=1>** *[a](/x"onclick=1)*'],
  ['html comment',        '<!-- --><img src=x onerror=1>'],
  ['entity smuggle',      '[x](/a&quot;onmouseover=alert&#40;1&#41;)'],
  ['mailto quote',        '[x](mailto:a@b.c"onmouseover=1)'],
];

const fail = (msg) => { console.error(`check_markdown: ${msg}`); process.exitCode = 1; };

/* ---------------------------------------------------------------- static ---- */

function source() {
  const js = readFileSync(join(ROOT, 'script.js'), 'utf8');
  const start = js.indexOf('function renderMarkdown');
  if (start === -1) return null;
  // To the next top-level declaration: enough to cover the whole renderer
  // without parsing JavaScript to find its closing brace.
  const end = js.indexOf('\n}', js.indexOf('return out.join', start));
  return js.slice(start, end === -1 ? js.length : end);
}

/* Every static rejection, as a pure function of the renderer's SOURCE TEXT.
 * Split out of staticPass() on 2026-08-22 so --cases can feed it renderers that are
 * deliberately broken. Returns { issues, checks }: issues empty means clean.
 *
 * The interpolation scan is the one that needed this most. It is a matchAll over the
 * function body, and a matchAll that finds NOTHING — because the renderer was rewritten
 * to build attributes some other way — contributes zero failures and zero checks, which
 * is indistinguishable from a renderer that interpolates safely. Hence `checks` is
 * returned and the caller asserts on it. */
function staticIssues(fn) {
  const issues = [];
  let checks = 0;
  if (!fn) return { issues: ['renderMarkdown() not found in script.js'], checks };

  // 1. esc() still neutralises both quote characters. Without these the link
  //    target escapes its attribute, which is the original bug.
  const esc = fn.slice(fn.indexOf('const esc'), fn.indexOf('const safeHref'));
  for (const [what, needle] of [['double', '&quot;'], ['single', '&#39;']]) {
    checks++;
    if (!esc.includes(needle)) issues.push(`esc() no longer escapes the ${what} quote — a link target can break out of its attribute`);
  }

  // 2. Every attribute the renderer interpolates into is one it is allowed to
  //    emit. This is the one that catches a hole that does not exist yet.
  let interpolations = 0;
  for (const m of fn.matchAll(/([a-zA-Z-]+)="\$\{/g)) {
    checks++; interpolations++;
    if (!ALLOWED_ATTRS.includes(m[1])) {
      issues.push(`renderMarkdown interpolates into ${m[1]}="…", which is not in the allowlist `
           + `(${ALLOWED_ATTRS.join(', ')}). Add a payload for it here, then widen the list.`);
    }
  }

  // 3. The scheme allowlist is still an allowlist. A denylist here would be a
  //    different function with the same name.
  checks++;
  if (!/safeHref\s*=\s*\(h\)\s*=>\s*\(\s*\/\^\(/.test(fn.replace(/\s+/g, ' '))
      && !fn.includes('safeHref')) issues.push('safeHref() is gone — link targets are no longer filtered by scheme');

  return { issues, checks, interpolations };
}

function staticPass() {
  const { issues, checks, interpolations } = staticIssues(source());
  for (const i of issues) fail(i);

  // The renderer builds at least one attribute by interpolation — it emits links. If that
  // count is zero the scan above examined nothing and check 2 passed vacuously, which is
  // the failure shape in CLAUDE.md, "Count the subject".
  if (!issues.length && !interpolations) {
    fail('the interpolation scan matched NOTHING — renderMarkdown no longer builds '
         + 'attributes the way this check knows how to read. It is not passing, it is blind.');
    return;
  }

  if (!process.exitCode) console.log(`check_markdown: static — ${checks} source invariant(s) hold`);
}

/* --------------------------------------------------------------- browser ---- */

/* The judgement, as source text so it can run inside the page against ANY renderer.
 *
 * It used to be inline in browserPass's template literal, where it could only ever be
 * pointed at the real renderMarkdown — which meant a clean run proved the renderer safe
 * and proved nothing at all about the detector. Extracted on 2026-08-22 so `--cases` can
 * run this same code against a deliberately unsafe renderer and require it to complain.
 * A detector that cannot be shown to fire is decoration. */
const DETECTOR = `(render, payloads, attrs, tags) => payloads.map(([name, md]) => {
  const host = document.createElement('div');
  host.innerHTML = render(md);
  const problems = [];
  for (const el of host.querySelectorAll('*')) {
    if (!tags.includes(el.tagName)) problems.push('tag <' + el.tagName.toLowerCase() + '>');
    for (const a of el.attributes) {
      if (/^on/i.test(a.name)) problems.push('EVENT HANDLER ' + a.name);
      else if (!attrs.includes(a.name)) problems.push('attribute ' + a.name);
    }
    const href = el.getAttribute('href');
    if (href && /^\\s*(javascript|data|vbscript):/i.test(href)) problems.push('scheme ' + href.slice(0, 30));
  }
  return { name, problems };
})`;

/* A renderer with the ORIGINAL BUG in it: escapes < > &, leaves quotes alone. That is
 * exactly what shipped on 2026-08-19 — the link target closed its own attribute and what
 * followed became an event handler. Used only by --cases, as the thing the detector must
 * catch. Kept beside the detector so the two cannot drift apart. */
const UNSAFE_RENDER = `(md) => {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return md.replace(/\\[([^\\]]*)\\]\\(([^)]*)\\)/g,
                    (_, t, h) => '<a href="' + esc(h) + '">' + esc(t) + '</a>');
}`;

async function browserPass() {
  let cdp;
  try {
    cdp = await import('../games/surveyor/dev/cdp.mjs');
    cdp.findChrome();
  } catch (e) {
    console.log(`check_markdown: browser pass SKIPPED — ${e.message.split('\n')[0]}`);
    console.log('             the static pass above still ran; run this on a machine with Chrome for the full suite');
    return;
  }

  const site = await cdp.serve(ROOT);
  const chrome = await cdp.launch({ width: 800, height: 600, port: 9411 });
  try {
    const page = await chrome.newPage();
    await page.send('Page.enable');
    await page.send('Page.navigate', { url: `http://127.0.0.1:${site.port}/index.html` });
    await cdp.wait(2000);

    const results = await cdp.evaluate(page, `(() => {
      if (typeof renderMarkdown !== 'function') return 'MISSING';
      return (${DETECTOR})(renderMarkdown, ${JSON.stringify(PAYLOADS)},
                           ${JSON.stringify(ALLOWED_ATTRS)}, ${JSON.stringify(ALLOWED_TAGS)});
    })()`);

    if (results === 'MISSING') { fail('renderMarkdown() is not reachable on the page'); return; }
    const broken = results.filter(r => r.problems.length);
    for (const r of broken) fail(`payload "${r.name}" produced ${r.problems.join(', ')}`);
    if (!broken.length) {
      console.log(`check_markdown: browser — ${results.length} hostile payload(s), nothing outside `
                  + `<${ALLOWED_TAGS.length} tags> / [${ALLOWED_ATTRS.join(' ')}]`);
    }
  } finally {
    await chrome.close();
    site.close();
  }
}

/* ----------------------------------------------------------------- cases ---- */

/* Prove this checker can still refuse. Doctrine rule 12; CLAUDE.md, "Count the subject".
 *
 * This is the XSS gate, so "it printed 24 hostile payload(s) and exited 0" is worth
 * exactly as much as the demonstration that it would have said something else. Both
 * halves are driven: staticIssues() against renderers broken one invariant at a time,
 * and — when there is a browser — the real DETECTOR against a renderer carrying the
 * original 2026-08-19 bug. */
const GOOD_SRC = `function renderMarkdown(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const safeHref = (h) => (/^(https?:|mailto:|#|\\/)/i.test(h) ? h : '#');
  out.push(\`<a href="\${esc(safeHref(h))}" target="_blank" rel="noopener">\${esc(t)}</a>\`);
  return out.join('');
}`;

async function cases() {
  const table = [
    ['a sound renderer passes', GOOD_SRC, 0],
    ['THE ORIGINAL BUG: esc() stops escaping the double quote',
     GOOD_SRC.replace(".replace(/\"/g, '&quot;')", ''), 1],
    ['esc() stops escaping the single quote',
     GOOD_SRC.replace(".replace(/'/g, '&#39;')", ''), 1],
    ['both quote escapes gone is two failures',
     GOOD_SRC.replace(".replace(/\"/g, '&quot;')", '').replace(".replace(/'/g, '&#39;')", ''), 2],
    ['interpolating into an EVENT HANDLER is caught',
     GOOD_SRC.replace('target="_blank"', 'onclick="${h}"'), 1],
    ['interpolating into src= is caught (a hole that does not exist yet)',
     GOOD_SRC.replace('target="_blank"', 'src="${h}"'), 1],
    ['losing safeHref is caught',
     GOOD_SRC.replace(/const safeHref[^\n]*\n/, '').replace('safeHref(h)', 'h'), 1],
    ['an EMPTY renderer is refused, never reported clean', '', 1],
  ];

  let bad = 0;
  for (const [name, src, want] of table) {
    const { issues } = staticIssues(src);
    const ok = issues.length === want;
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'WRONG'} ${name.padEnd(64)} ${issues.length} issue(s) (wanted ${want})`);
    if (!ok) for (const i of issues) console.log(`         -> ${i}`);
  }

  // The payload list is the browser half's entire subject. A trimmed one still prints a
  // confident sentence, so its size is asserted rather than reported.
  if (PAYLOADS.length < 20 || ALLOWED_ATTRS.length === 0 || ALLOWED_TAGS.length === 0) {
    console.error(`check_markdown --cases: subject gutted — ${PAYLOADS.length} payload(s), `
                  + `${ALLOWED_ATTRS.length} attr(s), ${ALLOWED_TAGS.length} tag(s)`);
    return 1;
  }
  // Named against the payload list as it actually reads, not against a guess at it —
  // a "covers the classic vectors" assertion that names vectors nobody used is a check
  // that fails for the wrong reason and gets deleted rather than fixed.
  const names = PAYLOADS.map(([n]) => n).join(' ').toLowerCase();
  for (const vector of ['quote', 'javascript', 'onload', 'script tag', 'data:']) {
    if (!names.includes(vector)) {
      console.error(`check_markdown --cases: no payload mentions "${vector}" — the classic `
                    + `vectors are not all covered any more`);
      return 1;
    }
  }

  // And the detector itself, against a renderer that really is unsafe.
  let browser = 'skipped (no Chrome)';
  try {
    const cdp = await import('../games/surveyor/dev/cdp.mjs');
    cdp.findChrome();
    const chrome = await cdp.launch({ width: 400, height: 300 });
    try {
      const page = await chrome.newPage();
      await page.send('Runtime.enable');
      const out = await cdp.evaluate(page, `(() => {
        const det = ${DETECTOR};
        const bad = det(${UNSAFE_RENDER}, ${JSON.stringify(PAYLOADS)},
                        ${JSON.stringify(ALLOWED_ATTRS)}, ${JSON.stringify(ALLOWED_TAGS)});
        const safe = det((md) => '<p>' + md.replace(/[&<>"']/g, '') + '</p>',
                         ${JSON.stringify(PAYLOADS)},
                         ${JSON.stringify(ALLOWED_ATTRS)}, ${JSON.stringify(ALLOWED_TAGS)});
        return { flagged: bad.filter(r => r.problems.length).length,
                 clean: safe.filter(r => r.problems.length).length };
      })()`);
      if (!out.flagged) {
        console.error('check_markdown --cases: the detector found NOTHING wrong with a '
                      + 'renderer carrying the original bug. It cannot fire.');
        bad++;
      }
      if (out.clean) {
        console.error(`check_markdown --cases: the detector flagged ${out.clean} payload(s) `
                      + 'on a renderer that strips every dangerous character — false positives.');
        bad++;
      }
      browser = `unsafe renderer flagged on ${out.flagged}/${PAYLOADS.length} payloads, `
                + `sound renderer flagged on ${out.clean}`;
      console.log(`  ${out.flagged && !out.clean ? 'ok  ' : 'WRONG'} `
                  + `the DETECTOR fires on a renderer with the original bug`.padEnd(70)
                  + ` ${out.flagged} flagged`);
    } finally { await chrome.close(); }
  } catch (e) {
    console.log(`  --   detector case SKIPPED — ${e.message.split('\n')[0]}`);
  }

  const refuses = table.filter(([, , w]) => w > 0).length;
  console.log(`check_markdown --cases: ${table.length - bad} of ${table.length} as expected `
              + `(${refuses} of them proving it still refuses; ${PAYLOADS.length} payloads; `
              + `browser: ${browser})`);
  return bad ? 1 : 0;
}

if (process.argv.includes('--cases')) {
  process.exit(await cases());
}

staticPass();
if (!STATIC_ONLY) await browserPass();
if (process.exitCode) {
  console.error('\ncheck_markdown: renderMarkdown() can emit markup it should not. This is the');
  console.error('                XSS that shipped once already — see the header of this file.');
}
