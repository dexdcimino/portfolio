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

function staticPass() {
  const fn = source();
  if (!fn) { fail('renderMarkdown() not found in script.js'); return; }
  let checks = 0;

  // 1. esc() still neutralises both quote characters. Without these the link
  //    target escapes its attribute, which is the original bug.
  const esc = fn.slice(fn.indexOf('const esc'), fn.indexOf('const safeHref'));
  for (const [what, needle] of [['double', '&quot;'], ['single', '&#39;']]) {
    checks++;
    if (!esc.includes(needle)) fail(`esc() no longer escapes the ${what} quote — a link target can break out of its attribute`);
  }

  // 2. Every attribute the renderer interpolates into is one it is allowed to
  //    emit. This is the one that catches a hole that does not exist yet.
  for (const m of fn.matchAll(/([a-zA-Z-]+)="\$\{/g)) {
    checks++;
    if (!ALLOWED_ATTRS.includes(m[1])) {
      fail(`renderMarkdown interpolates into ${m[1]}="…", which is not in the allowlist `
           + `(${ALLOWED_ATTRS.join(', ')}). Add a payload for it here, then widen the list.`);
    }
  }

  // 3. The scheme allowlist is still an allowlist. A denylist here would be a
  //    different function with the same name.
  checks++;
  if (!/safeHref\s*=\s*\(h\)\s*=>\s*\(\s*\/\^\(/.test(fn.replace(/\s+/g, ' '))
      && !fn.includes('safeHref')) fail('safeHref() is gone — link targets are no longer filtered by scheme');

  if (!process.exitCode) console.log(`check_markdown: static — ${checks} source invariant(s) hold`);
}

/* --------------------------------------------------------------- browser ---- */

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
      const payloads = ${JSON.stringify(PAYLOADS)};
      const attrs = ${JSON.stringify(ALLOWED_ATTRS)};
      const tags = ${JSON.stringify(ALLOWED_TAGS)};
      return payloads.map(([name, md]) => {
        const host = document.createElement('div');
        host.innerHTML = renderMarkdown(md);
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
      });
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

staticPass();
if (!STATIC_ONLY) await browserPass();
if (process.exitCode) {
  console.error('\ncheck_markdown: renderMarkdown() can emit markup it should not. This is the');
  console.error('                XSS that shipped once already — see the header of this file.');
}
