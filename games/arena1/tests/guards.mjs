// guards.mjs — the global guardrails from ARENA1_STEPS, run at the end of
// EVERY phase. Enforced by script, not discipline:
//   1. no Babylon anywhere under js/sim/, js/core/, js/net/
//   2. no wall clock / Math.random under js/sim/
//   3. js/sim/** and js/core/** import cleanly in plain Node — the headless proof
//   4. .gitignore must not catch games/arena1/index.html (the Chomp incident)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(ROOT, '..', '..');
let failures = 0;
const fail = (msg) => { failures++; console.error('FAIL  ' + msg); };
const pass = (msg) => console.log('pass  ' + msg);

function walk(dir) {
  let out = [];
  let entries = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (p.endsWith('.js') || p.endsWith('.mjs')) out.push(p);
  }
  return out;
}

// 1 — no Babylon in sim/core/net
{
  const banned = /BABYLON|babylonjs|@babylonjs/;
  let hits = 0;
  for (const dir of ['js/sim', 'js/core', 'js/net']) {
    for (const f of walk(join(ROOT, dir))) {
      if (banned.test(readFileSync(f, 'utf8'))) { hits++; fail(`Babylon reference in ${f}`); }
    }
  }
  if (!hits) pass('no Babylon under js/sim, js/core, js/net');
}

// 2 — no wall clock or Math.random in the sim
{
  const banned = [/Math\.random\(/, /performance\.now\(/, /Date\.now\(/];
  let hits = 0;
  for (const f of walk(join(ROOT, 'js/sim'))) {
    const src = readFileSync(f, 'utf8');
    for (const b of banned) if (b.test(src)) { hits++; fail(`${b} in ${f}`); }
  }
  if (!hits) pass('no wall clock / Math.random under js/sim');
}

// 3 — headless import proof
{
  let bad = 0;
  const files = [...walk(join(ROOT, 'js/sim')), ...walk(join(ROOT, 'js/core'))];
  for (const f of files) {
    try {
      execFileSync(process.execPath,
        ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(f).href)})`],
        { stdio: 'pipe' });
    } catch (e) {
      bad++; fail(`headless import failed: ${f}\n      ${String(e.stderr).split('\n')[0]}`);
    }
  }
  if (!bad) pass(`headless import clean (${files.length} file${files.length === 1 ? '' : 's'})`);
}

// 4 — .gitignore audit
{
  try {
    const out = execFileSync('git', ['check-ignore', '-v', 'games/arena1/index.html'],
      { cwd: REPO, stdio: 'pipe' }).toString().trim();
    fail(`.gitignore catches games/arena1/index.html: ${out}`);
  } catch {
    pass('.gitignore does not catch games/arena1/index.html'); // non-zero exit = not ignored
  }
}

console.log(failures ? `\n${failures} guard failure(s)` : '\nguards clean');
process.exit(failures ? 1 : 0);
