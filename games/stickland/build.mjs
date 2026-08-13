// ══════════════════════════════════════════════════════════════════════════
//  build.mjs — zero-dependency single-file build
// ══════════════════════════════════════════════════════════════════════════
//  Generates index.html from src/ so the game runs when the file is opened
//  directly from disk (file://) — no server, no npm install, no bundler.
//
//    node build.mjs            build once
//    node build.mjs --watch    rebuild on any change under src/
//
//  How it works
//  ------------
//  Browsers refuse to load ES modules over file:// (origin 'null'), but blob:
//  URLs created *by* the page are same-origin to it, and import() of a blob URL
//  works fine. So the build embeds every module's source verbatim (JSON-quoted)
//  into index.html together with a small bootstrap that, at runtime:
//
//    1. walks the modules in topological order (computed here, at build time),
//    2. substitutes each *static* import specifier with the literal blob URL of
//       the already-created dependency,
//    3. creates a Blob + object URL for the rewritten source, and
//    4. import()s the entry module's blob URL.
//
//  *Dynamic* import() sites can be circular (character.js ↔ playmode.js), so no
//  literal URL exists when the importing module's blob is made. Those sites are
//  rewritten at build time to a runtime lookup — import(window.__DEXMODS["…"])
//  — which resolves lazily, after every blob exists.
//
//  No transpiling, no minifying, no AST parsing: the embedded sources are the
//  files in src/, byte-for-byte, plus a //# sourceURL tag so devtools lists
//  them under their real filenames (readable stack traces, working breakpoints)
//  and the import-specifier rewrites described above.
//
//  Node standard library only. Keep it that way.
// ══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT     = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR  = path.join(ROOT, 'src');
const ENTRY    = 'main.js';                       // src-relative
const TEMPLATE = path.join(SRC_DIR, 'index.template.html');
const CSS_FILE = path.join(SRC_DIR, 'game.css');
const OUT_FILE = path.join(ROOT, 'index.html');

// ── Import-specifier matching ───────────────────────────────────────────────
// Line-anchored on purpose: an import/export statement in this codebase starts
// its line. Handles `import './x.js'`, `import { a as b } from './x.js'`,
// `import * as ns from './x.js'`, and `export … from './x.js'` re-exports.
const STATIC_IMPORT_RE = /^[ \t]*import[ \t]+(?:[\w$*{},\s]+?from[ \t]*)?(['"])([^'"\n]+)\1/gm;
const STATIC_EXPORT_RE = /^[ \t]*export[ \t]+(?:\*[\w$ \t]*|[\w$*{},\s]+?)[ \t]*from[ \t]*(['"])([^'"\n]+)\1/gm;
const DYNAMIC_IMPORT_RE = /\bimport[ \t]*\([ \t]*(['"])([^'"\n]+)\1[ \t]*\)/g;

const isRelative = (spec) => spec.startsWith('./') || spec.startsWith('../');

/** './playmode.js' seen from 'main.js' → module key 'playmode.js'.
 *  Keys are src-relative posix paths; they double as devtools filenames. */
function resolveSpec(fromKey, spec) {
  const key = path.posix.normalize(path.posix.join(path.posix.dirname(fromKey), spec));
  if (key.startsWith('..')) {
    throw new Error(`${fromKey}: import '${spec}' escapes src/ — only src-internal modules can be bundled`);
  }
  return key;
}

function readModule(key) {
  const file = path.join(SRC_DIR, key);
  if (!fs.existsSync(file)) {
    throw new Error(`module not found: src/${key} (is an import specifier misspelled?)`);
  }
  return fs.readFileSync(file, 'utf8');
}

// ── Discovery: crawl the graph from the entry ───────────────────────────────
// Static edges drive the topological order; dynamic edges only pull the target
// into the bundle (they resolve lazily at runtime, so order doesn't matter).
function discoverModules() {
  /** @type {Map<string, {key:string, src:string, deps:{spec:string,key:string}[], dynamicDeps:string[]}>} */
  const modules = new Map();
  const queue = [ENTRY];

  while (queue.length) {
    const key = queue.shift();
    if (modules.has(key)) continue;

    const src = readModule(key);
    const deps = [];        // static: [{spec, key}]
    const dynamicDeps = []; // dynamic: [key]

    for (const re of [STATIC_IMPORT_RE, STATIC_EXPORT_RE]) {
      for (const m of src.matchAll(re)) {
        const spec = m[2];
        if (!isRelative(spec)) {
          throw new Error(`${key}: bare import '${spec}' — everything must be src-relative, there is no node_modules`);
        }
        const depKey = resolveSpec(key, spec);
        if (!deps.some(d => d.key === depKey)) deps.push({ spec, key: depKey });
        queue.push(depKey);
      }
    }
    for (const m of src.matchAll(DYNAMIC_IMPORT_RE)) {
      const spec = m[2];
      if (!isRelative(spec)) continue;            // e.g. a CDN URL — leave alone
      const depKey = resolveSpec(key, spec);
      if (!dynamicDeps.includes(depKey)) dynamicDeps.push(depKey);
      queue.push(depKey);
    }

    modules.set(key, { key, src, deps, dynamicDeps });
  }
  return modules;
}

// ── Topological sort over static edges (DFS, cycle-detecting) ───────────────
function topoSort(modules) {
  const order = [];
  const state = new Map();                        // key → 'visiting' | 'done'

  function visit(key, chain) {
    if (state.get(key) === 'done') return;
    if (state.get(key) === 'visiting') {
      throw new Error(`static import cycle: ${[...chain, key].join(' → ')} — only dynamic import() may be circular`);
    }
    state.set(key, 'visiting');
    const deps = [...modules.get(key).deps].sort((a, b) => a.key.localeCompare(b.key));
    for (const d of deps) visit(d.key, [...chain, key]);
    state.set(key, 'done');
    order.push(key);
  }

  visit(ENTRY, []);
  // Anything reachable only through dynamic edges still needs a slot.
  for (const key of [...modules.keys()].sort()) visit(key, []);
  return order;
}

// ── Per-module source prep (build-time rewrites) ────────────────────────────
function prepareSource(mod, modules) {
  // Dynamic import('./x.js') → import(window.__DEXMODS["x.js"]): the runtime
  // registry lookup that makes the character ↔ playmode cycle resolvable.
  let src = mod.src.replace(DYNAMIC_IMPORT_RE, (whole, _q, spec) => {
    if (!isRelative(spec)) return whole;
    return `import(window.__DEXMODS[${JSON.stringify(resolveSpec(mod.key, spec))}])`;
  });

  // Static specifiers are substituted with blob URLs *at runtime* by the
  // bootstrap (the URLs don't exist yet). Sanity-check here that each
  // specifier actually appears quoted, so a silent no-op substitution can't
  // ship a module that still asks the browser for './x.js'.
  for (const d of mod.deps) {
    if (!src.includes(`'${d.spec}'`) && !src.includes(`"${d.spec}"`)) {
      throw new Error(`${mod.key}: static specifier ${d.spec} not found verbatim — bootstrap substitution would miss it`);
    }
  }

  // Real filename in devtools: readable stack traces, working breakpoints.
  if (!src.endsWith('\n')) src += '\n';
  src += `//# sourceURL=${mod.key}\n`;
  return src;
}

// ── HTML-safety for embedded script text ────────────────────────────────────
// JSON.stringify quotes and \u-escapes correctly (emoji-data.js is full of
// astral-plane characters) but does not escape HTML. Inside a <script>, a
// literal `</script` would end the element and `<!--` opens an escaped-data
// state; neutralize both. `<\/` and `<!` are valid escapes *inside JS
// string literals*, which is the only place these sequences can occur here —
// module sources and spec strings are all JSON-quoted.
function htmlEscapeScript(scriptText) {
  const out = scriptText
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\u0021--');
  if (/<\/script/i.test(out)) throw new Error('unescaped </script survived — refusing to emit a broken document');
  return out;
}

// ── Bootstrap (the only code in index.html that is not a src/ module) ────────
function emitBootstrap(order, modules, stamp) {
  const lines = [];
  lines.push(`'use strict';`);
  lines.push(`// Single-file build bootstrap — generated by build.mjs, do not edit.`);
  lines.push(`var BUILD_STAMP = ${JSON.stringify(stamp)};`);
  lines.push(`console.log('[build] dexnote-game single-file build ' + BUILD_STAMP);`);
  lines.push(``);
  lines.push(`// One entry per src/ module, topologically ordered (deps first), source`);
  lines.push(`// embedded verbatim. deps lists each static import as it appears in the`);
  lines.push(`// source (spec) plus the module it resolves to (key).`);
  lines.push(`var MODULES = [`);
  for (const key of order) {
    const mod = modules.get(key);
    const deps = JSON.stringify(mod.deps);
    const src = JSON.stringify(prepareSource(mod, modules));
    lines.push(``);
    lines.push(`// ── src/${key} ${'─'.repeat(Math.max(3, 58 - key.length))}`);
    lines.push(`{ key: ${JSON.stringify(key)},`);
    lines.push(`  deps: ${deps},`);
    lines.push(`  src: ${src} },`);
  }
  lines.push(`];`);
  lines.push(``);
  lines.push(`try {`);
  lines.push(`  // key → blob URL. Dynamic import() sites were rewritten at build time to`);
  lines.push(`  // import(window.__DEXMODS["<key>"]); by the time any of them runs, every`);
  lines.push(`  // module below has a URL, so circular dynamic imports resolve fine.`);
  lines.push(`  var registry = Object.create(null);`);
  lines.push(`  window.__DEXMODS = registry;`);
  lines.push(`  for (var i = 0; i < MODULES.length; i++) {`);
  lines.push(`    var mod = MODULES[i];`);
  lines.push(`    var src = mod.src;`);
  lines.push(`    for (var j = 0; j < mod.deps.length; j++) {`);
  lines.push(`      var dep = mod.deps[j];`);
  lines.push(`      if (!registry[dep.key]) throw new Error('bootstrap: ' + mod.key + ' needs ' + dep.key + ' first — topological order broken');`);
  lines.push(`      src = src.split("'" + dep.spec + "'").join("'" + registry[dep.key] + "'");`);
  lines.push(`      src = src.split('"' + dep.spec + '"').join('"' + registry[dep.key] + '"');`);
  lines.push(`    }`);
  lines.push(`    registry[mod.key] = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));`);
  lines.push(`  }`);
  lines.push(`  import(registry[${JSON.stringify(ENTRY)}]).catch(function (err) {`);
  lines.push(`    console.error('[boot] entry module failed:', err);`);
  lines.push(`  });`);
  lines.push(`} catch (err) {`);
  lines.push(`  console.error('[boot] bootstrap failed:', err);`);
  lines.push(`}`);
  return lines.join('\n');
}

// ── Build ────────────────────────────────────────────────────────────────────
function build() {
  const t0 = Date.now();
  const stamp = new Date().toISOString();

  const modules = discoverModules();
  const order = topoSort(modules);

  const css = fs.readFileSync(CSS_FILE, 'utf8');
  if (/<\/style/i.test(css)) throw new Error('src/game.css contains </style — it would terminate the inline style block');

  const bootstrap = htmlEscapeScript(emitBootstrap(order, modules, stamp));

  const banner = [
    ``,
    `  ██ GENERATED FILE — DO NOT EDIT ██`,
    ``,
    `  Built by build.mjs from src/ at ${stamp}.`,
    `  src/ is the source of truth: edit there, then run  node build.mjs`,
    ``,
    `  This file is deliberately self-contained (module sources embedded as`,
    `  blob-URL modules) so it runs when opened directly from disk (file://).`,
    `  Modules, in load order: ${order.join(', ')}`,
    ``,
  ].join('\n');

  let html = fs.readFileSync(TEMPLATE, 'utf8');
  const inject = (token, text) => {
    if (!html.includes(token)) throw new Error(`template missing ${token}`);
    html = html.replace(token, () => text);      // fn form: '$' in text stays literal
  };
  inject('@@INJECT:GENERATED_BANNER@@', banner);
  inject('@@INJECT:GAME_CSS@@', css.trimEnd());
  inject('@@INJECT:BOOTSTRAP_JS@@', bootstrap);
  if (html.includes('@@INJECT:')) throw new Error('unfilled @@INJECT: token left in output');

  fs.writeFileSync(OUT_FILE, html);
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  console.log(`built index.html — ${order.length} modules, ${kb} KB, ${Date.now() - t0} ms  [${stamp}]`);
  console.log(`  ${order.join(' → ')}`);
}

// ── Watch mode ───────────────────────────────────────────────────────────────
if (process.argv.includes('--watch')) {
  const rebuild = () => {
    try { build(); }
    catch (err) { console.error('build failed:', err.message); }
  };
  rebuild();
  let timer = null;
  fs.watch(SRC_DIR, { recursive: true }, (_event, file) => {
    clearTimeout(timer);
    timer = setTimeout(() => { console.log(`\nchange: src/${file || '?'}`); rebuild(); }, 120);
  });
  console.log('watching src/ — Ctrl+C to stop');
} else {
  build();
}
